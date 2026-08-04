**English** | [Français](README.fr.md)

# 3D environments

Drop `.glb` (or `.gltf`) files here — they show up in Hanami (create/edit
character → “3D environment” menu). An environment replaces the 2D background:
the avatar stands INSIDE the room.

## Expected format

- **Units: meters**, **Y up** (glTF convention).
- **Origin on the floor** where the character should stand: **recommended, no
  longer required**. Your choice wins as long as it stands up; otherwise (a
  platform sitting above its tracks, a diorama on its base) the analysis **snaps
  the environment on its own** — see “Automatic spawn placement” below. Hanami
  still puts the environment on the ground and only fixes absurd scaling (height
  outside the 1.5 m – 12 m range).
- **Self-contained**: textures embedded in the `.glb`. A `.gltf` referencing
  external textures needs those files next to it.
- **Draco / meshopt / KTX2 compression is not supported**: such a file is
  rejected with a clear error. Re-export without compression.

## Placement (optional `.json` sidecar)

Next to `room.glb`, a `room.json` tunes placement without touching the model:

```json
{
  "scale": 1,
  "rotationY": 0,
  "spawn": [0, 0, 0],
  "exposure": 1
}
```

- `scale` — scale factor (0.01 to 100). Providing it **disables the automatic
  adjustment**: your value wins, however extravagant.
- `rotationY` — rotation in **degrees** around the vertical axis.
- `spawn` — the point `[x, y, z]` of the environment, in meters, where the
  character stands: the environment moves, the avatar stays at the world origin.
  `x`/`z` are measured on the environment as displayed (after `scale` and
  `rotationY`), and `y` counts **from the floor** — `[0, 1.2, 0]` puts the
  character on a 1.2 m platform.
- `exposure` — multiplier applied to the **colors of the environment materials**
  (0.1 to 4), for an environment that is already dark or already very bright. It
  does not touch the lights: three of the seven shipped environments are
  `KHR_materials_unlit` and ignore them entirely. The avatar is never affected.
  Beware, as everywhere here, an **out-of-range value is ignored** and falls back
  to 1 (environment untouched): writing `4.5` gives a darker room, not a lighter one.

Three further keys cover the special cases; the shipped environments give one
example of each:

- `frameDistance` — the default camera framing distance (0.5 to 8 m) **this**
  environment asks for: a big hall is watched from further away than a bedroom.
  Without it, the app decides.
- `materials` — repairs to a damaged asset, **by glTF material name**. Short form
  `"Floor": [r, g, b]`: the base colour is **replaced** (**linear** components 0-1,
  the `baseColorFactor` convention, not sRGB); long form
  `{ "color": [...], "transmission": 0 }`. Two real cases ship — the floors of
  `rustic-bedroom`, which came out of the export almost black and no exposure can
  rescue, and three decorative jars in `cozy-loft-room` whose transmission cost a
  whole extra render pass every frame. An unknown material name does nothing.
- `backdrop` — up to **eight** backdrop panels placed behind the environment's
  openings (an unglazed window, an open wall, a cutaway plan): without them the
  app's page background shows through.
  `{ "color": [r, g, b], "center": [x, y, z], "size": [width, height], "yawY": 0 }`,
  expressed in the **raw frame of the `.glb`** — the panel belongs to the
  environment, so changing `scale` or `rotationY` carries it along.

Every key is optional; an unknown key or an invalid value is silently ignored.

## Automatic spawn placement

An environment whose walkable floor is not at the model origin used to put the
character **under its own floor** and the camera **inside the geometry**: a dark
screen, without a word. The only cure was measuring the model by hand and
writing a `spawn`.

Not any more. When the sidecar gives **no `spawn`** and the resulting spawn point
is unusable — room floor more than 10 cm away from the character's feet, lens
blocked in all 16 directions, or origin outside the room — the analysis **picks a
spawn point itself** and re-runs around it. It records it in
`placement.spawnAuto`, and the app applies it exactly like a sidecar `spawn`.
Every other measurement in the file (map, seats, floor, clearance) already
assumes it applied: there is nothing to correct when reading them.

How it picks, in that order:

1. **the room** — the largest single walkable stretch, not the one touching the
   origin (on a subway platform, that one is the track bed);
2. **standing up** — at least 40 cm of clear floor around the feet, or the
   character is wedged in and cannot walk off;
3. **pulling back** — at least 2.5 m of clearance along +Z, where the camera sits;
4. **having something to frame** — and this is the tie-breaker: the closest
   backdrop BEHIND the character, because that is what the camera shows. A spot
   “right in the middle” of a large hall is a spot where you only see emptiness.
   All seven hand-tuned spawn points of the shipped environments have their
   backdrop within 2.7 m; on a tie, the environment moves as little as it can.

