import { expect, test, type Page } from "@playwright/test";

const WORLD = "#worldScreen";
const PILOT = "#pilotScreen";
const SHATTERDOME = "#shatterdomeScreen";

function field(page: Page, name: string) {
  return page.locator(`${PILOT} [data-field="${name}"]`);
}

function sdField(page: Page, name: string) {
  return page.locator(`${SHATTERDOME} [data-field="${name}"]`);
}

async function sdText(page: Page, name: string): Promise<string> {
  return (await sdField(page, name).textContent()) ?? "";
}

/** Cycles the keyboard focus until the prompt names something, or gives up. */
async function focusOn(page: Page, pattern: RegExp, attempts = 14): Promise<boolean> {
  for (let index = 0; index < attempts; index += 1) {
    await page.keyboard.press("Tab");
    if (pattern.test(await sdText(page, "prompt"))) return true;
  }
  return false;
}

/** Walks forward until the prompt says the target is in reach. */
async function walkUntilInReach(page: Page, maxMs = 30_000): Promise<boolean> {
  await page.keyboard.down("w");
  try {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      if (/^E — /.test(await sdText(page, "prompt"))) return true;
      await page.waitForTimeout(250);
    }
  } finally {
    await page.keyboard.up("w");
  }
  return /^E — /.test(await sdText(page, "prompt"));
}

/** Waits for a door, lift or tram to finish. */
async function waitForArrival(page: Page): Promise<void> {
  await expect(sdField(page, "prompt")).not.toHaveText(/(Door|Lift|Tram)\.\.\./, { timeout: 15_000 });
}

async function text(page: Page, name: string): Promise<string> {
  return (await field(page, name).textContent()) ?? "";
}

