# devtools/diagnostic — VOIR et JUGER les animations, sans navigateur

Trois outils, un contrat : répondre à « **est-ce que c'est LOGIQUE et est-ce que
c'est BIEN ?** » avec des résultats qu'un humain ou un agent peut LIRE — des PNG
sur le disque, des phrases en français, des chiffres justifiés. Zéro dépendance
npm (celles du projet sont réutilisées en lecture seule) ; la seule écriture est
`devtools/diagnostic-out/`, qui est **gitignoré** (des centaines de PNG, ~150 Mo,
régénérables d'une commande).

| dossier / fichier | rôle |
|---|---|
| `diagnostic.mjs` | **LE point d'entrée.** Assemble juge + rendu : pour chaque clip, une fiche (md + json) ET cinq PNG, rangés dans `../diagnostic-out/<clip>/`, plus `RAPPORT.md` (l'index maître) et `index.json` (lu par l'onglet Diagnostic du banc, qui sert ce dossier sous `/diagnostic/`). En-tête du fichier = tous les appels. |
| `juge/` | le juge biomécanique : critères par famille, fourchettes, phrases. Son `LISEZMOI.md` détaille critères, contre-épreuves et angles morts. |
| `rendu/` | le banc de rendu : planches contact, traces, bande de phase — PNG écrits à la main, maillage réellement déformé, semelle mesurée sur le maillage. Doc dans son `LISEZMOI.md`. |
| `notes-visuelles.json` | **la mémoire de l'œil** : notes écrites à la main APRÈS avoir regardé les images (+ `vedettes`, les images à ouvrir en premier). `diagnostic.mjs --rapport` les fond dans RAPPORT.md, index.json et la page du banc. Elles survivent aux régénérations. |

## L'appel courant

```
# depuis la racine du dépôt
node devtools/diagnostic/diagnostic.mjs --lot                      # toute la racine vrma/ (~3 min)
node devtools/diagnostic/diagnostic.mjs world-walk extra/happy-5   # au clip
node devtools/diagnostic/diagnostic.mjs --rapport                  # refondre l'index seul (notes comprises)
```

Les résultats se regardent dans l'onglet **Diagnostic** du banc d'essai
(`devtools/LANCER-LE-BANC.cmd`, ou `node devtools/anim-lab/serve.mjs`), ou
directement dans `devtools/diagnostic-out/RAPPORT.md`, lisible sans navigateur.

Modèle épinglé par défaut : **`vrm/reference.vrm`** — l'étalon du projet, un
chibi VRM 0.x de 0,755 m de hanches. Posez le vôtre sous ce nom (copie ou lien) ;
sans lui l'outil s'arrête en le disant. Voir `devtools/LISEZMOI.md`.
Toute mesure ne se compare qu'à modèle égal — il est écrit dans chaque fiche.
`--modele=<nom>` : nom **exact** d'abord ; une sous-chaîne ambiguë est refusée
avec la liste des candidats (une sous-chaîne courte attrapait un autre modèle
dont le nom la contient, selon l'ordre du disque).

## Les pièges déjà payés (ne pas les réintroduire)

- Jamais échantillonner à `t = durée` : `LoopRepeat` rend la première image.
  Partout : `durée − 1e-4`.
- Le sol est **y = 0**, pas le minimum du clip — sinon la pénétration devient
  invisible par construction. L'appui, lui, est relatif (pied le plus bas).
- La hauteur d'un pied se mesure sur la **semelle du maillage**, pas sur l'os
  de cheville (9 cm au-dessus du sol).
- La famille d'un clip `extra/` se déduit de son **nom nu** (diagnostic.mjs
  donne au juge le slug sans le préfixe `extra/`).
- Le dossier `vrm/` grossit sans prévenir (12 → 88+ modèles en cours de
  chantier) : le « premier .vrm du dossier » est une cible mouvante, d'où le
  modèle épinglé.
