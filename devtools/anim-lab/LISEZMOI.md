# Banc d'essai des animations VRM (Hanami)

Outil de **diagnostic**, livré dans `devtools/` : il n'écrit **rien** dans l'app
ni dans ses données. Il lit les vrais fichiers du projet à travers un proxy.

Sa question principale tient en une phrase, celle du propriétaire :

> **Si les animations ne s'emboîtent pas comme il faut (idle, anim, idle), on vire.**

Le banc la transforme en un chiffre, en centimètres, et en un verdict par clip.

## Lancer

1. Le serveur du projet doit tourner (c'est lui qui détient les assets et l'API) :
   `npm run dev` à la racine du dépôt → <http://127.0.0.1:7788>.
2. Puis, depuis la racine du dépôt :

```
node devtools/anim-lab/serve.mjs
```

Sous Windows, double-clic sur **`devtools/LANCER-LE-BANC.cmd`** : le banc tourne
dans sa propre fenêtre, indépendante de tout agent, et survit à la session.

Il affiche l'URL à ouvrir : <http://localhost:7799/> (le port suivant si 7799 est
occupé). Aucune dépendance npm, `node:http` seulement.

Variables d'environnement facultatives : `HANAMI_ROOT` (racine du projet, pour les
`node_modules`), `HANAMI_HOST` / `HANAMI_PORT` (serveur du projet), `LAB_PORT`.

### Vérifier les chiffres sans navigateur

```
node sonde.mjs                      # le rig .vrm (+ le rig factice si reference/ est là)
node sonde.mjs --rig=vrm            # ce que la PAGE affichera
node sonde.mjs --rig=vrm --vrm=<chemin.vrm>
node sonde.mjs --clips=wave,happy   # un sous-ensemble
node sonde.mjs --json=sortie.json   # écrit dans le dossier du banc, nulle part ailleurs
```

`sonde.mjs` importe **`mesures.mjs`, exactement le même fichier que la page**, et
le fait tourner sous node. Si la page et la sonde donnent des chiffres différents,
c'est un bug : ils exécutent le même code sur les mêmes fichiers. C'est le seul
moyen de contrôler un affichage qu'on ne peut pas relire depuis un terminal.

Deux rigs, pour deux questions :

| `--rig` | Squelette | Sert à |
| --- | --- | --- |
| `factice` | rig Mixamo des archives de conversion, hanches au repos à **1,0167 m** | comparer à `raccords.json` et à `vrma/world.json`, qui y ont été mesurés — les valeurs doivent tomber **à l'identique**. Ces archives (`idle-lib.mjs`, `raccords.json`) sont des sous-produits de la conversion des clips, **non livrés** avec le dépôt : pose-les dans `devtools/anim-lab/reference/` (ou pointe `HANAMI_LAB_REF` dessus). Sans elles, la sonde ne fait tourner que `--rig=vrm` |
| `vrm` | squelette humanoïde d'un vrai `.vrm` du projet, monté à la main depuis le glTF (aucun mesh, aucune texture, donc aucun DOM) | prédire les chiffres que la **page** affichera |

La sonde signale d'elle-même, pour chaque clip qui s'écarte de `raccords.json`, si
la taille du fichier a changé (**un autre agent a remplacé le clip**) ou non
(**écart de mesure, à expliquer**).

## Les fichiers

| Fichier | Rôle |
| --- | --- |
| `serve.mjs` | serveur + proxy, zéro dépendance |
| `mesures.mjs` | **tout le calcul**, partagé mot pour mot entre la page et la sonde |
| `index.html` | la page : scène, contrôles, affichage. Aucune logique de mesure |
| `sonde.mjs` | contrôle headless |
| `verif-syntaxe.mjs` | `node verif-syntaxe.mjs` : fait analyser le module inline d'`index.html` par node, sans navigateur. À lancer après toute retouche de la page |
| `/diagnostic/` (URL) | fiches biomécaniques + planches PNG par clip, `RAPPORT.md`, `index.json` — écrits par `../diagnostic/diagnostic.mjs` dans `devtools/diagnostic-out/` (gitignoré), servis ici, affichés par l'onglet **Diagnostic** (voir la section dédiée) |

