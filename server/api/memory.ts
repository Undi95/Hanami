// Router mémoire : fichiers .md par personnage. Persistance via lib/storage.
// + feature « Ranger » : UN appel LLM restructure la mémoire (backup d'avant,
// plan JSON validé en dur — une réponse moche ne modifie RIEN).
import express, { Router, type Response } from 'express'
import { effectiveSettings } from '../config'
import {
  MEMORY_FULL_INJECT_LIMIT,
  MEMORY_TOOLLESS_CAP,
  deleteMemoryFile,
  getCharacter,
  hashMemoryContent,
  listMemory,
  listMemoryBackups,
  readMemoryFile,
  restoreMemoryBackup,
  sanitizeFileName,
  snapshotMemory,
  writeCompressionCache,
  writeMemoryFile,
  type CompressionCacheEntry,
} from '../lib/storage'
import { streamChatCompletion } from '../llm/openai'
import { CodedError, ErrorCodes } from '../../shared/errorCodes'
import { httpError, sendJsonError } from '../lib/errors'
import { denseEncode, verifyFacts } from '../../shared/compression'
import type { MemoryFile, Settings } from '../../shared/types'

export const memoryRouter = Router()
memoryRouter.use(express.json({ limit: '5mb' }))

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
): { injection: 'none' | 'full' | 'selective' | 'index-only' | 'capped'; totalChars: number } {
  const totalChars = files.filter((f) => f.name !== 'MEMORY.md').reduce((n, f) => n + f.content.length, 0)
  if (!settings.memoryEnabled || totalChars === 0) return { injection: 'none', totalChars }
  if (settings.modelMode === 'simple') {
    return { injection: totalChars <= MEMORY_TOOLLESS_CAP ? 'full' : 'capped', totalChars }
  }
  // Sélectif : le panneau n'a pas la requête courante, il ne peut donc que
  // déclarer le MODE (pertinence + budget), pas les fichiers exacts.
  if (settings.memoryInjection === 'selective') {
    return { injection: 'selective', totalChars }
  }
  return { injection: totalChars <= MEMORY_FULL_INJECT_LIMIT ? 'full' : 'index-only', totalChars }
}

memoryRouter.get('/api/characters/:id/memory', (req, res) => {
  try {
    const character = getCharacter(req.params.id)
    if (!character) {
      httpError(res, 404, ErrorCodes.characterNotFound, { id: req.params.id })
      return
    }
    const files = listMemory(req.params.id)
    // L'état d'injection se juge sur le mode du modèle (simple = intégrale
    // plafonnée) : celui du personnage EFFECTIF, pas le global — sinon le
    // panneau annoncerait une injection que le payload ne ferait pas.
    res.json({ files, ...injectionState(files, effectiveSettings(character)) })
  } catch (e) {
    sendJsonError(res, 500, e)
  }
})

memoryRouter.post('/api/characters/:id/memory', (req, res) => {
  try {
    if (!characterExists(req.params.id)) {
      httpError(res, 404, ErrorCodes.characterNotFound, { id: req.params.id })
      return
    }
    const body = (req.body ?? {}) as Record<string, unknown>
    if (typeof body.name !== 'string' || !body.name.trim()) {
      httpError(res, 400, ErrorCodes.fieldNameRequired, { field: 'name' })
      return
    }
    const content = typeof body.content === 'string' ? body.content : ''
    writeMemoryFile(req.params.id, forceMdExtension(body.name.trim()), content)
    res.json({ ok: true })
  } catch (e) {
    sendJsonError(res, 400, e) // nom invalide (sanitizeFileName) → 400
  }
})

