// ════════════════════════════════════════════════════════════════════════════
// banc-locomotion.mjs — LE TRAJET COMMANDÉ, CHRONOMÉTRÉ.
//
// `banc-deambulation.mjs` mesure ce que le personnage fait TOUT SEUL pendant une
// heure. Celui-ci mesure ce qu'il fait quand on lui DONNE UN ORDRE : un clic au
// sol, et deux questions que l'œil pose tout de suite —
//
//   • « il met combien de temps à démarrer ? » → temps CLIC → PREMIER PAS, pour
//     un écart de cap de 30, 90 et 180°. C'est la latence que l'utilisateur
//     ressent, et elle est presque entièrement faite de pivot sur place.
//   • « il met combien de temps à arriver ? » → temps de trajet complet pour 2,
//     5, 10 et 15 m, avec l'allure retenue et le nombre de bascules d'allure.
//
// Le décor est SYNTHÉTIQUE et VIDE (40 × 40 m, sol plat) : ce banc mesure la
// machine à états, pas l'analyse d'un .glb. Aucun tirage aléatoire n'intervient
// dans les trajets commandés — les chiffres sont donc exacts, pas moyennés.
//
// Lecture seule : client/src/scene/{wander,fades}.ts et vrma/world.json.
//
//   node banc-locomotion.mjs [--json=sortie.json]
// ════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { register } from 'node:module'

// Même crochet de résolution que banc-deambulation.mjs : wander.ts importe
// `./fades` sans extension, node ESM en veut une. Le banc mesure ainsi le
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
const DT = 1 / 60
const HANCHES = WORLD.rigDeMesure.hanchesAuReposM // 1,0167 m : les mètres de world.json

// ── Les clips, tels que vrma/world.json les décrit ──────────────────────────
const clip = (nom) => WORLD.clips['world-' + nom] ?? null
const duree = (nom) => clip(nom)?.dureeS ?? 0
/**
 * Vitesse dépeinte par une allure. `deplacement.vitesseMS` est le MILIEU de deux
 * estimateurs, dont `fourchetteMesureeMS` donne les bornes. Sur les allures de
 * VOL (jog, course), l'estimateur prudent ne compte que le recul du pied en
 * appui : les images où les deux pieds quittent le sol lui échappent, et le
 * milieu est alors sous-évalué. `--borne=haute` rejoue tout avec la borne
 * supérieure, pour montrer que le choix de seuils n'en dépend pas.
 */
const BORNE = args.get('borne') ?? 'milieu'
const vitesse = (nom) => {
  const d = clip(nom)?.deplacement
  if (!d) return 0
  if (BORNE === 'haute' && Array.isArray(d.fourchetteMesureeMS)) return Math.max(...d.fourchetteMesureeMS)
  if (BORNE === 'basse' && Array.isArray(d.fourchetteMesureeMS)) return Math.min(...d.fourchetteMesureeMS)
  return d.vitesseMS ?? 0
}
const VITESSE_DEPART = (0.392 * HANCHES) / Math.max(0.001, duree('walk-start'))

// ── Le couloir en L, pour les trajets À ÉTAPES ──────────────────────────────
// Une pièce vide ne produit jamais d'itinéraire : la ligne droite passe
// toujours, et `startRoute` n'appelle même pas `host.path`. Or c'est justement
// LÀ que l'allure se choisissait mal — un chemin long fait d'étapes courtes.
// Le couloir : une branche le long de +Z, un coude, une branche le long de +X.
const COULOIR = { demiLargeur: 0.9, longueurZ: 6, longueurX: 6 }
function dansCouloir(x, z, r = 0) {
  const w = COULOIR.demiLargeur - r
  if (w <= 0) return false
  // branche verticale (le long de +Z) puis branche horizontale (le long de +X)
  const brancheZ = Math.abs(x) <= w && z >= -w && z <= COULOIR.longueurZ + w
  const brancheX = Math.abs(z - COULOIR.longueurZ) <= w && x >= -w && x <= COULOIR.longueurX + w
  return brancheZ || brancheX
}
/** L'itinéraire que la recherche de chemin rendrait : le coude, puis l'arrivée. */
function cheminCouloir(fromX, fromZ, toX, toZ) {
  if (dansCouloir(toX, toZ)) return [{ x: 0, z: COULOIR.longueurZ }, { x: toX, z: toZ }]
  return null
}

