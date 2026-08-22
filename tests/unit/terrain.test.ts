import { describe, expect, it } from "vitest";
import {
  COLLISION_LOD,
  LOD_GRID_RESOLUTION,
  generateSectorTerrain,
  sampleCollisionHeight,
  terrainCacheKey,
  validateTerrainRequest,
  type LodLevel,
  type TerrainAnchor,
} from "../../src/world/terrain";
import { REGION_DEFINITIONS, createDefaultTerrainAnchors } from "../../src/data/regions";
import { sectorGridCoordinates, sectorIdAt } from "../../src/world/cubeSphere";

const ANCHORS = createDefaultTerrainAnchors();
const SEED = 20260822;

function generate(sectorId: string, lod: LodLevel = 0, seed = SEED) {
  return generateSectorTerrain({ sectorId, lod, seed, anchors: ANCHORS });
}

describe("sector terrain", () => {
  it("builds a cache key from everything that can change the bytes", () => {
    const base = { sectorId: "+X/3/4", lod: 0 as LodLevel, seed: 7, anchors: ANCHORS };
    const key = terrainCacheKey(base);
    expect(terrainCacheKey({ ...base })).toBe(key);
    expect(terrainCacheKey({ ...base, lod: 1 })).not.toBe(key);
    expect(terrainCacheKey({ ...base, seed: 8 })).not.toBe(key);
    expect(terrainCacheKey({ ...base, sectorId: "+X/3/5" })).not.toBe(key);
  });

  it("produces identical content for the same key, in any order", () => {
    const first = generate("+Z/9/2");
    // Generating something else in between must not shift the result.
    generate("-Y/1/1");
    generate("+X/15/15", 2);
    const second = generate("+Z/9/2");

    expect(second.digest).toBe(first.digest);
    expect(second.cacheKey).toBe(first.cacheKey);
    expect(Array.from(second.heights)).toEqual(Array.from(first.heights));
    expect(second.cityCells.length).toBe(first.cityCells.length);
  });

  it("changes with the seed", () => {
    expect(generate("+Z/9/2", 0, 1).digest).not.toBe(generate("+Z/9/2", 0, 2).digest);
  });

  it("agrees exactly with its neighbour along a shared edge", () => {
    const resolution = LOD_GRID_RESOLUTION[0];
    const left = generate("+X/3/4");
    const right = generate("+X/4/4");

    let worst = 0;
    for (let j = 0; j < resolution; j += 1) {
      const leftEdge = left.heights[j * resolution + (resolution - 1)] ?? 0;
      const rightEdge = right.heights[j * resolution] ?? 0;
      worst = Math.max(worst, Math.abs(leftEdge - rightEdge));
    }
    // Position-hashed noise means the shared samples are literally the same
    // samples, so this is exact rather than merely close.
    expect(worst).toBe(0);
  });

  it("uses the grid resolution its level of detail declares", () => {
    for (const lod of [0, 1, 2, 3] as const) {
      const terrain = generate("+Y/6/6", lod);
      const resolution = LOD_GRID_RESOLUTION[lod];
      expect(terrain.gridResolution).toBe(resolution);
      expect(terrain.heights.length).toBe(resolution * resolution);
      expect(terrain.positions.length).toBe(resolution * resolution * 3);
      expect(terrain.surfaces.length).toBe(resolution * resolution);
    }
  });

  it("carries collision detail only where it is close enough to matter", () => {
    for (const lod of [0, 1, 2, 3] as const) {
      const terrain = generate("+Y/6/6", lod);
      expect(terrain.collision !== null).toBe(lod <= COLLISION_LOD);
    }
  });

  it("costs less at every coarser level of detail", () => {
    const sizes = ([0, 1, 2, 3] as const).map((lod) => generate("+Y/6/6", lod).estimatedBytes);
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i]).toBeLessThan(sizes[i - 1] ?? Infinity);
    }
  });

  it("keeps every populated region above water and on its authored climate", () => {
    for (const region of REGION_DEFINITIONS.filter((entry) => entry.kind !== "ocean")) {
      const terrain = generate(sectorIdAt(region.centre));
      const { s01, t01 } = sectorGridCoordinates(region.centre);
      const height = terrain.collision ? sampleCollisionHeight(terrain.collision, s01, t01) : -1;

      expect(height, `${region.id} is under water`).toBeGreaterThan(0);
      // Authored content wins over the generated latitude band, or a region whose
      // sector centre drifts across a band edge would render as another climate.
      expect(terrain.climate, `${region.id} climate`).toBe(region.climate);
    }
  });

  it("keeps an ocean region as deep water with nothing built on it", () => {
    const breach = REGION_DEFINITIONS.find((entry) => entry.kind === "ocean");
    expect(breach).toBeDefined();
    if (!breach) return;

    const terrain = generate(sectorIdAt(breach.centre));
    expect(terrain.waterFraction).toBe(1);
    expect(terrain.maxElevationMeters).toBeLessThan(0);
    expect(terrain.cityCells).toHaveLength(0);
    expect(terrain.trafficLanes).toHaveLength(0);
    expect(terrain.climate).toBe("oceanic");
  });

  it("puts city cells and lanes only where a populated region is", () => {
    const hongKong = generate(
      sectorIdAt({ latitudeDeg: 22.3193, longitudeDeg: 114.1694, altitudeMeters: 0 }),
    );
    expect(hongKong.cityCells.length).toBeGreaterThan(0);

    // Mid-Pacific, far from every anchor.
    const empty = generate(sectorIdAt({ latitudeDeg: -20, longitudeDeg: -150, altitudeMeters: 0 }));
    expect(empty.cityCells).toHaveLength(0);
    expect(empty.trafficLanes).toHaveLength(0);
  });

  it("thins detail as level of detail coarsens and drops it entirely at the far ring", () => {
    const sectorId = sectorIdAt({ latitudeDeg: 22.3193, longitudeDeg: 114.1694, altitudeMeters: 0 });
    const near = generate(sectorId, 0).cityCells.length;
    const mid = generate(sectorId, 1).cityCells.length;
    expect(mid).toBeLessThan(near);
    expect(generate(sectorId, 3).cityCells).toHaveLength(0);
  });

  it("marks a sector holding both land and water as coastline", () => {
    const coastal = generate(sectorIdAt({ latitudeDeg: 22.3193, longitudeDeg: 114.1694, altitudeMeters: 0 }));
    expect(coastal.coastline).toBe(true);
    expect(coastal.waterFraction).toBeGreaterThan(0);
    expect(coastal.waterFraction).toBeLessThan(1);
  });

  it("samples the collision field by interpolation, not by nearest vertex", () => {
    const terrain = generate("+X/3/4");
    expect(terrain.collision).not.toBeNull();
    if (!terrain.collision) return;

    const left = sampleCollisionHeight(terrain.collision, 0.25, 0.5);
    const right = sampleCollisionHeight(terrain.collision, 0.26, 0.5);
    expect(Number.isFinite(left)).toBe(true);
    // A nearest-vertex lookup would return the same value for both.
    expect(left).not.toBe(right);
  });

  it("clamps collision sampling at the sector edges", () => {
    const terrain = generate("+X/3/4");
    if (!terrain.collision) throw new Error("expected collision data at lod 0");
    for (const [s, t] of [
      [0, 0],
      [1, 1],
      [-0.5, 1.5],
    ] as const) {
      expect(Number.isFinite(sampleCollisionHeight(terrain.collision, s, t))).toBe(true);
    }
  });

  it("rejects a malformed request instead of generating nonsense", () => {
    expect(validateTerrainRequest({ sectorId: "nope", lod: 0, seed: 1, anchors: ANCHORS })).toContainEqual(
      expect.stringMatching(/Malformed sector id/),
    );
    expect(
      validateTerrainRequest({ sectorId: "+X/0/0", lod: 9 as LodLevel, seed: 1, anchors: ANCHORS }),
    ).toContainEqual(expect.stringMatching(/lod must be one of/));
    expect(() => generate("+X/99/0")).toThrow(/Cannot generate terrain/);
  });

  it("names a broken anchor rather than returning a sector of NaN", () => {
    const broken: TerrainAnchor = {
      regionId: "broken",
      latitudeDeg: 0,
      longitudeDeg: 0,
      radiusMeters: 1000,
      populationThousands: 0,
      maskTarget: Number.NaN,
      climate: "temperate",
      populated: false,
    };
    const errors = validateTerrainRequest({ sectorId: "+X/0/0", lod: 0, seed: 1, anchors: [broken] });
    expect(errors).toContainEqual(expect.stringMatching(/"broken"\.maskTarget must be a finite number/));
  });

  it("produces finite geometry everywhere it is asked", () => {
    for (const sectorId of ["+X/0/0", "-Z/15/15", "+Y/8/0", "-Y/0/8"]) {
      const terrain = generate(sectorId, 1);
      expect(Array.from(terrain.heights).every(Number.isFinite)).toBe(true);
      expect(Array.from(terrain.positions).every(Number.isFinite)).toBe(true);
      expect(terrain.meanElevationMeters).toBeGreaterThanOrEqual(terrain.minElevationMeters);
      expect(terrain.meanElevationMeters).toBeLessThanOrEqual(terrain.maxElevationMeters);
    }
  });
});
