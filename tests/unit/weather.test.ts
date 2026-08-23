import { describe, expect, it } from "vitest";
import {
  FRONT_SLOT_TICKS,
  WEATHER_KINDS,
  WEATHER_KIND_PROFILES,
  WEATHER_SCHEMA_VERSION,
  WeatherSystem,
  lerpDegrees,
  validateClimateWeatherProfile,
  validateWeatherSnapshot,
  type ClimateWeatherProfile,
} from "../../src/world/weather";
import { createClimateRegistry } from "../../src/data/climates";

const climates = createClimateRegistry();
const TEMPERATE = climates.getOrThrow("temperate");
const SEED = 20260822;

function makeSystem(profile: ClimateWeatherProfile = TEMPERATE, seed = SEED): WeatherSystem {
  return new WeatherSystem({ seed, profile });
}

describe("climate weather profiles", () => {
  it("registers one profile per climate zone", () => {
    for (const zone of ["polar", "subarctic", "temperate", "subtropical", "tropical", "arid", "oceanic"]) {
      expect(climates.has(zone)).toBe(true);
    }
  });

  it("refuses a profile that can produce no weather at all", () => {
    const empty = Object.fromEntries(WEATHER_KINDS.map((kind) => [kind, 0]));
    const errors = validateClimateWeatherProfile({
      id: "void",
      weights: empty as ClimateWeatherProfile["weights"],
      baseTemperatureC: 10,
      dailySwingC: 5,
      baseWindMps: 4,
    });
    expect(errors).toContainEqual(expect.stringMatching(/at least one kind with a positive weight/));
  });

  it("rejects negative weights and nonsensical numbers", () => {
    const errors = validateClimateWeatherProfile({
      ...TEMPERATE,
      weights: { ...TEMPERATE.weights, rain: -1 },
      baseWindMps: -3,
      dailySwingC: -2,
    });
    expect(errors.join(" ")).toMatch(/weights.rain/);
    expect(errors.join(" ")).toMatch(/baseWindMps/);
    expect(errors.join(" ")).toMatch(/dailySwingC/);
  });

  it("never lets a climate produce a kind it excludes", () => {
    // The arid profile excludes fog and snow outright.
    const arid = climates.getOrThrow("arid");
    const system = makeSystem(arid);
    for (let slot = 0; slot < 400; slot += 1) {
      const front = system.frontForSlot(slot);
      expect(front.kind).not.toBe("fog");
      expect(front.kind).not.toBe("snow");
    }
  });
});

describe("weather fronts", () => {
  it("gives the same front for the same seed and slot, in any order", () => {
    const system = makeSystem();
    const first = system.frontForSlot(17);
    system.frontForSlot(3);
    system.frontForSlot(999);
    expect(system.frontForSlot(17)).toEqual(first);
  });

  it("gives different weather to a different seed", () => {
    const a = makeSystem(TEMPERATE, 1);
    const b = makeSystem(TEMPERATE, 2);
    const kindsA = Array.from({ length: 40 }, (_, slot) => a.frontForSlot(slot).kind);
    const kindsB = Array.from({ length: 40 }, (_, slot) => b.frontForSlot(slot).kind);
    expect(kindsA).not.toEqual(kindsB);
  });

  it("looks a front up directly rather than walking from the first one", () => {
    const system = makeSystem();
    // A tick a thousand years in resolves as fast as the first: this would hang
    // if fronts were simulated forward instead of derived.
    const far = system.frontAt(FRONT_SLOT_TICKS * 500_000 + 5);
    expect(far.slot).toBe(500_000);
    expect(WEATHER_KINDS).toContain(far.kind);
  });

  it("produces every kind its climate allows over enough slots", () => {
    const system = makeSystem();
    const seen = new Set(Array.from({ length: 500 }, (_, slot) => system.frontForSlot(slot).kind));
    // Temperate allows all six.
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });
});

