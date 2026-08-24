import {
  componentHealth,
  createComponentRegistry,
  kindScale,
  type ComponentDefinition,
  type JaegerSystem,
  type WeaponMount,
} from "../data/components";
import type { ContentRegistry } from "../data/registry";
import type { DamageKind } from "../data/moves";
import type { JaegerDefinition } from "../data/jaegers";

/**
 * Damage that outlives the fight it happened in.
 *
 * Every component carries its own structure, its own state, and a short list of
 * scars. A scar is four numbers, not a transform: which component, how bad, what
 * kind of damage made it, and a seed. The view grows the debris from that seed,
 * so a machine that comes home with a torn arm looks the same every time it is
 * loaded without anybody saving a hundred pieces of wreckage.
 *
 * Nothing here imports Babylon, the DOM or a clock.
 */

export const COMPONENT_STATES = ["intact", "scarred", "damaged", "critical", "destroyed"] as const;
export type ComponentState = (typeof COMPONENT_STATES)[number];

/** Where each state begins, as a fraction of the component's own structure. */
const STATE_THRESHOLDS: readonly { readonly state: ComponentState; readonly above: number }[] = [
  { state: "intact", above: 0.9 },
  { state: "scarred", above: 0.65 },
  { state: "damaged", above: 0.35 },
  { state: "critical", above: 0 },
];

export function stateForFraction(fraction: number): ComponentState {
  if (fraction <= 0) return "destroyed";
  for (const step of STATE_THRESHOLDS) {
    if (fraction > step.above) return step.state;
  }
  return "critical";
}

/** One mark left on a machine. Compact on purpose: this is what gets saved. */
export interface Scar {
  readonly componentId: string;
  /** 0 to 1. How much of the component went in one blow. */
  readonly severity: number;
  readonly kind: DamageKind;
  /** Drives where the debris sits. The view is a pure function of this. */
  readonly seed: number;
}

export interface ComponentDamage {
  readonly componentId: string;
  health: number;
  readonly maxHealth: number;
  /** Ticks of accumulated shock, past which the part is offline but repairable. */
  shock: number;
}

export interface JaegerDamageState {
  readonly jaegerId: string;
  readonly components: ComponentDamage[];
  readonly scars: Scar[];
  /** Total structure lost across every component, for the work order. */
  lostStructure: number;
}

export interface DamageApplication {
  readonly componentId: string;
  /** What actually came off after armour and routing. */
  readonly applied: number;
  readonly state: ComponentState;
  readonly previousState: ComponentState;
  readonly destroyed: boolean;
  /** Systems that stopped working because of this hit. */
  readonly disabled: readonly JaegerSystem[];
  readonly scar: Scar | null;
  /** Plain language, for the log and the repair board. */
  readonly message: string;
}

/** How bad a hit has to be before it leaves a mark worth drawing. */
const SCAR_SEVERITY = 0.08;
/** No machine keeps more marks than this. The oldest and mildest go first. */
export const MAX_SCARS = 24;

export function createDamageState(
  jaeger: JaegerDefinition,
  registry: ContentRegistry<ComponentDefinition> = createComponentRegistry(),
): JaegerDamageState {
  return {
    jaegerId: jaeger.id,
    components: registry.all().map((component) => ({
      componentId: component.id,
      health: componentHealth(jaeger, component),
      maxHealth: componentHealth(jaeger, component),
      shock: 0,
    })),
    scars: [],
    lostStructure: 0,
  };
}

export function componentFraction(entry: ComponentDamage): number {
  return entry.maxHealth <= 0 ? 0 : entry.health / entry.maxHealth;
}

export function componentState(entry: ComponentDamage): ComponentState {
  return stateForFraction(componentFraction(entry));
}

/**
 * Puts damage on one component.
 *
 * Armour comes off first, then the component's own multiplier, then the routing
 * for the kind of damage it was. That order is what makes a plasma round worth
 * more against a reactor than against a leg without either of them knowing about
 * the other.
 */
