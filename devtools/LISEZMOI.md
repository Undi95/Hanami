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
| [`repose/`](repose/LISEZMOI.md) | **la réparation de modèle** : redonne sa T-pose à un `.vrm` exporté avec une pose cuite dans le squelette (le cas ModelePoseCuite : 17 échecs à la matrice → 0), à partir d'un modèle de référence au même squelette. BIN intact octet pour octet, refus nets sinon. |

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

Les fiches et les images atterrissent dans `devtools/diagnostic-out/`, où le banc
va les chercher (onglet **Diagnostic**). `devtools/diagnostic-out/RAPPORT.md` dit
la même chose sans navigateur.

Une exception au caractère jetable de `diagnostic-out/` :
`diagnostic/notes-visuelles.json` est **versionné**. C'est ce qu'on a écrit à la
main après avoir *regardé* les images — la mémoire de l'œil, que rien ne
recalcule.
