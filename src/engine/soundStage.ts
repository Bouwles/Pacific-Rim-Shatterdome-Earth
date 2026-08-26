import { AUDIO_BUSES, type AudioBusId } from "../data/audioBuses";
import type { LayerCue, SoundLayer, SoundProfileDefinition } from "../data/soundProfiles";
import type { RadioLineDefinition, SpeakerDefinition } from "../data/radioLines";
import { resolveMix, type DuckRequest, type MixerLevels } from "../audio/mixer";
import type { MusicLayer } from "../audio/musicDirector";
import type { AmbientAudio } from "./ambientAudio";

/**
 * Where the numbers become sound.
 *
 * Everything upstream of this file is pure: the mixer decides levels, the music
 * director decides layers, the radio director decides who is talking. This is
 * the only place that touches WebAudio, which is why all of that is testable
 * without a browser.
 *
 * It hangs off the ambience context rather than making its own. Browsers cap
 * how many audio contexts a page may have, and two contexts would mean two
 * clocks, so a warning could not be scheduled against a footfall.
 *
 * Nothing here loads a file. Every sound is synthesised from the recipe in the
 * profile, so a missing recording is a placeholder that plays rather than a
 * console full of 404s.
 */

/** Seconds over which a gain change is ramped. Instant changes click. */
const RAMP_SECONDS = 0.12;
/**
 * The most sustained voices allowed at once.
 *
 * A fight with two machines, a creature and the score is roughly thirty nodes.
 * The cap exists so a pathological state cannot quietly become two hundred
 * oscillators and a dropped frame rate.
 */
export const MAX_SUSTAINED_VOICES = 48;

interface Voice {
  readonly source: AudioBufferSourceNode | OscillatorNode;
  readonly filter: BiquadFilterNode;
  readonly gain: GainNode;
}

export interface SoundStageStats {
  readonly running: boolean;
  readonly voices: number;
  readonly musicVoices: number;
  readonly droppedForBudget: number;
}

export class SoundStage {
  private context: AudioContext | null = null;
  private readonly buses = new Map<AudioBusId, GainNode>();
  private readonly layerVoices = new Map<string, Voice>();
  private readonly musicVoices = new Map<MusicLayer, Voice>();
  private noise: AudioBuffer | null = null;
  private droppedForBudget = 0;
  private disposed = false;

  constructor(private readonly ambience: AmbientAudio) {}

  /**
   * Builds the bus graph, if the ambience context is up.
   *
   * Returns whether it actually attached. A browser that refused audio gets a
   * silent game and no exception, which is the documented behaviour rather than
   * an accident.
   */
  attach(): boolean {
    if (this.disposed || this.context) return this.context !== null;
    const context = this.ambience.audioContext;
    if (!context) return false;
    this.context = context;

    const master = context.createGain();
    master.gain.value = 1;
    master.connect(context.destination);
    this.buses.set("master", master);

    for (const bus of AUDIO_BUSES) {
      if (bus.id === "master") continue;
      const gain = context.createGain();
      gain.gain.value = bus.defaultLevel;
      gain.connect(master);
      this.buses.set(bus.id, gain);
    }

    this.noise = this.buildNoise(context);
    return true;
  }

  get attached(): boolean {
    return this.context !== null;
  }

  /** Applies the resolved mix. The ambience bed is scaled through its own bus. */
  applyMix(levels: MixerLevels, ducking: readonly DuckRequest[] = []): void {
    const resolved = resolveMix(levels, ducking);
    for (const bus of resolved) {
      if (bus.id === "ambience") this.ambience.setBusLevel(bus.effective);
      const node = this.buses.get(bus.id);
      if (!node || !this.context) continue;
      const target = bus.id === "master" ? bus.effective : bus.ducked;
      node.gain.linearRampToValueAtTime(target, this.context.currentTime + RAMP_SECONDS);
    }
  }

