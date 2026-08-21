# TECH_DECISIONS.md

Dated architecture decisions and the reason for each. Newest first.

## 2026-08-19 — Vite + TypeScript + Babylon.js 7.x, WebGPU-first with WebGL fallback

**Decision:** Bootstrap with `@babylonjs/core`, `@babylonjs/gui`, `@babylonjs/loaders`, `@babylonjs/havok`, strict TypeScript, Vite 6 build tooling.
**Reason:** Mandated directly by GAME_SPEC.md's "Mandatory Technology Foundation" section. Babylon.js 7.x is the current stable line at implementation time and ships first-class `WebGPUEngine` with a documented fallback path to `Engine` (WebGL). `WebGPUEngine.IsSupportedAsync` is used at boot to choose the renderer so gameplay never depends on a specific backend.

## 2026-08-19 — `tsc --noEmit` instead of `tsc -b` (project references / composite build)

**Decision:** Typecheck and build scripts run a flat `tsc --noEmit` rather than TypeScript's project-reference build mode.
**Reason:** Project-reference build mode (`-b`) requires `composite`/multi-project wiring that has no purpose yet with a single `src/` tree. Plain `--noEmit` gives the same type-safety gate with zero extra config. Revisit only if the project splits into multiple independently-buildable packages (e.g. a separate Web Worker package).

## 2026-08-19 — No physics engine initialized yet despite `@babylonjs/havok` being installed

