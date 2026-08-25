# ARCHITECTURE.md

Describes what actually exists in code as of Milestone 17. Read alongside [../GAME_SPEC.md](../GAME_SPEC.md) (the binding contract — this file explains _how_ the contract is met, never overrides it) and [../TECH_DECISIONS.md](../TECH_DECISIONS.md) (why each choice was made).

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
    jaegerView.ts      the piloted machine: model, footstep decals, dust, scale references, its camera
    combatView.ts      the creature, its body zones as a debug view, where contacts landed, rounds in the air
    pilotInput.ts      keyboard and mouse for a piloted machine, as two plain snapshots
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
    destruction.ts      per-block damage, hazards, rescue, safety scoring, clearing and rebuilding
    director.ts         escalation, breach pressure, regional threat, incidents, transparent resolution
    debris.ts           a fixed pool of rubble: ballistic, frozen on settling, recycled by age
  combat/              ← the fight; no Babylon, no DOM, no wall clock
    arena.ts           fighters, resources, attack state, hit resolution, the event log
    hitVolumes.ts      swept capsules, target spheres, overlap history
    targeting.ts       soft targets, locks, cycling, aim mode, body-zone selection
    reactions.ts       stagger, guard break, launch, knockdown, component shock, finisher windows
    defense.ts         dodges, blocks, perfect guards, parries, combo tracking, graded timing
    grapple.ts         eligibility, struggle, escape, throws, slams, safe failure on obstruction
    finisher.ts        beat state machine, hold and skip settings, placement safety query
    projectiles.ts     a fixed pool of rounds, swept movement, ballistic arcs, the combat bubble
    abilities.ts       status effects as a table, and pure weapon scoring for anything choosing
  missions/            ← a sortie from planning to results; no Babylon, no DOM
    objectives.ts      eight objective rows with their own completion and failure rules, and stages
    mission.ts         the lifecycle, the deployment planner, and the results ledger
  kaiju/               ← how a creature senses, decides and gets around; no Babylon, no DOM
    senses.ts          seven sense channels, contacts as beliefs, damage memory
    behavior.ts        eleven goals as registry rows, utility scoring, hysteresis, explanations
    navigation.ts      direct, detour, climb, burrow, swim, smash, blocked; slope and turn rules
    creature.ts        one creature: senses to goal to path to body, with armour, organs and phases
  jaegers/             ← how a machine moves and is looked at; no Babylon, no DOM
    damage.ts          per-component structure, states, scars, routing, repair orders, the saved record
    roster.ts          one record per machine: status, damage, outstanding work, recovery and rebuild
    locomotion.ts      states, acceleration, turn authority, ground queries, footfalls, reactions
    camera.ts          three rigs, comfort settings, impulse, obstruction, lossless rig switching
    inputBuffer.ts     short queue of presses waiting for a legal moment
    pilotSession.ts    one piloted machine: pose, camera, comfort and buffer in one object
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
    moves.ts             every attack: phases, curves, cancels, volumes, packets, costs and coaching
    props.ts             environmental weapons: mass, reach, damage scale, durability, clearance
    kaiju.ts             creatures as body zones with their own health, armour and consequences
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
    pilotScreen.ts       pilot heads-up layer: state, speed, heading lag, camera and comfort controls
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

## Jaeger locomotion and cameras

Four modules in `src/jaegers/`, none of which import Babylon or the DOM, plus a
view, an input source and a heads-up layer that read what they produce.

**One controller, many machines.** Every difference between a heavy tank and an
agile frame is a row in `LocomotionProfile`: speeds, acceleration, braking, turn
rates, step height, slope limit, stride, booster and get-up time. `stepJaeger`
has no idea which machine it is driving. Three profiles ship, and the tests run
the same courses with all three.

**Mass is acceleration, not shake.** A Jaeger takes seconds to reach a walk,
keeps rolling after the stick is released, turns badly at a run and well when
planted, and covers a fixed stride per footfall. Camera shake is the smallest
part of it and the first thing a player can switch off.

**States are a table and transitions are an ordered list of predicates.** Twenty
states, from `idle` through `wade`, `swim` and `booster` to `knockdown` and
`death`, each carrying its own speed factor, turn authority, whether it listens
to the player at all, and a minimum length. The resolver walks the list in
priority order: death outranks a reaction, a reaction outranks the water, the
water outranks the stick. Adding a state is a row in the right place, never a
branch.

**The animation contract is distance, not time.** The controller emits a stride
phase and a footfall event every `strideMeters` of ground actually covered, with
the foot that landed. An animation system reads those. Nothing in the controller
knows what a clip is called, and the tests assert measured stride against
declared stride, which is what skating would break.

