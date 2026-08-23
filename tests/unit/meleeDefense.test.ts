import { describe, expect, it } from "vitest";
import { createMoveRegistry, chargeScale, validateMove, type MoveDefinition } from "../../src/data/moves";
import { createPropRegistry, spawnProp, validateProp, type PropDefinition } from "../../src/data/props";
import {
  COMBO_WINDOW_TICKS,
  NO_COMBO,
  NO_DEFENSE,
  advanceDefense,
  beginDefense,
  expireCombo,
  isInvulnerable,
  isPerfect,
  registerHit,
  resolveDefense,
} from "../../src/combat/defense";
import {
  MIN_GRAPPLE_MASS_RATIO,
  NO_GRAPPLE,
  advanceGrapple,
  beginGrapple,
  checkGrapple,
  describeGrapple,
  slamTarget,
  throwTarget,
  type GrappleAttempt,
} from "../../src/combat/grapple";
import {
  DEFAULT_FINISHER_SETTINGS,
  MAX_FINISHER_WATER_DEPTH_METERS,
  NO_FINISHER,
  OPEN_GROUND,
  advanceFinisher,
  beginFinisher,
  checkFinisher,
  earnedDamageOf,
  type SpaceQuery,
} from "../../src/combat/finisher";

const MOVES = createMoveRegistry();
const DODGE = MOVES.getOrThrow("defense.dodge.step");
const BLOCK = MOVES.getOrThrow("defense.block.raise");
const PARRY = MOVES.getOrThrow("defense.counter.parry");
const CLINCH = MOVES.getOrThrow("grapple.clinch");
const TEAR = MOVES.getOrThrow("finisher.grapple.tear");
const HAYMAKER = MOVES.getOrThrow("melee.charge.haymaker");

function at(move: MoveDefinition, tick: number) {
  let state = beginDefense(move);
  for (let index = 0; index < tick; index += 1) state = advanceDefense(state);
  return state;
}

describe("dodges", () => {
  it("is invulnerable in the middle of the step and nowhere else", () => {
    expect(isInvulnerable(at(DODGE, 0))).toBe(false);
    expect(isInvulnerable(at(DODGE, 6))).toBe(true);
    expect(isInvulnerable(at(DODGE, 13))).toBe(false);
  });

  it("does not erase weight: it costs stamina, has a recovery, and cancels out of little", () => {
    expect(DODGE.staminaCost).toBeGreaterThan(0);
    expect(DODGE.recoveryTicks).toBeGreaterThan(DODGE.startupTicks);
    // The dodge answers to the evade tag, so only moves that list an evade can
    // cancel into it. A heavy cannot.
    expect(DODGE.tag).toBe("evade");
    expect(MOVES.getOrThrow("melee.heavy.overhead").cancelInto).not.toContain("evade");
  });

  it("says why a mistimed dodge failed, in words", () => {
    const early = resolveDefense(at(DODGE, 0), false);
    const late = resolveDefense(at(DODGE, 13), false);
    expect(early.outcome).toBe("too-early");
    expect(late.outcome).toBe("too-late");
    expect(early.damageScale).toBe(1);
    expect(early.coaching).toMatch(/before the swing/);
    expect(late.coaching).toMatch(/already finished/);
    // Nothing here mentions ticks, windows or frames.
    expect(`${early.coaching} ${late.coaching}`).not.toMatch(/tick|frame|window/i);
  });
});

describe("blocks and parries", () => {
  it("takes nothing on a perfect guard and a quarter on a late one", () => {
    const perfect = resolveDefense(at(BLOCK, 2), true);
    const late = resolveDefense(at(BLOCK, 20), true);
    expect(perfect.outcome).toBe("perfect");
    expect(perfect.damageScale).toBe(0);
    expect(perfect.opensAttacker).toBe(true);
    expect(late.outcome).toBe("blocked");
    expect(late.damageScale).toBeGreaterThan(0);
    expect(late.opensAttacker).toBe(false);
  });

  it("answers a parry with a free counter, and punishes a missed one", () => {
    const parried = resolveDefense(at(PARRY, 4), false);
    expect(parried.outcome).toBe("parried");
    expect(parried.counterMoveId).toBe("melee.light.cross");
    expect(parried.opensAttacker).toBe(true);

    const missed = resolveDefense(at(PARRY, 15), false);
    expect(missed.outcome).toBe("too-late");
    // Worse than not trying: there is no guard behind a missed parry.
    expect(missed.damageScale).toBeGreaterThan(1);
  });

  it("still blocks when simply holding guard, with no defensive move at all", () => {
    const held = resolveDefense(NO_DEFENSE, true);
    expect(held.outcome).toBe("blocked");
    expect(held.damageScale).toBeLessThan(1);
    expect(resolveDefense(NO_DEFENSE, false).outcome).toBe("none");
  });

  it("knows a block has a perfect window and a dodge does not", () => {
    expect(isPerfect(at(BLOCK, 3))).toBe(true);
    expect(isPerfect(at(DODGE, 3))).toBe(false);
  });
});

