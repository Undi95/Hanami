// L'archive de sauvegarde Hanami : ce qu'elle contient, comment on l'assemble,
// et où se pose le « filet » écrit juste avant une restauration.
// Le format zip lui-même vit dans lib/zip.ts ; ici c'est la CONVENTION Hanami.
//
// Les chemins cibles ne sont jamais lus des constantes de storage.ts mais passés
// en paramètre (BackupRoots) : c'est ce qui rend l'ensemble testable sur un
// répertoire jetable, sans jamais approcher les vraies données.
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, PORTRAITS_DIR, ROOT } from './storage'
import { buildZip, type ZipEntry } from './zip'

/** Les dossiers sur lesquels travaillent sauvegarde et restauration. */
export interface BackupRoots {
  /** Cible du préfixe `data/` de l'archive. */
  dataDir: string
  /** Cible du préfixe `portraits/` de l'archive. */
  portraitsDir: string
  /** Où sont posés les filets d'avant-restauration (jamais supprimés). */
  netDir: string
  /** Dossier de travail : dépôt temporaire et extraction. Vidé après usage. */
  workDir: string
}

/** Les dossiers réels de l'instance. */
export function defaultRoots(): BackupRoots {
  const netDir = path.join(ROOT, 'backups')
  return {
    dataDir: DATA_DIR,
    portraitsDir: PORTRAITS_DIR,
    // Hors de data/ : un filet posé DANS data/ finirait dans le filet suivant,
    // puis dans celui d'après — le poids doublerait à chaque restauration.
    netDir,
    workDir: path.join(netDir, '.tmp'),
  }
}

/** Les deux préfixes de l'archive et le dossier qu'ils désignent. */
export function rootFor(prefix: string, roots: BackupRoots): string | null {
  if (prefix === 'data') return roots.dataDir
  if (prefix === 'portraits') return roots.portraitsDir
  return null
}

// ── Manifeste ──────────────────────────────────────────────────────────────

/** Version du FORMAT d'archive (pas celle de l'app) : elle ne bouge que si la structure change. */
export const BACKUP_FORMAT_VERSION = 1
export const MANIFEST_NAME = 'hanami-backup.json'
export const README_NAME = 'LISEZMOI.txt'

export interface BackupManifest {
  format: 'hanami-backup'
  version: number
  createdAt: string
  files: number
  contents: { data: number; portraits: number }
}

/**
 * Le manifeste rend l'archive RECONNAISSABLE sans deviner : la restauration sait
 * tout de suite qu'elle a affaire à une sauvegarde Hanami, et de quelle version
 * de format. Les archives d'AVANT ce fichier restent restaurables — la
 * reconnaissance retombe alors sur leur structure (cf. backupRestore.ts).
 */
function manifest(now: Date, dataCount: number, portraitCount: number): BackupManifest {
  return {
    format: 'hanami-backup',
    version: BACKUP_FORMAT_VERSION,
    createdAt: now.toISOString(),
    files: dataCount + portraitCount,
    contents: { data: dataCount, portraits: portraitCount },
  }
}

// ── Collecte ───────────────────────────────────────────────────────────────

/**
 * Parcours récursif d'un dossier. Seuls les vrais fichiers entrent (ni liens
 * symboliques ni cas exotiques), et les .tmp sont écartés : ce sont les fichiers
 * de transit des écritures atomiques, jamais une donnée à restaurer.
 */
export function collect(dir: string, prefix: string, out: ZipEntry[]): void {
  let listing: fs.Dirent[]
  try {
    listing = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return // dossier absent (première installation) : rien à sauvegarder
  }
  for (const item of listing.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, item.name)
    const name = prefix + item.name
    if (item.isDirectory()) {
      collect(full, name + '/', out)
      continue
    }
    if (!item.isFile() || item.name.endsWith('.tmp')) continue
    let mtime = new Date()
    try {
      mtime = fs.statSync(full).mtime
    } catch {
      /* stat impossible : horodatage du jour, sans conséquence */
    }
    out.push({ name, data: fs.readFileSync(full), mtime })
  }
}

