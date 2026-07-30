// Authentification par mot de passe unique (réglage `password` ; vide = accès libre, usage local).
// Le token de session est OPAQUE (aléatoire, en mémoire) — jamais le mot de passe lui-même.
import crypto from 'node:crypto'
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { configUnreadable, loadSettings } from '../config'

/** Comparaison en temps constant : SHA-256 des deux côtés (tailles égales garanties). */
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest()
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest()
  return crypto.timingSafeEqual(ha, hb)
}

// Tokens de session émis par /api/login. En mémoire uniquement : un redémarrage
// du serveur déconnecte tout le monde (les clients repassent par le LoginGate).
const validTokens = new Set<string>()
const MAX_TOKENS = 200

/** Révoque toutes les sessions — appelé quand le mot de passe change (PUT /api/settings). */
export function revokeAllTokens(): void {
  validTokens.clear()
}

function isValidToken(token: string): boolean {
  for (const known of validTokens) {
    if (safeEqual(token, known)) return true
  }
  return false
}

/** Garde /api/* : si un mot de passe est défini, exige "Authorization: Bearer <token de session>". */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const { password } = loadSettings()
  // config.json PRÉSENT mais illisible : le mot de passe lu est celui des
  // défauts (vide) — ouvrir serait un fail-open. On FERME tant que le fichier
  // n'est pas réparé : perdre un fichier ne doit jamais désarmer la porte.
  if (configUnreadable()) {
    res.status(503).json({ error: 'config.json illisible — accès suspendu (réparez le fichier)' })
    return
  }
  if (!password) {
    next()
    return
  }
  const header = req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  if (token && isValidToken(token)) {
    next()
    return
  }
  res.status(401).json({ error: 'Authentification requise' })
}

export const loginRouter = Router()

// POST /api/login {password} → {token} (opaque, aléatoire) ou 401.
loginRouter.post('/api/login', (req, res) => {
  // Même garde que l'authMiddleware : un config illisible rend le mot de passe
  // « vide » aux yeux du code — accorder un jeton là-dessus serait un fail-open.
  if (configUnreadable()) {
    res.status(503).json({ error: 'config.json illisible — accès suspendu (réparez le fichier)' })
    return
  }
  const { password } = loadSettings()
  const body = (req.body ?? {}) as { password?: unknown }
  const provided = typeof body.password === 'string' ? body.password : ''
  if (!password || safeEqual(provided, password)) {
    const token = crypto.randomBytes(32).toString('hex')
    // Borne de sécurité : on évince la session la plus ancienne au-delà du plafond.
    if (validTokens.size >= MAX_TOKENS) {
      const oldest = validTokens.values().next().value
      if (oldest !== undefined) validTokens.delete(oldest)
    }
    validTokens.add(token)
    res.json({ token })
    return
  }
  res.status(401).json({ error: 'Mot de passe incorrect' })
})
