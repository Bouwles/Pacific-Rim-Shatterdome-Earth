import { describe, expect, it } from "vitest";
import type { CombatEvent } from "../../src/combat/arena";
import {
  ARMOR_POINTS,
  armorDamageFor,
  createTitanBreak,
  damageShares,
  damageSourceOf,
  flowGrants,
  flowLevel,
  stepTitanBreak,
  type TitanBreakState,
  type TitanFacts,
} from "../../src/combat/titanBreak";
import { BossController, type BossSense } from "../../src/combat/bossController";

function event(partial: Partial<CombatEvent> & { type: CombatEvent["type"] }): CombatEvent {
  return {
    tick: 0,
    actorId: "jaeger",
    targetId: "kaiju",
    moveId: null,
    volumeId: null,
    zoneId: null,
    damage: 0,
    reaction: null,
    contact: null,
    reason: null,
    damageKind: null,
    ...partial,
  };
}

function facts(partial: Partial<TitanFacts> = {}): TitanFacts {
  return {
    secondsElapsed: 1,
    deltaSeconds: 1 / 60,
    creatureReeling: false,
    creatureReaction: null,
    chargedHit: false,
    meaningfulInput: true,
    recentWeaponSwitch: false,
    grappleAtThreshold: false,
    environmentalHit: false,
    clashWon: false,
    clashLost: false,
    ...partial,
  };
}

const hit = (moveId: string, zoneId: string, damage: number): CombatEvent =>
  event({ type: "hit", moveId, zoneId, damage, damageKind: "impact" });

describe("armour", () => {
  it("cracks under heavy hits and barely under jabs", () => {
    expect(armorDamageFor("heavy", 100, false)).toBeGreaterThan(
      armorDamageFor("light-chain", 100, false) * 3,
    );
    expect(armorDamageFor("heavy", 100, true)).toBeGreaterThan(armorDamageFor("heavy", 100, false));
    expect(armorDamageFor("environment", 100, false)).toBeGreaterThan(armorDamageFor("heavy", 100, false));
  });

  it("comes off a region after enough heavy damage and names the zones to strip", () => {
    let state = createTitanBreak();
    const notices = [];
    for (let i = 0; i < 8; i += 1) {
      const step = stepTitanBreak(
        state,
        [hit("melee.heavy.overhead", "head", 200)],
        facts({ secondsElapsed: i }),
      );
      state = step.state;
      notices.push(...step.notices);
    }
    expect(state.regions.head.broken).toBe(true);
    const broken = notices.find((notice) => notice.kind === "armor-broken");
    expect(broken?.zoneIds).toEqual(["head"]);
    expect(state.telemetry.regionBreaks).toBe(1);
    expect(state.telemetry.damageBySource.heavy).toBe(1_600);
    // Light hits on the same plate would have needed many more.
    const jabs = Math.ceil(ARMOR_POINTS.head / armorDamageFor("light-chain", 90, false));
    expect(jabs).toBeGreaterThan(30);
  });

  it("pays a bonus on an exposed region for tissue tools and little for fists", () => {
    let state = createTitanBreak();
    for (let i = 0; i < 8; i += 1) {
      state = stepTitanBreak(
        state,
        [hit("melee.heavy.overhead", "head", 200)],
        facts({ secondsElapsed: i }),
      ).state;
    }
    const plasma = stepTitanBreak(
      state,
      [event({ type: "hit", moveId: null, zoneId: "head", damage: 300, damageKind: "plasma" })],
      facts({ secondsElapsed: 7, weaponOfEvent: () => "weapon.plasma-caster" }),
    );
    const jab = stepTitanBreak(state, [hit("melee.light.jab", "head", 300)], facts({ secondsElapsed: 7 }));
    expect(plasma.bonusDamage[0]?.amount ?? 0).toBeGreaterThan((jab.bonusDamage[0]?.amount ?? 0) * 4);
  });
});

