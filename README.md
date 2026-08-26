# Pacific Rim: Shatterdome Earth

An open world Pacific Rim fan game that runs in the browser. Private personal project, built in TypeScript on Babylon.js.

You run one Shatterdome. You buy and research Jaegers, pick and develop copilots, answer kaiju attacks anywhere on a scaled down Earth, fight, take real damage home, repair it, and keep upgrading favourite machines indefinitely.

## Current state

The project is built in numbered milestones. Everything listed here actually runs today. Nothing below is a mockup.

- Boots into a real 3D scene, WebGPU when the browser supports it, WebGL otherwise, with no gameplay difference between the two
- Application state machine covering Boot, MainMenu, Loading, Shatterdome, Deployment, Combat, Results and Error
- Main menu with a working New Game flow that puts you on the command floor of the Shatterdome, on foot
- Deterministic simulation kernel that runs on a fixed timestep, independent of framerate and of the renderer
- Seeded random number streams, one per subsystem, so runs are reproducible from a single seed
- Versioned, serializable commands and events with validation that fails loudly and early
- Entity system with stable ids, spawn and despawn rules, and a component registry
- Save and load of full simulation state with schema versioning, plus a state hash used to prove determinism
- Debug overlay on F3 showing renderer, framerate, frame time, draw calls, simulation tick, entity count, physics bodies, seed and run state
- Pause, single step, and 0.25x to 2x slow motion from that overlay
- Headless scenario runner that replays a fixed scenario and hashes the result, so any loss of determinism is caught by a test
- Asset pipeline with typed manifests, eight parameterised procedural generators covering Jaegers, kaiju, buildings, vehicles, ships, props and Shatterdome modules, named attachment sockets, and validation of scale, orientation, origin, skeletons, animation clips, textures and per class budgets
- Asset gallery reachable from the main menu, where every placeholder can be rotated, measured, damaged and swapped to a different manifest
- A scaled cube sphere Earth with real latitude and longitude, 1,536 sectors, and a floating origin that keeps the numbers small however far you travel, so nothing jitters
- A globe map you can deploy from, showing where you are, which sector you are in, and which regions are being simulated in detail rather than tracked as records
- A ground view that streams the world in as you move: generated terrain with coastlines, hills and seabed, water, city blocks, roadside traffic markers and landmarks, all built from the world seed so the same seed always gives the same planet
- Sector streaming with levels of detail, mesh reuse, memory budgets and a cache, so flying across the world never stutters and never grows: terrain is generated on a background thread, and what you have already seen is remembered rather than rebuilt
- A stress route you can fly from the panel, and a live readout of everything streaming is doing, from generation time to memory to how many sectors are loaded
- A day and night cycle with a real sun and moon, so the light changes through the day, the seasons change through the year, and Anchorage does not get the same sky as Manila
- Weather that arrives and leaves on its own: clear, cloudy, rain, storms, fog and snow, each rolling into the next rather than snapping, and each drawn from what the local climate can actually produce
- Weather that matters rather than decorates. Fog and darkness cut how far you can see, wet ground is slippery and ice is much worse, wind and rain spoil your aim, and lightning briefly lights the whole world back up
- An ocean you can wade into, stand and fight in chest deep, swim on, and dive under, with waves that move, depth zones that get darker and murkier the further down you go, and sound that loses all its treble the moment you go below the surface
- Low, Medium, High and Cinematic quality settings where every setting is a real budget. Turning quality down removes detail and never removes information: the lightning, the spray and the fog you need to read a fight are drawn at every level
- A Hong Kong you can stand in, grown from a district grammar: towers along the harbour front, a ridge terraced behind them, container docks down the shore, the Shatterdome precinct, and the Bone Slums pressed against its wall. Roads, shipping lanes, air corridors, evacuation muster points, defence positions and a Jaeger deployment corridor down to the water
- A city that reacts. Raise the alert and the sirens go up, the streets empty, the harbour clears, the military fills the roads and people start moving to muster points. Drop it back to recovery and the city comes home
- Traffic, ships, aircraft and crowds drawn as pooled instances on real lanes rather than as thousands of simulated people, so a district of ninety thousand costs the same to run as an empty one
- A Shatterdome you walk around on foot. New Game drops you on the command floor at eye height, with the watch on shift around you and the Marshal reporting how much power is on the board
- Thirteen facilities: command, the Jaeger bay, repair gantries, kaiju research, fabrication, the reactor, logistics, drift training, quarters, defense control, the memorial archive, contracts and launch. Each has a real footprint on a real deck, its own crew, and tiers you build
- Building costs time, construction crews and reactor power, and nothing else is invented. A laboratory can be refused because the reactor cannot carry it, and a third job at once can be refused because there is nobody left to build it. Upgrade the reactor or the stores and the refusal goes away
- Facilities you have not built have no rooms. The doorway that would lead there is sealed and tells you which one is missing. Order it and the scaffolds go up in that room straight away; when the work lands the bulkhead becomes a door you can walk through into a finished space with people working in it
- Rooms are joined by doors, lifts and a tram, each taking its own time, with a short fade at the change. Only the room you are standing in exists, so the hundred and thirty metre Jaeger bay costs nothing while you are in the archive
- Walking, running, crouching, wall sliding and an unstuck key that always puts you somewhere clear. Escape pauses the game properly: construction, the clock and the weather all stop with it
- The whole interior plays without a mouse. Tab cycles what is in the room and turns you to face it, E uses it, the arrow keys look around, and every prompt is read out to a screen reader
- Management happens at terminals you walk up to rather than in a menu. The board shows every facility with its tier, power draw and staff on shift, the next tier with its cost and build time, and an Order button that greys out with the reason it cannot be pressed
- Jaeger berths you can walk up to and inspect, with mass, reactor output, cooling, measured height and which asset it renders from. Board the Conn-Pod from the access gantry and the instruments read the live world outside: local time, weather, wind, visibility and the alert level over the city
- Crew with schedules. A facility's population changes with the hour and the shift, people work at their stations and walk between them, and fifteen named characters hold posts across the complex and tell you real things about their own facility over the radio
- A Jaeger you can actually drive. Take a machine out from the ground view and walk it across Hong Kong: it takes a moment to get going, keeps moving after you let go, turns badly while running and well while standing, and puts a foot down every twenty seven metres
- Three machines that feel different because they are different numbers, not different code. A heavy frame that gathers pace slowly and turns like a building, a light one that does neither
- It steps over wrecked cars, climbs a loading ramp, refuses a cliff face, walks off a shelf and lands hard, wades into the sea, swims, and walks the seabed
- Three cameras: a wide one for looking around, a tight one for fighting, and one inside the Conn-Pod. Switching between them keeps where you were looking, what you had locked, and every setting you changed
- Comfort controls on the pilot panel: a camera motion slider, reduced motion, invert look. Turning the motion off does not turn off the things that tell you how big the machine is
- Scale you can read: street lights going past the ankles, aircraft crossing overhead, footprints left on the ground behind you, dust where a foot landed, and a distant footfall arriving a beat after you see it
- Something to fight. Spawn a test kaiju while piloting, walk into range and throw a jab into a cross into an overhead hammer
- Attacks that are data rather than animation: a wind-up you can be punished during, active frames that reach a certain distance, a recovery you are stuck in, and a cancel window that only opens if the swing actually landed
- A kaiju built out of body zones rather than a health bar. Head, torso, core, two limbs and a tail, each with its own health and armour, one of which ends it and the rest of which cost it something specific
- Aim at a body zone, lock onto a target, cycle between what is on screen, or just swing at whatever you are facing
- Stagger, guard break, launch, knockdown and component shock, and the machine goes through all of them the same way the creature does. A tail sweep knocks you flat and you get up on your own frame's timing
- Guard with F: it eats most of a hit and all of the reaction until it breaks
- A hit log that tells you which fist connected, on which tick, with which part of the creature, for how much, and what it did. Turn on hit debug and the body zones are drawn where the game actually believes they are
- Combos that chain: a jab into a cross into a heavy, with directional variants on the heavy depending on which way you are pushing, and one charged attack that more than doubles its damage if you hold it
- Defence that is worth learning. Hold guard and you take a quarter of it; raise it as the hit lands and you take nothing and they are left open. Time a parry and you get a free counter for it
- A dodge with invulnerable frames in the middle of the step rather than the start, a stamina cost and a recovery, so it answers an attack instead of cancelling everything
- Grapples you both fight over. Take hold and they struggle; hold on and you can throw them, slam them into a building, or keep hitting them. They cannot swing while you have them
- Throws that check the room first. If it would put them through a tower it does not happen, and the game tells you why
- Environmental weapons: a gantry crane, a bridge section, a fuel tanker, a slab of roadway, or a container ship that gets exactly one swing before there is nothing left of it
- Finishers that are a short sequence you stay part of rather than a cutscene you watch. Keep holding through the first half or it lets go, and anything that hits you stops it
- Accessibility settings that cost you nothing: reduced camera motion, hold to complete instead of repeated presses, and skipping the sequence entirely while getting the same result
- A move list written from the game's own move table, with the key you press, a speed in plain words and a line of coaching, plus a running commentary that tells you why the dodge missed or why the throw became a release
- Seven ranged weapons on the number row, and none of them is free. A plasma caster that lands the instant you fire it and leaves the target burning, missiles that leave three at a time, a mortar that arcs, a rotary cannon with ninety rounds in it, an arc whip that puts a line on a creature and holds it there, a chain sword that runs for as long as you hold the key, and a booster charge
- Ammunition that runs out, reloads that take time, and heat and reactor power as the other two things a shot can cost. Hold the chain sword and the machine gets hot, because a sustained weapon pays for itself sixty times a second
- Weapons that tell you why they will not fire: how far past their reach the target is in metres, that the mortar needs a hundred and eighty metres of daylight, that the cannon only fires forward and you are facing the wrong way, that the missiles need a lock, or that the magazine is empty and there is nothing left to load
- Rounds that are real objects with a hard ceiling on how many can exist. Fire more than the game has room for and it says so rather than quietly dropping them, and nothing is left flying once the fight it belongs to is over
- Effects that keep working after the shot lands: burning, shocked, bleeding, corroded and tethered, each doing something specific to what it is on, and fire going out if the thing wades into the sea
- A machine that is a machine rather than a health bar. A Conn-Pod, a sensor mast, a torso, a reactor, two arms and two legs, each with its own armour and its own structure, and damage that lands where it landed
- Losing a part costs you something specific. The right arm goes and the weapons bolted to it go with it, and say so when you pull the trigger. A leg goes and the machine walks and turns slower, and past a point it does not walk home at all. The Conn-Pod or the reactor goes and the sortie is over
- Damage types that mean something. A neural weapon against a Conn-Pod is worth three of the same hit against a leg; a piercing round is worth almost twice as much against a reactor
- Scars that stay on the machine after the fight that made them, and come off the plate when that plate is rebuilt
- Losing does not delete your Jaeger. It comes back: into the gantries if it can still walk, on a transporter if it cannot, or into a full rebuild if it is barely there
- A repair board on every berth in the bay, with every component, what is offline, what it costs in hours and parts, and a shift of work you can put in. The crew takes the worst component first, so you get the legs back before the paint
- A city that comes down around the fight. Trade punches on the waterfront and the waterfront goes: buildings come apart, rubble ends up in the road, fires start, and people end up trapped under it
- Damage that stays. Walk away, come back, load a save from last week: the same blocks are still down. What gets saved is a few numbers per damaged block rather than a copy of the scene, so a levelled Hong Kong costs about five kilobytes
- Rubble you watch land and settle, with a hard ceiling on how much can exist at once. Turn the quality up and there is more of it; turn it down and there is less of it, and the game says so rather than quietly dropping it
- Fires that burn out over hours, contamination that lingers for days, and rescue crews pulling people out of the wreckage while you are somewhere else
- Rebuilding you pay for. Put crews on a block and they clear it before they build on it, worst block first, faster if you have built the logistics and fabrication facilities to back them, slower in a region nobody has secured, and stalled outright if you have not funded it
- Kaiju that decide what to do instead of attacking on a timer. They sense you, weigh up eleven different things they could be doing, pick one, and work out how to get where that takes them
- Creatures that do not sense the truth. They see a cone in front of them, hear all the way round, feel you through the ground, and end up with a guess that gets vaguer the less sure they are. Break line of sight and something is looking for you rather than at you
- Three creatures that fight nothing alike: one walks straight at you and stays, one waits out of sight and then comes at you from the side, and one will not fight you at all if it can help it because it came for the Shatterdome and you are simply in the way
- Bodies that come apart in specific ways. Take the chest plate off before the chest is worth hitting. Burst a throat sac and the acid spit is gone for good. Take a fin and the thing cannot corner any more
- Nine ways of moving, and they matter: a serpent cannot turn on the spot and has to travel to change direction, a digger goes under a blocked road, a crawler goes up the side of a tower, and something colossal simply goes through
- A debug readout that tells you what a creature is thinking: its current goal in plain words, what else it considered and how it scored, everything it has sensed and by which sense, what it did about the road, and what is left of its body
- A war that runs on its own. Attacks arrive when they arrive, in cities you were not watching, and the first you know is a contact on the board with a countdown
- Several emergencies at once, each telling you how long until it comes ashore and how long it takes you to get there, and saying plainly when you cannot make it
- Warnings that admit what they do not know. A strong signal names what is coming; a weak one tells you there are two contacts and it cannot say what they are
- Creatures that arrive carrying things: heavier plate, a sprinter build, acid blood, lungs that let a land animal take the water route, an organ that finds you through a hillside. Each one leaves a tell a good warning can pass on
- The choice to not go. Leave it to the coastal defences and a model works out what happened, then shows you every number behind it: what the creature was worth, what the defences covered, what it cost the city, and what it did to the war
- A game that leaves you alone between fights. Cities go on cooldown, nowhere is hit twice running, and every resolution buys a quiet stretch
- A dial for how much of this you want, from rare to relentless
- Alerts you can answer. Pick one off the board and the game tells you what going would mean: how ready you are, how well your two pilots drift, what state the machine is in, how long the flight takes from where you are, and what the weather will do
- Refusals that stop you and warnings that do not. A machine still in the gantries will not go. A half-repaired one going into a storm with nothing mounted will, and the game says what it thinks of that
- A carrier run that is part of the same session and skippable from the first second, landing you in the world you were already in, in the machine, with your objectives running
- Eight kinds of mission: defend, intercept, pursue, rescue, contain, escort, research and salvage, and crises that come in stages where the next one opens as soon as the last is settled
- Results that add up: damage, the repair hours the bay now owes, what the district lost, salvage, samples, civilians pulled out, reputation, what it did to your pilots, funding, and a replay of the seed and plan you flew. Every line says what produced it
- Five ways for a sortie to end, all explained, including an abort that still credits what you had already done
- A headquarters you build. Fifteen kinds of facility across four decks, from the reactor below the waterline to the containment tanks, each with tiers that cost money to put up and money to keep
- Facilities that do something. An upgraded repair bay repairs faster, a bigger reactor builds quicker, a medical bay gets your pilots back sooner. Every tier says which number it moves
- A construction queue rather than a queue of one. Order what you like, set what matters most, and the crews work down the list
- Priorities that take effect immediately, pausing that keeps your progress and frees the crew, and cancelling that gives back what has not been spent yet
- Honest forecasts. Every project says how far along it is and when it lands counting everything ahead of it, and anything stalled says what it is waiting for
- A complex that works slower when it is short rather than stopping quietly. Half the posts filled at midnight means sixty percent speed, and it says so
- Upgrades you can walk into. Work lights become floodlights, stencils become lit signs, cranes go up, deliveries stack on the floor while the work is on, and crews are actually on site
- Up to three other Jaegers out there with you, each flown by a crew with its own idea of how a fight should go. One closes on everything. One will not come within reach of anything. One goes wherever somebody is about to be hit
- Allies who do sensible things without being told. Nobody needs instructing to attack the thing attacking you
- Nine orders for when you do want a say: focus target, defend area, protect civilians, hold, regroup, ranged pressure, conserve ammunition, disengage, and a synchronized attack that lands with yours
- A quick command on Q and the number row that works mid fight without pausing anything, and hands the number row back to your weapons when you close it
- Orders that get answered out loud, in that crew's own words, so you know they heard
- Orders that change what they want rather than what they do. Tell them to hold a block and they work out what that means from where they are standing
- A few things they will never do whatever you say: shoot through you, spend their heaviest attack twice, or keep firing when you told them to save rounds
- Allies who get hurt like anything else out there, and crews who learn from flying beside you without ever outclassing the machine you are in
- Two pilots in every Conn-Pod, and which two is the decision the rest of the game hangs on. You have no statistics of your own. They have all of them
- Five people who are actually different to fly with. Each is at home in some machines and wrong for others, gets on with some partners and grates on others, and has one thing that makes them difficult
- A drawback each, and the game tells you exactly when it applies, before you commit. One walks a long range machine into knife fights. One flies the damage report instead of the fight when the machine is hurt. One argues at neural speed with anybody careful
- A drift number that shows its working: the machine, the weather, the length of the flight, how well the pair know each other, how tired they are, and what they are carrying, each with what it was worth
- Links that grow from flying together, coming home clean, drift training and talking to somebody off duty. Never from waiting on a menu
- A signature perk each that grows with the link and changes what that person is. One braces the machine before an exchange. One runs the reactor properly. One steps off the line and answers. One knows where the tissue gives
- Injuries that ground people without killing them. Nine days for a concussion, or a torn shoulder that lets them fly but not swing. Treat it in the medical bay, stand somebody down, or send the best substitute available
- Machines that get better by being flown. Thirty levels, earned from sorties and from goals each machine works toward on its own, raising its own numbers rather than a separate score
- Levels that unlock moves as they come: a cross, a forward smash, a parry, an uppercut, a guard break, and a finisher at the top
- Four passive choices on the way up, and every one of them costs something. A reinforced frame takes more punishment and walks slower for good. The cost is on the option before you take it
- A rebuild option if you want those choices back. All of them at once, and the bay wants the hours
- Module slots that open as it climbs, and nine modules to put in them, bought with money and fitted with time. Take one out and it goes to stores, not the bin
- Prestige at the cap, as many times as you like. The level resets, the rank is permanent, and there is no limit
- A prestige ladder that is honest about itself. Rank 1 is worth about five percent, rank 10 about forty, and rank a thousand is worth almost exactly what rank a quadrillion is. The game tells you when a rank has stopped being worth taking
- Everything shown before you commit: what the machine is worth now, what it would be worth after, what it costs, and what it opens next
- Buy a machine late in a campaign and it arrives with veteran crew rather than as a liability
- Kaiju that answer a strong fleet by carrying more, never by being handed bigger health bars
- Money, and something to spend it on. Build the Contracts Office and its terminal becomes a board of machines for sale from four yards, each with its own home, its own speciality, its own idea of a fair price and its own contract terms
- A board that rotates every fortnight and cannot be rerolled. It comes from your world seed, so reloading the page, reloading the save or coming back tomorrow shows you the same offers until the calendar turns
- Previews that tell the truth. Four performance ranges drawn as bands instead of a power score, the tradeoff written out, the upkeep, the wait, and the terms in full. An offer you cannot afford is greyed out and tells you exactly how short you are
- Buying that means something. The money leaves once, the machine arrives weeks later, and until it does you own nothing. It turns up with its own serial, its own name and its own service record, and if it was refurbished it turns up worn and needs the bay before it can go out
- Old machines that stay worth flying. A Mark 1 is less than half the price of a Mark 5, cheaper to keep, slower, shorter ranged, and upgradeable nearly three times as far
- Machines that arrive without money too, through milestone unlocks, research programmes, rebuilt wrecks and archive recoveries
- Upkeep on everything on the pad, charged by the day, whether you are watching the clock or skipping it
- A cockpit that tells you things. Component condition, target zones, ammunition, heat, reactor load, abilities, the squad's standing order, the objective and how the city is doing, on one minimal layer
- Minimal because there is usually little to say, never because anything is kept from you. A critical band sits above everything, never fades and never shrinks, so you can turn the interface right down and still be told the reactor is going
- Eleven instruments reading real systems: heading, speed, depth or altitude, reactor, heat, drift stability, faults, targeting, weather, radio and the whole loadout
- Instruments that move because a system moved. Change one thing and exactly one instrument changes. Nothing loops to look busy
- Severity shown three ways at once: colour, a glyph and a border weight. A tick for nominal, a triangle for caution, an exclamation for warning, a double one for critical, so a reading survives colour blindness and a grey screenshot
- Four colour-vision presets that keep all five severities apart, and a high contrast mode that overrides them when you ask for the strongest separation there is
- Four text sizes, HUD opacity with a floor under it, subtitles, and reduced motion that sets every animation to zero without taking anything off the screen
- Warnings that say what to do rather than only what is wrong. "Torso 9 percent. Another solid hit here takes it out."
- Everything reachable from the keyboard, with a visible focus ring on whatever has it
- Seven cities, and each one is a different place rather than the same place recoloured. Tokyo is capped low by seismic code and packed almost solid. Anchorage is single storey and spread thin under enormous mountains. Manila is a vast low sprawl with a few towers standing out of it. Vladivostok steps up hillsides around a narrow frozen inlet. Lima sits on a desert terrace a hundred metres above the sea
- The difference is real, not a label. 256 blocks and 354 towers in Anchorage against 711 blocks and 3,976 towers in Manila, out of the same generator with nothing bespoke anywhere
- Seven conditions that change how a fight goes: ice, typhoon, dense harbour, volcanic ground, shallow bay, shipping congestion, mountainous approaches. Each one moves footing, gunnery, sight, water depth, clutter, collateral damage and how fast the place rebuilds
- The same creature is a different fight in each place. Twelve metres of slide in Tokyo and twenty in Vladivostok. You hold a contact at 2,880 metres off Lima and 950 in a Manila storm. In Tokyo and Anchorage the water is too shallow to dive, so everything happens on the surface. In Anchorage there is exactly one way in
- Defences that differ. Eight batteries and six interceptor flights six minutes out in Tokyo; three batteries and sixteen minutes over a much longer shore in Manila
- Industry that pays differently. A container port pays more for the same contract, a shipyard returns better salvage, a staging post is worth more for research than for money
- A trade web between places. Wreck one region and the regions that traded with it see their own contract income fall
- Places are described by their geography and their infrastructure only. Never by the people who live in them, and a test enforces it. Everything is a stylised approximation composed procedurally; no commercial map data is used anywhere
- A planet worth crossing. Salvage, landmarks, shipping incidents, military exercises, training gates, research anomalies, rescue calls and environmental hazards, out there to be found
- Nothing scattered evenly. Every kind of site states where it belongs, and the game refuses one that would fit anywhere. A proving gate only exists at a Shatterdome, a research anomaly only somewhere nobody lives, a rescue call only in a city that has been hit, unstable ice only somewhere cold
- Six ways to learn about a place: walking within range, a government contract, your own analysts, an allied government, something a carrier spotted on the way elsewhere, or infrastructure you repaired. Some places only ever turn up on a chart somebody hands you
- A world that stays put. Sites come from your world seed, so the same world always has the same things in the same places, and nothing is generated while you are looking at it
- Nothing pays twice. What you have worked is remembered by name and saved, so walking away and back, crossing a boundary or reloading changes nothing
- Places you reach become places the carrier will drop you. Reach a standing span or a usable pad once and it is on the deployment list from then on
- Travel time you can see, in kilometres and minutes, for everywhere you know about
- A route assist that does not decide for you. Straight there, or by way of everything you know, with both times shown. Direct is always faster and stopping is how you find things
- Thrusters that run hot. A burst costs more heat than a second of cooling gives back, so crossing broken ground in hops is a decision, and the refusal tells you whether it is charge or heat
- One machine you build yourself, at the fabrication hall's own control. Every other Jaeger keeps its identity; this one is yours
- Twelve slots: Conn-Pod, frame, arms, legs, reactor, armour, drive, weapons, abilities, paint, markings and an emblem, plus a name and whatever you want stencilled on the hull
- Parts fit by fitting rather than by name. Sprint legs offer a light spine and nothing else, the deep magazine frame needs a heavy one, and the refusal names both sides
- Nothing collapses into one bar. Mass, where that mass sits, power made against power drawn, heat made against heat shed, tons carried against tons the actuators are rated for, armour, structure, balance, mobility, turn, rounds aboard, hardpoints and module slots are all separate figures on screen at once
- No part is simply better than another. A heavier frame carries three times the ammunition and unbalances the machine, a bigger reactor powers anything and cooks it, and radiator skin sheds enormous heat and stops almost nothing
- Balance is its own axis. A machine can be quick and unstable or slow and planted, and a badly balanced one takes visibly longer to get up after it goes down
- Refusals list everything wrong at once with the numbers behind it, rather than one problem at a time
- Warnings that do not stop you. Eight megawatts of headroom, actuators at their limit, sixty rounds aboard: worth knowing, and your decision
- A test range an illegal build cannot leave the bay to reach
- Blueprints are free. Keep as many as you like, rename them, repaint them, export one as text and import somebody else's. Importing a design never hands you a machine
- Building is not. A campaign holds one custom machine at a time and the only way to get another is to break the one you have. The serial is never reused
- A silhouette that comes from the parts, with every socket a real model would attach to still there for later
- Research that changes how a fight goes. Twenty three programmes across nine branches: weapons, materials, reactor, mobility, sensors, kaiju biology, Shatterdome defense, logistics and exclusive chassis
- Nothing in the tree makes you hit harder. A programme tells you what is coming, blunts something that was hurting you, holds a contact you would have lost, or opens equipment. Finish all of it and you do exactly the damage you always did, and you understand what you are fighting
- Telegraphs you can read. Map the nervous system and the display flags the moment before it commits. Build the behavioural model and it names the move and marks what it is about to threaten. Before either, you read the animation, the way you always have
- Statuses that stop being sentences. Ablative shielding puts the fire out in a fraction of the time and reactive footing keeps the actuators working through a current spike, and nothing is ever made immune to anything
- Sensors that keep hold of a contact. Signature work holds them further out, the thermal array sees through weather, and adaptive sonar means going under is no longer a way to disappear
- Twenty one samples, and what you get depends on how the fight went. Which zone you took apart, what it was carrying, whether you finished it clean or ground it down, whether you took it alive, what killed it, whether it happened in a storm or in the water, and what you were sent there to do
- Grinding stops paying. A kaiju category gives up a sample fully the first time and a fraction of it the tenth, so varying what you go after is the efficient way to play. It never falls to nothing, so a sample you lost can always be replaced
- Nothing you need is behind a lucky drop. Every branch has a road through it built on samples any kill yields. Rare and exotic gate the spectacular, never the way forward
- Two machines nobody sells. The Harmonic frame comes out of materials, weapons and sensor work together. The Leviathan comes out of that plus a recovered core. Neither has a price, because neither has a seller
- Building one takes exactly what the bill says, down to the last hull section, and refuses by name when you are short
- A research board at the wing's own console: every programme with what it needs against what you hold, what it hands over, and the experiment itself while it is running
- An economy with books you can read. Six resources, each earning its place: funding, structural alloy, components, reactor material, kaiju tissue and research data
- Tissue graded rather than weighed. One exotic sample is worth more than a truckload of common, because what makes it valuable is what it came off
- Every credit that moves leaves a line saying what day, what for, where it came from and what the balance was afterwards. There is no other way to change a balance, so the books cannot fall out of step with the money
- Six ways to be paid: government contracts, coastal defence rewards for fights you sat out, salvage rights, exploration finds, manufacturer retainers once a yard rates you, and facility income from a complex that earns while you are not looking
- Pay that follows the fight rather than a table. A bigger city, a worse creature, a later point in the war and a better result all pay more
- Repairs that cost money. A shift in the gantries is billed for the share of the job it covers, itemised into labour, materials, an urgency surcharge if you want it now, and whatever is insured. Alloy already in stores makes it cheaper, a better bay makes it cheaper, and if you cannot pay the machine waits and says so
- A money difficulty that touches money only. Generous, standard and lean change what the war pays you, never how hard a kaiju hits
- Nothing pays twice. Every settled reward carries a reference, so the same result handed back after a retry, a reload or a reconnection changes nothing
- The books on the contracts terminal: what you hold, thirty days of income and spending broken down by source with bars, where the balance is heading, and the last dozen entries in plain words
- Balance proved by simulation rather than assumed. Three hundred and sixty in-game days, four ways of playing, run from your world seed. Flying everything pays best, picking your battles makes steady progress, standing down a lot is worse and still survivable, and an over-extended lean campaign goes into debt and starts putting off repairs
- Offline saves in IndexedDB with named slots, thumbnails, play time, rotating autosaves and backups, export and import, corruption recovery from the last good backup, versioned save migrations, and a storage panel that reports usage and warns when the browser may evict data. Saving works from inside the Shatterdome as well as from the menu, and a build still running when you save is still running when you load

