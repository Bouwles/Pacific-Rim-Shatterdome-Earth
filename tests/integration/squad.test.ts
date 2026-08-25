import { beforeEach, describe, expect, it } from "vitest";
import { MAX_SQUAD_SIZE, Squad, type FormationInput } from "../../src/allies/squad";
import { createAllyCrewRegistry } from "../../src/data/allyCrews";
import { createSquadOrderRegistry } from "../../src/data/squadOrders";
import { compareOrders, runSquadCampaign, runSquadTick } from "../../src/debug/squadScenario";
import { MemorySaveRepository } from "../../src/saves/repository";
import { SaveService } from "../../src/saves/saveService";
import { SimulationKernel } from "../../src/simulation/kernel";

/**
 * The squad against the systems that read it.
 *
 * The unit tests prove the scoring. These prove the three things the milestone
 * is judged on: an ally is useful with no orders and changes promptly when one
 * arrives, two allies do not tread on each other, and what a crew becomes
 * survives a save.
 */

const crews = createAllyCrewRegistry();
const orders = createSquadOrderRegistry();
const SEED = 20260827;

function squad(): Squad {
  return new Squad({ crews, orders });
}

function formation(overrides: Partial<FormationInput> = {}): FormationInput {
  return {
    crewIds: ["ally.karsten"],
    playerRole: "brawler",
    machines: {
      "heavy-mk4#1": { integrity: 1, ammunition: 1, role: "guardian" },
      "agile-mk5#1": { integrity: 1, ammunition: 1, role: "skirmisher" },
      "veteran-mk1#1": { integrity: 0.2, ammunition: 0.1, role: "siege" },
    },
    ...overrides,
  };
}

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

describe("forming a squad", () => {
  it("refuses a crew with no machine, in words", () => {
    const instance = squad();
    const assessment = instance.assess(formation());
    expect(assessment.ok).toBe(false);
    expect(assessment.refusals.join(" ")).toMatch(/No machine assigned/);
  });

  it("takes a crew once they have something to fly", () => {
    const instance = squad();
    expect(instance.assignMachine("ally.karsten", "heavy-mk4#1").ok).toBe(true);
    const assessment = instance.assess(formation());
    expect(assessment.ok).toBe(true);
    expect(assessment.rolesCovered).toContain("guardian");
  });

  it("refuses to put two crews in one machine", () => {
    const instance = squad();
    instance.assignMachine("ally.karsten", "heavy-mk4#1");
    const second = instance.assignMachine("ally.oduya", "heavy-mk4#1");
    expect(second.ok).toBe(false);
    expect(second.message).toMatch(/already flying that one/);
  });

  it("refuses a machine that is still in pieces", () => {
    const instance = squad();
    instance.assignMachine("ally.karsten", "veteran-mk1#1");
    const assessment = instance.assess(formation());
    expect(assessment.ok).toBe(false);
    expect(assessment.refusals.join(" ")).toMatch(/still in pieces/);
  });

  it("holds the mission's own limit on how many can come", () => {
    const instance = squad();
    instance.assignMachine("ally.karsten", "heavy-mk4#1");
    instance.assignMachine("ally.oduya", "agile-mk5#1");
    const assessment = instance.assess(
      formation({ crewIds: ["ally.karsten", "ally.oduya"], missionLimit: 1 }),
    );
    expect(assessment.ok).toBe(false);
    expect(assessment.limit).toBe(1);
    expect(assessment.refusals.join(" ")).toMatch(/will carry 1 ally/);
  });

  it("never carries more than the hard ceiling", () => {
    const instance = squad();
    const assessment = instance.assess(formation({ missionLimit: 99 }));
    expect(assessment.limit).toBe(MAX_SQUAD_SIZE);
  });

  it("warns about low ammunition and damage without stopping the launch", () => {
    const instance = squad();
    instance.assignMachine("ally.karsten", "heavy-mk4#1");
    const assessment = instance.assess(
      formation({
        machines: { "heavy-mk4#1": { integrity: 0.5, ammunition: 0.1, role: "guardian" } },
      }),
    );
    expect(assessment.ok).toBe(true);
    expect(assessment.warnings.join(" ")).toMatch(/ammunition/);
    expect(assessment.warnings.join(" ")).toMatch(/flying at 50 percent/);
  });

  it("warns about a rivalry rather than refusing it", () => {
    const instance = squad();
    instance.assignMachine("ally.karsten", "heavy-mk4#1");
    instance.assignMachine("ally.oduya", "agile-mk5#1");
    const assessment = instance.assess(formation({ crewIds: ["ally.karsten", "ally.oduya"] }));
    expect(assessment.ok).toBe(true);
    expect(assessment.warnings.join(" ")).toMatch(/will not take the same target/);
  });

  it("warns when the squad covers only one role", () => {
    const instance = squad();
    instance.assignMachine("ally.karsten", "heavy-mk4#1");
    const assessment = instance.assess(
      formation({
        playerRole: "guardian",
        machines: { "heavy-mk4#1": { integrity: 1, ammunition: 1, role: "guardian" } },
      }),
    );
    expect(assessment.warnings.join(" ")).toMatch(/Everything out there is a guardian/);
  });

  it("lists candidates with the reason each cannot come", () => {
    const instance = squad();
    instance.assignMachine("ally.karsten", "veteran-mk1#1");
    const candidates = instance.candidates(formation());
    expect(candidates.length).toBe(crews.all().length);
    const broken = candidates.find((entry) => entry.crewId === "ally.karsten")!;
    expect(broken.refusal).toMatch(/still in pieces/);
    const unassigned = candidates.find((entry) => entry.crewId === "ally.penrose")!;
    expect(unassigned.refusal).toMatch(/No machine assigned/);
  });
});

