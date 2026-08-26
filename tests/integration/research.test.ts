import { beforeEach, describe, expect, it } from "vitest";
import {
  compareResearchStrategies,
  runResearchScenario,
  unreachableNodes,
} from "../../src/debug/researchScenario";
import { RESEARCH_NODES, createResearchRegistry } from "../../src/data/research";
import { ResearchProgram } from "../../src/research/program";
import { resistedDuration, resolveCountermeasures } from "../../src/research/countermeasures";
import { MANUFACTURE_RECIPES, manufactureCost, quoteManufacture } from "../../src/research/manufacture";
import { awardSamples } from "../../src/research/sampleAwards";
import {
  CombatArena,
  combatProfileFor,
  jaegerLayout,
  jaegerZones,
  kaijuCombatProfile,
  kaijuZones,
  type FighterSpec,
} from "../../src/combat/arena";
import { createMoveRegistry } from "../../src/data/moves";
import { jaegerRegistry } from "../../src/data/jaegers";
import { createKaijuRegistry } from "../../src/data/kaiju";
import { Roster } from "../../src/jaegers/roster";
import { Economy } from "../../src/world/economy";
import { MemorySaveRepository } from "../../src/saves/repository";
import { SaveService } from "../../src/saves/saveService";
import { SimulationKernel } from "../../src/simulation/kernel";
import { migrateSave } from "../../src/saves/migrations";
import { ROOT_SAVE_VERSION } from "../../src/saves/schema";

/**
 * Research where it meets everything else.
 *
 * The acceptance questions: does a finished countermeasure change a real
 * rematch, does building an exclusive frame consume exactly what it said and
 * produce exactly one machine, and does any of it survive a save.
 */

const SEED = 20260830;
const registry = createResearchRegistry();

let repository: MemorySaveRepository;
let service: SaveService;
let clock: number;

function kernel(): SimulationKernel {
  const instance = new SimulationKernel({ seed: SEED });
  for (let tick = 0; tick < 10; tick += 1) instance.step();
  return instance;
}

beforeEach(() => {
  repository = new MemorySaveRepository();
  clock = 1_700_000_000_000;
  service = new SaveService({ repository, now: () => (clock += 1000), autosaveSlots: 2, backupsPerSlot: 1 });
});

describe("the tree as a campaign", () => {
  it("runs the same way twice from the same seed", () => {
    expect(runResearchScenario().digest).toBe(runResearchScenario().digest);
  });

  it("has no node that cannot be reached", () => {
    expect(unreachableNodes()).toEqual([]);
  });

  it("can be walked most of the way by somebody playing normally", () => {
    const varied = runResearchScenario({ strategy: "varied", sorties: 60 });
    expect(varied.completedCount).toBeGreaterThan(RESEARCH_NODES.length * 0.7);
    expect(varied.branchesTouched).toBe(9);
  });

  it("gives a player something early rather than after a season of nothing", () => {
    const varied = runResearchScenario({ strategy: "varied", sorties: 60 });
    expect(varied.firstCountermeasureSortie).not.toBeNull();
    expect(varied.firstCountermeasureSortie!).toBeLessThan(12);
  });

  it("pays worse for grinding the same fight than for varying it", () => {
    // The explicit failure mode this milestone has to avoid. Repeating the
    // easiest kill forever must not be the efficient way to finish the tree.
    const varied = runResearchScenario({ strategy: "varied", sorties: 60 });
    const same = runResearchScenario({ strategy: "same-fight", sorties: 60 });
    expect(same.completedCount).toBeLessThan(varied.completedCount);
    expect(same.samplesRecovered).toBeLessThan(varied.samplesRecovered);
  });

  it("rewards going after the difficult recoveries most of all", () => {
    const trophy = runResearchScenario({ strategy: "trophy-hunter", sorties: 60 });
    const varied = runResearchScenario({ strategy: "varied", sorties: 60 });
    expect(trophy.completedCount).toBeGreaterThanOrEqual(varied.completedCount);
    expect(trophy.chassisUnlocked.length).toBeGreaterThan(0);
  });

  it("never leaves a grinding player with nothing at all", () => {
    // Worse is not the same as stuck. Someone who only ever fights one thing
    // still gets a working programme, just a narrower one.
    const same = runResearchScenario({ strategy: "same-fight", sorties: 60 });
    expect(same.completedCount).toBeGreaterThan(5);
    expect(same.telegraphLead).toBeGreaterThan(0);
  });

  it("does not hand the exclusive frames to somebody who never varied anything", () => {
    expect(runResearchScenario({ strategy: "same-fight", sorties: 60 }).chassisUnlocked).toEqual([]);
  });

  it("covers every strategy, and every one of them gets somewhere", () => {
    const runs = compareResearchStrategies(60);
    expect(runs).toHaveLength(3);
    for (const run of runs) {
      expect(run.completedCount, run.strategy).toBeGreaterThan(0);
      expect(run.samplesRecovered, run.strategy).toBeGreaterThan(0);
    }
  });
});

