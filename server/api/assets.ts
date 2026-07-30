// Router assets : listing des modèles VRM, des fonds d'écran, des décors 3D et
// des animations, dépôt d'un fond.
// Seul accès fs hors storage : listing des dossiers VRM_DIR / BACKGROUNDS_DIR /
// ENVIRONMENTS_DIR / VRMA_DIR (storage n'expose pas de fonction de listing) et
// écriture dans BACKGROUNDS_DIR — ces dossiers-là ne contiennent que des assets,
// jamais d'état de l'app.
import fs from 'node:fs'
import path from 'node:path'
import express, { Router, type Response } from 'express'
import { BACKGROUNDS_DIR, VRMA_DIR, VRM_DIR } from '../lib/storage'
import { environmentEntries, refreshEnvironmentIndex } from '../lib/envIndex'

export const assetsRouter = Router()

const BG_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']

function sendError(res: Response, e: unknown): void {
  res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
}

/** Fichiers d'un dossier filtrés par extensions, triés alpha. Dossier absent → []. */
function listFiles(dir: string, extensions: string[]): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => extensions.some((ext) => f.toLowerCase().endsWith(ext)))
    .sort((a, b) => a.localeCompare(b))
}

assetsRouter.get('/api/vrm-models', (_req, res) => {
  try {
    // encodeURIComponent : un nom contenant # ou % casserait l'URL côté client.
    res.json({ models: listFiles(VRM_DIR, ['.vrm']).map((f) => `/vrm/${encodeURIComponent(f)}`) })
  } catch (e) {
    sendError(res, e)
  }
})

// Décors 3D : même contrat que /api/vrm-models — le dossier absent renvoie une
// liste vide, jamais une erreur (l'app marche sans décor).
//
// `scenes` double `environments` avec l'état de l'ANALYSE de chaque décor
// (server/lib/envScene.ts) : ce qui permet à l'interface de dire « en
// préparation » puis « prêt », et au moteur de scène de savoir s'il peut faire
// marcher le personnage. Les deux tableaux sont dans le même ordre et décrivent
// les mêmes fichiers ; `environments` reste un simple tableau d'URL pour ne rien
// casser de ce qui existe.
//
// C'est aussi ici que le dossier est re-balayé : déposer un .glb pendant que le
// serveur tourne suffit à lancer son analyse, sans redémarrage et sans
// surveillance de fichiers (le balayage est bridé côté envIndex).
assetsRouter.get('/api/environments', (_req, res) => {
  try {
    refreshEnvironmentIndex()
    const scenes = environmentEntries()
    res.json({ environments: scenes.map((s) => s.url), scenes })
  } catch (e) {
    sendError(res, e)
  }
})

assetsRouter.get('/api/vrm-animations', (_req, res) => {
  try {
    res.json({ animations: listFiles(VRMA_DIR, ['.vrma']).map((f) => `/vrma/${encodeURIComponent(f)}`) })
  } catch (e) {
    sendError(res, e)
  }
})

assetsRouter.get('/api/backgrounds', (_req, res) => {
  try {
    res.json({
      backgrounds: listFiles(BACKGROUNDS_DIR, BG_EXTENSIONS).map(
        (f) => `/backgrounds/${encodeURIComponent(f)}`,
      ),
    })
  } catch (e) {
    sendError(res, e)
  }
})

// ── Dépôt d'un fond d'écran ────────────────────────────────────────────────
// Corps BRUT (pas de multipart, donc pas de dépendance) comme l'import de cards
// PNG : Content-Type image/* + nom d'origine dans X-Filename encodé URI, car un
// en-tête HTTP ne transporte pas d'accent en clair.

/** Extension déduite du Content-Type, quand le nom n'en porte pas d'utilisable. */
const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
}

const EXT_BY_FAMILY = { png: '.png', jpeg: '.jpg', webp: '.webp' } as const
type Family = keyof typeof EXT_BY_FAMILY

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Famille reconnue aux octets d'en-tête : le nom du fichier ne prouve rien.
 * Exportée : la photo de personnage (server/api/characters.ts) valide ses
 * octets avec EXACTEMENT le même sniff — un seul endroit à faire évoluer.
 */
