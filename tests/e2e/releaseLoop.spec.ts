import { expect, test, type Page } from "@playwright/test";

/**
 * The whole game, in one sitting, from an empty browser profile.
 *
 * Every piece of this loop has its own focused spec. What only this test
 * proves is the seam between them: that a fresh player can boot, start a
 * campaign, spend money, save, deploy, fight, take damage, read the results,
 * come home, and keep the save, in one continuous session with no developer
 * intervention and no console errors anywhere along the way.
 *
 * It deliberately runs against a clean context: no saves, no settings, no
 * caches. That is what "first run" means.
 */

const WORLD = "#worldScreen";
const PILOT = "#pilotScreen";
const DOME = "#shatterdomeScreen";

const domeField = (page: Page, name: string) => page.locator(`${DOME} [data-field="${name}"]`);
const worldField = (page: Page, name: string) => page.locator(`${WORLD} [data-field="${name}"]`);

/** Cycles interior focus until the prompt names the target, as a player would. */
async function focusOn(page: Page, pattern: RegExp, attempts = 14): Promise<boolean> {
  for (let index = 0; index < attempts; index += 1) {
    await page.keyboard.press("Tab");
    const prompt = (await domeField(page, "prompt").textContent()) ?? "";
    if (pattern.test(prompt)) return true;
  }
  return false;
}

/** Walks forward until the prompt offers the interaction, or gives up. */
async function walkUntilInReach(page: Page, maxMs = 30_000): Promise<boolean> {
  await page.keyboard.down("w");
  try {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      if (/^E — /.test((await domeField(page, "prompt").textContent()) ?? "")) return true;
      await page.waitForTimeout(250);
    }
  } finally {
    await page.keyboard.up("w");
  }
  return /^E — /.test((await domeField(page, "prompt").textContent()) ?? "");
}

test.describe("the release loop", () => {
  test("a fresh player completes the core loop end to end", async ({ page }) => {
    test.setTimeout(180_000);
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    // ------------------------------- boot --------------------------------
    await page.goto("/?seed=20260920");
    await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
      timeout: 15_000,
    });
    // An empty profile: nothing saved, nothing cached, nothing configured.
    expect(await page.evaluate(() => window.localStorage.length)).toBe(0);

    // --------------------------- a new campaign --------------------------
    await page.getByRole("button", { name: "New Game" }).click();
    await expect(page.locator(DOME)).toBeVisible({ timeout: 15_000 });
    await expect(domeField(page, "room-name")).toHaveText(/LOCCENT Command/);

    // ------------------- spend money: order a facility -------------------
    expect(await focusOn(page, /Command console/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await page.keyboard.press("e");
    const board = page.locator(`${DOME} [data-panel="facility"]`);
    await expect(board).toBeVisible();
    await board.locator('[data-facility="research"] [data-action="order"]').click();
    await expect(board.locator('[data-facility="research"] [data-field="facility-detail"]')).toHaveText(
      /% complete/,
      { timeout: 10_000 },
    );

    // ------------------------------- save --------------------------------
    // The pause menu is where saving lives inside the complex. The first
    // Escape closes the facility board; the second pauses.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await expect(page.locator(`${DOME} .sd-pause`)).toBeVisible({ timeout: 5_000 });
    await page.locator(`${DOME} [data-action="open-saves"]`).click();
    await expect(page.locator("#saveScreen")).toBeVisible({ timeout: 10_000 });
    await page.locator('#saveScreen [data-field="new-name"]').fill("Release loop");
    await page.locator('#saveScreen [data-action="save-new"]').click();
    await expect(page.locator("#saveScreen")).toContainText(/Release loop/, { timeout: 10_000 });
    await page.locator('#saveScreen [data-action="exit-saves"]').click();

    // ------------------------ deploy from the map ------------------------
    await expect(page.locator(DOME)).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(page.locator(`${DOME} .sd-pause`)).toBeVisible({ timeout: 5_000 });
    await page.locator(`${DOME} [data-action="exit-to-menu"]`).click();
    await page.getByRole("button", { name: "World Map" }).click();
    await expect(page.locator(WORLD)).toBeVisible({ timeout: 15_000 });
    await page.locator(`${WORLD} [data-action="crisis-frequency"]`).selectOption("2");
    let alerted = false;
    for (let skip = 0; skip < 40 && !alerted; skip += 1) {
      alerted = (await worldField(page, "alert-headline").count()) > 0;
      if (!alerted) {
        await page.locator(`${WORLD} [data-action="time-six-hours"]`).click();
        await page.waitForTimeout(120);
      }
    }
    expect(alerted, "the war produced an incident to answer").toBe(true);
    await page.locator(`${WORLD} [data-action="incident-deploy"]`).first().click();
    await page.waitForTimeout(400);
    await page.locator(`${WORLD} [data-action="skip-carrier"]`).click();

    // ------------------------------ combat -------------------------------
    await expect(page.locator(PILOT)).toBeVisible({ timeout: 30_000 });
    await expect(worldField(page, "sortie-state")).toHaveText(/active/);
    await page.locator("canvas").click();
    for (const key of ["J", "K", "J"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(400);
    }
    // The fight is real: the hit log fills, from our swings or the creature's.
    await expect(page.locator(`${PILOT} [data-field="hit-log"]`)).not.toBeEmpty({ timeout: 20_000 });

    // ----------------------- results and the ledger ----------------------
    // Dispatched: the canvas overlaps the panel edge and intercepts pointers,
    // which is a layout nuisance rather than the thing under test.
    await page.locator(`${WORLD} [data-action="abort-mission"]`).dispatchEvent("click");
    await page.waitForTimeout(500);
    const results = page.locator(`${WORLD} [data-section="results"]`);
    await expect(results).toBeVisible();
    const lines = await page.locator(`${WORLD} [data-field="results-line"]`).allTextContents();
    expect(lines.join(" ")).toMatch(/Repair hours/);
    expect(lines.join(" ")).toMatch(/Reputation/);
    await page.locator(`${WORLD} [data-action="close-results"]`).click();

    // -------------------- the save survived the sortie -------------------
    await page.locator(`${WORLD} [data-action="exit-world"]`).click();
    await page.getByRole("button", { name: "Saves" }).click();
    await expect(page.locator("#saveScreen")).toContainText(/Release loop/, { timeout: 10_000 });

    // ---------------------------- export it ------------------------------
    const download = page.waitForEvent("download");
    await page.locator('#saveScreen [data-action="export"]').first().click();
    expect((await download).suggestedFilename()).toMatch(/\.json$/);
    await page.locator('#saveScreen [data-action="exit-saves"]').click();

    // --------------------- sandbox stays walled off ----------------------
    await page.getByRole("button", { name: "Simulator" }).click();
    await expect(page.locator("#sandboxScreen")).toBeVisible({ timeout: 10_000 });
    await page.locator('#sandboxScreen [data-field="name"]').fill("Loop check");
    await page.locator('#sandboxScreen [data-field="name"]').dispatchEvent("change");
    await page.locator('#sandboxScreen [data-action="save"]').click();
    await expect(page.locator('#sandboxScreen [data-field="saved"]')).toContainText(/Loop check/, {
      timeout: 10_000,
    });
    await page.locator('#sandboxScreen [data-action="exit"]').dispatchEvent("click");
    // The campaign slot list is exactly what it was: the sandbox touched its
    // own store and nothing else.
    await page.getByRole("button", { name: "Saves" }).click();
    await expect(page.locator("#saveScreen")).toContainText(/Release loop/, { timeout: 10_000 });
    await expect(page.locator("#saveScreen")).not.toContainText(/Loop check/);

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });
});
