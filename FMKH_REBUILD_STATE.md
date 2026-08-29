# FMKH rebuild state

Rebuild of the production loop around hunt-game immediacy: hangar home,
hunt board, loadout, short deployment, boss hunt, rewards, repeat. Baseline
checkpoint: git tag `fmkh-baseline` (commit `3b34b7e`). Baseline screenshots
of the four failed screens are in `docs/screenshots/fmkh-baseline/`; the
rebuilt loop is in `docs/screenshots/fmkh-final/` (title, hangar, hunt board,
loadout, deployment, arrival, three fight frames, pause, rewards), captured
by `tests/e2e/huntFight.spec.ts` at full speed with the dev diagnostics
hidden.

Items are marked only when verified in the production build or by the
production path tests (`?production=1` on the dev server).

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

## Implementation log

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
   Leatherback at Sydney, each with an arrival hour and its own damage
   scales) and `src/ui/hangarScreens.ts` (hangar, picker, upgrades, hunt
   board, loadout, comms card, rewards, records). Bootstrap hunt loop:
   `enterHangar`, `enterHunts`, `enterRecords`, `enterLoadout`, `beginHunt`
   (6.5 s comms), `arriveForHunt` (waterfront, buildings, roads, boss at the
   hunt's opening range, the clock skipped to the hunt's hour),
   `updateHuntFrame`, `finishHunt` (roster.completeSortie, hunt records in
   local storage, rewards sheet). New Game and Continue in a player build
   land in the hangar. The bay stays alive behind the hunt board, the
   loadout and the deployment card.
6. DONE encounter director thresholds 0.7, 0.55, 0.4, critical 0.15, and
   the director now advances in a hunt (it was gated on the old sortie
   stage, which is why the first fights never left "approach").
7. DONE fixes found in the build: the render loop died on its first frame
   because `updateHuntFrame` was read before its declaration (black hangar,
   dead HUD); the Conn-Pod was 8 percent of structure with a 1.6 damage
   multiplier, so two head hits ended a hunt at 51 percent integrity (now
   12 percent, multiplier 1, torso 26 percent); the dodge, guard and parry
   moves had one active tick after the retune (now 10, 8 and 8, with the
   i-frames and perfect windows the tests assert).
8. DONE verification: `tests/e2e/productionPath.spec.ts` (title to hangar to
   hunt board to loadout to comms to HUD to pause to abort to rewards to
   hangar, plus a 1366 by 768 fit pass) and `tests/e2e/huntFight.spec.ts`
   (ninety seconds of play with the HUD sampled every pass).

## Removed from production (kept behind debug)

- [x] On-foot Shatterdome walkaround with imported humans (New Game and
      Continue no longer enter it in a player build)
- [x] Globe command screen, briefing and the world panel
- [x] Floating-cube arrival cinematic over the globe
- [x] Numbered punch controls and the 1 jab / 2 cross / 3 heavy prompts
- [x] Objective paragraphs and developer state names on the HUD
- [x] The boot pedestal behind the hunt screens (the live bay stays instead)

## New flow

- [x] Title with a live hangar background; Continue / New Game
- [x] Hangar home with the live machine, rail, condition, Deploy, Change
      Jaeger, Upgrade, Repair, orbit and zoom
- [x] Hunt board, loadout, 6.5 s deployment card (Skip), arrival on the
      waterfront with the creature 140 m inland, boss fight with phases,
      rewards, return
- [x] First control within 20 s of launch: 16.9 to 19.3 s measured on the
      dev server by Playwright (New Game, Hunts, Deploy, Confirm, comms
      unskipped, HUD live). First contact 24.6 to 27.5 s. Both under the
      gates; the production build loads faster than the dev server.
- [x] Fight length: ninety seconds of scripted play takes Knifehead from
      100 to 77 percent and the machine from 100 to 80 percent, so a full
      hunt runs about five minutes, inside the four to eight minute target.
      The director reached signature; objectives changed three times.
- [ ] Research and Workshop entries on the rail. Research needs a research
      wing from the base game and Workshop needs the simulator to start a
      fight from the hangar path; both are still reachable in a debug build.
      Deferred, not faked.

## Controls and timing

- [x] Move data inside the targets at 60 ticks per second: jab 117 ms
      startup, cross 133 ms, heavy 300 ms startup and 467 ms recovery,
      dodge 50 ms startup with 167 ms of i-frames, perfect guard 133 ms,
      parry 150 ms, chain window 0.9 s, charged heavy at 320 ms held
- [x] Verified in play by `tests/e2e/huntFight.spec.ts` (chain hits, heavy,
      dodge, guard, plasma caster; best combo 4; damage both ways)

## Gates

- [x] Typecheck, lint, format, 2136 unit and integration tests, build
- [x] Saves migrate (ROOT_SAVE_VERSION 17 unchanged; hunt records live in
      local storage beside the save, and a missing entry is an empty log)
- [x] WebGPU and fallback boot (WebGL under Playwright, WebGPU in Chrome)
- [x] No console errors on the loop (asserted by both production specs)
