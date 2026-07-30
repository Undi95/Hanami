// Messages spontanés : le personnage écrit DE LUI-MÊME quand l'utilisateur est
// absent, avec un espacement de plus en plus grand (4 h, 10 h, 24 h, 48 h), puis
// une extinction DOUCE — un dernier message qui dit comprendre l'absence et
// attendre, suivi d'un silence complet jusqu'au retour de l'utilisateur.
//
// AUCUN état supplémentaire sur disque : tout se déduit du .jsonl de la
// conversation active (les messages du moteur portent `spontaneous: true`).
import { loadSettings } from '../config'
import { readUiPrefs } from '../api/ui'
import { buildPayload } from '../api/chat'
import { appendChatMessage, readChat } from './storage'
import { streamChatCompletion } from '../llm/openai'
import type { ChatMessage, Settings } from '../../shared/types'

const HOUR_MS = 3600 * 1000
const TICK_MS = 5 * 60 * 1000 // un tick toutes les ~5 minutes

// Échéancier : temps d'attente (en heures) avant le PROCHAIN message spontané,
// indexé par le nombre de messages spontanés déjà restés sans réponse.
// Le dernier seuil (48 h) déclenche l'extinction douce.
const THRESHOLDS_H = [4, 10, 24, 48]
// Après ce nombre de messages sans réponse, silence total jusqu'au retour.
const MAX_UNANSWERED = THRESHOLDS_H.length
// Jitter tiré à chaque tick (jamais persisté) : le personnage n'écrit pas
// « à l'heure pile », il a son propre rythme.
const JITTER_MS = 30 * 60 * 1000

// Même détection qu'à la fin d'une réponse normale (server/api/chat.ts) :
// première occurrence n'importe où, espaces tolérés.
const EMOTION_RE = /\[\s*(neutral|happy|sad|angry|surprised|relaxed)\s*\]/i

// Consignes envoyées dans le payload et JAMAIS sauvegardées dans le chat —
// même statut que la consigne de continuation ou d'ouverture.
const CHECK_IN_DIRECTIVE =
  '[The user has been away for a while. Write ONE short, natural message on your own initiative — ' +
  'a check-in, a small thought about your day, or something you remembered. Match the time of day. ' +
  'Do not guilt-trip. Vary from your previous unanswered messages.]'

const SOFT_END_DIRECTIVE =
  '[This is your last unprompted message until the user returns. Gently convey that you understand ' +
  'they are busy or away, that there is no pressure, and that you will be here waiting when they come ' +
  'back. Keep it warm and short.]'

// Verrou : une seule génération spontanée à la fois (une génération dure 10-60 s
// sur un backend local, plusieurs ticks peuvent la chevaucher).
let generating = false

/**
 * Heure locale dans la plage autorisée. start < end : plage classique (9→22).
 * start > end : plage à cheval sur minuit (22→6). start === end : aucune
 * restriction (24 h/24).
 */
function withinWindow(now: Date, startHour: number, endHour: number): boolean {
  const h = now.getHours()
  if (startHour === endHour) return true
  if (startHour < endHour) return h >= startHour && h < endHour
  return h >= startHour || h < endHour
}

/** Nombre de messages spontanés restés SANS RÉPONSE en fin de conversation. */
function unansweredCount(messages: ChatMessage[]): number {
  let n = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant' || m.spontaneous !== true) break
    n++
  }
  return n
}

/** Conversation active (personnage + chat) d'après data/ui.json. */
function activeTarget(): { characterId: string; chatId: string } | null {
  const prefs = readUiPrefs()
  const characterId = prefs.activeCharacter
  if (!characterId) return null
  const chatId = prefs.activeChat?.[characterId]
  if (!chatId) return null
  return { characterId, chatId }
}

