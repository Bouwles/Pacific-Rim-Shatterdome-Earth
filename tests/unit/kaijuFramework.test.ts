import { describe, expect, it } from "vitest";
import {
  LOCOMOTION_FAMILIES,
  LOCOMOTION_FAMILY_DEFINITIONS,
  canEnter,
  createLocomotionFamilyRegistry,
  speedIn,
  validateLocomotionFamily,
} from "../../src/data/locomotionFamilies";
import {
  DEFAULT_SENSES,
  SenseSystem,
  validateSenseProfile,
  type SenseStimulus,
} from "../../src/kaiju/senses";
import {
  GOALS,
  createGoalRegistry,
  decide,
  type BehaviorProfile,
  type Situation,
} from "../../src/kaiju/behavior";
import { OPEN_GROUND, SWIM_DEPTH_METERS, nextStep, turnToward } from "../../src/kaiju/navigation";
import { createKaijuRegistry, grantedAbilities, phaseAt, validateKaiju } from "../../src/data/kaiju";
import { Creature } from "../../src/kaiju/creature";

const families = createLocomotionFamilyRegistry();
const goals = createGoalRegistry();
const kaiju = createKaijuRegistry();

function profileFor(familyId: (typeof LOCOMOTION_FAMILIES)[number]): BehaviorProfile {
  return {
    weights: {},
    caution: 0.5,
    objectiveFocus: 0.5,
    appetite: 0.5,
    enrageBelow: 0.2,
    family: families.getOrThrow(familyId),
  };
}

function situation(overrides: Partial<Situation> = {}): Situation {
  return {
    distanceMeters: 300,
    contactConfidence: 0.8,
    healthFraction: 1,
    poiseFraction: 1,
    damageTaken: 0,
    objectiveDistanceMeters: Number.POSITIVE_INFINITY,
    feedDistanceMeters: Number.POSITIVE_INFINITY,
    medium: "ground",
    waterNearby: false,
    climbableNearby: false,
    routeBlocked: false,
    frustration: 0,
    phase: -1,
    ...overrides,
  };
}

describe("locomotion families", () => {
  it("ships every declared family, and they all validate", () => {
    expect(LOCOMOTION_FAMILY_DEFINITIONS.length).toBe(LOCOMOTION_FAMILIES.length);
    for (const family of LOCOMOTION_FAMILY_DEFINITIONS) {
      expect(validateLocomotionFamily(family), family.id).toEqual([]);
    }
  });

  it("covers the nine families the framework promises", () => {
    expect([...LOCOMOTION_FAMILIES]).toEqual([
      "biped",
      "quadruped",
      "serpentine",
      "winged",
      "burrower",
      "swimmer",
      "amphibious",
      "crawler",
      "colossal",
    ]);
  });

  it("refuses a family that prefers a medium it cannot enter", () => {
    const base = families.getOrThrow("biped");
    expect(validateLocomotionFamily({ ...base, preferredMedium: "air" }).join(" ")).toMatch(
      /preferredMedium must be one of the media/,
    );
  });

  it("knows what each family can and cannot enter", () => {
    expect(canEnter(families.getOrThrow("swimmer"), "water")).toBe(true);
    expect(canEnter(families.getOrThrow("quadruped"), "water")).toBe(false);
    expect(speedIn(families.getOrThrow("quadruped"), "water")).toBe(0);
    // A swimmer is faster in water than a biped is anywhere.
    expect(speedIn(families.getOrThrow("swimmer"), "water")).toBeGreaterThan(
      speedIn(families.getOrThrow("biped"), "ground"),
    );
  });

  it("has families that genuinely cannot turn in place", () => {
    expect(families.getOrThrow("serpentine").turnInPlaceDegPerSecond).toBe(0);
    expect(families.getOrThrow("crawler").turnInPlaceDegPerSecond).toBeGreaterThan(0);
  });
});

