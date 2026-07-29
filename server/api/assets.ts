// Router assets : listing des modèles VRM et des fonds d'écran.
// Seul accès fs hors storage : simple listing lecture-seule des dossiers
// VRM_DIR / BACKGROUNDS_DIR (storage n'expose pas de fonction de listing).
import fs from 'node:fs'
import { Router, type Response } from 'express'
import { BACKGROUNDS_DIR, VRM_DIR } from '../lib/storage'

export const assetsRouter = Router()

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

assetsRouter.get('/api/backgrounds', (_req, res) => {
  try {
    res.json({
      backgrounds: listFiles(BACKGROUNDS_DIR, ['.png', '.jpg', '.jpeg', '.webp']).map(
        (f) => `/backgrounds/${encodeURIComponent(f)}`,
      ),
    })
  } catch (e) {
    sendError(res, e)
  }
})
