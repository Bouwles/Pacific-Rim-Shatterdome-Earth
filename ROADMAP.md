# ROADMAP.md

Read [GAME_SPEC.md](GAME_SPEC.md) before changing anything here. Status values: `done`, `in-progress`, `blocked`, `not-started`.

## Phase 0 — Project bootstrap and render pipeline smoke test

**Depends on:** nothing.
**Status:** done.
**Acceptance tests:**

- `npm install` succeeds with no manual credential setup.
- `npm run dev` serves the app; browser shows a rendered 3D scene (placeholder ground + rotating box) with no console errors.
- `npm run typecheck` passes.
- `npm run build` produces a `dist/` bundle.
- Engine picks WebGPU when available, falls back to WebGL otherwise, without crashing either path.
  **Next action:** none — complete. Proceed to Phase 1.

## Phase 1 / Milestone 00 — Core architecture skeleton + truthful first frame

**Depends on:** Phase 0.
**Status:** done.
**Scope:** state machine (Boot/MainMenu/Loading/Shatterdome/Deployment/Combat/Results/Error), engine
adapter (WebGPU-first/WebGL-fallback, resize, context-lost/restored, disposal), fixed-step simulation
clock, seeded RNG, data-registry pattern with a placeholder Jaeger entry, diagnostics panel, DOM screens
for MainMenu/Loading/Shatterdome-stub/Error, ESLint + Prettier + Vitest + Playwright tooling. Created
`src/app/`, `src/engine/`, `src/simulation/`, `src/data/`, `src/ui/`, `tests/unit/`, `tests/integration/`,
`tests/e2e/`, `docs/` — each with real content, per the "grow-into" convention in TECH_DECISIONS.md.
**Acceptance tests:**

- Simulation runs on a fixed timestep independent of render framerate — proven by unit tests on
  `FixedStepClock` (deterministic step counts, epsilon-safe boundary handling, substep clamp).
- State machine transitions Boot → MainMenu → Loading → Shatterdome → MainMenu, all covered by an
  integration test on the full transition graph.
- A registry module (`ContentRegistry<T>`) loads a typed content table (placeholder Jaeger entry) with
  validation and no switch-on-name logic.
- Unit tests cover the fixed-step accumulator, RNG determinism, and registry lookup/validation.
- `npm run typecheck`, `lint`, `format:check`, `test`, `build`, `smoke` (Playwright) all pass.
- Manually verified in-browser: WebGPU path renders, diagnostics panel shows live backend/version/fps/draw
  calls, New Game → Shatterdome-stub → Back to Menu works, console stays clean.
  **Next action:** none — complete. Proceed to Phase 2.

## Phase 1.5 / Milestone 01 — Deterministic simulation kernel and developer diagnostics

**Depends on:** Phase 1 / Milestone 00.
**Status:** done.
**Scope:** fixed-step loop with transport controls, named RNG streams, versioned serializable
commands/events, entity identity + component registry, deterministic state hashing, headless scenario
runner, and a real debug overlay. Created `src/entities/`, `src/debug/`, `src/app/config.ts`; extended
`src/simulation/`; moved `engine/diagnosticsPanel.ts` → `debug/overlay.ts`.
**Acceptance tests:**

- Same seed + command sequence produces the same final state hash across repeated runs; different seed or
  different commands produces a different hash (integration tests on both the kernel and the scenario runner).
- Pause, single-step, slow motion, and resume all work from the debug panel — covered by Playwright and
  re-verified manually on the WebGPU path.
- A long inactive tab does not spiral: delta clamped to `MAX_FRAME_DELTA_MS` plus a sub-step cap. Measured a
  4-second stall advancing ~25 ticks rather than 240.
- Kernel state round-trips through serialize/restore with an identical hash and continues deterministically.
- `npm run typecheck`, `lint`, `format:check`, `test` (84), `smoke` (10), `build` all pass.
  **Next action:** none — complete. Proceed to Phase 2.

## Phase 1.75 / Milestone 02 — Asset manifest and procedural placeholder factory

**Depends on:** Milestone 01.
**Status:** done.
**Scope:** typed asset manifests with provenance and licensing, eight parameterised procedural generators
covering all seven asset classes, named attachment sockets, GLB validation against manifest and budget,
model-first resolution with a generator fallback, and an asset gallery for inspection. Created
`src/assets/`, `src/data/assets.ts`, `src/debug/gallery.ts`, `src/ui/galleryScreen.ts`,
`src/app/galleryOverrides.ts`, `public/assets/models/`.
**Acceptance tests:**

- A missing production model falls back to the placeholder and logs one actionable warning per asset,
  naming the path and the fix. Verified in tests and in the browser across all twelve assets.
- A manifest override swaps materials and source while collision, sockets, nominal height, animation tags
  and asset class stay byte-identical, and the simulation hash is unchanged.
- The gallery loads all twelve assets, measures each from its built geometry, and reports budget status.
- `npm run typecheck`, `lint`, `format:check`, `test` (120), `smoke` (19), `build` all pass.
  **Next action:** none — complete. Proceed to Phase 2.

