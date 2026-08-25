import { ContentRegistry, type RegistryEntry } from "../data/registry";
import { FIXED_STEP_MS } from "../simulation/clock";
import { LEGACY_UNWRAPPED_VERSION, ROOT_SAVE_VERSION, detectSaveVersion, type RootSave } from "./schema";
import { sectorIdAt } from "../world/cubeSphere";
import { WORLD_SCHEMA_VERSION } from "../world/worldState";
import { emptyEnvironmentSnapshot } from "../world/environment";
import { initialAlertState } from "../world/cityActivity";
import { DEFAULT_START_POSITION, DEFAULT_START_REGION_ID } from "../world/start";
import { createFacilityRegistry } from "../data/facilities";
import { emptyShatterdomeSnapshot } from "../shatterdome/facilityState";
import { emptyRosterSnapshot } from "../jaegers/roster";
import { emptyDamageSnapshot } from "../world/destruction";
import { emptyDirectorSnapshot } from "../world/director";
import { emptyMarketSnapshot } from "../world/market";
import { emptyCrewSnapshot } from "../pilots/crew";
import { emptySquadSnapshot } from "../allies/squad";
import { emptyEconomySnapshot } from "../world/economy";

/**
 * One step of the upgrade chain. Steps are pure: same input document always
 * produces the same output, with no clock, no storage and no randomness.
 */
export interface MigrationStep extends RegistryEntry {
  /** Registry id is the version this step upgrades from, so lookup replaces a switch. */
  readonly id: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly description: string;
  apply(document: Record<string, unknown>): Record<string, unknown>;
}

export interface MigrationResult {
  readonly document: RootSave;
  readonly fromVersion: number;
  /** Ids of the steps applied, in order. Empty when the save was already current. */
  readonly applied: readonly string[];
}

/**
 * Wraps a bare kernel snapshot in a save envelope.
 *
 * Version 0 is not a format any released build wrote: it is what
 * `SimulationKernel.serialize()` returns on its own, which is the only save-like
 * artifact that existed before this milestone. Treating it as version 0 means a
 * raw snapshot can still be imported instead of being rejected.
 */
const wrapBareSnapshot: MigrationStep = {
  id: "0",
  fromVersion: LEGACY_UNWRAPPED_VERSION,
  toVersion: 1,
  description: "Wrap a bare simulation snapshot in a versioned save envelope with synthesised metadata.",
  apply: (document) => {
    const seed = typeof document["seed"] === "number" ? document["seed"] : 0;
    const tick = typeof document["tick"] === "number" ? document["tick"] : 0;
    return {
      schemaVersion: 1,
      // Unknown rather than invented: a bare snapshot never recorded a wall clock time.
      savedAt: 0,
      metadata: {
        name: "Recovered snapshot",
        worldSeed: seed,
        // Tick count is the one honest play-time signal a bare snapshot carries.
        playTimeMs: Math.round(tick * FIXED_STEP_MS),
        lastPlayedAt: 0,
        simTick: tick,
        appVersion: "pre-0.1",
        thumbnail: null,
      },
      sim: document,
    };
  },
};

/**
 * Adds the world section introduced by Milestone 04.
 *
 * A version 1 save predates global coordinates entirely, so there is no player
 * position recorded anywhere in it. Rather than invent one, the migration seeds
 * the documented default start and leaves every region untouched at full
 * integrity, which is exactly the state a fresh world begins in.
 */
const addWorldSection: MigrationStep = {
  id: "1",
  fromVersion: 1,
  toVersion: 2,
  description: "Add the world section: player position, active sector, and strategic region records.",
  apply: (document) => ({
    ...document,
    schemaVersion: 2,
    world: {
      // The world schema version as it stood at this step. Writing the current
      // constant here would make a migrated file claim a shape it does not have,
      // and the next step would have nothing to recognise.
      schemaVersion: 1,
      playerPosition: DEFAULT_START_POSITION,
      activeRegionId: DEFAULT_START_REGION_ID,
      activeSectorId: sectorIdAt(DEFAULT_START_POSITION),
      // Left empty on purpose: WorldState.restore seeds a fresh record for every
      // region the current build knows about, so an old save gains new regions
      // rather than carrying a stale list.
      regions: [],
    },
  }),
};

