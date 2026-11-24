// Tests headless des tours autonomes — `npm run test:autonomous`.
//
// AUCUNE donnée réelle, aucun vrai modèle : l'état entier de Hanami est déplacé
// dans un dossier temporaire jetable (HANAMI_DATA), avec un personnage jetable,
// et le backend est un faux serveur OpenAI lancé ici, qui joue un scénario écrit
// d'avance et note ce qu'on lui envoie.
//
// Ce qui est prouvé ici : un tour ne se joue que quand rien n'attend ; ce qu'il
// écrit devient un message marqué `autonomous` ; le silence ne laisse rien ; les
// outils sont joués et tracés ; la garde anti-flot ; l'abandon quand
// l'utilisateur écrit pendant le tour ; le minuteur, ses bornes et sa boucle
// (horloge injectée : rien n'attend pour de vrai) ; la ligne de console de
// chaque tour, sans contenu ; le journal des tours (ce qui s'y écrit, ce qui s'y
// fond, ses plafonds, sa lecture par l'API) et le bloc qui le rend au
// personnage ; le passage de main à l'utilisateur (chat, compaction, mémoire) ;
// et que les messages spontanés se taisent quand les tours autonomes sont
// allumés.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { ChatMessage, TurnLogEntry } from '../shared/types'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hanami-autonome-'))
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

interface Step {
  content?: string
  thinking?: string // raisonnement, émis en reasoning_content avant le texte
  toolCalls?: { name: string; arguments: string }[]
  delayMs?: number
}

const script: Step[] = []
const requests: { messages: { role: string; content: unknown }[]; tools?: unknown[] }[] = []

function sse(delta: unknown, finish: string | null): string {
  return 'data: ' + JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n'
}

