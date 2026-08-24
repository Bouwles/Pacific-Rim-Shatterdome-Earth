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

## 2026-08-22, Milestone 05

**Terrain noise is hashed on position, not drawn from an RNG stream.** `RngStreams`
produces a sequence, which is the wrong shape entirely: two sectors sharing an
edge must agree on that edge regardless of which was generated first, or whether
the other was generated at all. Hashing the sample position makes generation
order irrelevant, which is what lets a sector be evicted and rebuilt later
without the world changing. Measured result: shared edges match to exactly zero.

**Noise is sampled in three dimensions on the sphere, not in two per cube face.**
A per-face 2D field seams along the twelve cube edges, and no blending hides a
coastline that stops dead at a face boundary. The cost is eight lattice lookups
per sample instead of four, which measurement showed to be irrelevant: a full
level-of-detail-0 sector generates in about 0.5 ms.

**Elevation is independent of biome.** Climate is resolved per sector, so letting
it touch height made adjacent sectors in different climate bands disagree by a
measured 25.6 m along their shared edge. Height is one continuous global field;
biome decides only colour and scatter. Two `BiomeDefinition` fields that existed
only to feed elevation were deleted rather than left in place looking implemented.

**Region content dictates terrain, through data.** Pure noise put a Shatterdome
underwater and made the open-ocean Breach a 640 m mountain, both measured on this
seed. Regions now supply a `TerrainAnchor` carrying a land-mask target, an
authored climate and whether they are populated. `KIND_TERRAIN_SHAPE` maps region
kind to those values as a table in the content layer, so the generator never
branches on what a Shatterdome is.

**The region-to-terrain mapping lives in `src/data/`, not `src/world/`.** Putting it
in `world/regions.ts` made `world/regions` import `world/terrain`, which imports
`data/biomes`, which imports `world/regions`. The cycle left both mask constants
undefined at module-init time and every generated height came out NaN, which
renders as nothing at all rather than as an error. Content may depend on the
world layer; the world layer must not depend on content. A validator now rejects
a non-finite mask target by name so the same class of bug cannot be silent again.

**Streaming rings expand through eight neighbours, not four.** Edge-only
breadth-first expansion produces diamond rings, which leave the four corners of
the loaded area empty; on screen that is a black notch in the middle distance
where the ground stops. Square rings cost more sectors (49 instead of 25 at depth
three) and are what a viewer expects a loaded area to look like.

**Terrain data and GPU meshes have separate lifetimes.** Evicting a sector frees
its meshes and keeps its data in a byte-bounded LRU cache. The milestone's
explicit failure mode, keeping meshes alive because their data remains cached, is
prevented structurally rather than by discipline: the cache holds `SectorTerrain`
and has no reference to a mesh.

**Sector vertices are built in each sector's own tangent frame.** A floating origin
rebase then costs one transform per sector root rather than rebuilding every
vertex buffer, and stays exact, because the rotation between frames is carried by
the root. This is the same fact that made `rebaseLocal` necessary in Milestone 04,
applied to presentation.

**Skirts are sized from each sector's relief.** A coarser neighbour samples the
shared edge at half the resolution, so the two edges differ by a fraction of the
sector's height range. A fixed 260 m apron was shallower than that in hilly
sectors and the gap showed as a black crack running down the seam.

**Nothing about streaming is saved, and the save format did not change.** Terrain
is a pure function of `(seed, sector, level of detail)` and the seed is already
stored. Writing generated terrain into a save would make saves grow with distance
travelled and freeze worlds against future generator changes. `ROOT_SAVE_VERSION`
stays at 2 and no migration was written, which is the honest outcome rather than
a version bump for appearance.

**The worker is real, and the fallback is reported.** `WorkerTerrainService.create()`
falls back to inline generation with one warning when a worker cannot be
constructed. The streamer cannot tell the difference, and the panel names which
path is live, because a silent fallback to main-thread generation is exactly the
kind of hidden performance cliff this project's quality contract forbids.

