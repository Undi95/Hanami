# NOTICE — émotes VRMA de Hanami / Hanami VRMA emotes

Les fichiers `.vrma` de ce dossier sont des **œuvres dérivées** : chacun est la
conversion (retargeting sur le squelette humanoïde VRM 1.0, découpage,
ré-échantillonnage à 30 fps) d'une animation d'origine tierce. Les mentions
ci-dessous doivent accompagner toute redistribution.

*The `.vrma` files in this folder are **derivative works**: each one is a
conversion (retargeted onto the VRM 1.0 humanoid skeleton, trimmed, resampled to
30 fps) of a third-party source animation. The notices below must accompany any
redistribution.*

---

## 1. Overte — Apache License 2.0

**Cent sept fichiers sur cent neuf** dérivent des animations d'avatar du projet
**Overte** (`overte-org/overte`, `interface/resources/avatar/animations/`,
127 fichiers FBX) : **tout le domaine face à face** — les neuf animations de
repos et de parole, qui sont le socle permanent de la scène, et les dix-neuf
gestes — ainsi que tout le domaine monde 3D sauf les deux transitions assises.
C'est la source de la bibliothèque, à deux fichiers près.

Ce décompte est celui de la **bibliothèque active**, à la racine de `vrma/`. S'y
ajoutent les **dix-neuf clips du sous-dossier `extra/`**, convertis mais non retenus
et jamais chargés par l'application : ils viennent eux aussi d'Overte, sous la même
licence, et sont détaillés en fin de section. Overte fournit donc **126 des 128**
fichiers `.vrma` redistribués.

Le fichier [`transitions.json`](transitions.json) livré à côté des clips dérive de
la **même source** sous la **même licence** : c'est la lecture exploitable de
`interface/resources/avatar/avatar-animation.json` — 34 machines à états, 165
états, 392 transitions, 116 variables. Il n'y a pas de restriction supplémentaire :
la mention Apache-2.0 ci-dessous le couvre comme elle couvre les `.vrma`.

Ces animations ont été produites en interne chez High Fidelity par un animateur,
dans Maya — les métadonnées internes des FBX déclarent
`Original|ApplicationName = Maya` et des chemins de projet
`C:\hifi-animation\anim_resource\<nom>.mb`. Ce n'est ni de la capture brute ni du
Mixamo recyclé : la recherche de chaînes ne donne aucune occurrence de « mixamo »
ou « adobe », et aucun os ne porte le préfixe `mixamorig:`.

*One hundred and seven files out of one hundred and nine derive from the avatar
animations of the **Overte** project (127 FBX files): the whole face-to-face
domain — all nine idle and talking animations, which are the permanent base of the
scene, and the nineteen gestures — plus the whole 3D-world domain except the two
seated transitions. `transitions.json` derives from the same repository's animation
graph under the same licence. These animations were hand-made in-house at High
Fidelity by an animator, in Maya. That count covers the active library at the root
of `vrma/`; the nineteen clips of the `extra/` subfolder — converted, not kept, never
loaded — also come from Overte under the same licence, so Overte supplies **126 of
the 128** redistributed `.vrma` files.*

