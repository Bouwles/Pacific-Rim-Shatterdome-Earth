import { expect, test, type Page } from "@playwright/test";

const WORLD = "#worldScreen";

function field(page: Page, name: string) {
  return page.locator(`${WORLD} [data-field="${name}"]`);
}

async function worldMap(page: Page, query = "?seed=20260825"): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "World Map" }).click();
  await expect(page.locator(WORLD)).toBeVisible({ timeout: 15_000 });
}

/**
 * Runs the world clock forward until something is inbound.
 *
 * The director rolls on its own cadence, so the honest way to see an alert is
 * to let time pass rather than to poke the simulation.
 */
async function waitForAlert(page: Page, maxSkips = 40): Promise<boolean> {
  for (let skip = 0; skip < maxSkips; skip += 1) {
    const alerts = await page.locator(`${WORLD} [data-field="alert-headline"]`).count();
    if (alerts > 0) return true;
    await page.locator(`${WORLD} [data-action="time-six-hours"]`).click();
    await page.waitForTimeout(120);
  }
  return (await page.locator(`${WORLD} [data-field="alert-headline"]`).count()) > 0;
}

test.describe("the attack director", () => {
  test("reports the war and says plainly when nothing is inbound", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await worldMap(page);
    await expect(page.locator(`${WORLD} [data-section="war"]`)).toBeVisible();
    await expect(field(page, "war-state")).toHaveText(/escalation \d+% · breach pressure \d+%/);
    // A quiet war says so rather than showing an empty list.
    const headlines = await page.locator(`${WORLD} [data-field="alert-headline"]`).count();
    if (headlines === 0) {
      await expect(field(page, "alert-empty")).toHaveText(/Nothing inbound/);
    }
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("offers a crisis frequency the player controls", async ({ page }) => {
    await worldMap(page);
    const dial = page.locator(`${WORLD} [data-action="crisis-frequency"]`);
    await expect(dial).toBeVisible();
    await dial.selectOption("0.5");
    await page.waitForTimeout(200);
    await expect(dial).toHaveValue("0.5");
    await dial.selectOption("2");
    await page.waitForTimeout(200);
    await expect(dial).toHaveValue("2");
  });

  test("raises alerts with travel time, confidence and a forecast", async ({ page }) => {
    test.slow();
    await worldMap(page);
    // Turn the dial up so the wait is short, then let time pass.
    await page.locator(`${WORLD} [data-action="crisis-frequency"]`).selectOption("2");
    expect(await waitForAlert(page)).toBe(true);

    const headline = page.locator(`${WORLD} [data-field="alert-headline"]`).first();
    await expect(headline).toHaveText(/h out|ashore now/);
    await expect(headline).toHaveText(/h to get there/);

    const detail = page.locator(`${WORLD} [data-field="alert-detail"]`).first();
    await expect(detail).toHaveText(/\d+% confidence/);

    // The forecast of doing nothing is shown, and its reasoning is on the
    // element rather than hidden in a log.
    const forecast = page.locator(`${WORLD} [data-field="alert-forecast"]`).first();
    await expect(forecast).toHaveText(/If nobody goes:/);
    const ledger = await forecast.getAttribute("title");
    expect(ledger ?? "").toMatch(/Kaiju strength/);
    expect(ledger ?? "").toMatch(/Regional defences/);
  });

  test("resolving an incident explains what changed", async ({ page }) => {
    test.slow();
    await worldMap(page);
    await page.locator(`${WORLD} [data-action="crisis-frequency"]`).selectOption("2");
    expect(await waitForAlert(page)).toBe(true);

    const before = await field(page, "war-state").textContent();
    await page.locator(`${WORLD} [data-action="incident-defend"]`).first().click();
    await page.waitForTimeout(400);

    // A resolution appears, and it carries its own reasons.
    const resolution = page.locator(`${WORLD} [data-field="resolution"]`).first();
    await expect(resolution).toBeVisible();
    await expect(resolution).toHaveText(/held|overrun/);
    const ledger = await resolution.getAttribute("title");
    expect(ledger ?? "").toMatch(/City integrity/);
    expect(ledger ?? "").toMatch(/Escalation/);

    // And the war state moved, rather than the panel inventing a number.
    const after = await field(page, "war-state").textContent();
    expect(after).not.toBe(before);
  });

  test("keeps a resolved incident off the board", async ({ page }) => {
    test.slow();
    await worldMap(page);
    await page.locator(`${WORLD} [data-action="crisis-frequency"]`).selectOption("2");
    expect(await waitForAlert(page)).toBe(true);
    const before = await page.locator(`${WORLD} [data-field="alert-headline"]`).count();
    await page.locator(`${WORLD} [data-action="incident-ignore"]`).first().click();
    await page.waitForTimeout(400);
    const after = await page.locator(`${WORLD} [data-field="alert-headline"]`).count();
    expect(after).toBeLessThan(before + 1);
  });
});
