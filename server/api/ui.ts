// Préférences d'interface — GET/PUT /api/ui, stockées dans data/ui.json.
// L'utilisateur est SEUL sur son serveur : sa langue, son thème, son dernier
// personnage et ses cadrages caméra doivent le suivre du PC au téléphone. Le
// fichier fait foi ; le localStorage du client n'en est qu'un cache.
// Rien de sensible ici (le token d'accès reste local, par appareil).
import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../lib/storage'
import type { StageView, UiCustomTheme, UiPrefs } from '../../shared/types'

export const uiRouter = Router()

const UI_FILE = path.join(DATA_DIR, 'ui.json')
// ui.json est une préférence, pas un stockage : plafonds volontairement bas.
const MAX_BYTES = 64 * 1024
const MAX_STRING = 200
const MAX_ENTRIES = 200

const HEX_RE = /^#[0-9a-fA-F]{6}$/
// Clés des dictionnaires (identifiants de personnage/conversation) : jeu de
// caractères restreint, et jamais un nom qui toucherait au prototype.
const KEY_RE = /^[A-Za-z0-9._-]{1,64}$/
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

// ── Validateurs (tout ce qui n'est pas reconnu est IGNORÉ) ─────────────────

function asString(value: unknown, max = MAX_STRING): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined
}

function asCustomTheme(value: unknown): UiCustomTheme | undefined {
  if (!value || typeof value !== 'object') return undefined
  const o = value as { bg?: unknown; accent?: unknown }
  if (typeof o.bg !== 'string' || !HEX_RE.test(o.bg)) return undefined
  if (typeof o.accent !== 'string' || !HEX_RE.test(o.accent)) return undefined
  return { bg: o.bg, accent: o.accent }
}

function asTriple(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined
  if (!value.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined
  return [value[0] as number, value[1] as number, value[2] as number]
}

function asView(value: unknown): StageView | undefined {
  if (!value || typeof value !== 'object') return undefined
  const o = value as { pos?: unknown; target?: unknown }
  const pos = asTriple(o.pos)
  const target = asTriple(o.target)
  return pos && target ? { pos, target } : undefined
}

/** Dictionnaire clé → valeur validée ; entrées invalides ou clés douteuses écartées. */
function asRecord<T>(value: unknown, item: (raw: unknown) => T | undefined): Record<string, T> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, T> = {}
  let n = 0
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (n >= MAX_ENTRIES) break
    if (!KEY_RE.test(key) || FORBIDDEN_KEYS.has(key)) continue
    const val = item(raw)
    if (val === undefined) continue
    out[key] = val
    n++
  }
  return out
}

// Un validateur par clé de UiPrefs — le type mappé garantit qu'aucune n'est oubliée.
const VALIDATORS: { [K in keyof Required<UiPrefs>]: (value: unknown) => UiPrefs[K] | undefined } = {
  lang: (v) => (v === 'fr' || v === 'en' ? v : undefined),
  theme: (v) => asString(v, 32),
  customTheme: asCustomTheme,
  vnMode: (v) => (typeof v === 'boolean' ? v : undefined),
  activeCharacter: (v) => asString(v, 128),
  activeChat: (v) => asRecord(v, (raw) => asString(raw, 128)),
  views: (v) => asRecord(v, asView),
}

const UI_KEYS = Object.keys(VALIDATORS) as (keyof UiPrefs)[]

/** Objet quelconque → UiPrefs propre : clés inconnues jetées, valeurs invalides omises. */
function normalize(raw: unknown): UiPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const source = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of UI_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue
    const value = (VALIDATORS[key] as (v: unknown) => unknown)(source[key])
    if (value !== undefined) out[key] = value
  }
  return out as UiPrefs
}

// ── Fichier ────────────────────────────────────────────────────────────────

/** data/ui.json ({} s'il est absent, illisible ou corrompu — jamais une erreur). */
function readUi(): UiPrefs {
  try {
    return normalize(JSON.parse(fs.readFileSync(UI_FILE, 'utf8')))
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
  res.json(readUi())
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
  const next = readUi() as Record<string, unknown>
  for (const key of UI_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    const raw = patch[key]
    if (raw === null) {
      delete next[key]
      continue
    }
    const value = (VALIDATORS[key] as (v: unknown) => unknown)(raw)
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
