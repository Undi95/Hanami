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

**Trente fichiers sur trente-cinq** dérivent des animations d'avatar du projet
**Overte** (`overte-org/overte`, `interface/resources/avatar/animations/`,
127 fichiers FBX) : **tout le domaine face à face** — les quatre animations de
repos, qui sont le socle permanent de la scène, et les douze gestes — ainsi que
tout le domaine monde 3D sauf les transitions assises et le saut. C'est la source
de la bibliothèque, à cinq fichiers près.

Ces animations ont été produites en interne chez High Fidelity par un animateur,
dans Maya — les métadonnées internes des FBX déclarent
`Original|ApplicationName = Maya` et des chemins de projet
`C:\hifi-animation\anim_resource\<nom>.mb`. Ce n'est ni de la capture brute ni du
Mixamo recyclé : la recherche de chaînes ne donne aucune occurrence de « mixamo »
ou « adobe », et aucun os ne porte le préfixe `mixamorig:`.

*Thirty files out of thirty-five derive from the avatar animations of the
**Overte** project (127 FBX files): the whole face-to-face domain — all four idle
animations, which are the permanent base of the scene, and the twelve gestures —
plus the whole 3D-world domain except the seated transitions and the jump. It is
the library's source, bar five files. These animations were hand-made in-house at
High Fidelity by an animator, in Maya.*

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
| `happy.vrma` | `emote_clap01_all.fbx` | intégralité, 5,30 s |
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
| `world-walk-start.vrma` | `idle_to_walk.fbx` | 1 → 13 | intégralité, 0,400 s |
| `world-walk-stop.vrma` | `settle_to_idle.fbx` | 1 → 59 | intégralité, 1,900 s |
| `world-sit-idle.vrma` | `sitting_idle.fbx` | 0 → 800 | sous-boucle de 13,333 s |
| `world-sit-idle-2.vrma` | `sitting_idle04.fbx` | 1 → 800 | sous-boucle de 13,333 s |
| `world-sit-talking.vrma` | `sitting_talk02.fbx` | 1 → 271 | sous-boucle de 7,133 s |
| `world-sit-talking-2.vrma` | `sitting_talk03.fbx` | 1 → 252 | sous-boucle de 6,533 s |
| `world-sit-look.vrma` | `sitting_idle_once_lookaround.fbx` | 1 → 324 | intégralité, 10,767 s |
| `world-sit-shift.vrma` | `sitting_idle_once_shiftweight.fbx` | 1 → 282 | intégralité, 9,333 s |

Modifications apportées / changes made : os Mixamo mappés vers les os humanoïdes
VRM 1.0, frame de bind pose parasite retirée, échelle cm → m, ré-échantillonnage
à 30 fps, export en `VRMC_vrm_animation` 1.0.

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

**Cinq fichiers** dérivent de l'**Universal Animation Library** de **Quaternius**,
publiée sous **CC0 1.0 Universal** — domaine public, aucune attribution requise,
mais elle reste appréciée et nous la donnons quand même.

*Five files derive from **Quaternius**'s **Universal Animation Library**, released
under **CC0 1.0 Universal** — public domain, no attribution required, though
appreciated, and we give it anyway.*

<https://quaternius.com>

| Fichier dérivé | Clip source | Pourquoi il reste |
| --- | --- | --- |
| `world-sit-enter.vrma` | `Sitting_Enter` | Overte n'a aucune transition debout → assis |
| `world-sit-exit.vrma` | `Sitting_Exit` | Overte n'a aucune transition assis → debout |
| `world-jump-start.vrma` | `Jump_Start` | chez Overte, la phase aérienne du saut n'existe que sous forme de trois poses fixes pilotées par le moteur |
| `world-jump-loop.vrma` | `Jump_Loop` | idem |
| `world-jump-land.vrma` | `Jump_Land` | idem |

Le reste du pack a été écarté : mesurées au banc contre le VRM réel, les animations
d'Overte l'emportent partout où elles ont un équivalent. Les animations de repos
venaient elles aussi de ce pack ; la bibliothèque de Quaternius est destinée aux
jeux d'action (sa pose de repos est une garde de combat, poings fermés, une jambe
devant l'autre).

*The rest of the pack was set aside: measured on the bench against the real VRM,
Overte's animations win wherever they have an equivalent.*

### Retouches sur les transitions assises / changes to the seated transitions

1. **Recalage horizontal.** Ces clips gardaient la translation du bassin (le
   personnage recule de 27 cm pour se poser) alors que les maintiens assis d'Overte
   sont recentrés sur l'origine : l'enchaînement téléportait le bassin de 27,6 cm.
   L'extrémité assise est ramenée sur `(x=0, z=0)`, l'origine assise que tiennent
   les maintiens. Les 24,5 cm restants sont consignés dans `world.json`
   (`deplacementM`) : c'est au code de les reporter sur la position du personnage.
2. **Raccordement de la posture assise.** Les deux studios n'assoient pas leur
   personnage de la même façon : 13 à 31° d'écart par os du bas du corps, bassin
   3,8 cm plus haut. Au fondu, un pied glissait de 20 cm au moment précis où le
   personnage se pose. L'extrémité assise est donc interpolée vers la posture de
   `world-sit-idle`, avec un poids nul à l'extrémité debout et plein à l'extrémité
   assise : le début debout est intact, la fin assise devient rigoureusement le
   maintien. Écart de raccord mesuré : 20,3 → 10,0 cm au maximum, et l'os le plus
   éloigné n'est plus un pied mais un avant-bras.

### Retouche sur les clips de saut / changes to the jump clips

Ils sortaient à 2179 °/s sur le genou droit et 2605 °/s sur une phalange du pouce,
soit 73 puis 87° en une seule image à 30 images/s : des retournements
d'articulation, jamais nettoyés parce que `convert-animations.mjs` n'a pas de
limiteur de vitesse, contrairement à la chaîne Overte. Les 22 os fautifs de
`world-jump-start` et les 5 de `world-jump-land` ont été écrêtés puis lissés sur
trois images, plafond 900 °/s. Les clips Overte de la bibliothèque, eux, ne
dépassent 517 °/s que dans les trois applaudissements (`happy` 670, `happy-3` 765,
`happy-2` 1000 °/s au poignet gauche à l'impact des mains) : ce sont des pointes de
mouvement authentiques, pas des retournements d'articulation.

---

## 4. Répartition / breakdown

35 fichiers, 5,77 Mo au total :

| Source | Licence | Fichiers | Domaine |
| --- | --- | --- | --- |
| Overte | Apache-2.0 | 30 | 16 face à face, 14 monde 3D |
| Quaternius | CC0-1.0 | 5 | monde 3D |

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
- **v4, la passe courante** : application de la règle d'acceptation au domaine face
  à face (§2). Les corrections de la passe v2 avaient été calées sur l'**ancien**
  socle, donc sur une pose qui n'existe plus ; plutôt que de les refaire, la source
  a été changée. Les six gestes remplacés sortent d'Overte sans aucune correction
  géométrique — même studio, même station, les raccords tombent d'eux-mêmes entre
  1,2 et 8,0 cm sur leurs vingt-quatre mesures.

*v4, the current pass: the acceptance rule of §2 applied to the whole face-to-face
domain. The v2 corrections had been fitted to the OLD idle pose, which no longer
exists; rather than redo them, the source was changed. The six replacement
gestures come from Overte with no geometric correction at all.*
