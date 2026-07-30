// Couche API — tous les appels HTTP du client passent par ici.
// Le token de session (opaque, émis par /api/login) est envoyé en Authorization
// sur toutes les requêtes.
import type {
  CharacterFull,
  CharacterMeta,
  ChatEvent,
  ChatMessage,
  ChatMeta,
  GreetingMode,
  MemoryFile,
  Settings,
  UiPrefs,
  UiPrefsPatch,
} from '../../shared/types'
import { translate as t } from './i18n'

const TOKEN_KEY = 'hanami_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

/** 401 du serveur → l'App affiche l'écran de connexion. */
export class AuthRequiredError extends Error {
  constructor() {
    super(t('authRequired'))
    this.name = 'AuthRequiredError'
  }
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function throwFromResponse(res: Response): Promise<never> {
  if (res.status === 401) throw new AuthRequiredError()
  // Un message d'erreur renvoyé par le serveur est affiché tel quel (jamais traduit).
  let message = t('serverError', { status: res.status })
  try {
    const data = (await res.json()) as { error?: string }
    if (data.error) message = data.error
  } catch {
    /* corps non JSON */
  }
  throw new ApiError(message, res.status)
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(t('serverUnreachable'), 0)
  }
  if (!res.ok) return throwFromResponse(res)
  return (await res.json()) as T
}

/** POST d'un fichier brut (imports PNG / JSONL). */
async function reqRaw<T>(url: string, file: Blob): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
      body: file,
    })
  } catch {
    throw new ApiError(t('serverUnreachable'), 0)
  }
  if (!res.ok) return throwFromResponse(res)
  return (await res.json()) as T
}

// ── Auth ───────────────────────────────────────────────────────────────────

export async function login(password: string): Promise<string> {
  let res: Response
  try {
    res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
  } catch {
    throw new ApiError(t('serverUnreachable'), 0)
  }
  if (res.status === 401) throw new ApiError(t('wrongPassword'), 401)
  if (!res.ok) return throwFromResponse(res)
  const { token } = (await res.json()) as { token: string }
  setToken(token)
  return token
}

// ── Réglages ───────────────────────────────────────────────────────────────

// Le serveur ne renvoie JAMAIS les secrets en clair : password/apiKey arrivent
// vides, accompagnés d'indicateurs de présence. Type local (shared/types.ts intact).
export type SettingsView = Settings & { passwordSet: boolean; apiKeySet: boolean }

// Sentinelle du PUT : '' = secret inchangé, CLEAR_SECRET = secret effacé (contrat serveur).
export const CLEAR_SECRET = '__clear__'

export function getSettings(): Promise<SettingsView> {
  return req('GET', '/api/settings')
}

export function putSettings(patch: Partial<Settings>): Promise<SettingsView> {
  return req('PUT', '/api/settings', patch)
}

export async function getModels(): Promise<string[]> {
  const r = await req<{ models: string[] }>('GET', '/api/settings/models')
  return r.models
}

/** Teste un backend avec des valeurs de formulaire SANS les persister (champs absents = réglages enregistrés). */
export async function testModels(input: { backendUrl?: string; apiKey?: string }): Promise<string[]> {
  const r = await req<{ models: string[] }>('POST', '/api/settings/models', input)
  return r.models
}

/**
 * Le modèle configuré sait-il lire une image ? Réponse du serveur selon le
 * réglage « Images (vision) » : forcé, jamais, ou détecté auprès du backend.
 * Faux dès que le doute existe — le composer ne propose alors aucune image.
 */
export async function getVision(): Promise<boolean> {
  const r = await req<{ vision: boolean }>('GET', '/api/vision')
  return r.vision === true
}

// ── Préférences d'interface ────────────────────────────────────────────────
// Langue, thème, dernier personnage/conversation, cadrages caméra : le serveur
// fait foi (data/ui.json) pour que les réglages suivent l'utilisateur d'un
// appareil à l'autre. Passer par prefs.ts plutôt que d'appeler ceci en direct.

export function getUiPrefs(): Promise<UiPrefs> {
  return req('GET', '/api/ui')
}

/** Merge superficiel côté serveur : clé absente = inchangée, `null` = supprimée. */
export function putUiPrefs(patch: UiPrefsPatch): Promise<UiPrefs> {
  return req('PUT', '/api/ui', patch)
}

// ── Personnages ────────────────────────────────────────────────────────────

