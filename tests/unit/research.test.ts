import { describe, expect, it } from "vitest";
import { FACILITY_EFFECTS, FACILITY_KINDS } from "../../src/data/facilities";
import { jaegerRegistry } from "../../src/data/jaegers";
import {
  RESEARCH_BRANCHES,
  RESEARCH_NODES,
  branchNodes,
  createResearchRegistry,
  rootNodes,
  validateResearchNode,
  type ResearchNodeDefinition,
} from "../../src/data/research";
import {
  SAMPLE_DEFINITIONS,
  createSampleRegistry,
  guaranteedSampleIds,
  validateSample,
} from "../../src/data/samples";
import { awardSamples, familiarityFactor, type FightRecord } from "../../src/research/sampleAwards";
import {
  MAX_STATUS_RESISTANCE,
  neutralCountermeasures,
  readTelegraph,
  resistedDuration,
  resolveCountermeasures,
  trackingRangeFor,
} from "../../src/research/countermeasures";
import {
  MANUFACTURE_RECIPES,
  createManufactureRegistry,
  quoteManufacture,
  validateRecipe,
} from "../../src/research/manufacture";
import { ResearchProgram, emptyResearchSnapshot, validateResearchSnapshot } from "../../src/research/program";

const registry = createResearchRegistry();

function fight(overrides: Partial<FightRecord> = {}): FightRecord {
  return {
    category: "coastal",
    defeated: true,
    finish: "attrition",
    zonesDestroyed: [],
    mutationKinds: [],
    dominantDamageKind: "kinetic",
    environment: ["land"],
    objectivesMet: [],
    objectiveScore: 1,
    ...overrides,
  };
}

function fullCapacity() {
  return {
    researchers: 12,
    researchRate: 1,
    facilityTiers: {
      research: 3,
      manufacture: 3,
      reactor: 3,
      defense: 3,
      logistics: 3,
      "kaiju-containment": 3,
    },
  };
}

function richContext(program: ResearchProgram) {
  return { ...fullCapacity(), samples: program.samples(), researchData: 1e6, funding: 1e9 };
}

describe("the research table", () => {
  it("all validate", () => {
    for (const node of RESEARCH_NODES) expect(validateResearchNode(node), node.id).toEqual([]);
  });

  it("covers every branch the milestone asks for", () => {
    for (const branch of RESEARCH_BRANCHES) {
      expect(branchNodes(branch).length, branch).toBeGreaterThan(0);
    }
    expect(RESEARCH_BRANCHES).toHaveLength(9);
  });

  it("has somewhere to start", () => {
    expect(rootNodes().length).toBeGreaterThan(0);
  });

  it("names every prerequisite it has", () => {
    for (const node of RESEARCH_NODES) {
      for (const required of node.requires)
        expect(registry.has(required), `${node.id} -> ${required}`).toBe(true);
    }
  });

  it("has no cycle, so nothing can be permanently unreachable", () => {
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
    expect(reached.size).toBe(RESEARCH_NODES.length);
  });

  it("refuses a node that hands nothing over", () => {
    const base = RESEARCH_NODES[0]!;
    expect(validateResearchNode({ ...base, benefits: [] }).join(" ")).toMatch(/hand something over/);
  });

  it("refuses a sample requirement large enough to be a grind", () => {
    const base = RESEARCH_NODES[0]!;
    const greedy: ResearchNodeDefinition = {
      ...base,
      samples: [{ sampleId: "sample.hide", count: 20 }],
    };
    expect(validateResearchNode(greedy).join(" ")).toMatch(/grind/);
  });

  it("only names facilities the complex actually has", () => {
    // A node requiring a facility that does not exist can never be started, and
    // nothing would have said so: the refusal would have named a tier of a room
    // nobody could build.
    for (const node of RESEARCH_NODES) {
      if (!node.requiresFacility) continue;
      expect(FACILITY_KINDS as readonly string[], node.id).toContain(node.requiresFacility.facilityId);
    }
  });

  it("only names facility effects the complex actually has", () => {
    // A benefit naming an effect nothing reads would be a programme that
    // finishes and changes nothing, which is the failure this project refuses.
    for (const node of RESEARCH_NODES) {
      for (const benefit of node.benefits) {
        if (benefit.kind !== "facility") continue;
        expect(FACILITY_EFFECTS as readonly string[], `${node.id} -> ${benefit.target}`).toContain(
          benefit.target,
        );
      }
    }
  });

  it("only names equipment and chassis ids something can resolve", () => {
    for (const node of RESEARCH_NODES) {
      for (const benefit of node.benefits) {
        if (benefit.kind === "chassis") {
          expect(jaegerRegistry.has(benefit.target), `${node.id} -> ${benefit.target}`).toBe(true);
        }
        if (benefit.kind === "equipment") {
          expect(
            benefit.target.startsWith("weapon.") ||
              benefit.target.startsWith("module.") ||
              benefit.target.startsWith("component."),
            `${node.id} -> ${benefit.target}`,
          ).toBe(true);
        }
      }
    }
  });

  it("hands over capabilities rather than percentages", () => {
    // The whole point of the milestone. Nothing in the tree is a scalar buff to
    // damage or health, so this asserts on the shape of what a node can give.
    for (const node of RESEARCH_NODES) {
      for (const benefit of node.benefits) {
        expect(["damage", "health", "armour"], `${node.id} ${benefit.target}`).not.toContain(benefit.target);
      }
    }
  });
});

