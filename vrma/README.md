**English** | [Français](README.fr.md)

# VRM animations (.vrma)

Humanoid skeleton animations in the **VRMA** format (glTF `VRMC_vrm_animation`
1.0 extension): one file = one clip, independent from the model. Any `.vrm` can
play them, with no setup.

These files **are committed** with the app: they are freely licensed and everyone
should get the same scene.

## Two domains

The library splits into two domains with opposite requirements, and **the name
prefix alone tells them apart**:

| Domain | Name | Contents | Weight |
| --- | --- | --- | --- |
| **face to face** | no prefix | the avatar standing in front of the user, talking: idles, talking idles, emotion gestures | 31 files, 7.89 MB |
| **3D world** | `world-` prefix | the interactive scene where the character walks, wanders, sits down and reacts: gaits, starts and stops, turns, posture changes, held gestures, the whole seated vocabulary | 82 files, 12.28 MB |

The face-to-face domain comes in **two watertight families**: Overte's (no
prefix, above) and Rocketbox's (`rb-` prefix, 38 files, 8.26 MB). See
[Two face-to-face families](#two-face-to-face-families). The 3D world has one
family only, and will not get another.

Face to face is **strict**: a gesture only earns its place if it is useful,
pleasant and believable for someone having a conversation. Enrich what exists (a
`-2`, `-3` variant) rather than inventing a category — the trigger vocabulary must
stay short.

### The acceptance rule, in numbers

A gesture enters this domain only if the **idle → gesture → idle** sequence does
not snag. Measured: the pose gap between the clip's **first** frame and the idle
rest pose, and between its **last** frame and that same pose, must stay under
**10 cm** of world excursion of the worst major bone — against `idle.vrma` *and*
against `idle-talking.vrma`, since that is what gestures return to while a reply is
being written. Below that threshold the 0.3 s (in) and 0.4 s (out) fades are
invisible; above it, the body is dragged and the feet slide without a step.

The current 31 clips all stay under the threshold. The first thirty range between
**4.1 and 8.8 cm** on the worst of their four
measurements (in and out, against each of the two idles), median 5.5; against the
`idle` base alone, **0.8 to 6.8 cm**, median 3.2. The two highest (8.8 and 7.6 cm)
are `idle-talking-4` and `relaxed-3`, promoted from `extra/` after a judgement by
eye: their seam is at the top of the range, not over the threshold, and the fade
absorbs it. The thirty-first, `happy-6`, moved up from `extra/` once its entry
measurement was repaired (11.1 → 0 cm). A clip that misses the threshold
is removed, not patched — an emotion with no gesture is no drama (the
trigger finds nothing and the avatar keeps breathing), a gesture that catches the
eye is. That is what cost the fifteen CMU-mocap gestures their place, and the
`surprised` emotion all of its clips: see [`NOTICE.md`](NOTICE.md) §2.

It is also what keeps out of this domain a few Overte clips that are perfectly
usable **elsewhere**: two idles of a different stance (13.8 and 15.8 cm from the
base) and two held gestures (15.7 and 18.8 cm as whole passes) moved to the
`world-` domain, where they are **sequenced** rather than cross-faded — a dedicated
transition leads to the alternate idle and back, a held gesture splits into intro,
hold and outro. That is what Overte itself does, and the whole sequence then stays
under 6 cm where the single clip was worth 15. A clip that fails on its own can be
perfect in its place.

### What each emotion has today

| Emotion | Clips | Source |
| --- | --- | --- |
| `neutral` | `neutral` | head tilt |
| `happy` | `happy`, `happy-2`, `happy-3`, `happy-6` | four claps — the fourth fished back out of `extra/` once its measurement was repaired (entry 11.1 → 0 cm, feet anchored, peak smoothed) |
| `sad` | `sad` | head drop |
| `angry` | `angry`, `angry-2` | annoyed head shake, measured head shake |
| `relaxed` | `relaxed`, `relaxed-2`, `relaxed-3` | neck stretch, weight shift, 14 s waiting fidget |
| `surprised` | **none** | Overte has no surprise emote |

And the base poses, which the player picks at random: **five idles** (`idle` →
`idle-4`, `idle-7`) and **five talking idles** (`idle-talking`, `idle-talking-4` → `-7`).

Overte draws from four and seven respectively, every 10–30 s for the idle and
7–12 s for speech; that is what keeps an avatar from visibly replaying its loop.

The 3D world is **generous**: the scene needs material, and these clips are never
played face to face.

**Lazy loading is intended.** In face-to-face mode, the 12.28 MB of the `world-`
domain have no reason to be downloaded — which is exactly why the boundary lives
in the file name rather than in a config file.

## Two face-to-face families

Face to face is played from **two complete, interchangeable libraries**:

| Family | Prefix | Source | Weight | What it has of its own |
| --- | --- | --- | --- | --- |
| **Overte** (default) | *none* | Overte, Apache-2.0 | 31 files, 7.89 MB | five idles, five talking idles, the emotion gestures |
| **Rocketbox** | `rb-` | Microsoft Rocketbox, MIT | 38 files, 8.26 MB | four idles, three talking idles, **three listening bases**, twenty-eight gestures |

A character picks one (the `animations` field of its `character.json`, a selector
in the Characters dialog). Absent = Overte, so **nothing changes for characters
that already existed**.

### The family rule, and the number it rests on

> **A character plays Overte OR Rocketbox, never a mix.**

This is not a matter of taste, it is a measurement. The two libraries do not
share a standing pose: a Rocketbox clip measured against Overte's base is
**16.5 to 20.3 cm** of world excursion of the worst major bone — two and a half
times the 10 cm acceptance threshold. Inside the Rocketbox family the same
measurement falls between **0.2 and 5.7 cm** (median 0.4). Mixing manufactures,
at every gesture, exactly the defect the acceptance rule exists to prevent.

The catalogue therefore keeps the two families **apart at build time**: an `rb-`
clip never enters a role of the Overte family, and vice versa. Happy corollary:
**the family that is not chosen is never downloaded**, not one byte — the same
mechanism as the `world-` domain's lazy loading.

### And in the living 3D scene?

**The `world-` domain stays 100 % Overte, for everyone.** Walking, turning,
sitting down, the seated gestures: those clips only exist in Overte, Rocketbox
has none of them and never will. A Rocketbox character therefore keeps its bases,
its listening idle and its gestures, and **borrows Overte's gaits** to cross the
room.

That is the **one cross-family seam in the whole system**, and it must be said:
the last frame of `world-walk-stop` is anchored on the `idle` pose, i.e. on
Overte's standing stance. Picked up by an `rb-idle` base, the junction carries
the 16–20 cm — spread over the base fade (0.5 s), not snapped in one frame. In
practice it shows at the end of a walk, never in conversation.

Two reasons to accept it rather than force Overte while the living scene is on.
First, the living scene is a **global switch**, not a state of the character:
turned on without a 3D set it does almost nothing — and it would still make the
body-language setting inert, which reads as a fault. Second, the trade is
lopsided: the listening idle, the five `neutral`s, the four `relaxed`s — the
whole richness of the family — against one junction per walk.

## Naming convention

The file name IS the configuration — there is no mapping file.

### Face to face

| Name | Role |
| --- | --- |
| `idle.vrma` | looping base pose (without it, no animation is played at all) |
| `idle-talking.vrma` | looping base pose played while a reply is being written |
| `happy.vrma`, `sad.vrma`, `angry.vrma`, `surprised.vrma`, `relaxed.vrma`, `neutral.vrma` | one-shot gesture played when the character expresses that emotion, then back to idle. `surprised` is the one recognised role **with no file**: the trigger finds nothing and the avatar keeps breathing |
| `nod.vrma` | **acknowledgement when the character is clicked** in the living scene (see `REACTION_STEM`, `client/src/scene/vrmStage.ts`). Five variants, drawn without immediate repetition. The one face-to-face role downloaded **only with** the `world-` clips: it is the living scene that uses it, not the conversation |
| `shake.vrma`, `think.vrma`, `raise-hand.vrma` | conversation primitives, with no dedicated keyword: reserved for triggering by reading the reply text, hence **ignored by today's player** |
| `-2`, `-3`… suffix (`idle-2.vrma`, `happy-2.vrma`) | variants of the same role, picked at random |

`raise-hand` is the **only role invented** since that rule was written, and
reluctantly so: raising a hand is neither a `happy` nor a `nod`, there was no
neighbouring role to enrich. Like `shake` and `think` it has no keyword and today's
player ignores it — it waits for a reading of the reply text. The **trigger**
vocabulary is therefore unchanged (`nod` has since found its own trigger: a click
on the character).

**And `raise-hand` RAISES a hand, it does not wave.** `raise-hand` and
`raise-hand-2` raise a hand and **hold** it — 8 s of hold for the first. The forearm
beats at only 0.20 and 0.08 round trips per second, where a wave needs two or three:
this is the gesture of someone **asking to speak**, and that is the intended role.
The diagnostic bench counts it as a cadence defect for lack of a range for "hand
raised and held". If the app ever wants a wave, these two are not it.

The player groups variants by stripping the `-<digits>` suffix from the name:
`happy-2` is a variant of `happy`. **Gaps in the numbering have no effect** — the
catalogue is built from the files actually present, not from a count. `idle-5` and
`idle-6` are therefore missing without breaking anything: they moved to the
`world-` domain as `world-idle-alt1` and `world-idle-alt2`.

### Face to face, Rocketbox family (`rb-`)

**Same role vocabulary, one prefix more.** The player strips `rb-` and then
applies exactly the grammar above: `rb-happy-2.vrma` is a variant of the
Rocketbox family's `happy` gesture, `rb-idle.vrma` is its base. One role is new,
and it exists only there:

| Name | Role |
| --- | --- |
| `rb-listen.vrma`, `-2`, `-3` | **listening base**, looped while the user is TYPING their message. Overte has no equivalent: with no `listen` clip the mechanism is inert and the avatar keeps breathing |

The 38 clips by role — both measurement columns are the acceptance rule's, taken
**against the `rb-idle` base** (never against Overte's: that would measure the
distance between two studios, not a defect):

| Role | Clips | Seam to base | Loop seam |
| --- | --- | --- | --- |
| base | `rb-idle`, `-2`, `-3`, `-4` | 0.2 – 2.7 cm | 0 – 0.82 cm |
| talking base | `rb-idle-talking`, `-2`, `-3` | 2.2 – 5.4 cm | 0.93 – 2.17 cm |
| listening base | `rb-listen`, `-2`, `-3` | 2.7 – 5.7 cm | 0.83 – 2.22 cm |
| `happy` | `rb-happy`, `-2`, `-3` | 0.4 cm | — |
| `neutral` | `rb-neutral`, `-2`, `-3`, `-4`, `-5` | 0.4 cm | — |
| `relaxed` | `rb-relaxed`, `-2`, `-3`, `-4` | 0.4 – 5.2 cm | — |
| `angry` | `rb-angry`, `-2` | 2.3 – 3.3 cm | — |
| `sad` | `rb-sad` | 4.5 cm | — |
| `surprised` | **none** — as in Overte | — | — |

Plus **six conversation primitives** with no trigger keyword, recognised but
ignored by today's player, exactly like Overte's `shake`, `think` and
`raise-hand`: `rb-nod` (`-2`, `-3`), `rb-shake` (`-2`, `-3`), `rb-wave` (`-2`),
`rb-shrug` (`-2`), `rb-laugh`, `rb-think` (`-2`). They wait for a reading of the
reply text.

**`rb-nod` is NOT the click acknowledgement.** That role (`REACTION_STEM`)
belongs to the living scene, which stays Overte: `rb-nod` is a Rocketbox `nod`
held in reserve, not the clip a click triggers. Deliberately so — a Rocketbox
reaction over an Overte standing base would be the very mix the rule forbids.

Any other `rb-` name is silently ignored, as everywhere else.

### 3D world

| Name | Role |
| --- | --- |
| `world-walk-slow`, `world-walk`, `world-walk-fast`, `world-jog`, `world-run` | forward gaits, played **looping and in place**: horizontal translation is zero, it is up to the code to move the character at the speed recorded in `world.json` |
| `world-walk-back`, `world-walk-back-fast`, `world-jog-back`, `world-run-back` | backward gaits, same principle |
| `world-strafe-left`, `world-strafe-right` and their `-fast`, `-jog`, `-run` | strafes, eight lateral gaits |
| `world-step-left`, `world-step-left-short`, `world-step-left-fast` | small side steps, looping. Overte gets the **right-hand** versions by mirroring; they do not exist as files |
| `world-turn-left`, `world-turn-right` | in-place turns, looping, same principle for rotation |
| `world-walk-start` | start, played once |
| `world-walk-stop`, `-2`, `-3`, `-4` | long stop, four variants picked at random. Overte chooses them when the avatar had **momentum** (over 2.2 m/s) |
| `world-walk-stop-small` | short stop, for jerks and micro-adjustments |
| `world-idle-alt1`, `world-idle-alt2` | standing idles in a **different stance** (left foot, right foot forward), looping |
| `world-idle-alt1-enter` / `-exit`, `world-idle-alt2-enter` / `-exit` | the transitions in and out. Overte **never** cross-fades one idle into another of a different stance: it plays a clip that makes the trip |
| `world-afk-texting` | standing idle, tapping at a phone — the long absence. Loops, with an exact seam. **Orphaned in Overte's graph**: `afk_texting.fbx` is referenced by no node, Overte itself never plays it |
| `world-clap-in` / `-hold` / `-out`, `world-point-…`, `world-raise-hand-…` | **held gestures**, in three beats: the intro brings the gesture in, the hold **loops** for as long as the intent lasts, the outro brings it back. This is Overte's own split |
| `world-sit-enter`, `world-sit-exit` | sitting down and standing up, played once |
| `world-sit-idle` → `world-sit-idle-5` | seated hold, looping — **replaces** the base pose |
| `world-sit-talking` → `world-sit-talking-3` | seated hold while a reply is being written |
| `world-sit-look`, `-2`, `world-sit-lookfidget`, `world-sit-fidget`, `world-sit-shift`, `world-sit-shifting`, `world-sit-lean`, `world-sit-legs` | seated micro-variations, played once |
| `world-sit-turn-left` / `-right`, and their `-end` | turns on the seat, each with its **dedicated exit** |
| `world-sit-nod`, `-2`, `-3`, `world-sit-ack` | seated agreement |
| `world-sit-shake`, `world-sit-dismiss`, `world-sit-disbelief`, `world-sit-sad` | seated disagreement |
| `world-sit-clap`, `-2`, `-3`, `world-sit-cheer` | seated joy |
| `world-sit-point`, `world-sit-raise-hand`, `-2`, `-3` | seated pointing and raised hand |

Any other name is silently ignored.

The seated world is a **complete mirror** of the standing one, rebuilt clip by clip
by Overte, and it was until now the pack's largest untapped seam: the library had
**no** seated emote at all.

## `extra/` — the converted clips that were not kept

The [`extra/`](extra) subfolder holds **15 clips** (3.92 MB) from the same
conversion pass as the others: same tools, same fixes, same round-trip validation,
same credits (see [`NOTICE.md`](NOTICE.md) §1). They simply have no place in the
active library. They ship anyway, because a clip that was converted and then set
aside costs nothing but its bytes on disk, and because the judgement that set it
aside can be revisited.

**The app never downloads them.** `/api/vrm-animations` lists `vrma/` **flat** — a
`readdir` with no recursion, filtered on `.vrma`. A file sitting in `extra/`
therefore appears in no catalogue, and the player never asks for it. The server
would serve it if given the URL; nothing gives it the URL. The weight of `extra/`
is repository weight, not download weight.

The "seam" column is the [acceptance rule](#the-acceptance-rule-in-numbers)
measurement: the worst gap, in centimetres, between the clip's edges and the rest
pose of the `idle` and `idle-talking` bases. Failure threshold: 10 cm.

| File | Why it is here | Seam |
| --- | --- | --- |
| `idle-talking-2.vrma` | talking idle — the arms end up far from the base pose | 39.5 cm |
| `raise-hand.passe-complete.vrma` | raised hand, **whole pass** (intro + hold + outro): this is the clip the `world-` domain ships split into `world-raise-hand-in` / `-hold` / `-out` | 18.8 cm |
| `point.vrma` | pointing, whole pass — same story, shipped split as `world-point-…`. Re-examined 2026-08-01: anchoring the leading edge brings it down to 6.7 cm, but **no `point` role exists in the face-to-face vocabulary** — promoted, it would stay mute; the split `world-` version is the one that plays, and it is excellent | 15.7 cm |
| `idle-talking-3.vrma` | talking idle, just over the threshold | 11.2 cm |
| `happy-5.vrma` | clap — **it is `happy-2`**: the two clips never differ by more than **3.4°** (worst bone, over the whole duration). Promoting it would give the random draw the same emote twice. The wrist jolt it carries (1000 °/s at t = 0.3 s) was therefore smoothed **in `happy-2`**, where it actually plays. Re-examined 2026-08-01: even reworked (anchoring + smoothing), it stays `happy-2`'s choreography within 14° — the duplicate argument holds, it stays here | 8.7 cm |
| `neutral-2.vrma` | slow head nod — **redundant with the five `nod`s**: the face-to-face vocabulary must stay short, and `neutral` already has its clip. It holds up visually, but adds nothing. Re-examined 2026-08-01: clean seam (5.7–6.9 cm), redundancy decides, not the measurement | 8.1 cm |
| `cand-idle-fenetre.vrma` | `idle` re-converted on the window the graph **declares** (1→300) instead of the trim that was kept — near-identical to the shipped file | 5.0 cm |
| `cand-idle-2-fenetre.vrma` | same for `idle-2` (1→902) | 5.0 cm |
| `cand-idle-3-fenetre.vrma` | same for `idle-3`, but the declared window runs **26.63 s** where the shipped file keeps only a 13.33 s sub-loop: this one really is different | 5.2 cm |
| `cand-idle-talking-fenetre.vrma` | same for `idle-talking` (1→215) | 5.5 cm |
| `world-jump-start.vrma`, `world-jump-air.vrma`, `world-jump-land.vrma`, `world-jump-run-start.vrma`, `world-jump-run-land.vrma` | the five beats of a jump. In Overte the airborne phase is not an animation but **fixed poses blended by the physics engine's vertical speed**, and the jump height lives in the simulation, not in the file: without that code they do not stand up (see [`NOTICE.md`](NOTICE.md) §3) | — |

**Three of these clips moved up to the root.** `idle-talking-4` (8.8 cm) and
`relaxed-3` (7.6 cm) after the library's first judgement by eye: they fell outside
the range of the clips that were kept (4.1 to 8.0 cm) without crossing the 10 cm
threshold, and that was the only reproach the measurement had for them; on screen,
the first gesticulates exactly like the `idle-talking-5/-6/-7` already in place,
the second is a credible background loop. Then `happy-6` (2026-08-01), set aside
solely for its measurement (11.1 cm entry, skating feet, 1000 °/s spike): with the
measurement repaired — leading edge anchored on `idle`'s mean pose, legs damped
towards their initial pose, spike smoothed to 604 °/s — it is a genuinely different
clap from its three brothers (117 to 135° apart at the worst bone), it enriches the
draw. The two that remain above the range, `happy-5` and `neutral-2`, stay here —
not for their seam, but because they **duplicate** a clip that already ships (see
the table).

**And one clip from the 3D-world domain**, `world-afk-texting` (2026-08-01): the
table above gave it no seam because a `world-` clip is not judged against the
standing bases. Judged against what actually concerns it — its **loop seam** — it
is beyond reproach: 0 cm of pose, a 12 °/s jump for an internal 95th percentile of
21 °/s. It moved up to the root **together with its entry in
[`world.json`](world.json)** (`famille: repos`, `boucle: true`): a `world-` clip
without an entry would be judged against the standing base, at 26.8–29.1 cm, and
would manufacture a false failure.

**Six converted clips are deliberately not here**: the raw versions of
`world-sit-point`, `world-sit-raise-hand-2` and the four `world-walk-stop-…`, from
before their geometric fixes (hips and legs given back to the seated clips, stops
anchored onto their neighbours). The folder already carries those six clips in
their corrected version, under the same name; the raw version has its legs in the
bind pose — standing, under a seated body — or its feet unanchored. That is not a
variant, it is an earlier state.

### Enabling one of these clips

1. **Move** the file from `vrma/extra/` to the root of `vrma/`.
2. **Rename it** according to the [convention above](#naming-convention) — the name
   IS the configuration, and any name outside the convention is ignored.
3. **Reload the page.** The catalogue is rebuilt from the files actually present;
   the server does not need restarting.

`happy-5`, `idle-talking-2`, `-3` and `neutral-2` already
carry a conforming name and a free number: they move as they are, and **gaps in the
numbering have no effect**. The others need a name:

| File in `extra/` | Name to give it at the root |
| --- | --- |
| `cand-idle-fenetre`, `cand-idle-2-fenetre`, `cand-idle-3-fenetre` | `idle-8`, `idle-9`… — or the name of the clip they re-convert, to replace it. `idle-5` and `idle-6` are free but already used as `world-idle-alt1` / `-alt2`: reusing them invites confusion |
| `cand-idle-talking-fenetre` | `idle-talking-8`, or `idle-talking` to replace the shipped one |
| `raise-hand.passe-complete` | `raise-hand-3`; or `raise-hand` to replace the intro-only clip that ships. The `.passe-complete` suffix exists only to avoid a name collision inside `extra/`, it means nothing to the player |
| `point` | there is no `point` role in the face-to-face vocabulary: under that name the clip stays ignored. Fold it into a neighbouring role, or leave it to the `world-` domain, which already ships it split |
| the five `world-jump-*` | the `world-` prefix is enough to place them in the 3D-world domain, but the scene engine will not sequence them without a matching entry in [`world.json`](world.json) — and without it the bench judges them against the **standing** base, which manufactures a false failure |

These clips were set aside **on a measurement**, not at random. Above 10 cm the
base → gesture → base seam shows: the body is dragged and the feet slide without a
step. That is exactly what the rule protects, and what you accept losing by
enabling one.

## The sole under the floor: what these files do NOT fix, and why

A diagnostic bench measures, on the project's reference model (a chibi VRM 0.x
with 0.755 m hips), that **55 clips
sink the sole below the floor**: the whole seated family by 8.5 to 10.4 cm, the
strafes and runs by 5 to 10, the walks by 2.5 to 5.2. The reflex is to raise the
hips translation track inside the `.vrma`. **That would be wrong, three times over.**

**1. All 55 are `world-` clips.** The worst of the face-to-face domain is `idle-7`
at 1.6 cm, under the 2 cm of sole thickness the bench tolerates. And the 3D world
runs under a **leg inverse kinematics** pass (`client/src/scene/legIk.ts`), called
every frame, whose whole job is exactly this: standing it **lifts** a foot that goes
through the floor, seated it makes the foot **reach** for it. Its header quotes the
same measurements as the bench ("`world-sit-idle` — 37 to 62 mm → very visible"):
the defect is already corrected, in the right place, by articulating the leg rather
than translating the body.

**2. For the seated family, hip height is LOAD-BEARING.** It is
`postureAssiseCanonique` in [`world.json`](world.json) — 0.5409 hip — and the code
uses it to place the pelvis on the furniture's real seat. Raising the seated clips by
8.6 cm would make the character **hover above the chair** by exactly that much, and
the IK would stretch the legs to catch the floor.

**3. For the gaits, it is not an offset.** Measured frame by frame, the sole of
`world-walk` ranges from 0 to −5.2 cm within the cycle (median −1.1): it just touches
at double support and sinks at mid-stance, because the stance knee is over-flexed. A
constant 5.2 cm lift would leave **85 % of the cycle airborne by more than 2 cm** —
trading a foot in the floor for a character on an air cushion. And a lift that
follows the penetration frame by frame does straighten the pelvis curve, but injects
**2 cm of limp** between the two half-cycles and **1.4 cm of pop at the loop seam**.
The seated family is the one case where the sink IS constant (spread ≤ 0.4 cm across
34 clips) — and that is precisely the one point 2 forbids touching.

The rule that falls out: **a `.vrma` describes a pose, not an altitude.** The floor
is the engine's job.

## Fixes applied to the shipped clips

These clips are no longer the raw conversion of their source. Every fix was measured
before and after on the same bench, and validated by a full round trip (`GLTFLoader`
+ `VRMAnimationLoaderPlugin` + `createVRMAnimationClip`, frame-by-frame replay,
sample at `duration − 1e-4`).

| Clip | Fix | Before → after |
| --- | --- | --- |
| `world-run`, `world-strafe-left-run`, `world-strafe-right-run` | the right knee broke **backwards** at push-off: at the worst instant the knee sticks out 13 cm in front of the hip-ankle line. The knee track is soft-clipped (`tanh`, so no jolt and no broken seam) at the human limit | hyperextension **41°, 41°, 37° → 10°** — sole penetration, foot lift and seam all unchanged |
| `world-turn-right` | the left knee bent 58° out of the plane of the leg during the crossover. The shin is brought back into the thigh's plane by a twist about the femoral axis (which does not touch flexion) | hinge **58° → 29°**, inside the envelope of `world-turn-left` (31°), which is healthy. Bench verdict: **defect → good** |
| `shake` | did not read as a "no": **one single** 56° sweep. The window Overte's graph declares (frames 1→72) is already the whole file, and the only other standing "no" in the source (`thoughtfulheadshake`) is a single sweep too — there was nothing more to fetch. The central sweep is therefore **replayed as a time mirror**, with the turning points taken at the yaw extremes where the speed is zero; then the amplitude is brought down to that of `world-sit-shake`, Overte's own seated "no" | **0.5 → 1.5** round trips · amplitude **56° → 39°** · duration 2.30 → 3.63 s · **both edge poses are bit-for-bit the originals**, so the seam to the idle does not move |
| `happy-2` | a 1000 °/s wrist jolt at t = 0.3 s (a badly interpolated key join), and a second at 818 °/s at t = 0.7 s. Local Laplacian smoothing on the quaternions, with zero weight at the window edges | peak speed **1000 → 688 °/s** · outside the window the file is unchanged, **edges included** |
| `world-sit-legs` | the clip has **no shoulder track at all**: the shoulders stayed open as if standing, under a seated body, and the gap to the seated hold was **11.6 cm constant across all 138 frames**, carried by `rightShoulder` (21.6°). It was never the crossed ankles. Both shoulders were given the mean pose of `world-sit-idle`, constant — the same graft the seven hipless seated clips got — then both edges anchored onto that same hold | **11.6 → 0 cm** · peak speed **unchanged** (49 °/s) |
| `world-sit-talking-2` | it is a **loop**, and a loop has no "start": this one opened 13.8 cm away from the seated hold when its frame 21 was only 7.1 away. Its start phase is shifted by 21 frames (0.700 s) — the new seam is an *interior* interval of the clip, hence exact by construction — then both edges anchored onto `world-sit-idle` | **13.8 → 0 cm** · seam **0 cm**, speed jump **68 → 32 °/s** · peak **unchanged** (269 °/s) |
| `world-raise-hand-in` | the hand already started high: **13.6 cm** between `idle` and the first frame, at the worst of the idle's 300 phases. A gesture fires when the intent arrives, not when the idle is ready — no phase contract is possible here, so the upstream edge is anchored onto the **mean** pose of `idle` and the downstream edge onto `world-raise-hand-hold` at t = 0 | **13.6 → 1.6 cm** at the worst of 300 phases (0.2 at best) · exit **2.6 → 0 cm** · peak **unchanged** (936 °/s) |
| `world-sit-turn-left-end` | seated pivot settle: **35.9 cm** at the worst phase of the upstream cycle, 10.4 at the best. No phase saved the seam — the cycle holds the left forearm ~36° away from the settle's opening at *every* phase. The first frame is therefore anchored onto `world-sit-turn-left` at **t = 1.100 s** (0.80 s window, so the travel stays under the clip's own peak) and the last onto `world-sit-idle`; the phase becomes a **contract** in `world.json` | **35.9 → 0 cm** upstream, **0.4 → 0 cm** downstream · peak 64 → 77 °/s (2.6°/frame, below visibility) |
| `world-sit-turn-right-end` | same defect, worse (**43.3 cm**), plus one of its own: the source FBX has **no track at all** on `spine`, `chest`, `upperChest`, `neck` or either shoulder — 6 major bones out of 20 put back standing under a seated body, i.e. **16.4 cm of residue no anchoring could touch**, there being no track to correct. All six were grafted: the cycle's pose at its exit phase, then a smoothstep back to `world-sit-idle` over the clip's duration — the torso untwists, which is what a settle is meant to show. Anchoring and phase contract (t = 2.367 s) as for its mirror | **43.3 → 0 cm** upstream, **14.5 → 0 cm** downstream · `osAnimes` **14 → 20** · peak speed **unchanged** (170 °/s) |

**The last five rows are one single pass** — the one that clears the five defects the
reworked bench still found across 111 clips. Three choices govern it, and they
generalise:

1. **A bone with no track falls back to the rig's REST pose** — standing, shoulders
   open. On a seated clip *that*, not the gesture, decides the verdict:
   `world-sit-legs` and `world-sit-turn-right-end` were measuring a shoulder and torso
   defect, not a motion defect. The measurement says so unambiguously: the gap is then
   **constant over the whole clip**.
2. **Terminal bones are excluded from the anchoring** (`head`, both hands, both toes):
   their own rotation moves **no** measured bone — a hand's position comes from its
   forearm, a toe's from its foot, and fingers are out of the measurement. Anchoring
   them gains nothing and adds a jolt; inside a loop, a jolt replayed every cycle. On
   `world-sit-talking-2` the left wrist was 129° away: anchoring it would have taken
   the peak from 269 to **639 °/s** for zero centimetre gained.
3. **A phase contract is measured, not decreed — and it does not apply everywhere.**
   It holds for a cycle the code can *choose* when to leave (gaits, pivots); it does
   not hold for an idle a gesture interrupts whenever the intent arrives
   (`world-raise-hand-in` therefore targets the mean pose of `idle`, not one of its
   phases).


**The “clip lode” pass of 2026-08-01** clears the seven “borderline” verdicts the
bench still gave on the reference rig, and the six outright failures they turned
back into on a taller rig (hips at 0.9045 m) — multi-model margin was the real
issue. Same tools, same conventions as the previous pass, plus two new ones:
**local** smoothing of a velocity spike (windowed, edges intact) and **circular**
smoothing of a loop seam (the seam pose stays exact, only the velocity spreads).

| Clip | Fix | Before → after (reference rig · 0.9045 rig) |
| --- | --- | --- |
| `world-point-in` | leading edge anchored onto the mean pose of `idle` (the `world-raise-hand-in` recipe) | junction **8.1 → 1.6 cm** · **10.1 → 2.0**; downstream 0.7 unchanged |
| `world-sit-talking`, `-3` | loop phase rotated to the frame closest to the seated hold (+58 / +13 frames, swept on both rigs) + edges anchored; `-3`: graft of an `upperChest` **missing from the file** | in **8.3/8.6 → 0 cm** everywhere · seams 0 cm, jumps 63→30 / 31→32 °/s |
| `world-sit-idle-5` | legs almost static (≤ 0.9°) but offset from the rest of the family: constant graft of the six leg bones from the hold's mean pose | in **9.3 → 3.1 cm** · **10.4 → 3.9**; knees at 101° = the family; loop seam untouched; anchoring the arms REFUSED (a 10× spike replayed every cycle, for a gap the fade already absorbs) |
| `world-sit-cheer` | `leftShoulder` track **missing** (a standing shoulder frozen under a seated body): grafted from the hold, then both edges anchored (short 0.25 s window — the 687 °/s peak of the “yay!” does not move) | in = out **8.9 → 0 cm** · **10.7 → 0** |
| `world-sit-clap-3` | leading edge alone anchored (the exit was already at 2.1) | entry **7.9 → 0 cm**; 747 peak unchanged |
| `world-raise-hand-hold` | loop seam: pose exact, but a 98 °/s velocity jump (1.34 × p95) across the whole raised-arm chain — circular smoothing ±0.2 s, four bones | jump **98 → 25 °/s** · max deviation 1.1° · both junctions of the hold stay excellent |
| `raise-hand-2`, `world-sit-raise-hand`, `world-raise-hand-in` | forearm spikes over 800 °/s (1000 °/s clipping plateaus, a dead stop then a 936 snap): local smoothing at the offending instants, on the way up AND down | peaks **1000/1000/936 → 779/739/687 °/s**, velocity verdict “good”; seams unchanged to a tenth of a centimetre |
| `world-sit-disbelief`, `world-sit-clap` | hand spikes (cosmetic): 993/1000/815 and 956/875 °/s — local smoothing, including a `rightHand` at 815 the sweep had missed | every peak **≤ 797 °/s**; the clap keeps its snap (797 left alone) |
| `world-walk`, `-fast`, `-back`, `-back-fast` | the `hips.position` track was **purely vertical** — yet the source's legs compensate for a pelvis that sways: without it, the stance foot pays (2.2 to 12.0 cm of lateral drag during stance). One sine per cycle on the exact period, amplitude and phase fitted by a **per-clip grid** (bounded to the judge's “good” band, 3–5 cm peak to peak), sign measured on the legs themselves | stance drag **3.7→1.7 · 6.6→3.1 · 7.8→4.1 · 12.0→7.6 cm**; lateral-pelvis judge **0.0 “borderline” → 4–5 cm “good”**; seams and jumps unchanged to the degree; walk-start→walk junction 0.3 cm (the sine crosses zero on the t = 0.200 s contract) |

