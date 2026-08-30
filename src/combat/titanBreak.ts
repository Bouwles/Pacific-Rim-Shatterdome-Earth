import type { CombatEvent } from "./arena";

/**
 * Titan Break: the layer that turns a health bar into a creature that can be
 * dismantled.
 *
 * Three related layers on the boss. Armour is per region and is cracked by
 * heavy, charged, environmental and counter hits; when it comes off, the
 * arena's zone is told its plate is gone and every hit after that is honest
 * work. Stability is the arena's poise, pushed harder by counters, whiff
 * punishes, shoves and slams, and held down for a while after a stagger so
 * nothing loops. Vital damage is the zone health the arena already tracks,
 * with a bonus on exposed regions for the tools built for tissue.
 *
 * Drift Flow rewards variety and timing and never touches input. Telemetry
 * counts what the fight was won with, so the anti-mashing rule can be
 * measured rather than guessed.
 *
 * Pure and deterministic: fed arena events and a few facts, it returns the
 * next state and a list of notices for the presentation to act on.
 */

export const TITAN_REGIONS = ["head", "arm.L", "arm.R", "torso", "leg.L", "leg.R", "tail"] as const;
export type TitanRegion = (typeof TITAN_REGIONS)[number];

/** Which arena zone each region is; the core counts as the torso. */
export const REGION_BY_ZONE: Readonly<Record<string, TitanRegion>> = {
  head: "head",
  "limb.left": "arm.L",
  "limb.right": "arm.R",
  torso: "torso",
  core: "torso",
  "leg.left": "leg.L",
  "leg.right": "leg.R",
  tail: "tail",
};

export const ZONES_BY_REGION: Readonly<Record<TitanRegion, readonly string[]>> = {
  head: ["head"],
  "arm.L": ["limb.left"],
  "arm.R": ["limb.right"],
  torso: ["torso", "core"],
  "leg.L": ["leg.left"],
  "leg.R": ["leg.right"],
  tail: ["tail"],
};

/** Armour points per region: what it takes to strip the plate. */
export const ARMOR_POINTS: Readonly<Record<TitanRegion, number>> = {
  head: 1_300,
  "arm.L": 1_000,
  "arm.R": 1_000,
  torso: 2_400,
  "leg.L": 1_100,
  "leg.R": 1_100,
  tail: 600,
};

export interface RegionState {
  readonly id: TitanRegion;
  /** Armour left, 0 to 1. */
  readonly armor: number;
  /** Tissue opened, 0 to 1, from vital damage once the plate is off. */
  readonly wound: number;
  readonly broken: boolean;
  readonly severed: boolean;
  readonly brokenAtSeconds: number | null;
}

export type DamageSource =
  | "light-chain"
  | "heavy"
  | "counter"
  | "elbow-rocket"
  | "plasma"
  | "chain-sword"
  | "reactor-purge"
  | "grapple"
  | "environment"
  | "finisher"
  | "other";

export interface TitanTelemetry {
  readonly moveUsage: Readonly<Record<string, number>>;
  readonly damageBySource: Readonly<Record<DamageSource, number>>;
  readonly repeatedSequences: number;
  readonly defensiveActions: number;
  readonly perfectGuards: number;
  readonly timedDodges: number;
  readonly regionBreaks: number;
  readonly bossOpenings: number;
  readonly clashesWon: number;
  readonly clashesLost: number;
  readonly grapples: number;
  readonly environmentalHits: number;
  readonly hitsTaken: number;
  readonly idleSeconds: number;
  readonly durationSeconds: number;
}

