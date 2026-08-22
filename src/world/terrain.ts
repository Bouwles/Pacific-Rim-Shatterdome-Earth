import { createSeededRng, hashStringToSeed } from "../simulation/rng";
import { surfaceClassIndex, climateForLatitude, createBiomeRegistry } from "../data/biomes";
import type { BiomeDefinition } from "../data/biomes";
import { ecefToGeo, geoToEcef, type EcefPosition, type GeoPosition } from "./coordinates";
import { parseSectorId, sectorSurfacePoint, type SectorAddress, type SectorId } from "./cubeSphere";
import type { ClimateZone } from "./regions";
import { fbm3, ridged3 } from "./terrainNoise";

/**
 * Procedural sector terrain.
 *
 * Everything here is derived from the world seed and the sector id: nothing is
 * random at run time, nothing depends on generation order, and nothing depends
 * on what was generated before it. That is what lets a sector be thrown away and
 * regenerated later without the world changing under the player.
 *
 * No geographic accuracy is claimed or attempted. The generator knows the
 * latitude of a sample and a seeded moisture field, and nothing else. Real
 * coastlines, mountain ranges, rivers and city footprints are not reproduced.
 * Named regions get a shaped land shelf so a Shatterdome is not underwater; that
 * shelf is gameplay furniture, not cartography.
 *
 * Pure data and arithmetic: no Babylon, no DOM, and safe to run inside a worker.
 */

const BIOMES = createBiomeRegistry();

export const TERRAIN_SCHEMA_VERSION = 1;

export const LOD_LEVELS = [0, 1, 2, 3] as const;
export type LodLevel = (typeof LOD_LEVELS)[number];

/** Vertices along one edge of a sector at each level of detail. */
export const LOD_GRID_RESOLUTION: Readonly<Record<LodLevel, number>> = { 0: 33, 1: 17, 2: 9, 3: 5 };

/** The coarsest level of detail that still carries a collision height field. */
export const COLLISION_LOD: LodLevel = 1;
const COLLISION_RESOLUTION = 17;

/** Level of detail at which city cells, lanes and landmarks stop being generated. */
const DETAIL_SCALE: Readonly<Record<LodLevel, number>> = { 0: 1, 1: 0.5, 2: 0.2, 3: 0 };

const SEA_LEVEL_MASK = 0.5;
/**
 * Land mask a populated region is pulled to.
 *
 * Chosen by measurement across all eight regions: high enough that every named
 * region has dry ground for its whole populated radius, low enough that the
 * shelf reads as coastal plain rather than plateau. At 0.56 city ground sits
 * between 153 m and 403 m and six of the eight regions keep a coastline; raising
 * it to 0.62 pushed those figures to 305 m to 810 m for no gain.
 */
export const LAND_MASK_TARGET = 0.56;
/** Land mask an ocean region is pulled toward: deep water, no chance of a mountain. */
export const OCEAN_MASK_TARGET = 0.4;
/** How far a region shapes the land around it, as a multiple of its own radius. */
const REGION_SHAPE_REACH = 1.8;
/** Fine relief added on land and on the seabed, metres either side of the base shape. */
const LAND_DETAIL_AMPLITUDE_METERS = 380;
const SEABED_DETAIL_AMPLITUDE_METERS = 90;

/**
 * A place whose terrain is dictated by authored content rather than by noise.
 *
 * Two things go wrong without this. A Shatterdome ends up at the bottom of the
 * sea because the noise happened to put ocean there, and an open-ocean region
 * ends up as a 640 m mountain for the same reason in reverse. Both were measured
 * on this seed before anchors carried a target. The anchor states what the
 * region already claims to be and the generator honours it.
 */
export interface TerrainAnchor {
  readonly regionId: string;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly radiusMeters: number;
  readonly populationThousands: number;
  /** Land mask value inside this anchor's reach. Above SEA_LEVEL_MASK is land. */
  readonly maskTarget: number;
  /** Authored climate. Overrides the latitude band for sectors this anchor covers. */
  readonly climate: ClimateZone;
  /** False for ocean and wilderness: no city cells, no lanes. */
  readonly populated: boolean;
}

export interface TerrainRequestParams {
  readonly sectorId: SectorId;
  readonly lod: LodLevel;
  readonly seed: number;
  readonly anchors: readonly TerrainAnchor[];
}

