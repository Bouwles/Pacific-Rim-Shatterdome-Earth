import { ContentRegistry } from "../data/registry";
import { jaegerRegistry, type AcquisitionPath, type JaegerDefinition } from "../data/jaegers";
import {
  createManufacturerRegistry,
  leadTimeFor,
  priceFor,
  type ManufacturerDefinition,
} from "../data/manufacturers";
import { createSeededRng, hashStringToSeed, type Rng } from "../simulation/rng";

/**
 * The market, and the money.
 *
 * Buying a complete machine is the ordinary way a roster grows. What is on
 * offer rotates on a fixed schedule, is decided by a seeded stream from the
 * world seed and the rotation number, and is saved: reloading the page does not
 * reroll it, and neither does anything else the player can reach.
 *
 * Two rules this file exists to keep:
 *
 * 1. **Nothing here is a store card.** An offer is worked out from a chassis
 *    row, a manufacturer row and a rotation. No machine is named in code.
 * 2. **Nothing here pressures anybody.** There are no timers demanding money,
 *    no bundles, no premium currency and no randomised boxes. An offer is a
 *    price and a delivery date, and it either stays affordable or it does not.
 *
 * No Babylon, no DOM, no wall clock. Time arrives as days.
 */

export const MARKET_SCHEMA_VERSION = 1;

/** In-game days a rotation lasts. Long enough to save for something. */
export const ROTATION_DAYS = 14;
/** Offers on the board at once, across every yard. */
export const MAX_OFFERS = 5;

export const OFFER_CONDITIONS = ["new", "refurbished", "prototype"] as const;
export type OfferCondition = (typeof OFFER_CONDITIONS)[number];

export interface MarketOffer {
  readonly id: string;
  readonly chassisId: string;
  readonly manufacturerId: string;
  readonly condition: OfferCondition;
  /** What this yard is charging this buyer, after standing and condition. */
  readonly price: number;
  /** Days from signing to delivery. */
  readonly leadTimeDays: number;
  /** Rotation this offer belongs to. It disappears when that rotation ends. */
  readonly rotation: number;
  /** Conditions attached, copied from the yard so the panel can show them. */
  readonly conditions: readonly string[];
  /**
   * Refurbished hulls arrive with history. 0 to 1 of structure they are missing
   * on delivery, which is the honest cost of a cheap machine.
   */
  readonly wear: number;
}

/** What the yard is owed and what the Corps has. */
export interface Treasury {
  funding: number;
  salvageTons: number;
  researchSamples: number;
}

/** A machine on order, waiting out its lead time. */
export interface PendingDelivery {
  readonly offerId: string;
  readonly chassisId: string;
  readonly manufacturerId: string;
  readonly condition: OfferCondition;
  readonly wear: number;
  /** Days left before it arrives. */
  daysRemaining: number;
  readonly paid: number;
}

export interface MarketSnapshot {
  readonly schemaVersion: number;
  readonly rotation: number;
  readonly daysIntoRotation: number;
  readonly funding: number;
  readonly salvageTons: number;
  readonly researchSamples: number;
  readonly reputation: Readonly<Record<string, number>>;
  readonly purchasedOfferIds: readonly string[];
  readonly pending: readonly PendingDelivery[];
  /** Acquisition paths unlocked outside the market, by chassis id. */
  readonly unlocked: Readonly<Record<string, AcquisitionPath>>;
}

export interface MarketOptions {
  readonly seed: number;
  readonly chassis?: ContentRegistry<JaegerDefinition>;
  readonly manufacturers?: ContentRegistry<ManufacturerDefinition>;
  readonly startingFunding?: number;
}

/** What a purchase did, or why it could not happen. */
export interface PurchaseResult {
  readonly ok: boolean;
  readonly message: string;
  /** The delivery this created, or null when nothing was bought. */
  readonly delivery: PendingDelivery | null;
  /** What was actually deducted. Zero on a refusal. */
  readonly spent: number;
}

/** An honest preview: bands and a tradeoff, never one number. */
export interface OfferPreview {
  readonly offerId: string;
  readonly chassisName: string;
  readonly manufacturerName: string;
  readonly homeRegion: string;
  readonly mark: string;
  readonly role: string;
  readonly condition: OfferCondition;
  readonly price: number;
  readonly upkeepPerDay: number;
  readonly leadTimeDays: number;
  readonly affordable: boolean;
  /** Each band as a low and high percentage, with what it gives up. */
  readonly bands: readonly { readonly label: string; readonly low: number; readonly high: number }[];
  readonly tradeoff: string;
  readonly signatureEquipment: readonly string[];
  readonly upgradeTracks: readonly string[];
  readonly conditions: readonly string[];
  /** Structure it arrives missing, as a percentage. Zero for new. */
  readonly wearPercent: number;
}

