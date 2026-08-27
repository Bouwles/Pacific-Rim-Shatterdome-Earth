import { describe, expect, it } from "vitest";
import {
  AI_AGGRESSION,
  CITY_DAMAGE_PRESETS,
  SANDBOX_SCHEMA_VERSION,
  WATER_STATES,
  defaultScenario,
  liveRegistries,
  scenarioIsPlayable,
  totalCombatants,
  validateScenario,
} from "../../src/sandbox/scenario";
import {
  SANDBOX_RULE_IDS,
  SLOW_MOTION_SCALE,
  activeRules,
  adjustmentsFor,
  defaultRules,
  isFairRun,
  normaliseRules,
  rulesByPanel,
  validateRules,
} from "../../src/sandbox/rules";

describe("a scenario", () => {
  it("starts as something that will actually run", () => {
    expect(validateScenario(defaultScenario())).toEqual([]);
    expect(scenarioIsPlayable(defaultScenario())).toBe(true);
  });

  it("offers every knob the sandbox is supposed to have", () => {
    const scenario = defaultScenario();
    expect(scenario.regionId).toBeTruthy();
    expect(scenario.dayFraction).toBeGreaterThanOrEqual(0);
    expect(WATER_STATES).toContain(scenario.water);
    expect(CITY_DAMAGE_PRESETS).toContain(scenario.cityDamage);
    expect(AI_AGGRESSION).toContain(scenario.aggression);
    expect(scenario.squad.length).toBeGreaterThan(0);
    expect(totalCombatants(scenario)).toBeGreaterThan(0);
  });

  it("spawns anything the build has, without a source edit", () => {
    const registries = liveRegistries();
    expect(registries.chassisIds.size).toBeGreaterThan(2);
    expect(registries.kaijuIds.size).toBeGreaterThan(2);
    // Every chassis the game knows is namable in a scenario, which is what
    // "spawn any unlocked unit" means in a mode with no unlocks.
    for (const chassisId of registries.chassisIds) {
      expect(validateScenario(defaultScenario({ squad: [{ chassisId, pilotIds: [] }] }))).toEqual([]);
    }
  });

  it("names the thing it does not have, rather than failing vaguely", () => {
    const problems = validateScenario(defaultScenario({ regionId: "atlantis" }));
    expect(problems.join(" ")).toMatch(/no region called "atlantis"/);
  });

  it("refuses a creature this build has never heard of", () => {
    const scenario = defaultScenario({
      waves: [{ combatants: [{ kaijuId: "kaiju.from-a-mod", mutationIds: [] }], delaySeconds: 0 }],
    });
    expect(validateScenario(scenario).join(" ")).toMatch(/no creature called/);
  });

  it("refuses a scenario written by another version, and says so", () => {
    const scenario = { ...defaultScenario(), schemaVersion: SANDBOX_SCHEMA_VERSION + 1 };
    expect(validateScenario(scenario).join(" ")).toMatch(/different version of the game/);
  });

  it("refuses two mutations that cannot share a creature", () => {
    const registries = liveRegistries();
    const all = registries.mutations.all();
    // Compatibility is declared by an explicit exclusion, not inferred from the
    // kind, so the pair has to come from the catalogue's own exclusions.
    const excluding = all.find((mutation) => mutation.excludes.length > 0);
    const clashing = excluding ? [excluding.id, excluding.excludes[0]!] : undefined;
    // The catalogue has at least one incompatible pair, or this rule is untested.
    expect(clashing).toBeDefined();
    const scenario = defaultScenario({
      waves: [
        {
          combatants: [{ kaijuId: "kaiju.biped-alpha", mutationIds: clashing! }],
          delaySeconds: 0,
        },
      ],
    });
    expect(validateScenario(scenario).join(" ")).toMatch(/cannot both be on the same creature/);
  });

  it("refuses more pilots than a conn-pod seats", () => {
    const scenario = defaultScenario({
      squad: [{ chassisId: "heavy-mk4", pilotIds: ["a", "b", "c"] }],
    });
    expect(validateScenario(scenario).join(" ")).toMatch(/conn-pod seats two/);
  });

  it("refuses a wave with nothing in it", () => {
    expect(
      validateScenario(defaultScenario({ waves: [{ combatants: [], delaySeconds: 0 }] })).join(" "),
    ).toMatch(/has nothing in it/);
  });
});

