import {
  Ledger,
  emptyLedgerSnapshot,
  type LedgerSnapshot,
  type LedgerSource,
  type LedgerSummary,
} from "./ledger";
import {
  TISSUE_VALUE,
  amountOf,
  emptyPool,
  tissueWorth,
  type ResourceKind,
  type ResourcePool,
  type TissueClass,
} from "./resources";

/**
 * The programme's balance sheet.
 *
 * One place owns every resource and every reason one moved. Nothing anywhere
 * else adds to a balance directly: the only ways in are `earn` and `spend`, and
 * both write a ledger line. That is what makes "every balance-affecting change
 * appears in an inspectable ledger" a property of the design rather than a
 * promise about discipline.
 *
 * Income comes from formulas rather than tables of hand-written numbers, so a
 * contract for a harder region against a worse creature is worth more without
 * anybody writing that down twice. Every formula is pure and takes what it needs
 * as arguments, so a balance test can run hundreds of days without a world.
 *
 * No Babylon, no DOM, no wall clock, no RNG. Days arrive as numbers.
 */

export const ECONOMY_SCHEMA_VERSION = 1;

/** How hard the campaign is on the wallet. Chosen by the player, never hidden. */
export const DIFFICULTY_LEVELS = ["generous", "standard", "lean"] as const;
export type Difficulty = (typeof DIFFICULTY_LEVELS)[number];

/**
 * What each difficulty does.
 *
 * Income only. Nothing here makes a kaiju tougher or a repair slower, because
 * money difficulty and combat difficulty are different decisions and mixing
 * them takes one of them away from the player.
 */
export const DIFFICULTY_INCOME: Readonly<Record<Difficulty, number>> = {
  generous: 1.3,
  standard: 1,
  lean: 0.78,
};

export interface EconomyOptions {
  readonly difficulty?: Difficulty;
  readonly startingFunding?: number;
}

export interface ChangeResult {
  readonly ok: boolean;
  readonly message: string;
  /** What actually moved. Zero when the change was refused. */
  readonly amount: number;
}

/** Everything a repair quote is worked out from. */
export interface RepairContext {
  /** Structure missing across the armour and frame, in points. */
  readonly armourMissing: number;
  /** Component health missing, in points. */
  readonly componentMissing: number;
  /** How rare the machine is. A legendary hull costs more to put right. */
  readonly rarityMultiplier: number;
  /** Alloy on hand. What is available offsets what has to be bought in. */
  readonly alloyAvailable: number;
  readonly componentsAvailable: number;
  /** What the bay can do, from the facility effects. Above one is cheaper. */
  readonly bayCapability: number;
  /** 1 for the ordinary queue, above for wanting it now. */
  readonly urgency: number;
  /** 0 to 1 of the bill somebody else is picking up. */
  readonly insuredFraction: number;
}

/** A quote, broken down, so a player can see what they are paying for. */
export interface RepairQuote {
  readonly labour: number;
  readonly alloyNeeded: number;
  readonly componentsNeeded: number;
  /** Alloy and components that have to be bought in because stores are short. */
  readonly alloyShortfall: number;
  readonly componentShortfall: number;
  readonly materialsBoughtIn: number;
  readonly urgencySurcharge: number;
  readonly insured: number;
  readonly total: number;
  readonly lines: readonly { readonly label: string; readonly amount: number }[];
}

/** What one contract is worth, and why. */
export interface ContractQuote {
  readonly funding: number;
  readonly reactorMaterial: number;
  readonly lines: readonly { readonly label: string; readonly amount: number }[];
}

export interface EconomySnapshot {
  readonly schemaVersion: number;
  readonly pool: ResourcePool;
  readonly difficulty: Difficulty;
  readonly ledger: LedgerSnapshot;
}

/** Credits one ton of alloy or one component costs when bought in. */
export const ALLOY_PRICE = 900;
export const COMPONENT_PRICE = 2_600;
/** Credits per point of structure a repair crew charges before anything else. */
export const LABOUR_PER_POINT = 34;

export class Economy {
  private readonly poolValue: ResourcePool;
  private readonly ledgerValue = new Ledger();
  private difficultyValue: Difficulty;

  constructor(options: EconomyOptions = {}) {
    this.poolValue = emptyPool();
    this.poolValue.funding = options.startingFunding ?? 0;
    this.difficultyValue = options.difficulty ?? "standard";
  }