async function pilot(page: Page): Promise<void> {
  await page.goto("/?seed=20260824");
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

test.describe("localized damage", () => {
  test("reports the machine component by component, with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await pilot(page);
    // A fresh machine is whole, and the readout says so in structure rather
    // than in one number pretending to be a machine.
    await expect(field(page, "damage")).toContainText("100% structure");
    await expect(field(page, "systems")).toContainText("all");
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("takes damage on the part that was hit and keeps it after the fight", async ({ page }) => {
    await pilot(page);
    await page.locator(`${PILOT} [data-action="spawn-target"]`).click();
    await expect(page.locator(`${PILOT} [data-section="combat"]`)).toBeVisible({ timeout: 10_000 });

    // Walk straight in: a freshly spawned creature stands in front of the
    // machine, and it swings on a fixed schedule once you are inside its reach.
    await page.keyboard.down("w");
    await expect
      .poll(async () => Number(/(\d+) m/.exec(await text(page, "target"))?.[1] ?? 999), {
        timeout: 40_000,
      })
      .toBeLessThan(40);
    await page.keyboard.up("w");

    await expect
      .poll(async () => Number(/(\d+)% structure/.exec(await text(page, "damage"))?.[1] ?? 100), {
        timeout: 90_000,
      })
      .toBeLessThan(100);

    const duringFight = await text(page, "damage");
    // Named components, not a hull bar.
    expect(duringFight).toMatch(/Torso|Left leg|Right leg|Right arm|Left arm|Conn-Pod|Sensor mast/);

    await page.locator(`${PILOT} [data-action="clear-target"]`).click();
    await page.waitForTimeout(600);
    // The damage outlives the fight it happened in.
    const afterFight = Number(/(\d+)% structure/.exec(await text(page, "damage"))?.[1] ?? 100);
    expect(afterFight).toBeLessThan(100);
  });

  test("shows the repair board on the berth after walking to the bay", async ({ page }) => {
    test.slow();
    await page.goto("/?seed=20260824");
    await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "New Game" }).click();
    await expect(page.locator(SHATTERDOME)).toBeVisible({ timeout: 15_000 });
    await expect(sdField(page, "room-name")).toHaveText(/LOCCENT Command/);

    // Command to the quarters by lift, the quarters to the bay by tram, the same
    // walk a player makes.
    expect(await focusOn(page, /Lift to Crew Quarters/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await page.keyboard.press("KeyE");
    await expect(sdField(page, "room-name")).toHaveText(/Crew Quarters/, { timeout: 10_000 });
    await waitForArrival(page);

    expect(await focusOn(page, /Tram to Jaeger Bay/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await page.keyboard.press("KeyE");
    await expect(sdField(page, "room-name")).toHaveText(/Jaeger Bay/, { timeout: 10_000 });
    await waitForArrival(page);

    expect(await focusOn(page, /berth 1/)).toBe(true);
    expect(await walkUntilInReach(page, 60_000)).toBe(true);
    await page.keyboard.press("KeyE");

    const panel = page.locator(`${SHATTERDOME} [data-panel="berth"]`);
    await expect(panel).toBeVisible({ timeout: 10_000 });
    // The repair board reports the machine component by component, and says
    // plainly when there is nothing to do rather than showing an empty form.
    await expect(panel.locator('[data-field="berth-status"]')).toHaveText(/ready · 100% structure/);
    await expect(panel.locator('[data-field="berth-components"]')).toHaveText(/Conn-Pod 100% intact/);
    await expect(panel.locator('[data-field="berth-offline"]')).toHaveText(/all systems answering/);
    await expect(panel.locator('[data-field="berth-work"]')).toHaveText(/Nothing on the board/);
    // Nothing to repair means the button is there and honestly disabled.
    await expect(panel.locator('[data-action="repair"]')).toBeDisabled();
  });

  test("a damaged machine comes back to the bay with a work order that shrinks", async ({ page }) => {
    test.slow();
    await pilot(page);
    await page.locator(`${PILOT} [data-action="spawn-target"]`).click();
    await expect(page.locator(`${PILOT} [data-section="combat"]`)).toBeVisible({ timeout: 10_000 });

    await page.keyboard.down("w");
    await expect
      .poll(async () => Number(/(\d+) m/.exec(await text(page, "target"))?.[1] ?? 999), {
        timeout: 40_000,
      })
      .toBeLessThan(40);
    await page.keyboard.up("w");
    await expect
      .poll(async () => Number(/(\d+)% structure/.exec(await text(page, "damage"))?.[1] ?? 100), {
        timeout: 90_000,
      })
      .toBeLessThan(100);
    await page.locator(`${PILOT} [data-action="clear-target"]`).click();
    await page.waitForTimeout(500);

    // Walk the same machine's berth, in the same session, and the damage is
    // waiting there as a priced job rather than having quietly reset.
    await page.getByRole("button", { name: "Back to Menu" }).click();
    await page.getByRole("button", { name: "New Game" }).click();
    await expect(page.locator(SHATTERDOME)).toBeVisible({ timeout: 15_000 });
    await expect(sdField(page, "room-name")).toHaveText(/LOCCENT Command/);

    expect(await focusOn(page, /Lift to Crew Quarters/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await page.keyboard.press("KeyE");
    await expect(sdField(page, "room-name")).toHaveText(/Crew Quarters/, { timeout: 10_000 });
    await waitForArrival(page);
    expect(await focusOn(page, /Tram to Jaeger Bay/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await page.keyboard.press("KeyE");
    await expect(sdField(page, "room-name")).toHaveText(/Jaeger Bay/, { timeout: 10_000 });
    await waitForArrival(page);
    expect(await focusOn(page, /berth 1/)).toBe(true);
    expect(await walkUntilInReach(page, 60_000)).toBe(true);
    await page.keyboard.press("KeyE");

    const panel = page.locator(`${SHATTERDOME} [data-panel="berth"]`);
    await expect(panel).toBeVisible({ timeout: 10_000 });
    // The machine is in the gantries with a real bill and real hours.
    await expect(panel.locator('[data-field="berth-status"]')).toHaveText(/repair|rebuil|recover/i);
    await expect(panel.locator('[data-field="berth-work"]')).toHaveText(/hours/);
    const before = (await panel.locator('[data-field="berth-work"]').textContent()) ?? "";
    const hours = Number(/([\d.]+) hours/.exec(before)?.[1] ?? 0);
    expect(hours).toBeGreaterThan(0);

    // A shift of work is a real shift: the outstanding job gets smaller.
    const repair = panel.locator('[data-action="repair"]');
    await expect(repair).toBeEnabled();
    await repair.click();
    await page.waitForTimeout(400);
    const after = (await panel.locator('[data-field="berth-work"]').textContent()) ?? "";
    const hoursLeft = Number(/([\d.]+) hours/.exec(after)?.[1] ?? 0);
    expect(after === "Nothing on the board." || hoursLeft < hours).toBe(true);
  });
});
