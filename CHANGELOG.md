# Changelog

## 2026-08-30, GitHub Pages

- The production build is relocatable: every URL is relative to index.html (`base: "./"` for builds only), the manifest and the icon links are relative, the service worker routes against the folder it lives in, and the audio root, the pack fetches and the worker registration follow the build base. The same `dist/` runs at a domain root, in a subfolder and on GitHub Pages.
- `.github/workflows/pages.yml` builds on every push to `main` and publishes `dist/` to https://bouwles.github.io/Pacific-Rim-Shatterdome-Earth/. The dev server and the tests keep `/`.

## 2026-08-30, Titan Break: the flagship fight

The hunt loop stood, the fight inside it did not. This pass repairs the machine's orientation at its root, replaces the camera, rebuilds the combat around dismantling the creature, gives Knifehead a brain, dresses the harbour, and redraws the HUD. Breadth is still frozen; saves are unchanged (version 17).

- Orientation. Both procedural rigs were modelled front to -Z against a +Z contract, so the machine walked with its back to its heading. One contract (docs/ORIENTATION.md), both rigs rebuilt to it (a Gipsy Danger silhouette: small armoured head, broad layered torso round a circular reactor, blue plate over dark joints, segmented limbs, elbow thrusters, plasma barrel, chain sword; a Knifehead silhouette: blade crest, forelimbs, heavy torso, digitigrade legs, tail, wet material, veins that light), a validator that refuses mirrored, tilted, backward, floating and sunken bodies, an orientation test scene (`?scene=orientation`), and nine integration tests. No camera or input compensation anywhere.
- Camera. A director with eleven states (free, soft framing, hard lock, sprint, close pressure, aim, grapple, clash, knockdown, finisher, boundary), critically damped blending, a look point leaned toward the target, a boom that fits both bodies and pulls in for a sphere cast against the city and the terrain, directional trauma, a field-of-view kick on boost, a 1.4 degree roll clamp. The mouse turns the camera in the same frame in every state; a lock is dragged off and relaxes back. Under a lock the body faces the creature at all times.
- Titan Break. Armour per region (head blade, both claws, torso, both legs, tail) that heavies, charged heavies, counters, the Elbow Rocket, slams and throws crack and strip, shown on the creature (plates glow at the seams, come off, tissue shows) before the HUD; stability as the arena's poise with counters, whiff punishes and slams pushing it, a six second immunity after every stagger; vital damage on exposed regions with the Plasma Caster and the Chain Sword paid extra. Drift Flow rewards variety, perfect guards, timed dodges, exposed hits, grapples at the threshold and slams, and buys faster cooldowns, an extra cancel route, reactor efficiency and the Breaker; it never touches input. The creature remembers an identical chain thrown twice and braces or slips it.
- The kit. Four-hit chain with a running punch off the sprint; forward, side and back heavies; a charged haymaker; guard with a perfect window and two counters (fast body counter, slow guard punish); booster dodge with i-frames; grapple at the stability threshold with a direction and four harbour anchors (ship, crane, container stack, fuel tanks) and the water; Elbow Rocket, Plasma Caster with a short aim state, Chain Sword as a nine second heat-bound mode, Reactor Purge; the Synchronized Breaker on a full meter and deep Drift against a staggered, downed or twice-broken creature, with one direction on the beat and an environmental version by an anchor; Titan Clash when two heavies meet, three a hunt at most.
- Knifehead. Eight moves (left and right claws in strings, blade sweep, blade drive, blade charge, bite, shove, tail sweep), a seeded controller with hunter, wounded and desperate phases, cadence per phase, a memory that refuses a signature three times running, a shove only against sustained pressure and only once in twelve seconds, a water reposition when wounded, a stumble after a charge on a broken leg, and answers to a guarding, overheating or aiming player. Its zones grew leg regions and the pools were retuned around the layers.
- The harbour. A quay with painted lanes, an ice line and snow banks, four sawtooth warehouses, a docked ship with its deck lit, two cranes, a container yard in the palette, fuel tanks with a bund, floodlight masts with real sodium light, two sweeping searchlights, red beacons, barriers at the inland edge and military silhouettes past them. Four pieces are grapple anchors and come apart.
- HUD. The creature's plate at the top centre with health, stability and seven region pips; the machine's integrity, stamina and heat beside a six-part silhouette at the lower left; four ability icons with cooldown arcs and heat or ammunition at the bottom centre, Drift Flow and the Breaker charge as arcs beside them; a combo count; notices that animate in and fade; prompts only for a clash, the Breaker, a grab and a slam. The centre stays clear.
- Training. A simulation from the hangar rail: seven steps taught by doing (walk, light into heavy, guard the claw, dodge the charge, crack the torso, plasma the exposed torso, grab and throw), the creature holding back, Escape to leave, nothing paid.
- Results. Region breaks and the damage breakdown by fists, heavies, weapons and throws join the sheet; a hunt is written to the save when it ends.
- Measured. Direct route `?hunt=knifehead`: control in about 5 s, first contact in about 18 s on the dev server. Scripted representative clears (the bot guards on the frame, dodges the charge, breaks armour with charged heavies, opens the exposed torso with plasma and the sword, grabs at the threshold) took 2:03 to 4:16 of fight; damage by source ranged from chain sword 35, heavies 33, plasma 28, Elbow Rocket 4, grapple under 1, light chain 0 percent on the fastest run to chain sword 55, heavies 28, plasma 11, Elbow Rocket 4, light chain 1.5 percent on the slowest (`docs/screenshots/titan-break/clear-summary.json`); a light-only bot cannot strip armour and loses. The production build on WebGPU runs at 60 fps with 3.9 to 5.5 ms frames and 627 draws; the dev build on WebGL at 5.1 to 5.8 ms with a p95 under 4.1 ms.
- Tests. `tests/integration/orientation.test.ts`, `tests/unit/cameraDirector.test.ts`, `tests/unit/titanBreak.test.ts`; `tests/e2e/titanProbe.spec.ts`, `titanCamera.spec.ts`, `titanClear.spec.ts`, `titanViewports.spec.ts`, `titanSave.spec.ts`. Three golden digests updated for the leg zones and the retuned pools.

## 2026-08-29, FMKH rebuild: the hunt loop

The dense loop was still slow to reach and slow to play. This pass replaces the player path with a hunt loop and retunes the machine so input answers in a frame. Breadth is frozen: no new machines, creatures, regions, currencies or systems. Saves are unchanged (version 17); hunt records live in local storage beside them.

- The path. Title with the live bay behind it; New Game and Continue land in the hangar: the machine at two thirds of the screen, orbit and zoom, name, Mark, level, prestige, condition, pilots, a rail (Hunts, Jaegers, Loadout, Upgrades, Records, Settings, Title) and Deploy, Change Jaeger, Upgrade, Repair. The hunt board is three tiles (Knifehead at Anchorage, Otachi at Hong Kong, Leatherback at Sydney) with category, location, recommended level, difficulty, materials, first clear, traits, weaknesses and runs. A loadout sheet confirms the four abilities and the controls. A six second deployment card with three radio lines and Skip. Arrival on the waterfront, the creature a hundred and forty metres inland, the clock skipped to the hunt's hour so the city reads. Rewards with XP, materials, grade, time, damage, repair hours, Replay, Next hunt and Return. The bay stays alive behind every hangar screen.
- The machine. Locomotion scaled up (walk 1.6x, run 1.8x, acceleration 4.2x, turn 3.4x); move commitments shortened to the targets (jab 117 ms, cross 133 ms, heavy 300 ms startup and 467 ms recovery, dodge 50 ms, perfect guard 133 ms, parry 150 ms); the dodge, guard and parry windows restored to real lengths after the retune. Action layout: WASD, mouse look, a four hit chain on the left button, heavy and charged heavy on the right, F guard and parry, Q dodge, E grab and throw, 1 to 4 abilities, R ultimate, middle mouse lock, Shift sprint, Space booster step. The classic number keys are gone from the player build.
- The HUD. Integrity, stamina, overdrive; creature name, health and posture with a phase badge and a lock mark; four ability icons with radial cooldowns and ammunition; a combo counter; a fading objective line; flashes for the opening, the ultimate and the phases. The centre of the screen is clear and there is no developer text.
- The fight. The encounter director now runs in a hunt (it was gated on the old sortie stage), with phases at 70, 55, 40 and 15 percent. Each hunt carries its own damage scales so a hunt lasts four to eight minutes rather than the sortie's numbers. The Conn-Pod is 12 percent of structure with a plain multiplier rather than 8 percent at 1.6x, so a machine is lost to sustained damage rather than to two head hits.
- Names. Gipsy Danger, Cherno Alpha, Striker Eureka, Crimson Typhoon, Coyote Tango, Gipsy Avenger, Knifehead, Otachi, Leatherback, as text on the same ids, so every save migrates untouched.
- Removed from the player build: the on-foot Shatterdome with imported humans, the globe command screen and briefing, the floating-cube arrival, the numbered punch prompts, objective paragraphs. All of it is still there behind the dev server or `?debug=1`.
- Fixed. The render loop died on its first frame in the player build (a frame hook read before its declaration), which left a black hangar and a dead HUD.
- Tests. `tests/e2e/productionPath.spec.ts` walks the loop and asserts the twenty second and sixty second gates; `tests/e2e/huntFight.spec.ts` plays ninety seconds, samples the HUD and writes the screenshots. Seven unit tests updated for the retune; three golden digests updated for the component shares.

## 2026-08-29, Radical rebuild: one dense loop

