import { describe, expect, it } from "vitest";
import {
  LEVEL_CAP,
  PRESTIGE_ASYMPTOTE,
  experienceForLevel,
  forecastPrestige,
  growthFor,
  levelFromExperience,
  moduleSlotsAt,
  movesUnlockedAt,
  nextUnlock,
  passiveChoicesAt,
  prestigeExperienceFactor,
  prestigeMultiplier,
  scaleLocomotion,
  totalExperienceTo,
  veterancyGrant,
} from "../../src/jaegers/progression";
import { createPassiveRegistry, passiveBonus, validatePassive } from "../../src/data/passives";
import { canFit, createModuleRegistry, moduleBonus, validateModule } from "../../src/data/modules";
import {
  createMasteryRegistry,
  emptyMasteryCounters,
  masteryProgress,
  masteryRank,
  validateMastery,
} from "../../src/data/masteries";
import { jaegerRegistry } from "../../src/data/jaegers";

const passives = createPassiveRegistry();
const modules = createModuleRegistry();
const masteries = createMasteryRegistry();

/** The ranks the design has to be answerable at, including one absurd one. */
const RANKS = [0, 1, 10, 100, 1000, 9_007_199_254_740_991];

describe("the level curve", () => {
  it("costs more at every level than the one before", () => {
    for (let level = 2; level < LEVEL_CAP; level += 1) {
      expect(experienceForLevel(level)).toBeGreaterThan(experienceForLevel(level - 1));
    }
  });

  it("stops at the cap and asks for nothing beyond it", () => {
    expect(experienceForLevel(LEVEL_CAP)).toBe(0);
    expect(experienceForLevel(LEVEL_CAP + 5)).toBe(0);
  });

  it("derives the level from the running total rather than storing both", () => {
    for (let level = 1; level <= LEVEL_CAP; level += 1) {
      const exact = totalExperienceTo(level);
      expect(levelFromExperience(exact).level).toBe(level);
      if (level < LEVEL_CAP) {
        expect(levelFromExperience(exact - 1).level).toBe(level - 1 || 1);
      }
    }
  });

  it("reports how far into a level a machine is", () => {
    const state = levelFromExperience(experienceForLevel(1) + 100);
    expect(state.level).toBe(2);
    expect(state.into).toBe(100);
    expect(state.needed).toBe(experienceForLevel(2));
    expect(state.atCap).toBe(false);
  });

  it("says so at the cap", () => {
    const state = levelFromExperience(totalExperienceTo(LEVEL_CAP) + 999_999);
    expect(state.level).toBe(LEVEL_CAP);
    expect(state.atCap).toBe(true);
    expect(state.needed).toBe(0);
  });

  it("is reachable in a campaign's worth of sorties, not a lifetime's", () => {
    // The guard against the defect this table shipped with first time round: a
    // curve calibrated to nothing needed two thousand sorties to reach the cap.
    // A clean sortie pays roughly a thousand, so the whole climb is checked
    // against that rather than against how the numbers look.
    const CLEAN_SORTIE = 900;
    const climb = totalExperienceTo(LEVEL_CAP);
    expect(climb / CLEAN_SORTIE).toBeGreaterThan(20);
    expect(climb / CLEAN_SORTIE).toBeLessThan(80);
    // The first level lands inside one sortie, and the last one costs a few.
    expect(experienceForLevel(1)).toBeLessThan(CLEAN_SORTIE);
    expect(experienceForLevel(LEVEL_CAP - 1)).toBeLessThan(CLEAN_SORTIE * 6);
    // And a tenth climb is longer but still a campaign rather than a career.
    expect(totalExperienceTo(LEVEL_CAP, 10) / CLEAN_SORTIE).toBeLessThan(200);
  });

  it("takes longer after every prestige, but never an impossible amount", () => {
    expect(experienceForLevel(5, 1)).toBeGreaterThan(experienceForLevel(5, 0));
    expect(experienceForLevel(5, 10)).toBeGreaterThan(experienceForLevel(5, 1));
    // Bounded, so rank 1000 is not asking for a number nobody can reach.
    expect(prestigeExperienceFactor(1_000)).toBe(prestigeExperienceFactor(1_000_000));
    expect(experienceForLevel(5, 1_000)).toBeLessThan(experienceForLevel(5, 0) * 5);
  });
});