**The ground is queried before it is stood on.** A probe reaches at least half a
stride ahead, in the direction of travel, and further at speed. Rise under
`LEDGE_THRESHOLD_METERS` is ground texture that a 75 m machine walks over; rise
inside `stepUpMeters` is a ledge it steps onto; anything steeper than the slope
limit is a wall that stops it. The probe has a floor rather than being purely
velocity scaled, because a stopped machine that probes zero metres reads clear
ground and creeps into a cliff face.

**The body is never snapped to the camera.** Where the player looks is an
intent. The body turns toward it at `turnRate * turnFactor` and no faster, so a
machine at a run swings wide and a planted one comes round quickly. The heading
lag is on the panel, in degrees.

**Three rigs, one state.** Exploration, combat and cockpit differ only in
geometry, and every rig is expressed as a multiple of the machine's own height,
so a 68 m frame and an 82 m frame are both framed correctly with no per-machine
camera table. Switching rigs preserves heading intent, pitch, target lock,
comfort and the input buffer: the eye moves and nothing else does.

**Comfort is a first-class setting.** Shake scale, reduced motion, field of view
offset, invert look and sensitivity. Reduced motion removes sway, roll and the
speed-driven pull-back; the framing that communicates scale stays.

**Scale is shown, not asserted.** `jaegerView` puts eight-metre street lights
along the machine's path, aircraft and birds crossing at altitude, footstep
decals that stay on the ground behind it, dust sized by how hard a foot landed,
and sound that arrives late from far away at 343 m/s. The panel reports how many
of each are drawn.

**Buffered input.** A press is queued with a window and expires on its own. The
buffer takes the oldest press the caller says is legal, so the same queue serves
locomotion now and combat later, and a press made while the machine was knocked
down expires unused rather than firing when it stands up.

**Nothing new is saved.** A piloted machine is a live session, not a record: the
world position it drives to is already saved through `WorldState`, and the
roster machine it uses is already saved by the Shatterdome. No migration was
needed.

## Combat

Four modules in `src/combat/`, none of which import Babylon or the DOM, plus one
view and one panel section that read what they produce.

**An attack is a row, not a function.** `data/moves.ts` gives every move its
startup, active and recovery lengths in ticks, a movement curve, how much turn
authority survives it, its armour level, which tags it cancels into and when,
which volumes are live on which ticks, one damage packet, and what it costs in
stamina and heat. Adding an attack is a row. Nothing in the resolver knows a
move by name.

**Damage is a typed packet, never a string in an animation.** Amount, kind,
poise, guard damage, knockback, component shock and the reaction it asks for.
The validator refuses an attack with no volume, a cancel window that opens
before the move can land, a volume that outlives its own active frames, and a
packet that does no damage.

**Hits are swept, not sampled.** A limb crosses twenty metres in five ticks, so
each volume is placed where it was at the start of the tick and where it is at
the end, and the closest approach over that movement decides the hit. Both ends
are interpolated, so a creature walking into a stationary fist is the same
problem as a fist reaching a standing creature. Every attack instance carries an
overlap history, so a volume connects with a target once however long it stays
live.

**A creature is body zones.** Head, torso, core, two limbs and a tail, each with
its own health, armour, damage multiplier and consequence. Exactly one zone ends
the creature, which the validator enforces: none makes it immortal, two makes
"what killed it" unanswerable.

**Targeting has four levels of deliberateness.** Soft targeting picks what the
player already faces. An explicit lock holds one creature and survives a camera
change. Cycling walks left to right across what is on screen rather than by
distance. Aim mode picks a body zone, and an aimed zone wins a hit when the blow
reached it, which is the only way "go for the core" means anything against
something eighty metres tall.

**Reactions are a shared table.** Flinch, stagger, guard break, launch, wall
impact, knockdown and component shock, each with a length, whether control is
lost, what it does to poise and whether it opens a finisher. A machine and a
creature stagger through the same code.

**Poise gates staggers.** Explicit knockdowns and launches belong to slow,
expensive moves and ignore poise; everything else has to spend it. Without that
rule a machine that could keep throwing heavies held a creature in a stagger for
the whole fight and the creature never acted once, which the scenario found
immediately.

**Buffered input is the same buffer locomotion uses.** The arena asks it for the
oldest press that is legal right now, so an input made a fifth of a second early
still fires and one made while the fighter was knocked down expires unused.

**Everything that happens is an event with enough detail to explain itself**:
tick, actor, target, move, volume, zone, damage, reaction, contact point and, for
a refusal, the reason in words. That log is the debug view rather than a drawing
of one.