  /**
   * Makes the sounding layers match the cues.
   *
   * Layers that stopped being called for are torn down, layers that are new are
   * built, and layers that were already sounding are ramped rather than
   * restarted. That last part is what stops a machine changing speed from
   * sounding like a machine being switched off and on.
   */
  setLayers(profile: SoundProfileDefinition, cues: readonly LayerCue[]): void {
    if (!this.context) return;
    const wanted = new Map(cues.map((cue) => [cue.layerId, cue.gain]));

    for (const [id, voice] of this.layerVoices) {
      if (!id.startsWith(`${profile.id}:`)) continue;
      const layerId = id.slice(profile.id.length + 1);
      if (wanted.has(layerId)) continue;
      this.stop(voice);
      this.layerVoices.delete(id);
    }

    for (const layer of profile.layers) {
      const gain = wanted.get(layer.id);
      const key = `${profile.id}:${layer.id}`;
      const existing = this.layerVoices.get(key);
      if (gain === undefined) continue;
      const level = layer.level * gain;
      if (existing) {
        existing.gain.gain.linearRampToValueAtTime(level, this.context.currentTime + RAMP_SECONDS);
        continue;
      }
      if (this.totalVoices() >= MAX_SUSTAINED_VOICES) {
        this.droppedForBudget += 1;
        continue;
      }
      const voice = this.buildLayerVoice(layer, level);
      if (voice) this.layerVoices.set(key, voice);
    }
  }

  /**
   * Sets the score to a blend of layers.
   *
   * The music director produces the blend; this only realises it, so a
   * crossfade is a series of these calls rather than anything clever here.
   */
  setMusic(blend: Readonly<Partial<Record<MusicLayer, number>>>): void {
    const context = this.context;
    const bus = this.buses.get("music");
    if (!context || !bus) return;

    for (const [name, voice] of this.musicVoices) {
      if (blend[name] === undefined) {
        this.stop(voice);
        this.musicVoices.delete(name);
      }
    }

    for (const [name, level] of Object.entries(blend) as [MusicLayer, number][]) {
      const existing = this.musicVoices.get(name);
      if (existing) {
        existing.gain.gain.linearRampToValueAtTime(level * 0.3, context.currentTime + RAMP_SECONDS);
        continue;
      }
      const voice = this.buildMusicVoice(name, level * 0.3, bus);
      if (voice) this.musicVoices.set(name, voice);
    }
  }

