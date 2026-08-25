import { createComponentRegistry, type ComponentDefinition } from "../data/components";
import { jaegerRegistry, type AcquisitionPath } from "../data/jaegers";
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

/** One entry in a machine's service history. Short, and kept forever. */
export interface ServiceEntry {
  /** Day this happened, so a history reads as a timeline. */
  readonly day: number;
  readonly event: string;
}

export interface MachineRecord {
  /**
   * The machine itself. Stable for the life of the save, and what everything
   * else refers to: two machines built from the same chassis are two records.
   */
  readonly jaegerId: string;
  /** Which chassis it was built from. */
  readonly chassisId: string;
  /** Yard serial. Assigned once and never reused. */
  readonly serial: string;
  /** What the crew call it. Renameable; the serial is not. */
  name: string;
  /** How it came to be owned. */
  readonly acquiredBy: AcquisitionPath;
  status: MachineStatus;
  damage: JaegerDamageState;
  /** Hours of recovery or work still owed before the machine is ready. */
  hoursRemaining: number;
  /** How many sorties it has come home from, for the memorial archive later. */
  sorties: number;
  /** Progression. The mechanics of these arrive with their own milestone. */
  level: number;
  experience: number;
  prestige: number;
  /** Weapons currently fitted, by id. */
  loadout: string[];
  /** Everything that has happened to it, oldest first. */
  history: ServiceEntry[];
}

export interface RosterSnapshot {
  readonly machines: readonly {
    readonly jaegerId: string;
    readonly chassisId: string;
    readonly serial: string;
    readonly name: string;
    readonly acquiredBy: AcquisitionPath;
    readonly status: MachineStatus;
    readonly hoursRemaining: number;
    readonly sorties: number;
    readonly level: number;
    readonly experience: number;
    readonly prestige: number;
    readonly loadout: readonly string[];
    readonly history: readonly ServiceEntry[];
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
    // The machines a campaign starts with. Each is an owned instance whose id
    // happens to match its chassis, because there is exactly one of each at the
    // start; anything bought later gets its own id and serial.
    for (const jaeger of machines.all()) {
      if (!jaeger.acquisition.includes("purchase") && !jaeger.acquisition.includes("milestone-unlock")) {
        continue;
      }
      this.records.set(jaeger.id, {
        jaegerId: jaeger.id,
        chassisId: jaeger.id,
        serial: `${jaeger.id.toUpperCase()}-0001`,
        name: jaeger.name,
        acquiredBy: "milestone-unlock",
        status: "ready",
        damage: createDamageState(jaeger, components),
        hoursRemaining: 0,
        sorties: 0,
        level: 1,
        experience: 0,
        prestige: 0,
        loadout: [...jaeger.signatureEquipment],
        history: [{ day: 0, event: "Assigned to the complex." }],
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
    const record = this.records.get(jaegerId);
    return this.machines.getOrThrow(record?.chassisId ?? jaegerId);
  }

  /**
   * Takes ownership of a new machine.
   *
   * One call, one instance. The serial is derived from how many of that chassis
   * have ever been owned, so two machines from the same yard are told apart by
   * something a person would actually read out.
   */
  acquire(options: {
    readonly chassisId: string;
    readonly acquiredBy: AcquisitionPath;
    readonly day?: number;
    /** 0 to 1 of structure it arrives missing. Refurbished hulls are not new. */
    readonly wear?: number;
    readonly name?: string;
  }): MachineRecord | null {
    const definition = this.machines.get(options.chassisId);
    if (!definition) return null;

    const built = [...this.records.values()].filter(
      (record) => record.chassisId === options.chassisId,
    ).length;
    const jaegerId = `${options.chassisId}#${built + 1}`;
    const damage = createDamageState(definition, this.components);
    const wear = Math.max(0, Math.min(0.9, options.wear ?? 0));
    if (wear > 0) {
      // Arrives with history rather than arriving perfect.
      for (const component of damage.components) component.health = component.maxHealth * (1 - wear);
      damage.lostStructure = damage.components.reduce(
        (total, component) => total + (component.maxHealth - component.health),
        0,
      );
    }

    const record: MachineRecord = {
      jaegerId,
      chassisId: options.chassisId,
      serial: `${options.chassisId.toUpperCase()}-${String(built + 1).padStart(4, "0")}`,
      name: options.name ?? definition.name,
      acquiredBy: options.acquiredBy,
      status: wear > 0 ? "repairing" : "ready",
      damage,
      hoursRemaining: 0,
      sorties: 0,
      level: 1,
      experience: 0,
      prestige: 0,
      loadout: [...definition.signatureEquipment],
      history: [
        {
          day: options.day ?? 0,
          event: `Acquired by ${options.acquiredBy.replace("-", " ")}${wear > 0 ? `, ${Math.round(wear * 100)} percent worn on delivery` : ""}.`,
        },
      ],
    };
    this.records.set(jaegerId, record);
    return record;
  }

  /** Adds a line to a machine's history. Bounded, oldest trimmed first. */
  record(jaegerId: string, day: number, event: string): void {
    const record = this.records.get(jaegerId);
    if (!record) return;
    record.history.push({ day, event });
    while (record.history.length > 40) record.history.shift();
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
        chassisId: record.chassisId,
        serial: record.serial,
        name: record.name,
        acquiredBy: record.acquiredBy,
        status: record.status,
        hoursRemaining: Math.round(record.hoursRemaining * 10) / 10,
        sorties: record.sorties,
        level: record.level,
        experience: record.experience,
        prestige: record.prestige,
        loadout: [...record.loadout],
        history: record.history.map((entry) => ({ ...entry })),
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
      const chassisId = entry.chassisId ?? entry.jaegerId;
      const definition = this.machines.get(chassisId);
      // A chassis this build no longer has is dropped rather than resurrected.
      if (!definition) continue;
      // A machine bought in a previous session is recreated rather than skipped:
      // ownership is what the save is for.
      let record = this.records.get(entry.jaegerId);
      if (!record) {
        record = {
          jaegerId: entry.jaegerId,
          chassisId,
          serial: entry.serial ?? `${chassisId.toUpperCase()}-0001`,
          name: entry.name ?? definition.name,
          acquiredBy: entry.acquiredBy ?? "purchase",
          status: "ready",
          damage: createDamageState(definition, this.components),
          hoursRemaining: 0,
          sorties: 0,
          level: 1,
          experience: 0,
          prestige: 0,
          loadout: [...definition.signatureEquipment],
          history: [],
        };
        this.records.set(entry.jaegerId, record);
      }
      record.name = entry.name ?? record.name;
      record.level = Math.max(1, Math.round(entry.level ?? 1));
      record.experience = Math.max(0, entry.experience ?? 0);
      record.prestige = Math.max(0, Math.round(entry.prestige ?? 0));
      record.loadout = [...(entry.loadout ?? record.loadout)];
      record.history = (entry.history ?? []).map((line) => ({ ...line }));
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