  get pool(): ResourcePool {
    return this.poolValue;
  }

  get ledger(): Ledger {
    return this.ledgerValue;
  }

  get difficulty(): Difficulty {
    return this.difficultyValue;
  }

  setDifficulty(difficulty: Difficulty): void {
    if (DIFFICULTY_LEVELS.includes(difficulty)) this.difficultyValue = difficulty;
  }

  balance(kind: ResourceKind): number {
    return amountOf(this.poolValue, kind);
  }

  /**
   * Puts balances back to known figures without writing history.
   *
   * For loading a save only. This is deliberately not a way to change a balance
   * during play: every change a player can cause goes through `earn` or `spend`
   * so it lands in the ledger. Restoring is not a change, it is the same balance
   * arriving again, and inventing ledger lines for it would be a lie about what
   * happened.
   */
  setBalances(
    balances: Partial<
      Record<"funding" | "alloy" | "components" | "reactorMaterial" | "researchData", number>
    >,
  ): void {
    for (const [kind, value] of Object.entries(balances)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const key = kind as "funding" | "alloy" | "components" | "reactorMaterial" | "researchData";
      this.poolValue[key] = key === "funding" ? Math.round(value) : Math.max(0, value);
    }
  }

  /**
   * Pays something in.
   *
   * A reference makes the payment happen once ever. Handing the same mission
   * result back a second time, after a reload or a retry or a client rejoining,
   * changes nothing and says so.
   */
  earn(
    resource: ResourceKind,
    amount: number,
    options: {
      readonly source: LedgerSource;
      readonly reason: string;
      readonly day: number;
      readonly reference?: string | null;
      readonly tissueClass?: TissueClass;
    },
  ): ChangeResult {
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, message: "Nothing to pay in.", amount: 0 };
    }
    if (options.reference && !this.ledgerValue.claim(options.reference)) {
      return { ok: false, message: "That has already been paid.", amount: 0 };
    }
    const rounded = resource === "funding" ? Math.round(amount) : Math.round(amount * 100) / 100;
    this.add(resource, rounded, options.tissueClass);
    this.ledgerValue.record(
      {
        day: options.day,
        source: options.source,
        resource,
        // Written only when there is one: a save refuses undefined, and an
        // optional field set to undefined is not the same as an absent one.
        ...(options.tissueClass ? { tissueClass: options.tissueClass } : {}),
        amount: rounded,
        reason: options.reason,
        reference: options.reference ?? null,
      },
      this.balance(resource),
    );
    return { ok: true, message: options.reason, amount: rounded };
  }

  /**
   * Takes something out.
   *
   * Refuses rather than going negative, except for the general fund, which is
   * allowed to: a programme in debt is a problem to dig out of. Everything else
   * refuses and says how short it is, so nothing is ever silently unaffordable.
   */
  spend(
    resource: ResourceKind,
    amount: number,
    options: {
      readonly source: LedgerSource;
      readonly reason: string;
      readonly day: number;
      readonly reference?: string | null;
      readonly tissueClass?: TissueClass;
      /** Allows the general fund below zero. Upkeep does; a purchase does not. */
      readonly allowDebt?: boolean;
    },
  ): ChangeResult {
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, message: "Nothing to pay out.", amount: 0 };
    }
    const rounded = resource === "funding" ? Math.round(amount) : Math.round(amount * 100) / 100;
    const held = this.balance(resource);
    const mayGoNegative = resource === "funding" && options.allowDebt === true;
    if (rounded > held && !mayGoNegative) {
      return {
        ok: false,
        message:
          `Short by ${Math.round((rounded - held) * 100) / 100} ${resource === "funding" ? "credits" : ""}`.trim(),
        amount: 0,
      };
    }
    if (options.reference && !this.ledgerValue.claim(options.reference)) {
      return { ok: false, message: "That has already been paid.", amount: 0 };
    }
    this.add(resource, -rounded, options.tissueClass);
    this.ledgerValue.record(
      {
        day: options.day,
        source: options.source,
        resource,
        ...(options.tissueClass ? { tissueClass: options.tissueClass } : {}),
        amount: -rounded,
        reason: options.reason,
        reference: options.reference ?? null,
      },
      this.balance(resource),
    );
    return { ok: true, message: options.reason, amount: rounded };
  }

  /** What the ledger says happened, per resource, over a window. */
  summarise(resource: ResourceKind, sinceDay: number, untilDay: number): LedgerSummary {
    return this.ledgerValue.summarise(resource, sinceDay, untilDay);
  }

  /**
   * Turns tissue into research data.
   *
   * The only thing tissue is for. Exotic is worth twelve times common, so what
   * a sortie brought back matters more than how much of it there was, which is
   * what stops farming the same easy creature being the best research strategy.
   */
  convertTissue(
    tons: Partial<Record<TissueClass, number>>,
    options: { readonly day: number; readonly yieldMultiplier?: number },
  ): ChangeResult {
    let produced = 0;
    for (const [kind, amount] of Object.entries(tons)) {
      const tissueClass = kind as TissueClass;
      const held = this.poolValue.tissue[tissueClass] ?? 0;
      const used = Math.min(held, Math.max(0, amount ?? 0));
      if (used <= 0) continue;
      this.spend("tissue", used, {
        source: "research-conversion",
        reason: `Worked up ${used} tons of ${tissueClass} tissue.`,
        day: options.day,
        tissueClass,
      });
      produced += used * TISSUE_VALUE[tissueClass];
    }
    if (produced <= 0) return { ok: false, message: "Nothing to work up.", amount: 0 };
    const multiplier = Number.isFinite(options.yieldMultiplier) ? (options.yieldMultiplier ?? 1) : 1;
    return this.earn("researchData", produced * Math.max(0.1, multiplier), {
      source: "research-conversion",
      reason: "Laboratory output.",
      day: options.day,
    });
  }

  snapshot(): EconomySnapshot {
    return {
      schemaVersion: ECONOMY_SCHEMA_VERSION,
      pool: {
        ...this.poolValue,
        tissue: { ...this.poolValue.tissue },
      },
      difficulty: this.difficultyValue,
      ledger: this.ledgerValue.snapshot(),
    };
  }

  restore(snapshot: EconomySnapshot): void {
    const pool = snapshot.pool ?? emptyPool();
    this.poolValue.funding = finite(pool.funding);
    this.poolValue.alloy = Math.max(0, finite(pool.alloy));
    this.poolValue.components = Math.max(0, finite(pool.components));
    this.poolValue.reactorMaterial = Math.max(0, finite(pool.reactorMaterial));
    this.poolValue.researchData = Math.max(0, finite(pool.researchData));
    this.poolValue.tissue = {
      common: Math.max(0, finite(pool.tissue?.common)),
      rare: Math.max(0, finite(pool.tissue?.rare)),
      exotic: Math.max(0, finite(pool.tissue?.exotic)),
    };
    this.difficultyValue = DIFFICULTY_LEVELS.includes(snapshot.difficulty) ? snapshot.difficulty : "standard";
    this.ledgerValue.restore(snapshot.ledger ?? emptyLedgerSnapshot());
  }

  private add(resource: ResourceKind, delta: number, tissueClass?: TissueClass): void {
    if (resource === "tissue") {
      const kind = tissueClass ?? "common";
      this.poolValue.tissue[kind] = Math.max(0, (this.poolValue.tissue[kind] ?? 0) + delta);
      return;
    }
    const next = this.poolValue[resource] + delta;
    this.poolValue[resource] = resource === "funding" ? next : Math.max(0, next);
  }
}

