import { expect, test, type Page } from "@playwright/test";

const PANEL = "#shatterdomeScreen";

function field(page: Page, name: string) {
  return page.locator(`${PANEL} [data-field="${name}"]`);
}

async function text(page: Page, name: string): Promise<string> {
  return (await field(page, name).textContent()) ?? "";
}

async function position(page: Page): Promise<{ x: number; z: number }> {
  const match = /x (-?[\d.]+) z (-?[\d.]+)/.exec(await text(page, "position"));
  return { x: Number(match?.[1] ?? Number.NaN), z: Number(match?.[2] ?? Number.NaN) };
}

async function enterShatterdome(page: Page, query = "?seed=20260824"): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "New Game" }).click();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 15_000 });
  await expect(field(page, "room-name")).toHaveText(/LOCCENT Command/);
}

/**
 * Waits for a door, lift or tram to finish.
 *
 * The prompt shows the travel label while a transition runs, so cycling focus
 * during one reads the transition rather than the fixture and finds nothing.
 */
async function waitForArrival(page: Page): Promise<void> {
  await expect(field(page, "prompt")).not.toHaveText(/(Door|Lift|Tram)\.\.\./, { timeout: 15_000 });
}

/** Cycles the keyboard focus until the prompt names something, or gives up. */
async function focusOn(page: Page, pattern: RegExp, attempts = 14): Promise<boolean> {
  for (let index = 0; index < attempts; index += 1) {
    await page.keyboard.press("Tab");
    if (pattern.test(await text(page, "prompt"))) return true;
  }
  return false;
}

/** Holds a key for a while, the way a player does. */
async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/**
 * Walks forward until the prompt says the target is in reach, or gives up.
 *
 * Polling rather than a fixed hold: the rooms are between twenty and a hundred
 * and thirty metres across, so one duration cannot suit them all, and a test
 * that walks for a fixed time is really testing the frame rate of the runner.
 */
async function walkUntilInReach(page: Page, maxMs = 30_000): Promise<boolean> {
  await page.keyboard.down("w");
  try {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      if (/^E — /.test(await text(page, "prompt"))) return true;
      await page.waitForTimeout(250);
    }
  } finally {
    await page.keyboard.up("w");
  }
  return /^E — /.test(await text(page, "prompt"));
}

