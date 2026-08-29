import { ContentRegistry, type RegistryEntry } from "./registry";
import { LOCOMOTION_FAMILIES, type LocomotionFamily, type Medium } from "./locomotionFamilies";
import type { DamageKind } from "./moves";
import type { Goal } from "../kaiju/behavior";
import { validateSenseProfile, type SenseProfile } from "../kaiju/senses";

/**
 * Kaiju, as far as combat needs them.
 *
 * This is the target side of the combat framework: something big enough that
 * "did you hit it" is not a useful question on its own, so a kaiju is a set of
 * body zones with their own health, armour and consequences. A leg going out
 * matters differently from a head going out, and the framework needs that
 * distinction to exist before any behaviour is written on top of it.
 *
 * These are original placeholder designs. Behaviour, mutations, the attack
 * director and everything else about how a kaiju acts arrive with their own
 * milestone; what is here is what an attack lands on.
 */

export const BODY_ZONE_IDS = ["head", "torso", "core", "limb.left", "limb.right", "tail"] as const;
export type BodyZoneId = (typeof BODY_ZONE_IDS)[number];

export interface BodyZone {
  readonly id: BodyZoneId;
  readonly displayName: string;
  /** Where the zone sits, as fractions of the creature's height and length. */
  readonly heightFraction: number;
  readonly forwardMeters: number;
  readonly lateralMeters: number;
  readonly radiusMeters: number;
  readonly health: number;
  /** 0 to 1 of incoming damage absorbed before health is touched. */
  readonly armor: number;
  /**
   * Multiplier on damage that gets through. A core is soft and lethal; a
   * shoulder is neither.
   */
  readonly damageMultiplier: number;
  /** What losing this zone does. Read by reactions, not by a switch on the id. */
  readonly onDestroyed: "none" | "cripple-movement" | "cripple-attack" | "kill";
  readonly description: string;
}

/**
 * A special organ.
 *
 * The thing that makes a creature more than a shape: a sac that spits acid, a
 * sonar bulb that finds you through rubble, a heat sink that lets it enrage.
 * Break it and the ability it grants goes with it, which is checked by the
 * ability lookup rather than by anything switching on a creature name.
 */
export interface SpecialOrgan {
  readonly id: string;
  readonly displayName: string;
  /** The body zone it lives in. Losing that zone destroys the organ. */
  readonly zoneId: BodyZoneId;
  /** Health of its own. It can be shot out without taking the zone. */
  readonly health: number;
  /** What it grants while it works. Read, never switched on. */
  readonly grants: readonly string[];
  readonly description: string;
}

/** Armour plate over a zone that can be broken off before the zone is hurt. */
export interface ArmorPlate {
  readonly zoneId: BodyZoneId;
  readonly health: number;
  /** Fraction of incoming damage the plate absorbs while it holds. */
  readonly absorption: number;
  readonly description: string;
}

/** A limb or tail that can be taken off rather than merely damaged. */
export interface SeverableAppendage {
  readonly zoneId: BodyZoneId;
  /** What stops working when it comes off. */
  readonly disables: readonly string[];
  /** Multiplier on movement once it is gone. One means no effect. */
  readonly movementScale: number;
  readonly description: string;
}

export interface KaijuPhase {
  readonly id: string;
  readonly displayName: string;
  /** Core health fraction at or below which this phase begins. */
  readonly below: number;
  /** Multiplier on damage dealt in this phase. */
  readonly damageScale: number;
  /** Multiplier on movement speed in this phase. */
  readonly speedScale: number;
  readonly description: string;
}

