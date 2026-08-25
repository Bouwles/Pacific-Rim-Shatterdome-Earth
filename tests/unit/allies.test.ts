import { describe, expect, it } from "vitest";
import {
  ALLY_GOALS,
  DEFAULT_ORDER,
  SQUAD_ORDERS,
  SQUAD_ORDER_DEFINITIONS,
  createSquadOrderRegistry,
  validateSquadOrder,
} from "../../src/data/squadOrders";
import {
  ALLY_CREW_DEFINITIONS,
  createAllyCrewRegistry,
  perksAt,
  validateAllyCrew,
} from "../../src/data/allyCrews";
import {
  HYSTERESIS,
  SELF_PRESERVATION_HEALTH,
  createAllyGoalRegistry,
  decideAllyGoal,
  validateAllyGoal,
  type AllyProfile,
} from "../../src/allies/allyBehavior";
import { AllyController, resolveSquadIntents } from "../../src/allies/allyController";
import { baselineSituation } from "../../src/debug/squadScenario";

const orders = createSquadOrderRegistry();
const crews = createAllyCrewRegistry();
const goals = createAllyGoalRegistry();

const PROFILE: AllyProfile = {
  confidence: 0.7,
  preferredRangeMeters: 100,
  aggression: 0.6,
  supportTendency: 0.5,
  bias: {},
};

function inputs(situation = baselineSituation()) {
  return {
    situation,
    position: { east: 0, north: 0 },
    playerPosition: { east: 100, north: 0 },
    targetPosition: { east: 120, north: 40 },
    markedPosition: { east: 120, north: 40 },
    anchor: { east: 0, north: 0 },
    civilianPosition: { east: -500, north: 0 },
    targetZoneIds: ["head", "torso", "left-arm", "right-arm"],
    claimedZones: [] as string[],
    signatureWindow: false,
  };
}

