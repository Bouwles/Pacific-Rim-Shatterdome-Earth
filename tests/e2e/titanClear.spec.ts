import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * A representative clear of the Anchorage hunt, played by a bot that plays
 * the way the fight asks to be played: it guards when Knifehead winds up,
 * dodges across the charge, breaks armour with heavies and the Elbow
 * Rocket, opens exposed regions with the Plasma Caster and the Chain Sword,
 * grabs when the creature is off balance, throws into the harbour, answers
 * a clash, and fires the Synchronized Breaker when it is charged.
 *
 * It reads the same numbers the HUD shows through the debug handle a dev
 * build exposes. It never reads the arena ahead of time.
 *
 * Produces: the damage-source breakdown, the encounter duration, the
 * screenshots the state file points at, and a recording of the run.
 */

const OUT = "docs/screenshots/titan-break";

/** Startup ticks of Knifehead's moves, so the guard is timed rather than early. */
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
  flow: number;
  ultimate: number;
  adaptation: string;
  regions: Record<string, { armor: number; broken: boolean }>;
  telemetry: {
    damageBySource: Record<string, number>;
    repeatedSequences: number;
    defensiveActions: number;
    perfectGuards: number;
    timedDodges: number;
    regionBreaks: number;
    bossOpenings: number;
    clashesWon: number;
    clashesLost: number;
    grapples: number;
    environmentalHits: number;
    hitsTaken: number;
    idleSeconds: number;
    durationSeconds: number;
    moveUsage: Record<string, number>;
  };
  shares: Record<string, number>;
  boss: { phase: string; movement: string; why: string; history: string[] } | null;
  weaponMode: string;
  clash: string | null;
  breaker: { beat: number; direction: string } | null;
  kaiju: {
    activeMove: string | null;
    activePhase: string | null;
    activeMoveTick: number;
    reaction: string | null;
    reactionTicksLeft: number;
    poiseFraction: number;
    distance: number;
    defeated: boolean;
    finisherOpen: boolean;
    grapplePhase: string;
    health: number;
  } | null;
  machine: {
    east: number;
    north: number;
    yawDeg: number;
    activeMove: string | null;
    activePhase: string | null;
    guarding: boolean;
    heat: number;
    overheated: boolean;
    grapplePhase: string;
    reaction: string | null;
    integrity: number;
    stamina: number;
  };
  anchors: { id: string; used: boolean; east: number; north: number }[];
  cooldowns: number[];
  huntSeconds: number;
}

test.use({ video: "on" });

