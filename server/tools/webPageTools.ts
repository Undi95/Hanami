// Outil web_open exposé au modèle : ouvrir une page Web et en lire le TEXTE, par
// parties. C'est la suite de web_search, qui ne rend que des extraits : le modèle
// suit une adresse, lit, et peut demander les liens de la partie lue pour aller
// plus loin. Aucune dépendance : node:http(s), zlib, et un petit convertisseur
// HTML → texte écrit ici.
//
// SÉCURITÉ — c'est le modèle qui choisit l'adresse, et ce qu'il vient de lire sur
// le Web peut lui en souffler une. Hanami tourne souvent sur un réseau
// domestique : sans garde, « ouvre http://192.168.1.1/ » ferait du serveur un
// relais vers le réseau privé de l'utilisateur (box, NAS, autres services
// locaux). D'où, dans cet ordre :
//   - http et https seulement, jamais d'identifiants dans l'adresse ;
//   - l'adresse IP RÉELLEMENT jointe est vérifiée au moment de la connexion (le
//     `lookup` de la requête), pas seulement le nom : un nom public qui résout
//     vers 127.0.0.1 ou 10.x est refusé, et un DNS qui change de réponse entre
//     une vérification et la connexion n'y peut rien — il n'y a qu'une résolution ;
//   - une adresse écrite en chiffres est vérifiée de la même façon, sous toutes
//     ses écritures (l'analyseur d'URL les ramène à la forme pointée) ;
//   - le sous-réseau de chaque interface de la machine est refusé aussi, quelle
//     que soit sa plage : en IPv6 toute la maison porte des adresses « publiques »
//     du même préfixe, et un nom de domaine peut être pointé dessus ;
//   - le port du schéma seulement (80 pour http, 443 pour https) : un autre
//     port est presque toujours autre chose qu'un site ;
//   - chaque redirection repasse par les mêmes gardes ;
//   - lecture bornée en durée et en taille, types de contenu textuels seulement ;
//   - ce que la page fait CONSTRUIRE est borné aussi (longueur des adresses,
//     nombre de liens, mémoire des pages lues) : limiter les octets reçus ne
//     suffit pas, deux mégaoctets bien choisis peuvent en faire écrire soixante mille ;
//   - une connexion neuve par requête : aucune réutilisation d'un socket ouvert
//     ailleurs sans ces gardes.
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import zlib from 'node:zlib'
import type { Transform } from 'node:stream'

export const WEB_OPEN_TOOL_NAMES = ['web_open'] as const

export const webOpenToolDefs: unknown[] = [
  {
    type: 'function',
    function: {
      name: 'web_open',
      description:
        'Open a Web page and read its text. A long page comes in parts: the result says how many there are, ' +
        'ask for another one with "part". Set "links" to true to also get the links found in that part, to go further. ' +
        'Only open addresses you were given, found in a search result or in a page you opened — never invent one. ' +
        'Only report what this tool actually returns.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full address of the page (http or https)' },
          part: { type: 'number', description: 'Part of the page to read (default 1)' },
          links: { type: 'boolean', description: 'Also list the links found in that part (default false)' },
        },
        required: ['url'],
      },
    },
  },
]

// ── Bornes ─────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 5
/** Octets lus (après décompression) : au-delà, la page est coupée, et le résultat le dit. */
const MAX_BYTES = 2 * 1024 * 1024
/** Taille d'une partie servie au modèle. */
export const PART_CHARS = 6000
const LINKS_MAX = 40
const LINK_TEXT_MAX = 120
const TITLE_MAX = 200
/** Longueur maximale d'une adresse : celle qu'on ouvre, celle d'une redirection, d'un <base>, d'un lien. */
const URL_MAX = 2048
/** Liens gardés par page. Avec URL_MAX, c'est ce qui borne la mémoire qu'une page peut faire prendre. */
export const LINKS_PER_PAGE = 2000
const CACHE_TTL_MS = 10 * 60_000
const CACHE_MAX = 12
/** Caractères gardés en mémoire, toutes pages confondues (texte et liens). */
const CACHE_MAX_CHARS = 8_000_000

// Même en-tête que web_search : beaucoup de sites ne répondent rien à un client inconnu.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/**
 * La langue de la machine, SANS sa région : c'est celle de l'utilisateur, et un
 * site à plusieurs éditions sert alors la bonne (demandé en anglais d'abord, un
 * journal français rendait son édition anglaise).
 */
export function acceptLanguage(locale: string = Intl.DateTimeFormat().resolvedOptions().locale): string {
  const lang = String(locale).split('-')[0].toLowerCase()
  if (!/^[a-z]{2,3}$/.test(lang) || lang === 'en') return 'en'
  return `${lang},en;q=0.7`
}

// ── Garde des adresses ─────────────────────────────────────────────────────

function parseV4(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN))
  return bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255) ? bytes : null
}