**Nothing new is saved.** A fight is live state. Damage that outlives a battle
belongs to the per-component damage milestone, and inventing a save format for
it now would be guessing at that milestone's schema.

## Melee, defence and grapples

Three modules joined the combat folder, and the arena grew to run them. Nothing
here is a parallel system: a dodge, a block, a seize and a finisher are all rows
in the same move table the jab is in, resolved by the same arena, and reported
through the same event log.

**A dodge does not erase weight.** Its invulnerable frames sit in the middle of
the move rather than at the front, it costs stamina, it has a recovery, and it
only cancels out of moves that list an evade. A heavy attack does not, which is
the rule that stops the dodge becoming a free exit from every commitment.

**Timing is graded and explained in words.** Early, late, blocked, perfect and
parried are five different outcomes with five different consequences, and each
carries a coaching line written for a player: "Guard as the hit lands to take
nothing at all." Nothing in the interface mentions a tick, a frame or a window.

**A perfect answer opens the attacker.** A perfect guard or a parry ends the
attacker's move on the spot and leaves them open for about two thirds of a
second; a parry also answers with a free counter, which steps outside the cancel
rules because the whole point is that it is guaranteed.

**A grapple is a negotiation.** Eligibility is checked before the hold, not
after: out of reach, already held, on the ground, too heavy, or not enough room
each refuse with their own sentence. Once held, a struggle meter fills from the
victim's effort and empties from the holder's grip, the hold times out on its
own, and being held means being unable to swing.

**Space is checked before anything is thrown.** A throw that would put a body
through a tower fails safely and becomes a release; a slam needs something solid
behind the victim and stops short of it. A refused slam leaves the hold intact
rather than costing the player their whole commitment.

**Environmental weapons are one move and a table of props.** `env.swing.prop`
works with anything in hand; what changes is the prop's mass, reach, damage
scale, startup penalty and how many connections it survives. A prop that adds
damage without adding startup is refused at registration.

**A finisher is a short state machine, not a cutscene.** Beats carry a camera
framing and whether the input must be held. Damage is banked beat by beat, so an
interruption or a release keeps what was earned and loses the rest. It is rare by
construction: the target must be nearly finished and either reeling or held.

**Placement safety is an injected query.** `SpaceQuery` answers whether a body
fits, whether a point is in the loaded world, and how deep the water is.
Finishers, dodges, throws and grapple clearance all go through it, so nothing can
put an actor inside a building, in water too deep to fight in, or outside the
sectors that are actually streamed in.

**Accessibility is part of the system rather than a setting bolted on.** Reduced
camera motion flattens every finisher framing to one wide shot, hold-to-complete
turns repeated presses into a held input, and skipping sequences applies the
whole outcome at once. All three produce the same damage.

## Ranged weapons

Two modules join `src/combat/`, and the arena grew a weapon side that reuses
everything the melee side already had.

**A weapon is a row, not a class.** `data/weapons.ts` holds seven weapons across
eight behaviours, and the behaviour decides how a shot resolves rather than which
code runs: a beam and a cone resolve on the tick they are fired, a projectile, a
salvo, a mortar and an arc put bodies in the pool, a tether applies a status that
holds, and a channel keeps paying for itself every tick until it is released.
There is no switch on a weapon id anywhere.

**Firing is never free, and that is enforced at registration.** A weapon that
costs no ammunition, no heat and no reactor draw is refused when the registry is
built, so permanent damage per second cannot be written by accident. Everything
else is refused at the moment of firing, in a sentence: past its reach, too close
for indirect fire, not in its forward arc, no lock where one is needed, empty,
reloading, still cooling.

**Rounds live in a fixed pool that never grows.** `combat/projectiles.ts` allocates
its slots once at the quality preset's ceiling. A shot that would exceed it is
refused and reported rather than allocating under fire or quietly thinning. Each
round is swept from where it was to where it is against the same geometry a fist
is swept against, so a fast shell cannot pass through a target between two ticks.

**Nothing is simulated outside the fight.** A round is retired the moment it
leaves a 2,400 m bubble, runs out of range, hits the ground, or reaches a hard
twelve second lifetime. Clearing a target empties the pool.

**Status effects are a table on the combat clock.** Burning, shocked, bleeding,
corroded and tethered each say what they do per tick, what they do to movement
and output, and how they end. Water puts out anything that burns or corrodes,
which is the one place the environment reaches directly into a fight.

**Choosing a weapon is a pure function.** `scoreWeapon` turns a situation and a
weapon's own numbers into one score and one sentence, so an AI, a coaching hint
and a test all reach the same answer without knowing any weapon by name.

