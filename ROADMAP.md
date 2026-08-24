# ROADMAP.md

Read [GAME_SPEC.md](GAME_SPEC.md) before changing anything here. Status values: `done`, `in-progress`, `blocked`, `not-started`.

## Phase 0 — Project bootstrap and render pipeline smoke test

**Depends on:** nothing.
**Status:** done.
**Acceptance tests:**

- `npm install` succeeds with no manual credential setup.
- `npm run dev` serves the app; browser shows a rendered 3D scene (placeholder ground + rotating box) with no console errors.
- `npm run typecheck` passes.
- `npm run build` produces a `dist/` bundle.
- Engine picks WebGPU when available, falls back to WebGL otherwise, without crashing either path.
  **Next action:** none — complete. Proceed to Phase 1.

## Phase 1 / Milestone 00 — Core architecture skeleton + truthful first frame

**Depends on:** Phase 0.
**Status:** done.
**Scope:** state machine (Boot/MainMenu/Loading/Shatterdome/Deployment/Combat/Results/Error), engine
adapter (WebGPU-first/WebGL-fallback, resize, context-lost/restored, disposal), fixed-step simulation
clock, seeded RNG, data-registry pattern with a placeholder Jaeger entry, diagnostics panel, DOM screens
for MainMenu/Loading/Shatterdome-stub/Error, ESLint + Prettier + Vitest + Playwright tooling. Created
`src/app/`, `src/engine/`, `src/simulation/`, `src/data/`, `src/ui/`, `tests/unit/`, `tests/integration/`,
`tests/e2e/`, `docs/` — each with real content, per the "grow-into" convention in TECH_DECISIONS.md.
**Acceptance tests:**

- Simulation runs on a fixed timestep independent of render framerate — proven by unit tests on
  `FixedStepClock` (deterministic step counts, epsilon-safe boundary handling, substep clamp).
- State machine transitions Boot → MainMenu → Loading → Shatterdome → MainMenu, all covered by an
  integration test on the full transition graph.
- A registry module (`ContentRegistry<T>`) loads a typed content table (placeholder Jaeger entry) with
  validation and no switch-on-name logic.
- Unit tests cover the fixed-step accumulator, RNG determinism, and registry lookup/validation.
- `npm run typecheck`, `lint`, `format:check`, `test`, `build`, `smoke` (Playwright) all pass.
- Manually verified in-browser: WebGPU path renders, diagnostics panel shows live backend/version/fps/draw
  calls, New Game → Shatterdome-stub → Back to Menu works, console stays clean.
  **Next action:** none — complete. Proceed to Phase 2.

## Phase 1.5 / Milestone 01 — Deterministic simulation kernel and developer diagnostics

**Depends on:** Phase 1 / Milestone 00.
**Status:** done.
**Scope:** fixed-step loop with transport controls, named RNG streams, versioned serializable
commands/events, entity identity + component registry, deterministic state hashing, headless scenario
runner, and a real debug overlay. Created `src/entities/`, `src/debug/`, `src/app/config.ts`; extended
`src/simulation/`; moved `engine/diagnosticsPanel.ts` → `debug/overlay.ts`.
**Acceptance tests:**

- Same seed + command sequence produces the same final state hash across repeated runs; different seed or
  different commands produces a different hash (integration tests on both the kernel and the scenario runner).
- Pause, single-step, slow motion, and resume all work from the debug panel — covered by Playwright and
  re-verified manually on the WebGPU path.
- A long inactive tab does not spiral: delta clamped to `MAX_FRAME_DELTA_MS` plus a sub-step cap. Measured a
  4-second stall advancing ~25 ticks rather than 240.
- Kernel state round-trips through serialize/restore with an identical hash and continues deterministically.
- `npm run typecheck`, `lint`, `format:check`, `test` (84), `smoke` (10), `build` all pass.
  **Next action:** none — complete. Proceed to Phase 2.

## Phase 1.75 / Milestone 02 — Asset manifest and procedural placeholder factory

