# CONTENT_REGISTRY.md

Tracks every Jaeger, kaiju, copilot, location, weapon, research node, and crossover content item, plus its unlock condition and implementation status. Empty at project bootstrap — no content has been implemented yet. Populate this table as each registry entry is added in code (see GAME_SPEC.md → "Architectural Modules" for the data-registry requirement; no giant switch-statements keyed to individual names).

## Jaegers

| Name                 | Manufacturer/Origin                            | Unlock condition                | Status                                                                                                           |
| -------------------- | ---------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Placeholder Sentinel | Shatterdome Earth R&D (procedural placeholder) | always available (dev stand-in) | stats in `src/data/jaegers.ts`, asset `jaeger.placeholder-mk0` (biped generator, 75m); no gameplay behaviour yet |
| Heavy Frame Mk-4     | Shatterdome Earth R&D (procedural placeholder) | not obtainable yet              | asset only, `jaeger.heavy-mk4` (biped generator, 68m); no stats entry yet                                        |

## Asset manifests

All original procedural placeholders. No production models are installed; each falls back to the named
generator. See `src/data/assets.ts` and `docs/CONTENT_SCHEMA.md`.

| Asset id                 | Class              | Generator          | Height | Sockets           |
| ------------------------ | ------------------ | ------------------ | ------ | ----------------- |
| jaeger.placeholder-mk0   | jaeger             | biped              | 75 m   | full biped set    |
| jaeger.heavy-mk4         | jaeger             | biped              | 68 m   | full biped set    |
| kaiju.biped-alpha        | kaiju              | biped              | 82 m   | full biped set    |
| kaiju.quadruped-alpha    | kaiju              | quadruped          | 55 m   | head, chest, back |
| kaiju.serpentine-alpha   | kaiju              | serpentine         | 44 m   | head, chest       |
| building.tower           | building           | block-building     | 120 m  | none              |
| building.warehouse       | building           | block-building     | 14 m   | none              |
| vehicle.civilian-car     | vehicle            | wheeled-vehicle    | 1.5 m  | none              |
| ship.container-freighter | ship               | hull-ship          | 24 m   | back              |
| prop.cargo-crate         | prop               | prop (crate)       | 2.6 m  | none              |
| prop.shore-cannon        | prop               | prop (cannon)      | 4.2 m  | muzzle            |
| shatterdome.jaeger-bay   | shatterdome-module | shatterdome-module | 104 m  | none              |

## Kaiju

| Name         | Category (film / expanded-media / original / procedural / boss) | Unlock / spawn condition | Status |
| ------------ | --------------------------------------------------------------- | ------------------------ | ------ |
| _(none yet)_ |                                                                 |                          |        |

## Copilots

| Name         | Drift compatibility notes | Unlock condition | Status |
| ------------ | ------------------------- | ---------------- | ------ |
| _(none yet)_ |                           |                  |        |

## Locations / Regions

| Name                                                                      | Real-world basis | Status      |
| ------------------------------------------------------------------------- | ---------------- | ----------- |
| _(none yet — Phase 4 introduces the first regions: Hong Kong + one more)_ |                  | not-started |

## Weapons / Abilities

| Name         | Jaeger(s) | Status |
| ------------ | --------- | ------ |
| _(none yet)_ |           |        |

## Research Nodes

| Name         | Unlocks | Status |
| ------------ | ------- | ------ |
| _(none yet)_ |         |        |

## Crossover Content (Gundam / Evangelion / Attack on Titan)

| Name                         | Source | Normalization notes | Status      |
| ---------------------------- | ------ | ------------------- | ----------- |
| _(none yet — Phase 8 scope)_ |        |                     | not-started |

## Biomes (Milestone 05)

Seven entries in `src/data/biomes.ts`, one per climate zone, registered through
`ContentRegistry<BiomeDefinition>` and keyed by the same `ClimateZone` union the
region table uses, so a region and the terrain under it cannot disagree.

| id          | Display name | Scatter density | Notes                                          |
| ----------- | ------------ | --------------- | ---------------------------------------------- |
| polar       | Polar        | 0.05            | Ice shelf and exposed rock                     |
| subarctic   | Subarctic    | 0.35            | Cold coast and conifer; Anchorage, Vladivostok |
| temperate   | Temperate    | 0.55            | Mixed farmland and forest                      |
| subtropical | Subtropical  | 0.60            | Humid coastal hills; Hong Kong                 |
| tropical    | Tropical     | 0.75            | Dense low canopy, shallow reef water           |
| arid        | Arid         | 0.12            | Dry coast and bare rock; Lima                  |
| oceanic     | Open ocean   | 0.00            | Deep water with no land identity               |

Two supporting tables, both data rather than control flow: `SURFACE_CLASSES`
bands elevation into seabed, shallows, shore, lowland, hills, highland and peak
with a shade multiplier and a walkable flag; `CLIMATE_BANDS` maps absolute
latitude to a climate zone.

Biome affects colour and scatter only. It deliberately does not affect elevation.

## Terrain anchors (Milestone 05)

Derived from the eight regions rather than authored separately, by
`toTerrainAnchors` in `src/data/regions.ts`. `KIND_TERRAIN_SHAPE` maps region kind
to a land mask target and whether the region is populated, so the generator never
learns what a Shatterdome is. The seven land regions pull terrain to a coastal
shelf and carry city cells; the Breach pulls it to deep water and carries none.

Measured at seed 20260822: every land region has ground between 153 m and 403 m
with between 6 and 33 city cells, six of the eight keep a coastline, and the
Breach is 100 percent water with nothing built on it.

## Generated content is not registered content

City cells, traffic lanes and landmarks are generated per sector from the world
seed. They are not registry entries, carry no manifest, and are not tracked here.
When buildings become real assets they will move to the asset registry and be
listed with the rest.
