// Client streaming pour backends OpenAI-compatibles (POST {backendUrl}/chat/completions, SSE).
import { thinkingBudgetParam } from '../../shared/llm'
import { CodedError, ErrorCodes } from '../../shared/errorCodes'
import type { Settings } from '../../shared/types'

/** Erreur réseau courte et lisible (undici cache le vrai motif dans `cause`). */
function netDetail(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  const cause = e instanceof Error ? (e as { cause?: unknown }).cause : undefined
  const detail = cause instanceof Error ? cause.message : ''
  return (detail ? `${message} (${detail})` : message).slice(0, 200)
}

export interface StreamedToolCall {
  id: string
  name: string
  arguments: string
}

export interface StreamChatResult {
  content: string
  thinking: string // raisonnement du modèle (champs reasoning* ou balises <think> inline)
  toolCalls: StreamedToolCall[]
  finishReason: string
  truncated: boolean // fin de flux sans [DONE] ni finish_reason — réponse probablement incomplète
  promptTokens: number // usage.prompt_tokens du backend (0 si non fourni)
}

interface SseDelta {
  content?: unknown
  reasoning?: unknown // Ollama
  reasoning_content?: unknown // DeepSeek, vLLM, LM Studio…
  thinking?: unknown // variante rencontrée sur certains proxys
  tool_calls?: {
    index?: number
    id?: string
    function?: { name?: string; arguments?: string }
  }[]
}

// Certains backends (KoboldCpp…) ne séparent pas le raisonnement : il arrive
// dans content, entre balises <think>…</think> — potentiellement coupées en
// deux chunks. Ce séparateur retient les fins de buffer ambiguës (préfixe de
// balise) jusqu'au chunk suivant.
const THINK_TAGS = ['<think>', '</think>']

function ambiguousTailLength(buffer: string): number {
  const max = Math.min(buffer.length, THINK_TAGS[1].length - 1)
  for (let n = max; n > 0; n--) {
    const tail = buffer.slice(buffer.length - n)
    if (THINK_TAGS.some((tag) => tag.startsWith(tail))) return n
  }
  return 0
}

class ThinkSplitter {
  private buffer = ''
  private inThink = false

  push(text: string): { content: string; thinking: string } {
    this.buffer += text
    let content = ''
    let thinking = ''
    for (;;) {
      const tag = this.inThink ? '</think>' : '<think>'
      const idx = this.buffer.indexOf(tag)
      if (idx === -1) break
      const before = this.buffer.slice(0, idx)
      if (this.inThink) thinking += before
      else content += before
      this.buffer = this.buffer.slice(idx + tag.length)
      this.inThink = !this.inThink
    }
    const held = ambiguousTailLength(this.buffer)
    const emit = this.buffer.slice(0, this.buffer.length - held)
    this.buffer = this.buffer.slice(this.buffer.length - held)
    if (this.inThink) thinking += emit
    else content += emit
    return { content, thinking }
  }

  /** Fin de flux : vide le reliquat (balise jamais refermée = resté du thinking). */
  flush(): { content: string; thinking: string } {
    const out = this.inThink
      ? { content: '', thinking: this.buffer }
      : { content: this.buffer, thinking: '' }
    this.buffer = ''
    return out
  }
}

interface SseChunk {
  choices?: { delta?: SseDelta; finish_reason?: string | null }[]
  usage?: { prompt_tokens?: number } | null
}

