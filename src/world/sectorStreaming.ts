import { geoToLocal, type GeoPosition, type LocalPosition } from "./coordinates";
import {
  parseSectorId,
  sectorCentre,
  sectorIdAt,
  sectorGridCoordinates,
  sectorId,
  sectorsWithinDepth,
  type SectorId,
} from "./cubeSphere";
import {
  LOD_GRID_RESOLUTION,
  sampleCollisionHeight,
  terrainCacheKey,
  type TerrainAnchor,
  type LodLevel,
  type SectorTerrain,
} from "./terrain";
import { isCancellation, type SectorGenerationService } from "./terrainService";

/**
 * Sector streaming.
 *
 * Owns which sectors exist right now and what state each one is in. Knows
 * nothing about Babylon: it hands finished terrain to a `SectorSink` and trusts
 * that to build and free GPU resources. That split is what lets the whole
 * lifecycle, including eviction and memory pressure, be tested without a canvas.
 *
 * Two rules shape the design:
 *
 * 1. Terrain data and GPU meshes have separate lifetimes. Dropping a mesh does
 *    not drop the data, and holding the data does not hold the mesh. Keeping a
 *    mesh alive because its data happens to be cached is exactly the leak this
 *    system exists to avoid.
 * 2. Nothing here blocks. Generation is a promise, upload is a promise, and both
 *    are rate limited per update so a burst of twenty five sectors cannot land
 *    in a single frame.
 */

export const SECTOR_STATES = [
  "absent",
  "queued",
  "generating",
  "cpu-ready",
  "gpu-uploading",
  "active",
  "sleeping",
  "evicting",
] as const;
export type SectorState = (typeof SECTOR_STATES)[number];

/**
 * Level of detail per ring, indexed by how many sector steps from the player.
 * The last entry is the preload ring: uploaded, but asleep until walked into.
 */
export const RING_LODS: readonly LodLevel[] = [0, 1, 2, 3];
/** Rings at or past this depth are uploaded but disabled. */
export const SLEEP_DEPTH = RING_LODS.length - 1;
/** Everything past the last ring is released. */
export const EVICT_DEPTH = RING_LODS.length - 1;

const DEFAULT_MAX_CONCURRENT_GENERATIONS = 2;
const DEFAULT_MAX_UPLOADS_PER_UPDATE = 1;
const DEFAULT_MEMORY_BUDGET_BYTES = 96 * 1024 * 1024;
const DEFAULT_CACHE_BUDGET_BYTES = 48 * 1024 * 1024;
/** Speed at which the velocity bias reaches full strength, metres per second. */
const REFERENCE_SPEED_MPS = 200;
/**
 * Priority credit for a declared deployment target, in ring-score units where one
 * ring is 1000. Worth a ring and a half: enough to jump the queue ahead of the
 * ring next door, never enough to outrank the ground the player is standing on.
 */
const DEPLOYMENT_TARGET_BONUS = 1_500;
/** Full-strength velocity credit, deliberately under one ring so it biases within a ring. */
const VELOCITY_BONUS = 400;

/**
 * Presentation side of streaming. Every method may be called for a sector that
 * has already been released, so implementations must tolerate unknown ids rather
 * than throwing.
 */
export interface SectorSink {
  upload(terrain: SectorTerrain): void | Promise<void>;
  sleep(sectorId: SectorId): void;
  wake(sectorId: SectorId): void;
  release(sectorId: SectorId): void;
}

export interface StreamerInput {
  readonly position: GeoPosition;
  /** Metres per second in the local tangent frame. Drives load priority. */
  readonly velocity?: LocalPosition;
  /** A sector the player has committed to travelling to, prioritised over ring order. */
  readonly deploymentTargetSectorId?: SectorId | null;
}

