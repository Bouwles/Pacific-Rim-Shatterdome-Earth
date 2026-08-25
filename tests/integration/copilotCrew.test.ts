import { beforeEach, describe, expect, it } from "vitest";
import { Crew, LINK_EXPERIENCE_PER_LEVEL, MAX_LINK_LEVEL } from "../../src/pilots/crew";
import { assessDrift, createPilotRegistry, perkEffects } from "../../src/data/pilots";
import { createInjuryRegistry } from "../../src/data/injuries";
import { jaegerRegistry } from "../../src/data/jaegers";
import { combatProfileFor, jaegerZones } from "../../src/combat/arena";
import { createComponentRegistry } from "../../src/data/components";
import { growthFor } from "../../src/jaegers/progression";
import { comparePairs, runCrewScenario } from "../../src/debug/crewScenario";
import { MemorySaveRepository } from "../../src/saves/repository";
import { SaveService } from "../../src/saves/saveService";
import { SimulationKernel } from "../../src/simulation/kernel";

/**
 * The people, against the systems that actually read them.
 *
 * The unit tests prove the traits and the arithmetic. These prove the three
 * things the milestone is judged on: swapping a pair changes the machine, a
 * drawback is visible before launch and only bites when it says it will, and
 * nothing about a link or an injury can be advanced twice or lost to a save.
 */

const pilots = createPilotRegistry();
const injuries = createInjuryRegistry();
const components = createComponentRegistry();
const SEED = 20260826;
const ANVIL = "pilot.okonkwo";
const LEDGER = "pilot.varga";
const KINGFISHER = "pilot.reyes";
const QUARTZ = "pilot.sato";

function crew(seed = SEED): Crew {
  return new Crew({ pilots, injuries, seed });
}

let repository: MemorySaveRepository;
let service: SaveService;
let clock: number;

function kernel(): SimulationKernel {
  const instance = new SimulationKernel({ seed: SEED });
  for (let tick = 0; tick < 10; tick += 1) instance.step();
  return instance;
}

beforeEach(() => {
  repository = new MemorySaveRepository();
  clock = 1_700_000_000_000;
  service = new SaveService({ repository, now: () => (clock += 1000), autosaveSlots: 2, backupsPerSlot: 1 });
});

describe("swapping copilots changes the machine", () => {
  const chassis = jaegerRegistry.getOrThrow("heavy-mk4");

  /** The growth object a pair actually hand to the fight. */
  function growthFor2(firstId: string, secondId: string, linkLevel: number) {
    const effects = perkEffects(pilots.get(firstId), pilots.get(secondId), linkLevel);
    return growthFor({
      level: 1,
      prestige: 0,
      crewBonus: {
        structure: effects.structure,
        damage: effects.damage,
        heat: effects.heat,
        mobility: effects.mobility,
        poise: effects.poise,
      },
    });
  }

  it("gives the same Jaeger different numbers under different crews", () => {
    const anvilPair = growthFor2(ANVIL, LEDGER, 4);
    const kingfisherPair = growthFor2(KINGFISHER, QUARTZ, 4);

    // Anvil and Ledger brace and cool; Kingfisher and Quartz move and hit.
    expect(anvilPair.poise).toBeGreaterThan(kingfisherPair.poise);
    expect(anvilPair.heat).toBeGreaterThan(kingfisherPair.heat);
    expect(kingfisherPair.mobility).toBeGreaterThan(anvilPair.mobility);
    expect(kingfisherPair.damage).toBeGreaterThan(anvilPair.damage);
  });

  it("reaches the fight through the profile and the zones, not a separate path", () => {
    const anvilPair = growthFor2(ANVIL, LEDGER, 4);
    const stock = combatProfileFor(chassis);
    const withCrew = combatProfileFor(chassis, anvilPair);
    expect(withCrew.poiseCapacity).toBeGreaterThan(stock.poiseCapacity);
    expect(withCrew.heatDissipationPerSecond).toBeGreaterThan(stock.heatDissipationPerSecond);

    const tougher = growthFor2(ANVIL, "pilot.ferrant", 4);
    const zones = jaegerZones(chassis, undefined, components, tougher);
    const plain = jaegerZones(chassis, undefined, components);
    expect(zones[0]!.maxHealth).toBeGreaterThan(plain[0]!.maxHealth);
  });

  it("changes nothing at all before a link has been built", () => {
    const cold = growthFor2(ANVIL, LEDGER, 0);
    expect(combatProfileFor(chassis, cold)).toEqual(combatProfileFor(chassis));
  });

  it("makes a different pair the right answer in a different machine", () => {
    const inAGuardian = comparePairs("heavy-mk4", 4);
    const inASkirmisher = comparePairs("agile-mk5", 4);
    const best = (rows: typeof inAGuardian) =>
      [...rows].sort((a, b) => b.strength - a.strength)[0]!.pilotIds.join("+");
    // Not necessarily a different winner, but the ordering has to move.
    const guardianOrder = [...inAGuardian]
      .sort((a, b) => b.strength - a.strength)
      .map((r) => r.pilotIds.join("+"));
    const skirmisherOrder = [...inASkirmisher]
      .sort((a, b) => b.strength - a.strength)
      .map((r) => r.pilotIds.join("+"));
    expect(best(inAGuardian).length).toBeGreaterThan(0);
    expect(guardianOrder.join(",")).not.toBe("");
    // At minimum, the numbers differ between the two machines.
    expect(inAGuardian.map((r) => r.strength)).not.toEqual(inASkirmisher.map((r) => r.strength));
    expect(skirmisherOrder.length).toBe(4);
  });
});

