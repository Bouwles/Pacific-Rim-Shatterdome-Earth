import type { StoredSave } from "./schema";

export type SaveErrorKind =
  | "unavailable"
  | "quota-exceeded"
  | "not-found"
  | "corrupt"
  | "invalid-import"
  | "migration-failed"
  | "unknown";

/** Carries a machine-readable kind so the UI can explain the failure rather than print a stack. */
export class SaveError extends Error {
  constructor(
    readonly kind: SaveErrorKind,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SaveError";
  }
}

/**
 * Storage boundary. The service layer only ever sees this, so IndexedDB can be
 * swapped for memory in tests, or for a cloud adapter later, without touching
 * save logic.
 */
export interface SaveRepository {
  readonly kind: string;
  listSlotIds(): Promise<readonly string[]>;
  /** Returns the raw record. Validation and migration belong to the service, not the store. */
  read(slotId: string): Promise<StoredSave | undefined>;
  write(record: StoredSave): Promise<void>;
  delete(slotId: string): Promise<void>;
  /** Approximate bytes used, or null when the environment will not say. */
  estimateBytes(): Promise<number | null>;
  close(): void;
}

/**
 * In-memory store. Used by tests, and as the honest fallback when IndexedDB is
 * unavailable: the game still runs, saves just do not survive a reload, and the
 * storage panel says so.
 */
export class MemorySaveRepository implements SaveRepository {
  readonly kind = "memory";
  private readonly records = new Map<string, string>();

  async listSlotIds(): Promise<readonly string[]> {
    return Array.from(this.records.keys()).sort();
  }

  async read(slotId: string): Promise<StoredSave | undefined> {
    const raw = this.records.get(slotId);
    if (raw === undefined) return undefined;
    // Stored as text so a caller cannot mutate a live object and silently change
    // what "already saved" means, exactly as a real store behaves.
    try {
      return JSON.parse(raw) as StoredSave;
    } catch (error) {
      throw new SaveError("corrupt", `Slot "${slotId}" contains unreadable data.`, error);
    }
  }

  async write(record: StoredSave): Promise<void> {
    this.records.set(record.slotId, JSON.stringify(record));
  }

  async delete(slotId: string): Promise<void> {
    this.records.delete(slotId);
  }

  async estimateBytes(): Promise<number | null> {
    let total = 0;
    for (const raw of this.records.values()) total += raw.length;
    return total;
  }

  close(): void {
    this.records.clear();
  }

  /** Test hook: replace a record's bytes with something invalid. */
  corrupt(slotId: string, replacement: string): void {
    this.records.set(slotId, replacement);
  }
}
