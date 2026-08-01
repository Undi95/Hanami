// Restauration d'une archive de sauvegarde — la route la plus dangereuse de
// l'app, et donc la plus prudente.
//
// L'ORDRE compte, et il n'est jamais inversé :
//   1. lire l'archive ENTIÈREMENT en mémoire et la vérifier (format, CRC, noms) ;
//   2. calculer le diff avec l'existant — c'est l'aperçu, il n'écrit RIEN ;
//   3. (sur confirmation) archiver l'état actuel : le filet ;
//   4. extraire dans un dossier de travail, puis basculer fichier par fichier.
// Un échec avant l'étape 4 ne laisse aucune trace ; un échec pendant laisse le
// filet, dont le chemin remonte dans le message d'erreur.
//
// Ce que la restauration NE fait PAS : supprimer. Elle remplace ce qu'elle
// apporte et laisse tout le reste en place — un personnage absent de l'archive
// est CONSERVÉ. C'est un choix : une restauration doit pouvoir se tenter sans
// jouer le passé contre le présent.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { RestoreCharacterEntry, RestorePreview, RestoreResult, RestoreWarning } from '../../shared/types'
import {
  BACKUP_FORMAT_VERSION,
  MANIFEST_NAME,
  README_NAME,
  rootFor,
  writeSafetyNet,
  type BackupRoots,
} from './backupArchive'
import { DEFAULT_ZIP_LIMITS, ZipError, readZip, type ZipEntry, type ZipLimits } from './zip'

/** Plafond du corps de requête accepté par la route (doit rester ≥ maxTotalBytes utile). */
export const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024

const LIMITS: ZipLimits = {
  ...DEFAULT_ZIP_LIMITS,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 384 * 1024 * 1024,
}

/** Erreur de restauration — message destiné à être affiché tel quel dans l'UI. */
export class RestoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RestoreError'
  }
}

// ── Sécurité des chemins (zip-slip) ────────────────────────────────────────

// Noms de périphériques Windows : "data/characters/CON/character.json" n'écrirait
// pas un fichier mais parlerait à un port série. Refusés partout, y compris
// ailleurs que sous Windows — une archive Hanami n'en contient jamais.
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i
// Caractères interdits par Windows dans un nom de fichier. Le ':' est le plus
// dangereux : "C:evil" est un chemin RELATIF AU LECTEUR C, que path.resolve
// résoudrait hors de la cible. sanitizeFileName() les retire déjà à l'écriture,
// une archive légitime n'en porte donc aucun.
const FORBIDDEN_CHARS = /[<>:"|?*]/

/**
 * Découpe le nom d'une entrée en (préfixe de premier niveau, chemin relatif) et
 * REFUSE tout ce qui pourrait sortir du dossier cible. C'est LA défense
 * anti-zip-slip : elle est syntaxique (avant toute résolution), et doublée d'une
 * vérification par path.relative au moment de résoudre la cible.
 * Rend `null` pour un fichier posé à la racine de l'archive (le LISEZMOI, le
 * manifeste) : pas une cible, pas une menace.
 */
export function splitEntryName(name: string): { prefix: string; rel: string } | null {
  if (!name || name.length > 1024) throw new RestoreError(`Nom d’entrée refusé : ${JSON.stringify(name.slice(0, 80))}`)
  // Octet nul et caractères de contrôle : jamais dans un nom légitime.
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) < 0x20 || name.charCodeAt(i) === 0x7f) {
      throw new RestoreError(`Nom d’entrée refusé (caractère de contrôle) : ${JSON.stringify(name.slice(0, 80))}`)
    }
  }
  // Le zip ne connaît QUE '/'. Un '\' serait un séparateur sous Windows et un
  // simple caractère ailleurs : cette ambiguïté est exactement ce dont vit
  // zip-slip. Refus net.
  if (name.includes('\\')) throw new RestoreError(`Nom d’entrée refusé (antislash) : ${name}`)
  if (name.startsWith('/')) throw new RestoreError(`Nom d’entrée refusé (chemin absolu) : ${name}`)
  const segments = name.split('/')
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new RestoreError(`Nom d’entrée refusé (traversée de dossier) : ${name}`)
    }
    if (FORBIDDEN_CHARS.test(seg)) throw new RestoreError(`Nom d’entrée refusé (caractère interdit) : ${name}`)
    if (WINDOWS_DEVICE.test(seg)) throw new RestoreError(`Nom d’entrée refusé (nom réservé) : ${name}`)
    // Windows retire les points et espaces finaux : "evil. " et "evil" seraient
    // le même fichier, ce qui permet de viser un nom qu'on croyait épargné.
    if (/[. ]$/.test(seg)) throw new RestoreError(`Nom d’entrée refusé (point ou espace final) : ${name}`)
  }
  if (segments.length < 2) return null // fichier à la racine de l'archive
  return { prefix: segments[0], rel: segments.slice(1).join('/') }
}

