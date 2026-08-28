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
import type { ContentRegistry } from "../data/registry";
import type { AssetManifest } from "../assets/manifest";
import type { AssetResolver, ResolvedAsset } from "../assets/resolver";
import type { KaijuDefinition } from "../data/kaiju";
import type { QualityPreset } from "../data/quality";
import type { ArenaFighterView, CombatEvent } from "../combat/arena";
import { zonePosition, type TargetingPose } from "../combat/targeting";
import { CreatureRig } from "./creatureRig";

/**
 * Combat, drawn.
 *
 * The creature itself, its body zones, and the debug view that makes hit
 * detection inspectable: where each zone is, which one was struck, and where the
 * contact was. The zone markers are the debug view the milestone asks for, and
 * they are drawn from the same numbers the resolver hits, not from a parallel
 * set kept for display.
 *
 * Nothing here decides anything. Damage, reactions and targeting have all
 * happened by the time this file is called.
 */

export interface CombatViewOptions {
  readonly scene: Scene;
  readonly quality: QualityPreset;
  readonly resolver: AssetResolver;
  readonly assets: ContentRegistry<AssetManifest>;
  readonly kaiju: KaijuDefinition;
  /** Ground height in the same local frame as everything else. */
  readonly groundHeightAt: (east: number, north: number) => number | null;
}

export interface CombatViewStats {
  readonly zoneMarkers: number;
  readonly hitMarkers: number;
  readonly roundsDrawn: number;
  readonly modelResolved: boolean;
  readonly debugVolumes: boolean;
  readonly meshes: number;
}

const SCRATCH_QUATERNION = new Quaternion();
const SCRATCH_MATRIX = new Matrix();

function composeInto(
  target: Float32Array,
  index: number,
  x: number,
  y: number,
  z: number,
  scale: number,
): void {
  Quaternion.RotationAxisToRef(Vector3.Up(), 0, SCRATCH_QUATERNION);
  Matrix.ComposeToRef(
    new Vector3(scale, scale, scale),
    SCRATCH_QUATERNION,
    new Vector3(x, y, z),
    SCRATCH_MATRIX,
  );
  SCRATCH_MATRIX.copyToArray(target, index * 16);
}

/** How long a hit marker stays on screen, in seconds. */
const HIT_MARKER_SECONDS = 1.6;

export class CombatView {
  private readonly scene: Scene;
  private readonly kaiju: KaijuDefinition;
  private readonly groundHeightAt: (east: number, north: number) => number | null;
  private readonly root: TransformNode;
  private readonly bodyRoot: TransformNode;
  private readonly materials: StandardMaterial[] = [];
  private placeholder: Mesh | null = null;
  private resolved: ResolvedAsset | null = null;
  private rig: CreatureRig | null = null;
  private worldSeconds = 0;
  private flinch = 0;
  private lastEast = 0;
  private lastNorth = 0;
  private readonly ready: Promise<void>;

  private readonly zoneMesh: Mesh;
  private readonly zoneBuffer: Float32Array;
  private zoneCount = 0;

  private readonly roundMesh: Mesh;
  private readonly roundBuffer: Float32Array;
  private roundCount = 0;

  private readonly hitMesh: Mesh;
  private readonly hitBuffer: Float32Array;
  private readonly hitMarkers: Array<{ east: number; up: number; north: number; age: number }> = [];

  private debugVolumesValue = false;
  private disposed = false;

