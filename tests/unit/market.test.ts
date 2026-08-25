import { describe, expect, it } from "vitest";
import {
  MANUFACTURER_DEFINITIONS,
  createManufacturerRegistry,
  leadTimeFor,
  priceFor,
  validateManufacturer,
} from "../../src/data/manufacturers";
import { ACQUISITION_PATHS, CHASSIS_PROVENANCE, CHASSIS_ROLES, jaegerRegistry } from "../../src/data/jaegers";
import {
  MAX_OFFERS,
  Market,
  ROTATION_DAYS,
  emptyMarketSnapshot,
  validateMarketSnapshot,
} from "../../src/world/market";
import { compareGenerations, rerollAttempt } from "../../src/debug/marketScenario";

const makers = createManufacturerRegistry();

function market(seed = 1, funding = 20_000_000): Market {
  return new Market({ seed, startingFunding: funding });
}

describe("manufacturers", () => {
  it("ships yards that all validate", () => {
    for (const maker of MANUFACTURER_DEFINITIONS) {
      expect(validateManufacturer(maker), maker.id).toEqual([]);
    }
  });

  it("refuses a yard with no conditions on its contracts", () => {
    const base = makers.getOrThrow("maker.tarrant-yards");
    expect(validateManufacturer({ ...base, conditions: [] }).join(" ")).toMatch(/nobody has read/);
  });

  it("refuses instant delivery", () => {
    const base = makers.getOrThrow("maker.tarrant-yards");
    expect(validateManufacturer({ ...base, leadTimeDays: 0 }).join(" ")).toMatch(/positive integer/);
  });

  it("charges less and delivers sooner for a better standing, but never instantly", () => {
    const maker = makers.getOrThrow("maker.hanjin-dynamics");
    expect(priceFor(maker, 1_000_000, 1)).toBeLessThan(priceFor(maker, 1_000_000, 0));
    expect(leadTimeFor(maker, 1)).toBeLessThan(leadTimeFor(maker, 0));
    expect(leadTimeFor(maker, 1)).toBeGreaterThan(0);
  });
});

describe("the chassis table", () => {
  it("gives every machine market metadata that validates", () => {
    for (const chassis of jaegerRegistry.all()) {
      expect(chassis.manufacturerId.startsWith("maker."), chassis.id).toBe(true);
      expect(makers.get(chassis.manufacturerId), chassis.id).toBeDefined();
      expect(CHASSIS_PROVENANCE).toContain(chassis.provenance);
      expect(CHASSIS_ROLES).toContain(chassis.role);
      expect(chassis.acquisition.length).toBeGreaterThan(0);
      for (const path of chassis.acquisition) expect(ACQUISITION_PATHS).toContain(path);
    }
  });

  it("describes performance as ranges with a tradeoff, never one number", () => {
    for (const chassis of jaegerRegistry.all()) {
      for (const band of [
        chassis.balance.durability,
        chassis.balance.damage,
        chassis.balance.mobility,
        chassis.balance.range,
      ]) {
        expect(band).toHaveLength(2);
        expect(band[0]).toBeLessThanOrEqual(band[1]);
      }
      expect(chassis.balance.tradeoff.length).toBeGreaterThan(10);
    }
  });

  it("keeps an older Mark affordable, distinctive and upgradeable", () => {
    const { oldest, newest } = compareGenerations();
    // Cheaper to buy and cheaper to keep.
    expect(oldest.price).toBeLessThan(newest.price);
    expect(oldest.upkeep).toBeLessThan(newest.upkeep);
    // And upgradeable further, which is how it stays worth flying.
    expect(oldest.steps).toBeGreaterThan(newest.steps);
    // Its ceiling is not lower: it gets there differently, not less far.
    expect(oldest.peak).toBeGreaterThanOrEqual(newest.peak * 0.95);
  });
});

