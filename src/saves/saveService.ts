import type { ContentRegistry } from "../data/registry";
import type { SimulationKernel } from "../simulation/kernel";
import { sectorIdAt } from "../world/cubeSphere";
import { DEFAULT_START_POSITION, DEFAULT_START_REGION_ID } from "../world/start";
import { WORLD_SCHEMA_VERSION, type WorldSnapshot } from "../world/worldState";
import { createMigrationRegistry, migrateSave, type MigrationStep } from "./migrations";
import { SaveError, type SaveRepository } from "./repository";
import {
  ROOT_SAVE_VERSION,
  autosaveSlotId,
  backupSlotId,
  checksumOf,
  isBackupSlot,
  slotIdFromBackup,
  summaryOf,
  validateRootSave,
  type RootSave,
  type SaveMetadata,
  type SaveSlotSummary,
  type StoredSave,
} from "./schema";

export const APP_VERSION = "0.3.0";
const DEFAULT_AUTOSAVE_SLOTS = 3;
const DEFAULT_BACKUPS_PER_SLOT = 2;

export interface SaveServiceOptions {
  readonly repository: SaveRepository;
  /** Injected so tests control time and play-time accounting stays testable. */
  readonly now?: () => number;
  readonly migrations?: ContentRegistry<MigrationStep>;
  readonly autosaveSlots?: number;
  readonly backupsPerSlot?: number;
  readonly appVersion?: string;
}

export interface SaveRequest {
  readonly name?: string;
  readonly playTimeMs?: number;
  readonly thumbnail?: string | null;
  /** Authoritative world state. Omitted only by callers that have no world yet. */
  readonly world?: WorldSnapshot;
}

/**
 * A world section for a save written before a world exists. It records the
 * documented start rather than a fabricated position, and carries no region
 * records, so `WorldState.restore` seeds fresh ones for whatever regions the
 * build knows about.
 */
function emptyWorldSnapshot(): WorldSnapshot {
  return {
    schemaVersion: WORLD_SCHEMA_VERSION,
    playerPosition: DEFAULT_START_POSITION,
    activeRegionId: DEFAULT_START_REGION_ID,
    activeSectorId: sectorIdAt(DEFAULT_START_POSITION),
    regions: [],
  };
}

export interface LoadResult {
  readonly document: RootSave;
  /** Slot the data actually came from; differs from the request when a backup was used. */
  readonly recoveredFrom: string | null;
  readonly migratedFrom: number | null;
}

/**
 * Owns save policy: what a save contains, how autosaves rotate, when backups are
 * taken, and how a damaged slot is recovered. Knows nothing about IndexedDB or
 * the DOM.
 */
export class SaveService {
  private readonly repository: SaveRepository;
  private readonly now: () => number;
  private readonly migrations: ContentRegistry<MigrationStep>;
  private readonly autosaveSlots: number;
  private readonly backupsPerSlot: number;
  private readonly appVersion: string;
  private autosaveCursor = 0;

