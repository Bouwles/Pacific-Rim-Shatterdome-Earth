import { describe, expect, it } from "vitest";
import {
  RESOURCE_DEFINITIONS,
  RESOURCE_KINDS,
  TISSUE_VALUE,
  createResourceRegistry,
  emptyPool,
  tissueWorth,
  validateResource,
} from "../../src/world/resources";
import { emptyLedgerSnapshot, validateLedgerSnapshot } from "../../src/world/ledger";
import {
  DIFFICULTY_INCOME,
  Economy,
  contractReward,
  defenceReward,
  emptyEconomySnapshot,
  explorationFind,
  facilityIncome,
  manufacturerDeal,
  repairQuote,
  salvageRights,
  validateEconomySnapshot,
} from "../../src/world/economy";

const resources = createResourceRegistry();

function economy(funding = 1_000_000): Economy {
  return new Economy({ startingFunding: funding });
}

describe("the resource list", () => {
  it("all validate", () => {
    for (const entry of RESOURCE_DEFINITIONS) expect(validateResource(entry), entry.id).toEqual([]);
  });

  it("gives every resource somewhere to come from and something to spend it on", () => {
    for (const entry of resources.all()) {
      expect(entry.sources.length, entry.id).toBeGreaterThan(0);
      expect(entry.sinks.length, entry.id).toBeGreaterThan(0);
    }
  });

  it("refuses a resource with nothing to spend it on", () => {
    const base = resources.getOrThrow("alloy");
    expect(validateResource({ ...base, sinks: [] }).join(" ")).toMatch(/number that goes up/);
  });

  it("has no two resources that buy exactly the same things", () => {
    // The rule that keeps the list from inflating: a resource whose every sink
    // is another resource's sink is that resource under a second name.
    for (const first of RESOURCE_DEFINITIONS) {
      for (const second of RESOURCE_DEFINITIONS) {
        if (first.id >= second.id) continue;
        const shared = first.sinks.filter((sink) => second.sinks.includes(sink));
        const identical = shared.length === first.sinks.length && shared.length === second.sinks.length;
        expect(identical, `${first.id} and ${second.id}`).toBe(false);
      }
    }
  });

  it("keeps the list short enough to be a design rather than a spreadsheet", () => {
    expect(RESOURCE_KINDS.length).toBeLessThanOrEqual(7);
  });

  it("values tissue by class rather than by weight", () => {
    expect(TISSUE_VALUE.exotic).toBeGreaterThan(TISSUE_VALUE.rare);
    expect(TISSUE_VALUE.rare).toBeGreaterThan(TISSUE_VALUE.common);
    const pool = emptyPool();
    pool.tissue.exotic = 1;
    const exotic = tissueWorth(pool);
    pool.tissue.exotic = 0;
    pool.tissue.common = 1;
    expect(exotic).toBeGreaterThan(tissueWorth(pool));
  });
});

describe("the ledger", () => {
  it("records every change with a balance and a reason", () => {
    const instance = economy();
    instance.earn("funding", 5_000, { source: "government-contract", reason: "A contract.", day: 1 });
    instance.spend("funding", 2_000, { source: "repair", reason: "A repair.", day: 2 });

    const lines = instance.ledger.all();
    expect(lines).toHaveLength(2);
    expect(lines[0]!.amount).toBe(5_000);
    expect(lines[1]!.amount).toBe(-2_000);
    for (const line of lines) {
      expect(line.reason.length).toBeGreaterThan(0);
      expect(Number.isFinite(line.balanceAfter)).toBe(true);
    }
    expect(lines[1]!.balanceAfter).toBe(instance.balance("funding"));
  });

  it("has a line for every balance-affecting change, and none for a refused one", () => {
    const instance = economy(100);
    const refused = instance.spend("funding", 5_000, { source: "repair", reason: "Too dear.", day: 1 });
    expect(refused.ok).toBe(false);
    expect(instance.ledger.all()).toHaveLength(0);
    expect(instance.balance("funding")).toBe(100);
  });

  it("reconciles: the last line's balance is the balance held", () => {
    const instance = economy();
    for (let day = 1; day <= 30; day += 1) {
      instance.earn("funding", 1_000 + day, { source: "facility-income", reason: "Income.", day });
      instance.spend("funding", 400, { source: "upkeep", reason: "Upkeep.", day });
    }
    const lines = instance.ledger.forResource("funding");
    expect(lines[lines.length - 1]!.balanceAfter).toBe(instance.balance("funding"));
  });

  it("breaks income and spending down by where it came from", () => {
    const instance = economy();
    instance.earn("funding", 9_000, { source: "government-contract", reason: "Contract.", day: 1 });
    instance.earn("funding", 1_000, { source: "salvage-rights", reason: "Salvage.", day: 1 });
    instance.spend("funding", 4_000, { source: "upkeep", reason: "Upkeep.", day: 2 });

    const summary = instance.summarise("funding", 0, 10);
    expect(summary.income).toBe(10_000);
    expect(summary.expense).toBe(-4_000);
    expect(summary.net).toBe(6_000);
    expect(summary.bySource[0]!.source).toBe("government-contract");
  });

  it("forecasts from what actually happened rather than from optimism", () => {
    const instance = economy();
    for (let day = 1; day <= 10; day += 1) {
      instance.spend("funding", 1_000, { source: "upkeep", reason: "Upkeep.", day });
    }
    // Ten days of losing a thousand a day forecasts losing a thousand a day.
    expect(instance.ledger.forecast("funding", 1, 10, 10)).toBeCloseTo(-10_000, 0);
  });

  it("stays bounded however long a campaign runs", () => {
    const instance = economy(1e9);
    for (let day = 1; day <= 900; day += 1) {
      instance.spend("funding", 10, { source: "upkeep", reason: "Upkeep.", day });
    }
    expect(instance.ledger.all().length).toBeLessThanOrEqual(400);
    // And the last line still agrees with the balance.
    const lines = instance.ledger.forResource("funding");
    expect(lines[lines.length - 1]!.balanceAfter).toBe(instance.balance("funding"));
  });

  it("refuses a snapshot that is not one", () => {
    expect(validateLedgerSnapshot(null).length).toBeGreaterThan(0);
    expect(validateLedgerSnapshot({ ...emptyLedgerSnapshot(), schemaVersion: 99 })).toHaveLength(1);
    expect(validateLedgerSnapshot(emptyLedgerSnapshot())).toEqual([]);
  });
});

