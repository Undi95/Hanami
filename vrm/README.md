# Modèles VRM

Dépose ici tes fichiers `.vrm` — ils apparaissent automatiquement dans Hanami
(création/édition de personnage → menu déroulant « Modèle 3D »).

Les `.vrm` ne sont **pas committés** (licences tierces : la plupart des modèles
VRoid Hub / Booth interdisent la redistribution — vérifie la licence de chaque modèle).

## Les étalons du banc d'essai

Les outils de `devtools/` mesurent des centimètres : ils ne se comparent d'une
exécution à l'autre qu'à **modèle égal**. Ils cherchent donc trois noms fixes
dans ce dossier, que vous fournissez vous-même (une copie, ou un lien) :

- `reference.vrm` — **l'étalon** : un chibi VRM 0.x, hanches ≈ 0,755 m ;
- `reference-2.vrm` — le rig moyen : VRM 0.x, hanches ≈ 0,904 m ;
- `reference-1x.vrm` — le témoin **VRM 1.x**, gabarit adulte.

N'importe quel `.vrm` fait l'affaire pour faire tourner les outils — mais les
chiffres écrits dans les docs ne valent que pour ces gabarits-là. Détails et
options : [`devtools/LISEZMOI.md`](../devtools/LISEZMOI.md).

Où trouver des modèles gratuits :
- **VRoid Studio** (gratuit) : crée ton propre personnage et exporte en `.vrm`.
- **VRoid Hub** : filtre par conditions d'utilisation.
- **Booth.pm** : beaucoup de modèles gratuits ou payants.
