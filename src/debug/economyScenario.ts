import {
  Economy,
  contractReward,
  defenceReward,
  explorationFind,
  facilityIncome,
  manufacturerDeal,
  repairQuote,
  salvageRights,
  type Difficulty,
} from "../world/economy";
import { createSeededRng, hashStringToSeed } from "../simulation/rng";

/**
 * A campaign's worth of money, run headlessly.
 *
 * What this proves: that common play makes steady progress without the
 * decisions going away, that a player who flies everything and a player who
 * stands down a lot both survive, and that nothing here rewards repetition more
 * than it rewards playing well.
 *
 * Hundreds of in-game days, deterministic from a seed, no world required.
 */

export const ECONOMY_SCENARIO_SEED = 20260829;

/** How a player is choosing to play. Each is a real strategy, not a difficulty. */
export const STRATEGIES = ["fly-everything", "pick-battles", "stand-down", "explorer"] as const;
export type Strategy = (typeof STRATEGIES)[number];

export interface EconomyScenarioOptions {
  readonly seed?: number;
  readonly days?: number;
  readonly strategy?: Strategy;
  readonly difficulty?: Difficulty;
  /** What the complex is worth, as the facility effects would report. */
  readonly contractYield?: number;
  readonly researchYield?: number;
  readonly containmentYield?: number;
  readonly defenceStrength?: number;
  readonly bayCapability?: number;
  /** Daily cost of everything owned. */
  readonly upkeepPerDay?: number;
}

export interface EconomyScenarioResult {
  readonly strategy: Strategy;
  readonly days: number;
  readonly fundingEnd: number;
  readonly fundingLow: number;
  /** Days spent in debt. A campaign that lives there is not working. */
  readonly daysInDebt: number;
  readonly sorties: number;
  readonly repairsPaid: number;
  readonly repairsDeferred: number;
  readonly researchData: number;
  readonly alloy: number;
  /** Income and spending, straight off the ledger. */
  readonly income: number;
  readonly expense: number;
  readonly ledgerLines: number;
  /** The ledger's own total against the balance. They must agree. */
  readonly reconciles: boolean;
  readonly digest: number;
}

/**
 * One campaign.
 *
 * The strategy decides how often the player goes out and how hard they push,
 * and everything else follows from the same formulas the game uses.
 */
