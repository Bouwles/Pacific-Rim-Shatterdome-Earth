# FMKH rebuild state

Rebuild of the production loop around hunt-game immediacy: hangar home,
hunt board, loadout, short deployment, boss hunt, rewards, repeat. Baseline
checkpoint: git tag `fmkh-baseline` (commit `3b34b7e`). Baseline screenshots
of the four failed screens in `docs/screenshots/fmkh-baseline/`; final
screenshots go in `docs/screenshots/fmkh-final/`.

Items are marked only when verified in the production build or by the
production path test (`?production=1` on the dev server).

## Direction (overrides earlier prompts)

- Heavy is not slow. Input answers in a frame; weight comes from pose,
  recoil, sound, camera, hit stop, reactions, ground and destruction.
- No mandatory on-foot Shatterdome, no globe-first command screen, no
  procedural humans in production, no long cinematic before the fight.
- Canon names for the roster and creatures. Internal ids unchanged so saves
  migrate untouched: `jaeger.sentinel-mk0` is Gipsy Danger, `heavy-mk4` is
  Cherno Alpha, `harrier` is Striker Eureka, `harmonic` is Crimson Typhoon,
  `ironclad` is Coyote Tango, `leviathan` is Gipsy Avenger; `kaiju.biped-alpha`
  is Knifehead, `serpent-delta` is Otachi, `burrower-sigma` is Leatherback.
  Names are text; no ripped asset is used for any of them.

## Implementation log (for continuing after a context reset)

1. DONE: canon names in data and tests; locomotion scaled (walk x1.6, run
   x1.8, strafe x1.7, accel x4.2, braking x4, turn x3.4); move commitments
   shortened in `src/data/moves.ts`; golden digests updated; locomotion
   ceiling tolerance 1.0.
2. DONE `src/engine/pilotInput.ts`: action layout (`setActionLayout`), LMB
   onPrimary, RMB onSecondaryDown/Up, MMB lock, Q onDodge, E onGrab, 1 to 4
   onAbility, R onUltimate, F onGuardPress, turn keys off.
3. DONE bootstrap action mapping: four-hit chain (jab, cross, smash forward,
   launcher, 0.9 s window), heavy tap and 320 ms charged haymaker, booster
   dodge, grab and throw, abilities to plasma caster, booster strike (elbow
   rocket), chain sword, missiles; ultimate is the plasma-drop finisher on
   an opening or the charged haymaker on a full overdrive meter; F press is
   the parry.
4. DONE `src/ui/actionHud.ts` and `src/ui/theme-action.css`: bars, boss
   health and posture, phase badge, lock mark, four ability icons with
   radial cooldowns and ammunition, combo counter, fading objective,
   flashes.
5. DONE `src/data/hunts.ts` (Knifehead at Anchorage, Otachi at Hong Kong,
   Leatherback at Sydney) and `src/ui/hangarScreens.ts` (hangar, picker,
   upgrades, hunt board, loadout, comms card, rewards). Bootstrap hunt loop:
   `enterHangar`, `enterHunts`, `enterLoadout`, `beginHunt` (6.5 s comms),
   `arriveForHunt` (waterfront, buildings, roads, boss at the hunt's opening
   range), `updateHuntFrame`, `finishHunt` (roster.completeSortie, hunt
   records in local storage, rewards sheet). New Game and Continue in a
   player build land in the hangar.
6. DONE encounter director thresholds 0.7, 0.55, 0.4, critical 0.15.
7. TODO verify in the build: hangar orbit, hunt board, loadout, comms,
   arrival framing, boss pressure, HUD, pause, rewards, return, replay;
   production path test rewritten for the hunt loop; screenshots; docs;
   gates; commit and push.

## Removed from production (kept behind debug)

- [x] On-foot Shatterdome walkaround with imported humans (New Game and
      Continue no longer enter it in a player build)
- [x] Globe command screen, briefing and the world panel
- [x] Floating-cube arrival cinematic over the globe
- [x] Numbered punch controls and the 1 jab / 2 cross / 3 heavy prompts
- [x] Objective paragraphs and developer state names on the HUD

## New flow

- [ ] Title with a live hangar background; Continue / Play
- [ ] Hangar home; Hunts; Loadout; deployment transition; spawn near the
      action; boss fight with phases; rewards; return
- [ ] First control within 20 s of launch; first combat within 60 s

## Controls and timing

- [x] Move data inside the targets at 60 ticks per second: jab 117 ms
      startup, cross 133 ms, heavy 300 ms startup and 467 ms recovery,
      dodge 50 ms startup, parry 33 ms startup with a 16-tick recovery
- [ ] Verified in play

## Gates

- [ ] Typecheck, lint, tests, build
- [ ] Saves migrate
- [ ] WebGPU and fallback boot
- [ ] Performance target held
