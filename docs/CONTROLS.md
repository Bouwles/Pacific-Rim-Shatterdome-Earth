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
| **N / S / E / W**    | Walk the selected distance, settling onto the streamed ground    |
| Walk distance        | 100 m, 1 km or 10 km per step                                    |
| **+1h / +6h**        | Advance the world clock by whole in-game hours                   |
| **06:00 to 00:00**   | Skip forward to that clock time; never backwards                 |
| **Dive / Surface**   | Walk the seabed instead of floating. Ground view only            |
| Quality              | Low, Medium, High or Cinematic                                   |
| **Calm to Recovery** | Set the alert in the region you are standing in. City view only  |
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

The walk distance is selectable because a fixed one kilometre stride steps
straight over a coastline. The shelf between wading depth and open water is a few
hundred metres wide, so at one kilometre it is invisible; at 100 m it can be
walked into.

Time buttons are labelled with the clock time they set rather than with "dawn" or
"dusk". Sunrise moves with latitude and season, so a button called Dawn would be
lying at most of the places you can stand.

### Environment readout

Shown in both views, because the world clock and the weather run everywhere; only
the things that draw them belong to the ground view.

| Readout          | Meaning                                                             |
| ---------------- | ------------------------------------------------------------------- |
| Day / time       | Days elapsed and the in-game clock. One tick is one in-game second  |
| Sun / moon       | Elevation of each, and how much of the moon is lit                  |
| Light            | 0 to 1 after cloud, marked when a lightning flash is raising it     |
| Weather          | Current front, or the crossfade into the next one                   |
| Cloud / rain     | Cover, precipitation and fog, and whether it is falling as snow     |
| Wind             | Speed and the bearing it blows from                                 |
| Temperature      | Degrees, including the day and night swing                          |
| Wetness          | How saturated the ground is. The only weather value a save carries  |
| Visibility       | Metres, the same figure an AI reads. Flags hazardous conditions     |
| Traction / speed | Grip and movement multipliers gameplay applies                      |
| Ranged penalty   | Accuracy lost to wind, rain and water                               |
| Water            | State, depth zone, depth and how submerged the body is              |
| Waves            | Surface height at this point and the amplitude the wind justifies   |
| Audio            | Surface, partial or underwater, and whether audio actually started  |
| Quality budgets  | Live particles against the ceiling, shadow, reflections, telegraphs |

## On foot in the Shatterdome (Milestone 08)

Everything here works from the keyboard alone. The mouse is an option, not a
requirement: a player who never enables pointer lock can still walk from the
command floor to a Conn-Pod and back.

| Input           | Action                                                              |
| --------------- | ------------------------------------------------------------------- |
| W A S D         | Walk                                                                |
| Shift           | Run                                                                 |
| Ctrl            | Crouch                                                              |
| Mouse           | Look, once pointer lock is engaged by clicking the view             |
| Arrow keys      | Turn and look, at the same rate, with no mouse                      |
| E               | Use whatever is focused. Also closes an open panel                  |
| Tab / Shift+Tab | Cycle the fixtures in the room, nearest first, turning to face each |
| U               | Unstuck: step to the nearest clear deck plate in the same room      |
| Esc             | Pause. Opens the pause menu and stops the simulation                |

Pointer lock is requested by clicking the view and released by the browser's own
Escape, by opening a panel, or by pausing.

### What the prompt says

The prompt names what is focused and how far away it is. Within reach it becomes
`E — Use ...`. A sealed bulkhead explains which facility has not been built
rather than staying silent. The same sentence goes to a screen reader through a
live region, written only when it changes.

### Heads-up readout

| Readout        | Meaning                                                                   |
| -------------- | ------------------------------------------------------------------------- |
| Room and deck  | Where the player is and what state that facility is in                    |
| Time and shift | Local clock and which of the three shifts is on                           |
| On shift       | People posted in this room right now, against its slots                   |
| Power          | Complex-wide draw against reactor output                                  |
| Crews          | Construction crews free against the total mustered                        |
| Position       | Metres from the centre of the room, on its own floor plan                 |
| Drawn          | Crew instances actually drawn against the number on shift, and mesh count |
| Radio          | The last four lines from the crew and from LOCCENT                        |

### Panels

Opened by using something in the world, never from a menu.

- **A terminal** opens facility management: every facility with its deck, status, tier, power draw and staff, the next tier with its benefit, crew cost and build time, and an Order button. A button that cannot be pressed is disabled and carries the reason it was refused.
- **A berth** opens the machine standing in it: mark, manufacturer, mass, reactor output, cooling, measured height, and which asset manifest it resolves through.
- **The Conn-Pod** opens the instruments: the selected machine, and the live world outside, the local time, the weather, the wind, visibility and the region's alert level. There is no launch control on it, because deployment does not exist yet.

### Pause menu

Resume, Saves and Back to Menu. Pausing stops the simulation, which stops
construction, the clock and the weather with it. Saves can be opened from inside
the complex and returns there rather than to the main menu.

### City readout

Shown wherever the player is standing in a region that has a city plan, which is
Hong Kong today. Elsewhere the block is hidden rather than showing zeroes, because
no city has been built there.

| Readout            | Meaning                                                             |
| ------------------ | ------------------------------------------------------------------- |
| City               | Which region, and how many districts it is made of                  |
| Alert              | Current level, and whether sirens are sounding                      |
| Evacuation         | How much of the population is clear, how much is moving, capacity   |
| Streets            | Civilian and vehicle density, 0 to 100 percent of the district norm |
| Harbour / military | Shipping and military density                                       |
| Layout             | Blocks, towers and landmark slots the layout produced               |
| Defence / routes   | Defence positions, roads, harbour lanes and deployment routes       |
| Drawn              | Towers actually drawn, resident groups, meshes and GPU cost         |
| Agents             | Live pooled instances against the pool, broken down by kind         |

The Drawn and Agents rows describe rendering, so they are hidden on the globe
where nothing is being drawn. The rest stays, because the layout and the alert are
real wherever the player is.

Alert buttons are debug controls. Nothing in the game raises an alert on its own
yet; the attack director that will do so arrives with a later milestone.

Audio reports its real state. Browsers refuse to start audio outside a user
gesture, so it says `blocked` rather than pretending to be running.

## Not yet bound

No on-foot player controller, Jaeger piloting, camera-mode switch, weapon, squad-command, or menu-navigation keys
exist yet. See [../ROADMAP.md](../ROADMAP.md).