Three things it does **not** do:

- it **never** overrides a sidecar `spawn` — your value is the author's word and
  comes first, even when it is wrong;
- it does **not** move an environment whose origin does the job: a clean model
  yields exactly the same analysis file as before this mechanism existed;
- it does **not** replace a hand-tuned setting: to freeze it (or pick another
  spot), copy the value into `spawn` in the sidecar.
  `npm run env:scene -- <name>` prints it, ready to copy.

Should an environment still end up misplaced — a wrong sidecar `spawn`, an
environment with no walkable spawn point at all — the app **says so** in a
discreet banner next to the scene, with the value to write. A dark screen must
never stay silent.

## Automatic analysis (`<name>.scene.json`)

An environment dropped here is **measured on its own**, once, and the result is
written next to the model: `room.glb` → `room.scene.json`. The scene engine reads
that file to **walk** the character around the room, keep them out of walls, and
know what they can sit on. It holds no geometry — only measurements.

There is **nothing to do**. The analysis starts when the server boots, or as soon
as the UI lists the environments, in the background and one room at a time. Until
it is ready the environment **still shows up**: it works as a backdrop, just
without interaction. `GET /api/environments` reports each one's state (`pending`,
`analyzing`, `ready`, `failed`, `unsupported`) so the UI can say “preparing”, then
“ready”.

The analysis is **redone** when the `.glb` changes, when `scale`, `rotationY` or
`spawn` change in the sidecar, or when the analysis format itself moves on. An
analysis predating the automatic spawn placement, on an environment that would
need it, is redone **once** — then never again, whether or not it succeeded.
Changing only `exposure` does not: it moves nothing. An unreadable or compressed
`.glb` is **never** a loud error: the environment stays a backdrop and the reason
is recorded in its state.

### Frame of reference

The environment is measured **as it will be displayed**, sidecar applied. Every
coordinate can therefore be used as-is in the scene:

- **meters**, **Y up**;
- **origin at the character's feet** (the `spawn`), so the floor sits at `y ≈ 0`;
- the character faces **+Z**, the camera is on the +Z side.

### What the file holds

```jsonc
{
  "format": "hanami-scene", "version": 1,
  "generated": "2026-07-30T16:08:36.860Z",

  // Freshness: if any of these no longer matches, the analysis is redone.
  "source":    { "file": "room.glb", "bytes": 5544308, "mtimeMs": 1785401140995, "sha256": "059d66e37e5846" },
  // `spawnAuto` only shows up when the automatic placement had a say (no sidecar
  // `spawn` AND an unusable origin); `null` means it looked and found nowhere to
  // stand, so the environment stays a backdrop. See “Automatic spawn placement”.
  "placement": { "scale": 0.031, "rotationY": 330, "spawn": [0.287, 0.256, -0.296], "fingerprint": "247decca1cfc09e9" },

  "frame": { "units": "m", "up": "+Y", "forward": "+Z", "origin": "spawn — avatar feet, y = 0" },

  // The body the map was computed FOR. Change it and the analysis must be redone:
  // “free” means “free for that body”.
  "body": { "height": 1.6, "radius": 0.25, "step": 0.2, "seatRange": [0.15, 0.95] },

  "room": {
    // Raw box of the placed model: it often reaches FAR beyond the room (the
    // classroom is 27 m long because of the scenery painted behind the windows).
    // Do not frame anything with it.
    "modelBounds": [-2.509, -0.256, -1.977, 1.889, 2.974, 2.415],
    // THE room: the box of what is reachable on foot from the spawn point.
    "walkBounds": [-1.2, -0.7, 1.4, 2.3],
    "walkArea": 2.98,          // m² actually walkable — 0 = no usable floor
    "ground": -0.001,          // floor altitude (≈ 0 when the sidecar is well tuned)
    "ceiling": 2.975           // null when the environment is open at the top
  },

  // Free distance from the spawn point, at lens height, in 16 directions:
  // index k ⇒ heading k × 22.5°, so 0 = +Z, 4 = +X, 8 = −Z, 12 = −X. A 0 means
  // “blocked from 30 cm on”. Measured on a coarse grid: accurate to about a
  // quarter meter, and capped by the analysed extent.
  "camera": { "eye": 1.3, "clearance": [2.2, 1.6, 1.4, 1.3, 1.4, 1, 8.4, 0.8, 0.7, 0.5, 0.3, 0, 0.5, 0.5, 1.4, 1.8] },

  "grid": { … },   // see below
  "seats": [ … ]   // see below
}
```

