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
| **+1h / +6h / +1d**  | Advance the world clock by whole in-game hours or a whole day    |
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

## The construction board (Milestone 22)

Any facility terminal. Below the list of facilities is everything outstanding.

| Control            | Effect                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| **Order**          | Queues a build or an upgrade. Short of crews queues rather than refuses |
| **Sooner / Later** | Moves a project up or down. Takes effect on the next tick               |
| **Pause**          | Stops work without losing it and frees the crews for something else     |
| **Resume**         | Puts it back in the queue                                               |
| **Cancel**         | Ends it and refunds the work not yet done                               |

Each project shows how far along it is, its priority, and when it lands counting
everything ahead of it. A project nobody is working on says why: waiting for a
crew, paused, or the complex has no power at all.

Above the list, one line says whether the complex is working at full speed and
what is holding it back, and one says what everything built is currently worth.
Both move with the shift: a night watch with a third of the posts filled builds
at sixty percent and every facility is worth a little less until morning.

## Commanding the squad (Milestone 21)

While piloting, with allies out with you.

| Control        | Effect                                                            |
| -------------- | ----------------------------------------------------------------- |
| **Q**          | Opens and closes the quick command. Nothing pauses                |
| **1** to **9** | Gives an order while the quick command is open                    |
| Order buttons  | The same nine orders, clickable, for anybody who would rather not |

The number row is the weapon row when the quick command is closed and the order
row when it is open, so no key was taken away from the fight.

The nine orders: focus target, defend area, protect civilians, hold, regroup,
ranged pressure, conserve ammunition, disengage, and synchronized attack. Every
one of them is answered out loud by each ally in their own words, which is how
you know it landed.

The squad readout sits under the combat panel: each ally's callsign, how much
machine they have left, what they are doing right now and why, and the order
standing over them. An ally that goes down is greyed rather than removed.

## The berth: the Conn-Pod crew (Milestone 20)

The same berth panel. Above the machine's own progression is who flies it.

| Control        | Effect                                                                     |
| -------------- | -------------------------------------------------------------------------- |
| **Assign**     | Puts this pilot in the Conn-Pod. The other seat keeps whoever was in it    |
| **Talk**       | A word off duty. Builds the link slowly, twice a day at most               |
| **Stand down** | Three days out of the rotation, which clears stress faster than not flying |
| **Treat**      | Sends an injury to the medical bay, shortening the recovery                |

The panel shows the pair's link as a percentage with every term that produced it,
and one row per pilot: their status, stress and sorties, what their perk
currently does or what link level it is waiting for, and their drawback with
whether it applies to the machine in this berth. A pilot who cannot be assigned
is greyed with the reason, whether that is an injury that grounds them or a
stand-down they are part way through.

Assignment carries to the alert board, where the readiness line names the crew
and lists both pilots' drawbacks before the Deploy button, marked by whether each
one applies to that sortie.

## The berth: service and progression (Milestone 19)

Walk up to a berth in the Jaeger Bay and press **E**. Below the machine's damage
and work order is everything it has earned.

| Control                      | Effect                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------- |
| **Take** on a passive        | Takes that passive, permanently, at the tier the level opened                 |
| **Strip back and re-choose** | Gives every passive back so they can be chosen again. Costs 12 bay hours each |
| **Fit** on a module          | Buys and fits it. Costs money and bay hours                                   |
| **Remove** on a module       | Takes it out to stores. Costs half the fitting time                           |
| **Prestige**                 | At level 30 only. Resets the level for a permanent rank                       |

The panel shows the level and how far into it the machine is, what its levels and
rank are actually worth on four axes, what the next level opens, the passives
taken, the modules fitted against the slots open, the six mastery goals with how
far along each is, and what prestiging would do before it can be done.

Every control that is refused says why in its tooltip: a module needing a level
the machine has not reached, a slot that has not opened yet, a prestige below the
cap, or bay work on a machine that is not in the bay.

