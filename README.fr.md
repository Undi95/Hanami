[English](README.md) | **Français**

# 🌸 Hanami

**Compagnon de chat LLM ultra-léger avec avatar 3D (VRM) — local-first, transparent, mobile.**

Hanami est une alternative minimaliste à SillyTavern, pensée pour une seule chose : discuter
avec un personnage, bien. Pas de macros, pas de 40 menus, pas de magie cachée.

## Principes

1. **Ton prompt, tel quel.** Ce que tu écris dans le system prompt est envoyé au backend
   **sans aucune modification**. Les seules choses que Hanami ajoute sont des blocs que tu peux
   lire toi-même — le bloc mémoire, le résumé de compaction, le bloc de date et d'heure — et le
   bouton 🔍 *Inspecteur* montre l'exact payload de ton prochain message, estimation de tokens
   comprise.
2. **Local-first.** Tout vit dans des fichiers lisibles (`data/`) : personnages, chats, mémoire,
   réglages, préférences d'interface. Pas de base de données, pas de cloud. Les seules requêtes
   sortantes de Hanami vont vers les URL que tu as toi-même configurées (le backend LLM, et le
   serveur TTS si tu l'actives).
3. **Un personnage = un dossier.** `data/characters/<id>/` contient `character.json`,
   `system-prompt.md`, `memory/` et `chats/`. Copiable, partageable, versionnable.
4. **Le serveur retient ton écran.** Langue, thème, mode visual novel, tailles des panneaux,
   cadrage de la caméra, dernier personnage et dernière conversation vivent dans `data/ui.json` :
   ton installation te suit du PC au téléphone au lieu de rester dans un seul navigateur.

## Fonctionnalités

### Conversation

- 💬 Chat en streaming avec n'importe quel backend **compatible OpenAI** (llama.cpp, KoboldCpp,
  Ollama, TabbyAPI, LM Studio, APIs cloud…). *Tester la connexion* liste les modèles annoncés par
  le backend en pastilles cliquables qui remplissent le champ *Modèle* — plus besoin de recopier un
  identifiant exact à la main.
- 📊 **Jauge de contexte** près du titre de la conversation, colorée par palier. 100 % signifie
  « point de compaction atteint » — pas la fenêtre brute du modèle (l'infobulle donne les vrais
  comptes de tokens). Elle est là dès l'ouverture de la conversation (le serveur estime le
  prochain envoi sans rien générer), puis suit l'usage réel du backend.
- 🗜️ **Compaction automatique**, dans l'esprit du `/compact` de Claude Code : quand la jauge
  atteint 100 %, les faits durables sont sauvés en mémoire, puis les anciens messages sont condensés en
  un résumé qui les remplace dans le payload. Le résumé reste visible et **modifiable** dans
  l'inspecteur — le vider annule la compaction. *Compacter maintenant* accepte une instruction
  optionnelle. Le fil affiché, lui, n'est jamais touché.
- 🔍 **Inspecteur de prompt** : prompt système, payload complet, résumé — avec un bouton copier.
- 🧠 **Pensées du modèle** : un modèle qui raisonne à voix haute a droit à un bloc repliable
  au-dessus de sa réponse (option). Le raisonnement n'est jamais renvoyé au backend.
- ♻️ **Régénérer**, **Continuer** (la dernière réponse est prolongée en place), modifier n'importe
  quel message, **répondre à un message** (la citation est écrite en tête de ton envoi — rien de
  caché), **épingler** un message par conversation (un bandeau, purement visuel, jamais dans le
  payload) et **Retiens ça** pour ranger un message dans la mémoire du personnage (`moments.md`).
- 🔎 **Recherche dans la conversation** : Ctrl+F, ou la loupe de la barre au doigt — nombre de
  correspondances, précédente/suivante, Échap pour fermer.
- 🕰️ **Notion du temps** (option) : la date, l'heure et le temps écoulé depuis ton dernier message,
  injectés comme des faits bruts — visibles dans l'inspecteur comme tout le reste.
