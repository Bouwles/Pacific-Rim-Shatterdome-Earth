import { hashState } from "../simulation/hash";
import {
  ALERT_LEVELS,
  advanceAlert,
  initialAlertState,
  sampleActivity,
  setAlertLevel,
  type ActivitySample,
  type AlertLevel,
  type CityAlertState,
} from "../world/cityActivity";
import type { DistrictDefinition, DistrictKind } from "../data/districts";

/**
 * Deterministic city alert scenario.
 *
 * Walks a region through an alert from calm to recovery and records what every
 * district did. Two runs must produce the same digest; if they do not, something
 * in the activity model has started reading a clock or a random source.
 *
 * This is the scenario the milestone's "an alert changes the city" claim is
 * measured against, and it runs headless, so the claim is checkable without a
 * browser.
 */

export interface CityScenarioDistrict {
  readonly districtId: DistrictKind;
  readonly populationDensityThousands: number;
  readonly coastal: boolean;
}

export interface CityScenarioStage {
  readonly level: AlertLevel;
  /** How long to hold this level, in ticks. */
  readonly ticks: number;
}

export interface CityScenario {
  readonly id: string;
  readonly districts: readonly CityScenarioDistrict[];
  readonly stages: readonly CityScenarioStage[];
  /** Samples taken per stage, evenly spaced. */
  readonly samplesPerStage: number;
  readonly dayFraction: number;
  readonly precipitation: number;
  readonly windSpeedMps: number;
  readonly integrity: number;
}

export interface CityScenarioRecord {
  readonly tick: number;
  readonly level: AlertLevel;
  readonly evacuationProgress: number;
  readonly districtId: DistrictKind;
  readonly civilian: number;
  readonly vehicle: number;
  readonly shipping: number;
  readonly aircraft: number;
  readonly military: number;
  readonly evacuationFlow: number;
  readonly sirens: boolean;
}

export interface CityScenarioResult {
  readonly scenarioId: string;
  readonly records: readonly CityScenarioRecord[];
  readonly digest: string;
  /** Peak and trough per channel across the whole run, for acceptance checks. */
  readonly peak: Readonly<Record<string, number>>;
  readonly trough: Readonly<Record<string, number>>;
  readonly sirenTicks: number;
  readonly maxEvacuationProgress: number;
}

export function validateCityScenario(scenario: CityScenario): string[] {
  const errors: string[] = [];
  if (!scenario.id) errors.push("id required");
  if (scenario.districts.length === 0) errors.push("districts must not be empty");
  if (scenario.stages.length === 0) errors.push("stages must not be empty");
  for (const stage of scenario.stages) {
    if (!ALERT_LEVELS.includes(stage.level)) errors.push(`unknown alert level "${stage.level}"`);
    if (!Number.isInteger(stage.ticks) || stage.ticks <= 0) {
      errors.push(`stage ${stage.level} ticks must be a positive integer`);
    }
  }
  if (!Number.isInteger(scenario.samplesPerStage) || scenario.samplesPerStage <= 0) {
    errors.push("samplesPerStage must be a positive integer");
  }
  return errors;
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function runCityScenario(scenario: CityScenario): CityScenarioResult {
  const errors = validateCityScenario(scenario);
  if (errors.length > 0) {
    throw new Error(`Invalid city scenario "${scenario.id}": ${errors.join("; ")}`);
  }

  let alert: CityAlertState = initialAlertState();
  let tick = 0;
  const records: CityScenarioRecord[] = [];
  const peak: Record<string, number> = {};
  const trough: Record<string, number> = {};
  let sirenTicks = 0;
  let maxEvacuationProgress = 0;

  const track = (key: string, value: number): void => {
    peak[key] = Math.max(peak[key] ?? 0, value);
    trough[key] = Math.min(trough[key] ?? 1, value);
  };

  for (const stage of scenario.stages) {
    alert = setAlertLevel(alert, stage.level, tick);
    const step = Math.max(1, Math.floor(stage.ticks / scenario.samplesPerStage));

    for (let sample = 0; sample < scenario.samplesPerStage; sample += 1) {
      alert = advanceAlert(alert, step);
      tick += step;
      maxEvacuationProgress = Math.max(maxEvacuationProgress, alert.evacuationProgress);

      for (const district of scenario.districts) {
        const activity: ActivitySample = sampleActivity({
          districtId: district.districtId,
          populationDensityThousands: district.populationDensityThousands,
          coastal: district.coastal,
          alert,
          tick,
          dayFraction: scenario.dayFraction,
          precipitation: scenario.precipitation,
          windSpeedMps: scenario.windSpeedMps,
          integrity: scenario.integrity,
        });

        if (activity.sirens) sirenTicks += step;
        track("civilian", activity.civilianDensity);
        track("vehicle", activity.vehicleDensity);
        track("shipping", activity.shippingDensity);
        track("aircraft", activity.aircraftDensity);
        track("military", activity.militaryDensity);
        track("evacuationFlow", activity.evacuationFlow);

        records.push({
          tick,
          level: alert.level,
          evacuationProgress: round(alert.evacuationProgress),
          districtId: district.districtId,
          civilian: round(activity.civilianDensity),
          vehicle: round(activity.vehicleDensity),
          shipping: round(activity.shippingDensity),
          aircraft: round(activity.aircraftDensity),
          military: round(activity.militaryDensity),
          evacuationFlow: round(activity.evacuationFlow),
          sirens: activity.sirens,
        });
      }
    }
  }

  return {
    scenarioId: scenario.id,
    records,
    digest: hashState(records),
    peak,
    trough,
    sirenTicks,
    maxEvacuationProgress,
  };
}

/**
 * The fixture this milestone's alert test runs: a full alert cycle over a
 * waterfront district, the slums and the docks, at midday in fair weather.
 * Long enough for an evacuation to actually complete.
 */
export const CITY_ALERT_SCENARIO: CityScenario = {
  id: "city-alert",
  districts: [
    { districtId: "waterfront", populationDensityThousands: 28, coastal: true },
    { districtId: "slums", populationDensityThousands: 96, coastal: false },
    { districtId: "docks", populationDensityThousands: 4, coastal: true },
  ],
  stages: [
    { level: "calm", ticks: 3_600 },
    { level: "watch", ticks: 3_600 },
    { level: "warning", ticks: 14_400 },
    { level: "attack", ticks: 7_200 },
    { level: "recovery", ticks: 21_600 },
  ],
  samplesPerStage: 6,
  dayFraction: 0.5,
  precipitation: 0,
  windSpeedMps: 4,
  integrity: 1,
};

/** Builds scenario districts from the shipped district table. */
export function scenarioDistrictsFrom(
  districts: readonly DistrictDefinition[],
): readonly CityScenarioDistrict[] {
  return districts.map((district) => ({
    districtId: district.id,
    populationDensityThousands: district.populationDensityThousands,
    coastal: district.coastal,
  }));
}
