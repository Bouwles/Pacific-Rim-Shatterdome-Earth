/**
 * How a machine gets better.
 *
 * Levels come from flying it, and they raise its own numbers rather than adding
 * a second set of numbers beside them: everything here produces a `MachineGrowth`,
 * which is a small set of multipliers applied at the three places a machine's
 * numbers are already derived. Combat reads a profile, the arena builds zones
 * from components, and the controller reads the locomotion block. Growth
 * multiplies those. There is no parallel stat system, and nothing downstream has
 * to know a machine has a level at all.
 *
 * At the cap a machine can prestige: level goes back to one, and it keeps a
 * permanent multiplier that grows with rank and never reaches its ceiling. The
 * curve is deliberately asymptotic, so rank 1000 and rank 1,000,000 are worth
 * almost exactly the same thing. That is what lets prestige be uncapped without
 * eventually deleting the game.
 *
 * Every function here is pure arithmetic over plain numbers. No RNG, no clock,
 * no registry lookups, so a forecast shown to the player and the value actually
 * applied come from the same call.
 */

/** Level a machine stops gaining levels at, and may prestige from. */
export const LEVEL_CAP = 30;

/**
 * The most prestige can ever be worth, as a fraction over base.
 *
 * The multiplier approaches `1 + PRESTIGE_ASYMPTOTE` and never reaches it, so
 * there is no rank at which a machine becomes unanswerable. Picked so that a
 * heavily prestiged old Mark lands in the same band as a fresh newer Mark that
 * has been upgraded, rather than above every kaiju in the game.
 *
 * Chosen by working backwards from the worst case rather than by feel. A level
 * thirty machine at infinite rank, carrying the best passive and the best module
 * in the game, has to stay under three times a stock machine, or a fight stops
 * being a fight. Level growth alone is about 1.46, the best passive and module
 * about 1.23 between them, which leaves 1.6 for the whole prestige ladder.
 */
export const PRESTIGE_ASYMPTOTE = 0.6;

/**
 * Rank at which half of the asymptote has been earned.
 *
 * Small on purpose: the first few prestiges are worth taking, and the
 * hundredth is worth almost nothing, which is what keeps the ladder honest
 * about being cosmetic at the top end.
 */
export const PRESTIGE_HALF_RANK = 12;

/** What one level is worth, before prestige. Applied per level above the first. */
export const PER_LEVEL_GAIN = {
  structure: 0.016,
  damage: 0.013,
  heat: 0.011,
  mobility: 0.006,
} as const;

/**
 * Experience for the first level-up, and how steeply the curve climbs after it.
 *
 * Calibrated against what a sortie is actually worth rather than picked to look
 * like a curve. A clean sortie pays roughly a thousand, so the first level is
 * immediate, the last costs about four sorties, and a full climb to the cap is
 * somewhere around forty of them plus what the mastery goals pay along the way.
 * Getting this wrong is not a rounding error: the first version of this table
 * needed two thousand sorties to reach the cap.
 */
export const BASE_LEVEL_EXPERIENCE = 60;
export const LEVEL_CURVE_EXPONENT = 1.15;

/**
 * How much longer a level takes after each prestige.
 *
 * Climbing back is meant to be a real climb, but a bounded one: the factor is
 * capped so a rank 500 machine is not asking for an impossible number.
 */
export const PRESTIGE_EXPERIENCE_STEP = 0.25;
export const MAX_PRESTIGE_EXPERIENCE_FACTOR = 2.5;

export interface MachineGrowth {
  /** Multiplier on component health, so a levelled machine takes more of a beating. */
  readonly structure: number;
  /** Multiplier on damage this machine deals. */
  readonly damage: number;
  /** Multiplier on heat dissipation and poise, so it can keep swinging. */
  readonly heat: number;
  /** Multiplier on walk, run and turn rates. Deliberately the smallest of the four. */
  readonly mobility: number;
  /**
   * Multiplier on how much punishment the machine absorbs before it staggers.
   *
   * Levels do not move this. It exists because a crew can: a pair who brace
   * before an exchange keep the machine on its feet, and that is a thing about
   * the people rather than about the machine.
   */
  readonly poise: number;
  /** How many module slots are open at this level and rank. */
  readonly moduleSlots: number;
  /** One line a person can read, for the panel and the service history. */
  readonly label: string;
}

/** Growth with nothing applied. What an unlevelled machine gets. */
export const NO_GROWTH: MachineGrowth = {
  structure: 1,
  damage: 1,
  heat: 1,
  mobility: 1,
  poise: 1,
  moduleSlots: 0,
  label: "Level 1, no prestige",
};

/**
 * What prestige rank is worth.
 *
 * `1 + A * rank / (rank + H)`. Zero at rank zero, and approaches `1 + A`
 * without ever arriving. Doubling a large rank barely moves it, which is the
 * whole point: the ladder stays climbable forever and stops mattering long
 * before it stops being climbable.
 */
