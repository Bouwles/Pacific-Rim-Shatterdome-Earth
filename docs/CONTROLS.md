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

## Piloting a Jaeger (Milestone 09)

Taken out from the world map's ground view: pick a machine and press **Take the
machine out**. The row is hidden on the globe, because piloting needs streamed
ground to stand on.

| Input      | Action                                                      |
| ---------- | ----------------------------------------------------------- |
| W A S D    | Drive. Direction is relative to where the camera is looking |
| Shift      | Run                                                         |
| F          | Guarded movement: slower, squarer, ready to absorb          |
| Space      | Booster burst. Buffered, so an early press still fires      |
| Q / E      | Turn the body directly, with no camera involved             |
| Mouse      | Look, once pointer lock is engaged by clicking the view     |
| Arrow keys | Look, at the same rate, with no mouse                       |
| C          | Cycle camera: chase, combat, Conn-Pod                       |
| T          | Toggle target lock                                          |
| M          | Toggle reduced motion                                       |
| Esc        | Leave the machine                                           |

Pushing forward does not turn the machine to face the camera. It hands the
controller a heading intent, and the body comes round at the rate its current
state allows: quickly when planted, badly at a run. The panel reports the gap in
degrees as `lag`.

### Pilot readout

| Readout    | Meaning                                                                              |
| ---------- | ------------------------------------------------------------------------------------ |
| State      | Which of the twenty locomotion states is live, plus guarding, blocked and leg damage |
| Speed      | Current and the machine's own ceiling                                                |
| Heading    | Body heading, look heading, and the lag between them                                 |
| Ground     | Feet height against sampled ground height, and whether it is airborne                |
| Water      | Water state and how submerged the machine is                                         |
| Booster    | Charge, 0 to 100 percent                                                             |
| Stride     | How far through the current stride the feet are                                      |
| Camera     | Rig, lock state and live camera impulse                                              |
| Comfort    | Motion scale, and whether reduced motion is on                                       |
| Buffer     | Presses waiting, and how many expired unused                                         |
| Scale refs | Scale references drawn, footprints on the ground, dust, and sound delay in seconds   |

### Camera and comfort controls

Three rig buttons, a lock button, a machine selector, a camera-motion slider, a
reduced-motion switch and an invert-look switch. Switching rig keeps heading,
pitch, lock and comfort exactly as they were.

Reduced motion turns off sway, roll and the pull-back at speed. It does not turn
off the framing, the street lights, the aircraft or the footprints, because
those are how the size of the machine is read rather than decoration.

### Fighting (Milestone 10)

Available once a target has been spawned from the pilot panel. Every attack goes
through the buffer, so a press made slightly early still fires, and every refusal
is written to the log with its reason rather than being swallowed.

| Input | Action                                                               |
| ----- | -------------------------------------------------------------------- |
| 1     | Left jab. Fast, cheap, cancels into almost anything                  |
| 2     | Right cross. Cancels onward only if it landed                        |
| 3     | Overhead hammer. Slow, heavy, light armour                           |
| 4     | Rising uppercut. Launches what it hits                               |
| 5     | Shoulder charge. Goes through a guard, cannot be interrupted         |
| 6     | Plasma drop. Only legal against a target that is already finished    |
| F     | Guard. Absorbs most of a hit and all of the reaction until it breaks |
| R     | Cycle aim through the creature's body zones, and back to no aim      |
| T     | Lock and unlock the target                                           |

**Spawn test kaiju** puts a creature a hundred and twenty metres ahead. **Clear**
removes it. **Hit debug** draws the body zones exactly where the resolver
believes they are, sized by how much health each has left.

| Combat readout | Meaning                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------- |
| Target         | Name, distance, whether it is locked, which zone is aimed at, and whether a finisher is open |
| Zones          | Every body zone with the health it has left                                                  |
| Resources      | Stamina, heat and poise, and whether the machine is over temperature                         |
| Move           | The move running now and which phase it is in                                                |
| Buffer         | Presses waiting for a legal moment                                                           |
| Hit log        | The last six events: tick, attacker, move, volume, zone and damage                           |

### Melee, defence and grapples (Milestone 11)

| Input           | Action                                                                              |
| --------------- | ----------------------------------------------------------------------------------- |
| 3               | Overhead hammer. Hold forward for a forward smash, sideways for a spinning backhand |
| H hold, release | Charged haymaker. A full charge more than doubles the damage                        |
| F hold          | Guard. Raising it as the hit lands is a perfect guard                               |
| B               | Parry. A narrow window that answers with a free counter                             |
| V               | Evasive step. Invulnerable through the middle, with a real recovery                 |
| G               | Seize. Takes hold of the target if there is reach and room                          |
| P               | Pick up or drop the nearest environmental weapon                                    |
| N               | Swing whatever is in hand                                                           |
| Moves           | Opens the move list, written from the game's own move table                         |

The move list groups everything into Attacks, Defence, Grapples, Environment,
Finishers and what the creature does to you. Each row gives the input, a speed in
words rather than numbers, and a line of coaching. Nothing in it mentions ticks
or frames.

The coaching row under the combat readout says what just happened in the same
language: what a mistimed dodge did wrong, that a hold is slipping, why a throw
became a release, or why a move was refused.

### Accessibility

| Setting                 | Effect                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| Reduced motion          | Flattens camera sway, roll and speed pull-back, and every finisher framing becomes one wide shot |
| Hold to complete        | A held input satisfies the beats that ask for one, rather than repeated presses. On by default   |
| Skip finisher sequences | Applies a finisher's whole outcome at once, with no choreography                                 |

All three produce the same damage. None of them removes the information that
tells you what is happening.

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

### Ranged weapons (Milestone 12)

| Input  | Action                                                                    |
| ------ | ------------------------------------------------------------------------- |
| 7      | Plasma caster. A beam that arrives instantly and sets the target burning  |
| 8      | Anti-kaiju missile. A salvo of three, one magazine round per pull         |
| 9      | Shoulder mortar. Indirect fire, and it refuses anything closer than 180 m |
| 0      | Rotary cannon. A deep magazine, low damage per round, forward arc only    |
| J      | Arc whip. A tether that holds the target on a line rather than killing it |
| K hold | Chain sword. Runs for as long as it is held and bleeds heat while it does |
| O      | Booster strike. A close-range charge that costs reactor power             |
| L      | Reload whichever weapon is emptiest and can still be filled               |

Two readouts cover them. **Weapons** lists every carried weapon with its
magazine, its spare rounds and whether it is ready, cooling or reloading; a
weapon fed by heat or by the reactor says so rather than reading as an empty
one. **Rounds** says how many are in the air against the ceiling the quality
preset allows, and names any status effect running on the target.

Every refusal is a sentence, in the hit log and on the coaching line: how far
past a weapon's reach the target is, how close is too close for indirect fire,
that a forward-arc weapon needs you to turn, that a magazine is empty and the
spares are gone, or that too many rounds are already in the air.

## Not yet bound

No squad-command or menu-navigation keys exist yet. See
[../ROADMAP.md](../ROADMAP.md).