### La prise console

La page expose `window.banc` — un banc de diagnostic doit pouvoir être interrogé
autrement qu'à l'œil :

```js
banc.analyses.get('world-walk')   // l'objet complet d'un clip
banc.lignes()                     // le tableau, tel qu'il est exporté
banc.sequences()                  // les jointures mesurées
banc.hanchesRepos(), banc.echelleWorld()
await banc.analyserTout()         // relancer l'analyse depuis la console
banc.mesures                      // le noyau ./mesures.mjs lui-même
```

C'est aussi ce qui permet de comparer la page à `node sonde.mjs` ligne à ligne.

Ce que fait `serve.mjs` :

- sert `index.html`, `mesures.mjs` et les fichiers du dossier du banc ;
- **proxifie** `/api/*`, `/vrma/*`, `/vrm/*`, `/environments/*` vers le serveur du
  projet, en flux, sans réécriture — le banc consomme les vrais fichiers, aucune
  copie. C'est aussi par là que passent `world.json` et les requêtes `HEAD` qui
  donnent le poids de chaque clip ;
- sert `three` et `@pixiv/three-vrm*` depuis les `node_modules` **du projet** sous
  `/node_modules/`, résolus par l'`importmap` de la page (aucun bundler) ;
- refuse la traversée de chemin, les extensions inattendues et tout paquet autre
  que `three` et `@pixiv/*`.

**Aucune liste de clips n'est écrite en dur nulle part.** La page et la sonde
lisent `/api/vrm-animations` à chaque démarrage : des clips peuvent être ajoutés,
remplacés ou supprimés pendant que le banc tourne, il suffit de recharger.

---

# Le diagnostic biomécanique et les planches (onglet Diagnostic)

Les mesures de raccord ci-dessous disent si un clip **s'emboîte**. L'onglet
**Diagnostic** répond à l'autre question, celle du propriétaire : **est-ce que
c'est LOGIQUE et est-ce que c'est BIEN ?** — et il le montre, en images, sans
navigateur ni capture d'écran.

La page ne calcule rien ici : elle affiche ce que le devtools a écrit sur le
disque, dans `devtools/diagnostic-out/` (servi sous `/diagnostic/` par `serve.mjs`
comme le reste). Ce dossier est **gitignoré** : c'est régénérable, et volumineux.

## Générer / régénérer

```
# depuis la racine du dépôt
node devtools/diagnostic/diagnostic.mjs --lot                  # les 109 clips de vrma/  (~3 min)
node devtools/diagnostic/diagnostic.mjs world-walk             # un seul clip (~2 s)
node devtools/diagnostic/diagnostic.mjs extra/happy-5          # un clip de vrma/extra/
node devtools/diagnostic/diagnostic.mjs --lot --extra=tous     # + tout vrma/extra/
node devtools/diagnostic/diagnostic.mjs --rapport              # refond index.json + RAPPORT.md seuls
```

Options : `--modele=<motif>`
(défaut **sakura** — épinglé : deux exécutions ne se comparent qu'à modèle
égal), `--sans-images` (fiches seules, rapide), `--poses=N`.

## Ce que chaque sortie signifie

Par clip, dans `devtools/diagnostic-out/<clip>/` :

- **`fiche.md` / `fiche.json`** — le verdict du juge biomécanique (`devtools/diagnostic/juge/`) :
  critères applicables selon la famille (déduite du NOM), mesure, fourchette,
  et une phrase en français par défaut constaté. Toute longueur est en
  **cm-adulte** (fraction de hauteur de hanche × 0,93 m) pour être comparable
  d'un modèle à l'autre. La fiche.md contient aussi les **frises ASCII** du
  déroulé (appuis, bassin, genoux, opposition bras-jambes) : le film du clip,
  lisible dans un terminal.