Not built yet: everything else in the list below. The Shatterdome is walkable but everything in it is still boxes, there are no interior models, and the crew have no collision, so you can walk through them. Facility tiers do real work now: an upgraded repair bay genuinely repairs faster and a built-up complex genuinely earns more. They house research now: the labs decide what can be studied and how fast, and the manufacturing floor decides what can be laid down. Boarding the Conn-Pod does not deploy anything and the panel says so. Every land region has a city now, each built to its own profile. Nothing raises an alert on its own yet, so you raise it yourself from the panel, and nothing knocks the city down yet even though it is built in pieces ready for it. The terrain is broad strokes rather than real geography, the buildings are placeholder blocks, and a driven machine has no animation yet, so it moves as one rigid piece rather than swinging its arms, the kaiju attacks on a fixed schedule rather than thinking about it, and a fight itself is not saved, though the damage it did to your machine is. Those arrive milestone by milestone. See ROADMAP.md for the order and IMPLEMENTATION\_STATE.md for exactly where things stand.

### Using your own models

The game ships with no model files and renders entirely from generated placeholders. To install a real one, drop a GLB into `public/assets/models` and point that asset's `source.url` at it in `src/data/assets.ts`. Nothing else changes, because gameplay refers to manifest ids and socket names rather than to meshes. If a file is missing or broken the game logs one warning naming the path and falls back to the placeholder instead of crashing. Open the Asset Gallery to see any model measured against its manifest and its budget. Full details are in `public/assets/models/README.md`.