export class Market {
  private readonly chassisRegistry: ContentRegistry<JaegerDefinition>;
  private readonly makerRegistry: ContentRegistry<ManufacturerDefinition>;
  private readonly seedValue: number;
  private readonly reputationByMaker = new Map<string, number>();
  private readonly purchased = new Set<string>();
  private readonly pendingDeliveries: PendingDelivery[] = [];
  private readonly unlockedPaths = new Map<string, AcquisitionPath>();

  readonly treasury: Treasury;
  private rotationValue = 0;
  private daysIntoRotation = 0;

  constructor(options: MarketOptions) {
    this.chassisRegistry = options.chassis ?? jaegerRegistry;
    this.makerRegistry = options.manufacturers ?? createManufacturerRegistry();
    this.seedValue = options.seed;
    this.treasury = {
      funding: options.startingFunding ?? 6_000_000,
      salvageTons: 0,
      researchSamples: 0,
    };
    for (const maker of this.makerRegistry.all()) {
      this.reputationByMaker.set(maker.id, maker.baseReputation);
    }
  }

  get rotation(): number {
    return this.rotationValue;
  }

  /** Days until the board changes. */
  get daysUntilRotation(): number {
    return Math.max(0, ROTATION_DAYS - this.daysIntoRotation);
  }

  reputationFor(manufacturerId: string): number {
    return this.reputationByMaker.get(manufacturerId) ?? 0.5;
  }

  pending(): readonly PendingDelivery[] {
    return [...this.pendingDeliveries];
  }

  /**
   * What is on the board right now.
   *
   * Derived from the rotation number rather than stored, so it is the same
   * board every time it is asked for and after every reload. Anything already
   * bought this rotation is gone from it.
   */
  offers(): readonly MarketOffer[] {
    return this.offersForRotation(this.rotationValue).filter((offer) => !this.purchased.has(offer.id));
  }

  /**
   * Builds one rotation's board.
   *
   * Every yard gets a chance at its own offers, weighted by what it is good at
   * and what it has in stock, and the whole thing comes out of one seeded
   * stream so the same rotation is always the same board.
   */
  private offersForRotation(rotation: number): readonly MarketOffer[] {
    const rng = this.stream("rotation", rotation);
    const offers: MarketOffer[] = [];

    for (const maker of this.makerRegistry.all()) {
      const stock = this.chassisRegistry
        .all()
        .filter((chassis) => chassis.manufacturerId === maker.id && chassis.acquisition.includes("purchase"));
      if (stock.length === 0) continue;

      const slots = Math.min(maker.maxConcurrentOffers, stock.length);
      const taken = new Set<string>();
      for (let slot = 0; slot < slots; slot += 1) {
        if (offers.length >= MAX_OFFERS) break;
        const available = stock.filter((chassis) => !taken.has(chassis.id));
        if (available.length === 0) break;
        const chassis = available[Math.floor(rng() * available.length)];
        if (!chassis) break;
        taken.add(chassis.id);

        const refurbished = rng() < maker.refurbishedChance;
        const condition: OfferCondition = refurbished
          ? "refurbished"
          : chassis.provenance === "prototype"
            ? "prototype"
            : "new";
        const reputation = this.reputationFor(maker.id);
        const base = priceFor(maker, chassis.listPrice, reputation);
        const price = refurbished ? Math.round(base * (1 - maker.refurbishedDiscount)) : base;
        // A cheap hull is cheap because somebody else wore it out first.
        const wear = refurbished ? 0.15 + rng() * 0.25 : 0;

        offers.push({
          id: `offer.${rotation}.${maker.id}.${chassis.id}`,
          chassisId: chassis.id,
          manufacturerId: maker.id,
          condition,
          price,
          leadTimeDays: leadTimeFor(maker, reputation),
          rotation,
          conditions: maker.conditions,
          wear: Math.round(wear * 100) / 100,
        });
      }
    }

    return offers;
  }

  /** An honest preview of one offer: bands, tradeoffs and what it costs to keep. */
  preview(offerId: string): OfferPreview | null {
    const offer = this.offers().find((entry) => entry.id === offerId);
    if (!offer) return null;
    const chassis = this.chassisRegistry.get(offer.chassisId);
    const maker = this.makerRegistry.get(offer.manufacturerId);
    if (!chassis || !maker) return null;

    const band = (label: string, range: readonly [number, number]) => ({
      label,
      low: Math.round(range[0] * 100),
      high: Math.round(range[1] * 100),
    });

    return {
      offerId: offer.id,
      chassisName: chassis.name,
      manufacturerName: maker.displayName,
      homeRegion: maker.homeRegion,
      mark: `Mark ${chassis.markGeneration}`,
      role: chassis.role,
      condition: offer.condition,
      price: offer.price,
      upkeepPerDay: chassis.upkeepPerDay,
      leadTimeDays: offer.leadTimeDays,
      affordable: this.treasury.funding >= offer.price,
      bands: [
        band("Durability", chassis.balance.durability),
        band("Damage", chassis.balance.damage),
        band("Mobility", chassis.balance.mobility),
        band("Reach", chassis.balance.range),
      ],
      tradeoff: chassis.balance.tradeoff,
      signatureEquipment: chassis.signatureEquipment,
      upgradeTracks: chassis.upgradeTracks.map(
        (track) => `${track.displayName} (${track.steps} steps): ${track.effect}`,
      ),
      conditions: offer.conditions,
      wearPercent: Math.round(offer.wear * 100),
    };
  }

