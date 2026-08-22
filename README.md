# Pacific Rim: Shatterdome Earth

An open world Pacific Rim fan game that runs in the browser. Private personal project, built in TypeScript on Babylon.js.

You run one Shatterdome. You buy and research Jaegers, pick and develop copilots, answer kaiju attacks anywhere on a scaled down Earth, fight, take real damage home, repair it, and keep upgrading favourite machines indefinitely.

## Current state

The project is built in numbered milestones. Everything listed here actually runs today. Nothing below is a mockup.

- Boots into a real 3D scene, WebGPU when the browser supports it, WebGL otherwise, with no gameplay difference between the two
- Application state machine covering Boot, MainMenu, Loading, Shatterdome, Deployment, Combat, Results and Error
- Main menu with a working New Game flow into a clearly labelled Shatterdome placeholder
- Deterministic simulation kernel that runs on a fixed timestep, independent of framerate and of the renderer
- Seeded random number streams, one per subsystem, so runs are reproducible from a single seed
- Versioned, serializable commands and events with validation that fails loudly and early
- Entity system with stable ids, spawn and despawn rules, and a component registry
- Save and load of full simulation state with schema versioning, plus a state hash used to prove determinism
- Debug overlay on F3 showing renderer, framerate, frame time, draw calls, simulation tick, entity count, physics bodies, seed and run state
- Pause, single step, and 0.25x to 2x slow motion from that overlay
- Headless scenario runner that replays a fixed scenario and hashes the result, so any loss of determinism is caught by a test
- Asset pipeline with typed manifests, eight parameterised procedural generators covering Jaegers, kaiju, buildings, vehicles, ships, props and Shatterdome modules, named attachment sockets, and validation of scale, orientation, origin, skeletons, animation clips, textures and per class budgets
- Asset gallery reachable from the main menu, where every placeholder can be rotated, measured, damaged and swapped to a different manifest
- A scaled cube sphere Earth with real latitude and longitude, 1,536 sectors, and a floating origin that keeps the numbers small however far you travel, so nothing jitters
- A globe map you can deploy from, showing where you are, which sector you are in, and which regions are being simulated in detail rather than tracked as records
- A ground view that streams the world in as you move: generated terrain with coastlines, hills and seabed, water, city blocks, roadside traffic markers and landmarks, all built from the world seed so the same seed always gives the same planet
- Sector streaming with levels of detail, mesh reuse, memory budgets and a cache, so flying across the world never stutters and never grows: terrain is generated on a background thread, and what you have already seen is remembered rather than rebuilt
- A stress route you can fly from the panel, and a live readout of everything streaming is doing, from generation time to memory to how many sectors are loaded
- Offline saves in IndexedDB with named slots, thumbnails, play time, rotating autosaves and backups, export and import, corruption recovery from the last good backup, versioned save migrations, and a storage panel that reports usage and warns when the browser may evict data

Not built yet: the walkable Shatterdome, Jaeger combat, kaiju behaviour, the economy, copilots, and everything else in the list below. The terrain is broad strokes rather than real geography, the buildings are placeholder blocks, and the traffic markers do not move. There is no player controller yet, so you move around with teleport and walk buttons. Those arrive milestone by milestone. See ROADMAP.md for the order and IMPLEMENTATION\_STATE.md for exactly where things stand.

### Using your own models

The game ships with no model files and renders entirely from generated placeholders. To install a real one, drop a GLB into `public/assets/models` and point that asset's `source.url` at it in `src/data/assets.ts`. Nothing else changes, because gameplay refers to manifest ids and socket names rather than to meshes. If a file is missing or broken the game logs one warning naming the path and falls back to the placeholder instead of crashing. Open the Asset Gallery to see any model measured against its manifest and its budget. Full details are in `public/assets/models/README.md`.

## What the finished game is meant to be

### The Shatterdome

One heavily upgradeable base you can walk around on foot. Command, Jaeger bay, repair gantries, research labs, kaiju containment, manufacturing, reactor and utilities, pilot quarters, training, logistics, defense control, memorial, market, and launch infrastructure. Facilities have visible construction states and real mechanical benefits.

### Jaegers

Bought from rotating manufacturers and contracts, unlocked through milestones, or built from researched parts. One custom Jaeger can be assembled from interchangeable heads, torsos, arms, legs, reactors, armour, movement systems, weapons and abilities, with real tradeoffs in mass, power, cooling and balance, plus your own colours, markings, name and emblem.

Jaegers gain levels, moves, passives and module slots. At the cap they can prestige: level resets, a permanent strength multiplier is added, and a visible prestige rank goes up. There is no cap on prestige. Older Marks stay useful through distinct strengths, upgrades and player skill rather than being replaced.

### Combat

Heavy but responsive. Mass is communicated through anticipation, foot planting, camera impulse, layered sound, debris, water displacement and recovery frames. Responsiveness comes from input buffering, move dependent cancel windows, reliable targeting and immediate defensive inputs.

Light and heavy melee chains, directional variants, launchers, grapples, throws, counters, guarded movement, evasive steps, booster repositioning, finishers, ammunition limited ranged weapons, signature abilities and environmental attacks.

### Damage and repair

Armour and condition are tracked per part: head and Conn-Pod, torso, reactor, both arms, both legs, movement, sensors and each equipped weapon. Damage changes how a Jaeger looks and what it can do. Panels tear off, coolant vents, actuators slow, weapons jam, limbs go dead. Scars stay until repaired. Jaegers are recovered, never deleted.

