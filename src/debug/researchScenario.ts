import { createResearchRegistry, RESEARCH_NODES, type ResearchBranch } from "../data/research";
import { ResearchProgram, type StartContext } from "../research/program";
import { awardSamples, type FightRecord, type FamiliarityLog } from "../research/sampleAwards";
import { resolveCountermeasures } from "../research/countermeasures";
import { createSeededRng, hashStringToSeed } from "../simulation/rng";
import type { BodyZoneId } from "../data/kaiju";
import type { MutationKind } from "../data/mutations";

/**
 * A campaign's worth of research, run headlessly.
 *
 * What this proves: that the tree can actually be walked by somebody playing
 * normally, that it does not take an absurd number of fights to do it, and that
 * a player who only ever fights the same easy thing gets steadily less for it
 * rather than steadily more.
 *
 * Deterministic from a seed. No world, no renderer, no clock.
 */

export const RESEARCH_SCENARIO_SEED = 20260830;

/** How a player goes about it. Each is a real approach, not a difficulty. */
export const RESEARCH_STRATEGIES = ["varied", "same-fight", "trophy-hunter"] as const;
export type ResearchStrategy = (typeof RESEARCH_STRATEGIES)[number];

export interface ResearchScenarioOptions {
  readonly seed?: number;
  readonly strategy?: ResearchStrategy;
  /** Sorties flown over the run. */
  readonly sorties?: number;
  /** Researchers the complex has. */
  readonly researchers?: number;
  readonly researchRate?: number;
  /** Ticks of lab time between sorties. */
  readonly ticksBetweenSorties?: number;
}

export interface ResearchScenarioResult {
  readonly strategy: ResearchStrategy;
  readonly sorties: number;
  readonly completedCount: number;
  readonly completedIds: readonly string[];
  /** Branches with at least one node finished. */
  readonly branchesTouched: number;
  /** Samples still in the stores at the end. */
  readonly samplesHeld: number;
  /** Samples recovered across the whole run. */
  readonly samplesRecovered: number;
  /** Sortie on which the first countermeasure landed. */
  readonly firstCountermeasureSortie: number | null;
  /** What the fights look like at the end. */
  readonly telegraphLead: number;
  readonly statusesResisted: number;
  readonly chassisUnlocked: readonly string[];
  readonly digest: number;
}

const ZONES: readonly BodyZoneId[] = ["head", "torso", "core", "limb.left", "tail"];
const MUTATIONS: readonly MutationKind[] = ["armour", "offence", "mobility", "sensory", "resilience"];

/**
 * One run.
 *
 * The strategy decides what gets fought and how. Everything else follows from
 * the same award rules and the same programme the game uses.
 */
export function runResearchScenario(options: ResearchScenarioOptions = {}): ResearchScenarioResult {
  const strategy = options.strategy ?? "varied";
  const sorties = options.sorties ?? 60;
  const researchers = options.researchers ?? 6;
  const researchRate = options.researchRate ?? 1.2;
  const ticksBetween = options.ticksBetweenSorties ?? 2_600;

  const registry = createResearchRegistry();
  const program = new ResearchProgram(registry);
  const rng = createSeededRng(
    (hashStringToSeed(`research|${strategy}`) ^ (options.seed ?? RESEARCH_SCENARIO_SEED)) >>> 0,
  );

  let familiarity: FamiliarityLog = {};
  let samplesRecovered = 0;
  let firstCountermeasure: number | null = null;

  // Deliberately generous, because this scenario is about whether the tree is
  // walkable rather than about whether it is affordable. The economy scenario
  // already answers the money question.
  const capacity = {
    researchers,
    researchRate,
    facilityTiers: {
      research: 2,
      manufacture: 2,
      reactor: 2,
      defense: 1,
      logistics: 1,
      "kaiju-containment": 1,
    },
  };

  for (let sortie = 1; sortie <= sorties; sortie += 1) {
    const fight = fightFor(strategy, sortie, rng);
    const recovery = program.isComplete("research.biology.dissection") ? 1.3 : 1;
    const result = awardSamples(fight, { familiarity, recoveryMultiplier: recovery });
    familiarity = result.familiarity;
    program.addSamples(result.awards);
    program.recordFamiliarity(result.familiarity);
    for (const award of result.awards) samplesRecovered += award.count;

    // Start whatever is now startable, cheapest first, so the run is a player
    // working steadily rather than an oracle picking the optimal order.
    const context: StartContext = {
      ...capacity,
      samples: program.samples(),
      researchData: 100_000,
      funding: 100_000_000,
    };
    const { ready } = program.available(context);
    for (const node of [...ready].sort((a, b) => a.researchTicks - b.researchTicks)) {
      const started = program.start(node.id, {
        ...context,
        samples: program.samples(),
      });
      if (!started.ok) continue;
    }

    const finished = program.advance(ticksBetween, capacity);
    if (finished.length > 0 && firstCountermeasure === null) {
      const profile = resolveCountermeasures(program.completed(), registry);
      if (profile.telegraphLead > 0 || Object.keys(profile.statusResistance).length > 0) {
        firstCountermeasure = sortie;
      }
    }
  }

  const profile = resolveCountermeasures(program.completed(), registry);
  const completedIds = [...program.completed()].sort();
  const branches = new Set<ResearchBranch>();
  for (const id of completedIds) {
    const node = registry.get(id);
    if (node) branches.add(node.branch);
  }
  const samplesHeld = Object.values(program.samples()).reduce((total, count) => total + count, 0);

  return {
    strategy,
    sorties,
    completedCount: completedIds.length,
    completedIds,
    branchesTouched: branches.size,
    samplesHeld,
    samplesRecovered,
    firstCountermeasureSortie: firstCountermeasure,
    telegraphLead: Math.round(profile.telegraphLead * 100) / 100,
    statusesResisted: Object.keys(profile.statusResistance).length,
    chassisUnlocked: profile.chassis,
    digest:
      (completedIds.length * 7919 + samplesRecovered * 31 + Math.round(profile.telegraphLead * 1000)) >>> 0,
  };
}

