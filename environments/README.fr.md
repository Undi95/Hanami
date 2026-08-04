[English](README.md) | **Français**

# Décors 3D

Dépose ici des fichiers `.glb` (ou `.gltf`) — ils apparaissent dans Hanami
(création/édition de personnage → menu « Décor 3D »). Le décor remplace le fond
2D : l'avatar est posé DANS la pièce.

## Format attendu

- **Unités : mètres**, axe **Y vers le haut** (convention glTF).
- **Origine au sol** à l'endroit où le personnage doit se tenir : **recommandé,
  plus obligatoire**. C'est votre choix qui fait foi tant qu'il tient debout ;
  sinon (un quai posé au-dessus de sa voie, un diorama sur son socle) l'analyse
  **cale le décor toute seule** — voir « Calage automatique » plus bas. Hanami
  pose de toute façon le décor sur le sol et ne corrige l'échelle que si elle est
  absurde (hauteur hors de l'intervalle 1,5 m – 12 m).
- **Autoportant** : textures embarquées dans le `.glb`. Les fichiers `.gltf` qui
  référencent des textures externes doivent avoir ces fichiers à côté d'eux.
- **Compression Draco / meshopt / KTX2 non prise en charge** : le décor est
  refusé avec un message d'erreur clair. Réexporte sans compression.

## Placement (sidecar `.json`, optionnel)

À côté de `chambre.glb`, un `chambre.json` ajuste le placement sans toucher au modèle :

```json
{
  "scale": 1,
  "rotationY": 0,
  "spawn": [0, 0, 0],
  "exposure": 1
}
```

- `scale` — facteur d'échelle (0,01 à 100). Le donner **désactive l'ajustement
  automatique** : c'est votre valeur qui fait foi, même si elle est extravagante.
- `rotationY` — rotation en **degrés** autour de l'axe vertical.
- `spawn` — point du décor `[x, y, z]`, en mètres, où poser le personnage : c'est
  le décor qui se déplace, l'avatar reste à l'origine du monde. `x`/`z` se
  mesurent sur le décor tel qu'il s'affiche (après `scale` et `rotationY`), et `y`
  se compte **depuis le sol** du décor — `[0, 1.2, 0]` pose le personnage sur une
  estrade de 1,2 m.
- `exposure` — multiplicateur des **couleurs des matériaux du décor** (0,1 à 4)
  pour un décor déjà sombre ou déjà très clair. Il n'agit pas sur les lumières :
  trois des sept décors livrés sont `KHR_materials_unlit` et les ignorent
  totalement. L'avatar, lui, n'est jamais touché. Attention, comme partout ici,
  une valeur **hors bornes est ignorée**, donc repli sur 1 (décor intact) : écrire
  `4.5` rend un décor plus sombre qu'attendu, pas plus clair.

Trois clés de plus servent aux cas particuliers ; les décors livrés en donnent
chacun un exemple :

- `frameDistance` — distance du cadrage par défaut de la caméra (0,5 à 8 m) voulue
  par **ce** décor : une grande salle se regarde de plus loin qu'une chambre. Sans
  elle, l'app choisit.
- `materials` — réparations d'un asset abîmé, **par nom de matériau glTF**. Forme
  courte `"Sol": [r, g, b]` : l'albédo est **remplacé** (composantes **linéaires**
  0-1, la convention de `baseColorFactor`, pas du sRGB) ; forme longue
  `{ "color": [...], "transmission": 0 }`. Deux cas réels sont livrés — les sols de
  `rustic-bedroom`, arrivés quasi noirs de l'export et qu'aucune exposition ne
  rattrape, et trois bocaux décoratifs de `cozy-loft-room` dont la transmission
  coûtait une passe de rendu entière à chaque image. Un nom de matériau inconnu est
  sans effet.
- `backdrop` — jusqu'à **huit** panneaux de fond posés derrière les ouvertures du
  décor (fenêtre sans vitrage, mur ouvert, plan de coupe) : sans eux, le fond de
  page de l'app se voit au travers.
  `{ "color": [r, g, b], "center": [x, y, z], "size": [largeur, hauteur], "yawY": 0 }`,
  décrit dans le **repère brut du `.glb`** — le panneau appartient au décor, donc
  changer `scale` ou `rotationY` l'emmène avec lui.

