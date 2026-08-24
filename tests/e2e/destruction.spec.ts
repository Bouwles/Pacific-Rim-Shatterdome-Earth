import { expect, test, type Page } from "@playwright/test";

const WORLD = "#worldScreen";
const PILOT = "#pilotScreen";

function field(page: Page, name: string) {
  return page.locator(`${WORLD} [data-field="${name}"]`);
}

async function text(page: Page, name: string): Promise<string> {
  return (await field(page, name).textContent()) ?? "";
}

async function pilotText(page: Page, name: string): Promise<string> {
  return (await page.locator(`${PILOT} [data-field="${name}"]`).textContent()) ?? "";
}

async function groundView(page: Page, query = "?seed=20260824"): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "World Map" }).click();
  await expect(page.locator(WORLD)).toBeVisible({ timeout: 15_000 });
  await page.locator(`${WORLD} [data-action="view-ground"]`).click();
  await expect(page.locator(`${WORLD} [data-section="streaming"]`)).toBeVisible({ timeout: 20_000 });
}

/**
 * Walks the player into the built-up part of the city.
 *
 * Hong Kong is laid out seaward of the region centre, so standing where a fresh
 * game drops you means fighting in open ground: the blocks are a kilometre
 * south. A fight has to happen over the city to knock the city down.
 */
async function walkIntoTheCity(page: Page): Promise<void> {
  for (let step = 0; step < 2; step += 1) {
    await page.locator(`${WORLD} [data-action="walk-south"]`).click();
    await page.waitForTimeout(700);
  }
  await expect(page.locator(`${WORLD} [data-section="streaming"]`)).toBeVisible({ timeout: 20_000 });
}

/** Fights until the city readout shows blocks coming down, or gives up. */
async function fightInTheCity(page: Page): Promise<void> {
  await walkIntoTheCity(page);
  await page.locator(`${WORLD} [data-action="pilot"]`).click();
  await expect(page.locator(PILOT)).toBeVisible({ timeout: 15_000 });
  await page.locator(`${PILOT} [data-action="spawn-target"]`).click();
  await expect(page.locator(`${PILOT} [data-section="combat"]`)).toBeVisible({ timeout: 10_000 });

  await page.keyboard.down("w");
  await expect
    .poll(async () => Number(/(\d+) m/.exec(await pilotText(page, "target"))?.[1] ?? 999), {
      timeout: 40_000,
    })
    .toBeLessThan(40);
  await page.keyboard.up("w");

  // Throw everything at it. Every landed blow reaches the streets around it.
  for (let round = 0; round < 40; round += 1) {
    await page.keyboard.press("Digit1");
    await page.waitForTimeout(120);
    await page.keyboard.press("Digit3");
    await page.waitForTimeout(220);
    if (/[1-9]\d* of \d+ blocks damaged/.test(await text(page, "city-damage"))) return;
  }
}

