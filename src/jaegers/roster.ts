import { createComponentRegistry, type ComponentDefinition } from "../data/components";
import { jaegerRegistry } from "../data/jaegers";
import type { ContentRegistry } from "../data/registry";
import type { JaegerDefinition } from "../data/jaegers";
import {
  createDamageState,
  disabledSystems,
  isDisabled,
  repairOrder,
  repairComponent,
  restoreDamage,
  serializeDamage,
  structuralIntegrity,
  validateDamageSnapshot,
  type DamageSnapshot,
  type JaegerDamageState,
  type RepairOrder,
} from "./damage";

/**
 * The roster.
 *
 * One record per machine, and the record is where damage lives between fights.
 * A machine that loses is never removed from it: it comes back as a recovery
 * job, a repair job, or a rebuild, and it keeps the scars it earned either way.
 *
 * No Babylon, no DOM, no wall clock. Time arrives as hours of work done.
 */

export const MACHINE_STATUSES = ["ready", "deployed", "recovering", "repairing", "rebuilding"] as const;
export type MachineStatus = (typeof MACHINE_STATUSES)[number];

/** Below this integrity a machine is rebuilt rather than repaired. */
export const REBUILD_THRESHOLD = 0.25;
/** Hours it takes to tow a machine home before any work can start. */
export const RECOVERY_HOURS = 12;

export interface MachineRecord {
  readonly jaegerId: string;
  status: MachineStatus;
  damage: JaegerDamageState;
  /** Hours of recovery or work still owed before the machine is ready. */
  hoursRemaining: number;
  /** How many sorties it has come home from, for the memorial archive later. */
  sorties: number;
}

export interface RosterSnapshot {
  readonly machines: readonly {
    readonly jaegerId: string;
    readonly status: MachineStatus;
    readonly hoursRemaining: number;
    readonly sorties: number;
    readonly damage: DamageSnapshot;
  }[];
}

export const ROSTER_SCHEMA_VERSION = 1;

export class Roster {
  private readonly records = new Map<string, MachineRecord>();
  private readonly components: ContentRegistry<ComponentDefinition>;
  private readonly machines: ContentRegistry<JaegerDefinition>;

  constructor(
    machines: ContentRegistry<JaegerDefinition> = jaegerRegistry,
    components: ContentRegistry<ComponentDefinition> = createComponentRegistry(),
  ) {
    this.machines = machines;
    this.components = components;
    for (const jaeger of machines.all()) {
      this.records.set(jaeger.id, {
        jaegerId: jaeger.id,
        status: "ready",
        damage: createDamageState(jaeger, components),
        hoursRemaining: 0,
        sorties: 0,
      });
    }
  }

  all(): readonly MachineRecord[] {
    return [...this.records.values()];
  }

  get(jaegerId: string): MachineRecord | undefined {
    return this.records.get(jaegerId);
  }

  getOrThrow(jaegerId: string): MachineRecord {
    const record = this.records.get(jaegerId);
    if (!record) throw new Error(`No machine called "${jaegerId}" on the roster`);
    return record;
  }

  definition(jaegerId: string): JaegerDefinition {
    return this.machines.getOrThrow(jaegerId);
  }

  componentRegistry(): ContentRegistry<ComponentDefinition> {
    return this.components;
  }

  /** True when the machine is fit to take out. */
  canDeploy(jaegerId: string): { readonly ok: boolean; readonly message: string } {
    const record = this.records.get(jaegerId);
    if (!record) return { ok: false, message: `There is no machine called ${jaegerId}.` };
    if (record.status === "deployed") return { ok: true, message: "Already out." };
    if (record.status !== "ready") {
      return {
        ok: false,
        message: `${this.definition(jaegerId).name} is ${describeStatus(record.status)}, ${Math.ceil(record.hoursRemaining)} hours from ready.`,
      };
    }
    if (isDisabled(record.damage, this.components)) {
      return {
        ok: false,
        message: `${this.definition(jaegerId).name} has lost a critical component and cannot be taken out.`,
      };
    }
    return { ok: true, message: "Ready." };
  }

  deploy(jaegerId: string): void {
    const record = this.getOrThrow(jaegerId);
    record.status = "deployed";
  }

  /**
   * Brings a machine home from a sortie.
   *
   * Nothing is ever deleted. A machine that walked away comes back ready or
   * needing work; one that was disabled is towed, and one that is barely there
   * is rebuilt rather than patched. Which of those it is comes from the damage
   * itself rather than from a flag somebody has to remember to set.
   */
  recover(jaegerId: string): { readonly status: MachineStatus; readonly message: string } {
    const record = this.getOrThrow(jaegerId);
    record.sorties += 1;
    const name = this.definition(jaegerId).name;
    const integrity = structuralIntegrity(record.damage);
    const disabled = isDisabled(record.damage, this.components);
    const order = this.repairOrder(jaegerId);

    if (order.lines.length === 0) {
      record.status = "ready";
      record.hoursRemaining = 0;
      return { status: "ready", message: `${name} walked back in without a scratch.` };
    }

    // A machine that cannot walk does not walk home. Towing is for a lost
    // critical component, a lost leg, or a machine that is barely there.
    const immobile = disabledSystems(record.damage, this.components).includes("movement");
    if (disabled || immobile || integrity < REBUILD_THRESHOLD) {
      record.status = "recovering";
      record.hoursRemaining = RECOVERY_HOURS + order.totalHours;
      const reason = disabled
        ? "lost a critical component"
        : immobile
          ? "lost a leg and could not walk back"
          : "came back barely standing";
      return {
        status: "recovering",
        message: `${name} ${reason}. Towed to the bay: ${RECOVERY_HOURS} hours to recover, then ${order.totalHours} hours of work.`,
      };
    }

    record.status = "repairing";
    record.hoursRemaining = order.totalHours;
    return {
      status: "repairing",
      message: `${name} is in the gantries. ${order.summary}`,
    };
  }

