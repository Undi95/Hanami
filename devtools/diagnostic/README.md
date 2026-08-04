**English** | [Français](LISEZMOI.md)

# devtools/diagnostic — SEE and JUDGE animations, without a browser

Three tools, one contract: answer "**is it LOGICAL and is it GOOD?**" with
results a human or an agent can READ — PNGs on disk, sentences in French,
justified numbers. Zero npm dependency (the project's own are reused
read-only); the only write target is `devtools/diagnostic-out/`, which is
**gitignored** (hundreds of PNGs, ~150 MB, regenerable with one command).

| folder / file | role |
|---|---|
| `diagnostic.mjs` | **THE entry point.** Assembles judge + render: for each clip, a sheet (md + json) AND five PNGs, filed under `../diagnostic-out/<clip>/`, plus `RAPPORT.md` (the master index) and `index.json` (read by the bench's Diagnostic tab, which serves this folder under `/diagnostic/`). File header = every call. |
| [`juge/`](juge/README.md) | the biomechanical judge: criteria per family, ranges, sentences. Its `README.md` details criteria, cross-checks and blind spots. |
| [`rendu/`](rendu/README.md) | the render bench: contact sheets, traces, phase strip — PNGs hand-encoded, mesh actually deformed, sole measured on the mesh. Documented in its own `README.md`. |
| `notes-visuelles.json` | **the eye's memory**: notes written by hand AFTER looking at the images (+ `vedettes`, the images to open first). `diagnostic.mjs --rapport` folds them into RAPPORT.md, index.json and the bench's page. They survive regenerations. |

## The everyday call

```
# from the repo root
node devtools/diagnostic/diagnostic.mjs --lot                      # all of vrma/'s root (~3 min)
node devtools/diagnostic/diagnostic.mjs world-walk extra/happy-5   # one clip
node devtools/diagnostic/diagnostic.mjs --rapport                  # rebuild the index alone (notes included)
```

Results are read in the test bench's **Diagnostic** tab
(`devtools/LANCER-LE-BANC.cmd`, or `node devtools/anim-lab/serve.mjs`), or
straight from `devtools/diagnostic-out/RAPPORT.md`, readable without a
browser.

Model pinned by default: **`vrm/reference.vrm`** — the project's reference, a
VRM 0.x chibi with 0.755 m hips. Put yours under that name (copy or link);
without it the tool stops and says so. See `devtools/README.md`.
Any measurement only compares against the same model — it's written on every
sheet. `--modele=<name>`: **exact** name first; an ambiguous substring is
refused with the list of candidates (a short substring used to catch another
model whose name contained it, depending on disk order).

## Pitfalls already paid for (do not reintroduce)

- Never sample at `t = duration`: `LoopRepeat` renders the first frame there.
  Everywhere: `duration − 1e-4`.
- The floor is **y = 0**, not the clip's minimum — otherwise penetration
  becomes invisible by construction. Ground contact, though, is relative
  (the lowest foot).
- A foot's height is measured on the **mesh's sole**, not the ankle bone
  (9 cm above the floor).
- An `extra/` clip's family is inferred from its **bare name** (diagnostic.mjs
  hands the judge the slug without the `extra/` prefix).
- The `vrm/` folder grows without warning (12 → 88+ models mid-project): "the
  first .vrm in the folder" is a moving target, hence the pinned model.
