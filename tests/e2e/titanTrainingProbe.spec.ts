import { test } from "@playwright/test";

/** Development probe: does the training walk register, and what does the save path say. */

test("probe: training walk and step", async ({ page }) => {
  test.setTimeout(120_000);
  const logs: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") logs.push(message.text());
  });
  await page.goto("/?hunt=training&seed=20260930&debug=1");
  await page.locator(".op.hud2").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(3_000);
  const read = async () =>
    page.evaluate(() => {
      const t = (
        window as unknown as {
          __titan: {
            titan?: {
              trainingStep: number;
              machine: { east: number; north: number };
              kaiju: { distance: number } | null;
            };
          };
        }
      ).__titan.titan;
      return t
        ? { step: t.trainingStep, east: t.machine.east, north: t.machine.north, distance: t.kaiju?.distance }
        : null;
    });
  const before = await read();
  await page.locator("canvas").click({ position: { x: 640, y: 360 } });
  await page.keyboard.down("Shift");
  await page.keyboard.down("w");
  await page.waitForTimeout(3_000);
  await page.keyboard.up("w");
  await page.keyboard.up("Shift");
  await page.waitForTimeout(500);
  const after = await read();
  const objective = await page.locator('[data-field="hud-objective"]').innerText();
  console.log(
    `TRAIN before ${JSON.stringify(before)} after ${JSON.stringify(after)} objective "${objective}" logs ${JSON.stringify(logs.slice(0, 4))}`,
  );
});

test("probe: performance readout in combat", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/?hunt=knifehead&seed=20260930&debug=1");
  await page.locator(".op.hud2").waitFor({ timeout: 60_000 });
  await page.locator("canvas").click({ position: { x: 640, y: 360 } });
  await page.keyboard.down("Shift");
  await page.keyboard.down("w");
  await page.waitForTimeout(6_000);
  await page.keyboard.up("w");
  await page.keyboard.up("Shift");
  const readings: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    for (let swing = 0; swing < 3; swing += 1) {
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(300);
    }
    await page.mouse.down({ button: "right" });
    await page.waitForTimeout(360);
    await page.mouse.up({ button: "right" });
    await page.waitForTimeout(2_500);
    const panel = (await page.locator("#diagnosticsPanel").innerText()).replace(/\s+/g, " ");
    readings.push(panel.slice(0, 260));
  }
  console.log(`PERF ${readings.join(" || ")}`);
});
