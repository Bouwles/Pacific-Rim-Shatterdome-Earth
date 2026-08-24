# IMPLEMENTATION_STATE.md

Read this, [GAME_SPEC.md](GAME_SPEC.md), [ROADMAP.md](ROADMAP.md), and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before touching code.

## What currently works

- `npm install` → `npm run dev` boots a Vite dev server. WebGPU-first engine selection with a WebGL fallback, both paths observed rendering (WebGPU manually, WebGL via Playwright's Chromium).
- Application state machine with 8 states and a data-driven transition graph; reachable today: Boot → MainMenu → Loading → Shatterdome → MainMenu, MainMenu ↔ AssetGallery / Saves / WorldMap, Shatterdome ↔ Saves, plus Boot → Error on fatal boot failure.
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
- **Sector streaming with procedural terrain**, running live in a ground view on the world screen:
  - an eight-state sector lifecycle (absent, queued, generating, cpu-ready, gpu-uploading, active, sleeping, evicting) that never blocks the render loop;
  - seeded terrain generated from noise hashed on sample position, so neighbouring sectors agree exactly along shared edges and generation order cannot change a result;
  - coast, biome, city cells, traffic lane markers, landmarks and a collision height field, all derived from the world seed and the authored region anchors;
  - square LOD rings three deep: 49 sectors resident, 25 visible at levels of detail 0 to 2, an outer preload ring uploaded and slept;
  - generation in a real Web Worker behind a versioned, validated message protocol, with buffer transfer, a job queue, working cancellation, and an inline fallback that is reported rather than hidden;
  - mesh pooling, thin instances for buildings and traffic, and skirts sized from each sector's own relief so LOD seams do not show;
  - deterministic cache keys and a byte-bounded LRU cache holding data only, so turning around never regenerates and never keeps a mesh alive for the sake of cached data;
  - priorities by ring depth, direction of travel and declared deployment target; eviction deferred one update so a boundary wobble is rescued rather than rebuilt;
  - live instrumentation for every state count, generation and upload time, memory, cache hits, cancellations and evictions;
  - a deterministic stress route that runs identically headless and in the browser.
- **Day, weather, atmosphere and ocean**, running live and readable from a panel in both world views:
  - a world clock driven by simulation ticks, one tick to one in-game second, so pausing the simulation pauses the sun and a save reproduces the sky it was written under;
  - sun and moon with real seasons, latitude behaviour, twilight and moon phase, driving a single scene sun rather than a second light;
  - seeded weather fronts in fixed six-hour slots, looked up in constant time at any tick, holding steady then crossfading, per climate zone;
  - rain, storms, fog, snow, wind, cloud cover, lightning, wetness and spray, all derived from one sample;
  - ocean waves as a sampled height field shared by gameplay and rendering, with depth zones, shoreline transitions, buoyancy hooks and underwater fog;
  - five water states with the standing-versus-floating distinction that matters at Jaeger scale, all five reached in the running game;
  - a synthesised ambient audio bed filtered by water state, which reports whether the browser actually let it start;
  - an environment query surface for AI and combat that imports no render code and returns visibility, traction, movement, wind push and ranged accuracy penalty;
  - Low through Cinematic quality presets with explicit particle, reflection, shadow and water budgets, and a registry that refuses a preset which drops a required telegraph.
- **A living Hong Kong**, built from a district grammar and running in the ground view:
  - seven districts placed as wedges from the region's seaward bearing, so the plan rotates with the coast rather than being pinned to north;
  - 710 blocks and 1,480 towers, with a real skyline: downtown is the tallest district, the slums stack four small towers to a block, the docks are low and regular;
  - fourteen landmark slots, roads, harbour lanes, air corridors, evacuation zones with muster points on the high ground, seventeen defence positions, and walking and Jaeger deployment routes;
  - 135 destruction groups, one mesh each, so the city is streamable and damageable in pieces rather than being one mesh;
  - five alert levels driving civilian, vehicle, shipping, aircraft and military activity, sirens, and an evacuation that fills muster points and empties again during recovery;
  - activity expressed as densities per district rather than as agents, so a district of ninety thousand people costs one sample;
  - pooled thin-instance agents whose count comes from those densities and a quality budget, with per-kind counts reported because a total hides what an alert actually changes;
  - alert level and evacuation progress saved per region, with the layout itself derived from the seed and never stored.
- **A Shatterdome you walk around**, entered from New Game rather than from a placeholder screen:
  - thirteen facilities as a grammar of tiers, each with a footprint, a deck, stations, a construction time, a crew cost, a power draw and one sentence about what the tier buys;
  - power from the reactor and crews from logistics as the two real constraints, so a laboratory can be refused because the reactor cannot carry it and a third order because nobody is free to build it;
  - rooms generated from the facility records, one built at a time, with doors, lifts and trams as real edges with real travel times and a short fade at the swap;
  - a doorway to a facility that has not been built is sealed and says which one, and becomes a usable door the moment that build lands;
  - keyboard and mouse movement at person scale with collision, wall sliding, run and crouch, an unstuck action that always lands somewhere clear, and a pause that stops the simulation rather than hiding it;
  - interaction focus by looking or by cycling with Tab, so the whole interior is playable without a mouse, with the prompt mirrored to a screen reader;
  - management at in-world terminals: every facility with its live numbers, the next tier with its cost, and an Order button that carries the reason when it cannot be pressed;
  - berths that resolve roster machines through the asset pipeline, and a Conn-Pod whose instruments read the live world outside;
  - staff as one number per facility outside the active room and as pooled instances inside it, with named crew whose lines are filled from real facility state;
  - facilities, construction progress, interior position and the selected machine saved at envelope version 5.
- **A Jaeger you can drive**, taken out from the world map's ground view:
  - one controller shared by every machine, with all the difference between a heavy tank and an agile frame expressed as a profile of speeds, acceleration, braking, turn rates, step height, slope limit, stride, booster and get-up time;
  - twenty locomotion states as a table, resolved in priority order rather than by a switch: idle, start, walk, run, strafe, guard, turn in place, stop, step up, fall, land, wade, swim, underwater, booster, knockback, knockdown, get up, disabled leg and death;
  - mass communicated by acceleration, braking, turn authority and stride rather than by camera shake: a machine takes seconds to reach a walk, keeps rolling when the stick is released, and turns badly at a run;
  - footfalls spaced by ground actually covered, which is the animation contract an animation system will read, and the measurement that proves the feet are not skating;
  - predictive ground queries that step over debris, climb a ledge inside the frame's step height, refuse a cliff face and fall off an edge, with the landing impulse handed to the camera;
  - three camera rigs, chase, combat and Conn-Pod, framed from the machine's own height, with comfort controls for motion, reduced motion, field of view, invert look and sensitivity, and a rig switch that keeps heading, pitch, lock and comfort;
  - buffered input, so a press made slightly too early still fires and one made while knocked down expires unused;
  - scale communicated in the world: eight-metre street lights along the path, aircraft and birds crossing, footprints that stay on the ground, dust sized by the landing, and sound that arrives late at 343 m/s.
- **A combat framework both sides use**, reachable by spawning a target while piloting:
  - every attack is a row of data: phase lengths in ticks, a movement curve, how much turn authority survives it, armour, which tags it cancels into and when, which volumes are live on which ticks, one typed damage packet, and what it costs in stamina and heat;
  - hit detection sweeps volumes rather than sampling them, interpolating both the volume and the target, with an overlap history so one volume connects with one target once;
  - a kaiju is body zones with their own health, armour, damage multiplier and consequence, exactly one of which ends it;
  - targeting at four levels: soft targeting, an explicit lock that survives a camera change, cycling left to right across the screen, and aim mode that picks a body zone;
  - reactions as a shared table, with poise gating staggers so a heavy attack cannot hold a creature down for a whole fight;
  - stamina, heat and an overheat lockout, all derived from the machine's own mass and cooling rather than authored per fighter;
  - every event carries a tick, a volume, a zone, a packet and, for a refusal, a reason in words, which is the debug view rather than a picture of one.
- **A close-range vertical slice on top of that framework**:
  - light and heavy chains, directional variants of the heavy, and one charged attack whose damage scales with the wind-up;
  - dodges with invulnerable frames in the middle rather than the front, a real stamina cost and a real recovery, cancelling only out of moves that list an evade;
  - blocks with a perfect window, parries that answer with a free counter, and five graded outcomes each with a coaching line written for a player;
  - grapples with eligibility checks, a struggle meter both sides push on, throws, wall slams and safe failure when there is no room, plus the rule that something being held cannot swing;
  - environmental weapons as tagged props, where one move covers every prop and the prop's own mass, reach, damage and durability do the rest;
  - finishers as short beat machines with camera framings, held-input checks, interruption, banked damage, and a space query that refuses to start one anywhere unsafe;
  - a move list written from the move table, in plain language with no frame data anywhere in it, and a coaching line that says what just happened;
  - reduced camera motion, hold-to-complete and skip-sequences, all producing the same outcome.
- **Ranged weapons on the same framework**, on the number row while piloting:
  - seven weapons across eight behaviours (projectile, beam, cone, arc, salvo, mortar, tether, channel) in one table, with magazines, reserves, reloads, cooldowns, heat, reactor draw, recoil, spread, aim restrictions, underwater modifiers and friendly fire;
  - firing that is never free: a weapon costing no ammunition, no heat and no reactor draw is refused when the registry is built, so permanent damage per second cannot be written by accident;
  - refusals in plain language for range, minimum range, forward arc, missing lock, empty magazine, reloading and cooling, on the coaching line and in the log;
  - a fixed projectile pool sized by the quality preset (48 to 320), swept against the same geometry a fist is, arcing for indirect fire, and refusing rather than growing when it is full;
  - a 2,400 m combat bubble and a twelve second lifetime, so nothing is simulated outside the fight it belongs to;
  - five status effects running on the combat clock, with water putting out what burns and corrodes;
  - pure weapon scoring that gives an AI, a coaching hint and a test the same answer plus a sentence of reasoning;
  - a ranged row on the pilot panel showing each weapon's magazine, spares and state, live rounds against the ceiling, and what is running on the target;
  - rounds drawn as thin instances on one pooled mesh, so a whole barrage costs one draw call.
- **Damage that outlives the fight**, on every machine on the roster:
  - eight components per machine (Conn-Pod, sensor mast, torso, reactor, two arms, two legs), each with its own structure, armour, placement, states and consequence for being lost;
  - damage-kind routing, so a neural weapon is worth three times as much against a Conn-Pod as against a leg without either knowing about the other;
  - systems and weapon mounts that go with the component carrying them: a lost right arm silences the weapons on it, by name and in words;
  - a lost leg that slows the walk and the turn through the same profile the shared controller reads, and forces a tow home rather than a walk;
  - scars as four numbers with the debris grown from a seed, bounded at twenty-four and keeping the worst, so nothing about visible damage is ever saved as geometry;
  - a roster that never deletes a machine: coming home is ready, in the gantries, towed, or rebuilt, decided by the damage itself;
  - a repair board on each berth with every component, what is offline, the marks it wears, and a work order priced and timed from the damage, worst component first;
  - a shift of work you can put in, which finishes components, clears their marks and signs the machine off;
  - a save section carrying status, hours owed, sorties and one fraction per component, with maximum health taken from the build rather than the file on load.
- Tooling: `typecheck`, `lint`, `format`/`format:check`, `test` (912 unit+integration), `smoke` (112 Playwright), `build` all pass.

## What is stubbed / placeholder

- The Jaeger placeholder box and Shatterdome screen are labeled placeholders. Clicking through to "Shatterdome" says "Not yet implemented" rather than faking a system.
- Assets exist only in the gallery. Nothing in the boot scene or the simulation uses a manifest yet, and no entity is bound to an asset. The placeholder box in the boot scene is still the old hard-coded one from Milestone 00.
- Animation tags, audio slots and portrait slots are declared, validated and carried through the pipeline, but nothing plays animation, audio or portraits. There is no animation system and no audio system.
- The gallery's damage slider is a presentation preview, not the component damage model. It tints and detaches parts by distance from centre; it does not track armour, subsystems or persistence.
- Collision proxies are declared in manifests but unused, since no physics backend is wired.
- Saves persist the simulation kernel only, because that is all the authoritative state that exists. There is no economy, roster, research or Shatterdome state to save yet; those extend `RootSave` as they arrive.
- Loading a save whose world seed differs from the running session reports what to do (reload with `?seed=`) instead of switching worlds. Restoring across seeds needs a kernel rebuild, which belongs with the milestone that introduces a real new-game flow.
- Autosave rotation is implemented and tested but nothing triggers it automatically yet; no gameplay event exists that would warrant one.
- Terrain is broad-strokes landform, not geography. The generator knows a sample's latitude, a seeded moisture field and the authored region anchors, and nothing else. Real coastlines, mountain ranges, rivers and city footprints are not reproduced and no accuracy is claimed.
- Melee is one machine's moveset. Weapon-specific branches exist as a field on the move table and as the environmental prop path, but no Jaeger carries its own weapon set yet.
- A grapple has no ground follow-up beyond the throw and the slam: there is no ground game once a target is down.
- Kaiju behaviour does not exist. The creature attacks on a fixed cadence, which the panel and the code both call a schedule rather than an attack director.
- A machine has one hull zone rather than per-component armour, so component damage lands on a single number. The zones exist on the creature side and the same code path will carry the machine's when its milestone comes.
- Nothing about a fight is saved. Damage that outlives a battle arrives with the per-component damage milestone.
- No hit stop, no damage numbers in the world, and no grapples or ranged weapons: the move table has the kinds, but only melee rows are shipped.
- A piloted machine has no animation: the controller emits a stride phase and footfalls, and the model is moved as one rigid body. Binding a skeleton to that contract is a later milestone.
- Nothing to fight and nothing to hit. Target lock exists on the camera and reports honestly that there is nothing in range, because kaiju and attacks arrive with the combat milestone.
- The Conn-Pod camera sits inside the head and looks out; there is no cockpit interior geometry around it yet.
- A piloted machine is a live session and is not saved. Leaving the machine puts the player back where it stood, which the world already saves, but the machine's own state does not survive a reload.
- The interior is boxes: rooms are shells, fixtures and crew are instanced blocks, and there are no interior models yet. Only the Jaeger bay resolves real assets, and those are the procedural placeholders.
- Staff have no collision, so a player can walk through a crew member. They also do not react to being spoken to beyond a line of radio.
- Facility benefits are sentences, not systems. A tier changes power, crews, staff and fixtures; nothing yet reads "shortens every repair" because repair, research and manufacture have no mechanics behind them.
- There is no economy. Construction costs time, crews and power, and nothing else, because money and contracts arrive with a later milestone.
- The Conn-Pod has instruments and no controls. Boarding a machine does not deploy it, and the panel says so.
- The complex has one layout. Facility footprints, decks and connections are authored, so a player cannot lay out their own base.
- City blocks are instanced boxes standing in for buildings. They carry a destruction group id and a landmark slot names a manifest id, but nothing resolves an asset yet, and there are no interiors or damage states.
- Only Hong Kong has a city. Every other region has `cityPlanId: null` and stays a strategic record, which the panel says plainly rather than showing an empty city.
- Nothing raises an alert on its own. The alert buttons are debug controls; the attack director that would drive them does not exist.
- Destruction groups are grouped and drawn separately but nothing damages them yet. The structure is in place; the damage model is not.
- Agents are boxes on polylines with no collision, no avoidance and no destination. They read as traffic at distance and would not survive close inspection.
- The city is sparse at a distance on Medium: 620 towers spread over a twelve kilometre region reads as a scattered skyline rather than a dense one. Raising the budget fills it in and costs frame time; the layout is right and the fill is thin.
- Groups are drawn nearest-first from the region centre rather than from the player, so walking to the edge of the city does not shift the budget toward where you are looking.
- The region centre itself is open ground: the district plan starts at a tenth of the radius, so a player spawning at the centre stands in the harbour mouth rather than among towers.
- Traffic is a static representation: markers spaced along generated lanes. Nothing moves, routes or reacts. There is no traffic simulation.
- Collision detail is a height field the player settles onto. There is still no physics backend, so nothing collides with anything except the ground, and only through direct height sampling.
- Streamed sectors are visual and navigational only. No gameplay system reads them: no spawning, no line of sight, no cover, no destruction.
- A city sector whose region radius approaches the sector size comes out entirely land, with its coast in the neighbouring sector. Tokyo, at a 7 km radius in an 11 km sector, is the case that shows this.
- Walking is a debug control that steps 1 km per click, not a player controller. There is no on-foot movement and no Jaeger in the world view.
- Weather affects the numbers gameplay reads, but nothing reads them yet: there is no AI, no combat and no player controller to slow down, blind or slip over. The effects are computed, tested and exposed rather than consumed.
- Buoyancy is a tested force calculation with no solver behind it, because no physics backend is wired. Nothing floats by simulation; floating is resolved by a height comparison.
- Traffic markers, city blocks and the player marker are unaffected by weather. Nothing gets wet, nothing sways in wind, nothing casts spray but the water itself.
- Ambient audio is one synthesised bed with a filter. There are no positional sources, no events and no mixer, so it is atmosphere rather than a sound system.
- Cloud cover is a single translucent layer, disabled at Low quality. There is no cloud shadowing and no volumetric anything.
- Reflection modes are declared per preset and reported, but nothing yet renders a reflection: the field is wired to the budget, not to a reflection probe.
- Wetness follows the player rather than being recorded per region, so walking from a storm into a desert carries the wet ground with you until it dries.
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
- City: [src/world/cityLayout.ts](src/world/cityLayout.ts), [cityActivity.ts](src/world/cityActivity.ts), [src/data/districts.ts](src/data/districts.ts), [src/engine/cityView.ts](src/engine/cityView.ts)
- Combat: [src/combat/](src/combat/), [src/data/moves.ts](src/data/moves.ts), [src/data/kaiju.ts](src/data/kaiju.ts), [src/engine/combatView.ts](src/engine/combatView.ts), [src/debug/combatScenario.ts](src/debug/combatScenario.ts)
- Jaegers: [src/jaegers/](src/jaegers/), [src/engine/jaegerView.ts](src/engine/jaegerView.ts), [src/engine/pilotInput.ts](src/engine/pilotInput.ts), [src/ui/pilotScreen.ts](src/ui/pilotScreen.ts), [src/debug/jaegerScenario.ts](src/debug/jaegerScenario.ts)
- Shatterdome: [src/shatterdome/](src/shatterdome/), [src/data/facilities.ts](src/data/facilities.ts), [src/data/personnel.ts](src/data/personnel.ts), [src/engine/interiorView.ts](src/engine/interiorView.ts), [src/ui/shatterdomeScreen.ts](src/ui/shatterdomeScreen.ts)
- Environment: [src/world/worldClock.ts](src/world/worldClock.ts), [weather.ts](src/world/weather.ts), [ocean.ts](src/world/ocean.ts), [environment.ts](src/world/environment.ts)
- Environment content: [src/data/climates.ts](src/data/climates.ts), [src/data/quality.ts](src/data/quality.ts)
- Environment rendering and audio: [src/engine/skyView.ts](src/engine/skyView.ts), [weatherView.ts](src/engine/weatherView.ts), [ambientAudio.ts](src/engine/ambientAudio.ts)
- Terrain and streaming: [src/world/terrain.ts](src/world/terrain.ts), [terrainNoise.ts](src/world/terrainNoise.ts), [sectorStreaming.ts](src/world/sectorStreaming.ts), [terrainService.ts](src/world/terrainService.ts)
- Terrain worker: [src/workers/terrainWorker.ts](src/workers/terrainWorker.ts), [protocol.ts](src/workers/protocol.ts), [terrainWorkerClient.ts](src/workers/terrainWorkerClient.ts)
- Sector rendering and stress route: [src/engine/sectorRenderer.ts](src/engine/sectorRenderer.ts), [src/debug/streamRoute.ts](src/debug/streamRoute.ts)
- Saves: [src/saves/schema.ts](src/saves/schema.ts), [migrations.ts](src/saves/migrations.ts), [repository.ts](src/saves/repository.ts), [indexedDbRepository.ts](src/saves/indexedDbRepository.ts), [saveService.ts](src/saves/saveService.ts), [storageHealth.ts](src/saves/storageHealth.ts)
- Save UI and browser glue: [src/ui/saveScreen.ts](src/ui/saveScreen.ts), [src/app/saveController.ts](src/app/saveController.ts)
- Model drop point: [public/assets/models/README.md](public/assets/models/README.md)
- DOM screens: [src/ui/screens.ts](src/ui/screens.ts)
- Tests: [tests/unit/](tests/unit/), [tests/integration/](tests/integration/), [tests/e2e/](tests/e2e/)
- Docs: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/CONTENT_SCHEMA.md](docs/CONTENT_SCHEMA.md), [docs/PERFORMANCE_BUDGETS.md](docs/PERFORMANCE_BUDGETS.md), [docs/CONTROLS.md](docs/CONTROLS.md)

