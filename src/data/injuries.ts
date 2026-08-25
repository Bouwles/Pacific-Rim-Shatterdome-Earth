import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * What happens to people in the Conn-Pod.
 *
 * Nothing here kills anybody. A Jaeger crew comes out of a bad drift concussed,
 * burned, or with a shoulder that will not take load, and then they are out of
 * the rotation for a while and somebody else flies. That is the whole design:
 * an injury is a scheduling problem and a reason to know a third pilot, not a
 * character deleted from a save.
 *
 * A restriction is the interesting half. An injured pilot who can still fly is
 * a decision; one who simply cannot is only a delay.
 */

export const INJURY_SEVERITIES = ["minor", "serious", "severe"] as const;
export type InjurySeverity = (typeof INJURY_SEVERITIES)[number];

/**
 * What an injury stops a pilot doing.
 *
 * A fixed vocabulary rather than free text, so a restriction can be checked
 * before deployment instead of only being described.
 */
export const INJURY_RESTRICTIONS = [
  /** Cannot be sent out at all until treated. */
  "grounded",
  /** Can fly, but the drift is harder to hold. */
  "unstable",
  /** Can fly, but not in a machine that leads with its fists. */
  "no-melee",
  /** Can fly, but gunnery suffers. */
  "no-gunnery",
  /** Can fly, but a long sortie will cost them. */
  "short-sorties",
] as const;
export type InjuryRestriction = (typeof INJURY_RESTRICTIONS)[number];

export interface InjuryDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  readonly severity: InjurySeverity;
  readonly restriction: InjuryRestriction;
  /** Days of rest before it clears on its own. */
  readonly recoveryDays: number;
  /** Days saved by treating it in the medical bay. Never all of them. */
  readonly treatmentDaysSaved: number;
  /** How much this drags on drift stability while it is carried, 0 to 1. */
  readonly stabilityPenalty: number;
  /** Minimum stress this leaves behind, so a hurt pilot is not instantly fresh. */
  readonly stressFloor: number;
  readonly description: string;
}

const DEFINITIONS: readonly InjuryDefinition[] = [
  {
    id: "injury.neural-strain",
    displayName: "Neural strain",
    severity: "minor",
    restriction: "unstable",
    recoveryDays: 4,
    treatmentDaysSaved: 2,
    stabilityPenalty: 0.08,
    stressFloor: 0.3,
    description: "The drift went somewhere it should not have. Headaches, and a link that slips.",
  },
  {
    id: "injury.concussion",
    displayName: "Concussion",
    severity: "serious",
    restriction: "grounded",
    recoveryDays: 9,
    treatmentDaysSaved: 3,
    stabilityPenalty: 0.18,
    stressFloor: 0.45,
    description: "Took the inside of the Conn-Pod at speed. Nobody is drifting with this.",
  },
  {
    id: "injury.shoulder-tear",
    displayName: "Shoulder tear",
    severity: "serious",
    restriction: "no-melee",
    recoveryDays: 12,
    treatmentDaysSaved: 4,
    stabilityPenalty: 0.1,
    stressFloor: 0.35,
    description: "The rig tore through the joint on a heavy swing. They can fly, but not swing.",
  },
  {
    id: "injury.hand-burns",
    displayName: "Hand burns",
    severity: "minor",
    restriction: "no-gunnery",
    recoveryDays: 6,
    treatmentDaysSaved: 3,
    stabilityPenalty: 0.05,
    stressFloor: 0.25,
    description: "A coolant line let go across the control gauntlets. Fine until they have to aim.",
  },
  {
    id: "injury.spinal-compression",
    displayName: "Spinal compression",
    severity: "severe",
    restriction: "grounded",
    recoveryDays: 21,
    treatmentDaysSaved: 7,
    stabilityPenalty: 0.26,
    stressFloor: 0.6,
    description: "The worst thing the harness can do to somebody who survives it.",
  },
  {
    id: "injury.drift-fatigue",
    displayName: "Drift fatigue",
    severity: "minor",
    restriction: "short-sorties",
    recoveryDays: 5,
    treatmentDaysSaved: 1,
    stabilityPenalty: 0.06,
    stressFloor: 0.4,
    description: "Too many hours in the harness too close together. They fade late in a fight.",
  },
];

export function validateInjury(entry: InjuryDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("injury.")) errors.push('injury ids must start with "injury."');
  if (!INJURY_SEVERITIES.includes(entry.severity)) errors.push(`unknown severity "${entry.severity}"`);
  if (!INJURY_RESTRICTIONS.includes(entry.restriction)) {
    errors.push(`unknown restriction "${entry.restriction}"`);
  }
  if (!Number.isInteger(entry.recoveryDays) || entry.recoveryDays <= 0) {
    errors.push("recoveryDays must be a positive whole number of days");
  }
  if (!Number.isInteger(entry.treatmentDaysSaved) || entry.treatmentDaysSaved <= 0) {
    errors.push("treatment must save at least a day, or the medical bay is decoration");
  }
  if (entry.treatmentDaysSaved >= entry.recoveryDays) {
    errors.push("treatment cannot remove the whole recovery: an injury has to cost time");
  }
  for (const key of ["stabilityPenalty", "stressFloor"] as const) {
    const value = entry[key];
    if (!Number.isFinite(value) || value < 0 || value > 1) errors.push(`${key} must be within [0, 1]`);
  }
  if (entry.description.trim().length < 10) errors.push("say what it is, in words");
  return errors;
}

export function createInjuryRegistry(): ContentRegistry<InjuryDefinition> {
  const registry = new ContentRegistry<InjuryDefinition>(validateInjury);
  for (const entry of DEFINITIONS) registry.register(entry);
  return registry;
}

export const INJURY_DEFINITIONS = DEFINITIONS;

/**
 * Which injuries a sortie could plausibly cause, given how it went.
 *
 * Ordered worst first so a bad sortie draws from the whole list and a scrape
 * only from the light end. This is a filter over the table rather than a branch
 * per injury, so adding one is a row.
 */
export function injuryPoolFor(severityScore: number): readonly InjuryDefinition[] {
  const allowed: readonly InjurySeverity[] =
    severityScore >= 0.7 ? INJURY_SEVERITIES : severityScore >= 0.4 ? ["minor", "serious"] : ["minor"];
  return DEFINITIONS.filter((entry) => allowed.includes(entry.severity));
}

/** Days left after treatment, which never removes the whole recovery. */
export function treatedRecoveryDays(entry: InjuryDefinition): number {
  return Math.max(1, entry.recoveryDays - entry.treatmentDaysSaved);
}