/** One instanced building footprint, positioned in ECEF so it is anchor-independent. */
export interface CityCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly footprintMeters: number;
  readonly heightMeters: number;
  readonly rotationRadians: number;
}

export interface Landmark {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heightMeters: number;
}

/**
 * A road or shipping lane as a polyline of ECEF points, plus how many traffic
 * markers to distribute along it. The markers are static representations of
 * traffic density, not moving vehicles and not an AI system.
 */
export interface TrafficLane {
  readonly points: Float64Array;
  readonly markerCount: number;
}

export interface CollisionField {
  readonly resolution: number;
  readonly heights: Float32Array;
}

export interface SectorTerrain {
  readonly schemaVersion: number;
  readonly cacheKey: string;
  readonly sectorId: SectorId;
  readonly lod: LodLevel;
  readonly gridResolution: number;
  /** ECEF metres, three per vertex, row-major with `s` varying fastest. */
  readonly positions: Float64Array;
  /** Elevation above sea level per vertex, metres. */
  readonly heights: Float32Array;
  /** Index into SURFACE_CLASSES per vertex. */
  readonly surfaces: Uint8Array;
  readonly biomeId: ClimateZone;
  readonly climate: ClimateZone;
  /** True when the sector holds both land and water, which is what makes a coast. */
  readonly coastline: boolean;
  readonly waterFraction: number;
  readonly meanElevationMeters: number;
  readonly minElevationMeters: number;
  readonly maxElevationMeters: number;
  readonly cityCells: readonly CityCell[];
  readonly landmarks: readonly Landmark[];
  readonly trafficLanes: readonly TrafficLane[];
  readonly collision: CollisionField | null;
  readonly estimatedBytes: number;
  /** Content digest. Two generations of the same cache key must produce the same value. */
  readonly digest: number;
}

/**
 * Deterministic cache key.
 *
 * Carries everything that can change the bytes: the schema, the world seed, the
 * sector, and the level of detail. Two requests with the same key are guaranteed
 * to be interchangeable, which is what makes it safe to skip generation on a
 * cache hit.
 */
export function terrainCacheKey(params: TerrainRequestParams): string {
  return `t${TERRAIN_SCHEMA_VERSION}|s${params.seed >>> 0}|${params.sectorId}|lod${params.lod}`;
}

export function validateTerrainRequest(params: TerrainRequestParams): string[] {
  const errors: string[] = [];
  try {
    parseSectorId(params.sectorId);
  } catch (error) {
    errors.push((error as Error).message);
  }
  if (!LOD_LEVELS.includes(params.lod)) {
    errors.push(`lod must be one of ${LOD_LEVELS.join(", ")}, got ${String(params.lod)}`);
  }
  if (!Number.isFinite(params.seed)) errors.push("seed must be a finite number");
  if (!Array.isArray(params.anchors)) {
    errors.push("anchors must be an array");
    return errors;
  }
  // A non-finite mask target poisons every sample it touches and comes back as a
  // sector of NaN heights, which renders as nothing at all rather than as an
  // error. Caught here so the cause is named instead of the symptom.
  for (const anchor of params.anchors) {
    for (const key of ["latitudeDeg", "longitudeDeg", "radiusMeters", "maskTarget"] as const) {
      if (!Number.isFinite(anchor[key])) {
        errors.push(`anchor "${anchor.regionId}".${key} must be a finite number, got ${String(anchor[key])}`);
      }
    }
    if (!BIOMES.has(anchor.climate)) {
      errors.push(`anchor "${anchor.regionId}".climate "${String(anchor.climate)}" has no biome`);
    }
  }
  return errors;
}

interface NoiseSeeds {
  readonly continent: number;
  readonly regional: number;
  readonly detail: number;
  readonly ridge: number;
  readonly moisture: number;
}

function noiseSeeds(seed: number): NoiseSeeds {
  const base = seed >>> 0;
  return {
    continent: (base ^ hashStringToSeed("terrain.continent")) >>> 0,
    regional: (base ^ hashStringToSeed("terrain.regional")) >>> 0,
    detail: (base ^ hashStringToSeed("terrain.detail")) >>> 0,
    ridge: (base ^ hashStringToSeed("terrain.ridge")) >>> 0,
    moisture: (base ^ hashStringToSeed("terrain.moisture")) >>> 0,
  };
}

/** Angular distance between two unit directions, in metres on the globe surface. */
function angularMeters(a: EcefPosition, b: EcefPosition, radius: number): number {
  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  return Math.acos(dot) * radius;
}

