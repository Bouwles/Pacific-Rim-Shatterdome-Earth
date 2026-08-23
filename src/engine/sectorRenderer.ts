import {
  Color3,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexData,
  type Scene,
} from "@babylonjs/core";
import { BIOME_DEFINITIONS, SURFACE_CLASSES } from "../data/biomes";
import {
  ecefToLocal,
  tangentBasisAt,
  type EcefPosition,
  type GeoPosition,
  type TangentBasis,
} from "../world/coordinates";
import { parseSectorId, sectorCentre, type SectorId } from "../world/cubeSphere";
import type { SectorSink } from "../world/sectorStreaming";
import type { SectorTerrain } from "../world/terrain";
import { sampleWaveHeight, waveFieldCoordinates } from "../world/ocean";
import type { EnvironmentSample } from "../world/environment";
import type { QualityPreset } from "../data/quality";

/**
 * Babylon presentation for streamed sectors.
 *
 * The only Babylon-aware part of streaming. `SectorStreamer` decides what should
 * exist; this decides what that looks like and owns every GPU resource involved.
 *
 * Three things are worth knowing before changing this file:
 *
 * - Vertices are built in each sector's own tangent frame, not in the player's.
 *   A floating-origin rebase then costs one transform per sector root instead of
 *   rebuilding every vertex buffer, and stays exact, because the rotation between
 *   the two frames is carried by the root rather than approximated away.
 * - Meshes are pooled by level of detail. A sector that leaves range hands its
 *   meshes back rather than disposing them, so flying a long route allocates a
 *   bounded number of buffers instead of one set per sector crossed.
 * - Every mesh carries a skirt: a short vertical apron around its border. Two
 *   neighbouring sectors at different levels of detail do not share vertices
 *   along their common edge, and the resulting hairline gap shows the sky
 *   through the ground. The skirt fills it without pretending the edges match.
 */

/**
 * Border apron depth.
 *
 * Sized from the sector's own relief rather than fixed. A neighbour built one
 * level of detail coarser samples the shared edge at half the resolution, so the
 * two edges can differ by a large fraction of the sector's height range; a fixed
 * 260 m apron was shallower than that difference in hilly sectors and the gap
 * showed as a black crack running down the seam.
 */
const MIN_SKIRT_DEPTH_METERS = 500;
const MAX_SKIRT_DEPTH_METERS = 3_000;
const SKIRT_RELIEF_FRACTION = 0.9;

function skirtDepthFor(terrain: SectorTerrain): number {
  const relief = terrain.maxElevationMeters - terrain.minElevationMeters;
  return Math.min(MAX_SKIRT_DEPTH_METERS, Math.max(MIN_SKIRT_DEPTH_METERS, relief * SKIRT_RELIEF_FRACTION));
}
const PLAYER_MARKER_HEIGHT_METERS = 75;

interface SectorNode {
  readonly root: TransformNode;
  readonly basis: TangentBasis;
  readonly centre: GeoPosition;
  readonly meshes: PooledMesh[];
  readonly gpuBytes: number;
  /** Water sheet and what is needed to animate it, or null for a dry sector. */
  readonly water: WaterSheet | null;
}

/**
 * A sector's water surface, kept ready to animate.
 *
 * `positions` is the live vertex array; only the vertical component is rewritten
 * each frame. `fieldEast`/`fieldNorth` place the sheet in globe-fixed wave
 * coordinates, so neighbouring sectors share one continuous sea and a floating
 * origin rebase does not shift it.
 */
interface WaterSheet {
  readonly mesh: Mesh;
  readonly positions: Float32Array;
  readonly vertexCount: number;
  readonly fieldEast: number;
  readonly fieldNorth: number;
  /** Distance from the sector centre to the player, refreshed each update. */
  distanceMeters: number;
}

interface PooledMesh {
  readonly kind: string;
  readonly mesh: Mesh;
}

