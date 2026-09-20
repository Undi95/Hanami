// ── COMPRESSION AGRESSIVE (VRAI LLM) + RAPPEL 6/6 + FIDÉLITÉ ────────────────
// C'est le cœur du chantier B : le codec agressif (LLM + vérifieur) sur la
// mémoire, posé (sleeps), puis le rappel de fait et la fidélité du perso vérifiés
// SUR LE CONTEXTE COMPRESSÉ. Le même modèle local (qwen3.8) fait le compresseur
// ET le chat — d'où la dosage (300-400 ms entre appels, timeout généreux).
// JAMAIS data/ réel : personnage jetable « Yuki », HANAMI_DATA scratch.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { get, post, put, del, postLong, chatMessage, sleep, check, section, summary } from './lib.mjs'
import { SYSTEM_PROMPT, MEMORY_FILES, PERSONA, RECALL, FIDELITY } from './fixture.mjs'

const HDATA = process.env.HDATA
const CHAR = 'Yuki'
const D = 400 // dosage entre appels LLM

function factHashes(charId) {
  const dir = `${HDATA}/characters/${charId}/memory`
  const out = {}
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md') || !(f in MEMORY_FILES)) continue
      out[f] = createHash('sha256').update(readFileSync(`${dir}/${f}`)).digest('hex')
    }
  } catch { /* pas encore */ }
  return out
}

// ── Setup : persona + personnage (compression OFF d'abord, pour le baseline)
section('Setup — persona + Yuki jetable')
await put('/api/settings', { userPersonas: [PERSONA], defaultPersona: PERSONA.id })
const created = await post('/api/characters', {
  name: CHAR,
  systemPrompt: SYSTEM_PROMPT,
  userPersona: PERSONA.id,
  llm: {}, // compression absente = OFF (baseline)
})
check('Yuki créé', created.status < 300, `status=${created.status}`)
const charId = created.data.id
if (!charId) { console.log('pas d’id'); summary('LLM'); process.exit(1) }
console.log(`  id = ${charId}`)
for (const [name, content] of Object.entries(MEMORY_FILES)) {
  await post(`/api/characters/${charId}/memory`, { name, content })
}
const chat = await post(`/api/characters/${charId}/chats`, {})
const chatId = chat.data.id
check('chat créé (pour preview)', !!chatId)

// ── Baseline de tokens (estimation prompt-preview, métrique commune)
const previewOff = (await get(`/api/prompt-preview?characterId=${charId}&chatId=${chatId}`)).data
const tokensOff = previewOff.tokens
check('baseline OFF — mémoire verbatim', previewOff.injected.includes(MEMORY_FILES['famille.md']))
console.log(`  tokens OFF ≈ ${tokensOff}`)

// Compression ON, PAS de cache → repli denseEncode sur la mémoire.
await put(`/api/characters/${charId}`, { llm: { compression: true } })
const previewDense = (await get(`/api/prompt-preview?characterId=${charId}&chatId=${chatId}`)).data
const tokensDense = previewDense.tokens
check('ON sans cache → mémoire dense (≠ original)', !previewDense.injected.includes(MEMORY_FILES['famille.md']))
console.log(`  tokens ON·dense ≈ ${tokensDense}  (gain vs OFF ${Math.round((1 - tokensDense / tokensOff) * 100)} %)`)

// ── COMPRESSION AGRESSIVE (vrai LLM) ────────────────────────────────────────
section('Compression AGRESSIVE — POST /memory/compress (vrai LLM, posé)')
const hashesBefore = factHashes(charId)
const comp = await postLong(`/api/characters/${charId}/memory/compress`)
check('compress répond ok', comp.status < 300 && comp.data?.ok === true, `status=${comp.status} body=${JSON.stringify(comp.data)?.slice(0, 200)}`)
const cd = comp.data
if (cd) {
  const pct = cd.beforeChars > 0 ? Math.round((1 - cd.afterChars / cd.beforeChars) * 100) : 0
  console.log(`  fichiers=${cd.files}  LLM=${cd.llmFiles}  repli=${cd.rejected}  chars ${cd.beforeChars}→${cd.afterChars} (−${pct} %)`)
  check('≥ 1 fichier densifié par le LLM (vérifié)', (cd.llmFiles ?? 0) >= 1, `llmFiles=${cd.llmFiles}`)
  check('caractères RÉDUITS (après < avant)', cd.afterChars < cd.beforeChars, `${cd.afterChars} vs ${cd.beforeChars}`)
}
const cacheFile = `${HDATA}/characters/${charId}/compression-cache.json`
check('cache écrit (compression-cache.json)', existsSync(cacheFile))
if (existsSync(cacheFile)) {
  const cache = JSON.parse(readFileSync(cacheFile, 'utf8'))
  check('cache porte 3 entrées (1 par fichier de faits)', Object.keys(cache.files ?? {}).length === 3, `clés=${Object.keys(cache.files ?? {}).join(',')}`)
  const sample = cache.files?.['famille.md']
  check('entrée de cache = {content, sourceHash}', !!sample && typeof sample.content === 'string' && typeof sample.sourceHash === 'string')
  console.log(`  [cache famille.md] ${sample?.content?.slice(0, 140).replace(/\n/g, '⏎')}`)
}
const hashesAfter = factHashes(charId)
check('fichiers de faits INTACTS après compress (vue, pas écriture)', Object.entries(hashesBefore).every(([f, h]) => hashesAfter[f] === h))

