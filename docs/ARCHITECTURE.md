# ARCHITECTURE.md

Describes what actually exists in code as of Milestone 08. Read alongside [../GAME_SPEC.md](../GAME_SPEC.md) (the binding contract — this file explains _how_ the contract is met, never overrides it) and [../TECH_DECISIONS.md](../TECH_DECISIONS.md) (why each choice was made).

## Module map (current)

```
src/
  main.ts            entry point: finds #appRoot, calls app/bootstrap.startApp(), wires HMR disposal
  app/
    appState.ts       AppState enum + allowed-transition graph + AppStateMachine (pub/sub)
    bootstrap.ts       the only module that wires engine + scene + simulation + overlay + UI together
    config.ts          DEFAULT_SEED and `?seed=` resolution for reproducible dev runs
  engine/
    engineAdapter.ts   WebGPU-first/WebGL-fallback engine selection, resize handling, context-lost/restored
                        hooks, disposal. Nothing outside this file is allowed to branch on backend.
    scene.ts           builds the boot scene: ground, reference-size Jaeger placeholder, sun light + shadow,
                        sky color, orbit/debug camera, rebuildable shadow map
    sectorRenderer.ts  Babylon presentation for streamed sectors: pooled meshes, thin instances, skirts,
                        rebase by root transform, animated water. The only Babylon-aware part of streaming.
    skyView.ts         sun, moon, ambient, sky colour and fog, all driven from one environment sample
    weatherView.ts     rain, snow, spray, lightning and cloud, capacity-capped by quality preset
    ambientAudio.ts    synthesised ambience filtered by the world layer's audio environment
    cityView.ts        the city drawn: one mesh per destruction group, pooled agents on lanes
    interiorView.ts    one Shatterdome room at a time: shell, fixtures, pooled staff, its own camera
    onFootInput.ts     the only file that touches a key or a mouse event, turned into an input snapshot
  simulation/          ← authoritative kernel; imports nothing from Babylon or the DOM
    clock.ts           FixedStepClock — accumulator-pattern fixed timestep, epsilon-guarded, substep-capped
    loop.ts             SimulationLoop — render-delta → ticks, pause/resume/single-step/time scale,
                        MAX_FRAME_DELTA_MS catch-up cap
    kernel.ts           SimulationKernel — entities + rng streams + command queue + events + motion system,
                        serialize/restore/hash
    commands.ts         SimCommand shapes, versioned handlers, registry-based dispatch (no switch)
    events.ts           SimEvent shapes + buffered EventBus (emit queues, drain dispatches)
    rng.ts              createSeededRng (mulberry32), rngInt, RngStreams — named per-subsystem streams
    hash.ts             hashState — deterministic two-lane FNV-1a digest of serializable state
  entities/
    entity.ts           EntityId (branded), EntityRegistry, component definitions/storage, snapshot I/O
  assets/              ← presentation pipeline; manifest.ts and inspection.ts stay Babylon-free
    manifest.ts         AssetManifest types, socket ids, validation, presentation-only overrides
    inspection.ts       AssetInspection type + pure validation of a loaded model against its manifest
    budgets.ts          per-class triangle/material/texture ceilings
    generators.ts       parameterised procedural generators + MaterialPalette
    resolver.ts         manifest -> renderable: model first, generator fallback, one warning, disposal
  world/               ← globe coordinates, terrain and streaming; no Babylon, no DOM
    coordinates.ts      geodetic/ECEF/tangent conversions, distances, great-circle interpolation
    cubeSphere.ts       sector ids, addressing, tangent-adjusted projection, neighbours, ring expansion
    floatingOrigin.ts   anchor, rebase policy, exact rebaseLocal
    regions.ts          region and record types, climates, simulation tiers
    worldState.ts       authoritative world state, tiering, snapshots
    start.ts            default start position, shared by saves and migrations
    terrainNoise.ts     position-hashed 3D value noise, fBm and ridged variants
    terrain.ts          sector terrain generation, cache keys, collision sampling
    terrainService.ts   the generation boundary plus the inline (main-thread) implementation
    sectorStreaming.ts  sector state machine, LOD rings, priorities, budgets, LRU data cache
    worldClock.ts       tick-driven clock, sun and moon positions, twilight and moon phase
    weather.ts          seeded weather fronts, per-kind effects, transitions, wetness
    ocean.ts            wave sampling, depth zones, water states, buoyancy, audio environment
    environment.ts      the query surface AI and combat read; composes clock, weather and ocean
    cityLayout.ts       district grammar to blocks, roads, lanes, zones, defences, destruction groups
    cityActivity.ts     alert levels, evacuation, and activity as densities rather than agents
  shatterdome/         ← the complex: authoritative state, rooms, movement; no Babylon, no DOM
    facilityState.ts   facilities, tiers, construction orders, power and crews, the saved snapshot
    interiorLayout.ts  facility records to rooms: fixtures, doorways, spawn points, the Conn-Pod
    onFoot.ts          person-scale movement, collision, and the unstuck action
    interaction.ts     what the player is looking at, whether it is in reach, and what the prompt says
    staff.ts           shift loads, ambient work positions, and radio chatter from named crew
    session.ts         the live session: room, pose, focus, transitions, orders, radio log
  workers/             ← the only code that runs off the main thread
    protocol.ts         versioned, validated terrain request/response messages
    terrainWorker.ts    worker entry: queued generation, cancellation, buffer transfer
    terrainWorkerClient.ts  main-thread half; falls back to inline when workers are unavailable
  saves/               ← persistence; only indexedDbRepository.ts touches a browser API
    schema.ts           RootSave envelope, metadata, validation, checksums, slot naming
    migrations.ts       pure versioned migration steps + the chain runner
    repository.ts       SaveRepository interface, SaveError, in-memory implementation
    indexedDbRepository.ts  IndexedDB implementation
    saveService.ts      save policy: slots, autosave ring, backups, recovery, export/import
    storageHealth.ts    durability, quota and persistence probing
  data/
    registry.ts         generic ContentRegistry<T> — typed table + validator + duplicate/unknown-id guards
    jaegers.ts           JaegerDefinition type + one placeholder entry proving the registry pattern
    assets.ts            the shipped asset manifests, one per placeholder
    regions.ts           the shipped strategic regions and the terrain anchors they produce
    biomes.ts            biome table, surface classes, climate bands
    climates.ts          what weather each climate zone produces
    districts.ts         district grammar rows and the Hong Kong placement plan
    facilities.ts        the thirteen facilities, their tiers, and how the rooms connect
    personnel.ts         named crew: post, shift, and lines that report real facility state
    quality.ts           Low to Cinematic presets with explicit particle, shadow and water budgets
  debug/
    overlay.ts          DOM readout + transport controls (pause / step / time scale), F3 toggle
    scenarioRunner.ts    headless deterministic scenario runner + `kernel-smoke` fixture
    gallery.ts           asset inspection scene: layout, framing, measurement, damage preview
    globeView.ts         low-detail globe, region markers, active sector tiles
  ui/
    screens.ts           DOM overlay renderers for MainMenu, Loading, Shatterdome placeholder, Error
    galleryScreen.ts     asset gallery panel
    saveScreen.ts        save/load panel with storage health
    worldScreen.ts       globe readouts, teleport and walk controls
    shatterdomeScreen.ts heads-up layer, terminal and berth panels, Conn-Pod instruments, pause menu
tests/
  unit/                clock, rng, rngStreams, hash, entity, events, loop, registry, jaegers,
                        assetManifest, assetInspection, saveSchema, saveMigrations,
                        coordinates, cubeSphere, floatingOrigin — pure logic
  integration/         appState, kernel, scenarioRunner, assetResolver, saveService,
                        indexedDbRepository, worldState — module boundaries and determinism
  e2e/                 boot, debugOverlay, assetGallery, saves, worldMap — Playwright
public/
  assets/models/       drop point for production GLB files; empty by design, README explains the contract
```

