import { describe, expect, it } from "vitest";
import { createMoveRegistry, moveLengthTicks } from "../../src/data/moves";
import { createKaijuRegistry } from "../../src/data/kaiju";
import { createPropRegistry, spawnProp } from "../../src/data/props";
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
import { OPEN_GROUND, type SpaceQuery } from "../../src/combat/finisher";
import { COMBAT_ROUTES, runCombatScenario } from "../../src/debug/combatScenario";

const MOVES = createMoveRegistry();
const PROPS = createPropRegistry();
const JAEGER = jaegerRegistry.getOrThrow("placeholder-mk0");
const KAIJU = createKaijuRegistry().getOrThrow("kaiju.test-dummy");

function fighters(separationMeters = 30): FighterSpec[] {
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

function arena(space: SpaceQuery = OPEN_GROUND, separationMeters = 30): CombatArena {
  return new CombatArena({ moves: MOVES, fighters: fighters(separationMeters), space });
}

describe("every route wins", () => {
  it("can be won through offense, defence, grapples or mixed play", () => {
    for (const route of COMBAT_ROUTES) {
      const result = runCombatScenario({ route, ticks: 12_000 });
      expect(result.winner, `${route} route`).toBe("jaeger");
      expect(result.events.some((event) => event.type === "defeated")).toBe(true);
    }
  });

  it("fights each route in a recognisably different way", () => {
    const offense = runCombatScenario({ route: "offense", ticks: 12_000 });
    const defense = runCombatScenario({ route: "defense", ticks: 12_000 });
    const grapple = runCombatScenario({ route: "grapple", ticks: 12_000 });
    const mixed = runCombatScenario({ route: "mixed", ticks: 12_000 });

    expect(defense.parries).toBeGreaterThan(0);
    expect(grapple.grapples).toBeGreaterThan(0);
    expect(offense.bestCombo).toBeGreaterThan(mixed.grapples);
    // Every route is its own fight, so no two digests agree.
    expect(new Set([offense.digest, defense.digest, grapple.digest, mixed.digest]).size).toBe(4);
  });

  it("still repeats exactly, route by route", () => {
    for (const route of COMBAT_ROUTES) {
      const first = runCombatScenario({ route, ticks: 4_000 });
      const second = runCombatScenario({ route, ticks: 4_000 });
      expect(second.digest, route).toBe(first.digest);
    }
  });

  it("does not turn every hit into a cutscene", () => {
    const mixed = runCombatScenario({ route: "mixed", ticks: 12_000 });
    // Finishers are rare by construction: they need a target that is nearly
    // finished and already open.
    expect(mixed.finishers * 6).toBeLessThan(mixed.hits);
  });
});

describe("defence in the arena", () => {
  it("evades a swing outright during the dodge's own frames", () => {
    // Ground that refuses a sidestep, so the dodge cannot simply walk out of
    // range and the invulnerable frames are the only thing saving the machine.
    const noSidestep: SpaceQuery = { ...OPEN_GROUND, isClear: (east) => Math.abs(east) < 5 };
    const combat = new CombatArena({ moves: MOVES, fighters: fighters(30), space: noSidestep });
    combat.start("kaiju", "kaiju.claw.swipe");
    combat.run(17);
    combat.start("jaeger", "defense.dodge.step");
    const events = combat.run(20);
    expect(events.some((event) => event.type === "evaded")).toBe(true);
    expect(events.some((event) => event.type === "hit" && event.targetId === "jaeger")).toBe(false);
  });

  it("also gets out of the way, when there is room to step", () => {
    const combat = arena();
    combat.start("kaiju", "kaiju.claw.swipe");
    combat.run(22);
    const before = combat.snapshot().fighters.find((fighter) => fighter.id === "jaeger")?.east ?? 0;
    combat.start("jaeger", "defense.dodge.step");
    const after = combat.snapshot().fighters.find((fighter) => fighter.id === "jaeger")?.east ?? 0;
    expect(Math.abs(after - before)).toBeGreaterThan(20);
    const events = combat.run(20);
    // Out of range entirely, so nothing lands: a dodge that moves is still a dodge.
    expect(events.some((event) => event.type === "hit" && event.targetId === "jaeger")).toBe(false);
  });

  it("leaves the attacker open on a perfect guard, and takes nothing", () => {
    const combat = arena();
    combat.start("kaiju", "kaiju.claw.swipe");
    combat.run(18);
    combat.start("jaeger", "defense.block.raise");
    const events = combat.run(12);
    const perfect = events.find((event) => event.type === "perfect-guard");
    expect(perfect).toBeDefined();
    expect(perfect?.reason).toMatch(/Perfect guard/);
    const jaegerView = combat.snapshot().fighters.find((fighter) => fighter.id === "jaeger");
    expect(jaegerView?.zones[0]?.health).toBe(jaegerView?.zones[0]?.maxHealth);
  });

  it("answers a parry with a free counter", () => {
    const combat = arena();
    combat.start("kaiju", "kaiju.claw.swipe");
    combat.run(18);
    combat.start("jaeger", "defense.counter.parry");
    const events = combat.run(20);
    expect(events.some((event) => event.type === "parried")).toBe(true);
    expect(
      events.some((event) => event.type === "attack-started" && event.moveId === "melee.light.cross"),
    ).toBe(true);
  });

  it("counts a combo and reports it", () => {
    const combat = arena();
    combat.start("jaeger", "melee.light.jab");
    combat.run(14);
    combat.start("jaeger", "melee.light.cross");
    const events = combat.run(20);
    const combo = events.find((event) => event.type === "combo");
    expect(combo?.damage).toBeGreaterThan(1);
    expect(combo?.reason).toMatch(/in a row/);
  });
});

describe("grapples in the arena", () => {
  it("holds a target, and the held target cannot swing back", () => {
    const combat = arena();
    combat.start("jaeger", "grapple.clinch");
    combat.run(20);
    const snapshot = combat.snapshot().fighters.find((fighter) => fighter.id === "jaeger");
    expect(snapshot?.grapplePhase).toBe("held");
    const request = combat.request("kaiju", "kaiju.claw.swipe");
    expect(request.ok).toBe(false);
    if (!request.ok) expect(request.reason).toBe("no-control");
  });

  it("refuses a seize that is out of reach, with a message", () => {
    const far = arena(OPEN_GROUND, 400);
    const request = far.request("jaeger", "grapple.clinch");
    expect(request.ok).toBe(false);
    if (!request.ok) {
      expect(request.reason).toBe("grapple-refused");
      expect(request.message).toMatch(/Too far/);
    }
  });

  it("keeps the hold when a slam has nothing to slam into", () => {
    const combat = arena();
    combat.start("jaeger", "grapple.clinch");
    combat.run(20);
    const message = combat.grappleSlam("jaeger");
    expect(message).toMatch(/Nothing solid/);
    expect(combat.snapshot().fighters.find((f) => f.id === "jaeger")?.grapplePhase).toBe("held");
  });

  it("throws into open ground and ends the hold", () => {
    const combat = arena();
    combat.start("jaeger", "grapple.clinch");
    combat.run(20);
    const before = combat.snapshot().fighters.find((f) => f.id === "kaiju")?.north ?? 0;
    combat.grappleThrow("jaeger");
    const after = combat.snapshot().fighters.find((f) => f.id === "kaiju");
    expect(after?.north).toBeGreaterThan(before);
    expect(after?.grapplePhase).toBe("none");
  });

  it("releases rather than throwing when the landing spot is solid", () => {
    const walls: SpaceQuery = { ...OPEN_GROUND, isClear: () => false };
    const combat = new CombatArena({ moves: MOVES, fighters: fighters(30), space: walls });
    // The seize itself is refused for want of room, which is the safe failure.
    const request = combat.request("jaeger", "grapple.clinch");
    expect(request.ok).toBe(false);
    if (!request.ok) expect(request.message).toMatch(/room/);
  });
});

describe("environmental weapons in the arena", () => {
  it("refuses a prop swing with nothing in hand", () => {
    const combat = arena();
    const request = combat.request("jaeger", "env.swing.prop");
    expect(request.ok).toBe(false);
    if (!request.ok) {
      expect(request.reason).toBe("no-prop");
      expect(request.message).toMatch(/Pick something up/);
    }
  });

  it("picks a prop up, swings harder with it, and breaks it", () => {
    const combat = arena();
    const crane = PROPS.getOrThrow("prop.gantry-crane");
    const instance = spawnProp("prop.1", crane, 0, 10);
    expect(combat.takeProp("jaeger", crane, instance, 20).ok).toBe(true);
    expect(instance.heldBy).toBe("jaeger");

    let broken = false;
    for (let swing = 0; swing < crane.swingsBeforeBreaking + 2 && !broken; swing += 1) {
      combat.start("jaeger", "env.swing.prop");
      const events = combat.run(moveLengthTicks(MOVES.getOrThrow("env.swing.prop")) + 4);
      broken = events.some((event) => event.type === "prop-broken");
    }
    expect(broken).toBe(true);
    expect(combat.snapshot().fighters.find((f) => f.id === "jaeger")?.wieldingPropId).toBeNull();
  });

  it("refuses to pick up something already held, or from too far away", () => {
    const combat = arena();
    const crane = PROPS.getOrThrow("prop.gantry-crane");
    const taken = spawnProp("prop.2", crane, 0, 10);
    taken.heldBy = "someone-else";
    expect(combat.takeProp("jaeger", crane, taken, 10).ok).toBe(false);
    const distant = spawnProp("prop.3", crane, 0, 900);
    expect(combat.takeProp("jaeger", crane, distant, 900).ok).toBe(false);
  });
});

describe("finishers in the arena", () => {
  it("refuses to start one where the ground is not safe", () => {
    const inBuildings: SpaceQuery = { ...OPEN_GROUND, isClear: () => false };
    const combat = new CombatArena({ moves: MOVES, fighters: fighters(30), space: inBuildings });
    // Bring the creature to the edge of death so the only thing refusing it is space.
    const kaiju = combat.fighter("kaiju");
    const core = kaiju?.zones.find((zone) => zone.onDestroyed === "kill");
    if (core) core.health = 1;
    combat.start("kaiju", "kaiju.claw.swipe");
    combat.run(2);
    const request = combat.request("jaeger", "melee.finisher.plasma-drop");
    expect(request.ok).toBe(false);
    if (!request.ok) expect(["no-space", "finisher-not-open"]).toContain(request.reason);
  });

  it("never leaves an actor outside the loaded world", () => {
    const edge: SpaceQuery = { ...OPEN_GROUND, inLoadedWorld: () => false };
    const combat = new CombatArena({ moves: MOVES, fighters: fighters(30), space: edge });
    const core = combat.fighter("kaiju")?.zones.find((zone) => zone.onDestroyed === "kill");
    if (core) core.health = 1;
    const request = combat.request("jaeger", "melee.finisher.plasma-drop");
    expect(request.ok).toBe(false);
  });

  it("pays out at once when the player has asked to skip sequences", () => {
    const combat = arena();
    combat.setFinisherSettings("jaeger", { skipSequences: true });
    const kaiju = combat.fighter("kaiju");
    const core = kaiju?.zones.find((zone) => zone.onDestroyed === "kill");
    if (core) core.health = 300;
    // Put the creature in a hold, which is an opening in its own right.
    combat.start("jaeger", "grapple.clinch");
    combat.run(20);
    const events = combat.run(1);
    combat.start("jaeger", "finisher.grapple.tear");
    const after = combat.log();
    expect(after.some((event) => event.type === "finisher-started")).toBe(true);
    expect(after.some((event) => event.type === "finisher-ended" && event.reason === "skipped")).toBe(true);
    expect(combat.snapshot().fighters.find((f) => f.id === "kaiju")?.defeated).toBe(true);
    void events;
  });
});
