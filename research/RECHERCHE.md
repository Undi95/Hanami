# Recherche — Compression de contexte Hanami

Branche : `research/context-compression` (depuis `Qwen2`, tag `checkpoint-2026-09-18`).
Idée (Lucas) : passer **mémoire (faits) + prompt système du personnage + persona
utilisateur** dans un format COMPRESSÉ que le LLM local décode encore → moins de
tokens, sans perdre ni le rappel ni la fidélité du perso / de l'user. Objectif : le
**MEILLEUR résultat** (gains réels mesurés + fiabilité) + un **codec reprennable**
(open source). A (codec), B (intégrer dans l'app), C (max compression) tous valables ;
seul le résultat mesuré compte.

## Contraintes dures
- **FIDÉLITÉ (axe n°1)** : le prompt système du personnage doit rester RESPECTÉ — voix,
  règles strictes, policy emoji — qu'il soit **petit ou énorme** ; de même pour la
  **persona utilisateur**. La compression ne doit JAMAIS dégrader le comportement du
  perso / l'identité de l'user. Ce n'est PAS du fait (comme la mémoire) : c'est du
  **COMPORTEMENT**, le plus sensible. → à mesurer par batterie de fidélité (« le perso
  obéit-il encore à ses règles strictes ? »), **pas** seulement par rappel de fait.
- **Données** : jamais `data/` réel / Sakura → collection en mémoire / perso jetable.
- **Secrets** : les scripts lisent `data/config.json` eux-mêmes (jamais dans la conversation).
- **Zéro** dépendance npm ; **zéro** StrictMode.
- **SÉQUENTIEL** : zéro agent parallèle (PC lent, GPU). **Doser le LLM** (c'est le MÊME
  modèle local sur lequel je tourne) : tester fort, sans saturer le GPU. `max_tokens ≥ 500`
  (Qwen pense avant de répondre, sinon réponse vide/coupée).
- **Commits** FR, un par étape, signature `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Push** OK sur cette branche seulement ; ne toucher ni `main` ni `Qwen`/`Qwen2`.

## État — meilleur résultat actuel (baseline à battre)
**DENSE v1** (télégraphique, mots entiers, fait-titre explicite) :
- −29 % tokens d'entrée (405 → 288), **−26 % NET** (entrée×6 + sortie), rappel **6/6**,
  ET **moins de tokens de sortie** que la prose (70 vs 79).
- **Strictement meilleur que PLAIN sur tous les axes.** C'EST le baseline.

Mesures : `scripts/compress-measure.ts` (`--tokens` par défaut / `--recall` complet),
`scripts/compress-probe.ts` (frontière). Contenu de test : 3 fichiers mémoire (famille /
travail / santé), 6 questions (3 faciles + 3 dures : compte, localisation, causalité).

## La règle de sécurité (trouvée — à ne jamais violer)
**Ne JAMAIS comprimer un fait en forme purement IMPLICITE.** Garder le fait « titre »
explicite (le chiffre, la réponse à la question probable), compresser le *détail*.
Preuve : « Tom 2 enfants (Léa 8, Hugo 5) » → `L8+H5` = le modèle **épuise son budget de
réflexion** (`finish_reason=length`, contenu **VIDE** → un SILENCE, pas une erreur).
→ `2enfants L8+H5` = « 2 enfants » en 76 tok. **La signature d'échec (length + vide)
est détectable à la sortie** → on peut la surveiller / auto-corriger.

## Plafond connu
Réduction en **caractères** (v2 = 47 %) > réduction en **tokens** (29 %) : le tokenizer
compresse déjà (tokens courts, chiffres). Le vrai gain est dans la **redondance de
prose** (mots-vide, reformulations, verbes être/avoir), **pas** dans les chiffres/dates.

## Hypothèses à tester (par ordre de priorité)
1. **Codec par TYPE de contenu** : faits / comportement-perso / persona-user = des
   stratégies de densification DIFFÉRENTES. Le prompt système (comportement) est le plus
   risqué → batterie de **fidélité** séparée (règles strictes, voix, emoji), pas de rappel
   de fait. Mesurer : la compression du sysprompt change-t-elle le perso ? À quel seuil ?
2. **Encodeur automatique CONSERVATEUR** (pas à la main) : règles sûres (mots-vide FR/EN,
   normalisation dates/chiffres, détection clé→valeur, **forçage fait-titre explicite**).
   Cible : battre/égaler v1 SANS effort humain et SANS le trou de l'implicite.
   → c'est le livrable « reprennable » (open source).
3. **Densification agressive + GARDE** : viser > 29 % tokens en monitant
   `finish_reason=length` + vide ; si un fait devient implicite → le ré-expliciter
   (détection + correction à la sortie). Trouver le vrai plafond AVEC fiabilité.
4. **Intégration app (B)** : opt-in, densifier la mémoire injectée, **original conservé**
   (réversible), repli honnête si aucun gain mesuré. Ne jamais impacter l'output par défaut.
5. **Prior art** : que font LLMLingua / LongLLMLingua / Gisting / ICAE ? Y a-t-il une
   méthode 2025/2026 qui bat mon v1 à coût comparable ? Noter URLs + leçons + pièges.

## Prior art à chasser (recherche web — noter URLs + leçons)
- **LLMLingua / LongLLMLingua** (Microsoft) — compression de prompt, budget-aware.
- **Gisting**, **ICAE** — « compressed prompts » / representation compression.
- Papiers 2025/2026 : « prompt/context compression for LLM », « token efficiency »,
  « dense vs sparse context recall ». Leurs pièges (perte de faits, dégradation modèle-dépendante).

## Journal
- **2026-09-18** : v1 vs v2 mesurés (`compress-measure`). v1 = **−26 % net / 6/6 / moins
  de sortie** → baseline. v2 = −36 % net / 5/6 / plus de sortie. Frontière isolée
  (`compress-probe`) : **implicite → silence** (`finish_reason=length`). Règle de sécurité
  posée (fait-titre explicite). Baseline figée. **Suite (nuit)** : coder l'encodeur
  conservateur (hyp. 2) + batterie de fidélité sysprompt (hyp. 1) + recherche prior art.
