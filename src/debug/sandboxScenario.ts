import {
  CombatArena,
  combatProfileFor,
  jaegerLayout,
  jaegerZones,
  kaijuCombatProfile,
  kaijuZones,
  type FighterSpec,
} from "../combat/arena";
import { createMoveRegistry } from "../data/moves";
import { jaegerRegistry } from "../data/jaegers";
import { createKaijuRegistry } from "../data/kaiju";
import { adjustmentsFor, defaultRules, type SandboxRules } from "../sandbox/rules";
import { defaultScenario, validateScenario, type SandboxScenario } from "../sandbox/scenario";

/**
 * A sandbox run, fought headlessly.
 *
 * What it exists to prove is the pair of claims the milestone rests on. The
 * first is that the toggles do what they say: invulnerability means no damage
 * taken, infinite ammunition means a magazine that never goes down, slow motion
 * means a third of the ticks in the same wall time. The second, and the one that
 * matters more, is that turning any of them on leaves the *next* run exactly
 * where it would have been, because a rule set is an overlay passed in rather
 * than a setting written anywhere.
 *
 * Deterministic: fixed step, seeded arena, no clock and no RNG of its own.
 */

/** Seconds one arena tick stands for, for the slow-motion arithmetic. */
export const SANDBOX_TICK_SECONDS = 1 / 20;

export interface SandboxRunResult {
  readonly scenarioId: string;
  readonly ticks: number;
  /** Seconds of fight represented, which slow motion changes and nothing else does. */
  readonly seconds: number;
  readonly damageDealtToCreature: number;
  readonly damageTakenByMachine: number;
  readonly roundsSpent: number;
  readonly creatureDefeated: boolean;
  readonly digest: number;
  /** What was switched on, so a result is never read without its conditions. */
  readonly rulesUsed: readonly string[];
}

function buildArena(scenario: SandboxScenario): CombatArena {
  const kaiju = createKaijuRegistry();
  const fighters: FighterSpec[] = [];

  scenario.squad.forEach((machine, index) => {
    const chassis = jaegerRegistry.getOrThrow(machine.chassisId);
    fighters.push({
      id: index === 0 ? "jaeger" : `jaeger.${index}`,
      kind: "jaeger",
      displayName: chassis.name,
      heightMeters: chassis.locomotion.heightMeters,
      profile: combatProfileFor(chassis),
      pose: { east: index * 40, north: 0, up: 0, yawDeg: 0 },
      zones: jaegerZones(chassis),
      layout: jaegerLayout(chassis),
      finisherThreshold: 0.2,
    });
  });

  // Only the first wave is placed here. Later waves are a scheduling concern
  // and belong to the run rather than to the arena's construction.
  const first = scenario.waves[0];
  first?.combatants.forEach((combatant, index) => {
    const creature = kaiju.getOrThrow(combatant.kaijuId);
    fighters.push({
      id: index === 0 ? "kaiju" : `kaiju.${index}`,
      kind: "kaiju",
      displayName: creature.name,
      heightMeters: creature.heightMeters,
      profile: kaijuCombatProfile(creature),
      pose: { east: 18 + index * 30, north: 0, up: 0, yawDeg: 180 },
      zones: kaijuZones(creature),
      kaiju: creature,
      finisherThreshold: creature.finisherThreshold,
    });
  });

  return new CombatArena({ moves: createMoveRegistry(), seed: scenario.seed, fighters });
}

/**
 * Runs one scenario under one rule set.
 *
 * The rules are read here, at the point a number is used, and written nowhere.
 * That is the whole mechanism: there is no global to restore afterwards because
 * nothing was ever changed.
 */
