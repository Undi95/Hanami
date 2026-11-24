// Tests headless de l'outil web_open — `npm run test:web-open`.
//
// AUCUN accès à Internet : les pages viennent d'un petit serveur lancé ici, sur
// la boucle locale. Comme la garde de l'outil REFUSE justement la boucle locale,
// les lectures passent une garde d'essai qui n'ouvre que 127.0.0.1 et laisse
// tout le reste à la vraie ; les refus, eux, sont essayés avec la vraie garde,
// sans rien remplacer.
//
// Ce qui est prouvé ici : quelles adresses sont refusées (réseaux privés et
// locaux sous toutes leurs écritures, schémas, identifiants), qu'un nom qui
// résout vers une adresse locale est refusé sans qu'aucune requête ne parte, que
// chaque redirection repasse par les gardes, les bornes (durée, taille, types),
// la conversion HTML → texte, le découpage en parties, les liens, les messages
// d'échec, et que l'outil n'est offert et exécutable que si le réglage l'allume.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import type { AddressInfo } from 'node:net'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hanami-web-open-'))
// AVANT tout import du serveur : DATA_DIR se fige au chargement de storage.ts.
process.env.HANAMI_DATA = TMP

// ── Micro-harnais (le même que scripts/test-restore.ts) ─────────────────────

let passed = 0
const failures: string[] = []

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    passed++
    console.log(`  ok   ${name}`)
  } catch (e) {
    failures.push(`${name} — ${e instanceof Error ? e.message : String(e)}`)
    console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`)
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message)
}

function equal<T>(actual: T, expected: T, what: string): void {
  if (actual !== expected) throw new Error(`${what} : attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`)
}

// ── Les pages d'essai ───────────────────────────────────────────────────────

const PAGE = `<!doctype html><html><head><title>Une page &amp; son titre</title><style>body{color:red}</style><script>var secret = "SCRIPT-INTERDIT"</script></head>
<body>
<header><a href="/accueil">Accueil du site</a> MENU-DU-SITE</header>
<nav><ul><li><a href="/a">Lien de menu</a></li></ul></nav>
<main><article>
<header><h1>Le titre de l'article</h1><p>Par quelqu'un</p></header>
<p>Premier   paragraphe avec un <a href="/suite?x=1#ancre">lien relatif</a> et un <a href="https://example.org/ailleurs">lien absolu</a>.</p>
<p>Caf&eacute; &laquo;&nbsp;cr&egrave;me&nbsp;&raquo; &#233;t&#xe9; &amp; &inconnue; fin.</p>
<h2>Une liste</h2>
<ul><li>un</li><li></li><li>deux <b>gras</b>s</li></ul>
<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
<pre>ligne 1
  ligne 2</pre>
<p>Un <a href="#haut">retour en haut</a>, un <a href="mailto:x@example.org">courriel</a>, un <a href="javascript:void(0)">script</a>, et le <a href="/suite?x=1">même lien</a>.</p>
<aside>COLONNE-A-COTE</aside>
<form><input name="q"><button>BOUTON</button></form>
<footer>Signature de l'article</footer>
</article></main>
<footer>PIED-DU-SITE</footer>
<script>document.write("AUTRE-SCRIPT")</script>
</body></html>`

const TEXTE_ATTENDU = `# Le titre de l'article

Par quelqu'un

Premier paragraphe avec un lien relatif et un lien absolu.

Café « crème » été & &inconnue; fin.

## Une liste

- un
- deux grass

A | B
1 | 2

ligne 1
  ligne 2

Un retour en haut, un courriel, un script, et le même lien.

Signature de l'article`

const LONGUE =
  '<html><head><title>Longue</title></head><body>' +
  '<p>Un <a href="/debut">lien du début</a>.</p>\n' +
  Array.from({ length: 60 }, (_, i) => `<p>Paragraphe ${i + 1}. ${'mot '.repeat(70)}fin ${i + 1}.</p>`).join('\n') +
  '\n<p>Un <a href="/fin">lien de la fin</a>.</p>' +
  '</body></html>'

const LIENS =
  '<html><body>' + Array.from({ length: 50 }, (_, i) => `<p><a href="/cible/${i + 1}">cible ${i + 1}</a></p>`).join('') + '</body></html>'

// Deux cent cinquante-six mégaoctets de zéros dans moins d'un kilo-octet : Brotli les replie à ce point.
// Fabriquée à la première demande seulement (un quart de seconde, et la mémoire d'un instant).
let bombeFaite: Buffer | null = null
function bombe(): Buffer {
  bombeFaite ??= zlib.brotliCompressSync(Buffer.alloc(256 * 1024 * 1024), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 3 } })
  return bombeFaite
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const hits: Record<string, number> = {}
let PORT = 0

