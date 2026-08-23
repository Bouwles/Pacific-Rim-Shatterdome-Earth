import {
  DEFAULT_DAY_LENGTH_TICKS,
  WORLD_CLOCK_SCHEMA_VERSION,
  WorldClock,
  clearSkyLightLevel,
  moonAt,
  sunAt,
  validateWorldClockSnapshot,
  type CelestialBody,
  type WorldClockOptions,
  type WorldClockSnapshot,
} from "./worldClock";
import {
  WEATHER_SCHEMA_VERSION,
  WeatherSystem,
  validateWeatherSnapshot,
  type ClimateWeatherProfile,
  type WeatherSnapshot,
  type WeatherState,
} from "./weather";
import {
  audioEnvironmentFor,
  classifyWaterState,
  depthZoneFor,
  sampleWaveHeight,
  waveAmplitudeFor,
  waveFieldCoordinates,
  type AudioEnvironment,
  type WaterSituation,
} from "./ocean";
import type { GeoPosition } from "./coordinates";

/**
 * The environment query surface.
 *
 * This is the module AI and combat talk to. It imports nothing from Babylon and
 * nothing from the DOM, which is the point: an AI deciding whether it can see a
 * target must not be able to reach a scene graph, and a test asking the same
 * question must not need one.
 *
 * Everything it returns is derived from the world clock, the weather and the
 * ocean. It owns no rendering decisions; the renderer reads the same sample and
 * decides how to draw it.
 */

export const ENVIRONMENT_SCHEMA_VERSION = 1;

/** Where a new world starts its first day: a little after sunrise. */
export const DEFAULT_START_DAY_FRACTION = 0.3;
/**
 * The tick a fresh world begins on.
 *
 * One constant for every construction path. A new session and a migrated save
 * used to disagree: the save started here and the session started at tick zero,
 * which is midnight, so a new world opened in total darkness.
 */
export const DEFAULT_START_TICKS = Math.round(DEFAULT_DAY_LENGTH_TICKS * DEFAULT_START_DAY_FRACTION);

export interface EnvironmentSnapshot {
  readonly schemaVersion: number;
  readonly clock: WorldClockSnapshot;
  readonly weather: WeatherSnapshot;
}

/** What a caller must tell the environment about where and what it is asking for. */
export interface EnvironmentQueryContext {
  readonly position: GeoPosition;
  /** Ground height at the position, metres above sea level. */
  readonly groundHeightMeters?: number;
  /** Height of the body asking, metres. Defaults to a person. */
  readonly entityHeightMeters?: number;
  /** Where the body's feet are, metres above sea level. Defaults to standing on the ground. */
  readonly feetHeightMeters?: number;
}

/**
 * Effects the environment has on play. Named for what they do rather than for
 * what causes them, so a consumer never has to know which weather kind produced
 * a value.
 */
export interface EnvironmentEffects {
  /** How far a target can be seen, metres. Combines weather, darkness and water. */
  readonly visibilityMeters: number;
  /** Multiplier on ground grip. Below one is slippery. */
  readonly tractionMultiplier: number;
  /** Multiplier on movement speed. Wading and swimming are slow. */
  readonly movementMultiplier: number;
  /** Metres per second of lateral push, before mass is considered. */
  readonly windPushMps: number;
  /** 0 to 1 penalty applied to ranged accuracy by wind and precipitation. */
  readonly rangedAccuracyPenalty: number;
  /** True when footing, visibility or both are bad enough to matter. */
  readonly hazardous: boolean;
}

export interface EnvironmentSample {
  readonly tick: number;
  readonly dayNumber: number;
  readonly dayFraction: number;
  readonly timeOfDayLabel: string;
  readonly sun: CelestialBody;
  readonly moon: CelestialBody;
  /** 0 to 1 after cloud cover and lightning are applied. */
  readonly lightLevel: number;
  readonly weather: WeatherState;
  readonly water: WaterSituation;
  readonly audio: AudioEnvironment;
  readonly effects: EnvironmentEffects;
  /** Wave height at the queried point, metres above sea level. */
  readonly waveHeightMeters: number;
  readonly waveAmplitudeMeters: number;
}

export interface EnvironmentSystemOptions {
  readonly seed: number;
  readonly profile: ClimateWeatherProfile;
  readonly clock?: WorldClockOptions;
}

/** A person, when the caller does not say otherwise. */
const DEFAULT_ENTITY_HEIGHT_METERS = 1.8;

/** Clear-air visibility is capped by darkness before weather is considered. */
const NIGHT_VISIBILITY_FLOOR = 0.12;