describe("combos", () => {
  it("counts hits inside the window and drops them outside it", () => {
    let combo = registerHit(NO_COMBO, 100);
    combo = registerHit(combo, 140);
    expect(combo.hits).toBe(2);
    combo = registerHit(combo, 140 + COMBO_WINDOW_TICKS + 10);
    expect(combo.hits).toBe(1);
    expect(combo.bestHits).toBe(2);
  });

  it("expires on its own when nothing lands", () => {
    const combo = registerHit(NO_COMBO, 10);
    expect(expireCombo(combo, 20).hits).toBe(1);
    expect(expireCombo(combo, 10 + COMBO_WINDOW_TICKS + 1).hits).toBe(0);
  });
});

describe("charges", () => {
  it("scales damage with how long it was held, and does nothing for a move that cannot charge", () => {
    expect(chargeScale(HAYMAKER, 0)).toBe(1);
    expect(chargeScale(HAYMAKER, HAYMAKER.chargeTicks ?? 0)).toBeCloseTo(HAYMAKER.chargedDamageScale ?? 1, 5);
    expect(chargeScale(MOVES.getOrThrow("melee.light.jab"), 500)).toBe(1);
  });

  it("refuses a charge that is not worth holding", () => {
    const pointless: MoveDefinition = { ...HAYMAKER, chargedDamageScale: 1 };
    expect(validateMove(pointless).join(" ")).toMatch(/worth charging/);
  });
});