The systems were complete and the game still read as a collection of placeholders. This pass rebuilds the player-facing path around one 15 to 20 minute loop and hides everything that is not part of it from a player build. Breadth is frozen: no new machines, creatures, regions, currencies or systems. Every golden hash is untouched. Saves are unchanged.

- People. The crew are imported animated characters (CC0, Quaternius via poly.pizza) loaded once per model and instanced per post, height-normalised, tinted by role, crossfading between idle, walk, work, react and wave. They face the console they work, flinch when an alert lands and go to stations after it. The box figures are gone from every room.
- Props. Rooms are dressed from Kenney's CC0 factory kit: consoles for terminals, machines and crates for obstacles, pipes and catwalks and columns on the walls, bollards at doors, a crane and hoppers in the big bays. The kit palette is restyled to painted steel and safety amber; the untouched original sits beside it. The berths hold the machine rig rather than a box.
- Sound. Kenney's CC0 impact, sci-fi and interface recordings play through a sample library on the existing buses: plate hits, footfalls an octave down, thrusters, knockdowns, crunches, a bell for the break, and interface clicks that sound different for confirming, backing out and everything else.
- The path. Title with Continue and the newest save summary; the dome raises an alert band once the war has a breach in a benchmark district; the command screen puts the globe first with the one live breach as a card; a briefing sheet; the bay with the live machine, structure, pilots, weapons, core figures and machine tabs; a letterboxed deployment cinematic with radio captions and Skip; arrival on the district's waterfront after it has streamed in; an approach with objective and control prompt, the creature 460 m inland; a corner HUD with a six-part limb silhouette; an encounter director that names opening, spacing, signature, disruption, enrage, break, finisher and aftermath and answers each with objective, warning, radio, music and a district power failure; a graded results sheet with consequences, Replay and Return; the next alert on return.
- The district. Kit buildings from the city kit stand on the blocks nearest the arrival, seated into the slope, so the fight is seen against faces rather than boxes.
- Interface. One system in `src/ui/theme.css`: graphite and navy, steel structure, amber for action, cyan for information, red for danger, Barlow Condensed over IBM Plex Mono, cropped corners and brackets. Every button has hover, focus, press and disabled states. Escape in a sortie pauses with Resume, Saves, Settings, Abort and Back to menu.
- Hidden from players. The world panel, the pilot panel, the asset gallery, the simulator, the world map entry and every diagnostic live behind the dev server or `?debug=1`. Allied machines are out of the production sortie: their plasma fire from behind the player destroyed the Conn-Pod before contact in every sortie tried.
- Tests. `tests/e2e/productionPath.spec.ts` walks the path at full speed with `?production=1` on the dev server, title to results and back, and checks every screen fits 1366x768. `tests/unit/encounterDirector.test.ts` pins the phase order and the grade.

## 2026-08-28, Rescue pass: the look of a game

The systems were finished; the game did not look like one. This pass is presentation, feel and cohesion, with no new content and no simulation change (every golden hash is untouched).

- Production builds carry no debug surface. The diagnostics bar, the simulation transport, the coordinate and mesh readouts, the spawn and hit-volume controls, and the pilot diagnostics drawer exist only on the dev server or with `?debug=1`; F3 still toggles the overlay there.
- A title composition instead of a grey box: an articulated machine standing in a dark bay under a cold key and a warm work lamp, a sweeping beacon, rain, fog and a slow camera drift, restored to the boot stage on leaving.
- One design system in index.html: palette tokens, uppercase display type, cut-corner panel chrome, amber-edged buttons, focus states, styled selects and sliders, a fade on every screen mount that respects reduced motion.
- Hero geometry: `JaegerRig` builds a jointed humanoid from parts (helmeted head with visor, chest with a reactor core, pauldrons, jointed arms and legs, feet) with a stride-driven walk, attack windup and recovery poses, a guard, hit recoil and a damage slump; `CreatureRig` builds a skull with a jaw and eyes, dorsal plates, limbs with claws, a lashing tail and bioluminescent veins, with breathing, a windup rear, a strike lunge, flinches and a death slump. Both are parameterised by height, replace the placeholder boxes in the pilot and combat views, and still give way to a real GLB through the resolver. The generator's own stand-in stays attached for its sockets but unseen.
- Combat feel: the arena's active move drives the arm that swings, the guard and the posture; hits kick the body back scaled by the impact grammar; heavy contact fires the low-frequency audio impact at its real distance. The chase and combat cameras sit closer and lower so a machine reads at scale, and the rigs are never pick targets, so the camera's obstruction ray passes through the body it follows.
- The Shatterdome interior: deck plating with seams and wear, strip-lit deckheads, a low ambient with an accent lamp and a cool fill per room, haze, crew drawn as figures with shoulders and heads rather than pillars, and a room panel that leads with the room rather than its coordinates.
- A grade over every camera: ACES tone mapping, FXAA from Medium, a high-threshold bloom on High and Cinematic so only the reactor, visors and plasma bleed, and a faint vignette. Low runs bare. The pipeline is rebuilt when the camera changes hands, which is what WebGPU needs.
- Interface: the pilot panel is HUD first, with systems in a collapsed drawer and diagnostics only in a debug build; the world panel folds to the sortie while a machine is out; instrumentation rows on the map are hidden from players; the update banner stacks instead of squeezing.
- Fixes found by playing: the render loop read the title view before its declaration (a startup crash in production), a clamped dynamic texture painted every interior floor black, a refused pointer lock surfaced as an unhandled rejection, and headless engines no longer try to draw plating.

## 2026-09-10, Milestone 35: release candidate

1.0.0-rc.1. The vertical slices became one game.

- A single continuous browser test walks the whole loop from an empty profile: boot, new campaign, a facility ordered, a manual save, a sortie from alert through carrier to combat, damage, an explained result, the save intact, an export downloaded, and the simulator provably unable to touch any of it. Twenty-four seconds, zero console errors.
- Golden hashes pin the simulation: the kernel, a year of economy under four strategies, a co-op battle, a sandbox run, the soundscape journey and three stress scenes. Changing any of them is now a failed test naming the system that moved, and updating a golden value belongs in the commit that intended the change.
- An accessibility review as assertions: the menu fully keyboard operable, focus visible, controls carrying accessible names, errors as sentences with nothing lost, and severity vocabulary distinct without hue. The deep passes live where the systems live and were already tested; this is the frame around them.
- The dense-city stress scene ran on all four presets on the production build and the numbers are in RELEASE_NOTES.md: zero long frames and zero budget breaches on the reference machine at every level.
- RELEASE_NOTES.md: the save compatibility promise, performance evidence, a content completeness matrix, known issues stated plainly, and the next phase in order.
- Version 1.0.0-rc.1 everywhere: the package, the save metadata, the menu, and sandbox scenario stamps now carry the real build version rather than a stale literal.

## 2026-09-09, Milestone 34: the contract

Performance stopped being a hope and became numbers with names on them.

- Budgets for all four quality levels, each stating the hardware it is promised on: frame time, a long-frame line, draw calls, triangles, textures, shadows, active bodies, AI agents, particles, debris, audio voices and sector memory. The budget table and the quality presets validate against each other, so a preset cannot build more than its budget simulates.
- A profiler cheap enough to leave on: named scopes, a rolling window with p95 and worst, and long-frame capture, because a smooth average full of 80 ms spikes is a bad game that benchmarks well. Counters are registered readers, costing nothing until a report asks.
- A repeatable performance report exportable as JSON: version, browser, GPU, preset, scene id, seed, budgets, frame statistics, the captured long frames, every counter, and the budget lines that were breached, in words.
- Seven stress scenes, registry-named: dense city, storm ocean, four combatants, projectile barrage, maximum destruction, roster gallery, rapid traversal. The three simulation-heavy ones run headless and deterministic in the unit suite; the four renderer-heavy ones run in the browser through the same actions a player has.
- Adaptive quality with real hysteresis: a step down needs ninety consecutive over-budget frames, a step back up needs nine hundred comfortable ones, one step at a time with a cooldown so the change's own cost is never judged. The player outranks it: choosing a level by hand pins it and turns the controller off. It only ever changes the preset; the simulation and every telegraph are identical at every level.
- A leak tracker that inventories meshes, materials, textures, particle systems, transform nodes, render observers, audio voices and workers, and diffs across scene transitions. Three combat entry and exit cycles return the scene to exactly its baseline, held by a browser test.
- The debug overlay grew two lines: p95, worst and long-frame count, and which level is applied and who chose it.

## 2026-09-08, Milestone 33: yours to keep

The game installs, runs offline, and updates without ever endangering a save.

- A web app manifest with original procedural icons, so the game installs as its own window.
- A service worker that caches the shell as it loads: after one successful online load, the whole game boots to the menu with the network gone. Nothing future is downloaded eagerly.
- The caching policy is a pure module the worker mirrors, and a test reads the worker's source to keep the two from drifting. Navigations go network first so a deploy is noticed; hashed assets are cached first-hit for ever; anything under /saves is never cached at all.
- Saves stay exactly where they were: IndexedDB, which a service worker cannot touch and this one additionally refuses by path. Updating deletes old shell caches and nothing else.
- Updates are offered, never imposed. A new version installs in the background and waits. The offer appears only at the menu, the save panel or the simulator, never mid-combat, and can always be postponed. Accepting flushes every save to disk before the new worker is allowed to take over, and the flush's own autosave is visible in the slot list afterwards.
- Optional downloadable packs, starting with an original procedural texture pack. A pack downloads one file at a time into its own cache, which shell updates never delete. A stopped download resumes from the files it already has, a failure names the failing file and offers retry, and removal is a clean restart.
- Every build stamps its worker, because update detection is byte comparison and a worker that never changes would never announce anything.
- Offline needs HTTPS or localhost, and the panel says so plainly where neither holds. A browser with no service workers, or one refusing storage, gets the same game with a sentence explaining what it will not keep.

