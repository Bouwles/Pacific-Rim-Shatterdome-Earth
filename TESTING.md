# TESTING.md

## Commands

- `npm install` — install dependencies (no external accounts/credentials required).
- `npm run dev` — Vite dev server at http://localhost:5173/.
- `npm run typecheck` — strict TypeScript check (`src/`, `tests/unit/`, `tests/integration/`), no emit.
- `npm run lint` — ESLint (flat config, typescript-eslint recommended).
- `npm run format` / `npm run format:check` — Prettier write / check.
- `npm run build` — typecheck + production bundle to `dist/`.
- `npm run preview` — serve the production build locally.
- `npm test` — Vitest unit + integration tests (`tests/unit/`, `tests/integration/`; `tests/e2e/` is excluded — that's Playwright's).
- `npm run smoke` — Playwright browser smoke tests (`tests/e2e/`). Auto-starts a dedicated dev server on port 5174.

## Automated tests

84 unit/integration tests across 12 files, plus 10 Playwright browser tests.

- **Unit** (`tests/unit/`):
  - `clock` — deterministic step counts, epsilon-safe exact-multiple deltas, substep clamp, invalid config rejected.
  - `rng` / `rngStreams` — determinism, range, distinct seeds diverge; named streams reproduce, stay mutually independent (500 draws on one stream do not shift another), reject empty names and non-finite seeds.
  - `hash` — stability, key-order independence, sensitivity to any value change, array order, type disambiguation, `-0`/`0` equivalence, actionable path in errors for undefined/non-serializable input.
  - `entity` — spawn/despawn lifecycle, ids never reused, components deep-copied on write, validation failures, iteration skips dead and component-less entities, snapshot round-trip, id-ordered serialization, schema-version and consistency rejections.
  - `events` — buffered emit/drain, per-type delivery, unsubscribe, handler re-entrancy deferred to the next drain (drain terminates), dispose clears queue and subscriptions.
  - `loop` — pause/resume, single-step is exactly one tick and not sticky, slow motion and fast forward, time-scale validation, and four catch-up-safety tests (huge delta capped, no backlog on the next frame, bounded across repeated suspensions, negative deltas ignored).
  - `registry`, `jaegers` — unchanged from Milestone 00.
- **Integration** (`tests/integration/`):
  - `appState` — unchanged from Milestone 00.
  - `kernel` — command boundary (queued not immediate, unknown type, schema-version mismatch, field-level payload errors, idempotent despawn, spawn/despawn events), determinism (same seed+commands ⇒ same hash; different seed ⇒ different hash; different commands ⇒ different hash; hash advances with motion; step grouping does not affect result), and snapshot round-trip (identical hash, deterministic continuation after restore, seed/schema mismatch rejected).
  - `scenarioRunner` — repeated runs of `kernel-smoke` hash identically; entity count reflects the mid-run despawn; hash changes on seed change and on command change; scenario validation rejects out-of-range scheduling and non-positive tick counts.
- **Browser smoke** (`tests/e2e/`, Playwright/Chromium):
  - `boot.spec.ts` (Milestone 00, still passing unchanged): truthful backend label, zero console errors, New Game flow, reload does not duplicate canvas/render loop, resize keeps one canvas.
  - `debugOverlay.spec.ts`: all overlay fields report real values and physics reads "n/a (no backend)"; ticks advance on their own; pause halts ticks, Step advances exactly one and does not resume, Resume continues; slow motion advances more slowly than 1×; F3 toggles visibility; `?seed=` drives the seed.

Every deterministic system added from here on (attack director seeding, damage math, prestige curves, save migrations) needs its own unit tests per GAME_SPEC's quality contract.

## Deterministic debug scenario

`kernel-smoke` (`src/debug/scenarioRunner.ts`): seed 20260819, 120 ticks, rng-scattered spawns at ticks 0 and 30, despawn at tick 60. Run it headlessly via `runScenario(kernelSmokeScenario)`; two runs returning different hashes means determinism regressed.

## Manual checks performed

### Phase 0 (2026-08-19)

- `npm install` — clean, 0 vulnerabilities. `npm run typecheck` / `npm run build` pass.
- `npm run dev` + browser via Chrome DevTools MCP: WebGPU path confirmed (`Babylon.js v7.54.3 - WebGPU1 engine`), scene rendered, no console errors after adding a data-URI favicon.