**Streaming instrumentation appears only in the ground view.** The globe does not
stream sectors, so showing it a streaming panel full of zeroes would imply a
system was running when it was not.

**Controls sit above readouts in the world panel.** Readouts grow as more of the
world reports itself; buttons must stay reachable. When the streaming block was
added above them, the walk and route buttons went off the bottom of the screen
and then under the debug overlay, where they could not be clicked at all.

**Terrain constants were chosen by measurement, not taste.** The land-mask target
was swept across a range and judged on city ground elevation and water fraction
across all eight regions; 0.56 keeps every region on dry land between 153 m and
403 m with six of eight retaining a coastline, where 0.62 pushed the same figures
to 305 m and 810 m for no gain. This is tuning against evidence, not art
direction, and it will want a proper pass once someone judges how the world
should look.

## 2026-08-23, Milestone 06

**World time advances on simulation ticks, never on wall clock.** One tick is one
in-game second, which makes a day 86,400 ticks and 24 real minutes, and makes the
arithmetic legible in a debug readout. The consequence that matters is that
pausing the simulation pauses the sun and a save reproduces the sky it was written
under. A wall-clock sky would make a save load into whatever time of day the
player happened to press the button.

**Weather is derived from the seed, not simulated forward.** Fronts occupy fixed
six-hour slots and the front covering any tick is a direct lookup from
`(seed, climate, slot)`, so a tick half a million slots out resolves as fast as
the first. Simulating forward would make the sky depend on how the session
happened to be played rather than on the world being played, and would need the
whole history in a save.

**Steady-then-crossfade rather than continuous blending.** Weather holds for three
quarters of a slot and crossfades across the last quarter. Blending continuously
would mean weather never sits still; a hard switch at the boundary would be a
visible jump. Smoothness is a property of the construction, not of a smoothing
pass bolted on afterwards.

**Wetness is the only weather value in a save.** It is the only one that is
genuinely history: ground stays wet after rain stops. Everything else is a
function of the seed and the tick, so storing it would be storing a derivation.

**The climate profile is injected, never imported.** `WeatherSystem` takes a
profile as a constructor parameter and `src/world/**` never imports
`src/data/**`. This is the same rule Milestone 05 arrived at the hard way, when a
content import into the world layer produced a module cycle and a planet of NaN.

**Waves are a sampled field, never rigid bodies.** `sampleWaveHeight` is pure in
position, time and wind, so gameplay, rendering and any future physics ask one
question and get one answer. Simulating each wave as a body costs orders of
magnitude more and buys nothing a height field cannot express; the milestone named
this as a failure mode and this is the structural avoidance of it.

**Wave phase is read in globe-fixed coordinates, not the floating-origin frame.**
Local coordinates move every time the origin rebases, which would slide the entire
sea sideways whenever the player walked two kilometres.

**Water state turns on whether the feet are on the bottom.** A Jaeger standing
chest deep on the shelf is fighting, not swimming, and collapsing those into one
state is what makes water feel like the same game in a different place rather than
a different game. `resolveFeetHeight` picks standing, floating or diving by
comparing depth against the body's own height, so a 75 m machine wades through
shallows instead of bobbing in them.

**Buoyancy is exported and tested, not wired.** There is no physics backend, so a
buoyancy force with nothing to apply it to would be a fake system. It is a pure
function ready for the milestone that has a solver.

**Environment queries cannot reach the renderer.** `src/world/environment.ts`
imports no Babylon and no DOM. An AI deciding whether it can see a target and a
test asking the same question have to go through the same door, and the only way
to guarantee that is to make the other door structurally unavailable.

**Every environmental effect lands in one struct.** `EnvironmentEffects` holds
visibility, traction, movement, wind push and ranged accuracy penalty. If a value
is not there, nothing outside rendering can act on it, and the gap is visible
rather than arguable. This is what stops weather from quietly becoming cosmetic.

