import { describe, expect, it } from "vitest";
import { budgetFor } from "../../src/assets/budgets";
import { hasErrors, validateAssetInspection, type AssetInspection } from "../../src/assets/inspection";
import type { AssetManifest } from "../../src/assets/manifest";

const manifest: AssetManifest = {
  id: "jaeger.test",
  displayName: "Test Jaeger",
  assetClass: "jaeger",
  source: { url: "/assets/models/test.glb", format: "glb" },
  fallbackGenerator: { id: "biped", params: { heightMeters: 75 } },
  nominalHeightMeters: 75,
  materials: [],
  animations: [{ id: "idle", clipName: "Idle", loop: true }],
  sockets: [{ id: "hand.R", position: { x: 1, y: 1, z: 0 }, nodeName: "socket_hand_R" }],
  collision: { shape: "box", size: { x: 20, y: 75, z: 15 }, center: { x: 0, y: 37, z: 0 } },
  audio: [],
  portrait: null,
  provenance: { author: "test", license: "original-procedural", sourceUrl: null, notes: "" },
  seed: 1,
};

function inspection(overrides: Partial<AssetInspection> = {}): AssetInspection {
  return {
    triangleCount: 40_000,
    materialCount: 4,
    textureBytes: 8 * 1024 * 1024,
    missingTextureUrls: [],
    boundingBoxMeters: { x: 22, y: 75, z: 16 },
    originOffsetMeters: { x: 0, y: 0, z: 0 },
    forwardAxis: "+Z",
    skeletonBoneNames: ["socket_hand_R"],
    animationNames: ["Idle"],
    ...overrides,
  };
}

describe("validateAssetInspection", () => {
  it("passes a conforming asset", () => {
    expect(validateAssetInspection(manifest, inspection())).toEqual([]);
  });

  it("flags a model authored in the wrong unit", () => {
    // A 75m Jaeger exported in centimetres reads as 7500 units tall.
    const diagnostics = validateAssetInspection(
      manifest,
      inspection({ boundingBoxMeters: { x: 22, y: 7500, z: 16 } }),
    );
    expect(diagnostics.some((d) => d.code === "scale" && d.severity === "error")).toBe(true);
    expect(hasErrors(diagnostics)).toBe(true);
  });

  it("accepts height drift inside the tolerance", () => {
    const diagnostics = validateAssetInspection(
      manifest,
      inspection({ boundingBoxMeters: { x: 22, y: 78, z: 16 } }),
    );
    expect(diagnostics.filter((d) => d.code === "scale")).toEqual([]);
  });

  it("flags a model facing the wrong way", () => {
    const diagnostics = validateAssetInspection(manifest, inspection({ forwardAxis: "-Z" }));
    const axis = diagnostics.find((d) => d.code === "forward-axis");
    expect(axis?.severity).toBe("error");
    expect(axis?.message).toMatch(/requires \+Z/);
  });

  it("flags an origin that is not at the base", () => {
    const diagnostics = validateAssetInspection(
      manifest,
      inspection({ originOffsetMeters: { x: 0, y: 12, z: 0 } }),
    );
    expect(diagnostics.some((d) => d.code === "origin" && d.severity === "error")).toBe(true);
  });

  it("flags a socket whose node is missing and lists what the model does have", () => {
    const diagnostics = validateAssetInspection(manifest, inspection({ skeletonBoneNames: ["wrist_R"] }));
    const socket = diagnostics.find((d) => d.code === "socket-node");
    expect(socket?.severity).toBe("error");
    expect(socket?.message).toMatch(/wrist_R/);
  });

  it("flags a missing animation clip", () => {
    const diagnostics = validateAssetInspection(manifest, inspection({ animationNames: ["Walk"] }));
    expect(diagnostics.some((d) => d.code === "animation-clip" && d.severity === "error")).toBe(true);
  });

  it("flags every texture that failed to load", () => {
    const diagnostics = validateAssetInspection(
      manifest,
      inspection({ missingTextureUrls: ["hull_basecolor.png", "hull_normal.png"] }),
    );
    expect(diagnostics.filter((d) => d.code === "missing-texture")).toHaveLength(2);
  });

  it("warns rather than errors when budgets are exceeded", () => {
    const budget = budgetFor("jaeger");
    const diagnostics = validateAssetInspection(
      manifest,
      inspection({
        triangleCount: budget.maxTriangles + 1,
        materialCount: budget.maxMaterials + 1,
        textureBytes: budget.maxTextureBytes + 1,
      }),
    );
    const codes = diagnostics.map((d) => d.code).sort();
    expect(codes).toEqual(["material-budget", "texture-budget", "triangle-budget"]);
    expect(diagnostics.every((d) => d.severity === "warning")).toBe(true);
    // Over budget is a cost problem, not a correctness one, so the asset still loads.
    expect(hasErrors(diagnostics)).toBe(false);
  });

  it("applies the budget of the asset's own class", () => {
    const prop: AssetManifest = { ...manifest, id: "prop.test", assetClass: "prop", nominalHeightMeters: 2 };
    const diagnostics = validateAssetInspection(
      prop,
      inspection({ triangleCount: 40_000, boundingBoxMeters: { x: 1, y: 2, z: 1 } }),
    );
    // 40k triangles is fine for a Jaeger and far too many for a prop.
    expect(diagnostics.some((d) => d.code === "triangle-budget")).toBe(true);
  });
});
