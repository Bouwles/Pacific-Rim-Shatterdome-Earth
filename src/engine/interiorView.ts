import {
  Color3,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  PointLight,
  Quaternion,
  Scene,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector3,
  type Camera,
} from "@babylonjs/core";
import type { AssetResolver, ResolvedAsset } from "../assets/resolver";
import type { AssetManifest } from "../assets/manifest";
import type { ContentRegistry } from "../data/registry";
import type { QualityPreset } from "../data/quality";
import type { InteriorRoom, ObstacleKind, InteractableKind } from "../shatterdome/interiorLayout";
import { activeStaffPoses, shiftLoadFor } from "../shatterdome/staff";
import { ON_FOOT, eyeHeightOf, type OnFootPose } from "../shatterdome/onFoot";

/**
 * The Shatterdome interior, drawn.
 *
 * One room at a time, and only the room the player is standing in. Walking
 * through a door disposes what was built and builds the next one, which is why
 * a hundred-metre Jaeger bay costs nothing while the player is in the archive.
 *
 * Everything here is presentation. The room, the pose and the staff positions
 * are handed in; this file decides only how they look. It owns its own camera
 * because an interior camera is a person's eyes, and the orbit camera the rest
 * of the app uses is not.
 */

/** Interior scale, written down so it can be compared against the Jaeger-scale camera. */
export const INTERIOR_CAMERA = {
  /** Near plane in centimetres, not metres: a person can stand against a console. */
  minZ: 0.05,
  /** The largest interior space is the bay at 130 m; this covers it with headroom. */
  maxZ: 400,
  fovRadians: 1.05,
} as const;

const OBSTACLE_COLOURS: Readonly<Record<ObstacleKind, readonly [number, number, number]>> = {
  fixture: [0.32, 0.35, 0.38],
  scaffold: [0.72, 0.56, 0.18],
  berth: [0.24, 0.26, 0.3],
  crate: [0.4, 0.34, 0.24],
  rail: [0.5, 0.5, 0.54],
};

const INTERACTABLE_COLOURS: Readonly<Record<InteractableKind, readonly [number, number, number]>> = {
  terminal: [0.25, 0.7, 0.9],
  "staff-post": [0.3, 0.32, 0.36],
  berth: [0.9, 0.72, 0.25],
  "conn-pod": [0.35, 0.9, 0.8],
  transit: [0.55, 0.8, 0.55],
};

/**
 * How much each fixture glows.
 *
 * Screens and hatches are lit from inside; a desk and a doorframe are not. A
 * single emissive value for everything turned the whole room into glowing white
 * blocks with no way to tell a console from a workbench.
 */
const INTERACTABLE_GLOW: Readonly<Record<InteractableKind, number>> = {
  terminal: 0.35,
  "staff-post": 0,
  berth: 0.12,
  "conn-pod": 0.3,
  transit: 0.1,
};

/** Sizes for the box that stands in for each fixture, metres. */
const INTERACTABLE_SIZES: Readonly<Record<InteractableKind, readonly [number, number, number]>> = {
  terminal: [1.4, 1.1, 0.7],
  "staff-post": [0.9, 0.95, 0.7],
  berth: [3.2, 1.2, 1.6],
  "conn-pod": [2.6, 3.4, 2.6],
  transit: [2.2, 2.6, 0.35],
};

export interface InteriorViewOptions {
  readonly scene: Scene;
  readonly quality: QualityPreset;
  readonly resolver: AssetResolver;
  readonly assets: ContentRegistry<AssetManifest>;
  /** Roster machine standing in each berth, in berth order. */
  readonly berthAssets: readonly string[];
}

export interface InteriorViewStats {
  readonly roomId: string;
  readonly meshes: number;
  readonly obstacles: number;
  readonly interactables: number;
  readonly staffDrawn: number;
  readonly staffOnShift: number;
  readonly staffBudget: number;
  readonly jaegerModels: number;
  readonly estimatedGpuBytes: number;
}

export class InteriorView {
  private readonly scene: Scene;
  private readonly quality: QualityPreset;
  private readonly resolver: AssetResolver;
  private readonly assets: ContentRegistry<AssetManifest>;
  private readonly berthAssets: readonly string[];

  private readonly root: TransformNode;
  private readonly camera: UniversalCamera;
  private readonly previousCamera: Camera | null;
  private readonly materials: StandardMaterial[] = [];
  private readonly meshes: Mesh[] = [];
  private readonly lights: Array<HemisphericLight | PointLight> = [];
  private readonly resolvedAssets: ResolvedAsset[] = [];

