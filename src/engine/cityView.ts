import {
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Scene,
} from "@babylonjs/core";
import type { DistrictDefinition, DistrictKind } from "../data/districts";
import type { QualityPreset } from "../data/quality";
import { headingAlong, pointAlong, type CityLayout, type DestructionGroup } from "../world/cityLayout";
import type { BuildingState } from "../data/buildings";
import { instanceCountFor, type ActivitySample } from "../world/cityActivity";
import { ecefToLocal, tangentBasisAt, type GeoPosition, type TangentBasis } from "../world/coordinates";

/**
 * The city, drawn.
 *
 * Two rules shape this file, both of them named failure modes.
 *
 * It is not one mesh. Blocks are grouped into destruction groups and each group
 * gets its own mesh with its own thin instances, so a group can be streamed in,
 * hidden, or later blown up without touching the rest of the city. One monolithic
 * city mesh would make damage and streaming impossible at the same time.
 *
 * It is not thousands of agents. Vehicles, ships, aircraft and crowds are pooled
 * thin instances whose count comes from a density number and a quality budget,
 * and whose positions are a function of the tick and their lane. There is no
 * per-agent state anywhere, so a busy district costs the same to think about as
 * an empty one.
 *
 * Everything is placed in the region-centre tangent frame. The region centre does
 * not move, so a floating origin rebase moves one root transform rather than
 * every instance.
 */

/** Agents are split across kinds by share of the quality budget. */
const AGENT_SHARES = { vehicle: 0.52, crowd: 0.28, ship: 0.14, aircraft: 0.06 } as const;
type AgentKind = keyof typeof AGENT_SHARES;

/** How fast each agent kind travels its lane, in loops per in-game second. */
const AGENT_SPEED: Readonly<Record<AgentKind, number>> = {
  vehicle: 1 / 240,
  crowd: 1 / 900,
  ship: 1 / 1_400,
  aircraft: 1 / 520,
};

const AGENT_SIZE: Readonly<Record<AgentKind, Vector3>> = {
  vehicle: new Vector3(9, 6, 18),
  crowd: new Vector3(14, 4, 14),
  ship: new Vector3(34, 20, 130),
  aircraft: new Vector3(26, 8, 30),
};

export interface CityViewOptions {
  readonly scene: Scene;
  readonly layout: CityLayout;
  /** Geodetic centre of the region. The whole city is built around this. */
  readonly regionCentre: GeoPosition;
  /** Current floating-origin anchor, read on build and on every rebase. */
  anchor(): GeoPosition;
  /** Ground height at a point in the region frame, or null where nothing is loaded. */
  groundHeightAt(east: number, north: number): number | null;
  readonly districts: ReadonlyMap<DistrictKind, DistrictDefinition>;
  readonly quality: QualityPreset;
}

export interface CityViewStats {
  readonly residentGroups: number;
  readonly totalGroups: number;
  readonly drawnBlocks: number;
  readonly totalBlocks: number;
  readonly landmarks: number;
  readonly agents: number;
  readonly agentCapacity: number;
  /**
   * Live instances per kind. Reported separately because a total hides the thing
   * that matters: under attack the crowds vanish while military traffic fills
   * the roads, so the total barely moves and each kind moves a long way.
   */
  readonly agentsByKind: Readonly<Record<string, number>>;
  readonly roadMeshes: number;
  readonly meshes: number;
  readonly estimatedGpuBytes: number;
  readonly sirensActive: boolean;
}

interface GroupNode {
  readonly group: DestructionGroup;
  readonly mesh: Mesh;
  readonly blockCount: number;
  readonly bytes: number;
  /**
   * The towers this group was built from, seven numbers each: east, north,
   * ground, width, depth, height, rotation. Kept so a damaged block can be
   * redrawn from its own source rather than regenerated from the layout.
   */
  readonly source: readonly number[];
  /** What the group is currently drawn as. Redrawn only when this changes. */
  drawnState: BuildingState;
}