**The renderer reads the pool and owns none of it.** Live rounds are drawn as
thin instances on a single pooled mesh sized at the preset's ceiling, so a
barrage costs one draw call and cannot exceed what the simulation allows to
exist.

**Events are drained rather than collected from steps.** A trigger is pulled
between two ticks, so anything a step returned would have missed every shot,
reload and refusal. The arena keeps a drain cursor and the panel reads that.

## Deployment and the mission lifecycle

**One object covers the whole sortie.** `missions/mission.ts` holds planning, the
carrier run, the active phase and the results. There is no second game state:
the active phase is the world the player was already standing in, with a mission
attached to it, reached through the same teleport, ground view and pilot path
the map has always used.

**The planner reads live state and refuses in sentences.** Readiness is built
from the machine's real damage, the pair's real drift, the carrier's real lift
against what is loaded, the region's real weather and the flight time from where
the player actually is. Refusals stop a launch; warnings do not. Preparedness is
part of readiness, so going out with nothing aboard scores badly rather than
well.

**A warning never leaks the truth.** Predicted threat is taken from the
director's forecast at its own confidence, so a weak signal says it is a weak
signal instead of naming what is really out there.

**Objectives are rows with their own rules.** Eight of them - defend, intercept,
pursue, rescue, contain, escort, research, salvage - each scoring one plain
progress object built from authoritative events. A multi-stage crisis is a list
with stage numbers, and a stage that settles opens the next in the same
evaluation.

**Results reconcile by construction.** The only path into a mission is `report`,
fed from the arena, the roster and the city. Nothing is awarded that the
simulation did not do, completing twice returns the same object rather than
paying twice, and every line of the result carries the reason it exists.

**Every ending is a real ending.** Success, partial, failure, abort and lost
contact all produce the same shape of explained result, and an abort keeps
whatever the sortie had already achieved.

## The attack director

**The war is strategic state, not a scene.** `world/director.ts` holds global
escalation, breach pressure, a threat and defence rating per region, cooldowns,
what the player has been doing, and every live incident. It creates no meshes,
no arenas and no views: two overlapping emergencies are two records.

**An incident is a plan, never an outcome.** It carries an origin, an approach
path, a composition of creatures with the mutations they arrived with, a
mutation budget, a warning confidence, target priorities, an arrival tick and
secondary objectives. What happens when it lands is decided when it lands.

**Mutations are the difficulty curve, and they are visible.** `data/mutations.ts`
is a registry with a cost, an effect and an exclusion list per entry. The
director is handed a budget from escalation and pressure and spends it, so a
harder attack is a creature carrying more rather than a creature with hidden
numbers. Every mutation also carries a tell, which is what a warning is allowed
to say about it.

**It refuses far more often than it fires.** Rolls happen on a fixed cadence
rather than every tick, the chance is well under one even at full pressure,
every region has a long cooldown after being chosen, anywhere recently hit is
weighted down, there is a hard ceiling on simultaneous incidents, and every
resolution opens a recovery window. Nonstop alerts are noise, not difficulty.

**Resolution is a transparent model.** Kaiju strength, regional defences, any
machine on station and civilian density are each a ledger line with a reason,
and the seeded stream only moves the margin. The same inputs always produce the
same outcome, and the player can read every number that produced it.

**The player has a dial.** Crisis frequency scales the roll chance, the ceiling
on simultaneous incidents and the recovery window, bounded so it can never be
turned off entirely or into a firehose.

**One clock.** Time from simulation ticks and time skipped on the panel both go
through the same call, because six hours passing is six hours of war whichever
way the six hours happened.

## The kaiju framework

**A creature is a body, a family, a set of senses and a set of weights.** None of
those is a name. `data/kaiju.ts` carries the body zones, armour plates, special
organs, severable appendages, resistances, environmental preferences and phases;
`data/locomotionFamilies.ts` carries the nine ways of getting around; the
behaviour engine reads weights and traits. **Nothing in the engine switches on a
creature id**, which is the rule that lets a serpent and a burrower share one
code path and still fight nothing alike.

**Senses produce beliefs, not truth.** `kaiju/senses.ts` runs seven channels -
sight, sound, vibration, scent, threat, objective and damage memory - each with
its own range, arc, decay, and its own answer to cover and water. What comes out
is a contact: where something was, how sure the creature is, and which sense
said so, with a seeded error that grows as confidence falls. Everything
downstream acts on contacts, so a creature can be wrong, can lose something, and
can remember being hit by something it never saw.

**Goals are rows with a score and an explanation.** `kaiju/behavior.ts` holds
eleven: hunt, approach, flank, ambush, climb, burrow, swim, destroy-objective,
feed, retreat and enrage. Each scores a plain situation object purely, the
highest weighted score wins, and a switching margin stops a creature dithering
between two goals a point apart. Every goal also returns a sentence saying why,
which is what the debug view shows.