/** IPv4 hors de l'Internet public : boucle locale, réseaux privés, lien-local, plages réservées. */
function forbiddenV4(bytes: number[]): boolean {
  const [a, b, c] = bytes
  if (a === 0 || a === 10 || a === 127) return true // « ce réseau », privé, boucle locale
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 — NAT d'opérateur
  if (a === 169 && b === 254) return true // lien-local (dont les services de métadonnées)
  if (a === 172 && b >= 16 && b <= 31) return true // privé
  if (a === 192 && b === 168) return true // privé
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true // attributions IETF, documentation
  if (a === 192 && b === 88 && c === 99) return true // ancien relais 6to4
  if (a === 198 && (b === 18 || b === 19)) return true // bancs d'essai
  if (a === 198 && b === 51 && c === 100) return true // documentation
  if (a === 203 && b === 0 && c === 113) return true // documentation
  return a >= 224 // multidiffusion et réservé (diffusion comprise)
}

/** Les huit groupes de 16 bits d'une adresse IPv6 (zone retirée, queue IPv4 pointée convertie). */
function parseV6(address: string): number[] | null {
  let s = address
  const zone = s.indexOf('%')
  if (zone !== -1) s = s.slice(0, zone)
  const lastColon = s.lastIndexOf(':')
  const tail = s.slice(lastColon + 1)
  if (tail.includes('.')) {
    const v4 = parseV4(tail)
    if (!v4) return null
    s = s.slice(0, lastColon + 1) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - rest.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const groups = [...head, ...new Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest].map((g) =>
    /^[0-9a-fA-F]{1,4}$/.test(g) ? parseInt(g, 16) : NaN,
  )
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null
}

/**
 * IPv6 : liste BLANCHE. Seul l'unicast global (2000::/3) passe, moins ses blocs
 * spéciaux ; une IPv4 enveloppée (::ffff:a.b.c.d, NAT64) est jugée comme l'IPv4
 * qu'elle porte. Tout le reste — boucle locale, lien-local, adresses locales
 * uniques, multidiffusion, plages réservées — est refusé.
 */
function forbiddenV6(g: number[]): boolean {
  const v4 = [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255]
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) return forbiddenV4(v4)
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) return forbiddenV4(v4)
  if ((g[0] & 0xe000) !== 0x2000) return true
  if (g[0] === 0x2001 && g[1] < 0x0200) return true // 2001::/23 — attributions spéciales (Teredo, bancs d'essai, ORCHID…)
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true // documentation
  if (g[0] === 0x2002) return true // 6to4
  if (g[0] === 0x3fff && g[1] < 0x1000) return true // 3fff::/20 — documentation
  return false
}

/** L'IPv4 qu'une adresse IPv6 enveloppe (::ffff:a.b.c.d, ou NAT64), ou null. */
function wrappedV4(g: number[]): number[] | null {
  const head = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0
  return head || nat64 ? [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255] : null
}

/** Les `bits` premiers bits de deux adresses, données en groupes de `unit` bits, sont-ils les mêmes ? */
function samePrefix(a: number[], b: number[], bits: number, unit: number): boolean {
  for (let i = 0; bits > 0; i++, bits -= unit) {
    const full = (1 << unit) - 1
    const mask = bits >= unit ? full : full ^ ((1 << (unit - bits)) - 1)
    if ((a[i] & mask) !== (b[i] & mask)) return false
  }
  return true
}

/**
 * L'adresse est-elle sur un réseau de CETTE machine ? Une adresse « publique »
 * peut être celle du serveur lui-même ou d'un voisin : avec IPv6, toutes les
 * machines de la maison portent une adresse du même préfixe global, et il
 * suffit de pointer un nom de domaine dessus. Le sous-réseau de chaque
 * interface est donc refusé, quelle que soit sa plage.
 */
export function isOwnNetworkAddress(
  address: string,
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): boolean {
  const family = net.isIP(address)
  const target = family === 4 ? parseV4(address) : family === 6 ? parseV6(address) : null
  if (!target) return false
  const unit = family === 4 ? 8 : 16
  for (const list of Object.values(interfaces)) {
    for (const itf of list ?? []) {
      if ((itf.family === 'IPv4' ? 4 : 6) !== family) continue
      const own = family === 4 ? parseV4(itf.address) : parseV6(itf.address)
      if (!own) continue
      const bits = Number(String(itf.cidr ?? '').split('/')[1])
      // Préfixe absent ou démesuré (/0…) : seule l'adresse même de l'interface est retenue.
      const prefix = Number.isInteger(bits) && bits >= unit && bits <= unit * target.length ? bits : unit * target.length
      if (samePrefix(target, own, prefix, unit)) return true
    }
  }
  return false
}

/** Une adresse IP que le modèle n'a pas à joindre. Ce qui n'est pas une adresse IP est refusé aussi. */
export function isForbiddenAddress(
  address: string,
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): boolean {
  const family = net.isIP(address)
  if (family === 4) {
    const bytes = parseV4(address)
    return !bytes || forbiddenV4(bytes) || isOwnNetworkAddress(address, interfaces)
  }
  if (family === 6) {
    const groups = parseV6(address)
    if (!groups || forbiddenV6(groups)) return true
    // Une IPv4 enveloppée se compare aussi, en IPv4, aux réseaux de la machine.
    const v4 = wrappedV4(groups)
    return isOwnNetworkAddress(address, interfaces) || (v4 !== null && isOwnNetworkAddress(v4.join('.'), interfaces))
  }
  return true
}

