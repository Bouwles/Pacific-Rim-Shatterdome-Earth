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

1769 unit and integration tests, plus 158 Playwright browser tests.

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
  - `worldClock` - whole-tick advance and day rollover, fractional and negative advances refused, skip-forward never goes backwards, snapshot round trip and version rejection; the sun highest at noon and below the horizon at midnight, real seasons, seasons flipping in the southern hemisphere, midnight sun above the arctic circle, declination inside the axial tilt, twilight after sunset, moon phases cycling, a full moon up at midnight, and a moonlit night brighter than a new-moon one but nothing like day.
  - `weather` - one profile per climate zone; a profile that can produce nothing is refused; a climate never produces a kind it excludes; fronts are identical for the same seed and slot in any order, differ by seed, and resolve in constant time half a million slots out; weather holds steady then crosses smoothly with a monotonic transition; consecutive samples never jump; every derived value stays in range; temperature swings across the day; bad weather genuinely cuts visibility and raises wind; lightning flashes in storms and never in clear air; wetness accumulates, dries, stays in range, ignores a tick already passed and round-trips through a snapshot; bearings interpolate the short way round the compass.
  - `ocean` - depth zones ordered and always resolving; wave sampling pure in its arguments, moving with time, bounded by the amplitude the wind justifies, and keeping both sea level and ceiling when octaves are dropped for quality; globe-fixed wave coordinates; all five water states including a walk through every one as the ground drops away; standing, wading, floating and diving resolved by depth against body height; buoyancy scaling with volume and refusing a negative one; audio keeping full bandwidth above water and cutting the highs below it rather than just the volume.
  - `quality` - one preset per level, every budget cheaper at every lower level, shadows and reflections off at the bottom, **every required telegraph present at every level including Low**, a preset that drops one refused by the validator, Low still playable rather than blank, nonsensical budgets rejected, and levels resolved from the URL.
  - `cityLayout` - district rows reject anything that could not build; the shipped plan validates and an inverted wedge does not; layouts are deterministic in their inputs and differ by seed; every district in the plan produces blocks; the whole city stays inside the region; **downtown is the tallest district and the slums stack more, smaller towers**, which is what makes the silhouette readable; harbour lanes run out to sea and muster points sit inland; the waterfront and slums evacuate first and the Shatterdome last; missile batteries face the water; **every block belongs to exactly one destruction group and no group holds half the city**; block ids are unique and stable; every landmark names an asset slot; both deployment routes exist and the Jaeger corridor is much wider; the layout thins itself rather than blowing a block budget; stats match what was built. Plus polyline helpers: walking, wrapping, degenerate input and heading.
  - `cityActivity` - alert state starts calm, restarts its clock only on a real change, refuses unknown levels and fractional ticks; evacuation runs during warning and attack, faster under attack, reverses during recovery and stays in range forever; alert profiles escalate the military and empty the harbour together, and sound sirens only when there is something to warn about; activity peaks at midday with separate morning and evening humps; the streets empty as the alert rises; an inland district gets no shipping; the response ramps rather than switching; evacuation flow peaks in the middle and is zero at both ends; rain keeps people in and a gale keeps boats in; a levelled district is empty whatever the hour; every channel stays in range across every level, progress and hour. Plus instance counts, including never rounding a living district down to nothing.
  - `facilities` - every facility the spec names is registered and every one has a terminal, so nothing is reachable only from a menu; a facility with no terminal is refused, and so is a tier that adds no fixtures over the one below it, because an upgrade nobody can see is not an upgrade; a room too low to stand up in is refused; only the reactor produces power; the bay is built at Jaeger scale and the command floor is not; a new campaign starts with a complex that runs and room to grow, and with a reactor that carries what is standing without so much headroom that power is never a decision. Plus the connection graph: it validates, leaves nothing unreachable, names an unknown endpoint, rejects a duplicate edge, uses all three travel kinds, and keeps every lift between decks and every door on one.
  - `facilityState` - the complex starts where the grammar says; power balances; crews are held for the length of an order and released when it lands; a second order on the same facility is refused; an order with no crews free is refused and says to upgrade Logistics; an order the reactor cannot carry is refused with both numbers and goes through once the reactor is upgraded; logistics musters more crews; nothing builds past the top tier; progress climbs and completion fires exactly once; a first build and an upgrade are reported differently; zero and negative tick counts do nothing. Plus the snapshot: a build still running round-trips and keeps building after restore, a facility added since the save gets its own default, and the states that cannot exist are rejected by name.
  - `interiorLayout` - a room exists only for a facility that has been built, and appears when it is; layouts are deterministic in their inputs and differ by seed; the player can reach the bay and the Conn-Pod from command, and every room is reachable from every other; a doorway to an unbuilt facility is sealed and says which; every fixture is inside its room and every spawn point is somewhere a person fits; berths carry the roster machines and named crew are posted at their own facility; **scaffolds go up when an order lands and come down when it completes, and a higher tier shows more fixtures**; the Conn-Pod is person scale while the bay is not; an arriving player lands inside the room rather than in the doorway; ids are unique; a room is tens of fixtures rather than thousands.
  - `onFoot` - **person-scale constants, asserted against Jaeger scale**, and an interior camera with a near plane in centimetres and a far plane in hundreds of metres rather than hundreds of kilometres; acceleration to walking pace and no further; running faster than walking and crouching slower than either; walking where you are facing; stopping when the keys are released; **no walking through a wall however long you try, and no passing through a fixture even at a full run in one long frame**; sliding along a wall rather than sticking; obeying the environment's movement and traction rather than inventing footing, with the weather kept outdoors; pitch and yaw clamped and wrapped; a zero or negative frame doing nothing. Plus unstuck: always somewhere clear, always the nearest, always the same answer, and the room centre when every spawn point is blocked.
  - `interaction` - focus on what is being looked at with a prompt that says how to use it; nothing focused behind the player; a fixture out of reach reported with its distance rather than ignored; one far beyond its reach dropped; the nearer of two preferred; the cone narrow enough to mean something; a sealed door focused and explaining itself; the right verb for every kind of fixture. Plus the keyboard path: cycling nearest first, backwards, wrapping, pinning something behind the player, and turning the player to face what they picked.
  - `staff` - named crew all have a real post, a real shift and lines whose placeholders can be filled; the three shifts cover the day with no gap and no overlap; a facility staffs from its slots and thins out overnight without ever rounding to nobody; the budget caps how many are drawn; poses are the same room at the same tick with no state in between, and some people walk between posts while others work where they stand. Plus chatter: filled from live state, never leaving a placeholder unfilled in any shipped line, the same at the same tick, held for a whole interval, moving on in the next, preferring whoever is on shift, and silent for a facility nobody is posted to.
  - `locomotion` - the state table covers every state the milestone names and refuses a state that ignores the player while keeping full turn authority; machine scale is an order of magnitude off a person on speed, height and stride; acceleration takes real time and never exceeds the profile ceiling; momentum outlives the stick; the agile frame gathers pace faster than the heavy one. Turning: **one frame at 26 degrees a second is under half a degree, so the body cannot snap to the camera**, it gets there eventually, it turns worse at a run than planted, and a keyboard turn works with no camera intent at all. Ground: **debris under the ledge threshold never blocks a 75 m machine**, a ledge inside step height is climbed, a cliff face is refused rather than crept up, an edge produces a fall and a landing with a camera impulse, and the probe reaches a stride ahead. Water: wade then swim as the bottom drops away, and the water is entered once rather than every frame. Footfalls: **spaced within 10 percent of the declared stride**, alternating feet, and none at all while airborne. Environment: ice costs acceleration and deep going costs top speed, both taken from `EnvironmentEffects`. Booster: fires from a buffered press, spends the charge, refuses to fire empty, recharges on the profile's own clock. Reactions: knocked down and back up on the frame's own timing, input ignored while knocked back, slower on a damaged leg, and nothing at all once destroyed. Frame independence: the same ground covered at 30 and 144 frames a second, and nothing on a zero or negative frame.
  - `jaegerCamera` - three rigs and no others; every machine framed from its own height rather than a fixed distance; the cockpit inside the head and the chase camera behind the machine. **Switching rigs keeps heading, pitch and lock**, cycles through every rig and back, and is a no-op when the rig is already active. Pitch is clamped both ways and inverts on request. Comfort: reduced motion with the slider at zero removes sway, roll and impulse and still leaves a working camera behind the machine; the pull-back at speed survives unless reduced motion is on; nonsense settings are rejected by name. Impulse decays rather than accumulating and is scaled by the slider. Obstruction pulls the camera in. A locked target is brought into frame without the body moving.
  - `inputBuffer` - a press made slightly too early is still there when it becomes legal; one whose window closed is dropped rather than fired late; order is kept because light-light-heavy is not a set; the oldest legal press is taken and an illegal one is left waiting; a mashed key is bounded by capacity; the snapshot reports what is pending and what was taken; a nonsense window or capacity is refused at construction.
  - `combatMoves` - every shipped move validates, and the validator refuses an attack with no volume, a cancel window that opens before the active frames, a volume that outlives the move, damage of zero, shock outside its range, and missing cues; phases land where the numbers say; a heavy commits harder than a light in every respect. The kaiju table: exactly one lethal zone per creature, refused if none or two, and a core softer and deadlier than the plate around it. Hit volumes: placed in front of the attacker, following facing rather than the world, **catching a target the volume passed straight through between ticks**, missing what it genuinely misses, catching a target that walked into a stationary volume, and the closest point on a segment clamped to its ends. Overlap history lets one volume hit one target once and a different volume hit it again. Reactions: every one validates, one that takes control away for no time is refused, a guard absorbs and then breaks, poise turns into a stagger and is cleared by it, a finisher needs a target both hurt and open, and knockback is scaled by the reaction rather than the packet.
  - `targeting` - soft targeting picks what is being faced, ignores anything outside the cone however close, ignores anything out of range, and prefers what is closer to the centre of view over what is merely closer; cycling walks left to right as the player sees them, wraps, goes backwards and gives back nothing when nothing is in range; zones sit around the creature rather than at its feet, aim picks the head looking up and the tail looking well down, and a hit is attributed to the zone it landed on; a lock survives an aim-mode change and an aimed zone is dropped when aim mode is left.
  - `meleeDefense` - dodges are invulnerable in the middle of the step and nowhere else, cost stamina, keep their recovery and cancel only out of moves listing an evade; a mistimed dodge says whether it was early or late **without using the words tick, frame or window**; a perfect guard takes nothing and opens the attacker while a late block takes a quarter; a parry answers with a free counter and a missed one costs more than not trying; holding guard still blocks with no defensive move at all. Combos count inside their window and drop outside it. Charges scale with the hold and a charge worth nothing is refused at registration. Grapples refuse out of reach, already held, on the ground, too heavy and no room, each with its own sentence; a victim fighting flat out escapes, a passive one times out, and a hit holder loses the grip; a throw into a building is refused and releases instead, a throw into the open lands where the holder is facing, and a slam needs something solid and stops short of it. Finishers refuse no room, deep water and unloaded world, run their beats and pay out in full, keep only what was banked when interrupted or released, apply everything at once when skipped, and flatten every framing to one wide shot under reduced motion. Props validate, and one that adds damage without adding startup or needs less room than it reaches is refused.
  - `missions` (Milestone 17) - pilots all validate, a pilot who is their own drift partner is refused, nobody drifts with themselves or alone, a pair who have flown together rate above two strangers, and a pair's combined strengths are reported without duplicates. Objectives: all eight ship and validate, they complete and fail from the same reported numbers, **a stage that settles opens the next one in the same evaluation**, a critical failure stops the mission instead of opening the next stage, and the score is weighted by what each objective is worth. The planner works out readiness, travel and load, refuses a machine that is not ready, a load the carrier cannot lift and a pair who cannot drift, warns without refusing when the odds are merely bad, and **never reveals more than the warning knew**. The lifecycle runs planning, carrier, active and results in order, can be skipped past the carrier, refuses to launch twice, ignores reports before it has arrived, produces explained outcomes for an abort and a lost contact, keeps one set of results however many times it is asked, and round-trips through a snapshot.
  - `director` (Milestone 16) - mutations all validate, one that changes nothing is refused, one with no tell is refused, exclusions are respected, and a set combines into one set of multipliers and one cost. The director produces the same war from the same seed and the same decisions, a different war from a different seed, **long stretches with nothing happening at all**, never more incidents at once than it is allowed, at least two at once when the dial is up, and never the same region twice in a row. The crisis dial changes how much happens and is bounded at both ends. Rolls happen on a fixed cadence, so one long step and many short ones contain the same chances. Resolution explains every number it produces, is decided by the model rather than written when the alert was made, lets chance move the margin without deciding a rout, costs a region that is left alone, and opens a recovery window afterwards. The snapshot round-trips, drops an incident in a region this build no longer has, and refuses a snapshot that is not one.
  - `kaijuFramework` (Milestone 15) - all nine locomotion families ship and validate, and a family that prefers a medium it cannot enter is refused; **a serpentine body has a turn-in-place rate of zero and navigation honours it**. Senses: sight picks up what is in front and misses what is behind, vibration finds what sight cannot, cover nearly blinds but does not deafen, a contact is forgotten once nothing refreshes it, and a creature remembers being hurt by something it never sensed. The behaviour engine registers every declared goal, hunts on a poor contact, approaches a sure one, gives up the straight line once frustration has built, burrows only if it can burrow, retreats when hurt and enrages past its own line, prefers the objective when that is what it came for, does not flicker between two goals a point apart, and **never names a creature in its explanations**. Navigation takes the clear line, refuses to assume the ground is flat, gives each family its own answer to the same obstacle (burrow under, smash through, climb over, detour), swims where a swimmer can and refuses where it cannot, and says plainly when nothing works. Bodies: three archetypes validate, an organ on a missing zone is refused, a severable limb that costs nothing is refused, phases must descend, armour comes off before the zone under it, resistances change what a blow is worth by kind, and losing an organ removes the ability it granted.
  - `destruction` (Milestone 14) - the archetype table validates, covers the whole seven-state lifecycle, and **refuses an archetype that claims fracture chunks without being fractured or that is cheaper to rebuild than to clear**; archetypes are picked by district rather than by a switch. The debris pool never grows past its ceiling however hard it is pushed, freezes what has settled and stops integrating it, recycles the oldest settled chunk rather than refusing a fresh collapse, expires everything so a bad launch cannot leak a slot, takes its rubble away when a block is cleared, throws the same rubble from the same seed, and refuses a nonsense capacity. Regional destruction damages what was hit and leaves the rest of the city alone, brings structures down in whole numbers, moves a collapse through to rubble on the fight clock, blocks the ground under heavy rubble and opens it again once cleared, burns fires down and pulls people out over hours rather than seconds, refuses to start work with a reason (nothing to clear, already underway, still burning), clears before it rebuilds, works faster with facilities and slower where it is not secure, and **stalls an unpaid rebuild rather than finishing it free**. The saved summary is empty for an untouched city, records only what was damaged with nothing mesh-shaped in it, comes back the same city, drops a block this build has never heard of, and refuses a snapshot that is not one.
  - `jaegerDamage` (Milestone 13) - the component table validates, the shares divide exactly one machine, at least one component is critical, and **a component that disables nothing, carries no mount and is not critical is refused**. Damage is localized: destroying an arm leaves the legs untouched. Routing works: the same blow costs a Conn-Pod more than a leg because of the kind it was, and a component unlisted for a kind takes it at face value. States are named rather than left as a number. A destroyed component absorbs nothing more and says so. What is offline is derived, not stored; mounts go with the arm they were on; a bad leg slows the machine and a missing one nearly stops it. Scars: a scratch leaves no mark, a real blow does, the list is bounded and keeps the worst, and a saved scar is four numbers rather than a pile of debris transforms. Repair: the order is priced and timed from the damage itself, a replacement costs more per point than a patch, hours go in and structure comes back, a finished component loses its marks, and nothing to do is said plainly. The saved record is compact and bounded, comes back the same machine, **takes maximum health from the build rather than the file**, drops a component this build has never heard of, and refuses a snapshot that is not one.
  - `weapons` (Milestone 12) - every shipped weapon validates, and the validator refuses the things that would quietly break a fight: **a weapon that costs no ammunition, no heat and no reactor draw at all**, indirect fire with no minimum range, a beam that also claims a projectile speed, a salvo of one, a reserve smaller than a magazine, and a magazine that reloads instantly. Behaviour helpers agree with the table about what fires a body and what resolves on the spot. Projectiles: a pool refuses rather than growing when it is full and counts the refusals; a round is swept rather than sampled so a fast shell cannot pass through a target between two ticks; a ballistic round arcs and comes down; rounds are retired by range, by lifetime, by the ground and by leaving the bubble; clearing empties it. Status effects: every one validates, one that does nothing at all is refused, stacks are capped, water puts out what it should and leaves the rest alone. Scoring: a mortar at ten metres scores zero, a locked-only weapon with no lock scores zero, an empty magazine scores zero, a hot machine stops reaching for expensive answers, allies in the line of fire cost a friendly-fire weapon its place, and every score comes with a sentence.
