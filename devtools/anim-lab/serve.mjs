// Banc d'essai d'animations VRM — serveur statique + proxy, ZÉRO dépendance npm.
//
// Quatre rôles, et rien d'autre :
//   1. servir les fichiers du banc (index.html, LISEZMOI.md…) ;
//   2. relayer /vrma, /vrm, /environments et /api vers le serveur du projet
//      (http://127.0.0.1:7788) — le banc consomme les VRAIS fichiers, aucune copie ;
//   3. servir three et @pixiv/three-vrm* depuis les node_modules du projet sous
//      /node_modules/, pour que la page les importe en modules ES natifs ;
//   4. servir sous /diagnostic/ ce que devtools/diagnostic/diagnostic.mjs a écrit
//      dans devtools/diagnostic-out/ (fiches et planches PNG, non versionnées).
//
// Rien n'est jamais ÉCRIT : ni dans le projet, ni ailleurs. Lecture seule.
import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url))
// Racine du projet Hanami : d'où viennent les node_modules. Le banc vit dans
// devtools/anim-lab/, donc la racine est deux crans au-dessus — aucun chemin en
// dur, le dépôt peut être cloné n'importe où. HANAMI_ROOT surcharge.
const PROJECT_ROOT = process.env.HANAMI_ROOT || path.resolve(LAB_DIR, '..', '..')
const NODE_MODULES = path.join(PROJECT_ROOT, 'node_modules')
// Sorties du diagnostic : régénérables, donc hors du suivi git (cf. .gitignore).
const DIAGNOSTIC_DIR = path.resolve(LAB_DIR, '..', 'diagnostic-out')

// Serveur de l'app (tsx watch) : c'est lui qui détient les assets et l'API.
const UPSTREAM_HOST = process.env.HANAMI_HOST || '127.0.0.1'
const UPSTREAM_PORT = Number(process.env.HANAMI_PORT || 7788)

// Port du banc : 7799, puis les suivants si occupé.
const FIRST_PORT = Number(process.env.LAB_PORT || 7799)
const PORT_TRIES = 12

// Préfixes relayés tels quels vers l'app (relais de flux, aucune réécriture).
const PROXY_PREFIXES = ['/api/', '/vrma/', '/vrm/', '/environments/']

// Paquets autorisés sous /node_modules/ : le banc n'a besoin de rien d'autre.
const ALLOWED_PACKAGES = ['three', '@pixiv']

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.glsl': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
}
const LAB_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.md', '.svg', '.png', '.ico'])
const MODULE_EXTENSIONS = new Set(['.js', '.mjs', '.json', '.glsl', '.wasm'])

/** En-têtes qui ne doivent PAS être recopiés d'un bond à l'autre. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function sendText(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

/**
 * Chemin d'URL → chemin disque sûr sous `root`.
 * Refuse toute traversée : décodage %xx, séparateurs Windows, `..`, octet nul,
 * puis vérification que la cible résolue reste bien SOUS la racine.
 * Retourne null si le chemin est suspect ou l'extension inattendue.
 */
function safeResolve(root, urlPath, allowedExtensions) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null // séquence % malformée
  }
  if (decoded.includes('\0')) return null
  const normalized = decoded.replace(/\\/g, '/')
  if (normalized.split('/').some((seg) => seg === '..')) return null
  const target = path.resolve(root, '.' + (normalized.startsWith('/') ? normalized : '/' + normalized))
  const rel = path.relative(root, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  if (!allowedExtensions.has(path.extname(target).toLowerCase())) return null
  return target
}

/** Envoie un fichier en flux, avec son type MIME. 404 si absent. */
async function sendFile(res, file) {
  let stat
  try {
    stat = await fsp.stat(file)
  } catch {
    sendText(res, 404, `404 — introuvable : ${path.basename(file)}`)
    return
  }
  if (!stat.isFile()) {
    sendText(res, 404, '404 — pas un fichier')
    return
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': String(stat.size),
    // Banc de diagnostic : jamais de cache, on veut voir l'état du disque.
    'cache-control': 'no-store',
  })
  const stream = fs.createReadStream(file)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