## 2026-09-07, Milestone 32: the look

The fights got their style, and the style got budgets.

- A style guide written as numbers: a ten-colour palette where every colour has a stated job, roughness floors under every material family so nothing renders as a toy, rim accent strengths, emission ceilings, edge treatment per quality level and an impact grammar with hard limits on everything.
- Edges are fresnel rim accents rather than post-process outlines, on purpose: a screen-space line over a 75 metre machine shimmers at distance, and a rim is computed on the surface so it is stable at any scale. True edge lines exist only on High and Cinematic, and only on meshes tall enough for the lines to be long and straight.
- Thirteen pooled effects: sparks, plasma, steam, coolant, kaiju blue, rain interaction, water displacement, dust, debris bursts, lightning, muzzle flash, finisher accents and speed lines. Each has a per-quality ceiling on instances and particles, allocated once and never grown. An effect over budget is refused and counted rather than costing a frame.
- Impact language: a brief freeze on heavy hits with a cap per rolling second so hits never strobe, the one long hold reserved for a finisher landing, camera impulse through the same decay and comfort scale as a footfall, pose exaggeration that decays back to one, chromatic offset that never exceeds restraint, and speed lines that do not exist on Low.
- The freeze stops the drawn clock and never the simulated one: the arena has already counted the hit, so no amount of frozen frames changes a fight.
- Five accessibility toggles that the whole system obeys: flashes, impact shake, motion blur, particle density and intense colour. A flash-class effect is refused at the only place it can be born while flashes are off, warning colours survive the intense-colour toggle because they are information, and everything persists in the browser beside the display settings.
- A stress scenario that fires three of everything a hundred rounds on every quality level and requires the pool to end exactly at baseline, and an accessibility proof that runs the same hits under every setting and requires zero freezes, zero impulse and zero chromatic where the settings say zero.

The rim accents, roughness floors and impact grammar keep materials industrial and mass heavy. Nothing is cel-shaded, nothing stacks every post-process at once, and no full-screen flash can ignore the settings, because the settings sit in the code path rather than in a checklist.

## 2026-09-06, Milestone 31: a place to try things

A simulator, reachable from the menu, with no costs, no rewards and no way back into a campaign.

- Build a fight: region, time of day, weather, water state, the machine you take, the creature you face, objective, city damage, difficulty and how hard the creatures try.
- Every picker is built from the game's own tables. Any region, any chassis and any creature the build knows is selectable, and adding one later puts it in the list without a line changing. Nothing needs a source edit to spawn.
- Nine toggles: free costs, no cooldowns, invulnerable machines, infinite ammunition, perfect drift, passive creatures, damage that stays, slow motion, and debug drawing.
- The toggles are an overlay, never a setting. A rule set is a small object handed to one run and read where a number is used, so nothing global is written and nothing has to be restored afterwards. A test runs a straight fight, then the same fight with every cheat on, then the straight fight again, and requires the first and third to be identical down to the digest.
- Invulnerability and infinite ammunition put things back rather than switching them off. The hit lands, the round is fired, everything reacts, and then the cost is undone, so a cheated fight still looks like a fight.
- Debug drawing lives behind an advanced panel that is closed by default. Everything else is an ordinary player-facing option, so the normal sandbox stays a game.
- Save scenarios, reload them, delete them, and export one to a block of text somebody else can import.
- A file from another version, or one naming content this copy does not have, is marked and explained rather than half-loaded. The second kind still opens for editing, so a missing piece can be swapped out instead of being a dead end.
- Impossible combinations are refused in words with the run button disabled: a surge somewhere too shallow to dive, damage to a city that is not there, a rescue at the Breach, an escort with nothing to escort, snow in the tropics. Each one names the two settings that disagree.
- Sandbox scenarios and statistics live in their own store. There is no function anywhere that turns a sandbox run into funding, research, salvage, standing, crew experience or prestige, and a test asserts that none appears.
- Runs record whether the cheats were on, and best times count only straight fights.

## 2026-09-05, Milestone 30: a second pair of hands

Two people can now fight the same kaiju, and exactly one of them decides what happened.

- A transport interface with three implementations behind it: a deterministic loopback for tests, a same-machine channel for two browser windows, and a direct WebRTC link for two machines. Nothing above the interface knows which one it is running on.
- The host owns the fight. The guest sends what it is trying to do, and the host decides whether it happens, announces the result, and produces the one outcome. A guest never counts a hit, spends a round or awards anything.
- Two channels, used for what they are for. Damage, ammunition, finishers and the result travel reliably and in order and are applied exactly once. Poses travel unreliably, and losing one costs a frame of smoothness and nothing else. A message type that claimed to be both is refused at registration.
- Sequence numbers on both sides. The host ignores an input it has already applied; the guest ignores an announcement it has already applied. That is why a retransmitted packet cannot double a hit.
- Inputs from too far in the past or claiming to be from the future are refused and counted, rather than applied late and out of order.
- Prediction with a limit. The guest smooths its own movement for twenty ticks and then says plainly that nothing on screen is current, because a machine that keeps gliding for four seconds is a worse lie than one that visibly stopped.
- The host picks the machine it lends. A co-op partner drives something the host's campaign owns, for as long as they are lent it, and cannot change it.
- Late join only at a safe point, a rejoin that keeps the sequence guard so nothing from before a drop can be replayed, a silent guest whose machine holds position instead of vanishing, a pause that stops the fight on both sides at once, and a version mismatch that names both builds instead of timing out.
- The whole thing tears down with the fight: sessions, subscriptions, data channels and the peer connection.

Direct connections between two machines need the two players to swap one block of text each. WebRTC carries data once a connection exists; it does not create one, and there is no server here to do that for them. Two windows on one computer need none of that.

## 2026-09-04, Milestone 29: Something to listen to

The game stopped being silent apart from a noise bed.

- Ten mixing buses with a fader each: master, music, ambience, destruction, Jaeger, kaiju, interface, dialogue, radio and accessibility cues. Every one says what lives on it, and a bus that does not say is refused at registration.
- Ducking with a priority order behind it. A radio call pulls the music down and leaves the accessibility cues exactly where they were, because a cue that stands in for something you cannot perceive must not be the thing that goes quiet when somebody talks.
- Volumes that are remembered. They live beside the display settings rather than in a save, so loading an old campaign does not reset them and starting a new one does not lose them.
- Layered sound instead of one impact for everything. A standing machine sounds three layers; the same machine sprinting on rubble with a torn shoulder and a hot reactor sounds nine. Plate rattles once the frame is damaged and armour tears only past the point where plate is actually failing.
- Twenty eight layers across three profiles: hip and shoulder servos, footfall mass and plate, reactor idle and strain, weapon charge, armour strain and tear, cockpit hum and alarm, water and rubble contact, and two creature categories built from calls, breath, footsteps, drag, plate, organs and abilities.
- A coastal creature and a deep one that do not sound alike from the same state, and a creature that goes under water loses its plate and gains its organs.
- Eleven music states that follow what is happening: the complex, exploring, a warning, deployment, ordinary combat, heavy combat, a final phase, victory, loss and recovery. Urgent changes cut in quickly and calm ones take four seconds, and layers common to both states are held rather than faded out and back in.
- Twenty two written radio lines from seven speakers, each with a priority, a cooldown, a duration and its own text. LOCCENT, the Marshal, the chief engineer, K-Science, an allied ranger, the cockpit itself and the copilot beside you, who is in the room rather than on a radio and is filtered accordingly.
- One voice at a time. Something more important cuts an interruptible line off, a critical line is never cut, chatter is dropped rather than queued, and the queue is bounded at four with the least important thing waiting the first to go. Push forty two lines at the channel at once and no warning is ever the thing thrown away.
- A conversation record that saves. A player who was busy fighting can read back what was said afterwards, and the cooldown clocks come back with it so loading a save does not fire every line in the game again at once.
- Subtitles in the HUD with the speaker's callsign on them, so every line is readable with the sound off or absent.
- Voices are synthesised, not recorded. A band-limited burst on each speaker's own frequency range, so LOCCENT and the person beside you are told apart without a single audio file, and the written line carries the meaning.

Nothing here bundles film audio, film dialogue or a commercial soundtrack, and nothing ever will. Every sound is a synthesis recipe with a clearly named slot a real recording could be dropped into later, and a missing recording plays the placeholder without a word of complaint.

## 2026-09-03, Milestone 28: A cockpit that tells you things

The interface stopped being a debug readout and became something you can fly with.

