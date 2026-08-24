import { describe, expect, it } from "vitest";
import { createMoveRegistry, moveLengthTicks } from "../../src/data/moves";
import { createKaijuRegistry } from "../../src/data/kaiju";
import { jaegerRegistry } from "../../src/data/jaegers";
import {
  CombatArena,
  combatProfileFor,
  jaegerLayout,
  jaegerZones,
  kaijuCombatProfile,
  kaijuZones,
  type FighterSpec,
} from "../../src/combat/arena";
import { runCombatScenario, describeEvent } from "../../src/debug/combatScenario";

const MOVES = createMoveRegistry();
const JAEGER = jaegerRegistry.getOrThrow("placeholder-mk0");
const KAIJU = createKaijuRegistry().getOrThrow("kaiju.test-dummy");

function fighters(separationMeters = 36): FighterSpec[] {
  return [
    {
      id: "jaeger",
      kind: "jaeger",
      displayName: JAEGER.name,
      heightMeters: JAEGER.locomotion.heightMeters,
      profile: combatProfileFor(JAEGER),
      pose: { east: 0, north: 0, up: 0, yawDeg: 0 },
      zones: jaegerZones(JAEGER),
      layout: jaegerLayout(JAEGER),
      finisherThreshold: 0.2,
    },
    {
      id: "kaiju",
      kind: "kaiju",
      displayName: KAIJU.name,
      heightMeters: KAIJU.heightMeters,
      profile: kaijuCombatProfile(KAIJU),
      pose: { east: 0, north: separationMeters, up: 0, yawDeg: 180 },
      zones: kaijuZones(KAIJU),
      kaiju: KAIJU,
      finisherThreshold: KAIJU.finisherThreshold,
    },
  ];
}

function arena(separationMeters = 36): CombatArena {
  return new CombatArena({ moves: MOVES, fighters: fighters(separationMeters) });
}

describe("attacks", () => {
  it("runs startup, active and recovery and then ends", () => {
    const combat = arena();
    combat.start("jaeger", "melee.light.jab");
    const jab = MOVES.getOrThrow("melee.light.jab");
    combat.run(1);
    expect(combat.snapshot().fighters[0]?.activePhase).toBe("startup");
    combat.run(jab.startupTicks);
    expect(combat.snapshot().fighters[0]?.activePhase).toBe("active");
    combat.run(moveLengthTicks(jab));
    expect(combat.snapshot().fighters[0]?.activeMove).toBeNull();
  });

  it("lands a hit that says which volume, which zone and how much", () => {
    const combat = arena();
    combat.start("jaeger", "melee.heavy.overhead");
    const events = combat.run(60);
    const hit = events.find((event) => event.type === "hit");
    expect(hit).toBeDefined();
    expect(hit?.volumeId).toBe("fist.both");
    expect(hit?.zoneId).toBeTruthy();
    expect(hit?.damage).toBeGreaterThan(0);
    expect(hit?.contact).not.toBeNull();
    expect(hit?.tick).toBeGreaterThanOrEqual(MOVES.getOrThrow("melee.heavy.overhead").startupTicks);
  });

  it("reports a miss as a miss", () => {
    const combat = arena(400);
    combat.start("jaeger", "melee.light.jab");
    const events = combat.run(60);
    expect(events.some((event) => event.type === "hit")).toBe(false);
    expect(events.some((event) => event.type === "whiffed")).toBe(true);
  });

  it("hits a target once per volume, however long the volume is live", () => {
    const combat = arena();
    combat.start("jaeger", "melee.guard-break.shoulder");
    const events = combat.run(80);
    expect(events.filter((event) => event.type === "hit" || event.type === "guarded")).toHaveLength(1);
  });

  it("takes stamina and heat, and refuses what cannot be paid for", () => {
    const combat = arena();
    const before = combat.snapshot().fighters[0];
    combat.start("jaeger", "melee.heavy.overhead");
    const after = combat.snapshot().fighters[0];
    expect(after?.stamina).toBeLessThan(before?.stamina ?? 0);
    expect(after?.heat).toBeGreaterThan(0);

    // Spend everything, then ask for one more.
    for (let index = 0; index < 8; index += 1) {
      combat.run(moveLengthTicks(MOVES.getOrThrow("melee.heavy.overhead")));
      combat.start("jaeger", "melee.heavy.overhead");
    }
    const request = combat.request("jaeger", "melee.finisher.plasma-drop");
    expect(request.ok).toBe(false);
    if (!request.ok) expect(["no-stamina", "overheated", "finisher-not-open"]).toContain(request.reason);
  });
});

