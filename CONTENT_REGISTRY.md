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
