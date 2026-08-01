// POST /api/tts — proxy vers un serveur TTS compatible OpenAI (POST {ttsUrl}/audio/speech).
// GET /api/tts/probe — sonde le serveur TTS (joignable ? quelles voix ?).
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
      // charset=utf-8 ANNONCÉ : le corps part déjà en UTF-8 (fetch n'encode pas
      // autrement, et c'est ce que JSON impose depuis la RFC 8259), mais les
      // serveurs TTS sont des scripts Python maison — celui qui décode selon
      // l'en-tête, faute de charset, retombe parfois sur latin1 et lit
      // « cÃ´tÃ© ». Le dire coûte quinze octets et ferme la question.
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
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

// ── Sonde du serveur TTS ───────────────────────────────────────────────────
// Retrouver à la main l'URL exacte, le modèle et surtout l'identifiant d'une voix
// (du genre « clone:Sakurav1 », préfixe obligatoire) est un cauchemar : cette route
// interroge le serveur et renvoie ce qu'il annonce. Aucune URL n'est journalisée —
// le client envoie la valeur du champ de réglages, éventuellement non enregistrée.

const PROBE_TIMEOUT_MS = 5000
// Les réponses attendues sont de petits JSON ; on borne quand même (la racine d'un
// serveur peut renvoyer une page entière).
const PROBE_MAX_BODY = 64 * 1024
// Assez pour tous les serveurs connus, sans jamais noyer l'interface en pastilles.
const PROBE_MAX_VOICES = 200

interface ProbeVoice {
  id: string
  name: string
}

type Probe = { ok: true; status: number; text: string } | { ok: false; error: string }

/** Message d'erreur réseau court et lisible (undici cache le vrai motif dans `cause`). */
function shortError(e: unknown): string {
  if (e instanceof Error && e.name === 'AbortError') return 'délai dépassé (5 s)'
  const message = e instanceof Error ? e.message : String(e)
  const cause = e instanceof Error ? (e as { cause?: unknown }).cause : undefined
  const detail = cause instanceof Error ? cause.message : ''
  return (detail ? `${message} (${detail})` : message).slice(0, 200)
}

/** GET borné en temps, corps lu dans le même délai. `ok: false` = la requête n'a pas abouti. */
async function probeGet(url: string): Promise<Probe> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    return { ok: true, status: r.status, text: (await r.text()).slice(0, PROBE_MAX_BODY) }
  } catch (e) {
    return { ok: false, error: shortError(e) }
  } finally {
    clearTimeout(timer)
  }
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

/**
 * Ligne d'info éventuelle exposée par la racine du serveur — ex. Qwen3-TTS renvoie
 * {"status":"ok","message":"Qwen3-TTS API Server","model":"1.7B"} → « Qwen3-TTS API
 * Server — 1.7B ». Corps non JSON (page HTML, 404 texte) : aucune info, ce n'est pas
 * un échec pour autant.
 */
function statusInfo(text: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') return undefined
  const o = parsed as Record<string, unknown>
  const parts = [asText(o.message), asText(o.model)].filter((s) => s.length > 0)
  // Ni message ni modèle : le simple « status » fait office d'info.
  if (parts.length === 0) {
    const status = asText(o.status)
    if (status) parts.push(status)
  }
  return parts.length > 0 ? parts.join(' — ').slice(0, 200) : undefined
}

/**
 * Normalise une liste de voix en [{id, name}]. Deux formats vivent dans la nature :
 * {"voices":[{"voice_id":"clone:Sakurav1","name":"Sakurav1"}, …]} (objets) et
 * {"voices":["af_bella", …]} (chaînes, style Kokoro-FastAPI ; id = name = la chaîne).
 * `undefined` = corps illisible ou aucune voix exploitable.
 */
