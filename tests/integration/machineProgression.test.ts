import { beforeEach, describe, expect, it } from "vitest";
import { Roster } from "../../src/jaegers/roster";
import { jaegerRegistry } from "../../src/data/jaegers";
import { createComponentRegistry } from "../../src/data/components";
import { LEVEL_CAP, growthFor, prestigeMultiplier, totalExperienceTo } from "../../src/jaegers/progression";
import { combatProfileFor, jaegerZones } from "../../src/combat/arena";
import { MemorySaveRepository } from "../../src/saves/repository";
import { SaveService } from "../../src/saves/saveService";
import { SimulationKernel } from "../../src/simulation/kernel";

/**
 * Progression against the machines that actually carry it.
 *
 * The unit tests prove the curve. These prove the curve reaches the fight: a
 * levelled machine has more structure in the arena, hits harder, and comes back
 * from a save the same machine it was.
 */

const components = createComponentRegistry();
const MACHINE = "heavy-mk4";
const SEED = 20260825;

function roster(): Roster {
  return new Roster(jaegerRegistry, components);
}

/** Puts a machine at a level without pretending experience did not happen. */
function levelTo(instance: Roster, jaegerId: string, level: number): void {
  const record = instance.getOrThrow(jaegerId);
  instance.award(jaegerId, totalExperienceTo(level, record.prestige) - record.experience);
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

describe("earning levels", () => {
  it("starts every machine at level one with nothing banked", () => {
    const record = roster().getOrThrow(MACHINE);
    expect(record.level).toBe(1);
    expect(record.experience).toBe(0);
    expect(record.prestige).toBe(0);
    expect(record.passives).toEqual([]);
    expect(record.modules).toEqual([]);
  });

  it("levels up from experience and says what each level opened", () => {
    const instance = roster();
    const result = instance.award(MACHINE, totalExperienceTo(7));
    expect(result.level).toBe(7);
    expect(result.levelsGained).toBe(6);
    expect(result.messages.join(" ")).toMatch(/Reached level 2/);
    expect(result.messages.join(" ")).toMatch(/can now throw/);
    // And the history keeps it, because a machine's record is the record.
    expect(instance.getOrThrow(MACHINE).history.some((line) => line.event.includes("level 6"))).toBe(true);
  });

  it("never leaves the level and the experience disagreeing", () => {
    const instance = roster();
    for (let award = 0; award < 40; award += 1) {
      instance.award(MACHINE, 1_500);
      const record = instance.getOrThrow(MACHINE);
      const expected = growthFor({ level: record.level, prestige: record.prestige });
      expect(instance.growthOf(MACHINE).structure).toBeCloseTo(expected.structure, 10);
    }
  });

  it("refuses to be paid a negative or nonsense amount", () => {
    const instance = roster();
    expect(instance.award(MACHINE, -5_000).levelsGained).toBe(0);
    expect(instance.award(MACHINE, Number.NaN).levelsGained).toBe(0);
    expect(instance.getOrThrow(MACHINE).experience).toBe(0);
  });

  it("stops at the cap and says the machine can prestige", () => {
    const instance = roster();
    const result = instance.award(MACHINE, totalExperienceTo(LEVEL_CAP) * 4);
    expect(result.level).toBe(LEVEL_CAP);
    expect(result.messages.join(" ")).toMatch(/level cap/);
  });

  it("unlocks moves as it climbs, and never takes one back", () => {
    const instance = roster();
    let previous = instance.movesFor(MACHINE);
    for (const level of [4, 8, 14, 22, LEVEL_CAP]) {
      levelTo(instance, MACHINE, level);
      const now = instance.movesFor(MACHINE);
      for (const move of previous) expect(now).toContain(move);
      previous = now;
    }
    expect(previous.length).toBeGreaterThan(5);
  });
});

describe("passives", () => {
  it("offers nothing before the first choice is earned", () => {
    const instance = roster();
    expect(instance.passiveChoices(MACHINE).tier).toBeNull();
    expect(instance.choosePassive(MACHINE, "passive.reinforced-frame").ok).toBe(false);
  });

  it("offers a tier once the level opens it, and takes exactly one", () => {
    const instance = roster();
    levelTo(instance, MACHINE, 4);
    const choice = instance.passiveChoices(MACHINE);
    expect(choice.tier).toBe(1);
    expect(choice.options.length).toBeGreaterThanOrEqual(2);

    expect(instance.choosePassive(MACHINE, choice.options[0]!.id).ok).toBe(true);
    // One per tier: the second attempt at the same tier is refused in words.
    const second = instance.choosePassive(MACHINE, choice.options[1]!.id);
    expect(second.ok).toBe(false);
    expect(second.message).toMatch(/Nothing to choose/);
  });

  it("refuses a passive from a tier that is not the one open", () => {
    const instance = roster();
    levelTo(instance, MACHINE, 4);
    const result = instance.choosePassive(MACHINE, "passive.reactor-tap");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/tier 3/);
  });

  it("changes what the machine is worth, tradeoff included", () => {
    const instance = roster();
    levelTo(instance, MACHINE, 4);
    const before = instance.growthOf(MACHINE);
    instance.choosePassive(MACHINE, "passive.reinforced-frame");
    const after = instance.growthOf(MACHINE);
    expect(after.structure).toBeGreaterThan(before.structure);
    expect(after.mobility).toBeLessThan(before.mobility);
  });

  it("respecs all of them at once, and costs the bay real hours", () => {
    const instance = roster();
    levelTo(instance, MACHINE, 10);
    instance.choosePassive(MACHINE, "passive.reinforced-frame");
    instance.choosePassive(MACHINE, "passive.weighted-knuckles");

    const result = instance.respecPassives(MACHINE);
    expect(result.ok).toBe(true);
    expect(result.hours).toBe(24);
    expect(instance.getOrThrow(MACHINE).passives).toEqual([]);
    expect(instance.getOrThrow(MACHINE).status).toBe("repairing");
    // And both choices are open again, from the bottom tier up.
    expect(instance.passiveChoices(MACHINE).tier).toBe(1);
  });

  it("refuses a respec on a machine that is not in the bay", () => {
    const instance = roster();
    levelTo(instance, MACHINE, 4);
    instance.choosePassive(MACHINE, "passive.reinforced-frame");
    instance.deploy(MACHINE);
    const result = instance.respecPassives(MACHINE);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/bay work/);
  });
});