export function applyComponentDamage(
  state: JaegerDamageState,
  registry: ContentRegistry<ComponentDefinition>,
  componentId: string,
  amount: number,
  kind: DamageKind,
  seed: number,
): DamageApplication | null {
  const component = registry.get(componentId);
  const entry = state.components.find((record) => record.componentId === componentId);
  if (!component || !entry) return null;

  const previousState = componentState(entry);
  if (previousState === "destroyed") {
    // A part that is already gone cannot absorb anything: the hit falls through
    // to whatever is behind it, which is the caller's problem, not this one's.
    return {
      componentId,
      applied: 0,
      state: "destroyed",
      previousState,
      destroyed: false,
      disabled: [],
      scar: null,
      message: `${component.displayName} is already gone.`,
    };
  }

  const throughArmor = Math.max(0, amount * (1 - component.armor));
  const applied = Math.max(0, throughArmor * component.damageMultiplier * kindScale(component, kind));
  const before = entry.health;
  entry.health = Math.max(0, entry.health - applied);
  const removed = before - entry.health;
  state.lostStructure += removed;

  const severity = entry.maxHealth <= 0 ? 0 : removed / entry.maxHealth;
  const nextState = componentState(entry);
  // Anything already destroyed returned above, so this is the crossing itself.
  const destroyed = nextState === "destroyed";

  let scar: Scar | null = null;
  if (severity >= SCAR_SEVERITY || destroyed) {
    scar = { componentId, severity: Math.min(1, severity), kind, seed: seed >>> 0 };
    state.scars.push(scar);
    // Bounded on purpose: a machine that has been through twenty fights keeps
    // the worst of them rather than a growing list nobody can read.
    while (state.scars.length > MAX_SCARS) {
      let mildest = 0;
      for (let index = 1; index < state.scars.length; index += 1) {
        const candidate = state.scars[index];
        const current = state.scars[mildest];
        if (candidate && current && candidate.severity < current.severity) mildest = index;
      }
      state.scars.splice(mildest, 1);
    }
  }

  const message = destroyed
    ? `${component.displayName} destroyed.` +
      (component.disables.length > 0 ? ` ${describeLoss(component)}` : "")
    : `${component.displayName} taking ${Math.round(removed)} damage, now ${describeState(nextState)}.`;

  return {
    componentId,
    applied: removed,
    state: nextState,
    previousState,
    destroyed,
    disabled: destroyed ? component.disables : [],
    scar,
    message,
  };
}

/**
 * Records a mark without touching health.
 *
 * The arena has already taken the damage off, because a machine and a creature
 * go through the same resolver. What is left is the mark that blow left behind,
 * and this is what records it, with the same ceiling as everything else.
 */
export function recordScar(
  state: JaegerDamageState,
  componentId: string,
  severity: number,
  kind: DamageKind,
  seed: number,
): Scar | null {
  if (severity < SCAR_SEVERITY) return null;
  if (!state.components.some((entry) => entry.componentId === componentId)) return null;
  const scar: Scar = { componentId, severity: Math.min(1, severity), kind, seed: seed >>> 0 };
  state.scars.push(scar);
  while (state.scars.length > MAX_SCARS) {
    let mildest = 0;
    for (let index = 1; index < state.scars.length; index += 1) {
      const candidate = state.scars[index];
      const current = state.scars[mildest];
      if (candidate && current && candidate.severity < current.severity) mildest = index;
    }
    state.scars.splice(mildest, 1);
  }
  return scar;
}

function describeState(state: ComponentState): string {
  switch (state) {
    case "intact":
      return "still sound";
    case "scarred":
      return "scarred";
    case "damaged":
      return "damaged";
    case "critical":
      return "barely holding";
    case "destroyed":
      return "gone";
  }
}

function describeLoss(component: ComponentDefinition): string {
  const systems = component.disables.join(", ");
  return `Offline: ${systems}.`;
}

/** Every system currently offline, derived rather than stored. */
export function disabledSystems(
  state: JaegerDamageState,
  registry: ContentRegistry<ComponentDefinition>,
): readonly JaegerSystem[] {
  const offline = new Set<JaegerSystem>();
  for (const entry of state.components) {
    if (componentState(entry) !== "destroyed") continue;
    const component = registry.get(entry.componentId);
    for (const system of component?.disables ?? []) offline.add(system);
  }
  return [...offline];
}

/** Weapon mounts still attached to the machine. */
export function liveMounts(
  state: JaegerDamageState,
  registry: ContentRegistry<ComponentDefinition>,
): readonly WeaponMount[] {
  const mounts: WeaponMount[] = [];
  for (const entry of state.components) {
    if (componentState(entry) === "destroyed") continue;
    const component = registry.get(entry.componentId);
    for (const mount of component?.mounts ?? []) mounts.push(mount);
  }
  return mounts;
}

/** True when the machine can no longer fight: a critical component is gone. */
export function isDisabled(
  state: JaegerDamageState,
  registry: ContentRegistry<ComponentDefinition>,
): boolean {
  return state.components.some(
    (entry) => componentState(entry) === "destroyed" && registry.get(entry.componentId)?.critical === true,
  );
}

