import {
  Color3,
  HemisphericLight,
  MeshBuilder,
  StandardMaterial,
  Vector3,
  type ArcRotateCamera,
  type Material,
  type Mesh,
  type Scene,
} from "@babylonjs/core";
import type { ContentRegistry } from "../data/registry";
import { budgetFor } from "../assets/budgets";
import type { AssetManifest, AssetManifestOverride } from "../assets/manifest";
import { applyAssetOverride } from "../assets/manifest";
import type { AssetResolver, ResolvedAsset } from "../assets/resolver";

export interface GalleryEntry {
  readonly manifest: AssetManifest;
  readonly resolved: ResolvedAsset;
  /** Metres of floor space this entry occupies, used for row layout. */
  readonly footprint: number;
}

export interface GalleryMeasurements {
  readonly id: string;
  readonly displayName: string;
  readonly assetClass: string;
  readonly origin: string;
  readonly heightMeters: number;
  readonly widthMeters: number;
  readonly depthMeters: number;
  readonly triangleCount: number;
  readonly materialCount: number;
  readonly triangleBudget: number;
  readonly materialBudget: number;
  readonly socketIds: readonly string[];
  readonly diagnostics: readonly { severity: string; code: string; message: string }[];
}

const SPACING_METERS = 20;

/**
 * Loads every registered asset side by side so placeholders can be inspected,
 * measured and checked against budget before any of them reach gameplay.
 *
 * Owns every node and material it creates and releases them all in dispose().
 */
export class AssetGallery {
  private readonly entries: GalleryEntry[] = [];
  private readonly damageMaterials = new Map<string, StandardMaterial>();
  /** Original material per part, so a damage preview is always reversible. */
  private readonly pristine = new Map<string, { material: Material | null; color: Color3 }>();
  private rotationObserver: ReturnType<Scene["onBeforeRenderObservable"]["add"]> | undefined;
  private fill: HemisphericLight | undefined;
  private deck: Mesh | undefined;
  private deckMaterial: StandardMaterial | undefined;
  private spinning = true;
  private selectedIndex = 0;
  private disposed = false;

  private constructor(
    private readonly scene: Scene,
    private readonly camera: ArcRotateCamera,
  ) {}

  static async create(
    scene: Scene,
    camera: ArcRotateCamera,
    registry: ContentRegistry<AssetManifest>,
    resolver: AssetResolver,
    overrides: ReadonlyMap<string, AssetManifestOverride> = new Map(),
  ): Promise<AssetGallery> {
    const gallery = new AssetGallery(scene, camera);
    let cursorX = 0;

    for (const base of registry.all()) {
      const override = overrides.get(base.id);
      const manifest = override ? applyAssetOverride(base, override) : base;
      const resolved = await resolver.resolve(manifest, scene, `gallery.${manifest.id}`);
      const footprint = Math.max(resolved.inspection.boundingBoxMeters.x, 8);

      resolved.root.position.x = cursorX + footprint / 2;
      cursorX += footprint + SPACING_METERS;

      gallery.entries.push({ manifest, resolved, footprint });
    }

    // The boot scene lights one object from a single direction, which leaves an
    // inspection row unreadably dark. Fill light and a deck sized to the row are
    // part of the gallery, and are torn down with it.
    gallery.fill = new HemisphericLight("gallery.fill", new Vector3(0.2, 1, -0.4), scene);
    gallery.fill.intensity = 0.85;
    gallery.fill.groundColor = new Color3(0.35, 0.38, 0.42);

    const deckLength = Math.max(cursorX, 40);
    gallery.deck = MeshBuilder.CreateGround(
      "gallery.deck",
      { width: deckLength + SPACING_METERS * 2, height: 260 },
      scene,
    );
    gallery.deck.position.x = deckLength / 2 - SPACING_METERS / 2;
    gallery.deck.position.y = -0.05;
    const deckMaterial = new StandardMaterial("gallery.deck.mat", scene);
    deckMaterial.diffuseColor = new Color3(0.26, 0.28, 0.31);
    deckMaterial.specularColor = Color3.Black();
    gallery.deck.material = deckMaterial;
    gallery.deckMaterial = deckMaterial;

    gallery.rotationObserver = scene.onBeforeRenderObservable.add(() => {
      if (!gallery.spinning) return;
      const delta = scene.getEngine().getDeltaTime() * 0.0002;
      for (const entry of gallery.entries) entry.resolved.root.rotation.y += delta;
    });

    gallery.focus(0);
    return gallery;
  }

  get count(): number {
    return this.entries.length;
  }

  get selected(): GalleryEntry | undefined {
    return this.entries[this.selectedIndex];
  }

  list(): readonly GalleryEntry[] {
    return this.entries;
  }

  /** Frames one asset and sets the camera distance from its actual size. */
  focus(index: number): void {
    const entry = this.entries[index];
    if (!entry) return;
    this.selectedIndex = index;

    const size = entry.resolved.inspection.boundingBoxMeters;
    const reach = Math.max(size.x, size.y, size.z);
    this.camera.setTarget(
      new Vector3(entry.resolved.root.position.x, Math.max(size.y / 2, 1), entry.resolved.root.position.z),
    );
    this.camera.radius = reach * 2.4 + 6;
    this.camera.lowerRadiusLimit = Math.max(1, reach * 0.4);
    this.camera.upperRadiusLimit = reach * 12 + 40;
  }

