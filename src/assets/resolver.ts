import { Mesh, SceneLoader, TransformNode, Vector3, type Scene } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import type { ContentRegistry } from "../data/registry";
import { createSeededRng } from "../simulation/rng";
import { MaterialPalette, type ProceduralGenerator } from "./generators";
import { validateAssetInspection, type AssetDiagnostic, type AssetInspection } from "./inspection";
import { CANONICAL_FORWARD_AXIS, type AssetManifest, type SocketId } from "./manifest";

export type AssetOrigin = "model" | "generator";

export interface ResolvedAsset {
  readonly manifest: AssetManifest;
  readonly root: TransformNode;
  readonly sockets: ReadonlyMap<SocketId, TransformNode>;
  readonly parts: ReadonlyMap<string, Mesh>;
  readonly origin: AssetOrigin;
  readonly inspection: AssetInspection;
  readonly diagnostics: readonly AssetDiagnostic[];
  dispose(): void;
}

export type WarningSink = (message: string) => void;

/**
 * Turns a manifest into something renderable. A missing or broken production
 * model is not an error state: the procedural generator takes over so the game
 * stays playable, and exactly one actionable warning is logged per asset.
 */
export class AssetResolver {
  private readonly warnedAssets = new Set<string>();

  constructor(
    private readonly generators: ContentRegistry<ProceduralGenerator>,
    private readonly warn: WarningSink = (message) => console.warn(message),
  ) {}

  async resolve(manifest: AssetManifest, scene: Scene, instanceName?: string): Promise<ResolvedAsset> {
    const name = instanceName ?? manifest.id;

    if (manifest.source.url) {
      try {
        return await this.loadModel(manifest, scene, name);
      } catch (error) {
        this.warnOnce(
          manifest.id,
          `Asset "${manifest.id}" could not load its model at "${manifest.source.url}" ` +
            `(${error instanceof Error ? error.message : String(error)}). ` +
            `Falling back to the "${manifest.fallbackGenerator.id}" placeholder. ` +
            `Place the file under public/${manifest.source.url.replace(/^\/+/, "")} to use the real asset.`,
        );
      }
    }

    return this.generate(manifest, scene, name);
  }

  /** Warn once per asset id: a repeated failure in a render loop must not flood the console. */
  private warnOnce(assetId: string, message: string): void {
    if (this.warnedAssets.has(assetId)) return;
    this.warnedAssets.add(assetId);
    this.warn(message);
  }

  private async loadModel(manifest: AssetManifest, scene: Scene, name: string): Promise<ResolvedAsset> {
    const url = manifest.source.url as string;
    const lastSlash = url.lastIndexOf("/");
    const rootUrl = url.slice(0, lastSlash + 1);
    const fileName = url.slice(lastSlash + 1);

    const result = await SceneLoader.ImportMeshAsync("", rootUrl, fileName, scene);
    const root = new TransformNode(name, scene);
    const parts = new Map<string, Mesh>();

    for (const mesh of result.meshes) {
      if (!mesh.parent) mesh.parent = root;
      if (mesh instanceof Mesh) parts.set(mesh.name, mesh);
    }

    const sockets = new Map<SocketId, TransformNode>();
    const nodesByName = new Map<string, TransformNode>();
    for (const node of result.transformNodes) nodesByName.set(node.name, node);
    for (const mesh of result.meshes) nodesByName.set(mesh.name, mesh as unknown as TransformNode);

    for (const socket of manifest.sockets) {
      const bound = socket.nodeName ? nodesByName.get(socket.nodeName) : undefined;
      sockets.set(socket.id, bound ?? this.socketNode(scene, name, socket.id, socket.position, root));
    }

    const inspection = inspectHierarchy(root, {
      skeletonBoneNames: result.skeletons.flatMap((skeleton) => skeleton.bones.map((bone) => bone.name)),
      animationNames: result.animationGroups.map((group) => group.name),
    });
    const diagnostics = validateAssetInspection(manifest, inspection);

    const dispose = (): void => {
      for (const group of result.animationGroups) group.dispose();
      for (const skeleton of result.skeletons) skeleton.dispose();
      root.dispose(false, true);
    };

    return { manifest, root, sockets, parts, origin: "model", inspection, diagnostics, dispose };
  }

