import type { AudioBusId } from "../data/audioBuses";

/**
 * Sampled sound.
 *
 * The synthesised layers give the game its sustained identity (machinery,
 * weather, the score); these give it transients: the recorded plate, glass
 * and punch impacts, footsteps, doors, alarms and interface ticks the
 * synthesiser cannot fake. Every file is CC0 (see THIRD_PARTY_ASSETS.md).
 *
 * A set is a handful of takes of one sound. Playing a set picks the next take
 * in a rotation that never repeats the last one, so a hundred hits do not
 * sound like one hit a hundred times, and nothing here consults the
 * simulation's random streams: which take plays is presentation, not state.
 *
 * Loading is lazy and cached per set; a set that fails to load plays silence
 * and says so once. Distance attenuation and a low-pass for far sounds are
 * applied per play, so the same plate hit works at ten metres and a
 * kilometre.
 */

export type SampleSetId =
  | "impact.metal.heavy"
  | "impact.metal.medium"
  | "impact.metal.light"
  | "impact.plate.heavy"
  | "impact.plate.medium"
  | "impact.punch.heavy"
  | "impact.punch.medium"
  | "impact.glass.heavy"
  | "impact.soft.heavy"
  | "impact.bell"
  | "impact.wood.heavy"
  | "step.concrete"
  | "blast.low"
  | "blast.crunch"
  | "scifi.metal"
  | "thruster"
  | "computer"
  | "door.open"
  | "door.close"
  | "forcefield"
  | "laser.large"
  | "engine"
  | "ui.click"
  | "ui.confirm"
  | "ui.error"
  | "ui.select"
  | "ui.back"
  | "ui.open"
  | "ui.close"
  | "ui.switch"
  | "ui.tick"
  | "ui.question"
  | "ui.rollover"
  | "ui.bong";

interface SampleSet {
  readonly bus: AudioBusId;
  readonly files: readonly string[];
  readonly gain: number;
}

// Relative to the build base so a subfolder deployment finds the files.
const ROOT = `${import.meta.env.BASE_URL}assets/audio/`;

function takes(prefix: string, count: number, start = 0): string[] {
  const list: string[] = [];
  for (let index = start; index < start + count; index += 1) {
    list.push(`${prefix}_${String(index).padStart(3, "0")}.ogg`);
  }
  return list;
}

const SETS: Readonly<Record<SampleSetId, SampleSet>> = {
  "impact.metal.heavy": { bus: "destruction", files: takes("impact/impactMetal_heavy", 4), gain: 0.9 },
  "impact.metal.medium": { bus: "destruction", files: takes("impact/impactMetal_medium", 4), gain: 0.8 },
  "impact.metal.light": { bus: "destruction", files: takes("impact/impactMetal_light", 4), gain: 0.6 },
  "impact.plate.heavy": { bus: "jaeger", files: takes("impact/impactPlate_heavy", 4), gain: 1 },
  "impact.plate.medium": { bus: "jaeger", files: takes("impact/impactPlate_medium", 4), gain: 0.8 },
  "impact.punch.heavy": { bus: "kaiju", files: takes("impact/impactPunch_heavy", 4), gain: 1 },
  "impact.punch.medium": { bus: "kaiju", files: takes("impact/impactPunch_medium", 4), gain: 0.8 },
  "impact.glass.heavy": { bus: "destruction", files: takes("impact/impactGlass_heavy", 4), gain: 0.8 },
  "impact.soft.heavy": { bus: "kaiju", files: takes("impact/impactSoft_heavy", 4), gain: 0.9 },
  "impact.bell": { bus: "destruction", files: takes("impact/impactBell_heavy", 4), gain: 0.5 },
  "impact.wood.heavy": { bus: "destruction", files: takes("impact/impactWood_heavy", 4), gain: 0.7 },
  "step.concrete": { bus: "ambience", files: takes("impact/footstep_concrete", 4), gain: 0.35 },
  "blast.low": { bus: "destruction", files: takes("scifi/lowFrequency_explosion", 2), gain: 1 },
  "blast.crunch": { bus: "destruction", files: takes("scifi/explosionCrunch", 4), gain: 0.9 },
  "scifi.metal": { bus: "jaeger", files: takes("scifi/impactMetal", 4), gain: 0.8 },
  thruster: { bus: "jaeger", files: takes("scifi/thrusterFire", 4), gain: 0.7 },
  computer: { bus: "ui", files: takes("scifi/computerNoise", 3), gain: 0.4 },
  "door.open": { bus: "ambience", files: takes("scifi/doorOpen", 2), gain: 0.6 },
  "door.close": { bus: "ambience", files: takes("scifi/doorClose", 4), gain: 0.6 },
  forcefield: { bus: "jaeger", files: takes("scifi/forceField", 4), gain: 0.6 },
  "laser.large": { bus: "jaeger", files: takes("scifi/laserLarge", 4), gain: 0.8 },
  engine: { bus: "jaeger", files: takes("scifi/engineCircular", 4), gain: 0.5 },
  "ui.click": { bus: "ui", files: takes("ui/click", 5), gain: 0.5 },
  "ui.confirm": { bus: "ui", files: takes("ui/confirmation", 4), gain: 0.6 },
  "ui.error": { bus: "ui", files: takes("ui/error", 8), gain: 0.6 },
  "ui.select": { bus: "ui", files: takes("ui/select", 8), gain: 0.4 },
  "ui.back": { bus: "ui", files: takes("ui/back", 4), gain: 0.5 },
  "ui.open": { bus: "ui", files: takes("ui/open", 4), gain: 0.5 },
  "ui.close": { bus: "ui", files: takes("ui/close", 4), gain: 0.5 },
  "ui.switch": { bus: "ui", files: takes("ui/switch", 7), gain: 0.5 },
  "ui.tick": { bus: "ui", files: takes("ui/tick", 4), gain: 0.35 },
  "ui.question": { bus: "ui", files: takes("ui/question", 4), gain: 0.5 },
  "ui.rollover": {
    bus: "ui",
    files: ["ui/rollover1.ogg", "ui/rollover2.ogg", "ui/rollover3.ogg"],
    gain: 0.25,
  },
  "ui.bong": { bus: "ui", files: takes("ui/bong", 1), gain: 0.5 },
};