export interface SectorStreamerOptions {
  readonly service: SectorGenerationService;
  readonly sink: SectorSink;
  readonly seed: number;
  readonly anchors: readonly TerrainAnchor[];
  readonly maxConcurrentGenerations?: number;
  readonly maxUploadsPerUpdate?: number;
  readonly memoryBudgetBytes?: number;
  readonly cacheBudgetBytes?: number;
  readonly now?: () => number;
}

export interface StreamingStats {
  readonly counts: Readonly<Record<SectorState, number>>;
  readonly resident: number;
  readonly peakResident: number;
  readonly generated: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cancelled: number;
  readonly evicted: number;
  readonly failed: number;
  readonly rescued: number;
  readonly lastGenerationMs: number;
  readonly averageGenerationMs: number;
  readonly lastUploadMs: number;
  readonly averageUploadMs: number;
  readonly residentBytes: number;
  readonly peakResidentBytes: number;
  readonly cachedBytes: number;
  readonly cachedEntries: number;
  readonly inFlight: number;
  readonly queueDepth: number;
  readonly serviceKind: string;
}

export interface SectorSlotView {
  readonly sectorId: SectorId;
  readonly state: SectorState;
  readonly lod: LodLevel;
  readonly depth: number;
  readonly bytes: number;
  /** Content digest of the terrain in hand, or null when nothing is loaded yet. */
  readonly digest: number | null;
}

interface SectorSlot {
  sectorId: SectorId;
  state: SectorState;
  lod: LodLevel;
  depth: number;
  requestId: number | null;
  terrain: SectorTerrain | null;
  bytes: number;
  lastNeededAt: number;
}

/**
 * Least-recently-used cache of generated terrain, bounded by bytes.
 *
 * Holds data only. A cache hit skips generation; it never resurrects a mesh,
 * because the mesh was disposed when its sector was evicted.
 */
export class SectorDataCache {
  private readonly entries = new Map<string, SectorTerrain>();
  private bytes = 0;

  constructor(private readonly budgetBytes: number) {
    if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) {
      throw new Error(`Sector cache budget must be a positive number of bytes, got ${budgetBytes}`);
    }
  }

  get(key: string): SectorTerrain | undefined {
    const found = this.entries.get(key);
    if (!found) return undefined;
    // Map preserves insertion order, so deleting and re-adding is the whole LRU.
    this.entries.delete(key);
    this.entries.set(key, found);
    return found;
  }

  set(key: string, terrain: SectorTerrain): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.bytes -= existing.estimatedBytes;
    }
    this.entries.set(key, terrain);
    this.bytes += terrain.estimatedBytes;

    while (this.bytes > this.budgetBytes && this.entries.size > 1) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      const evicted = this.entries.get(oldest.value);
      this.entries.delete(oldest.value);
      if (evicted) this.bytes -= evicted.estimatedBytes;
    }
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get sizeBytes(): number {
    return this.bytes;
  }

  get count(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}

const RESIDENT_STATES: ReadonlySet<SectorState> = new Set<SectorState>([
  "cpu-ready",
  "gpu-uploading",
  "active",
  "sleeping",
]);

export class SectorStreamer {
  private readonly slots = new Map<SectorId, SectorSlot>();
  private readonly cache: SectorDataCache;
  private readonly service: SectorGenerationService;
  private readonly sink: SectorSink;
  private readonly seed: number;
  private readonly anchors: readonly TerrainAnchor[];
  private readonly maxConcurrentGenerations: number;
  private readonly maxUploadsPerUpdate: number;
  private readonly memoryBudgetBytes: number;
  private readonly clock: () => number;
  private readonly pending = new Set<Promise<unknown>>();

  private nextRequestId = 1;
  private playerSector: SectorId | null = null;
  private disposed = false;

  private generated = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private cancelledCount = 0;
  private evictedCount = 0;
  private failedCount = 0;
  private rescuedCount = 0;
  private generationMsTotal = 0;
  private generationSamples = 0;
  private lastGenerationMs = 0;
  private uploadMsTotal = 0;
  private uploadSamples = 0;
  private lastUploadMs = 0;
  private peakResident = 0;
  private peakResidentBytes = 0;

