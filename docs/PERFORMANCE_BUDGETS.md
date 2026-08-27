# PERFORMANCE_BUDGETS.md

## Target (from GAME_SPEC.md, not yet enforced in code)

Stable 60 fps @ 1080p on a reasonable gaming PC in ordinary play; 30 fps fallback under extreme
destruction.

Low / Medium / High / Cinematic presets exist as of Milestone 06 and are listed below. They are real
budgets that systems read, not labels: particle ceilings, shadow map size, water resolution, wave
octaves and animated water sheets all come from the active preset.

## What's measured today

`DebugOverlay` (src/debug/overlay.ts) shows fps, frame time, draw calls, simulation tick, entity count,
active physics bodies, seed, and run state, backed by Babylon's `SceneInstrumentation`. Physics reads
"n/a (no backend)" until a physics engine is wired — see ARCHITECTURE.md.

Streamed sectors are tracked as of Milestone 05, in the ground view's own
instrumentation block: sector counts by state, generation and upload time, data
and GPU bytes, cache hits, evictions and cancellations.

Particles, shadow map size, reflections and animated water are tracked as of Milestone 06, in the
same panel: live particles against the ceiling, shadow map resolution, reflection mode and how many
telegraphs the active preset draws.

Not tracked yet: AI agents, debris, texture memory, audio voices. Those budgets are meaningless
before the systems that would consume them exist.

## Per-asset budgets (Milestone 02)

Ceilings for a single instance of a production asset, enforced by `src/assets/budgets.ts` and reported by
the Asset Gallery. Exceeding one is a warning, not an error: the asset still loads, it just costs more than
its class allows.

| Class              | Triangles | Materials | Texture memory |
| ------------------ | --------- | --------- | -------------- |
| jaeger             | 150,000   | 8         | 32 MB          |
| kaiju              | 150,000   | 8         | 32 MB          |
| shatterdome-module | 60,000    | 6         | 16 MB          |
| ship               | 20,000    | 4         | 8 MB           |
| building           | 8,000     | 3         | 8 MB           |
| vehicle            | 4,000     | 3         | 4 MB           |
| prop               | 2,000     | 2         | 2 MB           |

Hero units get the largest share because they are on screen constantly and close to camera. Scenery is
tighter because it is instanced heavily, so per-instance cost dominates the frame.

The vehicle material budget was raised from 2 to 3 during this milestone: a road vehicle genuinely needs
body, glass and tyres, and the original figure forced an atlas for no benefit at that size.

### Current placeholder cost

All twelve shipped placeholders sit far below their ceilings, between 12 and 664 triangles each, because
they are box and cylinder primitives. These numbers say nothing about production cost; they only confirm
the measurement and reporting path works.

## Save cost (Milestone 03)

Saves are written to IndexedDB, off the main render path. Observed in the browser
with an empty world: four stored records, including backups and thumbnails, came
to roughly 12 KB against a 10 GB quota.

A save carries authoritative state only, so its size grows with entity count, not
with scene complexity. Thumbnails are 192px wide JPEGs at quality 0.5, roughly
1 KB each, and are rendered through a render target rather than copied from the
canvas.

The storage panel reports live usage and quota, and warns when usage passes 90
percent of quota, when the browser has not granted persistent storage, or when
saves have fallen back to memory.

## World streaming budget (Milestone 04)

The globe is partitioned into 1,536 cube-sphere sectors, measured at 9.3 to
12.5 km across with a 1.35x spread between largest and smallest. Uniform sector
size is the point of the tangent adjustment: streaming cost should not depend on
where on the planet you are.

| Quantity                        | Value       | Note                                           |
| ------------------------------- | ----------- | ---------------------------------------------- |
| Sectors on the globe            | 1,536       | 6 faces of 16 by 16                            |
| Sector span                     | 9.3–12.5 km | Tangent-adjusted; 2.31x spread without it      |
| Active bubble radius            | 4,000 m     | Floor for a region receiving combat simulation |
| Rebase threshold                | 2,000 m     | Local coordinates never exceed this            |
| Regions under combat simulation | 1           | Enforced by the snapshot validator             |

Measured in the browser: the globe view costs 15 draw calls, holding steady
across a 25 km walk with 28 rebases, so neither sector tiles nor their materials
accumulate.

## Sector streaming budget (Milestone 05)

Configured ceilings, all injectable per streamer:

| Quantity               | Value      | Note                                                     |
| ---------------------- | ---------- | -------------------------------------------------------- |
| Ring depth             | 3          | Square rings; 49 sectors resident, 25 of them visible    |
| Levels of detail       | 0 to 3     | 33, 17, 9 and 5 vertices per sector edge                 |
| Collision detail       | lod 0 to 1 | A 17 by 17 height field; coarser rings carry none        |
| Concurrent generations | 2          | Above the ring count so a burst cannot land in one frame |
| Uploads per update     | 1          | Mesh building is main-thread work and is paced           |
| Sector memory budget   | 96 MB      | Resident terrain data                                    |
| Data cache budget      | 48 MB      | Byte-bounded LRU, holds data only, never meshes          |

Measured in the browser on WebGPU at seed 20260822, standing in Hong Kong with
all 49 sectors resident:

| Measurement           | Value                                       |
| --------------------- | ------------------------------------------- |
| Generation            | 0.4 ms average, in the worker               |
| Upload                | 0.2 ms average, on the main thread          |
| Resident terrain data | 0.17 MB                                     |
| Scene                 | 108 meshes, 137 thin instances, 0.50 MB GPU |
| Draw calls            | 38                                          |
| Frame time            | 0.1 to 0.2 ms, 144 fps                      |

The 96 MB budget does not bind at these sizes; ring distance is what bounds
residency today. The budget is kept because it will bind once sectors carry
textures and props, and its eviction path is tested directly by running a route
with the budget set to 60 KB.

### Stress route

The deterministic route flies Hong Kong, Manila, Tokyo, Vladivostok and back at
4,000 m/s in 0.25 s steps, 41 seconds end to end. Measured over 24 seconds of it:

| Measurement               | Value                                       |
| ------------------------- | ------------------------------------------- |
| Simulation ticks advanced | 1,443 in 24.0 s, that is 60 per second      |
| Frame rate                | 144 fps throughout, worst frame time 0.3 ms |
| Sectors crossed           | 9, with 32 floating origin rebases          |
| Evictions                 | 70                                          |
| Resident sectors          | 49 peak, never higher                       |
| Resident terrain data     | 0.15 to 0.17 MB                             |
| Pooled meshes             | 20 held for reuse at the end of the run     |

Three consecutive laps of the full route:

| Lap | Sectors generated | Cache hits | Resident | Cached         | Scene                   |
| --- | ----------------- | ---------- | -------- | -------------- | ----------------------- |
| 1   | 252               | 253        | 0.16 MB  | 1.26 MB in 252 | 108 meshes, 0.50 MB GPU |
| 2   | 252               | 709        | 0.16 MB  | 1.26 MB in 252 | 108 meshes, 0.50 MB GPU |
| 3   | 252               | 1,165      | 0.16 MB  | 1.26 MB in 252 | 108 meshes, 0.50 MB GPU |

Laps two and three generated nothing at all: every sector came from the cache,
and resident, cached and scene figures were identical to the byte. That is the
evidence behind the stable-memory and no-regeneration acceptance items.

## Quality presets (Milestone 06)

Every column is a number a system reads directly. Nothing here is decorative.

| Preset    | Particles | Rate/s | Reflections | Shadow map | Water grid | Wave octaves | Animated sheets | Fog  |
| --------- | --------- | ------ | ----------- | ---------- | ---------- | ------------ | --------------- | ---- |
| Low       | 600       | 260    | none        | off        | 5          | 1            | 1               | 0.75 |
| Medium    | 2,000     | 900    | probe       | 1,024      | 9          | 2            | 3               | 0.90 |
| High      | 6,000     | 2,600  | probe       | 2,048      | 17         | 3            | 5               | 1.00 |
| Cinematic | 16,000    | 6,500  | planar      | 4,096      | 25         | 3            | 9               | 1.15 |

High is the default. Cinematic is for capture rather than play and is not expected to hold 60 fps in
a heavy fight; the table says so rather than implying otherwise.

**Lowering quality removes detail, never information.** Every preset declares the telegraphs it draws,
and the registry refuses to register one that drops any of `lightning-flash`, `water-entry-spray`,
`fog-visibility-cue` or `wave-surface-motion`. A unit test asserts this across all four, and the
browser test reads the telegraph count off the panel at Low and at Cinematic and requires them equal.

Particle capacity and water grid resolution are fixed when their objects are built, so changing preset
rebuilds the ground view. That is a visible reload, which is the honest cost.

Measured in the browser on WebGPU at seed 20260822, standing at Manila in a storm at 55 percent
intensity, orbit camera at 900 m:

| Preset    | Live particles | Draw calls | Frame time | fps |
| --------- | -------------- | ---------- | ---------- | --- |
| Low       | 35 / 600       | 27         | 0.2 ms     | 144 |
| Medium    | 155 / 2,000    | 28         | 0.3 ms     | 144 |
| High      | 528 / 6,000    | 28         | 0.4 ms     | 144 |
| Cinematic | 1,519 / 16,000 | 28         | 0.4 ms     | 144 |

