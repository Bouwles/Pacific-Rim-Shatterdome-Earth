import { ContentRegistry, type RegistryEntry } from "./registry";
import type { DamageKind } from "./moves";
import type { JaegerDefinition } from "./jaegers";

/**
 * What a Jaeger is made of.
 *
 * A machine is not a health bar. It is a Conn-Pod, a torso, a reactor, two
 * arms, two legs and a sensor mast, each with its own health, its own armour,
 * its own idea of which damage kinds hurt it, and its own consequence for being
 * lost. Losing a right arm silences the weapons mounted on it; losing a leg
 * changes how the machine walks; losing the reactor or the Conn-Pod ends the
 * sortie.
 *
 * The table is generic across machines and scaled by each machine's own mass,
 * so a new chassis is a row in `jaegers.ts` rather than a second copy of this
 * file.
 */

/** What a component stops working when it is lost. Read, never switched on. */
export const JAEGER_SYSTEMS = [
  "pilot",
  "power",
  "cooling",
  "sensors",
  "targeting",
  "movement",
  "balance",
  "weapons.left",
  "weapons.right",
  "grapple",
] as const;
export type JaegerSystem = (typeof JAEGER_SYSTEMS)[number];

/** Where a weapon hangs. A weapon on a lost mount cannot be fired. */
export const WEAPON_MOUNTS = ["arm.left", "arm.right", "shoulder.left", "shoulder.right", "chest"] as const;
export type WeaponMount = (typeof WEAPON_MOUNTS)[number];

export interface ComponentDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  /** Where it sits, as fractions of the machine's own height. */
  readonly heightFraction: number;
  readonly lateralFraction: number;
  readonly forwardFraction: number;
  readonly radiusFraction: number;
  /** Share of the machine's structural budget. All shares together make one. */
  readonly healthShare: number;
  /** 0 to 1 of incoming damage absorbed before health is touched. */
  readonly armor: number;
  /** Multiplier on what gets through. A Conn-Pod is soft; a torso is not. */
  readonly damageMultiplier: number;
  /**
   * Damage-kind routing. A multiplier above one means this component is the
   * wrong place to be hit by that kind. Anything unlisted is 1.
   */
  readonly vulnerableTo: Partial<Record<DamageKind, number>>;
  /** Systems that stop working when this component is destroyed. */
  readonly disables: readonly JaegerSystem[];
  /** Weapon mounts carried here. Lost with the component. */
  readonly mounts: readonly WeaponMount[];
  /** True when losing it ends the sortie rather than degrading it. */
  readonly critical: boolean;
  /** Hours of work per point of structure restored, and the parts bill per point. */
  readonly repairHoursPerPoint: number;
  readonly repairCostPerPoint: number;
  readonly description: string;
}