describe("the prestige multiplier", () => {
  it("is one at rank zero", () => {
    expect(prestigeMultiplier(0)).toBe(1);
    expect(prestigeMultiplier(-4)).toBe(1);
  });

  it("rises at every rank and never reaches its ceiling", () => {
    let previous = 1;
    for (const rank of RANKS) {
      const value = prestigeMultiplier(rank);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThan(1 + PRESTIGE_ASYMPTOTE);
      expect(Number.isFinite(value)).toBe(true);
      previous = value;
    }
  });

  it("is worth much less every time, which is what makes it safe to uncap", () => {
    const gain = (rank: number) => prestigeMultiplier(rank + 1) / prestigeMultiplier(rank) - 1;
    expect(gain(0)).toBeGreaterThan(gain(1));
    expect(gain(1)).toBeGreaterThan(gain(10));
    expect(gain(10)).toBeGreaterThan(gain(100));
    expect(gain(100)).toBeGreaterThan(gain(1_000));
    // At the top of the ladder one more rank is worth essentially nothing.
    expect(gain(1_000)).toBeLessThan(0.0002);
  });

  it("answers for a very large integer without overflowing or returning NaN", () => {
    const huge = prestigeMultiplier(Number.MAX_SAFE_INTEGER);
    expect(Number.isFinite(huge)).toBe(true);
    expect(huge).toBeLessThan(1 + PRESTIGE_ASYMPTOTE);
    expect(huge).toBeGreaterThan(1 + PRESTIGE_ASYMPTOTE - 0.001);
    // Even infinity has to land in the band rather than break the arithmetic.
    expect(prestigeMultiplier(Number.POSITIVE_INFINITY)).toBe(1);
    expect(Number.isNaN(prestigeMultiplier(Number.NaN))).toBe(false);
  });

  it("keeps rank 1000 and rank a quadrillion within a hair of each other", () => {
    const thousand = prestigeMultiplier(1_000);
    const absurd = prestigeMultiplier(1e15);
    expect(absurd - thousand).toBeLessThan(0.02);
  });
});

