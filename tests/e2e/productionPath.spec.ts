import { expect, test, type Page } from "@playwright/test";

/**
 * The production path, end to end, at full speed.
 *
 * The dev server is a debug build; `?production=1` makes it behave like the
 * player build: title, dome alert, command, briefing, bay, deployment
 * cinematic, arrival, the approach with its HUD, contact, pause, abort,
 * results, return. The fight itself is exercised as far as contact and the
 * first phases; a full victory is a matter of minutes of play and belongs to
 * the manual pass. What this proves is that every screen on the path mounts,
 * every action leads where it says, and nothing errors.
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

async function toTheHud(page: Page): Promise<void> {
  await page.goto(URL);
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "New Game" }).click();
  await expect(page.locator("#shatterdomeScreen")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-field="alert-band"]')).toContainText(/Breach event/, { timeout: 30_000 });
  await page.locator('[data-action="alert-respond"]').click();
  await expect(page.locator('[data-screen="command"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-field="mission-card"]')).toContainText(/breach/i);
  await page.locator('[data-action="brief"]').click();
  await expect(page.locator('[data-screen="briefing"]')).toBeVisible();
  await page.locator('[data-action="bay"]').click();
  await expect(page.locator('[data-screen="bay"]')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="confirm"]').click();
  await expect(page.locator('[data-screen="cinematic"]')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="skip-cinematic"]').click();
  await expect(page.locator('[data-screen="hud"]')).toBeVisible({ timeout: 30_000 });
}

test.describe("the production path", () => {
  test("title to results and back, with no console errors", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = consoleErrors(page);
    await toTheHud(page);

    await expect(page.locator('[data-field="hud-objective"]')).toContainText(/Advance to contact/);
    await expect(page.locator('[data-field="hud-phase"]')).toHaveText(/APPROACH/);
    const enemy = page.locator('[data-field="hud-enemy"]');
    await expect(enemy).toContainText(/\d+ m/);
    const before = Number((await enemy.textContent())?.match(/(\d+) m/)?.[1] ?? "0");

    // Drive at it. The distance falls, and contact opens the fight.
    await page.locator("canvas").click();
    await page.keyboard.down("Shift");
    await page.keyboard.down("w");
    await page.waitForTimeout(12_000);
    await page.keyboard.up("w");
    await page.keyboard.up("Shift");
    const after = Number((await enemy.textContent())?.match(/(\d+) m/)?.[1] ?? "0");
    expect(after).toBeLessThan(before);

    // A swing or two, so the impact path runs.
    for (const key of ["1", "3", "1"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(500);
    }

    // Escape pauses the sortie rather than leaving the machine.
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-screen="overlay"]')).toBeVisible({ timeout: 5_000 });
    // Dispatched: the canvas holds pointer lock after the click that focused it,
    // which is what a real player's Escape releases before they reach the mouse.
    await page.locator('[data-screen="overlay"] [data-action="abort-mission"]').dispatchEvent("click");
    await expect(page.locator('[data-screen="results"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-screen="results"]')).toContainText(/Sortie aborted/);
    expect(await page.locator('[data-field="results-line"]').count()).toBeGreaterThanOrEqual(10);

    await page.locator('[data-action="close-results"]').click();
    await expect(page.locator("#shatterdomeScreen")).toBeVisible({ timeout: 15_000 });
    // The war goes on: the dome raises the next alert.
    await expect(page.locator('[data-field="alert-band"]')).toContainText(/Breach event/, {
      timeout: 30_000,
    });

    expect(errors).toEqual([]);
  });

  test("every screen fits 1366 by 768 without horizontal overflow", async ({ page }) => {
    test.setTimeout(150_000);
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
    await expect(page.getByRole("button", { name: "New Game" })).toBeVisible();
    await fits();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.locator('[data-screen="overlay"]')).toBeVisible();
    await page.locator('[data-action="close-settings"]').click();
    await page.getByRole("button", { name: "Credits" }).click();
    await expect(page.locator('[data-screen="credits"]')).toBeVisible();
    await page.locator('[data-action="close-credits"]').click();
    await page.getByRole("button", { name: "New Game" }).click();
    await expect(page.locator('[data-field="alert-band"]')).toContainText(/Breach event/, {
      timeout: 30_000,
    });
    await page.locator('[data-action="alert-respond"]').click();
    await expect(page.locator('[data-screen="command"]')).toBeVisible({ timeout: 15_000 });
    await fits();
    await page.locator('[data-action="brief"]').click();
    await expect(page.locator('[data-action="deploy"]')).toBeVisible();
    await fits();
    await page.locator('[data-action="bay"]').click();
    await expect(page.locator('[data-action="confirm"]')).toBeVisible({ timeout: 10_000 });
    await fits();
    expect(errors).toEqual([]);
  });
});