  private generate(manifest: AssetManifest, scene: Scene, name: string): ResolvedAsset {
    const generator = this.generators.get(manifest.fallbackGenerator.id);
    if (!generator) {
      throw new Error(
        `Asset "${manifest.id}" names fallback generator "${manifest.fallbackGenerator.id}", ` +
          `which is not registered. Known generators: ${this.generators
            .all()
            .map((g) => g.id)
            .join(", ")}.`,
      );
    }

    const paramErrors = generator.validateParams(manifest.fallbackGenerator.params);
    if (paramErrors.length > 0) {
      throw new Error(
        `Asset "${manifest.id}" has invalid params for generator "${generator.id}": ${paramErrors.join("; ")}`,
      );
    }

    const palette = new MaterialPalette(scene, name, manifest.materials);
    const generated = generator.build(manifest.fallbackGenerator.params, {
      scene,
      name,
      rng: createSeededRng(manifest.seed),
      material: (slotId) => palette.material(slotId),
    });

    const sockets = new Map<SocketId, TransformNode>(generated.sockets);
    for (const socket of manifest.sockets) {
      if (!sockets.has(socket.id)) {
        sockets.set(socket.id, this.socketNode(scene, name, socket.id, socket.position, generated.root));
      }
    }

    // Generated geometry has no textures or animation clips, so those checks are
    // evaluated against what actually exists rather than assumed to pass.
    const inspection = inspectHierarchy(generated.root, { skeletonBoneNames: [], animationNames: [] });
    const diagnostics = validateAssetInspection(manifest, inspection).filter(
      // Clip and node bindings only mean something for a production model.
      (diagnostic) => diagnostic.code !== "animation-clip" && diagnostic.code !== "socket-node",
    );

    const dispose = (): void => {
      generated.root.dispose(false, true);
      palette.dispose();
    };

    return {
      manifest,
      root: generated.root,
      sockets,
      parts: generated.parts,
      origin: "generator",
      inspection,
      diagnostics,
      dispose,
    };
  }

  private socketNode(
    scene: Scene,
    name: string,
    id: SocketId,
    position: { x: number; y: number; z: number },
    parent: TransformNode,
  ): TransformNode {
    const node = new TransformNode(`${name}.socket.${id}`, scene);
    node.position.set(position.x, position.y, position.z);
    node.parent = parent;
    return node;
  }
}

/** Measures a built hierarchy so budgets and scale are checked against reality, not against the manifest. */
export function inspectHierarchy(
  root: TransformNode,
  extra: { skeletonBoneNames: readonly string[]; animationNames: readonly string[] },
): AssetInspection {
  const meshes = root.getChildMeshes(false);
  let triangleCount = 0;
  const materials = new Set<string>();
  let textureBytes = 0;
  const missingTextureUrls: string[] = [];

  let min = new Vector3(Infinity, Infinity, Infinity);
  let max = new Vector3(-Infinity, -Infinity, -Infinity);

  for (const mesh of meshes) {
    triangleCount += mesh.getTotalIndices() / 3;
    if (mesh.material) {
      materials.add(mesh.material.uniqueId.toString());
      for (const texture of mesh.material.getActiveTextures()) {
        const size = texture.getSize();
        // 4 bytes per texel, plus a third again for a full mip chain.
        textureBytes += size.width * size.height * 4 * 1.33;
        if (texture.name && !texture.isReady()) missingTextureUrls.push(texture.name);
      }
    }
    mesh.computeWorldMatrix(true);
    const bounds = mesh.getBoundingInfo().boundingBox;
    min = Vector3.Minimize(min, bounds.minimumWorld);
    max = Vector3.Maximize(max, bounds.maximumWorld);
  }

  if (meshes.length === 0) {
    min = Vector3.Zero();
    max = Vector3.Zero();
  }

  const rootPosition = root.position;
  return {
    triangleCount: Math.round(triangleCount),
    materialCount: materials.size,
    textureBytes: Math.round(textureBytes),
    missingTextureUrls,
    boundingBoxMeters: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
    // How far the base of the asset sits from its own root, on the ground plane.
    originOffsetMeters: { x: 0, y: min.y - rootPosition.y, z: 0 },
    forwardAxis: CANONICAL_FORWARD_AXIS,
    skeletonBoneNames: extra.skeletonBoneNames,
    animationNames: extra.animationNames,
  };
}