export interface SectorRendererOptions {
  readonly scene: Scene;
  /** Current floating-origin anchor. Read on every upload and on every rebase. */
  anchor(): GeoPosition;
  /** Drives water resolution, wave octaves and how many sheets animate. */
  readonly quality: QualityPreset;
}

export interface RendererStats {
  readonly sectorNodes: number;
  readonly meshes: number;
  readonly pooledMeshes: number;
  readonly thinInstances: number;
  readonly estimatedGpuBytes: number;
}

export class SectorRenderer implements SectorSink {
  private readonly scene: Scene;
  private readonly anchorOf: () => GeoPosition;
  private readonly root: TransformNode;
  private readonly nodes = new Map<SectorId, SectorNode>();
  private readonly pool = new Map<string, Mesh[]>();
  private readonly materials: StandardMaterial[] = [];
  private readonly groundMaterial: StandardMaterial;
  private readonly waterMaterial: StandardMaterial;
  private readonly buildingMaterial: StandardMaterial;
  private readonly landmarkMaterial: StandardMaterial;
  private readonly trafficMaterial: StandardMaterial;
  private readonly playerMarker: Mesh;
  private readonly fill: HemisphericLight;
  private thinInstanceCount = 0;
  private quality: QualityPreset;
  private disposed = false;

  constructor(options: SectorRendererOptions) {
    this.scene = options.scene;
    this.anchorOf = options.anchor;
    this.quality = options.quality;
    this.root = new TransformNode("sectorRenderer", this.scene);

    this.groundMaterial = this.material("sector.ground", new Color3(1, 1, 1));
    this.waterMaterial = this.material("sector.water", new Color3(0.09, 0.24, 0.38));
    this.waterMaterial.alpha = 0.72;
    this.waterMaterial.specularColor = new Color3(0.35, 0.4, 0.45);
    this.buildingMaterial = this.material("sector.building", new Color3(0.52, 0.54, 0.58));
    this.landmarkMaterial = this.material("sector.landmark", new Color3(0.86, 0.62, 0.24));
    this.landmarkMaterial.emissiveColor = new Color3(0.24, 0.16, 0.05);
    this.trafficMaterial = this.material("sector.traffic", new Color3(0.92, 0.86, 0.55));
    this.trafficMaterial.emissiveColor = new Color3(0.35, 0.32, 0.18);

    this.playerMarker = MeshBuilder.CreateBox(
      "sectorRenderer.player",
      { width: 26, depth: 26, height: PLAYER_MARKER_HEIGHT_METERS },
      this.scene,
    );
    const playerMaterial = this.material("sector.player", new Color3(0.95, 0.96, 0.99));
    playerMaterial.emissiveColor = new Color3(0.4, 0.42, 0.5);
    this.playerMarker.material = playerMaterial;
    this.playerMarker.parent = this.root;
    this.playerMarker.position = new Vector3(0, PLAYER_MARKER_HEIGHT_METERS / 2, 0);

    // The boot scene lights one object from one direction, which leaves most of
    // a landscape black. This light belongs to the ground view and dies with it.
    this.fill = new HemisphericLight("sectorRenderer.fill", new Vector3(0.25, 1, -0.35), this.scene);
    this.fill.intensity = 0.85;
    this.fill.groundColor = new Color3(0.14, 0.15, 0.18);
  }