describe("senses", () => {
  it("ships default profiles that all validate", () => {
    for (const profile of DEFAULT_SENSES) expect(validateSenseProfile(profile), profile.kind).toEqual([]);
  });

  it("picks up what is in front and misses what is behind, for sight", () => {
    const senses = new SenseSystem(DEFAULT_SENSES, 1);
    const ahead: SenseStimulus = { sourceId: "a", east: 0, north: 300, strength: 1, kind: "sight" };
    const behind: SenseStimulus = { sourceId: "b", east: 0, north: -300, strength: 1, kind: "sight" };
    const snapshot = senses.perceive([ahead, behind], { east: 0, north: 0, headingDeg: 0 }, 0.1);
    expect(snapshot.contacts.map((contact) => contact.sourceId)).toEqual(["a"]);
  });

  it("hears and feels what it cannot see", () => {
    const senses = new SenseSystem(DEFAULT_SENSES, 2);
    const behind: SenseStimulus = { sourceId: "b", east: 0, north: -300, strength: 1, kind: "vibration" };
    const snapshot = senses.perceive([behind], { east: 0, north: 0, headingDeg: 0 }, 0.1);
    expect(snapshot.aware).toBe(true);
  });

  it("is nearly blinded by cover but not deafened by it", () => {
    const senses = new SenseSystem(DEFAULT_SENSES, 3);
    senses.perceive(
      [
        { sourceId: "seen", east: 0, north: 200, strength: 1, kind: "sight", occluded: true },
        { sourceId: "heard", east: 0, north: 200, strength: 1, kind: "sound", occluded: true },
      ],
      { east: 0, north: 0, headingDeg: 0 },
      0.1,
    );
    const seen = senses.contact("seen");
    const heard = senses.contact("heard");
    expect(heard!.confidence).toBeGreaterThan(seen?.confidence ?? 0);
  });

  it("forgets what stops making noise", () => {
    const senses = new SenseSystem(DEFAULT_SENSES, 4);
    senses.perceive(
      [{ sourceId: "a", east: 0, north: 100, strength: 1, kind: "sight" }],
      { east: 0, north: 0, headingDeg: 0 },
      0.1,
    );
    expect(senses.contact("a")).toBeDefined();
    for (let step = 0; step < 200; step += 1) {
      senses.perceive([], { east: 0, north: 0, headingDeg: 0 }, 0.5);
    }
    expect(senses.contact("a")).toBeUndefined();
  });

  it("remembers being hurt even by something it never sensed", () => {
    const senses = new SenseSystem(DEFAULT_SENSES, 5);
    senses.remember("sniper", 900, 40, 400);
    const contact = senses.contact("sniper");
    expect(contact).toBeDefined();
    expect(contact!.kind).toBe("damage-memory");
    expect(contact!.damageDealt).toBe(400);
  });
});

describe("the behaviour engine", () => {
  it("registers every declared goal", () => {
    expect(goals.all().length).toBe(GOALS.length);
  });

  it("hunts when it cannot place what it is sensing", () => {
    const decision = decide(goals, situation({ contactConfidence: 0.1 }), profileFor("biped"), null);
    expect(decision.goal).toBe("hunt");
  });

  it("approaches what it is sure about", () => {
    const decision = decide(
      goals,
      situation({ contactConfidence: 0.9, distanceMeters: 200 }),
      profileFor("biped"),
      null,
    );
    expect(decision.goal).toBe("approach");
    expect(decision.reason).toMatch(/m out/);
  });

  it("gives up on the straight line once it has cost enough", () => {
    const stubborn = decide(goals, situation({ frustration: 0 }), profileFor("biped"), "approach");
    const beaten = decide(goals, situation({ frustration: 1 }), profileFor("biped"), "approach");
    expect(stubborn.goal).toBe("approach");
    expect(beaten.goal).toBe("flank");
  });

  it("burrows under a blocked road, but only if it can burrow", () => {
    const digger = decide(goals, situation({ routeBlocked: true }), profileFor("burrower"), null);
    const walker = decide(goals, situation({ routeBlocked: true }), profileFor("biped"), null);
    expect(digger.goal).toBe("burrow");
    expect(walker.goal).not.toBe("burrow");
  });

  it("retreats when hurt and enrages when past caring", () => {
    const hurt = decide(goals, situation({ healthFraction: 0.3 }), profileFor("biped"), null);
    const cornered = decide(goals, situation({ healthFraction: 0.1 }), profileFor("biped"), null);
    expect(hurt.goal).toBe("retreat");
    expect(cornered.goal).toBe("enrage");
  });

  it("prefers the objective when that is what it came for", () => {
    const sapper: BehaviorProfile = {
      ...profileFor("burrower"),
      objectiveFocus: 1,
      weights: { "destroy-objective": 2 },
    };
    const decision = decide(goals, situation({ objectiveDistanceMeters: 300 }), sapper, null);
    expect(decision.goal).toBe("destroy-objective");
  });

  it("does not flicker between two goals a point apart", () => {
    const first = decide(goals, situation({ contactConfidence: 0.9 }), profileFor("biped"), null);
    const again = decide(goals, situation({ contactConfidence: 0.89 }), profileFor("biped"), first.goal);
    expect(again.changed).toBe(false);
  });

  it("explains itself without naming a creature", () => {
    const decision = decide(goals, situation(), profileFor("biped"), null);
    for (const entry of decision.considered) {
      expect(entry.reason.toLowerCase()).not.toMatch(/alpha|delta|sigma|kaiju\./);
    }
  });
});