## Active technical risks

- Bundle size / code-splitting still undecided. The terrain worker is now a second entry point, which is the first real module boundary to split along; revisit when a third appears.
- Context-loss recovery wired but unverified end-to-end.
- WebGPU-vs-WebGL parity beyond this scene (post-process, GUI) unchecked.
- Entity iteration relies on Map insertion order being deterministic given deterministic commands. True today; if a future system iterates in a data-dependent order, canonical id sorting will be needed in `each()`, not just in `serialize()`.
- The GLB load path has never run against a real GLB file, because no model exists to test with. Its validation logic is unit tested against synthetic inspection data, and its failure path is exercised constantly, but the success path is unverified. First real model installed will be the real test of it.
- The gallery borrows the boot scene rather than owning one. Fine for two environments; a real scene lifecycle will be needed once the Shatterdome interior and a combat map both exist.
- Quota exhaustion and a genuinely blocked IndexedDB (real private window) are implemented and unit tested through the repository interface, but neither has been reproduced in a live browser.
- City density and district proportions are tuned by measurement and by looking at the result, not by art direction. They will want a proper pass once someone judges how the city should read.
- The sun and moon model ignores the equation of time and assumes a circular orbit, so it is a few minutes off a real almanac. Fine for "the sun is lower in winter"; not fine if anything ever needs real astronomical time.
- Terrain shape is tuned by measurement, not by art direction. The land-mask target was picked by sweeping values and reading city elevation and water fraction across all eight regions; it will want a proper pass once anyone judges how the world should look.
- Streaming has only been measured on one machine, on WebGPU, at 144 fps with a frame budget the work never came close to filling. Generation at 0.4 ms and upload at 0.2 ms leave no evidence about behaviour on a slow machine, and the one-upload-per-frame pacing has never actually been the constraint.
- Shadow stability under a moving Jaeger is unverified, because no Jaeger exists in the world view. Only the mechanism that prevents jitter, local coordinates bounded at 2,000 m, is confirmed. Physics behaviour across a rebase is likewise unverified with no physics backend wired.
- `src/world/**` uses trigonometry, which the kernel is forbidden from doing. Cross-engine bit-identical replay would not survive world movement becoming authoritative; see TECH_DECISIONS.md for the mitigation path.
- Save documents are not encrypted or signed. The checksum detects accidental corruption and casual tampering, not deliberate editing; a player who wants to edit their own save can.

