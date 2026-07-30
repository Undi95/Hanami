# Animations VRM (.vrma)

Animations du squelette humanoïde au format **VRMA** (extension glTF
`VRMC_vrm_animation` 1.0) : un fichier = un clip, indépendant du modèle. N'importe
quel `.vrm` peut les jouer, aucun réglage à faire.

Ces fichiers **sont committés** avec l'app : ils sont sous licence libre et tout
le monde doit avoir la même scène.

## Convention de nommage

Le nom du fichier fait office de configuration — il n'y a pas de fichier de mapping.

| Nom | Rôle |
| --- | --- |
| `idle.vrma` | socle joué en boucle (sans lui, aucune animation n'est jouée) |
| `happy.vrma`, `sad.vrma`, `angry.vrma`, `surprised.vrma`, `relaxed.vrma`, `neutral.vrma` | geste joué une fois quand le personnage exprime cette émotion, puis retour à l'idle |
| `pose-sit.vrma`, `pose-stand.vrma`… | postures en boucle qui REMPLACENT l'idle |
| suffixe `-2`, `-3`… (`idle-2.vrma`, `happy-2.vrma`) | variantes du même rôle, tirées au hasard |

Tout autre nom est simplement ignoré : les clips livrés ici qui ne portent pas un
nom du tableau (marche, saut, danse…) sont là comme matière première pour la suite.

## Crédits

Clips issus de l'**Universal Animation Library** de **Quaternius**
(<https://quaternius.com>), **CC0 1.0** (domaine public), convertis en `.vrma`
par `scripts/convert-animations.mjs`.

---

# VRM animations (.vrma)

Humanoid skeleton animations in the **VRMA** format (glTF `VRMC_vrm_animation`
1.0 extension): one file = one clip, independent from the model. Any `.vrm` can
play them, with no setup.

These files **are committed** with the app: they are freely licensed and everyone
should get the same scene.

## Naming convention

The file name IS the configuration — there is no mapping file.

| Name | Role |
| --- | --- |
| `idle.vrma` | looping base pose (without it, no animation is played at all) |
| `happy.vrma`, `sad.vrma`, `angry.vrma`, `surprised.vrma`, `relaxed.vrma`, `neutral.vrma` | one-shot gesture played when the character expresses that emotion, then back to idle |
| `pose-sit.vrma`, `pose-stand.vrma`… | looping postures that REPLACE the idle |
| `-2`, `-3`… suffix (`idle-2.vrma`, `happy-2.vrma`) | variants of the same role, picked at random |

Any other name is silently ignored: the clips shipped here that do not match a
row above (walk, jump, dance…) are raw material for what comes next.

## Credits

Clips from the **Universal Animation Library** by **Quaternius**
(<https://quaternius.com>), **CC0 1.0** (public domain), converted to `.vrma`
with `scripts/convert-animations.mjs`.
