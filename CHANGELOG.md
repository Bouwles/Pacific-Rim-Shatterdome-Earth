# Changelog

## 2026-08-24, Milestone 15: Kaiju framework, senses, behaviour and body zones

Kaiju think now. Not well, but for reasons, and the reasons are different for each of them.

- Nine ways of getting around: walking on two legs or four, coiling, flying, digging, swimming, doing both, crawling up a wall, or simply being too big for any of it to matter. Which one a creature is decides what an obstacle even means to it.
- A serpent cannot turn on the spot. Not "turns slowly": it has to travel to change where it is pointing, and the code enforces that rather than assuming everything pivots like a tank.
- Seven senses, none of which give a creature the truth. It sees a cone in front of it, hears in every direction, feels the ground through vibration, smells what has been past, and it ends up with a guess about where you were, which gets vaguer the less sure it is. Fight something in cover and it is looking for you rather than at you.
- Kaiju remember being hurt. Hit something from somewhere it never saw and it knows roughly where the blow came from, and it holds that longer than it holds anything else.
- Eleven things a creature can want: hunting, closing, flanking, waiting in ambush, climbing, digging, swimming, wrecking what it came for, stopping to eat, breaking off, and going past caring. It scores all of them every tick and takes the best, with enough margin that it does not flicker between two.
- Three creatures who do not fight alike. A brawler that walks at you and stays. A serpent that waits out of sight, then comes at you from the side rather than the front. And a digger that will not fight you at all if it can help it, because it came for the Shatterdome and you are in the way.
- Bodies that come apart in specific ways. Chest plate off before the chest is worth hitting. A throat sac that, once burst, ends the acid spit for good. A fin that, once taken, means the thing cannot corner. Phases that make a wounded creature slower and angrier and a nearly dead one faster and worse.
- A debug view that says what it is doing and why: the goal in words, the alternatives it weighed with their scores, every contact it has and which sense found it, what navigation did about the road, and what is left of the body.
- The fixed attack cadence is gone. Creatures used to swing every four seconds because a schedule stood in for behaviour. Now they close, hold, back off or ignore you entirely on their own.

## 2026-08-24, Milestone 14: Staged city destruction, debris, regional persistence and rebuilding

Hong Kong can be knocked down now, and it stays knocked down.

- Fight in the streets and the streets go. Blocks take damage where the fight happens, buildings come down in whole numbers, and the rubble ends up in the road. What is left standing around the hole is untouched: this is damage to a district, not a slider on a city.
- Seven states, and only three of them come from being hit. Intact, damaged and breached are how much is left standing. Collapsing, ruined, cleared and rebuilding are stages the city moves through over time and work.
- Fires that burn, contamination that lingers, and people still under the rubble. A warehouse district leaves poison behind; a tenement stack leaves the most people trapped. The panel tells you how many, and how badly rescue crews are needed.
- Rubble you can watch land. Chunks are thrown out of a collapse, bounce once, and settle, and the moment they settle they stop costing anything. There is a hard ceiling on how many can exist, set by your quality preset, and a collapse that wants more than the game has room for is told so rather than quietly given less.
- The damage is still there when you come back. Leave the city, leave the ground view, load a save from three sessions ago: the same blocks are still down. What gets saved is a handful of numbers for each block that was touched, so a levelled Hong Kong is about five kilobytes rather than a copy of the scene.
- Time does something. Come back a day later and the fires are out and people have been pulled out. Come back a week later with crews on the job and the rubble is gone and something is going up in its place. Nothing snaps back to new.
- Rebuilding is work, not a countdown. Crews clear before they build, take the worst block first, and go faster if you have actually built the logistics and fabrication facilities to back them. A region that is not secure slows them down, and a rebuild you have not paid for stalls and says how short it is.
- One button, on the world panel: the worst block in the city, what it will cost in hours and money, and crews on their way. It refuses out loud when there is nothing to clear, when work is already underway, or when the place is still on fire.

One problem found by hand, after the tests were green: the +1h and +6h buttons moved the clock and the weather and did nothing at all for a burning city. Six hours would pass and the fires would still be burning and the crews would still be standing there. Both paths through time now go through the same recovery.

## 2026-08-24, Milestone 13: Localized Jaeger damage, scars, disabled systems and recovery

A machine is no longer a health bar. It is a Conn-Pod, a sensor mast, a torso, a reactor, two arms and two legs, and what happens to each of them is different.

- Damage lands where it landed. Take a tail sweep across the shins and it is the left leg that comes back at seventy four percent, not "the machine" at ninety seven. Every component has its own structure, its own armour, and its own state, from scarred through damaged and barely holding to gone.
- The kind of damage matters as much as the amount. A neural weapon is worth three times as much against a Conn-Pod as against a leg. A piercing round is worth almost twice as much against a reactor. Nothing in the code knows either of them by name; it is a multiplier on a row.
- Losing a part costs something specific. Lose the right arm and the plasma caster and the chain sword go with it, and say so when you pull the trigger. Lose a leg and the machine walks and turns slower, and past a point it does not walk home at all. Lose the Conn-Pod or the reactor and the sortie is over.
- Scars that stay. A blow heavy enough to leave a mark leaves one, on the part it hit, and the machine wears it afterwards. The mark is four numbers, and the torn plate is grown from a seed, so a machine that has been through twenty fights costs no more to save than one straight off the line.
- Losing does not delete your machine. It comes back. If it can still walk it walks into the gantries; if it lost a leg or something critical it is towed, which takes twelve hours before anybody can start work; if it is barely there it is rebuilt rather than patched.
- A repair board on every berth. Walk up to a machine in the bay and you get its structure, every component with what is left of it, what is offline, how many marks it wears, and a work order with real hours and a real parts bill, replacements costing half again over patching. Put a shift in and the crew takes the worst component first, because that is the order that gets the legs back before the paint. Finish a component and its marks come off with the plate.
- A machine that cannot go out says so, under the button that would have sent it, with how many hours it is short.

