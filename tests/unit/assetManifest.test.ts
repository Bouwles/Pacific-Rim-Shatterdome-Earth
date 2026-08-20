import { describe, expect, it } from "vitest";
import {
  applyAssetOverride,
  createAssetRegistry,
  validateAssetManifest,
  type AssetManifest,
} from "../../src/assets/manifest";
import { ASSET_MANIFESTS, createDefaultAssetRegistry } from "../../src/data/assets";

function baseManifest(overrides: Partial<AssetManifest> = {}): AssetManifest {
  return {
    id: "test.asset",
    displayName: "Test Asset",
    assetClass: "prop",
    source: { url: null, format: "glb" },
    fallbackGenerator: { id: "prop", params: { kind: "crate", heightMeters: 2, radiusMeters: 1 } },
    nominalHeightMeters: 2,
    materials: [{ id: "paint", baseColorHex: "#aabbcc", metallic: 0.5, roughness: 0.5, textureUrl: null }],
    animations: [{ id: "idle", clipName: "Idle", loop: true }],
    sockets: [{ id: "muzzle", position: { x: 0, y: 1, z: 0 }, nodeName: null }],
    collision: { shape: "box", size: { x: 2, y: 2, z: 2 }, center: { x: 0, y: 1, z: 0 } },
    audio: [{ id: "thud", url: null }],
    portrait: null,
    provenance: { author: "test", license: "original-procedural", sourceUrl: null, notes: "" },
    seed: 1,
    ...overrides,
  };
}

describe("validateAssetManifest", () => {
  it("accepts a well formed manifest", () => {
    expect(validateAssetManifest(baseManifest())).toEqual([]);
  });

  it("requires a fallback generator so an asset is never unrenderable", () => {
    const broken = baseManifest({ fallbackGenerator: { id: "", params: {} } });
    expect(validateAssetManifest(broken).join(" ")).toMatch(/fallbackGenerator\.id required/);
  });

  it("rejects unknown socket ids and duplicates", () => {
    const unknown = baseManifest({
      sockets: [{ id: "elbow.L" as never, position: { x: 0, y: 0, z: 0 }, nodeName: null }],
    });
    expect(validateAssetManifest(unknown).join(" ")).toMatch(/not a known socket id/);

    const duplicated = baseManifest({
      sockets: [
        { id: "muzzle", position: { x: 0, y: 0, z: 0 }, nodeName: null },
        { id: "muzzle", position: { x: 0, y: 1, z: 0 }, nodeName: null },
      ],
    });
    expect(validateAssetManifest(duplicated).join(" ")).toMatch(/declared more than once/);
  });

  it("rejects malformed colours and out of range material values", () => {
    const badColor = baseManifest({
      materials: [{ id: "paint", baseColorHex: "red", metallic: 0.5, roughness: 0.5, textureUrl: null }],
    });
    expect(validateAssetManifest(badColor).join(" ")).toMatch(/#rrggbb/);

    const badMetallic = baseManifest({
      materials: [{ id: "paint", baseColorHex: "#ffffff", metallic: 4, roughness: 0.5, textureUrl: null }],
    });
    expect(validateAssetManifest(badMetallic).join(" ")).toMatch(/metallic must be within \[0, 1\]/);
  });

  it("rejects duplicate animation tags and non-positive heights", () => {
    const duplicated = baseManifest({
      animations: [
        { id: "idle", clipName: "Idle", loop: true },
        { id: "idle", clipName: "Idle2", loop: true },
      ],
    });
    expect(validateAssetManifest(duplicated).join(" ")).toMatch(/animation tag "idle" is duplicated/);

    expect(validateAssetManifest(baseManifest({ nominalHeightMeters: 0 })).join(" ")).toMatch(
      /nominalHeightMeters must be a positive number/,
    );
  });

  it("requires provenance so licensing is always recorded", () => {
    const missing = baseManifest({
      provenance: { author: "", license: "", sourceUrl: null, notes: "" },
    });
    const errors = validateAssetManifest(missing).join(" ");
    expect(errors).toMatch(/provenance\.author required/);
    expect(errors).toMatch(/provenance\.license required/);
  });

  it("registry rejects an invalid manifest rather than storing it", () => {
    const registry = createAssetRegistry();
    expect(() => registry.register(baseManifest({ nominalHeightMeters: -1 }))).toThrow(
      /Invalid registry entry/,
    );
    expect(registry.has("test.asset")).toBe(false);
  });
});

describe("applyAssetOverride", () => {
  it("swaps presentation fields and leaves everything else identical", () => {
    const base = baseManifest();
    const swapped = applyAssetOverride(base, {
      source: { url: "/assets/models/test.glb", format: "glb" },
      materials: [{ id: "paint", baseColorHex: "#123456", metallic: 0.1, roughness: 0.2, textureUrl: null }],
    });

    expect(swapped.source.url).toBe("/assets/models/test.glb");
    expect(swapped.materials[0]?.baseColorHex).toBe("#123456");

    // Anything gameplay could read must survive the swap untouched.
    expect(swapped.id).toBe(base.id);
    expect(swapped.collision).toEqual(base.collision);
    expect(swapped.sockets).toEqual(base.sockets);
    expect(swapped.nominalHeightMeters).toBe(base.nominalHeightMeters);
    expect(swapped.animations).toEqual(base.animations);
  });

  it("leaves the base untouched when the override is empty", () => {
    const base = baseManifest();
    expect(applyAssetOverride(base, {})).toEqual(base);
  });
});

describe("shipped asset manifests", () => {
  it("all register successfully", () => {
    const registry = createDefaultAssetRegistry();
    expect(registry.all()).toHaveLength(ASSET_MANIFESTS.length);
  });

  it("cover every asset class the generators support", () => {
    const classes = new Set(ASSET_MANIFESTS.map((m) => m.assetClass));
    expect([...classes].sort()).toEqual([
      "building",
      "jaeger",
      "kaiju",
      "prop",
      "shatterdome-module",
      "ship",
      "vehicle",
    ]);
  });

  it("ship no third party content", () => {
    for (const manifest of ASSET_MANIFESTS) {
      expect(manifest.provenance.license).toBe("original-procedural");
      expect(manifest.source.url).toBeNull();
    }
  });
});