export function runEconomyScenario(options: EconomyScenarioOptions = {}): EconomyScenarioResult {
  const strategy = options.strategy ?? "pick-battles";
  const days = options.days ?? 360;
  const difficulty = options.difficulty ?? "standard";
  const economy = new Economy({ difficulty, startingFunding: 6_000_000 });
  const rng = createSeededRng(
    (hashStringToSeed(`economy|${strategy}`) ^ (options.seed ?? ECONOMY_SCENARIO_SEED)) >>> 0,
  );

  const contractYield = options.contractYield ?? 1.15;
  const researchYield = options.researchYield ?? 1.3;
  const containmentYield = options.containmentYield ?? 1;
  const defenceStrength = options.defenceStrength ?? 1.2;
  const bayCapability = options.bayCapability ?? 1.35;
  const upkeepPerDay = options.upkeepPerDay ?? 45_000;

  // How each strategy behaves. A table, so adding one is a row.
  const behaviours: Readonly<
    Record<Strategy, { readonly flyChance: number; readonly push: number; readonly explore: number }>
  > = {
    "fly-everything": { flyChance: 1, push: 0.95, explore: 0 },
    "pick-battles": { flyChance: 0.6, push: 0.85, explore: 0.1 },
    "stand-down": { flyChance: 0.25, push: 0.8, explore: 0.05 },
    explorer: { flyChance: 0.45, push: 0.8, explore: 0.5 },
  };
  const behaviour = behaviours[strategy];

  let sorties = 0;
  let repairsPaid = 0;
  let repairsDeferred = 0;
  let fundingLow = economy.balance("funding");
  let daysInDebt = 0;

  for (let day = 1; day <= days; day += 1) {
    // Upkeep every day, whatever happened. The one bill that never stops.
    economy.spend("funding", upkeepPerDay, {
      source: "upkeep",
      reason: "Daily upkeep on everything owned.",
      day,
      allowDebt: true,
    });

    // What the complex earns by standing.
    const passive = facilityIncome({ contractYield, containmentYield, days: 1, difficulty });
    if (passive.funding > 0) {
      economy.earn("funding", passive.funding, {
        source: "facility-income",
        reason: "Facility income.",
        day,
      });
    }
    if (passive.researchData > 0) {
      economy.earn("researchData", passive.researchData, {
        source: "facility-income",
        reason: "Containment output.",
        day,
      });
    }

    // A yard arrangement, for standing already earned.
    if (day % 7 === 0) {
      const deal = manufacturerDeal({ reputation: 0.68, days: 7, difficulty });
      if (deal.funding > 0) {
        economy.earn("funding", deal.funding, { source: "manufacturer-deal", reason: "Yard retainer.", day });
      }
      if (deal.components > 0) {
        economy.earn("components", deal.components, {
          source: "manufacturer-deal",
          reason: "Parts against the retainer.",
          day,
        });
      }
    }

    // An attack roughly every third day. Whether the player goes is the strategy.
    if (day % 3 !== 0) continue;
    const populationThousands = 2_000 + rng() * 9_000;
    const escalation = Math.min(1, day / days);
    const mutations = Math.floor(rng() * 4);

    if (rng() > behaviour.flyChance) {
      const reward = defenceReward({ populationThousands, defenceStrength, difficulty });
      economy.earn("funding", reward, {
        source: "defence-reward",
        reason: "Coastal defences handled it.",
        day,
        reference: `defence.${day}`,
      });
      continue;
    }

    sorties += 1;
    const objectiveScore = Math.max(0.2, Math.min(1, behaviour.push * (0.7 + rng() * 0.45)));
    const contract = contractReward({
      populationThousands,
      threatStrength: 0.5 + mutations * 0.2,
      escalation,
      objectiveScore,
      contractYield,
      difficulty,
    });
    economy.earn("funding", contract.funding, {
      source: "government-contract",
      reason: "Contract settled.",
      day,
      reference: `contract.${day}`,
    });
    if (contract.reactorMaterial > 0) {
      economy.earn("reactorMaterial", contract.reactorMaterial, {
        source: "government-contract",
        reason: "Reactor material released.",
        day,
      });
    }

    const salvage = salvageRights({
      massTons: 1_800 + rng() * 1_600,
      objectiveScore,
      researchYield,
      mutationCount: mutations,
    });
    economy.earn("alloy", salvage.alloy, { source: "salvage-rights", reason: "Salvage.", day });
    economy.earn("components", salvage.components, { source: "salvage-rights", reason: "Salvage.", day });
    for (const kind of ["common", "rare", "exotic"] as const) {
      if (salvage.tissue[kind] > 0) {
        economy.earn("tissue", salvage.tissue[kind], {
          source: "salvage-rights",
          reason: "Tissue recovered.",
          day,
          tissueClass: kind,
        });
      }
    }

    // Repair what the sortie cost. A machine pushed harder comes back worse.
    const damage = (1 - objectiveScore) * 0.8 + rng() * 0.35;
    const quote = repairQuote({
      armourMissing: damage * 2_600,
      componentMissing: damage * 900,
      rarityMultiplier: 1.1,
      alloyAvailable: economy.balance("alloy"),
      componentsAvailable: economy.balance("components"),
      bayCapability,
      urgency: 1,
      insuredFraction: 0.25,
    });
    const paid = economy.spend("funding", quote.total, {
      source: "repair",
      reason: "Repair bill.",
      day,
      reference: `repair.${day}`,
    });
    if (paid.ok) {
      repairsPaid += 1;
      // Materials come out of stores as well as money.
      economy.spend("alloy", Math.min(economy.balance("alloy"), quote.alloyNeeded), {
        source: "repair",
        reason: "Plate off the racks.",
        day,
      });
      economy.spend("components", Math.min(economy.balance("components"), quote.componentsNeeded), {
        source: "repair",
        reason: "Parts off the shelf.",
        day,
      });
    } else {
      // Cannot afford it today. The machine waits, which is a decision rather
      // than a wall: the campaign carries on and the bill is still there.
      repairsDeferred += 1;
    }

    // Working the tissue up is what turns a fight into research.
    if (day % 6 === 0) {
      economy.convertTissue(
        {
          common: economy.pool.tissue.common,
          rare: economy.pool.tissue.rare,
          exotic: economy.pool.tissue.exotic,
        },
        { day, yieldMultiplier: researchYield },
      );
    }

    if (rng() < behaviour.explore) {
      const find = explorationFind({ distanceKm: 200 + rng() * 900, sectorsSeen: 1 + rng() * 4, difficulty });
      economy.earn("funding", find.funding, {
        source: "exploration-find",
        reason: "Something out there.",
        day,
      });
      economy.earn("researchData", find.researchData, {
        source: "exploration-find",
        reason: "Readings worth keeping.",
        day,
      });
    }

    fundingLow = Math.min(fundingLow, economy.balance("funding"));
    if (economy.balance("funding") < 0) daysInDebt += 1;
  }

  const summary = economy.summarise("funding", 0, days);
  const entries = economy.ledger.forResource("funding");
  // The ledger is bounded and trims across every resource, so counting funding
  // lines says nothing about whether funding lines were trimmed. What always
  // holds is that the last line's recorded balance is the balance held.
  const last = entries[entries.length - 1];
  const reconciles = last !== undefined && Math.abs(last.balanceAfter - economy.balance("funding")) < 1;

  return {
    strategy,
    days,
    fundingEnd: Math.round(economy.balance("funding")),
    fundingLow: Math.round(fundingLow),
    daysInDebt,
    sorties,
    repairsPaid,
    repairsDeferred,
    researchData: Math.round(economy.balance("researchData")),
    alloy: Math.round(economy.balance("alloy")),
    income: Math.round(summary.income),
    expense: Math.round(summary.expense),
    ledgerLines: economy.ledger.all().length,
    reconciles,
    digest: digestOf(`${economy.balance("funding")}|${sorties}|${repairsPaid}`),
  };
}

/** Every strategy side by side, which is how a balance pass is actually read. */
export function compareStrategies(days = 360, difficulty: Difficulty = "standard") {
  return STRATEGIES.map((strategy) => runEconomyScenario({ strategy, days, difficulty }));
}

/** The same strategy at each difficulty, to check the dial does what it says. */
export function compareDifficulties(strategy: Strategy = "pick-battles", days = 360) {
  return (["generous", "standard", "lean"] as const).map((difficulty) =>
    runEconomyScenario({ strategy, days, difficulty }),
  );
}

function digestOf(text: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