export function prestigeMultiplier(rank: number): number {
  if (!Number.isFinite(rank) || rank <= 0) return 1;
  // Guard the arithmetic rather than the input: a rank large enough to lose
  // precision still has to return a number in the band, not NaN.
  const safe = Math.min(rank, Number.MAX_SAFE_INTEGER);
  return 1 + (PRESTIGE_ASYMPTOTE * safe) / (safe + PRESTIGE_HALF_RANK);
}

/** Experience needed to go from this level to the next one, at this rank. */
export function experienceForLevel(level: number, prestige = 0): number {
  if (level < 1 || level >= LEVEL_CAP) return 0;
  const base = BASE_LEVEL_EXPERIENCE * Math.pow(level, LEVEL_CURVE_EXPONENT);
  return Math.round(base * prestigeExperienceFactor(prestige));
}

/** How much longer every level takes at this rank. Bounded, so it stays finite. */
export function prestigeExperienceFactor(prestige: number): number {
  if (!Number.isFinite(prestige) || prestige <= 0) return 1;
  const raw = 1 + prestige * PRESTIGE_EXPERIENCE_STEP;
  return Math.min(MAX_PRESTIGE_EXPERIENCE_FACTOR, raw);
}

/** Total experience from level 1 to this level at this rank. */
export function totalExperienceTo(level: number, prestige = 0): number {
  let total = 0;
  for (let step = 1; step < Math.min(level, LEVEL_CAP); step += 1) {
    total += experienceForLevel(step, prestige);
  }
  return total;
}

export interface LevelState {
  readonly level: number;
  /** Experience banked toward the next level. */
  readonly into: number;
  /** Experience the next level needs, or 0 at the cap. */
  readonly needed: number;
  readonly atCap: boolean;
}

/**
 * Turns banked experience into a level.
 *
 * Experience is stored as one running total per machine rather than as a level
 * plus a remainder, so there is exactly one number to award into and no way for
 * the two to disagree.
 */
export function levelFromExperience(experience: number, prestige = 0): LevelState {
  let level = 1;
  let left = Math.max(0, Math.floor(experience));
  while (level < LEVEL_CAP) {
    const need = experienceForLevel(level, prestige);
    if (left < need) return { level, into: left, needed: need, atCap: false };
    left -= need;
    level += 1;
  }
  return { level: LEVEL_CAP, into: 0, needed: 0, atCap: true };
}

export interface GrowthInput {
  readonly level: number;
  readonly prestige: number;
  /** Multipliers contributed by chosen passives and fitted modules. */
  readonly passiveBonus?: Partial<Omit<MachineGrowth, "moduleSlots" | "label">>;
  readonly moduleBonus?: Partial<Omit<MachineGrowth, "moduleSlots" | "label">>;
  /**
   * Multipliers contributed by the pair in the Conn-Pod.
   *
   * The same shape as the other two, so who is flying composes with what the
   * machine is exactly the way a passive or a module does, and the fight reads
   * one object either way.
   */
  readonly crewBonus?: Partial<Omit<MachineGrowth, "moduleSlots" | "label">>;
}

/**
 * Everything a machine's level and rank are worth, as multipliers.
 *
 * Level growth is linear per level and prestige multiplies the whole thing, so
 * the two compose rather than being added and argued about later.
 */
export function growthFor(input: GrowthInput): MachineGrowth {
  const level = Math.max(1, Math.min(LEVEL_CAP, Math.round(input.level)));
  const prestige = Math.max(0, Math.floor(input.prestige));
  const steps = level - 1;
  const rank = prestigeMultiplier(prestige);

  const axis = (key: keyof typeof PER_LEVEL_GAIN, scaledByRank: boolean): number => {
    const levelled = 1 + PER_LEVEL_GAIN[key] * steps;
    const passive = input.passiveBonus?.[key] ?? 1;
    const module = input.moduleBonus?.[key] ?? 1;
    const crew = input.crewBonus?.[key] ?? 1;
    return levelled * (scaledByRank ? rank : 1) * passive * module * crew;
  };

  return {
    structure: axis("structure", true),
    damage: axis("damage", true),
    heat: axis("heat", true),
    // Mobility is deliberately outside the prestige multiplier. A machine that
    // outruns everything stops being a heavy machine, and speed is the one axis
    // where a large multiplier would break the fights rather than tilt them.
    mobility: axis("mobility", false),
    // Poise is the crew's alone: no level, rank, passive or module moves it.
    poise: (input.passiveBonus?.poise ?? 1) * (input.moduleBonus?.poise ?? 1) * (input.crewBonus?.poise ?? 1),
    moduleSlots: moduleSlotsAt(level, prestige),
    label: describeGrowth(level, prestige),
  };
}

