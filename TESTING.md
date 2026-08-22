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

332 unit and integration tests across 29 files, plus 49 Playwright browser tests.

- **Unit** (`tests/unit/`):
  - `clock` — deterministic step counts, epsilon-safe exact-multiple deltas, substep clamp, invalid config rejected.
  - `rng` / `rngStreams` — determinism, range, distinct seeds diverge; named streams reproduce, stay mutually independent (500 draws on one stream do not shift another), reject empty names and non-finite seeds.
  - `hash` — stability, key-order independence, sensitivity to any value change, array order, type disambiguation, `-0`/`0` equivalence, actionable path in errors for undefined/non-serializable input.
  - `entity` — spawn/despawn lifecycle, ids never reused, components deep-copied on write, validation failures, iteration skips dead and component-less entities, snapshot round-trip, id-ordered serialization, schema-version and consistency rejections.
  - `events` — buffered emit/drain, per-type delivery, unsubscribe, handler re-entrancy deferred to the next drain (drain terminates), dispose clears queue and subscriptions.
  - `loop` — pause/resume, single-step is exactly one tick and not sticky, slow motion and fast forward, time-scale validation, and four catch-up-safety tests (huge delta capped, no backlog on the next frame, bounded across repeated suspensions, negative deltas ignored).
  - `registry`, `jaegers` — unchanged from Milestone 00.
  - `terrainNoise` — same seed and point gives the same value regardless of how many samples came before it, seeds separate, negative lattice coordinates behave, value noise stays inside 0 to 1, the field is continuous across integer lattice boundaries, fBm normalises for any octave count, a zero octave count is rejected.
  - `terrain` — cache key covers every input that changes the bytes; identical content for the same key whatever is generated in between; a different seed differs; **shared edges between neighbouring sectors match exactly, not approximately**; grid resolution and collision presence follow level of detail; cost falls at every coarser level; every populated region is above water and on its authored climate; the ocean region is fully water with nothing built on it; city cells appear only near a populated anchor; detail thins with level of detail and stops at the far ring; collision sampling interpolates and clamps at the edges; malformed requests and a non-finite anchor mask target are rejected by name.
  - `terrainProtocol` — worker messages validate in both directions, a version mismatch is rejected with the expected version named, unknown types and non-integer ids are refused; the inline service generates, honours a cancel issued in the same turn, rejects work issued after disposal, and distinguishes a cancellation from a real failure.
  - `sectorStreaming` — the eight states are named and ordered; a sector walks queued to generating to cpu-ready to active; the whole ring set loads with the right level of detail per ring and the outer ring asleep; sectors out of range are released while their data stays cached; turning around reuses the cache with identical digests; an in-flight request for a sector the player has left is cancelled and cannot resurrect it; a generation failure is counted and leaves nothing stuck; travel direction and a declared deployment target reorder the queue; concurrency and upload caps hold; the memory budget evicts without ever dropping the ground underfoot; a boundary wobble is rescued rather than rebuilt; ground height is only reported where collision data is resident; dispose releases everything and is safe twice. Plus the data cache: LRU eviction by bytes, promotion on read, and a rejected nonsensical budget.
- **Integration** (`tests/integration/`):
  - `appState` — unchanged from Milestone 00.
  - `sectorStreaming` (Milestone 05) — route samples follow great circles at constant speed and report turns; a route it cannot fly is rejected; the full stress route runs with a leak-checking sink that asserts every upload is released exactly once; memory holds steady across three laps; the second lap of a route regenerates nothing; two streamers on the same seed produce identical digests and different seeds differ; ground height stays available underfoot for a whole route; a deliberately tiny memory budget evicts rather than refusing to load.
  - `sectorRenderer` (Milestone 05) — geometry carries a skirt and per-vertex colour; a sector root lands at the sector centre in the current anchor frame; a rebase moves roots and leaves vertex buffers untouched, matching `rebaseLocal` exactly; city cells are thin instances; an empty ocean sector builds no city, traffic or landmark meshes; meshes are recycled instead of reallocated across load cycles; sleeping disables rather than destroys; unknown sector ids are tolerated; **disposal returns the scene to its exact original mesh, material, node and light counts**; re-uploading replaces rather than orphans; a disposed renderer accepts nothing.
  - `kernel` — command boundary (queued not immediate, unknown type, schema-version mismatch, field-level payload errors, idempotent despawn, spawn/despawn events), determinism (same seed+commands ⇒ same hash; different seed ⇒ different hash; different commands ⇒ different hash; hash advances with motion; step grouping does not affect result), and snapshot round-trip (identical hash, deterministic continuation after restore, seed/schema mismatch rejected).
  - `scenarioRunner` — repeated runs of `kernel-smoke` hash identically; entity count reflects the mid-run despawn; hash changes on seed change and on command change; scenario validation rejects out-of-range scheduling and non-positive tick counts.
