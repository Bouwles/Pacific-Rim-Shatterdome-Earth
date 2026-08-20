import { ContentRegistry, type RegistryEntry } from "../data/registry";
import {
  SPAWN_SCATTER,
  DESPAWN_ENTITY,
  type DespawnEntityCommand,
  type SimCommand,
  type SpawnScatterCommand,
} from "../simulation/commands";
import { SimulationKernel } from "../simulation/kernel";

export interface ScheduledCommand {
  /** Tick index the command is enqueued before; it takes effect on that tick. */
  readonly atTick: number;
  readonly command: SimCommand;
}

export interface Scenario extends RegistryEntry {
  readonly id: string;
  readonly description: string;
  readonly seed: number;
  readonly ticks: number;
  readonly commands: readonly ScheduledCommand[];
}

export interface ScenarioResult {
  readonly scenarioId: string;
  readonly seed: number;
  readonly ticks: number;
  readonly entityCount: number;
  readonly hash: string;
}

/**
 * Runs a scenario headlessly and digests the final state. Two runs of the same
 * scenario must produce the same hash; a diff means determinism broke somewhere.
 */
export function runScenario(scenario: Scenario): ScenarioResult {
  const kernel = new SimulationKernel({ seed: scenario.seed });
  try {
    for (let tick = 0; tick < scenario.ticks; tick += 1) {
      for (const scheduled of scenario.commands) {
        if (scheduled.atTick === tick) kernel.enqueue(scheduled.command);
      }
      kernel.step();
      // Events are drained, not left to grow unbounded; nothing subscribes here.
      kernel.events.drain();
    }
    return {
      scenarioId: scenario.id,
      seed: scenario.seed,
      ticks: scenario.ticks,
      entityCount: kernel.entityCount,
      hash: kernel.hash(),
    };
  } finally {
    kernel.dispose();
  }
}

export function createScenarioRegistry(): ContentRegistry<Scenario> {
  const registry = new ContentRegistry<Scenario>((entry) => {
    const errors: string[] = [];
    if (!entry.id) errors.push("scenario id required");
    if (!Number.isInteger(entry.ticks) || entry.ticks <= 0) errors.push("ticks must be a positive integer");
    if (!Number.isFinite(entry.seed)) errors.push("seed must be finite");
    for (const scheduled of entry.commands) {
      if (!Number.isInteger(scheduled.atTick) || scheduled.atTick < 0) {
        errors.push(`command "${scheduled.command.type}" has an invalid atTick`);
      }
      if (scheduled.atTick >= entry.ticks) {
        errors.push(`command "${scheduled.command.type}" is scheduled past the scenario's last tick`);
      }
    }
    return errors;
  });
  registry.register(kernelSmokeScenario);
  return registry;
}

/**
 * Milestone 01's determinism fixture. Exercises rng-driven spawning, motion
 * integration over many ticks, and mid-run despawn.
 */
export const kernelSmokeScenario: Scenario = {
  id: "kernel-smoke",
  description: "Scatter-spawns rng-placed entities, integrates motion for 120 ticks, despawns one mid-run.",
  seed: 20260819,
  ticks: 120,
  commands: [
    {
      atTick: 0,
      command: { type: SPAWN_SCATTER, schemaVersion: 1, count: 8, spread: 40 } as SpawnScatterCommand,
    },
    {
      atTick: 30,
      command: { type: SPAWN_SCATTER, schemaVersion: 1, count: 4, spread: 12 } as SpawnScatterCommand,
    },
    { atTick: 60, command: { type: DESPAWN_ENTITY, schemaVersion: 1, entityId: 3 } as DespawnEntityCommand },
  ],
};