## Phase 1.9 / Milestone 03 — Local save foundation, slots, autosaves, and migrations

**Depends on:** Milestone 01 (kernel snapshots), Milestone 02 (asset pipeline unaffected).
**Status:** done.
**Scope:** IndexedDB persistence behind a `SaveRepository` interface, versioned save envelope, pure
migration steps with an old-version fixture, manual saves, a rotating autosave ring, backup rotation that
doubles as the pre-migration backup, corruption recovery, export and import with validation, a storage
health panel, and user-facing errors. Created `src/saves/`, `src/ui/saveScreen.ts`,
`src/app/saveController.ts`, `tests/fixtures/saves/`.
**Acceptance tests:**

- Create, rename, overwrite, export, delete and import separate slots, all verified in tests and in the
  browser against real IndexedDB.
- A deliberately corrupted primary recovers from the newest valid backup, verified in unit tests, in
  integration tests over real IndexedDB, and by hand in the browser by wrecking a live record.
- Migration tests load the version 0 fixture into the current schema with every simulation field intact.
- `npm run typecheck`, `lint`, `format:check`, `test` (193), `smoke` (32), `build` all pass.
  **Next action:** none — complete. Proceed to Phase 2.

## Phase 1.95 / Milestone 04 — Seamless miniature Earth coordinate system

**Depends on:** Milestone 01 (kernel), Milestone 03 (saves).
**Status:** done.
**Scope:** scaled cube-sphere globe with stable sector ids and reprojection-based neighbour lookup,
geodetic global coordinates with local tangent frames, floating origin with exact rebasing, a low-detail
globe map with an active sector and full coordinate readouts, and a strategic-versus-active simulation
boundary. Created `src/world/`, `src/data/regions.ts`, `src/debug/globeView.ts`, `src/ui/worldScreen.ts`.
Raised the save envelope to version 2 with a real migration for the new world section.
**Acceptance tests:**

- Travel across several sector boundaries with the player stable: a 25 km walk crossed three sequential
  sectors, kept latitude strictly monotonic, and capped local coordinates at the 2,000 m rebase threshold
  instead of reaching 25,000 m.
- Teleport among Hong Kong, Sydney, Tokyo, Anchorage and Manila and recover the correct region and climate,
  verified in tests and by hand. The five land in five distinct sectors across three cube faces.
- Round-trip conversion error between global and local bounded under a micrometre across the active bubble.
- `npm run typecheck`, `lint`, `format:check`, `test` (253), `smoke` (40), `build` all pass.
  **Next action:** none — complete. Proceed to Phase 2.

## Phase 1.97 / Milestone 05 - Sector streaming, procedural terrain, and world partition

**Depends on:** Milestone 04 (coordinates, sectors, floating origin).
**Status:** done.
**Scope:** asynchronous sector lifecycle across eight states, seeded procedural terrain with coast and
biome identity, LOD rings with thin instances and mesh pooling, cancellation tokens, memory budgets,
velocity and deployment-target priorities, generation moved into a typed worker, deterministic cache
keys, and full instrumentation. Created `src/workers/`, `src/world/terrain*.ts`,
`src/world/sectorStreaming.ts`, `src/engine/sectorRenderer.ts`, `src/data/biomes.ts`,
`src/debug/streamRoute.ts`. Added a ground view to the world screen.
**Acceptance tests:**

- Flying rapidly does not freeze the main thread or leak sectors: 24 s of the stress route advanced
  1,443 simulation ticks, that is a full 60 per second, at 144 fps with a worst frame of 0.3 ms.
  A leak-checking sink asserts every uploaded sector is released exactly once.
- Turning around reuses cache data and regenerates nothing: laps two and three of the route generated
  zero new sectors, with cache hits climbing 253, 709, 1,165 and identical content digests.
- Stable memory across repeated load and evict cycles: resident, cached and scene figures were byte
  identical across three laps, at 0.16 MB resident and 1.26 MB cached in 252 entries.
- `npm run typecheck`, `lint`, `format:check`, `test` (332), `smoke` (49), `build` all pass.
  **Next action:** none - complete. Proceed to Phase 2.

## Phase 1.98 / Milestone 06 - Day, weather, atmosphere, and ocean foundation

**Depends on:** Milestone 04 (coordinates), Milestone 05 (streamed terrain and collision heights).
**Status:** done.
**Scope:** tick-driven world clock with sun and moon, seeded weather fronts with smooth transitions,
rain, storms, fog, snow, wind, cloud, lightning, wetness and spray, ocean wave sampling with depth
zones and water states, buoyancy hooks, underwater fog and audio, an environment query surface for AI
and combat that imports no render code, and Low through Cinematic quality presets with explicit
budgets. Created `src/world/worldClock.ts`, `weather.ts`, `ocean.ts`, `environment.ts`,
`src/data/climates.ts`, `quality.ts`, `src/engine/skyView.ts`, `weatherView.ts`, `ambientAudio.ts`,
`src/debug/environmentScenario.ts`. Raised the save envelope to version 3 with a real migration.
**Acceptance tests:**

