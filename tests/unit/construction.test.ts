import { describe, expect, it } from "vitest";
import {
  CANCELLATION_REFUND,
  ConstructionQueue,
  DEFAULT_PRIORITY,
  MAX_PRIORITY,
  describeShortfall,
  emptyConstructionSnapshot,
  validateConstructionSnapshot,
  workEffectiveness,
  type WorkCapacity,
} from "../../src/shatterdome/construction";
import {
  FACILITY_EFFECTS,
  FACILITY_KINDS,
  createFacilityRegistry,
  type FacilityKind,
} from "../../src/data/facilities";
import {
  describeEffects,
  effectValue,
  effectivenessOf,
  noEffects,
  resolveEffects,
} from "../../src/shatterdome/facilityEffects";

const definitions = createFacilityRegistry();

function queue(): ConstructionQueue {
  return new ConstructionQueue(definitions);
}

function tierOf(facilityId: FacilityKind, tier = 1) {
  return definitions.getOrThrow(facilityId).tiers[tier - 1]!;
}

function capacity(overrides: Partial<WorkCapacity> = {}): WorkCapacity {
  return { crewsAvailable: 2, powerFactor: 1, staffFactor: 1, rateMultiplier: 1, ...overrides };
}

describe("the facility table", () => {
  it("covers every branch the milestone asked for", () => {
    for (const kind of [
      "command",
      "jaeger-bay",
      "repair",
      "research",
      "manufacture",
      "reactor",
      "logistics",
      "training",
      "quarters",
      "defense",
      "archive",
      "contract",
      "launch",
      "medical",
      "kaiju-containment",
    ] as const) {
      expect(FACILITY_KINDS, kind).toContain(kind);
      expect(definitions.get(kind), kind).toBeDefined();
    }
  });

  it("gives every tier a cost, an upkeep and a stage to look at", () => {
    for (const definition of definitions.all()) {
      for (const tier of definition.tiers) {
        expect(tier.cost, `${definition.id} t${tier.tier}`).toBeGreaterThan(0);
        expect(tier.upkeepPerDay, `${definition.id} t${tier.tier}`).toBeGreaterThan(0);
        expect(tier.moduleSlots, `${definition.id} t${tier.tier}`).toBeGreaterThanOrEqual(1);
        expect(tier.stage.note.length, `${definition.id} t${tier.tier}`).toBeGreaterThan(10);
      }
    }
  });

  it("only names effects something in the game reads", () => {
    for (const definition of definitions.all()) {
      for (const tier of definition.tiers) {
        for (const effect of Object.keys(tier.effects)) {
          expect(FACILITY_EFFECTS, `${definition.id} t${tier.tier}`).toContain(effect);
        }
      }
    }
  });

  it("costs more and does more at every tier above the first", () => {
    for (const definition of definitions.all()) {
      for (let index = 1; index < definition.tiers.length; index += 1) {
        const lower = definition.tiers[index - 1]!;
        const upper = definition.tiers[index]!;
        expect(upper.cost, definition.id).toBeGreaterThan(lower.cost);
        expect(upper.constructionTicks, definition.id).toBeGreaterThan(lower.constructionTicks);
      }
    }
  });

  it("never asks for a facility that cannot be built, so no choice bricks a save", () => {
    // Every prerequisite has to name a real facility at a tier it actually has,
    // and nothing may require itself. A prerequisite chain that cannot be
    // satisfied is a permanently unreachable room, which is the failure mode
    // this milestone is not allowed to have.
    for (const definition of definitions.all()) {
      for (const tier of definition.tiers) {
        for (const requirement of tier.requires) {
          expect(requirement.facilityId, definition.id).not.toBe(definition.id);
          const other = definitions.get(requirement.facilityId);
          expect(other, `${definition.id} requires ${requirement.facilityId}`).toBeDefined();
          expect(
            other!.tiers.length,
            `${definition.id} requires ${requirement.facilityId}`,
          ).toBeGreaterThanOrEqual(requirement.tier);
        }
      }
    }
  });

  it("has no prerequisite cycles, so everything is reachable from an empty complex", () => {
    // Walk the graph: start with what is standing at the beginning, then keep
    // adding anything whose prerequisites are met. Everything must be reachable.
    const built = new Map<FacilityKind, number>();
    for (const definition of definitions.all()) {
      if (definition.startsBuilt) built.set(definition.id, 1);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const definition of definitions.all()) {
        const have = built.get(definition.id) ?? 0;
        const next = definition.tiers[have];
        if (!next) continue;
        const satisfied = next.requires.every((need) => (built.get(need.facilityId) ?? 0) >= need.tier);
        if (!satisfied) continue;
        built.set(definition.id, next.tier);
        changed = true;
      }
    }
    for (const definition of definitions.all()) {
      expect(built.get(definition.id), `${definition.id} is unreachable`).toBe(definition.tiers.length);
    }
  });
});