**Fog density is solved from the visibility distance gameplay reads.** Exp2 fog is
`exp(-(density * distance)^2)`, so 95 percent obscured at V metres gives
`density = sqrt(3) / V`. Using 3 instead squares the exponent and fogs the scene
flat well inside the stated range: it did exactly that, and looked like the world
had failed to load. Deriving it from the same number an AI reads means the two
cannot drift.

**The sky drives the existing sun rather than adding one.** Two directional lights
called sun is how a scene ends up lit from two directions with nothing to say
which is real. The boot scene owns the light and the shadow map; `SkyView` moves
and colours them.

**Shadow map size changes by rebuilding the generator.** Babylon fixes a shadow
map's resolution at construction. The boot scene exposes `setShadowMapSize`, which
disposes and rebuilds, so there is still exactly one owner. A second generator
elsewhere would double the shadow cost while looking like it had replaced the
first.

**Quality presets are budgets, not labels.** Every field is a number some system
reads directly. The rule holding the table together is that lowering quality
removes detail and never information: each preset declares the telegraphs it
draws, and the registry refuses one that drops a required telegraph. A future
tuning pass therefore cannot buy frame time by deleting the lightning flash.

**Changing quality rebuilds the ground view.** Particle capacity and water grid
resolution are both fixed when their objects are built. Rebuilding is a visible
reload, which is honest about the cost, rather than pretending the change was free.

**Rain is sized to be legible, not to scale.** A raindrop is a couple of
millimetres and would be invisible at any camera distance this game uses. Rain the
player cannot see fails as a telegraph, and the telegraph is the point.

**Time controls are labelled with clock times, not with dawn and dusk.** Sunrise
moves with latitude and season, so a button called Dawn would be lying at most of
the places the player can stand.

**Ambient audio is synthesised, and says when it is blocked.** The project ships no
audio files and never will ship film audio, so an ambience that is generated is the
only kind that can exist here. Browsers refuse to start audio outside a user
gesture; the panel reports `blocked` rather than implying sound is playing.

**Browser tests run one file at a time.** Playwright otherwise runs spec files
across half the CPUs, and every test now starts a WebGPU context, a terrain worker
and a set of particle systems. Eight at once thrashed the GPU and timed each other
out, failing a different test on every run for no real reason. A serial suite is
slower and gives the same answer twice, which is the only property a gate needs.

## 2026-08-23, Milestone 07

**The city is a grammar, not a model.** A district row says how to make blocks;
`generateCityLayout` makes them. Adding a district is a row rather than a branch,
and the whole city is a pure function of the region, the seed and the plan, so it
is cached rather than saved and rebuilds identically.

**The plan is measured from the seaward bearing, not from north.** Region content
declares which way open water lies, and every district offset is relative to it,
so the harbour lands on the water wherever a region sits on the globe. The
bearing is authored because the terrain generator has no notion of which way a
coast faces.

**Layout is in the region-centre frame and is not terrain-aware.** The region
centre never moves, so a floating origin rebase moves one transform rather than
every instance, and a layout cannot depend on which sectors happen to be loaded.
Heights come from the streamed collision field at render time.

**Every block carries a destruction group id.** One mesh per group is the
structural answer to the "one monolithic city mesh" failure mode: the city can be
streamed and later damaged in pieces because it was never assembled into one
thing. A block belongs to exactly one group, so damage cannot double-count.

**Activity is a density field, not a crowd.** A district is one `ActivitySample`,
and there is no per-civilian state anywhere in the codebase. That is the
structural answer to the "thousands of full AI civilians" failure mode: it is not
a budget that could be exceeded, it is a shape that has nowhere to put them.

**Agent pools are allocated once at the quality budget.** Only
`thinInstanceCount` changes as activity rises and falls, so a busy city allocates
nothing. Positions are a function of index, lane and tick, which means an agent
has no state to update or to save.

**Military traffic shares the civilian pool.** What an alert changes is how many
vehicles are on the roads, not how many kinds of mesh exist. Counts are reported
per kind as well as in total, because the total barely moves during an alert while
every kind moves a long way, and reporting only the total would hide exactly the
thing the milestone claims to do.