  constructor(options: SectorStreamerOptions) {
    this.service = options.service;
    this.sink = options.sink;
    this.seed = options.seed;
    this.anchors = options.anchors;
    this.maxConcurrentGenerations = positive(
      options.maxConcurrentGenerations ?? DEFAULT_MAX_CONCURRENT_GENERATIONS,
      "maxConcurrentGenerations",
    );
    this.maxUploadsPerUpdate = positive(
      options.maxUploadsPerUpdate ?? DEFAULT_MAX_UPLOADS_PER_UPDATE,
      "maxUploadsPerUpdate",
    );
    this.memoryBudgetBytes = positive(
      options.memoryBudgetBytes ?? DEFAULT_MEMORY_BUDGET_BYTES,
      "memoryBudgetBytes",
    );
    this.cache = new SectorDataCache(options.cacheBudgetBytes ?? DEFAULT_CACHE_BUDGET_BYTES);
    this.clock = options.now ?? defaultNow;
  }

  get currentSectorId(): SectorId | null {
    return this.playerSector;
  }

  /**
   * Reconciles the resident set with where the player is. Cheap and synchronous:
   * it starts work and returns, never waits for it.
   */
  update(input: StreamerInput): void {
    if (this.disposed) return;

    const now = this.clock();
    const centre = sectorIdAt(input.position);
    this.playerSector = centre;
    const desired = sectorsWithinDepth(parseSectorId(centre), EVICT_DEPTH);

    this.reconcileDesired(desired, now);
    this.retireUndesired(desired, now);
    this.dispatchGenerations(input);
    this.dispatchUploads();
    this.enforceMemoryBudget();
    this.recordPeaks();
  }

  /** Marks wanted sectors, rescuing any that were about to be released. */
  private reconcileDesired(desired: Map<SectorId, number>, now: number): void {
    for (const [sectorId, depth] of desired) {
      const lod = RING_LODS[Math.min(depth, RING_LODS.length - 1)] ?? 3;
      const existing = this.slots.get(sectorId);

      if (!existing) {
        this.slots.set(sectorId, {
          sectorId,
          state: "queued",
          lod,
          depth,
          requestId: null,
          terrain: null,
          bytes: 0,
          lastNeededAt: now,
        });
        continue;
      }

      existing.depth = depth;
      existing.lastNeededAt = now;

      if (existing.state === "evicting") {
        // Rescued before release: a player wobbling across a sector boundary
        // should not pay for a rebuild every time they cross back.
        existing.state = existing.terrain ? "active" : "queued";
        this.rescuedCount += 1;
      }

      // A ring change means a different level of detail, which is a different
      // cache key, so the sector is rebuilt rather than stretched.
      if (existing.lod !== lod && (existing.state === "active" || existing.state === "sleeping")) {
        this.releaseSlot(existing, { keepData: true });
        existing.lod = lod;
        existing.state = "queued";
        existing.terrain = null;
        existing.bytes = 0;
        continue;
      }
      existing.lod = lod;

      if (existing.state === "active" && depth >= SLEEP_DEPTH) {
        this.sink.sleep(sectorId);
        existing.state = "sleeping";
      } else if (existing.state === "sleeping" && depth < SLEEP_DEPTH) {
        this.sink.wake(sectorId);
        existing.state = "active";
      }
    }
  }

  /** Sectors no longer in range: mark evicting now, release on the next update. */
  private retireUndesired(desired: Map<SectorId, number>, now: number): void {
    for (const slot of [...this.slots.values()]) {
      if (desired.has(slot.sectorId)) continue;

      if (slot.state === "evicting") {
        this.releaseSlot(slot, { keepData: true });
        this.slots.delete(slot.sectorId);
        this.evictedCount += 1;
        continue;
      }

      if (slot.state === "queued") {
        this.slots.delete(slot.sectorId);
        continue;
      }
      if (slot.state === "generating" && slot.requestId !== null) {
        this.service.cancel(slot.requestId);
        slot.requestId = null;
        this.slots.delete(slot.sectorId);
        this.cancelledCount += 1;
        continue;
      }
      slot.state = "evicting";
      slot.lastNeededAt = now;
    }
  }

