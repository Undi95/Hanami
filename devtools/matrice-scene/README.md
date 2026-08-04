**English** | [Français](LISEZMOI.md)

# Scene matrix — the state-transition harness

A 3D environment arriving mid-conversation, an environment being removed,
interactions switched on from a 2D background, a character with no model, a
shrinking screen… The scene has **too many combinations** to try by hand
without missing one. This harness unrolls them **by itself**, the way a user
would: it clicks the real buttons of the real dialogs.

It knows nothing of the scene's internals — it exposes nothing, and nothing
was added for it. What it knows, it reads **from the outside**:

| sensor | what it tells |
|---|---|
| WebGL draw calls (instrumented prototype) | is the image **actually** rendered, or dead? |
| `gl.readPixels` in an animation frame | what is **painted**: alpha coverage (transparent canvas ⇒ empty / avatar alone / environment fullscreen), and the **motion** between two instants |
| DOM | 2D portrait, error banners, "Loading environment…" chip, 3D hint |
| `GET /api/ui`, `/api/environments`, `/api/characters` | does the server say the same thing as the screen? |
| the displayed environment's `.scene.json` | its floor altitude and the camera's clearance — the two measurements that explain a black screen |
| `console.error` / `window.onerror` | zero errors after every transition |

It distinguishes two things easily confused: the render **loop** (the
`gl.clear` calls, always expected alive) and the **draws** (`drawElements`…,
which only happen if there's something to paint). A character with no model
and no environment is zero draws with a loop still running: the scene is
**empty**, not dead.

## What it doesn't touch

- It creates **its own** characters, all named "Matrice …" (ids `matrice-*`),
  and refuses to delete an id that doesn't start with `matrice-`.
- It saves `data/ui.json` before starting and **restores it key by key**: the
  ones it added go back to `null`.
- The disposable environment used for the import test is placed and removed
  by a separate tool, which checks that `environments/` came back **exactly**
  to its prior state.

## Running the matrix

The app's server must be running (`npm run dev` → <http://localhost:7788>).

1. Open <http://localhost:7788> and the browser console (F12).
2. Paste the content of `matrice.js` into the console. Shorter, if you're in
   development, one line is enough (adapt the repo root):

   ```js
   (0,eval)(await (await fetch('/@fs/D:/Projet%202/devtools/matrice-scene/matrice.js')).text())
   ```

   `/@fs/` is Vite's endpoint for serving a file straight from disk; it
   refuses `data/`, and only exists in development — in production, you paste
   the script itself.

3. Unroll it:

   ```js
   await matrice.jouer()
   // or, to force the model and background of the disposable characters:
   await matrice.jouer({ modele: 'chambre-claire', fond: 'nom-du-fond' })
   ```

   With no argument, the harness takes the **first** model in `vrm/` and the
   first background in `backgrounds/`: nothing is hardcoded, it runs on any
   installation. Labels are the menus' own (file name without extension).

The harness plays the steps one by one and **stops itself** when it needs a
human hand — it then says what to do, in one sentence:

| it asks | you do | then |
|---|---|---|
| shrink the window to 375 px | resize | `await matrice.reprendre()` |
| give it back its desktop width | resize | `await matrice.reprendre()` |
| reload the page | F5, then paste `matrice.js` again | `await matrice.reprendre()` |
| place the disposable environment | `node devtools/matrice-scene/decor-jetable.mjs poser <path.glb>` | `await matrice.reprendre()` |

The log lives in `sessionStorage`: it survives a reload, and
`matrice.reprendre()` picks up exactly where it stopped.

4. At the end:

   ```js
   matrice.resume()      // total / ok / failures, and each failure's gap
   matrice.rapport()     // the full log (probes included)
   await matrice.nettoyer()   // disposables deleted, ui.json restored
   ```

   then, if the disposable environment was placed:

   ```
   node devtools/matrice-scene/decor-jetable.mjs retirer subway-platform
   ```

## What gets unrolled

The combined states — **the ones reached through the interface**, not the
blind cartesian product: background (none · 2D image · 3D environment) ×
model (VRM · 2D portrait) × 3D environment on/off × animations on/off × living
scene on/off × family (Overte · Rocketbox) × width (desktop · 375 px).

The transitions, in order:

| # | transition |
|---|---|
| T1 | 2D background → 3D environment, mid-conversation |
| T2 | 3D environment → 2D background (removal) |
| T3 | living scene turned on **before** having an environment |
| T4 | 3D environment turned on for a character **with no** environment assigned |
| T5a | changing environment **while walking** |
| T5b | changing environment **while sitting** |
| T6 | changing character mid-scene (Overte → Rocketbox, and back) |
| T7 | removing the VRM model with the living scene on |
| T8 | gesture animations turned off with the living scene on (and back on) |
| T9 | desktop → 375 px while the living scene is on, then back |
| T10 | page reload mid living-scene |
| — | full environment import: dropping the `.glb`, automatic analysis, assignment, walking, sitting, removal |

## Reading a failure

`matrice.resume()` gives the list; `matrice.rapport().etapes` gives, for each
step, the full probe: alpha coverage, draw calls, motion measured after each
click, server-side preferences, console errors. A sensor that can't decide
writes what it measured rather than inventing a verdict.

The thresholds are at the top of `matrice.js`:

- `COUV_VIDE = 0.02` (empty coverage) — below this, nothing is painted;
- `COUV_DECOR = 0.45` (environment coverage) — above this, an environment
  fills the frame;
- a click's motion is judged **relative to rest**, measured just before, in
  the current state (`FACTEUR_MOUVEMENT = 3` [motion factor], floor
  `MOUVEMENT_MIN = 1` [minimum motion]). An absolute threshold couldn't
  decide: the breathing of an avatar filling a phone screen moves twenty
  times more pixels than that of an avatar standing at the back of a café.

Two known sensor limits, worth remembering before crying bug:

- an **open** environment (no ceiling, no wall behind the camera) lets the
  app's gradient show through: its coverage can fall under `COUV_DECOR`
  without anything being broken;
- the click points (`POINTS_SOL`, `POINTS_ASSISE` — floor points, seat
  points) aim **next to the avatar** — clicking the avatar itself is a
  different gesture ("get its attention"), which moves the image even with
  no environment. In a very cluttered room, none of the four points is
  guaranteed to land on walkable floor.

## The environment that places the character under its own floor

As soon as an environment is expected on screen, the harness checks two
measurements the analysis already wrote into the `.scene.json`:

- `room.ground` — the walkable floor's altitude. The avatar itself is
  **always** at `y = 0`. A floor at 1.52 m means the character is standing
  1.52 m **under** the floor;
- `camera.clearance` — the clearance around the lens in 16 directions.
  Sixteen zeros = the camera is **inside** the geometry.

This is the case for an environment whose model doesn't have its origin at
floor level (a subway platform sitting above its track, for instance). It
analyses without error, it displays, and the screen is black. A `spawn`
sidecar fixes it — see `environments/README.md`.

## The disposable environment

```
node devtools/matrice-scene/decor-jetable.mjs poser <path.glb>
node devtools/matrice-scene/decor-jetable.mjs etat
node devtools/matrice-scene/decor-jetable.mjs retirer <name>
```

`poser` (place) takes stock of `environments/` **before** copying, and
`retirer` (remove) only deletes files that appeared since, bearing the
disposable environment's name (the `.glb` and its generated `.scene.json`).
Everything else is left alone and reported. The last line says whether the
folder is back to its prior state.