/**
 * Resolution of the cached ground field across the city footprint.
 *
 * The agents need a ground height every frame, and asking the streamer for one
 * costs a geodetic conversion, a tangent basis and a sector lookup each time.
 * At six hundred agents that was measured at nineteen frames a second on Medium.
 * Sampling the terrain once into a grid and interpolating turns the same query
 * into four array reads.
 */
const GROUND_FIELD_RESOLUTION = 65;

/**
 * How tall a block stands in each state, as a fraction of its intact height.
 *
 * A table rather than a switch, and the one place the look of damage is
 * decided: the simulation says which state a block is in and this says what
 * that looks like.
 */
const HEIGHT_BY_STATE: Readonly<Record<BuildingState, number>> = {
  intact: 1,
  damaged: 0.92,
  breached: 0.7,
  collapsing: 0.45,
  ruined: 0.18,
  cleared: 0.04,
  rebuilding: 0.55,
};

/** How far a block leans in each state, radians of scatter. */
const LEAN_BY_STATE: Readonly<Record<BuildingState, number>> = {
  intact: 0,
  damaged: 0.02,
  breached: 0.06,
  collapsing: 0.18,
  ruined: 0.32,
  cleared: 0,
  rebuilding: 0.04,
};

/** Parks every instance in a buffer far below the world until it is used. */
function parkAll(buffer: Float32Array): void {
  for (let index = 0; index < buffer.length / 16; index += 1) {
    composeInstance(buffer, index, new Vector3(0.001, 0.001, 0.001), 0, new Vector3(0, -100_000, 0));
  }
}

const SCRATCH_QUATERNION = new Quaternion();
const SCRATCH_MATRIX = new Matrix();

function composeInstance(
  target: Float32Array,
  index: number,
  scaling: Vector3,
  yawRadians: number,
  translation: Vector3,
): void {
  Quaternion.RotationAxisToRef(Vector3.Up(), yawRadians, SCRATCH_QUATERNION);
  Matrix.ComposeToRef(scaling, SCRATCH_QUATERNION, translation, SCRATCH_MATRIX);
  SCRATCH_MATRIX.copyToArray(target, index * 16);
}

export class CityView {
  private readonly scene: Scene;
  private readonly layout: CityLayout;
  private readonly regionBasis: TangentBasis;
  private readonly anchorOf: () => GeoPosition;
  private readonly districts: ReadonlyMap<DistrictKind, DistrictDefinition>;
  private readonly root: TransformNode;
  private readonly groups: GroupNode[] = [];
  private readonly materials: StandardMaterial[] = [];
  private readonly agentMeshes = new Map<AgentKind, Mesh>();
  private readonly agentBuffers = new Map<AgentKind, Float32Array>();
  private readonly roadMeshes: Mesh[] = [];
  private readonly landmarkMesh: Mesh | null = null;
  private readonly defenseMesh: Mesh | null = null;
  private readonly musterMesh: Mesh | null = null;
  private readonly debrisMesh: Mesh | null = null;
  private readonly debrisBuffer: Float32Array;
  private debrisCount = 0;
  private quality: QualityPreset;
  private readonly groundField: Float32Array;
  private readonly groundFieldExtent: number;
  private agentCount = 0;
  private readonly agentCounts = new Map<AgentKind, number>();
  private sirensActive = false;
  private gpuBytes = 0;
  private disposed = false;

  constructor(options: CityViewOptions) {
    this.scene = options.scene;
    this.layout = options.layout;
    this.anchorOf = options.anchor;
    this.districts = options.districts;
    this.quality = options.quality;
    this.regionBasis = tangentBasisAt({ ...options.regionCentre, altitudeMeters: 0 });

    this.root = new TransformNode(`city.${this.layout.regionId}`, this.scene);

    // Sampled once, before anything is built, so every later height query is a
    // grid read rather than a trip through the streamer.
    this.groundFieldExtent = this.layout.radiusMeters * 1.25;
    this.groundField = this.sampleGroundField(options.groundHeightAt);

    this.buildGroups();
    this.landmarkMesh = this.buildLandmarks();
    this.buildRoads();
    this.defenseMesh = this.buildDefenses();
    this.musterMesh = this.buildMusterPoints();
    this.buildAgentPools();
    // Rubble shares one mesh at the preset's own ceiling, so a street full of
    // it costs one draw call.
    this.debrisBuffer = new Float32Array(options.quality.maxDebrisBodies * 16);
    this.debrisMesh = this.buildDebrisPool();
    this.rebase();
  }

