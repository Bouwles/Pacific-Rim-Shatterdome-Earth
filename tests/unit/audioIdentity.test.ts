import { describe, expect, it } from "vitest";
import {
  assetSlots,
  createSoundProfileRegistry,
  LAYER_ROLES,
  SOUND_PROFILES,
  validateSoundProfile,
  type SoundProfileDefinition,
} from "../../src/data/soundProfiles";
import {
  creatureCues,
  cueDistance,
  machineCues,
  voiceCount,
  type CreatureAudioState,
  type MachineAudioState,
} from "../../src/audio/layerModel";
import {
  blend,
  FASTEST_CROSSFADE_MS,
  MUSIC_STATES,
  MUSIC_STATE_DEFINITIONS,
  musicState,
  SLOWEST_CROSSFADE_MS,
  stateFor,
  transitionFor,
  validateMusicState,
  type MusicSituation,
} from "../../src/audio/musicDirector";

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

function situation(overrides: Partial<MusicSituation> = {}): MusicSituation {
  return {
    place: "shatterdome",
    alertRaised: false,
    combatIntensity: 0,
    bossPhase: false,
    outcome: null,
    repairing: false,
    ...overrides,
  };
}

const standard = SOUND_PROFILES.find((profile) => profile.id === "sound.jaeger.standard")!;
const coastal = SOUND_PROFILES.find((profile) => profile.id === "sound.kaiju.coastal")!;
const deep = SOUND_PROFILES.find((profile) => profile.id === "sound.kaiju.deep")!;