**Navigation is fallback rules, not a path finder.** `kaiju/navigation.ts` tries
the straight line, then whatever this family does about an obstacle: go under,
go over, go through, take to the water, or work around it in eight steps, and
says plainly when nothing it can do gets it through. Two things the engine
refuses to assume: the ground is flat, and everything can turn in place. Slope
and step-up are checked against the family's own limits, and a family with no
turn-in-place rate has to travel to change heading.

**The creature is where it all meets.** `kaiju/creature.ts` senses, decides,
moves, and carries the body: armour that comes off before the zone under it is
honest work, organs that grant abilities and take them away when destroyed,
appendages that can be severed for a real cost, resistances per damage kind, and
phases that change how hard it hits and how fast it moves as it is worn down.

**The arena stays authoritative.** The creature decides what to press; the arena
decides what happens. In a live fight the creature drives itself in place of the
fixed attack cadence that stood in for behaviour until now.

## City destruction

**A block is the unit of damage.** The layout already buckets every building
into a destruction group on a 480 m grid, and `world/destruction.ts` gives each
one integrity, structures down, fire, contamination, rubble in the road and
people still trapped. Nothing smaller is ever simulated: no wall panel is a
body, and no building is a rigid assembly.

**Seven states, and only three of them come from damage.** Intact, damaged and
breached are read from integrity. Collapsing, ruined, cleared and rebuilding are
stages a block is moved through by time and work. `data/buildings.ts` holds the
archetypes: what a structure is made of, how it comes apart, how long it burns,
how much rubble it leaves, and what clearing and rebuilding it cost.

**Two clocks.** Seconds move a collapse through to rubble and let a fire spread
while you are standing there. Hours burn fires out, pull people out, and put
crew hours into projects. Both arrive from outside: the module owns no timer.

**Rubble is pooled and frozen.** `world/debris.ts` allocates its chunks once at
the quality preset's ceiling. A collapse asks for at most two dozen, gets what
is free, and the shortfall is reported. Each chunk flies ballistically, freezes
the moment it settles, and is recycled by age when something newer comes down.
A frozen chunk costs one transform and nothing else.

**Damage is regional, and the summary is what survives.** The detailed model
lives with the active city; leaving writes a summary onto the region's strategic
record: a handful of numbers per damaged block, a state per named landmark, and
any running projects. A levelled city saves in single-digit kilobytes and **no
scene graph is ever written**. Walking back in rebuilds the detailed model from
that summary and applies the hours that passed while nobody was there.

**Rebuilding is a project, not a timer.** Crews clear before they rebuild, worst
block first. Rate is modified by the facilities actually built in the
Shatterdome, by how secure the region is, and by funding; an unpaid rebuild
stalls and says how short it is rather than finishing for free.

**The renderer reads the states and owns none of them.** `cityView` redraws only
the blocks whose state changed, from the tower data it was built with, and draws
live rubble as thin instances on one pooled mesh.

## Localized damage, scars and repair

**A machine is a set of components, not a health bar.** `data/components.ts`
holds eight: Conn-Pod, sensor mast, torso, reactor, two arms and two legs. Each
carries its share of the machine's structure, its own armour, its own placement
on the body, which damage kinds it fears, which systems it takes down when it is
lost, and which weapon mounts it carries. The shares must divide exactly one
machine and at least one component must be critical, both checked when the
registry is built.

**The arena fights components.** `jaegerZones` builds one zone per component and
`jaegerLayout` places them, so a machine goes through the same swept-volume hit
detection a creature does and a blow lands on the arm it hit rather than on "the
machine". Health comes from the machine's damage record, so it walks into a
fight carrying what it walked out of the last one with.

**Damage kinds are routed by the component.** A neural weapon is worth three
times as much against a Conn-Pod as against a leg; a piercing round is worth more
against a reactor. Neither the weapon nor the component knows about the other:
the multiplier is a field on the component and the kind is a field on the packet.

**Losing a component costs something specific.** A destroyed arm silences the
weapons mounted on it, with the refusal in words. A destroyed leg halves the
speed and turns a walk home into a tow. A destroyed Conn-Pod or reactor ends the
sortie. What is offline is derived from component health every time it is asked,
never stored, so it cannot drift out of step.

**Scars are four numbers.** Which component, how bad, what kind, and a seed. The
view grows the debris from the seed, so a machine looks the same every time it
loads without a single debris transform being saved. The list is bounded at
twenty-four and keeps the worst rather than the newest.