  setSpinning(spinning: boolean): void {
    this.spinning = spinning;
  }

  get isSpinning(): boolean {
    return this.spinning;
  }

  /**
   * Presentation-only damage preview: tints parts and hides the most damaged
   * ones. This previews how a damaged asset reads on screen. It is not the
   * component damage model, which does not exist yet.
   */
  previewDamage(index: number, level: number): void {
    const entry = this.entries[index];
    if (!entry) return;
    const clamped = Math.min(1, Math.max(0, level));
    const parts = this.partsByDetachOrder(entry);

    parts.forEach(([partId, mesh], position) => {
      const key = `${entry.manifest.id}.${partId}`;
      const pristine = this.rememberPristine(key, mesh);
      const share = parts.length <= 1 ? 1 : position / (parts.length - 1);
      // Past 65% damage the outermost parts start coming off, so the silhouette
      // itself changes rather than only the colour.
      const detached = clamped > 0.65 && share < (clamped - 0.65) / 0.35;

      mesh.setEnabled(!detached);
      if (detached) return;

      if (clamped <= 0.01) {
        mesh.material = pristine.material;
        return;
      }
      mesh.material = this.scorchFor(key, pristine.color, clamped);
    });
  }

  /**
   * Extremities first, core last. Ranking by distance from the silhouette's
   * centre keeps this generic: it works for any generator without the gallery
   * knowing what a "torso" or a "tail" is called.
   */
  private partsByDetachOrder(entry: GalleryEntry): [string, Mesh][] {
    const parts = Array.from(entry.resolved.parts.entries());
    const size = entry.resolved.inspection.boundingBoxMeters;
    const centre = new Vector3(0, size.y / 2, 0);

    return parts
      .map((part) => {
        const offset = part[1].position.subtract(centre);
        // Vertical distance counts for less: a head is core, an outstretched arm is not.
        return { part, rank: Math.hypot(offset.x, offset.y * 0.5, offset.z) };
      })
      .sort((a, b) => b.rank - a.rank || a.part[0].localeCompare(b.part[0]))
      .map((entry) => entry.part);
  }

  private rememberPristine(key: string, mesh: Mesh): { material: Material | null; color: Color3 } {
    const existing = this.pristine.get(key);
    if (existing) return existing;
    const material = mesh.material;
    const color =
      material instanceof StandardMaterial ? material.diffuseColor.clone() : new Color3(0.5, 0.5, 0.5);
    const record = { material, color };
    this.pristine.set(key, record);
    return record;
  }

  private scorchFor(key: string, pristineColor: Color3, level: number): StandardMaterial {
    let scorch = this.damageMaterials.get(key);
    if (!scorch) {
      scorch = new StandardMaterial(`gallery.damage.${key}`, this.scene);
      this.damageMaterials.set(key, scorch);
    }
    scorch.diffuseColor = Color3.Lerp(pristineColor, new Color3(0.12, 0.09, 0.08), level);
    scorch.emissiveColor = new Color3(level * 0.25, level * 0.05, 0);
    return scorch;
  }

  measurements(index: number): GalleryMeasurements | undefined {
    const entry = this.entries[index];
    if (!entry) return undefined;
    const budget = budgetFor(entry.manifest.assetClass);
    const size = entry.resolved.inspection.boundingBoxMeters;
    return {
      id: entry.manifest.id,
      displayName: entry.manifest.displayName,
      assetClass: entry.manifest.assetClass,
      origin: entry.resolved.origin,
      heightMeters: size.y,
      widthMeters: size.x,
      depthMeters: size.z,
      triangleCount: entry.resolved.inspection.triangleCount,
      materialCount: entry.resolved.inspection.materialCount,
      triangleBudget: budget.maxTriangles,
      materialBudget: budget.maxMaterials,
      socketIds: Array.from(entry.resolved.sockets.keys()),
      diagnostics: entry.resolved.diagnostics.map((d) => ({
        severity: d.severity,
        code: d.code,
        message: d.message,
      })),
    };
  }

  /** Every budget violation across the whole gallery, for the summary line. */
  budgetViolations(): readonly string[] {
    const violations: string[] = [];
    for (const entry of this.entries) {
      for (const diagnostic of entry.resolved.diagnostics) {
        violations.push(`${entry.manifest.id}: ${diagnostic.code} — ${diagnostic.message}`);
      }
    }
    return violations;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rotationObserver?.remove();
    this.rotationObserver = undefined;
    this.fill?.dispose();
    this.fill = undefined;
    this.deck?.dispose();
    this.deck = undefined;
    this.deckMaterial?.dispose();
    this.deckMaterial = undefined;
    for (const material of this.damageMaterials.values()) material.dispose();
    this.damageMaterials.clear();
    this.pristine.clear();
    for (const entry of this.entries) entry.resolved.dispose();
    this.entries.length = 0;
  }
}