Cities keep their damage too, through staged building states, structural zones, debris and regional damage records. Rebuilding happens over in game time and responds to funding, facilities, mission results and regional security. Civilian cost is abstracted into rescue pressure and city safety ratings.

### Kaiju

Film kaiju, expanded media creatures, original designs, procedural mutations, named bosses and rare colossal threats. They differ in movement, reach, armour zones, senses, aggression, preferred targets, terrain use, special organs, toxicity and phase behaviour. An attack director picks targets and mutations from world conditions, your habits, the biome, the escalation level and a seed, and can run several emergencies at once without becoming exhausting.

### The world

A continuous scaled Earth streamed in sectors, with floating origin so nothing jitters. Hong Kong and its Shatterdome and Bone Slums, Sydney, Tokyo, Anchorage, Manila and more coastal regions. Only the active region gets combat grade geometry, physics, traffic and AI. Day and night, rain, storms, fog, snow, ocean depth and underwater visibility all affect how things look and play. Long trips use discovered deployment points and carrier drops. Locally you walk, run, wade, swim and boost.

### Copilots

Your avatar has no stats. The copilot carries the build. Each has a personality, link level, Drift compatibility, strengths, drawbacks, signature perks, battle dialogue and a relationship that develops. Strong bonuses always come with a limitation or a playstyle requirement. Copilots can be injured and need recovery, but they never die permanently.

### Allied Jaegers

Build a squad from the machines and copilots you own. AI allies grow their own skills and personalities. In battle you can order focus fire, area defense, civilian protection, hold position, ranged pressure, disengage and synchronised attacks. They stay competent when you leave them alone.

### Economy and research

Money comes from government contracts, city defense rewards, salvage, kaiju tissue, exploration, side activities, manufacturer relationships and some passive facilities. Research unlocks weapons, Jaeger technology, exclusive machines, facilities, defenses and efficiency upgrades. No real money purchases and no mobile game timers. Waiting on work never blocks you from playing.

### Sandbox and crossovers

A separate simulator mode where you can spawn anything unlocked, set location, time and weather, turn off costs, damage and cooldowns, and save custom fights. Optional crossover content includes selected Gundam mobile suits, Evangelion units and Angels, and Attack on Titan Titans, appearing as rare dimensional research events in the main world and freely in the simulator once unlocked. Their scale and power are rebalanced to fit rather than copied across. Pacific Rim progression stays the main game.

### Co-op

Single player is the real game. An optional two player battle only mode lets a second player drop into a fight with their own Jaeger. Progression, saves and campaign authority stay with the host. It is never required to progress. Early versions connect by hand, no account and no server.

## Running it

Needs Node 18 or newer. No accounts, no API keys, no external services.

```
npm install
npm run dev
```

Then open the address it prints, usually http://localhost:5173.

Add `?seed=12345` to the URL to run on a specific seed. The seed decides the whole planet, so the same seed always gives the same coastlines and cities. Press F3 to toggle the debug overlay.

### Other commands

```
npm run build         production build
npm run typecheck     strict TypeScript check
npm run lint          ESLint
npm run format        Prettier
npm test              unit and integration tests
npm run smoke         Playwright browser tests
```

## Layout

```
src/simulation   fixed step clock, loop, kernel, commands, events, seeded RNG, state hashing
src/entities     entity ids, lifecycle, components
src/assets       asset manifests, procedural generators, model validation, resolver
src/world        globe coordinates, cube sphere sectors, floating origin, regions, terrain, sector streaming
src/workers      terrain generation off the main thread
src/saves        save schema, migrations, IndexedDB storage, backups and recovery
src/engine       Babylon engine selection and the boot scene
src/app          bootstrap, application state machine, config
src/debug        developer overlay, asset gallery, deterministic scenario runner
src/data         typed content registries and asset manifests
src/ui           menus and screens
public/assets    drop point for your own models, empty by design
tests            unit, integration and browser tests
docs             architecture, content schema, controls, world coordinates, save migrations, performance budgets
```

### Saves

Saves live in your browser, in IndexedDB, and nothing is uploaded anywhere. Open Saves from the main menu to write a slot, load one, rename, overwrite, delete, or export a slot to a file you can keep or move to another machine. Importing checks and upgrades a file before it becomes a slot, so a broken file can never overwrite a good save.

Each write keeps the previous contents as a backup. If a save is ever damaged, it stays in the list marked as damaged, and loading it falls back to the last good backup rather than failing.

If the browser will not allow storage, which private windows usually will not, the game still runs and the panel says plainly that saves will not survive the tab.

Design and planning documents live at the root: GAME\_SPEC.md is the binding specification, ROADMAP.md is the milestone order, IMPLEMENTATION\_STATE.md is the honest current status, TECH\_DECISIONS.md records why things were done a certain way, CONTENT\_REGISTRY.md tracks content, TESTING.md covers verification, and CHANGELOG.md logs changes.

## Assets and legal

This is a private fan project with no affiliation to Legendary Pictures, Warner Bros. or anyone else who owns Pacific Rim. It ships no film audio, no ripped models and no paid or leaked assets. Everything in the repository is original or procedurally generated placeholder work, sitting in clearly named slots so real models, textures, animations, portraits, sound and music can be dropped in later. Nothing here is claimed to be screen accurate.
