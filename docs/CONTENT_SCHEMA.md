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

## Facility schemas (Milestone 22)

### `FacilityTier` additions (src/data/facilities.ts)

Added: `{ cost, upkeepPerDay, effects, moduleSlots, requires, stage }`. Cost and
upkeep are positive; `moduleSlots` is at least one; `requires` is a list of
`{ facilityId, tier }` that must already be standing. `effects` is a partial map
over `FACILITY_EFFECTS`: repairRate, constructionRate, trainingRate, medicalRate,
researchYield, contractYield, deliverySpeed, containmentYield, defenceStrength.

`StageVariant` is `{ lighting, signage, cranes, deliveries, note }`, where
lighting is work, flood or full and signage is none, stencil or lit. Presentation
only: the layout reads it, the simulation never does.

Two branches were added to `FACILITY_KINDS`: `medical` and `kaiju-containment`,
bringing the complex to fifteen.

### `ConstructionProject` and `WorkCapacity` (src/shatterdome/construction.ts)

A project is `{ id, facilityId, targetTier, status, priority, workRemainingTicks,
workTotalTicks, crewsHeld, crewsRequired, costPaid, sequence }`. Status is queued,
active, paused, done or cancelled. Priority is 1 to 9, most urgent first, ties
broken by the order things were queued.

`WorkCapacity` is `{ crewsAvailable, powerFactor, staffFactor, rateMultiplier }`,
injected rather than read so the queue can be tested against a brownout with no
reactor in existence. `ProjectForecast` adds `{ progress, etaTicks, etaMinutes,
stalledBecause }`.

`ConstructionSnapshot` rides inside the existing shatterdome save section:
`{ schemaVersion, projects[], sequence }`.

### `EffectTotals` (src/shatterdome/facilityEffects.ts)

One number per effect, all one when nothing is built. `resolveEffects` multiplies
across facilities and scales the part above one by how much power and staffing
the complex actually has.

## Squad schemas (Milestone 21)

### `SquadOrderDefinition` (src/data/squadOrders.ts)

`{ id, displayName, hotkey, weights, constraints, needsTarget, needsPoint,
acknowledgements, description }`. The id is one of the nine `SQUAD_ORDERS`; the
hotkey is one character and unique across the table. `weights` are per-goal
multipliers over `ALLY_GOALS`; `constraints` may carry `ammunitionFloor` in
(0, 1), `leashMeters`, `minimumRangeMeters` and `holdSignature`. An order with no
weights, no acknowledgement or too short a description is refused.

### `AllyCrewDefinition` and `AllyPerk` (src/data/allyCrews.ts)

`{ id, displayName, callsign, baseConfidence, preferredRangeMeters, aggression,
supportTendency, rivals, bias, perkTrack, description }`. Ids are prefixed
`ally.`; rivalries must be symmetric and are checked when the registry is built.
An `AllyPerk` is `{ id, displayName, sortiesRequired, bias, damageScale?,
structureScale?, note }`, learned in ascending order of sorties. No perk may
scale a number by more than fifteen percent, so an ally is help rather than the
answer.

### `AllySituation`, `AllyProfile` and `AllyIntent` (src/allies/)

`AllySituation` is everything a decision may look at: distances to the target,
the mark, the player, the anchor and the civilians; its own and the player's
structure; ammunition; whether a friendly is in the line of fire; spacing;
whether the route is blocked; and whether the player has committed.
`AllyProfile` is confidence, preferred range, aggression, support tendency and
the combined bias. `AllyIntent` is `{ crewId, goal, movePoint, targetId,
targetZoneId, fire, guard, useSignature, say, reason }`.

### `SquadSnapshot` (src/allies/squad.ts)

`{ schemaVersion, members[], settledMissions[] }`, where a member is
`{ crewId, machineId, sorties, confidence, order, learned[], history[] }`. Perks
are recomputed from the sorties that earned them on restore rather than trusted.
`MAX_SQUAD_SIZE` is 3.

## Crew schemas (Milestone 20)

### `PilotDefinition` additions (src/data/pilots.ts)

Added: `{ preferredRoles, tags, drawback, perk, injuryResistance, dialogue }`.
Tags come from `COMPATIBILITY_TAGS`; `TAG_FRICTION` lists the pairs that grate.
`injuryResistance` is within (0, 1].

