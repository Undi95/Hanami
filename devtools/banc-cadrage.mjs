// ════════════════════════════════════════════════════════════════════════════
// banc-cadrage.mjs — LE RECUL DU CADRAGE D'ACCUEIL, DÉCOR PAR DÉCOR, RIG PAR RIG
//
// La question qu'il tranche : le cadrage par défaut pose-t-il l'objectif DANS
// quelque chose ? Le recul du cadrage (frameDistance du sidecar, ou la formule)
// n'a jamais regardé la hauteur à laquelle l'objectif se pose — la rose de
// dégagement de l'analyse est sondée à 1,30 m FIXE (server/lib/envScene,
// EYE_HEIGHT), et un personnage de 1,39 m met son objectif à 0,91 m. Entre les
// deux, il peut y avoir un comptoir : c'est le cas de lowpoly-restaurant.
//
// Ce que le banc mesure, pour chaque (décor × rig) :
//   • h            hauteur du modèle (normalizeScale) et hauteur de tête
//   • objectif     la hauteur d'œil de frameCamera : tête − 12 cm
//   • AVANT        le recul tel que frameCamera le calculait — formule et clamps
//   • dégagement   la distance du premier obstacle sur l'axe +Z, à CETTE hauteur,
//                  lue dans le VRAI arbre du décor (client/src/scene/bvh.ts)
//   • APRÈS        le recul borné par la sonde : min(AVANT, max(0,375 h, dég. − marge))
//   • Δ            l'écart, en centimètres — 0 partout sauf là où ça coinçait
//
// Il donne aussi la rose de l'analyse (1,30 m) en regard de la sonde, pour
// montrer NOIR SUR BLANC pourquoi la rose ne pouvait pas voir le comptoir.
//
// Lancement (tsx, pour importer le vrai bvh.ts et le vrai sceneMap.ts) :
//   npx tsx devtools/banc-cadrage.mjs                     # 7 décors × 2 rigs
//   npx tsx devtools/banc-cadrage.mjs --rig=<nom>.vrm     # un rig imposé
//   npx tsx devtools/banc-cadrage.mjs lowpoly-restaurant  # un décor
//
// Les textures sont retirées des GLB avant parse (pas de décodeur d'image sous
// Node) — `side`, `transparent` et `opacity`, eux, sont intacts, et ce sont eux
// que le rayon et estOpaqueAuClic consomment. Le décor est placé et FUSIONNÉ
// comme dans l'app (fitEnvironment puis mergeEnvironment), donc l'arbre est
// celui de l'app, triangle pour triangle.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Box3, Group, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { chargerDecor } from './banc-clics-sol.mjs'
import { buildEnvBvh, raycastFirst } from '../client/src/scene/bvh'
import { mergeEnvironment } from '../client/src/scene/envMerge'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const DECORS = args.filter((a) => !a.startsWith('--'))
const RIG_ARG = args.find((a) => a.startsWith('--rig='))?.slice(6)
const RAYON_ARG = args.find((a) => a.startsWith('--rayon='))?.slice(8)
// --rayons : balaie plusieurs rayons de bulle et montre le recul de chacun.
const RAYONS_ARG = args.find((a) => a.startsWith('--rayons='))?.slice(9)

const TOUS_DECORS = fs
  .readdirSync(path.join(ROOT, 'environments'))
  .filter((f) => f.endsWith('.glb'))
  .map((f) => f.replace(/\.glb$/, ''))
  .sort()
// Les deux rigs de la mission : le PETIT (celui qui casse) et le grand (la
// non-régression). Ce sont aussi deux versions de VRM, 0.x et 1.0.
// Ce sont les étalons du banc — l'étalon du projet est un chibi VRM 0.x de
// 0,755 m de hanches, le témoin est un rig adulte VRM 1.x ; posez les vôtres
// sous ces noms dans vrm/ (copie ou lien), ou passez --rig=<nom>.vrm.
const TOUS_RIGS = ['reference.vrm', 'reference-1x.vrm']