/** Refus de la garde — porté par l'erreur de connexion, reconnu au retour. */
class ForbiddenAddressError extends Error {
  constructor(readonly host: string) {
    super(`forbidden address for ${host}`)
    this.name = 'ForbiddenAddressError'
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void

/**
 * Le `lookup` des requêtes : résout le nom, puis refuse si UNE SEULE des adresses
 * obtenues est interdite — la connexion ne peut alors en choisir aucune.
 */
function guardedLookup(isForbidden: (address: string) => boolean) {
  return (hostname: string, options: dns.LookupOptions, callback: LookupCallback): void => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) {
        callback(err, options.all ? [] : '')
        return
      }
      const list = addresses as dns.LookupAddress[]
      if (list.length === 0 || list.some((a) => isForbidden(a.address))) {
        callback(new ForbiddenAddressError(hostname), options.all ? [] : '')
        return
      }
      if (options.all) callback(null, list)
      else callback(null, list[0].address, list[0].family)
    })
  }
}

/** Raison du refus d'une adresse AVANT toute connexion, ou null si elle peut être tentée. */
function refusedUrl(
  url: URL,
  isForbidden: (address: string) => boolean,
  allowPort: (port: number) => boolean,
): 'scheme' | 'long' | 'credentials' | 'private' | 'port' | null {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'scheme'
  if (url.href.length > URL_MAX) return 'long'
  if (url.username || url.password) return 'credentials'
  // Hôte écrit en chiffres : aucune résolution n'aura lieu, c'est donc ici qu'il se juge.
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host) !== 0 && isForbidden(host)) return 'private'
  // Le port du schéma seulement (80 pour http, 443 pour https) : l'analyseur
  // d'URL le rend alors vide, et tout port écrit est un autre port. Un autre
  // port est presque toujours autre chose qu'un site — par exemple un service
  // de la maison, qu'un nom de domaine pointé sur son adresse publique ferait
  // atteindre à travers le routeur.
  if (url.port !== '' && !allowPort(Number(url.port))) return 'port'
  return null
}

// ── Lecture ────────────────────────────────────────────────────────────────

/** Ce que les essais peuvent remplacer ; l'appel de production n'en passe aucun. */
export interface WebOpenDeps {
  isForbidden?: (address: string) => boolean
  allowPort?: (port: number) => boolean
  timeoutMs?: number
  maxBytes?: number
  now?: () => number
}

interface Fetched {
  url: string // adresse finale, redirections suivies
  contentType: string
  body: Buffer
  truncated: boolean
}

type FetchFailure =
  | { kind: 'scheme' | 'long' | 'credentials' | 'private' | 'port' | 'redirects' | 'timeout'; host: string }
  | { kind: 'http'; status: number; host: string }
  | { kind: 'type'; contentType: string; host: string }
  | { kind: 'network'; detail: string; host: string }

const READABLE_TYPE = /^(text\/|application\/(xhtml\+xml|xml|json|ld\+json|rss\+xml|atom\+xml)\b)/i

function decoderFor(encoding: string): Transform | null {
  const e = encoding.trim().toLowerCase()
  if (e === 'gzip' || e === 'x-gzip') return zlib.createGunzip()
  if (e === 'deflate') return zlib.createInflate()
  if (e === 'br') return zlib.createBrotliDecompress()
  return null
}

