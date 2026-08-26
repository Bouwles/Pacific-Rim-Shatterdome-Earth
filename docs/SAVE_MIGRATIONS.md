# SAVE_MIGRATIONS.md

How save files are versioned, upgraded, and protected. Read with
[CONTENT_SCHEMA.md](CONTENT_SCHEMA.md) for the field-level shapes.

## Two independent versions

| Constant               | Where                      | Covers                                  |
| ---------------------- | -------------------------- | --------------------------------------- |
| `ROOT_SAVE_VERSION`    | `src/saves/schema.ts`      | The save envelope: metadata and wrapper |
| `SIM_SCHEMA_VERSION`   | `src/simulation/kernel.ts` | The simulation snapshot inside it       |
| `WORLD_SCHEMA_VERSION` | `src/world/worldState.ts`  | The world section inside it             |

They move independently so a metadata change does not force a simulation
migration, or the reverse.

## Current versions

- `ROOT_SAVE_VERSION = 16`
- `SIM_SCHEMA_VERSION = 1`
- `WORLD_SCHEMA_VERSION = 4`
- `MARKET_SCHEMA_VERSION = 1`
- `CREW_SCHEMA_VERSION = 1`
- `SQUAD_SCHEMA_VERSION = 1`

## Version history

| Version | Shape                                                           | Notes                                                                                                                                                                                                                                                    |
| ------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0       | A bare `SimSnapshot`: `{ schemaVersion, seed, tick, entities }` | Not a format any released build wrote. It is what `SimulationKernel.serialize()` returns on its own, which was the only save-like artifact that existed before Milestone 03. Treated as version 0 so a raw snapshot can be imported instead of rejected. |
| 1       | `{ schemaVersion, savedAt, metadata, sim }`                     | Adds the envelope: name, world seed, play time, last played, sim tick, app version, thumbnail.                                                                                                                                                           |
| 2       | `{ schemaVersion, savedAt, metadata, sim, world }`              | Adds the world section from Milestone 04: player position on the globe, active sector, active region, and a strategic record per region.                                                                                                                 |
| 3       | Adds the environment to the world section                       | Clock, weather and sea state, so the sky a save was written under is the sky it comes back to.                                                                                                                                                           |
| 4       | Adds region alert levels                                        | What each region was doing when the file was written, and how far its evacuation had got.                                                                                                                                                                |
| 5       | Adds the `shatterdome` section                                  | Facility records, construction in progress, and where the player was standing inside the complex.                                                                                                                                                        |
| 6       | Adds the `roster` section                                       | One record per machine: status, work owed, sorties survived, and a per-component damage snapshot with scars.                                                                                                                                             |
| 7       | Adds regional destruction to the world section                  | Which building groups a city has lost and how far it has been rebuilt, held per region rather than per block.                                                                                                                                            |
| 8       | Adds the `director` section                                     | Escalation, breach pressure, per-region threat and cooldown, and every live incident.                                                                                                                                                                    |
| 9       | Adds the `mission` section                                      | The sortie in progress, or null when nobody is out.                                                                                                                                                                                                      |
| 10      | Adds the `market` section                                       | Money, salvage, research samples, standing with each yard, which offers have been signed, what is on order, and where the rotation is.                                                                                                                   |
| 11      | Adds the `crew` section                                         | Per pilot: status, stress, injuries carried, the link tracks built with everybody they have flown with, and the ids of sorties already paid out.                                                                                                         |
| 12      | Adds the `squad` section                                        | Per allied crew: the machine they fly, sorties flown beside the player, confidence, standing order, perks learned, and the sorties already settled.                                                                                                      |
| 13      | Adds the `economy` section                                      | Every resource held, the difficulty the campaign is being run at, and the ledger behind each balance, including the references that stop a settled reward being paid twice.                                                                              |
| 14      | Adds the `research` section                                     | Programmes finished, experiments in the labs with the work already put into them, the samples on the shelf, and how familiar each kaiju category has become with giving each one up.                                                                     |
| 15      | Adds the `library` section                                      | Saved blueprints, the one custom machine a campaign may hold, the serial counter that never goes backwards, and whether the library is a sandbox one.                                                                                                    |
| 16      | Adds the `exploration` section                                  | Which sites have been found and how each was found, and which have already been worked. The sites themselves are placed from the world seed rather than stored.                                                                                          |