describe("a countermeasure changes a real rematch", () => {
  const MOVES = createMoveRegistry();
  const JAEGER = jaegerRegistry.getOrThrow("placeholder-mk0");
  const KAIJU = createKaijuRegistry().getOrThrow("kaiju.test-dummy");

  function fighters(): FighterSpec[] {
    return [
      {
        id: "jaeger",
        kind: "jaeger",
        displayName: JAEGER.name,
        heightMeters: JAEGER.locomotion.heightMeters,
        profile: combatProfileFor(JAEGER),
        pose: { east: 0, north: 0, up: 0, yawDeg: 0 },
        zones: jaegerZones(JAEGER),
        layout: jaegerLayout(JAEGER),
        finisherThreshold: 0.2,
      },
      {
        id: "kaiju",
        kind: "kaiju",
        displayName: KAIJU.name,
        heightMeters: KAIJU.heightMeters,
        profile: kaijuCombatProfile(KAIJU),
        pose: { east: 0, north: 30, up: 0, yawDeg: 180 },
        zones: kaijuZones(KAIJU),
        kaiju: KAIJU,
        finisherThreshold: KAIJU.finisherThreshold,
      },
    ];
  }

  function arena(completed: readonly string[]): CombatArena {
    return new CombatArena({
      moves: MOVES,
      seed: SEED,
      fighters: fighters(),
      countermeasures: resolveCountermeasures(completed, registry),
    });
  }

  it("says nothing about a wind-up before the research, which is the fight everybody had", () => {
    const before = arena([]);
    before.start("kaiju", "kaiju.claw.swipe");
    before.run(2);
    expect(before.telegraphs()).toEqual([]);
  });

  it("calls the same wind-up once the nervous system is mapped", () => {
    // The acceptance item, as a real rematch: identical fighters, identical seed,
    // identical move, and the only difference is a finished programme.
    const learned = arena(["research.biology.dissection", "research.biology.nervous-system"]);
    learned.start("kaiju", "kaiju.claw.swipe");

    let sawTelegraph = false;
    for (let tick = 0; tick < 30 && !sawTelegraph; tick += 1) {
      learned.run(1);
      if (learned.telegraphs().length > 0) sawTelegraph = true;
    }
    expect(sawTelegraph).toBe(true);

    const plain = arena([]);
    plain.start("kaiju", "kaiju.claw.swipe");
    let sawAnything = false;
    for (let tick = 0; tick < 30; tick += 1) {
      plain.run(1);
      if (plain.telegraphs().length > 0) sawAnything = true;
    }
    expect(sawAnything).toBe(false);
  });

  it("names the move and marks what it threatens once the model is in", () => {
    const modelled = arena([
      "research.biology.dissection",
      "research.biology.nervous-system",
      "research.biology.behavioural-model",
    ]);
    modelled.start("kaiju", "kaiju.claw.swipe");

    let named: string | null = null;
    for (let tick = 0; tick < 30 && named === null; tick += 1) {
      modelled.run(1);
      const readout = modelled.telegraphs()[0];
      if (readout) named = readout.label;
    }
    expect(named).not.toBeNull();
    expect(named).not.toBe("Committing");
  });

  it("shortens a status the crews have learned to deal with", () => {
    const none = resolveCountermeasures([], registry);
    const learned = resolveCountermeasures(["research.materials.ablative"], registry);
    expect(resistedDuration(300, "status.burning", learned)).toBeLessThan(
      resistedDuration(300, "status.burning", none),
    );
    // And never to nothing.
    expect(resistedDuration(300, "status.burning", learned)).toBeGreaterThan(0);
  });

  it("can be swapped in mid-campaign so the next fight uses it", () => {
    const live = arena([]);
    live.start("kaiju", "kaiju.claw.swipe");
    live.run(2);
    expect(live.telegraphs()).toEqual([]);

    live.setCountermeasures(
      resolveCountermeasures(["research.biology.dissection", "research.biology.nervous-system"], registry),
    );
    let sawTelegraph = false;
    for (let tick = 0; tick < 25 && !sawTelegraph; tick += 1) {
      live.run(1);
      if (live.telegraphs().length > 0) sawTelegraph = true;
    }
    expect(sawTelegraph).toBe(true);
  });

  it("only becomes more informative, never more damaging", () => {
    const everything = resolveCountermeasures(
      RESEARCH_NODES.map((node) => node.id),
      registry,
    );
    expect(everything.telegraphLead).toBeGreaterThan(0);
    expect(everything.weakPointsMarked).toBe(true);
    expect(Object.keys(everything).some((key) => /damage|power|strength/i.test(key))).toBe(false);
  });
});