  private staffMesh: Mesh | null = null;
  private staffBuffer: Float32Array = new Float32Array(0);
  private roomValue: InteriorRoom | null = null;
  private staffDrawnValue = 0;
  private staffOnShiftValue = 0;
  private gpuBytes = 0;
  private buildToken = 0;
  private disposed = false;

  constructor(options: InteriorViewOptions) {
    this.scene = options.scene;
    this.quality = options.quality;
    this.resolver = options.resolver;
    this.assets = options.assets;
    this.berthAssets = options.berthAssets;

    this.root = new TransformNode("interiorRoot", this.scene);
    this.previousCamera = this.scene.activeCamera;

    this.camera = new UniversalCamera(
      "interiorCamera",
      new Vector3(0, ON_FOOT.eyeHeightMeters, 0),
      this.scene,
    );
    // Deliberately not attached to the canvas: the pose is authoritative and the
    // camera follows it, so Babylon's own input can never move a player the
    // simulation still believes is standing still.
    this.camera.minZ = INTERIOR_CAMERA.minZ;
    this.camera.maxZ = INTERIOR_CAMERA.maxZ;
    this.camera.fov = INTERIOR_CAMERA.fovRadians;
    this.scene.activeCamera = this.camera;

    const ambient = new HemisphericLight("interiorAmbient", new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.6;
    // Downward-facing surfaces are lit too, or the ceiling of an enclosed room
    // renders as a black hole above the player rather than as a ceiling.
    ambient.groundColor = new Color3(0.34, 0.35, 0.38);
    this.lights.push(ambient);
  }

  get activeRoomId(): string | null {
    return this.roomValue?.id ?? null;
  }

  /**
   * Builds a room and returns once its models are in.
   *
   * Jaeger models resolve asynchronously, so the promise matters: a test that
   * asserts a berth has a machine in it has to be able to wait for it, and a
   * room disposed mid-load must not attach one afterwards.
   */
  async setRoom(room: InteriorRoom): Promise<void> {
    this.clearRoom();
    if (this.disposed) return;
    this.roomValue = room;
    const token = ++this.buildToken;

    this.buildShell(room);
    this.buildObstacles(room);
    this.buildInteractables(room);
    this.buildStaffPool(room);
    this.buildLights(room);

    await this.buildBerthModels(room, token);
  }

  /** Places the camera and moves the staff. Called every frame. */
  update(pose: OnFootPose, tick: number, dayFraction: number): void {
    if (this.disposed) return;
    this.camera.position.set(pose.x, eyeHeightOf(pose), pose.z);
    // Yaw is measured from +Z the way every bearing in this project is, and
    // Babylon's Y rotation shares that convention, so no correction is needed.
    this.camera.rotation.set((-pose.pitchDeg * Math.PI) / 180, (pose.yawDeg * Math.PI) / 180, 0);

    const room = this.roomValue;
    const mesh = this.staffMesh;
    if (!room || !mesh) return;

    const poses = activeStaffPoses(room, tick, dayFraction, this.quality.maxInteriorStaff);
    // What the room is staffed at, against what the budget lets us draw. Reporting
    // only the drawn figure would hide a room whose crew is over budget.
    this.staffOnShiftValue = shiftLoadFor(room.facilityId, room.staffSlots, dayFraction).onShift;
    const count = Math.min(poses.length, this.staffBuffer.length / 16);
    for (let index = 0; index < count; index += 1) {
      const staff = poses[index];
      if (!staff) continue;
      composeInto(
        this.staffBuffer,
        index,
        staff.x,
        0.9,
        staff.z,
        (staff.yawDeg * Math.PI) / 180,
        0.55,
        1.8,
        0.4,
      );
    }
    mesh.thinInstanceCount = count;
    if (count !== this.staffDrawnValue) {
      // Re-registering the buffer rather than marking it updated.
      //
      // The pool is allocated with a count of zero, and on WebGPU a thin-instance
      // buffer whose count grows from zero is not picked up by
      //  alone: the room reported six people drawn and
      // rendered none of them. Setting the buffer again rebuilds the instance
      // binding. It happens when the number of people changes, not every frame.
      mesh.thinInstanceSetBuffer("matrix", this.staffBuffer, 16);
      mesh.thinInstanceCount = count;
      mesh.thinInstanceRefreshBoundingInfo(false);
    } else if (count > 0) {
      mesh.thinInstanceBufferUpdated("matrix");
    }
    this.staffDrawnValue = count;
  }

  stats(): InteriorViewStats {
    const room = this.roomValue;
    return {
      roomId: room?.id ?? "none",
      meshes: this.meshes.length + this.resolvedAssets.length,
      obstacles: room?.obstacles.length ?? 0,
      interactables: room?.interactables.length ?? 0,
      staffDrawn: this.staffDrawnValue,
      staffOnShift: this.staffOnShiftValue,
      staffBudget: this.quality.maxInteriorStaff,
      jaegerModels: this.resolvedAssets.length,
      estimatedGpuBytes: this.gpuBytes,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearRoom();
    for (const light of this.lights) light.dispose();
    this.lights.length = 0;
    this.root.dispose();
    if (this.scene.activeCamera === this.camera) this.scene.activeCamera = this.previousCamera;
    this.camera.dispose();
  }

  /** Frees everything belonging to the room that was standing here. */
  private clearRoom(): void {
    // Bumping the token first means a model still loading attaches to nothing.
    this.buildToken += 1;
    for (const asset of this.resolvedAssets) asset.dispose();
    this.resolvedAssets.length = 0;
    for (const mesh of this.meshes) mesh.dispose();
    this.meshes.length = 0;
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    // Room lights go with the room; the ambient fill in `lights` stays.
    while (this.lights.length > 1) {
      const light = this.lights.pop();
      light?.dispose();
    }
    this.staffMesh = null;
    this.staffBuffer = new Float32Array(0);
    this.staffDrawnValue = 0;
    this.staffOnShiftValue = 0;
    this.gpuBytes = 0;
    this.roomValue = null;
  }

  private material(name: string, colour: readonly [number, number, number], emissive = 0): StandardMaterial {
    const material = new StandardMaterial(`interior.${name}`, this.scene);
    material.diffuseColor = new Color3(colour[0], colour[1], colour[2]);
    material.specularColor = new Color3(0.06, 0.06, 0.07);
    if (emissive > 0) {
      material.emissiveColor = new Color3(colour[0] * emissive, colour[1] * emissive, colour[2] * emissive);
    }
    this.materials.push(material);
    return material;
  }

  private track(mesh: Mesh, bytes: number): Mesh {
    mesh.parent = this.root;
    this.meshes.push(mesh);
    this.gpuBytes += bytes;
    return mesh;
  }

  /** Floor, ceiling and four walls. The room is a box; what makes it a place is what is in it. */
  private buildShell(room: InteriorRoom): void {
    const width = room.widthMeters;
    const depth = room.depthMeters;
    const height = room.heightMeters;

    const floor = MeshBuilder.CreateGround(`interior.floor.${room.id}`, { width, height: depth }, this.scene);
    floor.material = this.material(`floor.${room.id}`, room.floorColour);
    floor.receiveShadows = true;
    this.track(floor, 4 * 32);

    const ceiling = MeshBuilder.CreateGround(
      `interior.ceiling.${room.id}`,
      { width, height: depth },
      this.scene,
    );
    ceiling.position.y = height;
    ceiling.rotation.x = Math.PI;
    // Overhead lighting lives in the ceiling itself: a strip-lit deckhead is what
    // an industrial interior actually looks like, and it costs no extra lights.
    ceiling.material = this.material(
      `ceiling.${room.id}`,
      [room.floorColour[0] * 1.1, room.floorColour[1] * 1.1, room.floorColour[2] * 1.2],
      0.5,
    );
    this.track(ceiling, 4 * 32);

    const wallMaterial = this.material(`wall.${room.id}`, [
      room.floorColour[0] * 1.25,
      room.floorColour[1] * 1.25,
      room.floorColour[2] * 1.3,
    ]);
    // Walls face inward: the player is inside the box, so the outward faces are
    // the ones that must not be drawn over the room.
    wallMaterial.backFaceCulling = false;

    const walls: Array<[string, number, number, number, number, number]> = [
      ["north", 0, height / 2, depth / 2, width, 0.4],
      ["south", 0, height / 2, -depth / 2, width, 0.4],
      ["east", width / 2, height / 2, 0, 0.4, depth],
      ["west", -width / 2, height / 2, 0, 0.4, depth],
    ];
    for (const [name, x, y, z, sizeX, sizeZ] of walls) {
      const wall = MeshBuilder.CreateBox(
        `interior.wall.${room.id}.${name}`,
        { width: sizeX, height, depth: sizeZ },
        this.scene,
      );
      wall.position.set(x, y, z);
      wall.material = wallMaterial;
      wall.receiveShadows = true;
      this.track(wall, 24 * 32);
    }
  }

  /** One mesh per obstacle kind, thin-instanced. Scaffolds are their own kind so they read as work. */
  private buildObstacles(room: InteriorRoom): void {
    const byKind = new Map<ObstacleKind, typeof room.obstacles>();
    for (const obstacle of room.obstacles) {
      const list = byKind.get(obstacle.kind) ?? [];
      byKind.set(obstacle.kind, [...list, obstacle]);
    }

    for (const [kind, obstacles] of byKind) {
      if (obstacles.length === 0) continue;
      const mesh = MeshBuilder.CreateBox(`interior.obstacle.${room.id}.${kind}`, { size: 1 }, this.scene);
      mesh.material = this.material(`obstacle.${room.id}.${kind}`, OBSTACLE_COLOURS[kind]);
      const buffer = new Float32Array(obstacles.length * 16);
      obstacles.forEach((obstacle, index) => {
        composeInto(
          buffer,
          index,
          obstacle.x,
          obstacle.heightMeters / 2,
          obstacle.z,
          0,
          obstacle.halfWidth * 2,
          obstacle.heightMeters,
          obstacle.halfDepth * 2,
        );
      });
      mesh.thinInstanceSetBuffer("matrix", buffer, 16);
      mesh.thinInstanceCount = obstacles.length;
      this.track(mesh, obstacles.length * 64 + 24 * 32);
    }
  }

  /** Terminals, posts, berth markers, the Conn-Pod hatch and the doorways. */
  private buildInteractables(room: InteriorRoom): void {
    const byKind = new Map<InteractableKind, typeof room.interactables>();
    for (const interactable of room.interactables) {
      // A sealed bulkhead gets its own mesh below; drawing the usable fixture
      // underneath it as well put two slabs in the same doorway.
      if (interactable.sealedReason !== null) continue;
      const list = byKind.get(interactable.kind) ?? [];
      byKind.set(interactable.kind, [...list, interactable]);
    }

    for (const [kind, entries] of byKind) {
      const size = INTERACTABLE_SIZES[kind];
      const mesh = MeshBuilder.CreateBox(`interior.fixture.${room.id}.${kind}`, { size: 1 }, this.scene);
      // Working fixtures glow a little: that is what tells a player at a distance
      // which of the shapes in a room can be used.
      mesh.material = this.material(
        `fixture.${room.id}.${kind}`,
        INTERACTABLE_COLOURS[kind],
        INTERACTABLE_GLOW[kind],
      );
      const buffer = new Float32Array(entries.length * 16);
      entries.forEach((entry, index) => {
        composeInto(
          buffer,
          index,
          entry.position.x,
          size[1] / 2,
          entry.position.z,
          (entry.facingDeg * Math.PI) / 180,
          size[0],
          size[1],
          size[2],
        );
      });
      mesh.thinInstanceSetBuffer("matrix", buffer, 16);
      mesh.thinInstanceCount = entries.length;
      this.track(mesh, entries.length * 64 + 24 * 32);
    }

    // Sealed doorways get their own colour, because "you cannot go this way" is
    // information the player needs before they walk across a bay to find out.
    const sealed = room.interactables.filter((entry) => entry.sealedReason !== null);
    if (sealed.length === 0) return;
    const mesh = MeshBuilder.CreateBox(`interior.sealed.${room.id}`, { size: 1 }, this.scene);
    mesh.material = this.material(`sealed.${room.id}`, [0.6, 0.22, 0.2], 0.35);
    const buffer = new Float32Array(sealed.length * 16);
    sealed.forEach((entry, index) => {
      composeInto(
        buffer,
        index,
        entry.position.x,
        1.3,
        entry.position.z,
        (entry.facingDeg * Math.PI) / 180,
        2.2,
        2.6,
        0.3,
      );
    });
    mesh.thinInstanceSetBuffer("matrix", buffer, 16);
    mesh.thinInstanceCount = sealed.length;
    this.track(mesh, sealed.length * 64 + 24 * 32);
  }

  /**
   * One pooled mesh for everybody in the room, allocated at the quality budget.
   *
   * Nobody outside this room exists as anything but a number, and nobody inside
   * it has state: a staff member is an index and a tick.
   */
  private buildStaffPool(room: InteriorRoom): void {
    const capacity = Math.max(1, this.quality.maxInteriorStaff);
    const mesh = MeshBuilder.CreateBox(`interior.staff.${room.id}`, { size: 1 }, this.scene);
    // People are not light sources. A crew member reads as a person because of
    // their silhouette and the way they move, not because they glow.
    mesh.material = this.material(`staff.${room.id}`, [0.58, 0.5, 0.38]);
    this.staffBuffer = new Float32Array(capacity * 16);
    for (let index = 0; index < capacity; index += 1) {
      composeInto(this.staffBuffer, index, 0, -50, 0, 0, 0.55, 1.8, 0.4);
    }
    mesh.thinInstanceSetBuffer("matrix", this.staffBuffer, 16);
    mesh.thinInstanceCount = 0;
    // The pool is allocated with every instance parked below the floor and moves
    // every frame, so its bounding box is never a useful culling test. Keeping it
    // always active is one mesh, and the alternative was a room that reported six
    // people on shift and drew none of them.
    mesh.alwaysSelectAsActiveMesh = true;
    this.staffMesh = this.track(mesh, capacity * 64 + 24 * 32);
  }

  /** Working light, plus a warmer lamp over the fixtures so a room has a direction. */
  private buildLights(room: InteriorRoom): void {
    const lamp = new PointLight(
      `interior.lamp.${room.id}`,
      new Vector3(0, Math.min(room.heightMeters * 0.7, 14), room.depthMeters * 0.1),
      this.scene,
    );
    lamp.diffuse = new Color3(room.accentColour[0], room.accentColour[1], room.accentColour[2]);
    lamp.intensity = room.underConstruction ? 0.5 : 0.95;
    // Range has to cover the room rather than stop halfway across it: at exactly
    // the room width, a Conn-Pod four metres deep read as a black void with one
    // glowing hatch in it.
    lamp.range = Math.max(room.widthMeters, room.depthMeters) * 1.6;
    this.lights.push(lamp);
  }

  /**
   * Stands the roster machines in their berths.
   *
   * This is the first place in the project where a gameplay record resolves to
   * an asset manifest and becomes something you can walk up to. It goes through
   * the resolver like everything else, so a production GLB dropped into
   * public/assets/models replaces the procedural placeholder with no code change.
   */
  private async buildBerthModels(room: InteriorRoom, token: number): Promise<void> {
    const berths = room.interactables.filter((entry) => entry.kind === "berth");
    if (berths.length === 0) return;

    for (let index = 0; index < berths.length; index += 1) {
      const berth = berths[index];
      const assetId = this.berthAssets[index];
      if (!berth || berth.jaegerId === null || assetId === undefined) continue;
      const manifest = this.assets.get(assetId);
      if (!manifest) continue;

      const resolved = await this.resolver.resolve(manifest, this.scene, `berth.${index}`);
      if (this.disposed || token !== this.buildToken) {
        // The player left while this was loading. Free it rather than attaching
        // a machine to a room that no longer exists.
        resolved.dispose();
        return;
      }
      resolved.root.parent = this.root;
      resolved.root.position.set(berth.position.x, 0, berth.position.z + 9);
      resolved.root.rotation = new Vector3(0, Math.PI, 0);
      this.resolvedAssets.push(resolved);
      this.gpuBytes += 256 * 1024;
    }
  }
}

const SCRATCH_QUATERNION = Quaternion.Identity();
const SCRATCH_MATRIX = Matrix.Identity();
const SCRATCH_TRANSLATION = Vector3.Zero();
const SCRATCH_SCALING = Vector3.One();

function composeInto(
  target: Float32Array,
  index: number,
  x: number,
  y: number,
  z: number,
  yawRadians: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
): void {
  SCRATCH_TRANSLATION.set(x, y, z);
  SCRATCH_SCALING.set(scaleX, scaleY, scaleZ);
  Quaternion.RotationAxisToRef(Vector3.Up(), yawRadians, SCRATCH_QUATERNION);
  Matrix.ComposeToRef(SCRATCH_SCALING, SCRATCH_QUATERNION, SCRATCH_TRANSLATION, SCRATCH_MATRIX);
  SCRATCH_MATRIX.copyToArray(target, index * 16);
}