**Alert profiles are a table.** Sirens, traffic, shipping, aircraft and the
military all read the same row, so they cannot disagree about what "warning"
means. Adding a level is a row.

**Only alert level and evacuation progress are saved.** They are the only city
state that is genuinely history. The layout is derived from the seed; saving it
would make save size grow with how much of the world had been visited and would
freeze old saves against future changes to the grammar.

**Each migration writes the world schema version as it stood at that step.**
Writing today's constant into an older step makes a migrated file claim a shape it
does not have, and the next step in the chain has nothing to recognise. This was
corrected in the version 1 to 2 step while adding the version 3 to 4 one.

**Ground heights are sampled once into a grid.** Asking the streamer per agent per
frame costs a geodetic conversion, a tangent basis and a sector lookup each time.
Sampling the terrain once into a 65 by 65 field at build time turns the same query
into four array reads.

**Frame rate is not asserted in browser tests.** Playwright's Chromium falls back
to a software rasteriser, so an fps reading from it measures the test runner
rather than this code: the same scene read 19 fps there and 144 in a real browser.
The tests assert draw calls and that the simulation keeps ticking, which are
portable; frame rates are measured by hand and recorded in PERFORMANCE_BUDGETS.md.

**The panel hides rendering figures where nothing is rendered.** The layout and the
alert are real wherever the player stands, so those rows stay on the globe. "How
much of the city is drawn" is not, so it goes. Reporting zeroes would imply a city
that is not there, which is the fake-UI rule applied to a readout rather than to a
button.

**Lower quality draws a smaller city, not a blurrier one.** Groups are taken
nearest-first from the region centre and capped, so what survives on Low is the
centre, which is the part that carries the silhouette.

## 2026-08-24, Milestone 08

**A facility is a grammar row, not a room.** Thirteen definitions carry footprint,
deck, stations and a ladder of tiers; `generateInteriorLayout` makes the rooms.
Adding a facility is a row plus a connection, and the registry refuses a tier that
adds no fixtures over the one below it, because an upgrade the player cannot see
is not an upgrade.

**The complex is a graph of rooms, not one interior scene.** Only the active room
is built in Babylon. This is the structural answer to the "one giant interior"
problem rather than a budget: the bay cannot cost anything while the player is in
the archive, because it does not exist. A facility that has not been built has no
room at all.

**A sealed bulkhead rather than a missing wall.** A doorway to an unbuilt facility
says which facility and why. That turns the construction system into something the
player discovers by walking around rather than by reading a list.

**Power and crews, and no invented currency.** Construction is constrained by
reactor output and by logistics crews, both of which are facilities the player can
upgrade. An economy would have to be fabricated to add money now, and a fabricated
economy is the fake-system failure mode wearing a different hat.

**Movement is a pure function.** `stepOnFoot(pose, input, dt, room, effects)`
returns the next pose. The camera is placed from the pose rather than the pose
read back from the camera, and Babylon's own camera input is never attached, so
the renderer cannot move a player the simulation believes is standing still.

**On-foot constants live in one object and are asserted against Jaeger scale.**
The failure this prevents is silent: a controller that inherits a 75 m machine's
speed or a 400 km far plane still runs, it just feels wrong. A test that names both
numbers catches it the moment someone reuses the wrong constant.

**Two ways to focus something, deliberately.** Looking at it is the one most
players use; cycling with Tab is what makes the interior playable with no mouse at
all. That is the difference between an accessible prompt and a decorative one.

**A room is rebuilt when it changes shape, not every frame.** The session carries a
revision that moves when an order lands or a build completes, and the view rebuilds
on that. Scaffolds appearing the moment an order is placed is the same mechanism.

**Staff are a number outside the room and positions inside it.** There is no
per-person state anywhere, which is the structural answer to "do not simulate every
staff member at full fidelity outside the active room": there is nowhere to put
them. Named characters are the exception, and their lines are templates filled from
live state so they cannot claim a tier the complex is not at.