  /**
   * Speaks a line.
   *
   * With no recording this is a band-limited amplitude-modulated noise burst on
   * the speaker's own band: unmistakably a voice on a radio, unmistakably not
   * words, and unmistakably not anybody's copyrighted performance. The subtitle
   * carries the meaning, which is why the text is required and the audio is not.
   */
  speak(line: RadioLineDefinition, speaker: SpeakerDefinition): void {
    const context = this.context;
    const bus = this.buses.get(speaker.bus);
    if (!context || !bus || !this.noise) return;

    const start = context.currentTime;
    const seconds = line.durationMs / 1000;
    const [low, high] = speaker.band;

    const source = context.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;

    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = Math.sqrt(low * high);
    filter.Q.value = Math.max(0.4, filter.frequency.value / Math.max(1, high - low));

    const gain = context.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(line.priority === "critical" ? 0.34 : 0.24, start + 0.05);

    // A flat burst reads as static. Syllables are what make it read as speech,
    // so the level is chopped at roughly the rate somebody talks.
    const syllables = Math.max(2, Math.round(seconds * 4.5));
    for (let index = 0; index < syllables; index += 1) {
      const at = start + 0.05 + (seconds * index) / syllables;
      gain.gain.linearRampToValueAtTime(index % 3 === 2 ? 0.05 : 0.22, at);
    }
    gain.gain.linearRampToValueAtTime(0, start + seconds);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    source.start(start);
    source.stop(start + seconds + 0.05);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  /** Cuts whatever is being spoken, for an interruption. */
  stopSpeech(): void {
    // Speech nodes release themselves on ended; a cut is a bus dip rather than
    // a graph walk, which keeps interruption cheap.
    const context = this.context;
    const bus = this.buses.get("radio");
    if (!context || !bus) return;
    bus.gain.cancelScheduledValues(context.currentTime);
    bus.gain.setValueAtTime(0, context.currentTime);
    bus.gain.linearRampToValueAtTime(1, context.currentTime + 0.08);
  }

  stats(): SoundStageStats {
    return {
      running: this.context !== null,
      voices: this.layerVoices.size,
      musicVoices: this.musicVoices.size,
      droppedForBudget: this.droppedForBudget,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const voice of this.layerVoices.values()) this.stop(voice);
    this.layerVoices.clear();
    for (const voice of this.musicVoices.values()) this.stop(voice);
    this.musicVoices.clear();
    for (const bus of this.buses.values()) bus.disconnect();
    this.buses.clear();
    this.noise = null;
    // The context belongs to the ambience layer, which closes it. Closing it
    // here would take the ambience down with it.
    this.context = null;
  }

  private totalVoices(): number {
    return this.layerVoices.size + this.musicVoices.size;
  }

  private buildLayerVoice(layer: SoundLayer, level: number): Voice | null {
    const context = this.context;
    const bus = this.buses.get(layer.bus);
    if (!context || !bus) return null;

    const source = layer.shape === "noise" ? this.noiseSource(context) : this.oscillator(context, layer);
    if (!source) return null;

    const filter = context.createBiquadFilter();
    if (layer.shape === "noise") {
      filter.type = "bandpass";
      filter.frequency.value = layer.centreHz;
      filter.Q.value = Math.max(0.3, layer.centreHz / Math.max(1, layer.bandwidthHz));
    } else {
      filter.type = "lowpass";
      filter.frequency.value = Math.max(80, layer.centreHz + layer.bandwidthHz);
    }

    const gain = context.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(level, context.currentTime + layer.attackMs / 1000);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    source.start();
    return { source, filter, gain };
  }

  private buildMusicVoice(name: MusicLayer, level: number, bus: GainNode): Voice | null {
    const context = this.context;
    if (!context) return null;

    // Placeholder tones. Each role gets its own register and shape so the eight
    // states are distinguishable by ear, and every one of them is replaceable by
    // a real recording later without touching the director.
    const recipe = MUSIC_RECIPES[name];
    const source =
      recipe.shape === "noise"
        ? this.noiseSource(context)
        : (() => {
            const osc = context.createOscillator();
            osc.type = recipe.shape;
            osc.frequency.value = recipe.hz;
            return osc;
          })();
    if (!source) return null;

    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = recipe.hz * 6;

    const gain = context.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(level, context.currentTime + 0.6);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    source.start();
    return { source, filter, gain };
  }

  private oscillator(context: AudioContext, layer: SoundLayer): OscillatorNode {
    const osc = context.createOscillator();
    osc.type = layer.shape === "noise" ? "sine" : layer.shape;
    osc.frequency.value = layer.centreHz;
    return osc;
  }

  private noiseSource(context: AudioContext): AudioBufferSourceNode | null {
    if (!this.noise) return null;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    return source;
  }

  private buildNoise(context: AudioContext): AudioBuffer {
    const frames = Math.floor(context.sampleRate * 2);
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const data = buffer.getChannelData(0);
    // The same mulberry32 as the simulation, so a soundscape is reproducible
    // from a seed like everything else here.
    let state = 0x5eed_1234;
    for (let index = 0; index < frames; index += 1) {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      data[index] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    }
    return buffer;
  }

  private stop(voice: Voice): void {
    try {
      voice.source.stop();
    } catch {
      // Already stopped. Teardown must never throw.
    }
    voice.source.disconnect();
    voice.filter.disconnect();
    voice.gain.disconnect();
  }
}

const MUSIC_RECIPES: Record<MusicLayer, { readonly shape: OscillatorType | "noise"; readonly hz: number }> = {
  drone: { shape: "sine", hz: 55 },
  "low-strings": { shape: "sawtooth", hz: 82 },
  brass: { shape: "square", hz: 165 },
  "industrial-percussion": { shape: "noise", hz: 120 },
  taiko: { shape: "noise", hz: 70 },
  choir: { shape: "triangle", hz: 330 },
  "solo-cello": { shape: "sawtooth", hz: 147 },
  "synth-pulse": { shape: "square", hz: 220 },
};
