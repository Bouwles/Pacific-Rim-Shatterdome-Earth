import { describe, expect, it } from "vitest";
import { RngStreams, hashStringToSeed } from "../../src/simulation/rng";

describe("RngStreams", () => {
  it("reproduces the same sequence for the same master seed and stream name", () => {
    const a = new RngStreams(1234).stream("attackDirector");
    const b = new RngStreams(1234).stream("attackDirector");
    const seqA = Array.from({ length: 16 }, () => a());
    const seqB = Array.from({ length: 16 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("gives different subsystems different sequences from one master seed", () => {
    const streams = new RngStreams(1234);
    const weather = Array.from({ length: 16 }, () => streams.stream("weather")());
    const salvage = Array.from({ length: 16 }, () => streams.stream("salvage")());
    expect(weather).not.toEqual(salvage);
  });

  it("keeps streams independent — draining one never shifts another", () => {
    const undisturbed = new RngStreams(99);
    const expected = Array.from({ length: 8 }, () => undisturbed.stream("weather")());

    const disturbed = new RngStreams(99);
    // Heavy unrelated use of a different subsystem must not move `weather` at all.
    for (let i = 0; i < 500; i += 1) disturbed.stream("mutations")();
    const actual = Array.from({ length: 8 }, () => disturbed.stream("weather")());

    expect(actual).toEqual(expected);
  });

  it("returns the same stream instance for repeated lookups, so it keeps advancing", () => {
    const streams = new RngStreams(7);
    const first = streams.stream("spawn")();
    const second = streams.stream("spawn")();
    expect(first).not.toBe(second);
  });

  it("rejects an empty stream name and a non-finite master seed", () => {
    expect(() => new RngStreams(7).stream("")).toThrow(/non-empty/);
    expect(() => new RngStreams(Number.NaN)).toThrow(/finite/);
  });

  it("reports active stream names sorted, for diagnostics", () => {
    const streams = new RngStreams(5);
    streams.stream("weather");
    streams.stream("attackDirector");
    expect(streams.activeStreamNames()).toEqual(["attackDirector", "weather"]);
  });
});

describe("hashStringToSeed", () => {
  it("is stable and distinguishes similar names", () => {
    expect(hashStringToSeed("weather")).toBe(hashStringToSeed("weather"));
    expect(hashStringToSeed("weather")).not.toBe(hashStringToSeed("weathe"));
  });
});
