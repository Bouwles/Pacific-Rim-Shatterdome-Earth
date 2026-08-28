# Radical rebuild state

Vertical-slice rebuild inside the existing project. Baseline checkpoint: git tag
`rebuild-baseline` (commit `990278b`, after the polish rescue). Baseline
screenshots in `docs/screenshots/rebuild-baseline/`; final screenshots go in
`docs/screenshots/rebuild-final/`.

This file is the durable checklist across context compaction. Items are
marked only when verified in the running production build.

## Contract notes

- The prompt names canon machines and creatures (Gipsy Danger, Knifehead and
  others). None are implemented; the repository uses original placeholder
  names by design, under the legal boundary in GAME_SPEC.md. Names are kept
  as they are. The flagship pair for the slice is the Placeholder Sentinel
  (Mk-0) and the Alpha Biped, the most complete pair.
- No CC0 model of a canon Jaeger or kaiju exists, so both heroes stay
  procedural, redesigned rather than replaced: shaped armour, joints,
  pistons, seams, and weight in motion.

## Baseline (before)

- Title: rigged machine in a bay, styled menu. Acceptable composition, thin.
- Shatterdome: three lit box rooms with plated floors; crew are blocky
  figures; rooms do not connect visually; nothing reads as a headquarters.
- World map: globe plus a long readout column; every region deployable,
  most of them empty.
- Combat: rigs on flat terrain, camera close, boxes for the city, no
  approach, no escalation structure, no finisher presentation, a wall of
  HUD rows.
- Results: a list of lines in the world panel.
- Audio: synthesised buses, adaptive score and radio exist; no sampled
  impacts.

## Asset acquisition

- [ ] Characters (CC0, direct download) imported through the GLB pipeline
- [ ] Sound library (CC0) imported for impacts, UI, machinery
- [ ] City props (CC0) for the benchmark district
- [ ] THIRD_PARTY_ASSETS.md with source, licence, modifications, destination
- [ ] Credits screen carries attribution

## Production path

- [ ] Title: moving background, Continue with save summary, version, settings
- [ ] Command: globe as focus, only the benchmark mission selectable
- [ ] Briefing: location, creature, weather, risk, objectives, rewards, deploy
- [ ] Bay: live 3D machine with readiness, damage, pilots, weapons around it
- [ ] Deployment: skippable cinematic
- [ ] Approach: authored route with radio and environment events
- [ ] Encounter: opening, spacing, signature ability, disruption, enrage,
      posture break, finisher, aftermath
- [ ] Results: graded, animated, skippable, replay and return
- [ ] Return: persistent damage in the bay, staff react

## People

- [ ] Imported animated characters replace block figures in the Shatterdome
- [ ] 8 to 15 staff with roles and work targets; alert and damage states

## Shatterdome

- [ ] Command, bay and pilot prep as connected, dense spaces
- [ ] Machine glimpsed before the bay reveal

## Battlefield

- [ ] One dense coastal district with shoreline, harbour, staging, weather
- [ ] Staged destruction with persistent aftermath

## Heroes

- [ ] Machine: shaped armour, pistons, seams, idle under load, planted feet
- [ ] Creature: organic masses, personality states, never sliding

## Interface

- [ ] One system: graphite and navy, steel structure, amber action, cyan
      information, red for danger; condensed type; SVG icons
- [ ] HUD: centre clear, silhouette damage, reactor and weapon in corners
- [ ] 1920x1080 and 1366x768 verified

## Combat

- [ ] Sandbox tuning loop on production actors
- [ ] Standard chain, heavy, guard/counter, evade, grapple, ranged,
      signature weapon, finisher, each distinct
- [ ] Telegraphs physical and audible

## Audio

- [ ] Sampled impacts and UI sounds, layered footsteps and attacks
- [ ] Score states through the whole slice

## Gates

- [ ] Typecheck, lint, tests, build
- [ ] Zero uncaught errors through the full loop
- [ ] Saves migrate
- [ ] WebGPU and fallback boot
- [ ] No memory growth across repeated missions
