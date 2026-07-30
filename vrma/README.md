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
| **face à face** | pas de préfixe | l'avatar debout devant l'utilisateur qui discute : repos, repos en train de parler, gestes d'émotion | 16 fichiers, 3,24 Mo |
| **monde 3D** | préfixe `world-` | la scène interactive où le personnage marche, divague et s'assoit : allures, départ et arrêt, virages, postures assises | 16 fichiers, 2,26 Mo |

Le face à face est **sévère** : on n'y ajoute un geste que s'il est utile, agréable
et crédible pour quelqu'un qui discute assis. On enrichit ce qui existe (une
variante `-2`, `-3`) plutôt que d'inventer une catégorie : le vocabulaire de
déclenchement doit rester court.

### La règle d'acceptation, chiffrée

Un geste n'entre dans ce domaine que si l'enchaînement **socle → geste → socle** ne
s'accroche pas. Mesure : l'écart de pose entre la **première** image du clip et la
pose de repos du socle, et entre sa **dernière** image et cette même pose, doit
rester sous **10 cm** d'excursion du pire os majeur — contre `idle.vrma` *et*
contre `idle-talking.vrma`, puisque c'est vers ce dernier que les gestes reviennent
pendant qu'une réponse s'écrit. Sous ce seuil, les fondus de 0,3 s (entrée) et
0,4 s (sortie) sont invisibles ; au-dessus, le corps est tiré et les pieds glissent
sans pas.

Les 16 clips actuels tiennent tous entre **4,1 et 8,0 cm** sur la pire de leurs
quatre mesures (entrée et sortie, contre chacun des deux socles), médiane 6,0 ;
contre le socle `idle` seul, de **0,8 à 6,7 cm**, médiane 2,3. Un clip qui ne tient
pas ce seuil est retiré, pas rafistolé — une émotion sans geste n'est pas un drame (le
déclenchement ne trouve rien, l'avatar continue de respirer), un geste qui accroche
l'œil en est un. C'est ce qui a coûté leur place aux quinze gestes issus du mocap
CMU, et à l'émotion `surprised`, qui n'a plus aucun clip : voir
[`NOTICE.md`](NOTICE.md) §2.

### Ce que chaque émotion a aujourd'hui

| Émotion | Clips | Source |
| --- | --- | --- |
| `neutral` | `neutral` | inclinaison de tête |
| `happy` | `happy`, `happy-2`, `happy-3` | trois applaudissements |
| `sad` | `sad` | tête qui tombe |
| `angry` | `angry`, `angry-2` | dénégation agacée, dénégation posée |
| `relaxed` | `relaxed`, `relaxed-2` | étirement de la nuque, report de poids |
| `surprised` | **aucun** | Overte n'a pas d'émote de surprise |

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
| `happy.vrma`, `sad.vrma`, `angry.vrma`, `surprised.vrma`, `relaxed.vrma`, `neutral.vrma` | geste joué une fois quand le personnage exprime cette émotion, puis retour à l'idle. `surprised` est le seul rôle reconnu **sans fichier** : le déclenchement ne trouve rien et l'avatar continue de respirer |
| `nod.vrma`, `shake.vrma`, `think.vrma` | briques de conversation, sans mot-clé dédié : réservées à un déclenchement par lecture du texte de la réponse, donc **ignorées par le lecteur d'aujourd'hui** |
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
- **transitions assises** : ces clips sont eux aussi joués **sur place** ; le
  déplacement horizontal (26,7 cm) dont le personnage s'écarte du siège en se
  levant est consigné là, à reporter sur sa position.
- **transitions, `enchaine`** : d'où vient le clip, où il va, et — pour la marche —
  **à quelle phase du cycle entrer et sortir**. Les extrémités des transitions sont
  ancrées sur les poses voisines : la dernière image de `world-walk-start` *est* la
  pose de `world-walk` à 0,200 s, la première de `world-walk-stop` *est* celle de
  `world-walk` à 0. Respecter ces phases donne un raccord nul ; les ignorer redonne
  jusqu'à 46 cm d'écart.
- **`phasesDeRaccord`** : la même chose pour les six cycles, à la racine du fichier —
  meilleure image d'entrée, meilleure image de sortie, et l'écart en centimètres que
  chacune laisse. Un cycle n'a pas de « début » : c'est le code qui choisit où y
  entrer et où en sortir, et c'est ce choix qui décide du raccord.
- **qualité de boucle** : écart de pose au raccord, et vitesse angulaire juste
  avant et juste après — une boucle peut être parfaite en pose et donner un coup
  de fouet si la vitesse saute.
- doigts animés ou non, durée, taille.

Les hauteurs et les vitesses sont des fractions ou des valeurs mesurées sur un rig
dont les hanches au repos sont à 1,0167 m. Sur un modèle plus petit, les mettre à
l'échelle par `hanchesDuVRM / 1,0167`, sinon le personnage patine.

