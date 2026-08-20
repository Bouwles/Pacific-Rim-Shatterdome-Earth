# IMPLEMENTATION_STATE.md

Read this, [GAME_SPEC.md](GAME_SPEC.md), [ROADMAP.md](ROADMAP.md), and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before touching code.

## What currently works

- `npm install` → `npm run dev` boots a Vite dev server. WebGPU-first engine selection with a WebGL fallback, both paths observed rendering (WebGPU manually, WebGL via Playwright's Chromium).
- Application state machine with 8 states and a data-driven transition graph; reachable today: Boot → MainMenu → Loading → Shatterdome(stub) → MainMenu, plus Boot → Error on fatal boot failure.
- **Deterministic simulation kernel** running live in the app, independent of Babylon and the DOM:
  - fixed-step loop decoupled from render rate, with pause / resume / single-step / 0.25×–2× time scale;
  - catch-up capped two ways (250 ms delta clamp + 5-substep cap) so a suspended tab cannot spiral;
  - named RNG streams derived from one master seed, mutually independent;
  - versioned serializable commands and events, dispatched through registries rather than switches;
  - branded monotonic entity ids, never reused, with a component registry and deep-copy-on-write storage;
  - `serialize()` / `restore()` / `hash()` over authoritative state, with schema-version and seed guards.
- Headless deterministic scenario runner plus the `kernel-smoke` fixture (seed 20260819, 120 ticks).
- Debug overlay (F3) showing renderer, Babylon version, fps, frame time, draw calls, sim tick, entity count, physics bodies, seed, and run state, with working transport controls.
- `?seed=N` reproduces a run; `DEFAULT_SEED` is a fixed constant otherwise.
- Full disposal: resize listener, context-lost/restored observers, render loop, engine, overlay keydown listener + Babylon observer + instrumentation, kernel event bus and command queue, state-machine listeners — all released via `AppHandle.dispose()`, wired to Vite HMR.
- Tooling: `typecheck`, `lint`, `format`/`format:check`, `test` (84 unit+integration), `smoke` (10 Playwright), `build` all pass.

## What is stubbed / placeholder

- The Jaeger placeholder box and Shatterdome screen are labeled placeholders. Clicking through to "Shatterdome" says "Not yet implemented" rather than faking a system.
- `Deployment`, `Combat`, `Results` app states are valid graph nodes with no screens; nothing transitions into them yet.
- The kernel runs with **zero entities in the main app** — entity count honestly reads 0. Spawn commands exist and are exercised by tests and the scenario runner, but no gameplay system issues them yet, and nothing in the 3D scene is bound to entity transforms. That binding arrives with the first real gameplay entity.
- Motion integration is the only system. It is real and used forever, but it is one system, not a physics step.
- No physics backend (Havok installed, not initialized) — the overlay reports "n/a (no backend)".
- No player controller, world map, combat, economy, copilots, save persistence, networking adapter, or sandbox mode. None of it is faked; it does not exist yet.

## Known issues

- Production bundle still ships one >5 MB chunk (full Babylon core). Deferred — see TECH_DECISIONS.md.
- GPU context loss is wired but never exercised end-to-end; no way to force a real device loss here.
- Genuine tab-suspension freeze untested (the browser never actually reported the tab hidden under automation). The 4-second main-thread stall exercises the same resume-delta code path and stayed bounded.
- No Firefox/Safari verification — Chromium-family only.
- `hashState` is a 64-bit non-cryptographic digest. Fine as a divergence detector; not tamper-resistant, which matters if save integrity ever needs to resist editing.

## Key file paths

- Entry: [src/main.ts](src/main.ts) → [src/app/bootstrap.ts](src/app/bootstrap.ts) → [src/app/config.ts](src/app/config.ts)
- State machine: [src/app/appState.ts](src/app/appState.ts)
- Engine adapter / boot scene: [src/engine/engineAdapter.ts](src/engine/engineAdapter.ts), [src/engine/scene.ts](src/engine/scene.ts)
- Simulation kernel: [src/simulation/kernel.ts](src/simulation/kernel.ts), [loop.ts](src/simulation/loop.ts), [clock.ts](src/simulation/clock.ts), [commands.ts](src/simulation/commands.ts), [events.ts](src/simulation/events.ts), [rng.ts](src/simulation/rng.ts), [hash.ts](src/simulation/hash.ts)
- Entities: [src/entities/entity.ts](src/entities/entity.ts)
- Debug: [src/debug/overlay.ts](src/debug/overlay.ts), [src/debug/scenarioRunner.ts](src/debug/scenarioRunner.ts)
- Content registry: [src/data/registry.ts](src/data/registry.ts), [src/data/jaegers.ts](src/data/jaegers.ts)
- DOM screens: [src/ui/screens.ts](src/ui/screens.ts)
- Tests: [tests/unit/](tests/unit/), [tests/integration/](tests/integration/), [tests/e2e/](tests/e2e/)
- Docs: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/CONTENT_SCHEMA.md](docs/CONTENT_SCHEMA.md), [docs/PERFORMANCE_BUDGETS.md](docs/PERFORMANCE_BUDGETS.md), [docs/CONTROLS.md](docs/CONTROLS.md)

## Active technical risks

- Bundle size / code-splitting still undecided — revisit once world streaming (Phase 4) is in scope.
- Floating-origin / large-world coordinates not implemented; required before Phase 4. The kernel's `Vec3` components are plain local floats today and will need a global-coordinate representation.
- Context-loss recovery wired but unverified end-to-end.
- WebGPU-vs-WebGL parity beyond this scene (post-process, GUI) unchecked.
- Entity iteration relies on Map insertion order being deterministic given deterministic commands. True today; if a future system iterates in a data-dependent order, canonical id sorting will be needed in `each()`, not just in `serialize()`.

## Exact next task

Start Phase 2 (ROADMAP.md), beginning with `src/saves/`: IndexedDB persistence built on the kernel's existing `serialize()`/`restore()`/`hash()` — multiple slots, autosave, rotating backups, export/import, corruption recovery, and migration scaffolding against `SIM_SCHEMA_VERSION`. Then the on-foot player controller and the first real Shatterdome interior.