- A minimal HUD that is minimal because there is usually little to say, never because anything is being kept from you. Component condition, target zones, ammunition, heat, reactor load, abilities, the squad's standing order, the objective and how the city is doing, all on one layer.
- A critical band above everything else that never fades, never shrinks and never waits. Fade the rest of the interface as far as it goes and a failing reactor still tells you so.
- Eleven cockpit instruments reading real systems: heading, speed, depth or altitude, reactor, heat, drift stability, component faults, targeting, weather, radio and the whole weapon loadout.
- Instruments that move because a system moved. Change one value and exactly one instrument changes; the other ten stay exactly where they were. Nothing loops to look busy.
- Severity carried three ways at once. Colour, a glyph, and a border weight, so a reading survives colour blindness, a grey screenshot and a bright screen. Nominal is a tick, caution a triangle, warning an exclamation, critical a double one.
- Four colour-vision presets that keep all five severities visibly apart, and a high contrast mode that overrides them when somebody asks for the strongest separation available.
- Text at four sizes, HUD opacity with a floor under it, subtitles, and reduced motion that sets every animation to zero without removing anything from the screen.
- A warning that says what to do rather than only what is wrong. "Torso 9 percent. Another solid hit here takes it out." "Overheated. Weapons are locked out until it comes down."
- Safe area padding, so nothing sits under a notch or against an edge, and every size derives from the player's own text scale.
- Everything reachable from the keyboard, with a visible focus ring on whatever has it.

None of these settings changes the game. They change how it is shown to you, and a test asserts the same fight comes out the same whatever they are set to.

## 2026-09-02, Milestone 27: Seven places that are actually different

Hong Kong stopped being the only city with a city in it.

- Every land region now has a real city: Tokyo, Sydney, Manila, Anchorage, Lima and Vladivostok as well as Hong Kong. None of them is a record on a map any more.
- Each one is built differently rather than recoloured. Tokyo is capped low by seismic code and packed almost solid. Anchorage is single storey and spread thin under enormous mountains. Manila is a vast low sprawl with a handful of towers standing out of it. Vladivostok steps up hillsides around a narrow frozen inlet. Lima sits on a desert terrace a hundred metres above the sea.
- The numbers bear it out: 256 blocks and 354 towers in Anchorage against 711 blocks and 3,976 towers in Manila, out of the same generator with nothing bespoke anywhere.
- Seven conditions that change how a fight goes: ice, typhoon, dense harbour, volcanic ground, shallow bay, shipping congestion and mountainous approaches. Each moves footing, gunnery, sight, water depth, clutter, collateral and rebuilding, and a modifier that changes nothing is refused outright.
- The same creature is a different fight in each place. It slides twelve metres in Tokyo and twenty in Vladivostok. Ranged fire is worth ninety percent in Sydney and sixty in Manila. You hold a contact at 2,880 metres off Lima and 950 in a Manila storm. In Tokyo and Anchorage the water is too shallow to dive at all, so everything happens on the surface. In Anchorage there is exactly one way in.
- Shorelines that matter. Tokyo is eighteen metres deep and Sydney forty-six, and that decides whether either side can open a fight from under the water.
- Defence postures that differ. Tokyo has eight batteries and six interceptor flights six minutes out; Manila has three batteries and sixteen minutes over a much longer shore.
- Industry that pays. A container port and finance centre pays more for the same contract; a shipyard returns better salvage; a staging post is worth more for research than for money.
- A trade web between places. Wreck Hong Kong and six other regions see their own contract income fall, because the shipping that made them worth defending was going somewhere.
- A region panel that says all of it: the skyline, the shore, the water and whether anything can hide in it, how many approaches there are, the industry, the defences, the traffic and what the local conditions actually mean for the crew.

Places here are described by geography and infrastructure only, never by the people who live in them, and a test enforces it. Everything is a stylised approximation composed procedurally; no commercial map data is used anywhere.

## 2026-09-01, Milestone 26: A planet worth crossing

The map stopped being a list of places you can already go.

- Things to find, in eight kinds: salvage, landmarks, shipping incidents, military exercises, training gates, research anomalies, rescue calls and environmental hazards.
- Nothing is scattered evenly. Every site states what kind of region it belongs in, and the validator refuses one that would fit anywhere. A proving gate only exists at a Shatterdome. A research anomaly only turns up somewhere nobody lives. A rescue call only happens in a city that has been hit. Unstable ice needs somewhere cold.
- Six ways to learn about a place: walking within range of it, a government contract, your own analysts, an allied government, something a carrier spotted on the way somewhere else, or infrastructure you repaired. Some places only ever appear on a chart somebody hands you, which is what makes intelligence worth having.
- A world that stays put. Sites are placed from your world seed, so the same world always has the same things in the same places, and nothing is generated while you are looking at it.
- Nothing pays twice. What has been worked is remembered by name and saved, so walking away and back, crossing a sector boundary or reloading changes nothing at all.
- Places you reach become places the carrier will drop you. A standing span, a ridge line, a wreck with a usable pad: reach it once and it is on the deployment list from then on.
- Travel time you can see. Every found site shows how far it is in kilometres and how long the carrier takes in minutes.
- A route assist that does not decide for you. It offers straight there and by way of everything you know about, with both times shown. Direct is always faster. Stopping is how you find things. That is the whole trade.
- Thrusters that run hot. A burst costs more heat than a second of cooling gives back, so crossing broken ground in hops is a decision rather than a faster walk, and the refusal says which it is: not enough charge, or too hot.
- A map that reports rather than decorates. How many places you have found against how many are still out there, how many machines are ready, how many allied crews have something to fly, and thruster heat, all on the same panel as the world it describes.

An old save keeps everything. Version 15 files come back having found nothing, which is the honest reading of a file written before there was anything out there.

## 2026-08-31, Milestone 25: One machine you build yourself

Every other Jaeger keeps its identity. This one is yours.

- Twelve slots: Conn-Pod, frame, arms, legs, reactor, armour, drive, weapons, abilities, paint, markings and an emblem, plus a name and whatever you want stencilled on the hull.
- Parts fit by fitting rather than by name. Sprint legs offer a light spine and nothing else; the deep magazine frame needs a heavy one and says so. A new part with the right fittings works with everything already there.
- Nothing collapses into one bar. Mass, where that mass sits, power made against power drawn, heat made against heat shed, tons carried against tons the actuators are rated for, armour, structure, balance, mobility, turn rate, rounds aboard, hardpoints used against hardpoints fitted, and module slots are all separate numbers you can see at once.
- No part is simply better than another. A heavier frame carries three times the ammunition and unbalances the machine. A bigger reactor powers anything and makes more heat than most armour can shed. Radiator skin sheds enormous heat and stops almost nothing. A test walks every pair in every slot and fails if one ever dominates another.
- Balance is its own axis. A machine can be quick and unstable or slow and planted, and a badly balanced one takes visibly longer to get back up after it goes down.
- Refusals list everything wrong at once, with the numbers that make it wrong. Short forty megawatts, cooks itself by fifty, carrying two hundred tons more than the actuators are rated for, and the frame needs a heavy spine, all on screen together rather than one at a time.
- Warnings that do not stop you. Eight megawatts of headroom, actuators at their limit, sixty rounds aboard: worth knowing, and your decision.
- A test range that an illegal build cannot leave the bay to reach.
- Blueprints are free. Keep as many as you like, rename them, repaint them, export one as text and import somebody else's. Importing a design never hands you a machine.
- Building is not free. A campaign holds one custom machine at a time, and the only way to get another is to break the one you have. The serial is never reused, so a rebuild is a different machine rather than the same one back.
- A silhouette that comes from the parts. A leg-heavy build stands on visibly longer legs, a heavy frame is visibly bulkier, and every socket a real model would attach to is still there for later.
- The machine that comes out is an ordinary Jaeger. The roster owns it, the bay repairs it and the arena fights it without any of them knowing it was assembled rather than bought.

Nothing here can reach a canon machine. Custom parts have no path to an existing chassis, the assembled machine carries no signature loadout, and a test asserts every shipped chassis is untouched after a build.

An old save keeps everything it had. Version 14 files come back with an empty library rather than a design nobody drew.

## 2026-08-30, Milestone 24: Research, samples and two machines nobody sells

What you learn in a fight now changes the next one.

- Twenty three programmes across nine branches: weapons, materials, reactor, mobility, sensors, kaiju biology, Shatterdome defense, logistics, and exclusive chassis. Every one is a piece of work with people on it, not a percentage on a list.
- Nothing in the tree makes you hit harder. A programme tells you what is coming, blunts something that was hurting you, holds a contact you would have lost, or opens a piece of equipment. Finish the whole thing and you do exactly the same damage you always did, and you know vastly more about what you are hitting.
- Telegraphs you can read. Map the nervous system and the display flags the moment before it commits. Build the behavioural model and it names the move and marks what it is about to threaten. Before either, you read the animation, the way you always have.
- Statuses that stop being sentences. Ablative shielding puts the fire out in a third of the time. Reactive footing keeps the actuators working through a current spike. Nothing is ever made immune to anything.
- Sensors that keep a contact. Signature work holds them further out, the thermal array sees through weather, and adaptive sonar means going under is no longer a way to disappear.
- Twenty one samples, and what you get depends on how the fight went. Which zone you took apart. What it was carrying. Whether you finished it clean or ground it down. Whether you took it alive. What killed it. Whether it happened in a storm or in the water. What you were sent there to do.
- One exotic sample is worth more than a truckload of common, because what makes it valuable is what it came off.
- Fighting the same easy thing over and over stops paying. A category gives up a sample fully the first time and a fraction of it the tenth, so varying what you go after is the efficient way to play rather than the scenic one. It never falls to nothing: a sample you lost can always be replaced.
- Nothing core is behind a lucky drop. Every branch has a road through it built on samples that any kill yields. Rare and exotic gate the spectacular and the optional, never the way forward.
- Two machines nobody sells. The Harmonic frame comes out of materials, weapons and sensor work together. The Leviathan comes out of that plus a recovered core and the ablative programme. Neither has a price, because neither has a seller.
- Building one takes exactly what the bill says: laminate hull sections, a resonance core, alloy, reactor material and money. Short of one component, it refuses and tells you which.
- A research board at the wing's own console. Every programme with what it needs against what you hold, what it will hand over, and the experiment itself while it runs. Nothing has been learned yet, and it says so in words rather than showing you an empty panel.