- 🖼️ **Images** pour les modèles à vision : détection auprès du backend (Ollama), ou forcée, ou
  désactivée. Le trombone n'existe que si le modèle sait vraiment lire une image ; les images sont
  redimensionnées dans le navigateur avant de le quitter, affichées en vignettes, et s'ouvrent en
  plein écran au clic.
- 💬 **Premier message** : plusieurs salutations écrites (une est tirée au hasard), ou le modèle
  ouvre la conversation, ou la question t'est posée à chaque fois.
- 🗣️ **Synthèse vocale** (option) : chaque réponse terminée est lue à voix haute par un serveur TTS
  compatible OpenAI. *Tester* rapporte ce que le serveur annonce et liste ses voix en pastilles
  cliquables ; *Réécouter* rejoue une réplique. Pendant la lecture, c'est l'audio qui pilote les
  lèvres.
- 💌 **Messages spontanés** (opt-in) : pendant ton absence, le personnage écrit de lui-même — après
  environ 4 h, puis 10 h, 24 h, 48 h, et enfin un dernier mot compréhensif avant de se taire
  jusqu'à ton retour. Jamais en dehors de la plage horaire que tu fixes.

### L'avatar et l'écran

- 🧍 **Avatar VRM 3D** : idle animé (respiration, clignements), expressions pilotées par le modèle
  via des tags `[happy]`…, lipsync pendant la réponse — dépose tes `.vrm` dans `vrm/`. Glisser pour
  déplacer, molette ou pincement pour zoomer, clic droit pour tourner ; le cadrage est mémorisé par
  personnage **et par mode d'affichage**.
- 💃 **Animations gestuelles (`.vrma`)** : un idle en boucle, un geste joué une fois quand le
  personnage exprime une émotion, et un idle « qui parle » pendant qu'une réponse s'écrit. Le nom du
  fichier dans `vrma/` est toute la configuration — `idle`, les six noms d'émotion (`happy`, `sad`,
  `angry`, `surprised`, `relaxed`, `neutral`), un suffixe `-2`/`-3` pour des variantes tirées au
  hasard, et un préfixe `world-` pour les clips réservés à la scène 3D (allures, arrêts, gestes
  tenus, postures et émotes assises), qui ne sont donc même pas téléchargés ici ; tout autre nom
  est ignoré. La respiration
  et le sway de la tête continuent **par-dessus** l'animation, et le visage reste l'affaire du
  modèle. Les clips livrés avec l'app sont tous librement redistribuables — voir les
  [crédits](#crédits). Interrupteur dans *Réglages > Apparence > Scène*.
- 🏠 **Décor 3D** : une pièce `.glb` de `environments/`, posée autour de l'avatar à la place du fond
  2D — choisie par personnage, avec un sidecar `.json` optionnel pour l'échelle, la rotation, le
  point d'accueil et l'exposition. Interrupteur dans *Réglages > Apparence > Scène*.
- 🚶 **Scène vivante** : le personnage occupe la pièce — il se tourne vers vous, s'y déplace de
  lui-même, s'assoit sur ce qu'il y trouve, et répond assis si vous lui écrivez à ce moment-là. Un
  clic sur le sol l'y envoie, un clic sur un siège l'y assoit, un clic sur lui le fait acquiescer ;
  ses yeux suivent la caméra. Tout décor déposé dans `environments/` est **mesuré automatiquement à
  l'import** (sol praticable, obstacles, assises — voir
  [`environments/README.md`](environments/README.md)) : aucune préparation manuelle, et une
  cinématique inverse pose les pieds sur le sol réel et le bassin sur l'assise réelle, quelle que
  soit sa hauteur. Réservé au grand écran ; interrupteur dans *Réglages > Apparence > Scène*,
  éteint par défaut.
- 🎬 **Mode visual novel** : scène en plein écran, boîte de dialogue avec étiquette de nom, heure de
  la réplique, titre de la conversation et jauge de contexte dans sa bande basse, boîte
  redimensionnable (poignée dans le coin haut-gauche, double-clic pour réinitialiser) et icônes des
  menus en colonne dans le coin haut droit. Échap quitte le mode.
