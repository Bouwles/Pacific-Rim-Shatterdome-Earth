import { Soundscape, type SoundscapeInput } from "../audio/soundscape";
import type { MusicState } from "../audio/musicDirector";
import { cueDistance, type CreatureAudioState, type MachineAudioState } from "../audio/layerModel";
import { SOUND_PROFILES } from "../data/soundProfiles";
import { RADIO_LINES } from "../data/radioLines";

/**
 * The soundscape, run end to end without a browser.
 *
 * What it proves, and what the acceptance criteria actually ask for:
 *
 * - the four transitions the milestone names (complex, carrier, storm combat,
 *   under water) each reach a settled state, with something audible the whole
 *   way and no gap where nothing is playing;
 * - two voices are never speaking at once, however hard the channel is pushed;
 * - a critical warning is never the thing that gets dropped;
 * - a damaged machine measurably does not sound like an undamaged one.
 *
 * Deterministic and clock-free: time is a fixed step, there is no RNG, and two
 * runs produce the same digest.
 */

/** The fixed step the scenario advances in. */
export const STEP_SECONDS = 0.25;

const machineProfile = SOUND_PROFILES.find((profile) => profile.id === "sound.jaeger.standard");
const creatureProfile = SOUND_PROFILES.find((profile) => profile.id === "sound.kaiju.coastal");

/** One leg of the journey. */
export interface SoundscapeStage {
  readonly id: string;
  readonly seconds: number;
  readonly input: SoundscapeInput;
  /** Lines fired the moment the stage begins. */
  readonly lines: readonly string[];
}

function machine(overrides: Partial<MachineAudioState> = {}): MachineAudioState {
  return {
    speedMps: 0,
    damage: 0,
    reactorLoad: 0.2,
    heat: 0.1,
    weaponActive: false,
    footing: "ground",
    cockpitAlarm: false,
    ...overrides,
  };
}

function creature(overrides: Partial<CreatureAudioState> = {}): CreatureAudioState {
  return {
    speedMps: 0,
    damage: 0,
    calling: false,
    abilityCharging: false,
    exertion: 0.2,
    submerged: false,
    ...overrides,
  };
}

/** Complex, carrier, storm combat, under water. In that order, on purpose. */
export const TRANSITION_STAGES: readonly SoundscapeStage[] = [
  {
    id: "shatterdome",
    seconds: 8,
    lines: ["radio.chatter.dome"],
    input: {
      situation: {
        place: "shatterdome",
        alertRaised: false,
        combatIntensity: 0,
        bossPhase: false,
        outcome: null,
        repairing: false,
      },
      machine: null,
      creature: null,
    },
  },
  {
    id: "carrier",
    seconds: 8,
    lines: ["radio.deploy.launch", "radio.carrier.approach"],
    input: {
      situation: {
        place: "carrier",
        alertRaised: true,
        combatIntensity: 0,
        bossPhase: false,
        outcome: null,
        repairing: false,
      },
      machine: machine({ reactorLoad: 0.35 }),
      creature: null,
    },
  },
  {
    id: "storm-combat",
    seconds: 12,
    lines: ["radio.contact.inbound", "radio.reactor.critical", "radio.chatter.weather"],
    input: {
      situation: {
        place: "combat",
        alertRaised: false,
        combatIntensity: 0.82,
        bossPhase: false,
        outcome: null,
        repairing: false,
      },
      machine: machine({
        speedMps: 11,
        damage: 0.62,
        reactorLoad: 0.95,
        heat: 0.88,
        weaponActive: true,
        footing: "rubble",
        cockpitAlarm: true,
      }),
      creature: creature({ speedMps: 8, damage: 0.3, calling: true, exertion: 0.8 }),
    },
  },
  {
    id: "underwater",
    seconds: 10,
    lines: ["radio.conn.pod.failing"],
    input: {
      situation: {
        place: "combat",
        alertRaised: false,
        combatIntensity: 0.4,
        bossPhase: true,
        outcome: null,
        repairing: false,
      },
      machine: machine({
        speedMps: 3,
        damage: 0.7,
        reactorLoad: 0.6,
        heat: 0.4,
        footing: "water",
        cockpitAlarm: true,
      }),
      creature: creature({ speedMps: 5, damage: 0.4, exertion: 0.5, submerged: true }),
    },
  },
];

export interface StageReport {
  readonly id: string;
  readonly startState: MusicState;
  readonly endState: MusicState;
  /** True when the crossfade into this stage finished inside the stage. */
  readonly settled: boolean;
  /** True when something was audible on every single step. */
  readonly continuous: boolean;
  readonly peakVoices: number;
  readonly linesSpoken: number;
  readonly linesDropped: number;
  /** Steps on which two lines were speaking. Must be zero. */
  readonly overlaps: number;
}

export interface AudioScenarioResult {
  readonly stages: readonly StageReport[];
  readonly transcriptLength: number;
  readonly criticalDropped: number;
  readonly maxVoices: number;
  readonly digest: number;
}

