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
  res.status(status).json({ error: scrubPaths(e instanceof Error ? e.message : String(e)) })
}

/**
 * Retire les chemins ABSOLUS d'un message d'erreur brut. Une erreur système
 * (« ENOENT … mkdir 'C:\Users\…' ») part telle quelle au client — et le
 * serveur peut être joignable depuis Internet (tunnel) : le chemin du dossier
 * de données, nom d'utilisateur Windows compris, n'a rien à y faire. Le nom du
 * fichier final reste, c'est lui qui aide à comprendre ; la console du serveur,
 * elle, garde le message complet.
 */
export function scrubPaths(message: string): string {
  // Le début du chemin ne doit pas coller à une lettre, un « : » ni un « / » :
  // « http://… » (le « p: » d'un schéma) et le milieu d'une URL sont épargnés —
  // une URL de backend dans un message aide l'utilisateur, elle ne trahit rien.
  return message.replace(/(?<![\w:/.])(?:[A-Za-z]:[\\/]|\\\\|\/(?=[^\s'"]*\/))[^\s'"]*/g, (p) => {
    const tail = p.split(/[\\/]/).filter(Boolean).pop() ?? ''
    return `…${tail ? '/' + tail : ''}`
  })
}
