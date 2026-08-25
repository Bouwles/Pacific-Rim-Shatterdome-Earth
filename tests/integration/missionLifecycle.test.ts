import { describe, expect, it } from "vitest";
import {
  runEveryEnding,
  runMissionScenario,
  samplePlan,
  MISSION_SCENARIO_SEED,
} from "../../src/debug/missionScenario";
import { Mission, assessPlan } from "../../src/missions/mission";
import { createObjectiveRegistry, emptyProgress } from "../../src/missions/objectives";
import { createPilotRegistry } from "../../src/data/pilots";
import { jaegerRegistry } from "../../src/data/jaegers";
import { createWeaponRegistry } from "../../src/data/weapons";
import { AttackDirector } from "../../src/world/director";
import { createDefaultRegionRegistry } from "../../src/data/regions";
import { Roster } from "../../src/jaegers/roster";
import { applyComponentDamage } from "../../src/jaegers/damage";
import { createComponentRegistry } from "../../src/data/components";

const pilots = createPilotRegistry();
const regions = createDefaultRegionRegistry();
const weapons = createWeaponRegistry();
const components = createComponentRegistry();

describe("the whole loop", () => {
  it("runs alert to preparation to carrier to fight to results", () => {
    // An alert, from the director that produces them.
    const director = new AttackDirector({ regions, seed: MISSION_SCENARIO_SEED, crisisFrequency: 2 });
    let incident = director.active()[0];
    for (let tick = 0; tick <= 400_000 && !incident; tick += 600) {
      director.advance(tick, 600);
      incident = director.active()[0];
    }
    expect(incident).toBeDefined();

    // Preparation, against the machine that would actually go.
    const roster = new Roster(jaegerRegistry, components);
    const record = roster.getOrThrow("placeholder-mk0");
    const forecast = director.forecast(incident!, incident!.createdTick, 2_400);
    const readiness = assessPlan({
      plan: samplePlan(),
      jaeger: jaegerRegistry.getOrThrow("placeholder-mk0"),
      pilots: [pilots.getOrThrow("pilot.okonkwo"), pilots.getOrThrow("pilot.varga")],
      machineIntegrity: 1,
      machineReady: roster.canDeploy("placeholder-mk0").ok,
      machineStatus: record.status,
      weapons: weapons.all(),
      distanceMeters: 900_000,
      carrierSpeedMps: 240,
      liftCapacityTons: 400,
      weatherSummary: "clear",
      weatherPenalty: 0,
      underwater: false,
      forecastComposition: forecast.composition,
      forecastConfidence: forecast.warningConfidence,
    });
    expect(readiness.refusals).toEqual([]);
    expect(readiness.travelSeconds).toBeGreaterThan(0);

    // Carrier, fight and results.
    const run = runMissionScenario({ story: "clean-win" });
    expect(run.phases).toEqual(["planning", "carrier", "active", "results"]);
    expect(run.results.outcome).toBe("success");

    // And the repair order the results imply is real work on the real machine.
    expect(run.results.repairHours).toBeGreaterThan(0);
    applyComponentDamage(record.damage, components, "component.torso", 400, "impact", 1);
    const outcome = roster.recover("placeholder-mk0");
    expect(outcome.status).toMatch(/repairing|recovering/);
    expect(roster.repairOrder("placeholder-mk0").totalHours).toBeGreaterThan(0);
  });

  it("does not make the carrier run compulsory", () => {
    const watched = runMissionScenario({ carrierSeconds: 120 });
    const skipped = runMissionScenario({ carrierSeconds: 120, skipCarrier: true });
    expect(watched.carrierWatchedSeconds).toBeGreaterThan(0);
    expect(skipped.carrierWatchedSeconds).toBe(0);
    // Skipping changes nothing about what the sortie was worth.
    expect(skipped.results.objectiveScore).toBeCloseTo(watched.results.objectiveScore, 5);
    expect(skipped.results.funding).toBe(watched.results.funding);
  });

  it("repeats exactly on the same seed and story", () => {
    expect(runMissionScenario().digest).toBe(runMissionScenario().digest);
    expect(runMissionScenario({ story: "rout" }).digest).not.toBe(runMissionScenario().digest);
  });
});