function unit(point: EcefPosition): EcefPosition {
  const length = Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z) || 1;
  return { x: point.x / length, y: point.y / length, z: point.z / length };
}

interface AnchorDirection extends TerrainAnchor {
  readonly direction: EcefPosition;
}

/**
 * Blends the raw land mask toward a shelf value near a named region.
 *
 * Written as a blend rather than an addition on purpose: adding a bump would put
 * every city on a hill whose height depended on whatever the noise happened to
 * be doing there, and would stack where two regions are close together.
 */
function shapeMaskForRegions(
  mask: number,
  direction: EcefPosition,
  anchors: readonly AnchorDirection[],
  radius: number,
): number {
  let shaped = mask;
  for (const anchor of anchors) {
    const inner = anchor.radiusMeters;
    const reach = inner * REGION_SHAPE_REACH;
    const distance = angularMeters(direction, anchor.direction, radius);
    if (distance >= reach) continue;

    // Full strength across the whole populated radius, then falling off to the
    // surrounding noise. A falloff that started at the centre left only the
    // innermost few hundred metres above water where the underlying field was
    // oceanic: Anchorage came out as a 500 m island inside a 3.5 km city, and
    // every candidate building site was rejected as sea.
    const weight = distance <= inner ? 1 : (1 - (distance - inner) / (reach - inner)) ** 2;
    shaped = shaped * (1 - weight) + anchor.maskTarget * weight;
  }
  return shaped;
}

/**
 * The anchor whose authored identity covers this sector, if any. Authored content
 * beats a generated latitude band: a region that calls itself subarctic must not
 * render as temperate because its sector centre drifted across a band edge.
 */
function governingAnchor(
  centre: EcefPosition,
  anchors: readonly AnchorDirection[],
  radius: number,
): AnchorDirection | undefined {
  let best: AnchorDirection | undefined;
  let bestDistance = Infinity;
  for (const anchor of anchors) {
    const distance = angularMeters(centre, anchor.direction, radius);
    if (distance > anchor.radiusMeters * REGION_SHAPE_REACH || distance >= bestDistance) continue;
    best = anchor;
    bestDistance = distance;
  }
  return best;
}

interface SampleFields {
  readonly elevationMeters: number;
  readonly moisture: number;
}

/**
 * Elevation at one point.
 *
 * Deliberately independent of biome. Climate is resolved per sector, so letting
 * it touch elevation makes two adjacent sectors that land in different climate
 * bands disagree along their shared edge: measured at a 25.6 m step, which reads
 * as a wall running down a sector boundary. Height is one continuous global
 * field; biome only decides how that height is coloured and dressed.
 */
function sampleTerrain(
  direction: EcefPosition,
  seeds: NoiseSeeds,
  anchors: readonly AnchorDirection[],
  radius: number,
): SampleFields {
  const { x, y, z } = direction;
  const continent = fbm3(seeds.continent, x, y, z, { octaves: 5, frequency: 9 });
  const regional = fbm3(seeds.regional, x, y, z, { octaves: 4, frequency: 48 });
  const detail = fbm3(seeds.detail, x, y, z, { octaves: 4, frequency: 190 });
  const ridge = ridged3(seeds.ridge, x, y, z, { octaves: 4, frequency: 36 });
  const moisture = fbm3(seeds.moisture, x, y, z, { octaves: 3, frequency: 22 });

  const rawMask = continent * 0.62 + regional * 0.28 + detail * 0.1;
  const mask = shapeMaskForRegions(rawMask, direction, anchors, radius);
  const signed = (mask - SEA_LEVEL_MASK) * 2;

  const elevationMeters =
    signed >= 0
      ? signed * (900 + ridge ** 3 * 2_600) + (detail - 0.5) * LAND_DETAIL_AMPLITUDE_METERS
      : signed * 3_000 - (detail - 0.5) * SEABED_DETAIL_AMPLITUDE_METERS;

  return { elevationMeters, moisture };
}

/**
 * Resolves a sector's climate from its latitude, then lets a dry moisture field
 * override the mid-latitude bands into arid. Latitude alone would make every
 * coast at the same latitude look identical.
 */
