import {
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector3,
  type Camera,
  type Scene,
} from "@babylonjs/core";
import type { ContentRegistry } from "../data/registry";
import type { AssetManifest } from "../assets/manifest";
import type { AssetResolver, ResolvedAsset } from "../assets/resolver";
import type { QualityPreset } from "../data/quality";
import type { JaegerDefinition } from "../data/jaegers";
import type { CameraPlacement } from "../jaegers/camera";
import type { JaegerPose, LocomotionEvent } from "../jaegers/locomotion";
import { SPEED_OF_SOUND_MPS, type AmbientAudio } from "./ambientAudio";

/**
 * The piloted machine, drawn.
 *
 * Its job is to make a seventy five metre object read as seventy five metres,
 * which is a harder problem than drawing it. Four things do that work and none
 * of them is camera shake:
 *
 * - **Footstep decals** stay on the ground behind the machine, so the distance
 *   covered by one stride is visible after the foot has moved on.
 * - **Dust and water** rise from where a foot actually landed, at a size set by
 *   how hard it landed.
 * - **Scale references** put known-size objects in frame: street lights at head
 *   height to a person, aircraft crossing at altitude, birds scattering.
 * - **Delayed sound** arrives late from far away, because it does.
 *
 * Everything here reads the pose and the locomotion events. Nothing here decides
 * anything: the machine has already moved by the time this file sees it.
 */

export interface JaegerViewOptions {
  readonly scene: Scene;
  readonly quality: QualityPreset;
  readonly resolver: AssetResolver;
  readonly assets: ContentRegistry<AssetManifest>;
  readonly jaeger: JaegerDefinition;
  /** Ground height for a point in the same local frame as the pose. */
  readonly groundHeightAt: (east: number, north: number) => number | null;
  /** Optional, so a headless test can build the view with no audio at all. */
  readonly audio?: AmbientAudio | null;
}

export interface JaegerViewStats {
  readonly meshes: number;
  readonly decals: number;
  readonly decalCapacity: number;
  readonly scaleReferences: number;
  readonly scaleReferenceCapacity: number;
  /** Marks currently worn by the machine. */
  readonly scarsDrawn: number;
  readonly dustParticles: number;
  readonly modelResolved: boolean;
  readonly cameraMode: string;
  readonly estimatedGpuBytes: number;
  /** Metres to the furthest sound still in flight. Zero when nothing is pending. */
  readonly pendingSoundMeters: number;
}

const SCRATCH_QUATERNION = new Quaternion();
const SCRATCH_MATRIX = new Matrix();

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
  Quaternion.RotationAxisToRef(Vector3.Up(), yawRadians, SCRATCH_QUATERNION);
  Matrix.ComposeToRef(
    new Vector3(scaleX, scaleY, scaleZ),
    SCRATCH_QUATERNION,
    new Vector3(x, y, z),
    SCRATCH_MATRIX,
  );
  SCRATCH_MATRIX.copyToArray(target, index * 16);
}

/** Ceiling on drawn marks. The record keeps more; the machine only wears this many. */
const MAX_DRAWN_SCARS = 24;

/** Aircraft cross at a fixed altitude and speed; birds scatter lower and slower. */
interface ScaleFlyer {
  readonly kind: "aircraft" | "bird";
  readonly altitude: number;
  readonly speed: number;
  readonly headingDeg: number;
  readonly offsetEast: number;
  readonly offsetNorth: number;
  readonly size: number;
}

export class JaegerView {
  private readonly scene: Scene;
  private readonly quality: QualityPreset;
  private readonly jaeger: JaegerDefinition;
  private readonly groundHeightAt: (east: number, north: number) => number | null;
  private readonly audio: AmbientAudio | null;
  private readonly root: TransformNode;
  private readonly machineRoot: TransformNode;
  private readonly materials: StandardMaterial[] = [];
  private readonly camera: UniversalCamera;
  private readonly previousCamera: Camera | null;
  private resolved: ResolvedAsset | null = null;
  private placeholder: Mesh | null = null;

  private readonly decalMesh: Mesh;
  private readonly decalBuffer: Float32Array;
  private decalCursor = 0;
  private decalCount = 0;

  private readonly dustMesh: Mesh;
  private readonly dustBuffer: Float32Array;
  private readonly dustPuffs: Array<{
    east: number;
    north: number;
    up: number;
    age: number;
    life: number;
    size: number;
  }> = [];