`PilotDrawback` is `{ id, displayName, trigger, stabilityCost, effectivenessCost,
description }`. The id is prefixed `drawback.`, the costs must sum above zero and
neither may exceed 0.4, and the description is required because it is shown
before deployment. `DrawbackTrigger` is a union: `machine-role`,
`machine-damaged`, `night`, `rough-weather`, `long-travel`, `partner-tag` and
`carrying-injury`, each with exactly one evaluator in a table.

`PilotPerk` is `{ id, displayName, ranks, description }` with ranks arriving at
ascending link levels. A `PerkRank` is `{ linkLevel, effects, note }` where every
effect names one of `PERK_EFFECTS`: poise, heat, damage, structure, mobility,
salvage, samples, recovery. Ranks replace each other rather than stacking.

`DialogueProfile` is `{ chattiness, onDeploy, onDamage, onVictory, offDuty }`,
each list non-empty. Presentation reads it; nothing balances on it.

### `InjuryDefinition` (src/data/injuries.ts)

`{ id, displayName, severity, restriction, recoveryDays, treatmentDaysSaved,
stabilityPenalty, stressFloor, description }`. Severity is minor, serious or
severe. Restriction is one of `grounded`, `unstable`, `no-melee`, `no-gunnery`
or `short-sorties`, a fixed vocabulary so a restriction can be checked rather
than only described. Treatment must save at least a day and never the whole
recovery.

### `CrewSnapshot` (src/pilots/crew.ts)

`{ schemaVersion, members[], settledMissions[] }`. A member is
`{ pilotId, status, stress, sorties, injuries[], links, bankedToday, bankedDay,
history[] }`. A `LinkTrack` is `{ partnerId, experience, level, sorties }`, and
the level is recomputed from the experience on restore rather than trusted.
`settledMissions` is the guard against one mission result being banked twice.
`LINK_EXPERIENCE_PER_LEVEL` is 100 and `MAX_LINK_LEVEL` is 8.

### `DriftContext` and `DriftAssessment`

Context is every optional field outside the two people: machine role and
integrity, night, weather penalty, travel seconds, link level, per-pilot stress
and injury penalties. The assessment returns `{ strength, effectiveness, summary,
refused, drawbacks[], factors[] }`. `DRIFT_REFUSAL_THRESHOLD` is 0.25.

## Progression schemas (Milestone 19)

### `PassiveDefinition` (src/data/passives.ts)

`{ id, displayName, tier, structure?, damage?, heat?, mobility?, tradeoff,
description }`. Ids are prefixed `passive.`; tier is 1 to 4 and matches the level
that opens the choice. Every multiplier is positive. A passive below tier four
must have at least one multiplier under 1, because a passive that costs nothing
is a reward rather than a decision, and the tradeoff has to be written out.

### `ModuleDefinition` (src/data/modules.ts)

`{ id, displayName, moduleClass, requiresLevel, requiresPrestige, structure?,
damage?, heat?, mobility?, cost, fittingHours, tradeoff, description }`. Ids are
prefixed `module.`; class is frame, reactor, cooling, targeting or field. Cost
and fitting hours are both positive, so fitting one is a decision about money and
about time in the bay. A module with no multiplier under 1 must require prestige,
or a fresh machine could buy its way past one that earned its rank.

### `MasteryDefinition` and `MasteryCounters` (src/data/masteries.ts)

`{ id, displayName, counter, thresholds[], experiencePerRank, description }`.
Thresholds ascend, and the counter names one field of `MasteryCounters`:
`{ sorties, victories, intact, rescuedThousands, salvageTons, damageTaken }`.
Counters move once per sortie, and a threshold pays once because the rank already
paid is remembered per goal.

### `MachineGrowth` and the curve (src/jaegers/progression.ts)

`MachineGrowth` is `{ structure, damage, heat, mobility, moduleSlots, label }`,
all multipliers except the slot count. `LEVEL_CAP` is 30,
`BASE_LEVEL_EXPERIENCE` 60 and `LEVEL_CURVE_EXPONENT` 1.15, which puts a full
climb at about forty thousand experience, or roughly forty five clean sorties.
`PRESTIGE_ASYMPTOTE` is 0.6 and `PRESTIGE_HALF_RANK` 12.

