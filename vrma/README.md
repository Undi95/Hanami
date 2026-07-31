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
| **face à face** | pas de préfixe | l'avatar debout devant l'utilisateur qui discute : repos, repos en train de parler, gestes d'émotion | 28 fichiers, 6,92 Mo |
| **monde 3D** | préfixe `world-` | la scène interactive où le personnage marche, divague, s'assoit et réagit : allures, départs et arrêts, virages, changements de posture, gestes tenus, tout le vocabulaire assis | 81 fichiers, 11,89 Mo |

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

Les 28 clips actuels tiennent tous entre **4,1 et 8,0 cm** sur la pire de leurs
quatre mesures (entrée et sortie, contre chacun des deux socles), médiane 5,5 ;
contre le socle `idle` seul, de **0,8 à 6,8 cm**, médiane 3,2. Un clip qui ne tient
pas ce seuil est retiré, pas rafistolé — une émotion sans geste n'est pas un drame (le
déclenchement ne trouve rien, l'avatar continue de respirer), un geste qui accroche
l'œil en est un. C'est ce qui a coûté leur place aux quinze gestes issus du mocap
CMU, et à l'émotion `surprised`, qui n'a plus aucun clip : voir
[`NOTICE.md`](NOTICE.md) §2.

C'est aussi ce qui garde hors de ce domaine des clips d'Overte parfaitement
utilisables **ailleurs** : deux repos de posture différente (13,8 et 15,8 cm du
socle) et deux gestes tenus (15,7 et 18,8 cm en passe complète) sont passés au
domaine `world-`, où ils sont **séquencés** — une transition dédiée mène au repos
alterné et l'en ramène, un geste tenu se décompose en intro, maintien et sortie.
C'est ce que fait Overte lui-même, et l'enchaînement complet retombe alors sous
6 cm là où le clip entier en valait 15. Un clip qui échoue seul peut être parfait
à sa place.

### Ce que chaque émotion a aujourd'hui

| Émotion | Clips | Source |
| --- | --- | --- |
| `neutral` | `neutral` | inclinaison de tête |
| `happy` | `happy`, `happy-2`, `happy-3` | trois applaudissements |
| `sad` | `sad` | tête qui tombe |
| `angry` | `angry`, `angry-2` | dénégation agacée, dénégation posée |
| `relaxed` | `relaxed`, `relaxed-2` | étirement de la nuque, report de poids |
| `surprised` | **aucun** | Overte n'a pas d'émote de surprise |

Et les socles, que le lecteur tire au hasard : **cinq repos** (`idle` → `idle-4`,
`idle-7`) et **quatre repos parlants** (`idle-talking` → `idle-talking-7`). Overte
en tire respectivement quatre et sept, toutes les 10 à 30 s pour le repos et 7 à
12 s pour la parole ; c'est ce qui fait qu'un avatar ne « rejoue pas sa boucle ».

Le monde 3D est **généreux** : la scène a besoin de matière, et ces clips ne sont
jamais joués en face à face.

**Le chargement paresseux est voulu.** En mode face à face, les 11,89 Mo du domaine
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
| `nod.vrma`, `shake.vrma`, `think.vrma`, `raise-hand.vrma` | briques de conversation, sans mot-clé dédié : réservées à un déclenchement par lecture du texte de la réponse, donc **ignorées par le lecteur d'aujourd'hui** |
| suffixe `-2`, `-3`… (`idle-2.vrma`, `happy-2.vrma`) | variantes du même rôle, tirées au hasard |

`raise-hand` est le **seul rôle inventé** depuis que cette règle est écrite, et il
l'est à contrecœur : lever la main n'est ni un `happy` ni un `nod`, il n'y avait
aucun rôle voisin à enrichir. Comme `nod`, `shake` et `think`, il n'a pas de
mot-clé et le lecteur d'aujourd'hui l'ignore — il attend une lecture du texte de la
réponse. Le vocabulaire de **déclenchement** reste donc inchangé.

Le lecteur regroupe les variantes en retirant le suffixe `-<chiffres>` du nom :
`happy-2` est une variante de `happy`. **Les trous de numérotation sont sans
effet** — le catalogue est construit à partir des fichiers réellement présents, pas
d'un comptage. `idle-5` et `idle-6` manquent donc sans rien casser : ils sont
passés au domaine `world-` sous les noms `world-idle-alt1` et `world-idle-alt2`.

### Monde 3D

