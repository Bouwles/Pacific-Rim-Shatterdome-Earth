import { ContentRegistry, type RegistryEntry } from "../data/registry";

/**
 * What a sortie is actually for.
 *
 * Every objective is a row with its own completion rule and its own failure
 * rule, both reading one plain progress object built from authoritative events.
 * Nothing switches on an objective name, and no objective invents a number: if
 * a rule cannot be satisfied by something the simulation reports, it does not
 * belong here.
 *
 * Multi-stage crises are a list of these rather than a special kind, so a
 * two-part mission is data.
 */

export const OBJECTIVE_IDS = [
  "objective.defend",
  "objective.intercept",
  "objective.pursue",
  "objective.rescue",
  "objective.contain",
  "objective.escort",
  "objective.research",
  "objective.salvage",
] as const;
export type ObjectiveId = (typeof OBJECTIVE_IDS)[number];

export const OBJECTIVE_STATES = ["pending", "active", "complete", "failed"] as const;
export type ObjectiveState = (typeof OBJECTIVE_STATES)[number];

/**
 * Everything an objective is allowed to look at.
 *
 * Built once per evaluation from the arena, the roster and the city, so two
 * objectives can never disagree about what happened.
 */
export interface MissionProgress {
  /** Creatures that arrived, and how many are down. */
  readonly kaijuTotal: number;
  readonly kaijuDown: number;
  /** True when a creature left the area rather than being killed. */
  readonly kaijuEscaped: boolean;
  /** Fraction of the machine's structure still intact, 0 to 1. */
  readonly machineIntegrity: number;
  /** Fraction of the city block integrity still standing where the fight is. */
  readonly cityIntegrity: number;
  /** Thousands of civilians still trapped in the fight area. */
  readonly trappedThousands: number;
  /** Thousands rescued so far. */
  readonly rescuedThousands: number;
  /** Research samples taken from a living or dead creature. */
  readonly samples: number;
  /** Salvage recovered, in tons. */
  readonly salvageTons: number;
  /** True while the thing being escorted is still moving and alive. */
  readonly escortAlive: boolean;
  /** Metres the escorted convoy still has to travel. */
  readonly escortMetresLeft: number;
  /** Seconds elapsed in the mission. */
  readonly elapsedSeconds: number;
  /** Seconds allowed, or Infinity when there is no clock. */
  readonly limitSeconds: number;
  /** 0 to 1 of the contamination in the fight area. */
  readonly contamination: number;
}

export interface ObjectiveDefinition extends RegistryEntry {
  readonly id: ObjectiveId;
  readonly displayName: string;
  /** What the briefing says, in the second person. */
  readonly briefing: string;
  /** 0 to 1. How much of the mission's reward this objective carries. */
  readonly weight: number;
  /** True when failing this fails the whole mission. */
  readonly critical: boolean;
  /** 0 to 1 progress. Pure: same input, same number. */
  progress(state: MissionProgress): number;
  /** True when it is done. */
  complete(state: MissionProgress): boolean;
  /** True when it can no longer be done. */
  failed(state: MissionProgress): boolean;
  /** One line saying where it stands, for the panel. */
  describe(state: MissionProgress): string;
}