Everything else in the target shape (`jaegers/`, `kaiju/`, `combat/`, `destruction/`,
`missions/`, `progression/`, `copilots/`, `audio/`, `network/`,
`sandbox/`) does not exist yet — see [ROADMAP.md](../ROADMAP.md) for which phase
introduces each one. See TECH_DECISIONS.md's "grow-into, not scaffold-ahead" entry for why.

## Simulation kernel

The kernel is the authoritative half of the game and imports nothing from Babylon or the DOM, so it runs
identically in a browser frame, a Web Worker, or a headless test.

**Determinism contract.** State after N ticks is a pure function of `(seed, command sequence, N)`. Three
rules keep that true:

1. `Math.random` is banned in `src/simulation/**` and `src/entities/**`. Subsystems draw from
   `RngStreams.stream(name)`, whose sequences are derived from `masterSeed ^ hash(name)` and are mutually
   independent — heavy use of one subsystem's stream cannot shift another's.
2. Authoritative math uses addition and multiplication only. JS transcendentals (`sin`/`cos`/`pow`) are not
   guaranteed bit-identical across engines.
3. Wall-clock time never enters the kernel. `step()` takes no delta; the fixed step is a constant.

**Tick order.** `step()` swaps the pending command queue (so a command enqueued by a command lands next
tick, keeping one tick's work bounded), applies each command through the handler registry, runs systems
(currently motion integration), then increments the tick counter. Events emitted during a tick are queued,
never dispatched mid-tick — presentation calls `events.drain()` after the tick.

**Commands and events** are plain serializable data carrying a `schemaVersion`. `enqueue` validates type,
version, and payload immediately, so a bad command is attributed to the code that issued it rather than
surfacing as corrupt state later. Dispatch is a `ContentRegistry` lookup keyed by command type — never a
name-based switch.

**Entities.** Ids are branded numbers, monotonic, and never reused; recycling ids lets a stale handle
silently address a different entity. Components are stored per-type and deep-copied on write so callers
cannot mutate simulation state through a retained reference.

**Snapshots.** `serialize()` / `restore()` round-trip the full authoritative state with a schema version and
a seed check; `hash()` digests that snapshot. This is the substrate the Phase 2 save system builds on — see
[../TESTING.md](../TESTING.md) for the round-trip and post-restore determinism tests.

## Simulation loop and frame pacing

`SimulationLoop` converts render deltas into fixed ticks and owns the transport controls. Two independent
guards prevent the spiral of death when a suspended tab resumes and reports one enormous delta:

- the loop clamps any incoming delta to `MAX_FRAME_DELTA_MS` (250 ms) before accumulating, and
- `FixedStepClock` caps how many sub-steps a single `tick()` may run, then clamps the leftover accumulator.

Simulation time is allowed to fall behind wall clock — that is the intended trade. A 4-second stall advances
roughly 25 ticks rather than the 240 an unguarded accumulator would queue.

`requestSingleStep()` runs exactly one tick on the next `advance()` even while paused, which is what the
overlay's Step button drives.

## Application state machine

`AppState` = `Boot | MainMenu | Loading | Shatterdome | Deployment | Combat | Results | Error`. The
transition graph lives in `appState.ts` as data (`ALLOWED_TRANSITIONS`), not in `if`/`switch` chains
scattered through the app. `bootstrap.ts` is the single subscriber that maps `(state) -> DOM screen`.

`Boot -> MainMenu -> Loading -> Shatterdome -> MainMenu`, `MainMenu <-> AssetGallery` and
`MainMenu <-> Saves` and `MainMenu <-> WorldMap` are reachable today. `Deployment`, `Combat`, and `Results` exist as valid graph nodes with legal edges so later
milestones can wire real screens into them without redesigning the graph, but nothing transitions into them yet — that would be a fake screen
implying a system that doesn't exist. `Error` is reachable today only from a fatal boot failure (engine
init threw); the Error screen's recovery action is a page reload, because a failed boot leaves no working
engine to hand control back to.

