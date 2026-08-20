import { describe, expect, it } from "vitest";
import {
  EntityRegistry,
  TransformComponent,
  VelocityComponent,
  createComponentRegistry,
  type EntityId,
} from "../../src/entities/entity";

describe("EntityRegistry lifecycle", () => {
  it("spawns live entities and counts them", () => {
    const registry = new EntityRegistry();
    const a = registry.spawn();
    const b = registry.spawn();
    expect(registry.isAlive(a)).toBe(true);
    expect(registry.count).toBe(2);
    expect(a).not.toBe(b);
  });

  it("never reuses an id after despawn", () => {
    const registry = new EntityRegistry();
    const first = registry.spawn();
    registry.despawn(first);
    const second = registry.spawn();
    expect(second).not.toBe(first);
    expect(registry.isAlive(first)).toBe(false);
  });

  it("despawn removes components and reports whether anything was removed", () => {
    const registry = new EntityRegistry();
    const id = registry.spawn();
    registry.add(id, TransformComponent, { x: 1, y: 2, z: 3 });

    expect(registry.despawn(id)).toBe(true);
    expect(registry.get(id, TransformComponent)).toBeUndefined();
    expect(registry.despawn(id)).toBe(false);
  });

  it("stores a copy so callers cannot mutate simulation state by reference", () => {
    const registry = new EntityRegistry();
    const id = registry.spawn();
    const source = { x: 1, y: 2, z: 3 };
    registry.add(id, TransformComponent, source);
    source.x = 999;
    expect(registry.get(id, TransformComponent)?.x).toBe(1);
  });

  it("rejects invalid component data and components on dead entities", () => {
    const registry = new EntityRegistry();
    const id = registry.spawn();
    expect(() => registry.add(id, TransformComponent, { x: Number.NaN, y: 0, z: 0 })).toThrow(/finite/);

    registry.despawn(id);
    expect(() => registry.add(id, TransformComponent, { x: 0, y: 0, z: 0 })).toThrow(/dead or unknown/);
  });

  it("iterates only live entities that carry the component", () => {
    const registry = new EntityRegistry();
    const withVelocity = registry.spawn();
    const withoutVelocity = registry.spawn();
    const removed = registry.spawn();
    registry.add(withVelocity, VelocityComponent, { x: 1, y: 0, z: 0 });
    registry.add(removed, VelocityComponent, { x: 5, y: 0, z: 0 });
    registry.despawn(removed);

    const visited: EntityId[] = [];
    registry.each(VelocityComponent, (id) => visited.push(id));
    expect(visited).toEqual([withVelocity]);
    expect(visited).not.toContain(withoutVelocity);
  });
});

describe("EntityRegistry serialization", () => {
  it("round-trips through serialize/restore with identical observable state", () => {
    const components = createComponentRegistry();
    const original = new EntityRegistry();
    const a = original.spawn();
    const b = original.spawn();
    original.add(a, TransformComponent, { x: 1, y: 2, z: 3 });
    original.add(a, VelocityComponent, { x: 0.5, y: 0, z: -0.5 });
    original.add(b, TransformComponent, { x: -4, y: 0, z: 8 });
    original.despawn(b);

    const snapshot = original.serialize();
    const restored = new EntityRegistry();
    restored.restore(snapshot, components);

    expect(restored.serialize()).toEqual(snapshot);
    expect(restored.count).toBe(original.count);
    expect(restored.get(a, TransformComponent)).toEqual({ x: 1, y: 2, z: 3 });
    // Ids keep advancing past everything the snapshot ever used.
    expect(restored.spawn()).toBeGreaterThan(b);
  });

  it("serializes entities in id order regardless of despawn history", () => {
    const registry = new EntityRegistry();
    const a = registry.spawn();
    const b = registry.spawn();
    const c = registry.spawn();
    registry.despawn(b);
    void a;
    void c;
    expect(registry.serialize().entities.map((e) => e.id)).toEqual([1, 3]);
  });

  it("refuses a snapshot from an unsupported schema version", () => {
    const registry = new EntityRegistry();
    expect(() =>
      registry.restore({ schemaVersion: 99, nextId: 1, entities: [] }, createComponentRegistry()),
    ).toThrow(/migration is required/);
  });

  it("refuses a snapshot with an unknown component or inconsistent ids", () => {
    const components = createComponentRegistry();
    const registry = new EntityRegistry();

    expect(() =>
      registry.restore(
        { schemaVersion: 1, nextId: 5, entities: [{ id: 1, components: { mystery: {} } }] },
        components,
      ),
    ).toThrow(/unknown component "mystery"/);

    expect(() =>
      registry.restore({ schemaVersion: 1, nextId: 2, entities: [{ id: 7, components: {} }] }, components),
    ).toThrow(/not below nextId/);
  });
});
