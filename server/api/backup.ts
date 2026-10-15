// Router sauvegarde : télécharger une archive, et la restaurer.
//
// Trois routes, gardées par l'authMiddleware global de /api (server/index.ts) —
// sans lui, une simple URL suffirait à aspirer config.json et son mot de passe,
// ou à écraser les données d'une instance exposée :
//   GET  /api/backup                  → le .zip de data/ + portraits/
//   POST /api/backup/restore/preview  → APERÇU seul, aucune écriture
//   POST /api/backup/restore          → écrit, après avoir posé le filet
//
// Le format zip est écrit et lu à la main (lib/zip.ts), la convention Hanami vit
// dans lib/backupArchive.ts et toute la prudence dans lib/backupRestore.ts.
import express, { Router } from 'express'
import { loadSettings } from '../config'
import { buildBackup, defaultRoots } from '../lib/backupArchive'
import {
  MAX_ARCHIVE_BYTES,
  applyRestore,
  dropStaged,
  planRestore,
  purgeStaging,
  readStaged,
  stageArchive,
} from '../lib/backupRestore'
import { revokeAllTokens } from '../lib/auth'
import { httpError, sendJsonError } from '../lib/errors'
import { CodedError, ErrorCodes } from '../../shared/errorCodes'

export const backupRouter = Router()

// ── Téléchargement ─────────────────────────────────────────────────────────

backupRouter.get('/api/backup', (_req, res) => {
  try {
    const { zip, filename } = buildBackup(defaultRoots())
    res.set('Content-Type', 'application/zip')
    res.set('Content-Disposition', `attachment; filename="${filename}"`)
    res.set('Content-Length', String(zip.length))
    res.set('Cache-Control', 'no-store')
    res.end(zip)
  } catch (e) {
    sendJsonError(res, 500, e)
  }
})

// ── Restauration ───────────────────────────────────────────────────────────

// Type explicite (le client envoie application/zip) : accepter n'importe quel
// type ouvrirait la route aux requêtes cross-site « simples ». Le plafond borne
// le corps AVANT toute allocation ; les bornes de décompression, elles, vivent
// dans lib/zip.ts (une archive de 2 Mo peut cacher 40 Go).
const zipBody = express.raw({ type: 'application/zip', limit: MAX_ARCHIVE_BYTES })

function archiveBody(body: unknown): Buffer {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new CodedError(ErrorCodes.restoreZipExpected)
  }
  return body
}

/**
 * APERÇU — l'archive est lue, vérifiée et confrontée à l'existant, puis DÉPOSÉE
 * telle quelle sous un jeton. Rien n'est écrit dans data/ ni portraits/.
 * La confirmation ne renverra que le jeton : ce qui sera restauré est
 * exactement, octet pour octet, ce que cet aperçu a décrit.
 */
backupRouter.post('/api/backup/restore/preview', zipBody, (req, res) => {
  try {
    const roots = defaultRoots()
    const zip = archiveBody(req.body)
    const plan = planRestore(zip, roots)
    const stagedId = stageArchive(zip, roots)
    res.set('Cache-Control', 'no-store')
    res.json({ stagedId, ...plan.preview })
  } catch (e) {
    // Une erreur CODÉE ici est une faute du FICHIER (archive refusée, entrée
    // piégée, manifeste invalide) : 400 comme avant ; sinon erreur interne.
    sendJsonError(res, e instanceof CodedError ? 400 : 500, e)
  }
})

/**
 * CONFIRMATION — le plan est REFAIT sur l'archive déposée (on ne fait jamais
 * confiance à un calcul antérieur), le filet est posé, puis les fichiers
 * basculent. Le dépôt est effacé ensuite : il contient config.json, donc la clé
 * API et le mot de passe.
 */
backupRouter.post('/api/backup/restore', (req, res) => {
  try {
    const roots = defaultRoots()
    const body = (req.body ?? {}) as { stagedId?: unknown }
    if (typeof body.stagedId !== 'string' || !body.stagedId) {
      httpError(res, 400, ErrorCodes.backupPreviewToken)
      return
    }
    const zip = readStaged(roots, body.stagedId)
    // Mot de passe d'AVANT : si l'archive en apporte un autre, toutes les
    // sessions doivent tomber — sinon un jeton émis sous l'ancien mot de passe
    // continuerait d'ouvrir la porte de l'instance restaurée.
    const before = loadSettings().password
    const result = applyRestore(zip, roots)
    dropStaged(roots, body.stagedId)
    purgeStaging(roots, 0) // les autres dépôts n'ont plus d'objet
    const passwordChanged = loadSettings().password !== before
    if (passwordChanged) revokeAllTokens()
    res.set('Cache-Control', 'no-store')
    res.json({ ...result, passwordChanged })
  } catch (e) {
    // Même règle que l'aperçu : faute du fichier en 400, le reste en 500.
    sendJsonError(res, e instanceof CodedError ? 400 : 500, e)
  }
})
