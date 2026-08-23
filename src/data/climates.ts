import { ContentRegistry } from "./registry";
import { validateClimateWeatherProfile, type ClimateWeatherProfile } from "../world/weather";
import { CLIMATE_ZONES, type ClimateZone } from "../world/regions";

/**
 * What weather each climate produces.
 *
 * Keyed by the same `ClimateZone` union regions and biomes use, so a region, the
 * terrain under it and the sky above it cannot disagree about what a climate is.
 *
 * Weights are relative likelihoods, not probabilities: they do not need to sum
 * to anything, and a zero excludes a kind outright. Numbers are chosen for
 * gameplay variety rather than from climate records, which is the same standard
 * the region table already sets.
 *
 * This is content and lives in the content layer. `src/world/weather.ts` takes a
 * profile as a parameter and never imports this file, which is what keeps the
 * world layer from depending on content (see TECH_DECISIONS.md for the import
 * cycle that rule exists to prevent).
 */

const PROFILES: readonly ClimateWeatherProfile[] = [
  {
    id: "polar",
    weights: { clear: 3, cloudy: 4, rain: 0, storm: 1, fog: 2, snow: 6 },
    baseTemperatureC: -18,
    dailySwingC: 6,
    baseWindMps: 9,
  },
  {
    id: "subarctic",
    weights: { clear: 3, cloudy: 5, rain: 2, storm: 1, fog: 3, snow: 4 },
    baseTemperatureC: -2,
    dailySwingC: 9,
    baseWindMps: 8,
  },
  {
    id: "temperate",
    weights: { clear: 5, cloudy: 5, rain: 4, storm: 2, fog: 2, snow: 1 },
    baseTemperatureC: 13,
    dailySwingC: 10,
    baseWindMps: 6,
  },
  {
    id: "subtropical",
    weights: { clear: 6, cloudy: 4, rain: 4, storm: 3, fog: 1, snow: 0 },
    baseTemperatureC: 23,
    dailySwingC: 8,
    baseWindMps: 6,
  },
  {
    id: "tropical",
    weights: { clear: 5, cloudy: 4, rain: 6, storm: 4, fog: 1, snow: 0 },
    baseTemperatureC: 28,
    dailySwingC: 6,
    baseWindMps: 5,
  },
  {
    id: "arid",
    weights: { clear: 9, cloudy: 3, rain: 1, storm: 1, fog: 0, snow: 0 },
    baseTemperatureC: 21,
    dailySwingC: 16,
    baseWindMps: 7,
  },
  {
    id: "oceanic",
    weights: { clear: 3, cloudy: 5, rain: 4, storm: 4, fog: 3, snow: 0 },
    baseTemperatureC: 17,
    dailySwingC: 4,
    baseWindMps: 12,
  },
];

export function createClimateRegistry(): ContentRegistry<ClimateWeatherProfile> {
  const registry = new ContentRegistry<ClimateWeatherProfile>((profile) => {
    const errors = validateClimateWeatherProfile(profile);
    if (!CLIMATE_ZONES.includes(profile.id as ClimateZone)) {
      errors.push(`id must be a climate zone: ${CLIMATE_ZONES.join(", ")}`);
    }
    return errors;
  });
  for (const profile of PROFILES) registry.register(profile);
  return registry;
}

export const CLIMATE_WEATHER_PROFILES = PROFILES;

/**
 * The profile for a climate. Throws on an unknown zone rather than silently
 * falling back, because a region with no weather would look like a bug in the
 * sky rather than a missing table row.
 */
export function climateProfileFor(
  registry: ContentRegistry<ClimateWeatherProfile>,
  climate: ClimateZone,
): ClimateWeatherProfile {
  return registry.getOrThrow(climate);
}