- **Unit, assets** (`tests/unit/assetManifest.test.ts`, `assetInspection.test.ts`): manifest validation (fallback generator required, unknown and duplicate sockets, malformed colours, out of range material values, duplicate animation tags, provenance required, registry rejects rather than stores), override containment, shipped manifests cover every class and ship no third party content; inspection validation (wrong unit, tolerated drift, wrong forward axis, offset origin, missing socket node, missing clip, failed textures, budget overruns warn rather than error, class-specific budgets).
- **Integration, assets** (`tests/integration/assetResolver.test.ts`): fallback on a missing model with one actionable warning, one warning per asset however many instances, loud failure on an unknown generator or invalid params, every shipped placeholder resolving within 10 percent of its declared height with no errors and inside its triangle budget, every declared socket present, the cannon's muzzle, reproducibility from seed, one generator producing differently proportioned units, scene node and material counts returning to baseline after disposal and after ten resolve/dispose cycles, and the simulation hash staying identical under every manifest override including the failing-model path.
- **Unit, saves** (`tests/unit/saveSchema.test.ts`, `saveMigrations.test.ts`): envelope validation (wrong version, malformed metadata, unsupported sim version, malformed entity table, non-serializable values, cycles), checksum stability, slot naming, summary projection; version detection, the version 0 fixture migrating with no data loss and metadata derived rather than invented, purity and non-mutation, refusal of newer-than-supported files and of missing steps, registry rejection of malformed steps.
- **Integration, saves** (`tests/integration/saveService.test.ts`, `indexedDbRepository.test.ts`): the full slot lifecycle, kernel round-trip with identical hash and deterministic continuation, seed mismatch refusal, authoritative-only contents, autosave ring rotation, corruption recovery through several damaged layers, damaged slots staying listed so recovery is reachable, export and import including legacy migration and rejection paths leaving existing slots intact, backup rotation before overwrite and before import, and storage health reporting. The IndexedDB suite runs the same flows against a real IndexedDB implementation, including surviving a close and reopen.
- **Unit, world** (`tests/unit/coordinates.test.ts`, `cubeSphere.test.ts`, `floatingOrigin.test.ts`): geodetic/ECEF and tangent round trips bounded under a micrometre across the active bubble and under 0.1 mm at 70 km, axis orientation, date line and pole handling, scaled distances, longitude wrapping and latitude clamping, validation; sector id round trips and malformed id rejection, sector centres landing back in their own sector, four distinct neighbours for all 1,536 sectors, symmetry everywhere including cube corners, spatial adjacency, full globe reachability by walking neighbours, and sector size uniformity within 1.5x; floating origin threshold behaviour, exact rebasing of a bystander, local coordinates staying bounded across a 60 km walk, and forced rebase on teleport.
- **Integration, world** (`tests/integration/worldState.test.ts`): teleporting to all five named locations recovering region and climate, distinct sectors, sector change detection, unknown region rejection, exactly one active region at a time, no active region in open ocean, regions dropping back to strategic on leaving, non-overlapping region footprints, strategic damage without activation, snapshot round trips, gaining regions added since a save was written, snapshot validation rejecting unknown regions, malformed sectors and two active regions, plus a full save and load cycle and a version 1 save migrating to the documented start.
- **Browser smoke** (`tests/e2e/`, Playwright/Chromium):
  - `boot.spec.ts` (Milestone 00, still passing unchanged): truthful backend label, zero console errors, New Game flow, reload does not duplicate canvas/render loop, resize keeps one canvas.
  - `debugOverlay.spec.ts`: all overlay fields report real values and physics reads "n/a (no backend)"; ticks advance on their own; pause halts ticks, Step advances exactly one and does not resume, Resume continues; slow motion advances more slowly than 1×; F3 toggles visibility; `?seed=` drives the seed.
  - `saves.spec.ts`: the panel opens on real IndexedDB and reports where saves go; separate slots persist; a save survives a full page reload; slot detail records seed, tick and play time; rename, overwrite, load, delete; export produces a downloadable file; that file imports back as a separate slot; an invalid import is refused with a readable message and leaves existing slots intact; a legacy bare snapshot imports by migrating; leaving the panel keeps the simulation running.
  - `worldMap.spec.ts`: globe and full coordinate readout with no console errors; exactly one active region; teleports to all five named locations recovering each climate and landing in five distinct sectors; walking crossing a sector boundary; the floating origin rebasing during a long walk while keeping local coordinates under 2,600 m; a teleport rebasing immediately so the player sits at the local origin; leaving the map with the simulation still running; and world position surviving a save and load round trip.
  - `assetGallery.spec.ts`: all twelve assets load with a budget summary and no console errors; measurements come from geometry; selecting another asset reframes and updates every figure; sockets including the cannon's muzzle are exposed; the damage preview is reversible; rotation can be paused; swapping to an uninstalled model falls back visibly and warns once; an alternate palette leaves measurements identical; leaving the gallery returns to the menu with the simulation still running.

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