export interface TitanBreakState {
  readonly regions: Readonly<Record<TitanRegion, RegionState>>;
  /** Drift Flow, 0 to 1. */
  readonly flow: number;
  /** Ultimate charge, 0 to 1. */
  readonly ultimate: number;
  /** The last four chain hits' move ids, for the repetition rule. */
  readonly recentChain: readonly string[];
  /** Completed chains, most recent last, as signatures. */
  readonly chainHistory: readonly string[];
  /** How many identical chains in a row the player has thrown. */
  readonly repeatCount: number;
  /** What the creature does about the pattern it has seen. */
  readonly adaptation: "none" | "armor-through" | "evade";
  /** Seconds left of stagger immunity on the creature. */
  readonly staggerImmunitySeconds: number;
  /** Seconds left of the current opening on the creature. */
  readonly openingSeconds: number;
  readonly lastHitLandedAt: number;
  readonly lastHitTakenAt: number;
  readonly lastMeaningfulInputAt: number;
  readonly lastFamily: "light" | "heavy" | "weapon" | "grapple" | null;
  readonly secondsElapsed: number;
  readonly telemetry: TitanTelemetry;
}

export interface TitanNotice {
  readonly kind:
    | "armor-crack"
    | "armor-broken"
    | "region-severed"
    | "flow-level"
    | "opening"
    | "adaptation"
    | "ultimate-ready";
  readonly region?: TitanRegion;
  readonly text: string;
  /** For the presentation: the arena zone to strip, when a plate comes off. */
  readonly zoneIds?: readonly string[];
  readonly level?: number;
}

const emptyTelemetry = (): TitanTelemetry => ({
  moveUsage: {},
  damageBySource: {
    "light-chain": 0,
    heavy: 0,
    counter: 0,
    "elbow-rocket": 0,
    plasma: 0,
    "chain-sword": 0,
    "reactor-purge": 0,
    grapple: 0,
    environment: 0,
    finisher: 0,
    other: 0,
  },
  repeatedSequences: 0,
  defensiveActions: 0,
  perfectGuards: 0,
  timedDodges: 0,
  regionBreaks: 0,
  bossOpenings: 0,
  clashesWon: 0,
  clashesLost: 0,
  grapples: 0,
  environmentalHits: 0,
  hitsTaken: 0,
  idleSeconds: 0,
  durationSeconds: 0,
});

export function createTitanBreak(): TitanBreakState {
  const regions = {} as Record<TitanRegion, RegionState>;
  for (const id of TITAN_REGIONS) {
    regions[id] = { id, armor: 1, wound: 0, broken: false, severed: false, brokenAtSeconds: null };
  }
  return {
    regions,
    flow: 0,
    ultimate: 0,
    recentChain: [],
    chainHistory: [],
    repeatCount: 0,
    adaptation: "none",
    staggerImmunitySeconds: 0,
    openingSeconds: 0,
    lastHitLandedAt: -10,
    lastHitTakenAt: -10,
    lastMeaningfulInputAt: 0,
    lastFamily: null,
    secondsElapsed: 0,
    telemetry: emptyTelemetry(),
  };
}

const LIGHT_CHAIN: ReadonlySet<string> = new Set([
  "melee.light.jab",
  "melee.light.cross",
  "melee.heavy.smash.forward",
  "melee.launcher.uppercut",
  "melee.run.punch",
]);

/** What a hit was thrown with, for the damage breakdown. */
export function damageSourceOf(moveId: string | null, weaponId: string | null): DamageSource {
  if (weaponId === "weapon.plasma-caster") return "plasma";
  if (weaponId === "weapon.chain-sword") return "chain-sword";
  if (weaponId) return "other";
  if (!moveId) return "other";
  if (LIGHT_CHAIN.has(moveId)) return "light-chain";
  if (moveId === "ability.elbow-rocket") return "elbow-rocket";
  if (moveId === "ability.reactor-purge") return "reactor-purge";
  if (moveId.startsWith("melee.sword.")) return "chain-sword";
  if (moveId === "melee.counter.heavy" || moveId === "melee.heavy.back.counter") return "counter";
  if (moveId.startsWith("grapple.") || moveId.startsWith("finisher.grapple")) return "grapple";
  if (moveId.startsWith("env.")) return "environment";
  if (moveId.startsWith("melee.finisher") || moveId.startsWith("finisher.")) return "finisher";
  if (
    moveId.startsWith("melee.heavy") ||
    moveId === "melee.charge.haymaker" ||
    moveId === "melee.guard-break.shoulder"
  )
    return "heavy";
  return "other";
}