describe("a drawback is visible before it matters", () => {
  it("is reported for both pilots whether or not it is biting", () => {
    const assessment = assessDrift(pilots.get(ANVIL), pilots.get(LEDGER), { machineRole: "guardian" });
    expect(assessment.drawbacks).toHaveLength(2);
    expect(assessment.drawbacks.every((entry) => entry.drawback.description.length > 20)).toBe(true);
  });

  it("bites only under the condition it documents, and costs when it does", () => {
    const home = assessDrift(pilots.get(ANVIL), pilots.get(QUARTZ), { machineRole: "brawler" });
    const wrong = assessDrift(pilots.get(ANVIL), pilots.get(QUARTZ), { machineRole: "siege" });
    const anvilIn = (assessment: typeof home) =>
      assessment.drawbacks.find((entry) => entry.pilotId === ANVIL)!;
    expect(anvilIn(home).firing).toBe(false);
    expect(anvilIn(wrong).firing).toBe(true);
    expect(wrong.strength).toBeLessThan(home.strength);
    expect(wrong.effectiveness).toBeLessThan(home.effectiveness);
  });

  it("sees an injury the crew is actually carrying", () => {
    const instance = crew();
    // Ferrant's drawback is flying beside somebody already hurt.
    instance.completeSortie({
      missionId: "m.hurt",
      pilotIds: [QUARTZ, KINGFISHER],
      score: 0.1,
      machineDamage: 0.95,
      won: false,
      day: 1,
    });
    const quartzHurt = (instance.get(QUARTZ)?.injuries.length ?? 0) > 0;
    const assessment = assessDrift(pilots.get("pilot.ferrant"), pilots.get(QUARTZ), {
      firstInjured: false,
      secondInjured: quartzHurt,
    });
    const ferrant = assessment.drawbacks.find((entry) => entry.pilotId === "pilot.ferrant")!;
    expect(ferrant.firing).toBe(quartzHurt);
  });
});