describe("Drift Flow", () => {
  it("rewards alternation over the same chain four times", () => {
    const chain = [
      "melee.light.jab",
      "melee.light.cross",
      "melee.heavy.smash.forward",
      "melee.launcher.uppercut",
    ];
    let repeated = createTitanBreak();
    let varied = createTitanBreak();
    let t = 0;
    for (let round = 0; round < 4; round += 1) {
      for (const move of chain) {
        t += 0.4;
        repeated = stepTitanBreak(
          repeated,
          [event({ type: "attack-started", moveId: move }), hit(move, "torso", 120)],
          facts({ secondsElapsed: t }),
        ).state;
      }
    }
    t = 0;
    const mixed = [
      "melee.light.jab",
      "melee.heavy.overhead",
      "melee.light.cross",
      "melee.charge.haymaker",
      "melee.light.jab",
      "melee.heavy.spin.side",
      "melee.light.cross",
      "melee.heavy.back.counter",
    ];
    for (let round = 0; round < 2; round += 1) {
      for (const move of mixed) {
        t += 0.4;
        varied = stepTitanBreak(
          varied,
          [event({ type: "attack-started", moveId: move }), hit(move, "torso", 120)],
          facts({ secondsElapsed: t }),
        ).state;
      }
    }
    expect(varied.flow).toBeGreaterThan(repeated.flow * 1.5);
    expect(repeated.repeatCount).toBeGreaterThanOrEqual(2);
    expect(repeated.adaptation).not.toBe("none");
    expect(varied.adaptation).toBe("none");
  });

  it("rises on perfect guards and timed dodges, falls when hit, and decays in silence", () => {
    let state = createTitanBreak();
    state = stepTitanBreak(
      state,
      [event({ type: "perfect-guard", actorId: "jaeger", targetId: "kaiju" })],
      facts(),
    ).state;
    state = stepTitanBreak(
      state,
      [event({ type: "evaded", actorId: "jaeger", targetId: "kaiju" })],
      facts(),
    ).state;
    const up = state.flow;
    expect(up).toBeGreaterThan(0.2);
    state = stepTitanBreak(
      state,
      [event({ type: "hit", actorId: "kaiju", targetId: "jaeger", damage: 200 })],
      facts(),
    ).state;
    expect(state.flow).toBeLessThan(up);
    const before = state.flow;
    state = stepTitanBreak(
      state,
      [],
      facts({ secondsElapsed: 30, deltaSeconds: 10, meaningfulInput: false }),
    ).state;
    expect(state.flow).toBeLessThan(before);
    expect(state.telemetry.idleSeconds).toBeGreaterThan(0);
  });

  it("grants bounded advantages by level and never touches input", () => {
    expect(flowLevel(0.1)).toBe(0);
    expect(flowGrants(0.4).cooldownScale).toBeLessThan(1);
    expect(flowGrants(0.4).extraCancel).toBe(false);
    expect(flowGrants(0.7).extraCancel).toBe(true);
    expect(flowGrants(0.9).heatScale).toBeLessThan(1);
    expect(flowGrants(1).cooldownScale).toBeGreaterThanOrEqual(0.8);
  });
});

describe("stability and openings", () => {
  it("opens once per stagger and holds immunity so it cannot loop", () => {
    let state: TitanBreakState = createTitanBreak();
    const first = stepTitanBreak(state, [], facts({ creatureReeling: true, creatureReaction: "stagger" }));
    state = first.state;
    expect(first.notices.some((notice) => notice.kind === "opening")).toBe(true);
    expect(state.staggerImmunitySeconds).toBeGreaterThan(5);
    const second = stepTitanBreak(
      state,
      [],
      facts({ creatureReeling: true, creatureReaction: "stagger", secondsElapsed: 2 }),
    );
    expect(second.notices.some((notice) => notice.kind === "opening")).toBe(false);
    expect(second.state.telemetry.bossOpenings).toBe(1);
  });

  it("adds stability pressure for counters and perfect guards", () => {
    const step = stepTitanBreak(
      createTitanBreak(),
      [hit("melee.counter.heavy", "torso", 300), event({ type: "perfect-guard" })],
      facts(),
    );
    expect(step.extraPoise).toBeGreaterThan(80);
  });
});

