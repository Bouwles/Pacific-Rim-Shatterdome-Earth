import type { ContentRegistry } from "../data/registry";
import {
  EntityRegistry,
  TransformComponent,
  VelocityComponent,
  createComponentRegistry,
  type AnyComponentDefinition,
  type EntitiesSnapshot,
} from "../entities/entity";
import { FIXED_STEP_MS } from "./clock";
import { createCommandRegistry, type CommandContext, type CommandHandler, type SimCommand } from "./commands";
import { EventBus, type SimEvent } from "./events";
import { hashState } from "./hash";
import { RngStreams, type Rng } from "./rng";

export const SIM_SCHEMA_VERSION = 1;
const STEP_SECONDS = FIXED_STEP_MS / 1000;

export interface SimSnapshot {
  readonly schemaVersion: number;
  readonly seed: number;
  readonly tick: number;
  readonly entities: EntitiesSnapshot;
}

export interface SimulationKernelOptions {
  readonly seed: number;
  readonly commands?: ContentRegistry<CommandHandler>;
  readonly components?: ContentRegistry<AnyComponentDefinition>;
}

/**
 * The authoritative simulation. Holds no reference to Babylon, the DOM, or wall
 * clock time — everything it does is a pure function of (seed, command sequence,
 * tick count), which is what makes replays and the scenario hash meaningful.
 */
export class SimulationKernel {
  readonly entities = new EntityRegistry();
  readonly events = new EventBus();
  readonly seed: number;

  private readonly rng: RngStreams;
  private readonly commandRegistry: ContentRegistry<CommandHandler>;
  private readonly componentRegistry: ContentRegistry<AnyComponentDefinition>;
  private pendingCommands: SimCommand[] = [];
  private currentTick = 0;

  constructor(options: SimulationKernelOptions) {
    if (!Number.isFinite(options.seed)) {
      throw new Error(`Simulation seed must be a finite number, got ${options.seed}`);
    }
    this.seed = options.seed;
    this.rng = new RngStreams(options.seed);
    this.commandRegistry = options.commands ?? createCommandRegistry();
    this.componentRegistry = options.components ?? createComponentRegistry();
  }

  get tick(): number {
    return this.currentTick;
  }

  get entityCount(): number {
    return this.entities.count;
  }

  get queuedCommandCount(): number {
    return this.pendingCommands.length;
  }

  rngStream(name: string): Rng {
    return this.rng.stream(name);
  }

  /**
   * Validates immediately and queues for the next step. Failing here rather than
   * mid-tick means a bad command is attributed to the code that issued it.
   */
  enqueue(command: SimCommand): void {
    const handler = this.commandRegistry.get(command.type);
    if (!handler) {
      throw new Error(`Unknown simulation command "${command.type}"`);
    }
    if (command.schemaVersion !== handler.schemaVersion) {
      throw new Error(
        `Command "${command.type}" has schema version ${command.schemaVersion}, ` +
          `but the registered handler is version ${handler.schemaVersion}; a migration is required`,
      );
    }
    const errors = handler.validate(command);
    if (errors.length > 0) {
      throw new Error(`Invalid "${command.type}" command: ${errors.join("; ")}`);
    }
    this.pendingCommands.push(command);
  }

  /** Advances exactly one authoritative tick. */
  step(): void {
    const context: CommandContext = {
      entities: this.entities,
      tick: this.currentTick,
      rngStream: (name) => this.rng.stream(name),
      emit: (event: SimEvent) => this.events.emit(event),
    };

    // Swap the queue so a command that enqueues another lands next tick, keeping
    // one tick's work bounded and its ordering reproducible.
    const batch = this.pendingCommands;
    this.pendingCommands = [];
    for (const command of batch) {
      this.commandRegistry.getOrThrow(command.type).apply(command, context);
    }

    this.integrateMotion();
    this.currentTick += 1;
  }

  serialize(): SimSnapshot {
    return {
      schemaVersion: SIM_SCHEMA_VERSION,
      seed: this.seed,
      tick: this.currentTick,
      entities: this.entities.serialize(),
    };
  }

  restore(snapshot: SimSnapshot): void {
    if (snapshot.schemaVersion !== SIM_SCHEMA_VERSION) {
      throw new Error(
        `Simulation snapshot schema version ${snapshot.schemaVersion} is not supported ` +
          `(expected ${SIM_SCHEMA_VERSION}); a migration is required`,
      );
    }
    if (snapshot.seed !== this.seed) {
      throw new Error(
        `Snapshot seed ${snapshot.seed} does not match this kernel's seed ${this.seed}; ` +
          `restore into a kernel constructed with the snapshot's seed`,
      );
    }
    this.entities.restore(snapshot.entities, this.componentRegistry);
    this.currentTick = snapshot.tick;
    this.pendingCommands = [];
  }

  /** Deterministic digest of authoritative state — the replay/regression signal. */
  hash(): string {
    return hashState(this.serialize());
  }

  dispose(): void {
    this.events.dispose();
    this.pendingCommands = [];
  }

  /**
   * The only system in this milestone. Addition and multiplication only: JS
   * transcendentals (sin/cos/pow) are not guaranteed bit-identical across
   * engines, so authoritative code must avoid them.
   */
  private integrateMotion(): void {
    this.entities.each(VelocityComponent, (id, velocity) => {
      const transform = this.entities.get(id, TransformComponent);
      if (!transform) return;
      transform.x += velocity.x * STEP_SECONDS;
      transform.y += velocity.y * STEP_SECONDS;
      transform.z += velocity.z * STEP_SECONDS;
    });
  }
}
