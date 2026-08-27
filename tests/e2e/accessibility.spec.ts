import { expect, test } from "@playwright/test";

/**
 * The accessibility review, as assertions.
 *
 * The deep coverage lives where the systems live: hud.spec proves severity
 * survives without hue and that text scaling and the critical layer work,
 * vfx.spec proves the flash and motion settings gate what they claim, and
 * audio.spec proves subtitles. What this file adds is the frame around them:
 * the game is reachable by keyboard from the first screen, controls carry
 * accessible names, and errors are sentences a person can act on.
 */

test.describe("accessibility review", () => {
  test("the menu is fully keyboard operable", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
      timeout: 15_000,
    });
    // Tab reaches New Game and Enter activates it: no pointer required to
    // start playing.
    for (let presses = 0; presses < 12; presses += 1) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
      if (focused === "New Game") break;
    }
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe("New Game");
    await page.keyboard.press("Enter");
    await expect(page.locator("#shatterdomeScreen")).toBeVisible({ timeout: 15_000 });
  });

  test("focus is visible on the focused control", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
      timeout: 15_000,
    });
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return "";
      const style = getComputedStyle(active as Element);
      return `${style.outlineStyle} ${style.outlineWidth}`;
    });
    // Whatever the exact styling, focus must not be invisible.
    expect(outline).not.toContain("none 0px");
  });

  test("form controls carry accessible names", async ({ page }) => {
    await page.goto("/?seed=20260921");
    await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "World Map" }).click();
    await expect(page.locator("#worldScreen")).toBeVisible({ timeout: 15_000 });
    // The quality dial and its Auto handover both answer to their names.
    await expect(page.getByLabel("Rendering quality")).toBeVisible();
    await expect(page.getByLabel("Adaptive quality")).toBeVisible();
  });

  test("an error is a sentence a person can act on, and nothing is lost", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Saves", exact: true }).click();
    await expect(page.locator("#saveScreen")).toBeVisible({ timeout: 15_000 });
    // A garbage import produces words, not a stack, and the panel survives.
    await page
      .locator('#saveScreen [data-action="import"]')
      .setInputFiles({ name: "junk.json", mimeType: "application/json", buffer: Buffer.from("not json") });
    await expect(page.locator("#saveScreen")).toContainText(/import|read|valid/i, { timeout: 10_000 });
    await expect(page.locator('#saveScreen [data-action="save-new"]')).toBeVisible();
  });

  test("warnings never rely on colour alone, at any severity", async ({ page }) => {
    // The severity tokens carry a glyph and a border weight beside the colour;
    // this asserts the vocabulary itself, browser-side, in one place.
    await page.goto("/");
    await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
      timeout: 15_000,
    });
    const distinct = await page.evaluate(async () => {
      const module = (await import("/src/ui/hudTokens.ts")) as {
        SEVERITY_TOKENS: Record<string, { glyph: string; borderWidth: number }>;
      };
      const tokens = Object.values(module.SEVERITY_TOKENS);
      const glyphs = new Set(tokens.map((token) => token.glyph));
      return { tokens: tokens.length, glyphs: glyphs.size };
    });
    expect(distinct.glyphs).toBe(distinct.tokens);
  });
});
