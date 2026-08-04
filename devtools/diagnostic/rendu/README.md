**English** | [Français](LISEZMOI.md)

# devtools/rendu — SEE an animation without a browser

Hanami's `.vrma` render bench: it loads a **real .vrm** (skeleton + mesh, built
by hand from the glTF — no DOM, no WebGL) and a **.vrma**, and writes **PNGs**
a human or an agent can open. No dependency: the PNG is hand-encoded
(`png.mjs`), the font is a 5×7 bitmap (`police.mjs`), skinning is redone in
typed arrays (`scene.mjs`).

Read-only on the repo (vrm, vrma, node_modules). Everything is written to
`devtools/diagnostic-out/`, which is gitignored.

## Call

```
# from the repo root; RENDU=devtools/diagnostic/rendu/rendu.mjs
node $RENDU tout     world-walk                  # the clip's 5 images
node $RENDU planche  world-walk --vue=toutes     # front + side + top
node $RENDU traces   world-sit-enter
node $RENDU phase    world-walk world-walk-fast
node $RENDU liste                                # available clips and models
```

Options: `--modele=<exact name|path>` (default `vrm/reference.vrm`, the
reference; ambiguity refused) · `--vue=face|profil|dessus|toutes` (front | side
| top | all)
· `--poses=N` (12) · `--colonnes=N` (columns, 4) · `--case=WxH` (cell size,
300x400) · `--cadre=corps` (frame=body, disables auto close-up)
· `--maillage=0` (mesh=0, skeleton only, ~5× faster)
· `--pelure=0` (onion skin=0) · `--fps=N` (60) · `--sortie=<folder|file>`
(output) · `--prefixe=<txt>` (prefix).

Default output: `devtools/diagnostic-out/rendu/<clip>-planche-<vue>.png`, `<clip>-traces.png`,
`<clip>-phase.png`. One image renders in 0.1 to 0.7 s; a process's first clip
pays ~1 s of model loading (cached afterwards).

API: `const R = await import('./rendu.mjs')` then
`await R.rendre({ clip, type, vue, modele, sortie })` or `R.toutRendre({ clip })`.
Building blocks: `scene.mjs` (loading, pose, soles), `figure.mjs` (views,
framing, drawing), `planches.mjs` (the three images, `analyser()` for numbers
alone).

## The three images

1. **Contact sheet** — N poses framed TOGETHER (shared framing, otherwise the
   motion disappears). Body = mesh actually deformed (grey, outlined by depth
   discontinuity), skeleton on top: LEFT blue, RIGHT red, onion skin = previous
   pose in pale, black spur on the head = gaze. Per cell: n°, t, pelvis height,
   supporting foot. If only one limb moves, the sheet frames on it (auto
   close-up, bounded: motion < 3 cm or scale > 600 px/m → back to the wide
   shot, announced in the banner).
2. **Traces** — feet/hands/pelvis/head trajectories, vertical plane + top-down
   view, black squares = foot on the ground, pale silhouette = pose at t = 0.
   The banner gives the supporting foot's ground travel (= the advance the
   engine must render on a clip played in place, = the skating on a clip meant
   to stay still).
3. **Phase strip** — L/R ground contact as bars, pelvis height, sole heights
   (red zone = below the floor), max angular speed of the major bones.

## Conventions and pitfalls (already fixed, do not reintroduce)

- Last frame sampled at `duration − 1e-4`: at `duration` exactly, LoopRepeat
  renders the first frame (wrong result).
- VRM 0.x: the scene is rotated 180° the way the app does it (`rotateVRM0`),
  so +Z = forward for every model.
- Anti-T-pose rest pose reused from `vrmStage.ts` (arms along the body) for
  bones the clip doesn't animate.
- The FLOOR is y = 0 (where the app places the character), never "the clip's
  lowest point" — that's what makes penetration below the floor visible.
  GROUND CONTACT, though, is relative (the lower of the two feet, to within
  ~1.2 cm).
- Foot height is measured on the mesh's SOLE (the lowest vertex of the foot),
  not the ankle bone (9 cm above the floor).
- `world.json` is read if present (family, loop); gaits record there the speed
  the code must apply (clips played in place).

## Fine inspection

`node _crop.mjs src.png dst.png x y w h [zoom]` crops and enlarges a region of
a bench PNG. Files prefixed `_*` are internal experiments, no guarantees.