describe("cancels", () => {
  it("allows a combo inside the window", () => {
    const combat = arena();
    combat.start("jaeger", "melee.light.jab");
    combat.run(10);
    const request = combat.request("jaeger", "melee.light.cross");
    expect(request.ok).toBe(true);
    if (request.ok) expect(request.cancelled).toBe("melee.light.jab");
  });

  it("rejects a cancel before the window opens, and says why", () => {
    const combat = arena();
    combat.start("jaeger", "melee.light.jab");
    combat.run(2);
    const request = combat.request("jaeger", "melee.light.cross");
    expect(request.ok).toBe(false);
    if (!request.ok) {
      expect(request.reason).toBe("cancel-window-closed");
      expect(request.message).toMatch(/only cancel between ticks/);
    }
  });

  it("rejects a cancel after the window closes", () => {
    const combat = arena();
    combat.start("jaeger", "melee.light.jab");
    combat.run(22);
    const request = combat.request("jaeger", "melee.light.cross");
    expect(request.ok).toBe(false);
    if (!request.ok) expect(request.reason).toBe("cancel-window-closed");
  });

  it("rejects a cancel into something the move does not cancel into", () => {
    const combat = arena();
    combat.start("jaeger", "melee.heavy.overhead");
    combat.run(32);
    const request = combat.request("jaeger", "melee.light.jab");
    expect(request.ok).toBe(false);
    if (!request.ok) expect(request.reason).toBe("not-cancellable");
  });

  it("refuses to cancel a whiffed move that has to land first", () => {
    const combat = arena(400);
    combat.start("jaeger", "melee.light.cross");
    combat.run(12);
    const request = combat.request("jaeger", "melee.heavy.overhead");
    expect(request.ok).toBe(false);
    if (!request.ok) expect(request.reason).toBe("cancel-needs-a-hit");
  });

  it("allows the same cancel once the move has landed", () => {
    const combat = arena();
    combat.start("jaeger", "melee.light.cross");
    combat.run(12);
    const snapshot = combat.snapshot().fighters[0];
    expect(snapshot?.activeMove).toBe("melee.light.cross");
    const request = combat.request("jaeger", "melee.heavy.overhead");
    expect(request.ok).toBe(true);
  });

  it("lets a guard out of a move that lists it, and not out of one that does not", () => {
    const guardable = arena();
    guardable.start("jaeger", "melee.light.jab");
    guardable.run(10);
    guardable.setGuard("jaeger", true);
    expect(guardable.snapshot().fighters[0]?.guarding).toBe(true);

    const committed = arena();
    committed.start("jaeger", "melee.heavy.overhead");
    committed.run(10);
    committed.setGuard("jaeger", true);
    expect(committed.snapshot().fighters[0]?.guarding).toBe(false);
  });
});

describe("buffered input", () => {
  it("takes a press made during recovery the moment it becomes legal", () => {
    const combat = arena();
    const heavy = MOVES.getOrThrow("melee.heavy.overhead");
    combat.start("jaeger", "melee.heavy.overhead");
    // Pressed inside the buffer window before the move ends, which is the case
    // the buffer exists for: a fifth of a second early still counts.
    combat.run(moveLengthTicks(heavy) - 6);
    combat.press("jaeger", "melee.light.jab");
    const events = combat.run(40);
    const started = events.find(
      (event) => event.type === "attack-started" && event.moveId === "melee.light.jab",
    );
    expect(started).toBeDefined();
  });

  it("drops a press nobody could ever act on rather than firing it late", () => {
    const combat = arena();
    combat.start("jaeger", "melee.finisher.plasma-drop");
    combat.press("jaeger", "melee.finisher.plasma-drop");
    const events = combat.run(200);
    expect(
      events.filter(
        (event) => event.moveId === "melee.finisher.plasma-drop" && event.type === "attack-started",
      ),
    ).toHaveLength(0);
  });

  it("shows what is waiting, for the debug view", () => {
    const combat = arena();
    combat.start("jaeger", "melee.heavy.overhead");
    combat.press("jaeger", "melee.light.jab");
    expect(combat.snapshot().fighters[0]?.buffered).toContain("melee.light.jab");
  });
});