describe("growth", () => {
  it("is exactly the base machine at level one with no rank", () => {
    const growth = growthFor({ level: 1, prestige: 0 });
    expect(growth.structure).toBe(1);
    expect(growth.damage).toBe(1);
    expect(growth.heat).toBe(1);
    expect(growth.mobility).toBe(1);
    expect(growth.moduleSlots).toBe(0);
  });

  it("rises with level on every axis", () => {
    const early = growthFor({ level: 1, prestige: 0 });
    const late = growthFor({ level: LEVEL_CAP, prestige: 0 });
    expect(late.structure).toBeGreaterThan(early.structure);
    expect(late.damage).toBeGreaterThan(early.damage);
    expect(late.heat).toBeGreaterThan(early.heat);
    expect(late.mobility).toBeGreaterThan(early.mobility);
  });

  it("keeps mobility outside the prestige multiplier, so nothing outruns the game", () => {
    const fresh = growthFor({ level: LEVEL_CAP, prestige: 0 });
    const veteran = growthFor({ level: LEVEL_CAP, prestige: 1_000 });
    expect(veteran.mobility).toBeCloseTo(fresh.mobility, 10);
    expect(veteran.structure).toBeGreaterThan(fresh.structure);
  });

  it("stays inside a knowable ceiling at every rank, including absurd ones", () => {
    for (const rank of RANKS) {
      const growth = growthFor({ level: LEVEL_CAP, prestige: rank });
      // Level growth times the prestige asymptote is the whole envelope.
      const ceiling = (1 + 0.016 * (LEVEL_CAP - 1)) * (1 + PRESTIGE_ASYMPTOTE);
      expect(growth.structure).toBeLessThanOrEqual(ceiling);
      expect(Number.isFinite(growth.damage)).toBe(true);
      expect(growth.mobility).toBeLessThan(1.2);
    }
  });

  it("never lets a maximum machine reach three times its base", () => {
    const best = growthFor({
      level: LEVEL_CAP,
      prestige: 1e12,
      passiveBonus: passiveBonus(passives, ["passive.veteran-hull"]),
      moduleBonus: moduleBonus(modules, ["module.long-service-loom"]),
    });
    expect(best.structure).toBeLessThan(3);
    expect(best.damage).toBeLessThan(3);
  });

  it("composes passives and modules with level growth", () => {
    const plain = growthFor({ level: 10, prestige: 0 });
    const kitted = growthFor({
      level: 10,
      prestige: 0,
      passiveBonus: passiveBonus(passives, ["passive.reinforced-frame"]),
      moduleBonus: moduleBonus(modules, ["module.spine-brace"]),
    });
    expect(kitted.structure).toBeGreaterThan(plain.structure);
    // And the tradeoff comes with it: both of those cost mobility.
    expect(kitted.mobility).toBeLessThan(plain.mobility);
  });
});

describe("what levels open", () => {
  it("gives nothing at level one and something by the cap", () => {
    expect(movesUnlockedAt(1)).toHaveLength(0);
    expect(movesUnlockedAt(LEVEL_CAP).length).toBeGreaterThan(5);
  });

  it("only ever adds, never takes a move away", () => {
    for (let level = 2; level <= LEVEL_CAP; level += 1) {
      const before = movesUnlockedAt(level - 1);
      const after = movesUnlockedAt(level);
      for (const move of before) expect(after).toContain(move);
    }
  });

  it("names moves that actually exist in the move table", async () => {
    const { createMoveRegistry } = await import("../../src/data/moves");
    const moves = createMoveRegistry();
    for (const id of movesUnlockedAt(LEVEL_CAP)) {
      expect(moves.get(id), id).toBeDefined();
    }
  });

  it("opens four passive choices and six module slots over a full climb and one rank", () => {
    expect(passiveChoicesAt(LEVEL_CAP)).toBe(4);
    expect(passiveChoicesAt(1)).toBe(0);
    expect(moduleSlotsAt(LEVEL_CAP, 0)).toBe(4);
    expect(moduleSlotsAt(LEVEL_CAP, 1)).toBe(5);
    expect(moduleSlotsAt(LEVEL_CAP, 10)).toBe(6);
    // And no more than that, however far the ladder is climbed.
    expect(moduleSlotsAt(LEVEL_CAP, 1_000_000)).toBe(6);
  });

  it("says what the next level gives before it arrives", () => {
    const next = nextUnlock(1);
    expect(next).not.toBeNull();
    expect(next!.level).toBeGreaterThan(1);
    expect(nextUnlock(LEVEL_CAP)).toBeNull();
  });
});

