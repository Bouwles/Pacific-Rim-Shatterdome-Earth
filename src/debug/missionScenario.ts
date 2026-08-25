import { createObjectiveRegistry, emptyProgress, type MissionProgress } from "../missions/objectives";
import { Mission, type DeploymentPlan, type MissionOutcome, type MissionResults } from "../missions/mission";

/**
 * A whole sortie, run headlessly.
 *
 * Command alert to preparation to carrier to fight to results, with the
 * progress fed in exactly as the live game feeds it: from authoritative numbers
 * rather than from anything the mission invented. That is what lets a test
 * assert the results reconcile.
 *
 * The same run can be played out as a win, a partial, a rout, an abort or a
 * lost machine, so every ending is exercised by the same code path.
 */

export const MISSION_SCENARIO_SEED = 20260825;

export type MissionStory = "clean-win" | "costly-win" | "rout" | "abort" | "lost-contact";

export interface MissionScenarioOptions {
  readonly seed?: number;
  readonly story?: MissionStory;
  /** In-game seconds the carrier run takes. */
  readonly carrierSeconds?: number;
  /** True to skip the carrier rather than sitting through it. */
  readonly skipCarrier?: boolean;
}

export interface MissionScenarioResult {
  readonly phases: readonly string[];
  readonly results: MissionResults;
  /** Everything the mission recorded, which is the replay. */
  readonly events: readonly string[];
  /** The final progress the simulation reported, for reconciliation. */
  readonly reported: MissionProgress;
  readonly carrierWatchedSeconds: number;
  readonly digest: number;
}

export function samplePlan(): DeploymentPlan {
  return {
    jaegerId: "placeholder-mk0",
    pilotIds: ["pilot.okonkwo", "pilot.varga"],
    weaponIds: ["weapon.plasma-caster", "weapon.rotary-cannon"],
    consumables: { "consumable.reload": 2, "consumable.repair-kit": 1 },
    allyIds: [],
    arrivalBearingDeg: 180,
    priorities: ["objective.defend", "objective.rescue"],
  };
}

/** How each story ends up, as the numbers the simulation would have reported. */
function progressFor(story: MissionStory): MissionProgress {
  const base = emptyProgress();
  switch (story) {
    case "clean-win":
      return {
        ...base,
        kaijuTotal: 1,
        kaijuDown: 1,
        machineIntegrity: 0.92,
        cityIntegrity: 0.88,
        trappedThousands: 0,
        rescuedThousands: 2.4,
        salvageTons: 260,
        samples: 2,
      };
    case "costly-win":
      return {
        ...base,
        kaijuTotal: 1,
        kaijuDown: 1,
        machineIntegrity: 0.44,
        cityIntegrity: 0.51,
        trappedThousands: 1.2,
        rescuedThousands: 3.1,
        salvageTons: 420,
        samples: 3,
      };
    case "rout":
      return {
        ...base,
        kaijuTotal: 1,
        kaijuDown: 0,
        machineIntegrity: 0.18,
        cityIntegrity: 0.1,
        trappedThousands: 6.5,
        rescuedThousands: 0.2,
        salvageTons: 0,
        samples: 0,
      };
    case "abort":
    case "lost-contact":
      return {
        ...base,
        kaijuTotal: 1,
        kaijuDown: 0,
        machineIntegrity: 0.35,
        cityIntegrity: 0.62,
        trappedThousands: 3,
        rescuedThousands: 1.1,
        salvageTons: 40,
        samples: 1,
      };
  }
}

export function runMissionScenario(options: MissionScenarioOptions = {}): MissionScenarioResult {
  const story = options.story ?? "clean-win";
  const registry = createObjectiveRegistry();
  const carrierSeconds = options.carrierSeconds ?? 60;
  const mission = new Mission({
    id: "mission.1",
    incidentId: "incident.1",
    regionId: "hong-kong",
    plan: samplePlan(),
    objectives: registry,
    seed: options.seed ?? MISSION_SCENARIO_SEED,
    carrierSeconds,
    assignments: [
      { id: "objective.defend", stage: 0 },
      { id: "objective.rescue", stage: 0 },
      // A second stage, so a multi-stage crisis is exercised rather than assumed.
      { id: "objective.salvage", stage: 1 },
    ],
  });

  const phases: string[] = [mission.phase];
  mission.launch();
  phases.push(mission.phase);

  let watched = 0;
  if (options.skipCarrier) {
    mission.skipCarrier();
  } else {
    while (mission.phase === "carrier" && watched < carrierSeconds * 4) {
      mission.advance(5);
      watched += 5;
    }
  }
  phases.push(mission.phase);

  const reported = progressFor(story);
  // The fight, reported in steps the way the live game reports it.
  for (let step = 1; step <= 5; step += 1) {
    const fraction = step / 5;
    mission.advance(10);
    mission.report({
      ...reported,
      kaijuDown: step === 5 ? reported.kaijuDown : 0,
      machineIntegrity: 1 - (1 - reported.machineIntegrity) * fraction,
      cityIntegrity: 1 - (1 - reported.cityIntegrity) * fraction,
      rescuedThousands: reported.rescuedThousands * fraction,
      salvageTons: reported.salvageTons * fraction,
      samples: Math.round(reported.samples * fraction),
    });
  }

  let results: MissionResults;
  if (story === "abort") results = mission.abort("aborted");
  else if (story === "lost-contact") results = mission.abort("lost-contact");
  else results = mission.complete();
  phases.push(mission.phase);

  const text = `${results.outcome}:${results.objectiveScore.toFixed(3)}:${results.funding}:${mission.log.join(">")}`;
  return {
    phases,
    results,
    events: mission.log,
    reported,
    carrierWatchedSeconds: watched,
    digest: digestOf(text),
  };
}

/** Every ending, so no path through the lifecycle is left unexercised. */
export function runEveryEnding(): Readonly<Record<MissionStory, MissionOutcome>> {
  const stories: readonly MissionStory[] = ["clean-win", "costly-win", "rout", "abort", "lost-contact"];
  const outcomes = {} as Record<MissionStory, MissionOutcome>;
  for (const story of stories) outcomes[story] = runMissionScenario({ story }).results.outcome;
  return outcomes;
}

function digestOf(text: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