**Pausing pauses the simulation.** Construction, the clock and the weather all
advance on ticks, so stopping the transport stops all three. A pause that only hid
the view would let the complex build itself behind a menu.

**Only history is saved.** Facilities, progress, position and the selected machine.
Rooms are derived from those and the seed, so saving them would freeze old files
against future changes to the facility grammar.

**Frame rate is still not asserted in browser tests**, and the interior tests
assert draw calls, mesh counts and simulation liveness instead. The measured
figures in PERFORMANCE_BUDGETS.md are taken by hand on the real renderer.

**A thin-instance pool that starts empty needs its buffer set again, not marked
updated.** On WebGPU, growing `thinInstanceCount` from zero after the buffer was
registered draws nothing; the room reported six people on shift and rendered an
empty floor. The pool also has to be excluded from bounding-box culling, because
it is allocated with every instance parked below the deck. Both are handled where
the count changes rather than per frame.

## 2026-08-24, Milestone 09

**One controller, a profile per machine.** `stepJaeger` never learns which Jaeger
it is driving. That is what makes "works for a heavy tank and an agile frame"
testable rather than aspirational: the courses run three profiles through the
same code and compare the results.

**Locomotion states are a table; transitions are an ordered predicate list.** A
switch over twenty states would encode priority implicitly. The list makes
priority the visible thing: death, then reactions, then water, then the stick.

**Footfalls are spaced by distance, never by time.** This is the animation
contract. An animation system reads a stride phase and footfall events and plays
whatever it likes; the controller never reads back from a skeleton. It is also
the measurement that catches skating, because a measured stride that disagrees
with the declared one is exactly what skating is.

**The ground probe has a floor.** Scaling lookahead purely by velocity meant a
blocked machine probed zero metres, read clear ground, and crept into a cliff
face one frame at a time. The probe now reaches at least half a stride in the
direction of travel or facing.

**A landing fires on leaving the air, not on touching the exact ground height.**
The machine counts as grounded a metre and a half above the ground, so waiting
for the precise height meant a fall that never reported a landing at all.

**The body is never snapped to the camera.** Camera yaw is an intent. This is the
single decision that most separates a heavy machine from a first-person
character, and a test measures a single frame to keep it true.

**Camera rigs are multiples of machine height.** A 68 m frame and an 82 m frame
are both framed correctly with no per-machine camera data, so adding a machine
cannot mean adding a camera.

**Comfort is not a settings-menu afterthought.** Shake scale and reduced motion
are on the pilot panel, and reduced motion removes sway, roll and the pull-back
at speed while leaving every scale cue in place. Motion sickness is an
accessibility problem, and the answer is not to remove the information.

**Mass is communicated four ways before shake.** Acceleration and braking, turn
authority, stride-spaced footfalls with prints that stay on the ground, and
delayed sound. Shake is the last of them and the only one a player can switch
off entirely.

**The stand-in player marker is switched off while driving.** The streamer's
white box exists so the player is somewhere when nothing represents them. Once a
machine does, two things claim the same position and the bigger one wins.

**Nothing new was saved.** A pilot session is live state; the world already saves
the position it drives to. `ROOT_SAVE_VERSION` stays at 5 with no migration,
which is the right answer whenever new state is derivable or transient.

## 2026-08-24, Milestone 10

**Moves are data and damage is a typed packet.** The failure mode this exists to
prevent is damage living in animation event strings with nothing validating it.
A move that cannot connect, a cancel window that opens before the move can land,
a volume that outlives its own active frames and a packet that does no damage
are all refused at registration, by name.

**Hit detection is swept, and never a per-frame mesh intersection.** The volume
is placed where it was and where it is, both ends interpolated, and the closest
approach decides. That is four distance tests per volume per zone per tick, all
of it arithmetic the simulation already has, and none of it needs a scene.

**One overlap history per attack instance.** A multi-hit move is a deliberate
thing with several volumes, not an accident of a volume staying live for six
ticks.

