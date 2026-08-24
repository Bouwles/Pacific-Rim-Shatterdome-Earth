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

- `ROOT_SAVE_VERSION = 2`
- `SIM_SCHEMA_VERSION = 1`
- `WORLD_SCHEMA_VERSION = 1`

## Version history

| Version | Shape                                                           | Notes                                                                                                                                                                                                                                                    |
| ------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0       | A bare `SimSnapshot`: `{ schemaVersion, seed, tick, entities }` | Not a format any released build wrote. It is what `SimulationKernel.serialize()` returns on its own, which was the only save-like artifact that existed before Milestone 03. Treated as version 0 so a raw snapshot can be imported instead of rejected. |
| 1       | `{ schemaVersion, savedAt, metadata, sim }`                     | Adds the envelope: name, world seed, play time, last played, sim tick, app version, thumbnail.                                                                                                                                                           |
| 2       | `{ schemaVersion, savedAt, metadata, sim, world }`              | Adds the world section from Milestone 04: player position on the globe, active sector, active region, and a strategic record per region.                                                                                                                 |

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

## Milestone 12 saves nothing new

`ROOT_SAVE_VERSION` stays at 5. Magazines, spare rounds, heat, cooldowns, rounds
in the air and running status effects are all live state belonging to the fight
they happened in, and a fight is not saved. Damage that outlives a battle is the
subject of the next milestone, and that is what will move the version.