  constructor(options: SaveServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => Date.now());
    this.migrations = options.migrations ?? createMigrationRegistry();
    this.autosaveSlots = options.autosaveSlots ?? DEFAULT_AUTOSAVE_SLOTS;
    this.backupsPerSlot = options.backupsPerSlot ?? DEFAULT_BACKUPS_PER_SLOT;
    this.appVersion = options.appVersion ?? APP_VERSION;
  }

  /** Builds the save document from authoritative state only. */
  buildDocument(kernel: SimulationKernel, request: SaveRequest = {}): RootSave {
    const sim = kernel.serialize();
    const world = request.world ?? emptyWorldSnapshot();
    const metadata: SaveMetadata = {
      name: request.name?.trim() || "Unnamed save",
      worldSeed: kernel.seed,
      playTimeMs: Math.max(0, Math.round(request.playTimeMs ?? 0)),
      lastPlayedAt: this.now(),
      simTick: kernel.tick,
      appVersion: this.appVersion,
      thumbnail: request.thumbnail ?? null,
    };
    return { schemaVersion: ROOT_SAVE_VERSION, savedAt: this.now(), metadata, sim, world };
  }

  async save(slotId: string, kernel: SimulationKernel, request: SaveRequest = {}): Promise<RootSave> {
    const document = this.buildDocument(kernel, request);
    const errors = validateRootSave(document);
    if (errors.length > 0) {
      throw new SaveError("corrupt", `Refusing to write an invalid save: ${errors.join("; ")}`);
    }

    // Roll the existing slot into a backup first, so a write that fails midway
    // still leaves a loadable copy behind.
    await this.rotateBackups(slotId);
    await this.repository.write({ slotId, document, checksum: checksumOf(document) });
    return document;
  }

  /** Writes to the next autosave slot in the ring, so an older autosave always survives. */
  async autosave(kernel: SimulationKernel, request: SaveRequest = {}): Promise<string> {
    const slotId = autosaveSlotId(this.autosaveCursor);
    this.autosaveCursor = (this.autosaveCursor + 1) % this.autosaveSlots;
    await this.save(slotId, kernel, { ...request, name: request.name ?? "Autosave" });
    return slotId;
  }

  /**
   * Loads a slot, migrating and validating on the way. If the slot is damaged,
   * falls back to the newest valid backup rather than failing outright.
   */
  async load(slotId: string): Promise<LoadResult> {
    const primary = await this.tryLoad(slotId);
    if (primary) return { ...primary, recoveredFrom: null };

    for (const backupId of await this.backupIdsNewestFirst(slotId)) {
      const recovered = await this.tryLoad(backupId);
      if (recovered) return { ...recovered, recoveredFrom: backupId };
    }

    throw new SaveError(
      "corrupt",
      `Slot "${slotId}" could not be read and no valid backup was found for it.`,
    );
  }

  private async tryLoad(slotId: string): Promise<{ document: RootSave; migratedFrom: number | null } | null> {
    let stored: StoredSave | undefined;
    try {
      stored = await this.repository.read(slotId);
    } catch {
      // An unreadable record is treated as absent so recovery can continue.
      return null;
    }
    if (!stored?.document) return null;

    let document: RootSave;
    let migratedFrom: number | null;
    try {
      const migration = migrateSave(stored.document, this.migrations);
      document = migration.document;
      migratedFrom = migration.applied.length > 0 ? migration.fromVersion : null;
    } catch {
      return null;
    }

    if (validateRootSave(document).length > 0) return null;

    // Checksum only applies to a save still in the version it was written in;
    // a migrated document legitimately no longer matches its stored digest.
    if (migratedFrom === null && stored.checksum && checksumOf(document) !== stored.checksum) {
      return null;
    }

    return { document, migratedFrom };
  }

  /** Restores a loaded document into a kernel built for its seed. */
  applyToKernel(document: RootSave, kernel: SimulationKernel): void {
    if (document.sim.seed !== kernel.seed) {
      throw new SaveError(
        "corrupt",
        `Save was recorded with world seed ${document.sim.seed} but the kernel uses ${kernel.seed}. ` +
          "Construct the kernel with the save's seed before restoring.",
      );
    }
    kernel.restore(document.sim);
  }

  /**
   * Lists every slot the player can act on. A slot whose live record is damaged
   * is still listed, described from its newest valid backup and flagged, because
   * a slot hidden from the list can never be recovered from the UI.
   */
  async listSlots(): Promise<readonly SaveSlotSummary[]> {
    const ids = await this.repository.listSlotIds();

    // A slot whose primary record was lost entirely still has backups to offer.
    const candidates = new Set<string>();
    for (const id of ids) {
      const owner = slotIdFromBackup(id);
      candidates.add(owner ?? id);
    }

    const summaries: SaveSlotSummary[] = [];
    for (const slotId of candidates) {
      const primary = await this.readValid(slotId);
      if (primary) {
        summaries.push(summaryOf({ ...primary, slotId }));
        continue;
      }
      for (const backupId of await this.backupIdsNewestFirst(slotId)) {
        const backup = await this.readValid(backupId);
        if (backup) {
          summaries.push(summaryOf({ ...backup, slotId }, true));
          break;
        }
      }
    }
    return summaries.sort((a, b) => b.savedAt - a.savedAt);
  }

  /** Reads a record only if it parses, migrates and validates. */
  private async readValid(slotId: string): Promise<StoredSave | undefined> {
    const stored = await this.safeRead(slotId);
    if (!stored?.document) return undefined;
    try {
      const document = migrateSave(stored.document, this.migrations).document;
      if (validateRootSave(document).length > 0) return undefined;
      return { ...stored, document };
    } catch {
      return undefined;
    }
  }

  async rename(slotId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new SaveError("invalid-import", "A save name cannot be empty.");

    const stored = await this.repository.read(slotId);
    if (!stored) throw new SaveError("not-found", `Slot "${slotId}" does not exist.`);

    const document: RootSave = {
      ...stored.document,
      metadata: { ...stored.document.metadata, name: trimmed },
    };
    await this.repository.write({ slotId, document, checksum: checksumOf(document) });
  }

  async delete(slotId: string): Promise<void> {
    await this.repository.delete(slotId);
    for (let index = 0; index < this.backupsPerSlot; index += 1) {
      await this.repository.delete(backupSlotId(slotId, index));
    }
  }

  /** Serializes a slot to text for download. */
  async exportSlot(slotId: string): Promise<string> {
    const result = await this.load(slotId);
    return JSON.stringify(result.document, null, 2);
  }

  /**
   * Parses, migrates and validates external text before it is allowed near a
   * slot, so a bad file can never overwrite good data.
   */
  async importInto(slotId: string, text: string): Promise<LoadResult> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new SaveError("invalid-import", "That file is not valid JSON, so it cannot be a save.", error);
    }

    let document: RootSave;
    let migratedFrom: number | null;
    try {
      const migration = migrateSave(parsed, this.migrations);
      document = migration.document;
      migratedFrom = migration.applied.length > 0 ? migration.fromVersion : null;
    } catch (error) {
      throw new SaveError("migration-failed", (error as Error).message, error);
    }

    const errors = validateRootSave(document);
    if (errors.length > 0) {
      throw new SaveError("invalid-import", `That file is not a usable save: ${errors.join("; ")}`);
    }

    await this.rotateBackups(slotId);
    await this.repository.write({ slotId, document, checksum: checksumOf(document) });
    return { document, recoveredFrom: null, migratedFrom };
  }

  /**
   * Copies the current contents of a slot into the backup ring. Also the
   * pre-migration backup: an old-version save is preserved untouched before
   * anything upgrades it.
   */
  async rotateBackups(slotId: string): Promise<void> {
    if (this.backupsPerSlot <= 0 || isBackupSlot(slotId)) return;

    let existing: StoredSave | undefined;
    try {
      existing = await this.repository.read(slotId);
    } catch {
      return;
    }
    if (!existing) return;

    for (let index = this.backupsPerSlot - 1; index > 0; index -= 1) {
      const older = await this.safeRead(backupSlotId(slotId, index - 1));
      if (older) await this.repository.write({ ...older, slotId: backupSlotId(slotId, index) });
    }
    await this.repository.write({ ...existing, slotId: backupSlotId(slotId, 0) });
  }

  private async safeRead(slotId: string): Promise<StoredSave | undefined> {
    try {
      return await this.repository.read(slotId);
    } catch {
      return undefined;
    }
  }

  private async backupIdsNewestFirst(slotId: string): Promise<readonly string[]> {
    return Array.from({ length: this.backupsPerSlot }, (_, index) => backupSlotId(slotId, index));
  }
}
