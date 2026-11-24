// Tests headless des outils fichiers — `npm run test:file-tools`.
//
// AUCUNE donnée réelle : l'état entier de Hanami est déplacé dans un dossier
// temporaire jetable (HANAMI_DATA), avec des personnages jetables.
//
// Ce qui est prouvé ici : le dossier de travail est propre à CHAQUE personnage
// (<toolsRoot>/<id>) — aucun ne voit le dossier d'un autre ni la racine commune,
// par aucun chemin ni aucun lien ; les identifiants qui pourraient désigner
// autre chose sont refusés ; le dossier d'un personnage supprimé est mis de
// côté, jamais effacé, et un personnage recréé sous le même nom repart d'un
// dossier vide ; les outils eux-mêmes (lire, écrire, modifier, supprimer) ; et
// que le chat et la suppression d'un personnage passent bien par là.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hanami-fichiers-'))
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
  if (actual !== expected) throw new Error(`${what} : attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`)
}

/** Le message de l'erreur levée par fn — '' si rien n'est levé. */
function refus(fn: () => unknown): string {
  try {
    fn()
    return ''
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

// Liens posés pendant les essais : retirés un par un à la fin, avant le ménage du dossier.
const liens: string[] = []
function lier(cible: string, lien: string): void {
  // Sous Windows, une jonction se crée sans droit particulier ; ailleurs, un lien symbolique de dossier.
  fs.symlinkSync(cible, lien, process.platform === 'win32' ? 'junction' : 'dir')
  liens.push(lien)
}

async function main(): Promise<void> {
  const { loadSettings, saveSettings } = await import('../server/config')
  const storage = await import('../server/lib/storage')
  const files = await import('../server/tools/fileTools')
  const { runToolLoop } = await import('../server/api/chat')
  const { createMemorySession } = await import('../server/tools/memoryTools')
  const { charactersRouter } = await import('../server/api/characters')
  const express = (await import('express')).default

  saveSettings({ fileToolsEnabled: true, allowDelete: false })
  const racine = loadSettings().toolsRoot
  const alpha = storage.createCharacter({ name: 'Alpha', systemPrompt: 'Essai.' }).id
  const beta = storage.createCharacter({ name: 'Beta', systemPrompt: 'Essai.' }).id
  const outil = (id: string, nom: string, args: Record<string, unknown> = {}): string => files.executeFileTool(loadSettings(), id, nom, args)

  console.log('\nUn dossier par personnage')

  await check('chacun écrit dans SON dossier, créé à son nom dans la racine', () => {
    equal(outil(alpha, 'write_file', { path: 'notes.md', content: 'Note d\'Alpha.' }), 'File written: notes.md (13 bytes)', 'écriture')
    equal(fs.readFileSync(path.join(racine, alpha, 'notes.md'), 'utf8'), "Note d'Alpha.", 'fichier sur le disque')
    equal(outil(alpha, 'list_files'), 'notes.md', "liste d'Alpha")
    equal(outil(alpha, 'read_file', { path: 'notes.md' }), "Note d'Alpha.", "lecture d'Alpha")
    equal(outil(beta, 'list_files'), '(empty folder)', 'liste de Beta')
    assert(fs.statSync(path.join(racine, beta)).isDirectory(), 'le dossier de Beta est créé à la demande')
  })

  await check("aucun chemin ne mène au dossier d'un autre, ni à la racine commune", () => {
    fs.writeFileSync(path.join(racine, 'commun.txt'), 'Posé à la racine.')
    assert(refus(() => outil(beta, 'read_file', { path: 'notes.md' })).includes('file not found'), "le fichier d'Alpha n'existe pas pour Beta")
    const chemins = [`../${alpha}/notes.md`, path.join(racine, alpha, 'notes.md'), '../commun.txt', `./../${alpha}/notes.md`, `sous/../../${alpha}/notes.md`]
    // La barre oblique inverse ne sépare les dossiers que sous Windows.
    if (process.platform === 'win32') chemins.push(`..\\${alpha}\\notes.md`)
    for (const chemin of chemins) {
      assert(refus(() => outil(beta, 'read_file', { path: chemin })).includes('outside the allowed folder'), `lecture refusée : ${chemin}`)
      assert(refus(() => outil(beta, 'write_file', { path: chemin, content: 'x' })).includes('outside the allowed folder'), `écriture refusée : ${chemin}`)
    }
    assert(refus(() => outil(beta, 'list_files', { dir: '..' })).includes('outside the allowed folder'), 'la racine commune ne se liste pas')
    assert(refus(() => outil(beta, 'list_files', { dir: `../${alpha}` })).includes('outside the allowed folder'), "le dossier d'un autre ne se liste pas")
    assert(refus(() => outil(alpha, 'read_file', { path: 'commun.txt' })).includes('file not found'), "un fichier de la racine n'est dans le dossier de personne")
    equal(fs.readFileSync(path.join(racine, alpha, 'notes.md'), 'utf8'), "Note d'Alpha.", "le fichier d'Alpha est intact")
    equal(fs.readFileSync(path.join(racine, 'commun.txt'), 'utf8'), 'Posé à la racine.', 'le fichier de la racine est intact')
  })

  await check('aucun LIEN non plus : ni dans un dossier, ni à la place du dossier lui-même', () => {
    lier(path.join(racine, alpha), path.join(racine, beta, 'chez-alpha'))
    assert(refus(() => outil(beta, 'read_file', { path: 'chez-alpha/notes.md' })).includes('outside the allowed folder'), 'lecture à travers un lien')
    assert(refus(() => outil(beta, 'write_file', { path: 'chez-alpha/intrus.md', content: 'x' })).includes('outside the allowed folder'), 'écriture à travers un lien')
    assert(refus(() => outil(beta, 'list_files', { dir: 'chez-alpha' })).includes('outside the allowed folder'), 'le lien lui-même ne se liste pas')
    assert(!fs.existsSync(path.join(racine, alpha, 'intrus.md')), "rien n'est écrit chez Alpha")
    // Un lien posé À LA PLACE du dossier d'un personnage, vers le dossier d'un autre ou vers l'extérieur.
    const dehors = path.join(TMP, 'dehors')
    fs.mkdirSync(dehors)
    fs.writeFileSync(path.join(dehors, 'secret.txt'), 'Hors de la racine.')
    lier(path.join(racine, alpha), path.join(racine, 'gamma'))
    lier(dehors, path.join(racine, 'delta'))
    for (const id of ['gamma', 'delta']) {
      assert(refus(() => outil(id, 'list_files')).includes("this character's folder is a link"), `dossier remplacé par un lien : ${id}`)
      assert(refus(() => outil(id, 'write_file', { path: 'x.md', content: 'x' })).includes('invalid working folder'), `écriture refusée : ${id}`)
    }
    assert(!fs.existsSync(path.join(dehors, 'x.md')) && !fs.existsSync(path.join(racine, alpha, 'x.md')), "rien n'est écrit à travers ces liens")
  })

  await check('un identifiant qui pourrait désigner autre chose est refusé', () => {
    for (const id of ['', '.', '..', `../${alpha}`, `${alpha}/..`, `${alpha}/sous`, `${alpha}\\sous`, `.${alpha}`, `${alpha}.`, `${alpha} `, ` ${alpha}`, 'a:b', 'x'.repeat(101)]) {
      assert(refus(() => outil(id, 'list_files')).includes('invalid character id'), `identifiant refusé : ${JSON.stringify(id)}`)
    }
    // Sous Windows, un même dossier a parfois un second nom, court : il ne doit pas ouvrir le dossier d'un autre.
    const long = storage.createCharacter({ name: 'Personnage au nom long', systemPrompt: 'Essai.' }).id
    outil(long, 'write_file', { path: 'a.md', content: 'x' })
    const court = 'PERSON~1'
    if (fs.existsSync(path.join(racine, court)) && !fs.readdirSync(racine).includes(court)) {
      assert(refus(() => outil(court, 'list_files')).includes('invalid working folder'), 'nom court de Windows refusé')
      assert(refus(() => outil(court, 'write_file', { path: 'intrus.md', content: 'x' })).includes('invalid working folder'), 'écriture par le nom court refusée')
      assert(!fs.existsSync(path.join(racine, long, 'intrus.md')), "rien n'est écrit dans le dossier désigné par son nom court")
      equal(files.retireWorkspace(loadSettings(), court), 'none', 'ni mis de côté par son nom court')
      assert(fs.existsSync(path.join(racine, long, 'a.md')), 'le dossier désigné par son nom court est intact')
    } else {
      console.log('       (pas de noms courts sur ce disque : ce cas n\'est pas essayé ici)')
    }
    equal(outil(long, 'list_files'), 'a.md', 'le vrai identifiant, lui, ouvre son dossier')
  })

  console.log('\nLes outils')

  await check('lire, écrire dans un sous-dossier, modifier, lister', () => {
    outil(alpha, 'write_file', { path: 'carnet/jour-1.md', content: 'Un. Deux. Un.' })
    equal(outil(alpha, 'list_files'), 'carnet/\nnotes.md', 'liste de la racine du dossier')
    equal(outil(alpha, 'list_files', { dir: 'carnet' }), 'jour-1.md', 'liste du sous-dossier')
    assert(refus(() => outil(alpha, 'edit_file', { path: 'carnet/jour-1.md', old_string: 'Un.', new_string: 'x' })).includes('appears 2 times'), 'extrait ambigu refusé')
    assert(refus(() => outil(alpha, 'edit_file', { path: 'carnet/jour-1.md', old_string: 'Trois.', new_string: 'x' })).includes('not found'), 'extrait absent refusé')
    equal(outil(alpha, 'edit_file', { path: 'carnet/jour-1.md', old_string: 'Deux.', new_string: 'Trois.' }), 'File edited: carnet/jour-1.md', 'modification')
    equal(outil(alpha, 'read_file', { path: 'carnet/jour-1.md' }), 'Un. Trois. Un.', 'relecture')
    assert(refus(() => outil(alpha, 'read_file', { path: 'absent.md' })).includes('file not found'), 'fichier absent')
    assert(refus(() => outil(alpha, 'read_file', {})).includes('missing or invalid parameter'), 'paramètre manquant')
    assert(refus(() => outil(alpha, 'run', {})).includes('unknown file tool'), 'outil inconnu')
  })

  await check("supprimer : seulement si le réglage l'autorise, et seulement chez soi", () => {
    assert(refus(() => outil(alpha, 'delete_file', { path: 'carnet/jour-1.md' })).includes('delete_file is disabled'), 'suppression interdite par défaut')
    saveSettings({ allowDelete: true })
    assert(refus(() => outil(beta, 'delete_file', { path: `../${alpha}/notes.md` })).includes('outside the allowed folder'), "supprimer chez un autre : refusé")
    equal(outil(alpha, 'delete_file', { path: 'carnet/jour-1.md' }), 'File deleted: carnet/jour-1.md', 'suppression')
    assert(!fs.existsSync(path.join(racine, alpha, 'carnet', 'jour-1.md')), 'le fichier est parti')
    assert(refus(() => outil(alpha, 'delete_file', { path: 'carnet' })).includes('not a file'), 'un dossier ne se supprime pas')
    saveSettings({ allowDelete: false })
  })

  await check('une racine qui contient les fichiers de l\'application est refusée', () => {
    saveSettings({ toolsRoot: TMP })
    assert(refus(() => outil(alpha, 'list_files')).includes("contains the app's own files"), 'le dossier de données lui-même')
    saveSettings({ toolsRoot: path.dirname(TMP) })
    assert(refus(() => outil(alpha, 'list_files')).includes("contains the app's own files"), 'un dossier qui le contient')
    saveSettings({ toolsRoot: racine })
    equal(outil(alpha, 'list_files'), 'carnet/\nnotes.md', 'la racine remise, le dossier est retrouvé')
  })

  console.log('\nBranchement')

  await check('le chat exécute les outils fichiers dans le dossier du personnage qui parle', async () => {
    const appel = async (id: string, contenu: string): Promise<string> => {
      const messages: unknown[] = []
      let n = 0
      await runToolLoop(id, loadSettings(), messages, 2, new Set(['write_file']), createMemorySession(), async () => ({
        content: '',
        toolCalls: n++ === 0 ? [{ id: 'c1', name: 'write_file', arguments: JSON.stringify({ path: 'du-chat.md', content: contenu }) }] : [],
      }))
      return String((messages.find((m) => (m as { role?: string }).role === 'tool') as { content?: string } | undefined)?.content)
    }
    assert((await appel(alpha, 'écrit par Alpha')).startsWith('File written: du-chat.md'), "réponse de l'outil pour Alpha")
    assert((await appel(beta, 'écrit par Beta')).startsWith('File written: du-chat.md'), "réponse de l'outil pour Beta")
    equal(fs.readFileSync(path.join(racine, alpha, 'du-chat.md'), 'utf8'), 'écrit par Alpha', "fichier d'Alpha")
    equal(fs.readFileSync(path.join(racine, beta, 'du-chat.md'), 'utf8'), 'écrit par Beta', 'fichier de Beta')
    assert(!fs.existsSync(path.join(racine, 'du-chat.md')), "rien n'est écrit à la racine commune")
    saveSettings({ fileToolsEnabled: false })
    assert((await appel(alpha, 'x')).includes('file tools are disabled'), 'réglage éteint : refusé')
    saveSettings({ fileToolsEnabled: true })
  })

  console.log('\nPersonnage supprimé')

  await check("son dossier est mis de côté, jamais effacé ; vide, il est simplement retiré ; le suivant du même nom repart de zéro", async () => {
    const quand = new Date(2026, 0, 31, 9, 5, 7)
    equal(files.retireWorkspace(loadSettings(), 'jamais-vu', quand), 'none', 'pas de dossier : rien à faire')
    const vide = storage.createCharacter({ name: 'Vide', systemPrompt: 'Essai.' }).id
    outil(vide, 'list_files')
    equal(files.retireWorkspace(loadSettings(), vide, quand), 'removed', 'dossier vide : retiré')
    assert(!fs.existsSync(path.join(racine, vide)), 'le dossier vide est parti')
    equal(files.retireWorkspace(loadSettings(), alpha, quand), 'set-aside', 'dossier non vide : mis de côté')
    const garde = path.join(racine, `${alpha}.deleted-20260131-090507`)
    equal(fs.readFileSync(path.join(garde, 'notes.md'), 'utf8'), "Note d'Alpha.", 'ses fichiers sont gardés, sous un nom daté')
    assert(!fs.existsSync(path.join(racine, alpha)), "son nom est libre pour le suivant")
    equal(outil(alpha, 'list_files'), '(empty folder)', 'un personnage du même nom repart d\'un dossier vide')
    outil(alpha, 'write_file', { path: 'neuf.md', content: 'x' })
    equal(files.retireWorkspace(loadSettings(), alpha, quand), 'set-aside', 'second retrait à la même seconde')
    assert(fs.existsSync(path.join(`${garde}-2`, 'neuf.md')) && fs.existsSync(path.join(garde, 'notes.md')), 'aucun dossier mis de côté ne recouvre le précédent')
    // Aucun identifiant ne peut faire déplacer la racine commune, le dossier d'un autre, ni un lien.
    for (const id of ['..', '', '.', ' ', `../${beta}`, `${beta}/..`, 'gamma', 'delta']) {
      equal(files.retireWorkspace(loadSettings(), id, quand), 'none', `rien à mettre de côté pour : ${JSON.stringify(id)}`)
    }
    assert(fs.statSync(racine).isDirectory() && fs.existsSync(path.join(racine, 'commun.txt')), 'la racine commune est toujours là, entière')
    assert(fs.lstatSync(path.join(racine, 'gamma')).isSymbolicLink(), "un lien posé à la place d'un dossier n'est pas déplacé")
    assert(fs.existsSync(path.join(racine, beta, 'du-chat.md')), "le dossier d'un autre n'est pas touché")
    // Le dossier mis de côté n'est celui de personne : son nom n'est pas un identifiant.
    for (const id of [`${alpha}.deleted-20260131-090507`, `${alpha}.deleted-20260131-090507-2`]) {
      assert(refus(() => outil(id, 'list_files')).includes('invalid character id'), `un dossier mis de côté ne se rouvre pas comme un personnage : ${id}`)
    }
  })

  await check("supprimer un personnage dans l'application met son dossier de côté", async () => {
    const app = express()
    app.use(charactersRouter)
    const server = http.createServer(app)
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/characters/${beta}`, { method: 'DELETE' })
      equal(res.status, 200, 'statut')
      assert(storage.getCharacter(beta) === null, 'le personnage est supprimé')
      assert(!fs.existsSync(path.join(racine, beta)), 'son dossier ne porte plus son nom')
      const garde = fs.readdirSync(racine).filter((n) => n.startsWith(`${beta}.deleted-`))
      equal(garde.length, 1, 'dossiers mis de côté')
      assert(fs.existsSync(path.join(racine, garde[0], 'du-chat.md')), 'ses fichiers y sont')
    } finally {
      server.close()
    }
  })
}

main()
  .catch((e) => {
    failures.push(`erreur hors test — ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
  })
  .finally(() => {
    // Les liens d'abord, un par un : le ménage du dossier ne doit en traverser aucun.
    for (const lien of liens) {
      try {
        fs.unlinkSync(lien)
      } catch {
        try {
          fs.rmdirSync(lien)
        } catch {
          /* déjà parti avec son dossier */
        }
      }
    }
    // Chemins garantis ASCII (dossier temporaire, personnages d'essai) : rmSync y est sûr.
    fs.rmSync(TMP, { recursive: true, force: true })
    console.log(`\n${passed} réussis, ${failures.length} en échec`)
    for (const f of failures) console.log('  - ' + f)
    process.exit(failures.length ? 1 : 0)
  })
