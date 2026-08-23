import { expect, test, type Page } from "@playwright/test";

const WORLD = "#worldScreen";
const PILOT = "#pilotScreen";

function field(page: Page, name: string) {
  return page.locator(`${PILOT} [data-field="${name}"]`);
}

async function text(page: Page, name: string): Promise<string> {
  return (await field(page, name).textContent()) ?? "";
}

async function number(page: Page, name: string, pattern: RegExp): Promise<number> {
  const match = pattern.exec(await text(page, name));
  if (!match) return Number.NaN;
  return Number((match[1] ?? match[0]).replace(/,/g, ""));
}

/** Holds a key for a while, the way a player does, rather than tapping it. */
async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

async function takeTheMachineOut(page: Page, query = "?seed=20260824"): Promise<void> {
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
}

test.describe("piloting a Jaeger", () => {
  test("takes a machine out and drives it, with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await takeTheMachineOut(page);
    await expect(field(page, "machine")).toHaveText(/Mk-/);
    await expect(field(page, "state")).toHaveText(/idle/);

    await hold(page, "w", 2_500);
    const speed = await number(page, "speed", /([\d.]+) of/);
    expect(speed).toBeGreaterThan(1);
    await expect(field(page, "state")).toHaveText(/walk|run|start|stop/);

    // Stride phase advances because the machine covered ground, which is the
    // contract that keeps the feet from skating.
    await expect(field(page, "stride")).toHaveText(/\d+% through stride/);
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("runs faster than it walks, and stops under its own momentum", async ({ page }) => {
    await takeTheMachineOut(page);
    await hold(page, "w", 2_000);
    const walking = await number(page, "speed", /([\d.]+) of/);

    await page.keyboard.down("Shift");
    await hold(page, "w", 3_000);
    await page.keyboard.up("Shift");
    const running = await number(page, "speed", /([\d.]+) of/);
    expect(running).toBeGreaterThan(walking);

    // Released, and still moving: this is mass, not lag.
    await page.waitForTimeout(250);
    const coasting = await number(page, "speed", /([\d.]+) of/);
    expect(coasting).toBeGreaterThan(0.5);
    await page.waitForTimeout(4_000);
    expect(await number(page, "speed", /([\d.]+) of/)).toBeLessThan(1);
  });

  test("turns the body toward the camera rather than snapping to it", async ({ page }) => {
    await takeTheMachineOut(page);
    // Look hard right with the keyboard, then push forward for a moment only.
    await hold(page, "ArrowRight", 900);
    await hold(page, "w", 300);
    const lag = await number(page, "heading", /(\d+)° lag/);
    // The body is still catching up: an instant snap would read as zero.
    expect(lag).toBeGreaterThan(3);

    await hold(page, "w", 4_000);
    const settled = await number(page, "heading", /(\d+)° lag/);
    expect(settled).toBeLessThan(lag);
  });

  test("switches camera without losing heading, lock or comfort", async ({ page }) => {
    await takeTheMachineOut(page);
    await hold(page, "ArrowRight", 700);
    await page.locator(`${PILOT} [data-action="lock-toggle"]`).click();
    await page.locator(`${PILOT} [data-action="reduced-motion"]`).check();
    const before = await text(page, "heading");
    const lookBefore = Number(/(\d+)° look/.exec(before)?.[1] ?? "0");

    await page.locator(`${PILOT} [data-action="camera-cockpit"]`).click();
    await expect(field(page, "camera")).toHaveText(/Conn-Pod/);
    const lookAfter = Number(/(\d+)° look/.exec(await text(page, "heading"))?.[1] ?? "-1");
    expect(Math.abs(lookAfter - lookBefore)).toBeLessThan(6);
    await expect(field(page, "camera")).toHaveText(/locked on/);
    await expect(field(page, "comfort")).toHaveText(/reduced/);

    // And the controls still drive the machine from inside the head.
    await hold(page, "w", 1_500);
    expect(await number(page, "speed", /([\d.]+) of/)).toBeGreaterThan(0.5);
  });

  test("reports scale references and footprints rather than only shaking the camera", async ({ page }) => {
    await takeTheMachineOut(page);
    await page.keyboard.down("Shift");
    await hold(page, "w", 4_000);
    await page.keyboard.up("Shift");
    const refs = await number(page, "scale", /(\d+) refs/);
    const prints = await number(page, "scale", /(\d+)\/\d+ prints/);
    expect(refs).toBeGreaterThan(8);
    expect(prints).toBeGreaterThan(0);
    await expect(field(page, "scale")).toHaveText(/sound \+\d+\.\d+ s/);
  });

  test("buffers a booster press and spends the charge", async ({ page }) => {
    await takeTheMachineOut(page);
    await expect(field(page, "booster")).toHaveText(/100% charged/);
    await page.keyboard.press("Space");
    await page.waitForTimeout(600);
    expect(await number(page, "booster", /(\d+)% charged/)).toBeLessThan(100);
  });

  test("swaps machines from the roster and takes the new profile", async ({ page }) => {
    await takeTheMachineOut(page);
    await page.locator(`${PILOT} [data-field="roster"]`).selectOption("heavy-mk4");
    await expect(field(page, "machine")).toHaveText(/Bulwark/);
    const heavyCeiling = await number(page, "speed", /of (\d+) m\/s/);
    await page.locator(`${PILOT} [data-field="roster"]`).selectOption("agile-mk5");
    await expect(field(page, "machine")).toHaveText(/Harrier/);
    expect(await number(page, "speed", /of (\d+) m\/s/)).toBeGreaterThan(heavyCeiling);
  });

  test("leaves the machine and returns the world view intact", async ({ page }) => {
    await takeTheMachineOut(page);
    await page.locator(`${PILOT} [data-action="exit-pilot"]`).click();
    await expect(page.locator(PILOT)).toHaveCount(0);
    await expect(page.locator(`${WORLD} [data-section="streaming"]`)).toBeVisible();
    // The world map still works afterwards, which is what disposal is for.
    await page.locator(`${WORLD} [data-action="view-globe"]`).click();
    await expect(page.locator(`${WORLD} [data-section="pilot"]`)).toBeHidden();
  });
});
