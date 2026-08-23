import { describe, expect, it } from "vitest";
import {
  DEFAULT_START_TICKS,
  ENVIRONMENT_SCHEMA_VERSION,
  EnvironmentSystem,
  deriveEffects,
  emptyEnvironmentSnapshot,
  underwaterVisibilityAt,
  validateEnvironmentSnapshot,
} from "../../src/world/environment";
import { createClimateRegistry } from "../../src/data/climates";
import { createDefaultRegionRegistry } from "../../src/data/regions";
import { WorldState } from "../../src/world/worldState";
import { geo } from "../../src/world/coordinates";
import { DEFAULT_DAY_LENGTH_TICKS } from "../../src/world/worldClock";
import {
  ENVIRONMENT_SMOKE_SCENARIO,
  runEnvironmentScenario,
  validateEnvironmentScenario,
} from "../../src/debug/environmentScenario";
import type { ClimateWeatherProfile } from "../../src/world/weather";

const climates = createClimateRegistry();
const SEED = 20260822;
const HONG_KONG = geo(22.3193, 114.1694, 0);

function makeEnvironment(profileId = "temperate"): EnvironmentSystem {
  return new EnvironmentSystem({ seed: SEED, profile: climates.getOrThrow(profileId) });
}

function makeWorld(): WorldState {
  return new WorldState({
    regions: createDefaultRegionRegistry(),
    seed: SEED,
    climateProfileFor: (climate) => climates.getOrThrow(climate),
  });
}

describe("environment queries", () => {
  it("imports no rendering code", async () => {
    // The point of the module boundary: an AI asking what it can see must not be
    // able to reach a scene graph. Importing it in a plain node test is the
    // proof, since Babylon would need a DOM here.
    const module = await import("../../src/world/environment");
    expect(typeof module.EnvironmentSystem).toBe("function");
  });

  it("advances only in whole ticks", () => {
    const environment = makeEnvironment();
    expect(() => environment.advance(0.5, 22)).toThrow(/whole non-negative ticks/);
  });

  it("reports a full sample for a position", () => {
    const environment = makeEnvironment();
    // Set an absolute noon rather than advancing from zero: a fresh world starts
    // shortly after sunrise, not at midnight.
    environment.setTicks(DEFAULT_DAY_LENGTH_TICKS / 2, HONG_KONG.latitudeDeg);
    const sample = environment.sample({ position: HONG_KONG, groundHeightMeters: 150 });

    expect(sample.timeOfDayLabel).toBe("12:00");
    expect(sample.sun.elevationDeg).toBeGreaterThan(0);
    expect(sample.water.state).toBe("dry");
    expect(sample.audio.state).toBe("surface");
    expect(sample.effects.visibilityMeters).toBeGreaterThan(0);
    expect(sample.effects.movementMultiplier).toBe(1);
  });

  it("runs day and night as the clock advances", () => {
    const environment = makeEnvironment();
    const levels: number[] = [];
    for (let step = 0; step < 8; step += 1) {
      environment.advance(DEFAULT_DAY_LENGTH_TICKS / 8, HONG_KONG.latitudeDeg);
      levels.push(environment.sample({ position: HONG_KONG, groundHeightMeters: 100 }).lightLevel);
    }
    expect(Math.max(...levels)).toBeGreaterThan(0.5);
    expect(Math.min(...levels)).toBeLessThan(0.25);
  });

  it("makes darkness reduce how far anything can be seen", () => {
    const environment = makeEnvironment();
    environment.setTicks(Math.round(DEFAULT_DAY_LENGTH_TICKS * 0.5), HONG_KONG.latitudeDeg);
    const day = environment.sample({ position: HONG_KONG, groundHeightMeters: 100 });
    environment.setTicks(
      Math.round(DEFAULT_DAY_LENGTH_TICKS * 0.5 + DEFAULT_DAY_LENGTH_TICKS / 2),
      HONG_KONG.latitudeDeg,
    );
    const night = environment.sample({ position: HONG_KONG, groundHeightMeters: 100 });

    expect(night.lightLevel).toBeLessThan(day.lightLevel);
    expect(night.effects.visibilityMeters).toBeLessThan(day.effects.visibilityMeters);
  });

  it("changes climate when the player moves between regions", () => {
    const world = makeWorld();
    world.teleportTo("hong-kong");
    expect(world.currentClimate).toBe("subtropical");
    expect(world.environment.weather.climateId).toBe("subtropical");

    world.teleportTo("anchorage");
    expect(world.currentClimate).toBe("subarctic");
    expect(world.environment.weather.climateId).toBe("subarctic");
  });

  it("falls back to open water outside every region", () => {
    const world = makeWorld();
    world.moveTo(geo(-30, -140, 0));
    expect(world.activeRegionId).toBeNull();
    expect(world.currentClimate).toBe("oceanic");
    expect(world.environment.weather.climateId).toBe("oceanic");
  });
});

