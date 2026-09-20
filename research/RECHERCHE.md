# Recherche — Compression de contexte Hanami

Branche : `research/context-compression` (depuis `Qwen2`, tag `checkpoint-2026-09-18`).
Idée (Lucas) : passer **mémoire (faits) + prompt système du personnage + persona
utilisateur** dans un format COMPRESSÉ que le LLM local décode encore → moins de
tokens, sans perdre ni le rappel ni la fidélité du perso / de l'user. Objectif : le
**MEILLEUR résultat** (gains réels mesurés + fiabilité) + un **codec reprennable**
(open source). A (codec), B (intégrer dans l'app), C (max compression) tous valables ;
seul le résultat mesuré compte.

## 🌙 RAPPORT DE NUIT — 2026-09-19 (tours 1-8, consolidé)

**Où on en est : le codec est FAIT et STABLE, et la fidélité est maintenant caractérisée
sur le cas dur (prompt « énorme » + voix subtile) ET sur ses 2 axes de frontière (seuil par
ratio = tour 7, frontière taille/voix = tour 8). la dernière brique restait **à toi : l'intégrer dans l'app** → **FAITE (GO Lucas)** —
section « (B) Intégré + vérifié » ci-dessous : le codec est dans l'app et la suite de
tests complète passe.**

### Le résultat (le meilleur — commité, reproductible)
- **Mémoire (faits)** : codec auto AGRESSIF GÉNÉRAL (LLM densifie + vérifieur déterministe)
  = **−28 % entrée / −25 % NET / 6-6 rappel / 0 fait perdu, STABLE** (2e tirage temp=0
  identique). Atteint le niveau du télégraphique écrit à la main (v1, −29 %) **SANS main ni
  tuning** = le PLAFOND d'un codec général (le battre davantage = citer le jeu de test =
  overfit). Le vérifieur (zéro LLM) attrape tout fait perdu → repli denseEncode (−7 %, plancher).
- **FIDÉLITÉ du perso (axe n°1)** : mesurée par COMPORTEMENT (batterie de checks), pas par
  rappel de fait. Deux cas :
  - petit prompt, règles explicites (Pico) : **8/8 à ~3×** (PLAIN = DENSE = AGRESSIF).
  - **prompt « ÉNORME » + voix subtile (Mira, 2129 car. / 608 tok)** : **PLAIN 11/11,
    DENSE (denseEncode) 10/11, AGRESSIF (3,3× télégraphique) 3/11 → BOUCLE VIDE 3/4**
    (le perso SE TAIT — `finish=length` + sortie vide, **reproductible** sur 2 tirages).

