import { ContentRegistry, type RegistryEntry } from "../data/registry";
import {
  TransformComponent,
  VelocityComponent,
  type EntityId,
  type EntityRegistry,
  type Vec3,
} from "../entities/entity";
import {
  ENTITY_DESPAWNED,
  ENTITY_SPAWNED,
  type EntityDespawnedEvent,
  type EntitySpawnedEvent,
  type SimEvent,
} from "./events";
import type { Rng } from "./rng";

/** Every command is plain serializable data so it can be logged, replayed, or sent over the wire. */
export interface SimCommand {
  readonly type: string;
  readonly schemaVersion: number;
}

/** What a command handler is allowed to touch. Never the scene, never the DOM. */
export interface CommandContext {
  readonly entities: EntityRegistry;
  readonly tick: number;
  rngStream(name: string): Rng;
  emit(event: SimEvent): void;
}

export interface CommandHandler<C extends SimCommand = SimCommand> extends RegistryEntry {
  /** Registry id is the command `type`, so dispatch is a lookup, never a switch. */
  readonly id: string;
  readonly schemaVersion: number;
  validate(command: C): string[];
  apply(command: C, context: CommandContext): void;
}

export const SPAWN_ENTITY = "spawn-entity";
export const DESPAWN_ENTITY = "despawn-entity";
export const SPAWN_SCATTER = "spawn-scatter";

export interface SpawnEntityCommand extends SimCommand {
  readonly type: typeof SPAWN_ENTITY;
  readonly schemaVersion: 1;
  readonly transform: Vec3;
  readonly velocity: Vec3;
}

export interface DespawnEntityCommand extends SimCommand {
  readonly type: typeof DESPAWN_ENTITY;
  readonly schemaVersion: 1;
  readonly entityId: number;
}

export interface SpawnScatterCommand extends SimCommand {
  readonly type: typeof SPAWN_SCATTER;
  readonly schemaVersion: 1;
  readonly count: number;
  readonly spread: number;
}

function vec3Errors(label: string, value: Vec3 | undefined): string[] {
  if (!value || typeof value !== "object") return [`${label} must be a {x,y,z} object`];
  const errors: string[] = [];
  for (const axis of ["x", "y", "z"] as const) {
    if (!Number.isFinite(value[axis])) errors.push(`${label}.${axis} must be a finite number`);
  }
  return errors;
}

function spawnAt(context: CommandContext, transform: Vec3, velocity: Vec3): EntityId {
  const id = context.entities.spawn();
  context.entities.add(id, TransformComponent, transform);
  context.entities.add(id, VelocityComponent, velocity);
  const event: EntitySpawnedEvent = {
    type: ENTITY_SPAWNED,
    schemaVersion: 1,
    entityId: id as number,
    tick: context.tick,
  };
  context.emit(event);
  return id;
}

const spawnEntityHandler: CommandHandler<SpawnEntityCommand> = {
  id: SPAWN_ENTITY,
  schemaVersion: 1,
  validate: (command) => [
    ...vec3Errors("transform", command.transform),
    ...vec3Errors("velocity", command.velocity),
  ],
  apply: (command, context) => {
    spawnAt(context, command.transform, command.velocity);
  },
};

const despawnEntityHandler: CommandHandler<DespawnEntityCommand> = {
  id: DESPAWN_ENTITY,
  schemaVersion: 1,
  validate: (command) =>
    Number.isInteger(command.entityId) && command.entityId > 0 ? [] : ["entityId must be a positive integer"],
  apply: (command, context) => {
    const id = command.entityId as EntityId;
    // Despawning something already gone is a no-op, not an error: a replayed or
    // duplicated command must not diverge from the original run.
    if (context.entities.despawn(id)) {
      const event: EntityDespawnedEvent = {
        type: ENTITY_DESPAWNED,
        schemaVersion: 1,
        entityId: command.entityId,
        tick: context.tick,
      };
      context.emit(event);
    }
  },
};

const spawnScatterHandler: CommandHandler<SpawnScatterCommand> = {
  id: SPAWN_SCATTER,
  schemaVersion: 1,
  validate: (command) => {
    const errors: string[] = [];
    if (!Number.isInteger(command.count) || command.count <= 0)
      errors.push("count must be a positive integer");
    if (!Number.isFinite(command.spread) || command.spread <= 0)
      errors.push("spread must be a positive number");
    return errors;
  },
  apply: (command, context) => {
    const rng = context.rngStream("spawn");
    for (let i = 0; i < command.count; i += 1) {
      const transform: Vec3 = {
        x: (rng() - 0.5) * command.spread,
        y: 0,
        z: (rng() - 0.5) * command.spread,
      };
      const velocity: Vec3 = { x: rng() - 0.5, y: 0, z: rng() - 0.5 };
      spawnAt(context, transform, velocity);
    }
  },
};

export function createCommandRegistry(): ContentRegistry<CommandHandler> {
  const registry = new ContentRegistry<CommandHandler>((entry) => {
    const errors: string[] = [];
    if (!entry.id) errors.push("command id required");
    if (!Number.isInteger(entry.schemaVersion) || entry.schemaVersion < 1) {
      errors.push("schemaVersion must be a positive integer");
    }
    return errors;
  });
  registry.register(spawnEntityHandler as CommandHandler);
  registry.register(despawnEntityHandler as CommandHandler);
  registry.register(spawnScatterHandler as CommandHandler);
  return registry;
}
