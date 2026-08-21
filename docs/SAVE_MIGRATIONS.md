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