  constructor(options: CombatViewOptions) {
    this.scene = options.scene;
    this.kaiju = options.kaiju;
    this.groundHeightAt = options.groundHeightAt;

    this.root = new TransformNode("combat.root", this.scene);
    this.bodyRoot = new TransformNode("combat.body", this.scene);
    this.bodyRoot.parent = this.root;

    const height = this.kaiju.heightMeters;
    const placeholder = MeshBuilder.CreateBox(
      "combat.placeholderBody",
      { width: height * 0.3, height, depth: height * 0.4 },
      this.scene,
    );
    placeholder.position.y = height * 0.5;
    placeholder.material = this.material("combat.placeholderBody", new Color3(0.3, 0.35, 0.32));
    placeholder.parent = this.bodyRoot;
    placeholder.isVisible = false;
    this.placeholder = placeholder;
    this.rig = new CreatureRig(this.scene, height, "combat.rig");
    this.rig.root.parent = this.bodyRoot;

    // Zone markers. Off by default, and the whole point of them is that they sit
    // exactly where the resolver believes the zones are.
    this.zoneMesh = MeshBuilder.CreateSphere("combat.zones", { diameter: 2, segments: 8 }, this.scene);
    const zoneMaterial = this.material("combat.zones", new Color3(0.95, 0.55, 0.2), 0.4);
    zoneMaterial.alpha = 0.28;
    zoneMaterial.wireframe = true;
    this.zoneMesh.material = zoneMaterial;
    this.zoneMesh.parent = this.root;
    this.zoneMesh.isPickable = false;
    this.zoneBuffer = new Float32Array(this.kaiju.zones.length * 16);
    parkAll(this.zoneBuffer);
    this.zoneMesh.thinInstanceSetBuffer("matrix", this.zoneBuffer, 16);
    this.zoneMesh.thinInstanceCount = 0;
    this.zoneMesh.alwaysSelectAsActiveMesh = true;
    this.zoneMesh.setEnabled(false);

    // Hit markers: where contact actually happened, briefly.
    this.hitMesh = MeshBuilder.CreateSphere("combat.hits", { diameter: 2, segments: 6 }, this.scene);
    this.hitMesh.material = this.material("combat.hits", new Color3(1, 0.75, 0.35), 0.9);
    this.hitMesh.parent = this.root;
    this.hitMesh.isPickable = false;
    this.hitBuffer = new Float32Array(Math.max(8, Math.round(options.quality.maxParticles / 200)) * 16);
    parkAll(this.hitBuffer);
    this.hitMesh.thinInstanceSetBuffer("matrix", this.hitBuffer, 16);
    this.hitMesh.thinInstanceCount = 0;
    this.hitMesh.alwaysSelectAsActiveMesh = true;

    // Rounds in the air. One pooled mesh at the quality preset's own ceiling, so
    // what is drawn can never exceed what the simulation allows to exist.
    this.roundMesh = MeshBuilder.CreateSphere("combat.rounds", { diameter: 2, segments: 6 }, this.scene);
    this.roundMesh.material = this.material("combat.rounds", new Color3(1, 0.86, 0.5), 0.85);
    this.roundMesh.parent = this.root;
    this.roundMesh.isPickable = false;
    this.roundBuffer = new Float32Array(options.quality.maxProjectiles * 16);
    parkAll(this.roundBuffer);
    this.roundMesh.thinInstanceSetBuffer("matrix", this.roundBuffer, 16);
    this.roundMesh.thinInstanceCount = 0;
    this.roundMesh.alwaysSelectAsActiveMesh = true;

    this.ready = this.resolveModel(options.resolver, options.assets);
  }