function parseVoices(text: string): ProbeVoice[] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  // Certains serveurs renvoient le tableau nu, sans enveloppe {voices}.
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { voices?: unknown }).voices)
      ? (parsed as { voices: unknown[] }).voices
      : null
  if (!list) return undefined
  const voices: ProbeVoice[] = []
  for (const item of list) {
    if (voices.length >= PROBE_MAX_VOICES) break
    if (typeof item === 'string') {
      const id = item.trim()
      if (id) voices.push({ id, name: id })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    // L'id EXACT est ce que le champ « Voix » doit recevoir : voice_id d'abord.
    const id = asText(o.voice_id) || asText(o.id) || asText(o.name)
    if (!id) continue
    voices.push({ id, name: asText(o.name) || id })
  }
  return voices.length > 0 ? voices : undefined
}

/** Champ « model » de la racine JSON — souvent une version courte (« 1.7B »). */
function rootModelOf(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return undefined
    const model = asText((parsed as Record<string, unknown>).model)
    return model || undefined
  } catch {
    return undefined
  }
}

/** Premier modèle annoncé par GET /models (format OpenAI {data:[{id}]}) — le nom EXACT. */
function firstModelOf(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return undefined
    const data = (parsed as { data?: unknown }).data
    if (!Array.isArray(data) || data.length === 0) return undefined
    const first = data[0]
    if (!first || typeof first !== 'object') return undefined
    const id = asText((first as Record<string, unknown>).id)
    return id || undefined
  } catch {
    return undefined
  }
}

/** Origine seule (le /v1 et tout autre chemin sautent) — null si l'URL est invalide. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

ttsRouter.get('/api/tts/probe', async (req, res) => {
  const settings = loadSettings()
  // ?url= : la valeur COURANTE du champ de réglages, testée sans être enregistrée.
  // Elle prime sur la configuration ; à ne JAMAIS journaliser.
  const asked = typeof req.query.url === 'string' ? req.query.url.trim() : ''
  // Même normalisation que le POST : les / finaux sont retirés.
  const base = (asked || settings.ttsUrl).replace(/\/+$/, '')
  res.set('Cache-Control', 'no-store')
  if (!base) {
    res.status(400).json({ error: 'Aucune URL de serveur TTS — renseignez-la d’abord.' })
    return
  }

  // « Joignable » = au moins UNE sonde a obtenu une réponse HTTP, même une 404 :
  // beaucoup de serveurs n'exposent rien sur / ni sur /voices sans être morts.
  let reachable = false
  let info: string | undefined
  let model: string | undefined
  let lastError = 'URL invalide'

  const origin = originOf(base)
  if (origin) {
    const root = await probeGet(`${origin}/`)
    if (root.ok) {
      reachable = true
      info = statusInfo(root.text)
      model = rootModelOf(root.text) // repli si /models ne dit rien de mieux
    } else {
      lastError = root.error
    }
  }

  // Le nom EXACT du modèle, quand le serveur expose la route OpenAI standard —
  // il prime sur le champ « model » de la racine, souvent une version courte.
  const models = await probeGet(base + '/models')
  if (models.ok) {
    reachable = true
    if (models.status === 200) model = firstModelOf(models.text) ?? model
  }

  let voices: ProbeVoice[] | undefined
  for (const path of ['/voices', '/audio/voices']) {
    const r = await probeGet(base + path)
    if (!r.ok) {
      lastError = r.error
      continue
    }
    reachable = true
    if (r.status !== 200) continue
    voices = parseVoices(r.text)
    // 200 mais corps inexploitable (page d'accueil renvoyée en repli, par exemple) :
    // on laisse sa chance au chemin suivant.
    if (voices) break
  }

  const payload: { reachable: boolean; info?: string; model?: string; voices?: ProbeVoice[] } = {
    reachable,
  }
  // Injoignable : l'info porte le motif de l'échec. Voix introuvables mais serveur
  // debout : `voices` reste absent, c'est un résultat valide.
  if (!reachable) info = lastError
  if (info) payload.info = info
  if (model) payload.model = model
  if (voices) payload.voices = voices
  res.json(payload)
})
