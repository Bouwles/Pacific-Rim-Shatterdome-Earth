import {
  Color3,
  DynamicTexture,
  HemisphericLight,
  Texture,
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
import type { InteriorRoom, ObstacleKind, InteractableKind, RoomPoint } from "../shatterdome/interiorLayout";
import { activeStaffPoses, shiftLoadFor } from "../shatterdome/staff";
import { ON_FOOT, eyeHeightOf, type OnFootPose } from "../shatterdome/onFoot";
import { PeopleLibrary, type Person, type PersonModelId } from "../assets/people";
import { PropLibrary, type PlacedProp, type PropPlacement } from "../assets/props";
import { JaegerRig } from "./jaegerRig";

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
  fixture: [0.3, 0.33, 0.37],
  scaffold: [0.62, 0.46, 0.14],
  berth: [0.22, 0.24, 0.28],
  crate: [0.33, 0.29, 0.22],
  rail: [0.44, 0.46, 0.5],
};

/**
 * Who works where. Command rooms are operators and an officer; bays are
 * technicians and welders with security at the door; medical has medics.
 */
function castFor(facilityId: string): readonly PersonModelId[] {
  if (facilityId.includes("command") || facilityId.includes("loccent") || facilityId.includes("research")) {
    return ["operator-f", "operator-m", "officer", "operator-f", "technician", "operator-m", "security"];
  }
  if (facilityId.includes("medical") || facilityId.includes("quarters") || facilityId.includes("kwoon")) {
    return ["medic", "officer", "technician", "operator-m", "medic"];
  }
  return ["technician", "welder", "technician", "pilot", "welder", "security", "technician", "operator-m"];
}

const ROLE_COLOURS: Readonly<Record<PersonModelId, Color3>> = {
  "operator-f": new Color3(0.2, 0.32, 0.5),
  "operator-m": new Color3(0.2, 0.32, 0.5),
  officer: new Color3(0.16, 0.18, 0.24),
  technician: new Color3(0.85, 0.45, 0.12),
  welder: new Color3(0.85, 0.45, 0.12),
  security: new Color3(0.22, 0.24, 0.28),
  medic: new Color3(0.9, 0.9, 0.92),
  pilot: new Color3(0.3, 0.32, 0.36),
};

/** Kit pieces per obstacle kind, cycled so a row of crates is not one crate repeated. */
const OBSTACLE_MODELS: Readonly<Partial<Record<ObstacleKind, readonly string[]>>> = {
  fixture: [
    "machine",
    "machine-window",
    "scanner-high",
    "machine-fortified",
    "screen-panel-wide",
    "hopper-square",
  ],
  crate: ["box-large", "box-wide", "box-long", "box-small"],
  scaffold: ["structure-yellow-tall", "structure-yellow-medium", "structure-yellow-high"],
  rail: ["conveyor-bars-fence", "conveyor-bars-stripe-fence"],
};

const INTERACTABLE_MODELS: Readonly<Partial<Record<InteractableKind, readonly string[]>>> = {
  terminal: ["screen-panel-wide", "screen-panel-flat", "screen-wide"],
  "staff-post": ["machine-window", "screen-panel-small", "lever-double"],
  "conn-pod": ["machine-fortified"],
};

