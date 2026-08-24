import { ContentRegistry, type RegistryEntry } from "./registry";
import type { DamagePacket } from "./moves";

/**
 * Ranged weapons and signature abilities.
 *
 * One table, eight behaviours, and every weapon in the game is a row in it. The
 * behaviour decides how a shot travels and what it asks of the world; everything
 * else, ammunition, heat, reactor draw, recoil, range, spread and what the hit
 * does, is numbers on the row.
 *
 * The rule the table exists to enforce is that **ranged fire is never free**.
 * Every row costs at least one of ammunition, heat or reactor draw, and the
 * validator refuses one that costs none of them. A weapon with unlimited
 * ammunition, no heat and no cooldown is not a weapon, it is a passive.
 */

/** How a shot reaches what it is aimed at. */
export const WEAPON_BEHAVIORS = [
  /** A body that travels, and can be outrun or dodged. */
  "projectile",
  /** Sampled along a line the instant it fires. No travel time. */
  "beam",
  /** Everything inside a widening wedge in front of the muzzle. */
  "cone",
  /** A lobbed arc that lands where it was aimed rather than where the target is. */
  "arc",
  /** Several projectiles released over a few ticks. */
  "salvo",
  /** Indirect fire with a minimum range: it cannot hit what is standing on top of it. */
  "mortar",
  /** A line that attaches, holds and drags rather than damaging outright. */
  "tether",
  /** Held down, spending resources continuously while it runs. */
  "channel",
] as const;
export type WeaponBehavior = (typeof WEAPON_BEHAVIORS)[number];

/** What may be pointed at, which is a different question from what may be hit. */
export const AIM_RESTRICTIONS = ["any", "forward-arc", "locked-only"] as const;
export type AimRestriction = (typeof AIM_RESTRICTIONS)[number];

/** Ability tags. Systems read these rather than weapon ids. */
export const ABILITY_TAGS = [
  "signature",
  "burn",
  "shock",
  "corrode",
  "suppress",
  "pull",
  "breach",
  "mobility",
] as const;
export type AbilityTag = (typeof ABILITY_TAGS)[number];

/** What a hit leaves behind on the target, beyond the damage itself. */
export interface StatusApplication {
  readonly statusId: string;
  readonly durationTicks: number;
  /** Stacks up to this many times. One means it refreshes rather than stacking. */
  readonly maxStacks: number;
}

export interface WeaponDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  readonly behavior: WeaponBehavior;
  /** Machines that carry it. Empty means anything can mount it. */
  readonly jaegerIds: readonly string[];
  /** Rounds in a magazine. Zero means it draws straight from the reserve. */
  readonly magazine: number;
  /** Rounds carried in total. Zero means it has no ammunition at all and runs on heat. */
  readonly reserve: number;
  /** Ticks to reload a magazine, or to rearm from the reserve. */
  readonly reloadTicks: number;
  /** Ticks between shots, whatever the ammunition situation. */
  readonly cooldownTicks: number;
  readonly heatCost: number;
  /** Megawatts drawn from the reactor while firing. Charged weapons live here. */
  readonly reactorDrawMw: number;
  /** Metres per second the shot pushes the firer backwards. */
  readonly recoilMps: number;
  readonly rangeMeters: number;
  /** Closer than this and an indirect weapon cannot be used at all. */
  readonly minimumRangeMeters: number;
  /** Metres per second a projectile travels. Zero for a beam or a cone. */
  readonly projectileSpeedMps: number;
  /** Degrees of scatter. Deterministic: drawn from a seeded stream, never Math.random. */
  readonly spreadDeg: number;
  /** Shots released per trigger pull, and how far apart they come. */
  readonly salvoCount: number;
  readonly salvoIntervalTicks: number;
  readonly aim: AimRestriction;
  /** Multiplier on damage and range underwater. Under one for anything that burns. */
  readonly underwaterScale: number;
  /** True when this can hurt anything that is not its target. */
  readonly friendlyFire: boolean;
  readonly damage: DamagePacket;
  readonly tags: readonly AbilityTag[];
  readonly status: StatusApplication | null;
  /** Plain language for the weapon list. No frame data, no jargon. */
  readonly coaching: string;
  readonly description: string;
}

