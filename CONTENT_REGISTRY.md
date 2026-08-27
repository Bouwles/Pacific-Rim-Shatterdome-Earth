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

## Moves (Milestone 10)

Eight rows in `src/data/moves.ts`, registered through
`ContentRegistry<MoveDefinition>`. Times are in ticks at sixty ticks a second.

| id                         | Kind        | Startup / active / recovery | Damage     | Cancels into                  | Notes                          |
| -------------------------- | ----------- | --------------------------- | ---------- | ----------------------------- | ------------------------------ |
| melee.light.jab            | light       | 7 / 4 / 12                  | 90 impact  | light, heavy, guard, evade    | Opens a guard                  |
| melee.light.cross          | light       | 9 / 5 / 15                  | 140 impact | heavy, launcher, guard, evade | Cancels only if it landed      |
| melee.heavy.overhead       | heavy       | 24 / 6 / 34                 | 420 crush  | finisher                      | Light armour                   |
| melee.launcher.uppercut    | launcher    | 18 / 5 / 30                 | 260 impact | heavy, finisher               | Launches                       |
| melee.guard-break.shoulder | guard-break | 20 / 8 / 26                 | 180 crush  | light, heavy                  | Super armour, 200 guard damage |
| melee.finisher.plasma-drop | finisher    | 30 / 8 / 46                 | 900 plasma | none                          | Only against a finished target |
| kaiju.claw.swipe           | heavy       | 26 / 7 / 30                 | 320 impact | heavy                         | The creature's opener          |
| kaiju.tail.sweep           | launcher    | 22 / 9 / 36                 | 240 crush  | none                          | Super armour, knocks down      |

## Kaiju (Milestone 10)

Two entries in `src/data/kaiju.ts`, both original placeholder designs. Each is
six body zones: head, torso, core, two limbs and a tail, with exactly one zone
that ends the creature.

| id                | Name        | Height | Poise | Core health / armour / multiplier |
| ----------------- | ----------- | ------ | ----- | --------------------------------- |
| kaiju.test-dummy  | Test Frame  | 70 m   | 220   | 1,800 / 0.15 / 2.2                |
| kaiju.biped-alpha | Alpha Biped | 82 m   | 320   | 2,400 / 0.20 / 2.0                |

## Reactions (Milestone 10)

Eight rows in `src/combat/reactions.ts`: absorbed, flinch, stagger, guard break,
launch, wall impact, knockdown and component shock. Each carries a length,
whether control is lost, what it does to poise, how it scales knockback, and
whether it opens a finisher.

## Region profiles (Milestone 27)

Seven in `src/data/regionProfiles.ts`, one per land region. Each carries a
skyline language, a shoreline, a traffic mix, a defence posture, an industry, a
district plan, landmark slots, ambience tags, a rebuild rate, approach bearings
and its mission modifiers. The validator refuses a profile whose identity is
only a name and a colour.

| Region      | Skyline                                  | Shelf | Approaches | Conditions                               |
| ----------- | ---------------------------------------- | ----- | ---------- | ---------------------------------------- |
| hong-kong   | Towers out of deep water, hills behind   | 34 m  | 3          | dense harbour, typhoon                   |
| tokyo       | Capped low by seismic code, very dense   | 18 m  | 2          | shallow bay, shipping congestion         |
| sydney      | Small tight core, drowned river valley   | 46 m  | 2          | dense harbour                            |
| manila      | Vast low sprawl, a few towers            | 22 m  | 3          | typhoon, volcanic, shipping congestion   |
| anchorage   | Single storey under very large mountains | 12 m  | 1          | ice, shallow bay, mountainous approach   |
| lima        | Pale render on a desert terrace          | 64 m  | 3          | mountainous approach                     |
| vladivostok | Blocks stepped up a narrow frozen inlet  | 28 m  | 1          | ice, dense harbour, mountainous approach |

Approaches shown are the authored bearings before narrowing; conditions cut them
down, which is why Anchorage and Vladivostok end up with one.

## Mission modifiers (Milestone 27)

Seven in `src/data/missionModifiers.ts`. Every one moves numbers the simulation
already reads, and one that changes nothing is refused.

| Modifier             | Footing | Accuracy | Visibility | Depth | Collateral | Narrowing |
| -------------------- | ------- | -------- | ---------- | ----- | ---------- | --------- |
| ice                  | 0.72    | 0.94     | 0.88       | 1.00  | 0.90       | 0.20      |
| typhoon              | 0.88    | 0.70     | 0.55       | 1.15  | 1.20       | 0.00      |
| dense-harbour        | 0.95    | 0.90     | 0.85       | 0.80  | 1.35       | 0.35      |
| volcanic-risk        | 0.90    | 1.00     | 0.80       | 1.00  | 1.10       | 0.45      |
| shallow-bay          | 1.00    | 1.05     | 1.10       | 0.45  | 0.90       | 0.55      |
| shipping-congestion  | 1.00    | 0.88     | 0.90       | 1.00  | 1.45       | 0.25      |
| mountainous-approach | 0.85    | 1.10     | 1.20       | 1.00  | 0.80       | 0.75      |

## Sites (Milestone 26)

Eleven in `src/data/sites.ts` across eight kinds. Every entry declares the region
kinds, climates, population band and damage state it belongs in, and the
validator refuses one that fits every region kind in every climate.

| Kind              | Belongs in                                          | Opens a deployment point |
| ----------------- | --------------------------------------------------- | ------------------------ |
| salvage           | coasts, oceans, and damaged cities for a wreck      | the Jaeger wreck does    |
| landmark          | coastal cities, and wilderness ridges               | both do                  |
| shipping-incident | oceans and coasts                                   | no                       |
| military-exercise | wilderness and small inland cities                  | yes                      |
| training-gate     | a Shatterdome, and nowhere else                     | yes                      |
| research-anomaly  | wilderness and ocean, cold or tropical, unpopulated | no                       |
| rescue-call       | a city that has actually been hit                   | no                       |
| hazard            | coasts, oceans, wilderness; the ice one polar only  | no                       |