## Detection

`detectSaveVersion` distinguishes the two by shape, not by guessing: a document
with `entities` and `seed` but no `sim` is a bare snapshot and reports version 0.
Anything else must carry a usable integer `schemaVersion`.

## Adding a migration

1. Write a step in `src/saves/migrations.ts`:

```ts
const myStep: MigrationStep = {
  id: "1", // must equal fromVersion
  fromVersion: 1,
  toVersion: 2, // must be fromVersion + 1
  description: "What this changes and why.",
  apply: (document) => ({ ...document, schemaVersion: 2 /* transform here */ }),
};
```

2. Register it in `createMigrationRegistry`.
3. Raise `ROOT_SAVE_VERSION` to the new version.
4. Add a fixture for the old version under `tests/fixtures/saves/` and a test that
   loads it and asserts no required field was lost.

The registry rejects a step whose `id` does not equal its `fromVersion`, or whose
`toVersion` is not exactly one higher, so the chain cannot develop gaps or
ambiguity.

## Rules migrations must follow

- **Pure.** No clock, no storage, no randomness. Same input always gives the same
  output, and the input document is never mutated.
- **One version per step.** The runner walks the chain one version at a time.
- **Refuse rather than guess.** A missing step throws instead of loading partial
  data. A file newer than `ROOT_SAVE_VERSION` is rejected with a message telling
  the player to update the game.
- **Derive, do not invent.** Where an old format never recorded a value, leave it
  unknown. Version 0 has no wall clock time, so `savedAt` and `lastPlayedAt`
  become `0`, and play time is derived from the tick count, which the snapshot
  really does carry.

### Version 1 to 2

A version 1 save predates global coordinates entirely, so no player position is
recorded anywhere in it. The migration seeds the documented default start
(`src/world/start.ts`, the Hong Kong Shatterdome) rather than inventing a
position, and writes an empty region list. `WorldState.restore` then seeds a
fresh record for every region the current build knows about, so an old save gains
newly added regions instead of carrying a stale list.

## Backups and recovery

Every write to a slot first rolls the existing contents into that slot's backup
ring (`backup.<slotId>.<n>`, two deep by default). This doubles as the
pre-migration backup: an old-version file is preserved untouched before anything
upgrades it.

`SaveService.load` validates the primary record, and on any failure walks the
backups newest first. Failure means any of: unreadable bytes, a migration that
throws, a document that fails validation, or a checksum that no longer matches
the stored document.

A damaged slot stays visible in the slot list, described from the backup that
would be loaded and flagged `damaged`. Hiding it would make recovery unreachable
from the UI in exactly the case recovery exists for.

## Integrity

Each record stores a `checksum` produced by `hashState`, the same digest used for
simulation determinism. It catches tampering that leaves a document structurally
valid. The checksum is only enforced for a save still in the version it was
written in: a migrated document legitimately no longer matches its stored digest.

## What is never saved

Authoritative simulation state only. Meshes, materials, cameras, physics bodies,
asset resolution results and UI state are all rebuilt on load. `validateRootSave`
runs the document through `hashState`, which throws on functions, `undefined` and
cycles, so a non-serializable value cannot reach storage.

## Milestone 05: no migration, deliberately

Sector streaming added no authoritative state, so the save format did not change
and `ROOT_SAVE_VERSION` stays at 2.

Terrain is a pure function of `(world seed, sector id, level of detail)`. The seed
is already stored in `sim.seed`, so a loaded save regenerates byte-identical
terrain without any of it being written to disk. Two streamers built from the
same seed are asserted to produce the same content digest for every sector, and
different seeds are asserted to differ.

Writing generated terrain into a save would have made saves grow without bound
with distance travelled, and would have frozen worlds against future changes to
the generator. Recording the seed and regenerating is both smaller and more
durable.

