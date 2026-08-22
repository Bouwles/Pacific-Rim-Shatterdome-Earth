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

| Input             | Action                                                                           |
| ----------------- | -------------------------------------------------------------------------------- |
| **New Game**      | MainMenu → Loading → Shatterdome placeholder                                     |
| **Saves**         | MainMenu → Saves                                                                 |
| **World Map**     | MainMenu → World Map                                                             |
| **Asset Gallery** | MainMenu → Asset Gallery                                                         |
| **Back to Menu**  | Return to MainMenu from the Shatterdome placeholder, gallery, or an error screen |

## Asset gallery

| Input               | Action                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------- |
| Asset list          | Select an asset; the camera reframes to its measured size                               |
| **Rotate**          | Start or stop the turntable                                                             |
| **Damage preview**  | 0 to 100 percent presentation damage: parts tint, then detach outward                   |
| **Manifest** select | Default, alternate palette, or an uninstalled production model to exercise the fallback |
| Left-drag / wheel   | Orbit and zoom, same as the boot scene                                                  |

## Saves panel

| Input             | Action                                                                   |
| ----------------- | ------------------------------------------------------------------------ |
| Name field + Save | Write the current simulation to a new slot                               |
| **Load**          | Restore a slot, recovering from its newest valid backup if it is damaged |
| **Overwrite**     | Write over a slot, keeping the previous contents as a backup             |
| **Rename**        | Change a slot's name, leaving its simulation data untouched              |
| **Export**        | Download the slot as a JSON file                                         |
| **Delete**        | Remove the slot and its backups                                          |
| Import            | Pick a JSON file; it is validated and migrated before it becomes a slot  |

A damaged slot stays listed with an amber border and an explanation, so its
backup can still be loaded.

## World map

| Input                | Action                                                           |
| -------------------- | ---------------------------------------------------------------- |
| **Globe / Ground**   | Switch between the map and the streamed ground                   |
| Deploy to + Teleport | Jump to a region centre; the floating origin rebases immediately |
| **N / S / E / W**    | Walk 1 km, settling onto the streamed ground where it is loaded  |
| **Fly route**        | Run the deterministic stress route; press again to stop          |
| Left-drag / wheel    | Orbit and zoom                                                   |

The readout shows latitude, longitude, altitude, local east/north, the current
sector and its four neighbours, the active region and its climate, how many
regions are active versus strategic, the origin anchor, and the rebase count.

Controls sit above the readouts on purpose. The readouts grow as more of the
world reports itself, and when they were on top the walk and route buttons were
pushed off the bottom of the screen and under the debug overlay, where they could
not be clicked at all.

### Ground view

Only the ground view streams sectors, so its instrumentation block appears only
there. Showing zeroes on the globe would imply a system was running when it was
not.

| Readout             | Meaning                                                            |
| ------------------- | ------------------------------------------------------------------ |
| Generator           | `worker` normally, `inline` if the worker could not be constructed |
| Sector states       | Live count in each of the eight streaming states                   |
| Resident            | Sectors holding GPU resources now, and the highest seen            |
| Generated           | Sectors built so far, and how many failed                          |
| Cache               | Data-cache hits against misses                                     |
| Cancelled / evicted | Requests dropped in flight, meshes released, boundary rescues      |
| Generation          | Last and average generation time, measured in the worker           |
| Upload              | Last and average time to turn terrain into meshes                  |
| Sector memory       | Resident and cached terrain bytes, with peaks                      |
| Scene               | Meshes, pooled meshes, thin instances and estimated GPU bytes      |
| Ground height       | Sampled from the streamed collision field, or `not loaded`         |
| Stress route        | Progress along the route in seconds                                |

The stress route flies Hong Kong, Manila, Tokyo, Vladivostok and back at 4,000
metres per second. It is a fixed set of waypoints at a fixed speed and step, so
two runs are comparable, and it is the same route the headless test drives.

## Not yet bound

No on-foot player controller, Jaeger piloting, camera-mode switch, weapon, squad-command, or menu-navigation keys
exist yet. See [../ROADMAP.md](../ROADMAP.md).
