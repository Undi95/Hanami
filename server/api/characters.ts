// Router personnages : CRUD + chats. Toute la persistance passe par lib/storage.
import express, { Router, type Response } from 'express'
import type { CharacterFull, GreetingMode } from '../../shared/types'
import {
  createCharacter,
  createChat,
  deleteCharacter,
  deleteChat,
  deletePhoto,
  forkChat,
  getCharacter,
  listCharacters,
  listChats,
  readChat,
  savePhoto,
  updateChatHeader,
  updateCharacter,
} from '../lib/storage'
// Même reconnaissance d'image que le dépôt d'un fond : un seul sniff dans l'app.
import { sniffFamily } from './assets'

export const charactersRouter = Router()
charactersRouter.use(express.json({ limit: '5mb' }))

// Garde-fou du renommage : un titre est une ligne d'interface, pas un roman.
const CHAT_TITLE_MAX_CHARS = 200

function sendError(res: Response, status: number, e: unknown): void {
  res.status(status).json({ error: e instanceof Error ? e.message : String(e) })
}

/** Variantes d'accueil d'un corps JSON (les entrées non textuelles sont ignorées). */
function greetingsOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((g): g is string => typeof g === 'string')
}

/** Mode de premier message d'un corps JSON (valeur inconnue → champ ignoré). */
function greetingModeOf(value: unknown): GreetingMode | undefined {
  return value === 'written' || value === 'generated' || value === 'ask' ? value : undefined
}

/** getCharacter sans throw (id invalide → null). */
function findCharacter(id: string): CharacterFull | null {
  try {
    return getCharacter(id)
  } catch {
    return null
  }
}

// ── Personnages ────────────────────────────────────────────────────────────

charactersRouter.get('/api/characters', (_req, res) => {
  try {
    res.json(listCharacters())
  } catch (e) {
    sendError(res, 500, e)
  }
})

charactersRouter.post('/api/characters', (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    if (typeof body.name !== 'string' || !body.name.trim()) {
      res.status(400).json({ error: 'Le champ "name" est requis' })
      return
    }
    const character = createCharacter({
      name: body.name.trim(),
      vrm: typeof body.vrm === 'string' ? body.vrm : undefined,
      background: typeof body.background === 'string' ? body.background : undefined,
      environment: typeof body.environment === 'string' ? body.environment : undefined,
      greeting: typeof body.greeting === 'string' ? body.greeting : undefined,
      greetings: greetingsOf(body.greetings),
      greetingMode: greetingModeOf(body.greetingMode),
      theme: typeof body.theme === 'string' ? body.theme : undefined,
    })
    res.json(character)
  } catch (e) {
    sendError(res, 500, e)
  }
})

charactersRouter.get('/api/characters/:id', (req, res) => {
  try {
    const character = findCharacter(req.params.id)
    if (!character) {
      res.status(404).json({ error: `Personnage introuvable : ${req.params.id}` })
      return
    }
    res.json(character)
  } catch (e) {
    sendError(res, 500, e)
  }
})

charactersRouter.put('/api/characters/:id', (req, res) => {
  try {
    if (!findCharacter(req.params.id)) {
      res.status(404).json({ error: `Personnage introuvable : ${req.params.id}` })
      return
    }
    const body = (req.body ?? {}) as Partial<CharacterFull>
    // Champs d'accueil filtrés : une valeur mal typée est ignorée (le personnage
    // garde les siens) plutôt qu'interprétée comme un effacement.
    const patch: Partial<CharacterFull> = {
      ...body,
      ...(body.greetings !== undefined ? { greetings: greetingsOf(body.greetings) } : {}),
      ...(body.greetingMode !== undefined ? { greetingMode: greetingModeOf(body.greetingMode) } : {}),
    }
    res.json(updateCharacter(req.params.id, patch))
  } catch (e) {
    sendError(res, 500, e)
  }
})

