[English](README.md) | **Français**

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
| **face à face** | pas de préfixe | l'avatar debout devant l'utilisateur qui discute : repos, repos en train de parler, gestes d'émotion | 31 fichiers, 7,89 Mo |
| **monde 3D** | préfixe `world-` | la scène interactive où le personnage marche, divague, s'assoit et réagit : allures, départs et arrêts, virages, changements de posture, gestes tenus, tout le vocabulaire assis | 82 fichiers, 12,28 Mo |

Le domaine face à face existe en **deux familles étanches** : celle d'Overte
(sans préfixe, ci-dessus) et celle de Rocketbox (préfixe `rb-`, 38 fichiers,
8,26 Mo). Voir [Deux familles de face à face](#deux-familles-de-face-à-face).
Le domaine monde 3D, lui, n'a qu'une famille et n'en aura pas d'autre.

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

Les 31 clips actuels tiennent tous sous le seuil. Les trente premiers s'échelonnent
de **4,1 à 8,8 cm** sur la pire de leurs
quatre mesures (entrée et sortie, contre chacun des deux socles), médiane 5,5 ;
contre le socle `idle` seul, de **0,8 à 6,8 cm**, médiane 3,2. Les deux plus hauts
(8,8 et 7,6 cm) sont `idle-talking-4` et `relaxed-3`, promus depuis `extra/` après
jugement à l'image : leur raccord est en haut de la fourchette, pas au-dessus du
seuil, et le fondu l'absorbe. Le trente et unième, `happy-6`, est monté d'`extra/`
une fois sa mesure d'entrée réparée (11,1 → 0 cm). Un clip qui ne tient
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
| `happy` | `happy`, `happy-2`, `happy-3`, `happy-6` | quatre applaudissements — le quatrième repêché d'`extra/` une fois sa mesure réparée (entrée 11,1 → 0 cm, pieds ancrés, pic lissé) |
| `sad` | `sad` | tête qui tombe |
| `angry` | `angry`, `angry-2` | dénégation agacée, dénégation posée |
| `relaxed` | `relaxed`, `relaxed-2`, `relaxed-3` | étirement de la nuque, report de poids, dandinement d'attente (14 s) |
| `surprised` | **aucun** | Overte n'a pas d'émote de surprise |

Et les socles, que le lecteur tire au hasard : **cinq repos** (`idle` → `idle-4`,
`idle-7`) et **cinq repos parlants** (`idle-talking`, `idle-talking-4` → `-7`). Overte
en tire respectivement quatre et sept, toutes les 10 à 30 s pour le repos et 7 à
12 s pour la parole ; c'est ce qui fait qu'un avatar ne « rejoue pas sa boucle ».

Le monde 3D est **généreux** : la scène a besoin de matière, et ces clips ne sont
jamais joués en face à face.

**Le chargement paresseux est voulu.** En mode face à face, les 12,28 Mo du domaine
`world-` n'ont aucune raison d'être téléchargés — c'est précisément pourquoi la
frontière tient dans le nom du fichier et pas dans un fichier de configuration.

## Deux familles de face à face

Le face à face se joue en **deux bibliothèques complètes et interchangeables** :

| Famille | Préfixe | Source | Poids | Ce qu'elle a en propre |
| --- | --- | --- | --- | --- |
| **Overte** (défaut) | *aucun* | Overte, Apache-2.0 | 31 fichiers, 7,89 Mo | cinq repos, cinq repos parlants, les gestes d'émotion |
| **Rocketbox** | `rb-` | Microsoft Rocketbox, MIT | 38 fichiers, 8,26 Mo | quatre repos, trois repos parlants, **trois socles d'écoute**, vingt-huit gestes |

Un personnage choisit la sienne (champ `animations` de son `character.json`,
sélecteur dans le dialog Personnages). Absent = Overte, donc **rien ne change
pour les personnages qui existaient avant**.

### La règle des familles, et le chiffre qui la fonde

> **Un personnage joue Overte OU Rocketbox, jamais un mélange.**

Ce n'est pas une préférence de style, c'est une mesure. Les deux bibliothèques
n'ont pas la même station debout : le raccord d'un clip Rocketbox contre le socle
d'Overte vaut **16,5 à 20,3 cm** d'excursion du pire os majeur — deux fois et
demie le seuil d'acceptation de 10 cm. À l'intérieur de la famille Rocketbox, la
même mesure tombe entre **0,2 et 5,7 cm** (médiane 0,4). Mélanger, c'est
fabriquer à chaque geste le défaut que toute la règle d'acceptation existe pour
éviter.

Le catalogue tient donc les deux familles **séparées à la construction** : un
clip `rb-` n'entre jamais dans un rôle de la famille Overte, et réciproquement.
Corollaire heureux : **la famille non choisie n'est jamais téléchargée**, pas un
octet — même mécanisme que le chargement paresseux du domaine `world-`.

### Et en scène vivante 3D ?

**Le domaine `world-` reste 100 % Overte, pour tout le monde.** Marcher, se
tourner, s'asseoir, les gestes assis : ces clips n'existent que chez Overte,
Rocketbox n'en a aucun et n'en aura pas. Un personnage Rocketbox garde donc ses
socles, son écoute et ses gestes, et **emprunte les allures d'Overte** le temps
de traverser la pièce.

C'est le **seul raccord croisé de tout le système**, et il faut le dire : la
dernière image de `world-walk-stop` est ancrée sur la pose d'`idle`, donc sur la
station debout d'Overte. Reprise par un socle `rb-idle`, la jonction porte les
16 à 20 cm — étalés sur le fondu de socle (0,5 s), pas claqués en une image. En
pratique cela se voit à l'arrivée d'un déplacement, pas en conversation.

Deux raisons de l'assumer plutôt que de forcer Overte en scène vivante. D'abord
la scène vivante est **un interrupteur global**, pas un état du personnage :
allumé sans décor 3D, il ne fait presque rien — et il rendrait pourtant le
réglage de gestuelle sans effet, ce qui se lit comme une panne. Ensuite ce qu'on
échangerait est disproportionné : le socle d'écoute, les cinq `neutral`, les
quatre `relaxed` — toute la richesse de la famille — contre une jonction par
déplacement.

## Convention de nommage

Le nom du fichier fait office de configuration — il n'y a pas de fichier de mapping.

### Face à face

| Nom | Rôle |
| --- | --- |
| `idle.vrma` | socle joué en boucle (sans lui, aucune animation n'est jouée) |
| `idle-talking.vrma` | socle joué en boucle pendant qu'une réponse s'écrit |
| `happy.vrma`, `sad.vrma`, `angry.vrma`, `surprised.vrma`, `relaxed.vrma`, `neutral.vrma` | geste joué une fois quand le personnage exprime cette émotion, puis retour à l'idle. `surprised` est le seul rôle reconnu **sans fichier** : le déclenchement ne trouve rien et l'avatar continue de respirer |
| `nod.vrma` | **acquiescement au clic sur le personnage** en scène vivante (cf. `REACTION_STEM`, `client/src/scene/vrmStage.ts`). Cinq variantes, tirées sans répétition immédiate. Seul rôle du face à face à n'être téléchargé **qu'avec** les clips `world-` : c'est la scène vivante qui s'en sert, pas la conversation |
| `shake.vrma`, `think.vrma`, `raise-hand.vrma` | briques de conversation, sans mot-clé dédié : réservées à un déclenchement par lecture du texte de la réponse, donc **ignorées par le lecteur d'aujourd'hui** |
| suffixe `-2`, `-3`… (`idle-2.vrma`, `happy-2.vrma`) | variantes du même rôle, tirées au hasard |

`raise-hand` est le **seul rôle inventé** depuis que cette règle est écrite, et il
l'est à contrecœur : lever la main n'est ni un `happy` ni un `nod`, il n'y avait
aucun rôle voisin à enrichir. Comme `shake` et `think`, il n'a pas de mot-clé et le
lecteur d'aujourd'hui l'ignore — il attend une lecture du texte de la réponse. Le
vocabulaire de **déclenchement** reste donc inchangé (`nod`, lui, a depuis trouvé
son déclencheur : le clic sur le personnage).

**Et `raise-hand` LÈVE la main, il ne fait pas signe.** `raise-hand` et
`raise-hand-2` lèvent la main et la **tiennent** — 8 s de maintien pour le premier.
L'avant-bras n'y bat qu'à 0,20 et 0,08 aller-retour par seconde, là où un
« coucou » en demande deux ou trois : c'est le geste de qui **demande la parole**,
et c'est le rôle voulu. Le banc de diagnostic le compte comme un défaut de cadence
faute d'avoir une fourchette pour « main levée et tenue ». Si l'app veut un jour un
salut de la main, ces deux clips n'en sont pas.

Le lecteur regroupe les variantes en retirant le suffixe `-<chiffres>` du nom :
`happy-2` est une variante de `happy`. **Les trous de numérotation sont sans
effet** — le catalogue est construit à partir des fichiers réellement présents, pas
d'un comptage. `idle-5` et `idle-6` manquent donc sans rien casser : ils sont
passés au domaine `world-` sous les noms `world-idle-alt1` et `world-idle-alt2`.

### Face à face, famille Rocketbox (`rb-`)

**Même vocabulaire de rôles, préfixe en plus.** Le lecteur retire `rb-` puis
applique exactement la grammaire ci-dessus : `rb-happy-2.vrma` est une variante
du geste `happy` de la famille Rocketbox, `rb-idle.vrma` en est le socle. Un seul
rôle est nouveau, et il n'existe que là :

| Nom | Rôle |
| --- | --- |
| `rb-listen.vrma`, `-2`, `-3` | **socle d'écoute**, joué en boucle pendant que l'utilisateur TAPE son message. Overte n'a rien d'équivalent : sans clip `listen`, le mécanisme est inerte et le personnage continue de respirer |

Les 38 clips, par rôle — les deux colonnes de mesures sont celles de la règle
d'acceptation, prises **contre le socle `rb-idle`** (jamais contre celui
d'Overte : ce serait mesurer la distance entre deux studios, pas un défaut) :

| Rôle | Clips | Raccord au socle | Couture |
| --- | --- | --- | --- |
| socle | `rb-idle`, `-2`, `-3`, `-4` | 0,2 – 2,7 cm | 0 – 0,82 cm |
| socle parlant | `rb-idle-talking`, `-2`, `-3` | 2,2 – 5,4 cm | 0,93 – 2,17 cm |
| socle d'écoute | `rb-listen`, `-2`, `-3` | 2,7 – 5,7 cm | 0,83 – 2,22 cm |
| `happy` | `rb-happy`, `-2`, `-3` | 0,4 cm | — |
| `neutral` | `rb-neutral`, `-2`, `-3`, `-4`, `-5` | 0,4 cm | — |
| `relaxed` | `rb-relaxed`, `-2`, `-3`, `-4` | 0,4 – 5,2 cm | — |
| `angry` | `rb-angry`, `-2` | 2,3 – 3,3 cm | — |
| `sad` | `rb-sad` | 4,5 cm | — |
| `surprised` | **aucun** — comme chez Overte | — | — |

Et **six briques de conversation** sans mot-clé de déclenchement, reconnues mais
ignorées par le lecteur d'aujourd'hui, exactement comme `shake`, `think` et
`raise-hand` côté Overte : `rb-nod` (`-2`, `-3`), `rb-shake` (`-2`, `-3`),
`rb-wave` (`-2`), `rb-shrug` (`-2`), `rb-laugh`, `rb-think` (`-2`). Elles
attendent une lecture du texte de la réponse.

**`rb-nod` n'est PAS l'acquiescement au clic.** Ce rôle-là (`REACTION_STEM`)
appartient à la scène vivante, qui reste Overte : `rb-nod` est donc un `nod`
Rocketbox en réserve, pas le clip que le clic déclenche. C'est voulu — une
réaction Rocketbox par-dessus un socle debout Overte, ce serait le mélange que la
règle interdit.

Tout autre nom en `rb-` est simplement ignoré, comme partout ailleurs.

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
| `world-afk-texting` | repos debout, pianote sur son téléphone — l'absence prolongée. En boucle, couture exacte. **Orphelin du graphe** d'Overte : `afk_texting.fbx` n'est référencé par aucun nœud, Overte lui-même ne le joue jamais |
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

## `extra/` — les clips convertis et non retenus

Le sous-dossier [`extra/`](extra) contient **15 clips** (3,92 Mo) issus de la même
passe de conversion que les autres : mêmes outils, mêmes corrections, même
validation à l'aller-retour, mêmes crédits (voir [`NOTICE.md`](NOTICE.md) §1). Ils
n'ont simplement pas leur place dans la bibliothèque active. Ils sont livrés quand
même parce qu'un clip converti puis écarté ne coûte que son poids sur le disque, et
parce que le jugement qui l'a écarté peut se rediscuter.

**L'app ne les télécharge jamais.** `/api/vrm-animations` liste le contenu de
`vrma/` **à plat** — un `readdir` sans récursion, filtré sur `.vrma`. Un fichier
rangé dans `extra/` n'apparaît donc dans aucun catalogue, et le lecteur ne le
demande jamais. Le serveur le servirait si on lui en donnait l'URL ; rien ne la lui
donne. Le poids d'`extra/` est un poids de dépôt, pas un poids de chargement.

La colonne « raccord » est la mesure de la [règle d'acceptation](#la-règle-dacceptation-chiffrée) :
le pire écart, en centimètres, entre les bords du clip et la pose des socles `idle`
et `idle-talking`. Seuil d'échec : 10 cm.

| Fichier | Pourquoi il est ici | Raccord |
| --- | --- | --- |
| `idle-talking-2.vrma` | repos parlant — les bras finissent loin du socle | 39,5 cm |
| `raise-hand.passe-complete.vrma` | lever de main, **passe complète** (intro + maintien + sortie) : c'est le clip que le domaine `world-` livre découpé en `world-raise-hand-in` / `-hold` / `-out` | 18,8 cm |
| `point.vrma` | pointage, passe complète — même histoire, livré découpé en `world-point-…`. Réexaminé le 2026-08-01 : un ancrage du bord amont le fait passer à 6,7 cm, mais **aucun rôle `point` n'existe en face à face** — promu il resterait muet ; la version découpée `world-` est celle qui joue, et elle est excellente | 15,7 cm |
| `idle-talking-3.vrma` | repos parlant, dépasse le seuil de peu | 11,2 cm |
| `happy-5.vrma` | applaudissement — **c'est `happy-2`** : les deux clips ne s'écartent jamais de plus de **3,4°** (os le plus concerné, sur toute la durée). Le promouvoir donnerait au tirage au sort deux fois la même émote. L'à-coup de poignet qu'il porte (1000 °/s à t = 0,3 s) a donc été lissé **dans `happy-2`**, où il est réellement joué. Réexaminé le 2026-08-01 : même retouché (ancrage + lissage), il reste la chorégraphie de `happy-2` à 14° près — l'argument du doublon tient, il reste ici | 8,7 cm |
| `neutral-2.vrma` | hochement de tête lent — **redondant avec les cinq `nod`** : le vocabulaire du face à face doit rester court, et `neutral` a déjà son clip. Tient visuellement, mais n'ajoute rien. Réexaminé le 2026-08-01 : raccord propre (5,7–6,9 cm), la redondance décide, pas la mesure | 8,1 cm |
| `cand-idle-fenetre.vrma` | `idle` reconverti sur la fenêtre **déclarée** par le graphe (1→300) au lieu du découpage retenu — quasi identique au fichier livré | 5,0 cm |
| `cand-idle-2-fenetre.vrma` | idem pour `idle-2` (1→902) | 5,0 cm |
| `cand-idle-3-fenetre.vrma` | idem pour `idle-3`, mais la fenêtre déclarée fait **26,63 s** là où le fichier livré n'en garde qu'une sous-boucle de 13,33 s : celui-ci est réellement différent | 5,2 cm |
| `cand-idle-talking-fenetre.vrma` | idem pour `idle-talking` (1→215) | 5,5 cm |
| `world-jump-start.vrma`, `world-jump-air.vrma`, `world-jump-land.vrma`, `world-jump-run-start.vrma`, `world-jump-run-land.vrma` | les cinq temps du saut. Chez Overte la phase aérienne n'est pas une animation mais des **poses fixes mélangées par la vitesse verticale** du moteur physique, et la hauteur du saut vit dans la simulation, pas dans le fichier : sans ce code, ils ne se tiennent pas (cf. [`NOTICE.md`](NOTICE.md) §3) | — |

**Trois de ces clips sont montés à la racine.** `idle-talking-4` (8,8 cm) et
`relaxed-3` (7,6 cm) après le premier jugement à l'image de la bibliothèque : ils
sortaient de la fourchette des clips retenus (4,1 à 8,0 cm) sans dépasser le seuil
de 10 cm, et c'est le seul reproche que la mesure leur faisait ; à l'image, le
premier gesticule exactement comme les `idle-talking-5/-6/-7` déjà en place, le
second est une attente crédible en boucle de fond. Puis `happy-6` (2026-08-01),
écarté uniquement pour sa mesure (11,1 cm d'entrée, pieds qui patinent, pic
1000 °/s) : la mesure réparée — bord amont ancré sur la pose moyenne d'`idle`,
jambes amorties vers leur pose initiale, pic lissé à 604 °/s — c'est un
applaudissement authentiquement différent de ses trois frères (117 à 135° d'écart
au pire os), il enrichit le tirage. Les deux qui restent au-dessus de la
fourchette, `happy-5` et `neutral-2`, restent ici — non pour leur raccord,
mais parce qu'ils **doublent** un clip déjà livré (voir le tableau).

**Et un clip du domaine monde 3D**, `world-afk-texting` (2026-08-01) : le tableau
ci-dessus ne lui donnait pas de raccord parce qu'un `world-` ne se juge pas contre
les socles debout. Jugé contre ce qui le concerne — sa **couture de boucle** — il
est irréprochable : 0 cm de pose, saut de 12 °/s pour un 95ᵉ centile interne de
21 °/s. Il est monté à la racine **avec son entrée dans [`world.json`](world.json)**
(`famille: repos`, `boucle: true`) : un clip `world-` sans entrée serait jugé
contre le socle debout, à 26,8–29,1 cm, et fabriquerait un faux échec.

**Six clips convertis ne sont pas ici, et c'est voulu** : les versions brutes de
`world-sit-point`, `world-sit-raise-hand-2` et des quatre `world-walk-stop-…`
d'avant leurs corrections géométriques (bassin et jambes rendus aux clips assis,
ancrage des arrêts sur leurs voisines). Le dossier porte déjà ces six clips dans
leur version corrigée, sous le même nom ; la version brute a les jambes en pose de
bind — debout sous un corps assis — ou les pieds non ancrés. Ce n'est pas une
variante, c'est un état antérieur.

### Activer un de ces clips

1. **Déplacer** le fichier de `vrma/extra/` vers la racine de `vrma/`.
2. **Le renommer** selon la [convention ci-dessus](#convention-de-nommage) — le nom
   fait office de configuration, et tout nom hors convention est ignoré.
3. **Recharger la page.** Le catalogue est reconstruit à partir des fichiers
   réellement présents ; le serveur n'a pas besoin d'être redémarré.

`happy-5`, `idle-talking-2`, `-3` et `neutral-2` portent
déjà un nom conforme et un numéro libre : ils se déplacent tels quels, et **les
trous de numérotation sont sans effet**. Les autres demandent un nom :

| Fichier d'`extra/` | Nom à lui donner à la racine |
| --- | --- |
| `cand-idle-fenetre`, `cand-idle-2-fenetre`, `cand-idle-3-fenetre` | `idle-8`, `idle-9`… — ou le nom du clip qu'ils reconvertissent, pour le remplacer. `idle-5` et `idle-6` sont libres mais déjà employés sous `world-idle-alt1` / `-alt2` : les réutiliser prête à confusion |
| `cand-idle-talking-fenetre` | `idle-talking-8`, ou `idle-talking` pour remplacer le livré |
| `raise-hand.passe-complete` | `raise-hand-3` ; ou `raise-hand` pour remplacer l'intro seule qui est livrée. Le suffixe `.passe-complete` n'existe que pour éviter la collision de noms dans `extra/`, il ne veut rien dire pour le lecteur |
| `point` | aucun rôle `point` n'existe dans le vocabulaire du face à face : sous ce nom le clip reste ignoré. À verser dans un rôle voisin, ou à laisser au domaine `world-`, qui le livre déjà découpé |
| les cinq `world-jump-*` | le préfixe `world-` suffit à les faire entrer dans le domaine monde 3D, mais le moteur de scène ne les enchaînera pas sans entrée correspondante dans [`world.json`](world.json) — et sans elle le banc les juge contre le socle **debout**, ce qui fabrique un faux échec |

Ces clips ont été écartés **sur mesure**, pas au hasard. Au-dessus de 10 cm, le
raccord socle → geste → socle se voit : le corps est tiré et les pieds glissent sans
pas. C'est exactement ce que la règle protège, et c'est ce qu'on accepte de perdre en
en activant un.

## La semelle sous le sol : ce que ces fichiers ne corrigent pas, et pourquoi

Un banc de diagnostic mesure, sur l'étalon du projet (un chibi VRM 0.x de
0,755 m de hanches), que
**55 clips enfoncent la semelle sous le plancher** : toute la famille assise de 8,5
à 10,4 cm, les pas chassés et les courses de 5 à 10, la marche de 2,5 à 5,2. Le
réflexe est de remonter la piste verticale du bassin dans les `.vrma`. **Ce serait
faux, trois fois.**

**1. Les 55 clips sont tous des `world-`.** Le pire du face à face est `idle-7` à
1,6 cm, sous les 2 cm d'épaisseur de semelle que le banc tolère. Or le domaine
monde 3D tourne sous une **cinématique inverse de jambes** (`client/src/scene/legIk.ts`),
appelée à chaque image, dont c'est exactement le métier : debout elle **remonte**
un pied qui traverse, assise elle lui fait **viser** le sol. Son en-tête cite les
mêmes mesures que le banc (« `world-sit-idle` — de 37 à 62 mm → très visible ») :
ce défaut est déjà corrigé, au bon endroit, par l'articulation de la jambe et non
par une translation du corps.

**2. Pour la famille assise, la hauteur du bassin est PORTEUSE.** Elle vaut
`postureAssiseCanonique` dans [`world.json`](world.json) — 0,5409 hanche — et le
code s'en sert pour poser le bassin sur l'assise réelle du meuble. Remonter les
clips assis de 8,6 cm ferait **flotter le personnage au-dessus de sa chaise** de
très exactement cet écart, et l'IK tendrait les jambes pour rattraper le sol.

**3. Pour les allures, ce n'est pas un offset.** Mesurée image par image, la
semelle de `world-walk` va de 0 à −5,2 cm dans le cycle (médiane −1,1) : elle
touche juste au double appui et s'enfonce au milieu de l'appui, parce que le genou
porteur est trop plié. Un décalage constant de 5,2 cm laisserait **85 % du cycle en
vol à plus de 2 cm** — on échangerait un pied dans le sol contre un personnage sur
coussin d'air. Et un décalage suivant la pénétration image par image redresse bien
la courbe du bassin, mais introduit **2 cm de boiterie** entre les deux demi-cycles
et **1,4 cm de saut à la couture** de boucle. La famille assise, elle, est le seul
cas où l'enfoncement EST constant (dispersion ≤ 0,4 cm sur 34 clips) — et c'est
précisément celle que le point 2 interdit de toucher.

La règle qui en sort : **un `.vrma` décrit une pose, pas une altitude.** Le sol,
c'est le travail du moteur.

## Retouches apportées aux clips livrés

Ces clips ne sont plus la conversion brute de leur source. Chaque retouche a été
mesurée avant et après avec le même banc, et validée par un aller-retour complet
(`GLTFLoader` + `VRMAnimationLoaderPlugin` + `createVRMAnimationClip`, rejeu image
par image, échantillon à `durée − 1e-4`).

| Clip | Retouche | Avant → après |
| --- | --- | --- |
| `world-run`, `world-strafe-left-run`, `world-strafe-right-run` | le genou droit se cassait **à l'envers** à la poussée : à l'instant le pire, le genou sort de 13 cm en avant de la ligne hanche-cheville. La piste du genou est écrêtée en douceur (`tanh`, donc sans à-coup ni rupture de couture) à la limite humaine | hyperextension **41°, 41°, 37° → 10°** — la pénétration de semelle, la levée de pied et la couture sont inchangées |
| `world-turn-right` | le genou gauche pliait à 58° hors du plan de la jambe pendant le croisement. Le tibia est ramené dans le plan de la cuisse par une torsion autour de l'axe fémoral (qui ne touche pas la flexion) | charnière **58° → 29°**, dans l'enveloppe de `world-turn-left` (31°), qui est sain. Verdict du banc : **défaut → bon** |
| `shake` | ne se lisait pas comme un « non » : **un seul** balayage de 56°. La fenêtre déclarée par le graphe d'Overte (images 1→72) est déjà le fichier entier, et le seul autre « non » debout de la source (`thoughtfulheadshake`) ne fait lui aussi qu'un balayage — il n'y avait rien de plus à aller chercher. Le balayage central est donc **rejoué en miroir temporel**, avec les points de retournement pris aux extrêmes du lacet, là où la vitesse est nulle ; puis l'amplitude est ramenée à celle de `world-sit-shake`, le « non » assis d'Overte | **0,5 → 1,5** aller-retour · amplitude **56° → 39°** · durée 2,30 → 3,63 s · **les deux poses de bord sont bit à bit celles d'origine**, donc le raccord au socle ne bouge pas |
| `happy-2` | à-coup de poignet de 1000 °/s à t = 0,3 s (un raccord de clés mal interpolé), et un second à 818 °/s à t = 0,7 s. Lissage laplacien local sur les quaternions, à poids nul aux bords de la fenêtre | vitesse de pointe **1000 → 688 °/s** · hors fenêtre le fichier est inchangé, **bords compris** |
| `world-sit-legs` | le clip n'a **aucune piste d'épaule** : elles restaient ouvertes comme debout sous un corps assis, et l'écart au maintien assis valait **11,6 cm constants sur les 138 images**, porté par `rightShoulder` (21,6°). Ce n'était pas les chevilles croisées, c'était ça. Les deux épaules reçoivent la pose moyenne de `world-sit-idle`, constante — la greffe déjà appliquée aux sept assis privés de bassin — puis les deux bords sont ancrés sur ce même socle | **11,6 → 0 cm** · pic de vitesse **inchangé** (49 °/s) |
| `world-sit-talking-2` | c'est une **boucle**, et une boucle n'a pas de « début » : celle-ci s'ouvrait à 13,8 cm du maintien assis quand son image 21 n'en était qu'à 7,1. Sa phase de départ est décalée de 21 images (0,700 s) — le nouveau raccord est un intervalle *intérieur* du clip, donc exact par construction — puis les deux bords sont ancrés sur `world-sit-idle` | **13,8 → 0 cm** · couture **0 cm**, saut de vitesse **68 → 32 °/s** · pic **inchangé** (269 °/s) |
| `world-raise-hand-in` | la main partait déjà haut : **13,6 cm** entre `idle` et la première image, à la pire des 300 phases du socle. Un geste se déclenche quand l'intention arrive, pas quand le socle veut bien — pas de contrat de phase possible ici, donc le bord amont est ancré sur la pose **moyenne** d'`idle` et le bord aval sur `world-raise-hand-hold` à t = 0 | **13,6 → 1,6 cm** au pire des 300 phases (0,2 au mieux) · sortie **2,6 → 0 cm** · pic **inchangé** (936 °/s) |
| `world-sit-turn-left-end` | fin de pivot assis : **35,9 cm** à la pire phase du cycle amont, 10,4 à la meilleure. Aucune phase ne sauvait le raccord — le cycle tient l'avant-bras gauche à ~36° de l'amorce du settle à *toutes* ses phases. La première image est donc ancrée sur `world-sit-turn-left` à **t = 1,100 s** (fenêtre 0,80 s, pour que le parcours reste sous le pic du clip) et la dernière sur `world-sit-idle` ; la phase devient un **contrat** dans `world.json` | **35,9 → 0 cm** en amont, **0,4 → 0 cm** en aval · pic 64 → 77 °/s (2,6°/image, sous le seuil de visibilité) |
| `world-sit-turn-right-end` | même défaut, en pire (**43,3 cm**), plus un défaut à part : le FBX source n'a **aucune piste** sur `spine`, `chest`, `upperChest`, `neck` ni les deux épaules — 6 os majeurs sur 20 remis debout sous un corps assis, soit **16,4 cm de résidu qu'aucun ancrage ne pouvait toucher**, faute de piste à corriger. Les six sont greffés : pose du cycle à sa phase de sortie, puis retour vers `world-sit-idle` en smoothstep sur la durée du clip — le buste se détord, ce que le settle est censé montrer. Ancrage et contrat de phase (t = 2,367 s) comme son symétrique | **43,3 → 0 cm** en amont, **14,5 → 0 cm** en aval · `osAnimes` **14 → 20** · pic de vitesse **inchangé** (170 °/s) |

**Les cinq dernières lignes sont une même passe**, celle qui solde les cinq défauts
que le banc refondu laissait sur 111 clips. Trois choix la gouvernent, et ils se
généralisent :

1. **Un os sans piste retombe à la pose de REPOS du rig** — debout, épaules
   ouvertes. Sur un clip assis c'est *lui*, pas le geste, qui décide du verdict :
   `world-sit-legs` et `world-sit-turn-right-end` mesuraient un défaut d'épaules et
   de buste, pas un défaut de mouvement. La mesure le dit sans ambiguïté : l'écart
   est alors **constant sur toute la durée du clip**.
2. **Les os terminaux sont exclus de l'ancrage** (`head`, les deux mains, les deux
   orteils) : leur rotation propre ne déplace **aucun** os mesuré — la position d'une
   main vient de son avant-bras, celle d'un orteil de son pied, et les doigts sont
   hors mesure. Les ancrer ne gagne pas un centimètre et ajoute une secousse ; dans
   une boucle, une secousse rejouée à chaque tour. Sur `world-sit-talking-2` l'écart
   était de 129° au poignet gauche : les ancrer aurait porté le pic de 269 à
   **639 °/s** pour zéro centimètre gagné.
3. **Un contrat de phase ne se décrète pas, il se mesure — et il ne s'applique pas
   partout.** Il vaut pour un cycle que le code peut *choisir* de quitter au bon
   moment (allures, pivots) ; il ne vaut pas pour un socle qu'un geste interrompt
   quand l'intention arrive (`world-raise-hand-in` vise donc la pose moyenne d'`idle`,
   pas une de ses phases).


