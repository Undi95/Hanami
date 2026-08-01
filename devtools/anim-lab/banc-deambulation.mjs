// ════════════════════════════════════════════════════════════════════════════
// banc-deambulation.mjs — LA SCÈNE VIVANTE, DÉROULÉE SOUS NODE.
//
// `wander.ts` est PUR : aucun `three`, aucun DOM, rien que des nombres à
// travers le contrat `WanderHost`. On peut donc le faire tourner tel quel, sans
// navigateur, et lui poser les questions qui comptent :
//
//   • les INVARIANTS de scène : la hauteur du groupe reste-t-elle sur le sol ?
//     combien d'images le personnage passe-t-il SOUS le sol (attendu : zéro) ?
//   • les CONTRATS DE PHASE de vrma/world.json : chaque entrée de cycle et
//     chaque atterrissage se fait-il à la phase du contrat, et à aucune autre ?
//   • l'EMPREINTE : ce que le personnage fait d'une demi-heure — combien de
//     trajets, de pivots, d'assises, combien de mètres, et le temps passé dans
//     les fondus. C'est ce chiffre-là que les durées d'Overte déplacent.
//
// Le décor est SYNTHÉTIQUE et fixe (pièce rectangulaire, deux assises, sol
// plat) : ce banc mesure le comportement, pas l'analyse d'un .glb. Le tirage
// aléatoire est GRAINÉ, donc l'empreinte est rejouable à l'identique.
//
// Lecture seule : client/src/scene/{wander,fades}.ts et vrma/world.json.
//
//   node banc-deambulation.mjs [--minutes=30] [--graine=12345] [--v]
// ════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { register } from 'node:module'

