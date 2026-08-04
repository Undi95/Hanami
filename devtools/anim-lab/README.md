**English** | [Français](LISEZMOI.md)

# VRM animation test bench (Hanami)

A **diagnostic** tool, shipped under `devtools/`: it writes **nothing** to the app
or its data. It reads the project's real files through a proxy.

Its main question fits in one sentence, the owner's:

> **If the animations don't join up properly (idle, anim, idle), it's out.**

The bench turns that into a number, in centimeters, and a verdict per clip —
each clip judged **against ITS OWN reference frame** (see "The acceptance rule"):
a gesture against the base it leaves and returns to by fade, a loop against its
seam, a transition at its sequence junctions. Judging a seated clip against the
**standing** base gave "fail" to 79 out of 111 clips: the measured gap was the
height of a chair, not a defect.

## Launch

1. The project server must be running (it holds the assets and the API):
   `npm run dev` at the repo root → <http://127.0.0.1:7788>.
2. Then, from the repo root:

```
node devtools/anim-lab/serve.mjs
```

On Windows, double-click **`devtools/LANCER-LE-BANC.cmd`**: the bench runs in
its own window, independent of any agent, and survives the session.

It prints the URL to open: <http://localhost:7799/> (the next port if 7799 is
taken). No npm dependency, `node:http` only.

Optional environment variables: `HANAMI_ROOT` (project root, for
`node_modules`), `HANAMI_HOST` / `HANAMI_PORT` (project server), `LAB_PORT`.

### Checking the numbers without a browser

```
node sonde.mjs                      # the .vrm rig (+ the dummy rig if reference/ is there)
node sonde.mjs --rig=vrm            # what the PAGE will display
node sonde.mjs --rig=vrm --vrm=<path.vrm>
node sonde.mjs --clips=wave,happy   # a subset
node sonde.mjs --json=output.json   # written into the bench's folder, nowhere else
node sonde.mjs --modeles=tous       # THE MATRIX clips × models (skeletons only,
                                    # no mesh: the whole loop takes minutes)
node sonde.mjs --modeles=a.vrm,b.vrm
```

`sonde.mjs` imports **`mesures.mjs`, the exact same file as the page**, and
runs it under node. If the page and the probe give different numbers, it's a
bug: they run the same code on the same files. It's the only way to check a
display you can't read back from a terminal.

Two rigs, for two questions:

| `--rig` | Skeleton | Used for |
| --- | --- | --- |
| `factice` | Mixamo rig from the conversion archives, rest hips at **1.0167 m** | comparing against `raccords.json` and `vrma/world.json`, which were measured on it — the values must land **identically**. These archives (`idle-lib.mjs`, `raccords.json`) are conversion by-products, **not shipped** with the repo: drop them in `devtools/anim-lab/reference/` (or point `HANAMI_LAB_REF` at them). Without them, the probe only runs `--rig=vrm` |
| `vrm` | humanoid skeleton from a real project `.vrm`, hand-assembled from the glTF (no mesh, no texture, so no DOM) | predicting the numbers the **page** will display |

The probe reports on its own, for every clip that deviates from
`raccords.json`, whether the file size changed (**another agent replaced the
clip**) or not (**a measurement discrepancy, to be explained**).

## Files

| File | Role |
| --- | --- |
| `serve.mjs` | server + proxy, zero dependencies |
| `mesures.mjs` | **all the computation**, shared word-for-word between the page and the probe |
| `index.html` | the page: scene, controls, display. No measurement logic |
| `sonde.mjs` | headless control |
| `verif-syntaxe.mjs` | `node verif-syntaxe.mjs`: has node parse `index.html`'s inline module, without a browser. Run after any edit to the page |
| `verif-catalogue.mjs` | `node verif-catalogue.mjs`: the **wiring**, not the clips. Does every key of `WORLD_NEEDED` (vrmStage) have files, is every key of the seated tables (`SIT_EMOTES`, `SIT_REACTIONS` from wander) declared? A dead key produces no error, just a character that does nothing — that's what left `world-walk-stop-small` dormant. It also replays the catalogue **once per face-to-face family** and proves their isolation: no file shared, no `rb-` in the live scene, and the weight of the unselected family never downloaded. Exits with code 1 at the slightest problem |
| `banc-fondus.mjs` | `node banc-fondus.mjs`: **the transition jolt**, measured. Replays `vrmStage`'s sequence (`advanceFade` then `mixer.update`, weight law `fadeWeights`) outside the browser, over every variant pair of each junction, and outputs the angular-velocity **jump** (the step between two frames — THAT'S the jolt) and the **peak**. Three sets side by side: `avant` (our old linear 0.3/0.4/0.5), `durees` (Overte's durations, still linear), `actuel` (**read from `client/src/scene/fades.ts`**: the bench can't measure anything other than the app). `--plancher` gives each clip's OWN clean jolt, the floor no fade goes below. See the "The fades" section |
| `verif-fondus.mjs` | `node verif-fondus.mjs`: the fade table **cannot drift**. Every duration in `fades.ts` is compared to the Overte state it claims in `vrma/transitions.json` (duration AND curve); fades **without** an Overte equivalent must be declared, with their reason; the mirror of `mesures.mjs` (which the page imports, without TypeScript) is compared to the table. Exits with code 1 at the slightest divergence |
| `banc-deambulation.mjs` | `node banc-deambulation.mjs [--minutes=60]`: the **living scene run under node**. `wander.ts` is pure — it's run as-is against a synthetic environment and a seeded draw. Checks the **invariants** (0 frames below the floor while standing, pelvis exactly on the seat plane while sitting), the **phase contracts** of `vrma/world.json` (no cycle entry outside contract), and outputs the **footprint** (routes, turns, sit-downs, meters, cumulative time in fade). Replayable on an older tree: `HANAMI_ROOT=<worktree>` |
| `banc-locomotion.mjs` | `node banc-locomotion.mjs`: the **COMMANDED, timed route**. Same core as `banc-deambulation` (the real `wander.ts` under node), but it's given ORDERS instead of being left to live: **click → first step** time for a 30 / 90 / 180° heading change, full-route time for 2 / 5 / 10 / 15 m in a straight line, routes **that turn** in an open room, and **multi-leg** routes in an L-shaped corridor (the only environment with an A\* itinerary). No random draw: the numbers are exact, not averaged. Replayable on an older tree: `HANAMI_ROOT=<worktree>` |
| `/diagnostic/` (URL) | biomechanical sheets + PNG plates per clip, `RAPPORT.md`, `index.json` — written by `../diagnostic/diagnostic.mjs` into `devtools/diagnostic-out/` (gitignored), served here, shown by the **Diagnostic** tab (see the dedicated section) |

