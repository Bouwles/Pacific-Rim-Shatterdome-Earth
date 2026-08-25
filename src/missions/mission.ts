import { ContentRegistry } from "../data/registry";
import { assessDrift, type PilotDefinition } from "../data/pilots";
import type { JaegerDefinition } from "../data/jaegers";
import type { WeaponDefinition } from "../data/weapons";
import {
  emptyProgress,
  evaluateObjectives,
  missionSettled,
  objectiveScore,
  type MissionObjective,
  type MissionProgress,
  type ObjectiveDefinition,
  type ObjectiveId,
} from "./objectives";

/**
 * A sortie, from the moment it is planned to the moment its results are read.
 *
 * One state machine covers the whole thing: planning, the carrier run, the
 * fight, and the results. There is no second game state and no separate mission
 * mode - the active phase is the world the player was already standing in, with
 * a mission attached to it.
 *
 * Every number in the results comes from authoritative simulation events fed in
 * through `report`. Nothing is awarded here that the simulation did not do, and
 * nothing the simulation did is awarded twice.
 */

export const MISSION_PHASES = ["planning", "carrier", "active", "results", "closed"] as const;
export type MissionPhase = (typeof MISSION_PHASES)[number];

export const MISSION_OUTCOMES = ["success", "partial", "failure", "aborted", "lost-contact"] as const;
export type MissionOutcome = (typeof MISSION_OUTCOMES)[number];

/** What the player chose to take. */
export interface DeploymentPlan {
  readonly jaegerId: string;
  readonly pilotIds: readonly [string, string];
  /** Weapons carried. Anything not listed stays in the bay. */
  readonly weaponIds: readonly string[];
  /** Consumables by id and count: reloads, coolant, repair kits, probes. */
  readonly consumables: Readonly<Record<string, number>>;
  /** Allied units requested, by id. Empty is normal. */
  readonly allyIds: readonly string[];
  /** Where the carrier drops the machine, as a bearing from the region centre. */
  readonly arrivalBearingDeg: number;
  /** Objectives in priority order. The first is what the sortie is called for. */
  readonly priorities: readonly ObjectiveId[];
}

/** What the planner works out about a plan, before anybody commits to it. */
export interface ReadinessReport {
  /** 0 to 1. Everything together. */
  readonly readiness: number;
  readonly driftStrength: number;
  readonly machineIntegrity: number;
  /** In-game seconds to reach the region. */
  readonly travelSeconds: number;
  /** 0 to 1 of the logistics budget this plan uses. */
  readonly logisticsLoad: number;
  /** True when the plan is over what the carrier can lift. */
  readonly overloaded: boolean;
  /** What the region's weather will do to the fight, in words. */
  readonly weather: string;
  /** True when the fight will be in or under water. */
  readonly underwater: boolean;
  /**
   * What is expected out there, at the warning's own confidence. Deliberately
   * derived from the forecast rather than from the truth, so a hidden phase
   * stays hidden.
   */
  readonly predictedThreat: string;
  /** Refusals, in words. A plan with any of these cannot launch. */
  readonly refusals: readonly string[];
  /** Advice that is not a refusal. */
  readonly warnings: readonly string[];
}

export interface MissionResults {
  readonly outcome: MissionOutcome;
  /** 0 to 1 of the objectives met, weighted. */
  readonly objectiveScore: number;
  readonly objectives: readonly {
    readonly id: ObjectiveId;
    readonly state: string;
    readonly detail: string;
  }[];
  /** Structure the machine lost, 0 to 1. */
  readonly machineDamage: number;
  /** Hours of repair the machine now needs. */
  readonly repairHours: number;
  /** 0 to 1 of the city's integrity lost during the sortie. */
  readonly cityImpact: number;
  readonly salvageTons: number;
  readonly samples: number;
  readonly rescuedThousands: number;
  /** Reputation change, positive or negative. */
  readonly reputation: number;
  /** Change in the pilots' drift link, positive or negative. */
  readonly copilotLink: number;
  readonly experience: number;
  readonly funding: number;
  /** Enough to replay the sortie: seed, plan, and the events that mattered. */
  readonly replay: {
    readonly seed: number;
    readonly plan: DeploymentPlan;
    readonly events: readonly string[];
  };
  /** Every line of the result, with what produced it. */
  readonly ledger: readonly { readonly label: string; readonly value: number; readonly reason: string }[];
  readonly summary: string;
}