  repairOrder(jaegerId: string): RepairOrder {
    return repairOrder(this.getOrThrow(jaegerId).damage, this.components);
  }

  /**
   * Puts hours of work into a machine.
   *
   * Work goes into the worst component first, which is what a crew would do and
   * what makes a partial repair readable: the machine gets its legs back before
   * its paint.
   */
  work(
    jaegerId: string,
    hours: number,
  ): { readonly finished: boolean; readonly messages: readonly string[] } {
    const record = this.getOrThrow(jaegerId);
    const messages: string[] = [];
    if (hours <= 0 || record.status === "ready" || record.status === "deployed") {
      return { finished: record.status === "ready", messages };
    }

    let left = hours;
    // Towing first: a machine in the field is not being worked on.
    if (record.status === "recovering") {
      const towing = Math.min(
        left,
        Math.max(0, record.hoursRemaining - this.repairOrder(jaegerId).totalHours),
      );
      left -= towing;
      record.hoursRemaining -= towing;
      if (towing > 0 && left <= 0) {
        return {
          finished: false,
          messages: [`${this.definition(jaegerId).name} is still on the transporter.`],
        };
      }
      record.status = structuralIntegrity(record.damage) < REBUILD_THRESHOLD ? "rebuilding" : "repairing";
      messages.push(`${this.definition(jaegerId).name} is in the bay. Work starting.`);
    }

    while (left > 0) {
      const order = this.repairOrder(jaegerId);
      const next = order.lines[0];
      if (!next) break;
      // A job whose hours round to nothing still has to be spent on, or the
      // queue stalls forever behind a one-point repair.
      const spend = Math.max(Math.min(left, next.hours), Math.min(left, 0.1));
      const result = repairComponent(record.damage, this.components, next.componentId, spend);
      left -= spend;
      record.hoursRemaining = Math.max(0, record.hoursRemaining - spend);
      if (result.finished) messages.push(result.message);
      if (spend <= 0) break;
    }

    const remaining = this.repairOrder(jaegerId);
    if (remaining.lines.length === 0) {
      record.status = "ready";
      record.hoursRemaining = 0;
      messages.push(`${this.definition(jaegerId).name} is signed off and ready.`);
      return { finished: true, messages };
    }
    record.hoursRemaining = remaining.totalHours;
    return { finished: false, messages };
  }

  snapshot(): RosterSnapshot {
    return {
      machines: this.all().map((record) => ({
        jaegerId: record.jaegerId,
        status: record.status,
        hoursRemaining: Math.round(record.hoursRemaining * 10) / 10,
        sorties: record.sorties,
        damage: serializeDamage(record.damage),
      })),
    };
  }

  /**
   * Restores from a save.
   *
   * A machine in the file that this build no longer has is dropped rather than
   * resurrected, and one this build has that the file never mentioned comes back
   * ready. Neither case throws: an old save is a thing to read, not to argue
   * with.
   */
  restore(snapshot: RosterSnapshot): void {
    for (const entry of snapshot.machines) {
      const record = this.records.get(entry.jaegerId);
      if (!record) continue;
      const definition = this.machines.get(entry.jaegerId);
      if (!definition) continue;
      record.damage = restoreDamage(entry.damage, definition, this.components);
      record.status = MACHINE_STATUSES.includes(entry.status) ? entry.status : "ready";
      // A machine cannot still be out: a sortie is not saved.
      if (record.status === "deployed") record.status = "ready";
      record.hoursRemaining = Number.isFinite(entry.hoursRemaining) ? Math.max(0, entry.hoursRemaining) : 0;
      record.sorties = Number.isFinite(entry.sorties) ? Math.max(0, Math.round(entry.sorties)) : 0;
    }
  }
}

export function describeStatus(status: MachineStatus): string {
  switch (status) {
    case "ready":
      return "ready";
    case "deployed":
      return "out on a sortie";
    case "recovering":
      return "being recovered";
    case "repairing":
      return "under repair";
    case "rebuilding":
      return "being rebuilt";
  }
}

export function emptyRosterSnapshot(
  machines: ContentRegistry<JaegerDefinition> = jaegerRegistry,
): RosterSnapshot {
  return new Roster(machines).snapshot();
}

export function validateRosterSnapshot(snapshot: unknown): string[] {
  if (typeof snapshot !== "object" || snapshot === null) return ["roster snapshot must be an object"];
  const record = snapshot as Record<string, unknown>;
  if (!Array.isArray(record["machines"])) return ["roster.machines must be an array"];
  const errors: string[] = [];
  for (const entry of record["machines"] as unknown[]) {
    const line = entry as Record<string, unknown>;
    if (typeof line["jaegerId"] !== "string") errors.push("every roster record needs a jaegerId");
    if (!MACHINE_STATUSES.includes(line["status"] as MachineStatus)) {
      errors.push(`unknown machine status "${String(line["status"])}"`);
    }
    if (typeof line["hoursRemaining"] !== "number" || !Number.isFinite(line["hoursRemaining"])) {
      errors.push(`${String(line["jaegerId"])} hoursRemaining must be a finite number`);
    }
    errors.push(...validateDamageSnapshot(line["damage"]));
  }
  return errors;
}
