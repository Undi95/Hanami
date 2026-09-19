# Vérification de l'intégration « Compression de contexte » (chantier B)

Batterie de tests **end-to-end** de la compression de contexte intégrée dans l'app :
mémoire → codec **agressif** (LLM + vérifieur déterministe, repli `denseEncode`, cache
par-fichier), sysprompt + persona → **`denseEncode`** (déterministe, zéro LLM).
Elle tourne sur une **instance ISOLOÉE** de Hanami — jamais `data/` réel, jamais Sakura.

## Prérequis
- Node 18+ (fetch global, zéro npm).
- Un Ollama local avec le modèle du perso (ex. `Qwen3.8-27B-…`) — pour les scripts LLM.

## Lancer
1. **Instance isolée** (port + data scratch dédiés), dans un terminal :

   ```bash
   PORT=7790 HANAMI_DATA="C:/chemin/vers/scratch" npx tsx server/index.ts
   ```
   Windows (PowerShell) : `set PORT=7790; set HANAMI_DATA="C:\chemin\vers\scratch"; npx tsx server\index.ts`

2. **Variables d'entrée** des scripts :
   - `HANAMI_TEST_URL` — URL de l'instance (défaut `http://localhost:7790`).
   - `HDATA` — le `HANAMI_DATA` de l'instance. Les scripts lisent
     `compression-cache.json` et hashent les `.md` mémoire pour prouver qu'ils ne sont **jamais** modifiés.

3. **Ordre d'exécution — SÉQUENTIEL, jamais en parallèle** (PC lent / GPU, même modèle local) :

   | Script | LLM | Vérifie | Résultat attendu |
   |---|---|---|---|
   | `test-regression.mjs` | non | CRUD perso/chat/mémoire, réglages, structure du contexte compressé (`denseEncode`), réversibilité | **31 OK** |
   | `test-llm.mjs` | oui | compression agressive (réduction de caractères), cache, fichiers intacts, **rappel 6/6**, **fidélité 4/4**, zéro boucle vide | **28 OK** |
   | `test-regression2.mjs` | 1 appel | édition / épingle / notes de scène / résumé / variante / fork / compaction / suppression (garde-fous) | **21 OK** |
   | `test-cache.mjs` | 1 appel | **invalidation du cache par-fichier** : un fichier modifié retombe en dense, les autres gardent l'agressif | **12 OK** |

   ```bash
   export HDATA="C:/chemin/vers/scratch"        # = HANAMI_DATA de l'instance
   node test-regression.mjs
   node test-llm.mjs
   node test-regression2.mjs
   node test-cache.mjs
   ```
   (précéder de `HANAMI_TEST_URL=http://localhost:7790` si le port diffère)

## Ce que ça prouve
- **Rappel** — les 6 faits (chiffres + lieux + noms + raisons, explicites ET implicites)
  sont récupérés **6/6** sur la mémoire compressée.
- **Fidélité** — le personnage obéit à ses règles strictes (« mon ange », refus médical,
  auto-identification, zéro invention) **sur le contexte compressé** → **4/4**, zéro boucle vide.
- **Réversibilité** — toggle off → contexte original ; les `.md` mémoire ne sont **jamais**
  modifiés sur disque (la compression est une *vue*, pas une écriture).
- **Repli honnête** — le vérifieur rejette toute perte de fait → repli `denseEncode`
  (jamais de perte silencieuse) ; un appel LLM vide ne casse pas l'action.
- **Invalidation par-fichier** — modifier un seul fichier ne périment que **son** entrée de cache.
- **Régression** — tout ce qui marchait avant (CRUD, chat, opérations de conversation) fonctionne encore.

> Dosage LLM : `test-llm.mjs`, `test-regression2.mjs` et `test-cache.mjs` dosent les appels
> (sleeps 300-400 ms) — c'est le **MÊME** modèle local que l'app. Ne pas courir en parallèle.