## What the finished game is meant to be

### The Shatterdome

One heavily upgradeable base you can walk around on foot. The rooms, the walking, the construction and the crew are in, as described above; what follows is where it is going. Command, Jaeger bay, repair gantries, research labs, kaiju containment, manufacturing, reactor and utilities, pilot quarters, training, logistics, defense control, memorial, market, and launch infrastructure. Facilities have visible construction states and real mechanical benefits.

### Jaegers

Bought from rotating manufacturers and contracts, unlocked through milestones, or built from researched parts. One custom Jaeger can be assembled from interchangeable heads, torsos, arms, legs, reactors, armour, movement systems, weapons and abilities, with real tradeoffs in mass, power, cooling and balance, plus your own colours, markings, name and emblem.

Jaegers gain levels, moves, passives and module slots. At the cap they can prestige: level resets, a permanent strength multiplier is added, and a visible prestige rank goes up. There is no cap on prestige. Older Marks stay useful through distinct strengths, upgrades and player skill rather than being replaced.

### Combat

Heavy but responsive. Mass is communicated through anticipation, foot planting, camera impulse, layered sound, debris, water displacement and recovery frames. Responsiveness comes from input buffering, move dependent cancel windows, reliable targeting and immediate defensive inputs.

Light and heavy melee chains, directional variants, launchers, grapples, throws, counters, guarded movement, evasive steps, booster repositioning, finishers, ammunition limited ranged weapons, signature abilities and environmental attacks.

