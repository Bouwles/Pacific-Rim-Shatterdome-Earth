import { expect, test, type Page } from "@playwright/test";

const PANEL = "#worldScreen";

function field(page: Page, name: string) {
  return page.locator(`${PANEL} [data-field="${name}"]`);
}

async function openWorld(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "World Map" }).click();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 15_000 });
}

async function teleport(page: Page, regionId: string): Promise<void> {
  await page.locator(`${PANEL} [data-action="teleport-select"]`).selectOption(regionId);
  await page.locator(`${PANEL} [data-action="teleport"]`).click();
  await expect(field(page, "region")).toHaveText(regionId, { timeout: 5_000 });
}

test.describe("world map", () => {
  test("renders the globe and a full coordinate readout with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await openWorld(page);

    await expect(field(page, "latitude")).toHaveText(/22\.3193° N/);
    await expect(field(page, "longitude")).toHaveText(/114\.1694° E/);
    await expect(field(page, "sector")).toHaveText(/^[+-][XYZ]\/\d+\/\d+$/);
    await expect(field(page, "neighbors")).toHaveText(/[+-][XYZ]\/\d+\/\d+/);
    await expect(field(page, "region")).toHaveText("hong-kong");
    await expect(field(page, "climate")).toHaveText("subtropical");

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("keeps exactly one region active while the rest stay strategic", async ({ page }) => {
    await openWorld(page);
    // Eight regions in the registry: one active, seven strategic.
    await expect(field(page, "tiers")).toHaveText("1 active, 7 strategic");
  });

  test("teleports between the five named locations and recovers each climate", async ({ page }) => {
    await openWorld(page);

    const expected: readonly (readonly [string, string])[] = [
      ["hong-kong", "subtropical"],
      ["sydney", "temperate"],
      ["tokyo", "temperate"],
      ["anchorage", "subarctic"],
      ["manila", "tropical"],
    ];

    const sectors = new Set<string>();
    for (const [regionId, climate] of expected) {
      await teleport(page, regionId);
      await expect(field(page, "climate")).toHaveText(climate);
      sectors.add((await field(page, "sector").textContent()) ?? "");
      // Only ever one region under combat-grade simulation.
      await expect(field(page, "tiers")).toHaveText("1 active, 7 strategic");
    }

    expect(sectors.size).toBe(expected.length);
  });

  test("walking moves the player and eventually crosses a sector boundary", async ({ page }) => {
    await openWorld(page);
    const startSector = await field(page, "sector").textContent();
    const startLat = await field(page, "latitude").textContent();

    // Twelve kilometres north is more than one sector on this globe.
    for (let step = 0; step < 12; step += 1) {
      await page.locator(`${PANEL} [data-action="walk-north"]`).click();
    }

    await expect(field(page, "latitude")).not.toHaveText(startLat ?? "");
    await expect(field(page, "sector")).not.toHaveText(startSector ?? "");
  });

  test("rebases the floating origin during a long walk and keeps local coordinates small", async ({
    page,
  }) => {
    await openWorld(page);
    await expect(field(page, "rebases")).toHaveText("0");

    for (let step = 0; step < 10; step += 1) {
      await page.locator(`${PANEL} [data-action="walk-east"]`).click();
    }

    // Ten kilometres east at a 2 km threshold has to have rebased.
    await expect(field(page, "rebases")).not.toHaveText("0");

    const local = (await field(page, "local").textContent()) ?? "";
    const [east] = local.split("/").map((part) => Math.abs(parseFloat(part)));
    // Without rebasing this would read about 10,000 m and start to wobble.
    expect(east).toBeLessThan(2600);
  });

  test("a teleport rebases immediately rather than waiting for drift", async ({ page }) => {
    await openWorld(page);
    await teleport(page, "anchorage");

    const local = (await field(page, "local").textContent()) ?? "";
    const magnitudes = local.split("/").map((part) => Math.abs(parseFloat(part)));
    // The anchor follows the jump, so the player sits at the local origin.
    for (const value of magnitudes) expect(value).toBeLessThan(1);
    await expect(field(page, "anchor")).toHaveText(/61\.2181° N/);
  });

  test("leaving the world map returns to the menu with the simulation still running", async ({ page }) => {
    await openWorld(page);
    const tick = page.locator('#diagnosticsPanel [data-field="tick"]');
    const before = Number(await tick.textContent());

    await page.locator(`${PANEL} [data-action="exit-world"]`).click();
    await expect(page.getByRole("button", { name: "New Game" })).toBeVisible();
    await expect(page.locator(PANEL)).toHaveCount(0);

    await expect.poll(async () => Number(await tick.textContent())).toBeGreaterThan(before);
  });

  test("world position survives a save and load round trip", async ({ page }) => {
    await openWorld(page);
    await teleport(page, "sydney");
    const sector = await field(page, "sector").textContent();

    await page.locator(`${PANEL} [data-action="exit-world"]`).click();
    await page.getByRole("button", { name: "Saves", exact: true }).click();
    await page.locator('#saveScreen [data-field="new-name"]').fill("World round trip");
    await page.locator('#saveScreen [data-action="save-new"]').click();
    await expect(page.locator("#saveScreen .save-row")).toHaveCount(1);

    // Move somewhere else, then load the save back.
    await page.locator('#saveScreen [data-action="exit-saves"]').click();
    await page.getByRole("button", { name: "World Map" }).click();
    await teleport(page, "anchorage");
    await page.locator(`${PANEL} [data-action="exit-world"]`).click();

    await page.getByRole("button", { name: "Saves", exact: true }).click();
    await page.locator('#saveScreen [data-action="load"]').click();
    await expect(page.locator('#saveScreen [data-field="notice"]')).toContainText("Loaded");

    await page.locator('#saveScreen [data-action="exit-saves"]').click();
    await page.getByRole("button", { name: "World Map" }).click();

    await expect(field(page, "region")).toHaveText("sydney");
    await expect(field(page, "sector")).toHaveText(sector ?? "");
  });
});
