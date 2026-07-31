# NOTICE — code porté d'Overte / code ported from Overte

Le moteur d'animation de personnage de Hanami contient du **code porté** (C++ et
JavaScript → TypeScript) du projet **Overte**, œuvre dérivée redistribuée sous
AGPL-3.0 comme le reste de Hanami. Les avis ci-dessous accompagnent toute
redistribution, comme l'exige l'Apache-2.0 §4. Les animations `.vrma` dérivées
d'Overte ont leur propre relevé : [`vrma/NOTICE.md`](vrma/NOTICE.md).

*Hanami's character-animation engine contains **code ported** (C++ and
JavaScript → TypeScript) from the **Overte** project, a derivative work
redistributed under AGPL-3.0 like the rest of Hanami. The notices below must
accompany any redistribution, as required by Apache-2.0 §4. The `.vrma`
animations derived from Overte have their own record: `vrma/NOTICE.md`.*

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

## Fichiers portés / ported files

Chaque fichier TypeScript ci-dessous porte l'avis de copyright d'origine et la
mention de modification exigée par l'Apache-2.0 §4(b) dans son en-tête.
*Each TypeScript file below carries the original copyright notice and the
Apache-2.0 §4(b) modification statement in its header.*

| Fichier Hanami | Sources Overte | Auteurs d'origine |
| --- | --- | --- |
| `client/src/scene/overteMath.ts` | `libraries/animation/src/AnimUtil.h/.cpp`, `libraries/shared/src/GLMHelpers.cpp`, `libraries/shared/src/GeometryUtil.cpp` | Anthony J. Thibault (9/2/15), Stephen Birarda (2014-08-07) |
| `client/src/scene/jointLimits.ts` | `libraries/animation/src/SwingTwistConstraint.cpp/.h`, `ElbowConstraint.cpp/.h`, `AnimInverseKinematics.cpp` (initConstraints, setEllipticalSwingLimits) | High Fidelity, Inc. (2015) |
| `client/src/scene/legIk.ts` (régime « reach » et anti-pop) | `libraries/animation/src/AnimTwoBoneIK.cpp/.h`, `AnimPoleVectorConstraint.cpp/.h`, `Rig.cpp` (calculateKneePoleVector, updateFeet) | Anthony J. Thibault (5/12/18) ; Howard Stearns, Seth Alves, Anthony Thibault, Andrew Meadows (7/15/15) ; Overte e.V. (2023) |
| `client/src/scene/gaze.ts` | `libraries/avatars-renderer/src/avatars-renderer/Head.cpp`, `libraries/animation/src/Rig.cpp` (updateEyeJoint), `interface/src/avatar/MyAvatar.cpp`, `scripts/developer/automaticLookAt.js` | High Fidelity, Inc. (2013-2015) ; Mark Peng (8/16/13) ; Luis Cuenca (11/11/19) ; Vircadia contributors (2020) ; Overte e.V. (2022-2023) |
| `client/src/scene/handPoses.ts` + `handPosesOverte.json` | `scripts/system/controllers/handTouch.js` (jeux `dataOpen` / `dataClose`, 60 quaternions) | Luis Cuenca (12/29/17) |

## Nature des modifications / nature of the modifications

Transcription du C++ (glm, Qt) et du JavaScript d'origine vers TypeScript ;
adaptation à three.js et au rig humanoïde normalisé de `@pixiv/three-vrm`
(repères d'os alignés sur l'avatar, rotations de repos identité) ; recalibrage
documenté de certaines limites articulaires sur la bibliothèque d'animations
livrée. Chaque écart à l'original est consigné dans les commentaires du fichier
concerné. *Transcription from the original C++ (glm, Qt) and JavaScript to
TypeScript; adaptation to three.js and to the normalized humanoid rig of
`@pixiv/three-vrm`; documented recalibration of some joint limits against the
shipped animation library. Every departure from the original is recorded in the
comments of the file concerned.*

## Auteurs d'origine du code repris / original authors of the ported code

Anthony J. Thibault, Andrew Meadows, Angus Antley, Luis Cuenca, Howard Stearns,
Seth Alves, Stephen Birarda, Mark Peng, ainsi que les contributeurs de High
Fidelity, Vircadia et Overte e.V.
