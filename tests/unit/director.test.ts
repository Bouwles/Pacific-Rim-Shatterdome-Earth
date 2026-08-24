import { describe, expect, it } from "vitest";
import {
  MUTATION_DEFINITIONS,
  combineMutations,
  compatible,
  createMutationRegistry,
  validateMutation,
} from "../../src/data/mutations";
import {
  AttackDirector,
  MAX_ACTIVE_INCIDENTS,
  ROLL_INTERVAL_TICKS,
  emptyDirectorSnapshot,
  validateDirectorSnapshot,
} from "../../src/world/director";
import { createDefaultRegionRegistry } from "../../src/data/regions";

const mutations = createMutationRegistry();
const regions = createDefaultRegionRegistry();

function director(seed = 1, crisisFrequency = 1): AttackDirector {
  return new AttackDirector({ regions, seed, crisisFrequency });
}

/** Runs a director forward in fixed steps and returns everything it created. */
function campaign(instance: AttackDirector, ticks: number, step = 600) {
  const created = [];
  for (let tick = 0; tick <= ticks; tick += step) {
    created.push(...instance.advance(tick, step));
  }
  return created;
}

describe("mutations", () => {
  it("ships mutations that all validate", () => {
    for (const mutation of MUTATION_DEFINITIONS) {
      expect(validateMutation(mutation), mutation.id).toEqual([]);
    }
  });

  it("refuses a mutation that changes nothing", () => {
    const base = mutations.getOrThrow("mutation.carapace");
    const errors = validateMutation({
      ...base,
      damageScale: 1,
      armourScale: 1,
      speedScale: 1,
      senseScale: 1,
      resistances: {},
      grantsMedia: [],
    });
    expect(errors.join(" ")).toMatch(/must change something/);
  });

  it("refuses a mutation with no tell, because a warning has to say something", () => {
    const base = mutations.getOrThrow("mutation.carapace");
    expect(validateMutation({ ...base, tell: "" }).join(" ")).toMatch(/tell required/);
  });

  it("knows what cannot be combined", () => {
    const carapace = mutations.getOrThrow("mutation.carapace");
    const sprinter = mutations.getOrThrow("mutation.sprinter");
    const acid = mutations.getOrThrow("mutation.acid-blood");
    expect(compatible(carapace, sprinter)).toBe(false);
    expect(compatible(carapace, acid)).toBe(true);
  });

  it("combines into one set of multipliers and one cost", () => {
    const effect = combineMutations([
      mutations.getOrThrow("mutation.carapace"),
      mutations.getOrThrow("mutation.acid-blood"),
    ]);
    expect(effect.armourScale).toBeCloseTo(1.45, 5);
    expect(effect.damageScale).toBeCloseTo(1.2, 5);
    expect(effect.totalCost).toBe(5);
    expect(effect.resistances.pierce).toBeCloseTo(0.7, 5);
  });

  it("opens up media a creature did not have", () => {
    const effect = combineMutations([mutations.getOrThrow("mutation.deep-lungs")]);
    expect(effect.grantsMedia).toContain("water");
  });
});