`PrestigeForecast` is `{ eligible, refusal, fromRank, toRank, before, after,
netGain, levelsLost, nextLevelExperience, moduleSlotsAfter, summary }`, where
`before` and `after` are full growth objects produced by the same function that
applies the change.

## Economy schemas (Milestone 18)

### `ManufacturerDefinition` (src/data/manufacturers.ts)

`{ id, displayName, homeRegion, specialties[], baseReputation, leadTimeDays,
priceScale, refurbishedChance, refurbishedDiscount, maxConcurrentOffers,
conditions[], description }`. The id is prefixed `maker.`. Standing is within
[0, 1]; `leadTimeDays` must be a positive integer, because nothing is delivered
instantly; `priceScale` is positive; `conditions` must not be empty, because a
contract nobody has read is not a contract. `priceFor(maker, listPrice, standing)`
and `leadTimeFor(maker, standing)` apply standing, and neither can reach zero.

### Chassis economy fields (src/data/jaegers.ts)

Added to `JaegerDefinition`: `{ manufacturerId, markGeneration, provenance, role,
listPrice, upkeepPerDay, acquisition[], upgradeTracks[], balance }`.

`provenance` is one of mass-production, prototype, refit, salvage-rebuild or
legendary. `role` is one of brawler, marksman, guardian, skirmisher or siege.
`acquisition` lists the paths that can put the machine on the pad: purchase,
milestone-unlock, research-manufacture, recovery-rebuild, legendary-archive or
special-event. An `UpgradeTrack` is `{ id, displayName, steps, effect }` with at
least one step and no duplicate ids.

`ChassisBalance` is `{ durability, damage, mobility, range, tradeoff }` where each
of the first four is a `[low, high]` pair on a 0 to 1 scale and `tradeoff` says in
words what the machine gives up. Ranges, never one number: a preview that reduces
a machine to a power score cannot express a machine that is slow and unkillable.
`validateJaeger` rejects an unknown yard, a non-positive price, an unknown
acquisition path, a duplicate or empty upgrade track, and an inverted band.

### `MarketOffer`, `OfferPreview` and `MarketSnapshot` (src/world/market.ts)

`MarketOffer` is `{ id, chassisId, manufacturerId, condition, price,
leadTimeDays, rotation, conditions[], wear }`, where condition is new,
refurbished or prototype. Offers are derived from the rotation number and the
world seed rather than stored, so the same rotation always produces the same
board.

`OfferPreview` adds the readable half: names, mark, role, upkeep, affordability,
four bands as 0 to 100 percentages, the tradeoff, the fitted weapons, the upgrade
tracks and the contract terms.

`MarketSnapshot` is `{ schemaVersion, rotation, daysIntoRotation, funding,
salvageTons, researchSamples, reputation, purchasedOfferIds[], pending[],
unlocked }`. `ROTATION_DAYS` is 14 and `MAX_OFFERS` is 5.

### `MachineRecord` and `ServiceEntry` (src/jaegers/roster.ts)

A record is an owned machine, not a chassis row: `{ jaegerId, chassisId, serial,
name, acquiredBy, status, damage, hoursRemaining, sorties, level, experience,
prestige, loadout[], history[] }`. `jaegerId` is `chassisId#n` for anything
acquired during a campaign; `serial` is `CHASSIS-000N` and is never reused. A
`ServiceEntry` is `{ day, event }`, oldest first, bounded to forty lines.

## Mission schemas (Milestone 17)

### `PilotDefinition` (src/data/pilots.ts)

`{ id, name, callsign, specialisms[], neuralStability, skill, sorties,
affinities[], biography }`. Stability and skill are within (0, 1]. An affinity
must name a registered pilot and must be returned by them, and a pilot cannot be
their own drift partner. `assessDrift` turns a pair into a strength, an
effectiveness and a sentence, and refuses a pair below a third of a link.

### `ObjectiveDefinition` (src/missions/objectives.ts)