/**
 * What a government contract pays.
 *
 * Scaled by what was actually at stake: a bigger city, a worse creature and a
 * higher escalation are all worth more, and none of it is a table somebody has
 * to keep in step with the world.
 */
export function contractReward(input: {
  readonly populationThousands: number;
  readonly threatStrength: number;
  readonly escalation: number;
  readonly objectiveScore: number;
  readonly contractYield: number;
  readonly difficulty: Difficulty;
}): ContractQuote {
  // Sized against what a programme actually costs to run: upkeep on a handful
  // of machines is tens of thousands a day, so a sortie has to be worth a
  // meaningful fraction of a week of that or flying is a net loss and the game
  // is asking to be played by not playing it.
  const base = 70_000 + input.populationThousands * 3;
  const threat = 1 + Math.max(0, input.threatStrength) * 0.6;
  const escalation = 1 + Math.max(0, Math.min(1, input.escalation)) * 0.8;
  const performance = Math.max(0, Math.min(1, input.objectiveScore));
  const yieldFactor = Math.max(0.1, input.contractYield);
  const difficulty = DIFFICULTY_INCOME[input.difficulty];

  const funding = Math.round(base * threat * escalation * performance * yieldFactor * difficulty);
  // Reactor material is released against a contract rather than sold, which is
  // why it is here and not on the market.
  const reactorMaterial = Math.round(performance * escalation * 3);

  return {
    funding,
    reactorMaterial,
    lines: [
      { label: `Base for ${Math.round(input.populationThousands)}k people`, amount: Math.round(base) },
      { label: `Threat ${threat.toFixed(2)}x`, amount: Math.round(base * (threat - 1)) },
      { label: `Escalation ${escalation.toFixed(2)}x`, amount: Math.round(base * (escalation - 1)) },
      { label: `Objectives ${Math.round(performance * 100)}%`, amount: funding },
    ],
  };
}