Discovery sources, in `DISCOVERY_SOURCES`: `exploration`, `contract`,
`intelligence`, `allied-government`, `carrier`, `repaired-infrastructure`. Some
sites deliberately omit `exploration`, so walking alone can never find
everything.

## Jaeger parts (Milestone 25)

Twenty nine in `src/data/parts.ts` across twelve slots. Every structural part
declares mass and where that mass sits, power, heat, armour, structure, actuator
capacity, mobility, turn, ammunition, module slots, hardpoints, the fittings it
provides and needs, a cost, a silhouette contribution and an honest tradeoff.
Cosmetics are validated as weightless, so paint can never be a hidden advantage.

| Slot     | Options | The choice being made                                                   |
| -------- | ------- | ----------------------------------------------------------------------- |
| head     | 3       | Ordinary, sensors and no armour, or armour and no modules               |
| torso    | 3       | Balanced, deep magazine and heavy spine only, or compact and quick      |
| arms     | 3       | Standard, heavy lift needing a wide coupling, or fast and weak          |
| legs     | 3       | Standard taking any spine, siege, or sprint offering only a light spine |
| reactor  | 3       | Standard, high output and very hot, or cold running and heavy           |
| armor    | 3       | Composite plate, radiator skin, or ablative layers                      |
| movement | 3       | Standard drive, boosters refusing wide hips, or a stabiliser rig        |
| weapon   | 3       | Rotary cannon, plasma caster needing a heavy mount, or a chain sword    |
| ability  | 2       | Overdrive coupling, or an emergency vent                                |
| paint    | 3       | Slate, oxide red, deep blue                                             |
| markings | 3       | Unmarked, hazard stripes, stencilled serial                             |
| emblem   | 3       | None, anchor, breach                                                    |

Fittings, in `FITTINGS`: `mount.standard`, `mount.heavy`, `spine.light`,
`spine.heavy`, `hip.standard`, `hip.wide`, `neck.standard`, `coupling.compact`,
`coupling.wide`.

## Custom chassis (Milestone 25)

One, `custom-mk1`, synthesised from a blueprint rather than authored. It is
`research-manufacture` only, priced at zero because nobody sells it, and carries
no signature loadout. It never enters the shipped `jaegerRegistry`: the bootstrap
keeps its own copy and puts the derived definition into that.

## Research nodes (Milestone 24)

Twenty three in `src/data/research.ts` across nine branches. Every node carries
prerequisites, named sample requirements, a facility and tier, researchers,
ticks, a visible experiment and at least one benefit. The validator refuses a
node that hands nothing over, and refuses any sample requirement above four.

| Branch    | Nodes | Ends at                                                     |
| --------- | ----- | ----------------------------------------------------------- |
| biology   | 4     | Live containment study, which makes the tanks pay their way |
| materials | 3     | Ablative shielding, which blunts burning and corrosion      |
| weapons   | 3     | Harmonic payload, which opens the lance                     |
| sensors   | 3     | Adaptive sonar, built out of their own hearing organ        |
| mobility  | 2     | Reactive footing, which rides out a current spike           |
| reactor   | 2     | Kaiju core study, which opens the resonance core            |
| defense   | 2     | Breach shutters, for when it comes to you                   |
| logistics | 2     | Field fabrication, which makes repairs cheaper              |
| chassis   | 2     | The Leviathan frame, the end of the tree                    |

Benefits are capabilities: `telegraph`, `status-resist`, `tracking`,
`weak-point`, `equipment`, `chassis`, `facility`. There is deliberately no
benefit kind that scales damage or health.

## Samples (Milestone 24)

Twenty one in `src/data/samples.ts`, graded common, rare and exotic on the same
scale the economy values tissue by. Each declares the condition that yields it,
so the award rules are derived from the data rather than written twice.

| Trigger          | Meaning                                             | Examples                                     |
| ---------------- | --------------------------------------------------- | -------------------------------------------- |
| `any-kill`       | Any kill at all. The floor core progression runs on | Hide section, Blue, Skeletal section         |
| `zone-destroyed` | A named body zone came apart                        | Cranial tissue, Neural cord, Core fragment   |
| `mutation`       | It was carrying a mutation of that kind             | Plate lamina, Venom gland, Regenerative mass |
| `captured`       | Brought down alive                                  | Live culture                                 |
| `finisher`       | Finished cleanly rather than ground down            | Intact organ                                 |
| `damage-kind`    | Killed mostly by one kind of damage                 | Vitrified tissue, Conductive tissue          |
| `environment`    | Fought in a particular medium or weather            | Pressure-adapted tissue, Storm-etched plate  |
| `objective`      | A named mission objective was met                   | Evacuation telemetry, Containment log        |

## Research chassis (Milestone 24)

Two in `src/data/jaegers.ts`, both `research-manufacture` only, both with a list
price of zero because nobody sells them. Recipes live in
`src/research/manufacture.ts`.

| Chassis         | Programme                          | Needs                                                                  |
| --------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `harmonic-mk1`  | `research.chassis.harmonic-frame`  | 4 laminate hull, 1,400 t alloy, 60 reactor material                    |
| `leviathan-mk1` | `research.chassis.leviathan-frame` | 6 laminate hull, 1 resonance core, 2,600 t alloy, 180 reactor material |

## Resources (Milestone 23)

Six in `src/world/resources.ts`. Each declares what pays it in and what spends
it, and the registry refuses a resource whose sinks are already covered by
another: a resource that buys nothing new is that resource under a second name.

