import { expect, test, type Page } from "@playwright/test";

/**
 * The hunt loop, end to end, at full speed.
 *
 * The dev server is a debug build; `?production=1` makes it behave like the
 * player build: title, hangar, hunt board, loadout, comms, arrival, the
 * fight with its action HUD, pause, abort, rewards, back to the hangar. It
 * also measures the two gates the loop is built around: a controllable
 * machine within twenty seconds of launch and combat within sixty.
 */

const URL = "/?seed=20260930&production=1";

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.describe("the hunt loop", () => {
  test("title to rewards and back, inside the time gates, with no console errors", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = consoleErrors(page);
    const launchedAt = Date.now();
    await page.goto(URL);
    await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "New Game" }).click();
    await expect(page.locator('[data-screen="hangar"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-screen="hangar"] h1')).toHaveText(/Gipsy Danger/);
    const hangarAt = Date.now();
    expect(hangarAt - launchedAt).toBeLessThan(20_000);

    await page.locator('[data-screen="hangar"] [data-action="hunts"]').click();
    await expect(page.locator('[data-screen="hunts"]')).toBeVisible();
    await expect(page.locator('[data-hunt="hunt.knifehead.anchorage"]')).toContainText(/Knifehead/);
    await page.locator('[data-action="deploy-hunt.knifehead.anchorage"]').click();
    await expect(page.locator('[data-screen="loadout"]')).toBeVisible();
    await expect(page.locator('[data-screen="loadout"]')).toContainText(/Plasma Caster/);
    await page.locator('[data-screen="loadout"] [data-action="confirm"]').click();
    await expect(page.locator('[data-screen="comms"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-field="caption"]')).toContainText(/Pentecost|LOCCENT|Becket/, {
      timeout: 5_000,
    });
    await page.locator('[data-action="skip-cinematic"]').click();
    await expect(page.locator('[data-screen="hud"] .hud2, .op.hud2')).toBeVisible({ timeout: 30_000 });
    const hudAt = Date.now();
    expect(hudAt - launchedAt).toBeLessThan(60_000);

    await expect(page.locator('[data-field="hud-enemy"]')).toContainText(/Knifehead/i);
    expect(await page.locator('[data-field="hud-abilities"] .ability').count()).toBe(4);
    await expect(page.locator('[data-field="hud-objective"]')).not.toBeEmpty();

    // Close in and swing: the chain on the left button, the heavy on the right.
    const canvas = page.locator("canvas");
    await canvas.click();
    await page.keyboard.down("Shift");
    await page.keyboard.down("w");
    await page.waitForTimeout(6_000);
    await page.keyboard.up("w");
    await page.keyboard.up("Shift");
    for (let swing = 0; swing < 4; swing += 1) {
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(350);
    }
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    await page.keyboard.press("q");
    await page.keyboard.press("1");
    await page.waitForTimeout(600);

    await page.keyboard.press("Escape");
    await expect(page.locator('[data-screen="overlay"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-screen="overlay"] [data-action="abort-mission"]').dispatchEvent("click");
    await expect(page.locator('[data-screen="rewards"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-screen="rewards"]')).toContainText(/Hunt aborted/);
    expect(await page.locator('[data-field="results-line"]').count()).toBeGreaterThanOrEqual(8);
    await page.locator('[data-action="close-results"]').click();
    await expect(page.locator('[data-screen="hangar"]')).toBeVisible({ timeout: 15_000 });

    expect(errors).toEqual([]);
  });

  test("hangar, hunts and loadout fit 1366 by 768", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    const errors = consoleErrors(page);
    await page.goto(URL);
    await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
      timeout: 15_000,
    });
    const fits = async (): Promise<void> => {
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width).toBeLessThanOrEqual(1366);
    };
    await page.getByRole("button", { name: "New Game" }).click();
    await expect(page.locator('[data-screen="hangar"]')).toBeVisible({ timeout: 15_000 });
    await fits();
    await page.locator('[data-screen="hangar"] [data-action="hunts"]').click();
    await expect(page.locator('[data-screen="hunts"]')).toBeVisible();
    await fits();
    await page.locator('[data-action="deploy-hunt.knifehead.anchorage"]').click();
    await expect(page.locator('[data-screen="loadout"] [data-action="confirm"]')).toBeVisible();
    await fits();
    await page.locator('[data-screen="loadout"] [data-action="back"]').click();
    await page.locator('[data-screen="hunts"] [data-action="back"]').click();
    await expect(page.locator('[data-screen="hangar"]')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
