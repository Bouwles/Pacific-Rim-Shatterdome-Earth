import { ContentRegistry } from "../data/registry";
import {
  MULTI_SLOTS,
  STRUCTURAL_SLOTS,
  createPartRegistry,
  type Fitting,
  type PartDefinition,
  type PartSlot,
} from "../data/parts";
import type { JaegerDefinition } from "../data/jaegers";

/**
 * The one machine you build yourself.
 *
 * A blueprint is a list of part ids and some words. Everything else about the
 * machine, including the `JaegerDefinition` the rest of the game flies, is
 * derived from it. That is deliberate: there is no second kind of Jaeger and no
 * parallel combat path. The assembly synthesises an ordinary chassis definition
 * and the roster, the arena and the locomotion controller never learn that this
 * one was assembled rather than bought.
 *
 * Everything here is pure and serialisable. No Babylon, no DOM, no RNG, no
 * clock. A blueprint goes in, numbers and violations come out.
 */

export const BLUEPRINT_SCHEMA_VERSION = 1;

/** The chassis id every custom machine uses. There is only ever one design. */
export const CUSTOM_CHASSIS_ID = "custom-mk1";

export interface Blueprint {
  readonly id: string;
  readonly name: string;
  /** One part per structural slot, and any number in the multi slots. */
  readonly parts: Readonly<Record<PartSlot, readonly string[]>>;
  /** Free text the player wrote on the hull. */
  readonly emblemText: string;
}

export function emptyBlueprint(id = "blueprint.1"): Blueprint {
  return {
    id,
    name: "Unnamed",
    parts: {
      head: [],
      torso: [],
      arms: [],
      legs: [],
      reactor: [],
      armor: [],
      movement: [],
      weapon: [],
      ability: [],
      paint: ["part.paint.slate"],
      markings: ["part.markings.none"],
      emblem: ["part.emblem.none"],
    },
    emblemText: "",
  };
}

/** A build that is legal and unremarkable, for tests and for a starting point. */
export function starterBlueprint(id = "blueprint.starter"): Blueprint {
  const base = emptyBlueprint(id);
  return {
    ...base,
    name: "Yard Standard",
    parts: {
      ...base.parts,
      head: ["part.head.standard"],
      torso: ["part.torso.balanced"],
      arms: ["part.arms.standard"],
      legs: ["part.legs.standard"],
      reactor: ["part.reactor.standard"],
      armor: ["part.armor.plate"],
      movement: ["part.movement.standard"],
      weapon: ["part.weapon.chainsword"],
    },
  };
}

/** How badly a rule was broken. A warning still flies; a violation does not. */
export type IssueSeverity = "violation" | "warning";

export interface BuildIssue {
  readonly severity: IssueSeverity;
  /** Which slot the player should look at. Null when it is the whole machine. */
  readonly slot: PartSlot | null;
  /** What is wrong, in words, with the numbers that make it wrong. */
  readonly message: string;
}

/** Everything a build is, worked out from its parts. */
export interface BuildStats {
  readonly massTons: number;
  /** 0 at the feet, 1 at the head. Where the mass actually sits. */
  readonly massHeight: number;
  readonly powerOutputMw: number;
  readonly powerDrawMw: number;
  readonly heatOutput: number;
  readonly heatDissipation: number;
  /** 0 to 1 of incoming damage stopped, averaged across the machine. */
  readonly armorRating: number;
  readonly structure: number;
  readonly actuatorCapacity: number;
  /** Mass the actuators actually have to carry. */
  readonly actuatorLoad: number;
  /**
   * How steady it is, 0 to 1.
   *
   * A separate axis from mobility on purpose. A build can be quick and unstable,
   * or slow and planted, and neither collapses into the other.
   */
  readonly balance: number;
  readonly mobilityScale: number;
  readonly turnScale: number;
  readonly ammunitionVolume: number;
  readonly moduleSlots: number;
  readonly hardpointsUsed: number;
  readonly hardpointsAvailable: number;
  readonly cost: number;
}