| Id                | Unit    | Paid in by                                              | Spent on                                         |
| ----------------- | ------- | ------------------------------------------------------- | ------------------------------------------------ |
| `funding`         | credits | contracts, defence rewards, retainers, facility income  | machines, construction, upkeep, repairs, modules |
| `alloy`           | tons    | salvage rights                                          | repairs, construction                            |
| `components`      | units   | salvage rights, manufacturer retainers                  | repairs, modules                                 |
| `reactorMaterial` | units   | government contracts, exploration finds                 | construction, modules                            |
| `tissue`          | samples | salvage rights, graded common, rare or exotic           | research conversion                              |
| `researchData`    | units   | research conversion, facility income, exploration finds | research                                         |

Tissue is graded rather than weighed: `TISSUE_VALUE` is 1, 4 and 12 for common,
rare and exotic, so one exotic sample beats a truckload of common.

## Ledger sources (Milestone 23)

Fourteen in `src/world/ledger.ts`, a table so a new source is a row rather than
a case: `government-contract`, `defence-reward`, `salvage-rights`,
`exploration-find`, `manufacturer-deal`, `facility-income`,
`research-conversion`, `machine-purchase`, `construction`, `repair`, `upkeep`,
`module`, `refund`, `adjustment`.

## Facilities (Milestone 22)

Fifteen branches in `src/data/facilities.ts`, twenty nine tiers between them.
Every tier carries a cost, an upkeep, named effects, module slots, prerequisites
and a stage variant.

| id                | Deck | Tiers | Worth                             | Wants first           |
| ----------------- | ---- | ----- | --------------------------------- | --------------------- |
| command           | 2    | 2     | construction, contract funding    | logistics 1           |
| jaeger-bay        | 0    | 2     | repair                            | reactor 1             |
| repair            | 0    | 2     | repair 1.35 then 1.90             | manufacture 1         |
| research          | 2    | 2     | research yield, containment yield | medical 1             |
| manufacture       | 1    | 2     | repair, delivery speed            | logistics 2           |
| reactor           | -1   | 3     | construction, repair              | manufacture 2 at t3   |
| logistics         | 1    | 2     | delivery speed, construction      | nothing               |
| training          | 3    | 2     | training, recovery                | medical 1             |
| quarters          | 3    | 2     | recovery, training                | nothing               |
| defense           | 1    | 2     | coastal defence                   | command 2             |
| archive           | 3    | 1     | research yield, training          | nothing               |
| contract          | 2    | 2     | contract funding, delivery speed  | command 2             |
| launch            | 0    | 2     | delivery speed, contract funding  | jaeger-bay 2          |
| medical           | 3    | 2     | recovery 1.40 then 1.90           | quarters 2 at t2      |
| kaiju-containment | -1   | 2     | containment yield, research yield | research 1, reactor 2 |

A test walks the prerequisite graph from an empty complex and asserts every
facility is reachable at every tier, so no set of choices can strand a room.

## Squad orders (Milestone 21)

Nine in `src/data/squadOrders.ts`. Each is weights on the ally goal table plus a
few hard constraints, never a script.

| id                  | Key | Leans toward            | Imposes                               |
| ------------------- | --- | ----------------------- | ------------------------------------- |
| focus-target        | 1   | focus, engage, suppress | nothing                               |
| defend-area         | 2   | screen, hold position   | 260 m leash                           |
| protect-civilians   | 3   | escort, screen          | 340 m leash, signature held           |
| hold                | 4   | hold position           | 90 m leash                            |
| regroup             | 5   | regroup, assist         | 140 m leash                           |
| ranged-pressure     | 6   | suppress, reposition    | minimum 120 m                         |
| conserve-ammunition | 7   | engage, focus           | ammunition floor 0.35, signature held |
| disengage           | 8   | withdraw, reposition    | minimum 200 m, signature held         |
| synchronized-attack | 9   | assist, focus           | nothing                               |

## Allied crews (Milestone 21)

Four in `src/data/allyCrews.ts`, each learning two perks by flying beside you.

| id           | Callsign   | Likes | Aggression | Support | Leans toward           | Rival      |
| ------------ | ---------- | ----- | ---------- | ------- | ---------------------- | ---------- |
| ally.karsten | Hammerfall | 45 m  | 0.85       | 0.25    | engage, focus          | Longshot   |
| ally.oduya   | Longshot   | 240 m | 0.45       | 0.50    | suppress, reposition   | Hammerfall |
| ally.penrose | Bulwark    | 70 m  | 0.40       | 0.90    | screen, escort, assist | none       |
| ally.abara   | Sidestep   | 110 m | 0.62       | 0.55    | reposition, assist     | none       |

No ally perk may scale a number by more than fifteen percent, which the registry
enforces: an ally is help, never the answer.

## Pilot traits (Milestone 20)

The five pilots from Milestone 17, now with everything that makes them different
to fly with. Nobody is at home in every role and everybody has a drawback.

| id            | Callsign   | At home in          | Tags                  | Drawback fires when                   | Perk                      | Tough |
| ------------- | ---------- | ------------------- | --------------------- | ------------------------------------- | ------------------------- | ----- |
| pilot.okonkwo | Anvil      | brawler, guardian   | veteran, stoic        | the machine is a marksman or siege    | Set your feet             | 0.72  |
| pilot.varga   | Ledger     | marksman, siege     | methodical, veteran   | the machine is under 65 percent       | Thermal discipline        | 0.65  |
| pilot.reyes   | Kingfisher | skirmisher, brawler | reckless, competitive | the partner is methodical or empathic | Answer on the turn        | 0.48  |
| pilot.sato    | Quartz     | marksman, guardian  | methodical, empathic  | the approach is over 90 minutes       | Know what you are cutting | 0.60  |
| pilot.ferrant | Tallow     | guardian, siege     | veteran, stoic        | either of them is already hurt        | Nobody else today         | 0.80  |