/** Une requête, sans suivre les redirections : la réponse lue, une redirection à suivre, ou un échec. */
function requestOnce(
  url: URL,
  isForbidden: (address: string) => boolean,
  signal: AbortSignal,
  maxBytes: number,
): Promise<{ fetched: Fetched } | { redirect: string } | { failure: FetchFailure }> {
  return new Promise((resolve) => {
    const host = url.hostname
    let settled = false
    const done = (value: { fetched: Fetched } | { redirect: string } | { failure: FetchFailure }): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const lib = url.protocol === 'https:' ? https : http
    const req = lib.request(
      url,
      {
        method: 'GET',
        agent: false,
        lookup: guardedLookup(isForbidden) as unknown as net.LookupFunction,
        signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
          'Accept-Language': acceptLanguage(),
          'Accept-Encoding': 'gzip, deflate, br',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0
        const location = res.headers.location
        if ([301, 302, 303, 307, 308].includes(status) && location) {
          res.destroy()
          done({ redirect: location })
          return
        }
        // 202 = « patientez » : certains sites le servent aux lecteurs automatiques
        // à la place de la page. Ce n'est pas une page à lire.
        if (status < 200 || status > 299 || status === 202) {
          res.destroy()
          done({ failure: { kind: 'http', status, host } })
          return
        }
        // Type absent : la page est lue, et c'est son contenu qui dira (cf. NUL plus bas).
        const contentType = String(res.headers['content-type'] ?? '').trim()
        if (contentType !== '' && !READABLE_TYPE.test(contentType)) {
          res.destroy()
          done({ failure: { kind: 'type', contentType: contentType.split(';')[0].trim() || 'unknown', host } })
          return
        }
        const decoder = decoderFor(String(res.headers['content-encoding'] ?? ''))
        const stream: NodeJS.ReadableStream = decoder ? res.pipe(decoder) : res
        const chunks: Buffer[] = []
        let size = 0
        // Lecture finie ou abandonnée : la connexion ET le décompresseur s'arrêtent.
        // Sans le second, un corps de quelques kilo-octets qui se décompresse en
        // gigaoctets continuerait d'occuper le processeur après la réponse de l'outil.
        const stop = (): void => {
          res.destroy()
          decoder?.destroy()
        }
        const finish = (truncated: boolean): void => {
          stop()
          const body = Buffer.concat(chunks)
          // Un octet nul au début : un fichier binaire sous une étiquette de texte (ou sans étiquette).
          if (body.subarray(0, 1024).includes(0)) {
            done({ failure: { kind: 'type', contentType: contentType.split(';')[0].trim() || 'binary data', host } })
            return
          }
          done({ fetched: { url: url.toString(), contentType, body, truncated } })
        }
        stream.on('data', (chunk: Buffer) => {
          if (settled) return
          const room = maxBytes - size
          if (chunk.length >= room) {
            // Plafond atteint : ce qui est lu suffit, le reste n'est pas téléchargé.
            chunks.push(chunk.subarray(0, room))
            size = maxBytes
            finish(true)
            return
          }
          chunks.push(chunk)
          size += chunk.length
        })
        stream.on('end', () => finish(false))
        // Flux coupé ou archive abîmée en cours de route : ce qui est déjà lu est servi.
        const broken = (e: Error): void => {
          if (settled) return
          if (size > 0) {
            finish(true)
            return
          }
          stop()
          done({ failure: { kind: 'network', detail: e.message, host } })
        }
        stream.on('error', broken)
        res.on('error', broken)
      },
    )
    req.on('error', (e: NodeJS.ErrnoException) => {
      if (e instanceof ForbiddenAddressError) done({ failure: { kind: 'private', host } })
      else if (e.name === 'AbortError' || e.name === 'TimeoutError' || signal.aborted) done({ failure: { kind: 'timeout', host } })
      else done({ failure: { kind: 'network', detail: e.code || e.message, host } })
    })
    req.end()
  })
}

/** La page, redirections suivies — chaque saut repasse par toutes les gardes. */
async function fetchPage(raw: string, deps: WebOpenDeps): Promise<{ fetched: Fetched } | { failure: FetchFailure }> {
  const isForbidden = deps.isForbidden ?? ((address: string): boolean => isForbiddenAddress(address))
  const allowPort = deps.allowPort ?? ((): boolean => false)
  const signal = AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { failure: { kind: 'scheme', host: raw } }
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const refused = refusedUrl(url, isForbidden, allowPort)
    if (refused) return { failure: { kind: refused, host: url.hostname || raw } }
    const out = await requestOnce(url, isForbidden, signal, deps.maxBytes ?? MAX_BYTES)
    if (!('redirect' in out)) return out
    try {
      url = new URL(out.redirect, url)
    } catch {
      return { failure: { kind: 'network', detail: 'invalid redirection', host: url.hostname } }
    }
  }
  return { failure: { kind: 'redirects', host: url.hostname } }
}

// ── Décodage ───────────────────────────────────────────────────────────────

/** Le jeu de caractères annoncé : en-tête HTTP d'abord, sinon la balise <meta> du début du document. */
function charsetOf(contentType: string, body: Buffer): string {
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)
  if (fromHeader) return fromHeader[1]
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return 'utf-8'
  if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe) return 'utf-16le'
  if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff) return 'utf-16be'
  const start = body.subarray(0, 4096).toString('latin1')
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(start)
  return fromMeta ? fromMeta[1] : 'utf-8'
}

export function decodeBody(contentType: string, body: Buffer): string {
  const label = charsetOf(contentType, body)
  try {
    return new TextDecoder(label).decode(body)
  } catch {
    return new TextDecoder('utf-8').decode(body) // étiquette inconnue : UTF-8, sans jamais lever
  }
}

// ── HTML → texte ───────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„',
  hellip: '…', ndash: '–', mdash: '—', middot: '·', bull: '•', deg: '°', euro: '€', pound: '£', yen: '¥',
  cent: '¢', copy: '©', reg: '®', trade: '™', times: '×', divide: '÷', plusmn: '±', sect: '§', para: '¶',
  frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', micro: 'µ', iexcl: '¡', iquest: '¿',
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø', oelig: 'œ',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý', yuml: 'ÿ', szlig: 'ß',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç',
  Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï',
  Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø', OElig: 'Œ',
  Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü', Yacute: 'Ý',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', minus: '−', ne: '≠', le: '≤', ge: '≥', infin: '∞',
}

