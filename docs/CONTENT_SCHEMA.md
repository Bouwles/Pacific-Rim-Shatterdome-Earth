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

## City schemas (Milestone 07)

### `DistrictDefinition` (src/data/districts.ts)

A rule for making blocks, not a set of them.

| Field                        | Type           | Constraint                                   |
| ---------------------------- | -------------- | -------------------------------------------- |
| `id`                         | `DistrictKind` | one of the seven district kinds              |
| `blockSizeMeters`            | `number`       | positive                                     |
| `streetWidthMeters`          | `number`       | non-negative                                 |
| `minHeightMeters`            | `number`       | non-negative                                 |
| `maxHeightMeters`            | `number`       | not below `minHeightMeters`                  |
| `coverage`                   | `number`       | 0 to 1; fraction of the wedge actually built |
| `towersPerBlock`             | `number`       | positive integer                             |
| `irregularity`               | `number`       | 0 to 1; zero is a perfect grid               |
| `colour`                     | `[n,n,n]`      | three channels within 0 to 1                 |
| `neonDensity`                | `number`       | 0 to 1                                       |
| `populationDensityThousands` | `number`       | non-negative; per square kilometre           |
| `evacuationPriority`         | `number`       | positive integer; 1 clears first             |
| `coastal`                    | `boolean`      | true where harbour lanes can reach           |

`DistrictPlacement` positions one district as a wedge: inner and outer radius as
fractions of the region radius, a bearing offset measured from the seaward
bearing, and an arc width. Offsets are relative to the water so the plan rotates
with the coast instead of being pinned to north.

### `CityAlertState` (`CITY_ACTIVITY_SCHEMA_VERSION = 1`)

`{ schemaVersion, level, sinceTick, evacuationProgress }`, carried on every
region record. The only authoritative city state; everything else about the city
is derived from it plus the layout, the clock and the weather.

`level` is one of `calm`, `watch`, `warning`, `attack`, `recovery`. `sinceTick`
is when that level was entered and drives the response ramp. `evacuationProgress`
runs 0 to 1 and falls back during recovery, so a cleared city repopulates.

### `AlertProfile` (src/world/cityActivity.ts)

One row per level: multipliers for civilian, vehicle, shipping, aircraft and
military activity, a siren intensity, an evacuation rate per tick, and whether the
level is evacuating at all. A table rather than a branch, so every consumer reads
the same numbers.

### `CityLayout` (`CITY_LAYOUT_SCHEMA_VERSION = 1`)

Generated, never authored and never saved. Contains blocks, landmark slots,
roads, harbour lanes, air corridors, evacuation zones, defence positions,
destruction groups, deployment routes, summary stats and a content digest.

Every element carries a stable id derived from the region id. Blocks carry a
`groupId` naming their destruction group, and each block belongs to exactly one
group, so damage cannot double-count.

`LandmarkSlot.assetSlot` names the asset manifest id the slot will host once a
real model exists. Nothing resolves it yet; it is the named slot the asset
pipeline was built for, and the Shatterdome landmark points at
`shatterdome.jaeger-bay`.

### Quality city budgets

`QualityPreset` gained `maxCityBlocks`, `maxCityAgents` and `maxCityGroups`. A
preset with fewer than one block or one group is refused: a city with no blocks
is not a lower quality city, it is an absent one, and absence is information
rather than detail. `city-alert-state` joined the required telegraph list, so no
preset may stop showing what the alert level is.

## Shatterdome schemas (Milestone 08)

### `FacilityDefinition` (src/data/facilities.ts)

| Field                                          | Type             | Constraint                                         |
| ---------------------------------------------- | ---------------- | -------------------------------------------------- |
| `id`                                           | `FacilityKind`   | one of the thirteen facilities                     |
| `deck`                                         | `number`         | integer; negative is below the waterline           |
| `widthMeters` / `depthMeters` / `heightMeters` | `number`         | positive; height at least 3 so a person fits       |
| `floorColour` / `accentColour`                 | `[n,n,n]`        | three channels within 0 to 1                       |
| `stations`                                     | `StationSpec[]`  | at least one, and at least one `terminal`          |
| `startsBuilt`                                  | `boolean`        | true for the facilities a new campaign begins with |
| `tiers`                                        | `FacilityTier[]` | numbered 1..n in order                             |

Each `FacilityTier` carries `constructionTicks`, `crewRequired`, `powerDrawMw`,
`powerOutputMw` (reactor only), `crewProvided` (logistics only), `staffSlots`,
`fixtures` and a `benefit` sentence. Validation refuses a tier that does not add
fixtures or take longer than the tier below it, and refuses power output from
anything but the reactor so the balance stays one sum.