### Damage and repair

Armour and condition are tracked per part: head and Conn-Pod, torso, reactor, both arms, both legs, movement, sensors and each equipped weapon. Damage changes how a Jaeger looks and what it can do. Panels tear off, coolant vents, actuators slow, weapons jam, limbs go dead. Scars stay until repaired. Jaegers are recovered, never deleted.

Cities keep their damage too, through staged building states, structural zones, debris and regional damage records. Rebuilding happens over in game time and responds to funding, facilities, mission results and regional security. Civilian cost is abstracted into rescue pressure and city safety ratings.

### Kaiju

Film kaiju, expanded media creatures, original designs, procedural mutations, named bosses and rare colossal threats. They differ in movement, reach, armour zones, senses, aggression, preferred targets, terrain use, special organs, toxicity and phase behaviour. An attack director picks targets and mutations from world conditions, your habits, the biome, the escalation level and a seed, and can run several emergencies at once without becoming exhausting.

### The world

A continuous scaled Earth streamed in sectors, with floating origin so nothing jitters. Hong Kong and its Shatterdome and Bone Slums, Sydney, Tokyo, Anchorage, Manila and more coastal regions. Only the active region gets combat grade geometry, physics, traffic and AI. Day and night, rain, storms, fog, snow, ocean depth and underwater visibility all affect how things look and play. Long trips use discovered deployment points and carrier drops. Locally you walk, run, wade, swim and boost.