**Depends on:** Milestone 01.
**Status:** done.
**Scope:** typed asset manifests with provenance and licensing, eight parameterised procedural generators
covering all seven asset classes, named attachment sockets, GLB validation against manifest and budget,
model-first resolution with a generator fallback, and an asset gallery for inspection. Created
`src/assets/`, `src/data/assets.ts`, `src/debug/gallery.ts`, `src/ui/galleryScreen.ts`,
`src/app/galleryOverrides.ts`, `public/assets/models/`.
**Acceptance tests:**

- A missing production model falls back to the placeholder and logs one actionable warning per asset,
  naming the path and the fix. Verified in tests and in the browser across all twelve assets.
- A manifest override swaps materials and source while collision, sockets, nominal height, animation tags
  and asset class stay byte-identical, and the simulation hash is unchanged.
- The gallery loads all twelve assets, measures each from its built geometry, and reports budget status.
- `npm run typecheck`, `lint`, `format:check`, `test` (120), `smoke` (19), `build` all pass.
  **Next action:** none — complete. Proceed to Phase 2.

## Phase 1.9 / Milestone 03 — Local save foundation, slots, autosaves, and migrations

**Depends on:** Milestone 01 (kernel snapshots), Milestone 02 (asset pipeline unaffected).
**Status:** done.
**Scope:** IndexedDB persistence behind a `SaveRepository` interface, versioned save envelope, pure
migration steps with an old-version fixture, manual saves, a rotating autosave ring, backup rotation that
doubles as the pre-migration backup, corruption recovery, export and import with validation, a storage
health panel, and user-facing errors. Created `src/saves/`, `src/ui/saveScreen.ts`,
`src/app/saveController.ts`, `tests/fixtures/saves/`.
**Acceptance tests:**

- Create, rename, overwrite, export, delete and import separate slots, all verified in tests and in the
  browser against real IndexedDB.
- A deliberately corrupted primary recovers from the newest valid backup, verified in unit tests, in
  integration tests over real IndexedDB, and by hand in the browser by wrecking a live record.
- Migration tests load the version 0 fixture into the current schema with every simulation field intact.
- `npm run typecheck`, `lint`, `format:check`, `test` (193), `smoke` (32), `build` all pass.
  **Next action:** none — complete. Proceed to Phase 2.

## Phase 1.95 / Milestone 04 — Seamless miniature Earth coordinate system

**Depends on:** Milestone 01 (kernel), Milestone 03 (saves).
**Status:** done.
**Scope:** scaled cube-sphere globe with stable sector ids and reprojection-based neighbour lookup,
geodetic global coordinates with local tangent frames, floating origin with exact rebasing, a low-detail
globe map with an active sector and full coordinate readouts, and a strategic-versus-active simulation
boundary. Created `src/world/`, `src/data/regions.ts`, `src/debug/globeView.ts`, `src/ui/worldScreen.ts`.
Raised the save envelope to version 2 with a real migration for the new world section.
**Acceptance tests:**

- Travel across several sector boundaries with the player stable: a 25 km walk crossed three sequential
  sectors, kept latitude strictly monotonic, and capped local coordinates at the 2,000 m rebase threshold
  instead of reaching 25,000 m.
- Teleport among Hong Kong, Sydney, Tokyo, Anchorage and Manila and recover the correct region and climate,
  verified in tests and by hand. The five land in five distinct sectors across three cube faces.
- Round-trip conversion error between global and local bounded under a micrometre across the active bubble.
- `npm run typecheck`, `lint`, `format:check`, `test` (253), `smoke` (40), `build` all pass.
  **Next action:** none — complete. Proceed to Phase 2.

## Phase 1.97 / Milestone 05 - Sector streaming, procedural terrain, and world partition