## The contracts terminal (Milestone 18)

### The HUD and the cockpit

Taking a machine out puts a HUD above the readout panel. It carries component
condition, the zones on whatever you are fighting with the one you are aiming at
marked, your ammunition by feed type, the objective, how the city is doing, the
squad's standing order and your abilities. Below it are the instruments:
heading, speed, depth or altitude, reactor, heat, drift stability, faults,
targeting, weather, radio and the loadout.

Above all of it is the critical band. It only appears when something is actually
critical, and it is the one part of the interface that no display setting can
fade, shrink or hide.

Every reading carries its severity three ways: a colour, a glyph and a border
weight. Nominal is a tick, caution a triangle, warning an exclamation mark, and
critical a double one. That is so a reading survives colour blindness, a grey
screenshot and a screen in direct sun.

| Control            | Effect                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| **HUD** slider     | Fades everything except the critical band. Will not go below 35 percent |
| **Text**           | Four sizes. Critical text is always a little larger than the rest       |
| **High contrast**  | The strongest separation available. Overrides the colour vision preset  |
| **Colour**         | Standard, protanopia, deuteranopia or tritanopia                        |
| **Subtitles**      | Radio traffic and spoken lines as text                                  |
| **Reduced motion** | Every animation becomes zero length. Nothing is removed from the screen |

None of these changes the game. They change how it is shown to you.

Everything on the pilot screen is reachable by Tab, and whatever has focus shows
a ring.

### The region panel

The world screen carries a Region section reporting where you are standing: the
skyline, the shore and the ground behind it, how deep the water is and whether
anything can hide in it, how many directions a creature can arrive from, what
the place makes and what that is worth, the local batteries and how long they
take to respond, the traffic through the region, and how fast it rebuilds.

Underneath it, the conditions in plain sentences rather than a list of names.
"Footing is poor and everything takes longer to put right afterwards." "There is
one way in. Hold it and the fight is yours to shape." "The water is too shallow
to dive. Everything happens on the surface."

Teleporting to another region changes all of it, because the panel is read off
that region's profile rather than kept anywhere.

### The map

The world screen carries a Map section from the moment a world exists. It shows
how many places have been found against how many are still out there, how many
deployment points are open, what the squad can do, and how hot the thrusters are.

| Control         | Effect                                                                                 |
| --------------- | -------------------------------------------------------------------------------------- |
| **Work it**     | Takes what a site is worth. Once, ever. Shut with the distance on it when out of reach |
| **Route**       | Plans a way there: straight, and by way of everything already known, with both times   |
| **Deploy here** | Puts the machine down at a discovered point. Shut until the place has been reached     |

Walking finds things by itself: come within four kilometres of a site that can
be spotted that way and it appears on the map, with a line saying what was seen.
Getting within six hundred metres is what lets it be worked.

Not everything can be found by walking. Some places only ever appear on a chart
from a contract, your own analysts, an allied government, a carrier, or a piece
of infrastructure you repaired.

Thruster bursts cost heat. One burst puts in more than a second of cooling takes
out, so hopping across ground is a decision rather than a faster walk, and the
readout says whether a refusal was charge or heat.

### The assembly bay

The Fabrication Hall has to be built before it can be walked into. Its terminal
is the builder; the machine posts beside it are staff posts and do nothing.

| Control              | Effect                                                                        |
| -------------------- | ----------------------------------------------------------------------------- |
| **E** at the control | Open the builder                                                              |
| A part in a slot     | Fits it. In a structural slot this swaps whatever was there                   |
| A fitted weapon      | Takes it off again, since weapons and abilities allow more than one           |
| **Test range**       | Takes the build out without committing to it. Shut while the build is illegal |
| **Assemble**         | Builds it. Charges the cost and puts the machine on the roster                |
| **Scrap**            | Breaks up the machine standing in the bay, freeing the campaign's one slot    |
| **Export**           | Copies the blueprint to the clipboard as text                                 |
| **E** or **Close**   | Leave the builder                                                             |