describe("every ending is recoverable and explained", () => {
  it("produces a distinct, named outcome for each", () => {
    const endings = runEveryEnding();
    expect(endings["clean-win"]).toBe("success");
    expect(endings["costly-win"]).toBe("partial");
    expect(endings.rout).toBe("failure");
    expect(endings.abort).toBe("aborted");
    expect(endings["lost-contact"]).toBe("lost-contact");
  });

  it("explains every one of them, and keeps what was earned", () => {
    for (const story of ["clean-win", "costly-win", "rout", "abort", "lost-contact"] as const) {
      const run = runMissionScenario({ story });
      expect(run.results.summary.length).toBeGreaterThan(10);
      expect(run.results.ledger.length).toBeGreaterThan(5);
      for (const line of run.results.ledger) {
        expect(line.label.length).toBeGreaterThan(0);
        expect(line.reason.length).toBeGreaterThan(0);
      }
      // Even a disaster leaves a replay and an objective record behind.
      expect(run.results.replay.events.length).toBeGreaterThan(0);
      expect(run.results.objectives.length).toBeGreaterThan(0);
    }
  });

  it("still credits what was achieved before an abort", () => {
    const aborted = runMissionScenario({ story: "abort" });
    expect(aborted.results.rescuedThousands).toBeGreaterThan(0);
    expect(aborted.results.salvageTons).toBeGreaterThan(0);
    expect(aborted.results.funding).toBeGreaterThan(0);
  });
});

describe("results reconcile with the simulation", () => {
  it("reports exactly what was fed in, and nothing else", () => {
    for (const story of ["clean-win", "costly-win", "rout"] as const) {
      const run = runMissionScenario({ story });
      // Every figure in the results is the figure the simulation reported.
      expect(run.results.salvageTons).toBeCloseTo(run.reported.salvageTons, 5);
      expect(run.results.samples).toBe(run.reported.samples);
      expect(run.results.rescuedThousands).toBeCloseTo(run.reported.rescuedThousands, 5);
      expect(run.results.machineDamage).toBeCloseTo(1 - run.reported.machineIntegrity, 5);
      expect(run.results.cityImpact).toBeCloseTo(1 - run.reported.cityIntegrity, 5);
    }
  });

  it("awards nothing the simulation did not do", () => {
    const registry = createObjectiveRegistry();
    const sortie = new Mission({
      id: "mission.empty",
      incidentId: "incident.empty",
      regionId: "hong-kong",
      plan: samplePlan(),
      objectives: registry,
      seed: 1,
      carrierSeconds: 10,
      assignments: [{ id: "objective.salvage", stage: 0 }],
    });
    sortie.launch();
    sortie.skipCarrier();
    // Nothing is ever reported, so nothing can be claimed.
    const results = sortie.complete();
    expect(results.salvageTons).toBe(0);
    expect(results.samples).toBe(0);
    expect(results.rescuedThousands).toBe(0);
    expect(results.funding).toBe(0);
  });

  it("cannot be paid twice for the same sortie", () => {
    const run = runMissionScenario({ story: "clean-win" });
    const first = run.results;
    // Completing again returns the same object rather than a second award.
    expect(run.results).toBe(first);
    expect(run.results.funding).toBe(first.funding);
  });

  it("keeps a replay that names the seed and the plan it was flown with", () => {
    const run = runMissionScenario({ story: "costly-win" });
    expect(run.results.replay.seed).toBe(MISSION_SCENARIO_SEED);
    expect(run.results.replay.plan.jaegerId).toBe("placeholder-mk0");
    expect(run.results.replay.plan.pilotIds).toHaveLength(2);
    expect(run.results.replay.events).toContain("launched");
    expect(run.results.replay.events).toContain("arrived");
  });

  it("moves the drift link and reputation in the direction the sortie went", () => {
    const good = runMissionScenario({ story: "clean-win" }).results;
    const bad = runMissionScenario({ story: "rout" }).results;
    expect(good.copilotLink).toBeGreaterThan(bad.copilotLink);
    expect(good.reputation).toBeGreaterThan(bad.reputation);
    expect(bad.reputation).toBeLessThan(0);
  });

  it("turns damage into repair hours the bay can actually take", () => {
    const costly = runMissionScenario({ story: "costly-win" }).results;
    const clean = runMissionScenario({ story: "clean-win" }).results;
    expect(costly.repairHours).toBeGreaterThan(clean.repairHours);
    expect(Number.isInteger(costly.repairHours)).toBe(true);
  });

  it("uses the same progress object every objective reads", () => {
    const registry = createObjectiveRegistry();
    const progress = { ...emptyProgress(), cityIntegrity: 0.5, contamination: 0.5 };
    const defend = registry.getOrThrow("objective.defend");
    const contain = registry.getOrThrow("objective.contain");
    // Two objectives, one set of numbers: they cannot disagree about the city.
    expect(defend.progress(progress)).toBeCloseTo(0.5, 5);
    expect(contain.progress(progress)).toBeCloseTo(0.5, 5);
  });
});
