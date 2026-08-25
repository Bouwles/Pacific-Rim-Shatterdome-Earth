import { describe, expect, it } from "vitest";
import {
  COMPATIBILITY_TAGS,
  DRIFT_REFUSAL_THRESHOLD,
  MAX_LINK_BONUS,
  PERK_EFFECTS,
  PILOT_DEFINITIONS,
  assessDrift,
  createPilotRegistry,
  currentPerkRank,
  perkEffects,
  validatePilot,
} from "../../src/data/pilots";
import {
  INJURY_RESTRICTIONS,
  INJURY_SEVERITIES,
  createInjuryRegistry,
  injuryPoolFor,
  treatedRecoveryDays,
  validateInjury,
} from "../../src/data/injuries";
import { CHASSIS_ROLES, jaegerRegistry } from "../../src/data/jaegers";

const pilots = createPilotRegistry();
const injuries = createInjuryRegistry();

function pilot(id: string) {
  return pilots.getOrThrow(id);
}

describe("the people", () => {
  it("all validate", () => {
    for (const entry of PILOT_DEFINITIONS) expect(validatePilot(entry), entry.id).toEqual([]);
  });

  it("each carry a drawback that costs something and is written out", () => {
    for (const entry of PILOT_DEFINITIONS) {
      expect(entry.drawback.stabilityCost + entry.drawback.effectivenessCost, entry.id).toBeGreaterThan(0);
      expect(entry.drawback.description.length, entry.id).toBeGreaterThan(20);
    }
  });

  it("refuse a pilot with no drawback at all", () => {
    const base = pilot("pilot.okonkwo");
    const errors = validatePilot({
      ...base,
      drawback: { ...base.drawback, stabilityCost: 0, effectivenessCost: 0 },
    });
    expect(errors.join(" ")).toMatch(/not a drawback/);
  });

  it("refuse a drawback so large the pilot would be unusable", () => {
    const base = pilot("pilot.okonkwo");
    expect(validatePilot({ ...base, drawback: { ...base.drawback, stabilityCost: 0.9 } }).join(" ")).toMatch(
      /unusable rather than difficult/,
    );
  });

  it("refuse a perk effect nothing in the game reads", () => {
    const base = pilot("pilot.okonkwo");
    const broken = {
      ...base,
      perk: {
        ...base.perk,
        ranks: [{ linkLevel: 2, effects: { charisma: 1.2 } as never, note: "not a real thing" }],
      },
    };
    expect(validatePilot(broken).join(" ")).toMatch(/unknown perk effect/);
  });

  it("refuse perk ranks that do not ascend", () => {
    const base = pilot("pilot.okonkwo");
    const broken = {
      ...base,
      perk: {
        ...base.perk,
        ranks: [
          { linkLevel: 4, effects: { poise: 1.1 }, note: "the later one first" },
          { linkLevel: 2, effects: { poise: 1.2 }, note: "the earlier one second" },
        ],
      },
    };
    expect(validatePilot(broken).join(" ")).toMatch(/ascending link levels/);
  });

  it("use only tags the game knows", () => {
    for (const entry of PILOT_DEFINITIONS) {
      for (const tag of entry.tags) expect(COMPATIBILITY_TAGS).toContain(tag);
    }
  });

  it("prefer roles the chassis vocabulary actually defines", () => {
    for (const entry of PILOT_DEFINITIONS) {
      for (const role of entry.preferredRoles) expect(CHASSIS_ROLES, entry.id).toContain(role);
    }
  });

  it("are each at home in something that has actually been built", () => {
    // A preference is allowed to name a role no chassis uses yet, because the
    // vocabulary is shared with machines that do not exist. What is not allowed
    // is a pilot whose every preference is for a machine nobody can fly, since
    // that is a trait that can never once apply.
    const shipped = new Set<string>(jaegerRegistry.all().map((chassis) => chassis.role));
    for (const entry of PILOT_DEFINITIONS) {
      const live = entry.preferredRoles.filter((role) => shipped.has(role));
      expect(live.length, entry.id).toBeGreaterThan(0);
    }
  });

  it("have dialogue for every moment the game already knows about", () => {
    for (const entry of PILOT_DEFINITIONS) {
      expect(entry.dialogue.onDeploy.length, entry.id).toBeGreaterThan(0);
      expect(entry.dialogue.offDuty.length, entry.id).toBeGreaterThan(0);
    }
  });
});