export interface MissionSnapshot {
  readonly schemaVersion: number;
  readonly id: string;
  readonly incidentId: string;
  readonly regionId: string;
  readonly phase: MissionPhase;
  readonly plan: DeploymentPlan;
  readonly objectives: readonly MissionObjective[];
  readonly carrierSeconds: number;
  readonly carrierTotalSeconds: number;
  readonly elapsedSeconds: number;
  readonly seed: number;
  readonly results: MissionResults | null;
}

export const MISSION_SCHEMA_VERSION = 1;

export interface MissionOptions {
  readonly id: string;
  readonly incidentId: string;
  readonly regionId: string;
  readonly plan: DeploymentPlan;
  readonly objectives: ContentRegistry<ObjectiveDefinition>;
  readonly seed: number;
  /** In-game seconds the carrier run takes. */
  readonly carrierSeconds: number;
  /** Objectives, with the stage each belongs to. */
  readonly assignments: readonly { readonly id: ObjectiveId; readonly stage: number }[];
}

/**
 * One sortie.
 *
 * Owns no scene objects and no timers. Seconds arrive from outside, events
 * arrive from the simulation, and everything it reports is derived from those.
 */
export class Mission {
  readonly id: string;
  readonly incidentId: string;
  readonly regionId: string;
  readonly plan: DeploymentPlan;
  readonly seed: number;

  private readonly registry: ContentRegistry<ObjectiveDefinition>;
  private readonly objectiveList: MissionObjective[];
  private phaseValue: MissionPhase = "planning";
  private carrierElapsed = 0;
  private readonly carrierTotal: number;
  private elapsed = 0;
  private progress: MissionProgress = emptyProgress();
  private resultsValue: MissionResults | null = null;
  private readonly events: string[] = [];

  constructor(options: MissionOptions) {
    this.id = options.id;
    this.incidentId = options.incidentId;
    this.regionId = options.regionId;
    this.plan = options.plan;
    this.seed = options.seed;
    this.registry = options.objectives;
    this.carrierTotal = Math.max(1, options.carrierSeconds);
    this.objectiveList = options.assignments.map((assignment) => ({
      id: assignment.id,
      stage: assignment.stage,
      state: assignment.stage === 0 ? "active" : "pending",
      progress: 0,
    }));
  }

  get phase(): MissionPhase {
    return this.phaseValue;
  }

  get objectives(): readonly MissionObjective[] {
    return this.objectiveList;
  }

  get results(): MissionResults | null {
    return this.resultsValue;
  }

  /** 0 to 1 of the carrier run completed. */
  get carrierProgress(): number {
    return Math.min(1, this.carrierElapsed / this.carrierTotal);
  }

  /** Everything the mission has recorded, for the replay. */
  get log(): readonly string[] {
    return this.events;
  }

  /** Starts the carrier run. Refused unless the plan has been committed. */
  launch(): { readonly ok: boolean; readonly message: string } {
    if (this.phaseValue !== "planning") {
      return { ok: false, message: "This sortie has already launched." };
    }
    this.phaseValue = "carrier";
    this.events.push("launched");
    return { ok: true, message: "Carrier away." };
  }

  /**
   * Skips the rest of the carrier run.
   *
   * The sequence is there to be watched the first time and skipped every time
   * after, which is the difference between a transition and a tax.
   */
  skipCarrier(): void {
    if (this.phaseValue !== "carrier") return;
    this.carrierElapsed = this.carrierTotal;
    this.beginActive();
  }

