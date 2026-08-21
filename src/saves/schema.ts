import { SIM_SCHEMA_VERSION, type SimSnapshot } from "../simulation/kernel";
import { hashState } from "../simulation/hash";
import { WORLD_SCHEMA_VERSION, type WorldSnapshot } from "../world/worldState";

/**
 * Version of the save envelope, versioned separately from SIM_SCHEMA_VERSION so
 * the wrapper and the simulation snapshot can evolve independently.
 */
export const ROOT_SAVE_VERSION = 2;

/** Version reported for a bare kernel snapshot with no envelope around it. */
export const LEGACY_UNWRAPPED_VERSION = 0;

export const AUTOSAVE_SLOT_PREFIX = "autosave";
export const BACKUP_SLOT_PREFIX = "backup";

export interface SaveMetadata {
  readonly name: string;
  readonly worldSeed: number;
  readonly playTimeMs: number;
  /** Epoch milliseconds; 0 when unknown, such as after migrating a file that never recorded it. */
  readonly lastPlayedAt: number;
  readonly simTick: number;
  readonly appVersion: string;
  /** Small data URL, or null when the save was written without a rendered frame. */
  readonly thumbnail: string | null;
}

export interface RootSave {
  readonly schemaVersion: number;
  readonly savedAt: number;
  readonly metadata: SaveMetadata;
  /** Authoritative simulation state only. Meshes, materials, physics and UI are rebuilt on load. */
  readonly sim: SimSnapshot;
  /** Where the player is on the globe and the strategic record for every region. */
  readonly world: WorldSnapshot;
}

/** What the repository persists: the document plus an integrity digest of it. */
export interface StoredSave {
  readonly slotId: string;
  readonly document: RootSave;
  readonly checksum: string;
}

export interface SaveSlotSummary {
  readonly slotId: string;
  readonly metadata: SaveMetadata;
  readonly savedAt: number;
  readonly schemaVersion: number;
  /**
   * True when the live record could not be read and these details came from a
   * backup. The slot stays listed so the player can still load it: hiding it
   * would make recovery unreachable in exactly the case it exists for.
   */
  readonly damaged: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Identifies what shape a loaded document is. A bare kernel snapshot carries
 * `seed`/`entities` with no `sim`, which is exactly what `kernel.serialize()`
 * produced before this milestone added an envelope.
 */
export function detectSaveVersion(document: unknown): number {
  if (!isRecord(document)) {
    throw new Error("Save document is not an object");
  }
  if (!("sim" in document) && "entities" in document && "seed" in document) {
    return LEGACY_UNWRAPPED_VERSION;
  }
  const version = document["schemaVersion"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    throw new Error("Save document has no usable schemaVersion");
  }
  return version;
}

function validateMetadata(metadata: unknown): string[] {
  if (!isRecord(metadata)) return ["metadata must be an object"];
  const errors: string[] = [];
  if (typeof metadata["name"] !== "string" || metadata["name"].length === 0) {
    errors.push("metadata.name must be a non-empty string");
  }
  for (const key of ["worldSeed", "playTimeMs", "lastPlayedAt", "simTick"]) {
    const value = metadata[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`metadata.${key} must be a finite number`);
    }
  }
  if ((metadata["playTimeMs"] as number) < 0) errors.push("metadata.playTimeMs must not be negative");
  if (typeof metadata["appVersion"] !== "string") errors.push("metadata.appVersion must be a string");
  const thumbnail = metadata["thumbnail"];
  if (thumbnail !== null && typeof thumbnail !== "string") {
    errors.push("metadata.thumbnail must be a data URL string or null");
  }
  return errors;
}