All four hold the frame comfortably at this scene complexity, which is expected: there is still no
combat, no destruction and no AI. These figures confirm the budgets are wired and scale, not that the
target has been met.

## Construction cost (Milestone 22)

The queue is arithmetic over a short list. Nothing here allocates per frame and
nothing holds a scene object.

| Thing                  | Budget              | Why                                                             |
| ---------------------- | ------------------- | --------------------------------------------------------------- |
| Live projects          | One per facility    | A facility may have one order outstanding, so fifteen at most   |
| Queue tick             | Two passes          | One to hand out crews in priority order, one to apply work      |
| Effect resolution      | Once per panel open | Fifteen facilities, a handful of multiplies each                |
| Settled projects       | Pruned every tick   | Done and cancelled projects are dropped rather than accumulated |
| Construction in a save | Under 2 KB          | Only what is outstanding, never what has finished               |

The construction board is DOM, rebuilt only when the set of projects or their
statuses changes and refreshed in place otherwise, so watching a build does not
cost a layout per frame.

## Squad cost (Milestone 21)

Three ally machines are three more fighters in the arena, and that is the whole
cost. The decision layer is arithmetic over plain numbers with no allocation per
frame beyond the intent objects themselves.

| Thing                   | Budget                | Why                                                                |
| ----------------------- | --------------------- | ------------------------------------------------------------------ |
| Allies in one fight     | 3                     | `MAX_SQUAD_SIZE`. Three more fighters, zones and profiles, no more |
| Decisions per tick      | One per living ally   | Ten goals scored, each a handful of multiplies                     |
| Squad resolution        | One pass per tick     | Resolved together so zone claims cost nothing extra                |
| Friendly-fire check     | One per ally per tick | A point-to-segment distance against everything else in the arena   |
| Settled mission ids     | 500                   | Bounded, oldest dropped first                                      |
| History per crew        | 40 lines              | Bounded, oldest trimmed first                                      |
| Squad section in a save | Under 3 KB            | Four records, what they fly, what they learned and their orders    |

The quick command is DOM that is rebuilt only when the squad or the dial state
changes, and refreshed in place otherwise, so opening it mid-fight costs one
layout rather than one per frame.

## Crew cost (Milestone 20)

The crew costs nothing per frame. It is plain data with no scene objects, no
listeners and no timers, and the only work it does is arithmetic when a panel
opens, a sortie is reported, or days pass.

| Thing                     | Budget                 | Why                                                                    |
| ------------------------- | ---------------------- | ---------------------------------------------------------------------- |
| Drift assessment          | Once per panel refresh | A handful of additions over two records, with no allocation per frame  |
| Drawback evaluation       | Two per assessment     | One evaluator per pilot, looked up in a table rather than searched     |
| Crew settlement           | Once per in-game day   | Driven by the same day count the market and the war use                |
| Settled mission ids       | 500                    | Bounded, oldest dropped first, so a long campaign cannot grow the save |
| Service history per pilot | 40 lines               | Bounded, oldest trimmed first                                          |
| Crew section in a save    | Under 4 KB             | Five records, their links, injuries and history                        |

The berth panel grows by one row per pilot and refreshes in place rather than
rebuilding while it is open, the same as the rest of that panel.

## Progression cost (Milestone 19)

Progression costs nothing per frame. Growth is a small object computed from a
machine's level and rank, read once when a fight starts and once when a panel
opens, never per hit and never per frame.

| Thing                 | Budget                 | Why                                                                    |
| --------------------- | ---------------------- | ---------------------------------------------------------------------- |
| Growth computation    | Once per fight         | Handed to the arena and the controller at construction, not recomputed |
| Locomotion scaling    | Once per session       | A level does not change mid-fight, so the scaled profile is built once |
| Damage scaling        | One multiply           | Applied where a packet already becomes damage                          |
| Level from experience | At most 29 steps       | A loop over the level table, run on an award and on a panel open       |
| Progression in a save | Under 1 KB per machine | Level, experience, rank, two id lists, six counters and paid ranks     |
| Service history       | 40 lines               | Bounded, oldest trimmed first                                          |

The one thing that does grow is the berth panel, which lists nine modules and six
goals. It is DOM, it is only built when a berth is opened, and it refreshes in
place rather than rebuilding while it is on screen.

## Economy cost (Milestone 18)

The market has no render cost: it is a DOM panel over derived data, and it draws
nothing into the scene. What it does cost is a little work per day of world time
and a little more in the save.

Measured in the browser on WebGPU at High, seed 20260825, standing in the
Contracts Office with the board open:

| State                                      | Draw calls | Frame time | Notes                              |
| ------------------------------------------ | ---------- | ---------- | ---------------------------------- |
| Contracts Office, board closed             | 11 meshes  | 0.2 ms     | An ordinary interior room          |
| Contracts Office, board open with 4 offers | 7 draws    | 1.1 ms     | Movement is stopped while it is up |

Budgets the code holds itself to:

| Thing                       | Budget               | Why                                                                                  |
| --------------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| Offers on one board         | 5                    | A board a person can read in one go, and a bounded amount of derived work            |
| Offer generation            | Once per rotation    | `offers()` derives from the rotation number, so it is stable and cheap to recompute  |
| Market settlement           | Once per in-game day | Driven by the clock's absolute day number, so no time path can charge twice          |
| Service history per machine | 40 lines             | Bounded, oldest trimmed first, so a long campaign cannot grow a save without limit   |
| Market section in a save    | Under 2 KB           | Money, standing, signed offer ids and pending orders. The board itself is not stored |

The board is derived rather than stored on purpose, which is also why it costs
nothing at load: there is no roll to redo and no list to validate.

## Mission lifecycle cost (Milestone 17)

Measured in the browser on WebGPU at High, seed 20260825, deploying from the
alert board through to the ground:

| State                            | Draw calls | Frame time    | Frame rate |
| -------------------------------- | ---------- | ------------- | ---------- |
| Planning, readiness on the board | 99 to 102  | 0.5 to 0.7 ms | 144        |
| Carrier run                      | 99 to 102  | 0.5 to 0.7 ms | 144        |
| Active sortie in the region      | 106 to 112 | 0.6 to 0.9 ms | 144        |

**The carrier run is a phase, not a scene.** It draws nothing of its own: the
transition is the world panel reporting a mission phase while the same world
keeps running. Ten to thirty seconds of flight, skippable, and nothing about the
result changes if it is skipped.

**A mission adds no per-frame cost of its own.** Progress is reported from
numbers the arena, roster and city already compute; the objectives are eight
pure functions over one object; results are computed once at the end.

**There is no second game state**, so deploying costs a teleport and a pilot
session, both of which the world map already paid for.

## Attack director cost (Milestone 16)

Measured in the browser on WebGPU at High, seed 20260825, with four incidents
running at once at the highest crisis frequency:

| State                                 | Draw calls | Frame time    | Frame rate |
| ------------------------------------- | ---------- | ------------- | ---------- |
| Quiet war, nothing inbound            | 99 to 102  | 0.5 to 0.7 ms | 144        |
| Four simultaneous alerts on the board | 99 to 102  | 0.5 to 0.7 ms | 144        |

**Simultaneous crises cost nothing to draw.** Two overlapping emergencies are
two records in a map; neither creates an arena, a view, a mesh or a scene. The
only cost of an alert is a list item on a panel that is already there.

The director's own arithmetic is bounded by design:

- **Rolls happen on a fixed cadence** (every 1,800 ticks) rather than every
  tick, so elapsed time contains the same number of chances however the frame
  rate varies.
- **A roll is one weighted pick across the region list**, which is eight
  entries, and it usually refuses.
- **Resolution is a handful of additions** and one seeded draw, producing a
  ledger of six lines.
- **Resolved incidents are pruned** once they are old enough, so the list is
  bounded across a long campaign.

**What is saved** is a snapshot of the same state: escalation, pressure, a
record per region and every live incident. A mid-campaign director serialises to
a few kilobytes.

## Kaiju behaviour cost (Milestone 15)

Measured in the browser on WebGPU at High, seed 20260824, with a creature
driving itself in Hong Kong:

| State                                  | Draw calls | Frame time    | Frame rate |
| -------------------------------------- | ---------- | ------------- | ---------- |
| Creature sensing, deciding and closing | 106 to 112 | 0.6 to 0.9 ms | 144        |

Behaviour costs nothing to draw: it adds no mesh, no material and no instance.
What it adds is arithmetic on the combat tick, and the shape of that arithmetic
is the budget:

- **Senses are a loop over stimuli, not a query over the world.** The world hands
  the creature a short list of what is happening; nothing walks the scene.
- **A decision is eleven pure functions over one plain object.** No allocation
  beyond the considered list, no lookups, and no path finding.
- **Navigation probes at most nine directions.** One direct line, then eight
  detour bearings, each a couple of world samples. There is no graph, no grid,
  and nothing cached between ticks.
- **Contacts are bounded by what is in the fight**, decay on their own, and are
  forgotten after 45 seconds of nothing refreshing them.

One creature per fight today. The costs above are per creature per combat tick,
so a squad milestone should measure again rather than assume this scales.

## Destruction cost (Milestone 14)