describe("sound profiles", () => {
  it("registers every profile", () => {
    expect(createSoundProfileRegistry().all().length).toBe(SOUND_PROFILES.length);
  });

  it("refuses a profile that is one sound wearing a name", () => {
    const thin: SoundProfileDefinition = { ...standard, layers: standard.layers.slice(0, 2) };
    expect(validateSoundProfile(thin).join(" ")).toMatch(/fewer than four layers/);
  });

  it("refuses a profile whose layers are all the same kind", () => {
    const oneRole: SoundProfileDefinition = {
      ...standard,
      layers: standard.layers.filter((layer) => layer.role === "servo" || layer.role === "reactor"),
    };
    expect(validateSoundProfile(oneRole).join(" ")).toMatch(/three different kinds/);
  });

  it("refuses a creature layer filed on the machine bus", () => {
    const misfiled: SoundProfileDefinition = {
      ...coastal,
      layers: coastal.layers.map((layer, index) => (index === 0 ? { ...layer, bus: "jaeger" } : layer)),
    };
    expect(validateSoundProfile(misfiled).join(" ")).toMatch(/belongs on the kaiju bus/);
  });

  it("names a slot a real recording could be dropped into, for every synthesised layer", () => {
    expect(assetSlots().length).toBeGreaterThan(20);
    for (const slot of assetSlots()) expect(slot).toMatch(/^audio\//);
  });

  it("uses every layer role somewhere", () => {
    const used = new Set(SOUND_PROFILES.flatMap((profile) => profile.layers.map((layer) => layer.role)));
    for (const role of LAYER_ROLES) expect(used).toContain(role);
  });
});

describe("which layers actually sound", () => {
  it("gives a standing machine far fewer voices than a running damaged one", () => {
    const calm = machineCues(standard, machine());
    const hard = machineCues(
      standard,
      machine({ speedMps: 12, damage: 0.8, heat: 0.9, reactorLoad: 0.95, cockpitAlarm: true }),
    );
    expect(voiceCount(hard)).toBeGreaterThan(voiceCount(calm) + 3);
  });

  it("makes damage audible rather than a number on a bar", () => {
    const healthy = machineCues(standard, machine({ speedMps: 6 }));
    const wrecked = machineCues(standard, machine({ speedMps: 6, damage: 0.9 }));
    expect(cueDistance(healthy, wrecked)).toBeGreaterThan(0.1);
    // The specific thing that changes: plate rattles and armour tears.
    const ids = wrecked.map((cue) => cue.layerId);
    expect(ids).toContain("jaeger.armour.tear");
    expect(healthy.map((cue) => cue.layerId)).not.toContain("jaeger.armour.tear");
  });

  it("swaps the contact layer for what the machine is standing in", () => {
    const water = machineCues(standard, machine({ speedMps: 5, footing: "water" })).map((c) => c.layerId);
    const rubble = machineCues(standard, machine({ speedMps: 5, footing: "rubble" })).map((c) => c.layerId);
    expect(water).toContain("jaeger.contact.water");
    expect(water).not.toContain("jaeger.contact.rubble");
    expect(rubble).toContain("jaeger.contact.rubble");
  });

  it("silences the footfall entirely while the machine is off the ground", () => {
    const airborne = machineCues(standard, machine({ speedMps: 10, footing: "airborne" }));
    expect(airborne.map((cue) => cue.layerId)).not.toContain("jaeger.footfall.mass");
  });

  it("keeps the reactor sounding even when nothing else is", () => {
    expect(machineCues(standard, machine()).map((cue) => cue.layerId)).toContain("jaeger.reactor.idle");
  });

  it("changes what a creature sounds like when it goes under", () => {
    const surface = creatureCues(coastal, creature({ speedMps: 5 }));
    const under = creatureCues(coastal, creature({ speedMps: 5, submerged: true }));
    expect(cueDistance(surface, under)).toBeGreaterThan(0.05);
  });

  it("gives the two creature categories different sounds from the same state", () => {
    const state = creature({ speedMps: 6, calling: true, exertion: 0.7 });
    const a = creatureCues(coastal, state).map((cue) => cue.layerId);
    const b = creatureCues(deep, state).map((cue) => cue.layerId);
    expect(a).not.toEqual(b);
  });
});

describe("the score", () => {
  it("defines every named state and validates them all", () => {
    expect(MUSIC_STATE_DEFINITIONS.map((state) => state.id).sort()).toEqual([...MUSIC_STATES].sort());
    for (const state of MUSIC_STATE_DEFINITIONS) expect(validateMusicState(state)).toEqual([]);
  });

  it("refuses a state that sounds like nothing", () => {
    expect(validateMusicState({ ...musicState("warning"), layers: {} }).join(" ")).toMatch(
      /must sound like something/,
    );
  });

  it("picks the state the situation calls for, in priority order", () => {
    expect(stateFor(situation())).toBe("shatterdome");
    expect(stateFor(situation({ repairing: true }))).toBe("recovery");
    expect(stateFor(situation({ place: "world" }))).toBe("exploration");
    expect(stateFor(situation({ place: "world", alertRaised: true }))).toBe("warning");
    expect(stateFor(situation({ place: "carrier" }))).toBe("deployment");
    expect(stateFor(situation({ place: "combat", combatIntensity: 0.2 }))).toBe("combat-low");
    expect(stateFor(situation({ place: "combat", combatIntensity: 0.9 }))).toBe("combat-high");
    expect(stateFor(situation({ place: "combat", bossPhase: true }))).toBe("boss-phase");
    expect(stateFor(situation({ place: "combat", outcome: "victory" }))).toBe("victory");
    expect(stateFor(situation({ place: "combat", outcome: "loss" }))).toBe("loss");
  });

  it("crossfades urgently into urgent states and slowly into calm ones", () => {
    const calm = transitionFor("shatterdome", "exploration");
    const urgent = transitionFor("exploration", "boss-phase");
    expect(urgent.crossfadeMs).toBeLessThan(calm.crossfadeMs);
    expect(urgent.crossfadeMs).toBeGreaterThanOrEqual(FASTEST_CROSSFADE_MS);
    expect(calm.crossfadeMs).toBeLessThanOrEqual(SLOWEST_CROSSFADE_MS);
  });

  it("names the layers both states share, so a change is not a cut", () => {
    expect(transitionFor("combat-low", "combat-high").shared.length).toBeGreaterThan(1);
  });

  it("blends between two states rather than stepping", () => {
    const half = blend("shatterdome", "combat-high", 0.5);
    const start = musicState("shatterdome").layers;
    const end = musicState("combat-high").layers;
    const drone = half.drone ?? 0;
    expect(drone).toBeLessThan(start.drone ?? 0);
    expect(drone).toBeGreaterThan(end.drone ?? 0);
  });

  it("arrives exactly at the target when the crossfade finishes", () => {
    const done = blend("shatterdome", "victory", 1);
    for (const [layer, level] of Object.entries(musicState("victory").layers)) {
      expect(done[layer as keyof typeof done]).toBeCloseTo(level, 3);
    }
  });
});