describe("environment effects on play", () => {
  const weather = (overrides: Record<string, unknown> = {}) =>
    ({
      kind: "storm",
      nextKind: "storm",
      transition: 0,
      intensity: 1,
      cloudCover: 1,
      precipitation: 1,
      frozenPrecipitation: false,
      fogDensity: 0.1,
      windSpeedMps: 30,
      windDirectionDeg: 90,
      temperatureC: 5,
      wetness: 1,
      visibilityMeters: 1_500,
      lightningFlash: 0,
      lastStrikeTick: null,
      ...overrides,
    }) as Parameters<typeof deriveEffects>[0];

  const water = (state: string, eyesSubmerged = false) =>
    ({
      state,
      submergedFraction: eyesSubmerged ? 1 : 0,
      depthMeters: eyesSubmerged ? 300 : 0,
      zone: { id: "deep", maxDepthMeters: 600, visibilityMeters: 14, darkness: 0.8, standable: false },
      grounded: !eyesSubmerged,
      eyesSubmerged,
    }) as Parameters<typeof deriveEffects>[1];

  it("makes wet ground slippery", () => {
    const dry = deriveEffects(weather({ wetness: 0 }), water("dry"), 1);
    const wet = deriveEffects(weather({ wetness: 1 }), water("dry"), 1);
    expect(wet.tractionMultiplier).toBeLessThan(dry.tractionMultiplier);
  });

  it("makes ice far worse than rain", () => {
    const rain = deriveEffects(weather({ wetness: 1, frozenPrecipitation: false }), water("dry"), 1);
    const ice = deriveEffects(
      weather({ wetness: 1, frozenPrecipitation: true, temperatureC: -5 }),
      water("dry"),
      1,
    );
    expect(ice.tractionMultiplier).toBeLessThan(rain.tractionMultiplier);
  });

  it("slows movement in water and slows it most underwater", () => {
    const dry = deriveEffects(weather(), water("dry"), 1).movementMultiplier;
    const wading = deriveEffects(weather(), water("wading"), 1).movementMultiplier;
    const swimming = deriveEffects(weather(), water("swimming"), 1).movementMultiplier;
    const under = deriveEffects(weather(), water("underwater", true), 1).movementMultiplier;
    expect(wading).toBeLessThan(dry);
    expect(swimming).toBeLessThan(wading);
    expect(under).toBeLessThan(swimming);
  });

  it("caps visibility at the depth zone once the eyes are under", () => {
    const effects = deriveEffects(weather({ visibilityMeters: 20_000 }), water("underwater", true), 1);
    expect(effects.visibilityMeters).toBeLessThanOrEqual(14);
    expect(underwaterVisibilityAt(300)).toBe(14);
  });

  it("penalises ranged accuracy in wind, rain and underwater", () => {
    const calm = deriveEffects(weather({ windSpeedMps: 0, precipitation: 0 }), water("dry"), 1);
    const gale = deriveEffects(weather({ windSpeedMps: 40, precipitation: 1 }), water("dry"), 1);
    const under = deriveEffects(weather({ windSpeedMps: 0, precipitation: 0 }), water("underwater", true), 1);
    expect(gale.rangedAccuracyPenalty).toBeGreaterThan(calm.rangedAccuracyPenalty);
    expect(under.rangedAccuracyPenalty).toBeGreaterThan(calm.rangedAccuracyPenalty);
    expect(gale.rangedAccuracyPenalty).toBeLessThanOrEqual(0.9);
  });

  it("flags hazardous conditions", () => {
    expect(deriveEffects(weather(), water("dry"), 1).hazardous).toBe(true);
    const benign = deriveEffects(
      weather({ wetness: 0, visibilityMeters: 20_000, windSpeedMps: 1, precipitation: 0 }),
      water("dry"),
      1,
    );
    expect(benign.hazardous).toBe(false);
  });
});

