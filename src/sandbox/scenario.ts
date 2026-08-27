import { ContentRegistry } from "../data/registry";
import { REGION_DEFINITIONS } from "../data/regions";
import { WEATHER_KINDS, type WeatherKind } from "../world/weather";
import { OBJECTIVE_IDS, type ObjectiveId } from "../missions/objectives";
import { DIFFICULTY_LEVELS, type Difficulty } from "../world/economy";
import { compatible, createMutationRegistry, type MutationDefinition } from "../data/mutations";
import { createKaijuRegistry } from "../data/kaiju";
import { jaegerRegistry } from "../data/jaegers";
import { createPilotRegistry } from "../data/pilots";
import { REGION_PROFILES } from "../data/regionProfiles";
import { REGION_DEFINITIONS as REGIONS_FOR_CLIMATE } from "../data/regions";
import { DIVEABLE_DEPTH_METERS } from "../world/regionIdentity";

/**
 * A battle somebody built on purpose.
 *
 * The whole point of the sandbox is that it is *not* the campaign: nothing here
 * costs anything, nothing here is earned, and nothing here can reach a career
 * save. What it is instead is a complete description of a fight, small enough to
 * put in a file and hand to somebody else.
 *
 * Everything is plain serializable data with stable ids, so a scenario written
 * today opens tomorrow, and a scenario that names something this build has never
 * heard of is refused with a sentence saying which thing and why, rather than
 * loading a half-built scene.
 *
 * No Babylon, no DOM, no clock, no RNG.
 */

/** Bumped when the shape changes in a way an older build would misread. */
export const SANDBOX_SCHEMA_VERSION = 1;

/** How wrecked the city starts. A preset rather than a slider, so it is legible. */
export const CITY_DAMAGE_PRESETS = ["pristine", "scarred", "half-ruined", "levelled"] as const;
export type CityDamagePreset = (typeof CITY_DAMAGE_PRESETS)[number];

/** How much of the tide is in. Decides whether anything can fight underwater. */
export const WATER_STATES = ["low-tide", "normal", "high-tide", "surge"] as const;
export type WaterState = (typeof WATER_STATES)[number];

/** How hard the creatures try. Separate from difficulty, which is about money. */
export const AI_AGGRESSION = ["passive", "cautious", "normal", "relentless"] as const;
export type AiAggression = (typeof AI_AGGRESSION)[number];

/** One creature in a wave, and what has been done to it. */
export interface SandboxCombatant {
  readonly kaijuId: string;
  /** Mutation ids stacked on it. Checked against each other for compatibility. */
  readonly mutationIds: readonly string[];
}

/** One wave, and how long after the last one it arrives. */
export interface SandboxWave {
  readonly combatants: readonly SandboxCombatant[];
  /** Seconds after the previous wave is cleared. Zero means immediately. */
  readonly delaySeconds: number;
}

/** One machine on the player's side, and who is in it. */
export interface SandboxMachine {
  readonly chassisId: string;
  /** Pilot ids. Empty is allowed: an unmanned machine stands there, which is a thing to test. */
  readonly pilotIds: readonly string[];
}

export interface SandboxScenario {
  readonly schemaVersion: number;
  /** Stable id. Used for the library and for overwriting rather than duplicating. */
  readonly id: string;
  readonly name: string;
  /** The build that wrote it, so a cross-version file can be marked rather than guessed at. */
  readonly buildVersion: string;
  /** Everything random in the run comes from this, so a scenario replays. */
  readonly seed: number;

  readonly regionId: string;
  /** 0 to 1 through the day. 0 is midnight, 0.5 is noon. */
  readonly dayFraction: number;
  readonly weather: WeatherKind;
  /** 0 to 1 of how hard that weather is doing it. */
  readonly weatherIntensity: number;
  readonly water: WaterState;

  readonly squad: readonly SandboxMachine[];
  readonly waves: readonly SandboxWave[];

  readonly objective: ObjectiveId;
  readonly cityDamage: CityDamagePreset;
  readonly difficulty: Difficulty;
  readonly aggression: AiAggression;
}

