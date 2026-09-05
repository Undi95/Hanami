// Router mémoire : fichiers .md par personnage. Persistance via lib/storage.
// + feature « Ranger » : UN appel LLM restructure la mémoire (backup d'avant,
// plan JSON validé en dur — une réponse moche ne modifie RIEN).
import express, { Router, type Response } from 'express'
import { loadSettings } from '../config'
import {
  MEMORY_FULL_INJECT_LIMIT,
  MEMORY_TOOLLESS_CAP,
  deleteMemoryFile,
  getCharacter,
  listMemory,
  listMemoryBackups,
  readMemoryFile,
  restoreMemoryBackup,
  sanitizeFileName,
  snapshotMemory,
  writeMemoryFile,
} from '../lib/storage'
import { streamChatCompletion } from '../llm/openai'
import type { MemoryFile, Settings } from '../../shared/types'

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

/**
 * Ce que buildMemoryBlock injectera réellement — affiché dans le panneau
 * mémoire (« injecté dans le prompt : tout / index seul / coupé / rien »).
 */
function injectionState(
  files: MemoryFile[],
  settings: Settings,
): { injection: 'none' | 'full' | 'index-only' | 'capped'; totalChars: number } {
  const totalChars = files.filter((f) => f.name !== 'MEMORY.md').reduce((n, f) => n + f.content.length, 0)
  if (!settings.memoryEnabled || totalChars === 0) return { injection: 'none', totalChars }
  if (settings.modelMode === 'simple') {
    return { injection: totalChars <= MEMORY_TOOLLESS_CAP ? 'full' : 'capped', totalChars }
  }
  return { injection: totalChars <= MEMORY_FULL_INJECT_LIMIT ? 'full' : 'index-only', totalChars }
}

memoryRouter.get('/api/characters/:id/memory', (req, res) => {
  try {
    if (!characterExists(req.params.id)) {
      res.status(404).json({ error: `Personnage introuvable : ${req.params.id}` })
      return
    }
    const files = listMemory(req.params.id)
    res.json({ files, ...injectionState(files, loadSettings()) })
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
      '# Remembered moments\n\nPassages pinned from the conversation ("Remember this").\n'
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
        index.replace(/\n*$/, '\n') + '- [Moments](moments.md) — passages pinned from the conversation\n',
      )
    }
    res.json({ ok: true })
  } catch (e) {
    sendError(res, 400, e)
  }
})

// ── Rangement mémoire ─────────────────────────────────────────────────────
// POST /memory/tidy — UN appel LLM : index + tous les fichiers → un JSON
// {index, files[]} validé en dur par le serveur AVANT toute écriture.
// Backup systématique d'avant (memory/backups/<ts>/) : le rangement est
// toujours réversible. Les routes ci-dessous sont déclarées AVANT les routes
// « :name » pour qu'Express ne capture jamais « tidy »/« backups » comme nom.

const TIDY_TIMEOUT_MS = 10 * 60 * 1000 // même ordre que la compaction
const tidyingInFlight = new Set<string>()

const TIDY_SYSTEM =
  "You are reorganizing a character's memory files. You will be given the current index (MEMORY.md) " +
  'and every memory file. Produce a clean, compact version.\n' +
  'Rules:\n' +
  '- One topic per file. Merge files that cover the same topic.\n' +
  '- KEEP EVERY FACT — nothing may be lost. When the same fact appears several times, keep ONE copy ' +
  '(the most complete phrasing).\n' +
  '- Compress: short factual lines, no filler, no meta-commentary, no cross-references between files.\n' +
  '- File names: lowercase, short, underscored, .md. Keep an existing name when its file survives.\n' +
  '- Write each file in the same language its facts were in.\n' +
  '- The index must list every resulting file, one line each, exactly this shape: ' +
  '- [Title](file.md) — a few words.\n\n' +
  'Respond with ONLY a JSON object — no markdown fences, no commentary — in exactly this shape:\n' +
  '{"index": "<full new MEMORY.md content>", "files": [{"name": "topic.md", "content": "<full file content>"}]}\n' +
  'The "files" array must NOT include MEMORY.md.'

function buildTidyUserMessage(index: MemoryFile | undefined, others: MemoryFile[]): string {
  let s = '## Current index (MEMORY.md)\n'
  s += index ? `${index.content.trim()}\n` : '(empty)\n'
  s += '\n## Memory files\n'
  for (const f of others) s += `\n=== ${f.name} ===\n${f.content.trim()}\n`
  s += '\nReorganize all of the above now.'
  return s
}

interface TidyPlan {
  index: string
  files: { name: string; content: string }[]
}

/** Sort le JSON au fond d'une réponse qui peut en être entourée (barres, bavardage). */
function extractTidyJson(raw: string): Record<string, unknown> {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error("Le modèle n'a pas répondu en JSON — rien n'a été modifié")
  }
  try {
    return JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    throw new Error("Le modèle a répondu un JSON illisible — rien n'a été modifié")
  }
}

