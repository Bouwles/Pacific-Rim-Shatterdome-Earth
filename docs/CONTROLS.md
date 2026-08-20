# CONTROLS.md

Every input the build actually responds to today. Nothing here is aspirational — gameplay controls arrive
with the milestone that implements the systems behind them.

## Camera (boot scene)

| Input       | Action                                   |
| ----------- | ---------------------------------------- |
| Left-drag   | Orbit the debug camera around the target |
| Mouse wheel | Zoom (clamped to 10–300 units)           |

Babylon's `ArcRotateCamera` default bindings; the boot scene attaches it to the canvas.

## Debug overlay

| Input                  | Action                                                              |
| ---------------------- | ------------------------------------------------------------------- |
| `F3`                   | Toggle overlay visibility                                           |
| **Pause** / **Resume** | Halt or continue the simulation; rendering keeps running either way |
| **Step**               | Advance exactly one simulation tick (usable while paused)           |
| Time-scale select      | 0.25× / 0.5× / 1× / 2× simulation speed                             |

## URL parameters

| Parameter | Effect                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?seed=N` | Runs the simulation with seed `N` instead of `DEFAULT_SEED` (20260819). Unparseable values fall back to the default rather than seeding with `NaN`. |

## Menu

| Input            | Action                                                                 |
| ---------------- | ---------------------------------------------------------------------- |
| **New Game**     | MainMenu → Loading → Shatterdome placeholder                           |
| **Back to Menu** | Return to MainMenu from the Shatterdome placeholder or an error screen |

## Not yet bound

No on-foot movement, Jaeger piloting, camera-mode switch, weapon, squad-command, or menu-navigation keys
exist yet. See [../ROADMAP.md](../ROADMAP.md).
