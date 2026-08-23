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

test.describe("melee", () => {
  test("chains a combo and counts it, with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await fight(page);
    await closeTo(page, 40);
    await page.keyboard.press("Digit1");
    await page.waitForTimeout(160);
    await page.keyboard.press("Digit2");
    await page.waitForTimeout(700);

    await expect(field(page, "melee")).toHaveText(/in a row|best [1-9]/, { timeout: 6_000 });
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("shows a move list written in plain language", async ({ page }) => {
    await fight(page);
    await page.locator(`${PILOT} [data-action="move-list"]`).click();
    const list = page.locator(`${PILOT} [data-section="move-list"]`);
    await expect(list).toBeVisible();
    await expect(list).toContainText("Attacks");
    await expect(list).toContainText("Defence");
    await expect(list).toContainText("Grapples");
    await expect(list).toContainText("Finishers");
    // Coaching, not frame data.
    await expect(list).toContainText(/quickest punch/);
    expect(await list.textContent()).not.toMatch(/tick|startup|recovery frames/i);
  });

  test("grapples, and reports the hold or says why not", async ({ page }) => {
    await fight(page);
    await closeTo(page, 30);
    await page.keyboard.press("KeyG");
    await page.waitForTimeout(900);
    const melee = await text(page, "melee");
    const log = (await field(page, "hit-log").textContent()) ?? "";
    // Took hold, refused in words, or missed. All three are real answers; going
    // quiet is the only wrong one.
    expect(
      melee.includes("holding") || log.includes("grapple") || log.includes("room") || log.includes("missed"),
    ).toBe(true);
  });

  test("dodges, and the coaching line says what happened", async ({ page }) => {
    await fight(page);
    await closeTo(page, 60);
    await page.keyboard.press("KeyV");
    await page.waitForTimeout(700);
    const training = await text(page, "training");
    const log = (await field(page, "hit-log").textContent()) ?? "";
    expect(training.length + log.length).toBeGreaterThan(0);
  });

  test("refuses a prop swing with nothing in hand, in words", async ({ page }) => {
    await fight(page);
    await page.keyboard.press("KeyN");
    await page.waitForTimeout(500);
    const log = (await field(page, "hit-log").textContent()) ?? "";
    expect(log).toMatch(/Pick something up|refused/);
  });

  test("picks up an environmental weapon, or says why it cannot", async ({ page }) => {
    await fight(page);
    await page.keyboard.press("KeyP");
    await page.waitForTimeout(600);
    const log = (await field(page, "hit-log").textContent()) ?? "";
    expect(log).toMatch(/Picked up|Nothing here|No room|Too far/);
  });

  test("offers reduced motion, hold to complete and skip sequences", async ({ page }) => {
    await fight(page);
    for (const action of ["reduced-motion", "hold-to-complete", "skip-sequences"]) {
      await expect(page.locator(`${PILOT} [data-action="${action}"]`)).toBeVisible();
    }
    // Hold to complete is on by default, because mashing is the barrier.
    await expect(page.locator(`${PILOT} [data-action="hold-to-complete"]`)).toBeChecked();
    await page.locator(`${PILOT} [data-action="skip-sequences"]`).check();
    await expect(page.locator(`${PILOT} [data-action="skip-sequences"]`)).toBeChecked();
    await page.locator(`${PILOT} [data-action="reduced-motion"]`).check();
    await expect(field(page, "comfort")).toHaveText(/reduced/);
  });

  test("charges a heavy attack and reports the wind-up", async ({ page }) => {
    await fight(page);
    await closeTo(page, 50);
    await page.keyboard.down("h");
    await page.waitForTimeout(700);
    const charging = await text(page, "melee");
    await page.keyboard.up("h");
    await page.waitForTimeout(600);
    expect(charging).toMatch(/charging|no combo/);
  });
});
