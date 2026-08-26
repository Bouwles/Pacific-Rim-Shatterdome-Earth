/**
 * The score, as a state machine rather than a playlist.
 *
 * Music follows what is happening: standing in the complex, a contact on the
 * board, a carrier run, a fight getting worse, a creature entering its last
 * phase, and whatever happens at the end of that. Each state names the layers
 * that should be sounding, and moving between two states is a crossfade with a
 * length that depends on how urgent the change is.
 *
 * Everything here is a **placeholder recipe**, not a recording. Layers are
 * described as instrument roles and intensities so a real score can replace
 * them one slot at a time. Nothing copyrighted is bundled anywhere in this
 * project.
 *
 * Pure. No WebAudio, no clock, no RNG.
 */

export const MUSIC_STATES = [
  "silent",
  "shatterdome",
  "exploration",
  "warning",
  "deployment",
  "combat-low",
  "combat-high",
  "boss-phase",
  "victory",
  "loss",
  "recovery",
] as const;
export type MusicState = (typeof MUSIC_STATES)[number];

/** The instrument roles the placeholder score is built from. */
export const MUSIC_LAYERS = [
  "drone",
  "low-strings",
  "brass",
  "industrial-percussion",
  "taiko",
  "choir",
  "solo-cello",
  "synth-pulse",
] as const;
export type MusicLayer = (typeof MUSIC_LAYERS)[number];

export interface MusicStateDefinition {
  readonly id: MusicState;
  readonly displayName: string;
  /** Which layers sound, and how loud, 0 to 1. */
  readonly layers: Readonly<Partial<Record<MusicLayer, number>>>;
  /** Beats per minute of the placeholder pulse. Zero for unmeasured states. */
  readonly tempo: number;
  /** How urgent a move into this state is. Higher crossfades faster. */
  readonly urgency: number;
  /** What it is meant to feel like. */
  readonly intent: string;
}

const STATES: readonly MusicStateDefinition[] = [
  {
    id: "silent",
    displayName: "Silent",
    layers: {},
    tempo: 0,
    urgency: 0,
    intent: "Nothing playing. Menus and anywhere the score would be in the way.",
  },
  {
    id: "shatterdome",
    displayName: "Shatterdome",
    layers: { drone: 0.5, "low-strings": 0.25, "industrial-percussion": 0.12 },
    tempo: 62,
    urgency: 1,
    intent: "A working building. Machinery under everything, nothing urgent.",
  },
  {
    id: "exploration",
    displayName: "Exploration",
    layers: { drone: 0.35, "low-strings": 0.3, "solo-cello": 0.25 },
    tempo: 58,
    urgency: 1,
    intent: "Somewhere large and mostly empty. Room to think.",
  },
  {
    id: "warning",
    displayName: "Warning",
    layers: { drone: 0.4, "synth-pulse": 0.45, "low-strings": 0.35, brass: 0.2 },
    tempo: 84,
    urgency: 4,
    intent: "Something is inbound and nobody has left yet.",
  },
  {
    id: "deployment",
    displayName: "Deployment",
    layers: { "industrial-percussion": 0.55, brass: 0.4, "low-strings": 0.4, taiko: 0.3 },
    tempo: 96,
    urgency: 3,
    intent: "On the way. Committed, not yet in it.",
  },
  {
    id: "combat-low",
    displayName: "Combat",
    layers: { taiko: 0.5, brass: 0.45, "industrial-percussion": 0.5, "low-strings": 0.4 },
    tempo: 112,
    urgency: 5,
    intent: "A fight that is going roughly as expected.",
  },
  {
    id: "combat-high",
    displayName: "Heavy combat",
    layers: { taiko: 0.8, brass: 0.75, "industrial-percussion": 0.7, choir: 0.35, "low-strings": 0.5 },
    tempo: 132,
    urgency: 7,
    intent: "It is going badly and everybody knows it.",
  },
  {
    id: "boss-phase",
    displayName: "Final phase",
    layers: { taiko: 0.9, brass: 0.85, choir: 0.6, "industrial-percussion": 0.6, drone: 0.4 },
    tempo: 140,
    urgency: 9,
    intent: "The thing has stopped holding back.",
  },
  {
    id: "victory",
    displayName: "Victory",
    layers: { brass: 0.55, "low-strings": 0.5, choir: 0.3 },
    tempo: 76,
    urgency: 6,
    intent: "It is over and the city is still there.",
  },
  {
    id: "loss",
    displayName: "Loss",
    layers: { "solo-cello": 0.6, drone: 0.4, "low-strings": 0.3 },
    tempo: 48,
    urgency: 6,
    intent: "It is over and the city is not.",
  },
  {
    id: "recovery",
    displayName: "Recovery",
    layers: { drone: 0.4, "solo-cello": 0.35, "low-strings": 0.3, "industrial-percussion": 0.2 },
    tempo: 66,
    urgency: 2,
    intent: "Back at the complex, putting things right.",
  },
];