describe("grapples", () => {
  const spec = CLINCH.grapple;
  if (!spec) throw new Error("the clinch has no grapple spec");

  const attempt = (overrides: Partial<GrappleAttempt> = {}): GrappleAttempt => ({
    holderId: "jaeger",
    victimId: "kaiju",
    spec,
    distanceMeters: 20,
    victimHeld: false,
    victimDown: false,
    massRatio: 1,
    clearanceMeters: spec.clearanceMeters + 10,
    ...overrides,
  });

  it("refuses what it cannot take hold of, and says which", () => {
    expect(checkGrapple(attempt()).ok).toBe(true);
    expect(checkGrapple(attempt({ distanceMeters: 500 })).reason).toBe("out-of-reach");
    expect(checkGrapple(attempt({ victimHeld: true })).reason).toBe("already-held");
    expect(checkGrapple(attempt({ victimDown: true })).reason).toBe("target-down");
    expect(checkGrapple(attempt({ massRatio: MIN_GRAPPLE_MASS_RATIO - 0.1 })).reason).toBe(
      "target-too-heavy",
    );
    expect(checkGrapple(attempt({ clearanceMeters: 5 })).reason).toBe("no-space");
    for (const bad of [{ distanceMeters: 500 }, { clearanceMeters: 5 }]) {
      expect(checkGrapple(attempt(bad)).message.length).toBeGreaterThan(10);
    }
  });

  it("lets the victim struggle free, and times out on its own", () => {
    let state = beginGrapple(attempt(), CLINCH.id);
    for (let tick = 0; tick < 400 && state.phase === "held"; tick += 1) {
      state = advanceGrapple(state, { victimEffort: 1, holderGrip: 0, holderInterrupted: false });
    }
    expect(state.outcome).toBe("escaped");

    let patient = beginGrapple(attempt(), CLINCH.id);
    for (let tick = 0; tick < 400 && patient.phase === "held"; tick += 1) {
      // Nobody doing anything: the hold has to end by itself.
      patient = advanceGrapple(patient, { victimEffort: 0.3, holderGrip: 0.6, holderInterrupted: false });
    }
    expect(patient.outcome).toBe("timed-out");
  });

  it("drops the hold when the holder is hit hard enough", () => {
    const state = advanceGrapple(beginGrapple(attempt(), CLINCH.id), {
      victimEffort: 0,
      holderGrip: 1,
      holderInterrupted: true,
    });
    expect(state.outcome).toBe("holder-interrupted");
  });

  it("refuses to throw into a building, and releases instead", () => {
    const state = beginGrapple(attempt(), CLINCH.id);
    const blocked = throwTarget({
      state,
      holderEast: 0,
      holderNorth: 0,
      holderYawDeg: 0,
      isClear: () => false,
      victimRadiusMeters: 20,
    });
    expect(blocked.thrown).toBe(false);
    expect(blocked.state.outcome).toBe("blocked-by-space");
    // And the victim did not move a metre.
    expect(blocked.east).toBe(0);
    expect(blocked.north).toBe(0);
    expect(blocked.message).toMatch(/No room/);
  });

  it("throws into clear ground, the way the holder is facing", () => {
    const thrown = throwTarget({
      state: beginGrapple(attempt(), CLINCH.id),
      holderEast: 0,
      holderNorth: 0,
      holderYawDeg: 90,
      isClear: () => true,
      victimRadiusMeters: 20,
    });
    expect(thrown.thrown).toBe(true);
    expect(thrown.east).toBeCloseTo(spec.throwDistanceMeters, 3);
    expect(Math.abs(thrown.north)).toBeLessThan(0.001);
  });

  it("needs something solid to slam into, and stops short of it", () => {
    const open = slamTarget({
      state: beginGrapple(attempt(), CLINCH.id),
      holderEast: 0,
      holderNorth: 0,
      holderYawDeg: 0,
      isClear: () => true,
      victimRadiusMeters: 20,
    });
    expect(open.thrown).toBe(false);
    expect(open.message).toMatch(/Nothing solid/);

    const wall = slamTarget({
      state: beginGrapple(attempt(), CLINCH.id),
      holderEast: 0,
      holderNorth: 0,
      holderYawDeg: 0,
      isClear: () => false,
      victimRadiusMeters: 20,
    });
    expect(wall.thrown).toBe(true);
    expect(wall.north).toBeLessThan(spec.throwDistanceMeters * 0.45);
  });

  it("describes what happened in plain language", () => {
    expect(describeGrapple(NO_GRAPPLE)).toBe("");
    expect(describeGrapple(beginGrapple(attempt(), CLINCH.id))).toMatch(/hold of them/);
  });
});