export class EnvironmentSystem {
  readonly clock: WorldClock;
  readonly weather: WeatherSystem;

  constructor(options: EnvironmentSystemOptions) {
    this.clock = new WorldClock(options.clock ?? { startTicks: DEFAULT_START_TICKS });
    this.weather = new WeatherSystem({ seed: options.seed, profile: options.profile });
  }

  /**
   * Advances the world by whole ticks and lets wetness follow. Everything else
   * is derived, so this is the only place environment state moves forward.
   */
  advance(ticks: number, latitudeDeg: number): void {
    this.clock.advance(ticks);
    this.weather.update(this.clock.elapsedTicks, this.clearSkyLight(latitudeDeg));
  }

  /** Jumps the clock, used by debug controls. Weather follows to the new tick. */
  setTicks(ticks: number, latitudeDeg: number): void {
    this.clock.setTicks(ticks);
    this.weather.update(ticks, this.clearSkyLight(latitudeDeg));
  }

  skipToDayFraction(fraction: number, latitudeDeg: number): void {
    this.clock.skipToDayFraction(fraction);
    this.weather.update(this.clock.elapsedTicks, this.clearSkyLight(latitudeDeg));
  }

  setClimate(profile: ClimateWeatherProfile): void {
    this.weather.setProfile(profile);
  }

  private clearSkyLight(latitudeDeg: number): number {
    const sun = sunAt(this.clock.dayFraction, this.clock.dayOfYear, latitudeDeg);
    const moon = moonAt(this.clock.dayFraction, this.clock.dayOfYear, this.clock.dayNumber, latitudeDeg);
    return clearSkyLightLevel(sun, moon);
  }

  sample(context: EnvironmentQueryContext): EnvironmentSample {
    const tick = this.clock.elapsedTicks;
    const latitude = context.position.latitudeDeg;
    const sun = sunAt(this.clock.dayFraction, this.clock.dayOfYear, latitude);
    const moon = moonAt(this.clock.dayFraction, this.clock.dayOfYear, this.clock.dayNumber, latitude);
    const weather = this.weather.sample(tick, this.clock.dayFraction);

    // Cloud never takes the sky fully dark, and a lightning flash briefly
    // restores it: both matter because visibility is a gameplay value here, not
    // a mood setting.
    const clearLight = clearSkyLightLevel(sun, moon);
    const clouded = clearLight * (1 - weather.cloudCover * 0.65);
    const lightLevel = Math.min(1, clouded + weather.lightningFlash * 0.55);

    const waveAmplitudeMeters = waveAmplitudeFor(weather.windSpeedMps);
    // Wave phase is read from globe-fixed coordinates, never from the floating
    // origin frame, so the sea does not shift when the origin rebases.
    const field = waveFieldCoordinates(context.position.latitudeDeg, context.position.longitudeDeg);
    const waveHeightMeters = sampleWaveHeight({
      east: field.east,
      north: field.north,
      // One tick is one in-game second, so the tick count is the wave clock.
      timeSeconds: tick,
      windSpeedMps: weather.windSpeedMps,
      windDirectionDeg: weather.windDirectionDeg,
    });

    const groundHeightMeters = context.groundHeightMeters ?? 0;
    const entityHeightMeters = context.entityHeightMeters ?? DEFAULT_ENTITY_HEIGHT_METERS;
    const water = classifyWaterState({
      groundHeightMeters,
      waterHeightMeters: waveHeightMeters,
      entityHeightMeters,
      feetHeightMeters: context.feetHeightMeters ?? Math.max(groundHeightMeters, 0),
    });

    const audio = audioEnvironmentFor(water, weather.windSpeedMps, weather.precipitation);
    const effects = deriveEffects(weather, water, lightLevel);

    return {
      tick,
      dayNumber: this.clock.dayNumber,
      dayFraction: this.clock.dayFraction,
      timeOfDayLabel: this.clock.timeOfDayLabel,
      sun,
      moon,
      lightLevel,
      weather,
      water,
      audio,
      effects,
      waveHeightMeters,
      waveAmplitudeMeters,
    };
  }

  serialize(): EnvironmentSnapshot {
    return {
      schemaVersion: ENVIRONMENT_SCHEMA_VERSION,
      clock: this.clock.serialize(),
      weather: this.weather.serialize(),
    };
  }

  restore(snapshot: EnvironmentSnapshot): void {
    const errors = validateEnvironmentSnapshot(snapshot);
    if (errors.length > 0) throw new Error(`Invalid environment snapshot: ${errors.join("; ")}`);
    this.clock.restore(snapshot.clock);
    this.weather.restore(snapshot.weather, this.clock.elapsedTicks);
  }
}

