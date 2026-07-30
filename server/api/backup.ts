// Router sauvegarde : GET /api/backup renvoie un vrai .zip de data/ + portraits/.
// Écrit à la main, ZÉRO dépendance : zlib natif pour la compression DEFLATE, un
// CRC-32 maison, et les trois structures du format zip posées en little-endian
// (Local File Header, Central Directory, End Of Central Directory).
// Pas de zip64 : data/ et portraits/ ne pèsent que des mégaoctets.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { Router, type Response } from 'express'
import { DATA_DIR, PORTRAITS_DIR } from '../lib/storage'

export const backupRouter = Router()

// ── CRC-32 (polynôme réfléchi 0xEDB88320, celui du zip et de PNG) ───────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// ── Écriture du zip ────────────────────────────────────────────────────────

/** Un fichier à mettre dans l'archive : chemin DANS le zip (séparateurs /) + octets. */
interface ZipEntry {
  name: string
  data: Buffer
  mtime: Date
}

/**
 * Horodatage MS-DOS (deux mots de 16 bits) : secondes par pas de 2, année à
 * partir de 1980. Une date antérieure est ramenée au 1er janvier 1980, seule
 * valeur représentable.
 */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = d.getFullYear()
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 }
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f)
  const date = (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f)
  return { time, date }
}

// Drapeaux généraux : bit 11 = les noms de fichiers sont en UTF-8 (accents des
// noms de personnages). Version « nécessaire pour extraire » : 20 (2.0, deflate).
const FLAG_UTF8 = 0x0800
const VERSION = 20
const METHOD_DEFLATE = 8

/**
 * Assemble l'archive complète en mémoire. Chaque fichier donne un Local File
 * Header suivi de ses octets compressés ; le Central Directory reprend les mêmes
 * champs plus l'offset de son en-tête local, et l'EOCD ferme l'archive.
 * Les dossiers ne reçoivent pas d'entrée : les chemins des fichiers suffisent.
 */
function buildZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const compressed = zlib.deflateRawSync(entry.data, { level: 9 })
    const { time, date } = dosDateTime(entry.mtime)
    const crc = crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // signature
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(FLAG_UTF8, 6)
    local.writeUInt16LE(METHOD_DEFLATE, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // pas de champ « extra »
    chunks.push(local, nameBuf, compressed)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0) // signature
    dir.writeUInt16LE(VERSION, 4) // version d'écriture
    dir.writeUInt16LE(VERSION, 6) // version nécessaire
    dir.writeUInt16LE(FLAG_UTF8, 8)
    dir.writeUInt16LE(METHOD_DEFLATE, 10)
    dir.writeUInt16LE(time, 12)
    dir.writeUInt16LE(date, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(compressed.length, 20)
    dir.writeUInt32LE(entry.data.length, 24)
    dir.writeUInt16LE(nameBuf.length, 28)
    dir.writeUInt16LE(0, 30) // extra
    dir.writeUInt16LE(0, 32) // commentaire
    dir.writeUInt16LE(0, 34) // disque de départ
    dir.writeUInt16LE(0, 36) // attributs internes
    dir.writeUInt32LE(0, 38) // attributs externes
    dir.writeUInt32LE(offset, 42) // offset du Local File Header
    central.push(dir, nameBuf)

    offset += local.length + nameBuf.length + compressed.length
  }

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0) // signature
  end.writeUInt16LE(0, 4) // numéro de ce disque
  end.writeUInt16LE(0, 6) // disque du central directory
  end.writeUInt16LE(entries.length, 8) // entrées sur ce disque
  end.writeUInt16LE(entries.length, 10) // entrées au total
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16) // offset du central directory
  end.writeUInt16LE(0, 20) // pas de commentaire d'archive
  return Buffer.concat([...chunks, directory, end])
}

// ── Collecte des fichiers ──────────────────────────────────────────────────

/**
 * Parcours récursif d'un dossier. Seuls les vrais fichiers entrent (ni liens
 * symboliques ni cas exotiques), et les .tmp sont écartés : ce sont les fichiers
 * de transit des écritures atomiques, jamais une donnée à restaurer.
 */
function collect(dir: string, prefix: string, out: ZipEntry[]): void {
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
function dayKey(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * Note posée à la racine du zip : ce qu'il contient, ce qu'il ne contient pas,
 * et comment restaurer. Bilingue, parce que la sauvegarde peut être ouverte
 * n'importe où, des mois plus tard.
 */
function readme(now: Date, fileCount: number): string {
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
    '  Arrêtez Hanami, puis déposez les dossiers data/ et portraits/ de ce zip à la',
    '  racine d’Hanami (à côté de package.json), en remplaçant l’existant. Relancez.',
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
    '  Stop Hanami, then drop the data/ and portraits/ folders from this zip at the',
    '  root of Hanami (next to package.json), replacing what is there. Restart.',
    '',
    'WARNING: data/config.json holds your API key and access password.',
    'Keep this zip private.',
    '',
  ].join('\r\n') // CRLF : lisible dans le Bloc-notes de Windows comme ailleurs
}

// ── Route ──────────────────────────────────────────────────────────────────
// Gardée par l'authMiddleware global de /api (server/index.ts) : sans lui, une
// simple URL suffirait à aspirer config.json et son mot de passe.

backupRouter.get('/api/backup', (_req, res: Response) => {
  try {
    const now = new Date()
    const files: ZipEntry[] = []
    collect(DATA_DIR, 'data/', files)
    collect(PORTRAITS_DIR, 'portraits/', files)
    // Le LISEZMOI passe en tête de l'archive, avant les données.
    const zip = buildZip([
      { name: 'LISEZMOI.txt', data: Buffer.from(readme(now, files.length), 'utf8'), mtime: now },
      ...files,
    ])
    res.set('Content-Type', 'application/zip')
    res.set('Content-Disposition', `attachment; filename="hanami-backup-${dayKey(now)}.zip"`)
    res.set('Content-Length', String(zip.length))
    res.set('Cache-Control', 'no-store')
    res.end(zip)
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
})
