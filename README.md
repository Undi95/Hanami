**English** | [Français](README.fr.md)

# 🌸 Hanami

**An ultra-light LLM chat companion with a 3D (VRM) avatar — local-first, transparent, mobile-ready.**

Hanami is a minimal alternative to SillyTavern, built around one thing: talking to a
character, and doing it well. No macro language, no forty nested menus, no hidden magic.

## Principles

1. **Your prompt, verbatim.** Whatever you write in the system prompt is sent to the backend
   **unmodified**. The 🔍 *Prompt Inspector* shows the exact payload that goes out — the only
   thing Hanami ever adds (when memory is enabled) is the memory block, and it is shown to you.
2. **Local-first.** Everything lives in plain, readable files under `data/`: characters, chats,
   memory, settings. No database, no cloud. Your data never leaves your machine — the only
   outbound requests Hanami makes go to the backend URL you configure yourself.
3. **One character = one folder.** `data/characters/<id>/` holds `character.json`,
   `system-prompt.md`, `memory/` and `chats/`. Copy it, share it, put it under version control.

## Features

- 💬 Streaming chat with any **OpenAI-compatible** backend
  (KoboldCpp, llama.cpp, TabbyAPI, LM Studio, Ollama, cloud APIs…)
- 🧍 **3D VRM avatar**: animated idle (breathing, blinking), expressions driven by the model
  through `[happy]`-style tags, lipsync while it speaks — drop your `.vrm` files into `vrm/`
- 🧠 **Persistent memory**: markdown files injected into the context, plus tools
  (`memory_save`, `memory_read`, `memory_update`, `memory_delete`) so the character can
  remember on its own — with a built-in editing panel
- 🛠️ Optional **file tools** for the model (`list_files`, `read_file`, `write_file`,
  `edit_file`, and `delete_file` behind its own dedicated toggle), sandboxed to a folder you pick
- 📥 **SillyTavern import**: character cards (PNG V2/V3) and chat logs (`.jsonl`)
- 📱 **Mobile / PWA**: responsive interface, installable on your home screen
- 🔒 Optional password (recommended if you expose Hanami through a Cloudflare Tunnel)

## Getting started

```bash
npm install
npm run dev
```

Open <http://localhost:7788>. In ⚙️ *Settings*, fill in your backend URL
(KoboldCpp, for example: `http://127.0.0.1:5001/v1`) and hit *Test connection*.

No backend at hand? `npm run mock-llm` starts a fake OpenAI-compatible backend on port 5199
(`http://127.0.0.1:5199/v1`), enough to see streaming, emotions and the avatar in action.

### Production

```bash
npm run build
npm start
```

The server listens on port `7788` by default; set the `PORT` environment variable to change it.

## Language / Langue

- **Interface**: Hanami ships in English and French. Switch language in ⚙️ *Settings* — it only
  changes the app's own labels, nothing else.
- **The character**: your character replies in the language of **its own system prompt**. Hanami
  never injects a language instruction, so nothing is imposed: if you want English, write the
  prompt in English; if you want French, write it in French. The prompt decides.

## Remote & mobile access

- From your local network: `http://<pc-ip>:7788` (the LAN address is printed on startup).
- From anywhere else: see [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md) (Cloudflare Tunnel, free HTTPS).
- Installing it on a phone: see [docs/MOBILE.md](docs/MOBILE.md).

## Privacy

- **`data/` is never committed** (see `.gitignore`). Your chats, memory files, edited prompts
  and `config.json` — including the API key and password you may have set — stay on your disk only.
- **VRM models and backgrounds are never committed either**: `vrm/` and `backgrounds/` are
  git-ignored except for their `README.md`. Most VRoid Hub / Booth models forbid redistribution,
  so each user brings their own.
- `presets/sakura/` is the only character shipped with the repository. On first launch, every
  folder in `presets/` is copied into `data/characters/` and never overwritten afterwards —
  so editing your character never touches the repo, and pulling never touches your character.

## Project layout

```
data/                  # YOUR data (never committed)
  config.json          # settings
  characters/<id>/     # one folder per character
    character.json     # name, 3D model, background, greeting
    system-prompt.md   # THE prompt — edit it freely
    memory/            # MEMORY.md (index) + one fact per file
    chats/             # one .jsonl per conversation
presets/               # characters shipped with the app (copied into data/ on first launch)
vrm/                   # your .vrm models
backgrounds/           # your background images
portraits/             # 2D portraits from imported cards (avatar without a VRM)
client/                # React front-end (Vite)
server/                # Express server + API
shared/                # types shared by client and server
```

## License

AGPL-3.0. VRM models and images are not included — respect the license of every model you use.
