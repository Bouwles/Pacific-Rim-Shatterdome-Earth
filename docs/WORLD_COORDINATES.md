# WORLD_COORDINATES.md

How the miniature Earth is addressed, partitioned, and kept numerically stable.

## Scale

| Constant                   | Value     | Meaning                      |
| -------------------------- | --------- | ---------------------------- |
| `REAL_EARTH_RADIUS_METERS` | 6,371,000 | Real Earth mean radius       |
| `EARTH_SCALE`              | 1/50      | Globe shrink factor          |
| `WORLD_RADIUS_METERS`      | 127,420   | Radius of the playable globe |

The globe is shrunk but the things standing on it are not. A 75 m Jaeger keeps
its real size while the planet becomes small enough to cross. That is what
"miniature Earth" means here, and it is geometrically inconsistent on purpose:
Hong Kong to Tokyo is 2,890 km in reality and about 58 km here.

The consequence to keep in mind is that cities sit close together. Region radii
are the dense combat core, not metropolitan sprawl, and are capped by the
tightest pair on the map: Tokyo and Vladivostok, 21 km apart.

## Position representation

Authoritative positions are geodetic: `{ latitudeDeg, longitudeDeg, altitudeMeters }`.

Degrees in a double resolve to well under a millimetre at this radius, and unlike
a single world-space Cartesian frame the representation does not lose precision
as you move away from an arbitrary origin. It is also directly serializable, so
the save format stores exactly what the simulation holds.

Two derived forms exist:

- **ECEF** (`{x, y, z}` metres, Y as the polar axis to match Babylon's up) for
  geometry and projection maths.
- **Local tangent** (`{east, north, up}` metres) for everything near the player:
  rendering, and eventually local physics.

Round-trip error between global and local is measured at under a micrometre
across the whole active bubble, and under 0.1 mm even 70 km out.

## Sector partition

A cube-sphere: six cube faces, each a 16 by 16 grid, projected onto the sphere.
1,536 sectors, roughly 9 to 12 km across.

Sector ids are `<face>/<u>/<v>`, for example `+Z/3/12`. They are stable, readable,
and parse straight back into their parts.

### Why not latitude and longitude cells

A lat/lon grid has a singularity at each pole and cells that shrink to nothing
approaching them. A cube-sphere has neither.

### Tangent adjustment

Projecting an evenly spaced grid straight onto a sphere still leaves corner cells
much larger than face-centre cells: measured at 2.31x across this grid. Warping
the grid through `tan` before projection makes the angular step near-uniform and
brings the spread down to 1.35x, so sector cost barely varies with location.

### Neighbour lookup

`sectorNeighbors` steps one cell in each of four directions. Inside a face that is
plain index arithmetic. Stepping off an edge is resolved by projecting the stepped
point back onto the sphere and asking which face it lands on.

One rule covers every face, edge, and rotation. The alternative, a hand-written
table of 24 edge adjacencies, is both a name-keyed switch and a thing that falls
out of sync with the face bases. Tests assert that all 1,536 sectors have four
distinct neighbours, that the relation is symmetric everywhere including the eight
cube corners, and that walking neighbours from one sector reaches the whole globe.

## Floating origin

Rendering and local physics work in a tangent plane around an anchor. When the
player drifts past `DEFAULT_REBASE_THRESHOLD_METERS` (2,000 m), the anchor moves.

Rebasing changes no authoritative state. Global positions stay geodetic and
untouched; only the local projection moves. A rebase cannot make a body teleport,
gain velocity, or explode, because it is a change of viewpoint rather than a
change of world.

### Rebasing cached positions

Use `rebaseLocal(local, event)`. Do **not** subtract `event.shift`.

Two tangent planes on a sphere are related by a rotation as well as a translation.
A plain subtraction drifts with distance: measured at 2.9 m of error across a 4 km
rebase, which is a visible pop on a 75 m Jaeger. `rebaseLocal` goes back through
the authoritative global position and is exact at any distance.

Measured behaviour: walking 25 km keeps local coordinates capped at exactly the
2,000 m threshold instead of climbing to 25,000 m, with latitude strictly
monotonic across every sector boundary.

### Movement on a curved surface

Walking a straight line in a flat tangent plane lifts you off a curved globe:
measured at 239 m of false altitude over a 25 km walk. Movement carries the
previous geodetic altitude across, and then settles onto the streamed ground
wherever a sector with collision detail is resident.

Settling happens every frame rather than once on arrival, because terrain streams
in after the player is already standing there. Without it the player kept the
altitude they had when they arrived: measured at 0 m while the ground underneath
read 169.8 m.

## Active bubble versus strategic records

Exactly one region is ever tiered `active`. Every other region on the planet is a
`RegionRecord`: a small plain-data record with integrity, safety rating, last
visited tick, and tier. No meshes, no physics bodies, no detailed AI.

`ACTIVE_BUBBLE_RADIUS_METERS` is 4,000 m, used as a floor so a small region still
gets a usable bubble. `validateWorldSnapshot` rejects any snapshot claiming two
active regions, so the rule is enforced by the format rather than by convention.

Region footprints are asserted not to overlap, which keeps the active region
unambiguous.

## Sampling inside a sector

`sectorSurfacePoint(address, s01, t01, altitude)` returns a real position on the
globe for cell-relative coordinates in 0 to 1, and `sectorGridCoordinates` is its
inverse. Both live in `cubeSphere.ts` alongside the face bases and the tangent
adjustment. A second implementation elsewhere would drift out of sync and seam
sectors against each other, which is exactly the failure the partition exists to
avoid.

Terrain generation samples a grid through the first; ground collision reads a
height field through the second.

## Ring expansion

`sectorsWithinDepth(address, maxDepth)` returns every sector within `maxDepth`
steps, mapped to the number of steps taken. Expansion goes through the eight
surrounding sectors rather than the four edge-adjacent ones.

Edge-only expansion produces diamond-shaped rings. On screen that leaves the four
corners of the loaded area empty, which reads as a black notch in the middle
distance where the ground simply stops. Including the diagonals makes each ring a
square, so the loaded area looks like what a viewer expects a loaded area to look
like. Depth 3 therefore covers a seven by seven block: 49 sectors.

Rings are counted in steps rather than metres because steps are what the
partition guarantees, and stepping through the shared projection means a ring
crosses face boundaries correctly without any special case.

## Great-circle interpolation

`interpolateGeo(a, b, t)` slerps the direction vectors rather than interpolating
latitude and longitude separately, which would bend the path and move at the
wrong speed near the poles. Coincident and antipodal endpoints fall back to a
normalised linear blend, since the slerp weights are degenerate there.
