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
