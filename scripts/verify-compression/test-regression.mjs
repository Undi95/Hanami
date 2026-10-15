// ── RÉGRESSION + STRUCTURE DE COMPRESSION + RÉVERSIBILITÉ (SANS LLM) ────────
// Toute la logique d'API + la forme du contexte compressé (denseEncode,
// déterministe, zéro LLM) se vérifie ici via /api/prompt-preview. Le LLM réel
// est réservé à test-llm.mjs (rappel / fidélité / compression agressive).
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { get, post, put, del, check, section, summary } from './lib.mjs'
import { SYSTEM_PROMPT, MEMORY_FILES, PERSONA } from './fixture.mjs'

const HDATA = process.env.HDATA
const CHAR = 'Regresso'

function memoryHashes(charId) {
  // Hash du contenu de CHAQUE fichier mémoire — pour prouver que la compression
  // (une vue) ne touche JAMAIS les .md sur disque.
  const dir = `${HDATA}/characters/${charId}/memory`
  const out = {}
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue
      out[f] = createHash('sha256').update(readFileSync(`${dir}/${f}`)).digest('hex')
    }
  } catch {
    /* pas encore de mémoire */
  }
  return out
}

// 1. Persona dans les réglages (le personnage l'épinglera).
section('Setup — persona + personnage jetable')
await put('/api/settings', { userPersonas: [PERSONA], defaultPersona: PERSONA.id })
const created = await post('/api/characters', {
  name: CHAR,
  systemPrompt: SYSTEM_PROMPT,
  llm: {}, // compression ABSENTE = éteinte (défaut)
})
check('personnage créé', created.status < 300, `status=${created.status}`)
const charId = created.data.id
if (!charId) {
  console.log('ÉCHEC CRITIQUE : pas d’id de personnage')
  summary('RÉGRESSION')
  process.exit(1)
}
console.log(`  id = ${charId}`)
for (const [name, content] of Object.entries(MEMORY_FILES)) {
  const r = await post(`/api/characters/${charId}/memory`, { name, content })
  if (r.status >= 300) check(`mémoire ${name} créée`, false, `status=${r.status}`)
}
check('3 fichiers mémoire créés', Object.keys(MEMORY_FILES).length === 3)
// Hash des fichiers de FAITS (ce que la compression LIT). L'index MEMORY.md et
// moments.md (créé par « retenir ça ») sont légitimement écrits par AUTRES
// features — ils ne sont pas l'objet du test de réversibilité de la compression.
const allBefore = memoryHashes(charId)
const hashesBefore = Object.fromEntries(
  Object.keys(MEMORY_FILES)
    .filter((f) => f in allBefore)
    .map((f) => [f, allBefore[f]]),
)
check('fichiers de faits lisibles sur disque', Object.keys(hashesBefore).length === 3, `fichiers=${Object.keys(hashesBefore).join(',')}`)

// 2. CRUD personnage
section('CRUD personnage (régression)')
const list = await get('/api/characters')
check('list contient le perso', Array.isArray(list.data) && list.data.some((c) => c.id === charId))
const full = await get(`/api/characters/${charId}`)
check('GET full — prompt intact', full.data.systemPrompt === SYSTEM_PROMPT)
const renamed = await put(`/api/characters/${charId}`, { name: 'Regresso2', systemPrompt: SYSTEM_PROMPT })
check('PUT renomme', renamed.status < 300 && renamed.data.name === 'Regresso2', `status=${renamed.status}`)
await put(`/api/characters/${charId}`, { name: CHAR, systemPrompt: SYSTEM_PROMPT })

// 3. Conversations
section('Conversations (régression)')
const chat = await post(`/api/characters/${charId}/chats`, {})
check('chat créé', chat.status < 300 && chat.data.id, `status=${chat.status}`)
const chatId = chat.data.id
const chatList = await get(`/api/characters/${charId}/chats`)
check('liste chats contient le chat', Array.isArray(chatList.data) && chatList.data.some((c) => c.id === chatId))
const chatFull = await get(`/api/characters/${charId}/chats/${chatId}`)
check('GET chat', chatFull.status < 300)

// 4. CRUD mémoire
section('CRUD mémoire (régression)')
const mf = await post(`/api/characters/${charId}/memory`, { name: 'temp-test.md', content: 'contenu temporaire' })
check('create fichier mémoire', mf.status < 300)
const memList = await get(`/api/characters/${charId}/memory`)
check('list mémoire contient le fichier', Array.isArray(memList.data.files) && memList.data.files.some((f) => f.name === 'temp-test.md'))
const mfUpd = await put(`/api/characters/${charId}/memory/temp-test.md`, { content: 'contenu modifié' })
check('update fichier mémoire', mfUpd.status < 300)
const mfDel = await del(`/api/characters/${charId}/memory/temp-test.md`)
check('delete fichier mémoire', mfDel.status < 300)
const memAfter = await get(`/api/characters/${charId}/memory`)
check('fichier supprimé de la liste', !memAfter.data.files.some((f) => f.name === 'temp-test.md'))
const rem = await post(`/api/characters/${charId}/memory/remember`, { text: 'Nous avons fait un câlin aujourd’hui.' })
check('« retenir ça »', rem.status < 300, `status=${rem.status}`)