`FACILITY_CONNECTIONS` joins the rooms with `door`, `lift` or `tram` edges.
`validateConnections` rejects unknown endpoints, self-links, duplicates and any
facility nothing connects to.

### `CrewMember` (src/data/personnel.ts)

`{ id, name, role, facilityId, shift, lines, notes }`. Lines are templates whose
placeholders are filled from live state: `{facility} {tier} {status} {power}
{crews} {staff} {time}`. Validation rejects a placeholder nothing can fill, so a
typo cannot reach the screen as raw braces. These are original characters written
for this project, not film characters.

### `ShatterdomeSnapshot` (`SHATTERDOME_SCHEMA_VERSION = 1`)

`{ schemaVersion, facilities, location, selectedJaegerId }`, saved as its own
section of the envelope.

A `FacilityRecord` is `{ facilityId, tier, status, targetTier,
workRemainingTicks, crewsHeld }` with status one of `absent`, `building`,
`operational`, `upgrading`. Validation rejects the states that cannot exist: an
absent facility at a non-zero tier, an operational one at tier zero, a build with
no work left, or a facility holding crews with no order running.

`location` is `{ roomId, x, z, yawDeg }` in the room's own frame, and is checked
against the rooms this build knows about rather than trusted.

### `InteriorLayout` (`INTERIOR_LAYOUT_SCHEMA_VERSION = 1`)

Generated, never authored and never saved. Rooms carry obstacles, interactables,
staff posts, spawn points, fixture count and a construction flag. Every id is
stable and derived from the facility id.

`Interactable.kind` is one of `terminal`, `staff-post`, `berth`, `conn-pod`,
`transit`. A transit to a facility that has not been built carries a
`sealedReason` instead of a target room.

### Quality interior budget

`QualityPreset` gained `maxInteriorStaff`: how many crew instances the active
room draws. A preset below one is refused, because an empty room is not a cheaper
room, it is an abandoned one.

## Locomotion schemas (Milestone 09)

### `LocomotionProfile` (src/data/jaegers.ts)

Every field is positive and validated; the ones with a relationship are checked
against each other rather than only for sanity.

| Field                                                             | Meaning                                                               | Constraint             |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------- |
| `heightMeters`                                                    | Machine height; drives camera framing, water states and stride limits | > 0                    |
| `walkSpeedMps` / `runSpeedMps`                                    | Cruise and committed pace                                             | run > walk             |
| `strafeSpeedMps` / `guardSpeedMps`                                | Sidestep and guarded pace                                             | both <= walk           |
| `accelerationMps2` / `brakingMps2`                                | How long mass takes to gather and to shed                             | > 0                    |
| `turnRateDegPerSecond`                                            | Turn authority while moving                                           | < turn-in-place        |
| `turnInPlaceRateDegPerSecond`                                     | Turn authority while planted                                          | > 0                    |
| `stepUpMeters`                                                    | Ledge height it walks onto                                            | <= a quarter of height |
| `maxSlopeDeg`                                                     | Steepest climbable ground                                             | < 90                   |
| `strideMeters`                                                    | Metres per footfall; the animation contract                           | <= height              |
| `boosterImpulseMps` / `boosterSeconds` / `boosterRechargeSeconds` | Burst thrust                                                          | > 0                    |
| `landingImpulseScale`                                             | Camera impulse per metre per second of fall                           | > 0                    |
| `getUpSeconds`                                                    | How long it takes to stand back up                                    | > 0                    |

### `JaegerStateDefinition` (src/jaegers/locomotion.ts)

`{ id, speedFactor, turnFactor, acceptsInput, minSeconds, planted, reaction,
description }` for each of the twenty states. Validation rejects a state that
ignores the player while keeping full turn authority, and every state needs a
description, because the table is the documentation.

### `CameraRig` and `CameraComfort` (src/jaegers/camera.ts)

Rig geometry is expressed in multiples of machine height (`distanceMeters: 2.6`
means 2.6 body heights back). `validateComfort` rejects a shake scale outside 0
to 1, a field of view offset beyond 25 degrees either way, and a sensitivity of
zero.

### Quality budgets added

`maxFootstepDecals` and `maxScaleReferences` join the preset table.
`maxScaleReferences` has a floor of 8 and `maxFootstepDecals` a floor of 4: how
big the machine is counts as information rather than detail, so no preset may
drop it to nothing.

### Nothing new is saved

A pilot session is live state. `ROOT_SAVE_VERSION` is unchanged at 5 and no
migration was added.

## Combat schemas (Milestone 10)

### `MoveDefinition` (src/data/moves.ts)