Every figure is shown with what it is measured against: power drawn against
power made, heat made against heat shed, tons carried against tons the actuators
are rated for, hardpoints used against hardpoints fitted. Everything wrong with
a build is listed at once, with the numbers that make it wrong. A warning does
not stop a launch; a refusal does, and both the Assemble and Test range controls
carry the reason.

A campaign holds one custom machine. Blueprints are unlimited.

### The research board

Kaiju Research has to be built before it can be walked into, the same way the
Contracts Office does. Its terminal is the research board; the analysis benches
next to it are staff posts and do nothing.

| Control              | Effect                                                                             |
| -------------------- | ---------------------------------------------------------------------------------- |
| **E** at the console | Open the research board                                                            |
| **Start**            | Begin a programme: the samples and the money leave now, not when it finishes       |
| **To the front**     | Move a running experiment ahead of the others. Takes effect on the next tick       |
| **Stop**             | Cancel it. Half of everything comes back, samples included                         |
| **Lay it down**      | Build a research frame, once its programme is finished and the stores can cover it |
| **E** or **Close**   | Leave the board                                                                    |

Every programme shows what it needs against what you hold, what it hands over
when it lands, and the experiment itself while it runs. A programme that cannot
be started is greyed out and carries the reason: the prerequisite it is waiting
on, the sample it is short of, or the facility tier it needs. A frame that
cannot be built names the component it is missing.

Research runs on the same clock everything else does, so time skipped on the
world map is time the labs were working.

### The contracts board

The Contracts Office has to be built before it can be walked into: order it from
any facility terminal, then take the door out of LOCCENT. Its terminal is the
market.

| Control               | Effect                                                                           |
| --------------------- | -------------------------------------------------------------------------------- |
| **E** at the terminal | Open the contracts board                                                         |
| **Sign**              | Take the offer: the price leaves the treasury once and the machine goes on order |
| **E** or **Close**    | Leave the board                                                                  |

Each offer shows the yard, the mark, the role, the condition, the price, the lead
time, what it costs a day to keep, and four performance bands drawn as ranges
rather than a score, with the tradeoff written underneath and the contract terms
listed in full. An offer you cannot afford is disabled and says how short you
are, in money, rather than failing on the click.

Below the board: what is on order and how many days out, and the fleet you
already own by name and serial. Nothing is owned until it is delivered, and time
only moves on the world map, so a purchase means going away and coming back.

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

### Deployment and the sortie (Milestone 17)

Every incident on the alert board carries a readiness line and a **Deploy**
button. The line gives overall readiness, the pair's drift, the machine's
structure, the flight time from where the player is, how loaded the carrier is
and what the weather will do. Anything that stops the launch is listed as a
refusal and greys the button; anything that merely makes it a bad idea is a
warning that does not. Hovering Deploy shows the predicted threat at the
warning's own confidence, never what is actually out there.

Launching starts the carrier run, shown as a phase of the sortie block with its
own progress. **Skip the carrier run** ends it immediately; the sortie lands in
the same world the player was already in, in the machine, with the objectives
live. Nothing about the result changes if it is skipped.

The sortie block lists every objective with its state and progress as they
update. **Abort the sortie** ends it early and keeps whatever was already
achieved.

When a sortie ends, the results block gives the outcome, a summary and every
line behind it: objectives, machine damage, city impact, salvage, samples,
civilians, reputation, drift link, funding and the repair hours the bay now
owes. **Back to the map** puts it away and returns to free exploration.

### The alert board (Milestone 16)

The world panel carries the war. **War** gives global escalation and breach
pressure, and the last thing the director did. **Crisis frequency** is the
player's own dial: rare, standard, frequent or relentless. It scales how often
attacks happen, how many can run at once and how long the quiet is afterwards,
and it is bounded so it can never be turned off or turned into a firehose.

