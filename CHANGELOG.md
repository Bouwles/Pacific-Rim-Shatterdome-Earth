# Changelog

## 2026-08-20, Milestone 02: asset manifest and procedural placeholder factory

Built the asset pipeline. The game ships with no model files and is fully renderable anyway, and installing a real model later is a data change with no code change.

- Typed asset manifests in `src/assets/manifest.ts`. Each one carries the production model path, a mandatory procedural fallback, material slots, animation tags, named sockets, a collision proxy, audio and portrait slots, a nominal height, a seed, and provenance with an explicit licence. Plain data with no Babylon or DOM types, so it validates headlessly and can move to JSON later.
- Eight parameterised generators in `src/assets/generators.ts` covering all seven asset classes: biped, quadruped, serpentine, block building, wheeled vehicle, hull ship, prop and Shatterdome module. Two Jaegers and a bipedal kaiju all come from the same biped generator with different numbers, so adding a unit means adding a data row rather than writing another mesh factory.
- Named sockets: head, chest, back, reactor, hand and forearm left and right, both feet, and muzzle. Gameplay attaches to a socket name, never to a mesh, which is what lets a model swap leave combat code alone.
- Model validation in `src/assets/inspection.ts`. Checks height against the manifest within ten percent, forward axis, origin at the base, every socket node present, every animation tag resolvable, failed textures, and triangle, material and texture memory against per class budgets. Wrong scale or a missing node is an error. Going over budget is a warning, because it costs performance rather than correctness.
- Resolver in `src/assets/resolver.ts` tries the production model first and falls back to the generator on any failure, logging one warning per asset that names the asset, the path, the generator that took over, and where to put the file. It warns once per asset rather than once per attempt, so a render loop cannot flood the console.
- Asset gallery reachable from the main menu. Loads all twelve placeholders side by side, measures each from its built geometry rather than repeating what the manifest claimed, and reports budget status. Includes a turntable, a damage preview, and a manifest selector that can swap palettes or point at an uninstalled model to exercise the fallback path by hand.
- Manifest overrides can only reach source, fallback generator, materials and portrait. Collision, sockets, nominal height, animation tags and asset class are unreachable by type, so a presentation swap cannot change gameplay even by accident.
- `public/assets/models/` is the documented drop point, with a README covering the install steps and every rule the validator enforces.

Two defects were caught by the project's own validator and fixed rather than suppressed: the serpentine kaiju floated 3.29 metres above its origin, and the civilian car broke a vehicle material budget that was itself too tight at two slots for a body, glass and tyres.

Two more were caught by looking at the screen. The placeholders rendered nearly black under the boot scene's single directional light, and most of the row floated past the 60 metre boot ground. The gallery now owns a fill light and a deck sized to the row. The damage preview also detached parts in alphabetical order at first, which dropped the torso while the arms floated in place; it now ranks parts by distance from the silhouette centre, so extremities come off first and it stays generic across every generator.

Tests went from 84 to 120 unit and integration tests, and from 10 to 19 browser tests. Everything from the previous milestones still passes unchanged.

## 2026-08-20, Milestone 01: deterministic simulation kernel and developer diagnostics

Added the simulation kernel that everything later plugs into. It has no reference to Babylon or the DOM, so it runs the same in a browser frame, a worker or a headless test.

- Simulation kernel in `src/simulation/kernel.ts`. One tick drains the command queue, applies each command, runs systems, then advances the tick counter. Owns entities, RNG streams and the event bus, and can serialize, restore and hash its own state.
- Simulation loop in `src/simulation/loop.ts`. Turns render deltas into fixed ticks and adds pause, resume, single step and 0.25x to 2x time scale. Clamps incoming deltas to 250ms on top of the existing substep cap so a tab that was suspended for minutes cannot queue thousands of catch up ticks.
- Versioned, serializable commands and events. Dispatch is a registry lookup on command type, never a switch. Commands are validated when queued so a bad one is blamed on the code that sent it rather than showing up later as corrupt state. The event bus queues on emit and dispatches on drain, so a listener can never mutate state in the middle of a tick.
- State hashing in `src/simulation/hash.ts`. Two lane FNV-1a over a canonical encoding that sorts keys and hashes numbers as raw float bytes. This is the signal that catches any loss of determinism.
- Named RNG streams added to `src/simulation/rng.ts`. Each subsystem draws from its own stream derived from the master seed, so heavy use in one system cannot shift another system's sequence.
- Entity system in `src/entities/entity.ts`. Ids are monotonic and never reused, because recycling them lets a stale reference silently point at a different entity. Components are validated on write and stored as copies.
- Deterministic scenario runner in `src/debug/scenarioRunner.ts` with a fixture called kernel-smoke: seed 20260819, 120 ticks, RNG driven spawns and a mid run despawn. Two runs that hash differently mean determinism broke.
- Debug overlay moved from `engine/diagnosticsPanel.ts` to `src/debug/overlay.ts` and extended with frame time, simulation tick, entity count, physics bodies, seed and run state, plus working pause, step and time scale controls and an F3 toggle. The old element id was kept so the previous milestone's browser tests still pass unchanged.
- Seed configuration in `src/app/config.ts`. Fixed default, overridable with `?seed=` in the URL.
- Physics bodies in the overlay read "n/a (no backend)" instead of 0, because no physics engine is wired yet and a zero would imply one was.

Tests went from 21 to 84 unit and integration tests, and from 4 to 10 browser tests. Everything from the previous milestone still passes without modification.

Verified by hand on the WebGPU path, since the browser tests only exercise WebGL: pause held the tick steady, step advanced exactly one tick and did not resume, slow motion ran 12 ticks per second against 46 at normal speed, and a 4 second main thread stall advanced about 25 ticks instead of the 240 an unguarded loop would have queued. An accessibility problem found during that pass, an unnamed time scale select, was fixed.

Added `docs/CONTROLS.md`. Updated the architecture, content schema and performance budget docs.

## 2026-08-19, Milestone 00: core architecture and first real frame

- Application state machine in `src/app/appState.ts` covering eight states with a data driven transition graph.
- Engine bootstrap rebuilt as an adapter in `src/engine/engineAdapter.ts`. Picks WebGPU when available and falls back to WebGL, handles resize and context loss, and disposes cleanly.
- Boot scene and a live diagnostics readout showing renderer, version, framerate and draw calls.
- Fixed step simulation clock and seeded RNG.
- Typed content registry with a placeholder Jaeger as its first entry.
- Honest DOM screens for the main menu, loading, the Shatterdome placeholder and errors. The Shatterdome screen says it is not implemented rather than pretending otherwise.
- Tooling: ESLint, Prettier, Vitest and Playwright, with 21 unit and integration tests and 4 browser tests.
- Fixed a real floating point bug in the fixed step clock, where an exact multiple delta such as three sixtieths of a second could lose a step to rounding.

## 2026-08-19, project bootstrap

- Created the specification, roadmap, implementation state, decision log, content registry, testing and changelog documents.
- Scaffolded the Vite, TypeScript and Babylon.js project.
- First engine bootstrap with WebGPU and a WebGL fallback, rendering a placeholder scene.
