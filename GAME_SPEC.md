# GAME_SPEC.md — Pacific Rim: Shatterdome Earth

**Status: BINDING.** This is the permanent authoritative design specification. Never silently remove, weaken, or contradict it. Read this file at the start of every task. If a later prompt conflicts with an earlier decision here, preserve the user's newest explicit requirement and record the change in [TECH_DECISIONS.md](TECH_DECISIONS.md).

---

You are the principal engineer, technical designer, and implementation partner for a long-term browser game project. Build a serious, modular, playable open-world Pacific Rim fan game for private personal use. The game is not a quick mock-up, a static website, a collection of menus, or a cinematic animation. It must become an actual game through a sequence of testable milestones.

## PROJECT IDENTITY

Working title: Pacific Rim: Shatterdome Earth.
Primary fantasy: operate one deeply upgradeable Shatterdome, purchase and research a large roster of Jaegers, select and develop copilots, respond to dynamic kaiju attacks across a seamless miniature Earth, explore the world, fight with heavy but responsive combat, repair lasting damage, and prestige favorite Jaegers indefinitely.
Primary mode: single-player. Optional two-player co-op is battle-only and must never be required for progression. The second player joins a host-controlled battle and uses a separate deployed Jaeger; management, saves, and campaign authority remain with the host.
Perspective: the player can explore the Shatterdome on foot, enter a Conn-Pod, experience functional cockpit instruments, and switch during Jaeger gameplay between cockpit and third-person cameras.
Tone: grounded industrial scale and consequences inspired by the first Pacific Rim film, combined with anime-influenced readability, expressive silhouettes, energetic effects, and a largely emergent sandbox structure. Avoid comedy parody, weightless superhero movement, sterile corporate UI, and generic neon science-fiction visuals.

## LEGAL AND ASSET BOUNDARY

This is a private fan project. Do not scrape, bundle, or redistribute copyrighted film audio, ripped meshes, paid models, leaked concept art, or proprietary game assets. Begin with original procedural placeholders and clearly named asset slots. Make every placeholder replaceable with user-supplied GLB/GLTF models, textures, animations, portraits, sound effects, and music. Store attribution and license metadata for every externally sourced asset. Do not claim a procedural approximation is screen-accurate.

## MANDATORY TECHNOLOGY FOUNDATION

Use a Vite TypeScript project and Babylon.js as the rendering and game framework. Prefer the current stable Babylon.js packages available at implementation time. Attempt WebGPU first and fall back to WebGL without breaking gameplay. Use Babylon.js large-world or floating-origin support, thin instances for repeated scenery, glTF/GLB as the production asset format, and a dedicated physics abstraction so Havok or another supported browser physics backend can be replaced without rewriting gameplay. Use DOM/CSS for dense management interfaces and accessible menus; use Babylon GUI or in-world meshes only for cockpit instruments and diegetic displays that must exist in 3D.

Keep simulation code independent from rendering. Use fixed-step gameplay simulation with interpolation. Put expensive world generation, attack scheduling, navigation preparation, and save serialization in Web Workers where practical. Use seeded deterministic random generation for attacks, weather, salvage, manufacturer rotations, and procedural kaiju mutations. Never use Math.random directly in authoritative simulation systems.

## ARCHITECTURAL MODULES

Create explicit modules for app bootstrap, configuration, state machine, scene lifecycle, rendering adapters, input, cameras, audio, physics, world coordinates, sector streaming, terrain, ocean, weather, time, cities, traffic, civilians, Jaegers, kaiju, combat, damage, destruction, missions, attack director, economy, research, Shatterdome, copilots, progression, roster data, save migrations, replayable sandbox scenarios, networking adapters, UI, debugging, testing, and performance telemetry.

Use data registries for every Jaeger, kaiju, weapon, move, copilot, facility, research node, manufacturer, mission, region, landmark, status effect, and reward table. Runtime code must not contain giant switch statements keyed to individual roster names. Special units should combine shared components, abilities, animation tags, and carefully scoped extension hooks.

## SEAMLESS MINIATURE EARTH

Represent Earth as a continuous scaled globe divided into streamed cube-sphere or equivalent geodesic sectors. Maintain global high-precision coordinates and convert nearby objects to a local tangent frame around the player. Use a floating origin so Jaegers do not jitter. Distant regions exist as strategic simulation records and low-cost visual representations; only the active region uses combat-grade geometry, physics, traffic, destruction, and AI.