- 🖥️ **Affichage réglable** : la colonne de chat (desktop) et la boîte du mode visual novel se
  redimensionnent à des poignées discrètes ; un double-clic oublie la taille. Un seul bouton ⟲ —
  *Réinitialiser l'affichage* — recadre l'avatar du mode courant et rend aux panneaux leurs tailles
  par défaut.
- 🎨 **Thèmes** : cinq palettes complètes (Sakura, Minuit, Matcha, Braise, Encre) plus **Perso** —
  deux couleurs, tout le shading dérivé d'elles, et un code partageable (`#fond #accent`) à coller
  d'une instance à l'autre. Un personnage peut porter son propre thème, qui prend alors toute
  l'interface tant qu'il est actif.
- 🌄 **Fonds d'écran** : choisis dans `backgrounds/`, et ajoutés directement depuis l'interface
  (png, jpg, webp) — plus besoin d'atteindre l'explorateur de fichiers de la machine serveur.
- 🖼️ **Portrait 2D** : un personnage importé d'une carte SillyTavern garde l'image de la carte, qui
  tient lieu d'avatar tant qu'aucun `.vrm` n'est choisi.

### Mémoire et outils

- 🧠 **Mémoire persistante** : fichiers markdown injectés dans le contexte, plus des outils
  (`memory_save`, `memory_read`, `memory_update`, `memory_delete`) pour que le personnage
  retienne de lui-même — panneau d'édition inclus. `MEMORY.md` sert d'index.
- 🔦 **`chat_search`** : le modèle peut fouiller **toutes** les anciennes conversations avec toi
  (transcripts complets, pas seulement sa mémoire distillée) et citer le passage exact avec sa date.
- 🛠️ **Outils fichiers** optionnels pour le modèle (`list_files`, `read_file`, `write_file`,
  `edit_file`, et `delete_file` derrière un toggle dédié), sandboxés dans un dossier de ton choix.
- 🐣 **Mode du modèle** : *Complet* expose les outils ; *Simple* n'en expose **aucun** — Hanami
  injecte lui-même la mémoire, extrait les faits durables côté serveur lors des compactions, et
  devine l'émotion à partir du texte. Pensé pour les petits modèles, dont le tool-calling est le
  talon d'Achille.

### Conversations, personnages, données

