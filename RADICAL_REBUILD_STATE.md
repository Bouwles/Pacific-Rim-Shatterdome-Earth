# Radical rebuild state

Vertical-slice rebuild inside the existing project. Baseline checkpoint: git tag
`rebuild-baseline` (commit `990278b`, after the polish rescue). Baseline
screenshots in `docs/screenshots/rebuild-baseline/`; final screenshots go in
`docs/screenshots/rebuild-final/`.

This file is the durable checklist across context compaction. Items are
marked only when verified in the running production build (`npm run build`,
`npx vite preview`, no `?debug`).

## Contract notes

- The prompt names canon machines and creatures (Gipsy Danger, Knifehead and
  others). None are implemented; the repository uses original placeholder
  names by design, under the legal boundary in GAME_SPEC.md. Names are kept
  as they are. The flagship pair for the slice is whatever the war raises in
  a benchmark district, usually the Placeholder Sentinel against a
  Category 4.
- No CC0 model of a canon Jaeger or kaiju exists, so both heroes stay
  procedural rigs. Improving their shape is on the list below.
- Allied machines are out of the production sortie: their plasma fire from
  behind the player destroyed the Conn-Pod before contact in every sortie.
  They remain in the debug build until they hold their fire.
- Debug means the dev server or `?debug=1`. Every Playwright test runs on the
  dev server, so the old panels stay under test while players never see them.

## Commits

- `5ef37c5` stage one: imported people, kit props, sampled sound, screen
  modules, encounter director.
- `321fb75` stage two: the production path end to end.

## Asset acquisition

- [x] Characters (CC0 Quaternius via poly.pizza, direct GLB) imported through
      an asset-container library, height-normalised, role-tinted
- [x] Sound library (CC0 Kenney impact, sci-fi, interface, UI) through a
      sample library on the existing buses
- [x] Props (CC0 Kenney factory, city, roads) staged; palettes restyled to
      an industrial scheme (originals kept beside them)
- [x] THIRD_PARTY_ASSETS.md with source, licence, modifications, destination
- [x] Credits screen carries attribution

## Production path (verified in the build)

- [x] Title: rigged machine in the bay behind, Continue with the newest save
      summary, New Game, Saves, Settings, Credits, version, update and pack
      flow in a compact host
- [x] Dome alert band with Respond once a breach is live (the war is moved
      forward until a benchmark district has one)
- [x] Command: globe as the focus, the one live breach as a card with time,
      weather, damage risk, creature, reward; Review briefing
- [x] Briefing: situation, objectives, machine, pilots, drift benefit and
      drawback, rewards, radio; Inspect in the bay; Deploy
- [x] Bay: live machine on the stage, readiness, six-part structure, pilots,
      weapons, core figures, machine tabs, Confirm and deploy
- [x] Deployment: letterboxed cinematic with radio captions, Skip
- [x] Arrival 460 m from the incident's creature; approach phase with
      objective and control prompt
- [ ] Encounter phases observed live through to finisher and aftermath
- [x] Results: grade, outcome, twelve lines, consequences, Replay, Return
- [ ] Return to the dome with technicians on the damaged machine
- [ ] Replay verified with a changed incident

## People

- [x] Imported animated characters replace block figures in every room
- [ ] 8 to 15 staff in the command area with distinct work, conversation
      pairs, alarm reactions
- [ ] Staff face their work targets; no overlapping posts

## Shatterdome

- [x] Rooms dressed: consoles, machines, crates, pipes, catwalks, columns,
      bollards, cranes, hoppers
- [ ] Three connected spaces with sightlines to the machine
- [ ] Machine glimpsed before the bay reveal

## Battlefield

- [ ] Dense coastal district with kit buildings near the fight, roads,
      staging, weather, fires
- [ ] Staged destruction with persistent aftermath

## Heroes

- [ ] Machine: shaped armour, pistons, seams, idle under load, planted feet
- [ ] Creature: organic masses, personality states, never sliding

## Interface

- [x] One system (theme.css): graphite and navy, steel structure, amber
      action, cyan information, red danger; condensed display type over mono
- [x] HUD: centre clear, six-part silhouette, integrity, heat, stamina, weapon
      and stance, enemy condition and posture, objective, phase, warnings,
      first-use prompts
- [ ] 1920x1080 and 1366x768 verified on every screen of the path
- [x] Interface sounds by verb (confirm, back, click, rollover)

## Combat

- [ ] Sandbox tuning loop on production actors
- [ ] Move set reduced to the reliable core; telegraphs physical and audible
- [ ] Hit stop, recoil, contact effects verified at the contact point

## Audio

- [x] Sampled impacts and footfalls layered on the synthesised floor
- [x] Score follows the encounter phases (boss phase from the director)
- [ ] Every scene of the path has an intentional soundscape

## Gates

- [ ] Typecheck, lint, tests, build
- [ ] Zero uncaught errors through the full loop
- [ ] Saves migrate
- [ ] WebGPU and fallback boot
- [ ] No memory growth across repeated missions
