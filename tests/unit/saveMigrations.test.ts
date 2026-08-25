import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ContentRegistry } from "../../src/data/registry";
import {
  createMigrationRegistry,
  migrateSave,
  needsMigration,
  type MigrationStep,
} from "../../src/saves/migrations";
import { ROOT_SAVE_VERSION, detectSaveVersion, validateRootSave } from "../../src/saves/schema";

const fixturePath = fileURLToPath(new URL("../fixtures/saves/v0-bare-snapshot.json", import.meta.url));
const bareSnapshot = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;

describe("detectSaveVersion", () => {
  it("recognises a bare kernel snapshot as version 0", () => {
    expect(detectSaveVersion(bareSnapshot)).toBe(0);
  });

  it("reads the envelope version from a wrapped save", () => {
    expect(detectSaveVersion(migrateSave(bareSnapshot).document)).toBe(ROOT_SAVE_VERSION);
  });

  it("rejects documents it cannot identify", () => {
    expect(() => detectSaveVersion(null)).toThrow(/not an object/);
    expect(() => detectSaveVersion("nope")).toThrow(/not an object/);
    expect(() => detectSaveVersion({ sim: {} })).toThrow(/no usable schemaVersion/);
  });
});

describe("migrateSave from the version 0 fixture", () => {
  it("upgrades to the current version and validates", () => {
    const result = migrateSave(bareSnapshot);

    expect(result.fromVersion).toBe(0);
    // Walks the whole chain: wrap the bare snapshot, then add the world section.
    expect(result.applied).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(result.document.schemaVersion).toBe(ROOT_SAVE_VERSION);
    expect(validateRootSave(result.document)).toEqual([]);
  });

  it("loses none of the simulation data", () => {
    const { document } = migrateSave(bareSnapshot);

    expect(document.sim.seed).toBe(20260819);
    expect(document.sim.tick).toBe(240);
    expect(document.sim.entities.nextId).toBe(4);
    expect(document.sim.entities.entities).toHaveLength(3);
    // Component values must survive exactly, not approximately.
    expect(document.sim.entities.entities[0]?.components).toEqual({
      transform: { x: 12.5, y: 0, z: -4.25 },
      velocity: { x: 0.5, y: 0, z: -0.25 },
    });
  });

  it("derives metadata from the snapshot instead of inventing it", () => {
    const { document } = migrateSave(bareSnapshot);

    expect(document.metadata.worldSeed).toBe(20260819);
    expect(document.metadata.simTick).toBe(240);
    // 240 ticks at 1/60s is four seconds of simulated play.
    expect(document.metadata.playTimeMs).toBe(4000);
    // A bare snapshot never recorded wall clock time, so these stay unknown rather than faked.
    expect(document.metadata.lastPlayedAt).toBe(0);
    expect(document.savedAt).toBe(0);
    expect(document.metadata.thumbnail).toBeNull();
    expect(document.metadata.name).toBeTruthy();
  });

  it("does not mutate the input document", () => {
    const before = JSON.stringify(bareSnapshot);
    migrateSave(bareSnapshot);
    expect(JSON.stringify(bareSnapshot)).toBe(before);
  });

  it("is pure: repeated runs give an identical result", () => {
    expect(migrateSave(bareSnapshot).document).toEqual(migrateSave(bareSnapshot).document);
  });
});

describe("migrateSave guards", () => {
  it("leaves a current-version save untouched", () => {
    const current = migrateSave(bareSnapshot).document;
    const result = migrateSave(current);

    expect(result.applied).toEqual([]);
    expect(result.document).toEqual(current);
    expect(needsMigration(current)).toBe(false);
  });

  it("refuses a save written by a newer build", () => {
    const future = { schemaVersion: ROOT_SAVE_VERSION + 5, sim: {}, metadata: {}, savedAt: 0 };
    expect(() => migrateSave(future)).toThrow(/newer version of the game/);
  });

  it("refuses rather than guesses when a step is missing", () => {
    const empty = new ContentRegistry<MigrationStep>();
    expect(() => migrateSave(bareSnapshot, empty)).toThrow(/No migration registered from save version 0/);
  });

  it("needsMigration reports true for the old fixture", () => {
    expect(needsMigration(bareSnapshot)).toBe(true);
  });
});

describe("migration registry validation", () => {
  it("rejects a step whose id does not match its fromVersion", () => {
    const registry = createMigrationRegistry();
    expect(() =>
      registry.register({
        id: "wrong",
        fromVersion: 1,
        toVersion: 2,
        description: "bad id",
        apply: (doc) => doc,
      }),
    ).toThrow(/migration id must be its fromVersion/);
  });

  it("rejects a step that skips a version", () => {
    const registry = createMigrationRegistry();
    expect(() =>
      registry.register({
        id: "1",
        fromVersion: 1,
        toVersion: 3,
        description: "skips version 2",
        apply: (doc) => doc,
      }),
    ).toThrow(/exactly fromVersion \+ 1/);
  });
});