## Engine bootstrap and disposal contract

`createEngineAdapter(canvas)`:

1. Calls `WebGPUEngine.IsSupportedAsync`; on true, constructs and `initAsync()`s a `WebGPUEngine`. On false
   (or a thrown/rejected check), constructs a WebGL `Engine`. Gameplay code only ever sees `AbstractEngine`.
2. Registers exactly one `window "resize"` listener and exactly one pair of
   `onContextLostObservable`/`onContextRestoredObservable` observers, fanned out to caller-supplied handler
   sets so `bootstrap.ts` can show/hide the context-lost banner without the adapter knowing about DOM.
3. Returns a `dispose()` that removes the resize listener, removes both Babylon observers, stops the render
   loop, and calls `engine.dispose()`. `bootstrap.ts`'s returned `AppHandle.dispose()` unsubscribes the
   state-machine listeners, disposes the debug overlay, disposes the kernel (clearing the event bus and
   command queue), then disposes the adapter, in that order.

`src/main.ts` calls `import.meta.hot.dispose(() => handle?.dispose())` so a Vite HMR reload (which re-runs
the module without a full page navigation) tears down the previous engine/scene/listeners first — this is
the mechanism that keeps "reload doesn't duplicate canvases/listeners/engines" true under both a full
browser reload (trivially true — fresh JS realm) and an in-page HMR reload (needs the explicit dispose hook).

