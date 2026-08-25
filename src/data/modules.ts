import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * Modules.
 *
 * A module is a physical thing bolted into a machine, so unlike a passive it can
 * be taken out again and moved to another machine. Slots are opened by levels
 * and by having prestiged, and a module is fitted in the bay rather than in the
 * field: swapping one takes a machine out of service for a shift.
 *
 * Modules and passives feed the same growth object from opposite directions:
 * passives are a permanent decision about what the machine is, modules are a
 * reversible decision about what it is carrying today. Both are rows in a table.
 */

export const MODULE_CLASSES = ["frame", "reactor", "cooling", "targeting", "field"] as const;
export type ModuleClass = (typeof MODULE_CLASSES)[number];

export interface ModuleDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  readonly moduleClass: ModuleClass;
  /** Level a machine has to have reached before this can be fitted at all. */
  readonly requiresLevel: number;
  /** Prestige rank required, for the two that only a returning machine can carry. */
  readonly requiresPrestige: number;
  /** Multipliers on the machine's growth. Anything omitted is 1. */
  readonly structure?: number;
  readonly damage?: number;
  readonly heat?: number;
  readonly mobility?: number;
  /** What fitting it costs in funding, once. */
  readonly cost: number;
  /** Hours the bay needs to fit or remove it. */
  readonly fittingHours: number;
  readonly tradeoff: string;
  readonly description: string;
}

const DEFINITIONS: readonly ModuleDefinition[] = [
  {
    id: "module.spine-brace",
    displayName: "Spine brace",
    moduleClass: "frame",
    requiresLevel: 1,
    requiresPrestige: 0,
    structure: 1.08,
    mobility: 0.97,
    cost: 240_000,
    fittingHours: 6,
    tradeoff: "Weight through the middle. It turns a little slower.",
    description: "A bolted brace across the spine. The cheapest way to make a machine harder to break.",
  },
  {
    id: "module.impact-drivers",
    displayName: "Impact drivers",
    moduleClass: "frame",
    requiresLevel: 6,
    requiresPrestige: 0,
    damage: 1.09,
    heat: 0.96,
    cost: 380_000,
    fittingHours: 8,
    tradeoff: "Drives run hot. The lockout comes sooner.",
    description: "Hydraulic drivers behind each fist. Every landed hit carries more behind it.",
  },
  {
    id: "module.heat-sink-array",
    displayName: "Heat sink array",
    moduleClass: "cooling",
    requiresLevel: 6,
    requiresPrestige: 0,
    heat: 1.15,
    mobility: 0.98,
    cost: 420_000,
    fittingHours: 8,
    tradeoff: "Radiators on the back. Bulky, and it shows when it moves.",
    description: "Sheds heat far faster, so the machine keeps working through a long fight.",
  },
  {
    id: "module.output-governor",
    displayName: "Output governor",
    moduleClass: "reactor",
    requiresLevel: 14,
    requiresPrestige: 0,
    damage: 1.12,
    structure: 0.96,
    cost: 640_000,
    fittingHours: 12,
    tradeoff: "Runs the reactor past its rated envelope. The frame pays for it.",
    description: "Lifts the ceiling on reactor output, and lets the arms use it.",
  },
  {
    id: "module.gyro-stabiliser",
    displayName: "Gyro stabiliser",
    moduleClass: "field",
    requiresLevel: 14,
    requiresPrestige: 0,
    mobility: 1.12,
    structure: 0.97,
    cost: 560_000,
    fittingHours: 10,
    tradeoff: "Delicate. It is the first thing to break when the machine goes down.",
    description: "Keeps the machine upright through its own momentum. Quicker in every direction.",
  },
  {
    id: "module.predictive-targeting",
    displayName: "Predictive targeting",
    moduleClass: "targeting",
    requiresLevel: 22,
    requiresPrestige: 0,
    damage: 1.08,
    heat: 1.05,
    mobility: 0.96,
    cost: 720_000,
    fittingHours: 10,
    tradeoff: "A sensor mast and its housing. Real weight, high up, where it is felt most.",
    description: "Reads the swing before it lands and puts it where the plate is thinnest.",
  },
  {
    id: "module.composite-shell",
    displayName: "Composite shell",
    moduleClass: "frame",
    requiresLevel: 22,
    requiresPrestige: 0,
    structure: 1.16,
    mobility: 0.94,
    cost: 810_000,
    fittingHours: 14,
    tradeoff: "The heaviest thing on this list, and it moves like it.",
    description: "Full recladding in layered composite. Very hard to get through.",
  },
  {
    id: "module.veterans-core",
    displayName: "Veteran's core",
    moduleClass: "reactor",
    requiresLevel: 1,
    requiresPrestige: 1,
    structure: 1.06,
    damage: 1.06,
    heat: 1.06,
    cost: 1_200_000,
    fittingHours: 16,
    tradeoff: "Only fits a machine that has been to the cap and started again. Nothing given up.",
    description: "A reactor core rebuilt around a machine that has already proved it can take it.",
  },
  {
    id: "module.long-service-loom",
    displayName: "Long service loom",
    moduleClass: "field",
    requiresLevel: 1,
    requiresPrestige: 10,
    structure: 1.1,
    heat: 1.1,
    mobility: 1.04,
    cost: 2_400_000,
    fittingHours: 20,
    tradeoff: "Ten ranks of service to be allowed to fit it. That is the cost.",
    description: "Every cable, line and joint replaced by something better than the factory fitted.",
  },
];