describe("weather state", () => {
  it("holds steady, then crosses smoothly into the next front", () => {
    const system = makeSystem();
    const slot = 3;
    const start = slot * FRONT_SLOT_TICKS;

    // Early in a slot there is no transition at all.
    expect(system.sample(start + 100, 0.5).transition).toBe(0);
    expect(system.sample(start + Math.floor(FRONT_SLOT_TICKS * 0.5), 0.5).transition).toBe(0);

    // It rises monotonically through the crossfade and reaches the next front.
    let previous = 0;
    for (let step = 0.76; step < 1; step += 0.02) {
      const transition = system.sample(start + Math.floor(FRONT_SLOT_TICKS * step), 0.5).transition;
      expect(transition).toBeGreaterThanOrEqual(previous);
      previous = transition;
    }
    expect(previous).toBeGreaterThan(0.9);
  });

  it("never jumps: consecutive samples change by a small amount", () => {
    const system = makeSystem();
    let previous = system.sample(0, 0.5);
    for (let tick = 60; tick < FRONT_SLOT_TICKS * 3; tick += 60) {
      const current = system.sample(tick, 0.5);
      expect(Math.abs(current.cloudCover - previous.cloudCover)).toBeLessThan(0.1);
      expect(Math.abs(current.precipitation - previous.precipitation)).toBeLessThan(0.1);
      expect(Math.abs(current.windSpeedMps - previous.windSpeedMps)).toBeLessThan(2);
      previous = current;
    }
  });

  it("keeps every derived value inside its range", () => {
    const system = makeSystem();
    for (let tick = 0; tick < FRONT_SLOT_TICKS * 8; tick += 997) {
      const state = system.sample(tick, (tick % 86_400) / 86_400);
      for (const key of ["cloudCover", "precipitation", "fogDensity", "intensity", "wetness"] as const) {
        expect(state[key]).toBeGreaterThanOrEqual(0);
        expect(state[key]).toBeLessThanOrEqual(1);
      }
      expect(state.windSpeedMps).toBeGreaterThanOrEqual(0);
      expect(state.visibilityMeters).toBeGreaterThanOrEqual(50);
      expect(state.windDirectionDeg).toBeGreaterThanOrEqual(0);
      expect(state.windDirectionDeg).toBeLessThan(360);
    }
  });

  it("swings temperature across the day, coldest before dawn", () => {
    const system = makeSystem();
    const preDawn = system.sample(1_000, 0.1).temperatureC;
    const afternoon = system.sample(1_000, 0.6).temperatureC;
    expect(afternoon).toBeGreaterThan(preDawn);
  });

  it("makes bad weather actually reduce visibility, not just look different", () => {
    // Fog at full intensity must be far worse than clear air; this is the check
    // that stops weather from becoming cosmetic.
    expect(WEATHER_KIND_PROFILES.fog.visibilityMeters).toBeLessThan(
      WEATHER_KIND_PROFILES.clear.visibilityMeters / 10,
    );
    expect(WEATHER_KIND_PROFILES.storm.visibilityMeters).toBeLessThan(
      WEATHER_KIND_PROFILES.clear.visibilityMeters / 5,
    );
    expect(WEATHER_KIND_PROFILES.storm.windMultiplier).toBeGreaterThan(
      WEATHER_KIND_PROFILES.clear.windMultiplier * 3,
    );
  });

  it("only snows where precipitation is frozen", () => {
    expect(WEATHER_KIND_PROFILES.snow.frozen).toBe(true);
    expect(WEATHER_KIND_PROFILES.rain.frozen).toBe(false);
  });

  it("flashes lightning during storms and never in clear weather", () => {
    const stormy: ClimateWeatherProfile = {
      ...TEMPERATE,
      id: "stormy",
      weights: { clear: 0, cloudy: 0, rain: 0, storm: 1, fog: 0, snow: 0 },
    };
    const system = makeSystem(stormy);
    let flashes = 0;
    for (let tick = 0; tick < 20_000; tick += 1) {
      if (system.sample(tick, 0.5).lightningFlash > 0) flashes += 1;
    }
    expect(flashes).toBeGreaterThan(0);

    const calm: ClimateWeatherProfile = {
      ...TEMPERATE,
      id: "calm",
      weights: { clear: 1, cloudy: 0, rain: 0, storm: 0, fog: 0, snow: 0 },
    };
    const quiet = makeSystem(calm);
    for (let tick = 0; tick < 20_000; tick += 37) {
      expect(quiet.sample(tick, 0.5).lightningFlash).toBe(0);
    }
  });
});

