import { createSeededRng, hashStringToSeed } from "../simulation/rng";
import type { DistrictDefinition, DistrictKind, DistrictPlacement } from "../data/districts";

/**
 * City layout.
 *
 * Turns a district plan into the actual blocks, roads, lanes, zones and groups a
 * region is made of. Pure and deterministic: the same region id, seed and plan
 * always produce the same city, so nothing about it needs to be saved and it can
 * be rebuilt on demand exactly as it was.
 *
 * Positions are metres east and north from the region centre, never geodetic and
 * never in the floating-origin frame. The region centre does not move, so a
 * layout is stable for the life of the world and a rebase cannot disturb it.
 *
 * Two things this deliberately is not. It is not terrain-aware: heights come from
 * the streamed collision field at render time, because layout must not depend on
 * which sectors happen to be loaded. And it is not one mesh: blocks carry a
 * destruction group id so the renderer can build, stream and later damage the
 * city in pieces.
 *
 * No Babylon, no DOM. The district definitions are injected rather than
 * imported, so the world layer stays independent of the content layer.
 */

export const CITY_LAYOUT_SCHEMA_VERSION = 1;

/**
 * How wide a destruction group is. Blocks are bucketed onto this grid.
 *
 * A city twelve kilometres across split at 320 m produced over two hundred
 * groups, which meant a mid-range preset drawing its budget of groups covered a
 * patch rather than a city. 480 m is still a sensible unit of damage - roughly a
 * couple of city blocks - and brings the count to something a preset can cover.
 */
const DESTRUCTION_GRID_METERS = 480;
/** How far muster points may fan either side of straight inland, degrees. */
const MUSTER_SPREAD_DEG = 60;

export interface CityBlock {
  readonly id: string;
  readonly districtId: DistrictKind;
  readonly groupId: string;
  readonly east: number;
  readonly north: number;
  readonly widthMeters: number;
  readonly depthMeters: number;
  readonly heightMeters: number;
  readonly rotationRadians: number;
  /** Separate towers standing on this block. Slums stack several small ones. */
  readonly towerCount: number;
  /** True when this block shows lit signage after dark. */
  readonly neon: boolean;
}

export interface LandmarkSlot {
  readonly id: string;
  readonly kind: string;
  readonly districtId: DistrictKind;
  readonly east: number;
  readonly north: number;
  readonly heightMeters: number;
  readonly footprintMeters: number;
  readonly rotationRadians: number;
  /**
   * Asset manifest id this slot will host once a real model exists. Nothing
   * resolves it yet; it is the named slot the asset pipeline was built for.
   */
  readonly assetSlot: string;
}

export const ROAD_KINDS = ["arterial", "local", "approach"] as const;
export type RoadKind = (typeof ROAD_KINDS)[number];

export interface RoadSegment {
  readonly id: string;
  readonly kind: RoadKind;
  /** East/north pairs, metres from the region centre. */
  readonly points: Float64Array;
  readonly widthMeters: number;
  readonly laneCount: number;
  readonly lengthMeters: number;
}

export const HARBOR_LANE_KINDS = ["shipping", "ferry", "patrol"] as const;
export type HarborLaneKind = (typeof HARBOR_LANE_KINDS)[number];

export interface HarborLane {
  readonly id: string;
  readonly kind: HarborLaneKind;
  readonly points: Float64Array;
  readonly widthMeters: number;
  readonly lengthMeters: number;
}

export interface AirCorridor {
  readonly id: string;
  readonly points: Float64Array;
  readonly altitudeMeters: number;
  readonly lengthMeters: number;
}

export interface EvacuationZone {
  readonly id: string;
  readonly districtIds: readonly DistrictKind[];
  /** Where people are sent. Always on the high ground away from the water. */
  readonly musterEast: number;
  readonly musterNorth: number;
  readonly radiusMeters: number;
  readonly capacityThousands: number;
  /** 1 clears first. Taken from the districts it covers. */
  readonly priority: number;
}