- **`planche-profil/face/dessus.png`** — 12 poses au **cadrage commun** :
  maillage réellement déformé, squelette **bleu = gauche / rouge = droite**,
  pelure d'oignon, par case : t, hauteur du bassin, pied porteur. Gros plan
  auto sur ce qui bouge (borné : < 3 cm d'amplitude → plan large annoncé).
- **`traces.png`** — trajectoires pieds/mains/bassin/tête (plan vertical + vue
  de dessus), carrés noirs = pied au sol. Un pied qui PATINE laisse une trace
  rectiligne au sol ; un pied qui MARCHE laisse un arc. La course au sol du
  pied porteur y est chiffrée : sur un clip joué sur place, c'est **l'avance
  que le moteur doit rendre**.
- **`phase.png`** — appuis G/D en barres, hauteur du bassin, hauteur des
  semelles avec **zone rouge = sous le sol**, vitesse angulaire max des os.
- Le **sol est y = 0** (là où l'app pose le personnage) : une pénétration se
  VOIT, bandeau ATTENTION à l'appui. La semelle est mesurée sur le **maillage**
  du pied, pas sur l'os de cheville (9 cm trop haut).

Et à la racine : **`RAPPORT.md`** (l'index maître : verdicts par famille, notes
visuelles, liens vers chaque fiche et chaque image — c'est lui qu'un agent lit
pour juger la bibliothèque entière) et **`index.json`** (le même inventaire pour
la page).

## Les seuils du juge (résumé)

Universels : semelle ≤ 2 cm sous le sol · vitesse de pointe ≤ 800 °/s · torsion
épaules/bassin ≤ 45° · hyperextension genou ≤ 10°, coude ≤ 15° (sous 45° de
flexion) · axe de charnière du genou ≤ 30° hors plan (dès 12° de flexion).
Marche : 0 % de vol · double appui 10-25 % · levée du pied ≥ 6 cm · bassin
4-6 cm, 2×/cycle · opposition bras-jambes (corrélation ≤ −0,5) · pas 0,55-0,9 ×
hanche · genou porteur ≤ 25°. Assise : descente 40-50 % · tronc 10-30° en
avant · genou 85-100°. Repos : décalage avant-arrière des pieds ≤ 20 cm (la
garde de combat) · mains ≤ 30° · ça respire (buste/tête/mains). Hochement :
bon axe, 12-40°, 2-3 allers-retours. Le verdict d'un clip est son **pire**
critère : « limite » = regarder l'image avant de trancher.

## Ce que le diagnostic ne sait PAS juger

- **La gesticulation d'un repos parlant** : les variantes expressives
  (`idle-talking-5/6/7`, mains levées) sont marquées « défaut bras pendants »
  alors que c'est leur style — lire la note visuelle et l'image, pas le seul
  verdict.
- **L'écartement latéral des pieds** dépend du bassin du modèle (32 cm sur les
  proportions chibi de Sakura, hanches 0,755 m) : à lire « limite haute »,
  jamais « défaut ferme ».
- **La rotation vraie des pivots** (cycle refermé, cf. plus bas), **les
  fourchettes propres** de course/strafe/step/gestes tenus (universels
  seulement — la fiche le dit explicitement), **le visage et le regard**,
  **l'esthétique** (il dit plausible, pas joli).
- Un verdict **ne se transporte pas d'un modèle à l'autre** : le lot committé
  est mesuré sur `reference.vrm` ; pour comparer avant/après retouche,
  garder `--modele=sakura`.

Dans la page : l'onglet **Diagnostic** montre tout ça pour le clip sélectionné
(verdict, phrases, note visuelle, les cinq images cliquables, les critères en
détail). Si un clip n'a pas de dossier, l'onglet donne la commande exacte à
lancer.

---

# La règle d'acceptation

## Ce qu'on mesure, et pourquoi

Dans l'app, un geste est amené depuis le socle par un fondu croisé de **0,3 s**
(`GESTURE_FADE`), puis ramené au socle par un fondu de **0,4 s**
(`GESTURE_RETURN`) — constantes lues dans `client/src/scene/vrmStage.ts` et
recopiées dans `mesures.mjs`.

Ce que l'œil appelle « arrêt brusque » n'est donc pas *dans* le clip : c'est
l'écart entre ses extrémités et la pose du socle, que le lecteur doit franchir en
un temps **fixe**. Grand écart ÷ temps fixe = vitesse élevée et artificielle.

Un clip « s'emboîte » si sa **première** et sa **dernière** image sont proches de
la pose du socle.

| Écart | Verdict | Lecture |
| --- | --- | --- |
| ≤ 2 cm | **excellent** | invisible |
| ≤ 7 cm | **passe** | visible de près, acceptable |
| ≤ 10 cm | **limite** | à la frontière : à regarder à l'œil, en 0,25× |
| **> 10 cm** | **ÉCHOUE** | le clip ne s'emboîte pas — c'est le seuil posé par le propriétaire |

Le verdict d'un clip est le **pire** de ses quatre écarts : entrée et sortie,
contre `idle` **et** contre `idle-talking`. Un geste ne sait pas vers quel socle
il reviendra — pendant qu'une réponse s'écrit, c'est `idle-talking` qui tourne.

Le chiffre du verdict est en **centimètres** : la distance parcourue par l'os le
plus concerné, en position monde. Les degrés disent *quel* os ; les centimètres
disent *si ça se voit*. Un poignet à 40° ne se remarque pas ; un pied à 40 cm, si.

## Où il s'affiche

- **carte en haut de la scène** : le verdict en gros, avec les deux écarts et le
  fondu simulé ;
- **liseré gauche de chaque clip** dans la grille, avec `entrée / sortie` en cm ;
- **onglet Raccords** : le détail complet du clip courant ;
- **colonne VERDICT** du tableau, triable, et exportée en TSV.

Cliquer un clip l'analyse tout de suite. Le bouton **« Analyser les raccords »**
les fait tous (quelques dizaines de secondes, aucune lecture nécessaire).

## Le protocole, en détail

Repris de `../mesure-raccords.mjs`, éprouvé sur 43 clips.

- **Pose de référence du socle = pose MOYENNE sur un tour de boucle.** Un geste se
  déclenche à un instant quelconque du cycle du socle, qui tourne en continu : la
  pose de départ du fondu est donc tirée uniformément sur le cycle, et la moyenne
  en est l'espérance. La **dispersion** du socle autour de sa moyenne est écrite
  dans le journal (≈ 4° au pire os pour `idle`, ≈ 19° pour `idle-talking`), et la
  fiche Raccords donne la **fourchette** de l'écart selon la phase.
- **Un os que le socle n'anime pas** a pour référence la pose de **repos du rig**,
  pas la moyenne d'autre chose : c'est la valeur que `PropertyMixer` restaure
  quand le poids de la liaison tombe. La page capture cette pose de repos juste
  après avoir posé `REST_POSE_Z` et **avant** de créer la moindre action — donc à
  l'identique de ce que fera le lecteur. `idle` n'anime que 20 os sur 54.
- **La dernière image s'échantillonne à `durée − 1e-4`, jamais à `durée`.**
  `LoopRepeat` reboucle exactement à `durée` et rend la **première** image :
  l'écart de sortie serait faussement nul. C'est le piège le plus coûteux du sujet.
- **Simulation du fondu réel** : vrai `AnimationMixer`, vrais poids de `vrmStage`
  (somme = 1 par construction), `LoopOnce` + `clampWhenFinished` sur le geste,
  fondu de retour déclenché par l'évènement `finished`. On en tire le **pic de
  vitesse angulaire pendant chaque fondu**, comparé au pic pendant le clip.
  - On compare au **95e centile** du clip, pas à son maximum : une seule image
    écrêtée à 1000 °/s suffirait à écraser le rapport.
  - **`fondu/clip > 1` = la transition est plus violente que l'animation.** L'œil
    le lit comme une secousse. C'est un défaut mesurable, pas une impression.
  - La fiche donne aussi un **contrôle croisé** : le parcours réel du pire os entre
    la première et la dernière image du fondu, mesuré sur la simulation par un
    chemin totalement indépendant du calcul statique. Les deux doivent se
    rejoindre à quelques pour cent.

## Séquences

Onglet **Séquences**. Deux enchaînements, ceux que l'app fera :

```
world-walk-start → world-walk → world-walk-stop → idle
idle → world-sit-enter → world-sit-idle → world-sit-exit → idle
```

L'écart est mesuré à chaque **jointure** : dernière image du clip sortant contre
première image du clip entrant, mêmes seuils, même verdict.

Si le clip sortant **boucle**, sa « dernière image » n'a aucun sens : il sera
quitté à une phase quelconque. On échantillonne alors tout le cycle et on juge sur
le **pire** cas — c'est lui qui décidera de la crédibilité de la scène, pas la
moyenne. La fiche donne quand même moyenne et meilleur cas, et l'instant du pire.

Le bouton **jouer en boucle** enchaîne réellement les clips, avec les fondus de
l'app, pour juger à l'œil. Les clips en boucle sont tenus quelques secondes
seulement : assez pour être quittés à une phase quelconque, pas assez pour rendre
la séquence interminable.

---

# Les deux domaines

La bibliothèque se partage en deux domaines, et **le préfixe du nom suffit à les
distinguer** (cf. `vrma/README.md`) :

- **face à face** (sans préfixe) : l'avatar debout devant l'utilisateur qui
  discute — repos et gestes ;
- **monde 3D** (préfixe `world-`) : la scène interactive — allures, pivots,
  postures assises, saut.

La grille les sépare en deux groupes, chacun avec son **poids total**, lu par
requête `HEAD` sur chaque fichier (aucun octet téléchargé). Le chargement paresseux
du domaine `world-` est une optimisation voulue : en mode conversation, ces
mégaoctets n'ont aucune raison d'être téléchargés. Le voir chiffré, c'est le
défendre. Un sélecteur permet de n'afficher qu'un domaine.

## `world.json`, et sa vérification

Onglet **Monde 3D**. Pour un clip `world-`, le banc affiche ce que `vrma/world.json`
affirme, ce qu'il mesure lui-même, et **confronte les deux**.

**Mise à l'échelle.** Les valeurs de `world.json` sont mesurées sur un rig dont les
hanches au repos sont à **1,0167 m**. Le banc affiche le facteur
`hanchesDuVRM / 1,0167` en tête de l'onglet et dans le journal.

- Les **mètres** et les **m/s** sont comparés à `annoncé × facteur`.
- Les **fractions** (hauteur du bassin) sont comparées **telles quelles** : c'est
  tout leur intérêt, elles se transportent d'un modèle à l'autre.

**Vitesse d'allure.** Le clip est joué sur place : les hanches ne bougent pas,
c'est le pied en appui qui recule, et son recul *est* l'avance que le code devra
appliquer. Le banc en donne une **fourchette**, pas un chiffre :

- *prudent* — on ne compte que le recul du pied en appui, l'intervalle étant
  attribué au pied qui l'était à son début. Sous-estime un peu ;
- *large* — tout recul de chaque pied sur le cycle. Majore un peu (un pied peut
  reculer pendant son envol).

La vérité est entre les deux ; les afficher tous les deux évite de faire passer une
convention de mesure pour une propriété du clip. L'accord est déclaré si la valeur
annoncée tombe dans la fourchette, à 10 % près.

Le banc contrôle aussi la **cohérence interne** de `world.json` : `distanceParCycleM
÷ dureeS` doit redonner `vitesseMS`. Et la **taille du fichier** : si elle ne
correspond plus, le clip a été remplacé depuis que `world.json` a été écrit.

---

# Les trois mesures en direct

Elles n'ont pas changé, et ne sont remplies qu'après **« + passe en direct »**
(3 s par clip, 1×). Toutes sont recalculées à chaque image et gardent leur
**maximum**. Elles sont prises **après** `mixer.update()` et `vrm.update(delta)`,
donc sur la pose réellement affichée. La base de comparaison est la première image
du clip (en mode « depuis l'idle », la fin du fondu d'entrée).

### 1. Glissement des pieds — « les pieds patinent »

Déplacement **horizontal** (X/Z) de chaque pied par rapport à sa position au début
du clip. Os `leftFoot` / `rightFoot` **bruts**. Dans la scène : l'anneau au sol
marque la position de départ et **son rayon est le seuil de 3 cm** ; le point de la
même couleur suit le pied.

| Valeur | Lecture |
| --- | --- |
| < 3 cm | normal (un appui bouge toujours un peu) |
| 3 à 8 cm | **à regarder** — glissement visible sur un clip censé rester sur place |
| > 8 cm | **défaut** — le pied balaie le sol |

Deux compléments : la **dérive des hanches** (au-delà de 5 cm sur 3 s, le
personnage quitte sa place) et le **pied le plus bas** (négatif au-delà de −1 cm =
pénétration du sol).

⚠️ Les clips marqués `†` sont des **déplacements** (allures, pivots, saut, départs
et arrêts) : une grande amplitude de pied y est normale, le tableau ne les colorie
pas. Pour eux la question est l'inverse — *le pied posé reste-t-il fixe pendant sa
phase d'appui ?* Ça se juge à l'œil, en 0,25×, depuis la vue de dessus.

### 2. Orientation — lacet du buste par rapport à l'axe caméra

Angle entre l'**avant du personnage** et le **+Z du monde** (l'axe où l'app place
sa caméra). L'avant est déduit de la **géométrie** — vecteur épaule gauche → épaule
droite, puis produit vectoriel avec la verticale — et non du quaternion du bassin :
un VRM 0.x porte son bassin à l'envers, et une rotation globale du modèle n'y
change rien puisqu'elle tourne aussi les pieds. `mesures.mjs` utilise le même avant
pour les vitesses d'allure : les deux parlent du même « avant ».