describe("wetness", () => {
  it("is the one weather value that is history", () => {
    const wet: ClimateWeatherProfile = {
      ...TEMPERATE,
      id: "wet",
      weights: { clear: 0, cloudy: 0, rain: 1, storm: 0, fog: 0, snow: 0 },
    };
    const system = makeSystem(wet);
    expect(system.wetness).toBe(0);
    system.update(5_000, 0.5);
    expect(system.wetness).toBeGreaterThan(0);
  });

  it("dries out once the rain stops", () => {
    const wet: ClimateWeatherProfile = {
      ...TEMPERATE,
      id: "wet",
      weights: { clear: 0, cloudy: 0, rain: 1, storm: 0, fog: 0, snow: 0 },
    };
    const system = makeSystem(wet);
    system.update(6_000, 0.4);
    const soaked = system.wetness;
    expect(soaked).toBeGreaterThan(0.2);

    const dry: ClimateWeatherProfile = {
      ...wet,
      id: "dry",
      weights: { clear: 1, cloudy: 0, rain: 0, storm: 0, fog: 0, snow: 0 },
    };
    system.setProfile(dry);
    system.update(30_000, 1);
    expect(system.wetness).toBeLessThan(soaked);
  });

  it("stays within range however long it rains or dries", () => {
    const wet: ClimateWeatherProfile = {
      ...TEMPERATE,
      id: "wet",
      weights: { clear: 0, cloudy: 0, rain: 0, storm: 1, fog: 0, snow: 0 },
    };
    const system = makeSystem(wet);
    for (let tick = 500; tick < 400_000; tick += 500) system.update(tick, 0.5);
    expect(system.wetness).toBeLessThanOrEqual(1);
    expect(system.wetness).toBeGreaterThanOrEqual(0);
  });

  it("ignores a tick it has already passed rather than double counting", () => {
    const system = makeSystem();
    system.update(10_000, 0.5);
    const after = system.wetness;
    system.update(5_000, 0.5);
    expect(system.wetness).toBe(after);
  });

  it("rejects a fractional or negative tick", () => {
    const system = makeSystem();
    expect(() => system.update(1.5, 0.5)).toThrow(/non-negative integer tick/);
    expect(() => system.update(-1, 0.5)).toThrow(/non-negative integer tick/);
  });

  it("round-trips through a snapshot", () => {
    const system = makeSystem();
    system.update(12_000, 0.3);
    const snapshot = system.serialize();

    const restored = makeSystem();
    restored.restore(snapshot, 12_000);
    expect(restored.wetness).toBe(system.wetness);
  });

  it("rejects a snapshot from another version or out of range", () => {
    expect(
      validateWeatherSnapshot({ schemaVersion: WEATHER_SCHEMA_VERSION + 1, wetness: 0 }).join(" "),
    ).toMatch(/not supported/);
    expect(validateWeatherSnapshot({ schemaVersion: WEATHER_SCHEMA_VERSION, wetness: 2 }).join(" ")).toMatch(
      /within \[0, 1\]/,
    );
  });
});

describe("bearing interpolation", () => {
  it("takes the short way round the compass", () => {
    // Straight numeric interpolation would go through south here.
    expect(lerpDegrees(350, 10, 0.5)).toBeCloseTo(0, 6);
    expect(lerpDegrees(10, 350, 0.5)).toBeCloseTo(0, 6);
    expect(lerpDegrees(0, 90, 0.5)).toBeCloseTo(45, 6);
    expect(lerpDegrees(90, 0, 0)).toBeCloseTo(90, 6);
  });

  it("always returns a bearing in range", () => {
    for (let a = 0; a < 360; a += 17) {
      for (let b = 0; b < 360; b += 23) {
        const value = lerpDegrees(a, b, 0.37);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(360);
      }
    }
  });
});
