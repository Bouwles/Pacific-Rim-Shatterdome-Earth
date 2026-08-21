import { ContentRegistry, type RegistryEntry } from "../data/registry";
import { FIXED_STEP_MS } from "../simulation/clock";
import { LEGACY_UNWRAPPED_VERSION, ROOT_SAVE_VERSION, detectSaveVersion, type RootSave } from "./schema";

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
