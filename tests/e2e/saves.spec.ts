import { expect, test, type Page } from "@playwright/test";

const PANEL = "#saveScreen";

function field(page: Page, name: string) {
  return page.locator(`${PANEL} [data-field="${name}"]`);
}

function rowFor(page: Page, name: string) {
  return page.locator(`${PANEL} .save-row`).filter({ hasText: name });
}

async function openSaves(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Saves", exact: true }).click();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 15_000 });
}

async function createSave(page: Page, name: string): Promise<void> {
  await field(page, "new-name").fill(name);
  await page.locator(`${PANEL} [data-action="save-new"]`).click();
  await expect(rowFor(page, name)).toBeVisible({ timeout: 10_000 });
}

test.describe("save slots", () => {
  test("opens on real storage and reports where saves are going", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await openSaves(page);

    await expect(field(page, "storage")).toContainText("indexeddb");
    await expect(field(page, "empty")).toBeVisible();
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("creates separate slots that both persist", async ({ page }) => {
    await openSaves(page);
    await createSave(page, "Alpha run");
    await createSave(page, "Bravo run");

    await expect(page.locator(`${PANEL} .save-row`)).toHaveCount(2);
    await expect(rowFor(page, "Alpha run")).toBeVisible();
    await expect(rowFor(page, "Bravo run")).toBeVisible();
  });

  test("a save survives a full page reload, which localStorage-free persistence is for", async ({ page }) => {
    await openSaves(page);
    await createSave(page, "Durable run");

    await page.reload();
    await openSaves(page);

    await expect(rowFor(page, "Durable run")).toBeVisible();
    await expect(rowFor(page, "Durable run")).toContainText(/seed \d+/);
  });

  test("records seed, tick and play time in the slot detail", async ({ page }) => {
    await openSaves(page);
    await createSave(page, "Detailed run");

    const detail = rowFor(page, "Detailed run").locator('[data-field="slot-detail"]');
    await expect(detail).toContainText("seed 20260819");
    await expect(detail).toContainText(/tick \d+/);
    await expect(detail).toContainText(/played/);
  });

  test("renames a slot in place", async ({ page }) => {
    await openSaves(page);
    await createSave(page, "Before rename");

    page.once("dialog", (dialog) => dialog.accept("After rename"));
    await rowFor(page, "Before rename").locator('[data-action="rename"]').click();

    await expect(rowFor(page, "After rename")).toBeVisible();
    await expect(rowFor(page, "Before rename")).toHaveCount(0);
  });

  test("overwrites a slot without creating a second one", async ({ page }) => {
    await openSaves(page);
    await createSave(page, "Overwrite me");

    await rowFor(page, "Overwrite me").locator('[data-action="overwrite"]').click();
    await expect(field(page, "notice")).toContainText("Overwrote");
    await expect(page.locator(`${PANEL} .save-row`)).toHaveCount(1);
  });

  test("loads a slot back into the running simulation", async ({ page }) => {
    await openSaves(page);
    await createSave(page, "Loadable run");

    await rowFor(page, "Loadable run").locator('[data-action="load"]').click();
    await expect(field(page, "notice")).toContainText('Loaded "Loadable run"');
    await expect(field(page, "notice")).toHaveAttribute("data-kind", "info");
  });

  test("deletes a slot", async ({ page }) => {
    await openSaves(page);
    await createSave(page, "Delete me");

    await rowFor(page, "Delete me").locator('[data-action="delete"]').click();
    await expect(rowFor(page, "Delete me")).toHaveCount(0);
    await expect(field(page, "empty")).toBeVisible();
  });

  test("exports a slot to a downloadable file", async ({ page }) => {
    await openSaves(page);
    await createSave(page, "Export me");

    const downloadPromise = page.waitForEvent("download");
    await rowFor(page, "Export me").locator('[data-action="export"]').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.json$/);
    await expect(field(page, "notice")).toContainText("Exported");
  });

  test("imports an exported file back as a separate slot", async ({ page }) => {
    await openSaves(page);
    await createSave(page, "Source run");

    const downloadPromise = page.waitForEvent("download");
    await rowFor(page, "Source run").locator('[data-action="export"]').click();
    const download = await downloadPromise;
    const path = await download.path();

    await page.locator(`${PANEL} [data-action="import"]`).setInputFiles(path);

    await expect(field(page, "notice")).toContainText("Imported");
    await expect(page.locator(`${PANEL} .save-row`)).toHaveCount(2);
    await expect(rowFor(page, "Source run")).toHaveCount(2);
  });

  test("rejects an invalid import with a readable message and keeps existing slots", async ({ page }) => {
    await openSaves(page);
    await createSave(page, "Keep me");

    await page.locator(`${PANEL} [data-action="import"]`).setInputFiles({
      name: "not-a-save.json",
      mimeType: "application/json",
      buffer: Buffer.from("<html>definitely not a save</html>"),
    });

    await expect(field(page, "notice")).toHaveAttribute("data-kind", "error");
    await expect(field(page, "notice")).toContainText(/not valid JSON/);
    await expect(rowFor(page, "Keep me")).toBeVisible();
  });

  test("imports a legacy bare snapshot by migrating it", async ({ page }) => {
    await openSaves(page);

    const legacy = {
      schemaVersion: 1,
      seed: 20260819,
      tick: 240,
      entities: { schemaVersion: 1, nextId: 2, entities: [{ id: 1, components: {} }] },
    };

    await page.locator(`${PANEL} [data-action="import"]`).setInputFiles({
      name: "legacy.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(legacy)),
    });

    await expect(field(page, "notice")).toContainText("Imported");
    await expect(page.locator(`${PANEL} .save-row`)).toHaveCount(1);
    await expect(page.locator(`${PANEL} .save-row`)).toContainText("seed 20260819");
  });

  test("leaving the save panel returns to the menu with the simulation still running", async ({ page }) => {
    await openSaves(page);
    const tick = page.locator('#diagnosticsPanel [data-field="tick"]');
    const before = Number(await tick.textContent());

    await page.locator(`${PANEL} [data-action="exit-saves"]`).click();
    await expect(page.getByRole("button", { name: "New Game" })).toBeVisible();
    await expect(page.locator(PANEL)).toHaveCount(0);

    await expect.poll(async () => Number(await tick.textContent())).toBeGreaterThan(before);
  });
});
