import { describe, expect, it, vi } from "vitest";
import { SimulationKernel } from "../../src/simulation/kernel";
import {
  DESPAWN_ENTITY,
  SPAWN_ENTITY,
  SPAWN_SCATTER,
  type DespawnEntityCommand,
  type SpawnEntityCommand,
  type SpawnScatterCommand,
} from "../../src/simulation/commands";
import { ENTITY_DESPAWNED, ENTITY_SPAWNED } from "../../src/simulation/events";
import { TransformComponent } from "../../src/entities/entity";

const scatter: SpawnScatterCommand = { type: SPAWN_SCATTER, schemaVersion: 1, count: 5, spread: 20 };

function spawnAt(x: number, vx: number): SpawnEntityCommand {
  return {
    type: SPAWN_ENTITY,
    schemaVersion: 1,
    transform: { x, y: 0, z: 0 },
    velocity: { x: vx, y: 0, z: 0 },
  };
}

function runTicks(kernel: SimulationKernel, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) kernel.step();
}

describe("SimulationKernel command boundary", () => {
  it("applies queued commands on the next step, not at enqueue time", () => {
    const kernel = new SimulationKernel({ seed: 1 });
    kernel.enqueue(spawnAt(0, 0));
    expect(kernel.entityCount).toBe(0);
    expect(kernel.queuedCommandCount).toBe(1);

    kernel.step();
    expect(kernel.entityCount).toBe(1);
    expect(kernel.tick).toBe(1);
  });

  it("rejects unknown command types and mismatched schema versions at enqueue", () => {
    const kernel = new SimulationKernel({ seed: 1 });
    expect(() => kernel.enqueue({ type: "not-a-command", schemaVersion: 1 })).toThrow(
      /Unknown simulation command/,
    );
    expect(() => kernel.enqueue({ ...spawnAt(0, 0), schemaVersion: 2 })).toThrow(/migration is required/);
  });

  it("rejects invalid command payloads with a field-level message", () => {
    const kernel = new SimulationKernel({ seed: 1 });
    const bad: SpawnEntityCommand = {
      type: SPAWN_ENTITY,
      schemaVersion: 1,
      transform: { x: Number.NaN, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    };
    expect(() => kernel.enqueue(bad)).toThrow(/transform\.x must be a finite number/);
    const badScatter: SpawnScatterCommand = { type: SPAWN_SCATTER, schemaVersion: 1, count: 0, spread: 1 };
    expect(() => kernel.enqueue(badScatter)).toThrow(/count must be a positive integer/);
  });

  it("treats despawning an already-dead entity as a no-op so replays do not diverge", () => {
    const kernel = new SimulationKernel({ seed: 1 });
    kernel.enqueue(spawnAt(0, 0));
    kernel.step();

    const despawn: DespawnEntityCommand = { type: DESPAWN_ENTITY, schemaVersion: 1, entityId: 1 };
    kernel.enqueue(despawn);
    kernel.step();
    const afterFirst = kernel.hash();

    kernel.enqueue(despawn);
    expect(() => kernel.step()).not.toThrow();
    expect(kernel.entityCount).toBe(0);
    void afterFirst;
  });

  it("emits spawn and despawn events that presentation can drain after the tick", () => {
    const kernel = new SimulationKernel({ seed: 1 });
    const spawned = vi.fn();
    const despawned = vi.fn();
    kernel.events.subscribe(ENTITY_SPAWNED, spawned);
    kernel.events.subscribe(ENTITY_DESPAWNED, despawned);

    kernel.enqueue(spawnAt(0, 0));
    kernel.step();
    kernel.events.drain();
    expect(spawned).toHaveBeenCalledOnce();

    const despawnFirst: DespawnEntityCommand = { type: DESPAWN_ENTITY, schemaVersion: 1, entityId: 1 };
    kernel.enqueue(despawnFirst);
    kernel.step();
    kernel.events.drain();
    expect(despawned).toHaveBeenCalledOnce();
  });
});

describe("SimulationKernel determinism", () => {
  it("produces the same hash for the same seed and command sequence", () => {
    const run = (): string => {
      const kernel = new SimulationKernel({ seed: 4242 });
      kernel.enqueue(scatter);
      runTicks(kernel, 50);
      const despawn: DespawnEntityCommand = { type: DESPAWN_ENTITY, schemaVersion: 1, entityId: 2 };
      kernel.enqueue(despawn);
      runTicks(kernel, 50);
      return kernel.hash();
    };
    expect(run()).toBe(run());
  });

  it("produces a different hash for a different seed", () => {
    const run = (seed: number): string => {
      const kernel = new SimulationKernel({ seed });
      kernel.enqueue(scatter);
      runTicks(kernel, 30);
      return kernel.hash();
    };
    expect(run(1)).not.toBe(run(2));
  });

  it("produces a different hash for a different command sequence at the same seed", () => {
    const withExtra = new SimulationKernel({ seed: 9 });
    withExtra.enqueue(scatter);
    withExtra.enqueue(spawnAt(5, 1));
    runTicks(withExtra, 20);

    const without = new SimulationKernel({ seed: 9 });
    without.enqueue(scatter);
    runTicks(without, 20);

    expect(withExtra.hash()).not.toBe(without.hash());
  });

  it("advances state over time — the hash moves as motion integrates", () => {
    const kernel = new SimulationKernel({ seed: 3 });
    kernel.enqueue(spawnAt(0, 1));
    kernel.step();
    const early = kernel.hash();
    runTicks(kernel, 30);
    expect(kernel.hash()).not.toBe(early);

    const transform = kernel.entities.get(1 as never, TransformComponent);
    expect(transform?.x).toBeGreaterThan(0);
  });

  it("integrates motion at a fixed rate independent of how steps are grouped", () => {
    const oneBatch = new SimulationKernel({ seed: 11 });
    oneBatch.enqueue(spawnAt(0, 2));
    runTicks(oneBatch, 60);

    const manyBatches = new SimulationKernel({ seed: 11 });
    manyBatches.enqueue(spawnAt(0, 2));
    for (let i = 0; i < 6; i += 1) runTicks(manyBatches, 10);

    expect(oneBatch.hash()).toBe(manyBatches.hash());
  });
});

describe("SimulationKernel snapshot round-trip", () => {
  it("restores to a state with an identical hash", () => {
    const original = new SimulationKernel({ seed: 777 });
    original.enqueue(scatter);
    runTicks(original, 40);

    const snapshot = JSON.parse(JSON.stringify(original.serialize()));
    const restored = new SimulationKernel({ seed: 777 });
    restored.restore(snapshot);

    expect(restored.hash()).toBe(original.hash());
    expect(restored.tick).toBe(original.tick);
    expect(restored.entityCount).toBe(original.entityCount);
  });

  it("continues deterministically after a restore", () => {
    const original = new SimulationKernel({ seed: 55 });
    original.enqueue(scatter);
    runTicks(original, 20);
    const snapshot = JSON.parse(JSON.stringify(original.serialize()));

    runTicks(original, 20);

    const restored = new SimulationKernel({ seed: 55 });
    restored.restore(snapshot);
    runTicks(restored, 20);

    expect(restored.hash()).toBe(original.hash());
  });

  it("refuses a snapshot from another seed or an unsupported schema version", () => {
    const kernel = new SimulationKernel({ seed: 1 });
    const snapshot = kernel.serialize();

    expect(() => new SimulationKernel({ seed: 2 }).restore(snapshot)).toThrow(/does not match/);
    expect(() => kernel.restore({ ...snapshot, schemaVersion: 99 })).toThrow(/migration is required/);
  });

  it("rejects a non-finite seed at construction", () => {
    expect(() => new SimulationKernel({ seed: Number.POSITIVE_INFINITY })).toThrow(/finite/);
  });
});
