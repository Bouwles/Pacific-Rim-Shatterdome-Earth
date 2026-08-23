import { expect, test, type Page } from "@playwright/test";

const PANEL = "#worldScreen";

function field(page: Page, name: string) {
  return page.locator(`${PANEL} [data-field="${name}"]`);
}

async function text(page: Page, name: string): Promise<string> {
  return (await field(page, name).textContent()) ?? "";
}

async function readNumber(page: Page, name: string, pattern: RegExp): Promise<number> {
  const match = pattern.exec(await text(page, name));
  if (!match) return Number.NaN;
  return Number((match[1] ?? match[0]).replace(/,/g, ""));
}

async function openHongKong(page: Page, query = "?seed=20260823"): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "World Map" }).click();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 15_000 });
  await page.locator(`${PANEL} [data-action="view-ground"]`).click();
  await expect(page.locator(`${PANEL} [data-section="streaming"]`)).toBeVisible({ timeout: 15_000 });
  // The world starts at Hong Kong, which is the one region with a city plan.
  await expect(page.locator(`${PANEL} [data-section="city"]`)).toBeVisible({ timeout: 20_000 });
}

test.describe("Hong Kong city", () => {
  test("builds a recognisable city with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await openHongKong(page);

    await expect(field(page, "city-region")).toHaveText(/hong-kong, 7 districts/);
    await expect(field(page, "city-layout")).toHaveText(/[\d,]+ blocks, [\d,]+ towers, \d+ landmarks/);
    await expect(field(page, "city-defence")).toHaveText(/\d+ positions, \d+ roads, \d+ lanes, 2 routes/);

    // Silhouette and activity: real blocks, real towers, a Shatterdome landmark.
    expect(await readNumber(page, "city-layout", /([\d,]+) blocks/)).toBeGreaterThan(100);
    expect(await readNumber(page, "city-layout", /([\d,]+) towers/)).toBeGreaterThan(150);
    expect(await readNumber(page, "city-layout", /(\d+) landmarks/)).toBeGreaterThan(4);

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("draws the city as many meshes rather than one", async ({ page }) => {
    await openHongKong(page);
    await expect(field(page, "city-drawn")).toHaveText(/[\d,]+ towers in \d+\/\d+ groups/, {
      timeout: 20_000,
    });

    const resident = await readNumber(page, "city-drawn", /in (\d+)\//);
    const meshes = await readNumber(page, "city-drawn", /(\d+) meshes/);
    // One mesh per destruction group is what makes damage and streaming possible.
    expect(resident).toBeGreaterThan(4);
    expect(meshes).toBeGreaterThan(resident);
  });

  test("runs pooled agents rather than thousands of civilians", async ({ page }) => {
    await openHongKong(page);
    await expect(field(page, "city-agents")).toHaveText(/\d+\/\d+ pooled/, { timeout: 20_000 });

    const live = await readNumber(page, "city-agents", /(\d+)\//);
    const capacity = await readNumber(page, "city-agents", /\/(\d+) pooled/);
    expect(live).toBeGreaterThan(0);
    expect(live).toBeLessThanOrEqual(capacity);
    // The pool is bounded and modest: this is the failure mode being avoided.
    expect(capacity).toBeLessThanOrEqual(1_500);
    await expect(field(page, "city-agents")).toHaveText(/vehicle/);
    await expect(field(page, "city-agents")).toHaveText(/crowd/);
  });

  test("an alert changes traffic, shipping, military, sirens and evacuation", async ({ page }) => {
    await openHongKong(page);
    await expect(field(page, "city-alert")).toHaveText(/calm/, { timeout: 20_000 });

    const calmStreets = await readNumber(page, "city-streets", /(\d+)% civilians/);
    const calmShipping = await readNumber(page, "city-harbour", /(\d+)% shipping/);
    const calmMilitary = await readNumber(page, "city-harbour", /(\d+)% military/);
    expect(await text(page, "city-alert")).not.toContain("sirens");

    await page.locator(`${PANEL} [data-action="alert-attack"]`).click();
    await expect(field(page, "city-alert")).toHaveText(/attack/, { timeout: 10_000 });

    // Sirens sound, and the streets and harbour empty as the response ramps.
    await expect(field(page, "city-alert")).toHaveText(/sirens/, { timeout: 20_000 });
    await expect
      .poll(async () => readNumber(page, "city-streets", /(\d+)% civilians/), { timeout: 25_000 })
      .toBeLessThan(calmStreets);
    await expect
      .poll(async () => readNumber(page, "city-harbour", /(\d+)% shipping/), { timeout: 25_000 })
      .toBeLessThan(calmShipping);
    await expect
      .poll(async () => readNumber(page, "city-harbour", /(\d+)% military/), { timeout: 25_000 })
      .toBeGreaterThan(calmMilitary);
    // And people start reaching muster points.
    await expect
      .poll(async () => readNumber(page, "city-evacuation", /(\d+)% clear/), { timeout: 25_000 })
      .toBeGreaterThan(0);
  });

  test("an all clear brings the city back and stops the sirens", async ({ page }) => {
    await openHongKong(page);
    await page.locator(`${PANEL} [data-action="alert-attack"]`).click();
    await expect(field(page, "city-alert")).toHaveText(/sirens/, { timeout: 20_000 });

    await page.locator(`${PANEL} [data-action="alert-recovery"]`).click();
    await expect(field(page, "city-alert")).toHaveText(/recovery/, { timeout: 10_000 });
    await expect(field(page, "city-alert")).not.toHaveText(/sirens/, { timeout: 25_000 });
  });

  test("alert state survives a save and load round trip", async ({ page }) => {
    await openHongKong(page);
    await page.locator(`${PANEL} [data-action="alert-warning"]`).click();
    await expect(field(page, "city-alert")).toHaveText(/warning/, { timeout: 10_000 });

    await page.locator(`${PANEL} [data-action="exit-world"]`).click();
    await page.getByRole("button", { name: "Saves", exact: true }).click();
    await page.locator('#saveScreen [data-field="new-name"]').fill("City alert");
    await page.locator('#saveScreen [data-action="save-new"]').click();
    await expect(page.locator("#saveScreen .save-row")).toHaveCount(1);
    await page.locator('#saveScreen [data-action="exit-saves"]').click();

    // Stand the city back down, then load the save.
    await page.getByRole("button", { name: "World Map" }).click();
    await page.locator(`${PANEL} [data-action="view-ground"]`).click();
    await expect(page.locator(`${PANEL} [data-section="city"]`)).toBeVisible({ timeout: 20_000 });
    await page.locator(`${PANEL} [data-action="alert-calm"]`).click();
    await expect(field(page, "city-alert")).toHaveText(/calm/, { timeout: 10_000 });
    await page.locator(`${PANEL} [data-action="exit-world"]`).click();

    await page.getByRole("button", { name: "Saves", exact: true }).click();
    await page.locator('#saveScreen [data-action="load"]').click();
    await expect(page.locator('#saveScreen [data-field="notice"]')).toContainText("Loaded");
    await page.locator('#saveScreen [data-action="exit-saves"]').click();

    await page.getByRole("button", { name: "World Map" }).click();
    await page.locator(`${PANEL} [data-action="view-ground"]`).click();
    await expect(page.locator(`${PANEL} [data-section="city"]`)).toBeVisible({ timeout: 20_000 });
    await expect(field(page, "city-alert")).toHaveText(/warning/, { timeout: 10_000 });
  });

  test("stays inside its budgets on Medium", async ({ page }) => {
    await openHongKong(page, "?seed=20260823&quality=medium");
    await expect(field(page, "city-drawn")).toHaveText(/towers in/, { timeout: 25_000 });

    const towers = await readNumber(page, "city-drawn", /([\d,]+) towers/);
    const groups = await readNumber(page, "city-drawn", /in (\d+)\//);
    const capacity = await readNumber(page, "city-agents", /\/(\d+) pooled/);
    // The Medium row of the quality table, read back off the running game.
    expect(towers).toBeLessThanOrEqual(620);
    expect(groups).toBeLessThanOrEqual(70);
    expect(capacity).toBeLessThanOrEqual(620);

    const draws = page.locator('#diagnosticsPanel [data-field="drawCalls"]');
    await expect.poll(async () => Number(await draws.textContent()), { timeout: 15_000 }).toBeLessThan(200);

    // Frame rate is deliberately not asserted here. Playwright's Chromium falls
    // back to a software rasteriser, so an fps number from it measures the test
    // runner's renderer rather than this code; the real figure is recorded by
    // hand in PERFORMANCE_BUDGETS.md. What is portable is that the simulation
    // keeps ticking, which proves the city is not blocking the main thread.
    const tick = page.locator('#diagnosticsPanel [data-field="tick"]');
    const before = Number(await tick.textContent());
    await expect
      .poll(async () => Number(await tick.textContent()), { timeout: 15_000 })
      .toBeGreaterThan(before + 30);
  });

  test("shows no city where none has been built", async ({ page }) => {
    await openHongKong(page);
    await page.locator(`${PANEL} [data-action="teleport-select"]`).selectOption("pacific-breach");
    await page.locator(`${PANEL} [data-action="teleport"]`).click();
    await expect(field(page, "region")).toHaveText("pacific-breach", { timeout: 10_000 });

    // The Breach has no city plan, so the panel says nothing rather than zeroes.
    await expect(page.locator(`${PANEL} [data-section="city"]`)).toBeHidden({ timeout: 20_000 });
    await expect(page.locator(`${PANEL} [data-section="alert"]`)).toBeHidden();
  });

  test("tears the city down with the ground view", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await openHongKong(page);
    const draws = page.locator('#diagnosticsPanel [data-field="drawCalls"]');
    await expect.poll(async () => Number(await draws.textContent()), { timeout: 20_000 }).toBeGreaterThan(20);

    await page.locator(`${PANEL} [data-action="view-globe"]`).click();
    // The layout and the alert are still real on the globe, so the block stays;
    // what disappears is the rendering report, because nothing is being drawn.
    await expect(field(page, "city-drawn")).toBeHidden({ timeout: 10_000 });
    await expect(field(page, "city-region")).toBeVisible();
    // Back to the globe's own cost, which is a sphere, markers and tiles.
    await expect.poll(async () => Number(await draws.textContent()), { timeout: 10_000 }).toBeLessThan(30);

    await page.locator(`${PANEL} [data-action="exit-world"]`).click();
    await expect(page.getByRole("button", { name: "New Game" })).toBeVisible();
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });
});