export interface KaijuDefinition extends RegistryEntry {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly heightMeters: number;
  readonly massTons: number;
  /** Total poise. Enough accumulated poise damage staggers it. */
  readonly poise: number;
  /** Seconds a stagger lasts before it recovers. */
  readonly staggerSeconds: number;
  /** Below this fraction of core health it can be finished. */
  readonly finisherThreshold: number;
  readonly zones: readonly BodyZone[];
  /** How it moves. Names a locomotion family; the family carries the numbers. */
  readonly locomotion: LocomotionFamily;
  /** Overrides on the default senses. Anything unlisted uses the default. */
  readonly senses: readonly SenseProfile[];
  /** Weights and traits the behaviour engine reads. Never a name. */
  readonly behavior: {
    readonly weights: Partial<Record<Goal, number>>;
    readonly caution: number;
    readonly objectiveFocus: number;
    readonly appetite: number;
    readonly enrageBelow: number;
  };
  readonly organs: readonly SpecialOrgan[];
  readonly armor: readonly ArmorPlate[];
  readonly severable: readonly SeverableAppendage[];
  /** Multiplier per damage kind. Above one means it hurts more. */
  readonly resistances: Partial<Record<DamageKind, number>>;
  /** Media it would rather be in, best first. Drives where it goes when free. */
  readonly prefers: readonly Medium[];
  readonly phases: readonly KaijuPhase[];
  readonly description: string;
}

function zone(
  id: BodyZoneId,
  displayName: string,
  heightFraction: number,
  forwardMeters: number,
  lateralMeters: number,
  radiusMeters: number,
  health: number,
  armor: number,
  damageMultiplier: number,
  onDestroyed: BodyZone["onDestroyed"],
  description: string,
): BodyZone {
  return {
    id,
    displayName,
    heightFraction,
    forwardMeters,
    lateralMeters,
    radiusMeters,
    health,
    armor,
    damageMultiplier,
    onDestroyed,
    description,
  };
}