export function sniffFamily(buf: Buffer): Family | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC)) return 'png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}

/** Noms de périphériques Windows : « CON.png » écrirait sur la console, pas sur le disque. */
const WINDOWS_DEVICES = /^(con|prn|aux|nul|com\d|lpt\d)$/i

/**
 * Radical de nom sûr tiré du nom d'origine : dernier segment du chemin
 * uniquement (aucune traversée possible), caractères réduits à un jeu
 * inoffensif, longueur bornée. Jamais vide.
 */
function safeStem(rawName: string): string {
  const base = rawName.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .normalize('NFC')
    // Lettres, chiffres, espace, point, tiret, souligné : tout le reste (dont
    // les caractères de contrôle et les séparateurs) devient un tiret.
    .replace(/[^\p{L}\p{N} ._-]+/gu, '-')
    .slice(0, 64)
    // Après la coupe seulement : ni point ni espace en tête ou en queue,
    // Windows les refuse (« nom. » devient « nom »).
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
  if (!stem || WINDOWS_DEVICES.test(stem)) return 'fond'
  return stem
}

/** Extension annoncée par le nom, si elle fait partie des formats acceptés. */
function declaredExtension(rawName: string): string {
  const base = rawName.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : ''
  return BG_EXTENSIONS.includes(ext) ? ext : ''
}

/** Chemin libre dans BACKGROUNDS_DIR : collision → suffixe -2, -3… */
function freeTarget(stem: string, ext: string): { file: string; name: string } {
  for (let i = 1; i <= 999; i++) {
    const name = i === 1 ? `${stem}${ext}` : `${stem}-${i}${ext}`
    const file = path.join(BACKGROUNDS_DIR, name)
    // Ceinture et bretelles : le nom est déjà nettoyé, on vérifie quand même
    // que la cible ne sort pas du dossier des fonds.
    if (path.dirname(path.resolve(file)) !== path.resolve(BACKGROUNDS_DIR)) {
      throw new Error('Nom de fichier invalide')
    }
    if (!fs.existsSync(file)) return { file, name }
  }
  throw new Error('Trop de fonds portent ce nom')
}

assetsRouter.post(
  '/api/backgrounds',
  // Route derrière l'authMiddleware global de /api (server/index.ts) et la garde
  // CSRF. Type image/* explicite : un type quelconque ouvrirait la route aux
  // requêtes cross-site « simples » (image/* impose lui un préflight).
  express.raw({ type: 'image/*', limit: '15mb' }),
  (req, res) => {
    try {
      const buf = req.body as unknown
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        res.status(400).json({ error: 'Corps de requête image requis' })
        return
      }
      const header = req.headers['x-filename']
      let rawName = typeof header === 'string' ? header : ''
      try {
        rawName = decodeURIComponent(rawName)
      } catch {
        /* séquence % malformée → nom brut, il sera nettoyé de toute façon */
      }
      const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      if (!declaredExtension(rawName) && !EXT_BY_MIME[contentType]) {
        res.status(400).json({ error: 'Format non pris en charge (png, jpg, webp)' })
        return
      }
      // Les octets font foi sur l'extension finale : un .jpg qui est en réalité
      // un PNG est enregistré en .png plutôt que refusé.
      const family = sniffFamily(buf)
      if (!family) {
        res.status(400).json({ error: 'Ce fichier n’est pas une image PNG, JPEG ou WebP' })
        return
      }
      fs.mkdirSync(BACKGROUNDS_DIR, { recursive: true })
      const { file, name } = freeTarget(safeStem(rawName), EXT_BY_FAMILY[family])
      fs.writeFileSync(file, buf)
      res.json({ url: `/backgrounds/${encodeURIComponent(name)}` })
    } catch (e) {
      sendError(res, e)
    }
  },
)