### Copilots

Your avatar has no stats. The copilot carries the build. Each has a personality, link level, Drift compatibility, strengths, drawbacks, signature perks, battle dialogue and a relationship that develops. Strong bonuses always come with a limitation or a playstyle requirement. Copilots can be injured and need recovery, but they never die permanently.

### Allied Jaegers

Build a squad from the machines and copilots you own. AI allies grow their own skills and personalities. In battle you can order focus fire, area defense, civilian protection, hold position, ranged pressure, disengage and synchronised attacks. They stay competent when you leave them alone.

### Economy and research

Money comes from government contracts, city defense rewards, salvage, kaiju tissue, exploration, side activities, manufacturer relationships and some passive facilities. Research unlocks weapons, Jaeger technology, exclusive machines, facilities, defenses and countermeasures. No real money purchases and no mobile game timers. Waiting on work never blocks you from playing.

Both halves are in. The money: six resources, six ways to be paid, a ledger behind every balance, itemised repair bills, upkeep, a difficulty that scales income only, four manufacturers and a rotating contracts board. The research: twenty three programmes across nine branches, twenty one samples earned by how a fight went, countermeasures that inform rather than inflate, and two machines that can only be built.

### Sandbox and crossovers

A separate simulator mode where you can spawn anything unlocked, set location, time and weather, turn off costs, damage and cooldowns, and save custom fights. Optional crossover content includes selected Gundam mobile suits, Evangelion units and Angels, and Attack on Titan Titans, appearing as rare dimensional research events in the main world and freely in the simulator once unlocked. Their scale and power are rebalanced to fit rather than copied across. Pacific Rim progression stays the main game.

