import { expect, test, type Page } from "@playwright/test";

const WORLD = "#worldScreen";
const PILOT = "#pilotScreen";

function field(page: Page, name: string) {
  return page.locator(`${PILOT} [data-field="${name}"]`);
}

async function text(page: Page, name: string): Promise<string> {
  return (await field(page, name).textContent()) ?? "";
}

async function fight(page: Page, query = "?seed=20260824"): Promise<void> {
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
  await page.locator(`${PILOT} [data-action="spawn-target"]`).click();
  await expect(page.locator(`${PILOT} [data-section="combat"]`)).toBeVisible({ timeout: 10_000 });
}

/** Walks forward until the target is inside the given distance, or gives up. */
async function closeTo(page: Page, meters: number): Promise<number> {
  await page.keyboard.down("w");
  let distance = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await page.waitForTimeout(250);
    const match = /(\d+) m/.exec(await text(page, "target"));
    distance = match ? Number(match[1]) : distance;
    if (distance <= meters) break;
  }
  await page.keyboard.up("w");
  return distance;
}

test.describe("combat", () => {
  test("spawns a target and reports its zones, with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await fight(page);
    await expect(field(page, "target")).toHaveText(/Alpha Biped, \d+ m/);
    // Every zone the creature has, with the health it actually has.
    await expect(field(page, "target-zones")).toHaveText(/head 100%/);
    await expect(field(page, "target-zones")).toHaveText(/core 100%/);
    await expect(field(page, "resources")).toHaveText(/stamina \d+\/\d+/);
    await expect(field(page, "move")).toHaveText(/ready/);
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("throws an attack, connects, and logs which volume hit which zone", async ({ page }) => {
    await fight(page);
    const distance = await closeTo(page, 40);
    expect(distance).toBeLessThan(60);

    // Jab, cross, heavy: the cross is inside the jab's cancel window.
    await page.keyboard.press("Digit1");
    await page.waitForTimeout(120);
    await page.keyboard.press("Digit2");
    await page.waitForTimeout(400);
    await page.keyboard.press("Digit3");
    await page.waitForTimeout(1_500);

    const log = await field(page, "hit-log").textContent();
    expect(log ?? "").toMatch(/melee\./);
    expect(log ?? "").toMatch(/dmg/);
    // Something took damage, so a zone is no longer at full health.
    await expect(field(page, "target-zones")).not.toHaveText(/head 100%.*torso 100%.*core 100%/);
  });

  test("spends stamina and heat on an attack", async ({ page }) => {
    await fight(page);
    await closeTo(page, 60);
    const before = await text(page, "resources");
    await page.keyboard.press("Digit3");
    await page.waitForTimeout(500);
    expect(await text(page, "resources")).not.toBe(before);
    expect(await text(page, "resources")).toMatch(/heat [1-9]/);
  });

  test("refuses a finisher against a healthy target and says why", async ({ page }) => {
    await fight(page);
    await closeTo(page, 60);
    await page.keyboard.press("Digit6");
    await page.waitForTimeout(400);
    const log = await field(page, "hit-log").textContent();
    expect(log ?? "").toMatch(/refused/);
    expect(log ?? "").toMatch(/already finished|stamina|temperature/);
  });

  test("cycles aim through the creature's own body zones", async ({ page }) => {
    await fight(page);
    await page.keyboard.press("KeyR");
    await page.waitForTimeout(300);
    await expect(field(page, "target")).toHaveText(/aiming/);
    const first = await text(page, "target");
    await page.keyboard.press("KeyR");
    await page.waitForTimeout(300);
    expect(await text(page, "target")).not.toBe(first);
  });

  test("shows the hit debug view on request", async ({ page }) => {
    await fight(page);
    await page.locator(`${PILOT} [data-action="debug-volumes"]`).check();
    await page.waitForTimeout(400);
    await expect(page.locator(`${PILOT} [data-action="debug-volumes"]`)).toBeChecked();
    // Still drawing, and still no errors from turning it on.
    await expect(field(page, "target")).toHaveText(/Alpha Biped/);
  });

  test("clears the target and leaves the machine drivable", async ({ page }) => {
    await fight(page);
    await page.locator(`${PILOT} [data-action="clear-target"]`).click();
    await expect(page.locator(`${PILOT} [data-section="combat"]`)).toBeHidden();
    await page.keyboard.down("w");
    await page.waitForTimeout(1_200);
    await page.keyboard.up("w");
    const speed = /([\d.]+) of/.exec(await text(page, "speed"));
    expect(Number(speed?.[1] ?? 0)).toBeGreaterThan(0.5);
  });
});
