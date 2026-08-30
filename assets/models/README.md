# Model drop point

Production GLB and glTF files go here. Nothing in this folder is required: every asset in the game has a procedural placeholder and stays fully playable with this folder empty.

## Installing a model

1. Put the file here, for example `public/assets/models/jaeger.placeholder-mk0.glb`.
2. In `src/data/assets.ts`, set that asset's `source.url` to `/assets/models/jaeger.placeholder-mk0.glb`.

No other code changes. Gameplay never refers to a mesh directly, only to manifest ids and named sockets, so swapping a model cannot change unit statistics or combat behaviour.

If the file is missing or fails to load, the game logs one warning naming the expected path and falls back to the placeholder rather than crashing.

## What the validator checks

Load the asset in the Asset Gallery (main menu, then Asset Gallery) to see it measured against these rules:

- Height matches the manifest's `nominalHeightMeters` within 10 percent, so the model must be authored in metres
- Model faces +Z
- Origin sits at the base centre, within 5 cm, so ground placement needs no per-asset offset
- Every socket with a `nodeName` exists in the model
- Every animation tag in the manifest maps to a clip that exists in the model
- All referenced textures load
- Triangle count, material count and texture memory stay inside the budget for the asset class, listed in `src/assets/budgets.ts`

Errors mean the asset will not behave correctly. Warnings mean it will work but costs more than its class budget allows.

## Licensing

Every asset needs accurate `provenance` in its manifest: author, licence, and where it came from. Do not add anything ripped from a film, a game, or a paid pack. This is a private fan project and ships no third party content.