const OBJECTIVES: readonly ObjectiveDefinition[] = [
  {
    id: "objective.defend",
    displayName: "Defend",
    briefing: "Hold the district. Everything you leave standing is the point.",
    weight: 1,
    critical: true,
    progress: (state) => state.cityIntegrity,
    complete: (state) => state.kaijuDown >= state.kaijuTotal && state.cityIntegrity > 0.35,
    failed: (state) => state.cityIntegrity <= 0.15,
    describe: (state) => `${Math.round(state.cityIntegrity * 100)} percent of the district still standing`,
  },
  {
    id: "objective.intercept",
    displayName: "Intercept",
    briefing: "Meet it at the waterline. Nothing gets past you into the city.",
    weight: 1,
    critical: true,
    progress: (state) => (state.kaijuTotal === 0 ? 0 : state.kaijuDown / state.kaijuTotal),
    complete: (state) => state.kaijuDown >= state.kaijuTotal && state.cityIntegrity > 0.8,
    failed: (state) => state.cityIntegrity <= 0.6,
    describe: (state) =>
      `${state.kaijuDown} of ${state.kaijuTotal} stopped, city at ${Math.round(state.cityIntegrity * 100)} percent`,
  },
  {
    id: "objective.pursue",
    displayName: "Pursue",
    briefing: "It is running. Do not let it reach open water.",
    weight: 0.8,
    critical: false,
    progress: (state) => (state.kaijuTotal === 0 ? 0 : state.kaijuDown / state.kaijuTotal),
    complete: (state) => state.kaijuDown >= state.kaijuTotal,
    failed: (state) => state.kaijuEscaped,
    describe: (state) => (state.kaijuEscaped ? "it reached the water" : `${state.kaijuDown} down`),
  },
  {
    id: "objective.rescue",
    displayName: "Rescue",
    briefing: "There are people under that. Get them out.",
    weight: 0.9,
    critical: false,
    progress: (state) => {
      const total = state.rescuedThousands + state.trappedThousands;
      return total <= 0 ? 1 : state.rescuedThousands / total;
    },
    complete: (state) => state.trappedThousands <= 0.05,
    failed: (state) => state.elapsedSeconds > state.limitSeconds && state.trappedThousands > 0.5,
    describe: (state) =>
      `${state.rescuedThousands.toFixed(1)}k out, ${state.trappedThousands.toFixed(1)}k still under it`,
  },
  {
    id: "objective.contain",
    displayName: "Contain",
    briefing: "Whatever it is leaking, it does not leave this district.",
    weight: 0.8,
    critical: false,
    progress: (state) => 1 - state.contamination,
    complete: (state) => state.contamination <= 0.1 && state.kaijuDown >= state.kaijuTotal,
    failed: (state) => state.contamination >= 0.85,
    describe: (state) => `${Math.round(state.contamination * 100)} percent contamination`,
  },
  {
    id: "objective.escort",
    displayName: "Escort",
    briefing: "The convoy moves at its pace, not yours. Keep it alive.",
    weight: 0.9,
    critical: false,
    progress: (state) => (state.escortMetresLeft <= 0 ? 1 : Math.max(0, 1 - state.escortMetresLeft / 4_000)),
    complete: (state) => state.escortAlive && state.escortMetresLeft <= 0,
    failed: (state) => !state.escortAlive,
    describe: (state) =>
      state.escortAlive ? `${Math.round(state.escortMetresLeft)} m to go` : "the convoy did not make it",
  },
  {
    id: "objective.research",
    displayName: "Research",
    briefing: "Science wants samples. Take them from something that is still warm.",
    weight: 0.6,
    critical: false,
    progress: (state) => Math.min(1, state.samples / 3),
    complete: (state) => state.samples >= 3,
    failed: (state) => state.kaijuEscaped && state.samples < 1,
    describe: (state) => `${state.samples} of 3 samples`,
  },
  {
    id: "objective.salvage",
    displayName: "Salvage",
    briefing: "Everything you bring back pays for the next machine.",
    weight: 0.5,
    critical: false,
    progress: (state) => Math.min(1, state.salvageTons / 400),
    complete: (state) => state.salvageTons >= 400,
    failed: () => false,
    describe: (state) => `${Math.round(state.salvageTons)} of 400 tons recovered`,
  },
];

export function validateObjective(entry: ObjectiveDefinition): string[] {
  const errors: string[] = [];
  if (!OBJECTIVE_IDS.includes(entry.id)) errors.push(`unknown objective "${String(entry.id)}"`);
  if (!entry.displayName) errors.push("displayName required");
  if (!entry.briefing) errors.push("briefing required");
  if (!Number.isFinite(entry.weight) || entry.weight <= 0 || entry.weight > 1) {
    errors.push("weight must be within (0, 1]");
  }
  for (const key of ["progress", "complete", "failed", "describe"] as const) {
    if (typeof entry[key] !== "function") errors.push(`${key} must be a function`);
  }
  return errors;
}