test.describe("Shatterdome interior", () => {
  test("opens a real room with live readouts and no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await enterShatterdome(page);

    await expect(field(page, "room-status")).toHaveText(/Deck 2 · operational/);
    await expect(field(page, "staff")).toHaveText(/\d+\/\d+ on shift/);
    await expect(field(page, "power")).toHaveText(/\d+\/\d+ MW/);
    await expect(field(page, "crews")).toHaveText(/\d+\/\d+ crews/);
    // The radio is live from the moment the player is standing there.
    await expect(page.locator(`${PANEL} .sd-radio li`).first()).toBeVisible({ timeout: 10_000 });

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("walks under keyboard control, and runs faster than it walks", async ({ page }) => {
    await enterShatterdome(page);
    const start = await position(page);

    await hold(page, "w", 900);
    const walked = await position(page);
    const walkDistance = Math.hypot(walked.x - start.x, walked.z - start.z);
    expect(walkDistance).toBeGreaterThan(0.5);

    await page.keyboard.down("Shift");
    await hold(page, "w", 900);
    await page.keyboard.up("Shift");
    const ran = await position(page);
    const runDistance = Math.hypot(ran.x - walked.x, ran.z - walked.z);
    expect(runDistance).toBeGreaterThan(walkDistance);
    // And a person walks at person pace: nowhere near a kilometre in a second.
    expect(runDistance).toBeLessThan(40);
  });

  test("cannot walk through the walls of the room", async ({ page }) => {
    await enterShatterdome(page);
    // Command is 34 by 26 metres, so a long run in any direction must stay inside it.
    await page.keyboard.down("Shift");
    await hold(page, "w", 2_500);
    await hold(page, "d", 2_500);
    await page.keyboard.up("Shift");
    const pose = await position(page);
    expect(Math.abs(pose.x)).toBeLessThan(17);
    expect(Math.abs(pose.z)).toBeLessThan(13);
  });

  test("orders a facility at the terminal and the complex reports it", async ({ page }) => {
    await enterShatterdome(page);

    expect(await focusOn(page, /Command console/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await expect(field(page, "prompt")).toHaveText(/E — Use Command console/, { timeout: 10_000 });

    await page.keyboard.press("KeyE");
    const panel = page.locator(`${PANEL} [data-panel="facility"]`);
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-field="panel-summary"]')).toHaveText(/Power \d+ of \d+ MW/);

    const research = panel.locator('[data-facility="research"]');
    await expect(research.locator('[data-field="facility-detail"]')).toHaveText(/absent/);
    await research.locator('[data-action="order"]').click();

    await expect(research.locator('[data-field="facility-detail"]')).toHaveText(/% complete/, {
      timeout: 10_000,
    });
    await expect(page.locator(`${PANEL} .sd-radio`)).toContainText(/Work order accepted/);
  });

  test("greys an order it cannot accept and says which number refused it", async ({ page }) => {
    await enterShatterdome(page);
    expect(await focusOn(page, /Command console/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await page.keyboard.press("KeyE");

    const panel = page.locator(`${PANEL} [data-panel="facility"]`);
    await expect(panel).toBeVisible();

    // Being short of crews queues rather than refuses now, so the refusals that
    // remain are the ones a player cannot solve by waiting: a room that is not
    // built yet, and a reactor that cannot carry the draw. Which of them bites
    // first is a matter of tuning; that the button explains itself is not.
    const containment = panel.locator('[data-facility="kaiju-containment"] [data-action="order"]');
    await expect(containment).toBeDisabled({ timeout: 10_000 });
    await expect(containment).toHaveAttribute("data-refusal", /at tier|MW against/);

    // And an order the complex can actually take is offered rather than greyed.
    await expect(panel.locator('[data-facility="manufacture"] [data-action="order"]')).toBeEnabled();
  });

  test("inspects a machine in the bay after walking there", async ({ page }) => {
    test.slow();
    await enterShatterdome(page);

    // Command to the quarters by lift, the quarters to the bay by tram.
    expect(await focusOn(page, /Lift to Crew Quarters/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await expect(field(page, "prompt")).toHaveText(/E — Enter Lift to Crew Quarters/, {
      timeout: 10_000,
    });
    await page.keyboard.press("KeyE");
    await expect(field(page, "room-name")).toHaveText(/Crew Quarters/, { timeout: 10_000 });
    await waitForArrival(page);

    expect(await focusOn(page, /Tram to Jaeger Bay/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await expect(field(page, "prompt")).toHaveText(/E — Enter Tram to Jaeger Bay/, { timeout: 10_000 });
    await page.keyboard.press("KeyE");
    await expect(field(page, "room-name")).toHaveText(/Jaeger Bay/, { timeout: 10_000 });
    await waitForArrival(page);

    // A berth is inspectable from a few metres out; the bay is 130 m across.
    expect(await focusOn(page, /berth 1/)).toBe(true);
    expect(await walkUntilInReach(page, 60_000)).toBe(true);
    await page.keyboard.press("KeyE");
    const panel = page.locator(`${PANEL} [data-panel="berth"]`);
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.locator('[data-field="berth-jaeger"]')).toHaveText(/Placeholder/);
    await expect(panel.locator('[data-field="berth-asset"]')).toHaveText(/jaeger\..*procedural placeholder/);
  });

  test("explains a sealed bulkhead instead of doing nothing", async ({ page }) => {
    await enterShatterdome(page);
    expect(await focusOn(page, /Sealed bulkhead/)).toBe(true);
    await page.keyboard.press("KeyE");
    await expect(field(page, "prompt")).toHaveText(/has not been built/);
  });

  test("unstuck always puts the player somewhere clear", async ({ page }) => {
    await enterShatterdome(page);
    await page.keyboard.down("Shift");
    await hold(page, "w", 2_000);
    await page.keyboard.up("Shift");
    const stuck = await position(page);

    await page.keyboard.press("KeyU");
    const freed = await position(page);
    expect(Math.hypot(freed.x - stuck.x, freed.z - stuck.z)).toBeGreaterThan(0.5);
    await expect(page.locator(`${PANEL} .sd-radio`)).toContainText(/Position reset/);
  });

  test("pauses the simulation rather than only hiding the view", async ({ page }) => {
    await enterShatterdome(page);
    const tickField = page.locator('#diagnosticsPanel [data-field="tick"]');
    await expect(tickField).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(`${PANEL} .sd-pause`)).toBeVisible();
    const paused = await tickField.textContent();
    await page.waitForTimeout(600);
    expect(await tickField.textContent()).toBe(paused);

    await page.locator(`${PANEL} [data-action="resume"]`).click();
    await expect(page.locator(`${PANEL} .sd-pause`)).toBeHidden();
    await page.waitForTimeout(400);
    expect(await tickField.textContent()).not.toBe(paused);
  });

  test("saves a running build from inside the complex and loads it back", async ({ page }) => {
    test.slow();
    await enterShatterdome(page);

    expect(await focusOn(page, /Command console/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await page.keyboard.press("KeyE");
    const panel = page.locator(`${PANEL} [data-panel="facility"]`);
    await expect(panel).toBeVisible();
    await panel.locator('[data-facility="research"] [data-action="order"]').click();
    await expect(panel.locator('[data-facility="research"] [data-field="facility-detail"]')).toHaveText(
      /% complete/,
    );
    await page.keyboard.press("KeyE");

    await page.keyboard.press("Escape");
    await page.locator(`${PANEL} [data-action="open-saves"]`).click();
    await expect(page.locator("#saveScreen")).toBeVisible({ timeout: 10_000 });
    await page.locator('.screen-saves [data-field="new-name"]').fill("interior build");
    await page.locator('.screen-saves [data-action="save-new"]').click();
    await expect(page.locator(".save-notice")).toContainText(/Saved/, { timeout: 10_000 });

    // A full page reload: nothing in memory survives it.
    await page.reload();
    await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Saves" }).click();
    await expect(page.locator(".screen-saves")).toBeVisible({ timeout: 10_000 });
    await page
      .locator(".save-row", { hasText: "interior build" })
      .getByRole("button", { name: "Load" })
      .click();
    await expect(page.locator(".save-notice")).toContainText(/Loaded/, { timeout: 10_000 });

    await page.locator('.screen-saves [data-action="exit-saves"]').click();
    await page.getByRole("button", { name: "New Game" }).click();
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 15_000 });

    expect(await focusOn(page, /Command console/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await page.keyboard.press("KeyE");
    const reloaded = page.locator(`${PANEL} [data-panel="facility"]`);
    await expect(reloaded).toBeVisible();
    // The build that was running when the save was written is still running.
    await expect(reloaded.locator('[data-facility="research"] [data-field="facility-detail"]')).toHaveText(
      /% complete/,
      { timeout: 10_000 },
    );
  });
});