Two problems found before this shipped.

The repair queue could stall forever behind a job whose hours rounded down to zero: a one point scratch on a sensor mast would hold up a leg replacement indefinitely. Work orders are now sorted worst first, and a shift always spends something.

And on an undamaged machine the panel read "all answering · all systems answering" with a trailing separator hanging off the damage line, which is the sort of thing that is invisible in a test and obvious the moment you look at it.

## 2026-08-24, Milestone 12: Ranged weapons, ammunition, heat and signature abilities

The machine has guns now, and they cost something. Seven weapons sit on the number row, and none of them is a button that deals damage forever.

- Eight behaviours through one piece of code. A plasma caster arrives the instant you fire it. Missiles leave in a salvo of three. The mortar arcs, and refuses point blank. The rotary cannon empties ninety rounds into something at close range. The arc whip puts a line on a creature and holds it there. The chain sword runs for as long as you hold the key. The booster strike is a charge, not a shot. What changes between them is a row of data, not a branch in the code.
- Ammunition that runs out and reloads that take time. Magazines, spare rounds, and one key that reloads whatever is emptiest. A weapon that has run dry says so and tells you whether there is anything left to load.
- Heat and reactor power as the other two costs. Hold the chain sword and the machine gets hot, because a channel pays its heat sixty times a second rather than once a swing. Nothing fires for free: a weapon that costs no ammunition, no heat and no power is refused before the game will even start with it in the table.
- Every refusal is a sentence. How far past a weapon's reach the target is, in metres. That the mortar needs a hundred and eighty metres of daylight. That the cannon only fires forward and you are facing the wrong way. That the missiles need a lock. That the magazine is empty. Nothing quietly does nothing.
- Rounds that are real objects with a hard ceiling. The pool is sized by the quality preset and never grows; a barrage that would exceed it is refused out loud rather than thinned in silence. Each round is swept from where it was to where it is, so a shell cannot pass straight through something between two ticks.
- Nothing left flying. A round is gone the moment it leaves the fight's own bubble, runs out of range, hits the ground, or reaches its lifetime. There is no shell still travelling over the Pacific ten minutes after the fight ended.
- Status effects that keep working after the shot lands. Burning, shocked, bleeding, corroded, tethered. Each says what it does per tick, what it does to movement and output, and how it ends. Fire and corrosion go out in the sea.
- A way for anything that is not a player to choose a weapon, and explain itself. One score and one sentence out of the same numbers both sides already have, so an AI, a training hint and a test cannot disagree.

Four problems found by hand in the browser, none of which any of the automated suites had noticed.

The worst one: every shot, reload and refusal was missing from the log. A combat step can only report what that step produced, and a trigger is pulled between two ticks, so all of it was being dropped on the floor. The arena now keeps a drain cursor and the panel reads that.

Weapons fed by heat or reactor power read as "no ammunition", which looks exactly like a weapon that is out of ammunition. They say how they are fed instead.

Status effects were logged by their internal ids, so the line under the readout read "status.bleeding" rather than telling you anything.

And the coaching line, which is meant for advice, was being taken over by every routine shot going off as asked.

## 2026-08-24, Milestone 11: Melee combos, defence, counters, grapples and finishers

There is a fight here now rather than a set of attacks. Walk into range, throw a jab into a cross into a heavy, and watch the combo counter climb. Or stand your ground and parry, or take hold of the thing and put it through a building.

- Directional attacks: the heavy is a different move depending on which way you are pushing. Forward is a smash that closes the distance, sideways is a spinning backhand that answers something that circled you.
- One charged attack. Hold it and the damage more than doubles, and nothing interrupts you while you wind it up, which cuts both ways.
- Dodging that does not erase everything. The invulnerable moment is in the middle of the step rather than at the start, it costs stamina, it has a recovery you can be punished during, and it only comes out of moves that allow it. A dodge is an answer, not an escape hatch.
- Blocking, perfect guards and parries. Hold guard and you take a quarter. Raise it as the hit lands and you take nothing and they are left open. Time a parry and you get a free counter, but miss the window and it is worse than not trying at all.
- Grapples that both sides are involved in. Seize them and there is a struggle: they push to get loose, you push to hold on, and the hold runs out on its own if neither of you wins. While you have them they cannot swing at you.
- Throws and wall slams, with the space checked first. A throw that would put them through a tower does not happen; you let go instead and it says so. A slam needs something solid behind them, and a slam with nothing there leaves you still holding on rather than costing you the whole grapple.
- Environmental weapons. Pick up a gantry crane, a bridge section, a fuel tanker or a slab of roadway and swing it. One move covers all of them; what changes is how heavy it is, how far it reaches, how hard it hits and how many swings it survives. A container ship gets exactly one.
- Finishers that are a short sequence rather than a cutscene. Four beats with their own camera framings, two of which need you to keep holding the input. Anything that hits you stops it, and you keep the damage you had earned rather than all of it or none of it. They are rare on purpose: the target has to be nearly finished and either reeling or already in your hands.
- Three accessibility settings, all producing the same damage. Reduced motion flattens every finisher framing to one wide shot. Hold to complete, which is on by default, turns repeated presses into a held input. Skip sequences applies the whole outcome at once.
- A move list written from the game's own move table, so it can never describe a move that does not exist or miss one that does. Every entry has the key you press, a speed in words, and a line of coaching. There is not a frame count anywhere in it. Under the readout there is a coaching line that says what just happened: why the dodge missed, that the hold is slipping, why the throw became a release.

Six problems, all found before anybody had to look at a screen.

A parry promised a free counter and then the arena refused it, because the parry was technically still running and a parry cancels into nothing.