const server = http.createServer((req, res) => {
  const url = req.url ?? '/'
  hits[url] = (hits[url] ?? 0) + 1
  const html = (body: string | Buffer, headers: Record<string, string> = {}): void => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...headers })
    res.end(body)
  }
  if (url === '/page') html(PAGE)
  else if (url === '/redir1') res.writeHead(302, { Location: '/redir2' }).end()
  else if (url === '/redir2') res.writeHead(301, { Location: '/page' }).end()
  else if (url === '/vers-prive') res.writeHead(302, { Location: `http://[::1]:${PORT}/page` }).end()
  else if (url === '/vers-fichier') res.writeHead(302, { Location: 'file:///etc/passwd' }).end()
  else if (url === '/boucle') res.writeHead(302, { Location: '/boucle' }).end()
  else if (url === '/gzip') html(zlib.gzipSync(PAGE), { 'Content-Encoding': 'gzip' })
  else if (url === '/br') html(zlib.brotliCompressSync(PAGE), { 'Content-Encoding': 'br' })
  else if (url === '/deflate') html(zlib.deflateSync(PAGE), { 'Content-Encoding': 'deflate' })
  else if (url === '/latin1') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=iso-8859-1' })
    res.end(Buffer.from('<html><body><p>Un café serré, déjà.</p></body></html>', 'latin1'))
  } else if (url === '/meta-latin1') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(Buffer.from('<html><head><meta charset="windows-1252"></head><body><p>Un café serré, déjà.</p></body></html>', 'latin1'))
  } else if (url === '/pdf') res.writeHead(200, { 'Content-Type': 'application/pdf' }).end('%PDF-1.7')
  else if (url === '/binaire') res.writeHead(200).end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 13, 1, 2, 3]))
  else if (url === '/texte') res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Ligne une.\r\nLigne <deux> & trois.\r\n')
  else if (url === '/sans-type') res.writeHead(200).end('<html><body><p>Page sans étiquette.</p></body></html>')
  else if (/^\/statut\/\d+$/.test(url)) res.writeHead(Number(url.slice(8)), { 'Content-Type': 'text/html' }).end('<p>non</p>')
  else if (url === '/lent') {
    /* ne répond jamais */
  } else if (url === '/longue') html(LONGUE)
  else if (url === '/liens') html(LIENS)
  else if (url === '/vers-port') res.writeHead(302, { Location: `http://127.0.0.1:${PORT + 1}/page` }).end()
  else if (url === '/vers-long') res.writeHead(302, { Location: '/page?' + 'a'.repeat(3000) }).end()
  else if (url === '/langue') html(`<html><body><p>Langue demandée : ${req.headers['accept-language']}</p></body></html>`)
  else if (url === '/texte-pages') res.writeHead(200, { 'Content-Type': 'text/plain' }).end('haut\n\n\n\n\n\nbas\n')
  else if (url === '/bombe') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'br' })
    res.end(bombe())
  } else if (url.startsWith('/lourde/')) html('<html><body><p>' + 'mot '.repeat(475_000) + '</p></body></html>')
  else if (url.startsWith('/n/')) html(`<html><body><p>Petite page ${url.slice(3)}.</p></body></html>`)
  else if (url === '/grosse') html('<html><body>' + '<p>bloc de texte assez long pour compter.</p>\n'.repeat(4000) + '<p>FIN-DE-LA-GROSSE-PAGE</p></body></html>')
  else if (url === '/vide') html('<html><head><title>Vide</title></head><body><script>app()</script></body></html>')
  else if (url === '/nav-ouverte') html('<html><body><nav><p>Tout le texte de la page est resté dans un menu jamais refermé.</p></body></html>')
  else res.writeHead(404, { 'Content-Type': 'text/html' }).end('<p>introuvable</p>')
})