An old save keeps everything it had. Version 13 files come back with an empty programme and an empty shelf rather than an invented history.

## 2026-08-29, Milestone 23: An economy with books you can read

Money stopped being a number on a panel and became something with a history.

- Six resources, and each one has to earn its place: funding, structural alloy, components, reactor material, kaiju tissue and research data. Nothing gets added that buys the same things as something already there, and the registry refuses it if you try.
- Tissue is graded rather than weighed. One exotic sample is worth more than a truckload of common, because what makes it valuable is what it came off, not how much of it there is.
- Every credit that moves leaves a line. What day, what for, where it came from, and what the balance was afterwards. There is no other way to change a balance, so the ledger cannot fall out of step with the money.
- Income comes from formulas, not from a table somebody typed. A bigger city, a worse creature, a later point in the war and a better result all pay more, and none of that had to be written down twice.
- Six ways to be paid: government contracts, coastal defence rewards for the fights you sat out, salvage rights, exploration finds, manufacturer retainers once a yard rates you, and facility income from a complex that earns while you are not looking.
- Repairs cost money now. A shift in the gantries is billed for the share of the job it covers, broken into labour, materials, an urgency surcharge if you want it now, and whatever is insured. Having the alloy already in stores makes it cheaper. A better bay makes it cheaper. Short of funds, the machine waits, and it says so.
- A difficulty dial that touches income and nothing else. Generous, standard and lean change what the war pays you, never how hard a kaiju hits, because those are two different decisions and merging them takes one of them away from you.
- Nothing pays twice. Every settled reward carries a reference, and the same result handed back after a retry, a reload or a client reconnecting changes nothing.
- The books, on the contracts terminal. What you hold, what the last thirty days brought in and took out, a breakdown by source with a bar so you can see which line is doing the damage, and the last dozen entries in plain words.
- Balanced against a simulation rather than a hunch: 360 in-game days, four ways of playing, run on a seed so it comes out the same every time. Flying everything pays best, picking your battles makes steady progress, standing down a lot is worse and still survivable, and a lean campaign with too much on the pad goes into debt and starts putting off repairs.

An old save keeps its money. Version 12 files carried funding, salvage and samples on the market; those come across as funding, alloy and research data rather than being thrown away.

## 2026-08-28, Milestone 22: Facilities, construction queues and a complex that grows

The headquarters is somewhere you build now, rather than a set of rooms with tiers.

- Fifteen branches, including two that were missing: a Medical Bay next to the quarters it serves, and Kaiju Containment below the waterline for specimens worth keeping alive.
- Every tier costs money to build and money to keep, and says what it is worth in numbers something actually reads: repair speed, construction speed, training, recovery, research yield, contract funding, delivery speed, containment yield, coastal defence.
- A queue instead of a refusal. Order whatever you like; being short of crews means it waits its turn rather than being told no.
- Priorities you set. Move something to the front and the crews are on it the next tick, not after the current job finishes.
- Pause without losing anything. The progress stays and the crews go somewhere more useful. Resume when it matters again.
- Cancel and get back what has not been spent yet, at the same rate every time. Never all of it, never none of it, and never a wait you can pay to skip.
- Forecasts that count what is ahead. Every project says how far along it is and when it lands given everything queued in front of it, and anything stalled says exactly what it is waiting for.
- A complex that is short works slower rather than stopping. At midnight with a third of the posts filled it builds at sixty percent and tells you so, and every facility is worth a little less until the day shift arrives.
- Upgrades you can see. Work lights and stencilled numbers give way to floodlights and lit signs, cranes go up, pallets pile on the floor while work is on and are gone when it is finished, and there are crews on the site while it is being built.
- Prerequisites that never trap you. A test walks the whole graph from an empty complex and proves every room is still reachable, whatever order you built things in.

An upgraded repair bay now genuinely repairs faster, which it never did before: facility tiers used to change the power draw and the furniture and nothing else.

## 2026-08-27, Milestone 21: Allied squads, tactical orders and crews who learn

You do not go out alone any more.

- Up to three other machines come with you, each flown by its own crew with its own opinions about how a fight should go.
- Four crews. Hammerfall closes on everything and always has. Longshot would rather never be within reach of anything. Bulwark goes wherever somebody is about to be hit. Sidestep is nervous, fast, and alive because of both. Hammerfall and Longshot do not get on and will not take the same target.
- They do sensible things with no instruction at all. Nobody has to be told to attack the thing that is attacking you.
- Nine orders when you do want to say something: focus target, defend area, protect civilians, hold, regroup, ranged pressure, conserve ammunition, disengage, and synchronized attack.
- Q opens the quick command and the number row gives the order. Nothing pauses. The fight carries on while you are deciding, and the number row goes back to being the weapon row the moment you close it.
- Every order gets answered out loud, in that crew's own words. Breaking off. Falling back. Getting clear. That is how you know it landed.
- An order changes what they want rather than what they do. Tell them to defend a block and they work out what that means from where they are standing, what is coming, and what they are carrying.
- Some things are not up for discussion. They will not shoot through you. They will not spend their heaviest attack twice. They will not keep firing under an ammunition order.
- They do not stand in each other, they do not both grind the same leg while the head goes unanswered, and they do not all burn their signature on the same swing.
- They get hurt. An ally is another machine with real plating and real components, not a turret that cannot be killed.
- They learn. Fly with somebody long enough and they stop needing to be told to close, or start putting the machine in the way on purpose. Nothing they learn moves a number by more than fifteen percent, because an ally is help and not the answer.
- Confidence moves with how the sorties went, and all of it is saved.

Four problems found by hand. Nobody ever deployed, because no crew had a machine and nothing assigned one. The quick command key did nothing, because the pilot input dispatches from a table that had no entry for it. Disengage did not actually break contact, because a healthy crew scored zero for leaving and the order had nothing to multiply. And ranged pressure let a close-range crew walk straight in anyway, because the minimum range stopped them engaging but not where they repositioned to.

## 2026-08-26, Milestone 20: Copilots, drift links, drawbacks and injury

The two people in the Conn-Pod are the character sheet now. You still have none.

- Five pilots who are genuinely different to fly with. Each is at home in some machines and not others, has tags that read well or badly against a partner, and comes with one thing that makes them difficult.
- A drawback each, and every one of them says exactly when it bites. Anvil walks a long range machine into knife fights. Ledger flies the damage report instead of the fight when the machine is hurt. Kingfisher argues at neural speed with anybody careful. Quartz spends a long approach thinking about the specimen. Tallow cannot fly beside somebody already injured.
- Every drawback is on screen before you commit, on the alert board above the Deploy button, marked by whether it applies to that sortie. Nothing is discovered from the result.
- Drift is worked out from the machine, the weather, the length of the flight, how well the pair know each other, how much they have been through lately, and what they are carrying, and it shows you every term that produced the number.
- Links that grow from things you did: flying together, coming home cleanly, drift training, and talking to somebody off duty. The cheap ones are capped per day, so a relationship is built rather than farmed.
- A perk each that grows with the link and changes what that person is rather than adding a percentage. Anvil braces the machine before an exchange. Ledger runs the reactor the way it was meant to be run. Kingfisher steps off the line and answers. Quartz knows where the tissue gives. Tallow brings the machine and the block back in one piece.
- Swapping the pair changes the machine. The same Jaeger under two crews has different poise, different heat, different speed and different reach, through the same system its own levels and modules use.
- Injuries that hurt nobody permanently. A concussion grounds somebody for nine days. A shoulder tear lets them fly but not swing. Burned hands let them fly but not aim. The medical bay shortens a recovery and never removes it.
- Somebody hurt is a scheduling problem, not a deleted character. Stand a pilot down for three days, treat what they are carrying, and take the best available substitute in the meantime, ordered by who knows the remaining pilot best.
- Nobody is the best answer everywhere. Every pilot has a machine they are wrong for, and the ordering of pairs changes when the machine does.

Four problems found by hand. The drift percentage saturated at exactly one for two different pairs, which made the headline number useless for telling crews apart. Injuries were far too common: ten in twelve sorties, with the crew grounded for two thirds of a campaign. Standing somebody down did not actually stop you assigning them on the next click. And the list of drawbacks never appeared on the alert board, because it was being attached next to an element that was not in the document yet.

## 2026-08-25, Milestone 19: Levels, passives, modules and prestige

Machines get better by being flown now, and the ones you keep flying become yours.