charactersRouter.delete('/api/characters/:id', (req, res) => {
  try {
    if (!findCharacter(req.params.id)) {
      res.status(404).json({ error: `Personnage introuvable : ${req.params.id}` })
      return
    }
    deleteCharacter(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    sendError(res, 500, e)
  }
})

// ── Photo (vignette du personnage) ─────────────────────────────────────────
// Corps BRUT, sans multipart (donc sans dépendance), exactement comme le dépôt
// d'un fond dans api/assets.ts. Le raw n'est branché QUE sur cette route : le
// reste du routeur reste en JSON. Type image/* explicite — un type quelconque
// ouvrirait la route aux requêtes cross-site « simples ».
// Le client envoie déjà un PNG carré de 512 px au plus : 8 Mo est large.

charactersRouter.post(
  '/api/characters/:id/photo',
  express.raw({ type: 'image/*', limit: '8mb' }),
  (req, res) => {
    try {
      if (!findCharacter(req.params.id)) {
        res.status(404).json({ error: `Personnage introuvable : ${req.params.id}` })
        return
      }
      const buf = req.body as unknown
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        res.status(400).json({ error: 'Corps de requête image requis' })
        return
      }
      // Les octets font foi : un Content-Type complaisant ne prouve rien.
      if (!sniffFamily(buf)) {
        res.status(400).json({ error: 'Ce fichier n’est pas une image PNG, JPEG ou WebP' })
        return
      }
      const photo = savePhoto(req.params.id, buf)
      updateCharacter(req.params.id, { photo })
      res.json({ photo })
    } catch (e) {
      sendError(res, 500, e)
    }
  },
)

charactersRouter.delete('/api/characters/:id/photo', (req, res) => {
  try {
    if (!findCharacter(req.params.id)) {
      res.status(404).json({ error: `Personnage introuvable : ${req.params.id}` })
      return
    }
    // La clé d'abord : si l'effacement du fichier échouait après coup, il ne
    // resterait qu'un fichier orphelin — jamais une vignette pointant dans le vide.
    // '' explicite = la clé `photo` disparaît de character.json (photoField).
    updateCharacter(req.params.id, { photo: '' })
    deletePhoto(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    sendError(res, 500, e)
  }
})

// ── Chats ──────────────────────────────────────────────────────────────────

charactersRouter.get('/api/characters/:id/chats', (req, res) => {
  try {
    if (!findCharacter(req.params.id)) {
      res.status(404).json({ error: `Personnage introuvable : ${req.params.id}` })
      return
    }
    res.json(listChats(req.params.id))
  } catch (e) {
    sendError(res, 500, e)
  }
})

charactersRouter.post('/api/characters/:id/chats', (req, res) => {
  try {
    if (!findCharacter(req.params.id)) {
      res.status(404).json({ error: `Personnage introuvable : ${req.params.id}` })
      return
    }
    const body = (req.body ?? {}) as Record<string, unknown>
    const title = typeof body.title === 'string' ? body.title : undefined
    res.json(createChat(req.params.id, title))
  } catch (e) {
    sendError(res, 500, e)
  }
})

charactersRouter.get('/api/characters/:id/chats/:chatId', (req, res) => {
  try {
    res.json(readChat(req.params.id, req.params.chatId))
  } catch {
    // Fichier absent ou id invalide → 404.
    res.status(404).json({ error: `Chat introuvable : ${req.params.chatId}` })
  }
})

// Renommage : le titre devient celui VOULU par l'utilisateur (titleCustom) — il
// ne sera donc plus jamais re-rendu dans la langue de l'interface. Aucun retour
// au titre automatique n'est exposé : le drapeau ne se retire pas.
charactersRouter.put('/api/characters/:id/chats/:chatId', (req, res) => {
  const body = (req.body ?? {}) as { title?: unknown }
  const title = (typeof body.title === 'string' ? body.title.trim() : '').slice(0, CHAT_TITLE_MAX_CHARS).trim()
  if (!title) {
    res.status(400).json({ error: 'Le champ "title" est requis' })
    return
  }
  try {
    updateChatHeader(req.params.id, req.params.chatId, { title, titleCustom: true })
  } catch {
    // Fichier absent, id invalide ou en-tête illisible → 404.
    res.status(404).json({ error: `Chat introuvable : ${req.params.chatId}` })
    return
  }
  res.json({ id: req.params.chatId, title, titleCustom: true })
})

// Fork : la branche part du même passé que l'original, qui reste intact.
charactersRouter.post('/api/characters/:id/chats/:chatId/fork', (req, res) => {
  if (!findCharacter(req.params.id)) {
    res.status(404).json({ error: `Personnage introuvable : ${req.params.id}` })
    return
  }
  // Titre localisé fourni par le client (le serveur ne connaît pas la langue de l'UI).
  const body = (req.body ?? {}) as { title?: unknown }
  const title = typeof body.title === 'string' ? body.title : undefined
  try {
    res.json(forkChat(req.params.id, req.params.chatId, title))
  } catch {
    // Fichier absent, id invalide ou en-tête illisible → 404.
    res.status(404).json({ error: `Chat introuvable : ${req.params.chatId}` })
  }
})

charactersRouter.delete('/api/characters/:id/chats/:chatId', (req, res) => {
  try {
    deleteChat(req.params.id, req.params.chatId)
    res.json({ ok: true })
  } catch (e) {
    sendError(res, 500, e)
  }
})
