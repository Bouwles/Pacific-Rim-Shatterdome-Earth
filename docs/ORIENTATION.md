# Orientation contract

One convention for every body in the game. Anything that arrives in another
convention is adapted once, at the model boundary, and validated there. No
gameplay code compensates for a model; if a machine faces the wrong way, the
model is wrong and `validateOrientation` says so.

## The convention

- Engine: Babylon.js, default left-handed system. `useRightHandedSystem` is
  never set.
- World up is +Y. World north is +Z. World east is +X. The world modules
  speak in `east`, `north`, `up`; the renderer maps them to `(x, z, y)` in
  that order everywhere (`jaegerView`, `combatView`, `effectsView`).
- Units are metres. Scale is 1 on every gameplay root and every rig root.
- Yaw is a compass bearing in degrees: 0 is +Z (north), 90 is +X (east),
  positive is clockwise seen from above. The one conversion is
  `rotation.y = yawDeg * PI / 180`.
- Character forward is local +Z. Character right is local +X. Character up
  is local +Y. A body's front features (visor, chest reactor, jaw, blade
  crest, toes, claws) sit at positive local Z; the tail, heels, thrusters and
  back pack sit at negative local Z.
- The model-root pivot is on the ground plane between the feet: local
  `y = 0` is the sole. `pose.up` is the feet height, so a body is placed by
  setting the root position to `(east, up, north)` and nothing else.
- Handedness of the hierarchy is never flipped: no negative scale anywhere
  on a root or a limb. A mirrored part is built mirrored, not scaled by -1.

## Roots

- The gameplay root (`machineRoot` in `jaegerView`, `bodyRoot` in
  `combatView`) carries position and `rotation.y` only. Its scale is
  `(1, 1, 1)` and its `rotation.x` and `rotation.z` are zero, always. The
  arena, the camera, the targeting cones and the zone placements all read
  this root.
- The rig root (`JaegerRig.root`, `CreatureRig.root`) is parented to the
  gameplay root with an identity transform. Procedural rigs are built to the
  convention, so the rig root needs no correction.
- Each rig owns a `visual` node under its root. Knockdowns, topples and
  stagger sway rotate the visual node and nothing above it, and every such
  rotation is tagged (`rig.tilt` reports it) so the validator can tell a
  knockdown from a bug.
- An external asset (a GLB) that faces -Z or is authored Y-forward gets one
  documented correction on its own visual root, declared in the asset
  manifest as `importCorrection`, applied in `assets/resolver.ts` and
  nowhere else. Gameplay never sees it.
- A skeleton root, when a skinned asset is used, must agree with the visual
  root: same up, same forward. The validator checks it when one is given.

## Sockets and effects

- Sockets are `TransformNode`s under the rig: `head`, `chest`, `reactor`,
  `back`, `hand.L`, `hand.R`, `forearm.L`, `forearm.R`, `foot.L`, `foot.R`,
  `muzzle`. A socket's local +Z is the direction the thing mounted on it
  points: the muzzle fires along its +Z, the reactor glows out of its +Z.
- Effects positioned from the arena use contact points in the world frame;
  effects positioned from a body use a socket's world position.

## The validator

`src/engine/orientation.ts` exports `validateOrientation(subject)`. It runs
in the orientation test scene, in the integration tests on both procedural
rigs, and in a debug build on every rig the pilot and combat views create.
It reports, and refuses on:

- a non-finite position, rotation or scale anywhere in the hierarchy;
- a negative or zero scale component on the root;
- a mirrored world matrix (negative determinant);
- an up vector whose dot with world up is under 0.9 while no tilt is tagged;
- a front marker (the reactor, the jaw) that is not ahead of the root along
  local +Z;
- a pivot that is not on the ground plane;
- bounds that dip below the ground plane by more than two percent of the
  height, or a body shorter than half its declared height;
- a skeleton root that disagrees with the visual root.

## Test scene

`?scene=orientation` opens a flat plane with labelled world axes, front,
back, left and right markers, a turntable camera, both rigs, a pose cycle
(neutral, walk, sprint, dodge, every attack, guard, knockdown and recovery)
and, behind the debug toggle, socket markers, hitbox overlays and bounds.