A seize took hold the moment it was thrown rather than when it connected, which meant a finisher out of a grapple was refused as an illegal cancel out of a move that had not finished.

A failed slam silently dropped the hold, so trying to slam somebody in open ground cost you the whole grapple for nothing.

Grapple impacts reduced a creature's core health without going through the check that notices a creature has died, so a fight could carry on with the thing already at zero.

The struggle numbers were so far out that a hold lasted eight ticks, which is not a grapple, it is a nudge.

And a zone that was already destroyed carried on absorbing hits, so taking a creature's armour apart was decorative. Hits now fall through to what is behind.

## 2026-08-24, Milestone 10: Combat targeting, input buffer, and attack framework

There is something to fight, and a language every fight will be written in. Take a machine out, press spawn test kaiju, walk into range, and throw a jab into a cross into an overhead hammer.

- Every attack is a row of data. How long the wind-up is, how long the fist is dangerous, how long you are stuck afterwards, how far the move carries you, how much you can still turn while it runs, what it cancels into and when, where the damage lands and what it costs in stamina and heat. No attack lives in an animation string, and no code knows a move by name.
- Hits are swept rather than sampled. A fist crosses twenty metres in five ticks, so the volume is tested along the whole path it took rather than at the two ends of it, and it works the same way when the creature is the thing moving.
- A kaiju is not a health bar. It is a head, a torso, a core, two limbs and a tail, each with its own health, its own armour and its own consequence for being destroyed. One of them ends the creature and the others cost it something specific.
- Four ways to say what you mean. A swing thrown at something obvious lands on it. A lock holds one target through a camera change. Cycling walks across what is on screen from left to right. Aim mode picks a body zone, which is the only way going for the core means anything against something eighty metres tall.
- Reactions are shared. Flinch, stagger, guard break, launch, wall impact, knockdown and component shock, and a machine goes through them exactly the way a creature does. A tail sweep knocks the machine down and the locomotion controller takes it from there.
- Poise decides staggers. Slow expensive moves can knock down outright, everything else has to spend a target's balance first. This is the rule that stops a good machine holding a creature in a stagger for a whole fight.
- Presses are buffered. A button pressed a fifth of a second before the machine can act on it still fires, and one pressed while flat on your back expires rather than going off when you stand up.
- Illegal cancels are refused with the reason written out. Too early, too late, into something the move does not cancel into, or out of a swing that missed and had to land first. The refusals go in the log next to the hits.
- The hit log says which volume connected, on which tick, against which body zone, for how much, and what reaction it caused. Turn on hit debug and the zones are drawn where the resolver believes they are, shrinking as they take damage.

Three problems the tests found before anyone had to look at a screen.

Component shock outranked a heavy attack's own reaction, so every heavy that also carried shock was quietly downgraded to a twitch nobody could see.

Then, with that fixed, heavies staggered on every landing, and the creature spent an entire fight on its back without acting once. Poise now gates staggers and the fight goes both ways.

And a destroyed body zone reported itself destroyed again on every hit that landed anywhere near it, so a head could be lost seven times in one exchange.

Nothing about a fight is saved. Damage that outlives a battle belongs to the per-component damage milestone, and guessing at that milestone's save format now would be inventing a schema to throw away.

## 2026-08-24, Milestone 09: Jaeger locomotion, scale, and camera foundation

You can take a machine out and drive it. Pick one from the world map's ground view, press take the machine out, and the roster entry you were inspecting in a Shatterdome berth is standing in Hong Kong under your control.

- One controller for every machine. Everything that separates a heavy tank from an agile frame is a row of numbers: speeds, acceleration, braking, turn rates, step height, slope limit, stride length, booster, and how long it takes to get back up. The code driving them has no idea which one it is driving, and three machines ship to prove it.
- Mass is acceleration, not camera shake. A Jaeger takes a couple of seconds to reach a walk, keeps rolling for a long moment after you let go, turns badly while running and well while planted, and puts a foot down every twenty seven metres of ground it actually covers.
- Twenty states, from standing and starting through walking, running, strafing, guarded movement, turning on the spot and stopping, to stepping up, falling, landing, wading, swimming, walking the seabed, boosting, being knocked back, being knocked down, getting up, limping on a dead leg, and dying.
- The ground is checked before it is stood on. Wrecked cars and rubble are walked straight over, a loading ramp is stepped onto, a cliff face stops the machine rather than being climbed, and walking off a shelf is a real fall with a real landing.
- Three cameras: a wide chase camera for exploring, a tighter one for fighting, and one inside the Conn-Pod. Switching between them changes where your eye is and nothing else. Where you were looking, what you had locked, your comfort settings and the controls all survive the swap.
- Comfort controls sit on the pilot panel rather than in a settings menu, because that is where you want them when a camera is making you ill. A motion slider, reduced motion, invert look. Turning all of it off does not turn off what tells you how big the thing is.
- Scale is shown rather than claimed. Eight metre street lights go past the ankles, aircraft and birds cross overhead, footprints stay on the ground behind you, dust rises where a foot landed, and a footfall a kilometre away is heard three quarters of a second after it is seen.
- Buffered input. A booster press made slightly too early still fires when the machine can act on it, and one made while the machine was flat on its back expires instead of going off when it stands up.
- Nothing new is saved, because nothing new is history. A machine out on the ground is a live session, and where it walked is already saved by the world.

Three defects were found, two of them only by looking at it.

The machine was invisible. The streamer draws a white box where the player is when nothing else represents them, and it was standing in exactly the same spot as the Jaeger, at exactly the same height, hiding it completely. It is switched off while a machine is being driven.

The pilot panel wiped the world panel. It cleared the container it was rendering into, which took the streaming readout down with it. It appends now.