  private material(name: string, colour: Color3, emissive = 0): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = colour;
    material.specularColor = Color3.Black();
    if (emissive > 0) material.emissiveColor = colour.scale(emissive);
    this.materials.push(material);
    return material;
  }

  /**
   * Samples the terrain across the city footprint into a grid.
   *
   * Where the streamer has nothing loaded the cell falls back to the nearest
   * value already sampled, so an unloaded corner produces flat ground rather
   * than a hole at sea level under a district.
   */
  private sampleGroundField(source: (east: number, north: number) => number | null): Float32Array {
    const size = GROUND_FIELD_RESOLUTION;
    const field = new Float32Array(size * size);
    const step = (this.groundFieldExtent * 2) / (size - 1);
    let last = 0;

    for (let row = 0; row < size; row += 1) {
      const north = -this.groundFieldExtent + row * step;
      for (let column = 0; column < size; column += 1) {
        const east = -this.groundFieldExtent + column * step;
        const sampled = source(east, north);
        if (sampled !== null) last = sampled;
        field[row * size + column] = sampled ?? last;
      }
    }
    return field;
  }

  /** Ground height in the region frame, read from the cached field. */
  private groundAt(east: number, north: number): number {
    const size = GROUND_FIELD_RESOLUTION;
    const extent = this.groundFieldExtent;
    const u = ((east + extent) / (extent * 2)) * (size - 1);
    const v = ((north + extent) / (extent * 2)) * (size - 1);
    const column = Math.min(size - 2, Math.max(0, Math.floor(u)));
    const row = Math.min(size - 2, Math.max(0, Math.floor(v)));
    const fx = Math.min(1, Math.max(0, u - column));
    const fy = Math.min(1, Math.max(0, v - row));

    const at = (c: number, r: number): number => this.groundField[r * size + c] ?? 0;
    const top = at(column, row) + (at(column + 1, row) - at(column, row)) * fx;
    const bottom = at(column, row + 1) + (at(column + 1, row + 1) - at(column, row + 1)) * fx;
    return top + (bottom - top) * fy;
  }

  /**
   * One mesh per destruction group.
   *
   * Groups are sorted by distance from the region centre and capped by the
   * quality preset, so a lower preset draws a smaller city rather than a
   * lower-detail version of the whole one. That keeps the centre, which is the
   * part that carries the silhouette.
   */
  private buildGroups(): void {
    const ordered = [...this.layout.destructionGroups].sort(
      (a, b) =>
        Math.hypot(a.centreEast, a.centreNorth) - Math.hypot(b.centreEast, b.centreNorth) ||
        a.id.localeCompare(b.id),
    );

    const blocksById = new Map(this.layout.blocks.map((block) => [block.id, block]));
    let blockBudget = this.quality.maxCityBlocks;

    for (const group of ordered.slice(0, this.quality.maxCityGroups)) {
      if (blockBudget <= 0) break;
      const members = group.blockIds
        .map((id) => blocksById.get(id))
        .filter((block): block is NonNullable<typeof block> => block !== undefined);
      if (members.length === 0) continue;

      // Towers, not blocks, are what actually get drawn: a slum block is four
      // small towers and a downtown block is two large ones.
      const instances: number[] = [];
      let drawn = 0;
      for (const block of members) {
        if (blockBudget <= 0) break;
        const ground = this.groundAt(block.east, block.north);
        const towers = Math.min(block.towerCount, blockBudget);
        for (let tower = 0; tower < towers; tower += 1) {
          const spread = block.widthMeters * 0.28;
          const offsetEast = towers === 1 ? 0 : ((tower % 2) - 0.5) * spread;
          const offsetNorth = towers === 1 ? 0 : (Math.floor(tower / 2) - 0.5) * spread;
          const height = block.heightMeters * (towers === 1 ? 1 : 0.6 + (tower % 3) * 0.22);
          instances.push(
            block.east + offsetEast,
            block.north + offsetNorth,
            ground,
            block.widthMeters / Math.max(1, towers === 1 ? 1 : 2),
            block.depthMeters / Math.max(1, towers === 1 ? 1 : 2),
            height,
            block.rotationRadians,
          );
        }
        blockBudget -= towers;
        drawn += towers;
      }
      if (drawn === 0) continue;

      const district = this.districts.get(group.districtId);
      const colour = district ? new Color3(...district.colour) : new Color3(0.45, 0.47, 0.5);
      const mesh = MeshBuilder.CreateBox(`city.group.${group.id}`, { size: 1 }, this.scene);
      mesh.material = this.material(`city.group.mat.${group.id}`, colour);
      mesh.isPickable = false;
      mesh.parent = this.root;

      const matrices = new Float32Array(drawn * 16);
      for (let index = 0; index < drawn; index += 1) {
        const at = index * 7;
        const height = instances[at + 5] ?? 1;
        composeInstance(
          matrices,
          index,
          new Vector3(instances[at + 3] ?? 1, height, instances[at + 4] ?? 1),
          instances[at + 6] ?? 0,
          new Vector3(instances[at] ?? 0, (instances[at + 2] ?? 0) + height / 2, instances[at + 1] ?? 0),
        );
      }
      mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);

      this.groups.push({
        group,
        mesh,
        blockCount: drawn,
        bytes: matrices.byteLength,
        source: instances,
        drawnState: "intact",
      });
      this.gpuBytes += matrices.byteLength;
    }
  }

  private buildLandmarks(): Mesh | null {
    if (this.layout.landmarks.length === 0) return null;
    const mesh = MeshBuilder.CreateCylinder(
      "city.landmarks",
      { height: 1, diameterTop: 0.55, diameterBottom: 1, tessellation: 10 },
      this.scene,
    );
    mesh.material = this.material("city.landmark.mat", new Color3(0.72, 0.66, 0.44), 0.25);
    mesh.isPickable = false;
    mesh.parent = this.root;

    const matrices = new Float32Array(this.layout.landmarks.length * 16);
    this.layout.landmarks.forEach((landmark, index) => {
      const ground = this.groundAt(landmark.east, landmark.north);
      composeInstance(
        matrices,
        index,
        new Vector3(landmark.footprintMeters, landmark.heightMeters, landmark.footprintMeters),
        landmark.rotationRadians,
        new Vector3(landmark.east, ground + landmark.heightMeters / 2, landmark.north),
      );
    });
    mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
    this.gpuBytes += matrices.byteLength;
    return mesh;
  }

  /** Roads and lanes are flat ribbons following their polyline. */
  private buildRoads(): void {
    const surfaces: { points: Float64Array; width: number; colour: Color3; lift: number; name: string }[] =
      [];
    for (const road of this.layout.roads) {
      surfaces.push({
        points: road.points,
        width: road.widthMeters,
        colour: new Color3(0.16, 0.16, 0.18),
        lift: 1.5,
        name: road.id,
      });
    }
    for (const lane of this.layout.harborLanes) {
      surfaces.push({
        points: lane.points,
        width: lane.widthMeters,
        colour: new Color3(0.12, 0.24, 0.32),
        lift: 0.6,
        name: lane.id,
      });
    }
    for (const route of this.layout.routes) {
      surfaces.push({
        points: route.points,
        width: route.widthMeters,
        // The deployment corridor is marked, because it is a route rather than
        // a road: the player is meant to be able to find it.
        colour: route.kind === "jaeger" ? new Color3(0.5, 0.34, 0.12) : new Color3(0.3, 0.3, 0.2),
        lift: 2.5,
        name: route.id,
      });
    }

    for (const surface of surfaces) {
      const mesh = this.buildRibbon(surface.name, surface.points, surface.width, surface.lift);
      if (!mesh) continue;
      mesh.material = this.material(`city.surface.mat.${surface.name}`, surface.colour);
      mesh.isPickable = false;
      mesh.parent = this.root;
      this.roadMeshes.push(mesh);
    }
  }

  private buildRibbon(name: string, points: Float64Array, width: number, lift: number): Mesh | null {
    const count = points.length / 2;
    if (count < 2) return null;

    const positions: number[] = [];
    const indices: number[] = [];
    const half = width / 2;

    for (let index = 0; index < count; index += 1) {
      const east = points[index * 2] ?? 0;
      const north = points[index * 2 + 1] ?? 0;
      const nextEast = points[Math.min(count - 1, index + 1) * 2] ?? east;
      const nextNorth = points[Math.min(count - 1, index + 1) * 2 + 1] ?? north;
      const prevEast = points[Math.max(0, index - 1) * 2] ?? east;
      const prevNorth = points[Math.max(0, index - 1) * 2 + 1] ?? north;

      const dirEast = nextEast - prevEast;
      const dirNorth = nextNorth - prevNorth;
      const length = Math.hypot(dirEast, dirNorth) || 1;
      // Perpendicular in the ground plane.
      const sideEast = -dirNorth / length;
      const sideNorth = dirEast / length;
      const ground = this.groundAt(east, north) + lift;

      positions.push(east + sideEast * half, ground, north + sideNorth * half);
      positions.push(east - sideEast * half, ground, north - sideNorth * half);

      if (index < count - 1) {
        const base = index * 2;
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }

    // A plain two-vertex-per-step strip. Normals point straight up because a
    // road surface is flat by definition, which saves computing them.
    const mesh = new Mesh(`city.surface.${name}`, this.scene);
    mesh.setVerticesData("position", positions, false);
    mesh.setIndices(indices);
    const normals = new Array<number>(positions.length).fill(0);
    for (let index = 1; index < normals.length; index += 3) normals[index] = 1;
    mesh.setVerticesData("normal", normals, false);
    this.gpuBytes += positions.length * 4 + indices.length * 4;
    return mesh;
  }

  private buildDefenses(): Mesh | null {
    if (this.layout.defensePositions.length === 0) return null;
    const mesh = MeshBuilder.CreateBox("city.defenses", { size: 1 }, this.scene);
    mesh.material = this.material("city.defense.mat", new Color3(0.32, 0.4, 0.34), 0.18);
    mesh.isPickable = false;
    mesh.parent = this.root;

    const sizes: Readonly<Record<string, Vector3>> = {
      missile: new Vector3(26, 14, 34),
      wall: new Vector3(180, 22, 26),
      checkpoint: new Vector3(30, 10, 30),
      "jaeger-pad": new Vector3(180, 6, 180),
    };

    const matrices = new Float32Array(this.layout.defensePositions.length * 16);
    this.layout.defensePositions.forEach((position, index) => {
      const size = sizes[position.kind] ?? new Vector3(20, 10, 20);
      const ground = this.groundAt(position.east, position.north);
      composeInstance(
        matrices,
        index,
        size,
        position.facingRadians,
        new Vector3(position.east, ground + size.y / 2, position.north),
      );
    });
    mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
    this.gpuBytes += matrices.byteLength;
    return mesh;
  }

  private buildMusterPoints(): Mesh | null {
    if (this.layout.evacuationZones.length === 0) return null;
    const mesh = MeshBuilder.CreateCylinder(
      "city.muster",
      { height: 1, diameter: 1, tessellation: 14 },
      this.scene,
    );
    mesh.material = this.material("city.muster.mat", new Color3(0.28, 0.62, 0.36), 0.35);
    mesh.isPickable = false;
    mesh.parent = this.root;

    const matrices = new Float32Array(this.layout.evacuationZones.length * 16);
    this.layout.evacuationZones.forEach((zone, index) => {
      const ground = this.groundAt(zone.musterEast, zone.musterNorth);
      composeInstance(
        matrices,
        index,
        new Vector3(zone.radiusMeters * 2, 4, zone.radiusMeters * 2),
        0,
        new Vector3(zone.musterEast, ground + 2, zone.musterNorth),
      );
    });
    mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
    this.gpuBytes += matrices.byteLength;
    return mesh;
  }

  /**
   * One pooled mesh per agent kind, allocated at the budget and never grown.
   * `thinInstanceCount` is what changes as activity rises and falls, so a quiet
   * city costs fewer draws without any allocation happening.
   */
  private buildAgentPools(): void {
    const colours: Readonly<Record<AgentKind, Color3>> = {
      vehicle: new Color3(0.8, 0.76, 0.5),
      crowd: new Color3(0.68, 0.62, 0.58),
      ship: new Color3(0.5, 0.52, 0.56),
      aircraft: new Color3(0.62, 0.66, 0.72),
    };

    for (const kind of Object.keys(AGENT_SHARES) as AgentKind[]) {
      const capacity = Math.max(1, Math.floor(this.quality.maxCityAgents * AGENT_SHARES[kind]));
      const mesh = MeshBuilder.CreateBox(`city.agent.${kind}`, { size: 1 }, this.scene);
      mesh.material = this.material(`city.agent.mat.${kind}`, colours[kind], kind === "vehicle" ? 0.3 : 0.1);
      mesh.isPickable = false;
      mesh.parent = this.root;

      const buffer = new Float32Array(capacity * 16);
      mesh.thinInstanceSetBuffer("matrix", buffer, 16, true);
      mesh.thinInstanceCount = 0;
      this.agentMeshes.set(kind, mesh);
      this.agentBuffers.set(kind, buffer);
      this.gpuBytes += buffer.byteLength;
    }
  }

  /**
   * Places the city root so the region frame lines up with the anchor frame.
   *
   * Called after a floating origin rebase. One transform for the whole city,
   * because every instance is expressed relative to the region centre and the
   * region centre never moves.
   */
  rebase(): void {
    if (this.disposed) return;
    const anchorBasis = tangentBasisAt(this.anchorOf());
    const axis = (v: { x: number; y: number; z: number }): Vector3 =>
      new Vector3(
        v.x * anchorBasis.east.x + v.y * anchorBasis.east.y + v.z * anchorBasis.east.z,
        v.x * anchorBasis.up.x + v.y * anchorBasis.up.y + v.z * anchorBasis.up.z,
        v.x * anchorBasis.north.x + v.y * anchorBasis.north.y + v.z * anchorBasis.north.z,
      );

    const x = axis(this.regionBasis.east);
    const y = axis(this.regionBasis.up);
    const z = axis(this.regionBasis.north);
    const origin = ecefToLocal(anchorBasis, this.regionBasis.origin);

    const matrix = Matrix.FromValues(
      x.x,
      x.y,
      x.z,
      0,
      y.x,
      y.y,
      y.z,
      0,
      z.x,
      z.y,
      z.z,
      0,
      origin.east,
      origin.up,
      origin.north,
      1,
    );
    const scaling = new Vector3();
    const rotation = new Quaternion();
    const position = new Vector3();
    matrix.decompose(scaling, rotation, position);
    this.root.rotationQuaternion = rotation;
    this.root.position = position;
  }

  /**
   * Moves the agents.
   *
   * Every agent is a point on a lane at a phase derived from its index, so the
   * whole population is a loop over a budget rather than a list of objects. The
   * count comes from the activity sample, which is why an alert visibly empties
   * the streets and clears the harbour.
   */
  update(tick: number, activityByDistrict: ReadonlyMap<string, ActivitySample>): void {
    if (this.disposed) return;

    let sirens = false;
    let civilian = 0;
    let vehicle = 0;
    let shipping = 0;
    let aircraft = 0;
    let military = 0;
    let samples = 0;
    for (const sample of activityByDistrict.values()) {
      civilian += sample.civilianDensity;
      vehicle += sample.vehicleDensity;
      shipping += sample.shippingDensity;
      aircraft += sample.aircraftDensity;
      military += sample.militaryDensity;
      sirens = sirens || sample.sirens;
      samples += 1;
    }
    if (samples > 0) {
      civilian /= samples;
      vehicle /= samples;
      shipping /= samples;
      aircraft /= samples;
      military /= samples;
    }
    this.sirensActive = sirens;

    // Military traffic rides the same roads, so it is added to vehicle density
    // rather than given its own pool: what changes under alert is how many
    // vehicles there are, not how many kinds of mesh exist.
    const densities: Readonly<Record<AgentKind, number>> = {
      vehicle: Math.min(1, vehicle + military * 0.5),
      crowd: civilian,
      ship: shipping,
      aircraft,
    };

    const roads = this.layout.roads;
    const lanes = this.layout.harborLanes;
    const corridors = this.layout.airCorridors;

    this.agentCount = 0;
    for (const kind of Object.keys(AGENT_SHARES) as AgentKind[]) {
      const mesh = this.agentMeshes.get(kind);
      const buffer = this.agentBuffers.get(kind);
      if (!mesh || !buffer) continue;

      const capacity = buffer.length / 16;
      const count = Math.min(capacity, instanceCountFor(densities[kind], capacity));
      const paths = kind === "ship" ? lanes : kind === "aircraft" ? corridors : roads;

      if (count === 0 || paths.length === 0) {
        mesh.thinInstanceCount = 0;
        this.agentCounts.set(kind, 0);
        continue;
      }

      const size = AGENT_SIZE[kind];
      const speed = AGENT_SPEED[kind];
      for (let index = 0; index < count; index += 1) {
        const path = paths[index % paths.length];
        if (!path) continue;
        // Phase spreads agents along the lane; the golden ratio keeps them from
        // clumping the way a plain index over count does.
        const phase = (index * 0.618_034) % 1;
        const t = (phase + tick * speed) % 1;
        const at = pointAlong(path.points, t);
        const heading = headingAlong(path.points, t);
        const altitude =
          kind === "aircraft"
            ? ((path as { altitudeMeters?: number }).altitudeMeters ?? 400)
            : kind === "ship"
              ? 0
              : this.groundAt(at.east, at.north);
        composeInstance(buffer, index, size, heading, new Vector3(at.east, altitude + size.y / 2, at.north));
      }
      mesh.thinInstanceCount = count;
      mesh.thinInstanceBufferUpdated("matrix");
      this.agentCounts.set(kind, count);
      this.agentCount += count;
    }
  }

  stats(): CityViewStats {
    let blocks = 0;
    for (const group of this.groups) blocks += group.blockCount;
    let capacity = 0;
    for (const buffer of this.agentBuffers.values()) capacity += buffer.length / 16;

    return {
      residentGroups: this.groups.length,
      totalGroups: this.layout.destructionGroups.length,
      drawnBlocks: blocks,
      totalBlocks: this.layout.stats.towerCount,
      landmarks: this.layout.landmarks.length,
      agents: this.agentCount,
      agentCapacity: capacity,
      agentsByKind: Object.fromEntries(this.agentCounts),
      roadMeshes: this.roadMeshes.length,
      meshes:
        this.groups.length +
        this.roadMeshes.length +
        this.agentMeshes.size +
        (this.landmarkMesh ? 1 : 0) +
        (this.defenseMesh ? 1 : 0) +
        (this.musterMesh ? 1 : 0),
      estimatedGpuBytes: this.gpuBytes,
      sirensActive: this.sirensActive,
    };
  }

  /**
   * Redraws the blocks whose state has changed.
   *
   * A damaged block loses height and leans; a ruined one is a rubble field at a
   * fraction of its old height; a rebuilding one is scaffolding part of the way
   * back up. Only groups whose state actually changed are touched, so a city
   * standing still costs nothing.
   */
  updateDamage(stateOf: (groupId: string) => BuildingState): number {
    if (this.disposed) return 0;
    let redrawn = 0;
    for (const node of this.groups) {
      const state = stateOf(node.group.id);
      if (state === node.drawnState) continue;
      node.drawnState = state;
      redrawn += 1;
      this.redrawGroup(node, state);
    }
    return redrawn;
  }

  /** Draws whatever the debris pool says is in the world. */
  updateDebris(
    chunks: readonly { east: number; north: number; up: number; yawRadians: number; sizeMeters: number }[],
  ): void {
    if (this.disposed || !this.debrisMesh) return;
    const capacity = this.debrisBuffer.length / 16;
    const count = Math.min(chunks.length, capacity);
    for (let index = 0; index < count; index += 1) {
      const chunk = chunks[index];
      if (!chunk) continue;
      composeInstance(
        this.debrisBuffer,
        index,
        new Vector3(chunk.sizeMeters, chunk.sizeMeters * 0.6, chunk.sizeMeters),
        chunk.yawRadians,
        new Vector3(chunk.east, chunk.up, chunk.north),
      );
    }
    const previous = this.debrisCount;
    this.debrisCount = count;
    this.debrisMesh.thinInstanceCount = count;
    if (count !== previous) {
      this.debrisMesh.thinInstanceSetBuffer("matrix", this.debrisBuffer, 16);
      this.debrisMesh.thinInstanceCount = count;
      this.debrisMesh.thinInstanceRefreshBoundingInfo(false);
    } else if (count > 0) {
      this.debrisMesh.thinInstanceBufferUpdated("matrix");
    }
  }

  /** How many blocks are currently drawn in each state. For the panel. */
  damageStates(): Readonly<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const node of this.groups) {
      counts[node.drawnState] = (counts[node.drawnState] ?? 0) + 1;
    }
    return counts;
  }

  private redrawGroup(node: GroupNode, state: BuildingState): void {
    const scale = HEIGHT_BY_STATE[state] ?? 1;
    const lean = LEAN_BY_STATE[state] ?? 0;
    const matrices = new Float32Array(node.blockCount * 16);
    for (let index = 0; index < node.blockCount; index += 1) {
      const at = index * 7;
      const height = Math.max(1, (node.source[at + 5] ?? 1) * scale);
      // A deterministic wobble from the index, so a ruined block is a jumble
      // rather than a neat row of shorter boxes, and looks the same every time.
      const wobble = lean === 0 ? 0 : ((index % 5) - 2) * lean;
      composeInstance(
        matrices,
        index,
        new Vector3(node.source[at + 3] ?? 1, height, node.source[at + 4] ?? 1),
        (node.source[at + 6] ?? 0) + wobble,
        new Vector3(node.source[at] ?? 0, (node.source[at + 2] ?? 0) + height / 2, node.source[at + 1] ?? 0),
      );
    }
    node.mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
    node.mesh.thinInstanceCount = node.blockCount;
    node.mesh.thinInstanceRefreshBoundingInfo(false);
  }

  private buildDebrisPool(): Mesh {
    const mesh = MeshBuilder.CreateBox("city.debris", { size: 1 }, this.scene);
    mesh.material = this.material("city.debris.mat", new Color3(0.28, 0.27, 0.26), 0.02);
    mesh.isPickable = false;
    mesh.parent = this.root;
    parkAll(this.debrisBuffer);
    mesh.thinInstanceSetBuffer("matrix", this.debrisBuffer, 16);
    mesh.thinInstanceCount = 0;
    mesh.alwaysSelectAsActiveMesh = true;
    this.gpuBytes += this.debrisBuffer.byteLength;
    return mesh;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.debrisMesh?.dispose();
    for (const group of this.groups) group.mesh.dispose();
    this.groups.length = 0;
    for (const mesh of this.roadMeshes) mesh.dispose();
    this.roadMeshes.length = 0;
    for (const mesh of this.agentMeshes.values()) mesh.dispose();
    this.agentMeshes.clear();
    this.agentBuffers.clear();
    this.landmarkMesh?.dispose();
    this.defenseMesh?.dispose();
    this.musterMesh?.dispose();
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    this.root.dispose();
    this.gpuBytes = 0;
    this.agentCount = 0;
    this.agentCounts.clear();
  }
}