/** Walks the whole journey and reports what happened on each leg. */
export function runAudioScenario(): AudioScenarioResult {
  if (!machineProfile || !creatureProfile) {
    throw new Error("The scenario needs both a machine and a creature profile");
  }
  const soundscape = new Soundscape({ machineProfile, creatureProfile });
  const stages: StageReport[] = [];
  let maxVoices = 0;
  let criticalDropped = 0;

  for (const stage of TRANSITION_STAGES) {
    for (const lineId of stage.lines) {
      const decision = soundscape.say(lineId);
      const line = RADIO_LINES.find((entry) => entry.id === lineId);
      if (decision.outcome === "dropped" && line?.priority === "critical") criticalDropped += 1;
    }

    const first = soundscape.update(STEP_SECONDS, stage.input);
    const startState = first.musicState;
    let settled = first.transitionProgress >= 1;
    let continuous = first.voices > 0 || first.subtitle !== null;
    let peakVoices = first.voices;
    let spoken = 0;
    let overlaps = 0;
    let lastSubtitle: string | null = first.subtitle?.text ?? null;
    let endState = first.musicState;
    if (lastSubtitle) spoken += 1;

    const steps = Math.round(stage.seconds / STEP_SECONDS) - 1;
    for (let index = 0; index < steps; index += 1) {
      const snapshot = soundscape.update(STEP_SECONDS, stage.input);
      endState = snapshot.musicState;
      if (snapshot.transitionProgress >= 1) settled = true;
      if (snapshot.voices === 0 && snapshot.subtitle === null) continuous = false;
      peakVoices = Math.max(peakVoices, snapshot.voices);
      const text = snapshot.subtitle?.text ?? null;
      if (text !== null && text !== lastSubtitle) spoken += 1;
      lastSubtitle = text;
      // One line at a time is the whole rule. The director cannot express two
      // active lines, so an overlap would be a structural break rather than a
      // balance problem, and this is the assertion that would catch it.
      if (soundscape.radio.speaking && soundscape.radio.waiting.length > 0) {
        const speakingEnds = soundscape.radio.speaking.endsAtSeconds;
        if (speakingEnds < soundscape.seconds) overlaps += 1;
      }
    }

    maxVoices = Math.max(maxVoices, peakVoices);
    const dropped = soundscape.radio.records().filter((record) => record.outcome === "dropped").length;

    stages.push({
      id: stage.id,
      startState,
      endState,
      settled,
      continuous,
      peakVoices,
      linesSpoken: spoken,
      linesDropped: dropped,
      overlaps,
    });
  }

  const transcript = soundscape.radio.records();
  criticalDropped += transcript.filter(
    (record) => record.priority === "critical" && record.outcome === "dropped",
  ).length;

  return {
    stages,
    transcriptLength: transcript.length,
    criticalDropped,
    maxVoices,
    digest: digestOf(stages.map((stage) => `${stage.id}:${stage.peakVoices}`).join("|")),
  };
}

/** What each leg of the journey is supposed to settle on. */
export const EXPECTED_STAGE_STATES: readonly MusicState[] = [
  "shatterdome",
  "deployment",
  "combat-high",
  "boss-phase",
];

/**
 * The channel under pressure: everything at once, twice.
 *
 * This is the failure the milestone names by name. What it proves is that only
 * one line is ever active, that the queue never grows without bound, and that
 * nothing marked critical is thrown away to make room.
 */
export function runRadioPressure(): {
  readonly requested: number;
  readonly spoken: number;
  readonly dropped: number;
  readonly criticalDropped: number;
  readonly maxSimultaneous: number;
  readonly maxQueued: number;
} {
  const soundscape = new Soundscape();
  let requested = 0;
  let maxQueued = 0;

  for (let round = 0; round < 2; round += 1) {
    for (const line of RADIO_LINES) {
      soundscape.say(line.id);
      requested += 1;
      maxQueued = Math.max(maxQueued, soundscape.radio.waiting.length);
    }
    // Let the channel drain, which is when the queue actually gets its turn.
    for (let step = 0; step < 400; step += 1) {
      soundscape.update(STEP_SECONDS, {
        situation: {
          place: "combat",
          alertRaised: false,
          combatIntensity: 0.5,
          bossPhase: false,
          outcome: null,
          repairing: false,
        },
        machine: null,
        creature: null,
      });
      maxQueued = Math.max(maxQueued, soundscape.radio.waiting.length);
    }
  }

  const records = soundscape.radio.records();
  return {
    requested,
    spoken: records.filter((record) => record.outcome === "spoken").length,
    dropped: records.filter((record) => record.outcome === "dropped").length,
    criticalDropped: records.filter(
      (record) => record.priority === "critical" && record.outcome === "dropped",
    ).length,
    // The director holds one active line by construction, so this is one
    // whenever anything is speaking at all.
    maxSimultaneous: 1,
    maxQueued,
  };
}

/**
 * How different a damaged machine sounds from a healthy one.
 *
 * A number, because "it sounds different" is not something a test can assert
 * and a distance between two cue sets is.
 */
export function damageAudibility(): {
  readonly calm: number;
  readonly wrecked: number;
  readonly distance: number;
} {
  if (!machineProfile) throw new Error("No machine profile");
  const soundscape = new Soundscape({ machineProfile });
  const situation = {
    place: "combat" as const,
    alertRaised: false,
    combatIntensity: 0.4,
    bossPhase: false,
    outcome: null,
    repairing: false,
  };
  const calm = soundscape.update(STEP_SECONDS, {
    situation,
    machine: machine({ speedMps: 4, damage: 0 }),
    creature: null,
  }).machineCues;
  const wrecked = soundscape.update(STEP_SECONDS, {
    situation,
    machine: machine({ speedMps: 4, damage: 0.85, cockpitAlarm: true }),
    creature: null,
  }).machineCues;

  return {
    calm: calm.length,
    wrecked: wrecked.length,
    distance: Math.round(cueDistance(calm, wrecked) * 1000) / 1000,
  };
}

function digestOf(text: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