And the heading lag on the panel read zero whenever the stick was released, because it was measuring against the steering intent, which is null when nobody is steering. It measures against where the player is looking instead, which is a number that means something at all times.

## 2026-08-24, Milestone 08: Explorable Shatterdome and on-foot player

New Game no longer lands on a screen that says the Shatterdome is not implemented. It puts you on the command floor, at eye height, with six people on shift around you and the Marshal telling you how much power is on the board.

- Thirteen facilities, each a rule rather than a room: a footprint, a deck, the stations it holds, and a ladder of tiers that cost time, crews and power and give back staff, fixtures and one honest sentence about what changed. Adding a facility is a row.
- Two constraints and no invented currency. Power comes from the reactor and everything else draws it, so a laboratory can be refused because the reactor cannot carry it. Crews come from logistics and are tied up for the length of a build, so a third order at once is a decision. Money and contracts arrive with the economy milestone, and nothing here pretends otherwise.
- The complex is a graph of rooms rather than one enormous interior. Only the room you are standing in exists, so the hundred and thirty metre Jaeger bay costs nothing while you are in the archive. Doors, lifts and trams are real edges with real travel times, and the room swaps at the darkest point of a short fade.
- A facility you have not built has no room at all, and the doorway that would lead to it is sealed and tells you which one is missing. Order it and the scaffolds go up in that room immediately. When the work lands, the bulkhead becomes a door you can walk through.
- Walking is at person scale and every number is written down in one place so it can be compared against a seventy five metre machine. You walk, run and crouch, slide along walls instead of sticking to them, and cannot pass through a console even at a full run in a long frame.
- The whole interior is playable without a mouse. Tab cycles what is in the room and turns you to face it, E uses it, arrows look, U puts you somewhere clear if geometry ever traps you, and every prompt is mirrored to a screen reader.
- Management happens at terminals you walk up to, not in a menu. The board lists every facility with its deck, tier, power draw and staff, the next tier with its cost in crews and minutes, and an Order button that is greyed with the reason when it cannot be pressed.
- Berths hold the roster machines and resolve them through the same asset pipeline everything else uses, so dropping in a real model is still a data change. The Conn-Pod is a room you board rather than a camera move, and its instruments read the live world outside: the time, the weather, the wind, how far you can see, and what the alert level is over the city.
- Nobody is simulated outside the room you are in. A facility's population is one integer derived from its tier and the hour, and inside the active room those numbers become positions that are a function of index and tick, so a crew member has no state to update and nothing to save.
- Fifteen named crew, original characters written for this project, each with a post, a shift and lines whose blanks are filled from live facility state. The night watch is a different person from the morning one, and half the accommodation deck is asleep at eight in the morning because the steward says so.
- Saves moved to version 5, carrying the facilities, what is being built and how far along it is, where you were standing, and which machine you had selected. The rooms themselves are never saved: they are laid out again from those records.

Six defects were found and fixed. Four of them only showed up once there was something to look at.

The ceiling was black. A hemispheric light lights downward faces with its ground colour, and the ground colour was almost nothing, so an enclosed room had what looked like a hole above it.

Every fixture glowed. One emissive value for all of them turned a desk, a doorframe and a console into the same white block. Screens and hatches are lit from inside now; furniture is not.

The staff were standing inside their own desks. A post is a piece of furniture with a footprint, so a person placed exactly on it is invisible. The first staffed room I looked at reported six people and showed an empty floor.

Then it reported six people and still showed an empty floor, for a different reason. The instance pool is allocated with everybody parked below the deck, which put its bounding box nowhere near the room and had the whole mesh culled. Refreshing the bounds fixed the culling and it was still empty, because on WebGPU a thin instance buffer whose count grows from zero is not picked up by marking it updated: the buffer has to be set again. It is, now, when the number of people changes rather than every frame.

The radio repeated itself. With two or three lines to a character and one character on shift, picking blind said the same thing three times running, which reads as a broken radio rather than a quiet one. It now walks past whatever was just said.

And the Conn-Pod was a black void with one glowing hatch in it, because the room lamp's range stopped halfway across a four metre room.

## 2026-08-23, Milestone 07: Hong Kong vertical slice and living city layer

Hong Kong exists. Not a region record with a name on it, an actual city with districts, a skyline, a harbour, roads, a Shatterdome precinct and slums grown against its wall, and a population that reacts when something is coming.

- The city is grown from a grammar rather than placed by hand. A district is a rule: how big the blocks are, how tall, how densely packed, how regular, how many people live there and how early they get evacuated. Seven of those rules, arranged as wedges measured from whichever way the water lies, produce 710 blocks and 1,480 towers.
- Because the plan is measured from the coast rather than from north, the harbour ends up on the water wherever the region happens to sit on the globe.
- It is a stylised original. It takes the shapes a dense harbour city has, towers along the front, a ridge behind, docks down the shore, an improvised district pressed against the Shatterdome wall, and arranges them from a seed. No real street plan or map geometry is copied and none is claimed.
- Roads, shipping lanes, ferry routes, patrol lanes, air corridors, evacuation zones with muster points up on the high ground, seventeen defence positions facing the right way, and two deployment routes: one at walking scale off the Shatterdome apron, one at Jaeger scale straight through the waterfront to open water.
- Every block belongs to a destruction group, and every group is its own mesh. That is what makes the city something you can stream in pieces and eventually knock down in pieces, rather than one enormous model that can only exist or not exist.
- Nobody simulates a civilian. A district is a handful of numbers saying how much is moving and of what kind, and the renderer turns that into a bounded pool of instances travelling fixed lanes. A district of ninety thousand people costs exactly as much to think about as an empty one.
- Five alert levels, and they change the city rather than changing a label. Going to attack at Hong Kong took the streets from 26 percent busy to 4, cleared the harbour from 31 percent to 2, took the military from 15 percent to 100, sounded the sirens and started moving people to muster points. The vehicle pool went from 107 civilian cars to 196 mostly military ones.
- The response ramps rather than snapping, because a city does not empty the instant a siren starts, and evacuation flow peaks in the middle of an evacuation because nobody is moving before it begins and nobody is left once it is done.
- Time of day, rain, wind and damage all move the same numbers. A levelled district is empty whatever the hour says.
- Saves moved to version 4 to carry the alert level and how far the evacuation got. The city layout itself is never saved: it comes back identical from the seed, so storing it would only make saves grow with how much of the world you had visited.

