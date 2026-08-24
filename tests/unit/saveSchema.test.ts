import { describe, expect, it } from "vitest";
import { emptyEnvironmentSnapshot } from "../../src/world/environment";
import { WORLD_SCHEMA_VERSION } from "../../src/world/worldState";
import { createFacilityRegistry } from "../../src/data/facilities";
import { emptyShatterdomeSnapshot } from "../../src/shatterdome/facilityState";
import { emptyRosterSnapshot } from "../../src/jaegers/roster";
import {
  ROOT_SAVE_VERSION,
  autosaveSlotId,
  backupSlotId,
  checksumOf,
  isAutosaveSlot,
  isBackupSlot,
  slotIdFromBackup,
  summaryOf,
  validateRootSave,
  type RootSave,
} from "../../src/saves/schema";

function goodSave(overrides: Partial<RootSave> = {}): RootSave {
  return {
    schemaVersion: ROOT_SAVE_VERSION,
    savedAt: 1_700_000_000_000,
    metadata: {
      name: "Hong Kong run",
      worldSeed: 20260819,
      playTimeMs: 125_000,
      lastPlayedAt: 1_700_000_000_000,
      simTick: 7500,
      appVersion: "0.3.0",
      thumbnail: null,
    },
    sim: {
      schemaVersion: 1,
      seed: 20260819,
      tick: 7500,
      entities: { schemaVersion: 1, nextId: 1, entities: [] },
    },
    shatterdome: emptyShatterdomeSnapshot(createFacilityRegistry()),
    roster: emptyRosterSnapshot(),
    world: {
      schemaVersion: WORLD_SCHEMA_VERSION,
      playerPosition: { latitudeDeg: 22.3193, longitudeDeg: 114.1694, altitudeMeters: 0 },
      activeRegionId: "hong-kong",
      activeSectorId: "+X/8/9",
      regions: [],
      environment: emptyEnvironmentSnapshot(),
    },
    ...overrides,
  };
}

describe("validateRootSave", () => {
  it("accepts a well formed save", () => {
    expect(validateRootSave(goodSave())).toEqual([]);
  });

  it("rejects a non-object", () => {
    expect(validateRootSave(null).join(" ")).toMatch(/must be an object/);
    expect(validateRootSave([]).join(" ")).toMatch(/must be an object/);
  });

  it("rejects the wrong envelope version and says to migrate", () => {
    const errors = validateRootSave(goodSave({ schemaVersion: 99 })).join(" ");
    expect(errors).toMatch(new RegExp(`schemaVersion must be ${ROOT_SAVE_VERSION}`));
    expect(errors).toMatch(/run migrations/);
  });

  it("rejects missing or malformed metadata", () => {
    const save = goodSave();
    expect(validateRootSave({ ...save, metadata: { ...save.metadata, name: "" } }).join(" ")).toMatch(
      /metadata.name must be a non-empty string/,
    );
    expect(validateRootSave({ ...save, metadata: { ...save.metadata, playTimeMs: -5 } }).join(" ")).toMatch(
      /playTimeMs must not be negative/,
    );
    expect(
      validateRootSave({ ...save, metadata: { ...save.metadata, worldSeed: Number.NaN } }).join(" "),
    ).toMatch(/worldSeed must be a finite number/);
  });

  it("rejects a simulation snapshot from an unsupported version", () => {
    const save = goodSave();
    expect(validateRootSave({ ...save, sim: { ...save.sim, schemaVersion: 7 } }).join(" ")).toMatch(
      /sim.schemaVersion must be 1/,
    );
  });

  it("rejects a malformed entity table", () => {
    const save = goodSave();
    expect(
      validateRootSave({ ...save, sim: { ...save.sim, entities: { schemaVersion: 1, nextId: 1 } } }).join(
        " ",
      ),
    ).toMatch(/sim.entities.entities must be an array/);
  });

  it("rejects a document carrying non-serializable data", () => {
    const save = goodSave() as RootSave & { rogue?: unknown };
    const withFunction = { ...save, rogue: () => "engine object stand-in" };
    expect(validateRootSave(withFunction).join(" ")).toMatch(/not plain serializable data/);
  });

  it("rejects a circular document by name rather than by stack overflow", () => {
    const save = goodSave() as unknown as Record<string, unknown>;
    save["self"] = save;
    expect(validateRootSave(save).join(" ")).toMatch(/must not contain cycles/);
  });
});

describe("checksumOf", () => {
  it("is stable for identical documents and differs when anything changes", () => {
    const save = goodSave();
    expect(checksumOf(save)).toBe(checksumOf(goodSave()));
    expect(checksumOf({ ...save, savedAt: save.savedAt + 1 })).not.toBe(checksumOf(save));
    expect(checksumOf({ ...save, sim: { ...save.sim, tick: 7501 } })).not.toBe(checksumOf(save));
  });
});

describe("slot naming", () => {
  it("distinguishes autosaves and backups from manual slots", () => {
    expect(isAutosaveSlot(autosaveSlotId(0))).toBe(true);
    expect(isBackupSlot(backupSlotId("slot.a", 0))).toBe(true);
    expect(isAutosaveSlot("slot.a")).toBe(false);
    expect(isBackupSlot("slot.a")).toBe(false);
  });

  it("keeps backup ids tied to the slot they protect", () => {
    expect(backupSlotId("slot.a", 1)).toBe("backup.slot.a.1");
  });
});

describe("summaryOf", () => {
  it("projects the fields a slot list needs", () => {
    const document = goodSave();
    const summary = summaryOf({ slotId: "slot.a", document, checksum: checksumOf(document) });

    expect(summary).toEqual({
      slotId: "slot.a",
      metadata: document.metadata,
      savedAt: document.savedAt,
      schemaVersion: ROOT_SAVE_VERSION,
      damaged: false,
    });
  });

  it("flags a summary built from a backup as damaged", () => {
    const document = goodSave();
    const summary = summaryOf({ slotId: "slot.a", document, checksum: checksumOf(document) }, true);
    expect(summary.damaged).toBe(true);
  });
});

describe("slotIdFromBackup", () => {
  it("recovers the owning slot id, including ids that contain dots", () => {
    expect(slotIdFromBackup(backupSlotId("slot.a", 0))).toBe("slot.a");
    expect(slotIdFromBackup(backupSlotId("autosave.2", 1))).toBe("autosave.2");
  });

  it("returns null for anything that is not a backup id", () => {
    expect(slotIdFromBackup("slot.a")).toBeNull();
    expect(slotIdFromBackup("autosave.0")).toBeNull();
  });
});