## Debug overlay

`DebugOverlay` (`src/debug/overlay.ts`, formerly `engine/diagnosticsPanel.ts`) wraps a Babylon
`SceneInstrumentation` and `scene.onAfterRenderObservable`, reporting renderer backend, Babylon version,
fps, frame time, draw calls, simulation tick, entity count, active physics bodies, seed, and run state. Text
refreshes on a 250 ms interval rather than per frame — a 144 Hz DOM write is both wasteful and unreadable.

Values are read through a `DebugOverlaySources` interface rather than reaching into globals, and each is
tagged with a `data-field` attribute so browser tests assert on specific values instead of scraping one
concatenated string.

`activePhysicsBodies()` returns `number | null`. No physics backend is wired yet, so bootstrap supplies a
provider returning `null` and the overlay prints "n/a (no backend)" — a fake `0` would imply a working
physics integration.

Controls (Pause/Resume, Step, time-scale select) drive `SimulationLoop` directly. The dependency runs one
way: presentation reads and commands the simulation; the simulation never reads the DOM. `F3` toggles
visibility. Dispose releases the keydown listener, the Babylon observer, the instrumentation, and the DOM node.

## Asset pipeline

Gameplay never names a mesh. It names an asset manifest id and a socket id, which is what makes a model
swap a data change rather than a code change.

**Manifest.** `AssetManifest` (`src/assets/manifest.ts`) carries the production source, a mandatory
procedural fallback generator, material slots, animation tags, sockets, a collision proxy, audio and
portrait slots, a nominal height, a seed, and provenance with an explicit licence. It is plain serializable
data with no Babylon or DOM types, so it validates headlessly and can move to JSON later untouched.

**Resolution order.** `AssetResolver.resolve()` tries `source.url` first. Any failure falls through to the
generator and logs exactly one warning per asset id naming the asset, the path, the generator that took
over, and where to put the file. A missing model is a content gap, not a crash, so the game stays playable
with `public/assets/models` empty — which is how it ships.

**Generators are parameterised, never per-unit.** Eight generators cover every asset class: `biped`,
`quadruped`, `serpentine`, `block-building`, `wheeled-vehicle`, `hull-ship`, `prop`, `shatterdome-module`.
A 75m Jaeger, a 68m heavy frame and an 82m bipedal kaiju are all `biped` with different numbers. Adding a
unit means adding a manifest, not a mesh factory. Generators draw from a seeded RNG, so geometry is
reproducible from the manifest's seed.

Each generator reports its true measured height for whatever `heightMeters` it is given, so a manifest
never needs a hand-tuned nominal height to satisfy scale validation.

**Sockets.** `head`, `chest`, `back`, `reactor`, `hand.L/R`, `forearm.L/R`, `foot.L/R`, `muzzle`. A
production model binds a socket through its `nodeName`; otherwise the resolver creates the node at the
manifest position. Either way the socket exists, so attachment code never branches on asset origin.

