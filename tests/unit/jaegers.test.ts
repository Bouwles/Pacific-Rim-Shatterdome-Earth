import { describe, expect, it } from "vitest";
import { jaegerRegistry } from "../../src/data/jaegers";

describe("jaegerRegistry placeholder content", () => {
  it("registers the placeholder Jaeger with a valid mass budget", () => {
    const entry = jaegerRegistry.getOrThrow("placeholder-mk0");
    expect(entry.massBudget.massTons).toBeGreaterThan(0);
    expect(entry.massBudget.powerOutputMw).toBeGreaterThan(0);
    expect(entry.massBudget.coolingCapacity).toBeGreaterThanOrEqual(0);
    expect(entry.massBudget.coolingCapacity).toBeLessThanOrEqual(1);
  });
});