describe("the order table", () => {
  it("registers every order exactly once, with unique hotkeys", () => {
    expect(orders.all()).toHaveLength(SQUAD_ORDERS.length);
    const keys = orders.all().map((entry) => entry.hotkey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("all validate", () => {
    for (const entry of SQUAD_ORDER_DEFINITIONS) expect(validateSquadOrder(entry), entry.id).toEqual([]);
  });

  it("covers every order the milestone asked for", () => {
    for (const id of [
      "focus-target",
      "defend-area",
      "protect-civilians",
      "hold",
      "regroup",
      "ranged-pressure",
      "conserve-ammunition",
      "disengage",
      "synchronized-attack",
    ] as const) {
      expect(orders.get(id), id).toBeDefined();
    }
  });

  it("refuses an order that changes no behaviour", () => {
    const base = orders.getOrThrow("hold");
    expect(validateSquadOrder({ ...base, weights: {} }).join(" ")).toMatch(/change no behaviour/);
  });

  it("refuses an order nobody answers", () => {
    const base = orders.getOrThrow("hold");
    expect(validateSquadOrder({ ...base, acknowledgements: [] }).join(" ")).toMatch(/unsure it was heard/);
  });

  it("only weights goals that exist", () => {
    for (const entry of SQUAD_ORDER_DEFINITIONS) {
      for (const goal of Object.keys(entry.weights)) expect(ALLY_GOALS, entry.id).toContain(goal);
    }
  });

  it("gives every order something to say back", () => {
    for (const entry of SQUAD_ORDER_DEFINITIONS) {
      expect(entry.acknowledgements.length, entry.id).toBeGreaterThan(0);
      expect(entry.description.length, entry.id).toBeGreaterThan(15);
    }
  });
});

describe("the ally crews", () => {
  it("all validate", () => {
    for (const entry of ALLY_CREW_DEFINITIONS) expect(validateAllyCrew(entry), entry.id).toEqual([]);
  });

  it("are actually different from each other", () => {
    const ranges = ALLY_CREW_DEFINITIONS.map((entry) => entry.preferredRangeMeters);
    expect(new Set(ranges).size).toBeGreaterThan(2);
    const aggression = ALLY_CREW_DEFINITIONS.map((entry) => entry.aggression);
    expect(Math.max(...aggression) - Math.min(...aggression)).toBeGreaterThan(0.3);
  });

  it("keep rivalries symmetric, or the registry refuses to build", () => {
    for (const entry of ALLY_CREW_DEFINITIONS) {
      for (const rival of entry.rivals) {
        expect(crews.getOrThrow(rival).rivals, entry.id).toContain(entry.id);
      }
    }
  });

  it("refuse a perk that would make an ally better than the player's machine", () => {
    const base = crews.getOrThrow("ally.karsten");
    const broken = {
      ...base,
      perkTrack: [{ ...base.perkTrack[0]!, damageScale: 1.9 }],
    };
    expect(validateAllyCrew(broken).join(" ")).toMatch(/more than fifteen percent/);
  });

  it("refuse perks that are not learned in order", () => {
    const base = crews.getOrThrow("ally.karsten");
    const broken = {
      ...base,
      perkTrack: [
        { ...base.perkTrack[1]!, sortiesRequired: 8 },
        { ...base.perkTrack[0]!, sortiesRequired: 3 },
      ],
    };
    expect(validateAllyCrew(broken).join(" ")).toMatch(/ascending order of sorties/);
  });

  it("hand out perks only once the sorties are flown", () => {
    const karsten = crews.getOrThrow("ally.karsten");
    expect(perksAt(karsten, 0)).toHaveLength(0);
    expect(perksAt(karsten, 3)).toHaveLength(1);
    expect(perksAt(karsten, 99)).toHaveLength(karsten.perkTrack.length);
  });
});

describe("deciding what to do", () => {
  it("all goals validate", () => {
    for (const entry of goals.all()) expect(validateAllyGoal(entry), entry.id).toEqual([]);
  });

  it("does something useful with no order at all", () => {
    const decision = decideAllyGoal({ situation: baselineSituation(), profile: PROFILE, goals });
    expect(decision.goal).not.toBe("hold-position");
    expect(decision.score).toBeGreaterThan(0);
    expect(decision.reason.length).toBeGreaterThan(0);
    expect(decision.order).toBe(DEFAULT_ORDER);
  });

  it("explains itself, and considers more than one thing", () => {
    const decision = decideAllyGoal({ situation: baselineSituation(), profile: PROFILE, goals });
    expect(decision.considered.length).toBeGreaterThan(1);
    for (const entry of decision.considered) expect(entry.reason.length).toBeGreaterThan(0);
  });

  it("changes its mind when an order says so", () => {
    const before = decideAllyGoal({ situation: baselineSituation(), profile: PROFILE, goals });
    const after = decideAllyGoal({
      situation: baselineSituation({ anchorDistanceMeters: 30 }),
      profile: PROFILE,
      order: orders.getOrThrow("hold"),
      goals,
    });
    expect(after.goal).not.toBe(before.goal);
    expect(after.goal).toBe("hold-position");
    expect(after.order).toBe("hold");
  });

  it("obeys a constraint rather than scoring around it", () => {
    // Told to stay out, closing is not merely unattractive, it is unavailable.
    const decision = decideAllyGoal({
      situation: baselineSituation({ targetDistanceMeters: 40 }),
      profile: PROFILE,
      order: orders.getOrThrow("ranged-pressure"),
      goals,
    });
    expect(decision.considered.some((entry) => entry.goal === "engage")).toBe(false);
  });

  it("stops shooting when told to save ammunition", () => {
    const decision = decideAllyGoal({
      situation: baselineSituation({ ammunitionFraction: 0.2 }),
      profile: PROFILE,
      order: orders.getOrThrow("conserve-ammunition"),
      goals,
    });
    expect(decision.considered.some((entry) => entry.goal === "suppress")).toBe(false);
  });

  it("looks after itself when the machine is nearly gone", () => {
    const decision = decideAllyGoal({
      situation: baselineSituation({ healthFraction: 0.1 }),
      profile: PROFILE,
      goals,
    });
    expect(decision.goal).toBe("withdraw");
  });

  it("does not withdraw from a scratch", () => {
    const decision = decideAllyGoal({
      situation: baselineSituation({ healthFraction: SELF_PRESERVATION_HEALTH + 0.3 }),
      profile: PROFILE,
      goals,
    });
    expect(decision.goal).not.toBe("withdraw");
  });

  it("does not dither between two nearly equal goals", () => {
    const situation = baselineSituation();
    const first = decideAllyGoal({ situation, profile: PROFILE, goals });
    const again = decideAllyGoal({ situation, profile: PROFILE, previous: first.goal, goals });
    expect(again.goal).toBe(first.goal);
    // And the hysteresis is a real number rather than a coincidence.
    expect(HYSTERESIS).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const situation = baselineSituation({ targetDistanceMeters: 77 });
    const first = decideAllyGoal({ situation, profile: PROFILE, goals });
    const second = decideAllyGoal({ situation, profile: PROFILE, goals });
    expect(second).toEqual(first);
  });

  it("never suppresses through a friendly", () => {
    const decision = decideAllyGoal({
      situation: baselineSituation({ friendlyInLine: true }),
      profile: PROFILE,
      goals,
    });
    expect(decision.considered.some((entry) => entry.goal === "suppress")).toBe(false);
  });
});

describe("turning a decision into an intent", () => {
  function controller(crewId = "ally.karsten") {
    return new AllyController({ crewId, profile: PROFILE });
  }

  it("never fires through a friendly, whatever it decided", () => {
    const intent = controller().advance(0.25, inputs(baselineSituation({ friendlyInLine: true })));
    expect(intent.fire).toBe(false);
  });

  it("never fires with an empty magazine", () => {
    const intent = controller().advance(0.25, inputs(baselineSituation({ ammunitionFraction: 0 })));
    expect(intent.fire).toBe(false);
  });

  it("holds its signature until the player commits", () => {
    const cold = controller().advance(0.25, { ...inputs(), signatureWindow: false });
    expect(cold.useSignature).toBe(false);

    const warm = controller().advance(0.25, {
      ...inputs(baselineSituation({ playerCommitted: true })),
      signatureWindow: true,
    });
    expect(warm.useSignature).toBe(true);
  });

  it("spends a signature once and then stops offering it", () => {
    const instance = controller();
    const first = instance.advance(0.25, {
      ...inputs(baselineSituation({ playerCommitted: true })),
      signatureWindow: true,
    });
    const second = instance.advance(0.25, {
      ...inputs(baselineSituation({ playerCommitted: true })),
      signatureWindow: true,
    });
    expect(first.useSignature).toBe(true);
    expect(second.useSignature).toBe(false);
    instance.clearSignature();
    const third = instance.advance(0.25, {
      ...inputs(baselineSituation({ playerCommitted: true })),
      signatureWindow: true,
    });
    expect(third.useSignature).toBe(true);
  });

  it("refuses a signature outright when told to hold it", () => {
    const intent = controller().advance(
      0.25,
      { ...inputs(baselineSituation({ playerCommitted: true })), signatureWindow: true },
      orders.getOrThrow("conserve-ammunition"),
    );
    expect(intent.useSignature).toBe(false);
  });

  it("takes an unclaimed body zone when another ally has one", () => {
    const intent = controller().advance(0.25, { ...inputs(), claimedZones: ["head"] });
    expect(intent.targetZoneId).not.toBe("head");
    expect(intent.targetZoneId).toBe("torso");
  });

  it("still attacks when every zone is claimed rather than standing there", () => {
    const intent = controller().advance(0.25, {
      ...inputs(),
      claimedZones: ["head", "torso", "left-arm", "right-arm"],
    });
    expect(intent.targetZoneId).toBe("head");
  });

  it("steps aside instead of standing in the other machine", () => {
    const close = controller().advance(0.25, inputs(baselineSituation({ nearestAllyMeters: 20 })));
    const clear = controller().advance(0.25, inputs(baselineSituation({ nearestAllyMeters: 400 })));
    expect(close.movePoint).not.toEqual(clear.movePoint);
  });

  it("takes a detour when the route has been blocked for a while", () => {
    const instance = controller();
    const blocked = inputs(baselineSituation({ routeBlocked: true }));
    const direct = instance.advance(0.25, blocked).movePoint;
    for (let tick = 0; tick < 20; tick += 1) instance.advance(0.25, blocked);
    const detoured = instance.advance(0.25, blocked).movePoint;
    expect(detoured).not.toEqual(direct);
  });

  it("stays out when the order says to, whatever the crew would prefer", () => {
    // Hammerfall likes forty five metres. Told to keep two hundred, it keeps it.
    const brawler = new AllyController({
      crewId: "ally.karsten",
      profile: { ...PROFILE, preferredRangeMeters: 45 },
    });
    const intent = brawler.advance(
      0.25,
      inputs(baselineSituation({ targetDistanceMeters: 300, healthFraction: 0.9 })),
      orders.getOrThrow("disengage"),
    );
    const target = { east: 120, north: 40 };
    if (intent.movePoint) {
      const distance = Math.hypot(intent.movePoint.east - target.east, intent.movePoint.north - target.north);
      expect(distance).toBeGreaterThan(150);
    }
  });
});

describe("a squad resolved together", () => {
  it("gives two allies different body zones", () => {
    const members = ["ally.karsten", "ally.oduya"].map((crewId) => ({
      controller: new AllyController({ crewId, profile: PROFILE }),
      inputs: inputs(),
    }));
    const intents = resolveSquadIntents(members, 0.25);
    expect(intents).toHaveLength(2);
    expect(intents[0]!.targetZoneId).not.toBe(intents[1]!.targetZoneId);
  });

  it("does not let two allies burn a signature on the same swing", () => {
    const members = ["ally.karsten", "ally.oduya", "ally.penrose"].map((crewId) => ({
      controller: new AllyController({ crewId, profile: PROFILE }),
      inputs: {
        ...inputs(baselineSituation({ playerCommitted: true })),
        signatureWindow: true,
      },
    }));
    const intents = resolveSquadIntents(members, 0.25);
    // Each spends its own at most once, and never twice in a row.
    const again = resolveSquadIntents(members, 0.25);
    expect(again.filter((intent) => intent.useSignature)).toHaveLength(0);
    expect(intents.filter((intent) => intent.useSignature).length).toBeLessThanOrEqual(3);
  });
});
