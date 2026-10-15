// ── RÉGRESSION ÉTENDUE — opérations de conversation (ce qui marchait avant) ──
// Édition / variante / suppression / épingle / résumé / notes de scène / fork /
// garde-fous de compaction. Un seul appel LLM (pour semer un message) : le reste
// est de la manipulation de données stockées (zéro LLM) + les chemins d'erreur.
import { get, post, put, del, chatMessage, sleep, check, section, summary, BASE } from './lib.mjs'

const CHAR = 'Ops'

section('Setup — personnage + chat + 1 message (1 appel LLM)')
const created = await post('/api/characters', { name: CHAR, systemPrompt: 'Tu es Ops, un assistant concis. Réponds en une phrase.' })
check('personnage créé', created.status < 300, `status=${created.status}`)
const charId = created.data.id
const chat = await post(`/api/characters/${charId}/chats`, {})
const chatId = chat.data.id
check('chat créé', !!chatId)
const sent = await chatMessage(charId, chatId, 'Bonjour, comment tu t’appelles ?')
check('message LLM renvoyé (contenu non vide)', (sent.text || '').length > 0, `rép.=${sent.text?.slice(0, 60) || '(VIDE)'}`)

let full = (await get(`/api/characters/${charId}/chats/${chatId}`)).data
check('2 messages stockés (user + assistant)', full.messages.length === 2, `n=${full.messages.length}`)

// Édition d'un message
section('Édition de message')
const edit = await put('/api/chat/message', { characterId: charId, chatId, index: 0, content: 'Bonjour, quelle est ton identité ?' })
check('édition renvoyée', edit.status < 300 && edit.data?.message?.content === 'Bonjour, quelle est ton identité ?', `status=${edit.status}`)
full = (await get(`/api/characters/${charId}/chats/${chatId}`)).data
check('édition persistée', full.messages[0].content === 'Bonjour, quelle est ton identité ?')

// Épingle
section('Épingle')
const pin = await put('/api/chat/pin', { characterId: charId, chatId, pinned: 0 })
check('épinglage accepté', pin.status < 300, `status=${pin.status}`)
full = (await get(`/api/characters/${charId}/chats/${chatId}`)).data
check('épingle persistée (meta.pinned=0)', full.meta?.pinned === 0, `pinned=${full.meta?.pinned}`)
const unpin = await put('/api/chat/pin', { characterId: charId, chatId, pinned: null })
check('désépinglage', unpin.status < 300)

// Notes de scène
section('Notes de scène')
const scene = await put('/api/chat/scene', { characterId: charId, chatId, sceneNotes: 'Nous sommes dans un café, le soir.' })
check('notes de scène acceptées', scene.status < 300 && scene.data?.sceneNotes === 'Nous sommes dans un café, le soir.', `status=${scene.status}`)
full = (await get(`/api/characters/${charId}/chats/${chatId}`)).data
check('notes persistées', full.meta?.sceneNotes === 'Nous sommes dans un café, le soir.')
// Les notes de scène partent dans le contexte (buildPayload) : on les voit au preview.
const prev = (await get(`/api/prompt-preview?characterId=${charId}&chatId=${chatId}`)).data
check('notes de scène injectées au preview', prev.injected.includes('Nous sommes dans un café, le soir.'))

// Résumé : garde-fou (pas encore de résumé → noSummaryYet)
section('Résumé — garde-fou')
const sum400 = await put('/api/chat/summary', { characterId: charId, chatId, summary: 'un résumé' })
check('résumé sans compaction → 400 (noSummaryYet)', sum400.status === 400, `status=${sum400.status} code=${sum400.data?.code}`)

// Variante : garde-fou (le message n'a pas de variantes)
section('Variante — garde-fou')
const var400 = await put('/api/chat/variant', { characterId: charId, chatId, index: 1, variant: 0 })
check('variante absente → 400', var400.status === 400, `status=${var400.status} code=${var400.data?.code}`)

// Fork
section('Fork de conversation')
const fork = await post(`/api/characters/${charId}/chats/${chatId}/fork`, { title: 'Copie' })
check('fork créé', fork.status < 300 && fork.data?.id, `status=${fork.status}`)
const forkId = fork.data?.id
if (forkId) {
  const forkFull = (await get(`/api/characters/${charId}/chats/${forkId}`)).data
  check('fork a copié les messages', forkFull.messages.length === 2, `n=${forkFull.messages.length}`)
  const chatList = await get(`/api/characters/${charId}/chats`)
  check('les 2 conversations sont listées', chatList.data.some((c) => c.id === chatId) && chatList.data.some((c) => c.id === forkId))
}

// Compaction : garde-fou (trop peu de messages → nothingToCompact)
section('Compaction — garde-fou (fil court)')
const compact400 = await post('/api/chat/compact', { characterId: charId, chatId })
check('compaction fil court → 400 (nothingToCompact)', compact400.status === 400, `status=${compact400.status} code=${compact400.data?.code}`)

// Suppression de message
section('Suppression de message')
const delMsg = await del('/api/chat/message') // sans body → 400 (contrat), on teste le vrai ci-dessous
// DELETE avec body JSON :
const delRes = await fetch(`${BASE}/api/chat/message`, {
  method: 'DELETE',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ characterId: charId, chatId, index: 0 }),
})
const delData = await delRes.json().catch(() => null)
check('suppression du message 0', delRes.status < 300 && delData?.messageCount === 1, `status=${delRes.status} count=${delData?.messageCount}`)
full = (await get(`/api/characters/${charId}/chats/${chatId}`)).data
check('1 message restant après suppression', full.messages.length === 1, `n=${full.messages.length}`)

// Nettoyage
section('Nettoyage')
if (forkId) await del(`/api/characters/${charId}/chats/${forkId}`)
const dres = await del(`/api/characters/${charId}`)
check('personnage supprimé', dres.status < 300)

summary('RÉGRESSION ÉTENDUE — opérations de conversation')