- Time and weather advance deterministically from debug controls and survive save and load: the debug
  scenario produces an identical digest across runs and a different one per seed, and a browser round
  trip restores the same in-game hour and the same front.
- Entering water transitions correctly: all five states were reached in the running game. Wading at
  Manila in 20.9 m of water at 28 percent submerged, surface combat on the shelf at 56.7 m and 76
  percent, swimming over 101.7 m of shelf, underwater at the Breach with visibility capped at 14 m,
  and dry on land.
- Low quality stays readable: every preset carries all four required telegraphs, asserted in a unit
  test and read off the panel in the browser at Low and at Cinematic. Live particles scale from 35 at
  Low to 1,519 at Cinematic on the same storm.
- `npm run typecheck`, `lint`, `format:check`, `test` (437), `smoke` (59), `build` all pass.
  **Next action:** none - complete. Proceed to Phase 2.

## Phase 1.99 / Milestone 07 - Hong Kong vertical slice and living city layer

**Depends on:** Milestone 05 (streamed terrain and collision heights), Milestone 06 (time, weather,
quality presets).
**Status:** done.
**Scope:** an original stylised Hong Kong built from a district grammar, with city blocks, landmark
slots, roads, harbour lanes, air corridors, evacuation zones, defence positions, destruction groups
and two deployment routes; civilian, shipping, aircraft and military activity that responds to time,
weather, alert level, evacuation, damage and recovery; pooled agent instances rather than AI
civilians; and alert state saved per region. Created `src/data/districts.ts`,
`src/world/cityLayout.ts`, `src/world/cityActivity.ts`, `src/engine/cityView.ts`,
`src/debug/cityScenario.ts`. Raised the save envelope to version 4 with a real migration.
**Acceptance tests:**

- Recognisable by silhouette and activity: 710 blocks and 1,480 towers across seven districts, with
  downtown asserted to be the tallest and the slums asserted to stack more, smaller towers. Fourteen
  landmark slots, each naming the asset manifest id it will host.
- An alert changes the city: at Hong Kong on Medium, going from calm to attack took civilians from
  26 percent to 4, shipping from 31 to 2, military from 15 to 100, sounded the sirens, and started
  the evacuation. The agent pool rebalanced from 107 vehicle and 45 crowd to 196 vehicle and 7 crowd.
- Within budgets on Medium: 620 towers in 31 of 135 destruction groups, 53 city meshes, 0.09 MB, 74
  draw calls, 1.0 ms frames at 143 fps.
- `npm run typecheck`, `lint`, `format:check`, `test` (511), `smoke` (68), `build` all pass.
  **Next action:** none - complete. Proceed to Phase 2.

## Phase 2 - Shatterdome walkable hub (vertical slice)

**Depends on:** Phase 1.
**Status:** not-started.
**Scope:** on-foot player controller, one explorable Shatterdome interior area (command + Jaeger bay placeholder rooms), DOM-based management UI shell, save-game create/load against IndexedDB.
**Acceptance tests:** player can walk the hub, open a management panel, save and reload state, all offline.
**Next action:** the on-foot player controller and the first real Shatterdome interior, which is the first
consumer of the `shatterdome.jaeger-bay` asset and the point where an entity is bound to a manifest.
Persistence already exists (Milestone 03), the streamed ground gives a controller real terrain and a real
height field to walk on (Milestone 05), and the environment already supplies the traction, movement and
water-state multipliers a controller has to obey (Milestone 06). The controller consumes those rather than
inventing its own.

## Phase 3 — Single Jaeger + single kaiju combat vertical slice

**Depends on:** Phase 2.
**Status:** not-started.
**Scope:** one playable Jaeger with light/heavy melee, block, evade, cockpit/third-person camera switch; one kaiju with a basic attack pattern and per-component damage; hit stop, damage numbers optional, component-based damage model.
**Acceptance tests:** a full scripted encounter can be won or lost; damage persists to the Jaeger's save record after battle.
**Next action:** not started.

## Phase 4 — World map and attack director MVP

**Depends on:** Phase 3.
**Status:** not-started.
**Scope:** streamed sector map with floating origin, 2–3 regions (start with Hong Kong + one more), deployment flow from map alert to battle, seeded attack director scheduling.
**Next action:** not started.

## Phase 5 — Economy, research, roster expansion

**Depends on:** Phase 4.
**Status:** not-started.
**Next action:** not started.

## Phase 6 — Copilots, squads, allied AI commands

**Depends on:** Phase 3, Phase 5.
**Status:** not-started.
**Next action:** not started.

## Phase 7 — Prestige, custom Jaeger assembly, deep progression curves

**Depends on:** Phase 5.
**Status:** not-started.
**Next action:** not started.

## Phase 8 — Sandbox mode, co-op networking adapter, crossover content

**Depends on:** Phase 4, Phase 6.
**Status:** not-started.
**Next action:** not started.

## Phase 9 — Full world coverage, presentation polish, performance budgets

**Depends on:** all prior phases.
**Status:** not-started.
**Next action:** not started.
