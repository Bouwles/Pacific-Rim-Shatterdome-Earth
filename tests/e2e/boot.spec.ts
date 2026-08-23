import { expect, test } from "@playwright/test";

test.describe("Milestone 00 boot flow", () => {
  test("renders a real scene with a truthful backend label and no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto("/");

    const canvas = page.locator("#renderCanvas");
    await expect(canvas).toBeVisible();
    await expect(page.locator("#diagnosticsPanel")).toContainText(/WebGPU|WebGL/, { timeout: 15_000 });

    expect(await page.locator("canvas").count()).toBe(1);
    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("\n")}`).toEqual([]);
  });

  test("New Game takes the player into the Shatterdome and back", async ({ page }) => {
    await page.goto("/");

    const newGameButton = page.getByRole("button", { name: "New Game" });
    await expect(newGameButton).toBeVisible();
    await newGameButton.click();

    // Milestone 08 replaced the "not yet implemented" stub with the real
    // interior, so what this flow proves now is that New Game lands the player
    // on the command floor rather than on a notice.
    await expect(page.locator('#shatterdomeScreen [data-field="room-name"]')).toHaveText(/LOCCENT Command/, {
      timeout: 15_000,
    });

    await page.keyboard.press("Escape");
    await page.locator('#shatterdomeScreen [data-action="exit-to-menu"]').click();
    await expect(newGameButton).toBeVisible();
  });

  test("reload does not duplicate the canvas or the render loop", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#diagnosticsPanel")).toContainText(/WebGPU|WebGL/, { timeout: 15_000 });

    await page.reload();
    await expect(page.locator("#diagnosticsPanel")).toContainText(/WebGPU|WebGL/, { timeout: 15_000 });

    expect(await page.locator("canvas").count()).toBe(1);
  });

  test("resizing the viewport keeps exactly one canvas and does not throw", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await expect(page.locator("#diagnosticsPanel")).toContainText(/WebGPU|WebGL/, { timeout: 15_000 });

    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(200);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(200);

    expect(await page.locator("canvas").count()).toBe(1);
    expect(pageErrors).toEqual([]);
  });
});
