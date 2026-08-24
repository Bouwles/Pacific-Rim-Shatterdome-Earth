import { describe, expect, it } from "vitest";
import { OBJECTIVE, runKaiju, runKaijuScenario, scenarioWorld } from "../../src/debug/kaijuScenario";
import { createKaijuRegistry } from "../../src/data/kaiju";
import { Creature } from "../../src/kaiju/creature";
import { SWIM_DEPTH_METERS } from "../../src/kaiju/navigation";

const kaiju = createKaijuRegistry();

describe("three archetypes, one objective", () => {
  it("solve it with visibly different tactics", () => {
    const result = runKaijuScenario();
    expect(result.runs.length).toBe(3);

    const trails = result.runs.map((run) => run.goalTrail.join(">"));
    // The whole point of the framework: same map, same objective, same
    // defender, three different answers.
    expect(new Set(trails).size).toBe(3);

    const byId = new Map(result.runs.map((run) => [run.kaijuId, run]));
    const biped = byId.get("kaiju.biped-alpha")!;
    const serpent = byId.get("kaiju.serpent-delta")!;
    const burrower = byId.get("kaiju.burrower-sigma")!;

    // The brawler goes straight at what it can see.
    expect(biped.goalTrail).toContain("approach");
    // The ambusher waits before it commits, then works around.
    expect(serpent.goalTrail[0]).toBe("ambush");
    expect(serpent.goalTrail).toContain("flank");
    // The sapper ignores the machine entirely and goes for what it came for.
    expect(burrower.goalTrail).toContain("destroy-objective");
    expect(burrower.goalTrail).not.toContain("approach");
  });

  it("uses different ways of getting there, not just different goals", () => {
    const result = runKaijuScenario();
    const byId = new Map(result.runs.map((run) => [run.kaijuId, run]));
    const burrower = byId.get("kaiju.burrower-sigma")!;
    // The digger goes under something on the way and comes back up.
    expect(burrower.navOutcomes).toContain("burrow-under");
    expect(burrower.media).toContain("underground");
    // And it is the one that actually arrives.
    expect(burrower.reachedObjective).toBe(true);
    expect(byId.get("kaiju.biped-alpha")!.reachedObjective).toBe(false);
  });

  it("repeats exactly, and answers a different situation differently", () => {
    expect(runKaijuScenario().digest).toBe(runKaijuScenario().digest);
    // The seed moves where a creature guesses something is, not what it wants,
    // so the thing that has to change the plan is the situation.
    const near = runKaijuScenario({ defender: { east: 40, north: -450 } });
    const far = runKaijuScenario({ defender: { east: 40, north: 1_500 } });
    expect(near.digest).not.toBe(far.digest);
  });

  it("explains what it is doing, what it considered, and what it sensed", () => {
    const result = runKaijuScenario();
    for (const run of result.runs) {
      const debug = run.finalDebug;
      expect(debug.goal.length).toBeGreaterThan(0);
      expect(debug.goalReason.length).toBeGreaterThan(0);
      expect(debug.navOutcome.length).toBeGreaterThan(0);
      expect(debug.navReason.length).toBeGreaterThan(0);
      // Sensory contacts are real: it has actually noticed something.
      expect(run.contactsSeen).toBeGreaterThan(0);
      // And the alternatives it weighed are there to read.
      expect(debug.considered.length).toBeGreaterThan(0);
      for (const entry of debug.considered) expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it("never names a creature inside the engine's own explanations", () => {
    const result = runKaijuScenario();
    for (const run of result.runs) {
      for (const entry of run.finalDebug.considered) {
        expect(entry.reason).not.toMatch(/Alpha|Delta|Sigma|kaiju\./);
      }
    }
  });
});

describe("a creature in the water", () => {
  it("crosses a bay that stops something that cannot swim", () => {
    // The defender is on the far shore, so getting to it means the water.
    const across = { east: 0, north: 1_500 };
    const serpent = runKaiju(kaiju.getOrThrow("kaiju.serpent-delta"), {
      defender: across,
      ticks: 1_400,
    });
    const burrower = runKaiju(kaiju.getOrThrow("kaiju.burrower-sigma"), {
      defender: across,
      ticks: 1_400,
    });
    expect(serpent.media).toContain("water");
    // The digger has no business in the water and does not end up there.
    expect(burrower.media).not.toContain("water");
  });

  it("is faster in the medium it belongs in", () => {
    const world = scenarioWorld();
    const definition = kaiju.getOrThrow("kaiju.serpent-delta");
    const creature = new Creature({ definition, east: 0, north: 0, seed: 3 });
    // Somewhere to be, so it is actually travelling in both samples.
    const hideSpot = { east: 0, north: 2_000 };
    const dry = creature.advance(0.2, {
      stimuli: [],
      world,
      objective: OBJECTIVE,
      food: null,
      waterNearby: false,
      climbableNearby: false,
      hideSpot,
    });
    creature.north = 800;
    const wet = creature.advance(0.2, {
      stimuli: [],
      world,
      objective: OBJECTIVE,
      food: null,
      waterNearby: true,
      climbableNearby: false,
      hideSpot,
    });
    expect(world.waterDepth(0, 800)).toBeGreaterThanOrEqual(SWIM_DEPTH_METERS);
    expect(wet.speedMps).toBeGreaterThan(dry.speedMps);
  });
});

describe("breaking a creature apart", () => {
  it("removes the ability an organ granted", () => {
    const definition = kaiju.getOrThrow("kaiju.serpent-delta");
    const creature = new Creature({ definition, east: 0, north: 0, seed: 5 });
    expect(creature.can("ability.deep-sense")).toBe(true);

    let notes: readonly string[] = [];
    for (let hit = 0; hit < 30 && creature.can("ability.deep-sense"); hit += 1) {
      notes = creature.absorb("head", 300, "pierce").notes;
    }
    expect(creature.can("ability.deep-sense")).toBe(false);
    // And it says which organ went and what went with it.
    expect(notes.join(" ")).toMatch(/sonar bulb destroyed/i);
  });

  it("changes how it moves when an appendage comes off", () => {
    const definition = kaiju.getOrThrow("kaiju.serpent-delta");
    const creature = new Creature({ definition, east: 0, north: 0, seed: 6 });
    const before = creature.movementScale();
    creature.sever("limb.left");
    expect(creature.movementScale()).toBeLessThan(before);
    expect(creature.can("ability.turn-hard")).toBe(false);
  });

  it("changes what it does once it is badly hurt", () => {
    const definition = kaiju.getOrThrow("kaiju.biped-alpha");
    const world = scenarioWorld();
    const creature = new Creature({ definition, east: 0, north: 0, seed: 8 });
    const inputs = {
      stimuli: [{ sourceId: "jaeger" as const, east: 0, north: 200, strength: 1, kind: "sight" as const }],
      world,
      objective: null,
      food: null,
      waterNearby: false,
      climbableNearby: false,
    };
    creature.advance(0.2, inputs);
    const healthy = creature.currentGoal();

    creature.healthFraction = 0.1;
    for (let step = 0; step < 5; step += 1) creature.advance(0.2, inputs);
    // Past its enrage line it stops being sensible about it.
    expect(creature.currentGoal()).toBe("enrage");
    expect(creature.currentGoal()).not.toBe(healthy);
    expect(creature.damageScale()).toBeGreaterThan(1);
  });
});