describe("telemetry", () => {
  it("attributes damage by source and reports shares", () => {
    let state = createTitanBreak();
    state = stepTitanBreak(
      state,
      [hit("melee.light.jab", "torso", 100), hit("melee.heavy.overhead", "torso", 300)],
      facts(),
    ).state;
    const shares = damageShares(state.telemetry);
    expect(shares["light-chain"]).toBeCloseTo(0.25);
    expect(shares.heavy).toBeCloseTo(0.75);
    expect(damageSourceOf("melee.sword.slash", null)).toBe("chain-sword");
    expect(damageSourceOf(null, "weapon.plasma-caster")).toBe("plasma");
    expect(damageSourceOf("ability.elbow-rocket", null)).toBe("elbow-rocket");
  });
});

describe("Knifehead's brain", () => {
  const regions = () => ({
    head: { broken: false, severed: false },
    "arm.L": { broken: false, severed: false },
    "arm.R": { broken: false, severed: false },
    torso: { broken: false, severed: false },
    "leg.L": { broken: false, severed: false },
    "leg.R": { broken: false, severed: false },
    tail: { broken: false, severed: false },
  });
  const sense = (partial: Partial<BossSense> = {}): BossSense => ({
    tick: 0,
    distanceMeters: 40,
    bearingToPlayerDeg: 0,
    headingDeg: 0,
    playerOffsetDeg: 0,
    playerAttacking: false,
    playerRecovering: false,
    playerGuarding: false,
    playerOverheated: false,
    playerAiming: false,
    playerLateralMps: 0,
    recentHitsTaken: 0,
    healthFraction: 1,
    poiseFraction: 0,
    reeling: false,
    busy: false,
    regions: regions(),
    adaptation: "none",
    water: null,
    inWater: false,
    ...partial,
  });

  it("acts on a cadence, never idles long in range, and never repeats a signature three times", () => {
    const boss = new BossController(7);
    const actions: string[] = [];
    let busyUntil = -1;
    for (let tick = 0; tick < 60 * 90; tick += 1) {
      const decision = boss.step(sense({ tick, busy: tick < busyUntil }));
      if (decision.action) {
        actions.push(decision.action);
        busyUntil = tick + 40;
      }
    }
    expect(actions.length).toBeGreaterThan(20);
    const history = boss.history;
    for (let i = 2; i < history.length; i += 1) {
      expect(history[i] === history[i - 1] && history[i - 1] === history[i - 2]).toBe(false);
    }
    const kinds = new Set(actions);
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });

  it("charges at range, shoves under pressure, and bites a recovery", () => {
    const far = new BossController(3);
    const charged: string[] = [];
    for (let tick = 0; tick < 600; tick += 1) {
      const decision = far.step(sense({ tick, distanceMeters: 150 }));
      if (decision.action) charged.push(decision.action);
    }
    expect(charged.every((action) => action === "kaiju.charge.blade")).toBe(true);
    const pressured = new BossController(3);
    const shoved: string[] = [];
    for (let tick = 0; tick < 900; tick += 1) {
      const decision = pressured.step(
        sense({ tick, distanceMeters: 30, recentHitsTaken: 4, adaptation: "armor-through" }),
      );
      if (decision.action) shoved.push(decision.action);
    }
    expect(shoved).toContain("kaiju.shove");
  });

  it("changes phase with wounds and health, and stumbles after a charge on a broken leg", () => {
    const boss = new BossController(11);
    expect(boss.step(sense()).phase).toBe("hunter");
    const wounded = regions();
    wounded.head = { broken: true, severed: false };
    expect(boss.step(sense({ tick: 1, regions: wounded })).phase).toBe("wounded");
    expect(boss.step(sense({ tick: 2, healthFraction: 0.2 })).phase).toBe("desperate");
    const legs = regions();
    legs["leg.L"] = { broken: true, severed: false };
    const limping = new BossController(5);
    let stumbled = false;
    for (let tick = 0; tick < 1200 && !stumbled; tick += 1) {
      const decision = limping.step(sense({ tick, distanceMeters: 150, regions: legs }));
      if (decision.action === "kaiju.charge.blade") {
        const next = limping.step(sense({ tick: tick + 1, distanceMeters: 150, regions: legs }));
        stumbled = next.stumble;
      }
    }
    expect(stumbled).toBe(true);
    expect(limping.step(sense({ tick: 5000, regions: legs })).speedScale).toBeLessThan(1);
  });
});
