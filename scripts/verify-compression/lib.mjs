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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Chat SSE : envoie un message, renvoie { text, tokens, events } ──────────
// Contrat du serveur : { characterId, chatId, content }. Collecte le flux
// « data: {...} », garde le texte (message du « done », repli somme des deltas)
// et le tokens du « done » (usage réel du backend si fourni, sinon estimation).
export async function chatMessage(characterId, chatId, text, { timeoutMs = 180000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let events = []
  let doneMsg = null
  let doneTokens = 0
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
  return { text: text2, tokens: doneTokens, events, error: errEv ?? null }
}
