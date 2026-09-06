// Réglages : GET/PUT /api/settings + proxy /api/settings/models vers le backend LLM.
// Les secrets (password, apiKey) ne sont JAMAIS renvoyés en clair : la réponse les
// remplace par '' et expose des indicateurs passwordSet/apiKeySet.
import { Router } from 'express'
import type { Response } from 'express'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../config'
import { revokeAllTokens } from '../lib/auth'
import type { Settings } from '../../shared/types'
import { normalizePersonas } from '../../shared/personas'
import { httpError, sendJsonError } from '../lib/errors'
import { ErrorCodes } from '../../shared/errorCodes'

export const settingsRouter = Router()

// Sentinelle côté PUT : '' = secret inchangé, CLEAR_SECRET = secret effacé.
const CLEAR_SECRET = '__clear__'

/** Vue publique des réglages : secrets masqués + indicateurs de présence. */
function publicView(
  s: Settings,
): Settings & { passwordSet: boolean; apiKeySet: boolean; tavilyApiKeySet: boolean } {
  return {
    ...s,
    password: '',
    apiKey: '',
    tavilyApiKey: '',
    passwordSet: s.password.length > 0,
    apiKeySet: s.apiKey.length > 0,
    tavilyApiKeySet: s.tavilyApiKey.length > 0,
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
  // Personas : le client envoie la collection + le défaut — s'il en touche un
  // des deux, l'autre est repris des réglages courants pour que la paire soit
  // cohérente après save. La normalisation (shared/personas.ts) fait le reste :
  // bornes, ids dédoublonnés, max 20, défaut = un id EXISTANT de la collection
  // (sinon la première, collection vide = '' — le même repli que la lecture).
  if ('userPersonas' in patch || 'defaultPersona' in patch) {
    const current = loadSettings()
    const nextPersonas = normalizePersonas(patch.userPersonas ?? current.userPersonas)
    const defaultRaw =
      typeof patch.defaultPersona === 'string' ? patch.defaultPersona.trim() : current.defaultPersona
    patch.userPersonas = nextPersonas
    patch.defaultPersona = nextPersonas.some((p) => p.id === defaultRaw)
      ? defaultRaw
      : nextPersonas[0]?.id ?? ''
  }
  // Secrets : '' = inchangé (le client affiche les champs vides), sentinelle = effacé.
  for (const key of ['password', 'apiKey', 'tavilyApiKey'] as const) {
    if (patch[key] === '') delete patch[key]
    else if (patch[key] === CLEAR_SECRET) patch[key] = ''
  }
  const before = loadSettings()
  let next: Settings
  try {
    next = saveSettings(patch)
  } catch (e) {
    // config.json illisible → CodedError (configUnreadableSave), traduite côté client.
    sendJsonError(res, 500, e)
    return
  }
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
    httpError(res, 502, ErrorCodes.backendProbeFailed, { url, detail: msg.slice(0, 200) })
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

// ── Vision ─────────────────────────────────────────────────────────────────
// Le client ne montre le trombone du composer que si le modèle SAIT lire une
// image. En mode 'auto' la question est posée au backend : Ollama expose les
// capacités du modèle sur POST /api/show (hors /v1, c'est son API native). Tout
// autre backend ne répondra pas → false, donc aucun pixel n'est jamais envoyé
// à un modèle qui ne les comprend pas. Rien n'est mis en cache : l'appel est
// rare (démarrage + enregistrement des réglages).

const VISION_PROBE_TIMEOUT_MS = 4000

/** Origine du backendUrl (le /v1 et tout autre chemin sont retirés) — null si l'URL est invalide. */
function backendOrigin(backendUrl: string): string | null {
  try {
    return new URL(backendUrl).origin
  } catch {
    return null
  }
}

/** Le modèle configuré annonce-t-il la capacité « vision » ? Toute erreur = non. */
async function probeVision(settings: Settings): Promise<boolean> {
  const origin = backendOrigin(settings.backendUrl)
  if (!origin || !settings.model.trim()) return false
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), VISION_PROBE_TIMEOUT_MS)
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`
    const r = await fetch(`${origin}/api/show`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: settings.model.trim() }),
      signal: ctrl.signal,
    })
    if (!r.ok) return false
    const json = (await r.json()) as { capabilities?: unknown }
    return (
      Array.isArray(json.capabilities) &&
      json.capabilities.some((c) => typeof c === 'string' && c.toLowerCase() === 'vision')
    )
  } catch {
    // Backend non-Ollama, injoignable, ou modèle inconnu : pas d'images.
    return false
  } finally {
    clearTimeout(timer)
  }
}

// GET /api/vision → { vision: boolean }
settingsRouter.get('/api/vision', async (_req, res) => {
  const settings = loadSettings()
  res.set('Cache-Control', 'no-store')
  if (settings.visionMode === 'on') {
    res.json({ vision: true })
    return
  }
  if (settings.visionMode === 'off') {
    res.json({ vision: false })
    return
  }
  res.json({ vision: await probeVision(settings) })
})