- **Integration** (`tests/integration/`):
  - `missionLifecycle` (Milestone 17) — **the whole loop**: an alert from the director, a readiness assessment against the machine that would actually go, a carrier run, a fight, results, and a repair order on the real roster. The carrier run is not compulsory and skipping it changes nothing about what the sortie was worth. Every ending is distinct, named and explained, and an abort still credits what was achieved. Results reconcile: every figure is the figure the simulation reported, **a mission that is never reported to awards nothing**, completing twice returns the same object rather than paying twice, the replay names the seed and plan it was flown with, drift link and reputation move in the direction the sortie went, damage becomes repair hours the bay can take, and two objectives reading the same progress cannot disagree about the city.
  - `attackDirector` (Milestone 16) — **the same seed and the same decisions produce the same alert sequence**, different decisions produce a different war, and a different seed produces a different one again. Two crises run at once without either becoming a combat scene: a resolution is nine plain fields and nothing else. Every overlapping incident gets its own forecast, travel time and full explanation of what happens if nobody goes. Nobody is punished with nonstop alerts: long quiet stretches survive even at the highest frequency, no region is hit twice in a row, and attacks spread across the map. Every resolution names kaiju strength, regional defences, city integrity and escalation with a reason on each, pays for a win and charges for a loss. The war round-trips through a real save file, and a version 7 save migrates into a war that has not started with everything else in the file untouched.
  - `kaijuBehavior` (Milestone 15) — **three archetypes, one objective, three different goal trails**: the brawler closes, the ambusher waits and then works around, and the sapper ignores the machine entirely and digs to what it came for. They also get there differently: the digger goes underground and is the one that arrives. The scenario repeats exactly and answers a different situation differently. Every creature explains its goal, what it considered and what it sensed, with no creature named inside the engine. In the water, a swimmer crosses a bay that stops a digger, and is faster in the medium it belongs in. Breaking one apart removes the ability an organ granted and says which organ went, severing an appendage slows it and takes what that limb was doing, and dropping it past its enrage line changes both what it wants and how hard it hits.
  - `cityDestruction` (Milestone 14) — a battle levels part of the district and reports it, leaves most of the city standing, and repeats exactly on the same seed. Time is not a reset: fires go out and people come out over days while the buildings stay down, and a block is cleared before it is rebuilt, in stages. Debris under stress never exceeds the ceiling at any preset size, reports the shortfall, and comes back to nothing once the rubble has expired. Damage survives leaving and reloading: the summary is written onto the region record, round-trips through a real save, rebuilds the detailed city from the summary alone, stays under a few kilobytes for a levelled city, and a version 6 save migrates into an undamaged world with everything else in the file untouched.
  - `jaegerRepair` (Milestone 13) — a machine fights with one zone per component rather than one hull, and exactly the components whose loss ends the sortie are the lethal zones; it walks into a fight carrying what it walked out with; **destroying the right arm silences the weapons mounted on it, by name and in words, while the left arm keeps working**. The roster never deletes a machine that lost: it comes back as a recovery job, a repair job or a rebuild, decided by the damage itself, and a machine that cannot go out says why with the hours it is short. Towing happens before work, work happens worst component first, and the job finishes rather than stalling on a rounding-sized line. The saved record round-trips through a real save with the same scars, the same missing arm and the same outstanding hours, a version 5 save migrates into a full roster of undamaged machines with everything else in the file untouched, and a roster snapshot that is not one is refused by name.
  - `ranged` (Milestone 12) — firing spends what the weapon says it costs and refuses what it cannot pay for; a magazine runs dry, says so, reloads and fires again; a cooling weapon, one out of range, one too close for indirect fire, one outside its forward arc and one needing a lock are each refused **by name and in a sentence**; sustained fire overheats a machine that will not let go; a salvo puts several bodies in the air from one pull while a beam arrives on the tick it was fired. A barrage fires far more than the pool can hold, and afterwards every round has come back and the refusals were reported rather than swallowed. Status effects keep hurting a target after the shot that applied them, and the log says what happened rather than naming a row in a table. The same barrage from the same seed produces the same digest.
  - `combatView` (Milestone 12) — what is drawn follows the pool up and down exactly, never exceeds the quality preset's ceiling however many rounds are handed in, and a disposed view draws nothing and throws nothing.
  - `appState` — unchanged from Milestone 00.
  - `melee` (Milestone 11) — **every route wins**: offense, defence, grapples and mixed play each end with a lethal zone destroyed and the machine standing, each fights differently, each repeats exactly, and finishers stay rare rather than every hit becoming one. In the arena: a dodge evades outright when it cannot step clear and simply gets out of range when it can; a perfect guard takes nothing and opens the attacker; a parry produces the free counter it promised; a combo is counted and reported. Grapples hold, stop the held fighter swinging, refuse out of reach with a message, keep the hold when a slam has nothing to slam into, and throw into open ground. Props are refused with nothing in hand, picked up, swung harder and broken. Finishers refuse unsafe ground and pay out at once when sequences are skipped.
  - `combat` (Milestone 10) — attacks run startup, active and recovery and end; a hit says which volume, which zone, which tick and how much; **a miss is reported as a miss**; one volume hits once however long it is live; stamina and heat are spent and what cannot be paid for is refused. Cancels: a combo inside the window is allowed, and one before the window, after it, into the wrong tag, or out of a whiffed move that has to land first are each refused **by name and with a message**; a guard comes out of a move that lists it and not out of one that does not. Buffering: a press made inside the window fires the instant it becomes legal, one nobody could act on expires unused, and what is waiting is visible. Reactions: **a stagger needs poise to be spent rather than firing on every heavy landing**, a staggered fighter is refused its own attack by name, a guard eats most of a hit and all of the reaction, and a zone is destroyed once with what losing it costs. The scenario: both sides land attacks through the same code, the same fight twice produces the same digest, a different machine produces a different one, combos are cancelled and reported, every hit carries a volume and a zone, a long run is decided by a lethal zone, and no fighter leaves its own resource limits.
  - `jaegerLocomotion` (Milestone 09) — **the three courses**: the city course crosses debris with zero blocked frames and stops at the tower; measured stride is within 5 percent of declared stride for all three machines, which is the skating test; no course exceeds the machine's speed ceiling even with booster bursts; the coast course goes dry to wading to swimming; the ocean course swims with no footfalls at all; the same course twice gives the same digest, and three machines over the same ground give three different ones. The pilot session drives, reports, survives a floating-origin rebase with everything but its coordinates intact, keeps comfort, lock and heading across a camera swap, and lets a booster press expire unused when it was made while knocked down. The view takes the camera and gives it back on disposal, runs a far plane a machine can see across and a near plane it can sit inside, attaches none of Babylon's own camera input, leaves footprints bounded by the quality preset, and returns the scene to exactly what it found.
  - `shatterdome` (Milestone 08) — **the acceptance walk, run headlessly**: command to the quarters by lift, the quarters to the bay by tram, a machine inspected, the Conn-Pod boarded and left, with every leg taking real time and no teleport anywhere in it; a build ordered at the terminal on the way and reported on the radio; the digest identical across runs; crossing a Jaeger bay taking as long as crossing a hundred metres should. Session behaviour: the room changes only at the darkest point of a transition; a sealed door says which facility is missing; a refused order leaves the player where they are and says why; **an order changes the room the moment it lands, and a build finishes while the player is in another room**; speaking to a named character returns live facility state; unstuck always lands somewhere clear; the player's position is written back so a reload puts them where they stood. Saves: a complex with a build running round-trips and keeps building, a facility built before the save is built after it with the scaffolds gone, and a version 4 save migrates to a fresh complex on the command floor with the rest of the file untouched. The interior view: builds one room and only one room, swaps rooms without leaking the one it left, stands the roster machines in the berths through the asset pipeline, draws no more staff than the quality budget, returns the scene to exactly what it found on disposal, and puts the camera at a person's eye height.
  - `city` (Milestone 07) — the alert scenario digests identically across runs; **an alert measurably moves civilians, shipping, military, sirens and evacuation, checked as five separate movements rather than one**; traffic rises during a warning and falls during an attack; recovery brings the city back and stops the sirens; every district is covered. World state raises an alert on one region without touching others, refuses an unknown region, advances evacuation only where alerted, and round-trips through a save; a snapshot with an unknown alert level is rejected. The version 3 migration adds a calm alert to every record while leaving integrity, tier and last visited tick untouched. The city view builds many meshes rather than one, stays inside every quality budget, draws a smaller city on a lower preset, **empties the crowds and the harbour when the alert rises**, never exceeds its agent pool, moves its agents with the tick, and returns the scene to its exact original mesh, material and node counts on disposal.
  - `environment` (Milestone 06) — the query surface imports no render code; advances only in whole ticks; reports a full sample; runs a real day and night cycle; darkness reduces how far anything can be seen; climate follows the player between regions and falls back to open water; wet ground is slippery and ice is far worse; movement slows in water and slows most underwater; visibility is capped by the depth zone once the eyes are under; wind, rain and water all cost ranged accuracy; hazardous conditions are flagged; the clock and wetness round-trip through both an environment snapshot and a full world state; a fresh world and a migrated save agree on the starting hour; and the debug scenario produces an identical digest across runs, a different one per seed, and a real day and night with more than one kind of weather.
  - `sectorRenderer` water (Milestone 06) — the sheet is built at the resolution the preset asks for, the surface moves as the clock advances, the same tick always gives the same surface, heights stay inside the wave amplitude the weather justifies, only as many sheets animate as the preset budgets, and a disposed renderer ignores water updates.
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