describe("modules", () => {
  it("has no slots at level one, and opens them on a schedule", () => {
    const instance = roster();
    expect(instance.growthOf(MACHINE).moduleSlots).toBe(0);
    levelTo(instance, MACHINE, 6);
    expect(instance.growthOf(MACHINE).moduleSlots).toBe(1);
    levelTo(instance, MACHINE, LEVEL_CAP);
    expect(instance.growthOf(MACHINE).moduleSlots).toBe(4);
  });

  it("fits one, charges for it, and puts the machine in the bay", () => {
    const instance = roster();
    levelTo(instance, MACHINE, 6);
    const result = instance.fitModule(MACHINE, "module.spine-brace");
    expect(result.ok).toBe(true);
    expect(result.cost).toBeGreaterThan(0);
    expect(instance.getOrThrow(MACHINE).status).toBe("repairing");
    expect(instance.growthOf(MACHINE).structure).toBeGreaterThan(
      growthFor({ level: 6, prestige: 0 }).structure,
    );
  });

  it("refuses a full rack, and says how full it is", () => {
    const instance = roster();
    levelTo(instance, MACHINE, 6);
    instance.fitModule(MACHINE, "module.spine-brace");
    instance.getOrThrow(MACHINE).status = "ready";
    const result = instance.fitModule(MACHINE, "module.impact-drivers");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Every slot is full: 1 of 1/);
  });

  it("says when the first slot opens rather than reporting zero of zero", () => {
    const instance = roster();
    const result = instance.fitModule(MACHINE, "module.spine-brace");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/No module slots yet. The first opens at level 6/);
  });

  it("refuses a module the machine has not earned, in words", () => {
    const instance = roster();
    levelTo(instance, MACHINE, 6);
    expect(instance.fitModule(MACHINE, "module.composite-shell").message).toMatch(/Needs level 22/);
    expect(instance.fitModule(MACHINE, "module.long-service-loom").message).toMatch(/Needs prestige 10/);
  });

  it("removes one to stores rather than destroying it", () => {
    const instance = roster();
    levelTo(instance, MACHINE, 6);
    instance.fitModule(MACHINE, "module.spine-brace");
    instance.getOrThrow(MACHINE).status = "ready";
    expect(instance.removeModule(MACHINE, "module.spine-brace").ok).toBe(true);
    expect(instance.getOrThrow(MACHINE).modules).toEqual([]);
    expect(instance.getOrThrow(MACHINE).storedModules).toContain("module.spine-brace");
  });

  it("lists what could be fitted with the reason it cannot", () => {
    const instance = roster();
    levelTo(instance, MACHINE, 6);
    const options = instance.moduleOptions(MACHINE);
    expect(options.length).toBeGreaterThan(5);
    const late = options.find((entry) => entry.module.id === "module.composite-shell")!;
    expect(late.refusal).toMatch(/Needs level 22/);
    const early = options.find((entry) => entry.module.id === "module.spine-brace")!;
    expect(early.refusal).toBeNull();
  });
});