Below that is one entry per incident, and each says:

- which region, what state it is in, and how many in-game hours until it reaches
  the shore;
- how many hours it takes to get there from where the player is standing, and
  plainly when that is longer than the time available;
- what is coming and how confident the warning is, with the mutation tells the
  warning is good enough to include;
- the objective and any secondary objectives;
- what the model expects if nobody goes, with every contribution behind that
  expectation available on the line itself.

Two buttons per incident. **Let the defences handle it** resolves it with the
region's own defences; **Stand down** ignores it outright. Both run the same
transparent model, and the resolution that comes back is listed underneath with
its full ledger: kaiju strength, regional defences, civilian density, the margin
on the day, city integrity, escalation and any funding.

The **+1h**, **+6h** and **+1d** time controls advance the war as well as the clock, the
weather and the city's recovery.

### Reading a creature (Milestone 15)

Five rows on the pilot panel are the AI debug view. Nothing is bound to a new
key: this is what the creature is doing, shown rather than driven.

| Readout       | Meaning                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Kaiju goal    | What it is doing now and the sentence explaining why                                                                                         |
| Considering   | The alternatives it weighed this tick, with their scores, best first                                                                         |
| Senses        | Every contact: which source, which sense found it, how sure, and how far                                                                     |
| Path          | What navigation did (direct, detour, climb-over, burrow-under, swim-across, smash-through, blocked), in which medium, at what speed, and why |
| Creature body | Phase, abilities it can still use, anything severed, and organ health                                                                        |

Those rows are the same numbers the creature acted on, not a second copy kept
for display. A creature that has lost an organ shows the ability disappearing
from the list the moment it goes, and the hit log says which organ it was.

### City damage and rebuilding (Milestone 14)

Four rows on the world panel report what has happened to the city around you.
**Damage** gives the headline: how many blocks are damaged, how many are
levelled, what is still burning, how many people are still trapped, and the
safety rating that follows from all of it. **Hazards** breaks that out into
fires, contamination, the fraction of routes blocked by rubble, and how badly
rescue crews are needed. **Rubble** shows live debris bodies against the ceiling
the quality preset allows and how many have settled. **Rebuilding** says what
crews are working on and how many hours are left.

Under the controls, **Worst block** names the most damaged block in the city and
**Clear and rebuild** puts crews on it. The button is disabled, visibly, when
there is nothing down, and hovering it shows the quote in hours and funding. The
refusals are sentences: nothing to clear there, work is already underway, or it
is still burning and crews go in once the fire is down.

Nothing is bound to a new key. Damage is something that happens to the city
while you fight in it, and the **+1h**, **+6h** and **+1d** time controls now advance the
city's recovery as well as the clock: fires burn down, people come out, and any
crews on site keep working.

### Damage and repair (Milestone 13)

Two rows on the pilot panel report what the machine is carrying. **Damage** gives
the structure left as a percentage and then names every component that is not
whole, with what state it is in: scarred, damaged, barely holding, or gone.
**Systems** says what is offline because the component carrying it was lost, what
the damage is doing to how the machine walks and hits, and how many marks it is
wearing.

Nothing is bound to a new key: damage is something that happens to you. What
changes is what the existing keys do. A weapon on an arm that is gone refuses to
fire and says which arm took it with it. A machine with a bad leg walks and turns
more slowly, and one with no leg is towed home rather than walking.

A machine that cannot go out says so on the world panel, under the button that
would have sent it, with how many hours it is from ready.

In the Jaeger bay, walking up to a berth shows that machine's repair board: its
status and structure, every component with what is left of it, what is offline,
how many marks it wears, and the work order with hours and parts cost. **Work a
shift** puts eight hours into it, worst component first. The button is disabled,
visibly, when there is nothing to do.

## Not yet bound

No squad-command or menu-navigation keys exist yet. See
[../ROADMAP.md](../ROADMAP.md).
