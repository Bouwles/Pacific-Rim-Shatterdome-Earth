# Radical rebuild state

Vertical-slice rebuild inside the existing project. Baseline checkpoint: git tag
`rebuild-baseline` (commit `990278b`, after the polish rescue). Baseline
screenshots in `docs/screenshots/rebuild-baseline/`; final screenshots in
`docs/screenshots/rebuild-final/`.

This file is the durable checklist across context compaction. Items are
marked only when verified in the running production build (`npm run build`,
`npx vite preview`, no `?debug`) or by the production path test on the dev
server (`tests/e2e/productionPath.spec.ts`, `?production=1`).

## Contract notes

- The prompt names canon machines and creatures (Gipsy Danger, Knifehead and
  others). None are implemented; the repository uses original placeholder
  names by design, under the legal boundary in GAME_SPEC.md. Names are kept
  as they are. The slice fights whatever the war raises in a benchmark
  district (Hong Kong, Tokyo, Sydney or Manila), with the Placeholder
  Sentinel by default.
- No CC0 model of a canon Jaeger or kaiju exists, so both heroes stay
  procedural rigs. Shaped armour and pistons are the next pass on them.
- Allied machines are out of the production sortie: their plasma fire from
  behind the player destroyed the Conn-Pod before contact in every sortie
  tried. They remain in the debug build.
- Debug means the dev server or `?debug=1`. Every existing Playwright test
  runs on the dev server, so the old panels stay under test while players
  never see them. `?production=1` makes the dev server behave like a player
  build, which is how the path is tested at full speed.

## Commits

- `5ef37c5` stage one: imported people, kit props, sampled sound, screen
  modules, encounter director.
- `321fb75` stage two: the production path end to end.
- `4e924d6` arrival after the district streams in.
- `ff78e7e` production path test, waterfront arrival, production override.
- final commit: interior crew behaviour, berth rigs, district buildings,
  fold fix, documentation, screenshots.

## Asset acquisition

- [x] Characters (CC0 Quaternius via poly.pizza, direct GLB) through an
      asset-container library, height-normalised, role-tinted
- [x] Sound library (CC0 Kenney impact, sci-fi, interface, UI) through a
      sample library on the existing buses
- [x] Props (CC0 Kenney factory, city, roads) staged; palettes restyled to
      an industrial scheme (originals kept beside them)
- [x] THIRD_PARTY_ASSETS.md with source, licence, modifications, destination
- [x] Credits screen carries attribution

## Production path (verified)

- [x] Title: rigged machine in the bay behind, Continue with the newest save
      summary, New Game, Saves, Settings, Credits, version, update and pack
      flow in a compact host
- [x] Dome alert band with Respond once a breach is live; the crew flinch
      and go to stations
- [x] Command: globe as the focus, the one live breach as a card with time,
      weather, damage risk, creature, reward; Review briefing
- [x] Briefing: situation, objectives, machine, pilots, drift benefit and
      drawback, rewards, radio; Inspect in the bay; Deploy
- [x] Bay: live machine on the stage, readiness, six-part structure, pilots,
      weapons, core figures, machine tabs, Confirm and deploy
- [x] Deployment: letterboxed cinematic with radio captions, Skip, arrival
      caption while the district streams in
- [x] Arrival on the district waterfront, kit buildings on the nearest
      blocks, the creature 460 m inland, approach objective and prompt
- [x] Pause in a sortie (Escape): Resume, Saves, Settings, Abort, Menu
- [x] Results: grade, outcome, twelve lines, consequences, Replay, Return
- [x] Return to the dome raises the next alert
- [ ] Encounter phases through finisher and aftermath observed live (pinned
      by unit test; the automated pass drives the fight to contact only)
- [ ] Technicians gather on the damaged machine after a sortie

## People

- [x] Imported animated characters replace block figures in every room
- [x] Workers face the console they work; alert makes everyone react and
      then station
- [ ] 8 to 15 staff in the command area with conversation pairs (the count
      follows the room's posts and the quality preset)

## Shatterdome

- [x] Rooms dressed: consoles, machines, crates, pipes, catwalks, columns,
      bollards, cranes, hoppers
- [x] Berths hold the machine rig, breathing, instead of a box
- [ ] Three connected spaces with sightlines to the machine

## Battlefield

- [x] Kit buildings on the blocks nearest the arrival, seated into the slope
- [ ] Roads, staging, fires and staged destruction with persistent aftermath

## Heroes

- [ ] Machine: shaped armour, pistons, seams
- [ ] Creature: overlapping masses beyond the current rig

## Interface

- [x] One system (theme.css); every screen of the path on it
- [x] HUD: centre clear, six-part silhouette, integrity, heat, stamina,
      weapon and stance, enemy condition and posture, objective, phase,
      warnings, first-use prompts
- [x] 1366x768 checked by test on title, settings, credits, command,
      briefing, bay; manually on the title and the interior
- [x] Interface sounds by verb

## Combat

- [x] Encounter director: opening, spacing, signature, disruption, enrage,
      break, finisher, aftermath; radio, music and district answer it
- [ ] Sandbox tuning loop on production actors
- [ ] Move set reduced to the reliable core

## Audio

- [x] Sampled impacts and footfalls layered on the synthesised floor
- [x] Score follows the encounter (boss phase from the director)
- [x] Interface, deployment thrusters, alert tone

## Gates

- [x] Typecheck, lint, format
- [x] Unit and integration: 2136 passed
- [x] Playwright: 196 of 204 passed on the full run; the four failures from
      the map fold hiding the war section and the simulator's run button
      under the debug bar were fixed and re-run green; the builder
      construction-wait failure is pre-existing (tracked since M29)
- [x] Zero uncaught errors through the path (production path test)
- [x] Saves unchanged (no schema change; version 17)
- [x] WebGPU verified; WebGL is what Playwright runs