describe("prestige", () => {
  it("is refused below the cap, and says how far off", () => {
    const instance = roster();
    levelTo(instance, MACHINE, 20);
    const result = instance.prestige(MACHINE);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/level 20 of 30/);
    expect(instance.getOrThrow(MACHINE).prestige).toBe(0);
  });

  it("forecasts exactly what it then does", () => {
    const instance = roster();
    levelTo(instance, MACHINE, LEVEL_CAP);
    const forecast = instance.prestigeForecast(MACHINE);
    expect(forecast.eligible).toBe(true);

    instance.prestige(MACHINE);
    expect(instance.growthOf(MACHINE)).toEqual(forecast.after);
    expect(instance.getOrThrow(MACHINE).level).toBe(1);
    expect(instance.getOrThrow(MACHINE).experience).toBe(0);
    expect(instance.getOrThrow(MACHINE).prestige).toBe(1);
  });

  it("gives up passives and keeps the machine's record", () => {
    const instance = roster();
    levelTo(instance, MACHINE, LEVEL_CAP);
    instance.choosePassive(MACHINE, "passive.reinforced-frame");
    const historyBefore = instance.getOrThrow(MACHINE).history.length;

    instance.prestige(MACHINE);
    expect(instance.getOrThrow(MACHINE).passives).toEqual([]);
    expect(instance.getOrThrow(MACHINE).history.length).toBeGreaterThan(historyBefore);
  });

  it("never destroys a module a player paid for", () => {
    const instance = roster();
    levelTo(instance, MACHINE, LEVEL_CAP);
    instance.fitModule(MACHINE, "module.composite-shell");
    instance.getOrThrow(MACHINE).status = "ready";

    instance.prestige(MACHINE);
    const record = instance.getOrThrow(MACHINE);
    // A level 22 module cannot be carried by a level 1 machine, so it is stored.
    expect(record.modules).not.toContain("module.composite-shell");
    expect(record.storedModules).toContain("module.composite-shell");
  });

  it("is worth less every time, and stays finite at absurd ranks", () => {
    const instance = roster();
    let previousGain = Number.POSITIVE_INFINITY;
    for (let rank = 0; rank < 6; rank += 1) {
      levelTo(instance, MACHINE, LEVEL_CAP);
      const forecast = instance.prestigeForecast(MACHINE);
      expect(forecast.netGain).toBeLessThan(previousGain);
      previousGain = forecast.netGain;
      expect(instance.prestige(MACHINE).ok).toBe(true);
    }
    expect(instance.getOrThrow(MACHINE).prestige).toBe(6);

    // And a rank nobody will ever reach still produces a usable machine.
    instance.getOrThrow(MACHINE).prestige = 1e15;
    const growth = instance.growthOf(MACHINE);
    expect(Number.isFinite(growth.structure)).toBe(true);
    expect(growth.structure).toBeLessThan(3);
  });

  it("takes longer to climb back each time", () => {
    const instance = roster();
    levelTo(instance, MACHINE, LEVEL_CAP);
    const firstClimb = instance.getOrThrow(MACHINE).experience;
    instance.prestige(MACHINE);
    levelTo(instance, MACHINE, LEVEL_CAP);
    expect(instance.getOrThrow(MACHINE).experience).toBeGreaterThan(firstClimb);
  });
});

