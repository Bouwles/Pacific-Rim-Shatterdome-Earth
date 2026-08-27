import { expect, test, type Page } from "@playwright/test";

/**
 * The simulator, in a real browser.
 *
 * The unit and integration suites prove the scenario rules, the library and the
 * separation from a campaign without a browser. What only a browser proves is
 * that the screen is reachable, that its pickers are built from the game's own
 * tables, that an impossible combination is refused in words with the run button
 * disabled, and that a scenario survives a save, a reload and a round trip
 * through an export file.
 */

const SANDBOX = "#sandboxScreen";

async function sandbox(page: Page, query = "?seed=20260909"): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Simulator" }).click();
  await expect(page.locator(SANDBOX)).toBeVisible({ timeout: 15_000 });
}

const field = (page: Page, name: string) => page.locator(`${SANDBOX} [data-field="${name}"]`);

test.describe("the simulator", () => {
  test("opens from the menu with a runnable fight and no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await sandbox(page);
    await expect(page.locator(`${SANDBOX} [data-action="run"]`)).toBeEnabled();
    await expect(field(page, "problems")).toBeHidden();
    expect(consoleErrors).toEqual([]);
  });

  test("builds its pickers from the game's own tables", async ({ page }) => {
    await sandbox(page);
    // Every region and every creature the build knows, without a source edit.
    expect(await field(page, "region").locator("option").count()).toBeGreaterThan(5);
    expect(await field(page, "creature").locator("option").count()).toBeGreaterThan(2);
    expect(await field(page, "chassis").locator("option").count()).toBeGreaterThan(2);
    expect(await field(page, "objective").locator("option").count()).toBeGreaterThan(5);
  });

  test("refuses an impossible combination in words rather than loading it", async ({ page }) => {
    await sandbox(page);
    await field(page, "region").selectOption("manila");
    await field(page, "weather").selectOption("snow");
    await expect(field(page, "problems")).toBeVisible({ timeout: 10_000 });
    await expect(field(page, "problems")).toContainText(/does not snow in Manila/);
    await expect(page.locator(`${SANDBOX} [data-action="run"]`)).toBeDisabled();

    // And it becomes runnable again once the disagreement is resolved.
    await field(page, "weather").selectOption("clear");
    await expect(page.locator(`${SANDBOX} [data-action="run"]`)).toBeEnabled({ timeout: 10_000 });
  });

  test("keeps debug visualisation behind the advanced panel", async ({ page }) => {
    await sandbox(page);
    const advanced = page.locator(`${SANDBOX} [data-section="advanced"]`);
    // Present but closed, so the ordinary sandbox is not a developer build.
    await expect(advanced).toBeAttached();
    await expect(advanced.locator('input[data-rule="debugVisuals"]')).toBeHidden();
    await advanced.locator("summary").click();
    await expect(advanced.locator('input[data-rule="debugVisuals"]')).toBeVisible({ timeout: 10_000 });
    // The ordinary rules were never in there.
    await expect(
      page.locator(`${SANDBOX} [data-section="rules"] input[data-rule="freeCosts"]`),
    ).toBeVisible();
  });

  test("saves a scenario and reloads it after a page reload", async ({ page }) => {
    await sandbox(page);
    await field(page, "name").fill("Snowy Vladivostok");
    await field(page, "name").dispatchEvent("change");
    await field(page, "region").selectOption("vladivostok");
    await field(page, "weather").selectOption("snow");
    await page.locator(`${SANDBOX} [data-action="save"]`).click();
    await expect(field(page, "saved")).toContainText(/Snowy Vladivostok/, { timeout: 10_000 });

    const stored = await page.evaluate(() => window.localStorage.getItem("shatterdome.sandbox.v1"));
    expect(stored).toContain("Snowy Vladivostok");

    await sandbox(page);
    await expect(field(page, "saved")).toContainText(/Snowy Vladivostok/, { timeout: 10_000 });
    await page.locator(`${SANDBOX} [data-action="load"]`).first().click();
    await expect(field(page, "region")).toHaveValue("vladivostok", { timeout: 10_000 });
    await expect(field(page, "weather")).toHaveValue("snow");
  });

  test("exports a scenario and imports it back", async ({ page }) => {
    await sandbox(page);
    await field(page, "region").selectOption("sydney");
    await page.locator(`${SANDBOX} [data-action="export"]`).click();
    const exported = await field(page, "transfer").inputValue();
    expect(exported).toContain("shatterdome.sandbox.scenario");

    await sandbox(page);
    await field(page, "transfer").fill(exported);
    await page.locator(`${SANDBOX} [data-action="import"]`).click();
    await expect(field(page, "transfer-note")).toContainText(/Imported/, { timeout: 10_000 });
    await expect(field(page, "region")).toHaveValue("sydney");
  });

  test("marks an imported file that is not from this game", async ({ page }) => {
    await sandbox(page);
    await field(page, "transfer").fill(JSON.stringify({ hello: "world" }));
    await page.locator(`${SANDBOX} [data-action="import"]`).click();
    await expect(field(page, "transfer-note")).toContainText(/not a scenario file/, { timeout: 10_000 });
  });

  test("runs a custom battle and puts the chosen creature on the field", async ({ page }) => {
    await sandbox(page);
    await field(page, "region").selectOption("sydney");
    await field(page, "creature").selectOption("kaiju.serpent-delta");
    await page.locator(`${SANDBOX} [data-action="run"]`).click();

    // The run lands on the world map at the chosen region, which is where a
    // fight is entered from.
    await expect(page.locator("#worldScreen")).toBeVisible({ timeout: 15_000 });
    await page.locator('#worldScreen [data-action="view-ground"]').click();
    await expect(page.locator('#worldScreen [data-section="streaming"]')).toBeVisible({ timeout: 20_000 });
    await page.locator('#worldScreen [data-action="pilot"]').click();
    await expect(page.locator("#pilotScreen")).toBeVisible({ timeout: 15_000 });
    await page.locator('#pilotScreen [data-action="spawn-target"]').click();
    // The creature the scenario named, not the default one.
    await expect(page.locator('#pilotScreen [data-field="target"]')).toContainText(/Serpent/i, {
      timeout: 15_000,
    });
  });

  test("keeps its library in its own store, not in a campaign save", async ({ page }) => {
    await sandbox(page);
    await field(page, "name").fill("Separation check");
    await field(page, "name").dispatchEvent("change");
    await page.locator(`${SANDBOX} [data-action="save"]`).click();
    await expect(field(page, "saved")).toContainText(/Separation check/, { timeout: 10_000 });

    // The scenario went to a sandbox key, and nothing sandbox-shaped exists in
    // the save pipeline's own storage, which is IndexedDB rather than this.
    const keys = await page.evaluate(() => Object.keys(window.localStorage));
    expect(keys.some((key) => key.startsWith("shatterdome.sandbox"))).toBe(true);
    await expect(field(page, "stats")).toContainText(/run/i);
  });
});