describe("the prestige forecast", () => {
  it("refuses below the cap, and says how far off it is", () => {
    const forecast = forecastPrestige({ level: 12, prestige: 0 });
    expect(forecast.eligible).toBe(false);
    expect(forecast.refusal).toMatch(/level 12 of 30/);
    // And the summary does not read like an offer that can be taken.
    expect(forecast.summary).toMatch(/Not at the cap yet/);
    expect(forecast.summary).toMatch(/At the cap/);
  });

  it("shows both sides of the trade at the cap", () => {
    const forecast = forecastPrestige({ level: LEVEL_CAP, prestige: 0 });
    expect(forecast.eligible).toBe(true);
    expect(forecast.levelsLost).toBe(LEVEL_CAP - 1);
    expect(forecast.before.structure).toBeGreaterThan(forecast.after.structure);
    expect(forecast.netGain).toBeGreaterThan(0);
    expect(forecast.summary).toContain("back to 1");
  });

  it("matches what prestiging actually produces, because it is the same function", () => {
    for (const rank of [0, 1, 10, 100]) {
      const forecast = forecastPrestige({ level: LEVEL_CAP, prestige: rank });
      const actual = growthFor({ level: 1, prestige: rank + 1 });
      expect(forecast.after).toEqual(actual);
    }
  });

  it("is blunt when a rank is no longer worth taking", () => {
    const high = forecastPrestige({ level: LEVEL_CAP, prestige: 1_000 });
    expect(high.summary).toMatch(/almost nothing/);
    expect(high.netGain).toBeLessThan(0.001);
  });

  it("stays honest at a very large rank", () => {
    const forecast = forecastPrestige({ level: LEVEL_CAP, prestige: 1e15 });
    expect(Number.isFinite(forecast.netGain)).toBe(true);
    expect(forecast.netGain).toBeGreaterThanOrEqual(0);
    expect(forecast.toRank).toBeGreaterThan(1e15 - 1);
  });
});

describe("catch-up for a new machine", () => {
  it("gives nothing when the fleet has never prestiged", () => {
    expect(veterancyGrant(0)).toEqual({ level: 1, prestige: 0, note: "" });
  });

  it("closes most of the gap without handing over the climb", () => {
    for (const best of [2, 10, 100, 1_000]) {
      const grant = veterancyGrant(best);
      expect(grant.prestige).toBeLessThan(best);
      const gap = prestigeMultiplier(best) - prestigeMultiplier(grant.prestige);
      // Because the curve is asymptotic, half a rank is nearly all of its
      // value: whatever the fleet's best has climbed to, the new machine lands
      // within a few percent of it rather than a generation behind.
      expect(gap).toBeLessThan(0.12);
      expect(grant.note.length).toBeGreaterThan(10);
    }
  });

  it("never grants past the level cap", () => {
    expect(veterancyGrant(10_000).level).toBe(LEVEL_CAP);
  });
});

describe("mobility scaling", () => {
  const profile = jaegerRegistry.getOrThrow("heavy-mk4").locomotion;

  it("returns the same object when there is nothing to apply", () => {
    expect(scaleLocomotion(profile, 1)).toBe(profile);
  });

  it("moves the rates and leaves the machine's physical shape alone", () => {
    const faster = scaleLocomotion(profile, 1.1);
    expect(faster.runSpeedMps).toBeCloseTo(profile.runSpeedMps * 1.1, 6);
    expect(faster.turnRateDegPerSecond).toBeCloseTo(profile.turnRateDegPerSecond * 1.1, 6);
    expect(faster.heightMeters).toBe(profile.heightMeters);
    expect(faster.strideMeters).toBe(profile.strideMeters);
    expect(faster.maxSlopeDeg).toBe(profile.maxSlopeDeg);
    expect(faster.stepUpMeters).toBe(profile.stepUpMeters);
  });
});