**A machine that loses is never deleted.** `jaegers/roster.ts` holds one record
per machine with its status, its damage and the work it owes. Coming home is a
function of the damage itself: unmarked machines are ready, a machine that can
still walk goes into the gantries, and one that lost a leg or a critical
component is towed and then rebuilt. Hours of work go in and structure comes
back, worst component first, and a component that comes back whole loses its
marks with the plate they were on.

**The saved record is compact.** One fraction per component and the scar list,
nothing else. Maximum health comes from the machine's own definition on load
rather than from the file, so rebalancing a chassis does not leave old saves
carrying old numbers, and a component this build has never heard of is dropped
rather than resurrected.

## The complex: construction, capacity and what a facility is worth

Three modules, and the split is the point.

`src/data/facilities.ts` is the grammar: fifteen branches, and every tier now
carries what it costs to build, what it costs to keep, what it is worth as named
effects, how many module slots it opens, what must already be standing before it
can start, and what the room looks like when it is done.

`src/shatterdome/construction.ts` is the queue. Projects are queued with a
priority, worked in that order by whatever crews are free, and every one can be
paused, reprioritised or cancelled. Crews are handed out fresh every tick against
the current priorities, which is what makes reprioritising take effect on the
next tick rather than after the current job finishes. Cancelling refunds the work
not yet done at a fixed rate, so it is a real cost rather than a free undo, and
nothing anywhere creates pressure to spend money to skip a wait.

`src/shatterdome/facilityEffects.ts` is the one place a tier turns into a number
anything else reads. Repair speed, construction speed, training, recovery,
research yield, contract funding, delivery speed, containment yield and coastal
defence: a fixed vocabulary, and the registry refuses a tier that promises
anything outside it. `roster.work` is multiplied by the repair effect at the
call site, which is what makes an upgraded bay genuinely repair faster rather
than merely say so.

**Shortfalls degrade rather than stop.** Power and staffing produce two factors
between zero and one. Construction multiplies its tick by them, and a facility's
effect keeps its base and loses part of the upgrade in proportion. A complex at
half power and a third staffed builds at sixty percent and says so in a sentence;
only a complete loss of power stops work, and that also says so. There is no path
where being short does nothing visible.

**Prerequisites cannot brick a save.** A test walks the whole graph from an empty
complex and asserts every facility is reachable at every tier, so no combination
of choices can strand a room behind a requirement that can never be met.

**Visible stages** are carried on the room the layout produces: lighting, signage,
cranes, deliveries and the number of builders on site. A room being worked on
shows work lights, a stencil, an extra crane, pallets on the floor and crews; a
finished tier shows what its stage variant says. Nothing authoritative reads any
of it.

## Allies: squads, orders and utility behaviour

An ally is an ordinary arena fighter with its own zones, its own combat profile
and its own damage. There is no ally-only combat path: what makes one an ally is
that a controller presses the same arena calls the player's input does.

`src/data/allyCrews.ts` is who the other crews are: confidence, preferred range,
aggression, support tendency, rivalries, a standing lean on the goal table, and a
perk track they learn by flying. `src/data/squadOrders.ts` is what they can be
told, as weights on that same goal table plus a few hard constraints.

`src/allies/allyBehavior.ts` is the decision, and it is the creature behaviour
tree's shape applied to a machine: every goal scores itself from the situation
and the crew, the highest wins with hysteresis so nothing dithers, and adding a
goal is a row. Three multipliers and nothing else touch the number: the goal's
own desire, the crew's lean, and the standing order. A surprising decision is
always explained by reading three values.

**An order is not a script.** It multiplies goal scores; it never sets the
answer. What "defend this area" means is worked out by the ally from where it is
standing and what is trying to kill it. The few things an order does impose are
constraints rather than weights, because an order that scoring can argue its way
around is not an order: a minimum range, an ammunition floor, a leash, and
whether the signature is held.

`src/allies/allyController.ts` turns a decision into an intent: somewhere to be,
something to hit, whether to fire, whether to guard. Intents are pure, which is
what makes "two allies do not both burn a signature on the same swing" a test
rather than an observation. `resolveSquadIntents` resolves the whole squad in one
pass so zone claims and spacing are decided against what the others are doing
this tick rather than last tick.

Three rules are hard rather than scored, because getting them wrong is worse than
any amount of tactical stupidity: never fire through a friendly, never spend a
signature twice, and never fire below an ordered ammunition floor.

`src/allies/squad.ts` is the state between and during deployments: who flies
what, formation assessment with refusals and warnings, standing orders, and what
each crew has learned. It mirrors the roster and the crew, including the guard
against one mission result being applied twice.