describe("core progression cannot be stranded", () => {
  it("can be started with nothing but what any kill drops", () => {
    // The rule against impossible missable samples. Every root node has to be
    // reachable from a single ordinary fight, or a campaign can be born stuck.
    const guaranteed = new Set(guaranteedSampleIds());
    for (const node of rootNodes()) {
      for (const requirement of node.samples) {
        expect(guaranteed.has(requirement.sampleId), `${node.id} needs ${requirement.sampleId}`).toBe(true);
      }
    }
  });

  it("reaches at least one node in every branch without a single rare sample", () => {
    // Common samples alone have to open a way into every branch. Rare and exotic
    // gate the spectacular, never the road.
    const commonIds = new Set(
      SAMPLE_DEFINITIONS.filter((sample) => sample.sampleClass === "common").map((sample) => sample.id),
    );
    const reachable = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of RESEARCH_NODES) {
        if (reachable.has(node.id)) continue;
        const prerequisitesMet = node.requires.every((id) => reachable.has(id));
        const samplesCommon = node.samples.every((entry) => commonIds.has(entry.sampleId));
        if (prerequisitesMet && samplesCommon) {
          reachable.add(node.id);
          changed = true;
        }
      }
    }
    const branchesReached = new Set([...reachable].map((id) => registry.getOrThrow(id).branch));
    for (const branch of RESEARCH_BRANCHES) {
      // Chassis is the deliberate exception: an exclusive frame is supposed to
      // need something rare, and it is optional rather than core.
      if (branch === "chassis") continue;
      expect(branchesReached.has(branch), branch).toBe(true);
    }
  });
});