## Milestone 06: version 3 adds the environment

`ROOT_SAVE_VERSION` is now 3 and `WORLD_SCHEMA_VERSION` is 2. The world section
gained an `environment` block holding the world clock and the weather.

A version 2 save has no clock and no weather, because the world it recorded had
no time of day at all. The migration therefore does not convert anything: it
seeds the same fresh environment a new world begins with, shortly after sunrise
on day zero with dry ground. That is honest about information that was never
captured, rather than fabricating a plausible-looking history for it. Position,
sector and every region record survive exactly as written.

`emptyEnvironmentSnapshot()` is the single definition of that starting state, and
both the migration and a save written before any world existed use it. A new
session uses the same constant through `DEFAULT_START_TICKS`. All three had to
agree: when they did not, a new session started at tick zero, which is midnight,
and the world opened in total darkness while a migrated save opened at dawn.

Only wetness is stored from the weather. Everything else is a function of the
world seed and the tick, so a loaded save regenerates the same fronts, the same
storm at the same minute, and the same sky.

## Milestone 07: version 4 adds region alerts

`ROOT_SAVE_VERSION` is now 4 and `WORLD_SCHEMA_VERSION` is 3. Every region record
gained an `alert` block holding the alert level, the tick it was entered, and how
far the evacuation has progressed.

A version 3 save has no alert anywhere, because no region could be alerted. Every
record therefore migrates to calm with nobody evacuated, which is exactly the
state a fresh world begins in and the only honest reading of a file that never
recorded one. Integrity, safety rating, tier and last visited tick all survive
untouched.

The city layout itself is not saved and never will be. It is a pure function of
the region and the world seed, so it is cached in memory and rebuilt on demand.
Saving it would make save size grow with how much of the world had been visited
and would freeze old saves against future changes to the district grammar.

One thing worth recording about the chain: each migration writes the world schema
version as it stood at that step, not the current constant. Writing today's number
into an older step would make a migrated file claim a shape it does not have, and
the next step in the chain would have nothing to recognise.

## Milestone 08: version 5 adds the Shatterdome

`ROOT_SAVE_VERSION` is now 5 and the envelope gained a `shatterdome` section
alongside `sim` and `world`. It carries every facility record, the player's
position inside the complex, and which machine they had selected.

A version 4 save has no facilities recorded because there was no interior to
record: the Shatterdome was a screen that said it was not implemented. Every such
file therefore comes back with the complex a new campaign starts with, standing
on the command floor. That is the only honest reading of a file that never
captured one, and it is the same state `emptyShatterdomeSnapshot` produces for a
save written before the player has been inside. Nothing else in the document is
touched: the world, the environment and every region alert survive as written.

The interior layout itself is not saved and never will be. Rooms are a pure
function of the facility records and the world seed, so they are laid out again
on load. Saving them would freeze old saves against future changes to the
facility grammar.

One rule the location field enforces: a saved `roomId` is validated against the
rooms this build knows about rather than trusted, and the session falls back to a
room that exists rather than throwing the player into nowhere.

## Milestone 22 does not move the version

`ROOT_SAVE_VERSION` stays at 12. The construction queue rides inside the
`shatterdome` section that already exists, because what is being built is a fact
about the complex rather than a separate subject. Adding a field to a section is
not a new shape, so a version 12 save written before this milestone still
validates and still loads.

What such a file gets is an empty queue, which is the honest reading of a save
from a build where an order either finished the moment it was placed or was never
placed at all.

Two rules the restore enforces rather than trusts. A project naming a facility
this build no longer has is dropped. And a project that was active comes back
queued, holding no crews: it is given crews again on the first tick after
loading, so nothing is mid-tick across a save.

## Version 15 to 16: exploration (Milestone 26)

Version 16 adds an `exploration` section: which sites have been found, how each
was found, and which have already been worked.

A version 15 save has neither, because there was nothing out there. It comes
back having found nothing and worked nothing, which is the honest reading of a
file written before the world had anything in it.