| Field                              | Meaning                                       | Constraint            |
| ---------------------------------- | --------------------------------------------- | --------------------- |
| `briefing`                         | What the sortie is told, in the second person | required              |
| `weight`                           | Share of the mission's reward it carries      | within (0, 1]         |
| `critical`                         | Whether failing it fails the mission          | read by the lifecycle |
| `progress` / `complete` / `failed` | Pure functions of one `MissionProgress`       | must be functions     |
| `describe`                         | Where it stands, in words                     | must be a function    |

`MissionProgress` is the single object every objective reads: kaiju totals and
losses, machine and city integrity, trapped and rescued civilians, samples,
salvage, escort state, elapsed and limit seconds, and contamination.

### `DeploymentPlan`

`{ jaegerId, pilotIds, weaponIds[], consumables, allyIds[], arrivalBearingDeg,
priorities[] }`.

### `ReadinessReport`

`{ readiness, driftStrength, machineIntegrity, travelSeconds, logisticsLoad,
overloaded, weather, underwater, predictedThreat, refusals[], warnings[] }`.

### `MissionSnapshot`

`{ schemaVersion, id, incidentId, regionId, phase, plan, objectives[],
carrierSeconds, carrierTotalSeconds, elapsedSeconds, seed, results }`. Phases are
`planning`, `carrier`, `active`, `results` and `closed`.

### `MissionResults`

Outcome, objective score, per-objective detail, machine damage, repair hours,
city impact, salvage, samples, civilians rescued, reputation, drift link change,
experience, funding, a replay (seed, plan and events), a ledger of labelled
lines with reasons, and a summary.

### What is saved

`ROOT_SAVE_VERSION` is 9. A new `mission` section carries the sortie in progress
or `null` when nobody is out. Migration step `"8"` sets it to `null` for a
version 8 save, which could not have had one.

## Attack director schemas (Milestone 16)

### `MutationDefinition` (src/data/mutations.ts)

| Field                                                       | Meaning                                                 | Constraint                                          |
| ----------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| `kind`                                                      | armour, offence, mobility, sensory, resilience or swarm | one of the six                                      |
| `cost`                                                      | What it takes out of the director's budget              | a positive integer                                  |
| `damageScale` / `armourScale` / `speedScale` / `senseScale` | Multipliers on the creature                             | above zero                                          |
| `resistances`                                               | Extra resistance per damage kind                        | zero or more                                        |
| `grantsMedia`                                               | Media it opens up, such as water for a walker           | read by navigation                                  |
| `excludes`                                                  | Mutations it cannot appear with                         | must name registered mutations                      |
| `minimumEscalation`                                         | When the director may start considering it              | within [0, 1]                                       |
| `tell`                                                      | What a warning is allowed to say about it               | required: a warning has to be able to say something |

A mutation that changes nothing at all is refused at registration.

### `Incident` (src/world/director.ts)

`{ id, regionId, originBearingDeg, originDistanceMeters, approachBearings[],
combatants[], mutationBudget, warningConfidence, targetPriorities[], objective,
secondaryObjectives[], createdTick, arrivalTick, status, strength }`. Statuses
are `forecast`, `inbound`, `landed`, `resolved` and `expired`. Objectives are
`defend`, `intercept`, `pursue`, `rescue`, `contain`, `escort`, `research` and
`salvage`.

### `Resolution`

`{ incidentId, regionId, kind, held, integrityLost, escalationDelta, reward,
ledger[], summary }`, where every `ledger` line is `{ label, value, reason }`.
Resolution kinds are `player-defended`, `ai-defended`, `ignored` and
`abandoned`.

### `DirectorSnapshot`

`{ schemaVersion, escalation, breachPressure, crisisFrequency, nextRollTick,
quietUntilTick, incidentSeq, regions[], incidents[], recentRegionIds[],
unresolved }`. A region record carries its threat, defence, last chosen tick,
cooldown, and how many incidents there the player defended or ignored.

### What is saved

`ROOT_SAVE_VERSION` is 8. The new `director` section carries the whole war.
Migration step `"7"` gives a version 7 save the campaign's opening state, which
is the only honest reading of a file written before attacks existed as a
strategic system.

## Kaiju framework schemas (Milestone 15)

### `LocomotionFamilyDefinition` (src/data/locomotionFamilies.ts)

Nine families: biped, quadruped, serpentine, winged, burrower, swimmer,
amphibious, crawler, colossal.