**Validation.** `validateAssetInspection` compares what was actually loaded against the manifest: height
within 10 percent, +Z forward, origin within 5cm of the base, every socket node present, every animation
tag resolvable, no failed textures, and triangle/material/texture counts against the class budget in
`budgets.ts`. Wrong scale, wrong axis, wrong origin, missing nodes, missing clips and missing textures are
errors. Budget overruns are warnings, because they cost performance rather than correctness.

**Overrides.** `AssetManifestOverride` can only reach `source`, `fallbackGenerator`, `materials` and
`portrait`. Collision, sockets, nominal height, animation tags and asset class are structurally
unreachable, which is how "changing a manifest cannot change gameplay" is enforced rather than merely
intended.

## Asset gallery

`AssetGallery` (`src/debug/gallery.ts`) loads every registered manifest side by side, frames each from its
measured size, and reports budget status. Every figure on the panel is measured from the built geometry, so
it can disagree with the manifest and say so.

The damage slider is a presentation preview: parts tint toward scorch and, past 65 percent, detach outward
in order of distance from the silhouette's centre. Ranking geometrically keeps it generic, since the
gallery has no idea what a "torso" or a "tail" is called. This is not the component damage model, which
does not exist yet.

The gallery owns its fill light, deck, damage materials and every resolved asset, and releases all of them
in `dispose()`. It borrows the boot scene rather than creating its own, so the debug overlay's scene
instrumentation stays valid across the transition.

## The world

Earth is a scaled cube-sphere, not a flat plane. Authoritative positions are
geodetic, sectors are cube-sphere cells with reprojection-based neighbour lookup,
and a floating origin keeps local coordinates small. Exactly one region receives
combat-grade simulation while every other is a cheap strategic record.

Full detail, including the measured numbers behind each choice, is in
[WORLD_COORDINATES.md](WORLD_COORDINATES.md).

One deliberate boundary: `src/world/**` uses trigonometry, which `src/simulation/**`
is forbidden from doing. There is no way to place points on a sphere without it,
so world coordinates sit outside the bit-exact kernel. See TECH_DECISIONS.md.

## Sector streaming

Three modules with one seam between each pair, so each can be tested without the others.

**Generation** (`world/terrain.ts`) is a pure function of `(seed, sectorId, lod, anchors)`.
It draws from noise hashed on the sample position rather than from an RNG stream,
because two sectors sharing an edge have to agree on that edge no matter which was
generated first, or whether the other was generated at all. Shared edges match
exactly, not approximately: the test asserts a difference of zero.

**Scheduling** (`world/sectorStreaming.ts`) owns the state machine: `absent`,
`queued`, `generating`, `cpu-ready`, `gpu-uploading`, `active`, `sleeping`,
`evicting`. It knows nothing about Babylon and hands finished terrain to a
`SectorSink`. Two rules shape it:

1. Terrain data and GPU meshes have separate lifetimes. Evicting a sector frees its
   meshes and keeps its data in a byte-bounded LRU cache, so turning around is
   cheap without a single mesh being kept alive for the sake of cached data.
2. Nothing blocks. Generation and upload are both promises, and both are rate
   limited per update, so a burst of forty nine sectors cannot land in one frame.

Rings are square, expanded breadth-first through the eight surrounding sectors.
Edge-only expansion makes diamond rings, which leave the four corners of the
loaded area empty; on screen that is a black notch in the middle distance where
the ground stops. Depth 0 to 2 is visible at levels of detail 0 to 2, depth 3 is
uploaded and slept as a preload ring. Priority is ring depth first, then a
velocity bias within a ring, then a deployment target worth a ring and a half.

Eviction is deferred by one update. A sector that leaves and returns within a
frame, which is what happens when the player wobbles across a boundary, is
rescued instead of rebuilt.