**Depends on:** Milestone 04 (coordinates, sectors, floating origin).
**Status:** done.
**Scope:** asynchronous sector lifecycle across eight states, seeded procedural terrain with coast and
biome identity, LOD rings with thin instances and mesh pooling, cancellation tokens, memory budgets,
velocity and deployment-target priorities, generation moved into a typed worker, deterministic cache
keys, and full instrumentation. Created `src/workers/`, `src/world/terrain*.ts`,
`src/world/sectorStreaming.ts`, `src/engine/sectorRenderer.ts`, `src/data/biomes.ts`,
`src/debug/streamRoute.ts`. Added a ground view to the world screen.
**Acceptance tests:**

- Flying rapidly does not freeze the main thread or leak sectors: 24 s of the stress route advanced
  1,443 simulation ticks, that is a full 60 per second, at 144 fps with a worst frame of 0.3 ms.
  A leak-checking sink asserts every uploaded sector is released exactly once.
- Turning around reuses cache data and regenerates nothing: laps two and three of the route generated
  zero new sectors, with cache hits climbing 253, 709, 1,165 and identical content digests.
- Stable memory across repeated load and evict cycles: resident, cached and scene figures were byte
  identical across three laps, at 0.16 MB resident and 1.26 MB cached in 252 entries.
- `npm run typecheck`, `lint`, `format:check`, `test` (332), `smoke` (49), `build` all pass.
  **Next action:** none - complete. Proceed to Phase 2.

## Phase 1.98 / Milestone 06 - Day, weather, atmosphere, and ocean foundation

**Depends on:** Milestone 04 (coordinates), Milestone 05 (streamed terrain and collision heights).
**Status:** done.
**Scope:** tick-driven world clock with sun and moon, seeded weather fronts with smooth transitions,
rain, storms, fog, snow, wind, cloud, lightning, wetness and spray, ocean wave sampling with depth
zones and water states, buoyancy hooks, underwater fog and audio, an environment query surface for AI
and combat that imports no render code, and Low through Cinematic quality presets with explicit
budgets. Created `src/world/worldClock.ts`, `weather.ts`, `ocean.ts`, `environment.ts`,
`src/data/climates.ts`, `quality.ts`, `src/engine/skyView.ts`, `weatherView.ts`, `ambientAudio.ts`,
`src/debug/environmentScenario.ts`. Raised the save envelope to version 3 with a real migration.
**Acceptance tests:**

- Time and weather advance deterministically from debug controls and survive save and load: the debug
  scenario produces an identical digest across runs and a different one per seed, and a browser round
  trip restores the same in-game hour and the same front.
- Entering water transitions correctly: all five states were reached in the running game. Wading at
  Manila in 20.9 m of water at 28 percent submerged, surface combat on the shelf at 56.7 m and 76
  percent, swimming over 101.7 m of shelf, underwater at the Breach with visibility capped at 14 m,
  and dry on land.
- Low quality stays readable: every preset carries all four required telegraphs, asserted in a unit
  test and read off the panel in the browser at Low and at Cinematic. Live particles scale from 35 at
  Low to 1,519 at Cinematic on the same storm.
- `npm run typecheck`, `lint`, `format:check`, `test` (437), `smoke` (59), `build` all pass.
  **Next action:** none - complete. Proceed to Phase 2.

## Phase 1.99 / Milestone 07 - Hong Kong vertical slice and living city layer

**Depends on:** Milestone 05 (streamed terrain and collision heights), Milestone 06 (time, weather,
quality presets).
**Status:** done.
**Scope:** an original stylised Hong Kong built from a district grammar, with city blocks, landmark
slots, roads, harbour lanes, air corridors, evacuation zones, defence positions, destruction groups
and two deployment routes; civilian, shipping, aircraft and military activity that responds to time,
weather, alert level, evacuation, damage and recovery; pooled agent instances rather than AI
civilians; and alert state saved per region. Created `src/data/districts.ts`,
`src/world/cityLayout.ts`, `src/world/cityActivity.ts`, `src/engine/cityView.ts`,
`src/debug/cityScenario.ts`. Raised the save envelope to version 4 with a real migration.
**Acceptance tests:**