export function runSandbox(
  scenario: SandboxScenario = defaultScenario(),
  rules: SandboxRules = defaultRules(),
  ticks = 160,
): SandboxRunResult {
  const problems = validateScenario(scenario);
  if (problems.length > 0) {
    // Refused with the reason rather than loading a half-built fight, which is
    // the acceptance item about unsupported combinations.
    throw new Error(`This scenario will not run: ${problems.join(" ")}`);
  }

  const arena = buildArena(scenario);
  const adjust = adjustmentsFor(rules);
  const attacks = ["melee.light.jab", "melee.light.cross", "melee.heavy.smash.forward"];

  let dealt = 0;
  let taken = 0;
  let roundsSpent = 0;
  let stepped = 0;

  // Slow motion runs fewer ticks in the same wall time, which is exactly what it
  // is: the same fight, sampled more finely, not a different fight.
  const budget = Math.max(1, Math.round(ticks * adjust.timeScale));

  for (let tick = 0; tick < budget; tick += 1) {
    if (tick % 8 === 0) {
      const move = attacks[(tick / 8) % attacks.length];
      if (move) {
        const request = arena.request("jaeger", move);
        if (request.ok) arena.press("jaeger", move);
      }
    }
    // The creature hits back, unless the rules say it is not trying.
    if (adjust.aggressionScale > 0 && tick % 11 === 5) {
      const request = arena.request("kaiju", "kaiju.claw.swipe");
      if (request.ok) arena.press("kaiju", "kaiju.claw.swipe");
    }

    for (const event of arena.step()) {
      if (event.damage <= 0) continue;
      if (event.targetId === "kaiju") dealt += event.damage;
      if (event.targetId === "jaeger") {
        // Invulnerability is applied where the damage is counted rather than by
        // editing the machine, so the hit still lands, still reacts and still
        // reads as a hit. It simply costs nothing.
        taken += event.damage * adjust.incomingDamageScale;
      }
    }
    stepped += 1;
  }

  // Ammunition is the same shape of rule: spent, then scaled by what the rules
  // say a round costs.
  const view = arena.snapshot().fighters.find((fighter) => fighter.id === "jaeger");
  for (const weapon of view?.weapons ?? []) {
    roundsSpent += (weapon.magazineSize - weapon.magazine) * adjust.ammunitionUseScale;
  }

  const creature = arena.snapshot().fighters.find((fighter) => fighter.id === "kaiju");
  return {
    scenarioId: scenario.id,
    ticks: stepped,
    seconds: Math.round(stepped * SANDBOX_TICK_SECONDS * 100) / 100,
    damageDealtToCreature: Math.round(dealt * 100) / 100,
    damageTakenByMachine: Math.round(taken * 100) / 100,
    roundsSpent: Math.round(roundsSpent),
    creatureDefeated: creature?.defeated === true,
    digest: arena.digest(),
    rulesUsed: Object.entries(rules)
      .filter(([, on]) => on)
      .map(([id]) => id),
  };
}

export interface RuleIsolationReport {
  /** A straight fight, before anything was touched. */
  readonly before: SandboxRunResult;
  /** The same fight with every rule on. */
  readonly cheated: SandboxRunResult;
  /** The straight fight again, after the cheated one. */
  readonly after: SandboxRunResult;
  /** True when the two straight fights are identical in every number. */
  readonly isolated: boolean;
  /** True when the rules visibly did something, so the run proves anything. */
  readonly rulesDidSomething: boolean;
}

/**
 * The failure mode this milestone names by name.
 *
 * A sandbox toggle that mutated global configuration would show up here as a
 * third run that does not match the first. Running the straight fight, then the
 * cheated one, then the straight fight again is the cheapest possible way to
 * catch it, and it catches it wherever the mutation happened to live.
 */
export function checkRuleIsolation(): RuleIsolationReport {
  const scenario = defaultScenario({ id: "sandbox.isolation" });
  const everything = Object.fromEntries(Object.keys(defaultRules()).map((id) => [id, true])) as SandboxRules;

  const before = runSandbox(scenario, defaultRules());
  const cheated = runSandbox(scenario, everything);
  const after = runSandbox(scenario, defaultRules());

  const isolated =
    before.damageDealtToCreature === after.damageDealtToCreature &&
    before.damageTakenByMachine === after.damageTakenByMachine &&
    before.roundsSpent === after.roundsSpent &&
    before.digest === after.digest &&
    before.ticks === after.ticks;

  const rulesDidSomething =
    cheated.damageTakenByMachine < before.damageTakenByMachine || cheated.ticks < before.ticks;

  return { before, cheated, after, isolated, rulesDidSomething };
}
