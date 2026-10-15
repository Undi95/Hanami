// Format zip — écriture ET lecture, ZÉRO dépendance : zlib natif pour DEFLATE,
// un CRC-32 maison, et les trois structures du format posées en little-endian
// (Local File Header, Central Directory, End Of Central Directory).
// Pas de zip64 : data/ et portraits/ ne pèsent que des mégaoctets — une archive
// zip64 est REFUSÉE plutôt que mal lue (cf. readZip).
//
// La lecture sert la restauration : elle est donc DÉFENSIVE. Tout ce qui n'est
// pas exactement conforme lève, et rien n'est jamais écrit sur le disque ici —
// readZip rend des octets en mémoire, la décision d'écrire appartient à
// backupRestore.ts.
import zlib from 'node:zlib'
import { CodedError, ErrorCodes } from '../../shared/errorCodes'

/** Un fichier de l'archive : chemin DANS le zip (séparateurs /) + octets. */
export interface ZipEntry {
  name: string
  data: Buffer
  mtime: Date
}

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

export function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// ── Horodatage MS-DOS ──────────────────────────────────────────────────────

/**
 * Deux mots de 16 bits : secondes par pas de 2, année à partir de 1980. Une date
 * antérieure est ramenée au 1er janvier 1980, seule valeur représentable.
 */
export function dosDateTime(d: Date): { time: number; date: number } {
  const year = d.getFullYear()
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 }
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f)
  const date = (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f)
  return { time, date }
}

/** Inverse de dosDateTime — la date de modification d'origine survit à la restauration. */
export function dosToDate(time: number, date: number): Date {
  const year = ((date >> 9) & 0x7f) + 1980
  const month = ((date >> 5) & 0x0f) - 1
  const day = date & 0x1f
  const hours = (time >> 11) & 0x1f
  const minutes = (time >> 5) & 0x3f
  const seconds = (time & 0x1f) * 2
  const d = new Date(year, Math.max(0, month), Math.max(1, day), hours, minutes, seconds)
  return Number.isNaN(d.getTime()) ? new Date(1980, 0, 1) : d
}

// Drapeaux généraux : bit 11 = les noms de fichiers sont en UTF-8 (accents des
// noms de personnages). Version « nécessaire pour extraire » : 20 (2.0, deflate).
const FLAG_UTF8 = 0x0800
const FLAG_DATA_DESCRIPTOR = 0x0008
const VERSION = 20
const METHOD_STORE = 0
const METHOD_DEFLATE = 8

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
// Sentinelle zip64 : une taille ou un offset à 0xFFFFFFFF renvoie vers un champ
// « extra » que ce lecteur ne sait pas lire — on refuse au lieu de deviner.
const ZIP64_MARK = 0xffffffff

// ── Écriture ───────────────────────────────────────────────────────────────

/**
 * Assemble l'archive complète en mémoire. Chaque fichier donne un Local File
 * Header suivi de ses octets compressés ; le Central Directory reprend les mêmes
 * champs plus l'offset de son en-tête local, et l'EOCD ferme l'archive.
 * Les dossiers ne reçoivent pas d'entrée : les chemins des fichiers suffisent.
 */
export function buildZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const compressed = zlib.deflateRawSync(entry.data, { level: 9 })
    const { time, date } = dosDateTime(entry.mtime)
    const crc = crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0) // signature
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
    dir.writeUInt32LE(SIG_CENTRAL, 0) // signature
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
  end.writeUInt32LE(SIG_EOCD, 0) // signature
  end.writeUInt16LE(0, 4) // numéro de ce disque
  end.writeUInt16LE(0, 6) // disque du central directory
  end.writeUInt16LE(entries.length, 8) // entrées sur ce disque
  end.writeUInt16LE(entries.length, 10) // entrées au total
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16) // offset du central directory
  end.writeUInt16LE(0, 20) // pas de commentaire d'archive
  return Buffer.concat([...chunks, directory, end])
}

// ── Lecture ────────────────────────────────────────────────────────────────

/** Bornes de lecture — un zip hostile ne doit jamais faire exploser la mémoire. */
export interface ZipLimits {
  /** Nombre maximal d'entrées. */
  maxEntries: number
  /** Taille décompressée maximale d'UNE entrée (octets). */
  maxEntryBytes: number
  /** Taille décompressée maximale de TOUTE l'archive (octets) — anti « zip bomb ». */
  maxTotalBytes: number
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 20_000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
}

/** Recherche de l'EOCD depuis la FIN (un commentaire d'archive fait au plus 65535 octets). */
function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - (22 + 0xffff))
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i
  }
  return -1
}