- Recognisable by silhouette and activity: 710 blocks and 1,480 towers across seven districts, with
  downtown asserted to be the tallest and the slums asserted to stack more, smaller towers. Fourteen
  landmark slots, each naming the asset manifest id it will host.
- An alert changes the city: at Hong Kong on Medium, going from calm to attack took civilians from
  26 percent to 4, shipping from 31 to 2, military from 15 to 100, sounded the sirens, and started
  the evacuation. The agent pool rebalanced from 107 vehicle and 45 crowd to 196 vehicle and 7 crowd.
- Within budgets on Medium: 620 towers in 31 of 135 destruction groups, 53 city meshes, 0.09 MB, 74
  draw calls, 1.0 ms frames at 143 fps.
- `npm run typecheck`, `lint`, `format:check`, `test` (511), `smoke` (68), `build` all pass.
  **Next action:** none - complete. Proceed to Phase 2.

## Phase 2 - Shatterdome walkable hub (vertical slice)

**Depends on:** Phase 1.
**Status:** done, delivered as Milestone 08 below.
**Scope:** on-foot player controller, one explorable Shatterdome interior area (command + Jaeger bay placeholder rooms), DOM-based management UI shell, save-game create/load against IndexedDB.
**Acceptance tests:** player can walk the hub, open a management panel, save and reload state, all offline.
**Next action:** the on-foot player controller and the first real Shatterdome interior, which is the first
consumer of the `shatterdome.jaeger-bay` asset and the point where an entity is bound to a manifest.
Persistence already exists (Milestone 03), the streamed ground gives a controller real terrain and a real
height field to walk on (Milestone 05), and the environment already supplies the traction, movement and
water-state multipliers a controller has to obey (Milestone 06). The controller consumes those rather than
inventing its own.

## Phase 2 / Milestone 08 - Explorable Shatterdome and on-foot player

**Depends on:** Milestone 02 (asset manifests), Milestone 03 (saves), Milestone 06 (environment
effects), Milestone 07 (the city the complex stands in).
**Status:** done.
**Scope:** thirteen facilities as a grammar with tiers, construction orders, power and crews;
generated interior rooms with fixtures, doorways, spawn points and a Conn-Pod; keyboard and mouse
on-foot movement with collision, interaction focus, accessible prompts, pause and an unstuck action;
doors, lifts and trams with short fades; in-world management terminals, berth inspection and Conn-Pod
instruments; lightweight staff schedules, ambient work and radio chatter from named crew. Created
`src/shatterdome/`, `src/data/facilities.ts`, `src/data/personnel.ts`, `src/engine/interiorView.ts`,
`src/engine/onFootInput.ts`, `src/ui/shatterdomeScreen.ts`, `src/debug/shatterdomeScenario.ts`.
Raised the save envelope to version 5 with a real migration. Replaced the Shatterdome placeholder
screen the boot flow used to land on.
**Acceptance tests:**

- The player walks from command to a selected Jaeger, inspects it, enters the Conn-Pod and returns,
  with no menu teleport anywhere in the path. Verified headlessly by the scenario, in the browser by
  Playwright, and by hand: command to quarters by lift, quarters to the bay by tram, and the bay is
  130 m of walking wide.
- Facility state changes appearance after construction and survives reload. Ordering Kaiju Research
  raised scaffolds immediately, and when the build landed the sealed bulkhead in command became a
  usable door into a room with fixtures and five staff on shift. A build running at the moment of
  saving is still running after a full page reload and a load.
- On-foot controls and camera never inherit Jaeger-scale physics values: a person walks at 2.4 m/s
  against a 75 m machine's stride, and the interior camera runs a 0.05 m near plane and a 400 m far
  plane rather than the ground view's 400 km.
- `npm run typecheck`, `lint`, `format:check`, `test` (636), `smoke` (78), `build` all pass.
  **Next action:** none - complete. Proceed to Phase 3.