describe("nothing pays twice", () => {
  it("refuses a second payment against the same reference", () => {
    const instance = economy();
    const first = instance.earn("funding", 50_000, {
      source: "government-contract",
      reason: "Contract.",
      day: 1,
      reference: "mission.7",
    });
    const second = instance.earn("funding", 50_000, {
      source: "government-contract",
      reason: "Contract.",
      day: 1,
      reference: "mission.7",
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.message).toMatch(/already been paid/);
    expect(instance.balance("funding")).toBe(1_050_000);
  });

  it("still refuses it after a save and a load", () => {
    const instance = economy();
    instance.earn("funding", 50_000, {
      source: "government-contract",
      reason: "Contract.",
      day: 1,
      reference: "mission.persisted",
    });
    const restored = economy();
    restored.restore(instance.snapshot());

    const again = restored.earn("funding", 50_000, {
      source: "government-contract",
      reason: "Contract.",
      day: 1,
      reference: "mission.persisted",
    });
    expect(again.ok).toBe(false);
    expect(restored.balance("funding")).toBe(instance.balance("funding"));
  });

  it("lets anything without a reference recur, because upkeep should", () => {
    const instance = economy();
    for (let day = 1; day <= 5; day += 1) {
      expect(instance.spend("funding", 100, { source: "upkeep", reason: "Upkeep.", day }).ok).toBe(true);
    }
    expect(instance.balance("funding")).toBe(1_000_000 - 500);
  });

  it("does not let a refused claim burn the reference", () => {
    const instance = economy(10);
    // Cannot afford it, so nothing is claimed and a later attempt can succeed.
    expect(
      instance.spend("funding", 5_000, { source: "repair", reason: "Repair.", day: 1, reference: "job.1" })
        .ok,
    ).toBe(false);
    instance.earn("funding", 100_000, { source: "facility-income", reason: "Income.", day: 1 });
    expect(
      instance.spend("funding", 5_000, { source: "repair", reason: "Repair.", day: 2, reference: "job.1" })
        .ok,
    ).toBe(true);
  });
});

describe("balances", () => {
  it("lets the general fund go into debt only when the caller says so", () => {
    const instance = economy(100);
    expect(instance.spend("funding", 5_000, { source: "repair", reason: "Repair.", day: 1 }).ok).toBe(false);
    expect(
      instance.spend("funding", 5_000, { source: "upkeep", reason: "Upkeep.", day: 1, allowDebt: true }).ok,
    ).toBe(true);
    expect(instance.balance("funding")).toBeLessThan(0);
  });

  it("never lets a material go negative", () => {
    const instance = economy();
    expect(instance.spend("alloy", 5, { source: "repair", reason: "Plate.", day: 1 }).ok).toBe(false);
    expect(instance.balance("alloy")).toBe(0);
  });

  it("says how short it is rather than failing silently", () => {
    const instance = economy(100);
    const result = instance.spend("funding", 5_000, { source: "repair", reason: "Repair.", day: 1 });
    expect(result.message).toMatch(/Short by 4900/);
  });
});

describe("turning tissue into research", () => {
  it("is worth more for a rarer sample than for more of a common one", () => {
    const rare = economy();
    rare.earn("tissue", 1, { source: "salvage-rights", reason: "Sample.", day: 1, tissueClass: "exotic" });
    rare.convertTissue({ exotic: 1 }, { day: 1 });

    const bulk = economy();
    bulk.earn("tissue", 8, { source: "salvage-rights", reason: "Sample.", day: 1, tissueClass: "common" });
    bulk.convertTissue({ common: 8 }, { day: 1 });

    expect(rare.balance("researchData")).toBeGreaterThan(bulk.balance("researchData"));
  });

  it("consumes the tissue it worked up", () => {
    const instance = economy();
    instance.earn("tissue", 5, {
      source: "salvage-rights",
      reason: "Sample.",
      day: 1,
      tissueClass: "common",
    });
    instance.convertTissue({ common: 5 }, { day: 1 });
    expect(instance.balance("tissue")).toBe(0);
    expect(instance.balance("researchData")).toBeGreaterThan(0);
  });

  it("does nothing when there is nothing to work up", () => {
    const instance = economy();
    expect(instance.convertTissue({ common: 10 }, { day: 1 }).ok).toBe(false);
  });
});

describe("income formulas", () => {
  it("pay more for a bigger city, a worse creature and a higher escalation", () => {
    const base = {
      populationThousands: 4_000,
      threatStrength: 0.5,
      escalation: 0.2,
      objectiveScore: 1,
      contractYield: 1,
      difficulty: "standard" as const,
    };
    const plain = contractReward(base).funding;
    expect(contractReward({ ...base, populationThousands: 9_000 }).funding).toBeGreaterThan(plain);
    expect(contractReward({ ...base, threatStrength: 2 }).funding).toBeGreaterThan(plain);
    expect(contractReward({ ...base, escalation: 0.9 }).funding).toBeGreaterThan(plain);
  });

  it("pay nothing for a sortie that achieved nothing", () => {
    expect(
      contractReward({
        populationThousands: 4_000,
        threatStrength: 1,
        escalation: 1,
        objectiveScore: 0,
        contractYield: 1,
        difficulty: "standard",
      }).funding,
    ).toBe(0);
  });

  it("make standing down worse than going, but not ruinous", () => {
    const going = contractReward({
      populationThousands: 6_000,
      threatStrength: 1,
      escalation: 0.5,
      objectiveScore: 0.85,
      contractYield: 1,
      difficulty: "standard",
    }).funding;
    const staying = defenceReward({
      populationThousands: 6_000,
      defenceStrength: 1.2,
      difficulty: "standard",
    });
    expect(staying).toBeLessThan(going);
    expect(staying).toBeGreaterThan(0);
  });

  it("return materials from salvage rather than money", () => {
    const salvage = salvageRights({
      massTons: 2_000,
      objectiveScore: 1,
      researchYield: 1,
      mutationCount: 4,
    });
    expect(salvage.alloy).toBeGreaterThan(0);
    expect(salvage.tissue.exotic).toBeGreaterThan(0);
    // A creature carrying nothing unusual yields nothing exotic.
    const plain = salvageRights({ massTons: 2_000, objectiveScore: 1, researchYield: 1, mutationCount: 0 });
    expect(plain.tissue.exotic).toBe(0);
  });

  it("give a yard arrangement only to somebody a yard likes", () => {
    expect(manufacturerDeal({ reputation: 0.4, days: 7, difficulty: "standard" }).funding).toBe(0);
    expect(manufacturerDeal({ reputation: 0.9, days: 7, difficulty: "standard" }).funding).toBeGreaterThan(0);
  });

  it("pay facility income only for what was actually built", () => {
    expect(
      facilityIncome({ contractYield: 1, containmentYield: 1, days: 30, difficulty: "standard" }).funding,
    ).toBe(0);
    expect(
      facilityIncome({ contractYield: 1.4, containmentYield: 1, days: 30, difficulty: "standard" }).funding,
    ).toBeGreaterThan(0);
  });

  it("pay for going somewhere nobody has been", () => {
    const near = explorationFind({ distanceKm: 50, sectorsSeen: 1, difficulty: "standard" });
    const far = explorationFind({ distanceKm: 900, sectorsSeen: 5, difficulty: "standard" });
    expect(far.funding).toBeGreaterThan(near.funding);
    expect(far.researchData).toBeGreaterThan(0);
  });

  it("scale with difficulty, and only income", () => {
    const of = (difficulty: "generous" | "standard" | "lean") =>
      contractReward({
        populationThousands: 5_000,
        threatStrength: 1,
        escalation: 0.5,
        objectiveScore: 1,
        contractYield: 1,
        difficulty,
      }).funding;
    expect(of("generous")).toBeGreaterThan(of("standard"));
    expect(of("standard")).toBeGreaterThan(of("lean"));
    expect(DIFFICULTY_INCOME.standard).toBe(1);
  });
});

describe("what a repair costs", () => {
  const base = {
    armourMissing: 1_200,
    componentMissing: 400,
    rarityMultiplier: 1,
    alloyAvailable: 0,
    componentsAvailable: 0,
    bayCapability: 1,
    urgency: 1,
    insuredFraction: 0,
  };

  it("costs more for more damage", () => {
    expect(repairQuote({ ...base, armourMissing: 2_400 }).total).toBeGreaterThan(repairQuote(base).total);
  });

  it("costs more for a rarer machine", () => {
    expect(repairQuote({ ...base, rarityMultiplier: 1.6 }).total).toBeGreaterThan(repairQuote(base).total);
  });

  it("costs less when the stores already have the materials", () => {
    const stocked = repairQuote({ ...base, alloyAvailable: 999, componentsAvailable: 999 });
    expect(stocked.materialsBoughtIn).toBe(0);
    expect(stocked.total).toBeLessThan(repairQuote(base).total);
  });

  it("costs less in a better bay", () => {
    expect(repairQuote({ ...base, bayCapability: 1.9 }).total).toBeLessThan(repairQuote(base).total);
  });

  it("costs more when it is wanted now", () => {
    const rushed = repairQuote({ ...base, urgency: 1.5 });
    expect(rushed.urgencySurcharge).toBeGreaterThan(0);
    expect(rushed.total).toBeGreaterThan(repairQuote(base).total);
  });

  it("costs less when somebody else is covering part of it", () => {
    const covered = repairQuote({ ...base, insuredFraction: 0.5 });
    expect(covered.insured).toBeGreaterThan(0);
    expect(covered.total).toBeLessThan(repairQuote(base).total);
  });

  it("breaks the bill down rather than giving one number", () => {
    const quote = repairQuote({ ...base, urgency: 1.4, insuredFraction: 0.2 });
    expect(quote.lines.length).toBeGreaterThan(2);
    expect(quote.lines.some((line) => line.label === "Labour")).toBe(true);
    // Every line has to add up to the total.
    const summed = quote.lines.reduce((total, line) => total + line.amount, 0);
    expect(summed).toBe(quote.total);
  });

  it("never bills a negative amount", () => {
    expect(repairQuote({ ...base, insuredFraction: 1 }).total).toBe(0);
    expect(repairQuote({ ...base, armourMissing: 0, componentMissing: 0 }).total).toBe(0);
  });
});

describe("the economy across a save", () => {
  it("brings back every balance and the difficulty", () => {
    const instance = economy();
    instance.setDifficulty("lean");
    instance.earn("alloy", 12, { source: "salvage-rights", reason: "Salvage.", day: 1 });
    instance.earn("tissue", 3, { source: "salvage-rights", reason: "Sample.", day: 1, tissueClass: "rare" });

    const restored = economy(0);
    restored.restore(instance.snapshot());
    expect(restored.balance("funding")).toBe(instance.balance("funding"));
    expect(restored.balance("alloy")).toBe(12);
    expect(restored.pool.tissue.rare).toBe(3);
    expect(restored.difficulty).toBe("lean");
  });

  it("brings back the ledger so a campaign can still be read", () => {
    const instance = economy();
    instance.earn("funding", 1_000, { source: "government-contract", reason: "Contract.", day: 4 });
    const restored = economy(0);
    restored.restore(instance.snapshot());
    expect(restored.ledger.all()).toHaveLength(1);
    expect(restored.ledger.all()[0]!.reason).toBe("Contract.");
  });

  it("refuses a snapshot that is not one", () => {
    expect(validateEconomySnapshot(null).length).toBeGreaterThan(0);
    expect(validateEconomySnapshot({ ...emptyEconomySnapshot(), schemaVersion: 99 })).toHaveLength(1);
    expect(validateEconomySnapshot(emptyEconomySnapshot())).toEqual([]);
  });

  it("drops a ledger line naming something this build does not have", () => {
    const instance = economy();
    instance.earn("funding", 100, { source: "government-contract", reason: "Contract.", day: 1 });
    const snapshot = instance.snapshot();
    const tampered = {
      ...snapshot,
      ledger: {
        ...snapshot.ledger,
        entries: [{ ...snapshot.ledger.entries[0]!, resource: "unobtainium" as never }],
      },
    };
    const restored = economy(0);
    restored.restore(tampered);
    expect(restored.ledger.all()).toHaveLength(0);
  });
});