## Milestone 07 acceptance evidence

Measured on WebGPU at seed 20260823 on Medium, not inferred.

| Acceptance item               | Evidence                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recognisable by silhouette    | 710 blocks, 1,480 towers, 14 landmark slots across seven districts; downtown asserted tallest at over 250 m, slums asserted to stack more and smaller |
| Recognisable by activity      | Calm Hong Kong at midday ran 199 pooled agents: 107 vehicle, 45 crowd, 27 ship, 20 aircraft                                                           |
| An alert changes traffic      | Vehicle density 26 percent calm, and the agent mix went to 196 vehicle under attack                                                                   |
| An alert changes shipping     | 31 percent calm to 2 percent under attack; ship instances 27 to 1                                                                                     |
| An alert changes the military | 15 percent calm to 100 percent under attack                                                                                                           |
| An alert changes sirens       | Silent when calm, sounding under attack, silent again during recovery                                                                                 |
| An alert changes evacuation   | 0 percent clear when calm; 10 percent clear and 35 percent moving within seconds of the attack                                                        |
| Within budgets on Medium      | 620 towers in 31 of 135 groups, 53 meshes, 0.09 MB, 74 draw calls, 1.0 ms frames, 143 fps                                                             |
| Not one city mesh             | One mesh per destruction group, asserted in unit, integration and browser tests                                                                       |
| Not thousands of AI civilians | No per-civilian state exists; the pool caps at 618 instances on Medium and is asserted never to exceed it                                             |

## Milestone 08 acceptance evidence

Measured on WebGPU at seed 20260824 on High, by hand in the browser.

| Acceptance item                                  | Evidence                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Walk command to a Jaeger, inspect, board, return | Command to Crew Quarters by lift, Crew Quarters to Jaeger Bay by tram, walked 130 m of bay to berth 1, inspected Placeholder Sentinel, boarded the Conn-Pod, disengaged back to the bay. Same path asserted headlessly and in Playwright |
| No menu teleport in that path                    | Every leg is walked through the controller; the only transitions are a lift, a tram and a gantry, each with its own travel time                                                                                                          |
| Facility appearance changes after construction   | Ordering Kaiju Research raised scaffolds in that room at once; when it landed, the sealed bulkhead in command became "Door to Kaiju Research" and the room behind it had fixtures and 5 of 5 staff on shift                              |
| Facility state survives reload                   | A build running when the save was written was still running after a full page reload and a load, at its recorded progress                                                                                                                |
| On-foot scale is not Jaeger scale                | 2.4 m/s walking, 1.68 m eye height, 0.05 m near plane, 400 m far plane, asserted in unit tests and visible standing beside a 75 m machine in the bay                                                                                     |
| Pause is a real pause                            | Simulation tick frozen at 985 across a second of wall clock, resuming at 1024                                                                                                                                                            |
| Unstuck is safe                                  | Always lands on a clear spawn point in the same room, reported on the radio                                                                                                                                                              |
| Within budget                                    | 9 to 32 draw calls per room, 10 to 17 meshes, 0.1 to 0.3 ms frames at 144 fps                                                                                                                                                            |
| Not a row of flat menus                          | Every interface opens by using something in the world; there is no menu path to facility management                                                                                                                                      |
| Not every staff member simulated                 | A facility outside the active room is one integer; inside it, positions are a function of index and tick with no per-person state                                                                                                        |

## Milestone 09 acceptance evidence

Measured on WebGPU at seed 20260824 on High, by hand in the browser, standing in Hong Kong.

