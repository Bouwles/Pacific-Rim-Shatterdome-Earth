# CONTENT_SCHEMA.md

Documents the typed shapes registered content must satisfy. Extend this file every time a new
`ContentRegistry<T>` consumer is added (see [ARCHITECTURE.md](ARCHITECTURE.md) → "Data-registry pattern").
Schemas are added as the milestones that need them land; the terrain and biome schemas below are the newest.

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

## Terrain and biome schemas (Milestone 05)

Terrain is generated, not authored, so these schemas describe what the generator
is given and what it returns. Nothing here is a claim about real geography: the
generator knows a sample's latitude, a seeded moisture field, and the authored
anchors below, and nothing else. Real coastlines, mountain ranges, rivers and
city footprints are not reproduced and are not attempted.

### `BiomeDefinition` (src/data/biomes.ts)

One row per climate zone, keyed by the same `ClimateZone` union the region schema
uses, so a region and the terrain under it cannot disagree about what a climate is.

| Field            | Type                     | Constraint                             |
| ---------------- | ------------------------ | -------------------------------------- |
| `id`             | `ClimateZone`            | must be one of the seven climate zones |
| `displayName`    | `string`                 | required                               |
| `colour`         | `[number,number,number]` | three channels within 0 to 1           |
| `waterColour`    | `[number,number,number]` | three channels within 0 to 1           |
| `scatterDensity` | `number`                 | 0 to 1                                 |
| `notes`          | `string`                 | free text                              |

Biome affects colour and scatter only. It deliberately does not affect elevation:
climate is resolved per sector, so letting it touch height made two adjacent
sectors in different climate bands disagree along their shared edge by a measured
25.6 m, which reads on screen as a wall running down a sector boundary.

`SURFACE_CLASSES` layers a second table over the biome, banded by elevation
(seabed, shallows, shore, lowland, hills, highland, peak), each with a shade
multiplier and a `walkable` flag. Seven biomes times seven surfaces beats a
forty-nine row table nobody would keep consistent.

`CLIMATE_BANDS` maps absolute latitude to a climate zone as data rather than as a
chain of comparisons.

### `TerrainAnchor` (src/world/terrain.ts, built in src/data/regions.ts)

The narrow, structured-cloneable view of a region that terrain generation is
allowed to see. It crosses the worker boundary, so it carries no gameplay fields.

| Field                 | Type          | Constraint                              |
| --------------------- | ------------- | --------------------------------------- |
| `regionId`            | `string`      | required                                |
| `latitudeDeg`         | `number`      | finite                                  |
| `longitudeDeg`        | `number`      | finite                                  |
| `radiusMeters`        | `number`      | finite, positive                        |
| `populationThousands` | `number`      | non-negative                            |
| `maskTarget`          | `number`      | finite; above 0.5 is land, below is sea |
| `climate`             | `ClimateZone` | must have a registered biome            |
| `populated`           | `boolean`     | false suppresses city cells and lanes   |

Anchors exist because pure noise does not respect authored content. Without them
a Shatterdome lands at the bottom of the sea, and an open-ocean region comes out
as a 640 m mountain; both were measured on this seed. `KIND_TERRAIN_SHAPE` in
`src/data/regions.ts` maps region kind to `maskTarget` and `populated` as a
table, so the generator never learns what a Shatterdome is.

`validateTerrainRequest` rejects a non-finite `maskTarget` by name. Left
unchecked it poisons every sample it touches and returns a sector of NaN heights,
which renders as nothing at all rather than as an error.

### `TerrainRequestParams` and the cache key

`{ sectorId, lod, seed, anchors }`. The cache key is
`t<schema>|s<seed>|<sectorId>|lod<level>` and carries everything that can change
the resulting bytes, which is what makes a cache hit safe to substitute for
generation.

### `SectorTerrain` (`TERRAIN_SCHEMA_VERSION = 1`)

Returned by the generator and transferred out of the worker. Positions are ECEF
so they do not depend on where the floating origin happens to be.

| Field                                    | Type                | Note                                           |
| ---------------------------------------- | ------------------- | ---------------------------------------------- |
| `positions`                              | `Float64Array`      | ECEF metres, three per vertex                  |
| `heights`                                | `Float32Array`      | metres above sea level, one per vertex         |
| `surfaces`                               | `Uint8Array`        | index into `SURFACE_CLASSES`                   |
| `biomeId`, `climate`                     | `ClimateZone`       | resolved per sector                            |
| `coastline`, `waterFraction`             | `boolean`, `number` | coast means both land and water present        |
| `cityCells`, `landmarks`, `trafficLanes` | arrays              | empty where the sector has no populated anchor |
| `collision`                              | field or `null`     | present only at level of detail 0 and 1        |
| `estimatedBytes`, `digest`               | `number`            | budget accounting and content identity         |

