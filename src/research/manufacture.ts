import { jaegerRegistry, type JaegerDefinition } from "../data/jaegers";
import { ContentRegistry } from "../data/registry";

/**
 * Building a machine nobody sells.
 *
 * A research frame is not bought and not delivered. It is laid down in the
 * complex out of components that only exist because a branch was finished, and
 * it costs exactly what the bill of materials says. Nothing here is a discount
 * or a shortcut: if the stores are one component short, the answer is no, and it
 * says which one.
 *
 * Pure and injectable. It reads what is held and reports what it would take; the
 * caller does the taking, through the economy that owns the balances and the
 * roster that owns the machines.
 */

/** What one exclusive frame is made of. */
export interface ManufactureRecipe {
  readonly chassisId: string;
  /** Research node that has to be finished before this can be laid down. */
  readonly requiresNode: string;
  /** Rare components, by the id the research that unlocked them named. */
  readonly components: Readonly<Record<string, number>>;
  /** Ordinary materials out of the economy's own pool. */
  readonly alloy: number;
  readonly reactorMaterial: number;
  readonly funding: number;
  /** Facility that has to be able to build it. */
  readonly requiresFacility: { readonly facilityId: string; readonly tier: number };
  readonly buildTicks: number;
  readonly summary: string;
}

const RECIPES: readonly ManufactureRecipe[] = [
  {
    chassisId: "harmonic-mk1",
    requiresNode: "research.chassis.harmonic-frame",
    components: { "component.laminate-hull": 4 },
    alloy: 1_400,
    reactorMaterial: 60,
    funding: 4_200_000,
    requiresFacility: { facilityId: "manufacture", tier: 1 },
    buildTicks: 9_000,
    summary: "Laminate hull sections around a frame built for one weapon.",
  },
  {
    chassisId: "leviathan-mk1",
    requiresNode: "research.chassis.leviathan-frame",
    components: { "component.laminate-hull": 6, "component.resonance-core": 1 },
    alloy: 2_600,
    reactorMaterial: 180,
    funding: 9_800_000,
    requiresFacility: { facilityId: "manufacture", tier: 2 },
    buildTicks: 16_000,
    summary: "A hull laid down around a recovered core, on the deepest deck there is.",
  },
];

export function validateRecipe(entry: ManufactureRecipe): string[] {
  const errors: string[] = [];
  if (!entry.chassisId.trim()) errors.push("chassisId is required");
  if (!entry.requiresNode.startsWith("research.")) errors.push("requiresNode must be a research node");
  if (Object.keys(entry.components).length === 0) {
    // A frame made of nothing rare is a frame that could have been bought.
    errors.push("an exclusive frame must need at least one researched component");
  }
  for (const [id, count] of Object.entries(entry.components)) {
    if (!id.startsWith("component.")) errors.push(`bad component id "${id}"`);
    if (count <= 0) errors.push(`${id} count must be positive`);
  }
  for (const key of ["alloy", "reactorMaterial", "funding", "buildTicks"] as const) {
    if (!Number.isFinite(entry[key]) || entry[key] <= 0) errors.push(`${key} must be above zero`);
  }
  if (entry.requiresFacility.tier <= 0) errors.push("facility tier must be positive");
  if (!entry.summary.trim()) errors.push("summary is required");
  return errors;
}

/** Keyed by chassis, because that is how a caller asks. */
export function createManufactureRegistry(
  chassis: ContentRegistry<JaegerDefinition> = jaegerRegistry,
): ContentRegistry<ManufactureRecipe & { readonly id: string }> {
  const registry = new ContentRegistry<ManufactureRecipe & { readonly id: string }>((entry) => {
    const errors = validateRecipe(entry);
    const definition = chassis.get(entry.chassisId);
    if (!definition) errors.push(`unknown chassis "${entry.chassisId}"`);
    else if (!definition.acquisition.includes("research-manufacture")) {
      // The rule that keeps the two lists honest: a recipe for something the
      // chassis table says can be bought would be a second way to get it.
      errors.push(`${entry.chassisId} is not marked research-manufacture`);
    }
    return errors;
  });
  for (const recipe of RECIPES) registry.register({ ...recipe, id: recipe.chassisId });
  return registry;
}

