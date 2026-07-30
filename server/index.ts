// Boot du serveur Hanami : Express + API + statiques + Vite middleware (dev) / dist (prod).
import express from 'express'
import os from 'node:os'
import path from 'node:path'
import { IS_PROD, PORT } from './config'
import { BACKGROUNDS_DIR, DATA_DIR, PORTRAITS_DIR, ROOT, VRM_DIR, ensureDataDirs } from './lib/storage'
import { authMiddleware, loginRouter } from './lib/auth'
import { settingsRouter } from './api/settings'
import { chatRouter } from './api/chat'
import { charactersRouter } from './api/characters'
import { memoryRouter } from './api/memory'
import { importRouter } from './api/importer'
import { assetsRouter } from './api/assets'
import { ttsRouter } from './api/tts'
import { statsRouter } from './api/stats'
import { backupRouter } from './api/backup'
import { startSpontaneous } from './lib/spontaneous'
import { uiRouter } from './api/ui'

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

  // Garde CSRF : refus des requêtes mutantes cross-site. Les requêtes
  // same-origin du client et les outils sans header Origin (curl) passent.
  app.use((req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
      if (req.headers['sec-fetch-site'] === 'cross-site') {
        res.status(403).json({ error: 'Requête cross-site refusée' })
        return
      }
      const origin = req.headers.origin
      if (origin) {
        let originHost = ''
        try {
          originHost = new URL(origin).host
        } catch {
          /* Origin malformé (ex. "null") → refus */
        }
        if (!originHost || originHost !== req.headers.host) {
          res.status(403).json({ error: 'Origin non autorisé' })
          return
        }
      }
    }
    next()
  })

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
  app.use(ttsRouter)
  app.use(statsRouter)
  app.use(uiRouter)
  app.use(backupRouter)

  // Statiques (non gardés).
  app.use('/vrm', express.static(VRM_DIR))
  app.use('/backgrounds', express.static(BACKGROUNDS_DIR))
  // Portraits 2D des personnages sans modèle VRM (images des cards importées).
  app.use('/portraits', express.static(PORTRAITS_DIR))

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
    // Défense en profondeur : /@fs/ (Vite) sert des fichiers arbitraires du
    // disque — on interdit tout chemin qui tombe sous data/ (config, chats,
    // mémoire), en plus du server.fs.deny de vite.config.ts. On décode la
    // pathname (%5C, %2E…) et on normalise les séparateurs Windows.
    app.use((req, res, next) => {
      const [rawPath] = req.url.split('?')
      let pathname = rawPath
      try {
        pathname = decodeURIComponent(rawPath)
      } catch {
        /* séquence % malformée → version brute */
      }
      pathname = pathname.replace(/\\/g, '/')
      if (pathname.startsWith('/@fs/')) {
        const target = path.resolve(pathname.slice('/@fs/'.length))
        const rel = path.relative(DATA_DIR, target)
        if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
          res.status(403).json({ error: 'Accès interdit' })
          return
        }
      }
      next()
    })
    app.use(vite.middlewares)
  }

  // Dev : écoute locale par défaut (l'outillage Vite comme /@fs/ ne doit pas
  // être exposé au LAN) ; HOST=0.0.0.0 pour l'ouvrir explicitement. Prod : LAN.
  const host = process.env.HOST || (IS_PROD ? '0.0.0.0' : '127.0.0.1')
  app.listen(PORT, host, () => {
    console.log(`Hanami démarré (${IS_PROD ? 'prod' : 'dev'})`)
    console.log(`  local  : http://127.0.0.1:${PORT}`)
    const lan = firstLanIPv4()
    if (host === '0.0.0.0' && lan) {
      console.log(`  réseau : http://${lan}:${PORT} (accès mobile)`)
    } else if (!IS_PROD) {
      console.log(`  réseau : non exposé — HOST=0.0.0.0 npm run dev pour le LAN, ou npm start`)
    }
  })

  // Messages spontanés : le personnage peut écrire de lui-même (opt-in, Réglages).
  startSpontaneous()
}

main().catch((e) => {
  console.error('[hanami] échec du démarrage :', e)
  process.exit(1)
})
