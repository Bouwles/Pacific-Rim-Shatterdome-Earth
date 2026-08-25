import { ContentRegistry, type RegistryEntry } from "./registry";
import type { AllyGoal } from "./squadOrders";

/**
 * The crews who fly the other machines.
 *
 * These are not the player's pilots. They are the people the Shatterdome sends
 * out beside you, and the point of them is that they have opinions: one closes
 * whatever you said, one will not stop shooting, one goes wherever somebody is
 * about to be hit. Their personality is a set of weights on the same goal table
 * an order weights, so a crew and an order argue in the same units.
 *
 * What is authored here is where a crew *starts*. What they become is in
 * `src/allies/squad.ts`, because it changes and is saved.
 */

/** How a crew leans, before any order. Multipliers on the ally goal table. */
export type GoalBias = Partial<Record<AllyGoal, number>>;

export interface AllyCrewDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  readonly callsign: string;
  /** 0 to 1. How readily they commit. Low confidence hangs back and asks. */
  readonly baseConfidence: number;
  /** Metres they like to fight at. Drives reposition and suppress scoring. */
  readonly preferredRangeMeters: number;
  /** 0 to 1. How much they want to be the one hitting it. */
  readonly aggression: number;
  /** 0 to 1. How much they cover somebody else instead of scoring. */
  readonly supportTendency: number;
  /** Crews they will not take the same target as, by id. Symmetric, checked. */
  readonly rivals: readonly string[];
  /** Their standing lean, before orders and before anything learned. */
  readonly bias: GoalBias;
  /** Perks they can learn, in the order they learn them. */
  readonly perkTrack: readonly AllyPerk[];
  readonly description: string;
}

/** Something a crew has learned to do. Earned by flying, not bought. */
export interface AllyPerk {
  readonly id: string;
  readonly displayName: string;
  /** Sorties beside the player before it is learned. */
  readonly sortiesRequired: number;
  /** What it changes about how they decide. */
  readonly bias: GoalBias;
  /** Multiplier on the damage they deal. Small: an ally is not the answer. */
  readonly damageScale?: number;
  /** Multiplier on how much punishment they take before going down. */
  readonly structureScale?: number;
  readonly note: string;
}

const DEFINITIONS: readonly AllyCrewDefinition[] = [
  {
    id: "ally.karsten",
    displayName: "Nils and Freya Karsten",
    callsign: "Hammerfall",
    baseConfidence: 0.72,
    preferredRangeMeters: 45,
    aggression: 0.85,
    supportTendency: 0.25,
    rivals: ["ally.oduya"],
    bias: { engage: 1.35, focus: 1.15, withdraw: 0.7, suppress: 0.6 },
    perkTrack: [
      {
        id: "perk.ally.first-in",
        displayName: "First in",
        sortiesRequired: 3,
        bias: { engage: 1.15 },
        damageScale: 1.06,
        note: "They stopped waiting to be told to close.",
      },
      {
        id: "perk.ally.takes-the-hit",
        displayName: "Takes the hit",
        sortiesRequired: 8,
        bias: { screen: 1.3 },
        structureScale: 1.08,
        note: "They put the machine in the way on purpose now.",
      },
    ],
    description: "Siblings, and neither of them has ever backed off from anything.",
  },
  {
    id: "ally.oduya",
    displayName: "Ekene Oduya and Marisol Rivas",
    callsign: "Longshot",
    baseConfidence: 0.66,
    preferredRangeMeters: 240,
    aggression: 0.45,
    supportTendency: 0.5,
    rivals: ["ally.karsten"],
    bias: { suppress: 1.5, reposition: 1.3, engage: 0.65, withdraw: 1.15 },
    perkTrack: [
      {
        id: "perk.ally.steady-hands",
        displayName: "Steady hands",
        sortiesRequired: 3,
        bias: { suppress: 1.2 },
        damageScale: 1.05,
        note: "They stopped wasting rounds on a moving target.",
      },
      {
        id: "perk.ally.reads-the-ground",
        displayName: "Reads the ground",
        sortiesRequired: 8,
        bias: { reposition: 1.25, withdraw: 1.1 },
        note: "They found the firing positions before the fight starts.",
      },
    ],
    description: "Gunnery crew who would rather never be within reach of anything.",
  },
  {
    id: "ally.penrose",
    displayName: "Aoife Penrose and Dmitri Sokolov",
    callsign: "Bulwark",
    baseConfidence: 0.8,
    preferredRangeMeters: 70,
    aggression: 0.4,
    supportTendency: 0.9,
    rivals: [],
    bias: { screen: 1.6, escort: 1.5, assist: 1.35, focus: 0.75 },
    perkTrack: [
      {
        id: "perk.ally.between-them",
        displayName: "Between them",
        sortiesRequired: 3,
        bias: { escort: 1.25, screen: 1.15 },
        structureScale: 1.06,
        note: "They stopped needing to be told where the people were.",
      },
      {
        id: "perk.ally.holds-the-line",
        displayName: "Holds the line",
        sortiesRequired: 8,
        bias: { "hold-position": 1.3 },
        structureScale: 1.1,
        note: "They will not be moved off a block once they have decided on it.",
      },
    ],
    description: "The crew everybody wants beside them and nobody wants to be.",
  },
  {
    id: "ally.abara",
    displayName: "Tomi Abara and Lena Kruse",
    callsign: "Sidestep",
    baseConfidence: 0.58,
    preferredRangeMeters: 110,
    aggression: 0.62,
    supportTendency: 0.55,
    rivals: [],
    bias: { reposition: 1.45, assist: 1.2, "hold-position": 0.6, engage: 0.9 },
    perkTrack: [
      {
        id: "perk.ally.never-there",
        displayName: "Never there",
        sortiesRequired: 3,
        bias: { reposition: 1.2, withdraw: 1.1 },
        note: "They stopped being where the tail came round.",
      },
      {
        id: "perk.ally.opening",
        displayName: "Opening",
        sortiesRequired: 8,
        bias: { assist: 1.3, focus: 1.15 },
        damageScale: 1.07,
        note: "They learned to hit at the moment somebody else made room.",
      },
    ],
    description: "Nervous, fast, and alive because of both.",
  },
];

