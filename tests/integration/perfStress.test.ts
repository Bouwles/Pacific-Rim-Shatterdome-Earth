import { describe, expect, it } from "vitest";
import {
  STRESS_SCENES,
  createStressRegistry,
  runFourCombatants,
  runHeadlessStress,
  runMaxDestruction,
  runProjectileBarrage,
  validateStressScene,
} from "../../src/debug/perfScenario";

describe("the stress catalogue", () => {
  it("names all seven scenes the budgets are promised against", () => {
    expect(createStressRegistry().all()).toHaveLength(7);
    const ids = STRESS_SCENES.map((scene) => scene.id);
    for (const wanted of [
      "stress.dense-city",
      "stress.storm-ocean",
      "stress.four-combatants",
      "stress.projectile-barrage",
      "stress.max-destruction",
      "stress.roster-gallery",
      "stress.rapid-traversal",
    ]) {
      expect(ids).toContain(wanted);
    }
  });

  it("says what every scene saturates, and validates the lot", () => {
    for (const scene of STRESS_SCENES) expect(validateStressScene(scene)).toEqual([]);
  });

  it("splits drivers honestly: simulation headless, renderer in the browser", () => {
    const headless = STRESS_SCENES.filter((scene) => scene.driver === "headless");
    expect(headless.map((scene) => scene.id).sort()).toEqual([
      "stress.four-combatants",
      "stress.max-destruction",
      "stress.projectile-barrage",
    ]);
  });
});

describe("the headless stress scenes", () => {
  it("four combatants produce a real fight with nobody vanishing", () => {
    const result = runFourCombatants();
    expect(result.events).toBeGreaterThan(100);
    expect(result.violations).toEqual([]);
  });

  it("the barrage saturates the pool without ever exceeding it", () => {
    const result = runProjectileBarrage();
    expect(result.events).toBeGreaterThan(1_000);
    expect(result.violations).toEqual([]);
  });

  it("maximum destruction defeats the creature and reports every event", () => {
    const result = runMaxDestruction();
    expect(result.events).toBeGreaterThan(100);
    expect(result.violations).toEqual([]);
  });

  it("runs all three with a valid budget contract", () => {
    const out = runHeadlessStress();
    expect(out.budgetErrors).toEqual([]);
    expect(out.results).toHaveLength(3);
    for (const result of out.results) expect(result.violations).toEqual([]);
  });

  it("is deterministic: the same scene twice agrees to the digest", () => {
    expect(runFourCombatants()).toEqual(runFourCombatants());
    expect(runProjectileBarrage()).toEqual(runProjectileBarrage());
    expect(runMaxDestruction()).toEqual(runMaxDestruction());
  });
});
