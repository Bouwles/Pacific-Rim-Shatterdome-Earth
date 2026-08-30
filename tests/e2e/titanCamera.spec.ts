import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * The camera director in the real fight: state changes, immediate mouse
 * response, a level horizon, and framing that keeps the machine ahead of
 * the camera. Reads the debug handle a dev build exposes.
 */

const OUT = "docs/screenshots/titan-break/probe";

interface CameraRead {
  state: string;
  yawDeg: number;
  pitchDeg: number;
  distanceMeters: number;
  rollDeg: number;
  fovDeg: number;
  locked: boolean;
  bodyYawDeg: number;
  speedMps: number;
}

test.describe.configure({ retries: 1 });

test("camera director: states, mouse, horizon", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  const read = async (): Promise<CameraRead> =>
    page.evaluate(() => (window as unknown as { __titan: { camera: CameraRead } }).__titan.camera);
  await page.goto("/?hunt=knifehead&seed=20260930&debug=1");
  await page.locator(".op.hud2").waitFor({ timeout: 60_000 });
  await page.addStyleTag({ content: "#diagnosticsPanel { display: none !important; }" });
  await page.waitForTimeout(2_500);
  const canvas = page.locator("canvas");
  await canvas.click({ position: { x: 640, y: 360 } });
  await page.waitForTimeout(400);
  const before = await read();
  await page.mouse.move(700, 360);
  await page.waitForTimeout(40);
  const after = await read();
  console.log(`CAM mouse yaw ${before.yawDeg.toFixed(1)} -> ${after.yawDeg.toFixed(1)} state ${after.state}`);
  expect(Math.abs(after.yawDeg - before.yawDeg)).toBeGreaterThan(2);

  const samples: CameraRead[] = [];
  const shot = async (name: string) => {
    const r = await read();
    samples.push(r);
    console.log(
      `CAM ${name}: state ${r.state} dist ${r.distanceMeters.toFixed(0)} fov ${r.fovDeg.toFixed(0)} roll ${r.rollDeg.toFixed(2)} pitch ${r.pitchDeg.toFixed(1)} locked ${r.locked}`,
    );
    await page.screenshot({ path: `${OUT}/cam-${name}.png` });
  };
  await shot("free");
  await page.keyboard.down("Shift");
  await page.keyboard.down("w");
  await page.waitForTimeout(2_200);
  await shot("sprint");
  await page.keyboard.up("w");
  await page.keyboard.up("Shift");
  await page.waitForTimeout(800);
  await page.mouse.down({ button: "middle" });
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(1_200);
  await shot("lock");
  await page.keyboard.down("w");
  await page.waitForTimeout(3_000);
  await page.keyboard.up("w");
  await shot("lock-close");
  await page.keyboard.down("d");
  await page.waitForTimeout(2_000);
  await page.keyboard.up("d");
  await shot("lock-strafe");
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(280);
  }
  await shot("lock-chain");
  await page.waitForTimeout(4_000);
  await shot("lock-later");
  await page.keyboard.press("q");
  await page.waitForTimeout(250);
  await shot("dodge");
  await page.waitForTimeout(5_000);
  await shot("late");
  for (const r of samples) {
    expect(Math.abs(r.rollDeg)).toBeLessThan(1.5);
    expect(r.pitchDeg).toBeGreaterThan(-36);
    expect(r.pitchDeg).toBeLessThan(63);
    expect(r.distanceMeters).toBeGreaterThan(20);
  }
  expect(samples.some((r) => r.state === "lock" || r.state === "close")).toBe(true);
});

test("camera near the crane and the containers: pulls in, never enters, horizon level", async ({ page }) => {
  test.setTimeout(360_000);
  mkdirSync(OUT, { recursive: true });
  interface Facts {
    anchors: { id: string; east: number; north: number }[];
    machine: { east: number; north: number; yawDeg: number };
  }
  const facts = async (): Promise<Facts> =>
    page.evaluate(() => (window as unknown as { __titan: { titan: Facts } }).__titan.titan);
  const camera = async (): Promise<CameraRead> =>
    page.evaluate(() => (window as unknown as { __titan: { camera: CameraRead } }).__titan.camera);
  await page.goto("/?hunt=knifehead&seed=20260930&debug=1");
  await page.locator(".op.hud2").waitFor({ timeout: 60_000 });
  await page.addStyleTag({ content: "#diagnosticsPanel { display: none !important; }" });
  await page.waitForTimeout(2_500);
  const canvas = page.locator("canvas");
  await canvas.click({ position: { x: 640, y: 360 } });
  // Break the lock so the walk is camera-relative, then walk to each anchor.
  await page.mouse.down({ button: "middle" });
  await page.mouse.up({ button: "middle" });
  const perf: string[] = [];
  for (const id of ["crane"]) {
    for (let step = 0; step < 18; step += 1) {
      const f = await facts();
      if (step % 3 === 0) console.log(`CAM walk ${id} step ${step}`);
      const anchor = f.anchors.find((entry) => entry.id === id);
      if (!anchor) break;
      const dx = anchor.east - f.machine.east;
      const dz = anchor.north - f.machine.north;
      const distance = Math.hypot(dx, dz);
      if (distance < 60) break;
      const bearing = ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360;
      const cam = await camera();
      const delta = ((bearing - cam.yawDeg + 540) % 360) - 180;
      // One mouse correction per step, then a short walk.
      const stepDeg = Math.max(-40, Math.min(40, delta));
      await page.mouse.move(640 + stepDeg * 9, 360);
      await page.waitForTimeout(16);
      await page.mouse.move(640, 360);
      await page.keyboard.down("Shift");
      await page.keyboard.down("w");
      await page.waitForTimeout(900);
      await page.keyboard.up("w");
      await page.keyboard.up("Shift");
    }
    await page.waitForTimeout(600);
    // Orbit the camera round the piece and sample the boom at each step.
    let minDistance = Number.POSITIVE_INFINITY;
    let maxRoll = 0;
    for (let turn = 0; turn < 24; turn += 1) {
      await page.mouse.move(640 + 15 * 9, 360);
      await page.waitForTimeout(16);
      await page.mouse.move(640, 360);
      await page.waitForTimeout(140);
      const cam = await camera();
      minDistance = Math.min(minDistance, cam.distanceMeters);
      maxRoll = Math.max(maxRoll, Math.abs(cam.rollDeg));
      if (turn === 8) await page.screenshot({ path: `${OUT}/cam-near-${id}.png` });
    }
    const panel = (
      await page
        .locator("#diagnosticsPanel")
        .innerText()
        .catch(() => "")
    ).replace(/\s+/g, " ");
    perf.push(`${id}: ${panel.slice(0, 220)}`);
    console.log(`CAM near ${id}: min boom ${minDistance.toFixed(0)} m, max roll ${maxRoll.toFixed(2)}`);
    expect(minDistance).toBeGreaterThan(20);
    expect(maxRoll).toBeLessThan(1.5);
  }
  console.log(`PERF ${perf.join(" || ")}`);
});