const WEAPONS: readonly WeaponDefinition[] = [
  {
    id: "weapon.plasma-caster",
    displayName: "Plasma caster",
    behavior: "beam",
    jaegerIds: [],
    magazine: 0,
    reserve: 0,
    reloadTicks: 0,
    cooldownTicks: 90,
    heatCost: 34,
    reactorDrawMw: 60,
    recoilMps: 3,
    rangeMeters: 620,
    minimumRangeMeters: 0,
    projectileSpeedMps: 0,
    spreadDeg: 0,
    salvoCount: 1,
    salvoIntervalTicks: 0,
    aim: "forward-arc",
    underwaterScale: 0.55,
    friendlyFire: true,
    damage: {
      amount: 520,
      kind: "plasma",
      poise: 45,
      guardDamage: 80,
      knockbackMps: 4,
      componentShock: 0.35,
      reaction: "flinch",
    },
    tags: ["signature", "burn", "breach"],
    status: { statusId: "status.burning", durationTicks: 240, maxStacks: 3 },
    coaching: "No ammunition to run out of, but every shot is heat. Fire it, then let the machine cool.",
    description: "The signature energy weapon. Instant, expensive in heat, and much weaker underwater.",
  },
  {
    id: "weapon.anti-kaiju-missile",
    displayName: "Anti-kaiju missile",
    behavior: "salvo",
    jaegerIds: [],
    magazine: 6,
    reserve: 18,
    reloadTicks: 180,
    cooldownTicks: 24,
    heatCost: 6,
    reactorDrawMw: 4,
    recoilMps: 1,
    rangeMeters: 900,
    minimumRangeMeters: 60,
    projectileSpeedMps: 180,
    spreadDeg: 3,
    salvoCount: 3,
    salvoIntervalTicks: 6,
    aim: "locked-only",
    underwaterScale: 0.25,
    friendlyFire: true,
    damage: {
      amount: 300,
      kind: "impact",
      poise: 55,
      guardDamage: 45,
      knockbackMps: 9,
      componentShock: 0.25,
      reaction: "stagger",
    },
    tags: ["breach", "suppress"],
    status: null,
    coaching:
      "Three at a time, and there are only so many. Needs a lock, and it will not fire at something in your face.",
    description: "A salvo weapon: slow bodies that can be outrun, but they hit like a building falling.",
  },
  {
    id: "weapon.shoulder-mortar",
    displayName: "Shoulder mortar",
    behavior: "mortar",
    jaegerIds: [],
    magazine: 4,
    reserve: 12,
    reloadTicks: 150,
    cooldownTicks: 60,
    heatCost: 8,
    reactorDrawMw: 2,
    recoilMps: 5,
    rangeMeters: 1_100,
    minimumRangeMeters: 180,
    projectileSpeedMps: 90,
    spreadDeg: 6,
    salvoCount: 1,
    salvoIntervalTicks: 0,
    aim: "any",
    underwaterScale: 0.1,
    friendlyFire: true,
    damage: {
      amount: 420,
      kind: "crush",
      poise: 80,
      guardDamage: 70,
      knockbackMps: 11,
      componentShock: 0.2,
      reaction: "stagger",
    },
    tags: ["suppress", "breach"],
    status: null,
    coaching: "Lobbed, so it lands where you aimed rather than where they are. Useless up close.",
    description: "Indirect fire with a real minimum range, and almost nothing underwater.",
  },
  {
    id: "weapon.rotary-cannon",
    displayName: "Rotary cannon",
    behavior: "projectile",
    jaegerIds: [],
    magazine: 90,
    reserve: 270,
    reloadTicks: 210,
    cooldownTicks: 3,
    heatCost: 1.4,
    reactorDrawMw: 6,
    recoilMps: 0.6,
    rangeMeters: 420,
    minimumRangeMeters: 0,
    projectileSpeedMps: 320,
    spreadDeg: 4.5,
    salvoCount: 1,
    salvoIntervalTicks: 0,
    aim: "forward-arc",
    underwaterScale: 0.4,
    friendlyFire: true,
    damage: {
      amount: 42,
      kind: "pierce",
      poise: 6,
      guardDamage: 8,
      knockbackMps: 0.4,
      componentShock: 0.03,
      reaction: "none",
    },
    tags: ["suppress"],
    status: null,
    coaching: "Held down it empties fast and heats up faster. Short bursts do more than one long one.",
    description:
      "The volume weapon: small rounds, huge magazine, and a reload that takes a fight's worth of time.",
  },
  {
    id: "weapon.arc-whip",
    displayName: "Arc whip",
    behavior: "tether",
    jaegerIds: [],
    magazine: 0,
    reserve: 0,
    reloadTicks: 0,
    cooldownTicks: 150,
    heatCost: 22,
    reactorDrawMw: 40,
    recoilMps: 0,
    rangeMeters: 260,
    minimumRangeMeters: 0,
    projectileSpeedMps: 0,
    spreadDeg: 0,
    salvoCount: 1,
    salvoIntervalTicks: 0,
    aim: "forward-arc",
    underwaterScale: 1.35,
    friendlyFire: false,
    damage: {
      amount: 120,
      kind: "energy",
      poise: 40,
      guardDamage: 30,
      knockbackMps: 0,
      componentShock: 0.4,
      reaction: "flinch",
    },
    tags: ["signature", "shock", "pull"],
    status: { statusId: "status.shocked", durationTicks: 180, maxStacks: 1 },
    coaching:
      "Catches them and drags them toward you. Better in water, not worse, and it does not hurt allies.",
    description: "A tether: it holds rather than kills, and it is the one weapon water makes stronger.",
  },
  {
    id: "weapon.chain-sword",
    displayName: "Chain sword",
    behavior: "channel",
    jaegerIds: [],
    magazine: 0,
    reserve: 0,
    reloadTicks: 0,
    cooldownTicks: 120,
    // Per tick, not per swing: a channel pays this sixty times a second, so it
    // has to be small. At the first pass it was 3.2 and the machine cooked
    // itself in half a second of contact.
    heatCost: 0.55,
    reactorDrawMw: 26,
    recoilMps: 0,
    rangeMeters: 55,
    minimumRangeMeters: 0,
    projectileSpeedMps: 0,
    spreadDeg: 0,
    salvoCount: 1,
    salvoIntervalTicks: 0,
    aim: "forward-arc",
    underwaterScale: 0.85,
    friendlyFire: false,
    damage: {
      amount: 70,
      kind: "shear",
      poise: 12,
      guardDamage: 22,
      knockbackMps: 0.5,
      componentShock: 0.3,
      reaction: "none",
    },
    tags: ["signature", "breach"],
    status: { statusId: "status.bleeding", durationTicks: 300, maxStacks: 4 },
    coaching:
      "Hold it against them. It costs heat every moment it runs, and it cuts deeper the longer it stays on.",
    description:
      "A sustained channel: small damage per tick, enormous over a held second, and it will cook the machine.",
  },
  {
    id: "weapon.booster-strike",
    displayName: "Booster strike",
    behavior: "cone",
    jaegerIds: [],
    magazine: 0,
    reserve: 0,
    reloadTicks: 0,
    cooldownTicks: 300,
    heatCost: 40,
    reactorDrawMw: 55,
    recoilMps: 0,
    rangeMeters: 120,
    minimumRangeMeters: 0,
    projectileSpeedMps: 0,
    spreadDeg: 55,
    salvoCount: 1,
    salvoIntervalTicks: 0,
    aim: "forward-arc",
    underwaterScale: 0.7,
    friendlyFire: true,
    damage: {
      amount: 380,
      kind: "impact",
      poise: 95,
      guardDamage: 120,
      knockbackMps: 18,
      componentShock: 0.3,
      reaction: "knockdown",
    },
    tags: ["signature", "mobility", "breach"],
    status: null,
    coaching:
      "A short burst forward that flattens whatever is in the wedge. Long cooldown: it is an opener, not a rotation.",
    description:
      "The mobility signature: a cone in front of the machine, and it knocks down what it catches.",
  },
];