export const MANUFACTURE_RECIPES = RECIPES;

/** Everything a build has to be checked against. */
export interface ManufactureContext {
  readonly completedNodes: readonly string[];
  /** Researched components held in stores. */
  readonly components: Readonly<Record<string, number>>;
  readonly alloy: number;
  readonly reactorMaterial: number;
  readonly funding: number;
  readonly facilityTiers: Readonly<Record<string, number>>;
  /** Machines already owned, so a one-off stays a one-off if it should. */
  readonly ownedChassisIds: readonly string[];
}

export interface ManufactureQuote {
  readonly recipe: ManufactureRecipe;
  /** Null when it can be laid down; otherwise exactly what is missing. */
  readonly refusal: string | null;
  /** Every line of the bill, so a player sees what they are committing. */
  readonly lines: readonly { readonly label: string; readonly amount: string }[];
}

/**
 * Whether a frame can be laid down, and what it would take.
 *
 * Always returns the bill, refused or not, because a player deciding whether to
 * chase the last component needs to see the whole cost rather than the first
 * thing that stopped them.
 */
export function quoteManufacture(recipe: ManufactureRecipe, context: ManufactureContext): ManufactureQuote {
  const lines: { readonly label: string; readonly amount: string }[] = [];
  for (const [id, count] of Object.entries(recipe.components)) {
    const held = context.components[id] ?? 0;
    lines.push({ label: id.replace("component.", "").replace("-", " "), amount: `${held} of ${count}` });
  }
  lines.push({ label: "Structural alloy", amount: `${Math.round(context.alloy)} of ${recipe.alloy} t` });
  lines.push({
    label: "Reactor material",
    amount: `${Math.round(context.reactorMaterial)} of ${recipe.reactorMaterial}`,
  });
  lines.push({ label: "Funding", amount: recipe.funding.toLocaleString("en-GB") });

  let refusal: string | null = null;
  const fail = (reason: string) => {
    if (refusal === null) refusal = reason;
  };

  if (!context.completedNodes.includes(recipe.requiresNode)) {
    fail("The programme behind it is not finished.");
  }
  const tier = context.facilityTiers[recipe.requiresFacility.facilityId] ?? 0;
  if (tier < recipe.requiresFacility.tier) {
    fail(`Needs ${recipe.requiresFacility.facilityId} at tier ${recipe.requiresFacility.tier}.`);
  }
  for (const [id, count] of Object.entries(recipe.components)) {
    const held = context.components[id] ?? 0;
    if (held < count) fail(`Short ${count - held} ${id.replace("component.", "").replace("-", " ")}.`);
  }
  if (context.alloy < recipe.alloy) fail(`Short ${Math.ceil(recipe.alloy - context.alloy)} t of alloy.`);
  if (context.reactorMaterial < recipe.reactorMaterial) {
    fail(`Short ${Math.ceil(recipe.reactorMaterial - context.reactorMaterial)} reactor material.`);
  }
  if (context.funding < recipe.funding) {
    fail(`Short ${Math.round(recipe.funding - context.funding).toLocaleString("en-GB")} credits.`);
  }

  return { recipe, refusal, lines };
}

/** Exactly what laying one down consumes. Nothing rounds in the player's favour. */
export function manufactureCost(recipe: ManufactureRecipe): {
  readonly components: Readonly<Record<string, number>>;
  readonly alloy: number;
  readonly reactorMaterial: number;
  readonly funding: number;
} {
  return {
    components: { ...recipe.components },
    alloy: recipe.alloy,
    reactorMaterial: recipe.reactorMaterial,
    funding: recipe.funding,
  };
}