**Presentation** (`engine/sectorRenderer.ts`) builds vertices in each sector's own
tangent frame rather than the player's. A floating origin rebase then costs one
transform per sector root instead of rebuilding every vertex buffer, and stays
exact, because the rotation between the two frames is carried by the root rather
than approximated away. Meshes are pooled by level of detail, city cells and
traffic markers are thin instances, and every mesh carries a skirt sized from the
sector's own relief to cover the gap where a coarser neighbour samples the shared
edge at half the resolution.

**Off the main thread.** `workers/terrainWorker.ts` is the only code in the project
that runs off the main thread. It drains one job at a time with a macrotask
between them, so a cancel for a sector the player has already flown past lands
before that sector is generated rather than after. Buffers are transferred, not
copied. `WorkerTerrainService.create()` falls back to inline generation with one
warning if a worker cannot be constructed; the streamer cannot tell the
difference, and the panel reports which path is live rather than leaving it to
be guessed.

**No new authoritative state.** Terrain is derived from the world seed, which the
save already stores, so nothing about streaming is written to a save and no
migration was needed. Two streamers built from the same seed produce identical
digests for every sector; that is asserted rather than assumed.

## Environment

Four modules in `src/world/`, none of which import Babylon or the DOM, plus three
in `src/engine/` that read what they produce and decide only how it looks.

**The clock** advances with simulation ticks, never with wall clock. One tick is
one in-game second, so a day is 86,400 ticks and twenty four real minutes.
Pausing the simulation pauses the sun, and a save reproduces the sky it was
written under. Sun and moon positions come from the standard declination and
hour-angle formulae, which give real seasons and real latitude behaviour; the
model ignores the equation of time and assumes a circular orbit, and says so.

**Weather** is derived, not simulated forward. Fronts occupy fixed six-hour
slots, and the front covering any tick is a direct lookup from
`(seed, climate, slot)`. A tick a thousand years out resolves as fast as the
first. Steady weather holds for three quarters of a slot and then crossfades, so
transitions are smooth by construction rather than by a smoothing pass. The one
value that is genuinely history is wetness: ground stays wet after rain stops,
and that single number is the only weather state a save carries.

**The ocean** is a sampled height field, never a set of bodies. `sampleWaveHeight`
is pure in position, time and wind, so gameplay, rendering and any future physics
all ask one question and get one answer. Wave phase is read from globe-fixed
coordinates rather than the floating-origin frame, or the whole sea would shift
sideways every time the origin rebased. Buoyancy is exported as a force
calculation, tested and unused, because no physics backend exists yet.

**Water states** are `dry`, `wading`, `surface-combat`, `swimming` and
`underwater`. The distinction that carries the design is whether the feet are on
the bottom: a Jaeger standing chest deep on the shelf is fighting, not swimming.
`resolveFeetHeight` decides between standing, floating and diving by comparing
depth against the body's own height, so a 75 m machine wades through shallows it
would otherwise be bobbing in.

**`environment.ts` is the query surface** AI and combat talk to. It returns light
level, visibility in metres, traction, movement multiplier, wind push, ranged
accuracy penalty, water situation and audio environment. Nothing in it can reach
a scene graph, which is the point: an AI deciding whether it can see a target and
a test asking the same question must go through the same door.

**Weather is not cosmetic.** Everything the sky does lands in `EnvironmentEffects`,
and if a value is not there then nothing outside rendering can act on it and the
gap is visible. Fog and darkness cut visibility, wetness cuts traction, ice cuts
it much harder, water slows movement, wind and rain spoil ranged accuracy, and
lightning briefly restores light.

**Presentation reads the same sample.** `SkyView` drives the boot scene's existing
sun rather than adding a second one, owns a moon and an ambient fill, and solves
fog density from the same visibility distance gameplay reads, so what the player
sees and what the simulation believes cannot drift apart. `WeatherView` caps every
emitter at construction from the active quality preset. `AmbientAudio` is a
synthesised noise bed filtered by the world layer's decision, not a sound system.

## The city

Three modules, split the same way the environment is: a grammar, a state model,
and a renderer that reads both and owns nothing.

