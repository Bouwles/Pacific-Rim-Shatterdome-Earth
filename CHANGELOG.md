# Changelog

## 2026-08-23, Milestone 07: Hong Kong vertical slice and living city layer

Hong Kong exists. Not a region record with a name on it, an actual city with districts, a skyline, a harbour, roads, a Shatterdome precinct and slums grown against its wall, and a population that reacts when something is coming.

- The city is grown from a grammar rather than placed by hand. A district is a rule: how big the blocks are, how tall, how densely packed, how regular, how many people live there and how early they get evacuated. Seven of those rules, arranged as wedges measured from whichever way the water lies, produce 710 blocks and 1,480 towers.
- Because the plan is measured from the coast rather than from north, the harbour ends up on the water wherever the region happens to sit on the globe.
- It is a stylised original. It takes the shapes a dense harbour city has, towers along the front, a ridge behind, docks down the shore, an improvised district pressed against the Shatterdome wall, and arranges them from a seed. No real street plan or map geometry is copied and none is claimed.
- Roads, shipping lanes, ferry routes, patrol lanes, air corridors, evacuation zones with muster points up on the high ground, seventeen defence positions facing the right way, and two deployment routes: one at walking scale off the Shatterdome apron, one at Jaeger scale straight through the waterfront to open water.
- Every block belongs to a destruction group, and every group is its own mesh. That is what makes the city something you can stream in pieces and eventually knock down in pieces, rather than one enormous model that can only exist or not exist.
- Nobody simulates a civilian. A district is a handful of numbers saying how much is moving and of what kind, and the renderer turns that into a bounded pool of instances travelling fixed lanes. A district of ninety thousand people costs exactly as much to think about as an empty one.
- Five alert levels, and they change the city rather than changing a label. Going to attack at Hong Kong took the streets from 26 percent busy to 4, cleared the harbour from 31 percent to 2, took the military from 15 percent to 100, sounded the sirens and started moving people to muster points. The vehicle pool went from 107 civilian cars to 196 mostly military ones.
- The response ramps rather than snapping, because a city does not empty the instant a siren starts, and evacuation flow peaks in the middle of an evacuation because nobody is moving before it begins and nobody is left once it is done.
- Time of day, rain, wind and damage all move the same numbers. A levelled district is empty whatever the hour says.
- Saves moved to version 4 to carry the alert level and how far the evacuation got. The city layout itself is never saved: it comes back identical from the seed, so storing it would only make saves grow with how much of the world you had visited.

Five defects were found and fixed. Three of them only showed up once there was something to look at.

The muster point for the ridge district ended up along the coast instead of inland. Each district offset its muster point by a fraction of its own bearing to stop them all piling on one spot, and for a district on the far side of the city that fraction swung it right round to the shoreline. The fan is now bounded, so a muster point is always somewhere away from the water.

Recovery kept the sirens going. Its own description said sirens off, and its number said fifteen percent, which is not off. The all clear is a thing that happens, and a siren that never quite stops is a siren nobody listens to.

The city ran at nineteen frames a second in the test browser. Six hundred agents were each asking the terrain streamer for a ground height every frame, which is a geodetic conversion and a sector lookup each time. The terrain is now sampled once into a grid when the city is built.

That turned out not to be the whole story, because the real browser was already running at 144. The frame rate the test was reading came from Playwright's software renderer, not from this code. That assertion is gone; the tests now check draw calls and that the simulation keeps ticking, which travel between machines, and the real numbers are recorded by hand.

The landmarks were half a kilometre wide. At up to twice a block across and nearly twice the district height, the tallest came out as a cone that read as terrain rather than as a building. They are slimmer now, and look like spires.

Two more things were adjusted after looking at the result. Splitting a twelve kilometre city into 320 metre destruction cells produced 233 groups, which meant a mid-range machine drawing its budget of groups covered a patch of city rather than a city; 480 metre cells bring it to 135. And the panel was reporting how much of the city was drawn while standing on the globe, where nothing is drawn at all, so those two rows now disappear when there is no city view to report on.

## 2026-08-23, Milestone 06: day, weather, atmosphere, and ocean foundation

The world got a sky and a sea. Time passes, weather arrives and leaves, and the ocean is something you can wade into, stand in, swim on and sink under.

