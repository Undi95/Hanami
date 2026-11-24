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
// chaque tour, sans contenu ; et que les messages spontanés se taisent quand
// les tours autonomes sont allumés.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { ChatMessage } from '../shared/types'

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
    const send = (): void => {
      if (res.destroyed) return
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
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
    if (step.delayMs) setTimeout(send, step.delayMs)
    else send()
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
    assert(String(lastRequest().messages[0].content).includes(String(new Date().getFullYear())), 'le bloc de l\'heure doit être dans le texte système')
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