export function listCharacters(): Promise<CharacterMeta[]> {
  return req('GET', '/api/characters')
}

export function createCharacter(input: {
  name: string
  vrm?: string
  background?: string
  greeting?: string
  greetings?: string[]
  greetingMode?: GreetingMode
  theme?: string
}): Promise<CharacterFull> {
  return req('POST', '/api/characters', input)
}

export function getCharacter(id: string): Promise<CharacterFull> {
  return req('GET', `/api/characters/${encodeURIComponent(id)}`)
}

export function updateCharacter(id: string, patch: Partial<CharacterFull>): Promise<CharacterFull> {
  return req('PUT', `/api/characters/${encodeURIComponent(id)}`, patch)
}

export function deleteCharacter(id: string): Promise<{ ok: true }> {
  return req('DELETE', `/api/characters/${encodeURIComponent(id)}`)
}

// ── Chats ──────────────────────────────────────────────────────────────────

export function listChats(charId: string): Promise<ChatMeta[]> {
  return req('GET', `/api/characters/${encodeURIComponent(charId)}/chats`)
}

export function createChat(charId: string, title?: string): Promise<ChatMeta> {
  return req('POST', `/api/characters/${encodeURIComponent(charId)}/chats`, title ? { title } : {})
}

export function getChat(charId: string, chatId: string): Promise<{ meta: ChatMeta; messages: ChatMessage[] }> {
  return req('GET', `/api/characters/${encodeURIComponent(charId)}/chats/${encodeURIComponent(chatId)}`)
}

/** Duplique une conversation en une branche indépendante (même passé, nouvel id). */
export function forkChat(charId: string, chatId: string, title?: string): Promise<ChatMeta> {
  return req(
    'POST',
    `/api/characters/${encodeURIComponent(charId)}/chats/${encodeURIComponent(chatId)}/fork`,
    title ? { title } : {},
  )
}

export function deleteChat(charId: string, chatId: string): Promise<{ ok: true }> {
  return req('DELETE', `/api/characters/${encodeURIComponent(charId)}/chats/${encodeURIComponent(chatId)}`)
}

// ── Statistiques ───────────────────────────────────────────────────────────

// Miroir de CharacterStats (server/api/stats.ts) — type local, shared/types.ts intact.
export interface CharacterStats {
  firstMessageAt: string | null
  totalMessages: number
  totalChats: number
  activeDays: number
  daysTogether: number
}

export function getStats(charId: string): Promise<CharacterStats> {
  return req('GET', `/api/characters/${encodeURIComponent(charId)}/stats`)
}

// ── Mémoire ────────────────────────────────────────────────────────────────

export function listMemory(charId: string): Promise<MemoryFile[]> {
  return req('GET', `/api/characters/${encodeURIComponent(charId)}/memory`)
}

export function createMemoryFile(charId: string, name: string, content: string): Promise<{ ok: true }> {
  return req('POST', `/api/characters/${encodeURIComponent(charId)}/memory`, { name, content })
}

export function updateMemoryFile(charId: string, name: string, content: string): Promise<{ ok: true }> {
  return req('PUT', `/api/characters/${encodeURIComponent(charId)}/memory/${encodeURIComponent(name)}`, { content })
}

export function deleteMemoryFile(charId: string, name: string): Promise<{ ok: true }> {
  return req('DELETE', `/api/characters/${encodeURIComponent(charId)}/memory/${encodeURIComponent(name)}`)
}

/** « Retiens ça » : épingle un passage dans la mémoire du personnage (moments.md). */
export function rememberText(charId: string, text: string): Promise<{ ok: true }> {
  return req('POST', `/api/characters/${encodeURIComponent(charId)}/memory/remember`, { text })
}

// ── Imports ────────────────────────────────────────────────────────────────

export function importCard(name: string, file: Blob): Promise<{ character: CharacterMeta }> {
  return reqRaw(`/api/import/card?name=${encodeURIComponent(name)}`, file)
}

export function importChat(
  characterId: string,
  title: string,
  file: Blob,
): Promise<{ chat: ChatMeta; imported: number }> {
  return reqRaw(
    `/api/import/chat?characterId=${encodeURIComponent(characterId)}&title=${encodeURIComponent(title)}`,
    file,
  )
}

// ── Assets ─────────────────────────────────────────────────────────────────

export async function getVrmModels(): Promise<string[]> {
  const r = await req<{ models: string[] }>('GET', '/api/vrm-models')
  return r.models
}

