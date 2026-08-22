import {
  ecefToGeo,
  geoToEcef,
  WORLD_RADIUS_METERS,
  type EcefPosition,
  type GeoPosition,
} from "./coordinates";

/**
 * Cube-sphere partition of the globe.
 *
 * Six cube faces are each divided into a square grid, then projected onto the
 * sphere. Unlike a latitude/longitude grid this has no polar singularity and no
 * cells that shrink to nothing, so sector sizes stay within a small factor of
 * each other everywhere on the planet.
 */

export const CUBE_FACES = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"] as const;
export type CubeFace = (typeof CUBE_FACES)[number];

/** Cells per face edge. 16 gives 1536 sectors of roughly 11 km across at this globe's radius. */
export const SECTOR_GRID_RESOLUTION = 16;
export const SECTOR_COUNT = CUBE_FACES.length * SECTOR_GRID_RESOLUTION * SECTOR_GRID_RESOLUTION;

/** Stable, human-readable, and directly parseable back into its parts. */
export type SectorId = string;

export interface SectorAddress {
  readonly face: CubeFace;
  readonly u: number;
  readonly v: number;
}

/**
 * Face bases. `right` and `up` span the face; `normal` points out of it. Held as
 * data so face handling is table-driven rather than a switch on a face name.
 */
const FACE_BASIS: Readonly<
  Record<CubeFace, { normal: EcefPosition; right: EcefPosition; up: EcefPosition }>