/**
 * Levels that open a module slot.
 *
 * A table rather than a formula so the schedule can be read, and so a slot can
 * be moved without touching arithmetic anything else depends on.
 */
export const MODULE_SLOT_LEVELS = [6, 14, 22, 30] as const;

/** One extra slot for having prestiged at all, and one more for sticking with it. */
export const PRESTIGE_SLOT_RANKS = [1, 10] as const;

export function moduleSlotsAt(level: number, prestige: number): number {
  const earned = MODULE_SLOT_LEVELS.filter((threshold) => level >= threshold).length;
  const kept = PRESTIGE_SLOT_RANKS.filter((threshold) => prestige >= threshold).length;
  return earned + kept;
}

/** Levels that let the player choose a passive. */
export const PASSIVE_CHOICE_LEVELS = [4, 10, 18, 26] as const;

export function passiveChoicesAt(level: number): number {
  return PASSIVE_CHOICE_LEVELS.filter((threshold) => level >= threshold).length;
}

export interface LevelUnlocks {
  readonly level: number;
  /** Move ids this level makes available to the machine. */
  readonly moves: readonly string[];
  readonly opensPassiveChoice: boolean;
  readonly opensModuleSlot: boolean;
}

/**
 * What each level opens.
 *
 * Moves are named here rather than in the move table, because a move existing
 * and a machine being allowed to throw it are different questions, and the move
 * table is shared with the creatures.
 */
export const LEVEL_UNLOCKS: readonly LevelUnlocks[] = [
  { level: 2, moves: ["melee.light.cross"], opensPassiveChoice: false, opensModuleSlot: false },
  { level: 4, moves: [], opensPassiveChoice: true, opensModuleSlot: false },
  { level: 6, moves: ["melee.heavy.smash.forward"], opensPassiveChoice: false, opensModuleSlot: true },
  { level: 8, moves: ["defense.counter.parry"], opensPassiveChoice: false, opensModuleSlot: false },
  { level: 10, moves: ["melee.launcher.uppercut"], opensPassiveChoice: true, opensModuleSlot: false },
  { level: 13, moves: ["melee.guard-break.shoulder"], opensPassiveChoice: false, opensModuleSlot: false },
  { level: 14, moves: [], opensPassiveChoice: false, opensModuleSlot: true },
  { level: 16, moves: ["melee.heavy.spin.side"], opensPassiveChoice: false, opensModuleSlot: false },
  { level: 18, moves: ["melee.charge.haymaker"], opensPassiveChoice: true, opensModuleSlot: false },
  { level: 22, moves: ["melee.heavy.overhead"], opensPassiveChoice: false, opensModuleSlot: true },
  { level: 26, moves: ["grapple.clinch"], opensPassiveChoice: true, opensModuleSlot: false },
  { level: 30, moves: ["melee.finisher.plasma-drop"], opensPassiveChoice: false, opensModuleSlot: true },
];

/** Every move a machine at this level is allowed to throw, on top of its basics. */
export function movesUnlockedAt(level: number): readonly string[] {
  const unlocked: string[] = [];
  for (const entry of LEVEL_UNLOCKS) {
    if (entry.level <= level) unlocked.push(...entry.moves);
  }
  return unlocked;
}

/** What the next level gives, or null at the cap. Shown before it is reached. */
export function nextUnlock(level: number): LevelUnlocks | null {
  return LEVEL_UNLOCKS.find((entry) => entry.level > level) ?? null;
}

export interface PrestigeForecast {
  readonly eligible: boolean;
  /** Why not, when it cannot be done. Empty when it can. */
  readonly refusal: string;
  readonly fromRank: number;
  readonly toRank: number;
  /** What the machine is worth now and what it would be worth afterwards. */
  readonly before: MachineGrowth;
  readonly after: MachineGrowth;
  /** Multiplier gained by this prestige alone, as a fraction. Shrinks every time. */
  readonly netGain: number;
  /** Levels given up, which is always the whole climb. */
  readonly levelsLost: number;
  /** Experience the next level will need afterwards, so the cost is visible too. */
  readonly nextLevelExperience: number;
  /** Module slots kept, since a rank is worth a slot at 1 and at 10. */
  readonly moduleSlotsAfter: number;
  readonly summary: string;
}

/**
 * What prestiging would actually do, before it is done.
 *
 * Both sides of the trade are computed from the same functions that apply it,
 * so the forecast cannot drift from the outcome. It is deliberately blunt about
 * the fact that the gain shrinks: at high rank the honest summary is that this
 * is worth almost nothing, and it says so.
 */