async function main(): Promise<void> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  PORT = port
  const base = `http://127.0.0.1:${port}`

  const web = await import('../server/tools/webPageTools')
  // Garde d'essai : la boucle locale 127.0.0.1 passe (c'est le serveur d'ici), tout le reste reste à la vraie garde.
  // De même pour le port : seul celui du serveur d'ici s'ajoute aux ports du Web.
  const ici = (p: number): boolean => p === port
  const local = { isForbidden: (a: string): boolean => a !== '127.0.0.1' && web.isForbiddenAddress(a), allowPort: ici }
  const open = (pathOrUrl: string, extra: Record<string, unknown> = {}, deps: Record<string, unknown> = {}): Promise<string> =>
    web.executeWebOpenTool({ url: pathOrUrl.startsWith('/') ? base + pathOrUrl : pathOrUrl, ...extra }, { ...local, ...deps })

  console.log('\nGarde des adresses')

  await check('adresses refusées : boucle locale, réseaux privés, lien-local, plages réservées — en IPv4 et en IPv6', () => {
    const refusees = [
      '127.0.0.1', '127.255.255.254', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255',
      '169.254.169.254', '100.64.0.1', '100.127.255.255', '0.0.0.0', '0.1.2.3', '224.0.0.1', '239.255.255.250', '240.0.0.1',
      '255.255.255.255', '198.18.0.1', '198.19.255.255', '192.0.2.1', '198.51.100.7', '203.0.113.9', '192.0.0.1', '192.88.99.1',
      '::1', '::', 'fe80::1', 'fe80::1%eth0', 'febf::1', 'fc00::1', 'fd12:3456:789a::1', 'fec0::1', 'ff02::1', 'ff0e::1',
      '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:c0a8:101', '::ffff:169.254.169.254', '::127.0.0.1', '64:ff9b::7f00:1',
      '64:ff9b::a00:1', '2001:db8::1', '2001::1', '2002:c0a8:101::1', '100::1', '::2', '4000::1', 'e000::1',
      '2001:2::1', '2001:10::1', '2001:20::1', '2001:1ff:ffff::1', '3fff::1', '3fff:fff:ffff::1',
      'exemple.org', '', '1.2.3', '1.2.3.4.5', '256.1.1.1', 'localhost',
    ]
    // Sans aucune interface : c'est la règle des PLAGES seule qui est jugée ici. Avec celles de la
    // machine, la boucle locale serait refusée une seconde fois (elle est sur une de ses interfaces),
    // et cette seconde garde cacherait une faute dans la première.
    for (const a of refusees) assert(web.isForbiddenAddress(a, {}), `devrait être refusée : ${a}`)
    assert(web.isForbiddenAddress('127.0.0.1') && web.isForbiddenAddress('::1'), 'avec les interfaces de la machine aussi')
  })

  await check("adresses publiques acceptées, jusqu'aux bords des plages refusées", () => {
    const acceptees = [
      '8.8.8.8', '1.1.1.1', '93.184.216.34', '9.255.255.255', '11.0.0.0', '126.255.255.255', '128.0.0.1', '172.15.255.255',
      '172.32.0.1', '192.167.255.255', '192.169.0.1', '169.253.255.255', '169.255.0.1', '100.63.255.255', '100.128.0.1',
      '198.17.255.255', '198.20.0.1', '192.0.1.1', '192.0.3.1', '198.51.99.1', '198.51.101.1', '203.0.112.1', '203.0.114.1',
      '192.88.98.1', '223.255.255.255',
      '2606:4700:4700::1111', '2a00:1450:4007:80e::200e', '2001:4860:4860::8888', '3fff:ffff::1', '::ffff:8.8.8.8',
      '::ffff:808:808', '64:ff9b::808:808', '2003::1', '2001:200::1', '3fff:1000::1',
    ]
    for (const a of acceptees) assert(!web.isForbiddenAddress(a, {}), `devrait être acceptée : ${a}`)
  })

  await check('refus AVANT toute connexion : schémas, identifiants, adresses locales sous toutes leurs écritures', async () => {
    web.clearWebOpenCache()
    for (const url of ['ftp://example.org/x', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,<p>x</p>', 'pas une adresse', '//example.org/x']) {
      assert((await web.executeWebOpenTool({ url })).includes('only http and https'), `schéma refusé : ${url}`)
    }
    assert((await web.executeWebOpenTool({ url: 'http://qui:secret@hote-inexistant.invalid/' })).includes('user name or password'), 'identifiants refusés')
    const locales = [
      `http://127.0.0.1:${port}/page`, `http://2130706433:${port}/page`, `http://0x7f.0.0.1:${port}/page`, `http://017700000001:${port}/page`,
      `http://127.1:${port}/page`, `http://0:${port}/page`, `http://[::1]:${port}/page`, `http://[::ffff:127.0.0.1]:${port}/page`,
      `http://[::ffff:7f00:1]:${port}/page`, `http://127.0.0.2:${port}/page`, `http://0.0.0.0:${port}/page`,
    ]
    for (const url of locales) {
      const out = await web.executeWebOpenTool({ url })
      assert(out.includes('local or private network address'), `adresse locale refusée : ${url} → ${out}`)
    }
    equal(hits['/page'] ?? 0, 0, "aucune de ces adresses n'a été jointe")
  })

  await check('un NOM qui résout vers une adresse locale est refusé à la connexion, sans qu\'aucune requête ne parte', async () => {
    web.clearWebOpenCache()
    for (const host of ['localhost', 'localhost.']) {
      // Le port d'ici est permis, pour que ce soit bien la garde des ADRESSES — la vraie — qui réponde.
      const out = await web.executeWebOpenTool({ url: `http://${host}:${port}/page` }, { allowPort: ici })
      assert(out.includes('local or private network address'), `${host} → ${out}`)
    }
    equal(hits['/page'] ?? 0, 0, 'requêtes reçues par le serveur local')
  })

  await check("un nom qui résout vers PLUSIEURS adresses est refusé dès qu'une seule est interdite", async () => {
    web.clearWebOpenCache()
    const dns = await import('node:dns')
    const adresses = (await dns.promises.lookup('localhost', { all: true })).map((a) => a.address)
    if (!adresses.includes('127.0.0.1') || !adresses.includes('::1')) {
      // Sans les deux familles sur cette machine, l'essai ne prouverait rien : il le dit plutôt que de passer en silence.
      throw new Error(`« localhost » ne résout pas vers les deux adresses de boucle locale ici (${adresses.join(', ')})`)
    }
    // Garde d'essai : seule ::1 est interdite. 127.0.0.1, où le serveur écoute, serait jointe si une adresse permise suffisait.
    const out = await web.executeWebOpenTool({ url: `http://localhost:${port}/page` }, { isForbidden: (a) => a === '::1', allowPort: ici })
    assert(out.includes('local or private network address'), `résultat : ${out.slice(0, 80)}`)
    equal(hits['/page'] ?? 0, 0, 'requêtes reçues par le serveur local')
  })

  await check('ports : ceux du Web seulement, par défaut comme après une redirection', async () => {
    web.clearWebOpenCache()
    // Aucune connexion n'est tentée pour un port refusé : le refus vient avant.
    for (const url of [
      'https://hote-inexistant.invalid:8443/x', 'http://hote-inexistant.invalid:8080/', 'http://hote-inexistant.invalid:22/',
      // Le port de l'AUTRE schéma n'est pas le port du schéma.
      'http://hote-inexistant.invalid:443/', 'https://hote-inexistant.invalid:80/',
    ]) {
      assert((await web.executeWebOpenTool({ url })).includes('standard Web ports'), `port refusé : ${url}`)
    }
    // Le port du schéma, écrit ou non, passe la garde des ports (ici vers la boucle locale, garde des adresses ouverte pour l'essai).
    for (const url of ['http://127.0.0.1/', 'http://127.0.0.1:80/', 'https://127.0.0.1/', 'https://127.0.0.1:443/']) {
      const out = await web.executeWebOpenTool({ url }, { isForbidden: () => false, timeoutMs: 400 })
      assert(!out.includes('standard Web ports'), `${url} : ${out.slice(0, 60)}`)
    }
    assert((await web.executeWebOpenTool({ url: `http://127.0.0.1:${port}/page` }, { isForbidden: () => false })).includes('standard Web ports'), "le port d'ici n'est pas un port du Web")
    assert((await open('/vers-port')).includes('standard Web ports'), 'redirection vers un autre port refusée')
    equal(hits['/page'] ?? 0, 0, 'aucune de ces adresses n\'a été jointe')
  })

  await check('adresses trop longues : refusées, à la demande comme après une redirection', async () => {
    web.clearWebOpenCache()
    assert((await open('/page?' + 'a'.repeat(3000))).includes('too long'), 'adresse demandée')
    assert((await open('/vers-long')).includes('too long'), 'adresse de redirection')
    equal(hits['/page'] ?? 0, 0, 'aucune requête partie')
  })

  await check('le réseau de la machine est refusé, même quand ses adresses sont publiques', () => {
    const itf = (address: string, cidr: string | null): import('node:os').NetworkInterfaceInfo =>
      ({ address, cidr, netmask: '', mac: '00:00:00:00:00:00', internal: false, family: address.includes(':') ? 'IPv6' : 'IPv4', scopeid: 0 }) as import('node:os').NetworkInterfaceInfo
    const maison = {
      eth0: [itf('2a02:1234:5678:9a00::10', '2a02:1234:5678:9a00::10/64'), itf('203.0.114.5', '203.0.114.5/24')],
      vpn: [itf('198.200.16.1', '198.200.16.1/20'), itf('198.201.1.1', null), itf('198.202.1.1', '198.202.1.1/0')],
    }
    const refuse = (a: string): boolean => web.isForbiddenAddress(a, maison)
    for (const a of ['2a02:1234:5678:9a00::10', '2a02:1234:5678:9a00::99', '2a02:1234:5678:9a00:ffff:ffff:ffff:ffff', '203.0.114.5', '203.0.114.77', '::ffff:203.0.114.77', '64:ff9b::cb00:724d', '198.200.16.9', '198.200.31.255', '198.201.1.1', '198.202.1.1']) {
      assert(refuse(a), `devrait être refusée (réseau de la machine) : ${a}`)
    }
    for (const a of ['2a02:1234:5678:9a01::99', '2a02:1234:5678:99ff::1', '203.0.115.77', '203.0.112.1', '198.200.32.1', '198.200.15.255', '198.201.1.2', '198.202.1.2', '8.8.8.8', '2606:4700:4700::1111']) {
      assert(!refuse(a), `devrait être acceptée (autre réseau) : ${a}`)
    }
    assert(web.isOwnNetworkAddress('203.0.114.77', maison) && !web.isOwnNetworkAddress('pas une adresse', maison), 'isOwnNetworkAddress')
  })

  console.log('\nLecture')

  await check('une page : son titre, son adresse, son texte — sans scripts, styles ni habillage', async () => {
    web.clearWebOpenCache()
    const out = await open('/page')
    equal(out, `Title: Une page & son titre\nURL: ${base}/page\n\n${TEXTE_ATTENDU}\n\n(whole page)`, 'résultat')
    for (const interdit of ['SCRIPT-INTERDIT', 'AUTRE-SCRIPT', 'MENU-DU-SITE', 'Lien de menu', 'COLONNE-A-COTE', 'BOUTON', 'PIED-DU-SITE', 'color:red']) {
      assert(!out.includes(interdit), `ne devrait pas paraître : ${interdit}`)
    }
  })

  await check('les liens ne viennent que sur demande : adresses complètes, sans doublon, sans ancres ni schémas étrangers ni menu', async () => {
    const out = await open('/page', { links: true })
    const liste = out.slice(out.indexOf('Links in this part:'))
    equal(liste, `Links in this part:\n1. lien relatif — ${base}/suite?x=1\n2. lien absolu — https://example.org/ailleurs`, 'liens')
    assert(!(await open('/page')).includes('Links in this part'), 'pas de liens sans les demander')
    assert((await open('/texte', { links: true })).endsWith('No link in this part.'), 'une page sans lien le dit')
  })

  await check('redirections suivies, et chaque saut repasse par les gardes', async () => {
    web.clearWebOpenCache()
    const out = await open('/redir1')
    assert(out.includes(`URL: ${base}/page`) && out.includes("# Le titre de l'article"), 'la page finale est lue, son adresse affichée')
    const avant = hits['/page']
    assert((await open('/vers-prive')).includes('is a local or private network address'), 'redirection vers une adresse locale refusée')
    equal(hits['/page'], avant, "la page derrière la redirection refusée n'a pas été jointe")
    assert((await open('/vers-fichier')).includes('only http and https'), 'redirection vers un autre schéma refusée')
    assert((await open('/boucle')).includes('redirects too many times'), 'boucle de redirections')
    equal(hits['/boucle'], 6, 'sauts tentés avant de renoncer')
  })

  await check('pages compressées et jeux de caractères', async () => {
    web.clearWebOpenCache()
    for (const p of ['/gzip', '/br', '/deflate']) assert((await open(p)).includes('Café « crème » été'), `page ${p}`)
    assert((await open('/latin1')).includes('Un café serré, déjà.'), "jeu de caractères de l'en-tête")
    assert((await open('/meta-latin1')).includes('Un café serré, déjà.'), 'jeu de caractères de la balise meta')
    equal(await open('/texte'), `URL: ${base}/texte\n\nLigne une.\nLigne <deux> & trois.\n\n(whole page)`, 'texte brut servi tel quel')
    assert((await open('/texte-pages')).includes('haut\n\nbas'), 'texte brut : les suites de lignes vides ramenées à une')
    assert((await open('/sans-type')).includes('Page sans étiquette.'), 'une page sans type annoncé est lue')
  })

  await check('ce qui ne se lit pas est dit, avec ce qu\'il faut en faire', async () => {
    web.clearWebOpenCache()
    assert((await open('/pdf')).includes('not a text page (content type: application/pdf)'), 'type non textuel')
    assert((await open('/binaire')).includes('not a text page'), 'fichier binaire sans étiquette')
    for (const code of [401, 403, 406, 451]) {
      const out = await open(`/statut/${code}`)
      assert(out.startsWith(`HTTP ${code}: this site refuses automated reading`) && out.includes('Retrying will not change it'), `HTTP ${code}`)
    }
    assert((await open('/statut/202')).startsWith('HTTP 202: this site makes automated readers wait'), 'HTTP 202')
    assert((await open('/statut/429')).startsWith('HTTP 429: this site limits'), 'HTTP 429')
    assert((await open('/statut/404')).startsWith('HTTP 404: this page does not exist'), 'HTTP 404')
    assert((await open('/statut/500')).startsWith('HTTP 500: this site has a problem right now'), 'HTTP 500')
    assert((await open('/statut/503')).includes('Maybe later'), 'HTTP 503 : une panne passagère, pas un refus')
    assert((await open('/statut/418')).startsWith('HTTP 418: the page could not be read'), 'autre code')
    assert((await open('/vide')).includes('no readable text'), 'page sans texte')
    const debut = Date.now()
    assert((await open('/lent', {}, { timeoutMs: 300 })).includes('did not answer in time'), 'site qui ne répond pas')
    assert(Date.now() - debut < 3000, "le délai doit couper l'attente")
    const ferme = await web.executeWebOpenTool({ url: 'http://127.0.0.1:9/' }, { ...local, allowPort: () => true })
    assert(ferme.includes('could not be reached'), `port fermé → ${ferme}`)
    let leve = ''
    try {
      await web.executeWebOpenTool({ url: '   ' })
    } catch (e) {
      leve = e instanceof Error ? e.message : String(e)
    }
    equal(leve, 'url is required', "adresse absente : erreur d'arguments")
  })

  await check('une longue page vient en parties, sans être retéléchargée ; une trop grosse est coupée et le dit', async () => {
    web.clearWebOpenCache()
    const p1 = await open('/longue')
    const total = Number(/\(part 1 of (\d+) /.exec(p1)?.[1])
    assert(total >= 3, `nombre de parties : ${total}`)
    assert(p1.includes('Paragraphe 1.') && p1.endsWith(`(part 1 of ${total} — for the next one: web_open with "part": 2)`), 'première partie')
    const p2 = await open('/longue', { part: 2 })
    assert(p2.includes(`(part 2 of ${total}`) && !p2.includes('Paragraphe 1.'), 'deuxième partie')
    const fin = await open('/longue', { part: total })
    assert(fin.includes('fin 60.') && fin.endsWith(`(part ${total} of ${total} — end of the page)`), 'dernière partie')
    const trop = await open('/longue', { part: 99 })
    assert(trop.includes(`(the page has only ${total} parts: part ${total} is served)`), 'partie au-delà de la fin')
    equal(hits['/longue'], 1, 'téléchargements de la page')
    for (const [texte, quoi] of [[p1, 'partie 1'], [p2, 'partie 2']] as const) assert(texte.length < web.PART_CHARS + 300, `${quoi} trop longue : ${texte.length}`)
    const sansPartie = await open('/longue', { part: 'deux' })
    assert(sansPartie.includes('(part 1 of'), 'une partie illisible retombe sur la première')
    // Les liens suivent LEUR partie : celui du début n'est pas servi avec la fin, ni l'inverse.
    assert((await open('/longue', { part: 1, links: true })).endsWith(`1. lien du début — ${base}/debut`), 'liens de la première partie')
    assert((await open('/longue', { part: 2, links: true })).endsWith('No link in this part.'), 'pas de lien dans la deuxième partie')
    assert((await open('/longue', { part: total, links: true })).endsWith(`1. lien de la fin — ${base}/fin`), 'liens de la dernière partie')
    const beaucoup = await open('/liens', { links: true })
    assert(beaucoup.includes(`40. cible 40 — ${base}/cible/40`) && !beaucoup.includes('41. cible 41'), 'quarante liens au plus')
    assert(beaucoup.endsWith('(10 more links not listed)'), 'les liens non listés sont comptés')

    const grosse = await open('/grosse', { part: 99 }, { maxBytes: 20_000 })
    assert(grosse.includes('the page is very large: it was cut'), 'page coupée : dit')
    assert(!grosse.includes('FIN-DE-LA-GROSSE-PAGE'), 'la fin au-delà du plafond ne doit pas être lue')
  })

  await check('mémoire courte des pages : dix minutes, douze pages au plus', async () => {
    web.clearWebOpenCache()
    let t = 1_000_000
    const horloge = { now: (): number => t }
    await open('/n/0', {}, horloge)
    t += 9 * 60_000
    await open('/n/0', {}, horloge)
    equal(hits['/n/0'], 1, 'neuf minutes après : pas de nouveau téléchargement')
    t += 2 * 60_000
    await open('/n/0', {}, horloge)
    equal(hits['/n/0'], 2, 'onze minutes après la lecture : la page est relue')
    for (let i = 1; i <= 12; i++) await open(`/n/${i}`, {}, horloge)
    await open('/n/12', {}, horloge)
    equal(hits['/n/12'], 1, 'la page la plus récente est encore en mémoire')
    await open('/n/0', {}, horloge)
    equal(hits['/n/0'], 3, 'la plus ancienne a été oubliée pour faire place')
  })

  await check('mémoire courte des pages : bornée en taille, pas seulement en nombre', async () => {
    web.clearWebOpenCache()
    // Cinq pages d'un million neuf cent mille caractères : plus que le plafond de huit millions.
    for (let i = 0; i < 5; i++) await open(`/lourde/${i}`)
    await open('/lourde/4')
    equal(hits['/lourde/4'], 1, 'la dernière page lue est encore en mémoire')
    await open('/lourde/0')
    equal(hits['/lourde/0'], 2, 'la plus ancienne a été oubliée pour tenir dans le plafond')
    web.clearWebOpenCache()
  })

  await check('une page compressée qui gonfle sans fin : coupée, et le décompresseur arrêté avec la lecture', async () => {
    web.clearWebOpenCache()
    const out = await open('/bombe', {}, { maxBytes: 50_000 })
    assert(out.includes('no readable text') || out.includes('not a text page') || out.includes('very large'), `résultat : ${out.slice(0, 80)}`)
    // Tout décompresser prendrait près d'une demi-seconde de processeur. Arrêté avec la lecture, presque rien.
    const avant = process.cpuUsage()
    await sleep(600)
    const apres = process.cpuUsage(avant)
    const ms = (apres.user + apres.system) / 1000
    assert(ms < 200, `processeur encore occupé après la réponse : ${Math.round(ms)} ms`)
  })

  await check('langue demandée aux sites : celle de la machine, sans sa région', async () => {
    equal(web.acceptLanguage('fr-BE'), 'fr,en;q=0.7', 'français de Belgique')
    equal(web.acceptLanguage('ja'), 'ja,en;q=0.7', 'japonais')
    equal(web.acceptLanguage('en-US'), 'en', 'anglais')
    equal(web.acceptLanguage('C'), 'en', 'locale illisible')
    equal(web.acceptLanguage(''), 'en', 'locale vide')
    web.clearWebOpenCache()
    assert((await open('/langue')).includes(`Langue demandée : ${web.acceptLanguage()}`), "l'en-tête envoyé")
  })

  await check("habillage jamais refermé : la page n'est pas rendue vide", async () => {
    web.clearWebOpenCache()
    assert((await open('/nav-ouverte')).includes('Tout le texte de la page'), 'repli sans retrait de l\'habillage')
  })

  console.log('\nConversion')

  await check('HTML → texte : blancs, balises en ligne, sauts, listes vides, entités, CDATA', () => {
    const t = (html: string): string => web.htmlToText(html, 'https://example.org/').text
    equal(t('<p>  un   deux\n trois  </p>'), 'un deux trois', 'blancs repliés')
    equal(t('bon<b>jour</b> le <i>monde</i>!'), 'bonjour le monde!', 'une balise en ligne ne crée pas de blanc')
    equal(t('a<br>b<br><br>c<br><br><br>d'), 'a\nb\n\nc\n\nd', 'sauts de ligne')
    equal(t('<div>a</div><div>b</div><p>c</p><p>d</p>'), 'a\nb\n\nc\n\nd', 'blocs')
    equal(t('<ul><li></li><li>x</li></ul><p>après</p>'), '- x\n\naprès', 'une puce vide ne laisse pas sa marque')
    equal(t('<ul><li>x</li><li></li></ul><p>après</p>'), '- x\n\naprès', 'une DERNIÈRE puce vide ne marque pas le paragraphe suivant')
    equal(t('<h3></h3><p>texte</p>'), 'texte', 'un titre vide ne laisse pas sa marque')
    equal(t('<h1>Un</h1><h2>Deux</h2><h6>Six</h6>'), '# Un\n\n## Deux\n\n###### Six', 'niveaux de titres')
    equal(t('&lt;b&gt; &amp;amp; &#x1F600; &eacute;&Eacute;&rsquo;&#233;&#xE9;'), '<b> &amp; 😀 éÉ’éé', 'entités nommées et numériques')
    equal(t('a&#0;b&#xD800;c&#99999999;d&#x110000;e'), 'abcde', 'un code hors d\'Unicode ne produit rien')
    equal(t('<![CDATA[brut &amp; <tel> quel]]> fin'), 'brut &amp; <tel> quel fin', 'CDATA : ni balise ni entité, du texte tel quel')
    equal(t('<p>a</p><style>p { color: red }</style><p>b</p>'), 'a\n\nb', 'une feuille de style dans le corps')
    equal(t('1 < 2 et 3 > 2, 4 <= 5'), '1 < 2 et 3 > 2, 4 <= 5', 'un chevron du texte reste du texte')
    equal(t("<p title=it's>texte</p><p>suite</p>"), 'texte\n\nsuite', "une apostrophe hors d'une valeur n'ouvre rien")
    equal(t('<p>avant</p><a href="jamais refermé <p>perdu</p>'), 'avant', 'balise jamais refermée : la fin du document part avec elle')
    equal(t('<p>avant</p><!-- jamais refermé <p>perdu</p>'), 'avant', 'commentaire jamais refermé')
    equal(t('<!-- caché > encore <b>caché</b> --><p>vu</p><!doctype html><?xml version="1.0"?>'), 'vu', 'commentaires et déclarations')
    equal(t('<p>a</p><svg><text>DESSIN</text></svg><noscript>SANS-JS</noscript><template>GABARIT</template><p>b</p>'), 'a\n\nb', 'éléments sans texte à lire')
    equal(t('<script>if (a < b && c > d) { x = "</p>" }</script><p>après le script</p>'), 'après le script', 'un script contient des chevrons')
    equal(t('<p>avant</p><script>jamais refermé <p>perdu</p>'), 'avant', 'script jamais refermé : la suite est ignorée')
    equal(t('<a title="a > b" href="/x">lien</a> suite'), 'lien suite', 'un chevron dans un attribut')
    equal(web.decodeEntities('&nbsp;&copy;&unknownentity;&amp'), ' ©&unknownentity;&amp', 'entité inconnue ou inachevée gardée')
  })

  await check("HTML → texte : l'en-tête et le pied d'un article restent, ceux du site partent", () => {
    const html =
      '<header>SITE</header><article><header><h1>Titre</h1></header><p>Corps</p><footer>Auteur</footer></article>' +
      '<nav><article><header>DANS-LE-MENU</header></article></nav><footer>PIED</footer><p>Reste</p>'
    equal(web.htmlToText(html, 'https://example.org/').text, '# Titre\n\nCorps\n\nAuteur\n\nReste', 'avec retrait')
    assert(web.htmlToText(html, 'https://example.org/', false).text.includes('SITE'), 'sans retrait, tout reste')
    // Imbrication fautive : l'en-tête du site se referme APRÈS l'ouverture de l'article. Le retrait doit s'arrêter là.
    const croise = web.htmlToText('<header>SITE<article></header><p>Corps du texte</p></article><p>Suite</p>', 'https://example.org/').text
    equal(croise, 'Corps du texte\n\nSuite', "un en-tête refermé de travers n'emporte pas le reste de la page")
  })

  await check('titre de la page : le premier, entités décodées, borné', () => {
    const titre = (html: string): string => web.htmlToText(html, 'https://example.org/').title
    equal(titre('<html><head><title>  Un &amp;\n deux </title></head><body><title>Autre</title><p>x</p></body></html>'), 'Un & deux', 'premier titre')
    equal(titre('<p>sans titre</p>'), '', 'pas de titre')
    equal(titre('<svg><title>Dessin</title></svg><p>x</p>'), '', "le titre d'un dessin n'est pas celui de la page")
    equal(titre('<title>' + 'long '.repeat(500)).length, 200, 'titre jamais refermé : borné')
    equal(web.htmlToText('<title>T</title><p>corps</p>', 'https://example.org/').text, 'corps', "le titre n'entre pas dans le texte")
  })

  await check('pages fabriquées pour faire tourner le serveur à vide : lues en temps borné', () => {
    // Chacune ferait reprendre sa recherche à chaque « < » à une lecture naïve. En une
    // seule passe, deux mégaoctets se lisent en une fraction de seconde.
    const hostiles: [string, string][] = [
      ['balises jamais refermées', '<a '.repeat(600_000)],
      ['guillemets jamais refermés', '<a href="'.repeat(200_000)],
      ['chevrons seuls', '<'.repeat(2_000_000)],
      ['titres jamais refermés', '<title>'.repeat(250_000)],
      ['commentaires jamais refermés', '<!--'.repeat(400_000)],
      ['scripts jamais refermés', '<script>'.repeat(200_000)],
      ['fermetures sans fin', '</script '.repeat(200_000)],
      ['menus imbriqués', '<nav>'.repeat(300_000)],
      ['entités à la chaîne', '&'.repeat(1_000_000) + '&#'.repeat(400_000)],
      ['petites balises', '<b>x</b> '.repeat(200_000)],
      ['liens à la chaîne', '<a href="/x">y</a> '.repeat(80_000)],
      ['blancs', ' \n\t'.repeat(600_000) + '<p>fin</p>'],
    ]
    for (const [quoi, html] of hostiles) {
      const debut = Date.now()
      web.htmlToText(html, 'https://example.org/')
      web.htmlToText(html, 'https://example.org/', false)
      const ms = Date.now() - debut
      assert(ms < 4000, `${quoi} : ${ms} ms pour ${html.length} caractères`)
    }
  })

  await check('<base href> : les liens relatifs se résolvent contre lui', () => {
    const page = web.htmlToText('<head><base href="https://autre.example/dossier/"></head><p><a href="page">lien</a></p>', 'https://example.org/a/')
    equal(page.links[0]?.url, 'https://autre.example/dossier/page', 'adresse résolue')
    const sans = web.htmlToText('<head><base href="javascript:alert(1)"></head><p><a href="page">lien</a></p>', 'https://example.org/a/')
    equal(sans.links[0]?.url, 'https://example.org/a/page', "un <base> d'un autre schéma est ignoré")
  })

  await check('ce qu\'une page fait construire est borné : adresses, nombre de liens', () => {
    // Un <base> démesuré ferait de chaque lien relatif une adresse démesurée : il est ignoré.
    const grosBase = web.htmlToText(`<base href="http://x.example/${'a'.repeat(100_000)}/">` + '<a href=b>c</a> '.repeat(50), 'https://example.org/p/')
    equal(grosBase.links.length, 50, 'liens gardés')
    for (const l of grosBase.links) equal(l.url, 'https://example.org/p/b', "résolus contre l'adresse de la page")
    // Des dizaines de milliers de liens : le texte reste, les liens s'arrêtent au plafond.
    const foule = web.htmlToText('<a href=b>c</a> '.repeat(60_000), 'https://example.org/p/')
    equal(foule.links.length, web.LINKS_PER_PAGE, 'liens gardés')
    assert(foule.text.length > 100_000, 'le texte de tous les liens est gardé')
    // Une adresse trop longue, écrite telle quelle ou une fois résolue : le texte reste, sans lien.
    const long = web.htmlToText(`<a href="/${'x'.repeat(3000)}">long</a> <a href="court">court</a>`, 'https://example.org/')
    equal(long.links.map((l) => l.text).join(','), 'court', 'lien trop long écarté')
    assert(long.text.includes('long court'), 'son texte reste')
    const resolu = web.htmlToText('<a href="b">c</a>', `https://example.org/${'a'.repeat(2040)}/`)
    equal(resolu.links.length, 0, 'lien trop long une fois résolu')
    const bavard = web.htmlToText(`<a href="/x">${'mot '.repeat(1000)}</a>`, 'https://example.org/')
    assert(bavard.links[0].text.length <= 125, `texte du lien borné : ${bavard.links[0].text.length}`)
  })

  await check('liens : repérés à leur place dans le texte', () => {
    const page = web.htmlToText('<p>Voir <a href="b/c?d=1">la <b>suite</b> ici</a> et <a href="//autre.example/x">là</a>.</p><a href="/vide"></a>', 'https://example.org/a/')
    equal(page.links.length, 2, 'liens')
    equal(page.links[0].url, 'https://example.org/a/b/c?d=1', 'adresse relative résolue')
    equal(page.links[1].url, 'https://autre.example/x', 'adresse sans schéma résolue')
    equal(page.links[0].text, 'la suite ici', 'texte du lien')
    for (const l of page.links) assert(page.text.slice(l.at).startsWith(l.text.split(' ')[0]), `position du lien « ${l.text} »`)
  })

  await check('découpage : aucune partie trop longue, coupes entre paragraphes, rien de perdu', () => {
    const texte = Array.from({ length: 40 }, (_, i) => `Paragraphe ${i} ${'x'.repeat(300)}`).join('\n\n')
    const parts = web.splitParts(texte, 1000)
    assert(parts.length > 10, `parties : ${parts.length}`)
    for (const [a, b] of parts) {
      assert(b - a <= 1000 && b > a, `partie de ${b - a} caractères`)
      assert(texte.slice(a, b).startsWith('Paragraphe'), 'une partie commence sur un paragraphe')
    }
    equal(parts.map(([a, b]) => texte.slice(a, b)).join('').replace(/\s/g, ''), texte.replace(/\s/g, ''), 'tout le texte est servi')
    equal(web.splitParts('court', 1000).length, 1, 'un texte court tient en une partie')
    // Des paragraphes de plusieurs LIGNES : la coupe préfère la ligne vide à un simple saut de ligne.
    const lignes = Array.from({ length: 30 }, (_, i) => `Paragraphe ${i}\n${'ligne a '.repeat(12)}\n${'ligne b '.repeat(12)}`).join('\n\n')
    for (const [a] of web.splitParts(lignes, 700)) assert(lignes.slice(a).startsWith('Paragraphe'), 'coupe entre deux paragraphes, pas entre deux lignes')
    const bloc = web.splitParts('y'.repeat(2500), 1000)
    equal(bloc.map(([a, b]) => b - a).join(','), '1000,1000,500', 'un bloc sans espace est coupé net')
  })

  console.log('\nBranchement')

  const { saveSettings, loadSettings } = await import('../server/config')
  const storage = await import('../server/lib/storage')
  const { buildPayload, runToolLoop, toolNamesOf } = await import('../server/api/chat')
  const { createMemorySession } = await import('../server/tools/memoryTools')

  await check("l'outil n'est offert au modèle que si le réglage l'allume, et il est éteint par défaut", () => {
    equal(loadSettings().webOpenEnabled, false, 'réglage par défaut')
    const character = storage.createCharacter({ name: 'Jetable', systemPrompt: "Tu es un personnage d'essai." })
    const chat = storage.createChat(character.id, 'essai')
    const offered = (): boolean => toolNamesOf(buildPayload(character.id, chat.id, loadSettings()).payload.tools).has('web_open')
    assert(!offered(), 'éteint : outil absent')
    saveSettings({ webOpenEnabled: true })
    assert(offered(), 'allumé : outil offert')
    saveSettings({ modelMode: 'simple' })
    assert(!offered(), 'mode simple : aucun outil')
    saveSettings({ modelMode: 'full', webOpenEnabled: false })
  })

  await check('réglage éteint : un appel de web_open est refusé, rien ne part', async () => {
    web.clearWebOpenCache()
    const avant = hits['/page'] ?? 0
    const tour = async (): Promise<string> => {
      const messages: unknown[] = []
      let n = 0
      await runToolLoop('jetable', loadSettings(), messages, 2, new Set(['web_open']), createMemorySession(), async () => ({
        content: '',
        toolCalls: n++ === 0 ? [{ id: 'c1', name: 'web_open', arguments: JSON.stringify({ url: `http://127.0.0.1:${port}/page` }) }] : [],
      }))
      return String((messages.find((m) => (m as { role?: string }).role === 'tool') as { content?: string } | undefined)?.content)
    }
    equal(await tour(), 'Error: web page reading is disabled in settings', 'éteint')
    saveSettings({ webOpenEnabled: true })
    // Allumé, c'est la VRAIE garde qui répond : le serveur d'ici est sur la boucle locale.
    assert((await tour()).includes('local or private network address'), 'allumé : la garde de production tient')
    saveSettings({ webOpenEnabled: false })
    equal(hits['/page'] ?? 0, avant, 'aucune requête partie')
  })
}

main()
  .catch((e) => {
    failures.push(`erreur hors test — ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
  })
  .finally(() => {
    server.closeAllConnections()
    server.close()
    // Chemins garantis ASCII (dossier temporaire, « Jetable ») : rmSync y est sûr.
    fs.rmSync(TMP, { recursive: true, force: true })
    console.log(`\n${passed} réussis, ${failures.length} en échec`)
    for (const f of failures) console.log('  - ' + f)
    process.exit(failures.length ? 1 : 0)
  })