/**
 * What the machine can still do, as multipliers.
 *
 * Legs change how it moves, arms change what it can swing, and the rest is the
 * caller's business. Everything is derived from component health, so nothing
 * here has to be kept in step by hand.
 */
export interface MobilityPenalty {
  readonly speedScale: number;
  readonly turnScale: number;
  readonly meleeScale: number;
  /** Plain language for the panel: what a pilot would actually be told. */
  readonly summary: string;
}

export function mobilityPenalty(
  state: JaegerDamageState,
  registry: ContentRegistry<ComponentDefinition>,
): MobilityPenalty {
  let speed = 1;
  let turn = 1;
  let melee = 1;
  const notes: string[] = [];

  for (const entry of state.components) {
    const component = registry.get(entry.componentId);
    if (!component) continue;
    const fraction = componentFraction(entry);
    const wear = 1 - fraction;
    if (component.disables.includes("movement")) {
      // A leg at half is a limp, a leg that is gone is a tow home.
      speed *= fraction <= 0 ? 0.25 : 1 - wear * 0.45;
      turn *= fraction <= 0 ? 0.4 : 1 - wear * 0.3;
      if (fraction <= 0) notes.push(`${component.displayName} gone, walking on one leg`);
      else if (fraction < 0.5) notes.push(`${component.displayName} damaged, slowed`);
    }
    if (component.mounts.some((mount) => mount.startsWith("arm."))) {
      melee *= fraction <= 0 ? 0.5 : 1 - wear * 0.4;
      if (fraction <= 0) notes.push(`${component.displayName} gone, no swing on that side`);
    }
    if (component.disables.includes("targeting") && fraction <= 0) {
      notes.push(`${component.displayName} gone, aiming by eye`);
    }
  }

  return {
    speedScale: Math.max(0.15, speed),
    turnScale: Math.max(0.2, turn),
    meleeScale: Math.max(0.3, melee),
    summary: notes.length > 0 ? notes.join(" · ") : "all systems answering",
  };
}

/** What it takes to put a machine back together. */
export interface RepairLine {
  readonly componentId: string;
  readonly displayName: string;
  readonly missing: number;
  readonly state: ComponentState;
  readonly hours: number;
  readonly cost: number;
  /** True when the part is past repair and has to be replaced outright. */
  readonly replace: boolean;
}

export interface RepairOrder {
  readonly jaegerId: string;
  readonly lines: readonly RepairLine[];
  readonly totalHours: number;
  readonly totalCost: number;
  /** Scars a full repair would remove. Cosmetic ones are left unless asked. */
  readonly scarsCleared: number;
  readonly summary: string;
}

/** A replacement costs half again over patching what is left. */
const REPLACEMENT_SURCHARGE = 1.5;

export function repairOrder(
  state: JaegerDamageState,
  registry: ContentRegistry<ComponentDefinition>,
): RepairOrder {
  const lines: RepairLine[] = [];
  for (const entry of state.components) {
    const component = registry.get(entry.componentId);
    if (!component) continue;
    const missing = entry.maxHealth - entry.health;
    // Rounding must never leave a job open forever: half a point is done.
    if (missing <= 0.5) continue;
    const replace = componentState(entry) === "destroyed";
    const surcharge = replace ? REPLACEMENT_SURCHARGE : 1;
    lines.push({
      componentId: entry.componentId,
      displayName: component.displayName,
      missing: Math.round(missing),
      state: componentState(entry),
      hours: Math.round(missing * component.repairHoursPerPoint * surcharge * 10) / 10,
      cost: Math.round(missing * component.repairCostPerPoint * surcharge),
      replace,
    });
  }

  // Worst first, because that is the order a crew works in and the order that
  // makes a partial repair readable: the legs come back before the paint.
  lines.sort((a, b) => b.missing - a.missing);
  const totalHours = Math.round(lines.reduce((total, line) => total + line.hours, 0) * 10) / 10;
  const totalCost = lines.reduce((total, line) => total + line.cost, 0);
  const summary =
    lines.length === 0
      ? "Nothing to do. The machine came back the way it went out."
      : `${lines.length} ${lines.length === 1 ? "component" : "components"}, ${totalHours} hours, ${totalCost.toLocaleString("en-GB")} in parts.`;

  return {
    jaegerId: state.jaegerId,
    lines,
    totalHours,
    totalCost,
    scarsCleared: state.scars.length,
    summary,
  };
}

/**
 * Puts work into one component.
 *
 * Repair is progressive rather than instant: hours go in, structure comes back,
 * and a component that comes back above its scar threshold loses the marks that
 * belong to it.
 */