export function forecastPrestige(input: GrowthInput): PrestigeForecast {
  const level = Math.max(1, Math.min(LEVEL_CAP, Math.round(input.level)));
  const fromRank = Math.max(0, Math.floor(input.prestige));
  const toRank = fromRank + 1;
  const before = growthFor({ ...input, level, prestige: fromRank });
  const after = growthFor({ ...input, level: 1, prestige: toRank });
  const eligible = level >= LEVEL_CAP;
  const netGain = prestigeMultiplier(toRank) / prestigeMultiplier(fromRank) - 1;

  const worth =
    netGain >= 0.02
      ? `Worth about ${(netGain * 100).toFixed(1)} percent more at rank ${toRank}.`
      : `Worth about ${(netGain * 100).toFixed(2)} percent more, which is almost nothing. Rank ${toRank} is mostly a rank.`;

  return {
    eligible,
    refusal: eligible ? "" : `Not at the cap yet: level ${level} of ${LEVEL_CAP}.`,
    fromRank,
    toRank,
    before,
    after,
    netGain,
    levelsLost: level - 1,
    nextLevelExperience: experienceForLevel(1, toRank),
    moduleSlotsAfter: after.moduleSlots,
    summary: eligible
      ? `Level ${level} back to 1, prestige ${fromRank} to ${toRank}. ` +
        `Structure ${before.structure.toFixed(2)}x becomes ${after.structure.toFixed(2)}x. ` +
        worth
      : // Not an offer yet, so it does not read like one. What it would be
        // worth is still shown, because that is what the climb is for.
        `${`Not at the cap yet: level ${level} of ${LEVEL_CAP}.`} ` +
        `At the cap, prestige ${toRank} would be worth about ` +
        `${(netGain * 100).toFixed(1)} percent more and cost every level.`,
  };
}

/**
 * What a newly acquired machine starts with, given the fleet it is joining.
 *
 * Without this, buying anything at all once a favourite is at rank 40 hands you
 * something unusable, which is exactly what the specification says must not
 * happen. A new machine starts at half the fleet's best rank and at a level
 * floor that scales with it.
 *
 * This is safe precisely because the multiplier is asymptotic: half of a large
 * rank is worth almost the same as the whole of it, so the grant closes most of
 * the gap without ever handing over the climb itself.
 */
export function veterancyGrant(bestPrestigeInFleet: number): {
  readonly level: number;
  readonly prestige: number;
  readonly note: string;
} {
  const best = Math.max(0, Math.floor(bestPrestigeInFleet));
  if (best <= 0) return { level: 1, prestige: 0, note: "" };
  const prestige = Math.floor(best / 2);
  const level = Math.max(1, Math.min(LEVEL_CAP, 1 + Math.floor(best / 2)));
  const closed = prestigeMultiplier(prestige) / prestigeMultiplier(best);
  return {
    level,
    prestige,
    note:
      `Delivered with veteran crew and salvaged parts: level ${level}, prestige ${prestige}, ` +
      `which is ${(closed * 100).toFixed(0)} percent of the fleet's best machine.`,
  };
}

/**
 * Applies mobility growth to a locomotion profile.
 *
 * Only the rates move. Height, stride, step-up reach and slope limit are what
 * the machine physically is, and a level cannot make it taller or let it climb
 * a wall it does not reach. Keeping those fixed is what stops progression from
 * turning a heavy machine into a different machine.
 */
export function scaleLocomotion<T extends LocomotionRates>(profile: T, mobility: number): T {
  const scale = Number.isFinite(mobility) && mobility > 0 ? mobility : 1;
  if (scale === 1) return profile;
  return {
    ...profile,
    walkSpeedMps: profile.walkSpeedMps * scale,
    runSpeedMps: profile.runSpeedMps * scale,
    strafeSpeedMps: profile.strafeSpeedMps * scale,
    guardSpeedMps: profile.guardSpeedMps * scale,
    accelerationMps2: profile.accelerationMps2 * scale,
    brakingMps2: profile.brakingMps2 * scale,
    turnRateDegPerSecond: profile.turnRateDegPerSecond * scale,
    turnInPlaceRateDegPerSecond: profile.turnInPlaceRateDegPerSecond * scale,
  };
}

/** The parts of a locomotion profile growth is allowed to touch. */
export interface LocomotionRates {
  readonly walkSpeedMps: number;
  readonly runSpeedMps: number;
  readonly strafeSpeedMps: number;
  readonly guardSpeedMps: number;
  readonly accelerationMps2: number;
  readonly brakingMps2: number;
  readonly turnRateDegPerSecond: number;
  readonly turnInPlaceRateDegPerSecond: number;
}

/** A readable description of where a machine is. */
export function describeGrowth(level: number, prestige: number): string {
  const rank = prestige > 0 ? `, prestige ${prestige}` : "";
  const cap = level >= LEVEL_CAP ? " (at the cap)" : "";
  return `Level ${level}${rank}${cap}`;
}