function resolveClimate(centre: GeoPosition, moisture: number): ClimateZone {
  const banded = climateForLatitude(centre.latitudeDeg);
  const absolute = Math.abs(centre.latitudeDeg);
  if (moisture < 0.36 && absolute >= 12 && absolute <= 42) return "arid";
  return banded;
}

function fnv1a(hash: number, value: number): number {
  let h = hash ^ (value | 0);
  h = Math.imul(h, 0x01000193);
  return h >>> 0;
}

function digestOf(terrain: Omit<SectorTerrain, "digest" | "estimatedBytes">): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < terrain.cacheKey.length; i += 1) hash = fnv1a(hash, terrain.cacheKey.charCodeAt(i));
  // Quantised so a rebuild that differs only in floating-point noise still matches.
  for (const height of terrain.heights) hash = fnv1a(hash, Math.round(height * 100));
  for (const surface of terrain.surfaces) hash = fnv1a(hash, surface);
  hash = fnv1a(hash, terrain.cityCells.length);
  hash = fnv1a(hash, terrain.landmarks.length);
  hash = fnv1a(hash, terrain.trafficLanes.length);
  for (const cell of terrain.cityCells) {
    hash = fnv1a(hash, Math.round(cell.heightMeters * 10));
    hash = fnv1a(hash, Math.round(cell.footprintMeters * 10));
  }
  return hash >>> 0;
}

function estimateBytes(terrain: Omit<SectorTerrain, "digest" | "estimatedBytes">): number {
  let bytes =
    terrain.positions.byteLength +
    terrain.heights.byteLength +
    terrain.surfaces.byteLength +
    terrain.cacheKey.length * 2;
  // Object headers dominate small records, so count generously rather than
  // pretending a city cell costs only its six numbers.
  bytes += terrain.cityCells.length * 64;
  bytes += terrain.landmarks.length * 64;
  for (const lane of terrain.trafficLanes) bytes += lane.points.byteLength + 48;
  if (terrain.collision) bytes += terrain.collision.heights.byteLength + 32;
  return bytes;
}

export function generateSectorTerrain(params: TerrainRequestParams): SectorTerrain {
  const errors = validateTerrainRequest(params);
  if (errors.length > 0) {
    throw new Error(`Cannot generate terrain for "${params.sectorId}": ${errors.join("; ")}`);
  }

  const address = parseSectorId(params.sectorId);
  const cacheKey = terrainCacheKey(params);
  const seeds = noiseSeeds(params.seed);
  const resolution = LOD_GRID_RESOLUTION[params.lod];

  const centreEcef = sectorSurfacePoint(address, 0.5, 0.5);
  const radius = Math.sqrt(centreEcef.x ** 2 + centreEcef.y ** 2 + centreEcef.z ** 2);
  const centreGeo = ecefToGeo(centreEcef);
  const centreDirection = unit(centreEcef);

  const anchors: readonly AnchorDirection[] = params.anchors.map((anchor) => ({
    ...anchor,
    direction: unit(
      geoToEcef({
        latitudeDeg: anchor.latitudeDeg,
        longitudeDeg: anchor.longitudeDeg,
        altitudeMeters: 0,
      }),
    ),
  }));

  // Climate is a property of the sector, not of each vertex: a sector is 11 km
  // across and climate bands are thousands of kilometres wide.
  const centreMoisture = fbm3(seeds.moisture, centreDirection.x, centreDirection.y, centreDirection.z, {
    octaves: 3,
    frequency: 22,
  });
  const governing = governingAnchor(centreDirection, anchors, radius);
  const climate = governing?.climate ?? resolveClimate(centreGeo, centreMoisture);
  const biome = BIOMES.getOrThrow(climate);

  const vertexCount = resolution * resolution;
  const positions = new Float64Array(vertexCount * 3);
  const heights = new Float32Array(vertexCount);
  const surfaces = new Uint8Array(vertexCount);

  let waterSamples = 0;
  let elevationSum = 0;
  let minElevation = Number.POSITIVE_INFINITY;
  let maxElevation = Number.NEGATIVE_INFINITY;

  for (let j = 0; j < resolution; j += 1) {
    const t01 = j / (resolution - 1);
    for (let i = 0; i < resolution; i += 1) {
      const s01 = i / (resolution - 1);
      const surfacePoint = sectorSurfacePoint(address, s01, t01);
      const direction = unit(surfacePoint);
      const { elevationMeters } = sampleTerrain(direction, seeds, anchors, radius);

      const index = j * resolution + i;
      heights[index] = elevationMeters;
      surfaces[index] = surfaceClassIndex(elevationMeters);

      // Water is drawn as a flat sheet at sea level, so the ground under it keeps
      // its real depth rather than being clamped and losing the seabed shape.
      const vertexRadius = radius + elevationMeters;
      positions[index * 3] = direction.x * vertexRadius;
      positions[index * 3 + 1] = direction.y * vertexRadius;
      positions[index * 3 + 2] = direction.z * vertexRadius;

      if (elevationMeters < 0) waterSamples += 1;
      elevationSum += elevationMeters;
      if (elevationMeters < minElevation) minElevation = elevationMeters;
      if (elevationMeters > maxElevation) maxElevation = elevationMeters;
    }
  }

  const waterFraction = waterSamples / vertexCount;
  const detailScale = DETAIL_SCALE[params.lod];
  const rng = createSeededRng(hashStringToSeed(cacheKey));

  const cityCells = generateCityCells(address, anchors, radius, detailScale, rng, seeds);
  const trafficLanes = generateTrafficLanes(cityCells, radius, detailScale, rng);
  const landmarks = generateLandmarks(address, heights, resolution, detailScale, biome, rng);

  const collision =
    params.lod <= COLLISION_LOD
      ? buildCollisionField(heights, resolution, Math.min(resolution, COLLISION_RESOLUTION))
      : null;

  const partial = {
    schemaVersion: TERRAIN_SCHEMA_VERSION,
    cacheKey,
    sectorId: params.sectorId,
    lod: params.lod,
    gridResolution: resolution,
    positions,
    heights,
    surfaces,
    biomeId: biome.id,
    climate,
    coastline: waterFraction > 0.02 && waterFraction < 0.98,
    waterFraction,
    meanElevationMeters: elevationSum / vertexCount,
    minElevationMeters: minElevation,
    maxElevationMeters: maxElevation,
    cityCells,
    landmarks,
    trafficLanes,
    collision,
  } satisfies Omit<SectorTerrain, "digest" | "estimatedBytes">;

  return { ...partial, estimatedBytes: estimateBytes(partial), digest: digestOf(partial) };
}

