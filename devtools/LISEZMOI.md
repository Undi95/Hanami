# devtools — les outils de mise au point des animations

Ce dossier ne fait pas partie de l'app : rien ici n'est chargé au démarrage, et
`npm run build` l'ignore. Ce sont les outils avec lesquels les `.vrma` de `vrma/`
ont été choisis, mesurés et corrigés. Ils sont livrés parce qu'ils servent à qui
veut ajouter ou remplacer un clip — et parce qu'un outil qu'on garde pour soi
finit par se perdre.

**Aucune dépendance npm ajoutée** : `three` et `@pixiv/three-vrm*` sont pris dans
les `node_modules` du projet, en lecture seule. Node seul suffit.

| | |
|---|---|
| [`anim-lab/`](anim-lab/LISEZMOI.md) | **le banc d'essai**, dans le navigateur : rejoue les clips sur un vrai `.vrm`, mesure les raccords (*idle → anim → idle*, en centimètres), joue des séquences, essaie les décors, et affiche le diagnostic ci-dessous. Sert la page et relaie les assets vers le serveur de l'app. |
| [`diagnostic/`](diagnostic/LISEZMOI.md) | **le diagnostic biomécanique**, sans navigateur : pour chaque clip, une fiche en français (est-ce *plausible* ?) et cinq PNG (planches contact, traces, phase) qui le **montrent**. |
| `diagnostic-out/` | ce que le diagnostic écrit. **Gitignoré** : ~150 Mo de PNG, régénérables d'une commande. |
| [`matrice-scene/`](matrice-scene/LISEZMOI.md) | **le harnais des transitions de scène**, joué DANS la page de l'app : il clique les vrais dialogs pour dérouler toutes les combinaisons atteignables (fond 2D ↔ décor 3D, modèle ↔ portrait, animations, scène vivante, familles, largeur d'écran, rechargement, import d'un décor) et vérifie après chacune que l'image est peinte, que l'API dit la même chose que l'écran, et que la console est vide. |
| [`repose/`](repose/LISEZMOI.md) | **la réparation de modèle** : redonne sa T-pose à un `.vrm` exporté avec une pose cuite dans le squelette (le cas fondateur : un export à pose cuite, 17 échecs à la matrice → 0), à partir d'un modèle de référence au même squelette. BIN intact octet pour octet, refus nets sinon. |

## L'étalon — le modèle sur lequel tout se mesure

Les outils de ce dossier rendent des **centimètres** : « le pied traverse le sol
de 2,1 cm », « ce raccord saute de 13,6 cm ». Or un centimètre ne veut rien dire
sans le corps qui le porte — le dossier `vrm/` va de 0,33 m à 1,25 m de hanches,
un rapport de presque quatre. **Deux exécutions ne se comparent qu'à modèle
égal.**

Le modèle de mesure était autrefois « le premier `.vrm` du dossier ». C'était un
piège : le dossier vit, et l'arrivée d'un modèle dont le nom passait devant a
décalé tous les chiffres d'une exécution à l'autre (27,8 → 30,4 cm d'écartement
pour le même `idle`) sans que rien ne prévienne. Le modèle est donc désormais
épinglé par un **NOM FIXE**, que l'ordre du disque ne peut plus déplacer.

Les modèles VRM ne sont pas committés (licences tierces, cf. `vrm/README.md`) :
le dépôt fixe les noms, vous fournissez les fichiers. **Posez les vôtres sous ces
noms dans `vrm/`** — une copie, ou un lien symbolique vers ce que vous avez déjà :

| nom attendu | profil | à quoi il sert |
|---|---|---|
| `vrm/reference.vrm` | **l'étalon** : chibi VRM 0.x, hanches ≈ 0,755 m | le défaut de tous les outils ; c'est lui qui porte les chiffres écrits dans les docs et les fiches committées |
| `vrm/reference-2.vrm` | le rig moyen : VRM 0.x, hanches ≈ 0,904 m | la sonde des raccords et des fondus (`anim-lab/`) — un gabarit adulte, pour vérifier qu'un défaut n'est pas une proportion |
| `vrm/reference-1x.vrm` | le témoin **VRM 1.x**, gabarit adulte | `banc-regard.mjs` et `banc-cadrage.mjs` : les deux versions du format n'orientent pas leurs os pareil, et ça se mesure |

Rien ne vous oblige à retrouver les morphologies exactes : les outils marchent
avec n'importe quel `.vrm`, ils impriment le modèle et ses hanches à chaque
exécution. Mais **les chiffres des docs ne valent que pour ces gabarits-là** —
sur un autre corps, refaites la mesure avant de conclure.

Sans étalon posé, les outils s'arrêtent en disant quoi faire. Pour une mesure
ponctuelle sur un autre modèle, `--modele=<nom exact|chemin>` (alias `--vrm=`)
passe devant le défaut :

```
node devtools/diagnostic/juge/juge.mjs world-walk --vrm=vrm/mon-modele.vrm
```

## Lancer le banc

Le serveur de l'app doit tourner (`npm run dev` → <http://127.0.0.1:7788>) : c'est
lui qui détient les modèles, les clips et l'API.

- **Windows** : double-clic sur **`LANCER-LE-BANC.cmd`**. Le banc s'ouvre dans sa
  propre fenêtre — il ne dépend d'aucun agent et ne s'éteint qu'avec elle.
- **Linux / macOS** : `node devtools/anim-lab/serve.mjs`

Puis <http://localhost:7799/> (le port suivant si 7799 est pris ; `LAB_PORT` pour
en imposer un autre).

## Générer le diagnostic

```
node devtools/diagnostic/diagnostic.mjs --lot     # tous les clips de vrma/ (~3 min)
node devtools/diagnostic/diagnostic.mjs world-walk
```

Sur l'étalon, sauf `--modele=` (cf. plus haut).

Les fiches et les images atterrissent dans `devtools/diagnostic-out/`, où le banc
va les chercher (onglet **Diagnostic**). `devtools/diagnostic-out/RAPPORT.md` dit
la même chose sans navigateur.

Une exception au caractère jetable de `diagnostic-out/` :
`diagnostic/notes-visuelles.json` est **versionné**. C'est ce qu'on a écrit à la
main après avoir *regardé* les images — la mémoire de l'œil, que rien ne
recalcule.
