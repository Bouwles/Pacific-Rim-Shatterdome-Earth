import { describe, expect, it } from "vitest";
import {
  AUDIO_BUSES,
  AUDIO_BUS_IDS,
  createAudioBusRegistry,
  unduckableBuses,
  validateAudioBus,
  type AudioBusDefinition,
} from "../../src/data/audioBuses";
import {
  busRows,
  defaultLevels,
  levelOf,
  normaliseLevels,
  resolveMix,
  safetyBusesAudible,
  validateLevels,
} from "../../src/audio/mixer";
import {
  clearLevels,
  loadLevels,
  memoryMixerStorage,
  MIXER_STORAGE_KEY,
  saveLevels,
} from "../../src/audio/mixerStore";

describe("the bus list", () => {
  it("gives every bus a control and a stated purpose", () => {
    const registry = createAudioBusRegistry();
    expect(registry.all()).toHaveLength(AUDIO_BUS_IDS.length);
    for (const bus of registry.all()) {
      expect(bus.carries.length).toBeGreaterThan(8);
      expect(bus.defaultLevel).toBeGreaterThan(0);
    }
  });

  it("refuses a bus that does not say what it carries", () => {
    const nameless = { ...AUDIO_BUSES[1], carries: "  " } as AudioBusDefinition;
    expect(validateAudioBus(nameless)).toContain("a bus must say what it carries");
  });

  it("refuses a bus that does not feed the master", () => {
    const orphan = { ...AUDIO_BUSES[1], parent: null } as AudioBusDefinition;
    expect(validateAudioBus(orphan).join(" ")).toMatch(/must feed the master/);
  });

  it("never ducks dialogue, radio or the accessibility cues", () => {
    expect(unduckableBuses()).toEqual(
      expect.arrayContaining(["dialogue", "radio", "accessibility", "master"]),
    );
  });
});

describe("resolving a mix", () => {
  it("multiplies every bus by the master and nothing else when nobody is speaking", () => {
    const levels = { ...defaultLevels(), master: 0.5 };
    const music = resolveMix(levels).find((bus) => bus.id === "music");
    expect(music?.duckedBy).toBeNull();
    expect(music?.effective).toBeCloseTo(music!.requested * 0.5, 5);
  });

  it("ducks the music when the radio speaks, and says which bus did it", () => {
    const levels = defaultLevels();
    const quiet = resolveMix(levels, [{ busId: "radio", strength: 1 }]).find((bus) => bus.id === "music");
    const loud = resolveMix(levels).find((bus) => bus.id === "music");
    expect(quiet!.ducked).toBeLessThan(loud!.ducked);
    expect(quiet!.duckedBy).toBe("radio");
  });

  it("never lets ambience duck a radio call, however hard it pushes", () => {
    const radio = resolveMix(defaultLevels(), [{ busId: "ambience", strength: 1 }]).find(
      (bus) => bus.id === "radio",
    );
    expect(radio?.duckedBy).toBeNull();
  });

  it("leaves the accessibility cues alone whatever is speaking", () => {
    const everything = AUDIO_BUS_IDS.map((busId) => ({ busId, strength: 1 }));
    const cue = resolveMix(defaultLevels(), everything).find((bus) => bus.id === "accessibility");
    expect(cue?.ducked).toBe(cue?.requested);
    expect(safetyBusesAudible(defaultLevels(), everything)).toBe(true);
  });

  it("ducks less for a mutter than for a shout", () => {
    const levels = defaultLevels();
    const mutter = levelOf("music", levels, [{ busId: "radio", strength: 0.2 }]);
    const shout = levelOf("music", levels, [{ busId: "radio", strength: 1 }]);
    expect(shout).toBeLessThan(mutter);
  });

  it("clamps rather than refusing a level that drifted out of range", () => {
    const levels = normaliseLevels({ music: 4, ambience: -2 });
    expect(levels.music).toBe(1);
    expect(levels.ambience).toBe(0);
    expect(validateLevels(levels)).toEqual([]);
  });

  it("refuses levels that are not numbers", () => {
    expect(validateLevels({ ...defaultLevels(), music: "loud" }).join(" ")).toMatch(/music level/);
  });

  it("offers a row per bus for the mixing panel", () => {
    expect(busRows(defaultLevels())).toHaveLength(AUDIO_BUS_IDS.length);
  });
});

describe("remembering the mix", () => {
  it("round trips through storage", () => {
    const storage = memoryMixerStorage();
    const wanted = { ...defaultLevels(), music: 0.2 };
    expect(saveLevels(storage, wanted).ok).toBe(true);
    expect(loadLevels(storage).levels.music).toBeCloseTo(0.2, 5);
    expect(loadLevels(storage).restored).toBe(true);
  });

  it("falls back to the defaults, with a note, when nothing has been stored", () => {
    const result = loadLevels(memoryMixerStorage());
    expect(result.restored).toBe(false);
    expect(result.levels).toEqual(defaultLevels());
    expect(result.note.length).toBeGreaterThan(0);
  });

  it("resets rather than throwing when what was stored is not readable", () => {
    const storage = memoryMixerStorage();
    storage.setItem(MIXER_STORAGE_KEY, "{not json");
    const result = loadLevels(storage);
    expect(result.restored).toBe(false);
    expect(result.levels).toEqual(defaultLevels());
  });

  it("says so rather than throwing when the browser refuses to store", () => {
    expect(saveLevels(null, defaultLevels()).ok).toBe(false);
    expect(loadLevels(null).restored).toBe(false);
    expect(() => clearLevels(null)).not.toThrow();
  });
});
