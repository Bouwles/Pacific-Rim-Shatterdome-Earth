import { describe, expect, it } from "vitest";
import {
  CANCEL_TAGS,
  MOVE_DEFINITIONS,
  createMoveRegistry,
  moveLengthTicks,
  phaseAt,
  validateMove,
  type MoveDefinition,
} from "../../src/data/moves";
import { createKaijuRegistry, validateKaiju, type KaijuDefinition } from "../../src/data/kaiju";
import {
  OverlapHistory,
  closestPointOnSegment,
  placeVolume,
  sweepCapsuleAgainstSphere,
} from "../../src/combat/hitVolumes";
import {
  REACTION_DEFINITIONS,
  createReactionRegistry,
  resolveReaction,
  validateReaction,
} from "../../src/combat/reactions";

const MOVES = createMoveRegistry();
const JAB = MOVES.getOrThrow("melee.light.jab");
const HEAVY = MOVES.getOrThrow("melee.heavy.overhead");

function moveWith(overrides: Partial<MoveDefinition>): MoveDefinition {
  return { ...JAB, ...overrides };
}

describe("the move table", () => {
  it("registers every shipped move and validates them all", () => {
    expect(MOVES.all()).toHaveLength(MOVE_DEFINITIONS.length);
    for (const move of MOVE_DEFINITIONS) expect(validateMove(move)).toEqual([]);
  });

  it("refuses an attack with no hit volume, because it could never connect", () => {
    expect(validateMove(moveWith({ volumes: [] })).join(" ")).toMatch(/never connect/);
  });

  it("refuses a cancel window that opens before the move can land", () => {
    const errors = validateMove(moveWith({ cancelFromTick: 1, cancelToTick: 12 }));
    expect(errors.join(" ")).toMatch(/must not open before the active frames/);
  });

  it("refuses a volume that stays live past the move's own active frames", () => {
    const errors = validateMove(
      moveWith({
        volumes: [{ ...(JAB.volumes[0] as NonNullable<(typeof JAB.volumes)[0]>), activeToTick: 99 }],
      }),
    );
    expect(errors.join(" ")).toMatch(/past the move's active frames/);
  });

  it("refuses damage that does nothing and shock outside its own range", () => {
    expect(validateMove(moveWith({ damage: { ...JAB.damage, amount: 0 } })).join(" ")).toMatch(
      /not an attack/,
    );
    expect(validateMove(moveWith({ damage: { ...JAB.damage, componentShock: 4 } })).join(" ")).toMatch(
      /fraction/,
    );
  });

  it("insists on cues, so presentation always has something to resolve", () => {
    const errors = validateMove(moveWith({ cues: { windUp: "", impact: "x", whiff: "y" } }));
    expect(errors.join(" ")).toMatch(/cues/);
  });

  it("only uses cancel tags that exist", () => {
    for (const move of MOVE_DEFINITIONS) {
      expect(CANCEL_TAGS).toContain(move.tag);
      for (const tag of move.cancelInto) expect(CANCEL_TAGS).toContain(tag);
    }
  });

  it("puts phases where the numbers say they are", () => {
    expect(phaseAt(JAB, 0)).toBe("startup");
    expect(phaseAt(JAB, JAB.startupTicks)).toBe("active");
    expect(phaseAt(JAB, JAB.startupTicks + JAB.activeTicks)).toBe("recovery");
    expect(phaseAt(JAB, moveLengthTicks(JAB))).toBe("done");
  });

  it("makes a heavy commit more than a light, which is the whole trade", () => {
    expect(HEAVY.startupTicks).toBeGreaterThan(JAB.startupTicks * 2);
    expect(HEAVY.recoveryTicks).toBeGreaterThan(JAB.recoveryTicks);
    expect(HEAVY.damage.amount).toBeGreaterThan(JAB.damage.amount * 3);
    expect(HEAVY.turnAuthority).toBeLessThan(JAB.turnAuthority);
    expect(HEAVY.staminaCost).toBeGreaterThan(JAB.staminaCost);
  });
});

describe("the kaiju table", () => {
  const kaiju = createKaijuRegistry();

  it("registers every shipped creature with exactly one lethal zone", () => {
    for (const entry of kaiju.all()) {
      expect(validateKaiju(entry)).toEqual([]);
      expect(entry.zones.filter((zone) => zone.onDestroyed === "kill")).toHaveLength(1);
    }
  });

  it("refuses a creature that cannot be killed, or one that can be killed twice", () => {
    const base = kaiju.getOrThrow("kaiju.test-dummy");
    const immortal: KaijuDefinition = {
      ...base,
      zones: base.zones.map((zone) => ({ ...zone, onDestroyed: "none" as const })),
    };
    expect(validateKaiju(immortal).join(" ")).toMatch(/exactly one zone/);
    const twice: KaijuDefinition = {
      ...base,
      zones: base.zones.map((zone) => ({ ...zone, onDestroyed: "kill" as const })),
    };
    expect(validateKaiju(twice).join(" ")).toMatch(/exactly one zone/);
  });

  it("makes the core softer and deadlier than the plate around it", () => {
    for (const entry of kaiju.all()) {
      const core = entry.zones.find((zone) => zone.onDestroyed === "kill");
      const torso = entry.zones.find((zone) => zone.id === "torso");
      if (!core || !torso) throw new Error("expected a core and a torso");
      expect(core.armor).toBeLessThan(torso.armor);
      expect(core.damageMultiplier).toBeGreaterThan(torso.damageMultiplier);
    }
  });
});

describe("hit volumes", () => {
  const attacker = { east: 0, north: 0, up: 0, yawDeg: 0 };

  it("puts a volume in front of the attacker and moves it out over the swing", () => {
    const spec = JAB.volumes[0];
    if (!spec) throw new Error("expected a volume");
    const start = placeVolume(spec, attacker, 75, 0);
    const end = placeVolume(spec, attacker, 75, 1);
    expect(end.b.north).toBeGreaterThan(start.b.north);
    expect(start.b.up).toBeCloseTo(75 * spec.heightFraction, 3);
  });

  it("follows the attacker's facing rather than the world", () => {
    const spec = JAB.volumes[0];
    if (!spec) throw new Error("expected a volume");
    const facingEast = placeVolume(spec, { ...attacker, yawDeg: 90 }, 75, 1);
    expect(facingEast.b.east).toBeGreaterThan(20);
    expect(Math.abs(facingEast.b.north)).toBeLessThan(10);
  });

  it("catches a target the volume passed straight through between ticks", () => {
    // Twenty metres of travel in one tick, with the target sitting in the middle.
    const from = { a: { east: -30, up: 40, north: 0 }, b: { east: -25, up: 40, north: 0 }, radiusMeters: 3 };
    const to = { a: { east: 25, up: 40, north: 0 }, b: { east: 30, up: 40, north: 0 }, radiusMeters: 3 };
    const target = { id: "torso", centre: { east: 0, up: 40, north: 0 }, radiusMeters: 6 };
    const swept = sweepCapsuleAgainstSphere(from, to, target, target);
    expect(swept.hit).toBe(true);
    expect(swept.atFraction).toBeGreaterThan(0);
    expect(swept.atFraction).toBeLessThan(1);
  });

  it("misses what it genuinely misses", () => {
    const from = { a: { east: 0, up: 40, north: 0 }, b: { east: 0, up: 40, north: 10 }, radiusMeters: 3 };
    const target = { id: "torso", centre: { east: 200, up: 40, north: 0 }, radiusMeters: 6 };
    expect(sweepCapsuleAgainstSphere(from, from, target, target).hit).toBe(false);
  });

  it("hits a target that walked into a stationary volume", () => {
    const volume = { a: { east: 0, up: 40, north: 0 }, b: { east: 0, up: 40, north: 20 }, radiusMeters: 4 };
    const before = { id: "torso", centre: { east: 0, up: 40, north: 80 }, radiusMeters: 8 };
    const after = { id: "torso", centre: { east: 0, up: 40, north: 18 }, radiusMeters: 8 };
    expect(sweepCapsuleAgainstSphere(volume, volume, before, after).hit).toBe(true);
  });

  it("puts the closest point on a segment where it belongs", () => {
    const a = { east: 0, up: 0, north: 0 };
    const b = { east: 10, up: 0, north: 0 };
    expect(closestPointOnSegment(a, b, { east: 5, up: 4, north: 0 }).east).toBeCloseTo(5, 5);
    // Clamped to the ends rather than running off the line.
    expect(closestPointOnSegment(a, b, { east: -40, up: 0, north: 0 }).east).toBeCloseTo(0, 5);
    expect(closestPointOnSegment(a, b, { east: 90, up: 0, north: 0 }).east).toBeCloseTo(10, 5);
  });

  it("only lets one volume hit one target once", () => {
    const history = new OverlapHistory();
    expect(history.register("fist.L", "kaiju")).toBe(true);
    expect(history.register("fist.L", "kaiju")).toBe(false);
    // A different volume of the same move is a different hit, on purpose.
    expect(history.register("fist.R", "kaiju")).toBe(true);
    expect(history.size).toBe(2);
  });
});

describe("reactions", () => {
  it("registers every reaction and validates them", () => {
    const registry = createReactionRegistry();
    expect(registry.all()).toHaveLength(REACTION_DEFINITIONS.length);
    for (const reaction of REACTION_DEFINITIONS) expect(validateReaction(reaction)).toEqual([]);
  });

  it("refuses a reaction that takes control away for no time at all", () => {
    const errors = validateReaction({
      ...REACTION_DEFINITIONS[2]!,
      durationTicks: 0,
    });
    expect(errors.join(" ")).toMatch(/must last some ticks/);
  });

  it("absorbs a light hit on a healthy guard and breaks under enough of them", () => {
    const guarded = resolveReaction(JAB.damage, {
      poiseAccumulated: 0,
      poiseCapacity: 200,
      guardRemaining: 100,
      alreadyReeling: false,
      coreHealthFraction: 1,
      finisherThreshold: 0.2,
    });
    expect(guarded.reaction.id).toBe("none");
    expect(guarded.guardRemaining).toBeLessThan(100);

    const broken = resolveReaction(HEAVY.damage, {
      poiseAccumulated: 0,
      poiseCapacity: 200,
      guardRemaining: 20,
      alreadyReeling: false,
      coreHealthFraction: 1,
      finisherThreshold: 0.2,
    });
    expect(broken.guardBroken).toBe(true);
    expect(broken.reaction.id).toBe("guard-break");
  });

  it("turns accumulated poise into a stagger and clears it", () => {
    const outcome = resolveReaction(JAB.damage, {
      poiseAccumulated: 190,
      poiseCapacity: 200,
      guardRemaining: null,
      alreadyReeling: false,
      coreHealthFraction: 1,
      finisherThreshold: 0.2,
    });
    expect(outcome.reaction.id).toBe("stagger");
    expect(outcome.poiseAccumulated).toBe(0);
  });

  it("opens a finisher only when the target is both hurt and open", () => {
    const hurtAndOpen = resolveReaction(HEAVY.damage, {
      poiseAccumulated: 0,
      poiseCapacity: 200,
      guardRemaining: 5,
      alreadyReeling: false,
      coreHealthFraction: 0.1,
      finisherThreshold: 0.25,
    });
    expect(hurtAndOpen.finisherEligible).toBe(true);

    const hurtButStanding = resolveReaction(JAB.damage, {
      poiseAccumulated: 0,
      poiseCapacity: 200,
      guardRemaining: null,
      alreadyReeling: false,
      coreHealthFraction: 0.1,
      finisherThreshold: 0.25,
    });
    expect(hurtButStanding.finisherEligible).toBe(false);

    const openButHealthy = resolveReaction(HEAVY.damage, {
      poiseAccumulated: 0,
      poiseCapacity: 200,
      guardRemaining: 5,
      alreadyReeling: false,
      coreHealthFraction: 0.9,
      finisherThreshold: 0.25,
    });
    expect(openButHealthy.finisherEligible).toBe(false);
  });

  it("scales knockback by the reaction rather than by the packet alone", () => {
    const flinch = resolveReaction(JAB.damage, {
      poiseAccumulated: 0,
      poiseCapacity: 500,
      guardRemaining: null,
      alreadyReeling: false,
      coreHealthFraction: 1,
      finisherThreshold: 0.2,
    });
    expect(flinch.knockbackMps).toBeLessThan(JAB.damage.knockbackMps);
    expect(flinch.knockbackMps).toBeGreaterThan(0);
  });
});