// Cache frais → la mémoire part en AGRESSIF (plus court que le dense).
const previewAggr = (await get(`/api/prompt-preview?characterId=${charId}&chatId=${chatId}`)).data
const tokensAggr = previewAggr.tokens
check('ON + cache → mémoire AGRESSIVE (≠ original ET ≠ dense)',
  !previewAggr.injected.includes(MEMORY_FILES['famille.md']) && previewAggr.injected !== previewDense.injected)
console.log(`  tokens ON·agressif ≈ ${tokensAggr}  (gain vs OFF ${Math.round((1 - tokensAggr / tokensOff) * 100)} %)`)
check('AGRESSIF < DENSE < OFF (le gain augmente)', tokensAggr < tokensDense && tokensDense < tokensOff, `${tokensAggr} < ${tokensDense} < ${tokensOff}`)

// ── RAPPEL DE FAIT sur la mémoire compressée (6 questions, chat FRAIS) ──────
section('RAPPEL — 6 faits sur la mémoire AGRESSIVEMENT compressée (chat frais)')
let recallOk = 0
for (const r of RECALL) {
  const c = await post(`/api/characters/${charId}/chats`, {})
  const res = await chatMessage(charId, c.data.id, r.q)
  const a = (res.text || '').toLowerCase()
  const hit = r.expect.some((e) => a.includes(e))
  if (hit) recallOk++
  check(`${hit ? '' : ''}${r.q} → ${r.expect.join('/')}`, hit, `rép.=${res.text?.slice(0, 90) || '(VIDE)'}`)
  await sleep(D)
}
check(`RAPPEL ${recallOk}/6`, recallOk === 6)

// ── FIDÉLITÉ du perso sur le contexte compressé (règle a) ───────────────────
section('FIDÉLITÉ — règles strictes sur le contexte compressé (chat frais)')
let fidelityOk = 0
let voidCount = 0
for (const f of FIDELITY) {
  const c = await post(`/api/characters/${charId}/chats`, {})
  const res = await chatMessage(charId, c.data.id, f.q)
  const a = (res.text || '').trim()
  if (!a) voidCount++
  const hit = !!a && f.ok(a.toLowerCase())
  if (hit) fidelityOk++
  check(`${f.name}${a ? '' : '  ⚠ VIDE'}`, hit, `rép.=${a.slice(0, 110) || '(VIDE)'}`)
  await sleep(D)
}
check('FIDÉLITÉ 4/4', fidelityOk === FIDELITY.length)
check('ZÉRO réponse vide (pas de boucle de silence)', voidCount === 0, `vides=${voidCount}`)

// ── Mesure réelle d'usage (tokens du done d'un chat compressé) ───────────────
section('Usage réel (context.tokens du done)')
const cReal = await post(`/api/characters/${charId}/chats`, {})
const real = await chatMessage(charId, cReal.data.id, 'Raconte-moi ce que tu sais de ma famille.')
check('usage réel rapporté (tokens > 0)', real.tokens > 0, `tokens=${real.tokens}`)
console.log(`  usage réel (chat compressé) ≈ ${real.tokens} tokens`)

// ── Nettoyage
section('Nettoyage')
const dres = await del(`/api/characters/${charId}`)
check('Yuki supprimé', dres.status < 300, `status=${dres.status}`)

summary('COMPRESSION AGRESSIVE + RAPPEL + FIDÉLITÉ (vrai LLM)')