  /** Seconds of world time. Moves the carrier, then the mission clock. */
  advance(seconds: number): void {
    if (seconds <= 0) return;
    if (this.phaseValue === "carrier") {
      this.carrierElapsed += seconds;
      if (this.carrierElapsed >= this.carrierTotal) this.beginActive();
      return;
    }
    if (this.phaseValue === "active") this.elapsed += seconds;
  }

  private beginActive(): void {
    this.phaseValue = "active";
    this.events.push("arrived");
  }

  /**
   * Takes what the simulation reports and moves the objectives on.
   *
   * This is the only way anything reaches the mission, which is what makes the
   * results reconcile: there is no second path where the interface awards
   * something the simulation did not do.
   */
  report(progress: MissionProgress): readonly MissionObjective[] {
    if (this.phaseValue !== "active") return [];
    this.progress = { ...progress, elapsedSeconds: this.elapsed };
    const { changed } = evaluateObjectives(this.registry, this.objectiveList, this.progress);
    for (const objective of changed) this.events.push(`${objective.id}:${objective.state}`);
    return changed;
  }

  /** True when every objective is settled or something critical has failed. */
  get settled(): boolean {
    return this.phaseValue === "active" && missionSettled(this.registry, this.objectiveList);
  }

  /**
   * Ends the sortie and works out what it was worth.
   *
   * Every line is derived from the progress the simulation reported, and every
   * line carries the reason it exists.
   */
  complete(kind: MissionOutcome = "success"): MissionResults {
    if (this.resultsValue) return this.resultsValue;
    const score = objectiveScore(this.registry, this.objectiveList);
    const criticalFailed = this.objectiveList.some(
      (entry) => entry.state === "failed" && this.registry.get(entry.id)?.critical === true,
    );

    const outcome: MissionOutcome =
      kind !== "success"
        ? kind
        : criticalFailed
          ? "failure"
          : score >= 0.85
            ? "success"
            : score >= 0.4
              ? "partial"
              : "failure";

    const machineDamage = 1 - this.progress.machineIntegrity;
    const cityImpact = 1 - this.progress.cityIntegrity;
    const ledger: { label: string; value: number; reason: string }[] = [
      {
        label: "Objectives",
        value: score,
        reason: this.objectiveList
          .map((entry) => `${entry.id.replace("objective.", "")} ${entry.state}`)
          .join(", "),
      },
      {
        label: "Machine damage",
        value: -machineDamage,
        reason: `${Math.round(machineDamage * 100)} percent of its structure came off`,
      },
      {
        label: "City impact",
        value: -cityImpact,
        reason: `${Math.round(cityImpact * 100)} percent of the district went with it`,
      },
      {
        label: "Salvage",
        value: this.progress.salvageTons,
        reason: "recovered from the field",
      },
      { label: "Samples", value: this.progress.samples, reason: "taken for research" },
      {
        label: "Civilians",
        value: this.progress.rescuedThousands,
        reason: "thousands pulled out",
      },
    ];

    // Reputation follows what the city got out of it, not what the player did.
    const reputation = Math.round((score - cityImpact) * 100) / 100;
    // A drift strengthens by coming home and weakens by being torn apart.
    const copilotLink = Math.round((score * 0.06 - machineDamage * 0.05) * 1000) / 1000;
    const experience = Math.round(score * 120 + this.progress.kaijuDown * 80);
    const funding = Math.round(
      score * 2_400_000 + this.progress.salvageTons * 900 + this.progress.samples * 120_000,
    );
    const repairHours = Math.round(machineDamage * 900);

    ledger.push(
      { label: "Reputation", value: reputation, reason: "what the district saw of it" },
      { label: "Drift link", value: copilotLink, reason: "what the sortie did to the pair" },
      { label: "Funding", value: funding, reason: "objectives, salvage and samples" },
      { label: "Repair hours", value: -repairHours, reason: "what the bay now owes the machine" },
    );

    this.resultsValue = {
      outcome,
      objectiveScore: score,
      objectives: this.objectiveList.map((entry) => ({
        id: entry.id,
        state: entry.state,
        detail: this.registry.get(entry.id)?.describe(this.progress) ?? "",
      })),
      machineDamage,
      repairHours,
      cityImpact,
      salvageTons: this.progress.salvageTons,
      samples: this.progress.samples,
      rescuedThousands: this.progress.rescuedThousands,
      reputation,
      copilotLink,
      experience,
      funding,
      replay: { seed: this.seed, plan: this.plan, events: [...this.events] },
      ledger,
      summary: describeOutcome(outcome, score),
    };
    this.phaseValue = "results";
    this.events.push(`ended:${outcome}`);
    return this.resultsValue;
  }

