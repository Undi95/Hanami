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

**Vingt-quatre fichiers sur quarante-quatre** dérivent des animations d'avatar du
projet **Overte** (`overte-org/overte`, `interface/resources/avatar/animations/`,
127 fichiers FBX) : les quatre animations de repos, qui sont le socle permanent de
la scène, six gestes, et tout le domaine monde 3D sauf les transitions assises et
le saut. C'est la source principale de la bibliothèque.

Ces animations ont été produites en interne chez High Fidelity par un animateur,
dans Maya — les métadonnées internes des FBX déclarent
`Original|ApplicationName = Maya` et des chemins de projet
`C:\hifi-animation\anim_resource\<nom>.mb`. Ce n'est ni de la capture brute ni du
Mixamo recyclé : la recherche de chaînes ne donne aucune occurrence de « mixamo »
ou « adobe », et aucun os ne porte le préfixe `mixamorig:`.

*Twenty-four files out of forty-four derive from the avatar animations of the
**Overte** project (127 FBX files): all four idle animations, which are the
permanent base of the scene, six gestures, and the whole 3D-world domain except
the seated transitions and the jump. It is the library's primary source. These
animations were hand-made in-house at High Fidelity by an animator, in Maya.*

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

| Fichier dérivé | Animation source Overte | Segment repris |
| --- | --- | --- |
| `idle.vrma` | `idle.fbx` | intégralité (10,000 s) |
| `idle-talking.vrma` | `talk_armsdown.fbx` | 0,033 → 7,133 s |
| `idle-2.vrma` | `idle04.fbx` | 0,033 → 30,067 s |
| `idle-3.vrma` | `idle03.fbx` | sous-boucle 4,833 → 18,167 s |
| `happy.vrma` | `emote_clap01_all.fbx` | intégralité |
| `sad.vrma` | `emote_disagree_drophead.fbx` | intégralité |
| `neutral.vrma` | `idle_once_headtilt.fbx` | intégralité |
| `nod.vrma` | `emote_agree_headnod.fbx` | intégralité |
| `shake.vrma` | `emote_disagree_annoyedheadshake.fbx` | intégralité |
| `think.vrma` | `idle_once_lookaround.fbx` | 1er tour de regard, 3,37 s |

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

## 2. CMU Graphics Lab Motion Capture Database

Quinze fichiers dérivent de la base de capture de mouvement du **CMU Graphics
Lab**, via la conversion BVH « Daz-friendly, hip-corrected » (v1.0, 2010) de
**Bruce Hahne / cgspeed**. Tous appartiennent au domaine face à face.

*Fifteen files derive from the **CMU Graphics Lab Motion Capture Database**, via
the "Daz-friendly, hip-corrected" BVH conversion (v1.0, 2010) by **Bruce Hahne /
cgspeed**.*

### Remerciements exigés / required acknowledgement

> The data used in this project was obtained from mocap.cs.cmu.edu.
> The database was created with funding from NSF EIA-0196217.

### Conditions d'usage / usage rights

> Use this data! This data is free for use in research and commercial projects
> worldwide.

CMU n'impose aucune restriction sur le jeu de données d'origine ; Bruce Hahne
n'ajoute aucune restriction sur sa conversion BVH.

*CMU places no restrictions on the original dataset; Bruce Hahne adds no further
restrictions to his BVH conversion.*

- Base d'origine / original database : <https://mocap.cs.cmu.edu>
- Conversion BVH / BVH conversion : <https://www.cgspeed.com> (section motion capture)

| Fichier dérivé | Prise CMU | Description de l'index CMU |
| --- | --- | --- |
| `happy-2.vrma` | 142_09 | Joy |
| `happy-3.vrma` | 142_08 | Happy |
| `sad-2.vrma` | 142_15 | Sad |
| `sad-3.vrma` | 79_72 | crying |
| `angry.vrma` | 18_10 | quarrel — angry hand gestures (2 subjects — subject A) |
| `angry-2.vrma` | 80_48 | arguing |
| `surprised.vrma` | 142_16 | Scared |
| `surprised-2.vrma` | 142_17 | Scared |
| `surprised-3.vrma` | 79_73 | scared |
| `relaxed.vrma` | 142_13 | Relaxed |
| `relaxed-2.vrma` | 142_04 | Cool |
| `wave.vrma` | 141_16 | Wave Hello |
| `laugh.vrma` | 79_70 | laughing |
| `laugh-2.vrma` | 80_44 | laughing |
| `shy.vrma` | 142_19 | Shy |

Modifications apportées / changes made : os DAZ gen3/gen4 mappés vers les os
humanoïdes VRM 1.0 (doigts non repris — le mocap CMU n'a pas de marqueurs de
main), échelle cm → m, frames de bind pose parasites retirées, extraction
automatique d'un segment de 2 à 5,5 s, ré-échantillonnage 120 → 30 fps avec
moyennage, écrêtage des vitesses angulaires au-delà de 1000 °/s (joint flips du
mocap non nettoyé), lacet global annulé pour que le personnage regarde l'avant
VRM (+Z), translation horizontale des hanches supprimée, export en
`VRMC_vrm_animation` 1.0.

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
trois images, plafond 900 °/s — aucun clip Overte de la bibliothèque ne dépasse
517 °/s.

---

## 4. Répartition / breakdown

44 fichiers, 5,48 Mo au total :

| Source | Licence | Fichiers | Domaine |
| --- | --- | --- | --- |
| Overte | Apache-2.0 | 24 | 10 face à face, 14 monde 3D |
| CMU Graphics Lab / Bruce Hahne | libre, remerciements exigés | 15 | face à face |
| Quaternius | CC0-1.0 | 5 | monde 3D |

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

## 5. Modifications supplémentaires de la passe v2 / additional v2 changes

Mêmes sources, mêmes licences, mêmes remerciements exigés. Modifications ajoutées
aux quinze gestes d'émotion par `optimise-emotes.mjs` :
bas du corps verrouillé en orientation monde sur la pose de repos debout
d'`idle.vrma` (15 clips), hauteur des hanches recalée sur la même référence
avec ballant borné, lacet du bassin borné à ±12° image par image avec ancrage
des bords (10 clips), inclinaison du bassin comprimée au-delà de 15° (2 clips),
`think` recoupé de 10,77 s à 3,37 s, reliquats de bind pose rognés en tête de
`happy` et `shake`. Détail et mesures : `rapport.md`.

*This folder is **v2** of the batch: same sources, same licences, same required
acknowledgements. Changes added on top of the v1 conversion, per clip, are
documented in `rapport.md`.*
