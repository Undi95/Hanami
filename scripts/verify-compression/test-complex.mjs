// ── CAS DUR — personnage COMPLEXE, compression OFF (verbatim) vs ON ──────────
// La batterie d'avant ne testait qu'un prompt COURT et télégraphique (Yuki). Le
// retour de Lucas : sur un perso complexe (voix intégrale + émotags + règles),
// (1) les émotags ne fonctionnent plus, (2) le thinking est bien plus long,
// (3) le perso n'est plus respecté. Ce script MESURE les 3 sur un cas dur :
// il crée Mira (jetable, JAMAIS Sakura), joue la fidélité + rappel en OFF
// (sysprompt+mémoire verbatim, le baseline), puis en ON (compression allumée +
// mémoire agressive), et COMPARE fidélité / émotag / thinking / tokens.
//
// Verdict attendu (la compression ne doit JAMAIS dégrader le cas dur) :
//   fidélité ON ≥ OFF, zéro vide, émotags encore émis, thinking pas anormalement
//   plus long, ET tokens ON < OFF (l'économie réelle).
import { get, post, put, del, postLong, chatMessage, sleep, check, section, summary } from './lib.mjs'
import { SYSTEM_PROMPT, MEMORY_FILES, PERSONA, RECALL, FIDELITY, EMOTE_RE, EMOTE_START_RE } from './fixture-complex.mjs'

const CHAR = 'Mira'
const D = 380 // dosage LLM (même modèle local que l'app — ne pas saturer le GPU)

const countEmotes = (t) => (t.match(EMOTE_RE) || []).length
const startsEmote = (t) => EMOTE_START_RE.test(t)

async function runFidelity(charId) {
  const rows = []
  for (const f of FIDELITY) {
    const c = await post(`/api/characters/${charId}/chats`, {})
    const r = await chatMessage(charId, c.data.id, f.q)
    await sleep(D)
    const a = (r.text || '').trim()
    const pass = !!a && f.ok(a.toLowerCase())
    rows.push({ name: f.name, pass, void: !a, text: a, think: (r.thinking || '').length, emote: countEmotes(a), startEmote: startsEmote(a), tokens: r.tokens })
    console.log(`  ${pass ? '✓' : '✗'} ${f.name}${a ? '' : '  ⚠VIDE'}`)
    console.log(`      → ${a.slice(0, 120).replace(/\n/g, ' ') || '(vide)'}`)
  }
  return rows
}

async function runRecall(charId) {
  let ok = 0
  for (const r of RECALL) {
    const c = await post(`/api/characters/${charId}/chats`, {})
    const res = await chatMessage(charId, c.data.id, r.q)
    await sleep(D)
    const a = (res.text || '').toLowerCase()
    const hit = r.expect.some((e) => a.includes(e))
    if (hit) ok++
    console.log(`  ${hit ? '✓' : '✗'} ${r.q}`)
    if (!hit) console.log(`      → ${res.text?.slice(0, 100) || '(vide)'}`)
  }
  return ok
}

function agg(rows) {
  const n = rows.length
  return {
    fid: rows.filter((r) => r.pass).length,
    voids: rows.filter((r) => r.void).length,
    emote: rows.filter((r) => r.emote > 0).length,
    startEmote: rows.filter((r) => r.startEmote).length,
    avgThink: n ? Math.round(rows.reduce((s, r) => s + r.think, 0) / n) : 0,
  }
}

// ── Setup : persona + Mira jetable (compression OFF d'abord = baseline) ──────
section('Setup — persona + Mira jetable (cas dur, JAMAIS Sakura)')
await put('/api/settings', { userPersonas: [PERSONA], defaultPersona: PERSONA.id })
const created = await post('/api/characters', { name: CHAR, systemPrompt: SYSTEM_PROMPT, userPersona: PERSONA.id, llm: {} })
check('Mira créé', created.status < 300, `status=${created.status}`)
const charId = created.data.id
if (!charId) { console.log('pas d’id'); summary('CAS DUR'); process.exit(1) }
for (const [n, c] of Object.entries(MEMORY_FILES)) await post(`/api/characters/${charId}/memory`, { name: n, content: c })
const chat = await post(`/api/characters/${charId}/chats`, {})
const chatId = chat.data.id

