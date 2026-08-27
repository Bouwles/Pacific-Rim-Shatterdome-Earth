import { expect, test, type Page } from "@playwright/test";

/**
 * Installability and packs, in a real browser.
 *
 * The unit suite proves the policy, the update flow and the pack accounting.
 * What only a browser proves is that the manifest and worker are actually
 * served, that the worker registers on localhost, and that a pack genuinely
 * downloads into the Cache API, resumes from a partial state and removes
 * cleanly. The offline boot itself is verified against the production build
 * by hand, because the dev server the test suite runs against rebuilds its
 * module graph on every edit and is exactly the environment the worker
 * deliberately stays out of.
 */

async function menu(page: Page): Promise<void> {
  await page.goto("/?sw=1");
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
}

const PANEL = "#pwaPanel";

test.describe("the offline shell", () => {
  test("serves the manifest with icons that exist", async ({ page, request }) => {
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    const parsed = (await manifest.json()) as { icons: { src: string }[]; name: string };
    expect(parsed.name).toContain("Shatterdome");
    for (const icon of parsed.icons) {
      const response = await request.get(icon.src);
      expect(response.ok()).toBe(true);
      expect(response.headers()["content-type"]).toContain("image/png");
    }
    await page.close();
  });

  test("registers the worker on localhost and says so, with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await menu(page);
    await expect(page.locator(`${PANEL} [data-field="pwa-status"]`)).toContainText(
      /Offline shell active|Registering/,
      { timeout: 15_000 },
    );
    const registered = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration !== undefined;
    });
    expect(registered).toBe(true);
    expect(consoleErrors).toEqual([]);
  });

  test("offers no update when there is none", async ({ page }) => {
    await menu(page);
    await expect(page.locator(`${PANEL} [data-field="pwa-status"]`)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`${PANEL} [data-action="pwa-apply"]`)).toHaveCount(0);
  });

  test("downloads a pack into the cache, for real", async ({ page }) => {
    await menu(page);
    const row = page.locator(`${PANEL} [data-pack="pack.placeholder-textures"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.locator('[data-action="pack-download"]').click();
    await expect(row).toContainText(/complete \(4\/4\)/, { timeout: 20_000 });

    // The files are genuinely in the Cache API, not merely counted.
    const cached = await page.evaluate(async () => {
      const cache = await caches.open("shatterdome-packs-v1");
      const match = await cache.match("/packs/placeholder-textures/plate-detail.png");
      return match !== undefined;
    });
    expect(cached).toBe(true);
  });

  test("resumes a partial pack rather than starting over", async ({ page }) => {
    await menu(page);
    // A partial download, as an interruption leaves it: two files of four.
    await page.evaluate(async () => {
      const cache = await caches.open("shatterdome-packs-v1");
      await cache.delete("/packs/placeholder-textures/creature-hide.png");
      await cache.delete("/packs/placeholder-textures/emissive-strips.png");
      const keep = [
        "/packs/placeholder-textures/plate-detail.png",
        "/packs/placeholder-textures/plate-weathered.png",
      ];
      for (const path of keep) {
        if (!(await cache.match(path))) await cache.put(path, await fetch(path));
      }
    });
    await page.reload();
    await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
      timeout: 15_000,
    });
    const row = page.locator(`${PANEL} [data-pack="pack.placeholder-textures"]`);
    await expect(row).toContainText(/partial \(2\/4\)/, { timeout: 15_000 });
    await expect(row.locator('[data-action="pack-download"]')).toHaveText("Resume");
    await row.locator('[data-action="pack-download"]').click();
    await expect(row).toContainText(/complete \(4\/4\)/, { timeout: 20_000 });
  });

  test("removes a pack cleanly and can download it again", async ({ page }) => {
    await menu(page);
    const row = page.locator(`${PANEL} [data-pack="pack.placeholder-textures"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    if ((await row.locator('[data-action="pack-remove"]').count()) === 0) {
      await row.locator('[data-action="pack-download"]').click();
      await expect(row).toContainText(/complete/, { timeout: 20_000 });
    }
    await row.locator('[data-action="pack-remove"]').click();
    await expect(row).toContainText(/not-downloaded \(0\/4\)/, { timeout: 15_000 });
    await row.locator('[data-action="pack-download"]').click();
    await expect(row).toContainText(/complete \(4\/4\)/, { timeout: 20_000 });
  });

  test("the game runs identically with no worker at all", async ({ page }) => {
    // No ?sw=1: the dev default. The menu appears and nothing offline-shaped
    // is pretended.
    await page.goto("/");
    await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "New Game" })).toBeVisible();
  });
});
