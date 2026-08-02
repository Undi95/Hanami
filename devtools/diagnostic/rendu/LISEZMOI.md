# devtools/rendu — VOIR une animation sans navigateur

Banc de rendu des `.vrma` de Hanami : il charge un **vrai .vrm** (squelette +
maillage, montés à la main depuis le glTF — aucun DOM, aucun WebGL) et un
**.vrma**, et il écrit des **PNG** qu'un humain ou un agent peut ouvrir. Aucune
dépendance : le PNG est encodé à la main (`png.mjs`), la police est un bitmap
5×7 (`police.mjs`), le skinning est refait en typed arrays (`scene.mjs`).

Lecture seule sur le dépôt (vrm, vrma, node_modules). Tout s'écrit dans
`devtools/diagnostic-out/`, qui est gitignoré.

## Appel

```
# depuis la racine du dépôt ; RENDU=devtools/diagnostic/rendu/rendu.mjs
node $RENDU tout     world-walk                  # les 5 images du clip
node $RENDU planche  world-walk --vue=toutes     # face + profil + dessus
node $RENDU traces   world-sit-enter
node $RENDU phase    world-walk world-walk-fast
node $RENDU liste                                # clips et modèles dispo
```

Options : `--modele=<nom exact|chemin>` (défaut `vrm/reference.vrm`, l'étalon ; ambiguïté refusée) · `--vue=face|profil|dessus|toutes`
· `--poses=N` (12) · `--colonnes=N` (4) · `--case=LxH` (300x400) · `--cadre=corps`
(désactive le gros plan auto) · `--maillage=0` (squelette seul, ~5× plus rapide)
· `--pelure=0` · `--fps=N` (60) · `--sortie=<dossier|fichier>` · `--prefixe=<txt>`.

Sortie par défaut : `devtools/diagnostic-out/rendu/<clip>-planche-<vue>.png`, `<clip>-traces.png`,
`<clip>-phase.png`. Une image se rend en 0,1 à 0,7 s ; le premier clip d'un
processus paie ~1 s de chargement du modèle (mis en cache ensuite).

API : `const R = await import('./rendu.mjs')` puis
`await R.rendre({ clip, type, vue, modele, sortie })` ou `R.toutRendre({ clip })`.
Briques : `scene.mjs` (chargement, pose, semelles), `figure.mjs` (vues, cadrage,
dessin), `planches.mjs` (les trois images, `analyser()` pour les chiffres seuls).

## Les trois images

1. **Planche contact** — N poses cadrées ENSEMBLE (cadrage commun, sinon le
   mouvement disparaît). Corps = maillage réellement déformé (gris, contour par
   rupture de profondeur), squelette par-dessus : GAUCHE bleu, DROIT rouge,
   pelure d'oignon = pose précédente en pâle, ergot noir sur la tête = regard.
   Par case : n°, t, hauteur du bassin, pied porteur. Si un seul membre bouge,
   la planche cadre dessus (gros plan auto, borné : mouvement < 3 cm ou échelle
   > 600 px/m → retour au plan large, annoncé dans le bandeau).
2. **Traces** — trajectoires pieds/mains/bassin/tête, plan vertical + vue de
   dessus, carrés noirs = pied au sol, silhouette pâle = pose t = 0. Le bandeau
   chiffre la course au sol du pied porteur (= l'avance que le moteur doit
   rendre sur un clip joué sur place, = du patinage sur un clip immobile).
3. **Bande de phase** — appuis G/D en barres, hauteur du bassin, hauteur des
   semelles (zone rouge = sous le sol), vitesse angulaire max des os majeurs.

## Conventions et pièges (déjà réglés, ne pas les réintroduire)

- Dernière image échantillonnée à `durée − 1e-4` : à `durée` pile, LoopRepeat
  rend la première image (faux résultat).
- VRM 0.x : la scène est tournée de 180° comme le fait l'app (`rotateVRM0`),
  donc +Z = avant pour tous les modèles.
- Pose de repos anti T-pose reprise de `vrmStage.ts` (bras le long du corps)
  pour les os que le clip n'anime pas.
- Le SOL est y = 0 (là où l'app pose le personnage), jamais « le plus bas du
  clip » — c'est ce qui rend visible une pénétration sous le plancher. L'APPUI,
  lui, est relatif (pied le plus bas des deux, à ~1,2 cm près).
- La hauteur de pied est mesurée sur la SEMELLE du maillage (point le plus bas
  des sommets du pied), pas sur l'os de cheville (9 cm au-dessus du sol).
- `world.json` est lu si présent (famille, boucle) ; les allures y consignent
  la vitesse que le code doit appliquer (clips joués sur place).

## Inspection fine

`node _crop.mjs src.png dst.png x y w h [zoom]` découpe et agrandit une région
d'un PNG du banc. Les fichiers `_*` sont des essais internes, sans garantie.