describe("nobody is best at everything", () => {
  it("gives every pilot a role they are not at home in", () => {
    const roles = [...new Set(jaegerRegistry.all().map((chassis) => chassis.role))];
    for (const entry of PILOT_DEFINITIONS) {
      const missing = roles.filter((role) => !entry.preferredRoles.includes(role));
      expect(missing.length, entry.id).toBeGreaterThan(0);
    }
  });

  it("means the best pair depends on the machine", () => {
    // The same two comparisons in two different machines have to disagree at
    // least once, or the roster screen is a ranking rather than a decision.
    const brawler = { machineRole: "brawler" };
    const marksman = { machineRole: "marksman" };
    const anvilVarga = ["pilot.okonkwo", "pilot.varga"] as const;
    const satoFerrant = ["pilot.sato", "pilot.ferrant"] as const;

    const score = (ids: readonly string[], context: object) =>
      assessDrift(pilot(ids[0]!), pilot(ids[1]!), context).strength;

    const brawlerGap = score(anvilVarga, brawler) - score(satoFerrant, brawler);
    const marksmanGap = score(anvilVarga, marksman) - score(satoFerrant, marksman);
    expect(brawlerGap).not.toBeCloseTo(marksmanGap, 6);
  });

  it("never lets a drift saturate, so two pairs can always be told apart", () => {
    const best = assessDrift(pilot("pilot.okonkwo"), pilot("pilot.varga"), {
      linkLevel: 99,
      machineRole: "brawler",
    });
    expect(best.strength).toBeLessThan(1);
    expect(best.strength).toBeGreaterThan(0.7);
  });
});

describe("drift", () => {
  it("still answers with two pilots and nothing else, as it always did", () => {
    const assessment = assessDrift(pilot("pilot.okonkwo"), pilot("pilot.varga"));
    expect(assessment.strength).toBeGreaterThan(0);
    expect(assessment.refused).toBe(false);
    expect(assessment.summary).toMatch(/percent link/);
  });

  it("refuses a pilot drifting with themselves", () => {
    const assessment = assessDrift(pilot("pilot.reyes"), pilot("pilot.reyes"));
    expect(assessment.refused).toBe(true);
    expect(assessment.summary).toMatch(/Nobody drifts with themselves/);
  });

  it("is stronger for a pair who have flown together", () => {
    const known = assessDrift(pilot("pilot.okonkwo"), pilot("pilot.varga"));
    const strangers = assessDrift(pilot("pilot.okonkwo"), pilot("pilot.sato"));
    expect(known.strength).toBeGreaterThan(strangers.strength);
  });

  it("grows with the link and stops growing at the cap", () => {
    const cold = assessDrift(pilot("pilot.ferrant"), pilot("pilot.sato"), { linkLevel: 0 });
    const warm = assessDrift(pilot("pilot.ferrant"), pilot("pilot.sato"), { linkLevel: 5 });
    const absurd = assessDrift(pilot("pilot.ferrant"), pilot("pilot.sato"), { linkLevel: 5_000 });
    expect(warm.strength).toBeGreaterThan(cold.strength);
    expect(absurd.strength - cold.strength).toBeLessThanOrEqual(MAX_LINK_BONUS + 1e-9);
  });

  it("is dragged down by stress and by carried injuries", () => {
    const fresh = assessDrift(pilot("pilot.okonkwo"), pilot("pilot.varga"), {});
    const tired = assessDrift(pilot("pilot.okonkwo"), pilot("pilot.varga"), {
      firstStress: 0.8,
      secondStress: 0.8,
    });
    const hurt = assessDrift(pilot("pilot.okonkwo"), pilot("pilot.varga"), {
      firstInjuryPenalty: 0.2,
    });
    expect(tired.strength).toBeLessThan(fresh.strength);
    expect(hurt.strength).toBeLessThan(fresh.strength);
  });

  it("shows its working, so a number can be argued with", () => {
    const assessment = assessDrift(pilot("pilot.okonkwo"), pilot("pilot.varga"), { linkLevel: 3 });
    expect(assessment.factors.length).toBeGreaterThan(2);
    expect(assessment.factors.some((factor) => factor.label.includes("link level"))).toBe(true);
  });

  it("refuses a pair who cannot hold it at all", () => {
    const assessment = assessDrift(pilot("pilot.reyes"), pilot("pilot.varga"), {
      firstStress: 1,
      secondStress: 1,
      firstInjuryPenalty: 0.3,
      secondInjuryPenalty: 0.3,
    });
    expect(assessment.strength).toBeLessThan(DRIFT_REFUSAL_THRESHOLD);
    expect(assessment.refused).toBe(true);
  });
});