- 🏷️ **Les titres de conversation ont deux états** : automatique (re-rendu dans la langue de
  l'interface) ou voulu par toi (renommage, branche de fork) — un titre voulu n'est jamais traduit.
  Le renommage se fait sur place, au crayon de la liste.
- 🌿 **Fork** : duplique une conversation en une branche indépendante au même passé (résumé de
  compaction compris). L'original n'est jamais touché.
- 💗 **Notre histoire** : une ligne en pied de la liste des conversations — jours ensemble,
  messages, jours de conversation.
- 📥 **Import SillyTavern** : cartes de personnage (PNG V2/V3, les `alternate_greetings` devenant
  des variantes de salutation) et historiques de chat (`.jsonl`).
- 📱 **Mobile/PWA** : interface responsive, installable sur l'écran d'accueil.
- 🔒 Mot de passe optionnel (recommandé si tu exposes Hanami via un tunnel Cloudflare).

## Démarrage

```bash
npm install
npm run dev
```

Ouvre <http://localhost:7788>. Dans ⚙️ *Réglages*, renseigne l'URL de ton backend
(ex. KoboldCpp : `http://127.0.0.1:5001/v1`) et clique *Tester la connexion*.

Sans backend sous la main ? `npm run mock-llm` lance un faux backend compatible OpenAI sur le
port 5199 (`http://127.0.0.1:5199/v1`) : de quoi voir le streaming, les émotions et l'avatar.

### Production

```bash
npm run build
npm start
```

Le serveur écoute sur le port `7788` par défaut ; la variable d'environnement `PORT` permet
d'en changer.

### Outils de mise au point

`devtools/` contient le banc d'essai des animations, celui qui a servi à choisir et régler les
`.vrma` : il rejoue les clips sur un vrai modèle, mesure comment ils s'emboîtent avec l'idle, et
sort des planches d'images qui montrent ce qu'un clip fait vraiment. À lancer pendant que l'app
tourne — double-clic sur `devtools/LANCER-LE-BANC.cmd` sous Windows, `node
devtools/anim-lab/serve.mjs` ailleurs — puis <http://localhost:7799>. Le détail est dans
[`devtools/LISEZMOI.md`](devtools/LISEZMOI.md).

## Réglages

Trois onglets, un seul formulaire — changer d'onglet ne perd rien et n'enregistre rien :

- **Apparence** — langue de l'interface, thème (et les deux couleurs du thème perso).
- **Modèle** — URL du backend, clé API, modèle, images (vision), température, tokens max, longueur
  d'historique, taille de contexte du modèle, mode du modèle, compaction automatique.
- **Fonctions** — notion du temps, pensées, synthèse vocale, messages spontanés, mémoire, outils
  fichiers, dossier sandbox, mot de passe d'accès.

La langue et le thème s'appliquent immédiatement ; tout le reste prend effet à l'enregistrement.

## Langue / Language

- **Interface** : Hanami est livré en français et en anglais. La bascule se fait dans
  ⚙️ *Réglages* — ça ne change que les libellés de l'app, rien d'autre.
- **Le personnage** : il répond dans la langue de **son propre system prompt**. Hanami n'injecte
  jamais de consigne de langue, donc rien n'est imposé : tu veux du français, tu écris le prompt
  en français ; tu veux de l'anglais, tu l'écris en anglais. C'est le prompt qui décide.

## Accès distant & mobile

- `npm run dev` n'écoute que sur `127.0.0.1` (l'outillage Vite n'a rien à faire sur ton réseau).
  Utilise `HOST=0.0.0.0 npm run dev` pour l'ouvrir, ou `npm start`, qui écoute sur le réseau local
  et affiche l'adresse au démarrage : `http://<ip-du-pc>:7788`.
- Depuis l'extérieur : voir [docs/CLOUDFLARE.fr.md](docs/CLOUDFLARE.fr.md) (Cloudflare Tunnel,
  HTTPS gratuit).
- Installation sur téléphone : voir [docs/MOBILE.fr.md](docs/MOBILE.fr.md).

## Confidentialité

- **`data/` n'est jamais committé** (voir `.gitignore`). Tes conversations, tes fichiers mémoire,
  tes prompts édités, tes préférences d'interface et `config.json` — clé d'API et mot de passe
  éventuels compris — restent uniquement sur ton disque.
- **Les modèles VRM, les fonds et les portraits non plus** : `vrm/`, `backgrounds/` et
  `portraits/` sont ignorés par git, sauf leur `README.md`. La plupart des modèles VRoid Hub /
  Booth interdisent la redistribution : chacun apporte les siens.
