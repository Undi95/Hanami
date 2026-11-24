// Tests headless de « écrire à ma place » — `npm run test:impersonate`.
//
// AUCUNE donnée réelle, aucun vrai modèle : l'état entier de Hanami est déplacé
// dans un dossier temporaire jetable (HANAMI_DATA), avec un personnage jetable,
// et le backend est un faux serveur OpenAI lancé ici, qui note ce qu'on lui
// envoie.
//
// Ce qui est prouvé ici : la demande envoyée au modèle finit TOUJOURS sur un
// tour à compléter — le dernier message du personnage quand il a parlé en
// dernier, une note sinon (dernier message de l'utilisateur, fenêtre
// d'historique vide) ; le texte revient au client ; rien n'est écrit dans le
// fil ; une conversation vide est refusée.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hanami-impersonate-'))
// AVANT tout import du serveur : DATA_DIR se fige au chargement de storage.ts.
process.env.HANAMI_DATA = TMP

// ── Micro-harnais (le même que scripts/test-restore.ts) ─────────────────────

let passed = 0
const failures: string[] = []

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    passed++
    console.log(`  ok   ${name}`)
  } catch (e) {
    failures.push(`${name} — ${e instanceof Error ? e.message : String(e)}`)
    console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`)
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message)
}

function equal<T>(actual: T, expected: T, what: string): void {
  if (actual !== expected) throw new Error(`${what} : attendu ${String(expected)}, obtenu ${String(actual)}`)
}

// ── Faux backend OpenAI ─────────────────────────────────────────────────────
// Comme certains vrais backends, il PROLONGE une demande qui finit sur un tour
// « assistant » — et n'a alors rien à ajouter. Il ne rend du texte que si la
// demande finit sur un tour « user ».

interface Received {
  messages: { role: string; content: unknown }[]
  tools?: unknown[]
}

const REPLY = 'Tu es toujours là ?'
const requests: Received[] = []

function sse(delta: unknown, finish: string | null): string {
  return 'data: ' + JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n'
}

const backend = http.createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Received
    requests.push(body)
    const last = body.messages[body.messages.length - 1]
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (last?.role === 'user') res.write(sse({ content: REPLY }, null))
    res.write(sse({}, 'stop'))
    res.end('data: [DONE]\n\n')
  })
})

async function main(): Promise<void> {
  await new Promise<void>((r) => backend.listen(0, '127.0.0.1', r))
  const port = (backend.address() as AddressInfo).port

  const { saveSettings } = await import('../server/config')
  const storage = await import('../server/lib/storage')
  const { chatRouter } = await import('../server/api/chat')
  const express = (await import('express')).default

  saveSettings({ backendUrl: `http://127.0.0.1:${port}/v1`, model: 'faux', historyLimit: false })
  const character = storage.createCharacter({ name: 'Jetable', systemPrompt: "Tu es un personnage d'essai." })

  const app = express()
  app.use(express.json())
  app.use(chatRouter)
  const server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  type Turn = ['user' | 'assistant', string]
  const newChat = (title: string, turns: Turn[]): string => {
    const chat = storage.createChat(character.id, title)
    for (const [role, content] of turns) {
      storage.appendChatMessage(character.id, chat.id, { role, content, ts: new Date().toISOString() })
    }
    return chat.id
  }
  const fileOf = (chatId: string): string => path.join(TMP, 'characters', character.id, 'chats', `${chatId}.jsonl`)
  /** Joue « écrire à ma place » par la vraie route du chat ; rend ce que le client reçoit. */
  const impersonate = async (chatId: string): Promise<{ status: number; text: string; error: string }> => {
    const res = await fetch(api + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: character.id, chatId, mode: 'impersonate' }),
    })
    const raw = await res.text()
    let text = ''
    let error = ''
    for (const block of raw.split('\n\n')) {
      if (!block.startsWith('data: ')) continue
      const ev = JSON.parse(block.slice(6)) as { type: string; text?: string; code?: string }
      if (ev.type === 'delta') text += ev.text ?? ''
      if (ev.type === 'error') error = ev.code ?? 'erreur sans code'
    }
    return { status: res.status, text, error }
  }
  const sent = (): Received['messages'] => requests[requests.length - 1].messages
  const roles = (): string =>
    sent()
      .map((m) => m.role)
      .join(' ')

  console.log('\nÉcrire à ma place')

  await check('le personnage a parlé en dernier : la demande part telle quelle, sans note', async () => {
    const id = newChat('perso-dernier', [
      ['assistant', 'Bonjour.'],
      ['user', 'Salut.'],
      ['assistant', 'Tu vas bien ?'],
    ])
    const before = fs.readFileSync(fileOf(id), 'utf8')
    const r = await impersonate(id)
    equal(r.status, 200, 'statut')
    equal(r.error, '', 'erreur')
    equal(r.text, REPLY, 'texte rendu au client')
    equal(roles(), 'system user assistant user', 'rôles envoyés (échangés)')
    equal(sent()[1].content, 'Bonjour.', 'tour du personnage, côté « user »')
    equal(sent()[2].content, 'Salut.', "tour de l'utilisateur, côté « assistant »")
    equal(sent()[3].content, 'Tu vas bien ?', 'dernier tour = dernier message du personnage')
    equal(requests[requests.length - 1].tools, undefined, 'aucun outil exposé')
    equal(fs.readFileSync(fileOf(id), 'utf8'), before, 'fil inchangé sur le disque')
  })

  await check("le dernier message est celui de l'utilisateur : une note tient la place du tour manquant, un texte revient", async () => {
    const id = newChat('moi-dernier', [
      ['assistant', 'Bonjour.'],
      ['user', 'Salut.'],
    ])
    const before = fs.readFileSync(fileOf(id), 'utf8')
    const r = await impersonate(id)
    equal(r.status, 200, 'statut')
    equal(r.error, '', 'erreur')
    equal(r.text, REPLY, 'texte rendu au client')
    equal(roles(), 'system user assistant user', 'rôles envoyés')
    equal(sent()[2].content, 'Salut.', "le message de l'utilisateur reste à sa place")
    const note = String(sent()[3].content)
    assert(note.startsWith('[') && note.endsWith(']'), 'la note est entre crochets')
    assert(note.includes('Jetable') && note.includes('has not replied yet'), "la note dit que le personnage n'a pas répondu")
    assert(note.includes('the message above is yours'), 'la note dit à qui est le dernier message')
    assert(note.includes('follow-up') && note.includes('not an answer'), "la note demande une suite, pas une réponse")
    equal(fs.readFileSync(fileOf(id), 'utf8'), before, 'fil inchangé sur le disque')
  })

  await check("deux messages de l'utilisateur à la suite : une seule note, à la fin", async () => {
    const id = newChat('moi-deux-fois', [
      ['assistant', 'Bonjour.'],
      ['user', 'Salut.'],
      ['user', 'Tu es là ?'],
    ])
    const r = await impersonate(id)
    equal(r.error, '', 'erreur')
    equal(r.text, REPLY, 'texte rendu au client')
    equal(roles(), 'system user assistant assistant user', 'rôles envoyés')
    equal(sent().filter((m) => String(m.content).startsWith('[')).length, 1, 'notes dans la demande')
  })

  await check("fenêtre d'historique vide : la demande finit quand même sur un tour à compléter, sans prétendre qu'une réponse manque", async () => {
    const id = newChat('fenetre-vide', [
      ['assistant', 'Bonjour.'],
      ['user', 'Salut.'],
      ['assistant', 'Tu vas bien ?'],
    ])
    saveSettings({ historyLimit: true, maxHistoryMessages: 0 })
    let r: Awaited<ReturnType<typeof impersonate>>
    try {
      r = await impersonate(id)
    } finally {
      saveSettings({ historyLimit: false })
    }
    equal(r.error, '', 'erreur')
    equal(r.text, REPLY, 'texte rendu au client')
    equal(roles(), 'system user', 'rôles envoyés')
    const note = String(sent()[1].content)
    assert(note.startsWith('[') && note.includes('Jetable'), 'la note nomme le personnage')
    assert(!note.includes('has not replied'), "la note ne prétend pas qu'une réponse manque")
  })

  await check('conversation vide : refusée, aucun appel au modèle', async () => {
    const id = newChat('vide', [])
    const avant = requests.length
    const r = await impersonate(id)
    equal(r.status, 400, 'statut')
    equal(requests.length, avant, 'appels au modèle')
  })

  server.close()
}

main()
  .catch((e) => {
    failures.push(`erreur hors test — ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
  })
  .finally(() => {
    backend.close()
    // Chemins garantis ASCII (dossier temporaire, « Jetable ») : rmSync y est sûr.
    fs.rmSync(TMP, { recursive: true, force: true })
    console.log(`\n${passed} réussis, ${failures.length} en échec`)
    for (const f of failures) console.log('  - ' + f)
    process.exit(failures.length ? 1 : 0)
  })
