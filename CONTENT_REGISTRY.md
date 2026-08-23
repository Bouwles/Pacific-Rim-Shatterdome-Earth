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

## Climate weather profiles (Milestone 06)

Seven entries in `src/data/climates.ts`, one per climate zone, registered through
`ContentRegistry<ClimateWeatherProfile>` and keyed by the same `ClimateZone`
union regions, biomes and terrain use.

| id          | Base temp | Daily swing | Base wind | Excludes  |
| ----------- | --------- | ----------- | --------- | --------- |
| polar       | -18 C     | 6 C         | 9 m/s     | rain      |
| subarctic   | -2 C      | 9 C         | 8 m/s     | nothing   |
| temperate   | 13 C      | 10 C        | 6 m/s     | nothing   |
| subtropical | 23 C      | 8 C         | 6 m/s     | snow      |
| tropical    | 28 C      | 6 C         | 5 m/s     | snow      |
| arid        | 21 C      | 16 C        | 7 m/s     | fog, snow |
| oceanic     | 17 C      | 4 C         | 12 m/s    | snow      |

Weights are relative likelihoods, chosen for gameplay variety rather than from
climate records, which is the same standard the region table already sets. A zero
excludes a kind outright: the arid profile is guaranteed never to snow.

Six weather kinds are defined in `src/world/weather.ts` as a table of effects:
clear, cloudy, rain, storm, fog and snow. Each declares cloud cover,
precipitation, fog density, wind multiplier, lightning chance, visibility,
temperature offset and whether precipitation is frozen.

## Quality presets (Milestone 06)

Four entries in `src/data/quality.ts`: Low, Medium, High and Cinematic. High is
the default. Every field is a budget a system reads directly, listed in
docs/PERFORMANCE_BUDGETS.md.

Four required telegraphs are declared and enforced: `lightning-flash`,
`water-entry-spray`, `fog-visibility-cue` and `wave-surface-motion`. The registry
refuses a preset that drops any of them, because lowering quality may remove
detail and never information.

## Depth zones (Milestone 06)

Five bands in `src/world/ocean.ts`, shallowest first: shoreline, shallows, shelf,
deep and abyssal. Each carries underwater visibility, a darkness fraction and
whether a body can stand there. These are gameplay bands rather than oceanography
and are not registry entries, because nothing authors them.

## Districts (Milestone 07)

Seven entries in `src/data/districts.ts`, registered through
`ContentRegistry<DistrictDefinition>`. A district is a rule for making blocks, so
these numbers are a grammar rather than a set of buildings.

| id          | Display name         | Block size | Heights     | Towers | Density | Evac |
| ----------- | -------------------- | ---------- | ----------- | ------ | ------- | ---- |
| downtown    | Central towers       | 110 m      | 90 to 420 m | 2      | 42k/km2 | 2    |
| waterfront  | Harbour front        | 130 m      | 40 to 240 m | 1      | 28k/km2 | 1    |
| docks       | Container docks      | 190 m      | 12 to 46 m  | 1      | 4k/km2  | 3    |
| slums       | Bone Slums           | 58 m       | 8 to 54 m   | 4      | 96k/km2 | 1    |
| shatterdome | Shatterdome precinct | 240 m      | 30 to 110 m | 1      | 3k/km2  | 5    |
| hillside    | Ridge terraces       | 96 m       | 24 to 120 m | 2      | 18k/km2 | 4    |
| industrial  | Works and yards      | 160 m      | 16 to 72 m  | 1      | 9k/km2  | 3    |

`HONG_KONG_DISTRICT_PLAN` places all seven as wedges measured from the region's
seaward bearing. It is an original stylised arrangement of the shapes a dense
harbour city has. No real street plan or map geometry is reproduced.

Only Hong Kong has a plan. Every other region carries `cityPlanId: null` and
remains a strategic record.

## Landmark slots (Milestone 07)

Fourteen slots are generated for Hong Kong, each naming the asset manifest id it
will host once a real model exists: `shatterdome.jaeger-bay`,
`shatterdome.launch-gantry`, `shatterdome.dry-dock`, `building.signature-tower`,
`building.ferry-terminal`, and props for comms spires, gantry cranes, container
stacks, broadcast masts, harbour arches, water towers, salvage rigs, ridge beacons
and foundry stacks.

Nothing resolves these yet. They are named slots, not registered assets, and only
`shatterdome.jaeger-bay` corresponds to a manifest that already ships.

## Alert levels (Milestone 07)

