# 🌸 Hanami

**Compagnon de chat LLM ultra-léger avec avatar 3D (VRM) — local-first, transparent, mobile.**

Hanami est une alternative minimaliste à SillyTavern, pensée pour une seule chose : discuter
avec un personnage, bien. Pas de macros, pas de 40 menus, pas de magie cachée.

## Principes

1. **Ton prompt, tel quel.** Ce que tu écris dans le system prompt est envoyé au backend
   **sans aucune modification**. Le bouton 🔍 *Inspecteur* montre l'exact payload envoyé —
   la seule chose que Hanami ajoute (si activée) est le bloc mémoire, et il est affiché.
2. **Local-first.** Tout vit dans des fichiers lisibles (`data/`) : personnages, chats,
   mémoire, réglages. Pas de base de données, pas de cloud. Tes données ne quittent pas ta machine.
3. **Un personnage = un dossier.** `data/characters/<id>/` contient `character.json`,
   `system-prompt.md`, `memory/` et `chats/`. Copiable, partageable, versionnable.

## Fonctionnalités

- 💬 Chat en streaming avec n'importe quel backend **OpenAI-compatible**
  (KoboldCpp, llama.cpp, TabbyAPI, LM Studio, Ollama, APIs cloud…)
- 🧍 **Avatar VRM 3D** : idle animé (respiration, clignements), expressions pilotées par le
  modèle via tags `[happy]`…, lipsync pendant la réponse — dépose tes `.vrm` dans `vrm/`
- 🧠 **Mémoire persistante** : fichiers markdown injectés dans le contexte + outils
  (`memory_save`…) pour que le personnage retienne de lui-même — panneau d'édition inclus
- 🛠️ **Outils fichiers** optionnels pour le modèle (lire/écrire/éditer, suppression derrière
  un toggle dédié), sandboxés dans un dossier de ton choix
- 📥 **Import SillyTavern** : cartes de personnage (PNG V2/V3) et historiques de chat (`.jsonl`)
- 📱 **Mobile/PWA** : interface responsive, installable sur l'écran d'accueil
- 🔒 Mot de passe optionnel (recommandé si exposé via Cloudflare Tunnel)

## Démarrage

```bash
npm install
npm run dev
```

Ouvre <http://localhost:7788>. Dans ⚙️ *Réglages*, renseigne l'URL de ton backend
(ex. KoboldCpp : `http://127.0.0.1:5001/v1`) et clique *Tester la connexion*.

Sans backend sous la main ? `npm run mock-llm` lance un faux backend de test sur le port 5199
(`http://127.0.0.1:5199/v1`).

### Production

```bash
npm run build
npm start
```

## Accès distant & mobile

- Depuis ton réseau local : `http://<ip-du-pc>:7788` (l'IP s'affiche au démarrage).
- Depuis l'extérieur : voir [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md) (Cloudflare Tunnel, HTTPS gratuit).
- Installation sur téléphone : voir [docs/MOBILE.md](docs/MOBILE.md).

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
```

## Licence

AGPL-3.0. Les modèles VRM et les images ne sont pas inclus — respecte la licence de
chaque modèle que tu utilises.