## Phase 3 / Milestone 09 - Jaeger locomotion, scale, and camera foundation

**Depends on:** Milestone 02 (asset manifests), Milestone 05 (streamed ground), Milestone 06
(environment effects), Milestone 08 (the roster and the machine the player selects).
**Status:** done.
**Scope:** a shared locomotion controller driven entirely by a per-machine profile, twenty states,
predictive ground queries, step-up, fall and landing, water states, booster, knockback, knockdown,
get-up, disabled leg and death; three camera rigs with comfort controls, obstruction handling and
lossless switching; buffered input; scale communication through footstep decals, dust, street lights,
aircraft and delayed sound. Created `src/jaegers/`, `src/engine/jaegerView.ts`,
`src/engine/pilotInput.ts`, `src/ui/pilotScreen.ts`, `src/debug/jaegerScenario.ts`. Added a third
roster machine so "works for a heavy tank and an agile frame" is something the tests run.
**Acceptance tests:**

- The placeholder machine crosses city, coast and ocean courses without skating or snagging.
  Measured stride is within 5 percent of declared stride on all three machines, blocked frames over
  the debris field are zero, and the tower at the end of the city course does stop it.
- Camera switching preserves target, heading intent, controls and heads-up state, asserted headlessly
  and in the browser.
- Controller behaviour is driven by a shared config and works for a heavy tank and an agile frame:
  the same courses run with all three profiles and produce three different runs.
- `npm run typecheck`, `lint`, `format:check`, `test` (710), `smoke` (86), `build` all pass.
  **Next action:** none - complete.

## Phase 3 — Single Jaeger + single kaiju combat vertical slice

**Depends on:** Phase 2.
**Status:** not-started.
**Scope:** one playable Jaeger with light/heavy melee, block, evade, cockpit/third-person camera switch; one kaiju with a basic attack pattern and per-component damage; hit stop, damage numbers optional, component-based damage model.
**Status:** locomotion, cameras and the attack framework are done (Milestones 09 and 10). What remains
is kaiju behaviour rather than a schedule, per-component damage on the machine rather than one hull
zone, hit stop, and damage that survives a battle into the save record.
**Acceptance tests:** a full scripted encounter can be won or lost; damage persists to the Jaeger's save record after battle.
**Next action:** a Jaeger the player can pilot, starting from the machine they already select at a berth and
board in the Conn-Pod. The roster entry, its asset manifest and its saved selection all exist; what does not
is a Jaeger entity in the world, a controller at Jaeger scale, and the damage record that outlives a fight.
The deployment corridor out of Hong Kong is already surveyed as city layout data, and the environment
already supplies the traction, movement and water-state multipliers a 75 m machine has to obey.

## Phase 3 / Milestone 10 - Combat targeting, input buffer, and attack framework

**Depends on:** Milestone 09 (the machine, its reactions and the input buffer).
**Status:** done.
**Scope:** the shared combat language. Data-driven moves with phases, movement and turn curves,
armour, cancel tags and windows, swept hit volumes, typed damage packets and resource costs; a kaiju
as body zones with their own health, armour and consequences; soft targeting, explicit lock, cycling
and aim mode with body-zone selection; reusable reactions; an arena that resolves both sides with one
code path and reports everything as events. Created `src/combat/`, `src/data/moves.ts`,
`src/data/kaiju.ts`, `src/engine/combatView.ts`, `src/debug/combatScenario.ts`.
**Acceptance tests:**

- A test Jaeger and a test kaiju exchange attacks deterministically in an arena: the same scenario run
  twice produces the same events, the same damage and the same digest, and a longer run is decided by
  a lethal zone rather than by a timer.
- Hit debug views show which volume connected, at which tick, and with which damage packet, in the log
  and as zone markers drawn where the resolver believes the zones are.
- Illegal cancels are rejected by name and defensive windows stay responsive: a cancel before the
  window, after the window, into the wrong tag, or out of a whiffed move that has to land first are all
  refused with a message, while a guard comes out of anything that lists it.