describe("giving orders", () => {
  it("answers back, so the player knows it landed", () => {
    const instance = squad();
    const result = instance.issue("ally.karsten", "regroup");
    expect(result.ok).toBe(true);
    expect(result.acknowledgement).toMatch(/Hammerfall/);
    expect(result.acknowledgement.length).toBeGreaterThan(10);
  });

  it("says the same thing for the same command in the same state", () => {
    const first = squad().issue("ally.karsten", "regroup").acknowledgement;
    const second = squad().issue("ally.karsten", "regroup").acknowledgement;
    expect(second).toBe(first);
  });

  it("refuses an order that needs a target it was not given", () => {
    const instance = squad();
    const result = instance.issue("ally.karsten", "focus-target");
    expect(result.ok).toBe(false);
    expect(result.refusal).toMatch(/needs something to point at/);
  });

  it("refuses an order that needs a place it was not given", () => {
    const instance = squad();
    const result = instance.issue("ally.karsten", "hold");
    expect(result.ok).toBe(false);
    expect(result.refusal).toMatch(/needs somewhere to point at/);
  });

  it("takes an order for the whole squad at once", () => {
    const instance = squad();
    const lines = instance.issueAll("regroup", { crewIds: ["ally.karsten", "ally.oduya"] });
    expect(lines).toHaveLength(2);
    expect(instance.orderOf("ally.karsten")?.id).toBe("regroup");
    expect(instance.orderOf("ally.oduya")?.id).toBe("regroup");
  });

  it("changes what the ally actually does, promptly", () => {
    const rows = compareOrders();
    const noOrder = rows.find((row) => row.order === "none")!;
    const held = rows.find((row) => row.order === "hold")!;
    const conserving = rows.find((row) => row.order === "conserve-ammunition")!;
    expect(held.goal).not.toBe(noOrder.goal);
    expect(held.goal).toBe("hold-position");
    // And an order about ammunition stops the shooting rather than only nudging it.
    expect(noOrder.fire).toBe(true);
    expect(conserving.fire).toBe(false);
  });

  it("produces a different outcome for at least half the orders", () => {
    const rows = compareOrders();
    const noOrder = rows.find((row) => row.order === "none")!;
    const changed = rows.filter(
      (row) => row.order !== "none" && (row.goal !== noOrder.goal || row.fire !== noOrder.fire),
    );
    expect(changed.length).toBeGreaterThanOrEqual(Math.floor((rows.length - 1) / 2));
  });
});

describe("allies without orders", () => {
  it("do something useful rather than standing still", () => {
    const run = runSquadTick();
    expect(run.goals).toHaveLength(2);
    for (const goal of run.goals) expect(goal).not.toBe("hold-position");
  });

  it("do not both attack the same part of the creature", () => {
    const run = runSquadTick();
    expect(new Set(run.zones).size).toBe(run.zones.length);
  });

  it("stop firing when a friendly is in the way", () => {
    const run = runSquadTick({ situation: { friendlyInLine: true } });
    expect(run.firing.every((firing) => !firing)).toBe(true);
  });

  it("look after themselves when the machine is nearly gone", () => {
    const run = runSquadTick({ situation: { healthFraction: 0.15 } });
    expect(run.goals).toContain("withdraw");
  });

  it("run the same way twice", () => {
    expect(runSquadTick().digest).toBe(runSquadTick().digest);
  });
});

