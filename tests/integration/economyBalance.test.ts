import { beforeEach, describe, expect, it } from "vitest";
import {
  STRATEGIES,
  compareDifficulties,
  compareStrategies,
  runEconomyScenario,
} from "../../src/debug/economyScenario";
import { Economy, repairQuote } from "../../src/world/economy";
import { MemorySaveRepository } from "../../src/saves/repository";
import { SaveService } from "../../src/saves/saveService";
import { SimulationKernel } from "../../src/simulation/kernel";

/**
 * The economy over a campaign rather than over a call.
 *
 * These are the acceptance questions: does ordinary play make progress without
 * the decisions evaporating, does every way of playing survive, and can a
 * reward be paid twice by any route a player can actually take.
 */

const SEED = 20260829;

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

describe("a year of play", () => {
  it("runs the same way twice from the same seed", () => {
    expect(runEconomyScenario().digest).toBe(runEconomyScenario().digest);
  });

  it("keeps the ledger and the balance in agreement over hundreds of days", () => {
    for (const run of compareStrategies(360)) {
      expect(run.reconciles, run.strategy).toBe(true);
    }
  });

  it("lets ordinary play make steady progress", () => {
    // Picking your battles is the ordinary way to play. A year of it should
    // leave the programme better off than it started, without being rich.
    const run = runEconomyScenario({ strategy: "pick-battles", days: 360 });
    expect(run.daysInDebt).toBe(0);
    expect(run.fundingEnd).toBeGreaterThan(0);
    expect(run.sorties).toBeGreaterThan(50);
  });

  it("leaves purchase decisions meaningful rather than trivial", () => {
    // A year of ordinary play should not pay for the entire catalogue. The
    // cheapest machine is 2.9M and the dearest 7.8M, so a surplus that buys
    // everything several times over would mean money had stopped mattering.
    const run = runEconomyScenario({ strategy: "pick-battles", days: 360 });
    expect(run.fundingEnd).toBeLessThan(7_800_000 * 2);
  });

  it("leaves repair a real cost rather than a formality", () => {
    // Repairs have to be a visible share of what a campaign spends, or the
    // decision to fly a damaged machine is not a decision.
    const run = runEconomyScenario({ strategy: "fly-everything", days: 360 });
    expect(run.repairsPaid).toBeGreaterThan(50);
  });

  it("rewards playing over not playing", () => {
    const flying = runEconomyScenario({ strategy: "fly-everything", days: 360 });
    const staying = runEconomyScenario({ strategy: "stand-down", days: 360 });
    expect(flying.fundingEnd).toBeGreaterThan(staying.fundingEnd);
  });

  it("leaves every way of playing survivable", () => {
    // Standing down a lot should be worse and still playable: a strategy that
    // ends the campaign is a trap rather than a choice.
    for (const strategy of STRATEGIES) {
      const run = runEconomyScenario({ strategy, days: 360 });
      expect(run.daysInDebt, strategy).toBeLessThan(run.days * 0.25);
    }
  });

  it("makes an over-extended programme struggle, which is the point of upkeep", () => {
    const stretched = runEconomyScenario({
      strategy: "fly-everything",
      difficulty: "lean",
      upkeepPerDay: 70_000,
      days: 360,
    });
    expect(stretched.daysInDebt).toBeGreaterThan(0);
    expect(stretched.repairsDeferred).toBeGreaterThan(0);
  });

  it("moves with difficulty in the direction it says, and only income", () => {
    const [generous, standard, lean] = compareDifficulties("pick-battles", 360);
    expect(generous!.fundingEnd).toBeGreaterThan(standard!.fundingEnd);
    expect(standard!.fundingEnd).toBeGreaterThan(lean!.fundingEnd);
    // Difficulty does not change how often the player flies or what breaks.
    expect(generous!.sorties).toBe(lean!.sorties);
    expect(generous!.repairsPaid + generous!.repairsDeferred).toBe(lean!.repairsPaid + lean!.repairsDeferred);
  });

  it("does not reward grinding the same easy thing", () => {
    // Flying everything pays more than picking battles, but not proportionally:
    // half again the sorties must not be half again the money, or the optimal
    // way to play is to repeat the cheapest fight forever.
    const flying = runEconomyScenario({ strategy: "fly-everything", days: 360 });
    const picking = runEconomyScenario({ strategy: "pick-battles", days: 360 });
    const sortieRatio = flying.sorties / picking.sorties;
    const moneyRatio = flying.fundingEnd / Math.max(1, picking.fundingEnd);
    expect(moneyRatio).toBeLessThan(sortieRatio * 2);
  });
});