export interface AssemblyResult {
  readonly stats: BuildStats;
  readonly issues: readonly BuildIssue[];
  /** True when nothing is a violation. Warnings do not stop a launch. */
  readonly legal: boolean;
  /** Numbers fed to the procedural generator. Proportions, never a mesh. */
  readonly silhouette: {
    readonly heightMeters: number;
    readonly bulk: number;
    readonly shoulderRatio: number;
    readonly legRatio: number;
    readonly torsoRatio: number;
    readonly headRatio: number;
    /** Named so a real GLB can be dropped in against the same slots later. */
    readonly paintId: string;
    readonly markingsId: string;
    readonly emblemId: string;
  };
}

/** Baseline height a custom machine is built around, before part scaling. */
export const BASE_HEIGHT_METERS = 76;
/**
 * How much a part that is not the legs moves the machine's speed.
 *
 * The legs set the pace and everything else adjusts it. Below one so that
 * stacking several quick parts is worth doing without being the only thing
 * worth doing.
 */
export const NON_LEG_MOBILITY_WEIGHT = 0.4;
/** Mass a machine of that height is expected to be, for the balance curve. */
const REFERENCE_MASS = 2_600;

function partsOf(blueprint: Blueprint, registry: ContentRegistry<PartDefinition>): readonly PartDefinition[] {
  const chosen: PartDefinition[] = [];
  for (const ids of Object.values(blueprint.parts)) {
    for (const id of ids) {
      const part = registry.get(id);
      if (part) chosen.push(part);
    }
  }
  return chosen;
}

/**
 * Works out what a blueprint is, and everything wrong with it.
 *
 * Every violated constraint is reported, never only the first. A player looking
 * at a refused build has to be able to see the whole list, or fixing one thing
 * only reveals the next and the builder becomes a guessing game.
 */
