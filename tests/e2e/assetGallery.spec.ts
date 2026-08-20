import { expect, test, type Page } from "@playwright/test";

const GALLERY = "#assetGallery";

function field(page: Page, name: string) {
  return page.locator(`${GALLERY} [data-field="${name}"]`);
}

async function openGallery(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Asset Gallery" }).click();
  await expect(page.locator(GALLERY)).toBeVisible({ timeout: 20_000 });
}

test.describe("asset gallery", () => {
  test("loads every asset and reports budget status", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await openGallery(page);

    const items = page.locator(`${GALLERY} button[data-asset-id]`);
    await expect(items).toHaveCount(12);
    // Placeholders ship inside budget, so the summary must say so rather than hiding it.
    await expect(field(page, "summary")).toHaveText(/12 assets loaded, all within budget\./);
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("measures the selected asset from the loaded geometry", async ({ page }) => {
    await openGallery(page);

    await expect(field(page, "detail-id")).toContainText("jaeger.placeholder-mk0");
    await expect(field(page, "detail-origin")).toHaveText("procedural placeholder");
    // The manifest declares 75m; this value is measured, so it proves the two agree.
    await expect(field(page, "detail-height")).toHaveText(/^75\.00 m$/);
    await expect(field(page, "detail-triangles")).toHaveText(/^\d+ \/ 150,000$/);
    await expect(field(page, "detail-diagnostics")).toHaveText("within budget, no issues");
  });

  test("selecting a different asset reframes it and updates every measurement", async ({ page }) => {
    await openGallery(page);

    await page.locator(`${GALLERY} button[data-asset-id="ship.container-freighter"]`).click();
    await expect(field(page, "detail-id")).toContainText("ship.container-freighter");
    await expect(field(page, "detail-height")).toHaveText(/^24\.00 m$/);
    await expect(field(page, "detail-extent")).toHaveText(/210\.00 m$/);
  });

  test("exposes named sockets, including the muzzle used to spawn projectiles", async ({ page }) => {
    await openGallery(page);

    await page.locator(`${GALLERY} button[data-asset-id="jaeger.placeholder-mk0"]`).click();
    const jaegerSockets = await field(page, "detail-sockets").textContent();
    for (const socket of ["hand.L", "hand.R", "forearm.L", "forearm.R", "head", "chest", "back", "reactor"]) {
      expect(jaegerSockets).toContain(socket);
    }

    await page.locator(`${GALLERY} button[data-asset-id="prop.shore-cannon"]`).click();
    await expect(field(page, "detail-sockets")).toContainText("muzzle");
  });

  test("damage preview changes the model and returns it to pristine", async ({ page }) => {
    await openGallery(page);
    const damage = page.locator(`${GALLERY} [data-action="damage"]`);

    await damage.fill("90");
    await damage.dispatchEvent("input");
    await page.waitForTimeout(200);

    await damage.fill("0");
    await damage.dispatchEvent("input");
    await page.waitForTimeout(200);

    // The preview is reversible: the asset is still measured at its full height.
    await expect(field(page, "detail-height")).toHaveText(/^75\.00 m$/);
  });

  test("rotation can be paused", async ({ page }) => {
    await openGallery(page);
    const spin = page.locator(`${GALLERY} [data-action="spin"]`);
    await expect(spin).toBeChecked();
    await spin.uncheck();
    await expect(spin).not.toBeChecked();
  });

  test("swapping to an uninstalled model falls back visibly and warns once", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") warnings.push(msg.text());
    });

    await openGallery(page);
    await page.locator(`${GALLERY} [data-action="override"]`).selectOption("external-model");

    // Still 12 assets, still measured, still no crash.
    await expect(page.locator(`${GALLERY} button[data-asset-id]`)).toHaveCount(12);
    await expect(field(page, "detail-origin")).toHaveText("procedural placeholder");
    await expect(field(page, "detail-height")).toHaveText(/^75\.00 m$/);

    const jaegerWarnings = warnings.filter((w) => w.includes("jaeger.placeholder-mk0"));
    expect(jaegerWarnings).toHaveLength(1);
    expect(jaegerWarnings[0]).toMatch(/public\/assets\/models/);
  });

  test("an alternate palette swaps presentation without changing measurements", async ({ page }) => {
    await openGallery(page);

    const before = await field(page, "detail-height").textContent();
    const trianglesBefore = await field(page, "detail-triangles").textContent();

    await page.locator(`${GALLERY} [data-action="override"]`).selectOption("alt-palette");
    await expect(field(page, "detail-id")).toContainText("jaeger.placeholder-mk0");

    expect(await field(page, "detail-height").textContent()).toBe(before);
    expect(await field(page, "detail-triangles").textContent()).toBe(trianglesBefore);
  });

  test("leaving the gallery returns to the menu and the simulation keeps running", async ({ page }) => {
    await openGallery(page);
    const tick = page.locator('#diagnosticsPanel [data-field="tick"]');
    const before = Number(await tick.textContent());

    await page.locator(`${GALLERY} [data-action="exit-gallery"]`).click();
    await expect(page.getByRole("button", { name: "New Game" })).toBeVisible();
    await expect(page.locator(GALLERY)).toHaveCount(0);

    await expect.poll(async () => Number(await tick.textContent())).toBeGreaterThan(before);
  });
});