| Acceptance item                                              | Evidence                                                                                                                                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crosses city, coast and ocean without skating                | Measured stride 26.9 m against a declared 27 m on the city course; zero blocked frames over 40 debris pieces; coast course reached wading and then swimming; ocean course swam with no footfalls               |
| Does not snag on minor debris                                | Debris up to 1 m never registers as a ledge, which is what `LEDGE_THRESHOLD_METERS` exists for; the tower at the end of the course does stop the machine, so the check is not simply switched off              |
| Camera switching preserves target, heading, controls and HUD | Chase to Conn-Pod in the browser kept look heading within 6 degrees, kept the lock, kept reduced motion, and the machine kept driving from inside the head                                                     |
| Shared config works for a heavy tank and an agile frame      | Three profiles run the same courses; the heavy covers less ground than the standard frame and the agile more, from the same code                                                                               |
| Mass is not communicated by shake alone                      | Acceleration, braking, turn authority, stride-spaced footfalls, footprints, dust, street lights, aircraft and delayed sound all read as mass with the camera-motion slider at zero                             |
| On-screen scale references                                   | 140 scale references drawn, 56 of 56 footprints, sound delay 0.76 s at the far end of a run                                                                                                                    |
| Machine is visible and animated                              | Torso, head, reactor, arms, legs and feet resolved through the asset pipeline and walking; the streamer's stand-in marker is switched off while driving because it stood in the same place and hid the machine |
| Camera scale                                                 | Near plane 0.6 m, far plane 120 km, Babylon camera inputs detached so nothing fights the controller                                                                                                            |

## Milestone 10 acceptance evidence

Measured on WebGPU at seed 20260824 on High, by hand in the browser, in Hong Kong.

| Acceptance item                                                   | Evidence                                                                                                                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A test Jaeger and a test kaiju exchange attacks deterministically | The scenario runs both sides through one resolver; two runs agree on every event, every damage figure and the digest; a twelve thousand tick run ends with a lethal zone destroyed and a named winner               |
| Hit debug shows volume, tick and packet                           | Live log read in the browser: `t5205 jaeger melee.heavy.overhead · fist.both → head 410 dmg · component-shock`, and the zone markers drawn around the creature sized by remaining health                            |
| Illegal cancels rejected, intended windows responsive             | Four refusal reasons asserted by name in tests; in the browser a jab into a cross into a heavy chained cleanly while a finisher against a healthy target was refused with "needs a target that is already finished" |
| Both sides use the same code                                      | The creature's claw and tail rows sit in the same table as the machine's jab and hammer, and the kaiju landed 208 and 156 damage on the machine, knocking it down and putting it into get-up                        |
| Reactions reach the machine                                       | A tail sweep knockdown put the piloted machine into its get-up state through the locomotion controller's own reaction path                                                                                          |
| Within budget                                                     | 98 to 101 draw calls with a fight live, 0.6 to 0.8 ms frames at 144 fps                                                                                                                                             |
| No fake UI                                                        | Every control on the combat block does something; the aim cycle offers only zones the creature has; refusals are shown rather than swallowed                                                                        |

## Milestone 28 acceptance evidence

Measured at seed 20260903, in the browser by hand and in the unit, integration
and scenario suites.

| Acceptance item                                                       | Evidence                                                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical state stays readable in rain, fog, darkness, water and glare | 60 of 60 rows across six viewing conditions and eleven settings combinations kept every critical alert intact                               |
| ...at any display setting                                             | The critical layer ignores opacity and gets 1.1x the text scale; asserted over every colour-vision preset, text size and contrast setting   |
| Cockpit indicators change because systems change                      | One value changed, exactly one instrument moved and the other ten were byte-identical. Building the model twice from the same state matches |
| ...not because an animation plays                                     | Every motion token is capped at 900 ms and nothing loops; reduced motion sets all of them to zero                                           |
| The loop is usable with the keyboard alone                            | Live: tabbing reaches the text-size and high-contrast controls, Space operates them, and the focused control shows a ring                   |
| Nothing critical is hidden for cinematic purity                       | Live: a torso at 9 percent raised `!! Torso 9% — Another solid hit here takes it out.` in the band, which no setting can fade               |
| The cockpit view is not weaker                                        | Targeting and faults are instruments in their own right; live it read "Targeting locked, 115 m" and the fault line named the offline part   |
| Colour is never the only signal                                       | All five severities have distinct glyphs and three distinct border weights; live the strip read ✓ at 100 percent, △ at 52, !! at 9          |
| Icon and motion tokens documented                                     | `tokenTable()` emits the whole vocabulary, and a test asserts it matches the token set exactly                                              |

Four defects found, all in this milestone's own scenario rather than its
shipping code: spreading an override of `null` over a default object left the
object, so "no target" never meant no target and "the radio is quiet" silently
became "the radio said something"; the instrument trace changed two systems at
once, so it could not have proven which instrument follows which; and the calm
case inherited a dry weapon, so a quiet HUD was never actually quiet.

## Milestone 27 acceptance evidence

Measured at seed 20260902, in the browser by hand and in the unit, integration
and scenario suites.

| Acceptance item                                             | Evidence                                                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Screenshots without interface are distinguishable by region | Live at midday with the interface hidden: Anchorage reads cold grey, low and scattered against hills; Manila reads warm tan, packed, on tropical green |
| ...by silhouette                                            | 256 blocks and 354 towers in Anchorage against 711 and 3,976 in Manila, live in the ground view                                                        |
| ...by climate, palette and activity                         | Every region has a distinct palette and activity figure, asserted over all seven; the closest pair sit 0.26 apart on the silhouette metric             |
| The same kaiju encounter plays differently                  | Slide 12 m in Tokyo against 20.7 m in Vladivostok; hit chance 0.62 to 1.1; detection 950 m to 2,880 m; two of seven regions where nothing can dive     |
| ...because of terrain and city structure                    | Approach counts differ, and Anchorage and Vladivostok narrow to a single corridor because of their ground                                              |
| All regions use shared streaming and destruction            | Every city built by one `generateCityLayout` call and damaged by one `RegionDestruction`; asserted for all seven, and all four stream live             |
| Identity is not flags and labels                            | The validator refuses a profile that changes no geometry, no palette and no conditions, and a modifier that changes nothing                            |
| No copyrighted map data                                     | Every layout is procedural from wedges, bearings and radii. No dataset is imported anywhere in the project                                             |
| No cultural stereotyping                                    | Places are described by geography and infrastructure only, asserted by a test scanning every profile's text                                            |

No defects found in this milestone's own code. One test needed correcting: it
called a destruction API that does not exist, and was rewritten against the real
`RegionDestruction` class.

## Milestone 26 acceptance evidence

Measured at seed 20260901, in the browser by hand and in the unit, integration
and scenario suites.

| Acceptance item                                            | Evidence                                                                                                                                                                                       |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A point can be discovered, saved, reloaded and deployed to | Live: walked from 3.5 km to 0.3 km, worked the Proving gate, deployment points went 0 to 1 and the Deploy here control opened. Round-tripped through a real save file in the integration suite |
| The map and the world agree                                | Every readout is measured from the machine's actual position, the region on a row is the region the site was placed in, and travel time follows distance                                       |
| ...on region damage                                        | A world where every region has been hit produces rescue calls; one where none has cannot                                                                                                       |
| Rewards do not respawn on a boundary or a reload           | A second pass over all 21 sites paid 0. After a save and reload the same claim is still refused and returns no reward                                                                          |
| ...and cannot be double-paid into the books                | Four claim attempts against the economy produced one ledger line                                                                                                                               |
| No generic icons scattered uniformly                       | Site kinds are exclusive per region kind: training gates only at a Shatterdome, research anomalies only at sea, landmarks and rescue calls only in coastal cities                              |
| Seamless Earth does not mean hours of walking              | Farthest pair 369 km: 0.6 hours by carrier against 7.3 on foot, and reaching a discovered point is one control                                                                                 |
| Boosters cost something                                    | One burst adds 0.34 heat against 0.12 shed per second, refuses above 0.95, and says whether it was charge or heat                                                                              |
| The route assist leaves a decision                         | Direct is always at least as fast; the assisted route lists its stops and says in minutes what they cost                                                                                       |
| Some places need more than walking                         | Several sites omit `exploration` entirely, so contracts, analysts and allied governments are the only way to them                                                                              |

Three defects found while building it. Site offsets were computed on Earth's
radius while the world uses a scaled one, so a site stated as five kilometres
away was a few hundred metres away in the world anybody walks through. Travel
time was rounded at the point it was computed, which flattened every nearby
journey to zero on that same scaled globe. And a new campaign could see nothing
at all: the only site near the start was a proving gate that walking could not
discover, and the nearest findable one was twenty kilometres away, so the first
thing a player did was stare at an empty map.

## Milestone 25 acceptance evidence

Measured at seed 20260831, in the browser by hand and in the unit, integration
and scenario suites.

| Acceptance item                                     | Evidence                                                                                                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An invalid build explains every violated constraint | An empty build reports one violation per structural slot at once, each naming the slot; a mismatched build reports the fitting, the heat and the ammunition together |
| ...and cannot enter combat                          | `chassisFrom` returns null for any illegal build, so there is nothing to acquire and nothing to hand the arena. Asserted for an empty build and a one-fault build    |
| Two valid builds handle differently                 | Sprinter 1.50x mobility against brawler 0.64x; brawler 0.331 armour against sprinter 0.168; 2,830 t against 1,620 t                                                  |
| ...animate and fight differently                    | Different run and turn speeds, different get-up time from balance, different combat profiles and different zone placement, all derived from the chassis              |
| ...and look different                               | Different silhouette bulk and height, with the socket ratios unchanged so a real model still drops in                                                                |
| Renaming does not duplicate the owned chassis       | Renaming the blueprint leaves the built record's name and serial alone; the machine standing in the bay was stamped when it was assembled                            |
| Recolouring touches nothing structural              | Paint, markings and emblem are validated as weightless, and a recolour leaves every structural slot identical                                                        |
| Rebuilding does not duplicate                       | Scrap frees the one slot; the rebuild gets a new serial and the campaign still holds exactly one                                                                     |
| Saving, exporting and importing do not duplicate    | Export carries no serial and no build record; importing gives a fresh id and a library with zero machines in it                                                      |
| Tradeoffs are not one capacity bar                  | Thirteen figures shown separately, each against what it is measured against. A test asserts no part dominates another in its slot on every axis                      |
| Custom parts cannot overwrite a signature loadout   | The assembled chassis carries an empty `signatureEquipment`, never enters the shipped registry, and every shipped chassis is asserted unchanged after a build        |
| One active custom serial in a campaign              | The limit lives on the library, the sandbox flag is the only exception, and serials only ever go up                                                                  |