export function assemble(
  blueprint: Blueprint,
  registry: ContentRegistry<PartDefinition> = createPartRegistry(),
): AssemblyResult {
  const issues: BuildIssue[] = [];
  const chosen = partsOf(blueprint, registry);

  // --- what is missing or impossible ---------------------------------------
  for (const slot of STRUCTURAL_SLOTS) {
    const ids = blueprint.parts[slot] ?? [];
    if (ids.length === 0) {
      issues.push({ severity: "violation", slot, message: `No ${slot} fitted.` });
    } else if (ids.length > 1) {
      issues.push({
        severity: "violation",
        slot,
        message: `A machine has one ${slot}, and this has ${ids.length}.`,
      });
    }
  }
  for (const [slot, ids] of Object.entries(blueprint.parts) as [PartSlot, readonly string[]][]) {
    for (const id of ids) {
      const part = registry.get(id);
      if (!part) {
        issues.push({ severity: "violation", slot, message: `No such part: ${id}.` });
      } else if (part.slot !== slot) {
        issues.push({
          severity: "violation",
          slot,
          message: `${part.displayName} is a ${part.slot} part and cannot go in the ${slot} slot.`,
        });
      }
    }
    if (!MULTI_SLOTS.includes(slot) && !STRUCTURAL_SLOTS.includes(slot) && ids.length > 1) {
      issues.push({ severity: "violation", slot, message: `Only one ${slot} at a time.` });
    }
  }

  // --- totals ---------------------------------------------------------------
  let massTons = 0;
  let weightedHeight = 0;
  let powerOutputMw = 0;
  let powerDrawMw = 0;
  let heatOutput = 0;
  let heatDissipation = 0;
  let armorWeighted = 0;
  let structure = 0;
  let actuatorCapacity = 0;
  // Mobility and turn are anchored to the legs and nudged by everything else,
  // rather than being a product of every part. A naive product compounds: five
  // parts that are each ten percent quicker become sixty percent quicker, which
  // is how a builder ends up with one obviously correct answer.
  let mobilityDelta = 0;
  let turnDelta = 0;
  let ammunitionVolume = 0;
  let moduleSlots = 0;
  let hardpointsAvailable = 0;
  let cost = 0;
  let bulk = 1;
  let shoulderRatio = 1;
  let heightScale = 1;

  for (const part of chosen) {
    massTons += part.massTons;
    weightedHeight += part.massTons * part.massHeight;
    powerOutputMw += part.powerOutputMw;
    powerDrawMw += part.powerDrawMw;
    heatOutput += part.heatOutput;
    heatDissipation += part.heatDissipation;
    armorWeighted += part.armorRating * Math.max(1, part.structure);
    structure += part.structure;
    actuatorCapacity += part.actuatorCapacity;
    if (part.slot !== "legs") {
      mobilityDelta += (part.mobilityScale - 1) * NON_LEG_MOBILITY_WEIGHT;
      turnDelta += (part.turnScale - 1) * NON_LEG_MOBILITY_WEIGHT;
    }
    ammunitionVolume += part.ammunitionVolume;
    moduleSlots += part.moduleSlots;
    hardpointsAvailable += part.hardpoints;
    cost += part.cost;
    bulk *= part.silhouette.bulk;
    shoulderRatio *= part.silhouette.shoulderRatio;
    heightScale *= part.silhouette.heightScale;
  }

  const legs = chosen.find((part) => part.slot === "legs");
  const mobilityScale = Math.max(0.25, (legs?.mobilityScale ?? 1) + mobilityDelta);
  const turnScale = Math.max(0.25, (legs?.turnScale ?? 1) + turnDelta);

  const massHeight = massTons > 0 ? weightedHeight / massTons : 0.5;
  const armorRating = structure > 0 ? armorWeighted / structure : 0;
  const hardpointsUsed = (blueprint.parts.weapon ?? []).length;

  // Everything above the legs has to be carried by them.
  const carried = chosen
    .filter((part) => part.slot !== "legs")
    .reduce((total, part) => total + part.massTons, 0);
  const actuatorLoad = carried;

  // Balance: how top-heavy it is against how much the drive can settle it. A
  // separate axis from mobility, so a fast build is not automatically a steady
  // one and armour does not silently buy stability.
  const topHeaviness = Math.max(0, massHeight - 0.45) * 2.2;
  const massPenalty = Math.max(0, massTons / REFERENCE_MASS - 1) * 0.35;
  const balance = Math.max(0, Math.min(1, 1 - topHeaviness - massPenalty));

  // --- what is legal but unwise, and what is not legal at all ---------------
  if (powerDrawMw > powerOutputMw) {
    issues.push({
      severity: "violation",
      slot: "reactor",
      message: `Draws ${Math.round(powerDrawMw)} MW and makes ${Math.round(powerOutputMw)} MW. Short ${Math.round(powerDrawMw - powerOutputMw)} MW.`,
    });
  } else if (powerOutputMw - powerDrawMw < powerOutputMw * 0.08) {
    issues.push({
      severity: "warning",
      slot: "reactor",
      message: `Only ${Math.round(powerOutputMw - powerDrawMw)} MW spare. A hit to the reactor browns out the machine.`,
    });
  }

  if (heatOutput > heatDissipation) {
    issues.push({
      severity: "violation",
      slot: "armor",
      message: `Makes ${Math.round(heatOutput)} heat and sheds ${Math.round(heatDissipation)}. It cooks itself in a sustained fight.`,
    });
  } else if (heatDissipation - heatOutput < heatOutput * 0.12) {
    issues.push({
      severity: "warning",
      slot: "armor",
      message: "Cooling has almost no margin. Anything that raises heat will overheat it.",
    });
  }

  if (actuatorLoad > actuatorCapacity) {
    issues.push({
      severity: "violation",
      slot: "legs",
      message: `Carries ${Math.round(actuatorLoad)} t on actuators rated for ${Math.round(actuatorCapacity)} t.`,
    });
  } else if (actuatorCapacity - actuatorLoad < actuatorCapacity * 0.1) {
    issues.push({
      severity: "warning",
      slot: "legs",
      message: "Actuators are at their limit. Nothing more can be bolted on.",
    });
  }

  if (hardpointsUsed > hardpointsAvailable) {
    issues.push({
      severity: "violation",
      slot: "weapon",
      message: `${hardpointsUsed} weapons on ${hardpointsAvailable} hardpoints.`,
    });
  }

  if (ammunitionVolume < 0) {
    issues.push({
      severity: "violation",
      slot: "weapon",
      message: `The weapons want ${Math.abs(Math.round(ammunitionVolume))} more rounds than the hull can stow.`,
    });
  } else if (ammunitionVolume < 60 && hardpointsUsed > 0) {
    issues.push({
      severity: "warning",
      slot: "torso",
      message: `Only ${Math.round(ammunitionVolume)} rounds aboard. That is one engagement.`,
    });
  }

  if (balance < 0.25) {
    issues.push({
      severity: "violation",
      slot: "movement",
      message: `Balance ${Math.round(balance * 100)} percent. It cannot stay upright under its own weight.`,
    });
  } else if (balance < 0.45) {
    issues.push({
      severity: "warning",
      slot: "movement",
      message: `Balance ${Math.round(balance * 100)} percent. It will go down easily and take a while to get up.`,
    });
  }

  // --- fittings -------------------------------------------------------------
  // Compatibility is a fitting match rather than a name check, so a part added
  // later works with whatever already offers the right fitting.
  const provided = new Set<Fitting>();
  for (const part of chosen) for (const fitting of part.provides) provided.add(fitting);
  for (const part of chosen) {
    if (part.requires.length === 0) continue;
    // Requiring several fittings means any one of them will do: a torso that
    // takes a light or a heavy spine lists both.
    if (!part.requires.some((fitting) => provided.has(fitting))) {
      issues.push({
        severity: "violation",
        slot: part.slot,
        message: `${part.displayName} needs ${part.requires.join(" or ")}, and nothing on this build provides it.`,
      });
    }
  }

  const stats: BuildStats = {
    massTons: Math.round(massTons),
    massHeight: Math.round(massHeight * 1000) / 1000,
    powerOutputMw: Math.round(powerOutputMw),
    powerDrawMw: Math.round(powerDrawMw),
    heatOutput: Math.round(heatOutput),
    heatDissipation: Math.round(heatDissipation),
    armorRating: Math.round(armorRating * 1000) / 1000,
    structure: Math.round(structure),
    actuatorCapacity: Math.round(actuatorCapacity),
    actuatorLoad: Math.round(actuatorLoad),
    balance: Math.round(balance * 1000) / 1000,
    mobilityScale: Math.round(mobilityScale * 1000) / 1000,
    turnScale: Math.round(turnScale * 1000) / 1000,
    ammunitionVolume: Math.round(ammunitionVolume),
    moduleSlots,
    hardpointsUsed,
    hardpointsAvailable,
    cost: Math.round(cost),
  };

  const legal = !issues.some((issue) => issue.severity === "violation");
  const height = BASE_HEIGHT_METERS * Math.max(0.7, Math.min(1.4, heightScale));

  return {
    stats,
    issues,
    legal,
    silhouette: {
      heightMeters: Math.round(height * 10) / 10,
      bulk: Math.round(Math.max(0.6, Math.min(1.8, bulk)) * 1000) / 1000,
      shoulderRatio: Math.round(0.3 * Math.max(0.7, Math.min(1.5, shoulderRatio)) * 1000) / 1000,
      // Proportions follow where the mass is, so a leg-heavy build stands on
      // visibly longer legs rather than only reading differently on a panel.
      legRatio: Math.round(Math.max(0.3, 0.52 - massHeight * 0.15) * 1000) / 1000,
      torsoRatio: Math.round(Math.max(0.2, 0.3 + massHeight * 0.1) * 1000) / 1000,
      headRatio: 0.12,
      paintId: blueprint.parts.paint?.[0] ?? "part.paint.slate",
      markingsId: blueprint.parts.markings?.[0] ?? "part.markings.none",
      emblemId: blueprint.parts.emblem?.[0] ?? "part.emblem.none",
    },
  };
}

