// ════════════════════════════════════════════════════════════════════════════
// chercher-spawn.mjs — OÙ POSER LE POINT D'ACCUEIL D'UN DÉCOR
//
// La question qu'il tranche : où, dans un décor, le cadrage d'accueil rend-il
// une belle image ? Un `spawn` de sidecar se choisissait à l'œil, et l'œil se
// trompe : celui de lowpoly-restaurant tombait dans le sas d'entrée — objectif
// contre le comptoir, frameDistance jamais appliquée, molette plafonnée à 2 m.
//
// Le banc balaie toutes les cases praticables de niveau 0 de la carte
// (`.scene.json`) et mesure, sur la VRAIE géométrie (chargement + placement de
// banc-clics-sol, arbre de client/src/scene/bvh) :
//
//   • deg+Z    le dégagement du RECUL — la bulle de reculDegage (rayon 0,12 m)
//              balayée sur +Z à PLUSIEURS hauteurs d'objectif (0,85 → 1,45 m :
//              du petit rig au grand gabarit), le pire compte. C'est lui qui
//              décide si le frameDistance du sidecar passe entier.
//   • front    le min des secteurs ±45° de la rose à 1,30 m — ce que
//              envPullback donnera comme plafond à la molette.
//   • fond     la rose à −Z : la profondeur de pièce DERRIÈRE le personnage,
//              c'est-à-dire ce qui remplit le cadre.
//   • tables   les assises de la carte côté −Z, à ≤ 8 m, dans un cône de ±65° —
//              ce que l'objectif voit vraiment du mobilier.
//   • proche   la distance de la première assise, toutes directions — pour ne
//              pas poser le personnage dans une chaise.
//
// Ne sont RETENUS que les points où le plan a quelque chose à montrer
// (tables ≥ 3, fond ≥ 4,5 m) ; le tri départage par la liberté de la molette.
// La colonne « spawn modèle » donne la valeur À RECOPIER dans le sidecar —
// après quoi `npm run env:scene -- <décor>` régénère l'analyse, et
// `npx tsx devtools/banc-cadrage.mjs <décor>` juge le résultat.
//
// Lancement (tsx, pour importer le vrai bvh.ts) :
//   npx tsx devtools/chercher-spawn.mjs lowpoly-restaurant
import { Vector3 } from 'three'
import { chargerDecor } from './banc-clics-sol.mjs'
import { buildEnvBvh, raycastFirst } from '../client/src/scene/bvh'
import { mergeEnvironment } from '../client/src/scene/envMerge'

const nom = process.argv[2]
if (!nom) {
  console.error('usage : npx tsx devtools/chercher-spawn.mjs <décor>')
  process.exit(1)
}
const { envRoot, sceneJson, placement } = await chargerDecor(nom)
mergeEnvironment(envRoot)
const groupe = envRoot.parent ?? envRoot
groupe.updateMatrixWorld(true)
const bvh = buildEnvBvh(envRoot)

// ── Règle de visibilité et bulle de l'objectif, recopiées de vrmStage.ts ────
const OPACITE_INVISIBLE = 0.02
function estOpaqueAuClic(object) {
  for (let n = object; n; n = n.parent) if (n.visible === false) return false
  const material = object.material
  if (!material) return true
  const efface = (one) => one.transparent === true && (one.opacity ?? 1) <= OPACITE_INVISIBLE
  return Array.isArray(material) ? !material.every(efface) : !efface(material)
}

const JANTE = [
  [0, 0],
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
]
const RAYON_BULLE = 0.12
function sonderDir(x, y, z, dirX, dirZ) {
  // Jante perpendiculaire à la direction : (perpendiculaire horizontal, vertical).
  const px = -dirZ
  const pz = dirX
  let best = Infinity
  for (const [a, b] of JANTE) {
    const o = new Vector3(x + a * px * RAYON_BULLE, y + b * RAYON_BULLE, z + a * pz * RAYON_BULLE)
    const hit = raycastFirst(bvh, o, new Vector3(dirX, 0, dirZ), estOpaqueAuClic, 0, best)
    if (hit && hit.distance < best) best = hit.distance
  }
  return best === Infinity ? null : best
}

// Rayon simple (sans bulle) — la convention de la rose de l'analyse.
function rayonSimple(x, y, z, dirX, dirZ) {
  const hit = raycastFirst(bvh, new Vector3(x, y, z), new Vector3(dirX, 0, dirZ), estOpaqueAuClic)
  return hit ? hit.distance : Infinity
}

const g = sceneJson.grid

// La case (i, j) est-elle praticable de niveau 0 ?
function niveau0(i, j) {
  if (i < 0 || j < 0 || i >= g.cols || j >= g.rows) return false
  return g.map[j][i] === '0'
}

// Espace des pieds : toutes les cases à ≤ rayonCases du centre sont niveau 0.
function bulleSol(i, j, rayonCases) {
  for (let dj = -rayonCases; dj <= rayonCases; dj++)
    for (let di = -rayonCases; di <= rayonCases; di++)
      if (di * di + dj * dj <= rayonCases * rayonCases && !niveau0(i + di, j + dj)) return false
  return true
}

// Hauteurs d'objectif couvertes : 0,85 m (rig ~1,39 m) → 1,45 m (grand gabarit).
const HAUTEURS = [0.85, 1.0, 1.15, 1.3, 1.45]
const CAM_ROSE_FRONT = [14, 15, 0, 1, 2]
// Le seuil d'entrée : frameDistance du sidecar (ou le plan large d'un 1,6 m,
// 1,35 × 1,4 ≈ 1,9 m) + la marge de la sonde (CAM_PROBE_MARGIN) + 5 cm d'air.
const RECUL_VOULU = (placement.frameDistance ?? 1.9) + 0.3 + 0.05