describe("queueing work", () => {
  it("takes an order and reports it queued", () => {
    const instance = queue();
    const result = instance.enqueue("medical", tierOf("medical"));
    expect(result.ok).toBe(true);
    expect(instance.live()).toHaveLength(1);
    expect(instance.live()[0]!.status).toBe("queued");
    expect(instance.live()[0]!.priority).toBe(DEFAULT_PRIORITY);
  });

  it("refuses a second order for the same facility, with a remedy", () => {
    const instance = queue();
    instance.enqueue("medical", tierOf("medical"));
    const second = instance.enqueue("medical", tierOf("medical"));
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toMatch(/already has work queued/);
      expect(second.remedy.length).toBeGreaterThan(0);
    }
  });

  it("works the most urgent first whatever order things were queued in", () => {
    const instance = queue();
    instance.enqueue("medical", tierOf("medical"), { priority: 9 });
    instance.enqueue("contract", tierOf("contract"), { priority: 1 });
    // Only one crew, so only the urgent one can be worked.
    instance.advance(1, capacity({ crewsAvailable: 1 }));
    const active = instance.live().filter((project) => project.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0]!.facilityId).toBe("contract");
  });

  it("changes its mind on the next tick, not after the current job", () => {
    const instance = queue();
    const first = instance.enqueue("medical", tierOf("medical"), { priority: 1 });
    const second = instance.enqueue("contract", tierOf("contract"), { priority: 9 });
    expect(first.ok && second.ok).toBe(true);
    instance.advance(1, capacity({ crewsAvailable: 1 }));
    expect(instance.live().find((p) => p.facilityId === "medical")!.status).toBe("active");

    if (second.ok) instance.setPriority(second.project.id, 1);
    if (first.ok) instance.setPriority(first.project.id, 9);
    instance.advance(1, capacity({ crewsAvailable: 1 }));
    expect(instance.live().find((p) => p.facilityId === "contract")!.status).toBe("active");
    expect(instance.live().find((p) => p.facilityId === "medical")!.status).toBe("queued");
  });

  it("clamps a priority rather than accepting nonsense", () => {
    const instance = queue();
    const result = instance.enqueue("medical", tierOf("medical"), { priority: 999 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.priority).toBe(MAX_PRIORITY);
  });
});

describe("pausing and cancelling", () => {
  it("keeps the progress and gives the crews back", () => {
    const instance = queue();
    const result = instance.enqueue("medical", tierOf("medical"));
    instance.advance(2_000, capacity());
    const before = instance.live()[0]!.workRemainingTicks;
    expect(before).toBeLessThan(instance.live()[0]!.workTotalTicks);

    if (result.ok) expect(instance.pause(result.project.id)).toBe(true);
    const paused = instance.live()[0]!;
    expect(paused.status).toBe("paused");
    expect(paused.crewsHeld).toBe(0);

    // Time passing does nothing to a paused project.
    instance.advance(5_000, capacity());
    expect(instance.live()[0]!.workRemainingTicks).toBe(before);

    if (result.ok) expect(instance.resume(result.project.id)).toBe(true);
    instance.advance(500, capacity());
    expect(instance.live()[0]!.workRemainingTicks).toBeLessThan(before);
  });

  it("frees a crew for the next thing while it is paused", () => {
    const instance = queue();
    const first = instance.enqueue("medical", tierOf("medical"), { priority: 1 });
    instance.enqueue("contract", tierOf("contract"), { priority: 5 });
    instance.advance(1, capacity({ crewsAvailable: 1 }));
    expect(instance.live().find((p) => p.facilityId === "contract")!.status).toBe("queued");

    if (first.ok) instance.pause(first.project.id);
    instance.advance(1, capacity({ crewsAvailable: 1 }));
    expect(instance.live().find((p) => p.facilityId === "contract")!.status).toBe("active");
  });

  it("refunds what was not spent yet, by the same policy every time", () => {
    const instance = queue();
    const result = instance.enqueue("medical", tierOf("medical"));
    const cost = tierOf("medical").cost;
    const cancelled = instance.cancel(result.ok ? result.project.id : "");
    expect(cancelled.ok).toBe(true);
    // Nothing done yet, so nearly all of it comes back, but never all.
    expect(cancelled.refund).toBe(Math.round(cost * CANCELLATION_REFUND));
    expect(cancelled.refund).toBeLessThan(cost);
    expect(instance.live()).toHaveLength(0);
  });

  it("refunds less the further along it was", () => {
    const early = queue();
    const late = queue();
    const a = early.enqueue("medical", tierOf("medical"));
    const b = late.enqueue("medical", tierOf("medical"));
    late.advance(3_000, capacity());
    const earlyRefund = early.cancel(a.ok ? a.project.id : "").refund;
    const lateRefund = late.cancel(b.ok ? b.project.id : "").refund;
    expect(lateRefund).toBeLessThan(earlyRefund);
  });

  it("refuses to cancel what is already settled", () => {
    const instance = queue();
    const result = instance.enqueue("medical", tierOf("medical"));
    instance.cancel(result.ok ? result.project.id : "");
    const again = instance.cancel(result.ok ? result.project.id : "");
    expect(again.ok).toBe(false);
    expect(again.refund).toBe(0);
  });
});

