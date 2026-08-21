import { describe, expect, it } from "vitest";
import {
  CUBE_FACES,
  SECTOR_COUNT,
  SECTOR_GRID_RESOLUTION,
  allSectors,
  approximateSectorSpanMeters,
  neighborIds,
  parseSectorId,
  sectorAt,
  sectorCentre,
  sectorId,
  sectorIdAt,
  sectorNeighbors,
} from "../../src/world/cubeSphere";
import { geo, surfaceDistanceMeters } from "../../src/world/coordinates";

describe("sector addressing", () => {
  it("covers the globe with one cell per face position", () => {
    expect(allSectors()).toHaveLength(SECTOR_COUNT);
    expect(SECTOR_COUNT).toBe(6 * SECTOR_GRID_RESOLUTION * SECTOR_GRID_RESOLUTION);
    expect(new Set(allSectors().map(sectorId)).size).toBe(SECTOR_COUNT);
  });

  it("round-trips an id through parse and format", () => {
    for (const address of allSectors()) {
      expect(parseSectorId(sectorId(address))).toEqual(address);
    }
  });

  it("rejects malformed ids with an actionable message", () => {
    expect(() => parseSectorId("nonsense")).toThrow(/Malformed sector id/);
    expect(() => parseSectorId("+Q/0/0")).toThrow(/Malformed sector id/);
    expect(() => parseSectorId(`+X/${SECTOR_GRID_RESOLUTION}/0`)).toThrow(/out-of-range/);
    expect(() => parseSectorId("+X/-1/0")).toThrow(/out-of-range/);
    expect(() => parseSectorId("+X/1.5/0")).toThrow(/out-of-range/);
  });

  it("gives a stable id for the same position every time", () => {
    const hongKong = geo(22.3193, 114.1694);
    expect(sectorIdAt(hongKong)).toBe(sectorIdAt(hongKong));
    expect(sectorIdAt(hongKong)).toBe(sectorIdAt({ ...hongKong, altitudeMeters: 5000 }));
  });

  it("puts a sector centre back into its own sector", () => {
    for (const address of allSectors()) {
      expect(sectorAt(sectorCentre(address))).toEqual(address);
    }
  });

  it("uses every face rather than crowding onto one", () => {
    const faces = new Set(allSectors().map((address) => sectorAt(sectorCentre(address)).face));
    expect(faces.size).toBe(CUBE_FACES.length);
  });
});

describe("neighbour lookup", () => {
  it("gives every sector on the planet four distinct neighbours", () => {
    for (const address of allSectors()) {
      const neighbors = sectorNeighbors(address);
      expect(neighbors, `${sectorId(address)} neighbour count`).toHaveLength(4);
      expect(new Set(neighbors.map(sectorId)).size).toBe(4);
      expect(neighbors.map(sectorId)).not.toContain(sectorId(address));
    }
  });

  it("is symmetric everywhere, including across cube edges and at corners", () => {
    const asymmetric: string[] = [];
    for (const address of allSectors()) {
      const id = sectorId(address);
      for (const neighborId of neighborIds(id)) {
        if (!neighborIds(neighborId).includes(id)) asymmetric.push(`${id} -> ${neighborId}`);
      }
    }
    // Reprojection has to hold up at the eight cube corners too, not just mid-edge.
    expect(asymmetric).toEqual([]);
  });

  it("crosses faces at the seams rather than stopping at them", () => {
    const edge = { face: "+X" as const, u: 0, v: 8 };
    const faces = new Set(sectorNeighbors(edge).map((n) => n.face));
    expect(faces.size).toBeGreaterThan(1);
  });

  it("keeps neighbours adjacent in space, not merely in index", () => {
    const span = approximateSectorSpanMeters();
    for (const address of allSectors()) {
      const centre = sectorCentre(address);
      for (const neighbor of sectorNeighbors(address)) {
        const distance = surfaceDistanceMeters(centre, sectorCentre(neighbor));
        // A true neighbour sits roughly one sector away; a bad reprojection would
        // land somewhere across the planet.
        expect(distance, `${sectorId(address)} -> ${sectorId(neighbor)}`).toBeLessThan(span * 2.5);
      }
    }
  });

  it("reaches the whole globe by walking neighbours from one sector", () => {
    const start = sectorId({ face: "+X", u: 0, v: 0 });
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.pop() as string;
      for (const next of neighborIds(current)) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    // A partition with an unreachable island would strand streaming.
    expect(seen.size).toBe(SECTOR_COUNT);
  });
});

describe("sector geometry", () => {
  it("keeps sector sizes within a small factor of each other", () => {
    const spans = allSectors()
      .filter((_, index) => index % 37 === 0)
      .map((address) => {
        const neighbors = sectorNeighbors(address);
        const centre = sectorCentre(address);
        return Math.min(...neighbors.map((n) => surfaceDistanceMeters(centre, sectorCentre(n))));
      });
    const smallest = Math.min(...spans);
    const largest = Math.max(...spans);
    // Measured 1.35 with the tangent adjustment in place, against 2.31 without
    // it. This bound is what keeps that adjustment from being removed silently.
    // A latitude/longitude grid would fail this far worse near the poles.
    expect(largest / smallest).toBeLessThan(1.5);
  });

  it("reports a sector span in a sane range for streaming", () => {
    const span = approximateSectorSpanMeters();
    expect(span).toBeGreaterThan(1_000);
    expect(span).toBeLessThan(100_000);
  });
});