## Crédits

Deux provenances, toutes deux libres de redistribution. Les crédits complets du
projet sont réunis dans le [README](../README.fr.md#crédits) ; le détail fichier par
fichier, les avis de licence et les mentions à conserver sont dans
[`NOTICE.md`](NOTICE.md), à lire avant toute redistribution :

- **Overte** — **Apache 2.0** : **30 clips sur 32**, soit tout le domaine face à
  face (quatre repos, douze gestes) et tout le domaine monde 3D sauf les deux
  transitions assises (14 clips).
- **Quaternius**, *Universal Animation Library* — **CC0 1.0**, domaine public :
  les deux transitions assises, la seule famille qu'Overte n'a pas.

La **CMU Graphics Lab Motion Capture Database** (conversion BVH de Bruce Hahne) a
fourni quinze gestes d'émotion à la première version de cette bibliothèque ; aucun
n'a tenu la règle d'acceptation ci-dessus, et plus aucun fichier n'en dérive.

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
| **face to face** | no prefix | the avatar standing in front of the user, talking: idles, talking idle, emotion gestures | 16 files, 3.24 MB |
| **3D world** | `world-` prefix | the interactive scene where the character walks, wanders and sits down: gaits, start and stop, turns, seated postures | 16 files, 2.26 MB |

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

The current 16 clips all stay between **4.1 and 8.0 cm** on the worst of their four
measurements (in and out, against each of the two idles), median 6.0; against the
`idle` base alone, **0.8 to 6.7 cm**, median 2.3. A clip that misses the threshold
is removed, not patched — an emotion with no gesture is no drama (the
trigger finds nothing and the avatar keeps breathing), a gesture that catches the
eye is. That is what cost the fifteen CMU-mocap gestures their place, and the
`surprised` emotion all of its clips: see [`NOTICE.md`](NOTICE.md) §2.

### What each emotion has today

| Emotion | Clips | Source |
| --- | --- | --- |
| `neutral` | `neutral` | head tilt |
| `happy` | `happy`, `happy-2`, `happy-3` | three claps |
| `sad` | `sad` | head drop |
| `angry` | `angry`, `angry-2` | annoyed head shake, measured head shake |
| `relaxed` | `relaxed`, `relaxed-2` | neck stretch, weight shift |
| `surprised` | **none** | Overte has no surprise emote |

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
| `happy.vrma`, `sad.vrma`, `angry.vrma`, `surprised.vrma`, `relaxed.vrma`, `neutral.vrma` | one-shot gesture played when the character expresses that emotion, then back to idle. `surprised` is the one recognised role **with no file**: the trigger finds nothing and the avatar keeps breathing |
| `nod.vrma`, `shake.vrma`, `think.vrma` | conversation primitives, with no dedicated keyword: reserved for triggering by reading the reply text, hence **ignored by today's player** |
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

Any other name is silently ignored.

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
  walking — **at which phase of the cycle to enter and leave it**. The ends of the
  transitions are anchored onto the neighbouring poses: the last frame of
  `world-walk-start` *is* the pose of `world-walk` at 0.200 s, the first frame of
  `world-walk-stop` *is* the pose of `world-walk` at 0. Honour those phases and the
  seam is nil; ignore them and it goes back up to 46 cm.
- **`phasesDeRaccord`**: the same for all six cycles, at the root of the file — best
  entry frame, best exit frame, and the gap in centimetres each one leaves. A cycle
  has no "beginning": the code chooses where to enter it and where to leave it, and
  that choice is what decides the seam.
- **loop quality**: pose gap at the seam, and angular speed just before and just
  after it — a loop can be perfect in pose and still snap if the speed jumps.
- fingers animated or not, duration, size.

Heights and speeds are fractions, or values measured on a rig whose rest hips sit
at 1.0167 m. On a smaller model, scale them by `vrmHips / 1.0167`, otherwise the
character skates.

## Credits

Two origins, both free to redistribute. The project's full credits are gathered
in the [README](../README.md#credits); the file-by-file breakdown, the licence
notices and the mentions to keep are in [`NOTICE.md`](NOTICE.md), which must be
read before any redistribution:

- **Overte** — **Apache 2.0**: **30 clips out of 32** — the whole face-to-face
  domain (four idles, twelve gestures) and the whole 3D-world domain except the
  two seated transitions (14 clips).
- **Quaternius**, *Universal Animation Library* — **CC0 1.0**, public domain: the
  two seated transitions, the one family Overte does not have.

The **CMU Graphics Lab Motion Capture Database** (BVH conversion by Bruce Hahne)
supplied fifteen emotion gestures to the first version of this library; none of
them held the acceptance rule above, and no file derives from it any more.