const KAIJU: readonly KaijuDefinition[] = [
  {
    id: "kaiju.test-dummy",
    name: "Test Frame",
    category: "training",
    heightMeters: 70,
    massTons: 2_600,
    poise: 220,
    staggerSeconds: 2.2,
    finisherThreshold: 0.25,
    zones: [
      zone(
        "head",
        "Head",
        0.88,
        6,
        0,
        9,
        1_200,
        0.25,
        1.6,
        "cripple-attack",
        "Sensors and jaw. Soft, and it flinches.",
      ),
      zone(
        "torso",
        "Torso",
        0.6,
        0,
        0,
        16,
        4_000,
        0.4,
        1,
        "none",
        "The bulk of it. Nothing decisive lives here.",
      ),
      zone(
        "core",
        "Core",
        0.5,
        -2,
        0,
        7,
        1_800,
        0.15,
        2.2,
        "kill",
        "The thing that keeps it alive, and the only zone that ends it.",
      ),
      zone(
        "limb.left",
        "Left limb",
        0.55,
        2,
        -14,
        8,
        1_500,
        0.3,
        0.9,
        "cripple-attack",
        "Strike arm. Losing it costs the creature its reach.",
      ),
      zone("limb.right", "Right limb", 0.55, 2, 14, 8, 1_500, 0.3, 0.9, "cripple-attack", "The other one."),
      zone(
        "tail",
        "Tail",
        0.35,
        -18,
        0,
        6,
        900,
        0.2,
        0.8,
        "cripple-movement",
        "Balance and sweep. Take it and the creature slows.",
      ),
    ],
    locomotion: "biped",
    senses: [],
    behavior: {
      // A training frame. It stands there, which is exactly what a frame is for.
      weights: { hunt: 0.2, approach: 0.3, retreat: 0, enrage: 0 },
      caution: 0,
      objectiveFocus: 0,
      appetite: 0,
      enrageBelow: 0,
    },
    organs: [],
    armor: [],
    severable: [],
    resistances: {},
    prefers: ["ground"],
    phases: [],
    description:
      "A training frame that stands still and takes hits. Exists so the combat framework can be exercised before any kaiju behaviour is written.",
  },
  {
    id: "kaiju.biped-alpha",
    name: "Knifehead",
    category: "category-3",
    heightMeters: 82,
    massTons: 3_400,
    poise: 320,
    staggerSeconds: 1.8,
    finisherThreshold: 0.2,
    zones: [
      zone(
        "head",
        "Head",
        0.9,
        8,
        0,
        10,
        1_600,
        0.35,
        1.5,
        "cripple-attack",
        "Armoured skull with a soft jaw line.",
      ),
      zone(
        "torso",
        "Torso",
        0.62,
        0,
        0,
        18,
        5_200,
        0.5,
        1,
        "none",
        "Plated. Hitting it is honest work with little to show.",
      ),
      zone(
        "core",
        "Core",
        0.52,
        -3,
        0,
        8,
        2_400,
        0.2,
        2,
        "kill",
        "Behind the plate, and the reason a launcher exists.",
      ),
      zone("limb.left", "Left arm", 0.58, 4, -16, 9, 2_000, 0.4, 0.85, "cripple-attack", "Heavy strike arm."),
      zone(
        "limb.right",
        "Right arm",
        0.58,
        4,
        16,
        9,
        2_000,
        0.4,
        0.85,
        "cripple-attack",
        "The other heavy arm.",
      ),
      zone(
        "tail",
        "Tail",
        0.3,
        -22,
        0,
        7,
        1_200,
        0.25,
        0.8,
        "cripple-movement",
        "Counterweight. It fights worse without it.",
      ),
    ],
    locomotion: "biped",
    senses: [],
    behavior: {
      // A brawler. It comes straight at whatever hit it and stays.
      weights: { approach: 1.3, flank: 0.7, retreat: 0.4, enrage: 1.2, "destroy-objective": 0.6 },
      caution: 0.25,
      objectiveFocus: 0.3,
      appetite: 0.2,
      enrageBelow: 0.25,
    },
    organs: [
      {
        id: "organ.throat-sac",
        displayName: "Throat sac",
        zoneId: "head",
        health: 400,
        grants: ["ability.acid-spit"],
        description: "Swells before it spits. Burst it and the spit stops.",
      },
    ],
    armor: [
      {
        zoneId: "torso",
        health: 1_800,
        absorption: 0.55,
        description: "Chest plate. It comes off in sheets and then the torso is honest work.",
      },
    ],
    severable: [
      {
        zoneId: "tail",
        disables: ["ability.tail-sweep"],
        movementScale: 0.85,
        description: "Counterweight. Take it and it fights and moves worse.",
      },
    ],
    resistances: { heat: 0.8, electrical: 1.3, corrosive: 0.5 },
    prefers: ["ground"],
    phases: [
      {
        id: "phase.wounded",
        displayName: "Wounded",
        below: 0.5,
        damageScale: 1.15,
        speedScale: 0.9,
        description: "Slower and angrier.",
      },
      {
        id: "phase.frenzy",
        displayName: "Frenzy",
        below: 0.25,
        damageScale: 1.5,
        speedScale: 1.2,
        description: "Nothing held back.",
      },
    ],
    description:
      "Original placeholder kaiju used to exercise targeting and damage. Not a film or canon design.",
  },
  {
    id: "kaiju.serpent-delta",
    name: "Otachi",
    category: "category-4",
    heightMeters: 64,
    massTons: 2_600,
    poise: 240,
    staggerSeconds: 1.4,
    finisherThreshold: 0.18,
    zones: [
      zone("head", "Head", 0.95, 14, 0, 8, 1_300, 0.3, 1.7, "cripple-attack", "Blunt and forward."),
      zone("torso", "Coil", 0.5, 0, 0, 14, 4_200, 0.4, 1, "none", "Muscle, all the way down."),
      zone("core", "Heart node", 0.45, -4, 0, 6, 2_400, 0.25, 1.9, "kill", "Behind the coil, and lethal."),
      zone(
        "limb.left",
        "Left fin",
        0.55,
        -2,
        -12,
        6,
        900,
        0.2,
        1,
        "cripple-movement",
        "Steers it in the water.",
      ),
      zone(
        "limb.right",
        "Right fin",
        0.55,
        -2,
        12,
        6,
        900,
        0.2,
        1,
        "cripple-movement",
        "The other side of the same job.",
      ),
      zone("tail", "Tail", 0.25, -30, 0, 6, 1_500, 0.2, 0.9, "cripple-movement", "Most of its length."),
    ],
    locomotion: "serpentine",
    senses: [
      // Nearly blind, and it hears everything. Fighting it in open water is a
      // different problem from fighting the biped on a street.
      {
        kind: "sight",
        rangeMeters: 260,
        decayPerSecond: 0.5,
        arcDeg: 40,
        occlusionScale: 0.02,
        waterScale: 0.6,
      },
      {
        kind: "vibration",
        rangeMeters: 1_800,
        decayPerSecond: 0.1,
        arcDeg: 180,
        occlusionScale: 1,
        waterScale: 1.6,
      },
      {
        kind: "scent",
        rangeMeters: 2_200,
        decayPerSecond: 0.04,
        arcDeg: 180,
        occlusionScale: 0.9,
        waterScale: 1.4,
      },
    ],
    behavior: {
      // An ambusher. It waits in the water and takes what comes to the shore.
      weights: { ambush: 1.8, swim: 1.6, approach: 0.6, flank: 1.1, retreat: 1.2, feed: 1.4 },
      caution: 0.7,
      objectiveFocus: 0.2,
      appetite: 0.8,
      enrageBelow: 0.15,
    },
    organs: [
      {
        id: "organ.sonar-bulb",
        displayName: "Sonar bulb",
        zoneId: "head",
        health: 320,
        grants: ["ability.deep-sense", "sense.vibration"],
        description: "How it finds anything at all. Burst it and it is hunting blind.",
      },
    ],
    armor: [],
    severable: [
      {
        zoneId: "limb.left",
        disables: ["ability.turn-hard"],
        movementScale: 0.7,
        description: "Take a fin and it cannot corner.",
      },
    ],
    resistances: { electrical: 1.6, heat: 0.6, pierce: 1.2 },
    prefers: ["water", "ground"],
    phases: [
      {
        id: "phase.thrash",
        displayName: "Thrashing",
        below: 0.35,
        damageScale: 1.3,
        speedScale: 1.1,
        description: "Whipping, and impossible to stand next to.",
      },
    ],
    description:
      "Original placeholder design. Cannot turn on the spot, hunts by vibration, and would rather be in the water than out of it.",
  },
  {
    id: "kaiju.burrower-sigma",
    name: "Leatherback",
    category: "category-4",
    heightMeters: 58,
    massTons: 4_100,
    poise: 380,
    staggerSeconds: 2.4,
    finisherThreshold: 0.22,
    zones: [
      zone("head", "Drill head", 0.85, 10, 0, 9, 2_200, 0.6, 1.2, "cripple-attack", "Armoured to dig."),
      zone("torso", "Body", 0.5, 0, 0, 16, 5_000, 0.45, 1, "none", "Thick, and full of nothing useful."),
      zone("core", "Gut node", 0.4, -6, 0, 7, 2_600, 0.2, 1.8, "kill", "Soft, deep, and the way to end it."),
      zone("limb.left", "Left claw", 0.45, 6, -13, 7, 1_400, 0.4, 0.9, "cripple-attack", "Digs and hits."),
      zone("limb.right", "Right claw", 0.45, 6, 13, 7, 1_400, 0.4, 0.9, "cripple-attack", "The other one."),
      zone("tail", "Spade", 0.28, -20, 0, 6, 1_100, 0.3, 0.8, "cripple-movement", "Shovels the spoil."),
    ],
    locomotion: "burrower",
    senses: [
      {
        kind: "vibration",
        rangeMeters: 2_400,
        decayPerSecond: 0.06,
        arcDeg: 180,
        occlusionScale: 1,
        waterScale: 0.4,
      },
      {
        kind: "sight",
        rangeMeters: 180,
        decayPerSecond: 0.6,
        arcDeg: 50,
        occlusionScale: 0.01,
        waterScale: 0.2,
      },
      {
        kind: "objective",
        rangeMeters: 9_000,
        decayPerSecond: 0.005,
        arcDeg: 180,
        occlusionScale: 1,
        waterScale: 1,
      },
    ],
    behavior: {
      // A sapper. It ignores the machine and goes for what it came for, under
      // the ground, and only fights when something gets in the way.
      weights: { "destroy-objective": 2, burrow: 1.7, approach: 0.35, ambush: 1.2, retreat: 0.6 },
      caution: 0.4,
      objectiveFocus: 0.95,
      appetite: 0.3,
      enrageBelow: 0.12,
    },
    organs: [
      {
        id: "organ.seismic-node",
        displayName: "Seismic node",
        zoneId: "torso",
        health: 620,
        grants: ["ability.ground-slam", "sense.vibration"],
        description: "What it feels the world with. Destroy it and it loses the ground.",
      },
    ],
    armor: [
      {
        zoneId: "head",
        health: 2_600,
        absorption: 0.7,
        description: "Drill plate. Hitting it in the face is the worst idea available.",
      },
    ],
    severable: [
      {
        zoneId: "limb.right",
        disables: ["ability.dig-fast"],
        movementScale: 0.8,
        description: "One claw gone and it digs at half pace.",
      },
    ],
    resistances: { crush: 0.7, pierce: 0.8, corrosive: 1.4, plasma: 1.3 },
    prefers: ["underground", "ground"],
    phases: [
      {
        id: "phase.surface",
        displayName: "Surfaced",
        below: 0.6,
        damageScale: 1.1,
        speedScale: 0.95,
        description: "Driven up out of the ground, and fighting where it can be reached.",
      },
    ],
    description:
      "Original placeholder design. Goes under the city toward whatever it came for, and treats the machine as an obstacle rather than a target.",
  },
];