| Nom | Rôle |
| --- | --- |
| `world-walk-slow`, `world-walk`, `world-walk-fast`, `world-jog`, `world-run` | allures avant, jouées **en boucle et sur place** : la translation horizontale est nulle, c'est au code de déplacer le personnage à la vitesse consignée dans `world.json` |
| `world-walk-back`, `world-walk-back-fast`, `world-jog-back`, `world-run-back` | allures arrière, même principe |
| `world-strafe-left`, `world-strafe-right` et leurs `-fast`, `-jog`, `-run` | pas chassés, huit allures latérales |
| `world-step-left`, `world-step-left-short`, `world-step-left-fast` | petits pas de côté, en boucle. Overte obtient les versions **droites** par miroir ; elles n'existent pas comme fichiers |
| `world-turn-left`, `world-turn-right` | pivots sur place, en boucle, même principe pour la rotation |
| `world-walk-start` | départ, joué une fois |
| `world-walk-stop`, `-2`, `-3`, `-4` | arrêt long, quatre variantes tirées au hasard. Overte les choisit quand l'avatar avait de l'**élan** (plus de 2,2 m/s) |
| `world-walk-stop-small` | arrêt court, celui des à-coups et des micro-ajustements |
| `world-idle-alt1`, `world-idle-alt2` | repos debout d'une **autre posture** (pied gauche, pied droit en avant), en boucle |
| `world-idle-alt1-enter` / `-exit`, `world-idle-alt2-enter` / `-exit` | les transitions qui y mènent et en reviennent. Overte ne fond **jamais** un repos vers un repos de posture différente : il joue un clip qui fait le trajet |
| `world-clap-in` / `-hold` / `-out`, `world-point-…`, `world-raise-hand-…` | **gestes tenus**, en trois temps : l'intro amène, le maintien **boucle** aussi longtemps que l'intention dure, la sortie ramène. C'est le découpage d'Overte lui-même |
| `world-sit-enter`, `world-sit-exit` | s'asseoir et se lever, joués une fois |
| `world-sit-idle` → `world-sit-idle-5` | maintien assis, en boucle — **remplacent** le socle |
| `world-sit-talking` → `world-sit-talking-3` | maintien assis pendant qu'une réponse s'écrit |
| `world-sit-look`, `-2`, `world-sit-lookfidget`, `world-sit-fidget`, `world-sit-shift`, `world-sit-shifting`, `world-sit-lean`, `world-sit-legs` | micro-variations assises, jouées une fois |
| `world-sit-turn-left` / `-right`, et leurs `-end` | pivots sur le siège, chacun avec sa **sortie dédiée** |
| `world-sit-nod`, `-2`, `-3`, `world-sit-ack` | accord assis |
| `world-sit-shake`, `world-sit-dismiss`, `world-sit-disbelief`, `world-sit-sad` | désaccord assis |
| `world-sit-clap`, `-2`, `-3`, `world-sit-cheer` | joie assise |
| `world-sit-point`, `world-sit-raise-hand`, `-2`, `-3` | pointage et lever de main assis |

Tout autre nom est simplement ignoré.

L'assise est le **miroir complet** du monde debout, refait clip par clip par
Overte, et c'était jusqu'ici le plus gros gisement inexploité du pack : la
bibliothèque n'avait **aucune** émote assise.

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
- **`assise.raccordAWorldSitIdleCm`** : pour chaque clip assis, son écart au
  maintien assis — la même mesure que la règle des 10 cm du face à face, mais
  contre `world-sit-idle`. Le domaine monde 3D n'écarte personne sur ce chiffre, il
  le **consigne** : c'est au moteur de scène d'allonger le fondu là où il est
  grand. Attention à la méthode : un clip assis mesuré contre le socle **debout**
  donne mécaniquement ~47 cm — c'est la hauteur d'une chaise, pas un défaut.
- **`source.noeudOverte`, `source.fenetreImages`, `source.timeScale`** : d'où vient
  exactement le clip dans le graphe d'Overte, et — pour cinq d'entre eux — le fait
  qu'Overte le joue **ralenti** (0,65 à 0,75). Le ralenti est déjà appliqué au
  fichier : `dureeS` est la durée à jouer telle quelle.
- doigts animés ou non, durée, taille.

Les hauteurs et les vitesses sont des fractions ou des valeurs mesurées sur un rig
dont les hanches au repos sont à 1,0167 m. Sur un modèle plus petit, les mettre à
l'échelle par `hanchesDuVRM / 1,0167`, sinon le personnage patine.

## `transitions.json` — la machine à états d'Overte

[`transitions.json`](transitions.json) est la lecture exploitable du graphe
d'animation d'Overte (`interface/resources/avatar/avatar-animation.json`,
Apache-2.0) : **34 machines imbriquées, 165 états, 392 transitions**, et les 116
variables de transition classées **par origine** — fin de clip, moteur physique,
casque VR, script. Ce n'est pas de la documentation : c'est la logique de
comportement d'un avatar, déjà résolue par des gens dont c'était le métier, sous
une licence qui permet de la reprendre.

