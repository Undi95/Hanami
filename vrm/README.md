# Modèles VRM / VRM Models

**FR —** Dépose ici tes fichiers `.vrm` — ils apparaissent automatiquement dans Hanami
(création/édition de personnage → menu déroulant « Modèle 3D »).

Les `.vrm` ne sont **pas committés** (licences tierces : la plupart des modèles
VRoid Hub / Booth interdisent la redistribution — vérifie la licence de chaque modèle).

**Une seule exception, livrée avec l'app :** `Seed-san.vrm`, l'avatar d'exemple que
porte Hana au premier lancement. C'est le modèle d'exemple du VRM Consortium
(VirtualCast, Inc.), et ses conditions embarquées autorisent explicitement la
redistribution — c'est écrit dans le fichier, et recopié à côté dans
`Seed-san.LICENCE.txt`. Ne le supprime pas si tu veux que Hana garde son avatar ;
tes propres modèles vivent à côté sans se gêner.

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

---

**EN —** Drop your `.vrm` files here — they show up automatically in Hanami (character
creation/editing → the "3D model" dropdown).

`.vrm` files are **not committed** (third-party licences: most VRoid Hub / Booth
models forbid redistribution — check each model's licence).

**One exception, shipped with the app:** `Seed-san.vrm`, the example avatar Hana
wears on first launch. It's the VRM Consortium's sample model (VirtualCast, Inc.),
and its embedded terms explicitly allow redistribution — it's written in the file
itself, and copied out next to it in `Seed-san.LICENCE.txt`. Don't delete it if you
want Hana to keep her avatar; your own models live alongside it without conflict.

## The test bench's reference models

The tools in `devtools/` measure centimetres: they only compare from one run to
the next **with the same model**. So they look for three fixed names in this
folder, which you provide yourself (a copy, or a link):

- `reference.vrm` — **the reference**: a VRM 0.x chibi, hips ≈ 0.755 m;
- `reference-2.vrm` — the average rig: VRM 0.x, hips ≈ 0.904 m;
- `reference-1x.vrm` — the **VRM 1.x** control, adult build.

Any `.vrm` works to run the tools — but the numbers written in the docs only hold
for these specific builds. Details and options: [`devtools/LISEZMOI.md`](../devtools/LISEZMOI.md)
(French only).

Where to find free models:
- **VRoid Studio** (free): create your own character and export as `.vrm`.
- **VRoid Hub**: filter by usage terms.
- **Booth.pm**: plenty of free and paid models.
