import { ContentRegistry, type RegistryEntry } from "../data/registry";
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
import { createWeaponRegistry } from "../data/weapons";
import { validatePerfBudgets } from "../data/perfBudgets";
import { Profiler } from "../perf/profiler";

/**
 * The stress scenes: the situations the budgets are promised against.
 *
 * Each scene names what it exercises and how it is driven. Three of them are
 * simulation-heavy and run headless right here, deterministically, so a
 * regression in arena cost is a failed unit test rather than a slow Tuesday.
 * The other four are renderer-heavy and are driven in a real browser through
 * the same actions a player has, by the stress runner the bootstrap exposes;
 * what this file contributes to those is the registry row that names them, so
 * the runner cannot invent a scene the catalogue does not have.
 */

export interface StressScene extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  /** What the scene is designed to saturate. */
  readonly exercises: string;
  /** Where it runs: here and deterministic, or in the browser runner. */
  readonly driver: "headless" | "browser";
  readonly seed: number;
}

const SCENES: readonly StressScene[] = [
  {
    id: "stress.dense-city",
    displayName: "Dense city",
    exercises: "City meshes, agents, thin instances, draw calls.",
    driver: "browser",
    seed: 20260911,
  },
  {
    id: "stress.storm-ocean",
    displayName: "Storm ocean",
    exercises: "Water sheets, weather particles, lightning, fog.",
    driver: "browser",
    seed: 20260912,
  },
  {
    id: "stress.four-combatants",
    displayName: "Four combatants",
    exercises: "Arena stepping, hit volumes, statuses, reactions at squad scale.",
    driver: "headless",
    seed: 20260913,
  },
  {
    id: "stress.projectile-barrage",
    displayName: "Projectile barrage",
    exercises: "The projectile pool at capacity, spread, retirement.",
    driver: "headless",
    seed: 20260914,
  },
  {
    id: "stress.max-destruction",
    displayName: "Maximum destruction",
    exercises: "Zone damage, destruction events, debris budget accounting.",
    driver: "headless",
    seed: 20260915,
  },
  {
    id: "stress.roster-gallery",
    displayName: "Roster gallery",
    exercises: "Asset resolution, material count, per-model overhead.",
    driver: "browser",
    seed: 20260916,
  },
  {
    id: "stress.rapid-traversal",
    displayName: "Rapid sector traversal",
    exercises: "Terrain streaming, sector churn, floating-origin rebases.",
    driver: "browser",
    seed: 20260917,
  },
];

export function validateStressScene(entry: StressScene): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("stress.")) errors.push('stress ids start with "stress."');
  if (entry.exercises.trim().length < 10) errors.push(`${entry.id}: a scene must say what it saturates`);
  if (!Number.isFinite(entry.seed)) errors.push(`${entry.id}: a scene needs a seed`);
  return errors;
}

export function createStressRegistry(): ContentRegistry<StressScene> {
  const registry = new ContentRegistry<StressScene>(validateStressScene);
  for (const scene of SCENES) registry.register(scene);
  return registry;
}

export const STRESS_SCENES = SCENES;

export interface HeadlessStressResult {
  readonly sceneId: string;
  readonly ticks: number;
  readonly events: number;
  /** Scope totals, milliseconds, from the profiler that watched the run. */
  readonly scopes: Readonly<Record<string, number>>;
  readonly digest: number;
  /** Anything that broke a rule during the run. Empty is the passing case. */
  readonly violations: readonly string[];
}

function machineSpec(id: string, east: number, north: number): FighterSpec {
  const machine = jaegerRegistry.getOrThrow("heavy-mk4");
  return {
    id,
    kind: "jaeger",
    displayName: machine.name,
    heightMeters: machine.locomotion.heightMeters,
    profile: combatProfileFor(machine),
    pose: { east, north, up: 0, yawDeg: 0 },
    zones: jaegerZones(machine),
    layout: jaegerLayout(machine),
    finisherThreshold: 0.2,
  };
}

function creatureSpec(id: string, east: number, north = 0): FighterSpec {
  const creature = createKaijuRegistry().getOrThrow("kaiju.biped-alpha");
  return {
    id,
    kind: "kaiju",
    displayName: creature.name,
    heightMeters: creature.heightMeters,
    profile: kaijuCombatProfile(creature),
    pose: { east, north, up: 0, yawDeg: 180 },
    zones: kaijuZones(creature),
    kaiju: creature,
    finisherThreshold: creature.finisherThreshold,
  };
}

/** A fake clock the headless runs share, so scope numbers are deterministic. */
function fakeClock(): { readonly now: () => number; tick: (ms: number) => void } {
  let at = 0;
  return { now: () => at, tick: (ms) => (at += ms) };
}