| Field                                  | Meaning                                              | Constraint                                             |
| -------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| `media`                                | Ground, water, underground, air or wall              | at least one; must include `preferredMedium`           |
| `groundSpeedMps` / `preferredSpeedMps` | How fast it is out of and in its element             | above zero                                             |
| `turnRateDegPerSecond`                 | Heading change while moving                          | above zero                                             |
| `turnInPlaceDegPerSecond`              | Heading change while stationary                      | zero or more; **zero means it genuinely cannot**       |
| `stepUpMeters` / `maxSlopeDeg`         | What it can step over and walk up                    | slope within (0, 90]; a climber may not refuse a slope |
| `canClimb` / `ignoresRubble`           | Whether a wall or rubble stops it                    | read by navigation, never switched on                  |
| `transitionSeconds` / `widthPerHeight` | Cost of changing medium, and how wide a gap it needs | zero or more; width above zero                         |

### `SenseProfile` (src/kaiju/senses.ts)

`{ kind, rangeMeters, decayPerSecond, arcDeg, occlusionScale, waterScale }` for
each of `sight`, `sound`, `vibration`, `scent`, `threat`, `objective` and
`damage-memory`. Arc is within (0, 180], where 180 means all the way round. A
creature definition overrides one kind at a time; anything it does not mention
keeps the default.

A `SenseContact` is `{ sourceId, east, north, confidence, kind, ageSeconds,
damageDealt }`: where something **was**, not where it is.

### Goals (src/kaiju/behavior.ts)

Eleven rows, each with a pure `score(situation, profile)` and an `explain`. The
situation is distance, contact confidence, health, poise, damage taken,
objective and feed distances, medium, water and climbable nearby, whether the
route is blocked, frustration and phase. The profile is per-goal weights plus
caution, objective focus, appetite, enrage threshold and the locomotion family.

### `KaijuDefinition` additions

| Field         | Meaning                                                            | Constraint                                               |
| ------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| `locomotion`  | Names a locomotion family                                          | must be a registered family                              |
| `senses`      | Overrides on the default profiles                                  | each profile validated                                   |
| `behavior`    | Weights and traits                                                 | traits within [0, 1]; weights zero or more               |
| `organs`      | `{ id, displayName, zoneId, health, grants[], description }`       | must sit on a zone this creature has and grant something |
| `armor`       | `{ zoneId, health, absorption, description }`                      | absorption strictly between none and all                 |
| `severable`   | `{ zoneId, disables[], movementScale, description }`               | severing must cost something                             |
| `resistances` | Multiplier per damage kind                                         | zero or more                                             |
| `prefers`     | Media it would rather be in                                        | at least one                                             |
| `phases`      | `{ id, displayName, below, damageScale, speedScale, description }` | thresholds must descend and sit strictly inside a fight  |

### What is saved

Nothing new. A creature's senses, goal, frustration, armour, organs and severed
limbs are live state belonging to the fight they happened in, and a fight is not
saved. `ROOT_SAVE_VERSION` stays at 7.

## Destruction schemas (Milestone 14)

### `BuildingArchetype` (src/data/buildings.ts)

One row per kind of structure a district builds with.

| Field                                         | Meaning                                                | Constraint                                             |
| --------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| `districts`                                   | Districts that build with it; empty means anywhere     | looked up, never switched on                           |
| `structurePerMeter`                           | How much punishment it takes per metre of height       | above zero                                             |
| `fractured` / `fractureChunks`                | Whether it is worth authoring chunks for, and how many | a fractured archetype needs at least four; others zero |
| `debrisYield`                                 | Chunks a collapse offers the pool                      | above zero                                             |
| `collapseSeconds`                             | How long the collapsing state lasts                    | above zero                                             |
| `rubbleHeightFraction`                        | How tall the rubble pile stands                        | within [0, 1]                                          |
| `fireChance` / `contaminationChance`          | Rolled once per collapse from a seeded stream          | within [0, 1]                                          |
| `occupancyThousands`                          | People at risk per structure                           | zero or more                                           |
| `clearHours` / `rebuildHours` / `rebuildCost` | What it costs to put right                             | rebuildHours must exceed clearHours                    |

### Building states