Tag friction is symmetric and lives in one small table: reckless against
methodical, competitive against empathic, stoic against empathic.

## Injuries (Milestone 20)

Six in `src/data/injuries.ts`. None of them is fatal, and most leave somebody
able to fly badly rather than unable to fly, which is what makes one a decision.

| id                        | Severity | Restriction   | Recovery | Treatment saves | Drift drag |
| ------------------------- | -------- | ------------- | -------- | --------------- | ---------- |
| injury.neural-strain      | minor    | unstable      | 4 days   | 2 days          | 0.08       |
| injury.hand-burns         | minor    | no-gunnery    | 6 days   | 3 days          | 0.05       |
| injury.drift-fatigue      | minor    | short-sorties | 5 days   | 1 day           | 0.06       |
| injury.concussion         | serious  | grounded      | 9 days   | 3 days          | 0.18       |
| injury.shoulder-tear      | serious  | no-melee      | 12 days  | 4 days          | 0.10       |
| injury.spinal-compression | severe   | grounded      | 21 days  | 7 days          | 0.26       |

## Passives (Milestone 19)

Ten in `src/data/passives.ts`, chosen one per tier at levels 4, 10, 18 and 26.
Every one below tier four costs something, which the registry enforces.

| id                           | Tier | Gives                                  | Costs                              |
| ---------------------------- | ---- | -------------------------------------- | ---------------------------------- |
| passive.reinforced-frame     | 1    | structure 1.10                         | mobility 0.96                      |
| passive.tuned-actuators      | 1    | mobility 1.09                          | structure 0.97                     |
| passive.overpressure-coolant | 1    | heat 1.12                              | damage 0.97                        |
| passive.weighted-knuckles    | 2    | damage 1.10                            | heat 0.95                          |
| passive.ablative-plating     | 2    | structure 1.14                         | mobility 0.94                      |
| passive.drift-rhythm         | 2    | damage 1.07, heat 1.07                 | mobility 0.95                      |
| passive.reactor-tap          | 3    | damage 1.15                            | structure 0.95                     |
| passive.load-bearing-spine   | 3    | structure 1.18                         | damage 0.96                        |
| passive.veteran-hull         | 4    | structure 1.12, heat 1.08, damage 1.04 | nothing, and it is the last choice |
| passive.finishing-instinct   | 4    | damage 1.18                            | structure 0.94                     |

## Modules (Milestone 19)

Nine in `src/data/modules.ts`. Slots open at levels 6, 14, 22 and 30, plus one for
having prestiged at all and one more at rank 10, so six at the very top.

| id                          | Class     | Needs       | Gives                                    | Costs          | Price |
| --------------------------- | --------- | ----------- | ---------------------------------------- | -------------- | ----- |
| module.spine-brace          | frame     | level 1     | structure 1.08                           | mobility 0.97  | 240k  |
| module.impact-drivers       | frame     | level 6     | damage 1.09                              | heat 0.96      | 380k  |
| module.heat-sink-array      | cooling   | level 6     | heat 1.15                                | mobility 0.98  | 420k  |
| module.output-governor      | reactor   | level 14    | damage 1.12                              | structure 0.96 | 640k  |
| module.gyro-stabiliser      | field     | level 14    | mobility 1.12                            | structure 0.97 | 560k  |
| module.predictive-targeting | targeting | level 22    | damage 1.08, heat 1.05                   | mobility 0.96  | 720k  |
| module.composite-shell      | frame     | level 22    | structure 1.16                           | mobility 0.94  | 810k  |
| module.veterans-core        | reactor   | prestige 1  | 1.06 on three axes                       | nothing        | 1.2M  |
| module.long-service-loom    | field     | prestige 10 | structure 1.10, heat 1.10, mobility 1.04 | nothing        | 2.4M  |

## Mastery goals (Milestone 19)

Six in `src/data/masteries.ts`, four ranks each, counted once per sortie.

| id                 | Counts                            | Thresholds         | Pays per rank |
| ------------------ | --------------------------------- | ------------------ | ------------- |
| mastery.service    | sorties flown                     | 5, 20, 60, 150     | 450           |
| mastery.record     | sorties that ended cleanly        | 3, 12, 40, 100     | 700           |
| mastery.unbroken   | sorties with no component lost    | 3, 10, 30, 75      | 800           |
| mastery.evacuation | thousands rescued                 | 40, 200, 800, 2500 | 550           |
| mastery.salvor     | tons of salvage                   | 1k, 6k, 20k, 60k   | 450           |
| mastery.punished   | machines' worth of structure lost | 3, 12, 35, 90      | 600           |

## Manufacturers (Milestone 18)

Four original yards in `src/data/manufacturers.ts`. Adding a fifth is a row here
and nothing else: the board, the previews and the pricing all read the table.

| id                      | Yard              | Home                    | Builds for              | Standing | Lead | Price | Refurb chance |
| ----------------------- | ----------------- | ----------------------- | ----------------------- | -------- | ---- | ----- | ------------- |
| maker.tarrant-yards     | Tarrant Yards     | Clyde estuary, Scotland | heavy armour, endurance | 0.62     | 18 d | 1.00  | 0.40          |
| maker.hanjin-dynamics   | Hanjin Dynamics   | Busan, Korea            | speed, gunnery          | 0.71     | 11 d | 1.15  | 0.20          |
| maker.novaya-kuznitsa   | Novaya Kuznitsa   | Vladivostok, Russia     | heavy armour, refits    | 0.55     | 15 d | 0.82  | 0.55          |
| maker.aurora-collective | Aurora Collective | Valparaiso, Chile       | prototypes, speed       | 0.48     | 24 d | 1.40  | 0.05          |

Standing moves with what you buy and shortens the wait and the price, but a yard
that likes you still takes at least five days and still charges.

## Jaeger chassis as goods (Milestone 18)

