import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * Who builds the machines.
 *
 * A manufacturer is where a chassis comes from, what they are good at, how long
 * they take, and what they will and will not sell you. It is also the thing
 * that makes a market rotation feel like a world rather than a shop: an offer
 * comes from a yard in a particular place with a particular reputation, and
 * that yard has its own reasons for what it has in stock this month.
 *
 * Nothing here is a store card and nothing knows a chassis by name. A
 * manufacturer describes a supplier; what they happen to be offering is worked
 * out by the market from the chassis table and a seeded rotation.
 */

export const MANUFACTURER_SPECIALTIES = [
  "heavy-armour",
  "speed",
  "gunnery",
  "endurance",
  "prototype",
  "refit",
] as const;
export type ManufacturerSpecialty = (typeof MANUFACTURER_SPECIALTIES)[number];

export interface ManufacturerDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  /** Where the yard is. Regional identity, not a gameplay region id. */
  readonly homeRegion: string;
  readonly specialties: readonly ManufacturerSpecialty[];
  /** 0 to 1. Standing with the Corps, which moves with what you buy and fly. */
  readonly baseReputation: number;
  /** Days between a contract being signed and the machine arriving. */
  readonly leadTimeDays: number;
  /** Multiplier on list price. A prestige yard charges for the name. */
  readonly priceScale: number;
  /** 0 to 1 chance any given rotation includes refurbished stock from them. */
  readonly refurbishedChance: number;
  /** Discount on refurbished stock, 0 to 1. */
  readonly refurbishedDiscount: number;
  /** How many offers they can have on the board at once. */
  readonly maxConcurrentOffers: number;
  /** Conditions attached to their contracts, in plain language. */
  readonly conditions: readonly string[];
  readonly description: string;
}

const MANUFACTURERS: readonly ManufacturerDefinition[] = [
  {
    id: "maker.tarrant-yards",
    displayName: "Tarrant Yards",
    homeRegion: "Clyde estuary, Scotland",
    specialties: ["heavy-armour", "endurance"],
    baseReputation: 0.62,
    leadTimeDays: 18,
    priceScale: 1,
    refurbishedChance: 0.4,
    refurbishedDiscount: 0.35,
    maxConcurrentOffers: 2,
    conditions: [
      "Payment in full on delivery. No staged terms.",
      "Refurbished hulls carry their previous service record, scars and all.",
    ],
    description:
      "An old shipyard that never stopped building heavy things. Slow, unfashionable, and nothing they deliver falls over.",
  },
  {
    id: "maker.hanjin-dynamics",
    displayName: "Hanjin Dynamics",
    homeRegion: "Busan, Korea",
    specialties: ["speed", "gunnery"],
    baseReputation: 0.71,
    leadTimeDays: 11,
    priceScale: 1.15,
    refurbishedChance: 0.2,
    refurbishedDiscount: 0.25,
    maxConcurrentOffers: 2,
    conditions: [
      "Delivery slots are allocated by standing, not by who asks first.",
      "Signature equipment is fitted at the yard and is not sold separately.",
    ],
    description: "Fast hulls and faster guns, delivered on time, at a price that reflects both.",
  },
  {
    id: "maker.novaya-kuznitsa",
    displayName: "Novaya Kuznitsa",
    homeRegion: "Vladivostok, Russia",
    specialties: ["heavy-armour", "refit"],
    baseReputation: 0.55,
    leadTimeDays: 15,
    priceScale: 0.82,
    refurbishedChance: 0.55,
    refurbishedDiscount: 0.4,
    maxConcurrentOffers: 3,
    conditions: [
      "Everything is sold as seen. Inspection is your problem.",
      "They will take a wreck in part exchange and say nothing about its condition.",
    ],
    description:
      "The cheapest way to put something enormous on the pad. Half their stock has been somewhere else first.",
  },
  {
    id: "maker.aurora-collective",
    displayName: "Aurora Collective",
    homeRegion: "Valparaiso, Chile",
    specialties: ["prototype", "speed"],
    baseReputation: 0.48,
    leadTimeDays: 24,
    priceScale: 1.4,
    refurbishedChance: 0.05,
    refurbishedDiscount: 0.15,
    maxConcurrentOffers: 1,
    conditions: [
      "Prototype hulls ship with an unfinished upgrade track and a written apology.",
      "They want telemetry back from every sortie, and the contract says so.",
    ],
    description:
      "A research yard that builds one machine at a time and considers every one of them an argument.",
  },
];

export function validateManufacturer(entry: ManufacturerDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("maker.")) errors.push('id must start with "maker."');
  if (!entry.displayName) errors.push("displayName required");
  if (!entry.homeRegion) errors.push("homeRegion required: a yard is somewhere");
  if (!entry.description) errors.push("description required");
  if (entry.specialties.length === 0) errors.push("a manufacturer must be good at something");
  for (const specialty of entry.specialties) {
    if (!MANUFACTURER_SPECIALTIES.includes(specialty)) errors.push(`unknown specialty "${specialty}"`);
  }
  for (const key of ["baseReputation", "refurbishedChance", "refurbishedDiscount"] as const) {
    const value = entry[key];
    if (!Number.isFinite(value) || value < 0 || value > 1) errors.push(`${key} must be within [0, 1]`);
  }
  if (!Number.isInteger(entry.leadTimeDays) || entry.leadTimeDays <= 0) {
    errors.push("leadTimeDays must be a positive integer: nothing is delivered instantly");
  }
  if (!Number.isFinite(entry.priceScale) || entry.priceScale <= 0)
    errors.push("priceScale must be above zero");
  if (!Number.isInteger(entry.maxConcurrentOffers) || entry.maxConcurrentOffers <= 0) {
    errors.push("maxConcurrentOffers must be a positive integer");
  }
  if (entry.conditions.length === 0) {
    errors.push("a contract with no conditions is a contract nobody has read");
  }
  return errors;
}

export function createManufacturerRegistry(): ContentRegistry<ManufacturerDefinition> {
  const registry = new ContentRegistry<ManufacturerDefinition>(validateManufacturer);
  for (const manufacturer of MANUFACTURERS) registry.register(manufacturer);
  return registry;
}

export const MANUFACTURER_DEFINITIONS = MANUFACTURERS;

/**
 * What a yard charges this buyer.
 *
 * Reputation cuts the price rather than gating the stock: a yard that thinks
 * well of you sells at a better number, and one that does not still sells.
 */
export function priceFor(
  manufacturer: ManufacturerDefinition,
  listPrice: number,
  reputation: number,
): number {
  const standing = Math.max(0, Math.min(1, reputation));
  const discount = 1 - standing * 0.15;
  return Math.round(listPrice * manufacturer.priceScale * discount);
}

/** Days until delivery, which a good standing shortens but never removes. */
export function leadTimeFor(manufacturer: ManufacturerDefinition, reputation: number): number {
  const standing = Math.max(0, Math.min(1, reputation));
  return Math.max(5, Math.round(manufacturer.leadTimeDays * (1 - standing * 0.25)));
}