/** Validation en dur : c'est ICI qu'une réponse moche devient une erreur — jamais des écritures. */
function validateTidyPlan(obj: Record<string, unknown>): TidyPlan {
  const index = typeof obj.index === 'string' ? obj.index.trim() : ''
  if (!index) throw new Error("Réponse du modèle sans index MEMORY.md — rien n'a été modifié")
  if (!Array.isArray(obj.files) || obj.files.length === 0) {
    throw new Error("Réponse du modèle sans aucun fichier — rien n'a été modifié")
  }
  const seen = new Set<string>()
  const files = obj.files.map((entry, i) => {
    const rec = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>
    const name0 = typeof rec.name === 'string' ? rec.name.trim() : ''
    if (!name0) throw new Error(`Réponse du modèle : fichier n°${i + 1} sans nom — rien n'a été modifié`)
    const name = name0.toLowerCase().endsWith('.md') ? name0 : `${name0}.md`
    const safe = sanitizeFileName(name)
    if (safe.toLowerCase() === 'memory.md') {
      throw new Error('Réponse du modèle : MEMORY.md figure dans "files" — rien n\'a été modifié')
    }
    if (seen.has(safe.toLowerCase())) throw new Error(`Réponse du modèle : doublon ${safe} — rien n'a été modifié`)
    seen.add(safe.toLowerCase())
    const content = typeof rec.content === 'string' ? rec.content : ''
    if (!content.trim()) throw new Error(`Réponse du modèle : fichier vide ${safe} — rien n'a été modifié`)
    return { name: safe, content }
  })
  return { index, files }
}

async function tidyMemory(
  charId: string,
): Promise<{ ok: true; before: { files: number; chars: number }; after: { files: number; chars: number }; backup: string }> {
  const settings = loadSettings()
  const files = listMemory(charId)
  const index = files.find((f) => f.name === 'MEMORY.md')
  const others = files.filter((f) => f.name !== 'MEMORY.md')
  const beforeChars = files.reduce((n, f) => n + f.content.length, 0)

  // Même garde-fou que la compaction : prompt + sortie doivent tenir dans la
  // fenêtre, sinon les backends stricts rejettent (ou tronquent par l'avant).
  const window = settings.contextSize > 0 ? settings.contextSize : 32768
  const completionBudget = Math.min(Math.max(settings.maxTokens, 8192), Math.max(1024, Math.floor(window / 3)))
  const userMsg = buildTidyUserMessage(index, others)
  const inputTokens = Math.ceil((TIDY_SYSTEM.length + userMsg.length) / 4) + 512
  if (inputTokens + completionBudget > window) {
    throw new Error(
      `Mémoire trop volumineuse pour un rangement en une passe (≈${Math.round(inputTokens / 1000)} k tokens d'entrée ` +
        `pour une fenêtre de ${window}) — élargissez la fenêtre ou rangez d'abord manuellement`,
    )
  }

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIDY_TIMEOUT_MS)
  timer.unref()
  let raw: string
  try {
    const result = await streamChatCompletion({
      settings: { ...settings, maxTokens: completionBudget },
      messages: [
        { role: 'system', content: TIDY_SYSTEM },
        { role: 'user', content: userMsg },
      ],
      signal: abort.signal,
      onDelta: () => {},
    })
    raw = result.content
  } finally {
    clearTimeout(timer)
  }
  if (!raw.trim()) throw new Error("Le modèle n'a produit aucune réponse")

  const plan = validateTidyPlan(extractTidyJson(raw))

  // Plan validé : snapshot d'avant, puis remplacement intégral (unlinkSync —
  // même nom non-ASCII, même piège Node 25/Windows que deleteMemoryFile).
  const backup = snapshotMemory(charId)
  for (const f of others) deleteMemoryFile(charId, f.name)
  for (const f of plan.files) writeMemoryFile(charId, f.name, f.content)
  writeMemoryFile(charId, 'MEMORY.md', plan.index)
  const after = listMemory(charId)
  return {
    ok: true,
    before: { files: files.length, chars: beforeChars },
    after: { files: after.length, chars: after.reduce((n, f) => n + f.content.length, 0) },
    backup,
  }
}

memoryRouter.post('/api/characters/:id/memory/tidy', async (req, res) => {
  const charId = req.params.id
  if (!characterExists(charId)) {
    res.status(404).json({ error: `Personnage introuvable : ${charId}` })
    return
  }
  if (listMemory(charId).filter((f) => f.name !== 'MEMORY.md').length < 2) {
    res.status(400).json({ error: 'Rien à ranger — il faut au moins 2 fichiers mémoire (hors index)' })
    return
  }
  if (tidyingInFlight.has(charId)) {
    res.status(409).json({ error: 'Un rangement est déjà en cours pour ce personnage' })
    return
  }
  tidyingInFlight.add(charId)
  try {
    res.json(await tidyMemory(charId))
  } catch (e) {
    // Fenêtre trop petite / backend down / JSON invalide → 500, RIEEN n'a été écrit.
    sendError(res, 500, e)
  } finally {
    tidyingInFlight.delete(charId)
  }
})

// GET /memory/backups — liste des snapshots (les plus récents d'abord).
memoryRouter.get('/api/characters/:id/memory/backups', (req, res) => {
  try {
    if (!characterExists(req.params.id)) {
      res.status(404).json({ error: `Personnage introuvable : ${req.params.id}` })
      return
    }
    res.json(listMemoryBackups(req.params.id))
  } catch (e) {
    sendError(res, 500, e)
  }
})

// POST /memory/backups/:name/restore — le snapshot de sécurité de l'état
// courant est pris D'ABORD : les restaurations s'empilent, on ne perd rien.
memoryRouter.post('/api/characters/:id/memory/backups/:name/restore', (req, res) => {
  try {
    if (!characterExists(req.params.id)) {
      res.status(404).json({ error: `Personnage introuvable : ${req.params.id}` })
      return
    }
    const safety = restoreMemoryBackup(req.params.id, req.params.name)
    res.json({ ok: true, restored: req.params.name, backup: safety })
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