  private material(name: string, colour: Color3): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = colour;
    material.specularColor = Color3.Black();
    this.materials.push(material);
    return material;
  }

  /** Builds every mesh for one sector and places it in the current anchor frame. */
  upload(terrain: SectorTerrain): void {
    if (this.disposed) return;
    // Re-uploading an id that is already present would orphan its meshes.
    this.release(terrain.sectorId);

    const centre = sectorCentre(parseSectorId(terrain.sectorId));
    const basis = tangentBasisAt(centre);
    const root = new TransformNode(`sector.${terrain.sectorId}`, this.scene);
    root.parent = this.root;

    const meshes: PooledMesh[] = [];
    let gpuBytes = 0;

    const ground = this.buildGround(terrain, basis);
    ground.mesh.parent = root;
    meshes.push(ground);
    gpuBytes += ground.bytes;

    let waterSheet: WaterSheet | null = null;
    if (terrain.waterFraction > 0) {
      const water = this.buildWater(terrain, basis);
      water.mesh.parent = root;
      meshes.push(water);
      gpuBytes += water.bytes;
      const field = waveFieldCoordinates(centre.latitudeDeg, centre.longitudeDeg);
      waterSheet = {
        mesh: water.mesh,
        positions: water.positions,
        vertexCount: water.positions.length / 3,
        fieldEast: field.east,
        fieldNorth: field.north,
        distanceMeters: Infinity,
      };
    }

    const buildings = this.buildCityInstances(terrain, basis);
    if (buildings) {
      buildings.mesh.parent = root;
      meshes.push(buildings);
      gpuBytes += buildings.bytes;
    }

    const landmarks = this.buildLandmarkInstances(terrain, basis);
    if (landmarks) {
      landmarks.mesh.parent = root;
      meshes.push(landmarks);
      gpuBytes += landmarks.bytes;
    }

    const traffic = this.buildTrafficInstances(terrain, basis);
    if (traffic) {
      traffic.mesh.parent = root;
      meshes.push(traffic);
      gpuBytes += traffic.bytes;
    }

    const node: SectorNode = {
      root,
      basis,
      centre,
      meshes: meshes.map(({ kind, mesh }) => ({ kind, mesh })),
      gpuBytes,
      water: waterSheet,
    };
    this.nodes.set(terrain.sectorId, node);
    this.placeNode(node, tangentBasisAt(this.anchorOf()));
  }

  sleep(sectorId: SectorId): void {
    const node = this.nodes.get(sectorId);
    if (node) node.root.setEnabled(false);
  }

  wake(sectorId: SectorId): void {
    const node = this.nodes.get(sectorId);
    if (node) node.root.setEnabled(true);
  }

  release(sectorId: SectorId): void {
    const node = this.nodes.get(sectorId);
    if (!node) return;
    this.nodes.delete(sectorId);
    for (const pooled of node.meshes) this.recycle(pooled);
    node.root.dispose();
  }

  /**
   * Re-places every sector root against a new anchor. Called after a floating
   * origin rebase; vertex buffers are untouched.
   */
  rebase(): void {
    if (this.disposed) return;
    const anchorBasis = tangentBasisAt(this.anchorOf());
    for (const node of this.nodes.values()) this.placeNode(node, anchorBasis);
  }

  /** Moves the player marker within the current anchor frame. */
  setPlayerLocal(east: number, up: number, north: number): void {
    this.playerMarker.position.set(east, up + PLAYER_MARKER_HEIGHT_METERS / 2, north);
  }

  stats(): RendererStats {
    let meshes = 0;
    let bytes = 0;
    for (const node of this.nodes.values()) {
      meshes += node.meshes.length;
      bytes += node.gpuBytes;
    }
    let pooled = 0;
    for (const list of this.pool.values()) pooled += list.length;
    return {
      sectorNodes: this.nodes.size,
      meshes,
      pooledMeshes: pooled,
      thinInstances: this.thinInstanceCount,
      estimatedGpuBytes: bytes,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const sectorId of [...this.nodes.keys()]) this.release(sectorId);
    for (const list of this.pool.values()) for (const mesh of list) mesh.dispose();
    this.pool.clear();
    this.playerMarker.dispose();
    this.fill.dispose();
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    this.root.dispose();
    this.thinInstanceCount = 0;
  }

  /**
   * Places a sector root so its own tangent frame lines up with the anchor frame.
   *
   * The two frames differ by a rotation as well as a translation, which is the
   * same fact that makes `rebaseLocal` necessary in the world layer. Composing
   * the basis change into a matrix keeps it exact at any separation.
   */
  private placeNode(node: SectorNode, anchorBasis: TangentBasis): void {
    const axis = (v: EcefPosition): Vector3 =>
      new Vector3(
        v.x * anchorBasis.east.x + v.y * anchorBasis.east.y + v.z * anchorBasis.east.z,
        v.x * anchorBasis.up.x + v.y * anchorBasis.up.y + v.z * anchorBasis.up.z,
        v.x * anchorBasis.north.x + v.y * anchorBasis.north.y + v.z * anchorBasis.north.z,
      );

    const x = axis(node.basis.east);
    const y = axis(node.basis.up);
    const z = axis(node.basis.north);
    const origin = ecefToLocal(anchorBasis, node.basis.origin);

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
    node.root.rotationQuaternion = rotation;
    node.root.position = position;
  }

  /** Takes a mesh of this kind from the pool, or makes one. */
  private take(kind: string, create: () => Mesh): Mesh {
    const list = this.pool.get(kind);
    const reused = list?.pop();
    if (reused) {
      reused.setEnabled(true);
      return reused;
    }
    return create();
  }

  private recycle(pooled: PooledMesh): void {
    const { mesh, kind } = pooled;
    mesh.parent = null;
    mesh.setEnabled(false);
    if (mesh.thinInstanceCount > 0) {
      this.thinInstanceCount -= mesh.thinInstanceCount;
      mesh.thinInstanceCount = 0;
    }
    const list = this.pool.get(kind);
    if (list) list.push(mesh);
    else this.pool.set(kind, [mesh]);
  }

  /**
   * Grid mesh from the terrain's ECEF vertices, expressed in the sector's own
   * frame, plus a skirt around the border.
   */
  private buildGround(terrain: SectorTerrain, basis: TangentBasis): PooledMesh & { bytes: number } {
    const kind = `ground.lod${terrain.lod}`;
    const mesh = this.take(kind, () => {
      const created = new Mesh(`sector.ground.lod${terrain.lod}`, this.scene);
      created.material = this.groundMaterial;
      created.useVertexColors = true;
      created.isPickable = false;
      return created;
    });

    const data = buildGridVertexData(terrain, basis, biomeColour(terrain), skirtDepthFor(terrain));
    data.applyToMesh(mesh, true);
    mesh.name = `sector.ground.${terrain.sectorId}`;
    return { kind, mesh, bytes: estimateMeshBytes(data) };
  }

  /**
   * Water is a curved sheet at sea level rather than a flat plane. Over an 11 km
   * sector a flat plane sits about 120 m above the sphere at the corners, which
   * puts the sea visibly on top of the coast it is supposed to meet.
   */
  private buildWater(
    terrain: SectorTerrain,
    basis: TangentBasis,
  ): PooledMesh & { bytes: number; positions: Float32Array } {
    const kind = "water";
    const mesh = this.take(kind, () => {
      const created = new Mesh("sector.water", this.scene);
      created.material = this.waterMaterial;
      created.isPickable = false;
      return created;
    });

    // Resolution comes from the quality preset: this is the one mesh in the
    // scene whose vertex count is a live performance dial.
    const resolution = this.quality.waterGridResolution;
    const flat: SectorTerrain = {
      ...terrain,
      gridResolution: resolution,
      positions: seaLevelGrid(terrain, resolution),
      heights: new Float32Array(resolution * resolution),
      surfaces: new Uint8Array(resolution * resolution),
    };
    const data = buildGridVertexData(flat, basis, null, 0);
    // Updatable: the vertical component of every vertex is rewritten each frame
    // for the nearest sectors, which is how waves move without a shader.
    data.applyToMesh(mesh, true);
    mesh.name = `sector.water.${terrain.sectorId}`;
    const positions = (data.positions as Float32Array) ?? new Float32Array(0);
    return { kind, mesh, bytes: estimateMeshBytes(data), positions };
  }

  /**
   * Animates the sea.
   *
   * Only the nearest `animatedWaterSectors` sheets are updated, and only their
   * vertical component: everything further away holds still at sea level, which
   * is indistinguishable at that distance and costs nothing. Wave height comes
   * from the same `sampleWaveHeight` gameplay uses, so what the player sees the
   * water doing is what the water is actually doing.
   */
  updateWater(sample: EnvironmentSample, playerLocal: { east: number; north: number }): void {
    if (this.disposed) return;
    const sheets: WaterSheet[] = [];
    for (const node of this.nodes.values()) {
      if (!node.water || !node.root.isEnabled()) continue;
      node.water.distanceMeters = Math.hypot(
        node.root.position.x - playerLocal.east,
        node.root.position.z - playerLocal.north,
      );
      sheets.push(node.water);
    }
    sheets.sort((a, b) => a.distanceMeters - b.distanceMeters);

    const budget = Math.max(1, this.quality.animatedWaterSectors);
    const octaves = this.quality.waterWaveOctaves;
    const weather = sample.weather;

    for (let index = 0; index < sheets.length && index < budget; index += 1) {
      const sheet = sheets[index];
      if (!sheet) continue;
      for (let vertex = 0; vertex < sheet.vertexCount; vertex += 1) {
        const offset = vertex * 3;
        sheet.positions[offset + 1] = sampleWaveHeight({
          east: sheet.fieldEast + (sheet.positions[offset] ?? 0),
          north: sheet.fieldNorth + (sheet.positions[offset + 2] ?? 0),
          timeSeconds: sample.tick,
          windSpeedMps: weather.windSpeedMps,
          windDirectionDeg: weather.windDirectionDeg,
          octaves,
        });
      }
      sheet.mesh.updateVerticesData("position", sheet.positions, false, false);
    }
  }

  setQuality(quality: QualityPreset): void {
    this.quality = quality;
  }

  private buildCityInstances(
    terrain: SectorTerrain,
    basis: TangentBasis,
  ): (PooledMesh & { bytes: number }) | null {
    if (terrain.cityCells.length === 0) return null;
    const mesh = this.take("building", () => {
      const created = MeshBuilder.CreateBox("sector.building", { size: 1 }, this.scene);
      created.material = this.buildingMaterial;
      created.isPickable = false;
      return created;
    });

    const matrices = new Float32Array(terrain.cityCells.length * 16);
    terrain.cityCells.forEach((cell, index) => {
      const local = ecefToLocal(basis, { x: cell.x, y: cell.y, z: cell.z });
      composeInstance(
        matrices,
        index,
        new Vector3(cell.footprintMeters, cell.heightMeters, cell.footprintMeters),
        cell.rotationRadians,
        // Boxes are centred, so lift by half the height to stand it on the ground.
        new Vector3(local.east, local.up + cell.heightMeters / 2, local.north),
      );
    });
    return this.applyInstances(mesh, "building", matrices, terrain.cityCells.length, terrain.sectorId);
  }

  private buildLandmarkInstances(
    terrain: SectorTerrain,
    basis: TangentBasis,
  ): (PooledMesh & { bytes: number }) | null {
    if (terrain.landmarks.length === 0) return null;
    const mesh = this.take("landmark", () => {
      const created = MeshBuilder.CreateCylinder(
        "sector.landmark",
        { height: 1, diameterTop: 0.25, diameterBottom: 1, tessellation: 8 },
        this.scene,
      );
      created.material = this.landmarkMaterial;
      created.isPickable = false;
      return created;
    });

    const matrices = new Float32Array(terrain.landmarks.length * 16);
    terrain.landmarks.forEach((landmark, index) => {
      const local = ecefToLocal(basis, { x: landmark.x, y: landmark.y, z: landmark.z });
      composeInstance(
        matrices,
        index,
        new Vector3(18, landmark.heightMeters, 18),
        0,
        new Vector3(local.east, local.up + landmark.heightMeters / 2, local.north),
      );
    });
    return this.applyInstances(mesh, "landmark", matrices, terrain.landmarks.length, terrain.sectorId);
  }

  /**
   * Markers spaced along each lane. These are a static representation of traffic
   * density, not vehicles: nothing here moves, routes, or reacts.
   */
  private buildTrafficInstances(
    terrain: SectorTerrain,
    basis: TangentBasis,
  ): (PooledMesh & { bytes: number }) | null {
    let total = 0;
    for (const lane of terrain.trafficLanes) total += lane.markerCount;
    if (total === 0) return null;

    const mesh = this.take("traffic", () => {
      const created = MeshBuilder.CreateBox("sector.traffic", { size: 1 }, this.scene);
      created.material = this.trafficMaterial;
      created.isPickable = false;
      return created;
    });

    const matrices = new Float32Array(total * 16);
    let index = 0;
    for (const lane of terrain.trafficLanes) {
      const pointCount = lane.points.length / 3;
      for (let marker = 0; marker < lane.markerCount; marker += 1) {
        const t = lane.markerCount === 1 ? 0.5 : marker / (lane.markerCount - 1);
        const at = Math.min(pointCount - 1, Math.round(t * (pointCount - 1)));
        const local = ecefToLocal(basis, {
          x: lane.points[at * 3] ?? 0,
          y: lane.points[at * 3 + 1] ?? 0,
          z: lane.points[at * 3 + 2] ?? 0,
        });
        composeInstance(
          matrices,
          index,
          new Vector3(26, 10, 44),
          0,
          new Vector3(local.east, local.up + 5, local.north),
        );
        index += 1;
      }
    }
    return this.applyInstances(mesh, "traffic", matrices, total, terrain.sectorId);
  }

  private applyInstances(
    mesh: Mesh,
    kind: string,
    matrices: Float32Array,
    count: number,
    sectorId: SectorId,
  ): PooledMesh & { bytes: number } {
    mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
    mesh.name = `sector.${kind}.${sectorId}`;
    this.thinInstanceCount += count;
    return { kind, mesh, bytes: matrices.byteLength };
  }
}

