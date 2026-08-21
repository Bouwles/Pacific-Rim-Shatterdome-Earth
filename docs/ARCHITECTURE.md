# ARCHITECTURE.md

Describes what actually exists in code as of Milestone 04. Read alongside [../GAME_SPEC.md](../GAME_SPEC.md) (the binding contract — this file explains _how_ the contract is met, never overrides it) and [../TECH_DECISIONS.md](../TECH_DECISIONS.md) (why each choice was made).

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
                        sky color, orbit/debug camera
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
  world/               ← globe coordinates and strategic layer; no Babylon, no DOM
    coordinates.ts      geodetic/ECEF/tangent conversions, distances, validation
    cubeSphere.ts       sector ids, addressing, tangent-adjusted projection, neighbours
    floatingOrigin.ts   anchor, rebase policy, exact rebaseLocal
    regions.ts          region and record types, climates, simulation tiers
    worldState.ts       authoritative world state, tiering, snapshots
    start.ts            default start position, shared by saves and migrations
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
    regions.ts           the shipped strategic regions
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
`shatterdome/`, `missions/`, `progression/`, `copilots/`, `audio/`, `network/`,
`sandbox/`, `workers/`) does not exist yet — see [ROADMAP.md](../ROADMAP.md) for which phase
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
