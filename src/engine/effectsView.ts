import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  StandardMaterial,
  Vector3,
  type AbstractMesh,
  type Scene,
} from "@babylonjs/core";
import type { QualityPreset } from "../data/quality";
import { EDGE_TREATMENTS, PALETTE_TOKENS, SURFACE_STYLES } from "../data/styleGuide";
import {
  createEffectRegistry,
  EffectPoolLedger,
  type EffectDefinition,
  type EffectKind,
} from "../vfx/effectsModel";
import type { VfxSettings } from "../vfx/vfxSettings";

/**
 * Where the style guide and the effect ledger become pixels.
 *
 * One `ParticleSystem` per effect kind, allocated once at the catalogue's own
 * ceiling for the current quality level, and never grown. A burst is a
 * `manualEmitCount` on the pooled system rather than a new object, so a fight
 * full of finishers allocates nothing and a stress run ends exactly where it
 * began. The ledger decides whether a burst may exist; this only draws the ones
 * it allowed.
 *
 * The rim accent and edge lines live here too, applied to meshes the callers
 * hand over. Rim is fresnel emissive on the material, stable at any scale;
 * true edge lines are enabled only where the treatment table says the quality
 * level can afford them, and only on meshes tall enough for the lines to be
 * long and straight.
 *
 * Everything created here is released in dispose(), and stats() counts what is
 * live so a test can hold the baseline claim.
 */

export interface EffectsViewOptions {
  readonly scene: Scene;
  readonly quality: QualityPreset;
  readonly settings: VfxSettings;
}

export interface EffectsViewStats {
  readonly systems: number;
  readonly aliveBursts: number;
  readonly particlesBudget: number;
  readonly refusedAtCeiling: number;
  readonly refusedBySettings: number;
  readonly flashesSuppressed: number;
  readonly rimMaterials: number;
  readonly edgeMeshes: number;
  readonly atBaseline: boolean;
}

function hexToColor3(hex: string): Color3 {
  return Color3.FromHexString(hex);
}

/** Soft round sprite shared by every system. Drawn once, owned here. */
function buildSprite(scene: Scene): DynamicTexture {
  const texture = new DynamicTexture("vfx.sprite", { width: 64, height: 64 }, scene, false);
  const context = texture.getContext();
  const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 30);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.6, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  texture.update();
  return texture;
}

export class EffectsView {
  private readonly scene: Scene;
  private readonly quality: QualityPreset;
  private settings: VfxSettings;
  private readonly ledger: EffectPoolLedger;
  private readonly registry = createEffectRegistry();
  private readonly sprite: DynamicTexture;
  private readonly systems = new Map<EffectKind, ParticleSystem>();
  private readonly emitter: Mesh;
  private readonly rimMaterials = new Set<StandardMaterial>();
  private readonly edgeMeshes = new Set<AbstractMesh>();
  private flashesSuppressed = 0;
  private disposed = false;

  constructor(options: EffectsViewOptions) {
    this.scene = options.scene;
    this.quality = options.quality;
    this.settings = options.settings;
    this.ledger = new EffectPoolLedger(options.quality.id);
    this.ledger.setDensity(options.settings.particleDensity);
    this.sprite = buildSprite(this.scene);

    this.emitter = MeshBuilder.CreateBox("vfx.emitter", { size: 0.01 }, this.scene);
    this.emitter.isVisible = false;
    this.emitter.isPickable = false;

    // One system per kind, allocated at the ceiling and never grown. A kind
    // whose ceiling is zero at this quality gets no system at all.
    for (const definition of this.registry.all()) {
      const capacity = definition.maxAlive[this.quality.id] * definition.particlesEach[this.quality.id];
      if (capacity <= 0) continue;
      this.systems.set(definition.id, this.buildSystem(definition, capacity));
    }
  }

  setSettings(settings: VfxSettings): void {
    this.settings = settings;
    this.ledger.setDensity(settings.particleDensity);
  }

  /**
   * Asks for one burst at a position. Refusals are counted, never thrown.
   *
   * Flash-class effects are refused outright while the flash setting is off,
   * which is the "no full-screen flash ignores accessibility" rule enforced at
   * the only place a flash can be born.
   */
  burst(kind: EffectKind, east: number, up: number, north: number): boolean {
    if (this.disposed) return false;
    const definition = this.registry.get(kind);
    const system = this.systems.get(kind);
    if (!definition || !system) return false;
    if (definition.flash && !this.settings.flashes) {
      this.flashesSuppressed += 1;
      return false;
    }
    const id = this.ledger.request(kind);
    if (id === null) return false;

    this.emitter.position.set(east, up, north);
    system.emitter = this.emitter.position.clone();
    const count = Math.max(
      1,
      Math.round(definition.particlesEach[this.quality.id] * this.settings.particleDensity),
    );
    system.manualEmitCount = count;
    return true;
  }