## The crew: drift, links, perks and injury

The player's avatar has no statistics and never will. Everything that makes one
sortie different from another comes from the two people in the Conn-Pod, which
is where the character building lives.

`src/data/pilots.ts` is who somebody is: specialisms, stability, skill,
preferred chassis roles, compatibility tags, a drawback with a structured
trigger, a signature perk with ranks, injury resistance and a dialogue profile.
`src/pilots/crew.ts` is how they are: status, recent stress, injuries carried,
one link track per pair, and the ids of sorties already paid out. It is the
roster's shape applied to people, deliberately, and like the roster it holds no
Babylon object, no DOM node and no wall clock.

**Drift** is one function, `assessDrift(first, second, context)`. Context is
entirely optional, so the two-argument call every earlier milestone makes still
answers exactly what it used to. What it adds is everything outside the two
people: what the machine is and what state it is in, the weather, the length of
the approach, the link level, recent stress and carried injuries. It returns the
strength, the effectiveness, every factor that moved the number, and both
pilots' drawbacks with whether each is biting.

**Drawbacks** are evaluated from a table of one function per trigger kind rather
than a switch, so adding a trigger is a row plus a union variant. Every drawback
is reported whether or not it fires, and the planner shows all of them before
launch: a drawback the player only learns about from the result is a trap.

**Perks** produce named effects from a fixed vocabulary. The five machine axes
reach the fight through the same `MachineGrowth` object that levels, passives and
modules use, as `crewBonus`; the other three, salvage, samples and repair hours,
belong to the sortie's own ledger. `poise` was added to growth for this: levels
never move it, and a pair who brace before an exchange do.

**Links** grow only from things the player did: a sortie flown together, a clean
result, drift training, and a conversation off duty. The cheap sources are capped
per day, so a relationship is built rather than farmed. A link belongs to the
pair and is written to both records in one call, so the two can never disagree.

**Injuries** are nonlethal by construction. The worst outcome in the table is
three weeks of recovery, and most of them leave somebody able to fly badly rather
than unable to fly, which is what makes an injury a decision. Treatment shortens
a recovery and can never remove it. The draw is seeded from the mission id and
the pilot, so a reload cannot reroll who got hurt.

## Progression: levels, passives, modules and prestige

`src/jaegers/progression.ts` is pure arithmetic over plain numbers. No RNG, no
clock, no registries, which is what lets a forecast shown to the player and the
value actually applied come from the same call.

Everything it produces is one `MachineGrowth`: multipliers for structure,
damage, heat and mobility, plus how many module slots are open. That object is
applied at the three places a machine's numbers are already derived, so there is
no second stat system anywhere:

- `combatProfileFor(jaeger, growth)` scales heat dissipation, poise and guard;
- `jaegerZones(jaeger, damage, components, growth)` scales component health,
  raising the ceiling rather than healing what is already broken;
- `scaleLocomotion(profile, growth.mobility)` scales walk, run and turn rates
  only, never height, stride, step-up reach or slope limit, because a level
  cannot make a machine taller.

A fighter also carries `damageScale`, applied where a packet becomes damage, so
a levelled machine hits harder through the same path a stock one does. Every one
of these defaults to no change, so a caller that knows nothing about levels gets
exactly the numbers it always got.

**Experience** is one running total per machine, and the level is derived from it
rather than stored beside it, so the two cannot disagree. It enters through
`roster.award()` and nowhere else, fed by `MissionResults.experience` and by
mastery ranks, both from the single mission report path.

**Passives** (`src/data/passives.ts`) are permanent choices, one per tier at
levels 4, 10, 18 and 26. The validator refuses any passive below tier four that
does not give something up, so a passive is a decision rather than a reward.
Respec is all or nothing and costs bay hours.

**Modules** (`src/data/modules.ts`) are physical and reversible. Slots open at
levels 6, 14, 22 and 30, plus one for having prestiged and one more at rank 10.
The validator refuses a module with no downside unless it requires prestige, so
nothing can be bought past a machine that earned its rank. Removing one puts it
in stores rather than destroying it.

**Prestige** resets the level and gives a permanent rank. The multiplier is
`1 + A * rank / (rank + H)` with `A = 0.6` and `H = 12`: worth about five percent
at rank one, forty at rank ten, and never reaching sixty however far it is
climbed. That asymptote is what makes an uncapped ladder safe, and it is chosen
by working backwards from the worst case: a level thirty machine at infinite rank
carrying the best passive and module in the game stays under three times stock.

