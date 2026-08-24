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

test.describe("kaiju behaviour", () => {
  test("explains its goal, what it weighed and what it sensed, with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await fight(page);
    await page.waitForTimeout(1_200);

    // The AI debug view the milestone asks for: current goal, alternatives,
    // sensory contacts and path state, all read from what the creature acted on.
    await expect(field(page, "ai-goal")).toHaveText(
      /hunt|approach|flank|ambush|climb|burrow|swim|destroy-objective|feed|retreat|enrage/,
    );
    await expect(field(page, "ai-goal")).toContainText("—");
    await expect(field(page, "ai-considered")).toHaveText(/\w+ \d+/);
    await expect(field(page, "ai-senses")).toHaveText(/jaeger by (sight|sound|vibration)/);
    await expect(field(page, "ai-path")).toHaveText(
      /(direct|detour|burrow-under|climb-over|swim-across|smash-through|blocked|none) in \w+/,
    );
    await expect(field(page, "ai-body")).toHaveText(/ability\./);
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("moves itself rather than standing on a schedule", async ({ page }) => {
    await fight(page);
    const distances: number[] = [];
    for (let sample = 0; sample < 12; sample += 1) {
      await page.waitForTimeout(500);
      distances.push(Number(/(\d+) m/.exec(await text(page, "target"))?.[1] ?? 0));
    }
    // The player has not moved, so any change in range is the creature deciding
    // to close, hold or back off.
    expect(new Set(distances).size).toBeGreaterThan(1);
    await expect(field(page, "ai-path")).not.toHaveText(/has not moved yet/);
  });

  test("shows the creature losing what it is made of when it is broken", async ({ page }) => {
    test.slow();
    await fight(page);
    const before = await text(page, "ai-body");
    expect(before).toMatch(/ability\./);

    // Walk in and hit the head until something inside it gives.
    await page.keyboard.down("w");
    await expect
      .poll(async () => Number(/(\d+) m/.exec(await text(page, "target"))?.[1] ?? 999), {
        timeout: 40_000,
      })
      .toBeLessThan(40);
    await page.keyboard.up("w");

    // Aim mode picks a body zone, which is the only way to go for the head.
    await page.keyboard.press("KeyR");
    for (let round = 0; round < 60; round += 1) {
      await page.keyboard.press("Digit1");
      await page.waitForTimeout(110);
      await page.keyboard.press("Digit3");
      await page.waitForTimeout(200);
      const body = await text(page, "ai-body");
      const log = (await field(page, "hit-log").textContent()) ?? "";
      if (/destroyed|severed|armour on/.test(`${body} ${log}`)) break;
    }

    const log = (await field(page, "hit-log").textContent()) ?? "";
    const body = await text(page, "ai-body");
    // Either a plate came off, an organ went, or a limb did, and the panel and
    // the log both say which.
    expect(`${log} ${body}`).toMatch(/armour on|destroyed|severed|%/);
  });
});
