import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * The mixing desk.
 *
 * Every sound in the game belongs to exactly one bus, and every bus has a level
 * the player controls. That is what makes "turn the music down but leave the
 * radio alone" a thing somebody can actually do, and what stops a new sound
 * being added with nowhere to turn it down from.
 *
 * The accessibility bus is deliberately last and deliberately different: it
 * carries the cues that stand in for something a player might not be able to
 * see or hear, and it is the one bus that is never ducked by anything.
 *
 * No Babylon, no WebAudio, no DOM. Names and numbers only.
 */

export const AUDIO_BUS_IDS = [
  "master",
  "music",
  "ambience",
  "dialogue",
  "radio",
  "ui",
  "jaeger",
  "kaiju",
  "destruction",
  "accessibility",
] as const;
export type AudioBusId = (typeof AUDIO_BUS_IDS)[number];

export interface AudioBusDefinition extends RegistryEntry {
  readonly id: AudioBusId;
  readonly displayName: string;
  /** Bus this feeds into. Null for the master, which feeds the output. */
  readonly parent: AudioBusId | null;
  /** Level a fresh install starts at, 0 to 1. */
  readonly defaultLevel: number;
  /**
   * How far this bus is pulled down when something more important is speaking.
   *
   * Zero means it is never ducked. The accessibility bus is zero because a cue
   * that replaces something you cannot perceive must not be the thing that gets
   * quieter when a radio line arrives.
   */
  readonly duckDepth: number;
  /**
   * Priority for ducking others, higher wins.
   *
   * A bus only ducks buses below it, so ambience never quietens a radio call.
   */
  readonly duckPriority: number;
  /** What lives on this bus, so nothing gets filed somewhere arbitrary. */
  readonly carries: string;
}

const BUSES: readonly AudioBusDefinition[] = [
  {
    id: "master",
    displayName: "Master",
    parent: null,
    defaultLevel: 0.8,
    duckDepth: 0,
    duckPriority: 0,
    carries: "Everything. The one control that turns the game down.",
  },
  {
    id: "music",
    displayName: "Music",
    parent: "master",
    defaultLevel: 0.55,
    duckDepth: 0.6,
    duckPriority: 1,
    carries: "The adaptive score, and nothing else.",
  },
  {
    id: "ambience",
    displayName: "Ambience",
    parent: "master",
    defaultLevel: 0.7,
    duckDepth: 0.45,
    duckPriority: 2,
    carries: "Wind, water, rain, city hum, the room you are standing in.",
  },
  {
    id: "destruction",
    displayName: "Destruction",
    parent: "master",
    defaultLevel: 0.85,
    duckDepth: 0.25,
    duckPriority: 5,
    carries: "Buildings coming down, debris, structural failure.",
  },
  {
    id: "jaeger",
    displayName: "Jaeger",
    parent: "master",
    defaultLevel: 0.9,
    duckDepth: 0.2,
    duckPriority: 6,
    carries: "Servos, footfalls, the reactor, weapons, armour strain, the cockpit.",
  },
  {
    id: "kaiju",
    displayName: "Kaiju",
    parent: "master",
    defaultLevel: 0.9,
    duckDepth: 0.2,
    duckPriority: 7,
    carries: "Calls, breath, footsteps, movement, plate, organs, abilities.",
  },
  {
    id: "ui",
    displayName: "Interface",
    parent: "master",
    defaultLevel: 0.6,
    duckDepth: 0.3,
    duckPriority: 4,
    carries: "Panels, confirmations, refusals.",
  },
  {
    id: "dialogue",
    displayName: "Dialogue",
    parent: "master",
    defaultLevel: 1,
    duckDepth: 0,
    duckPriority: 9,
    carries: "Anybody speaking to you in the room.",
  },
  {
    id: "radio",
    displayName: "Radio",
    parent: "master",
    defaultLevel: 1,
    duckDepth: 0,
    duckPriority: 10,
    carries: "LOCCENT, allied crews, and every warning that has to be heard.",
  },
  {
    id: "accessibility",
    displayName: "Accessibility cues",
    parent: "master",
    defaultLevel: 1,
    duckDepth: 0,
    duckPriority: 11,
    carries: "Cues that stand in for something a player may not see or hear.",
  },
];

export function validateAudioBus(entry: AudioBusDefinition): string[] {
  const errors: string[] = [];
  if (!AUDIO_BUS_IDS.includes(entry.id)) errors.push(`unknown bus id "${entry.id}"`);
  if (entry.displayName.trim().length === 0) errors.push("displayName is required");
  if (entry.id === "master" && entry.parent !== null) errors.push("the master bus has no parent");
  if (entry.id !== "master" && entry.parent !== "master") {
    errors.push(`${entry.id} must feed the master bus`);
  }
  if (entry.defaultLevel < 0 || entry.defaultLevel > 1) errors.push("defaultLevel must be between 0 and 1");
  if (entry.duckDepth < 0 || entry.duckDepth > 1) errors.push("duckDepth must be between 0 and 1");
  if (entry.duckPriority < 0) errors.push("duckPriority cannot be negative");
  if (entry.carries.trim().length === 0) {
    // A bus that does not say what it carries is a bus somebody will file a
    // sound on for no reason.
    errors.push("a bus must say what it carries");
  }
  return errors;
}

export function createAudioBusRegistry(): ContentRegistry<AudioBusDefinition> {
  const registry = new ContentRegistry<AudioBusDefinition>(validateAudioBus);
  for (const entry of BUSES) registry.register(entry);
  return registry;
}

export const AUDIO_BUSES = BUSES;

/** Buses that are never pulled down by anything, whatever is speaking. */
export function unduckableBuses(): readonly AudioBusId[] {
  return BUSES.filter((bus) => bus.duckDepth === 0).map((bus) => bus.id);
}
