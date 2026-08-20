import type { AssetClass } from "./manifest";

export interface AssetBudget {
  readonly maxTriangles: number;
  readonly maxMaterials: number;
  readonly maxTextureBytes: number;
}

const MB = 1024 * 1024;

/**
 * Per-class ceilings for a single instance of a production asset. These are the
 * asset-authoring half of docs/PERFORMANCE_BUDGETS.md: a model that violates one
 * is reported by the gallery rather than silently shipped.
 */
export const ASSET_BUDGETS: Readonly<Record<AssetClass, AssetBudget>> = {
  // Hero units: on screen constantly, close to camera, deserve the largest share.
  jaeger: { maxTriangles: 150_000, maxMaterials: 8, maxTextureBytes: 32 * MB },
  kaiju: { maxTriangles: 150_000, maxMaterials: 8, maxTextureBytes: 32 * MB },
  // Scenery: instanced heavily, so per-instance cost dominates the frame.
  building: { maxTriangles: 8_000, maxMaterials: 3, maxTextureBytes: 8 * MB },
  // Three slots because a road vehicle genuinely needs body, glass and tyres;
  // the original two forced an atlas for no benefit at this size.
  vehicle: { maxTriangles: 4_000, maxMaterials: 3, maxTextureBytes: 4 * MB },
  ship: { maxTriangles: 20_000, maxMaterials: 4, maxTextureBytes: 8 * MB },
  prop: { maxTriangles: 2_000, maxMaterials: 2, maxTextureBytes: 2 * MB },
  "shatterdome-module": { maxTriangles: 60_000, maxMaterials: 6, maxTextureBytes: 16 * MB },
};

export function budgetFor(assetClass: AssetClass): AssetBudget {
  return ASSET_BUDGETS[assetClass];
}