  private readonly lightMesh: Mesh;
  private readonly lightBuffer: Float32Array;
  private lightCount = 0;

  private readonly flyerMesh: Mesh;
  private readonly flyerBuffer: Float32Array;
  private readonly flyers: ScaleFlyer[] = [];

  private readonly scarMesh: Mesh;
  private readonly scarBuffer: Float32Array;
  private scarCount = 0;

  private readonly ready: Promise<void>;
  private pendingSoundMeters = 0;
  private cameraModeLabel = "third-person";
  private gpuBytes = 0;
  private disposed = false;

  constructor(options: JaegerViewOptions) {
    this.scene = options.scene;
    this.quality = options.quality;
    this.jaeger = options.jaeger;
    this.groundHeightAt = options.groundHeightAt;
    this.audio = options.audio ?? null;

    this.root = new TransformNode("jaeger.root", this.scene);
    this.machineRoot = new TransformNode("jaeger.machine", this.scene);
    this.machineRoot.parent = this.root;

    const height = this.jaeger.locomotion.heightMeters;

    // Something stands here from the first frame. The resolved model replaces it
    // when it arrives, so a slow asset never leaves the player driving nothing.
    const placeholder = MeshBuilder.CreateBox(
      "jaeger.placeholderBody",
      { width: height * 0.22, height, depth: height * 0.16 },
      this.scene,
    );
    placeholder.position.y = height * 0.5;
    placeholder.material = this.material("jaeger.placeholderBody", new Color3(0.35, 0.38, 0.42));
    placeholder.parent = this.machineRoot;
    this.placeholder = placeholder;

    // Footstep decals: one pooled quad mesh, oldest slot reused. A decal is a
    // stride's worth of ground the player can measure the machine against.
    this.decalMesh = MeshBuilder.CreateGround("jaeger.footsteps", { width: 1, height: 1 }, this.scene);
    const decalMaterial = this.material("jaeger.footsteps", new Color3(0.12, 0.11, 0.1));
    decalMaterial.alpha = 0.55;
    this.decalMesh.material = decalMaterial;
    this.decalMesh.parent = this.root;
    this.decalMesh.isPickable = false;
    this.decalBuffer = new Float32Array(this.quality.maxFootstepDecals * 16);
    parkAll(this.decalBuffer);
    this.decalMesh.thinInstanceSetBuffer("matrix", this.decalBuffer, 16);
    this.decalMesh.thinInstanceCount = 0;
    this.decalMesh.alwaysSelectAsActiveMesh = true;

    // Dust. Boxes rather than a particle system on purpose: the count is bounded
    // by the same budget as everything else and the cost is one draw call.
    this.dustMesh = MeshBuilder.CreateBox("jaeger.dust", { size: 1 }, this.scene);
    const dustMaterial = this.material("jaeger.dust", new Color3(0.62, 0.58, 0.5));
    dustMaterial.alpha = 0.32;
    this.dustMesh.material = dustMaterial;
    this.dustMesh.parent = this.root;
    this.dustMesh.isPickable = false;
    this.dustBuffer = new Float32Array(Math.max(8, Math.round(this.quality.maxParticles / 40)) * 16);
    parkAll(this.dustBuffer);
    this.dustMesh.thinInstanceSetBuffer("matrix", this.dustBuffer, 16);
    this.dustMesh.thinInstanceCount = 0;
    this.dustMesh.alwaysSelectAsActiveMesh = true;

    // Street lights: eight metres tall, which is the most useful ruler there is
    // for a machine that is nine of them.
    this.lightMesh = MeshBuilder.CreateBox("jaeger.streetLights", { size: 1 }, this.scene);
    this.lightMesh.material = this.material("jaeger.streetLights", new Color3(0.55, 0.57, 0.6), 0.15);
    this.lightMesh.parent = this.root;
    this.lightMesh.isPickable = false;
    this.lightBuffer = new Float32Array(this.quality.maxScaleReferences * 16);
    parkAll(this.lightBuffer);
    this.lightMesh.thinInstanceSetBuffer("matrix", this.lightBuffer, 16);
    this.lightMesh.thinInstanceCount = 0;
    this.lightMesh.alwaysSelectAsActiveMesh = true;

    // Aircraft and birds. A helicopter passing behind a shoulder says more about
    // size than any amount of camera movement.
    // Battle damage. One pooled mesh of torn plate, placed from the machine's own
    // scar record: the marks are the save data, and the debris is grown from the
    // seed each one carries, so a machine looks the same every time it loads.
    this.scarMesh = MeshBuilder.CreateBox("jaeger.scars", { size: 1 }, this.scene);
    this.scarMesh.material = this.material("jaeger.scars", new Color3(0.11, 0.1, 0.09), 0.02);
    this.scarMesh.parent = this.machineRoot;
    this.scarMesh.isPickable = false;
    this.scarBuffer = new Float32Array(MAX_DRAWN_SCARS * 16);
    parkAll(this.scarBuffer);
    this.scarMesh.thinInstanceSetBuffer("matrix", this.scarBuffer, 16);
    this.scarMesh.thinInstanceCount = 0;
    this.scarMesh.alwaysSelectAsActiveMesh = true;

    this.flyerMesh = MeshBuilder.CreateBox("jaeger.flyers", { size: 1 }, this.scene);
    this.flyerMesh.material = this.material("jaeger.flyers", new Color3(0.2, 0.22, 0.25), 0.05);
    this.flyerMesh.parent = this.root;
    this.flyerMesh.isPickable = false;
    const flyerCount = Math.max(4, Math.round(this.quality.maxScaleReferences / 6));
    this.flyerBuffer = new Float32Array(flyerCount * 16);
    parkAll(this.flyerBuffer);
    this.flyerMesh.thinInstanceSetBuffer("matrix", this.flyerBuffer, 16);
    this.flyerMesh.thinInstanceCount = 0;
    this.flyerMesh.alwaysSelectAsActiveMesh = true;
    for (let index = 0; index < flyerCount; index += 1) {
      const aircraft = index % 3 === 0;
      this.flyers.push({
        kind: aircraft ? "aircraft" : "bird",
        altitude: aircraft ? height * (1.4 + (index % 4) * 0.35) : height * (0.6 + (index % 5) * 0.12),
        speed: aircraft ? 70 + index * 3 : 14 + index,
        headingDeg: (index * 47) % 360,
        offsetEast: ((index * 137) % 900) - 450,
        offsetNorth: ((index * 251) % 1_400) - 700,
        size: aircraft ? 26 : 3,
      });
    }

    this.gpuBytes =
      (this.decalBuffer.length + this.dustBuffer.length + this.lightBuffer.length + this.flyerBuffer.length) *
      4;

    // The pilot camera is this view's own, and the previous one is put back on
    // disposal so leaving the machine returns the player to the camera they had.
    this.previousCamera = this.scene.activeCamera;
    this.camera = new UniversalCamera("jaeger.camera", new Vector3(0, height, -height * 2), this.scene);
    // A machine this size needs a far plane measured in tens of kilometres and a
    // near plane that still lets the Conn-Pod camera sit inside its own head.
    this.camera.minZ = 0.6;
    this.camera.maxZ = 120_000;
    this.camera.fov = (62 * Math.PI) / 180;
    // Movement comes from the controller, never from Babylon's own camera input.
    this.camera.inputs.clear();
    this.scene.activeCamera = this.camera;

    // Kept so a caller that needs the real model in place, chiefly a test, can
    // wait for it. Nothing in the game waits: the placeholder body is already
    // standing and the machine is drivable from the first frame.
    this.ready = this.resolveModel(options.resolver, options.assets);
  }

