import { Market, ROTATION_DAYS, type MarketOffer } from "../world/market";
import { Roster } from "../jaegers/roster";
import { jaegerRegistry } from "../data/jaegers";
import { createComponentRegistry } from "../data/components";

/**
 * A campaign's worth of buying, run headlessly.
 *
 * What this proves: the board is the same board for the same seed however many
 * times it is built, buying takes the money once and produces exactly one
 * machine, and an old Mark stays affordable and worth owning next to whatever
 * the newest yard is selling.
 */

export const MARKET_SCENARIO_SEED = 20260825;

export interface MarketScenarioOptions {
  readonly seed?: number;
  /** In-game days to run. */
  readonly days?: number;
  readonly startingFunding?: number;
  /** Buy the cheapest thing on the board whenever it can be afforded. */
  readonly buyWhenAffordable?: boolean;
}

export interface MarketScenarioResult {
  /** Every board the run saw, oldest first. */
  readonly boards: readonly (readonly MarketOffer[])[];
  readonly rotations: number;
  readonly purchases: readonly { readonly offerId: string; readonly paid: number }[];
  readonly delivered: readonly string[];
  readonly ownedAfter: number;
  readonly fundingAfter: number;
  readonly upkeepPaid: number;
  readonly digest: number;
}

export function runMarketScenario(options: MarketScenarioOptions = {}): MarketScenarioResult {
  const components = createComponentRegistry();
  const market = new Market({
    seed: options.seed ?? MARKET_SCENARIO_SEED,
    startingFunding: options.startingFunding ?? 12_000_000,
  });
  const roster = new Roster(jaegerRegistry, components);
  const days = options.days ?? 90;

  const boards: (readonly MarketOffer[])[] = [];
  const purchases: { offerId: string; paid: number }[] = [];
  const delivered: string[] = [];
  let upkeep = 0;
  let lastRotation = -1;

  for (let day = 0; day <= days; day += 1) {
    if (market.rotation !== lastRotation) {
      lastRotation = market.rotation;
      boards.push(market.offers());
    }

    if (options.buyWhenAffordable !== false) {
      const affordable = [...market.offers()]
        .filter((offer) => offer.price <= market.treasury.funding)
        .sort((a, b) => a.price - b.price)[0];
      if (affordable) {
        const result = market.purchase(affordable.id);
        if (result.ok) purchases.push({ offerId: affordable.id, paid: result.spent });
      }
    }

    // Upkeep is charged on what is actually owned, every day.
    upkeep += market.chargeUpkeep(
      roster.all().map((record) => record.chassisId),
      1,
    );

    for (const arrival of market.advanceDays(1)) {
      const record = roster.acquire({
        chassisId: arrival.chassisId,
        acquiredBy: "purchase",
        day,
        wear: arrival.wear,
      });
      if (record) delivered.push(record.jaegerId);
    }
  }

  const text = `${boards.map((board) => board.map((offer) => offer.id).join(",")).join("|")}::${purchases
    .map((entry) => `${entry.offerId}@${entry.paid}`)
    .join(",")}`;

  return {
    boards,
    rotations: market.rotation,
    purchases,
    delivered,
    ownedAfter: roster.all().length,
    fundingAfter: Math.round(market.treasury.funding),
    upkeepPaid: upkeep,
    digest: digestOf(text),
  };
}

/**
 * Whether an old Mark is still worth owning.
 *
 * Compares the cheapest early-generation chassis against the newest one on
 * price, upkeep, how far it can be upgraded, and what its performance bands
 * actually say. An old machine should be cheaper to buy and keep, slower, and
 * further upgradeable, which is what keeps it viable rather than nostalgic.
 */
export function compareGenerations(): {
  readonly oldest: {
    readonly id: string;
    readonly price: number;
    readonly upkeep: number;
    readonly steps: number;
    readonly peak: number;
  };
  readonly newest: {
    readonly id: string;
    readonly price: number;
    readonly upkeep: number;
    readonly steps: number;
    readonly peak: number;
  };
} {
  // Generation zero is the development stand-in rather than a machine anybody
  // fielded, so the comparison starts at the first real Mark. Research frames are
  // out too: this compares what is on the board, and nobody sells those.
  const sorted = [...jaegerRegistry.all()]
    .filter((chassis) => chassis.markGeneration > 0 && chassis.acquisition.includes("purchase"))
    .sort((a, b) => a.markGeneration - b.markGeneration);
  const oldest = sorted[0]!;
  const newest = sorted[sorted.length - 1]!;
  const describe = (chassis: typeof oldest) => ({
    id: chassis.id,
    price: chassis.listPrice,
    upkeep: chassis.upkeepPerDay,
    steps: chassis.upgradeTracks.reduce((total, track) => total + track.steps, 0),
    // The best it can be, which is the top of its best band.
    peak: Math.max(
      chassis.balance.durability[1],
      chassis.balance.damage[1],
      chassis.balance.mobility[1],
      chassis.balance.range[1],
    ),
  });
  return { oldest: describe(oldest), newest: describe(newest) };
}

/** Two markets built from the same seed, to prove a board cannot be rerolled. */
export function rerollAttempt(seed = MARKET_SCENARIO_SEED): {
  readonly first: readonly string[];
  readonly second: readonly string[];
  readonly afterReload: readonly string[];
} {
  const market = new Market({ seed });
  const first = market.offers().map((offer) => offer.id);
  // Asking again is not a reroll.
  const second = market.offers().map((offer) => offer.id);
  // Neither is building a fresh market from the same save.
  const reloaded = new Market({ seed });
  reloaded.restore(market.snapshot());
  return { first, second, afterReload: reloaded.offers().map((offer) => offer.id) };
}

export { ROTATION_DAYS };

function digestOf(text: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
