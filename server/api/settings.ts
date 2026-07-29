// Réglages : GET/PUT /api/settings + proxy GET /api/settings/models vers le backend LLM.
import { Router } from 'express'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../config'
import type { Settings } from '../../shared/types'

export const settingsRouter = Router()

settingsRouter.get('/api/settings', (_req, res) => {
  res.json(loadSettings())
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
  res.json(saveSettings(patch))
})

// Proxy de la liste des modèles du backend (timeout 5 s, 502 si injoignable).
settingsRouter.get('/api/settings/models', async (_req, res) => {
  const settings = loadSettings()
  const url = settings.backendUrl.replace(/\/+$/, '') + '/models'
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const headers: Record<string, string> = {}
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`
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
})