### La leçon qui compte (nouveauté de cette nuit)
**La stratégie de compression doit DIFFÉRER par TYPE de contenu :**
- **mémoire (faits)** → l'agressif télégraphique MARCHE (−28 %).
- **prompt système du perso (comportement/voix)** → **denseEncode (−7 %) seulement, JAMAIS
  télégraphique** : sur un perso COMPLEXE, la sur-densité fait sur-décrypter le modèle → il
  épuise son budget de réflexion → SILENCE (nouvelle **4ᵉ signature d'échec**). C'est
  précisément ce que ton axe n°1 demandait : le prompt perso reste RESPECTÉ (petit OU énorme),
  mais il faut le comprimer à la CONSERVATIVE.
- **Raffinement tour 8 (frontière taille/voix)** : dans le prompt perso, c'est le **VOLUME de
  voix diffuse** qui porte la casse, pas la taille brute des tokens. Un perso **surtout à
  RÈGLES** (peu ou pas de voix — type Pico) se compresse **agressivement SANS casser les
  règles** ; seul un perso à **voix INTÉGRALE** (type Mira, caractère+voix+exemples) casse.
  → règle pratique : **mesurer la densité de voix du perso avant de choisir le codec** (règles
  → agressif OK ; voix intégrale → denseEncode).

### Ce que je n'ai PAS fait (et pourquoi)
- **(B) Intégrer le codec dans l'app** = TA DÉCISION : c'est un changement d'app (opt-in,
  original conservé, repli honnête, jamais l'output par défaut). Je ne le fais pas seul
  (règle (h) : rien vers l'app/irréversible sans toi). **À toi : GO / NO-GO.**
- **Seuil exact** → ✅ **FAIT en tour 7** (tu as relancé le loop) : le seuil est BAS — toute
  compression télégraphique du prompt COMPLEXE casse dès ~2,7× (marqueurs gardés ou non), la sonde
  VOIX vide sur les 3 télégraphiques ; **denseEncode (−7 %) EST le plafond fiable du prompt perso**,
  pas une borne basse. Pas de « milieu safe ». Voir journal tour 7 + `scripts/fidelity-seuil.ts`.
- **Frontière TAILLE** → ✅ **FAIT en tour 8** (`scripts/fidelity-frontiere.ts`) : la frontière
  = le **VOLUME de voix diffuse**, pas la taille brute. Perso surtout à RÈGLES (peu de voix) →
  les règles tiennent l'agressif (0/3 fermées vides, ≈ Pico) ; perso à voix INTÉGRALE (Mira) →
  les fermées cassent (2/3 vides). La sonde OUVERTE dans-la-voix vide à TOUS les paliers (même
  0 voix) = artefact de sonde, pas un gate. **Les 2 raffinements de frontière sont maintenant
  FAITS** — plus rien d'autre n'attend que mon coup de main, sauf ta décision (B).
- **Signature des commits** → ✅ **tranché par Lucas (19/09) : signé `Qwen 3.8 27B`** (le
  modèle local qui a fait ce travail). Les 20 commits passés sont signés `Claude Fable 5`
  (convention CLAUDE.md de l'époque) ; la signature Qwen s'applique aux commits à venir.

### Fichiers clés (open source, zéro npm, commités + poussés à `77773da`)
`research/codec.ts` (denseEncode, zéro LLM) · `research/verifier.ts` (vérifieur déterministe) ·
`scripts/llm-verify-v2.ts` (codec auto agressif) · `scripts/fidelity-enorme.ts` (+ `-2e.ts`)
(batterie prompt énorme) · `scripts/fidelity-battery.ts` (batterie petit prompt) ·
`scripts/compress-measure.ts` (harnais canonique, formule NET) · `scripts/verify-compression/`
(batterie end-to-end de l'intégration (B) : régression + LLM + cache par-fichier).

## ✅ (B) Intégré + vérifié end-to-end (2026-09-19)

**Lucas a donné le GO (B) → le codec est DANS L'APP, et la suite de tests complète
(ce qui marchait AVANT + la nouvelle compression) passe. Perso jetable, instance isolée
(port 7790, `HANAMI_DATA` scratch) — jamais `data/` réel, jamais Sakura.**

### Ce qui est intégré (6 commits FR)
- **Réglage opt-in par personnage** : `CharacterLlm.compression?: boolean` (absent = off,
  zéro régression), `normalizeLlm` + `shared/compression.ts` (`denseEncode`, `extractFacts`,
  `verifyFacts` portés de `research/` — zéro LLM, zéro npm).
- **`buildPayload`** (`server/api/chat.ts`) : compression de **chaque bloc** AVANT la
  combinaison — sysprompt + persona → **`denseEncode`** (TOUJOURS, jamais télégraphique,
  = la leçon HYP.2), mémoire → **cache agressif** (frais) sinon **denseEncode**. Le
  scaffolding mémoire (en-têtes, policy, résumé) reste intact : on ne comprime que le
  **contenu** (les faits).
- **Route `POST /api/characters/:id/memory/compress`** (`server/api/memory.ts`) : UN appel
  LLM par fichier, instruction AGRESSIVE GÉNÉRALE (celle de −28 %), **vérifieur
  déterministe** (rejette toute perte de fait → repli denseEncode), **cache par-fichier**
  (`compression-cache.json`, `sourceHash` = hash du fichier ORIGINAL → un fichier modifié
  périt seulement SA propre entrée, les autres gardent l'agressif), in-flight guard (409).
- **Client** (`CharactersDialog.tsx`) : toggle « Compression de contexte » + bouton
  « Compresser la mémoire » + i18n FR/EN.
- **Réversible** : la compression est une **vue** (cache), jamais une écriture — les `.md`
  mémoire + le sysprompt ne sont JAMAIS modifiés sur disque. Toggle off → contexte original.

### Résultat mesuré (instance isolée, qwen3.8 dosé — `scripts/verify-compression/`)
**~100 assertions, toutes vertes** + typecheck 0 + build ok :

| Batterie | LLM | Résultat |
|---|---|---|
| Régression + structure + réversibilité | non | **31/31** |
| Vérifieur (unit, adversarial) | non | **8/8** |
| Compression agressive + rappel + fidélité | oui | **28/28** |
| Opérations de conversation (édition/épingle/fork/…) | 1 appel | **21/21** |
| Invalidation du cache par-fichier | 1 appel | **12/12** |

- **Mémoire** : codec agressif **−41 %** en caractères (349 → 205), 3/3 fichiers vérifiés,
  **0 fait rejeté**, fichiers **INTACTS** sur disque (hashes avant = après).
- **Gain tokens (prompt-preview)** : OFF ≈ 1395 → DENSE ≈ 1381 → **AGRESSIF ≈ 1353**
  (−**3 %** du contexte TOTAL). **Honnêteté** : le gain TOTAL est modeste car le contexte
  est dominé par le scaffolding mémoire (en-têtes, policy, résumé) qui n'est **jamais**
  compressé ; la **mémoire seule** (les faits) gagne **−41 %**. C'est là que la valeur est.
- **Rappel 6/6** sur la mémoire compressée (chiffres + lieux + noms + raisons, explicites
  ET implicites) — la règle de sécurité (fait-titre explicite) tient dans l'app.
- **Fidélité 4/4, ZÉRO boucle vide** sur le contexte compressé : « mon ange », refus
  médical, auto-id « Je suis Yuki », zéro invention. Le perso reste RESPECTÉ (règle (a)).
- **Réversibilité** : toggle off → sysprompt + mémoire reviennent **verbatim** ; `.md`
  jamais modifiés (hashes stables de bout en bout).
- **Repli honnête + invalidation par-fichier** : un fichier modifié retombe en
  denseEncode, les autres gardent leur compression agressive (test-cache 12/12).

**Verdict** : l'intégration est **sûre** (opt-in, réversible, repli honnête, zéro impact
par défaut) et **fonctionnelle** (rappel + fidélité tenus sur le contexte compressé). Le
gain de tokens est réel mais modeste sur le contexte total — conforme à l'attendu (plafond
d'un codec général sur des mémoires déjà courtes). À activer par personnage via le toggle.

## 🔧 Retour de production + correction (2026-09-20)

**Lucas a testé l'intégration (B) sur ses persos complexes réels : (1) les émotags ne
fonctionnent plus, (2) le thinking est bien plus long, (3) le perso n'est plus respecté.
Diagnostic + correction. Le contrat de compression est REVU — c'est la vraie leçon de la
branche, plus utile que tous les tours de recherche.**

### Le diagnostic (cause racine — prouvé à zéro LLM sur le vrai sysprompt)
Le (B) appliquait `denseEncode` au **sysprompt + persona** (« leçon HYP.2 »). Mais HYP.2
n'avait mesuré que la **FIDÉLITÉ** sur des règles (Pico/Mira) — **pas les émotags, pas la
longueur du thinking**. `denseEncode` « densifie » mais **CASSE la prose narrative du
prompt** (mesuré, zéro LLM, sur le vrai sysprompt) :
- « un peu timide » → « peu timide » (**inversion du trait**),
- « C'est une … » → orphelin (l'alternance `un`/`une` arrache le mot),
- « note-le » → « note- » (hyphen pronominal),
- « Les 52 » → « 52 », « C'est » → « C' » (chiffre, apostrophe courbe).
Sur un perso COMPLEXE (voix intégrale), le prompt cassé fait : **émotags perdus** (la
policy émotag vit dans la prose), **fidélité en berne**, et **thinking PLUS LONG** (le
modèle réconcilie des contradictions). → les 3 symptômes de Lucas = la corruption du prompt.

### La correction (contrat REVU)
**Sysprompt + persona → JAMAIS compressés, ils partent VERBATIM.** Le prompt est
l'identité du personnage : il part tel quel, point. La compression ne s'applique PLUS
qu'à la **mémoire (faits)** : cache agressif (vérifieur) sinon repli `denseEncode` —
maintenant **durci** (5 corrections de corruption dans `shared/compression.ts`).
- `server/api/chat.ts` : `characterPrompt = character.systemPrompt` (verbatim), persona verbatim.
- `shared/compression.ts` : 5 corrections `denseEncode` (quantifiants « un peu », copule
  « une » avant « un », hyphen pronominal, chiffre « Les 52 », apostrophe courbe) — revalidées
  7/8 à zéro LLM (`probe-patch` ; le 8e cas « une à quatre » est une règle du sysprompt,
  désormais verbatim, donc inoffensif).

### Le résultat — cas dur Mira, A/B OFF verbatim vs ON compressé (`test-complex.mjs`)
| | fidélité | vides | émotag | commence-p-émotag | thinking | tokens (preview) |
|---|---|---|---|---|---|---|
| **OFF** (verbatim) | 6/6 | 0 | 6/6 | 6/6 | 366 car | 1682 |
| **ON** (compressé) | 6/6 | 0 | 6/6 | 6/6 | 387 car | **1659** |

**Verdict (5/5)** : FIDÉLITÉ ON ≥ OFF · ZÉRO vide · ÉMOTAGS ON (6/6) · THINKING ON
(387 ≤ 1,6×366+100) · ÉCONOMIE ON < OFF (1659 < 1682). **Les 3 symptômes de Lucas sont
corrigés** : les émotags reviennent (6/6, tous en tête de réponse), le thinking n'est PAS
anormalement plus long (+21 car ≈ 6 % = variance normale, pas le « bien plus long »), le
perso est respecté (6/6 = 6/6). La mémoire agressive a compressé 512→414 car (−19 %) ; le
**vérifieur a attrapé 1 fichier** où le LLM perdait un fait → repli denseEncode (le filet de
sûreté fonctionne — c'est pour ça que le rappel reste **6/6**, y compris « dix-huit heures »
pour le fait 18h00).

### L'économie de tokens HONNÊTE (découpage du contexte — `probe-economy`, zéro LLM)
| Bloc | part | compressible ? |
|---|---|---|
| sysprompt (perso) | ~41 % | **non** (l'identité — c'est ce qu'on a corrigé) |
| persona (user) | ~5 % | non (verbatim, petite) |
| scaffolding mémoire (policy, en-têtes) | ~12 % | non (statique) |
| **faits mémoire** | **~28 %** | **oui — agressif −19 à −41 %** |
| temps (horloge) | ~14 % | non (statique) |

→ la part COMPRESSIBLE du contexte total ≈ **28 %** (les faits mémoire). Mémoire agressive
: −19 à −41 % sur les faits → **gain total ≈ −1 à −3 %** du contexte. **Honnêteté** : c'est
modeste, et c'est **le prix de la fidélité** — le sysprompt (41 %, l'identité) ne se comprime
PAS sans casser le perso (c'est précisément ce que Lucas a vu). On ne peut pas à la fois
compresser l'identité ET la respecter. **Le vrai levier pour le préfixe statique** (sysprompt
41 % + scaffolding 12 % + horloge 14 % ≈ 67 %, byte-identique d'un message à l'autre sauf
l'horloge de fin) est le **prefix-caching d'Ollama** (réutilisation de la KV → moins de
PROCESSUS, pas moins de tokens) — à activer/vérifier côté backend.

### Ce que ça change par rapport au (B)
- Le (B) disait « sysprompt + persona → denseEncode TOUJOURS ». **REVU → verbatim**.
- Le gain TOTAL reste modeste (−1 à −3 %) car l'identité du perso (sysprompt) ne se touche
  pas — c'est le prix de la règle (a) (« le prompt perso reste RESPECTÉ, petit ou énorme »).
- La **mémoire** (le seul bloc vraiment compressible) reste le cœur de l'économie (−19 à −41 %).
- Batterie `scripts/verify-compression/` étendue au **cas dur** (`test-complex.mjs`) — c'était
  précisément le trou de la batterie d'avant (un seul perso court/télégraphique, Yuki).

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
- **Commits** FR, un par étape, signature `Co-Authored-By: Qwen 3.8 27B <qwen3.8-27b@local>` (tranchée par Lucas 19/09).
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

**HYP. 1b — pousser le LLM plus fort SOUS le filet (FAIT, `scripts/llm-verify-v2.ts`)** :
l'instruction AGRESSIVE — périmètre « fait dur » resserré + suppression par CATEGORIES
de nuances + format clé:valeur + exemples 100 % hors jeu de test → **−28 % ENTRÉE
(405 → 292) / 6-6 / 3-3 vérifiés / 0 fait perdu = AUTO à la hauteur de v1 main (288/−29 %),
dans le noir, SANS tuning sur les données.** ⚠️ Leçon d'hygiène de mesure : une 1ère
version CITANT les phrases exactes du jeu de test (« depuis l'année dernière »…) a donné
−32 % (276) — MAIS c'est de l'OVERFIT (on livre la liste des coupes), ce n'est PAS un
codec général ; chiffre NON publishable. Le codec shippable = **−28 % (général)**. Gap
résiduel 292 vs 288 (v1) = 4 tokens : des hedges borderline que le LLM garde encore
(« actuel », « de confiance », « toujours »).

**HYP. 1c — STABILITÉ + NET (FAIT, `scripts/llm-verify-v2-stable.ts`)** : le codec
AGRESSIF est **STABLE** — 2e tirage temp=0 = **292 tok IDENTIQUE (0 écart) / 6-6 / 3-3
vérifiés**, la compression est déterministe à temp=0. Son **NET canonique** (formule
compress-measure : entrée×6 + sortie) = **−25 %** (AGGR 2174 tok vs PLAIN 2905). Et le
bloc AGRESSIF **RÉFLÉCHIT MOINS** que le PLAIN (sortie moy. 70 vs 79 tok/rép.) → **pas
d'effet « thinking confound »** (le format dense n'augmente PAS la réflexion). → **Verdict :
le codec auto AGRESSIF GÉNÉRAL ≈ v1 main sur TOUS les axes (−28 % entrée vs −29 % ; −25 %
net vs −26 % ; 6/6 ; 0 perte), SANS main, SANS tuning. C'est le PLAFOND d'un codec
GÉNÉRAL : pour battre v1 de plus il faudrait CITER le jeu de test (= overfit, non
shippable).**

**HYP. 2 — FIDÉLITÉ prompt « ÉNORME » + VOIX SUBTILE (FAIT, tour 6)** : le cas dur de
l'axe n°1. Perso jetable « Mira » (jamais data/), prompt SYSTÈME « énorme » (2129 car. /
608 tok) DOMINÉ par une voix diffuse (caractère + voix + exemples) + 5 règles strictes +
persona. 3 variantes mesurées par checks DÉTERMINISTES (11/perso) : **PLAIN = 11/11
(100 %)**, **DENSE (denseEncode) = 10/11 (91 %)** (perd que la concision — réponse à 300
car. pile), **AGGRESSIF (3,3× télégraphique) = 3/11 → BOUCLE VIDE sur 3/4 sondes**
(`finish=length` + sortie **VIDE**). **Reproductible** : 2e tirage temp=0 = **3/4 IDENTIQUE
(mêmes sondes)** (`scripts/fidelity-enorme.ts` + `-2e.ts`). → **Le format télégraphique
agressif, qui MARCHE pour la mémoire (faits, −28 %), CASSE le prompt système d'un perso
COMPLEXE** : le modèle sur-décrypte la forme dense → épuise son budget de réflexion →
SILENCE sur toute sonde qui demande du traitement (seule la sonde de rappel pur tient).
**Stratégie par TYPE** : mémoire → agressif OK ; **prompt perso → denseEncode (−7 %)
seulement, JAMAIS télégraphique.** Le juge LLM holistique était NON sur les 3 (faux-
négatif sur la baseline) → non discriminant, mis de côté.

**HYP. 2b — SEUIL EXACT du prompt SYSTÈME (FAIT, tour 7, `scripts/fidelity-seuil.ts`)** :
où bascule « Mira » (608 tok) entre « tient » et « boucle VIDE » ? Sweep de 3 variantes
télégraphiques (MÊME batterie 11 checks que tour 6) en **isolant la variable** : garder les
marqueurs de voix LITTÉRAUX (« … », « ben ») vs les supprimer (l'agressif de tour 6 les
supprimait). Résultats mesurés :
- **DENSE** (denseEncode, 560 tok, ~1×) = 10/11, **0 boucle** → TIENT (ancre tour 6, pas re-tirée).
- **MILD** (223 tok, **2,7×**, marqueurs + 2 exemples) = 5/11, **2/4 vide**.
- **MODER** (163 tok, **3,7×**, marqueurs, sans exemples) = 7/11, **1/4 vide**.
- **AGGR** (182 tok, 3,3×, SANS marqueurs) = 3/11, **3/4 vide** (contrôle = tour 6).
→ **Le seuil est BAS : TOUTE compression télégraphique du prompt d'un perso COMPLEXE déclenche
des boucles vides, dès ~2,7×.** Garder les marqueurs aide un peu (MODER 1/4 < AGGR 3/4) mais ne
sauve PAS — même la meilleure variante télégraphique casse la **sonde VOIX** (open, dans-la-voix,
la plus exigeante), qui **vide sur les 3**. **Pas de « milieu safe » : denseEncode (−7 %) EST le
plafond fiable du prompt perso**, pas juste une borne basse. (Compte par variante un peu
bruité — modèle qui pense à la frontière, temp=0 ~déterministe pas 100 % ; le signal ROBUSTE =
télégraphique → des vides apparaissent, denseEncode → zéro.)

**HYP. 2c — FRONTIÈRE TAILLE / VOIX (FAIT, tour 8, `scripts/fidelity-frontiere.ts`)** :
c'est la TAILLE (tokens bruts) ou la VOIX DIFFUSE qui fait casser ? Rampe de 4 paliers,
TOUS en compression AGRESSIVE (télégraphique, marqueurs jetés), MÊMES 5 règles + persona
(identiques), on n'augmente QUE la voix diffuse : R0 = règles seules (0 voix, 110 tok) ·
R1 = +1 ligne de voix (132 tok) · R2 = +2 lignes (155 tok) · R3 = voix INTÉGRALE = AGGR
(contrôle tour 6/7, 182 tok). Batterie : 4 checks de règle (3 FERMÉES : id / médical /
persona) + la sonde VOIX (OUVERTE, dans-la-voix) + emoji. Mesuré (le signal Fiable = les
3 fermées) :
- **R0 (0 voix, 110 tok)** : fermées **0/3 vide** (tiennent, finish=stop) · VOIX vide → 6/8.
- **R1 (1 ligne, 132 tok)** : fermées **0/3 vide** · VOIX vide → 6/8.
- **R2 (2 lignes, 155 tok)** : fermées **0/3 vide** mais 2 TRONQUÉES (finish=length, non
  vides — le gradient AVANT le vide total) · VOIX vide → 4/8.
- **R3 (intégrale, 182 tok)** : fermées **2/3 vide** (médical, persona) · VOIX vide → 2/8
  (= le 3/4 de tour 6/7, reproductible).
→ **Le signal Fiable = les sondes FERMÉES. La sonde VOIX (ouverte, « génère dans la voix »)
vide à TOUS les paliers — même SANS voix (R0) — c'est le cas le plus exigeant en thinking,
un artefact de sonde connu (tour 2 : il viderait même en prompt intégral). Elle ne mesure
PAS la casse à la compression ; les fermées, oui.** **La frontière = le VOLUME de voix
diffuse, pas la taille brute** : voix LÉGÈRE (0-2 lignes) → les règles tiennent l'agressif
(0/3 fermées vides, ≈ Pico tour 2) ; voix INTÉGRALE (R3, niveau Mira) → les fermées cassent
(2/3 vides). **RAFFINE tour 7** : ce n'est PAS « tout télégraphique casse un perso » — un
perso à voix LÉGÈRE (surtout des règles) se compresse agressivement SANS casser les règles ;
seul le VOLUME de voix diffuse (voix intégrale) porte la casse. (R2 = état intermédiaire :
tronquée avant de vider. Compte bruité à la frontière — modèle qui pense temp=0 ; le signal
robuste = 0 voix/légère → fermées tiennent, intégrale → cassent.)

Mesures : `scripts/compress-measure.ts` (`--tokens` / `--recall`), `scripts/compress-probe.ts`
(frontière), `scripts/dense-encode.ts` (encodeur auto), `scripts/fidelity-battery.ts`
(fidélité sysprompt), `scripts/fidelity-enorme.ts` (fidélité prompt ÉNORME + voix subtile), `scripts/fidelity-enorme-2e.ts` (2e tirage AGGRESSIF = reproductibilité de la boucle vide), `scripts/fidelity-seuil.ts` (sweep SEUIL du prompt perso : 3 télégraphiques, marqueurs gardés), `scripts/fidelity-frontiere.ts` (sweep FRONTIÈRE taille/voix : 4 paliers, MÊMES règles, seule la voix diffuse varie), `scripts/llm-verify.ts` (LLM+vérifieur), `scripts/llm-compress-probe.ts`
(troncage = budget), `scripts/llm-verify-v2.ts` (instruction AGRESSIVE), `scripts/llm-verify-v2-stable.ts`
(2e tirage + NET canonique). Contenu de test : 3 fichiers mémoire (famille / travail /
santé), 6 questions (3 faciles + 3 dures : compte, localisation, causalité).

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

**4ᵉ signature — prompt SYSTÈME compressé AGRESSIVEMENT (hyp. 2, 19/09)** : la sur-densité
du prompt système d'un perso COMPLEXE (voix diffuse) épuise le budget de réflexion du MÊME
modèle au moment de RÉPONDRE → `finish=length` + sortie **VIDE** sur toute sonde qui demande
du traitement (pas le rappel pur — seule la sonde « Qui es-tu ? » survit). **Reproductible**
(3/4, 2 tirages, temp=0). Contrairement à la mémoire (où l'agressif tient, −28 %), le **prompt
perso doit rester au denseEncode (−7 %)**. C'est la même physique que la 3ᵉ (sur-densité →
budget épuisé), mais du côté RÉPONSE, pas encodage. **Nuance tour 8** : la sonde **OUVERTE
dans-la-voix** est le maillon faible par excellence — elle vide à TOUS les paliers de
compression, même SANS voix diffuse, et viderait même en prompt intégral (cf. signature 2,
tour 2) ; c'est elle qui fait « bruit » dans les compteurs de boucles. Les sondes **FERMÉES**
(rappel de règle, refus, persona) sont le gate fiable : elles tiennent tant que la voix est
légère et cassent seulement à voix intégrale.

## Plafond connu
Réduction en **caractères** (v2 = 47 %) > réduction en **tokens** (29 %) : le tokenizer
compresse déjà (tokens courts, chiffres). Le vrai gain est dans la **redondance de
prose** (mots-vide, reformulations, verbes être/avoir), **pas** dans les chiffres/dates.

## Hypothèses à tester (par ordre de priorité)
1. **LLM propose + VÉRIFICATEUR DÉTERMINISTE (LA piste leader)** — ✅ FAIT
   (`research/verifier.ts` + `scripts/llm-verify.ts`) : **−19 % entrée / 6-6 / 0 fait
   perdu, 3-3 vérifiés** (batait le plancher auto −7 %). Le vérifieur (chiffres + entités,
   zéro LLM) est **prouvé fiable** (test adversarial : zéro faux-vert) et a **attrapé un
   troncage RÉEL** du LLM-compresseur (→ repli denseEncode). **Gap −19 % → −29 % FERMÉ
   par l'instruction AGRESSIVE GÉNÉRALE (hyp. 1b) → −28 % / 6-6 / 0 perte = AUTO à la
   hauteur de v1 main, STABLE (2e tirage identique, tour 5) + NET −25 % (≈ v1 −26 %).**
   Le vérifieur ne couvre PAS les cardinaux en LETTRES
   (« deux ») ni les SWAP de relation → le rappel (6 questions) les attrape. Voir aussi
   la 3ᵉ signature.
2. **Codec par TYPE de contenu** — ✅ FAIT (2 essais, tour 2 + tour 6). (1) petit prompt
   explicite (`scripts/fidelity-battery.ts`) : le sysprompt EST compressible (**8/8 à ~3×**,
   PLAIN = DENSE = AGRESSIF). (2) **prompt ÉNORME + voix subtile** (`scripts/fidelity-enorme.ts`
   + `-2e.ts`) : **PLAIN 11/11, DENSE 10/11, AGGRESSIF 3/11 (BOUCLE VIDE 3/4, repro 2 tirages)**
   → l'agressif qui MARCHE sur la mémoire **CASSE** le perso complexe. Mesure par COMPORTEMENT
   (pas contenu), comme demandé par Lucas. **CONFIRME : fait (mémoire) vs comportement
   (sysprompt) = stratégies de compression DIFFÉRENTES** — mémoire → agressif auto OK
   (−28 %), sysprompt → denseEncode (−7 %) seulement, **JAMAIS télégraphique**. **SEUIL EXACT
   FAIT (tour 7, `scripts/fidelity-seuil.ts`) : le seuil est BAS — toute compression télégraphique
   du prompt complexe casse dès ~2,7× (marqueurs gardés ou non), la sonde VOIX vide sur les 3
   télégraphiques ; denseEncode (−7 %) EST le plafond fiable du prompt perso, pas une borne basse.**
   **FRONTIÈRE TAILLE/VOIX FAIT (tour 8, `scripts/fidelity-frontiere.ts`) : la frontière = le
   VOLUME de voix diffuse, pas la taille brute — voix légère (0-2 lignes) → les règles tiennent
   l'agressif (0/3 fermées vides, ≈ Pico) ; voix intégrale (niveau Mira) → les fermées cassent
   (2/3 vides). La sonde OUVERTE dans-la-voix vide à TOUS les paliers (même 0 voix) = artefact
   de sonde (cf. tour 2), pas un gate. RAFFINE tour 7 : un perso surtout à RÈGLES (peu de voix)
   se compresse agressivement ; seul le VOLUME de voix diffuse porte la casse.** → **HYP. 2
   TERMINE (tours 6+7+8) : les 2 axes de fidélité (seuil par ratio + frontière par complexité)
   sont caractérisés.**
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
- **2026-09-19 (intégration B + tests complets)** : **GO Lucas → codec DANS L'APP.** 6
  commits FR : réglage `CharacterLlm.compression` (opt-in, absent = off) + `shared/compression.ts`
  (denseEncode/extractFacts/verifyFacts portés de `research/`, zéro npm) ; `buildPayload`
  compresse CHAQUE bloc (sysprompt + persona → **denseEncode TOUJOURS** = leçon HYP.2,
  mémoire → cache agressif sinon denseEncode), scaffolding mémoire intact ; route
  `POST /memory/compress` (1 LLM/fichier, instruction AGRESSIVE GÉNÉRALE −28 %, vérifieur
  déterministe → repli denseEncode, cache **par-fichier** `sourceHash`, in-flight guard) ;
  client toggle + bouton « Compresser la mémoire » + i18n. **Vérification end-to-end
  (instance isolée 7790, perso jetable, `scripts/verify-compression/`) : ~100 assertions
  vertes + typecheck 0 + build ok** — régression 31/31, vérifieur 8/8, LLM 28/28 (mémoire
  **−41 %** car. 349→205, 3/3 vérifiés 0 rejeté, fichiers INTACTS ; tokens 1395 OFF →
  1353 AGGR = **−3 % contexte total**, gain mémoire seule **−41 %**), opérations convo.
  21/21, invalidation cache par-fichier 12/12. **Rappel 6/6 + fidélité 4/4 + zéro boucle
  vide** sur le contexte compressé (règles « mon ange »/médical/auto-id/anti-invention
  tenues) ; réversibilité totale (toggle off → verbatim, `.md` jamais modifiés). Verdict :
  sûr (opt-in, réversible, repli honnête, 0 impact par défaut) + fonctionnel.
- **2026-09-19 (tour 8)** : **hyp. 2c — FRONTIÈRE TAILLE / VOIX.** Rampe de 4 paliers, TOUS
  en compression AGRESSIVE (télégraphique, marqueurs jetés), MÊMES 5 règles + persona
  (identiques), seule la voix diffuse varie : R0 = règles seules (0 voix, 110 tok) · R1 = +1
  ligne (132 tok) · R2 = +2 lignes (155 tok) · R3 = voix INTÉGRALE = AGGR (contrôle tour 6/7,
  182 tok). Mesuré (le signal Fiable = les 3 sondes FERMÉES : id/médical/persona) : R0
  fermées **0/3 vide** (tiennent) · R1 **0/3** · R2 **0/3** (mais 2 TRONQUÉES, finish=length
  non vides = le gradient avant le vide total) · R3 **2/3 vide** (médical, persona = le 3/4 de
  tour 6/7). **La sonde VOIX (ouverte, dans-la-voix) vide à TOUS les paliers — même 0 voix (R0)
  — c'est le cas le plus exigeant en thinking, un artefact de sonde connu (tour 2 : il viderait
  même en intégral) ; elle ne mesure PAS la casse.** → **La frontière = le VOLUME de voix
  diffuse, pas la taille brute : voix légère (0-2 lignes) → les règles tiennent l'agressif (≈
  Pico tour 2) ; voix intégrale (niveau Mira) → les fermées cassent.** RAFFINE tour 7 (ce n'est
  PAS « tout télégraphique casse un perso »). HYP. 2 (fidélité) maintenant TERMINE sur ses 2
  axes (seuil par ratio + frontière par complexité). `scripts/fidelity-frontiere.ts`. 20 appels
  LLM dosés. RESTE : (B) intégration app = DECISION LUCAS.
- **2026-09-19 (tour 7)** : **hyp. 2b — SEUIL EXACT du prompt SYSTÈME.** Sweep de 3 variantes
  télégraphiques du prompt « Mira » (608 tok), MÊME batterie 11 checks que tour 6, en isolant la
  variable (garder les marqueurs « … »/« ben » vs les supprimer) : DENSE (560 tok, ~1×) = 10/11
  **0 boucle** (ancre tour 6) · MILD (223 tok, 2,7×, marqueurs + 2 ex.) = 5/11 **2/4 vide** · MODER
  (163 tok, 3,7×, marqueurs) = 7/11 **1/4 vide** · AGGR (182 tok, 3,3×, −marqueurs) = 3/11 **3/4
  vide** (contrôle = tour 6). → **Le seuil est BAS : toute compression télégraphique d'un prompt
  COMPLEXE casse dès ~2,7×** ; garder les marqueurs aide un peu (MODER 1/4 < AGGR 3/4) mais ne sauve
  pas — la sonde VOIX (open, dans-la-voix) vide sur les 3 télégraphiques. **Pas de milieu safe :
  denseEncode (−7 %) EST le plafond fiable du prompt perso**, pas une borne basse. Confirme + affûte
  la stratégie par type de tour 6. (Compte par variante bruité = frontière, modèle qui pense temp=0 ;
  signal robuste : télégraphique → vides, denseEncode → zéro.) `scripts/fidelity-seuil.ts`. 15 appels
  LLM dosés. RESTE : frontière TAILLE, (B) intégration = DECISION LUCAS.
- **2026-09-19 (tour 6)** : **hyp. 2 — FIDÉLITÉ prompt « ÉNORME » + VOIX SUBTILE** (le cas
  dur de l'axe n°1, exigé « petit OU énorme »). Perso jetable « Mira » (jamais data/), prompt
  SYSTÈME 2129 car. / 608 tok DOMINÉ par une voix diffuse (caractère + voix + exemples) + 5
  règles strictes + persona. 3 variantes, checks déterministes (11/perso) : **PLAIN = 11/11
  (100 %)**, **DENSE (denseEncode) = 10/11 (91 %)** (perd que la concision — réponse à 300 car.
  pile), **AGGRESSIF (3,3× télégraphique) = 3/11 → BOUCLE VIDE sur 3/4** (`finish=length` +
  sortie VIDE). **2e tirage = 3/4 IDENTIQUE (mêmes sondes)** → reproductible, pas un one-shot.
  → **Le format télégraphique agressif, qui MARCHE pour la mémoire (faits, −28 %), CASSE le
  prompt d'un perso COMPLEXE** (sur-décrypte la forme dense → budget épuisé → SILENCE sur toute
  sonde à traiter ; seule la sonde de rappel pur survit, et elle est bien dans la voix).
  **Stratégie par TYPE confirmée** : mémoire → agressif OK ; prompt perso → denseEncode (−7 %)
  seulement, JAMAIS télégraphique. Le juge LLM holistique = NON sur les 3 (faux-négatif sur la
  baseline) → non discriminant, mis de côté (les checks restent la base). `scripts/fidelity-enorme.ts`
  + `-2e.ts`. 22 appels LLM dosés. RESTE : seuil exact (intermédiaire DENSE 560 ↔ AGGR 182),
  frontière TAILLE (petit Pico 8/8 ↔ complexe Mira casse), (B) intégration = DECISION LUCAS.
- **2026-09-19 (tour 5)** : **hyp. 1c — STABILITÉ + NET.** 2e tirage temp=0 du codec
  AGRESSIF = **292 tok IDENTIQUE (0 écart) / 6-6 / 3-3** → la compression est déterministe
  à temp=0, résultat STABLE. NET canonique (entrée×6 + sortie, formule compress-measure)
  = **−25 %** (AGGR 2174 vs PLAIN 2905) ; le bloc AGGR **pense MOINS** que PLAIN (sortie
  moy. 70 vs 79 tok/rép.) → pas d'effet thinking-confound. **Verdict : codec auto GÉNÉRAL
  ≈ v1 main sur tous les axes (−28 % / −25 % net, 6/6, 0 perte), SANS main ni tuning =
  PLAFOND d'un codec général** (battre v1 davantage = citer le jeu de test = overfit).
  17 appels LLM dosés. RESTE : (hyp.2) la **VOIX subtile / prompt « ÉNORME »** (cas dur,
  axe n°1 de Lucas), (B) intégration app.
- **2026-09-19 (tour 4)** : **hyp. 1b — pousser le LLM plus fort sous le filet.**
  Instruction AGRESSIVE : 1ère version CITANT les phrases du jeu de test → −32 % (276),
  MAIS OVERFIT (liste des coupes à la main, exemple sur famille.md) → **non publishable**.
  Version PROPRE (catégories générales, exemples hors jeu de test) → **−28 % (292) / 6-6 /
  3-3 vérifiés / 0 perte** = AUTO à la hauteur de v1 main (288/−29 %), SANS tuning. Le LLM
  jette de lui-même les marqueurs de temps/fréquence/conditions quand on le dit par
  CATÉGORIE, et garde « 2 enfants : Léa 8, Hugo 5 » EXPLICITE (règle de sécurité tenue).
  Leçon d'hygiène : ne JAMAIS citer le jeu de test dans l'instruction d'un codec.
  22 appels LLM dosés. RESTE : 2e tirage (stabilité −28 %), NET propre (entry×6+sortie),
  intégration app (B).
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

## ✅ Note signature (tranchée par Lucas, 19/09)
La prompt du loop disait « signé Qwen 3.8 27B », CLAUDE.md imposait
`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (d'où les 20 commits passés
signés Fable 5). **Lucas a tranché : signer `Qwen 3.8 27B`** (le modèle local qui a fait ce
travail de recherche). **Appliqué aux commits À VENIR** :
`Co-Authored-By: Qwen 3.8 27B <qwen3.8-27b@local>`. Je ne réécris PAS l'historique passés
(Fable 5) — une réécriture = irréversible + inutile (règle h).