`intact` above 0.85 integrity, `damaged` above 0.55, `breached` above 0.15,
then `collapsing`, `ruined`, `cleared` and `rebuilding`, which are reached by
time and work rather than by damage. Derived, never stored.

### `RegionDamageSnapshot` (src/world/destruction.ts)

`{ schemaVersion, regionId, groups[], landmarks[], projects[] }`. A group record
is seven numbers: `{ id, integrity, down, fire, contamination, rubble, trapped }`.
A landmark record is an id and a state. A project is a group, a phase
(`clearing` or `rebuilding`), hours and funding still owed. Only touched blocks,
non-intact landmarks and running projects are written, so an untouched city
saves three empty arrays.

### What is saved

`ROOT_SAVE_VERSION` is 7 and `WORLD_SCHEMA_VERSION` is 4. Every region record
now carries a `damage` snapshot alongside its integrity, safety rating and
alert. Migration step `"6"` gives a version 6 save an undamaged snapshot per
region, which is the only honest reading of a file written when damage did not
survive a fight.

## Damage schemas (Milestone 13)

### `ComponentDefinition` (src/data/components.ts)

One row per part of a Jaeger. Generic across machines and scaled by each
machine's own mass, so a new chassis is a row in `jaegers.ts` rather than a new
component table.

| Field                                                    | Meaning                                             | Constraint                                          |
| -------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| `heightFraction` / `lateralFraction` / `forwardFraction` | Where it sits, as fractions of the machine's height | height and radius must be above zero                |
| `radiusFraction`                                         | How big a target it is                              | above zero                                          |
| `healthShare`                                            | Share of the machine's structure                    | all shares together must total exactly one          |
| `armor` / `damageMultiplier`                             | What it absorbs and what gets through               | armour between zero and one                         |
| `vulnerableTo`                                           | Damage-kind routing, by kind                        | every multiplier above zero; anything unlisted is 1 |
| `disables`                                               | Systems that stop when it is lost                   | see the system list below                           |
| `mounts`                                                 | Weapon mounts carried here                          | lost with the component                             |
| `critical`                                               | Whether losing it ends the sortie                   | at least one component must be critical             |
| `repairHoursPerPoint` / `repairCostPerPoint`             | What it costs to put right                          | both above zero                                     |

A component that disables nothing, carries no mount and is not critical is
refused at registration: losing a part has to cost something.

**Systems**: `pilot`, `power`, `cooling`, `sensors`, `targeting`, `movement`,
`balance`, `weapons.left`, `weapons.right`, `grapple`.
**Mounts**: `arm.left`, `arm.right`, `shoulder.left`, `shoulder.right`, `chest`.
Every weapon names one, and a weapon whose mount is gone is refused in words.

### Component states

`intact` above 90 percent, `scarred` above 65, `damaged` above 35, `critical`
above zero, `destroyed` at zero. Derived from health, never stored.

### `Scar`

`{ componentId, severity, kind, seed }`. Four numbers, and the only thing about
visible damage that is saved. The view places the debris from the seed. Bounded
at twenty-four per machine, keeping the worst rather than the newest.

### `RepairOrder`

`{ jaegerId, lines, totalHours, totalCost, scarsCleared, summary }`, with one
line per damaged component carrying what is missing, its state, its hours, its
cost and whether it is a replacement rather than a patch. A replacement costs
half again. Lines are ordered worst first.

### The roster (src/jaegers/roster.ts)

One record per machine: `{ jaegerId, status, damage, hoursRemaining, sorties }`.
Statuses are `ready`, `deployed`, `recovering`, `repairing`, `rebuilding`. A
machine below 25 percent structure is rebuilt rather than repaired; one that lost
a leg or a critical component is towed home first, which takes twelve hours.

### What is saved

`ROOT_SAVE_VERSION` is 6. The new `roster` section carries, per machine, its
status, hours owed, sorties and a damage snapshot of one fraction per component
plus the scar list. Migration step `"5"` gives a version 5 save a full roster of
undamaged machines, which is the only honest reading of a file written when
damage did not survive a fight.

## Ranged schemas (Milestone 12)

### `WeaponDefinition` (src/data/weapons.ts)

One row per weapon. Eight behaviours share one code path: `projectile`, `beam`,
`cone`, `arc`, `salvo`, `mortar`, `tether`, `channel`.