  private async resolveModel(resolver: AssetResolver, assets: ContentRegistry<AssetManifest>): Promise<void> {
    // The creature's own manifest if it has one, which is how a real model gets
    // installed later without touching this file.
    const manifest = assets.get(this.kaiju.id) ?? assets.get("kaiju.biped-alpha");
    if (!manifest) return;
    try {
      const resolved = await resolver.resolve(manifest, this.scene);
      if (this.disposed) {
        resolved.dispose();
        return;
      }
      resolved.root.parent = this.bodyRoot;
      this.resolved = resolved;
      this.placeholder?.dispose();
      this.placeholder = null;
      // Only a real model replaces the rig; the generator's stand-in stays hidden.
      if (resolved.origin === "model") {
        this.rig?.dispose();
        this.rig = null;
      } else {
        resolved.root.setEnabled(false);
      }
    } catch {
      // A missing model leaves the placeholder body standing rather than
      // leaving the player fighting nothing.
    }
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  get debugVolumes(): boolean {
    return this.debugVolumesValue;
  }

  /** Turns the zone markers on and off. This is the hit debug view. */
  setDebugVolumes(enabled: boolean): void {
    this.debugVolumesValue = enabled;
    this.zoneMesh.setEnabled(enabled);
  }

  update(view: ArenaFighterView, events: readonly CombatEvent[], deltaSeconds: number): void {
    if (this.disposed) return;
    const ground = this.groundHeightAt(view.east, view.north) ?? 0;
    const pose: TargetingPose = { east: view.east, north: view.north, up: ground, yawDeg: view.yawDeg };

    this.bodyRoot.position.set(pose.east, pose.up, pose.north);
    this.bodyRoot.rotation.y = (pose.yawDeg * Math.PI) / 180;
    // The rig handles going down; the invisible box tilts for the old contract.
    this.bodyRoot.rotation.x = 0;

    // Speed from displacement, so the gait follows what it actually did.
    const moved = Math.hypot(view.east - this.lastEast, view.north - this.lastNorth);
    const speed = deltaSeconds > 0 ? Math.min(20, moved / deltaSeconds) : 0;
    this.lastEast = view.east;
    this.lastNorth = view.north;
    this.worldSeconds += deltaSeconds;
    for (const event of events) {
      if (event.targetId === "kaiju" && event.damage > 0) this.flinch = Math.min(1, this.flinch + 0.5);
    }
    this.flinch = Math.max(0, this.flinch - deltaSeconds * 3);
    const phase = view.activePhase ?? "";
    const health = view.zones.reduce((sum, zone) => sum + zone.health / Math.max(1, zone.maxHealth), 0);
    this.rig?.update({
      timeSeconds: this.worldSeconds,
      speedMps: speed,
      windup: phase === "startup" || phase === "windup" ? 1 : 0,
      striking: phase === "active" ? 1 : 0,
      flinch: this.flinch,
      damage: 1 - health / Math.max(1, view.zones.length),
      defeated: view.defeated,
    });

    if (this.debugVolumesValue) {
      let index = 0;
      for (const zone of this.kaiju.zones) {
        const at = zonePosition(this.kaiju, zone, pose);
        const state = view.zones.find((entry) => entry.id === zone.id);
        // A destroyed zone shrinks to nothing, so the marker shows what is left
        // rather than only where it was.
        const life = state ? Math.max(0.15, state.health / Math.max(1, state.maxHealth)) : 1;
        composeInto(this.zoneBuffer, index, at.east, at.up, at.north, zone.radiusMeters * life);
        index += 1;
      }
      this.zoneCount = index;
      this.zoneMesh.thinInstanceSetBuffer("matrix", this.zoneBuffer, 16);
      this.zoneMesh.thinInstanceCount = index;
      this.zoneMesh.thinInstanceRefreshBoundingInfo(false);
    }

    for (const event of events) {
      if ((event.type !== "hit" && event.type !== "guarded") || !event.contact) continue;
      this.hitMarkers.push({
        east: event.contact.east,
        up: event.contact.up,
        north: event.contact.north,
        age: 0,
      });
    }

    const capacity = this.hitBuffer.length / 16;
    while (this.hitMarkers.length > capacity) this.hitMarkers.shift();
    for (let cursor = this.hitMarkers.length - 1; cursor >= 0; cursor -= 1) {
      const marker = this.hitMarkers[cursor];
      if (!marker) continue;
      marker.age += deltaSeconds;
      if (marker.age >= HIT_MARKER_SECONDS) this.hitMarkers.splice(cursor, 1);
    }
    let hitIndex = 0;
    for (const marker of this.hitMarkers) {
      const t = marker.age / HIT_MARKER_SECONDS;
      composeInto(this.hitBuffer, hitIndex, marker.east, marker.up, marker.north, 4 + t * 14);
      hitIndex += 1;
    }
    const previous = this.hitMesh.thinInstanceCount;
    this.hitMesh.thinInstanceCount = hitIndex;
    if (hitIndex !== previous) {
      this.hitMesh.thinInstanceSetBuffer("matrix", this.hitBuffer, 16);
      this.hitMesh.thinInstanceCount = hitIndex;
      this.hitMesh.thinInstanceRefreshBoundingInfo(false);
    } else if (hitIndex > 0) {
      this.hitMesh.thinInstanceBufferUpdated("matrix");
    }
  }

  /**
   * Draws whatever the pool says is live.
   *
   * The renderer reads the simulation and never the other way round: a round
   * that is not in the pool cannot be drawn, and one that is drawn cannot
   * outlive the pool slot it came from.
   */
  updateProjectiles(rounds: readonly { east: number; north: number; up: number }[]): void {
    if (this.disposed) return;
    const capacity = this.roundBuffer.length / 16;
    const count = Math.min(rounds.length, capacity);
    for (let index = 0; index < count; index += 1) {
      const round = rounds[index];
      if (!round) continue;
      composeInto(this.roundBuffer, index, round.east, round.up, round.north, 4);
    }
    const previous = this.roundCount;
    this.roundCount = count;
    this.roundMesh.thinInstanceCount = count;
    if (count !== previous) {
      this.roundMesh.thinInstanceSetBuffer("matrix", this.roundBuffer, 16);
      this.roundMesh.thinInstanceCount = count;
      this.roundMesh.thinInstanceRefreshBoundingInfo(false);
    } else if (count > 0) {
      this.roundMesh.thinInstanceBufferUpdated("matrix");
    }
  }

  stats(): CombatViewStats {
    return {
      zoneMarkers: this.debugVolumesValue ? this.zoneCount : 0,
      hitMarkers: this.hitMarkers.length,
      roundsDrawn: this.roundCount,
      modelResolved: this.resolved !== null,
      debugVolumes: this.debugVolumesValue,
      meshes: this.scene.meshes.filter((mesh) => mesh.name.startsWith("combat.")).length,
    };
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
    this.resolved?.dispose();
    this.resolved = null;
    this.placeholder?.dispose();
    this.placeholder = null;
    this.rig?.dispose();
    this.rig = null;
    this.zoneMesh.dispose();
    this.hitMesh.dispose();
    this.roundMesh.dispose();
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    this.bodyRoot.dispose();
    this.root.dispose();
    this.hitMarkers.length = 0;
  }
}

function parkAll(buffer: Float32Array): void {
  for (let index = 0; index < buffer.length / 16; index += 1) {
    composeInto(buffer, index, 0, -100_000, 0, 0.001);
  }
}
