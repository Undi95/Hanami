// Types partagés client/serveur — LE contrat de l'app.

// Mode du modèle : 'full' = les outils sont exposés (tool-calling) ; 'simple' =
// AUCUN outil, l'intelligence migre côté serveur — pensé pour les petits modèles,
// dont le tool-calling est le talon d'Achille.
export type ModelMode = 'full' | 'simple'

// Envoi d'images au modèle : 'auto' = détecté auprès du backend (Ollama expose
// les capacités du modèle), 'on' = forcé, 'off' = jamais. En 'off' (ou détection
// négative) le trombone du composer n'existe même pas.
export type VisionMode = 'auto' | 'on' | 'off'

export interface Settings {
  backendUrl: string // base OpenAI-compat, ex: http://127.0.0.1:5001/v1
  apiKey: string // optionnel (backends locaux : souvent vide)
  model: string // nom du modèle (certains backends l'ignorent)
  modelMode: ModelMode // 'simple' : pas d'outils, mémoire et émotions gérées sans le modèle
  temperature: number
  maxTokens: number // max_tokens de la réponse
  maxHistoryMessages: number // nb max de messages d'historique envoyés
  memoryEnabled: boolean // injecte le bloc mémoire + expose les outils mémoire
  fileToolsEnabled: boolean // expose les outils fichiers au modèle
  allowDelete: boolean // autorise delete_file (toggle ON/OFF)
  toolsRoot: string // dossier sandbox des outils fichiers
  password: string // '' = pas d'authentification (usage local)
  contextSize: number // taille de contexte du modèle (tokens) — sert à la jauge et à l'auto-compaction
  autoCompact: boolean // compacte automatiquement la conversation à ~80 % du contexte
  timeAwareness: boolean // injecte date/heure + temps écoulé depuis le dernier message
  showThoughts: boolean // affiche le raisonnement du modèle dans le fil (bloc repliable)
  ttsEnabled: boolean // lit les réponses à voix haute via le serveur TTS
  ttsUrl: string // base OpenAI-compat du serveur TTS (POST {ttsUrl}/audio/speech)
  ttsModel: string // modèle TTS (certains serveurs l'ignorent)
  ttsVoice: string // voix TTS (certains serveurs l'ignorent)
  // Petit « ding » synthétisé à la fin d'une réponse (client/src/sound.ts).
  // Opt-in, et jamais joué quand le TTS lit la réponse : la voix suffit.
  notifySound?: boolean
  spontaneousEnabled: boolean // le personnage écrit de lui-même pendant votre absence
  spontaneousStartHour: number // heure locale à partir de laquelle il peut écrire (0-23)
  spontaneousEndHour: number // heure locale après laquelle il n'écrit plus (0-23)
  visionMode: VisionMode // envoi d'images au modèle (détection auprès du backend par défaut)
}

// Comment s'ouvre une conversation vide : 'written' = une des salutations écrites
// est affichée, 'generated' = le modèle écrit le premier message, 'ask' = le choix
// est proposé à l'ouverture. Champ absent = 'written' (character.json historiques).
export type GreetingMode = 'written' | 'generated' | 'ask'

export interface CharacterMeta {
  id: string
  name: string
  theme?: string // thème de couleurs propre au personnage (absent = thème de l'app)
  vrm: string // ex: /vrm/reference.vrm ('' = pas de modèle 3D)
  // Portrait 2D servi par /portraits — avatar de repli affiché dans la scène
  // TANT QUE `vrm` est vide. Posé par l'import d'une card SillyTavern (le PNG de
  // la card EST l'image). Champ absent = aucune représentation visuelle.
  portrait?: string // ex: /portraits/sakura.png
  background: string // ex: /backgrounds/room.png ('' = dégradé par défaut)
  greeting: string // premier message affiché dans un nouveau chat
  greetings?: string[] // variantes supplémentaires (tirage au hasard avec greeting)
  greetingMode?: GreetingMode // absent = 'written'
  createdAt: string
}