The same four chassis the game has always had, now with what they cost.

| id              | Mark | Role       | Yard            | Price | Upkeep | Upgrade steps |
| --------------- | ---- | ---------- | --------------- | ----- | ------ | ------------- |
| placeholder-mk0 | 0    | brawler    | Tarrant Yards   | 4.2M  | 9.5k   | 7             |
| veteran-mk1     | 1    | siege      | Tarrant Yards   | 2.9M  | 6.2k   | 20            |
| heavy-mk4       | 4    | guardian   | Novaya Kuznitsa | 7.8M  | 16.4k  | 8             |
| agile-mk5       | 5    | skirmisher | Hanjin Dynamics | 6.6M  | 12.8k  | 7             |

The Mark 1 is the shape of the answer to "does an old machine stay worth flying":
less than half the price of the newest, cheaper to keep, slower and shorter
ranged, and upgradeable nearly three times as far, reaching the same ceiling by
a different route.

## Pilots (Milestone 17)

Five original characters in `src/data/pilots.ts`. Drift compatibility is
symmetric and must be returned by both sides, checked when the registry is built.

| id            | Callsign   | Specialisms          | Stability | Skill | Sorties | Drifts well with |
| ------------- | ---------- | -------------------- | --------- | ----- | ------- | ---------------- |
| pilot.okonkwo | Anvil      | melee, command       | 0.82      | 0.78  | 14      | Varga            |
| pilot.varga   | Ledger     | gunnery, engineering | 0.79      | 0.81  | 16      | Okonkwo          |
| pilot.reyes   | Kingfisher | piloting, melee      | 0.74      | 0.86  | 9       | Sato             |
| pilot.sato    | Quartz     | science, gunnery     | 0.88      | 0.70  | 11      | Reyes            |
| pilot.ferrant | Tallow     | command, piloting    | 0.85      | 0.66  | 22      | nobody left      |

## Mission objectives (Milestone 17)

Eight rows in `src/missions/objectives.ts`, each with its own completion and
failure rule over one shared progress object.

| id                  | Weight | Critical | Completes when                                    | Fails when                            |
| ------------------- | ------ | -------- | ------------------------------------------------- | ------------------------------------- |
| objective.defend    | 1.0    | yes      | everything down and the district above 35 percent | the district falls below 15 percent   |
| objective.intercept | 1.0    | yes      | everything stopped and the city above 80 percent  | the city falls below 60 percent       |
| objective.pursue    | 0.8    | no       | everything down                                   | it reaches open water                 |
| objective.rescue    | 0.9    | no       | nobody left trapped                               | time runs out with people still under |
| objective.contain   | 0.8    | no       | contamination under 10 percent and nothing alive  | contamination passes 85 percent       |
| objective.escort    | 0.9    | no       | the convoy arrives                                | the convoy dies                       |
| objective.research  | 0.6    | no       | three samples taken                               | it escapes with nothing taken         |
| objective.salvage   | 0.5    | no       | 400 tons recovered                                | never                                 |

## Mutations (Milestone 16)

Eight rows in `src/data/mutations.ts`. The director is handed a budget from
escalation and pressure and spends it on these.

| id                       | Kind       | Cost | Damage | Armour | Speed | Senses | Notable                           | From escalation |
| ------------------------ | ---------- | ---- | ------ | ------ | ----- | ------ | --------------------------------- | --------------- |
| mutation.carapace        | armour     | 2    | 1.0x   | 1.45x  | 0.9x  | 1.0x   | resists pierce and shear          | 0%              |
| mutation.sprinter        | mobility   | 2    | 0.95x  | 0.85x  | 1.4x  | 1.0x   | excludes carapace and growth      | 0%              |
| mutation.acid-blood      | offence    | 3    | 1.2x   | 1.0x   | 1.0x  | 1.0x   | nearly immune to corrosion        | 20%             |
| mutation.deep-lungs      | mobility   | 2    | 1.0x   | 1.0x   | 1.05x | 1.0x   | grants the water                  | 15%             |
| mutation.echo-organ      | sensory    | 2    | 1.0x   | 1.0x   | 1.0x  | 1.6x   | finds you through cover           | 25%             |
| mutation.regenerator     | resilience | 4    | 1.0x   | 1.1x   | 1.0x  | 1.0x   | worse against anything unfinished | 40%             |
| mutation.colossal-growth | resilience | 5    | 1.5x   | 1.3x   | 0.75x | 0.9x   | excludes sprinter                 | 55%             |
| mutation.brood           | swarm      | 4    | 0.9x   | 1.0x   | 0.95x | 1.1x   | it does not come alone            | 50%             |

Every mutation carries a tell, which is what a warning is allowed to say about
it when the signal is good enough. A mutation that changes nothing, or one that
excludes something not registered, is refused.

## Locomotion families (Milestone 15)

Nine rows in `src/data/locomotionFamilies.ts`. Speeds are metres per second,
turn rates degrees per second.

| id         | Media               | Ground | Preferred      | Turn moving | Turn in place | Step up | Slope | Climbs | Ignores rubble |
| ---------- | ------------------- | ------ | -------------- | ----------- | ------------- | ------- | ----- | ------ | -------------- |
| biped      | ground, water       | 16     | 16 ground      | 55          | 90            | 14 m    | 42°   | no     | no             |
| quadruped  | ground              | 22     | 22 ground      | 40          | 45            | 9 m     | 50°   | no     | no             |
| serpentine | ground, water       | 18     | 26 water       | 26          | **0**         | 6 m     | 35°   | yes    | yes            |
| winged     | air, ground         | 9      | 48 air         | 70          | 20            | 40 m    | 90°   | yes    | yes            |
| burrower   | underground, ground | 12     | 20 underground | 35          | 30            | 8 m     | 60°   | no     | yes            |
| swimmer    | water               | 3      | 34 water       | 50          | 25            | 2 m     | 20°   | no     | no             |
| amphibious | ground, water       | 14     | 24 water       | 45          | 55            | 10 m    | 40°   | no     | no             |
| crawler    | ground, wall        | 20     | 20 ground      | 80          | 120           | 20 m    | 85°   | yes    | yes            |
| colossal   | ground, water       | 11     | 11 ground      | 14          | 8             | 40 m    | 55°   | no     | yes            |