describe("reactions in the arena", () => {
  it("staggers only once poise is spent, rather than on every heavy landing", () => {
    const combat = arena();
    const heavy = MOVES.getOrThrow("melee.heavy.overhead");
    // One heavy is not a stagger: 85 poise against a 220 capacity.
    combat.start("jaeger", "melee.heavy.overhead");
    const first = combat.run(moveLengthTicks(heavy));
    expect(first.find((event) => event.type === "reaction")?.reaction).not.toBe("stagger");

    // Keep the pressure on and it breaks. This is what poise is for.
    let staggered = false;
    for (let round = 0; round < 8 && !staggered; round += 1) {
      combat.start("jaeger", "melee.heavy.overhead");
      const events = combat.run(heavy.startupTicks + heavy.activeTicks + 2);
      staggered = events.some((event) => event.type === "reaction" && event.reaction === "stagger");
    }
    expect(staggered).toBe(true);

    const kaiju = combat.snapshot().fighters.find((fighter) => fighter.id === "kaiju");
    expect(kaiju?.reactionTicksLeft).toBeGreaterThan(0);
    // A staggered fighter cannot act: its own attack is refused, by name.
    const request = combat.request("kaiju", "kaiju.claw.swipe");
    expect(request.ok).toBe(false);
    if (!request.ok) expect(request.reason).toBe("no-control");
  });

  it("lets a guard eat most of a hit, and logs it as guarded rather than as a hit", () => {
    // The machine guards; a kaiju has no guard at all, which is why it is the
    // one throwing here.
    const guarded = arena();
    guarded.setGuard("jaeger", true);
    guarded.start("kaiju", "kaiju.claw.swipe");
    const guardedEvents = guarded.run(60);
    const guardedHit = guardedEvents.find((event) => event.type === "guarded");
    expect(guardedHit).toBeDefined();
    expect(guardedEvents.some((event) => event.type === "hit")).toBe(false);

    const open = arena();
    open.start("kaiju", "kaiju.claw.swipe");
    const openEvents = open.run(60);
    const openHit = openEvents.find((event) => event.type === "hit");
    expect(openHit).toBeDefined();
    // Guarding costs the attacker most of the damage and all of the reaction.
    expect(guardedHit?.damage ?? 0).toBeLessThan((openHit?.damage ?? 0) * 0.5);
    expect(guardedEvents.some((event) => event.type === "reaction")).toBe(false);
  });

  it("destroys a zone once, and says what losing it costs", () => {
    const combat = arena();
    for (let round = 0; round < 24; round += 1) {
      combat.start("jaeger", "melee.heavy.overhead");
      combat.run(moveLengthTicks(MOVES.getOrThrow("melee.heavy.overhead")) + 30);
    }
    const events = combat.log();
    const destroyed = events.filter((event) => event.type === "zone-destroyed");
    expect(destroyed.length).toBeGreaterThan(0);
    const ids = destroyed.map((event) => event.zoneId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(destroyed[0]?.reason).toBeTruthy();
  });
});

describe("the deterministic exchange", () => {
  it("has both sides landing attacks with the same code", () => {
    const result = runCombatScenario();
    expect(result.hits).toBeGreaterThan(8);
    expect(result.damageToKaiju).toBeGreaterThan(0);
    expect(result.damageToJaeger).toBeGreaterThan(0);
    const attackers = new Set(
      result.events.filter((event) => event.type === "hit").map((event) => event.actorId),
    );
    expect(attackers).toEqual(new Set(["jaeger", "kaiju"]));
  });

  it("produces the same fight twice, down to the digest", () => {
    const first = runCombatScenario();
    const second = runCombatScenario();
    expect(second.digest).toBe(first.digest);
    expect(second.events).toHaveLength(first.events.length);
    expect(second.damageToKaiju).toBe(first.damageToKaiju);
  });

  it("produces a different fight for a different machine", () => {
    const standard = runCombatScenario();
    const heavy = runCombatScenario({ jaegerId: "heavy-mk4" });
    expect(heavy.digest).not.toBe(standard.digest);
  });

  it("cancels combos and reports every one of them", () => {
    const result = runCombatScenario();
    expect(result.cancels).toBeGreaterThan(0);
    for (const event of result.events.filter((entry) => entry.type === "attack-cancelled")) {
      expect(event.reason).toBeTruthy();
    }
  });

  it("logs every hit with a volume, a zone, a tick and a packet", () => {
    const result = runCombatScenario();
    for (const hit of result.events.filter((event) => event.type === "hit")) {
      expect(hit.volumeId).toBeTruthy();
      expect(hit.zoneId).toBeTruthy();
      expect(hit.damage).toBeGreaterThan(0);
      expect(hit.reaction).toBeTruthy();
      expect(describeEvent(hit)).toMatch(/volume/);
    }
  });

  it("can be driven to a finish, and says who won", () => {
    // Long enough for a close fight to be decided. It is close: at six thousand
    // ticks both sides are badly hurt and neither is down, which is the pacing
    // the resource and poise numbers were tuned for.
    const result = runCombatScenario({ ticks: 12_000 });
    expect(result.winner).not.toBeNull();
    expect(result.events.some((event) => event.type === "defeated")).toBe(true);
    // Whoever won, a lethal zone is what ended it.
    const defeat = result.events.find((event) => event.type === "defeated");
    const kill = result.events.find((event) => event.type === "zone-destroyed" && event.reason === "kill");
    expect(defeat?.actorId).toBe(kill?.actorId);
  });

  it("keeps every fighter inside its own resource limits", () => {
    const result = runCombatScenario({ ticks: 2_000 });
    for (const fighter of result.snapshot.fighters) {
      expect(fighter.stamina).toBeGreaterThanOrEqual(0);
      expect(fighter.heat).toBeGreaterThanOrEqual(0);
      expect(fighter.heat).toBeLessThanOrEqual(100);
      for (const zone of fighter.zones) expect(zone.health).toBeGreaterThanOrEqual(0);
    }
  });
});
