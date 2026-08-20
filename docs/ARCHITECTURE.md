# ARCHITECTURE.md

Describes what actually exists in code as of Milestone 01. Read alongside [../GAME_SPEC.md](../GAME_SPEC.md) (the binding contract — this file explains _how_ the contract is met, never overrides it) and [../TECH_DECISIONS.md](../TECH_DECISIONS.md) (why each choice was made).

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
  data/
    registry.ts         generic ContentRegistry<T> — typed table + validator + duplicate/unknown-id guards
    jaegers.ts           JaegerDefinition type + one placeholder entry proving the registry pattern
  debug/
    overlay.ts          DOM readout + transport controls (pause / step / time scale), F3 toggle
    scenarioRunner.ts    headless deterministic scenario runner + `kernel-smoke` fixture
  ui/
    screens.ts           DOM overlay renderers for MainMenu, Loading, Shatterdome placeholder, Error
tests/
  unit/                clock, rng, rngStreams, hash, entity, events, loop, registry, jaegers — pure logic
  integration/         appState, kernel, scenarioRunner — module boundaries and determinism
  e2e/                 boot.spec.ts, debugOverlay.spec.ts — Playwright: real browser, real transport controls
```

Everything else in the target shape (`world/`, `jaegers/`, `kaiju/`, `combat/`, `destruction/`,
`shatterdome/`, `missions/`, `progression/`, `copilots/`, `audio/`, `assets/`, `saves/`, `network/`,
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

Only `Boot -> MainMenu -> Loading -> Shatterdome -> MainMenu` is reachable today. `Deployment`, `Combat`,
and `Results` exist as valid graph nodes with legal edges so later milestones can wire real screens into
them without redesigning the graph, but nothing transitions into them yet — that would be a fake screen
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