/** Registries a scenario is checked against. Injected, so a test can vary them. */
export interface ScenarioRegistries {
  readonly mutations: ContentRegistry<MutationDefinition>;
  readonly kaijuIds: ReadonlySet<string>;
  readonly chassisIds: ReadonlySet<string>;
  readonly pilotIds: ReadonlySet<string>;
  readonly regionIds: ReadonlySet<string>;
}

/** The live registries. Everything spawnable is spawnable because it is here. */
export function liveRegistries(): ScenarioRegistries {
  return {
    mutations: createMutationRegistry(),
    kaijuIds: new Set(
      createKaijuRegistry()
        .all()
        .map((entry) => entry.id),
    ),
    // Every chassis the build knows, which is what "spawn any unlocked unit"
    // means in a mode with no unlocks. No source edit spawns anything here.
    chassisIds: new Set(jaegerRegistry.all().map((entry) => entry.id)),
    pilotIds: new Set(
      createPilotRegistry()
        .all()
        .map((entry) => entry.id),
    ),
    regionIds: new Set(REGION_DEFINITIONS.map((entry) => entry.id)),
  };
}

/** The most common thing somebody wants: one machine, one creature, in daylight. */
export function defaultScenario(overrides: Partial<SandboxScenario> = {}): SandboxScenario {
  return {
    schemaVersion: SANDBOX_SCHEMA_VERSION,
    id: "sandbox.untitled",
    name: "Untitled scenario",
    buildVersion: "0.3.0",
    seed: 20260908,
    regionId: "hong-kong",
    dayFraction: 0.5,
    weather: "clear",
    weatherIntensity: 0.3,
    water: "normal",
    squad: [{ chassisId: "heavy-mk4", pilotIds: [] }],
    waves: [{ combatants: [{ kaijuId: "kaiju.biped-alpha", mutationIds: [] }], delaySeconds: 0 }],
    objective: "objective.intercept",
    cityDamage: "pristine",
    difficulty: "standard",
    aggression: "normal",
    ...overrides,
  };
}

/**
 * Everything wrong with a scenario, in sentences.
 *
 * Two kinds of problem live here, and both matter. The first is a name this
 * build does not have, which is what a modded or cross-version file looks like.
 * The second is a combination that is individually fine and jointly impossible,
 * like starting a fight underwater somewhere too shallow to dive. Loading either
 * one would produce a scene that is broken in a way nobody could diagnose, so
 * both are refused here with the reason attached.
 */
export function validateScenario(
  scenario: SandboxScenario,
  registries: ScenarioRegistries = liveRegistries(),
): readonly string[] {
  const errors: string[] = [];

  if (scenario.schemaVersion !== SANDBOX_SCHEMA_VERSION) {
    errors.push(
      `This scenario is version ${scenario.schemaVersion} and this build reads version ` +
        `${SANDBOX_SCHEMA_VERSION}. It was written by a different version of the game.`,
    );
  }
  if (scenario.name.trim().length === 0) errors.push("A scenario needs a name.");
  if (!Number.isFinite(scenario.seed)) errors.push("The seed must be a number.");

  if (!registries.regionIds.has(scenario.regionId)) {
    errors.push(`There is no region called "${scenario.regionId}" in this build.`);
  }
  if (!WEATHER_KINDS.includes(scenario.weather)) {
    errors.push(`There is no weather called "${scenario.weather}" in this build.`);
  }
  if (scenario.dayFraction < 0 || scenario.dayFraction > 1) {
    errors.push("The time of day must be between 0 and 1.");
  }
  if (scenario.weatherIntensity < 0 || scenario.weatherIntensity > 1) {
    errors.push("Weather intensity must be between 0 and 1.");
  }
  if (!WATER_STATES.includes(scenario.water)) errors.push(`Unknown water state "${scenario.water}".`);
  if (!OBJECTIVE_IDS.includes(scenario.objective)) {
    errors.push(`There is no objective called "${scenario.objective}" in this build.`);
  }
  if (!CITY_DAMAGE_PRESETS.includes(scenario.cityDamage)) {
    errors.push(`Unknown city damage preset "${scenario.cityDamage}".`);
  }
  if (!DIFFICULTY_LEVELS.includes(scenario.difficulty)) {
    errors.push(`Unknown difficulty "${scenario.difficulty}".`);
  }
  if (!AI_AGGRESSION.includes(scenario.aggression)) {
    errors.push(`Unknown aggression setting "${scenario.aggression}".`);
  }

  if (scenario.squad.length === 0) errors.push("A scenario needs at least one machine on your side.");
  for (const machine of scenario.squad) {
    if (!registries.chassisIds.has(machine.chassisId)) {
      errors.push(`There is no machine called "${machine.chassisId}" in this build.`);
    }
    if (machine.pilotIds.length > 2) {
      errors.push(`${machine.chassisId} has ${machine.pilotIds.length} pilots, and a conn-pod seats two.`);
    }
    for (const pilotId of machine.pilotIds) {
      if (!registries.pilotIds.has(pilotId)) {
        errors.push(`There is no pilot called "${pilotId}" in this build.`);
      }
    }
  }

  if (scenario.waves.length === 0) errors.push("A scenario needs at least one wave.");
  scenario.waves.forEach((wave, index) => {
    if (wave.combatants.length === 0) errors.push(`Wave ${index + 1} has nothing in it.`);
    if (wave.delaySeconds < 0) errors.push(`Wave ${index + 1} cannot arrive before the one before it.`);
    for (const combatant of wave.combatants) {
      if (!registries.kaijuIds.has(combatant.kaijuId)) {
        errors.push(`There is no creature called "${combatant.kaijuId}" in this build.`);
      }
      const mutations: MutationDefinition[] = [];
      for (const mutationId of combatant.mutationIds) {
        const mutation = registries.mutations.get(mutationId);
        if (!mutation) {
          errors.push(`There is no mutation called "${mutationId}" in this build.`);
          continue;
        }
        // Checked against what is already on this creature rather than against a
        // list, because two mutations can each be fine and still not go together.
        const clash = mutations.find((existing) => !compatible(existing, mutation));
        if (clash) {
          errors.push(
            `${mutation.displayName} and ${clash.displayName} cannot both be on the same creature.`,
          );
        }
        mutations.push(mutation);
      }
    }
  });

  errors.push(...combinationErrors(scenario));
  return errors;
}

