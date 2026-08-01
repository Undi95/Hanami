// ════════════════════════════════════════════════════════════════════════════
// verif-catalogue.mjs — LES CLEFS DÉCLARÉES ONT-ELLES DES FICHIERS ?
//
//   node devtools/anim-lab/verif-catalogue.mjs
//
// Le banc juge des CLIPS ; celui-ci juge le CÂBLAGE, la question qui a déjà
// coûté un correctif dormant (5fdb9a4 : `world-walk-stop-small` était choisi
// par wander.ts mais absent de WORLD_NEEDED, donc jamais téléchargé, donc
// `has()` rendait false et le choix retombait en silence sur l'arrêt d'avant).
// Une clef déclarée sans fichier, ou une clef de table jamais déclarée, ne
// produit aucune erreur à l'écran : elle produit un personnage qui ne fait
// simplement rien.
//
// AUCUNE VALEUR N'EST RECOPIÉE : la liste des .vrma vient de
// /api/vrm-animations (ce que la page voit ; à défaut, le disque), et
// WORLD_NEEDED, SIT_EMOTES, SIT_REACTIONS sont RELUS DANS LE SOURCE. Ce qui
// est recopié, et c'est la limite de ce fichier, c'est la GRAMMAIRE du
// catalogue (`catalogFromUrls` de vrmStage.ts) : vrmStage importe three et
// touche au DOM, il ne s'importe pas sous node. Toute retouche de cette
// grammaire — l'ordre des tests, le retrait du suffixe de variante — doit être
// reportée ici, sinon ce banc mesure un catalogue qui n'existe plus.
//
// Lecture seule. Aucune écriture, aucune dépendance.
// ════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import path from 'node:path'

const LAB = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.slice(1))))
const RACINE = process.env.HANAMI_ROOT || path.resolve(LAB, '..', '..')
const SCENE = path.join(RACINE, 'client', 'src', 'scene')
const SRC_STAGE = fs.readFileSync(path.join(SCENE, 'vrmStage.ts'), 'utf8')
const SRC_WANDER = fs.readFileSync(path.join(SCENE, 'wander.ts'), 'utf8')

// ── Ce que le SOURCE déclare ────────────────────────────────────────────────

/** Les chaînes littérales d'un tableau du source, commentaires exclus. */
function listeSource(src, ancre) {
  const i = src.indexOf(ancre)
  if (i < 0) throw new Error(`ancre introuvable : ${ancre}`)
  // On part du `= [` de l'affectation : le `]` du TYPE (`readonly string[]`)
  // arrive avant celui du tableau et couperait la liste à zéro élément.
  const d = src.indexOf('= [', i) + 2
  const j = src.indexOf(']', d)
  // Les commentaires sont retirés AVANT la lecture : ils sont en français,
  // donc pleins d'apostrophes, et « l'arrêt COURT des coins d' » se lisait
  // comme une clef. Ce banc lit ce que le code DÉCLARE, pas ce qu'il raconte.
  const noms = [...src.slice(d, j).replace(/\/\/[^\n]*/g, '').matchAll(/'([^']+)'/g)].map((m) => m[1])
  if (noms.length === 0) throw new Error(`liste vide pour « ${ancre} » — la lecture du source a raté`)
  return noms
}

const WORLD_NEEDED = listeSource(SRC_STAGE, 'const WORLD_NEEDED')
const SIT_REACTIONS = listeSource(SRC_WANDER, 'const SIT_REACTIONS')
const iTable = SRC_WANDER.indexOf('const SIT_EMOTES')
if (iTable < 0) throw new Error('SIT_EMOTES introuvable dans wander.ts')
const SIT_EMOTES = Object.fromEntries(
  [...SRC_WANDER.slice(iTable, SRC_WANDER.indexOf('\n}', iTable)).matchAll(/^\s{2}(\w+): \[([^\]]+)\],/gm)]
    .map((m) => [m[1], [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])]),
)

// ── La grammaire du catalogue, recopiée de catalogFromUrls (cf. en-tête) ─────
const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'relaxed']
const TALKING_STEM = 'idle-talking'
const REACTION_STEM = 'nod'
const WORLD_PREFIX = 'world-'
const POSTURE_PREFIXES = ['pose-', 'sit-']

