// Router statistiques : « notre histoire » — quelques chiffres tendres sur les
// conversations d'un personnage. Lecture seule, aucun appel LLM.
import { Router, type Response } from 'express'
import { getCharacter, listChats, readChat } from '../lib/storage'

/** Chiffres renvoyés par GET /api/characters/:id/stats. */
export interface CharacterStats {
  firstMessageAt: string | null // date du tout premier message (ISO), null si aucun
  totalMessages: number
  totalChats: number
  activeDays: number // jours distincts comptant au moins un message
  daysTogether: number // jours écoulés depuis firstMessageAt (0 si null)
}

export const statsRouter = Router()

function sendError(res: Response, status: number, e: unknown): void {
  res.status(status).json({ error: e instanceof Error ? e.message : String(e) })
}

/** Clé de jour local (YYYY-MM-DD) — le fuseau du serveur fait foi. */
function dayKey(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Nombre de jours entre deux dates, comptés de minuit à minuit (DST neutralisé par l'arrondi). */
function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

function computeStats(charId: string): CharacterStats {
  const chats = listChats(charId)
  const days = new Set<string>()
  let totalMessages = 0
  let firstMs: number | null = null

  for (const chat of chats) {
    let messages
    try {
      // Une seule lecture par .jsonl : tout est dérivé de ce passage.
      messages = readChat(charId, chat.id).messages
    } catch {
      continue // chat supprimé entre le listing et la lecture
    }
    totalMessages += messages.length
    for (const m of messages) {
      const d = new Date(m.ts)
      const ms = d.getTime()
      if (Number.isNaN(ms)) continue // horodatage illisible (import exotique) : compté, mais pas daté
      if (firstMs === null || ms < firstMs) firstMs = ms
      days.add(dayKey(d))
    }
  }

  return {
    firstMessageAt: firstMs === null ? null : new Date(firstMs).toISOString(),
    totalMessages,
    totalChats: chats.length,
    activeDays: days.size,
    daysTogether: firstMs === null ? 0 : daysBetween(new Date(firstMs), new Date()),
  }
}

statsRouter.get('/api/characters/:id/stats', (req, res) => {
  try {
    let exists = false
    try {
      exists = getCharacter(req.params.id) !== null
    } catch {
      exists = false // identifiant invalide → traité comme introuvable
    }
    if (!exists) {
      res.status(404).json({ error: `Personnage introuvable : ${req.params.id}` })
      return
    }
    res.json(computeStats(req.params.id))
  } catch (e) {
    sendError(res, 500, e)
  }
})
