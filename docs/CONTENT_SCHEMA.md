# CONTENT_SCHEMA.md

Documents the typed shapes registered content must satisfy. Extend this file every time a new
`ContentRegistry<T>` consumer is added (see [ARCHITECTURE.md](ARCHITECTURE.md) → "Data-registry pattern").
Only one schema exists as of Milestone 00.

## `JaegerDefinition` (src/data/jaegers.ts)

| Field                        | Type     | Constraint                                                     |
| ---------------------------- | -------- | -------------------------------------------------------------- |
| `id`                         | `string` | required, unique within the registry                           |
| `name`                       | `string` | required                                                       |
| `manufacturer`               | `string` | required                                                       |
| `markDesignation`            | `string` | free text                                                      |
| `massBudget.massTons`        | `number` | `> 0`                                                          |
| `massBudget.powerOutputMw`   | `number` | `> 0`                                                          |
| `massBudget.coolingCapacity` | `number` | `0..1` (fraction of reactor heat dissipated at sustained load) |
| `description`                | `string` | free text                                                      |

Validated by `validateJaeger()` at `register()` time; invalid entries throw with a field-level message
instead of silently registering bad data.

Registered content: one entry, `placeholder-mk0` — a non-canon procedural stand-in, not a real Jaeger
design (see legal/asset boundary in [../GAME_SPEC.md](../GAME_SPEC.md)). Tracked in
[../CONTENT_REGISTRY.md](../CONTENT_REGISTRY.md).

## Simulation schemas (Milestone 01)

These are versioned separately from content because they describe authoritative runtime state, not
authored content. Every one carries an explicit `schemaVersion`; a mismatch throws a "migration is
required" error rather than silently reading stale data.

### Components (src/entities/entity.ts)

| Component   | Shape                                 | Constraint        |
| ----------- | ------------------------------------- | ----------------- |
| `transform` | `{ x: number, y: number, z: number }` | every axis finite |
| `velocity`  | `{ x: number, y: number, z: number }` | every axis finite |

Component values are deep-copied on write, so stored state never aliases a caller's object.

### Commands (src/simulation/commands.ts)

All at `schemaVersion: 1`. Dispatch is a registry lookup keyed by `type`.

| `type`           | Payload                             | Validation                              |
| ---------------- | ----------------------------------- | --------------------------------------- |
| `spawn-entity`   | `transform: Vec3`, `velocity: Vec3` | both vectors finite on every axis       |
| `despawn-entity` | `entityId: number`                  | positive integer; unknown id is a no-op |
| `spawn-scatter`  | `count: number`, `spread: number`   | `count` positive integer, `spread` > 0  |

`spawn-scatter` draws from the `"spawn"` RNG stream, so its placements are reproducible from the seed.

### Events (src/simulation/events.ts)

All at `schemaVersion: 1`: `entity-spawned` and `entity-despawned`, each `{ entityId: number, tick: number }`.

### Snapshots

`EntitiesSnapshot` (`ENTITIES_SCHEMA_VERSION = 1`): `{ schemaVersion, nextId, entities: [{ id, components }] }`,
entities sorted by id so the form is canonical.

`SimSnapshot` (`SIM_SCHEMA_VERSION = 1`): `{ schemaVersion, seed, tick, entities }`. `restore()` rejects a
snapshot whose seed differs from the target kernel's, because continuing a run under a different seed would
silently diverge.

## Not yet defined

Kaiju, copilot, weapon, facility, research-node, region, and reward-table schemas don't exist yet — they
arrive with the milestone that first needs them (see [../ROADMAP.md](../ROADMAP.md)).
