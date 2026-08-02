# repose-vrm — réparer la pose de repos d'un .vrm

Outil de **réparation de modèle**, livré dans `devtools/` : il ne touche ni à
l'app, ni aux clips, ni aux données. Un seul fichier change — le `.vrm` qu'on
lui demande de réparer, et seulement si toutes les vérifications passent.

## Le problème qu'il répare

Le format VRM exige qu'un modèle soit exporté en **T-pose** : c'est l'hypothèse
de tout le retargeting (three-vrm construit ses os normalisés sur le repos du
fichier). Certains exports « cuisent » une pose dans le squelette — bras
baissés, poignets tournés — en la brûlant dans les **translations** des os
(rotations remises à identité, maillage re-lié sur cette pose : le fichier est
cohérent en interne, donc aucun outil ne proteste). Sur un tel modèle, chaque
clip retargeté place les mains à côté, systématiquement, du même angle.

Le cas fondateur : un export à pose cuite — 17 échecs et 17 limites à la matrice du
banc, seul hors-série sur 94 modèles, `idle` à 9,4 cm de son propre socle. Son
squelette est identique à celui d'un jumeau sain du même exportateur (169 nœuds de mêmes
noms, longueurs égales au dixième de millimètre) ; seule la pose de repos des
bras différait : ~80° à chaque épaule, ~22° et ~10° aux poignets.

## Ce qu'il fait

À partir d'un modèle de **référence au même squelette** (nommage identique des
nœuds), il écrit des **rotations de repos** sur les os fautifs pour que chaque
segment pointe comme celui de la référence. Rien d'autre :

- translations intactes (les longueurs d'os sont celles du modèle) ;
- chunk BIN recopié **octet pour octet** (vertex, normales, IBM, morphs,
  textures) — prouvé par hachage SHA-256 du fichier écrit ;
- le maillage, lié dans l'ancienne pose, est **posé** en T-pose par le skinning,
  exactement comme une animation l'aurait posé. Pendant un clip, la déformation
  monde est la même que sur la référence — c'est l'équivalent exact d'un
  re-bake, sans réécrire un octet de géométrie.

L'alignement se fait sur les **directions de segments**, pas sur les positions
absolues : deux exports d'un même personnage peuvent écarter les bases de
doigts d'un centimètre — morphologie propre, pas erreur de pose. Un enfant →
arc minimal ; plusieurs enfants (la main et ses cinq doigts) → méthode des
quaternions de Horn, résolue par **Jacobi cyclique** (un solveur exact : sur
des offsets en mètres quasi coplanaires, l'itération de puissance rendait un
vecteur à mi-chemin — 1 cm d'erreur silencieuse, c'est arrivé, l'auto-test du
démarrage rejoue ce cas réel depuis).

## Usage

```
# diagnostic seul (aucune écriture)
node devtools/repose/repose-vrm.mjs vrm/modele-casse.vrm --ref=vrm/modele-sain.vrm

# écrire le fichier corrigé AILLEURS, pour le mesurer d'abord
… --sortie=<chemin.vrm>

# remplacer le fichier d'origine (sauvegarde <fichier>.avant-repose obligatoire,
# refus si elle existe déjà ; l'app ne liste pas cette extension)
… --appliquer

# seuil (cm) au-delà duquel un segment est « faux » (défaut 0,5)
… --seuil=0.5
```

Refus nets, sans écrire : squelettes non superposables par rotations (résidu de
direction au-dessus du seuil), nœud fautif dont le parent n'est pas apparié,
sauvegarde déjà présente, auto-test du solveur en échec.

## La preuve, à refaire après chaque usage

L'outil vérifie la géométrie ; le **banc** vérifie le comportement. Sur le cas
fondateur, après application (clips dans l'état du 2026-08-01) :

| mesure | avant | après |
| --- | --- | --- |
| sonde 111 clips (`--rig=vrm --vrm=vrm/modele-casse.vrm`) | 14 échecs · 16 limites | **0 échec · 3 limites** — bilan identique au modèle de référence sain, clip par clip, au dixième de cm |
| `idle` contre son propre socle | 9,4 cm | **1,0 cm (excellent)** |
| juge `world-walk`, opposition bras/jambes | ✗ r = +0,66 | ✓ r = −0,98 |
| juge `world-run`, hyperextension coude G | ✗ 44° | ✓ disparue |
| planche maillage (`diagnostic.mjs idle --modele=…`) | bras décalés | silhouette propre, le maillage suit |

Le fichier produit reste un glTF/VRM valide. Sa particularité : des rotations
de repos non-identité sur les os corrigés, ce que three-vrm (la bibliothèque de
l'app) gère par construction — VRMHumanoidRig lit le repos réel. UniVRM (Unity)
râlerait « not normalized » à l'import : hors périmètre de l'app, documenté ici
pour mémoire.