- **`environments/` et `vrma/` sont suivis VOLONTAIREMENT** : tout le monde doit avoir la même
  scène, donc seuls des assets librement redistribuables y vont. Animations et décors sont crédités
  dans les [crédits](#crédits) ; le détail juridique fichier par fichier est dans `vrma/NOTICE.md`
  et `environments/CREDITS.md`.
- `presets/hana/` est le seul personnage livré avec le dépôt — un exemple écrit pour n'être
  personnel à personne, bilingue, et sans modèle 3D pour que tu lui donnes le tien. Au premier
  lancement, chaque dossier de `presets/` est copié dans `data/characters/` puis plus jamais
  écrasé — éditer ton personnage ne touche donc pas au dépôt, et un `git pull` ne touche pas à ton
  personnage. Tes propres presets restent locaux : tout `presets/` est ignoré par git sauf `hana/`.
- Poser un mot de passe protège toutes les routes `/api/` (hors la connexion elle-même) ; le
  changer révoque les sessions existantes. Les requêtes mutantes venues d'un autre site sont
  refusées.

## Arborescence

```
data/                  # TES données (jamais committées)
  config.json          # réglages
  ui.json              # préférences d'interface (langue, thème, affichage, dernière conversation)
  characters/<id>/     # un dossier par personnage
    character.json     # nom, modèle 3D, portrait, fond, décor, thème, messages d'accueil
    system-prompt.md   # LE prompt — édite-le librement
    memory/            # MEMORY.md (index) + un fait par fichier
    chats/             # un .jsonl par conversation
presets/               # personnages livrés avec l'app (copiés dans data/ au 1er lancement)
vrm/                   # tes modèles .vrm
backgrounds/           # tes fonds d'écran
portraits/             # portraits 2D des cards importées (avatar sans VRM)
environments/          # pièces 3D (.glb) et leurs sidecars de placement optionnels
vrma/                  # animations humanoïdes (.vrma) — libres, livrées avec l'app
vrma/extra/            # clips convertis non retenus — jamais chargés (cf. vrma/README.md)
client/                # front React (Vite)
server/                # serveur Express + API
shared/                # types partagés client/serveur
docs/                  # guides d'accès distant et mobile
scripts/               # mock-llm (faux backend compatible OpenAI)
devtools/              # banc d'essai des animations + diagnostic biomécanique (hors app)
```

## Crédits

Hanami ne serait pas là sans le travail d'autres gens. Tout est réuni ici — **y compris ce
qu'aucune licence n'oblige à citer**, parce qu'un crédit caché n'honore personne.

### Animations

- **[Overte](https://github.com/overte-org/overte)** — *Apache-2.0*. **109 des 111 clips** de la
  bibliothèque active (plus les 17 clips de réserve de `vrma/extra/`, tous Overte eux aussi), et de
  loin la source principale : **tout le mode face à face** — cinq animations de repos, cinq repos
  « en train de parler », et vingt gestes (`neutral`, `happy` ×3, `sad`, `angry` ×2, `relaxed`
  ×3, `nod` ×5, `shake`, `think` ×2, `raise-hand` ×2) — plus l'intégralité de la locomotion, des
  gestes tenus et des postures assises de la scène 3D : vingt allures, cinq arrêts, pivots, départ,
  changements de posture debout, gestes tenus décomposés en intro-maintien-sortie, et le
  vocabulaire assis complet (maintiens, parole, micro-variations, pivots, accord, désaccord, joie,
  pointage, lever de main). Le **graphe d'animation** d'Overte est livré avec, sous la même licence
  (`vrma/transitions.json`) : 34 machines à états, 165 états, 392 transitions — la logique de
  comportement d'un avatar, déjà résolue. Ce ne sont ni des captures brutes ni du Mixamo recyclé :
  elles ont été **faites à la main dans Maya** par un animateur salarié de High Fidelity, et c'est
  ce soin d'animateur qui se voit — les doigts sont animés, les poses se raccordent entre elles, et
  les boucles se referment.
  Copyright High Fidelity (2013-2019), contributeurs Vircadia (2019-2021), Overte e.V. (2022-2026).

  Hanami reprend aussi d'Overte, **porté en TypeScript**, le cœur de son moteur d'animation de
  personnage : la cinématique inverse à deux os et le pole vector du genou, la table des limites
  articulaires humaines (contraintes swing/twist os par os), le système de regard — saccades, cible
  déplacée pendant le clignement, table de probabilités de conversation —, les jeux de poses de main
  détendue et de poing, et la boîte à outils mathématique qui porte le tout. Les fichiers concernés
  gardent l'avis de copyright d'origine et la mention de modification exigée par l'Apache-2.0 §4(b) ;
  le relevé complet est dans [`NOTICE.md`](NOTICE.md). Auteurs d'origine du code repris :
  Anthony J. Thibault, Andrew Meadows, Angus Antley, Luis Cuenca, Howard Stearns, Seth Alves,
  Stephen Birarda, Mark Peng. Sans eux, ce moteur n'existerait pas.
- **[Quaternius](https://quaternius.com)**, *Universal Animation Library* — *CC0 1.0*, domaine
  public, **aucune attribution requise** : on la donne quand même. Deux clips, la seule famille
  qu'Overte n'a pas : s'asseoir et se lever. Leurs deux extrémités ont été ancrées sur les poses
  voisines pour que la séquence d'assise se referme (voir [`vrma/NOTICE.md`](vrma/NOTICE.md)). Les
  trois temps du saut venaient du même pack : ils ont été **retirés**, faute de raccorder — ni chez
  Quaternius ni chez Overte, dont la phase aérienne n'est pas une animation mais trois poses
  pilotées par le moteur physique.
- **[CMU Graphics Lab Motion Capture Database](https://mocap.cs.cmu.edu)**, conversion BVH
  « Daz-friendly » de **Bruce Hahne / cgspeed** (<https://www.cgspeed.com>). Cette base a fourni
  quinze gestes d'émotion à la première version de la bibliothèque ; **plus aucun fichier n'en
  dérive** — mesurés, ils s'accrochaient tous au retour vers le repos, et six ont été remplacés par
  des animations Overte, neuf retirés (voir [`vrma/NOTICE.md`](vrma/NOTICE.md)). Le crédit reste
  ici parce que le travail a servi, et les remerciements que la base exige avec :

  > The data used in this project was obtained from mocap.cs.cmu.edu.
  > The database was created with funding from NSF EIA-0196217.

### Décors 3D

Trois pièces d'intérieur, toutes en **CC BY 4.0** — la seule licence de ce projet qui *impose*
l'attribution. Via [Sketchfab](https://sketchfab.com) :

- « **Anime Class Room** » par **AnixMoonLight** ([profil](https://sketchfab.com/ani111)) — la salle
  de classe.
- « **Cute Isometric Room ✿** » par **JaDe.Dfr** ([profil](https://sketchfab.com/JaDe.Dfr)) — le
  loft cosy.
- « **Rustic Bedroom** » par **Bársh** ([profil](https://sketchfab.com/borsh_and)) — la chambre
  rustique.

### Police

- **[Mulish](https://github.com/googlefonts/mulish)**, par The Mulish Project Authors — *SIL Open
  Font License 1.1* (texte intégral : `client/public/fonts/OFL-Mulish.txt`). Toute la typographie
  de l'interface. L'OFL n'exige pas d'attribution dans la documentation : on la donne quand même.

### Code

Rien de ce qui suit n'exige d'être cité. Tout y est quand même.

- **[vrm-c/bvh2vrma](https://github.com/vrm-c/bvh2vrma)** — *MIT*, VRM Consortium. Ses convertisseurs
  ont servi de référence pour écrire les nôtres : c'est de là que vient notre compréhension de
  l'écriture de l'extension `VRMC_vrm_animation` et du traitement de la translation du bassin.
- **[three.js](https://threejs.org)** (*MIT*, mrdoob et ses contributeurs) — tout le rendu 3D.
- **[@pixiv/three-vrm](https://github.com/pixiv/three-vrm)** et **@pixiv/three-vrm-animation**
  (*MIT*, pixiv) — le chargement des modèles VRM, le rig humanoïde normalisé et la lecture des
  `.vrma`. Sans eux il n'y a pas d'avatar.
- **[React](https://react.dev)** (*MIT*) — l'interface. **[Express](https://expressjs.com)** (*MIT*,
  TJ Holowaychuk) — le serveur. **[Vite](https://vite.dev)** (*MIT*, Evan You) — le build et le
  serveur de développement. **[TypeScript](https://www.typescriptlang.org)** (*Apache-2.0*,
  Microsoft) et **[tsx](https://github.com/privatenumber/tsx)** (*MIT*, Hiroki Osame) — le langage
  et son exécution directe côté serveur.

Le détail juridique — correspondance fichier par fichier, avis de licence intégraux, mentions à
conserver en cas de redistribution — est dans [`vrma/NOTICE.md`](vrma/NOTICE.md) pour les animations
et [`environments/CREDITS.md`](environments/CREDITS.md) pour les décors. Cette section donne le
crédit ; ces deux fichiers le documentent.

## Licence

AGPL-3.0. Les modèles VRM et les images ne sont pas inclus — respecte la licence de chaque
modèle que tu utilises. Les animations `.vrma` de `vrma/` et les décors de `environments/` portent
leurs propres licences : voir les [crédits](#crédits) ci-dessus.
