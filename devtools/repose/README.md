**English** | [Français](LISEZMOI.md)

# repose-vrm — fixing the rest pose of a .vrm

A **model repair** tool, shipped in `devtools/`: it touches neither the app,
nor the clips, nor the data. Exactly one file changes — the `.vrm` it's asked
to repair, and only if every check passes.

## The problem it fixes

The VRM format requires a model to be exported in **T-pose**: it's the
assumption behind all retargeting (three-vrm builds its normalized bones from
the file's rest pose). Some exports "bake" a pose into the skeleton — arms
lowered, wrists turned — by burning it into the bones' **translations**
(rotations reset to identity, mesh re-bound onto that pose: the file is
internally consistent, so no tool complains). On such a model, every
retargeted clip places the hands off to the side, consistently, by the same
angle.

The founding case: an export with a baked pose — 17 failures and 17
borderline results in the bench's matrix, the sole outlier among 94 models,
`idle` at 9.4 cm from its own base. Its skeleton is identical to a healthy
twin from the same exporter (169 nodes with the same names, lengths equal to
a tenth of a millimetre); only the arms' rest pose differed: ~80° at each
shoulder, ~22° and ~10° at the wrists.

## What it does

Starting from a **reference model with the same skeleton** (identical node
naming), it writes **rest rotations** onto the faulty bones so that each
segment points the way the reference's does. Nothing else:

- translations untouched (bone lengths are the model's own);
- BIN chunk copied **byte for byte** (vertices, normals, IBMs, morphs,
  textures) — proven by a SHA-256 hash of the written file;
- the mesh, bound in the old pose, is **posed** into T-pose by skinning,
  exactly as an animation would have posed it. During a clip, world-space
  deformation is the same as on the reference — it's the exact equivalent of
  a re-bake, without rewriting a single byte of geometry.

Alignment is done on **segment directions**, not absolute positions: two
exports of the same character can have finger bases up to a centimetre apart
— that's build variation, not a pose error. One child bone → minimal arc;
several children (a hand and its five fingers) → Horn's quaternion method,
solved by **cyclic Jacobi** (an exact solver: on near-coplanar offsets in
metres, power iteration returned a vector halfway between candidates — 1 cm
of silent error, it happened, the startup self-test has replayed that real
case ever since).

## Usage

```
# diagnostic only (no write)
node devtools/repose/repose-vrm.mjs vrm/modele-casse.vrm --ref=vrm/modele-sain.vrm

# write the fixed file ELSEWHERE, to measure it first
… --sortie=<path.vrm>

# replace the original file (mandatory <file>.avant-repose backup,
# refused if one already exists; the app doesn't list that extension)
… --appliquer

# threshold (cm) beyond which a segment is "wrong" (default 0.5)
… --seuil=0.5
```

Clean refusals, no write: skeletons that can't be overlaid by rotation alone
(direction residual above the threshold), a faulty node whose parent isn't
matched, a backup already present, the solver's self-test failing.

## The proof, to redo after every use

The tool checks geometry; the **bench** checks behaviour. On the founding
case, after applying the fix (clips as of 2026-08-01):

| measurement | before | after |
| --- | --- | --- |
| 111-clip probe (`--rig=vrm --vrm=vrm/modele-casse.vrm`) | 14 failures · 16 borderline | **0 failures · 3 borderline** — same outcome as the healthy reference model, clip by clip, to a tenth of a cm |
| `idle` against its own base | 9.4 cm | **1.0 cm (excellent)** |
| `world-walk` judge, arm/leg opposition | ✗ r = +0.66 | ✓ r = −0.98 |
| `world-run` judge, left-elbow hyperextension | ✗ 44° | ✓ gone |
| mesh sheet (`diagnostic.mjs idle --modele=…`) | arms offset | clean silhouette, the mesh follows |

The produced file remains a valid glTF/VRM. Its particularity: non-identity
rest rotations on the corrected bones, which three-vrm (the app's library)
handles by design — VRMHumanoidRig reads the real rest pose. UniVRM (Unity)
would complain "not normalized" on import: out of scope for the app,
documented here for the record.