/** Armour points a hit takes off, by what threw it. Plate answers to mass. */
export function armorDamageFor(source: DamageSource, damage: number, charged: boolean): number {
  const efficiency: Record<DamageSource, number> = {
    "light-chain": 0.3,
    heavy: charged ? 1.35 : 1,
    counter: 1.2,
    "elbow-rocket": 1.1,
    plasma: 0.45,
    "chain-sword": 0.3,
    "reactor-purge": 0.5,
    grapple: 1.4,
    environment: 1.6,
    finisher: 1.2,
    other: 0.6,
  };
  return damage * efficiency[source];
}

/** Extra vital damage on an exposed region, as a fraction of the hit. */
export function exposedBonusFor(source: DamageSource): number {
  switch (source) {
    case "plasma":
      return 0.6;
    case "chain-sword":
      return 0.3;
    case "counter":
      return 0.35;
    case "finisher":
      return 0.3;
    default:
      return 0.1;
  }
}

export function flowLevel(flow: number): 0 | 1 | 2 | 3 {
  if (flow >= 0.85) return 3;
  if (flow >= 0.6) return 2;
  if (flow >= 0.35) return 1;
  return 0;
}

export interface FlowGrants {
  /** Multiplier on ability cooldowns. */
  readonly cooldownScale: number;
  /** Multiplier on heat costs. */
  readonly heatScale: number;
  /** A light may be cancelled into a heavy during its recovery. */
  readonly extraCancel: boolean;
  /** The Synchronized Breaker is available when the meter is also full. */
  readonly breakerAccess: boolean;
}

export function flowGrants(flow: number): FlowGrants {
  const level = flowLevel(flow);
  return {
    cooldownScale: level >= 1 ? 0.8 : 1,
    heatScale: level >= 3 ? 0.7 : 1,
    extraCancel: level >= 2,
    breakerAccess: level >= 1,
  };
}

export function chainSignature(moves: readonly string[]): string {
  return moves.join(">");
}

export interface TitanFacts {
  readonly secondsElapsed: number;
  readonly deltaSeconds: number;
  /** The creature is staggered or down this frame. */
  readonly creatureReeling: boolean;
  /** The creature's reaction id this frame, if any. */
  readonly creatureReaction: string | null;
  /** A charged heavy landed this frame. */
  readonly chargedHit: boolean;
  /** The player pressed something that changes the fight this frame. */
  readonly meaningfulInput: boolean;
  /** Weapon changed within the last few seconds. */
  readonly recentWeaponSwitch: boolean;
  /** A grapple began while the creature was at or under the stability threshold. */
  readonly grappleAtThreshold: boolean;
  /** An environmental slam or throw landed this frame. */
  readonly environmentalHit: boolean;
  /** Clash results this frame. */
  readonly clashWon: boolean;
  readonly clashLost: boolean;
  /** Weapon id when a weapon fired the damaging hit, keyed by event index. */
  readonly weaponOfEvent?: (event: CombatEvent) => string | null;
}

export interface TitanStep {
  readonly state: TitanBreakState;
  readonly notices: readonly TitanNotice[];
  /** Extra vital damage to apply through the arena, per zone. */
  readonly bonusDamage: readonly {
    readonly zoneId: string;
    readonly amount: number;
    readonly kind: string;
  }[];
  /** Extra stability pressure to add on the creature. */
  readonly extraPoise: number;
}

const FLOW_DECAY_PER_SECOND = 0.018;
const STAGGER_IMMUNITY_SECONDS = 6;