/** Relais pur vers le serveur du projet : mêmes méthode, chemin, en-têtes, corps. */
function proxyToApp(req, res) {
  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase()) && k.toLowerCase() !== 'host') headers[k] = v
  }
  headers.host = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`
  const upstream = http.request(
    { host: UPSTREAM_HOST, port: UPSTREAM_PORT, method: req.method, path: req.url, headers },
    (up) => {
      const out = {}
      for (const [k, v] of Object.entries(up.headers)) {
        if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = v
      }
      res.writeHead(up.statusCode || 502, out)
      up.pipe(res)
    },
  )
  upstream.on('error', (e) => {
    // Le cas courant : le serveur du projet n'est pas démarré. Message explicite,
    // la page l'affiche tel quel dans son journal.
    if (!res.headersSent) {
      sendText(
        res,
        502,
        JSON.stringify({
          error:
            `Le serveur du projet ne répond pas sur http://${UPSTREAM_HOST}:${UPSTREAM_PORT} ` +
            `(${e.message}). Démarre-le : npm run dev dans ${PROJECT_ROOT}.`,
        }),
        'application/json; charset=utf-8',
      )
    } else {
      res.destroy()
    }
  })
  req.pipe(upstream)
}

/** Modules ES du projet, restreints à three et @pixiv/*. */
async function serveModule(res, urlPath) {
  const rest = urlPath.slice('/node_modules/'.length)
  const firstSegment = rest.split('/')[0]
  if (!ALLOWED_PACKAGES.includes(firstSegment)) {
    sendText(res, 403, `403 — paquet non autorisé : ${firstSegment}`)
    return
  }
  const file = safeResolve(NODE_MODULES, '/' + rest, MODULE_EXTENSIONS)
  if (!file) {
    sendText(res, 400, '400 — chemin de module refusé')
    return
  }
  await sendFile(res, file)
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0]

  if (PROXY_PREFIXES.some((p) => urlPath.startsWith(p))) {
    proxyToApp(req, res)
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, '405 — seul GET est servi par le banc')
    return
  }

  if (urlPath.startsWith('/node_modules/')) {
    serveModule(res, urlPath).catch(() => sendText(res, 500, '500 — lecture du module impossible'))
    return
  }

  // /diagnostic/… → devtools/diagnostic-out/ : les fiches et planches écrites par
  // diagnostic.mjs. Absentes tant qu'on ne l'a pas lancé — l'onglet le dit.
  if (urlPath.startsWith('/diagnostic/')) {
    const f = safeResolve(DIAGNOSTIC_DIR, urlPath.slice('/diagnostic'.length), LAB_EXTENSIONS)
    if (!f) {
      sendText(res, 400, '400 — chemin refusé')
      return
    }
    sendFile(res, f).catch(() => sendText(res, 500, '500 — lecture impossible'))
    return
  }

  const wanted = urlPath === '/' ? '/index.html' : urlPath
  const file = safeResolve(LAB_DIR, wanted, LAB_EXTENSIONS)
  if (!file) {
    sendText(res, 400, '400 — chemin refusé')
    return
  }
  sendFile(res, file).catch(() => sendText(res, 500, '500 — lecture impossible'))
})

/** Écoute sur le premier port libre à partir de FIRST_PORT. */
function listen(port, attemptsLeft) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`  port ${port} occupé, essai suivant…`)
      listen(port + 1, attemptsLeft - 1)
      return
    }
    console.error('[banc] échec de démarrage :', e.message)
    process.exit(1)
  })
  server.listen(port, '127.0.0.1', () => {
    console.log('Banc d’essai d’animations VRM')
    console.log(`  page    : http://localhost:${port}/`)
    console.log(`  proxy   : ${PROXY_PREFIXES.join(' ')} → http://${UPSTREAM_HOST}:${UPSTREAM_PORT}`)
    console.log(`  modules : /node_modules/ → ${NODE_MODULES}`)
    console.log(`  diagnostic : /diagnostic/ → ${DIAGNOSTIC_DIR}`)
    if (!fs.existsSync(NODE_MODULES)) {
      console.warn(`  ATTENTION : ${NODE_MODULES} est introuvable (HANAMI_ROOT=… pour le corriger)`)
    }
  })
}

listen(FIRST_PORT, PORT_TRIES)
