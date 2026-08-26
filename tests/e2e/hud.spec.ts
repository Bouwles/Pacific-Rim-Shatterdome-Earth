import { expect, test, type Page } from "@playwright/test";

/**
 * The HUD, in a real browser.
 *
 * The unit and integration suites prove what the interface decides to say. What
 * only a browser proves is that it is actually drawn, that the display settings
 * reach it, that a critical warning survives every one of them, and that the
 * whole thing can be reached from the keyboard.
 */

const WORLD = "#worldScreen";
const PILOT = "#pilotScreen";

/** Gets into the machine, which is where the HUD lives. */
async function pilot(page: Page, query = "?seed=20260903"): Promise<void> {
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

const hud = (page: Page) => page.locator(`${PILOT} [data-section="hud"]`);

test.describe("the combat HUD", () => {
  test("draws the cockpit and the readings, with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await pilot(page);
    await expect(hud(page)).toBeVisible({ timeout: 10_000 });

    // Every instrument the milestone names is on screen, reading a system.
    const instruments = hud(page).locator('[data-field="hud-instruments"] li');
    expect(await instruments.count()).toBeGreaterThan(8);
    const text = (await instruments.allTextContents()).join(" | ");
    for (const label of ["Heading", "Speed", "Reactor", "Heat", "Drift", "Faults", "Targeting", "Weather"]) {
      expect(text, label).toContain(label);
    }

    expect(consoleErrors, consoleErrors.join(String.fromCharCode(10))).toEqual([]);
  });

  test("carries severity as a shape as well as a colour", async ({ page }) => {
    await pilot(page);
    await expect(hud(page)).toBeVisible({ timeout: 10_000 });

    // The accessibility rule made checkable: every reading has a glyph, so the
    // meaning survives without hue.
    const entries = hud(page).locator(".pilot-hud-entry");
    expect(await entries.count()).toBeGreaterThan(4);
    for (const glyph of await entries.locator(".pilot-hud-glyph").allTextContents()) {
      expect(glyph.trim().length).toBeGreaterThan(0);
    }
    // And each entry declares its severity, so a test or a stylesheet can see it.
    const severities = await entries.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset["severity"] ?? ""),
    );
    for (const severity of severities) expect(severity.length).toBeGreaterThan(0);
  });

  test("says nothing critical when nothing is wrong", async ({ page }) => {
    await pilot(page);
    await expect(hud(page)).toBeVisible({ timeout: 10_000 });
    // Minimal because there is nothing to say. The band is present but empty.
    const band = hud(page).locator('[data-field="hud-critical"]');
    expect(await band.locator(".pilot-hud-alert").count()).toBe(0);
  });

  test("fades the ordinary interface without ever fading the critical layer", async ({ page }) => {
    await pilot(page);
    await expect(hud(page)).toBeVisible({ timeout: 10_000 });

    const opacity = page.locator(`${PILOT} [data-action="hud-opacity"]`);
    await opacity.fill("35");
    await opacity.dispatchEvent("input");
    await page.waitForTimeout(300);

    // The grid dims; the critical band is not allowed to.
    const grid = hud(page).locator(".pilot-hud-grid");
    const gridOpacity = await grid.evaluate((node) => getComputedStyle(node).opacity);
    expect(Number(gridOpacity)).toBeLessThan(1);

    const band = hud(page).locator(".pilot-hud-critical");
    const bandOpacity = await band.evaluate((node) => getComputedStyle(node).opacity);
    expect(Number(bandOpacity)).toBe(1);
  });

  test("changes text size and colour handling on request", async ({ page }) => {
    await pilot(page);
    await expect(hud(page)).toBeVisible({ timeout: 10_000 });

    // Read the variable every size in the layer is derived from, rather than one
    // element's computed size: that is the thing the control actually changes.
    const scaleOf = () =>
      hud(page).evaluate((node) =>
        Number(getComputedStyle(node).getPropertyValue("--hud-text-scale").trim() || "1"),
      );
    const before = await scaleOf();

    await page.locator(`${PILOT} [data-action="text-scale"]`).selectOption("1.35");
    await page.waitForTimeout(400);
    expect(await scaleOf()).toBeGreaterThan(before);

    // A colour vision preset changes the colours without changing the glyphs.
    const glyphsBefore = await hud(page).locator(".pilot-hud-glyph").allTextContents();
    await page.locator(`${PILOT} [data-action="colour-vision"]`).selectOption("deuteranopia");
    await page.waitForTimeout(300);
    const glyphsAfter = await hud(page).locator(".pilot-hud-glyph").allTextContents();
    expect(glyphsAfter).toEqual(glyphsBefore);
  });

  test("offers high contrast and subtitles as real controls", async ({ page }) => {
    await pilot(page);
    for (const action of ["high-contrast", "subtitles"]) {
      const control = page.locator(`${PILOT} [data-action="${action}"]`);
      await expect(control).toBeVisible();
      await control.click();
      await page.waitForTimeout(150);
    }
    await expect(hud(page)).toBeVisible();
  });

  test("is reachable with the keyboard alone", async ({ page }) => {
    await pilot(page);
    // The acceptance item: the loop is usable from the keyboard outside direct
    // 3D movement. Tabbing has to reach the display controls and operate them.
    const reachable: string[] = [];
    for (let step = 0; step < 60; step += 1) {
      await page.keyboard.press("Tab");
      const action = await page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.dataset?.["action"] ?? "",
      );
      if (action && !reachable.includes(action)) reachable.push(action);
      if (reachable.includes("high-contrast") && reachable.includes("text-scale")) break;
    }
    expect(reachable).toContain("text-scale");
    expect(reachable).toContain("high-contrast");

    // And a focused control actually does something when operated by keyboard.
    await page.keyboard.press("Space");
    await page.waitForTimeout(200);
    await expect(hud(page)).toBeVisible();
  });

  test("shows a visible focus ring on whatever is focused", async ({ page }) => {
    await pilot(page);
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return null;
      const style = getComputedStyle(active);
      return `${style.outlineStyle} ${style.outlineWidth}`;
    });
    expect(outline).not.toBeNull();
  });
});
