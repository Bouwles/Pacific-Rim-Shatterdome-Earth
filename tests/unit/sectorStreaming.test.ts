import { describe, expect, it } from "vitest";
import {
  RING_LODS,
  SECTOR_STATES,
  SLEEP_DEPTH,
  SectorDataCache,
  SectorStreamer,
  lodVertexCount,
  type SectorSink,
} from "../../src/world/sectorStreaming";
import {
  SectorGenerationCancelled,
  InlineTerrainService,
  type GenerationResult,
  type SectorGenerationService,
} from "../../src/world/terrainService";
import {
  LOD_GRID_RESOLUTION,
  generateSectorTerrain,
  type SectorTerrain,
  type TerrainRequestParams,
} from "../../src/world/terrain";
import { createDefaultTerrainAnchors } from "../../src/data/regions";
import { geo } from "../../src/world/coordinates";
import { sectorIdAt, sectorsWithinDepth, parseSectorId } from "../../src/world/cubeSphere";

const ANCHORS = createDefaultTerrainAnchors();
const SEED = 4242;
const HONG_KONG = geo(22.3193, 114.1694, 0);

/** Records everything the presentation side was asked to do. */
class RecordingSink implements SectorSink {
  readonly uploaded: string[] = [];
  readonly released: string[] = [];
  readonly slept: string[] = [];
  readonly woken: string[] = [];
  readonly live = new Set<string>();

  upload(terrain: SectorTerrain): void {
    this.uploaded.push(terrain.sectorId);
    this.live.add(terrain.sectorId);
  }
  sleep(sectorId: string): void {
    this.slept.push(sectorId);
  }
  wake(sectorId: string): void {
    this.woken.push(sectorId);
  }
  release(sectorId: string): void {
    this.released.push(sectorId);
    this.live.delete(sectorId);
  }
}

/** A service whose completions are released by hand, so in-flight states can be inspected. */
class ManualTerrainService implements SectorGenerationService {
  readonly kind = "manual";
  readonly requested: { requestId: number; params: TerrainRequestParams }[] = [];
  readonly cancelled: number[] = [];
  private readonly waiting = new Map<
    number,
    { resolve(result: GenerationResult): void; reject(error: Error): void; params: TerrainRequestParams }
  >();
  disposed = false;

  generate(requestId: number, params: TerrainRequestParams): Promise<GenerationResult> {
    this.requested.push({ requestId, params });
    return new Promise<GenerationResult>((resolve, reject) => {
      this.waiting.set(requestId, { resolve, reject, params });
    });
  }

  cancel(requestId: number): void {
    this.cancelled.push(requestId);
  }

  dispose(): void {
    this.disposed = true;
  }

  get pendingIds(): number[] {
    return [...this.waiting.keys()];
  }

  completeAll(): void {
    for (const [requestId, handlers] of [...this.waiting]) {
      this.waiting.delete(requestId);
      handlers.resolve({ terrain: generateSectorTerrain(handlers.params), generationMs: 1 });
    }
  }

  failAll(message: string): void {
    for (const [requestId, handlers] of [...this.waiting]) {
      this.waiting.delete(requestId);
      handlers.reject(new Error(message));
    }
  }

  rejectAllCancelled(): void {
    for (const [requestId, handlers] of [...this.waiting]) {
      this.waiting.delete(requestId);
      handlers.reject(new SectorGenerationCancelled(requestId));
    }
  }
}

function build(overrides: Partial<ConstructorParameters<typeof SectorStreamer>[0]> = {}) {
  const sink = new RecordingSink();
  const service = new InlineTerrainService();
  const streamer = new SectorStreamer({
    service,
    sink,
    seed: SEED,
    anchors: ANCHORS,
    maxUploadsPerUpdate: 8,
    maxConcurrentGenerations: 8,
    ...overrides,
  });
  return { sink, service, streamer };
}