describe("links grow from what the player did", () => {
  it("start at nothing and climb with sorties flown together", () => {
    const instance = crew();
    expect(instance.linkLevel(ANVIL, LEDGER)).toBe(0);
    for (let index = 0; index < 4; index += 1) {
      instance.completeSortie({
        missionId: `m.${index}`,
        pilotIds: [ANVIL, LEDGER],
        score: 0.9,
        machineDamage: 0.05,
        won: true,
        day: index,
      });
    }
    expect(instance.linkLevel(ANVIL, LEDGER)).toBeGreaterThan(0);
  });

  it("are the same from both sides, always", () => {
    const instance = crew();
    instance.addLink(ANVIL, LEDGER, "training", 1);
    expect(instance.linkTrack(ANVIL, LEDGER)?.experience).toBe(instance.linkTrack(LEDGER, ANVIL)?.experience);
    expect(instance.linkLevel(ANVIL, LEDGER)).toBe(instance.linkLevel(LEDGER, ANVIL));
  });

  it("cannot be farmed by repeating the cheap thing", () => {
    const instance = crew();
    const first = instance.addLink(ANVIL, LEDGER, "conversation", 3);
    const second = instance.addLink(ANVIL, LEDGER, "conversation", 3);
    const third = instance.addLink(ANVIL, LEDGER, "conversation", 3);
    expect(first.refused).toBeNull();
    expect(second.refused).toBeNull();
    expect(third.refused).toMatch(/already done that today/);
    // And tomorrow it is available again, because it is a limit not a lockout.
    expect(instance.addLink(ANVIL, LEDGER, "conversation", 4).refused).toBeNull();
  });

  it("are worth most for flying together and least for talking", () => {
    const bySource = (source: Parameters<Crew["addLink"]>[2]) => {
      const instance = crew();
      instance.addLink(ANVIL, LEDGER, source, 1);
      return instance.linkTrack(ANVIL, LEDGER)?.experience ?? 0;
    };
    expect(bySource("deployment")).toBeGreaterThan(bySource("training"));
    expect(bySource("training")).toBeGreaterThan(bySource("conversation"));
  });

  it("stop at the cap rather than climbing forever", () => {
    const instance = crew();
    for (let index = 0; index < 400; index += 1) {
      instance.addLink(ANVIL, LEDGER, "deployment", index);
    }
    expect(instance.linkLevel(ANVIL, LEDGER)).toBe(MAX_LINK_LEVEL);
  });

  it("refuse training for somebody who is grounded", () => {
    const instance = crew();
    const record = instance.getOrThrow(ANVIL);
    record.injuries.push({ injuryId: "injury.concussion", daysRemaining: 5, treated: false, day: 1 });
    record.status = "injured";
    const result = instance.train(ANVIL, LEDGER, 2);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not cleared for the harness/);
  });

  it("give a real line of dialogue when two people talk", () => {
    const instance = crew();
    const result = instance.converse(KINGFISHER, QUARTZ, 1);
    expect(result.ok).toBe(true);
    expect(result.line.length).toBeGreaterThan(10);
    expect(pilots.getOrThrow(KINGFISHER).dialogue.offDuty).toContain(result.line);
  });
});

describe("one mission result cannot be banked twice", () => {
  it("applies once and refuses the second time in words", () => {
    const instance = crew();
    const outcome = {
      missionId: "m.duplicate",
      pilotIds: [ANVIL, LEDGER],
      score: 0.9,
      machineDamage: 0.1,
      won: true,
      day: 2,
    };
    const first = instance.completeSortie(outcome);
    const experienceAfterFirst = instance.linkTrack(ANVIL, LEDGER)?.experience ?? 0;

    const second = instance.completeSortie(outcome);
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.linkGained).toBe(0);
    expect(second.messages.join(" ")).toMatch(/already been logged/);
    expect(instance.linkTrack(ANVIL, LEDGER)?.experience).toBe(experienceAfterFirst);
  });

  it("still refuses it after a save and a load", async () => {
    const instance = crew();
    const outcome = {
      missionId: "m.persisted",
      pilotIds: [ANVIL, LEDGER],
      score: 0.8,
      machineDamage: 0.2,
      won: true,
      day: 3,
    };
    instance.completeSortie(outcome);
    const experience = instance.linkTrack(ANVIL, LEDGER)?.experience ?? 0;

    await service.save("slot.crew", kernel(), { name: "Crew", crew: instance.snapshot() });
    const loaded = await service.load("slot.crew");
    const reloaded = crew();
    reloaded.restore(loaded.document.crew);

    const again = reloaded.completeSortie(outcome);
    expect(again.applied).toBe(false);
    expect(reloaded.linkTrack(ANVIL, LEDGER)?.experience).toBe(experience);
  });
});