### Co-op

Single player is the real game. An optional two player battle only mode lets a second player drop into a fight with their own Jaeger. Progression, saves and campaign authority stay with the host. It is never required to progress. Early versions connect by hand, no account and no server.

## Running it

Needs Node 18 or newer. No accounts, no API keys, no external services.

```
npm install
npm run dev
```

Then open the address it prints, usually http://localhost:5173.

Add `?seed=12345` to the URL to run on a specific seed. The seed decides the whole planet, so the same seed always gives the same coastlines, the same cities and the same storm at the same minute. Press F3 to toggle the debug overlay.

Add `?quality=low` to start on a different quality level. Low, medium, high and cinematic are all accepted, and you can change it from the world panel while the game runs.

### Other commands

```
npm run build         production build
npm run typecheck     strict TypeScript check
npm run lint          ESLint
npm run format        Prettier
npm test              unit and integration tests
npm run smoke         Playwright browser tests
```

## Layout

```
src/simulation   fixed step clock, loop, kernel, commands, events, seeded RNG, state hashing
src/entities     entity ids, lifecycle, components
src/assets       asset manifests, procedural generators, model validation, resolver
src/world        globe coordinates, sectors, floating origin, regions, terrain, streaming, clock, weather, ocean, city
src/workers      terrain generation off the main thread
src/saves        save schema, migrations, IndexedDB storage, backups and recovery
src/engine       Babylon engine selection and the boot scene
src/app          bootstrap, application state machine, config
src/debug        developer overlay, asset gallery, deterministic scenario runner
src/data         typed content registries and asset manifests
src/ui           menus and screens
public/assets    drop point for your own models, empty by design
tests            unit, integration and browser tests
docs             architecture, content schema, controls, world coordinates, save migrations, performance budgets
```