  private async resolveModel(resolver: AssetResolver, assets: ContentRegistry<AssetManifest>): Promise<void> {
    const manifest = assets.get(this.jaeger.assetId);
    if (!manifest) return;
    try {
      const resolved = await resolver.resolve(manifest, this.scene);
      if (this.disposed) {
        resolved.dispose();
        return;
      }
      resolved.root.parent = this.machineRoot;
      this.resolved = resolved;
      this.placeholder?.dispose();
      this.placeholder = null;
    } catch {
      // A missing model is a content gap, not a crash: the placeholder body is
      // already standing and the machine keeps walking.
    }
  }

  /** Resolves once the production model has been placed, or the fallback taken. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  get activeCamera(): UniversalCamera {
    return this.camera;
  }

  /** Places the machine and the camera, and turns this frame's events into things to see and hear. */
  update(
    pose: JaegerPose,
    placement: CameraPlacement,
    events: readonly LocomotionEvent[],
    deltaSeconds: number,
    cameraMode: string,
  ): void {
    if (this.disposed) return;
    this.cameraModeLabel = cameraMode;

    this.machineRoot.position.set(pose.east, pose.up, pose.north);
    this.machineRoot.rotation.y = (pose.yawDeg * Math.PI) / 180;
    // Stride phase drives a small vertical settle. This is the animation contract
    // standing in for a skeleton: distance covered decides the pose, not a clock.
    const height = this.jaeger.locomotion.heightMeters;
    const settle = Math.sin(pose.stridePhase * Math.PI * 2) * height * 0.004;
    this.machineRoot.position.y += settle;

    this.camera.position.set(placement.east, placement.up, placement.north);
    this.camera.setTarget(new Vector3(placement.targetEast, placement.targetUp, placement.targetNorth));
    this.camera.fov = (placement.fovDeg * Math.PI) / 180;
    this.camera.rotation.z = (placement.rollDeg * Math.PI) / 180;

    for (const event of events) this.consumeEvent(event, placement);

    this.updateDust(deltaSeconds);
    this.updateScaleReferences(pose, deltaSeconds);
  }