const COMPONENTS: readonly ComponentDefinition[] = [
  {
    id: "component.conn-pod",
    displayName: "Conn-Pod",
    heightFraction: 0.93,
    lateralFraction: 0,
    forwardFraction: 0.02,
    radiusFraction: 0.075,
    healthShare: 0.12,
    armor: 0.45,
    damageMultiplier: 1,
    // The one place a neural weapon is worth more than a hammer.
    vulnerableTo: { neural: 3, radiation: 1.8, electrical: 1.5 },
    disables: ["pilot", "sensors", "targeting"],
    mounts: [],
    critical: true,
    repairHoursPerPoint: 0.06,
    repairCostPerPoint: 900,
    description: "Two pilots and the drift. Small, hard, and the end of the fight if it goes.",
  },
  {
    id: "component.sensor-mast",
    displayName: "Sensor mast",
    heightFraction: 0.86,
    lateralFraction: 0.06,
    forwardFraction: 0,
    radiusFraction: 0.05,
    healthShare: 0.04,
    armor: 0.15,
    damageMultiplier: 1.3,
    vulnerableTo: { electrical: 2.2, energy: 1.6, radiation: 1.4 },
    disables: ["sensors", "targeting"],
    mounts: [],
    critical: false,
    repairHoursPerPoint: 0.04,
    repairCostPerPoint: 700,
    description: "Optics and ranging. Cheap to fix, and fighting without it is guesswork.",
  },
  {
    id: "component.torso",
    displayName: "Torso",
    heightFraction: 0.62,
    lateralFraction: 0,
    forwardFraction: 0,
    radiusFraction: 0.16,
    healthShare: 0.26,
    armor: 0.4,
    damageMultiplier: 1,
    vulnerableTo: { crush: 1.3, impact: 1.15 },
    disables: ["balance"],
    mounts: ["chest"],
    critical: false,
    repairHoursPerPoint: 0.02,
    repairCostPerPoint: 260,
    description: "The frame everything else hangs off. Most of the machine's structure is here.",
  },
  {
    id: "component.reactor",
    displayName: "Reactor",
    heightFraction: 0.55,
    lateralFraction: 0,
    forwardFraction: -0.06,
    radiusFraction: 0.09,
    healthShare: 0.1,
    armor: 0.5,
    damageMultiplier: 1.2,
    vulnerableTo: { pierce: 1.8, plasma: 1.6, corrosive: 1.4 },
    disables: ["power", "cooling", "weapons.left", "weapons.right"],
    mounts: [],
    critical: true,
    repairHoursPerPoint: 0.09,
    repairCostPerPoint: 1_400,
    description: "Buried behind the torso plate on purpose. Everything stops when it does.",
  },
  {
    id: "component.arm.left",
    displayName: "Left arm",
    heightFraction: 0.66,
    lateralFraction: -0.2,
    forwardFraction: 0,
    radiusFraction: 0.075,
    healthShare: 0.11,
    armor: 0.3,
    damageMultiplier: 1,
    vulnerableTo: { shear: 1.5, corrosive: 1.2 },
    disables: ["weapons.left", "grapple"],
    mounts: ["arm.left", "shoulder.left"],
    critical: false,
    repairHoursPerPoint: 0.03,
    repairCostPerPoint: 420,
    description: "Actuators, a fist, and whatever is bolted to the shoulder above it.",
  },
  {
    id: "component.arm.right",
    displayName: "Right arm",
    heightFraction: 0.66,
    lateralFraction: 0.2,
    forwardFraction: 0,
    radiusFraction: 0.075,
    healthShare: 0.11,
    armor: 0.3,
    damageMultiplier: 1,
    vulnerableTo: { shear: 1.5, corrosive: 1.2 },
    disables: ["weapons.right", "grapple"],
    mounts: ["arm.right", "shoulder.right"],
    critical: false,
    repairHoursPerPoint: 0.03,
    repairCostPerPoint: 420,
    description: "The one most machines lead with, and the one that comes back bent.",
  },
  {
    id: "component.leg.left",
    displayName: "Left leg",
    heightFraction: 0.24,
    lateralFraction: -0.1,
    forwardFraction: 0,
    radiusFraction: 0.085,
    healthShare: 0.13,
    armor: 0.35,
    damageMultiplier: 0.9,
    vulnerableTo: { crush: 1.4, impact: 1.2 },
    disables: ["movement", "balance"],
    mounts: [],
    critical: false,
    repairHoursPerPoint: 0.035,
    repairCostPerPoint: 380,
    description: "Half of how the machine stands up. Losing one does not stop it, it slows it.",
  },
  {
    id: "component.leg.right",
    displayName: "Right leg",
    heightFraction: 0.24,
    lateralFraction: 0.1,
    forwardFraction: 0,
    radiusFraction: 0.085,
    healthShare: 0.13,
    armor: 0.35,
    damageMultiplier: 0.9,
    vulnerableTo: { crush: 1.4, impact: 1.2 },
    disables: ["movement", "balance"],
    mounts: [],
    critical: false,
    repairHoursPerPoint: 0.035,
    repairCostPerPoint: 380,
    description: "The other half. A machine on one leg is a machine being towed home.",
  },
];

export function validateComponent(entry: ComponentDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("component.")) errors.push('id must start with "component."');
  if (!entry.displayName) errors.push("displayName required");
  if (!entry.description) errors.push("description required");
  for (const key of ["heightFraction", "radiusFraction", "healthShare"] as const) {
    if (!Number.isFinite(entry[key]) || entry[key] <= 0) errors.push(`${key} must be above zero`);
  }
  if (entry.armor < 0 || entry.armor >= 1) errors.push("armor must be between zero and one");
  if (entry.damageMultiplier <= 0) errors.push("damageMultiplier must be above zero");
  for (const [kind, scale] of Object.entries(entry.vulnerableTo)) {
    if (!Number.isFinite(scale) || (scale as number) <= 0) {
      errors.push(`vulnerableTo.${kind} must be above zero`);
    }
  }
  // A component nobody feels the loss of is a component nobody will maintain.
  if (entry.disables.length === 0 && entry.mounts.length === 0 && !entry.critical) {
    errors.push(
      "a component must disable a system, carry a mount, or be critical: losing it has to cost something",
    );
  }
  for (const key of ["repairHoursPerPoint", "repairCostPerPoint"] as const) {
    if (!Number.isFinite(entry[key]) || entry[key] <= 0) errors.push(`${key} must be above zero`);
  }
  return errors;
}

export function createComponentRegistry(): ContentRegistry<ComponentDefinition> {
  const registry = new ContentRegistry<ComponentDefinition>(validateComponent);
  for (const component of COMPONENTS) registry.register(component);
  const shares = COMPONENTS.reduce((total, entry) => total + entry.healthShare, 0);
  // The shares are a division of one machine, so they have to divide one machine.
  if (Math.abs(shares - 1) > 0.001) {
    throw new Error(`Component health shares must total 1, got ${shares.toFixed(3)}`);
  }
  if (!COMPONENTS.some((entry) => entry.critical)) {
    throw new Error("At least one component must be critical, or a machine can never be lost");
  }
  return registry;
}

export const COMPONENT_DEFINITIONS = COMPONENTS;

/** A machine's structural budget, from its own mass. */
export function structureBudget(jaeger: JaegerDefinition): number {
  return 2_400 + jaeger.massBudget.massTons;
}

/** How much structure one component of one machine has. */
export function componentHealth(jaeger: JaegerDefinition, component: ComponentDefinition): number {
  return Math.round(structureBudget(jaeger) * component.healthShare);
}

/** Damage-kind routing for one component, as a plain multiplier. */
export function kindScale(component: ComponentDefinition, kind: DamageKind): number {
  return component.vulnerableTo[kind] ?? 1;
}