Five defects were found and fixed. Three of them only showed up once there was something to look at.

The muster point for the ridge district ended up along the coast instead of inland. Each district offset its muster point by a fraction of its own bearing to stop them all piling on one spot, and for a district on the far side of the city that fraction swung it right round to the shoreline. The fan is now bounded, so a muster point is always somewhere away from the water.

Recovery kept the sirens going. Its own description said sirens off, and its number said fifteen percent, which is not off. The all clear is a thing that happens, and a siren that never quite stops is a siren nobody listens to.

The city ran at nineteen frames a second in the test browser. Six hundred agents were each asking the terrain streamer for a ground height every frame, which is a geodetic conversion and a sector lookup each time. The terrain is now sampled once into a grid when the city is built.

That turned out not to be the whole story, because the real browser was already running at 144. The frame rate the test was reading came from Playwright's software renderer, not from this code. That assertion is gone; the tests now check draw calls and that the simulation keeps ticking, which travel between machines, and the real numbers are recorded by hand.

The landmarks were half a kilometre wide. At up to twice a block across and nearly twice the district height, the tallest came out as a cone that read as terrain rather than as a building. They are slimmer now, and look like spires.

Two more things were adjusted after looking at the result. Splitting a twelve kilometre city into 320 metre destruction cells produced 233 groups, which meant a mid-range machine drawing its budget of groups covered a patch of city rather than a city; 480 metre cells bring it to 135. And the panel was reporting how much of the city was drawn while standing on the globe, where nothing is drawn at all, so those two rows now disappear when there is no city view to report on.

## 2026-08-23, Milestone 06: day, weather, atmosphere, and ocean foundation

The world got a sky and a sea. Time passes, weather arrives and leaves, and the ocean is something you can wade into, stand in, swim on and sink under.

- Time runs on simulation ticks, not on the wall clock. One tick is one in game second, so a day is twenty four real minutes. Pausing the simulation pauses the sun, and a save reproduces the sky it was written under rather than whatever time it happens to be when you load it.
- The sun and moon are placed with the real formulae, so there are real seasons, the sun behaves differently at Anchorage than at Manila, and a full moon rises as the sun sets. It ignores the equation of time and assumes a circular orbit, which is stated rather than hidden.
- Weather is worked out from the seed rather than simulated forward. Fronts occupy fixed six hour slots, so asking what the weather is a thousand years from now costs exactly as much as asking about today. Weather holds steady and then crossfades, which makes transitions smooth because of how it is built rather than because something smooths them afterwards.
- Rain, storms, fog, snow, wind, cloud, lightning and spray, each derived from one sample that the sky, the particles and the gameplay numbers all read. What the player sees and what the game believes cannot drift apart.
- The one thing weather remembers is wetness. Ground stays wet after rain stops, and that single number is all a save carries, because everything else is a function of the seed and the tick.
- The ocean is a height field, not a pile of physics bodies. One function answers where the surface is, and rendering, gameplay and any future physics all ask it. Wave position is fixed to the planet rather than to the floating origin, so the sea does not slide sideways when you walk two kilometres.
- Five water states, and the one that matters is the difference between standing and floating. A seventy five metre Jaeger wades through shallows, stands and fights chest deep on the shelf, floats over the deep, and can walk the sea bed if you tell it to. Getting that wrong would have it bobbing in five metres of water.
- Weather is not decoration. Fog and darkness cut how far anything can see, wet ground is slippery and ice is far worse, water slows you down, wind and rain spoil ranged accuracy, and lightning briefly gives the light back. All of it comes out of one place, so a value that is missing from it is visibly missing rather than quietly absent.
- Everything AI and combat will ask about the environment goes through one module that cannot reach the renderer at all. That is deliberate: the question "can I see that" must have the same answer in a test with no screen as it does in the game.
- Low, Medium, High and Cinematic quality, where every setting is a number something actually reads. The rule holding the table together is that lowering quality removes detail and never information: the code refuses to register a quality level that drops the lightning flash, the spray where something entered the water, the fog that explains why you cannot see, or the moving sea.
- A small synthesised ambience that filters down to almost nothing underwater, because underwater is not quieter, it is the loss of every high frequency. It ships no audio files and never will.
- Saves moved to version 3 to carry the clock and the wetness, with a migration that starts an older save at the same fresh morning a new world does rather than inventing a history for it.

Seven defects were found and fixed rather than written around. Four of them only appeared once there was something on screen.

The moon spent every night below the horizon. Its phase offset had the wrong sign, so a full moon sat eighty seven degrees underground at midnight. A test caught it before anything was drawn.

Fog was solved from the wrong constant. Exponential squared fog needs the square root of three over the visibility distance, not three, and using three squares the exponent: the whole scene faded to flat colour well inside the distance the game was telling itself it could see. It looked like the world had failed to load.

The debug camera sat seven kilometres back, which is further than visibility in most weather, so even correct fog would have been looking through more fog than air. It now sits at nine hundred metres.

A new session started at tick zero, which is midnight, while a migrated save started shortly after sunrise. Two starting states that disagreed, and the one a new player got was total darkness. Both now come from one constant.

Calling a thirty metre per second storm safe. The hazard test looked at visibility, grip and water and never at wind, which is the loudest hazard in a storm.