describe("passives", () => {
  it("all validate", () => {
    for (const entry of passives.all()) expect(validatePassive(entry), entry.id).toEqual([]);
  });

  it("refuse a free upgrade below the top tier", () => {
    const base = passives.getOrThrow("passive.reinforced-frame");
    const errors = validatePassive({ ...base, mobility: 1.2 });
    expect(errors.join(" ")).toMatch(/must give something up/);
  });

  it("refuse one that changes nothing", () => {
    const base = passives.getOrThrow("passive.reinforced-frame");
    const errors = validatePassive({
      ...base,
      structure: undefined,
      damage: undefined,
      heat: undefined,
      mobility: undefined,
    });
    expect(errors.join(" ")).toMatch(/not a choice/);
  });

  it("offer a real decision at every tier", () => {
    for (const tier of [1, 2, 3, 4] as const) {
      const options = passives.all().filter((entry) => entry.tier === tier);
      expect(options.length, `tier ${tier}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("multiply together when several are taken", () => {
    const bonus = passiveBonus(passives, ["passive.reinforced-frame", "passive.ablative-plating"]);
    expect(bonus.structure).toBeCloseTo(1.1 * 1.14, 6);
    expect(bonus.mobility).toBeCloseTo(0.96 * 0.94, 6);
  });

  it("ignore a passive this build has never heard of", () => {
    expect(passiveBonus(passives, ["passive.nonsense"])).toEqual({
      structure: 1,
      damage: 1,
      heat: 1,
      mobility: 1,
    });
  });
});

describe("modules", () => {
  it("all validate", () => {
    for (const entry of modules.all()) expect(validateModule(entry), entry.id).toEqual([]);
  });

  it("refuse a downside-free module that anybody could buy", () => {
    const base = modules.getOrThrow("module.spine-brace");
    const errors = validateModule({ ...base, mobility: 1.1 });
    expect(errors.join(" ")).toMatch(/must require prestige/);
  });

  it("refuse one that fits itself for free", () => {
    const base = modules.getOrThrow("module.spine-brace");
    expect(validateModule({ ...base, fittingHours: 0 }).join(" ")).toMatch(/cannot be free/);
    expect(validateModule({ ...base, cost: 0 }).join(" ")).toMatch(/has to cost something/);
  });

  it("gate on level and on rank, in words", () => {
    const late = modules.getOrThrow("module.composite-shell");
    expect(canFit(late, 5, 0).ok).toBe(false);
    expect(canFit(late, 5, 0).message).toMatch(/Needs level 22/);
    expect(canFit(late, 22, 0).ok).toBe(true);

    const veteran = modules.getOrThrow("module.long-service-loom");
    expect(canFit(veteran, 30, 3).ok).toBe(false);
    expect(canFit(veteran, 30, 3).message).toMatch(/Needs prestige 10/);
    expect(canFit(veteran, 1, 10).ok).toBe(true);
  });
});

describe("mastery goals", () => {
  it("all validate", () => {
    for (const entry of masteries.all()) expect(validateMastery(entry), entry.id).toEqual([]);
  });

  it("refuse thresholds that do not ascend", () => {
    const base = masteries.getOrThrow("mastery.service");
    expect(validateMastery({ ...base, thresholds: [10, 5] }).join(" ")).toMatch(/must ascend/);
  });

  it("rank up as the counters climb", () => {
    const goal = masteries.getOrThrow("mastery.service");
    const counters = emptyMasteryCounters();
    expect(masteryRank(goal, counters)).toBe(0);
    counters.sorties = 5;
    expect(masteryRank(goal, counters)).toBe(1);
    counters.sorties = 1_000;
    expect(masteryRank(goal, counters)).toBe(goal.thresholds.length);
  });

  it("report progress toward the next rank, and stop at the last", () => {
    const counters = emptyMasteryCounters();
    counters.sorties = 5;
    const progress = masteryProgress(masteries, counters).find((entry) => entry.id === "mastery.service")!;
    expect(progress.rank).toBe(1);
    expect(progress.nextThreshold).toBe(20);
    // Exactly on a threshold is zero progress into the next one, not full.
    expect(progress.progress).toBe(0);

    counters.sorties = 12;
    const partway = masteryProgress(masteries, counters).find((entry) => entry.id === "mastery.service")!;
    expect(partway.progress).toBeGreaterThan(0);
    expect(partway.progress).toBeLessThan(1);

    counters.sorties = 100_000;
    const done = masteryProgress(masteries, counters).find((entry) => entry.id === "mastery.service")!;
    expect(done.nextThreshold).toBeNull();
    expect(done.progress).toBe(1);
  });
});