const backend = http.createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
    const step = script.shift() ?? { content: '(silence)' }
    // Un vrai modèle pense d'abord, puis répond : le raisonnement part dès que
    // la réponse commence, et c'est la suite qui attend le délai du scénario.
    let started = false
    const start = (): void => {
      if (started || res.destroyed) return
      started = true
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (step.thinking) res.write(sse({ reasoning_content: step.thinking }, null))
    }
    const send = (): void => {
      if (res.destroyed) return
      start()
      if (step.toolCalls) {
        res.write(
          sse(
            {
              tool_calls: step.toolCalls.map((tc, index) => ({
                index,
                id: `call_${requests.length}_${index}`,
                type: 'function',
                function: { name: tc.name, arguments: tc.arguments },
              })),
            },
            null,
          ),
        )
        res.write(sse({}, 'tool_calls'))
      } else {
        res.write(sse({ content: step.content ?? '' }, null))
        res.write(sse({}, 'stop'))
      }
      res.end('data: [DONE]\n\n')
    }
    if (step.delayMs) {
      start()
      setTimeout(send, step.delayMs)
    } else send()
  })
})

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  await new Promise<void>((r) => backend.listen(0, '127.0.0.1', r))
  const port = (backend.address() as AddressInfo).port

  const { loadSettings, saveSettings, AUTONOMOUS_PACE_MIN, AUTONOMOUS_PACE_MAX } = await import('../server/config')
  const storage = await import('../server/lib/storage')
  const auto = await import('../server/lib/autonomous')
  const { runSpontaneousTick } = await import('../server/lib/spontaneous')

  saveSettings({
    backendUrl: `http://127.0.0.1:${port}/v1`,
    model: 'faux',
    memoryEnabled: true,
    autonomousEnabled: false,
    autonomousPaceSeconds: 60,
  })
  const character = storage.createCharacter({ name: 'Jetable', systemPrompt: "Tu es un personnage d'essai." })
  const chat = storage.createChat(character.id, 'essai')
  fs.writeFileSync(path.join(TMP, 'ui.json'), JSON.stringify({ activeCharacter: character.id, activeChat: { [character.id]: chat.id } }))

  const messages = (): ChatMessage[] => storage.readChat(character.id, chat.id).messages
  const say = (role: 'user' | 'assistant', content: string, ts = new Date().toISOString()): void =>
    storage.appendChatMessage(character.id, chat.id, { role, content, ts })
  const lastRequest = (): (typeof requests)[number] => requests[requests.length - 1]

  console.log('\nTours autonomes')

  await check('éteint : aucun tour, aucun appel au modèle', async () => {
    say('assistant', 'Bonjour.')
    equal(await auto.runAutonomousTurn(), 'off', 'issue')
    equal(requests.length, 0, 'appels au modèle')
  })

  saveSettings({ autonomousEnabled: true })

  await check('conversation vide : ce moteur ne l\'ouvre pas', async () => {
    const vide = storage.createChat(character.id, 'vide')
    fs.writeFileSync(path.join(TMP, 'ui.json'), JSON.stringify({ activeCharacter: character.id, activeChat: { [character.id]: vide.id } }))
    equal(await auto.runAutonomousTurn(), 'empty', 'issue')
    fs.writeFileSync(path.join(TMP, 'ui.json'), JSON.stringify({ activeCharacter: character.id, activeChat: { [character.id]: chat.id } }))
    equal(requests.length, 0, 'appels au modèle')
  })

  await check('il écrit : le message est ajouté, marqué autonome, avec son émotion ; la consigne part au modèle sans être sauvegardée', async () => {
    script.push({ content: '[happy] Je pensais à quelque chose.' })
    equal(await auto.runAutonomousTurn(), 'spoke', 'issue')
    const m = messages()
    equal(m.length, 2, 'messages dans la conversation')
    equal(m[1].content, '[happy] Je pensais à quelque chose.', 'texte')
    equal(m[1].autonomous, true, 'marque autonomous')
    equal(m[1].emotion, 'happy', 'émotion')
    equal(m[1].role, 'assistant', 'rôle')
    const sent = lastRequest().messages
    const directive = String(sent[sent.length - 1].content)
    equal(sent[sent.length - 1].role, 'user', 'rôle de la consigne')
    assert(directive.includes('turn of your own') && directive.includes(auto.SILENCE), 'la consigne du tour doit partir en dernier message')
    assert(!m.some((x) => x.content.includes('turn of your own')), 'la consigne ne doit jamais être sauvegardée')
    assert(Array.isArray(lastRequest().tools) && lastRequest().tools!.length > 0, 'les outils des réglages doivent être proposés')
  })

  await check('silence : rien n\'est ajouté, sous toutes ses écritures', async () => {
    for (const texte of ['(silence)', '[relaxed] (silence).', 'Silence', '   ', '(SILENCE)…']) {
      script.push({ content: texte })
      equal(await auto.runAutonomousTurn(), 'silent', `issue pour « ${texte} »`)
    }
    equal(messages().length, 2, 'messages dans la conversation')
    assert(auto.isSilence('') && !auto.isSilence('Le silence est beau ce soir.') && !auto.isSilence('(silence) mais en fait non'), 'isSilence')
  })

  await check('outils : joués, tracés sur le message, et leur effet reste', async () => {
    script.push({ toolCalls: [{ name: 'memory_save', arguments: JSON.stringify({ name: 'essai.md', content: 'Un fait.' }) }] })
    script.push({ content: 'C\'est noté.' })
    equal(await auto.runAutonomousTurn(), 'spoke', 'issue')
    const m = messages()
    equal(m.length, 3, 'messages dans la conversation')
    equal(m[2].tools?.length, 1, 'traces')
    equal(m[2].tools?.[0].name, 'memory_save', 'outil tracé')
    equal(storage.readMemoryFile(character.id, 'essai.md')?.trim(), 'Un fait.', 'fichier de mémoire écrit')
    const sent = lastRequest().messages
    assert(sent.some((x) => x.role === 'tool'), 'le résultat de l\'outil doit revenir au modèle')
  })

  await check('outil que les réglages n\'offrent pas : refusé, jamais exécuté', async () => {
    script.push({ toolCalls: [{ name: 'write_file', arguments: JSON.stringify({ path: 'x.txt', content: 'x' }) }] })
    script.push({ content: '(silence)' })
    equal(await auto.runAutonomousTurn(), 'silent', 'issue')
    const outil = lastRequest().messages.find((x) => x.role === 'tool')
    assert(String(outil?.content).startsWith('Error: tool not offered'), 'l\'outil non offert doit être rendu en erreur')
    assert(!fs.existsSync(path.join(loadSettings().toolsRoot, 'x.txt')), 'aucun fichier ne doit être écrit')
  })

  await check('garde anti-flot : après trois messages sans réponse, plus aucun tour', async () => {
    script.push({ content: 'Encore moi.' })
    equal(await auto.runAutonomousTurn(), 'spoke', 'troisième message')
    equal(auto.unansweredCount(messages()), auto.MAX_UNANSWERED, 'messages sans réponse')
    const avant = requests.length
    equal(await auto.runAutonomousTurn(), 'capped', 'issue')
    equal(requests.length, avant, 'appels au modèle')
  })

  await check('l\'utilisateur a écrit : une réponse est due, le moteur n\'y touche pas', async () => {
    say('user', 'Je suis là.')
    const avant = requests.length
    equal(await auto.runAutonomousTurn(), 'waiting-user', 'issue')
    equal(requests.length, avant, 'appels au modèle')
    say('assistant', 'Content de te voir.')
    equal(auto.unansweredCount(messages()), 0, 'la garde est levée par le retour de l\'utilisateur')
    script.push({ content: 'Un tour de plus.' })
    equal(await auto.runAutonomousTurn(), 'spoke', 'les tours reprennent')
  })

  await check('l\'utilisateur écrit PENDANT un tour : le tour est abandonné, rien n\'est ajouté derrière lui', async () => {
    script.push({ content: 'Trop tard.', delayMs: 4000 })
    const debut = Date.now()
    const tour = auto.runAutonomousTurn()
    await sleep(300)
    equal(await auto.runAutonomousTurn(), 'busy', 'un seul tour à la fois')
    say('user', 'Attends !')
    equal(await tour, 'moved', 'issue')
    assert(Date.now() - debut < 3500, 'le tour doit être abandonné sans attendre la fin de la génération')
    const m = messages()
    equal(m[m.length - 1].content, 'Attends !', 'dernier message')
    say('assistant', 'Oui ?')
  })

  await check('l\'utilisateur écrit pendant un tour COURT (fini avant la surveillance) : le message du tour n\'est pas ajouté', async () => {
    script.push({ content: 'Je voulais dire…', delayMs: 400 })
    const tour = auto.runAutonomousTurn()
    await sleep(100)
    say('user', 'Une question.')
    equal(await tour, 'moved', 'issue')
    const m = messages()
    equal(m[m.length - 1].content, 'Une question.', 'dernier message')
    assert(!m.some((x) => x.content === 'Je voulais dire…'), 'le message du tour ne doit pas être écrit')
    say('assistant', 'Dis-moi.')
  })

  await check('l\'heure est donnée au tour même si le réglage général la coupe', async () => {
    saveSettings({ timeAwareness: false })
    script.push({ content: '(silence)' })
    equal(await auto.runAutonomousTurn(), 'silent', 'issue')
    saveSettings({ timeAwareness: true })
    // Par son titre, pas par l'année : le bloc des tours porte des dates lui aussi.
    assert(String(lastRequest().messages[0].content).includes('## Current date and time'), 'le bloc de l\'heure doit être dans le texte système')
  })

  await check('backend en panne : une erreur notée, rien d\'ajouté, pas de verrou resté posé', async () => {
    const n = messages().length
    saveSettings({ backendUrl: 'http://127.0.0.1:9/v1' })
    equal(await auto.runAutonomousTurn(), 'error', 'issue')
    saveSettings({ backendUrl: `http://127.0.0.1:${port}/v1` })
    equal(messages().length, n, 'messages dans la conversation')
    script.push({ content: '(silence)' })
    equal(await auto.runAutonomousTurn(), 'silent', 'le tour suivant se joue')
  })

  console.log('\nMinuteur')

  await check('le minuteur compte de la fin d\'un tour au suivant', () => {
    assert(!auto.isDue(59_999, 0, 60), 'pas encore écoulé')
    assert(auto.isDue(60_000, 0, 60), 'écoulé')
    assert(!auto.isDue(1_000_000 + 9_999, 1_000_000, 10) && auto.isDue(1_000_000 + 10_000, 1_000_000, 10), 'relatif à la fin du tour précédent')
  })

  await check('le réglage du minuteur : gardé dans ses bornes, sinon le défaut', () => {
    equal(loadSettings().autonomousPaceSeconds, 60, 'valeur enregistrée')
    for (const [valeur, attendu] of [
      [AUTONOMOUS_PACE_MIN, AUTONOMOUS_PACE_MIN],
      [AUTONOMOUS_PACE_MAX, AUTONOMOUS_PACE_MAX],
      [AUTONOMOUS_PACE_MIN - 1, 300],
      [AUTONOMOUS_PACE_MAX + 1, 300],
      [12.5, 300],
      [0, 300],
    ] as const) {
      saveSettings({ autonomousPaceSeconds: valeur })
      equal(loadSettings().autonomousPaceSeconds, attendu, `minuteur pour ${valeur}`)
    }
  })

  // La boucle elle-même : `beat` est ce que setInterval appelle toutes les cinq
  // secondes. L'horloge est une variable d'ici : aucun essai n'attend un minuteur.

  await check("la boucle : aucun tour à l'allumage, puis un tour à chaque minuteur écoulé, jamais avant", async () => {
    saveSettings({ autonomousEnabled: true, autonomousPaceSeconds: 60 })
    let t = 5_000_000
    const state = auto.newPaceState(0)
    const avant = requests.length
    equal(auto.beat(state, () => t), null, "battement d'allumage")
    equal(state.lastEnd, t, "le minuteur part de l'allumage")
    t += 59_999
    equal(auto.beat(state, () => t), null, 'minuteur pas encore écoulé')
    equal(requests.length, avant, 'appels au modèle avant le minuteur')
    t += 1
    const tour = auto.beat(state, () => t)
    assert(tour !== null, 'le minuteur écoulé doit lancer un tour')
    equal(await tour, 'silent', 'issue du tour')
    equal(requests.length, avant + 1, 'appels au modèle')
    equal(auto.beat(state, () => t), null, 'pas de second tour sans un minuteur entier')
    t += 60_000
    equal(await auto.beat(state, () => t), 'silent', 'tour suivant')
    equal(requests.length, avant + 2, 'appels au modèle')
  })

  await check('la boucle : changer le minuteur dans les réglages prend effet au battement suivant ; éteindre arrête, rallumer repart de zéro', async () => {
    let t = 6_000_000
    const state = auto.newPaceState(0)
    saveSettings({ autonomousEnabled: true, autonomousPaceSeconds: 3600 })
    equal(auto.beat(state, () => t), null, "battement d'allumage")
    t += 10_000
    equal(auto.beat(state, () => t), null, 'une heure demandée : dix secondes ne suffisent pas')
    saveSettings({ autonomousPaceSeconds: 10 })
    equal(await auto.beat(state, () => t), 'silent', 'dix secondes demandées : le tour part')
    saveSettings({ autonomousEnabled: false })
    t += 3_600_000
    const avant = requests.length
    equal(auto.beat(state, () => t), null, 'éteint : aucun tour')
    saveSettings({ autonomousEnabled: true })
    equal(auto.beat(state, () => t), null, 'rallumé : pas de tour tout de suite')
    t += 9_999
    equal(auto.beat(state, () => t), null, 'rallumé : pas avant un minuteur entier')
    equal(requests.length, avant, 'appels au modèle')
    t += 1
    equal(await auto.beat(state, () => t), 'silent', 'rallumé : un tour après un minuteur entier')
  })

  await check("la boucle : pendant un tour long aucun autre ne part, et le minuteur repart de sa FIN", async () => {
    saveSettings({ autonomousEnabled: true, autonomousPaceSeconds: 60 })
    let t = 7_000_000
    const state = auto.newPaceState(0)
    equal(auto.beat(state, () => t), null, "battement d'allumage")
    t += 60_000
    script.push({ content: '(silence)', delayMs: 600 })
    const avant = requests.length
    const tour = auto.beat(state, () => t)
    assert(tour !== null, 'le tour doit partir')
    await sleep(200)
    t += 500_000 // le tour dure : l'horloge dépasse largement un minuteur
    equal(auto.beat(state, () => t), null, 'un tour est en cours : aucun autre ne part')
    equal(await tour, 'silent', 'issue')
    equal(requests.length, avant + 1, 'appels au modèle')
    equal(state.lastEnd, t, 'le minuteur repart de la fin du tour')
    t += 59_999
    equal(auto.beat(state, () => t), null, 'pas avant un minuteur entier après la fin')
    t += 1
    equal(await auto.beat(state, () => t), 'silent', 'un minuteur entier après la fin')
  })

  console.log('\nConsole')

  // Les lignes « [autonomous] … » écrites pendant fn, sans leur préfixe.
  const captured = async (fn: () => Promise<void>): Promise<string[]> => {
    const lines: string[] = []
    const original = console.log
    console.log = (...args: unknown[]): void => {
      const line = args.map(String).join(' ')
      if (line.startsWith('[autonomous] ')) lines.push(line.slice('[autonomous] '.length))
      else original(...args)
    }
    try {
      await fn()
    } finally {
      console.log = original
    }
    return lines
  }

  await check('console : chaque tour joué laisse sa ligne, une attente ne se répète pas, et jamais de contenu', async () => {
    saveSettings({ autonomousEnabled: true, autonomousPaceSeconds: 10 })
    let t = 8_000_000
    const state = auto.newPaceState(0)
    const lignes = await captured(async () => {
      auto.beat(state, () => t) // allumage
      script.push({ toolCalls: [{ name: 'memory_save', arguments: JSON.stringify({ name: 'secret.md', content: 'TEXTE-A-NE-PAS-MONTRER' }) }] })
      script.push({ content: '(silence)' })
      t += 10_000
      await auto.beat(state, () => t) // silence, un outil
      t += 10_000
      await auto.beat(state, () => t) // silence, sans outil
      say('user', 'Je reviens.')
      for (let i = 0; i < 3; i++) {
        t += 10_000
        await auto.beat(state, () => t) // trois battements où une réponse est due
      }
      say('assistant', 'Me revoilà.')
      script.push({ content: 'MESSAGE-A-NE-PAS-MONTRER' })
      t += 10_000
      await auto.beat(state, () => t) // il écrit
      saveSettings({ autonomousEnabled: false })
      auto.beat(state, () => t) // extinction
      auto.beat(state, () => t) // toujours éteint : rien de plus
    })
    saveSettings({ autonomousEnabled: true })
    equal(lignes.length, 6, 'lignes de console ' + JSON.stringify(lignes))
    assert(lignes[0].startsWith('allumé') && lignes[0].includes('10 s'), "ligne d'allumage, avec le minuteur")
    assert(lignes[1].includes('silence') && lignes[1].includes("1 appel d'outil"), 'tour silencieux, son outil compté')
    assert(lignes[2].includes('silence') && !lignes[2].includes('outil'), 'tour silencieux sans outil')
    assert(lignes[3].includes('réponse est due'), 'attente notée une seule fois')
    assert(lignes[4].includes('message écrit'), 'message noté')
    equal(lignes[5], 'éteint', "ligne d'extinction")
    assert(!lignes.join('\n').includes('NE-PAS-MONTRER'), 'aucun contenu ne doit paraître en console')
    equal(storage.readMemoryFile(character.id, 'secret.md')?.trim(), 'TEXTE-A-NE-PAS-MONTRER', "l'outil du tour silencieux a bien été joué")
  })

  await check("console : après un rallumage, la raison d'une attente est redite", async () => {
    saveSettings({ autonomousEnabled: true, autonomousPaceSeconds: 10 })
    let t = 9_000_000
    const state = auto.newPaceState(0)
    say('user', 'Encore moi.')
    const lignes = await captured(async () => {
      auto.beat(state, () => t) // allumage
      t += 10_000
      await auto.beat(state, () => t) // une réponse est due
      saveSettings({ autonomousEnabled: false })
      auto.beat(state, () => t) // extinction
      saveSettings({ autonomousEnabled: true })
      auto.beat(state, () => t) // rallumage
      t += 10_000
      await auto.beat(state, () => t) // une réponse est toujours due
    })
    say('assistant', 'Oui.')
    equal(lignes.filter((l) => l.includes('réponse est due')).length, 2, 'attente redite après le rallumage ' + JSON.stringify(lignes))
  })

  await check('console : les règles de la ligne', () => {
    for (const joue of ['silent', 'spoke', 'moved', 'error'] as const) {
      assert(auto.shouldLog(joue, joue), `un tour joué se note même s'il se répète (${joue})`)
      assert(auto.turnLine(joue, 0) !== '', `ligne pour ${joue}`)
    }
    for (const attente of ['waiting-user', 'capped', 'empty', 'no-target'] as const) {
      assert(auto.shouldLog(attente, null) && auto.shouldLog(attente, 'silent'), `une attente se note quand elle commence (${attente})`)
      assert(!auto.shouldLog(attente, attente), `une attente ne se répète pas (${attente})`)
      assert(auto.turnLine(attente, 0).startsWith('pas de tour'), `ligne pour ${attente}`)
    }
    for (const jamais of ['off', 'busy'] as const) {
      assert(!auto.shouldLog(jamais, null), `${jamais} ne se note jamais`)
    }
    assert(auto.turnLine('silent', 2).includes("2 appels d'outil"), 'pluriel')
    assert(auto.turnLine('capped', 0).includes(String(auto.MAX_UNANSWERED)), 'la garde dit son nombre')
  })

  console.log('\nJournal des tours')

  const { buildPayload, turnLogBlock } = await import('../server/api/chat')
  const { charactersRouter } = await import('../server/api/characters')
  const express = (await import('express')).default

  // Une conversation neuve : le journal y part de zéro.
  const journal = storage.createChat(character.id, 'journal')
  const setActive = (chatId: string): void =>
    fs.writeFileSync(path.join(TMP, 'ui.json'), JSON.stringify({ activeCharacter: character.id, activeChat: { [character.id]: chatId } }))
  setActive(journal.id)
  storage.appendChatMessage(character.id, journal.id, { role: 'assistant', content: 'Début.', ts: new Date().toISOString() })
  const turns = () => storage.readTurnLog(character.id, journal.id)
  const journalFile = path.join(TMP, 'characters', character.id, 'turns', `${journal.id}.jsonl`)
  saveSettings({ autonomousEnabled: true })

  await check('un tour silencieux laisse une entrée : son issue, ses outils (résultat compris), son raisonnement', async () => {
    script.push({ toolCalls: [{ name: 'memory_save', arguments: JSON.stringify({ name: 'carnet.md', content: 'Une note.' }) }] })
    script.push({ content: '(silence)', thinking: 'Je note, puis je me tais.' })
    equal(await auto.runAutonomousTurn(), 'silent', 'issue')
    const t = turns()
    equal(t.length, 1, 'entrées au journal')
    equal(t[0].outcome, 'silent', 'issue notée')
    equal(t[0].tools?.length, 1, 'outils notés')
    equal(t[0].tools?.[0].name, 'memory_save', 'outil')
    assert(String(t[0].tools?.[0].result).length > 0, "le résultat de l'outil doit être gardé")
    equal(t[0].thinking, 'Je note, puis je me tais.', 'raisonnement')
    assert(!Number.isNaN(new Date(t[0].ts).getTime()), 'heure lisible')
    equal(t[0].count, undefined, 'un seul tour : pas de compteur')
  })

  await check('des tours calmes qui se suivent se fondent en une entrée, sans avaler un tour qui a agi', async () => {
    const avant = new Date().toISOString()
    script.push({ content: '(silence)', thinking: 'Premier.' })
    equal(await auto.runAutonomousTurn(), 'silent', 'premier tour calme')
    equal(turns().length, 2, 'le tour calme ne se fond pas dans celui qui avait un outil')
    await sleep(15)
    script.push({ content: '(silence)', thinking: 'Deuxième.' })
    script.push({ content: '(silence)', thinking: 'Troisième.' })
    equal(await auto.runAutonomousTurn(), 'silent', 'deuxième')
    equal(await auto.runAutonomousTurn(), 'silent', 'troisième')
    const t = turns()
    equal(t.length, 2, 'entrées au journal')
    equal(t[1].count, 3, 'tours fondus')
    equal(t[1].thinking, 'Troisième.', 'raisonnement du dernier')
    assert(t[1].since !== undefined && t[1].since >= avant && t[1].since < t[1].ts, 'since = heure du premier, ts = heure du dernier')
  })

  await check('il écrit : entrée notée avec ses outils, le raisonnement reste sur le message', async () => {
    script.push({ toolCalls: [{ name: 'memory_save', arguments: JSON.stringify({ name: 'carnet2.md', content: 'Autre note.' }) }] })
    script.push({ content: 'J\'ai rangé mes notes.', thinking: 'Je le lui dis.' })
    equal(await auto.runAutonomousTurn(), 'spoke', 'issue')
    const t = turns()
    equal(t.length, 3, 'entrées au journal')
    equal(t[2].outcome, 'spoke', 'issue notée')
    equal(t[2].tools?.length, 1, 'outils notés')
    equal(t[2].thinking, undefined, 'pas de raisonnement en double')
    const m = storage.readChat(character.id, journal.id).messages
    equal(m[m.length - 1].thinking, 'Je le lui dis.', 'raisonnement sur le message')
  })

  await check('une panne laisse une entrée avec son message ; la même panne répétée se fond', async () => {
    saveSettings({ backendUrl: 'http://127.0.0.1:9/v1' })
    equal(await auto.runAutonomousTurn(), 'error', 'première panne')
    equal(await auto.runAutonomousTurn(), 'error', 'seconde panne')
    saveSettings({ backendUrl: `http://127.0.0.1:${port}/v1` })
    const t = turns()
    equal(t.length, 4, 'entrées au journal')
    equal(t[3].outcome, 'error', 'issue notée')
    equal(t[3].error, 'llmUnreachable', "le code de l'erreur doit être gardé")
    assert(String(t[3].errorParams?.detail ?? '').length > 0, 'le détail de la panne doit être gardé avec le code')
    equal(t[3].count, 2, 'pannes fondues')
  })

  await check("l'utilisateur écrit pendant un tour : le tour abandonné est noté ; un tour non joué ne laisse rien", async () => {
    script.push({ content: 'Trop tard.', delayMs: 400 })
    const tour = auto.runAutonomousTurn()
    await sleep(100)
    storage.appendChatMessage(character.id, journal.id, { role: 'user', content: 'Me voilà.', ts: new Date().toISOString() })
    equal(await tour, 'moved', 'issue')
    equal(turns().length, 5, 'entrées au journal')
    equal(turns()[4].outcome, 'moved', 'issue notée')
    equal(await auto.runAutonomousTurn(), 'waiting-user', 'une réponse est due')
    saveSettings({ autonomousEnabled: false })
    equal(await auto.runAutonomousTurn(), 'off', 'éteint')
    saveSettings({ autonomousEnabled: true })
    equal(turns().length, 5, 'un tour non joué ne laisse aucune entrée')
    storage.appendChatMessage(character.id, journal.id, { role: 'assistant', content: 'Bonjour.', ts: new Date().toISOString() })
  })

  await check('bloc rendu au personnage : ses tours, leurs appels sans les résultats, seulement quand le mode est allumé', async () => {
    const { injected } = buildPayload(character.id, journal.id, loadSettings())
    assert(injected.includes('## Your own turns'), 'le bloc doit être dans le texte ajouté')
    assert(injected.includes('memory_save') && injected.includes('carnet.md'), "les appels d'outils doivent y figurer")
    const resultat = String(turns()[0].tools?.[0].result)
    assert(!injected.includes(resultat), "les résultats d'outils ne doivent pas y figurer")
    assert(injected.includes('3 turns in a row'), 'les tours fondus doivent être comptés')
    assert(injected.includes('let the turn pass') && injected.includes('wrote a message') && injected.includes('the user wrote') && injected.includes('failed'), 'les quatre issues')
    assert(!injected.includes('Je note, puis je me tais.'), "le raisonnement n'est pas réinjecté")
    script.push({ content: '(silence)' })
    equal(await auto.runAutonomousTurn(), 'silent', 'issue')
    assert(String(lastRequest().messages[0].content).includes('## Your own turns'), 'le bloc doit partir au modèle pendant un tour')
    saveSettings({ autonomousEnabled: false })
    assert(!buildPayload(character.id, journal.id, loadSettings()).injected.includes('## Your own turns'), 'mode éteint : rien de ce mode dans le prompt')
    saveSettings({ autonomousEnabled: true })
    const autre = storage.createChat(character.id, 'sans journal')
    storage.appendChatMessage(character.id, autre.id, { role: 'assistant', content: 'Rien ici.', ts: new Date().toISOString() })
    assert(
      !buildPayload(character.id, autre.id, loadSettings()).injected.includes('## Your own turns'),
      "le journal d'une conversation ne passe pas dans une autre du même personnage",
    )
  })

  await check('bloc : vide sans tour ; seuls les plus récents ; arguments et taille plafonnés', () => {
    equal(turnLogBlock([]), '', 'aucun tour')
    const many = Array.from({ length: 30 }, (_, i) => ({
      ts: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      outcome: 'silent' as const,
      tools: [{ name: 'memory_save', args: JSON.stringify({ name: `n${i}.md` }) }],
    }))
    const block = turnLogBlock(many)
    equal(block.split('\n').filter((l) => l.startsWith('- ')).length, 12, 'tours rendus')
    assert(block.includes('n29.md') && block.includes('n18.md') && !block.includes('n17.md'), 'ce sont les plus récents')
    const long = turnLogBlock([{ ts: many[0].ts, outcome: 'silent', tools: [{ name: 'memory_save', args: 'x'.repeat(5000) }] }])
    assert(!long.includes('x'.repeat(200)) && long.includes('…'), 'arguments tronqués')
    const heavy = turnLogBlock(
      many.map((e) => ({ ...e, tools: Array.from({ length: 6 }, () => ({ name: 'memory_save', args: 'y'.repeat(150) })) })),
    )
    assert(heavy.length < 3600, `taille plafonnée (${heavy.length})`)
    assert(heavy.includes(turnLogBlock([many[29]]).split('\n').find((l) => l.startsWith('- '))!.slice(0, 18)), 'le tour le plus récent reste')
  })

  await check('fusion : seules des issues calmes identiques se fondent — ni deux pannes différentes, ni deux abandons, ni deux messages', () => {
    const c = storage.createChat(character.id, 'fusion')
    storage.appendChatMessage(character.id, c.id, { role: 'assistant', content: 'x', ts: new Date().toISOString() })
    const add = (e: Omit<TurnLogEntry, 'ts'>): void => storage.appendTurnLog(character.id, c.id, { ts: new Date().toISOString(), ...e })
    add({ outcome: 'error', error: 'a' })
    add({ outcome: 'error', error: 'b' })
    add({ outcome: 'error', error: 'b' })
    add({ outcome: 'silent' })
    add({ outcome: 'moved' })
    add({ outcome: 'moved' })
    add({ outcome: 'spoke' })
    add({ outcome: 'spoke' })
    const t = storage.readTurnLog(character.id, c.id)
    equal(
      t.map((e) => `${e.outcome}${e.error ?? ''}×${e.count ?? 1}`).join(' '),
      'errora×1 errorb×2 silent×1 moved×1 moved×1 spoke×1 spoke×1',
      'entrées',
    )
  })

  let plafondsId = ''
  await check('plafonds du journal : raisonnement tronqué, entrées les plus anciennes effacées', () => {
    const c = storage.createChat(character.id, 'plafonds')
    plafondsId = c.id
    storage.appendChatMessage(character.id, c.id, { role: 'assistant', content: 'x', ts: new Date().toISOString() })
    storage.appendTurnLog(character.id, c.id, { ts: new Date().toISOString(), outcome: 'silent', thinking: 'z'.repeat(storage.TURN_THINKING_MAX + 100) })
    equal(storage.readTurnLog(character.id, c.id)[0].thinking?.length, storage.TURN_THINKING_MAX + 1, 'raisonnement tronqué')
    let n = 1
    let size = 1
    // Des tours qui ont agi (jamais fondus) : le journal grossit jusqu'à l'élagage.
    for (;;) {
      storage.appendTurnLog(character.id, c.id, { ts: new Date().toISOString(), outcome: 'silent', tools: [{ name: 't', args: String(n) }] })
      n++
      const now = storage.readTurnLog(character.id, c.id).length
      if (now <= size) break
      size = now
      assert(n < storage.TURN_LOG_MAX * 2, "l'élagage n'est jamais venu")
    }
    const t = storage.readTurnLog(character.id, c.id)
    equal(t.length, storage.TURN_LOG_MAX, 'entrées après élagage')
    equal(t[t.length - 1].tools?.[0].args, String(n - 1), 'le dernier tour est gardé')
    equal(t[0].tools?.[0].args, String(n - storage.TURN_LOG_MAX), 'ce sont les plus anciens qui partent')
    assert(size > storage.TURN_LOG_MAX, "l'élagage attend un débord, il ne réécrit pas à chaque tour")
  })

  await check('journal retouché à la main : les lignes abîmées sont écartées, les autres restent', () => {
    const c = storage.createChat(character.id, 'retouche')
    const file = path.join(TMP, 'characters', character.id, 'turns', `${c.id}.jsonl`)
    fs.writeFileSync(
      file,
      [
        'ceci n\'est pas du JSON',
        JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', outcome: 'silent', count: 'trois', tools: 'non', thinking: 12 }),
        JSON.stringify({ ts: '2026-01-01T00:01:00.000Z', outcome: 'inconnue' }),
        JSON.stringify({ outcome: 'silent' }),
        JSON.stringify({ ts: '2026-01-01T00:02:00.000Z', outcome: 'spoke', tools: [{ name: 'a', args: '{}' }, { name: 3 }], errorParams: { detail: 'x' } }),
        JSON.stringify({ ts: '2026-01-01T00:03:00.000Z', outcome: 'error', error: 'code', errorParams: { detail: 'réseau', n: 2, objet: { a: 1 }, liste: [1] } }),
        JSON.stringify({ ts: '2026-01-01T00:04:00.000Z', outcome: 'error', error: 'code', errorParams: 'non' }),
      ].join('\n') + '\n',
    )
    const t = storage.readTurnLog(character.id, c.id)
    equal(t.length, 4, 'entrées gardées')
    equal(JSON.stringify(t[0]), JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', outcome: 'silent' }), 'champs mal typés retirés')
    equal(t[1].tools?.length, 1, 'traces mal typées retirées')
    equal(t[1].errorParams, undefined, "pas de paramètres d'erreur sans erreur")
    equal(JSON.stringify(t[2].errorParams), JSON.stringify({ detail: 'réseau', n: 2 }), "paramètres d'erreur : seuls textes et nombres")
    equal(t[3].errorParams, undefined, "paramètres d'erreur mal typés retirés")
  })

  await check('le journal suit sa conversation : copié avec une branche, effacé avec elle, jamais pris pour une conversation', () => {
    const avant = storage.listChats(character.id).length
    const branche = storage.forkChat(character.id, journal.id, 'branche')
    equal(storage.listChats(character.id).length, avant + 1, 'la branche est la seule conversation de plus')
    equal(storage.readTurnLog(character.id, branche.id).length, turns().length, 'journal de la branche')
    storage.deleteChat(character.id, branche.id)
    equal(storage.readTurnLog(character.id, branche.id).length, 0, 'journal effacé avec la conversation')
    storage.appendTurnLog(character.id, branche.id, { ts: new Date().toISOString(), outcome: 'silent' })
    equal(storage.readTurnLog(character.id, branche.id).length, 0, 'pas de journal pour une conversation supprimée')
    assert(fs.existsSync(journalFile), "le journal de l'original n'est pas touché")
  })

  await check('API : le journal et le pouls d\'une conversation ; 404 pour une conversation inconnue', async () => {
    const app = express()
    app.use(charactersRouter)
    const server = http.createServer(app)
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/characters/${character.id}/chats`
    try {
      const got = (await (await fetch(`${base}/${journal.id}/turns`)).json()) as { entries: { outcome: string }[] }
      equal(got.entries.length, turns().length, 'entrées servies')
      equal(got.entries[0].outcome, 'silent', 'du plus ancien au plus récent')
      const pulse1 = (await (await fetch(`${base}/${journal.id}/pulse`)).json()) as { chat: number; turns: number }
      assert(pulse1.chat > 0 && pulse1.turns > 0, 'deux dates de fichier')
      await sleep(25)
      script.push({ toolCalls: [{ name: 'memory_save', arguments: JSON.stringify({ name: 'carnet3.md', content: 'Encore.' }) }] })
      script.push({ content: '(silence)' })
      equal(await auto.runAutonomousTurn(), 'silent', 'un tour de plus')
      const pulse2 = (await (await fetch(`${base}/${journal.id}/pulse`)).json()) as { chat: number; turns: number }
      assert(pulse2.turns > pulse1.turns, 'le pouls du journal bouge quand un tour est joué')
      equal(pulse2.chat, pulse1.chat, "le pouls du fil ne bouge pas pour un tour silencieux")
      equal((await fetch(`${base}/2000-01-01-inconnue/turns`)).status, 404, 'journal d\'une conversation inconnue')
      equal((await fetch(`${base}/2000-01-01-inconnue/pulse`)).status, 404, 'pouls d\'une conversation inconnue')
      const vide = storage.createChat(character.id, 'sans tour')
      const none = (await (await fetch(`${base}/${vide.id}/turns`)).json()) as { entries: unknown[] }
      equal(none.entries.length, 0, 'conversation sans tour : liste vide')
      const big = (await (await fetch(`${base}/${plafondsId}/turns`)).json()) as { entries: { tools?: { args: string }[] }[] }
      const all = storage.readTurnLog(character.id, plafondsId)
      equal(big.entries.length, 200, "un long journal n'est servi que par sa fin")
      equal(big.entries[199].tools?.[0].args, all[all.length - 1].tools?.[0].args, 'ce sont les entrées les plus récentes')
    } finally {
      server.close()
    }
  })

  await check('le raisonnement de TOUTES les étapes du tour est gardé, pas seulement celui de la dernière', async () => {
    const c = storage.createChat(character.id, 'etapes')
    setActive(c.id)
    storage.appendChatMessage(character.id, c.id, { role: 'assistant', content: 'Début.', ts: new Date().toISOString() })
    script.push({ thinking: 'Je vais noter.', toolCalls: [{ name: 'memory_save', arguments: JSON.stringify({ name: 'etapes.md', content: 'Un.' }) }] })
    script.push({ thinking: 'Noté, je me tais.', content: '(silence)' })
    equal(await auto.runAutonomousTurn(), 'silent', 'tour silencieux')
    equal(storage.readTurnLog(character.id, c.id)[0].thinking, 'Je vais noter.\n\nNoté, je me tais.', 'raisonnement au journal')
    script.push({ thinking: 'Je relis.', toolCalls: [{ name: 'memory_read', arguments: JSON.stringify({ name: 'etapes.md' }) }] })
    script.push({ thinking: 'Je le lui dis.', content: 'Tout est noté.' })
    equal(await auto.runAutonomousTurn(), 'spoke', 'tour avec message')
    const m = storage.readChat(character.id, c.id).messages
    equal(m[m.length - 1].thinking, 'Je relis.\n\nJe le lui dis.', 'raisonnement sur le message')
  })

  console.log("\nPassage de main à l'utilisateur")

  const { chatRouter } = await import('../server/api/chat')
  const { memoryRouter } = await import('../server/api/memory')
  const gate = await import('../server/lib/turnGate')
  const appli = express()
  appli.use(express.json())
  appli.use(chatRouter)
  appli.use(memoryRouter)
  const serveur = http.createServer(appli)
  await new Promise<void>((r) => serveur.listen(0, '127.0.0.1', r))
  const api = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`
  const poster = async (url: string, body: unknown): Promise<number> => {
    const res = await fetch(api + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    await res.text() // le flux (ou le JSON) est lu jusqu'au bout
    return res.status
  }
  // Rien n'attend sans fin : une main jamais rendue doit faire échouer l'essai, pas le bloquer.
  const avecDelai = <T>(p: Promise<T>, ms: number, quoi: string): Promise<T> =>
    Promise.race([p, sleep(ms).then(() => Promise.reject(new Error(`${quoi} : rien après ${ms} ms`)))])
  // Un tour autonome LENT (sa réponse finale met quatre secondes), déjà passé par un outil.
  const tourLent = async (chatId: string): Promise<{ tour: Promise<string>; debut: number }> => {
    setActive(chatId)
    script.push({ thinking: 'Je prends une note.', toolCalls: [{ name: 'memory_save', arguments: JSON.stringify({ name: `main-${Date.now()}.md`, content: 'Note.' }) }] })
    script.push({ thinking: 'Je réfléchis à ma réponse.', content: 'Trop tard.', delayMs: 4000 })
    const debut = Date.now()
    const tour = auto.runAutonomousTurn()
    await sleep(300) // l'outil est joué, la réponse finale est en cours
    return { tour, debut }
  }

  await check("un message de l'utilisateur abandonne le tour TOUT DE SUITE, et sa réponse voit ce que le tour avait fait", async () => {
    const c = storage.createChat(character.id, 'main')
    storage.appendChatMessage(character.id, c.id, { role: 'assistant', content: 'Début.', ts: new Date().toISOString() })
    const { tour, debut } = await tourLent(c.id)
    script.push({ content: '[happy] Bien sûr.' })
    const statut = await avecDelai(poster('/api/chat', { characterId: character.id, chatId: c.id, content: 'Je passe avant.' }), 6000, 'réponse du chat')
    equal(statut, 200, 'statut du chat')
    equal(await avecDelai(tour, 6000, 'fin du tour'), 'moved', 'issue du tour')
    // La surveillance du fichier ne passe qu'à la seconde : avant cela, seul le passage de main a pu l'arrêter.
    assert(Date.now() - debut < 2500, 'le tour ne doit pas aller au bout de sa réponse')
    const t = storage.readTurnLog(character.id, c.id)
    equal(t.length, 1, 'entrées au journal')
    equal(t[0].outcome, 'moved', 'tour abandonné noté')
    equal(t[0].tools?.length, 1, 'son outil est noté')
    equal(t[0].thinking, 'Je prends une note.\n\nJe réfléchis à ma réponse.', "ce qu'il avait pensé est gardé, étape en cours comprise")
    const reponse = requests.find((r) => r.messages[r.messages.length - 1].content === 'Je passe avant.')
    assert(reponse, 'la requête de la réponse doit être partie')
    const systeme = String(reponse.messages[0].content)
    assert(systeme.includes('the turn was dropped because the user wrote') && systeme.includes('memory_save'), 'la réponse doit voir au journal le tour abandonné')
    const m = storage.readChat(character.id, c.id).messages
    equal(m.map((x) => x.content).join(' | '), 'Début. | Je passe avant. | [happy] Bien sûr.', 'fil : aucun message du tour abandonné')
  })

  await check("mesuré : l'abandon vient du passage de main, pas de la surveillance à la seconde", async () => {
    const c = storage.createChat(character.id, 'main-vite')
    storage.appendChatMessage(character.id, c.id, { role: 'assistant', content: 'Début.', ts: new Date().toISOString() })
    const { tour, debut } = await tourLent(c.id)
    script.push({ content: 'Oui.' })
    // La réponse du chat est demandée sans être attendue : seul compte l'instant où le tour lâche.
    const envoi = poster('/api/chat', { characterId: character.id, chatId: c.id, content: 'Vite.' })
    equal(await avecDelai(tour, 6000, 'fin du tour'), 'moved', 'issue du tour')
    const duree = Date.now() - debut
    assert(duree < 800, `tour abandonné en ${duree} ms : la surveillance du fichier, elle, n'aurait vu le message qu'après une seconde`)
    await avecDelai(envoi, 6000, 'réponse du chat')
  })

  await check('compaction, rangement et compression de la mémoire demandent la main eux aussi', async () => {
    const c = storage.createChat(character.id, 'main-autres')
    storage.appendChatMessage(character.id, c.id, { role: 'assistant', content: 'Début.', ts: new Date().toISOString() })
    for (const [quoi, url, body] of [
      ['compaction', '/api/chat/compact', { characterId: character.id, chatId: c.id }],
      ['rangement', `/api/characters/${character.id}/memory/tidy`, {}],
      ['compression', `/api/characters/${character.id}/memory/compress`, {}],
    ] as const) {
      const { tour, debut } = await tourLent(c.id)
      // Ce que la route répond importe peu ici (le faux modèle ne sait ni résumer ni ranger) : seul compte le tour.
      const envoi = poster(url, body)
      equal(await avecDelai(tour, 6000, `fin du tour (${quoi})`), 'moved', `issue du tour (${quoi})`)
      const duree = Date.now() - debut
      assert(duree < 800, `${quoi} : tour abandonné en ${duree} ms`)
      await avecDelai(envoi, 8000, `réponse (${quoi})`)
      script.length = 0 // ce que la route n'a pas consommé ne doit pas fuir dans l'essai suivant
    }
  })

  await check("passage de main : sans tour en cours rien n'attend, et un tour ne retire que le sien", async () => {
    await avecDelai(gate.yieldToUser(), 500, 'main sans tour')
    let abandons = 0
    let finA = (): void => {}
    let finB = (): void => {}
    const a = { abort: (): void => void abandons++, done: new Promise<void>((r) => (finA = r)) }
    const b = { abort: (): void => void (abandons += 10), done: new Promise<void>((r) => (finB = r)) }
    gate.declareRunningTurn(a)
    gate.declareRunningTurn(b)
    gate.clearRunningTurn(a) // a retire le sien : b reste déclaré
    let rendue = false
    const main = gate.yieldToUser().then(() => {
      rendue = true
    })
    await sleep(50)
    equal(abandons, 10, "c'est le tour déclaré en dernier qui est abandonné")
    equal(rendue, false, "la main n'est pas rendue avant la fin du tour")
    finB()
    await avecDelai(main, 500, 'main après la fin du tour')
    gate.clearRunningTurn(b)
    finA()
    await avecDelai(gate.yieldToUser(), 500, 'main une fois tout retiré')
    equal(abandons, 10, 'plus aucun tour à abandonner')
  })

  serveur.closeAllConnections()
  serveur.close()
  script.length = 0
  setActive(chat.id)

  console.log('\nMessages spontanés')

  await check('tours autonomes allumés : les messages spontanés se taisent ; éteints : ils reprennent', async () => {
    const vieux = storage.createChat(character.id, 'absence')
    fs.writeFileSync(path.join(TMP, 'ui.json'), JSON.stringify({ activeCharacter: character.id, activeChat: { [character.id]: vieux.id } }))
    storage.appendChatMessage(character.id, vieux.id, { role: 'assistant', content: 'À plus tard.', ts: new Date(Date.now() - 6 * 3600 * 1000).toISOString() })
    saveSettings({ spontaneousEnabled: true, spontaneousStartHour: 0, spontaneousEndHour: 0 })
    const avant = requests.length
    await runSpontaneousTick()
    equal(requests.length, avant, 'appels au modèle, tours autonomes allumés')
    saveSettings({ autonomousEnabled: false })
    script.push({ content: 'Tu me manques un peu.' })
    await runSpontaneousTick()
    equal(requests.length, avant + 1, 'appels au modèle, tours autonomes éteints')
    const m = storage.readChat(character.id, vieux.id).messages
    equal(m[m.length - 1].spontaneous, true, 'message spontané écrit')
    equal(m[m.length - 1].autonomous, undefined, 'pas marqué autonome')
  })
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