describe("navigation", () => {
  const family = families.getOrThrow("biped");

  it("takes the straight line when it is clear", () => {
    const step = nextStep({ east: 0, north: 0, headingDeg: 0 }, { east: 0, north: 500 }, family, OPEN_GROUND);
    expect(step.outcome).toBe("direct");
    expect(step.north).toBeGreaterThan(0);
  });

  it("does not assume the ground is flat", () => {
    const cliff = {
      ...OPEN_GROUND,
      groundHeight: (_east: number, north: number) => (north > 30 ? 400 : 0),
    };
    const step = nextStep({ east: 0, north: 0, headingDeg: 0 }, { east: 0, north: 500 }, family, cliff);
    // A biped cannot walk up a 400 m step, so it must find another answer.
    expect(step.outcome).not.toBe("direct");
  });

  it("gives each family its own answer to the same obstacle", () => {
    const blocked = { ...OPEN_GROUND, isPassable: () => false };
    const wall = { ...OPEN_GROUND, groundHeight: (_e: number, north: number) => (north > 30 ? 600 : 0) };
    const target = { east: 0, north: 400 };
    const from = { east: 0, north: 0, headingDeg: 0 };
    // Rubble means nothing to either of these, so they simply keep going.
    expect(nextStep(from, target, families.getOrThrow("burrower"), blocked).outcome).toBe("direct");
    expect(nextStep(from, target, families.getOrThrow("colossal"), blocked).outcome).toBe("direct");
    // A wall is a different question, and they answer it differently.
    expect(nextStep(from, target, families.getOrThrow("burrower"), wall).outcome).toBe("burrow-under");
    expect(nextStep(from, target, families.getOrThrow("colossal"), wall).outcome).toBe("smash-through");
    // Something that neither digs nor smashes goes around what it can go
    // around, and says it is stuck when the whole way is closed.
    const partly = {
      ...OPEN_GROUND,
      isPassable: (east: number) => Math.abs(east) > 20,
    };
    expect(nextStep(from, target, families.getOrThrow("quadruped"), partly).outcome).toBe("detour");
    expect(nextStep(from, target, families.getOrThrow("quadruped"), blocked).outcome).toBe("blocked");
    // A crawler walks up an eighty-degree face without calling it climbing, so
    // the face it has to climb is a sheer one.
    const crawler = nextStep(from, target, families.getOrThrow("crawler"), {
      ...OPEN_GROUND,
      groundHeight: (_e: number, north: number) => (north > 30 ? 4_000 : 0),
      climbableHeight: () => 90,
    });
    expect(crawler.outcome).toBe("climb-over");
  });

  it("swims where a swimmer can and refuses where it cannot", () => {
    const bay = { ...OPEN_GROUND, waterDepth: () => SWIM_DEPTH_METERS + 5 };
    const swimmer = nextStep(
      { east: 0, north: 0, headingDeg: 0 },
      { east: 0, north: 400 },
      families.getOrThrow("swimmer"),
      bay,
    );
    expect(swimmer.outcome).toBe("direct");
    expect(swimmer.medium).toBe("water");
    const walker = nextStep(
      { east: 0, north: 0, headingDeg: 0 },
      { east: 0, north: 400 },
      families.getOrThrow("quadruped"),
      bay,
    );
    expect(walker.outcome).not.toBe("direct");
  });

  it("says so plainly when nothing it can do gets it through", () => {
    const walled = { ...OPEN_GROUND, groundHeight: () => null };
    const step = nextStep(
      { east: 0, north: 0, headingDeg: 0 },
      { east: 0, north: 400 },
      families.getOrThrow("quadruped"),
      walled,
    );
    expect(step.outcome).toBe("blocked");
    expect(step.speedMps).toBe(0);
    expect(step.reason).toMatch(/nothing it can do/);
  });

  it("will not let a serpent pivot on the spot", () => {
    const serpent = families.getOrThrow("serpentine");
    expect(turnToward(0, 90, serpent, 0, 1)).toBe(0);
    expect(turnToward(0, 90, serpent, 10, 1)).toBeGreaterThan(0);
  });
});