Three defects found while building it. The starter build was illegal, because
cooling was undertuned against heat across the whole catalogue: a new campaign
could not have built anything. Mobility multiplied part by part, so five modest
parts compounded into a machine twice as fast as stock; it is now anchored to
the legs with everything else contributing a fraction. And the actuator ceiling
was set so high that no build could ever reach it, which is validation that
never fires.

A fourth was found by the linter and was real rather than cosmetic: the derived
chassis was never put into a registry the roster could see, so assembling a
machine would have silently produced nothing. The roster and the market now
share one chassis registry, and two tests guard it.

A fifth, from Milestone 24, surfaced here: five research nodes and both
manufacture recipes required a facility called `manufacturing`, which does not
exist. The facility is `manufacture`, so those programmes could never have been
started in a real game. Fixed, with a test that every named facility exists.

## Milestone 24 acceptance evidence

Measured at seed 20260830, in the browser by hand and in the unit, integration
and scenario suites. The scenario figures are one 60-sortie run per strategy,
deterministic from that seed.

| Acceptance item                                                    | Evidence                                                                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Research prerequisites stay valid after migration and data changes | A save naming a dropped node and a dropped sample loads, drops both, and still resolves its countermeasures; version 13 migrates to an empty programme |
| Benefits stay valid across a reload                                | Benefits are never stored. They are recomputed from the completed list, so a restored save with two nodes finished still reads a telegraph lead        |
| A newly completed countermeasure changes a real rematch            | Same fighters, same seed, same move: with no research the wind-up never reads; with the nervous system mapped it reads; with the model it is named     |
| Exclusive chassis manufacture consumes exactly the components      | Funding, alloy and reactor material each fall by exactly the bill, and the roster gains exactly one machine of that chassis                            |
| ...and produces one owned unit                                     | One record, `acquiredBy` "research-manufacture", and nobody starts a campaign owning either frame                                                      |
| The tree is not a list of tiny percentage upgrades                 | No benefit kind scales damage or health; the validator refuses a node that hands nothing over; a test asserts the profile has no damage field          |
| No impossible missable sample gates core progression               | Every root node needs only what any kill drops, and a walk of the whole graph reaches every branch but chassis on common samples alone                 |
| Samples do not encourage tedious repetition                        | Varied play finished 21 of 23 programmes and all nine branches; grinding one easy fight finished 12, touched 8, and unlocked no frame                  |
| Playing well pays best                                             | Going after finishers, captures and awkward conditions finished all 23 and unlocked both frames                                                        |
| A narrow player is still not stuck                                 | The grinding run still finished 12 programmes and still had a working telegraph lead                                                                   |
| Research reaches the player early                                  | First countermeasure landed on sortie 4 of 60                                                                                                          |
| The board says what it is doing                                    | Live: programmes with requirements read off real stores, greyed buttons carrying the reason, and "Nothing learned yet" rather than an empty panel      |

Two defects found while building it. The chassis validator refused a research
frame outright, because it required every chassis to carry a price above zero;
a machine nobody sells should not have a price at all, so the rule now depends
on whether the chassis can be purchased, and refuses a price on one that cannot.
Adding the frames also broke two tests that compared "the newest thing on the
board" against the whole registry, which had silently meant the same thing while
every chassis was purchasable.

## Milestone 23 acceptance evidence

Measured at seed 20260829, in the browser by hand and in the unit, integration
and balance suites. The balance figures below are one 360-day run per strategy,
deterministic from that seed.

| Acceptance item                                                 | Evidence                                                                                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Common play supports steady progress                            | Pick-battles ends a year on +4,534,929 with no days in debt and 78 sorties flown                                                                          |
| Repair and purchase decisions stay meaningful                   | That surplus is under two machines' worth against a catalogue of 2.9M to 7.8M, and 78 of 78 repairs were paid for out of it                               |
| Every way of playing survives                                   | Fly-everything +10,542,261, explorer +2,030,269, stand-down -581,289 with 2 days in debt and 2 repairs put off. Worse, not fatal                          |
| An over-extended programme struggles                            | Lean, flying everything, 70k a day upkeep: 59 days in debt and 60 repairs deferred                                                                        |
| Difficulty scales income and nothing else                       | Generous 9,534,340, standard 4,534,929, lean 868,703 from identical play: same sorties, same repairs needed, different pay                                |
| No income source is a grind                                     | Half again the sorties is not half again the money; asserted as a ratio rather than eyeballed                                                             |
| Every balance-affecting change appears in an inspectable ledger | `earn` and `spend` are the only mutation paths and both write a line; a refused spend writes nothing and moves nothing                                    |
| The ledger and the balance agree over hundreds of days          | Asserted for all four strategies at 360 days, with the ledger bounded at 400 lines so a long campaign cannot grow it without limit                        |
| A reward cannot be paid twice                                   | Refused on retry, after a save and reload, and for a reconnecting client replaying the same result five times: balance 50,000, ledger one line            |
| Resources each earn their place                                 | Six kinds, each with declared sources and sinks; the registry refuses a resource whose sinks duplicate another's, and a test walks every pair             |
| Repair cost varies with damage, rarity, stores, bay and urgency | Each asserted separately, and the itemised lines are asserted to sum to the total rather than to look plausible                                           |
| The player can see where the money went                         | Live: the contracts terminal shows six named balances, "Last 30 days: ... in, ... out, net ...", a breakdown by source with bars, and the ledger in words |
| An old save keeps its money                                     | Version 12 funding, salvage and samples come across as funding, alloy and research data; the ledger starts empty rather than inventing a history          |

Two defects found while building it. The first balance pass had three of four
strategies ending a year deeply in debt, because a sortie paid roughly a tenth of
what a day of upkeep cost; the second pass over-corrected far enough that every
strategy ended rich enough for money to stop mattering, which is the same failure
from the other side. The figures above are the third pass. Separately, the
reconciliation check itself was wrong: it decided whether the ledger had been
trimmed by counting funding lines, while the ledger trims across every resource,
so it reported a mismatch that was not there.

## Milestone 22 acceptance evidence

Measured on WebGPU at seed 20260828 on High, in the browser by hand and in the
unit and integration suites.

| Acceptance item                                         | Evidence                                                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Start a construction project                            | Live: three orders placed from the command console, two active and one queued against two crews                                              |
| Reprioritise                                            | Live: the waiting project moved from priority 5 to 1 with four presses and became active on the next tick, displacing one that was running   |
| Pause under policy                                      | Live: paused, progress kept, "Work stopped. The crews are free for something else", and the crew went to the next project                    |
| Cancel under policy                                     | Live: "Cancelled. 789500 comes back from what was not spent yet", refunded to the treasury, project removed                                  |
| Finish and reload                                       | Tests: a project completes and reports its tier name; a round trip keeps priorities and progress and brings an active project back as queued |
| A repair upgrade changes the bay and repair performance | Test: building the reactor, hall and bay raises the repair effect and changes the room's lighting, signage, crane count and stage note       |
| Insufficient power or staff degrades understandably     | Live at midnight: "Building at 60 percent: 34 percent of the posts filled", repair worth 1.35x by day and 1.27x by night, work continuing    |
| No choice bricks a save                                 | A test walks the prerequisite graph from an empty complex and asserts every facility is reachable at every tier                              |
| Facilities are not decorative unlocks                   | Every tier declares effects from a fixed vocabulary the registry enforces, and `roster.work` multiplies a repair shift by the resolved rate  |
| No real-time monetisation pressure                      | Nothing is timed against a wall clock and nothing can be skipped for money. Cancelling refunds by a fixed policy rather than selling an undo |

Five existing tests asserted the behaviour this milestone deliberately replaced:
being short of crews used to refuse an order and now queues it. Each was rewritten
to the new contract rather than deleted, keeping what it was actually checking.

## Milestone 21 acceptance evidence

Measured on WebGPU at seed 20260827 on High, in the browser by hand and in the
unit and integration suites.

| Acceptance item                                          | Evidence                                                                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| An ally does something useful with no orders given       | Live: three allies deployed and were all on "focus, already on the mark" without a single command being issued                                     |
| Behaviour changes promptly after an order                | Live: one press of 8 took all three from "focus" to "reposition" under Disengage, within a tick                                                    |
| Orders work during combat without pausing                | Live: the simulation tick advanced across issuing the order, from 2358 to 2449                                                                     |
| Every order is acknowledged                              | Live: "Bulwark: Breaking off." "Longshot: Falling back." "Hammerfall: Getting clear.", one line each, in their own words                           |
| Two allies do not target the same body slot              | Resolved in one pass with zone claims: the squad tests assert every ally takes a different zone, and falls back rather than refusing to attack     |
| Two allies do not waste signature attacks simultaneously | Each spends its own at most once per target and only inside a window the player opened; a second resolution offers none                            |
| Allies do not collide                                    | Spacing steps sideways from the direct line when another machine is inside 85 m                                                                    |
| Allies are not invulnerable turrets                      | Live: Longshot came out of the fight at 95 percent. Allies carry real zones, real profiles and real damage                                         |
| Commands are not animation scripts                       | An order multiplies goal weights; what it means is worked out by the ally. The only hard parts are constraints, and they refuse rather than direct |
| Personality and skill changes persist across deployments | Confidence moves with results and is saved; perks are recomputed from the sorties that earned them on restore                                      |

Four defects found by hand. Every ally crew started with no machine and nothing
ever assigned one, so allies never deployed at all. The quick command key never
reached anything, because the pilot input dispatches from a table that had no
entry for it. Disengage did not break contact, because withdrawing scored zero
above a third structure and so had nothing for the order to multiply. And ranged
pressure let a brawler crew close anyway, because the minimum range constrained
engaging but not where the crew repositioned to.

## Milestone 20 acceptance evidence

Measured on WebGPU at seed 20260826 on High, in the browser by hand and in the
unit and integration suites.