The world must include scaled versions of Hong Kong and its Shatterdome/Bone Slums, Sydney, Tokyo, Anchorage, Manila, and additional global coastal regions. Continents, oceans, broad climate zones, shipping routes, military activity, and famous landmarks should establish identity without pretending to be survey-accurate. Long-distance travel uses discovered deployment points and cinematic carrier deployment. Local travel uses walking, running, wading, swimming, and short-duration boosters. Day/night, rain, storms, fog, snow, ocean depth, underwater visibility, regional damage, and gradual rebuilding must affect presentation and selected gameplay variables.

## CORE LOOP

The player explores and upgrades the Shatterdome, monitors global alerts, chooses which emergencies to answer, selects one or more Jaegers and copilots, prepares weapons and supplies, deploys, fights, limits civilian damage, salvages kaiju tissue and wreckage, returns for repairs, completes research, purchases new machines, develops copilots, and explores between crises. Several emergencies may overlap. Ignored regions suffer damage, reputation loss, economic disruption, and slower rebuilding, but the game should avoid irreversible save destruction.

## JAEGER COMBAT

Combat must feel heavy but responsive. Every action communicates mass through anticipation, foot planting, camera impulse, layered sound, debris, water displacement, hit stop measured in milliseconds, and recovery. Responsiveness comes from input buffering, cancel windows that depend on move class, reliable target selection, readable telegraphs, and immediate defensive inputs. Do not make Jaegers float, ice-skate, rotate instantly, or chain endless animation-cancel attacks.

Support light and heavy melee sequences, directional variants, launchers, grapples, throws, counters, guarded movement, short evasive steps, booster repositioning, interactive finishers, ammunition-limited ranged weapons, signature abilities, team commands, and environmental attacks. Older Jaegers remain viable through distinctive strengths, upgrades, player mastery, and infinite prestige; newer Marks gain efficiency and flexible technology without invalidating the roster.

## DAMAGE, DESTRUCTION, AND REPAIR

Track armor and component condition by head/Conn-Pod, torso, reactor, left arm, right arm, left leg, right leg, movement system, sensors, and equipped weapons. Damage changes visuals and capability. Armor panels can detach, paint can scrape, coolant can vent, actuators can slow, weapons can jam, and limbs can become disabled. Battle scars persist until repaired. Jaegers are recoverable rather than permanently deleted.

Cities retain meaningful damage. Use staged destructible building states, structural zones, debris pools, decals, broken infrastructure, and regional damage records rather than fully simulating every brick. Rebuilding occurs over in-game time and responds to funding, facilities, mission performance, and regional security. Civilian casualties should be abstracted into rescue pressure and city-safety ratings rather than graphic content.

## KAIJU AND WORLD DIRECTOR

Include film kaiju, expanded-media creatures, original kaiju, procedural mutations, named bosses, and rare colossal endgame threats. Kaiju must differ by locomotion, reach, armor zones, sensory behavior, aggression, preferred targets, terrain use, special organs, toxicity, and phase mechanics. The attack director chooses targets and mutations from strategic conditions, player habits, biome, escalation level, and seeded randomness. It may create several simultaneous emergencies, but it must respect cooldowns and recovery so the game does not become exhausting.

## SHATTERDOME, ECONOMY, AND RESEARCH

Build one deeply upgradeable headquarters that the player can explore on foot. Important spaces include command, the Jaeger bay, repair gantries, research laboratories, kaiju containment, manufacturing, reactor and utilities, pilot quarters, training, logistics, defense control, memorial/archive, market/contracts, and launch infrastructure. Facilities have visible construction states and mechanical benefits.

Resources come from government contracts, city defense rewards, salvage, kaiju tissue, exploration, side activities, manufacturer relationships, and selected passive facilities. Avoid real-money monetization and manipulative mobile-game timers. Research unlocks weapons, Jaeger technology, research-exclusive Jaegers, facilities, defenses, and efficiency upgrades. Time costs should create planning decisions but always allow useful play while work is underway.

## JAEGER ACQUISITION AND PROGRESSION

The primary acquisition path is purchasing complete Jaegers from rotating manufacturers and contracts. Canon Jaegers also unlock through milestones. Research parts enable exclusive machines. One special custom Jaeger can be assembled from interchangeable heads, torsos, arms, legs, reactors, armor systems, movement systems, weapons, abilities, colors, markings, a name, and an emblem. Its parts must use mass, power, cooling, balance, armor, and slot tradeoffs.