export interface PlayOptions {
  /** Linear gain on top of the set's own level. */
  readonly gain?: number;
  /** Playback rate; 0.5 is an octave down, which is how a plate hit becomes a footfall. */
  readonly rate?: number;
  /** Metres from the listener. Attenuates and darkens the sound. */
  readonly distanceMeters?: number;
  /** Left to right, -1 to 1. */
  readonly pan?: number;
}

/** What the library needs from the audio side: a context and the bus to route through. */
export interface SampleSink {
  readonly context: AudioContext | null;
  bus(id: AudioBusId): AudioNode | null;
}

export interface SampleStats {
  readonly loaded: number;
  readonly failed: number;
  readonly played: number;
}

export class SampleLibrary {
  private readonly sink: SampleSink;
  private readonly buffers = new Map<SampleSetId, Promise<(AudioBuffer | null)[]>>();
  private readonly lastTake = new Map<SampleSetId, number>();
  private readonly warn: (message: string) => void;
  private readonly warned = new Set<SampleSetId>();
  private loaded = 0;
  private failed = 0;
  private played = 0;
  private disposed = false;

  constructor(sink: SampleSink, warn: (message: string) => void = () => undefined) {
    this.sink = sink;
    this.warn = warn;
  }

  /** Starts loading sets that will be needed soon, so the first hit is not late. */
  warm(ids: readonly SampleSetId[]): void {
    for (const id of ids) void this.load(id);
  }

  /** Plays one take of a set. Silent when audio is not up or the file failed. */
  play(id: SampleSetId, options: PlayOptions = {}): void {
    if (this.disposed) return;
    const context = this.sink.context;
    if (!context || context.state !== "running") return;
    void this.load(id).then((buffers) => {
      if (this.disposed || !this.sink.context) return;
      const available = buffers.map((buffer, index) => ({ buffer, index })).filter((entry) => entry.buffer);
      if (available.length === 0) return;
      const previous = this.lastTake.get(id) ?? -1;
      const candidates =
        available.length > 1 ? available.filter((entry) => entry.index !== previous) : available;
      const pick = candidates[this.played % candidates.length];
      if (!pick?.buffer) return;
      this.lastTake.set(id, pick.index);
      this.start(id, pick.buffer, options);
    });
  }

  stats(): SampleStats {
    return { loaded: this.loaded, failed: this.failed, played: this.played };
  }

  dispose(): void {
    this.disposed = true;
    this.buffers.clear();
  }

  private start(id: SampleSetId, buffer: AudioBuffer, options: PlayOptions): void {
    const context = this.sink.context;
    const set = SETS[id];
    const bus = this.sink.bus(set.bus);
    if (!context || !bus) return;
    const distance = Math.max(0, options.distanceMeters ?? 0);
    // Inverse distance with a 40 m reference: a plate hit at 400 m is a tenth as loud.
    const attenuation = distance <= 40 ? 1 : 40 / distance;
    const level = set.gain * (options.gain ?? 1) * attenuation;
    if (level < 0.005) return;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = options.rate ?? 1;
    const gain = context.createGain();
    gain.gain.value = level;
    let tail: AudioNode = gain;
    if (distance > 80) {
      // Air eats the top end: the farther, the darker.
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = Math.max(300, 8000 * (80 / distance));
      gain.connect(filter);
      tail = filter;
    }
    if (options.pan !== undefined && typeof context.createStereoPanner === "function") {
      const panner = context.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan));
      tail.connect(panner);
      tail = panner;
    }
    source.connect(gain);
    tail.connect(bus);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      if (tail !== gain) tail.disconnect();
    };
    source.start();
    this.played += 1;
  }

  private load(id: SampleSetId): Promise<(AudioBuffer | null)[]> {
    const existing = this.buffers.get(id);
    if (existing) return existing;
    const context = this.sink.context;
    if (!context) return Promise.resolve([]);
    const set = SETS[id];
    const loading = Promise.all(
      set.files.map(async (file) => {
        try {
          const response = await fetch(`${ROOT}${file}`);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const bytes = await response.arrayBuffer();
          const buffer = await context.decodeAudioData(bytes);
          this.loaded += 1;
          return buffer;
        } catch (error) {
          this.failed += 1;
          if (!this.warned.has(id)) {
            this.warned.add(id);
            this.warn(`Sample "${file}" could not load: ${String(error)}.`);
          }
          return null;
        }
      }),
    );
    this.buffers.set(id, loading);
    return loading;
  }
}
