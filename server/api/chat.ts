// POST /api/chat — boucle agentique + streaming SSE — et GET /api/prompt-preview.
// TRANSPARENCE TOTALE : le payload envoyé au backend = system prompt du personnage
// + bloc mémoire (si actif) + historique + message user. RIEN d'autre n'est injecté.
// buildPayload est LA source unique, partagée avec /api/prompt-preview.
import { Router } from 'express'
import type { Request, Response } from 'express'
import { loadSettings } from '../config'
import { appendChatMessage, buildMemoryBlock, getCharacter, readChat } from '../lib/storage'
import { streamChatCompletion } from '../llm/openai'
import { MEMORY_TOOL_NAMES, executeMemoryTool, memoryToolDefs } from '../tools/memoryTools'
import { FILE_TOOL_NAMES, executeFileTool, fileToolDefs } from '../tools/fileTools'
import type { ChatEvent, ChatMessage, Settings } from '../../shared/types'

export const chatRouter = Router()

const MAX_TOOL_ITERATIONS = 6
// Non ancrée : première occurrence n'importe où, comme extractEmotion côté client.
const EMOTION_RE = /\[(neutral|happy|sad|angry|surprised|relaxed)\]/i

interface BackendPayload {
  messages: unknown[]
  tools?: unknown[]
  model: string
  temperature: number
  max_tokens: number
}

/** Construit le payload EXACT envoyé au backend (aussi renvoyé tel quel par /api/prompt-preview). */
function buildPayload(
  characterId: string,
  chatId: string,
  settings: Settings,
  pendingUserContent?: string,
): { systemText: string; payload: BackendPayload } {
  const character = getCharacter(characterId)
  if (!character) throw new Error(`Personnage introuvable : ${characterId}`)
  let systemText = character.systemPrompt
  if (settings.memoryEnabled) systemText += buildMemoryBlock(characterId)

  const { messages: history } = readChat(characterId, chatId)
  const recent = settings.maxHistoryMessages > 0 ? history.slice(-settings.maxHistoryMessages) : []
  const messages: unknown[] = [
    { role: 'system', content: systemText },
    ...recent.map((m) => ({ role: m.role, content: m.content })),
  ]
  if (pendingUserContent !== undefined) messages.push({ role: 'user', content: pendingUserContent })

  const tools: unknown[] = [
    ...(settings.memoryEnabled ? memoryToolDefs : []),
    ...(settings.fileToolsEnabled ? fileToolDefs : []),
  ]
  const payload: BackendPayload = {
    messages,
    model: settings.model,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
  }
  if (tools.length > 0) payload.tools = tools
  return { systemText, payload }
}

function toAssistantMessage(text: string): ChatMessage {
  const m = EMOTION_RE.exec(text)
  const msg: ChatMessage = { role: 'assistant', content: text, ts: new Date().toISOString() }
  if (m) msg.emotion = m[1].toLowerCase()
  return msg
}

/** Registre des outils : route l'appel vers mémoire ou fichiers. */
function executeTool(characterId: string, settings: Settings, name: string, rawArgs: string): string {
  let args: Record<string, unknown>
  try {
    args = rawArgs.trim() ? (JSON.parse(rawArgs) as Record<string, unknown>) : {}
  } catch {
    throw new Error(`arguments JSON invalides pour ${name}`)
  }
  if ((MEMORY_TOOL_NAMES as readonly string[]).includes(name)) {
    return executeMemoryTool(characterId, name, args)
  }
  if ((FILE_TOOL_NAMES as readonly string[]).includes(name)) {
    return executeFileTool(settings, name, args)
  }
  throw new Error(`Outil inconnu : ${name}`)
}

function writeEvent(res: Response, ev: ChatEvent): void {
  res.write('data: ' + JSON.stringify(ev) + '\n\n')
}

