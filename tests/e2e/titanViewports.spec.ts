import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * The fight at the aspect ratios the prompt names: 16:9, 16:10, 21:9 and a
 * small laptop. The HUD must fit, the centre must stay clear, and the
 * camera must keep a level horizon and a sensible distance at each.
 */

const OUT = "docs/screenshots/titan-break/viewports";

const VIEWPORTS = [
  { name: "16x9", width: 1920, height: 1080 },
  { name: "16x10", width: 1680, height: 1050 },
  { name: "21x9", width: 2520, height: 1080 },
  { name: "laptop", width: 1366, height: 768 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`fight at ${viewport.name}`, async ({ page }) => {
    test.setTimeout(150_000);
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/?hunt=knifehead&seed=20260930&debug=1");
    await page.locator(".op.hud2").waitFor({ timeout: 60_000 });
    await page.addStyleTag({ content: "#diagnosticsPanel { display: none !important; }" });
    await page.waitForTimeout(2_500);
    const canvas = page.locator("canvas");
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.keyboard.down("Shift");
    await page.keyboard.down("w");
    await page.waitForTimeout(3_000);
    await page.keyboard.up("w");
    await page.keyboard.up("Shift");
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: `${OUT}/${viewport.name}.png` });
    // No horizontal scroll, HUD boxes inside the viewport, centre clear.
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(viewport.width);
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll(".op.hud3 .player, .op.hud3 .boss, .op.hud3 .actionbar")].map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }),
    );
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(viewport.height + 1);
    }
    const centreClear = await page.evaluate(() => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const hits = document
        .elementsFromPoint(cx, cy)
        .filter((node) => node.closest(".op.hud3") && !node.classList.contains("hud3"));
      return hits.length === 0;
    });
    expect(centreClear).toBe(true);
    const camera = await page.evaluate(
      () =>
        (
          window as unknown as {
            __titan: { camera: { rollDeg: number; distanceMeters: number; fovDeg: number } };
          }
        ).__titan.camera,
    );
    expect(Math.abs(camera.rollDeg)).toBeLessThan(1.5);
    expect(camera.distanceMeters).toBeGreaterThan(30);
    expect(camera.fovDeg).toBeGreaterThan(40);
    expect(camera.fovDeg).toBeLessThan(96);
  });
}