/** Entités HTML → caractères. Une entité inconnue reste telle quelle. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#[xX][0-9a-fA-F]{1,8}|#\d{1,10}|[a-zA-Z][a-zA-Z0-9]{1,10});/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      // Hors d'Unicode ou caractère de contrôle : rien n'est inventé.
      if (!Number.isFinite(code) || code > 0x10ffff || (code < 32 && code !== 9 && code !== 10 && code !== 13)) return ''
      if (code >= 0xd800 && code <= 0xdfff) return ''
      return String.fromCodePoint(code)
    }
    return NAMED_ENTITIES[body] ?? whole
  })
}

export interface PageLink {
  text: string
  url: string
  at: number // position du lien dans le texte de la page
}

export interface PageText {
  title: string
  text: string
  links: PageLink[]
}

// Éléments dont le CONTENU n'est jamais du texte à lire : sautés jusqu'à leur fermeture.
const RAW_SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'math', 'iframe', 'canvas', 'object', 'select', 'textarea', 'button'])
// Habillage de la page — menus, colonnes, formulaires. header et footer ne sont
// sautés que HORS d'un article : dedans, c'est le titre et la signature du texte.
const CHROME_ALWAYS = new Set(['nav', 'aside', 'form'])
const CHROME_OUTSIDE_CONTENT = new Set(['header', 'footer'])
const CONTENT = new Set(['article', 'main'])
const PARAGRAPH = new Set(['p', 'blockquote', 'pre', 'table', 'ul', 'ol', 'dl', 'figure', 'section', 'article', 'main', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr'])
const LINE = new Set(['div', 'li', 'tr', 'dt', 'dd', 'figcaption', 'caption', 'address', 'details', 'summary', 'option', 'body', 'html', 'thead', 'tbody', 'tfoot'])

function attribute(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs)
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : null
}

const closeTags = new Map<string, RegExp>()

/** La fermeture `</name>` la plus proche à partir de `from` : où elle commence et où elle finit, ou null. */
function closeOf(html: string, name: string, from: number): { start: number; end: number } | null {
  let re = closeTags.get(name)
  if (!re) {
    re = new RegExp(`</${name}\\s*>`, 'ig')
    closeTags.set(name, re)
  }
  re.lastIndex = from
  const m = re.exec(html)
  return m ? { start: m.index, end: re.lastIndex } : null
}

const isLetter = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
const isNameChar = (c: number): boolean => isLetter(c) || (c >= 48 && c <= 58) || c === 45
const isBlank = (ch: string | undefined): boolean => ch !== undefined && /\s/.test(ch)

/**
 * Le texte lisible d'une page HTML, et ses liens repérés par leur position dans
 * ce texte. Les scripts, styles et l'habillage (menus, colonnes, pied de page)
 * sont retirés ; les titres gardent leur niveau (#), les listes leurs puces.
 * `skipChrome` éteint le retrait de l'habillage (repli, cf. pageText).
 *
 * UNE SEULE PASSE, sans retour en arrière : chaque caractère est vu un nombre
 * borné de fois, quoi que contienne la page. Ce texte vient d'un site que
 * personne ici ne maîtrise ; une lecture qui reprendrait sa recherche à chaque
 * « < » d'une page fabriquée pour cela figerait le serveur entier. Comme un
 * navigateur, une balise ou un commentaire jamais refermé emporte la fin du
 * document.
 */
