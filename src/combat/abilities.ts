import { ContentRegistry, type RegistryEntry } from "../data/registry";
import type { DamageKind } from "../data/moves";
import type { AbilityTag, WeaponDefinition } from "../data/weapons";

/**
 * Abilities and status effects.
 *
 * Two things live here. **Status effects** are what a weapon leaves behind after
 * the damage has been dealt: burning, shocked, corroded, bleeding, marked. They
 * are a table, they tick on the combat clock, and every one of them says what it
 * does per tick and how it ends.
 *
 * **Ability scoring** is how anything that is not a player chooses a weapon. It
 * is a pure function of the situation and the weapon's own numbers, so an AI, a
 * training hint and a test all reach the same answer, and nothing has to know a
 * weapon by name to have an opinion about it.
 */

export interface StatusDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  /** Damage per tick per stack. Zero for effects that only change behaviour. */
  readonly damagePerTick: number;
  readonly damageKind: DamageKind;
  /** Multiplier on the victim's movement while it lasts. */
  readonly movementScale: number;
  /** Multiplier on the victim's own damage output. */
  readonly damageOutputScale: number;
  /** True when it prevents the victim acting at all. */
  readonly disables: boolean;
  /** True when water washes it off early. */
  readonly quenchedByWater: boolean;
  readonly description: string;
}

const STATUSES: readonly StatusDefinition[] = [
  {
    id: "status.burning",
    displayName: "Burning",
    damagePerTick: 3.2,
    damageKind: "heat",
    movementScale: 1,
    damageOutputScale: 1,
    disables: false,
    quenchedByWater: true,
    description: "Plasma keeps working after the shot lands, and water puts it out.",
  },
  {
    id: "status.shocked",
    displayName: "Shocked",
    damagePerTick: 0.8,
    damageKind: "electrical",
    movementScale: 0.55,
    damageOutputScale: 0.85,
    disables: false,
    quenchedByWater: false,
    description: "Actuators stutter. It slows what it is on rather than killing it.",
  },
  {
    id: "status.bleeding",
    displayName: "Open wound",
    damagePerTick: 2.1,
    damageKind: "shear",
    movementScale: 0.95,
    damageOutputScale: 1,
    disables: false,
    quenchedByWater: false,
    description: "A cut that keeps opening. Stacks, because a chain sword does not cut once.",
  },
  {
    id: "status.corroded",
    displayName: "Corroded",
    damagePerTick: 1.4,
    damageKind: "corrosive",
    movementScale: 1,
    damageOutputScale: 1,
    disables: false,
    quenchedByWater: true,
    description: "Armour thinning from the outside in. Washes off in the sea.",
  },
  {
    id: "status.tethered",
    displayName: "Tethered",
    damagePerTick: 0,
    damageKind: "energy",
    movementScale: 0.25,
    damageOutputScale: 1,
    disables: false,
    quenchedByWater: false,
    description: "Held on a line. It can still fight, it just cannot leave.",
  },
];

export function validateStatus(entry: StatusDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("status.")) errors.push('id must start with "status."');
  if (!entry.displayName) errors.push("displayName required");
  if (!Number.isFinite(entry.damagePerTick) || entry.damagePerTick < 0) {
    errors.push("damagePerTick must be zero or more");
  }
  for (const key of ["movementScale", "damageOutputScale"] as const) {
    if (!Number.isFinite(entry[key]) || entry[key] <= 0) errors.push(`${key} must be positive`);
  }
  if (!entry.description) errors.push("description required");
  // A status that does nothing at all is a status that will be forgotten and
  // then quietly relied on.
  if (
    entry.damagePerTick === 0 &&
    entry.movementScale === 1 &&
    entry.damageOutputScale === 1 &&
    !entry.disables
  ) {
    errors.push("a status effect must do something: damage, movement, output or disabling");
  }
  return errors;
}

export function createStatusRegistry(): ContentRegistry<StatusDefinition> {
  const registry = new ContentRegistry<StatusDefinition>(validateStatus);
  for (const status of STATUSES) registry.register(status);
  return registry;
}

export const STATUS_DEFINITIONS = STATUSES;

/** One effect running on one fighter. */
export interface ActiveStatus {
  readonly statusId: string;
  ticksLeft: number;
  stacks: number;
}

/** Applies or refreshes an effect, respecting its own stack ceiling. */
export function applyStatus(
  active: ActiveStatus[],
  statusId: string,
  durationTicks: number,
  maxStacks: number,
): ActiveStatus[] {
  const existing = active.find((entry) => entry.statusId === statusId);
  if (existing) {
    existing.ticksLeft = Math.max(existing.ticksLeft, durationTicks);
    existing.stacks = Math.min(maxStacks, existing.stacks + 1);
    return active;
  }
  active.push({ statusId, ticksLeft: durationTicks, stacks: 1 });
  return active;
}

export interface StatusTick {
  /** Damage every running effect deals this tick, already multiplied by stacks. */
  readonly damage: number;
  /** Combined movement multiplier. */
  readonly movementScale: number;
  readonly damageOutputScale: number;
  readonly disabled: boolean;
  /** Effects that ended this tick, for the log. */
  readonly ended: readonly string[];
}

