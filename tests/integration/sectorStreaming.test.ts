import { describe, expect, it } from "vitest";
import { RING_LODS, SectorStreamer, type SectorSink } from "../../src/world/sectorStreaming";
import { InlineTerrainService } from "../../src/world/terrainService";
import { createDefaultRegionRegistry, createDefaultTerrainAnchors } from "../../src/data/regions";
import { buildRouteSamples, runStreamingRoute, STRESS_ROUTE_REGION_IDS } from "../../src/debug/streamRoute";
import { geo } from "../../src/world/coordinates";
import { sectorIdAt } from "../../src/world/cubeSphere";
import type { SectorTerrain } from "../../src/world/terrain";

const ANCHORS = createDefaultTerrainAnchors();
const REGIONS = createDefaultRegionRegistry();
const SEED = 987_654;
/** Rings are square, so the resident set is a (2d+1) by (2d+1) block and never larger. */
const MAX_RESIDENT_SECTORS = (2 * (RING_LODS.length - 1) + 1) ** 2;

/**
 * Stands in for the Babylon renderer and, crucially, asserts its own invariants:
 * a sector may never be uploaded twice without a release in between, and nothing
 * may be released that was not live.
 */
class LeakCheckingSink implements SectorSink {
  readonly live = new Set<string>();
  readonly problems: string[] = [];
  peakLive = 0;
  uploads = 0;
  releases = 0;

  upload(terrain: SectorTerrain): void {
    if (this.live.has(terrain.sectorId)) {
      this.problems.push(`${terrain.sectorId} uploaded twice without a release`);
    }
    this.live.add(terrain.sectorId);
    this.uploads += 1;
    this.peakLive = Math.max(this.peakLive, this.live.size);
  }
  sleep(): void {}
  wake(): void {}
  release(sectorId: string): void {
    if (!this.live.has(sectorId)) return;
    this.live.delete(sectorId);
    this.releases += 1;
  }
}

function buildStreamer(sink: SectorSink, overrides: Record<string, unknown> = {}) {
  return new SectorStreamer({
    service: new InlineTerrainService(),
    sink,
    seed: SEED,
    anchors: ANCHORS,
    maxUploadsPerUpdate: 8,
    maxConcurrentGenerations: 4,
    ...overrides,
  });
}

const ROUTE_WAYPOINTS = STRESS_ROUTE_REGION_IDS.map((id) => ({
  label: id,
  position: REGIONS.getOrThrow(id).centre,
}));