describe("finishing", () => {
  it("completes and says what was built", () => {
    const instance = queue();
    instance.enqueue("medical", tierOf("medical"));
    let completed: readonly { facilityId: string; tierName: string }[] = [];
    for (let tick = 0; tick < 40 && completed.length === 0; tick += 1) {
      completed = instance.advance(500, capacity());
    }
    expect(completed).toHaveLength(1);
    expect(completed[0]!.facilityId).toBe("medical");
    expect(completed[0]!.tierName).toBe("Infirmary");
    expect(instance.live()).toHaveLength(0);
  });

  it("forecasts a finish time that counts what is ahead of it", () => {
    const instance = queue();
    instance.enqueue("medical", tierOf("medical"), { priority: 1 });
    instance.enqueue("contract", tierOf("contract"), { priority: 5 });
    const forecast = instance.forecast(capacity({ crewsAvailable: 1 }));
    const first = forecast.find((entry) => entry.facilityId === "medical")!;
    const second = forecast.find((entry) => entry.facilityId === "contract")!;
    expect(first.etaMinutes).toBeGreaterThan(0);
    expect(second.etaTicks).toBeGreaterThan(first.etaTicks);
    expect(second.stalledBecause).toMatch(/Waiting for/);
  });
});

describe("a complex that is short", () => {
  it("builds slower on half power rather than stopping", () => {
    const full = workEffectiveness(capacity());
    const half = workEffectiveness(capacity({ powerFactor: 0.5 }));
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(full);
  });

  it("stops only when there is no power at all, and says so", () => {
    const dark = capacity({ powerFactor: 0 });
    expect(workEffectiveness(dark)).toBe(0);
    expect(describeShortfall(dark)).toMatch(/cannot carry the complex/);
  });

  it("keeps working with nobody posted, just slowly", () => {
    const empty = capacity({ staffFactor: 0 });
    expect(workEffectiveness(empty)).toBeGreaterThan(0);
    expect(describeShortfall(empty)).toMatch(/percent of the posts filled/);
  });

  it("says nothing when everything is fine", () => {
    expect(describeShortfall(capacity())).toBeNull();
  });

  it("makes no progress at all in a blackout, without throwing", () => {
    const instance = queue();
    instance.enqueue("medical", tierOf("medical"));
    const before = instance.live()[0]!.workRemainingTicks;
    instance.advance(5_000, capacity({ powerFactor: 0 }));
    expect(instance.live()[0]!.workRemainingTicks).toBe(before);
    expect(instance.forecast(capacity({ powerFactor: 0 }))[0]!.stalledBecause).toMatch(/Nothing is moving/);
  });
});