- `npm run typecheck`, `lint`, `format:check`, `test` (774), `smoke` (93), `build` all pass.
  **Next action:** none - complete.

## Phase 3 / Milestone 11 - Melee combos, defence, counters, grapples and finishers

**Depends on:** Milestone 10 (the attack framework this extends).
**Status:** done.
**Scope:** directional and charged attacks, dodges, blocks, perfect guards, parries with free
counters, combo tracking, grapples with struggle, escape, throws and slams, environmental weapons as
tagged props, finishers as short beat state machines with placement safety and accessibility
settings, and a move list written from the move table. Created `src/combat/defense.ts`,
`src/combat/grapple.ts`, `src/combat/finisher.ts`, `src/data/props.ts`. Extended the move table, the
arena, the pilot panel and the input source.
**Acceptance tests:**

- An encounter can be won through offense, defence and counters, grapples, or mixed play: four
  scripted routes through the same arena, each ending with a lethal zone destroyed and the machine
  standing.
- Finishers never place actors inside buildings, in water too deep, or outside the loaded world:
  every start goes through an injected space query, and so do dodges, throws and grapple clearance.
- Reduced camera motion and hold-to-complete work, and skipping a sequence pays out the same damage.
- `npm run typecheck`, `lint`, `format:check`, `test` (824), `smoke` (101), `build` all pass.
  **Next action:** none - complete.

## Phase 3 / Milestone 12 - Ranged weapons, ammunition, heat and signature abilities

**Depends on:** Milestone 10 (the attack framework) and Milestone 11 (the fight it extends).
**Status:** done.
**Scope:** a weapon table covering eight behaviours, magazines, reserves, reloads, cooldowns, heat,
reactor draw, recoil, aim restrictions, underwater modifiers and friendly fire; a fixed projectile
pool with swept movement, ballistic arcs and a combat bubble; status effects as a table on the combat
clock; pure weapon scoring for anything that has to choose; a ranged row on the pilot panel with real
magazines and states. Created `src/data/weapons.ts`, `src/combat/projectiles.ts`,
`src/combat/abilities.ts`, `src/debug/weaponScenario.ts`. Extended the arena, the damage kinds, the
quality presets, the pilot panel, the input source and the combat view.
**Acceptance tests:**

- Each weapon behaves differently through the same code, with ammunition, heat and reactor draw all
  spent and reported, and every refusal a sentence rather than silence.
- Ranged fire is never free: a weapon costing nothing at all is refused at registration.
- A barrage fires far past the pool ceiling; the refusals are counted, the pool never grows, and
  every round comes back.
- Nothing is simulated outside a 2,400 m bubble or past a twelve second lifetime.
- `npm run typecheck`, `lint`, `format:check`, `test` (875), `smoke` (108), `build` all pass.
  **Next action:** none - complete.

## Phase 3 / Milestone 13 - Localized Jaeger damage, scars, disabled systems and recovery

**Depends on:** Milestone 10 (the attack framework), 11 (the fight) and 12 (damage kinds).
**Status:** done.
**Scope:** a component table covering Conn-Pod, sensor mast, torso, reactor, two arms and two legs;
per-component structure, armour, states and damage-kind routing; systems and weapon mounts lost with
the component that carried them; scars as four numbers with the debris grown from a seed; a roster
that keeps every machine and turns a defeat into recovery, repair or a rebuild; a priced and timed
work order on the berth with a shift of work you can put into it; and a save section carrying all of
it. Created `src/data/components.ts`, `src/jaegers/damage.ts`, `src/jaegers/roster.ts`. Extended the
arena, targeting, the weapon table, the save schema and migrations, the pilot panel, the world panel,
the berth panel and the machine view.
**Acceptance tests:**