  /**
   * Starts generation for the highest priority queued sectors, up to the
   * concurrency cap. A cache hit skips generation entirely.
   */
  private dispatchGenerations(input: StreamerInput): void {
    const queued = [...this.slots.values()].filter((slot) => slot.state === "queued");
    if (queued.length === 0) return;

    for (const slot of queued) {
      const key = terrainCacheKey({
        sectorId: slot.sectorId,
        lod: slot.lod,
        seed: this.seed,
        anchors: this.anchors,
      });
      const cached = this.cache.get(key);
      if (!cached) continue;
      this.cacheHits += 1;
      slot.terrain = cached;
      slot.bytes = cached.estimatedBytes;
      slot.state = "cpu-ready";
    }

    const stillQueued = queued.filter((slot) => slot.state === "queued");
    const scored = stillQueued
      .map((slot) => ({ slot, score: this.priorityScore(slot, input) }))
      .sort((a, b) => a.score - b.score);

    for (const { slot } of scored) {
      if (this.inFlightGenerations >= this.maxConcurrentGenerations) break;
      this.startGeneration(slot);
    }
  }

  /** Lower is sooner. Ring depth dominates; velocity and a deployment target bias within it. */
  private priorityScore(slot: SectorSlot, input: StreamerInput): number {
    let score = slot.depth * 1_000;

    if (input.deploymentTargetSectorId === slot.sectorId) score -= DEPLOYMENT_TARGET_BONUS;

    const velocity = input.velocity;
    if (!velocity) return score;
    const speed = Math.hypot(velocity.east, velocity.north);
    if (speed <= 1e-6) return score;

    const toSector = geoToLocal(input.position, sectorCentre(parseSectorId(slot.sectorId)));
    const distance = Math.hypot(toSector.east, toSector.north);
    if (distance <= 1e-6) return score;

    const alignment = (velocity.east * toSector.east + velocity.north * toSector.north) / (speed * distance);
    const strength = Math.min(1, speed / REFERENCE_SPEED_MPS);
    return score - Math.max(0, alignment) * strength * VELOCITY_BONUS;
  }