/** Un appel LLM, SANS outils : pas de boucle agentique pour un message spontané. */
async function generate(
  characterId: string,
  chatId: string,
  settings: Settings,
  directive: string,
): Promise<string> {
  // Bloc temporel FORCÉ : un message spontané sans conscience de l'heure et du
  // temps écoulé n'aurait aucun sens, quel que soit le réglage timeAwareness.
  const { payload } = buildPayload(characterId, chatId, { ...settings, timeAwareness: true }, directive)
  const abort = new AbortController()
  // Garde-fou d'horloge : un backend qui ne répond jamais laisserait le verrou
  // `generating` posé à vie et tuerait le moteur en silence. Aborter un stream
  // déjà terminé est un no-op — pas besoin de clear.
  const timer = setTimeout(() => abort.abort(), 10 * 60_000)
  timer.unref()
  const result = await streamChatCompletion({
    settings,
    messages: payload.messages,
    signal: abort.signal,
    onDelta: () => {},
  })
  return result.content.trim()
}

/**
 * Un tick du moteur. Exporté séparément du démarrage pour être appelable
 * directement (tests). Ne lève jamais : un backend indisponible se note dans la
 * console et l'essai se rejoue naturellement au tick suivant.
 */
export async function runSpontaneousTick(): Promise<void> {
  if (generating) return
  const settings = loadSettings()
  if (!settings.spontaneousEnabled) return
  if (!withinWindow(new Date(), settings.spontaneousStartHour, settings.spontaneousEndHour)) return

  const target = activeTarget()
  if (!target) return
  const { characterId, chatId } = target

  let messages: ChatMessage[]
  try {
    messages = readChat(characterId, chatId).messages
  } catch {
    return // conversation supprimée ou illisible : rien à faire
  }
  if (messages.length === 0) return

  const last = messages[messages.length - 1]
  // Le dernier message est de l'utilisateur : il attend une VRAIE réponse, c'est
  // le flux normal qui s'en charge — jamais le moteur.
  if (last.role === 'user') return

  const unanswered = unansweredCount(messages)
  if (unanswered >= MAX_UNANSWERED) return // l'extinction douce est déjà passée

  const lastTs = Date.parse(last.ts)
  if (!Number.isFinite(lastTs)) return
  const waited = Date.now() - lastTs
  if (waited < THRESHOLDS_H[unanswered] * HOUR_MS + Math.random() * JITTER_MS) return

  generating = true
  try {
    const directive = unanswered === MAX_UNANSWERED - 1 ? SOFT_END_DIRECTIVE : CHECK_IN_DIRECTIVE
    const text = await generate(characterId, chatId, settings, directive)
    if (!text) {
      console.warn('[spontaneous] réponse vide du backend — nouvel essai au prochain tick')
      return
    }
    // La génération a duré : l'utilisateur a pu revenir (ou le fil bouger)
    // entre-temps. On ne colle jamais un message spontané derrière un message
    // arrivé depuis — le personnage a « raté le coche », tant pis.
    let current: ChatMessage[]
    try {
      current = readChat(characterId, chatId).messages
    } catch {
      return
    }
    const stillLast = current[current.length - 1]
    if (current.length !== messages.length || !stillLast || stillLast.ts !== last.ts) return

    const msg: ChatMessage = {
      role: 'assistant',
      content: text,
      ts: new Date().toISOString(),
      spontaneous: true,
    }
    const emotion = EMOTION_RE.exec(text)
    if (emotion) msg.emotion = emotion[1].toLowerCase()
    appendChatMessage(characterId, chatId, msg)
  } catch (e) {
    console.warn('[spontaneous]', e instanceof Error ? e.message : String(e))
  } finally {
    generating = false
  }
}

/** Démarre le tick périodique (appelé après app.listen). */
export function startSpontaneous(): void {
  const timer = setInterval(() => {
    runSpontaneousTick().catch((e) => console.warn('[spontaneous]', e))
  }, TICK_MS)
  // Le serveur reste vivant par son socket : ce timer ne doit pas, à lui seul,
  // retenir le processus à l'arrêt.
  timer.unref()
}
