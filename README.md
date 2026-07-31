**English** | [Français](README.fr.md)

# 🌸 Hanami

**An ultra-light LLM chat companion with a 3D (VRM) avatar — local-first, transparent, mobile-ready.**

Hanami is a minimal alternative to SillyTavern, built around one thing: talking to a
character, and doing it well. No macro language, no forty nested menus, no hidden magic.

## Principles

1. **Your prompt, verbatim.** Whatever you write in the system prompt is sent to the backend
   **unmodified**. The only things Hanami ever appends are blocks you can read yourself — the
   memory block, the compaction summary, the current-time block — and the 🔍 *Prompt inspector*
   shows the exact payload of your next message, token estimate included.
2. **Local-first.** Everything lives in plain, readable files under `data/`: characters, chats,
   memory, settings, interface preferences. No database, no cloud. The only outbound requests
   Hanami makes go to the URLs you configure yourself (the LLM backend, and the TTS server if you
   turn it on).
3. **One character = one folder.** `data/characters/<id>/` holds `character.json`,
   `system-prompt.md`, `memory/` and `chats/`. Copy it, share it, put it under version control.
4. **The server remembers your screen.** Language, theme, visual-novel mode, panel sizes, camera
   framing, last character and last conversation live in `data/ui.json` — so your setup follows you
   from the desktop to the phone instead of staying in one browser.

## Features

### Conversation

- 💬 Streaming chat with any **OpenAI-compatible** backend (llama.cpp, KoboldCpp, Ollama,
  TabbyAPI, LM Studio, cloud APIs…). *Test connection* lists the models the backend announces as
  clickable chips that fill the *Model* field — no more copying an exact id by hand.
- 📊 **Context gauge** next to the conversation title, coloured by tier. 100% means "compaction
  point reached" — not the raw model window (the tooltip shows the real token counts). It is
  there from the moment the conversation opens (the server estimates the next payload without
  generating anything), then follows the backend's real usage.
- 🗜️ **Automatic compaction**, in the spirit of Claude Code's `/compact`: when the gauge reaches
  100%, durable facts are saved to memory, then the older messages are condensed into one
  summary that replaces them in the payload. The summary stays visible and **editable** in the
  inspector — emptying it undoes the compaction. *Compact now* accepts an optional instruction.
  The thread on screen is never touched.
- 🔍 **Prompt inspector**: system prompt, full payload, summary — with a copy button.
- 🧠 **Model thoughts**: a model that reasons out loud gets a collapsible block above its reply
  (optional). The reasoning is never sent back to the backend.
- ♻️ **Regenerate**, **Continue** (the last reply is extended in place), edit any message,
  **reply to one** (the quote is written at the top of what you send — nothing hidden),
  **pin** one message per conversation (a ribbon, purely visual, never in the payload), and
  **Remember this** to file a message into the character's memory (`moments.md`).
- 🔎 **Search the conversation**: Ctrl+F, or the magnifier in the bar for touch — match count,
  previous/next, Esc to close.
- 🕰️ **Sense of time** (optional): the date, the hour and the time elapsed since your last
  message, injected as plain facts — visible in the inspector like everything else.
- 🖼️ **Images** for vision models: detection from the backend (Ollama), or forced, or off. The
  paperclip only exists when the model can actually read an image; pictures are resized in the
  browser before they leave it, shown as thumbnails, and open full screen on click.
- 💬 **First message**: several written greetings (one picked at random), or the model opens the
  conversation, or you are asked which one each time.
- 🗣️ **Text-to-speech** (optional): each finished reply is read out loud through an
  OpenAI-compatible TTS server. *Test* reports what the server announces and lists its voices as
  clickable chips; *Listen again* replays a line. While the audio plays, it drives the lips.
- 💌 **Spontaneous messages** (opt-in): while you are away, the character writes on their own —
  after about 4 h, then 10 h, 24 h, 48 h, and finally one understanding note before going quiet
  until you come back. Never outside the hour range you set.

### The avatar and the screen

- 🧍 **3D VRM avatar**: animated idle (breathing, blinking), expressions driven by the model
  through `[happy]`-style tags, lipsync while it speaks — drop your `.vrm` files into `vrm/`.
  Drag to pan, wheel or pinch to zoom, right-click to rotate; the framing is remembered per
  character **and per display mode**.