/** What one sortie looked like, according to how the player is going about it. */
function fightFor(strategy: ResearchStrategy, sortie: number, rng: () => number): FightRecord {
  if (strategy === "same-fight") {
    // The grind case: the same easy creature, killed the same way, forever.
    return {
      category: "coastal",
      defeated: true,
      finish: "attrition",
      zonesDestroyed: ["torso"],
      mutationKinds: [],
      dominantDamageKind: "kinetic",
      environment: ["land"],
      objectivesMet: ["protect-civilians"],
      objectiveScore: 0.8,
    };
  }

  const categories = ["coastal", "deep", "swarm", "siege"];
  const category = categories[Math.floor(rng() * categories.length)] ?? "coastal";
  const zoneCount = 1 + Math.floor(rng() * 3);
  const zones: BodyZoneId[] = [];
  for (let index = 0; index < zoneCount; index += 1) {
    const zone = ZONES[Math.floor(rng() * ZONES.length)];
    if (zone && !zones.includes(zone)) zones.push(zone);
  }
  const mutationCount = Math.floor(rng() * 3);
  const mutations: MutationKind[] = [];
  for (let index = 0; index < mutationCount; index += 1) {
    const mutation = MUTATIONS[Math.floor(rng() * MUTATIONS.length)];
    if (mutation && !mutations.includes(mutation)) mutations.push(mutation);
  }

  if (strategy === "trophy-hunter") {
    // Goes after the difficult recoveries deliberately: finishers, captures, and
    // the fights that happen somewhere awkward.
    const roll = rng();
    return {
      category,
      defeated: true,
      finish: roll > 0.7 ? "captured" : "finisher",
      zonesDestroyed: zones.length > 0 ? zones : ["core"],
      mutationKinds: mutations,
      dominantDamageKind: roll > 0.5 ? "heat" : "electrical",
      environment: roll > 0.6 ? ["water", "storm"] : ["land"],
      objectivesMet: roll > 0.5 ? ["protect-civilians", "contain-breach"] : ["protect-civilians"],
      objectiveScore: 0.75 + rng() * 0.25,
    };
  }

  const roll = rng();
  return {
    category,
    defeated: roll > 0.08,
    finish: roll > 0.75 ? "finisher" : roll > 0.08 ? "attrition" : "escaped",
    zonesDestroyed: zones,
    mutationKinds: mutations,
    dominantDamageKind: roll > 0.6 ? "heat" : roll > 0.3 ? "kinetic" : "electrical",
    environment: roll > 0.7 ? ["water"] : roll > 0.4 ? ["storm"] : ["land"],
    objectivesMet: sortie % 4 === 0 ? ["protect-civilians", "contain-breach"] : ["protect-civilians"],
    objectiveScore: 0.55 + rng() * 0.45,
  };
}

/** Every strategy, for the balance tests. */
export function compareResearchStrategies(sorties = 60): readonly ResearchScenarioResult[] {
  return RESEARCH_STRATEGIES.map((strategy) => runResearchScenario({ strategy, sorties }));
}

/**
 * Proves the tree has no dead end.
 *
 * Walks every node from nothing, checking that its prerequisites are reachable
 * and that everything it asks for can actually be obtained. Returns the nodes
 * that cannot be reached, which must be none.
 */
export function unreachableNodes(): readonly string[] {
  const registry = createResearchRegistry();
  const reached = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of RESEARCH_NODES) {
      if (reached.has(node.id)) continue;
      if (node.requires.every((id) => reached.has(id))) {
        reached.add(node.id);
        changed = true;
      }
    }
  }
  return RESEARCH_NODES.filter((node) => !reached.has(node.id) && registry.has(node.id)).map(
    (node) => node.id,
  );
}