| Valeur max | Lecture |
| --- | --- |
| < 15° | normal |
| 15 à 30° | **à regarder** — le visage commence à quitter la caméra |
| > 30° | **défaut** — le clip tourne le dos à l'interlocuteur |

### 3. Vitesse angulaire max par groupe d'os

Vitesse de rotation **locale** de chaque os, en degrés par seconde, exprimée en
temps de **clip** — ralentir la lecture ne change pas les chiffres. Regroupée en
*jambes*, *bras*, *mains*, *tête*. Le pic global est affiché avec le nom de l'os.

| Valeur max | Lecture |
| --- | --- |
| < 500 °/s | plausible, même pour un geste vif |
| 500 à 1000 °/s | **à regarder** — mouvement très sec, souvent une interpolation ratée |
| > 1000 °/s | **défaut** — quasi certainement un retournement de quaternion |

Repère : un geste humain rapide plafonne vers 300–500 °/s. Un poignet à 1500 °/s ne
se voit pas comme un mouvement, mais comme un scintillement.

L'image qui suit un rebouclage est ignorée (le saut fin → début produirait un pic
artificiel). C'est aussi pourquoi **la passe en direct joue les clips sans fondu** :
un crossfade fausserait les trois mesures. La case « depuis l'idle » sert à juger
les transitions à l'œil, pas à mesurer.