// « Retiens ça » : épingle un passage du fil dans moments.md (+ index MEMORY.md).
// Écriture directe, aucun appel LLM — c'est l'utilisateur qui décide ce qui compte.
memoryRouter.post('/api/characters/:id/memory/remember', (req, res) => {
  try {
    if (!characterExists(req.params.id)) {
      httpError(res, 404, ErrorCodes.characterNotFound, { id: req.params.id })
      return
    }
    const body = (req.body ?? {}) as Record<string, unknown>
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!text) {
      httpError(res, 400, ErrorCodes.fieldNameRequired, { field: 'text' })
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
    sendJsonError(res, 400, e)
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
    throw new CodedError(ErrorCodes.tidyNoJson)
  }
  try {
    return JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    throw new CodedError(ErrorCodes.tidyBadJson)
  }
}

/** Validation en dur : c'est ICI qu'une réponse moche devient une erreur — jamais des écritures. */
function validateTidyPlan(obj: Record<string, unknown>): TidyPlan {
  const index = typeof obj.index === 'string' ? obj.index.trim() : ''
  if (!index) throw new CodedError(ErrorCodes.tidyNoIndex)
  if (!Array.isArray(obj.files) || obj.files.length === 0) {
    throw new CodedError(ErrorCodes.tidyNoFiles)
  }
  const seen = new Set<string>()
  const files = obj.files.map((entry, i) => {
    const rec = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>
    const name0 = typeof rec.name === 'string' ? rec.name.trim() : ''
    if (!name0) throw new CodedError(ErrorCodes.tidyFileNoName, { n: i + 1 })
    const name = name0.toLowerCase().endsWith('.md') ? name0 : `${name0}.md`
    const safe = sanitizeFileName(name)
    if (safe.toLowerCase() === 'memory.md') {
      throw new CodedError(ErrorCodes.tidyIndexInFiles)
    }
    if (seen.has(safe.toLowerCase())) throw new CodedError(ErrorCodes.tidyDuplicateFile, { name: safe })
    seen.add(safe.toLowerCase())
    const content = typeof rec.content === 'string' ? rec.content : ''
    if (!content.trim()) throw new CodedError(ErrorCodes.tidyEmptyFile, { name: safe })
    return { name: safe, content }
  })
  return { index, files }
}

async function tidyMemory(
  charId: string,
): Promise<{ ok: true; before: { files: number; chars: number }; after: { files: number; chars: number }; backup: string }> {
  const character = getCharacter(charId)
  if (!character) throw new CodedError(ErrorCodes.characterNotFound, { id: charId })
  // Le rangement écrit AVEC LE MODÈLE DE CE PERSONNAGE (réglages effectifs) :
  // sa fenêtre de travail et son budget de sortie, pas ceux du réglage global.
  const settings = effectiveSettings(character)
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
    throw new CodedError(ErrorCodes.tidyTooBig, { k: Math.round(inputTokens / 1000), window: Math.round(window / 1000) })
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
  } catch (e) {
    // Le timer (10 min) se manifeste par une AbortError que le catch réseau de
    // openai.ts transforme en llmUnreachable « injoignable » : faux ici, le
    // backend est vivant mais n'a pas fini. Motif honnête, même code.
    if (abort.signal.aborted) {
      throw new CodedError(ErrorCodes.llmUnreachable, { detail: `no response after ${Math.round(TIDY_TIMEOUT_MS / 60000)} min` })
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
  if (!raw.trim()) throw new CodedError(ErrorCodes.tidyNoAnswer)

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
    httpError(res, 404, ErrorCodes.characterNotFound, { id: charId })
    return
  }
  if (listMemory(charId).filter((f) => f.name !== 'MEMORY.md').length < 2) {
    httpError(res, 400, ErrorCodes.tidyNeedsTwoFiles)
    return
  }
  if (tidyingInFlight.has(charId)) {
    httpError(res, 409, ErrorCodes.tidyAlreadyRunning)
    return
  }
  tidyingInFlight.add(charId)
  try {
    res.json(await tidyMemory(charId))
  } catch (e) {
    // Fenêtre trop petite / backend down / JSON invalide → 500, RIEN n'a été écrit.
    sendJsonError(res, 500, e)
  } finally {
    tidyingInFlight.delete(charId)
  }
})

// ── Compression de mémoire (chantier B) ──────────────────────────────────────
// POST /memory/compress — UN appel LLM PAR FICHIER : le LLM densifie AGRESSIVEMENT
// chaque fichier de faits, le vérifieur déterministe (zéro LLM) rejette toute
// perte de fait dur → repli denseEncode pour CE fichier. Le résultat est mis en
// cache (compression-cache.json) : c'est buildPayload qui l'utilise ensuite.
// Les fichiers mémoire SONT INTACTS — la compression est une vue, jamais une
// écriture sur les .md. Le LLM est posé (sleep entre fichiers) : c'est le même
// modèle local que le chat.
const COMPRESS_TIMEOUT_MS = 10 * 60 * 1000 // même ordre que la compaction
const compressingInFlight = new Set<string>()

