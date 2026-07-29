// Router personnages : CRUD + chats. Toute la persistance passe par lib/storage.
import express, { Router, type Response } from 'express'
import type { CharacterFull } from '../../shared/types'
import {
  createCharacter,
  createChat,
  deleteCharacter,
  deleteChat,
  getCharacter,
  listCharacters,
  listChats,
  readChat,
  updateCharacter,
} from '../lib/storage'

export const charactersRouter = Router()
charactersRouter.use(express.json({ limit: '5mb' }))

function sendError(res: Response, status: number, e: unknown): void {
  res.status(status).json({ error: e instanceof Error ? e.message : String(e) })
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
      greeting: typeof body.greeting === 'string' ? body.greeting : undefined,
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
    const patch = (req.body ?? {}) as Partial<CharacterFull>
    res.json(updateCharacter(req.params.id, patch))
  } catch (e) {
    sendError(res, 500, e)
  }
})

charactersRouter.delete('/api/characters/:id', (req, res) => {
  try {
    deleteCharacter(req.params.id)
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

charactersRouter.delete('/api/characters/:id/chats/:chatId', (req, res) => {
  try {
    deleteChat(req.params.id, req.params.chatId)
    res.json({ ok: true })
  } catch (e) {
    sendError(res, 500, e)
  }
})
