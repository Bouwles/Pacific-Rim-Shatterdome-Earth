import { budgetFor, type AssetBudget } from "./budgets";
import { CANONICAL_FORWARD_AXIS, type AssetManifest, type ForwardAxis } from "./manifest";
import type { Vec3 } from "../entities/entity";

/**
 * Everything measured from a loaded model, expressed as plain data. The loader
 * fills this in; validation stays pure so it can be unit tested without a GPU.
 */
export interface AssetInspection {
  readonly triangleCount: number;
  readonly materialCount: number;
  readonly textureBytes: number;
  readonly missingTextureUrls: readonly string[];
  readonly boundingBoxMeters: Vec3;
  /** Distance from the asset root to where its feet/base actually sit. */
  readonly originOffsetMeters: Vec3;
  readonly forwardAxis: ForwardAxis;
  readonly skeletonBoneNames: readonly string[];
  readonly animationNames: readonly string[];
}

export interface AssetDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
}

/** A model this far off its declared height is almost certainly authored in the wrong unit. */
const SCALE_TOLERANCE = 0.1;
/** Feet should sit on the origin; more than this and placement code has to compensate per asset. */
const ORIGIN_TOLERANCE_METERS = 0.05;

export function validateAssetInspection(
  manifest: AssetManifest,
  inspection: AssetInspection,
  budget: AssetBudget = budgetFor(manifest.assetClass),
): AssetDiagnostic[] {
  const diagnostics: AssetDiagnostic[] = [];
  const error = (code: string, message: string): void => {
    diagnostics.push({ severity: "error", code, message });
  };
  const warn = (code: string, message: string): void => {
    diagnostics.push({ severity: "warning", code, message });
  };

  const height = inspection.boundingBoxMeters.y;
  const expected = manifest.nominalHeightMeters;
  const drift = Math.abs(height - expected) / expected;
  if (drift > SCALE_TOLERANCE) {
    error(
      "scale",
      `"${manifest.id}" measures ${height.toFixed(2)}m tall but declares ${expected.toFixed(2)}m ` +
        `(${(drift * 100).toFixed(0)}% off). Re-export in metres or correct nominalHeightMeters.`,
    );
  }

  if (inspection.forwardAxis !== CANONICAL_FORWARD_AXIS) {
    error(
      "forward-axis",
      `"${manifest.id}" faces ${inspection.forwardAxis}; this project requires ${CANONICAL_FORWARD_AXIS}. ` +
        `Rotate the model in the DCC tool rather than compensating in code.`,
    );
  }

  const offset = Math.hypot(
    inspection.originOffsetMeters.x,
    inspection.originOffsetMeters.y,
    inspection.originOffsetMeters.z,
  );
  if (offset > ORIGIN_TOLERANCE_METERS) {
    error(
      "origin",
      `"${manifest.id}" origin is ${offset.toFixed(2)}m from its base. ` +
        `Move the pivot to the base centre so ground placement needs no per-asset offset.`,
    );
  }

  const bones = new Set(inspection.skeletonBoneNames);
  for (const socket of manifest.sockets) {
    if (socket.nodeName && !bones.has(socket.nodeName)) {
      error(
        "socket-node",
        `"${manifest.id}" socket "${socket.id}" expects node "${socket.nodeName}", ` +
          `which the model does not contain. Available: ${inspection.skeletonBoneNames.join(", ") || "none"}.`,
      );
    }
  }

  const clips = new Set(inspection.animationNames);
  for (const animation of manifest.animations) {
    if (!clips.has(animation.clipName)) {
      error(
        "animation-clip",
        `"${manifest.id}" animation tag "${animation.id}" expects clip "${animation.clipName}", ` +
          `which the model does not contain. Available: ${inspection.animationNames.join(", ") || "none"}.`,
      );
    }
  }

  for (const url of inspection.missingTextureUrls) {
    error("missing-texture", `"${manifest.id}" references texture "${url}", which failed to load.`);
  }

  if (inspection.triangleCount > budget.maxTriangles) {
    warn(
      "triangle-budget",
      `"${manifest.id}" uses ${inspection.triangleCount.toLocaleString()} triangles, over the ` +
        `${manifest.assetClass} budget of ${budget.maxTriangles.toLocaleString()}.`,
    );
  }

  if (inspection.materialCount > budget.maxMaterials) {
    warn(
      "material-budget",
      `"${manifest.id}" uses ${inspection.materialCount} materials, over the ` +
        `${manifest.assetClass} budget of ${budget.maxMaterials}. Each one costs a draw call.`,
    );
  }

  if (inspection.textureBytes > budget.maxTextureBytes) {
    const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    warn(
      "texture-budget",
      `"${manifest.id}" uses ${mb(inspection.textureBytes)} of texture memory, over the ` +
        `${manifest.assetClass} budget of ${mb(budget.maxTextureBytes)}.`,
    );
  }

  return diagnostics;
}

export function hasErrors(diagnostics: readonly AssetDiagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
