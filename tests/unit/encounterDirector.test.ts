import { describe, expect, it } from "vitest";
import { EncounterDirector, gradeSortie, type EncounterInput } from "../../src/game/encounterDirector";

/**
 * The encounter has a shape, and the shape is the same every time the fight
 * goes the same way.
 */

function input(overrides: Partial<EncounterInput> = {}): EncounterInput {
  return {
    elapsedSeconds: 0,
    distanceMeters: 600,
    creatureHealth: 1,
    creaturePoise: 1,
    creatureDefeated: false,
    creatureAbilityUsed: false,
    machineHealth: 1,
    machineDefeated: false,
    finisherActive: false,
    openingWindow: false,
    ...overrides,
  };
}

describe("the encounter director", () => {
  it("runs the benchmark fight through every phase in order", () => {
    const director = new EncounterDirector();
    const phases: string[] = [];
    const feed = (state: EncounterInput): void => {
      const cue = director.advance(state);
      if (cue) phases.push(cue.phase);
    };
    feed(input({ elapsedSeconds: 1, distanceMeters: 500 }));
    feed(input({ elapsedSeconds: 10, distanceMeters: 200 }));
    feed(input({ elapsedSeconds: 30, distanceMeters: 60 }));
    feed(input({ elapsedSeconds: 55, distanceMeters: 60, creatureHealth: 0.8 }));
    feed(input({ elapsedSeconds: 70, distanceMeters: 60, creatureHealth: 0.75 }));
    feed(input({ elapsedSeconds: 80, distanceMeters: 60, creatureHealth: 0.6 }));
    feed(input({ elapsedSeconds: 95, distanceMeters: 60, creatureHealth: 0.55 }));
    feed(input({ elapsedSeconds: 110, distanceMeters: 40, creatureHealth: 0.4 }));
    feed(input({ elapsedSeconds: 120, distanceMeters: 30, creatureHealth: 0.3, openingWindow: true }));
    feed(input({ elapsedSeconds: 124, distanceMeters: 30, creatureHealth: 0.3, finisherActive: true }));
    feed(input({ elapsedSeconds: 130, distanceMeters: 30, creatureHealth: 0, creatureDefeated: true }));
    expect(phases).toEqual([
      "opening",
      "spacing",
      "signature",
      "spacing",
      "disruption",
      "spacing",
      "enrage",
      "break",
      "finisher",
      "aftermath",
    ]);
    expect(director.cue().radioLineId).toBe("radio.victory");
  });

  it("does not repeat a cue while the phase holds", () => {
    const director = new EncounterDirector();
    expect(director.advance(input({ elapsedSeconds: 5, distanceMeters: 100 }))?.phase).toBe("opening");
    expect(director.advance(input({ elapsedSeconds: 6, distanceMeters: 100 }))).toBeNull();
  });

  it("names a lost machine over everything else", () => {
    const director = new EncounterDirector();
    director.advance(input({ elapsedSeconds: 5, distanceMeters: 100 }));
    const cue = director.advance(
      input({ elapsedSeconds: 50, distanceMeters: 20, machineDefeated: true, creatureHealth: 0.2 }),
    );
    expect(cue?.phase).toBe("lost");
    expect(cue?.warning).toBe("Machine down");
  });

  it("shows the signature no later than forty seconds after contact even if the creature is untouched", () => {
    const director = new EncounterDirector();
    director.advance(input({ elapsedSeconds: 0, distanceMeters: 100 }));
    director.advance(input({ elapsedSeconds: 20, distanceMeters: 100 }));
    expect(director.advance(input({ elapsedSeconds: 41, distanceMeters: 100 }))?.phase).toBe("signature");
  });
});

describe("the sortie grade", () => {
  it("rewards a clean, fast, complete sortie with an S", () => {
    expect(
      gradeSortie({
        outcome: "success",
        objectiveScore: 1,
        cityImpact: 0.05,
        machineDamage: 0.1,
        optionalDone: true,
        seconds: 200,
      }).letter,
    ).toBe("S");
  });

  it("fails a lost machine and marks an abort as a D", () => {
    expect(
      gradeSortie({
        outcome: "lost-contact",
        objectiveScore: 1,
        cityImpact: 0,
        machineDamage: 0,
        optionalDone: true,
        seconds: 10,
      }).letter,
    ).toBe("F");
    expect(
      gradeSortie({
        outcome: "aborted",
        objectiveScore: 1,
        cityImpact: 0,
        machineDamage: 0,
        optionalDone: true,
        seconds: 10,
      }).letter,
    ).toBe("D");
  });

  it("costs a grade for a wrecked district", () => {
    const clean = gradeSortie({
      outcome: "success",
      objectiveScore: 0.8,
      cityImpact: 0,
      machineDamage: 0.3,
      optionalDone: false,
      seconds: 400,
    });
    const wrecked = gradeSortie({
      outcome: "success",
      objectiveScore: 0.8,
      cityImpact: 0.9,
      machineDamage: 0.3,
      optionalDone: false,
      seconds: 400,
    });
    expect(clean.points).toBeGreaterThan(wrecked.points + 10);
  });
});