describe("crews that learn", () => {
  it("pick up perks by flying, and say what changed", () => {
    const run = runSquadCampaign(12);
    expect(run.perks.length).toBeGreaterThan(0);
    expect(run.messages.join(" ")).toMatch(/learned/);
  });

  it("gain confidence from winning and lose it from not", () => {
    const winning = new Squad();
    const losing = new Squad();
    for (let index = 0; index < 6; index += 1) {
      winning.completeSortie({ missionId: `w.${index}`, crewIds: ["ally.karsten"], won: true, score: 1 });
      losing.completeSortie({ missionId: `l.${index}`, crewIds: ["ally.karsten"], won: false, score: 0.1 });
    }
    expect(winning.get("ally.karsten")!.confidence).toBeGreaterThan(losing.get("ally.karsten")!.confidence);
  });

  it("never let confidence run away in either direction", () => {
    const instance = squad();
    for (let index = 0; index < 200; index += 1) {
      instance.completeSortie({ missionId: `x.${index}`, crewIds: ["ally.karsten"], won: false, score: 0 });
    }
    expect(instance.get("ally.karsten")!.confidence).toBeGreaterThanOrEqual(0.2);
  });

  it("change what the crew decides once they have learned something", () => {
    const green = new Squad();
    const veteran = new Squad();
    for (let index = 0; index < 10; index += 1) {
      veteran.completeSortie({ missionId: `v.${index}`, crewIds: ["ally.karsten"], won: true, score: 0.9 });
    }
    expect(veteran.profileOf("ally.karsten").bias).not.toEqual(green.profileOf("ally.karsten").bias);
    expect(veteran.machineScalesOf("ally.karsten").damage).toBeGreaterThan(
      green.machineScalesOf("ally.karsten").damage,
    );
  });

  it("cannot be taught twice by the same sortie", () => {
    const instance = squad();
    const outcome = { missionId: "once", crewIds: ["ally.karsten"], won: true, score: 1 };
    const first = instance.completeSortie(outcome);
    const sorties = instance.get("ally.karsten")!.sorties;
    const second = instance.completeSortie(outcome);
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(instance.get("ally.karsten")!.sorties).toBe(sorties);
  });

  it("keeps an ally from ever outclassing the player's machine", () => {
    const instance = squad();
    for (let index = 0; index < 100; index += 1) {
      instance.completeSortie({ missionId: `m.${index}`, crewIds: ["ally.karsten"], won: true, score: 1 });
    }
    const scales = instance.machineScalesOf("ally.karsten");
    expect(scales.damage).toBeLessThan(1.2);
    expect(scales.structure).toBeLessThan(1.2);
  });
});

describe("the squad across a save", () => {
  it("keeps what crews became", async () => {
    const instance = squad();
    instance.assignMachine("ally.karsten", "heavy-mk4#1");
    for (let index = 0; index < 9; index += 1) {
      instance.completeSortie({ missionId: `s.${index}`, crewIds: ["ally.karsten"], won: true, score: 0.9 });
    }
    const perks = instance.perksOf("ally.karsten");
    const confidence = instance.get("ally.karsten")!.confidence;

    await service.save("slot.squad", kernel(), { name: "Squad", squad: instance.snapshot() });
    const loaded = await service.load("slot.squad");
    const reloaded = squad();
    reloaded.restore(loaded.document.squad);

    expect(reloaded.perksOf("ally.karsten")).toEqual(perks);
    expect(reloaded.get("ally.karsten")!.confidence).toBeCloseTo(confidence, 3);
    expect(reloaded.get("ally.karsten")!.machineId).toBe("heavy-mk4#1");
  });

  it("still refuses a sortie it already settled after a reload", async () => {
    const instance = squad();
    instance.completeSortie({ missionId: "persisted", crewIds: ["ally.karsten"], won: true, score: 1 });
    await service.save("slot.again", kernel(), { name: "Again", squad: instance.snapshot() });
    const loaded = await service.load("slot.again");
    const reloaded = squad();
    reloaded.restore(loaded.document.squad);
    const again = reloaded.completeSortie({
      missionId: "persisted",
      crewIds: ["ally.karsten"],
      won: true,
      score: 1,
    });
    expect(again.applied).toBe(false);
  });

  it("recomputes perks from the sorties that earned them", () => {
    const instance = squad();
    const snapshot = instance.snapshot();
    const tampered = {
      ...snapshot,
      members: snapshot.members.map((entry) =>
        entry.crewId === "ally.karsten"
          ? { ...entry, sorties: 0, learned: ["perk.ally.first-in", "perk.ally.takes-the-hit"] }
          : entry,
      ),
    };
    const reloaded = squad();
    reloaded.restore(tampered);
    expect(reloaded.get("ally.karsten")!.learned).toEqual([]);
    expect(reloaded.perksOf("ally.karsten")).toEqual([]);
  });

  it("does not bring a standing order's target back from a save", () => {
    const instance = squad();
    instance.issue("ally.karsten", "focus-target", { targetId: "kaiju.1" });
    const reloaded = squad();
    reloaded.restore(instance.snapshot());
    expect(reloaded.get("ally.karsten")!.markedTargetId).toBeNull();
    // The order itself is kept, because that is a standing instruction.
    expect(reloaded.orderOf("ally.karsten")?.id).toBe("focus-target");
  });
});
