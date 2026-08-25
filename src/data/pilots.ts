import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * The people in the Conn-Pod.
 *
 * A Jaeger needs two, and which two matters: the drift is a compatibility
 * between people rather than a stat on one of them. A pair that has fought
 * together holds a stronger link, and a strong link is worth more than either
 * pilot's own numbers.
 *
 * These are original characters. Nothing here is drawn from the films.
 */

export const PILOT_SPECIALISMS = [
  "melee",
  "gunnery",
  "piloting",
  "engineering",
  "science",
  "command",
] as const;
export type PilotSpecialism = (typeof PILOT_SPECIALISMS)[number];

export interface PilotDefinition extends RegistryEntry {
  readonly id: string;
  readonly name: string;
  readonly callsign: string;
  readonly specialisms: readonly PilotSpecialism[];
  /** 0 to 1. How well they hold a drift on their own. */
  readonly neuralStability: number;
  /** 0 to 1. Raw skill, before any of the rest of it. */
  readonly skill: number;
  /** How many sorties they have flown. Feeds experience and fatigue. */
  readonly sorties: number;
  /**
   * Pilots this one drifts unusually well with, by id. Compatibility is
   * symmetric and is looked up rather than switched on.
   */
  readonly affinities: readonly string[];
  readonly biography: string;
}

const PILOTS: readonly PilotDefinition[] = [
  {
    id: "pilot.okonkwo",
    name: "Chidera Okonkwo",
    callsign: "Anvil",
    specialisms: ["melee", "command"],
    neuralStability: 0.82,
    skill: 0.78,
    sorties: 14,
    affinities: ["pilot.varga"],
    biography: "Came up through search and rescue. Fights close and does not back off.",
  },
  {
    id: "pilot.varga",
    name: "Ilona Varga",
    callsign: "Ledger",
    specialisms: ["gunnery", "engineering"],
    neuralStability: 0.79,
    skill: 0.81,
    sorties: 16,
    affinities: ["pilot.okonkwo"],
    biography: "Engineer first, pilot second. Reads a machine's damage before the panel does.",
  },
  {
    id: "pilot.reyes",
    name: "Mateo Reyes",
    callsign: "Kingfisher",
    specialisms: ["piloting", "melee"],
    neuralStability: 0.74,
    skill: 0.86,
    sorties: 9,
    affinities: ["pilot.sato"],
    biography: "The best hands in the bay and the worst temper. Everyone agrees on both.",
  },
  {
    id: "pilot.sato",
    name: "Rin Sato",
    callsign: "Quartz",
    specialisms: ["science", "gunnery"],
    neuralStability: 0.88,
    skill: 0.7,
    sorties: 11,
    affinities: ["pilot.reyes"],
    biography: "Xenobiologist who learned to pilot to get closer to the samples.",
  },
  {
    id: "pilot.ferrant",
    name: "Bo Ferrant",
    callsign: "Tallow",
    specialisms: ["command", "piloting"],
    neuralStability: 0.85,
    skill: 0.66,
    sorties: 22,
    affinities: [],
    biography: "Twenty-two sorties and no partner left from any of them.",
  },
];

export function validatePilot(entry: PilotDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("pilot.")) errors.push('id must start with "pilot."');
  if (!entry.name) errors.push("name required");
  if (!entry.callsign) errors.push("callsign required");
  if (!entry.biography) errors.push("biography required");
  if (entry.specialisms.length === 0) errors.push("a pilot must be good at something");
  for (const specialism of entry.specialisms) {
    if (!PILOT_SPECIALISMS.includes(specialism)) errors.push(`unknown specialism "${specialism}"`);
  }
  for (const key of ["neuralStability", "skill"] as const) {
    const value = entry[key];
    if (!Number.isFinite(value) || value <= 0 || value > 1) errors.push(`${key} must be within (0, 1]`);
  }
  if (!Number.isInteger(entry.sorties) || entry.sorties < 0) {
    errors.push("sorties must be a non-negative integer");
  }
  if (entry.affinities.includes(entry.id)) errors.push("a pilot cannot be their own drift partner");
  return errors;
}

export function createPilotRegistry(): ContentRegistry<PilotDefinition> {
  const registry = new ContentRegistry<PilotDefinition>(validatePilot);
  for (const pilot of PILOTS) registry.register(pilot);
  // An affinity has to name somebody real, and has to be returned.
  for (const pilot of PILOTS) {
    for (const partner of pilot.affinities) {
      const other = registry.get(partner);
      if (!other) throw new Error(`Pilot "${pilot.id}" names "${partner}", who is not registered`);
      if (!other.affinities.includes(pilot.id)) {
        throw new Error(`Drift affinity between "${pilot.id}" and "${partner}" is not returned`);
      }
    }
  }
  return registry;
}

export const PILOT_DEFINITIONS = PILOTS;

/** What a pair is worth in the drift, and why. */
export interface DriftAssessment {
  /** 0 to 1. How strong the link between these two is. */
  readonly strength: number;
  /** 0 to 1. Combined effectiveness the machine actually gets. */
  readonly effectiveness: number;
  /** Plain language, for the planner. */
  readonly summary: string;
  /** True when this pair should not be sent out at all. */
  readonly refused: boolean;
}

/**
 * How well two people drift.
 *
 * Stability holds the link, skill decides what they do with it, and a pair who
 * have flown together hold it better than two strangers who are individually
 * better. A pilot cannot drift with themselves, which is the one hard refusal.
 */
export function assessDrift(
  first: PilotDefinition | undefined,
  second: PilotDefinition | undefined,
): DriftAssessment {
  if (!first || !second) {
    return { strength: 0, effectiveness: 0, summary: "A Jaeger needs two pilots.", refused: true };
  }
  if (first.id === second.id) {
    return { strength: 0, effectiveness: 0, summary: "Nobody drifts with themselves.", refused: true };
  }

  const affinity = first.affinities.includes(second.id) ? 0.25 : 0;
  const stability = (first.neuralStability + second.neuralStability) / 2;
  // A wide gap in stability is its own problem: the steadier one carries the
  // drift and both of them feel it.
  const mismatch = Math.abs(first.neuralStability - second.neuralStability) * 0.5;
  const strength = clamp01(stability + affinity - mismatch);
  const skill = (first.skill + second.skill) / 2;
  const effectiveness = clamp01(skill * (0.6 + strength * 0.5));

  const notes: string[] = [];
  if (affinity > 0) notes.push("they have drifted before");
  if (mismatch > 0.05) notes.push("their stability is unevenly matched");
  const shared = first.specialisms.filter((entry) => second.specialisms.includes(entry));
  if (shared.length > 0) notes.push(`both lean ${shared.join(" and ")}`);
  else notes.push("their strengths do not overlap, which is usually good");

  return {
    strength,
    effectiveness,
    summary: `${Math.round(strength * 100)} percent link: ${notes.join(", ")}.`,
    refused: strength < 0.35,
  };
}

/** Everything a pair is collectively good at. */
export function combinedSpecialisms(
  first: PilotDefinition,
  second: PilotDefinition,
): readonly PilotSpecialism[] {
  return [...new Set([...first.specialisms, ...second.specialisms])];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