export const DEFENSE_KINDS = ["missile", "wall", "checkpoint", "jaeger-pad"] as const;
export type DefenseKind = (typeof DEFENSE_KINDS)[number];

export interface DefensePosition {
  readonly id: string;
  readonly kind: DefenseKind;
  readonly east: number;
  readonly north: number;
  /** Radians clockwise from north. Points at the water for anything that shoots. */
  readonly facingRadians: number;
  readonly coverageMeters: number;
}

export interface DestructionGroup {
  readonly id: string;
  readonly districtId: DistrictKind;
  readonly blockIds: readonly string[];
  readonly centreEast: number;
  readonly centreNorth: number;
  readonly radiusMeters: number;
}

export const ROUTE_KINDS = ["walking", "jaeger"] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];

export interface DeploymentRoute {
  readonly id: string;
  readonly kind: RouteKind;
  readonly points: Float64Array;
  readonly widthMeters: number;
  readonly lengthMeters: number;
  readonly description: string;
}

export interface CityLayoutStats {
  readonly blockCount: number;
  readonly towerCount: number;
  readonly landmarkCount: number;
  readonly roadCount: number;
  readonly roadLengthMeters: number;
  readonly harborLaneCount: number;
  readonly evacuationCapacityThousands: number;
  readonly defenseCount: number;
  readonly destructionGroupCount: number;
}

export interface CityLayout {
  readonly schemaVersion: number;
  readonly regionId: string;
  readonly seed: number;
  readonly radiusMeters: number;
  /** Compass bearing of open water from the region centre, radians. */
  readonly seawardBearingRadians: number;
  readonly districts: readonly DistrictKind[];
  readonly blocks: readonly CityBlock[];
  readonly landmarks: readonly LandmarkSlot[];
  readonly roads: readonly RoadSegment[];
  readonly harborLanes: readonly HarborLane[];
  readonly airCorridors: readonly AirCorridor[];
  readonly evacuationZones: readonly EvacuationZone[];
  readonly defensePositions: readonly DefensePosition[];
  readonly destructionGroups: readonly DestructionGroup[];
  readonly routes: readonly DeploymentRoute[];
  readonly stats: CityLayoutStats;
  /** Content digest. Two generations of the same inputs must agree. */
  readonly digest: number;
}

export interface CityLayoutParams {
  readonly regionId: string;
  readonly seed: number;
  readonly radiusMeters: number;
  readonly seawardBearingDeg: number;
  readonly plan: readonly DistrictPlacement[];
  /** District rules, injected so the world layer never imports content. */
  readonly districts: ReadonlyMap<DistrictKind, DistrictDefinition>;
  /** Hard ceiling on blocks. Layout thins itself rather than blowing a budget. */
  readonly maxBlocks?: number;
}

const DEFAULT_MAX_BLOCKS = 1_400;

export function validateCityLayoutParams(params: CityLayoutParams): string[] {
  const errors: string[] = [];
  if (!params.regionId) errors.push("regionId required");
  if (!Number.isFinite(params.seed)) errors.push("seed must be a finite number");
  if (!Number.isFinite(params.radiusMeters) || params.radiusMeters <= 0) {
    errors.push("radiusMeters must be a positive number");
  }
  if (!Number.isFinite(params.seawardBearingDeg)) errors.push("seawardBearingDeg must be finite");
  if (params.plan.length === 0) errors.push("plan must place at least one district");
  for (const placement of params.plan) {
    if (!params.districts.has(placement.districtId)) {
      errors.push(`plan references district "${placement.districtId}" with no definition`);
    }
  }
  const max = params.maxBlocks ?? DEFAULT_MAX_BLOCKS;
  if (!Number.isInteger(max) || max <= 0) errors.push("maxBlocks must be a positive integer");
  return errors;
}

function fnv1a(hash: number, value: number): number {
  return Math.imul(hash ^ (value | 0), 0x01000193) >>> 0;
}

