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
- **Asset pipeline** that starts procedural and accepts production models without touching gameplay code:
  - typed manifests with materials, animation tags, sockets, collision proxy, audio and portrait slots, provenance and licence;
  - eight parameterised generators covering all seven asset classes, so a new unit is a data row rather than a mesh factory;
  - named sockets (`head`, `chest`, `back`, `reactor`, `hand.L/R`, `forearm.L/R`, `foot.L/R`, `muzzle`);
  - validation of scale, forward axis, origin, socket nodes, animation clips, missing textures and per-class budgets;
  - model-first resolution with a procedural fallback and exactly one actionable warning per asset;
  - overrides that structurally cannot reach gameplay fields.
- Asset gallery (main menu, then Asset Gallery) loading all twelve placeholders side by side with measured dimensions, triangle and material counts against budget, socket lists, validation status, turntable, damage preview and manifest swapping.
- **Offline persistence** on IndexedDB behind a `SaveRepository` interface:
  - named slots with metadata (name, world seed, play time, last played, sim tick, app version, thumbnail);
  - manual save, rename, overwrite, delete, and a rotating three-slot autosave ring;
  - a backup ring per slot that doubles as the pre-migration backup;
  - corruption recovery that walks backups newest first, covering unreadable bytes, failed migrations, invalid documents and checksum mismatches;
  - export to a downloadable JSON file, and import that validates and migrates before touching a slot;
  - a versioned envelope with pure migration steps and a version 0 fixture proving an old file loads without data loss;
  - a storage health panel reporting backend, record count, usage and quota, warning about eviction, near-full storage, or a memory-only fallback;
  - an in-memory fallback so the game still runs when IndexedDB cannot be opened, stating plainly that saves will not survive the tab.
- **Seamless miniature Earth**: a scaled cube-sphere globe (1/50, 127 km radius) with authoritative geodetic positions and local tangent frames:
  - 1,536 stable sectors across six cube faces, 9.3 to 12.5 km across, with neighbour lookup by reprojection that is symmetric everywhere including cube corners;
  - a floating origin that keeps local coordinates under 2,000 m however far you travel, rebasing exactly rather than by shift subtraction;
  - a low-detail globe map with region markers, the active sector and its neighbours, and a full coordinate readout;
  - eight strategic regions including all five named test locations, with exactly one ever receiving combat-grade simulation;
  - teleport and walk controls, with world position carried through save and load.
- Tooling: `typecheck`, `lint`, `format`/`format:check`, `test` (253 unit+integration), `smoke` (40 Playwright), `build` all pass.

## What is stubbed / placeholder