export interface CharacterFull extends CharacterMeta {
  systemPrompt: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string // TOUJOURS le texte seul (les images vivent dans `images`)
  images?: string[] // data URLs (image/jpeg ou png) jointes au message — modèles à vision
  ts: string
  emotion?: string // tag d'émotion détecté en tête de message ([happy] etc.)
  thinking?: string // raisonnement du modèle (<think> ou champ reasoning) — jamais renvoyé au backend
  spontaneous?: true // message écrit à l'initiative du personnage (moteur server/lib/spontaneous.ts)
}

export interface ChatMeta {
  id: string
  title: string
  // Titre à DEUX ÉTATS : absent/false = titre automatique (re-rendu dans la langue
  // de l'interface à partir de createdAt), true = titre voulu par l'utilisateur
  // (renommage, branche de fork) — affiché tel quel, jamais traduit.
  titleCustom?: boolean
  createdAt: string
  updatedAt: string
  messageCount: number
  summary?: string // résumé de compaction (visible dans l'inspecteur, éditable)
  summaryUpto?: number // nombre de messages couverts par le résumé (slice de l'historique envoyé)
  pinned?: number // ordinal du message épinglé — pur affichage, JAMAIS envoyé au backend
}

// Jauge de contexte jointe à l'événement done (estimation, ou usage réel du backend).
export interface ContextInfo {
  tokens: number // tokens du dernier payload envoyé (+ réponse)
  limit: number // taille de contexte configurée (Settings.contextSize)
  percent: number // tokens / limit, arrondi (0 si limit inconnue)
}

export interface MemoryFile {
  name: string // nom de fichier .md (MEMORY.md = index)
  content: string
}

// Événements SSE émis par POST /api/chat
export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; name: string; args: string; result: string }
  | { type: 'done'; message: ChatMessage; context?: ContextInfo }
  | { type: 'error'; message: string; partial?: ChatMessage } // partial = message sauvegardé malgré l'erreur

export const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'relaxed'] as const
export type Emotion = (typeof EMOTIONS)[number]

// ── Préférences d'interface (data/ui.json) ─────────────────────────────────
// L'utilisateur est SEUL sur son serveur : ses réglages d'interface le suivent
// du PC au téléphone. Le serveur fait foi ; le localStorage du client n'en est
// qu'un cache de démarrage. Le token d'accès, lui, reste local (clé par appareil).

/** Cadrage caméra de la scène 3D (position + cible, coordonnées monde) — sérialisable tel quel. */
export interface StageView {
  pos: [number, number, number]
  target: [number, number, number]
}

/** Thème perso : deux couleurs hex (#rrggbb), tout le shading est dérivé en CSS. */
export interface UiCustomTheme {
  bg: string
  accent: string
}

export interface UiPrefs {
  lang?: 'fr' | 'en'
  theme?: string // identifiant de thème préfait, ou 'custom'
  customTheme?: UiCustomTheme
  vnMode?: boolean // mode visual novel
  // Tailles réglées à la poignée (pixels). Clé ABSENTE = taille par défaut de
  // styles.css : l'utilisateur qui n'y touche pas n'a rien dans ui.json, et un
  // double-clic sur la poignée efface la clé (retour au défaut).
  chatPanelWidth?: number // largeur de la colonne de chat (desktop, ≥ 900 px)
  vnBoxWidth?: number // largeur de la boîte de dialogue du mode visual novel
  vnBoxHeight?: number // hauteur de la zone de texte de cette boîte
  activeCharacter?: string // dernier personnage ouvert
  activeChat?: Record<string, string> // dernière conversation ouverte, par personnage
  // Cadrage caméra choisi, par personnage ET par mode d'affichage : clé composée
  // « <charId>::desktop » ou « <charId>::vn » (une clé nue est un reliquat d'avant
  // la séparation par mode — lue en repli côté client, cf. prefs.ts).
  views?: Record<string, StageView>
}

/** Corps du PUT /api/ui : merge superficiel — clé absente = inchangée, `null` = supprimée. */
export type UiPrefsPatch = { [K in keyof UiPrefs]?: UiPrefs[K] | null }