The sites themselves are deliberately **not** stored. They are placed from the
world seed every time the game starts, so an old save gets exactly the world a
new one would, and only what the player did with it has to survive. That is what
lets sites be added, removed or rebalanced without a migration.

Two rules the restore enforces rather than trusts. A discovery naming a site
this build no longer places is dropped, because there is nothing left to have
found. A **claim** is kept whether or not the site still exists: dropping it
would turn a content change into free money the next time something similar was
placed, and a claim is a record of what the player did rather than a property of
the world.

## Version 14 to 15: the builder (Milestone 25)

Version 15 adds a `library` section: saved blueprints, the record of the one
custom machine a campaign is allowed to have standing, the serial counter, and
whether this library is a sandbox one.

A version 14 save has none of it, because there was no builder. It comes back
with an empty library rather than a starter design: handing every existing
campaign a blueprint it did not draw would be putting words in the player's
mouth, and the builder offers a starting point of its own when it is opened.

Three rules the restore enforces rather than trusts. A blueprint naming a part
this build no longer has keeps the design and drops the part, because the design
is the player's work and losing all of it because one part was retired would be
worse than showing them a build that now needs a new arm; it simply fails
validation and says so. A built record whose blueprint is gone is dropped, since
there is nothing left to have built it from. And the serial counter only ever
goes up, so scrapping and rebuilding across a save produces a different machine
rather than the same one back.

The custom chassis definition itself is never stored. It is derived from the
blueprint every time, so rebalancing a part reaches an old save immediately
rather than leaving it flying the numbers it was saved with.

## Version 13 to 14: research (Milestone 24)

Version 14 adds a `research` section: the programmes finished, the experiments
in the labs with the work already put into them, the samples on the shelf, and
how familiar each kaiju category has become with giving each sample up.

A version 13 save has none of that, because there was nothing to research and
samples were a single unnamed count on the market. That count is deliberately
not carried across. A number of "research samples" cannot honestly become a
named cranial section or an intact organ, and deciding which ones it was would
be inventing a history the file never had. It stays where it is, as research
data, which is what the economy already spends it as.

Three rules the restore enforces rather than trusts. A completed node this build
no longer ships is dropped, so removing content cannot strand a save. A running
experiment comes back queued holding no researchers, and is given them again on
the first tick, so nothing is mid-tick across a save; the work already put in is
kept. And a sample naming something this build does not have is dropped rather
than resurrected.

Benefits are never stored. They are recomputed from the completed list every
time, so rebalancing what a programme hands over reaches an old save
immediately rather than leaving it carrying the numbers it was saved with.

## Version 12 to 13: the economy (Milestone 23)

Version 13 adds an `economy` section: every resource the programme holds, the
difficulty it is being run at, and the ledger of how each balance got where it
is, including the references that make a settled reward unrepeatable.

A version 12 save carried funding, salvage and research samples inside the
market section. Those are read across rather than thrown away: funding stays
funding, salvage tons become structural alloy, and research samples become
research data. Components, reactor material and tissue start at zero, because a
file from a build with no such resources cannot honestly claim any.

What such a file cannot have is a history. The ledger starts empty, and the
first line written after loading is the first line there has ever been. That is
deliberate: inventing entries for spending nobody recorded would make the books
say something untrue about what happened.

Two rules the restore enforces rather than trusts. A ledger line naming a
resource or a source this build does not have is dropped rather than
resurrected, so removing a source cannot make an old file unloadable. And the
settled references come back with the ledger, because a reward already paid has
to stay paid across a reload: that is the whole point of them.

## Version 11 to 12: the allied crews (Milestone 21)

Version 12 adds a `squad` section: one record per allied crew carrying the
machine they fly, how many sorties they have flown beside the player, the
confidence that has moved with those results, their standing order, the perks
they have learned, and the ids of sorties already settled.

A version 11 save has none of that, because allies were a field on a deployment
plan that was always empty. Every such file comes back with crews who are
unassigned, at their authored confidence, on the default order, and who have
learned nothing.

Three rules the restore enforces rather than trusts. Perks are recomputed from
the sorties that earned them, so an edited list does not survive. An order this
build no longer ships falls back to the default. And neither the target nor the
place a standing order pointed at is saved at all, because both belong to a
fight, and a fight is not saved.