describe("sector data cache", () => {
  it("evicts least recently used entries once over budget", () => {
    const terrain = generateSectorTerrain({ sectorId: "+X/3/4", lod: 3, seed: SEED, anchors: ANCHORS });
    const cache = new SectorDataCache(terrain.estimatedBytes * 2.5);

    for (const sectorId of ["+X/0/0", "+X/1/0", "+X/2/0"]) {
      const entry = generateSectorTerrain({ sectorId, lod: 3, seed: SEED, anchors: ANCHORS });
      cache.set(entry.cacheKey, entry);
    }
    expect(cache.count).toBe(2);
    expect(cache.sizeBytes).toBeLessThanOrEqual(terrain.estimatedBytes * 2.5);
    expect(cache.has("t1|s4242|+X/0/0|lod3")).toBe(false);
  });

  it("promotes an entry on read so it survives the next eviction", () => {
    const make = (sectorId: string) =>
      generateSectorTerrain({ sectorId, lod: 3, seed: SEED, anchors: ANCHORS });

    const first = make("+X/0/0");
    const second = make("+X/1/0");
    // Room for exactly two entries, so the third forces one out.
    const cache = new SectorDataCache(first.estimatedBytes + second.estimatedBytes);
    cache.set(first.cacheKey, first);
    cache.set(second.cacheKey, second);
    cache.get(first.cacheKey);

    const third = make("+X/2/0");
    cache.set(third.cacheKey, third);
    expect(cache.has(first.cacheKey)).toBe(true);
    expect(cache.has(second.cacheKey)).toBe(false);
  });

  it("refuses a nonsensical budget", () => {
    expect(() => new SectorDataCache(0)).toThrow(/positive number of bytes/);
  });
});