| Acceptance item                                                      | Evidence                                                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Swapping copilots produces visible handling and tactical differences | Live: the same Jaeger went from "70 percent link, effectiveness 76" under Anvil and Ledger to "35 percent link, effectiveness 61" under Ledger and Kingfisher, and readiness fell 90 to 80 |
| The difference reaches the fight rather than only the panel          | Perk effects arrive as the same growth object levels and modules use: Anvil and Ledger raise poise and heat, Kingfisher and Quartz raise mobility and damage                               |
| A drawback triggers only under documented conditions                 | Each trigger kind is tested firing and not firing: a role, a hurt machine, a grating partner, a long approach, and a partner already injured                                               |
| A drawback is displayed before deployment                            | Live: the alert board listed both pilots' drawbacks above the Deploy button, with Kingfisher's marked as applying and its full explanation shown                                           |
| Link progress survives save and load                                 | Round trip keeps links, stress, injuries and history, and recomputes the level from the experience rather than trusting the file                                                           |
| Link cannot advance twice from one mission result                    | The crew keeps the ids of settled missions; the second call reports "already been logged" and changes nothing, and it still refuses after a reload                                         |
| Injuries are nonlethal, with treatment, restrictions and substitutes | The worst is three weeks; treatment shortens and never removes; a grounded pilot is replaced by the best available substitute, ordered by who knows the partner                            |
| The player avatar has no hidden statistics                           | Nothing was added to the on-foot player. Every difference between two sorties comes from the two people in the Conn-Pod                                                                    |
| No copilot is best everywhere                                        | Every pilot has at least one role they are not at home in, and the ordering of pairs changes between machines                                                                              |

Four defects found by hand. Drift strength saturated at exactly 1.0 for two
different pairs, which made the headline number useless for telling crews apart.
Injuries were far too common and too severe: ten in twelve sorties, with the crew
grounded for two thirds of the campaign. A pilot stood down for recovery could
still be assigned, which made the button advice rather than an order. And the
list of drawbacks on the alert board never appeared, because it was inserted next
to an element that had not been added to the document yet.

## Milestone 19 acceptance evidence

Measured on WebGPU at seed 20260825 on High, in the browser by hand and in the
unit and integration suites.

| Acceptance item                                              | Evidence                                                                                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Levels come from playing and raise the machine's own numbers | Live: one aborted sortie took a fresh machine to level 3, two more to level 7, with growth reading 1.21x structure and the log naming each move unlocked       |
| Levels unlock moves, passives and module slots               | Live: level 2 unlocked melee.light.cross, level 4 opened a tier 1 passive, level 6 opened the first module slot                                                |
| A passive is a choice with a cost                            | Live: Reinforced frame took structure 1.06x to 1.17x and mobility 1.02x to 0.98x. The registry refuses any passive below tier four that gives nothing up       |
| A module is bought, fitted and reversible                    | Live: Spine brace took structure 1.21x to 1.30x, filled the only slot, put the machine in the bay for six hours, and disabled every other Fit button           |
| Prestige is voluntary, uncapped, and diminishing             | The multiplier is asymptotic: rank 1 is worth 4.6 percent, rank 10 forty, rank 1000 and rank a quadrillion within 0.02 of each other, and it never reaches 1.6 |
| Extreme prestige does not destroy the game                   | A level 30 machine at infinite rank with the best passive and module stays under three times stock, checked at ranks 0, 1, 10, 100, 1000 and 9007199254740991  |
| Forecasts match what actually happens                        | The forecast and the outcome come from the same function, asserted equal at four ranks, and the panel shows both sides before the button can be pressed        |
| New acquisitions stay usable                                 | A machine bought into a rank 10 fleet arrives at rank 5, which is worth over ninety percent of rank 10 because the curve is asymptotic                         |
| Difficulty scales through behaviour, not numbers             | Fleet strength raises the mutation budget only: same seed, same creatures, same health, more mutations                                                         |
| Progression survives a save                                  | Round trip keeps level, rank, passives, modules and counters, recomputes the level from experience, and drops ids this build no longer ships                   |

Three defects found by hand. The experience bar rendered at zero size, because it
reused a class that takes its width from the band grid it normally sits in. A
module refusal on a level 1 machine read "Every slot is full: 0 of 0" instead of
saying when the first slot opens. And the level curve was calibrated against
nothing: reaching the cap needed about two thousand sorties. It is now about
forty five, and a test pins the shape against what a sortie is actually worth.

Two defects the validators found on their own, in content I had just written: a
tier 2 passive with no mechanical cost, and a module with no downside that did
not require prestige. Both were data, and both were fixed as data.

## Milestone 18 acceptance evidence

Measured on WebGPU at seed 20260825 on High, in the browser by hand and in the
unit and integration suites.

| Acceptance item                                                               | Evidence                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purchasing creates exactly one owned instance and deducts the price once      | Live: 6.0M to 4.3M on signing for a 1.7M hull, the offer leaves the board, and fifteen days later the fleet reads five machines with a second Ironclad at serial VETERAN-MK1-0002. Buying the same offer again is refused and deducts nothing |
| Market rotation is seeded, saved, and cannot be rerolled by refreshing        | Live: saved, reloaded the page, loaded the slot, and the board came back with the same four offers in the same order, the same treasury and the same fleet. In tests, five reloads of one snapshot produce identical boards                   |
| Older Mark units stay affordable, distinctive, upgradeable and endgame-viable | The Mark 1 is 2.9M against the Mark 5's 6.6M, 6.2k a day against 12.8k, twenty upgrade steps against seven, and wins outright on durability while losing on mobility and reach                                                                |
| A machine is not owned until it is delivered                                  | Nothing arrives before the lead time, and running the clock on afterwards does not deliver a second one                                                                                                                                       |
| No gacha, no premium currency, no timed pressure                              | One treasury, plain prices, previews carrying bands and terms rather than a score, and an offer stays on the board for the whole fourteen day rotation                                                                                        |
| Upkeep is charged on what is owned                                            | Live: 45k a day on four machines became 51k on five, and sixteen unattended days cost 720k. Settlement is driven by the clock's absolute day number, so every time path charges once                                                          |

Two defects found by hand. Performance bands were multiplied by a hundred twice,
so every bar read 6000-9500 and every bar was full width. And a month of skipped
time left 313 live attacks on the board with escalation pinned at 100 percent,
because an attack that landed and was never answered stayed live forever: the
director now settles what nobody came to, and sixteen unattended days leave three.

## Milestone 17 acceptance evidence

Measured on WebGPU at seed 20260825 on High, in the browser suite and by hand.

| Acceptance item                                                             | Evidence                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A full loop from alert to preparation, deployment, battle, results and back | Live: an alert over Manila, "Readiness 94% · drift 100% · machine 100% · 1.3 h flight · carrier 67% loaded · clear", deploy, carrier, landed in the machine with a kaiju at 93 m, objectives updating, results, back to free exploration |
| Aborting produces a recoverable and explained outcome                       | Live: "aborted: Sortie aborted. 58 percent was already done and it still counts", with ten ledger lines each carrying its reason                                                                                                         |
| Mission results reconcile exactly with authoritative events                 | Integration tests assert every figure equals what was reported; a mission never reported to awards nothing, and completing twice pays once                                                                                               |
| No unskippable cutscene                                                     | The carrier run is a phase of the same session with a Skip button, and skipping changes neither the score nor the funding                                                                                                                |
| Resources are not awarded twice                                             | The only path into a mission is `report`; results are computed once and cached, and the incident is resolved with the director exactly once                                                                                              |
| Hidden phases stay hidden                                                   | Predicted threat comes from the director's forecast at its own confidence: a weak signal reads "Not enough signal to say what is out there"                                                                                              |
| Objectives cover the required kinds                                         | Eight registered, including multi-stage crises as a list of stages, with stage two opening the moment stage one settles                                                                                                                  |

One defect found by hand: the carrier run was over before it could be seen,
because its duration was computed in mission seconds that pass sixty times
faster than real ones. It is now ten to thirty seconds of flight, still skippable.

## Milestone 16 acceptance evidence

Measured on WebGPU at seed 20260825 on High, in the browser suite and by hand.

| Acceptance item                                                        | Evidence                                                                                                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repeated seeds generate the same alert sequence for the same decisions | Two runs of the same policy produce identical alert ticks, regions and digests; changing the policy changes both                                                  |
| Two overlapping emergencies without two combat scenes                  | Live: four alerts at once across Manila, Sydney, Hong Kong and Tokyo, with draw calls and frame time unchanged from a quiet war                                   |
| The UI explains rewards, damage and escalation after each resolution   | Live ledger: "Kaiju strength: -66.32 · Regional defences: 22 · Civilian density: -5.4 · How it went on the day: -3.74 · City integrity: -0.36 · Escalation: 0.11" |
| Nobody is punished with nonstop alerts                                 | Cooldowns, a ceiling, a recovery window and long quiet stretches, all asserted; the longest quiet run exceeds ten thousand ticks even at the highest frequency    |
| Outcomes are not predetermined                                         | An incident resolved with a machine on station holds where the same incident ignored does not; the seeded draw only moves the margin                              |
| Player-adjustable crisis frequency                                     | A four-position dial on the world panel, bounded at 0.25 and 2 by the director rather than by the panel                                                           |
| Travel time and consequence forecasts are honest                       | Live: "Sydney: 4.8 h out · 8.5 h to get there · too far to reach in time" beside "Manila: 3.9 h out · 1.3 h to get there"                                         |

One defect found by hand: skipping time on the panel advanced the clock, the
weather and the city's recovery but not the war, so a player could skip a week
and see nothing happen. Both time paths now go through one call.

## Milestone 15 acceptance evidence

Measured on WebGPU at seed 20260824 on High, in the browser suite and by hand.

| Acceptance item                                                    | Evidence                                                                                                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three archetypes pursue the same objective with different tactics  | Goal trails: `approach` for the brawler, `ambush > approach > flank` for the serpent, `destroy-objective` with `burrow-under` for the sapper              |
| Breaking a special organ removes the related ability               | Live in the browser: the panel went from "ability.acid-spit · throat-sac 100%" to "no abilities left · throat-sac 0%" after working on the head           |
| AI debug views explain goal, considered actions, path and contacts | Live: "approach — 84 m out and confident", "approach 93 · flank 21 · destroy-objective 13", "jaeger by sound 93% at 84 m", "direct in ground at 16.0 m/s" |
| No named kaiju in the behaviour engine                             | Every goal scores a plain situation and a weights profile; a test asserts no explanation contains a creature name or id                                   |
| Not every arena is flat and not everything turns in place          | Navigation checks slope and step-up per family, and a serpentine body cannot change heading while stationary, both asserted                               |
| The creature drives itself                                         | The fixed attack cadence is gone; live, the creature closed 84 m to 17 m on its own while the player stood still                                          |
| Within budget                                                      | 106 to 112 draw calls with a creature deciding and closing, 0.6 to 0.9 ms frames at 144 fps; behaviour adds no draw calls at all                          |
| No fake UI                                                         | Every AI row shows what the creature actually acted on, and reads "not running" rather than zeroes when nothing is fighting                               |

