import { ContentRegistry, type RegistryEntry } from "../data/registry";
import { PACK_CACHE_NAME } from "./swPolicy";

/**
 * Optional downloadable packs.
 *
 * The core game caches itself as it loads and needs none of this. A pack is
 * the other kind of asset: optional, potentially large, and only worth the
 * bytes if the player asks. Each pack is a named list of files with known
 * sizes, downloaded one file at a time into the pack cache, which is a
 * different cache from the shell on purpose: a shell update deletes old shell
 * caches and never touches this one, so a downloaded pack survives every
 * deploy.
 *
 * Resume is not a feature bolted on, it is the shape of the loop: a download
 * fetches only the files not already cached, so a pack stopped halfway picks
 * up where it stopped, and restarting cleanly is deleting the pack's files
 * and downloading again.
 *
 * Nothing here touches IndexedDB. Saves are not assets.
 */

export interface PackFile {
  /** Absolute path under the site root. */
  readonly path: string;
  /** Expected bytes, so progress is honest before the first byte arrives. */
  readonly bytes: number;
}

export interface PackDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  /** What the pack is for, so nobody downloads a mystery. */
  readonly purpose: string;
  readonly files: readonly PackFile[];
}

const PACKS: readonly PackDefinition[] = [
  {
    id: "pack.placeholder-textures",
    displayName: "Placeholder texture pack",
    purpose:
      "Original procedural detail textures for machines and creatures. " +
      "Used by drop-in models until real art replaces them.",
    files: [
      { path: "/packs/placeholder-textures/plate-detail.png", bytes: 8_175 },
      { path: "/packs/placeholder-textures/plate-weathered.png", bytes: 11_910 },
      { path: "/packs/placeholder-textures/creature-hide.png", bytes: 5_852 },
      { path: "/packs/placeholder-textures/emissive-strips.png", bytes: 713 },
    ],
  },
];

export function validatePack(entry: PackDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("pack.")) errors.push('pack ids start with "pack."');
  if (entry.displayName.trim().length === 0) errors.push("displayName is required");
  if (entry.purpose.trim().length < 12) errors.push("a pack must say what it is for");
  if (entry.files.length === 0) errors.push("a pack with no files is not a pack");
  const seen = new Set<string>();
  for (const file of entry.files) {
    if (!file.path.startsWith("/packs/")) {
      errors.push(`${file.path}: pack files live under /packs/, nowhere else`);
    }
    if (file.bytes <= 0) errors.push(`${file.path}: a file must have a size`);
    if (seen.has(file.path)) errors.push(`${file.path}: listed twice`);
    seen.add(file.path);
  }
  return errors;
}

export function createPackRegistry(): ContentRegistry<PackDefinition> {
  const registry = new ContentRegistry<PackDefinition>(validatePack);
  for (const pack of PACKS) registry.register(pack);
  return registry;
}

export const PACK_DEFINITIONS = PACKS;

export type PackPhase = "not-downloaded" | "partial" | "downloading" | "complete" | "failed";

export interface PackStatus {
  readonly id: string;
  readonly displayName: string;
  readonly purpose: string;
  readonly phase: PackPhase;
  readonly filesCached: number;
  readonly filesTotal: number;
  readonly bytesCached: number;
  readonly bytesTotal: number;
  /** What went wrong, in a sentence. Empty while nothing has. */
  readonly detail: string;
}

/** Pure status arithmetic, shared by the store and the tests. */
export function statusFrom(
  pack: PackDefinition,
  cachedPaths: ReadonlySet<string>,
  downloading: boolean,
  failure: string,
): PackStatus {
  const cachedFiles = pack.files.filter((file) => cachedPaths.has(file.path));
  const bytesCached = cachedFiles.reduce((sum, file) => sum + file.bytes, 0);
  const bytesTotal = pack.files.reduce((sum, file) => sum + file.bytes, 0);
  const phase: PackPhase = downloading
    ? "downloading"
    : failure
      ? "failed"
      : cachedFiles.length === 0
        ? "not-downloaded"
        : cachedFiles.length === pack.files.length
          ? "complete"
          : "partial";
  return {
    id: pack.id,
    displayName: pack.displayName,
    purpose: pack.purpose,
    phase,
    filesCached: cachedFiles.length,
    filesTotal: pack.files.length,
    bytesCached,
    bytesTotal,
    detail: failure,
  };
}