// wander.ts importe `./fades` SANS extension (règle TypeScript) ; node ESM en
// veut une. Un crochet de résolution la rajoute — le banc mesure ainsi le
// FICHIER DE L'APPLICATION, pas une copie.
register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) } catch (e) {
    if (spec.startsWith('.')) { try { return await next(spec + '.ts', ctx) } catch {} }
    throw e
  }
}`),
)

const LAB = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.slice(1))))
const PROJET = process.env.HANAMI_ROOT || path.resolve(LAB, '..', '..')
const { createWander } = await import(pathToFileURL(path.join(PROJET, 'client/src/scene/wander.ts')).href)
const WORLD = JSON.parse(fs.readFileSync(path.join(PROJET, 'vrma/world.json'), 'utf8'))

const args = new Map()
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  if (m) args.set(m[1], m[2] ?? '1')
}
const MINUTES = Number(args.get('minutes') ?? 30)
const GRAINE = Number(args.get('graine') ?? 12345)
const DT = 1 / 60

// Tirage GRAINÉ : wander tire ses attentes et ses variantes avec Math.random.
let etat = GRAINE >>> 0
Math.random = () => {
  etat = (etat * 1664525 + 1013904223) >>> 0
  return etat / 4294967296
}

// ── Le décor synthétique ────────────────────────────────────────────────────
const HANCHES = WORLD.rigDeMesure.hanchesAuReposM // 1,0167 m : les mètres de world.json
const PIECE = { x0: -3, x1: 3, z0: -2.5, z1: 2.5 }
const SOL = 0
const HANCHES_ASSISES = WORLD.postureAssiseCanonique.hanchesFraction // 0,5409
// DEUX HAUTEURS DIFFÉRENTES, volontairement : une assise basse et une haute.
// À la hauteur « canonique » (0,45 m sur ce rig) le groupe reste pile au niveau
// du sol et l'invariant ne prouve rien — il faut que le bassin ait à monter et
// à descendre pour que la vérification ait un sens.
/** Écart bassin ↔ nappe, en mètres (SEAT_GAP_FRAC de wander.ts, sur ce rig). */
const SEAT_GAP_M = 0.1
const ASSISE_BASSE = 0.34
const ASSISE_HAUTE = 0.58
// Deux assises au format de `sceneMap.Seat` : une chaise et une banquette (la
// grande nappe, celle où le bassin se pose au BORD et non au centre).
const ASSISES = [
  {
    id: 'chaise', y: ASSISE_HAUTE, center: [2.2, 1.8], yaw: 270, area: 0.25,
    approach: [1.6, 1.8], bounds: [1.95, 1.55, 2.45, 2.05],
  },
  {
    id: 'banquette', y: ASSISE_BASSE, center: [-2.2, -1.6], yaw: 90, area: 0.84,
    approach: [-1.5, -1.6], bounds: [-2.5, -2.1, -1.9, -1.1],
  },
]
const dansPiece = (x, z, r = 0) => x - r >= PIECE.x0 && x + r <= PIECE.x1 && z - r >= PIECE.z0 && z + r <= PIECE.z1

// ── Les clips, tels que vrma/world.json les décrit ──────────────────────────
const clip = (nom) => WORLD.clips['world-' + nom] ?? null
const duree = (nom) => clip(nom)?.dureeS ?? 0
const vitesse = (nom) => clip(nom)?.deplacement?.vitesseMS ?? 0
// `world-walk-start` ne déclare pas de vitesse de cycle : sa distance est
// mesurée dans wander.ts (STRIDE_START, 0,392 fraction de hanches).
const VITESSE_DEPART = (0.392 * HANCHES) / Math.max(0.001, duree('walk-start'))

// ── L'hôte ──────────────────────────────────────────────────────────────────
const evts = []
const journal = []
let p = { x: 0, y: SOL, z: 0, yaw: 0, ground: SOL }
let gaitNom = null
let gaitT = 0
let once = null // { nom, t, then, thenPhase }
let mode = 'planted'
let t = 0

// Un fondu est un { s, ease } depuis la table d'Overte ; avant elle, c'était un
// nombre de secondes. Le banc accepte les deux, pour pouvoir mesurer un ANCIEN
// arbre (HANAMI_ROOT=<worktree>) et comparer les empreintes.
const secondes = (f) => (typeof f === 'number' ? f : (f?.s ?? 0))
const adouci = (f) => (typeof f === 'number' ? false : Boolean(f?.ease))

const host = {
  hips: () => HANCHES,
  place(x, y, z, yaw, ground) {
    p = { x, y, z, yaw, ground }
  },
  gait(nom, fade, phase) {
    evts.push({ t, quoi: 'gait', nom, fondu: secondes(fade), ease: adouci(fade), phase })
    gaitNom = nom
    gaitT = phase ?? gaitT
  },
  gaitTime: () => (gaitNom ? gaitT : -1),
  once(nom, fadeIn, then, fadeThen, thenPhase) {
    evts.push({ t, quoi: 'once', nom, fondu: secondes(fadeIn), ease: adouci(fadeIn), then, fonduThen: secondes(fadeThen), thenPhase })
    gaitNom = null
    once = { nom, t: 0, then, thenPhase }
  },
  has: (nom) => clip(nom) !== null,
  stride(out) {
    // La foulée est LUE sur l'animation. Ici on la reconstitue depuis
    // world.json : c'est la même grandeur, à la précision du tableau près.
    const v = once ? (once.nom === 'walk-start' ? VITESSE_DEPART : 0) : gaitNom ? vitesse(gaitNom) : 0
    out.x = 0
    out.z = v * DT
    return v > 0
  },
  speaking: () => false,
  camYaw: (x, z) => Math.atan2(0 - x, -4 - z), // caméra fixe devant la pièce
  userBusy: () => false,
  floorAt: (x, z) => (dansPiece(x, z) ? SOL : null),
  canStand: (x, z, r) => dansPiece(x, z, r),
  path: () => null, // pièce vide : la ligne droite passe toujours
  bodyRadius: () => 0.25,
  transitioning: () => once !== null,
  onceProgress: () => (once ? Math.min(1, once.t / Math.max(0.001, duree(once.nom))) : 1),
  interrupt() {
    once = null
  },
  feet(m) {
    mode = m
  },
  seats: () => ASSISES,
  mapped: () => true,
}

// ── Déroulé ─────────────────────────────────────────────────────────────────
const w = createWander(host)
let solViole = 0
let pireSousSol = 0
let yMin = Infinity
let yMax = -Infinity
let yAssisMin = Infinity
let yAssisMax = -Infinity
let bassinViole = 0
let pireBassin = 0
let mDebout = 0
let mAssis = 0
let distance = 0
let prev = { x: 0, z: 0 }
const IMAGES = Math.round(MINUTES * 60 * 60)

for (let i = 0; i < IMAGES; i++) {
  // Le clip à cycle unique s'achève : c'est l'événement 'finished' de vrmStage.
  if (once) {
    once.t += DT
    if (once.t >= duree(once.nom)) {
      const suite = once
      once = null
      gaitNom = suite.then
      gaitT = suite.thenPhase ?? 0
    }
  } else if (gaitNom) {
    // Un socle d'allure BOUCLE : son temps repasse par zéro à chaque cycle, et
    // c'est ce retour en arrière que wander guette pour sortir sur la couture.
    // Sans le modulo, la couture n'arrive jamais et le personnage marche sans
    // fin — c'est le premier piège de ce banc.
    const d = duree(gaitNom)
    gaitT = d > 0 ? (gaitT + DT) % d : gaitT + DT
  }
  w.update(DT)
  t += DT

  const assis = w.seated()
  // DEUX invariants, un par régime.
  // DEBOUT (et hors transition d'assise) : le groupe est EXACTEMENT sur le sol
  // qui le porte. Une seule image en dessous et le personnage traverse.
  // ASSIS : le BASSIN est exactement sur la nappe de l'assise — c'est le même
  // contrat, vu de l'autre bout (`seatedY` de wander.ts).
  if (!assis && !host.transitioning() && mode === 'planted') {
    const ecart = p.ground - p.y
    if (ecart > 1e-6) {
      solViole++
      pireSousSol = Math.max(pireSousSol, ecart)
    }
    yMin = Math.min(yMin, p.y)
    yMax = Math.max(yMax, p.y)
  }
  if (assis && !host.transitioning()) {
    // Le bassin d'un corps assis se tient ~10 cm AU-DESSUS de la nappe : c'est
    // la convention de vrma/world.json (postureAssiseCanonique) que `seatedY`
    // applique. On vérifie donc le bassin contre `assise + 10 cm`.
    const bassin = p.y + HANCHES_ASSISES * HANCHES
    const cible = ASSISES.map((s) => Math.abs(bassin - (s.y + SEAT_GAP_M))).sort((a, b) => a - b)[0]
    if (cible > 1e-3) {
      bassinViole++
      pireBassin = Math.max(pireBassin, cible)
    }
    yAssisMin = Math.min(yAssisMin, p.y)
    yAssisMax = Math.max(yAssisMax, p.y)
  }
  if (assis) mAssis++
  else mDebout++
  distance += Math.hypot(p.x - prev.x, p.z - prev.z)
  prev = { x: p.x, z: p.z }
  if (i % 60 === 0) journal.push({ t: +t.toFixed(1), x: +p.x.toFixed(3), z: +p.z.toFixed(3), y: +p.y.toFixed(3), assis })
}

// ── Les contrats de phase de vrma/world.json ────────────────────────────────
// wander.ts pose une PHASE à l'entrée de chaque cycle. Ce sont les seules
// valeurs admises — les fondus n'y touchent pas, et ce banc le prouve.
const CONTRATS = {
  walk: [0.2], // depuisWorldWalkStart : image 6, t = 0,200 s
  'walk-slow': [0], // depuisIdle : image 0
  'turn-left': [0.167],
  'turn-right': [0.033],
  'sit-idle': [0], // l'atterrissage d'assise
}
let phasesKo = 0
const phasesVues = new Map()
for (const e of evts) {
  const cible = e.quoi === 'once' ? e.then : e.nom
  const phase = e.quoi === 'once' ? e.thenPhase : e.phase
  if (!cible || !(cible in CONTRATS)) continue
  const cle = `${cible}@${phase ?? 0}`
  phasesVues.set(cle, (phasesVues.get(cle) ?? 0) + 1)
  if (!CONTRATS[cible].some((v) => Math.abs(v - (phase ?? 0)) < 1e-6)) phasesKo++
}

// ── Rapport ─────────────────────────────────────────────────────────────────
const compte = (pred) => evts.filter(pred).length
const parClip = new Map()
for (const e of evts) {
  const k = `${e.quoi}:${e.nom ?? '—'}`
  parClip.set(k, (parClip.get(k) ?? 0) + 1)
}
const fonduTotal = evts.reduce((s, e) => s + e.fondu + (e.fonduThen ?? 0), 0)
const fondusAdoucis = evts.filter((e) => e.ease).length

console.log(`\n══ EMPREINTE DE DÉAMBULATION — ${MINUTES} min simulées, graine ${GRAINE}`)
console.log(`   pièce ${PIECE.x1 - PIECE.x0} × ${PIECE.z1 - PIECE.z0} m, ${ASSISES.length} assises, sol plat à ${SOL} m, hanches ${HANCHES} m`)
console.log('\n── invariants de scène ──')
console.log(`  images hors sol (debout)     ${solViole}${solViole ? ` (pire ${(pireSousSol * 100).toFixed(1)} cm)` : '  ✓'}`)
console.log(`  hauteur du groupe, debout    ${yMin.toFixed(3)} … ${yMax.toFixed(3)} m  (sol ${SOL})`)
console.log(`  hauteur du groupe, assis     ${(isFinite(yAssisMin) ? yAssisMin : 0).toFixed(3)} … ${(isFinite(yAssisMax) ? yAssisMax : 0).toFixed(3)} m ` +
  `(assises à ${ASSISE_BASSE} et ${ASSISE_HAUTE} m)`)
console.log(`  bassin hors de la nappe      ${bassinViole}${bassinViole ? ` (pire ${(pireBassin * 100).toFixed(1)} cm)` : '  ✓'}`)
console.log(`  temps debout / assis         ${((mDebout / IMAGES) * 100).toFixed(1)} % / ${((mAssis / IMAGES) * 100).toFixed(1)} %`)
console.log(`  régime des pieds en fin      ${mode}`)
console.log('\n── contrats de phase (vrma/world.json) ──')
for (const [cle, n] of [...phasesVues].sort()) console.log(`  ${cle.padEnd(22)} ${String(n).padStart(4)} fois`)
console.log(`  hors contrat                 ${phasesKo}${phasesKo ? '  ✗' : '  ✓'}`)
console.log('\n── empreinte ──')
console.log(`  distance parcourue           ${distance.toFixed(1)} m`)
console.log(`  socles posés (gait)          ${compte((e) => e.quoi === 'gait')}`)
console.log(`  transitions (once)           ${compte((e) => e.quoi === 'once')}`)
console.log(`  temps CUMULÉ en fondu        ${fonduTotal.toFixed(1)} s sur ${(MINUTES * 60).toFixed(0)} s ` +
  `(${((fonduTotal / (MINUTES * 60)) * 100).toFixed(1)} %)`)
console.log(`  fondus adoucis               ${fondusAdoucis} / ${evts.length}`)
for (const [k, n] of [...parClip].sort()) console.log(`    ${k.padEnd(26)} ${String(n).padStart(4)}`)
if (args.has('v')) {
  console.log('\n── journal (1 point/s, 40 premiers) ──')
  for (const j of journal.slice(0, 40)) console.log(`  t=${String(j.t).padStart(6)}  (${j.x}, ${j.z}) y=${j.y}${j.assis ? ' assis' : ''}`)
}
const ko = solViole + bassinViole + phasesKo
console.log(`\n${ko === 0 ? 'invariants tenus, contrats de phase intacts.' : `${ko} anomalie(s).`}`)
process.exit(ko === 0 ? 0 : 1)