test("a representative clear: Gipsy Danger versus Knifehead at Anchorage", async ({ page }) => {
  test.setTimeout(720_000);
  mkdirSync(OUT, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const launchedAt = Date.now();
  await page.goto("/?hunt=knifehead&seed=20260930&debug=1");
  await page.locator(".op.hud2").waitFor({ timeout: 60_000 });
  const controlAt = Date.now() - launchedAt;
  await page.addStyleTag({ content: "#diagnosticsPanel { display: none !important; }" });
  const canvas = page.locator("canvas");
  await canvas.click({ position: { x: 640, y: 360 } });
  await page.waitForTimeout(300);

  const facts = async (): Promise<Facts | null> =>
    page.evaluate(() => (window as unknown as { __titan: { titan?: Facts } }).__titan.titan ?? null);

  const shots = new Set<string>();
  const shot = async (name: string): Promise<void> => {
    if (shots.has(name)) return;
    shots.add(name);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  };
  const arrow = (direction: string): string =>
    direction === "L" ? "a" : direction === "R" ? "d" : direction === "F" ? "w" : "s";

  const held = new Set<string>();
  const hold = async (key: string): Promise<void> => {
    if (held.has(key)) return;
    held.add(key);
    await page.keyboard.down(key);
  };
  const release = async (key: string): Promise<void> => {
    if (!held.has(key)) return;
    held.delete(key);
    await page.keyboard.up(key);
  };
  const releaseAll = async (): Promise<void> => {
    for (const key of [...held]) await release(key);
  };

  await shot("02-combat-framing");
  // Precise defence, timed inside the page: the guard or the dodge is
  // dispatched on the frame the creature's startup reaches the window.
  const timedDefence = async (kind: "guard" | "dodge"): Promise<boolean> =>
    page.evaluate(
      async ({ kind, startups }) => {
        const handle = (
          window as unknown as {
            __titan: {
              titan?: {
                kaiju: {
                  activeMove: string | null;
                  activePhase: string | null;
                  activeMoveTick: number;
                } | null;
              };
            };
          }
        ).__titan;
        const press = (code: string, key: string): void => {
          window.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true }));
          document.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true }));
        };
        const release = (code: string, key: string): void => {
          window.dispatchEvent(new KeyboardEvent("keyup", { code, key, bubbles: true }));
          document.dispatchEvent(new KeyboardEvent("keyup", { code, key, bubbles: true }));
        };
        for (let frame = 0; frame < 240; frame += 1) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const k = handle.titan?.kaiju;
          if (!k || !k.activeMove || k.activePhase !== "startup") return false;
          const startup = startups[k.activeMove] ?? 18;
          if (k.activeMoveTick >= startup - 4) {
            if (kind === "guard") {
              press("KeyF", "f");
              await new Promise((resolve) => setTimeout(resolve, 380));
              release("KeyF", "f");
            } else {
              press("KeyD", "d");
              press("KeyQ", "q");
              await new Promise((resolve) => setTimeout(resolve, 60));
              release("KeyQ", "q");
              await new Promise((resolve) => setTimeout(resolve, 260));
              release("KeyD", "d");
            }
            return true;
          }
        }
        return false;
      },
      { kind, startups: STARTUP },
    );
  let firstContactAt: number | null = null;
  let lastAction = "";
  let chainStep = 0;
  let lastHeavyAt = 0;
  let lastFlowNote = 0;
  const started = Date.now();
  let ended = false;
  let lastShotAt = 0;
  let thinkTick = 0;

  while (Date.now() - started < 660_000) {
    const f = await facts();
    if (!f || !f.kaiju) {
      await page.waitForTimeout(200);
      if (await page.locator('[data-screen="rewards"]').isVisible()) {
        ended = true;
        break;
      }
      continue;
    }
    if (firstContactAt === null && (f.kaiju.health < 0.999 || f.machine.integrity < 0.999)) {
      firstContactAt = Date.now() - launchedAt;
    }
    const k = f.kaiju;
    const m = f.machine;
    // A person, not a script: a beat of reading between decisions.
    thinkTick += 1;
    await page.waitForTimeout(180 + ((thinkTick * 7919) % 260));
    const distance = k.distance;
    const brokenRegions = Object.values(f.regions).filter((region) => region.broken).length;

    // Prompts first: a clash or the Breaker's beat is a direction.
    if (f.clash) {
      await releaseAll();
      await page.keyboard.press(arrow(f.clash));
      await shot("11-titan-clash");
      await page.waitForTimeout(120);
      continue;
    }
    if (f.breaker) {
      await releaseAll();
      if (f.breaker.beat === 0) await page.keyboard.press(arrow(f.breaker.direction));
      await shot("13-synchronized-breaker");
      await page.waitForTimeout(120);
      continue;
    }

    // Defence: a windup in range is a guard; the charge is a sidestep.
    const windingUp = k.activeMove !== null && k.activePhase === "startup";
    if (windingUp && distance < 95) {
      if (k.activeMove === "kaiju.charge.blade" || k.activeMove === "kaiju.blade.down") {
        await releaseAll();
        const dodged = await timedDefence("dodge");
        if (dodged) await shot("06-booster-dodge");
        continue;
      }
      if (k.activeMove === "kaiju.bite.clinch") {
        if ((f.cooldowns[3] ?? 1) <= 0) await page.keyboard.press("4");
        else {
          await hold("s");
          await page.keyboard.press("q");
          await page.waitForTimeout(140);
          await release("s");
        }
        continue;
      }
      // The guard, timed on the frame inside the page.
      await releaseAll();
      const guarded = await timedDefence("guard");
      if (guarded && f.telemetry.perfectGuards === 0) await page.waitForTimeout(120);
      continue;
    }
    if (k.activeMove !== null && k.activePhase === "active" && distance < 85) {
      await hold("f");
      await page.waitForTimeout(60);
      continue;
    }
    await release("f");

    // Held by it: purge.
    if (m.grapplePhase === "held" && k.grapplePhase !== "held") {
      if ((f.cooldowns[3] ?? 1) <= 0) await page.keyboard.press("4");
      await page.waitForTimeout(100);
      continue;
    }

    // Holding it: face the nearest harbour piece with the camera, then throw
    // into it; with nothing near, throw anyway.
    if (m.grapplePhase === "held" || m.grapplePhase === "throwing") {
      const near = f.anchors
        .filter((anchor) => !anchor.used)
        .map((anchor) => ({ ...anchor, d: Math.hypot(anchor.east - m.east, anchor.north - m.north) }))
        .sort((a, b) => a.d - b.d)[0];
      if (near && near.d < 150) {
        const bearing = ((Math.atan2(near.east - m.east, near.north - m.north) * 180) / Math.PI + 360) % 360;
        const cam = await page.evaluate(
          () => (window as unknown as { __titan: { camera: { yawDeg: number } } }).__titan.camera.yawDeg,
        );
        let delta = ((bearing - cam + 540) % 360) - 180;
        for (let i = 0; i < 12 && Math.abs(delta) > 8; i += 1) {
          const stepDeg = Math.max(-25, Math.min(25, delta));
          await page.mouse.move(640 + stepDeg * 9, 360);
          await page.waitForTimeout(16);
          await page.mouse.move(640, 360);
          delta -= stepDeg;
        }
        await hold("w");
        await page.waitForTimeout(80);
        await page.keyboard.press("e");
        await release("w");
        await shot("10-environmental-slam");
      } else {
        await page.keyboard.press("e");
      }
      await page.waitForTimeout(200);
      continue;
    }

    // The Breaker when it is charged and the creature is open.
    if (
      f.ultimate >= 0.999 &&
      f.flow >= 0.35 &&
      (k.reaction !== null || brokenRegions >= 2) &&
      distance < 60
    ) {
      await page.keyboard.press("r");
      await page.waitForTimeout(150);
      continue;
    }

    // Close the distance.
    if (distance > 42) {
      await release("f");
      if (distance > 120 && (f.cooldowns[1] ?? 1) <= 0 && brokenRegions > 0) {
        await page.keyboard.press("2");
        await shot("08-plasma-on-exposed");
      }
      await hold("Shift");
      await hold("w");
      await page.waitForTimeout(100);
      if (distance < 75 && (f.cooldowns[0] ?? 1) <= 0) {
        await release("Shift");
        await release("w");
        await page.keyboard.press("1");
        await shot("05-light-to-heavy-branch");
        await page.waitForTimeout(250);
      }
      continue;
    }
    await release("Shift");
    await release("w");

    // Off balance and close: grab.
    if (
      (k.poiseFraction >= 0.5 || k.reaction === "stagger") &&
      distance < 40 &&
      m.activeMove === null &&
      f.telemetry.grapples < 4
    ) {
      await page.keyboard.press("e");
      await page.waitForTimeout(220);
      continue;
    }

    // Offence: heavies while armour holds, weapons once it is off. Plasma
    // first while the reactor is cool, the sword when it can afford the heat.
    const exposed = brokenRegions > 0;
    if (
      exposed &&
      f.weaponMode !== "sword" &&
      (f.cooldowns[1] ?? 1) <= 0 &&
      !m.overheated &&
      m.heat < 50 &&
      distance < 90
    ) {
      await page.keyboard.press("2");
      await shot("08-plasma-on-exposed");
      await page.waitForTimeout(450);
      continue;
    }
    if (
      exposed &&
      f.weaponMode !== "sword" &&
      (f.cooldowns[2] ?? 1) <= 0 &&
      !m.overheated &&
      m.heat < 30 &&
      thinkTick % 3 === 0
    ) {
      await page.keyboard.press("3");
      await shot("09-chain-sword-active");
      await page.waitForTimeout(120);
      continue;
    }
    if (m.activeMove === null || m.activePhase === "recovery") {
      const now = Date.now();
      const heavyDue = now - lastHeavyAt > 2_600 || (!exposed && chainStep >= 2);
      if (heavyDue && f.weaponMode !== "sword") {
        if (k.activePhase === "recovery" && (f.cooldowns[0] ?? 1) <= 0) await page.keyboard.press("1");
        else {
          await page.mouse.down({ button: "right" });
          await page.waitForTimeout(lastAction === "charged" ? 30 : 360);
          await page.mouse.up({ button: "right" });
          lastAction = lastAction === "charged" ? "heavy" : "charged";
        }
        lastHeavyAt = now;
        chainStep = 0;
        await shot("05-light-to-heavy-branch");
      } else {
        await page.mouse.down();
        await page.mouse.up();
        chainStep += 1;
      }
      await page.waitForTimeout(240);
    } else {
      await page.waitForTimeout(60);
    }

    if (f.telemetry.perfectGuards > 0) await shot("07-perfect-guard-counter");
    if (brokenRegions > 0) await shot("12-armor-break");
    if (f.boss?.phase === "desperate") await shot("14-knifehead-critical");
    if (Date.now() - lastShotAt > 45_000) {
      lastShotAt = Date.now();
      await shot(`03-fight-${Math.round((Date.now() - started) / 1000)}s`);
    }
    if (Date.now() - lastFlowNote > 30_000) {
      lastFlowNote = Date.now();
      console.log(
        `CLEAR t=${Math.round((Date.now() - started) / 1000)}s kaiju ${(k.health * 100).toFixed(0)}% machine ${(m.integrity * 100).toFixed(0)}% flow ${f.flow.toFixed(2)} ult ${f.ultimate.toFixed(2)} breaks ${f.telemetry.regionBreaks} phase ${f.boss?.phase ?? "?"} adapt ${f.adaptation}`,
      );
    }
    if (k.defeated) {
      await shot("15-finishing-blow");
    }
    if (await page.locator('[data-screen="rewards"]').isVisible()) {
      ended = true;
      break;
    }
  }
  await releaseAll();
  const last = await facts();
  const rewardsVisible = await page.locator('[data-screen="rewards"]').isVisible();
  if (!rewardsVisible) {
    await page
      .locator('[data-screen="rewards"]')
      .waitFor({ timeout: 15_000 })
      .catch(() => undefined);
  }
  const rewardsText = (
    await page
      .locator('[data-screen="rewards"]')
      .innerText()
      .catch(() => "")
  ).replace(/\s+/g, " ");
  await shot("16-results");
  const summary = {
    controlAtMs: controlAt,
    firstContactAtMs: firstContactAt,
    ended,
    won: /KNIFEHEAD DOWN|KAIJU DOWN|holds\./i.test(rewardsText),
    durationSeconds: last?.telemetry.durationSeconds ?? null,
    shares: last?.shares ?? null,
    telemetry: last?.telemetry ?? null,
    bossHistory: last?.boss?.history ?? null,
    rewards: rewardsText.slice(0, 400),
    errors,
  };
  console.log(`CLEAR SUMMARY ${JSON.stringify(summary)}`);
  writeFileSync(`${OUT}/clear-summary.json`, JSON.stringify(summary, null, 2));
  expect(errors).toEqual([]);
  expect(ended).toBe(true);
});
