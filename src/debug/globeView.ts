import {
  Color3,
  HemisphericLight,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  type ArcRotateCamera,
  type Mesh,
  type Scene,
} from "@babylonjs/core";
import type { ContentRegistry } from "../data/registry";
import { WORLD_RADIUS_METERS, geoToEcef, type GeoPosition } from "../world/coordinates";
import { sectorCentre, parseSectorId, sectorNeighbors, sectorId } from "../world/cubeSphere";
import type { RegionDefinition } from "../world/regions";
import type { WorldState } from "../world/worldState";

/**
 * Two views of the same planet.
 *
 * The globe is a cheap low-detail sphere with a marker per region, standing in
 * for every part of the world that is only a strategic record. The active sector
 * is drawn separately at ground level, in the local tangent frame, and is the
 * only place that would ever receive combat geometry.
 *
 * Owns every node and material it creates and releases them all in dispose().
 */

/** Globe is drawn at a convenient on-screen size, not at world scale. */
const GLOBE_DISPLAY_RADIUS = 40;
const MARKER_RADIUS = 1.1;

export interface GlobeViewOptions {
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly world: WorldState;
  readonly regions: ContentRegistry<RegionDefinition>;
}

export class GlobeView {
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly world: WorldState;
  private readonly root: TransformNode;
  private readonly globe: Mesh;
  private readonly markers = new Map<string, Mesh>();
  private readonly materials: StandardMaterial[] = [];
  private readonly sectorTiles: Mesh[] = [];
  private readonly playerMarker: Mesh;
  private readonly fill: HemisphericLight;
  private readonly activeTileMaterial: StandardMaterial;
  private readonly neighborTileMaterial: StandardMaterial;
  private disposed = false;

  constructor(options: GlobeViewOptions) {
    this.scene = options.scene;
    this.camera = options.camera;
    this.world = options.world;

    this.root = new TransformNode("globeView", this.scene);

    this.globe = MeshBuilder.CreateSphere(
      "globeView.globe",
      { diameter: GLOBE_DISPLAY_RADIUS * 2, segments: 32 },
      this.scene,
    );
    this.globe.material = this.material("globeView.ocean", new Color3(0.09, 0.19, 0.32));
    this.globe.parent = this.root;

    const deployment = this.material("globeView.deployment", new Color3(0.32, 0.78, 0.95), true);
    const strategic = this.material("globeView.strategic", new Color3(0.85, 0.6, 0.2), true);

    for (const region of options.regions.all()) {
      const marker = MeshBuilder.CreateSphere(
        `globeView.marker.${region.id}`,
        { diameter: MARKER_RADIUS * 2, segments: 8 },
        this.scene,
      );
      marker.position = this.globePoint(region.centre);
      marker.material = region.deploymentPoint ? deployment : strategic;
      marker.parent = this.root;
      this.markers.set(region.id, marker);
    }

    this.playerMarker = MeshBuilder.CreateSphere(
      "globeView.player",
      { diameter: MARKER_RADIUS * 2.4, segments: 10 },
      this.scene,
    );
    this.playerMarker.material = this.material("globeView.player.mat", new Color3(0.95, 0.95, 0.98), true);
    this.playerMarker.parent = this.root;

    // The boot scene lights one object from a single direction, which leaves
    // half the planet unreadable. Fill light belongs to the globe view and is
    // torn down with it.
    this.fill = new HemisphericLight("globeView.fill", new Vector3(0.3, 1, -0.4), this.scene);
    this.fill.intensity = 0.9;
    this.fill.groundColor = new Color3(0.12, 0.16, 0.22);

    // Built once: refresh() rebuilds the tile meshes, and creating materials
    // there would leak a pair on every walk step.
    this.activeTileMaterial = this.material("globeView.sector.active", new Color3(0.95, 0.35, 0.28), true);
    this.neighborTileMaterial = this.material("globeView.sector.neighbor", new Color3(0.4, 0.45, 0.5));
    // Flat markers laid on a curved surface: which way the disc happens to face
    // should not decide whether it is visible.
    this.activeTileMaterial.backFaceCulling = false;
    this.neighborTileMaterial.backFaceCulling = false;

    this.buildSectorTiles();
    this.refresh();
  }

  /** Projects a global position onto the display globe. */
  private globePoint(position: GeoPosition): Vector3 {
    const ecef = geoToEcef({ ...position, altitudeMeters: 0 });
    const scale = GLOBE_DISPLAY_RADIUS / WORLD_RADIUS_METERS;
    return new Vector3(ecef.x * scale, ecef.y * scale, ecef.z * scale);
  }

  private material(name: string, colour: Color3, emissive = false): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = colour;
    material.specularColor = Color3.Black();
    if (emissive) material.emissiveColor = colour.scale(0.55);
    this.materials.push(material);
    return material;
  }

  /**
   * Marks the active sector and its immediate neighbours on the globe. Only the
   * active one would ever be promoted to combat detail; the neighbours are shown
   * because they are what streaming would load next.
   */
  private buildSectorTiles(): void {
    const activeId = this.world.activeSectorId;
    const ids = [activeId, ...sectorNeighbors(parseSectorId(activeId)).map(sectorId)];

    for (const [index, id] of ids.entries()) {
      const tile = MeshBuilder.CreateDisc(
        `globeView.sector.${id}`,
        { radius: index === 0 ? 3.2 : 2.2, tessellation: 24 },
        this.scene,
      );
      const centre = this.globePoint(sectorCentre(parseSectorId(id)));
      // Lift slightly off the surface and lie flat against it.
      tile.position = centre.scale(1.02);
      tile.lookAt(centre.scale(2));
      tile.material = index === 0 ? this.activeTileMaterial : this.neighborTileMaterial;
      tile.parent = this.root;
      this.sectorTiles.push(tile);
    }
  }

  /** Re-reads world state and moves the markers to match. Cheap enough to call on any change. */
  refresh(): void {
    if (this.disposed) return;
    this.playerMarker.position = this.globePoint(this.world.playerPosition).scale(1.03);

    for (const tile of this.sectorTiles) tile.dispose();
    this.sectorTiles.length = 0;
    this.buildSectorTiles();
  }

  /**
   * Frames the globe from over the player, so opening the map shows where you
   * are rather than the far side of the planet.
   */
  frameGlobe(): void {
    this.camera.setTarget(Vector3.Zero());
    this.camera.radius = GLOBE_DISPLAY_RADIUS * 3;
    this.camera.lowerRadiusLimit = GLOBE_DISPLAY_RADIUS * 1.2;
    this.camera.upperRadiusLimit = GLOBE_DISPLAY_RADIUS * 8;
    this.lookAtPlayer();
  }

  /**
   * Points the orbit camera at the player. Called only on deliberate framing,
   * never from refresh, so it cannot fight the player orbiting the globe.
   */
  lookAtPlayer(): void {
    const point = this.globePoint(this.world.playerPosition).normalize();
    // Babylon's ArcRotateCamera places itself at
    // (cos a sin b, cos b, sin a sin b), so invert that for the player direction.
    this.camera.beta = Math.acos(Math.min(1, Math.max(-1, point.y)));
    this.camera.alpha = Math.atan2(point.z, point.x);
  }

  get displayRadius(): number {
    return GLOBE_DISPLAY_RADIUS;
  }

  get markerCount(): number {
    return this.markers.size;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const tile of this.sectorTiles) tile.dispose();
    this.sectorTiles.length = 0;
    for (const marker of this.markers.values()) marker.dispose();
    this.markers.clear();
    this.playerMarker.dispose();
    this.fill.dispose();
    this.globe.dispose();
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    this.root.dispose();
  }
}
