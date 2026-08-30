import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Development probe for the Titan Break rebuild: boots the direct route,
 * looks around, walks, swings, and writes frames to the scratch folder so
 * the orientation and camera can be judged by eye at full speed.
 */

const OUT = process.env["TITAN_PROBE_OUT"] ?? "docs/screenshots/titan-break/probe";

// Timing probes: real-time input on a live fight, so a loaded machine gets a second go.
test.describe.configure({ retries: 1 });

test("probe: direct route, look, walk, swing", async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const started = Date.now();
  await page.goto("/?hunt=knifehead&seed=20260930");
  await page.locator(".op.hud2").waitFor({ timeout: 60_000 });
  console.log(`PROBE control at ${Date.now() - started} ms`);
  await page.addStyleTag({ content: "#diagnosticsPanel { display: none !important; }" });
  await page.waitForTimeout(3_500);
  await page.screenshot({ path: `${OUT}/01-arrival.png` });

  const canvas = page.locator("canvas");
  await canvas.click({ position: { x: 640, y: 360 } });
  await page.waitForTimeout(300);
  // Look right by a quarter turn in small steps (pointer lock deltas).
  for (let step = 0; step < 20; step += 1) {
    await page.mouse.move(640 + step * 12, 360);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/02-look-right.png` });
  for (let step = 0; step < 40; step += 1) {
    await page.mouse.move(880 - step * 12, 360);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/03-look-left.png` });
  // Look up and down.
  for (let step = 0; step < 15; step += 1) {
    await page.mouse.move(400, 360 - step * 8);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/04-look-up.png` });
  for (let step = 0; step < 30; step += 1) {
    await page.mouse.move(400, 240 + step * 8);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/05-look-down.png` });

  // Walk forward, then strafe, then back.
  await page.keyboard.down("w");
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: `${OUT}/06-walk-forward.png` });
  await page.keyboard.up("w");
  await page.keyboard.down("d");
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: `${OUT}/07-strafe-right.png` });
  await page.keyboard.up("d");
  await page.keyboard.down("s");
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: `${OUT}/08-walk-back.png` });
  await page.keyboard.up("s");
  await page.keyboard.down("Shift");
  await page.keyboard.down("w");
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: `${OUT}/09-sprint.png` });
  await page.keyboard.up("w");
  await page.keyboard.up("Shift");

  // Swing: chain, heavy, dodge, guard.
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(140);
  await page.screenshot({ path: `${OUT}/10-jab.png` });
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/11-chain.png` });
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(320);
  await page.screenshot({ path: `${OUT}/12-heavy.png` });
  await page.waitForTimeout(700);
  await page.keyboard.press("q");
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}/13-dodge.png` });
  await page.waitForTimeout(600);
  await page.keyboard.down("f");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/14-guard.png` });
  await page.keyboard.up("f");

  // Lock on and let the creature come.
  await page.mouse.down({ button: "middle" });
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(6_000);
  await page.screenshot({ path: `${OUT}/15-locked-contact.png` });
  await page.waitForTimeout(6_000);
  await page.screenshot({ path: `${OUT}/16-locked-later.png` });
  console.log(`PROBE errors ${JSON.stringify(errors)}`);
});

test("probe: orientation scene", async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(OUT, { recursive: true });
  await page.goto("/?scene=orientation&debug=1&seed=20260930");
  await page.locator('[data-screen="orientation"]').waitFor({ timeout: 30_000 });
  await page.addStyleTag({ content: "#diagnosticsPanel { display: none !important; }" });
  const shots = [1.5, 4.5, 8, 12, 20, 30, 42, 55, 70, 85];
  let last = 0;
  for (const [index, at] of shots.entries()) {
    await page.waitForTimeout((at - last) * 1000);
    last = at;
    const verdict = await page.locator('[data-field="orientation-verdict"]').innerText();
    const step = await page.locator('[data-field="orientation-step"]').innerText();
    console.log(`ORIENT ${at}s ${step} :: ${verdict.replace(/\n/g, " | ")}`);
    await page.screenshot({ path: `${OUT}/orient-${String(index + 1).padStart(2, "0")}.png` });
  }
});

test("probe: orientation stills, front and back", async ({ page }) => {
  test.setTimeout(120_000);
  const stills = "docs/screenshots/titan-break";
  mkdirSync(stills, { recursive: true });
  for (const view of ["front", "back"] as const) {
    await page.goto(`/?scene=orientation&debug=1&seed=20260930&view=${view}&zoom=1&pose=0`);
    await page.locator('[data-screen="orientation"]').waitFor({ timeout: 30_000 });
    await page.addStyleTag({ content: "#diagnosticsPanel { display: none !important; }" });
    await page.waitForTimeout(1_800);
    const verdict = await page.locator('[data-field="orientation-verdict"]').innerText();
    console.log(`ORIENT ${view}: ${verdict.replace(/\n/g, " | ")}`);
    await page.screenshot({ path: `${stills}/01-gipsy-${view}.png` });
  }
});
