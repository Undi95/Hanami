**English** | [Français](LISEZMOI.md)

# The biomechanical judge

**Does it look like a human being?** — with the numbers that justify the
answer.

The measurements that already existed (`devtools/anim-lab/mesures.mjs`) say
whether a clip **joins up**: pose gap at the seam, loop quality, speed at the
splice. They can't tell that a base pose is a fighting stance, that an arm
swings in phase with its own-side leg, or that the feet are buried 6 cm into
the floor. That's the gap this tool fills.

It runs **in pure Node, no browser**: it builds a real `.vrm`'s humanoid
skeleton by hand from the glTF (no mesh, no textures, no DOM), replays the
clip through the interpolants, and reads the body frame by frame the way a
physiotherapist would watching a video.

**No npm dependency added.** `three` and `@pixiv/three-vrm*` are taken from
the project's `node_modules`. Read-only on the repo; the tool only writes to
`devtools/diagnostic-out/` (gitignored), and only when asked (`--json`).

---

## How to call it

From the repo root (the judge finds `vrm/`, `vrma/` and `node_modules/` on
its own from there).

```bash
JUGE="devtools/diagnostic/juge/juge.mjs"

node "$JUGE" world-walk                 # one clip's diagnostic sheet
node "$JUGE" world-walk --frises        # + the clip's timeline as ASCII friezes
node "$JUGE" idle nod shake             # several sheets in a row
node "$JUGE" --lot                      # all 32 clips, table + grouped defects
node "$JUGE" --lot --tout               # same, with every diagnostic sentence
node "$JUGE" --comparer a b             # the same criterion on two clips (before / after a fix)
node "$JUGE" world-walk --tousvrm       # the same clip on every .vrm in the project
node "$JUGE" world-walk --vrm=Cynthia   # on a specific model (⚠ see the warning below)
node "$JUGE" --lot --json=x.json        # machine-readable output
```

`--tousvrm` answers **the** question that comes up as soon as a criterion
fails: *is it the clip, or the rig?* It replays the clip on every `.vrm` in
the folder and marks each criterion "stable verdict" or "VARIABLE verdict
depending on the model". A defect that holds across every model is a defect
of the clip.

⚠ **The default model used to be a moving target — it no longer is.** The
tool used to take the FIRST `.vrm` in the folder in alphabetical order, and
the folder is alive: it went from 12 to 88 models WHILE the project was in
progress, and a model whose name sorted earlier changed the default from
under us, shifting every adult-equivalent centimetre from one run to the next
(27.8 → 30.4 cm of spread for the same `idle`). Nothing was wrong — every
sheet prints its model, the JSON records it in `meta.rig` — but **two runs
only compare with the same model**. The default is therefore now a fixed
NAME, `vrm/reference.vrm`, which disk order can no longer move: it's the
project's reference, the one behind the results committed here (see
`devtools/README.md`).

## The output

For each clip: the applicable criteria (inferred from the family, itself
inferred from the file's **name** — the project's convention, see
`vrma/README.md`), the measurement, the expected range, a verdict per
criterion, an overall verdict, then — this is the deliverable — **one
sentence in French per observed defect**, phrased the way a human would say
it looking at the screen:

