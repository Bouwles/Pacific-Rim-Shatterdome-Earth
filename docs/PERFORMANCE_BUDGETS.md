# PERFORMANCE_BUDGETS.md

## Target (from GAME_SPEC.md, not yet enforced in code)

Stable 60 fps @ 1080p on a reasonable gaming PC in ordinary play; 30 fps fallback under extreme
destruction. Low / Medium / High / Cinematic presets are required but do not exist yet — there is
exactly one rendering configuration today (whatever `EngineAdapter`/`buildBootScene` hard-code).

## What's measured today

`DebugOverlay` (src/debug/overlay.ts) shows fps, frame time, draw calls, simulation tick, entity count,
active physics bodies, seed, and run state, backed by Babylon's `SceneInstrumentation`. Physics reads
"n/a (no backend)" until a physics engine is wired — see ARCHITECTURE.md.

Not tracked yet: AI agents, debris, particles, shadow map count, texture memory, streamed sectors, audio
voices. Those budgets are meaningless before the systems that would consume them exist.

## Per-asset budgets (Milestone 02)

Ceilings for a single instance of a production asset, enforced by `src/assets/budgets.ts` and reported by
the Asset Gallery. Exceeding one is a warning, not an error: the asset still loads, it just costs more than
its class allows.

| Class              | Triangles | Materials | Texture memory |
| ------------------ | --------- | --------- | -------------- |
| jaeger             | 150,000   | 8         | 32 MB          |
| kaiju              | 150,000   | 8         | 32 MB          |
| shatterdome-module | 60,000    | 6         | 16 MB          |
| ship               | 20,000    | 4         | 8 MB           |
| building           | 8,000     | 3         | 8 MB           |
| vehicle            | 4,000     | 3         | 4 MB           |
| prop               | 2,000     | 2         | 2 MB           |

Hero units get the largest share because they are on screen constantly and close to camera. Scenery is
tighter because it is instanced heavily, so per-instance cost dominates the frame.

The vehicle material budget was raised from 2 to 3 during this milestone: a road vehicle genuinely needs
body, glass and tyres, and the original figure forced an atlas for no benefit at that size.

### Current placeholder cost

All twelve shipped placeholders sit far below their ceilings, between 12 and 664 triangles each, because
they are box and cylinder primitives. These numbers say nothing about production cost; they only confirm
the measurement and reporting path works.

## Save cost (Milestone 03)

Saves are written to IndexedDB, off the main render path. Observed in the browser
with an empty world: four stored records, including backups and thumbnails, came
to roughly 12 KB against a 10 GB quota.

A save carries authoritative state only, so its size grows with entity count, not
with scene complexity. Thumbnails are 192px wide JPEGs at quality 0.5, roughly
1 KB each, and are rendered through a render target rather than copied from the
canvas.

The storage panel reports live usage and quota, and warns when usage passes 90
percent of quota, when the browser has not granted persistent storage, or when
saves have fallen back to memory.

## Frame pacing guarantees (Milestone 01)

Simulation cost per frame is bounded by construction, independent of how long the tab was suspended:

| Guard                             | Value             | Effect                                                    |
| --------------------------------- | ----------------- | --------------------------------------------------------- |
| `MAX_FRAME_DELTA_MS` (loop.ts)    | 250 ms            | Clamps the delta before it reaches the accumulator        |
| `DEFAULT_MAX_SUBSTEPS` (clock.ts) | 5 ticks           | Caps sub-steps per `advance()`, then clamps the remainder |
| Fixed step                        | 1000/60 ≈ 16.7 ms | Simulation rate, independent of render framerate          |

Worst case is 5 simulation ticks per rendered frame. Simulation time falls behind wall clock rather than
attempting to catch up — measured: a 4-second main-thread stall advanced ~25 ticks instead of the 240 an
unguarded accumulator would have queued.

## Manual baseline observed (2026-08-19, Milestone 00, dev build)

- Scene content: 1 ground plane, 1 box placeholder, 1 directional light, 1 shadow generator (1024 shadow
  map), 1 orbit camera.
- Chromium (Playwright default) + a WebGPU-capable browser both hold steady well above 60 fps at 3 draw
  calls — expected, since there's effectively nothing to render yet. This number carries no predictive
  value for later milestones; it only confirms the pipeline itself imposes no baseline overhead problem.

## Known risk

Production bundle currently ships one >5 MB unminified JS chunk (full Babylon core, no code-splitting).
See TECH_DECISIONS.md — deferred until real feature-module boundaries exist to split along.

## Next action

Define actual Low/Medium/High/Cinematic presets and per-system budgets once there are real systems
(particles, rigid bodies, AI agents, streamed sectors) to budget — no earlier than Phase 4 (world
streaming) per ROADMAP.md, and likely finalized in Phase 9.