/**
 * Adds the environment section introduced by Milestone 06.
 *
 * A version 2 save has no clock and no weather, so there is nothing to convert:
 * the world it recorded had no time of day at all. It starts at the same fresh
 * environment a new world does, on dry ground shortly after sunrise, which is
 * honest about the fact that this information was never captured rather than
 * fabricating a plausible-looking history for it.
 *
 * The rest of the world section is untouched, so position, sector and every
 * region record survive exactly as written.
 */
const addEnvironmentSection: MigrationStep = {
  id: "2",
  fromVersion: 2,
  toVersion: 3,
  description: "Add the environment section: world clock and weather.",
  apply: (document) => {
    const world = (
      typeof document["world"] === "object" && document["world"] !== null ? document["world"] : {}
    ) as Record<string, unknown>;
    return {
      ...document,
      schemaVersion: 3,
      world: {
        ...world,
        // The world schema version as it stood at this step, not the current
        // constant: writing today's number here would make a migrated file claim
        // a shape it does not have and the next step would skip it.
        schemaVersion: 2,
        environment: emptyEnvironmentSnapshot(),
      },
    };
  },
};

/**
 * Adds alert state to every region record, introduced by Milestone 07.
 *
 * A version 3 save has no alert anywhere, because no region could be alerted.
 * Every record therefore starts calm with nobody evacuated, which is exactly the
 * state a fresh world begins in and the only honest reading of a file that never
 * recorded one. Integrity, safety and tier are untouched.
 */
const addRegionAlerts: MigrationStep = {
  id: "3",
  fromVersion: 3,
  toVersion: 4,
  description: "Add alert level and evacuation progress to every region record.",
  apply: (document) => {
    const world = (
      typeof document["world"] === "object" && document["world"] !== null ? document["world"] : {}
    ) as Record<string, unknown>;
    const regions = Array.isArray(world["regions"]) ? (world["regions"] as Record<string, unknown>[]) : [];
    return {
      ...document,
      schemaVersion: 4,
      world: {
        ...world,
        schemaVersion: WORLD_SCHEMA_VERSION,
        regions: regions.map((record) => ({ ...record, alert: initialAlertState() })),
      },
    };
  },
};

/**
 * Adds the Shatterdome section introduced by Milestone 08.
 *
 * A version 4 save has no facilities recorded, because there was no interior to
 * record: the Shatterdome was a screen that said it was not implemented. Every
 * such file therefore comes back with the same complex a new campaign starts
 * with, standing on the command floor, which is the only honest reading of a
 * file that never captured one.
 *
 * Nothing else in the document is touched: the world, the environment and every
 * region alert survive exactly as written.
 */
const addShatterdomeSection: MigrationStep = {
  id: "4",
  fromVersion: 4,
  toVersion: 5,
  description: "Add the Shatterdome section: facilities, construction progress and interior position.",
  apply: (document) => ({
    ...document,
    schemaVersion: 5,
    shatterdome: emptyShatterdomeSnapshot(createFacilityRegistry()),
  }),
};

/**
 * Adds the roster section introduced by Milestone 13.
 *
 * A version 5 save has no per-machine damage recorded, because damage did not
 * survive a fight: a Jaeger was one health bar that reset when the fight ended.
 * Every machine therefore comes back intact and ready, with no scars and no
 * outstanding work, which is exactly what a file that never recorded damage
 * honestly means.
 *
 * Nothing else in the document is touched.
 */
const addRosterSection: MigrationStep = {
  id: "5",
  fromVersion: 5,
  toVersion: 6,
  description: "Add the roster section: per-machine component damage, scars and repair status.",
  apply: (document) => ({
    ...document,
    schemaVersion: 6,
    roster: emptyRosterSnapshot(),
  }),
};

/**
 * Adds regional damage introduced by Milestone 14.
 *
 * A version 6 save has no record of what any fight did to a city, because
 * damage did not survive one: the streets came back whole the moment you left.
 * Every region therefore comes back undamaged with nothing being rebuilt, which
 * is the only honest reading of a file that never captured any.
 *
 * Nothing else in the document is touched.
 */
