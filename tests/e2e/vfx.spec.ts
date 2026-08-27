import { expect, test, type Page } from "@playwright/test";

/**
 * The look, in a real browser.
 *
 * The unit and integration suites prove the budgets, the ladder and the
 * accessibility gates without a GPU. What only a browser proves is that the
 * effect settings are drawn, persist across a reload, and reach the running
 * fight; and that a battle with effects firing leaves the scene no heavier than
 * it found it.
 */

const WORLD = "#worldScreen";
const PILOT = "#pilotScreen";
const VFX = `${PILOT} [data-section="vfx"]`;

async function pilot(page: Page, query = "?seed=20260910"): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "World Map" }).click();
  await expect(page.locator(WORLD)).toBeVisible({ timeout: 15_000 });
  await page.locator(`${WORLD} [data-action="view-ground"]`).click();
  await expect(page.locator(`${WORLD} [data-section="streaming"]`)).toBeVisible({ timeout: 20_000 });
  await page.locator(`${WORLD} [data-action="pilot"]`).click();
  await expect(page.locator(PILOT)).toBeVisible({ timeout: 15_000 });
}

test.describe("effects and style", () => {
  test("shows the five effect settings with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await pilot(page);
    await expect(page.locator(VFX)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`${VFX} [data-action="vfx-flashes"]`)).toBeChecked();
    await expect(page.locator(`${VFX} [data-action="vfx-blur"]`)).toBeChecked();
    await expect(page.locator(`${VFX} [data-action="vfx-intense"]`)).toBeChecked();
    await expect(page.locator(`${VFX} [data-action="vfx-particles"]`)).toHaveValue("100");
    expect(consoleErrors).toEqual([]);
  });

  test("remembers the effect settings across a reload", async ({ page }) => {
    await pilot(page);
    await page.locator(`${VFX} [data-action="vfx-flashes"]`).uncheck();
    await page.locator(`${VFX} [data-action="vfx-particles"]`).fill("30");
    await page.locator(`${VFX} [data-action="vfx-particles"]`).dispatchEvent("input");

    const stored = await page.evaluate(() => window.localStorage.getItem("shatterdome.vfx.v1"));
    expect(stored).toContain('"flashes":false');
    expect(JSON.parse(stored ?? "{}").particleDensity).toBeCloseTo(0.3, 2);

    await pilot(page);
    await expect(page.locator(`${VFX} [data-action="vfx-flashes"]`)).not.toBeChecked({
      timeout: 10_000,
    });
    await expect(page.locator(`${VFX} [data-action="vfx-particles"]`)).toHaveValue("30");
  });

  test("a fight with effects firing leaves the pool where it found it", async ({ page }) => {
    await pilot(page);
    type VfxStats = { systems: number; aliveBursts: number; atBaseline: boolean; refusedAtCeiling: number };
    const read = () =>
      page.evaluate(() => (window as { debugVfxStats?: () => VfxStats | null }).debugVfxStats?.() ?? null);

    const before = await read();
    expect(before).not.toBeNull();
    expect(before!.atBaseline).toBe(true);

    await page.locator(`${PILOT} [data-action="spawn-target"]`).click();
    await page.locator("canvas").click();
    // A burst of melee so hits land, sparks fire and impacts freeze.
    for (const key of ["J", "K", "J", "K", "U", "J"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(250);
    }
    // End the fight, then let the last bursts run out: every life in the
    // catalogue is under three seconds, and effects age on the frame clock, so
    // capacity must all be home by now or something leaked.
    await page.locator(`${PILOT} [data-action="clear-target"]`).dispatchEvent("click");
    await page.waitForTimeout(3_500);

    const after = await read();
    // The pooled systems were allocated at ground-view creation and never grow:
    // the same count of systems, zero live bursts, full capacity back.
    expect(after!.systems).toBe(before!.systems);
    expect(after!.aliveBursts).toBe(0);
    expect(after!.atBaseline).toBe(true);
  });

  test("the fight still runs with every effect setting at its minimum", async ({ page }) => {
    await pilot(page);
    await page.locator(`${VFX} [data-action="vfx-flashes"]`).uncheck();
    await page.locator(`${VFX} [data-action="vfx-blur"]`).uncheck();
    await page.locator(`${VFX} [data-action="vfx-intense"]`).uncheck();
    await page.locator(`${VFX} [data-action="vfx-particles"]`).fill("0");
    await page.locator(`${VFX} [data-action="vfx-particles"]`).dispatchEvent("input");
    await page.locator(`${VFX} [data-action="vfx-shake"]`).fill("0");
    await page.locator(`${VFX} [data-action="vfx-shake"]`).dispatchEvent("input");

    await page.locator(`${PILOT} [data-action="spawn-target"]`).click();
    await page.locator("canvas").click();
    await page.keyboard.press("J");
    // The hit still lands and is still logged: settings change what is shown,
    // never what happened.
    await expect(page.locator(`${PILOT} [data-field="hit-log"]`)).not.toBeEmpty({ timeout: 15_000 });
  });
});