/** What the coastal defences pay when they handle it without you. */
export function defenceReward(input: {
  readonly populationThousands: number;
  readonly defenceStrength: number;
  readonly difficulty: Difficulty;
}): number {
  // Deliberately less than going yourself, and deliberately enough to live on.
  // Standing down should be a worse answer, not a ruinous one: a player who
  // sends nobody still has a programme tomorrow.
  const base = 40_000 + input.populationThousands * 1;
  return Math.round(base * Math.max(0.5, input.defenceStrength) * DIFFICULTY_INCOME[input.difficulty]);
}

/** What comes off a dead kaiju, as materials rather than money. */
export function salvageRights(input: {
  readonly massTons: number;
  readonly objectiveScore: number;
  readonly researchYield: number;
  readonly mutationCount: number;
}): { readonly alloy: number; readonly components: number; readonly tissue: Record<TissueClass, number> } {
  const recovered = Math.max(0, Math.min(1, input.objectiveScore));
  const mass = Math.max(0, input.massTons);
  const yieldFactor = Math.max(0.1, input.researchYield);
  // Mutations are what make a creature worth studying rather than weighing.
  const exotic = Math.min(3, Math.floor(input.mutationCount / 2)) * recovered * yieldFactor;
  const rare = Math.max(0, input.mutationCount) * 0.8 * recovered * yieldFactor;
  const common = (mass / 90) * recovered * yieldFactor;
  return {
    alloy: Math.round((mass / 45) * recovered * 10) / 10,
    components: Math.round((mass / 320) * recovered * 10) / 10,
    tissue: {
      common: Math.round(common * 10) / 10,
      rare: Math.round(rare * 10) / 10,
      exotic: Math.round(exotic * 10) / 10,
    },
  };
}

/** What walking somewhere nobody has been turns up. */
export function explorationFind(input: {
  readonly distanceKm: number;
  readonly sectorsSeen: number;
  readonly difficulty: Difficulty;
}): { readonly funding: number; readonly reactorMaterial: number; readonly researchData: number } {
  const reach = Math.max(0, input.distanceKm) / 100 + Math.max(0, input.sectorsSeen) * 0.5;
  const difficulty = DIFFICULTY_INCOME[input.difficulty];
  return {
    funding: Math.round(reach * 1_400 * difficulty),
    reactorMaterial: Math.round(reach * 0.4),
    researchData: Math.round(reach * 1.2),
  };
}

/** What standing with a yard is worth as a standing arrangement. */
export function manufacturerDeal(input: {
  readonly reputation: number;
  readonly days: number;
  readonly difficulty: Difficulty;
}): { readonly funding: number; readonly components: number } {
  const standing = Math.max(0, Math.min(1, input.reputation));
  // Below half standing a yard is not interested in an arrangement at all.
  if (standing < 0.5) return { funding: 0, components: 0 };
  const days = Math.max(0, input.days);
  return {
    funding: Math.round((standing - 0.5) * 2 * 1_200 * days * DIFFICULTY_INCOME[input.difficulty]),
    components: Math.round((standing - 0.5) * 2 * 0.6 * days * 10) / 10,
  };
}