## Version 10 to 11: the people (Milestone 20)

Version 11 adds a `crew` section: one record per pilot carrying their status,
recent stress, the injuries they are carrying with days left on each, one link
track per person they have flown with, and the ids of sorties already paid out.

A version 10 save has none of that, because pilots were a table to be read rather
than people with a history. Every such file comes back with a crew who are all
fit, unstressed and strangers to each other, which is the only honest reading of
a file that never recorded otherwise.

The settled-mission list starts empty on migration. That is safe because it only
ever prevents double payment, and a file written before this existed has no
mission result waiting to be applied.

Four rules the restore enforces rather than trusts. A link level is recomputed
from the experience that earned it, so an edited level does not survive. An
injury this build no longer ships is dropped rather than resurrected. A link to
somebody who is not on the roster any more is forgotten. And nobody comes back
mid-sortie: a pilot saved as deployed loads as ready, because a fight is not
saved.

## Milestone 19 does not move the version

`ROOT_SAVE_VERSION` stays at 10. Progression is carried inside the roster section
that already exists: every machine gains a level, an experience total, a prestige
rank, its chosen passives, its fitted and stored modules, its mastery counters
and the ranks already paid out. Adding fields to a section is not a new shape, so
a version 10 save written before this milestone still validates and still loads.

What a save written before it gets is the honest reading of a file that never
recorded any: level one, nothing banked, no rank, no passives, no modules and
empty counters.

Three rules the restore enforces rather than trusts. The level is recomputed from
the experience that earned it rather than read from the file, so an edited level
does not survive. A passive or module id this build no longer ships is dropped
rather than resurrected. And a mastery rank is only honoured for a goal that
still exists.

## Version 9 to 10: the market (Milestone 18)

Version 10 adds a `market` section: funding, salvage and research samples, one
standing figure per manufacturer, the ids of every offer already signed, the
machines on order with the days left on each, and how far the calendar has moved
through the current rotation.

The board itself is not saved, and that is the point. Offers are derived from the
rotation number and the world seed, so writing them down would create two sources
of truth and a way to edit the board by editing a file. What is saved is the
rotation the campaign has reached and which offers have been taken, which is
enough to rebuild exactly the same board on load. This is also why reloading the
page cannot reroll it: nothing is rolled at load time.

A version 9 save has no economy at all, so the migration writes an empty market:
the campaign's starting funding, base standing with every yard, nothing on order,
rotation zero. That is the honest reading of a file written before money existed.

Two rules the restore enforces rather than trusts. A pending delivery naming a
chassis or a manufacturer this build has never heard of is dropped rather than
resurrected. Standing is clamped to 0 to 1 on the way in, so an edited file
cannot buy a machine at a negative price.

## Version 8 to 9: the sortie in progress (Milestone 17)

Version 9 adds a `mission` section carrying the sortie in progress, or `null`
when nobody is out, which is the normal case. A mission snapshot holds its
phase, the plan it was flown with, its objectives and their states, the carrier
clock, the mission clock, its seed and its results if it has any.

A version 8 save cannot have had a sortie in progress, because deployment did
not exist as a lifecycle: there was no way to be out. The migration therefore
sets the section to `null`. Nothing else in the document is touched.

On restore, an objective naming something this build no longer has is dropped,
and a phase this build does not recognise falls back to planning rather than
throwing.

## Version 7 to 8: the attack director (Milestone 16)

Version 8 adds a `director` section: global escalation, breach pressure, the
player's crisis frequency, the roll and recovery clocks, a threat record per
region, and every incident that has not been pruned.

A version 7 save has no war in it at all, because attacks were not yet a
strategic system: nothing was scheduled, nothing was escalating, and no region
had a threat rating. The migration therefore gives every such file the
campaign's opening state. Nothing else in the document is touched.

On restore, an incident or a region record naming somewhere this build no longer
has is dropped rather than resurrected, and the crisis frequency is clamped back
into its allowed range rather than trusted.

## Milestone 15 saves nothing new

