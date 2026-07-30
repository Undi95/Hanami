# Animations VRM (.vrma)

Animations du squelette humanoïde au format **VRMA** (extension glTF
`VRMC_vrm_animation` 1.0) : un fichier = un clip, indépendant du modèle. N'importe
quel `.vrm` peut les jouer, aucun réglage à faire.

Ces fichiers **sont committés** avec l'app : ils sont sous licence libre et tout
le monde doit avoir la même scène.

## Deux domaines

La bibliothèque se partage en deux domaines aux exigences opposées, et **le
préfixe du nom suffit à les distinguer** :

| Domaine | Nom | Contenu | Poids |
| --- | --- | --- | --- |
| **face à face** | pas de préfixe | l'avatar debout devant l'utilisateur qui discute : repos, repos en train de parler, gestes d'émotion | 25 fichiers, 2,94 Mo |
| **monde 3D** | préfixe `world-` | la scène interactive où le personnage marche, divague et s'assoit : allures, départ et arrêt, virages, postures assises, saut | 19 fichiers, 2,54 Mo |

Le face à face est **sévère** : on n'y ajoute un geste que s'il est utile, agréable
et crédible pour quelqu'un qui discute assis. On enrichit ce qui existe (une
variante `-2`, `-3`) plutôt que d'inventer une catégorie : le vocabulaire de
déclenchement doit rester court.

Le monde 3D est **généreux** : la scène a besoin de matière, et ces clips ne sont
jamais joués en face à face.

**Le chargement paresseux est voulu.** En mode face à face, les 2,54 Mo du domaine
`world-` n'ont aucune raison d'être téléchargés — c'est précisément pourquoi la
frontière tient dans le nom du fichier et pas dans un fichier de configuration.

## Convention de nommage

Le nom du fichier fait office de configuration — il n'y a pas de fichier de mapping.

### Face à face