- Experience from every sortie, and from long running goals each machine works toward on its own: sorties survived, fights won cleanly, components never lost, civilians pulled out, salvage hauled home, and structure lost and rebuilt.
- Thirty levels, and each one raises the machine's own numbers rather than adding a separate score. A full climb is about forty five sorties.
- Levels unlock moves. A cross at level 2, a forward smash at 6, a parry at 8, an uppercut at 10, and so on up to a finisher at the cap.
- Four passive choices on the way up, one at each of levels 4, 10, 18 and 26, from a table of ten. Every one of them costs something, and the cost is written on the option before you take it. A reinforced frame takes more punishment and walks slower for the rest of its life.
- Changed your mind: strip every passive back and choose again. It is all or nothing and the bay wants twelve hours per choice, because a rebuild is a rebuild.
- Module slots at levels 6, 14, 22 and 30, plus one for having prestiged at all and one more at rank 10. Nine modules to put in them, bought with real money and fitted with real bay time, and taking one out puts it in stores rather than throwing it away.
- Prestige at the cap. The level goes back to one and the machine keeps a permanent rank. There is no limit on how many times.
- Prestige is worth less every single time, on purpose. Rank 1 is about five percent. Rank 10 is forty. Rank 1000 and rank a quadrillion are worth almost exactly the same, and it never quite reaches sixty percent no matter how far it is taken. That is what lets it be uncapped without eventually deleting the game.
- The panel tells you exactly what prestiging would do before you can press the button, and says plainly when a rank is not worth taking any more.
- A machine bought late into a fleet of veterans arrives with veteran crew and salvaged parts rather than as a liability.
- Kaiju answer a strong fleet by carrying more, not by being given bigger health bars. Same creatures, more mutations.
- Nothing a machine has earned is lost to a prestige except the levels: modules go to stores, scars stay, and the service record keeps every line.

Three problems found by hand. The experience bar drew at zero height because it borrowed a class that only has a size inside a different layout. A module refusal on a new machine read "every slot is full: 0 of 0" instead of saying when the first slot opens. And the level curve was calibrated against nothing at all: reaching the cap would have taken about two thousand sorties. It takes about forty five now, and a test holds it to that.

Two more the game caught on itself: a passive that gave two bonuses and cost nothing, and a module with no downside that anybody could buy. Both were refused at startup by the rules that say a choice has to be a choice.

## 2026-08-25, Milestone 18: Jaeger roster registry, manufacturers and purchasing

There is money now, and a place to spend it.

- Four yards, each with a home, a speciality, a price, a wait and terms it will not move on. Buy from one often enough and it charges you less and builds you quicker, but never for nothing and never overnight.
- A board of contracts at the Contracts Office terminal, which you have to build before you can walk into it. It turns over every fourteen days.
- The board cannot be rerolled. It is derived from your world seed and the rotation you have reached, so asking again, loading the save, or reloading the page shows you the same offers. Nothing is rolled when a save is opened, which is why there is nothing to reroll.
- Offers that describe a machine honestly: four performance ranges shown as bands rather than one power number, what it gives up written underneath, what it costs a day to keep, how long the yard says it will take, what it comes with, how far it can be upgraded, and the terms of the contract in full.
- Buying takes the money once, and you own nothing until it is delivered. A refurbished hull arrives worn, with a percentage on it, and goes straight into the bay.
- Every machine is its own machine. Two built from the same chassis have their own ids, their own yard serials, their own names and their own service records, and buying a second of something you already own gives you a second one.
- Old marks are worth owning. The Mark 1 is 2.9M against the Mark 5's 6.6M, costs half as much a day to keep, is slower and shorter ranged, and has twenty upgrade steps against the Mark 5's seven.
- Machines can also arrive without money: a milestone unlock, a research programme, a wreck rebuilt, or something pulled out of an archive.
- Upkeep on everything you own, charged by the day, on whichever clock you are using. Skipping a fortnight costs you a fortnight.
- No premium currency, no crates, no timers pressuring you into anything. One treasury, plain prices, and an offer sits there for the whole rotation.

Two problems found by hand. Every performance bar read six thousand to nine and a half thousand and filled its whole track, because the percentages were multiplied by a hundred twice. And skipping a month to wait for a delivery left three hundred and thirteen live attacks on the board with the war pinned at maximum, because an attack that landed and was never answered stayed live forever; attacks nobody comes to now close on their own, and sixteen unattended days leave three.

## 2026-08-25, Milestone 17: Deployment preparation, carrier sequence and mission lifecycle

The alert board goes somewhere now. You can answer one.

- Before anything launches, the board tells you what going would mean: how ready you are, how well the pair drifts, what state the machine is in, how long the flight is from where you happen to be standing, how loaded the carrier is, and what the weather is going to do about it.
- Refusals and warnings are different things. A machine still in the gantries, a pair who cannot drift, a carrier loaded past what it can lift: those stop the launch and say so. A half-repaired machine going out into a storm with nothing mounted is merely a bad idea, and the game lets you do it.
- The briefing never knows more than the warning did. A strong signal names what is out there. A weak one says it cannot tell you, rather than quietly leaking what is actually coming.
- A carrier run that is part of the same session rather than a loading screen with a plane on it. Ten to thirty seconds of flight, a Skip button from the first second, and skipping it changes nothing about what the sortie is worth.
- You land in the world you were already in, in the machine, with the objectives running. There is no second game state to fall out of.
- Eight kinds of objective: defend, intercept, pursue, rescue, contain, escort, research and salvage, each with its own idea of what finishing looks like and what failing looks like. Multi-stage crises are a list, and the next stage opens the moment the one before it settles.
- Results that add up. Damage, repair hours the bay actually owes, what the district lost, salvage, samples, civilians pulled out, reputation, what the sortie did to the pair's drift, experience, funding, and a replay recording the seed and the plan you flew. Every line says what produced it.
- Five ways for it to end, and all of them are explained: cleanly, partially, badly, aborted, or with the machine out of contact. An abort keeps everything you had already earned.
- Nothing is ever awarded twice. The only way anything reaches a mission is the simulation reporting it, and asking for the results a second time hands back the same results rather than paying again.

One problem found by hand: the carrier run finished before it could be seen, because its length was measured in mission seconds and those pass sixty times faster than real ones. Ten to thirty seconds now, and still skippable.

## 2026-08-25, Milestone 16: Dynamic attack director and simultaneous world crises

There is a war on now, and it happens whether you are looking at it or not.

- Attacks arrive on their own. Somewhere out in the Pacific something comes through, and the first you know about it is a contact on the board with a region, a countdown and a confidence rating.
- Several at once. Four cities can be waiting on you at the same time, each with how long until it reaches the shore and how long it takes you to get there, and it will tell you plainly when the second number is bigger than the first.
- Warnings that are honest about what they do not know. A strong signal names what is coming. A weak one says there are two contacts and it cannot tell you what they are. It never makes something up to fill the gap.
- Creatures that arrive carrying things. A budget that grows as the war escalates gets spent on mutations: heavier plate, a sprinter build, acid blood, lungs that let a walker take the water route, an organ that finds you through a hillside, tissue that closes while you watch. Each one has a tell, and a good enough warning passes it on.
- You do not have to go. Leave it to the regional defences or stand down entirely, and a strategic model works out what happened: kaiju strength against coastal defences, civilian density making the fight harder, and a margin on the day that can swing a close one either way but cannot turn a rout into a win.
- Every result explains itself. Hover a resolution and you get every number that produced it and the reason behind each: what the creature was worth, what the defences covered, what it cost the city, what it did to escalation, and what it paid.
- It leaves you alone. Regions go on a long cooldown after being hit, nowhere gets chosen twice in a row, there is a hard ceiling on how many things can be happening at once, and every resolution buys a quiet stretch. Nonstop alerts are not difficulty.
- A dial for how much of this you want: rare, standard, frequent or relentless. It cannot be turned off and it cannot be turned into a firehose.
- The same seed and the same decisions give you the same war, every time. Different decisions give you a different one, which is the point.

One problem found by hand: skipping six hours on the panel moved the clock, the weather and the rebuilding crews, and did absolutely nothing to the war. You could skip a week and arrive with nothing having happened. Both paths through time now go through the same call.

## 2026-08-24, Milestone 15: Kaiju framework, senses, behaviour and body zones

Kaiju think now. Not well, but for reasons, and the reasons are different for each of them.

- Nine ways of getting around: walking on two legs or four, coiling, flying, digging, swimming, doing both, crawling up a wall, or simply being too big for any of it to matter. Which one a creature is decides what an obstacle even means to it.
- A serpent cannot turn on the spot. Not "turns slowly": it has to travel to change where it is pointing, and the code enforces that rather than assuming everything pivots like a tank.
- Seven senses, none of which give a creature the truth. It sees a cone in front of it, hears in every direction, feels the ground through vibration, smells what has been past, and it ends up with a guess about where you were, which gets vaguer the less sure it is. Fight something in cover and it is looking for you rather than at you.
- Kaiju remember being hurt. Hit something from somewhere it never saw and it knows roughly where the blow came from, and it holds that longer than it holds anything else.
- Eleven things a creature can want: hunting, closing, flanking, waiting in ambush, climbing, digging, swimming, wrecking what it came for, stopping to eat, breaking off, and going past caring. It scores all of them every tick and takes the best, with enough margin that it does not flicker between two.
- Three creatures who do not fight alike. A brawler that walks at you and stays. A serpent that waits out of sight, then comes at you from the side rather than the front. And a digger that will not fight you at all if it can help it, because it came for the Shatterdome and you are in the way.
- Bodies that come apart in specific ways. Chest plate off before the chest is worth hitting. A throat sac that, once burst, ends the acid spit for good. A fin that, once taken, means the thing cannot corner. Phases that make a wounded creature slower and angrier and a nearly dead one faster and worse.
- A debug view that says what it is doing and why: the goal in words, the alternatives it weighed with their scores, every contact it has and which sense found it, what navigation did about the road, and what is left of the body.
- The fixed attack cadence is gone. Creatures used to swing every four seconds because a schedule stood in for behaviour. Now they close, hold, back off or ignore you entirely on their own.

## 2026-08-24, Milestone 14: Staged city destruction, debris, regional persistence and rebuilding