Ce qu'on y trouve et qui ne s'invente pas : les durées de fondu état par état,
l'**image du clip cible où le fondu doit aboutir** (`interpTarget` — Overte
choisit la phase à laquelle il entre dans un cycle de marche, il ne la subit pas),
les intervalles des minuteurs qui tirent une variation de repos (10 à 30 s), une
prise ponctuelle (10 à 50 s) ou une boucle de parole (7 à 12 s), et les seuils du
moteur (entrée en déplacement 0,20 m/s, sortie 0,07 ; élan acquis à 2,2 m/s ;
hystérésis de 0,1 s). Le fichier dit aussi ce qu'il **faut réécrire** : la section
`_moteurAReecrire` isole les variables qui viennent de leur physique.

Le moteur de scène interactive en aura besoin ; il est donc committé à côté des
clips qu'il enchaîne. Sa sémantique a été relue dans les sources C++ d'Overte, pas
seulement dans le JSON.

## Crédits

Deux provenances, toutes deux libres de redistribution. Les crédits complets du
projet sont réunis dans le [README](../README.fr.md#crédits) ; le détail fichier par
fichier, les avis de licence et les mentions à conserver sont dans
[`NOTICE.md`](NOTICE.md), à lire avant toute redistribution :

- **Overte** — **Apache 2.0** : **107 clips sur 109**, soit tout le domaine face à
  face (28 clips : neuf socles, dix-neuf gestes) et tout le domaine monde 3D sauf
  les deux transitions assises (79 clips). `transitions.json` vient de la même
  source et de la même licence.
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
| **face to face** | no prefix | the avatar standing in front of the user, talking: idles, talking idles, emotion gestures | 28 files, 6.92 MB |
| **3D world** | `world-` prefix | the interactive scene where the character walks, wanders, sits down and reacts: gaits, starts and stops, turns, posture changes, held gestures, the whole seated vocabulary | 81 files, 11.89 MB |

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

The current 28 clips all stay between **4.1 and 8.0 cm** on the worst of their four
measurements (in and out, against each of the two idles), median 5.5; against the
`idle` base alone, **0.8 to 6.8 cm**, median 3.2. A clip that misses the threshold
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
| `happy` | `happy`, `happy-2`, `happy-3` | three claps |
| `sad` | `sad` | head drop |
| `angry` | `angry`, `angry-2` | annoyed head shake, measured head shake |
| `relaxed` | `relaxed`, `relaxed-2` | neck stretch, weight shift |
| `surprised` | **none** | Overte has no surprise emote |

And the base poses, which the player picks at random: **five idles** (`idle` →
`idle-4`, `idle-7`) and **four talking idles** (`idle-talking` → `idle-talking-7`).
Overte draws from four and seven respectively, every 10–30 s for the idle and
7–12 s for speech; that is what keeps an avatar from visibly replaying its loop.

The 3D world is **generous**: the scene needs material, and these clips are never
played face to face.

**Lazy loading is intended.** In face-to-face mode, the 11.89 MB of the `world-`
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
| `nod.vrma`, `shake.vrma`, `think.vrma`, `raise-hand.vrma` | conversation primitives, with no dedicated keyword: reserved for triggering by reading the reply text, hence **ignored by today's player** |
| `-2`, `-3`… suffix (`idle-2.vrma`, `happy-2.vrma`) | variants of the same role, picked at random |

`raise-hand` is the **only role invented** since that rule was written, and
reluctantly so: raising a hand is neither a `happy` nor a `nod`, there was no
neighbouring role to enrich. Like `nod`, `shake` and `think` it has no keyword and
today's player ignores it — it waits for a reading of the reply text. The
**trigger** vocabulary is therefore unchanged.

The player groups variants by stripping the `-<digits>` suffix from the name:
`happy-2` is a variant of `happy`. **Gaps in the numbering have no effect** — the
catalogue is built from the files actually present, not from a count. `idle-5` and
`idle-6` are therefore missing without breaking anything: they moved to the
`world-` domain as `world-idle-alt1` and `world-idle-alt2`.

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

Two origins, both free to redistribute. The project's full credits are gathered
in the [README](../README.md#credits); the file-by-file breakdown, the licence
notices and the mentions to keep are in [`NOTICE.md`](NOTICE.md), which must be
read before any redistribution:

- **Overte** — **Apache 2.0**: **107 clips out of 109** — the whole face-to-face
  domain (28 clips: nine base poses, nineteen gestures) and the whole 3D-world
  domain except the two seated transitions (79 clips). `transitions.json` comes
  from the same source under the same licence.
- **Quaternius**, *Universal Animation Library* — **CC0 1.0**, public domain: the
  two seated transitions, the one family Overte does not have.

The **CMU Graphics Lab Motion Capture Database** (BVH conversion by Bruce Hahne)
supplied fifteen emotion gestures to the first version of this library; none of
them held the acceptance rule above, and no file derives from it any more.