> ✗ le pied ne se lève que de 2,2 cm sur tout le cycle : il ne décolle pas du
> sol, elle patine plus qu'elle ne marche.
>
> *(✗ the foot only lifts 2.2 cm over the whole cycle: it never leaves the
> ground, she's skating more than walking.)*

Friezes (`--frises`) render the timeline readable in a terminal: foot
contacts, pelvis height, knees, arm and leg advance (`▀` front / `▄` back —
arm-leg opposition reads at a glance), torso twist, head movements.

---

## The criteria

### Universal — true for any clip

| criterion | expected | why |
|---|---|---|
| torso twist (shoulders / pelvis, top view) | ≤ 45° | **the criterion that forbids gluing the top of one animation onto the bottom of another** |
| knee hyperextension | ≤ 10° past the straightened position | a knee doesn't bend backwards |
| knee flexion axis | ≤ 30° out of the leg's plane | a knee is a hinge, not a ball joint |
| elbow flexion / hyperextension | ≤ 155°, ≤ 15° | same reasoning |
| peak angular speed | ≤ 800 °/s | beyond that, it's a jolt, not a gesture |
| sole penetration | ≤ 2 cm (sole thickness) | feet don't sink into the floor |
| minimal ground contact | ≈ 0 cm | nor do they float above it |
| limb crossing the torso | ≤ 45% penetration | an arm resting against the body grazes it: that's normal |

### Walking (`world-walk`, `-slow`, `-fast`, `-back`)

Always one foot on the ground (0% flight) · double support 10–20% of the
cycle, **modulated by the gait** · swing-foot lift ≥ 6 cm · cycle symmetry
(left leg at *t* vs right leg at *t*+T/2) ≤ 12% · equal support times ≤ 8% ·
vertical pelvis oscillation 4–6 cm, **twice per cycle** · lateral oscillation
3–5 cm, once per cycle · **arm/leg opposition** (strongly negative
correlation between left knee × left hand) · stride length 0.55–0.9 × hip
height · supporting knee nearly straight at the vertical pass (≤ 25°) ·
heel-first landing.

### Sitting (`world-sit-enter`, `-exit`, `-idle`, …)

Pelvis drop 40–50% of standing hip height · torso lean forward 10–30° during
the descent (a body descending vertically falls backward) · monotonic descent
(the pelvis doesn't rise back up) · knee at 85–100° once seated · hands don't
cross through the thighs.

### Standing rest (`idle`, `idle-talking`)

Feet side by side (front-back offset ≤ 20 cm — **beyond that it's a stance,
not a rest**) · lateral spread 10–25 cm · open hands (finger joints ≤ 30°) ·
arms hanging · **breathing** (pelvis ≤ 2 cm, and visible life somewhere: torso
≥ 1° or head ≥ 2° or hands ≥ 0.4 cm) · torso facing forward.

### Head gestures and greeting

Nodding around the **lateral** axis, shaking around the **vertical** axis,
12–40° peak to peak, 2 to 3 back-and-forths, without the torso following.
Wave: hand clearly above the shoulders, elbow at 60–110°, 1.2–3.5
back-and-forths per second, the other arm at rest.

---

## The two ideas holding it all up

**1. Every length is a fraction of hip height.** "The pelvis oscillates by
5 cm" means nothing on a 1.20 m avatar. We measure in metres on the model,
divide by its hip height, and compare to the fraction of an adult whose hip
is at **0.93 m** (≈ 0.53 × 1.75 m, the usual anthropometric proportion). Every
centimetre shown is an **adult-equivalent centimetre**. Proof it works:
`world-sit-enter` renders "pelvis drop = 45.45%" to the second decimal across
12 models, whose hips range from 0.755 m to 1.201 m.

**2. Body axes come from geometry, never from a quaternion.** The pelvis's
local +Z doesn't point forward the same way from one rig to the next.
`up × (left shoulder → right shoulder)` is independent of the VRM version and
of axis conventions.

---

## What had to be fixed along the way

These pitfalls are documented in the code, right where they bite. They're
worth knowing: all of them produced numbers that were **credible and wrong**.

- **The shoulder is `upperArm`, not `shoulder`.** In a VRM, `shoulder` is the
  clavicle's root, glued to the spine: on the reference model (0.755 m chibi)
  the two `shoulder` nodes are only **4 cm** apart. All torso-twist
  measurements would have rested on noise.
- **The floor isn't the lowest bone.** The ankle sits 9.4 cm above the floor
  and the toe bone 3.5 cm. Measuring foot height on the bones made a
  heel-planted foot "float" by 9 cm, and made heel-strike undetectable. The
  **heel** and the **toe** are now anchored, once and for all, at floor level
  in the foot's own frame, and then follow the foot's rotation.
- **The normalized bones' frame doesn't point forward.** A VRM 0.x looks down
  −Z in its own space; the π rotation the app applies to the scene carries the
  normalized bones with it. Trusting the convention, the judge reported, for
  every elbow, a hyperextension **exactly equal to its flexion**. Direction is
  now measured at rest, never assumed.
- **"The support foot moves backward" is wrong in reverse walking.** The
  signed-contact detector returned **81% flight phase** on
  `world-walk-back`. Contact drift is now estimated from the clip itself, and
  the walking direction settled by physics: both hypotheses are tried and the
  one that keeps a foot down is kept. A genuine run would keep flight time
  under both hypotheses, so it stays detectable.
- **Height alone doesn't say which foot is bearing weight.** In
  `world-walk-slow` both feet stay within 2.5 cm of the floor at all times:
  height discriminates nothing. Hence the **swing-foot lift** criterion, born
  from debugging.
- **The knee's hinge refers to the thigh, not the pelvis or the foot.** The
  pelvis is wrong as soon as the leg rotates under the body (both pivots were
  wrongly accused); the foot degenerates when the toe drops (a spike to 83°
  mid-swing). The thigh's normalized-node frame rotates with the leg and is
  defined by the format.
- **A torso sized on adult anthropometry swallows the arms.** In these `.vrm`
  files the `upperArm` bones sit close to the spine: the judge cried "the arm
  crosses the torso" on an arm hanging normally. The torso is sized on the
  model itself, and the arm — rooted at the shoulder, it runs along the torso
  by construction — is excluded from the test.
- **Counting crossings of the mean lies both ways.** `shake` does one clean
  right-left sweep that never crossed back over the threshold on return:
  counted as **zero** oscillations. Alternating excursions with a dead band
  are now counted instead.
- **A walking range depends on the gait.** Judging `world-walk-slow` against a
  normal walk's double-support range condemns it for being slow.
- **In reverse walking, you land on the front of the foot.** The heel-strike
  criterion is declared not-applicable rather than punishing correct
  biomechanics.
- **A wave isn't "a hand above the shoulders".** `happy` used to trigger it,
  even though the hand only rises 5 cm there: a joyful arms-raised gesture,
  not a hello. And back-and-forths are counted in **cadence**, otherwise you
  punish the clip's duration rather than the gesture.
- **Breathing doesn't raise the pelvis.** Overte's idle bases breathe like a
  standing human: still pelvis (0.06 cm), torso swaying 2.9°, head 3.9°.
  Judging life on pelvis height alone declared a living clip dead — the
  criterion now also listens to the torso, head and hands, and only
  complains if EVERYTHING is frozen.
- **A nearly straight leg has no flexion plane.** Under ~12° of flexion,
  thigh and shin are aligned and the axis of their cross product is noise:
  hinge deviation is no longer measured there. Checked against the turns:
  their real deviations (58°!) hold at ≥ 17° of flexion, the guard hides
  nothing real.

## What the tool can't judge

- **The wave**: none of the 32 clips satisfies the detection conditions (hand
  ≥ 10 cm above the shoulders, ≥ 0.4 s, lateral sweep ≥ 10 cm). The criteria
  are written and active, but **have never been proven against real data**.
  The closest clip is `happy` (5.4 cm).
- **Elbow hyperextension is only judged below 45° of flexion.** Beyond that,
  humeral twist flips the reference's sign: an arm raised horizontally, a
  normal hand-raise (`world-sit-raise-hand`, 108° flexion) was declared "bent
  the wrong way". Hyperextension is by definition a small-angle phenomenon,
  so the restriction costs nothing — but an elbow breaking backward at a
  LARGE angle would slip under this radar.
- **Turns** (`world-turn-*`) only have the universal criteria. Rotation per
  cycle isn't reliably measurable on a clip played in place (the ankle
  actively rotates during the turn, nothing separates the two) — already
  documented in `devtools/anim-lab/mesures.mjs`, and the judge does no
  better.
- **Running gaits (`jog`, `run`), side steps (`strafe`, `step`), gestures held
  in three beats (`clap`, `point`, world's `raise-hand`) and alternate rest
  poses (`idle-alt`)** have no ranges of their own: only the universal
  criteria apply. **The sheet says so** — a line reading "criteria specific
  to …: none" appears, so silence doesn't pass for a blank check. A run
  judged with walking criteria would be condemned for flying: it needs its
  own ranges (flight 10–40%, zero double support), not the neighbouring
  ones.
- **Lateral foot spread** is the only criterion whose verdict changes from one
  `.vrm` to the next (23.9 to 32.1 cm for `idle` across the original 12
  models; it explodes on the low-hipped chibis added since). It depends on
  the rig's pelvis width, which hip height doesn't normalize. Read it as "at
  the high end", not as a firm defect.
- **Three models are OUT OF anthropometric range** and the judge's ranges
  don't apply to them: modele-01 (chibi, hips 0.328 m — spread up to
  37 adult-equivalent cm), modele-02 (non-humanoid mascot, 0.547 m, WITHOUT a
  `neck` bone, legs 0.68 × hips — crosses its own torso while running, knee
  hinge up to 50°), modele-03 (0.628 m). Their "defects" on these criteria are
  model proportions, not clip defects — to be labelled, never fixed (detailed
  list: `devtools/anim-lab/README.md`, the pass over 94 models).
- **The face, the gaze, expressions**: out of scope, the corresponding tracks
  are ignored.
- **Aesthetics**: the judge says a motion is *plausible*, not that it's
  *pretty*.
- **Seated and gait ground-penetration is an OUT-OF-SCENE verdict.** The judge
  replays the bare clip; the app, meanwhile, runs every frame through
  `client/src/scene/legIk.ts` (`'reach'` while seated: the foot AIMS for the
  floor; `'planted'` while standing: a foot poking through gets pulled back
  up). Measured on 2026-08-01 by running the client's REAL sources on four
  builds (0.33 → 1.25 m hips): `world-sit-idle` goes from −54…−178 mm (bare
  clip, worst sole) to **−1.2…−5.1 mm** with IK, `world-sit-enter` from
  −69…−243 to −4…−12 mm. The matrix's "94/94 models" defect therefore doesn't
  exist in-scene for sitting — do NOT retouch seated clips over this. While
  walking/running, the IK plants the HEELS (0.0 mm) but the TOE at the end of
  stance belongs to the clip (the IK follows the ankle's projection and gives
  the foot the clip's own orientation): the toe residual stays something to
  read on the sheets, not something for the IK to fix.

## The cross-checks

The judge was itself put on trial before being trusted, through independent
computation paths (the FBX rig from `idle-lib.mjs`, built to the Overte
source's proportions — not the judge's `.vrm`). The first two ran on that FBX
rig, which is a byproduct of the clip conversion and is **not shipped** with
the repo: their scripts weren't kept, only their result counts.

- `shake`: the frame-by-frame trace of the head's yaw confirms "one broad
  right-left sweep then a damped return" — the judge's "1 single
  back-and-forth" is honest.
- Sitting: on the rig built to the source's proportions, `world-sit-idle`'s
  toes already pass **4.1 cm below the floor** (5.2 cm for
  `world-sit-enter`) — seated foot penetration is in the files, not the
  models. `--tousvrm` confirms it on the 12 `.vrm` files (5.3 to 8.6
  adult-equivalent cm depending on the model's legs).
- `_verif-respire.mjs` — where `idle`'s breathing lives (torso 2.9°, pelvis
  0.06 cm); it's the one that got the criterion fixed.
- `_verif-charniere.mjs` — turns' hinge deviation persists at flexion ≥ 20°:
  it's the clip, not numerical conditioning.
- `_verif-hyper.mjs` — the raw geometry of the two "hyperextensions" flagged
  outside the canonical set: `world-run`'s is TRUE (the knee passes 13.8 cm
  behind the hip-ankle line during push-off — the leg bows backward),
  `world-sit-raise-hand`'s was a sign false positive (hence the restriction to
  ≤ 45° of flexion).

## The files

| file | role |
|---|---|
| `rig.mjs` | builds a `.vrm` as a bare skeleton, loads a `.vrma`, scale, floor, sole points |
| `anatomie.mjs` | replays the clip and extracts its frame-by-frame trace — **judges nothing** |
| `criteres.mjs` | the criteria, the ranges, the verdicts and the French sentences |
| `trace.mjs` | the ASCII friezes of the timeline |
| `juge.mjs` | the command line: sheet, batch, comparison, multi-model |

The split follows the test bench's own (`devtools/anim-lab/`): a pure
measurement core, importable elsewhere (no disk access, no clock, `THREE`
injected by `rig.mjs`), and a command line that only prints.
`anatomie.mjs` and `criteres.mjs` can be loaded by a web page unmodified.

> Inherited pitfall, respected everywhere: **never** sample at `t = duration`
> — `LoopRepeat` loops back exactly there and renders the first frame. We
> sample at `duration − 1e-4`.