`ROOT_SAVE_VERSION` stays at 7. Everything the kaiju framework owns is live
state belonging to one fight: what a creature has sensed, what it currently
wants, how frustrated it is, which armour plates are off, which organs are gone
and which limbs have been severed. A fight is not saved, so none of it is.

What a creature **is** - its body, family, senses, weights, organs and phases -
is content in the registry rather than state, so it comes from the build and
never from a file.

## Version 6 to 7: regional damage (Milestone 14)

Version 7 adds a `damage` snapshot to every region record, and moves the world
section to schema version 4.

The snapshot is deliberately small: seven numbers for each block that has been
touched, a state for each named landmark that is not intact, and any clearing or
rebuilding project still running. Untouched blocks are not written at all, so an
undamaged city carries three empty arrays and a levelled one carries a few
kilobytes. **No scene graph, no debris transform and no per-building record is
ever saved**; rubble is a pooled runtime object and the city view rebuilds the
look of a block from its state.

A version 6 save has no record of what any fight did to a city, because damage
did not survive one: the streets came back whole the moment you left. The
migration therefore gives every region an undamaged snapshot with nothing being
rebuilt. Nothing else in the document is touched.

On load, a block or landmark naming something this build no longer has is
dropped rather than resurrected, and anything the file never mentioned comes
back untouched.

## Version 5 to 6: the roster (Milestone 13)

Version 6 adds a `roster` section: one record per machine carrying its status,
the hours of work it owes, how many sorties it has come home from, and a damage
snapshot.

The damage snapshot is deliberately small. One fraction per component and the
scar list, where a scar is four numbers: which component, how bad, what kind of
damage made it, and a seed. Debris is grown from the seed by the view, so no
transform is ever written to a save.

A version 5 save has no damage recorded anywhere, because damage did not survive
a fight: a Jaeger was one health bar that reset when the fight ended. The
migration therefore gives every machine a full, unmarked record with no
outstanding work, which is the only honest reading of a file that never captured
any. Nothing else in the document is touched.

Two rules the restore enforces rather than trusts. Maximum health comes from the
machine's own definition in this build rather than from the file, so rebalancing
a chassis does not leave an old save carrying the old numbers. A component or a
scar naming something this build has never heard of is dropped rather than
resurrected, and a machine recorded as deployed comes back ready, because a
sortie is not saved.

## Milestone 12 saves nothing new

`ROOT_SAVE_VERSION` stays at 5. Magazines, spare rounds, heat, cooldowns, rounds
in the air and running status effects are all live state belonging to the fight
they happened in, and a fight is not saved. Damage that outlives a battle is the
subject of the next milestone, and that is what will move the version.

## Version 16 to 17: the radio (Milestone 29)

Version 17 adds a `radio` section: the conversation record, and the cooldown
clock for every line that has been said.

The record is one entry per line: which line, who said it, the text itself, the
priority, the second it happened on, and whether it was spoken, interrupted or
dropped. It is authoritative because it is readable. A player who spent a sortie
being shot at can open the record afterwards and find out what LOCCENT was
shouting, which is not something that can be recomputed from anything else.

It is bounded at two hundred entries, oldest first. A campaign that runs for
weeks does not accumulate an unbounded log inside its own save file.

The cooldown clocks are saved with it, and that is deliberate. Without them,
loading a save would put every line in the game back off cooldown at once, and
the first frame after a load would fire a breach warning, a reactor warning and
a funding warning together.

A version 16 save has neither, because nobody was talking yet. It comes back
with an empty record and no cooldowns, which is the honest reading of a file
written before there was a radio: the campaign genuinely has no history of
anything being said, and every line genuinely has never been heard.

On load, a record naming a line this build no longer has is skipped rather than
resurrected or refused. Renaming a line is a content change, and a content
change must not stop an old campaign from opening.

Volumes are deliberately **not** in the save. How loud somebody wants the music
is a property of the person and the room they are in, not of a campaign, so the
mixing desk lives in `localStorage` beside the display settings. Loading an old
save must not reset it and starting a new campaign must not lose it.
