# Pacific Rim: Shatterdome Earth — 1.0.0-rc.1

First release candidate. Thirty-five milestones, one complete loop: boot, build a complex, take a machine out, fight, come home damaged, repair, research, grow, and keep the save. A private fan project with no affiliation to anybody who owns Pacific Rim; everything in it is original or procedurally generated placeholder work.

## What the candidate is

The whole core loop works end to end from an empty browser profile, and an automated test walks it in one continuous session: boot, new campaign, a facility ordered and paid for, a manual save, a sortie from alert to carrier to combat, damage taken and billed, results explained line by line, the save intact afterwards, an export downloaded, and the simulator provably walled off from all of it.

The simulation is deterministic and its most important flows are pinned as golden hashes: the kernel, a year of economy under four strategies, a two-player battle, a sandbox run, the soundscape journey and three stress scenes. A change to any of them is a failed test naming the system that moved.

## Save compatibility promise

Saves are versioned documents in IndexedDB, currently version 17, with a migration chain from every version ever written, including the bare version 0 snapshot from the first milestone. The promise:

- Every save this candidate writes will load in every future build, migrated step by step, or fail loudly with the reason. No future build silently discards a slot.
- A file newer than the build refuses to load and says which of the two to update.
- Content renamed or removed is dropped on load with the honest default, never resurrected and never a refusal to open.
- Every write keeps the previous contents as a backup, and a damaged slot falls back to the last good backup rather than failing.
- Nothing in the sandbox, the settings stores or the service worker can touch a save.

## Performance evidence

Dense city stress scene, 180 frames per preset, production build, WebGPU, seed 20260911, on the reference development machine (mid-range discrete GPU):

| Preset    | p95 frame | Worst | Long frames | Draw calls | Breaches |
| --------- | --------- | ----- | ----------- | ---------- | -------- |
| Low       | 1.1 ms    | 1.5   | 0           | 34         | none     |
| Medium    | 0.3 ms    | 0.6   | 0           | 76         | none     |
| High      | 0.8 ms    | 1.2   | 0           | 97         | none     |
| Cinematic | 1.8 ms    | 2.0   | 0           | 97         | none     |

Headless stress runs deterministic in the suite: four combatants (192 events), a projectile barrage holding the pool at capacity (2,129 events, never over), maximum destruction (246 events). Three combat entry and exit cycles in a live browser diff to zero across eight resource classes. Known limit: triangle and memory budgets are stated but not yet measured in the report; a breach there is only findable in the browser's own profiler.

## Content completeness

| Area      | State                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------- |
| Core loop | Complete: alert, deploy, fight, damage, results, repair, research, progression                 |
| World     | 8 regions, 7 with full procedural cities and distinct identities, seeded sites and exploration |
| Combat    | Melee, ranged, grapples, finishers, statuses, countermeasures, squads, creature AI             |
| Machines  | 5 chassis, levels, passives, modules, uncapped prestige, custom builder (1 per campaign)       |
| Creatures | 4 categories with mutations; more variety is content work, not systems work                    |
| People    | Pilots, copilots, drift, injury, allied crews with learning                                    |
| Economy   | 6 resources, ledger, contracts, salvage, repair bills, difficulty levels                       |
| Sound     | Buses, adaptive score, radio with saved transcript, synthesised placeholders throughout        |
| Modes     | Campaign, simulator sandbox, same-machine two-player, manual-signal direct co-op               |
| Platform  | Installable PWA, offline after one load, safe updates, optional packs                          |
| Art       | Deliberately placeholder: boxes and procedural texture in clearly named slots for real assets  |

## Known issues

- Berths, the pilot picker and the world panel list chassis rather than owned machines; a machine bought mid-campaign has a full service record but no berth of its own to be inspected at.
- Allied machines fight but have no visible mesh beside you.
- The co-op guest window is a readout, not a rendered view, and WebRTC between two physically separate machines is implemented but has never been exercised across a real network.
- The sandbox validates waves, mutations, city damage presets and water states that the running fight does not apply yet.
- Facility module slots exist and count, but nothing can be fitted into them.
- One pre-existing browser test in the builder suite times out on its construction wait and blocks three tests behind it; tracked since Milestone 29, not a regression.
- Chromium-family verification only; no Firefox or Safari pass yet.
- Real models, textures, animations and recordings are absent by design. Every slot is named and waiting.

## Next phase

1. Owned machines through the whole interface: berths, picker and world panel reading `roster.all()`.
2. Render the co-op guest's view, and verify WebRTC across two real machines.
3. Apply the rest of a sandbox scenario: wave scheduler, mutation stacking, destruction preset, water state.
4. Facility modules, and the sortie-to-standing link the market already reads for.
5. Measure the stated triangle and memory budgets; stage the browser stress scenes from inside the runner.
6. Content expansion on the systems that are finished: more creatures, more chassis, more regions.