export function validateWeapon(entry: WeaponDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("weapon.")) errors.push('id must start with "weapon."');
  if (!entry.displayName) errors.push("displayName required");
  if (!WEAPON_BEHAVIORS.includes(entry.behavior)) errors.push(`unknown behavior "${entry.behavior}"`);
  if (!AIM_RESTRICTIONS.includes(entry.aim)) errors.push(`unknown aim restriction "${entry.aim}"`);
  for (const tag of entry.tags) {
    if (!ABILITY_TAGS.includes(tag)) errors.push(`unknown ability tag "${tag}"`);
  }

  for (const key of [
    "magazine",
    "reserve",
    "reloadTicks",
    "cooldownTicks",
    "salvoCount",
    "salvoIntervalTicks",
    "minimumRangeMeters",
  ] as const) {
    const value = entry[key];
    if (!Number.isInteger(value) || value < 0) errors.push(`${key} must be a whole number, zero or more`);
  }
  for (const key of ["heatCost", "reactorDrawMw", "recoilMps", "spreadDeg", "underwaterScale"] as const) {
    if (!Number.isFinite(entry[key]) || entry[key] < 0) errors.push(`${key} must be zero or more`);
  }
  if (entry.rangeMeters <= 0) errors.push("rangeMeters must be positive");
  if (entry.salvoCount < 1) errors.push("salvoCount must be at least one");

  // The rule the whole table exists for: nothing fires for free. A weapon with
  // no ammunition, no heat, no reactor draw and no cooldown would be permanent
  // damage with no decision attached to it.
  const costsAmmunition = entry.magazine > 0 || entry.reserve > 0;
  const costsHeat = entry.heatCost > 0;
  const costsPower = entry.reactorDrawMw > 0;
  const costsTime = entry.cooldownTicks > 0;
  if (!costsAmmunition && !costsHeat && !costsPower) {
    errors.push("a weapon must cost ammunition, heat or reactor draw: ranged fire is never free");
  }
  if (!costsTime && !costsAmmunition) {
    errors.push("a weapon with no ammunition needs a cooldown, or it fires every tick forever");
  }
  if (entry.magazine > 0 && entry.reserve > 0 && entry.reserve < entry.magazine) {
    errors.push("reserve must hold at least one magazine, or the first reload empties the machine");
  }
  if (entry.magazine > 0 && entry.reloadTicks <= 0) {
    errors.push("a magazine weapon needs a reload that takes time");
  }
  if (entry.minimumRangeMeters >= entry.rangeMeters) {
    errors.push("minimumRangeMeters must be inside the weapon's own range");
  }
  if (entry.behavior === "mortar" && entry.minimumRangeMeters <= 0) {
    errors.push("a mortar without a minimum range is a direct-fire weapon wearing a hat");
  }
  if ((entry.behavior === "projectile" || entry.behavior === "salvo") && entry.projectileSpeedMps <= 0) {
    errors.push("a weapon that fires bodies needs a projectile speed");
  }
  if (entry.behavior === "beam" && entry.projectileSpeedMps > 0) {
    errors.push("a beam arrives instantly, so it has no projectile speed");
  }
  if (entry.behavior === "salvo" && entry.salvoCount < 2) {
    errors.push("a salvo of one is a projectile");
  }
  if (entry.damage.amount <= 0) errors.push("a weapon that does no damage is not a weapon");
  if (!entry.coaching) errors.push("coaching line required: the weapon list is written from it");
  if (!entry.description) errors.push("description required");

  const status = entry.status;
  if (status) {
    if (!status.statusId.startsWith("status.")) errors.push('status.statusId must start with "status."');
    if (!Number.isInteger(status.durationTicks) || status.durationTicks <= 0) {
      errors.push("a status effect must last some ticks");
    }
    if (!Number.isInteger(status.maxStacks) || status.maxStacks < 1) {
      errors.push("status.maxStacks must be at least one");
    }
  }
  return errors;
}

export function createWeaponRegistry(): ContentRegistry<WeaponDefinition> {
  const registry = new ContentRegistry<WeaponDefinition>(validateWeapon);
  for (const weapon of WEAPONS) registry.register(weapon);
  return registry;
}

export const WEAPON_DEFINITIONS = WEAPONS;

/** True when a machine may mount this weapon. An empty list means anything may. */
export function fitsJaeger(weapon: WeaponDefinition, jaegerId: string): boolean {
  return weapon.jaegerIds.length === 0 || weapon.jaegerIds.includes(jaegerId);
}

/** Behaviours that put a body in the world rather than resolving instantly. */
export function firesProjectiles(weapon: WeaponDefinition): boolean {
  return weapon.behavior === "projectile" || weapon.behavior === "salvo" || weapon.behavior === "mortar";
}

/** Behaviours resolved the moment the trigger is pulled. */
export function resolvesInstantly(weapon: WeaponDefinition): boolean {
  return weapon.behavior === "beam" || weapon.behavior === "cone" || weapon.behavior === "tether";
}