### The console hook

The page exposes `window.banc` — a diagnostic bench needs to be queryable by
means other than the eye:

```js
banc.analyses.get('world-walk')   // the full object for a clip
banc.lignes()                     // the table, as exported
banc.sequences()                  // the measured junctions
banc.matrice()                    // the clips × models matrix, if the pass has run
banc.hanchesRepos(), banc.echelleWorld()
await banc.analyserTout()         // rerun the analysis from the console
await banc.passeMultiModeles()    // the multi-model pass from the console
banc.mesures                      // the ./mesures.mjs core itself
```

This is also what lets you compare the page to `node sonde.mjs` line by line.

What `serve.mjs` does:

- serves `index.html`, `mesures.mjs` and the files in the bench's folder;
- **proxies** `/api/*`, `/vrma/*`, `/vrm/*`, `/environments/*` to the project
  server, streamed, without rewriting — the bench consumes the real files, no
  copy. This is also how `world.json` and the `HEAD` requests that give each
  clip's weight get through;
- serves `three` and `@pixiv/three-vrm*` from the **project's** `node_modules`
  under `/node_modules/`, resolved by the page's `importmap` (no bundler);
- refuses path traversal, unexpected extensions, and any package other than
  `three` and `@pixiv/*`.

**No clip list is ever hardcoded anywhere.** The page and the probe read
`/api/vrm-animations` on every startup: clips can be added, replaced or
removed while the bench is running — just reload.

---

# The biomechanical diagnostic and the plates (Diagnostic tab)

The join measurements above say whether a clip **fits together**. The
**Diagnostic** tab answers the owner's other question: **is it LOGICAL, and is
it GOOD?** — and it shows it, in pictures, with no browser and no screenshot.

The page computes nothing here: it displays what the devtools wrote to disk,
in `devtools/diagnostic-out/` (served under `/diagnostic/` by `serve.mjs` like
everything else). This folder is **gitignored**: it's regenerable, and large.

## Generate / regenerate

```
# from the repo root
node devtools/diagnostic/diagnostic.mjs --lot                  # the 109 clips in vrma/  (~3 min)
node devtools/diagnostic/diagnostic.mjs world-walk             # a single clip (~2 s)
node devtools/diagnostic/diagnostic.mjs extra/happy-5          # a clip from vrma/extra/
node devtools/diagnostic/diagnostic.mjs --lot --extra=tous     # + all of vrma/extra/
node devtools/diagnostic/diagnostic.mjs --rapport              # rebuilds index.json + RAPPORT.md only
```

Options: `--modele=<name>`
(default **`vrm/reference.vrm`**, the reference model — pinned: two runs are
only comparable at equal model; **exact** name first, an ambiguous substring
is **rejected** with the list of candidates — a short substring used to catch
another model whose name contains it, depending on disk order),
`--sans-images` (sheets only, fast), `--poses=N`.

## What each output means

Per clip, in `devtools/diagnostic-out/<clip>/`:

- **`fiche.md` / `fiche.json`** — the biomechanical judge's verdict
  (`devtools/diagnostic/juge/`): criteria applicable per family (inferred from
  the NAME), measurement, range, and one sentence stating the default
  observed. Every length is in **adult-cm** (hip-height fraction × 0.93 m) to
  be comparable across models. `fiche.md` also contains the **ASCII friezes**
  of the sequence (footfalls, pelvis, knees, arm-leg opposition): the clip's
  film strip, readable in a terminal.