/** Bearing to a unit vector in the east/north plane. Zero points north. */
function bearingVector(radians: number): { east: number; north: number } {
  return { east: Math.sin(radians), north: Math.cos(radians) };
}

function polyLength(points: Float64Array): number {
  let total = 0;
  for (let index = 2; index < points.length; index += 2) {
    total += Math.hypot(
      (points[index] ?? 0) - (points[index - 2] ?? 0),
      (points[index + 1] ?? 0) - (points[index - 1] ?? 0),
    );
  }
  return total;
}

/**
 * Blocks are laid on a grid aligned to the district's own wedge rather than to
 * compass north, then jittered by the district's irregularity. A single global
 * grid would make every district read as the same city with different heights.
 */
function generateDistrictBlocks(
  placement: DistrictPlacement,
  district: DistrictDefinition,
  params: CityLayoutParams,
  rng: () => number,
  startIndex: number,
  budget: number,
): CityBlock[] {
  const blocks: CityBlock[] = [];
  const seaward = (params.seawardBearingDeg * Math.PI) / 180;
  const centreBearing = seaward + (placement.bearingOffsetDeg * Math.PI) / 180;
  const halfArc = (placement.arcDeg * Math.PI) / 360;
  const inner = placement.innerRadiusFraction * params.radiusMeters;
  const outer = placement.outerRadiusFraction * params.radiusMeters;

  const pitch = district.blockSizeMeters + district.streetWidthMeters;
  const rings = Math.max(1, Math.floor((outer - inner) / pitch));

  for (let ring = 0; ring < rings && blocks.length < budget; ring += 1) {
    const radius = inner + (ring + 0.5) * pitch;
    // Angular pitch shrinks with radius so block spacing stays roughly constant
    // rather than fanning out into gaps at the far edge of the wedge.
    const angularPitch = pitch / radius;
    const columns = Math.max(1, Math.floor((halfArc * 2) / angularPitch));

    for (let column = 0; column < columns && blocks.length < budget; column += 1) {
      if (rng() > district.coverage) continue;

      const bearing = centreBearing - halfArc + (column + 0.5) * angularPitch;
      const jitter = district.irregularity;
      const radialJitter = (rng() - 0.5) * pitch * jitter;
      const angularJitter = (rng() - 0.5) * angularPitch * jitter;
      const at = bearingVector(bearing + angularJitter);
      const distance = radius + radialJitter;

      const heightRoll = rng();
      // Heights fall off away from the district's inner edge, which is what makes
      // a skyline read as a skyline rather than a plateau of towers.
      const falloff = 1 - (radius - inner) / Math.max(1, outer - inner);
      const height =
        district.minHeightMeters +
        (district.maxHeightMeters - district.minHeightMeters) * heightRoll * (0.35 + falloff * 0.65);

      const index = startIndex + blocks.length;
      const east = at.east * distance;
      const north = at.north * distance;
      blocks.push({
        id: `${params.regionId}.block.${index}`,
        districtId: district.id,
        groupId: destructionGroupId(params.regionId, east, north),
        east,
        north,
        widthMeters: district.blockSizeMeters * (0.7 + rng() * 0.5),
        depthMeters: district.blockSizeMeters * (0.7 + rng() * 0.5),
        heightMeters: height,
        rotationRadians: bearing + (rng() - 0.5) * jitter,
        towerCount: district.towersPerBlock,
        neon: rng() < district.neonDensity,
      });
    }
  }
  return blocks;
}

function destructionGroupId(regionId: string, east: number, north: number): string {
  const gx = Math.floor(east / DESTRUCTION_GRID_METERS);
  const gy = Math.floor(north / DESTRUCTION_GRID_METERS);
  return `${regionId}.group.${gx}.${gy}`;
}

