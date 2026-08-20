import type { AssetManifest, AssetManifestOverride } from "../assets/manifest";

export interface GalleryOverrideDefinition {
  readonly id: string;
  readonly label: string;
  /** Returns null to leave the manifest untouched. */
  build(manifest: AssetManifest): AssetManifestOverride | null;
}

/**
 * Presentation swaps the gallery can apply. Each one only reaches fields that
 * describe how an asset looks or where it loads from, which is what makes
 * "changing a manifest cannot change gameplay" true by construction.
 */
export const GALLERY_OVERRIDES: readonly GalleryOverrideDefinition[] = [
  {
    id: "default",
    label: "Default manifest",
    build: () => null,
  },
  {
    id: "alt-palette",
    label: "Alternate palette",
    build: (manifest) => ({
      materials: manifest.materials.map((slot, index) => ({
        ...slot,
        baseColorHex: index % 2 === 0 ? "#2f6f8f" : "#d8842c",
      })),
    }),
  },
  {
    id: "external-model",
    label: "Production model (not installed)",
    // Points at a file that is deliberately absent, so the fallback path and its
    // single warning can be exercised from the UI rather than only in tests.
    build: (manifest) => ({
      source: { url: `/assets/models/${manifest.id}.glb`, format: "glb" },
    }),
  },
];

export function buildOverrideMap(
  overrideId: string,
  manifests: readonly AssetManifest[],
): Map<string, AssetManifestOverride> {
  const definition = GALLERY_OVERRIDES.find((entry) => entry.id === overrideId);
  const map = new Map<string, AssetManifestOverride>();
  if (!definition) return map;
  for (const manifest of manifests) {
    const override = definition.build(manifest);
    if (override) map.set(manifest.id, override);
  }
  return map;
}
