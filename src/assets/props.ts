import {
  AbstractMesh,
  PBRMaterial,
  SceneLoader,
  TransformNode,
  Vector3,
  type AssetContainer,
  type Scene,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

/**
 * Props.
 *
 * Imported kit pieces (Kenney's CC0 factory, city and road kits; see
 * THIRD_PARTY_ASSETS.md) placed by the rooms and the district. One container
 * per file, loaded on first use; every placement is an instance of that
 * container's meshes, so a hundred crates cost one set of buffers.
 *
 * Nothing here knows what a room is. It takes a model name, a footprint to
 * fit, a position and a heading, and puts the piece there with its base on
 * the floor. Fitting is by measured bounds, not assumed units.
 */

export type PropKit = "factory" | "city" | "roads";

const ROOTS: Readonly<Record<PropKit, string>> = {
  // Relative to the build base so a subfolder deployment finds the files.
  factory: `${import.meta.env.BASE_URL}assets/models/factory/`,
  city: `${import.meta.env.BASE_URL}assets/models/city/`,
  roads: `${import.meta.env.BASE_URL}assets/models/roads/`,
};

export interface PropPlacement {
  readonly kit: PropKit;
  readonly model: string;
  readonly x: number;
  readonly y?: number;
  readonly z: number;
  /** Heading in degrees about Y, the project's bearing convention. */
  readonly yawDeg?: number;
  /** Target footprint in metres; the piece is scaled uniformly to fit the largest ratio when given. */
  readonly fit?: { readonly width?: number; readonly height?: number; readonly depth?: number };
  /** Explicit uniform scale, when fit is not given. */
  readonly scale?: number;
}

export interface PlacedProp {
  readonly root: TransformNode;
  readonly model: string;
  dispose(): void;
}

interface LoadedKitModel {
  readonly container: AssetContainer;
  readonly size: Vector3;
  readonly minY: number;
}

export class PropLibrary {
  private readonly scene: Scene;
  private readonly models = new Map<string, Promise<LoadedKitModel | null>>();
  private readonly placed = new Set<PlacedProp>();
  private readonly warn: (message: string) => void;
  private placedCount = 0;
  private disposed = false;

  constructor(scene: Scene, warn: (message: string) => void = () => undefined) {
    this.scene = scene;
    this.warn = warn;
  }

  /** Places one piece. Resolves to null when the file is unavailable or the library was disposed. */
  async place(placement: PropPlacement, parent: TransformNode | null = null): Promise<PlacedProp | null> {
    if (this.disposed || typeof window === "undefined") return null;
    const loaded = await this.load(placement.kit, placement.model);
    if (!loaded || this.disposed) return null;
    this.placedCount += 1;
    const tag = `prop.${placement.model}.${this.placedCount}`;
    const entries = loaded.container.instantiateModelsToScene((name) => `${tag}.${name}`, false, {
      doNotInstantiate: false,
    });
    const root = new TransformNode(tag, this.scene);
    root.parent = parent;
    let scale = placement.scale ?? 1;
    const fit = placement.fit;
    if (fit) {
      const ratios: number[] = [];
      if (fit.width !== undefined && loaded.size.x > 0) ratios.push(fit.width / loaded.size.x);
      if (fit.height !== undefined && loaded.size.y > 0) ratios.push(fit.height / loaded.size.y);
      if (fit.depth !== undefined && loaded.size.z > 0) ratios.push(fit.depth / loaded.size.z);
      if (ratios.length > 0) scale = Math.min(...ratios);
    }
    for (const node of entries.rootNodes) {
      const transform = node as TransformNode;
      transform.parent = root;
      transform.scaling = new Vector3(scale, scale, scale);
      transform.position.y = -loaded.minY * scale;
      for (const mesh of transform.getChildMeshes()) mesh.isPickable = false;
      if (transform instanceof AbstractMesh) transform.isPickable = false;
    }
    root.position.set(placement.x, placement.y ?? 0, placement.z);
    root.rotation.y = ((placement.yawDeg ?? 0) * Math.PI) / 180;
    const prop: PlacedProp = {
      root,
      model: placement.model,
      dispose: () => {
        if (!this.placed.delete(prop)) return;
        root.dispose();
      },
    };
    this.placed.add(prop);
    return prop;
  }

  /** Places many pieces; the returned promise resolves once every load has settled. */
  async placeAll(
    placements: readonly PropPlacement[],
    parent: TransformNode | null = null,
  ): Promise<PlacedProp[]> {
    const results = await Promise.all(placements.map((placement) => this.place(placement, parent)));
    return results.filter((prop): prop is PlacedProp => prop !== null);
  }

  get count(): number {
    return this.placed.size;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const prop of this.placed) prop.root.dispose();
    this.placed.clear();
    for (const loading of this.models.values()) void loading.then((model) => model?.container.dispose());
    this.models.clear();
  }

  private load(kit: PropKit, model: string): Promise<LoadedKitModel | null> {
    const key = `${kit}/${model}`;
    const existing = this.models.get(key);
    if (existing) return existing;
    const loading = SceneLoader.LoadAssetContainerAsync(ROOTS[kit], `${model}.glb`, this.scene)
      .then((container) => {
        if (this.disposed) {
          container.dispose();
          return null;
        }
        // Kit materials are flat colour; a little roughness stops them shining like plastic.
        for (const material of container.materials) {
          if (material instanceof PBRMaterial) {
            material.metallic = 0.05;
            material.roughness = 0.9;
          }
        }
        let min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
        let max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
        for (const mesh of container.meshes) {
          mesh.computeWorldMatrix(true);
          const bounds = mesh.getBoundingInfo().boundingBox;
          min = Vector3.Minimize(min, bounds.minimumWorld);
          max = Vector3.Maximize(max, bounds.maximumWorld);
        }
        const size = max.subtract(min);
        if (!Number.isFinite(size.x)) return { container, size: new Vector3(1, 1, 1), minY: 0 };
        return { container, size, minY: min.y };
      })
      .catch((error: unknown) => {
        this.warn(`Prop "${key}" could not load: ${String(error)}.`);
        return null;
      });
    this.models.set(key, loading);
    return loading;
  }
}
