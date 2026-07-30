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
| `idle-talking.vrma` | socle joué en boucle pendant qu'une réponse s'écrit |
| `happy.vrma`, `sad.vrma`, `angry.vrma`, `surprised.vrma`, `relaxed.vrma`, `neutral.vrma` | geste joué une fois quand le personnage exprime cette émotion, puis retour à l'idle |
| `pose-sit.vrma`, `sit-idle.vrma`… (préfixes `pose-` et `sit-`) | postures en boucle qui REMPLACENT l'idle — jamais déclenchées seules, elles attendent la phase interactive |
| suffixe `-2`, `-3`… (`idle-2.vrma`, `happy-2.vrma`) | variantes du même rôle, tirées au hasard |

Tout autre nom est simplement ignoré : les clips livrés ici qui ne portent pas un
nom du tableau (marche, saut, danse…) sont là comme matière première pour la suite.

## Crédits

Trois provenances, toutes libres de redistribution — le détail fichier par
fichier, les avis de licence complets et les mentions à conserver sont dans
[`NOTICE.md`](NOTICE.md), à lire avant toute redistribution :

- **Quaternius**, *Universal Animation Library* — **CC0 1.0**, domaine public
  (idle, marche, assis, saut, nage, danse…).
- **Overte** — **Apache 2.0** (`happy`, `sad`, `neutral`, `nod`, `shake`, `think`).
- **CMU Graphics Lab Motion Capture Database**, conversion BVH de Bruce Hahne —
  libre d'usage, remerciements exigés (les autres gestes d'émotion).

Conversion en `.vrma` par `scripts/convert-animations.mjs`.

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
| `idle-talking.vrma` | looping base pose played while a reply is being written |
| `happy.vrma`, `sad.vrma`, `angry.vrma`, `surprised.vrma`, `relaxed.vrma`, `neutral.vrma` | one-shot gesture played when the character expresses that emotion, then back to idle |
| `pose-sit.vrma`, `sit-idle.vrma`… (`pose-` and `sit-` prefixes) | looping postures that REPLACE the idle — never triggered on their own, they are waiting for the interactive phase |
| `-2`, `-3`… suffix (`idle-2.vrma`, `happy-2.vrma`) | variants of the same role, picked at random |

Any other name is silently ignored: the clips shipped here that do not match a
row above (walk, jump, dance…) are raw material for what comes next.

## Credits

Three origins, all free to redistribute — the file-by-file breakdown, the full
licence notices and the mentions to keep are in [`NOTICE.md`](NOTICE.md), which
must be read before any redistribution:

- **Quaternius**, *Universal Animation Library* — **CC0 1.0**, public domain
  (idle, walk, sit, jump, swim, dance…).
- **Overte** — **Apache 2.0** (`happy`, `sad`, `neutral`, `nod`, `shake`, `think`).
- **CMU Graphics Lab Motion Capture Database**, BVH conversion by Bruce Hahne —
  free to use, acknowledgement required (the other emotion gestures).

Converted to `.vrma` with `scripts/convert-animations.mjs`.