### The floor map

```jsonc
"grid": {
  "cell": 0.1,             // cell side, in meters
  "origin": [-2.2, -1.7],  // minimum corner of cell (0, 0)
  "cols": 41, "rows": 41,
  "levels": [-0.001, 0.021, 0.051],   // floor altitudes, ascending
  "map": [
    "...........########......................",
    "################0000000000000000000###...",
    "#############00#2222222222#00000000#.....",
    …
  ]
}
```

`map[j][i]` describes the cell at column `i`, row `j` — `i` follows **increasing
x**, `j` follows **increasing z**. Its center is at

```
x = origin[0] + (i + 0.5) × cell        i = floor((x − origin[0]) / cell)
z = origin[1] + (j + 0.5) × cell        j = floor((z − origin[1]) / cell)
```

Four characters, and nothing else:

| character | meaning |
|---|---|
| `.` | **no floor** — the void, outside the room |
| `#` | **blocked**: there is a floor, but you cannot stand on it (wall, furniture, under a mezzanine) |
| `~` | **free floor, out of reach on foot** — desktop, mattress, separate island |
| `0`-`9`, `a`-`z`, `A`-`Z` | **free and reachable floor**; the character is the **index into `levels`**, which gives its altitude |

In other words: **anything that is not `.`, `#` or `~` can be walked on**, and its
altitude is read from `levels`. That is deliberately unambiguous — an engine
treating “everything but `.#~`” as walkable cannot get it wrong. Reachability was
computed from the spawn point, climbing at most `body.step` from one cell to the
next; the step between neighbouring cells is read from `levels`.

It is a **floor plan, and it reads like one**: rows in order, one per line. You can
spot a classroom's rows of desks with the naked eye. It can also be edited by
hand — blocking a passage is a matter of replacing characters with `#`. Beware:
the next regeneration overwrites it (see below).

### Seats

Every horizontal surface at a plausible height (`body.seatRange` above
`room.ground`) is listed, **with no model-based filtering whatsoever**: a bed, a
step, a crate, a desk are all seats. It is up to the engine, through inverse
kinematics, to fit the pose to the real height — not up to the analysis to decide
that a piece of furniture is “incompatible”.

```jsonc
{
  "id": "seat-1",
  "y": 0.634,                       // REAL altitude of the seating surface
  "center": [-0.846, -0.744],       // [x, z]
  "bounds": [-1.5, -1.6, -0.1, 0.2],// [xMin, zMin, xMax, zMax] — the patch, not necessarily solid
  "area": 1.07,                     // m²
  "headroom": 0.84,                 // free space above
  "yaw": 58.3,                      // gaze, in DEGREES (see below)
  "back": true,                     // heading comes from a backrest or a wall; false = from the room's opening
  "approach": [-0.45, -0.05]        // walkable cell to come sit from — null when unreachable on foot
}
```

`yaw` follows the three.js convention: the gaze direction is
`[sin(yaw), 0, cos(yaw)]`, and the value drops straight into `rotation.y` (in
radians). A seated character **turns their back** to the nearest backrest or wall;
with no readable backrest, they look where the room opens up.

### Redoing an analysis, or understanding a result

```
npm run env:scene                     # whatever is missing or has changed
npm run env:scene -- --all            # redo everything
npm run env:scene -- room             # one environment, with the detail of what was found
npm run env:scene -- room --explain   # …and why a given surface was not kept
npm run env:scene -- room --dry       # without writing anything
```

The detailed output shows dimensions, seat heights as a histogram, the floor map
and the seat patches overlaid on it. `--explain` counts the discarded surfaces and
says why (too small, no headroom above, it is floor).

**Deleting a `.scene.json` is enough**: it gets regenerated on the next scan. The
analysis is deterministic — same files, same result.

The `.scene.json` files of the shipped environments **are committed**: they are
computation, not personal data, and it saves everyone the same measurement.

## Good to know

- The canvas is **transparent**: an open environment (no ceiling, no wall behind
  the camera) lets the app gradient show through. That is **intended** — the
  natural fallback, not a bug.
- The **seven environments shipped with the app are committed on purpose**: all of
  them are **CC BY 4.0**, and credited one by one in [`CREDITS.md`](CREDITS.md) —
  attribution is that licence's only condition, and it must accompany any
  redistribution. The ones **you** drop in here are not (see `.gitignore`): each
  environment has its own licence, and checking it before sharing is on you.
- A snapshot (photo button) captures the avatar **and** the room behind it.
- Size matters: a 100 MB environment loads slowly on a phone.