describe("building a frame nobody sells", () => {
  it("consumes exactly what the bill said and produces exactly one machine", () => {
    const recipe = MANUFACTURE_RECIPES[0]!;
    const roster = new Roster();
    const economy = new Economy({ startingFunding: 50_000_000 });
    economy.earn("alloy", recipe.alloy, { source: "salvage-rights", reason: "Stores.", day: 1 });
    economy.earn("reactorMaterial", recipe.reactorMaterial, {
      source: "government-contract",
      reason: "Stores.",
      day: 1,
    });

    const before = {
      funding: economy.balance("funding"),
      alloy: economy.balance("alloy"),
      reactor: economy.balance("reactorMaterial"),
      owned: roster.all().length,
    };

    const quote = quoteManufacture(recipe, {
      completedNodes: ["research.chassis.harmonic-frame"],
      components: { "component.laminate-hull": 4 },
      alloy: economy.balance("alloy"),
      reactorMaterial: economy.balance("reactorMaterial"),
      funding: economy.balance("funding"),
      facilityTiers: { manufacture: 2 },
      ownedChassisIds: roster.all().map((record) => record.chassisId),
    });
    expect(quote.refusal).toBeNull();

    const cost = manufactureCost(recipe);
    economy.spend("funding", cost.funding, { source: "construction", reason: "Frame.", day: 1 });
    economy.spend("alloy", cost.alloy, { source: "construction", reason: "Frame.", day: 1 });
    economy.spend("reactorMaterial", cost.reactorMaterial, {
      source: "construction",
      reason: "Frame.",
      day: 1,
    });
    const built = roster.acquire({ chassisId: recipe.chassisId, acquiredBy: "research-manufacture" });

    expect(built).not.toBeNull();
    expect(roster.all().length).toBe(before.owned + 1);
    expect(roster.all().filter((record) => record.chassisId === recipe.chassisId)).toHaveLength(1);
    expect(economy.balance("funding")).toBe(before.funding - cost.funding);
    expect(economy.balance("alloy")).toBe(before.alloy - cost.alloy);
    expect(economy.balance("reactorMaterial")).toBe(before.reactor - cost.reactorMaterial);
  });

  it("records where the machine came from", () => {
    const roster = new Roster();
    const built = roster.acquire({ chassisId: "leviathan-mk1", acquiredBy: "research-manufacture" });
    expect(built?.acquiredBy).toBe("research-manufacture");
  });

  it("is not on the board, because nobody sells it", () => {
    for (const recipe of MANUFACTURE_RECIPES) {
      const chassis = jaegerRegistry.getOrThrow(recipe.chassisId);
      expect(chassis.acquisition).not.toContain("purchase");
      expect(chassis.listPrice).toBe(0);
    }
  });

  it("nobody starts a campaign owning one", () => {
    const roster = new Roster();
    for (const recipe of MANUFACTURE_RECIPES) {
      expect(roster.all().some((record) => record.chassisId === recipe.chassisId)).toBe(false);
    }
  });
});