**`data/districts.ts`** is a district grammar. A district is a rule for making
blocks, not a set of them: block size, street width, height range, coverage,
towers per block, irregularity, colour, neon density, population density and
evacuation priority. Adding a district is a row. The Hong Kong plan places seven
of them as wedges measured from the region's seaward bearing, so the whole plan
rotates with the coast rather than being pinned to compass north.

The layout is original and stylised. It takes the shapes a dense harbour city
has, towers on the waterfront with a ridge behind, docks along the shore, an
improvised district grown against the Shatterdome wall, and arranges them from a
seed. No real street plan or map geometry is reproduced, and none is claimed.

**`world/cityLayout.ts`** turns that plan into blocks, landmark slots, roads,
harbour lanes, air corridors, evacuation zones, defence positions, destruction
groups and two deployment routes. Pure and deterministic, so a layout is cached
rather than saved: rebuilding gives the same city.

Positions are metres east and north of the region centre, never geodetic and
never in the floating-origin frame. The region centre does not move, so a rebase
moves one transform rather than every instance. Layout is deliberately not
terrain-aware; heights are read from the streamed collision field at render time,
because a layout must not depend on which sectors happen to be loaded.

Every block carries a destruction group id. That is what makes the city
streamable and damageable at the same time, and it is the structural answer to
the failure mode of a single city mesh.

**`world/cityActivity.ts`** is a density field, not a crowd. It answers how much
is moving in a district and of what kind, and nothing in it knows where any
individual vehicle is. That is the structural answer to the other failure mode:
there is no per-civilian state anywhere, and nowhere for it to live.

Alert level and evacuation progress are the only authoritative parts, carried on
each region record and saved. Alert profiles are a table, so sirens, traffic,
shipping and the military cannot disagree about what "warning" means. Response
ramps over about fifteen in-game seconds rather than switching, and evacuation
flow peaks in the middle of an evacuation because nobody is moving before it
starts and nobody is left once it is done.

**`engine/cityView.ts`** draws it. One mesh per destruction group, capped by the
quality preset nearest-first so a lower preset draws a smaller city rather than a
blurrier one. Agents are pooled thin instances allocated once at the budget;
only `thinInstanceCount` changes as activity rises and falls, and each agent's
position is a function of its index, its lane and the tick. Ground heights are
sampled once into a grid at build time, because asking the streamer per agent per
frame cost a geodetic conversion and a sector lookup each time.

Military traffic rides the same pool as civilian traffic rather than getting its
own mesh: what an alert changes is how many vehicles there are, not how many
kinds of mesh exist. Counts are reported per kind as well as in total, because a
total hides the thing that matters - under attack the crowds vanish while
military traffic fills the roads, so the total barely moves.

## The Shatterdome

Six modules in `src/shatterdome/`, none of which import Babylon or the DOM, plus
a view, an input source and an interface layer that read what they produce.

**A facility is a rule, not a room.** `data/facilities.ts` gives each of the
thirteen spaces a footprint, a deck, a set of stations and a list of tiers, and
each tier carries its construction time, crew cost, power draw, staff slots,
fixture count and one sentence about what it buys. Adding a facility is a row
plus a connection. The registry refuses a tier that adds no fixtures over the one
below it, because an upgrade a player cannot see is not an upgrade.

**Two resources, both real.** Power comes from the reactor and is drawn by
everything else; crews come from logistics and are held for the length of a
build. A laboratory can be refused because the reactor cannot carry it, and a
third order can be refused because there is nobody left to build it. There is no
money here: the economy arrives with its own milestone, and inventing a currency
now would be a fake system.

**The complex is a graph of rooms, not one interior scene.** Only the room the
player is standing in is ever built in Babylon, so the hundred-metre Jaeger bay
costs nothing while the player is in the archive. A facility that has not been
built has no room at all, and the doorway that would lead to it is sealed and
says which facility is missing. Doors, lifts and trams are real edges with real
travel times, and a transition swaps the room at the darkest point of a short
fade rather than cutting.