Hong Kong can be knocked down now, and it stays knocked down.

- Fight in the streets and the streets go. Blocks take damage where the fight happens, buildings come down in whole numbers, and the rubble ends up in the road. What is left standing around the hole is untouched: this is damage to a district, not a slider on a city.
- Seven states, and only three of them come from being hit. Intact, damaged and breached are how much is left standing. Collapsing, ruined, cleared and rebuilding are stages the city moves through over time and work.
- Fires that burn, contamination that lingers, and people still under the rubble. A warehouse district leaves poison behind; a tenement stack leaves the most people trapped. The panel tells you how many, and how badly rescue crews are needed.
- Rubble you can watch land. Chunks are thrown out of a collapse, bounce once, and settle, and the moment they settle they stop costing anything. There is a hard ceiling on how many can exist, set by your quality preset, and a collapse that wants more than the game has room for is told so rather than quietly given less.
- The damage is still there when you come back. Leave the city, leave the ground view, load a save from three sessions ago: the same blocks are still down. What gets saved is a handful of numbers for each block that was touched, so a levelled Hong Kong is about five kilobytes rather than a copy of the scene.
- Time does something. Come back a day later and the fires are out and people have been pulled out. Come back a week later with crews on the job and the rubble is gone and something is going up in its place. Nothing snaps back to new.
- Rebuilding is work, not a countdown. Crews clear before they build, take the worst block first, and go faster if you have actually built the logistics and fabrication facilities to back them. A region that is not secure slows them down, and a rebuild you have not paid for stalls and says how short it is.
- One button, on the world panel: the worst block in the city, what it will cost in hours and money, and crews on their way. It refuses out loud when there is nothing to clear, when work is already underway, or when the place is still on fire.

One problem found by hand, after the tests were green: the +1h and +6h buttons moved the clock and the weather and did nothing at all for a burning city. Six hours would pass and the fires would still be burning and the crews would still be standing there. Both paths through time now go through the same recovery.

## 2026-08-24, Milestone 13: Localized Jaeger damage, scars, disabled systems and recovery

A machine is no longer a health bar. It is a Conn-Pod, a sensor mast, a torso, a reactor, two arms and two legs, and what happens to each of them is different.

- Damage lands where it landed. Take a tail sweep across the shins and it is the left leg that comes back at seventy four percent, not "the machine" at ninety seven. Every component has its own structure, its own armour, and its own state, from scarred through damaged and barely holding to gone.
- The kind of damage matters as much as the amount. A neural weapon is worth three times as much against a Conn-Pod as against a leg. A piercing round is worth almost twice as much against a reactor. Nothing in the code knows either of them by name; it is a multiplier on a row.
- Losing a part costs something specific. Lose the right arm and the plasma caster and the chain sword go with it, and say so when you pull the trigger. Lose a leg and the machine walks and turns slower, and past a point it does not walk home at all. Lose the Conn-Pod or the reactor and the sortie is over.
- Scars that stay. A blow heavy enough to leave a mark leaves one, on the part it hit, and the machine wears it afterwards. The mark is four numbers, and the torn plate is grown from a seed, so a machine that has been through twenty fights costs no more to save than one straight off the line.
- Losing does not delete your machine. It comes back. If it can still walk it walks into the gantries; if it lost a leg or something critical it is towed, which takes twelve hours before anybody can start work; if it is barely there it is rebuilt rather than patched.
- A repair board on every berth. Walk up to a machine in the bay and you get its structure, every component with what is left of it, what is offline, how many marks it wears, and a work order with real hours and a real parts bill, replacements costing half again over patching. Put a shift in and the crew takes the worst component first, because that is the order that gets the legs back before the paint. Finish a component and its marks come off with the plate.
- A machine that cannot go out says so, under the button that would have sent it, with how many hours it is short.

Two problems found before this shipped.

The repair queue could stall forever behind a job whose hours rounded down to zero: a one point scratch on a sensor mast would hold up a leg replacement indefinitely. Work orders are now sorted worst first, and a shift always spends something.

And on an undamaged machine the panel read "all answering · all systems answering" with a trailing separator hanging off the damage line, which is the sort of thing that is invisible in a test and obvious the moment you look at it.

## 2026-08-24, Milestone 12: Ranged weapons, ammunition, heat and signature abilities

The machine has guns now, and they cost something. Seven weapons sit on the number row, and none of them is a button that deals damage forever.

- Eight behaviours through one piece of code. A plasma caster arrives the instant you fire it. Missiles leave in a salvo of three. The mortar arcs, and refuses point blank. The rotary cannon empties ninety rounds into something at close range. The arc whip puts a line on a creature and holds it there. The chain sword runs for as long as you hold the key. The booster strike is a charge, not a shot. What changes between them is a row of data, not a branch in the code.
- Ammunition that runs out and reloads that take time. Magazines, spare rounds, and one key that reloads whatever is emptiest. A weapon that has run dry says so and tells you whether there is anything left to load.
- Heat and reactor power as the other two costs. Hold the chain sword and the machine gets hot, because a channel pays its heat sixty times a second rather than once a swing. Nothing fires for free: a weapon that costs no ammunition, no heat and no power is refused before the game will even start with it in the table.
- Every refusal is a sentence. How far past a weapon's reach the target is, in metres. That the mortar needs a hundred and eighty metres of daylight. That the cannon only fires forward and you are facing the wrong way. That the missiles need a lock. That the magazine is empty. Nothing quietly does nothing.
- Rounds that are real objects with a hard ceiling. The pool is sized by the quality preset and never grows; a barrage that would exceed it is refused out loud rather than thinned in silence. Each round is swept from where it was to where it is, so a shell cannot pass straight through something between two ticks.
- Nothing left flying. A round is gone the moment it leaves the fight's own bubble, runs out of range, hits the ground, or reaches its lifetime. There is no shell still travelling over the Pacific ten minutes after the fight ended.
- Status effects that keep working after the shot lands. Burning, shocked, bleeding, corroded, tethered. Each says what it does per tick, what it does to movement and output, and how it ends. Fire and corrosion go out in the sea.
- A way for anything that is not a player to choose a weapon, and explain itself. One score and one sentence out of the same numbers both sides already have, so an AI, a training hint and a test cannot disagree.

Four problems found by hand in the browser, none of which any of the automated suites had noticed.

The worst one: every shot, reload and refusal was missing from the log. A combat step can only report what that step produced, and a trigger is pulled between two ticks, so all of it was being dropped on the floor. The arena now keeps a drain cursor and the panel reads that.

Weapons fed by heat or reactor power read as "no ammunition", which looks exactly like a weapon that is out of ammunition. They say how they are fed instead.

Status effects were logged by their internal ids, so the line under the readout read "status.bleeding" rather than telling you anything.

And the coaching line, which is meant for advice, was being taken over by every routine shot going off as asked.

## 2026-08-24, Milestone 11: Melee combos, defence, counters, grapples and finishers

There is a fight here now rather than a set of attacks. Walk into range, throw a jab into a cross into a heavy, and watch the combo counter climb. Or stand your ground and parry, or take hold of the thing and put it through a building.

- Directional attacks: the heavy is a different move depending on which way you are pushing. Forward is a smash that closes the distance, sideways is a spinning backhand that answers something that circled you.
- One charged attack. Hold it and the damage more than doubles, and nothing interrupts you while you wind it up, which cuts both ways.
- Dodging that does not erase everything. The invulnerable moment is in the middle of the step rather than at the start, it costs stamina, it has a recovery you can be punished during, and it only comes out of moves that allow it. A dodge is an answer, not an escape hatch.
- Blocking, perfect guards and parries. Hold guard and you take a quarter. Raise it as the hit lands and you take nothing and they are left open. Time a parry and you get a free counter, but miss the window and it is worse than not trying at all.
- Grapples that both sides are involved in. Seize them and there is a struggle: they push to get loose, you push to hold on, and the hold runs out on its own if neither of you wins. While you have them they cannot swing at you.
- Throws and wall slams, with the space checked first. A throw that would put them through a tower does not happen; you let go instead and it says so. A slam needs something solid behind them, and a slam with nothing there leaves you still holding on rather than costing you the whole grapple.
- Environmental weapons. Pick up a gantry crane, a bridge section, a fuel tanker or a slab of roadway and swing it. One move covers all of them; what changes is how heavy it is, how far it reaches, how hard it hits and how many swings it survives. A container ship gets exactly one.
- Finishers that are a short sequence rather than a cutscene. Four beats with their own camera framings, two of which need you to keep holding the input. Anything that hits you stops it, and you keep the damage you had earned rather than all of it or none of it. They are rare on purpose: the target has to be nearly finished and either reeling or already in your hands.
- Three accessibility settings, all producing the same damage. Reduced motion flattens every finisher framing to one wide shot. Hold to complete, which is on by default, turns repeated presses into a held input. Skip sequences applies the whole outcome at once.
- A move list written from the game's own move table, so it can never describe a move that does not exist or miss one that does. Every entry has the key you press, a speed in words, and a line of coaching. There is not a frame count anywhere in it. Under the readout there is a coaching line that says what just happened: why the dodge missed, that the hold is slipping, why the throw became a release.

Six problems, all found before anybody had to look at a screen.

A parry promised a free counter and then the arena refused it, because the parry was technically still running and a parry cancels into nothing.

A seize took hold the moment it was thrown rather than when it connected, which meant a finisher out of a grapple was refused as an illegal cancel out of a move that had not finished.

A failed slam silently dropped the hold, so trying to slam somebody in open ground cost you the whole grapple for nothing.