export async function streamChatCompletion(opts: {
  settings: Settings
  messages: unknown[]
  tools?: unknown[]
  signal: AbortSignal
  onDelta: (t: string) => void
  onThinking?: (t: string) => void
}): Promise<StreamChatResult> {
  const { settings, messages, tools, signal, onDelta, onThinking } = opts
  const url = settings.backendUrl.replace(/\/+$/, '') + '/chat/completions'

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`

  const body: Record<string, unknown> = {
    messages,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    stream: true,
    // Sans cette option, les backends conformes au contrat OpenAI n'émettent
    // pas l'usage en streaming (la jauge de contexte retomberait sur l'estimation).
    stream_options: { include_usage: true },
  }
  if (settings.model) body.model = settings.model
  // Budget de raisonnement (Qwen3 et consorts via Ollama) : posé seulement quand
  // il est réel — 0 = auto, AUCUN paramètre envoyé, comportement d'origine.
  const think = thinkingBudgetParam(settings.thinkingBudget)
  if (think) body.think = think
  if (tools && tools.length > 0) body.tools = tools

  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    if (res.status === 400 && body.stream_options) {
      // Vieux backend qui rejette le champ inconnu : on retente une fois sans.
      delete body.stream_options
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    }
  } catch (e) {
    // Réseau : Ollama arrêté, URL morte, connexion refusée. (L'AbortError de
    // l'utilisateur est géré plus haut, sur le signal.)
    throw new CodedError(ErrorCodes.llmUnreachable, { detail: netDetail(e) })
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new CodedError(ErrorCodes.llmHttpError, { status: res.status, detail: text.slice(0, 500) })
  }
  if (!res.body) throw new CodedError(ErrorCodes.llmNoBody)

  let content = ''
  let thinking = ''
  const splitter = new ThinkSplitter()
  const toolCalls: StreamedToolCall[] = []
  let currentSlot = -1 // slot du dernier tool_call vu — cible des fragments sans index
  let finishReason = ''
  let done = false
  let parsedChunk = false
  let promptTokens = 0

  const emitContent = (text: string): void => {
    if (!text) return
    content += text
    onDelta(text)
  }
  const emitThinking = (text: string): void => {
    if (!text) return
    thinking += text
    onThinking?.(text)
  }

  const processLine = (rawLine: string): void => {
    // "data:" sans espace accepté (certains backends compat collent le payload).
    if (!rawLine.startsWith('data:')) return
    const payload = rawLine.slice('data:'.length).trim()
    if (payload === '[DONE]') {
      parsedChunk = true
      done = true
      return
    }
    let chunk: SseChunk
    try {
      chunk = JSON.parse(payload) as SseChunk
    } catch {
      return // ligne partielle ou bruit — ignorée
    }
    parsedChunk = true
    // Certains backends joignent l'usage au dernier chunk (souvent sans choices).
    if (typeof chunk.usage?.prompt_tokens === 'number') promptTokens = chunk.usage.prompt_tokens
    const choice = chunk.choices?.[0]
    if (!choice) return
    const delta = choice.delta ?? {}
    // Raisonnement séparé par le backend (Ollama, DeepSeek, vLLM…).
    for (const field of [delta.reasoning, delta.reasoning_content, delta.thinking]) {
      if (typeof field === 'string' && field.length > 0) emitThinking(field)
    }
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      const parts = splitter.push(delta.content)
      emitContent(parts.content)
      emitThinking(parts.thinking)
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        if (typeof tc.index === 'number') {
          // Backend conforme : slot désigné par index.
          while (toolCalls.length <= tc.index) toolCalls.push({ id: '', name: '', arguments: '' })
          currentSlot = tc.index
        } else if (tc.id && (currentSlot < 0 || toolCalls[currentSlot].id !== tc.id)) {
          // Pas d'index mais un id nouveau : on ouvre un nouveau slot.
          toolCalls.push({ id: '', name: '', arguments: '' })
          currentSlot = toolCalls.length - 1
        } else if (currentSlot < 0) {
          // Fragment sans index ni id avant tout slot : slot initial.
          toolCalls.push({ id: '', name: '', arguments: '' })
          currentSlot = 0
        }
        const slot = toolCalls[currentSlot]
        if (tc.id) slot.id = tc.id
        if (tc.function?.name) slot.name = tc.function.name
        if (typeof tc.function?.arguments === 'string') slot.arguments += tc.function.arguments
      }
    }
    if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
      finishReason = choice.finish_reason
    }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let sawRaw = false
  while (!done) {
    const { done: eof, value } = await reader.read()
    if (eof) break
    if (value && value.length > 0) sawRaw = true
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split(/\r?\n/)
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      processLine(part)
      if (done) break
    }
  }
  if (!done && buffer.length > 0) processLine(buffer)
  // Reliquat du séparateur <think> (fin ambiguë retenue, ou balise jamais fermée).
  const rest = splitter.flush()
  emitContent(rest.content)
  emitThinking(rest.thinking)
  if (done) {
    try {
      await reader.cancel()
    } catch {
      /* flux déjà terminé */
    }
  }

  // Du flux brut reçu mais pas un seul chunk SSE exploitable : réponse non-SSE ou corrompue.
  if (sawRaw && !parsedChunk) {
    throw new CodedError(ErrorCodes.llmNoSseChunk)
  }
  // Fin sans [DONE] ni finish_reason : troncature probable, signalée à l'appelant (pas de throw,
  // certains backends compat terminent légitimement sans [DONE] mais avec un finish_reason).
  const truncated = !done && finishReason === ''

  return {
    content,
    thinking,
    toolCalls: toolCalls
      .filter((t) => t.name !== '')
      .map((t, i) => ({ ...t, id: t.id || 'call_fallback_' + i })),
    finishReason,
    truncated,
    promptTokens,
  }
}