After the pass: **0 failures and 0 “borderline” on the reference rig** (53
excellent, 59 pass across the 112 clips shipped **at that date** —
`world-afk-texting` moved up to the root afterwards, taking the `world-` domain to
82; the count of 62 predated the return of `happy-5`, `neutral-2` and `point` to
`extra/`), 0 failures and the 4 pre-existing “borderline” verdicts on the 0.9045
rig — no regression, proven by a full probe of both rigs before and after each fix,
and proven again by an independent probe after closing (2026-08-01: the same tallies
down to the clip). The “sliding feet” of the five face-to-face gestures
(`relaxed-2/-3`, `think-2`, `happy`, `happy-3`) were examined and **left alone**:
the judge's criterion measures the foot **relative to the pelvis** and therefore
adds body sway to actual skating; in WORLD space the feet only move 1.3 to 5.6 cm
(four of the five under 3 cm), and damping the legs would kill the weight shift that
makes those poses live (`relaxed-2` is a contrapposto: its “slide” is it settling
in).

**`world-walk-slow` was examined and left alone.** Its feet only clear the ground by
2.6 cm and it is the gait of the autonomous wander, but both proposed exits fail on
measurement: replacing it with a slowed `world-walk` needs a factor of **3.69**
(1.421 against 0.385 m/s), i.e. a 1.42 m stride spread over 3.7 s, and would break
the stroll's phase contract and stride, which live in `client/src/scene/wander.ts`;
retouching it by flexing the swing knee **trades one defect for another** — at +18°
ground clearance goes from 2.6 to 5.6 cm (defect → borderline) but double support
falls from 15 to 5 % of the cycle (good → defect), and at +26° clearance becomes good
at the cost of that same double support. It is a short-stepped shuffle (18.4 cm,
0.20 × hip height): making it lift its feet makes it a different gait.