export function htmlToText(html: string, baseUrl: string, skipChrome = true): PageText {
  let title = ''
  let base = baseUrl
  let text = ''
  const links: PageLink[] = []
  let pendingBreak = 0 // 0 rien, 1 saut de ligne, 2 ligne vide
  let pendingSpace = false
  let pendingPrefix = ''
  let inPre = 0
  let skipDepth = 0 // habillage ouvert : rien n'est écrit tant qu'il n'est pas refermé
  let contentDepth = 0 // dans un <article> ou un <main>
  let cellsInRow = 0
  let link: { url: string; text: string; at: number } | null = null

  const breakLine = (n: number): void => {
    pendingBreak = Math.max(pendingBreak, n)
    pendingSpace = false
  }
  // Le texte finit-il par un blanc ? Tenu À LA MAIN : relire le dernier caractère
  // d'une chaîne qu'on allonge sans cesse la fait recopier en entier à chaque
  // fois — vingt secondes pour une grosse page aux nombreuses petites balises.
  let endsBlank = false
  const write = (raw: string, decode: boolean): void => {
    if (skipDepth > 0 || raw === '') return
    const value = decode ? decodeEntities(raw) : raw
    if (inPre > 0) {
      if (pendingBreak > 0 && text.length > 0) text += '\n'.repeat(pendingBreak)
      pendingBreak = 0
      text += pendingPrefix + value
      pendingPrefix = ''
      endsBlank = isBlank(value[value.length - 1])
      return
    }
    const lead = isBlank(value[0])
    const trail = isBlank(value[value.length - 1])
    const core = value.replace(/\s+/g, ' ').trim()
    if (core === '') {
      if (text.length > 0 && pendingBreak === 0) pendingSpace = true
      return
    }
    if (pendingBreak > 0) {
      if (text.length > 0) text += '\n'.repeat(pendingBreak)
    } else if ((pendingSpace || lead) && text.length > 0 && !endsBlank) {
      text += ' '
    }
    pendingBreak = 0
    text += pendingPrefix
    pendingPrefix = ''
    if (link) {
      if (link.at === -1) link.at = text.length
      if (link.text.length < LINK_TEXT_MAX) link.text += (link.text ? ' ' : '') + core
    }
    text += core
    endsBlank = false
    pendingSpace = trail
  }

  const n = html.length
  let i = 0
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt === -1) {
      write(html.slice(i), true)
      break
    }
    if (lt > i) write(html.slice(i, lt), true)
    const next = html.charCodeAt(lt + 1)
    if (next === 33 /* ! */) {
      if (html.startsWith('<!--', lt)) {
        const end = html.indexOf('-->', lt + 4)
        i = end === -1 ? n : end + 3
      } else if (html.startsWith('<![CDATA[', lt)) {
        const end = html.indexOf(']]>', lt + 9)
        write(html.slice(lt + 9, end === -1 ? n : end), false) // son contenu est du texte, tel quel
        i = end === -1 ? n : end + 3
      } else {
        const end = html.indexOf('>', lt + 2)
        i = end === -1 ? n : end + 1
      }
      continue
    }
    if (next === 63 /* ? */) {
      const end = html.indexOf('>', lt + 2)
      i = end === -1 ? n : end + 1
      continue
    }
    const closing = next === 47 /* / */
    const nameStart = lt + (closing ? 2 : 1)
    if (!isLetter(html.charCodeAt(nameStart))) {
      write('<', false) // un « < » du texte (« a < b »), pas une balise
      i = lt + 1
      continue
    }
    let j = nameStart + 1
    while (j < n && isNameChar(html.charCodeAt(j))) j++
    const name = html.slice(nameStart, j).toLowerCase()
    // Jusqu'au « > » qui ferme la balise. Un guillemet n'ouvre une valeur qu'après
    // un « = » (comme pour un navigateur) ; dans une valeur, « > » est du texte.
    const attrsStart = j
    let quote = 0
    let lastSignificant = 0
    while (j < n) {
      const c = html.charCodeAt(j)
      if (quote !== 0) {
        if (c === quote) quote = 0
      } else if ((c === 34 || c === 39) && lastSignificant === 61 /* = */) {
        quote = c
      } else if (c === 62 /* > */) {
        break
      }
      if (c !== 32 && (c < 9 || c > 13)) lastSignificant = c
      j++
    }
    if (j >= n) break // balise jamais refermée : la fin du document part avec elle
    const attrs = html.slice(attrsStart, j)
    i = j + 1

    if (name === 'title' && !closing) {
      const close = closeOf(html, name, i)
      // Borné AVANT tout traitement : un <title> jamais refermé irait jusqu'à la fin du document.
      if (title === '') {
        title = decodeEntities(html.slice(i, Math.min(close ? close.start : n, i + TITLE_MAX * 4)))
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, TITLE_MAX)
      }
      i = close ? close.end : n
      continue
    }
    if (RAW_SKIP.has(name)) {
      if (!closing && !attrs.trimEnd().endsWith('/')) {
        // Tout ce qui suit jusqu'à la fermeture est ignoré, balises comprises.
        const close = closeOf(html, name, i)
        i = close ? close.end : n
      }
      continue
    }
    if (name === 'base' && !closing) {
      // <base href> : c'est contre lui que les liens relatifs de la page se résolvent.
      const href = attribute(attrs, 'href')
      try {
        // Borné : un <base> d'un mégaoctet ferait de CHAQUE lien relatif une adresse d'un mégaoctet.
        const target = href && href.length <= URL_MAX ? new URL(href, baseUrl) : null
        if (target && (target.protocol === 'http:' || target.protocol === 'https:')) base = target.toString()
      } catch {
        /* base illisible : l'adresse de la page reste la référence */
      }
      continue
    }
    if (CONTENT.has(name)) contentDepth = Math.max(0, contentDepth + (closing ? -1 : 1))
    if (skipChrome && (CHROME_ALWAYS.has(name) || (CHROME_OUTSIDE_CONTENT.has(name) && (contentDepth === 0 || skipDepth > 0)))) {
      skipDepth = Math.max(0, skipDepth + (closing ? -1 : 1))
      continue
    }
    if (skipDepth > 0) continue

    if (name === 'br') {
      pendingBreak = Math.min(2, pendingBreak + 1)
      pendingSpace = false
    } else if (name === 'a') {
      if (closing) {
        // Un lien sans texte n'a pas de place dans le texte : il n'est pas gardé.
        if (link && link.at >= 0) links.push({ text: link.text.slice(0, LINK_TEXT_MAX), url: link.url, at: link.at })
        link = null
      } else {
        link = null
        const href = attribute(attrs, 'href')
        // Bornés en nombre et en longueur : au-delà, le texte du lien reste, sans adresse.
        if (href && !href.startsWith('#') && href.length <= URL_MAX && links.length < LINKS_PER_PAGE) {
          try {
            const target = new URL(href, base)
            if (target.protocol === 'http:' || target.protocol === 'https:') {
              target.hash = ''
              const full = target.toString()
              if (full.length <= URL_MAX) link = { url: full, text: '', at: -1 }
            }
          } catch {
            /* lien illisible : son texte reste, sans adresse */
          }
        }
      }
    } else if (name === 'pre') {
      breakLine(2)
      inPre = Math.max(0, inPre + (closing ? -1 : 1))
    } else if (/^h[1-6]$/.test(name)) {
      breakLine(2)
      // Refermé sans texte : sa marque ne doit pas tomber sur le paragraphe suivant.
      pendingPrefix = closing ? '' : '#'.repeat(Number(name[1])) + ' '
    } else if (name === 'li') {
      breakLine(1)
      pendingPrefix = closing ? '' : '- '
    } else if (name === 'tr') {
      breakLine(1)
      cellsInRow = 0
    } else if (name === 'td' || name === 'th') {
      if (!closing) {
        if (cellsInRow > 0) write(' | ', false)
        cellsInRow++
      }
    } else if (PARAGRAPH.has(name)) {
      breakLine(2)
    } else if (LINE.has(name)) {
      breakLine(1)
    }
  }
  // Les positions des liens suivent le texte rendu : un blanc de tête retiré les décale d'autant.
  const lead = text.length - text.trimStart().length
  const trimmed = text.trim()
  return {
    title,
    text: trimmed,
    links: links.filter((l) => l.at >= lead && l.at - lead < trimmed.length).map((l) => ({ ...l, at: l.at - lead })),
  }
}