/** Advances the layer with this tick's events and facts. */
export function stepTitanBreak(
  state: TitanBreakState,
  events: readonly CombatEvent[],
  facts: TitanFacts,
): TitanStep {
  const notices: TitanNotice[] = [];
  const bonusDamage: { zoneId: string; amount: number; kind: string }[] = [];
  let extraPoise = 0;
  const regions = { ...state.regions } as Record<TitanRegion, RegionState>;
  const moveUsage = { ...state.telemetry.moveUsage } as Record<string, number>;
  const damageBySource = { ...state.telemetry.damageBySource } as Record<DamageSource, number>;
  const telemetry = { ...state.telemetry, moveUsage, damageBySource } as TitanTelemetry & {
    repeatedSequences: number;
    defensiveActions: number;
    perfectGuards: number;
    timedDodges: number;
    regionBreaks: number;
    bossOpenings: number;
    clashesWon: number;
    clashesLost: number;
    grapples: number;
    environmentalHits: number;
    hitsTaken: number;
    idleSeconds: number;
    durationSeconds: number;
  };
  let flow = state.flow;
  let ultimate = state.ultimate;
  let recentChain = [...state.recentChain];
  let chainHistory = [...state.chainHistory];
  let repeatCount = state.repeatCount;
  let adaptation = state.adaptation;
  let lastHitLandedAt = state.lastHitLandedAt;
  let lastHitTakenAt = state.lastHitTakenAt;
  let lastMeaningfulInputAt = state.lastMeaningfulInputAt;
  let lastFamily = state.lastFamily;
  const now = facts.secondsElapsed;
  const previousLevel = flowLevel(flow);
  const previousUltimateReady = ultimate >= 0.999;

  for (const event of events) {
    if (event.type === "attack-started" && event.actorId === "jaeger" && event.moveId) {
      moveUsage[event.moveId] = (moveUsage[event.moveId] ?? 0) + 1;
      if (LIGHT_CHAIN.has(event.moveId)) {
        recentChain.push(event.moveId);
        if (recentChain.length >= 4) {
          const signature = chainSignature(recentChain.slice(-4));
          const last = chainHistory[chainHistory.length - 1];
          if (last === signature) {
            repeatCount += 1;
            telemetry.repeatedSequences += 1;
          } else repeatCount = 0;
          chainHistory = [...chainHistory.slice(-7), signature];
          recentChain = [];
        }
      } else if (event.moveId.startsWith("defense.")) {
        telemetry.defensiveActions += 1;
        recentChain = [];
      }
      if (
        event.moveId === "melee.heavy.overhead" ||
        event.moveId === "melee.heavy.spin.side" ||
        event.moveId === "melee.charge.haymaker" ||
        event.moveId === "melee.heavy.back.counter" ||
        event.moveId === "ability.elbow-rocket" ||
        event.moveId === "ability.reactor-purge"
      ) {
        recentChain = [];
      }
    }

    if (event.type === "hit" && event.actorId === "jaeger" && event.targetId === "kaiju") {
      const weaponId = facts.weaponOfEvent?.(event) ?? null;
      const source = damageSourceOf(event.moveId, weaponId);
      damageBySource[source] = (damageBySource[source] ?? 0) + event.damage;
      lastHitLandedAt = now;
      ultimate = Math.min(1, ultimate + event.damage * 0.00035);

      const family: TitanBreakState["lastFamily"] =
        source === "light-chain"
          ? "light"
          : source === "heavy" || source === "counter" || source === "elbow-rocket"
            ? "heavy"
            : source === "grapple" || source === "environment"
              ? "grapple"
              : "weapon";
      const varied = lastFamily !== null && lastFamily !== family;
      lastFamily = family;
      // Flow: variety pays, repetition barely does.
      const repeating = source === "light-chain" && repeatCount >= 1;
      flow = Math.min(1, flow + (repeating ? 0.006 : varied ? 0.06 : 0.025));
      if (source === "environment") {
        flow = Math.min(1, flow + 0.2);
        telemetry.environmentalHits += 1;
      }
      if (facts.recentWeaponSwitch && (source === "plasma" || source === "chain-sword"))
        flow = Math.min(1, flow + 0.05);

      const region = event.zoneId ? REGION_BY_ZONE[event.zoneId] : undefined;
      if (region) {
        const current = regions[region];
        if (!current.broken && !current.severed) {
          const points = armorDamageFor(source, event.damage, facts.chargedHit);
          const before = current.armor;
          const armor = Math.max(0, before - points / ARMOR_POINTS[region]);
          const crossed = Math.floor(before * 4) !== Math.floor(armor * 4);
          const broken = armor <= 0.001;
          regions[region] = { ...current, armor, broken, brokenAtSeconds: broken ? now : null };
          if (broken) {
            telemetry.regionBreaks += 1;
            flow = Math.min(1, flow + 0.1);
            ultimate = Math.min(1, ultimate + 0.12);
            notices.push({
              kind: "armor-broken",
              region,
              text: `${regionName(region)} armour broken`,
              zoneIds: ZONES_BY_REGION[region],
            });
          } else if (crossed) {
            notices.push({ kind: "armor-crack", region, text: `${regionName(region)} cracking` });
          }
        } else if (current.broken) {
          // Exposed: the tissue tools earn their keep, everything else a little.
          const bonus =
            event.damage * exposedBonusFor(source) + (facts.creatureReeling ? event.damage * 0.5 : 0);
          if (bonus > 0 && event.zoneId)
            bonusDamage.push({ zoneId: event.zoneId, amount: bonus, kind: event.damageKind ?? "impact" });
          regions[region] = { ...current, wound: Math.min(1, current.wound + event.damage / 2_500) };
          flow = Math.min(1, flow + 0.03);
        }
      }
      if (source === "counter") extraPoise += 60;
      if (facts.creatureReaction === "flinch" && (source === "heavy" || source === "elbow-rocket"))
        extraPoise += 20;
    }

    if (event.type === "hit" && event.targetId === "jaeger" && event.damage > 0) {
      telemetry.hitsTaken += 1;
      lastHitTakenAt = now;
      flow = Math.max(0, flow - 0.12);
    }
    if (event.type === "perfect-guard" && event.actorId === "jaeger") {
      telemetry.perfectGuards += 1;
      telemetry.defensiveActions += 1;
      flow = Math.min(1, flow + 0.12);
      ultimate = Math.min(1, ultimate + 0.06);
      extraPoise += 45;
    }
    if (event.type === "parried" && event.actorId === "jaeger") {
      telemetry.perfectGuards += 1;
      flow = Math.min(1, flow + 0.14);
      ultimate = Math.min(1, ultimate + 0.06);
      extraPoise += 60;
    }
    if (event.type === "evaded" && event.actorId === "jaeger") {
      telemetry.timedDodges += 1;
      flow = Math.min(1, flow + 0.1);
    }
    if (event.type === "grapple-started" && event.actorId === "jaeger") {
      telemetry.grapples += 1;
      if (facts.grappleAtThreshold) flow = Math.min(1, flow + 0.15);
    }
    if (event.type === "zone-destroyed" && event.actorId === "kaiju" && event.zoneId) {
      const region = REGION_BY_ZONE[event.zoneId];
      if (region && event.zoneId !== "core" && event.zoneId !== "torso") {
        regions[region] = { ...regions[region], severed: true, broken: true, armor: 0 };
        notices.push({ kind: "region-severed", region, text: `${regionName(region)} destroyed` });
      }
    }
  }

  if (facts.environmentalHit) {
    telemetry.environmentalHits += 1;
    flow = Math.min(1, flow + 0.2);
    extraPoise += 150;
  }
  if (facts.clashWon) {
    telemetry.clashesWon += 1;
    flow = Math.min(1, flow + 0.15);
  }
  if (facts.clashLost) telemetry.clashesLost += 1;

  // Pressure kept: hitting without being hit trickles flow in; silence drains it.
  const dt = Math.max(0, facts.deltaSeconds);
  const pressure = now - lastHitLandedAt < 3 && now - lastHitTakenAt > 3;
  flow = Math.max(0, Math.min(1, flow + (pressure ? 0.02 : -FLOW_DECAY_PER_SECOND) * dt));
  if (facts.meaningfulInput) lastMeaningfulInputAt = now;
  else if (now - lastMeaningfulInputAt > 2) telemetry.idleSeconds += dt;
  telemetry.durationSeconds = now;

  // Adaptation: the creature answers a pattern it has seen twice.
  const previousAdaptation = adaptation;
  adaptation = repeatCount >= 3 ? "evade" : repeatCount >= 2 ? "armor-through" : "none";
  if (adaptation !== previousAdaptation && adaptation !== "none") {
    notices.push({
      kind: "adaptation",
      text: adaptation === "evade" ? "It has your rhythm" : "It is bracing for the chain",
    });
  }

  // Openings and immunity.
  let openingSeconds = Math.max(0, state.openingSeconds - dt);
  let staggerImmunitySeconds = Math.max(0, state.staggerImmunitySeconds - dt);
  if (facts.creatureReeling && state.openingSeconds <= 0 && staggerImmunitySeconds <= 0) {
    telemetry.bossOpenings += 1;
    openingSeconds = facts.creatureReaction === "knockdown" ? 1.6 : 0.7;
    staggerImmunitySeconds = STAGGER_IMMUNITY_SECONDS;
    notices.push({ kind: "opening", text: "Opening" });
  }

  const level = flowLevel(flow);
  if (level > previousLevel)
    notices.push({
      kind: "flow-level",
      level,
      text: `Drift ${["", "aligned", "deep", "synchronised"][level]}`,
    });
  if (ultimate >= 0.999 && !previousUltimateReady)
    notices.push({ kind: "ultimate-ready", text: "Synchronized Breaker ready" });

  return {
    state: {
      regions,
      flow,
      ultimate,
      recentChain,
      chainHistory,
      repeatCount,
      adaptation,
      staggerImmunitySeconds,
      openingSeconds,
      lastHitLandedAt,
      lastHitTakenAt,
      lastMeaningfulInputAt,
      lastFamily,
      secondsElapsed: now,
      telemetry,
    },
    notices,
    bonusDamage,
    extraPoise,
  };
}

