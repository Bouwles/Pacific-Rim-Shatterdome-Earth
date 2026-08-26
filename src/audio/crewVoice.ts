import type { PilotDefinition } from "../data/pilots";
import type { RadioLineDefinition, RadioPriority } from "../data/radioLines";

/**
 * The crew, on the radio.
 *
 * Pilots have had authored dialogue since Milestone 20 and nothing has ever
 * played it, because there was no radio to play it on. This turns those lines
 * into radio lines so they go through the same queue, the same priorities, the
 * same cooldowns and the same conversation record as everything else, rather
 * than becoming a second voice system that talks over the first.
 *
 * The lines themselves are not written here. They come from the pilot's own
 * definition, so a pilot added later speaks without anything in this file
 * changing.
 *
 * Pure. Definitions in, definitions out.
 */

/** The moments a pilot already has lines for. */
export const CREW_MOMENTS = ["onDeploy", "onDamage", "onVictory", "offDuty"] as const;
export type CrewMoment = (typeof CREW_MOMENTS)[number];

/**
 * How important each moment is.
 *
 * Damage speaks over ordinary traffic because it is the crew telling you the
 * machine is in trouble. Off-duty talk is chatter, which means it is dropped
 * rather than queued when anything else is happening, which is exactly right
 * for somebody chatting while a warning is running.
 */
const MOMENT_PRIORITY: Readonly<Record<CrewMoment, RadioPriority>> = {
  onDeploy: "normal",
  onDamage: "high",
  onVictory: "normal",
  offDuty: "chatter",
};

const MOMENT_TRIGGER: Readonly<Record<CrewMoment, string>> = {
  onDeploy: "The machine launches.",
  onDamage: "The machine takes a serious hit.",
  onVictory: "The sortie is won.",
  offDuty: "Downtime at the complex.",
};

/** Seconds before the same crew line may be said again. */
export const CREW_COOLDOWN_SECONDS = 90;
/** Roughly how fast somebody talks, for working out how long a line takes. */
export const SPEAKING_CHARS_PER_SECOND = 14;

/** The id a crew line is registered under. Stable, so cooldowns survive a save. */
export function crewLineId(pilotId: string, moment: CrewMoment, index: number): string {
  return `radio.crew.${pilotId}.${moment}.${index}`;
}

/**
 * Every line a pilot has, as radio lines.
 *
 * They go on the `copilot` speaker, which is the one voice that is in the pod
 * with you rather than on a radio, so it is not band-limited and it does not
 * duck the same things a radio call does.
 *
 * A chattier pilot is not louder or more important. They simply have a shorter
 * cooldown, so they come up more often, which is what chattiness means.
 */
export function crewLines(pilot: PilotDefinition): readonly RadioLineDefinition[] {
  const lines: RadioLineDefinition[] = [];
  const cooldown = Math.round(
    CREW_COOLDOWN_SECONDS * (1.6 - Math.min(1, Math.max(0, pilot.dialogue.chattiness))),
  );

  for (const moment of CREW_MOMENTS) {
    const authored = pilot.dialogue[moment];
    authored.forEach((text, index) => {
      lines.push({
        id: crewLineId(pilot.id, moment, index),
        speaker: "copilot",
        priority: MOMENT_PRIORITY[moment],
        // The pilot's own words, with their callsign in front so the subtitle
        // says who is speaking without a second lookup.
        text: `${pilot.callsign}: ${text}`,
        durationMs: durationOf(text),
        cooldownSeconds: cooldown,
        // Nothing a pilot says is ever allowed to sit on top of a warning.
        interruptible: true,
        trigger: MOMENT_TRIGGER[moment],
        // No recording is promised. These are text lines a real performance
        // could replace later, and until then they arrive as subtitles.
        assetSlot: "",
      });
    });
  }
  return lines;
}

/** How long a line takes to say, floored so a short line is still readable. */
export function durationOf(text: string): number {
  const seconds = text.length / SPEAKING_CHARS_PER_SECOND;
  return Math.round(Math.min(12, Math.max(1.4, seconds)) * 1000);
}