  private consumeEvent(event: LocomotionEvent, placement: CameraPlacement): void {
    const height = this.jaeger.locomotion.heightMeters;
    if (event.kind === "footfall" || event.kind === "land" || event.kind === "step-up") {
      this.addDecal(event, height);
      this.addDust(event, height, event.kind === "land" ? 1.6 : 1);
    }
    if (event.kind === "water-entry") this.addDust(event, height, 2.2);
    if (event.kind === "booster") this.addDust(event, height, 1.8);

    // Distance from the ear, not from the machine: the camera is where the player is.
    const distance = Math.hypot(event.east - placement.east, event.north - placement.north);
    this.pendingSoundMeters = Math.max(this.pendingSoundMeters, distance);
    this.audio?.impact(event.intensity, distance, event.waterState === "dry" ? 900 : 420);
  }

  private addDecal(event: LocomotionEvent, height: number): void {
    const capacity = this.decalBuffer.length / 16;
    if (capacity === 0) return;
    const ground = this.groundHeightAt(event.east, event.north);
    const size = height * 0.13 * (0.7 + event.intensity * 0.6);
    composeInto(
      this.decalBuffer,
      this.decalCursor,
      event.east,
      (ground ?? event.up) + 0.25,
      event.north,
      0,
      size,
      1,
      size * 1.6,
    );
    this.decalCursor = (this.decalCursor + 1) % capacity;
    const previous = this.decalCount;
    this.decalCount = Math.min(capacity, this.decalCount + 1);
    this.decalMesh.thinInstanceCount = this.decalCount;
    if (this.decalCount !== previous) {
      // A pool whose count grew from zero has to have its buffer set again on
      // WebGPU, or nothing is drawn however correct the matrices are.
      this.decalMesh.thinInstanceSetBuffer("matrix", this.decalBuffer, 16);
      this.decalMesh.thinInstanceCount = this.decalCount;
      this.decalMesh.thinInstanceRefreshBoundingInfo(false);
    } else {
      this.decalMesh.thinInstanceBufferUpdated("matrix");
    }
  }

  private addDust(event: LocomotionEvent, height: number, scale: number): void {
    const capacity = this.dustBuffer.length / 16;
    if (this.dustPuffs.length >= capacity) this.dustPuffs.shift();
    this.dustPuffs.push({
      east: event.east,
      north: event.north,
      up: event.up,
      age: 0,
      life: 1.4 + event.intensity,
      size: height * 0.06 * scale * (0.5 + event.intensity),
    });
  }

  private updateDust(deltaSeconds: number): void {
    const capacity = this.dustBuffer.length / 16;
    let index = 0;
    for (let cursor = this.dustPuffs.length - 1; cursor >= 0; cursor -= 1) {
      const puff = this.dustPuffs[cursor];
      if (!puff) continue;
      puff.age += deltaSeconds;
      if (puff.age >= puff.life) {
        this.dustPuffs.splice(cursor, 1);
      }
    }
    for (const puff of this.dustPuffs) {
      if (index >= capacity) break;
      const t = puff.age / puff.life;
      const size = puff.size * (1 + t * 2.2);
      composeInto(
        this.dustBuffer,
        index,
        puff.east,
        puff.up + size * 0.4 + t * 8,
        puff.north,
        0,
        size,
        size,
        size,
      );
      index += 1;
    }
    const previous = this.dustMesh.thinInstanceCount;
    this.dustMesh.thinInstanceCount = index;
    if (index !== previous) {
      this.dustMesh.thinInstanceSetBuffer("matrix", this.dustBuffer, 16);
      this.dustMesh.thinInstanceCount = index;
      this.dustMesh.thinInstanceRefreshBoundingInfo(false);
    } else if (index > 0) {
      this.dustMesh.thinInstanceBufferUpdated("matrix");
    }
  }

