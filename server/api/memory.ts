// Router mémoire : fichiers .md par personnage. Persistance via lib/storage.
import express, { Router, type Response } from 'express'
import { deleteMemoryFile, getCharacter, listMemory, readMemoryFile, writeMemoryFile } from '../lib/storage'

export const memoryRouter = Router()
memoryRouter.use(express.json({ limit: '5mb' }))

function sendError(res: Response, status: number, e: unknown): void {
  res.status(status).json({ error: e instanceof Error ? e.message : String(e) })
}

function characterExists(id: string): boolean {
  try {
    return getCharacter(id) !== null
  } catch {
    return false
  }
}

/** Force l'extension .md sur un nom de fichier mémoire. */
function forceMdExtension(name: string): string {
  return name.toLowerCase().endsWith('.md') ? name : `${name}.md`
}

memoryRouter.get('/api/characters/:id/memory', (req, res) => {
  try {
    if (!characterExists(req.params.id)) {
      res.status(404).json({ error: `Personnage introuvable : ${req.params.id}` })
      return
    }
    res.json(listMemory(req.params.id))
  } catch (e) {
    sendError(res, 500, e)
  }
})

memoryRouter.post('/api/characters/:id/memory', (req, res) => {
  try {
    if (!characterExists(req.params.id)) {
      res.status(404).json({ error: `Personnage introuvable : ${req.params.id}` })
      return
    }
    const body = (req.body ?? {}) as Record<string, unknown>
    if (typeof body.name !== 'string' || !body.name.trim()) {
      res.status(400).json({ error: 'Le champ "name" est requis' })
      return
    }
    const content = typeof body.content === 'string' ? body.content : ''
    writeMemoryFile(req.params.id, forceMdExtension(body.name.trim()), content)
    res.json({ ok: true })
  } catch (e) {
    sendError(res, 400, e) // nom invalide (sanitizeFileName) → 400
  }
})

// « Retiens ça » : épingle un passage du fil dans moments.md (+ index MEMORY.md).
// Écriture directe, aucun appel LLM — c'est l'utilisateur qui décide ce qui compte.
memoryRouter.post('/api/characters/:id/memory/remember', (req, res) => {
  try {
    if (!characterExists(req.params.id)) {
      res.status(404).json({ error: `Personnage introuvable : ${req.params.id}` })
      return
    }
    const body = (req.body ?? {}) as Record<string, unknown>
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!text) {
      res.status(400).json({ error: 'Le champ "text" est requis' })
      return
    }
    const charId = req.params.id
    const date = new Date().toISOString().slice(0, 10)
    const existing =
      readMemoryFile(charId, 'moments.md') ??
      '# Moments retenus\n\nPassages épinglés depuis le fil de conversation (« Retiens ça »).\n'
    writeMemoryFile(
      charId,
      'moments.md',
      existing.replace(/\n*$/, '\n') + `\n- **${date}** — ${text.slice(0, 2000)}\n`,
    )
    // Upsert de la ligne d'index (MEMORY.md est injecté à chaque message).
    const index = readMemoryFile(charId, 'MEMORY.md') ?? ''
    if (!index.includes('(moments.md)')) {
      writeMemoryFile(
        charId,
        'MEMORY.md',
        index.replace(/\n*$/, '\n') + '- [Moments](moments.md) — passages épinglés depuis la conversation\n',
      )
    }
    res.json({ ok: true })
  } catch (e) {
    sendError(res, 400, e)
  }
})

memoryRouter.put('/api/characters/:id/memory/:name', (req, res) => {
  try {
    if (!characterExists(req.params.id)) {
      res.status(404).json({ error: `Personnage introuvable : ${req.params.id}` })
      return
    }
    const body = (req.body ?? {}) as Record<string, unknown>
    if (typeof body.content !== 'string') {
      res.status(400).json({ error: 'Le champ "content" est requis' })
      return
    }
    writeMemoryFile(req.params.id, req.params.name, body.content)
    res.json({ ok: true })
  } catch (e) {
    sendError(res, 400, e)
  }
})

memoryRouter.delete('/api/characters/:id/memory/:name', (req, res) => {
  try {
    deleteMemoryFile(req.params.id, req.params.name)
    res.json({ ok: true })
  } catch (e) {
    // storage refuse MEMORY.md (index) → 400 ; nom invalide → 400 aussi.
    sendError(res, 400, e)
  }
})
