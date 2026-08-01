// Tests headless de la restauration de sauvegarde — `npm run test:restore`.
//
// Aucun serveur, aucun réseau, AUCUNE donnée réelle : tout se joue dans un
// dossier temporaire jetable, créé et effacé par ce script. C'est la seule façon
// honnête de vérifier une route qui écrase des fichiers.
//
// Ce qui est prouvé ici : la lecture du format zip, la défense zip-slip (avec de
// vraies archives piégées), les bornes anti-bombe, l'identification d'une
// archive Hanami, l'exactitude du diff de l'aperçu, le filet, la bascule, et le
// fait qu'un échec de validation ne laisse RIEN sur le disque.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildZip, readZip, type ZipEntry } from '../server/lib/zip'
import { MANIFEST_NAME, README_NAME, type BackupRoots } from '../server/lib/backupArchive'
import { RestoreError, applyRestore, planRestore, splitEntryName } from '../server/lib/backupRestore'

// ── Micro-harnais ──────────────────────────────────────────────────────────

let passed = 0
const failures: string[] = []

function check(name: string, fn: () => void): void {
  try {
    fn()
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

/** Vérifie qu'un appel lève, et que le message contient l'un des extraits attendus. */
function throwsAny(fn: () => unknown, contains: string[], what: string): void {
  try {
    fn()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!contains.some((c) => msg.includes(c))) {
      throw new Error(`${what} : message inattendu « ${msg} » (attendu : « ${contains.join(' » ou « ')} »)`)
    }
    return
  }
  throw new Error(`${what} : aucune erreur levée`)
}

function throws(fn: () => unknown, contains: string, what: string): void {
  throwsAny(fn, [contains], what)
}

/**
 * Fausse le CRC annoncé d'une entrée, dans l'en-tête local ET dans l'index : le
 * flux se décompresse parfaitement, mais ne correspond plus à ce que l'archive
 * promet — exactement ce qu'un transfert abîmé produit.
 */
function breakCrc(zip: Buffer, name: string): Buffer {
  const out = Buffer.from(zip)
  const needle = Buffer.from(name, 'utf8')
  const local = out.indexOf(needle) // nom de l'en-tête local, 30 octets après sa signature
  const central = out.indexOf(needle, local + 1) // nom de l'index, 46 octets après la sienne
  assert(local > 0 && central > local, `entrée ${name} introuvable dans l’archive`)
  out.writeUInt32LE(0xdeadbeef, local - 30 + 14)
  out.writeUInt32LE(0xdeadbeef, central - 46 + 16)
  return out
}

// ── Dossier de travail jetable ─────────────────────────────────────────────

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hanami-restore-test-'))

function freshRoots(label: string): BackupRoots {
  const base = path.join(TMP, label)
  const roots: BackupRoots = {
    dataDir: path.join(base, 'data'),
    portraitsDir: path.join(base, 'portraits'),
    netDir: path.join(base, 'backups'),
    workDir: path.join(base, 'backups', '.tmp'),
  }
  fs.mkdirSync(roots.dataDir, { recursive: true })
  fs.mkdirSync(roots.portraitsDir, { recursive: true })
  return roots
}

function put(root: string, rel: string, content: string): void {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

/** Empreinte d'une arborescence : chemin → contenu. Sert à prouver « rien n'a bougé ». */
function snapshot(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  let listing: fs.Dirent[]
  try {
    listing = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const item of listing) {
    const full = path.join(dir, item.name)
    if (item.isDirectory()) Object.assign(out, snapshot(full, prefix + item.name + '/'))
    else out[prefix + item.name] = fs.readFileSync(full, 'utf8')
  }
  return out
}

const NOW = new Date(2026, 6, 15, 10, 30, 0)

function entry(name: string, content: string, mtime = NOW): ZipEntry {
  return { name, data: Buffer.from(content, 'utf8'), mtime }
}

/** Archive Hanami minimale et valide, avec manifeste. */
function hanamiZip(entries: ZipEntry[], version = 1): Buffer {
  const manifest = {
    format: 'hanami-backup',
    version,
    createdAt: NOW.toISOString(),
    files: entries.length,
    contents: { data: entries.length, portraits: 0 },
  }
  return buildZip([entry(MANIFEST_NAME, JSON.stringify(manifest)), ...entries])
}

// ── 1. Format zip ──────────────────────────────────────────────────────────

console.log('\nFormat zip')

check('aller-retour : ce qui entre ressort identique', () => {
  const src = [entry('data/config.json', '{"a":1}'), entry('data/characters/hana/character.json', '{"name":"Hana"}')]
  const back = readZip(buildZip(src))
  equal(back.length, 2, 'nombre d’entrées')
  equal(back[0].name, 'data/config.json', 'nom de la 1re entrée')
  equal(back[0].data.toString('utf8'), '{"a":1}', 'contenu de la 1re entrée')
  equal(back[1].data.toString('utf8'), '{"name":"Hana"}', 'contenu de la 2e entrée')
})

check('la date de modification traverse l’archive (à 2 s près, pas MS-DOS)', () => {
  const back = readZip(buildZip([entry('data/x.txt', 'x', new Date(2025, 0, 2, 3, 4, 30))]))
  const d = back[0].mtime
  equal(d.getFullYear(), 2025, 'année')
  equal(d.getMonth(), 0, 'mois')
  equal(d.getDate(), 2, 'jour')
  equal(d.getHours(), 3, 'heures')
  equal(d.getMinutes(), 4, 'minutes')
})

check('accents et UTF-8 dans les noms', () => {
  const back = readZip(buildZip([entry('data/characters/élodie-ñ/mémoire.md', 'à')]))
  equal(back[0].name, 'data/characters/élodie-ñ/mémoire.md', 'nom UTF-8')
})

check('un fichier qui n’est pas un zip est refusé', () => {
  throws(() => readZip(Buffer.from('ceci est un texte, pas une archive')), 'pas un .zip', 'texte brut')
})

check('archive tronquée : refusée', () => {
  const zip = buildZip([entry('data/x.txt', 'x'.repeat(500))])
  throws(() => readZip(zip.subarray(0, zip.length - 30)), 'pas un .zip', 'fin coupée')
})

check('CRC faux : refusé (transfert abîmé)', () => {
  throws(() => readZip(breakCrc(buildZip([entry('data/x.txt', 'contenu original')]), 'data/x.txt')), 'CRC', 'CRC faussé')
})

check('flux compressé abîmé : refusé', () => {
  const zip = Buffer.from(buildZip([entry('data/x.txt', 'contenu original assez long pour compresser')]))
  // Un octet du flux DEFLATE est retourné : selon l'endroit, zlib refuse de
  // décompresser ou rend des octets faux — les deux mènent au refus.
  const payload = zip.indexOf(Buffer.from('data/x.txt', 'utf8')) + 'data/x.txt'.length
  zip[payload + 6] = zip[payload + 6] ^ 0xff
  throwsAny(() => readZip(zip), ['CRC', 'illisible', 'taille inattendue'], 'octet retourné')
})

check('taille annoncée mensongère : refusée', () => {
  const zip = Buffer.from(buildZip([entry('data/x.txt', 'y'.repeat(5000))]))
  // Le champ « taille décompressée » de l'en-tête local (offset 22) et celui de
  // l'index sont ramenés à 10 : le flux, lui, en rend 5000.
  zip.writeUInt32LE(10, 22)
  const cd = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  zip.writeUInt32LE(10, cd + 24)
  throws(() => readZip(zip), 'taille inattendue', 'taille mentie')
})

check('bombe : une entrée au-delà du plafond est refusée avant décompression', () => {
  const zip = buildZip([entry('data/x.txt', 'z'.repeat(50_000))])
  throws(
    () => readZip(zip, { maxEntries: 10, maxEntryBytes: 1000, maxTotalBytes: 10_000 }),
    'trop volumineuse',
    'plafond par entrée',
  )
})

check('bombe : total décompressé au-delà du plafond', () => {
  const zip = buildZip([entry('data/a.txt', 'a'.repeat(4000)), entry('data/b.txt', 'b'.repeat(4000))])
  throws(
    () => readZip(zip, { maxEntries: 10, maxEntryBytes: 100_000, maxTotalBytes: 5000 }),
    'trop volumineux',
    'plafond total',
  )
})

check('trop d’entrées : refusé', () => {
  const many = Array.from({ length: 12 }, (_, i) => entry(`data/f${i}.txt`, 'x'))
  throws(() => readZip(buildZip(many), { maxEntries: 5, maxEntryBytes: 1e6, maxTotalBytes: 1e7 }), 'entrées', 'plafond')
})

// ── 2. Zip-slip — les noms d'entrée ────────────────────────────────────────

console.log('\nZip-slip (noms d’entrée)')

const TRAPS = [
  '../../evil.txt',
  'data/../../evil.txt',
  'data/characters/../../../evil.txt',
  '/etc/passwd',
  'C:/Windows/evil.txt',
  'data\\..\\..\\evil.txt',
  'data/..\\evil.txt',
  'data/C:evil.txt',
  './../evil.txt',
  'data//evil.txt',
  'data/./evil.txt',
  'data/CON',
  'data/characters/NUL/character.json',
  'data/evil.txt ',
  'data/evil.',
  'data/co:m.txt',
  'data/a?b.txt',
]

for (const trap of TRAPS) {
  check(`refusé : ${JSON.stringify(trap)}`, () => {
    throws(() => splitEntryName(trap), 'refusé', 'nom piégé')
  })
}

check('noms légitimes acceptés', () => {
  const ok = splitEntryName('data/characters/hana-2/chats/2026-01-02-abcdef.jsonl')
  assert(ok, 'devrait être accepté')
  equal(ok.prefix, 'data', 'préfixe')
  equal(ok.rel, 'characters/hana-2/chats/2026-01-02-abcdef.jsonl', 'chemin relatif')
  const root = splitEntryName(README_NAME)
  equal(root, null, 'fichier à la racine de l’archive')
})

check('archive piégée « ../../evil » : refusée en bloc, rien écrit', () => {
  const roots = freshRoots('slip')
  put(roots.dataDir, 'config.json', '{"model":"local"}')
  const before = snapshot(path.dirname(roots.dataDir))
  const zip = hanamiZip([entry('data/config.json', '{"model":"pirate"}'), entry('../../evil.txt', 'boum')])
  throws(() => planRestore(zip, roots), 'refusé', 'archive piégée')
  throws(() => applyRestore(zip, roots), 'refusé', 'application de l’archive piégée')
  equal(JSON.stringify(snapshot(path.dirname(roots.dataDir))), JSON.stringify(before), 'arborescence intacte')
  equal(read(roots.dataDir, 'config.json'), '{"model":"local"}', 'config non touchée')
  equal(fs.existsSync(roots.netDir), false, 'aucun filet posé (le refus précède tout)')
})

check('archive piégée avec antislash Windows : refusée', () => {
  const roots = freshRoots('slip-win')
  const zip = hanamiZip([entry('data\\..\\..\\evil.txt', 'boum')])
  throws(() => planRestore(zip, roots), 'antislash', 'antislash')
})

// ── 3. Identification de l'archive ─────────────────────────────────────────

console.log('\nIdentification')

check('un zip quelconque n’est pas une sauvegarde Hanami', () => {
  const roots = freshRoots('ident-foreign')
  const zip = buildZip([entry('photos/chat.jpg', 'JPEG'), entry('notes.txt', 'bonjour')])
  throws(() => planRestore(zip, roots), 'pas une sauvegarde Hanami', 'zip étranger')
})

check('manifeste d’une version future : refusé, avec le motif', () => {
  const roots = freshRoots('ident-future')
  const zip = hanamiZip([entry('data/config.json', '{}')], 99)
  throws(() => planRestore(zip, roots), 'version 99', 'format futur')
})

check('manifeste illisible : refusé', () => {
  const roots = freshRoots('ident-broken')
  const zip = buildZip([entry(MANIFEST_NAME, '{oops'), entry('data/config.json', '{}')])
  throws(() => planRestore(zip, roots), 'illisible', 'manifeste cassé')
})

check('archive d’AVANT le manifeste : reconnue à sa structure, et signalée', () => {
  const roots = freshRoots('ident-legacy')
  const zip = buildZip([
    entry(README_NAME, 'HANAMI — SAUVEGARDE\r\nFaite le 2026-05-04 09:07 (heure locale) — 3 fichiers.'),
    entry('data/config.json', '{}'),
    entry('data/characters/hana/character.json', '{"name":"Hana"}'),
  ])
  const plan = planRestore(zip, roots)
  equal(plan.identity.source, 'structure', 'reconnaissance')
  equal(plan.identity.version, 0, 'version « avant manifeste »')
  assert(plan.identity.createdAt?.startsWith('2026-05-04'), 'date lue dans le LISEZMOI')
  assert(plan.preview.warnings.includes('noManifest'), 'avertissement noManifest')
})

check('archive sans rien de restaurable : refusée', () => {
  const roots = freshRoots('ident-empty')
  const zip = buildZip([entry(README_NAME, 'HANAMI — SAUVEGARDE'), entry('vrm/modele.vrm', 'GLB')])
  throws(() => planRestore(zip, roots), 'sans données restaurables', 'archive vide')
})

// ── 4. L'aperçu dit vrai ───────────────────────────────────────────────────

console.log('\nAperçu (diff)')

check('ajoutés / remplacés / intacts / conservés', () => {
  const roots = freshRoots('diff')
  put(roots.dataDir, 'config.json', '{"model":"ancien"}') // sera remplacé
  put(roots.dataDir, 'ui.json', '{"lang":"fr"}') // identique dans l'archive
  put(roots.dataDir, 'characters/hana/character.json', '{"name":"Hana"}')
  put(roots.dataDir, 'characters/hana/chats/a.jsonl', 'vieux')
  put(roots.dataDir, 'characters/kaori/character.json', '{"name":"Kaori"}') // absent de l'archive
  put(roots.portraitsDir, 'hana.png', 'PNG-ancien')

  const zip = hanamiZip([
    entry('data/config.json', '{"model":"nouveau"}'),
    entry('data/ui.json', '{"lang":"fr"}'),
    entry('data/characters/hana/character.json', '{"name":"Hana"}'),
    entry('data/characters/hana/chats/a.jsonl', 'neuf'),
    entry('data/characters/hana/chats/b.jsonl', 'nouveau chat'),
    entry('data/characters/hana/memory/MEMORY.md', '# mémoire'),
    entry('data/characters/yuki/character.json', '{"name":"Yuki"}'),
    entry('portraits/hana.png', 'PNG-nouveau'),
    entry(README_NAME, 'HANAMI — SAUVEGARDE'),
  ])

  const { preview } = planRestore(zip, roots)
  equal(preview.files.total, 8, 'fichiers restaurables')
  equal(preview.files.ignored, 2, 'entrées ignorées (LISEZMOI + manifeste)')
  equal(preview.files.added, 3, 'ajoutés (b.jsonl, MEMORY.md, yuki)')
  equal(preview.files.replaced, 3, 'remplacés (config, a.jsonl, portrait)')
  equal(preview.files.identical, 2, 'intacts (ui.json, character.json de Hana)')
  equal(preview.counts.characters, 2, 'personnages dans l’archive')
  equal(preview.counts.chats, 2, 'conversations')
  equal(preview.counts.memory, 1, 'fichiers mémoire')
  equal(preview.counts.portraits, 1, 'portraits')
  equal(preview.counts.config, true, 'config.json présent')
  equal(preview.counts.ui, true, 'ui.json présent')
  equal(preview.kept.characters.join(','), 'kaori', 'personnage conservé')
  equal(preview.kept.files, 1, 'fichiers locaux conservés')
  equal(preview.characters.find((c) => c.id === 'hana')?.status, 'replaced', 'statut de Hana')
  equal(preview.characters.find((c) => c.id === 'yuki')?.status, 'added', 'statut de Yuki')
  equal(preview.characters.find((c) => c.id === 'yuki')?.name, 'Yuki', 'nom lu dans character.json')
  assert(preview.warnings.includes('configReplaced'), 'avertissement config')
})

check('mot de passe différent : signalé', () => {
  const roots = freshRoots('diff-pw')
  put(roots.dataDir, 'config.json', '{"password":"ancien"}')
  const zip = hanamiZip([entry('data/config.json', '{"password":"nouveau"}')])
  assert(planRestore(zip, roots).preview.warnings.includes('passwordChanges'), 'avertissement mot de passe')
})

check('même mot de passe : rien de signalé', () => {
  const roots = freshRoots('diff-pw-same')
  put(roots.dataDir, 'config.json', '{"password":"pareil","model":"a"}')
  const zip = hanamiZip([entry('data/config.json', '{"password":"pareil","model":"b"}')])
  const w = planRestore(zip, roots).preview.warnings
  assert(!w.includes('passwordChanges'), 'aucun avertissement mot de passe')
})

check('l’aperçu n’écrit RIEN', () => {
  const roots = freshRoots('dry')
  put(roots.dataDir, 'config.json', '{"a":1}')
  const before = snapshot(path.dirname(roots.dataDir))
  planRestore(hanamiZip([entry('data/config.json', '{"a":2}'), entry('data/neuf.txt', 'neuf')]), roots)
  equal(JSON.stringify(snapshot(path.dirname(roots.dataDir))), JSON.stringify(before), 'arborescence inchangée')
  equal(fs.existsSync(roots.netDir), false, 'aucun filet')
})

// ── 5. L'écriture ──────────────────────────────────────────────────────────

console.log('\nRestauration')

check('cycle complet : le filet est posé, les fichiers basculent, rien n’est supprimé', () => {
  const roots = freshRoots('apply')
  put(roots.dataDir, 'config.json', '{"model":"ancien"}')
  put(roots.dataDir, 'characters/kaori/character.json', '{"name":"Kaori"}')
  put(roots.portraitsDir, 'kaori.png', 'PNG-kaori')

  const zip = hanamiZip([
    entry('data/config.json', '{"model":"nouveau"}'),
    entry('data/characters/hana/character.json', '{"name":"Hana"}'),
    entry('data/characters/hana/chats/a.jsonl', 'ligne', new Date(2025, 2, 3, 14, 20, 0)),
    entry('portraits/hana.png', 'PNG-hana'),
  ])

  const result = applyRestore(zip, roots)

  equal(read(roots.dataDir, 'config.json'), '{"model":"nouveau"}', 'config remplacée')
  equal(read(roots.dataDir, 'characters/hana/character.json'), '{"name":"Hana"}', 'personnage ajouté')
  equal(read(roots.portraitsDir, 'hana.png'), 'PNG-hana', 'portrait ajouté')
  // Rien n'est supprimé : ce que l'archive ne porte pas reste en place.
  equal(read(roots.dataDir, 'characters/kaori/character.json'), '{"name":"Kaori"}', 'personnage conservé')
  equal(read(roots.portraitsDir, 'kaori.png'), 'PNG-kaori', 'portrait conservé')

  equal(result.files.added, 3, 'ajoutés')
  equal(result.files.replaced, 1, 'remplacés')

  // Le filet existe, et contient bien l'état d'AVANT.
  assert(fs.existsSync(result.net.file), 'fichier de filet présent')
  assert(result.net.file.includes('avant-restauration'), 'nom explicite du filet')
  const net = readZip(fs.readFileSync(result.net.file))
  const netConfig = net.find((e) => e.name === 'data/config.json')
  equal(netConfig?.data.toString('utf8'), '{"model":"ancien"}', 'le filet porte la config d’avant')
  assert(
    net.some((e) => e.name === 'portraits/kaori.png'),
    'le filet porte aussi les portraits',
  )
  assert(
    net.some((e) => e.name === MANIFEST_NAME),
    'le filet est une archive Hanami complète (restaurable à son tour)',
  )

  // Horodatage : la conversation restaurée garde sa date (l'ordre des chats en dépend).
  const chatTime = fs.statSync(path.join(roots.dataDir, 'characters/hana/chats/a.jsonl')).mtime
  equal(chatTime.getFullYear(), 2025, 'année du chat restauré')
  equal(chatTime.getMonth(), 2, 'mois du chat restauré')

  // Le dossier de travail est vidé (il contenait une copie de config.json).
  const leftovers = fs.existsSync(roots.workDir) ? fs.readdirSync(roots.workDir) : []
  equal(leftovers.length, 0, 'dossier de travail vidé')
})

check('l’aperçu disait vrai : les chiffres annoncés sont ceux écrits', () => {
  const roots = freshRoots('truthful')
  put(roots.dataDir, 'config.json', '{"a":1}')
  put(roots.dataDir, 'ui.json', '{"lang":"fr"}')
  const zip = hanamiZip([
    entry('data/config.json', '{"a":2}'),
    entry('data/ui.json', '{"lang":"fr"}'),
    entry('data/characters/x/character.json', '{"name":"X"}'),
  ])
  const { preview } = planRestore(zip, roots)
  const result = applyRestore(zip, roots)
  equal(result.files.total, preview.files.total, 'total')
  equal(result.files.added, preview.files.added, 'ajoutés')
  equal(result.files.replaced, preview.files.replaced, 'remplacés')
  equal(result.files.identical, preview.files.identical, 'intacts')
})

check('deux restaurations dans la même minute : deux filets, aucun écrasé', () => {
  const roots = freshRoots('two-nets')
  put(roots.dataDir, 'config.json', '{"n":0}')
  const at = new Date(2026, 6, 15, 10, 30, 0)
  const a = applyRestore(hanamiZip([entry('data/config.json', '{"n":1}')]), roots, at)
  const b = applyRestore(hanamiZip([entry('data/config.json', '{"n":2}')]), roots, at)
  assert(a.net.file !== b.net.file, 'deux chemins distincts')
  assert(fs.existsSync(a.net.file) && fs.existsSync(b.net.file), 'les deux filets existent')
  const first = readZip(fs.readFileSync(a.net.file)).find((e) => e.name === 'data/config.json')
  equal(first?.data.toString('utf8'), '{"n":0}', 'le premier filet porte bien l’état d’origine')
})

check('archive abîmée : aucune écriture, aucun filet, l’état reste entier', () => {
  const roots = freshRoots('corrupt')
  put(roots.dataDir, 'config.json', '{"intact":true}')
  const before = snapshot(path.dirname(roots.dataDir))
  const zip = breakCrc(hanamiZip([entry('data/config.json', '{"intact":false}')]), 'data/config.json')
  throws(() => applyRestore(zip, roots), 'CRC', 'archive abîmée')
  equal(JSON.stringify(snapshot(path.dirname(roots.dataDir))), JSON.stringify(before), 'arborescence intacte')
  equal(fs.existsSync(roots.netDir), false, 'aucun filet (la lecture échoue avant tout)')
})

check('restauration sur une instance vide : tout est « ajouté »', () => {
  const roots = freshRoots('fresh')
  const zip = hanamiZip([
    entry('data/config.json', '{"model":"m"}'),
    entry('data/characters/hana/character.json', '{"name":"Hana"}'),
  ])
  const { preview } = planRestore(zip, roots)
  equal(preview.files.added, 2, 'tout est ajouté')
  equal(preview.files.replaced, 0, 'rien à remplacer')
  assert(preview.warnings.includes('emptyInstance'), 'avertissement instance vide')
  const result = applyRestore(zip, roots)
  equal(result.files.added, 2, 'écrits')
  equal(read(roots.dataDir, 'characters/hana/character.json'), '{"name":"Hana"}', 'personnage écrit')
})

check('les entrées hors data/ et portraits/ ne sont jamais écrites', () => {
  const roots = freshRoots('foreign-prefix')
  const base = path.dirname(roots.dataDir)
  const zip = hanamiZip([
    entry('data/config.json', '{}'),
    entry('vrm/modele.vrm', 'GLB'),
    entry('node_modules/pirate.js', 'evil'),
  ])
  const { preview } = planRestore(zip, roots)
  equal(preview.files.total, 1, 'une seule entrée retenue')
  equal(preview.files.ignored, 3, 'trois ignorées (manifeste, vrm, node_modules)')
  applyRestore(zip, roots)
  equal(fs.existsSync(path.join(base, 'vrm')), false, 'aucun dossier vrm/ créé')
  equal(fs.existsSync(path.join(base, 'node_modules')), false, 'aucun node_modules/ créé')
})

// ── Bilan ──────────────────────────────────────────────────────────────────

fs.rmSync(TMP, { recursive: true, force: true })

console.log(`\n${passed} tests passés, ${failures.length} échec(s).`)
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
