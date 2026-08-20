import { ContentRegistry, type RegistryEntry } from "../data/registry";
import type { Vec3 } from "../entities/entity";

/**
 * Asset manifests are plain serializable data with no Babylon or DOM types, so
 * they can be validated headlessly and later moved to JSON without a rewrite.
 */

export const ASSET_CLASSES = [
  "jaeger",
  "kaiju",
  "building",
  "vehicle",
  "ship",
  "prop",
  "shatterdome-module",
] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

/** Attachment points gameplay code refers to by name, never by mesh index. */
export const SOCKET_IDS = [
  "head",
  "chest",
  "back",
  "reactor",
  "hand.L",
  "hand.R",
  "forearm.L",
  "forearm.R",
  "foot.L",
  "foot.R",
  "muzzle",
] as const;
export type SocketId = (typeof SOCKET_IDS)[number];

/** Project convention: assets face +Z, stand on Y=0, and are authored in metres. */
export const CANONICAL_FORWARD_AXIS = "+Z";
export type ForwardAxis = "+Z" | "-Z" | "+X" | "-X";

export interface AssetProvenance {
  readonly author: string;
  /** SPDX identifier, or "original-procedural" for generated placeholders. */
  readonly license: string;
  readonly sourceUrl: string | null;
  readonly notes: string;
}

export interface AssetSource {
  /** Path under public/ for the production model, or null while only the generator exists. */
  readonly url: string | null;
  readonly format: "glb" | "gltf";
}

export interface GeneratorReference {
  readonly id: string;
  readonly params: Readonly<Record<string, number | string | boolean>>;
}

export interface SocketDefinition {
  readonly id: SocketId;
  /** Offset from the asset root in metres, used when the model supplies no node. */
  readonly position: Vec3;
  /** Node name to bind to when the production model provides this socket. */
  readonly nodeName: string | null;
}

export interface CollisionProxy {
  readonly shape: "box" | "capsule" | "sphere";
  readonly size: Vec3;
  readonly center: Vec3;
}

export interface AnimationClipManifest {
  /** Gameplay-facing tag, e.g. "idle" or "attack.light". Code references this, never the clip name. */
  readonly id: string;
  /** Clip name inside the production model. */
  readonly clipName: string;
  readonly loop: boolean;
}

export interface MaterialSlotManifest {
  readonly id: string;
  readonly baseColorHex: string;
  readonly metallic: number;
  readonly roughness: number;
  readonly textureUrl: string | null;
}

export interface AudioManifest {
  readonly id: string;
  readonly url: string | null;
}

export interface PortraitManifest {
  readonly id: string;
  readonly url: string | null;
}

export interface AssetManifest extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  readonly assetClass: AssetClass;
  readonly source: AssetSource;
  /** Always present: an asset must remain renderable with no production files installed. */
  readonly fallbackGenerator: GeneratorReference;
  readonly nominalHeightMeters: number;
  readonly materials: readonly MaterialSlotManifest[];
  readonly animations: readonly AnimationClipManifest[];
  readonly sockets: readonly SocketDefinition[];
  readonly collision: CollisionProxy;
  readonly audio: readonly AudioManifest[];
  readonly portrait: PortraitManifest | null;
  readonly provenance: AssetProvenance;
  /** Seed for the procedural fallback, so generated geometry is reproducible. */
  readonly seed: number;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function vec3Errors(label: string, value: Vec3 | undefined): string[] {
  if (!value || typeof value !== "object") return [`${label} must be a {x,y,z} object`];
  const errors: string[] = [];
  for (const axis of ["x", "y", "z"] as const) {
    if (!Number.isFinite(value[axis])) errors.push(`${label}.${axis} must be a finite number`);
  }
  return errors;
}

function unitInterval(label: string, value: number): string[] {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? [] : [`${label} must be within [0, 1]`];
}

export function validateAssetManifest(manifest: AssetManifest): string[] {
  const errors: string[] = [];

  if (!manifest.id) errors.push("id required");
  if (!manifest.displayName) errors.push("displayName required");
  if (!ASSET_CLASSES.includes(manifest.assetClass)) {
    errors.push(`assetClass must be one of: ${ASSET_CLASSES.join(", ")}`);
  }
  if (!Number.isFinite(manifest.nominalHeightMeters) || manifest.nominalHeightMeters <= 0) {
    errors.push("nominalHeightMeters must be a positive number");
  }
  if (!Number.isFinite(manifest.seed)) errors.push("seed must be a finite number");

  // A manifest with neither a production model nor a generator cannot render at all.
  if (!manifest.fallbackGenerator?.id) {
    errors.push("fallbackGenerator.id required so the asset stays renderable without production files");
  }

  const seenSockets = new Set<string>();
  for (const socket of manifest.sockets) {
    if (!SOCKET_IDS.includes(socket.id)) {
      errors.push(`socket "${socket.id}" is not a known socket id`);
    }
    if (seenSockets.has(socket.id)) errors.push(`socket "${socket.id}" is declared more than once`);
    seenSockets.add(socket.id);
    errors.push(...vec3Errors(`socket "${socket.id}" position`, socket.position));
  }

  const seenMaterials = new Set<string>();
  for (const material of manifest.materials) {
    if (!material.id) errors.push("material slot id required");
    if (seenMaterials.has(material.id)) errors.push(`material slot "${material.id}" is duplicated`);
    seenMaterials.add(material.id);
    if (!HEX_COLOR.test(material.baseColorHex)) {
      errors.push(`material "${material.id}" baseColorHex must look like #rrggbb`);
    }
    errors.push(...unitInterval(`material "${material.id}" metallic`, material.metallic));
    errors.push(...unitInterval(`material "${material.id}" roughness`, material.roughness));
  }

  const seenAnimations = new Set<string>();
  for (const clip of manifest.animations) {
    if (!clip.id) errors.push("animation clip id required");
    if (seenAnimations.has(clip.id)) errors.push(`animation tag "${clip.id}" is duplicated`);
    seenAnimations.add(clip.id);
    if (!clip.clipName) errors.push(`animation "${clip.id}" needs a clipName`);
  }

  const seenAudio = new Set<string>();
  for (const audio of manifest.audio) {
    if (!audio.id) errors.push("audio slot id required");
    if (seenAudio.has(audio.id)) errors.push(`audio slot "${audio.id}" is duplicated`);
    seenAudio.add(audio.id);
  }

  errors.push(...vec3Errors("collision.size", manifest.collision?.size));
  errors.push(...vec3Errors("collision.center", manifest.collision?.center));

  if (!manifest.provenance?.author) errors.push("provenance.author required");
  if (!manifest.provenance?.license) errors.push("provenance.license required");

  return errors;
}

export function createAssetRegistry(): ContentRegistry<AssetManifest> {
  return new ContentRegistry<AssetManifest>(validateAssetManifest);
}

/**
 * Presentation-only patch applied on top of a manifest. Swapping a model or a
 * palette must never touch gameplay data, so overrides can only reach fields
 * that describe how an asset looks or where it loads from.
 */
export interface AssetManifestOverride {
  readonly source?: AssetSource;
  readonly fallbackGenerator?: GeneratorReference;
  readonly materials?: readonly MaterialSlotManifest[];
  readonly portrait?: PortraitManifest | null;
}

export function applyAssetOverride(base: AssetManifest, override: AssetManifestOverride): AssetManifest {
  return {
    ...base,
    source: override.source ?? base.source,
    fallbackGenerator: override.fallbackGenerator ?? base.fallbackGenerator,
    materials: override.materials ?? base.materials,
    portrait: override.portrait === undefined ? base.portrait : override.portrait,
  };
}