## `world.json` — what a name cannot say

A file name cannot carry a speed. [`world.json`](world.json) therefore records,
for each 3D-world clip, the measured quantities the code needs:

- **gaits**: distance travelled per cycle, and speed in m/s. The cycles are played
  in place; without that speed the character skates or slides.
- **seated postures**: hip height, as a **fraction of the rest hip height**. Every
  seated clip holds the same one (0.541), including the seated ends of the
  transitions: the seat therefore has a single height.
- **seated transitions**: these clips too are played **in place**; the horizontal
  displacement (26.7 cm) by which the character moves away from the seat when
  standing up is recorded there, to be applied to its position.
- **transitions, `enchaine`**: where the clip comes from, where it goes, and — for
  walking **and the two seated pivots** — **at which phase of the cycle to enter and
  leave it**. The ends of the transitions are anchored onto the neighbouring poses:
  the last frame of `world-walk-start` *is* the pose of `world-walk` at 0.200 s, the
  first frame of `world-walk-stop` *is* the pose of `world-walk` at 0, the first
  frame of `world-sit-turn-left-end` *is* that of `world-sit-turn-left` at 1.100 s,
  and that of `world-sit-turn-right-end` its own cycle's at 2.367 s. Honour those
  phases and the seam is nil; ignore them and it goes back up to 46 cm.