### Saves

Saves live in your browser, in IndexedDB, and nothing is uploaded anywhere. Open Saves from the main menu to write a slot, load one, rename, overwrite, delete, or export a slot to a file you can keep or move to another machine. Importing checks and upgrades a file before it becomes a slot, so a broken file can never overwrite a good save.

Each write keeps the previous contents as a backup. If a save is ever damaged, it stays in the list marked as damaged, and loading it falls back to the last good backup rather than failing.

If the browser will not allow storage, which private windows usually will not, the game still runs and the panel says plainly that saves will not survive the tab.

Design and planning documents live at the root: GAME\_SPEC.md is the binding specification, ROADMAP.md is the milestone order, IMPLEMENTATION\_STATE.md is the honest current status, TECH\_DECISIONS.md records why things were done a certain way, CONTENT\_REGISTRY.md tracks content, TESTING.md covers verification, and CHANGELOG.md logs changes.

## Assets and legal

This is a private fan project with no affiliation to Legendary Pictures, Warner Bros. or anyone else who owns Pacific Rim. It ships no film audio, no ripped models and no paid or leaked assets. Everything in the repository is original or procedurally generated placeholder work, sitting in clearly named slots so real models, textures, animations, portraits, sound and music can be dropped in later. Nothing here is claimed to be screen accurate.