**Decision:** Install the Havok dependency now (so the package-lock is stable and future work doesn't require a fresh install), but do not call `initAsync`/enable the physics plugin in Phase 0.
**Reason:** GAME_SPEC requires physics to sit behind a dedicated abstraction so backends are swappable — that abstraction doesn't exist yet and shouldn't be designed under Phase 0's "render pipeline smoke test" scope. Wiring Havok now would be scaffolding built ahead of its consumer. Design the physics abstraction in the phase that first needs collisions (Phase 2/3).

## 2026-08-19 — Target `src/` directory shape (grow-into, not scaffold-ahead)

**Decision:** Adopt this as the target module layout, created incrementally as each milestone needs it — never as empty placeholder folders:

```
src/
  app/ engine/ simulation/ world/ entities/ jaegers/ kaiju/ combat/
  destruction/ shatterdome/ missions/ progression/ copilots/ ui/
  audio/ assets/ saves/ network/ sandbox/ debug/ data/ workers/
tests/
  unit/ integration/ e2e/ performance/
public/
  assets/ manifests/ audio/ icons/
docs/
  ARCHITECTURE.md CONTENT_SCHEMA.md PERFORMANCE_BUDGETS.md
```

**Reason:** User-specified target shape, explicitly framed as "a direction, not an excuse to create empty folders." A directory is created only when the current milestone puts real code, tests, data, or docs in it. `src/main.ts` (Phase 0) stays flat at `src/` root until Phase 1 introduces `app/`, `engine/`, `simulation/` with actual content to justify the split. The root-level memory files (GAME_SPEC.md, ROADMAP.md, etc.) stay at repo root per the original binding instruction — the `docs/` folder above is for later architecture/schema/budget docs distinct from those, not a replacement for them.

## 2026-08-19 — "MILESTONE 00" prompt reconciled with existing Phase-numbered ROADMAP.md; no duplicate PROJECT_CONTRACT.md created

**Decision:** A later prompt asked to read `PROJECT_CONTRACT.md`, `ARCHITECTURE.md`, `CONTENT_SCHEMA.md`, `PERFORMANCE_BUDGETS.md` and described work as "MILESTONE 00." None of those four files existed. Rather than creating a second, competing contract file, `GAME_SPEC.md` (created in an earlier accepted milestone, already binding) is treated as fulfilling the `PROJECT_CONTRACT.md` role. "Milestone 00" was executed as ROADMAP.md's existing Phase 1 ("Core architecture skeleton"), whose scope already matched almost exactly — ROADMAP.md now labels that entry "Phase 1 / Milestone 00" rather than renumbering the whole roadmap. `docs/ARCHITECTURE.md`, `docs/CONTENT_SCHEMA.md`, and `docs/PERFORMANCE_BUDGETS.md` were created for real, since this milestone gives each of them genuine content.
**Reason:** Avoids two binding-sounding contract documents that could silently drift apart, and avoids discarding the already-accepted Phase 0–9 roadmap structure. Preserves the newest explicit instruction (the four named docs, the milestone framing) while not contradicting the earlier one (root-level GAME_SPEC.md as the single binding contract, phase-numbered roadmap).

## 2026-08-20 — Git repository, publishing cadence, and authorship rules

**Decision (repository).** This directory is now its own git repository with `origin` set to
`https://github.com/Bouwles/Pacific-Rim-Shatterdome-Earth`, default branch `main`. It was previously an
untracked folder sitting inside an unrelated repository rooted at `C:\Users\user`; that outer repository is
left alone and now simply sees this folder as a nested repo.

**Decision (cadence).** Push to `origin/main` at the end of every completed milestone prompt, after the full
check gate passes. A milestone is not finished until it is pushed.

**Decision (authorship).** Commits are authored and committed solely by the repository owner. Never add a
`Co-Authored-By` trailer, an AI attribution line, a "generated with" footer, or any other tool credit to a
commit message, and never add a contributor entry for an assistant anywhere in the repository. This is a
standing user instruction, not a per-task preference.

**Decision (prose style).** README.md and CHANGELOG.md are the human-facing surfaces of the project. They
use plain prose: no em dashes, no en dashes used as punctuation, no emoji, and no marketing voice. Keep
them minimal. The README explains what the finished game is meant to offer while stating plainly which
parts actually run today, so it never implies working systems that do not exist. Commit messages follow the
same style. Internal engineering documents under `docs/` and the other root memory files are not bound by
this and may keep their existing punctuation.

## 2026-08-21 — Milestone 04: world coordinates

**Decision (miniature Earth is a shrunken globe with full-size occupants).** `EARTH_SCALE` is 1/50, giving a
127 km radius, while Jaegers and cities keep their real dimensions.
**Reason:** GAME_SPEC calls for a seamless miniature Earth that can be crossed, and for combat that reads at
Jaeger scale. Those pull in opposite directions, and shrinking the planet while leaving its occupants alone
is the resolution. It is geometrically inconsistent on purpose. The consequence surfaced immediately in
testing: region radii sized like real metropolitan areas overlapped once the globe shrank, so region radii
now mean the dense combat core and are capped by the tightest pair on the map.

**Decision (geodetic authoritative, tangent local).** Positions are stored as latitude, longitude and
altitude, converted to a local east/north/up frame near the player.
**Reason:** A single world-space Cartesian frame loses precision with distance from its origin, which is
exactly the failure a seamless planet provokes. Degrees in a double resolve far below a millimetre here, and
the representation serializes directly, so a save stores what the simulation holds. Round-trip error is
measured under a micrometre across the active bubble.

**Decision (cube-sphere with a tangent adjustment).** Six faces of 16 by 16 cells, warped through `tan`
before projection.
**Reason:** A lat/lon grid has a polar singularity and cells that vanish near the poles. A plain cube-sphere
avoids that but still leaves corner cells 2.31x larger than face-centre cells, measured. The tangent
adjustment brings the spread to 1.35x, so streaming cost barely depends on location.

**Decision (neighbours by reprojection, not an adjacency table).** Stepping off a face edge is resolved by
projecting the stepped point back onto the sphere and asking which face it lands on.
**Reason:** The alternative is 24 hand-written edge adjacency rules, which is both the name-keyed branching
the contract forbids and a thing that silently falls out of sync with the face bases. One rule covers every
face, edge and corner. Tests assert four distinct neighbours for all 1,536 sectors, symmetry everywhere
including the eight cube corners, and full reachability by walking neighbours.

**Decision (rebasing goes through global position, not a shift subtraction).** `rebaseLocal` converts old
local to geodetic to new local.
**Reason:** Written first as a subtraction of the anchor shift, which a test caught as wrong: two tangent
planes on a sphere differ by a rotation as well as a translation, so subtraction drifted 2.9 m across a 4 km
rebase. That is a visible pop on a 75 m Jaeger, and precisely what this milestone forbids. The event still
reports `shift` for camera and audio continuity, with a comment saying not to use it as a rebase operator.

**Decision (trigonometry allowed in `src/world/**`).** The determinism rule banning `sin`/`cos`/`pow`
applies to `src/simulation/**` and `src/entities/**` only.
**Reason:** There is no way to place points on a sphere without trigonometry. World coordinates therefore
sit outside the bit-exact kernel. The practical cost is that cross-engine bit-identical replay would not
survive world movement becoming authoritative; if that is ever needed, the fix is fixed-point or tabulated
trigonometry at the boundary, not moving the maths back into the kernel.

**Decision (movement carries geodetic altitude).** Walking preserves the previous altitude rather than the
local `up` component.
**Reason:** A tangent plane is flat and the globe is not, so a straight line in local space lifts off the
surface: measured at 239 m of false altitude over a 25 km walk in the browser. Carrying altitude across
keeps movement on the ground until real terrain heights exist.

**Decision (exactly one active region, enforced by the format).** `validateWorldSnapshot` rejects any
snapshot claiming two active regions.
**Reason:** "Do not keep distant cities as active physics scenes" is a rule that decays if it lives only in
whichever code path last touched tiering. Putting it in the validator means a save cannot even represent the
broken state.

## 2026-08-21 — Milestone 03: persistence shape

**Decision (version 0 is the bare kernel snapshot).** Rather than inventing a legacy format so the
migration system would have something to migrate, version 0 is defined as a bare `SimSnapshot` with no
envelope. That is genuinely what `SimulationKernel.serialize()` has returned since Milestone 01, and is the
only save-like artifact that existed before this milestone.
**Reason:** The acceptance criteria require a fixture of an old version. Fabricating a v1 that never
shipped would make the migration test theatre. A raw snapshot is a real artifact a developer could have on
disk today, and accepting it is genuinely useful. No released build ever wrote a version 0 _file_, and
SAVE_MIGRATIONS.md says so explicitly.

**Decision (checksum enforced only pre-migration).** A stored `checksum` is compared against the document
only when no migration ran.
**Reason:** A migrated document legitimately differs from the bytes that were hashed at write time.
Enforcing it after migration would reject every old save as corrupt.

**Decision (damaged slots stay listed).** `listSlots` includes a slot whose live record is unreadable,
described from the backup that would be loaded and flagged `damaged`.
**Reason:** The first implementation skipped damaged slots, which was discovered in the browser to make
recovery unreachable: with no row there is no Load button, so the working backup was stranded. A hidden
recovery path is the same failure as a fake button, in reverse.

**Decision (thumbnails via render target, not canvas copy).** `Tools.CreateScreenshotUsingRenderTargetAsync`
rather than `drawImage` from the canvas.
**Reason:** Verified in the browser that canvas copies return solid black under WebGPU, whose swap chain is
not a drawable 2D source once the frame has ended. Two attempts at canvas copying were measured as blank
(brightness 0, one distinct colour) before switching; the render target path measures as a real image.

**Decision (memory fallback rather than refusing to start).** When IndexedDB cannot be opened, the game
runs against an in-memory repository and the storage panel says saves will not survive the tab.
**Reason:** Private windows expose `indexedDB` then fail to open it. Refusing to start would be worse than
playing without persistence, and silently pretending to save would be worse still.

**Decision (cycle detection added to `hashState`).** The Milestone 01 hash now tracks ancestors and rejects
cycles by name.
**Reason:** `validateRootSave` uses `hashState` as the guard against non-serializable data reaching a save.
A circular document previously only failed via stack overflow, which is slow and gives an unhelpful
message. Only the current path is tracked, not everything seen, so sibling references to the same object
stay legal.

## 2026-08-20 — Milestone 02: asset pipeline shape

**Decision (parameterised generators, not per-unit factories).** Eight generators cover all seven asset
classes, each driven entirely by manifest params. Three different bipeds (two Jaegers and a kaiju) share
one `biped` generator.
**Reason:** The contract explicitly forbids a unique hand-coded mesh factory per unit. Parameterisation
means a new unit is a data row, and a fix to limb construction reaches every unit at once instead of
needing twelve edits.

**Decision (generators report true height).** Each generator normalises its proportions so the geometry it
builds actually measures `heightMeters`.
**Reason:** The alternative was a hand-tuned `nominalHeightMeters` per manifest to satisfy scale
validation, which turns a real check into a rubber stamp. Two of my own placeholders failed the check
before this change, which is the check doing its job.

**Decision (overrides are structurally limited).** `AssetManifestOverride` exposes only `source`,
`fallbackGenerator`, `materials` and `portrait`.
**Reason:** "Changing an asset manifest must not alter unit statistics" is enforced by the type rather than
by discipline. Collision, sockets, nominal height and animation tags simply cannot be reached from an
override, so the rule cannot be broken by a future careless edit.

**Decision (fallback is mandatory, and warns once).** Every manifest must name a fallback generator, and a
failed model load warns once per asset id and then renders the placeholder.
**Reason:** A missing asset is a content gap, not a crash. Warning once per asset rather than per attempt
keeps a render loop from flooding the console, while still naming the asset, the path, the generator that
took over, and where to put the file.

**Decision (gallery borrows the boot scene).** The gallery swaps content inside the existing scene instead
of creating and disposing its own.
**Reason:** The debug overlay's `SceneInstrumentation` is bound to a specific scene, so a scene swap would
mean rebuilding the overlay too. Content swap gets the same result with less machinery. A real scene
lifecycle belongs in the milestone that first has two genuinely different environments.

**Decision (damage preview ranks parts geometrically).** Detachment order is by distance from the
silhouette's centre, with vertical distance weighted at half.
**Reason:** The obvious alternative, matching part names, is exactly the name-keyed branching the contract
forbids, and would need updating for every new generator. Distance ranking works for a Jaeger, a serpent
and a warehouse without the gallery knowing what any part is called. Alphabetical ordering was tried first
and read wrongly on screen, dropping the torso while arms floated.

**Decision (vehicle material budget raised from 2 to 3).**
**Reason:** A road vehicle needs body, glass and tyres. The original figure was a guess that forced a
texture atlas for no benefit at that size. Raising it was correcting the budget, not silencing the check.

## 2026-08-20 — Milestone 01: kernel determinism rules, and moving the diagnostics panel into `src/debug/`

**Decision (determinism).** Authoritative code in `src/simulation/**` and `src/entities/**` may not call
`Math.random`, may not read wall-clock time, and may not use transcendental math (`sin`/`cos`/`pow`).
Randomness comes from `RngStreams.stream(name)` derived as `masterSeed ^ hash(name)`; motion and other
systems use addition and multiplication only.
**Reason:** GAME_SPEC requires seeded deterministic generation and replayable scenarios. Per-subsystem
streams mean adding a draw in one system cannot shift another system's sequence, so a scenario hash stays
meaningful as the game grows. Transcendentals are excluded because their results are not guaranteed
bit-identical across JS engines, which would break cross-machine replay for a reason nearly impossible to
debug later.

**Decision (hash).** State digests use a two-lane FNV-1a producing 64 bits, over a canonical encoding that
sorts object keys and hashes numbers as Float64 bytes (normalizing `-0` to `0`).
**Reason:** A single 32-bit lane collides too easily to trust as a regression signal. Sorting keys keeps the
digest stable across refactors that only change property order; hashing raw float bytes avoids the precision
loss of string formatting. Not cryptographic — this detects divergence, it does not resist tampering.

**Decision (overlay location).** `src/engine/diagnosticsPanel.ts` was moved and extended into
`src/debug/overlay.ts` rather than left in place or duplicated.
**Reason:** The target shape assigns the performance overlay and debug scenes to `debug/`, and this
milestone gave that directory real content (the scenario runner). Extending the existing panel rather than
adding a second one avoids the parallel-replacement failure mode; the `#diagnosticsPanel` element id was
kept so Milestone 00's accepted browser tests keep passing unchanged.

**Decision (physics readout).** The overlay's physics-bodies provider returns `number | null`, and bootstrap
supplies `() => null`.
**Reason:** The milestone requires displaying active physics bodies, but no physics backend is wired. Printing
`0` would imply a working integration that reports nothing; "n/a (no backend)" is the honest reading and
becomes a real number the moment a backend lands.

**Decision (default seed).** `DEFAULT_SEED` is a fixed constant, overridable via `?seed=`.
**Reason:** A clock-derived seed would make a plain page load unreproducible, which defeats the point of the
kernel. Per-campaign seed generation is a save-system concern and belongs with Phase 2.

## 2026-08-19 — Bundle size not optimized in Phase 0

**Decision:** Accept a single >5MB unminified JS chunk (Babylon core) in the Phase 0 production build rather than configuring `manualChunks`/dynamic imports now.
**Reason:** Premature optimization — there is exactly one entry point and no code-split boundary to speak of yet (no separate Shatterdome/combat/world-map modules exist). Revisit when Phase 2+ introduces distinct feature modules that are natural split points.
