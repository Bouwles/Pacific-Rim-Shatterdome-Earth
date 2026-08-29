/**
 * The hunt board.
 *
 * A hunt is a creature in a place: the one pairing the board offers, what a
 * pilot should bring to it, and what it pays. Hunts point at the creatures
 * and regions that already exist; they add no content, only the way in.
 */

export interface HuntDefinition {
  readonly id: string;
  readonly kaijuId: string;
  readonly regionId: string;
  readonly title: string;
  readonly location: string;
  readonly category: string;
  readonly recommendedLevel: number;
  readonly difficulty: "Standard" | "Hard" | "Severe";
  readonly materials: readonly string[];
  readonly firstClear: string;
  readonly repeat: string;
  readonly traits: readonly string[];
  readonly weaknesses: readonly string[];
  /** Metres between the machine and the creature when the fight opens. */
  readonly openingRangeMeters: number;
  /** Ordinal on the board; the first hunt is the flagship. */
  readonly order: number;
}

export const HUNTS: readonly HuntDefinition[] = [
  {
    id: "hunt.knifehead.anchorage",
    kaijuId: "kaiju.biped-alpha",
    regionId: "anchorage",
    title: "Knifehead",
    location: "Anchorage, Alaska",
    category: "Category III",
    recommendedLevel: 1,
    difficulty: "Standard",
    materials: ["Kaiju bone", "Blade plating", "Tissue sample"],
    firstClear: "Plasma Caster calibration, 2,000 funding",
    repeat: "Salvage by the tonne, samples",
    traits: ["Blade skull", "Closes fast", "Grabs at close range"],
    weaknesses: ["Posture breaks under heavy hits", "Slow to turn after a lunge"],
    openingRangeMeters: 140,
    order: 1,
  },
  {
    id: "hunt.otachi.hong-kong",
    kaijuId: "kaiju.serpent-delta",
    regionId: "hong-kong",
    title: "Otachi",
    location: "Hong Kong",
    category: "Category IV",
    recommendedLevel: 8,
    difficulty: "Hard",
    materials: ["Acid gland", "Tail spine", "Tissue sample"],
    firstClear: "Chain Sword tempering, 4,000 funding",
    repeat: "Salvage, samples, acid gland",
    traits: ["Acid spit at range", "Tail sweep", "Relentless pressure"],
    weaknesses: ["Guard the spit, punish the recovery", "Head is soft after a sweep"],
    openingRangeMeters: 160,
    order: 2,
  },
  {
    id: "hunt.leatherback.sydney",
    kaijuId: "kaiju.burrower-sigma",
    regionId: "sydney",
    title: "Leatherback",
    location: "Sydney Harbour",
    category: "Category IV",
    recommendedLevel: 12,
    difficulty: "Severe",
    materials: ["Armoured hide", "Vortex organ", "Tissue sample"],
    firstClear: "Elbow Rocket overdrive, 6,000 funding",
    repeat: "Salvage, samples, hide",
    traits: ["Armoured back", "Burrows and resurfaces", "Grapples hard"],
    weaknesses: ["Break the armour with charged heavies", "Dodge the resurface"],
    openingRangeMeters: 150,
    order: 3,
  },
];

export function huntById(id: string): HuntDefinition | undefined {
  return HUNTS.find((hunt) => hunt.id === id);
}