export function validateAllyCrew(entry: AllyCrewDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("ally.")) errors.push('ally crew ids must start with "ally."');
  if (!entry.callsign) errors.push("callsign required");
  for (const key of ["baseConfidence", "aggression", "supportTendency"] as const) {
    const value = entry[key];
    if (!Number.isFinite(value) || value < 0 || value > 1) errors.push(`${key} must be within [0, 1]`);
  }
  if (!Number.isFinite(entry.preferredRangeMeters) || entry.preferredRangeMeters <= 0) {
    errors.push("preferredRangeMeters must be a real distance");
  }
  if (Object.keys(entry.bias).length === 0) {
    errors.push("a crew with no lean is a crew with no personality");
  }
  if (entry.rivals.includes(entry.id)) errors.push("a crew cannot be its own rival");
  if (entry.perkTrack.length === 0) errors.push("a crew that never learns anything is furniture");

  let previous = 0;
  for (const perk of entry.perkTrack) {
    if (!perk.id.startsWith("perk.ally.")) errors.push('ally perk ids must start with "perk.ally."');
    if (!Number.isInteger(perk.sortiesRequired) || perk.sortiesRequired <= previous) {
      errors.push("perks must be learned in ascending order of sorties flown");
    }
    previous = perk.sortiesRequired;
    // An ally is help, never the answer: nothing here may make one better than
    // the machine the player is actually flying.
    for (const scale of [perk.damageScale, perk.structureScale]) {
      if (scale !== undefined && (!Number.isFinite(scale) || scale <= 0 || scale > 1.15)) {
        errors.push("an ally perk may not scale a number by more than fifteen percent");
      }
    }
    if (perk.note.trim().length < 10) errors.push("say what the crew learned, in words");
  }
  if (entry.description.trim().length < 15) errors.push("say who they are, in words");
  return errors;
}

export function createAllyCrewRegistry(): ContentRegistry<AllyCrewDefinition> {
  const registry = new ContentRegistry<AllyCrewDefinition>(validateAllyCrew);
  for (const entry of DEFINITIONS) registry.register(entry);
  // A rivalry has to name somebody real and has to be returned, the same rule
  // drift affinities follow.
  for (const entry of DEFINITIONS) {
    for (const rival of entry.rivals) {
      const other = registry.get(rival);
      if (!other) throw new Error(`Ally crew "${entry.id}" names "${rival}", who is not registered`);
      if (!other.rivals.includes(entry.id)) {
        throw new Error(`Rivalry between "${entry.id}" and "${rival}" is not returned`);
      }
    }
  }
  return registry;
}

export const ALLY_CREW_DEFINITIONS = DEFINITIONS;

/** Which perks a crew has earned at this many sorties flown beside the player. */
export function perksAt(entry: AllyCrewDefinition, sorties: number): readonly AllyPerk[] {
  return entry.perkTrack.filter((perk) => sorties >= perk.sortiesRequired);
}