- The Jaeger placeholder box and Shatterdome screen are labeled placeholders. Clicking through to "Shatterdome" says "Not yet implemented" rather than faking a system.
- Assets exist only in the gallery. Nothing in the boot scene or the simulation uses a manifest yet, and no entity is bound to an asset. The placeholder box in the boot scene is still the old hard-coded one from Milestone 00.
- Animation tags, audio slots and portrait slots are declared, validated and carried through the pipeline, but nothing plays animation, audio or portraits. There is no animation system and no audio system.
- The gallery's damage slider is a presentation preview, not the component damage model. It tints and detaches parts by distance from centre; it does not track armour, subsystems or persistence.
- Collision proxies are declared in manifests but unused, since no physics backend is wired.
- Saves persist the simulation kernel only, because that is all the authoritative state that exists. There is no economy, roster, research or Shatterdome state to save yet; those extend `RootSave` as they arrive.
- Loading a save whose world seed differs from the running session reports what to do (reload with `?seed=`) instead of switching worlds. Restoring across seeds needs a kernel rebuild, which belongs with the milestone that introduces a real new-game flow.
- Autosave rotation is implemented and tested but nothing triggers it automatically yet; no gameplay event exists that would warrant one.
- The world exists as coordinates, sectors and strategic records only. No terrain, no ocean surface, no cities, no streaming of actual geometry: the globe view draws a sphere with markers, and the "active sector" is a highlighted tile rather than loaded ground. Promoting a sector to combat-grade geometry is Phase 2 and beyond.
- Walking is a debug control that steps 1 km per click, not a player controller. There is no on-foot movement, no physics, and no Jaeger in the world view.
- Region climate is a static label. Nothing yet varies weather, time of day, or gameplay by climate.
- `Deployment`, `Combat`, `Results` app states are valid graph nodes with no screens; nothing transitions into them yet.
- The kernel runs with **zero entities in the main app** — entity count honestly reads 0. Spawn commands exist and are exercised by tests and the scenario runner, but no gameplay system issues them yet, and nothing in the 3D scene is bound to entity transforms. That binding arrives with the first real gameplay entity.
- Motion integration is the only system. It is real and used forever, but it is one system, not a physics step.
- No physics backend (Havok installed, not initialized) — the overlay reports "n/a (no backend)".
- No player controller, combat, kaiju behaviour, economy, research, copilots, networking adapter, or sandbox mode. None of it is faked; it does not exist yet.

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
- Asset pipeline: [src/assets/manifest.ts](src/assets/manifest.ts), [inspection.ts](src/assets/inspection.ts), [budgets.ts](src/assets/budgets.ts), [generators.ts](src/assets/generators.ts), [resolver.ts](src/assets/resolver.ts), [src/data/assets.ts](src/data/assets.ts)
- Asset gallery: [src/debug/gallery.ts](src/debug/gallery.ts), [src/ui/galleryScreen.ts](src/ui/galleryScreen.ts), [src/app/galleryOverrides.ts](src/app/galleryOverrides.ts)
- World: [src/world/coordinates.ts](src/world/coordinates.ts), [cubeSphere.ts](src/world/cubeSphere.ts), [floatingOrigin.ts](src/world/floatingOrigin.ts), [regions.ts](src/world/regions.ts), [worldState.ts](src/world/worldState.ts), [start.ts](src/world/start.ts), [src/data/regions.ts](src/data/regions.ts)
- World UI and view: [src/ui/worldScreen.ts](src/ui/worldScreen.ts), [src/debug/globeView.ts](src/debug/globeView.ts)
- Saves: [src/saves/schema.ts](src/saves/schema.ts), [migrations.ts](src/saves/migrations.ts), [repository.ts](src/saves/repository.ts), [indexedDbRepository.ts](src/saves/indexedDbRepository.ts), [saveService.ts](src/saves/saveService.ts), [storageHealth.ts](src/saves/storageHealth.ts)
- Save UI and browser glue: [src/ui/saveScreen.ts](src/ui/saveScreen.ts), [src/app/saveController.ts](src/app/saveController.ts)
- Model drop point: [public/assets/models/README.md](public/assets/models/README.md)
- DOM screens: [src/ui/screens.ts](src/ui/screens.ts)
- Tests: [tests/unit/](tests/unit/), [tests/integration/](tests/integration/), [tests/e2e/](tests/e2e/)
- Docs: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/CONTENT_SCHEMA.md](docs/CONTENT_SCHEMA.md), [docs/PERFORMANCE_BUDGETS.md](docs/PERFORMANCE_BUDGETS.md), [docs/CONTROLS.md](docs/CONTROLS.md)

## Active technical risks

- Bundle size / code-splitting still undecided — revisit once world streaming (Phase 4) is in scope.
- Floating-origin / large-world coordinates not implemented; required before Phase 4. The kernel's `Vec3` components are plain local floats today and will need a global-coordinate representation.
- Context-loss recovery wired but unverified end-to-end.
- WebGPU-vs-WebGL parity beyond this scene (post-process, GUI) unchecked.
- Entity iteration relies on Map insertion order being deterministic given deterministic commands. True today; if a future system iterates in a data-dependent order, canonical id sorting will be needed in `each()`, not just in `serialize()`.
- The GLB load path has never run against a real GLB file, because no model exists to test with. Its validation logic is unit tested against synthetic inspection data, and its failure path is exercised constantly, but the success path is unverified. First real model installed will be the real test of it.
- The gallery borrows the boot scene rather than owning one. Fine for two environments; a real scene lifecycle will be needed once the Shatterdome interior and a combat map both exist.
- Quota exhaustion and a genuinely blocked IndexedDB (real private window) are implemented and unit tested through the repository interface, but neither has been reproduced in a live browser.
- Shadow stability under a moving Jaeger is unverified, because no Jaeger exists in the world view. Only the mechanism that prevents jitter, local coordinates bounded at 2,000 m, is confirmed. Physics behaviour across a rebase is likewise unverified with no physics backend wired.
- `src/world/**` uses trigonometry, which the kernel is forbidden from doing. Cross-engine bit-identical replay would not survive world movement becoming authoritative; see TECH_DECISIONS.md for the mitigation path.
- Save documents are not encrypted or signed. The checksum detects accidental corruption and casual tampering, not deliberate editing; a player who wants to edit their own save can.

## Exact next task

Start Phase 2 (ROADMAP.md): the on-foot player controller and the first real Shatterdome interior. This is the first consumer of the `shatterdome.jaeger-bay` asset and the point where an entity is bound to an asset manifest. It is also the first milestone that needs a real scene lifecycle, since the hub, the globe and the boot scene are genuinely different environments.

The pieces it builds on all exist now: positions are geodetic and the Shatterdome sits at a known region centre, the floating origin keeps local coordinates small, and `RootSave` version 2 already carries world state. Extend `RootSave` for hub state rather than adding a parallel store, and put the player controller behind the same tangent-frame conversion the world screen already uses.
