// POST /api/tts — proxy vers un serveur TTS compatible OpenAI (POST {ttsUrl}/audio/speech).
// Le client ne parle jamais directement au serveur TTS : pas de souci CORS, et la
// configuration reste côté serveur.
import { Router } from 'express'
import { loadSettings } from '../config'

export const ttsRouter = Router()

ttsRouter.post('/api/tts', async (req, res) => {
  const settings = loadSettings()
  if (!settings.ttsEnabled || !settings.ttsUrl) {
    res.status(400).json({ error: 'Synthèse vocale désactivée (voir Réglages)' })
    return
  }
  const body = (req.body ?? {}) as { text?: unknown }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    res.status(400).json({ error: 'text est requis' })
    return
  }

  const url = settings.ttsUrl.replace(/\/+$/, '') + '/audio/speech'
  const payload: Record<string, unknown> = { input: text }
  if (settings.ttsModel) payload.model = settings.ttsModel
  if (settings.ttsVoice) payload.voice = settings.ttsVoice

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 60_000)
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      res.status(502).json({ error: `Serveur TTS : HTTP ${r.status} — ${detail.slice(0, 300) || '(corps vide)'}` })
      return
    }
    res.setHeader('Content-Type', r.headers.get('content-type') ?? 'audio/mpeg')
    res.send(Buffer.from(await r.arrayBuffer()))
  } catch (e) {
    res.status(502).json({ error: `Serveur TTS injoignable (${url}) : ${e instanceof Error ? e.message : String(e)}` })
  } finally {
    clearTimeout(timer)
  }
})
