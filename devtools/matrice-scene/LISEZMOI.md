[English](README.md) | **Français**

# Matrice de scène — le harnais des transitions d'état

Un décor 3D qui arrive en cours de conversation, un décor qu'on retire, les
interactions qu'on allume depuis un fond 2D, un personnage sans modèle, un
écran qui rétrécit… La scène a **trop de combinaisons** pour qu'on les essaie à
la main sans en oublier une. Ce harnais les déroule **tout seul**, par le
chemin de l'utilisateur : il clique les vrais boutons des vrais dialogs.

Il ne sait rien des entrailles de la scène — elle n'expose rien, et on ne lui a
rien ajouté. Ce qu'il sait, il le lit **de l'extérieur** :

| capteur | ce qu'il dit |
|---|---|
| appels de dessin WebGL (prototype instrumenté) | l'image est-elle **réellement** rendue, ou morte ? |
| `gl.readPixels` dans une frame d'animation | ce qui est **peint** : couverture d'alpha (canvas transparent ⇒ vide / avatar seul / décor plein écran), et le **mouvement** entre deux instants |
| DOM | portrait 2D, bannières d'erreur, pastille « Chargement du décor… », astuce 3D |
| `GET /api/ui`, `/api/environments`, `/api/characters` | le serveur dit-il la même chose que l'écran ? |
| le `.scene.json` du décor affiché | l'altitude de son sol et le dégagement de l'objectif — les deux mesures qui expliquent un écran noir |
| `console.error` / `window.onerror` | zéro erreur après chaque transition |

Il distingue deux choses que l'on confond vite : la **boucle** de rendu (les
`gl.clear`, toujours attendus vivants) et les **dessins** (`drawElements`…, qui
n'ont lieu que s'il y a quelque chose à peindre). Un personnage sans modèle ni
décor, c'est zéro dessin et une boucle qui tourne : la scène est **vide**, pas
morte.

## Ce qu'il ne touche pas

- Il crée **ses** personnages, tous nommés « Matrice … » (ids `matrice-*`), et
  refuse de supprimer un id qui ne commence pas par `matrice-`.
- Il sauvegarde `data/ui.json` avant de commencer et le **restaure clé par
  clé** : celles qu'il a ajoutées repartent à `null`.
- Le décor jetable de l'essai d'import est posé et retiré par un outil à part,
  qui vérifie que `environments/` est revenu **exactement** à son état d'avant.

## Jouer la matrice

Le serveur de l'app doit tourner (`npm run dev` → <http://localhost:7788>).

1. Ouvrir <http://localhost:7788> et la console du navigateur (F12).
2. Coller le contenu de `matrice.js` dans la console. Plus court, si l'on est
   en développement, une seule ligne suffit (adapter la racine du dépôt) :

   ```js
   (0,eval)(await (await fetch('/@fs/D:/Projet%202/devtools/matrice-scene/matrice.js')).text())
   ```

   `/@fs/` est l'endpoint de Vite qui sert un fichier du disque ; il refuse
   `data/`, et il n'existe qu'en développement — en production, on colle.

3. Dérouler :

   ```js
   await matrice.jouer()
   // ou, pour imposer le modèle et le fond des personnages jetables :
   await matrice.jouer({ modele: 'chambre-claire', fond: 'nom-du-fond' })
   ```

   Sans argument, le harnais prend le **premier** modèle de `vrm/` et le premier
   fond de `backgrounds/` : rien n'est codé en dur, il tourne sur n'importe
   quelle installation. Les libellés sont ceux des menus (nom de fichier sans
   extension).

Le harnais joue les étapes une à une et **s'arrête de lui-même** quand il a
besoin d'une main extérieure — il dit alors quoi faire, en une phrase :

| il demande | vous faites | puis |
|---|---|---|
| réduire la fenêtre à 375 px | redimensionner | `await matrice.reprendre()` |
| lui rendre sa largeur de bureau | redimensionner | `await matrice.reprendre()` |
| recharger la page | F5, puis recoller `matrice.js` | `await matrice.reprendre()` |
| poser le décor jetable | `node devtools/matrice-scene/decor-jetable.mjs poser <chemin.glb>` | `await matrice.reprendre()` |

Le journal vit dans `sessionStorage` : il survit au rechargement, et
`matrice.reprendre()` repart exactement où il s'était arrêté.

4. À la fin :

   ```js
   matrice.resume()      // total / ok / échecs, et l'écart de chaque échec
   matrice.rapport()     // le journal complet (sondes comprises)
   await matrice.nettoyer()   // jetables supprimés, ui.json restauré
   ```

   puis, si le décor jetable a été posé :

   ```
   node devtools/matrice-scene/decor-jetable.mjs retirer subway-platform
   ```