A turn-in-place rate of zero is not a rounding: a serpentine body cannot change
heading without travelling, and navigation enforces it.

## Kaiju archetypes (Milestone 15)

Three creatures in `src/data/kaiju.ts`, plus the training frame.

| id                   | Family     | Senses it leans on   | Tactic                                     | Organ        | Grants                 |
| -------------------- | ---------- | -------------------- | ------------------------------------------ | ------------ | ---------------------- |
| kaiju.biped-alpha    | biped      | ordinary             | Closes and stays. Enrages under a quarter  | throat sac   | acid spit              |
| kaiju.serpent-delta  | serpentine | vibration, scent     | Waits, then works around. Prefers water    | sonar bulb   | deep sense, vibration  |
| kaiju.burrower-sigma | burrower   | vibration, objective | Ignores the machine, digs to the objective | seismic node | ground slam, vibration |
| kaiju.test-dummy     | biped      | none                 | Stands there. It is a training frame       | -            | -                      |

Each also carries armour plates, a severable appendage, resistances per damage
kind and its own phases. Losing an organ takes the abilities it granted with it;
severing an appendage takes what it was doing and slows the creature down.

## Building archetypes (Milestone 14)

Five rows in `src/data/buildings.ts`. A district builds with the first archetype
that lists it; anything unlisted falls back to the archetype that takes any
district.

| id                      | Districts            | Structure/m | Fractured | Debris | Collapse | Fire | Contam. | People | Clear | Rebuild | Cost  |
| ----------------------- | -------------------- | ----------- | --------- | ------ | -------- | ---- | ------- | ------ | ----- | ------- | ----- |
| building.harbour-tower  | waterfront, downtown | 42          | 14 chunks | 26     | 9 s      | 35%  | 5%      | 2.4k   | 210 h | 1,400 h | 8.6M  |
| building.tenement-stack | slums, hillside      | 18          | no        | 12     | 5 s      | 55%  | 2%      | 4.1k   | 90 h  | 420 h   | 1.2M  |
| building.dock-warehouse | docks, industrial    | 26          | no        | 18     | 4 s      | 40%  | 25%     | 0.3k   | 120 h | 380 h   | 0.9M  |
| building.precinct-block | shatterdome          | 58          | 18 chunks | 30     | 12 s     | 20%  | 8%      | 1.2k   | 260 h | 1,900 h | 12.4M |
| building.viaduct        | anywhere             | 34          | 10 chunks | 22     | 6 s      | 10%  | 3%      | 0.2k   | 150 h | 900 h   | 4.1M  |

Fractured archetypes are the ones worth authoring chunks for; everything else is
swapped and decalled. An archetype that claims chunks without being fractured,
or that is cheaper to rebuild than to clear, is refused at registration.

## Jaeger components (Milestone 13)

Eight rows in `src/data/components.ts`, generic across machines and scaled by
each machine's own mass. Health is the share of a machine whose structure is
2,400 plus its mass in tons.

| id                    | Share | Armour | Multiplier | Fears                       | Takes down with it           | Mounts                    | Critical |
| --------------------- | ----- | ------ | ---------- | --------------------------- | ---------------------------- | ------------------------- | -------- |
| component.conn-pod    | 8%    | 0.45   | 1.6x       | neural 3x, radiation, shock | pilot, sensors, targeting    | -                         | yes      |
| component.sensor-mast | 4%    | 0.15   | 1.3x       | electrical 2.2x, energy     | sensors, targeting           | -                         | no       |
| component.torso       | 30%   | 0.40   | 1.0x       | crush, impact               | balance                      | chest                     | no       |
| component.reactor     | 10%   | 0.50   | 1.2x       | pierce 1.8x, plasma         | power, cooling, both weapons | -                         | yes      |
| component.arm.left    | 11%   | 0.30   | 1.0x       | shear 1.5x, corrosive       | weapons.left, grapple        | arm.left, shoulder.left   | no       |
| component.arm.right   | 11%   | 0.30   | 1.0x       | shear 1.5x, corrosive       | weapons.right, grapple       | arm.right, shoulder.right | no       |
| component.leg.left    | 13%   | 0.35   | 0.9x       | crush 1.4x, impact          | movement, balance            | -                         | no       |
| component.leg.right   | 13%   | 0.35   | 0.9x       | crush 1.4x, impact          | movement, balance            | -                         | no       |

The shares total exactly one, checked when the registry is built. A component
that disables nothing, carries no mount and is not critical is refused.

## Weapon mounts (Milestone 13)

Every weapon names the component it hangs on, so losing an arm silences what was
on it.

| Weapon                    | Mount          | Goes with |
| ------------------------- | -------------- | --------- |
| weapon.plasma-caster      | arm.right      | Right arm |
| weapon.chain-sword        | arm.right      | Right arm |
| weapon.rotary-cannon      | arm.left       | Left arm  |
| weapon.arc-whip           | arm.left       | Left arm  |
| weapon.anti-kaiju-missile | shoulder.left  | Left arm  |
| weapon.shoulder-mortar    | shoulder.right | Right arm |
| weapon.booster-strike     | chest          | Torso     |

## Ranged weapons (Milestone 12)

Seven rows in `src/data/weapons.ts`, covering all eight behaviours. Times are in
ticks at sixty ticks a second.

