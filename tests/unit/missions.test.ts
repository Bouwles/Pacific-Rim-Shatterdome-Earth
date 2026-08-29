import { describe, expect, it } from "vitest";
import {
  PILOT_DEFINITIONS,
  assessDrift,
  combinedSpecialisms,
  createPilotRegistry,
  validatePilot,
} from "../../src/data/pilots";
import {
  OBJECTIVE_DEFINITIONS,
  OBJECTIVE_IDS,
  createObjectiveRegistry,
  emptyProgress,
  evaluateObjectives,
  missionSettled,
  objectiveScore,
  validateObjective,
  type MissionObjective,
  type ObjectiveId,
} from "../../src/missions/objectives";
import { Mission, assessPlan, validateMissionSnapshot } from "../../src/missions/mission";
import { samplePlan } from "../../src/debug/missionScenario";
import { jaegerRegistry } from "../../src/data/jaegers";
import { createWeaponRegistry } from "../../src/data/weapons";

const pilots = createPilotRegistry();
const objectives = createObjectiveRegistry();
const weapons = createWeaponRegistry();

function mission(
  assignments: readonly { id: ObjectiveId; stage: number }[] = [{ id: "objective.defend", stage: 0 }],
): Mission {
  return new Mission({
    id: "mission.test",
    incidentId: "incident.test",
    regionId: "hong-kong",
    plan: samplePlan(),
    objectives,
    seed: 1,
    carrierSeconds: 30,
    assignments,
  });
}

describe("pilots and the drift", () => {
  it("ships pilots that all validate", () => {
    for (const pilot of PILOT_DEFINITIONS) expect(validatePilot(pilot), pilot.id).toEqual([]);
  });

  it("refuses a pilot who is their own drift partner", () => {
    const base = pilots.getOrThrow("pilot.varga");
    expect(validatePilot({ ...base, affinities: [base.id] }).join(" ")).toMatch(/own drift partner/);
  });

  it("refuses to drift somebody with themselves, or alone", () => {
    const one = pilots.getOrThrow("pilot.reyes");
    expect(assessDrift(one, one).refused).toBe(true);
    expect(assessDrift(one, undefined).refused).toBe(true);
    expect(assessDrift(undefined, undefined).summary).toMatch(/needs two pilots/);
  });

  it("rates a pair who have flown together above two strangers", () => {
    const partners = assessDrift(pilots.getOrThrow("pilot.okonkwo"), pilots.getOrThrow("pilot.varga"));
    const strangers = assessDrift(pilots.getOrThrow("pilot.okonkwo"), pilots.getOrThrow("pilot.sato"));
    expect(partners.strength).toBeGreaterThan(strangers.strength);
    expect(partners.summary).toMatch(/drifted before/);
  });

  it("says what a pair are collectively good at", () => {
    const shared = combinedSpecialisms(pilots.getOrThrow("pilot.varga"), pilots.getOrThrow("pilot.reyes"));
    expect(shared).toContain("gunnery");
    expect(shared).toContain("piloting");
    expect(new Set(shared).size).toBe(shared.length);
  });
});

