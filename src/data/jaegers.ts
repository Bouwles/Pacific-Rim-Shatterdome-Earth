import { ContentRegistry } from "./registry";

export interface JaegerMassBudget {
  readonly massTons: number;
  readonly powerOutputMw: number;
  /** 0..1 fraction of reactor heat the cooling system can dissipate at sustained load. */
  readonly coolingCapacity: number;
}

export interface JaegerDefinition {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly markDesignation: string;
  readonly massBudget: JaegerMassBudget;
  /**
   * Asset manifest this machine is rendered from. The roster names a manifest id
   * and never a mesh, which is what makes a model swap a data change.
   */
  readonly assetId: string;
  readonly description: string;
}

function validateJaeger(entry: JaegerDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id) errors.push("id required");
  if (!entry.name) errors.push("name required");
  if (!entry.manufacturer) errors.push("manufacturer required");
  if (entry.massBudget.massTons <= 0) errors.push("massBudget.massTons must be > 0");
  if (entry.massBudget.powerOutputMw <= 0) errors.push("massBudget.powerOutputMw must be > 0");
  if (entry.massBudget.coolingCapacity < 0 || entry.massBudget.coolingCapacity > 1) {
    errors.push("massBudget.coolingCapacity must be within [0, 1]");
  }
  // Without a manifest the bay would have nothing to stand in a berth, and the
  // failure would surface as an empty room rather than as a content error.
  if (!entry.assetId) errors.push("assetId required so the roster resolves to an asset manifest");
  return errors;
}

export const jaegerRegistry = new ContentRegistry<JaegerDefinition>(validateJaeger);

// Non-canon procedural placeholder — proves the registry/validation pattern before
// real Jaeger data exists. Replace/extend via CONTENT_REGISTRY.md, never by adding
// a switch-on-id branch in gameplay code.
jaegerRegistry.register({
  id: "placeholder-mk0",
  name: "Placeholder Sentinel",
  manufacturer: "Shatterdome Earth R&D (procedural placeholder)",
  markDesignation: "Mk-0 (development stand-in)",
  massBudget: { massTons: 1800, powerOutputMw: 220, coolingCapacity: 0.6 },
  assetId: "jaeger.placeholder-mk0",
  description:
    "Development stand-in Jaeger used to exercise the content-registry pattern. Not a film or canon design.",
});

// A second stand-in so the bay has a roster to choose between rather than one
// machine and an empty berth. Also non-canon, also procedural.
jaegerRegistry.register({
  id: "heavy-mk4",
  name: "Placeholder Bulwark",
  manufacturer: "Shatterdome Earth R&D (procedural placeholder)",
  markDesignation: "Mk-4 (development stand-in)",
  massBudget: { massTons: 2450, powerOutputMw: 310, coolingCapacity: 0.72 },
  assetId: "jaeger.heavy-mk4",
  description:
    "Heavier development stand-in, used to prove the roster and the berths are data rather than fixtures.",
});