/**
 * Le texte d'un document selon son type. Pour du HTML dont le retrait de
 * l'habillage ne laisse presque rien (balise jamais refermée, page toute en
 * <header>), la conversion est refaite sans ce retrait : mieux vaut un menu en
 * trop qu'une page vide.
 */
export function pageText(contentType: string, source: string, url: string): PageText {
  const looksHtml = /html|xml/i.test(contentType) || /^\s*(<!doctype html|<html[\s>])/i.test(source)
  if (!looksHtml) {
    // Texte brut : tel quel, les longues suites de lignes vides (sauts de page) ramenées à une.
    return { title: '', text: source.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), links: [] }
  }
  const page = htmlToText(source, url)
  if (page.text.length >= 200) return page
  const whole = htmlToText(source, url, false)
  return whole.text.length > page.text.length ? whole : page
}

/** Découpe en parties d'au plus `size` caractères, coupées de préférence entre deux paragraphes. */
export function splitParts(text: string, size = PART_CHARS): [number, number][] {
  const parts: [number, number][] = []
  let start = 0
  while (text.length - start > size) {
    const window = text.slice(start, start + size)
    let cut = window.lastIndexOf('\n\n')
    if (cut < size * 0.5) cut = window.lastIndexOf('\n')
    if (cut < size * 0.5) cut = window.lastIndexOf(' ')
    if (cut < size * 0.5) cut = size
    parts.push([start, start + cut])
    start += cut
    while (start < text.length && /\s/.test(text[start])) start++
  }
  if (start < text.length || parts.length === 0) parts.push([start, text.length])
  return parts
}

// ── Mémoire courte des pages lues ──────────────────────────────────────────
// Demander la partie 2 ne retélécharge pas la page : le texte d'une page lue
// reste quelques minutes en mémoire (jamais sur disque).

interface CachedPage {
  at: number
  url: string
  page: PageText
  truncated: boolean
  chars: number // ce que la page pèse en mémoire : son texte et ses liens
}

function weightOf(page: PageText): number {
  return page.title.length + page.text.length + page.links.reduce((sum, l) => sum + l.url.length + l.text.length, 0)
}

const cache = new Map<string, CachedPage>()

/** Vide la mémoire des pages lues (essais). */
export function clearWebOpenCache(): void {
  cache.clear()
}

function remember(key: string, value: CachedPage): void {
  cache.delete(key)
  cache.set(key, value)
  let total = 0
  for (const entry of cache.values()) total += entry.chars
  // La plus ancienne part d'abord ; la page qu'on vient de lire reste toujours.
  while (cache.size > 1 && (cache.size > CACHE_MAX || total > CACHE_MAX_CHARS)) {
    const oldest = cache.keys().next().value as string
    total -= cache.get(oldest)?.chars ?? 0
    cache.delete(oldest)
  }
}