describe("the attack director", () => {
  it("produces the same war from the same seed and the same decisions", () => {
    const first = campaign(director(42), 200_000).map(
      (incident) => `${incident.regionId}@${incident.arrivalTick}`,
    );
    const second = campaign(director(42), 200_000).map(
      (incident) => `${incident.regionId}@${incident.arrivalTick}`,
    );
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it("produces a different war from a different seed", () => {
    const a = campaign(director(1), 200_000).map((incident) => incident.regionId);
    const b = campaign(director(2), 200_000).map((incident) => incident.regionId);
    expect(a).not.toEqual(b);
  });

  it("does not spam: there are long stretches with nothing happening", () => {
    const instance = director(7);
    let quiet = 0;
    let longest = 0;
    for (let tick = 0; tick <= 200_000; tick += 600) {
      const created = instance.advance(tick, 600);
      if (created.length === 0) {
        quiet += 600;
        longest = Math.max(longest, quiet);
      } else {
        quiet = 0;
      }
    }
    // Hours of game time with no alert at all, not a constant drip.
    expect(longest).toBeGreaterThan(10_000);
  });

  it("never runs more incidents at once than it is allowed", () => {
    const instance = director(11, 2);
    let peak = 0;
    for (let tick = 0; tick <= 400_000; tick += 600) {
      instance.advance(tick, 600);
      peak = Math.max(peak, instance.active().length);
    }
    expect(peak).toBeLessThanOrEqual(Math.round(MAX_ACTIVE_INCIDENTS * 2));
  });

  it("can have two emergencies running at the same time", () => {
    const instance = director(3, 1.5);
    let peak = 0;
    for (let tick = 0; tick <= 400_000; tick += 600) {
      instance.advance(tick, 600);
      peak = Math.max(peak, instance.active().length);
    }
    expect(peak).toBeGreaterThanOrEqual(2);
  });

  it("does not hit the same region twice in a row", () => {
    const created = campaign(director(5), 400_000);
    let repeats = 0;
    for (let index = 1; index < created.length; index += 1) {
      if (created[index]!.regionId === created[index - 1]!.regionId) repeats += 1;
    }
    expect(created.length).toBeGreaterThan(3);
    expect(repeats).toBe(0);
  });

  it("lets the player turn the frequency down without turning it off", () => {
    const quiet = campaign(director(9, 0.25), 400_000).length;
    const loud = campaign(director(9, 2), 400_000).length;
    expect(quiet).toBeLessThan(loud);
    expect(loud).toBeGreaterThan(0);
    // The dial is bounded: nobody can set it to nothing or to everything.
    const instance = director(9);
    expect(instance.setCrisisFrequency(0)).toBe(0.25);
    expect(instance.setCrisisFrequency(99)).toBe(2);
  });

  it("rolls on a fixed cadence rather than every tick", () => {
    const instance = director(13);
    // One long step and many short ones must contain the same chances.
    const long = instance.advance(ROLL_INTERVAL_TICKS * 4, ROLL_INTERVAL_TICKS * 4);
    const other = director(13);
    let short = 0;
    for (let tick = 0; tick <= ROLL_INTERVAL_TICKS * 4; tick += 600) {
      short += other.advance(tick, 600).length;
    }
    expect(long.length).toBe(short);
  });
});

describe("resolution", () => {
  it("explains every number it produces", () => {
    const instance = director(21);
    const created = campaign(instance, 200_000);
    const incident = created[0];
    expect(incident).toBeDefined();
    const resolution = instance.resolve(incident!, "ignored");
    expect(resolution.ledger.length).toBeGreaterThan(3);
    for (const line of resolution.ledger) {
      expect(line.label.length).toBeGreaterThan(0);
      expect(line.reason.length).toBeGreaterThan(0);
      expect(Number.isFinite(line.value)).toBe(true);
    }
    expect(resolution.summary).toMatch(/held|overrun/);
  });

  it("is decided by the model, not by a result written when the alert was made", () => {
    const instance = director(23);
    const incident = campaign(instance, 200_000)[0]!;
    // The same incident met with a machine goes differently from one ignored.
    const alone = instance.resolve(incident, "ignored", { apply: false });
    const defended = instance.resolve(incident, "player-defended", {
      apply: false,
      playerStrength: 400,
    });
    expect(defended.held).toBe(true);
    expect(defended.reward).toBeGreaterThan(alone.reward);
  });

  it("lets chance move the margin without deciding a rout", () => {
    const instance = director(29);
    const incident = campaign(instance, 200_000)[0]!;
    const swamped = instance.resolve(incident, "ignored", { apply: false, playerStrength: 0 });
    const overwhelming = instance.resolve(incident, "player-defended", {
      apply: false,
      playerStrength: 5_000,
    });
    expect(overwhelming.held).toBe(true);
    const swing = swamped.ledger.find((line) => line.label === "How it went on the day");
    expect(swing).toBeDefined();
    expect(Math.abs(swing!.value)).toBeLessThan(incident.strength);
  });

  it("costs the region when it is left alone and rewards holding it", () => {
    const instance = director(31);
    const incident = campaign(instance, 200_000)[0]!;
    const before = instance.escalation;
    const resolution = instance.resolve(incident, "player-defended", { playerStrength: 800 });
    expect(resolution.held).toBe(true);
    expect(instance.escalation).toBeLessThanOrEqual(before);
    expect(resolution.reward).toBeGreaterThan(0);
  });

  it("gives the player a recovery window after anything resolves", () => {
    const instance = director(37);
    const incident = campaign(instance, 200_000)[0]!;
    instance.resolve(incident, "ignored");
    // Nothing new lands immediately on top of a resolution.
    const immediately = instance.advance(incident.arrivalTick + 600, 600);
    expect(immediately.length).toBe(0);
  });
});

describe("the saved director", () => {
  it("round-trips its whole state", () => {
    const instance = director(41);
    campaign(instance, 200_000);
    instance.escalation = 0.42;
    const snapshot = instance.snapshot();
    expect(validateDirectorSnapshot(snapshot)).toEqual([]);

    const restored = director(41);
    restored.restore(snapshot);
    expect(restored.escalation).toBeCloseTo(0.42, 5);
    expect(restored.incidents().length).toBe(instance.incidents().length);
    expect(restored.regions().length).toBe(instance.regions().length);
  });

  it("drops an incident in a region this build no longer has", () => {
    const instance = director(43);
    const snapshot = instance.snapshot();
    const doctored = {
      ...snapshot,
      incidents: [
        {
          ...emptyIncident(),
          regionId: "atlantis",
        },
      ],
    };
    instance.restore(doctored);
    expect(instance.incidents()).toEqual([]);
  });

  it("refuses a snapshot that is not one", () => {
    expect(validateDirectorSnapshot(null).length).toBeGreaterThan(0);
    expect(validateDirectorSnapshot({ ...emptyDirectorSnapshot(), schemaVersion: 99 }).length).toBe(1);
    expect(
      validateDirectorSnapshot({
        ...emptyDirectorSnapshot(),
        incidents: [{ id: "x", status: "melted" }],
      }).join(" "),
    ).toMatch(/unknown incident status/);
  });
});

function emptyIncident() {
  return {
    id: "incident.ghost",
    regionId: "hong-kong",
    originBearingDeg: 0,
    originDistanceMeters: 1_000,
    approachBearings: [0],
    combatants: [],
    mutationBudget: 0,
    warningConfidence: 0.5,
    targetPriorities: [],
    objective: "defend" as const,
    secondaryObjectives: [],
    createdTick: 0,
    arrivalTick: 100,
    status: "forecast" as const,
    strength: 1,
  };
}
