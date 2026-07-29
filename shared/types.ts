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
  | { type: 'done'; message: ChatMessage }
  | { type: 'error'; message: string; partial?: ChatMessage } // partial = message sauvegardé malgré l'erreur

export const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'relaxed'] as const
export type Emotion = (typeof EMOTIONS)[number]
