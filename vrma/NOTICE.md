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

Six fichiers dérivent des animations d'avatar du projet **Overte**
(`overte-org/overte`, `interface/resources/avatar/animations/`).

*Six files derive from the avatar animations of the **Overte** project.*

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

| Fichier dérivé | Animation source Overte |
| --- | --- |
| `happy.vrma` | `emote_clap01_all.fbx` |
| `sad.vrma` | `emote_disagree_drophead.fbx` |
| `neutral.vrma` | `idle_once_headtilt.fbx` |
| `nod.vrma` | `emote_agree_headnod.fbx` |
| `shake.vrma` | `emote_disagree_annoyedheadshake.fbx` |
| `think.vrma` | `idle_once_lookaround.fbx` |

Modifications apportées / changes made : os Mixamo mappés vers les os humanoïdes
VRM 1.0, frame de bind pose parasite retirée, échelle cm → m, ré-échantillonnage
à 30 fps, translation horizontale des hanches supprimée, export en
`VRMC_vrm_animation` 1.0.

---

## 2. CMU Graphics Lab Motion Capture Database

Quinze fichiers dérivent de la base de capture de mouvement du **CMU Graphics
Lab**, via la conversion BVH « Daz-friendly, hip-corrected » (v1.0, 2010) de
**Bruce Hahne / cgspeed**.

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

Les vingt-deux autres fichiers de ce dossier (`idle`, `idle-talking`, `walk`,
`sit-*`, `swim`, `jump-*`, `dance`…) dérivent de l'**Universal Animation
Library** de **Quaternius**, publiée sous **CC0 1.0 Universal** — domaine
public, aucune attribution requise, mais elle reste appréciée.

*The other twenty-two files in this folder derive from **Quaternius**'s
**Universal Animation Library**, released under **CC0 1.0 Universal** — public
domain, no attribution required, though appreciated.*

<https://quaternius.com>

---

## 4. Modifications supplémentaires de la passe v2 / additional v2 changes

Ce dossier est la **v2** du lot : mêmes sources, mêmes licences, mêmes
remerciements exigés. Modifications ajoutées par `optimise-emotes.mjs` :
bas du corps verrouillé en orientation monde sur la pose de repos debout
d'`idle.vrma` (15 clips), hauteur des hanches recalée sur la même référence
avec ballant borné, lacet du bassin borné à ±12° image par image avec ancrage
des bords (10 clips), inclinaison du bassin comprimée au-delà de 15° (2 clips),
`think` recoupé de 10,77 s à 3,37 s, reliquats de bind pose rognés en tête de
`happy` et `shake`. Détail et mesures : `rapport.md`.

*This folder is **v2** of the batch: same sources, same licences, same required
acknowledgements. Changes added on top of the v1 conversion, per clip, are
documented in `rapport.md`.*