export function validateModule(entry: ModuleDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("module.")) errors.push('module ids must start with "module."');
  if (!MODULE_CLASSES.includes(entry.moduleClass)) errors.push(`unknown class ${entry.moduleClass}`);
  if (!Number.isInteger(entry.requiresLevel) || entry.requiresLevel < 1) {
    errors.push("requiresLevel must be a level a machine can actually reach");
  }
  if (!Number.isInteger(entry.requiresPrestige) || entry.requiresPrestige < 0) {
    errors.push("requiresPrestige must be zero or a real rank");
  }
  if (!Number.isFinite(entry.cost) || entry.cost <= 0) {
    errors.push("a module has to cost something: fitting one is a decision about money");
  }
  if (!Number.isFinite(entry.fittingHours) || entry.fittingHours <= 0) {
    errors.push("fitting takes the bay real hours, so it cannot be free");
  }

  const axes = [entry.structure, entry.damage, entry.heat, entry.mobility];
  if (axes.every((value) => value === undefined)) errors.push("a module that changes nothing is scrap");
  for (const value of axes) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      errors.push("every multiplier must be a positive number");
    }
  }
  // Anything with no downside has to be gated behind prestige, or a fresh
  // machine could simply buy its way past a machine that earned its rank.
  const losses = axes.filter((value) => value !== undefined && value < 1).length;
  if (losses === 0 && entry.requiresPrestige <= 0) {
    errors.push("a module with no downside must require prestige, or it is just a better machine for money");
  }
  if (entry.tradeoff.trim().length < 10) errors.push("the tradeoff must be written out in words");
  return errors;
}

export function createModuleRegistry(): ContentRegistry<ModuleDefinition> {
  const registry = new ContentRegistry<ModuleDefinition>(validateModule);
  for (const entry of DEFINITIONS) registry.register(entry);
  return registry;
}

export const MODULE_DEFINITIONS = DEFINITIONS;

/** Whether a machine at this level and rank is allowed to carry this module. */
export function canFit(
  entry: ModuleDefinition,
  level: number,
  prestige: number,
): { readonly ok: boolean; readonly message: string } {
  if (level < entry.requiresLevel) {
    return { ok: false, message: `Needs level ${entry.requiresLevel}. This machine is level ${level}.` };
  }
  if (prestige < entry.requiresPrestige) {
    return {
      ok: false,
      message: `Needs prestige ${entry.requiresPrestige}. This machine is at ${prestige}.`,
    };
  }
  return { ok: true, message: `Fits. ${entry.fittingHours} hours in the bay.` };
}

/** The multipliers a set of fitted modules contributes, multiplied together. */
export function moduleBonus(
  registry: ContentRegistry<ModuleDefinition>,
  fitted: readonly string[],
): { structure: number; damage: number; heat: number; mobility: number } {
  const total = { structure: 1, damage: 1, heat: 1, mobility: 1 };
  for (const id of fitted) {
    const entry = registry.get(id);
    if (!entry) continue;
    total.structure *= entry.structure ?? 1;
    total.damage *= entry.damage ?? 1;
    total.heat *= entry.heat ?? 1;
    total.mobility *= entry.mobility ?? 1;
  }
  return total;
}