describe("creature bodies", () => {
  it("ships three archetypes that all validate", () => {
    expect(kaiju.all().length).toBeGreaterThanOrEqual(3);
    for (const entry of kaiju.all()) expect(validateKaiju(entry), entry.id).toEqual([]);
  });

  it("refuses an organ on a zone the creature does not have", () => {
    const base = kaiju.getOrThrow("kaiju.biped-alpha");
    const errors = validateKaiju({
      ...base,
      organs: [
        {
          id: "organ.nowhere",
          displayName: "Nowhere",
          zoneId: "core",
          health: 10,
          grants: ["x"],
          description: "d",
        },
      ],
      zones: base.zones.filter((zone) => zone.id !== "core"),
    });
    expect(errors.join(" ")).toMatch(/sits on a zone this creature lacks|exactly one zone/);
  });

  it("refuses a severable limb that costs nothing to lose", () => {
    const base = kaiju.getOrThrow("kaiju.biped-alpha");
    const errors = validateKaiju({
      ...base,
      severable: [{ zoneId: "tail", disables: [], movementScale: 1, description: "d" }],
    });
    expect(errors.join(" ")).toMatch(/would cost nothing/);
  });

  it("refuses phases that do not descend", () => {
    const base = kaiju.getOrThrow("kaiju.biped-alpha");
    const errors = validateKaiju({
      ...base,
      phases: [
        { id: "a", displayName: "A", below: 0.3, damageScale: 1, speedScale: 1, description: "d" },
        { id: "b", displayName: "B", below: 0.6, damageScale: 1, speedScale: 1, description: "d" },
      ],
    });
    expect(errors.join(" ")).toMatch(/must trigger below the one before it/);
  });

  it("enters phases as it is worn down", () => {
    const alpha = kaiju.getOrThrow("kaiju.biped-alpha");
    expect(phaseAt(alpha, 1)).toBeNull();
    expect(phaseAt(alpha, 0.4)?.id).toBe("phase.wounded");
    expect(phaseAt(alpha, 0.1)?.id).toBe("phase.frenzy");
  });

  it("loses the ability an organ granted when the organ is destroyed", () => {
    const alpha = kaiju.getOrThrow("kaiju.biped-alpha");
    const creature = new Creature({ definition: alpha, east: 0, north: 0 });
    expect(creature.can("ability.acid-spit")).toBe(true);

    // The throat sac lives in the head, behind no armour.
    for (let hit = 0; hit < 40; hit += 1) creature.absorb("head", 400, "impact");
    expect(creature.can("ability.acid-spit")).toBe(false);
    expect(grantedAbilities(alpha, new Map([["organ.throat-sac", 0]]))).toEqual([]);
  });

  it("takes armour off before the zone under it is honest work", () => {
    const alpha = kaiju.getOrThrow("kaiju.biped-alpha");
    const creature = new Creature({ definition: alpha, east: 0, north: 0 });
    const first = creature.absorb("torso", 1_000, "impact");
    // The plate eats over half of the first blow.
    expect(first.toZone).toBeLessThan(1_000);
    for (let hit = 0; hit < 20; hit += 1) creature.absorb("torso", 1_000, "impact");
    const later = creature.absorb("torso", 1_000, "impact");
    expect(later.toZone).toBeGreaterThan(first.toZone);
  });

  it("applies resistances, so the same blow is worth more or less by kind", () => {
    const alpha = kaiju.getOrThrow("kaiju.biped-alpha");
    const heat = new Creature({ definition: alpha, east: 0, north: 0 }).absorb("head", 500, "heat");
    const shock = new Creature({ definition: alpha, east: 0, north: 0 }).absorb("head", 500, "electrical");
    expect(shock.toZone).toBeGreaterThan(heat.toZone);
  });

  it("slows down and loses what a severed limb was doing", () => {
    const alpha = kaiju.getOrThrow("kaiju.biped-alpha");
    const creature = new Creature({ definition: alpha, east: 0, north: 0 });
    const before = creature.movementScale();
    expect(creature.sever("tail")).toMatch(/severed/);
    expect(creature.movementScale()).toBeLessThan(before);
    // Severing the same thing twice is not an event.
    expect(creature.sever("tail")).toBeNull();
  });
});