describe("environment save and load", () => {
  it("round-trips the clock and wetness", () => {
    const environment = makeEnvironment();
    environment.advance(123_456, HONG_KONG.latitudeDeg);
    const snapshot = environment.serialize();

    const restored = makeEnvironment();
    restored.restore(snapshot);
    expect(restored.clock.elapsedTicks).toBe(environment.clock.elapsedTicks);
    expect(restored.weather.wetness).toBe(environment.weather.wetness);

    const before = environment.sample({ position: HONG_KONG, groundHeightMeters: 100 });
    const after = restored.sample({ position: HONG_KONG, groundHeightMeters: 100 });
    expect(after.weather.kind).toBe(before.weather.kind);
    expect(after.lightLevel).toBeCloseTo(before.lightLevel, 10);
    expect(after.timeOfDayLabel).toBe(before.timeOfDayLabel);
  });

  it("survives a world state round trip", () => {
    const world = makeWorld();
    world.teleportTo("sydney");
    world.advanceEnvironment(200_000);
    const snapshot = JSON.parse(JSON.stringify(world.serialize()));

    const restored = makeWorld();
    restored.restore(snapshot);
    expect(restored.environment.clock.elapsedTicks).toBe(world.environment.clock.elapsedTicks);
    expect(restored.environment.weather.wetness).toBe(world.environment.weather.wetness);
    // Climate follows the restored position, not whatever was last set.
    expect(restored.environment.weather.climateId).toBe("temperate");
  });

  it("starts a fresh world after sunrise rather than in the dark", () => {
    const snapshot = emptyEnvironmentSnapshot();
    expect(snapshot.clock.elapsedTicks).toBe(DEFAULT_START_TICKS);
    expect(snapshot.weather.wetness).toBe(0);
    expect(validateEnvironmentSnapshot(snapshot)).toEqual([]);

    // A new session and a migrated save have to agree on the starting hour, or
    // one of them opens in the dark.
    const fresh = makeEnvironment();
    expect(fresh.clock.elapsedTicks).toBe(DEFAULT_START_TICKS);
    expect(fresh.sample({ position: HONG_KONG, groundHeightMeters: 100 }).lightLevel).toBeGreaterThan(0.2);
  });

  it("rejects a snapshot it does not understand", () => {
    const snapshot = emptyEnvironmentSnapshot();
    expect(
      validateEnvironmentSnapshot({ ...snapshot, schemaVersion: ENVIRONMENT_SCHEMA_VERSION + 1 }).join(" "),
    ).toMatch(/not supported/);
    expect(
      validateEnvironmentSnapshot({ ...snapshot, weather: { schemaVersion: 1, wetness: 5 } }).join(" "),
    ).toMatch(/within \[0, 1\]/);
  });
});

describe("environment debug scenario", () => {
  const profile: ClimateWeatherProfile = climates.getOrThrow("subtropical");

  it("produces the same digest on every run", () => {
    const scenario = { ...ENVIRONMENT_SMOKE_SCENARIO, profile };
    const first = runEnvironmentScenario(scenario);
    const second = runEnvironmentScenario(scenario);
    expect(second.digest).toBe(first.digest);
    expect(second.samples).toEqual(first.samples);
  });

  it("produces a different digest for a different seed", () => {
    const a = runEnvironmentScenario({ ...ENVIRONMENT_SMOKE_SCENARIO, profile, seed: 1 });
    const b = runEnvironmentScenario({ ...ENVIRONMENT_SMOKE_SCENARIO, profile, seed: 2 });
    expect(a.digest).not.toBe(b.digest);
  });

  it("runs a real day and night cycle and more than one kind of weather", () => {
    const result = runEnvironmentScenario({ ...ENVIRONMENT_SMOKE_SCENARIO, profile });
    expect(result.samples).toHaveLength(
      ENVIRONMENT_SMOKE_SCENARIO.days * ENVIRONMENT_SMOKE_SCENARIO.samplesPerDay,
    );
    expect(result.maxLightLevel).toBeGreaterThan(0.6);
    expect(result.minLightLevel).toBeLessThan(0.2);
    expect(result.weatherKinds.length).toBeGreaterThan(1);
  });

  it("rejects a scenario it cannot run", () => {
    expect(
      validateEnvironmentScenario({ ...ENVIRONMENT_SMOKE_SCENARIO, profile, days: 0 }).join(" "),
    ).toMatch(/days must be a positive integer/);
    expect(() =>
      runEnvironmentScenario({ ...ENVIRONMENT_SMOKE_SCENARIO, profile, samplesPerDay: 0 }),
    ).toThrow(/Invalid environment scenario/);
  });
});