const LANDMARK_KINDS_BY_DISTRICT: Readonly<Partial<Record<DistrictKind, readonly string[]>>> = {
  shatterdome: ["shatterdome-hangar", "launch-gantry", "comms-spire"],
  docks: ["gantry-crane", "container-stack", "dry-dock"],
  downtown: ["signature-tower", "broadcast-mast"],
  waterfront: ["ferry-terminal", "harbour-arch"],
  slums: ["water-tower", "salvage-rig"],
  hillside: ["ridge-beacon"],
  industrial: ["foundry-stack"],
};

/** Manifest ids landmark slots will resolve to once real models exist. */
const LANDMARK_ASSET_SLOTS: Readonly<Record<string, string>> = {
  "shatterdome-hangar": "shatterdome.jaeger-bay",
  "launch-gantry": "shatterdome.launch-gantry",
  "comms-spire": "prop.comms-spire",
  "gantry-crane": "prop.gantry-crane",
  "container-stack": "prop.container-stack",
  "dry-dock": "shatterdome.dry-dock",
  "signature-tower": "building.signature-tower",
  "broadcast-mast": "prop.broadcast-mast",
  "ferry-terminal": "building.ferry-terminal",
  "harbour-arch": "prop.harbour-arch",
  "water-tower": "prop.water-tower",
  "salvage-rig": "prop.salvage-rig",
  "ridge-beacon": "prop.ridge-beacon",
  "foundry-stack": "prop.foundry-stack",
};

function generateLandmarks(params: CityLayoutParams, rng: () => number): LandmarkSlot[] {
  const slots: LandmarkSlot[] = [];
  const seaward = (params.seawardBearingDeg * Math.PI) / 180;

  for (const placement of params.plan) {
    const kinds = LANDMARK_KINDS_BY_DISTRICT[placement.districtId];
    const district = params.districts.get(placement.districtId);
    if (!kinds || !district) continue;

    for (const kind of kinds) {
      const bearing =
        seaward +
        (placement.bearingOffsetDeg * Math.PI) / 180 +
        ((rng() - 0.5) * placement.arcDeg * Math.PI) / 240;
      const distance =
        params.radiusMeters *
        (placement.innerRadiusFraction +
          rng() * (placement.outerRadiusFraction - placement.innerRadiusFraction));
      const at = bearingVector(bearing);
      slots.push({
        id: `${params.regionId}.landmark.${slots.length}`,
        kind,
        districtId: placement.districtId,
        east: at.east * distance,
        north: at.north * distance,
        // Landmarks stand above their district, which is what makes them
        // landmarks, but they are still buildings: at up to twice a block wide
        // the tallest came out as a cone half a kilometre across, which reads as
        // terrain rather than architecture.
        heightMeters: district.maxHeightMeters * (1.15 + rng() * 0.4),
        footprintMeters: district.blockSizeMeters * (0.55 + rng() * 0.35),
        rotationRadians: bearing,
        assetSlot: LANDMARK_ASSET_SLOTS[kind] ?? `prop.${kind}`,
      });
    }
  }
  return slots;
}

/**
 * Arterials run out from the centre, ring roads run around it, and every wedge
 * gets one. Roads are drawn as polylines rather than carved out of the block
 * grid: the blocks already leave streets between them, and a road here is the
 * line agents travel along.
 */