```
Copyright (c) 2013-2019, High Fidelity, Inc.
Copyright (c) 2019-2021, Vircadia contributors.
Copyright (c) 2022-2026, Overte e.V.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use these files except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

SPDX-License-Identifier : `Apache-2.0`
Dépôt / repository : <https://github.com/overte-org/overte>

### Domaine face à face / face-to-face domain

| Fichier dérivé | Animation source Overte | Segment repris |
| --- | --- | --- |
| `idle.vrma` | `idle.fbx` | intégralité (10,000 s) |
| `idle-talking.vrma` | `talk_armsdown.fbx` | 0,033 → 7,133 s |
| `idle-2.vrma` | `idle04.fbx` | 0,033 → 30,067 s |
| `idle-3.vrma` | `idle03.fbx` | sous-boucle 4,833 → 18,167 s |
| `neutral.vrma` | `idle_once_headtilt.fbx` | intégralité, 5,07 s |
| `happy.vrma` | `emote_clap01_all.fbx` | intégralité, images 1 → 160, 5,30 s — **reconverti à la passe v6**, cf. plus bas |
| `happy-2.vrma` | `emote_clap02_all.fbx` | images 1 → 114, 3,77 s |
| `happy-3.vrma` | `emote_clap03_all.fbx` | images 15 → 163, 4,93 s |
| `sad.vrma` | `emote_disagree_drophead.fbx` | intégralité, 3,27 s |
| `angry.vrma` | `emote_disagree_annoyedheadshake.fbx` | images 7 → 76, 2,30 s |
| `angry-2.vrma` | `emote_disagree_thoughtfulheadshake.fbx` | intégralité, 2,73 s |
| `relaxed.vrma` | `idle_once_neckstretch.fbx` | intégralité, 5,57 s |
| `relaxed-2.vrma` | `idle_once_shiftheelpivot.fbx` | images 0 → 109, 3,63 s |
| `nod.vrma` | `emote_agree_headnod.fbx` | intégralité, 1,77 s |
| `shake.vrma` | `emote_disagree_annoyedheadshake.fbx` | intégralité, 2,30 s |
| `think.vrma` | `idle_once_lookaround.fbx` | 1er tour de regard, 3,37 s |

Modifications apportées aux gestes / changes made to the gestures : os Mixamo
mappés vers les os humanoïdes VRM 1.0, géométrie et T-pose de bind recalées sur
`emote_clap01_all.fbx`, échelle cm → m, ré-échantillonnage à 30 fps, rampes de bord
neutralisées sur les os figés, reliquat de pose parasite rogné en tête (jusqu'à
15 images sur `emote_clap03_all`), lacet moyen du bassin ramené sur l'avant VRM
(+Z), translation horizontale du bassin ramenée dans un rayon de 1 cm, écrêtage
des vitesses angulaires au-delà de 1000 °/s, export en `VRMC_vrm_animation` 1.0.
Une seule clé de toute la bibliothèque est au plafond d'écrêtage : le poignet
gauche de `happy-2` à l'instant où les mains se rencontrent (1081 °/s avant
écrêtage, sur une rampe 318 → 776 → 1081 → 574 °/s, donc du mouvement et non du
bruit ; 95ᵉ centile du clip : 311 °/s).

Les clips trop longs pour un geste ont été recoupés sur une fenêtre de 6 s au plus
dont les **deux bords** sont au plus près de la pose de repos du socle, condition
mesurée en centimètres d'excursion du pire os majeur.

`angry.vrma` et `shake.vrma` dérivent du **même** FBX : le premier est le geste
joué quand le personnage exprime la colère, le second est la brique « non »
réservée à un déclenchement par lecture du texte, que le lecteur ignore
aujourd'hui (cf. `README.md`). Les deux fichiers ne sont pas identiques — ils
sortent de deux passes de conversion successives — mais ils portent la même
animation source.

*`angry.vrma` and `shake.vrma` derive from the **same** FBX: the first is the
gesture played for the anger emotion, the second the reserved "no" primitive.*

### Domaine face à face — les douze clips de la passe v6

Repartie du **graphe d'animation** plutôt que des noms de fichiers, la passe v6
donne pour chaque clip le nœud qui le déclare et la fenêtre que ce nœud déclare —
c'est vérifiable ligne à ligne dans `transitions.json`.

| Fichier dérivé | Animation source Overte | Nœud du graphe | Fenêtre (images), durée |
| --- | --- | --- | --- |
| `idle-4.vrma` | `idle02.fbx` | `masterIdle2` | 1→400 ×0,75, 17,73 s |
| `idle-7.vrma` | `idleWS_all.fbx` | `idleWS_all` | 1→1620 ×0,7, 18,90 s |
| `idle-talking-5.vrma` | `talk04.fbx` | `talk04` | 1→500, 16,63 s |
| `idle-talking-6.vrma` | `talk_lefthand.fbx` | `talk_lefthand` | 1→500, 16,63 s |
| `idle-talking-7.vrma` | `talk_righthand.fbx` | `talk_righthand` | 1→502, 16,73 s |
| `think-2.vrma` | `idle_once_lookleftright.fbx` | `idle_once_lookleftright` | 1→375 ×0,7, 17,81 s |
| `nod-2.vrma` | `emote_agree_acknowledge.fbx` | `positiveAcknowledge` | 1→64, 2,10 s |
| `nod-3.vrma` | `emote_agree_headnodyes.fbx` | `positiveHeadNodYes` | 1→94, 3,10 s |
| `nod-4.vrma` | `emote_agree_longheadnod.fbx` | `positiveLongHeadNod` | 1→68, 2,20 s |
| `nod-5.vrma` | `emote_agree_thoughtfulheadnod.fbx` | `positiveThoughtfulHeadNod` | 1→84, 2,73 s |
| `raise-hand.vrma` | `emote_raisehand03_all.fbx` | `raiseHand03` intro + boucle + sortie | 1→300, 9,97 s |
| `raise-hand-2.vrma` | `emote_raisehand04_all.fbx` | `raiseHand04` intro + boucle + sortie | 1→400, 13,27 s |

`happy.vrma` a été **reconverti** depuis la même source et la même fenêtre
(`emote_clap01_all.fbx`, images 1 → 160) par la chaîne de la passe v6 : son écart
au socle passe de 8,0 à 5,3 cm, sur la pire de ses quatre mesures. Le fichier
précédent n'était ni tronqué ni fautif — il sortait simplement d'une chaîne de
conversion antérieure. `happy-2.vrma` et `happy-3.vrma` ont été **laissés en
place** : leurs reconversions mesurent moins bien (7,4 → 8,7 cm et 8,0 → 14,9 cm,
la seconde parce que la version livrée rogne un reliquat de pose parasite de
quinze images que la reconversion garde).

**Ralenti de lecture.** Trois de ces clips sont joués par Overte à une cadence
réduite que son graphe déclare (`timeScale` : 0,75 pour `idle02`, 0,70 pour
`idleWS_all` et `idle_once_lookleftright`). Le nombre d'images ne change pas, la
durée si : `idle-4` dure 17,73 s au lieu de 13,30. C'est **déjà appliqué au
fichier**.

*The twelve clips added by pass v6, taken from Overte's animation graph rather
than from file names: each row gives the graph node that declares the clip and the
frame window that node declares. Three of them are played at a reduced rate that
Overte's graph declares (`timeScale`), already baked into the file. `happy.vrma`
was re-converted from the same source and window by the v6 chain (8.0 → 5.3 cm to
the base pose); `happy-2` and `happy-3` were left in place, their re-conversions
measuring worse.*

### Domaine monde 3D / 3D-world domain

Les fenêtres reprises sont celles que le graphe d'animation d'Overte
(`interface/resources/avatar/avatar-animation.json`) déclare lui-même pour chaque
clip (`startFrame` / `endFrame` / `loopFlag`), à 30 images/s. `AnimClip` reboucle
de `endFrame` vers `startFrame` : le cycle vaut donc `endFrame − startFrame + 1`
images, et l'image suivant `endFrame` est déjà la copie de `startFrame`.

*The windows used are the ones Overte's own animation graph declares for each clip.*

| Fichier dérivé | Animation source Overte | Fenêtre (images) | Segment repris |
| --- | --- | --- | --- |
| `world-walk-slow.vrma` | `walk_short_fwd.fbx` | 1 → 40 | cycle entier, 1,300 s |
| `world-walk.vrma` | `walk_fwd.fbx` | 1 → 30 | cycle entier, 1,000 s |
| `world-walk-fast.vrma` | `walk_fwd_fast.fbx` | 1 → 26 | cycle entier, 0,867 s |
| `world-walk-back.vrma` | `walk_bwd.fbx` | 1 → 37 | cycle entier, 1,233 s |
| `world-turn-left.vrma` | `turn_left.fbx` | 1 → 33 | cycle entier, 1,100 s |
| `world-turn-right.vrma` | `turn_right.fbx` | 1 → 31 | cycle entier, 1,000 s |
| `world-walk-start.vrma` | `idle_to_walk.fbx` | 1 → 13 | intégralité, 0,400 s, extrémités ancrées (voir ci-dessous) |
| `world-walk-stop.vrma` | `settle_to_idle.fbx` | 1 → 59 | intégralité, 1,900 s, extrémités ancrées (voir ci-dessous) |
| `world-sit-idle.vrma` | `sitting_idle.fbx` | 0 → 800 | sous-boucle de 13,333 s |
| `world-sit-idle-2.vrma` | `sitting_idle04.fbx` | 1 → 800 | sous-boucle de 13,333 s |
| `world-sit-talking.vrma` | `sitting_talk02.fbx` | 1 → 271 | sous-boucle de 7,133 s |
| `world-sit-talking-2.vrma` | `sitting_talk03.fbx` | 1 → 252 | sous-boucle de 6,533 s |
| `world-sit-look.vrma` | `sitting_idle_once_lookaround.fbx` | 1 → 324 | intégralité, 10,767 s |
| `world-sit-shift.vrma` | `sitting_idle_once_shiftweight.fbx` | 1 → 282 | intégralité, 9,333 s |

Modifications apportées / changes made : os Mixamo mappés vers les os humanoïdes
VRM 1.0, frame de bind pose parasite retirée, échelle cm → m, ré-échantillonnage
à 30 fps, export en `VRMC_vrm_animation` 1.0.

### Domaine monde 3D — les soixante-cinq clips de la passe v6

| Fichier dérivé | Animation source Overte | Nœud du graphe | Fenêtre (images), durée |
| --- | --- | --- | --- |
| **allures** | | | |
| `world-jog.vrma` | `jog_fwd.fbx` | `walkFwdJog_c` | 1→18, 0,60 s |
| `world-run.vrma` | `run_fast_fwd.fbx` | `walkFwdRun_c` | 1→19, 0,63 s |
| `world-walk-back-fast.vrma` | `walk_bwd_fast.fbx` | `walkBwdFast_c` | 1→28, 0,93 s |
| `world-jog-back.vrma` | `jog_bwd.fbx` | `jogBwd_c` | 1→20, 0,67 s |
| `world-run-back.vrma` | `run_bwd.fbx` | `runBwd_c` | 1→14, 0,47 s |
| `world-strafe-left.vrma` | `walk_left.fbx` | `strafeLeftWalk_c` | 1→35, 1,13 s |
| `world-strafe-right.vrma` | `walk_right.fbx` | `strafeRightWalk_c` | 1→35, 1,13 s |
| `world-strafe-left-fast.vrma` | `walk_left_fast.fbx` | `strafeLeftWalkFast_c` | 1→21, 0,67 s |
| `world-strafe-right-fast.vrma` | `walk_right_fast.fbx` | `strafeRightFast_c` | 1→21, 0,67 s |
| `world-strafe-left-jog.vrma` | `jog_left.fbx` | `strafeLeftJog_c` | 1→20, 0,67 s |
| `world-strafe-right-jog.vrma` | `jog_right.fbx` | `strafeRightJog_c` | 1→20, 0,67 s |
| `world-strafe-left-run.vrma` | `run_fast_left.fbx` | `strafeLeftRun_c` | 1→19, 0,63 s |
| `world-strafe-right-run.vrma` | `run_fast_right.fbx` | `strafeRightRun_c` | 1→19, 0,63 s |
| `world-step-left.vrma` | `side_step_left.fbx` | `stepLeft_c` | 1→20, 0,67 s |
| `world-step-left-short.vrma` | `side_step_short_left.fbx` | `stepLeftShort_c` | 1→30, 1,00 s |
| `world-step-left-fast.vrma` | `side_step_left_fast.fbx` | `strafeLeftAnim_c` | 1→16, 0,53 s |
| **arrêts** | | | |
| `world-walk-stop-2.vrma` | `settle_to_idle02.fbx` | `idleSettle02` | 1→40, 1,27 s |
| `world-walk-stop-3.vrma` | `settle_to_idle03.fbx` | `idleSettle03` | 1→60, 1,97 s |
| `world-walk-stop-4.vrma` | `settle_to_idle04.fbx` | `idleSettle04` | 1→82, 2,70 s |
| `world-walk-stop-small.vrma` | `settle_to_idle_small.fbx` | `idleSettleSmall` | 1→40, 1,27 s |
| **repos alternés et leurs transitions** | | | |
| `world-idle-alt1.vrma` | `idle_LFF_all.fbx` | `altIdle1` | 80→388, 10,30 s |
| `world-idle-alt1-enter.vrma` | `idle_LFF_all.fbx` | `transitionToAltIdle1` | 1→80 ×0,65, 4,05 s |
| `world-idle-alt1-exit.vrma` | `idle_LFF_all.fbx` | `alt1ToMasterIdle` | 388→472, 2,77 s |
| `world-idle-alt2.vrma` | `idle_RFF_all.fbx` | `altIdle2` | 80→388, 10,30 s |
| `world-idle-alt2-enter.vrma` | `idle_RFF_all.fbx` | `transitionToAltIdle2` | 1→80 ×0,65, 4,05 s |
| `world-idle-alt2-exit.vrma` | `idle_RFF_all.fbx` | `alt2ToMasterIdle` | 388→453, 2,10 s |
| **gestes tenus** | | | |
| `world-clap-in.vrma` | `emote_clap01_all.fbx` | `applaudClap01Intro` | 1→17, 0,53 s |
| `world-clap-hold.vrma` | `emote_clap01_all.fbx` | `applaudClap01Loop` | 17→111, 3,17 s |
| `world-clap-out.vrma` | `emote_clap01_all.fbx` | `applaudClap01Outro` | 111→160, 1,60 s |
| `world-point-in.vrma` | `emote_point01_all.fbx` | `reactionPointIntro` | 1→21, 0,67 s |
| `world-point-hold.vrma` | `emote_point01_all.fbx` | `reactionPointLoop` | 21→100, 2,67 s |
| `world-point-out.vrma` | `emote_point01_all.fbx` | `reactionPointOutro` | 100→134, 1,13 s |
| `world-raise-hand-in.vrma` | `emote_raisehand01_all.fbx` | `raiseHand01Intro` | 1→18, 0,57 s |
| `world-raise-hand-hold.vrma` | `emote_raisehand01_all.fbx` | `raiseHand01Loop` | 18→378, 12,03 s |
| `world-raise-hand-out.vrma` | `emote_raisehand01_all.fbx` | `raiseHand01Outro` | 378→435, 1,90 s |
| **maintiens assis** | | | |
| `world-sit-idle-3.vrma` | `sitting_idle02.fbx` | `seatedIdle02` | 1→800, 13,23 s |
| `world-sit-idle-4.vrma` | `sitting_idle03.fbx` | `seatedIdle03` | 0→800, 13,33 s |
| `world-sit-idle-5.vrma` | `sitting_idle05.fbx` | `seatedIdle05` | 1→332, 11,03 s |
| `world-sit-talking-3.vrma` † | `sitting_talk04.fbx` | `seatedTalk04` | 0→442, 10,43 s |
| **micro-variations assises** | | | |
| `world-sit-fidget.vrma` | `sitting_idle_once_fidget.fbx` | `seatedFidgeting` | 1→428, 14,20 s |
| `world-sit-lean.vrma` | `sitting_idle_once_leanforward.fbx` | `seatedFidgetLeanForward` | 1→178, 5,90 s |
| `world-sit-lookfidget.vrma` | `sitting_idle_once_lookfidget.fbx` | `seatedFidgetLookFidget` | 1→420, 13,97 s |
| `world-sit-look-2.vrma` | `sitting_idle_once_lookleftright.fbx` | `seatedFidgetLookLeftRight` | 1→120, 3,97 s |
| `world-sit-legs.vrma` | `sitting_idle_once_shakelegs.fbx` | `seatedFidgetShakeLegs` | 1→140, 4,60 s |
| `world-sit-shifting.vrma` | `sitting_idle_once_shifting.fbx` | `seatedFidgetShifting` | 1→744, 24,73 s |
| **pivots assis** | | | |
| `world-sit-turn-left.vrma` | `sitting_turn_left.fbx` | `seatedTurnLeft` | 1→200, 6,63 s |
| `world-sit-turn-left-end.vrma` | `settle_sitturnleft_to_sitidle.fbx` | `seatedTurnLeft_to_Idle` | 1→45, 1,47 s |
| `world-sit-turn-right.vrma` | `sitting_turn_right.fbx` | `seatedTurnRight` | 1→200, 6,63 s |
| `world-sit-turn-right-end.vrma` | `settle_sitturnright_to_sitidle.fbx` | `seatedTurnRight_to_Idle` | 1→45, 1,47 s |
| **accord assis** | | | |
| `world-sit-nod.vrma` | `sitting_emote_agree_headnod.fbx` | `seatedReactionPositiveHeadNod` | 1→44, 1,40 s |
| `world-sit-nod-2.vrma` | `sitting_emote_agree_headnodyes.fbx` | `seatedReactionPositiveHeadNodYes` | 1→78, 2,53 s |
| `world-sit-nod-3.vrma` † | `sitting_emote_agree_longheadnod.fbx` | `seatedReactionPositiveLongHeadNod` | 1→65, 2,13 s |
| `world-sit-ack.vrma` | `sitting_emote_agree_acknowledge.fbx` | `seatedReactionPositiveAcknowledge` | 1→64, 2,10 s |
| **désaccord assis** | | | |
| `world-sit-shake.vrma` † | `sitting_emote_disagree_headshake.fbx` | `seatedReactionNegativeDisagreeHeadshake` | 0→64, 2,13 s |
| `world-sit-dismiss.vrma` | `sitting_emote_disagree_dismiss.fbx` | `seatedReactionNegativeDisagreeDismiss` | 0→70, 2,30 s |
| `world-sit-disbelief.vrma` | `sitting_emote_disagree_disbelief.fbx` | `seatedReactionNegativeDisagreeDisbelief` | 1→124, 4,10 s |
| `world-sit-sad.vrma` | `sitting_emote_disagree_drophead.fbx` | `seatedReactionNegativeDisagreeDropHead` | 0→99, 3,27 s |
| **joie assise** | | | |
| `world-sit-clap.vrma` † | `sitting_emote_clap_all.fbx` | `seatedReactionApplaud` intro+boucle+sortie | 0→99, 3,27 s |
| `world-sit-clap-2.vrma` | `sitting_emote_clap02_all.fbx` | `seatedReactionApplaud02` idem | 0→132, 4,40 s |
| `world-sit-clap-3.vrma` | `sitting_emote_clap03_all.fbx` | `seatedReactionApplaud03` idem | 0→136, 4,50 s |
| `world-sit-cheer.vrma` | `sitting_emote_agree_cheer.fbx` | `seatedReactionPositiveCheer` | 1→78, 2,53 s |
| **pointage et lever de main assis** | | | |
| `world-sit-point.vrma` †‡ | `sitting_emote_point_all.fbx` | `seatedReactionPoint` intro+boucle+sortie | 1→134, 4,43 s |
| `world-sit-raise-hand.vrma` † | `sitting_emote_raisehand_all.fbx` | `seatedReactionRaiseHand` idem | 0→400, 13,30 s |
| `world-sit-raise-hand-2.vrma` †‡ | `sitting_emote_raisehand02_all.fbx` | `seatedReactionRaiseHand02` idem | 0→435, 14,50 s |
| `world-sit-raise-hand-3.vrma` | `sitting_emote_raisehand03_all.fbx` | `seatedReactionRaiseHand03` idem | 0→296, 9,87 s |

Modifications apportées / changes made : mêmes opérations que ci-dessus (os
Mixamo → os humanoïdes VRM 1.0, T-pose de bind d'`emote_clap01_all.fbx` imposée,
échelle cm → m, ré-échantillonnage à 30 fps, translation horizontale annulée sur
les allures et les pivots, export en `VRMC_vrm_animation` 1.0), plus les trois
retouches décrites ci-dessous.

### † Bas du corps rendu aux clips assis / seated clips given their lower body

Sept FBX assis d'Overte n'ont **aucune piste sur le bassin** :
`sitting_emote_agree_longheadnod`, `_disagree_headshake`, `_clap_all`,
`_point_all`, `_raisehand_all`, `_raisehand02_all` et `sitting_talk04`. Overte s'en
accommode parce que chez lui ces clips sont posés **par-dessus** le maintien assis
par un nœud `overlay` limité au haut du corps : le bassin vient de la couche du
dessous. Isolés dans un `.vrma`, leur bassin resterait à la pose de bind —
c'est-à-dire **debout**, sous un corps assis. Le bassin de `sitting_idle.fbx` leur
a donc été rendu, constant ; les sept retombent exactement sur la hauteur d'assise
commune, **0,5409**.

**‡ Deux d'entre eux avaient perdu davantage.** `sitting_emote_point_all.fbx` et
`sitting_emote_raisehand02_all.fbx` n'ont pas non plus de piste sur les **six os
des jambes**. Le bassin rendu ne suffisait donc pas : les jambes restaient à la
pose de repos du rig — debout — sous un bassin assis, et les deux clips mesuraient
**50,5 cm** d'écart au maintien assis, portés par `leftLowerLeg` (105° sur
`rightLowerLeg`), à l'identique puisque c'est la même pose de repos qui était en
cause. Les six os ont reçu la posture assise de `world-sit-idle`, prise en pose
moyenne donc constante — la posture assise d'Overte l'est : la dispersion de la
source sur un tour de boucle vaut 0 à 0,2°. Écart après greffe : **5,4 et 5,5 cm**.
Le pic de vitesse angulaire des deux clips est inchangé (340 et 545 °/s) : la
correction ne rajoute aucune secousse.

*Seven seated Overte FBX carry no hip track at all — Overte plays them as an
upper-body overlay on top of the seated hold, so the hips come from the layer
below. They were given the constant hips of `sitting_idle.fbx`. Two of them,
`sitting_emote_point_all` and `sitting_emote_raisehand02_all`, were missing the six
leg bones as well, which left their legs standing under a seated pelvis (50.5 cm
of gap); they were given the seated leg posture of `world-sit-idle`, constant
(source dispersion 0–0.2°). Gap after the graft: 5.4 and 5.5 cm, peak angular speed
unchanged.*

### Ancrage des quatre nouveaux arrêts / anchoring of the four new stops

`settle_to_idle` était déjà **ancré** sur le cycle de marche à la passe v5 ; ses
quatre frères ne l'étaient pas. À la meilleure phase du cycle ils laissaient encore
10,5 / 13,1 / 15,3 / 12,8 cm là où l'arrêt ancré laisse 0 — la différence n'était
pas dans les clips mais dans le traitement. La même passe leur a donc été
appliquée : **première image forcée sur la pose de `world-walk` à t = 0** (la
couture du cycle), **dernière image forcée sur `idle`**, la correction se
dissolvant vers l'intérieur sur une fenêtre en `smoothstep` de 0,50 s côté marche
et 0,40 s côté repos.

| Clip | Correction côté marche | Correction côté repos | Pic de vitesse |
| --- | --- | --- | --- |
| `world-walk-stop-2` | 41,1° (`rightHand`), bassin +1,4 cm | 1,8° (`hips`) | 271 → 263 °/s |
| `world-walk-stop-3` | 36,1° (`rightHand`), bassin +6,5 cm | 1,8° (`hips`) | 244 → 219 °/s |
| `world-walk-stop-4` | 34,7° (`rightLowerArm`), bassin +1,5 cm | 5,1° (`rightHand`) | 256 → 218 °/s |
| `world-walk-stop-small` | 25,2° (`leftLowerLeg`) | 6,3° (`neck`) | 77 → 77 °/s |

Les cinq arrêts partagent désormais **le même contrat de phase** — quitter le cycle
de marche sur sa couture — si bien que le code peut en tirer un au hasard sans rien
changer à sa sortie. Les trois jointures de chacune des quatre séquences mesurent
**0 / 0 / 0 cm**, comme celles de l'arrêt déjà livré. Aucun pic de vitesse n'a
augmenté.

*The four new stops got the same anchoring pass as `world-walk-stop` had in v5:
first frame forced onto `world-walk` at t = 0 (the cycle seam), last frame onto
`idle`, correction dissolving over a smoothstep window. All five stops now share
the same exit-phase contract, and each of the four sequences measures 0 / 0 / 0 cm
at its three seams. No peak angular speed went up.*

### Ralenti de lecture / playback slowdown

Deux clips de ce lot (`world-idle-alt1-enter`, `world-idle-alt2-enter`) sont joués
par Overte à `timeScale` 0,65, déclaré dans son graphe. Le nombre d'images ne
change pas, la durée si : 4,05 s au lieu de 2,63. C'est **déjà appliqué au
fichier**, et consigné dans `world.json` (`source.timeScale`).

### Ancrage des transitions de marche / anchoring of the walk transitions

`world-walk-start` et `world-walk-stop` viennent d'Overte comme le cycle qu'ils
encadrent, et pourtant leurs jointures mesuraient 34,8 et 57,5 cm. La cause n'est
pas la fenêtre de découpe — balayée de l'image 13 à l'image 40 de
`idle_to_walk.fbx`, elle ne descend jamais sous 19,5 cm — mais la **phase** : un
cycle de marche repris à t=0, ou quitté à une phase quelconque, tombe forcément
loin d'un départ ou d'un arrêt figés. Le graphe d'Overte le dit à sa façon : il
quitte `WALKFWD` vers `idleSettle` avec `interpType: snapshotPrev` sur quinze
images, c'est-à-dire en fondu depuis un instantané, sans jamais prétendre raccorder
les poses.

Les deux clips ont donc été ancrés sur la phase que la mesure désigne : la dernière
image de `world-walk-start` est la pose de `world-walk` à **0,200 s** (image 6 sur
30 — la phase la plus proche, 7,6 cm avant ancrage), la première image de
`world-walk-stop` est celle de `world-walk` à **0** (la couture du cycle, 16,4 cm
avant ancrage) ; leurs extrémités debout sont ancrées sur `idle`. Corrections :
31,4° et 28,2° pour le départ, 21,5° et 6,3° pour l'arrêt, dissoutes sur 0,20 à
0,50 s, sans changer le pic de vitesse du clip (517 → 515 et 140 → 139 °/s).

Les trois jointures de la séquence de marche passent ainsi de 34,8 / 57,5 / 3,2 cm
à **0 / 0 / 0 cm**, à condition que le code respecte les phases consignées dans
`world.json` (`enchaine.phaseEntreeCibleS`, `enchaine.phaseSortieCibleS`).

*Both walk transitions were anchored onto the phase of the walk cycle the
measurement points at — entry at 0.200 s, exit on the cycle seam — after sweeping
every cut window of `idle_to_walk.fbx` failed to get below 19.5 cm. The seams go
from 34.8 / 57.5 / 3.2 cm to 0 / 0 / 0 cm, provided the code honours the phases
recorded in `world.json`.*

Pose de repos imposée. Les FBX assis d'Overte portent la pose **assise** dans la
transformation locale de leurs nœuds (mesuré : `sitting_idle.fbx` a ses hanches de
repos à 0,5916 m contre 1,0167 m pour `idle.fbx`) — un FBX d'animation sans maillage
n'a pas de bind pose, et les nœuds gardent simplement la pose dans laquelle la
scène a été enregistrée. Comme cette pose fixe `restHipsPosition`, donc le facteur
par lequel `@pixiv/three-vrm-animation` met à l'échelle toute la piste du bassin,
la T-pose de bind d'`emote_clap01_all.fbx` est imposée à tous les clips.

Traitement du bassin, selon l'usage du clip :

- **allures et pivots** : translation horizontale annulée. Le cycle est joué sur
  place, et la vitesse qu'il dépeint est mesurée puis consignée dans `world.json`.
- **assis** : la hauteur du bassin est conservée telle quelle (c'est la hauteur
  d'assise) ; seul l'horizontal est recentré, résidu borné à 2 cm.
- **transitions** : recentrage horizontal borné à 3 cm.

Verrouillage du bas du corps (`world-sit-talking`, `world-sit-talking-2`) :
`sitting_talk02.fbx` et `sitting_talk03.fbx` sont assis sur un siège plus haut que
la famille des `sitting_idle` (bassin à 0,575 de la hauteur de hanches au repos
contre 0,541, pied gauche 19 cm plus en arrière). Les neuf os du bas du corps et la
hauteur du bassin reçoivent donc la posture constante de `world-sit-idle` (écart
retiré : jusqu'à 21,2° sur le pied droit) ; le geste de parole reste entier dans le
buste, les bras, les mains et la tête.

### Sous-dossier `extra/` — dix-neuf clips convertis, non retenus

Le sous-dossier [`extra/`](extra) porte **19 clips** (5,22 Mo) issus de la même
passe et de la **même source** : tous dérivent d'Overte, sous la même licence
Apache-2.0, avec les mêmes modifications que celles décrites ci-dessus. Ils ne sont
jamais chargés par l'application — `/api/vrm-animations` ne liste que la racine de
`vrma/` — mais ils sont **redistribués avec elle**, et la mention Apache-2.0 de ce
paragraphe les couvre exactement comme les autres. Le pourquoi de leur mise à
l'écart, clip par clip, est dans [`README.md`](README.md#extra--les-clips-convertis-et-non-retenus).

*The `extra/` subfolder holds 19 clips (5.22 MB) from the same pass and the **same
source**: all derive from Overte under the same Apache-2.0 licence, with the same
modifications described above. The application never loads them, but they are
redistributed with it and this section's notice covers them like the rest.*

| Fichier dérivé | Animation source Overte | Nœud du graphe | Fenêtre (images), durée |
| --- | --- | --- | --- |
| `cand-idle-fenetre.vrma` | `idle.fbx` | `masterIdle1` | 1→300, 10,00 s |
| `cand-idle-2-fenetre.vrma` | `idle04.fbx` | `masterIdle4` | 1→902, 30,07 s |
| `cand-idle-3-fenetre.vrma` | `idle03.fbx` | `masterIdle3` | 1→800, 26,63 s |
| `cand-idle-talking-fenetre.vrma` | `talk_armsdown.fbx` | `talk_armsdown` | 1→215, 7,13 s |
| `happy-5.vrma` | `emote_clap02_all.fbx` | `applaudClap02Intro+Loop+Outro` | 1→115, 3,77 s |
| `happy-6.vrma` | `emote_clap03_all.fbx` | `applaudClap03Intro+Loop+Outro` | 1→149, 4,93 s |
| `idle-talking-2.vrma` | `talk.fbx` | `talk` | 1→500, 16,63 s |
| `idle-talking-3.vrma` | `talk02.fbx` | `talk02` | 1→325, 10,80 s |
| `idle-talking-4.vrma` | `talk03.fbx` | `talk03` | 1→300, 10,00 s |
| `neutral-2.vrma` | `idle_once_slownod.fbx` | `idle_once_slownod` | 1→91, 2,97 s |
| `point.vrma` | `emote_point01_all.fbx` | `reactionPointIntro+Loop+Outro` | 1→134, 4,43 s |
| `raise-hand.passe-complete.vrma` | `emote_raisehand01_all.fbx` | `raiseHand01Intro+Loop+Outro` | 1→435, 14,47 s |
| `relaxed-3.vrma` | `idle_once_fidget.fbx` | `idle_once_fidget` | 1→429, 14,27 s |
| `world-afk-texting.vrma` | `afk_texting.fbx` | *aucun — orphelin du graphe* | fichier entier, 11,03 s |
| `world-jump-start.vrma` | `jump_standing_launch_all.fbx` | `takeoffStand` | 1→16, 0,50 s |
| `world-jump-air.vrma` | `jump_standing_apex_all.fbx` | `inAirStandApex` | 2→2, 0,40 s |
| `world-jump-land.vrma` | `jump_standing_land_settle_all.fbx` | `landStandImpact+landStand` | 1→68, 2,20 s |
| `world-jump-run-start.vrma` | `jump_running_launch_land_all.fbx` | `TAKEOFFRUN` | 4→15, 0,37 s |
| `world-jump-run-land.vrma` | `jump_running_launch_land_all.fbx` | `LANDRUN` | 29→40, 0,33 s |

Aucun de ces dix-neuf clips n'est joué ralenti : leur `timeScale` vaut 1 dans le
graphe, la durée annoncée est la durée du fichier. `raise-hand.passe-complete.vrma`
est le seul renommé — il porte la **passe complète** du lever de main, quand la
racine livre sous `raise-hand.vrma` la seule intro (`raiseHand01Intro`) ; le suffixe
n'existe que pour éviter la collision de noms.

Deux fichiers FBX n'apparaissent que dans cette table : `afk_texting.fbx`, orphelin
du graphe d'Overte, et `jump_running_launch_land_all.fbx`, dont les deux fenêtres
`TAKEOFFRUN` et `LANDRUN` ne servent qu'au saut en course.

---

## 2. CMU Graphics Lab Motion Capture Database — SOURCE RETIRÉE

**Plus aucun fichier de ce dossier ne dérive de la base CMU.** Les quinze gestes
d'émotion qui en venaient (via la conversion BVH « Daz-friendly, hip-corrected »
de **Bruce Hahne / cgspeed**) ont tous été retirés : `angry`, `angry-2`, `happy-2`,
`happy-3`, `laugh`, `laugh-2`, `relaxed`, `relaxed-2`, `sad-2`, `sad-3`, `shy`,
`surprised`, `surprised-2`, `surprised-3`, `wave`. Six ont été remplacés par des
animations Overte, neuf simplement supprimés.

Ni CMU ni Bruce Hahne n'imposaient de contrainte de redistribution autre que le
remerciement d'usage : **ce retrait ne lève aucune obligation qui pesait sur ce
dossier, et n'en crée aucune.** La mention est conservée ici parce qu'elle
documente l'histoire des fichiers, pas parce qu'elle est encore exigée.

*No file in this folder derives from the CMU database any more.* Fifteen emotion
gestures came from it; six were replaced by Overte animations, nine removed. CMU
and Bruce Hahne imposed no redistribution constraint beyond the customary
acknowledgement, so this removal lifts no obligation and creates none.

### Pourquoi / why

La règle d'acceptation du domaine face à face est que l'enchaînement
socle → geste → socle ne doit pas s'accrocher. Chiffrée : l'écart de pose entre la
**première** image d'un clip et la pose de repos du socle, et entre sa **dernière**
image et cette même pose, doit rester sous **10 cm** d'excursion du pire os majeur
— mesuré contre `idle.vrma` et contre `idle-talking.vrma`. Sous ce seuil, les
fondus de 0,3 s (entrée) et 0,4 s (sortie) sont invisibles ; au-dessus, le corps
est tiré et les pieds glissent sans pas.

Chaque clip donne quatre mesures : entrée et sortie, contre chacun des deux socles.
Les quinze clips CMU échouaient **tous**, sur les **soixante** mesures sans
exception : de 25,1 à 57 cm, médiane 34,3 (par clip, la pire des quatre allait de
26,1 à 57 cm, médiane 42,4). Les dix clips Overte passaient tous, sur les quarante
mesures : de 0,8 à 8,0 cm, médiane 4,4 (pire par clip : 4,3 à 8,0, médiane 5,7).
Aucune valeur, dans aucun des deux lots, ne tombait entre 8,0 et 25,1 cm — les deux
sources se séparent d'elles-mêmes, sans zone grise, et n'importe quel seuil posé
dans ce trou de 17 cm donne la même partition.

La cause n'est pas le geste mais la **station** : le sujet capturé se tient
autrement (bassin de repos à 0,83 m contre 1,0167 m, jambes à 15° de la pose du
socle) et les segments étaient découpés automatiquement dans une prise continue,
donc ni le début ni la fin n'est une pose de repos. Verrouiller le bas du corps sur
le socle ramenait `sad-2` sous le seuil (29,2 → 5,1 cm en entrée, 28,4 → 6,4 en
sortie) mais il ne restait alors que 8,9° d'amplitude sur l'os le plus mobile,
soit deux fois le bruit de respiration du socle lui-même (3,8°) : un clip
invisible. Pour les autres, le verrouillage ne suffisait pas — l'entrée restait à
11 cm (`relaxed-2`), 14,5 (`happy-3`), 15,8 (`relaxed`), 37 (`laugh`).

Trois clips portaient en plus un défaut d'origine : `angry-2` avait **40
transitions collées au plafond d'écrêtage de 1000 °/s** sur les six os des deux
bras (pointe réelle 2680 °/s, 95ᵉ centile du clip à 1000 °/s), `laugh-2` 20
transitions sur cinq os (2914 °/s) et `wave` 13 sur le seul `rightHand`
(1560 °/s) — du bruit de capture sur les mains et les avant-bras, la base CMU
n'ayant aucun marqueur de main.

- Base d'origine / original database : <https://mocap.cs.cmu.edu>
- Conversion BVH / BVH conversion : <https://www.cgspeed.com> (section motion capture)

### Émotion restée sans geste / emotion left with no gesture

`surprised` n'a **plus aucun clip** : les 127 animations d'Overte ne comportent
aucune émote de surprise ou de sursaut, et les trois clips CMU qui la portaient
finissaient en pleine gesticulation, bras loin du repos (40,3 / 44 / 49,9 cm en
sortie ; un verrouillage des jambes empirait même `surprised`, 49,8 → 53,8 cm). Le
déclenchement ne trouve alors rien et l'avatar continue simplement de respirer,
sans rien casser. Couvrir cette émotion demanderait une autre source, ou un clip
écrit à la main.

*`surprised` has no clip left: Overte's 127 animations contain no surprise or
startle emote. The trigger finds nothing and the avatar simply keeps breathing.*

---

## 3. Quaternius — CC0 1.0 Universal

**Deux fichiers** dérivent de l'**Universal Animation Library** de **Quaternius**,
publiée sous **CC0 1.0 Universal** — domaine public, aucune attribution requise,
mais elle reste appréciée et nous la donnons quand même.

*Two files derive from **Quaternius**'s **Universal Animation Library**, released
under **CC0 1.0 Universal** — public domain, no attribution required, though
appreciated, and we give it anyway.*

<https://quaternius.com>

| Fichier dérivé | Clip source | Pourquoi il reste |
| --- | --- | --- |
| `world-sit-enter.vrma` | `Sitting_Enter` | Overte n'a aucune transition debout → assis |
| `world-sit-exit.vrma` | `Sitting_Exit` | Overte n'a aucune transition assis → debout |

Le reste du pack a été écarté : mesurées au banc contre le VRM réel, les animations
d'Overte l'emportent partout où elles ont un équivalent. Les animations de repos
venaient elles aussi de ce pack ; la bibliothèque de Quaternius est destinée aux
jeux d'action (sa pose de repos est une garde de combat, poings fermés, une jambe
devant l'autre).

*The rest of the pack was set aside: measured on the bench against the real VRM,
Overte's animations win wherever they have an equivalent.*

### Retouches sur les transitions assises / changes to the seated transitions

Ce sont les deux seuls clips de la bibliothèque qui ne viennent pas d'Overte, et
c'est exactement là que la séquence d'assise se décousait : mesurées au banc,
`idle → world-sit-enter` et `world-sit-exit → idle` valaient **42 cm** d'écart de
pose, et les jointures avec le maintien assis **10,7 cm**. Le clip ne partait pas
de la station debout et n'arrivait pas sur la posture assise du studio d'à côté.
Faute d'équivalent chez Overte — son graphe d'animation passe de `idle` à `seated`
par un simple fondu de six images, il n'existe aucune animation de « s'asseoir » à
convertir —, les deux clips ont été **ancrés sur leurs voisines** plutôt que jetés.

1. **Joués sur place.** Ces clips gardaient la translation du bassin (26,7 cm entre
   la station debout et l'assise) alors que tous les maintiens assis d'Overte sont
   recentrés sur l'origine : quelle que soit l'extrémité qu'on recale sur zéro,
   l'autre se retrouvait à 26 cm de sa voisine. La translation horizontale est donc
   **annulée d'un bout à l'autre**, comme sur les allures, et les 26,7 cm sont
   consignés dans `world.json` (`deplacementCodeM`) : c'est au code de les reporter sur
   la position du personnage.
2. **Extrémités ancrées.** La première et la dernière image sont forcées sur les
   poses voisines — pose moyenne d'`idle` d'un côté, `world-sit-idle` de l'autre —
   et la correction se dissout vers l'intérieur sur une fenêtre en `smoothstep`
   (0,40 s côté debout, 0,30 s côté assis). Elle vaut au maximum 35,2° sur la jambe
   et 3,8 cm de bassin côté debout, 27,4° sur la main côté assis. La tête et les
   orteils, que `world-sit-idle` n'anime pas, sont ramenés sur la pose de repos du
   rig — c'est elle que le lecteur y restaure.

Écarts aux quatre jointures de la séquence `idle → sit-enter → sit-idle →
sit-exit → idle`, mesurés sur le VRM réel : **42,1 → 1,7 cm**, **10,7 → 0 cm**,
**11,0 → 1,0 cm**, **42,0 → 0,3 cm**. Le pic de vitesse angulaire du clip est
inchangé (321 et 479 °/s, déjà présents avant l'ancrage) : la correction ne rajoute
aucune secousse.

*Both seated transitions were anchored onto their neighbours instead of being
dropped: Overte has no sit-down animation at all — its graph cross-fades from
`idle` to `seated` in six frames. The four seams of the seated sequence went from
42.1 / 10.7 / 11.0 / 42.0 cm down to 1.7 / 0 / 1.0 / 0.3 cm.*

### Le saut, retiré / the jump, removed

Les trois clips `world-jump-*` (Quaternius `Jump_Start`, `Jump_Loop`, `Jump_Land`)
**ont été retirés de la bibliothèque**. Mesurés au banc, leurs jointures valaient
47,5 cm entre `idle` et l'appel, 42 cm entre la phase aérienne et l'atterrissage,
30,3 cm entre l'atterrissage et `idle` ; deux d'entre eux sautaient de 23 cm de
pose en une seule image. Les équivalents d'Overte existent pourtant
(`jump_standing_launch_all.fbx`, `jump_standing_apex_all.fbx`,
`jump_standing_land_settle_all.fbx`, déclarés dans le graphe sous `takeoffStand`,
`inAirStand*` et `landStand*`) : convertis et mesurés, ils raccordent bien
l'atterrissage au repos (3,4 cm) mais pas mieux le reste (25,9 cm depuis `idle`,
35,8 puis 56,6 cm entre les trois temps). La raison est structurelle : chez Overte
la phase aérienne n'est pas une animation mais **trois poses fixes mélangées par la
vitesse verticale du moteur physique**, et la hauteur du saut est portée par la
simulation, pas par le fichier. Un saut crédible demande donc du code, pas des
clips — et un compagnon de conversation qui se promène dans une pièce n'en a pas
besoin. La règle du projet s'applique : mieux vaut une capacité absente qu'un
mouvement qui accroche l'œil.

*The three jump clips were removed. Neither Quaternius's nor Overte's version joins
up: Overte's airborne phase is not an animation but three fixed poses blended by
the physics engine's vertical speed, and the jump height lives in the simulation,
not in the file. A believable jump needs code, not clips.*

---

## 4. Répartition / breakdown

**Bibliothèque active** (racine de `vrma/`) : 109 fichiers `.vrma`, **18,82 Mo** —
un peu plus de 19,3 Mo avec `world.json`, `transitions.json` et les deux documents :

| Source | Licence | Fichiers | Domaine |
| --- | --- | --- | --- |
| Overte | Apache-2.0 | 107 | 28 face à face, 79 monde 3D |
| Quaternius | CC0-1.0 | 2 | monde 3D (les deux transitions assises) |
| Overte — `transitions.json` | Apache-2.0 | 1 | le graphe d'animation, hors clips |

**Réserve** (`extra/`, jamais chargée par l'app) : 19 fichiers `.vrma`, **5,22 Mo**,
**tous Overte / Apache-2.0** — soit **24,03 Mo de clips au total, 128 fichiers**, dont
126 Overte. Redistribués mais non joués, ils portent les mêmes obligations que les
autres ; le détail fichier par fichier est au §1.

*Active library (root of `vrma/`): 109 clips, 18.82 MB. Spare (`extra/`, never
loaded): 19 clips, 5.22 MB, all Overte — 128 files and 24.03 MB of clips in all, 126
of them Overte. Redistributed though never played, they carry the same obligations.*

**Deux sources, et une seule licence à respecter** : Apache-2.0 pour Overte, le
reste étant en domaine public. Le domaine face à face est intégralement Overte.

*Two sources, and only one licence to comply with: Apache-2.0 for Overte, the rest
being public domain. The face-to-face domain is entirely Overte.*

Quinze clips Quaternius ont été retirés de ce dossier à la reconstruction de la
bibliothèque : `hit-chest`, `hit-head`, `pickup`, `dance`, `swim`, `swim-idle`,
`crouch-idle`, `crouch-walk`, `interact` (aucun usage dans une application de
conversation, et ces familles n'existent pas chez Overte, donc elles ne pourraient
jamais être amenées au niveau du reste) ; `walk`, `walk-formal`, `jog`, `sprint`,
`sit-idle`, `sit-talking` (remplacés par les clips Overte équivalents, mesurés
meilleurs). Rien de tout cela n'était sous contrainte d'attribution : leur retrait
ne change aucune obligation.

*Fifteen Quaternius clips were removed when the library was rebuilt; none of them
carried an attribution requirement, so their removal changes no obligation.*

## 5. Historique des passes / history of the passes

- **v1** : première conversion (Overte FBX + CMU BVH + Quaternius glTF).
- **v2** : corrections géométriques des gestes d'émotion CMU — bas du corps
  verrouillé en orientation monde sur la pose de repos debout de l'ancien
  `idle.vrma`, hauteur des hanches recalée avec ballant borné, lacet du bassin
  borné à ±12° image par image avec ancrage des bords, inclinaison du bassin
  comprimée au-delà de 15°, `think` recoupé de 10,77 s à 3,37 s, reliquats de bind
  pose rognés en tête de `happy` et `shake`.
- **v3** : nouveau socle de repos (Overte `idle.fbx` en remplacement de la garde de
  combat Quaternius), `idle-2` et `idle-3` ajoutés.
- **v4** : application de la règle d'acceptation au domaine face
  à face (§2). Les corrections de la passe v2 avaient été calées sur l'**ancien**
  socle, donc sur une pose qui n'existe plus ; plutôt que de les refaire, la source
  a été changée. Les six gestes remplacés sortent d'Overte sans aucune correction
  géométrique — même studio, même station, les raccords tombent d'eux-mêmes entre
  1,2 et 8,0 cm sur leurs vingt-quatre mesures.
- **v5** : la même règle appliquée au domaine monde 3D, mais aux
  **jointures des séquences** cette fois — ce n'est pas l'écart d'un clip au repos
  qui compte (un clip assis en est forcément à 45 cm), c'est l'écart à chaque
  jointure de l'enchaînement que l'application jouera. Les deux transitions assises
  ont été ancrées sur leurs voisines (§3), les deux transitions de marche sur la
  phase du cycle que la mesure désigne (§1), et le saut a été retiré (§3). Séquence
  d'assise : 42,1 / 10,7 / 11,0 / 42,0 cm → **1,7 / 0 / 1,0 / 0,3**. Séquence de
  marche : 34,8 / 57,5 / 3,2 cm → **0 / 0 / 0**, à la condition, écrite dans
  `world.json`, que le code entre dans le cycle à 0,200 s et en sorte sur sa
  couture. Le fichier `world.json` a par ailleurs été remis d'accord avec la mesure :
  `distanceParCycleM ÷ dureeS` redonne maintenant exactement `vitesseMS` sur les
  quatre allures, ce qui n'était pas le cas (2,6 à 4 % d'écart), et les valeurs
  annoncées tiennent dans la fourchette mesurée.

- **v6, la passe courante** : le pack d'Overte repris **par son graphe** plutôt que
  par ses noms de fichiers. Les 127 FBX déclarent 204 nœuds `clip` répartis sur 34
  machines à états ; c'est ce graphe qui dit la fenêtre exacte de chaque clip, sa
  cadence de lecture, et la façon dont Overte l'enchaîne. 77 clips sont entrés
  (12 en face à face, 65 dans le monde 3D), `happy` a été reconverti, et
  `transitions.json` — le graphe lui-même, exploitable — est livré à côté d'eux.
  Trois corrections tenaient à la lecture du graphe : les **cinq clips joués
  ralentis** (`timeScale` 0,65 à 0,75) durent maintenant ce qu'ils doivent durer ;
  les **sept clips assis sans bassin** ont retrouvé celui du maintien assis, et
  **deux d'entre eux leurs six os de jambes** (50,5 → 5,4 cm) ; les **quatre
  nouveaux arrêts** ont reçu la passe d'ancrage de la v5 (0 / 0 / 0 cm aux trois
  jointures). Enfin, deux repos et deux gestes tenus qui échouaient la règle du
  face à face y sont entrés **sous le préfixe `world-`**, où ils sont séquencés par
  une transition dédiée au lieu d'être fondus : l'enchaînement complet reste sous
  6 cm là où le clip seul en valait 15.

*v6, the current pass: Overte's pack taken from its **animation graph** rather than
from its file names. 77 clips entered (12 face-to-face, 65 in the 3D world),
`happy` was re-converted, and `transitions.json` — the graph itself, made
machine-readable — ships beside them. Three fixes came straight out of reading the
graph: the five clips Overte plays **slowed down** now last what they should; the
seven seated clips with **no hip track** got the seated hold's hips back, and two
of them their six leg bones as well (50.5 → 5.4 cm); the four new **stops** got the
v5 anchoring pass (0 / 0 / 0 cm at their three seams). Two idles and two held
gestures that failed the face-to-face rule entered under the `world-` prefix
instead, where they are sequenced rather than cross-faded.*
