**English** | [Français](LISEZMOI.md)

# devtools — the animation tuning tools

This folder is not part of the app: nothing here loads at startup, and
`npm run build` ignores it. These are the tools with which the `.vrma` files
in `vrma/` were picked, measured and fixed. They ship because they're useful
to anyone adding or replacing a clip — and a tool kept to oneself eventually
gets lost.

**No npm dependency added**: `three` and `@pixiv/three-vrm*` are taken from
the project's `node_modules`, read-only. Node alone is enough.

| | |
|---|---|
| [`anim-lab/`](anim-lab/README.md) | **the test bench**, in the browser: replays clips on a real `.vrm`, measures the joins (*idle → anim → idle*, in centimetres), plays sequences, tries out environments, and shows the diagnostic below. Serves the page and relays assets to the app's server. |
| [`diagnostic/`](diagnostic/README.md) | **the biomechanical diagnostic**, without a browser: for each clip, a sheet in French (is it *plausible*?) and five PNGs (contact sheets, traces, phase) that **show** it. |
| `diagnostic-out/` | what the diagnostic writes. **Gitignored**: ~150 MB of PNGs, regenerable with one command. |
| [`matrice-scene/`](matrice-scene/README.md) | **the scene-transition harness**, played INSIDE the app's page: it clicks the real dialogs to unroll every reachable combination (2D background ↔ 3D environment, model ↔ portrait, animations, living scene, families, screen width, reload, importing an environment) and checks after each one that the image is painted, that the API says the same thing as the screen, and that the console is empty. |
| [`repose/`](repose/README.md) | **the model repair tool**: restores T-pose on a `.vrm` exported with a pose baked into the skeleton (the founding case: an export with a baked pose, 17 failures at the matrix → 0), from a reference model with the same skeleton. BIN kept byte-for-byte, clean refusals otherwise. |

## The reference — the model everything is measured against

The tools in this folder render **centimetres**: "the foot goes through the
floor by 2.1 cm", "this join jumps by 13.6 cm". But a centimetre means nothing
without the body carrying it — the `vrm/` folder ranges from 0.33 m to 1.25 m
of hip height, almost a fourfold ratio. **Two runs only compare with the same
model.**

The measurement model used to be "the first `.vrm` in the folder". That was a
trap: the folder is alive, and a model whose name sorted earlier shifted every
number from one run to the next (27.8 → 30.4 cm of spread for the same
`idle`) without any warning. The model is therefore now pinned by a **FIXED
NAME**, which disk order can no longer move.

VRM models are not committed (third-party licences, see `vrm/README.md`): the
repository fixes the names, you provide the files. **Put yours under these
names in `vrm/`** — a copy, or a symlink to what you already have:

| expected name | profile | what it's used for |
|---|---|---|
| `vrm/reference.vrm` | **the reference**: VRM 0.x chibi, hips ≈ 0.755 m | the default for all tools; it's the one behind the numbers written in the docs and the committed sheets |
| `vrm/reference-2.vrm` | the average rig: VRM 0.x, hips ≈ 0.904 m | the joins-and-blends probe (`anim-lab/`) — an adult build, to check a defect isn't a proportion |
| `vrm/reference-1x.vrm` | the **VRM 1.x** control, adult build | `banc-regard.mjs` and `banc-cadrage.mjs`: the two format versions don't orient their bones the same way, and it's measurable |

Nothing forces you to match the exact builds: the tools work with any `.vrm`,
they print the model and its hip height on every run. But **the numbers in
the docs only hold for these specific builds** — on another body, redo the
measurement before drawing conclusions.

With no reference set, the tools stop and say what to do. For a one-off
measurement on another model, `--modele=<exact name|path>` (alias `--vrm=`)
takes priority over the default:

```
node devtools/diagnostic/juge/juge.mjs world-walk --vrm=vrm/mon-modele.vrm
```

## Starting the bench

The app's server must be running (`npm run dev` → <http://127.0.0.1:7788>):
it's the one holding the models, the clips and the API.

- **Windows**: double-click **`LANCER-LE-BANC.cmd`**. The bench opens in its
  own window — it depends on no agent and only shuts down with it.
- **Linux / macOS**: `node devtools/anim-lab/serve.mjs`

Then <http://localhost:7799/> (the next port if 7799 is taken; `LAB_PORT` to
force another one).

## Generating the diagnostic

```
node devtools/diagnostic/diagnostic.mjs --lot     # every clip in vrma/ (~3 min)
node devtools/diagnostic/diagnostic.mjs world-walk
```

On the reference model, unless `--modele=` (see above).

The sheets and images land in `devtools/diagnostic-out/`, where the bench
goes looking for them (**Diagnostic** tab). `devtools/diagnostic-out/RAPPORT.md`
says the same thing without a browser.

One exception to `diagnostic-out/`'s disposable nature:
`diagnostic/notes-visuelles.json` is **versioned**. It's what was written by
hand after *looking* at the images — the eye's memory, which nothing
recomputes.