  private startGeneration(slot: SectorSlot): void {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    slot.requestId = requestId;
    slot.state = "generating";

    const promise = this.service
      .generate(requestId, {
        sectorId: slot.sectorId,
        lod: slot.lod,
        seed: this.seed,
        anchors: this.anchors,
      })
      .then((result) => {
        this.generated += 1;
        this.lastGenerationMs = result.generationMs;
        this.generationMsTotal += result.generationMs;
        this.generationSamples += 1;
        this.cacheMisses += 1;
        this.cache.set(result.terrain.cacheKey, result.terrain);

        const current = this.slots.get(slot.sectorId);
        // The slot may have been evicted, rebuilt at a different level of detail,
        // or cancelled while this was in flight. The data still goes in the cache
        // above; only the slot assignment is conditional.
        if (!current || current.requestId !== requestId || current.state !== "generating") return;
        current.requestId = null;
        current.terrain = result.terrain;
        current.bytes = result.terrain.estimatedBytes;
        current.state = "cpu-ready";
      })
      .catch((error: unknown) => {
        const current = this.slots.get(slot.sectorId);
        if (current?.requestId === requestId) {
          current.requestId = null;
          if (current.state === "generating") this.slots.delete(slot.sectorId);
        }
        if (isCancellation(error)) {
          this.cancelledCount += 1;
          return;
        }
        this.failedCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Sector ${slot.sectorId} failed to generate: ${message}`);
      })
      .finally(() => {
        this.pending.delete(promise);
      });

    this.pending.add(promise);
  }

  /** Uploads at most `maxUploadsPerUpdate` sectors, nearest ring first. */
  private dispatchUploads(): void {
    const ready = [...this.slots.values()]
      .filter((slot) => slot.state === "cpu-ready" && slot.terrain !== null)
      .sort((a, b) => a.depth - b.depth)
      .slice(0, this.maxUploadsPerUpdate);

    for (const slot of ready) {
      const terrain = slot.terrain;
      if (!terrain) continue;
      slot.state = "gpu-uploading";
      const startedAt = this.clock();

      const finish = (): void => {
        this.lastUploadMs = this.clock() - startedAt;
        this.uploadMsTotal += this.lastUploadMs;
        this.uploadSamples += 1;
        const current = this.slots.get(slot.sectorId);
        if (!current || current.state !== "gpu-uploading") return;
        if (current.depth >= SLEEP_DEPTH) {
          this.sink.sleep(current.sectorId);
          current.state = "sleeping";
        } else {
          current.state = "active";
        }
      };

      let result: void | Promise<void>;
      try {
        result = this.sink.upload(terrain);
      } catch (error) {
        this.onUploadFailure(slot, error);
        continue;
      }

      if (!result) {
        finish();
        continue;
      }
      const promise = result
        .then(finish)
        .catch((error: unknown) => this.onUploadFailure(slot, error))
        .finally(() => {
          this.pending.delete(promise);
        });
      this.pending.add(promise);
    }
  }

  private onUploadFailure(slot: SectorSlot, error: unknown): void {
    this.failedCount += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Sector ${slot.sectorId} failed to upload: ${message}`);
    const current = this.slots.get(slot.sectorId);
    if (current) {
      this.releaseSlot(current, { keepData: true });
      this.slots.delete(slot.sectorId);
    }
  }

  /**
   * Frees GPU resources until the resident set fits its budget.
   *
   * Furthest ring first, then least recently needed. The player's own sector is
   * never a candidate: dropping the ground under the player to save memory is
   * worse than exceeding the budget, and the budget is a target, not a hard cap.
   */
  private enforceMemoryBudget(): void {
    let residentBytes = this.residentBytes;
    if (residentBytes <= this.memoryBudgetBytes) return;

    const candidates = [...this.slots.values()]
      .filter(
        (slot) => RESIDENT_STATES.has(slot.state) && slot.sectorId !== this.playerSector && slot.depth > 0,
      )
      .sort((a, b) => b.depth - a.depth || a.lastNeededAt - b.lastNeededAt);

    for (const slot of candidates) {
      if (residentBytes <= this.memoryBudgetBytes) break;
      residentBytes -= slot.bytes;
      this.releaseSlot(slot, { keepData: true });
      this.slots.delete(slot.sectorId);
      this.evictedCount += 1;
    }
  }

  /**
   * Releases the sector's GPU resources. The terrain data stays in the cache when
   * `keepData` is set, which is what makes turning around cheap without keeping
   * a single mesh alive.
   */
  private releaseSlot(slot: SectorSlot, options: { keepData: boolean }): void {
    if (slot.requestId !== null) {
      this.service.cancel(slot.requestId);
      slot.requestId = null;
    }
    if (RESIDENT_STATES.has(slot.state) || slot.state === "evicting") {
      this.sink.release(slot.sectorId);
    }
    if (options.keepData && slot.terrain) this.cache.set(slot.terrain.cacheKey, slot.terrain);
    slot.terrain = null;
    slot.bytes = 0;
  }

  private recordPeaks(): void {
    const resident = this.residentCount;
    if (resident > this.peakResident) this.peakResident = resident;
    const bytes = this.residentBytes;
    if (bytes > this.peakResidentBytes) this.peakResidentBytes = bytes;
  }

  private get inFlightGenerations(): number {
    let count = 0;
    for (const slot of this.slots.values()) if (slot.state === "generating") count += 1;
    return count;
  }

  private get residentCount(): number {
    let count = 0;
    for (const slot of this.slots.values()) if (RESIDENT_STATES.has(slot.state)) count += 1;
    return count;
  }

  private get residentBytes(): number {
    let bytes = 0;
    for (const slot of this.slots.values()) if (RESIDENT_STATES.has(slot.state)) bytes += slot.bytes;
    return bytes;
  }

  stateOf(sectorId: SectorId): SectorState {
    return this.slots.get(sectorId)?.state ?? "absent";
  }

  slotViews(): readonly SectorSlotView[] {
    return [...this.slots.values()]
      .map((slot) => ({
        sectorId: slot.sectorId,
        state: slot.state,
        lod: slot.lod,
        depth: slot.depth,
        bytes: slot.bytes,
        digest: slot.terrain?.digest ?? null,
      }))
      .sort((a, b) => a.depth - b.depth || a.sectorId.localeCompare(b.sectorId));
  }

  stats(): StreamingStats {
    const counts = Object.fromEntries(SECTOR_STATES.map((state) => [state, 0])) as Record<
      SectorState,
      number
    >;
    let queueDepth = 0;
    for (const slot of this.slots.values()) {
      counts[slot.state] += 1;
      if (slot.state === "queued") queueDepth += 1;
    }

    return {
      counts,
      resident: this.residentCount,
      peakResident: this.peakResident,
      generated: this.generated,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cancelled: this.cancelledCount,
      evicted: this.evictedCount,
      failed: this.failedCount,
      rescued: this.rescuedCount,
      lastGenerationMs: this.lastGenerationMs,
      averageGenerationMs: this.generationSamples ? this.generationMsTotal / this.generationSamples : 0,
      lastUploadMs: this.lastUploadMs,
      averageUploadMs: this.uploadSamples ? this.uploadMsTotal / this.uploadSamples : 0,
      residentBytes: this.residentBytes,
      peakResidentBytes: this.peakResidentBytes,
      cachedBytes: this.cache.sizeBytes,
      cachedEntries: this.cache.count,
      inFlight: this.pending.size,
      queueDepth,
      serviceKind: this.service.kind,
    };
  }

  /**
   * Ground height at a position, in metres above sea level, or null when the
   * sector under it is not resident or is too coarse to carry collision data.
   * Returning null rather than zero keeps a caller from walking on an imaginary
   * sea-level plane over terrain that has not loaded.
   */
  sampleGroundHeight(position: GeoPosition): number | null {
    const { address, s01, t01 } = sectorGridCoordinates(position);
    const slot = this.slots.get(sectorId(address));
    const collision = slot?.terrain?.collision;
    if (!collision) return null;
    return sampleCollisionHeight(collision, s01, t01);
  }

  /** Resolves once every generation and upload started so far has settled. */
  async settle(): Promise<void> {
    let guard = 0;
    while (this.pending.size > 0 && guard < 1_000) {
      await Promise.allSettled([...this.pending]);
      guard += 1;
    }
  }

  /**
   * Drives update/settle until the resident set stops changing. Used by tests and
   * the headless stress route; the live game just calls `update` each frame.
   */
  async pump(input: StreamerInput, maxRounds = 64): Promise<void> {
    for (let round = 0; round < maxRounds; round += 1) {
      this.update(input);
      await this.settle();
      const busy = [...this.slots.values()].some(
        (slot) =>
          slot.state === "queued" ||
          slot.state === "generating" ||
          slot.state === "cpu-ready" ||
          slot.state === "gpu-uploading" ||
          slot.state === "evicting",
      );
      if (!busy) return;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots.values()) this.releaseSlot(slot, { keepData: false });
    this.slots.clear();
    this.cache.clear();
    this.service.dispose();
  }
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`SectorStreamer ${label} must be a positive number, got ${value}`);
  }
  return value;
}

function defaultNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/** Vertex count a level of detail costs, for budget documentation and tests. */
export function lodVertexCount(lod: LodLevel): number {
  const resolution = LOD_GRID_RESOLUTION[lod];
  return resolution * resolution;
}