### Phase 1.75 / Milestone 02 (2026-08-20)

- All automated checks green: `typecheck`, `lint`, `format:check`, `test` (120/120), `smoke` (19/19), `build`.
- Manual browser verification via Chrome DevTools MCP on the WebGPU path:
  - Gallery loads all twelve assets in a row, summary reads "12 assets loaded, all within budget".
  - Selected asset panel shows measured values: 75.00 m height, 26.10 x 14.02 m extent, 192/150,000 triangles, 3/8 materials, all ten biped sockets, "within budget, no issues".
  - Damage preview at 85 percent scorched the asset and detached its head, feet and forearms while the torso and legs remained, then returned to pristine at 0.
  - Rotate toggle stops and starts the turntable.
  - Switching the manifest to the uninstalled production model kept all twelve assets rendering and produced exactly twelve warnings, one per asset, each naming the asset, the missing path, the generator that took over, and where to place the file. No repeats and no errors.
  - Alternate palette changed colours while height and triangle count stayed identical.
  - Leaving the gallery restored the menu, left one canvas, and the simulation kept ticking.
  - Zero console errors throughout.
- Two defects were found by the project's own validator during this milestone and fixed rather than
  suppressed: the serpentine kaiju floated 3.29 m above its origin, and the civilian car exceeded a vehicle
  material budget that was itself too tight.
- Two presentation defects were found by looking at the screen rather than by any test: the placeholders
  rendered nearly black under the boot scene's single directional light, and most of the row floated past
  the 60 m boot ground. The gallery now owns a fill light and a deck sized to the row.

### Phase 1.9 / Milestone 03 (2026-08-21)

- All automated checks green: `typecheck`, `lint`, `format:check`, `test` (193/193), `smoke` (32/32), `build`.
- Manual browser verification via Chrome DevTools MCP on the WebGPU path:
  - Save panel opens against real IndexedDB and reports live figures: `indexeddb · 0 stored records · 1.0 KB of 10240.0 MB`.
  - The storage warning shown is the honest one for this browser: Chrome has not granted persistent storage, so the panel says saves may be evicted and to export anything worth keeping.
  - Created a save, let the simulation advance, then overwrote it, confirming the backup held the older tick (1732) while the live record held the newer one (1878).
  - **Corruption recovery, end to end against real storage:** opened the live database from the console and replaced the primary record with a structurally broken one, leaving the backup intact. The slot stayed listed, flagged damaged, described from the backup. Loading it reported `Loaded "Recovery test" (recovered from backup.slot.mt2i5e2x.0)`.
  - Thumbnails verified by decoding the stored image and sampling pixels: average brightness 155 across 42 distinct colours, against 0 brightness and 1 colour before the render-target fix.
  - Zero console errors throughout.
- Two defects were found by manual verification and fixed rather than documented around:
  - Damaged slots were hidden from the listing, which made recovery unreachable from the UI. They are now listed, flagged, and described from the backup that would load.
  - Thumbnails were solid black under WebGPU because the swap chain is not a readable 2D source after a frame ends. Capturing inside the render loop was tried first and measured still blank; the fix is a render target.