## Ce qui est déroulé

Les états combinés — **ceux qu'on atteint par l'interface**, pas le produit
cartésien aveugle : fond (aucun · image 2D · décor 3D) × modèle (VRM · portrait
2D) × décor 3D on/off × animations on/off × scène vivante on/off × famille
(Overte · Rocketbox) × largeur (bureau · 375 px).

Les transitions, dans l'ordre :

| # | transition |
|---|---|
| T1 | fond 2D → décor 3D, en cours de conversation |
| T2 | décor 3D → fond 2D (le retrait) |
| T3 | scène vivante allumée **avant** d'avoir un décor |
| T4 | décor 3D allumé sur un personnage **sans** décor assigné |
| T5a | changement de décor **pendant la marche** |
| T5b | changement de décor **pendant l'assise** |
| T6 | changement de personnage en pleine scène (Overte → Rocketbox, et retour) |
| T7 | retrait du modèle VRM avec la scène vivante allumée |
| T8 | animations gestuelles éteintes avec la scène vivante allumée (et rallumées) |
| T9 | passage bureau → 375 px pendant la scène vivante, puis retour |
| T10 | rechargement de page en pleine scène vivante |
| — | import complet d'un décor : dépôt du `.glb`, analyse automatique, assignation, marche, assise, retrait |

## Lire un échec

`matrice.resume()` donne la liste ; `matrice.rapport().etapes` donne, pour
chaque étape, la sonde complète : couverture d'alpha, appels de dessin,
mouvement mesuré après chaque clic, préférences côté serveur, erreurs de
console. Un capteur qui ne sait pas trancher écrit ce qu'il a mesuré plutôt que
d'inventer un verdict.

Les seuils sont en tête de `matrice.js` :

- `COUV_VIDE = 0,02` — au-dessous, rien n'est peint ;
- `COUV_DECOR = 0,45` — au-dessus, un décor occupe l'image ;
- le mouvement d'un clic se juge **par rapport au repos**, mesuré juste avant,
  dans l'état du moment (`FACTEUR_MOUVEMENT = 3`, plancher `MOUVEMENT_MIN = 1`).
  Un seuil absolu ne pouvait pas trancher : la respiration d'un avatar qui
  remplit un écran de téléphone déplace vingt fois plus de pixels que celle d'un
  avatar debout au fond d'un café.

Deux limites connues des capteurs, à garder en tête avant de crier au bug :

- un décor **ouvert** (sans plafond, sans mur derrière la caméra) laisse voir le
  dégradé de l'app : sa couverture peut passer sous `COUV_DECOR` sans que rien
  ne soit cassé ;
- les points de clic (`POINTS_SOL`, `POINTS_ASSISE`) visent **à côté de
  l'avatar** — le cliquer, lui, est un autre geste (« attirer son attention »),
  qui fait bouger l'image même sans décor. Dans une pièce très encombrée, aucun
  des quatre points ne tombe forcément sur du sol praticable.

## Le décor qui pose le personnage sous son plancher

Le harnais vérifie, dès qu'un décor est attendu à l'image, deux mesures que
l'analyse a déjà écrites dans le `.scene.json` :

- `room.ground` — l'altitude du sol praticable. L'avatar, lui, est **toujours**
  à `y = 0`. Un sol à 1,52 m veut dire que le personnage se tient 1,52 m
  **sous** le plancher ;
- `camera.clearance` — le dégagement autour de l'objectif dans 16 directions.
  Seize zéros = la caméra est **dans** la géométrie.

C'est le cas d'un décor dont le modèle n'a pas son origine au sol (un quai de
métro posé au-dessus de sa voie, par exemple). Il s'analyse sans erreur, il
s'affiche, et l'écran est noir. Un sidecar `spawn` le corrige — voir
`environments/README.fr.md`.

## Le décor jetable

```
node devtools/matrice-scene/decor-jetable.mjs poser <chemin.glb>
node devtools/matrice-scene/decor-jetable.mjs etat
node devtools/matrice-scene/decor-jetable.mjs retirer <nom>
```

`poser` relève l'inventaire de `environments/` **avant** de copier, et
`retirer` n'efface que les fichiers apparus depuis, portant le nom du décor
jetable (le `.glb` et son `.scene.json` généré). Tout le reste est laissé et
signalé. La dernière ligne dit si le dossier est revenu à son état d'avant.