export function repairComponent(
  state: JaegerDamageState,
  registry: ContentRegistry<ComponentDefinition>,
  componentId: string,
  hours: number,
): { readonly restored: number; readonly finished: boolean; readonly message: string } {
  const component = registry.get(componentId);
  const entry = state.components.find((record) => record.componentId === componentId);
  if (!component || !entry) {
    return { restored: 0, finished: false, message: `No component called ${componentId} on this machine.` };
  }
  const missing = entry.maxHealth - entry.health;
  if (missing <= 0.5) {
    entry.health = entry.maxHealth;
    return { restored: 0, finished: true, message: `${component.displayName} needs nothing.` };
  }
  const surcharge = componentState(entry) === "destroyed" ? REPLACEMENT_SURCHARGE : 1;
  const perHour = 1 / (component.repairHoursPerPoint * surcharge);
  const restored = Math.min(missing, Math.max(0, hours) * perHour);
  entry.health += restored;
  entry.shock = 0;
  state.lostStructure = Math.max(0, state.lostStructure - restored);

  const finished = entry.health >= entry.maxHealth - 0.5;
  if (finished) {
    entry.health = entry.maxHealth;
    // Marks come off with the plate they were on.
    for (let index = state.scars.length - 1; index >= 0; index -= 1) {
      if (state.scars[index]?.componentId === componentId) state.scars.splice(index, 1);
    }
  }

  return {
    restored,
    finished,
    message: finished
      ? `${component.displayName} rebuilt and signed off.`
      : `${component.displayName} at ${Math.round(componentFraction(entry) * 100)} percent.`,
  };
}

/** The whole machine as one number, for a list that has to sort them. */
export function structuralIntegrity(state: JaegerDamageState): number {
  const total = state.components.reduce((sum, entry) => sum + entry.maxHealth, 0);
  const left = state.components.reduce((sum, entry) => sum + entry.health, 0);
  return total <= 0 ? 0 : left / total;
}

/** The compact form that goes into a save. Fractions, not absolute health. */
export interface DamageSnapshot {
  readonly jaegerId: string;
  readonly components: readonly { readonly id: string; readonly fraction: number }[];
  readonly scars: readonly Scar[];
}

export function serializeDamage(state: JaegerDamageState): DamageSnapshot {
  return {
    jaegerId: state.jaegerId,
    components: state.components.map((entry) => ({
      id: entry.componentId,
      // Three decimals is finer than anything the game reads back.
      fraction: Math.round(componentFraction(entry) * 1000) / 1000,
    })),
    scars: state.scars.map((scar) => ({ ...scar })),
  };
}

/**
 * Rebuilds damage from a save.
 *
 * Maximum health comes from the machine's own definition rather than the file,
 * so rebalancing a chassis does not leave old saves carrying the old numbers. A
 * component the build no longer has is dropped, and one the file never mentioned
 * comes back intact.
 */
export function restoreDamage(
  snapshot: DamageSnapshot,
  jaeger: JaegerDefinition,
  registry: ContentRegistry<ComponentDefinition>,
): JaegerDamageState {
  const state = createDamageState(jaeger, registry);
  for (const record of snapshot.components) {
    const entry = state.components.find((candidate) => candidate.componentId === record.id);
    if (!entry) continue;
    const fraction = Math.min(1, Math.max(0, record.fraction));
    entry.health = entry.maxHealth * fraction;
  }
  for (const scar of snapshot.scars) {
    if (!registry.get(scar.componentId)) continue;
    state.scars.push({ ...scar });
  }
  while (state.scars.length > MAX_SCARS) state.scars.pop();
  state.lostStructure = state.components.reduce(
    (total, entry) => total + (entry.maxHealth - entry.health),
    0,
  );
  return state;
}

export function validateDamageSnapshot(snapshot: unknown): string[] {
  const errors: string[] = [];
  if (typeof snapshot !== "object" || snapshot === null) return ["damage snapshot must be an object"];
  const record = snapshot as Record<string, unknown>;
  if (typeof record["jaegerId"] !== "string" || record["jaegerId"] === "") {
    errors.push("jaegerId must name a machine");
  }
  if (!Array.isArray(record["components"])) errors.push("components must be an array");
  else {
    for (const entry of record["components"] as unknown[]) {
      const line = entry as Record<string, unknown>;
      if (typeof line["id"] !== "string") errors.push("every component record needs an id");
      const fraction = line["fraction"];
      if (typeof fraction !== "number" || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
        errors.push(`component ${String(line["id"])} fraction must be between zero and one`);
      }
    }
  }
  if (!Array.isArray(record["scars"])) errors.push("scars must be an array");
  return errors;
}
