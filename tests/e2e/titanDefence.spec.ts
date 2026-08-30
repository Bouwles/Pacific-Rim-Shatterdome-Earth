import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * The defensive tools, timed from inside the page so the frame is right:
 * a perfect guard on a claw, a booster dodge across the charge. Stands
 * still and only defends, so the arena's cancel rules never get in the way.
 */

const OUT = "docs/screenshots/titan-break";

const STARTUP: Record<string, number> = {
  "kaiju.claw.left": 18,
  "kaiju.claw.right": 16,
  "kaiju.claw.swipe": 20,
  "kaiju.blade.sweep": 24,
  "kaiju.blade.down": 30,
  "kaiju.charge.blade": 22,
  "kaiju.bite.clinch": 16,
  "kaiju.shove": 10,
  "kaiju.tail.sweep": 18,
};

interface Facts {
  telemetry: { perfectGuards: number; timedDodges: number; hitsTaken: number };
  kaiju: {
    activeMove: string | null;
    activePhase: string | null;
    activeMoveTick: number;
    distance: number;
  } | null;
}

// The frame-timed presses need a machine that keeps up; a loaded one gets another go.
test.describe.configure({ retries: 2 });

test("perfect guard and booster dodge land on the frame", async ({ page }) => {
  test.setTimeout(420_000);
  mkdirSync(OUT, { recursive: true });
  await page.goto("/?hunt=knifehead&seed=20260930&debug=1");
  await page.locator(".op.hud2").waitFor({ timeout: 60_000 });
  await page.addStyleTag({ content: "#diagnosticsPanel { display: none !important; }" });
  await page.waitForTimeout(2_500);
  const canvas = page.locator("canvas");
  await canvas.click({ position: { x: 640, y: 360 } });
  const facts = async (): Promise<Facts> =>
    page.evaluate(() => (window as unknown as { __titan: { titan: Facts } }).__titan.titan);

  // Walk in until the creature is at claw range, then stand and answer.
  await page.keyboard.down("Shift");
  await page.keyboard.down("w");
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(250);
    const f = await facts();
    if (f.kaiju && f.kaiju.distance < 38) break;
  }
  await page.keyboard.up("w");
  await page.keyboard.up("Shift");

  const defend = (): Promise<string> =>
    page.evaluate(async (startups) => {
      const handle = (window as unknown as { __titan: { titan: Facts } }).__titan;
      const press = (code: string, key: string): void => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true }));
        document.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true }));
      };
      const release = (code: string, key: string): void => {
        window.dispatchEvent(new KeyboardEvent("keyup", { code, key, bubbles: true }));
        document.dispatchEvent(new KeyboardEvent("keyup", { code, key, bubbles: true }));
      };
      const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
      for (let frame = 0; frame < 60 * 14; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const k = handle.titan.kaiju;
        if (!k || !k.activeMove || k.activePhase !== "startup") continue;
        const startup = startups[k.activeMove] ?? 18;
        if (k.activeMoveTick < startup - 3) continue;
        if (k.activeMove === "kaiju.charge.blade" || k.activeMove === "kaiju.blade.down") {
          press("KeyD", "d");
          press("KeyQ", "q");
          await wait(60);
          release("KeyQ", "q");
          await wait(320);
          release("KeyD", "d");
          return `dodge:${k.activeMove}`;
        }
        press("KeyF", "f");
        await wait(420);
        release("KeyF", "f");
        return `guard:${k.activeMove}`;
      }
      return "none";
    }, STARTUP);

  const answers: string[] = [];
  let guards = 0;
  let dodges = 0;
  for (let round = 0; round < 20 && (guards === 0 || dodges === 0); round += 1) {
    const answer = await defend();
    answers.push(answer);
    await page.waitForTimeout(150);
    const f = await facts();
    if (f.telemetry.perfectGuards > guards) {
      guards = f.telemetry.perfectGuards;
      await page.screenshot({ path: `${OUT}/07-perfect-guard-counter.png` });
      // The counter: the fast body counter on the left button, at once.
      await page.mouse.down();
      await page.mouse.up();
    }
    if (f.telemetry.timedDodges > dodges) {
      dodges = f.telemetry.timedDodges;
      await page.screenshot({ path: `${OUT}/06-booster-dodge.png` });
    }
    // Keep the range: step back in if it has drifted away.
    if (f.kaiju && f.kaiju.distance > 48) {
      await page.keyboard.down("w");
      await page.waitForTimeout(Math.min(1_500, (f.kaiju.distance - 36) * 40));
      await page.keyboard.up("w");
    }
  }
  console.log(`DEFENCE answers ${answers.join(",")} perfect ${guards} dodges ${dodges}`);
  expect(guards).toBeGreaterThan(0);
  expect(dodges).toBeGreaterThan(0);
});