  /**
   * Ends a sortie the player walked away from.
   *
   * An abort is a real outcome with real consequences, not a cancel button: the
   * objectives that were met still count and the ones that were not still fail.
   */
  abort(reason: "aborted" | "lost-contact" = "aborted"): MissionResults {
    if (this.phaseValue === "planning") {
      this.phaseValue = "closed";
      // Nothing launched, so nothing happened. This is the one free exit.
      this.events.push("cancelled before launch");
      return this.complete(reason);
    }
    this.events.push(reason);
    return this.complete(reason);
  }

  close(): void {
    this.phaseValue = "closed";
  }

  snapshot(): MissionSnapshot {
    return {
      schemaVersion: MISSION_SCHEMA_VERSION,
      id: this.id,
      incidentId: this.incidentId,
      regionId: this.regionId,
      phase: this.phaseValue,
      plan: this.plan,
      objectives: this.objectiveList.map((entry) => ({ ...entry })),
      carrierSeconds: Math.round(this.carrierElapsed),
      carrierTotalSeconds: this.carrierTotal,
      elapsedSeconds: Math.round(this.elapsed),
      seed: this.seed,
      results: this.resultsValue,
    };
  }

  restore(snapshot: MissionSnapshot): void {
    this.phaseValue = MISSION_PHASES.includes(snapshot.phase) ? snapshot.phase : "planning";
    this.carrierElapsed = Math.max(0, snapshot.carrierSeconds);
    this.elapsed = Math.max(0, snapshot.elapsedSeconds);
    this.resultsValue = snapshot.results;
    this.objectiveList.length = 0;
    for (const objective of snapshot.objectives) {
      if (!this.registry.get(objective.id)) continue;
      this.objectiveList.push({ ...objective });
    }
  }
}

function describeOutcome(outcome: MissionOutcome, score: number): string {
  const percent = Math.round(score * 100);
  switch (outcome) {
    case "success":
      return `Sortie complete. ${percent} percent of what was asked for.`;
    case "partial":
      return `Sortie ended with ${percent} percent of the objectives met.`;
    case "failure":
      return `Sortie failed. ${percent} percent of the objectives met before it ended.`;
    case "aborted":
      return `Sortie aborted. ${percent} percent was already done and it still counts.`;
    case "lost-contact":
      return `Contact with the machine was lost. ${percent} percent was confirmed before it went.`;
  }
}

/**
 * Works out whether a plan can go, and what it will cost.
 *
 * Refusals are sentences. Nothing here reveals anything the warning did not
 * already know, which is what keeps a hidden phase hidden.
 */