- **`planche-profil/face/dessus.png`** — 12 poses at a **common framing**:
  actually-deformed mesh, skeleton **blue = left / red = right**, onion skin,
  per cell: t, pelvis height, stance foot. Auto close-up on whatever moves
  (bounded: < 3 cm of amplitude → a wide shot is used and announced).
- **`traces.png`** — foot/hand/pelvis/head trajectories (vertical plane + top
  view), black squares = foot on the ground. A foot that SKATES leaves a
  straight trace on the ground; a foot that WALKS leaves an arc. The stance
  foot's ground travel is measured there: on a clip played in place, it's
  **the forward motion the engine must apply**.
- **`phase.png`** — L/R footfalls as bars, pelvis height, sole height with a
  **red zone = below ground**, max angular velocity per bone.
- The **ground is y = 0** (where the app places the character): a
  penetration is VISIBLE, a WARNING banner appears on that footfall. The sole
  is measured on the foot's **mesh**, not on the ankle bone (9 cm too high).

And at the root: **`RAPPORT.md`** (the master index: verdicts per family,
visual notes, links to every sheet and every image — it's what an agent reads
to judge the whole library) and **`index.json`** (the same inventory for the
page).

## The judge's thresholds (summary)

Universal: sole ≤ 2 cm below ground · peak velocity ≤ 800 °/s ·
shoulder/pelvis torsion ≤ 45° · knee hyperextension ≤ 10°, elbow ≤ 15° (under
45° of flexion) · knee hinge axis ≤ 30° out of plane (from 12° of flexion
onward). Walk: 0% flight · double support 10-25% · foot lift ≥ 6 cm · pelvis
4-6 cm, 2×/cycle · arm-leg opposition (correlation ≤ −0.5) · stride 0.55-0.9 ×
hip · stance knee ≤ 25°. Seated: descent 40-50% · trunk 10-30° forward · knee
85-100°. Rest: front-back foot offset ≤ 20 cm (the fighting guard) · hands ≤
30° · it breathes (chest/head/hands). Nod: correct axis, 12-40°, 2-3
back-and-forths. A clip's verdict is its **worst** criterion: "borderline" =
look at the image before deciding.

## What the diagnostic can NOT judge

- **The gesticulation of a talking idle**: the expressive variants
  (`idle-talking-5/6/7`, raised hands) get flagged "dangling-arms defect" even
  though that's their style — read the visual note and the image, not the
  verdict alone.
- **Lateral foot spread** depends on the model's pelvis (32 cm on the
  reference model's chibi proportions, hips 0.755 m): read it as "high
  borderline", never "firm defect".
- **The true rotation of turns** (a closed cycle, see below), **the clean
  ranges** for running/strafing/stepping/held gestures (universal criteria
  only — the sheet says so explicitly), **the face and the gaze**, **the
  aesthetics** (it says plausible, not pretty).
- A verdict **doesn't transfer from one model to another**: the committed
  batch is measured on the reference model (`vrm/reference.vrm`); to compare
  before/after a touch-up, keep the same model.

On the page: the **Diagnostic** tab shows all of this for the selected clip
(verdict, sentences, visual note, the five clickable images, the criteria in
detail). If a clip has no folder, the tab gives the exact command to run.

---

# The acceptance rule

## What we measure, and why

In the app, a gesture is brought in from the base by a **0.3 s** crossfade
(`GESTURE_FADE`), then brought back to the base by a **0.4 s** fade
(`GESTURE_RETURN`) — constants read from `client/src/scene/vrmStage.ts` and
copied into `mesures.mjs`.

What the eye calls an "abrupt stop" is therefore not *in* the clip: it's the
gap between its endpoints and the base pose, which the player has to cross in
a **fixed** time. Large gap ÷ fixed time = high, artificial velocity.

A clip "fits together" if its **first** and **last** frame are close to the
base pose.

| Gap | Verdict | Reading |
| --- | --- | --- |
| ≤ 2 cm | **excellent** | invisible |
| ≤ 7 cm | **pass** | visible up close, acceptable |
| ≤ 10 cm | **borderline** | at the edge: check by eye, at 0.25× |
| **> 10 cm** | **FAIL** | the clip doesn't fit together — the threshold set by the owner |

## The reference frame: what EACH clip is judged AGAINST

This is the "**judged against**" column of the table, and the logic lives in
`referentielDe()` (`mesures.mjs`, so shared with the probe):