Toutes les clés sont facultatives ; une clé inconnue ou une valeur invalide est
ignorée en silence.

## Calage automatique du point d'accueil

Un décor dont le sol praticable n'est pas à l'origine du modèle posait le
personnage **sous son plancher** et la caméra **dans la géométrie** : un écran
sombre, sans un mot. Il fallait mesurer le décor à la main et écrire un `spawn`.

Plus maintenant. Quand le sidecar **ne donne pas de `spawn`** et que le point
d'accueil obtenu est inhabitable — sol de la pièce à plus de 10 cm des pieds du
personnage, objectif bouché dans les 16 directions, ou origine hors de la pièce
— l'analyse **choisit elle-même** un point d'accueil et se rejoue autour de lui.
Elle le note dans `placement.spawnAuto`, et l'application l'applique exactement
comme un `spawn` de sidecar. Toutes les autres mesures du fichier (carte,
assises, sol, dégagement) le supposent déjà appliqué : il n'y a rien à corriger
en le lisant.

Le choix, dans cet ordre :

1. **la pièce** — la plus grande étendue d'un seul tenant où l'on marche, pas
   celle qui touche l'origine (sur un quai de métro, c'est la voie ferrée) ;
2. **tenir debout** — au moins 40 cm autour des pieds, sinon le personnage est
   encastré et ne peut pas partir ;
3. **reculer** — au moins 2,5 m de champ sur +Z, l'axe où la caméra se pose ;
4. **avoir quelque chose à cadrer** — et c'est ce qui départage : le fond le plus
   proche DERRIÈRE le personnage, car c'est lui que la caméra montre. Un point
   « bien au milieu » d'une grande salle est un point où l'on ne voit que du
   vide. Les sept points d'accueil réglés à la main des décors livrés ont tous
   leur fond à moins de 2,7 m ; à égalité, le décor bouge du moins possible.

Trois choses qu'il **ne fait pas** :

- il n'écrase **jamais** un `spawn` de sidecar — votre valeur est la parole de
  l'auteur, elle passe avant tout, même si elle est mauvaise ;
- il ne déplace **pas** un décor dont l'origine fait l'affaire : un décor propre
  rend exactement le même fichier d'analyse qu'avant que ce mécanisme existe ;
- il ne **remplace** pas un réglage à la main : pour le figer (ou choisir un
  autre endroit), recopiez la valeur trouvée en `spawn` dans le sidecar.
  `npm run env:scene -- <nom>` l'affiche, prête à copier.

S'il reste malgré tout un décor mal calé — un `spawn` de sidecar erroné, un
décor sans aucun point d'accueil praticable — l'application le **dit** dans un
bandeau discret à côté de la scène, avec la valeur à écrire. Un écran sombre ne
doit jamais rester muet.

## Analyse automatique (`<nom>.scene.json`)

Un décor déposé ici est **mesuré tout seul**, une fois, et le résultat est écrit
à côté du modèle : `chambre.glb` → `chambre.scene.json`. C'est ce fichier que le
moteur de scène lit pour faire **marcher** le personnage dans la pièce, l'empêcher
de traverser un mur et savoir sur quoi il peut s'asseoir. Il ne contient aucune
géométrie : rien que des mesures.

Vous n'avez **rien à faire**. L'analyse démarre au lancement du serveur, ou dès
que l'interface liste les décors, en tâche de fond et une pièce à la fois. Tant
qu'elle n'est pas prête, le décor **s'affiche quand même** : il sert de fond,
simplement sans interaction. `GET /api/environments` donne l'état de chacun
(`pending`, `analyzing`, `ready`, `failed`, `unsupported`) — c'est ce qui permet à
l'interface d'afficher « en préparation » puis « prêt ».

L'analyse est **refaite** quand le `.glb` change, quand `scale`, `rotationY` ou
`spawn` changent dans le sidecar, ou quand le format du fichier d'analyse évolue.
Une analyse antérieure au calage automatique, sur un décor qui en aurait besoin,
est refaite **une fois** — puis plus jamais, que le calage ait abouti ou non.
Changer la seule `exposure` ne la refait pas : elle ne déplace rien.
Un `.glb` illisible ou compressé n'est **jamais** une erreur bruyante : le décor
reste un fond, et la raison est écrite dans l'état.

### Le repère