Regular Jaeger levels raise core stats automatically and unlock moves, passives, and module slots. At the level cap, a Jaeger can prestige: its level resets and it gains a permanent but diminishing strength multiplier plus a visible prestige rank. Prestige has no hard cap. Use a mathematically controlled curve, readable forecasts, and catch-up systems so extreme prestige does not destroy all challenge or make new acquisitions unusable.

## COPILOTS

The player avatar has no RPG attributes. The chosen copilot carries the character build. Copilots have identity, personality, link level, Drift compatibility, strengths, drawbacks, signature perks, battle dialogue, and relationship progression. Their benefits can affect combat statistics, special abilities, counter windows, Drift stability, and situational handling. Every strong bonus should have an understandable limitation or play-style requirement. Copilots can be injured and require recovery, but they do not permanently die.

## ALLIED JAEGERS

Before deployment, the player can create a squad from owned Jaegers and available copilots. AI allies develop skills and personalities. During battle, issue simple commands such as focus target, defend area, protect civilians, hold position, use ranged pressure, disengage, and perform a synchronized attack. AI must obey commands without becoming helpless when not micromanaged.

## SAVE, OFFLINE, AND CONNECTIVITY

Solo play must work offline after the required assets are cached. Provide multiple save slots, autosaves, rotating backups, schema versioning, migrations, export, import, and corruption recovery. Store local saves in IndexedDB, not only localStorage. Cloud accounts and cross-device progression are a later optional adapter. Do not require Cloudflare, Firebase, Supabase, or any external service for the first playable game.

Battle-only co-op must be optional and account-free at first. Implement the networking layer behind an interface. The first practical version may use manual WebRTC offer/answer copy-paste or a local-network connection so no signaling service is required. Document honestly that seamless internet matchmaking requires signaling and often relay infrastructure; do not hide that requirement or pretend peer-to-peer discovery happens magically.

## SANDBOX AND CROSSOVER CONTENT

Create a separate simulator/sandbox mode. It can spawn unlocked Jaegers or kaiju, set location, time, and weather, disable costs, disable damage, disable cooldowns, and save custom battles. Optional crossover content includes selected Gundam mobile suits, Evangelion units and Angels, and Attack on Titan Titans. Crossovers may appear as rare dimensional research events in the main world and unrestricted simulator content after unlock. Their scale and power must be normalized into the game rather than copied literally. Pacific Rim progression remains primary.

## PRESENTATION

Use anime-influenced silhouettes, controlled outlines where performant, bold impact frames, expressive VFX, and readable color grouping, combined with industrial materials, rain, fog, ocean spray, warning lights, heat, grime, and machinery. The combat HUD should be cinematic and minimal. The Shatterdome interfaces should be detailed and legible. Cockpit instruments must function and react to real systems. Music should be original cinematic orchestral-industrial work or replaceable placeholders. Every Jaeger and kaiju needs a distinct sound identity. Use radio dialogue and text conversations; provide hooks for later recorded voices.

## QUALITY CONTRACT

Never satisfy a prompt by adding fake buttons, empty panels, TODO-only files, hard-coded demo outcomes, or comments claiming that missing work is implemented. Do not silently delete prior features. Inspect the repository before editing. Preserve unrelated working code. Keep modules reasonably sized. Add unit tests for deterministic systems and browser-level smoke tests for critical flows. Run formatting, type checking, tests, and a production build after every milestone. Report exactly what changed, which checks passed, what remains intentionally deferred, and how to launch the result.

## PERFORMANCE TARGETS

Define Low, Medium, High, and Cinematic presets. Target a stable 60 frames per second at 1080p on a reasonable gaming PC in ordinary play, with a 30 fps fallback during extreme destruction. Enforce budgets for active rigid bodies, AI agents, debris, particles, shadows, reflection probes, audio voices, draw calls, texture memory, and streamed sectors. Add an in-game performance overlay and deterministic stress scenes. Prefer graceful degradation over visual failure.

## IMPLEMENTATION DISCIPLINE

At the beginning of each task, summarize the relevant existing architecture and propose the smallest coherent change. At the end, run all required checks, list manual verification steps, and stop. If a requested system is too large for one safe change, complete a vertical slice and clearly identify the next exact task rather than leaving the project broken.