> = {
  "+X": { normal: { x: 1, y: 0, z: 0 }, right: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } },
  "-X": { normal: { x: -1, y: 0, z: 0 }, right: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 } },
  "+Y": { normal: { x: 0, y: 1, z: 0 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  "-Y": { normal: { x: 0, y: -1, z: 0 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: -1 } },
  "+Z": { normal: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
  "-Z": { normal: { x: 0, y: 0, z: -1 }, right: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
};

function dot(a: EcefPosition, b: EcefPosition): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(v: EcefPosition): EcefPosition {
  const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (length === 0) return { x: 0, y: 1, z: 0 };
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

export function sectorId(address: SectorAddress): SectorId {
  return `${address.face}/${address.u}/${address.v}`;
}

export function parseSectorId(id: SectorId): SectorAddress {
  const parts = id.split("/");
  const [face, rawU, rawV] = parts;
  if (parts.length !== 3 || !CUBE_FACES.includes(face as CubeFace)) {
    throw new Error(
      `Malformed sector id "${id}"; expected "<face>/<u>/<v>" with face in ${CUBE_FACES.join(", ")}`,
    );
  }
  const u = Number(rawU);
  const v = Number(rawV);
  if (!Number.isInteger(u) || !Number.isInteger(v) || !inRange(u) || !inRange(v)) {
    throw new Error(
      `Sector id "${id}" has out-of-range cell indices; both must be integers within [0, ${SECTOR_GRID_RESOLUTION - 1}]`,
    );
  }
  return { face: face as CubeFace, u, v };
}

function inRange(index: number): boolean {
  return index >= 0 && index < SECTOR_GRID_RESOLUTION;
}

/**
 * Tangent adjustment.
 *
 * Projecting an evenly spaced grid straight onto the sphere leaves corner cells
 * far larger than face-centre cells: measured at 2.3x across this grid. Warping
 * the grid through tan before projection makes the angular step near-uniform,
 * which brings the spread down to about 1.3x. Sector cost then varies little
 * with where you are on the planet, which is what streaming budgets need.
 */
function warpGridToFace(gridCoordinate: number): number {
  return Math.tan((gridCoordinate * Math.PI) / 4);
}

function unwarpFaceToGrid(faceCoordinate: number): number {
  return (Math.atan(faceCoordinate) * 4) / Math.PI;
}

/** Unit direction from the globe centre through a point on a face, given grid coordinates in [-1, 1]. */
function faceToDirection(face: CubeFace, s: number, t: number): EcefPosition {
  const basis = FACE_BASIS[face];
  const ws = warpGridToFace(s);
  const wt = warpGridToFace(t);
  return normalize({
    x: basis.normal.x + basis.right.x * ws + basis.up.x * wt,
    y: basis.normal.y + basis.right.y * ws + basis.up.y * wt,
    z: basis.normal.z + basis.right.z * ws + basis.up.z * wt,
  });
}

/** Picks the face a direction belongs to and returns its face coordinates. */
function directionToFace(direction: EcefPosition): { face: CubeFace; s: number; t: number } {
  let bestFace: CubeFace = "+X";
  let bestDot = -Infinity;
  for (const face of CUBE_FACES) {
    const value = dot(direction, FACE_BASIS[face].normal);
    if (value > bestDot) {
      bestDot = value;
      bestFace = face;
    }
  }
  const basis = FACE_BASIS[bestFace];
  // Dividing by the normal component reprojects the ray onto the unit cube face,
  // then unwarping returns it to the evenly spaced grid space.
  return {
    face: bestFace,
    s: unwarpFaceToGrid(dot(direction, basis.right) / bestDot),
    t: unwarpFaceToGrid(dot(direction, basis.up) / bestDot),
  };
}

function cellIndex(faceCoordinate: number): number {
  const normalized = (faceCoordinate + 1) / 2;
  const index = Math.floor(normalized * SECTOR_GRID_RESOLUTION);
  return Math.min(SECTOR_GRID_RESOLUTION - 1, Math.max(0, index));
}

function cellCentreCoordinate(index: number): number {
  return ((index + 0.5) / SECTOR_GRID_RESOLUTION) * 2 - 1;
}

export function sectorAt(position: GeoPosition): SectorAddress {
  const { face, s, t } = directionToFace(normalize(geoToEcef({ ...position, altitudeMeters: 0 })));
  return { face, u: cellIndex(s), v: cellIndex(t) };
}

export function sectorIdAt(position: GeoPosition): SectorId {
  return sectorId(sectorAt(position));
}

/** Geodetic centre of a sector, at ground level. */
export function sectorCentre(address: SectorAddress): GeoPosition {
  const direction = faceToDirection(
    address.face,
    cellCentreCoordinate(address.u),
    cellCentreCoordinate(address.v),
  );
  return ecefToGeo({
    x: direction.x * WORLD_RADIUS_METERS,
    y: direction.y * WORLD_RADIUS_METERS,
    z: direction.z * WORLD_RADIUS_METERS,
  });
}

/**
 * A point inside a sector, given cell-relative coordinates in [0, 1].
 *
 * Terrain generation samples a grid across a sector and needs every sample as a
 * real position on the globe. Doing that here keeps face bases and the tangent
 * adjustment in one module: a second implementation would drift out of sync and
 * seam sectors against each other.
 */
export function sectorSurfacePoint(
  address: SectorAddress,
  s01: number,
  t01: number,
  altitudeMeters = 0,
): EcefPosition {
  const s = ((address.u + s01) / SECTOR_GRID_RESOLUTION) * 2 - 1;
  const t = ((address.v + t01) / SECTOR_GRID_RESOLUTION) * 2 - 1;
  const direction = faceToDirection(address.face, s, t);
  const radius = WORLD_RADIUS_METERS + altitudeMeters;
  return { x: direction.x * radius, y: direction.y * radius, z: direction.z * radius };
}

export interface SectorGridCoordinates {
  readonly address: SectorAddress;
  /** Position within the sector cell, both in [0, 1]. */
  readonly s01: number;
  readonly t01: number;
}

/**
 * Inverse of {@link sectorSurfacePoint}: which sector a position falls in, and
 * where inside that cell. Used to sample a sector's height field at an arbitrary
 * point, which is how ground collision is read.
 */
export function sectorGridCoordinates(position: GeoPosition): SectorGridCoordinates {
  const { face, s, t } = directionToFace(normalize(geoToEcef({ ...position, altitudeMeters: 0 })));
  const u = cellIndex(s);
  const v = cellIndex(t);
  const cellSpan = 2 / SECTOR_GRID_RESOLUTION;
  const cellOrigin = (index: number): number => (index / SECTOR_GRID_RESOLUTION) * 2 - 1;
  return {
    address: { face, u, v },
    s01: clamp01((s - cellOrigin(u)) / cellSpan),
    t01: clamp01((t - cellOrigin(v)) / cellSpan),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

const EDGE_STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Edge steps plus the four diagonals, for filling a square neighbourhood. */
const SURROUNDING_STEPS: readonly (readonly [number, number])[] = [
  ...EDGE_STEPS,
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * Steps one cell from `address` by (du, dv), following the surface across face
 * boundaries. Off-face steps are resolved by projecting the stepped point back
 * onto the sphere and asking which face it lands on, rather than by a
 * hand-written table of 24 edge adjacencies. One rule covers every face, edge
 * and rotation, and it cannot fall out of sync with the face bases above.
 */
function stepSector(address: SectorAddress, du: number, dv: number): SectorAddress {
  const u = address.u + du;
  const v = address.v + dv;
  if (inRange(u) && inRange(v)) return { face: address.face, u, v };

  const step = 2 / SECTOR_GRID_RESOLUTION;
  const stepped = faceToDirection(
    address.face,
    cellCentreCoordinate(address.u) + du * step,
    cellCentreCoordinate(address.v) + dv * step,
  );
  const projected = directionToFace(stepped);
  return { face: projected.face, u: cellIndex(projected.s), v: cellIndex(projected.t) };
}

/** The four edge-adjacent sectors. */
export function sectorNeighbors(address: SectorAddress): readonly SectorAddress[] {
  return steppedNeighbors(address, EDGE_STEPS);
}

/** The eight surrounding sectors, edges and corners. */
export function sectorSurroundings(address: SectorAddress): readonly SectorAddress[] {
  return steppedNeighbors(address, SURROUNDING_STEPS);
}

function steppedNeighbors(
  address: SectorAddress,
  steps: readonly (readonly [number, number])[],
): readonly SectorAddress[] {
  const neighbors: SectorAddress[] = [];
  const seen = new Set<SectorId>([sectorId(address)]);

  for (const [du, dv] of steps) {
    const neighbor = stepSector(address, du, dv);
    const id = sectorId(neighbor);
    // Near a cube corner two different steps can land on the same cell, and the
    // caller must not be handed a duplicate.
    if (!seen.has(id)) {
      seen.add(id);
      neighbors.push(neighbor);
    }
  }
  return neighbors;
}

export function neighborIds(id: SectorId): readonly SectorId[] {
  return sectorNeighbors(parseSectorId(id)).map(sectorId);
}

/**
 * Breadth-first ring expansion from a sector: every sector within `maxDepth`
 * steps, mapped to the number of steps it took to reach it.
 *
 * Expansion goes through the eight surrounding sectors, not the four
 * edge-adjacent ones. Edge-only expansion produces diamond-shaped rings, which
 * leave the four corners of the loaded area empty: on screen that is a black
 * notch in the middle distance where the ground simply stops. Including the
 * diagonals makes each ring a square, which is what a viewer expects a loaded
 * area to look like.
 *
 * Streaming rings are defined in steps rather than in metres because steps are
 * what the partition actually guarantees, and stepping through the shared
 * projection means rings cross face boundaries correctly for free.
 */
export function sectorsWithinDepth(address: SectorAddress, maxDepth: number): Map<SectorId, number> {
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new Error(`sectorsWithinDepth needs a non-negative integer depth, got ${maxDepth}`);
  }
  const depths = new Map<SectorId, number>([[sectorId(address), 0]]);
  let frontier: SectorAddress[] = [address];

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const next: SectorAddress[] = [];
    for (const current of frontier) {
      for (const neighbor of sectorSurroundings(current)) {
        const id = sectorId(neighbor);
        if (depths.has(id)) continue;
        depths.set(id, depth);
        next.push(neighbor);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return depths;
}

/** Every sector on the globe, in a stable order. */
export function allSectors(): readonly SectorAddress[] {
  const sectors: SectorAddress[] = [];
  for (const face of CUBE_FACES) {
    for (let u = 0; u < SECTOR_GRID_RESOLUTION; u += 1) {
      for (let v = 0; v < SECTOR_GRID_RESOLUTION; v += 1) sectors.push({ face, u, v });
    }
  }
  return sectors;
}

/** Rough edge length of a sector in metres, for streaming budgets. */
export function approximateSectorSpanMeters(): number {
  return (2 * Math.PI * WORLD_RADIUS_METERS) / (4 * SECTOR_GRID_RESOLUTION);
}
