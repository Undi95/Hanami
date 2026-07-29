// Types partagés client/serveur — LE contrat de l'app.

export interface Settings {
  backendUrl: string // base OpenAI-compat, ex: http://127.0.0.1:5001/v1
  apiKey: string // optionnel (backends locaux : souvent vide)
  model: string // nom du modèle (certains backends l'ignorent)
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
}

export interface CharacterMeta {
  id: string
  name: string
  vrm: string // ex: /vrm/reference.vrm ('' = pas de modèle 3D)
  background: string // ex: /backgrounds/room.png ('' = dégradé par défaut)
  greeting: string // premier message affiché dans un nouveau chat
  createdAt: string
}

export interface CharacterFull extends CharacterMeta {
  systemPrompt: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  ts: string
  emotion?: string // tag d'émotion détecté en tête de message ([happy] etc.)
  thinking?: string // raisonnement du modèle (<think> ou champ reasoning) — jamais renvoyé au backend
}

export interface ChatMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  summary?: string // résumé de compaction (visible dans l'inspecteur, éditable)
  summaryUpto?: number // nombre de messages couverts par le résumé (slice de l'historique envoyé)
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