// ── OFF : baseline, sysprompt + mémoire VERBATIM ─────────────────────────────
section('OFF — baseline, sysprompt + mémoire VERBATIM')
const pOff = (await get(`/api/prompt-preview?characterId=${charId}&chatId=${chatId}`)).data
check('mémoire verbatim (OFF)', pOff.injected.includes(MEMORY_FILES['phare.md']))
console.log(`  tokens OFF ≈ ${pOff.tokens}`)
const off = agg(await runFidelity(charId))
console.log(`  OFF — fidélité ${off.fid}/6 · vides ${off.voids} · émotag ${off.emote}/6 · commence-p-émotag ${off.startEmote}/6 · thinking moy ${off.avgThink} car`)

// ── ON : compression allumée + mémoire AGRESSIVE (vrai LLM) ──────────────────
section('ON — compression allumée + mémoire AGRESSIVE (vrai LLM, posé)')
await put(`/api/characters/${charId}`, { llm: { compression: true } })
let compMode = 'dense (repli)'
try {
  const comp = await postLong(`/api/characters/${charId}/memory/compress`)
  const cd = comp.data
  if (cd && cd.ok) {
    const pct = cd.beforeChars > 0 ? Math.round((1 - cd.afterChars / cd.beforeChars) * 100) : 0
    compMode = `agressif (−${pct} %)`
    console.log(`  compress : fichiers=${cd.files} LLM=${cd.llmFiles} repli=${cd.rejected} · chars ${cd.beforeChars}→${cd.afterChars} (−${pct} %)`)
    check('mémoire densifiée (après < avant)', cd.afterChars < cd.beforeChars, `${cd.afterChars} vs ${cd.beforeChars}`)
  } else {
    console.log(`  compress : réponse non-ok (status=${comp.status}) → repli dense`)
  }
} catch (e) {
  console.log(`  compress : ${e.message} → repli dense (le cas dur reste testable)`)
}
await sleep(200)
const pOn = (await get(`/api/prompt-preview?characterId=${charId}&chatId=${chatId}`)).data
check('mémoire compressée (ON, ≠ original)', !pOn.injected.includes(MEMORY_FILES['phare.md']))
console.log(`  mode mémoire ON : ${compMode}`)
const gainCtx = Math.round((1 - pOn.tokens / pOff.tokens) * 100)
console.log(`  tokens ON ≈ ${pOn.tokens}  (gain contexte TOTAL ${gainCtx > 0 ? '−' : ''}${Math.abs(gainCtx)} %)`)
const on = agg(await runFidelity(charId))
console.log(`  ON  — fidélité ${on.fid}/6 · vides ${on.voids} · émotag ${on.emote}/6 · commence-p-émotag ${on.startEmote}/6 · thinking moy ${on.avgThink} car`)

// ── RAPPEL 6/6 sur la mémoire compressée (ON) ────────────────────────────────
section('RAPPEL — 6 faits sur la mémoire compressée (ON)')
const recall = await runRecall(charId)
check(`RAPPEL ${recall}/6`, recall === 6)

// ── TABLEAU A/B ───────────────────────────────────────────────────────────────
section('TABLEAU A/B (OFF verbatim vs ON compressé)')
const line = (m, a) => `  ${m.padEnd(4)} fidélité ${a.fid}/6  vides ${a.voids}  émotag ${a.emote}/6  commence-p-émotag ${a.startEmote}/6  thinking ${a.avgThink}c`
console.log(line('OFF', off))
console.log(line('ON', on))

// ── VERDICT : la compression ne doit JAMAIS dégrader le cas dur ───────────────
section('VERDICT — la compression ne doit JAMAIS dégrader le cas dur')
check('FIDÉLITÉ ON ≥ OFF (perso respecté)', on.fid >= off.fid, `ON=${on.fid}/6 OFF=${off.fid}/6`)
check('ZÉRO réponse vide (ON)', on.voids === 0, `vides=${on.voids}`)
check('ÉMOTAGS encore émis (ON ≥ OFF et > 0)', on.emote >= off.emote && on.emote > 0, `ON=${on.emote}/6 OFF=${off.emote}/6`)
check('THINKING pas anormalement plus long (ON ≤ 1.6×OFF + 100c)', on.avgThink <= off.avgThink * 1.6 + 100, `ON=${on.avgThink}c OFF=${off.avgThink}c`)
check('ÉCONOMIE de tokens (ON < OFF)', pOn.tokens < pOff.tokens, `ON=${pOn.tokens} OFF=${pOff.tokens}`)

// ── Nettoyage ─────────────────────────────────────────────────────────────────
section('Nettoyage')
await del(`/api/characters/${charId}`)

summary('CAS DUR — Mira complexe, OFF vs ON (fidélité/émotag/thinking/tokens)')
