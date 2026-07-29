// Authentification par mot de passe unique (réglage `password` ; vide = accès libre, usage local).
import crypto from 'node:crypto'
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { loadSettings } from '../config'

/** Comparaison en temps constant : SHA-256 des deux côtés (tailles égales garanties). */
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest()
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest()
  return crypto.timingSafeEqual(ha, hb)
}

/** Garde /api/* : si un mot de passe est défini, exige "Authorization: Bearer <password>". */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const { password } = loadSettings()
  if (!password) {
    next()
    return
  }
  const header = req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  if (token && safeEqual(token, password)) {
    next()
    return
  }
  res.status(401).json({ error: 'Authentification requise' })
}

export const loginRouter = Router()

// POST /api/login {password} → {token} (le token EST le mot de passe) ou 401.
loginRouter.post('/api/login', (req, res) => {
  const { password } = loadSettings()
  const body = (req.body ?? {}) as { password?: unknown }
  const provided = typeof body.password === 'string' ? body.password : ''
  if (!password || safeEqual(provided, password)) {
    res.json({ token: password })
    return
  }
  res.status(401).json({ error: 'Mot de passe incorrect' })
})
