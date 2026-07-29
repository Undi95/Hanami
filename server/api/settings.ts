// Réglages : GET/PUT /api/settings + proxy /api/settings/models vers le backend LLM.
// Les secrets (password, apiKey) ne sont JAMAIS renvoyés en clair : la réponse les
// remplace par '' et expose des indicateurs passwordSet/apiKeySet.
import { Router } from 'express'
import type { Response } from 'express'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../config'
import { revokeAllTokens } from '../lib/auth'
import type { Settings } from '../../shared/types'

export const settingsRouter = Router()

// Sentinelle côté PUT : '' = secret inchangé, CLEAR_SECRET = secret effacé.
const CLEAR_SECRET = '__clear__'

/** Vue publique des réglages : secrets masqués + indicateurs de présence. */
function publicView(s: Settings): Settings & { passwordSet: boolean; apiKeySet: boolean } {
  return {
    ...s,
    password: '',
    apiKey: '',
    passwordSet: s.password.length > 0,
    apiKeySet: s.apiKey.length > 0,
  }
}

settingsRouter.get('/api/settings', (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(publicView(loadSettings()))
})

settingsRouter.put('/api/settings', (req, res) => {
  // Merge défensif : seules les clés connues, au bon type, sont retenues.
  const body = (req.body ?? {}) as Record<string, unknown>
  const patch: Partial<Settings> = {}
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = body[key]
    if (value !== undefined && typeof value === typeof DEFAULT_SETTINGS[key]) {
      ;(patch as Record<string, unknown>)[key] = value
    }
  }
  // Secrets : '' = inchangé (le client affiche les champs vides), sentinelle = effacé.
  for (const key of ['password', 'apiKey'] as const) {
    if (patch[key] === '') delete patch[key]
    else if (patch[key] === CLEAR_SECRET) patch[key] = ''
  }
  const before = loadSettings()
  const next = saveSettings(patch)
  // Mot de passe modifié (ou retiré) → toutes les sessions existantes tombent.
  if (next.password !== before.password) revokeAllTokens()
  res.set('Cache-Control', 'no-store')
  res.json(publicView(next))
})

// Interrogation de la liste des modèles du backend (timeout 5 s, 502 si injoignable).
async function probeModels(backendUrl: string, apiKey: string, res: Response): Promise<void> {
  const url = backendUrl.replace(/\/+$/, '') + '/models'
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const headers: Record<string, string> = {}
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    const r = await fetch(url, { headers, signal: ctrl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const json = (await r.json()) as { data?: unknown; models?: unknown }
    // Format OpenAI {data:[{id}]} ; tolère aussi {models:[...]} et les listes de chaînes.
    const list = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : []
    const models = list
      .map((m) => (typeof m === 'string' ? m : String((m as { id?: unknown } | null)?.id ?? '')))
      .filter((s) => s.length > 0)
    res.json({ models })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    res.status(502).json({ error: `Backend injoignable (${url}) : ${msg}` })
  } finally {
    clearTimeout(timer)
  }
}

// GET : teste les réglages ENREGISTRÉS (utilisé par le bandeau backendDown de l'App).
settingsRouter.get('/api/settings/models', async (_req, res) => {
  const settings = loadSettings()
  await probeModels(settings.backendUrl, settings.apiKey, res)
})

// POST : teste des valeurs FOURNIES ({backendUrl?, apiKey?}) SANS RIEN PERSISTER —
// les champs absents retombent sur les réglages enregistrés.
settingsRouter.post('/api/settings/models', async (req, res) => {
  const settings = loadSettings()
  const body = (req.body ?? {}) as { backendUrl?: unknown; apiKey?: unknown }
  const backendUrl =
    typeof body.backendUrl === 'string' && body.backendUrl.trim() ? body.backendUrl.trim() : settings.backendUrl
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey : settings.apiKey
  await probeModels(backendUrl, apiKey, res)
})
