import { hashState } from "../simulation/hash";
import { EnvironmentSystem } from "../world/environment";
import type { ClimateWeatherProfile, WeatherKind } from "../world/weather";
import type { GeoPosition } from "../world/coordinates";

/**
 * Deterministic environment scenario.
 *
 * Runs the world clock forward through whole days and records what the sky did.
 * Two runs of the same scenario must produce the same digest; if they do not,
 * something has started reading a wall clock or a random source, which is the
 * exact failure this exists to catch.
 *
 * Headless by construction: it touches no Babylon and no DOM, so it runs in a
 * plain unit test as easily as in a browser.
 */

export interface EnvironmentScenario {
  readonly id: string;
  readonly seed: number;
  readonly position: GeoPosition;
  readonly profile: ClimateWeatherProfile;
  /** How many in-game days to run. */
  readonly days: number;
  /** How many samples to take per day. */
  readonly samplesPerDay: number;
}

export interface EnvironmentSampleRecord {
  readonly tick: number;
  readonly dayNumber: number;
  readonly timeOfDay: string;
  readonly sunElevationDeg: number;
  readonly lightLevel: number;
  readonly weatherKind: WeatherKind;
  readonly intensity: number;
  readonly windSpeedMps: number;
  readonly temperatureC: number;
  readonly wetness: number;
  readonly visibilityMeters: number;
}

export interface EnvironmentScenarioResult {
  readonly scenarioId: string;
  readonly samples: readonly EnvironmentSampleRecord[];
  /** Digest of every sample. The value that must not change between runs. */
  readonly digest: string;
  /** Distinct weather kinds observed, sorted. */
  readonly weatherKinds: readonly WeatherKind[];
  /** Highest and lowest light level seen, which proves a day/night cycle happened. */
  readonly maxLightLevel: number;
  readonly minLightLevel: number;
  readonly maxWetness: number;
}

export function validateEnvironmentScenario(scenario: EnvironmentScenario): string[] {
  const errors: string[] = [];
  if (!scenario.id) errors.push("id required");
  if (!Number.isInteger(scenario.days) || scenario.days <= 0) {
    errors.push("days must be a positive integer");
  }
  if (!Number.isInteger(scenario.samplesPerDay) || scenario.samplesPerDay <= 0) {
    errors.push("samplesPerDay must be a positive integer");
  }
  if (!Number.isFinite(scenario.seed)) errors.push("seed must be a finite number");
  return errors;
}

export function runEnvironmentScenario(scenario: EnvironmentScenario): EnvironmentScenarioResult {
  const errors = validateEnvironmentScenario(scenario);
  if (errors.length > 0) {
    throw new Error(`Invalid environment scenario "${scenario.id}": ${errors.join("; ")}`);
  }

  const environment = new EnvironmentSystem({ seed: scenario.seed, profile: scenario.profile });
  const dayLength = environment.clock.dayLengthTicks;
  const step = Math.max(1, Math.round(dayLength / scenario.samplesPerDay));

  const samples: EnvironmentSampleRecord[] = [];
  const kinds = new Set<WeatherKind>();
  let maxLightLevel = 0;
  let minLightLevel = 1;
  let maxWetness = 0;

  const total = scenario.days * scenario.samplesPerDay;
  for (let index = 0; index < total; index += 1) {
    environment.advance(step, scenario.position.latitudeDeg);
    const sample = environment.sample({ position: scenario.position, groundHeightMeters: 40 });

    // Rounded before hashing: the digest is a determinism check, not a bit-exact
    // float comparison, and rounding keeps it stable across platforms whose
    // trigonometry differs in the last place.
    samples.push({
      tick: sample.tick,
      dayNumber: sample.dayNumber,
      timeOfDay: sample.timeOfDayLabel,
      sunElevationDeg: round(sample.sun.elevationDeg, 3),
      lightLevel: round(sample.lightLevel, 4),
      weatherKind: sample.weather.kind,
      intensity: round(sample.weather.intensity, 4),
      windSpeedMps: round(sample.weather.windSpeedMps, 3),
      temperatureC: round(sample.weather.temperatureC, 3),
      wetness: round(sample.weather.wetness, 4),
      visibilityMeters: Math.round(sample.effects.visibilityMeters),
    });

    kinds.add(sample.weather.kind);
    maxLightLevel = Math.max(maxLightLevel, sample.lightLevel);
    minLightLevel = Math.min(minLightLevel, sample.lightLevel);
    maxWetness = Math.max(maxWetness, sample.weather.wetness);
  }

  return {
    scenarioId: scenario.id,
    samples,
    digest: hashState(samples),
    weatherKinds: [...kinds].sort(),
    maxLightLevel,
    minLightLevel,
    maxWetness,
  };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * The fixture this milestone's determinism test runs: four days over Hong Kong,
 * sampled eight times a day. Long enough to cross several weather fronts and to
 * see the sun rise and set four times.
 */
export const ENVIRONMENT_SMOKE_SCENARIO = {
  id: "environment-smoke",
  seed: 20260822,
  position: { latitudeDeg: 22.3193, longitudeDeg: 114.1694, altitudeMeters: 0 } satisfies GeoPosition,
  days: 4,
  samplesPerDay: 8,
} as const;