- **`phasesDeRaccord`**: the same for all six cycles, at the root of the file — best
  entry frame, best exit frame, and the gap in centimetres each one leaves. A cycle
  has no "beginning": the code chooses where to enter it and where to leave it, and
  that choice is what decides the seam.
- **loop quality**: pose gap at the seam, and angular speed just before and just
  after it — a loop can be perfect in pose and still snap if the speed jumps.
- **`assise.raccordAWorldSitIdleCm`**: for each seated clip, its gap to the seated
  hold — the same measurement as the face-to-face 10 cm rule, but against
  `world-sit-idle`. The 3D-world domain rejects nobody on that figure, it
  **records** it: it is up to the scene engine to lengthen the fade where it is
  large. Mind the method: a seated clip measured against the **standing** base
  mechanically gives ~47 cm — that is the height of a chair, not a defect.
- **`source.noeudOverte`, `source.fenetreImages`, `source.timeScale`**: exactly
  where the clip comes from in Overte's graph, and — for five of them — the fact
  that Overte plays it **slowed down** (0.65 to 0.75). The slowdown is already
  baked into the file: `dureeS` is the duration to play as is.
- fingers animated or not, duration, size.

Heights and speeds are fractions, or values measured on a rig whose rest hips sit
at 1.0167 m. On a smaller model, scale them by `vrmHips / 1.0167`, otherwise the
character skates.