/** Date locale au format AAAA-MM-JJ (nom du fichier et du LISEZMOI). */
export function dayKey(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Horodatage minute par minute pour les noms de filets : AAAA-MM-JJ-HHhMM. */
function stampKey(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dayKey(d)}-${hh}h${mi}`
}

/**
 * Note posée à la racine du zip : ce qu'il contient, ce qu'il ne contient pas,
 * et comment restaurer. Bilingue, parce que la sauvegarde peut être ouverte
 * n'importe où, des mois plus tard.
 */
export function readme(now: Date, fileCount: number): string {
  const stamp = `${dayKey(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return [
    'HANAMI — SAUVEGARDE',
    `Faite le ${stamp} (heure locale) — ${fileCount} fichiers.`,
    '',
    'CONTENU',
    '  data/      vos personnages, conversations, mémoires, réglages (config.json)',
    '             et préférences d’interface (ui.json).',
    '  portraits/ les portraits 2D des personnages importés.',
    '',
    'NON INCLUS (volumineux et retéléchargeables) :',
    '  vrm/         les modèles 3D des avatars.',
    '  backgrounds/ les images de fond.',
    'Remettez-les vous-même après restauration : Hanami retrouve les personnages',
    'qui les utilisent dès que les fichiers reprennent leur nom d’origine.',
    '',
    'RESTAURER',
    '  Depuis Hanami : Réglages ▸ Données ▸ « Restaurer une sauvegarde », choisissez',
    '  ce fichier. Un aperçu montre ce qui sera ajouté et remplacé AVANT d’écrire,',
    '  et l’état actuel est archivé dans backups/ juste avant la restauration.',
    '  À la main : arrêtez Hanami, déposez les dossiers data/ et portraits/ de ce zip',
    '  à la racine d’Hanami (à côté de package.json), en remplaçant l’existant. Relancez.',
    '',
    'ATTENTION : data/config.json contient votre clé API et votre mot de passe',
    'd’accès. Gardez ce zip pour vous.',
    '',
    '— — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — —',
    '',
    'HANAMI — BACKUP',
    `Created on ${stamp} (local time) — ${fileCount} files.`,
    '',
    'CONTENTS',
    '  data/      your characters, chats, memories, settings (config.json)',
    '             and interface preferences (ui.json).',
    '  portraits/ the 2D portraits of imported characters.',
    '',
    'NOT INCLUDED (large and re-downloadable):',
    '  vrm/         the 3D avatar models.',
    '  backgrounds/ the background images.',
    'Put those back yourself after restoring: Hanami re-links the characters that',
    'use them as soon as the files carry their original names again.',
    '',
    'RESTORE',
    '  From Hanami: Settings ▸ Data ▸ “Restore a backup”, pick this file. A preview',
    '  shows what will be added and replaced BEFORE anything is written, and the',
    '  current state is archived into backups/ right before the restore.',
    '  By hand: stop Hanami, then drop the data/ and portraits/ folders from this zip',
    '  at the root of Hanami (next to package.json), replacing what is there. Restart.',
    '',
    'WARNING: data/config.json holds your API key and access password.',
    'Keep this zip private.',
    '',
  ].join('\r\n') // CRLF : lisible dans le Bloc-notes de Windows comme ailleurs
}

// ── Assemblage ─────────────────────────────────────────────────────────────

export interface BuiltBackup {
  zip: Buffer
  fileCount: number
  /** Nom de fichier proposé au téléchargement. */
  filename: string
}

/**
 * L'archive complète, en mémoire : manifeste + LISEZMOI en tête, puis data/ et
 * portraits/. C'est la MÊME fonction pour le téléchargement des Réglages et pour
 * le filet d'avant-restauration — un seul format à maintenir, donc un filet
 * restaurable par la route de restauration comme n'importe quelle sauvegarde.
 */
export function buildBackup(roots: BackupRoots, now = new Date()): BuiltBackup {
  const files: ZipEntry[] = []
  collect(roots.dataDir, 'data/', files)
  const dataCount = files.length
  collect(roots.portraitsDir, 'portraits/', files)
  const portraitCount = files.length - dataCount
  const zip = buildZip([
    {
      name: MANIFEST_NAME,
      data: Buffer.from(JSON.stringify(manifest(now, dataCount, portraitCount), null, 2), 'utf8'),
      mtime: now,
    },
    { name: README_NAME, data: Buffer.from(readme(now, files.length), 'utf8'), mtime: now },
    ...files,
  ])
  return { zip, fileCount: files.length, filename: `hanami-backup-${dayKey(now)}.zip` }
}

// ── Filet d'avant-restauration ─────────────────────────────────────────────

/** Le filet posé, tel qu'on le montre à l'utilisateur. */
export interface SafetyNet {
  /** Chemin absolu du fichier — affiché après coup, pour aller le chercher. */
  file: string
  fileCount: number
  bytes: number
}

/**
 * Archive l'état ACTUEL avant d'écrire quoi que ce soit. Le fichier est
 * horodaté, posé dans backups/, et n'est JAMAIS supprimé automatiquement : c'est
 * le seul retour en arrière possible si la sauvegarde restaurée n'était pas la
 * bonne. Écriture tmp + fsync + rename, comme tout le reste de l'app.
 */
export function writeSafetyNet(roots: BackupRoots, now = new Date()): SafetyNet {
  const built = buildBackup(roots, now)
  fs.mkdirSync(roots.netDir, { recursive: true })
  // Deux restaurations dans la même minute : on ne recouvre jamais un filet.
  let file = path.join(roots.netDir, `hanami-avant-restauration-${stampKey(now)}.zip`)
  for (let n = 2; fs.existsSync(file); n++) {
    file = path.join(roots.netDir, `hanami-avant-restauration-${stampKey(now)}-${n}.zip`)
  }
  const tmp = file + '.tmp'
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, built.zip)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
  return { file, fileCount: built.fileCount, bytes: built.zip.length }
}