/**
 * Turns a legal blueprint into an ordinary chassis definition.
 *
 * This is the whole reason the builder does not need a parallel combat path.
 * What comes out is a `JaegerDefinition` like any other, so the roster owns it,
 * the arena fights it and the locomotion controller drives it without any of
 * them knowing it was assembled.
 *
 * Returns null for an illegal build, because an illegal build must not be able
 * to reach the pad by any route.
 */
export function chassisFrom(
  blueprint: Blueprint,
  result: AssemblyResult,
  template: JaegerDefinition,
): JaegerDefinition | null {
  if (!result.legal) return null;
  const { stats, silhouette } = result;

  return {
    ...template,
    id: CUSTOM_CHASSIS_ID,
    name: blueprint.name.trim().length > 0 ? blueprint.name.trim() : "Unnamed",
    manufacturer: "Shatterdome Earth Assembly",
    markDesignation: "Custom build",
    massBudget: {
      massTons: stats.massTons,
      powerOutputMw: stats.powerOutputMw,
      // What is left after everything is running is what the cooling can spare.
      coolingCapacity: Math.max(
        0.1,
        Math.min(0.95, (stats.heatDissipation - stats.heatOutput) / Math.max(1, stats.heatDissipation)),
      ),
    },
    locomotion: {
      ...template.locomotion,
      heightMeters: silhouette.heightMeters,
      walkSpeedMps: template.locomotion.walkSpeedMps * stats.mobilityScale,
      runSpeedMps: template.locomotion.runSpeedMps * stats.mobilityScale,
      strafeSpeedMps: template.locomotion.strafeSpeedMps * stats.mobilityScale,
      guardSpeedMps: template.locomotion.guardSpeedMps * stats.mobilityScale,
      turnRateDegPerSecond: template.locomotion.turnRateDegPerSecond * stats.turnScale,
      turnInPlaceRateDegPerSecond: template.locomotion.turnInPlaceRateDegPerSecond * stats.turnScale,
      // A badly balanced machine takes longer to get back up, which is where
      // balance stops being a number on a panel and starts costing a fight.
      getUpSeconds: template.locomotion.getUpSeconds * (2 - stats.balance),
    },
    // Deliberately not purchasable and deliberately priced at zero: it is built,
    // not bought, and the chassis validator refuses a price on anything with no
    // seller.
    listPrice: 0,
    upkeepPerDay: Math.round(3_000 + stats.massTons * 2.4),
    acquisition: ["research-manufacture"],
    signatureEquipment: [],
    balance: {
      durability: [
        Math.max(0, Math.min(1, stats.armorRating)),
        Math.max(0, Math.min(1, stats.armorRating + stats.structure / 12_000)),
      ],
      damage: [0.3, Math.max(0.35, Math.min(1, 0.3 + stats.hardpointsUsed * 0.18))],
      mobility: [
        Math.max(0, Math.min(1, stats.mobilityScale - 0.5)),
        Math.max(0.05, Math.min(1, stats.mobilityScale - 0.25)),
      ],
      range: [0.2, 0.5],
      tradeoff: describeTradeoff(stats),
    },
    description: `Assembled in the complex rather than bought. ${describeTradeoff(stats)}`,
  };
}

/** The honest sentence about a build, derived rather than written. */
export function describeTradeoff(stats: BuildStats): string {
  const notes: string[] = [];
  notes.push(stats.mobilityScale >= 1.1 ? "Quick" : stats.mobilityScale <= 0.85 ? "Slow" : "Steady");
  notes.push(
    stats.armorRating >= 0.32
      ? "well armoured"
      : stats.armorRating <= 0.18
        ? "thin skinned"
        : "fairly protected",
  );
  notes.push(
    stats.balance >= 0.7
      ? "and planted"
      : stats.balance <= 0.45
        ? "and top heavy"
        : "and reasonably balanced",
  );
  return `${notes.join(", ")}.`;
}