- Time runs on simulation ticks, not on the wall clock. One tick is one in game second, so a day is twenty four real minutes. Pausing the simulation pauses the sun, and a save reproduces the sky it was written under rather than whatever time it happens to be when you load it.
- The sun and moon are placed with the real formulae, so there are real seasons, the sun behaves differently at Anchorage than at Manila, and a full moon rises as the sun sets. It ignores the equation of time and assumes a circular orbit, which is stated rather than hidden.
- Weather is worked out from the seed rather than simulated forward. Fronts occupy fixed six hour slots, so asking what the weather is a thousand years from now costs exactly as much as asking about today. Weather holds steady and then crossfades, which makes transitions smooth because of how it is built rather than because something smooths them afterwards.
- Rain, storms, fog, snow, wind, cloud, lightning and spray, each derived from one sample that the sky, the particles and the gameplay numbers all read. What the player sees and what the game believes cannot drift apart.
- The one thing weather remembers is wetness. Ground stays wet after rain stops, and that single number is all a save carries, because everything else is a function of the seed and the tick.
- The ocean is a height field, not a pile of physics bodies. One function answers where the surface is, and rendering, gameplay and any future physics all ask it. Wave position is fixed to the planet rather than to the floating origin, so the sea does not slide sideways when you walk two kilometres.
- Five water states, and the one that matters is the difference between standing and floating. A seventy five metre Jaeger wades through shallows, stands and fights chest deep on the shelf, floats over the deep, and can walk the sea bed if you tell it to. Getting that wrong would have it bobbing in five metres of water.
- Weather is not decoration. Fog and darkness cut how far anything can see, wet ground is slippery and ice is far worse, water slows you down, wind and rain spoil ranged accuracy, and lightning briefly gives the light back. All of it comes out of one place, so a value that is missing from it is visibly missing rather than quietly absent.
- Everything AI and combat will ask about the environment goes through one module that cannot reach the renderer at all. That is deliberate: the question "can I see that" must have the same answer in a test with no screen as it does in the game.
- Low, Medium, High and Cinematic quality, where every setting is a number something actually reads. The rule holding the table together is that lowering quality removes detail and never information: the code refuses to register a quality level that drops the lightning flash, the spray where something entered the water, the fog that explains why you cannot see, or the moving sea.
- A small synthesised ambience that filters down to almost nothing underwater, because underwater is not quieter, it is the loss of every high frequency. It ships no audio files and never will.
- Saves moved to version 3 to carry the clock and the wetness, with a migration that starts an older save at the same fresh morning a new world does rather than inventing a history for it.

Seven defects were found and fixed rather than written around. Four of them only appeared once there was something on screen.

The moon spent every night below the horizon. Its phase offset had the wrong sign, so a full moon sat eighty seven degrees underground at midnight. A test caught it before anything was drawn.

Fog was solved from the wrong constant. Exponential squared fog needs the square root of three over the visibility distance, not three, and using three squares the exponent: the whole scene faded to flat colour well inside the distance the game was telling itself it could see. It looked like the world had failed to load.

The debug camera sat seven kilometres back, which is further than visibility in most weather, so even correct fog would have been looking through more fog than air. It now sits at nine hundred metres.

A new session started at tick zero, which is midnight, while a migrated save started shortly after sunrise. Two starting states that disagreed, and the one a new player got was total darkness. Both now come from one constant.

Calling a thirty metre per second storm safe. The hazard test looked at visibility, grip and water and never at wind, which is the loudest hazard in a storm.

Rain sized to scale is invisible. A raindrop is a couple of millimetres, and rain the player cannot see fails as the telegraph it is supposed to be, so it is sized to be legible instead.

The walk buttons stepped a fixed kilometre, which steps clean over a coastline. The shelf between wading depth and open water is a few hundred metres wide, so at a kilometre it does not exist. The step is now selectable, and at a hundred metres the whole coast can be walked.

One more thing was changed for honesty rather than because it was broken. The browser tests were running eight files at once, and every test now starts a graphics context, a terrain worker and a set of particle systems. Eight of those together timed each other out and failed a different test on every run, none of them for a real reason. The suite now runs one file at a time. It is slower and it says the same thing twice.

## 2026-08-22, Milestone 05: sector streaming, procedural terrain, and world partition

The globe stopped being coordinates and became ground you can look at. Sectors now load, build, sleep and get thrown away as you move, and the terrain under them is generated rather than authored.