Le décor est mesuré **tel qu'il sera affiché**, sidecar appliqué. Toutes les
coordonnées se posent donc telles quelles dans la scène :

- **mètres**, **Y vers le haut** ;
- **origine aux pieds du personnage** (le `spawn`), donc le sol est à `y ≈ 0` ;
- le personnage regarde **+Z**, la caméra est du côté +Z.

### Ce que contient le fichier

```jsonc
{
  "format": "hanami-scene", "version": 1,
  "generated": "2026-07-30T16:08:36.860Z",

  // Fraîcheur : si l'un de ces champs ne colle plus, l'analyse est refaite.
  "source":    { "file": "chambre.glb", "bytes": 5544308, "mtimeMs": 1785401140995, "sha256": "059d66e37e5846" },
  // `spawnAuto` n'apparaît que si le calage automatique a eu à se prononcer
  // (pas de `spawn` au sidecar ET origine inhabitable) ; `null` = il a cherché
  // sans rien trouver, le décor reste un fond. Cf. « Calage automatique ».
  "placement": { "scale": 0.031, "rotationY": 330, "spawn": [0.287, 0.256, -0.296], "fingerprint": "247decca1cfc09e9" },

  "frame": { "units": "m", "up": "+Y", "forward": "+Z", "origin": "spawn — pieds de l’avatar, y = 0" },

  // Le gabarit SOUS LEQUEL la carte a été calculée. La changer oblige à refaire
  // l'analyse : « libre » veut dire « libre pour ce corps-là ».
  "body": { "height": 1.6, "radius": 0.25, "step": 0.2, "seatRange": [0.15, 0.95] },

  "room": {
    // Boîte brute du modèle placé : elle DÉBORDE souvent très loin de la pièce
    // (la salle de classe fait 27 m de long à cause du décor peint derrière les
    // fenêtres). Ne vous en servez pas pour cadrer quoi que ce soit.
    "modelBounds": [-2.509, -0.256, -1.977, 1.889, 2.974, 2.415],
    // LA pièce : la boîte de ce qu'on atteint à pied depuis le point d'accueil.
    "walkBounds": [-1.2, -0.7, 1.4, 2.3],
    "walkArea": 2.98,          // m² réellement praticables — 0 = décor sans sol utilisable
    "ground": -0.001,          // altitude du sol de la pièce (≈ 0 si le sidecar est bien réglé)
    "ceiling": 2.975           // null si le décor est ouvert par le haut
  },

  // Distance libre depuis le point d'accueil, à hauteur d'objectif, dans 16
  // directions : index k ⇒ cap k × 22,5°, donc 0 = +Z, 4 = +X, 8 = −Z, 12 = −X.
  // 0 signifie « bouché dès 30 cm ». Mesuré sur une grille de repérage : précis
  // au quart de mètre, et borné par l'étendue analysée.
  "camera": { "eye": 1.3, "clearance": [2.2, 1.6, 1.4, 1.3, 1.4, 1, 8.4, 0.8, 0.7, 0.5, 0.3, 0, 0.5, 0.5, 1.4, 1.8] },

  "grid": { … },   // voir plus bas
  "seats": [ … ]   // voir plus bas
}
```

### La carte du sol

```jsonc
"grid": {
  "cell": 0.1,             // côté d'une case, en mètres
  "origin": [-2.2, -1.7],  // coin minimal de la case (0, 0)
  "cols": 41, "rows": 41,
  "levels": [-0.001, 0.021, 0.051],   // altitudes de sol, croissantes
  "map": [
    "...........########......................",
    "..........###########....................",
    "################0000000000000000000###...",
    "#############00#2222222222#00000000#.....",
    …
  ]
}
```

`map[j][i]` décrit la case de colonne `i` et de rangée `j` — `i` suit **x
croissant**, `j` suit **z croissant**. Son centre est à

```
x = origin[0] + (i + 0.5) × cell        i = floor((x − origin[0]) / cell)
z = origin[1] + (j + 0.5) × cell        j = floor((z − origin[1]) / cell)
```

Quatre caractères, et rien d'autre :

| caractère | sens |
|---|---|
| `.` | **pas de sol** — le vide, l'extérieur de la pièce |
| `#` | **obstrué** : il y a un sol, mais on ne tient pas debout dessus (mur, meuble, sous une mezzanine) |
| `~` | **sol libre, hors d'atteinte à pied** — dessus de pupitre, matelas, îlot séparé |
| `0`-`9`, `a`-`z`, `A`-`Z` | **sol libre et atteignable** ; le caractère est l'**indice dans `levels`**, qui donne son altitude |