describe("a reward cannot be taken twice", () => {
  it("survives an abort and a retry of the same mission", () => {
    const economy = new Economy({ startingFunding: 1_000_000 });
    const pay = () =>
      economy.earn("funding", 80_000, {
        source: "government-contract",
        reason: "Contract settled.",
        day: 3,
        reference: "mission.42",
      });
    expect(pay().ok).toBe(true);
    // Aborting and flying it again hands the same result back.
    expect(pay().ok).toBe(false);
    expect(pay().ok).toBe(false);
    expect(economy.balance("funding")).toBe(1_080_000);
  });

  it("survives a save and a reload", async () => {
    const economy = new Economy({ startingFunding: 1_000_000 });
    economy.earn("funding", 80_000, {
      source: "government-contract",
      reason: "Contract settled.",
      day: 3,
      reference: "mission.saved",
    });

    await service.save("slot.economy", kernel(), { name: "Economy", economy: economy.snapshot() });
    const loaded = await service.load("slot.economy");
    const restored = new Economy();
    restored.restore(loaded.document.economy);

    const again = restored.earn("funding", 80_000, {
      source: "government-contract",
      reason: "Contract settled.",
      day: 3,
      reference: "mission.saved",
    });
    expect(again.ok).toBe(false);
    expect(restored.balance("funding")).toBe(1_080_000);
  });

  it("survives the same client reconnecting and replaying its result", () => {
    // The co-op case is the same case: a second copy of one result.
    const economy = new Economy({ startingFunding: 0 });
    const result = { reference: "mission.coop.9", amount: 50_000 };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      economy.earn("funding", result.amount, {
        source: "government-contract",
        reason: "Contract settled.",
        day: 1,
        reference: result.reference,
      });
    }
    expect(economy.balance("funding")).toBe(50_000);
    expect(economy.ledger.all()).toHaveLength(1);
  });

  it("keeps paying things that are supposed to recur", () => {
    const economy = new Economy({ startingFunding: 1_000_000 });
    for (let day = 1; day <= 10; day += 1) {
      economy.earn("funding", 1_000, { source: "facility-income", reason: "Income.", day });
    }
    expect(economy.balance("funding")).toBe(1_010_000);
  });
});

describe("repair decisions stay real", () => {
  it("is dearer to rush and cheaper to have the parts in", () => {
    const context = {
      armourMissing: 1_800,
      componentMissing: 600,
      rarityMultiplier: 1.2,
      alloyAvailable: 0,
      componentsAvailable: 0,
      bayCapability: 1.3,
      urgency: 1,
      insuredFraction: 0.2,
    };
    const patient = repairQuote(context);
    const rushed = repairQuote({ ...context, urgency: 1.6 });
    const stocked = repairQuote({ ...context, alloyAvailable: 99, componentsAvailable: 99 });
    expect(rushed.total).toBeGreaterThan(patient.total);
    expect(stocked.total).toBeLessThan(patient.total);
    // And every one of those is a line the player can read.
    expect(patient.lines.map((line) => line.label)).toContain("Labour");
  });

  it("makes a heavily damaged machine a decision rather than a formality", () => {
    const light = repairQuote({
      armourMissing: 200,
      componentMissing: 50,
      rarityMultiplier: 1,
      alloyAvailable: 0,
      componentsAvailable: 0,
      bayCapability: 1,
      urgency: 1,
      insuredFraction: 0,
    });
    const heavy = repairQuote({
      armourMissing: 3_400,
      componentMissing: 1_200,
      rarityMultiplier: 1.4,
      alloyAvailable: 0,
      componentsAvailable: 0,
      bayCapability: 1,
      urgency: 1,
      insuredFraction: 0,
    });
    // A bad sortie has to cost enough that flying it again hurt is a choice.
    expect(heavy.total).toBeGreaterThan(light.total * 8);
  });
});