Rain sized to scale is invisible. A raindrop is a couple of millimetres, and rain the player cannot see fails as the telegraph it is supposed to be, so it is sized to be legible instead.

The walk buttons stepped a fixed kilometre, which steps clean over a coastline. The shelf between wading depth and open water is a few hundred metres wide, so at a kilometre it does not exist. The step is now selectable, and at a hundred metres the whole coast can be walked.

One more thing was changed for honesty rather than because it was broken. The browser tests were running eight files at once, and every test now starts a graphics context, a terrain worker and a set of particle systems. Eight of those together timed each other out and failed a different test on every run, none of them for a real reason. The suite now runs one file at a time. It is slower and it says the same thing twice.

## 2026-08-22, Milestone 05: sector streaming, procedural terrain, and world partition

The globe stopped being coordinates and became ground you can look at. Sectors now load, build, sleep and get thrown away as you move, and the terrain under them is generated rather than authored.

- Terrain is generated from noise hashed on the position of each sample rather than drawn from a random sequence. That sounds like an implementation detail and is the whole design: two sectors that share an edge have to agree on that edge no matter which one was built first, or whether the other was ever built at all. Shared edges match exactly, to zero, not merely closely.
- Noise is sampled in three dimensions on the sphere rather than in two per cube face. A per face field would seam along the twelve cube edges, and nothing hides a coastline that stops dead at a face boundary.
- Each sector carries a coast, a biome, city footprints, traffic lane markers, landmarks and a coarse height field the player stands on. None of it claims to be geography. The generator knows the latitude of a sample, a seeded moisture field and the authored regions, and nothing else.
- Sectors move through eight states: absent, queued, generating, cpu ready, gpu uploading, active, sleeping and evicting. Terrain data and meshes have separate lifetimes throughout. Dropping a sector frees its meshes and keeps its data in a size bounded cache, so turning around costs nothing and no mesh is ever kept alive merely because its data is cached.
- Heavy generation runs in a real worker behind a versioned, validated message protocol, with buffer handover instead of copying, a job queue, and cancellation that actually lands before a sector the player has flown past gets built. If a worker cannot be created the game generates on the main thread instead and says so on the panel rather than hiding it.
- Rings are square, three deep, 49 sectors resident and 25 of them drawn. Load order is ring distance first, then which way you are travelling, then anywhere you have said you are deploying to.
- Meshes are pooled by level of detail, buildings and traffic markers are thin instances, and the whole streaming system reports itself: every state count, generation and upload time, memory, cache hits, cancellations and evictions.
- Nothing about any of this is saved. Terrain is a pure function of the world seed, which saves already store, so a save regenerates the same world byte for byte without carrying a single vertex. Two streamers on one seed are asserted to agree; on different seeds, to differ.
- A deterministic stress route flies Hong Kong, Manila, Tokyo, Vladivostok and back, and runs identically headless in a test and live in the browser.

Nine defects were found and fixed rather than documented around. Six of them only showed up once there was something on screen to look at.

Two came from circular reasoning about content. Terrain that ignored authored regions put a Shatterdome underwater and turned the open ocean Breach into a 640 m mountain. Regions now tell the generator what they are, and the generator honours it without ever learning what a Shatterdome is.

One was a genuine module cycle. Moving the region to terrain mapping into the world layer made three files import each other in a ring, which left two constants undefined at startup and produced entire sectors of NaN heights, rendering as nothing at all. The mapping moved to the content layer, and a validator now names a bad anchor instead of quietly producing a sector of nothing.

Letting biome affect elevation made two adjacent sectors in different climate bands disagree by 25.6 m along their shared edge, which reads as a wall running down a sector boundary. Height is now one continuous global field and biome only decides how it is coloured.

Expanding rings through edge neighbours only produced diamonds, which left the four corners of the loaded area empty: a black notch in the middle distance where the ground stopped. Rings now include the diagonals and are square.

A fixed depth apron around each sector was shallower than the height difference between a sector and a coarser neighbour, so seams showed as black cracks. The apron is now sized from the relief of each sector.

Anchorage came out as a 500 m island inside a 3.5 km city, and every candidate building site was rejected as sea. The shaped ground now covers the whole radius of a region. The shelf height was then picked by measuring all eight regions across a range of values rather than by guessing.

The world panel grew tall enough that its buttons went off the bottom of the screen and then under the debug overlay, where they could not be clicked at all. Controls moved above the readouts, on the reasoning that readouts grow forever and buttons must stay reachable.

The panel refreshes four times a second in the ground view, and each refresh reset the destination dropdown to wherever the player already was. Choosing somewhere and pressing Teleport went nowhere. It now follows the world only when the world itself moves.

Terrain streams in after the player is already standing there, so the player kept the altitude they arrived with: zero, while the ground underneath read 169.8 m. The player now settles onto the ground as it arrives.

## 2026-08-21, Milestone 04: seamless miniature Earth coordinate system

Established the planet everything later stands on: how a position is expressed, how the globe is divided, and where the line falls between the part of the world being simulated in detail and the part that is only a record.