`digest` is a quantised FNV-1a hash of the content. Two generations of the same
cache key must produce the same digest; that is the property the streaming tests
assert when the player turns around.

Traffic lanes carry a polyline and a marker count. The markers are a static
representation of traffic density. Nothing moves, routes, or reacts.

### Terrain worker protocol (`TERRAIN_PROTOCOL_VERSION = 1`)

Requests are `generate` or `cancel`; responses are `generated`, `cancelled` or
`failed`. Both directions validate the version and the message type and reject a
mismatch loudly, because a worker built from a stale bundle otherwise shows up as
terrain that quietly never arrives.

## Environment schemas (Milestone 06)

### `ClimateWeatherProfile` (src/data/climates.ts)

Keyed by the same `ClimateZone` union regions, biomes and terrain use, so a
region, the ground under it and the sky above it cannot disagree.

| Field              | Type                          | Constraint                                  |
| ------------------ | ----------------------------- | ------------------------------------------- |
| `id`               | `ClimateZone`                 | must be one of the seven climate zones      |
| `weights`          | `Record<WeatherKind, number>` | non-negative; at least one must be positive |
| `baseTemperatureC` | `number`                      | finite                                      |
| `dailySwingC`      | `number`                      | finite, non-negative                        |
| `baseWindMps`      | `number`                      | finite, non-negative                        |

Weights are relative likelihoods, not probabilities. A zero excludes a kind
outright, which is how the arid profile is guaranteed never to produce snow. A
profile whose weights are all zero is refused at registration, because it would
silently freeze the sky on whatever the fallback happened to be.

The world layer never imports this file. `WeatherSystem` takes a profile as a
constructor parameter, which is what keeps `src/world/**` independent of content.

### `WeatherKindProfile` (src/world/weather.ts)

One row per weather kind, blended rather than branched on: cloud cover,
precipitation, fog density, wind multiplier, lightning chance, visibility in
metres, temperature offset, and whether precipitation is frozen. Adding a kind is
a row, never a case.

### `WorldClockSnapshot` (`WORLD_CLOCK_SCHEMA_VERSION = 1`)

`{ schemaVersion, elapsedTicks, dayLengthTicks }`. Ticks are whole; the clock
refuses a fractional advance so it cannot drift off the tick grid.

### `WeatherSnapshot` (`WEATHER_SCHEMA_VERSION = 1`)

`{ schemaVersion, wetness }`. Only wetness is stored, because it is the only
weather value that is history rather than derivation. Everything else is a
function of the seed and the tick.

### `EnvironmentSnapshot` (`ENVIRONMENT_SCHEMA_VERSION = 1`)

`{ schemaVersion, clock, weather }`, carried inside the world section of a save.

### `DepthZone` (src/world/ocean.ts)

Ordered shallow to deep, the last open ended so a lookup always resolves:
shoreline, shallows, shelf, deep, abyssal. Each carries underwater visibility in
metres, a darkness fraction, and whether a body can stand there. These are
gameplay bands, not oceanography.

### `QualityPreset` (src/data/quality.ts)

| Field                   | Type           | Constraint                                 |
| ----------------------- | -------------- | ------------------------------------------ |
| `id`                    | `QualityLevel` | low, medium, high or cinematic             |
| `maxParticles`          | `number`       | non-negative; a hard ceiling, not a target |
| `particleRatePerSecond` | `number`       | non-negative                               |
| `reflections`           | enum           | none, probe or planar                      |
| `shadowMapSize`         | `number`       | non-negative; zero disables shadows        |
| `waterGridResolution`   | `number`       | at least 3                                 |
| `waterWaveOctaves`      | `number`       | at least 1                                 |
| `animatedWaterSectors`  | `number`       | non-negative                               |
| `fogQuality`            | `number`       | non-negative multiplier on fog density     |
| `telegraphs`            | `Telegraph[]`  | must contain every required telegraph      |

`validateQualityPreset` refuses a preset missing any of `lightning-flash`,
`water-entry-spray`, `fog-visibility-cue` or `wave-surface-motion`. Lowering
quality may remove detail; it may never remove information.

## Not yet defined

Kaiju, copilot, weapon, facility, research-node, region, and reward-table schemas don't exist yet — they
arrive with the milestone that first needs them (see [../ROADMAP.md](../ROADMAP.md)).
