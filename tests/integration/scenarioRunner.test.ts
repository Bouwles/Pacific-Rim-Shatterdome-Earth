import { describe, expect, it } from "vitest";
import {
  createScenarioRegistry,
  kernelSmokeScenario,
  runScenario,
  type Scenario,
} from "../../src/debug/scenarioRunner";
import { SPAWN_SCATTER, type SpawnScatterCommand } from "../../src/simulation/commands";

describe("deterministic scenario runner", () => {
  it("gives the same hash for repeated runs of the same scenario", () => {
    const first = runScenario(kernelSmokeScenario);
    const second = runScenario(kernelSmokeScenario);
    expect(first.hash).toBe(second.hash);
    expect(first.entityCount).toBe(second.entityCount);
  });

  it("reports the tick count, seed, and a live entity count that reflects the despawn", () => {
    const result = runScenario(kernelSmokeScenario);
    expect(result.ticks).toBe(kernelSmokeScenario.ticks);
    expect(result.seed).toBe(kernelSmokeScenario.seed);
    // 8 scattered + 4 scattered - 1 despawned.
    expect(result.entityCount).toBe(11);
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes hash when the seed changes but the commands do not", () => {
    const rerolled: Scenario = { ...kernelSmokeScenario, id: "kernel-smoke-alt", seed: 999 };
    expect(runScenario(rerolled).hash).not.toBe(runScenario(kernelSmokeScenario).hash);
  });

  it("changes hash when a command changes but the seed does not", () => {
    const heavier: SpawnScatterCommand = { type: SPAWN_SCATTER, schemaVersion: 1, count: 9, spread: 40 };
    const altered: Scenario = {
      ...kernelSmokeScenario,
      id: "kernel-smoke-heavier",
      commands: [{ atTick: 0, command: heavier }, ...kernelSmokeScenario.commands.slice(1)],
    };
    expect(runScenario(altered).hash).not.toBe(runScenario(kernelSmokeScenario).hash);
  });
});

describe("scenario registry validation", () => {
  it("registers the built-in scenario", () => {
    expect(createScenarioRegistry().getOrThrow("kernel-smoke").ticks).toBe(120);
  });

  it("rejects a scenario whose command is scheduled past its last tick", () => {
    const registry = createScenarioRegistry();
    const broken: Scenario = {
      id: "broken",
      description: "command scheduled beyond the run",
      seed: 1,
      ticks: 10,
      commands: [
        {
          atTick: 50,
          command: { type: SPAWN_SCATTER, schemaVersion: 1, count: 1, spread: 1 } as SpawnScatterCommand,
        },
      ],
    };
    expect(() => registry.register(broken)).toThrow(/scheduled past/);
  });

  it("rejects a scenario with a non-positive tick count", () => {
    const registry = createScenarioRegistry();
    expect(() =>
      registry.register({ id: "empty", description: "no ticks", seed: 1, ticks: 0, commands: [] }),
    ).toThrow(/ticks must be a positive integer/);
  });
});