export async function getBackgrounds(): Promise<string[]> {
  const r = await req<{ backgrounds: string[] }>('GET', '/api/backgrounds')
  return r.backgrounds
}

// ── Synthèse vocale ────────────────────────────────────────────────────────

/** Renvoie l'audio de la réponse (le serveur proxifie le serveur TTS configuré). */
export async function tts(text: string): Promise<Blob> {
  let res: Response
  try {
    res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ text }),
    })
  } catch {
    throw new ApiError(t('serverUnreachable'), 0)
  }
  if (!res.ok) return throwFromResponse(res)
  return res.blob()
}

// Miroir de la réponse de GET /api/tts/probe — types locaux, shared/types.ts intact.
export interface TtsVoice {
  id: string
  name: string
}

export interface TtsProbe {
  reachable: boolean
  info?: string
  voices?: TtsVoice[]
}

/**
 * Sonde le serveur TTS : joignable ? quelles voix propose-t-il ? L'URL passée est
 * celle du champ de réglages, éventuellement pas encore enregistrée — elle prime
 * côté serveur sur la configuration.
 */
export function probeTts(url: string): Promise<TtsProbe> {
  return req('GET', `/api/tts/probe?url=${encodeURIComponent(url)}`)
}

// ── Inspecteur de prompt ───────────────────────────────────────────────────

export function getPromptPreview(
  characterId: string,
  chatId: string,
): Promise<{ systemText: string; payload: object; tokens: number; contextSize: number }> {
  return req(
    'GET',
    `/api/prompt-preview?characterId=${encodeURIComponent(characterId)}&chatId=${encodeURIComponent(chatId)}`,
  )
}

// ── Compaction ─────────────────────────────────────────────────────────────

/** Compacte la conversation (passe mémoire + résumé) — instruction optionnelle façon /compact. */
export function compactChat(
  characterId: string,
  chatId: string,
  instruction = '',
): Promise<{ summary: string; summaryUpto: number; compacted: number }> {
  return req('POST', '/api/chat/compact', { characterId, chatId, instruction })
}

/** Édite un message du chat en place (index = position dans le fichier). */
export function editChatMessage(
  characterId: string,
  chatId: string,
  index: number,
  content: string,
): Promise<{ index: number; message: ChatMessage }> {
  return req('PUT', '/api/chat/message', { characterId, chatId, index, content })
}

/** Épingle un message du chat (ordinal) ou le désépingle (null) — pur affichage. */
export function pinChatMessage(
  characterId: string,
  chatId: string,
  pinned: number | null,
): Promise<{ pinned: number | null }> {
  return req('PUT', '/api/chat/pin', { characterId, chatId, pinned })
}

/** Édite le résumé de compaction ('' = annule la compaction). */
export function updateChatSummary(
  characterId: string,
  chatId: string,
  summary: string,
): Promise<{ summary: string; summaryUpto: number }> {
  return req('PUT', '/api/chat/summary', { characterId, chatId, summary })
}

// ── Chat streaming (SSE sur fetch) ─────────────────────────────────────────

/** 'open' = le modèle écrit le premier message d'une conversation vide (refusé si elle ne l'est pas). */
export type ChatMode = 'regenerate' | 'continue' | 'open'

export interface StreamChatOptions {
  characterId: string
  chatId: string
  content?: string // requis en mode normal (sauf si des images l'accompagnent), ignoré en regenerate/continue/open
  images?: string[] // data URLs jointes au message courant (modèles à vision)
  mode?: ChatMode
  signal: AbortSignal
  onEvent: (ev: ChatEvent) => void
}

export async function streamChat(opts: StreamChatOptions): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        characterId: opts.characterId,
        chatId: opts.chatId,
        ...(opts.content !== undefined ? { content: opts.content } : {}),
        ...(opts.images && opts.images.length > 0 ? { images: opts.images } : {}),
        ...(opts.mode ? { mode: opts.mode } : {}),
      }),
      signal: opts.signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(t('serverUnreachable'), 0)
  }
  if (!res.ok) return throwFromResponse(res)
  if (!res.body) throw new ApiError(t('streamUnavailable'), 0)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const emitLines = (chunk: string) => {
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue
      try {
        opts.onEvent(JSON.parse(line.slice(6)) as ChatEvent)
      } catch (e) {
        console.error('[chat] unreadable SSE event', e)
      }
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      emitLines(chunk)
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) emitLines(buffer)
}
