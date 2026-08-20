import { ContentRegistry, type RegistryEntry } from "../data/registry";

/** Branded so a raw number can never be passed where an entity handle is expected. */
export type EntityId = number & { readonly __entityId: unique symbol };

export const ENTITIES_SCHEMA_VERSION = 1;

export interface ComponentDefinition<T> extends RegistryEntry {
  readonly id: string;
  /** Returns human-readable problems; empty means valid. */
  validate(value: T): string[];
  /** Deep copy, so stored state can never alias a caller's object. */
  clone(value: T): T;
}

/**
 * Type-erased view used where definitions of different shapes share one registry.
 * Method-position parameters are bivariant and `unknown` accepts any return, so
 * every `ComponentDefinition<T>` is assignable here without a cast.
 */
export interface AnyComponentDefinition extends RegistryEntry {
  readonly id: string;
  validate(value: never): string[];
  clone(value: never): unknown;
}

export interface EntitiesSnapshot {
  readonly schemaVersion: number;
  readonly nextId: number;
  readonly entities: ReadonlyArray<{
    readonly id: number;
    readonly components: Readonly<Record<string, unknown>>;
  }>;
}

function defineComponent<T>(definition: ComponentDefinition<T>): ComponentDefinition<T> {
  return definition;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function validateVec3(label: string, value: Vec3): string[] {
  const errors: string[] = [];
  for (const axis of ["x", "y", "z"] as const) {
    if (!Number.isFinite(value[axis])) errors.push(`${label}.${axis} must be a finite number`);
  }
  return errors;
}

export const TransformComponent = defineComponent<Vec3>({
  id: "transform",
  validate: (value) => validateVec3("transform", value),
  clone: (value) => ({ x: value.x, y: value.y, z: value.z }),
});

export const VelocityComponent = defineComponent<Vec3>({
  id: "velocity",
  validate: (value) => validateVec3("velocity", value),
  clone: (value) => ({ x: value.x, y: value.y, z: value.z }),
});

export function createComponentRegistry(): ContentRegistry<AnyComponentDefinition> {
  const registry = new ContentRegistry<AnyComponentDefinition>((entry) =>
    entry.id ? [] : ["component id required"],
  );
  registry.register(TransformComponent);
  registry.register(VelocityComponent);
  return registry;
}

/**
 * Authoritative entity storage. Holds no Babylon or DOM references — presentation
 * binds to entity ids from the outside.
 *
 * Ids are monotonic and never reused: recycling ids lets a stale handle silently
 * address a different entity, which is the classic source of "impossible" bugs.
 */
export class EntityRegistry {
  private nextId = 1;
  private readonly living = new Set<EntityId>();
  private readonly stores = new Map<string, Map<EntityId, unknown>>();

  spawn(): EntityId {
    const id = this.nextId as EntityId;
    this.nextId += 1;
    this.living.add(id);
    return id;
  }

  despawn(id: EntityId): boolean {
    if (!this.living.delete(id)) return false;
    for (const store of this.stores.values()) store.delete(id);
    return true;
  }

  isAlive(id: EntityId): boolean {
    return this.living.has(id);
  }

  get count(): number {
    return this.living.size;
  }

  /** Live entity ids in spawn order. Deterministic because spawn order is. */
  ids(): readonly EntityId[] {
    return Array.from(this.living);
  }

  add<T>(id: EntityId, definition: ComponentDefinition<T>, value: T): void {
    if (!this.living.has(id)) {
      throw new Error(`Cannot add component "${definition.id}" to dead or unknown entity ${id}`);
    }
    const errors = definition.validate(value);
    if (errors.length > 0) {
      throw new Error(`Invalid "${definition.id}" component on entity ${id}: ${errors.join("; ")}`);
    }
    this.storeFor(definition.id).set(id, definition.clone(value));
  }

  get<T>(id: EntityId, definition: ComponentDefinition<T>): T | undefined {
    return this.stores.get(definition.id)?.get(id) as T | undefined;
  }

  remove<T>(id: EntityId, definition: ComponentDefinition<T>): boolean {
    return this.stores.get(definition.id)?.delete(id) ?? false;
  }

  /** Iterates every live entity carrying the component, in insertion order. */
  each<T>(definition: ComponentDefinition<T>, visit: (id: EntityId, value: T) => void): void {
    const store = this.stores.get(definition.id);
    if (!store) return;
    for (const [id, value] of store) {
      if (this.living.has(id)) visit(id, value as T);
    }
  }

  serialize(): EntitiesSnapshot {
    const entities = Array.from(this.living)
      .sort((a, b) => a - b)
      .map((id) => {
        const components: Record<string, unknown> = {};
        for (const [componentId, store] of this.stores) {
          const value = store.get(id);
          if (value !== undefined) components[componentId] = value;
        }
        return { id: id as number, components };
      });
    return { schemaVersion: ENTITIES_SCHEMA_VERSION, nextId: this.nextId, entities };
  }

  restore(snapshot: EntitiesSnapshot, components: ContentRegistry<AnyComponentDefinition>): void {
    if (snapshot.schemaVersion !== ENTITIES_SCHEMA_VERSION) {
      throw new Error(
        `Entity snapshot schema version ${snapshot.schemaVersion} is not supported ` +
          `(expected ${ENTITIES_SCHEMA_VERSION}); a migration is required`,
      );
    }
    this.living.clear();
    this.stores.clear();
    this.nextId = snapshot.nextId;

    for (const record of snapshot.entities) {
      const id = record.id as EntityId;
      if (id >= this.nextId) {
        throw new Error(`Entity snapshot is inconsistent: id ${id} is not below nextId ${this.nextId}`);
      }
      this.living.add(id);
      for (const [componentId, value] of Object.entries(record.components)) {
        const definition = components.get(componentId) as ComponentDefinition<unknown> | undefined;
        if (!definition) {
          throw new Error(`Entity snapshot references unknown component "${componentId}"`);
        }
        const errors = definition.validate(value);
        if (errors.length > 0) {
          throw new Error(`Entity snapshot has invalid "${componentId}" on ${id}: ${errors.join("; ")}`);
        }
        this.storeFor(componentId).set(id, definition.clone(value));
      }
    }
  }

  private storeFor(componentId: string): Map<EntityId, unknown> {
    let store = this.stores.get(componentId);
    if (!store) {
      store = new Map<EntityId, unknown>();
      this.stores.set(componentId, store);
    }
    return store;
  }
}
