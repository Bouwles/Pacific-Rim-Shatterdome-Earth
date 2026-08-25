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
