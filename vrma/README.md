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
| **face à face** | pas de préfixe | l'avatar debout devant l'utilisateur qui discute : repos, repos en train de parler, gestes d'émotion | 30 fichiers, 7,69 Mo |
| **monde 3D** | préfixe `world-` | la scène interactive où le personnage marche, divague, s'assoit et réagit : allures, départs et arrêts, virages, changements de posture, gestes tenus, tout le vocabulaire assis | 81 fichiers, 11,91 Mo |

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

Les 30 clips actuels tiennent tous entre **4,1 et 8,8 cm** sur la pire de leurs
quatre mesures (entrée et sortie, contre chacun des deux socles), médiane 5,5 ;
contre le socle `idle` seul, de **0,8 à 6,8 cm**, médiane 3,2. Les deux plus hauts
(8,8 et 7,6 cm) sont `idle-talking-4` et `relaxed-3`, promus depuis `extra/` après
jugement à l'image : leur raccord est en haut de la fourchette, pas au-dessus du
seuil, et le fondu l'absorbe. Un clip qui ne tient
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

**Le chargement paresseux est voulu.** En mode face à face, les 11,91 Mo du domaine
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

## `extra/` — les clips convertis et non retenus

Le sous-dossier [`extra/`](extra) contient **16 clips** (4,52 Mo) issus de la même
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
| `world-afk-texting.vrma` | personnage qui pianote sur son téléphone. **Orphelin du graphe** : `afk_texting.fbx` n'est référencé par aucun nœud, Overte lui-même ne le joue jamais | — |

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
| les cinq `world-jump-*`, `world-afk-texting` | le préfixe `world-` suffit à les faire entrer dans le domaine monde 3D, mais le moteur de scène ne les enchaînera pas sans entrée correspondante dans [`world.json`](world.json) |

Ces clips ont été écartés **sur mesure**, pas au hasard. Au-dessus de 10 cm, le
raccord socle → geste → socle se voit : le corps est tiré et les pieds glissent sans
pas. C'est exactement ce que la règle protège, et c'est ce qu'on accepte de perdre en
en activant un.

## La semelle sous le sol : ce que ces fichiers ne corrigent pas, et pourquoi