// Instruction AGRESSIVE GÉNÉRALE — la version PROPRE de la recherche (−28 %
// STABLE, HYP. 1c ; scripts/llm-verify-v2-stable.ts). SANS tuning sur les données
// de test (les exemples sont sur D'AUTRES données) : c'est le plafond d'un codec
// général, pas un overfit.
const COMPRESS_MEMORY_SYSTEM =
  "Tu es un compresseur de mémoire pour LLM. Rends un format TÉLÉGRAPHIQUE clé : valeur, " +
  "UNE LIGNE par fait, le plus COURT possible sans perdre un seul fait DUR.\n\n" +
  "FAITS DURS (garder EXACT, jamais abréger) : chiffres, dates, noms propres (majuscules), " +
  "villes, adresses, qui-est-qui.\n\n" +
  "À SUPPRIMER :\n" +
  "- la prose (verbes être/avoir, articles, « s'appelle », « qui a », connecteurs, répétitions) ;\n" +
  "- toute nuance ou précision qui n'ajoute PAS un fait dur : marqueurs de temps relatifs " +
  "ou approximatifs, degrés d'intensité, conditions, circonstances de fréquence.\n\n" +
  "RÈGLE DE SÉCURITÉ : garde le fait-titre EXPLICITE (ne rends JAMAIS un fait implicite). " +
  "« 2 enfants : Jules 7, Emma 4 » est OK — « J7+E4 » est INTERDIT.\n\n" +
  "STYLE (exemples sur D'AUTRES données, à imiter) :\n" +
  "- chien : Rex, femelle, 4 ans, vaccinée\n" +
  "- oncle : Paul, Lille ; 3 enfants : Max 6, Iris 9\n" +
  "- café : torréfaction artisanale, pas de sucre\n\n" +
  "Réponds UNIQUEMENT avec le texte densifié — aucun commentaire, aucune introduction, " +
  "pas de guillemets."

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Densifie UN fichier de mémoire : LLM agressif + vérifieur → repli denseEncode. */
async function compressMemoryFile(
  settings: Settings,
  content: string,
): Promise<{ content: string; usedLLM: boolean }> {
  const window = settings.contextSize > 0 ? settings.contextSize : 32768
  // max_tokens 2000 AMORTI (compression 1×, réutilisée N× — le coût n'est payé
  // qu'une fois), borné à la moitié de la fenêtre pour tenir prompt + sortie.
  const completionBudget = Math.min(2000, Math.max(512, Math.floor(window / 2)))
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), COMPRESS_TIMEOUT_MS)
  timer.unref()
  let raw: string
  try {
    const result = await streamChatCompletion({
      settings: { ...settings, maxTokens: completionBudget },
      messages: [
        { role: 'system', content: COMPRESS_MEMORY_SYSTEM },
        { role: 'user', content },
      ],
      signal: abort.signal,
      onDelta: () => {},
    })
    raw = result.content.trim()
  } catch (e) {
    // Timeout → AbortError transformé en llmUnreachable. LLM injoignable : on ne
    // tente PAS les fichiers suivants (il est down) → l'action échoue, l'utilisateur
    // relance. buildPayload retombe sur denseEncode (−7 %) en attendant.
    if (abort.signal.aborted) {
      throw new CodedError(ErrorCodes.llmUnreachable, {
        detail: `no response after ${Math.round(COMPRESS_TIMEOUT_MS / 60000)} min`,
      })
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
  // Sortie VIDE = la signature du silence (finish=length, le modèle a « pensé »
  // sans rien produire) : repli honnête, on ne bloque pas l'action.
  if (!raw) return { content: denseEncode(content), usedLLM: false }
  // Le filet de sûreté : un fait dur manquant → le LLM est REJETÉ pour ce fichier,
  // repli denseEncode (déterministe, zéro LLM). Asymétrique : préfère le faux-rouge.
  const verdict = verifyFacts(content, raw)
  return verdict.ok ? { content: raw, usedLLM: true } : { content: denseEncode(content), usedLLM: false }
}

async function compressMemory(
  charId: string,
): Promise<{ ok: true; files: number; llmFiles: number; rejected: number; beforeChars: number; afterChars: number }> {
  const character = getCharacter(charId)
  if (!character) throw new CodedError(ErrorCodes.characterNotFound, { id: charId })
  const settings = effectiveSettings(character)
  // L'index (MEMORY.md) est structurel (liste des fichiers), pas des faits : il
  // n'est PAS compressé. Seulement les fichiers de faits.
  const factFiles = listMemory(charId).filter((f) => f.name !== 'MEMORY.md')
  const beforeChars = factFiles.reduce((n, f) => n + f.content.length, 0)
  const cache: Record<string, CompressionCacheEntry> = {}
  let llmFiles = 0
  for (const f of factFiles) {
    const r = await compressMemoryFile(settings, f.content)
    if (r.usedLLM) llmFiles++
    cache[f.name] = { content: r.content, sourceHash: hashMemoryContent(f.content) }
    await sleep(400) // doser le LLM (même modèle local que le chat)
  }
  writeCompressionCache(charId, { files: cache })
  const afterChars = Object.values(cache).reduce((n, e) => n + e.content.length, 0)
  return { ok: true, files: factFiles.length, llmFiles, rejected: factFiles.length - llmFiles, beforeChars, afterChars }
}

memoryRouter.post('/api/characters/:id/memory/compress', async (req, res) => {
  const charId = req.params.id
  if (!characterExists(charId)) {
    httpError(res, 404, ErrorCodes.characterNotFound, { id: charId })
    return
  }
  if (listMemory(charId).filter((f) => f.name !== 'MEMORY.md').length === 0) {
    // Rien à compresser (pas de fichier de faits) : pas d'erreur, on signale 0.
    res.json({ ok: true, files: 0, llmFiles: 0, rejected: 0, beforeChars: 0, afterChars: 0 })
    return
  }
  if (compressingInFlight.has(charId)) {
    httpError(res, 409, ErrorCodes.compressAlreadyRunning)
    return
  }
  compressingInFlight.add(charId)
  try {
    res.json(await compressMemory(charId))
  } catch (e) {
    // LLM injoignable / timeout → 500, AUCUN cache écrit (buildPayload retombe sur
    // denseEncode). L'utilisateur relance quand le modèle est de retour.
    sendJsonError(res, 500, e)
  } finally {
    compressingInFlight.delete(charId)
  }
})

// GET /memory/backups — liste des snapshots (les plus récents d'abord).
memoryRouter.get('/api/characters/:id/memory/backups', (req, res) => {
  try {
    if (!characterExists(req.params.id)) {
      httpError(res, 404, ErrorCodes.characterNotFound, { id: req.params.id })
      return
    }
    res.json(listMemoryBackups(req.params.id))
  } catch (e) {
    sendJsonError(res, 500, e)
  }
})

// POST /memory/backups/:name/restore — le snapshot de sécurité de l'état
// courant est pris D'ABORD : les restaurations s'empilent, on ne perd rien.
memoryRouter.post('/api/characters/:id/memory/backups/:name/restore', (req, res) => {
  try {
    if (!characterExists(req.params.id)) {
      httpError(res, 404, ErrorCodes.characterNotFound, { id: req.params.id })
      return
    }
    const safety = restoreMemoryBackup(req.params.id, req.params.name)
    res.json({ ok: true, restored: req.params.name, backup: safety })
  } catch (e) {
    sendJsonError(res, 400, e)
  }
})

memoryRouter.put('/api/characters/:id/memory/:name', (req, res) => {
  try {
    if (!characterExists(req.params.id)) {
      httpError(res, 404, ErrorCodes.characterNotFound, { id: req.params.id })
      return
    }
    const body = (req.body ?? {}) as Record<string, unknown>
    if (typeof body.content !== 'string') {
      httpError(res, 400, ErrorCodes.fieldNameRequired, { field: 'content' })
      return
    }
    writeMemoryFile(req.params.id, req.params.name, body.content)
    res.json({ ok: true })
  } catch (e) {
    sendJsonError(res, 400, e)
  }
})

memoryRouter.delete('/api/characters/:id/memory/:name', (req, res) => {
  try {
    deleteMemoryFile(req.params.id, req.params.name)
    res.json({ ok: true })
  } catch (e) {
    // storage refuse MEMORY.md (index) → 400 ; nom invalide → 400 aussi.
    sendJsonError(res, 400, e)
  }
})
