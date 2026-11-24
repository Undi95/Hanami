// Tours autonomes : le personnage a des tours À LUI, sur un minuteur réglable
// (Settings.autonomousPaceSeconds). À chaque tour il reçoit une consigne qui
// n'est JAMAIS sauvegardée dans le chat ; il peut agir avec les outils que les
// réglages exposent, écrire un message, ou laisser passer le tour.
//
// Ce que ce premier pas fait, et ne fait pas :
//  - un tour ne se joue QUE si rien n'attend : la conversation active existe,
//    n'est pas vide, et son dernier message n'est pas de l'utilisateur (une
//    vraie réponse est due — c'est le flux normal qui s'en charge, jamais lui) ;
//  - si l'utilisateur écrit pendant un tour, le tour est ABANDONNÉ : un backend
//    local ne sert qu'une génération à la fois, et l'utilisateur passe avant ;
//  - garde anti-flot : après MAX_UNANSWERED messages autonomes de suite restés
//    sans réponse, plus aucun tour ne se joue jusqu'au retour de l'utilisateur ;
//  - un tour passé en silence ne laisse AUCUNE trace dans la conversation —
//    seuls les effets de ses outils restent (mémoire, fichiers). Le personnage
//    ne se souvient donc pas de ses tours silencieux : limite CONNUE de ce
//    premier pas, à lever par un journal d'activité.
//
// AUCUN état supplémentaire sur disque : comme pour les messages spontanés,
// tout se déduit du .jsonl (les messages du moteur portent `autonomous: true`).
import { effectiveSettings, loadSettings } from '../config'
import { buildPayload, cappedTraceResult, runToolLoop, toolNamesOf } from '../api/chat'
import { appendChatMessage, chatMtimeMs, getCharacter, readChat } from './storage'
import { activeTarget } from './spontaneous'
import { streamChatCompletion } from '../llm/openai'
import { createMemorySession } from '../tools/memoryTools'
import { firstEmotionTag } from '../../shared/emotions'
import type { ChatMessage, ToolTrace } from '../../shared/types'

// Le minuteur est relu à chaque battement : un changement du réglage prend
// effet en quelques secondes, sans rien relancer.
const POLL_MS = 5000
// Pendant un tour, la conversation est surveillée à ce rythme : un message de
// l'utilisateur l'interrompt dans la seconde.
const WATCH_MS = 1000
// Garde-fou d'horloge : un backend qui ne répond jamais ne garde pas le verrou.
const TURN_TIMEOUT_MS = 10 * 60_000
const MAX_TOOL_ITERATIONS = 8
/** Messages autonomes de suite sans réponse : au-delà, silence jusqu'au retour. */
export const MAX_UNANSWERED = 3
/** Ce que le personnage répond pour laisser passer son tour. */
export const SILENCE = '(silence)'

// Consigne envoyée dans le payload et JAMAIS sauvegardée dans le chat — même
// statut que les consignes de continuation, d'ouverture ou de message spontané.
const TURN_DIRECTIVE =
  '[This is a turn of your own, not a reply: the user has not written anything new. ' +
  'You may use your tools to do something you care about, write the user one short message if you have something to say, ' +
  'or simply let this turn pass. To let it pass without writing anything, answer exactly: ' +
  SILENCE +
  ']'

/** Ce qu'un appel au moteur a donné — exposé pour les tests et le diagnostic. */
export type TurnOutcome =
  | 'off' // réglage éteint
  | 'busy' // un tour est déjà en cours
  | 'no-target' // pas de conversation active (ou personnage, ou chat, disparu)
  | 'empty' // conversation vide : ouvrir n'est pas l'affaire de ce moteur
  | 'waiting-user' // le dernier message est de l'utilisateur : une réponse est due
  | 'capped' // garde anti-flot atteinte
  | 'silent' // le personnage a laissé passer son tour
  | 'spoke' // il a écrit : message ajouté, marqué `autonomous`
  | 'moved' // la conversation a bougé pendant le tour : rien n'est ajouté
  | 'error' // backend indisponible ou erreur : noté en console, rejoué au tour suivant

// Verrou : un seul tour à la fois (un tour peut durer plus longtemps que le minuteur).
let running = false

/** Le minuteur est-il écoulé depuis la fin du tour précédent ? */
export function isDue(nowMs: number, lastEndMs: number, paceSeconds: number): boolean {
  return nowMs - lastEndMs >= paceSeconds * 1000
}

/**
 * Le personnage a-t-il laissé passer son tour ? Une réponse vide, ou la
 * réponse convenue — tolérée avec une balise d'émotion devant, une autre
 * casse, ou sans ses parenthèses : on ne publie pas « (silence). » comme un message.
 */
export function isSilence(text: string): boolean {
  const core = text
    .trim()
    .replace(/^\[[^\]\n]{1,40}\]\s*/, '')
    .replace(/[\s.!…]+$/, '')
    .toLowerCase()
  return core === '' || core === SILENCE || core === 'silence'
}

