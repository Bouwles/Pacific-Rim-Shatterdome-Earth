import { expect, test, type Page } from "@playwright/test";

/**
 * Sound, in a real browser.
 *
 * The unit and integration suites prove what the game decides to play. What
 * only a browser proves is that the mixing desk is drawn and reaches the audio
 * graph, that a volume survives a reload, that the subtitle band exists, and
 * that a browser which refuses to start audio produces a note rather than a
 * console full of complaints.
 */

const WORLD = "#worldScreen";
const PILOT = "#pilotScreen";

async function pilot(page: Page, query = "?seed=20260903"): Promise<void> {
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

const audioRow = (page: Page) => page.locator(`${PILOT} [data-section="audio"]`);

test.describe("the mixing desk", () => {
  test("draws a fader for every bus, with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await pilot(page);
    await expect(audioRow(page)).toBeVisible({ timeout: 10_000 });

    const faders = audioRow(page).locator('[data-field="audio-buses"] input[type="range"]');
    expect(await faders.count()).toBe(10);

    // Every fader says what it controls, so none of them is a mystery slider.
    const labels = await audioRow(page).locator('[data-field="audio-buses"] label').allTextContents();
    expect(labels.join(" ")).toMatch(/Master/);
    expect(labels.join(" ")).toMatch(/Accessibility/);

    expect(consoleErrors).toEqual([]);
  });

  test("says whether audio started and how many voices are running", async ({ page }) => {
    await pilot(page);
    await expect(audioRow(page).locator('[data-field="audio-note"]')).toContainText(/Audio/, {
      timeout: 10_000,
    });
    // Whatever the browser decided, it is reported rather than guessed at.
    await expect(audioRow(page).locator('[data-field="audio-note"]')).toContainText(
      /running|idle|blocked|unsupported/,
    );
  });

  test("remembers a volume across a reload", async ({ page }) => {
    await pilot(page);
    const music = audioRow(page).locator('[data-field="audio-buses"] input[data-bus="music"]');
    await expect(music).toBeVisible({ timeout: 10_000 });
    await music.fill("12");
    await music.dispatchEvent("input");

    const stored = await page.evaluate(() => window.localStorage.getItem("shatterdome.mixer.v1"));
    expect(stored).toContain('"music"');
    expect(JSON.parse(stored ?? "{}").music).toBeCloseTo(0.12, 2);

    await pilot(page);
    const again = audioRow(page).locator('[data-field="audio-buses"] input[data-bus="music"]');
    await expect(again).toHaveValue("12", { timeout: 10_000 });
  });

  test("opens the conversation record on demand", async ({ page }) => {
    await pilot(page);
    const list = audioRow(page).locator('[data-field="transcript"]');
    await expect(list).toBeHidden();
    await audioRow(page).locator('[data-action="transcript"]').click();
    await expect(list).toBeVisible({ timeout: 10_000 });
  });

  test("has a subtitle band that is part of the HUD", async ({ page }) => {
    await pilot(page);
    // Hidden when nobody is speaking, which is the honest default rather than
    // an empty box sitting over the fight.
    await expect(page.locator(`${PILOT} [data-field="subtitle"]`)).toBeAttached({ timeout: 10_000 });
  });
});
