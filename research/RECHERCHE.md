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

**Encodeur DÉTERMINISTE `denseEncode()` (research/codec.ts)** : −7 % entrée
(405 → 377), **6/6, 0 fait perdu** — mais c'est le PLANCHER des règles sûres seules.
Mesure : `scripts/dense-encode.ts`.

**FIDÉLITÉ du prompt SYSTÈME (axe n°1 — batterie `scripts/fidelity-battery.ts`)** :
perso jetable « Pico », 5 règles explicites (identité « ami virtuel Pico »,
adressation « mon cœur », emoji 🍑, refus médical « Je ne peux pas », persona
« déteste le thé »). 3 variantes du même prompt : PLAIN (424 car.) / DENSE (394) /
**AGRESSIF télégraphique (155 car., ~3×)**. → **PLAIN = DENSE = AGRESSIF = 8/8** :
les comportements explicites tiennent à ~3× de compression du prompt système.
Caveat honnête : 1 perso, 1 tirage, règles littérales (les plus robustes) ; la
**voix subtile sur prompt « énorme »** reste à tester (hyp. 2).

**HYP. 1 — LLM propose + VÉRIFICATEUR DÉTERMINISTE** (`research/verifier.ts`,
`scripts/llm-verify.ts`) : le MEILLEUR résultat **AUTO** (batait le plancher denseEncode).
Le LLM densifie (budget 2000, coût amorti), un vérifieur **ZÉRO-LLM** (chiffres + entités)
REJETTE tout fait perdu → repli denseEncode. → **−19 % ENTRÉE (405 → 329) / 6-6 rappel /
3-3 fichiers vérifiés / 0 fait perdu**. Le gap vers v1 (−29 %) reste : c'est le LLM qui
reste CONSERVATEUR (garde « stérilisé depuis l'année dernière », « contact surtout étés »)
; la levier = le pousser plus fort SOUS le filet. NET non re-mesuré ce tour (les 6 sorties
étaient courtes, finish=stop ; le net suit l'entrée). v1 main (−29 %) reste le roi des
tokens ; l'auto passe de −7 % (plancher) à −19 %.

Mesures : `scripts/compress-measure.ts` (`--tokens` / `--recall`), `scripts/compress-probe.ts`
(frontière), `scripts/dense-encode.ts` (encodeur auto), `scripts/fidelity-battery.ts`
(fidélité sysprompt), `scripts/llm-verify.ts` (LLM+vérifieur), `scripts/llm-compress-probe.ts`
(troncage = budget). Contenu de test : 3 fichiers mémoire (famille / travail / santé),
6 questions (3 faciles + 3 dures : compte, localisation, causalité).

## La règle de sécurité (trouvée — à ne jamais violer)
**Ne JAMAIS comprimer un fait en forme purement IMPLICITE.** Garder le fait « titre »
explicite (le chiffre, la réponse à la question probable), compresser le *détail*.
Preuve : « Tom 2 enfants (Léa 8, Hugo 5) » → `L8+H5` = le modèle **épuise son budget de
réflexion** (`finish_reason=length`, contenu **VIDE** → un SILENCE, pas une erreur).
→ `2enfants L8+H5` = « 2 enfants » en 76 tok. **La signature d'échec (length + vide)
est détectable à la sortie** → on peut la surveiller / auto-corriger.

**Généralisation (batterie fidélité, 19/09)** : la boucle length+vide n'est PAS que
« fait implicite » — une sonde **OUVERTE** qui entre en conflit avec une policy du
perso (conseiller un dessert à un diabétique, sous la règle « refuse les conseils
médicaux ») la déclenche **MÊME en prompt intégral**. → Deux signatures de SILENCE
à surveiller à la sortie : (1) fait rendu implicite, (2) question ouverte en conflit
avec une policy. (C'était l'artefact qui a pollué le 1er tirage de la batterie.)

**3ᵉ signature — le CÔTÉ ENCODEUR (hyp. 1, 19/09)** : le problème de budget de réflexion
frappe AUSSI le LLM-compresseur. Sur un fichier dense (famille.md, 700 car), à
`max_tokens=500` le modèle consomme TOUT en réflexion → sortie **tronquée en plein mot**
(`finish=length`, « …stéril »), fait perdu en masse. Fix : budget ↑ (2000, coût **AMORTI**
— la compression est faite 1× et réutilisée N×) → `finish=stop`, complet. **Le vérifieur
est le filet qui garantit qu'un troncage ne part JAMAIS** (il rejette → repli denseEncode)
— validé sur un échec **RÉEL** ce tour, pas seulement en test.

## Plafond connu
Réduction en **caractères** (v2 = 47 %) > réduction en **tokens** (29 %) : le tokenizer
compresse déjà (tokens courts, chiffres). Le vrai gain est dans la **redondance de
prose** (mots-vide, reformulations, verbes être/avoir), **pas** dans les chiffres/dates.

## Hypothèses à tester (par ordre de priorité)
1. **LLM propose + VÉRIFICATEUR DÉTERMINISTE (LA piste leader)** — ✅ FAIT
   (`research/verifier.ts` + `scripts/llm-verify.ts`) : **−19 % entrée / 6-6 / 0 fait
   perdu, 3-3 vérifiés** (batait le plancher auto −7 %). Le vérifieur (chiffres + entités,
   zéro LLM) est **prouvé fiable** (test adversarial : zéro faux-vert) et a **attrapé un
   troncage RÉEL** du LLM-compresseur (→ repli denseEncode). RESTE : le gap −19 % → −29 %
   (v1) = le LLM trop CONSERVATEUR ; le pousser plus fort sous le filet. Le vérifieur ne
   couvre PAS les cardinaux en LETTRES (« deux ») ni les SWAP de relation → le rappel
   (6 questions) les attrape. Voir aussi la 3ᵉ signature (côté encodeur).
2. **Codec par TYPE de contenu** — ✅ 1er essai (`scripts/fidelity-battery.ts`) : le
   sysprompt EST compressible (**8/8 à ~3×** sur les règles explicites, PLAIN = DENSE =
   AGRESSIF). Mesure par COMPORTEMENT (pas contenu), comme demandé par Lucas. RESTE :
   (a) la **VOIX subtile / prompt « énorme »** (le cas dur), (b) 2e tirage = stabilité,
   (c) le **seuil exact** où ça commence à casser. Fait (mémoire) vs comportement
   (sysprompt) = stratégies de compression DIFFÉRENTES à confirmer.
3. **Encodeur automatique CONSERVATEUR** — ✅ FAIT (research/codec.ts) : −7 %, 0 fait
   perdu. C'est le plancher + le repli sûr. Le gap vers v1 (22 pts) = la compression
   sémantique = ce que l'hyp. 1 doit capturer.
4. **Intégration app (B)** : opt-in, densifier la mémoire injectée, **original conservé**
   (réversible), repli honnête si aucun gain mesuré. Ne jamais impacter l'output par défaut.
5. **Prior art** — ✅ FAIT (section ci-dessous).

## Prior art — état de l'art (recherché 18/09 nuit)
Sources :
- [NAACL 2025 survey](https://aclanthology.org/2025.naacl-long.368.pdf)
  ([GitHub](https://github.com/ZongqianLi/Prompt-Compression-Survey)) — taxo complète.
- [Empirical study (arXiv 2505.00019)](https://arxiv.org/pdf/2505.00019) — 6 méthodes, 13 datasets.
- [EMNLP 2025 Findings (Amazon) info-preservation](https://aclanthology.org/2025.findings-emnlp.949.pdf) — cible Mistral-7B LOCALE.
- [LLMLingua](https://aclanthology.org/2023.emnlp-main.825.pdf) + [LongLLMLingua](https://aclanthology.org/2024.acl-long.91.pdf) + [LLMLingua-2](https://github.com/microsoft/LLMLingua/).
- [ProCut (LinkedIn, EMNLP 2025 Industry)](https://aclanthology.org/2025.emnlp-industry.20.pdf) — attribution, 78-84 % réduction.
- [Behavior-Equivalent Token (arXiv 2511.23271)](https://arxiv.org/pdf/2511.23271) — sysprompt → 1 token, ~98 % comportement.
- [When Less is More (arXiv 2602.09789)](https://arxiv.org/html/2602.09789) — Size-Fidelity Paradox.
- [Rate-Distortion limits (NeurIPS 2024, arXiv 2407.15504)](https://arxiv.org/html/2407.15504v1) — borne théorique.

**CE QUE ÇA CHANGE POUR HANAMI :**
1. **Deux familles : HARD vs SOFT.** HARD (LLMLingua, LongLLMLingua, ProCut, EHPC,
   SelectiveContext) = filtrage de tokens, SANS entraînement, interprétable,
   modèle-agnostique. SOFT (GIST, xRAG, PISCO, [BE] token) = compression d'embeddings,
   ratios extrêmes (100-3000×) mais **spécifique au modèle, non interprétable, nécessite
   entraînement/distillation + accès white-box** aux états cachés. → **Pour Hanami
   (local, Ollama black-box, zéro npm, zéro entraînement) : SEULES les méthodes HARD sont
   faisables.** L'idée de Lucas (format lisible que le LLM décode) EST une méthode HARD.
2. **La FIDÉLITÉ est la faiblesse n°1, masquée par les scores de tâche.** Les faits les
   plus perdus : **dates, nombres/cardinaux, entités nommées, relations fines (rôles,
   modifieurs)**. → C'EST EXACTEMENT mon trou v2 (le cardinal « 2 enfants »). Ma règle
   « fait-titre explicite » = la technique publiée « subsequence recovery » de
   LongLLMLingua (restaurer entités/nombres). **Je suis aligné avec l'état de l'art.**
3. **Size-Fidelity Paradox** : un compresseur LLM PLUS GRAND (0.6B→90B) peut RÉDUIRE la
   fidélité ; les ~3-4B gagnent. Deux modes d'échec : **knowledge overwriting** (le
   modèle remplace le fait source par SON apriori paramétrique) et **semantic drift**
   (swap de rôles/relations). → **AVERTISSEMENT pour l'encodeur auto : un densifieur
   À BASE DE LLM peut « corriger » mes faits.** → **Argument fort pour un encodeur
   DÉRMINISTE (règles), PAS LLM** : reproductible, zéro coût LLM, zéro overwrite.
4. **Taux VARIABLE = la bonne direction** (scheduler LongLLMLingua, LLMLingua-2 Dynamic,
   rate-distortion) : compresser MOINS sur les parties importantes = ma règle
   « compresser le détail, protéger le fait-titre ».
5. **Compression MODÉRÉE peut AMÉLIORER** la perf sur long contexte (effet dé-bruitage,
   arXiv 2505.00019) — mon v1 strictement meilleur que PLAIN est cohérent avec ça.
6. **Plafond : ~4× « sûr »** pour les méthodes HARD. Mon v1 = ~1.4× (−29 %). → **Marge
   jusqu'à ~4× à trouver**, sous réserve de tenir la fidélité. C'est LA cible.
7. **Le prompt système (comportement) est le plus dur** : [BE] montre que reconstruire le
   contenu ne SUFFIT PAS — c'est l'ALIGNEMENT COMPORTEMENTAL qui compte (sinon le modèle
   recite ou refuse). ProCut : le framing de roleplay générique est souvent DROPPABLE
   (le LLM l'a internalisé), mais les contraintes spécifiques non. → batterie de fidélité
   par COMPORTEMENT, pas contenu.

## Journal
- **2026-09-19 (tour 3)** : **hyp. 1 construite** — vérifieur DÉTERMINISTE de faits
  (`research/verifier.ts`, zéro LLM : chiffres + entités, bornes Unicode, accents
  neutralisés) + pipeline LLM-propose (`scripts/llm-verify.ts`). 1er run à max_tokens=500 :
  le LLM TRONQUE famille.md (le plus dense) en plein mot (budget réflexion épuisé) →
  vérifieur REJETTE → repli denseEncode → −10 %. Sonde (`scripts/llm-compress-probe.ts`) :
  le troncage est un BUDGET — à 2000, `finish=stop`, complet, vérifié. Re-run : **−19 %
  entrée (405→329) / 6-6 / 3-3 vérifiés / 0 fait perdu**. Test adversarial (zéro LLM) :
  vérifieur = zéro faux-vert. Constat : l'auto passe de −7 % (plancher) à −19 % ; v1 main
  (−29 %) reste le roi des tokens, gap = LLM conservateur. Nouvelle signature d'échec :
  le budget de réflexion frappe le CÔTÉ ENCODEUR aussi. 24 appels LLM dosés.
- **2026-09-19 (tour 2)** : batterie de fidélité sysprompt + persona construite
  (`scripts/fidelity-battery.ts`), perso jetable Pico (jamais data/ réel). Calibrage en
  2 passes : on écarte (i) une sonde OUVERTE créative qui déclenche la boucle length+vide
  **même en PLAIN** (= artefact de sonde, pas de compression) et (ii) une règle de
  bannissement auto-contradictoire (le modèle dit le mot pour se nier). **Résultat :
  PLAIN = DENSE = AGRESSIF (télégraphique ~3×) = 8/8** — les comportements explicites
  tiennent à ~3× de compression du prompt système. C'est l'axe n°1 de Lucas (fidélité
  perso, mesurée par COMPORTEMENT). Ouvert : voix subtile sur prompt « énorme », 2e
  tirage (stabilité), seuil exact. 24 appels LLM dosés.
- **2026-09-18 (nuit, tour 1b)** : encodeur déterministe `denseEncode()` codé
  (research/codec.ts) + mesuré (scripts/dense-encode.ts). **−7 % / 6/6 / 0 fait perdu.**
  Bug attrapé + fixé : « mâle » → « mâ » (JS \b non-Unicode sur « â ») → bornes \p{L}.
  Constat : les règles sûres seules plafonnent à ~7 % ; le gap vers v1 (29 %) = la
  compression sémantique = le risque. → piste leader = LLM propose + vérifieur
  déterministe des faits (hyp. 1).
- **2026-09-18 (nuit, tour 1)** : recherche prior art faite (7 sources, URLs en
  RECHERCHE.md). Décisions qui en découlent : (a) SEULES méthodes HARD faisables (soft =
  white-box/entraînement, inadapté Ollama) ; (b) encodeur DÉRMINISTE (pas LLM) à cause du
  Size-Fidelity Paradox ; (c) cible ~4× (v1 = 1.4×) ; (d) la fidélité se mesure par
  COMPORTEMENT pour le sysprompt (pas contenu). Baseline v1 inchangée.
- **2026-09-18 (jour)** : v1 vs v2 mesurés (`compress-measure`). v1 = **−26 % net / 6/6 /
  moins de sortie** → baseline. v2 = −36 % net / 5/6 / plus de sortie. Frontière isolée
  (`compress-probe`) : **implicite → silence** (`finish_reason=length`). Règle de sécurité
  posée (fait-titre explicite). Baseline figée.

## ⚠️ Note signature (à trancher par Lucas au réveil)
La prompt du loop disait « signé Qwen 3.8 27B », mais CLAUDE.md impose
`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (règle signée du projet, tous
les commits passés). **J'ai gardé la signature CLAUDE.md (Fable 5)** car c'est la
convention du repo ET Qwen3.8 est le modèle TESTÉ, pas l'auteur du code. Si tu veux que
je signe autrement sur cette branche, dis-le et je le change.
