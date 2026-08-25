import { beforeEach, describe, expect, it } from "vitest";
import { Market, ROTATION_DAYS } from "../../src/world/market";
import { Roster } from "../../src/jaegers/roster";
import { jaegerRegistry } from "../../src/data/jaegers";
import { createComponentRegistry } from "../../src/data/components";
import { createManufacturerRegistry } from "../../src/data/manufacturers";
import { MemorySaveRepository } from "../../src/saves/repository";
import { SaveService } from "../../src/saves/saveService";
import { SimulationKernel } from "../../src/simulation/kernel";
import { runMarketScenario, MARKET_SCENARIO_SEED } from "../../src/debug/marketScenario";

/**
 * The acquisition loop, end to end.
 *
 * These are the three things the milestone is actually judged on: buying takes
 * the money once and produces one machine, the board is the save's board and
 * not a slot machine, and an old Mark is still worth owning.
 */

const components = createComponentRegistry();
const makers = createManufacturerRegistry();
const SEED = 20260825;

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

describe("buying a machine", () => {
  it("creates exactly one owned instance and deducts the price once", () => {
    const market = new Market({ seed: SEED, startingFunding: 30_000_000 });
    const roster = new Roster(jaegerRegistry, components);
    const ownedBefore = roster.all().length;
    const fundingBefore = market.treasury.funding;

    const offer = market.offers()[0]!;
    const result = market.purchase(offer.id);
    expect(result.ok).toBe(true);

    // The money leaves once, at signing, not again on delivery.
    expect(market.treasury.funding).toBe(fundingBefore - offer.price);
    expect(roster.all().length).toBe(ownedBefore);

    // Nothing arrives early.
    for (let day = 1; day < offer.leadTimeDays; day += 1) {
      expect(market.advanceDays(1)).toEqual([]);
    }
    const arrivals = market.advanceDays(1);
    expect(arrivals).toHaveLength(1);

    for (const arrival of arrivals) {
      roster.acquire({ chassisId: arrival.chassisId, acquiredBy: "purchase", day: 30, wear: arrival.wear });
    }
    expect(roster.all().length).toBe(ownedBefore + 1);
    expect(market.treasury.funding).toBe(fundingBefore - offer.price);

    // And running the clock on does not deliver a second one.
    expect(market.advanceDays(60)).toEqual([]);
    expect(roster.all().length).toBe(ownedBefore + 1);
  });

  it("gives the new machine its own identity rather than replacing a chassis", () => {
    const roster = new Roster(jaegerRegistry, components);
    const first = roster.acquire({ chassisId: "veteran-mk1", acquiredBy: "purchase", day: 1 })!;
    const second = roster.acquire({ chassisId: "veteran-mk1", acquiredBy: "purchase", day: 2 })!;

    expect(first.jaegerId).not.toBe(second.jaegerId);
    expect(first.serial).not.toBe(second.serial);
    expect(first.chassisId).toBe("veteran-mk1");
    expect(second.chassisId).toBe("veteran-mk1");
    // Both resolve to the same chassis row, so nothing downstream needs to know
    // there are two of them.
    expect(roster.definition(first.jaegerId).id).toBe("veteran-mk1");
    expect(roster.definition(second.jaegerId).id).toBe("veteran-mk1");
    expect(first.history[0]?.event).toMatch(/Acquired by purchase/);
  });

  it("delivers a refurbished hull worn rather than perfect, and it can be repaired to ready", () => {
    const roster = new Roster(jaegerRegistry, components);
    const worn = roster.acquire({
      chassisId: "veteran-mk1",
      acquiredBy: "recovery-rebuild",
      day: 5,
      wear: 0.3,
    })!;
    expect(worn.status).toBe("repairing");
    expect(roster.canDeploy(worn.jaegerId).ok).toBe(false);

    for (let shift = 0; shift < 400 && roster.getOrThrow(worn.jaegerId).status !== "ready"; shift += 1) {
      roster.work(worn.jaegerId, 8);
    }
    expect(roster.getOrThrow(worn.jaegerId).status).toBe("ready");
    expect(roster.canDeploy(worn.jaegerId).ok).toBe(true);
  });

  it("cannot be afforded twice over", () => {
    // Enough for one machine and not for the board, which is the ordinary case.
    const market = new Market({ seed: SEED, startingFunding: 4_000_000 });
    let spent = 0;
    let refused = 0;
    for (const offer of market.offers()) {
      const result = market.purchase(offer.id);
      if (result.ok) spent += result.spent;
      else refused += 1;
    }
    expect(market.treasury.funding).toBe(4_000_000 - spent);
    expect(market.treasury.funding).toBeGreaterThanOrEqual(0);
    // A board worth more than the treasury has to refuse something.
    expect(refused).toBeGreaterThan(0);
  });
});