- Earth is a cube sphere, not a flat plane. Six cube faces divided into a 16 by 16 grid each, projected onto a sphere, giving 1,536 sectors of 9 to 12 km. A latitude and longitude grid was rejected because it has a singularity at each pole and cells that shrink to nothing near them.
- The globe is scaled to a fiftieth of real Earth, a radius of 127 km, while Jaegers and cities keep their real size. That is what miniature Earth means here. Hong Kong to Tokyo is 2,890 km in reality and about 58 km here.
- Positions are stored as latitude, longitude and altitude, and converted into a local east, north and up frame near the player. A single flat world space loses precision the further you get from its origin, which is exactly what a seamless planet provokes. Round trip error between the two is measured under a micrometre across the active bubble.
- Sector neighbours are found by stepping off the edge, projecting back onto the sphere, and asking which face the point landed on. The alternative, a hand written table of 24 edge adjacencies, is both the kind of name keyed branching the project bans and something that silently falls out of step with the face definitions. Tests check all 1,536 sectors have four distinct neighbours, that the relation is symmetric everywhere including the eight cube corners, and that walking neighbours from one sector reaches the whole globe.
- A floating origin keeps local coordinates small however far you travel. Walking 25 km keeps them capped at 2,000 m instead of climbing to 25,000. Rebasing changes no authoritative state at all: global positions stay geodetic and only the local projection moves, so a rebase cannot make anything teleport or explode.
- A globe map showing region markers, the player, the active sector and its four neighbours, with a full coordinate readout, plus teleport and walk controls.
- Eight strategic regions including Hong Kong, Tokyo, Sydney, Manila and Anchorage. Exactly one region is ever simulated in detail. Every other is a small record with integrity, safety and a last visited tick. The save format rejects any snapshot claiming two active regions, so the rule cannot be broken by a future code path.
- Saves moved to version 2 to carry world state, with a migration that places an older save at the documented start rather than inventing a position for it.

Four defects were found and fixed rather than written around.

Rebasing was first written as subtracting the anchor shift, which a test caught as wrong. Two tangent planes on a sphere differ by a rotation as well as a translation, so subtraction drifted 2.9 m across a 4 km rebase, which is a visible pop on a 75 m Jaeger and the exact thing this milestone forbids. Rebasing now goes back through the global position and is exact at any distance.

A plain cube sphere left corner sectors 2.31 times larger than face centre ones. Warping the grid before projection brought that to 1.35, so streaming cost barely depends on where you are.

Region radii sized like real metropolitan areas overlapped once the globe shrank, leaving four city pairs ambiguous about which region you were in. Radii now mean the dense combat core, capped by the tightest pair on the map.

Walking in a flat local frame lifted the player 239 m off the curved globe over 25 km. Movement now carries altitude across, keeping you on the ground.

Tests went from 193 to 253 unit and integration tests, and from 32 to 40 browser tests. Everything from the previous milestones still passes unchanged.

## 2026-08-21, Milestone 03: local save foundation, slots, autosaves and migrations

Persistence built before there is much to persist, so every later system inherits a settled serialization contract instead of inventing one.

- Saves go to IndexedDB, never localStorage, behind a `SaveRepository` interface. There is an IndexedDB implementation and an in-memory one, used by tests and as the fallback when the database cannot be opened.
- Named slots with metadata: name, world seed, play time, last played, simulation tick, app version and a thumbnail. Manual save, rename, overwrite and delete, plus a rotating three slot autosave ring.
- Every write rolls the previous contents into that slot's backup ring first, which doubles as the pre-migration backup: an old file is preserved untouched before anything upgrades it.
- Loading validates the record, and on any failure walks the backups newest first. Failure covers unreadable bytes, a migration that throws, a document that fails validation, and a checksum that no longer matches.
- Versioned save envelope with pure migration steps. Version 0 is a bare kernel snapshot, which is genuinely what the simulation has serialized since Milestone 01, so the migration path is exercised by a real artifact rather than an invented one. A fixture of it is loaded in tests and checked field by field for data loss.
- Export writes a slot to a JSON file. Import parses, migrates and validates before anything touches a slot, so a bad file cannot overwrite good data.
- Storage health panel reporting backend, record count, usage and quota, with plain warnings for near full storage, storage the browser may evict, and the memory only fallback.
- Saves contain authoritative simulation state and metadata, nothing else. Validation pushes the document through the state hash, which rejects functions, undefined values and cycles, so an engine object cannot reach a save file.

Two defects were found by manual verification and fixed rather than written around.

A damaged slot was being skipped in the slot list, which meant recovery was unreachable from the UI in exactly the case recovery exists for: with no row there is no Load button, so a perfectly good backup was stranded. Damaged slots are now listed, flagged, and described from the backup that would actually load.

Thumbnails came out solid black under WebGPU, whose swap chain is not a readable 2D source once a frame has ended. Capturing inside the render loop was tried first and measured still blank, so thumbnails now render through a render target, which works on both backends. Verified by decoding the stored image and sampling pixels.

Cycle detection was also added to the state hash, which the save validator relies on. A circular document previously failed only by running out of stack, which is slow and says nothing useful.

Tests went from 120 to 193 unit and integration tests, and from 19 to 32 browser tests. Everything from the previous milestones still passes unchanged.

## 2026-08-20, Milestone 02: asset manifest and procedural placeholder factory

Built the asset pipeline. The game ships with no model files and is fully renderable anyway, and installing a real model later is a data change with no code change.

- Typed asset manifests in `src/assets/manifest.ts`. Each one carries the production model path, a mandatory procedural fallback, material slots, animation tags, named sockets, a collision proxy, audio and portrait slots, a nominal height, a seed, and provenance with an explicit licence. Plain data with no Babylon or DOM types, so it validates headlessly and can move to JSON later.
- Eight parameterised generators in `src/assets/generators.ts` covering all seven asset classes: biped, quadruped, serpentine, block building, wheeled vehicle, hull ship, prop and Shatterdome module. Two Jaegers and a bipedal kaiju all come from the same biped generator with different numbers, so adding a unit means adding a data row rather than writing another mesh factory.
- Named sockets: head, chest, back, reactor, hand and forearm left and right, both feet, and muzzle. Gameplay attaches to a socket name, never to a mesh, which is what lets a model swap leave combat code alone.
- Model validation in `src/assets/inspection.ts`. Checks height against the manifest within ten percent, forward axis, origin at the base, every socket node present, every animation tag resolvable, failed textures, and triangle, material and texture memory against per class budgets. Wrong scale or a missing node is an error. Going over budget is a warning, because it costs performance rather than correctness.
- Resolver in `src/assets/resolver.ts` tries the production model first and falls back to the generator on any failure, logging one warning per asset that names the asset, the path, the generator that took over, and where to put the file. It warns once per asset rather than once per attempt, so a render loop cannot flood the console.
- Asset gallery reachable from the main menu. Loads all twelve placeholders side by side, measures each from its built geometry rather than repeating what the manifest claimed, and reports budget status. Includes a turntable, a damage preview, and a manifest selector that can swap palettes or point at an uninstalled model to exercise the fallback path by hand.
- Manifest overrides can only reach source, fallback generator, materials and portrait. Collision, sockets, nominal height, animation tags and asset class are unreachable by type, so a presentation swap cannot change gameplay even by accident.
- `public/assets/models/` is the documented drop point, with a README covering the install steps and every rule the validator enforces.