function generateRoads(params: CityLayoutParams, rng: () => number): RoadSegment[] {
  const roads: RoadSegment[] = [];
  const seaward = (params.seawardBearingDeg * Math.PI) / 180;

  for (const [index, placement] of params.plan.entries()) {
    const bearing = seaward + (placement.bearingOffsetDeg * Math.PI) / 180;
    const at = bearingVector(bearing);
    const inner = placement.innerRadiusFraction * params.radiusMeters;
    const outer = placement.outerRadiusFraction * params.radiusMeters;

    const steps = 6;
    const points = new Float64Array((steps + 1) * 2);
    for (let step = 0; step <= steps; step += 1) {
      const distance = inner + ((outer - inner) * step) / steps;
      const wobble = (rng() - 0.5) * 0.06;
      const point = bearingVector(bearing + wobble);
      points[step * 2] = point.east * distance;
      points[step * 2 + 1] = point.north * distance;
    }
    roads.push({
      id: `${params.regionId}.road.arterial.${index}`,
      kind: "arterial",
      points,
      widthMeters: 34,
      laneCount: 6,
      lengthMeters: polyLength(points),
    });
    void at;
  }

  // Two ring roads, at a third and two thirds of the region radius.
  for (const [index, fraction] of [0.34, 0.68].entries()) {
    const radius = params.radiusMeters * fraction;
    const steps = 28;
    const points = new Float64Array((steps + 1) * 2);
    for (let step = 0; step <= steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const point = bearingVector(angle);
      const wobble = 1 + (rng() - 0.5) * 0.08;
      points[step * 2] = point.east * radius * wobble;
      points[step * 2 + 1] = point.north * radius * wobble;
    }
    roads.push({
      id: `${params.regionId}.road.ring.${index}`,
      kind: "arterial",
      points,
      widthMeters: 28,
      laneCount: 4,
      lengthMeters: polyLength(points),
    });
  }
  return roads;
}

function generateHarborLanes(params: CityLayoutParams, rng: () => number): HarborLane[] {
  const lanes: HarborLane[] = [];
  const seaward = (params.seawardBearingDeg * Math.PI) / 180;

  const specs: readonly { kind: HarborLaneKind; offsetDeg: number; width: number }[] = [
    { kind: "shipping", offsetDeg: -18, width: 220 },
    { kind: "shipping", offsetDeg: 16, width: 220 },
    { kind: "ferry", offsetDeg: -2, width: 90 },
    { kind: "patrol", offsetDeg: 34, width: 70 },
  ];

  for (const [index, spec] of specs.entries()) {
    const steps = 10;
    const points = new Float64Array((steps + 1) * 2);
    for (let step = 0; step <= steps; step += 1) {
      // Lanes start just off the waterfront and run out past the region edge.
      const distance = params.radiusMeters * (0.2 + (step / steps) * 1.15);
      const bearing = seaward + ((spec.offsetDeg + (rng() - 0.5) * 4) * Math.PI) / 180;
      const point = bearingVector(bearing);
      points[step * 2] = point.east * distance;
      points[step * 2 + 1] = point.north * distance;
    }
    lanes.push({
      id: `${params.regionId}.lane.${spec.kind}.${index}`,
      kind: spec.kind,
      points,
      widthMeters: spec.width,
      lengthMeters: polyLength(points),
    });
  }
  return lanes;
}

function generateAirCorridors(params: CityLayoutParams, rng: () => number): AirCorridor[] {
  const corridors: AirCorridor[] = [];
  const seaward = (params.seawardBearingDeg * Math.PI) / 180;

  for (let index = 0; index < 2; index += 1) {
    const bearing = seaward + Math.PI / 2 + index * Math.PI;
    const steps = 8;
    const points = new Float64Array((steps + 1) * 2);
    for (let step = 0; step <= steps; step += 1) {
      const along = (step / steps - 0.5) * 2 * params.radiusMeters * 1.3;
      const across = (rng() - 0.5) * params.radiusMeters * 0.18;
      const forward = bearingVector(bearing);
      const side = bearingVector(bearing + Math.PI / 2);
      points[step * 2] = forward.east * along + side.east * across;
      points[step * 2 + 1] = forward.north * along + side.north * across;
    }
    corridors.push({
      id: `${params.regionId}.air.${index}`,
      points,
      altitudeMeters: 420 + index * 180,
      lengthMeters: polyLength(points),
    });
  }
  return corridors;
}

/**
 * One evacuation zone per district, mustering inland and uphill. Priority comes
 * from the district rather than from position: the waterfront and the slums go
 * first because of what they are, not because of where they sit.
 */
