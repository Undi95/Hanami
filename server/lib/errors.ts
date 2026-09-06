// Envoi des erreurs HTTP — le contrat codes/phrases (shared/errorCodes.ts) :
// le serveur envoie un CODE (+ paramètres), jamais une phrase ; les phrases
// existent dans les deux langues côté client (i18n.ts).
import type { Response } from 'express'
import { CodedError, type ErrorCode, type ErrorParams } from '../../shared/errorCodes'

/** Réponse d'erreur CODÉE : le client choisit la phrase dans SA langue. */
export function httpError(res: Response, status: number, code: ErrorCode, params?: ErrorParams): void {
  res.status(status).json(params ? { error: code, params } : { error: code })
}

/**
 * Envoie une erreur au client.
 * - CodedError → le code (+ params) part tel quel, la phrase est traduite côté client.
 * - Sinon → le message brut, comme avant (erreur interne imprévue, message
 *   technique d'une dépendance) : l'affichage reste lisible, jamais vide.
 */
export function sendJsonError(res: Response, status: number, e: unknown): void {
  if (e instanceof CodedError) {
    httpError(res, status, e.code, e.params)
    return
  }
  res.status(status).json({ error: e instanceof Error ? e.message : String(e) })
}