// ── Constantes RECOPIÉES de vrmStage.ts (frameCamera) ───────────────────────
// Recopiées faute de pouvoir importer vrmStage.ts hors navigateur : il tire
// client/src/prefs.ts, qui touche `window` au chargement du module. Le seul
// calcul qui compte — le lancer de rayon — vient, lui, du VRAI bvh.ts.
const REST_POSE_Z = [
  ['leftUpperArm', 1.25],
  ['rightUpperArm', -1.25],
  ['leftLowerArm', 0.12],
  ['rightLowerArm', -0.12],
]
const OEIL_SOUS_TETE = 0.12 // controls.target.y = headPos.y − 0,12
const CAM_PROBE_MARGIN = 0.3 // marge de la sonde de cadrage
const CAM_PROBE_RADIUS = 0.12 // rayon de la bulle de l'objectif
const CAM_WALL_MARGIN = 0.3 // marge de la rose (applyEnvLimits/envPullback)
const CAM_ROSE_FRONT = [14, 15, 0, 1, 2]
const OPACITE_INVISIBLE = 0.02

function estOpaqueAuClic(object) {
  for (let n = object; n; n = n.parent) if (n.visible === false) return false
  const material = object.material
  if (!material) return true
  const efface = (one) => one.transparent === true && (one.opacity ?? 1) <= OPACITE_INVISIBLE
  return Array.isArray(material) ? !material.every(efface) : !efface(material)
}

/**
 * reculDegage, recopiée : le balayage de la BULLE de l'objectif sur l'axe +Z,
 * approché par son axe et quatre rayons de jante (haut/bas/gauche/droite).
 * Rend la distance du premier obstacle, ou null.
 */
const JANTE = [
  [0, 0],
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
]
function sonder(bvh, x, y, z, rayon) {
  let best = Infinity
  for (const [dx, dy] of JANTE) {
    const hit = raycastFirst(
      bvh,
      new Vector3(x + dx * rayon, y + dy * rayon, z),
      new Vector3(0, 0, 1),
      estOpaqueAuClic,
    )
    if (hit && hit.distance < best) best = hit.distance
  }
  return best === Infinity ? null : best
}

/** frameCamera, la partie arithmétique : le recul AVANT toute sonde. */
function reculAvant(h, teteY, frameDistance) {
  const desired = frameDistance ?? teteY * 1.4
  return Math.min(2.5 * h, Math.max(0.375 * h, desired))
}

/** La borne que la sonde ajoute. `clearance` null = pas d'arbre, rien ne change. */
function reculApres(h, avant, clearance) {
  if (clearance === null) return avant
  return Math.min(avant, Math.max(0.375 * h, clearance - CAM_PROBE_MARGIN))
}

// ── Chargement d'un .vrm sans DOM : mêmes gestes que loadModel ───────────────