**La passe « gisement clips » du 2026-08-01** solde les sept « limite » que le banc
laissait sur le rig de référence et les six échecs qu'ils redevenaient sur un rig
plus grand (hanches 0,9045 m) — la marge multi-modèles était le vrai enjeu. Mêmes
outils, mêmes conventions que la passe précédente, plus deux passes nouvelles :
lissage **local** d'un pic de vitesse (fenêtré, bords intacts) et lissage
**circulaire** d'une couture (la pose de recollement reste exacte, seule la
vitesse s'étale).

| Clip | Retouche | Avant → après (rig de référence · rig 0,9045) |
| --- | --- | --- |
| `world-point-in` | bord amont ancré sur la pose moyenne d'`idle` (recette `world-raise-hand-in`) | jonction **8,1 → 1,6 cm** · **10,1 → 2,0** ; aval 0,7 inchangé |
| `world-sit-talking`, `-3` | rotation de phase vers l'image la plus proche du maintien (+58 / +13 images, balayage des deux rigs) + bords ancrés ; `-3` : greffe d'`upperChest` **absent du fichier** | E **8,3/8,6 → 0 cm** partout · coutures 0 cm, sauts 63→30 / 31→32 °/s |
| `world-sit-idle-5` | jambes quasi statiques (≤ 0,9°) mais décalées de la famille : greffe constante des six os de jambe depuis la pose moyenne du socle | E **9,3 → 3,1 cm** · **10,4 → 3,9** ; genoux 101° = famille ; couture intacte ; ancrage des bras REFUSÉ (pic ×10 rejoué à chaque tour pour un écart déjà absorbé en fondu) |
| `world-sit-cheer` | piste `leftShoulder` **absente** (épaule debout figée sous le corps assis) : greffe depuis le socle, puis les deux bords ancrés (fenêtre courte 0,25 s — le pic du « ouais ! » à 687 °/s ne bouge pas) | E = S **8,9 → 0 cm** · **10,7 → 0** |
| `world-sit-clap-3` | bord amont seul ancré (la sortie était déjà à 2,1) | entrée **7,9 → 0 cm** ; pic 747 inchangé |
| `world-raise-hand-hold` | couture : pose exacte mais saut de vitesse 98 °/s (ratio 1,34 × p95) sur toute la chaîne du bras levé — lissage circulaire ±0,2 s, quatre os | saut **98 → 25 °/s** · déviation max 1,1° · les deux jonctions du maintien restent excellentes |
| `raise-hand-2`, `world-sit-raise-hand`, `world-raise-hand-in` | pics d'avant-bras > 800 °/s (plateaux d'écrêtage 1000, arrêt mort puis claquement 936) : lissage local aux instants fautifs, montée ET redescente | pics **1000/1000/936 → 779/739/687 °/s**, verdict vitesse « bon » ; raccords au dixième près inchangés |
| `world-sit-disbelief`, `world-sit-clap` | pics de main (cosmétiques) : 993/1000/815 et 956/875 °/s — lissage local, y compris un `rightHand` 815 que la chasse n'avait pas vu | tous les pics **≤ 797 °/s** ; la frappe du clap garde son claquement (797 non touché) |
| `world-walk`, `-fast`, `-back`, `-back-fast` | la piste `hips.position` était **purement verticale** — or les jambes de la source compensent un bassin qui oscille : sans lui, c'est le pied d'appui qui écope (2,2 à 12,0 cm de traînée latérale pendant l'appui). Sinus 1×/cycle sur période exacte, amplitude et phase par **grille par clip** (bornée à la bande « bon » du juge, 3–5 cm crête-à-crête), sens mesuré sur les jambes | traînée d'appui **3,7→1,7 · 6,6→3,1 · 7,8→4,1 · 12,0→7,6 cm** ; juge bassin-latéral **0,0 « limite » → 4–5 cm « bon »** ; coutures et sauts au degré près inchangés ; jonction walk-start→walk 0,3 cm (zéro du sinus sur le contrat t=0,200 s) |

Après la passe : **0 échec et 0 « limite » sur le rig de référence** (53 excellents,
59 passe sur les 112 clips livrés **à cette date** — `world-afk-texting` est monté à
la racine après, portant le domaine `world-` à 82 ; le décompte 62 datait d'avant le
retour d'`happy-5`, `neutral-2` et `point` dans `extra/`), 0 échec et les 4 « limite »
pré-existants sur le rig 0,9045 — aucune régression, prouvée par la sonde
intégrale des deux rigs avant/après chaque correction, et re-prouvée par une
sonde indépendante après clôture (2026-08-01 : mêmes décomptes au clip près). Les « pieds qui glissent » des cinq gestes face (`relaxed-2/-3`,
`think-2`, `happy`, `happy-3`) ont été examinés et **laissés tels quels** : le
critère du juge mesure le pied **relativement au bassin** et somme donc le
balancement du corps avec le patinage ; en espace MONDE les pieds ne bougent que
de 1,3 à 5,6 cm (quatre des cinq sous la barre des 3 cm), et amortir les jambes
tuerait le report de poids qui fait vivre ces poses (`relaxed-2` est un
contrapposto : sa « glisse » est son installation).

**`world-walk-slow` a été examiné et laissé tel quel.** Ses pieds ne décollent que
de 2,6 cm et c'est l'allure de la déambulation autonome, mais les deux issues
proposées échouent à la mesure : le remplacer par `world-walk` ralenti demande un
facteur **3,69** (1,421 contre 0,385 m/s), soit une foulée de 1,42 m étalée sur
3,7 s, et casserait le contrat de phase et la foulée de la flânerie, qui vivent
dans `client/src/scene/wander.ts` ; le retoucher en pliant le genou oscillant
**échange un défaut contre un autre** — à +18° la garde au sol passe de 2,6 à
5,6 cm (défaut → limite) mais le double appui tombe de 15 à 5 % du cycle (bon →
défaut), et à +26° la garde au sol devient bonne au prix du même double appui.
C'est un traînement de pieds à petits pas (18,4 cm, 0,20 × la hanche) : lui faire
lever les pieds en fait une autre allure.

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
- **transitions, `enchaine`** : d'où vient le clip, où il va, et — pour la marche
  **et les deux pivots assis** — **à quelle phase du cycle entrer et sortir**. Les
  extrémités des transitions sont ancrées sur les poses voisines : la dernière image
  de `world-walk-start` *est* la pose de `world-walk` à 0,200 s, la première de
  `world-walk-stop` *est* celle de `world-walk` à 0, la première de
  `world-sit-turn-left-end` *est* celle de `world-sit-turn-left` à 1,100 s et celle
  de `world-sit-turn-right-end` celle de son cycle à 2,367 s. Respecter ces phases
  donne un raccord nul ; les ignorer redonne jusqu'à 46 cm d'écart.
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

Trois provenances, toutes trois libres de redistribution. Les crédits complets du
projet sont réunis dans le [README](../README.fr.md#crédits) ; le détail fichier par
fichier, les avis de licence et les mentions à conserver sont dans
[`NOTICE.md`](NOTICE.md), à lire avant toute redistribution :

- **Overte** — **Apache 2.0** : **111 clips**, soit tout le domaine face à face de
  la famille par défaut (31 clips : dix socles, vingt et un gestes) et tout le
  domaine monde 3D sauf les deux transitions assises (80 clips).
  `transitions.json` vient de la même source et de la même licence. Les **15 clips
  de `extra/`** viennent eux aussi d'Overte, sous la même licence — ils portent
  donc les mêmes obligations, qu'ils soient joués ou non.
- **Microsoft Rocketbox** — **MIT**, © Microsoft Corporation (2020) : les **38
  clips `rb-`**, la seconde famille de face à face — quatre repos, trois repos
  parlants, trois socles d'écoute, vingt-huit gestes. Commit épinglé
  `0943055`, convertisseur et plan livrés dans
  [`scripts/`](../scripts/convert-rocketbox.mjs). La MIT exige que l'avis de
  copyright et le texte de permission accompagnent toute redistribution : ils
  sont dans [`NOTICE.md`](NOTICE.md) §4.
- **Quaternius**, *Universal Animation Library* — **CC0 1.0**, domaine public :
  les deux transitions assises, la seule famille qu'Overte n'a pas.

La **CMU Graphics Lab Motion Capture Database** (conversion BVH de Bruce Hahne) a
fourni quinze gestes d'émotion à la première version de cette bibliothèque ; aucun
n'a tenu la règle d'acceptation ci-dessus, et plus aucun fichier n'en dérive.
