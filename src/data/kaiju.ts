import { ContentRegistry, type RegistryEntry } from "./registry";

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
    description:
      "A training frame that stands still and takes hits. Exists so the combat framework can be exercised before any kaiju behaviour is written.",
  },
  {
    id: "kaiju.biped-alpha",
    name: "Alpha Biped",
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
    description:
      "Original placeholder kaiju used to exercise targeting and damage. Not a film or canon design.",
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