**Both sides run one resolver.** The creature's claw sits in the same table as
the machine's cross. When kaiju behaviour arrives it will choose rows from that
table rather than getting a combat system of its own.

**Poise gates staggers; explicit knockdowns do not.** Found by running the
scenario: without the gate, a machine that could keep throwing heavies held the
creature in a permanent stagger and the fight was one sided in a way no number
in the table admitted to.

**Aim mode decides which zone a hit lands on, generously.** Without it, every
swing lands on whatever is biggest, which on an eighty metre creature is always
the torso, and body zones become decoration. An aimed zone wins when the contact
was within the larger of three zone radii and a third of the creature's height.

**Refusals are events.** An attack that cannot be thrown produces a logged reason
in words. That is the same principle as the facility terminal greying a button
with an explanation: a rule the player cannot see is a rule they will assume is a
bug.

**Combat has its own fixed tick, accumulated from frame time and capped.** A
stalled frame cannot run a second of fighting at once, and the resolver never
sees a variable delta.

**Nothing new is saved.** A fight is live state. Per-component damage that
survives a battle is its own milestone with its own save section, and inventing
that schema now would be guessing.

## 2026-08-24, Milestone 14

**A destruction group is the smallest damageable thing.** The layout already
buckets every building into one on a 480 m grid, so damage had a unit before
this milestone started. Going finer means per-building records, which means a
save proportional to the size of the city and a physics problem nobody asked
for. Going coarser means a city with one health bar.

**Debris is pooled, ballistic and frozen, not physics.** A collapse throws at
most two dozen chunks whatever the building was, each one integrates until it
lands, and then it stops forever. The alternative, a rigid body per piece of
facade, is exactly the failure mode the milestone names.

**The summary is the save, and the detail is rebuilt from it.** The detailed
model exists only for the region the player is standing in. Everywhere else is a
few numbers per damaged block on a record that every region on the planet
already carries. That is what makes destruction regional rather than local
without saving a scene.

**Maximum health and geometry come from the build, never the file.** A saved
block carries fractions and counts. Rebalancing the city grammar therefore
changes what an old save means in the right direction instead of leaving it
carrying numbers from a version that no longer exists.

**Both clocks go through one call.** Time skipped on the panel and time passed
while away are the same thing to a burning building, and having two paths is how
one of them ends up doing nothing. That is exactly what had happened before it
was caught by hand.

**Passability belongs to the nearest block.** Group radii overlap on a 480 m
grid, so asking whether any nearby group is blocked called clear streets
impassable because the next block along had come down.

## 2026-08-24, Milestone 13

**A machine is a component table, not a health bar with extra fields.** The
components are one registry, generic across chassis and scaled by mass, and the
arena builds one hit zone per component from it. That is what makes "the right
arm is gone" a real sentence rather than a cosmetic label on a number.

**A component must cost something to lose.** A part that disables no system,
carries no mount and is not critical is refused at registration. Otherwise the
table fills up with parts nobody notices and localized damage becomes decoration.

**What is offline is derived, never stored.** Disabled systems, component states
and mobility penalties are all functions of current health, computed when asked.
Storing them is how a save ends up claiming an arm is gone that is visibly
attached.

**A scar is four numbers and a seed.** The alternative, saving where each piece
of torn plate sits, is the failure mode this milestone was told to avoid: it
grows without bound, it breaks the moment the model changes, and it makes a save
file proportional to how many fights a machine has had. Growing the debris from
a seed means the record is tiny and the machine still looks the same every time.

**Maximum health comes from the build, not the file.** A save carries fractions.
Rebalancing a chassis therefore changes what an old save means in the right
direction, instead of leaving a machine carrying numbers from a version that no
longer exists.

**Coming home is a function of the damage, not a flag.** Whether a machine is
ready, in the gantries, towed or rebuilt is computed from what it is carrying.
There is nothing to remember to set, so there is nothing to forget.

**A work order is sorted worst first, and a shift always spends something.** Both
came out of a real stall: a one point job whose hours rounded to zero held up a
leg replacement forever. Ordering by what is missing also happens to be the order
a crew would actually work in.

