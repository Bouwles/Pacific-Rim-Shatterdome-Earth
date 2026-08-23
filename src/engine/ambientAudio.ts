import type { AudioEnvironment } from "../world/ocean";

/**
 * Ambient environment audio.
 *
 * Deliberately tiny and deliberately original: a noise bed shaped by filters,
 * generated in the browser. The project ships no audio files and never will ship
 * film audio, so an ambience that is synthesised rather than sampled is the only
 * kind that can exist here at all.
 *
 * What it is: two noise beds, one for air and one for water, mixed by how
 * submerged the listener is, run through a single low-pass whose cutoff comes
 * from the world layer. Going underwater is not "quieter", it is the loss of
 * every high frequency, which is what this reproduces.
 *
 * What it is not: a sound system. There are no events, no positional sources and
 * no mixer. Those arrive with the milestone that has something to play.
 *
 * Browsers refuse to start audio before a user gesture, so this reports whether
 * it is actually running instead of pretending. Every node it creates is
 * released in dispose().
 */

export type AmbientAudioStatus = "idle" | "running" | "blocked" | "unsupported";

/** Seconds over which parameter changes are ramped. Instant changes click audibly. */
const RAMP_SECONDS = 0.35;
const NOISE_BUFFER_SECONDS = 4;

export interface AmbientAudioStats {
  readonly status: AmbientAudioStatus;
  readonly lowPassHz: number;
  readonly level: number;
  readonly waterMix: number;
}

type AudioContextConstructor = new () => AudioContext;

function resolveAudioContext(): AudioContextConstructor | null {
  const globalScope = globalThis as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return globalScope.AudioContext ?? globalScope.webkitAudioContext ?? null;
}

/**
 * Fills a buffer with pink-ish noise.
 *
 * White noise is harsh and reads as static; the running-sum filter here tilts it
 * toward low frequencies, which is what wind and water actually sound like.
 */
function fillNoise(buffer: AudioBuffer, seed: number): void {
  let state = seed >>> 0 || 1;
  const nextRandom = (): number => {
    // The same mulberry32 the simulation uses, so an ambience is reproducible
    // from a seed like everything else in this project.
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    let running = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = nextRandom() * 2 - 1;
      running = running * 0.97 + white * 0.03;
      data[index] = running * 3.2;
    }
  }
}

export class AmbientAudio {
  private context: AudioContext | null = null;
  private airGain: GainNode | null = null;
  private waterGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private lowPass: BiquadFilterNode | null = null;
  private readonly sources: AudioBufferSourceNode[] = [];
  private status: AmbientAudioStatus = "idle";
  private lastStats: AmbientAudioStats = { status: "idle", lowPassHz: 0, level: 0, waterMix: 0 };
  private disposed = false;

  constructor(private readonly seed: number) {
    if (resolveAudioContext() === null) this.status = "unsupported";
  }

  get currentStatus(): AmbientAudioStatus {
    return this.status;
  }

  /**
   * Starts the graph. Must be called from a user gesture; anywhere else the
   * browser refuses and this reports `blocked` rather than failing silently.
   */
  async start(): Promise<AmbientAudioStatus> {
    if (this.disposed || this.status === "running" || this.status === "unsupported") return this.status;
    const Constructor = resolveAudioContext();
    if (!Constructor) {
      this.status = "unsupported";
      return this.status;
    }

    try {
      const context = new Constructor();
      await context.resume();
      if (context.state !== "running") {
        context.close().catch(() => undefined);
        this.status = "blocked";
        return this.status;
      }
      this.build(context);
      this.status = "running";
    } catch {
      this.status = "blocked";
    }
    return this.status;
  }

  private build(context: AudioContext): void {
    this.context = context;
    const frames = Math.floor(context.sampleRate * NOISE_BUFFER_SECONDS);

    this.masterGain = context.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(context.destination);

    this.lowPass = context.createBiquadFilter();
    this.lowPass.type = "lowpass";
    this.lowPass.frequency.value = 20_000;
    this.lowPass.connect(this.masterGain);

    // Air is brighter, water is darker and slower; two beds rather than one so
    // the crossfade is a real change of material and not just a filter sweep.
    this.airGain = this.createBed(context, frames, this.seed, 1, 1);
    this.waterGain = this.createBed(context, frames, this.seed ^ 0x5eed, 0, 0.55);
  }

  private createBed(
    context: AudioContext,
    frames: number,
    seed: number,
    initialGain: number,
    playbackRate: number,
  ): GainNode {
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    fillNoise(buffer, seed);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = playbackRate;

    const gain = context.createGain();
    gain.gain.value = initialGain;
    source.connect(gain);
    if (this.lowPass) gain.connect(this.lowPass);
    source.start();
    this.sources.push(source);
    return gain;
  }

  /** Applies a world-layer audio environment. Safe to call before start(). */
  update(environment: AudioEnvironment): void {
    this.lastStats = {
      status: this.status,
      lowPassHz: environment.lowPassHz,
      level: environment.ambientLevel,
      waterMix: environment.waterMix,
    };
    if (this.disposed || this.status !== "running") return;
    const context = this.context;
    if (!context || !this.masterGain || !this.lowPass || !this.airGain || !this.waterGain) return;

    const at = context.currentTime + RAMP_SECONDS;
    // Ramped rather than set: a step change in cutoff or gain is an audible click.
    this.lowPass.frequency.linearRampToValueAtTime(Math.max(60, environment.lowPassHz), at);
    // Held well below unity on purpose. This is a bed, not a soundtrack.
    this.masterGain.gain.linearRampToValueAtTime(Math.min(0.28, environment.ambientLevel * 0.28), at);
    this.airGain.gain.linearRampToValueAtTime(1 - environment.waterMix, at);
    this.waterGain.gain.linearRampToValueAtTime(environment.waterMix, at);
  }

  stats(): AmbientAudioStats {
    return { ...this.lastStats, status: this.status };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped, which is fine; disposal must not throw.
      }
      source.disconnect();
    }
    this.sources.length = 0;
    this.airGain?.disconnect();
    this.waterGain?.disconnect();
    this.lowPass?.disconnect();
    this.masterGain?.disconnect();
    this.context?.close().catch(() => undefined);
    this.context = null;
    this.airGain = null;
    this.waterGain = null;
    this.lowPass = null;
    this.masterGain = null;
    this.status = "idle";
  }
}
