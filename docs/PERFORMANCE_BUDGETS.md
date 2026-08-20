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