## 2026-08-24, Milestone 12

**A weapon is a row and the behaviour is a field.** Eight behaviours share one
fire path, and which one a weapon uses is data rather than a branch. Adding a
ninth is a row and a case in one resolver, not a new system next to the old one.

**Ranged fire is refused at registration if it costs nothing.** The rule that
matters most in this milestone is the one that cannot be forgotten later: a
weapon with no ammunition cost, no heat cost and no reactor draw never reaches
the game. Free damage per second is a design mistake that is impossible to
notice once it is shipped, so the registry refuses it before anything runs.

**The projectile pool refuses rather than grows.** Growing under fire is how a
barrage becomes a frame spike, and thinning silently is how a weapon quietly
stops working with nobody knowing why. The pool has a ceiling from the quality
preset, the refusal is an event, and the count is on the panel.

**Rounds are retired by a bubble rather than by a lifetime alone.** Range and a
twelve second clock are not enough on their own: a fast round can outrun the
fight it belongs to. Anything more than 2,400 m from the centre of the fight is
gone, which is what makes "no ballistics simulated outside combat" structural.

**Events are drained, not returned by the step.** `step()` could only ever
report what happened inside it, and firing a weapon happens between two ticks.
Every shot, reload and refusal was being lost. The arena keeps a cursor and
anything showing the player what happened reads from that instead.

**Channel heat is per tick.** A sustained weapon that charged its heat per
activation would be free to hold forever, and one charging a swing's worth every
tick cooks the reactor in half a second. Per tick at a per tick rate is the only
version where holding it is a real decision.

## 2026-08-24, Milestone 11

**Defences are rows in the move table, not a parallel system.** A dodge, a block
and a parry each have a startup, an active frame and a recovery like everything
else, and they go through the same request, cancel and buffer path. That is what
keeps "a dodge has weight" true by construction rather than by discipline.

**Invulnerable frames sit in the middle of the dodge.** At the front they would
make the dodge a reaction to anything; at the back they would make it useless.
The middle is what makes the timing a skill and the recovery a real cost.

**A parry's counter steps outside the cancel rules.** It is the one guaranteed
answer in the game, so the parry's own recovery is cleared before the counter is
started. Leaving the rules in place meant the arena refused what the parry had
just promised.

**A seize takes hold on contact, not on release.** A grapple that began when the
button was pressed left the seize animation running as an active attack, which
then refused a finisher as an illegal cancel. Holding is a state that replaces
the attack rather than running alongside it.

**Refusals never cost the commitment.** A slam with nothing to slam into leaves
the hold intact; a throw with no room becomes a release and says so. The
alternative is a system where using a tool badly is punished twice.

**Space is one injected query, used by everything that moves an actor.**
Finishers, dodges, throws and grapple clearance all ask the same `SpaceQuery`.
There is no second opinion about what counts as solid ground, and a test can hand
the arena open ground without touching terrain.

**Damage that bypasses armour goes through one path.** Finisher payouts and
grapple impacts both call the same helper, which owns the zone destruction and
defeat checks. Reducing zone health directly is how a creature ended up at zero
core health and still fighting.

**A destroyed zone stops absorbing.** Hits fall through to the core, which makes
taking a creature apart worth doing and stops long fights stalling against a body
made entirely of dead plate.

**Accessibility settings produce identical outcomes.** Skipping a finisher pays
the same damage as watching it; hold-to-complete asks for the same input in a
different shape; reduced motion changes framings and nothing else. A setting that
costs the player something is not an accessibility setting.

**The move list is generated from the move table.** It cannot drift, it cannot
miss a move, and it cannot describe one that was deleted. Speed is a word because
a frame count is a developer's unit, not a player's.

**Still nothing new is saved.** Holds, charges, defences and finisher settings are
all live state on the arena, which is built when a target is spawned and torn down
with it. `ROOT_SAVE_VERSION` stays at 5.
