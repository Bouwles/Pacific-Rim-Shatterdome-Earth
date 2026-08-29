import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Ninety seconds of the Knifehead hunt at full speed, played the way a
 * player plays it: close with the sprint, swing the chain on the left
 * button, the heavy on the right, dodge, guard, fire the plasma caster.
 * Samples the HUD every pass and checks that both sides land hits, that the
 * director keeps sending something, and that the screens after the fight
 * (pause or rewards) reach the hangar. Screenshots go to the final
 * screenshot folder so the rebuild state document points at real frames.
 */

const URL = "/?seed=20260930&production=1";
const SHOTS = "docs/screenshots/fmkh-final";

interface Sample {
  readonly at: number;
  readonly hud: boolean;
  readonly enemy: number;
  readonly integrity: number;
  readonly combo: string;
  readonly phase: string;
  readonly flash: string;
  readonly objective: string;
}

test("Knifehead at Anchorage: both sides land, the director talks, the loop closes", async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(SHOTS, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const launchedAt = Date.now();
  await page.goto(URL);
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  // The dev server keeps its diagnostics strip; the player build has none.
  await page.addStyleTag({ content: "#diagnosticsPanel { display: none !important; }" });
  await page.screenshot({ path: `${SHOTS}/01-title.png` });
  await page.getByRole("button", { name: "New Game" }).click();
  await expect(page.locator('[data-screen="hangar"] h1')).toHaveText(/Gipsy Danger/, { timeout: 15_000 });
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: `${SHOTS}/02-hangar.png` });
  await page.locator('[data-screen="hangar"] [data-action="hunts"]').click();
  await expect(page.locator('[data-screen="hunts"]')).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/03-hunt-board.png` });
  await page.locator('[data-action="deploy-hunt.knifehead.anchorage"]').click();
  await expect(page.locator('[data-screen="loadout"]')).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/04-loadout.png` });
  await page.locator('[data-screen="loadout"] [data-action="confirm"]').click();
  await expect(page.locator('[data-screen="comms"]')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(2_600);
  await page.screenshot({ path: `${SHOTS}/05-deployment.png` });
  await expect(page.locator(".op.hud2")).toBeVisible({ timeout: 40_000 });
  const controlAt = Date.now() - launchedAt;
  await page.waitForTimeout(3_500);
  await page.screenshot({ path: `${SHOTS}/06-arrival.png` });

  const read = async (): Promise<Sample> =>
    page.evaluate(() => {
      const width = (selector: string): number => {
        const fill = document.querySelector<HTMLElement>(selector);
        return fill ? Number.parseFloat(fill.style.width || "100") / 100 : Number.NaN;
      };
      return {
        at: performance.now(),
        hud: document.querySelector(".op.hud2") !== null,
        enemy: width('[data-field="hud-enemy"] .hbar i'),
        integrity: width(".hud2 .player .hbar i"),
        combo: document.querySelector(".hud2 .combo .count")?.textContent ?? "",
        phase: document.querySelector('[data-field="hud-phase"]')?.textContent ?? "",
        flash: document.querySelector('[data-field="hud-flash"]')?.textContent ?? "",
        objective: document.querySelector('[data-field="hud-objective"]')?.textContent ?? "",
      };
    });

  const canvas = page.locator("canvas");
  await canvas.click();
  const samples: Sample[] = [];
  const flashes = new Set<string>();
  const phases = new Set<string>();
  let firstContactAt: number | null = null;
  let sprinting = true;
  const started = Date.now();
  let shot = 0;
  await page.keyboard.down("Shift");
  await page.keyboard.down("w");
  while (Date.now() - started < 90_000) {
    const elapsed = (Date.now() - started) / 1000;
    if (sprinting && elapsed > 7) {
      await page.keyboard.up("w");
      await page.keyboard.up("Shift");
      sprinting = false;
    }
    if (elapsed > 7) {
      for (let swing = 0; swing < 4; swing += 1) {
        await page.mouse.down();
        await page.mouse.up();
        await page.waitForTimeout(280);
      }
      await page.mouse.down({ button: "right" });
      await page.waitForTimeout(120);
      await page.mouse.up({ button: "right" });
      await page.waitForTimeout(500);
      if (Math.floor(elapsed) % 3 === 0) await page.keyboard.press("q");
      if (Math.floor(elapsed) % 4 === 0) await page.keyboard.press("f");
      if (Math.floor(elapsed) % 9 === 0) await page.keyboard.press("1");
      // Keep the nose on the creature: a short nudge forward every pass.
      await page.keyboard.down("w");
      await page.waitForTimeout(350);
      await page.keyboard.up("w");
    } else {
      await page.waitForTimeout(500);
    }
    const sample = await read();
    samples.push(sample);
    if (!sample.hud) break;
    if (sample.flash) flashes.add(sample.flash);
    if (sample.phase) phases.add(sample.phase);
    if (firstContactAt === null && (sample.enemy < 0.995 || sample.integrity < 0.995)) {
      firstContactAt = Date.now() - launchedAt;
    }
    if (elapsed > 20 * (shot + 1) && shot < 3) {
      shot += 1;
      await page.screenshot({ path: `${SHOTS}/07-fight-${shot}.png` });
    }
  }
  await page.keyboard.up("w");
  await page.keyboard.up("Shift");

  const live = samples.filter((sample) => sample.hud);
  const first = live[0];
  const last = live[live.length - 1];
  const minEnemy = Math.min(...live.map((sample) => sample.enemy).filter(Number.isFinite));
  const minIntegrity = Math.min(...live.map((sample) => sample.integrity).filter(Number.isFinite));
  const endedAt =
    samples[samples.length - 1]?.hud === false ? Math.round((last?.at ?? 0) - (first?.at ?? 0)) : null;
  const summary = {
    controlAtMs: controlAt,
    firstContactAtMs: firstContactAt,
    fightEndedAfterMs: endedAt,
    enemyFrom: first?.enemy,
    enemyTo: last?.enemy,
    minEnemy,
    minIntegrity,
    phases: [...phases],
    flashes: [...flashes],
    bestCombo: Math.max(...live.map((sample) => Number.parseInt(sample.combo || "0", 10))),
    objectives: [...new Set(live.map((sample) => sample.objective))],
    trace: live
      .map(
        (sample) =>
          `${Math.round((sample.at - (first?.at ?? 0)) / 1000)}s e${sample.enemy.toFixed(2)} i${sample.integrity.toFixed(2)}`,
      )
      .join(" "),
  };
  console.log(`HUNT SUMMARY ${JSON.stringify(summary)}`);

  expect(controlAt).toBeLessThan(60_000);
  expect(minEnemy).toBeLessThan(0.98);
  expect(minIntegrity).toBeLessThan(0.995);
  expect(phases.size + flashes.size).toBeGreaterThan(0);

  const rewards = page.locator('[data-screen="rewards"]');
  if (await rewards.isVisible()) {
    console.log(`HUNT ENDED ${(await rewards.innerText()).replace(/\s+/g, " ").slice(0, 300)}`);
    await page.screenshot({ path: `${SHOTS}/09-rewards.png` });
  } else {
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-screen="overlay"]')).toBeVisible({ timeout: 5_000 });
    await page.screenshot({ path: `${SHOTS}/08-pause.png` });
    await page.locator('[data-screen="overlay"] [data-action="abort-mission"]').dispatchEvent("click");
    await expect(rewards).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/09-rewards.png` });
  }
  await page.locator('[data-action="close-results"]').click();
  await expect(page.locator('[data-screen="hangar"]')).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});
