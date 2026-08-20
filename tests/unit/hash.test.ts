import { describe, expect, it } from "vitest";
import { hashState } from "../../src/simulation/hash";

describe("hashState", () => {
  it("is stable for identical structures", () => {
    const value = { tick: 12, entities: [{ id: 1, x: 1.5 }] };
    expect(hashState(value)).toBe(hashState(structuredClone(value)));
  });

  it("ignores key insertion order", () => {
    expect(hashState({ a: 1, b: 2 })).toBe(hashState({ b: 2, a: 1 }));
  });

  it("changes when any value changes", () => {
    const base = hashState({ tick: 12, x: 1.5 });
    expect(hashState({ tick: 13, x: 1.5 })).not.toBe(base);
    expect(hashState({ tick: 12, x: 1.5000001 })).not.toBe(base);
  });

  it("respects array order", () => {
    expect(hashState([1, 2, 3])).not.toBe(hashState([3, 2, 1]));
  });

  it("distinguishes types that stringify alike", () => {
    expect(hashState("1")).not.toBe(hashState(1));
    expect(hashState(null)).not.toBe(hashState("null"));
    expect(hashState({ a: [1] })).not.toBe(hashState({ a: 1 }));
  });

  it("treats -0 and 0 as the same simulation value", () => {
    expect(hashState({ x: -0 })).toBe(hashState({ x: 0 }));
  });

  it("rejects undefined and non-serializable values with an actionable path", () => {
    expect(() => hashState({ nested: { bad: undefined } })).toThrow(/\$\.nested\.bad/);
    expect(() => hashState({ fn: () => 1 })).toThrow(/not serializable/);
    expect(() => hashState(undefined)).toThrow(/not serializable/);
  });

  it("produces a 16-hex-character digest", () => {
    expect(hashState({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });
});