| Clip | Judged against | Why |
| --- | --- | --- |
| face-to-face gesture | `idle` **and** `idle-talking` (in + out, worst of the four) | it doesn't know which base it'll return to — while a reply is being written, `idle-talking` is running |
| clip from the **Rocketbox** family (`rb-…`) | `rb-idle` **and** `rb-idle-talking` | face-to-face has two WATERTIGHT families (see `vrma/README.md`): an `rb-` clip is never faded to an Overte base, and judging it against one would measure the distance between two studios — 16.5 to 20.3 cm — not a defect. Same mistake as "seated clip against a standing base" |
| **seated** gesture or loop (`world-sit-*`) | the **`world-sit-idle`** base | that's what it leaves from and returns to, by fade — the standing base is at ~45 cm BY CONSTRUCTION (the height of a chair) |
| a **loop** that cycles (gaits, turns — seated included —, alternating rest poses, held gestures, `world-sit-idle` itself) | its **SEAM**: pose gap last ↔ first frame (strict thresholds 0.5 / 2 / 4 cm: it's crossed in ONE frame, not a fade) **and** the velocity jump compared to the clip's p95 | no phase of a cycle resembles a base; what the eye can see there is the seam |
| **transition** (`walk-start`, `walk-stop*`, `sit-enter/exit`, `*-in/out`, `idle-alt*-enter/exit`, `sit-turn-*-end`) | its sequence **JUNCTIONS**: last frame of the upstream clip ↔ its first, its last ↔ first frame of the downstream clip (`enchaine` from `world.json`) | that's exactly the sequence `wander.ts` will run |

**Phase contracts.** When `world.json` declares `phaseSortieCibleS` /
`phaseEntreeCibleS` (the stop leaves `world-walk` on its seam, `world-walk`
resumes at t = 0.200 s after `walk-start` — and `wander.ts` sticks to it), the
junction is measured **at that specific phase**, not the worst of the cycle:
judging a different phase means judging a sequence the code never actually
runs. With no contract declared, an upstream cycle is left at an arbitrary
phase → the **worst** case is judged, and the sheet gives the average and
best case too.

The verdict figure is in **centimeters**: the distance traveled by the most
affected bone, in world position. Degrees say *which* bone; centimeters say
*whether it shows*. A wrist at 40° goes unnoticed; a foot at 40 cm doesn't.

## Where it's displayed

- **card at the top of the scene**: the verdict, large, with both gaps and the
  simulated fade (visible on the *Clips* and *Environments* tabs — see "The
  rest of the page");
- **left-edge stripe on every clip** in the grid, with `in / out` in cm;
- **Joins tab**: the full detail for the current clip;
- **VERDICT column** in the table, sortable, and exported as TSV.

Clicking a clip analyzes it right away. The **"Analyze joins"** button does
them all (a few dozen seconds, no playback needed).

## The protocol, in detail

Carried over from `../mesure-raccords.mjs`, proven on 43 clips.

- **Reference base pose = AVERAGE pose over one loop cycle.** A gesture fires
  at an arbitrary instant of the base's cycle, which keeps running: the
  fade's starting pose is therefore drawn uniformly over the cycle, and its
  average is the expectation. The base's **spread** around its average is
  written to the log (≈ 4° at the worst bone for `idle`, ≈ 19° for
  `idle-talking`), and the Joins sheet gives the **range** of the gap
  depending on phase.
- **A bone the base doesn't animate** has the rig's **rest pose** as its
  reference, not the average of something else: it's the value
  `PropertyMixer` restores once the binding's weight drops to zero. The page
  captures this rest pose right after setting `REST_POSE_Z` and **before**
  creating a single action — so identically to what the player will do.
  `idle` only animates 20 of 54 bones.
- **The last frame is sampled at `duration − 1e-4`, never at `duration`.**
  `LoopRepeat` loops back exactly at `duration` and returns the **first**
  frame: the exit gap would come out falsely zero. It's the costliest trap in
  this whole subject.
- **Simulation of the real fade**: a real `AnimationMixer`, `vrmStage`'s real
  weights (sum = 1 by construction), `LoopOnce` + `clampWhenFinished` on the
  gesture, the return fade triggered by the `finished` event. From this we
  extract the **peak angular velocity during each fade**, compared to the
  peak during the clip.
  - It's compared to the clip's **95th percentile**, not its maximum: a
    single frame clipped at 1000 °/s would be enough to skew the ratio.
  - **`fade/clip > 1` = the transition is more violent than the animation.**
    The eye reads it as a jerk. It's a measurable defect, not an impression.
  - The sheet also gives a **cross-check**: the actual path of the worst bone
    between the fade's first and last frame, measured on the simulation
    through a path fully independent of the static calculation. The two must
    agree to within a few percent.

## Sequences

**Sequences** tab. Two sequences, the ones the app actually runs:

```
world-walk-start → world-walk → world-walk-stop → idle
idle → world-sit-enter → world-sit-idle → world-sit-exit → idle
```

The gap is measured at every **junction**: last frame of the outgoing clip
against first frame of the incoming clip, same thresholds, same verdict.

If the outgoing clip **loops with no phase contract**, its "last frame" means
nothing: it will be left at an arbitrary phase. The whole cycle is then
sampled and the **worst** case is judged — that's what will decide the
scene's credibility, not the average. The sheet still gives the average and
best case, and the instant of the worst one. When `world.json` declares a
**phase contract** (`phaseSortieCibleS` / `phaseEntreeCibleS`), the junction
is measured at that exact phase — that's the sequence `wander.ts` actually
runs.

The **play on loop** button really chains the clips, with the app's fades, to
judge by eye. Looping clips are held for only a few seconds: enough to be
left at an arbitrary phase, not enough to make the sequence endless.

## The multi-model pass (Multi-models tab)

The answer to "**great, but for every size and shape**": the **"multi-model
pass"** button (Clips tab) reloads **every `.vrm` in `vrm/`** — the previous
one is **disposed** (`deepDispose`) before the next, memory stays flat — and
replays the full analysis, each clip against its own reference frame.

It outputs the **clips × models matrix**: one row per clip (worst first), one
column per model (size and hips in the header tooltip), the verdict and the
gap in cm in every cell, and a "everywhere?" column — *passes everywhere*, or
*fails on n/N* with the offending models. Copyable as TSV. Simulated fades
and cycle-level quantities are skipped during this pass (the verdict doesn't
depend on them; dozens of models × dozens of fades would take hours); the
pass downloads every model, budget a few minutes. At the end, the page
reloads the starting model.

The headless counterpart is `node sonde.mjs --modeles=tous`: skeletons
assembled from the glTF with no mesh or texture, same calls, same numbers, in
minutes.

**Reading the matrix without being misled by model size.** The thresholds
are in ABSOLUTE cm (the owner's contract, measured on the reference rig); yet
the same angular clip defect measures 4 cm on a 0.33 m chibi and 14 cm on a
1.25 m giant — across 94 models, r(arm, failure count) = 0.83: the "fails on
n/N" column is partly counting body types, not defects. The matrix therefore
ALSO shows the same gap in **adult-cm** (gap × 0.93/hips, the biomechanical
judge's convention): median per row in the "everywhere?" column (`≈n ad`),
per-cell detail in the tooltip and in the TSV. A clip defect there stays
nearly constant from one body type to another — "fails on 65/94" then reads
as ONE defect, not 65. **No verdict depends on this**: the tiebreaker stays
the gap in real cm, thresholds 2/7/10.

**Anthropometric OUTLIER models** — to be read as body types, not as clip
defects (inventory from the 94-model pass, 2026-08-01):

| model | hips | quirk |
| --- | --- | --- |
| modele-01 | 0.328 m | chibi: the judge flags foot spread as a "defect" (up to 37 adult-cm) — it's just its pelvis |
| modele-02 (non-humanoid mascot) | 0.547 m | mascot rig: **no `neck` bone**, legs 0.68 × hips — crosses its own torso while running, knee hinge up to 50° |
| modele-03 | 0.628 m | child proportions, legs 0.82 × hips |

The judge's anthropometric ranges (spread, step height…) don't apply to
them; their "defect" cells on THESE criteria call for no fix. Inventory of
optional bones across the 94 models, for the record: `leftEye`/`rightEye`,
`toes` and `shoulders` present on EVERYONE (eye+head gaze has its bones on
every body type); `upperChest` missing on only 3 models (the upperChest
tracks don't bind there, near-invisible loss of torso suppleness); `neck`
missing on just one, the mascot (modele-02).

---

# The two domains

The library splits into two domains, and **the name prefix is enough to tell
them apart** (see `vrma/README.md`):

- **face-to-face** (no prefix): the avatar standing in front of the user,
  talking — rest poses and gestures;
- **3D world** (`world-` prefix): the interactive scene — gaits, turns,
  seated postures, jump.

The grid splits them into two groups, each with its **total weight**, read
via a `HEAD` request on every file (zero bytes downloaded). Lazy-loading the
`world-` domain is a deliberate optimization: in conversation mode, those
megabytes have no reason to be downloaded. Showing the number is how it stays
defended. A selector lets you display just one domain.

## `world.json`, and its verification

**3D World** tab. For a `world-` clip, the bench shows what
`vrma/world.json` claims, what it measures itself, and **checks the two
against each other**.

**Scaling.** The values in `world.json` are measured on a rig whose rest
hips sit at **1.0167 m**. The bench shows the factor `hanchesDuVRM / 1.0167`
at the top of the tab and in the log.

- **Meters** and **m/s** are compared to `announced × factor`.
- **Fractions** (pelvis height) are compared **as-is**: that's their whole
  point, they carry over from one model to another.

**Gait speed.** The clip is played in place: the hips don't move, it's the
stance foot that slides backward, and that backward slide *is* the forward
motion the code will have to apply. The bench gives it as a **range**, not a
single number:

- *prudent* (conservative) — only counts the backward slide of the stance
  foot, the interval assigned to whichever foot was in stance at its start.
  Slightly underestimates;
- *large* (loose) — every backward slide of every foot over the cycle.
  Slightly overestimates (a foot can slide backward while airborne).

The truth is in between; showing both avoids passing off a measurement
convention as a property of the clip. Agreement is declared if the announced
value falls within the range, within 10%.

The **direction** of the gait (forward / backward) comes from neither:
*large* only sums positive backward slides, it has no sign of its own. It's
measured separately, over the same intervals **weighted by how low the
stance foot is** — 1 at the cycle's lowest point, 0 at the highest, so that
an airborne frame counts for nothing. *large* used to borrow *prudent*'s
sign, which held up as long as *prudent* stayed far from zero; on a run it
falls to numerical residue (`world-run-back`: −0.006 m on the measurement
rig, +0.0006 m on another) and would flip the whole range, and therefore the
agreement verdict, **depending on which model was loaded**. A disagreement
that changes with the model is an instrument defect, not a file defect.

The bench also checks `world.json`'s **internal consistency**:
`distanceParCycleM ÷ dureeS` must reproduce `vitesseMS`. And the **file
size**: if it no longer matches, the clip has been replaced since
`world.json` was written.

---

# The three live measurements

They haven't changed, and are only filled in after **"+ live pass"** (3 s per
clip, once). All three are recomputed every frame and keep their
**maximum**. They're taken **after** `mixer.update()` and `vrm.update(delta)`,
so on the pose actually displayed. The comparison baseline is the clip's
first frame (in "from idle" mode, the end of the entry fade).

### 1. Foot sliding — "the feet are skating"

**Horizontal** (X/Z) displacement of each foot relative to its position at
the clip's start. **Raw** `leftFoot` / `rightFoot` bones. In the scene: the
ring on the ground marks the starting position and **its radius is the 3 cm
threshold**; the dot of the same color follows the foot.

| Value | Reading |
| --- | --- |
| < 3 cm | normal (a stance foot always moves a little) |
| 3 to 8 cm | **worth a look** — visible sliding on a clip meant to stay in place |
| > 8 cm | **defect** — the foot sweeps the ground |

Two complements: **hip drift** (past 5 cm over 3 s, the character is leaving
its spot) and the **lowest foot** (negative past −1 cm = ground
penetration).

Warning: clips marked `†` are **movement clips** (gaits, turns, jump, starts
and stops): a large foot amplitude there is normal, the table doesn't color
them. For those the question is reversed — *does the planted foot stay put
during its stance phase?* That's judged by eye, at 0.25×, from the top view.

### 2. Orientation — torso yaw relative to the camera axis

Angle between the **character's front** and the world's **+Z** (the axis
where the app places its camera). The front is derived from **geometry** —
left shoulder → right shoulder vector, then cross product with vertical —
not from the pelvis quaternion: a VRM 0.x carries its pelvis reversed, and a
global model rotation changes nothing about that since it rotates the feet
too. `mesures.mjs` uses the same front for gait speeds: both talk about the
same "front".

| Max value | Reading |
| --- | --- |
| < 15° | normal |
| 15 to 30° | **worth a look** — the face starts leaving the camera |
| > 30° | **defect** — the clip turns its back on the other party |

### 3. Max angular velocity by bone group

**Local** rotation speed of every bone, in degrees per second, expressed in
**clip** time — slowing playback down doesn't change the numbers. Grouped
into *legs*, *arms*, *hands*, *head*. The overall peak is shown along with
the bone's name.

| Max value | Reading |
| --- | --- |
| < 500 °/s | plausible, even for a brisk gesture |
| 500 to 1000 °/s | **worth a look** — very sharp motion, often a botched interpolation |
| > 1000 °/s | **defect** — almost certainly a quaternion flip |

Reference point: a fast human gesture caps out around 300-500 °/s. A wrist
at 1500 °/s doesn't read as motion, it reads as a flicker.

The frame right after a loop restart is ignored (the end → start jump would
produce an artificial spike). That's also why **the live pass plays clips
without a fade**: a crossfade would throw off all three measurements. The
"from idle" checkbox is there to judge the transitions by eye, not to
measure.

---

# The rest of the page

- **Scene** carried over from `client/src/scene/vrmStage.ts`: 30° optics, 2.2
  directional key light (0.3 / 1.6 / 1.2) + 0.6 hemispherical fill, lighting
  regime lowered (1.1 / 0.35) as soon as an environment is loaded, `VRMUtils`
  (`removeUnnecessaryVertices`, `combineSkeletons`, `rotateVRM0`,
  `deepDispose`), anti-T-pose rest pose, scale normalization outside
  [0.5 ; 3] m.
- **Framings**: *full body* (default — everything happens at the feet),
  *bust* (exact copy of `frameCamera`), *whole room*. *Front* / *side* /
  *top* buttons, and click-drag to orbit.
- **Environments tab**: loads a `.glb`, applies the `<environment>.json`
  sidecar (`scale`, `rotationY` in **degrees**, `spawn`, `exposure`) if it
  exists — its absence is the normal case — then shows the room's measured
  dimensions, the ratio to the character's size, and foot height. The
  **room height / character height** ratio should land between ~2 and ~2.5.
  As soon as `scale` is present, automatic adjustment is **disabled** (that's
  the author's word), even if the value is absurd. `rotationY` is read in
  **degrees**: a value in radians (π, 1.5708…) barely rotates anything.
- **Table tab**: every quantity, sortable by clicking a header, copyable as
  TSV, clickable to replay a clip. The **widen** button gives the table the
  width it deserves (about thirty columns).
- **The result comes to you.** During both the *join analysis* and the *live
  pass*, a progress banner (`n/total` + gauge) sits at the top of whichever
  tab you're on, and **follows you** if you switch tabs. At the end, the
  page **switches to the Table tab** and places a green "Analysis complete —
  N clips" banner above the table, with the verdict breakdown. Exception: if
  you switched tabs **yourself** during the analysis (or stopped it), you
  don't get teleported — the banner shows wherever you are, with a *see the
  table →* button. The × closes it.
- **The measurement cards belong to the scene view.** They're visible on
  *Clips* and *Environments*, **cleared** on *Table*, *Joins*, *3D World*,
  *Sequences* and *Diagnostic*: those tabs fill the screen with data, a
  semi-transparent overlay there would only hide what you came to read. They
  never spill over the right-hand column, even in *widen* mode (they shrink
  instead), and in a **narrow window** (< 900 px, the width of a preview
  pane) the whole page reflows into a column: scene on top, measurement
  cards in a strip **below** the scene, tabs and panels below that.
- **Log** at the bottom of the scene: every exception, every `console.warn`
  / `console.error`, with a red counter in the header. If the page looks
  empty, that's the first place to check. Opened **via the button**, it
  shows on any tab; opened on its own by an error, it stays hidden on the
  data tabs — the header's red counter is what warns you.

---

# What the bench can NOT judge

- **The true rotation of a turn.** `world-turn-left` / `world-turn-right` are
  cycles played in place and **closed**: after one turn, every bone is back
  to its starting value, so the rotation is no longer in the file — it
  exists only in the metadata. The bench looks for it in the stance foot's
  heading, but the ankle rotates actively too and nothing separates the
  two: it finds ~78° where `world.json` announces 53.2°. The number is
  shown as **informational** and filed under *pending*, not *disagreement*.
  The bench can't settle it.
- **Gait speed to the percent.** See the prudent/large range: the gap
  between the two conventions runs 5 to 20% depending on the clip.
- The app's **procedural idle** (breathing, blinking, head sway,
  `IdleAnimator`) is not applied: it would add permanent noise. The bench
  judges the clip, not the clip + the idle.
- **Facial expressions and lipsync** are not driven.
- **Likability.** A clip can pass every threshold and still look bad, or
  fail and still be the best candidate available. The verdict sorts; it
  doesn't decide alone.
- **A verdict doesn't transfer from one model to another.** Centimeters
  depend on the rig's proportions: the same clip gives 48.7 cm on the
  measurement rig (hips 1.0167 m) and 45.7 cm on a model at 0.9748 m.
  Switching models voids the whole analysis, on purpose. Compare clips
  against each other on the same model, never across models.
- **What happens between two frames of the file.** Everything is sampled at
  30 fps, the source keyframe grid.
- A **hidden tab** pauses rendering (rAF): a *live pass* running there gets
  interrupted. *Join analysis*, on the other hand, doesn't depend on it and
  runs to completion.

## The fades — Overte's table, and what it changed

Our fades used to be **uniform** (0.3 / 0.4 / 0.5 s, linear), while
`vrma/transitions.json` gives a duration **per transition** — the
`interpDuration` of each of the 165 states in Overte's state machine, in
frames at 30 fps — and its curve. The mapping table lives in
`client/src/scene/fades.ts`; `verif-fondus.mjs` compares it line by line to
the graph, `banc-fondus.mjs` measures it.

Two families stand out from the graph, and they don't look alike:
**expression** (rest, talking, gestures, turns, stops, sitting) is **long
and eased** (`easeInOutQuad`); **locomotion** (entering a walk cycle) is
**short and linear** — Overte set no `easingType` on `WALKFWD` or on
`idleToWalkFwd`, and the measurement proves it right.

`easeInOutQuad` starts and ends at zero velocity: that's what removes the
step in angular velocity at the start and end of the fade. In exchange its
slope peaks at 2/T instead of 1/T — hence Overte's longer durations: at
~1.7× duration, the peak stays the same and the step disappears.

### Reference — `node banc-fondus.mjs`, average rig (hips 0.9045 m, VRM 0.x)

`jump` = the biggest angular-velocity step between two frames (°/s, worst
bone, across every variant pair); in parentheses, the average over the
pairs; then the peak.

| junction | fade | before | Overte's durations, linear | current (durations + curve) |
| --- | --- | --- | --- | --- |
| idle → idle-talking | `BASE_SWAP` 0.833~ | 217 (151) / 411 | 125 (99) / 402 | **114 (66) / 411** |
| idle-talking → idle | `BASE_SWAP` 0.833~ | 210 (167) / 376 | 151 (111) / 388 | **103 (50) / 419** |
| rb-idle → rb-listen | `BASE_SWAP` 0.833~ | 100 (60) / 283 | 113 (54) / 283 | **88 (36) / 283** |
| idle → gesture | `GESTURE_IN` 0.6~ | 744 (215) / 765 | 540 (164) / 765 | **595 (146) / 765** |
| gesture → idle | `GESTURE_OUT` 0.833~ | 95 (53) / 95 | 45 (25) / 48 | **12 (10) / 88** |
| idle → turn | `TURN_IN` 0.5~ | 110 (107) / 172 | 95 (85) / 160 | **95 (85) / 160** |
| turn → idle | `TURN_OUT` 0.667~ | 59 (55) / 155 | 44 (43) / 152 | **46 (36) / 160** |
| idle → walk-start | `WALK_START_IN` 0.267 | 347 (347) / 350 | 351 (351) / 353 | **351 (351) / 353** |
| turn → walk-start | `TURN_OUT` 0.667~ | 265 (260) / 292 | 190 (188) / 219 | **218 (214) / 252** |
| idle → walk-slow | `WALK_CYCLE_IN` 0.5 | 140 (140) / 176 | 112 (112) / 152 | **112 (112) / 152** |
| walk → stop | `STOP_IN` 0.5~ | 127 (126) / 279 | 116 (114) / 269 | **108 (100) / 250** |
| walk-slow → stop | `STOP_IN` 0.5~ | 182 (170) / 203 | 126 (117) / 169 | **65 (60) / 249** |
| walk → short stop | `STOP_SMALL_IN` 0.333~ | 126 (126) / 279 | 129 (129) / 281 | **96 (96) / 252** |
| stop → idle | `STOP_OUT` 0.667~ | 190 (110) / 190 | 57 (34) / 57 | **14 (9) / 111** |
| idle → sit-enter | `SIT_IN` 0.5~ | 289 (289) / 402 | 180 (180) / 402 | **180 (180) / 402** |
| sit-enter → sit-idle | `SIT_LAND` 1~ | 92 (41) / 92 | 92 (41) / 92 | **14 (9) / 181** |
| sit-idle → sit-talking | `SIT_TALK` 0.833~ | 281 (186) / 721 | 281 (182) / 721 | **281 (116) / 721** |
| sit-idle → seated gesture | `SIT_GESTURE_IN` 0.4~ | 538 (248) / 797 | 538 (248) / 797 | **538 (216) / 831** |
| seated gesture → sit-idle | `SIT_GESTURE_OUT` 0.833~ | 230 (102) / 231 | 110 (49) / 112 | **9 (9) / 216** |
| sit-idle → sit-exit | `SIT_IN` 0.5~ | 381 (294) / 585 | 272 (272) / 508 | **272 (272) / 580** |
| sit-exit → idle | `STOP_OUT` 0.667~ | 495 (453) / 495 | 148 (136) / 149 | **15 (14) / 290** |

`~` = eased fade. A `jump` that doesn't move is a **floor**: the clip's own
inherent jolt, which `--plancher` measures separately (`happy-6` 744 °/s,
`world-sit-clap` 623, `world-walk-start` 351, `world-sit-talking` 281,
`world-sit-exit` 272). No fade goes below it — it's then the average over
the pairs that tells what was actually gained.

The only two **peaks** that rise noticeably are `sit-enter → sit-idle` (92 →
181) and `walk-slow → stop` (203 → 249): these are bodies landing or
slowing down, where the curve replaces a constant velocity framed by two
steps with a smooth rise and fall.

### Does a gesture still respond quickly?

A gesture's entry fade has doubled (0.3 s linear → 0.6 s eased). What
hasn't changed: **facial expression** starts right at the tag (`setEmotion`
is written before `playGesture`), and the gesture clip starts at frame 0
regardless — the fade only governs its weight ramp-up, exactly like Overte
(`interpTarget` = 18: the target is read live during the fade).

What it costs, measured over the twenty face-to-face gestures — the instant
the BODY diverged by N degrees from what the base alone would have given
(worst major bone, averaged over the gestures):

| gap | before (0.3 linear) | current (0.6 eased) |
| --- | --- | --- |
| 2° — the first flicker | 65 ms | 141 ms |
| 5° — it's visible | 110 ms | 201 ms |
| 10° — it's a gesture | 231 ms | 249 ms |

The start is softer by about 80 ms; by the instant the motion reads as a
gesture, the gap is back down to 18 ms. That's the price, and it's small.

### Reference — `node banc-deambulation.mjs --minutes=60`, seed 12345

The behavioral footprint **doesn't move**: fades don't drive the state
machine, clip durations and phases do.

| | before | current |
| --- | --- | --- |
| frames below ground (standing) | 0 | 0 |
| pelvis off the seat plane (sitting) | 0 | 0 |
| cycle entries outside phase contract | 0 | 0 |
| time standing / sitting | 82.2% / 17.8% | 82.2% / 17.8% |
| distance traveled | 56.1 m | 56.1 m |
| bases landed · transitions | 116 · 51 | 116 · 51 |
| cumulative time in fade | 79.0 s (2.2%) | **125.9 s (3.5%)** |
| eased fades | 0 / 167 | **161 / 167** |

And `node sonde.mjs --sequences` returns exactly the same junctions as
before — `verdicts: pass 96 · borderline 3 · excellent 52`, both the "walk"
and "sit" sequences *excellent*: the phase contracts weren't touched, and
that was the point.