describe("the board across a save", () => {
  it("is the same board after writing and loading the save", async () => {
    const market = new Market({ seed: SEED, startingFunding: 18_000_000 });
    const before = market.offers().map((offer) => offer.id);
    const offer = market.offers()[0]!;
    market.purchase(offer.id);
    market.advanceDays(4);

    await service.save("slot.market", kernel(), { name: "Market", market: market.snapshot() });
    const loaded = await service.load("slot.market");

    const restored = new Market({ seed: SEED });
    restored.restore(loaded.document.market);

    // The board is the board: same offers minus the one that was signed.
    expect(restored.offers().map((entry) => entry.id)).toEqual(before.filter((id) => id !== offer.id));
    expect(restored.treasury.funding).toBe(market.treasury.funding);
    expect(restored.pending()).toHaveLength(1);
    expect(restored.pending()[0]!.chassisId).toBe(offer.chassisId);
  });

  it("cannot be rerolled by reloading the page repeatedly", async () => {
    const market = new Market({ seed: SEED, startingFunding: 18_000_000 });
    const original = market.offers().map((entry) => entry.id);
    await service.save("slot.reroll", kernel(), { name: "Reroll", market: market.snapshot() });

    for (let reload = 0; reload < 5; reload += 1) {
      const loaded = await service.load("slot.reroll");
      const fresh = new Market({ seed: SEED });
      fresh.restore(loaded.document.market);
      expect(fresh.offers().map((entry) => entry.id)).toEqual(original);
    }
  });

  it("turns over on the calendar, and the next board is the same next board after a reload", async () => {
    const market = new Market({ seed: SEED, startingFunding: 18_000_000 });
    const first = market.offers().map((entry) => entry.id);

    await service.save("slot.rotate", kernel(), { name: "Rotate", market: market.snapshot() });
    const loaded = await service.load("slot.rotate");
    const restored = new Market({ seed: SEED });
    restored.restore(loaded.document.market);

    market.advanceDays(ROTATION_DAYS);
    restored.advanceDays(ROTATION_DAYS);

    const next = market.offers().map((entry) => entry.id);
    expect(next).not.toEqual(first);
    expect(restored.offers().map((entry) => entry.id)).toEqual(next);
  });

  it("keeps ownership of machines bought in a previous session", async () => {
    const roster = new Roster(jaegerRegistry, components);
    const bought = roster.acquire({ chassisId: "veteran-mk1", acquiredBy: "purchase", day: 12 })!;
    roster.record(bought.jaegerId, 14, "First patrol.");

    await service.save("slot.owned", kernel(), { name: "Owned", roster: roster.snapshot() });
    const loaded = await service.load("slot.owned");

    const reloaded = new Roster(jaegerRegistry, components);
    reloaded.restore(loaded.document.roster);
    const record = reloaded.get(bought.jaegerId);
    expect(record).toBeDefined();
    expect(record!.serial).toBe(bought.serial);
    expect(record!.chassisId).toBe("veteran-mk1");
    expect(record!.history.map((entry) => entry.event)).toContain("First patrol.");
  });
});