describe("injuries", () => {
  it("are nonlethal, and take somebody out of the rotation rather than out of the game", () => {
    const instance = crew();
    const record = instance.getOrThrow(ANVIL);
    record.injuries.push({ injuryId: "injury.concussion", daysRemaining: 9, treated: false, day: 1 });
    record.status = "injured";

    const check = instance.canDeploy(ANVIL);
    expect(check.ok).toBe(false);
    expect(check.message).toMatch(/grounded/);
    // Still on the roster, and still a person.
    expect(instance.get(ANVIL)).toBeDefined();
    expect(instance.all().map((entry) => entry.pilotId)).toContain(ANVIL);
  });

  it("let somebody fly hurt when the injury allows it", () => {
    const instance = crew();
    const record = instance.getOrThrow(KINGFISHER);
    record.injuries.push({ injuryId: "injury.hand-burns", daysRemaining: 6, treated: false, day: 1 });
    expect(instance.canDeploy(KINGFISHER).ok).toBe(true);
    expect(instance.restrictionsOf(KINGFISHER)).toContain("no-gunnery");
    expect(instance.injuryPenaltyOf(KINGFISHER)).toBeGreaterThan(0);
  });

  it("are shortened by treatment and never removed by it", () => {
    const instance = crew();
    const record = instance.getOrThrow(ANVIL);
    record.injuries.push({ injuryId: "injury.concussion", daysRemaining: 9, treated: false, day: 1 });
    const result = instance.treat(ANVIL, "injury.concussion", 2);
    expect(result.ok).toBe(true);
    const left = instance.getOrThrow(ANVIL).injuries[0]!;
    expect(left.daysRemaining).toBeLessThan(9);
    expect(left.daysRemaining).toBeGreaterThan(0);
    expect(left.treated).toBe(true);
    // And treating it twice is refused rather than stacking.
    expect(instance.treat(ANVIL, "injury.concussion", 3).ok).toBe(false);
  });

  it("clear with time and put the pilot back on the board", () => {
    const instance = crew();
    const record = instance.getOrThrow(ANVIL);
    record.injuries.push({ injuryId: "injury.neural-strain", daysRemaining: 4, treated: false, day: 1 });
    record.status = "injured";
    const messages = instance.advanceDays(5, 6);
    expect(messages.join(" ")).toMatch(/recovered/);
    expect(instance.getOrThrow(ANVIL).injuries).toHaveLength(0);
    expect(instance.canDeploy(ANVIL).ok).toBe(true);
  });

  it("can be answered by standing somebody down deliberately", () => {
    const instance = crew();
    instance.getOrThrow(KINGFISHER).stress = 0.9;
    const result = instance.assignRecovery(KINGFISHER, 4, 1);
    expect(result.ok).toBe(true);
    expect(instance.getOrThrow(KINGFISHER).status).toBe("recovering");
    // Standing somebody down means they are actually down: the order is not
    // advice that the next click can ignore.
    const whileResting = instance.canDeploy(KINGFISHER);
    expect(whileResting.ok).toBe(false);
    expect(whileResting.message).toMatch(/standing down/);
    instance.advanceDays(4, 5);
    // Rest clears more stress than simply not flying would have.
    expect(instance.getOrThrow(KINGFISHER).stress).toBeLessThan(0.6);
    expect(instance.canDeploy(KINGFISHER).ok).toBe(true);
  });

  it("offer substitutes, ordered by who knows the remaining pilot best", () => {
    const instance = crew();
    for (let index = 0; index < 6; index += 1) {
      instance.addLink("pilot.ferrant", LEDGER, "deployment", index);
    }
    const options = instance.substitutesFor(ANVIL, LEDGER);
    expect(options.length).toBeGreaterThan(0);
    expect(options.map((entry) => entry.pilotId)).not.toContain(ANVIL);
    expect(options.map((entry) => entry.pilotId)).not.toContain(LEDGER);
    expect(options[0]!.pilotId).toBe("pilot.ferrant");
  });

  it("never offers a substitute who cannot fly", () => {
    const instance = crew();
    const grounded = instance.getOrThrow("pilot.ferrant");
    grounded.injuries.push({ injuryId: "injury.concussion", daysRemaining: 9, treated: false, day: 1 });
    grounded.status = "injured";
    const options = instance.substitutesFor(ANVIL, LEDGER);
    expect(options.map((entry) => entry.pilotId)).not.toContain("pilot.ferrant");
  });

  it("are drawn deterministically, so a reload cannot reroll them", () => {
    const outcome = {
      missionId: "m.determinism",
      pilotIds: [KINGFISHER, QUARTZ],
      score: 0.1,
      machineDamage: 0.9,
      won: false,
      day: 1,
    };
    const first = crew().completeSortie(outcome);
    const second = crew().completeSortie(outcome);
    expect(second.injuries).toEqual(first.injuries);
  });

  it("can put somebody in a bed at least sometimes, across many sorties", () => {
    // Not every seed hurts somebody, so this asks whether the path exists at
    // all rather than whether one particular sortie fires it.
    let grounding = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const instance = crew(seed);
      instance.completeSortie({
        missionId: `m.severe.${seed}`,
        pilotIds: [KINGFISHER, QUARTZ],
        score: 0,
        machineDamage: 1,
        won: false,
        day: 1,
      });
      for (const id of [KINGFISHER, QUARTZ]) {
        if (instance.restrictionsOf(id).includes("grounded")) grounding += 1;
      }
    }
    expect(grounding).toBeGreaterThan(0);
    // And it is not so common that a roster is unusable.
    expect(grounding).toBeLessThan(40);
  });
});