/** Biome tint for a sector, looked up once rather than per vertex. */
function biomeColour(terrain: SectorTerrain): readonly [number, number, number] {
  const biome = BIOME_DEFINITIONS.find((entry) => entry.id === terrain.biomeId);
  return biome?.colour ?? [0.3, 0.4, 0.3];
}

/** Sea-level ECEF grid at the requested resolution, reusing the sector's own corners. */
function seaLevelGrid(terrain: SectorTerrain, resolution: number): Float64Array {
  const source = terrain.gridResolution;
  const grid = new Float64Array(resolution * resolution * 3);
  for (let j = 0; j < resolution; j += 1) {
    for (let i = 0; i < resolution; i += 1) {
      const si = Math.round((i / (resolution - 1)) * (source - 1));
      const sj = Math.round((j / (resolution - 1)) * (source - 1));
      const from = (sj * source + si) * 3;
      const x = terrain.positions[from] ?? 0;
      const y = terrain.positions[from + 1] ?? 0;
      const z = terrain.positions[from + 2] ?? 0;
      // Renormalise back to sea level: the source vertex carries its elevation.
      const length = Math.hypot(x, y, z) || 1;
      const height = terrain.heights[sj * source + si] ?? 0;
      const scale = (length - height) / length;
      const to = (j * resolution + i) * 3;
      grid[to] = x * scale;
      grid[to + 1] = y * scale;
      grid[to + 2] = z * scale;
    }
  }
  return grid;
}