/**
 * Lit une archive complète en mémoire, en passant par le Central Directory
 * (l'index de vérité du format ; les en-têtes locaux ne servent qu'à trouver le
 * début des données). Chaque entrée est décompressée puis VÉRIFIÉE au CRC-32 :
 * une archive tronquée ou abîmée par le transfert est refusée avant qu'une seule
 * ligne n'atteigne le disque.
 * Les entrées de dossier (nom terminé par /) sont ignorées : les chemins des
 * fichiers suffisent à recréer l'arborescence.
 */
export function readZip(buf: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  if (buf.length < 22) throw new CodedError(ErrorCodes.zipTooShort)
  const eocd = findEocd(buf)
  if (eocd < 0) throw new CodedError(ErrorCodes.zipNotZip)

  const count = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (cdOffset === ZIP64_MARK || cdSize === ZIP64_MARK || count === 0xffff) {
    throw new CodedError(ErrorCodes.zipZip64)
  }
  if (cdOffset + cdSize > buf.length) throw new CodedError(ErrorCodes.zipTruncatedIndex)
  if (count > limits.maxEntries) {
    throw new CodedError(ErrorCodes.zipTooManyEntries, { count, max: limits.maxEntries })
  }

  const out: ZipEntry[] = []
  let total = 0
  let p = cdOffset

  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length) throw new CodedError(ErrorCodes.zipTruncatedCd)
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new CodedError(ErrorCodes.zipCorruptIndex)
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const dosTime = buf.readUInt16LE(p + 12)
    const dosDate = buf.readUInt16LE(p + 14)
    const crc = buf.readUInt32LE(p + 16)
    const compSize = buf.readUInt32LE(p + 20)
    const rawSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    p += 46 + nameLen + extraLen + commentLen

    if (compSize === ZIP64_MARK || rawSize === ZIP64_MARK || localOffset === ZIP64_MARK) {
      throw new CodedError(ErrorCodes.zipZip64Entry, { name })
    }
    // Chiffrement : bit 0. Rien à tenter, et surtout pas à écrire.
    if (flags & 0x0001) throw new CodedError(ErrorCodes.zipEncrypted, { name })
    if (name.endsWith('/')) continue // entrée de dossier : sans intérêt ici
    if (rawSize > limits.maxEntryBytes) {
      throw new CodedError(ErrorCodes.zipEntryTooLarge, { name, size: rawSize })
    }
    total += rawSize
    if (total > limits.maxTotalBytes) throw new CodedError(ErrorCodes.zipContentTooLarge)

    // En-tête local : seules ses longueurs de nom/extra comptent (elles peuvent
    // différer de celles de l'index), le reste vient du Central Directory.
    if (localOffset + 30 > buf.length) throw new CodedError(ErrorCodes.zipTruncatedEntry, { name })
    if (buf.readUInt32LE(localOffset) !== SIG_LOCAL) throw new CodedError(ErrorCodes.zipCorruptHeader, { name })
    const localNameLen = buf.readUInt16LE(localOffset + 26)
    const localExtraLen = buf.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLen + localExtraLen
    if (start + compSize > buf.length) throw new CodedError(ErrorCodes.zipTruncatedEntry, { name })
    const payload = buf.subarray(start, start + compSize)

    let data: Buffer
    if (method === METHOD_STORE) {
      if (compSize !== rawSize && !(flags & FLAG_DATA_DESCRIPTOR)) {
        throw new CodedError(ErrorCodes.zipCorruptSizes, { name })
      }
      data = Buffer.from(payload)
    } else if (method === METHOD_DEFLATE) {
      try {
        // maxOutputLength : garde-fou natif de zlib — une bombe s'arrête ici,
        // pendant la décompression, pas après avoir rempli la mémoire.
        data = zlib.inflateRawSync(payload, { maxOutputLength: limits.maxEntryBytes })
      } catch (e) {
        throw new CodedError(ErrorCodes.zipEntryUnreadable, {
          name,
          detail: e instanceof Error ? e.message : String(e),
        })
      }
    } else {
      throw new CodedError(ErrorCodes.zipMethodUnsupported, { name, method })
    }

    if (data.length !== rawSize) throw new CodedError(ErrorCodes.zipCorruptSize, { name })
    if (crc32(data) !== crc) throw new CodedError(ErrorCodes.zipCorruptCrc, { name })

    out.push({ name, data, mtime: dosToDate(dosTime, dosDate) })
  }

  return out
}