export function regionName(region: TitanRegion): string {
  switch (region) {
    case "head":
      return "Head blade";
    case "arm.L":
      return "Left claw";
    case "arm.R":
      return "Right claw";
    case "torso":
      return "Torso";
    case "leg.L":
      return "Left leg";
    case "leg.R":
      return "Right leg";
    case "tail":
      return "Tail";
  }
}

export function brokenRegions(state: TitanBreakState): TitanRegion[] {
  return TITAN_REGIONS.filter((id) => state.regions[id].broken);
}

/** Share of damage by source, 0 to 1 each. */
export function damageShares(telemetry: TitanTelemetry): Record<DamageSource, number> {
  const total = Object.values(telemetry.damageBySource).reduce((sum, value) => sum + value, 0);
  const shares = {} as Record<DamageSource, number>;
  for (const [source, value] of Object.entries(telemetry.damageBySource) as [DamageSource, number][]) {
    shares[source] = total > 0 ? value / total : 0;
  }
  return shares;
}

/** Spends the ultimate meter; returns false when it is not full. */
export function spendUltimate(state: TitanBreakState): TitanBreakState | null {
  if (state.ultimate < 0.999) return null;
  return { ...state, ultimate: 0 };
}

export function withFlowSpent(state: TitanBreakState, amount: number): TitanBreakState {
  return { ...state, flow: Math.max(0, state.flow - amount) };
}