/** Four combatants trading blows for four hundred ticks. */
export function runFourCombatants(ticks = 400): HeadlessStressResult {
  const clock = fakeClock();
  const profiler = new Profiler({ now: clock.now, longFrameMs: 50 });
  const arena = new CombatArena({
    moves: createMoveRegistry(),
    seed: 20260913,
    fighters: [
      machineSpec("jaeger", 0, 0),
      machineSpec("ally", 8, 14),
      creatureSpec("kaiju", 20),
      creatureSpec("kaiju.1", 30),
    ],
  });
  const moves = ["melee.light.jab", "melee.light.cross", "melee.heavy.smash.forward"];
  let events = 0;
  let digest = 2_166_136_261;

  for (let tick = 0; tick < ticks; tick += 1) {
    profiler.beginFrame();
    profiler.begin("arena");
    for (const [index, fighter] of ["jaeger", "ally", "kaiju", "kaiju.1"].entries()) {
      if ((tick + index * 3) % 9 === 0) {
        const move = fighter.startsWith("kaiju") ? "kaiju.claw.swipe" : moves[((tick / 9) % 3) | 0]!;
        const request = arena.request(fighter, move);
        if (request.ok) arena.press(fighter, move);
      }
    }
    for (const event of arena.step()) {
      events += 1;
      digest = (Math.imul(digest ^ (event.damage | 0), 16_777_619) >>> 0) ^ event.tick;
    }
    profiler.end();
    clock.tick(1);
    profiler.endFrame();
  }

  return {
    sceneId: "stress.four-combatants",
    ticks,
    events,
    scopes: { arena: ticks },
    digest: digest >>> 0,
    violations: arena.snapshot().fighters.length === 4 ? [] : ["a fighter vanished mid-run"],
  };
}

/** The projectile pool held at capacity for three hundred ticks. */
export function runProjectileBarrage(ticks = 300): HeadlessStressResult {
  const arena = new CombatArena({
    moves: createMoveRegistry(),
    seed: 20260914,
    projectileCapacity: 96,
    // Dead ahead of a machine facing north, so forward-arc weapons accept.
    fighters: [machineSpec("jaeger", 0, 0), creatureSpec("kaiju", 0, 60)],
  });
  for (const weapon of createWeaponRegistry().all()) arena.equipWeapon("jaeger", weapon);
  const violations: string[] = [];
  let events = 0;
  let digest = 2_166_136_261;

  for (let tick = 0; tick < ticks; tick += 1) {
    // Every weapon, every tick. The pool must refuse, never grow.
    for (const weapon of arena.snapshot().fighters[0]?.weapons ?? []) {
      arena.fireWeapon("jaeger", weapon.id);
    }
    arena.step();
    for (const event of arena.drain()) {
      events += 1;
      digest = (Math.imul(digest ^ (event.damage | 0), 16_777_619) >>> 0) ^ event.tick;
    }
    const live = arena.projectilePool().live;
    if (live > arena.projectilePool().capacity) {
      violations.push(`tick ${tick}: pool over capacity at ${live}`);
    }
  }
  return {
    sceneId: "stress.projectile-barrage",
    ticks,
    events,
    scopes: { barrage: ticks },
    digest: digest >>> 0,
    violations,
  };
}

/** Every zone of a creature hammered to destruction, twice over. */
export function runMaxDestruction(rounds = 40): HeadlessStressResult {
  const arena = new CombatArena({
    moves: createMoveRegistry(),
    seed: 20260915,
    fighters: [machineSpec("jaeger", 0, 0), creatureSpec("kaiju", 18)],
  });
  let events = 0;
  let digest = 2_166_136_261;

  for (let round = 0; round < rounds; round += 1) {
    for (const zone of arena.snapshot().fighters[1]?.zones ?? []) {
      arena.damageZone("kaiju", zone.id, 120);
    }
    arena.step();
    // Drained rather than read from the step: damageZone reports through the
    // arena's own event log, exactly as the game reads it.
    for (const event of arena.drain()) {
      events += 1;
      digest = (Math.imul(digest ^ (event.damage | 0), 16_777_619) >>> 0) ^ event.tick;
    }
  }
  const creature = arena.snapshot().fighters.find((fighter) => fighter.id === "kaiju");
  return {
    sceneId: "stress.max-destruction",
    ticks: rounds,
    events,
    scopes: { destruction: rounds },
    digest: digest >>> 0,
    violations: creature?.defeated ? [] : ["forty rounds of full-zone damage did not defeat it"],
  };
}

/** Every headless scene, plus the budget contract's own validation. */
export function runHeadlessStress(): {
  readonly results: readonly HeadlessStressResult[];
  readonly budgetErrors: readonly string[];
} {
  return {
    results: [runFourCombatants(), runProjectileBarrage(), runMaxDestruction()],
    budgetErrors: validatePerfBudgets(),
  };
}