- **Not verified by hand:** a genuine quota-exceeded write, and IndexedDB being blocked in a real private window. Both paths are implemented and unit tested through the repository interface, but neither was reproduced in a live browser.

### Phase 1.95 / Milestone 04 (2026-08-21)

- All automated checks green: `typecheck`, `lint`, `format:check`, `test` (253/253), `smoke` (40/40), `build`.
- Manual browser verification via Chrome DevTools MCP on the WebGPU path:
  - Globe renders with region markers, a player marker, and the active sector plus its four neighbours drawn as a cross, which is the 4-neighbour adjacency visible on screen.
  - Teleported to all five named locations. Each recovered exact coordinates (Anchorage correctly reads 149.9003 W), the right climate, and a distinct sector. The five land across three different cube faces (+Z, -X, +Y), so cross-face addressing is exercised rather than assumed.
  - Every teleport reported "1 active, 7 strategic" and left local coordinates at 0.0 m / 0.0 m, confirming the origin rebases on a deliberate jump.
  - Walked 25 km north in 1 km steps: crossed three sequential sectors (+Z/3/12 to 13 to 14), latitude strictly monotonic with no discontinuity at any boundary, local coordinates capped at exactly 2,000 m rather than climbing to 25,000, 28 rebases, and the region correctly fell to "0 active, 8 strategic" on leaving Hong Kong for open water.
  - Draw calls held at 15 across the whole walk, confirming sector tiles and their materials do not accumulate.
  - Zero console errors and warnings throughout.
- Four defects were found by tests or by looking at the screen, and fixed rather than documented around:
  - Rebasing by subtracting the anchor shift drifted 2.9 m over a 4 km rebase, because two tangent planes on a sphere differ by a rotation. Caught by a unit test; `rebaseLocal` now goes through the global position and is exact.
  - A plain cube-sphere left corner sectors 2.31x larger than face-centre ones. A tangent adjustment brought the spread to 1.35x.
  - Region radii sized like real metropolitan areas overlapped once the globe was scaled to 1/50, leaving the active region ambiguous for four city pairs. Radii now mean the dense combat core.
  - Walking in a flat tangent plane lifted the player 239 m off a curved globe over 25 km. Movement now carries geodetic altitude.
- **Not verified:** shadow stability under a moving Jaeger, because no Jaeger exists in the world view yet; only the mechanism that prevents jitter (local coordinates bounded at 2,000 m) is confirmed. Physics behaviour across a rebase is likewise unverified, since no physics backend is wired.

## Performance budgets

See [docs/PERFORMANCE_BUDGETS.md](docs/PERFORMANCE_BUDGETS.md). No Low/Medium/High/Cinematic presets exist yet; only a live fps/draw-call readout. Required before Phase 4 (world streaming) makes performance budgeting load-bearing.

## Browser compatibility checks

Manually verified in one Chromium-based browser via Chrome DevTools MCP (WebGPU path), plus Playwright's bundled Chromium for the automated smoke suite (that instance also exercised the code path honestly — see IMPLEMENTATION_STATE.md for whether it happened to land on WebGPU or WebGL). No Firefox/Safari verification yet.

## Known failures

None currently open.

## Milestone 05 acceptance evidence

Measured on WebGPU at seed 20260822, not inferred.

| Acceptance item                                    | Evidence                                                                                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flying rapidly does not freeze the main thread     | 24.0 s of the stress route advanced 1,443 simulation ticks, exactly 60 per second, at 144 fps with a worst frame of 0.3 ms                           |
| Flying rapidly does not leak sectors               | Resident peaked at 49 and never higher; the leak-checking sink asserts every uploaded sector is released exactly once, and disposal leaves zero live |
| Turning around reuses cache data                   | Laps two and three of the full route generated zero new sectors; cache hits went 253, 709, 1,165                                                     |
| Identical sectors are not regenerated differently  | Content digests are asserted equal for the same key, across streamers, and after a return trip                                                       |
| Stable memory after repeated load and evict cycles | Resident 0.16 MB, cached 1.26 MB in 252 entries, scene 108 meshes and 0.50 MB GPU, byte identical across three laps                                  |
| Terrain generation is off the render loop          | The panel reports `worker`; the browser test asserts it rather than accepting the inline fallback                                                    |
| Meshes are not kept alive for cached data          | Evicting frees meshes and keeps data; asserted in both unit and integration tests                                                                    |
