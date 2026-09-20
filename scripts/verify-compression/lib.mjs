// Batterie de tests Hanami — instance ISOLOÉE. Zéro npm, fetch global (Node 18+).
// JAMAIS data/ réel : tout part sur l'instance isolée (port dédié, HANAMI_DATA
// scratch). L'URL est paramétrable (HANAMI_TEST_URL) pour viser n'importe quelle
// instance de test ; par défaut la convention du chantier B (port 7790).
export const BASE = process.env.HANAMI_TEST_URL ?? 'http://localhost:7790'

// ── Compteur de résultats ───────────────────────────────────────────────────
let pass = 0
let fail = 0
const failures = []
export function check(label, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    failures.push(label + (detail ? ` — ${detail}` : ''))
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
export function section(title) {
  console.log(`\n━━━ ${title} ━━━`)
}
export function summary(name) {
  console.log(`\n════════ ${name} : ${pass} OK / ${fail} KO ════════`)
  if (failures.length) {
    console.log('Échecs :')
    for (const f of failures) console.log(`  - ${f}`)
  }
  process.exitCode = fail > 0 ? 1 : 0
}

// ── API REST ─────────────────────────────────────────────────────────────────
async function req(method, path, body, opts = {}) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: opts.signal,
  })
  let data = null
  const text = await res.text()
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: res.status, data, headers: res.headers }
}
export const get = (p) => req('GET', p)
export const post = (p, b) => req('POST', p, b ?? {})
export const put = (p, b) => req('PUT', p, b ?? {})
export const del = (p) => req('DELETE', p)

// POST long (hors fetch/undici) : le codec agressif batche 3 appels LLM dans UNE
// requête non-streaming ; sur un PC lent + 27B ça dépasse le headersTimeout 5 min
// par défaut d'undici (non importable — zéro npm). Ici on passe par http.request
// avec un timeout long (12 min par défaut, aligné sur le budget serveur de 10 min).
import http from 'node:http'
export function postLong(path, body, { timeoutMs = 720000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path)
    const data = JSON.stringify(body ?? {})
    const req = http.request(
      {
        hostname: url.hostname, port: url.port, path: url.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
      },
      (res) => {
        let buf = ''
        res.on('data', (c) => (buf += c))
        res.on('end', () => {
          let d = null
          try { d = buf ? JSON.parse(buf) : null } catch { d = buf }
          resolve({ status: res.statusCode, data: d, headers: res.headers })
        })
      },
    )
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`postLong timeout ${timeoutMs}ms`)))
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Chat SSE : envoie un message, renvoie { text, tokens, events } ──────────
// Contrat du serveur : { characterId, chatId, content }. Collecte le flux
// « data: {...} », garde le texte (message du « done », repli somme des deltas)
// et le tokens du « done » (usage réel du backend si fourni, sinon estimation).
// Timeout PAR MESSAGE : le modèle 27B PENSE (thinking) — sur ce PC lent, une
// réponse peut prendre > 3 min. 180 s faisait aborter la 2e fidélité (mesuré).
// 480 s (8 min) : plafond haut, le test finit quand même (typique 1-2 min/msg).
export async function chatMessage(characterId, chatId, text, { timeoutMs = 480000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let events = []
  let doneMsg = null
  let doneTokens = 0
  let doneThinking = ''
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ characterId, chatId, content: text }),
      signal: ctrl.signal,
    })
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      // Chaque événement SSE : « data: {json}\n\n »
      let idx
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            events.push(ev)
            if (ev.type === 'done') {
              doneMsg = ev.message
              doneThinking = ev.message?.thinking ?? ''
              doneTokens = ev.context?.tokens ?? 0
            }
          } catch {
            /* ligne partielle / non-JSON : ignorée */
          }
        }
      }
    }
  } finally {
    clearTimeout(timer)
  }
  // Le texte : le message du « done » (intégral) ; repli sur la somme des deltas.
  let text2 = doneMsg?.content ?? ''
  if (!text2) {
    text2 = events.filter((e) => e.type === 'delta').map((e) => e.text).join('')
  }
  const errEv = events.find((e) => e.type === 'error')
  return { text: text2, tokens: doneTokens, thinking: doneThinking, events, error: errEv ?? null }
}