function validateSim(sim: unknown): string[] {
  if (!isRecord(sim)) return ["sim must be an object"];
  const errors: string[] = [];
  if (sim["schemaVersion"] !== SIM_SCHEMA_VERSION) {
    errors.push(`sim.schemaVersion must be ${SIM_SCHEMA_VERSION}, got ${String(sim["schemaVersion"])}`);
  }
  if (typeof sim["seed"] !== "number" || !Number.isFinite(sim["seed"])) {
    errors.push("sim.seed must be a finite number");
  }
  if (typeof sim["tick"] !== "number" || !Number.isInteger(sim["tick"]) || (sim["tick"] as number) < 0) {
    errors.push("sim.tick must be a non-negative integer");
  }
  const entities = sim["entities"];
  if (!isRecord(entities)) {
    errors.push("sim.entities must be an object");
  } else if (!Array.isArray(entities["entities"])) {
    errors.push("sim.entities.entities must be an array");
  }
  return errors;
}

function validateWorldSection(world: unknown): string[] {
  if (!isRecord(world)) return ["world must be an object"];
  const errors: string[] = [];
  if (world["schemaVersion"] !== WORLD_SCHEMA_VERSION) {
    errors.push(`world.schemaVersion must be ${WORLD_SCHEMA_VERSION}, got ${String(world["schemaVersion"])}`);
  }
  if (!isRecord(world["playerPosition"])) errors.push("world.playerPosition must be an object");
  if (typeof world["activeSectorId"] !== "string" || world["activeSectorId"].length === 0) {
    errors.push("world.activeSectorId must be a non-empty string");
  }
  const activeRegionId = world["activeRegionId"];
  if (activeRegionId !== null && typeof activeRegionId !== "string") {
    errors.push("world.activeRegionId must be a string or null");
  }
  if (!Array.isArray(world["regions"])) errors.push("world.regions must be an array");
  return errors;
}

/** Full structural validation of a current-version save. */
export function validateRootSave(document: unknown): string[] {
  if (!isRecord(document)) return ["save document must be an object"];
  const errors: string[] = [];

  if (document["schemaVersion"] !== ROOT_SAVE_VERSION) {
    errors.push(
      `schemaVersion must be ${ROOT_SAVE_VERSION}, got ${String(document["schemaVersion"])}; ` +
        "run migrations before validating",
    );
  }
  if (typeof document["savedAt"] !== "number" || !Number.isFinite(document["savedAt"])) {
    errors.push("savedAt must be a finite number");
  }
  errors.push(...validateMetadata(document["metadata"]));
  errors.push(...validateSim(document["sim"]));
  errors.push(...validateWorldSection(document["world"]));

  if (errors.length === 0) {
    // Engine objects, functions and undefined all throw here, which is the guard
    // that keeps non-authoritative junk out of a save file.
    try {
      hashState(document);
    } catch (error) {
      errors.push(`save document is not plain serializable data: ${(error as Error).message}`);
    }
  }

  return errors;
}

export function checksumOf(document: RootSave): string {
  return hashState(document);
}

export function isAutosaveSlot(slotId: string): boolean {
  return slotId.startsWith(`${AUTOSAVE_SLOT_PREFIX}.`);
}

export function isBackupSlot(slotId: string): boolean {
  return slotId.startsWith(`${BACKUP_SLOT_PREFIX}.`);
}

/** Backups are named so the newest for a given slot can be found by sorting. */
export function backupSlotId(slotId: string, index: number): string {
  return `${BACKUP_SLOT_PREFIX}.${slotId}.${index}`;
}

export function autosaveSlotId(index: number): string {
  return `${AUTOSAVE_SLOT_PREFIX}.${index}`;
}

export function summaryOf(stored: StoredSave, damaged = false): SaveSlotSummary {
  return {
    slotId: stored.slotId,
    metadata: stored.document.metadata,
    savedAt: stored.document.savedAt,
    schemaVersion: stored.document.schemaVersion,
    damaged,
  };
}

/** Recovers the owning slot id from a backup slot id, or null if it is not one. */
export function slotIdFromBackup(backupId: string): string | null {
  if (!isBackupSlot(backupId)) return null;
  const withoutPrefix = backupId.slice(BACKUP_SLOT_PREFIX.length + 1);
  const lastDot = withoutPrefix.lastIndexOf(".");
  return lastDot <= 0 ? null : withoutPrefix.slice(0, lastDot);
}