describe("finishers", () => {
  const placement = { attackerEast: 0, attackerNorth: 0, targetEast: 40, targetNorth: 0 };

  it("refuses to start where there is no room, deep water, or unloaded world", () => {
    const inBuildings: SpaceQuery = { ...OPEN_GROUND, isClear: () => false };
    const offMap: SpaceQuery = { ...OPEN_GROUND, inLoadedWorld: () => false };
    const deep: SpaceQuery = {
      ...OPEN_GROUND,
      waterDepthMeters: () => MAX_FINISHER_WATER_DEPTH_METERS + 5,
    };
    expect(checkFinisher(TEAR, NO_FINISHER, placement, inBuildings, 20).reason).toBe("no-space");
    expect(checkFinisher(TEAR, NO_FINISHER, placement, offMap, 20).reason).toBe("unsafe-ground");
    expect(checkFinisher(TEAR, NO_FINISHER, placement, deep, 20).reason).toBe("unsafe-ground");
    expect(checkFinisher(TEAR, NO_FINISHER, placement, OPEN_GROUND, 20).ok).toBe(true);
  });

  it("refuses a move that is not a finisher at all", () => {
    expect(checkFinisher(DODGE, NO_FINISHER, placement, OPEN_GROUND, 20).reason).toBe("not-a-finisher");
  });

  it("runs its beats and pays out in full", () => {
    let state = beginFinisher(TEAR, "jaeger", "kaiju", DEFAULT_FINISHER_SETTINGS);
    let total = 0;
    for (let tick = 0; tick < 400 && state.phase === "running"; tick += 1) {
      const step = advanceFinisher(state, {
        holding: true,
        attackerHit: false,
        settings: DEFAULT_FINISHER_SETTINGS,
      });
      state = step.state;
      total += step.damage;
    }
    expect(state.phase).toBe("completed");
    expect(Math.round(total)).toBe(TEAR.finisher?.guaranteedDamage);
  });

  it("stops when the attacker is hit, keeping only what was earned", () => {
    let state = beginFinisher(TEAR, "jaeger", "kaiju", DEFAULT_FINISHER_SETTINGS);
    for (let tick = 0; tick < 40; tick += 1) {
      state = advanceFinisher(state, {
        holding: true,
        attackerHit: false,
        settings: DEFAULT_FINISHER_SETTINGS,
      }).state;
    }
    const banked = earnedDamageOf(state);
    const step = advanceFinisher(state, {
      holding: true,
      attackerHit: true,
      settings: DEFAULT_FINISHER_SETTINGS,
    });
    expect(step.state.phase).toBe("interrupted");
    expect(banked).toBeGreaterThan(0);
    expect(banked).toBeLessThan(TEAR.finisher?.guaranteedDamage ?? 0);
  });

  it("ends early when the player lets go of a beat that asked for the hold", () => {
    const state = beginFinisher(TEAR, "jaeger", "kaiju", DEFAULT_FINISHER_SETTINGS);
    const step = advanceFinisher(state, {
      holding: false,
      attackerHit: false,
      settings: DEFAULT_FINISHER_SETTINGS,
    });
    expect(step.state.phase).toBe("released");
    expect(step.coaching).toMatch(/let go/);
  });

  it("applies the whole outcome at once when sequences are skipped", () => {
    const skipped = beginFinisher(TEAR, "jaeger", "kaiju", {
      ...DEFAULT_FINISHER_SETTINGS,
      skipSequences: true,
    });
    expect(skipped.phase).toBe("skipped");
    expect(earnedDamageOf(skipped)).toBe(TEAR.finisher?.guaranteedDamage);
  });

  it("flattens the camera when reduced motion is on, and still finishes", () => {
    let state = beginFinisher(TEAR, "jaeger", "kaiju", DEFAULT_FINISHER_SETTINGS);
    const settings = { ...DEFAULT_FINISHER_SETTINGS, reducedCameraMotion: true };
    const framings = new Set<string>();
    for (let tick = 0; tick < 400 && state.phase === "running"; tick += 1) {
      const step = advanceFinisher(state, { holding: true, attackerHit: false, settings });
      state = step.state;
      if (state.camera) framings.add(state.camera);
    }
    expect(state.phase).toBe("completed");
    expect([...framings]).toEqual(["wide"]);
  });
});

describe("environmental props", () => {
  const props = createPropRegistry();

  it("validates every shipped prop", () => {
    for (const prop of props.all()) expect(validateProp(prop)).toEqual([]);
  });

  it("refuses a prop that hits harder for free", () => {
    const crane = props.getOrThrow("prop.gantry-crane");
    const free: PropDefinition = { ...crane, startupPenaltyTicks: 0 };
    expect(validateProp(free).join(" ")).toMatch(/mass has to cost time/);
  });

  it("refuses a prop that needs less room than it reaches", () => {
    const ship = props.getOrThrow("prop.container-ship");
    const cramped: PropDefinition = { ...ship, clearanceMeters: 5 };
    expect(validateProp(cramped).join(" ")).toMatch(/at least the prop's own reach/);
  });

  it("makes the heavy ones slower and the light ones weaker", () => {
    const ship = props.getOrThrow("prop.container-ship");
    const rubble = props.getOrThrow("prop.rubble-slab");
    expect(ship.damageScale).toBeGreaterThan(rubble.damageScale);
    expect(ship.startupPenaltyTicks).toBeGreaterThan(rubble.startupPenaltyTicks);
    expect(ship.clearanceMeters).toBeGreaterThan(rubble.clearanceMeters);
  });

  it("spawns an instance with the swings its definition allows", () => {
    const crane = props.getOrThrow("prop.gantry-crane");
    const instance = spawnProp("prop.1", crane, 10, 20);
    expect(instance.swingsLeft).toBe(crane.swingsBeforeBreaking);
    expect(instance.heldBy).toBeNull();
  });
});