Five profiles in `src/world/cityActivity.ts`: calm, watch, warning, attack and
recovery. Each declares multipliers for civilian, vehicle, shipping, aircraft and
military activity, a siren intensity, and an evacuation rate. They are world-layer
tables rather than registry entries, because they describe behaviour rather than
authored content.

## Facilities (Milestone 08)

Thirteen entries in `src/data/facilities.ts`, registered through
`ContentRegistry<FacilityDefinition>`. A facility is a rule for making a room and
a ladder of tiers, so these numbers are a grammar rather than a set of rooms.

| id          | Display name          | Deck | Footprint        | Tiers | Starts built |
| ----------- | --------------------- | ---- | ---------------- | ----- | ------------ |
| command     | LOCCENT Command       | 2    | 34 x 26 x 9 m    | 2     | yes          |
| jaeger-bay  | Jaeger Bay            | 0    | 130 x 96 x 104 m | 2     | yes          |
| repair      | Repair Gantries       | 0    | 78 x 62 x 84 m   | 2     | yes          |
| research    | Kaiju Research        | 2    | 30 x 24 x 7 m    | 2     | no           |
| manufacture | Fabrication Hall      | 1    | 56 x 44 x 16 m   | 2     | no           |
| reactor     | Reactor and Utilities | -1   | 42 x 36 x 20 m   | 3     | yes          |
| logistics   | Logistics and Stores  | 1    | 48 x 38 x 12 m   | 2     | yes          |
| training    | Drift Training        | 3    | 32 x 28 x 11 m   | 2     | no           |
| quarters    | Crew Quarters         | 3    | 40 x 30 x 8 m    | 2     | yes          |
| defense     | Defense Control       | 1    | 28 x 22 x 8 m    | 2     | no           |
| archive     | Memorial Archive      | 3    | 24 x 20 x 7 m    | 1     | no           |
| contract    | Contracts Office      | 2    | 26 x 20 x 7 m    | 2     | no           |
| launch      | Launch Infrastructure | 0    | 60 x 50 x 90 m   | 2     | no           |

`FACILITY_CONNECTIONS` joins them with thirteen edges: doors within a deck, lifts
between decks, and one tram from the bay to the accommodation wing. Every
facility is reachable, and the ones that have not been built show as sealed
bulkheads rather than as missing walls.

Only the reactor produces power. Only logistics musters construction crews. A new
campaign starts with 220 MW against 162 MW of draw and three crews.

## Named crew (Milestone 08)

Fifteen entries in `src/data/personnel.ts`, one to three per facility, each with
a post, a shift and two or three lines. **These are original characters written
for this project, not film characters**, and their lines are templates filled from
live facility state so none of them can claim something the complex is not doing.

Everyone else in the complex is anonymous shift staff: a facility's population is
one integer derived from its tier and the hour, and only the room the player is
standing in turns that into positions.

## Jaeger roster and locomotion profiles (Milestone 09)

Three entries in `src/data/jaegers.ts`. Every one is a non-canon procedural
placeholder, and what makes them different machines is the profile rather than
the mesh: two of the three share an asset manifest.

| id              | Name                 | Height | Walk / run     | Turn moving / planted | Step up | Stride | Character               |
| --------------- | -------------------- | ------ | -------------- | --------------------- | ------- | ------ | ----------------------- |
| placeholder-mk0 | Placeholder Sentinel | 75 m   | 9 / 17 m/s     | 26 / 42 deg per s     | 9 m     | 27 m   | The middle of the range |
| heavy-mk4       | Placeholder Bulwark  | 82 m   | 7.2 / 12.5 m/s | 17 / 29 deg per s     | 11 m    | 30 m   | Heavy tank              |
| agile-mk5       | Placeholder Harrier  | 68 m   | 11 / 23 m/s    | 38 / 64 deg per s     | 8 m     | 22 m   | Agile frame             |

## Jaeger states (Milestone 09)

Twenty rows in `src/jaegers/locomotion.ts`, registered through
`ContentRegistry<JaegerStateDefinition>`: idle, start, walk, run, strafe, guard,
turn-in-place, stop, step-up, fall, land, wade, swim, underwater, booster,
knockback, knockdown, get-up, disabled and death. Each carries its own speed
factor, turn authority, whether it listens to the player, a minimum length,
whether the feet are planted, and whether it is a reaction.

## Camera rigs (Milestone 09)

Three rows in `src/jaegers/camera.ts`: exploration, combat and Conn-Pod. Rig
geometry is in multiples of machine height, so adding a machine never means
adding a camera.