Measured in the browser on WebGPU at High, seed 20260824, fighting in the
Hong Kong waterfront blocks:

| State                                          | Draw calls | Frame time    | Frame rate |
| ---------------------------------------------- | ---------- | ------------- | ---------- |
| City intact, nothing coming down               | 106 to 110 | 0.6 to 0.8 ms | 144        |
| Blocks collapsing, 48 rubble bodies in the air | 155        | 0.8 ms        | 144        |

**Debris ceilings by preset**: low 60, medium 140, high 260, cinematic 420. The
pool is allocated once at that size and never grows. One collapse may ask for at
most 24 chunks however large the building was, the pool gives what is free, and
the shortfall is counted and shown on the panel rather than quietly allocated
for. All live rubble shares one draw call.

Three rules keep destruction off the frame budget:

- **Nothing below a block is simulated.** A destruction group covers a few city
  blocks; there is no wall panel, no per-building rigid body, and no fracture
  solve at runtime.
- **Everything settles.** A chunk that lands freezes and is never integrated
  again, so a street full of rubble costs transforms and nothing else. Anything
  still moving after 45 seconds is recycled regardless.
- **Only changed blocks are redrawn.** The view compares each group's state
  against what it last drew, so a city standing still costs nothing, and a fight
  redraws a handful of groups rather than the city.

**What is saved**: a summary per damaged block, not a scene. A heavily levelled
Hong Kong serialises to about 5 KB, asserted in a test that also fails if the
snapshot ever starts containing anything mesh-shaped.

## Damage cost (Milestone 13)

Measured in the browser on WebGPU at High, seed 20260824, with a damaged machine
in Hong Kong:

| State                                | Draw calls | Frame time    | Frame rate |
| ------------------------------------ | ---------- | ------------- | ---------- |
| Undamaged machine, no marks worn     | 99 to 102  | 0.5 to 0.6 ms | 144        |
| Damaged machine wearing battle marks | 100 to 103 | 0.5 to 0.7 ms | 144        |

All marks share one draw call: they are thin instances on a single pooled mesh
capped at twenty-four, which is the same ceiling the damage record itself keeps.

**Nothing about visible damage is saved as geometry.** A scar is four numbers
(component, severity, kind, seed) and the debris is grown from the seed, so a
machine that has been through twenty fights costs the same to save as one fresh
off the line. A full damage record for a machine serialises to well under two
kilobytes, asserted in a unit test.

A machine's components add eight zones to the arena where there was one. The cost
is one more sphere sweep per volume per tick, against eight spheres rather than
one, which does not register against the frame budget at fight scale.

## Ranged cost (Milestone 12)

Measured in the browser on WebGPU at High, seed 20260824, with a fight live in
Hong Kong and rounds in the air:

| State                                | Draw calls | Frame time    | Frame rate |
| ------------------------------------ | ---------- | ------------- | ---------- |
| Idle, weapons carried, nothing fired | 99 to 102  | 0.5 to 0.6 ms | 144        |
| Salvo and cannon fire, rounds in air | 102 to 111 | 0.6 to 1.0 ms | 144        |

Rounds cost one draw call between all of them: they are thin instances on a
single pooled mesh whose buffer is allocated once at the quality preset's
ceiling and never grows.

**Projectile ceilings by preset**: low 48, medium 96, high 180, cinematic 320.
The simulation refuses a shot when the pool is full and says so; it does not
allocate under fire, and the renderer draws at most what the preset allows
however many rounds are handed to it.

Two rules keep ballistics off the frame budget entirely. Nothing is simulated
more than 2,400 m from the fight, and nothing lives longer than 12 seconds
whatever its speed. A round that leaves the bubble, runs out of range, hits the
ground or outlives its clock is retired on the tick it does so, so there is no
such thing as a shell still flying over the Pacific ten minutes later.

## Melee cost (Milestone 11)

Measured in the browser on WebGPU at High, seed 20260824, with a fight live in
Hong Kong:

| State                             | Draw calls | Frame time    | Frame rate |
| --------------------------------- | ---------- | ------------- | ---------- |
| Combo, grapple and dodge exchange | 98 to 100  | 0.6 to 0.9 ms | 60 to 144  |
| Move list open                    | 100        | 0.9 ms        | 144        |

Nothing new is drawn: defences, holds and finishers are all state on fighters the
arena already had, and the move list is DOM built once when the panel opens.

The one query with a cost worth naming is `SpaceQuery.isClear`, which scans the
active region's city blocks linearly. It is asked a handful of times a second by
grapples, dodges and finishers rather than every frame; if that ever changes it
wants a grid rather than a loop, and the comment in `bootstrap.ts` says so.

## Combat cost (Milestone 10)