export function validateMusicState(entry: MusicStateDefinition): string[] {
  const errors: string[] = [];
  if (!MUSIC_STATES.includes(entry.id)) errors.push(`unknown state "${entry.id}"`);
  if (entry.displayName.trim().length === 0) errors.push("displayName is required");
  if (entry.tempo < 0 || entry.tempo > 220) errors.push("tempo must be plausible");
  if (entry.urgency < 0 || entry.urgency > 10) errors.push("urgency must be between 0 and 10");
  if (entry.intent.trim().length === 0) errors.push("a state must say what it is for");
  for (const [name, level] of Object.entries(entry.layers)) {
    if (!MUSIC_LAYERS.includes(name as MusicLayer)) errors.push(`unknown layer "${name}"`);
    if (typeof level !== "number" || level < 0 || level > 1) errors.push(`${name} level out of range`);
  }
  if (entry.id !== "silent" && Object.keys(entry.layers).length === 0) {
    errors.push("a state other than silence must sound like something");
  }
  return errors;
}

export const MUSIC_STATE_DEFINITIONS = STATES;

export function musicState(id: MusicState): MusicStateDefinition {
  const found = STATES.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown music state "${id}"`);
  return found;
}

/** What the world looks like, as far as the score is concerned. */
export interface MusicSituation {
  /** Where the player is. */
  readonly place: "shatterdome" | "world" | "carrier" | "combat";
  /** True when something is inbound and nobody has launched. */
  readonly alertRaised: boolean;
  /** 0 to 1 of how badly the current fight is going. */
  readonly combatIntensity: number;
  /** True when the creature has entered its last phase. */
  readonly bossPhase: boolean;
  /** Set the moment a sortie ends, then cleared. */
  readonly outcome: "victory" | "loss" | null;
  /** True while the complex is repairing after something. */
  readonly repairing: boolean;
}

/** Above this intensity the score moves from combat-low to combat-high. */
export const HEAVY_COMBAT_THRESHOLD = 0.55;

/**
 * Which state the situation calls for.
 *
 * An ordered list of conditions rather than a switch, so adding a state is a
 * row. The order is the priority: an outcome beats a boss phase, which beats
 * ordinary combat, which beats an alert.
 */
const RULES: readonly { readonly state: MusicState; readonly when: (s: MusicSituation) => boolean }[] = [
  { state: "victory", when: (s) => s.outcome === "victory" },
  { state: "loss", when: (s) => s.outcome === "loss" },
  { state: "boss-phase", when: (s) => s.place === "combat" && s.bossPhase },
  {
    state: "combat-high",
    when: (s) => s.place === "combat" && s.combatIntensity >= HEAVY_COMBAT_THRESHOLD,
  },
  { state: "combat-low", when: (s) => s.place === "combat" },
  { state: "deployment", when: (s) => s.place === "carrier" },
  { state: "warning", when: (s) => s.alertRaised },
  { state: "recovery", when: (s) => s.place === "shatterdome" && s.repairing },
  { state: "shatterdome", when: (s) => s.place === "shatterdome" },
  { state: "exploration", when: (s) => s.place === "world" },
];

export function stateFor(situation: MusicSituation): MusicState {
  for (const rule of RULES) {
    if (rule.when(situation)) return rule.state;
  }
  return "silent";
}

/** A move from one state to another, and how long it should take. */
export interface MusicTransition {
  readonly from: MusicState;
  readonly to: MusicState;
  readonly crossfadeMs: number;
  /** Layers that keep sounding through the change, so nothing snaps. */
  readonly shared: readonly MusicLayer[];
  /** Why it took that long, for the debug readout. */
  readonly reason: string;
}

/** The slowest and fastest a change is ever allowed to take. */
export const SLOWEST_CROSSFADE_MS = 4_000;
export const FASTEST_CROSSFADE_MS = 260;

/**
 * How to get from one state to another.
 *
 * Urgent changes are fast and calm ones are slow, so walking out of the complex
 * fades and a contact appearing does not. Layers common to both states are
 * named so the engine can hold them rather than fading them out and straight
 * back in, which is what stops a transition sounding like a cut.
 */
export function transitionFor(from: MusicState, to: MusicState): MusicTransition {
  const target = musicState(to);
  const source = musicState(from);
  // Leaving an urgent state is allowed to be quick too, so a fight ending does
  // not drag four seconds of taiko over the aftermath.
  const urgency = Math.max(target.urgency, source.urgency * 0.5);
  const span = SLOWEST_CROSSFADE_MS - FASTEST_CROSSFADE_MS;
  const crossfadeMs = Math.round(SLOWEST_CROSSFADE_MS - (span * Math.min(10, urgency)) / 10);

  const shared = (Object.keys(source.layers) as MusicLayer[]).filter(
    (layer) => target.layers[layer] !== undefined,
  );

  return {
    from,
    to,
    crossfadeMs: Math.max(FASTEST_CROSSFADE_MS, Math.min(SLOWEST_CROSSFADE_MS, crossfadeMs)),
    shared,
    reason:
      to === from
        ? "No change."
        : target.urgency >= 7
          ? "Urgent, so it cuts in quickly."
          : target.urgency <= 2
            ? "Calm, so it takes its time."
            : "An ordinary change.",
  };
}

/** The layer levels partway through a transition, 0 to 1 of the way across. */
export function blend(
  from: MusicState,
  to: MusicState,
  progress: number,
): Readonly<Partial<Record<MusicLayer, number>>> {
  const t = Math.max(0, Math.min(1, progress));
  const source = musicState(from).layers;
  const target = musicState(to).layers;
  const blended: Partial<Record<MusicLayer, number>> = {};
  for (const layer of MUSIC_LAYERS) {
    const a = source[layer] ?? 0;
    const b = target[layer] ?? 0;
    const level = a + (b - a) * t;
    if (level > 0.001) blended[layer] = Math.round(level * 1000) / 1000;
  }
  return blended;
}