// ── Ce que le modèle lit en cas d'échec ────────────────────────────────────
// Toujours un résultat d'outil normal (jamais un throw), et toujours DIT : un
// code nu ne dit pas s'il faut réessayer, et un modèle qui ne le sait pas
// revient frapper à la même porte.

const OTHER_SOURCE = 'Retrying will not change it — use another source.'

function failureText(failure: FetchFailure): string {
  switch (failure.kind) {
    case 'scheme':
      return 'Not opened: only http and https addresses can be opened, written in full (https://…). Do not retry with this address.'
    case 'long':
      return `Not opened: this address is too long (more than ${URL_MAX} characters). Do not retry with it.`
    case 'port':
      return 'Not opened: only the standard Web ports can be opened (80 for http, 443 for https). Do not retry with this address.'
    case 'credentials':
      return 'Not opened: an address carrying a user name or password is refused.'
    case 'private':
      return `Not opened: ${failure.host} is a local or private network address. Only public Web pages can be opened. Do not retry.`
    case 'redirects':
      return `Not opened: ${failure.host} redirects too many times. ${OTHER_SOURCE}`
    case 'timeout':
      return `Not opened: ${failure.host} did not answer in time. Do not retry now — use another source.`
    case 'type':
      return `Not opened: this address is not a text page (content type: ${failure.contentType}). Only text and HTML pages can be read.`
    case 'network':
      return `Not opened: ${failure.host} could not be reached (${failure.detail}). Check the address, or use another source.`
    case 'http':
      if ([401, 403, 406, 451].includes(failure.status)) {
        return `HTTP ${failure.status}: this site refuses automated reading. ${OTHER_SOURCE}`
      }
      if (failure.status === 202) {
        return `HTTP 202: this site makes automated readers wait instead of giving the page. ${OTHER_SOURCE}`
      }
      if (failure.status === 429) return 'HTTP 429: this site limits how often it can be read. Maybe later — use another source for now.'
      if (failure.status === 404 || failure.status === 410) {
        return `HTTP ${failure.status}: this page does not exist. Check the address, or search for the page instead.`
      }
      if (failure.status >= 500) {
        return `HTTP ${failure.status}: this site has a problem right now. Maybe later — use another source for now.`
      }
      return `HTTP ${failure.status}: the page could not be read. ${OTHER_SOURCE}`
  }
}

// ── L'outil ────────────────────────────────────────────────────────────────

/** Exécute web_open ; rend toujours un texte pour le modèle (jamais de throw sur un échec réseau). */
export async function executeWebOpenTool(args: Record<string, unknown>, deps: WebOpenDeps = {}): Promise<string> {
  const raw = typeof args.url === 'string' ? args.url.trim() : ''
  if (!raw) throw new Error('url is required')
  const wanted = Number(args.part)
  const part = Number.isInteger(wanted) && wanted >= 1 ? wanted : 1
  const withLinks = args.links === true || args.links === 'true'

  const now = (deps.now ?? Date.now)()
  let cached = cache.get(raw)
  if (cached && now - cached.at > CACHE_TTL_MS) cached = undefined
  if (!cached) {
    const out = await fetchPage(raw, deps)
    if ('failure' in out) return failureText(out.failure)
    const { fetched } = out
    const page = pageText(fetched.contentType, decodeBody(fetched.contentType, fetched.body), fetched.url)
    cached = { at: now, url: fetched.url, page, truncated: fetched.truncated, chars: weightOf(page) }
    remember(raw, cached)
  }
  const { page } = cached
  if (page.text === '') return 'The page was opened but has no readable text (it may need JavaScript to display). Use another source.'

  const parts = splitParts(page.text)
  const served = Math.min(part, parts.length)
  const [start, end] = parts[served - 1]
  const lines: string[] = []
  if (page.title) lines.push(`Title: ${page.title}`)
  lines.push(`URL: ${cached.url}`)
  if (part > parts.length) lines.push(`(the page has only ${parts.length} part${parts.length > 1 ? 's' : ''}: part ${served} is served)`)
  lines.push('', page.text.slice(start, end).trim(), '')
  if (parts.length === 1) lines.push('(whole page)')
  else if (served < parts.length) lines.push(`(part ${served} of ${parts.length} — for the next one: web_open with "part": ${served + 1})`)
  else lines.push(`(part ${served} of ${parts.length} — end of the page)`)
  if (cached.truncated && served === parts.length) lines.push('(the page is very large: it was cut, its end is missing)')
  if (withLinks) {
    const seen = new Set<string>()
    const here = page.links.filter((l) => l.at >= start && l.at < end && !seen.has(l.url) && seen.add(l.url))
    if (here.length === 0) lines.push('', 'No link in this part.')
    else {
      lines.push('', 'Links in this part:')
      here.slice(0, LINKS_MAX).forEach((l, i) => lines.push(`${i + 1}. ${l.text} — ${l.url}`))
      if (here.length > LINKS_MAX) lines.push(`(${here.length - LINKS_MAX} more links not listed)`)
    }
  }
  return lines.join('\n')
}