| Nom | Rôle |
| --- | --- |
| `idle.vrma` | socle joué en boucle (sans lui, aucune animation n'est jouée) |
| `idle-talking.vrma` | socle joué en boucle pendant qu'une réponse s'écrit |
| `happy.vrma`, `sad.vrma`, `angry.vrma`, `surprised.vrma`, `relaxed.vrma`, `neutral.vrma` | geste joué une fois quand le personnage exprime cette émotion, puis retour à l'idle |
| `nod.vrma`, `shake.vrma`, `think.vrma`, `laugh.vrma`, `wave.vrma`, `shy.vrma` | gestes de conversation, sans mot-clé dédié : à déclencher par lecture du texte de la réponse |
| suffixe `-2`, `-3`… (`idle-2.vrma`, `happy-2.vrma`) | variantes du même rôle, tirées au hasard |

### Monde 3D

| Nom | Rôle |
| --- | --- |
| `world-walk-slow`, `world-walk`, `world-walk-fast`, `world-walk-back` | allures, jouées **en boucle et sur place** : la translation horizontale est nulle, c'est au code de déplacer le personnage à la vitesse consignée |
| `world-turn-left`, `world-turn-right` | pivots sur place, en boucle, même principe pour la rotation |
| `world-walk-start`, `world-walk-stop` | départ et arrêt, joués une fois |
| `world-sit-enter`, `world-sit-exit` | s'asseoir et se lever, joués une fois |
| `world-sit-idle`, `world-sit-idle-2` | maintien assis, en boucle — **remplacent** le socle |
| `world-sit-talking`, `world-sit-talking-2` | maintien assis pendant qu'une réponse s'écrit |
| `world-sit-look`, `world-sit-shift` | micro-variations assises, jouées une fois |
| `world-jump-start`, `world-jump-loop`, `world-jump-land` | saut : appel, phase aérienne, atterrissage |

Tout autre nom est simplement ignoré.

## `world.json` — ce que le nom ne peut pas dire

Un nom de fichier ne peut pas porter une vitesse. [`world.json`](world.json)
consigne donc, pour chaque clip du domaine monde 3D, les grandeurs mesurées dont
le code a besoin :

- **allures** : distance parcourue par cycle et vitesse en m/s. Les cycles sont
  joués sur place ; sans cette vitesse, le personnage patine ou glisse.
- **postures assises** : la hauteur du bassin, en **fraction de la hauteur de
  hanches au repos**. Tous les clips assis tiennent la même (0,541), y compris les
  extrémités assises des transitions : le siège se place donc à une hauteur unique.
- **transitions assises** : le déplacement horizontal (24,5 cm) dont le personnage
  s'écarte du siège en se levant, à reporter sur sa position.
- **qualité de boucle** : écart de pose au raccord, et vitesse angulaire juste
  avant et juste après — une boucle peut être parfaite en pose et donner un coup
  de fouet si la vitesse saute.
- doigts animés ou non, durée, taille.

Les hauteurs et les vitesses sont des fractions ou des valeurs mesurées sur un rig
dont les hanches au repos sont à 1,0167 m. Sur un modèle plus petit, les mettre à
l'échelle par `hanchesDuVRM / 1,0167`, sinon le personnage patine.

## Crédits

Trois provenances, toutes libres de redistribution. Les crédits complets du projet
sont réunis dans le [README](../README.fr.md#crédits) ; le détail fichier par
fichier, les avis de licence et les mentions à conserver sont dans
[`NOTICE.md`](NOTICE.md), à lire avant toute redistribution :

- **Overte** — **Apache 2.0** : les quatre repos, six gestes, et tout le domaine
  monde 3D sauf les transitions assises et le saut (14 clips).
- **Quaternius**, *Universal Animation Library* — **CC0 1.0**, domaine public :
  les transitions assises et le saut (5 clips), les deux familles qu'Overte n'a pas.
- **CMU Graphics Lab Motion Capture Database**, conversion BVH de Bruce Hahne —
  libre d'usage, **remerciements exigés** : quinze gestes d'émotion.

---

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
| **face to face** | no prefix | the avatar standing in front of the user, talking: idles, talking idle, emotion gestures | 25 files, 2.94 MB |
| **3D world** | `world-` prefix | the interactive scene where the character walks, wanders and sits down: gaits, start and stop, turns, seated postures, jump | 19 files, 2.54 MB |

Face to face is **strict**: a gesture only earns its place if it is useful,
pleasant and believable for someone having a conversation. Enrich what exists (a
`-2`, `-3` variant) rather than inventing a category — the trigger vocabulary must
stay short.

The 3D world is **generous**: the scene needs material, and these clips are never
played face to face.

**Lazy loading is intended.** In face-to-face mode, the 2.54 MB of the `world-`
domain have no reason to be downloaded — which is exactly why the boundary lives
in the file name rather than in a config file.

## Naming convention

The file name IS the configuration — there is no mapping file.

### Face to face

| Name | Role |
| --- | --- |
| `idle.vrma` | looping base pose (without it, no animation is played at all) |
| `idle-talking.vrma` | looping base pose played while a reply is being written |
| `happy.vrma`, `sad.vrma`, `angry.vrma`, `surprised.vrma`, `relaxed.vrma`, `neutral.vrma` | one-shot gesture played when the character expresses that emotion, then back to idle |
| `nod.vrma`, `shake.vrma`, `think.vrma`, `laugh.vrma`, `wave.vrma`, `shy.vrma` | conversation gestures, with no dedicated keyword: to be triggered by reading the reply text |
| `-2`, `-3`… suffix (`idle-2.vrma`, `happy-2.vrma`) | variants of the same role, picked at random |

### 3D world

| Name | Role |
| --- | --- |
| `world-walk-slow`, `world-walk`, `world-walk-fast`, `world-walk-back` | gaits, played **looping and in place**: horizontal translation is zero, it is up to the code to move the character at the recorded speed |
| `world-turn-left`, `world-turn-right` | in-place turns, looping, same principle for rotation |
| `world-walk-start`, `world-walk-stop` | start and stop, played once |
| `world-sit-enter`, `world-sit-exit` | sitting down and standing up, played once |
| `world-sit-idle`, `world-sit-idle-2` | seated hold, looping — **replaces** the base pose |
| `world-sit-talking`, `world-sit-talking-2` | seated hold while a reply is being written |
| `world-sit-look`, `world-sit-shift` | seated micro-variations, played once |
| `world-jump-start`, `world-jump-loop`, `world-jump-land` | jump: launch, airborne, landing |

Any other name is silently ignored.

## `world.json` — what a name cannot say

A file name cannot carry a speed. [`world.json`](world.json) therefore records,
for each 3D-world clip, the measured quantities the code needs:

- **gaits**: distance travelled per cycle, and speed in m/s. The cycles are played
  in place; without that speed the character skates or slides.
- **seated postures**: hip height, as a **fraction of the rest hip height**. Every
  seated clip holds the same one (0.541), including the seated ends of the
  transitions: the seat therefore has a single height.
- **seated transitions**: the horizontal displacement (24.5 cm) by which the
  character moves away from the seat when standing up, to be applied to its position.
- **loop quality**: pose gap at the seam, and angular speed just before and just
  after it — a loop can be perfect in pose and still snap if the speed jumps.
- fingers animated or not, duration, size.

Heights and speeds are fractions, or values measured on a rig whose rest hips sit
at 1.0167 m. On a smaller model, scale them by `vrmHips / 1.0167`, otherwise the
character skates.

## Credits

Three origins, all free to redistribute. The project's full credits are gathered
in the [README](../README.md#credits); the file-by-file breakdown, the licence
notices and the mentions to keep are in [`NOTICE.md`](NOTICE.md), which must be
read before any redistribution:

- **Overte** — **Apache 2.0**: all four idles, six gestures, and the whole 3D-world
  domain except the seated transitions and the jump (14 clips).
- **Quaternius**, *Universal Animation Library* — **CC0 1.0**, public domain: the
  seated transitions and the jump (5 clips), the two families Overte does not have.
- **CMU Graphics Lab Motion Capture Database**, BVH conversion by Bruce Hahne —
  free to use, **acknowledgement required**: fifteen emotion gestures.