/**
 * A fresh environment: dawn on day zero, dry ground.
 *
 * One definition, used by a save written before any world existed and by the
 * migration that adds this section to an older file, so the two cannot drift.
 * Dawn rather than midnight because a world that opens in the dark reads as
 * broken.
 */
export function emptyEnvironmentSnapshot(): EnvironmentSnapshot {
  return {
    schemaVersion: ENVIRONMENT_SCHEMA_VERSION,
    clock: {
      schemaVersion: WORLD_CLOCK_SCHEMA_VERSION,
      elapsedTicks: DEFAULT_START_TICKS,
      dayLengthTicks: DEFAULT_DAY_LENGTH_TICKS,
    },
    weather: { schemaVersion: WEATHER_SCHEMA_VERSION, wetness: 0 },
  };
}

export function validateEnvironmentSnapshot(snapshot: EnvironmentSnapshot): string[] {
  const errors: string[] = [];
  if (snapshot.schemaVersion !== ENVIRONMENT_SCHEMA_VERSION) {
    errors.push(
      `environment schemaVersion ${snapshot.schemaVersion} is not supported ` +
        `(expected ${ENVIRONMENT_SCHEMA_VERSION})`,
    );
    return errors;
  }
  if (typeof snapshot.clock !== "object" || snapshot.clock === null) {
    errors.push("environment.clock must be an object");
  } else {
    errors.push(...validateWorldClockSnapshot(snapshot.clock));
  }
  if (typeof snapshot.weather !== "object" || snapshot.weather === null) {
    errors.push("environment.weather must be an object");
  } else {
    errors.push(...validateWeatherSnapshot(snapshot.weather));
  }
  return errors;
}

/** Movement cost per water state. A table rather than a branch. */
const WATER_MOVEMENT_MULTIPLIER: Readonly<Record<WaterSituation["state"], number>> = {
  dry: 1,
  wading: 0.62,
  "surface-combat": 0.45,
  swimming: 0.35,
  underwater: 0.3,
};

/**
 * Turns environment state into the numbers gameplay actually consumes.
 *
 * Kept in one place so weather cannot quietly become cosmetic: if a value is not
 * here, nothing outside rendering can act on it, and the gap is visible.
 */
export function deriveEffects(
  weather: WeatherState,
  water: WaterSituation,
  lightLevel: number,
): EnvironmentEffects {
  // Darkness caps how far anything can be seen before weather narrows it further.
  const darknessCap = NIGHT_VISIBILITY_FLOOR + (1 - NIGHT_VISIBILITY_FLOOR) * lightLevel;
  let visibilityMeters = weather.visibilityMeters * darknessCap;
  if (water.eyesSubmerged) visibilityMeters = Math.min(visibilityMeters, water.zone.visibilityMeters);

  // Wet ground is slippery; frozen wet ground is much worse.
  const iceFactor = weather.frozenPrecipitation && weather.temperatureC <= 0 ? 0.45 : 0.18;
  const tractionMultiplier = Math.max(0.35, 1 - weather.wetness * iceFactor);

  const movementMultiplier = WATER_MOVEMENT_MULTIPLIER[water.state];
  const windPushMps = weather.windSpeedMps * (water.state === "dry" ? 1 : 0.4);
  const rangedAccuracyPenalty = Math.min(
    0.9,
    weather.windSpeedMps / 60 + weather.precipitation * 0.25 + (water.eyesSubmerged ? 0.4 : 0),
  );

  return {
    visibilityMeters,
    tractionMultiplier,
    movementMultiplier,
    windPushMps,
    rangedAccuracyPenalty,
    // Wind belongs here as much as the other three. Leaving it out called a
    // thirty metre per second storm safe as long as the ground had grip and the
    // player could see fifteen hundred metres, which is not a judgement anyone
    // standing in it would agree with.
    hazardous:
      visibilityMeters <= HAZARD_VISIBILITY_METERS ||
      tractionMultiplier < HAZARD_TRACTION ||
      windPushMps >= HAZARD_WIND_MPS ||
      water.state !== "dry",
  };
}

/** Thresholds at which conditions stop being weather and start being a problem. */
const HAZARD_VISIBILITY_METERS = 1_500;
const HAZARD_TRACTION = 0.85;
const HAZARD_WIND_MPS = 15;

/** Underwater visibility for a depth, exposed for callers that only have a depth. */
export function underwaterVisibilityAt(depthMeters: number): number {
  return depthZoneFor(depthMeters).visibilityMeters;
}