function catalogFromUrls(urls) {
  const cat = { idle: [], talking: [], gestures: new Map(), postures: new Map(), world: new Map(), reactions: [] }
  const push = (map, k, u) => { const l = map.get(k); if (l) l.push(u); else map.set(k, [u]) }
  for (const url of urls) {
    const file = decodeURIComponent(url.split('/').pop() ?? '')
    const stem = file.replace(/\.vrma$/i, '').toLowerCase().replace(/-\d+$/, '')
    if (stem === 'idle') cat.idle.push(url)
    else if (stem === TALKING_STEM) cat.talking.push(url)
    else if (stem === REACTION_STEM) cat.reactions.push(url)
    else if (EMOTIONS.includes(stem)) push(cat.gestures, stem, url)
    else if (stem.startsWith(WORLD_PREFIX) && stem.length > WORLD_PREFIX.length) {
      push(cat.world, stem.slice(WORLD_PREFIX.length), url)
    } else {
      const p = POSTURE_PREFIXES.find((q) => stem.startsWith(q) && stem.length > q.length)
      if (p) push(cat.postures, p === 'pose-' ? stem.slice(p.length) : stem, url)
    }
  }
  return cat
}

// ── La vraie liste ──────────────────────────────────────────────────────────
const PORT = process.env.HANAMI_PORT || 7788
let urls, source
try {
  const res = await fetch(`http://localhost:${PORT}/api/vrm-animations`, { signal: AbortSignal.timeout(4000) })
  urls = (await res.json()).animations
  source = `/api/vrm-animations (projet, port ${PORT})`
} catch (e) {
  const dir = path.join(RACINE, 'vrma')
  urls = fs.readdirSync(dir).filter((f) => /\.vrma$/i.test(f)).sort().map((f) => '/vrma/' + f)
  source = `disque ${dir} (API injoignable : ${e.message})`
}
const cat = catalogFromUrls(urls)
const octets = (u) => {
  try { return fs.statSync(path.join(RACINE, decodeURIComponent(u).replace(/^\//, ''))).size } catch { return 0 }
}

const p = (s, n) => String(s).padEnd(n)
const r = (s, n) => String(s).padStart(n)
let echecs = 0

console.log(`liste : ${source} — ${urls.length} fichiers`)
console.log(`WORLD_NEEDED relu dans le source : ${WORLD_NEEDED.length} clefs\n`)

const deTable = new Set([...Object.values(SIT_EMOTES).flat(), ...SIT_REACTIONS])
let total = 0, fichiers = 0
for (const clef of WORLD_NEEDED) {
  const f = cat.world.get(clef) ?? []
  const o = f.reduce((s, u) => s + octets(u), 0)
  total += o
  fichiers += f.length
  if (f.length === 0) { echecs++; console.log(`  ${p(clef, 16)} AUCUN FICHIER — clef morte`); continue }
  console.log(
    `  ${p(clef, 16)}${r(f.length, 2)} fichier(s)${r(Math.round(o / 1024), 6)} Ko  ` +
    f.map((u) => u.split('/').pop().replace(/\.vrma$/i, '')).join(', ') +
    (deTable.has(clef) ? '   ← table assise' : ''),
  )
}
console.log(`\n  total : ${WORLD_NEEDED.length} clefs, ${fichiers} fichiers, ${(total / 1024 / 1024).toFixed(2)} Mo`)

console.log('\n── tables assises de wander.ts (SIT_EMOTES / SIT_REACTIONS) ──')
for (const [role, pool] of [...Object.entries(SIT_EMOTES), ['@clic', SIT_REACTIONS]]) {
  const detail = pool.map((k) => {
    const n = cat.world.get(k)?.length ?? 0
    const declaree = WORLD_NEEDED.includes(k)
    if (!declaree || n === 0) echecs++
    return `${k}(${n}${declaree ? '' : ' NON DÉCLARÉE'}${n === 0 ? ' SANS FICHIER' : ''})`
  })
  const variantes = pool.reduce((s, k) => s + (cat.world.get(k)?.length ?? 0), 0)
  console.log(`  ${p(role, 10)}${r(pool.length, 2)} clef(s) / ${variantes} fichier(s) → ${detail.join(' · ')}`)
}

// Le mode éteint doit rester à l'octet près celui d'avant la scène vivante.
const worldUrlsNeeded = (on) => (on ? [...WORLD_NEEDED.flatMap((n) => cat.world.get(n) ?? []), ...cat.reactions] : [])
const eteint = worldUrlsNeeded(false).length
if (eteint !== 0) echecs++
console.log(`\n  mode éteint : ${eteint} fichier(s) — attendu 0`)
console.log(`  mode allumé : ${worldUrlsNeeded(true).length} fichier(s), dont ${cat.reactions.length} d'acquiescement debout`)

console.log(`\n${echecs === 0 ? '✓ aucune clef morte, aucune clef de table non déclarée' : `✗ ${echecs} problème(s)`}`)
process.exit(echecs === 0 ? 0 : 1)