describe("mastery goals", () => {
  it("count one sortie at a time and pay a threshold once", () => {
    const instance = roster();
    let paid = 0;
    for (let sortie = 0; sortie < 5; sortie += 1) {
      paid += instance.completeSortie(MACHINE, {
        won: true,
        structureLost: 0.2,
        componentLost: false,
        rescuedThousands: 4,
        salvageTons: 120,
      }).experience;
    }
    expect(instance.getOrThrow(MACHINE).mastery.sorties).toBe(5);
    expect(paid).toBeGreaterThan(0);

    // The sixth crosses nothing new, so it pays nothing new.
    const again = instance.completeSortie(MACHINE, {
      won: true,
      structureLost: 0,
      componentLost: false,
      rescuedThousands: 0,
      salvageTons: 0,
    });
    expect(again.experience).toBe(0);
  });

  it("turn into levels through the same award path as everything else", () => {
    const instance = roster();
    const before = instance.getOrThrow(MACHINE).experience;
    instance.completeSortie(MACHINE, {
      won: true,
      structureLost: 1,
      componentLost: false,
      rescuedThousands: 500,
      salvageTons: 20_000,
    });
    expect(instance.getOrThrow(MACHINE).experience).toBeGreaterThan(before);
  });

  it("survive a prestige, because they are the machine's record", () => {
    const instance = roster();
    instance.completeSortie(MACHINE, {
      won: true,
      structureLost: 0.5,
      componentLost: false,
      rescuedThousands: 10,
      salvageTons: 200,
    });
    levelTo(instance, MACHINE, LEVEL_CAP);
    instance.prestige(MACHINE);
    expect(instance.getOrThrow(MACHINE).mastery.sorties).toBe(1);
  });
});

describe("progression reaches the fight", () => {
  it("gives a levelled machine more structure in the arena", () => {
    const chassis = jaegerRegistry.getOrThrow(MACHINE);
    const stock = jaegerZones(chassis, undefined, components);
    const veteran = jaegerZones(chassis, undefined, components, growthFor({ level: LEVEL_CAP, prestige: 5 }));
    for (let index = 0; index < stock.length; index += 1) {
      expect(veteran[index]!.maxHealth).toBeGreaterThan(stock[index]!.maxHealth);
      expect(veteran[index]!.health).toBe(veteran[index]!.maxHealth);
    }
  });

  it("gives it a better combat profile without touching what it is made of", () => {
    const chassis = jaegerRegistry.getOrThrow(MACHINE);
    const stock = combatProfileFor(chassis);
    const veteran = combatProfileFor(chassis, growthFor({ level: LEVEL_CAP, prestige: 5 }));
    expect(veteran.heatDissipationPerSecond).toBeGreaterThan(stock.heatDissipationPerSecond);
    expect(veteran.poiseCapacity).toBeGreaterThan(stock.poiseCapacity);
    expect(veteran.guardMax).toBeGreaterThan(stock.guardMax);
    // Stamina is the pilots, not the machine, so a level does not touch it.
    expect(veteran.staminaMax).toBe(stock.staminaMax);
  });

  it("changes nothing at all for a machine that has never been flown", () => {
    const chassis = jaegerRegistry.getOrThrow(MACHINE);
    expect(combatProfileFor(chassis, growthFor({ level: 1, prestige: 0 }))).toEqual(
      combatProfileFor(chassis),
    );
  });
});

