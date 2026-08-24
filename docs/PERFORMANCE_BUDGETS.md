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