Un banc de diagnostic mesure, sur `reference.vrm` (hanches 0,755 m), que
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
62 passe), 0 échec et les 4 « limite » pré-existants sur le rig 0,9045 — aucune
régression, prouvée par la sonde intégrale des deux rigs avant/après chaque
correction. Les « pieds qui glissent » des cinq gestes face (`relaxed-2/-3`,
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

Deux provenances, toutes deux libres de redistribution. Les crédits complets du
projet sont réunis dans le [README](../README.fr.md#crédits) ; le détail fichier par
fichier, les avis de licence et les mentions à conserver sont dans
[`NOTICE.md`](NOTICE.md), à lire avant toute redistribution :

- **Overte** — **Apache 2.0** : **107 clips sur 109**, soit tout le domaine face à
  face (28 clips : neuf socles, dix-neuf gestes) et tout le domaine monde 3D sauf
  les deux transitions assises (79 clips). `transitions.json` vient de la même
  source et de la même licence. Les **19 clips de `extra/`** viennent eux aussi
  d'Overte, sous la même licence — ils portent donc les mêmes obligations, qu'ils
  soient joués ou non.
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
| **face to face** | no prefix | the avatar standing in front of the user, talking: idles, talking idles, emotion gestures | 30 files, 7.69 MB |
| **3D world** | `world-` prefix | the interactive scene where the character walks, wanders, sits down and reacts: gaits, starts and stops, turns, posture changes, held gestures, the whole seated vocabulary | 81 files, 11.91 MB |

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

The current 30 clips all stay between **4.1 and 8.8 cm** on the worst of their four
measurements (in and out, against each of the two idles), median 5.5; against the
`idle` base alone, **0.8 to 6.8 cm**, median 3.2. The two highest (8.8 and 7.6 cm)
are `idle-talking-4` and `relaxed-3`, promoted from `extra/` after a judgement by
eye: their seam is at the top of the range, not over the threshold, and the fade
absorbs it. A clip that misses the threshold
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
| `relaxed` | `relaxed`, `relaxed-2`, `relaxed-3` | neck stretch, weight shift, 14 s waiting fidget |
| `surprised` | **none** | Overte has no surprise emote |

And the base poses, which the player picks at random: **five idles** (`idle` →
`idle-4`, `idle-7`) and **five talking idles** (`idle-talking`, `idle-talking-4` → `-7`).

Overte draws from four and seven respectively, every 10–30 s for the idle and
7–12 s for speech; that is what keeps an avatar from visibly replaying its loop.

The 3D world is **generous**: the scene needs material, and these clips are never
played face to face.

**Lazy loading is intended.** In face-to-face mode, the 11.91 MB of the `world-`
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

**And `raise-hand` RAISES a hand, it does not wave.** `raise-hand` and
`raise-hand-2` raise a hand and **hold** it — 8 s of hold for the first. The forearm
beats at only 0.20 and 0.08 round trips per second, where a wave needs two or three:
this is the gesture of someone **asking to speak**, and that is the intended role.
The diagnostic bench counts it as a cadence defect for lack of a range for "hand
raised and held". If the app ever wants a wave, these two are not it.

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

## `extra/` — the converted clips that were not kept

The [`extra/`](extra) subfolder holds **19 clips** (5.22 MB) from the same
conversion pass as the others: same tools, same fixes, same round-trip validation,
same credits (see [`NOTICE.md`](NOTICE.md) §1). They simply have no place in the
active library. They ship anyway, because a clip that was converted and then set
aside costs nothing but its bytes on disk, and because the judgement that set it
aside can be revisited.

**The app never downloads them.** `/api/vrm-animations` lists `vrma/` **flat** — a
`readdir` with no recursion, filtered on `.vrma`. A file sitting in `extra/`
therefore appears in no catalogue, and the player never asks for it. The server
would serve it if given the URL; nothing gives it the URL. The weight of `extra/`
is repository weight, not download weight.

The "seam" column is the [acceptance rule](#the-acceptance-rule-in-numbers)
measurement: the worst gap, in centimetres, between the clip's edges and the rest
pose of the `idle` and `idle-talking` bases. Failure threshold: 10 cm.

| File | Why it is here | Seam |
| --- | --- | --- |
| `idle-talking-2.vrma` | talking idle — the arms end up far from the base pose | 39.5 cm |
| `raise-hand.passe-complete.vrma` | raised hand, **whole pass** (intro + hold + outro): this is the clip the `world-` domain ships split into `world-raise-hand-in` / `-hold` / `-out` | 18.8 cm |
| `point.vrma` | pointing, whole pass — same story, shipped split as `world-point-…` | 15.7 cm |
| `happy-6.vrma` | a fourth clap | 14.9 cm |
| `idle-talking-3.vrma` | talking idle, just over the threshold | 11.2 cm |
| `happy-5.vrma` | clap — **it is `happy-2`**: the two clips never differ by more than **3.4°** (worst bone, over the whole duration). Promoting it would give the random draw the same emote twice. The wrist jolt it carries (1000 °/s at t = 0.3 s) was therefore smoothed **in `happy-2`**, where it actually plays | 8.7 cm |
| `neutral-2.vrma` | slow head nod — **redundant with the five `nod`s**: the face-to-face vocabulary must stay short, and `neutral` already has its clip. It holds up visually, but adds nothing | 8.1 cm |
| `cand-idle-fenetre.vrma` | `idle` re-converted on the window the graph **declares** (1→300) instead of the trim that was kept — near-identical to the shipped file | 5.0 cm |
| `cand-idle-2-fenetre.vrma` | same for `idle-2` (1→902) | 5.0 cm |
| `cand-idle-3-fenetre.vrma` | same for `idle-3`, but the declared window runs **26.63 s** where the shipped file keeps only a 13.33 s sub-loop: this one really is different | 5.2 cm |
| `cand-idle-talking-fenetre.vrma` | same for `idle-talking` (1→215) | 5.5 cm |
| `world-jump-start.vrma`, `world-jump-air.vrma`, `world-jump-land.vrma`, `world-jump-run-start.vrma`, `world-jump-run-land.vrma` | the five beats of a jump. In Overte the airborne phase is not an animation but **fixed poses blended by the physics engine's vertical speed**, and the jump height lives in the simulation, not in the file: without that code they do not stand up (see [`NOTICE.md`](NOTICE.md) §3) | — |
| `world-afk-texting.vrma` | character tapping at a phone. **Orphaned in the graph**: `afk_texting.fbx` is referenced by no node, Overte itself never plays it | — |

**Two of these clips moved up to the root** after the library's first judgement by
eye: `idle-talking-4` (8.8 cm) and `relaxed-3` (7.6 cm). They fell outside the range
of the clips that were kept (4.1 to 8.0 cm) without crossing the 10 cm threshold,
and that was the only reproach the measurement had for them; on screen, the first
gesticulates exactly like the `idle-talking-5/-6/-7` already in place, the second is
a credible background loop. The two that remain above the range, `happy-5` and
`neutral-2`, stay here — not for their seam, but because they **duplicate** a clip
that already ships (see the table).

**Six converted clips are deliberately not here**: the raw versions of
`world-sit-point`, `world-sit-raise-hand-2` and the four `world-walk-stop-…`, from
before their geometric fixes (hips and legs given back to the seated clips, stops
anchored onto their neighbours). The folder already carries those six clips in
their corrected version, under the same name; the raw version has its legs in the
bind pose — standing, under a seated body — or its feet unanchored. That is not a
variant, it is an earlier state.

### Enabling one of these clips

1. **Move** the file from `vrma/extra/` to the root of `vrma/`.
2. **Rename it** according to the [convention above](#naming-convention) — the name
   IS the configuration, and any name outside the convention is ignored.
3. **Reload the page.** The catalogue is rebuilt from the files actually present;
   the server does not need restarting.

`happy-5`, `happy-6`, `idle-talking-2` to `-4`, `neutral-2` and `relaxed-3` already
carry a conforming name and a free number: they move as they are, and **gaps in the
numbering have no effect**. The others need a name:

| File in `extra/` | Name to give it at the root |
| --- | --- |
| `cand-idle-fenetre`, `cand-idle-2-fenetre`, `cand-idle-3-fenetre` | `idle-8`, `idle-9`… — or the name of the clip they re-convert, to replace it. `idle-5` and `idle-6` are free but already used as `world-idle-alt1` / `-alt2`: reusing them invites confusion |
| `cand-idle-talking-fenetre` | `idle-talking-8`, or `idle-talking` to replace the shipped one |
| `raise-hand.passe-complete` | `raise-hand-3`; or `raise-hand` to replace the intro-only clip that ships. The `.passe-complete` suffix exists only to avoid a name collision inside `extra/`, it means nothing to the player |
| `point` | there is no `point` role in the face-to-face vocabulary: under that name the clip stays ignored. Fold it into a neighbouring role, or leave it to the `world-` domain, which already ships it split |
| the five `world-jump-*`, `world-afk-texting` | the `world-` prefix is enough to place them in the 3D-world domain, but the scene engine will not sequence them without a matching entry in [`world.json`](world.json) |

These clips were set aside **on a measurement**, not at random. Above 10 cm the
base → gesture → base seam shows: the body is dragged and the feet slide without a
step. That is exactly what the rule protects, and what you accept losing by
enabling one.

## The sole under the floor: what these files do NOT fix, and why

A diagnostic bench measures, on `reference.vrm` (hips 0.755 m), that **55 clips
sink the sole below the floor**: the whole seated family by 8.5 to 10.4 cm, the
strafes and runs by 5 to 10, the walks by 2.5 to 5.2. The reflex is to raise the
hips translation track inside the `.vrma`. **That would be wrong, three times over.**

**1. All 55 are `world-` clips.** The worst of the face-to-face domain is `idle-7`
at 1.6 cm, under the 2 cm of sole thickness the bench tolerates. And the 3D world
runs under a **leg inverse kinematics** pass (`client/src/scene/legIk.ts`), called
every frame, whose whole job is exactly this: standing it **lifts** a foot that goes
through the floor, seated it makes the foot **reach** for it. Its header quotes the
same measurements as the bench ("`world-sit-idle` — 37 to 62 mm → very visible"):
the defect is already corrected, in the right place, by articulating the leg rather
than translating the body.

**2. For the seated family, hip height is LOAD-BEARING.** It is
`postureAssiseCanonique` in [`world.json`](world.json) — 0.5409 hip — and the code
uses it to place the pelvis on the furniture's real seat. Raising the seated clips by
8.6 cm would make the character **hover above the chair** by exactly that much, and
the IK would stretch the legs to catch the floor.

**3. For the gaits, it is not an offset.** Measured frame by frame, the sole of
`world-walk` ranges from 0 to −5.2 cm within the cycle (median −1.1): it just touches
at double support and sinks at mid-stance, because the stance knee is over-flexed. A
constant 5.2 cm lift would leave **85 % of the cycle airborne by more than 2 cm** —
trading a foot in the floor for a character on an air cushion. And a lift that
follows the penetration frame by frame does straighten the pelvis curve, but injects
**2 cm of limp** between the two half-cycles and **1.4 cm of pop at the loop seam**.
The seated family is the one case where the sink IS constant (spread ≤ 0.4 cm across
34 clips) — and that is precisely the one point 2 forbids touching.

The rule that falls out: **a `.vrma` describes a pose, not an altitude.** The floor
is the engine's job.

## Fixes applied to the shipped clips

These clips are no longer the raw conversion of their source. Every fix was measured
before and after on the same bench, and validated by a full round trip (`GLTFLoader`
+ `VRMAnimationLoaderPlugin` + `createVRMAnimationClip`, frame-by-frame replay,
sample at `duration − 1e-4`).

| Clip | Fix | Before → after |
| --- | --- | --- |
| `world-run`, `world-strafe-left-run`, `world-strafe-right-run` | the right knee broke **backwards** at push-off: at the worst instant the knee sticks out 13 cm in front of the hip-ankle line. The knee track is soft-clipped (`tanh`, so no jolt and no broken seam) at the human limit | hyperextension **41°, 41°, 37° → 10°** — sole penetration, foot lift and seam all unchanged |
| `world-turn-right` | the left knee bent 58° out of the plane of the leg during the crossover. The shin is brought back into the thigh's plane by a twist about the femoral axis (which does not touch flexion) | hinge **58° → 29°**, inside the envelope of `world-turn-left` (31°), which is healthy. Bench verdict: **defect → good** |
| `shake` | did not read as a "no": **one single** 56° sweep. The window Overte's graph declares (frames 1→72) is already the whole file, and the only other standing "no" in the source (`thoughtfulheadshake`) is a single sweep too — there was nothing more to fetch. The central sweep is therefore **replayed as a time mirror**, with the turning points taken at the yaw extremes where the speed is zero; then the amplitude is brought down to that of `world-sit-shake`, Overte's own seated "no" | **0.5 → 1.5** round trips · amplitude **56° → 39°** · duration 2.30 → 3.63 s · **both edge poses are bit-for-bit the originals**, so the seam to the idle does not move |
| `happy-2` | a 1000 °/s wrist jolt at t = 0.3 s (a badly interpolated key join), and a second at 818 °/s at t = 0.7 s. Local Laplacian smoothing on the quaternions, with zero weight at the window edges | peak speed **1000 → 688 °/s** · outside the window the file is unchanged, **edges included** |
| `world-sit-legs` | the clip has **no shoulder track at all**: the shoulders stayed open as if standing, under a seated body, and the gap to the seated hold was **11.6 cm constant across all 138 frames**, carried by `rightShoulder` (21.6°). It was never the crossed ankles. Both shoulders were given the mean pose of `world-sit-idle`, constant — the same graft the seven hipless seated clips got — then both edges anchored onto that same hold | **11.6 → 0 cm** · peak speed **unchanged** (49 °/s) |
| `world-sit-talking-2` | it is a **loop**, and a loop has no "start": this one opened 13.8 cm away from the seated hold when its frame 21 was only 7.1 away. Its start phase is shifted by 21 frames (0.700 s) — the new seam is an *interior* interval of the clip, hence exact by construction — then both edges anchored onto `world-sit-idle` | **13.8 → 0 cm** · seam **0 cm**, speed jump **68 → 32 °/s** · peak **unchanged** (269 °/s) |
| `world-raise-hand-in` | the hand already started high: **13.6 cm** between `idle` and the first frame, at the worst of the idle's 300 phases. A gesture fires when the intent arrives, not when the idle is ready — no phase contract is possible here, so the upstream edge is anchored onto the **mean** pose of `idle` and the downstream edge onto `world-raise-hand-hold` at t = 0 | **13.6 → 1.6 cm** at the worst of 300 phases (0.2 at best) · exit **2.6 → 0 cm** · peak **unchanged** (936 °/s) |
| `world-sit-turn-left-end` | seated pivot settle: **35.9 cm** at the worst phase of the upstream cycle, 10.4 at the best. No phase saved the seam — the cycle holds the left forearm ~36° away from the settle's opening at *every* phase. The first frame is therefore anchored onto `world-sit-turn-left` at **t = 1.100 s** (0.80 s window, so the travel stays under the clip's own peak) and the last onto `world-sit-idle`; the phase becomes a **contract** in `world.json` | **35.9 → 0 cm** upstream, **0.4 → 0 cm** downstream · peak 64 → 77 °/s (2.6°/frame, below visibility) |
| `world-sit-turn-right-end` | same defect, worse (**43.3 cm**), plus one of its own: the source FBX has **no track at all** on `spine`, `chest`, `upperChest`, `neck` or either shoulder — 6 major bones out of 20 put back standing under a seated body, i.e. **16.4 cm of residue no anchoring could touch**, there being no track to correct. All six were grafted: the cycle's pose at its exit phase, then a smoothstep back to `world-sit-idle` over the clip's duration — the torso untwists, which is what a settle is meant to show. Anchoring and phase contract (t = 2.367 s) as for its mirror | **43.3 → 0 cm** upstream, **14.5 → 0 cm** downstream · `osAnimes` **14 → 20** · peak speed **unchanged** (170 °/s) |

**The last five rows are one single pass** — the one that clears the five defects the
reworked bench still found across 111 clips. Three choices govern it, and they
generalise:

1. **A bone with no track falls back to the rig's REST pose** — standing, shoulders
   open. On a seated clip *that*, not the gesture, decides the verdict:
   `world-sit-legs` and `world-sit-turn-right-end` were measuring a shoulder and torso
   defect, not a motion defect. The measurement says so unambiguously: the gap is then
   **constant over the whole clip**.
2. **Terminal bones are excluded from the anchoring** (`head`, both hands, both toes):
   their own rotation moves **no** measured bone — a hand's position comes from its
   forearm, a toe's from its foot, and fingers are out of the measurement. Anchoring
   them gains nothing and adds a jolt; inside a loop, a jolt replayed every cycle. On
   `world-sit-talking-2` the left wrist was 129° away: anchoring it would have taken
   the peak from 269 to **639 °/s** for zero centimetre gained.
3. **A phase contract is measured, not decreed — and it does not apply everywhere.**
   It holds for a cycle the code can *choose* when to leave (gaits, pivots); it does
   not hold for an idle a gesture interrupts whenever the intent arrives
   (`world-raise-hand-in` therefore targets the mean pose of `idle`, not one of its
   phases).


**`world-walk-slow` was examined and left alone.** Its feet only clear the ground by
2.6 cm and it is the gait of the autonomous wander, but both proposed exits fail on
measurement: replacing it with a slowed `world-walk` needs a factor of **3.69**
(1.421 against 0.385 m/s), i.e. a 1.42 m stride spread over 3.7 s, and would break
the stroll's phase contract and stride, which live in `client/src/scene/wander.ts`;
retouching it by flexing the swing knee **trades one defect for another** — at +18°
ground clearance goes from 2.6 to 5.6 cm (defect → borderline) but double support
falls from 15 to 5 % of the cycle (good → defect), and at +26° clearance becomes good
at the cost of that same double support. It is a short-stepped shuffle (18.4 cm,
0.20 × hip height): making it lift its feet makes it a different gait.

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
  walking **and the two seated pivots** — **at which phase of the cycle to enter and
  leave it**. The ends of the transitions are anchored onto the neighbouring poses:
  the last frame of `world-walk-start` *is* the pose of `world-walk` at 0.200 s, the
  first frame of `world-walk-stop` *is* the pose of `world-walk` at 0, the first
  frame of `world-sit-turn-left-end` *is* that of `world-sit-turn-left` at 1.100 s,
  and that of `world-sit-turn-right-end` its own cycle's at 2.367 s. Honour those
  phases and the seam is nil; ignore them and it goes back up to 46 cm.
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
  from the same source under the same licence. The **19 clips in `extra/`** also
  come from Overte under the same licence — they carry the same obligations,
  whether or not they are ever played.
- **Quaternius**, *Universal Animation Library* — **CC0 1.0**, public domain: the
  two seated transitions, the one family Overte does not have.

The **CMU Graphics Lab Motion Capture Database** (BVH conversion by Bruce Hahne)
supplied fifteen emotion gestures to the first version of this library; none of
them held the acceptance rule above, and no file derives from it any more.