const seats = sceneJson.seats ?? []
const candidats = []
const PAS = 2 // une case sur deux (0,2 m)
for (let j = 0; j < g.rows; j += PAS) {
  for (let i = 0; i < g.cols; i += PAS) {
    if (!niveau0(i, j)) continue
    if (!bulleSol(i, j, 3)) continue // 0,3 m de sol libre autour des pieds
    const x = g.origin[0] + (i + 0.5) * g.cell
    const z = g.origin[1] + (j + 0.5) * g.cell

    // Dégagement du RECUL (+Z), bulle, à toutes les hauteurs : le pire compte.
    let degZ = Infinity
    for (const h of HAUTEURS) {
      const c = sonderDir(x, h, z, 0, 1)
      if (c !== null && c < degZ) degZ = c
    }
    if (degZ < RECUL_VOULU) continue

    // Rose 16 directions à 1,30 m (convention de l'analyse : 0 = +Z, 4 = +X).
    const rose = []
    for (let k = 0; k < 16; k++) {
      const a = (k * 22.5 * Math.PI) / 180
      rose.push(rayonSimple(x, 1.3, z, Math.sin(a), Math.cos(a)))
    }
    const front = Math.min(...CAM_ROSE_FRONT.map((k) => rose[k]))
    const fond = rose[8] // −Z : la profondeur du décor derrière le personnage

    // Assises dans le champ : côté −Z, à ≤ 8 m, dans un cône de ±65°.
    let tablesVues = 0
    let tableProche = Infinity
    for (const s of seats) {
      const dx = s.center[0] - x
      const dz = s.center[1] - z
      const d = Math.hypot(dx, dz)
      if (d < tableProche) tableProche = d
      if (dz < 0 && d <= 8 && Math.abs(Math.atan2(dx, -dz)) < (65 * Math.PI) / 180) tablesVues++
    }

    candidats.push({ i, j, x, z, degZ, front, fond, tablesVues, tableProche, rose })
  }
}

// Le PLAN voulu : du mobilier dans le champ et un fond profond — c'est le
// critère d'entrée. Le tri départage ensuite par la liberté de la molette
// (front, plafonnée à 6 m — au-delà ça ne change plus rien), puis par la
// richesse du champ. Un décor sans assises (une clairière, un quai) donnera
// zéro retenu : les candidats bruts restent listés pour trancher à la main.
const retenus = candidats.filter((c) => c.tablesVues >= 3 && c.fond >= 4.5)
retenus.sort((a, b) => {
  const fa = Math.min(a.front, 6)
  const fb = Math.min(b.front, 6)
  if (fb !== fa) return fb - fa
  if (b.tablesVues !== a.tablesVues) return b.tablesVues - a.tablesVues
  return Math.min(b.fond, 8) - Math.min(a.fond, 8)
})

console.log(
  `\n${nom} — ${candidats.length} candidats praticables (recul ≥ ${RECUL_VOULU.toFixed(2)} m ` +
    `aux hauteurs ${HAUTEURS.join('/')}), ${retenus.length} retenus (assises ≥ 3, fond ≥ 4,5 m)\n`,
)
const [sx, sy, sz] = placement.spawn ?? [0, 0, 0]
if ((placement.rotationY ?? 0) !== 0 || (placement.scale ?? 1) !== 1)
  throw new Error('rotationY/scale non triviaux : la traduction spawn + delta ne vaut plus, à généraliser avant usage')
const liste = retenus.length ? retenus : candidats
console.log(
  `   ${'grille'.padEnd(10)} ${'x'.padStart(6)} ${'z'.padStart(6)}  ${'deg+Z'.padStart(6)} ${'front'.padStart(6)} ` +
    `${'fond'.padStart(6)} ${'tables'.padStart(6)} ${'proche'.padStart(6)}   spawn modèle (à recopier dans le sidecar)`,
)
for (const c of liste.slice(0, 25)) {
  const spawnModele = [+(sx + c.x).toFixed(3), sy, +(sz + c.z).toFixed(3)]
  console.log(
    `   [${String(c.i).padStart(2)},${String(c.j).padStart(3)}] ` +
      `${c.x.toFixed(2).padStart(6)} ${c.z.toFixed(2).padStart(6)}  ` +
      `${c.degZ.toFixed(2).padStart(6)} ${(c.front === Infinity ? '∞' : c.front.toFixed(2)).padStart(6)} ` +
      `${(c.fond === Infinity ? '∞' : c.fond.toFixed(2)).padStart(6)} ${String(c.tablesVues).padStart(6)} ` +
      `${(c.tableProche === Infinity ? '∞' : c.tableProche.toFixed(2)).padStart(6)}   [${spawnModele.join(', ')}]`,
  )
}

if (liste[0]) {
  const r = liste[0].rose.map((v) => (v === Infinity ? '∞' : v.toFixed(1)))
  console.log(`\n   rose du meilleur (0 = +Z, 4 = +X, 8 = −Z, 12 = −X) : ${r.join(' ')}`)
}

// Carte avec les 12 meilleurs marqués A-L, pour situer à l'œil.
const marques = 'ABCDEFGHIJKL'
const copie = g.map.map((r) => r.split(''))
liste.slice(0, 12).forEach((c, n) => {
  copie[c.j][c.i] = marques[n]
})
console.log('\n   carte (12 meilleurs marqués A-L, ligne = z croissant, colonne = x croissant) :')
for (let j = 0; j < g.rows; j += 2) console.log(`   ${copie[j].join('')}`)