Measured in the browser on WebGPU at High, seed 20260824, in Hong Kong with the
city, the streamed terrain, a piloted machine and a live fight:

| State                              | Draw calls | Frame time    | Frame rate |
| ---------------------------------- | ---------- | ------------- | ---------- |
| Machine out, no target             | 85 to 88   | 0.8 ms        | 144        |
| Target spawned, exchanging attacks | 98 to 101  | 0.6 to 0.8 ms | 144        |
| Hit debug view on                  | 100        | 0.6 ms        | 144        |

The creature costs whatever its model resolves to plus two pooled meshes: one
wireframe sphere mesh carrying every body zone marker, and one carrying the hit
markers. Hit resolution itself is arithmetic: for each live volume, four swept
samples against each of the target's six zones, which is under two hundred
distance tests per tick with one attacker and one target.

Combat runs on its own fixed sixty-tick clock, accumulated from frame time and
capped at eight ticks per frame, so a stalled frame cannot run a second of
fighting at once.

## Piloted Jaeger cost (Milestone 09)

Measured in the browser on WebGPU at High, seed 20260824, standing in Hong Kong
with the city and the streamed terrain both live:

| State                              | Draw calls | Frame time    | Frame rate |
| ---------------------------------- | ---------- | ------------- | ---------- |
| World ground view, no machine      | 88         | 0.9 ms        | 60 (vsync) |
| Machine out, chase camera, running | 85 to 87   | 0.8 to 2.0 ms | 60 (vsync) |
| Combat camera                      | 67         | 0.8 ms        | 60 (vsync) |
| Conn-Pod camera                    | 72         | 0.5 ms        | 60 (vsync) |

The machine costs four pooled meshes plus whatever its model resolves to: one
decal quad, one dust box, one street-light box and one flyer box, each a single
draw call however many instances they carry. Footprints are a ring buffer at the
preset's ceiling, so a long run reuses the oldest print rather than growing.

Two things were found by looking rather than by measuring. The streamer's own
white player marker stands exactly where the machine stands and hid it
completely, so it is switched off while a machine is being driven. And the
scale-reference pools are excluded from bounding-box culling for the same reason
the interior staff pool is: they are allocated parked below the world and moved
every frame.

## Shatterdome interior cost (Milestone 08)

One room at a time is the whole budget. Measured in the browser on WebGPU at
High, seed 20260824:

| Room                              | Meshes | Draw calls | Staff drawn | Frame time | Frame rate |
| --------------------------------- | ------ | ---------- | ----------- | ---------- | ---------- |
| LOCCENT Command                   | 12     | 11         | 6 of 6      | 0.2 ms     | 144 fps    |
| Kaiju Research                    | 11     | 9          | 5 of 5      | 0.1 ms     | 144 fps    |
| Jaeger Bay, two machines resolved | 17     | 32         | 14 of 14    | 0.3 ms     | 144 fps    |
| Conn-Pod                          | 10     | 5          | 0           | 0.1 ms     | 144 fps    |

A room is six shell meshes, one mesh per obstacle kind, one per fixture kind, one
pooled staff mesh, and whatever the berths resolve. Walking through a door
disposes the room behind and builds the next, so the Jaeger bay costs nothing
while the player is in the archive.

Two costs were found by looking rather than by measuring. The staff pool is
allocated with its instances parked below the floor, which put its bounding box
nowhere near the room and had the whole mesh frustum culled: a fully staffed
command floor reported six people and drew none. And on WebGPU a thin-instance
buffer whose count grows from zero is not picked up by marking it updated; the
buffer has to be set again. Both are now handled where the count changes, not per
frame.

## City cost (Milestone 07)

The Hong Kong layout at seed 20260823, six kilometre region radius:

| Quantity                | Value   | Note                                                   |
| ----------------------- | ------- | ------------------------------------------------------ |
| Blocks                  | 710     | Across seven districts                                 |
| Towers                  | 1,480   | What is actually drawn; slums stack four to a block    |
| Landmark slots          | 14      | Each naming an asset manifest id for a future model    |
| Roads and harbour lanes | 9 and 4 | Polylines agents travel, not carved geometry           |
| Defence positions       | 17      | Missile batteries, sea wall, checkpoints, a Jaeger pad |
| Destruction groups      | 135     | 480 m cells; one mesh each, never one city mesh        |
| Evacuation capacity     | 1,398k  | Summed from district area and population density       |
| Layout in a save        | 0 bytes | Derived from the region and the seed, so never stored  |

Measured in the browser on WebGPU at Medium, standing at the region centre at
midday:

| Measurement  | Calm                                        | Attack                                    |
| ------------ | ------------------------------------------- | ----------------------------------------- |
| Towers drawn | 620 in 31/135 groups                        | same                                      |
| City meshes  | 53                                          | 53                                        |
| City GPU     | 0.09 MB                                     | 0.09 MB                                   |
| Live agents  | 199 of 618                                  | 222 of 618                                |
| Agent mix    | 107 vehicle, 45 crowd, 27 ship, 20 aircraft | 196 vehicle, 7 crowd, 1 ship, 18 aircraft |
| Draw calls   | 74                                          | 74                                        |
| Frame time   | 1.0 ms                                      | 0.5 ms                                    |
| Frame rate   | 143 fps                                     | 144 fps                                   |

The agent mix is the interesting column: the total barely moves while every kind
moves a long way, which is why counts are reported per kind rather than summed.

Frame rate is not asserted in the browser tests. Playwright's Chromium falls back
to a software rasteriser, so an fps reading from it measures the test runner
rather than this code; the figures above are taken by hand on the real renderer.
What the tests assert instead is draw calls under budget and the simulation still
ticking, which proves the city is not blocking the main thread.

Two costs were found by measurement and fixed. Agents asked the streamer for a
ground height every frame, which is a geodetic conversion, a tangent basis and a
sector lookup each: the terrain is now sampled once into a 65 by 65 grid and
interpolated. And a 320 m destruction grid produced 233 groups over a twelve
kilometre city, so a mid-range preset covering its group budget drew a patch
rather than a city; 480 m cells bring it to 135.

## Environment cost (Milestone 06)

| Quantity                    | Value              | Note                                                   |
| --------------------------- | ------------------ | ------------------------------------------------------ |
| Day length                  | 86,400 ticks       | One tick is one in-game second; 24 real minutes        |
| Weather front slot          | 21,600 ticks       | Six in-game hours; front lookup is O(1) at any tick    |
| Front crossfade             | Last 25% of a slot | Smooth by construction rather than by a smoothing pass |
| Wave components             | 3                  | Sum of travelling sines; never rigid bodies            |
| Max wave amplitude          | 14 m               | Capped so a storm is not taller than the Jaeger in it  |
| Lightning roll window       | 180 ticks          | A strike is a discrete event both sides can agree on   |
| Environment state in a save | 3 numbers          | Elapsed ticks, day length, wetness                     |

Weather costs nothing to store because it is derived. Only wetness is history.

Fog density is solved from the visibility distance gameplay reads, as `sqrt(3) / visibility`, so the
fog the player sees and the metres an AI is told it can see are the same number. Getting that constant
wrong squares the exponent and fogs the scene flat well inside the stated range; it did, and was fixed
by measurement.

## Frame pacing guarantees (Milestone 01)

Simulation cost per frame is bounded by construction, independent of how long the tab was suspended:

| Guard                             | Value             | Effect                                                    |
| --------------------------------- | ----------------- | --------------------------------------------------------- |
| `MAX_FRAME_DELTA_MS` (loop.ts)    | 250 ms            | Clamps the delta before it reaches the accumulator        |
| `DEFAULT_MAX_SUBSTEPS` (clock.ts) | 5 ticks           | Caps sub-steps per `advance()`, then clamps the remainder |
| Fixed step                        | 1000/60 ≈ 16.7 ms | Simulation rate, independent of render framerate          |

Worst case is 5 simulation ticks per rendered frame. Simulation time falls behind wall clock rather than
attempting to catch up — measured: a 4-second main-thread stall advanced ~25 ticks instead of the 240 an
unguarded accumulator would have queued.

## Manual baseline observed (2026-08-19, Milestone 00, dev build)

- Scene content: 1 ground plane, 1 box placeholder, 1 directional light, 1 shadow generator (1024 shadow
  map), 1 orbit camera.
- Chromium (Playwright default) + a WebGPU-capable browser both hold steady well above 60 fps at 3 draw
  calls — expected, since there's effectively nothing to render yet. This number carries no predictive
  value for later milestones; it only confirms the pipeline itself imposes no baseline overhead problem.

## Known risk

Production bundle currently ships one >5 MB unminified JS chunk (full Babylon core, no code-splitting).
See TECH_DECISIONS.md — deferred until real feature-module boundaries exist to split along.

## Next action

Define actual Low/Medium/High/Cinematic presets and per-system budgets once there are real systems
(particles, rigid bodies, AI agents, streamed sectors) to budget — no earlier than Phase 4 (world
streaming) per ROADMAP.md, and likely finalized in Phase 9.

## Interface budgets (Milestone 28)

The HUD is DOM and CSS, so its cost is measured in nodes and reflows rather than
draw calls.