Two consequences fall out of the same curve. **Catch-up** gives a newly acquired
machine half the fleet's best rank, which is worth over ninety percent of it
because the curve is asymptotic. And **difficulty** is fed the fleet's strength
through `director.setFleetStrength()`, which raises the mutation budget only: a
veteran fleet meets creatures carrying more, never creatures with quietly larger
health bars.

## The economy: yards, contracts and ownership

Three modules, and none of them knows about the others' internals.

`data/manufacturers.ts` is the yard table: four builders, each with a home
region, what it is good at, a base standing, a lead time, a price multiplier, how
often it sells refurbished hulls, how many offers it can have on one board, and
the contract terms it insists on. `priceFor` and `leadTimeFor` turn standing into
a price and a wait, and neither can reach zero: a well liked yard is quicker and
cheaper, never instant and never free.

`data/jaegers.ts` carries what a chassis costs rather than only what it can do:
list price, upkeep per day, mark generation, provenance, role, the acquisition
paths that can put it on the pad, its upgrade tracks, and performance as four
low-to-high bands with a written tradeoff. `validateJaeger` refuses a row with an
unknown yard, an inverted band, a duplicate upgrade track, or a track with no
steps in it, so a broken machine cannot reach a board.

`world/market.ts` is the board. Offers are derived from the rotation number and
the world seed through a named stream, so `offers()` is a pure function of state
rather than a roll: asking twice gives the same board, and so does loading the
save on another machine. `preview()` answers with bands, a tradeoff, the terms
and the upkeep, never with a single power score. `purchase()` deducts once,
records the offer as taken, and puts the machine on order; nothing is owned until
its lead time runs out, which is the difference between buying and spawning.
`unlock()` is the door for everything that is not bought: a milestone, a research
programme, a rebuilt wreck or an archive.

Ownership lives in the roster, which now holds instances rather than chassis
rows. Each record has its own id, a yard serial that is never reused, a name the
crew can change, how it was acquired, its damage, and a service history. Two
machines built from the same chassis are two records, and `roster.definition()`
resolves either one back to the chassis so nothing downstream has to care.

One clock drives both halves. `settleMarket()` reads the world clock's absolute
day number and settles the difference: upkeep for the days that passed, and any
delivery whose lead time ran out. Because it is driven by an absolute day rather
than by elapsed ticks, every path that moves time forward, including the skip
buttons, charges exactly once and cannot double-charge or miss a delivery.

The board is reached at the Contracts Office terminal, which means the office has
to be built first. There is no menu entry for it, the same way there is no menu
entry for repairing a machine.

## Research: samples, programmes and countermeasures

Four modules, none of which Babylon or the DOM can see.

`src/data/research.ts` is the tree: twenty three nodes across nine branches, each
with prerequisites, named sample requirements, a facility and tier, researchers,
ticks, a visible experiment, and benefits. A benefit is a **capability**, never a
scalar: `telegraph`, `status-resist`, `tracking`, `weak-point`, `equipment`,
`chassis`, `facility`. There is deliberately no benefit kind that scales damage,
and the validator refuses a node that hands nothing over or asks for more than
four of any sample.

`src/data/samples.ts` is what comes off a creature, and the condition that yields
it. Because each sample declares its own trigger, the award rules are derived
from the data rather than written twice, and a test can prove that nothing the
tree calls for is impossible to obtain.

`src/research/sampleAwards.ts` turns a `FightRecord` into awards through an
ordered table of conditions, one per trigger. The **familiarity curve** lives
here: a kaiju category yields a given sample in full the first time and a
fraction of it the tenth, decaying towards a floor rather than to zero. That is
the whole anti-grind mechanism, and it is one pure function.

`src/research/program.ts` is the authoritative state. It is deliberately shaped
like `ConstructionQueue`: the same problem of limited people and several wanted
things at once, so the same answers. Researchers are handed out fresh every tick
against current priorities, a short-handed experiment runs slower rather than
stopping, and samples and money are taken when an experiment starts rather than
when it finishes, which makes cancelling a decision with a cost.

`src/research/countermeasures.ts` composes everything finished into one
`CountermeasureProfile`. This is the same pattern as `MachineGrowth` and the
facility effects object: a benefit reaches the simulation through a value the
simulation already reads. `CombatArena` takes the profile as an injected option
with a neutral default, applies `resistedDuration` where it already places a
status, and exposes `telegraphs()` built on the startup window moves have always
had. Nothing in combat knows that research exists. Benefits are never stored in a
save; they are recomputed from the completed list, so rebalancing reaches an old
save immediately.

`src/research/manufacture.ts` holds the recipes for the two chassis nobody sells.
It is pure: it reports what a build would take and why it cannot happen, and the
caller does the taking through the economy that owns balances and the roster that
owns machines.

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