- 💃 **Gesture animations (`.vrma`)**: a looping idle, a one-shot gesture when the character
  expresses an emotion, and a talking idle while a reply is being written. The file name in `vrma/`
  is the whole configuration — `idle`, the six emotion names (`happy`, `sad`, `angry`, `surprised`,
  `relaxed`, `neutral`), a `-2`/`-3` suffix for variants picked at random, and a `world-` prefix for
  the clips that belong to the 3D scene only (gaits, stops, held gestures, seated postures and
  emotes) and are therefore never
  even downloaded here; any other name is ignored. Breathing and head sway keep playing **on top** of
  the animation, and the face stays the model's business. The clips shipped with the app are all
  freely redistributable — see the [credits](#credits). Switch in *Settings > Appearance > Scene*.
- 🏠 **3D environment**: a `.glb` room from `environments/`, placed around the avatar instead of the
  2D background — chosen per character, with an optional `.json` sidecar for scale, rotation, spawn
  point and exposure. Switch in *Settings > Appearance > Scene*.
- 🎬 **Visual novel mode**: full-screen scene, a dialogue box with a namebox, the time of the line,
  the conversation title and the context gauge in its lower band, a resizable box (grip in the
  top-left corner, double-click to reset) and the menu icons in a column in the top-right corner.
  Esc leaves the mode.
- 🖥️ **Adjustable layout**: the chat column (desktop) and the visual-novel box are resized by
  discreet grips; a double-click forgets the size. One single ⟲ button — *Reset the layout* —
  re-frames the avatar of the current mode and gives the panels their default sizes back.
- 🎨 **Themes**: five complete palettes (Sakura, Midnight, Matcha, Ember, Ink) plus **Custom** —
  two colours, all the shading derived from them, and a shareable code (`#background #accent`) to
  paste from one instance to another. A character can carry its own theme, which takes over the
  whole interface while it is active.
- 🌄 **Backgrounds**: picked from `backgrounds/`, and added straight from the interface (png, jpg,
  webp) — no need to reach the server's file explorer.
- 🖼️ **2D portrait**: a character imported from a SillyTavern card keeps the card's image, which
  stands in as the avatar until you pick a `.vrm`.

### Memory and tools

- 🧠 **Persistent memory**: markdown files injected into the context, plus tools
  (`memory_save`, `memory_read`, `memory_update`, `memory_delete`) so the character can
  remember on its own — with a built-in editing panel. `MEMORY.md` is the index.
- 🔦 **`chat_search`**: the model can search **all** past conversations with you (full
  transcripts, not just its distilled memory) and quote the exact passage with its date.
- 🛠️ Optional **file tools** for the model (`list_files`, `read_file`, `write_file`,
  `edit_file`, and `delete_file` behind its own dedicated toggle), sandboxed to a folder you pick.
- 🐣 **Model mode**: *Full* exposes the tools; *Simple* exposes **none** — Hanami injects the
  memory itself, extracts the durable facts server-side during compaction, and guesses the emotion
  from the text. Made for small models, whose weak spot is tool calling.

### Conversations, characters, data

- 🏷️ **Conversation titles have two states**: automatic (re-rendered in the interface language) or
  chosen by you (rename, forked branch) — a chosen title is never translated. Renaming happens
  inline, from the pencil in the list.
- 🌿 **Fork**: duplicate a conversation into an independent branch with the same past (compaction
  summary included). The original is never touched.
- 💗 **Our story**: a line at the bottom of the conversation list — days together, messages, days
  of conversation.
- 📥 **SillyTavern import**: character cards (PNG V2/V3, `alternate_greetings` becoming greeting
  variants) and chat logs (`.jsonl`).
- 📱 **Mobile / PWA**: responsive interface, installable on your home screen.
- 🔒 Optional password (recommended if you expose Hanami through a Cloudflare Tunnel).

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

## Settings

Three tabs, one single form — switching tabs neither loses nor saves anything:

- **Appearance** — interface language, theme (and the custom theme's two colours).
- **Model** — backend URL, API key, model, images (vision), temperature, max tokens, history
  length, model context size, model mode, automatic compaction.
- **Features** — sense of time, thoughts, text-to-speech, spontaneous messages, memory, file
  tools, sandbox folder, access password.

Language and theme apply immediately; everything else takes effect when you save.

## Language / Langue

- **Interface**: Hanami ships in English and French. Switch language in ⚙️ *Settings* — it only
  changes the app's own labels, nothing else.
- **The character**: your character replies in the language of **its own system prompt**. Hanami
  never injects a language instruction, so nothing is imposed: if you want English, write the
  prompt in English; if you want French, write it in French. The prompt decides.

## Remote & mobile access

- `npm run dev` listens on `127.0.0.1` only (the Vite tooling has no business on your network).
  Use `HOST=0.0.0.0 npm run dev` to open it up, or `npm start`, which listens on the LAN and prints
  the address on startup: `http://<pc-ip>:7788`.
- From anywhere else: see [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md) (Cloudflare Tunnel, free HTTPS).
- Installing it on a phone: see [docs/MOBILE.md](docs/MOBILE.md).

## Privacy

- **`data/` is never committed** (see `.gitignore`). Your chats, memory files, edited prompts,
  interface preferences and `config.json` — including the API key and password you may have set —
  stay on your disk only.
- **VRM models, backgrounds and portraits are never committed either**: `vrm/`, `backgrounds/` and
  `portraits/` are git-ignored except for their `README.md`. Most VRoid Hub / Booth models forbid
  redistribution, so each user brings their own.
- **`environments/` and `vrma/` are tracked on purpose**: everybody should get the same scene, so
  only freely redistributable assets go there. Animations and environments are credited in the
  [credits](#credits); the file-by-file legal detail is in `vrma/NOTICE.md` and
  `environments/CREDITS.md`.
- `presets/hana/` is the only character shipped with the repository — an example written to be
  nobody's in particular, bilingual, without a 3D model so that you can give her yours. On first
  launch, every folder in `presets/` is copied into `data/characters/` and never overwritten
  afterwards — so editing your character never touches the repo, and pulling never touches your
  character. Your own presets stay local: everything under `presets/` is git-ignored but `hana/`.
- Setting a password protects every `/api/` route (bar the login itself); changing it revokes the
  existing sessions. Mutating requests coming from another site are refused.

## Project layout

```
data/                  # YOUR data (never committed)
  config.json          # settings
  ui.json              # interface preferences (language, theme, layout, last conversation)
  characters/<id>/     # one folder per character
    character.json     # name, 3D model, portrait, background, environment, theme, greetings
    system-prompt.md   # THE prompt — edit it freely
    memory/            # MEMORY.md (index) + one fact per file
    chats/             # one .jsonl per conversation
presets/               # characters shipped with the app (copied into data/ on first launch)
vrm/                   # your .vrm models
backgrounds/           # your background images
portraits/             # 2D portraits from imported cards (avatar without a VRM)
environments/          # 3D rooms (.glb) and their optional placement sidecars
vrma/                  # humanoid animations (.vrma) — freely licensed, shipped with the app
vrma/extra/            # converted clips that were not kept — never loaded (see vrma/README.md)
client/                # React front-end (Vite)
server/                # Express server + API
shared/                # types shared by client and server
docs/                  # remote access and mobile guides
scripts/               # mock-llm (fake OpenAI-compatible backend)
```

## Credits

Hanami would not exist without other people's work. Everything is gathered here — **including what
no licence obliges us to name**, because a credit that is hidden honours nobody.

### Animations

- **[Overte](https://github.com/overte-org/overte)** — *Apache-2.0*. **107 of the 109 clips** in the
  active library (plus the 19 spare clips in `vrma/extra/`, also all Overte), and by
  far the primary source: **the whole face-to-face mode** — five idle animations, four "talking"
  idles, and nineteen gestures (`neutral`, `happy` ×3, `sad`, `angry` ×2, `relaxed` ×2, `nod` ×5,
  `shake`, `think` ×2, `raise-hand` ×2) — plus all of the 3D scene's locomotion, held gestures and
  seated postures: twenty gaits, five stops, turns, start, standing posture changes, held gestures
  split into intro-hold-outro, and the complete seated vocabulary (holds, talking,
  micro-variations, turns, agreement, disagreement, joy, pointing, raised hand). Overte's
  **animation graph** ships with them under the same licence (`vrma/transitions.json`): 34 state
  machines, 165 states, 392 transitions — an avatar's behaviour logic, already solved. These are
  neither raw capture nor recycled Mixamo: they were **hand-made in Maya** by an animator on staff
  at High Fidelity, and that animator's care is what shows — the fingers are animated, the poses
  join up with each other, and the loops close. Copyright High Fidelity (2013-2019), Vircadia
  contributors (2019-2021), Overte e.V. (2022-2026).
- **[Quaternius](https://quaternius.com)**, *Universal Animation Library* — *CC0 1.0*, public
  domain, **no attribution required**: we give it anyway. Two clips, the one family Overte does not
  have: sitting down and standing up. Both ends of each were anchored onto the neighbouring poses so
  that the seated sequence closes (see [`vrma/NOTICE.md`](vrma/NOTICE.md)). The three beats of a jump
  came from the same pack; they were **removed** for failing to join up — neither Quaternius's nor
  Overte's version does, Overte's airborne phase being three poses driven by the physics engine
  rather than an animation.
- **[CMU Graphics Lab Motion Capture Database](https://mocap.cs.cmu.edu)**, "Daz-friendly" BVH
  conversion by **Bruce Hahne / cgspeed** (<https://www.cgspeed.com>). This database supplied
  fifteen emotion gestures to the library's first version; **no file derives from it any more** —
  measured, every one of them snagged on the way back to the idle, so six were replaced by Overte
  animations and nine removed (see [`vrma/NOTICE.md`](vrma/NOTICE.md)). The credit stays here
  because the work served, and so does the acknowledgement the database requires:

  > The data used in this project was obtained from mocap.cs.cmu.edu.
  > The database was created with funding from NSF EIA-0196217.

### 3D environments

Three interior rooms, all under **CC BY 4.0** — the only licence in this project that *requires*
attribution. Via [Sketchfab](https://sketchfab.com):

- "**Anime Class Room**" by **AnixMoonLight** ([profile](https://sketchfab.com/ani111)) — the
  classroom.
- "**Cute Isometric Room ✿**" by **JaDe.Dfr** ([profile](https://sketchfab.com/JaDe.Dfr)) — the cosy
  loft.
- "**Rustic Bedroom**" by **Bársh** ([profile](https://sketchfab.com/borsh_and)) — the rustic
  bedroom.

### Typeface

- **[Mulish](https://github.com/googlefonts/mulish)**, by The Mulish Project Authors — *SIL Open
  Font License 1.1* (full text: `client/public/fonts/OFL-Mulish.txt`). Every piece of type in the
  interface. The OFL does not require attribution in documentation: we give it anyway.

### Code

None of the following requires being named. All of it is named anyway.

- **[vrm-c/bvh2vrma](https://github.com/vrm-c/bvh2vrma)** — *MIT*, VRM Consortium. Its converters
  were the reference we wrote ours against: our understanding of how to write the
  `VRMC_vrm_animation` extension and how to handle hip translation comes from there.
- **[three.js](https://threejs.org)** (*MIT*, mrdoob and contributors) — all of the 3D rendering.
- **[@pixiv/three-vrm](https://github.com/pixiv/three-vrm)** and **@pixiv/three-vrm-animation**
  (*MIT*, pixiv) — VRM model loading, the normalised humanoid rig and `.vrma` playback. Without them
  there is no avatar.
- **[React](https://react.dev)** (*MIT*) — the interface. **[Express](https://expressjs.com)**
  (*MIT*, TJ Holowaychuk) — the server. **[Vite](https://vite.dev)** (*MIT*, Evan You) — the build
  and the dev server. **[TypeScript](https://www.typescriptlang.org)** (*Apache-2.0*, Microsoft) and
  **[tsx](https://github.com/privatenumber/tsx)** (*MIT*, Hiroki Osame) — the language and running
  it directly on the server.

The legal detail — file-by-file mapping, full licence notices, mentions to preserve when
redistributing — lives in [`vrma/NOTICE.md`](vrma/NOTICE.md) for the animations and
[`environments/CREDITS.md`](environments/CREDITS.md) for the environments. This section gives the
credit; those two files document it.

## License

AGPL-3.0. VRM models and images are not included — respect the license of every model you use. The
`.vrma` animations of `vrma/` and the environments of `environments/` come with their own licences:
see the [credits](#credits) above.