describe("objectives", () => {
  it("ships every declared objective, and they all validate", () => {
    expect(OBJECTIVE_DEFINITIONS.length).toBe(OBJECTIVE_IDS.length);
    for (const objective of OBJECTIVE_DEFINITIONS) {
      expect(validateObjective(objective), objective.id).toEqual([]);
    }
  });

  it("covers the eight kinds the milestone asks for", () => {
    expect([...OBJECTIVE_IDS]).toEqual([
      "objective.defend",
      "objective.intercept",
      "objective.pursue",
      "objective.rescue",
      "objective.contain",
      "objective.escort",
      "objective.research",
      "objective.salvage",
    ]);
  });

  it("completes and fails from the same reported numbers", () => {
    const defend = objectives.getOrThrow("objective.defend");
    const held = { ...emptyProgress(), kaijuTotal: 1, kaijuDown: 1, cityIntegrity: 0.7 };
    const lost = { ...emptyProgress(), cityIntegrity: 0.05 };
    expect(defend.complete(held)).toBe(true);
    expect(defend.failed(held)).toBe(false);
    expect(defend.failed(lost)).toBe(true);
  });

  it("opens the next stage as soon as the one before it settles", () => {
    const list: MissionObjective[] = [
      { id: "objective.defend", stage: 0, state: "active", progress: 0 },
      { id: "objective.salvage", stage: 1, state: "pending", progress: 0 },
    ];
    const done = { ...emptyProgress(), kaijuTotal: 1, kaijuDown: 1, cityIntegrity: 0.9 };
    const result = evaluateObjectives(objectives, list, done);
    expect(list[0]!.state).toBe("complete");
    // The second stage is live in the same evaluation rather than a tick later.
    expect(list[1]!.state).toBe("active");
    expect(result.stage).toBe(1);
  });

  it("stops at a critical failure rather than opening the next stage", () => {
    const list: MissionObjective[] = [
      { id: "objective.defend", stage: 0, state: "active", progress: 0 },
      { id: "objective.salvage", stage: 1, state: "pending", progress: 0 },
    ];
    evaluateObjectives(objectives, list, { ...emptyProgress(), cityIntegrity: 0.05 });
    expect(list[0]!.state).toBe("failed");
    expect(list[1]!.state).toBe("pending");
    expect(missionSettled(objectives, list)).toBe(true);
  });

  it("weights the score by what each objective is worth", () => {
    const all: MissionObjective[] = [
      { id: "objective.defend", stage: 0, state: "complete", progress: 1 },
      { id: "objective.salvage", stage: 0, state: "failed", progress: 0 },
    ];
    const score = objectiveScore(objectives, all);
    // Defending is worth twice what salvage is, so this is well over half.
    expect(score).toBeGreaterThan(0.6);
    expect(score).toBeLessThan(1);
  });
});

describe("the deployment planner", () => {
  const baseOptions = {
    plan: samplePlan(),
    jaeger: jaegerRegistry.getOrThrow("placeholder-mk0"),
    pilots: [pilots.getOrThrow("pilot.okonkwo"), pilots.getOrThrow("pilot.varga")],
    machineIntegrity: 1,
    machineReady: true,
    machineStatus: "ready",
    weapons: weapons.all(),
    distanceMeters: 900_000,
    carrierSpeedMps: 240,
    liftCapacityTons: 400,
    weatherSummary: "clear",
    weatherPenalty: 0,
    underwater: false,
    forecastComposition: "1 confirmed: Knifehead",
    forecastConfidence: 0.8,
  };

  it("works out readiness, travel time and load", () => {
    const report = assessPlan(baseOptions);
    expect(report.readiness).toBeGreaterThan(0.5);
    expect(report.travelSeconds).toBeCloseTo(3_750, 0);
    expect(report.logisticsLoad).toBeGreaterThan(0);
    expect(report.refusals).toEqual([]);
  });

  it("refuses a machine that is not ready, in words", () => {
    const report = assessPlan({ ...baseOptions, machineReady: false, machineStatus: "under repair" });
    expect(report.refusals.join(" ")).toMatch(/under repair/);
  });

  it("refuses a load the carrier cannot lift", () => {
    const report = assessPlan({ ...baseOptions, liftCapacityTons: 20 });
    expect(report.overloaded).toBe(true);
    expect(report.refusals.join(" ")).toMatch(/cannot lift/);
  });

  it("refuses a pair who cannot drift", () => {
    const one = pilots.getOrThrow("pilot.reyes");
    const report = assessPlan({ ...baseOptions, pilots: [one, one] });
    expect(report.refusals.join(" ")).toMatch(/Nobody drifts with themselves/);
  });

  it("warns without refusing when the odds are merely bad", () => {
    const report = assessPlan({
      ...baseOptions,
      machineIntegrity: 0.5,
      weatherPenalty: 0.5,
      weatherSummary: "storm",
      underwater: true,
      plan: { ...samplePlan(), weaponIds: [] },
    });
    expect(report.refusals).toEqual([]);
    expect(report.warnings.length).toBeGreaterThan(2);
    expect(report.readiness).toBeLessThan(0.6);
  });

  it("never reveals more than the warning knew", () => {
    const confident = assessPlan(baseOptions);
    const vague = assessPlan({ ...baseOptions, forecastConfidence: 0.2 });
    expect(confident.predictedThreat).toMatch(/Knifehead/);
    // A weak signal says so rather than leaking what is really out there.
    expect(vague.predictedThreat).toMatch(/Not enough signal/);
  });
});

