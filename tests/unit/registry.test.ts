import { describe, expect, it } from "vitest";
import { ContentRegistry } from "../../src/data/registry";

interface Widget {
  id: string;
  weight: number;
}

describe("ContentRegistry", () => {
  it("registers and retrieves entries by id", () => {
    const registry = new ContentRegistry<Widget>();
    registry.register({ id: "a", weight: 1 });
    expect(registry.get("a")).toEqual({ id: "a", weight: 1 });
    expect(registry.has("a")).toBe(true);
    expect(registry.has("missing")).toBe(false);
  });

  it("rejects duplicate ids", () => {
    const registry = new ContentRegistry<Widget>();
    registry.register({ id: "a", weight: 1 });
    expect(() => registry.register({ id: "a", weight: 2 })).toThrow(/Duplicate/);
  });

  it("runs the validator and rejects invalid entries with an actionable message", () => {
    const registry = new ContentRegistry<Widget>((entry) =>
      entry.weight <= 0 ? ["weight must be > 0"] : [],
    );
    expect(() => registry.register({ id: "bad", weight: -1 })).toThrow(/weight must be > 0/);
    expect(registry.has("bad")).toBe(false);
  });

  it("getOrThrow throws for unknown ids", () => {
    const registry = new ContentRegistry<Widget>();
    expect(() => registry.getOrThrow("nope")).toThrow(/Unknown registry id/);
  });

  it("all() returns every registered entry", () => {
    const registry = new ContentRegistry<Widget>();
    registry.register({ id: "a", weight: 1 });
    registry.register({ id: "b", weight: 2 });
    expect(
      registry
        .all()
        .map((e) => e.id)
        .sort(),
    ).toEqual(["a", "b"]);
  });
});
