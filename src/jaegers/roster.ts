import { createComponentRegistry, type ComponentDefinition } from "../data/components";
import { jaegerRegistry, type AcquisitionPath } from "../data/jaegers";
import type { ContentRegistry } from "../data/registry";
import {
  createPassiveRegistry,
  passiveBonus,
  type PassiveDefinition,
  type PassiveTier,
} from "../data/passives";
import { canFit, createModuleRegistry, moduleBonus, type ModuleDefinition } from "../data/modules";
import {
  createMasteryRegistry,
  emptyMasteryCounters,
  masteryRank,
  type MasteryCounters,
  type MasteryDefinition,
} from "../data/masteries";
import {
  LEVEL_CAP,
  MODULE_SLOT_LEVELS,
  growthFor,
  levelFromExperience,
  totalExperienceTo,
  forecastPrestige,
  movesUnlockedAt,
  passiveChoicesAt,
  veterancyGrant,
  type MachineGrowth,
  type PrestigeForecast,
} from "./progression";
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

/**
 * Why a module will not go on, in the words that are actually useful.
 *
 * A machine with no slots at all is not full, it is too junior, and saying
 * "zero of zero" tells a player nothing about what to do next.
 */
function noSlotsYet(slots: number, fitted: number): string {
  if (slots === 0) return `No module slots yet. The first opens at level ${MODULE_SLOT_LEVELS[0]}.`;
  return `Every slot is full: ${fitted} of ${slots}.`;
}

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
  /**
   * Progression.
   *
   * `experience` is the one running total everything is awarded into, and
   * `level` is derived from it rather than stored beside it, so the two can
   * never disagree. `prestige` is the rank the machine has climbed to, and it
   * has no ceiling.
   */
  level: number;
  experience: number;
  prestige: number;
  /** Passives chosen, one per tier reached. Reset by a prestige, re-chosen after. */
  passives: string[];
  /** Modules currently fitted. Kept through a prestige, but not necessarily fittable after one. */
  modules: string[];
  /** Modules owned and not currently fitted. Prestige moves them here rather than deleting them. */
  storedModules: string[];
  /** Long running goals, counted once per sortie. */
  mastery: MasteryCounters;
  /** Mastery ranks already paid out, so a threshold cannot pay twice. */
  masteryPaid: Record<string, number>;
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
    readonly passives: readonly string[];
    readonly modules: readonly string[];
    readonly storedModules: readonly string[];
    readonly mastery: MasteryCounters;
    readonly masteryPaid: Readonly<Record<string, number>>;
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
  private readonly passives: ContentRegistry<PassiveDefinition>;
  private readonly modules: ContentRegistry<ModuleDefinition>;
  private readonly masteries: ContentRegistry<MasteryDefinition>;

  constructor(
    machines: ContentRegistry<JaegerDefinition> = jaegerRegistry,
    components: ContentRegistry<ComponentDefinition> = createComponentRegistry(),
    progression?: {
      readonly passives?: ContentRegistry<PassiveDefinition>;
      readonly modules?: ContentRegistry<ModuleDefinition>;
      readonly masteries?: ContentRegistry<MasteryDefinition>;
    },
  ) {
    this.machines = machines;
    this.components = components;
    this.passives = progression?.passives ?? createPassiveRegistry();
    this.modules = progression?.modules ?? createModuleRegistry();
    this.masteries = progression?.masteries ?? createMasteryRegistry();
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
        passives: [],
        modules: [],
        storedModules: [],
        mastery: emptyMasteryCounters(),
        masteryPaid: {},
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

    // Catch-up. A machine joining a fleet whose best has climbed a long way
    // arrives with veteran crew and salvaged parts, or buying anything at all
    // late in a campaign would hand over something unusable.
    const best = this.bestPrestige();
    const grant = veterancyGrant(best);

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
      level: grant.level,
      experience: totalExperienceTo(grant.level, grant.prestige),
      prestige: grant.prestige,
      passives: [],
      modules: [],
      storedModules: [],
      mastery: emptyMasteryCounters(),
      masteryPaid: {},
      loadout: [...definition.signatureEquipment],
      history: [
        {
          day: options.day ?? 0,
          event: `Acquired by ${options.acquiredBy.replace("-", " ")}${wear > 0 ? `, ${Math.round(wear * 100)} percent worn on delivery` : ""}.`,
        },
        ...(grant.note ? [{ day: options.day ?? 0, event: grant.note }] : []),
      ],
    };
    this.records.set(jaegerId, record);
    return record;
  }

  /** The highest prestige rank anything in the fleet has reached. */
  bestPrestige(): number {
    let best = 0;
    for (const record of this.records.values()) best = Math.max(best, record.prestige);
    return best;
  }

  /**
   * Everything a machine's level, rank, passives and modules are worth.
   *
   * One object, produced in one place, handed to the three points where a
   * machine's numbers are already derived. Nothing else computes growth.
   */
  growthOf(jaegerId: string): MachineGrowth {
    const record = this.records.get(jaegerId);
    if (!record) return growthFor({ level: 1, prestige: 0 });
    return growthFor({
      level: record.level,
      prestige: record.prestige,
      passiveBonus: passiveBonus(this.passives, record.passives),
      moduleBonus: moduleBonus(this.modules, record.modules),
    });
  }

  /** Moves this machine is allowed to throw, given how far it has come. */
  movesFor(jaegerId: string): readonly string[] {
    const record = this.records.get(jaegerId);
    return movesUnlockedAt(record?.level ?? 1);
  }

  /**
   * Pays experience into a machine.
   *
   * The only way experience enters the roster. Level is recomputed from the
   * running total rather than incremented, so an award can never leave a
   * machine at a level its experience does not support.
   */
  award(
    jaegerId: string,
    experience: number,
    day = 0,
  ): { readonly levelsGained: number; readonly level: number; readonly messages: readonly string[] } {
    const record = this.records.get(jaegerId);
    if (!record || !Number.isFinite(experience) || experience <= 0) {
      return { levelsGained: 0, level: record?.level ?? 1, messages: [] };
    }
    const before = record.level;
    record.experience += Math.round(experience);
    const state = levelFromExperience(record.experience, record.prestige);
    record.level = state.level;

    const messages: string[] = [];
    for (let level = before + 1; level <= record.level; level += 1) {
      const gained = movesUnlockedAt(level).filter((id) => !movesUnlockedAt(level - 1).includes(id));
      const line =
        `Reached level ${level}` +
        (gained.length > 0 ? `, and can now throw ${gained.join(", ")}` : "") +
        (passiveChoicesAt(level) > passiveChoicesAt(level - 1) ? ", with a passive to choose" : "") +
        ".";
      messages.push(line);
      this.record(jaegerId, day, line);
    }
    if (record.level >= LEVEL_CAP && before < LEVEL_CAP) {
      const line = "At the level cap. It can prestige whenever the crew are ready.";
      messages.push(line);
      this.record(jaegerId, day, line);
    }
    return { levelsGained: record.level - before, level: record.level, messages };
  }

  /**
   * Records one sortie against a machine's long running goals.
   *
   * Counters move here and nowhere else, and a mastery threshold pays exactly
   * once because the rank already paid is remembered per goal.
   */
  completeSortie(
    jaegerId: string,
    outcome: {
      readonly won: boolean;
      readonly structureLost: number;
      readonly componentLost: boolean;
      readonly rescuedThousands: number;
      readonly salvageTons: number;
    },
    day = 0,
  ): { readonly experience: number; readonly messages: readonly string[] } {
    const record = this.records.get(jaegerId);
    if (!record) return { experience: 0, messages: [] };

    record.mastery.sorties += 1;
    if (outcome.won) record.mastery.victories += 1;
    if (!outcome.componentLost) record.mastery.intact += 1;
    record.mastery.rescuedThousands += Math.max(0, outcome.rescuedThousands);
    record.mastery.salvageTons += Math.max(0, outcome.salvageTons);
    record.mastery.damageTaken += Math.max(0, outcome.structureLost);

    let experience = 0;
    const messages: string[] = [];
    for (const goal of this.masteries.all()) {
      const rank = masteryRank(goal, record.mastery);
      const paid = record.masteryPaid[goal.id] ?? 0;
      if (rank <= paid) continue;
      const due = rank - paid;
      record.masteryPaid[goal.id] = rank;
      experience += goal.experiencePerRank * due;
      const line = `${goal.displayName} reached rank ${rank}.`;
      messages.push(line);
      this.record(jaegerId, day, line);
    }
    if (experience > 0) this.award(jaegerId, experience, day);
    return { experience, messages };
  }

  /** What a machine may choose from at the tier it has just opened, or an empty list. */
  passiveChoices(jaegerId: string): {
    readonly tier: PassiveTier | null;
    readonly options: readonly PassiveDefinition[];
  } {
    const record = this.records.get(jaegerId);
    if (!record) return { tier: null, options: [] };
    const earned = passiveChoicesAt(record.level);
    if (record.passives.length >= earned) return { tier: null, options: [] };
    const tier = (record.passives.length + 1) as PassiveTier;
    return { tier, options: this.passives.all().filter((entry) => entry.tier === tier) };
  }

  /** Takes a passive. One per tier, and only a tier that has been opened. */
  choosePassive(
    jaegerId: string,
    passiveId: string,
    day = 0,
  ): { readonly ok: boolean; readonly message: string } {
    const record = this.records.get(jaegerId);
    if (!record) return { ok: false, message: "No such machine." };
    const choice = this.passiveChoices(jaegerId);
    if (choice.tier === null) {
      return { ok: false, message: `Nothing to choose. Level ${record.level} has opened no new tier.` };
    }
    const entry = this.passives.get(passiveId);
    if (!entry) return { ok: false, message: `No passive called "${passiveId}".` };
    if (entry.tier !== choice.tier) {
      return {
        ok: false,
        message: `${entry.displayName} is tier ${entry.tier}, and tier ${choice.tier} is the one open.`,
      };
    }
    record.passives.push(entry.id);
    this.record(jaegerId, day, `Chose ${entry.displayName}. ${entry.tradeoff}`);
    return { ok: true, message: `${entry.displayName} fitted. ${entry.tradeoff}` };
  }

  /**
   * Undoes every passive choice.
   *
   * Deliberately all or nothing rather than one at a time: a respec is a rebuild
   * of what the machine is, and picking one line out of it would let a player
   * re-optimise for every fight instead of committing to a machine.
   */
  respecPassives(
    jaegerId: string,
    day = 0,
  ): { readonly ok: boolean; readonly message: string; readonly hours: number } {
    const record = this.records.get(jaegerId);
    if (!record) return { ok: false, message: "No such machine.", hours: 0 };
    if (record.passives.length === 0) {
      return { ok: false, message: "Nothing has been chosen yet.", hours: 0 };
    }
    if (record.status !== "ready") {
      return {
        ok: false,
        message: `It is ${describeStatus(record.status)}, and this is bay work.`,
        hours: 0,
      };
    }
    const hours = 12 * record.passives.length;
    record.passives = [];
    record.status = "repairing";
    record.hoursRemaining += hours;
    this.record(jaegerId, day, `Stripped back for a rebuild: every passive re-chosen. ${hours} hours.`);
    return { ok: true, message: `Stripped back. ${hours} hours in the bay, then choose again.`, hours };
  }

  /** Modules this machine could fit, with the reason when it cannot. */
  moduleOptions(jaegerId: string): readonly {
    readonly module: ModuleDefinition;
    readonly fitted: boolean;
    readonly stored: boolean;
    readonly refusal: string | null;
  }[] {
    const record = this.records.get(jaegerId);
    if (!record) return [];
    const growth = this.growthOf(jaegerId);
    return this.modules.all().map((module) => {
      const fitted = record.modules.includes(module.id);
      const allowed = canFit(module, record.level, record.prestige);
      const full = !fitted && record.modules.length >= growth.moduleSlots;
      return {
        module,
        fitted,
        stored: record.storedModules.includes(module.id),
        refusal: fitted
          ? null
          : !allowed.ok
            ? allowed.message
            : full
              ? noSlotsYet(growth.moduleSlots, record.modules.length)
              : null,
      };
    });
  }

  /** Fits a module. Costs bay hours, and refuses in words rather than silently. */
  fitModule(
    jaegerId: string,
    moduleId: string,
    day = 0,
  ): { readonly ok: boolean; readonly message: string; readonly cost: number } {
    const record = this.records.get(jaegerId);
    if (!record) return { ok: false, message: "No such machine.", cost: 0 };
    const module = this.modules.get(moduleId);
    if (!module) return { ok: false, message: `No module called "${moduleId}".`, cost: 0 };
    if (record.modules.includes(moduleId)) {
      return { ok: false, message: `${module.displayName} is already fitted.`, cost: 0 };
    }
    if (record.status !== "ready") {
      return {
        ok: false,
        message: `It is ${describeStatus(record.status)}, and this is bay work.`,
        cost: 0,
      };
    }
    const allowed = canFit(module, record.level, record.prestige);
    if (!allowed.ok) return { ok: false, message: allowed.message, cost: 0 };
    const slots = this.growthOf(jaegerId).moduleSlots;
    if (record.modules.length >= slots) {
      return { ok: false, message: noSlotsYet(slots, record.modules.length), cost: 0 };
    }

    record.modules.push(moduleId);
    record.storedModules = record.storedModules.filter((id) => id !== moduleId);
    record.status = "repairing";
    record.hoursRemaining += module.fittingHours;
    this.record(jaegerId, day, `Fitted ${module.displayName}.`);
    return {
      ok: true,
      message: `${module.displayName} fitted. ${module.fittingHours} hours in the bay.`,
      cost: module.cost,
    };
  }

  /** Takes a module out. It goes to stores rather than being thrown away. */
  removeModule(
    jaegerId: string,
    moduleId: string,
    day = 0,
  ): { readonly ok: boolean; readonly message: string } {
    const record = this.records.get(jaegerId);
    if (!record) return { ok: false, message: "No such machine." };
    if (!record.modules.includes(moduleId)) return { ok: false, message: "That is not fitted." };
    const module = this.modules.get(moduleId);
    record.modules = record.modules.filter((id) => id !== moduleId);
    if (!record.storedModules.includes(moduleId)) record.storedModules.push(moduleId);
    record.status = "repairing";
    record.hoursRemaining += (module?.fittingHours ?? 4) / 2;
    this.record(jaegerId, day, `Removed ${module?.displayName ?? moduleId}. It is in stores.`);
    return { ok: true, message: `${module?.displayName ?? moduleId} is in stores.` };
  }

  /** What prestiging would do, computed by the same code that does it. */
  prestigeForecast(jaegerId: string): PrestigeForecast {
    const record = this.records.get(jaegerId);
    if (!record) return forecastPrestige({ level: 1, prestige: 0 });
    return forecastPrestige({
      level: record.level,
      prestige: record.prestige,
      passiveBonus: passiveBonus(this.passives, record.passives),
      moduleBonus: moduleBonus(this.modules, record.modules),
    });
  }

  /**
   * Prestiges a machine.
   *
   * Level goes back to one, experience with it, and passives are given up and
   * re-chosen on the way back up. Modules are not destroyed: anything the
   * machine can no longer carry goes to stores, so nothing a player paid for is
   * taken away. Scars, service history and mastery counters are kept, because
   * they are the record of the machine rather than its strength.
   */
  prestige(
    jaegerId: string,
    day = 0,
  ): { readonly ok: boolean; readonly message: string; readonly rank: number } {
    const record = this.records.get(jaegerId);
    if (!record) return { ok: false, message: "No such machine.", rank: 0 };
    const forecast = this.prestigeForecast(jaegerId);
    if (!forecast.eligible) return { ok: false, message: forecast.refusal, rank: record.prestige };
    if (record.status !== "ready") {
      return {
        ok: false,
        message: `It is ${describeStatus(record.status)}, and this is bay work.`,
        rank: record.prestige,
      };
    }

    record.prestige += 1;
    record.level = 1;
    record.experience = 0;
    record.passives = [];

    // Anything the reset made unfittable is stored rather than lost.
    const keep: string[] = [];
    for (const moduleId of record.modules) {
      const module = this.modules.get(moduleId);
      if (module && canFit(module, record.level, record.prestige).ok) keep.push(moduleId);
      else if (!record.storedModules.includes(moduleId)) record.storedModules.push(moduleId);
    }
    record.modules = keep;

    const line =
      `Prestige ${record.prestige}. Stripped to level 1, keeping ${keep.length} module` +
      `${keep.length === 1 ? "" : "s"} fitted and ${record.storedModules.length} in stores.`;
    this.record(jaegerId, day, line);
    return { ok: true, message: line, rank: record.prestige };
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
        passives: [...record.passives],
        modules: [...record.modules],
        storedModules: [...record.storedModules],
        mastery: { ...record.mastery },
        masteryPaid: { ...record.masteryPaid },
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
          passives: [],
          modules: [],
          storedModules: [],
          mastery: emptyMasteryCounters(),
          masteryPaid: {},
          loadout: [...definition.signatureEquipment],
          history: [],
        };
        this.records.set(entry.jaegerId, record);
      }
      record.name = entry.name ?? record.name;
      record.level = Math.max(1, Math.round(entry.level ?? 1));
      record.experience = Math.max(0, entry.experience ?? 0);
      record.prestige = Math.max(0, Math.round(entry.prestige ?? 0));
      // Progression comes back through the same validation the live path uses: a
      // passive or module this build has dropped is forgotten rather than
      // resurrected, and a level is recomputed from the experience that earned
      // it rather than trusted from the file.
      record.passives = (entry.passives ?? []).filter((id) => this.passives.has(id));
      record.modules = (entry.modules ?? []).filter((id) => this.modules.has(id));
      record.storedModules = (entry.storedModules ?? []).filter((id) => this.modules.has(id));
      record.mastery = { ...emptyMasteryCounters(), ...(entry.mastery ?? {}) };
      record.masteryPaid = {};
      for (const [goalId, rank] of Object.entries(entry.masteryPaid ?? {})) {
        if (this.masteries.has(goalId) && Number.isFinite(rank)) {
          record.masteryPaid[goalId] = Math.max(0, Math.round(rank));
        }
      }
      record.level = levelFromExperience(record.experience, record.prestige).level;
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
    // Progression is optional on the way in, because a save written before it
    // existed is still a valid save. What is present has to be the right shape:
    // restore filters unknown ids, but it cannot filter a string that should
    // have been a list.
    for (const field of ["passives", "modules", "storedModules"] as const) {
      const value = line[field];
      if (value !== undefined && !Array.isArray(value)) {
        errors.push(`${String(line["jaegerId"])} ${field} must be a list of ids`);
      }
    }
    for (const field of ["level", "experience", "prestige"] as const) {
      const value = line[field];
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
        errors.push(`${String(line["jaegerId"])} ${field} must be a finite number that is not negative`);
      }
    }
    const mastery = line["mastery"];
    if (mastery !== undefined && (typeof mastery !== "object" || mastery === null)) {
      errors.push(`${String(line["jaegerId"])} mastery must be an object of counters`);
    }
    errors.push(...validateDamageSnapshot(line["damage"]));
  }
  return errors;
}
