import { ContentRegistry } from "../data/registry";
import {
  AUDIO_BUSES,
  AUDIO_BUS_IDS,
  createAudioBusRegistry,
  type AudioBusDefinition,
  type AudioBusId,
} from "../data/audioBuses";

/**
 * What every bus is actually set to, once the player and the ducking have both
 * had their say.
 *
 * Pure. Levels in, levels out. That is what lets "a radio call ducks the music
 * but never the accessibility cues" be a unit test rather than something judged
 * by ear.
 *
 * No WebAudio here. The engine layer reads these numbers and applies them; this
 * decides what they are.
 */

export const MIXER_SCHEMA_VERSION = 1;

/** The player's own levels, one per bus. */
export type MixerLevels = Readonly<Record<AudioBusId, number>>;

export function defaultLevels(
  registry: ContentRegistry<AudioBusDefinition> = createAudioBusRegistry(),
): MixerLevels {
  const levels = {} as Record<AudioBusId, number>;
  for (const bus of registry.all()) levels[bus.id] = bus.defaultLevel;
  return levels;
}

export function validateLevels(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return ["mixer levels must be an object"];
  const levels = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const id of AUDIO_BUS_IDS) {
    const level = levels[id];
    if (typeof level !== "number" || !Number.isFinite(level)) {
      errors.push(`${id} level must be a number`);
    } else if (level < 0 || level > 1) {
      errors.push(`${id} level must be between 0 and 1`);
    }
  }
  return errors;
}

/** Puts levels back inside their range rather than refusing them. */
export function normaliseLevels(value: Partial<MixerLevels> | undefined): MixerLevels {
  const base = defaultLevels();
  if (!value) return base;
  const levels = {} as Record<AudioBusId, number>;
  for (const id of AUDIO_BUS_IDS) {
    const level = value[id];
    levels[id] = typeof level === "number" && Number.isFinite(level) ? clamp01(level) : base[id];
  }
  return levels;
}

/** Something currently asking to be heard over everything quieter than it. */
export interface DuckRequest {
  readonly busId: AudioBusId;
  /** 0 to 1 of how hard it is pushing. A shout ducks more than a mutter. */
  readonly strength: number;
}

/** What one bus ends up at, and why. */
export interface ResolvedBus {
  readonly id: AudioBusId;
  /** The player's own setting. */
  readonly requested: number;
  /** After ducking, before the master. */
  readonly ducked: number;
  /** What the engine should actually apply, master included. */
  readonly effective: number;
  /** Null when nothing pulled it down. */
  readonly duckedBy: AudioBusId | null;
}

/**
 * Works out where every fader ends up.
 *
 * A bus is only ducked by a bus with a higher duck priority, so ambience can
 * never quieten a radio call, and a bus with a duck depth of zero is never
 * touched at all. The master multiplies everything at the end rather than being
 * ducked itself, because ducking the master would duck the thing doing the
 * ducking.
 */
export function resolveMix(
  levels: MixerLevels,
  ducking: readonly DuckRequest[] = [],
  registry: ContentRegistry<AudioBusDefinition> = createAudioBusRegistry(),
): readonly ResolvedBus[] {
  const buses = registry.all();
  const master = levels.master;

  return buses.map((bus) => {
    const requested = clamp01(levels[bus.id] ?? bus.defaultLevel);
    if (bus.id === "master") {
      return { id: bus.id, requested, ducked: requested, effective: requested, duckedBy: null };
    }

    let deepest = 0;
    let culprit: AudioBusId | null = null;
    if (bus.duckDepth > 0) {
      for (const request of ducking) {
        const source = registry.get(request.busId);
        if (!source || source.duckPriority <= bus.duckPriority) continue;
        const depth = bus.duckDepth * clamp01(request.strength);
        if (depth > deepest) {
          deepest = depth;
          culprit = source.id;
        }
      }
    }

    const ducked = clamp01(requested * (1 - deepest));
    return {
      id: bus.id,
      requested,
      ducked,
      effective: clamp01(ducked * master),
      duckedBy: culprit,
    };
  });
}

/** The effective level for one bus, for callers that only need the one. */
export function levelOf(
  busId: AudioBusId,
  levels: MixerLevels,
  ducking: readonly DuckRequest[] = [],
  registry: ContentRegistry<AudioBusDefinition> = createAudioBusRegistry(),
): number {
  return resolveMix(levels, ducking, registry).find((bus) => bus.id === busId)?.effective ?? 0;
}

/**
 * Whether anything a player must be able to perceive has been silenced.
 *
 * Used by the test that proves no combination of settings and ducking can mute
 * an accessibility cue or a critical radio call.
 */
export function safetyBusesAudible(levels: MixerLevels, ducking: readonly DuckRequest[] = []): boolean {
  if (levels.master <= 0) return false;
  const resolved = resolveMix(levels, ducking);
  const accessibility = resolved.find((bus) => bus.id === "accessibility");
  const radio = resolved.find((bus) => bus.id === "radio");
  // Their own faders may be turned down by the player, which is their choice.
  // What must never happen is ducking taking them below what was asked for.
  return (
    accessibility !== undefined &&
    radio !== undefined &&
    accessibility.ducked >= accessibility.requested &&
    radio.ducked >= radio.requested
  );
}

/** Every bus, for the mixing panel. */
export function busRows(levels: MixerLevels): readonly {
  readonly id: AudioBusId;
  readonly label: string;
  readonly level: number;
  readonly carries: string;
}[] {
  return AUDIO_BUSES.map((bus) => ({
    id: bus.id,
    label: bus.displayName,
    level: clamp01(levels[bus.id] ?? bus.defaultLevel),
    carries: bus.carries,
  }));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
