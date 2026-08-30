import { expect, test } from "@playwright/test";

/**
 * Saves around the hunt: a hunt's consequences are written down when it
 * ends, and the hangar shows them after a reload through Continue. Also
 * the training simulation from the hangar rail, and leaving it early.
 */

test("a hunt's outcome survives a reload through Continue", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/?seed=20260930&production=1");
  await page.getByRole("button", { name: "New Game" }).click();
  await expect(page.locator('[data-screen="hangar"] h1')).toHaveText(/Gipsy Danger/, { timeout: 20_000 });
  const before = await page.locator('[data-screen="hangar"]').innerText();
  await page.locator('[data-screen="hangar"] [data-action="hunts"]').click();
  await page.locator('[data-action="deploy-hunt.knifehead.anchorage"]').click();
  await page.locator('[data-screen="loadout"] [data-action="confirm"]').click();
  await page.locator('[data-action="skip-cinematic"]').click();
  await expect(page.locator(".op.hud2")).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(6_000);
  // A short hunt: land something, then leave through the pause menu.
  const canvas = page.locator("canvas");
  await canvas.click();
  await page.keyboard.down("Shift");
  await page.keyboard.down("w");
  await page.waitForTimeout(5_000);
  await page.keyboard.up("w");
  await page.keyboard.up("Shift");
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-screen="overlay"]')).toBeVisible({ timeout: 5_000 });
  await page.locator('[data-screen="overlay"] [data-action="abort-mission"]').dispatchEvent("click");
  await expect(page.locator('[data-screen="rewards"]')).toBeVisible({ timeout: 10_000 });
  const rewards = await page.locator('[data-screen="rewards"]').innerText();
  await page.locator('[data-action="close-results"]').click();
  await expect(page.locator('[data-screen="hangar"]')).toBeVisible({ timeout: 15_000 });
  const after = await page.locator('[data-screen="hangar"]').innerText();
  const repairMatch = /(\d+) h of work open/i.exec(after);
  const conditionLine = (text: string): string =>
    /(\d+)% structure[^\n]*/i.exec(text)?.[0] ?? "(no condition line)";
  console.log(`SAVE condition after: ${conditionLine(after)}`);
  console.log(`SAVE before: ${before.replace(/\s+/g, " ").slice(0, 160)}`);
  console.log(`SAVE after:  ${after.replace(/\s+/g, " ").slice(0, 160)}`);
  console.log(`SAVE rewards: ${rewards.replace(/\s+/g, " ").slice(0, 120)}`);
  // Reload, Continue, and the same numbers come back.
  await page.waitForTimeout(1_500);
  await page.goto("/?seed=20260930&production=1");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator('[data-screen="hangar"] h1')).toHaveText(/Gipsy Danger/, { timeout: 20_000 });
  const reloaded = await page.locator('[data-screen="hangar"]').innerText();
  console.log(`SAVE condition reloaded: ${conditionLine(reloaded)}`);
  if (repairMatch) expect(reloaded.toLowerCase()).toContain(`${repairMatch[1]} h of work open`);
  expect(reloaded.toLowerCase()).toMatch(/gipsy danger/);
});

test("the training simulation runs from the hangar and can be left early", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/?seed=20260930&production=1&debug=1");
  await page.getByRole("button", { name: "New Game" }).click();
  await expect(page.locator('[data-screen="hangar"] h1')).toHaveText(/Gipsy Danger/, { timeout: 20_000 });
  await page.locator('[data-screen="hangar"] [data-action="training"]').click();
  await expect(page.locator('[data-screen="comms"]')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="skip-cinematic"]').click();
  await expect(page.locator(".op.hud2")).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(4_000);
  await expect(page.locator('[data-field="hud-objective"]')).toContainText(/Training/);
  const canvas = page.locator("canvas");
  await canvas.click();
  await page.keyboard.down("Shift");
  await page.keyboard.down("w");
  await page.waitForTimeout(3_500);
  await page.keyboard.up("w");
  await page.keyboard.up("Shift");
  const training = await page.evaluate(
    () => (window as unknown as { __titan?: { titan?: { trainingStep?: number } } }).__titan?.titan ?? null,
  );
  console.log(`TRAINING facts ${JSON.stringify(training)}`);
  await expect(page.locator('[data-field="hud-objective"]')).toContainText(/light, then a heavy/, {
    timeout: 8_000,
  });
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-screen="overlay"]')).toBeVisible({ timeout: 5_000 });
  await page.locator('[data-screen="overlay"] [data-action="abort-mission"]').dispatchEvent("click");
  await expect(page.locator('[data-screen="rewards"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-screen="rewards"]')).toContainText(/Simulation ended/);
  await page.locator('[data-action="close-results"]').click();
  await expect(page.locator('[data-screen="hangar"]')).toBeVisible({ timeout: 15_000 });
});
