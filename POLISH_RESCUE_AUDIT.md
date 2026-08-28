# Polish rescue audit

Baseline taken at 1.0.0-rc.1 (`fba6297`), production build, WebGPU, before any
rescue work. Checklist items are marked only when verified in the running game.

## Baseline findings

**Title.** A raw grey box fills the frame against a sky-blue void. The menu is
a default-styled card with mismatched button widths, the pack download row
jammed into it, and the debug readout plus Pause/Step transport visible along
the bottom. No composition, no lighting, no atmosphere, no identity.

**Shatterdome.** Flat hemispheric lighting over beige and grey boxes. The room
panel leads with developer data: coordinates, staff draw counts, mesh counts.
Readable, but it looks like a collision test level.

**Combat.** The machine is one grey box, the creature is one grey-green box.
Hits happen in the numbers and the audio, but nothing on the bodies moves:
no limbs, no recoil, no silhouette. The pilot panel is a wall of dev rows:
spawn buttons, debug volume checkboxes, raw readouts, all in normal play.

**Debug leakage.** The diagnostics bar (renderer, tick, seed, perf) and the
simulation transport (Pause/Step/speed) render in every screen of a production
build. Combat carries "Spawn test kaiju" and "Debug volumes" as ordinary
controls.

**What is already strong and must not be broken.** The simulation, the fixed
loop, the fight system (moves, counters, grapples, finishers, statuses), the
economy, saves and migration, the audio architecture (buses, adaptive score,
radio), the impact language (freezes, camera impulse), quality presets and
budgets, 2,121 unit tests and ~200 browser tests. The rescue is presentation,
feel and cohesion, not systems.

## Checklist

### Debug separation

- [x] Diagnostics bar and transport hidden in production; available in dev and with ?debug=1
- [x] Combat dev controls (spawn, clear, debug volumes) behind the same flag
- [x] Interior dev data (coordinates, mesh counts) out of the room panel
- [x] No console spam in production

### Title and design system

- [x] In-engine title composition: rigged machine, fog, rim light, warning beacon, slow drift
- [x] One design system: palette, typography, panel chrome, buttons, focus states
- [x] Menu restyled: title block, clean action column, version line; pack panel moved to Settings-adjacent placement
- [x] Screen transitions: fade-in on every screen mount, styled loading lines

### Hero geometry

- [x] Jaeger rig: multi-part articulated build (head, torso with emissive core, pauldrons, jointed arms and legs, feet), walk cycle from stride phase, attack and guard poses, hit recoil, per-part materials with rim accents
- [x] Kaiju rig: head with jaw, torso, limbs, tail segments, dorsal plates, bioluminescent emissive, breathing idle, windup rear, death slump
- [x] Rigs are reusable builders parameterised by the definition, not bespoke meshes

### Combat feel

- [x] Hit events drive body recoil on the rigs, scaled by the impact frame's pose exaggeration
- [x] Heavy hits fire the low-frequency audio impact with distance
- [x] Attack phases visibly move the attacking limb
- [x] Footfalls already synced (decals, dust, audio), verified still working

### Interface

- [x] Pilot panel: HUD first, systems in a collapsed drawer, dev rows debug-only
- [x] Shatterdome panel: location as a styled header, fiction first, dev data removed
- [x] Buttons, selects, sliders restyled everywhere via the design system

### Rendering

- [x] Post pipeline: tone mapping, FXAA, high-threshold bloom, subtle vignette, gated by quality preset and disposed with the scene
- [x] Title scene lighting: key, cool fill, warm practical

## Verification

Every checklist item above was checked in the production build (`npm run build`, `npx vite preview`) on WebGPU at 1920×1080 and an emulated 1366×768, seed 20260930, with the console clean. Two items changed during verification: the pilot camera distances were brought in (2.6 to 2.1 heights on chase, 1.75 to 1.5 on combat) and the rigs were made unpickable after the obstruction ray was found stopping on the machine's own back plate; and the grade is rebuilt on camera change after the re-attach path turned the combat view black on WebGPU.

## After

Recaptured at the same scenes after the pass: the title is a lit, fogged
composition with a readable machine silhouette and a styled menu; the interior
carries the same identity; combat shows an articulated machine and creature
that move when struck; production carries no debug surface. Remaining honest
gaps are listed in RELEASE_NOTES.md known issues.