/**
 * City cells are placed by rejection sampling inside the sector: draw a point,
 * keep it if it is inside a region's populated radius and above water. Sampling
 * in sector space rather than around the region centre means a city that spans a
 * sector boundary produces the right cells in each sector independently, with no
 * shared state between them.
 */
function generateCityCells(
  address: SectorAddress,
  anchors: readonly AnchorDirection[],
  radius: number,
  detailScale: number,
  rng: () => number,
  seeds: NoiseSeeds,
): readonly CityCell[] {
  if (detailScale <= 0 || anchors.length === 0) return [];

  const centre = unit(sectorSurfacePoint(address, 0.5, 0.5));
  const nearby = anchors.filter(
    (anchor) =>
      anchor.populated && angularMeters(centre, anchor.direction, radius) < anchor.radiusMeters + 12_000,
  );
  if (nearby.length === 0) return [];

  const budget = Math.round(
    Math.min(46, Math.max(6, nearby.reduce((sum, a) => sum + a.populationThousands, 0) / 420)) * detailScale,
  );
  if (budget <= 0) return [];

  const cells: CityCell[] = [];
  const maxAttempts = budget * 12;
  for (let attempt = 0; attempt < maxAttempts && cells.length < budget; attempt += 1) {
    const s01 = rng();
    const t01 = rng();
    const surfacePoint = sectorSurfacePoint(address, s01, t01);
    const direction = unit(surfacePoint);

    const anchor = nearby.find(
      (candidate) => angularMeters(direction, candidate.direction, radius) < candidate.radiusMeters,
    );
    if (!anchor) continue;

    const { elevationMeters } = sampleTerrain(direction, seeds, anchors, radius);
    if (elevationMeters <= 2) continue;

    const scale = 0.4 + rng() * 0.6;
    const vertexRadius = radius + elevationMeters;
    cells.push({
      x: direction.x * vertexRadius,
      y: direction.y * vertexRadius,
      z: direction.z * vertexRadius,
      footprintMeters: 60 + scale * 140,
      heightMeters: 40 + scale * scale * 320,
      rotationRadians: rng() * Math.PI,
    });
  }
  return cells;
}

/**
 * Lanes connect pairs of city cells. With no city there is no traffic, which is
 * the honest answer for an ocean sector rather than scattering markers on water.
 */