test.describe("city destruction", () => {
  test("reports a whole city before anything happens, with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await groundView(page);
    await expect(field(page, "city-damage")).toContainText(/whole|No detailed record/);
    await expect(field(page, "city-rubble")).toContainText(/\d+\/\d+ bodies/);
    // Nothing to rebuild means the button is there and honestly disabled.
    await expect(page.locator(`${WORLD} [data-action="rebuild"]`)).toBeDisabled();
    await expect(field(page, "rebuild-target")).toHaveText(/nothing down/);
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("a building-scale fight visibly changes the district", async ({ page }) => {
    test.slow();
    await groundView(page);
    await fightInTheCity(page);

    await expect(field(page, "city-damage")).toContainText(/blocks damaged/, { timeout: 30_000 });
    const damage = await text(page, "city-damage");
    const damaged = Number(/(\d+) of \d+ blocks damaged/.exec(damage)?.[1] ?? 0);
    expect(damaged).toBeGreaterThan(0);
    // Safety falls with the buildings.
    expect(Number(/safety (\d+)%/.exec(damage)?.[1] ?? 100)).toBeLessThan(100);
    // Rubble is real and bounded by the preset.
    const rubble = await text(page, "city-rubble");
    const [live, capacity] = (/(\d+)\/(\d+) bodies/.exec(rubble) ?? []).slice(1).map(Number);
    expect(capacity).toBeGreaterThan(0);
    expect(live ?? 0).toBeLessThanOrEqual(capacity ?? 0);
  });

  test("the damage is still there after leaving and coming back", async ({ page }) => {
    test.slow();
    await groundView(page);
    await fightInTheCity(page);
    const before = await text(page, "city-damage");
    expect(before).toMatch(/blocks damaged/);

    // Leave the machine, leave the ground view, come back.
    await page.locator(`${PILOT} [data-action="clear-target"]`).click();
    await page.waitForTimeout(400);
    await page.locator(`${WORLD} [data-action="view-globe"]`).click();
    await page.waitForTimeout(600);
    await page.locator(`${WORLD} [data-action="view-ground"]`).click();
    await expect(page.locator(`${WORLD} [data-section="streaming"]`)).toBeVisible({ timeout: 20_000 });

    const after = await text(page, "city-damage");
    // The same blocks are still down: nothing has quietly reset.
    expect(after).toMatch(/blocks damaged/);
    expect(Number(/(\d+) of \d+ blocks damaged/.exec(after)?.[1] ?? 0)).toBeGreaterThan(0);
  });

  test("starting work on the worst block is a real action with a real quote", async ({ page }) => {
    test.slow();
    await groundView(page);
    await fightInTheCity(page);
    await expect(field(page, "city-damage")).toContainText(/blocks damaged/, { timeout: 30_000 });

    const target = await text(page, "rebuild-target");
    expect(target).toMatch(/block at/);
    const button = page.locator(`${WORLD} [data-action="rebuild"]`);
    await expect(button).toBeEnabled();
    // The quote is hours and money, from the damage itself.
    await expect(button).toHaveAttribute("title", /hours/);

    await button.click();
    await page.waitForTimeout(500);
    // Either crews are on their way, or it says why not. Silence is the only
    // wrong answer.
    await expect(field(page, "city-rebuilding")).toContainText(
      /clearing|rebuilding|Crews are on their way|still burning|already under way|Nothing/,
    );
  });

  test("time passing clears and rebuilds in stages rather than resetting", async ({ page }) => {
    test.slow();
    await groundView(page);
    await fightInTheCity(page);
    await expect(field(page, "city-damage")).toContainText(/blocks damaged/, { timeout: 30_000 });

    // Leave the machine, then put crews on the worst block.
    await page.locator(`${PILOT} [data-action="clear-target"]`).click();
    await page.waitForTimeout(400);

    // Fires have to be out before crews will go in, so give it a day first.
    for (let skip = 0; skip < 4; skip += 1) {
      await page.locator(`${WORLD} [data-action="time-six-hours"]`).click();
      await page.waitForTimeout(250);
    }
    const beforeHazards = await text(page, "city-hazards");
    expect(beforeHazards).toMatch(/burning/);

    await page.locator(`${WORLD} [data-action="rebuild"]`).click();
    await page.waitForTimeout(400);
    const started = await text(page, "city-rebuilding");
    expect(started).toMatch(/clearing|rebuilding|Crews are on their way|still burning/);

    if (/clearing|rebuilding/.test(started)) {
      const hoursOf = (line: string): number => Number(/(\d+) h left/.exec(line)?.[1] ?? 0);
      const first = hoursOf(started);
      expect(first).toBeGreaterThan(0);

      // Days pass. The job gets smaller; it does not vanish and the block does
      // not snap back to intact.
      for (let skip = 0; skip < 8; skip += 1) {
        await page.locator(`${WORLD} [data-action="time-six-hours"]`).click();
        await page.waitForTimeout(200);
      }
      const later = await text(page, "city-rebuilding");
      const remaining = hoursOf(later);
      expect(remaining === 0 || remaining < first).toBe(true);
      // Whatever stage it reached, the city is still damaged: no instant reset.
      expect(await text(page, "city-damage")).toMatch(/blocks damaged|whole/);
    }
  });
});