| id                        | Behaviour  | Magazine | Reload | Cooldown | Heat | Reactor | Band          | Aim         | Damage     | Leaves   |
| ------------------------- | ---------- | -------- | ------ | -------- | ---- | ------- | ------------- | ----------- | ---------- | -------- |
| weapon.plasma-caster      | beam       | none     | -      | 90       | 34   | 60 MW   | 0 to 620 m    | forward arc | 520 plasma | burning  |
| weapon.anti-kaiju-missile | salvo of 3 | 6 (18)   | 180    | 24       | 6    | 4 MW    | 60 to 900 m   | locked only | 300 impact | -        |
| weapon.shoulder-mortar    | mortar     | 4 (12)   | 150    | 60       | 8    | 2 MW    | 180 to 1100 m | any         | 420 crush  | -        |
| weapon.rotary-cannon      | projectile | 90 (270) | 210    | 3        | 1.4  | 6 MW    | 0 to 420 m    | forward arc | 42 pierce  | -        |
| weapon.arc-whip           | tether     | none     | -      | 150      | 22   | 40 MW   | 0 to 260 m    | forward arc | 120 energy | shocked  |
| weapon.chain-sword        | channel    | none     | -      | 120      | 0.55 | 26 MW   | 0 to 55 m     | forward arc | 70 shear   | bleeding |
| weapon.booster-strike     | cone       | none     | -      | 300      | 40   | 55 MW   | 0 to 120 m    | forward arc | 380 impact | -        |

The chain sword's heat is per tick rather than per swing, because a channel pays
it sixty times a second for as long as it is held. The arc whip is the one
weapon that is better underwater (1.35x); the mortar is close to useless there
(0.1x).

## Status effects (Milestone 12)

Five rows in `src/combat/abilities.ts`.

| id              | Per tick       | Movement | Output | Ends early |
| --------------- | -------------- | -------- | ------ | ---------- |
| status.burning  | 3.2 heat       | -        | -      | in water   |
| status.shocked  | 0.8 electrical | 0.55x    | 0.85x  | -          |
| status.bleeding | 2.1 shear      | 0.95x    | -      | -          |
| status.corroded | 1.4 corrosive  | -        | -      | in water   |
| status.tethered | -              | 0.25x    | -      | -          |

## Melee, defence and grapple moves (Milestone 11)

Ten rows joined the move table. Times are in ticks at sixty ticks a second.

| id                        | Kind     | Input                  | Notes                                           |
| ------------------------- | -------- | ---------------------- | ----------------------------------------------- |
| melee.heavy.smash.forward | heavy    | hold forward, press 3  | More travel and knockback; leads into a grapple |
| melee.heavy.spin.side     | heavy    | hold sideways, press 3 | Two volumes, one either side                    |
| melee.charge.haymaker     | heavy    | hold H, release        | Super armour, 2.3x damage at full charge        |
| defense.dodge.step        | light    | V                      | Invulnerable ticks 2 to 12, 34 m of travel      |
| defense.block.raise       | light    | F                      | Seven tick perfect window                       |
| defense.counter.parry     | light    | B                      | Nine tick window, free cross on success         |
| grapple.clinch            | grapple  | G                      | 34 m reach, 150 tick hold, 60 m throw           |
| env.swing.prop            | heavy    | N                      | Works with any prop in hand                     |
| finisher.grapple.tear     | finisher | out of a hold          | Four beats, two of which need the hold          |
| kaiju rows                | -        | -                      | Unchanged from Milestone 10                     |

## Environmental weapons (Milestone 11)

Five rows in `src/data/props.ts`. One move swings all of them; the differences
are entirely in the data.

| id                  | Tag    | Mass     | Damage scale | Startup penalty | Swings | Clearance |
| ------------------- | ------ | -------- | ------------ | --------------- | ------ | --------- |
| prop.gantry-crane   | crane  | 900 t    | 1.9x         | 8               | 3      | 55 m      |
| prop.container-ship | ship   | 24,000 t | 3.4x         | 22              | 1      | 110 m     |
| prop.bridge-section | bridge | 4,200 t  | 2.4x         | 14              | 2      | 80 m      |
| prop.fuel-tanker    | tanker | 600 t    | 1.5x         | 4               | 1      | 30 m      |
| prop.rubble-slab    | debris | 180 t    | 1.2x         | 2               | 2      | 20 m      |

## Audio buses (Milestone 29)

Ten rows in `src/data/audioBuses.ts`. Every sound in the game belongs to exactly
one of them, and every one has a fader.

| id            | Default | Duck depth | Duck priority | Carries                                       |
| ------------- | ------- | ---------- | ------------- | --------------------------------------------- |
| master        | 0.80    | 0          | 0             | Everything                                    |
| music         | 0.55    | 0.60       | 1             | The adaptive score                            |
| ambience      | 0.70    | 0.45       | 2             | Wind, water, rain, city hum, the room         |
| ui            | 0.60    | 0.30       | 4             | Panels, confirmations, refusals               |
| destruction   | 0.85    | 0.25       | 5             | Buildings coming down, debris                 |
| jaeger        | 0.90    | 0.20       | 6             | Servos, footfalls, reactor, weapons, cockpit  |
| kaiju         | 0.90    | 0.20       | 7             | Calls, breath, movement, plate, organs        |
| dialogue      | 1.00    | 0          | 9             | Anybody speaking to you in the room           |
| radio         | 1.00    | 0          | 10            | LOCCENT, allies, and every warning            |
| accessibility | 1.00    | 0          | 11            | Cues that replace something a player may miss |

A bus is only ducked by a bus with a higher priority, and a duck depth of zero
means never. The validator refuses a bus that does not state what it carries.

## Sound profiles (Milestone 29)

Three rows in `src/data/soundProfiles.ts`, twenty eight layers between them.
Every layer is a synthesis recipe with a named slot for a real recording, and
the validator refuses a profile with fewer than four layers or fewer than three
kinds of layer.