/** GLB sans images : GLTFLoader n'a alors aucune texture à décoder sous Node. */
function sansTextures(fichier) {
  const buf = fs.readFileSync(fichier)
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${fichier} : pas un GLB`)
  const jsonLen = buf.readUInt32LE(12)
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'))
  delete json.images
  delete json.textures
  delete json.samplers
  const purge = (o) => {
    if (!o || typeof o !== 'object') return
    for (const k of Object.keys(o)) {
      if (/texture/i.test(k)) delete o[k]
      else purge(o[k])
    }
  }
  purge(json.materials)
  purge(json.extensions)
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8')
  const pad = (4 - (jsonBuf.length % 4)) % 4
  if (pad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad, 0x20)])
  const rest = buf.subarray(20 + jsonLen)
  const head = Buffer.alloc(20)
  head.writeUInt32LE(0x46546c67, 0)
  head.writeUInt32LE(2, 4)
  head.writeUInt32LE(20 + jsonBuf.length + rest.length, 8)
  head.writeUInt32LE(jsonBuf.length, 12)
  head.writeUInt32LE(0x4e4f534a, 16)
  const glb = Buffer.concat([head, jsonBuf, rest])
  return glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength)
}

/**
 * Le modèle tel que frameCamera le trouve : rotateVRM0, pose de repos, échelle
 * normalisée. Rend la hauteur `h` et la position monde de l'os `head` — les
 * deux seules entrées du cadrage.
 */
async function chargerRig(nom) {
  const chemin = path.join(ROOT, 'vrm', nom)
  if (!fs.existsSync(chemin)) {
    throw new Error(
      `rig introuvable : vrm/${nom} — posez un .vrm sous ce nom (copie ou lien) ; ` +
      "l'étalon du projet est un chibi VRM 0.x de 0,755 m de hanches et son témoin " +
      'un rig adulte VRM 1.x. Ou passez --rig=<nom>.vrm.',
    )
  }
  const loader = new GLTFLoader()
  loader.register((parser) => new VRMLoaderPlugin(parser))
  const gltf = await new Promise((res, rej) =>
    loader.parse(sansTextures(chemin), '', res, rej),
  )
  const vrm = gltf.userData.vrm
  if (!vrm) throw new Error(`${nom} : aucune extension VRM`)
  VRMUtils.rotateVRM0(vrm)
  for (const [os, z] of REST_POSE_Z) {
    const node = vrm.humanoid.getNormalizedBoneNode(os)
    if (node) node.rotation.z = z
  }
  vrm.humanoid.update()
  vrm.scene.updateMatrixWorld(true)
  // normalizeScale, à l'identique : hors [0,5 ; 3] m, remise à 1,6 m.
  const box = new Box3().setFromObject(vrm.scene)
  const brute = Math.max(box.max.y - box.min.y, 1e-6)
  let h = brute
  if (brute < 0.5 || brute > 3) {
    vrm.scene.scale.multiplyScalar(1.6 / brute)
    vrm.scene.updateMatrixWorld(true)
    h = 1.6
  }
  const tete = new Vector3(0, h * (1.35 / 1.6), 0)
  vrm.humanoid.getNormalizedBoneNode('head')?.getWorldPosition(tete)
  return { nom, h, tete, version: vrm.meta?.metaVersion ?? '?' }
}

// ── Le décor, placé ET fusionné comme dans l'app ─────────────────────────────

async function chargerArbre(nom) {
  const { envRoot, sceneJson, placement } = await chargerDecor(nom)
  // loadEnvironment : fusion, gel des matrices, PUIS l'arbre.
  mergeEnvironment(envRoot)
  const groupe = envRoot.parent ?? envRoot
  groupe.updateMatrixWorld(true)
  const bvh = buildEnvBvh(envRoot)
  return { bvh, sceneJson, placement }
}

/** envPullback : la rose de l'analyse, sondée à 1,30 m fixe. */
function rosePullback(sceneJson) {
  const rose = sceneJson.camera?.clearance
  if (!Array.isArray(rose) || rose.length !== 16) return null
  let free = Infinity
  for (const k of CAM_ROSE_FRONT) free = Math.min(free, rose[k])
  return free + CAM_WALL_MARGIN
}

// ── Exécution ───────────────────────────────────────────────────────────────

const decors = DECORS.length ? DECORS : TOUS_DECORS
const RAYON = RAYON_ARG ? Number(RAYON_ARG) : CAM_PROBE_RADIUS
const RAYONS = RAYONS_ARG ? RAYONS_ARG.split(',').map(Number) : null
const rigs = []
for (const nom of RIG_ARG ? [RIG_ARG] : TOUS_RIGS) rigs.push(await chargerRig(nom))

// ── Mode balayage de rayons : une seule table, tous décors × rigs × rayons ───
if (RAYONS) {
  console.log('\n╔══ BALAYAGE DU RAYON DE BULLE ══╗\n')
  console.log(
    `   ${'décor'.padEnd(21)} ${'rig'.padEnd(16)} ${'AVANT'.padStart(7)}` +
      RAYONS.map((r) => `r=${r}`.padStart(9)).join(''),
  )
  for (const nom of decors) {
    const { bvh, placement } = await chargerArbre(nom)
    for (const r of rigs) {
      const oeil = r.tete.y - OEIL_SOUS_TETE
      const avant = reculAvant(r.h, r.tete.y, placement.frameDistance)
      const cols = RAYONS.map((rayon) => {
        const c = bvh ? sonder(bvh, r.tete.x, oeil, 0, rayon) : null
        const ap = reculApres(r.h, avant, c)
        return (Math.abs(ap - avant) < 1e-9 ? '=' : ap.toFixed(2)).padStart(9)
      })
      console.log(
        `   ${nom.padEnd(21)} ${r.nom.replace('.vrm', '').padEnd(16)} ${avant.toFixed(3).padStart(7)}${cols.join('')}`,
      )
    }
  }
  process.exit(0)
}

console.log('\n╔══ BANC DE CADRAGE — LE RECUL D’ACCUEIL ══╗\n')
for (const r of rigs) {
  console.log(
    `  ${r.nom.padEnd(22)} VRM ${r.version}   h = ${r.h.toFixed(3)} m   tête = ${r.tete.y.toFixed(3)} m   objectif = ${(r.tete.y - OEIL_SOUS_TETE).toFixed(3)} m`,
  )
}

const bilan = []
for (const nom of decors) {
  const { bvh, sceneJson, placement } = await chargerArbre(nom)
  const rose = rosePullback(sceneJson)
  console.log(`\n── ${nom} ──`)
  console.log(
    `   sidecar frameDistance : ${placement.frameDistance ?? '(aucune)'}` +
      `   arbre : ${bvh ? `${bvh.triangles} tris, ${bvh.rest.length} nœuds hors arbre` : 'AUCUN'}` +
      `   rose (1,30 m) : ${rose === null ? 'aucune' : rose.toFixed(2) + ' m'}`,
  )
  console.log(
    `   ${'rig'.padEnd(22)} ${'objectif'.padStart(9)} ${'AVANT'.padStart(8)} ${'dégagt'.padStart(8)} ${'APRÈS'.padStart(8)} ${'Δ'.padStart(8)}`,
  )
  for (const r of rigs) {
    const oeil = r.tete.y - OEIL_SOUS_TETE
    const avant = reculAvant(r.h, r.tete.y, placement.frameDistance)
    // La sonde de reculDegage : la bulle de l'objectif balayée sur l'axe de
    // recul (+Z), depuis l'abscisse du personnage. Scène vivante éteinte : le
    // personnage est au point d'accueil, donc z = 0.
    const clearance = bvh ? sonder(bvh, r.tete.x, oeil, 0, RAYON) : null
    const apres = reculApres(r.h, avant, clearance)
    const delta = (apres - avant) * 100
    console.log(
      `   ${r.nom.padEnd(22)} ${oeil.toFixed(3).padStart(9)} ${avant.toFixed(3).padStart(8)} ` +
        `${(clearance === null ? '—' : clearance.toFixed(3)).padStart(8)} ${apres.toFixed(3).padStart(8)} ` +
        `${(delta === 0 ? '0' : delta.toFixed(1) + ' cm').padStart(8)}` +
        (clearance !== null && avant > clearance ? '   ⚠ OBJECTIF DANS LE DÉCOR' : ''),
    )
    bilan.push({ decor: nom, rig: r.nom, avant, apres, delta, clearance, dedans: clearance !== null && avant > clearance })
  }
}

console.log('\n── Bilan ──')
const bouges = bilan.filter((b) => Math.abs(b.delta) > 0.001)
if (bouges.length === 0) console.log('   aucun cadrage déplacé.')
for (const b of bouges) {
  console.log(
    `   ${b.decor.padEnd(22)} ${b.rig.padEnd(22)} ${b.avant.toFixed(3)} → ${b.apres.toFixed(3)} m  (${b.delta.toFixed(1)} cm)` +
      (b.dedans ? '   [l’objectif était DERRIÈRE l’obstacle]' : ''),
  )
}
const inchanges = bilan.length - bouges.length
console.log(`   inchangés : ${inchanges}/${bilan.length}`)
const pires = bilan.filter((b) => !b.dedans && Math.abs(b.delta) > 0.001)
if (pires.length) console.log(`   ⚠ ${pires.length} cadrage(s) déplacé(s) SANS obstacle traversé — à regarder.`)
