import { expect, test, type Page } from "@playwright/test";

const PANEL = "#worldScreen";

function field(page: Page, name: string) {
  return page.locator(`${PANEL} [data-field="${name}"]`);
}

async function readNumber(page: Page, name: string, pattern = /-?[\d.]+/): Promise<number> {
  const text = (await field(page, name).textContent()) ?? "";
  const match = pattern.exec(text);
  if (!match) return Number.NaN;
  // Prefer an explicit capture group so a readout with several numbers in it can
  // be asked for the one that matters.
  return Number(match[1] ?? match[0]);
}

async function openGround(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "World Map" }).click();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 15_000 });
  await page.locator(`${PANEL} [data-action="view-ground"]`).click();
  await expect(page.locator(`${PANEL} [data-section="streaming"]`)).toBeVisible({ timeout: 15_000 });
}

test.describe("streamed ground view", () => {
  test("streams sectors into the scene with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await openGround(page);

    // Every sector in the ring set eventually lands, and the outer ring sleeps.
    await expect(field(page, "stream-states")).toHaveText(/\d+ active/, { timeout: 20_000 });
    await expect(field(page, "stream-states")).toHaveText(/\d+ sleeping/, { timeout: 20_000 });
    await expect(field(page, "stream-resident")).toHaveText(/[1-9]\d* sectors/, { timeout: 20_000 });
    await expect(field(page, "stream-scene")).toHaveText(/[1-9]\d* meshes/);

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("generates terrain in a worker rather than on the render thread", async ({ page }) => {
    await openGround(page);
    // The fallback is honest but slower; this asserts the real path is in use.
    await expect(field(page, "stream-service")).toHaveText("worker", { timeout: 20_000 });
  });

  test("streams collision detail the player can stand on", async ({ page }) => {
    await openGround(page);
    await expect(field(page, "stream-ground")).toHaveText(/-?[\d.]+ m/, { timeout: 20_000 });

    // Hong Kong is shaped as a land shelf, so the ground under it is above water.
    const height = await readNumber(page, "stream-ground");
    expect(height).toBeGreaterThan(0);
    // The altitude readout follows the streamed ground rather than staying at zero.
    await page.locator(`${PANEL} [data-action="walk-north"]`).click();
    await expect(field(page, "altitude")).toHaveText(/[\d.]+ m/);
  });

  test("keeps the simulation running while flying the stress route", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await openGround(page);
    await expect(field(page, "stream-resident")).toHaveText(/[1-9]\d* sectors/, { timeout: 20_000 });

    const tick = page.locator('#diagnosticsPanel [data-field="tick"]');
    const tickBefore = Number(await tick.textContent());
    const startSector = await field(page, "sector").textContent();

    await page.locator(`${PANEL} [data-action="route-toggle"]`).click();
    await expect(field(page, "stream-route")).toHaveText(/[\d.]+ of \d+ s/, { timeout: 10_000 });

    // Sectors change under the player while the route runs.
    await expect(field(page, "sector")).not.toHaveText(startSector ?? "", { timeout: 20_000 });
    // Generation is off the render thread, so ticks keep accumulating. A frozen
    // main thread would leave this number where it started.
    await expect
      .poll(async () => Number(await tick.textContent()), { timeout: 20_000 })
      .toBeGreaterThan(tickBefore + 60);

    await page.locator(`${PANEL} [data-action="route-toggle"]`).click();
    await expect(page.locator(`${PANEL} [data-action="route-toggle"]`)).toHaveText("Fly route");

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("bounds resident sectors and memory however far the route flies", async ({ page }) => {
    await openGround(page);
    await page.locator(`${PANEL} [data-action="route-toggle"]`).click();

    // Residency is capped by the ring set, not by distance travelled.
    await expect
      .poll(async () => readNumber(page, "stream-churn", /\d+ \/ (\d+)/), { timeout: 25_000 })
      .toBeGreaterThan(0);

    const peakResident = await readNumber(page, "stream-resident", /peak (\d+)/);
    const peak = Number(
      /peak ([\d.]+) MB/.exec((await field(page, "stream-memory").textContent()) ?? "")?.[1] ?? "0",
    );
    // Square rings of depth three: a seven by seven block, and never more.
    expect(peakResident).toBeLessThanOrEqual(49);
    expect(peak).toBeLessThan(96);

    await page.locator(`${PANEL} [data-action="route-toggle"]`).click();
  });

  test("reuses cached sectors when the player turns around", async ({ page }) => {
    await openGround(page);
    await expect(field(page, "stream-resident")).toHaveText(/[1-9]\d* sectors/, { timeout: 20_000 });

    await page.locator(`${PANEL} [data-action="teleport-select"]`).selectOption("tokyo");
    await page.locator(`${PANEL} [data-action="teleport"]`).click();
    await expect(field(page, "region")).toHaveText("tokyo", { timeout: 10_000 });
    await expect(field(page, "stream-resident")).toHaveText(/[1-9]\d* sectors/, { timeout: 20_000 });

    await page.locator(`${PANEL} [data-action="teleport-select"]`).selectOption("hong-kong");
    await page.locator(`${PANEL} [data-action="teleport"]`).click();
    await expect(field(page, "region")).toHaveText("hong-kong", { timeout: 10_000 });

    // Coming back is served from the cache instead of regenerating.
    await expect
      .poll(async () => readNumber(page, "stream-cache", /(\d+) hit/), { timeout: 20_000 })
      .toBeGreaterThan(0);
  });

  test("switching back to the globe tears every streamed sector down", async ({ page }) => {
    await openGround(page);
    await expect(field(page, "stream-scene")).toHaveText(/[1-9]\d* meshes/, { timeout: 20_000 });

    const draws = page.locator('#diagnosticsPanel [data-field="drawCalls"]');
    await expect.poll(async () => Number(await draws.textContent()), { timeout: 10_000 }).toBeGreaterThan(5);

    await page.locator(`${PANEL} [data-action="view-globe"]`).click();
    // The streaming section disappears because streaming genuinely stopped.
    await expect(page.locator(`${PANEL} [data-section="streaming"]`)).toBeHidden();
    // Back to the globe's own cost: markers, tiles and one sphere.
    await expect.poll(async () => Number(await draws.textContent()), { timeout: 10_000 }).toBeLessThan(30);
  });

  test("leaving the world map releases everything and keeps the app alive", async ({ page }) => {
    await openGround(page);
    await expect(field(page, "stream-resident")).toHaveText(/[1-9]\d* sectors/, { timeout: 20_000 });

    await page.locator(`${PANEL} [data-action="exit-world"]`).click();
    await expect(page.getByRole("button", { name: "New Game" })).toBeVisible();
    await expect(page.locator(PANEL)).toHaveCount(0);

    const tick = page.locator('#diagnosticsPanel [data-field="tick"]');
    const before = Number(await tick.textContent());
    await expect.poll(async () => Number(await tick.textContent())).toBeGreaterThan(before);

    // Reopening builds a fresh streamer rather than reviving the old one.
    await page.getByRole("button", { name: "World Map" }).click();
    await page.locator(`${PANEL} [data-action="view-ground"]`).click();
    await expect(field(page, "stream-generated")).toHaveText(/^\d+$/, { timeout: 20_000 });
  });

  test("the globe view shows no streaming panel, because nothing is streaming", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "World Map" }).click();
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 15_000 });

    await expect(page.locator(`${PANEL} [data-section="streaming"]`)).toBeHidden();
    await expect(page.locator(`${PANEL} [data-section="route"]`)).toBeHidden();
  });
});