describe("samples", () => {
  it("all validate", () => {
    for (const sample of SAMPLE_DEFINITIONS) expect(validateSample(sample), sample.id).toEqual([]);
  });

  it("registers without a duplicate", () => {
    expect(createSampleRegistry().all().length).toBe(SAMPLE_DEFINITIONS.length);
  });

  it("gives something for any kill at all", () => {
    const { awards } = awardSamples(fight());
    expect(awards.length).toBeGreaterThan(0);
    for (const award of awards) expect(award.count).toBeGreaterThan(0);
  });

  it("gives nothing off the body when it got away", () => {
    const { awards } = awardSamples(fight({ defeated: false, finish: "escaped" }));
    expect(awards.every((award) => award.sampleId !== "sample.hide")).toBe(true);
  });

  it("still pays for objectives met even when it got away", () => {
    const { awards } = awardSamples(
      fight({ defeated: false, finish: "escaped", objectivesMet: ["protect-civilians"] }),
    );
    expect(awards.some((award) => award.sampleId === "sample.evacuation-record")).toBe(true);
  });

  it("gives a zone sample only when that zone came apart", () => {
    expect(awardSamples(fight()).awards.some((a) => a.sampleId === "sample.cranial")).toBe(false);
    expect(
      awardSamples(fight({ zonesDestroyed: ["head"] })).awards.some((a) => a.sampleId === "sample.cranial"),
    ).toBe(true);
  });

  it("gives a mutation sample only when it was carrying that mutation", () => {
    expect(
      awardSamples(fight({ mutationKinds: ["armour"] })).awards.some(
        (a) => a.sampleId === "sample.plate-lamina",
      ),
    ).toBe(true);
    expect(awardSamples(fight()).awards.some((a) => a.sampleId === "sample.plate-lamina")).toBe(false);
  });

  it("gives live culture only for something taken alive", () => {
    expect(
      awardSamples(fight({ finish: "captured" })).awards.some((a) => a.sampleId === "sample.live-culture"),
    ).toBe(true);
    expect(
      awardSamples(fight({ finish: "finisher" })).awards.some((a) => a.sampleId === "sample.live-culture"),
    ).toBe(false);
  });

  it("gives an intact organ only for a clean finish", () => {
    expect(
      awardSamples(fight({ finish: "finisher" })).awards.some((a) => a.sampleId === "sample.intact-organ"),
    ).toBe(true);
    expect(
      awardSamples(fight({ finish: "attrition" })).awards.some((a) => a.sampleId === "sample.intact-organ"),
    ).toBe(false);
  });

  it("reads the environment and the damage that did the work", () => {
    const wet = awardSamples(fight({ environment: ["water"], dominantDamageKind: "heat" }));
    expect(wet.awards.some((a) => a.sampleId === "sample.pressure-adapted")).toBe(true);
    expect(wet.awards.some((a) => a.sampleId === "sample.vitrified")).toBe(true);
  });

  it("pays less from a fight that went badly", () => {
    const good = awardSamples(fight({ objectiveScore: 1 }));
    const bad = awardSamples(fight({ objectiveScore: 0 }));
    const total = (result: typeof good) => result.awards.reduce((sum, a) => sum + a.count, 0);
    expect(total(bad)).toBeLessThanOrEqual(total(good));
  });

  it("says why every sample came back", () => {
    for (const award of awardSamples(fight({ zonesDestroyed: ["head"] })).awards) {
      expect(award.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("repetition stops paying", () => {
  it("is worth less every time the same category gives up the same thing", () => {
    expect(familiarityFactor(0)).toBe(1);
    expect(familiarityFactor(1)).toBeLessThan(familiarityFactor(0));
    expect(familiarityFactor(10)).toBeLessThan(familiarityFactor(1));
  });

  it("never falls to nothing, so a lost sample can always be replaced", () => {
    expect(familiarityFactor(1_000)).toBeGreaterThan(0);
  });

  it("pays a fresh category in full while a familiar one has fallen off", () => {
    let familiarity = {};
    for (let run = 0; run < 12; run += 1) {
      familiarity = awardSamples(fight({ category: "coastal" }), { familiarity }).familiarity;
    }
    const familiar = awardSamples(fight({ category: "coastal" }), { familiarity });
    const fresh = awardSamples(fight({ category: "deep" }), { familiarity });
    const total = (result: typeof fresh) => result.awards.reduce((sum, a) => sum + a.count, 0);
    expect(total(fresh)).toBeGreaterThan(total(familiar));
  });

  it("still gives at least one of anything that qualified", () => {
    let familiarity = {};
    for (let run = 0; run < 40; run += 1) {
      familiarity = awardSamples(fight(), { familiarity }).familiarity;
    }
    for (const award of awardSamples(fight(), { familiarity }).awards) {
      expect(award.count).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("countermeasures", () => {
  it("start neutral, which is the fight everybody already had", () => {
    const profile = neutralCountermeasures();
    expect(profile.telegraphLead).toBe(0);
    expect(profile.weakPointsMarked).toBe(false);
    expect(resistedDuration(240, "status.burning", profile)).toBe(240);
  });

  it("are never a damage bonus", () => {
    const profile = resolveCountermeasures(RESEARCH_NODES.map((node) => node.id));
    expect(Object.keys(profile)).not.toContain("damage");
    expect(Object.keys(profile)).not.toContain("health");
  });

  it("take the best of two ways of learning the same thing rather than adding them", () => {
    const both = resolveCountermeasures([
      "research.biology.nervous-system",
      "research.biology.behavioural-model",
    ]);
    expect(both.telegraphLead).toBe(0.55);
  });

  it("shorten a status without ever refusing it outright", () => {
    const profile = resolveCountermeasures(["research.materials.ablative"]);
    const resisted = resistedDuration(240, "status.burning", profile);
    expect(resisted).toBeLessThan(240);
    expect(resisted).toBeGreaterThan(0);
  });

  it("cap resistance, so nothing is ever immune", () => {
    const profile = resolveCountermeasures(RESEARCH_NODES.map((node) => node.id));
    for (const value of Object.values(profile.statusResistance)) {
      expect(value).toBeLessThanOrEqual(MAX_STATUS_RESISTANCE);
    }
  });

  it("hold a contact further out, and further still in the conditions studied", () => {
    const profile = resolveCountermeasures([
      "research.sensors.signature-library",
      "research.sensors.thermal-array",
    ]);
    const clear = trackingRangeFor(2_000, [], profile);
    const stormy = trackingRangeFor(2_000, ["storm"], profile);
    expect(clear).toBeGreaterThan(2_000);
    expect(stormy).toBeGreaterThan(clear);
  });

  it("say nothing about a wind-up until something has been learned", () => {
    const readout = readTelegraph(
      { moveDisplayName: "Overhead", startupTicks: 10, ticksElapsed: 8, threatenedZones: ["head"] },
      neutralCountermeasures(),
    );
    expect(readout.visible).toBe(false);
    expect(readout.label).toBe("");
  });

  it("flag a commit once the nervous system is mapped", () => {
    const profile = resolveCountermeasures(["research.biology.nervous-system"]);
    const readout = readTelegraph(
      { moveDisplayName: "Overhead", startupTicks: 20, ticksElapsed: 18, threatenedZones: ["head"] },
      profile,
    );
    expect(readout.visible).toBe(true);
    expect(readout.label).toBe("Committing");
    // Not named yet, and no zones marked.
    expect(readout.threatenedZones).toEqual([]);
  });

  it("name the move and mark what it threatens once the model is in", () => {
    const profile = resolveCountermeasures([
      "research.biology.nervous-system",
      "research.biology.behavioural-model",
    ]);
    const readout = readTelegraph(
      { moveDisplayName: "Overhead", startupTicks: 20, ticksElapsed: 12, threatenedZones: ["head"] },
      profile,
    );
    expect(readout.visible).toBe(true);
    expect(readout.label).toBe("Overhead");
    expect(readout.threatenedZones).toEqual(["head"]);
  });

  it("open equipment and chassis rather than numbers", () => {
    const profile = resolveCountermeasures(RESEARCH_NODES.map((node) => node.id));
    expect(profile.equipment.length).toBeGreaterThan(0);
    expect(profile.chassis).toContain("harmonic-mk1");
    expect(profile.chassis).toContain("leviathan-mk1");
  });
});

describe("running a programme", () => {
  it("refuses a node whose prerequisites are not finished, and says which", () => {
    const program = new ResearchProgram(registry);
    const refusal = program.refusalFor("research.biology.behavioural-model", richContext(program));
    expect(refusal).toMatch(/Waiting on/);
  });

  it("refuses one it has not got the samples for, and says how short", () => {
    const program = new ResearchProgram(registry);
    expect(program.refusalFor("research.biology.dissection", richContext(program))).toMatch(/Short 2/);
  });

  it("refuses one the complex cannot house, and says what is needed", () => {
    const program = new ResearchProgram(registry);
    program.addSamples([
      { sampleId: "sample.hide", count: 9 },
      { sampleId: "sample.blood", count: 9 },
    ]);
    const refusal = program.refusalFor("research.biology.dissection", {
      ...richContext(program),
      facilityTiers: {},
    });
    expect(refusal).toMatch(/Needs research at tier 1/);
  });

  it("takes the samples and the money when it starts, not when it finishes", () => {
    const program = new ResearchProgram(registry);
    program.addSamples([
      { sampleId: "sample.hide", count: 4 },
      { sampleId: "sample.blood", count: 4 },
    ]);
    const started = program.start("research.biology.dissection", richContext(program));
    expect(started.ok).toBe(true);
    expect(started.spent?.samples["sample.hide"]).toBe(2);
    expect(program.sampleCount("sample.hide")).toBe(2);
    expect(started.spent?.funding).toBeGreaterThan(0);
  });

  it("finishes after the work is done and hands the node back", () => {
    const program = new ResearchProgram(registry);
    program.addSamples([
      { sampleId: "sample.hide", count: 4 },
      { sampleId: "sample.blood", count: 4 },
    ]);
    program.start("research.biology.dissection", richContext(program));
    const finished = program.advance(100_000, fullCapacity());
    expect(finished.map((node) => node.id)).toContain("research.biology.dissection");
    expect(program.isComplete("research.biology.dissection")).toBe(true);
    expect(program.experiments()).toHaveLength(0);
  });

  it("runs slower short handed rather than stopping", () => {
    const build = () => {
      const program = new ResearchProgram(registry);
      program.addSamples([
        { sampleId: "sample.hide", count: 4 },
        { sampleId: "sample.blood", count: 4 },
      ]);
      program.start("research.biology.dissection", richContext(program));
      return program;
    };
    const staffed = build();
    const short = build();
    staffed.advance(600, { ...fullCapacity(), researchers: 2 });
    short.advance(600, { ...fullCapacity(), researchers: 1 });
    const progress = (program: ResearchProgram) => program.report(fullCapacity())[0]!.percent;
    expect(progress(short)).toBeGreaterThan(0);
    expect(progress(short)).toBeLessThan(progress(staffed));
  });

  it("says what a short-handed experiment is waiting for", () => {
    const program = new ResearchProgram(registry);
    program.addSamples([
      { sampleId: "sample.hide", count: 4 },
      { sampleId: "sample.blood", count: 4 },
    ]);
    program.start("research.biology.dissection", richContext(program));
    program.advance(10, { ...fullCapacity(), researchers: 1 });
    expect(program.report({ ...fullCapacity(), researchers: 1 })[0]!.stalledReason).toMatch(/Short handed/);
  });

  it("pauses without losing what has been done, and resumes", () => {
    const program = new ResearchProgram(registry);
    program.addSamples([
      { sampleId: "sample.hide", count: 4 },
      { sampleId: "sample.blood", count: 4 },
    ]);
    program.start("research.biology.dissection", richContext(program));
    program.advance(600, fullCapacity());
    const before = program.report(fullCapacity())[0]!.percent;
    expect(program.pause("research.biology.dissection")).toBe(true);
    program.advance(6_000, fullCapacity());
    expect(program.report(fullCapacity())[0]!.percent).toBe(before);
    expect(program.resume("research.biology.dissection")).toBe(true);
    program.advance(600, fullCapacity());
    expect(program.report(fullCapacity())[0]!.percent).toBeGreaterThan(before);
  });

  it("gives half of everything back when cancelled, and never all of it", () => {
    const program = new ResearchProgram(registry);
    program.addSamples([
      { sampleId: "sample.hide", count: 4 },
      { sampleId: "sample.blood", count: 4 },
    ]);
    program.start("research.biology.dissection", richContext(program));
    const cancelled = program.cancel("research.biology.dissection");
    expect(cancelled.ok).toBe(true);
    expect(program.sampleCount("sample.hide")).toBe(3);
    expect(cancelled.refund?.funding).toBeGreaterThan(0);
    expect(cancelled.refund?.funding).toBeLessThan(250_000);
  });

  it("puts a reprioritised experiment at the front on the next tick", () => {
    const program = new ResearchProgram(registry);
    program.addSamples([
      { sampleId: "sample.hide", count: 20 },
      { sampleId: "sample.blood", count: 20 },
    ]);
    // Both of these hang off the dissection protocol, so it has to be finished
    // before there are two things to put in an order.
    program.start("research.biology.dissection", richContext(program));
    program.advance(100_000, fullCapacity());
    program.start("research.weapons.toxin-analysis", richContext(program));
    program.start("research.materials.plate-analysis", richContext(program));
    expect(program.experiments()[0]!.nodeId).toBe("research.weapons.toxin-analysis");
    program.prioritise("research.materials.plate-analysis");
    expect(program.experiments()[0]!.nodeId).toBe("research.materials.plate-analysis");
  });

  it("describes the experiment rather than only its progress", () => {
    const program = new ResearchProgram(registry);
    program.addSamples([
      { sampleId: "sample.hide", count: 4 },
      { sampleId: "sample.blood", count: 4 },
    ]);
    program.start("research.biology.dissection", richContext(program));
    expect(program.report(fullCapacity())[0]!.experiment.length).toBeGreaterThan(10);
  });

  it("will not start the same thing twice", () => {
    const program = new ResearchProgram(registry);
    program.addSamples([
      { sampleId: "sample.hide", count: 12 },
      { sampleId: "sample.blood", count: 12 },
    ]);
    program.start("research.biology.dissection", richContext(program));
    expect(program.start("research.biology.dissection", richContext(program)).ok).toBe(false);
    program.advance(100_000, fullCapacity());
    // And not again once it is finished either.
    expect(program.start("research.biology.dissection", richContext(program)).ok).toBe(false);
  });
});

describe("a programme across a save", () => {
  function seeded(): ResearchProgram {
    const program = new ResearchProgram(registry);
    program.addSamples([
      { sampleId: "sample.hide", count: 9 },
      { sampleId: "sample.blood", count: 9 },
    ]);
    program.start("research.biology.dissection", richContext(program));
    program.advance(100_000, fullCapacity());
    program.start("research.materials.plate-analysis", richContext(program));
    program.advance(400, fullCapacity());
    return program;
  }

  it("brings back what is finished, what is running and what is on the shelf", () => {
    const program = seeded();
    const restored = new ResearchProgram(registry);
    restored.restore(program.snapshot());
    expect(restored.completed()).toEqual(program.completed());
    expect(restored.samples()).toEqual(program.samples());
    expect(restored.experiments().map((entry) => entry.nodeId)).toEqual(
      program.experiments().map((entry) => entry.nodeId),
    );
  });

  it("brings a running experiment back queued rather than mid-tick", () => {
    const program = seeded();
    const restored = new ResearchProgram(registry);
    restored.restore(program.snapshot());
    expect(restored.experiments()[0]!.state).toBe("queued");
    expect(restored.experiments()[0]!.staffAssigned).toBe(0);
    // And the work done is not lost.
    expect(restored.experiments()[0]!.progressTicks).toBeGreaterThan(0);
  });

  it("drops a node or a sample this build no longer has", () => {
    const program = new ResearchProgram(registry);
    program.restore({
      ...emptyResearchSnapshot(),
      completed: ["research.does.not.exist"],
      samples: { "sample.does-not-exist": 9 },
    });
    expect(program.completed()).toEqual([]);
    expect(program.samples()).toEqual({});
  });

  it("refuses a snapshot that is not one", () => {
    expect(validateResearchSnapshot(null).length).toBeGreaterThan(0);
    expect(validateResearchSnapshot({ ...emptyResearchSnapshot(), schemaVersion: 99 })).toHaveLength(1);
    expect(validateResearchSnapshot(emptyResearchSnapshot())).toEqual([]);
  });
});

describe("manufacturing something nobody sells", () => {
  it("all recipes validate and name a real chassis", () => {
    for (const recipe of MANUFACTURE_RECIPES) expect(validateRecipe(recipe), recipe.chassisId).toEqual([]);
    expect(createManufactureRegistry().all().length).toBe(MANUFACTURE_RECIPES.length);
  });

  it("only names facilities the complex actually has", () => {
    for (const recipe of MANUFACTURE_RECIPES) {
      expect(FACILITY_KINDS as readonly string[], recipe.chassisId).toContain(
        recipe.requiresFacility.facilityId,
      );
    }
  });

  it("refuses a recipe for something that can just be bought", () => {
    expect(validateRecipe({ ...MANUFACTURE_RECIPES[0]!, components: {} }).join(" ")).toMatch(
      /researched component/,
    );
  });

  it("refuses until the programme behind it is finished", () => {
    const quote = quoteManufacture(MANUFACTURE_RECIPES[0]!, {
      completedNodes: [],
      components: { "component.laminate-hull": 99 },
      alloy: 1e6,
      reactorMaterial: 1e6,
      funding: 1e9,
      facilityTiers: { manufacture: 3 },
      ownedChassisIds: [],
    });
    expect(quote.refusal).toMatch(/programme behind it/);
  });

  it("says exactly which component is short", () => {
    const quote = quoteManufacture(MANUFACTURE_RECIPES[0]!, {
      completedNodes: ["research.chassis.harmonic-frame"],
      components: { "component.laminate-hull": 1 },
      alloy: 1e6,
      reactorMaterial: 1e6,
      funding: 1e9,
      facilityTiers: { manufacture: 3 },
      ownedChassisIds: [],
    });
    expect(quote.refusal).toMatch(/Short 3 laminate hull/);
  });

  it("shows the whole bill even when it refuses", () => {
    const quote = quoteManufacture(MANUFACTURE_RECIPES[1]!, {
      completedNodes: [],
      components: {},
      alloy: 0,
      reactorMaterial: 0,
      funding: 0,
      facilityTiers: {},
      ownedChassisIds: [],
    });
    expect(quote.refusal).not.toBeNull();
    expect(quote.lines.length).toBeGreaterThan(3);
    expect(quote.lines.some((line) => line.label === "Funding")).toBe(true);
  });

  it("accepts once everything is actually there", () => {
    const recipe = MANUFACTURE_RECIPES[0]!;
    const quote = quoteManufacture(recipe, {
      completedNodes: ["research.chassis.harmonic-frame"],
      components: { "component.laminate-hull": 4 },
      alloy: recipe.alloy,
      reactorMaterial: recipe.reactorMaterial,
      funding: recipe.funding,
      facilityTiers: { manufacture: 3 },
      ownedChassisIds: [],
    });
    expect(quote.refusal).toBeNull();
  });
});
