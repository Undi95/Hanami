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
  let finishReason = ''
  let done = false

  const processLine = (rawLine: string): void => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line.startsWith('data: ')) return
    const payload = line.slice('data: '.length).trim()
    if (payload === '[DONE]') {
      done = true
      return
    }
    let chunk: SseChunk
    try {
      chunk = JSON.parse(payload) as SseChunk
    } catch {
      return // ligne partielle ou bruit — ignorée
    }
    const choice = chunk.choices?.[0]
    if (!choice) return
    const delta = choice.delta ?? {}
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      content += delta.content
      onDelta(delta.content)
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const i = typeof tc.index === 'number' ? tc.index : 0
        while (toolCalls.length <= i) toolCalls.push({ id: '', name: '', arguments: '' })
        const slot = toolCalls[i]
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
  while (!done) {
    const { done: eof, value } = await reader.read()
    if (eof) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while (!done && (nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      processLine(line)
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

  return { content, toolCalls: toolCalls.filter((t) => t.name !== ''), finishReason }
}