- Terrain is generated from noise hashed on the position of each sample rather than drawn from a random sequence. That sounds like an implementation detail and is the whole design: two sectors that share an edge have to agree on that edge no matter which one was built first, or whether the other was ever built at all. Shared edges match exactly, to zero, not merely closely.
- Noise is sampled in three dimensions on the sphere rather than in two per cube face. A per face field would seam along the twelve cube edges, and nothing hides a coastline that stops dead at a face boundary.
- Each sector carries a coast, a biome, city footprints, traffic lane markers, landmarks and a coarse height field the player stands on. None of it claims to be geography. The generator knows the latitude of a sample, a seeded moisture field and the authored regions, and nothing else.
- Sectors move through eight states: absent, queued, generating, cpu ready, gpu uploading, active, sleeping and evicting. Terrain data and meshes have separate lifetimes throughout. Dropping a sector frees its meshes and keeps its data in a size bounded cache, so turning around costs nothing and no mesh is ever kept alive merely because its data is cached.
- Heavy generation runs in a real worker behind a versioned, validated message protocol, with buffer handover instead of copying, a job queue, and cancellation that actually lands before a sector the player has flown past gets built. If a worker cannot be created the game generates on the main thread instead and says so on the panel rather than hiding it.
- Rings are square, three deep, 49 sectors resident and 25 of them drawn. Load order is ring distance first, then which way you are travelling, then anywhere you have said you are deploying to.
- Meshes are pooled by level of detail, buildings and traffic markers are thin instances, and the whole streaming system reports itself: every state count, generation and upload time, memory, cache hits, cancellations and evictions.
- Nothing about any of this is saved. Terrain is a pure function of the world seed, which saves already store, so a save regenerates the same world byte for byte without carrying a single vertex. Two streamers on one seed are asserted to agree; on different seeds, to differ.
- A deterministic stress route flies Hong Kong, Manila, Tokyo, Vladivostok and back, and runs identically headless in a test and live in the browser.

Nine defects were found and fixed rather than documented around. Six of them only showed up once there was something on screen to look at.

Two came from circular reasoning about content. Terrain that ignored authored regions put a Shatterdome underwater and turned the open ocean Breach into a 640 m mountain. Regions now tell the generator what they are, and the generator honours it without ever learning what a Shatterdome is.

One was a genuine module cycle. Moving the region to terrain mapping into the world layer made three files import each other in a ring, which left two constants undefined at startup and produced entire sectors of NaN heights, rendering as nothing at all. The mapping moved to the content layer, and a validator now names a bad anchor instead of quietly producing a sector of nothing.

Letting biome affect elevation made two adjacent sectors in different climate bands disagree by 25.6 m along their shared edge, which reads as a wall running down a sector boundary. Height is now one continuous global field and biome only decides how it is coloured.

Expanding rings through edge neighbours only produced diamonds, which left the four corners of the loaded area empty: a black notch in the middle distance where the ground stopped. Rings now include the diagonals and are square.

A fixed depth apron around each sector was shallower than the height difference between a sector and a coarser neighbour, so seams showed as black cracks. The apron is now sized from the relief of each sector.

Anchorage came out as a 500 m island inside a 3.5 km city, and every candidate building site was rejected as sea. The shaped ground now covers the whole radius of a region. The shelf height was then picked by measuring all eight regions across a range of values rather than by guessing.

The world panel grew tall enough that its buttons went off the bottom of the screen and then under the debug overlay, where they could not be clicked at all. Controls moved above the readouts, on the reasoning that readouts grow forever and buttons must stay reachable.

The panel refreshes four times a second in the ground view, and each refresh reset the destination dropdown to wherever the player already was. Choosing somewhere and pressing Teleport went nowhere. It now follows the world only when the world itself moves.

Terrain streams in after the player is already standing there, so the player kept the altitude they arrived with: zero, while the ground underneath read 169.8 m. The player now settles onto the ground as it arrives.

## 2026-08-21, Milestone 04: seamless miniature Earth coordinate system

Established the planet everything later stands on: how a position is expressed, how the globe is divided, and where the line falls between the part of the world being simulated in detail and the part that is only a record.