/**
 * Combinations that are impossible rather than merely unusual.
 *
 * Each one is a thing somebody would reasonably try, that would produce a scene
 * that looks broken rather than refused. Saying which two settings disagree is
 * the whole value here: "cannot load" would send somebody hunting.
 */
function combinationErrors(scenario: SandboxScenario): readonly string[] {
  const errors: string[] = [];
  const profile = REGION_PROFILES.find((entry) => entry.id === scenario.regionId);
  const region = REGIONS_FOR_CLIMATE.find((entry) => entry.id === scenario.regionId);
  const place = region?.displayName ?? scenario.regionId;

  if (scenario.water === "surge" && profile && profile.shoreline.shelfDepthMeters < DIVEABLE_DEPTH_METERS) {
    errors.push(
      `A surge needs water to surge into, and the shelf off ${place} is ` +
        `${profile.shoreline.shelfDepthMeters} m deep, under the ${DIVEABLE_DEPTH_METERS} m anything ` +
        `needs to dive. Pick a deeper shore or a lower tide.`,
    );
  }
  if (scenario.regionId === "pacific-breach" && scenario.cityDamage !== "pristine") {
    errors.push(
      "The Breach has no city, so there is nothing there to have damaged. Set city damage to pristine.",
    );
  }
  if (scenario.regionId === "pacific-breach" && scenario.objective === "objective.rescue") {
    errors.push("There is nobody at the Breach to rescue. Pick a city, or a different objective.");
  }
  if (scenario.objective === "objective.escort" && scenario.squad.length < 2) {
    errors.push("An escort needs something to escort. Add a second machine.");
  }
  if (scenario.weather === "snow" && region?.climate === "tropical") {
    errors.push(`It does not snow in ${place}. Pick a colder region or different weather.`);
  }

  return errors;
}

/** True when nothing in it is refused. Convenience for callers that only ask. */
export function scenarioIsPlayable(
  scenario: SandboxScenario,
  registries: ScenarioRegistries = liveRegistries(),
): boolean {
  return validateScenario(scenario, registries).length === 0;
}

/** How many creatures a scenario will put on the field in total. */
export function totalCombatants(scenario: SandboxScenario): number {
  return scenario.waves.reduce((sum, wave) => sum + wave.combatants.length, 0);
}