function generateTrafficLanes(
  cityCells: readonly CityCell[],
  radius: number,
  detailScale: number,
  rng: () => number,
): readonly TrafficLane[] {
  const laneCount = Math.round(3 * detailScale);
  if (laneCount <= 0 || cityCells.length < 2) return [];

  const lanes: TrafficLane[] = [];
  const segmentCount = 8;
  for (let lane = 0; lane < laneCount; lane += 1) {
    const from = cityCells[Math.floor(rng() * cityCells.length)];
    const to = cityCells[Math.floor(rng() * cityCells.length)];
    if (!from || !to || from === to) continue;

    const points = new Float64Array((segmentCount + 1) * 3);
    for (let step = 0; step <= segmentCount; step += 1) {
      const t = step / segmentCount;
      const blended = unit({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        z: from.z + (to.z - from.z) * t,
      });
      // Lanes sit slightly above the ground so they read as roads rather than
      // z-fighting with the terrain they follow.
      const laneRadius = radius + 12;
      points[step * 3] = blended.x * laneRadius;
      points[step * 3 + 1] = blended.y * laneRadius;
      points[step * 3 + 2] = blended.z * laneRadius;
    }
    lanes.push({ points, markerCount: 6 + Math.floor(rng() * 6) });
  }
  return lanes;
}

const LANDMARK_KINDS = ["comms-mast", "rig", "wreck", "watch-tower"] as const;

function generateLandmarks(
  address: SectorAddress,
  heights: Float32Array,
  resolution: number,
  detailScale: number,
  biome: BiomeDefinition,
  rng: () => number,
): readonly Landmark[] {
  if (detailScale < 1) return [];
  const budget = Math.round(2 * biome.scatterDensity + 1);

  const landmarks: Landmark[] = [];
  for (let attempt = 0; attempt < budget * 6 && landmarks.length < budget; attempt += 1) {
    const i = Math.floor(rng() * resolution);
    const j = Math.floor(rng() * resolution);
    const height = heights[j * resolution + i] ?? 0;
    if (height <= 8) continue;

    const point = sectorSurfacePoint(address, i / (resolution - 1), j / (resolution - 1), height);
    const kind = LANDMARK_KINDS[Math.floor(rng() * LANDMARK_KINDS.length)] ?? "comms-mast";
    landmarks.push({ kind, x: point.x, y: point.y, z: point.z, heightMeters: 60 + rng() * 90 });
  }
  return landmarks;
}

/** Downsamples the vertex heights into the coarse field used for ground collision. */
function buildCollisionField(
  heights: Float32Array,
  resolution: number,
  targetResolution: number,
): CollisionField {
  const field = new Float32Array(targetResolution * targetResolution);
  for (let j = 0; j < targetResolution; j += 1) {
    for (let i = 0; i < targetResolution; i += 1) {
      const sourceI = Math.round((i / (targetResolution - 1)) * (resolution - 1));
      const sourceJ = Math.round((j / (targetResolution - 1)) * (resolution - 1));
      field[j * targetResolution + i] = heights[sourceJ * resolution + sourceI] ?? 0;
    }
  }
  return { resolution: targetResolution, heights: field };
}

/**
 * Bilinear height lookup inside a collision field, with cell coordinates in
 * [0, 1]. Returns metres above sea level.
 */
export function sampleCollisionHeight(field: CollisionField, s01: number, t01: number): number {
  const n = field.resolution - 1;
  const x = Math.min(n, Math.max(0, s01)) * n;
  const y = Math.min(n, Math.max(0, t01)) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const j = Math.min(n - 1, Math.floor(y));
  const fx = x - i;
  const fy = y - j;

  const at = (a: number, b: number): number => field.heights[b * field.resolution + a] ?? 0;
  const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
  const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
  return top + (bottom - top) * fy;
}

/** Buffers a worker may hand over rather than copy. */
export function terrainTransferables(terrain: SectorTerrain): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [
    terrain.positions.buffer as ArrayBuffer,
    terrain.heights.buffer as ArrayBuffer,
    terrain.surfaces.buffer as ArrayBuffer,
  ];
  for (const lane of terrain.trafficLanes) buffers.push(lane.points.buffer as ArrayBuffer);
  if (terrain.collision) buffers.push(terrain.collision.heights.buffer as ArrayBuffer);
  return buffers;
}