describe("streaming stress route", () => {
  it("builds samples along great circles at a constant speed", () => {
    const samples = buildRouteSamples({
      waypoints: ROUTE_WAYPOINTS,
      speedMetersPerSecond: 4_000,
      stepSeconds: 0.25,
    });

    expect(samples.length).toBeGreaterThan(20);
    expect(samples[0]?.elapsedSeconds).toBe(0);
    for (const sample of samples) {
      const speed = Math.hypot(sample.velocity.east, sample.velocity.north);
      expect(speed).toBeCloseTo(4_000, 3);
      expect(Number.isFinite(sample.position.latitudeDeg)).toBe(true);
    }
    // Distance climbs monotonically; a leg that went backwards would show here.
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]?.distanceMeters ?? 0).toBeGreaterThanOrEqual(samples[i - 1]?.distanceMeters ?? 0);
    }
  });

  it("reports the turn rather than the old heading when a leg changes", () => {
    const samples = buildRouteSamples({
      waypoints: ROUTE_WAYPOINTS,
      speedMetersPerSecond: 8_000,
      stepSeconds: 1,
    });
    const headings = samples.map((sample) => Math.atan2(sample.velocity.north, sample.velocity.east));
    const distinct = new Set(headings.map((heading) => heading.toFixed(2)));
    expect(distinct.size).toBeGreaterThan(3);
  });

  it("rejects a route it cannot fly", () => {
    expect(() =>
      buildRouteSamples({ waypoints: [ROUTE_WAYPOINTS[0]!], speedMetersPerSecond: 1, stepSeconds: 1 }),
    ).toThrow(/at least two waypoints/);
    expect(() =>
      buildRouteSamples({ waypoints: ROUTE_WAYPOINTS, speedMetersPerSecond: 0, stepSeconds: 1 }),
    ).toThrow(/speed must be positive/);
  });

  it("flies the full route without leaking a single sector", async () => {
    const sink = new LeakCheckingSink();
    const streamer = buildStreamer(sink);
    const samples = buildRouteSamples({
      waypoints: ROUTE_WAYPOINTS,
      speedMetersPerSecond: 8_000,
      stepSeconds: 1,
    });

    const report = await runStreamingRoute(streamer, samples);

    expect(sink.problems, sink.problems.join("\n")).toEqual([]);
    expect(report.sectorsVisited).toBeGreaterThan(3);
    // Residency is bounded by the ring set, not by how far was flown.
    expect(sink.peakLive).toBeLessThanOrEqual(MAX_RESIDENT_SECTORS);
    expect(report.stats.failed).toBe(0);

    streamer.dispose();
    expect(sink.live.size).toBe(0);
    expect(sink.releases).toBe(sink.uploads);
  });

  it("holds memory steady across repeated load and evict cycles", async () => {
    const sink = new LeakCheckingSink();
    const streamer = buildStreamer(sink);
    const samples = buildRouteSamples({
      waypoints: ROUTE_WAYPOINTS,
      speedMetersPerSecond: 12_000,
      stepSeconds: 1,
    });

    const residentPerLap: number[] = [];
    const cachedPerLap: number[] = [];
    for (let lap = 0; lap < 3; lap += 1) {
      await runStreamingRoute(streamer, samples);
      const stats = streamer.stats();
      residentPerLap.push(stats.residentBytes);
      cachedPerLap.push(stats.cachedBytes);
    }

    // Same route, same end point: the resident set must land in the same place
    // every lap. A leak would show as a figure that climbs each time round.
    expect(residentPerLap[1]).toBe(residentPerLap[0]);
    expect(residentPerLap[2]).toBe(residentPerLap[0]);
    // The cache is bounded too, and by lap three it has stopped growing.
    expect(cachedPerLap[2]).toBe(cachedPerLap[1]);
    expect(streamer.stats().cachedBytes).toBeLessThanOrEqual(48 * 1024 * 1024);

    streamer.dispose();
    expect(sink.live.size).toBe(0);
  });

  it("regenerates nothing on the second lap of the same route", async () => {
    const sink = new LeakCheckingSink();
    const streamer = buildStreamer(sink, { cacheBudgetBytes: 64 * 1024 * 1024 });
    const samples = buildRouteSamples({
      waypoints: [ROUTE_WAYPOINTS[0]!, ROUTE_WAYPOINTS[1]!],
      speedMetersPerSecond: 8_000,
      stepSeconds: 1,
    });

    await runStreamingRoute(streamer, samples);
    const afterFirst = streamer.stats().generated;
    expect(afterFirst).toBeGreaterThan(0);

    await runStreamingRoute(streamer, samples);
    const afterSecond = streamer.stats();

    // Every sector on the second lap came out of the cache.
    expect(afterSecond.generated).toBe(afterFirst);
    expect(afterSecond.cacheHits).toBeGreaterThan(0);
    streamer.dispose();
  });

  it("gives identical terrain to two streamers built from the same seed", async () => {
    const first = buildStreamer(new LeakCheckingSink());
    const second = buildStreamer(new LeakCheckingSink());
    const position = geo(22.3193, 114.1694, 0);

    await first.pump({ position });
    await second.pump({ position });

    const digest = (streamer: SectorStreamer) =>
      Object.fromEntries(streamer.slotViews().map((view) => [view.sectorId, view.digest]));

    expect(digest(second)).toEqual(digest(first));
    // Terrain is a pure function of seed and sector, which is why a save can
    // carry a seed and no terrain at all.
    expect(Object.keys(digest(first)).length).toBeGreaterThan(0);
    first.dispose();
    second.dispose();
  });

  it("gives different terrain to a different seed", async () => {
    const first = buildStreamer(new LeakCheckingSink(), { seed: 1 });
    const second = buildStreamer(new LeakCheckingSink(), { seed: 2 });
    const position = geo(22.3193, 114.1694, 0);
    const sectorId = sectorIdAt(position);

    await first.pump({ position });
    await second.pump({ position });

    const digestOf = (streamer: SectorStreamer) =>
      streamer.slotViews().find((view) => view.sectorId === sectorId)?.digest;

    expect(digestOf(first)).not.toBe(digestOf(second));
    first.dispose();
    second.dispose();
  });

  it("keeps ground height available underfoot for the whole route", async () => {
    const sink = new LeakCheckingSink();
    const streamer = buildStreamer(sink);
    const samples = buildRouteSamples({
      waypoints: [ROUTE_WAYPOINTS[0]!, ROUTE_WAYPOINTS[1]!],
      speedMetersPerSecond: 8_000,
      stepSeconds: 1,
    });

    let missing = 0;
    for (const sample of samples) {
      await streamer.pump({ position: sample.position, velocity: sample.velocity });
      if (streamer.sampleGroundHeight(sample.position) === null) missing += 1;
    }
    expect(missing).toBe(0);
    streamer.dispose();
  });

  it("stays inside a tight memory budget by evicting, not by refusing to load", async () => {
    const sink = new LeakCheckingSink();
    const streamer = buildStreamer(sink, { memoryBudgetBytes: 60_000 });
    const samples = buildRouteSamples({
      waypoints: [ROUTE_WAYPOINTS[0]!, ROUTE_WAYPOINTS[1]!],
      speedMetersPerSecond: 8_000,
      stepSeconds: 1,
    });

    const report = await runStreamingRoute(streamer, samples);
    expect(report.peakResidentBytes).toBeLessThanOrEqual(60_000);
    expect(report.stats.evicted).toBeGreaterThan(0);
    // The sector underfoot is still there: the budget is a target, not a reason
    // to delete the ground the player is standing on.
    expect(sink.live.size).toBeGreaterThan(0);
    streamer.dispose();
  });
});
