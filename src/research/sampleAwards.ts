import { SAMPLE_DEFINITIONS, type SampleDefinition } from "../data/samples";
import type { BodyZoneId } from "../data/kaiju";
import type { MutationKind } from "../data/mutations";

/**
 * What a fight yielded, worked out from what happened in it.
 *
 * Every sample is awarded by a rule that reads the fight, so adding a sample is
 * a row in the table rather than a branch in a function, and nothing here knows
 * a creature or a weapon by name.
 *
 * The rule that stops this being a farm: **familiarity**. The first time a
 * category gives up a particular sample it gives up all of it; the tenth time it
 * gives up a fraction. Repeating the easiest fight forever converges on nothing,
 * while going after something you have not fought pays in full. That is the
 * difference between a reason to vary what you do and a reason to grind.
 *
 * Pure. No RNG, no clock, no world. A fight goes in as a record of what
 * happened, samples come out.
 */

/** How a fight ended, as far as sample recovery is concerned. */
export const FINISH_KINDS = ["attrition", "finisher", "captured", "escaped"] as const;
export type FinishKind = (typeof FINISH_KINDS)[number];

/** Everything the award rules are allowed to read. */
export interface FightRecord {
  /** Kaiju category, which is what familiarity is tracked against. */
  readonly category: string;
  /** True when the creature was actually put down or taken. */
  readonly defeated: boolean;
  readonly finish: FinishKind;
  /** Zones destroyed or severed before it went down. */
  readonly zonesDestroyed: readonly BodyZoneId[];
  /** Mutation kinds it was carrying. */
  readonly mutationKinds: readonly MutationKind[];
  /** Damage kind that did most of the work. */
  readonly dominantDamageKind: string;
  /** Where it happened: a medium, or weather worth naming. */
  readonly environment: readonly string[];
  /** Objective ids that were met. */
  readonly objectivesMet: readonly string[];
  /**
   * How well the sortie went, 0 to 1.
   *
   * Recovery is worse from a shambles. This scales what comes back rather than
   * gating it, so a bad fight still pays something.
   */
  readonly objectiveScore: number;
}

/** How many of each category's samples have already been taken. */
export type FamiliarityLog = Readonly<Record<string, number>>;

export interface SampleAward {
  readonly sampleId: string;
  readonly count: number;
  /** Why it came back, in words, for the results screen. */
  readonly reason: string;
}

export interface AwardOptions {
  /**
   * Times this exact sample has already been recovered from this category.
   *
   * Keyed `${category}|${sampleId}`. Missing means never.
   */
  readonly familiarity?: FamiliarityLog;
  /**
   * Recovery multiplier from the complex and from research, one being stock.
   *
   * Facility salvage yield and the dissection protocol both land here, which is
   * how a research benefit reaches recovery without recovery knowing about
   * research.
   */
  readonly recoveryMultiplier?: number;
}

/**
 * How much a repeat is worth.
 *
 * The first is worth all of it, the second most of it, and it decays towards a
 * floor rather than to zero: something is always worth taking, and nothing is
 * ever worth taking over and over. The floor exists so that a player who has to
 * replace a lost sample can, however many times they have done it before.
 */
export const FAMILIARITY_FLOOR = 0.25;
export const FAMILIARITY_HALF_LIFE = 3;

export function familiarityFactor(timesTaken: number): number {
  if (timesTaken <= 0) return 1;
  const decayed = FAMILIARITY_HALF_LIFE / (FAMILIARITY_HALF_LIFE + timesTaken);
  return FAMILIARITY_FLOOR + (1 - FAMILIARITY_FLOOR) * decayed;
}

/** One row of the table: does this fight satisfy this sample's condition. */
type Condition = (sample: SampleDefinition, fight: FightRecord) => boolean;

const CONDITIONS: Readonly<Record<string, Condition>> = {
  "any-kill": (_sample, fight) => fight.defeated,
  "zone-destroyed": (sample, fight) =>
    fight.defeated && sample.zoneId !== undefined && fight.zonesDestroyed.includes(sample.zoneId),
  mutation: (sample, fight) =>
    fight.defeated && sample.mutationKind !== undefined && fight.mutationKinds.includes(sample.mutationKind),
  captured: (_sample, fight) => fight.finish === "captured",
  finisher: (_sample, fight) => fight.finish === "finisher",
  "damage-kind": (sample, fight) => fight.defeated && fight.dominantDamageKind === sample.qualifier,
  environment: (sample, fight) =>
    fight.defeated && sample.qualifier !== undefined && fight.environment.includes(sample.qualifier),
  objective: (sample, fight) =>
    sample.qualifier !== undefined && fight.objectivesMet.includes(sample.qualifier),
};

/** Why a sample came back, said in a way a person would say it. */
function reasonFor(sample: SampleDefinition): string {
  switch (sample.trigger) {
    case "any-kill":
      return "Recovered from the carcass.";
    case "zone-destroyed":
      return `The ${String(sample.zoneId).replace(".", " ")} came apart, so it could be reached.`;
    case "mutation":
      return `It was carrying ${sample.mutationKind} growth.`;
    case "captured":
      return "Taken alive.";
    case "finisher":
      return "A clean finish left it whole.";
    case "damage-kind":
      return `Brought down mostly by ${sample.qualifier} damage.`;
    case "environment":
      return `Recovered in ${sample.qualifier}.`;
    default:
      return `Off the back of the ${String(sample.qualifier).replace("-", " ")} objective.`;
  }
}

/**
 * Works out what a fight yielded.
 *
 * A creature that got away yields nothing off its body but can still yield what
 * the objectives produced, because an evacuation that worked is a record whether
 * or not anything died.
 */
export function awardSamples(
  fight: FightRecord,
  options: AwardOptions = {},
): { readonly awards: readonly SampleAward[]; readonly familiarity: FamiliarityLog } {
  const familiarity: Record<string, number> = { ...(options.familiarity ?? {}) };
  const recovery = Math.max(0, options.recoveryMultiplier ?? 1);
  const quality = 0.55 + Math.max(0, Math.min(1, fight.objectiveScore)) * 0.45;
  const awards: SampleAward[] = [];

  for (const sample of SAMPLE_DEFINITIONS) {
    const condition = CONDITIONS[sample.trigger];
    if (!condition || !condition(sample, fight)) continue;

    const key = `${fight.category}|${sample.id}`;
    const seen = familiarity[key] ?? 0;
    const raw = sample.yieldCount * familiarityFactor(seen) * recovery * quality;
    // Rounds up from anything above nothing: a sample that qualified must come
    // back, or a rule that fired would silently produce zero and read as a bug.
    const count = raw > 0 ? Math.max(1, Math.round(raw)) : 0;
    if (count <= 0) continue;

    awards.push({ sampleId: sample.id, count, reason: reasonFor(sample) });
    familiarity[key] = seen + 1;
  }

  return { awards, familiarity };
}

/**
 * What is always available, whatever a player fights.
 *
 * Used by the test that proves no core research node can be stranded behind a
 * sample that a given campaign might never see.
 */
export function alwaysObtainableSampleIds(): readonly string[] {
  return SAMPLE_DEFINITIONS.filter((sample) => sample.trigger === "any-kill").map((sample) => sample.id);
}
