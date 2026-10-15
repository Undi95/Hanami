// Statiques LOURDS servis compressés (avatars .vrm, clips .vrma, décors .glb).
//
// Trouvé au test complet : le premier chargement de la scène vivante pesait
// 24 Mo, rien n'étant compressé — et c'est en 4G, loin du PC, que ça compte.
// Mesuré (gzip niveau 6) : clips −44 %, avatar −26 %, décor −58 % (classe :
// 19 → 8 Mo). Zéro dépendance : zlib de Node.
//
// Chaque fichier est compressé UNE fois, puis servi depuis un cache disque
// (dossier temporaire du système — JAMAIS data/, qui part dans les sauvegardes),
// indexé par chemin + taille + date : un fichier remplacé se recompresse seul.
// ETag et 304 comme express.static. Une requête Range (lecture partielle), un
// client sans gzip ou un fichier absent passent la main à express.static, qui
// les sert exactement comme avant.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import type { NextFunction, Request, Response } from 'express'

const CACHE_DIR = path.join(os.tmpdir(), 'hanami-gzip-cache')
const TYPES: Record<string, string> = {
  '.vrm': 'application/octet-stream',
  '.vrma': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
}
/** Compressions en cours : deux requêtes simultanées n'en lancent qu'une. */
const pending = new Map<string, Promise<string>>()

function compressOnce(src: string, stat: fs.Stats): Promise<string> {
  const key = crypto.createHash('sha1').update(`${src}|${stat.size}|${stat.mtimeMs}`).digest('hex')
  const out = path.join(CACHE_DIR, `${key}.gz`)
  if (fs.existsSync(out)) return Promise.resolve(out)
  const running = pending.get(out)
  if (running) return running
  const job = new Promise<string>((resolve, reject) => {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    // Écriture dans un .tmp puis rename : un cache à moitié écrit (coupure) ne
    // serait jamais servi comme complet.
    const tmp = `${out}.${process.pid}.tmp`
    fs.createReadStream(src)
      .pipe(zlib.createGzip({ level: 6 }))
      .pipe(fs.createWriteStream(tmp))
      .on('finish', () => {
        try {
          fs.renameSync(tmp, out)
          resolve(out)
        } catch (e) {
          reject(e)
        }
      })
      .on('error', reject)
  }).finally(() => pending.delete(out))
  pending.set(out, job)
  return job
}

/** Middleware à monter AVANT express.static(dir) sur le même préfixe. */
export function gzipStatic(dir: string) {
  const root = path.resolve(dir)
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.headers.range || !/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) return next()
    let rel: string
    try {
      rel = decodeURIComponent(req.path)
    } catch {
      return next()
    }
    const type = TYPES[path.extname(rel).toLowerCase()]
    if (!type) return next()
    const file = path.resolve(root, '.' + path.posix.normalize('/' + rel.replace(/\\/g, '/')))
    // Jamais hors du dossier servi (même garde que la restauration).
    const inside = path.relative(root, file)
    if (inside.startsWith('..') || path.isAbsolute(inside)) return next()
    let stat: fs.Stats
    try {
      stat = fs.statSync(file)
    } catch {
      return next()
    }
    if (!stat.isFile()) return next()
    const etag = `W/"gz-${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
    res.setHeader('Vary', 'Accept-Encoding')
    res.setHeader('ETag', etag)
    res.setHeader('Cache-Control', 'public, max-age=0')
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end()
      return
    }
    compressOnce(file, stat)
      .then((gz) => {
        res.setHeader('Content-Type', type)
        res.setHeader('Content-Encoding', 'gzip')
        res.setHeader('Content-Length', String(fs.statSync(gz).size))
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        fs.createReadStream(gz).pipe(res)
      })
      .catch(() => next()) // compression impossible : le fichier brut, comme avant
  }
}