| Budget                | Ceiling | Why                                                           |
| --------------------- | ------- | ------------------------------------------------------------- |
| Animation duration    | 900 ms  | `MAX_MOTION_MS`. Nothing may loop; a critical pulse runs once |
| HUD nodes per refresh | ~40     | Components, target zones, weapons, context and instruments    |
| Instrument count      | 11      | Fixed. Adding one is a row in the model                       |
| Critical band nodes   | 0 to ~6 | Empty when nothing is critical, which is most of the time     |

Strips are rebuilt on refresh rather than diffed, which is affordable at this
node count. If the instrument list grows substantially, the same signature
comparison the world map's site list uses should be applied here.

## Sound

**Sustained voices: 48.** A sustained voice is an oscillator or looping buffer
that stays alive across frames: a machine layer, a creature layer or a music
layer. The measured worst case in the deterministic scenario is 24, in a storm
fight with a damaged machine and a creature on screen, so the cap is double the
observed peak. Past it, `SoundStage` refuses to build the next layer and counts
it, and the count is shown in the audio readout rather than being swallowed.

**Why a cap at all.** Layer counts are driven by state, and state can be
pathological: several machines, several creatures and a boss phase at once. A
cap converts that from a frame rate cliff into a documented, visible omission.

**Node churn.** Layers that were already sounding are ramped rather than
restarted, so a machine changing speed does not rebuild its graph. Only layers
that genuinely started or stopped create or destroy nodes. Every one-shot node,
a spoken line included, disconnects itself in `onended`, so a long session cannot
accumulate a graph of finished sounds.

**Ramps: 120 ms.** Every gain change is ramped rather than set. An instant change
is an audible click, which costs nothing to avoid and is impossible to fix later
by turning something down.

**Crossfades: 260 ms to 4 s.** Urgent music changes take the short end and calm
ones the long end. Layers common to both states are held through the change
rather than faded out and immediately back in, which is what stops a transition
sounding like a cut and also avoids rebuilding those voices.

**The conversation record: 200 entries.** Bounded, oldest dropped first, because
it is written to the save file and a campaign that runs for weeks must not
accumulate an unbounded log inside it.

**The radio queue: 4.** One line speaks at a time and at most four wait. A fight
that generates more traffic than that is generating traffic nobody could listen
to anyway, so the excess is dropped by priority rather than queued.

## Two-player battles

**Snapshot rate: one every 6 combat ticks.** Between them only poses go out. A
full snapshot carries stamina, heat, poise, guard, active move and every zone's
health for every fighter; a pose message carries three numbers per fighter. At a
combat tick of 50 ms that is roughly three full snapshots and seventeen pose
messages a second for a two-machine fight.

**Nothing cosmetic is sent.** Debris, particles, civilians, destruction bodies
and every rigid body grown from a seed stay local. This is a correctness rule
first and a bandwidth rule second: a cosmetic body is not authoritative, so
synchronising it would make two clients agree about something neither of them
decides anything from.

**Reliable traffic is proportional to what happened.** One message per combat
event, which in a busy fight is a handful per tick and in a quiet one is none.
Inputs are one per intent, and guest movement is sent on the combat tick rather
than per frame, because the host applies at most one movement per tick anyway.

**Input lag window: 30 ticks behind, 4 ahead.** Anything outside it is refused
and counted rather than applied out of order. At 50 ms a tick that is a second
and a half of tolerance, which is generous for a bad connection and far short of
what would let a stale input arrive in the middle of a different exchange.

**Prediction limit: 20 ticks.** Past that the guest stops extrapolating and says
so. The cost of the limit is a visible freeze; the cost of not having one is a
machine that glides through a wall for four seconds and then teleports.

**Guest timeout: 180 ticks.** About nine seconds of silence before the machine
is held in place. It is not removed and its damage is not undone, and the seat
stays open for a rejoin.

## The simulator

**Scenario library: 50 scenarios.** A scenario is a few hundred bytes, so the
cap is about keeping a browser store small and predictable rather than about
memory. Past it, a new save is refused with a sentence rather than silently
dropping somebody else's scenario.

**Statistics: 100 runs.** Oldest dropped first. It is a scoreboard, not an
archive, and an unbounded log in browser storage is a slow leak.

**Slow motion: one third speed.** Implemented as a smaller step into the same
fixed-step accumulator, so the same ticks happen spread over more wall time. It
does not run more simulation, and it cannot make a fight cost more.

**The rule overlay costs one small object per frame it is read.** It is derived
rather than stored, which is the same trade the rest of the project makes: a
handful of multiplications against the alternative of state that can drift out
of agreement with what produced it.

**Debug drawing is off unless the advanced panel is opened**, and it uses the
hit-volume rendering that already existed rather than a second debug path.