describe("the mission lifecycle", () => {
  it("runs planning, carrier, active and results in order", () => {
    const sortie = mission();
    expect(sortie.phase).toBe("planning");
    expect(sortie.launch().ok).toBe(true);
    expect(sortie.phase).toBe("carrier");
    sortie.advance(15);
    expect(sortie.phase).toBe("carrier");
    expect(sortie.carrierProgress).toBeCloseTo(0.5, 2);
    sortie.advance(20);
    expect(sortie.phase).toBe("active");
    sortie.report({ ...emptyProgress(), kaijuTotal: 1, kaijuDown: 1, cityIntegrity: 0.9 });
    sortie.complete();
    expect(sortie.phase).toBe("results");
  });

  it("can be skipped past the carrier rather than sat through", () => {
    const sortie = mission();
    sortie.launch();
    sortie.skipCarrier();
    expect(sortie.phase).toBe("active");
    expect(sortie.carrierProgress).toBe(1);
  });

  it("refuses to launch twice", () => {
    const sortie = mission();
    sortie.launch();
    const again = sortie.launch();
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/already launched/);
  });

  it("ignores reports before it has arrived", () => {
    const sortie = mission();
    sortie.launch();
    const changed = sortie.report({ ...emptyProgress(), kaijuDown: 1 });
    expect(changed).toEqual([]);
  });

  it("produces a recoverable, explained outcome when aborted", () => {
    const sortie = mission();
    sortie.launch();
    sortie.skipCarrier();
    sortie.report({ ...emptyProgress(), cityIntegrity: 0.8, rescuedThousands: 1 });
    const results = sortie.abort("aborted");
    expect(results.outcome).toBe("aborted");
    expect(results.summary).toMatch(/still counts/);
    // What was achieved before the abort is still in the ledger.
    expect(results.ledger.some((line) => line.label === "Objectives")).toBe(true);
  });

  it("produces an explained outcome when contact is lost", () => {
    const sortie = mission();
    sortie.launch();
    sortie.skipCarrier();
    const results = sortie.abort("lost-contact");
    expect(results.outcome).toBe("lost-contact");
    expect(results.summary).toMatch(/Contact with the machine was lost/);
  });

  it("keeps one set of results however many times it is asked", () => {
    const sortie = mission();
    sortie.launch();
    sortie.skipCarrier();
    const first = sortie.complete();
    const second = sortie.complete();
    expect(second).toBe(first);
  });

  it("round-trips through a snapshot", () => {
    const sortie = mission([
      { id: "objective.defend", stage: 0 },
      { id: "objective.salvage", stage: 1 },
    ]);
    sortie.launch();
    sortie.skipCarrier();
    sortie.report({ ...emptyProgress(), kaijuTotal: 1, kaijuDown: 1, cityIntegrity: 0.9 });
    const snapshot = sortie.snapshot();
    expect(validateMissionSnapshot(snapshot)).toEqual([]);

    const restored = mission([
      { id: "objective.defend", stage: 0 },
      { id: "objective.salvage", stage: 1 },
    ]);
    restored.restore(snapshot);
    expect(restored.phase).toBe(snapshot.phase);
    expect(restored.objectives.map((entry) => entry.state)).toEqual(
      sortie.objectives.map((entry) => entry.state),
    );
  });

  it("refuses a snapshot that is not one", () => {
    expect(validateMissionSnapshot(null).length).toBeGreaterThan(0);
    expect(validateMissionSnapshot({ schemaVersion: 99 }).length).toBeGreaterThan(0);
    expect(
      validateMissionSnapshot({ schemaVersion: 1, id: "x", phase: "melted", objectives: [], plan: {} }).join(
        " ",
      ),
    ).toMatch(/unknown mission phase/);
  });
});