export function validateKaiju(entry: KaijuDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("kaiju.")) errors.push('id must start with "kaiju."');
  if (!entry.name) errors.push("name required");
  for (const key of ["heightMeters", "massTons", "poise", "staggerSeconds"] as const) {
    if (!Number.isFinite(entry[key]) || entry[key] <= 0) errors.push(`${key} must be positive`);
  }
  if (entry.finisherThreshold <= 0 || entry.finisherThreshold >= 1) {
    errors.push("finisherThreshold is a fraction of core health, strictly between 0 and 1");
  }
  if (entry.zones.length === 0) errors.push("a kaiju with no zones cannot be hit anywhere");

  const seen = new Set<string>();
  let killZones = 0;
  for (const bodyZone of entry.zones) {
    if (!BODY_ZONE_IDS.includes(bodyZone.id)) errors.push(`unknown zone id "${bodyZone.id}"`);
    if (seen.has(bodyZone.id)) errors.push(`duplicate zone "${bodyZone.id}"`);
    seen.add(bodyZone.id);
    if (bodyZone.health <= 0) errors.push(`zone "${bodyZone.id}" needs positive health`);
    if (bodyZone.armor < 0 || bodyZone.armor >= 1)
      errors.push(`zone "${bodyZone.id}" armor must be within 0 and 1`);
    if (bodyZone.damageMultiplier <= 0)
      errors.push(`zone "${bodyZone.id}" needs a positive damage multiplier`);
    if (bodyZone.radiusMeters <= 0) errors.push(`zone "${bodyZone.id}" needs a positive radius`);
    if (bodyZone.heightFraction < 0 || bodyZone.heightFraction > 1.2) {
      errors.push(`zone "${bodyZone.id}" sits outside the creature`);
    }
    if (!bodyZone.description) errors.push(`zone "${bodyZone.id}" needs a description`);
    if (bodyZone.onDestroyed === "kill") killZones += 1;
  }
  // Exactly one zone may end the creature. None makes it immortal; two makes
  // "which one killed it" a question the log cannot answer.
  if (killZones !== 1) errors.push("exactly one zone must be the one that ends the creature");

  if (!LOCOMOTION_FAMILIES.includes(entry.locomotion)) {
    errors.push(`unknown locomotion family "${String(entry.locomotion)}"`);
  }
  for (const profile of entry.senses) errors.push(...validateSenseProfile(profile));

  const behavior = entry.behavior;
  for (const key of ["caution", "objectiveFocus", "appetite", "enrageBelow"] as const) {
    const value = behavior[key];
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      errors.push(`behavior.${key} must be within [0, 1]`);
    }
  }
  for (const [goal, weight] of Object.entries(behavior.weights)) {
    if (!Number.isFinite(weight) || (weight as number) < 0) {
      errors.push(`behavior.weights.${goal} must be zero or more`);
    }
  }

  // An organ, a plate or a severable limb has to live on a zone this creature
  // actually has, or it can never be destroyed and quietly grants forever.
  for (const organ of entry.organs) {
    if (!seen.has(organ.zoneId)) errors.push(`organ "${organ.id}" sits on a zone this creature lacks`);
    if (organ.health <= 0) errors.push(`organ "${organ.id}" needs positive health`);
    if (organ.grants.length === 0)
      errors.push(`organ "${organ.id}" grants nothing, so losing it costs nothing`);
    if (!organ.description) errors.push(`organ "${organ.id}" needs a description`);
  }
  for (const plate of entry.armor) {
    if (!seen.has(plate.zoneId)) errors.push(`armour sits on a zone this creature lacks: ${plate.zoneId}`);
    if (plate.health <= 0) errors.push(`armour on "${plate.zoneId}" needs positive health`);
    if (plate.absorption <= 0 || plate.absorption >= 1) {
      errors.push(`armour on "${plate.zoneId}" must absorb between none and all of a hit`);
    }
  }
  for (const limb of entry.severable) {
    if (!seen.has(limb.zoneId)) errors.push(`severable "${limb.zoneId}" is not a zone this creature has`);
    if (limb.disables.length === 0 && limb.movementScale === 1) {
      errors.push(`severing "${limb.zoneId}" would cost nothing, so it should not be severable`);
    }
  }
  for (const [kind, scale] of Object.entries(entry.resistances)) {
    if (!Number.isFinite(scale) || (scale as number) < 0) {
      errors.push(`resistance to ${kind} must be zero or more`);
    }
  }
  if (entry.prefers.length === 0) errors.push("a creature must prefer to be somewhere");

  let previous = 1;
  for (const phase of entry.phases) {
    if (phase.below <= 0 || phase.below >= 1) errors.push(`phase "${phase.id}" must trigger inside a fight`);
    if (phase.below >= previous) errors.push(`phase "${phase.id}" must trigger below the one before it`);
    previous = phase.below;
    if (phase.damageScale <= 0 || phase.speedScale <= 0) {
      errors.push(`phase "${phase.id}" scales must be above zero`);
    }
    if (!phase.description) errors.push(`phase "${phase.id}" needs a description`);
  }
  return errors;
}

export function createKaijuRegistry(): ContentRegistry<KaijuDefinition> {
  const registry = new ContentRegistry<KaijuDefinition>(validateKaiju);
  for (const kaiju of KAIJU) registry.register(kaiju);
  return registry;
}

export const KAIJU_DEFINITIONS = KAIJU;

export function zoneOf(kaiju: KaijuDefinition, zoneId: BodyZoneId): BodyZone | undefined {
  return kaiju.zones.find((entry) => entry.id === zoneId);
}

/** Which phase a creature is in at this much core health left. */
export function phaseAt(kaiju: KaijuDefinition, healthFraction: number): KaijuPhase | null {
  let current: KaijuPhase | null = null;
  for (const phase of kaiju.phases) {
    if (healthFraction <= phase.below) current = phase;
  }
  return current;
}

/** Everything this creature grants right now, given which organs still work. */
export function grantedAbilities(
  kaiju: KaijuDefinition,
  organHealth: ReadonlyMap<string, number>,
): readonly string[] {
  const granted: string[] = [];
  for (const organ of kaiju.organs) {
    if ((organHealth.get(organ.id) ?? organ.health) <= 0) continue;
    granted.push(...organ.grants);
  }
  return granted;
}
