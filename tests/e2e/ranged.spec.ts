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

/** Walks forward until the target is inside the given distance. */
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

test.describe("ranged", () => {
  test("carries weapons and shows ammunition, with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await fight(page);
    // Every carried weapon reports its own state, not one shared bar.
    await expect(field(page, "weapons")).toContainText("Plasma");
    await expect(field(page, "weapons")).toContainText(/ready|cooling/);
    await expect(field(page, "rounds")).toContainText("in the air");
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("fires the plasma caster and the shot is accounted for", async ({ page }) => {
    await fight(page);
    await closeTo(page, 400);
    const before = await text(page, "weapons");
    await page.keyboard.press("Digit7");
    await page.waitForTimeout(700);
    const log = (await field(page, "hit-log").textContent()) ?? "";
    const after = await text(page, "weapons");
    // Fired, or refused in a sentence. Silence is the only wrong answer.
    expect(log.length > 0 || after !== before).toBe(true);
  });

  test("refuses a mortar at point-blank range, in words", async ({ page }) => {
    await fight(page);
    await closeTo(page, 40);
    await page.keyboard.press("Digit9");
    await page.waitForTimeout(500);
    const log = (await field(page, "hit-log").textContent()) ?? "";
    const training = await text(page, "training");
    expect(`${log} ${training}`).toMatch(/close|arc|range|refused/i);
  });

  test("puts rounds in the air and they clear again", async ({ page }) => {
    await fight(page);
    await closeTo(page, 500);
    let sawRounds = 0;
    for (const key of ["Digit8", "Digit0", "Digit8", "Digit0"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(90);
      sawRounds = Math.max(sawRounds, Number(/(\d+)\//.exec(await text(page, "rounds"))?.[1] ?? 0));
    }
    const capacity = Number(/\d+\/(\d+) in the air/.exec(await text(page, "rounds"))?.[1] ?? 0);
    expect(capacity).toBeGreaterThan(0);
    // Something was actually fired, rather than the readout sitting at zero.
    expect(sawRounds).toBeGreaterThan(0);
    // Nothing stays in the air forever: the sky settles once firing stops.
    await expect
      .poll(async () => Number(/(\d+)\//.exec(await text(page, "rounds"))?.[1] ?? -1), {
        timeout: 20_000,
      })
      .toBe(0);
  });

  test("reload answers, whether or not anything needs it", async ({ page }) => {
    await fight(page);
    await page.keyboard.press("KeyL");
    await page.waitForTimeout(500);
    const log = (await field(page, "hit-log").textContent()) ?? "";
    expect(log).toMatch(/Reloading|Nothing needs reloading/i);
  });

  test("holds the chain sword and lets go of it", async ({ page }) => {
    await fight(page);
    await closeTo(page, 30);
    await page.keyboard.down("k");
    await page.waitForTimeout(600);
    const during = await text(page, "weapons");
    await page.keyboard.up("k");
    await page.waitForTimeout(500);
    // A channel that never stops is a channel that cooks the reactor, so what
    // matters is that letting go actually ends it.
    expect(during).toMatch(/Chain sword: heat fed, (running|ready|cooling)/);
    await expect(field(page, "weapons")).not.toContainText("Chain sword: heat fed, running");
  });

  test("lists the ranged row in the controls hint", async ({ page }) => {
    await fight(page);
    const hint = page.locator(`${PILOT} .pilot-hint`);
    await expect(hint).toContainText("Ranged:");
    await expect(hint).toContainText("reload");
  });
});
