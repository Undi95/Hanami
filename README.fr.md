[English](README.md) | **Français**

# 🌸 Hanami

**Compagnon de chat LLM ultra-léger avec avatar 3D (VRM) — local-first, transparent, mobile.**

Hanami est une alternative minimaliste à SillyTavern, pensée pour une seule chose : discuter
avec un personnage, bien. Pas de macros, pas de 40 menus, pas de magie cachée.

## Principes

1. **Ton prompt, tel quel.** Ce que tu écris dans le system prompt est envoyé au backend
   **sans aucune modification**. Le bouton 🔍 *Inspecteur* montre l'exact payload envoyé — la
   seule chose que Hanami ajoute (si la mémoire est activée) est le bloc mémoire, et il est affiché.
2. **Local-first.** Tout vit dans des fichiers lisibles (`data/`) : personnages, chats, mémoire,
   réglages. Pas de base de données, pas de cloud. Tes données ne quittent pas ta machine — les
   seules requêtes sortantes de Hanami vont vers l'URL de backend que tu as toi-même configurée.
3. **Un personnage = un dossier.** `data/characters/<id>/` contient `character.json`,
   `system-prompt.md`, `memory/` et `chats/`. Copiable, partageable, versionnable.

## Fonctionnalités

- 💬 Chat en streaming avec n'importe quel backend **compatible OpenAI**
  (KoboldCpp, llama.cpp, TabbyAPI, LM Studio, Ollama, APIs cloud…)
- 🧍 **Avatar VRM 3D** : idle animé (respiration, clignements), expressions pilotées par le
  modèle via des tags `[happy]`…, lipsync pendant la réponse — dépose tes `.vrm` dans `vrm/`
- 🧠 **Mémoire persistante** : fichiers markdown injectés dans le contexte, plus des outils
  (`memory_save`, `memory_read`, `memory_update`, `memory_delete`) pour que le personnage
  retienne de lui-même — panneau d'édition inclus
- 🛠️ **Outils fichiers** optionnels pour le modèle (`list_files`, `read_file`, `write_file`,
  `edit_file`, et `delete_file` derrière un toggle dédié), sandboxés dans un dossier de ton choix
- 📥 **Import SillyTavern** : cartes de personnage (PNG V2/V3) et historiques de chat (`.jsonl`)
- 📱 **Mobile/PWA** : interface responsive, installable sur l'écran d'accueil
- 🔒 Mot de passe optionnel (recommandé si tu exposes Hanami via un tunnel Cloudflare)

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

## Langue / Language

- **Interface** : Hanami est livré en français et en anglais. La bascule se fait dans
  ⚙️ *Réglages* — ça ne change que les libellés de l'app, rien d'autre.
- **Le personnage** : il répond dans la langue de **son propre system prompt**. Hanami n'injecte
  jamais de consigne de langue, donc rien n'est imposé : tu veux du français, tu écris le prompt
  en français ; tu veux de l'anglais, tu l'écris en anglais. C'est le prompt qui décide.

## Accès distant & mobile

- Depuis ton réseau local : `http://<ip-du-pc>:7788` (l'IP s'affiche au démarrage).
- Depuis l'extérieur : voir [docs/CLOUDFLARE.fr.md](docs/CLOUDFLARE.fr.md) (Cloudflare Tunnel,
  HTTPS gratuit).
- Installation sur téléphone : voir [docs/MOBILE.fr.md](docs/MOBILE.fr.md).

## Confidentialité

- **`data/` n'est jamais committé** (voir `.gitignore`). Tes conversations, tes fichiers mémoire,
  tes prompts édités et `config.json` — clé d'API et mot de passe éventuels compris — restent
  uniquement sur ton disque.
- **Les modèles VRM et les fonds non plus** : `vrm/` et `backgrounds/` sont ignorés par git, sauf
  leur `README.md`. La plupart des modèles VRoid Hub / Booth interdisent la redistribution :
  chacun apporte les siens.
- `presets/sakura/` est le seul personnage livré avec le dépôt. Au premier lancement, chaque
  dossier de `presets/` est copié dans `data/characters/` puis plus jamais écrasé — éditer ton
  personnage ne touche donc pas au dépôt, et un `git pull` ne touche pas à ton personnage.

## Arborescence

```
data/                  # TES données (jamais committées)
  config.json          # réglages
  characters/<id>/     # un dossier par personnage
    character.json     # nom, modèle 3D, fond, greeting
    system-prompt.md   # LE prompt — édite-le librement
    memory/            # MEMORY.md (index) + un fait par fichier
    chats/             # un .jsonl par conversation
presets/               # personnages livrés avec l'app (copiés dans data/ au 1er lancement)
vrm/                   # tes modèles .vrm
backgrounds/           # tes fonds d'écran
client/                # front React (Vite)
server/                # serveur Express + API
shared/                # types partagés client/serveur
```

## Licence

AGPL-3.0. Les modèles VRM et les images ne sont pas inclus — respecte la licence de chaque
modèle que tu utilises.