const addRegionDamage: MigrationStep = {
  id: "6",
  fromVersion: 6,
  toVersion: 7,
  description: "Add per-region destruction summaries, landmark states and rebuild projects.",
  apply: (document) => {
    const world = (
      typeof document["world"] === "object" && document["world"] !== null ? document["world"] : {}
    ) as Record<string, unknown>;
    const regions = Array.isArray(world["regions"]) ? (world["regions"] as Record<string, unknown>[]) : [];
    return {
      ...document,
      schemaVersion: 7,
      world: {
        ...world,
        schemaVersion: WORLD_SCHEMA_VERSION,
        regions: regions.map((record) => ({
          ...record,
          damage: emptyDamageSnapshot(String(record["regionId"] ?? "")),
        })),
      },
    };
  },
};

/**
 * Adds the attack director introduced by Milestone 16.
 *
 * A version 7 save has no war in it: attacks did not exist as a strategic
 * system, so nothing was scheduled, nothing was escalating and no region had a
 * threat rating. Every such file therefore comes back at the campaign's own
 * opening state, which is the only honest reading of a file that never had one.
 *
 * Nothing else in the document is touched.
 */
const addDirectorSection: MigrationStep = {
  id: "7",
  fromVersion: 7,
  toVersion: 8,
  description: "Add the attack director: escalation, breach pressure, regional threat and incidents.",
  apply: (document) => ({
    ...document,
    schemaVersion: 8,
    director: emptyDirectorSnapshot(),
  }),
};

/**
 * Adds the mission slot introduced by Milestone 17.
 *
 * A version 8 save cannot have a sortie in progress, because deployment did not
 * exist as a lifecycle: there was no way to be out. Every such file therefore
 * comes back with nobody deployed, which is the only honest reading of it.
 *
 * Nothing else in the document is touched.
 */
const addMissionSlot: MigrationStep = {
  id: "8",
  fromVersion: 8,
  toVersion: 9,
  description: "Add the mission slot: the sortie in progress, or null when nobody is out.",
  apply: (document) => ({ ...document, schemaVersion: 9, mission: null }),
};

/**
 * Adds the market introduced by Milestone 18.
 *
 * A version 9 save has no money, no standing with any yard and nothing on
 * order, because none of those existed: a roster was whatever the build shipped
 * with. Every such file therefore comes back with the opening balance and a
 * board that has not rotated yet.
 *
 * Nothing else in the document is touched.
 */
const addMarketSection: MigrationStep = {
  id: "9",
  fromVersion: 9,
  toVersion: 10,
  description: "Add the market: funding, standing with each yard, deliveries and the rotation.",
  apply: (document) => ({ ...document, schemaVersion: 10, market: emptyMarketSnapshot() }),
};

/**
 * Version 10 to 11: the people.
 *
 * Adds a `crew` section: one record per pilot carrying their status, recent
 * stress, injuries being carried, the link tracks they have built with everybody
 * they have flown with, and the ids of sorties already paid out.
 *
 * A version 10 save has none of that, because pilots were a table to be read
 * rather than people with a history. Every such file therefore comes back with a
 * crew who are all fit, unstressed, and strangers to each other, which is the
 * only honest reading of a file that never recorded otherwise.
 *
 * The settled-mission list starts empty. That is safe because it only ever
 * prevents double payment, and a save written before this existed has no
 * mission result waiting to be applied.
 */
const addCrewSection: MigrationStep = {
  id: "10",
  fromVersion: 10,
  toVersion: 11,
  description: "Add the crew: links, stress, injuries, and the sorties already paid out.",
  apply: (document) => ({ ...document, schemaVersion: 11, crew: emptyCrewSnapshot() }),
};

/**
 * Version 11 to 12: the allied crews.
 *
 * Adds a `squad` section: one record per allied crew carrying the machine they
 * fly, how many sorties they have flown beside the player, the confidence that
 * has moved with those results, their standing order, what they have learned,
 * and the ids of sorties already settled.
 *
 * A version 11 save has none of that, because allies were a field on a plan that
 * was always empty. Every such file comes back with crews who are unassigned, at
 * their authored confidence, on the default order, and who have learned nothing.
 *
 * Nothing else in the document is touched.
 */