  /**
   * Street lights ahead of the machine and traffic in the air around it.
   *
   * Both are placed relative to where the machine is rather than to the world,
   * so they cost nothing to keep in frame and never need streaming. They are a
   * ruler, and a ruler that is not in shot is not a ruler.
   */
  private updateScaleReferences(pose: JaegerPose, deltaSeconds: number): void {
    const capacity = this.lightBuffer.length / 16;
    const spacing = 42;
    const lanes = 2;
    let index = 0;
    const baseEast = Math.round(pose.east / spacing) * spacing;
    const baseNorth = Math.round(pose.north / spacing) * spacing;
    for (let lane = 0; lane < lanes && index < capacity; lane += 1) {
      const offset = lane === 0 ? -60 : 60;
      for (
        let step = -Math.floor(capacity / (lanes * 2));
        step <= Math.floor(capacity / (lanes * 2));
        step += 1
      ) {
        if (index >= capacity) break;
        const east = baseEast + offset;
        const north = baseNorth + step * spacing;
        const ground = this.groundHeightAt(east, north);
        if (ground === null) continue;
        // Eight metres: a real street light, and the reason the machine looks
        // like nine of them stacked up.
        composeInto(this.lightBuffer, index, east, ground + 4, north, 0, 0.6, 8, 0.6);
        index += 1;
      }
    }
    this.lightCount = index;
    const previousLights = this.lightMesh.thinInstanceCount;
    this.lightMesh.thinInstanceCount = index;
    if (index !== previousLights) {
      this.lightMesh.thinInstanceSetBuffer("matrix", this.lightBuffer, 16);
      this.lightMesh.thinInstanceCount = index;
      this.lightMesh.thinInstanceRefreshBoundingInfo(false);
    } else if (index > 0) {
      this.lightMesh.thinInstanceBufferUpdated("matrix");
    }

    // Flyers move on their own headings around the machine and wrap when they
    // get too far away, so there is always something crossing the frame.
    let flyerIndex = 0;
    for (const flyer of this.flyers) {
      const radians = (flyer.headingDeg * Math.PI) / 180;
      const travelled = flyer.speed * deltaSeconds;
      const nextEast = flyer.offsetEast + Math.sin(radians) * travelled;
      const nextNorth = flyer.offsetNorth + Math.cos(radians) * travelled;
      const wrapped = Math.hypot(nextEast, nextNorth) > 1_400;
      const east = wrapped ? -nextEast * 0.4 : nextEast;
      const north = wrapped ? -nextNorth * 0.4 : nextNorth;
      (flyer as { offsetEast: number }).offsetEast = east;
      (flyer as { offsetNorth: number }).offsetNorth = north;
      composeInto(
        this.flyerBuffer,
        flyerIndex,
        pose.east + east,
        pose.up + flyer.altitude,
        pose.north + north,
        radians,
        flyer.size,
        flyer.size * 0.25,
        flyer.size * 0.6,
      );
      flyerIndex += 1;
    }
    const previousFlyers = this.flyerMesh.thinInstanceCount;
    this.flyerMesh.thinInstanceCount = flyerIndex;
    if (flyerIndex !== previousFlyers) {
      this.flyerMesh.thinInstanceSetBuffer("matrix", this.flyerBuffer, 16);
      this.flyerMesh.thinInstanceCount = flyerIndex;
      this.flyerMesh.thinInstanceRefreshBoundingInfo(false);
    } else if (flyerIndex > 0) {
      this.flyerMesh.thinInstanceBufferUpdated("matrix");
    }
  }

  /**
   * Distance to the first thing between the machine and where the camera wants
   * to be. Used by the camera rig, which must not touch a scene itself.
   */
  obstructionAt(pose: JaegerPose, yawDeg: number, desiredDistanceMeters: number): number | null {
    const radians = (yawDeg * Math.PI) / 180;
    const steps = 6;
    for (let index = 1; index <= steps; index += 1) {
      const distance = (desiredDistanceMeters * index) / steps;
      const east = pose.east - Math.sin(radians) * distance;
      const north = pose.north - Math.cos(radians) * distance;
      const ground = this.groundHeightAt(east, north);
      if (ground === null) continue;
      // The camera sits above the machine's shoulder; ground higher than that is
      // a hillside about to fill the frame.
      const cameraHeight = pose.up + this.jaeger.locomotion.heightMeters * 1.2;
      if (ground > cameraHeight) return Math.max(this.jaeger.locomotion.heightMeters * 0.4, distance * 0.85);
    }
    return null;
  }