| Field                                            | Meaning                                                 | Constraint                                                             |
| ------------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `startupTicks` / `activeTicks` / `recoveryTicks` | Phase lengths at 60 ticks a second                      | whole numbers, at least 1                                              |
| `turnAuthority`                                  | Fraction of turn rate kept while the move runs          | 0 to 1                                                                 |
| `movement`                                       | Forward metres per second between two ticks of the move | any                                                                    |
| `armor`                                          | `none`, `light` or `super`                              | enumerated                                                             |
| `cancelInto` / `cancelFromTick` / `cancelToTick` | What it cancels into and when                           | window must open at or after the active frames and end inside the move |
| `cancelRequiresHit`                              | Whether the window only opens on a connect              | boolean                                                                |
| `volumes`                                        | Swept capsules with their own live windows              | at least one; each must be live, and inside the active frames          |
| `damage`                                         | One `DamagePacket`                                      | amount above zero, shock a fraction                                    |
| `staminaCost` / `heatCost`                       | What it costs to throw                                  | zero or more                                                           |
| `cues`                                           | Wind-up, impact and whiff cue ids                       | all three required                                                     |

`DamagePacket` is `{ amount, kind, poise, guardDamage, knockbackMps,
componentShock, reaction }`, where `reaction` is what a clean unguarded hit asks
for and the reaction table decides what it gets.

### `KaijuDefinition` (src/data/kaiju.ts)

`{ id, name, category, heightMeters, massTons, poise, staggerSeconds,
finisherThreshold, zones }`. Every zone carries `{ heightFraction,
forwardMeters, lateralMeters, radiusMeters, health, armor, damageMultiplier,
onDestroyed }`. Validation requires exactly one zone whose `onDestroyed` is
`kill`, rejects duplicate zones, armour outside 0 to 1, and a finisher threshold
that is not a fraction.

### `CombatProfile` (src/combat/arena.ts)

Derived, never authored: a Jaeger's heat dissipation comes from the cooling
capacity already on its roster entry, and its poise and guard from its mass. A
kaiju's poise comes from its own definition.

### `CombatEvent`

`{ tick, type, actorId, targetId, moveId, volumeId, zoneId, damage, reaction,
contact, reason }`. Types are `attack-started`, `attack-cancelled`,
`attack-rejected`, `hit`, `guarded`, `whiffed`, `reaction`, `zone-destroyed`,
`defeated`, `overheated`, `recovered`.

### Nothing new is saved

`ROOT_SAVE_VERSION` stays at 5. A fight is live state, and per-component damage
that survives a battle belongs to its own milestone.

## Melee schemas (Milestone 11)

### `MoveDefinition` additions

All optional, so every move written before this milestone still validates.

| Field                                | Meaning                                                          | Constraint                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `direction`                          | Which way the stick was pushed for this variant                  | one of neutral, forward, back, side                                                          |
| `chargeTicks` / `chargedDamageScale` | Wind-up length and what a full charge is worth                   | a chargeable move must scale above 1                                                         |
| `requiresPropTag`                    | Prop tag needed in hand, or `any`                                | refused with no prop in hand                                                                 |
| `defense`                            | Dodge, block or parry windows                                    | a dodge needs invulnerable frames, a block or parry a perfect window, a parry a counter move |
| `grapple`                            | Reach, hold length, escape difficulty, clearance, throw distance | clearance must cover the throw distance                                                      |
| `finisher`                           | Beats, guaranteed damage, interruptibility, clearance            | at least one beat, damage above zero                                                         |
| `coaching`                           | Plain language for the move list                                 | required on every move                                                                       |

Only a `finisher` move may carry a finisher, and only a `grapple` move a grapple.

### `PropDefinition` (src/data/props.ts)

`{ id, displayName, tag, massTons, reachMeters, damageScale, startupPenaltyTicks,
swingsBeforeBreaking, clearanceMeters, sourceKind }`. Validation refuses a prop
that adds damage without adding startup, and one whose clearance is smaller than
its own reach. `PropInstance` carries what is left of one in the world:
`{ instanceId, propId, east, north, swingsLeft, heldBy }`.

### `SpaceQuery` (src/combat/finisher.ts)

`{ isClear(east, north, radius), inLoadedWorld(east, north),
waterDepthMeters(east, north) }`. Injected into the arena; `OPEN_GROUND` is the
default and what tests use. Finishers refuse deeper than 24 m of water.

### Nothing new is saved

`ROOT_SAVE_VERSION` stays at 5. A fight, a hold and a finisher are all live
state, and the accessibility settings are session settings on the arena.

## Not yet defined

Kaiju, copilot, weapon, facility, research-node, region, and reward-table schemas don't exist yet — they
arrive with the milestone that first needs them (see [../ROADMAP.md](../ROADMAP.md)).
