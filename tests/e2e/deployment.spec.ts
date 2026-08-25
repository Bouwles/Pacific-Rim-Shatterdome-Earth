import { expect, test, type Page } from "@playwright/test";

const WORLD = "#worldScreen";
const PILOT = "#pilotScreen";

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
  await page.locator(`${WORLD} [data-action="crisis-frequency"]`).selectOption("2");
}

/** Skips time until the board has something on it. */
async function waitForAlert(page: Page, maxSkips = 40): Promise<boolean> {
  for (let skip = 0; skip < maxSkips; skip += 1) {
    if ((await page.locator(`${WORLD} [data-field="alert-headline"]`).count()) > 0) return true;
    await page.locator(`${WORLD} [data-action="time-six-hours"]`).click();
    await page.waitForTimeout(120);
  }
  return (await page.locator(`${WORLD} [data-field="alert-headline"]`).count()) > 0;
}

test.describe("deployment and the mission lifecycle", () => {
  test("shows readiness before anything launches, with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await worldMap(page);
    expect(await waitForAlert(page)).toBe(true);

    // The planner speaks before anybody commits: readiness, drift, the machine,
    // the flight, the load and the weather.
    const readiness = field(page, "alert-readiness").first();
    await expect(readiness).toHaveText(/Readiness \d+%/);
    await expect(readiness).toHaveText(/drift \d+%/);
    await expect(readiness).toHaveText(/h flight/);
    await expect(readiness).toHaveText(/carrier \d+% loaded/);

    // And the deploy button carries the predicted threat rather than the truth.
    const deploy = page.locator(`${WORLD} [data-action="incident-deploy"]`).first();
    await expect(deploy).toBeVisible();
    const predicted = await deploy.getAttribute("title");
    expect(predicted ?? "").toMatch(/confirmed|contact|signal/);

    // Nothing is out yet, so neither the sortie nor the results block is shown.
    await expect(page.locator(`${WORLD} [data-section="sortie"]`)).toBeHidden();
    await expect(page.locator(`${WORLD} [data-section="results"]`)).toBeHidden();
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("runs alert to carrier to the ground without a second game state", async ({ page }) => {
    test.slow();
    await worldMap(page);
    expect(await waitForAlert(page)).toBe(true);

    await page.locator(`${WORLD} [data-action="incident-deploy"]`).first().click();
    await page.waitForTimeout(400);

    // The carrier run is a phase of the same session, and it is skippable.
    const sortie = page.locator(`${WORLD} [data-section="sortie"]`);
    await expect(sortie).toBeVisible();
    await expect(field(page, "sortie-state")).toHaveText(/Sortie over .+: carrier/);
    const skip = page.locator(`${WORLD} [data-action="skip-carrier"]`);
    await expect(skip).toBeEnabled();
    await skip.click();

    // And it lands in the world the player was already in, in the machine.
    await expect(page.locator(PILOT)).toBeVisible({ timeout: 30_000 });
    await expect(field(page, "sortie-state")).toHaveText(/active/);
    await expect(field(page, "sortie-objectives")).toHaveText(/Defend/);
  });

  test("aborting produces an explained, recoverable outcome", async ({ page }) => {
    test.slow();
    await worldMap(page);
    expect(await waitForAlert(page)).toBe(true);
    await page.locator(`${WORLD} [data-action="incident-deploy"]`).first().click();
    await page.waitForTimeout(300);
    await page.locator(`${WORLD} [data-action="skip-carrier"]`).click();
    await expect(page.locator(PILOT)).toBeVisible({ timeout: 30_000 });

    await page.locator(`${WORLD} [data-action="abort-mission"]`).click();
    await page.waitForTimeout(500);

    // The results explain themselves rather than vanishing.
    const results = page.locator(`${WORLD} [data-section="results"]`);
    await expect(results).toBeVisible();
    await expect(field(page, "results-summary")).toHaveText(/aborted/);
    const lines = await page.locator(`${WORLD} [data-field="results-line"]`).allTextContents();
    expect(lines.join(" ")).toMatch(/Objectives/);
    expect(lines.join(" ")).toMatch(/Repair hours/);
    expect(lines.join(" ")).toMatch(/Reputation/);

    // And the player can put it down and carry on.
    await page.locator(`${WORLD} [data-action="close-results"]`).click();
    await page.waitForTimeout(300);
    await expect(results).toBeHidden();
    await expect(page.locator(`${WORLD} [data-section="streaming"]`)).toBeVisible();
  });

  test("explains every number in the results", async ({ page }) => {
    test.slow();
    await worldMap(page);
    expect(await waitForAlert(page)).toBe(true);
    await page.locator(`${WORLD} [data-action="incident-deploy"]`).first().click();
    await page.waitForTimeout(300);
    await page.locator(`${WORLD} [data-action="skip-carrier"]`).click();
    await expect(page.locator(PILOT)).toBeVisible({ timeout: 30_000 });
    await page.locator(`${WORLD} [data-action="abort-mission"]`).click();
    await page.waitForTimeout(400);

    const lines = await page.locator(`${WORLD} [data-field="results-line"]`).allTextContents();
    expect(lines.length).toBeGreaterThan(5);
    // Every line carries the reason it exists, in brackets.
    for (const line of lines) expect(line).toMatch(/\(.+\)/);
  });
});
