import { describe, expect, it } from "vitest";
import {
  damageAudibility,
  EXPECTED_STAGE_STATES,
  runAudioScenario,
  runRadioPressure,
  STEP_SECONDS,
  TRANSITION_STAGES,
} from "../../src/debug/audioScenario";
import { Soundscape } from "../../src/audio/soundscape";
import { SOUND_PROFILES } from "../../src/data/soundProfiles";
import { defaultLevels } from "../../src/audio/mixer";
import { MAX_SUSTAINED_VOICES } from "../../src/engine/soundStage";
import { emptyRadioSnapshot } from "../../src/audio/radioDirector";

const machineProfile = SOUND_PROFILES.find((profile) => profile.id === "sound.jaeger.standard")!;
const creatureProfile = SOUND_PROFILES.find((profile) => profile.id === "sound.kaiju.coastal")!;

function situationFor(place: "shatterdome" | "world" | "carrier" | "combat") {
  return {
    situation: {
      place,
      alertRaised: false,
      combatIntensity: 0.5,
      bossPhase: false,
      outcome: null,
      repairing: false,
    },
    machine: null,
    creature: null,
  } as const;
}

describe("the whole journey", () => {
  const result = runAudioScenario();

  it("walks the complex, the carrier, a storm fight and going under", () => {
    expect(result.stages.map((stage) => stage.id)).toEqual(TRANSITION_STAGES.map((stage) => stage.id));
  });

  it("settles on the state each leg calls for", () => {
    expect(result.stages.map((stage) => stage.endState)).toEqual([...EXPECTED_STAGE_STATES]);
  });

  it("finishes every crossfade rather than leaving one half done", () => {
    for (const stage of result.stages) expect(stage.settled).toBe(true);
  });

  it("never leaves a gap where nothing at all is playing", () => {
    for (const stage of result.stages) expect(stage.continuous).toBe(true);
  });

  it("never has two voices speaking at once", () => {
    for (const stage of result.stages) expect(stage.overlaps).toBe(0);
  });

  it("never throws a critical warning away", () => {
    expect(result.criticalDropped).toBe(0);
  });

  it("gets louder in the fight than it is in the complex", () => {
    const dome = result.stages[0]!;
    const fight = result.stages[2]!;
    expect(fight.peakVoices).toBeGreaterThan(dome.peakVoices * 3);
  });

  it("stays inside the sustained voice budget", () => {
    expect(result.maxVoices).toBeLessThanOrEqual(MAX_SUSTAINED_VOICES);
  });

  it("is deterministic: two runs agree exactly", () => {
    expect(runAudioScenario().digest).toBe(result.digest);
    expect(runAudioScenario().stages).toEqual(result.stages);
  });

  it("leaves a readable record of everything that was said", () => {
    expect(result.transcriptLength).toBeGreaterThan(4);
  });
});

describe("the channel under pressure", () => {
  const pressure = runRadioPressure();

  it("only ever has one line active", () => {
    expect(pressure.maxSimultaneous).toBe(1);
  });

  it("bounds the queue rather than letting it grow", () => {
    expect(pressure.maxQueued).toBeLessThanOrEqual(4);
  });

  it("drops the unimportant traffic and keeps the warnings", () => {
    expect(pressure.dropped).toBeGreaterThan(0);
    expect(pressure.criticalDropped).toBe(0);
  });

  it("still gets lines through rather than jamming solid", () => {
    expect(pressure.spoken).toBeGreaterThan(4);
  });
});

describe("a damaged machine sounds damaged", () => {
  const audibility = damageAudibility();

  it("adds layers rather than only changing a number", () => {
    expect(audibility.wrecked).toBeGreaterThan(audibility.calm);
  });

  it("is measurably a different sound", () => {
    expect(audibility.distance).toBeGreaterThan(0.15);
  });
});

describe("the soundscape as a whole", () => {
  it("keeps the same mix the player set, and reports it every frame", () => {
    const soundscape = new Soundscape({ machineProfile, creatureProfile });
    soundscape.setLevel("music", 0.2);
    const snapshot = soundscape.update(STEP_SECONDS, situationFor("shatterdome"));
    const music = snapshot.mix.find((bus) => bus.id === "music");
    expect(music?.requested).toBeCloseTo(0.2, 5);
    expect(soundscape.mixerLevels.music).toBeCloseTo(0.2, 5);
    expect(soundscape.mixerLevels.ambience).toBe(defaultLevels().ambience);
  });

  it("ducks the music while a line is being spoken and lets it back up after", () => {
    const soundscape = new Soundscape();
    soundscape.say("radio.reactor.critical");
    const during = soundscape.update(STEP_SECONDS, situationFor("combat"));
    const duringMusic = during.mix.find((bus) => bus.id === "music")!;
    expect(duringMusic.duckedBy).toBe("radio");

    for (let step = 0; step < 40; step += 1) soundscape.update(STEP_SECONDS, situationFor("combat"));
    const after = soundscape.update(STEP_SECONDS, situationFor("combat"));
    expect(after.mix.find((bus) => bus.id === "music")!.duckedBy).toBeNull();
  });

  it("never lets a spoken line quieten the accessibility cues", () => {
    const soundscape = new Soundscape();
    soundscape.say("radio.breach.detected");
    const snapshot = soundscape.update(STEP_SECONDS, situationFor("combat"));
    const cue = snapshot.mix.find((bus) => bus.id === "accessibility")!;
    expect(cue.ducked).toBe(cue.requested);
  });

  it("crossfades rather than cutting when the place changes", () => {
    const soundscape = new Soundscape();
    soundscape.update(STEP_SECONDS, situationFor("shatterdome"));
    for (let step = 0; step < 40; step += 1) soundscape.update(STEP_SECONDS, situationFor("shatterdome"));
    const moving = soundscape.update(STEP_SECONDS, situationFor("world"));
    expect(moving.transitionProgress).toBeLessThan(1);
    expect(moving.transition.crossfadeMs).toBeGreaterThan(0);
    // Something is sounding on the very frame of the change.
    expect(Object.keys(moving.music).length).toBeGreaterThan(0);
  });

  it("advances a clock of its own rather than reading one", () => {
    const soundscape = new Soundscape();
    soundscape.update(1, situationFor("world"));
    soundscape.update(1, situationFor("world"));
    expect(soundscape.seconds).toBeCloseTo(2, 5);
  });

  it("restores an empty record without complaint", () => {
    const soundscape = new Soundscape();
    soundscape.radio.restore(emptyRadioSnapshot());
    expect(soundscape.radio.records()).toEqual([]);
  });

  it("sounds nothing for a machine it has no profile for", () => {
    const soundscape = new Soundscape();
    const snapshot = soundscape.update(STEP_SECONDS, {
      situation: situationFor("combat").situation,
      machine: {
        speedMps: 10,
        damage: 0.5,
        reactorLoad: 0.5,
        heat: 0.5,
        weaponActive: true,
        footing: "ground",
        cockpitAlarm: true,
      },
      creature: null,
    });
    expect(snapshot.machineCues).toEqual([]);
  });
});