describe("research across a save", () => {
  it("survives a real save file", async () => {
    const program = new ResearchProgram(registry);
    const { awards, familiarity } = awardSamples({
      category: "coastal",
      defeated: true,
      finish: "finisher",
      zonesDestroyed: ["head"],
      mutationKinds: ["armour"],
      dominantDamageKind: "heat",
      environment: ["storm"],
      objectivesMet: ["protect-civilians"],
      objectiveScore: 0.9,
    });
    program.addSamples(awards);
    program.recordFamiliarity(familiarity);
    program.start("research.biology.dissection", {
      researchers: 8,
      researchRate: 1,
      facilityTiers: { research: 2 },
      samples: program.samples(),
      researchData: 1e6,
      funding: 1e9,
    });
    program.advance(100_000, { researchers: 8, researchRate: 1, facilityTiers: { research: 2 } });

    await service.save("slot.research", kernel(), { name: "Research", research: program.snapshot() });
    const loaded = await service.load("slot.research");
    const restored = new ResearchProgram(registry);
    restored.restore(loaded.document.research);

    expect(restored.isComplete("research.biology.dissection")).toBe(true);
    expect(restored.samples()).toEqual(program.samples());
    expect(restored.familiarity()).toEqual(program.familiarity());
  });

  it("keeps a benefit valid after a reload, so a countermeasure does not evaporate", () => {
    // The acceptance item about prerequisites and benefits staying valid.
    const program = new ResearchProgram(registry);
    program.restore({
      schemaVersion: 1,
      completed: ["research.biology.dissection", "research.biology.nervous-system"],
      experiments: [],
      samples: {},
      familiarity: {},
    });
    const profile = resolveCountermeasures(program.completed(), registry);
    expect(profile.telegraphLead).toBeGreaterThan(0);
  });

  it("migrates a version 13 save into an empty programme rather than inventing one", async () => {
    const legacy = {
      schemaVersion: 13,
      savedAt: 1,
      metadata: {
        name: "Before research",
        worldSeed: 7,
        playTimeMs: 0,
        lastPlayedAt: 0,
        simTick: 0,
        appVersion: "0.2.0",
        thumbnail: null,
      },
      sim: { schemaVersion: 1, seed: 7, tick: 0, entities: [] },
    };
    const result = migrateSave(legacy);
    expect(result.applied).toContain("13");
    expect(result.document.schemaVersion).toBe(ROOT_SAVE_VERSION);
    expect(result.document.research.completed).toEqual([]);
    expect(result.document.research.samples).toEqual({});
  });

  it("keeps a prerequisite chain valid when a node is dropped from the build", () => {
    // Data changes must not strand a save. A completed node this build no longer
    // has is dropped, and everything else still resolves.
    const program = new ResearchProgram(registry);
    program.restore({
      schemaVersion: 1,
      completed: ["research.biology.dissection", "research.removed.node"],
      experiments: [{ nodeId: "research.also.removed", state: "queued", progressTicks: 5, priority: 1 }],
      samples: { "sample.hide": 3, "sample.removed": 9 },
      familiarity: {},
    });
    expect(program.completed()).toEqual(["research.biology.dissection"]);
    expect(program.experiments()).toEqual([]);
    expect(program.samples()).toEqual({ "sample.hide": 3 });
    expect(() => resolveCountermeasures(program.completed(), registry)).not.toThrow();
  });
});