describe("an old Mark", () => {
  const oldMark = jaegerRegistry.getOrThrow("veteran-mk1");
  // The newest thing on the board, which means the newest thing anybody sells:
  // the research frames have a later generation and no seller.
  const newMark = [...jaegerRegistry.all()]
    .filter((chassis) => chassis.acquisition.includes("purchase"))
    .sort((a, b) => b.markGeneration - a.markGeneration)[0]!;

  it("is affordable next to the newest thing on the board", () => {
    expect(oldMark.listPrice).toBeLessThan(newMark.listPrice);
    expect(oldMark.upkeepPerDay).toBeLessThan(newMark.upkeepPerDay);

    // A campaign that can afford one new machine can afford more than one old one.
    expect(Math.floor(newMark.listPrice / oldMark.listPrice)).toBeGreaterThanOrEqual(2);
  });

  it("is distinctive rather than a worse copy", () => {
    expect(oldMark.role).not.toBe(newMark.role);
    expect(oldMark.balance.tradeoff).not.toBe(newMark.balance.tradeoff);
    // It wins somewhere. An old machine that loses on every axis is not a choice.
    const axes = ["durability", "damage", "mobility", "range"] as const;
    const wins = axes.filter((axis) => oldMark.balance[axis][1] > newMark.balance[axis][1]);
    expect(wins.length).toBeGreaterThan(0);
  });

  it("is upgradeable further than the newest, which is how it stays viable", () => {
    const steps = (chassis: typeof oldMark): number =>
      chassis.upgradeTracks.reduce((total, track) => total + track.steps, 0);
    expect(steps(oldMark)).toBeGreaterThan(steps(newMark));
    expect(oldMark.upgradeTracks.length).toBeGreaterThanOrEqual(3);
    for (const track of oldMark.upgradeTracks) {
      expect(track.steps).toBeGreaterThan(0);
      expect(track.effect.length).toBeGreaterThan(10);
    }
  });

  it("can be bought, fielded, and sent out", () => {
    const roster = new Roster(jaegerRegistry, components);
    const record = roster.acquire({ chassisId: "veteran-mk1", acquiredBy: "purchase", day: 20 })!;
    expect(record.status).toBe("ready");
    expect(roster.canDeploy(record.jaegerId).ok).toBe(true);
    expect(record.loadout.length).toBeGreaterThan(0);
  });

  it("can also arrive without money at all, through a path that is not the market", () => {
    const market = new Market({ seed: SEED, startingFunding: 0 });
    const result = market.unlock("veteran-mk1", "recovery-rebuild");
    expect(result.ok).toBe(true);
    expect(market.treasury.funding).toBe(0);
  });
});

describe("a campaign of buying", () => {
  it("runs the same way twice from the same seed", () => {
    const first = runMarketScenario({ seed: MARKET_SCENARIO_SEED });
    const second = runMarketScenario({ seed: MARKET_SCENARIO_SEED });
    expect(second.digest).toBe(first.digest);
    expect(second.ownedAfter).toBe(first.ownedAfter);
    expect(second.fundingAfter).toBe(first.fundingAfter);
  });

  it("rotates the board, spends money, and hands over machines", () => {
    const run = runMarketScenario({ days: 90 });
    expect(run.rotations).toBeGreaterThanOrEqual(6);
    expect(run.boards.length).toBe(run.rotations + 1);
    expect(run.purchases.length).toBeGreaterThan(0);
    expect(run.delivered.length).toBe(run.purchases.length);
    expect(run.upkeepPaid).toBeGreaterThan(0);
    // Everything bought is owned, on top of what the campaign started with.
    expect(run.ownedAfter).toBeGreaterThan(run.delivered.length);
  });

  it("charges upkeep on what is owned and never on what is not", () => {
    const idle = runMarketScenario({ days: 20, buyWhenAffordable: false });
    const busy = runMarketScenario({ days: 20 });
    expect(busy.upkeepPaid).toBeGreaterThanOrEqual(idle.upkeepPaid);
    expect(idle.purchases).toHaveLength(0);
    expect(idle.delivered).toHaveLength(0);
  });

  it("spreads its offers over more than one yard", () => {
    const run = runMarketScenario({ days: 120, buyWhenAffordable: false });
    const yards = new Set<string>();
    for (const board of run.boards) for (const offer of board) yards.add(offer.manufacturerId);
    expect(yards.size).toBeGreaterThan(1);
    for (const id of yards) expect(makers.get(id)).toBeDefined();
  });
});
