import { SaveError, type SaveRepository } from "./repository";
import type { StoredSave } from "./schema";

export const SAVE_DB_NAME = "shatterdome-earth-saves";
export const SAVE_STORE_NAME = "slots";
const SAVE_DB_VERSION = 1;

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "QuotaExceededError" || error.code === 22);
}

/**
 * IndexedDB-backed store. localStorage is deliberately not used: it is
 * synchronous, capped at a few megabytes, and string-only, none of which suits a
 * full world snapshot.
 */
export class IndexedDbSaveRepository implements SaveRepository {
  readonly kind = "indexeddb";
  private database: IDBDatabase | undefined;
  private closed = false;

  private constructor(database: IDBDatabase) {
    this.database = database;
  }

  static isSupported(): boolean {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  }

  /**
   * Opens the database. Private browsing modes expose `indexedDB` and then fail
   * to open it, so the failure is reported as "unavailable" for the caller to
   * fall back on rather than crashing the app.
   */
  static async open(): Promise<IndexedDbSaveRepository> {
    if (!IndexedDbSaveRepository.isSupported()) {
      throw new SaveError("unavailable", "This browser does not expose IndexedDB, so saves cannot persist.");
    }

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(SAVE_DB_NAME, SAVE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SAVE_STORE_NAME)) {
          db.createObjectStore(SAVE_STORE_NAME, { keyPath: "slotId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new SaveError("unavailable", "Another tab is holding the save database open."));
    }).catch((error) => {
      throw new SaveError(
        "unavailable",
        "Could not open the save database. Private browsing windows often block storage; " +
          "saves will stay in memory for this session only.",
        error,
      );
    });

    return new IndexedDbSaveRepository(database);
  }

  private store(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.database || this.closed) {
      throw new SaveError("unavailable", "The save database has been closed.");
    }
    return this.database.transaction(SAVE_STORE_NAME, mode).objectStore(SAVE_STORE_NAME);
  }

  async listSlotIds(): Promise<readonly string[]> {
    const keys = await requestAsPromise(this.store("readonly").getAllKeys());
    return keys.map(String).sort();
  }

  async read(slotId: string): Promise<StoredSave | undefined> {
    const record = await requestAsPromise(this.store("readonly").get(slotId));
    return (record as StoredSave | undefined) ?? undefined;
  }

  async write(record: StoredSave): Promise<void> {
    try {
      // Structured clone rejects functions, DOM nodes and engine objects outright,
      // so anything non-serializable fails here rather than corrupting a slot.
      await requestAsPromise(this.store("readwrite").put(record));
    } catch (error) {
      if (isQuotaError(error)) {
        throw new SaveError(
          "quota-exceeded",
          "Storage is full, so this save was not written. Delete an old slot or free browser storage and try again.",
          error,
        );
      }
      throw new SaveError("unknown", `Could not write slot "${record.slotId}".`, error);
    }
  }

  async delete(slotId: string): Promise<void> {
    await requestAsPromise(this.store("readwrite").delete(slotId));
  }

  async estimateBytes(): Promise<number | null> {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    return estimate.usage ?? null;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database?.close();
    this.database = undefined;
  }
}