| Field                                             | Meaning                                                        | Constraint                                                       |
| ------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `behavior`                                        | How the shot resolves                                          | one of the eight above                                           |
| `magazine` / `reserve` / `reloadTicks`            | Rounds carried, spares, and how long a reload takes            | a reserve must be at least a magazine; a magazine needs a reload |
| `cooldownTicks`                                   | Ticks before it may fire again                                 | zero or more                                                     |
| `heatCost` / `reactorDrawMw`                      | What one shot costs in heat and in power                       | see the rule below                                               |
| `recoilMps`                                       | How hard firing pushes the machine back                        | zero or more                                                     |
| `rangeMeters` / `minimumRangeMeters`              | The band it works in                                           | indirect fire must have a minimum range                          |
| `projectileSpeedMps`                              | How fast a body travels                                        | zero for anything that resolves instantly                        |
| `spreadDeg` / `salvoCount` / `salvoIntervalTicks` | Scatter, bodies per pull, and the gap between them             | a salvo of one is refused                                        |
| `aim`                                             | `any`, `forward-arc` or `locked-only`                          | enforced when firing, with the reason in words                   |
| `underwaterScale`                                 | What it is worth in the sea                                    | above zero                                                       |
| `friendlyFire`                                    | Whether it can hit an ally                                     | read by ability scoring                                          |
| `damage`                                          | Amount, kind, zone bias and reaction                           | one of the eleven damage kinds                                   |
| `tags`                                            | Ability tags: `breach`, `pull`, `sustained`, `burst`, and more | at least one                                                     |
| `status`                                          | Status effect it leaves behind, its length and stack ceiling   | must name a registered status                                    |
| `coaching`                                        | Plain language for the panel and the move list                 | required                                                         |

**Ranged fire is never free.** A weapon that costs no ammunition, no heat and no
reactor draw is refused at registration rather than becoming permanent damage
per second. Registration also refuses indirect fire with no minimum range, a
beam with a projectile speed, a salvo of one, a reserve smaller than a magazine,
and a magazine that reloads instantly.

### `StatusDefinition` (src/combat/abilities.ts)

`{ id, displayName, damagePerTick, damageKind, movementScale, damageOutputScale,
disables, quenchedByWater, description }`. A status that does nothing at all is
refused. Water puts out anything marked `quenchedByWater`, which is the one place
the environment reaches directly into a fight. Five are registered: burning,
shocked, bleeding, corroded and tethered.

### Damage kinds

Extended from four to eleven, shared by melee and ranged: `impact`, `crush`,
`shear`, `pierce`, `heat`, `energy`, `plasma`, `corrosive`, `electrical`,
`radiation`, `neural`.

### Nothing new is saved

`ROOT_SAVE_VERSION` stays at 5. Magazines, heat and running status effects are
live state that belongs to the fight they happened in. Damage that survives a
battle arrives with Milestone 13.

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

## Research nodes (Milestone 24)

`src/data/research.ts`. Registered through `ContentRegistry` with
`validateResearchNode`, and prerequisites are checked after every node is in, so
a node may be authored before the one it depends on.

| Field              | Type                         | Notes                                            |
| ------------------ | ---------------------------- | ------------------------------------------------ |
| `id`               | string                       | Must start with `research.`                      |
| `branch`           | ResearchBranch               | One of nine                                      |
| `requires`         | string[]                     | Node ids. No self-reference, no duplicates       |
| `samples`          | { sampleId, count }[]        | Count above 4 is refused as a grind              |
| `dataCost`         | number                       | Research data spent on starting                  |
| `fundingCost`      | number                       | Credits spent on starting                        |
| `requiresFacility` | { facilityId, tier } or null | Checked against what is standing and operational |
| `staffRequired`    | number                       | Researchers occupied while it runs               |
| `researchTicks`    | number                       | Work at full effectiveness                       |
| `benefits`         | ResearchBenefit[]            | At least one. Capability kinds only              |
| `experiment`       | string                       | Shown while it runs                              |
| `description`      | string                       | What it is for                                   |

## Samples (Milestone 24)

`src/data/samples.ts`. Registered with `validateSample`.