describe("drawbacks", () => {
  it("are always reported, firing or not, so nothing is a surprise", () => {
    const assessment = assessDrift(pilot("pilot.okonkwo"), pilot("pilot.varga"), {});
    expect(assessment.drawbacks).toHaveLength(2);
    for (const report of assessment.drawbacks) {
      expect(report.reason.length).toBeGreaterThan(10);
      expect(report.drawback.description.length).toBeGreaterThan(20);
    }
  });

  it("fire only under the condition they document: a role", () => {
    const inABrawler = assessDrift(pilot("pilot.okonkwo"), pilot("pilot.sato"), {
      machineRole: "brawler",
    });
    const inAMarksman = assessDrift(pilot("pilot.okonkwo"), pilot("pilot.sato"), {
      machineRole: "marksman",
    });
    const firingIn = (assessment: typeof inABrawler) =>
      assessment.drawbacks.find((entry) => entry.pilotId === "pilot.okonkwo")!.firing;
    expect(firingIn(inABrawler)).toBe(false);
    expect(firingIn(inAMarksman)).toBe(true);
    expect(inAMarksman.strength).toBeLessThan(inABrawler.strength);
  });

  it("fire only under the condition they document: a hurt machine", () => {
    const whole = assessDrift(pilot("pilot.varga"), pilot("pilot.sato"), { machineIntegrity: 1 });
    const broken = assessDrift(pilot("pilot.varga"), pilot("pilot.sato"), { machineIntegrity: 0.3 });
    const firingIn = (assessment: typeof whole) =>
      assessment.drawbacks.find((entry) => entry.pilotId === "pilot.varga")!.firing;
    expect(firingIn(whole)).toBe(false);
    expect(firingIn(broken)).toBe(true);
  });

  it("fire only under the condition they document: a partner they grate on", () => {
    // Reyes is reckless and competitive, and grates on methodical or empathic.
    const withMethodical = assessDrift(pilot("pilot.reyes"), pilot("pilot.varga"), {});
    const withStoic = assessDrift(pilot("pilot.reyes"), pilot("pilot.okonkwo"), {});
    const firingIn = (assessment: typeof withStoic) =>
      assessment.drawbacks.find((entry) => entry.pilotId === "pilot.reyes")!.firing;
    expect(firingIn(withMethodical)).toBe(true);
    expect(firingIn(withStoic)).toBe(false);
  });

  it("fire only under the condition they document: a long approach", () => {
    const near = assessDrift(pilot("pilot.sato"), pilot("pilot.okonkwo"), { travelSeconds: 600 });
    const far = assessDrift(pilot("pilot.sato"), pilot("pilot.okonkwo"), { travelSeconds: 20_000 });
    const firingIn = (assessment: typeof near) =>
      assessment.drawbacks.find((entry) => entry.pilotId === "pilot.sato")!.firing;
    expect(firingIn(near)).toBe(false);
    expect(firingIn(far)).toBe(true);
  });

  it("do not fire when the planner knows nothing about the condition", () => {
    // A caller that says nothing about the machine cannot have a machine-role
    // drawback fire, because there is no machine to be wrong about.
    const assessment = assessDrift(pilot("pilot.okonkwo"), pilot("pilot.varga"));
    expect(assessment.drawbacks.every((entry) => !entry.firing)).toBe(true);
  });
});