Two defects were caught by the project's own validator and fixed rather than suppressed: the serpentine kaiju floated 3.29 metres above its origin, and the civilian car broke a vehicle material budget that was itself too tight at two slots for a body, glass and tyres.

Two more were caught by looking at the screen. The placeholders rendered nearly black under the boot scene's single directional light, and most of the row floated past the 60 metre boot ground. The gallery now owns a fill light and a deck sized to the row. The damage preview also detached parts in alphabetical order at first, which dropped the torso while the arms floated in place; it now ranks parts by distance from the silhouette centre, so extremities come off first and it stays generic across every generator.

Tests went from 84 to 120 unit and integration tests, and from 10 to 19 browser tests. Everything from the previous milestones still passes unchanged.

## 2026-08-20, Milestone 01: deterministic simulation kernel and developer diagnostics

Added the simulation kernel that everything later plugs into. It has no reference to Babylon or the DOM, so it runs the same in a browser frame, a worker or a headless test.

- Simulation kernel in `src/simulation/kernel.ts`. One tick drains the command queue, applies each command, runs systems, then advances the tick counter. Owns entities, RNG streams and the event bus, and can serialize, restore and hash its own state.
- Simulation loop in `src/simulation/loop.ts`. Turns render deltas into fixed ticks and adds pause, resume, single step and 0.25x to 2x time scale. Clamps incoming deltas to 250ms on top of the existing substep cap so a tab that was suspended for minutes cannot queue thousands of catch up ticks.
- Versioned, serializable commands and events. Dispatch is a registry lookup on command type, never a switch. Commands are validated when queued so a bad one is blamed on the code that sent it rather than showing up later as corrupt state. The event bus queues on emit and dispatches on drain, so a listener can never mutate state in the middle of a tick.
- State hashing in `src/simulation/hash.ts`. Two lane FNV-1a over a canonical encoding that sorts keys and hashes numbers as raw float bytes. This is the signal that catches any loss of determinism.
- Named RNG streams added to `src/simulation/rng.ts`. Each subsystem draws from its own stream derived from the master seed, so heavy use in one system cannot shift another system's sequence.
- Entity system in `src/entities/entity.ts`. Ids are monotonic and never reused, because recycling them lets a stale reference silently point at a different entity. Components are validated on write and stored as copies.
- Deterministic scenario runner in `src/debug/scenarioRunner.ts` with a fixture called kernel-smoke: seed 20260819, 120 ticks, RNG driven spawns and a mid run despawn. Two runs that hash differently mean determinism broke.
- Debug overlay moved from `engine/diagnosticsPanel.ts` to `src/debug/overlay.ts` and extended with frame time, simulation tick, entity count, physics bodies, seed and run state, plus working pause, step and time scale controls and an F3 toggle. The old element id was kept so the previous milestone's browser tests still pass unchanged.
- Seed configuration in `src/app/config.ts`. Fixed default, overridable with `?seed=` in the URL.
- Physics bodies in the overlay read "n/a (no backend)" instead of 0, because no physics engine is wired yet and a zero would imply one was.

Tests went from 21 to 84 unit and integration tests, and from 4 to 10 browser tests. Everything from the previous milestone still passes without modification.

Verified by hand on the WebGPU path, since the browser tests only exercise WebGL: pause held the tick steady, step advanced exactly one tick and did not resume, slow motion ran 12 ticks per second against 46 at normal speed, and a 4 second main thread stall advanced about 25 ticks instead of the 240 an unguarded loop would have queued. An accessibility problem found during that pass, an unnamed time scale select, was fixed.

Added `docs/CONTROLS.md`. Updated the architecture, content schema and performance budget docs.

## 2026-08-19, Milestone 00: core architecture and first real frame

- Application state machine in `src/app/appState.ts` covering eight states with a data driven transition graph.
- Engine bootstrap rebuilt as an adapter in `src/engine/engineAdapter.ts`. Picks WebGPU when available and falls back to WebGL, handles resize and context loss, and disposes cleanly.
- Boot scene and a live diagnostics readout showing renderer, version, framerate and draw calls.
- Fixed step simulation clock and seeded RNG.
- Typed content registry with a placeholder Jaeger as its first entry.
- Honest DOM screens for the main menu, loading, the Shatterdome placeholder and errors. The Shatterdome screen says it is not implemented rather than pretending otherwise.
- Tooling: ESLint, Prettier, Vitest and Playwright, with 21 unit and integration tests and 4 browser tests.
- Fixed a real floating point bug in the fixed step clock, where an exact multiple delta such as three sixtieths of a second could lose a step to rounding.

## 2026-08-19, project bootstrap

- Created the specification, roadmap, implementation state, decision log, content registry, testing and changelog documents.
- Scaffolded the Vite, TypeScript and Babylon.js project.
- First engine bootstrap with WebGPU and a WebGL fallback, rendering a placeholder scene.