| id                    | Subject | Layers | Identity                                        |
| --------------------- | ------- | ------ | ----------------------------------------------- |
| sound.jaeger.standard | jaeger  | 13     | Heavy hydraulics over a steady reactor hum      |
| sound.kaiju.coastal   | kaiju   | 9      | Low, wet and organic; breath and mass           |
| sound.kaiju.deep      | kaiju   | 6      | Pressure and infrasound, quieter and much lower |

## Music states (Milestone 29)

Eleven rows in `src/audio/musicDirector.ts`, built from eight instrument roles.

| id          | Tempo | Urgency | What it is for                              |
| ----------- | ----- | ------- | ------------------------------------------- |
| silent      | 0     | 0       | Menus, and anywhere the score is in the way |
| shatterdome | 62    | 1       | A working building, nothing urgent          |
| exploration | 58    | 1       | Somewhere large and mostly empty            |
| warning     | 84    | 4       | Something inbound, nobody launched          |
| deployment  | 96    | 3       | On the way, committed, not yet in it        |
| combat-low  | 112   | 5       | A fight going roughly as expected           |
| combat-high | 132   | 7       | It is going badly and everybody knows it    |
| boss-phase  | 140   | 9       | The thing has stopped holding back          |
| victory     | 76    | 6       | It is over and the city is still there      |
| loss        | 48    | 6       | It is over and the city is not              |
| recovery    | 66    | 2       | Back at the complex, putting things right   |

## Radio lines and speakers (Milestone 29)

Seven speakers and twenty two written lines in `src/data/radioLines.ts`, plus the
crew's own dialogue registered at runtime from the pilot definitions.

| Speaker        | Callsign | Band, Hz    | Bus      |
| -------------- | -------- | ----------- | -------- |
| loccent        | LOCCENT  | 420 - 3,100 | radio    |
| marshal        | MARSHAL  | 300 - 3,400 | radio    |
| chief-engineer | ENG      | 380 - 3,000 | radio    |
| ally-ranger    | ALLY     | 450 - 2,900 | radio    |
| science        | K-SCI    | 400 - 3,200 | radio    |
| system         | SYS      | 600 - 4,000 | radio    |
| copilot        | COPILOT  | 90 - 8,000  | dialogue |

The copilot is in the pod with you rather than on a radio, which is why their
band is not narrowed and why they duck the dialogue bus rather than the radio one.

Priorities, highest first: critical, high, normal, low, chatter. A critical line
may not be marked interruptible, and the validator refuses one that is.

## Network messages (Milestone 30)

Twelve rows in `src/net/protocol.ts`. Each declares the channel it belongs on,
and the validator refuses a reliable message marked droppable or an unreliable
one marked as required.

| id        | Channel    | Direction     | Carries                                            |
| --------- | ---------- | ------------- | -------------------------------------------------- |
| hello     | reliable   | guest to host | Protocol version, build version, name              |
| welcome   | reliable   | host to guest | Session id, the fighter and loadout the host lends |
| reject    | reliable   | host to guest | Why a join was refused, in a sentence              |
| input     | reliable   | guest to host | One intent, with a sequence number and a tick      |
| snapshot  | unreliable | host to guest | Every fighter's state, and the host's digest       |
| transform | unreliable | host to guest | Poses only, between snapshots                      |
| event     | reliable   | host to guest | Something that happened, with a sequence number    |
| pause     | reliable   | either        | A host decision, or a guest request                |
| abort     | reliable   | either        | Leaving, with a reason                             |
| result    | reliable   | host to guest | The one authoritative outcome                      |
| ping      | unreliable | either        | Round-trip measurement                             |
| pong      | unreliable | either        | The reply, with the host's tick                    |

Twelve input intents: move, press-move, guard, aim, fire, reload, charge-start,
charge-release, grapple-throw, grapple-slam, grapple-release and prop-drop. Each
maps to a method the single-player path already calls, so a guest can do exactly
what a local player can do and nothing else.

## Sandbox rules (Milestone 31)

Nine rows in `src/sandbox/rules.ts`. Each has a name, a sentence saying what it
does, and a flag for whether it belongs behind the advanced panel.

| id                    | Name                  | What it does                                       | Advanced |
| --------------------- | --------------------- | -------------------------------------------------- | -------- |
| freeCosts             | Free everything       | Nothing costs funding, alloy or research data      | no       |
| noCooldowns           | No cooldowns          | Moves and weapons are ready the moment they finish | no       |
| noDamageTaken         | Invulnerable machines | Your side takes no damage; everything still reacts | no       |
| infiniteAmmunition    | Infinite ammunition   | Magazines never empty                              | no       |
| stableDrift           | Perfect drift         | The neural link never slips                        | no       |
| calmEnemies           | Passive creatures     | Creatures move and react but do not commit         | no       |
| persistentDestruction | Damage stays          | Wrecked buildings are never cleared during the run | no       |
| slowMotion            | Slow motion           | Everything runs at a third speed                   | no       |
| debugVisuals          | Debug visualisation   | Draws hit volumes and markers over the scene       | yes      |

Slow motion and debug drawing do not change the fight, so a run using only those
still counts as a straight fight on the scoreboard. Every other rule marks the
run.

## Sandbox scenario vocabulary (Milestone 31)

Four small tables in `src/sandbox/scenario.ts`, alongside the region, weather,
objective, difficulty, chassis, creature and mutation registries a scenario
draws its content from.

| Table                  | Values                                   |
| ---------------------- | ---------------------------------------- |
| CITY_DAMAGE_PRESETS    | pristine, scarred, half-ruined, levelled |
| WATER_STATES           | low-tide, normal, high-tide, surge       |
| AI_AGGRESSION          | passive, cautious, normal, relentless    |
| SANDBOX_SCHEMA_VERSION | 1                                        |