describe("the market board", () => {
  it("shows offers built from the tables rather than from named cards", () => {
    const offers = market().offers();
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.length).toBeLessThanOrEqual(MAX_OFFERS);
    for (const offer of offers) {
      expect(jaegerRegistry.get(offer.chassisId), offer.id).toBeDefined();
      expect(makers.get(offer.manufacturerId), offer.id).toBeDefined();
      expect(offer.price).toBeGreaterThan(0);
      expect(offer.leadTimeDays).toBeGreaterThan(0);
      expect(offer.conditions.length).toBeGreaterThan(0);
    }
  });

  it("cannot be rerolled by asking again or by reloading", () => {
    const { first, second, afterReload } = rerollAttempt();
    expect(second).toEqual(first);
    expect(afterReload).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it("shows a different board on a different seed", () => {
    const a = market(1)
      .offers()
      .map((offer) => offer.id);
    const b = market(2)
      .offers()
      .map((offer) => offer.id);
    expect(a).not.toEqual(b);
  });

  it("rotates on its own schedule and not before", () => {
    const instance = market();
    const before = instance.offers().map((offer) => offer.id);
    instance.advanceDays(ROTATION_DAYS - 1);
    expect(instance.rotation).toBe(0);
    expect(instance.offers().map((offer) => offer.id)).toEqual(before);
    instance.advanceDays(1);
    expect(instance.rotation).toBe(1);
  });

  it("previews honestly, with bands and a tradeoff", () => {
    const instance = market();
    const offer = instance.offers()[0]!;
    const preview = instance.preview(offer.id)!;
    expect(preview.bands).toHaveLength(4);
    for (const band of preview.bands) {
      expect(band.low).toBeLessThanOrEqual(band.high);
      expect(band.label.length).toBeGreaterThan(0);
    }
    expect(preview.tradeoff.length).toBeGreaterThan(10);
    expect(preview.upkeepPerDay).toBeGreaterThan(0);
    expect(preview.conditions.length).toBeGreaterThan(0);
    // No single power number anywhere in the preview.
    expect(Object.keys(preview)).not.toContain("power");
    expect(Object.keys(preview)).not.toContain("rating");
  });
});

describe("buying", () => {
  it("deducts once and creates exactly one delivery", () => {
    const instance = market();
    const offer = instance.offers()[0]!;
    const before = instance.treasury.funding;

    const result = instance.purchase(offer.id);
    expect(result.ok).toBe(true);
    expect(result.spent).toBe(offer.price);
    expect(instance.treasury.funding).toBe(before - offer.price);
    expect(instance.pending()).toHaveLength(1);

    // The same offer cannot be bought twice, and nothing further is deducted.
    const again = instance.purchase(offer.id);
    expect(again.ok).toBe(false);
    expect(again.spent).toBe(0);
    expect(instance.treasury.funding).toBe(before - offer.price);
    expect(instance.pending()).toHaveLength(1);
  });

  it("takes the offer off the board once it is signed", () => {
    const instance = market();
    const offer = instance.offers()[0]!;
    instance.purchase(offer.id);
    expect(instance.offers().map((entry) => entry.id)).not.toContain(offer.id);
  });

  it("refuses what cannot be afforded, and says how short", () => {
    const instance = market(1, 1_000);
    const offer = instance.offers()[0]!;
    const result = instance.purchase(offer.id);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Short by/);
    expect(instance.treasury.funding).toBe(1_000);
  });

  it("delivers only after the lead time, never immediately", () => {
    const instance = market();
    const offer = instance.offers()[0]!;
    instance.purchase(offer.id);
    expect(instance.advanceDays(offer.leadTimeDays - 1)).toEqual([]);
    const delivered = instance.advanceDays(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.chassisId).toBe(offer.chassisId);
  });

  it("improves standing with a yard you buy from", () => {
    const instance = market();
    const offer = instance.offers()[0]!;
    const before = instance.reputationFor(offer.manufacturerId);
    instance.purchase(offer.id);
    expect(instance.reputationFor(offer.manufacturerId)).toBeGreaterThan(before);
  });
});

describe("acquisition outside the market", () => {
  it("unlocks by milestone, research, rebuild or archive", () => {
    const instance = market();
    expect(instance.unlock("veteran-mk1", "legendary-archive").ok).toBe(true);
    expect(instance.unlocked().map((entry) => entry.chassisId)).toContain("veteran-mk1");
  });

  it("refuses a path the chassis does not offer, in words", () => {
    const instance = market();
    const result = instance.unlock("agile-mk5", "legendary-archive");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/cannot be acquired by legendary archive/);
  });

  it("refuses to unlock the same machine twice", () => {
    const instance = market();
    instance.unlock("veteran-mk1", "recovery-rebuild");
    expect(instance.unlock("veteran-mk1", "recovery-rebuild").message).toMatch(/already unlocked/);
  });
});

describe("the saved market", () => {
  it("round-trips money, standing, orders and the rotation", () => {
    const instance = market();
    const offer = instance.offers()[0]!;
    instance.purchase(offer.id);
    instance.advanceDays(3);
    instance.credit(500_000, 20, 2);
    const snapshot = instance.snapshot();
    expect(validateMarketSnapshot(snapshot)).toEqual([]);

    const restored = market();
    restored.restore(snapshot);
    expect(restored.treasury.funding).toBe(instance.treasury.funding);
    expect(restored.treasury.salvageTons).toBe(instance.treasury.salvageTons);
    expect(restored.rotation).toBe(instance.rotation);
    expect(restored.pending()).toHaveLength(1);
    // And the offer stays bought rather than reappearing.
    expect(restored.offers().map((entry) => entry.id)).not.toContain(offer.id);
  });

  it("refuses a snapshot that is not one", () => {
    expect(validateMarketSnapshot(null).length).toBeGreaterThan(0);
    expect(validateMarketSnapshot({ ...emptyMarketSnapshot(), schemaVersion: 99 }).length).toBe(1);
    expect(
      validateMarketSnapshot({
        ...emptyMarketSnapshot(),
        pending: [{ chassisId: "x", condition: "melted" }],
      }).join(" "),
    ).toMatch(/unknown offer condition/);
  });
});

describe("nothing here is a gacha", () => {
  it("has no randomised boxes, premium currency or timed pressure", () => {
    const instance = market();
    const preview = instance.preview(instance.offers()[0]!.id)!;
    const text = JSON.stringify(preview).toLowerCase();
    for (const word of ["gem", "crate", "loot", "pull", "banner", "premium", "token"]) {
      expect(text).not.toContain(word);
    }
    // Every price is a plain number the player can see and save toward.
    expect(preview.price).toBeGreaterThan(0);
    expect(Number.isFinite(preview.price)).toBe(true);
  });

  it("keeps an offer available for the whole rotation", () => {
    const instance = market();
    const offer = instance.offers()[0]!;
    instance.advanceDays(ROTATION_DAYS - 1);
    // No countdown pressure inside a rotation: it is there until the board turns.
    expect(instance.offers().map((entry) => entry.id)).toContain(offer.id);
  });
});