---

# Le reste de la page

- **Scène** reprise de `client/src/scene/vrmStage.ts` : optique 30°, key light
  directionnelle 2,2 (0,3 / 1,6 / 1,2) + hémisphérique d'appoint 0,6, régime
  d'éclairage abaissé (1,1 / 0,35) dès qu'un décor est en place, `VRMUtils`
  (`removeUnnecessaryVertices`, `combineSkeletons`, `rotateVRM0`, `deepDispose`),
  pose de repos anti T-pose, normalisation d'échelle hors [0,5 ; 3] m.
- **Cadrages** : *corps entier* (par défaut — c'est aux pieds que tout se joue),
  *buste* (reprise exacte de `frameCamera`), *pièce entière*. Boutons *face* /
  *côté* / *dessus*, et clic-glisser pour orbiter.
- **Onglet Décors** : charge un `.glb`, applique le sidecar `<décor>.json`
  (`scale`, `rotationY` en **degrés**, `spawn`, `exposure`) s'il existe — son
  absence est le cas normal — puis affiche les dimensions mesurées de la pièce, le
  rapport à la taille du personnage et la hauteur des pieds. Le rapport **hauteur
  de la pièce / taille du personnage** doit tomber entre ~2 et ~2,5. Dès que
  `scale` est présent, l'ajustement automatique est **désactivé** (c'est la parole
  de l'auteur), même si la valeur est absurde. `rotationY` est lu en **degrés** :
  une valeur en radians (π, 1,5708…) ne fait presque rien tourner.
- **Onglet Tableau** : toutes les grandeurs, triable par clic sur un en-tête,
  copiable en TSV, cliquable pour rejouer un clip. Le bouton **élargir** donne au
  tableau la largeur qu'il mérite (une trentaine de colonnes).
- **Journal** en bas de la scène : toute exception, tout `console.warn` /
  `console.error`, avec un compteur rouge dans l'en-tête. Si la page semble vide,
  c'est là qu'il faut regarder d'abord.

---

# Ce que le banc ne peut PAS juger

- **La rotation d'un pivot.** `world-turn-left` / `world-turn-right` sont des
  cycles joués sur place et **refermés** : après un tour, chaque os retrouve sa
  valeur de départ, donc la rotation n'est plus dans le fichier — elle n'existe que
  dans la métadonnée. Le banc la cherche dans le cap du pied en appui, mais la
  cheville tourne aussi activement et rien ne sépare les deux : il trouve ~78° là
  où `world.json` annonce 53,2°. Le chiffre est affiché comme **indicatif** et
  classé en *réserve*, pas en désaccord. Le banc ne peut pas trancher.
- **La vitesse d'allure au pour-cent près.** Voir la fourchette prudent/large :
  l'écart entre les deux conventions est de l'ordre de 5 à 20 % selon le clip.
- **L'idle procédural** de l'app (respiration, clignement, sway de tête,
  `IdleAnimator`) n'est pas appliqué : il ajouterait un bruit permanent. Le banc
  juge le clip, pas le clip + l'idle.
- **Les expressions faciales et le lipsync** ne sont pas pilotés.
- **L'agrément.** Un clip peut passer tous les seuils et rester laid, ou échouer et
  rester le meilleur candidat disponible. Le verdict trie ; il ne décide pas seul.
- **Un verdict n'est pas transportable d'un modèle à l'autre.** Les centimètres
  dépendent des proportions du rig : le même clip donne 48,7 cm sur le rig de
  mesure (hanches 1,0167 m) et 45,7 cm sur un modèle à 0,9748 m. Changer de modèle
  vide toute l'analyse, exprès. Comparer les clips entre eux sur un même modèle,
  jamais d'un modèle à l'autre.
- **Ce qui se passe entre deux images du fichier.** Tout est échantillonné à 30 i/s,
  la grille des clés source.
- Un **onglet caché** met le rendu en pause (rAF) : une *passe en direct* s'y
  interrompt. L'*analyse des raccords*, elle, n'en dépend pas et va au bout.