describe("combinations that cannot work", () => {
  it("refuses a surge somewhere too shallow, and says how deep it is", () => {
    const problems = validateScenario(defaultScenario({ regionId: "anchorage", water: "surge" }));
    expect(problems.join(" ")).toMatch(/surge needs water/);
    expect(problems.join(" ")).toMatch(/deeper shore or a lower tide/);
  });

  it("refuses damage to a city that is not there", () => {
    const problems = validateScenario(
      defaultScenario({ regionId: "pacific-breach", cityDamage: "levelled" }),
    );
    expect(problems.join(" ")).toMatch(/no city/);
  });

  it("refuses a rescue where there is nobody to rescue", () => {
    const problems = validateScenario(
      defaultScenario({ regionId: "pacific-breach", objective: "objective.rescue" }),
    );
    expect(problems.join(" ")).toMatch(/nobody at the Breach/);
  });

  it("refuses an escort with nothing to escort", () => {
    const problems = validateScenario(defaultScenario({ objective: "objective.escort" }));
    expect(problems.join(" ")).toMatch(/Add a second machine/);
  });

  it("refuses snow in the tropics, and names the place", () => {
    const problems = validateScenario(defaultScenario({ regionId: "manila", weather: "snow" }));
    expect(problems.join(" ")).toMatch(/does not snow in Manila/);
  });

  it("allows the same settings where they do make sense", () => {
    expect(validateScenario(defaultScenario({ regionId: "vladivostok", weather: "snow" }))).toEqual([]);
    expect(
      validateScenario(
        defaultScenario({
          objective: "objective.escort",
          squad: [
            { chassisId: "heavy-mk4", pilotIds: [] },
            { chassisId: "agile-mk5", pilotIds: [] },
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe("the cheats", () => {
  it("starts with everything off, which is an ordinary fight", () => {
    const rules = defaultRules();
    expect(SANDBOX_RULE_IDS.every((id) => rules[id] === false)).toBe(true);
    expect(activeRules(rules)).toEqual([]);
    expect(isFairRun(rules)).toBe(true);
  });

  it("gives every rule a name and a sentence saying what it does", () => {
    for (const rule of [...rulesByPanel(false), ...rulesByPanel(true)]) {
      expect(rule.displayName.length).toBeGreaterThan(2);
      expect(rule.effect.length).toBeGreaterThan(10);
    }
  });

  it("keeps debug visualisation behind the advanced panel", () => {
    expect(rulesByPanel(true).map((rule) => rule.id)).toEqual(["debugVisuals"]);
    expect(rulesByPanel(false).map((rule) => rule.id)).not.toContain("debugVisuals");
  });

  it("turns each toggle into a number the simulation can read", () => {
    expect(adjustmentsFor({ ...defaultRules(), freeCosts: true }).costScale).toBe(0);
    expect(adjustmentsFor({ ...defaultRules(), noCooldowns: true }).cooldownScale).toBe(0);
    expect(adjustmentsFor({ ...defaultRules(), noDamageTaken: true }).incomingDamageScale).toBe(0);
    expect(adjustmentsFor({ ...defaultRules(), infiniteAmmunition: true }).ammunitionUseScale).toBe(0);
    expect(adjustmentsFor({ ...defaultRules(), stableDrift: true }).driftInstabilityScale).toBe(0);
    expect(adjustmentsFor({ ...defaultRules(), calmEnemies: true }).aggressionScale).toBe(0);
    expect(adjustmentsFor({ ...defaultRules(), persistentDestruction: true }).keepRubble).toBe(true);
    expect(adjustmentsFor({ ...defaultRules(), slowMotion: true }).timeScale).toBe(SLOW_MOTION_SCALE);
    expect(adjustmentsFor({ ...defaultRules(), debugVisuals: true }).showDebugVisuals).toBe(true);
  });

  it("leaves everything alone when nothing is switched on", () => {
    const adjust = adjustmentsFor(defaultRules());
    expect(adjust.costScale).toBe(1);
    expect(adjust.cooldownScale).toBe(1);
    expect(adjust.incomingDamageScale).toBe(1);
    expect(adjust.timeScale).toBe(1);
    expect(adjust.keepRubble).toBe(false);
  });

  it("returns a fresh object every time, so nothing accumulates", () => {
    const first = adjustmentsFor(defaultRules());
    const second = adjustmentsFor({ ...defaultRules(), slowMotion: true });
    expect(first.timeScale).toBe(1);
    expect(second.timeScale).toBe(SLOW_MOTION_SCALE);
    expect(adjustmentsFor(defaultRules()).timeScale).toBe(1);
  });

  it("marks a run as unfair once anything that changes the fight is on", () => {
    expect(isFairRun({ ...defaultRules(), noDamageTaken: true })).toBe(false);
    expect(isFairRun({ ...defaultRules(), freeCosts: true })).toBe(false);
    // Watching in slow motion or with debug drawing on does not change the fight.
    expect(isFairRun({ ...defaultRules(), slowMotion: true })).toBe(true);
    expect(isFairRun({ ...defaultRules(), debugVisuals: true })).toBe(true);
  });

  it("fills in a rule an older file did not have rather than refusing it", () => {
    const rules = normaliseRules({ slowMotion: true });
    expect(rules.slowMotion).toBe(true);
    expect(rules.freeCosts).toBe(false);
    expect(validateRules(rules)).toEqual([]);
  });

  it("refuses rules that are not on or off", () => {
    expect(validateRules({ ...defaultRules(), freeCosts: "yes" }).length).toBeGreaterThan(0);
    expect(validateRules(null).length).toBeGreaterThan(0);
  });
});