/** The slice of the Cache API the store needs, so a test can fake it. */
export interface PackCache {
  has(path: string): Promise<boolean>;
  put(path: string, response: Response): Promise<void>;
  delete(path: string): Promise<void>;
}

/** The real pack cache, or null where the browser has no Cache API. */
export async function browserPackCache(): Promise<PackCache | null> {
  if (!("caches" in globalThis)) return null;
  try {
    const cache = await caches.open(PACK_CACHE_NAME);
    return {
      has: async (path) => (await cache.match(path)) !== undefined,
      put: (path, response) => cache.put(path, response),
      delete: async (path) => {
        await cache.delete(path);
      },
    };
  } catch {
    return null;
  }
}

export interface PackStoreOptions {
  readonly cache: PackCache | null;
  readonly registry?: ContentRegistry<PackDefinition>;
  /** Injected so a test can refuse a specific file. Defaults to fetch. */
  readonly fetchFile?: (path: string) => Promise<Response>;
}

/**
 * Downloads, resumes, restarts and reports.
 *
 * One file at a time, deliberately: progress is a count of real files rather
 * than a guess, a failure names the file that failed, and stopping between
 * files loses nothing.
 */
export class PackStore {
  private readonly cache: PackCache | null;
  private readonly registry: ContentRegistry<PackDefinition>;
  private readonly fetchFile: (path: string) => Promise<Response>;
  private readonly downloading = new Set<string>();
  private readonly failures = new Map<string, string>();

  constructor(options: PackStoreOptions) {
    this.cache = options.cache;
    this.registry = options.registry ?? createPackRegistry();
    // Pack paths are written against the app ("/packs/..."); the request
    // goes to wherever the build is served from.
    this.fetchFile = options.fetchFile ?? ((path) => fetch(`${import.meta.env.BASE_URL}${path.slice(1)}`));
  }

  get available(): boolean {
    return this.cache !== null;
  }

  async statuses(): Promise<readonly PackStatus[]> {
    const results: PackStatus[] = [];
    for (const pack of this.registry.all()) {
      const cached = new Set<string>();
      if (this.cache) {
        for (const file of pack.files) {
          if (await this.cache.has(file.path)) cached.add(file.path);
        }
      }
      results.push(statusFrom(pack, cached, this.downloading.has(pack.id), this.failures.get(pack.id) ?? ""));
    }
    return results;
  }

  /**
   * Downloads a pack, skipping files already cached.
   *
   * That skip is the resume: a pack that stopped at file two of four fetches
   * files three and four and nothing else. A failure stops at the failing file
   * with its name in the status, and what was cached stays cached.
   */
  async download(packId: string): Promise<PackStatus> {
    const pack = this.registry.get(packId);
    if (!pack) throw new Error(`No pack called "${packId}".`);
    if (!this.cache) {
      this.failures.set(packId, "This browser is not storing site data, so packs cannot be kept.");
      return (await this.statuses()).find((status) => status.id === packId)!;
    }
    if (this.downloading.has(packId)) {
      return (await this.statuses()).find((status) => status.id === packId)!;
    }

    this.downloading.add(packId);
    this.failures.delete(packId);
    try {
      for (const file of pack.files) {
        if (await this.cache.has(file.path)) continue;
        let response: Response;
        try {
          response = await this.fetchFile(file.path);
        } catch {
          this.failures.set(packId, `Could not reach ${file.path}. Check the connection and retry.`);
          break;
        }
        if (!response.ok) {
          this.failures.set(
            packId,
            `${file.path} came back ${response.status}. The server does not have it.`,
          );
          break;
        }
        await this.cache.put(file.path, response);
      }
    } finally {
      this.downloading.delete(packId);
    }
    return (await this.statuses()).find((status) => status.id === packId)!;
  }

  /** Removes every file of one pack. The clean restart. */
  async remove(packId: string): Promise<void> {
    const pack = this.registry.get(packId);
    if (!pack || !this.cache) return;
    this.failures.delete(packId);
    for (const file of pack.files) await this.cache.delete(file.path);
  }
}