Grapple impacts reduced a creature's core health without going through the check that notices a creature has died, so a fight could carry on with the thing already at zero.

The struggle numbers were so far out that a hold lasted eight ticks, which is not a grapple, it is a nudge.

And a zone that was already destroyed carried on absorbing hits, so taking a creature's armour apart was decorative. Hits now fall through to what is behind.

## 2026-08-24, Milestone 10: Combat targeting, input buffer, and attack framework

There is something to fight, and a language every fight will be written in. Take a machine out, press spawn test kaiju, walk into range, and throw a jab into a cross into an overhead hammer.

- Every attack is a row of data. How long the wind-up is, how long the fist is dangerous, how long you are stuck afterwards, how far the move carries you, how much you can still turn while it runs, what it cancels into and when, where the damage lands and what it costs in stamina and heat. No attack lives in an animation string, and no code knows a move by name.
- Hits are swept rather than sampled. A fist crosses twenty metres in five ticks, so the volume is tested along the whole path it took rather than at the two ends of it, and it works the same way when the creature is the thing moving.
- A kaiju is not a health bar. It is a head, a torso, a core, two limbs and a tail, each with its own health, its own armour and its own consequence for being destroyed. One of them ends the creature and the others cost it something specific.
- Four ways to say what you mean. A swing thrown at something obvious lands on it. A lock holds one target through a camera change. Cycling walks across what is on screen from left to right. Aim mode picks a body zone, which is the only way going for the core means anything against something eighty metres tall.
- Reactions are shared. Flinch, stagger, guard break, launch, wall impact, knockdown and component shock, and a machine goes through them exactly the way a creature does. A tail sweep knocks the machine down and the locomotion controller takes it from there.
- Poise decides staggers. Slow expensive moves can knock down outright, everything else has to spend a target's balance first. This is the rule that stops a good machine holding a creature in a stagger for a whole fight.
- Presses are buffered. A button pressed a fifth of a second before the machine can act on it still fires, and one pressed while flat on your back expires rather than going off when you stand up.
- Illegal cancels are refused with the reason written out. Too early, too late, into something the move does not cancel into, or out of a swing that missed and had to land first. The refusals go in the log next to the hits.
- The hit log says which volume connected, on which tick, against which body zone, for how much, and what reaction it caused. Turn on hit debug and the zones are drawn where the resolver believes they are, shrinking as they take damage.

Three problems the tests found before anyone had to look at a screen.

Component shock outranked a heavy attack's own reaction, so every heavy that also carried shock was quietly downgraded to a twitch nobody could see.

Then, with that fixed, heavies staggered on every landing, and the creature spent an entire fight on its back without acting once. Poise now gates staggers and the fight goes both ways.

And a destroyed body zone reported itself destroyed again on every hit that landed anywhere near it, so a head could be lost seven times in one exchange.

Nothing about a fight is saved. Damage that outlives a battle belongs to the per-component damage milestone, and guessing at that milestone's save format now would be inventing a schema to throw away.

## 2026-08-24, Milestone 09: Jaeger locomotion, scale, and camera foundation

You can take a machine out and drive it. Pick one from the world map's ground view, press take the machine out, and the roster entry you were inspecting in a Shatterdome berth is standing in Hong Kong under your control.

- One controller for every machine. Everything that separates a heavy tank from an agile frame is a row of numbers: speeds, acceleration, braking, turn rates, step height, slope limit, stride length, booster, and how long it takes to get back up. The code driving them has no idea which one it is driving, and three machines ship to prove it.
- Mass is acceleration, not camera shake. A Jaeger takes a couple of seconds to reach a walk, keeps rolling for a long moment after you let go, turns badly while running and well while planted, and puts a foot down every twenty seven metres of ground it actually covers.
- Twenty states, from standing and starting through walking, running, strafing, guarded movement, turning on the spot and stopping, to stepping up, falling, landing, wading, swimming, walking the seabed, boosting, being knocked back, being knocked down, getting up, limping on a dead leg, and dying.
- The ground is checked before it is stood on. Wrecked cars and rubble are walked straight over, a loading ramp is stepped onto, a cliff face stops the machine rather than being climbed, and walking off a shelf is a real fall with a real landing.
- Three cameras: a wide chase camera for exploring, a tighter one for fighting, and one inside the Conn-Pod. Switching between them changes where your eye is and nothing else. Where you were looking, what you had locked, your comfort settings and the controls all survive the swap.
- Comfort controls sit on the pilot panel rather than in a settings menu, because that is where you want them when a camera is making you ill. A motion slider, reduced motion, invert look. Turning all of it off does not turn off what tells you how big the thing is.
- Scale is shown rather than claimed. Eight metre street lights go past the ankles, aircraft and birds cross overhead, footprints stay on the ground behind you, dust rises where a foot landed, and a footfall a kilometre away is heard three quarters of a second after it is seen.
- Buffered input. A booster press made slightly too early still fires when the machine can act on it, and one made while the machine was flat on its back expires instead of going off when it stands up.
- Nothing new is saved, because nothing new is history. A machine out on the ground is a live session, and where it walked is already saved by the world.

Three defects were found, two of them only by looking at it.

The machine was invisible. The streamer draws a white box where the player is when nothing else represents them, and it was standing in exactly the same spot as the Jaeger, at exactly the same height, hiding it completely. It is switched off while a machine is being driven.

The pilot panel wiped the world panel. It cleared the container it was rendering into, which took the streaming readout down with it. It appends now.

And the heading lag on the panel read zero whenever the stick was released, because it was measuring against the steering intent, which is null when nobody is steering. It measures against where the player is looking instead, which is a number that means something at all times.

## 2026-08-24, Milestone 08: Explorable Shatterdome and on-foot player

New Game no longer lands on a screen that says the Shatterdome is not implemented. It puts you on the command floor, at eye height, with six people on shift around you and the Marshal telling you how much power is on the board.

- Thirteen facilities, each a rule rather than a room: a footprint, a deck, the stations it holds, and a ladder of tiers that cost time, crews and power and give back staff, fixtures and one honest sentence about what changed. Adding a facility is a row.
- Two constraints and no invented currency. Power comes from the reactor and everything else draws it, so a laboratory can be refused because the reactor cannot carry it. Crews come from logistics and are tied up for the length of a build, so a third order at once is a decision. Money and contracts arrive with the economy milestone, and nothing here pretends otherwise.
- The complex is a graph of rooms rather than one enormous interior. Only the room you are standing in exists, so the hundred and thirty metre Jaeger bay costs nothing while you are in the archive. Doors, lifts and trams are real edges with real travel times, and the room swaps at the darkest point of a short fade.
- A facility you have not built has no room at all, and the doorway that would lead to it is sealed and tells you which one is missing. Order it and the scaffolds go up in that room immediately. When the work lands, the bulkhead becomes a door you can walk through.
- Walking is at person scale and every number is written down in one place so it can be compared against a seventy five metre machine. You walk, run and crouch, slide along walls instead of sticking to them, and cannot pass through a console even at a full run in a long frame.
- The whole interior is playable without a mouse. Tab cycles what is in the room and turns you to face it, E uses it, arrows look, U puts you somewhere clear if geometry ever traps you, and every prompt is mirrored to a screen reader.
- Management happens at terminals you walk up to, not in a menu. The board lists every facility with its deck, tier, power draw and staff, the next tier with its cost in crews and minutes, and an Order button that is greyed with the reason when it cannot be pressed.
- Berths hold the roster machines and resolve them through the same asset pipeline everything else uses, so dropping in a real model is still a data change. The Conn-Pod is a room you board rather than a camera move, and its instruments read the live world outside: the time, the weather, the wind, how far you can see, and what the alert level is over the city.
- Nobody is simulated outside the room you are in. A facility's population is one integer derived from its tier and the hour, and inside the active room those numbers become positions that are a function of index and tick, so a crew member has no state to update and nothing to save.
- Fifteen named crew, original characters written for this project, each with a post, a shift and lines whose blanks are filled from live facility state. The night watch is a different person from the morning one, and half the accommodation deck is asleep at eight in the morning because the steward says so.
- Saves moved to version 5, carrying the facilities, what is being built and how far along it is, where you were standing, and which machine you had selected. The rooms themselves are never saved: they are laid out again from those records.

Six defects were found and fixed. Four of them only showed up once there was something to look at.

The ceiling was black. A hemispheric light lights downward faces with its ground colour, and the ground colour was almost nothing, so an enclosed room had what looked like a hole above it.

Every fixture glowed. One emissive value for all of them turned a desk, a doorframe and a console into the same white block. Screens and hatches are lit from inside now; furniture is not.

The staff were standing inside their own desks. A post is a piece of furniture with a footprint, so a person placed exactly on it is invisible. The first staffed room I looked at reported six people and showed an empty floor.

Then it reported six people and still showed an empty floor, for a different reason. The instance pool is allocated with everybody parked below the deck, which put its bounding box nowhere near the room and had the whole mesh culled. Refreshing the bounds fixed the culling and it was still empty, because on WebGPU a thin instance buffer whose count grows from zero is not picked up by marking it updated: the buffer has to be set again. It is, now, when the number of people changes rather than every frame.

The radio repeated itself. With two or three lines to a character and one character on shift, picking blind said the same thing three times running, which reads as a broken radio rather than a quiet one. It now walks past whatever was just said.

And the Conn-Pod was a black void with one glowing hatch in it, because the room lamp's range stopped halfway across a four metre room.

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