describe("sector streamer", () => {
  it("names every state it can be in", () => {
    expect([...SECTOR_STATES]).toEqual([
      "absent",
      "queued",
      "generating",
      "cpu-ready",
      "gpu-uploading",
      "active",
      "sleeping",
      "evicting",
    ]);
  });

  it("reports absent for a sector it has never heard of", () => {
    const { streamer } = build();
    expect(streamer.stateOf("+X/0/0")).toBe("absent");
    streamer.dispose();
  });

  it("walks a sector from queued through generating to active", async () => {
    const service = new ManualTerrainService();
    const sink = new RecordingSink();
    const streamer = new SectorStreamer({ service, sink, seed: SEED, anchors: ANCHORS });
    const centre = sectorIdAt(HONG_KONG);

    streamer.update({ position: HONG_KONG });
    expect(streamer.stateOf(centre)).toBe("generating");

    service.completeAll();
    await streamer.settle();
    expect(streamer.stateOf(centre)).toBe("cpu-ready");

    streamer.update({ position: HONG_KONG });
    expect(streamer.stateOf(centre)).toBe("active");
    expect(sink.uploaded).toContain(centre);
    streamer.dispose();
  });

  it("loads the whole ring set and gives each ring its own level of detail", async () => {
    const { streamer, sink } = build();
    await streamer.pump({ position: HONG_KONG });

    const expected = sectorsWithinDepth(parseSectorId(sectorIdAt(HONG_KONG)), RING_LODS.length - 1);
    expect(sink.live.size).toBe(expected.size);

    for (const view of streamer.slotViews()) {
      expect(view.lod).toBe(RING_LODS[view.depth]);
      expect(view.state).toBe(view.depth >= SLEEP_DEPTH ? "sleeping" : "active");
    }
    streamer.dispose();
  });

  it("sleeps the outer ring rather than rendering it", async () => {
    const { streamer } = build();
    await streamer.pump({ position: HONG_KONG });

    const stats = streamer.stats();
    expect(stats.counts.sleeping).toBeGreaterThan(0);
    expect(stats.counts.active).toBeGreaterThan(0);
    expect(stats.counts.active + stats.counts.sleeping).toBe(stats.resident);
    streamer.dispose();
  });

  it("releases sectors that fall out of range and keeps their data cached", async () => {
    const { streamer, sink } = build();
    await streamer.pump({ position: HONG_KONG });
    const before = new Set(sink.live);

    // Far enough that nothing from Hong Kong is still in range.
    const sydney = geo(-33.8688, 151.2093, 0);
    await streamer.pump({ position: sydney });

    for (const sectorId of before) expect(sink.live.has(sectorId)).toBe(false);
    expect(sink.released.length).toBeGreaterThan(0);
    // Meshes gone, data retained: that is what makes turning around cheap.
    expect(streamer.stats().cachedEntries).toBeGreaterThan(0);
    streamer.dispose();
  });

  it("reuses cached data when the player turns around, with identical content", async () => {
    const { streamer } = build();

    await streamer.pump({ position: HONG_KONG });
    const firstDigests = digestsOf(streamer);
    const afterFirst = streamer.stats().generated;

    await streamer.pump({ position: geo(-33.8688, 151.2093, 0) });
    const afterAway = streamer.stats();
    expect(afterAway.generated).toBeGreaterThan(afterFirst);

    await streamer.pump({ position: HONG_KONG });
    const afterReturn = streamer.stats();

    expect(afterReturn.cacheHits).toBeGreaterThan(0);
    // Nothing was regenerated on the way back.
    expect(afterReturn.generated).toBe(afterAway.generated);
    expect(digestsOf(streamer)).toEqual(firstDigests);
    streamer.dispose();
  });

  it("cancels in-flight generation for a sector the player has already left", async () => {
    const service = new ManualTerrainService();
    const sink = new RecordingSink();
    const streamer = new SectorStreamer({ service, sink, seed: SEED, anchors: ANCHORS });

    streamer.update({ position: HONG_KONG });
    const inFlight = service.pendingIds;
    expect(inFlight.length).toBeGreaterThan(0);

    streamer.update({ position: geo(-33.8688, 151.2093, 0) });
    expect(service.cancelled).toEqual(expect.arrayContaining(inFlight));
    expect(streamer.stats().cancelled).toBeGreaterThan(0);

    // A cancelled request that still resolves must not resurrect its sector.
    service.rejectAllCancelled();
    await streamer.settle();
    streamer.dispose();
  });

  it("counts a generation failure and does not leave the sector stuck", async () => {
    const service = new ManualTerrainService();
    const sink = new RecordingSink();
    const streamer = new SectorStreamer({ service, sink, seed: SEED, anchors: ANCHORS });
    const centre = sectorIdAt(HONG_KONG);

    streamer.update({ position: HONG_KONG });
    service.failAll("worker exploded");
    await streamer.settle();

    expect(streamer.stats().failed).toBeGreaterThan(0);
    expect(streamer.stateOf(centre)).toBe("absent");
    streamer.dispose();
  });

  it("prioritises the direction of travel over plain ring order", () => {
    const service = new ManualTerrainService();
    const sink = new RecordingSink();
    const streamer = new SectorStreamer({
      service,
      sink,
      seed: SEED,
      anchors: ANCHORS,
      maxConcurrentGenerations: 2,
    });

    streamer.update({ position: HONG_KONG, velocity: { east: 0, north: 400, up: 0 } });
    const northbound = service.requested.map((entry) => entry.params.sectorId);

    const service2 = new ManualTerrainService();
    const streamer2 = new SectorStreamer({
      service: service2,
      sink: new RecordingSink(),
      seed: SEED,
      anchors: ANCHORS,
      maxConcurrentGenerations: 2,
    });
    streamer2.update({ position: HONG_KONG, velocity: { east: 0, north: -400, up: 0 } });
    const southbound = service2.requested.map((entry) => entry.params.sectorId);

    // Both start with the sector underfoot; the second pick is what velocity moves.
    expect(northbound[0]).toBe(southbound[0]);
    expect(northbound[1]).not.toBe(southbound[1]);
    streamer.dispose();
    streamer2.dispose();
  });

  it("prioritises a declared deployment target ahead of a nearer ring", () => {
    const service = new ManualTerrainService();
    const streamer = new SectorStreamer({
      service,
      sink: new RecordingSink(),
      seed: SEED,
      anchors: ANCHORS,
      maxConcurrentGenerations: 2,
    });

    const ring = [...sectorsWithinDepth(parseSectorId(sectorIdAt(HONG_KONG)), 2)];
    const distant = ring.find(([, depth]) => depth === 2)?.[0];
    expect(distant).toBeDefined();

    streamer.update({ position: HONG_KONG, deploymentTargetSectorId: distant });
    expect(service.requested.map((entry) => entry.params.sectorId)).toContain(distant);
    streamer.dispose();
  });

  it("honours the concurrency cap", () => {
    const service = new ManualTerrainService();
    const streamer = new SectorStreamer({
      service,
      sink: new RecordingSink(),
      seed: SEED,
      anchors: ANCHORS,
      maxConcurrentGenerations: 3,
    });
    streamer.update({ position: HONG_KONG });
    expect(service.requested).toHaveLength(3);
    streamer.dispose();
  });

  it("uploads at most the configured number of sectors per update", async () => {
    const { streamer, sink } = build({ maxUploadsPerUpdate: 1 });
    streamer.update({ position: HONG_KONG });
    await streamer.settle();
    streamer.update({ position: HONG_KONG });
    await streamer.settle();
    expect(sink.uploaded.length).toBeLessThanOrEqual(2);
    streamer.dispose();
  });

  it("evicts down to the memory budget without ever dropping the ground underfoot", async () => {
    const { streamer, sink } = build({ memoryBudgetBytes: 40_000 });
    await streamer.pump({ position: HONG_KONG });

    const stats = streamer.stats();
    expect(stats.evicted).toBeGreaterThan(0);
    expect(stats.residentBytes).toBeLessThanOrEqual(40_000);
    expect(sink.live.has(sectorIdAt(HONG_KONG))).toBe(true);
    streamer.dispose();
  });

  it("rescues a sector that leaves and returns before its release lands", () => {
    const { streamer, sink } = build();
    streamer.update({ position: HONG_KONG });
    const centre = sectorIdAt(HONG_KONG);

    streamer.update({ position: geo(-33.8688, 151.2093, 0) });
    streamer.update({ position: HONG_KONG });

    expect(streamer.stateOf(centre)).not.toBe("absent");
    void sink;
    streamer.dispose();
  });

  it("samples ground height only where collision data is resident", async () => {
    const { streamer } = build();
    expect(streamer.sampleGroundHeight(HONG_KONG)).toBeNull();

    await streamer.pump({ position: HONG_KONG });
    const height = streamer.sampleGroundHeight(HONG_KONG);
    expect(height).not.toBeNull();
    expect(Number.isFinite(height ?? Number.NaN)).toBe(true);

    // Far side of the planet: resident set does not reach, so there is no honest answer.
    expect(streamer.sampleGroundHeight(geo(-40, -60, 0))).toBeNull();
    streamer.dispose();
  });

  it("releases everything and disposes its service on dispose", async () => {
    const service = new InlineTerrainService();
    const sink = new RecordingSink();
    const streamer = new SectorStreamer({ service, sink, seed: SEED, anchors: ANCHORS });
    await streamer.pump({ position: HONG_KONG });
    expect(sink.live.size).toBeGreaterThan(0);

    streamer.dispose();
    expect(sink.live.size).toBe(0);
    expect(streamer.stats().cachedEntries).toBe(0);
    // A second dispose must be harmless; screens tear down more than once.
    streamer.dispose();
  });

  it("ignores updates after disposal instead of resurrecting itself", () => {
    const { streamer, sink } = build();
    streamer.dispose();
    streamer.update({ position: HONG_KONG });
    expect(sink.uploaded).toHaveLength(0);
  });

  it("rejects nonsensical options", () => {
    const sink = new RecordingSink();
    expect(
      () =>
        new SectorStreamer({
          service: new InlineTerrainService(),
          sink,
          seed: SEED,
          anchors: ANCHORS,
          maxUploadsPerUpdate: 0,
        }),
    ).toThrow(/maxUploadsPerUpdate must be a positive number/);
  });

  it("reports vertex cost per level of detail", () => {
    for (const lod of [0, 1, 2, 3] as const) {
      expect(lodVertexCount(lod)).toBe(LOD_GRID_RESOLUTION[lod] ** 2);
    }
    expect(lodVertexCount(0)).toBeGreaterThan(lodVertexCount(3));
  });
});

/** Sector id to content digest for everything currently loaded. */
function digestsOf(streamer: SectorStreamer): Record<string, number> {
  const digests: Record<string, number> = {};
  for (const view of streamer.slotViews()) {
    if (view.digest !== null) digests[view.sectorId] = view.digest;
  }
  return digests;
}