## Exact next task

Start Phase 2 (ROADMAP.md): the on-foot player controller and the first real Shatterdome interior. This is the first consumer of the `shatterdome.jaeger-bay` asset and the point where an entity is bound to an asset manifest. It is also the first milestone that needs a real scene lifecycle, since the hub, the globe and the boot scene are genuinely different environments.

The pieces it builds on all exist now: positions are geodetic and the Shatterdome sits at a known region centre, the floating origin keeps local coordinates small, `RootSave` version 3 already carries world and environment state, the streamed ground gives the controller real terrain and a real height field to stand on, and the environment already computes the traction, movement and water-state multipliers a controller has to obey. Extend `RootSave` for hub state rather than adding a parallel store, put the player controller behind the same tangent-frame conversion the world screen already uses, take ground height from `SectorStreamer.sampleGroundHeight`, and give the creature behaviour rather than a cadence, and give the machine components rather than a hull.
Melee now has enough vocabulary for a real fight, so what the creature lacks is the part that chooses
between answers.
The arena already resolves both sides, already reports every hit by zone, and already carries the reactions a
behaviour would choose between; what it lacks is anything deciding what the creature does. Per-component
damage is the other half: the zone path exists and the machine currently uses one zone through it, so
splitting a Jaeger into head, torso, arms, legs and weapons is data plus a save section rather than new code.