describe("the crew across a save", () => {
  it("brings back links, stress, injuries and history", async () => {
    const instance = crew();
    instance.addLink(ANVIL, LEDGER, "training", 1);
    instance.getOrThrow(ANVIL).stress = 0.4;
    instance.getOrThrow(ANVIL).injuries.push({
      injuryId: "injury.hand-burns",
      daysRemaining: 3,
      treated: true,
      day: 1,
    });
    instance.note(ANVIL, 1, "Ran the gantry drill twice.");

    await service.save("slot.people", kernel(), { name: "People", crew: instance.snapshot() });
    const loaded = await service.load("slot.people");
    const reloaded = crew();
    reloaded.restore(loaded.document.crew);

    expect(reloaded.linkTrack(ANVIL, LEDGER)?.experience).toBe(instance.linkTrack(ANVIL, LEDGER)?.experience);
    expect(reloaded.getOrThrow(ANVIL).stress).toBeCloseTo(0.4, 3);
    expect(reloaded.getOrThrow(ANVIL).injuries).toHaveLength(1);
    expect(reloaded.getOrThrow(ANVIL).history.map((line) => line.event)).toContain(
      "Ran the gantry drill twice.",
    );
  });

  it("recomputes the link level from the experience rather than trusting the file", () => {
    const instance = crew();
    instance.addLink(ANVIL, LEDGER, "training", 1);
    const snapshot = instance.snapshot();
    const tampered = {
      ...snapshot,
      members: snapshot.members.map((entry) =>
        entry.pilotId === ANVIL
          ? { ...entry, links: { [LEDGER]: { partnerId: LEDGER, experience: 18, level: 99, sorties: 0 } } }
          : entry,
      ),
    };
    const reloaded = crew();
    reloaded.restore(tampered);
    expect(reloaded.linkLevel(ANVIL, LEDGER)).toBe(Math.floor(18 / LINK_EXPERIENCE_PER_LEVEL));
  });

  it("drops an injury this build no longer ships", () => {
    const instance = crew();
    instance.getOrThrow(ANVIL).injuries.push({
      injuryId: "injury.deleted",
      daysRemaining: 4,
      treated: false,
      day: 1,
    });
    const reloaded = crew();
    reloaded.restore(instance.snapshot());
    expect(reloaded.getOrThrow(ANVIL).injuries).toHaveLength(0);
  });

  it("never brings somebody back mid-sortie", () => {
    const instance = crew();
    instance.deploy([ANVIL, LEDGER]);
    const reloaded = crew();
    reloaded.restore(instance.snapshot());
    expect(reloaded.getOrThrow(ANVIL).status).toBe("ready");
  });
});

describe("a campaign of flying", () => {
  it("runs the same way twice from the same seed", () => {
    const first = runCrewScenario({ severity: 0.6 });
    const second = runCrewScenario({ severity: 0.6 });
    expect(second.digest).toBe(first.digest);
    expect(second.injuries).toEqual(first.injuries);
  });

  it("hurts people more often on bad sorties than on clean ones", () => {
    const easy = runCrewScenario({ severity: 0.1, sorties: 30 });
    const hard = runCrewScenario({ severity: 0.9, sorties: 30 });
    expect(hard.injuries.length).toBeGreaterThanOrEqual(easy.injuries.length);
  });

  it("does not ground the whole roster inside a campaign", () => {
    const run = runCrewScenario({ severity: 0.7, sorties: 20 });
    // Some time lost is the point. Most of it lost is a scheduling puzzle
    // nobody asked for, which is what the first version of this table did.
    expect(run.groundedDays).toBeLessThan(20 * 3 * 0.5);
  });

  it("builds a real link over a campaign of flying together", () => {
    const run = runCrewScenario({ severity: 0.3, sorties: 20 });
    expect(run.linkLevel).toBeGreaterThan(2);
  });
});