function generateEvacuationZones(params: CityLayoutParams): EvacuationZone[] {
  const zones: EvacuationZone[] = [];
  const seaward = (params.seawardBearingDeg * Math.PI) / 180;
  const inland = seaward + Math.PI;

  for (const placement of params.plan) {
    const district = params.districts.get(placement.districtId);
    if (!district) continue;

    // Muster points fan out so districts do not all pile onto one spot, but the
    // fan is bounded: at an unbounded fraction of its own bearing a district on
    // the far side of the city ended up mustering along the coast rather than
    // away from it, which is the one thing a muster point must not do.
    const spreadDeg = Math.max(
      -MUSTER_SPREAD_DEG,
      Math.min(MUSTER_SPREAD_DEG, placement.bearingOffsetDeg * 0.35),
    );
    const bearing = inland + (spreadDeg * Math.PI) / 180;
    const at = bearingVector(bearing);
    const distance = params.radiusMeters * 0.82;
    // Area of the wedge, in square kilometres, times people per square kilometre.
    const arc = (placement.arcDeg * Math.PI) / 180;
    const areaSquareKm =
      ((arc / 2) *
        ((placement.outerRadiusFraction * params.radiusMeters) ** 2 -
          (placement.innerRadiusFraction * params.radiusMeters) ** 2)) /
      1_000_000;

    zones.push({
      id: `${params.regionId}.evac.${placement.districtId}`,
      districtIds: [placement.districtId],
      musterEast: at.east * distance,
      musterNorth: at.north * distance,
      radiusMeters: 260 + areaSquareKm * 12,
      capacityThousands: Math.round(areaSquareKm * district.populationDensityThousands),
      priority: district.evacuationPriority,
    });
  }
  return zones.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

function generateDefensePositions(params: CityLayoutParams, rng: () => number): DefensePosition[] {
  const positions: DefensePosition[] = [];
  const seaward = (params.seawardBearingDeg * Math.PI) / 180;

  // Missile batteries along the waterfront, facing the water.
  for (let index = 0; index < 5; index += 1) {
    const bearing = seaward + ((index - 2) * 22 * Math.PI) / 180;
    const at = bearingVector(bearing);
    const distance = params.radiusMeters * (0.3 + rng() * 0.08);
    positions.push({
      id: `${params.regionId}.defense.missile.${index}`,
      kind: "missile",
      east: at.east * distance,
      north: at.north * distance,
      facingRadians: bearing,
      coverageMeters: params.radiusMeters * 1.4,
    });
  }

  // Sea wall segments in front of them.
  for (let index = 0; index < 7; index += 1) {
    const bearing = seaward + ((index - 3) * 15 * Math.PI) / 180;
    const at = bearingVector(bearing);
    const distance = params.radiusMeters * 0.19;
    positions.push({
      id: `${params.regionId}.defense.wall.${index}`,
      kind: "wall",
      east: at.east * distance,
      north: at.north * distance,
      facingRadians: bearing,
      coverageMeters: 340,
    });
  }

  // Checkpoints on the evacuation side.
  for (let index = 0; index < 4; index += 1) {
    const bearing = seaward + Math.PI + ((index - 1.5) * 40 * Math.PI) / 180;
    const at = bearingVector(bearing);
    const distance = params.radiusMeters * 0.62;
    positions.push({
      id: `${params.regionId}.defense.checkpoint.${index}`,
      kind: "checkpoint",
      east: at.east * distance,
      north: at.north * distance,
      facingRadians: bearing + Math.PI,
      coverageMeters: 220,
    });
  }

  // The pad a Jaeger launches from, in the Shatterdome precinct.
  const shatterdome = params.plan.find((placement) => placement.districtId === "shatterdome");
  if (shatterdome) {
    const bearing = seaward + (shatterdome.bearingOffsetDeg * Math.PI) / 180;
    const at = bearingVector(bearing);
    const distance =
      params.radiusMeters * (shatterdome.innerRadiusFraction + shatterdome.outerRadiusFraction) * 0.5;
    positions.push({
      id: `${params.regionId}.defense.jaeger-pad.0`,
      kind: "jaeger-pad",
      east: at.east * distance,
      north: at.north * distance,
      facingRadians: seaward,
      coverageMeters: 400,
    });
  }
  return positions;
}

/**
 * Two routes out of the Shatterdome: one at walking scale along the approach
 * road, and one at Jaeger scale straight down the deployment corridor to the
 * water. They exist as data now so the player controller and the deployment flow
 * consume them rather than inventing their own paths later.
 */
function generateRoutes(params: CityLayoutParams, defenses: readonly DefensePosition[]): DeploymentRoute[] {
  const pad = defenses.find((position) => position.kind === "jaeger-pad");
  if (!pad) return [];

  const seaward = (params.seawardBearingDeg * Math.PI) / 180;
  const forward = bearingVector(seaward);

  const walkingSteps = 6;
  const walking = new Float64Array((walkingSteps + 1) * 2);
  for (let step = 0; step <= walkingSteps; step += 1) {
    const t = step / walkingSteps;
    walking[step * 2] = pad.east * (1 - t) + forward.east * params.radiusMeters * 0.24 * t;
    walking[step * 2 + 1] = pad.north * (1 - t) + forward.north * params.radiusMeters * 0.24 * t;
  }

  const jaegerSteps = 8;
  const jaeger = new Float64Array((jaegerSteps + 1) * 2);
  for (let step = 0; step <= jaegerSteps; step += 1) {
    const t = step / jaegerSteps;
    const distance = params.radiusMeters * (0.1 + t * 1.0);
    jaeger[step * 2] = pad.east * (1 - t) + forward.east * distance * t;
    jaeger[step * 2 + 1] = pad.north * (1 - t) + forward.north * distance * t;
  }

  return [
    {
      id: `${params.regionId}.route.walking`,
      kind: "walking",
      points: walking,
      widthMeters: 12,
      lengthMeters: polyLength(walking),
      description: "Shatterdome approach on foot: pad apron to the precinct gate.",
    },
    {
      id: `${params.regionId}.route.jaeger`,
      kind: "jaeger",
      points: jaeger,
      widthMeters: 90,
      lengthMeters: polyLength(jaeger),
      description: "Jaeger deployment corridor: launch pad through the waterfront to open water.",
    },
  ];
}

function buildDestructionGroups(regionId: string, blocks: readonly CityBlock[]): DestructionGroup[] {
  const byGroup = new Map<string, CityBlock[]>();
  for (const block of blocks) {
    const existing = byGroup.get(block.groupId);
    if (existing) existing.push(block);
    else byGroup.set(block.groupId, [block]);
  }

  const groups: DestructionGroup[] = [];
  for (const [id, members] of byGroup) {
    let east = 0;
    let north = 0;
    for (const block of members) {
      east += block.east;
      north += block.north;
    }
    east /= members.length;
    north /= members.length;

    let radius = 0;
    for (const block of members) {
      radius = Math.max(radius, Math.hypot(block.east - east, block.north - north) + block.widthMeters);
    }
    groups.push({
      id,
      districtId: members[0]?.districtId ?? "downtown",
      blockIds: members.map((block) => block.id),
      centreEast: east,
      centreNorth: north,
      radiusMeters: radius,
    });
  }
  void regionId;
  return groups.sort((a, b) => a.id.localeCompare(b.id));
}

export function generateCityLayout(params: CityLayoutParams): CityLayout {
  const errors = validateCityLayoutParams(params);
  if (errors.length > 0) {
    throw new Error(`Cannot lay out city "${params.regionId}": ${errors.join("; ")}`);
  }

  const rng = createSeededRng((params.seed ^ hashStringToSeed(`city.${params.regionId}`)) >>> 0);
  const maxBlocks = params.maxBlocks ?? DEFAULT_MAX_BLOCKS;

  const blocks: CityBlock[] = [];
  for (const placement of params.plan) {
    const district = params.districts.get(placement.districtId);
    if (!district) continue;
    const remaining = maxBlocks - blocks.length;
    if (remaining <= 0) break;
    // Each district gets a share of what is left, so an early district cannot
    // eat the whole budget and leave the rest of the city missing.
    const share = Math.max(1, Math.floor(remaining / Math.max(1, params.plan.length)));
    blocks.push(...generateDistrictBlocks(placement, district, params, rng, blocks.length, share));
  }

  const landmarks = generateLandmarks(params, rng);
  const roads = generateRoads(params, rng);
  const harborLanes = generateHarborLanes(params, rng);
  const airCorridors = generateAirCorridors(params, rng);
  const evacuationZones = generateEvacuationZones(params);
  const defensePositions = generateDefensePositions(params, rng);
  const routes = generateRoutes(params, defensePositions);
  const destructionGroups = buildDestructionGroups(params.regionId, blocks);

  const stats: CityLayoutStats = {
    blockCount: blocks.length,
    towerCount: blocks.reduce((sum, block) => sum + block.towerCount, 0),
    landmarkCount: landmarks.length,
    roadCount: roads.length,
    roadLengthMeters: roads.reduce((sum, road) => sum + road.lengthMeters, 0),
    harborLaneCount: harborLanes.length,
    evacuationCapacityThousands: evacuationZones.reduce((sum, zone) => sum + zone.capacityThousands, 0),
    defenseCount: defensePositions.length,
    destructionGroupCount: destructionGroups.length,
  };

  let digest = 0x811c9dc5;
  digest = fnv1a(digest, hashStringToSeed(params.regionId));
  digest = fnv1a(digest, params.seed);
  for (const block of blocks) {
    digest = fnv1a(digest, Math.round(block.east));
    digest = fnv1a(digest, Math.round(block.north));
    digest = fnv1a(digest, Math.round(block.heightMeters));
  }
  for (const landmark of landmarks) digest = fnv1a(digest, Math.round(landmark.east));

  return {
    schemaVersion: CITY_LAYOUT_SCHEMA_VERSION,
    regionId: params.regionId,
    seed: params.seed,
    radiusMeters: params.radiusMeters,
    seawardBearingRadians: (params.seawardBearingDeg * Math.PI) / 180,
    districts: params.plan.map((placement) => placement.districtId),
    blocks,
    landmarks,
    roads,
    harborLanes,
    airCorridors,
    evacuationZones,
    defensePositions,
    destructionGroups,
    routes,
    stats,
    digest: digest >>> 0,
  };
}

/** Point at `t` along a polyline of east/north pairs. Used to move agents along lanes. */
export function pointAlong(points: Float64Array, t: number): { east: number; north: number } {
  const count = points.length / 2;
  if (count === 0) return { east: 0, north: 0 };
  if (count === 1) return { east: points[0] ?? 0, north: points[1] ?? 0 };

  const clamped = ((t % 1) + 1) % 1;
  const scaled = clamped * (count - 1);
  const index = Math.min(count - 2, Math.floor(scaled));
  const fraction = scaled - index;

  const ax = points[index * 2] ?? 0;
  const ay = points[index * 2 + 1] ?? 0;
  const bx = points[(index + 1) * 2] ?? 0;
  const by = points[(index + 1) * 2 + 1] ?? 0;
  return { east: ax + (bx - ax) * fraction, north: ay + (by - ay) * fraction };
}

/** Heading in radians at `t` along a polyline, for orienting an agent. */
export function headingAlong(points: Float64Array, t: number): number {
  const ahead = pointAlong(points, t + 0.01);
  const here = pointAlong(points, t);
  return Math.atan2(ahead.east - here.east, ahead.north - here.north);
}