| Field          | Type                   | Notes                                                     |
| -------------- | ---------------------- | --------------------------------------------------------- |
| `id`           | string                 | Must start with `sample.`                                 |
| `sampleClass`  | common / rare / exotic | The same scale the economy grades tissue by               |
| `trigger`      | SampleTrigger          | One of eight conditions                                   |
| `zoneId`       | BodyZoneId             | Required for `zone-destroyed`                             |
| `mutationKind` | MutationKind           | Required for `mutation`                                   |
| `qualifier`    | string                 | Required for `damage-kind`, `environment` and `objective` |
| `yieldCount`   | number                 | 1 to 4. Above four is refused as a grind                  |
| `description`  | string                 | What it is                                                |

## Manufacture recipes (Milestone 24)

`src/research/manufacture.ts`. Registered with a validator that also checks the
chassis exists and is marked `research-manufacture`, so a recipe cannot exist for
something that can simply be bought. A recipe with no researched component is
refused for the same reason.

## Jaeger parts (Milestone 25)

`src/data/parts.ts`. Registered through `ContentRegistry` with `validatePart`.

| Field                 | Type                                 | Notes                                                     |
| --------------------- | ------------------------------------ | --------------------------------------------------------- |
| `id`                  | string                               | Must start with `part.` and name its own slot             |
| `slot`                | PartSlot                             | One of twelve                                             |
| `massTons`            | number                               | Structural parts must weigh something; cosmetics must not |
| `massHeight`          | 0 to 1                               | 0 at the feet, 1 at the head. Drives balance              |
| `powerOutputMw`       | number                               | Reactors only                                             |
| `powerDrawMw`         | number                               | At sustained load                                         |
| `heatOutput`          | number                               | At sustained load                                         |
| `heatDissipation`     | number                               | Armour, torsos and reactors carry most of it              |
| `armorRating`         | 0 to 1                               | Averaged across the machine by structure                  |
| `actuatorCapacity`    | number                               | Legs, arms and the drive                                  |
| `mobilityScale`       | above 0                              | Legs set the pace; others move it by 0.4 of their delta   |
| `ammunitionVolume`    | number                               | Negative on weapons, which consume it                     |
| `provides`/`requires` | Fitting[]                            | Requiring several means any one will do                   |
| `silhouette`          | { heightScale, bulk, shoulderRatio } | Proportions fed to the procedural generator               |
| `tradeoff`            | string                               | Required. The honest sentence about the cost              |

## Blueprints (Milestone 25)

A blueprint is an id, a name, one array of part ids per slot, and free emblem
text. Nothing derived is ever stored: the chassis, the stats and the silhouette
are recomputed from the parts every time, so rebalancing a part reaches a saved
design immediately.

## Sites (Milestone 26)

`src/data/sites.ts`. Registered through `ContentRegistry` with `validateSite`.

| Field                                     | Type                                    | Notes                                                             |
| ----------------------------------------- | --------------------------------------- | ----------------------------------------------------------------- |
| `id`                                      | string                                  | Must start with `site.` and name its own kind                     |
| `kind`                                    | SiteKind                                | One of eight                                                      |
| `requires.kinds`                          | RegionKind[]                            | Required and non-empty. All five kinds with no climate is refused |
| `requires.climates`                       | ClimateZone[]                           | Empty means any climate                                           |
| `requires.minPopulationThousands` / `max` | number                                  | The band the region has to sit in                                 |
| `requires.requiresDamage`                 | boolean                                 | True for things that only happen where a city was hit             |
| `weight`                                  | number                                  | Relative likelihood against other sites fitting the same region   |
| `reward`                                  | funding, alloy, researchData, sampleIds | Taken once, ever                                                  |
| `becomesDeployPoint`                      | boolean                                 | Whether reaching it opens somewhere the carrier will drop you     |
| `discoveredBy`                            | DiscoverySource[]                       | Non-empty. Omitting `exploration` makes it chart-only             |
| `danger`                                  | 0 to 1                                  | What standing there costs, shown in words                         |

A site must be worth reaching: it either pays something or opens a deployment
point, and the validator refuses one that does neither.

## Exploration state (Milestone 26)

Only two things are stored: which sites have been found and how, and which have
been claimed. The sites themselves are placed from the world seed, so adding,
removing or rebalancing them needs no migration.