/** Nombre de messages autonomes restés SANS RÉPONSE en fin de conversation. */
export function unansweredCount(messages: ChatMessage[]): number {
  let n = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant' || m.autonomous !== true) break
    n++
  }
  return n
}

/**
 * Un tour autonome. Exporté séparément du minuteur pour être appelable
 * directement (tests). Ne lève jamais : une erreur se note dans la console et
 * le tour suivant retentera naturellement.
 */
export async function runAutonomousTurn(): Promise<TurnOutcome> {
  if (!loadSettings().autonomousEnabled) return 'off'
  if (running) return 'busy'
  const target = activeTarget()
  if (!target) return 'no-target'
  const { characterId, chatId } = target
  const character = getCharacter(characterId)
  if (!character) return 'no-target'

  let before: ChatMessage[]
  try {
    before = readChat(characterId, chatId).messages
  } catch {
    return 'no-target' // conversation supprimée ou illisible
  }
  if (before.length === 0) return 'empty'
  const last = before[before.length - 1]
  if (last.role === 'user') return 'waiting-user'
  if (unansweredCount(before) >= MAX_UNANSWERED) return 'capped'

  running = true
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TURN_TIMEOUT_MS)
  timer.unref()
  // Le fichier de la conversation ne bouge pas pendant un tour autonome (ses
  // outils écrivent ailleurs) : s'il bouge, c'est que l'utilisateur est là.
  const startMtime = chatMtimeMs(characterId, chatId)
  let moved = false
  const watch = setInterval(() => {
    if (chatMtimeMs(characterId, chatId) !== startMtime) {
      moved = true
      abort.abort()
    }
  }, WATCH_MS)
  watch.unref()
  try {
    // Réglages EFFECTIFS du personnage (modèle, température… de sa carte), et
    // bloc temporel FORCÉ : un tour à soi sans l'heure n'aurait pas de sens.
    const effective = effectiveSettings(character)
    const { payload } = buildPayload(characterId, chatId, { ...effective, timeAwareness: true }, TURN_DIRECTIVE)
    const tools = payload.tools
    const messages = [...payload.messages]
    const traces: ToolTrace[] = []
    const { last: result } = await runToolLoop(
      characterId,
      effective,
      messages,
      MAX_TOOL_ITERATIONS,
      toolNamesOf(tools),
      createMemorySession(),
      (withTools) =>
        streamChatCompletion({
          settings: effective,
          messages,
          tools: withTools ? tools : undefined,
          signal: abort.signal,
          onDelta: () => {},
        }),
      (name, args, toolResult) => {
        traces.push({ name, args, result: cappedTraceResult(toolResult) })
      },
    )
    const text = result.content.trim()
    if (isSilence(text)) return 'silent'

    // Le tour a duré : on ne colle jamais un message autonome derrière un
    // message arrivé entre-temps.
    let current: ChatMessage[]
    try {
      current = readChat(characterId, chatId).messages
    } catch {
      return 'moved'
    }
    const stillLast = current[current.length - 1]
    if (moved || current.length !== before.length || !stillLast || stillLast.ts !== last.ts) return 'moved'

    const msg: ChatMessage = { role: 'assistant', content: text, ts: new Date().toISOString(), autonomous: true }
    // Même détection qu'à la fin d'une réponse normale (shared/emotions.ts).
    const emotion = firstEmotionTag(text)
    if (emotion) msg.emotion = emotion
    if (result.thinking) msg.thinking = result.thinking
    if (traces.length > 0) msg.tools = traces
    appendChatMessage(characterId, chatId, msg)
    return 'spoke'
  } catch (e) {
    if (moved) return 'moved' // l'abandon voulu n'est pas une erreur
    console.warn('[autonomous]', e instanceof Error ? e.message : String(e))
    return 'error'
  } finally {
    clearInterval(watch)
    clearTimeout(timer)
    running = false
  }
}

/** Démarre le minuteur (appelé après app.listen). */
export function startAutonomous(): void {
  let lastEnd = Date.now()
  let wasEnabled = false
  const poll = setInterval(() => {
    const settings = loadSettings()
    if (!settings.autonomousEnabled) {
      wasEnabled = false
      return
    }
    if (!wasEnabled) {
      // Tout juste allumé : le premier tour vient UN minuteur plus tard, pas tout de suite.
      wasEnabled = true
      lastEnd = Date.now()
      return
    }
    if (running || !isDue(Date.now(), lastEnd, settings.autonomousPaceSeconds)) return
    // Le minuteur court de la FIN d'un tour au début du suivant.
    runAutonomousTurn()
      .catch((e) => console.warn('[autonomous]', e))
      .finally(() => {
        lastEnd = Date.now()
      })
  }, POLL_MS)
  // Le serveur reste vivant par son socket : ce minuteur ne doit pas, à lui
  // seul, retenir le processus à l'arrêt.
  poll.unref()
}