**Movement is person scale and pure.** `onFoot.ts` is a function from pose,
input, room and environment to the next pose. It resolves one axis at a time, so
a shoulder slides along a wall, and splits a frame into substeps, so a running
player cannot pass through a console between two frames. Every constant is
written down in one object and asserted against Jaeger scale in a test: a person
walks at 2.4 m/s and stands 1.8 m tall, and the interior camera has a five
centimetre near plane and a four hundred metre far plane, not the four hundred
kilometre one the globe view runs.

**The environment reaches inside.** Rooms open to the apron feel the weather the
world layer reports; everywhere else the roof is doing its job. The controller
consumes `EnvironmentEffects` rather than inventing its own traction.

**Nobody is simulated outside the active room.** A facility's population is one
integer derived from its tier and the hour. Inside the active room those numbers
become positions, and a position is a function of index and tick, so a crew
member has no state to update and nothing to save. Named characters are the
exception and a small one: a post, a shift, and lines whose placeholders are
filled from live facility state, so nobody can claim a tier the complex is not at.

**What is saved is what is genuinely history**: which facilities exist, what tier
they are at, what is being built and how far along it is, where the player was
standing and which machine they had selected. The rooms are laid out again from
those records on load.

## Quality presets

Low, Medium, High and Cinematic, each a table of numbers some system reads
directly: particle ceiling and rate, reflection mode, shadow map size, water grid
resolution, wave octaves, how many water sheets animate, a fog multiplier, and
ceilings on city blocks, city agents and resident destruction groups.

The rule the table exists to enforce is that **lowering quality removes detail,
never information**. Each preset lists the telegraphs it draws, and the registry
refuses to register one that drops any of them. Low has no shadows, no
reflections and one wave octave, and still draws the lightning flash, the water
entry spray, the fog cue and the moving sea.

Particle capacity and water resolution are both fixed when their objects are
built, so changing quality tears the ground view down and rebuilds it. That is a
visible reload, which is honest about what the change costs.

## Persistence

Saves go to IndexedDB, never localStorage: localStorage is synchronous,
string-only, and capped at a few megabytes, none of which suits a world snapshot.

**Layering.** `SaveService` owns policy and knows nothing about storage or the
DOM. `SaveRepository` is the storage boundary, with an IndexedDB implementation
and an in-memory one used by tests and as the fallback when the database cannot
be opened. `SaveController` (`src/app/`) holds the parts that genuinely need a
browser: thumbnails, downloads and file reads.

**Fallback.** Private windows expose `indexedDB` and then fail to open it. When
that happens the game keeps running against the memory repository and the storage
panel states plainly that saves will not survive the tab, rather than pretending
they persist or refusing to start.

**What a save contains.** Authoritative simulation state and metadata, nothing
else. Meshes, materials, physics, asset resolution and UI state are rebuilt on
load. `validateRootSave` pushes the document through `hashState`, which rejects
functions, `undefined` and cycles, so an engine object cannot reach a save file.

**Versioning, backups and recovery** are covered in
[SAVE_MIGRATIONS.md](SAVE_MIGRATIONS.md).

**Thumbnails** are produced with `Tools.CreateScreenshotUsingRenderTargetAsync`
rather than by copying the canvas. A WebGPU swap chain is not a drawable 2D
source once its frame has ended, so canvas copies come back blank; rendering
through a render target works on both backends.

## Deterministic scenario runner

`runScenario()` (`src/debug/scenarioRunner.ts`) builds a kernel from a scenario's seed, enqueues each
scheduled command at its tick, steps N times, and returns the final state hash plus entity count. It touches
no browser API, so it runs in plain unit tests. `kernel-smoke` is Milestone 01's fixture: rng-driven scatter
spawning, 120 ticks of motion integration, and a mid-run despawn. Two runs producing different hashes means
determinism broke.

## Data-registry pattern

`ContentRegistry<T extends { id: string }>` is the one mechanism every future Jaeger/kaiju/weapon/facility/etc.
table must use: `register()` runs an injected validator and throws an actionable message on invalid or
duplicate entries; lookups are `get`/`getOrThrow`/`has`/`all`. `data/jaegers.ts` is the first (placeholder)
consumer. Gameplay code must key behavior off registry data, never off a switch statement on an id string.