// 5. Réglages
section('Réglages (régression)')
const settings = await get('/api/settings')
check('persona dans settings', Array.isArray(settings.data.userPersonas) && settings.data.userPersonas.some((p) => p.id === PERSONA.id))

// 6. COMPRESSION — structure (denseEncode, zéro LLM) via prompt-preview
section('Compression OFF (contexte original)')
const previewOff = await get(`/api/prompt-preview?characterId=${charId}&chatId=${chatId}`)
check('prompt-preview répond', previewOff.status === 200, `status=${previewOff.status}`)
const pOff = previewOff.data
check('characterPrompt = sysprompt ORIGINAL', pOff.characterPrompt === SYSTEM_PROMPT)
check('mémoire injectée VERBATIM (famille entière présente)', pOff.injected.includes(MEMORY_FILES['famille.md']), '')
const tokensOff = pOff.tokens
console.log(`  tokens OFF ≈ ${tokensOff}`)
// Dump court pour observation (denseEncode est déterministe)
console.log(`  [off] injected (extrait) : ${pOff.injected.slice(0, 160).replace(/\n/g, '⏎')}`)

// Chantier B, contrat RÉVISÉ (mesuré sur le cas dur — voir test-complex.mjs) :
//   sysprompt + persona partent VERBATIM (denseEncode corrompait la prose narrative
//   → traits inversés, mots cassés, émotags perdus) ; SEULE la mémoire est densifiée.
section('Compression ON (mémoire densifiée — sysprompt + persona VERBATIM)')
await put(`/api/characters/${charId}`, { llm: { compression: true } })
const previewOn = await get(`/api/prompt-preview?characterId=${charId}&chatId=${chatId}`)
const pOn = previewOn.data
check('characterPrompt VERBATIM (= original — le prompt n’est JAMAIS compressé)', pOn.characterPrompt === SYSTEM_PROMPT)
// Mémoire : l'original verbatim n'est PLUS là (densifié), mais les faits durs restent.
check('mémoire DENSIFIÉE (famille originale ABSENTE en verbatim)', !pOn.injected.includes(MEMORY_FILES['famille.md']))
check('  … mais le nom « Claire » reste', pOn.injected.includes('Claire'))
check('  … mais la ville « Lyon » reste', pOn.injected.includes('Lyon'))
check('  … mais le chiffre « 3 » (chat) reste', /3/.test(pOn.injected))
const tokensOn = pOn.tokens
console.log(`  tokens ON(dense) ≈ ${tokensOn}  →  gain ${tokensOff > 0 ? Math.round((1 - tokensOn / tokensOff) * 100) : 0} %`)
check('tokens RÉDUITS (ON < OFF)', tokensOn < tokensOff, `${tokensOn} vs ${tokensOff}`)
console.log(`  [on] characterPrompt (extrait) : ${pOn.characterPrompt.slice(0, 160).replace(/\n/g, '⏎')}`)
console.log(`  [on] injected (extrait) : ${pOn.injected.slice(0, 200).replace(/\n/g, '⏎')}`)

// 7. RÉVERSIBILITÉ
section('Réversibilité')
// On ne compare que les fichiers PRÉ-EXISTANTS (le « retenir ça » de la section
// CRUD a légitimement créé moments.md : un fichier NOUVEAU ne doit pas fausser
// la vérification — ce qu'on teste est que la compression n'a PAS MODIFIÉ les
// fichiers de faits qui existaient déjà).
const intactSubset = (h) => Object.entries(hashesBefore).every(([f, hh]) => h[f] === hh)
const diffOf = (h) => Object.entries(hashesBefore).filter(([f, hh]) => h[f] !== hh).map(([f]) => f)
const hashesMid = memoryHashes(charId)
check('.md mémoire INTACTS après compression (vue, pas écriture)', diffOf(hashesMid).length === 0, `diffèrent: ${diffOf(hashesMid).join(', ') || '—'}`)
// Éteindre le toggle → contexte ORIGINAL.
await put(`/api/characters/${charId}`, { llm: { compression: false } })
const previewOff2 = await get(`/api/prompt-preview?characterId=${charId}&chatId=${chatId}`)
check('toggle OFF → characterPrompt ORIGINAL', previewOff2.data.characterPrompt === SYSTEM_PROMPT)
check('toggle OFF → mémoire VERBATIM de retour', previewOff2.data.injected.includes(MEMORY_FILES['famille.md']))
const hashesEnd = memoryHashes(charId)
check('.md mémoire INTACTS en fin de test', diffOf(hashesEnd).length === 0, `diffèrent: ${diffOf(hashesEnd).join(', ') || '—'}`)

// 8. Nettoyage
section('Nettoyage')
const dres = await del(`/api/characters/${charId}`)
check('personnage supprimé', dres.status < 300, `status=${dres.status}`)

summary('RÉGRESSION + COMPRESSION (structure, sans LLM)')
