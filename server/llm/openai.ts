// Client streaming pour backends OpenAI-compatibles (POST {backendUrl}/chat/completions, SSE).
import type { Settings } from '../../shared/types'

export interface StreamedToolCall {
  id: string
  name: string
  arguments: string
}

export interface StreamChatResult {
  content: string
  toolCalls: StreamedToolCall[]
  finishReason: string
  truncated: boolean // fin de flux sans [DONE] ni finish_reason — réponse probablement incomplète
}

interface SseDelta {
  content?: unknown
  tool_calls?: {
    index?: number
    id?: string
    function?: { name?: string; arguments?: string }
  }[]
}

interface SseChunk {
  choices?: { delta?: SseDelta; finish_reason?: string | null }[]
}

export async function streamChatCompletion(opts: {
  settings: Settings
  messages: unknown[]
  tools?: unknown[]
  signal: AbortSignal
  onDelta: (t: string) => void
}): Promise<StreamChatResult> {
  const { settings, messages, tools, signal, onDelta } = opts
  const url = settings.backendUrl.replace(/\/+$/, '') + '/chat/completions'

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`

  const body: Record<string, unknown> = {
    messages,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    stream: true,
  }
  if (settings.model) body.model = settings.model
  if (tools && tools.length > 0) body.tools = tools

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Backend LLM : HTTP ${res.status} — ${text.slice(0, 500) || '(corps vide)'}`)
  }
  if (!res.body) throw new Error('Backend LLM : réponse sans corps')

  let content = ''
  const toolCalls: StreamedToolCall[] = []
  let currentSlot = -1 // slot du dernier tool_call vu — cible des fragments sans index
  let finishReason = ''
  let done = false
  let parsedChunk = false

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
    const choice = chunk.choices?.[0]
    if (!choice) return
    const delta = choice.delta ?? {}
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      content += delta.content
      onDelta(delta.content)
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
  if (done) {
    try {
      await reader.cancel()
    } catch {
      /* flux déjà terminé */
    }
  }

  // Du flux brut reçu mais pas un seul chunk SSE exploitable : réponse non-SSE ou corrompue.
  if (sawRaw && !parsedChunk) {
    throw new Error('Backend LLM : flux reçu mais aucun chunk SSE exploitable')
  }
  // Fin sans [DONE] ni finish_reason : troncature probable, signalée à l'appelant (pas de throw,
  // certains backends compat terminent légitimement sans [DONE] mais avec un finish_reason).
  const truncated = !done && finishReason === ''

  return {
    content,
    toolCalls: toolCalls
      .filter((t) => t.name !== '')
      .map((t, i) => ({ ...t, id: t.id || 'call_fallback_' + i })),
    finishReason,
    truncated,
  }
}
