import {
  FACILITY_EFFECTS,
  type FacilityDefinition,
  type FacilityEffect,
  type FacilityKind,
} from "../data/facilities";
import type { ContentRegistry } from "../data/registry";

/**
 * What the complex is actually worth.
 *
 * A facility that only changed a sentence on a panel would be a menu unlock, so
 * every tier declares named effects and this is the one place they are added up.
 * Everything else in the game asks here rather than looking at tiers itself,
 * which is what stops "the repair bay is upgraded" and "repairs are faster"
 * from being two different opinions.
 *
 * Effects degrade rather than disappear. A complex short of power or staff still
 * gets some of what it built, in proportion, because a brownout should make a
 * decision worse rather than pretend it was never made.
 */

export interface FacilityStanding {
  readonly facilityId: FacilityKind;
  /** 0 when absent, otherwise the tier standing and running. */
  readonly tier: number;
  /** True when it is built and not currently torn open for an upgrade. */
  readonly operational: boolean;
}

export interface EffectContext {
  /** 0 to 1 of the power the complex needs that it has. */
  readonly powerFactor: number;
  /** 0 to 1 of the posts that are filled. */
  readonly staffFactor: number;
}

/** Every effect, and what the complex is currently worth on each. */
export type EffectTotals = Record<FacilityEffect, number>;

export function noEffects(): EffectTotals {
  const totals = {} as EffectTotals;
  for (const effect of FACILITY_EFFECTS) totals[effect] = 1;
  return totals;
}

/**
 * How much of a built effect a complex short of power or staff actually gets.
 *
 * At full power and full staffing this is one and the facility is worth exactly
 * what it says. Below that, the part of the effect above one is scaled back: a
 * repair bay worth 1.9 at full power is worth 1.45 at half, not nothing and not
 * still 1.9. The floor is deliberate, because a room that is built and lit is
 * worth something even when the complex is struggling.
 */
export function effectivenessOf(context: EffectContext): number {
  const power = clamp01(context.powerFactor);
  const staff = clamp01(context.staffFactor);
  // Power matters more than staffing: a dark room is useless, an understaffed
  // one is slow.
  return clamp01(power * 0.65 + staff * 0.35);
}

/**
 * Adds up what every standing facility contributes.
 *
 * Multiplicative across facilities, so two rooms that both help repairs help
 * more than either alone without either being ignored. A facility mid-upgrade
 * contributes its old tier: the room is torn open, not demolished.
 */
export function resolveEffects(
  standings: readonly FacilityStanding[],
  definitions: ContentRegistry<FacilityDefinition>,
  context: EffectContext,
): EffectTotals {
  const totals = noEffects();
  const share = effectivenessOf(context);

  for (const standing of standings) {
    if (standing.tier <= 0) continue;
    const definition = definitions.get(standing.facilityId);
    if (!definition) continue;
    const tier = definition.tiers[standing.tier - 1];
    if (!tier) continue;

    for (const [key, value] of Object.entries(tier.effects)) {
      const effect = key as FacilityEffect;
      const declared = value ?? 1;
      // Scale the part above one, so a shortfall costs the upgrade rather than
      // the room. An effect below one is a cost and is applied in full: being
      // short of power is not a way to dodge a downside.
      const applied = declared >= 1 ? 1 + (declared - 1) * share : declared;
      totals[effect] *= applied;
    }
  }
  return totals;
}

/** One effect, or one when nothing provides it. */
export function effectValue(totals: EffectTotals, effect: FacilityEffect): number {
  const value = totals[effect];
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * What the complex is providing, in words.
 *
 * Only the effects that are actually doing something, so a panel does not list
 * nine multipliers of exactly one.
 */
export function describeEffects(totals: EffectTotals): readonly string[] {
  const lines: string[] = [];
  for (const effect of FACILITY_EFFECTS) {
    const value = totals[effect];
    if (Math.abs(value - 1) < 0.005) continue;
    lines.push(`${LABELS[effect]} ${value.toFixed(2)}x`);
  }
  return lines;
}

/** What each effect is called on a panel. A table, so a new effect is a row. */
const LABELS: Readonly<Record<FacilityEffect, string>> = {
  repairRate: "Repair work",
  constructionRate: "Construction",
  trainingRate: "Training",
  medicalRate: "Recovery",
  researchYield: "Research yield",
  contractYield: "Contract funding",
  deliverySpeed: "Delivery speed",
  containmentYield: "Containment yield",
  defenceStrength: "Coastal defence",
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