/** What the complex earns simply by standing, per day. */
export function facilityIncome(input: {
  readonly contractYield: number;
  readonly containmentYield: number;
  readonly days: number;
  readonly difficulty: Difficulty;
}): { readonly funding: number; readonly researchData: number } {
  const days = Math.max(0, input.days);
  // Only the part above one earns: a complex with nothing built earns nothing,
  // which is what makes the buildings worth building.
  const contract = Math.max(0, input.contractYield - 1);
  const containment = Math.max(0, input.containmentYield - 1);
  return {
    funding: Math.round(contract * 12_000 * days * DIFFICULTY_INCOME[input.difficulty]),
    researchData: Math.round(containment * 4 * days * 10) / 10,
  };
}

/**
 * What putting a machine right will cost.
 *
 * Labour scales with what is broken, materials come out of stores first and are
 * bought in only for the shortfall, a better bay charges less for the same work,
 * urgency is a surcharge rather than a gate, and insurance takes a share of the
 * final bill. Every one of those is a line in the quote.
 */
export function repairQuote(context: RepairContext): RepairQuote {
  const armour = Math.max(0, context.armourMissing);
  const components = Math.max(0, context.componentMissing);
  const rarity = Math.max(1, context.rarityMultiplier);
  const capability = Math.max(0.2, context.bayCapability);

  // A capable bay does the same work for less, because it is not improvising.
  const labour = Math.round(((armour + components) * LABOUR_PER_POINT * rarity) / capability);

  const alloyNeeded = Math.round((armour / 120) * rarity * 10) / 10;
  const componentsNeeded = Math.round((components / 260) * rarity * 10) / 10;
  const alloyShortfall = Math.max(
    0,
    Math.round((alloyNeeded - Math.max(0, context.alloyAvailable)) * 10) / 10,
  );
  const componentShortfall = Math.max(
    0,
    Math.round((componentsNeeded - Math.max(0, context.componentsAvailable)) * 10) / 10,
  );
  const materialsBoughtIn = Math.round(alloyShortfall * ALLOY_PRICE + componentShortfall * COMPONENT_PRICE);

  const urgency = Math.max(1, context.urgency);
  const beforeUrgency = labour + materialsBoughtIn;
  const urgencySurcharge = Math.round(beforeUrgency * (urgency - 1));

  const gross = beforeUrgency + urgencySurcharge;
  const insured = Math.round(gross * Math.max(0, Math.min(1, context.insuredFraction)));
  const total = Math.max(0, gross - insured);

  return {
    labour,
    alloyNeeded,
    componentsNeeded,
    alloyShortfall,
    componentShortfall,
    materialsBoughtIn,
    urgencySurcharge,
    insured,
    total,
    lines: [
      { label: "Labour", amount: labour },
      { label: "Materials bought in", amount: materialsBoughtIn },
      { label: `Urgency ${urgency.toFixed(2)}x`, amount: urgencySurcharge },
      { label: "Covered by contract", amount: -insured },
    ].filter((line) => line.amount !== 0),
  };
}

export function emptyEconomySnapshot(): EconomySnapshot {
  return {
    schemaVersion: ECONOMY_SCHEMA_VERSION,
    pool: emptyPool(),
    difficulty: "standard",
    ledger: emptyLedgerSnapshot(),
  };
}

export function validateEconomySnapshot(snapshot: unknown): string[] {
  if (typeof snapshot !== "object" || snapshot === null) return ["economy snapshot must be an object"];
  const record = snapshot as Record<string, unknown>;
  if (record["schemaVersion"] !== ECONOMY_SCHEMA_VERSION) {
    return [`economy snapshot version ${String(record["schemaVersion"])} is not ${ECONOMY_SCHEMA_VERSION}`];
  }
  const pool = record["pool"];
  if (typeof pool !== "object" || pool === null) return ["economy.pool must be an object"];
  const errors: string[] = [];
  for (const key of ["funding", "alloy", "components", "reactorMaterial", "researchData"] as const) {
    const value = (pool as Record<string, unknown>)[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`economy.pool.${key} must be a finite number`);
    }
  }
  if (!DIFFICULTY_LEVELS.includes(record["difficulty"] as Difficulty)) {
    errors.push(`unknown difficulty "${String(record["difficulty"])}"`);
  }
  return errors;
}

export { tissueWorth };

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