/**
 * Chemin absolu de destination, vérifié une seconde fois par résolution : même
 * si un cas non prévu passait le filtre syntaxique, la cible NE PEUT PAS sortir
 * du dossier racine.
 */
export function resolveTarget(root: string, rel: string): string {
  const abs = path.resolve(root, rel)
  const back = path.relative(root, abs)
  if (back === '' || back.startsWith('..') || path.isAbsolute(back)) {
    throw new RestoreError(`Nom d’entrée refusé (sortie du dossier cible) : ${rel}`)
  }
  return abs
}

// ── Identification de l'archive ────────────────────────────────────────────

interface Identity {
  version: number
  createdAt: string | null
  source: 'manifest' | 'structure'
}

const CHARACTER_JSON = /^data\/characters\/[^/]+\/character\.json$/
const README_DATE = /Faite le (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/

/**
 * « Est-ce bien une archive Hanami ? » Le manifeste répond directement ; les
 * archives faites AVANT lui (celles que l'utilisateur a déjà) sont reconnues à
 * leur structure — le LISEZMOI, ou la simple présence d'un config.json ou d'un
 * character.json aux bons endroits.
 */
function identify(entries: ZipEntry[]): Identity {
  const manifest = entries.find((e) => e.name === MANIFEST_NAME)
  if (manifest) {
    let parsed: unknown
    try {
      parsed = JSON.parse(manifest.data.toString('utf8'))
    } catch {
      throw new RestoreError(`${MANIFEST_NAME} illisible — archive Hanami abîmée`)
    }
    const m = parsed as { format?: unknown; version?: unknown; createdAt?: unknown }
    if (m.format !== 'hanami-backup') throw new RestoreError('Ce zip n’est pas une sauvegarde Hanami')
    const version = Number(m.version)
    if (!Number.isInteger(version) || version < 1) throw new RestoreError('Version de sauvegarde illisible')
    if (version > BACKUP_FORMAT_VERSION) {
      throw new RestoreError(
        `Sauvegarde en version ${version} — cette installation d’Hanami ne lit que la version ${BACKUP_FORMAT_VERSION}. Mettez Hanami à jour.`,
      )
    }
    return {
      version,
      createdAt: typeof m.createdAt === 'string' ? m.createdAt : null,
      source: 'manifest',
    }
  }

  const readme = entries.find((e) => e.name === README_NAME)
  const looksHanami =
    (readme && readme.data.toString('utf8', 0, 32).startsWith('HANAMI')) ||
    entries.some((e) => e.name === 'data/config.json' || CHARACTER_JSON.test(e.name))
  if (!looksHanami) {
    throw new RestoreError('Ce zip n’est pas une sauvegarde Hanami (ni manifeste, ni dossier data/ reconnaissable)')
  }
  // Date lue dans le LISEZMOI ; à défaut, la plus récente des entrées.
  let createdAt: string | null = null
  const line = readme?.data.toString('utf8', 0, 400).match(README_DATE)
  if (line) {
    const d = new Date(Number(line[1]), Number(line[2]) - 1, Number(line[3]), Number(line[4]), Number(line[5]))
    if (!Number.isNaN(d.getTime())) createdAt = d.toISOString()
  }
  if (!createdAt && entries.length > 0) {
    const newest = entries.reduce((a, b) => (a.mtime > b.mtime ? a : b))
    createdAt = newest.mtime.toISOString()
  }
  return { version: 0, createdAt, source: 'structure' }
}

// ── Plan de restauration ───────────────────────────────────────────────────

/** Une entrée retenue, sa cible sur le disque, et ce qu'elle y ferait. */
export interface PlannedEntry {
  /** Nom dans l'archive (data/…, portraits/…). */
  name: string
  target: string
  data: Buffer
  mtime: Date
  state: 'added' | 'replaced' | 'identical'
}

export interface RestorePlan {
  identity: Identity
  entries: PlannedEntry[]
  /** Entrées de l'archive hors data/ et portraits/ (LISEZMOI, manifeste…). */
  ignored: number
  bytes: number
  warnings: RestoreWarning[]
  preview: Omit<RestorePreview, 'stagedId'>
}

const CHAT_FILE = /^characters\/[^/]+\/chats\/[^/]+\.jsonl$/
const MEMORY_FILE = /^characters\/[^/]+\/memory\/[^/]+\.md$/
const CHARACTER_DIR = /^characters\/([^/]+)\//

/** Liste des chemins relatifs des fichiers d'un dossier (noms seuls, sans lire le contenu). */
function listRelFiles(dir: string, prefix: string, out: string[]): void {
  let listing: fs.Dirent[]
  try {
    listing = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const item of listing) {
    if (item.isDirectory()) {
      listRelFiles(path.join(dir, item.name), prefix + item.name + '/', out)
      continue
    }
    if (!item.isFile() || item.name.endsWith('.tmp')) continue
    out.push(prefix + item.name)
  }
}

/** Le fichier local existe-t-il, et porte-t-il exactement ces octets ? */
function compareTarget(target: string, data: Buffer): 'added' | 'replaced' | 'identical' {
  let current: Buffer
  try {
    current = fs.readFileSync(target)
  } catch {
    return 'added'
  }
  return current.equals(data) ? 'identical' : 'replaced'
}

/** Mot de passe d'accès porté par un config.json (chaîne vide si absent/illisible). */
function passwordOf(json: Buffer | null): string {
  if (!json) return ''
  try {
    const parsed = JSON.parse(json.toString('utf8')) as { password?: unknown }
    return typeof parsed.password === 'string' ? parsed.password : ''
  } catch {
    return ''
  }
}

/**
 * Lit, vérifie et confronte l'archive à l'existant. AUCUNE écriture : c'est
 * exactement ce que fait l'aperçu, et exactement ce que refait la confirmation
 * avant d'écrire (on ne fait jamais confiance à un plan calculé plus tôt).
 */
export function planRestore(zip: Buffer, roots: BackupRoots): RestorePlan {
  let entries: ZipEntry[]
  try {
    entries = readZip(zip, LIMITS)
  } catch (e) {
    throw e instanceof ZipError ? new RestoreError(e.message) : e
  }
  const identity = identify(entries)

  const planned: PlannedEntry[] = []
  let ignored = 0
  let bytes = 0
  const counts = { characters: 0, chats: 0, memory: 0, portraits: 0, config: false, ui: false, other: 0 }
  const charFiles = new Map<string, { chats: number; memory: number; states: Set<string> }>()
  const charNames = new Map<string, string>()
  const archivePaths = new Set<string>()
  let archiveConfig: Buffer | null = null

  for (const entry of entries) {
    // Lève sur toute tentative de traversée — l'archive ENTIÈRE est alors
    // refusée : une seule entrée piégée disqualifie le fichier.
    const split = splitEntryName(entry.name)
    if (!split) {
      ignored++
      continue
    }
    const root = rootFor(split.prefix, roots)
    if (!root) {
      // Un dossier de premier niveau inconnu (vrm/, backgrounds/ d'une archive
      // bricolée à la main) : ignoré, jamais écrit hors des deux cibles connues.
      ignored++
      continue
    }
    const target = resolveTarget(root, split.rel)
    const state = compareTarget(target, entry.data)
    planned.push({ name: entry.name, target, data: entry.data, mtime: entry.mtime, state })
    archivePaths.add(entry.name)
    bytes += entry.data.length

    if (split.prefix === 'portraits') {
      counts.portraits++
      continue
    }
    const rel = split.rel
    if (rel === 'config.json') {
      counts.config = true
      archiveConfig = entry.data
    } else if (rel === 'ui.json') {
      counts.ui = true
    } else if (CHAT_FILE.test(rel)) {
      counts.chats++
    } else if (MEMORY_FILE.test(rel)) {
      counts.memory++
    } else {
      counts.other++
    }
    const dir = CHARACTER_DIR.exec(rel)
    if (dir) {
      const id = dir[1]
      const acc = charFiles.get(id) ?? { chats: 0, memory: 0, states: new Set<string>() }
      if (CHAT_FILE.test(rel)) acc.chats++
      if (MEMORY_FILE.test(rel)) acc.memory++
      acc.states.add(state)
      charFiles.set(id, acc)
      if (rel === `characters/${id}/character.json`) {
        try {
          const meta = JSON.parse(entry.data.toString('utf8')) as { name?: unknown }
          if (typeof meta.name === 'string' && meta.name.trim()) charNames.set(id, meta.name.trim())
        } catch {
          /* character.json illisible : l'identifiant fera office de nom */
        }
      }
    }
  }

  counts.characters = charFiles.size
  if (planned.length === 0) {
    throw new RestoreError('Archive sans données restaurables (ni data/, ni portraits/)')
  }

  const characters: RestoreCharacterEntry[] = [...charFiles.entries()]
    .map(([id, acc]) => ({
      id,
      name: charNames.get(id) ?? id,
      // Un personnage est « ajouté » si TOUS ses fichiers le sont, « intact » si
      // aucun ne change, « remplacé » dès qu'un seul diffère.
      status: (acc.states.has('replaced') || (acc.states.has('added') && acc.states.has('identical'))
        ? 'replaced'
        : acc.states.has('added')
          ? 'added'
          : 'identical') as RestoreCharacterEntry['status'],
      chats: acc.chats,
      memory: acc.memory,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Ce que la restauration LAISSE : les fichiers locaux que l'archive ne porte pas.
  const local: string[] = []
  listRelFiles(roots.dataDir, 'data/', local)
  listRelFiles(roots.portraitsDir, 'portraits/', local)
  const keptFiles = local.filter((rel) => !archivePaths.has(rel))
  const localCharIds = new Set<string>()
  for (const rel of local) {
    const m = /^data\/characters\/([^/]+)\//.exec(rel)
    if (m) localCharIds.add(m[1])
  }
  const keptCharacters = [...localCharIds].filter((id) => !charFiles.has(id)).sort()

  const added = planned.filter((p) => p.state === 'added').length
  const replaced = planned.filter((p) => p.state === 'replaced').length
  const identical = planned.length - added - replaced

  const warnings: RestoreWarning[] = []
  if (identity.source === 'structure') warnings.push('noManifest')
  if (counts.config) {
    warnings.push('configReplaced')
    let currentConfig: Buffer | null = null
    try {
      currentConfig = fs.readFileSync(path.join(roots.dataDir, 'config.json'))
    } catch {
      /* pas de config locale : rien à comparer */
    }
    if (passwordOf(archiveConfig) !== passwordOf(currentConfig)) warnings.push('passwordChanges')
  }
  if (local.length === 0) warnings.push('emptyInstance')

  return {
    identity,
    entries: planned,
    ignored,
    bytes,
    warnings,
    preview: {
      archive: identity,
      files: { total: planned.length, added, replaced, identical, ignored },
      bytes,
      counts,
      characters,
      kept: { characters: keptCharacters, files: keptFiles.length },
      warnings,
    },
  }
}

// ── Écriture ───────────────────────────────────────────────────────────────

/** Écriture d'un fichier avec fsync — les octets sont sur le disque avant la bascule. */
function writeSynced(file: string, data: Buffer): void {
  const fd = fs.openSync(file, 'w')
  try {
    fs.writeSync(fd, data)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Applique la restauration. Le filet est posé D'ABORD, puis TOUT est extrait
 * dans un dossier de travail (même volume que la cible), et seulement ensuite
 * les fichiers basculent un par un par rename — l'opération atomique du système
 * de fichiers, celle-là même qu'utilisent déjà config.json, ui.json et les .jsonl.
 *
 * L'honnêteté sur la garantie : la bascule d'un ARBRE ne peut pas être atomique
 * en bloc. Ce qu'on garantit, c'est qu'aucun fichier n'est écrit tant que TOUT
 * n'a pas été lu, vérifié (CRC), et posé sur le disque — la phase de bascule ne
 * fait plus que des renames, et l'état d'avant reste entier dans le filet.
 */
export function applyRestore(zip: Buffer, roots: BackupRoots, now = new Date()): RestoreResult {
  const plan = planRestore(zip, roots)
  const net = writeSafetyNet(roots, now)

  const work = path.join(roots.workDir, `apply-${crypto.randomBytes(6).toString('hex')}`)
  try {
    // 1. Extraction complète dans le dossier de travail.
    for (const entry of plan.entries) {
      const staged = path.join(work, entry.name)
      fs.mkdirSync(path.dirname(staged), { recursive: true })
      writeSynced(staged, entry.data)
    }
    // 2. Tous les dossiers de destination existent AVANT la bascule : la phase
    //    suivante ne doit plus rien faire qui puisse échouer pour cette raison.
    for (const entry of plan.entries) fs.mkdirSync(path.dirname(entry.target), { recursive: true })
    // 3. Bascule.
    for (const entry of plan.entries) {
      fs.renameSync(path.join(work, entry.name), entry.target)
      try {
        // La date de modification d'origine survit : l'ordre des conversations
        // (trié sur le mtime) est celui de la sauvegarde, pas celui d'aujourd'hui.
        fs.utimesSync(entry.target, entry.mtime, entry.mtime)
      } catch {
        /* horodatage non repositionné : sans conséquence sur le contenu */
      }
    }
  } catch (e) {
    throw new RestoreError(
      `Restauration interrompue (${e instanceof Error ? e.message : String(e)}). L’état d’avant est intact dans : ${net.file}`,
    )
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }

  const added = plan.entries.filter((p) => p.state === 'added').length
  const replaced = plan.entries.filter((p) => p.state === 'replaced').length
  return {
    net: { file: net.file, fileCount: net.fileCount, bytes: net.bytes },
    files: { total: plan.entries.length, added, replaced, identical: plan.entries.length - added - replaced },
    // Renseigné par la route (elle seule connaît les réglages effectifs).
    passwordChanged: false,
  }
}

// ── Dépôt temporaire (entre l'aperçu et la confirmation) ───────────────────
// L'archive n'est envoyée QU'UNE FOIS : l'aperçu la dépose, la confirmation la
// désigne par son jeton. C'est ce qui garantit que la confirmation porte sur le
// fichier EXACTEMENT montré — et cela évite un second téléversement, ce qui
// compte quand on restaure depuis un téléphone en 4G.

const STAGED_ID = /^[0-9a-f]{24}$/
/** Au-delà, un dépôt oublié est purgé (l'utilisateur a fermé l'onglet). */
const STAGE_TTL_MS = 2 * 60 * 60 * 1000

function stagedFile(roots: BackupRoots, id: string): string {
  if (!STAGED_ID.test(id)) throw new RestoreError('Jeton d’archive invalide')
  return path.join(roots.workDir, `staged-${id}.zip`)
}

/** Dépose l'archive et rend son jeton. */
export function stageArchive(zip: Buffer, roots: BackupRoots): string {
  fs.mkdirSync(roots.workDir, { recursive: true })
  purgeStaging(roots)
  const id = crypto.randomBytes(12).toString('hex')
  writeSynced(stagedFile(roots, id), zip)
  return id
}

export function readStaged(roots: BackupRoots, id: string): Buffer {
  try {
    return fs.readFileSync(stagedFile(roots, id))
  } catch {
    throw new RestoreError('Aperçu expiré — redéposez l’archive et vérifiez-la à nouveau')
  }
}

export function dropStaged(roots: BackupRoots, id: string): void {
  try {
    fs.rmSync(stagedFile(roots, id), { force: true })
  } catch {
    /* déjà parti */
  }
}

/**
 * Purge les dépôts et dossiers de travail oubliés (une archive déposée contient
 * config.json, donc la clé API et le mot de passe : elle ne traîne pas).
 * `maxAgeMs` à 0 vide tout — ce que fait une restauration réussie, les autres
 * aperçus n'ayant plus d'objet.
 */
export function purgeStaging(roots: BackupRoots, maxAgeMs = STAGE_TTL_MS): void {
  let listing: fs.Dirent[]
  try {
    listing = fs.readdirSync(roots.workDir, { withFileTypes: true })
  } catch {
    return
  }
  const now = Date.now()
  for (const item of listing) {
    const full = path.join(roots.workDir, item.name)
    try {
      if (now - fs.statSync(full).mtimeMs < maxAgeMs) continue
      fs.rmSync(full, { recursive: true, force: true })
    } catch {
      /* fichier verrouillé ou déjà parti : la purge suivante réessaiera */
    }
  }
}