## `transitions.json` — Overte's state machine

[`transitions.json`](transitions.json) is the machine-readable reading of Overte's
animation graph (`interface/resources/avatar/avatar-animation.json`, Apache-2.0):
**34 nested machines, 165 states, 392 transitions**, and the 116 transition
variables classified **by origin** — clip end, physics engine, VR headset, script.
This is not documentation: it is the behaviour logic of an avatar, already solved
by people whose job it was, under a licence that allows reuse.

What it holds and what cannot be guessed: the fade durations state by state, the
**frame of the target clip where the fade must land** (`interpTarget` — Overte
chooses the phase at which it enters a walk cycle, it does not suffer it), the
timer intervals that draw an idle variation (10–30 s), a one-shot fidget (10–50 s)
or a speech loop (7–12 s), and the engine thresholds (move in at 0.20 m/s, out at
0.07; momentum acquired at 2.2 m/s; 0.1 s hysteresis). The file also says what
**must be rewritten**: the `_moteurAReecrire` section isolates the variables that
come from their physics.

The interactive-scene engine will need it, so it is committed next to the clips it
sequences. Its semantics were checked against Overte's C++ sources, not just the
JSON.

## Credits

Three origins, all free to redistribute. The project's full credits are gathered
in the [README](../README.md#credits); the file-by-file breakdown, the licence
notices and the mentions to keep are in [`NOTICE.md`](NOTICE.md), which must be
read before any redistribution:

- **Overte** — **Apache 2.0**: **111 clips** — the whole face-to-face domain of
  the default family (31 clips: ten base poses, twenty-one gestures) and the
  whole 3D-world domain except the two seated transitions (80 clips).
  `transitions.json` comes from the same source under the same licence. The **15
  clips in `extra/`** also come from Overte under the same licence — they carry
  the same obligations, whether or not they are ever played.
- **Microsoft Rocketbox** — **MIT**, © Microsoft Corporation (2020): the **38
  `rb-` clips**, the second face-to-face family — four idles, three talking
  idles, three listening bases, twenty-eight gestures. Pinned commit `0943055`;
  converter and plan ship in [`scripts/`](../scripts/convert-rocketbox.mjs). MIT
  requires the copyright notice and permission text to accompany any
  redistribution: they are in [`NOTICE.md`](NOTICE.md) §4.
- **Quaternius**, *Universal Animation Library* — **CC0 1.0**, public domain: the
  two seated transitions, the one family Overte does not have.

The **CMU Graphics Lab Motion Capture Database** (BVH conversion by Bruce Hahne)
supplied fifteen emotion gestures to the first version of this library; none of
them held the acceptance rule above, and no file derives from it any more.