  /**
   * Signs a contract.
   *
   * Deducts once, records the offer as taken so it cannot be bought twice, and
   * puts the machine on order. Nothing is owned until it is delivered, which is
   * the difference between a purchase and a spawn.
   */
  purchase(offerId: string): PurchaseResult {
    const offer = this.offers().find((entry) => entry.id === offerId);
    if (!offer) {
      return { ok: false, message: "That offer is not on the board.", delivery: null, spent: 0 };
    }
    if (this.purchased.has(offer.id)) {
      return { ok: false, message: "That contract has already been signed.", delivery: null, spent: 0 };
    }
    if (this.treasury.funding < offer.price) {
      const short = offer.price - this.treasury.funding;
      return {
        ok: false,
        message: `Short by ${short.toLocaleString("en-GB")}.`,
        delivery: null,
        spent: 0,
      };
    }

    this.treasury.funding -= offer.price;
    this.purchased.add(offer.id);
    const delivery: PendingDelivery = {
      offerId: offer.id,
      chassisId: offer.chassisId,
      manufacturerId: offer.manufacturerId,
      condition: offer.condition,
      wear: offer.wear,
      daysRemaining: offer.leadTimeDays,
      paid: offer.price,
    };
    this.pendingDeliveries.push(delivery);
    // Buying from a yard improves how they think of you, a little.
    this.adjustReputation(offer.manufacturerId, 0.04);
    return {
      ok: true,
      message: `Contract signed. ${offer.leadTimeDays} days to delivery.`,
      delivery,
      spent: offer.price,
    };
  }

  /**
   * Unlocks a chassis outside the market.
   *
   * A milestone, a research programme, a rebuilt wreck, an archive or an event
   * each puts something on the pad without money changing hands. The path is
   * recorded so the roster can say where a machine came from.
   */
  unlock(chassisId: string, path: AcquisitionPath): { readonly ok: boolean; readonly message: string } {
    const chassis = this.chassisRegistry.get(chassisId);
    if (!chassis) return { ok: false, message: `There is no chassis called ${chassisId}.` };
    if (!chassis.acquisition.includes(path)) {
      return {
        ok: false,
        message: `${chassis.name} cannot be acquired by ${path.replace("-", " ")}.`,
      };
    }
    if (this.unlockedPaths.has(chassisId)) {
      return { ok: false, message: `${chassis.name} is already unlocked.` };
    }
    this.unlockedPaths.set(chassisId, path);
    return { ok: true, message: `${chassis.name} unlocked by ${path.replace("-", " ")}.` };
  }

  /** Chassis unlocked outside the market, with how each was unlocked. */
  unlocked(): readonly { readonly chassisId: string; readonly path: AcquisitionPath }[] {
    return [...this.unlockedPaths.entries()].map(([chassisId, path]) => ({ chassisId, path }));
  }

  /**
   * Days passing.
   *
   * Moves deliveries along, rotates the board when a rotation is up, and
   * returns whatever arrived so the roster can take ownership of it.
   */
  advanceDays(days: number): readonly PendingDelivery[] {
    if (days <= 0) return [];
    const delivered: PendingDelivery[] = [];

    for (let index = this.pendingDeliveries.length - 1; index >= 0; index -= 1) {
      const delivery = this.pendingDeliveries[index];
      if (!delivery) continue;
      delivery.daysRemaining -= days;
      if (delivery.daysRemaining <= 0) {
        delivered.push(delivery);
        this.pendingDeliveries.splice(index, 1);
      }
    }

    this.daysIntoRotation += days;
    while (this.daysIntoRotation >= ROTATION_DAYS) {
      this.daysIntoRotation -= ROTATION_DAYS;
      this.rotationValue += 1;
    }

    return delivered;
  }

  /** Charges upkeep for everything on the pad. Funding may go negative. */
  chargeUpkeep(chassisIds: readonly string[], days: number): number {
    if (days <= 0) return 0;
    let total = 0;
    for (const chassisId of chassisIds) {
      total += (this.chassisRegistry.get(chassisId)?.upkeepPerDay ?? 0) * days;
    }
    const charged = Math.round(total);
    this.treasury.funding -= charged;
    return charged;
  }