// ── L'hôte ──────────────────────────────────────────────────────────────────
function creerBanc({ capRepos = 0, couloir = false } = {}) {
  const evts = []
  let p = { x: 0, y: 0, z: 0, yaw: 0, ground: 0 }
  let gaitNom = null
  let gaitT = 0
  let once = null
  let t = 0

  const host = {
    hips: () => HANCHES,
    place(x, y, z, yaw, ground) {
      p = { x, y, z, yaw, ground }
    },
    gait(nom, fade, phase) {
      evts.push({ t: +t.toFixed(4), quoi: 'gait', nom, phase })
      gaitNom = nom
      gaitT = phase ?? gaitT
    },
    gaitTime: () => (gaitNom ? gaitT : -1),
    once(nom, fadeIn, then, fadeThen, thenPhase) {
      evts.push({ t: +t.toFixed(4), quoi: 'once', nom, then, thenPhase })
      gaitNom = null
      once = { nom, t: 0, then, thenPhase }
    },
    has: (nom) => clip(nom) !== null,
    stride(out) {
      const v = once ? (once.nom === 'walk-start' ? VITESSE_DEPART : 0) : gaitNom ? vitesse(gaitNom) : 0
      out.x = 0
      out.z = v * DT
      return v > 0
    },
    speaking: () => false,
    // Le cap de repos est FIXE et vaut le cap initial : sans ça, le personnage
    // se recale face à la caméra avant même d'avoir reçu l'ordre, et le
    // chronomètre mesurerait ce pivot-là.
    camYaw: () => capRepos,
    userBusy: () => false,
    floorAt: (x, z) => (couloir && !dansCouloir(x, z) ? null : 0),
    canStand: (x, z, r) => (couloir ? dansCouloir(x, z, r) : true),
    path: (fx, fz, tx, tz) => (couloir ? cheminCouloir(fx, fz, tx, tz) : null),
    bodyRadius: () => 0.25,
    transitioning: () => once !== null,
    onceProgress: () => (once ? Math.min(1, once.t / Math.max(0.001, duree(once.nom))) : 1),
    interrupt() {
      once = null
    },
    feet: () => {},
    seats: () => [],
    mapped: () => true,
  }

  const w = createWander(host)

  /** Une image : horloge des clips d'abord (c'est vrmStage), puis la décision. */
  function image() {
    if (once) {
      once.t += DT
      if (once.t >= duree(once.nom)) {
        const suite = once
        once = null
        gaitNom = suite.then
        gaitT = suite.thenPhase ?? 0
      }
    } else if (gaitNom) {
      const d = duree(gaitNom)
      gaitT = d > 0 ? (gaitT + DT) % d : gaitT + DT
    }
    w.update(DT)
    t += DT
  }

  return { host, w, image, evts, pose: () => p, temps: () => t, poserCap: (yaw) => { p.yaw = yaw } }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. CLIC → PREMIER PAS, par écart de cap
// ════════════════════════════════════════════════════════════════════════════
/**
 * Le personnage est au repos, cap 0. On clique un point situé à `angleDeg` de
 * son cap, à 6 m (assez loin pour que l'allure ne soit jamais le facteur
 * limitant). On chronomètre :
 *   - `premierPasS` : premier instant où le corps AVANCE (le pied part) ;
 *   - `pivotS`      : temps passé en pivot sur place avant ça ;
 *   - `capAuDepart` : combien de degrés restaient à tourner quand il est parti
 *     (0 = il a fini son pivot avant de bouger, > 0 = il finit en marchant).
 */
function clicVersPremierPas(angleDeg, distance = 6) {
  const b = creerBanc({ capRepos: 0 })
  b.image() // une image de repos : l'état est stable
  const a = (angleDeg * Math.PI) / 180
  const cible = { x: Math.sin(a) * distance, z: Math.cos(a) * distance }
  const t0 = b.temps()
  if (!b.w.goTo(cible.x, cible.z)) return { angleDeg, refus: true }
  let premierPas = null
  let capAuDepart = null
  let prev = { ...b.pose() }
  const LIMITE = Math.round(30 / DT)
  for (let i = 0; i < LIMITE; i++) {
    b.image()
    const q = b.pose()
    if (premierPas === null && Math.hypot(q.x - prev.x, q.z - prev.z) > 1e-6) {
      premierPas = b.temps() - t0
      const vise = Math.atan2(cible.x - q.x, cible.z - q.z)
      let d = vise - q.yaw
      while (d > Math.PI) d -= 2 * Math.PI
      while (d < -Math.PI) d += 2 * Math.PI
      capAuDepart = Math.abs((d * 180) / Math.PI)
      break
    }
    prev = { ...q }
  }
  // Le pivot, tel que la machine à états l'a joué (le clip posé, puis quitté).
  const pivots = b.evts.filter((e) => e.quoi === 'gait' && (e.nom === 'turn-left' || e.nom === 'turn-right'))
  return {
    angleDeg,
    premierPasS: premierPas === null ? null : +premierPas.toFixed(3),
    capAuDepartDeg: capAuDepart === null ? null : +capAuDepart.toFixed(1),
    clipPivot: pivots.length ? pivots[0].nom : '—',
    evts: b.evts.slice(0, 6).map((e) => `${e.t.toFixed(2)} ${e.quoi}:${e.nom ?? '—'}`),
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2. TRAJET COMPLET, par distance
// ════════════════════════════════════════════════════════════════════════════
/**
 * Clic droit devant (aucun pivot : on mesure l'allure, pas la rotation). On
 * chronomètre du clic au RETOUR AU REPOS (l'arrêt compris, c'est ce que l'œil
 * voit), et on relève la suite des allures posées.
 */
function trajet(distance, { couloir = false, cible = null } = {}) {
  const b = creerBanc({ capRepos: 0, couloir })
  b.image()
  const t0 = b.temps()
  const but = cible ?? { x: 0, z: distance }
  if (!b.w.goTo(but.x, but.z)) return { distance, refus: true }
  let parcouru = 0
  let prev = { ...b.pose() }
  let premierPas = null
  let arrivee = null
  const LIMITE = Math.round(90 / DT)
  for (let i = 0; i < LIMITE; i++) {
    b.image()
    const q = b.pose()
    const d = Math.hypot(q.x - prev.x, q.z - prev.z)
    parcouru += d
    if (premierPas === null && d > 1e-6) premierPas = b.temps() - t0
    prev = { ...q }
    if (!b.w.busy()) {
      arrivee = b.temps() - t0
      break
    }
  }
  const fin = b.pose()
  const allures = b.evts
    .filter((e) => (e.quoi === 'gait' && e.nom && e.nom.startsWith('walk')) || (e.quoi === 'once' && e.nom.startsWith('walk')))
    .map((e) => e.nom)
  return {
    distance,
    trajetS: arrivee === null ? null : +arrivee.toFixed(2),
    premierPasS: premierPas === null ? null : +premierPas.toFixed(3),
    parcouruM: +parcouru.toFixed(2),
    resteM: +Math.hypot(fin.x - but.x, fin.z - but.z).toFixed(2),
    vitesseMoyMS: arrivee ? +(parcouru / arrivee).toFixed(2) : null,
    arrets: b.evts.filter((e) => e.quoi === 'once' && e.nom.startsWith('walk-stop')).length,
    allures,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Rapport
// ════════════════════════════════════════════════════════════════════════════
const ANGLES = [30, 90, 180]
const DISTANCES = [2, 5, 10, 15]
const demarrages = ANGLES.map((a) => clicVersPremierPas(a))
const trajets = DISTANCES.map((d) => trajet(d))
// Le couloir en L : 6 m de branche, un coude, puis 2 / 4 / 6 m — soit un CHEMIN
// de 8 à 12 m fait d'étapes dont aucune ne dépasse 6 m. C'est le cas où
// l'allure se choisissait sur le segment et non sur le trajet.
const COUDES = [2, 4, 6]
const trajetsCouloir = COUDES.map((x) =>
  Object.assign(trajet(COULOIR.longueurZ + x, { couloir: true, cible: { x, z: COULOIR.longueurZ } }), { cheminM: COULOIR.longueurZ + x }),
)

console.log(`\n══ LOCOMOTION COMMANDÉE — hanches ${HANCHES} m, vitesses ${BORNE === 'milieu' ? 'au milieu de la fourchette' : 'borne ' + BORNE}`)
console.log('\n── clic → premier pas ──')
console.log('   écart de cap   premier pas   reste à tourner   clip de pivot')
for (const d of demarrages) {
  if (d.refus) {
    console.log(`   ${String(d.angleDeg + '°').padStart(8)}        REFUSÉ`)
    continue
  }
  console.log(
    `   ${String(d.angleDeg + '°').padStart(8)}   ${String(d.premierPasS === null ? '—' : d.premierPasS.toFixed(2) + ' s').padStart(11)}` +
      `   ${String(d.capAuDepartDeg === null ? '—' : d.capAuDepartDeg.toFixed(0) + '°').padStart(15)}   ${d.clipPivot}`,
  )
}
console.log('\n── trajet complet (clic droit devant → retour au repos) ──')
console.log('   demandé   parcouru   reste   durée      moy      allures')
for (const t of trajets) {
  if (t.refus) {
    console.log(`   ${String(t.distance + ' m').padStart(7)}   REFUSÉ`)
    continue
  }
  console.log(
    `   ${String(t.distance + ' m').padStart(7)}   ${String(t.parcouruM.toFixed(2) + ' m').padStart(8)}` +
      `   ${String(t.resteM.toFixed(2) + ' m').padStart(6)}   ${String((t.trajetS ?? 0).toFixed(2) + ' s').padStart(7)}` +
      `   ${String((t.vitesseMoyMS ?? 0).toFixed(2) + ' m/s').padStart(8)}   ${t.allures.join(' → ')}`,
  )
}
console.log('\n── trajet À ÉTAPES (couloir en L, coude à 6 m) ──')
console.log('   chemin   parcouru   reste   durée      moy      arrêts   allures')
for (const t of trajetsCouloir) {
  if (t.refus) {
    console.log(`   ${String(t.cheminM + ' m').padStart(6)}   REFUSÉ`)
    continue
  }
  console.log(
    `   ${String(t.cheminM + ' m').padStart(6)}   ${String(t.parcouruM.toFixed(2) + ' m').padStart(8)}` +
      `   ${String(t.resteM.toFixed(2) + ' m').padStart(6)}   ${String((t.trajetS ?? 0).toFixed(2) + ' s').padStart(7)}` +
      `   ${String((t.vitesseMoyMS ?? 0).toFixed(2) + ' m/s').padStart(8)}   ${String(t.arrets).padStart(6)}   ${t.allures.join(' → ')}`,
  )
}
console.log('')

if (args.has('json')) {
  const dest = path.join(LAB, path.basename(args.get('json')))
  fs.writeFileSync(dest, JSON.stringify({ borne: BORNE, demarrages, trajets, trajetsCouloir }, null, 1))
  console.log(`écrit : ${dest}\n`)
}