export function createObjectiveRegistry(): ContentRegistry<ObjectiveDefinition> {
  const registry = new ContentRegistry<ObjectiveDefinition>(validateObjective);
  for (const objective of OBJECTIVES) registry.register(objective);
  for (const id of OBJECTIVE_IDS) {
    if (!registry.get(id)) throw new Error(`Objective "${id}" is declared but not registered`);
  }
  return registry;
}

export const OBJECTIVE_DEFINITIONS = OBJECTIVES;

/** One objective inside a mission, with where it currently stands. */
export interface MissionObjective {
  readonly id: ObjectiveId;
  /** Which stage of the mission it belongs to. Stage zero starts active. */
  readonly stage: number;
  state: ObjectiveState;
  progress: number;
}

/** A blank progress object. Everything at rest, nothing invented. */
export function emptyProgress(): MissionProgress {
  return {
    kaijuTotal: 1,
    kaijuDown: 0,
    kaijuEscaped: false,
    machineIntegrity: 1,
    cityIntegrity: 1,
    trappedThousands: 0,
    rescuedThousands: 0,
    samples: 0,
    salvageTons: 0,
    escortAlive: true,
    escortMetresLeft: 0,
    elapsedSeconds: 0,
    limitSeconds: Number.POSITIVE_INFINITY,
    contamination: 0,
  };
}

/**
 * Advances every objective in the current stage.
 *
 * Stages open in order: nothing in stage two is looked at until everything
 * critical in stage one is settled, which is what makes a multi-stage crisis a
 * sequence rather than a pile.
 */
export function evaluateObjectives(
  registry: ContentRegistry<ObjectiveDefinition>,
  objectives: readonly MissionObjective[],
  progress: MissionProgress,
): { readonly stage: number; readonly changed: readonly MissionObjective[] } {
  const changed: MissionObjective[] = [];
  const stages = [...new Set(objectives.map((entry) => entry.stage))].sort((a, b) => a - b);
  let activeStage = stages[0] ?? 0;

  // Stages open in order, and a stage that settles opens the next one in the
  // same evaluation. Without that, finishing the first half of a two-part
  // crisis would leave the second half sitting pending until something else
  // happened to be reported.
  for (const stage of stages) {
    activeStage = stage;
    const inStage = objectives.filter((entry) => entry.stage === stage);

    for (const objective of inStage) {
      const definition = registry.get(objective.id);
      if (!definition) continue;
      if (objective.state === "complete" || objective.state === "failed") continue;

      const before = objective.state;
      objective.progress = clamp01(definition.progress(progress));
      if (objective.state === "pending") objective.state = "active";
      if (definition.failed(progress)) objective.state = "failed";
      else if (definition.complete(progress)) objective.state = "complete";
      if (objective.state !== before) changed.push(objective);
    }

    const settled = inStage.every((entry) => entry.state === "complete" || entry.state === "failed");
    if (!settled) break;
    // Anything critical failing ends the mission rather than opening the next
    // stage, because there is no next stage of a mission that is over.
    const criticalFailed = inStage.some(
      (entry) => entry.state === "failed" && registry.get(entry.id)?.critical === true,
    );
    if (criticalFailed) break;
  }

  return { stage: activeStage, changed };
}

/** True when the mission is over, one way or the other. */
export function missionSettled(
  registry: ContentRegistry<ObjectiveDefinition>,
  objectives: readonly MissionObjective[],
): boolean {
  if (objectives.length === 0) return true;
  const criticalFailed = objectives.some(
    (entry) => entry.state === "failed" && registry.get(entry.id)?.critical === true,
  );
  if (criticalFailed) return true;
  return objectives.every((entry) => entry.state === "complete" || entry.state === "failed");
}

/** 0 to 1 of the mission's objectives met, weighted by what they are worth. */
export function objectiveScore(
  registry: ContentRegistry<ObjectiveDefinition>,
  objectives: readonly MissionObjective[],
): number {
  let earned = 0;
  let available = 0;
  for (const objective of objectives) {
    const definition = registry.get(objective.id);
    if (!definition) continue;
    available += definition.weight;
    if (objective.state === "complete") earned += definition.weight;
    else if (objective.state === "active") earned += definition.weight * objective.progress * 0.5;
  }
  return available <= 0 ? 0 : clamp01(earned / available);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
