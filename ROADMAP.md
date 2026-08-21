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

## Phase 2 — Shatterdome walkable hub (vertical slice)

**Depends on:** Phase 1.
**Status:** not-started.
**Scope:** on-foot player controller, one explorable Shatterdome interior area (command + Jaeger bay placeholder rooms), DOM-based management UI shell, save-game create/load against IndexedDB.
**Acceptance tests:** player can walk the hub, open a management panel, save and reload state, all offline.
**Next action:** the on-foot player controller and the first real Shatterdome interior, which is the first
consumer of the `shatterdome.jaeger-bay` asset and the point where an entity is bound to a manifest.
Persistence already exists (Milestone 03), so hub state can be saved as soon as there is any.

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