describe("catch-up when buying late", () => {
  it("delivers a new machine near the fleet's best rather than a generation behind", () => {
    const instance = roster();
    // A favourite that has been round the block ten times.
    instance.getOrThrow(MACHINE).prestige = 10;

    const bought = instance.acquire({ chassisId: "veteran-mk1", acquiredBy: "purchase", day: 40 })!;
    expect(bought.prestige).toBeGreaterThan(0);
    expect(bought.prestige).toBeLessThan(10);
    expect(bought.level).toBeGreaterThan(1);
    expect(bought.history.some((line) => line.event.includes("veteran crew"))).toBe(true);

    const gap = prestigeMultiplier(10) - prestigeMultiplier(bought.prestige);
    expect(gap).toBeLessThan(0.12);
  });

  it("gives nothing away in a campaign that has never prestiged", () => {
    const instance = roster();
    const bought = instance.acquire({ chassisId: "veteran-mk1", acquiredBy: "purchase", day: 3 })!;
    expect(bought.level).toBe(1);
    expect(bought.prestige).toBe(0);
    expect(bought.experience).toBe(0);
  });
});

describe("progression across a save", () => {
  it("comes back the same machine", async () => {
    const instance = roster();
    levelTo(instance, MACHINE, LEVEL_CAP);
    instance.choosePassive(MACHINE, "passive.reinforced-frame");
    instance.fitModule(MACHINE, "module.spine-brace");
    instance.getOrThrow(MACHINE).status = "ready";
    instance.completeSortie(MACHINE, {
      won: true,
      structureLost: 0.4,
      componentLost: false,
      rescuedThousands: 60,
      salvageTons: 1_500,
    });
    const growthBefore = instance.growthOf(MACHINE);

    await service.save("slot.progression", kernel(), { name: "Veteran", roster: instance.snapshot() });
    const loaded = await service.load("slot.progression");

    const reloaded = roster();
    reloaded.restore(loaded.document.roster);
    const record = reloaded.getOrThrow(MACHINE);
    expect(record.level).toBe(LEVEL_CAP);
    expect(record.passives).toEqual(["passive.reinforced-frame"]);
    expect(record.modules).toEqual(["module.spine-brace"]);
    expect(record.mastery.sorties).toBe(1);
    expect(reloaded.growthOf(MACHINE)).toEqual(growthBefore);
  });

  it("recomputes the level from the experience rather than trusting the file", () => {
    const instance = roster();
    levelTo(instance, MACHINE, 12);
    const snapshot = instance.snapshot();
    // A file claiming a level its experience cannot support.
    const tampered = {
      machines: snapshot.machines.map((entry) =>
        entry.jaegerId === MACHINE ? { ...entry, level: 30 } : entry,
      ),
    };
    const reloaded = roster();
    reloaded.restore(tampered);
    expect(reloaded.getOrThrow(MACHINE).level).toBe(12);
  });

  it("forgets a passive or module this build no longer ships", () => {
    const instance = roster();
    levelTo(instance, MACHINE, 6);
    const snapshot = instance.snapshot();
    const tampered = {
      machines: snapshot.machines.map((entry) =>
        entry.jaegerId === MACHINE
          ? { ...entry, passives: ["passive.deleted"], modules: ["module.deleted"] }
          : entry,
      ),
    };
    const reloaded = roster();
    reloaded.restore(tampered);
    expect(reloaded.getOrThrow(MACHINE).passives).toEqual([]);
    expect(reloaded.getOrThrow(MACHINE).modules).toEqual([]);
  });

  it("keeps prestige through a round trip at an absurd rank", () => {
    const instance = roster();
    instance.getOrThrow(MACHINE).prestige = 1_000;
    const reloaded = roster();
    reloaded.restore(instance.snapshot());
    expect(reloaded.getOrThrow(MACHINE).prestige).toBe(1_000);
    expect(Number.isFinite(reloaded.growthOf(MACHINE).structure)).toBe(true);
  });
});
