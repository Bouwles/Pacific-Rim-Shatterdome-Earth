import { createKaijuRegistry, type KaijuDefinition } from "../data/kaiju";
import { Creature, type CreatureDebug, type CreatureInputs } from "../kaiju/creature";
import { SWIM_DEPTH_METERS, type NavigationQuery } from "../kaiju/navigation";
import type { SenseStimulus } from "../kaiju/senses";

/**
 * Three creatures, one objective, run headlessly.
 *
 * The point this proves is the whole reason the framework exists: three
 * archetypes given the same mission, the same map and the same defender behave
 * visibly differently, and the difference comes out of their data rather than
 * out of anything written per creature.
 *
 * The map is deliberately awkward: a bay across the middle, a ridge on one side
 * and a levelled block in the way, so a swimmer, a digger and a walker each have
 * a reason to solve it their own way.
 */

export const KAIJU_SCENARIO_SEED = 20260824;
/** Where the thing they all came for stands. */
export const OBJECTIVE = { east: 0, north: 1_600 } as const;

export interface KaijuScenarioOptions {
  readonly seed?: number;
  readonly ticks?: number;
  /** Machine position, which is what they can see, hear and feel. */
  readonly defender?: { readonly east: number; readonly north: number };
  /** Creatures to run. Defaults to the three shipped archetypes. */
  readonly kaijuIds?: readonly string[];
}

export interface KaijuRunResult {
  readonly kaijuId: string;
  readonly displayName: string;
  readonly family: string;
  /** Every goal it held, in order, without repeats. This is its tactic. */
  readonly goalTrail: readonly string[];
  /** Every navigation answer it used. */
  readonly navOutcomes: readonly string[];
  /** Media it travelled through. */
  readonly media: readonly string[];
  readonly metresFromObjective: number;
  readonly reachedObjective: boolean;
  readonly contactsSeen: number;
  readonly finalDebug: CreatureDebug;
}

export interface KaijuScenarioResult {
  readonly runs: readonly KaijuRunResult[];
  /** Digest over every trail, so two identical runs can be compared. */
  readonly digest: number;
}

/**
 * The map.
 *
 * A bay from north 600 to 1,100 across the middle, a ridge to the east that
 * only a climber gets over, and a levelled block west of centre that only
 * something ignoring rubble walks through.
 */
export function scenarioWorld(): NavigationQuery {
  return {
    groundHeight: (east, north) => {
      if (Math.abs(north) > 4_000 || Math.abs(east) > 4_000) return null;
      // A ridge on the eastern side, too steep for anything that cannot climb.
      if (east > 400 && east < 900) return 220;
      return 0;
    },
    waterDepth: (_east, north) => (north > 600 && north < 1_100 ? SWIM_DEPTH_METERS + 12 : 0),
    isPassable: (east, north) => !(east < -200 && east > -700 && north > 200 && north < 700),
    climbableHeight: (east) => (east > 400 && east < 900 ? 220 : 0),
  };
}

/** Runs one creature at the objective and reports how it went about it. */
export function runKaiju(definition: KaijuDefinition, options: KaijuScenarioOptions = {}): KaijuRunResult {
  const world = scenarioWorld();
  const ticks = options.ticks ?? 900;
  const defender = options.defender ?? { east: 60, north: 240 };
  const creature = new Creature({
    definition,
    east: 0,
    north: -600,
    headingDeg: 0,
    seed: options.seed ?? KAIJU_SCENARIO_SEED,
  });

  const goalTrail: string[] = [];
  const navOutcomes: string[] = [];
  const media: string[] = [];
  const contacts = new Set<string>();
  let debug = creature.debug();

  for (let tick = 0; tick < ticks; tick += 1) {
    const stimuli: readonly SenseStimulus[] = [
      // The machine: seen, heard and felt, and the creature's own senses decide
      // which of those actually reaches it.
      { sourceId: "jaeger", east: defender.east, north: defender.north, strength: 1, kind: "sight" },
      { sourceId: "jaeger", east: defender.east, north: defender.north, strength: 0.9, kind: "sound" },
      { sourceId: "jaeger", east: defender.east, north: defender.north, strength: 1.2, kind: "vibration" },
      // The objective, which broadcasts what it is at long range.
      { sourceId: "objective", east: OBJECTIVE.east, north: OBJECTIVE.north, strength: 1, kind: "objective" },
    ];

    const inputs: CreatureInputs = {
      stimuli,
      world,
      objective: OBJECTIVE,
      food: null,
      waterNearby: world.waterDepth(creature.east, creature.north + 200) >= SWIM_DEPTH_METERS,
      climbableNearby: world.climbableHeight(creature.east + 200, creature.north) > 0,
      // The bay is the obvious place to lie in wait on this map.
      hideSpot: { east: creature.east, north: 850 },
    };

    debug = creature.advance(1 / 6, inputs);
    if (goalTrail[goalTrail.length - 1] !== debug.goal) goalTrail.push(debug.goal);
    if (navOutcomes[navOutcomes.length - 1] !== debug.navOutcome) navOutcomes.push(debug.navOutcome);
    if (media[media.length - 1] !== debug.medium) media.push(debug.medium);
    for (const contact of debug.contacts) contacts.add(contact.sourceId);
  }

  const distance = Math.hypot(OBJECTIVE.east - creature.east, OBJECTIVE.north - creature.north);
  return {
    kaijuId: definition.id,
    displayName: definition.name,
    family: definition.locomotion,
    goalTrail,
    navOutcomes,
    media,
    metresFromObjective: Math.round(distance),
    reachedObjective: distance < 200,
    contactsSeen: contacts.size,
    finalDebug: debug,
  };
}

export function runKaijuScenario(options: KaijuScenarioOptions = {}): KaijuScenarioResult {
  const registry = createKaijuRegistry();
  const ids = options.kaijuIds ?? ["kaiju.biped-alpha", "kaiju.serpent-delta", "kaiju.burrower-sigma"];
  const runs = ids.map((id) => runKaiju(registry.getOrThrow(id), options));
  const text = runs
    .map((run) => `${run.kaijuId}:${run.goalTrail.join(">")}:${run.navOutcomes.join(">")}`)
    .join("|");
  return { runs, digest: digestOf(text) };
}

function digestOf(text: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