- Earth is a cube sphere, not a flat plane. Six cube faces divided into a 16 by 16 grid each, projected onto a sphere, giving 1,536 sectors of 9 to 12 km. A latitude and longitude grid was rejected because it has a singularity at each pole and cells that shrink to nothing near them.
- The globe is scaled to a fiftieth of real Earth, a radius of 127 km, while Jaegers and cities keep their real size. That is what miniature Earth means here. Hong Kong to Tokyo is 2,890 km in reality and about 58 km here.
- Positions are stored as latitude, longitude and altitude, and converted into a local east, north and up frame near the player. A single flat world space loses precision the further you get from its origin, which is exactly what a seamless planet provokes. Round trip error between the two is measured under a micrometre across the active bubble.
- Sector neighbours are found by stepping off the edge, projecting back onto the sphere, and asking which face the point landed on. The alternative, a hand written table of 24 edge adjacencies, is both the kind of name keyed branching the project bans and something that silently falls out of step with the face definitions. Tests check all 1,536 sectors have four distinct neighbours, that the relation is symmetric everywhere including the eight cube corners, and that walking neighbours from one sector reaches the whole globe.
- A floating origin keeps local coordinates small however far you travel. Walking 25 km keeps them capped at 2,000 m instead of climbing to 25,000. Rebasing changes no authoritative state at all: global positions stay geodetic and only the local projection moves, so a rebase cannot make anything teleport or explode.
- A globe map showing region markers, the player, the active sector and its four neighbours, with a full coordinate readout, plus teleport and walk controls.
- Eight strategic regions including Hong Kong, Tokyo, Sydney, Manila and Anchorage. Exactly one region is ever simulated in detail. Every other is a small record with integrity, safety and a last visited tick. The save format rejects any snapshot claiming two active regions, so the rule cannot be broken by a future code path.
- Saves moved to version 2 to carry world state, with a migration that places an older save at the documented start rather than inventing a position for it.

Four defects were found and fixed rather than written around.

Rebasing was first written as subtracting the anchor shift, which a test caught as wrong. Two tangent planes on a sphere differ by a rotation as well as a translation, so subtraction drifted 2.9 m across a 4 km rebase, which is a visible pop on a 75 m Jaeger and the exact thing this milestone forbids. Rebasing now goes back through the global position and is exact at any distance.

A plain cube sphere left corner sectors 2.31 times larger than face centre ones. Warping the grid before projection brought that to 1.35, so streaming cost barely depends on where you are.

Region radii sized like real metropolitan areas overlapped once the globe shrank, leaving four city pairs ambiguous about which region you were in. Radii now mean the dense combat core, capped by the tightest pair on the map.

Walking in a flat local frame lifted the player 239 m off the curved globe over 25 km. Movement now carries altitude across, keeping you on the ground.

Tests went from 193 to 253 unit and integration tests, and from 32 to 40 browser tests. Everything from the previous milestones still passes unchanged.

## 2026-08-21, Milestone 03: local save foundation, slots, autosaves and migrations

Persistence built before there is much to persist, so every later system inherits a settled serialization contract instead of inventing one.

- Saves go to IndexedDB, never localStorage, behind a `SaveRepository` interface. There is an IndexedDB implementation and an in-memory one, used by tests and as the fallback when the database cannot be opened.
- Named slots with metadata: name, world seed, play time, last played, simulation tick, app version and a thumbnail. Manual save, rename, overwrite and delete, plus a rotating three slot autosave ring.
- Every write rolls the previous contents into that slot's backup ring first, which doubles as the pre-migration backup: an old file is preserved untouched before anything upgrades it.
- Loading validates the record, and on any failure walks the backups newest first. Failure covers unreadable bytes, a migration that throws, a document that fails validation, and a checksum that no longer matches.
- Versioned save envelope with pure migration steps. Version 0 is a bare kernel snapshot, which is genuinely what the simulation has serialized since Milestone 01, so the migration path is exercised by a real artifact rather than an invented one. A fixture of it is loaded in tests and checked field by field for data loss.
- Export writes a slot to a JSON file. Import parses, migrates and validates before anything touches a slot, so a bad file cannot overwrite good data.
- Storage health panel reporting backend, record count, usage and quota, with plain warnings for near full storage, storage the browser may evict, and the memory only fallback.
- Saves contain authoritative simulation state and metadata, nothing else. Validation pushes the document through the state hash, which rejects functions, undefined values and cycles, so an engine object cannot reach a save file.

Two defects were found by manual verification and fixed rather than written around.

A damaged slot was being skipped in the slot list, which meant recovery was unreachable from the UI in exactly the case recovery exists for: with no row there is no Load button, so a perfectly good backup was stranded. Damaged slots are now listed, flagged, and described from the backup that would actually load.

Thumbnails came out solid black under WebGPU, whose swap chain is not a readable 2D source once a frame has ended. Capturing inside the render loop was tried first and measured still blank, so thumbnails now render through a render target, which works on both backends. Verified by decoding the stored image and sampling pixels.

Cycle detection was also added to the state hash, which the save validator relies on. A circular document previously failed only by running out of stack, which is slow and says nothing useful.

Tests went from 120 to 193 unit and integration tests, and from 19 to 32 browser tests. Everything from the previous milestones still passes unchanged.

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