/**
 * Advances every effect on a fighter by one tick.
 *
 * Water is not cosmetic here either: anything that burns goes out in the sea,
 * which is the one place the environment reaches directly into combat.
 */
export function advanceStatuses(
  active: ActiveStatus[],
  registry: ContentRegistry<StatusDefinition>,
  inWater: boolean,
): StatusTick {
  let damage = 0;
  let movementScale = 1;
  let damageOutputScale = 1;
  let disabled = false;
  const ended: string[] = [];

  for (let index = active.length - 1; index >= 0; index -= 1) {
    const entry = active[index];
    if (!entry) continue;
    const definition = registry.get(entry.statusId);
    if (!definition) {
      active.splice(index, 1);
      continue;
    }
    if (inWater && definition.quenchedByWater) {
      active.splice(index, 1);
      ended.push(entry.statusId);
      continue;
    }

    damage += definition.damagePerTick * entry.stacks;
    movementScale *= definition.movementScale;
    damageOutputScale *= definition.damageOutputScale;
    disabled = disabled || definition.disables;

    entry.ticksLeft -= 1;
    if (entry.ticksLeft <= 0) {
      active.splice(index, 1);
      ended.push(entry.statusId);
    }
  }

  return { damage, movementScale, damageOutputScale, disabled, ended };
}

/** What a chooser knows about the moment it is choosing in. */
export interface AbilitySituation {
  readonly distanceMeters: number;
  /** 0 to 1 of the target's remaining health on the zone that matters. */
  readonly targetHealthFraction: number;
  readonly targetIsReeling: boolean;
  readonly targetIsHeld: boolean;
  readonly selfHeatFraction: number;
  readonly ammoFraction: number;
  readonly hasLock: boolean;
  readonly underwater: boolean;
  readonly alliesInLine: number;
}

export interface AbilityScore {
  readonly weaponId: string;
  readonly score: number;
  /** Why, in words, for the training hint and the debug view. */
  readonly reason: string;
}

/**
 * How good a weapon is right now, as one number and one sentence.
 *
 * Deliberately a pure function of numbers both sides already have. An AI reads
 * it to pick, the interface reads it to suggest, and a test reads it to prove a
 * mortar is a bad idea at ten metres.
 */
export function scoreWeapon(weapon: WeaponDefinition, situation: AbilitySituation): AbilityScore {
  const reasons: string[] = [];
  let score = 50;

  if (situation.distanceMeters > weapon.rangeMeters) {
    return { weaponId: weapon.id, score: 0, reason: "Out of range." };
  }
  if (situation.distanceMeters < weapon.minimumRangeMeters) {
    return { weaponId: weapon.id, score: 0, reason: "Too close for indirect fire." };
  }
  if (weapon.aim === "locked-only" && !situation.hasLock) {
    return { weaponId: weapon.id, score: 0, reason: "Needs a lock." };
  }
  if (weapon.magazine > 0 && situation.ammoFraction <= 0) {
    return { weaponId: weapon.id, score: 0, reason: "Out of ammunition." };
  }

  // Weapons are best in the middle of their band rather than at the edge of it.
  const band = weapon.rangeMeters - weapon.minimumRangeMeters;
  const through = band <= 0 ? 0.5 : (situation.distanceMeters - weapon.minimumRangeMeters) / band;
  score += (1 - Math.abs(through - 0.5) * 2) * 25;

  // Heat is the thing that stops a fight, so a hot machine should stop reaching
  // for the expensive answers.
  score -= situation.selfHeatFraction * weapon.heatCost * 0.9;
  if (situation.selfHeatFraction > 0.7 && weapon.heatCost > 20) {
    reasons.push("running hot");
  }

  if (situation.underwater) {
    score *= weapon.underwaterScale;
    if (weapon.underwaterScale < 0.6) reasons.push("poor underwater");
    if (weapon.underwaterScale > 1) reasons.push("better underwater");
  }

  if (weapon.friendlyFire && situation.alliesInLine > 0) {
    score -= situation.alliesInLine * 40;
    reasons.push("allies in the line of fire");
  }

  if (situation.targetIsHeld && weapon.tags.includes("pull")) {
    score -= 30;
    reasons.push("already held");
  }
  if (situation.targetIsReeling && weapon.damage.amount > 300) {
    score += 20;
    reasons.push("target is open");
  }
  if (situation.targetHealthFraction < 0.25 && weapon.tags.includes("breach")) {
    score += 15;
    reasons.push("nearly finished");
  }

  return {
    weaponId: weapon.id,
    score: Math.max(0, score),
    reason: reasons.length > 0 ? reasons.join(", ") : "in its element",
  };
}

/** Ranks a loadout for a situation, best first. */
export function rankWeapons(
  weapons: readonly WeaponDefinition[],
  situation: AbilitySituation,
): readonly AbilityScore[] {
  return weapons.map((weapon) => scoreWeapon(weapon, situation)).sort((a, b) => b.score - a.score);
}

/** Every weapon carrying a tag. The registry lookup abilities are keyed on. */
export function weaponsWithTag(
  weapons: readonly WeaponDefinition[],
  tag: AbilityTag,
): readonly WeaponDefinition[] {
  return weapons.filter((weapon) => weapon.tags.includes(tag));
}
