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
  description:
    "Development stand-in Jaeger used to exercise the content-registry pattern. Not a film or canon design.",
});
