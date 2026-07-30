// Préférences d'interface — GET/PUT /api/ui, stockées dans data/ui.json.
// L'utilisateur est SEUL sur son serveur : sa langue, son thème, son dernier
// personnage et ses cadrages caméra doivent le suivre du PC au téléphone. Le
// fichier fait foi ; le localStorage du client n'en est qu'un cache.
// Rien de sensible ici (le token d'accès reste local, par appareil).
import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../lib/storage'
import type { UiPrefs } from '../../shared/types'
// La validation vit dans shared/uiPrefs.ts, PARTAGÉE avec le client (prefs.ts) :
// une seule table de règles, plus de divergence possible entre les deux bouts.
import { UI_PREF_KEYS, UI_PREF_VALIDATORS, normalizeUiPrefs } from '../../shared/uiPrefs'

export const uiRouter = Router()

const UI_FILE = path.join(DATA_DIR, 'ui.json')
// ui.json est une préférence, pas un stockage : plafond volontairement bas.
const MAX_BYTES = 64 * 1024

// ── Fichier ────────────────────────────────────────────────────────────────

/**
 * data/ui.json ({} s'il est absent, illisible ou corrompu — jamais une erreur).
 * Exporté : le moteur de messages spontanés y lit le personnage et la
 * conversation actifs, sans passer par HTTP.
 */
export function readUiPrefs(): UiPrefs {
  try {
    return normalizeUiPrefs(JSON.parse(fs.readFileSync(UI_FILE, 'utf8')))
  } catch {
    return {}
  }
}

/**
 * Écriture atomique tmp + fsync + rename (même protocole que updateChatHeader) :
 * une coupure au milieu ne laisse jamais un ui.json à moitié écrit.
 */
function writeUi(json: string): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tmp = UI_FILE + '.tmp'
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, json)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, UI_FILE)
}

// ── Routes ─────────────────────────────────────────────────────────────────

uiRouter.get('/api/ui', (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(readUiPrefs())
})

// Merge SUPERFICIEL : une clé envoyée remplace la précédente, `null` la
// supprime, une clé absente reste telle quelle. Une valeur invalide est
// ignorée (l'ancienne survit) — le client ne peut pas casser le fichier.
uiRouter.put('/api/ui', (req, res) => {
  const body = req.body as unknown
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ error: 'Corps attendu : un objet de préférences' })
    return
  }
  const patch = body as Record<string, unknown>
  const next = readUiPrefs() as Record<string, unknown>
  for (const key of UI_PREF_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    const raw = patch[key]
    if (raw === null) {
      delete next[key]
      continue
    }
    const value = (UI_PREF_VALIDATORS[key] as (v: unknown) => unknown)(raw)
    if (value !== undefined) next[key] = value
  }
  const json = JSON.stringify(next, null, 2)
  if (Buffer.byteLength(json, 'utf8') > MAX_BYTES) {
    res.status(413).json({ error: `Préférences trop volumineuses (max ${MAX_BYTES / 1024} Ko)` })
    return
  }
  try {
    writeUi(json)
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
    return
  }
  res.set('Cache-Control', 'no-store')
  res.json(next as UiPrefs)
})