/**
 * Turns a sector's ECEF grid into Babylon vertex data in the sector's own frame,
 * optionally with a border skirt and per-vertex biome colours.
 */
function buildGridVertexData(
  terrain: SectorTerrain,
  basis: TangentBasis,
  colour: readonly [number, number, number] | null,
  skirtDepthMeters: number,
): VertexData {
  const n = terrain.gridResolution;
  const gridVertices = n * n;
  const withSkirt = skirtDepthMeters > 0;
  const border = withSkirt ? 4 * (n - 1) : 0;
  const positions = new Float32Array((gridVertices + border) * 3);
  const colours = colour ? new Float32Array((gridVertices + border) * 4) : null;

  for (let index = 0; index < gridVertices; index += 1) {
    const local = ecefToLocal(basis, {
      x: terrain.positions[index * 3] ?? 0,
      y: terrain.positions[index * 3 + 1] ?? 0,
      z: terrain.positions[index * 3 + 2] ?? 0,
    });
    positions[index * 3] = local.east;
    positions[index * 3 + 1] = local.up;
    positions[index * 3 + 2] = local.north;

    if (colours && colour) {
      const shade = SURFACE_CLASSES[terrain.surfaces[index] ?? 0]?.shade ?? 1;
      colours[index * 4] = Math.min(1, colour[0] * shade);
      colours[index * 4 + 1] = Math.min(1, colour[1] * shade);
      colours[index * 4 + 2] = Math.min(1, colour[2] * shade);
      colours[index * 4 + 3] = 1;
    }
  }

  const indices: number[] = [];
  for (let j = 0; j < n - 1; j += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  if (withSkirt) {
    const ring = borderRing(n);
    ring.forEach((vertex, step) => {
      const skirtIndex = gridVertices + step;
      positions[skirtIndex * 3] = positions[vertex * 3] ?? 0;
      positions[skirtIndex * 3 + 1] = (positions[vertex * 3 + 1] ?? 0) - skirtDepthMeters;
      positions[skirtIndex * 3 + 2] = positions[vertex * 3 + 2] ?? 0;
      if (colours) {
        colours[skirtIndex * 4] = colours[vertex * 4] ?? 0;
        colours[skirtIndex * 4 + 1] = colours[vertex * 4 + 1] ?? 0;
        colours[skirtIndex * 4 + 2] = colours[vertex * 4 + 2] ?? 0;
        colours[skirtIndex * 4 + 3] = 1;
      }
    });
    for (let step = 0; step < ring.length; step += 1) {
      const nextStep = (step + 1) % ring.length;
      const top = ring[step] ?? 0;
      const nextTop = ring[nextStep] ?? 0;
      const bottom = gridVertices + step;
      const nextBottom = gridVertices + nextStep;
      // Both windings: the ring runs clockwise on some faces and anticlockwise on
      // others, and a skirt that is only visible from one side defeats the point.
      indices.push(top, bottom, nextTop, nextTop, bottom, nextBottom);
      indices.push(nextTop, bottom, top, nextBottom, bottom, nextTop);
    }
  }

  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  if (colours) data.colors = colours;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  return data;
}

/** Border vertex indices of an n by n grid, walked once around the edge. */
function borderRing(n: number): number[] {
  const ring: number[] = [];
  for (let i = 0; i < n - 1; i += 1) ring.push(i);
  for (let j = 0; j < n - 1; j += 1) ring.push(j * n + (n - 1));
  for (let i = n - 1; i > 0; i -= 1) ring.push((n - 1) * n + i);
  for (let j = n - 1; j > 0; j -= 1) ring.push(j * n);
  return ring;
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

/** Rough GPU cost: positions, normals, colours and indices. */
function estimateMeshBytes(data: VertexData): number {
  const vertexCount = (data.positions?.length ?? 0) / 3;
  const indexCount = data.indices?.length ?? 0;
  return vertexCount * (3 * 4 + 3 * 4 + 4 * 4) + indexCount * 4;
}
