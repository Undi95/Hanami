// Boot du serveur Hanami : Express + API + statiques + Vite middleware (dev) / dist (prod).
import express from 'express'
import os from 'node:os'
import path from 'node:path'
import { IS_PROD, PORT } from './config'
import { BACKGROUNDS_DIR, ROOT, VRM_DIR, ensureDataDirs } from './lib/storage'
import { authMiddleware, loginRouter } from './lib/auth'
import { settingsRouter } from './api/settings'
import { chatRouter } from './api/chat'
import { charactersRouter } from './api/characters'
import { memoryRouter } from './api/memory'
import { importRouter } from './api/importer'
import { assetsRouter } from './api/assets'

function firstLanIPv4(): string {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return ''
}

async function main(): Promise<void> {
  ensureDataDirs()
  const app = express()
  app.use(express.json({ limit: '5mb' }))

  // Auth : tout /api/* est gardé SAUF /api/login (enregistré avant le middleware).
  app.use(loginRouter)
  app.use('/api', authMiddleware)

  // API — routeurs à chemins complets /api/... .
  app.use(settingsRouter)
  app.use(chatRouter)
  app.use(charactersRouter)
  app.use(memoryRouter)
  app.use(importRouter)
  app.use(assetsRouter)

  // Statiques (non gardés).
  app.use('/vrm', express.static(VRM_DIR))
  app.use('/backgrounds', express.static(BACKGROUNDS_DIR))

  if (IS_PROD) {
    const dist = path.join(ROOT, 'dist')
    app.use(express.static(dist))
    // Fallback SPA : tout sauf /api renvoie index.html.
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next()
        return
      }
      res.sendFile(path.join(dist, 'index.html'))
    })
  } else {
    // Vite en middleware — EN DERNIER (après API et statiques).
    const { createServer } = await import('vite')
    const vite = await createServer({
      // configFile explicite : avec seulement root=client/, Vite chercherait
      // vite.config.ts DANS client/ et ne le trouverait pas → pas de plugin
      // React ni d'optimizeDeps → double copie de React (« Invalid hook call »).
      configFile: path.join(ROOT, 'vite.config.ts'),
      root: path.join(ROOT, 'client'),
      server: { middlewareMode: true },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hanami démarré (${IS_PROD ? 'prod' : 'dev'})`)
    console.log(`  local  : http://127.0.0.1:${PORT}`)
    const lan = firstLanIPv4()
    if (lan) console.log(`  réseau : http://${lan}:${PORT} (accès mobile)`)
  })
}

main().catch((e) => {
  console.error('[hanami] échec du démarrage :', e)
  process.exit(1)
})
