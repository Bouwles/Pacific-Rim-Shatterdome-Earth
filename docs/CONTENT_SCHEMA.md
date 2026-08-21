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

## Asset manifests (Milestone 02)

Defined in `src/assets/manifest.ts`, registered in `src/data/assets.ts`, validated by
`validateAssetManifest` at registration and by `validateAssetInspection` after loading.

| Field                      | Type                                                | Constraint                                                       |
| -------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| `id`                       | `string`                                            | required, unique                                                 |
| `displayName`              | `string`                                            | required                                                         |
| `assetClass`               | enum                                                | jaeger, kaiju, building, vehicle, ship, prop, shatterdome-module |
| `source.url`               | `string \| null`                                    | path under `public/`, or null while only the generator exists    |
| `source.format`            | `"glb" \| "gltf"`                                   | production asset format                                          |
| `fallbackGenerator.id`     | `string`                                            | required, so an asset is never unrenderable                      |
| `fallbackGenerator.params` | record of number/string/boolean                     | validated by the named generator                                 |
| `nominalHeightMeters`      | `number`                                            | positive; loaded model must match within 10 percent              |
| `materials[]`              | slot id, `#rrggbb`, metallic, roughness, textureUrl | metallic and roughness within [0, 1]; ids unique                 |
| `animations[]`             | gameplay tag, clip name, loop                       | tags unique; clip must exist in the model                        |
| `sockets[]`                | socket id, position, nodeName                       | ids from the known set, no duplicates                            |
| `collision`                | box/capsule/sphere, size, center                    | finite vectors                                                   |
| `audio[]`                  | slot id, url                                        | ids unique                                                       |
| `portrait`                 | slot id, url, or null                               | optional                                                         |
| `provenance`               | author, license, sourceUrl, notes                   | author and license required                                      |
| `seed`                     | `number`                                            | finite; makes generated geometry reproducible                    |

### Socket ids

`head`, `chest`, `back`, `reactor`, `hand.L`, `hand.R`, `forearm.L`, `forearm.R`, `foot.L`, `foot.R`, `muzzle`.

### Conventions a production model must follow

Authored in metres, facing +Z, origin at the base centre. Enforced by `validateAssetInspection`, not by
convention alone.

### Overrides

`AssetManifestOverride` exposes only `source`, `fallbackGenerator`, `materials` and `portrait`. Gameplay
fields are structurally unreachable from an override.

## Save envelope (Milestone 03)

Defined in `src/saves/schema.ts`. Versioned separately from the simulation
snapshot; see [SAVE_MIGRATIONS.md](SAVE_MIGRATIONS.md).

`RootSave` at `schemaVersion: 1`:

| Field           | Type           | Constraint                               |
| --------------- | -------------- | ---------------------------------------- |
| `schemaVersion` | `number`       | must equal `ROOT_SAVE_VERSION`           |
| `savedAt`       | `number`       | epoch ms; 0 when unknown after migration |
| `metadata`      | `SaveMetadata` | see below                                |
| `sim`           | `SimSnapshot`  | authoritative state only                 |

`SaveMetadata`:

| Field          | Type             | Constraint                      |
| -------------- | ---------------- | ------------------------------- |
| `name`         | `string`         | non-empty                       |
| `worldSeed`    | `number`         | finite                          |
| `playTimeMs`   | `number`         | finite, not negative            |
| `lastPlayedAt` | `number`         | finite epoch ms; 0 when unknown |
| `simTick`      | `number`         | finite                          |
| `appVersion`   | `string`         | build that wrote it             |
| `thumbnail`    | `string \| null` | small JPEG data URL, or null    |

`StoredSave` is what the repository persists: `{ slotId, document, checksum }`,
where `checksum` is `hashState(document)`.

### Slot naming

| Pattern               | Meaning                                |
| --------------------- | -------------------------------------- |
| `slot.<id>`           | Manual save                            |
| `autosave.<n>`        | Autosave ring position                 |
| `backup.<slotId>.<n>` | Backup ring for that slot, 0 is newest |

## World schemas (Milestone 04)

### `RegionDefinition` (src/data/regions.ts)

| Field                 | Type          | Constraint                                                        |
| --------------------- | ------------- | ----------------------------------------------------------------- |
| `id`                  | `string`      | required, unique                                                  |
| `displayName`         | `string`      | required                                                          |
| `kind`                | enum          | coastal-city, inland-city, shatterdome, ocean, wilderness         |
| `climate`             | enum          | polar, subarctic, temperate, subtropical, tropical, arid, oceanic |
| `centre`              | `GeoPosition` | valid latitude, longitude and altitude                            |
| `radiusMeters`        | `number`      | positive; the dense combat core, not metropolitan sprawl          |
| `populationThousands` | `number`      | not negative                                                      |
| `deploymentPoint`     | `boolean`     | whether the region can be deployed to directly                    |

### `RegionRecord` (strategic state, one per region)

| Field             | Type     | Constraint             |
| ----------------- | -------- | ---------------------- |
| `regionId`        | `string` | must be a known region |
| `integrity`       | `number` | 0 to 1                 |
| `safetyRating`    | `number` | 0 to 1                 |
| `lastVisitedTick` | `number` | non-negative integer   |
| `tier`            | enum     | active or strategic    |

### `WorldSnapshot` (`WORLD_SCHEMA_VERSION = 1`)

`{ schemaVersion, playerPosition, activeRegionId, activeSectorId, regions }`,
regions sorted by id so the form is canonical. Validation rejects an unknown
region, a malformed sector id, and any snapshot claiming more than one active
region.

## Not yet defined

Kaiju, copilot, weapon, facility, research-node, region, and reward-table schemas don't exist yet — they
arrive with the milestone that first needs them (see [../ROADMAP.md](../ROADMAP.md)).