## Milestone 14 acceptance evidence

Measured on WebGPU at seed 20260824 on High, in the browser suite and by hand.

| Acceptance item                                              | Evidence                                                                                                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A building-scale battle visibly changes the active district  | Live: "2 of 129 blocks damaged, 1 levelled, 1 still burning, 2.9k still trapped" after a fight on the waterfront, with the blocks visibly flattened         |
| The damage remains after leaving and reloading               | Browser test leaves the machine, leaves the ground view and returns to the same damaged blocks; an integration test round-trips it through a real save file |
| Returning days later shows staged clearing or reconstruction | Browser test skips four six-hour blocks so fires die down, starts work, skips eight more, and asserts the outstanding hours fall without the city resetting |
| Maximum active debris body count is enforced under stress    | The stress scenario fires far past the ceiling at 40, 48, 96 and 200 bodies; peak live never exceeds capacity and the shortfall is counted                  |
| No wall panel is simulated as physics                        | The smallest damageable thing is a destruction group; debris is a pooled ballistic chunk that freezes on settling                                           |
| No scene graph is saved                                      | The snapshot is seven numbers a block; a test asserts the serialised form contains nothing matching mesh, vertex, matrix or transform                       |
| Within budget                                                | 155 draw calls with blocks collapsing and 48 rubble bodies live, 0.8 ms frames at 144 fps                                                                   |
| No fake UI                                                   | The rebuild button is disabled, visibly, when nothing is down, carries the real quote as its title, and every refusal is a sentence on the panel            |

One defect found by hand that the tests had missed: the in-game time controls
advanced the clock and the weather but did nothing for a damaged city, so a
player skipping six hours saw fires that never went out and crews that never
worked. Both time paths now go through the same recovery call.

## Milestone 13 acceptance evidence

Measured on WebGPU at seed 20260824 on High, by hand and in the browser suite.

| Acceptance item                                                          | Evidence                                                                                                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Destroying the right arm disables only right-arm weapons                 | The chain sword and plasma caster refuse with "went with the right arm" while the rotary cannon on the left arm still fires                                      |
| Damage is localized, not one health bar                                  | Live in the browser: "97% structure · Left leg 74% scarred" with every other component untouched, after a tail sweep landed on the leg                           |
| Damage changes how the machine behaves                                   | A damaged leg scales walk, run, strafe and both turn rates through the profile the shared controller reads; a lost leg drops speed to a quarter and forces a tow |
| A damaged Jaeger returns to the bay with matching scars and a work order | Browser path: fight, take damage, walk command to quarters to bay, and the berth shows the machine under repair with hours and a parts bill                      |
| Repairing updates stats, appearance, cost and completion time            | Work a shift shrinks the outstanding hours in the same panel; a finished component loses its marks, and the machine wears fewer                                  |
| Defeat never deletes the Jaeger                                          | Every recovery path keeps the record; a machine that lost a critical component is towed and rebuilt rather than removed                                          |
| No debris transforms are saved                                           | A scar is four numbers; a full damage record serialises to under two kilobytes, asserted in a unit test                                                          |
| Within budget                                                            | 99 to 103 draw calls with a marked machine, 0.5 to 0.7 ms frames at 144 fps; all marks share one draw call                                                       |
| No fake UI                                                               | The repair button is disabled, visibly, when there is nothing to do, and the browser test asserts both that state and the working one                            |

One defect the tests found and one the browser found. The repair queue stalled
forever behind a job whose hours rounded to zero, which is why the order is now
sorted worst first and a shift always spends something. The damage readout said
"all answering · all systems answering" and left a trailing separator on an
undamaged machine.

## Milestone 12 acceptance evidence

Measured on WebGPU at seed 20260824 on High, by hand in the browser, in Hong Kong.

| Acceptance item                                       | Evidence                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each weapon behaves differently through the same code | Seven weapons across eight behaviours: the plasma caster landed instantly and set the target burning, the missile salvo put three bodies in the air per pull, the cannon fired 4-tick flights, the chain sword ran while held |
| Ammunition, heat and reactor draw all matter          | Missiles ran 6/6 to 0/6 and refused with "Anti-kaiju missile is empty. Reload, or use something else."; the chain sword took the machine to 15 percent heat in under a second of holding                                      |
| Reloading works and says so                           | L reloads whatever is emptiest; spares fell 12 to 6 as the magazine refilled, and "Nothing needs reloading." when nothing does                                                                                                |
| Aim restrictions are enforced in words                | "Rotary cannon only fires forward. Turn to face it." with the machine turned away; "Too close for the shoulder mortar: it needs 180 m."; "113 m is past the chain sword's reach of 55 m."                                     |
| Ranged fire is not free permanent damage              | A weapon costing no ammunition, no heat and no reactor draw is refused at registration, asserted in a unit test                                                                                                               |
| Nothing is simulated outside the combat bubble        | Rounds retire on range, lifetime, ground contact and leaving a 2,400 m bubble; the readout returns to "0/180 in the air" every time firing stops                                                                              |
| A barrage cannot break the pool                       | The stress run fires far past the ceiling; refusals are counted and reported, the pool never grows, and every round comes back                                                                                                |
| Within budget                                         | 99 to 111 draw calls with rounds in the air, 0.5 to 1.0 ms frames at 144 fps; all live rounds share one draw call                                                                                                             |
| No fake UI                                            | Every key in the ranged row does something; the weapons readout shows real magazines and states; a heat-fed weapon says "heat fed" rather than reading as empty                                                               |

Four defects were found by hand that the automated suites had missed: weapons fed
by heat read as empty magazines, status events logged their internal ids instead
of sentences, the coaching line was being taken over by routine fire, and every
event raised between two ticks (which is every shot, reload and refusal) never
reached the log at all because a step can only report what a step produced.

## Milestone 11 acceptance evidence

Measured on WebGPU at seed 20260824 on High, by hand in the browser, in Hong Kong.

| Acceptance item                                                          | Evidence                                                                                                                                                                                                  |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An encounter can be won through offense, defence, grapples or mixed play | Four scripted routes, all ending `winner: jaeger` with a lethal zone destroyed: offense with a seventeen-hit combo, defence off twenty-four parries, grapples off throws and slams, mixed using all of it |
| Finishers never place actors unsafely                                    | Every start goes through the space query; refused inside buildings, in water over 24 m, and outside the loaded world, each with its own message. Dodges, throws and grapple clearance use the same query  |
| Reduced camera motion works                                              | Every finisher framing collapses to one wide shot, asserted in a unit test and visible on the panel                                                                                                       |
| Hold to complete works                                                   | On by default; a beat that asks for the hold ends the sequence early when the input is released, keeping only the damage banked so far                                                                    |
| Skip sequences works                                                     | Applies the full guaranteed damage immediately, killing a nearly finished target in the arena test                                                                                                        |
| Not every hit is a cutscene                                              | Finishers require a nearly finished target that is reeling or held; the mixed route lands over a hundred hits and starts almost no finishers                                                              |
| A dodge does not erase weight                                            | Costs stamina, invulnerable only in the middle, keeps its recovery, and cancels out of nothing but moves that list an evade                                                                               |
| Move list has no jargon                                                  | Six groups read live in the browser, coaching lines only, and a test asserts the panel text never contains tick or frame                                                                                  |
| Live browser fight                                                       | Jab, cross and forward heavy chained for "3 in a row"; the seize was refused in words while the heavy was recovering, then took hold and reported "60% loose" before the creature fought free             |

## Milestone 29 acceptance evidence

The soundscape is asserted by the deterministic scenario in
`src/debug/audioScenario.ts` rather than by listening, because "it sounds right"
is not something a test can hold. Two runs of it produce the same digest.

| Acceptance item                                               | Evidence                                                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Audio transitions cleanly through all four states             | The scenario walks complex, carrier, storm combat and under water, settling on shatterdome, deployment, combat-high and boss-phase. Every crossfade finishes |
| No gap where nothing is playing                               | Every step of every leg has at least one voice or a subtitle; the scenario reports `continuous` per leg and the test requires all four                       |
| Voice lines do not overlap uncontrollably                     | One active line by construction. Forty two lines pushed at the channel twice over: ten spoken, thirty one dropped, queue never past four, zero overlaps      |
| Critical warnings win priority                                | Zero critical lines dropped in both the journey and the pressure run. A critical line is never cut, and cannot be marked interruptible                       |
| Missing optional audio is silence or a documented placeholder | Nothing loads a file at all. Every layer synthesises from its recipe, and every line carries its own text, so a missing recording costs a subtitle nothing   |
| Not one impact sound for everything                           | A calm machine sounds five layers, a wrecked one nine, at a cue distance of 0.401. Plate rattle and armour tear appear only with damage                      |
| A creature under water is a different sound                   | Plate drops to 0.15 and the organ layers rise to 0.9; the coastal and deep profiles produce different cue sets from identical state                          |
| The mix is under the player's control and remembered          | Ten faders in the pilot panel, stored in `localStorage`, asserted across a browser reload in `tests/e2e/audio.spec.ts`                                       |
| Accessibility cues are never ducked                           | Every bus pushed at full strength at once leaves the accessibility bus exactly where the player set it                                                       |
| The conversation record survives a save                       | Save version 17. Records and cooldown clocks round trip; a record naming a deleted line is skipped rather than refusing the load                             |
| Voice budget                                                  | Peak 24 sustained voices in the worst leg, against a cap of 48, reported live in the audio readout                                                           |

### Browser suite result

157 passed, 3 failed, 3 did not run, in 25.9 minutes on one worker.