export function assessPlan(options: {
  readonly plan: DeploymentPlan;
  readonly jaeger: JaegerDefinition | undefined;
  readonly pilots: readonly (PilotDefinition | undefined)[];
  readonly machineIntegrity: number;
  readonly machineReady: boolean;
  readonly machineStatus: string;
  readonly weapons: readonly WeaponDefinition[];
  readonly distanceMeters: number;
  readonly carrierSpeedMps: number;
  /** Tons the carrier can lift, before the machine itself. */
  readonly liftCapacityTons: number;
  readonly weatherSummary: string;
  readonly weatherPenalty: number;
  readonly underwater: boolean;
  /** The warning's own words. Never the truth behind them. */
  readonly forecastComposition: string;
  readonly forecastConfidence: number;
}): ReadinessReport {
  const refusals: string[] = [];
  const warnings: string[] = [];

  if (!options.jaeger) refusals.push("No machine selected.");
  if (!options.machineReady) refusals.push(`The machine is ${options.machineStatus}.`);

  const drift = assessDrift(options.pilots[0], options.pilots[1]);
  if (drift.refused) refusals.push(drift.summary);

  if (options.plan.weaponIds.length === 0) {
    warnings.push("Nothing is mounted. It will be a fist fight.");
  }

  // Consumables and weapons both cost lift.
  const consumableTons = Object.values(options.plan.consumables).reduce(
    (total, count) => total + count * 4,
    0,
  );
  const weaponTons = options.weapons
    .filter((weapon) => options.plan.weaponIds.includes(weapon.id))
    .reduce((total, weapon) => total + 20 + weapon.reserve * 0.4, 0);
  const load = consumableTons + weaponTons;
  const logisticsLoad = options.liftCapacityTons <= 0 ? 1 : load / options.liftCapacityTons;
  const overloaded = logisticsLoad > 1;
  if (overloaded) {
    refusals.push(
      `The carrier cannot lift this: ${Math.round(load)} tons against ${Math.round(options.liftCapacityTons)}.`,
    );
  } else if (logisticsLoad > 0.85) {
    warnings.push("The carrier is close to its limit.");
  }

  if (options.underwater && !options.plan.weaponIds.some((id) => id.includes("whip"))) {
    warnings.push("This is a water fight and nothing carried works better wet.");
  }
  if (options.weatherPenalty > 0.3) {
    warnings.push(`Weather will cost you: ${options.weatherSummary}.`);
  }
  if (options.machineIntegrity < 0.7) {
    warnings.push(
      `The machine is going out at ${Math.round(options.machineIntegrity * 100)} percent structure.`,
    );
  }

  const travelSeconds = options.carrierSpeedMps <= 0 ? 0 : options.distanceMeters / options.carrierSpeedMps;
  // Preparedness, not emptiness. Going out with nothing aboard is the least
  // ready a machine can be, and an earlier version of this had it backwards:
  // an empty loadout scored well because it used no lift.
  const preparedness = overloaded ? 0 : clamp01(logisticsLoad / 0.6);
  const readiness = clamp01(
    (options.machineIntegrity * 0.4 + drift.effectiveness * 0.4 + preparedness * 0.2) *
      (1 - options.weatherPenalty * 0.25),
  );

  return {
    readiness,
    driftStrength: drift.strength,
    machineIntegrity: options.machineIntegrity,
    travelSeconds,
    logisticsLoad,
    overloaded,
    weather: options.weatherSummary,
    underwater: options.underwater,
    predictedThreat:
      options.forecastConfidence > 0.4
        ? options.forecastComposition
        : "Not enough signal to say what is out there.",
    refusals,
    warnings,
  };
}

export function validateMissionSnapshot(snapshot: unknown): string[] {
  if (typeof snapshot !== "object" || snapshot === null) return ["mission snapshot must be an object"];
  const record = snapshot as Record<string, unknown>;
  const errors: string[] = [];
  if (record["schemaVersion"] !== MISSION_SCHEMA_VERSION) {
    errors.push(`mission.schemaVersion must be ${MISSION_SCHEMA_VERSION}`);
  }
  if (typeof record["id"] !== "string") errors.push("mission.id must be a string");
  if (!MISSION_PHASES.includes(record["phase"] as MissionPhase)) {
    errors.push(`unknown mission phase "${String(record["phase"])}"`);
  }
  if (!Array.isArray(record["objectives"])) errors.push("mission.objectives must be an array");
  if (typeof record["plan"] !== "object" || record["plan"] === null) {
    errors.push("mission.plan must be an object");
  }
  return errors;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