  /** Pays in what a sortie earned. One call, one credit. */
  credit(funding: number, salvageTons = 0, researchSamples = 0): void {
    this.treasury.funding += Math.max(0, Math.round(funding));
    this.treasury.salvageTons += Math.max(0, salvageTons);
    this.treasury.researchSamples += Math.max(0, Math.round(researchSamples));
  }

  adjustReputation(manufacturerId: string, delta: number): number {
    const current = this.reputationFor(manufacturerId);
    const next = Math.max(0, Math.min(1, current + delta));
    this.reputationByMaker.set(manufacturerId, next);
    return next;
  }

  private stream(name: string, salt: number): Rng {
    return createSeededRng((hashStringToSeed(`market|${name}`) ^ this.seedValue ^ (salt | 0)) >>> 0);
  }

  snapshot(): MarketSnapshot {
    const reputation: Record<string, number> = {};
    for (const [id, value] of this.reputationByMaker) reputation[id] = Math.round(value * 1000) / 1000;
    const unlocked: Record<string, AcquisitionPath> = {};
    for (const [id, path] of this.unlockedPaths) unlocked[id] = path;
    return {
      schemaVersion: MARKET_SCHEMA_VERSION,
      rotation: this.rotationValue,
      daysIntoRotation: Math.round(this.daysIntoRotation * 100) / 100,
      funding: Math.round(this.treasury.funding),
      salvageTons: Math.round(this.treasury.salvageTons * 10) / 10,
      researchSamples: this.treasury.researchSamples,
      reputation,
      purchasedOfferIds: [...this.purchased],
      pending: this.pendingDeliveries.map((delivery) => ({ ...delivery })),
      unlocked,
    };
  }

  restore(snapshot: MarketSnapshot): void {
    this.rotationValue = Math.max(0, Math.round(snapshot.rotation));
    this.daysIntoRotation = Math.max(0, snapshot.daysIntoRotation);
    this.treasury.funding = snapshot.funding;
    this.treasury.salvageTons = Math.max(0, snapshot.salvageTons);
    this.treasury.researchSamples = Math.max(0, Math.round(snapshot.researchSamples));

    for (const [id, value] of Object.entries(snapshot.reputation)) {
      // A yard this build no longer has is dropped rather than resurrected.
      if (!this.makerRegistry.get(id)) continue;
      this.reputationByMaker.set(id, Math.max(0, Math.min(1, value)));
    }
    this.purchased.clear();
    for (const id of snapshot.purchasedOfferIds) this.purchased.add(id);
    this.pendingDeliveries.length = 0;
    for (const delivery of snapshot.pending) {
      if (!this.chassisRegistry.get(delivery.chassisId)) continue;
      this.pendingDeliveries.push({ ...delivery });
    }
    this.unlockedPaths.clear();
    for (const [chassisId, path] of Object.entries(snapshot.unlocked)) {
      if (!this.chassisRegistry.get(chassisId)) continue;
      this.unlockedPaths.set(chassisId, path);
    }
  }
}

export function emptyMarketSnapshot(): MarketSnapshot {
  return {
    schemaVersion: MARKET_SCHEMA_VERSION,
    rotation: 0,
    daysIntoRotation: 0,
    funding: 6_000_000,
    salvageTons: 0,
    researchSamples: 0,
    reputation: {},
    purchasedOfferIds: [],
    pending: [],
    unlocked: {},
  };
}

export function validateMarketSnapshot(snapshot: unknown): string[] {
  if (typeof snapshot !== "object" || snapshot === null) return ["market snapshot must be an object"];
  const record = snapshot as Record<string, unknown>;
  const errors: string[] = [];
  if (record["schemaVersion"] !== MARKET_SCHEMA_VERSION) {
    errors.push(`market.schemaVersion must be ${MARKET_SCHEMA_VERSION}`);
  }
  for (const key of ["rotation", "daysIntoRotation", "funding"] as const) {
    if (typeof record[key] !== "number" || !Number.isFinite(record[key])) {
      errors.push(`market.${key} must be a finite number`);
    }
  }
  if (typeof record["rotation"] === "number" && record["rotation"] < 0) {
    errors.push("market.rotation cannot be negative");
  }
  for (const key of ["purchasedOfferIds", "pending"] as const) {
    if (!Array.isArray(record[key])) errors.push(`market.${key} must be an array`);
  }
  if (Array.isArray(record["pending"])) {
    for (const entry of record["pending"] as unknown[]) {
      const delivery = entry as Record<string, unknown>;
      if (typeof delivery["chassisId"] !== "string") errors.push("every delivery needs a chassisId");
      if (!OFFER_CONDITIONS.includes(delivery["condition"] as OfferCondition)) {
        errors.push(`unknown offer condition "${String(delivery["condition"])}"`);
      }
    }
  }
  return errors;
}