async function handleChat(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as { characterId?: unknown; chatId?: unknown; content?: unknown }
  const characterId = typeof body.characterId === 'string' ? body.characterId : ''
  const chatId = typeof body.chatId === 'string' ? body.chatId : ''
  const content = typeof body.content === 'string' ? body.content : ''
  if (!characterId || !chatId || !content) {
    res.status(400).json({ error: 'characterId, chatId et content sont requis' })
    return
  }
  const settings = loadSettings()
  if (!getCharacter(characterId)) {
    res.status(404).json({ error: `Personnage introuvable : ${characterId}` })
    return
  }
  try {
    readChat(characterId, chatId)
  } catch {
    res.status(404).json({ error: `Chat introuvable : ${chatId}` })
    return
  }

  // Payload construit AVANT la sauvegarde : le message courant passe par pendingUserContent,
  // sinon il consommerait un slot d'historique (et ne serait jamais envoyé si
  // maxHistoryMessages = 0).
  const { payload } = buildPayload(characterId, chatId, settings, content)
  const messages = payload.messages as Record<string, unknown>[]

  // Le message user est sauvegardé AVANT l'appel backend : il survit à toute erreur en aval.
  appendChatMessage(characterId, chatId, { role: 'user', content, ts: new Date().toISOString() })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const abort = new AbortController()
  // Déconnexion client en plein stream → on coupe l'appel backend.
  // res 'close' + writableEnded, car req 'close' se déclenche dès la fin du body en Node ≥ 15.
  res.on('close', () => {
    if (!res.writableEnded) abort.abort()
  })

  let assistantText = ''

  // Un appel streaming. Entre deux itérations, un séparateur "\n\n" est inséré dans le texte
  // ET émis comme delta : le flux affiché et le texte sauvegardé restent identiques.
  const streamOnce = (withTools: boolean) => {
    let firstDelta = true
    return streamChatCompletion({
      settings,
      messages,
      tools: withTools ? payload.tools : undefined,
      signal: abort.signal,
      onDelta: (text) => {
        if (firstDelta) {
          firstDelta = false
          if (assistantText.length > 0) {
            assistantText += '\n\n'
            writeEvent(res, { type: 'delta', text: '\n\n' })
          }
        }
        assistantText += text
        writeEvent(res, { type: 'delta', text })
      },
    })
  }

  try {
    let truncated = false
    let finishReason = ''
    let pendingTools = false

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const result = await streamOnce(true)
      truncated = result.truncated
      finishReason = result.finishReason
      if (result.toolCalls.length === 0) {
        pendingTools = false
        break
      }
      pendingTools = true

      // Trace fidèle de l'aller-retour outil dans le contexte de la boucle.
      messages.push({
        role: 'assistant',
        content: result.content || null,
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      })
      for (const tc of result.toolCalls) {
        let toolResult: string
        try {
          toolResult = executeTool(characterId, settings, tc.name, tc.arguments)
        } catch (e) {
          toolResult = `Erreur : ${e instanceof Error ? e.message : String(e)}`
        }
        writeEvent(res, { type: 'tool', name: tc.name, args: tc.arguments, result: toolResult })
        messages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult })
      }
    }

    if (pendingTools) {
      // Budget d'itérations épuisé alors que le modèle demande encore des outils :
      // un dernier appel SANS outils pour obtenir la réponse finale.
      const result = await streamOnce(false)
      truncated = result.truncated
      finishReason = result.finishReason
      if (assistantText.length === 0) {
        // Rien à sauvegarder : pas de message vide, pas de done.
        writeEvent(res, { type: 'error', message: "Budget d'outils épuisé sans réponse du modèle" })
        res.end()
        return
      }
    }

    // Contenu INTÉGRAL, tel que généré (le tag d'émotion reste dans le texte).
    const message = toAssistantMessage(assistantText)
    appendChatMessage(characterId, chatId, message)
    writeEvent(res, { type: 'done', message })
    // Signalé APRÈS la sauvegarde et le done : le client affiche la bulle d'erreur discrète.
    if (truncated || finishReason === 'length') {
      writeEvent(res, {
        type: 'error',
        message: truncated
          ? 'Réponse probablement tronquée (flux interrompu avant la fin)'
          : 'Réponse coupée (max_tokens atteint)',
      })
    }
    res.end()
  } catch (e) {
    if (abort.signal.aborted) {
      // Client parti : on sauvegarde le partiel si au moins un delta est arrivé.
      if (assistantText.length > 0) {
        appendChatMessage(characterId, chatId, toAssistantMessage(assistantText))
      }
      try {
        res.end()
      } catch {
        /* socket déjà fermée */
      }
      return
    }
    const message = e instanceof Error ? e.message : String(e)
    if (assistantText.length > 0) {
      // Erreur mi-flux : le partiel déjà affiché côté client est sauvegardé, et joint à l'événement.
      const partial = toAssistantMessage(assistantText)
      appendChatMessage(characterId, chatId, partial)
      writeEvent(res, { type: 'error', message, partial })
    } else {
      writeEvent(res, { type: 'error', message })
    }
    res.end()
  }
}

chatRouter.post('/api/chat', async (req, res) => {
  try {
    await handleChat(req, res)
  } catch (e) {
    // Dernier filet (ne devrait pas arriver : handleChat gère ses erreurs).
    const message = e instanceof Error ? e.message : String(e)
    if (!res.headersSent) {
      res.status(500).json({ error: message })
    } else {
      try {
        writeEvent(res, { type: 'error', message })
        res.end()
      } catch {
        /* connexion fermée */
      }
    }
  }
})

// GET /api/prompt-preview?characterId=&chatId= — MÊME code que POST /api/chat (buildPayload).
chatRouter.get('/api/prompt-preview', (req, res) => {
  const characterId = typeof req.query.characterId === 'string' ? req.query.characterId : ''
  const chatId = typeof req.query.chatId === 'string' ? req.query.chatId : ''
  if (!characterId || !chatId) {
    res.status(400).json({ error: 'characterId et chatId sont requis' })
    return
  }
  try {
    const { systemText, payload } = buildPayload(characterId, chatId, loadSettings())
    res.json({ systemText, payload })
  } catch (e) {
    res.status(404).json({ error: e instanceof Error ? e.message : String(e) })
  }
})
