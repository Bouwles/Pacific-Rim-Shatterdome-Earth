import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * Mastery goals.
 *
 * Long running goals a machine works toward by being flown, tracked per machine
 * rather than per campaign. They exist so that experience is not only a number
 * that goes up: a machine that has pulled forty thousand people out of cities
 * has a different record from one that has never lost a component, and the two
 * are worth different things.
 *
 * A goal reads counters the sortie already produced. Nothing here inspects a
 * fight, and no goal can be progressed by anything except a sortie being
 * reported, which is the same single path everything else is paid through.
 */

/** Counters a machine accumulates. One place, updated once per sortie. */
export interface MasteryCounters {
  /** Sorties flown, whatever the outcome. */
  sorties: number;
  /** Sorties that ended cleanly. */
  victories: number;
  /** Sorties survived without losing a component outright. */
  intact: number;
  /** Thousands of civilians pulled out. */
  rescuedThousands: number;
  /** Tons of salvage recovered. */
  salvageTons: number;
  /** Total structure lost across every sortie, as a count of full machines' worth. */
  damageTaken: number;
}

export function emptyMasteryCounters(): MasteryCounters {
  return {
    sorties: 0,
    victories: 0,
    intact: 0,
    rescuedThousands: 0,
    salvageTons: 0,
    damageTaken: 0,
  };
}

export type MasteryCounter = keyof MasteryCounters;

export interface MasteryDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  /** Which counter it reads. */
  readonly counter: MasteryCounter;
  /** The thresholds, ascending. Each one is a rank of the same goal. */
  readonly thresholds: readonly number[];
  /** Experience granted the first time each threshold is passed. */
  readonly experiencePerRank: number;
  /** What the goal is, in the words the panel shows. */
  readonly description: string;
}

const DEFINITIONS: readonly MasteryDefinition[] = [
  {
    id: "mastery.service",
    displayName: "Service record",
    counter: "sorties",
    thresholds: [5, 20, 60, 150],
    experiencePerRank: 450,
    description: "Sorties flown, whatever came of them.",
  },
  {
    id: "mastery.record",
    displayName: "Winning record",
    counter: "victories",
    thresholds: [3, 12, 40, 100],
    experiencePerRank: 700,
    description: "Sorties that ended cleanly.",
  },
  {
    id: "mastery.unbroken",
    displayName: "Unbroken",
    counter: "intact",
    thresholds: [3, 10, 30, 75],
    experiencePerRank: 800,
    description: "Sorties come home from without losing a component outright.",
  },
  {
    id: "mastery.evacuation",
    displayName: "Evacuation",
    counter: "rescuedThousands",
    thresholds: [40, 200, 800, 2_500],
    experiencePerRank: 550,
    description: "Thousands of civilians pulled out of cities under attack.",
  },
  {
    id: "mastery.salvor",
    displayName: "Salvor",
    counter: "salvageTons",
    thresholds: [1_000, 6_000, 20_000, 60_000],
    experiencePerRank: 450,
    description: "Tons of kaiju and wreckage recovered and hauled home.",
  },
  {
    id: "mastery.punished",
    displayName: "Punished",
    counter: "damageTaken",
    thresholds: [3, 12, 35, 90],
    experiencePerRank: 600,
    description: "Whole machines' worth of structure lost and rebuilt. A record of surviving it.",
  },
];

export function validateMastery(entry: MasteryDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("mastery.")) errors.push('mastery ids must start with "mastery."');
  if (entry.thresholds.length === 0) errors.push("a goal with no thresholds cannot be worked toward");
  for (let index = 1; index < entry.thresholds.length; index += 1) {
    if (entry.thresholds[index]! <= entry.thresholds[index - 1]!) {
      errors.push("thresholds must ascend, or a later rank would be easier than an earlier one");
      break;
    }
  }
  for (const threshold of entry.thresholds) {
    if (!Number.isFinite(threshold) || threshold <= 0) errors.push("every threshold must be positive");
  }
  if (!Number.isFinite(entry.experiencePerRank) || entry.experiencePerRank <= 0) {
    errors.push("a rank that pays nothing is not worth tracking");
  }
  if (entry.description.trim().length < 10) errors.push("say what the goal is, in words");
  return errors;
}

export function createMasteryRegistry(): ContentRegistry<MasteryDefinition> {
  const registry = new ContentRegistry<MasteryDefinition>(validateMastery);
  for (const entry of DEFINITIONS) registry.register(entry);
  return registry;
}

export const MASTERY_DEFINITIONS = DEFINITIONS;

/** How many ranks of a goal these counters have passed. */
export function masteryRank(entry: MasteryDefinition, counters: MasteryCounters): number {
  const value = counters[entry.counter];
  return entry.thresholds.filter((threshold) => value >= threshold).length;
}

export interface MasteryProgress {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly rank: number;
  readonly maxRank: number;
  readonly value: number;
  /** The next threshold, or null when every rank is done. */
  readonly nextThreshold: number | null;
  /** 0 to 1 toward the next rank, or 1 when finished. */
  readonly progress: number;
}

export function masteryProgress(
  registry: ContentRegistry<MasteryDefinition>,
  counters: MasteryCounters,
): readonly MasteryProgress[] {
  return registry.all().map((entry) => {
    const value = counters[entry.counter];
    const rank = masteryRank(entry, counters);
    const next = entry.thresholds[rank] ?? null;
    const previous = rank > 0 ? entry.thresholds[rank - 1]! : 0;
    return {
      id: entry.id,
      displayName: entry.displayName,
      description: entry.description,
      rank,
      maxRank: entry.thresholds.length,
      value: Math.round(value * 10) / 10,
      nextThreshold: next,
      progress: next === null ? 1 : Math.max(0, Math.min(1, (value - previous) / (next - previous))),
    };
  });
}