describe("what the complex is worth", () => {
  it("is exactly one when nothing is built", () => {
    const totals = resolveEffects([], definitions, { powerFactor: 1, staffFactor: 1 });
    for (const effect of FACILITY_EFFECTS) expect(totals[effect]).toBe(1);
    expect(describeEffects(totals)).toHaveLength(0);
  });

  it("adds up across facilities", () => {
    const totals = resolveEffects(
      [
        { facilityId: "repair", tier: 1, operational: true },
        { facilityId: "manufacture", tier: 1, operational: true },
      ],
      definitions,
      { powerFactor: 1, staffFactor: 1 },
    );
    // Both help repairs, so the pair is worth more than either alone.
    expect(effectValue(totals, "repairRate")).toBeGreaterThan(1.35);
  });

  it("is worth more at a higher tier", () => {
    const low = resolveEffects([{ facilityId: "repair", tier: 1, operational: true }], definitions, {
      powerFactor: 1,
      staffFactor: 1,
    });
    const high = resolveEffects([{ facilityId: "repair", tier: 2, operational: true }], definitions, {
      powerFactor: 1,
      staffFactor: 1,
    });
    expect(effectValue(high, "repairRate")).toBeGreaterThan(effectValue(low, "repairRate"));
  });

  it("gives less of the upgrade when the complex is short, but never none of it", () => {
    const standings = [{ facilityId: "repair" as FacilityKind, tier: 2, operational: true }];
    const full = resolveEffects(standings, definitions, { powerFactor: 1, staffFactor: 1 });
    const short = resolveEffects(standings, definitions, { powerFactor: 0.5, staffFactor: 0.5 });
    expect(effectValue(short, "repairRate")).toBeLessThan(effectValue(full, "repairRate"));
    expect(effectValue(short, "repairRate")).toBeGreaterThan(1);
  });

  it("scales power harder than staffing, because a dark room is useless", () => {
    const noPower = effectivenessOf({ powerFactor: 0, staffFactor: 1 });
    const noStaff = effectivenessOf({ powerFactor: 1, staffFactor: 0 });
    expect(noPower).toBeLessThan(noStaff);
  });

  it("lists only the effects that are doing something", () => {
    const totals = resolveEffects([{ facilityId: "repair", tier: 1, operational: true }], definitions, {
      powerFactor: 1,
      staffFactor: 1,
    });
    const lines = describeEffects(totals);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(" ")).toMatch(/Repair work/);
    expect(lines.join(" ")).not.toMatch(/Coastal defence/);
  });

  it("answers one for an effect nothing provides", () => {
    expect(effectValue(noEffects(), "defenceStrength")).toBe(1);
  });
});

describe("the queue across a save", () => {
  it("brings back what was outstanding, and its priorities", () => {
    const instance = queue();
    const first = instance.enqueue("medical", tierOf("medical"), { priority: 2 });
    instance.enqueue("contract", tierOf("contract"), { priority: 7 });
    instance.advance(1_500, capacity());
    if (first.ok) instance.pause(first.project.id);

    const restored = queue();
    restored.restore(instance.snapshot());
    expect(restored.live()).toHaveLength(2);
    const medical = restored.live().find((project) => project.facilityId === "medical")!;
    expect(medical.priority).toBe(2);
    expect(medical.status).toBe("paused");
    expect(medical.workRemainingTicks).toBeLessThan(medical.workTotalTicks);
  });

  it("never brings a project back mid-tick holding crews", () => {
    const instance = queue();
    instance.enqueue("medical", tierOf("medical"));
    instance.advance(500, capacity());
    expect(instance.live()[0]!.status).toBe("active");

    const restored = queue();
    restored.restore(instance.snapshot());
    expect(restored.live()[0]!.status).toBe("queued");
    expect(restored.live()[0]!.crewsHeld).toBe(0);
  });

  it("drops a facility this build no longer has", () => {
    const instance = queue();
    instance.enqueue("medical", tierOf("medical"));
    const snapshot = instance.snapshot();
    const tampered = {
      ...snapshot,
      projects: snapshot.projects.map((project) => ({ ...project, facilityId: "nonsense" as FacilityKind })),
    };
    const restored = queue();
    restored.restore(tampered);
    expect(restored.live()).toHaveLength(0);
  });

  it("refuses a snapshot that is not one", () => {
    expect(validateConstructionSnapshot(null).length).toBeGreaterThan(0);
    expect(validateConstructionSnapshot({ ...emptyConstructionSnapshot(), schemaVersion: 99 })).toHaveLength(
      1,
    );
    expect(validateConstructionSnapshot(emptyConstructionSnapshot())).toEqual([]);
  });
});