### Phase 1 / Milestone 00 (2026-08-19)

- All automated checks green: `typecheck`, `lint`, `format:check`, `test` (21/21), `build`, `smoke` (4/4 Playwright specs).
- Manual browser verification via Chrome DevTools MCP (separate from the Playwright suite):
  - Console clean (only Vite HMR debug logs + the expected Babylon boot log) at every step below.
  - Boot screenshot: sky-colored clear color, ground plane with shadow, tall reference-scale Jaeger placeholder box, MainMenu overlay (title/subtitle/New Game button) rendered over the live scene, diagnostics panel reading `renderer: WebGPU | Babylon 7.54.3 | 144 fps | 3 draw calls`.
  - Clicked New Game → Loading (one frame) → Shatterdome placeholder screen showing the honest "Not yet implemented" message and a working Back to Menu button; clicked it, returned to MainMenu.
  - Orbit camera control present (`ArcRotateCamera.attachControl`) — not separately screenshotted, code path shared with the exercised scene.
- **WebGL fallback path is verified for real**, not just wired: Playwright's bundled Chromium (headless "Chrome for Testing") does not support WebGPU, so every `npm run smoke` run naturally exercises the fallback branch — confirmed directly (`renderer: WebGL | Babylon 7.54.3 | 59 fps | 3 draw calls`). The manual Chrome DevTools MCP session separately confirmed the WebGPU branch. Both backend paths have now been observed rendering correctly.
- **Not manually forced:** GPU context loss (no practical way to trigger a real device/context loss from this environment). `onContextLostObservable`/`onContextRestoredObservable` are wired and unit-testable in isolation but not exercised end-to-end — flagged in IMPLEMENTATION_STATE.md as a risk to close out with a forced-loss test in a later milestone.

### Phase 1.5 / Milestone 01 (2026-08-20)

- All automated checks green: `typecheck`, `lint`, `format:check`, `test` (84/84), `smoke` (10/10), `build`.
- Manual browser verification via Chrome DevTools MCP on the **WebGPU** path (Playwright's Chromium only exercises WebGL, so the transport controls were re-verified by hand on the other backend):
  - Overlay reads `renderer: WebGPU | babylon 7.54.3 | fps 144 | frame 0.1 ms | draws 3 | sim tick <advancing> | entities 0 | physics n/a (no backend) | seed 20260819 | state running 1x`.
  - **Pause**: tick held at 832 across an 800 ms wait; state read "paused".
  - **Step**: 832 → 833 exactly, then held across a further 700 ms — one click is one tick, and it does not resume the simulation.
  - **Resume**: button relabels to "Pause", ticks advance again (46 ticks/sec at 1×).
  - **Slow motion**: 0.25× measured 12 ticks/sec against 46 ticks/sec at 1×.
  - **F3** toggles the overlay hidden/visible.
  - **Spiral-of-death guard**: blocking the main thread for 4 s (the same enormous resume delta a suspended tab produces) advanced ~25 ticks instead of the 240 an unguarded accumulator would queue. An earlier attempt to test this by backgrounding the tab was discarded — the tab never actually reported hidden (691 frames kept rendering), so it proved nothing.
  - Console clean apart from Vite HMR debug logs and the Babylon boot log. One accessibility issue surfaced during this pass (time-scale `<select>` had no name) and was fixed, then re-verified clean.
- **Not verified:** genuine tab suspension via the browser's own lifecycle freeze, and GPU context loss (both still unforceable from this environment). The main-thread stall exercises the identical code path the resume delta takes.

## Performance budgets

See [docs/PERFORMANCE_BUDGETS.md](docs/PERFORMANCE_BUDGETS.md). No Low/Medium/High/Cinematic presets exist yet; only a live fps/draw-call readout. Required before Phase 4 (world streaming) makes performance budgeting load-bearing.

## Browser compatibility checks

Manually verified in one Chromium-based browser via Chrome DevTools MCP (WebGPU path), plus Playwright's bundled Chromium for the automated smoke suite (that instance also exercised the code path honestly — see IMPLEMENTATION_STATE.md for whether it happened to land on WebGPU or WebGL). No Firefox/Safari verification yet.

## Known failures

None currently open.