- Destroying the right arm disables only right-arm weapons and changes how the machine behaves.
- A damaged Jaeger returns to the bay with matching scars and a calculated repair work order.
- Repairing components updates stats, appearance, cost and completion time.
- Defeat never deletes the machine, and no debris transform is ever saved.
- `npm run typecheck`, `lint`, `format:check`, `test` (912), `smoke` (112), `build` all pass.
  **Next action:** none - complete.

## Phase 3 / Milestone 14 - Staged city destruction, debris, regional persistence and rebuilding

**Depends on:** Milestone 07 (the city layout) and Milestone 10 (combat, which is what damages it).
**Status:** done.
**Scope:** building archetypes with a seven-state lifecycle; per-block damage, fire, contamination,
rubble, trapped civilians and a city safety score; a pooled debris system that freezes and recycles;
regional persistence through a compact per-block summary on every region record; clearing and
rebuilding projects influenced by facilities, security and funding; and a world panel that reports
all of it and can put crews on the worst block. Created `src/data/buildings.ts`,
`src/world/destruction.ts`, `src/world/debris.ts`, `src/debug/destructionScenario.ts`. Extended the
city view, the region record, the world state, the save schema and migrations, the quality presets
and the world panel.
**Acceptance tests:**

- A building-scale battle visibly changes the active district and the damage remains after leaving
  and reloading.
- Returning days later shows staged clearing or reconstruction rather than an instant reset.
- The maximum active debris body count is enforced under stress at every preset size.
- `npm run typecheck`, `lint`, `format:check`, `test` (953), `smoke` (117), `build` all pass.
  **Next action:** none - complete.

## Phase 3 / Milestone 15 - Kaiju framework, senses, behaviour and body zones

**Depends on:** Milestone 10 (the combat framework these creatures fight inside).
**Status:** done.
**Scope:** nine locomotion families; seven sense channels producing contacts rather than truth;
eleven goals scored by utility with hysteresis and plain-language explanations; navigation fallbacks
for ruined cities, water, cliffs and blocked routes; bodies with breakable armour, special organs that
grant abilities, severable appendages, damage-kind resistances, environmental preferences and phases;
and an AI debug view on the pilot panel. Created `src/data/locomotionFamilies.ts`,
`src/kaiju/senses.ts`, `src/kaiju/behavior.ts`, `src/kaiju/navigation.ts`, `src/kaiju/creature.ts`,
`src/debug/kaijuScenario.ts`. Extended the kaiju table with two new archetypes, the pilot panel, and
the combat loop, which now lets the creature drive itself instead of attacking on a fixed cadence.
**Acceptance tests:**

- Three archetypes pursue the same objective with visibly different tactics, proved by their goal
  trails and by which of them actually arrives.
- Breaking a special organ removes the ability it granted, live and in tests.
- The debug view explains the current goal, the alternatives considered, path state and sensory
  contacts.
- `npm run typecheck`, `lint`, `format:check`, `test` (998), `smoke` (120), `build` all pass.
  **Next action:** none - complete.

## Phase 4 — World map and attack director MVP

**Depends on:** Phase 3.
**Status:** not-started.
**Scope:** streamed sector map with floating origin, 2–3 regions (start with Hong Kong + one more), deployment flow from map alert to battle, seeded attack director scheduling.
**Next action:** not started.

## Phase 5 — Economy, research, roster expansion

**Depends on:** Phase 4.
**Status:** not-started.
**Next action:** not started.

## Phase 6 — Copilots, squads, allied AI commands

**Depends on:** Phase 3, Phase 5.
**Status:** not-started.
**Next action:** not started.

## Phase 7 — Prestige, custom Jaeger assembly, deep progression curves

**Depends on:** Phase 5.
**Status:** not-started.
**Next action:** not started.

## Phase 8 — Sandbox mode, co-op networking adapter, crossover content

**Depends on:** Phase 4, Phase 6.
**Status:** not-started.
**Next action:** not started.

## Phase 9 — Full world coverage, presentation polish, performance budgets

**Depends on:** all prior phases.
**Status:** not-started.
**Next action:** not started.