`tests/e2e/builder.spec.ts` "shows a build with every number it is made of"
times out waiting up to 420 seconds for an ordered facility to become
operational, and the three tests after it in that file do not run. It fails the
same way on a clean checkout of the previous commit with none of this
milestone's code present, so it is a pre-existing problem with that test's
construction wait rather than a regression here.

The other two, `city.spec.ts` "shows no city where none has been built" and
`destruction.spec.ts` "a building-scale fight visibly changes the district",
were run while the machine was also running the unit suite, a production build
and a live browser session. Both pass on their own, together, in 2.1 minutes.
They join `combat.spec.ts` "spends stamina and heat on an attack" as tests whose
timeouts are tight enough to lose to CPU contention rather than to a defect.

## Milestone 30 acceptance evidence

| Acceptance item                                                            | Evidence                                                                                                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two browser windows complete a battle and produce one authoritative result | 7 Playwright tests drive two real windows: the seat opens, the second window takes it, the guest's keys reach the host's arena, the host counts them, and one session ends with one result  |
| Artificial latency, jitter and loss do not duplicate damage                | Same battle on a clean link and on 180 ms / 90 ms jitter / 20 percent loss / 15 percent duplication. Host counted 586 damage clean and 445 degraded, never more                             |
| ...or ammunition, rewards or finishers                                     | Finishers and events compared the same way; the degraded run is asserted to be less than or equal on both, never greater                                                                    |
| Nothing is applied twice                                                   | 14 inputs sent, 14 applied on both links, with 3 repeats caught by the host's guard. Every announcement applied exactly once on both links, with 1 repeat caught by the guest's guard       |
| The degraded run actually degraded                                         | 23 packets dropped by the link and duplicates delivered on both directions, asserted before the comparison is trusted                                                                       |
| Single-player builds keep working                                          | A Playwright test fights with nobody connected and the single-player hit log still fills. The co-op row reports Not connected and hides itself entirely where the browser cannot support it |
| Determinism                                                                | Two runs of the same conditions produce identical results, asserted by object equality on the whole run                                                                                     |
| Version mismatch                                                           | A guest speaking a different protocol is refused with both build versions named, rather than timing out                                                                                     |
| Disconnect and rejoin                                                      | A silent guest's machine is held in place after 180 ticks and the seat stays open; a rejoin keeps the sequence guard, so nothing from before the drop can be replayed                       |

### What the comparison deliberately does not assert

The two runs are **not** identical, and requiring that would be requiring that
latency has no effect. A player on a 180 ms link genuinely acts later, so fewer
of their attacks land inside the same number of ticks. What is asserted is that
nothing is counted twice and that a worse link never produces more of anything.

## Milestone 31 acceptance evidence

| Acceptance item                                                        | Evidence                                                                                                                                                                                                                |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create, save, reload, export, import and run a custom battle           | 9 Playwright tests do exactly that in a browser, including a save that survives a page reload and an export whose text imports back into a fresh session                                                                |
| ...and the run puts the chosen creature on the field                   | A scenario naming the serpent runs through the world map into the pilot view and the target readout names the serpent, not the default creature                                                                         |
| Sandbox rewards never enter the main save                              | Scenarios and statistics live under their own storage keys, outside the IndexedDB save pipeline. A test asserts no function in the sandbox modules is named award, credit, payout, unlock, prestige or research         |
| A sandbox toggle never mutates global configuration                    | A straight fight, the same fight with all nine cheats on, then the straight fight again. The first and third match on damage dealt, damage taken, rounds spent, ticks and the arena digest                              |
| ...and the cheated run actually differed, so the check means something | Invulnerability took the 677 damage of the straight run down to 0, and slow motion took 160 ticks down to 53                                                                                                            |
| Unsupported combinations fail with an explanation                      | Surge on a shallow shelf, damage to a city that is not there, a rescue at the Breach, an escort with one machine, snow in Manila. Each names the two settings that disagree, and the run button is disabled until fixed |
| Spawning a roster unit needs no source edit                            | Every chassis in the registry validates as a scenario squad, and the pickers are built from the registries rather than a hard-coded list                                                                                |
| Debug visualisation stays behind an advanced panel                     | `rulesByPanel(true)` is exactly `debugVisuals`, and a browser test confirms the panel is closed by default and the ordinary rules are outside it                                                                        |
| Determinism                                                            | The same scenario and rules produce an identical run, asserted by object equality                                                                                                                                       |

## Milestone 32 acceptance evidence

| Acceptance item                                           | Evidence                                                                                                                                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anime-influenced without flat materials or toy scale      | Roughness floors at 0.3 minimum are validator-enforced; rim accents replace outlines; the machine keeps specular pulled to its floor. Verified by eye on the production build |
| Low and Medium preserve silhouettes and telegraphs        | The rim accent is per-pixel and present at every level; edge lines are the only thing dropped. Every preset still lists its required telegraphs, enforced since Milestone 15  |
| Stress: pools return to baseline after repeated finishers | Three of everything, a hundred rounds, all four levels: zero live effects and full capacity at the end, asserted per level, plus the same claim held in a live browser fight  |
| Budgets hold under abuse                                  | Peak particle demand never exceeded the catalogue worst case on any level; over-budget requests were refused and counted on every level                                       |
| No full-screen flash ignores accessibility                | Flash-class effects are refused inside burst() while flashes are off; the accessibility proof shows zero freezes, zero impulse, zero chromatic where settings say zero        |
| Not every post-process stacked at once                    | There is no post-process stack: the chromatic number is computed and capped at 2.5 px but nothing consumes it yet, which errs on the side the failure mode names              |
| The fight is unchanged by every setting at minimum        | A browser test zeroes all five settings and the hit still lands and logs                                                                                                      |
| Determinism                                               | The stress run twice produces identical results, asserted by object equality                                                                                                  |

The browser suite found one real leak during this milestone: effects aged only
on the combat tick, so a burst alive when a fight ended never returned its
capacity. Aging moved to the frame clock and the browser test now holds it.

## Milestone 33 acceptance evidence

| Acceptance item                                             | Evidence                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| After one load, the core game reaches the main menu offline | Production preview, DevTools offline emulation, reload: full menu on WebGPU. Proven real by a network-only path failing while the cached shell served 200                                                                           |
| Updating between two versions preserves saves and packs     | Built three stamped versions live. The waiting worker was offered at the menu, applying flushed an autosave, the handover reloaded, and afterwards the pre-update slot, the flush's autosave and all 4 pack files were intact       |
| A partial pack can resume or cleanly restart                | Headless: a two-of-four cache resumes fetching exactly the missing two; a 404 stops at the named file and retry continues from it; remove then download refills. In-browser: the same flow through the real Cache API in Playwright |
| Saves never cached by the worker                            | The policy refuses /saves and non-GET; the worker's source is held to the policy by a test that also proves no IndexedDB reference and no self-activation                                                                           |
| No eager caching of future assets                           | Precache is 3 entries; packs are network-only to the worker and fetched only on request                                                                                                                                             |
| No activation mid-combat                                    | The flow's safe places are MainMenu, Saves and Sandbox; accept() refuses anywhere else, unit-proven, and the worker cannot skip waiting without the page's message                                                                  |
| The game runs identically with no worker                    | A Playwright test loads without ?sw=1 and reaches the menu; unsupported and insecure contexts produce a sentence, not a failure                                                                                                     |

Two real defects the manual pass found and fixed: the update banner never
redrew when an update arrived while the menu was already on screen, and the
flow never learned its starting place, so the menu counted as unsafe until the
player wandered off and back.

## Milestone 34 acceptance evidence

| Acceptance item                                                           | Evidence                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repeated combat entry and exit returns near baseline                      | Three spawn-fight-clear cycles in a real browser diff to exactly zero against a warmed baseline, across meshes, materials, textures, particle systems, nodes, observers, audio voices and workers |
| Stress reports export as JSON with version, browser, GPU, preset, seed    | Asserted field by field in the browser, including that the whole report survives JSON.stringify and parse                                                                                         |
| Adaptive quality reacts gradually and recovers only after a stable window | Unit-proven: one spike is ignored, 90 sustained frames step down once with the reason attached, the cooldown swallows the change's own cost, and recovery takes 900 comfortable frames            |
| Long frames are not hidden by the average                                 | A window of 8 ms frames with periodic 80 ms spikes reports average under 16, worst 80, and five captures with scope breakdowns                                                                    |
| The budget contract and the presets agree                                 | validatePerfBudgets runs in the suite; the initial draft was corrected by it, which is the check doing its job                                                                                    |
| Headless stress produces real load deterministically                      | Four combatants: 192 events. Barrage: 2,129 events with the pool never over capacity. Destruction: 246 events and a defeated creature. All three identical across runs                            |
| No core system disabled invisibly                                         | Adaptive quality only calls applyQuality, the same visible path the settings panel uses, and every preset still validates its required telegraphs                                                 |

The leak test's first run failed on +56 meshes: the baseline had been taken
while terrain streaming was still filling, and the first fight lazily allocates
shared singletons. Three further cycles held at exactly zero growth, which is
the steady-state claim the test now makes after a warm-up cycle.

## Milestone 35 acceptance evidence

| Acceptance item                                                  | Evidence                                                                                                                                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A fresh user completes the entire core loop without intervention | One continuous Playwright session from an empty profile: boot, new game, purchase, save, deploy, combat, results, export, sandbox isolation. 24 seconds, zero console errors |
| All required commands pass from a clean install                  | format:check, lint, strict typecheck, 2,121 unit and integration tests, the browser suites, and the production build, all green in sequence                                  |
| No visible control claims unimplemented function                 | The honest-UI rule has been enforced per milestone since the quality contract; the loop test and the known-issues list in RELEASE_NOTES.md carry the residual gaps openly    |
| Golden scenarios and state hashes                                | Eight digests pinned in tests/integration/golden.test.ts, covering the kernel, economy, co-op, sandbox, audio and three stress scenes                                        |
| Accessibility review                                             | tests/e2e/accessibility.spec.ts, plus the pre-existing hud, vfx and audio coverage it frames                                                                                 |
| Performance on every preset                                      | Dense-city at 180 frames per preset on the production build, recorded in RELEASE_NOTES.md, zero long frames and zero breaches on the reference machine                       |
