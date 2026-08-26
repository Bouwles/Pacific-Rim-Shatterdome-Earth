import type { LayerCue, SoundProfileDefinition } from "../data/soundProfiles";
import type { AudioBusId } from "../data/audioBuses";
import { creatureCues, machineCues, type CreatureAudioState, type MachineAudioState } from "./layerModel";
import {
  defaultLevels,
  normaliseLevels,
  resolveMix,
  type DuckRequest,
  type MixerLevels,
  type ResolvedBus,
} from "./mixer";
import {
  blend,
  stateFor,
  transitionFor,
  type MusicLayer,
  type MusicSituation,
  type MusicState,
  type MusicTransition,
} from "./musicDirector";
import { RadioDirector, type RadioDecision, type Subtitle } from "./radioDirector";

/**
 * The one thing that decides what the whole game sounds like at this instant.
 *
 * It owns the mixing levels, the score's state machine and the radio queue, and
 * it hands the engine a single snapshot per frame. Keeping it in one place is
 * what makes "walking out of the complex, into a carrier, into a storm, and
 * under water" a sequence of four snapshots that can be asserted in a test
 * rather than four systems that each hope the others agree.
 *
 * Clock-free: time arrives as a delta in seconds and accumulates here. That is
 * what lets the debug scenario run the whole transition sequence in a
 * millisecond and get the same answer every time.
 *
 * No WebAudio. `SoundStage` realises these numbers; this decides them.
 */

export interface SoundscapeInput {
  readonly situation: MusicSituation;
  /** The player's machine, or null when they are not in one. */
  readonly machine: MachineAudioState | null;
  /** The creature in the scene, or null. */
  readonly creature: CreatureAudioState | null;
}

export interface SoundscapeSnapshot {
  readonly elapsedSeconds: number;
  readonly musicState: MusicState;
  readonly previousState: MusicState;
  /** Zero to one of the way through the current crossfade. */
  readonly transitionProgress: number;
  readonly transition: MusicTransition;
  readonly music: Readonly<Partial<Record<MusicLayer, number>>>;
  readonly machineCues: readonly LayerCue[];
  readonly creatureCues: readonly LayerCue[];
  readonly subtitle: Subtitle | null;
  readonly ducking: readonly DuckRequest[];
  readonly mix: readonly ResolvedBus[];
  /** Sustained voices this snapshot asks for, for the performance budget. */
  readonly voices: number;
}

export interface SoundscapeOptions {
  readonly levels?: MixerLevels;
  readonly machineProfile?: SoundProfileDefinition;
  readonly creatureProfile?: SoundProfileDefinition;
  readonly radio?: RadioDirector;
}

export class Soundscape {
  private levels: MixerLevels;
  private readonly radioDirector: RadioDirector;
  private machineProfile: SoundProfileDefinition | null;
  private creatureProfile: SoundProfileDefinition | null;

  private elapsed = 0;
  private state: MusicState = "silent";
  private previous: MusicState = "silent";
  private transition: MusicTransition = transitionFor("silent", "silent");
  private transitionElapsedMs = 0;

  constructor(options: SoundscapeOptions = {}) {
    this.levels = normaliseLevels(options.levels ?? defaultLevels());
    this.radioDirector = options.radio ?? new RadioDirector();
    this.machineProfile = options.machineProfile ?? null;
    this.creatureProfile = options.creatureProfile ?? null;
  }

  get radio(): RadioDirector {
    return this.radioDirector;
  }

  get seconds(): number {
    return this.elapsed;
  }

  get mixerLevels(): MixerLevels {
    return this.levels;
  }

  setLevels(levels: Partial<MixerLevels>): void {
    this.levels = normaliseLevels({ ...this.levels, ...levels });
  }

  setLevel(bus: AudioBusId, level: number): void {
    this.setLevels({ [bus]: level } as Partial<MixerLevels>);
  }

  setMachineProfile(profile: SoundProfileDefinition | null): void {
    this.machineProfile = profile;
  }

  setCreatureProfile(profile: SoundProfileDefinition | null): void {
    this.creatureProfile = profile;
  }

  /** Teaches the radio a line written at runtime, such as a pilot's own. */
  define(line: Parameters<RadioDirector["define"]>[0]): readonly string[] {
    return this.radioDirector.define(line);
  }

  /** Asks for a radio line at the current time. */
  say(lineId: string): RadioDecision {
    return this.radioDirector.request(lineId, this.elapsed);
  }

  /** Cuts everything the radio is holding, for a scene change or a load. */
  silenceRadio(): void {
    this.radioDirector.silence(this.elapsed);
  }

  /**
   * Advances by a fixed step and reports what should be sounding.
   *
   * The score changes state here rather than anywhere else, so a transition can
   * never be started twice by two callers in the same frame.
   */
  update(deltaSeconds: number, input: SoundscapeInput): SoundscapeSnapshot {
    const step = Math.max(0, deltaSeconds);
    this.elapsed += step;
    this.radioDirector.update(this.elapsed);

    const wanted = stateFor(input.situation);
    if (wanted !== this.state) {
      this.previous = this.state;
      this.state = wanted;
      this.transition = transitionFor(this.previous, wanted);
      this.transitionElapsedMs = 0;
    } else if (this.transitionElapsedMs < this.transition.crossfadeMs) {
      this.transitionElapsedMs = Math.min(
        this.transition.crossfadeMs,
        this.transitionElapsedMs + step * 1000,
      );
    }

    const progress =
      this.transition.crossfadeMs <= 0 ? 1 : this.transitionElapsedMs / this.transition.crossfadeMs;

    const machine =
      this.machineProfile && input.machine ? machineCues(this.machineProfile, input.machine) : [];
    const creature =
      this.creatureProfile && input.creature ? creatureCues(this.creatureProfile, input.creature) : [];

    const ducking = this.radioDirector.duckRequests();
    const music = blend(this.previous, this.state, progress);

    return {
      elapsedSeconds: Math.round(this.elapsed * 1000) / 1000,
      musicState: this.state,
      previousState: this.previous,
      transitionProgress: Math.round(progress * 1000) / 1000,
      transition: this.transition,
      music,
      machineCues: machine,
      creatureCues: creature,
      subtitle: this.radioDirector.subtitle(),
      ducking,
      mix: resolveMix(this.levels, ducking),
      voices: machine.length + creature.length + Object.keys(music).length,
    };
  }
}