const addSquadSection: MigrationStep = {
  id: "11",
  fromVersion: 11,
  toVersion: 12,
  description: "Add the squad: allied crews, what they fly, what they have learned and their orders.",
  apply: (document) => ({ ...document, schemaVersion: 12, squad: emptySquadSnapshot() }),
};

/**
 * Version 12 to 13: the economy.
 *
 * Adds an `economy` section: every resource the programme holds, the difficulty
 * it is being run at, and the ledger of how each balance got where it is,
 * including the references that stop a reward being paid twice.
 *
 * A version 12 save carried funding, salvage and samples inside the market
 * section. Those are read across rather than thrown away: the funding a player
 * had is the funding they keep, salvage becomes structural alloy, and samples
 * become research data. What such a file cannot have is a history, so the
 * ledger starts empty and the first line written after loading is the first
 * line there has ever been.
 */
const addEconomySection: MigrationStep = {
  id: "12",
  fromVersion: 12,
  toVersion: 13,
  description: "Add the economy: resources, difficulty and the ledger.",
  apply: (document) => {
    const market = (document as Record<string, unknown>)["market"] as
      { funding?: number; salvageTons?: number; researchSamples?: number } | undefined;
    const snapshot = emptyEconomySnapshot();
    const carried = {
      ...snapshot,
      pool: {
        ...snapshot.pool,
        funding: numberOr(market?.funding, 0),
        alloy: numberOr(market?.salvageTons, 0),
        researchData: numberOr(market?.researchSamples, 0),
      },
    };
    return { ...document, schemaVersion: 13, economy: carried };
  },
};

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function createMigrationRegistry(): ContentRegistry<MigrationStep> {
  const registry = new ContentRegistry<MigrationStep>((entry) => {
    const errors: string[] = [];
    if (!Number.isInteger(entry.fromVersion) || entry.fromVersion < 0) {
      errors.push("fromVersion must be a non-negative integer");
    }
    if (entry.toVersion !== entry.fromVersion + 1) {
      errors.push("toVersion must be exactly fromVersion + 1 so the chain has no gaps");
    }
    if (entry.id !== String(entry.fromVersion)) {
      errors.push("migration id must be its fromVersion, so lookup is a registry hit rather than a search");
    }
    return errors;
  });
  registry.register(wrapBareSnapshot);
  registry.register(addWorldSection);
  registry.register(addEnvironmentSection);
  registry.register(addRegionAlerts);
  registry.register(addShatterdomeSection);
  registry.register(addRosterSection);
  registry.register(addRegionDamage);
  registry.register(addDirectorSection);
  registry.register(addMissionSlot);
  registry.register(addMarketSection);
  registry.register(addCrewSection);
  registry.register(addSquadSection);
  registry.register(addEconomySection);
  return registry;
}

/**
 * Upgrades a document to the current version by walking one step at a time.
 * Refuses rather than guesses when a step is missing or the file is newer than
 * this build understands.
 */
export function migrateSave(
  document: unknown,
  registry: ContentRegistry<MigrationStep> = createMigrationRegistry(),
): MigrationResult {
  const fromVersion = detectSaveVersion(document);

  if (fromVersion > ROOT_SAVE_VERSION) {
    throw new Error(
      `Save is version ${fromVersion} but this build understands up to ${ROOT_SAVE_VERSION}. ` +
        "It was written by a newer version of the game; update before loading it.",
    );
  }

  let current = document as Record<string, unknown>;
  const applied: string[] = [];
  let version = fromVersion;

  while (version < ROOT_SAVE_VERSION) {
    const step = registry.get(String(version));
    if (!step) {
      throw new Error(
        `No migration registered from save version ${version} to ${version + 1}; ` +
          "this save cannot be upgraded without data loss.",
      );
    }
    current = step.apply(current);
    applied.push(step.id);
    version = step.toVersion;
  }

  return { document: current as unknown as RootSave, fromVersion, applied };
}

export function needsMigration(document: unknown): boolean {
  return detectSaveVersion(document) < ROOT_SAVE_VERSION;
}