describe("perks", () => {
  it("give nothing before the first rank is reached", () => {
    expect(perkEffects(pilot("pilot.okonkwo"), pilot("pilot.varga"), 0)).toEqual({});
    expect(currentPerkRank(pilot("pilot.okonkwo"), 1)).toBeNull();
  });

  it("replace each other rather than stacking", () => {
    const anvil = pilot("pilot.okonkwo");
    const early = currentPerkRank(anvil, 2)!;
    const late = currentPerkRank(anvil, 6)!;
    expect(late.linkLevel).toBeGreaterThan(early.linkLevel);
    const alone = perkEffects(anvil, undefined, 6);
    // Rank three's poise, not rank one times rank two times rank three.
    expect(alone.poise).toBeCloseTo(late.effects.poise!, 6);
  });

  it("combine the two pilots, so a pair is both of them", () => {
    const combined = perkEffects(pilot("pilot.okonkwo"), pilot("pilot.varga"), 4);
    expect(combined.poise).toBeGreaterThan(1);
    expect(combined.heat).toBeGreaterThan(1);
  });

  it("only ever name effects the game has somewhere to put", () => {
    for (const entry of PILOT_DEFINITIONS) {
      for (const rank of entry.perk.ranks) {
        for (const effect of Object.keys(rank.effects)) {
          expect(PERK_EFFECTS, `${entry.id} ${rank.linkLevel}`).toContain(effect);
        }
      }
    }
  });

  it("change what the pilot is, and say so in words", () => {
    for (const entry of PILOT_DEFINITIONS) {
      for (const rank of entry.perk.ranks) expect(rank.note.length, entry.id).toBeGreaterThan(10);
    }
  });
});

describe("injuries", () => {
  it("all validate", () => {
    for (const entry of injuries.all()) expect(validateInjury(entry), entry.id).toEqual([]);
  });

  it("never let treatment remove the whole recovery", () => {
    for (const entry of injuries.all()) {
      expect(treatedRecoveryDays(entry), entry.id).toBeGreaterThan(0);
      expect(treatedRecoveryDays(entry), entry.id).toBeLessThan(entry.recoveryDays);
    }
    const base = injuries.getOrThrow("injury.concussion");
    expect(validateInjury({ ...base, treatmentDaysSaved: base.recoveryDays }).join(" ")).toMatch(
      /cannot remove the whole recovery/,
    );
  });

  it("use only restrictions the game can act on", () => {
    for (const entry of injuries.all()) expect(INJURY_RESTRICTIONS).toContain(entry.restriction);
  });

  it("keep something flyable at every severity, so an injury is a decision", () => {
    for (const severity of INJURY_SEVERITIES) {
      const ofSeverity = injuries.all().filter((entry) => entry.severity === severity);
      expect(ofSeverity.length, severity).toBeGreaterThan(0);
    }
    // Not everything grounds: some of these are a pilot who can still fly badly.
    const flyable = injuries.all().filter((entry) => entry.restriction !== "grounded");
    expect(flyable.length).toBeGreaterThan(2);
  });

  it("draw from a wider pool the worse the sortie was", () => {
    expect(injuryPoolFor(0.2).every((entry) => entry.severity === "minor")).toBe(true);
    expect(injuryPoolFor(0.5).some((entry) => entry.severity === "serious")).toBe(true);
    expect(injuryPoolFor(0.9).some((entry) => entry.severity === "severe")).toBe(true);
  });

  it("kills nobody", () => {
    for (const entry of injuries.all()) {
      expect(entry.recoveryDays, entry.id).toBeLessThan(60);
      expect(entry.description.toLowerCase()).not.toContain("fatal");
    }
  });
});