/** The nearest usable fixture to a point, for a worker to face. */
function nearestFixture(room: InteriorRoom, x: number, z: number, withinMeters: number): RoomPoint | null {
  let best: RoomPoint | null = null;
  let bestDistance = withinMeters;
  for (const entry of room.interactables) {
    if (entry.kind !== "terminal" && entry.kind !== "staff-post" && entry.kind !== "conn-pod") continue;
    const distance = Math.hypot(entry.position.x - x, entry.position.z - z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry.position;
    }
  }
  return best;
}

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
  private readonly textures: DynamicTexture[] = [];
  private readonly savedFog: { mode: number; density: number; colour: Color3 };
  private readonly meshes: Mesh[] = [];
  private readonly lights: Array<HemisphericLight | PointLight> = [];
  private readonly resolvedAssets: ResolvedAsset[] = [];

  /** The crew: imported animated characters, one per staff post drawn. */
  private readonly people: PeopleLibrary;
  /** The dressing: imported kit pieces standing in for the collision boxes. */
  private readonly props: PropLibrary;
  private readonly roomProps: PlacedProp[] = [];
  /** Machines standing in the berths, when no real model has arrived for them. */
  private readonly berthRigs: JaegerRig[] = [];
  private alertSince: number | null = null;
  private roomSeconds = 0;
  private readonly crew: Array<{ readonly person: Person; readonly slot: number }> = [];
  private crewCapacity = 0;
  private lastUpdateMs: number | null = null;
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
    this.people = new PeopleLibrary(this.scene);
    this.props = new PropLibrary(this.scene);

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
    // Low: the room's own lamps do the lighting, the ambient only keeps the
    // shadow side from going to black.
    ambient.intensity = 0.46;
    ambient.diffuse = new Color3(0.72, 0.8, 0.92);
    // Downward-facing surfaces are lit too, or the ceiling of an enclosed room
    // renders as a black hole above the player rather than as a ceiling.
    ambient.groundColor = new Color3(0.14, 0.15, 0.18);
    this.lights.push(ambient);

    // Haze: the far wall of a bay is dimmer than the near one. Restored on dispose.
    this.savedFog = {
      mode: this.scene.fogMode,
      density: this.scene.fogDensity,
      colour: this.scene.fogColor.clone(),
    };
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.012;
    this.scene.fogColor = new Color3(0.04, 0.05, 0.07);
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
    this.dressRoom(room, token);

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
    if (!room) return;

    const now = typeof performance === "undefined" ? Date.now() : performance.now();
    const deltaSeconds =
      this.lastUpdateMs === null ? 1 / 60 : Math.min(0.1, (now - this.lastUpdateMs) / 1000);
    this.lastUpdateMs = now;

    const poses = activeStaffPoses(room, tick, dayFraction, this.quality.maxInteriorStaff);
    // What the room is staffed at, against what the budget lets us draw. Reporting
    // only the drawn figure would hide a room whose crew is over budget.
    this.staffOnShiftValue = shiftLoadFor(room.facilityId, room.staffSlots, dayFraction).onShift;
    let drawn = 0;
    for (const member of this.crew) {
      const staff = poses[member.slot];
      const person = member.person;
      if (!staff) {
        // Off shift: parked out of sight rather than standing frozen at a post.
        person.root.setEnabled(false);
        continue;
      }
      drawn += 1;
      person.root.setEnabled(true);
      person.root.position.set(staff.x, 0, staff.z);
      let yaw = (staff.yawDeg * Math.PI) / 180;
      if (staff.activity === "working") {
        // Face the console being worked, not the room in general.
        const station = nearestFixture(room, staff.x, staff.z, 4.5);
        if (station) yaw = Math.atan2(station.x - staff.x, station.z - staff.z);
      }
      person.root.rotation.y = yaw;
      const alertAge = this.alertSince === null ? null : this.roomSeconds - this.alertSince;
      if (alertAge !== null && alertAge < 2.4) {
        person.play("react", false);
      } else if (alertAge !== null && staff.activity === "idle") {
        // An alert has everyone at a station; nobody stands around.
        person.play("work");
      } else {
        person.play(staff.activity === "walking" ? "walk" : staff.activity === "working" ? "work" : "idle");
      }
    }
    this.people.update(deltaSeconds);
    this.roomSeconds += deltaSeconds;
    for (const rig of this.berthRigs)
      rig.update({ timeSeconds: this.roomSeconds, speedMps: 0 }, deltaSeconds);
    this.staffDrawnValue = drawn;
  }

  /** An alarm: the crew flinch, then everyone is at a station until it clears. */
  setAlert(on: boolean): void {
    if (on) {
      if (this.alertSince === null) this.alertSince = this.roomSeconds;
    } else {
      this.alertSince = null;
    }
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
    this.people.dispose();
    this.props.dispose();
    this.scene.fogMode = this.savedFog.mode;
    this.scene.fogDensity = this.savedFog.density;
    this.scene.fogColor = this.savedFog.colour;
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
    for (const texture of this.textures) texture.dispose();
    this.textures.length = 0;
    // Room lights go with the room; the ambient fill in `lights` stays.
    while (this.lights.length > 1) {
      const light = this.lights.pop();
      light?.dispose();
    }
    for (const member of this.crew) this.people.release(member.person);
    this.crew.length = 0;
    for (const prop of this.roomProps) prop.dispose();
    this.roomProps.length = 0;
    for (const rig of this.berthRigs) rig.dispose();
    this.berthRigs.length = 0;
    this.crewCapacity = 0;
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
    // Headless engines have no canvas to draw plating on; the flat colour serves.
    const plating = typeof window === "undefined" ? null : this.plateTexture(room);
    const floorMaterial = this.material(`floor.${room.id}`, plating ? [1, 1, 1] : room.floorColour);
    if (plating) floorMaterial.diffuseTexture = plating;
    floorMaterial.specularColor = new Color3(0.14, 0.15, 0.17);
    floorMaterial.specularPower = 32;
    floor.material = floorMaterial;
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
      [room.floorColour[0] * 0.7, room.floorColour[1] * 0.7, room.floorColour[2] * 0.75],
      0.08,
    );
    this.track(ceiling, 4 * 32);

    const wallMaterial = this.material(`wall.${room.id}`, [
      room.floorColour[0] * 0.85,
      room.floorColour[1] * 0.88,
      room.floorColour[2] * 1.0,
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
      // The box is the collision shape and the headless fallback; on a real
      // engine a kit piece stands in it and the box goes unseen.
      if (typeof window !== "undefined" && kind !== "berth") mesh.isVisible = false;
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
        INTERACTABLE_GLOW[kind] * 0.5,
      );
      if (
        typeof window !== "undefined" &&
        (kind === "terminal" || kind === "staff-post" || kind === "conn-pod")
      ) {
        mesh.isVisible = false;
      }
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
  /**
   * Hires the crew: one imported character per staff post the budget allows,
   * cast by the room's work. Loading is asynchronous and guarded by the build
   * token, so a room left while its people were still loading gets nobody.
   */
  private buildStaffPool(room: InteriorRoom): void {
    const capacity = Math.min(Math.max(0, this.quality.maxInteriorStaff), room.staffPosts.length, 15);
    this.crewCapacity = capacity;
    const token = this.buildToken;
    const cast = castFor(room.facilityId);
    for (let slot = 0; slot < capacity; slot += 1) {
      const model = cast[slot % cast.length] ?? "technician";
      void this.people.spawn(model, ROLE_COLOURS[model]).then((person) => {
        if (!person) return;
        if (this.disposed || token !== this.buildToken) {
          this.people.release(person);
          return;
        }
        person.root.parent = this.root;
        person.root.setEnabled(false);
        this.crew.push({ person, slot });
      });
    }
  }

  /**
   * Dresses the room with kit pieces: a console for every terminal, a
   * machine or crate for every obstacle, pipes and a catwalk along the walls,
   * bollards at the doors, and a crane over anything big enough to need one.
   * Loading is asynchronous and guarded by the build token.
   */
  private dressRoom(room: InteriorRoom, token: number): void {
    if (typeof window === "undefined") return;
    const placements: PropPlacement[] = [];
    const pick = <T>(list: readonly T[], index: number): T => list[index % list.length] as T;

    let index = 0;
    for (const obstacle of room.obstacles) {
      const width = obstacle.halfWidth * 2;
      const depth = obstacle.halfDepth * 2;
      const height = obstacle.heightMeters;
      const fit = { width, depth, height };
      const models = OBSTACLE_MODELS[obstacle.kind];
      if (!models) continue;
      placements.push({ kit: "factory", model: pick(models, index), x: obstacle.x, z: obstacle.z, fit });
      index += 1;
    }
    for (const entry of room.interactables) {
      if (entry.sealedReason !== null) continue;
      const models = INTERACTABLE_MODELS[entry.kind];
      if (!models) continue;
      const size = INTERACTABLE_SIZES[entry.kind];
      placements.push({
        kit: "factory",
        model: pick(models, index),
        x: entry.position.x,
        z: entry.position.z,
        yawDeg: entry.facingDeg,
        fit: { width: size[0] * 1.15, height: size[1] * 1.15, depth: size[2] * 1.15 },
      });
      index += 1;
    }

    // Pipes high on the long walls, a catwalk along the north wall, columns.
    const halfW = room.widthMeters / 2;
    const halfD = room.depthMeters / 2;
    const pipeY = Math.min(room.heightMeters - 1.6, 4.2);
    for (let x = -halfW + 2; x < halfW - 2; x += 4) {
      placements.push({
        kit: "factory",
        model: "pipe-large-long",
        x,
        y: pipeY,
        z: halfD - 0.8,
        yawDeg: 0,
        scale: 2,
      });
      placements.push({
        kit: "factory",
        model: "pipe-large-long",
        x,
        y: pipeY - 1.2,
        z: -halfD + 0.8,
        yawDeg: 0,
        scale: 2,
      });
    }
    if (room.heightMeters >= 6) {
      const walkY = Math.min(room.heightMeters - 2.6, 3.6);
      for (let x = -halfW + 3; x < halfW - 3; x += 2.5) {
        placements.push({
          kit: "factory",
          model: "catwalk-straight",
          x,
          y: walkY,
          z: halfD - 1.6,
          yawDeg: 90,
          scale: 2.5,
        });
      }
      placements.push({
        kit: "factory",
        model: "catwalk-stairs",
        x: halfW - 4.5,
        y: 0,
        z: halfD - 1.6,
        yawDeg: 90,
        scale: 2.5,
      });
    }
    for (let x = -halfW + 4; x < halfW - 3; x += 8) {
      placements.push({
        kit: "factory",
        model: "structure-tall",
        x,
        z: halfD - 0.35,
        fit: { height: Math.min(room.heightMeters, 7) },
      });
      placements.push({
        kit: "factory",
        model: "structure-tall",
        x,
        z: -halfD + 0.35,
        fit: { height: Math.min(room.heightMeters, 7) },
      });
    }
    // Bollards either side of each doorway.
    for (const entry of room.interactables) {
      if (entry.kind !== "transit") continue;
      const along = (entry.facingDeg * Math.PI) / 180;
      const dx = Math.cos(along) * 1.6;
      const dz = -Math.sin(along) * 1.6;
      placements.push({
        kit: "factory",
        model: "warning-orange",
        x: entry.position.x + dx,
        z: entry.position.z + dz,
        scale: 1,
      });
      placements.push({
        kit: "factory",
        model: "warning-orange",
        x: entry.position.x - dx,
        z: entry.position.z - dz,
        scale: 1,
      });
    }
    // Big rooms get a crane and hoppers: something heavy is worked on here.
    if (room.widthMeters >= 28 && room.heightMeters >= 12) {
      placements.push({
        kit: "factory",
        model: "crane",
        x: 0,
        z: -halfD * 0.35,
        yawDeg: 90,
        fit: { height: room.heightMeters * 0.85 },
      });
      placements.push({
        kit: "factory",
        model: "hopper-high-square",
        x: -halfW + 3,
        z: -halfD + 3,
        scale: 2.4,
      });
      placements.push({
        kit: "factory",
        model: "hopper-high-square",
        x: halfW - 3,
        z: -halfD + 3,
        scale: 2.4,
      });
    }

    void this.props.placeAll(placements, this.root).then((placed) => {
      if (this.disposed || token !== this.buildToken) {
        for (const prop of placed) prop.dispose();
        return;
      }
      this.roomProps.push(...placed);
    });
  }

  /** Working light, plus a warmer lamp over the fixtures so a room has a direction. */
  private buildLights(room: InteriorRoom): void {
    const lamp = new PointLight(
      `interior.lamp.${room.id}`,
      new Vector3(0, Math.min(room.heightMeters * 0.7, 14), room.depthMeters * 0.1),
      this.scene,
    );
    // The accent, halfway to white: the room keeps its colour without the walls saturating.
    lamp.diffuse = new Color3(
      (room.accentColour[0] + 1) / 2,
      (room.accentColour[1] + 1) / 2,
      (room.accentColour[2] + 1) / 2,
    );
    lamp.intensity = room.underConstruction ? 0.6 : 1.0;
    // Range has to cover the room rather than stop halfway across it: at exactly
    // the room width, a Conn-Pod four metres deep read as a black void with one
    // glowing hatch in it.
    lamp.range = Math.max(room.widthMeters, room.depthMeters) * 1.6;
    this.lights.push(lamp);

    // A cool fill from the far end so the accent has something to contrast with.
    const fill = new PointLight(
      `interior.fill.${room.id}`,
      new Vector3(0, Math.min(room.heightMeters * 0.8, 12), -room.depthMeters * 0.3),
      this.scene,
    );
    fill.diffuse = new Color3(0.55, 0.7, 0.92);
    fill.intensity = room.underConstruction ? 0.35 : 0.6;
    fill.range = lamp.range;
    this.lights.push(fill);

    // Strip lights across the deckhead: rows of thin emissive bars. They are
    // geometry, not lights, so a big bay costs the same as a small one.
    const strip = MeshBuilder.CreateBox(`interior.strip.${room.id}`, { size: 1 }, this.scene);
    strip.material = this.material(`strip.${room.id}`, [0.8, 0.88, 1], 0.55);
    const columns = Math.max(1, Math.round(room.widthMeters / 8));
    const rows = Math.max(1, Math.round(room.depthMeters / 7));
    const buffer = new Float32Array(columns * rows * 16);
    let index = 0;
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        const x = ((column + 0.5) / columns) * room.widthMeters - room.widthMeters / 2;
        const z = ((row + 0.5) / rows) * room.depthMeters - room.depthMeters / 2;
        const length = Math.min(4, (room.depthMeters / rows) * 0.6);
        composeInto(buffer, index, x, room.heightMeters - 0.12, z, 0, 0.35, 0.08, length);
        index += 1;
      }
    }
    strip.thinInstanceSetBuffer("matrix", buffer, 16);
    strip.thinInstanceCount = index;
    this.track(strip, index * 64 + 24 * 32);
  }

  /** Deck plating: the room's floor colour with seams every two metres and a little wear. */
  private plateTexture(room: InteriorRoom): DynamicTexture {
    const size = 128;
    const texture = new DynamicTexture(
      `interior.plate.${room.id}`,
      { width: size, height: size },
      this.scene,
      true,
    );
    const context = texture.getContext();
    const [r, g, b] = room.floorColour;
    // Lifted: the grade's tone curve and the low ambient both pull the floor down.
    context.fillStyle = `rgb(${Math.round(Math.min(1, r * 1.5) * 255)}, ${Math.round(Math.min(1, g * 1.5) * 255)}, ${Math.round(Math.min(1, b * 1.5) * 255)})`;
    context.fillRect(0, 0, size, size);
    // Wear before seams, so the seams stay crisp.
    context.fillStyle = "rgba(255, 255, 255, 0.045)";
    for (let scuff = 0; scuff < 7; scuff += 1) {
      context.fillRect((scuff * 41) % size, (scuff * 67 + 13) % size, 30 + (scuff % 3) * 12, 5);
    }
    context.strokeStyle = "rgba(0, 0, 0, 0.5)";
    context.lineWidth = 4;
    context.strokeRect(2, 2, size - 4, size - 4);
    context.fillStyle = "rgba(0, 0, 0, 0.35)";
    const bolts: ReadonlyArray<readonly [number, number]> = [
      [10, 10],
      [size - 14, 10],
      [10, size - 14],
      [size - 14, size - 14],
    ];
    for (const [x, y] of bolts) context.fillRect(x, y, 4, 4);
    texture.update();
    texture.uScale = room.widthMeters / 2;
    texture.vScale = room.depthMeters / 2;
    // Dynamic textures clamp by default; a clamped seam painted the whole floor black.
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    this.textures.push(texture);
    return texture;
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
      if (resolved.origin === "generator") {
        // The generator's stand-in is a box; the rig is a machine. Same
        // transform, same replacement contract when a real model arrives.
        resolved.root.setEnabled(false);
        const rig = new JaegerRig(this.scene, manifest.nominalHeightMeters, `berth.${index}.rig`);
        rig.root.parent = this.root;
        rig.root.position.copyFrom(resolved.root.position);
        rig.root.rotation.copyFrom(resolved.root.rotation);
        this.berthRigs.push(rig);
      }
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