  /**
   * Wears the damage.
   *
   * Every mark is placed from the component it belongs to and the seed the scar
   * carries, so nothing about where the debris sits is stored: the same record
   * always produces the same machine, and a repaired component loses its marks
   * because the record loses them.
   */
  updateDamage(
    marks: readonly {
      readonly heightFraction: number;
      readonly lateralFraction: number;
      readonly forwardFraction: number;
      readonly severity: number;
      readonly seed: number;
    }[],
  ): void {
    if (this.disposed) return;
    const height = this.jaeger.locomotion.heightMeters;
    const count = Math.min(marks.length, MAX_DRAWN_SCARS);
    for (let index = 0; index < count; index += 1) {
      const mark = marks[index];
      if (!mark) continue;
      // Two independent values out of one seed, so a mark sits somewhere on the
      // component rather than always at its centre.
      const jitterA = ((mark.seed % 1_000) / 1_000 - 0.5) * height * 0.06;
      const jitterB = (((mark.seed >> 10) % 1_000) / 1_000 - 0.5) * height * 0.06;
      const size = height * (0.02 + mark.severity * 0.05);
      composeInto(
        this.scarBuffer,
        index,
        mark.lateralFraction * height + jitterA,
        mark.heightFraction * height + jitterB,
        mark.forwardFraction * height,
        ((mark.seed >> 20) % 628) / 100,
        size,
        size,
        size * 0.4,
      );
    }
    const previous = this.scarCount;
    this.scarCount = count;
    this.scarMesh.thinInstanceCount = count;
    if (count !== previous) {
      this.scarMesh.thinInstanceSetBuffer("matrix", this.scarBuffer, 16);
      this.scarMesh.thinInstanceCount = count;
      this.scarMesh.thinInstanceRefreshBoundingInfo(false);
    } else if (count > 0) {
      this.scarMesh.thinInstanceBufferUpdated("matrix");
    }
  }

  stats(): JaegerViewStats {
    return {
      meshes: this.scene.meshes.filter((mesh) => mesh.name.startsWith("jaeger.")).length,
      decals: this.decalCount,
      decalCapacity: this.decalBuffer.length / 16,
      scaleReferences: this.lightCount + this.flyers.length,
      scaleReferenceCapacity: this.lightBuffer.length / 16 + this.flyerBuffer.length / 16,
      scarsDrawn: this.scarCount,
      dustParticles: this.dustPuffs.length,
      modelResolved: this.resolved !== null,
      cameraMode: this.cameraModeLabel,
      estimatedGpuBytes: this.gpuBytes,
      pendingSoundMeters: this.pendingSoundMeters,
    };
  }

  /** Seconds a sound from this far away takes to arrive. Exposed so the panel can show it. */
  static soundDelaySeconds(distanceMeters: number): number {
    return Math.max(0, distanceMeters) / SPEED_OF_SOUND_MPS;
  }

  private material(name: string, colour: Color3, emissive = 0): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = colour;
    material.specularColor = Color3.Black();
    if (emissive > 0) material.emissiveColor = colour.scale(emissive);
    this.materials.push(material);
    return material;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // The camera goes back to whatever was active before this view took over,
    // and only then is the pilot camera destroyed.
    if (this.scene.activeCamera === this.camera) this.scene.activeCamera = this.previousCamera;
    this.camera.dispose();
    this.resolved?.dispose();
    this.resolved = null;
    this.placeholder?.dispose();
    this.placeholder = null;
    for (const mesh of [this.decalMesh, this.dustMesh, this.lightMesh, this.flyerMesh]) mesh.dispose();
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    this.scarMesh.dispose();
    this.machineRoot.dispose();
    this.root.dispose();
    this.dustPuffs.length = 0;
    this.flyers.length = 0;
  }
}

/** Parks every instance far below the world so an unused slot is never seen. */
function parkAll(buffer: Float32Array): void {
  for (let index = 0; index < buffer.length / 16; index += 1) {
    composeInto(buffer, index, 0, -100_000, 0, 0, 0.001, 0.001, 0.001);
  }
}