Autrement dit : **tout ce qui n'est pas `.`, `#` ou `~` se marche**, et l'altitude
se lit dans `levels`. C'est volontairement sans ambiguïté — un moteur qui traite
« tout sauf `.#~` » comme praticable ne peut pas se tromper. L'atteignabilité a
été calculée depuis le point d'accueil en franchissant au plus `body.step` d'une
case à la suivante ; les dénivelés entre cases voisines se lisent dans `levels`.

C'est un **plan, et il se lit** : les rangées sont dans l'ordre, une par ligne. On
reconnaît les rangées de pupitres d'une salle de classe à l'œil nu. Il s'édite
aussi à la main — boucher un passage se fait en remplaçant des caractères par des
`#`. Attention : la prochaine régénération l'écrasera (voir plus bas).

### Les assises

Toute surface horizontale à hauteur plausible (`body.seatRange` au-dessus de
`room.ground`) est listée, **sans aucun filtrage par modèle** : un lit, une marche,
une caisse, un pupitre sont des assises. C'est au moteur, par sa cinématique
inverse, d'adapter la pose à la hauteur réelle — pas à l'analyse de décider qu'un
meuble est « incompatible ».

```jsonc
{
  "id": "seat-1",
  "y": 0.634,                       // altitude RÉELLE de l'assise
  "center": [-0.846, -0.744],       // [x, z]
  "bounds": [-1.5, -1.6, -0.1, 0.2],// [xMin, zMin, xMax, zMax] — la nappe, pas forcément pleine
  "area": 1.07,                     // m²
  "headroom": 0.84,                 // espace libre au-dessus
  "yaw": 58.3,                      // regard, en DEGRÉS (voir ci-dessous)
  "back": true,                     // le cap vient d'un dossier ou d'un mur ; false = de l'ouverture de la pièce
  "approach": [-0.45, -0.05]        // case praticable d'où venir s'asseoir — null si inaccessible à pied
}
```

`yaw` suit la convention de three : la direction du regard est
`[sin(yaw), 0, cos(yaw)]`, et la valeur se pose telle quelle dans `rotation.y`
(convertie en radians). Un personnage assis **tourne le dos** au dossier ou au mur
le plus proche ; sans dossier lisible, il regarde là où la pièce est la plus ouverte.

### Refaire une analyse, ou comprendre un résultat

```
npm run env:scene                    # ce qui manque ou a changé
npm run env:scene -- --all           # tout refaire
npm run env:scene -- chambre         # un décor, avec le détail de ce qui a été trouvé
npm run env:scene -- chambre --explain   # …et pourquoi telle surface n'a pas été retenue
npm run env:scene -- chambre --dry   # sans rien écrire
```

Le détail affiche les dimensions, les hauteurs d'assise en histogramme, la carte
du sol et l'emprise des assises en surimpression. `--explain` compte les surfaces
écartées et dit pourquoi (trop petite, pas de dégagement au-dessus, c'est du sol).

**Effacer un `.scene.json` suffit** : il sera régénéré au prochain balayage.
L'analyse est déterministe — mêmes fichiers, même résultat.

Les `.scene.json` des décors livrés **sont committés** : c'est du calcul, pas de
la donnée personnelle, et cela évite à chacun de refaire la même mesure.

## À savoir

- Le canvas est **transparent** : un décor troué (pas de plafond, pas de mur
  derrière la caméra) laisse voir le dégradé de l'app. C'est **voulu** — le repli
  naturel, pas un bug.
- Les **sept décors livrés avec l'app sont committés volontairement** : tous sont
  sous **CC BY 4.0**, et crédités un par un dans [`CREDITS.md`](CREDITS.md) —
  l'attribution est la seule condition de cette licence, et elle doit accompagner
  toute redistribution. Ceux que **vous** déposez ici ne le sont pas (voir
  `.gitignore`) : chaque décor a sa propre licence, à vous de la vérifier avant de
  le partager.
- Une capture (bouton photo) prend l'avatar **et** le décor derrière lui.
- Le poids compte : un décor de 100 Mo se charge lentement sur téléphone.
