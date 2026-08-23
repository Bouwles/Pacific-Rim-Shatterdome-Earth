import { describe, expect, it } from "vitest";
import {
  BASE_CREW_CAPACITY,
  CONNECTION_SECONDS,
  FACILITY_CONNECTIONS,
  FACILITY_DEFINITIONS,
  FACILITY_KINDS,
  createFacilityRegistry,
  validateConnections,
  validateFacility,
  type FacilityDefinition,
} from "../../src/data/facilities";

const registry = createFacilityRegistry();

function withTiers(overrides: Partial<FacilityDefinition>): FacilityDefinition {
  const base = FACILITY_DEFINITIONS.find((entry) => entry.id === "archive");
  if (!base) throw new Error("archive definition missing");
  return { ...base, ...overrides };
}

describe("facility grammar", () => {
  it("registers every facility the spec names", () => {
    expect(registry.all()).toHaveLength(FACILITY_KINDS.length);
    for (const kind of FACILITY_KINDS) expect(registry.has(kind)).toBe(true);
  });

  it("gives every facility a terminal, so nothing is only reachable from a menu", () => {
    for (const definition of registry.all()) {
      expect(definition.stations.some((station) => station.kind === "terminal")).toBe(true);
    }
  });

  it("refuses a facility with no terminal", () => {
    const errors = validateFacility(
      withTiers({ stations: [{ kind: "staff-post", label: "Desk", count: 1 }] }),
    );
    expect(errors.join(" ")).toMatch(/terminal/);
  });

  it("refuses an upgrade that shows nothing new", () => {
    const base = FACILITY_DEFINITIONS.find((entry) => entry.id === "command");
    if (!base) throw new Error("command definition missing");
    const tierOne = base.tiers[0];
    if (!tierOne) throw new Error("command tier 1 missing");
    const errors = validateFacility({
      ...base,
      tiers: [tierOne, { ...tierOne, tier: 2, constructionTicks: tierOne.constructionTicks + 1 }],
    });
    expect(errors.join(" ")).toMatch(/must add fixtures/);
  });

  it("refuses a room a person cannot stand up in", () => {
    expect(validateFacility(withTiers({ heightMeters: 2 })).join(" ")).toMatch(/headroom/);
  });

  it("lets only the reactor produce power", () => {
    const producers = registry.all().filter((entry) => entry.tiers.some((tier) => tier.powerOutputMw > 0));
    expect(producers.map((entry) => entry.id)).toEqual(["reactor"]);
  });

  it("builds the Jaeger bay at Jaeger scale and everything else at human scale", () => {
    const bay = registry.getOrThrow("jaeger-bay");
    const command = registry.getOrThrow("command");
    // A 75 m machine has to fit, and a command floor must not read as a hangar.
    expect(bay.heightMeters).toBeGreaterThan(90);
    expect(command.heightMeters).toBeLessThan(12);
  });

  it("makes every tier cost more time than the one below it", () => {
    for (const definition of registry.all()) {
      for (let index = 1; index < definition.tiers.length; index += 1) {
        const previous = definition.tiers[index - 1];
        const tier = definition.tiers[index];
        expect(tier?.constructionTicks ?? 0).toBeGreaterThan(previous?.constructionTicks ?? 0);
      }
    }
  });

  it("starts a campaign with a complex that can run and one that has room to grow", () => {
    const built = registry.all().filter((entry) => entry.startsBuilt);
    const absent = registry.all().filter((entry) => !entry.startsBuilt);
    expect(built.map((entry) => entry.id)).toContain("command");
    expect(built.map((entry) => entry.id)).toContain("jaeger-bay");
    expect(absent.length).toBeGreaterThan(3);
  });

  it("starts with a reactor that can carry what is already standing", () => {
    let output = 0;
    let draw = 0;
    for (const definition of registry.all()) {
      if (!definition.startsBuilt) continue;
      const tier = definition.tiers[0];
      output += tier?.powerOutputMw ?? 0;
      draw += tier?.powerDrawMw ?? 0;
    }
    expect(draw).toBeLessThanOrEqual(output);
    // And not so much headroom that power is never a decision.
    expect(output - draw).toBeLessThan(output * 0.5);
  });
});

describe("connection graph", () => {
  it("validates and leaves no facility unreachable", () => {
    expect(validateConnections(FACILITY_CONNECTIONS, new Set(FACILITY_KINDS))).toEqual([]);
  });

  it("names an unknown endpoint rather than silently dropping it", () => {
    const errors = validateConnections(
      [{ from: "command", to: "canteen" as never, kind: "door" }],
      new Set(FACILITY_KINDS),
    );
    expect(errors.join(" ")).toMatch(/canteen/);
  });

  it("rejects a duplicate edge", () => {
    const errors = validateConnections(
      [
        { from: "command", to: "research", kind: "door" },
        { from: "research", to: "command", kind: "lift" },
      ],
      new Set(["command", "research"]),
    );
    expect(errors.join(" ")).toMatch(/duplicate/);
  });

  it("uses all three travel kinds, and a tram takes longer than a door", () => {
    const kinds = new Set(FACILITY_CONNECTIONS.map((connection) => connection.kind));
    expect([...kinds].sort()).toEqual(["door", "lift", "tram"]);
    expect(CONNECTION_SECONDS.tram).toBeGreaterThan(CONNECTION_SECONDS.lift);
    expect(CONNECTION_SECONDS.lift).toBeGreaterThan(CONNECTION_SECONDS.door);
  });

  it("keeps every lift between different decks and every door on one", () => {
    const deckOf = new Map(registry.all().map((entry) => [entry.id, entry.deck]));
    for (const connection of FACILITY_CONNECTIONS) {
      const from = deckOf.get(connection.from) ?? 0;
      const to = deckOf.get(connection.to) ?? 0;
      if (connection.kind === "door") expect(from).toBe(to);
      if (connection.kind === "lift") expect(from).not.toBe(to);
    }
  });

  it("starts with enough crews to build something and few enough to matter", () => {
    expect(BASE_CREW_CAPACITY).toBeGreaterThan(0);
    expect(BASE_CREW_CAPACITY).toBeLessThan(4);
  });
});
