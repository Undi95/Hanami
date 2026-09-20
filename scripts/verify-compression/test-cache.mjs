// ── INVALIDATION DU CACHE PAR-FICHIER (Option B, logique du chantier B) ──────
// Chaque entrée de cache porte le hash de l'ORIGINAL (sourceHash). Si un
// fichier de faits BOUGE, SON entrée seule devient périmée → repli denseEncode
// pour ce fichier, TANDIS QUE les autres gardent leur compression agressive.
// Une seule compression (1 appel LLM), le reste est sans LLM (PUT + preview).
import { get, post, put, del, postLong, check, section, summary, sleep } from './lib.mjs'
import { MEMORY_FILES } from './fixture.mjs'

const CHAR = 'CacheTest'

section('Setup — personnage + 3 fichiers de faits + compression ON')
const created = await post('/api/characters', { name: CHAR, systemPrompt: 'Tu es un test.', llm: { compression: true } })
const charId = created.data.id
check('personnage créé', created.status < 300, `status=${created.status}`)
for (const [name, content] of Object.entries(MEMORY_FILES)) {
  await post(`/api/characters/${charId}/memory`, { name, content })
}
const chat = (await post(`/api/characters/${charId}/chats`, {})).data.id

section('Compression (1 appel LLM) → cache peuplé')
const comp = await postLong(`/api/characters/${charId}/memory/compress`)
check('compress ok', comp.status < 300 && comp.data?.ok === true, `status=${comp.status}`)
check('3 fichiers compressés', (comp.data?.llmFiles ?? 0) === 3, `llm=${comp.data?.llmFiles}`)
// La version agressive de travail.md est en cache : on la récupère.
const cache = JSON.parse((await import('node:fs')).readFileSync(`${process.env.HDATA}/characters/${charId}/compression-cache.json`, 'utf8'))
const aggTravail = cache.files?.['travail.md']?.content
const aggFamille = cache.files?.['famille.md']?.content
check('cache contient les versions agressives', !!aggTravail && !!aggFamille)

// Preview : les 3 fichiers partent en AGRESSIF (le cache est frais).
const before = (await get(`/api/prompt-preview?characterId=${charId}&chatId=${chat}`)).data
check('avant modif — travail en AGRESSIF', before.injected.includes(aggTravail))
check('avant modif — famille en AGRESSIF', before.injected.includes(aggFamille))

section('Modifier UN fichier (travail.md) → seule son entrée périt')
const newTravail = 'Mon bureau est à Marseille, dans le 1er arrondissement. Je suis architecte.'
const upd = await put(`/api/characters/${charId}/memory/travail.md`, { content: newTravail })
check('mise à jour de travail.md', upd.status < 300, `status=${upd.status}`)
await sleep(200)

const after = (await get(`/api/prompt-preview?characterId=${charId}&chatId=${chat}`)).data
check('après modif — travail NE PART PLUS en agressif (sourceHash périmé)', !after.injected.includes(aggTravail))
check('  … travail retombe en DENSE (original absent, « Marseille » présent)',
  !after.injected.includes(newTravail) && after.injected.includes('Marseille'))
check('  … la ville « Marseille » (nouveau fait) est là', after.injected.includes('Marseille'))
check('APRÈS modif — famille GARDE sa compression agressive', after.injected.includes(aggFamille))

section('Nettoyage')
await del(`/api/characters/${charId}`)
check('personnage supprimé', true)

summary('INVALIDATION DU CACHE PAR-FICHIER (Option B)')