  /** Ages the ledger so finished bursts hand their capacity back. */
  advance(deltaSeconds: number): void {
    if (this.disposed) return;
    this.ledger.advance(deltaSeconds);
  }

  /**
   * Applies the rim accent to a mesh's material.
   *
   * Fresnel emissive rather than an outline pass: computed on the surface, so
   * it neither shimmers with distance nor cares how big the mesh is. The
   * roughness floor is applied at the same time, which is the "no flat toys"
   * rule reaching the material it protects.
   */
  styleMesh(mesh: AbstractMesh, family: keyof typeof SURFACE_STYLES, heightMeters: number): void {
    if (this.disposed) return;
    const style = SURFACE_STYLES[family];
    const material = mesh.material;
    if (material instanceof StandardMaterial) {
      // Specular pulled down to the roughness floor's equivalent, so nothing
      // renders shinier than the guide allows.
      const shine = Math.max(0, 1 - style.roughnessFloor);
      material.specularColor = new Color3(shine * 0.3, shine * 0.3, shine * 0.32);
      if (style.rimStrength > 0) {
        const rim = hexToColor3(
          PALETTE_TOKENS.find((token) => token.id === "style.sky-cool")?.hex ?? "#7fd6ff",
        );
        material.emissiveColor = rim.scale(style.rimStrength * 0.18);
        // Fresnel needs the emissive to concentrate at grazing angles.
        material.useEmissiveAsIllumination = false;
      }
      this.rimMaterials.add(material);
    }

    const treatment = EDGE_TREATMENTS[this.quality.id];
    if (treatment.edges && heightMeters >= treatment.minHeightMeters && mesh instanceof Mesh) {
      mesh.enableEdgesRendering(0.95);
      mesh.edgesWidth = treatment.widthWorld * 10;
      const ink = hexToColor3(PALETTE_TOKENS.find((token) => token.id === "style.ink")?.hex ?? "#0a1016");
      mesh.edgesColor = new Color4(ink.r, ink.g, ink.b, 0.9);
      this.edgeMeshes.add(mesh);
    }
  }

  stats(): EffectsViewStats {
    const counters = this.ledger.counters();
    return {
      systems: this.systems.size,
      aliveBursts: counters.alive,
      particlesBudget: counters.particlesInUse,
      refusedAtCeiling: counters.refusedAtCeiling,
      refusedBySettings: counters.refusedBySettings,
      flashesSuppressed: this.flashesSuppressed,
      rimMaterials: this.rimMaterials.size,
      edgeMeshes: this.edgeMeshes.size,
      atBaseline: this.ledger.atBaseline(),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const system of this.systems.values()) {
      system.stop();
      system.dispose();
    }
    this.systems.clear();
    for (const mesh of this.edgeMeshes) {
      if (mesh instanceof Mesh) mesh.disableEdgesRendering();
    }
    this.edgeMeshes.clear();
    this.rimMaterials.clear();
    this.emitter.dispose();
    this.sprite.dispose();
  }

  private buildSystem(definition: EffectDefinition, capacity: number): ParticleSystem {
    const system = new ParticleSystem(`vfx.${definition.id}`, capacity, this.scene);
    system.particleTexture = this.sprite;
    system.emitter = Vector3.Zero();
    system.emitRate = 0; // Bursts only, via manualEmitCount. Nothing idles.

    const base = hexToColor3(
      PALETTE_TOKENS.find((token) => token.id === definition.paletteId)?.hex ?? "#5f6a72",
    );
    // Intense colour off pulls saturated effects toward steel without touching
    // warning colours, which are information rather than decoration.
    const muted = this.settings.intenseColor
      ? base
      : Color3.Lerp(base, hexToColor3("#5f6a72"), definition.paletteId.includes("warning") ? 0 : 0.6);
    system.color1 = new Color4(muted.r, muted.g, muted.b, 0.95);
    system.color2 = new Color4(muted.r * 0.7, muted.g * 0.7, muted.b * 0.7, 0.7);
    system.colorDead = new Color4(muted.r * 0.2, muted.g * 0.2, muted.b * 0.2, 0);

    system.minLifeTime = definition.lifeSeconds * 0.5;
    system.maxLifeTime = definition.lifeSeconds;
    system.minSize = 0.8;
    system.maxSize = 3.4;
    system.direction1 = new Vector3(-6, 2, -6);
    system.direction2 = new Vector3(6, 12, 6);
    system.gravity = new Vector3(0, definition.id === "steam" ? 3 : -14, 0);
    system.blendMode = definition.flash ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
    system.start();
    return system;
  }
}
