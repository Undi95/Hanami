// Banc HEADLESS des clics au sol — réécriture du script de 540f4d6 (perdu).
//
// Rejoue, hors navigateur, exactement ce que fait l'app quand on clique le sol
// d'un décor : le placement de fitEnvironment (rotationY, scale, spawn, calage
// au sol par la boîte englobante), les backdrops du sidecar, puis le verdict
// d'onSceneClick (premier impact VISIBLE, assises, |floorAt − impact.y| ≤ 0,35)
// sur chaque cellule praticable échantillonnée (1 sur 3, comme 540f4d6 :
// 37/356/17 cellules) × 5 azimuts de caméra, à la distance et à la hauteur
// d'œil de frameCamera.
//
// Lancement (tsx, pour importer le vrai parseSceneMap du client) :
//   npx tsx devtools/banc-clics-sol.mjs [décor…] [--details] [--avant] [--camera=cellule]
//
// COMMITTÉ, contrairement à son prédécesseur de 540f4d6 : ce script-là vivait
// dans un scratchpad de session, et sa disparition a coûté sa réécriture
// complète à la correction suivante. Un instrument qui a servi deux fois
// servira une troisième — chaque décor importé mérite sa mesure.
//
// Les textures sont retirées du GLB avant parse (pas de décodeur d'image sous
// Node) — side / transparent / opacity, eux, sont préservés, et ce sont eux
// que le raycast et la règle de visibilité consomment.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Box3, Group, MathUtils, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Vector3, DoubleSide, Matrix3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { parseSceneMap } from '../client/src/scene/sceneMap'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TOUS = ['cozy-loft-room', 'anime-classroom', 'rustic-bedroom']
const choisis = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const DECORS = choisis.length ? choisis : TOUS
const DETAILS = process.argv.includes('--details')
// --camera=cellule : la caméra orbite la CELLULE visée (comme un utilisateur qui
// a recentré la vue) plutôt que l'origine (cadrage par défaut sur l'avatar).
const CAMERA_CELLULE = process.argv.includes('--camera=cellule')
const { DEG2RAD } = MathUtils

// ── Constantes recopiées de vrmStage.ts (frameCamera / fitEnvironment) ──────
const ENV_MIN_HEIGHT = 1.5
const ENV_MAX_HEIGHT = 12
const ENV_TARGET_HEIGHT = 2.6
const H = 1.6 // hauteur normalisée de l'avatar
const HEAD_Y = H * (1.35 / 1.6) // repli « modèle sans os head » de frameCamera
const EYE_Y = HEAD_Y - 0.12 // controls.target.y = hauteur d'œil de la caméra
const ALPHA = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const STRIDE = 3 // 1 cellule sur 3 — retrouve les 37/356/17 cellules de 540f4d6
const AZIMUTS = [0, 72, 144, 216, 288]

// ── Règle de visibilité au clic, recopiée de vrmStage.ts ────────────────────
const OPACITE_INVISIBLE = 0.02
function estOpaqueAuClic(object) {
  for (let n = object; n; n = n.parent) if (n.visible === false) return false
  const material = object.material
  if (!material) return true
  const efface = (one) => one.transparent === true && (one.opacity ?? 1) <= OPACITE_INVISIBLE
  return Array.isArray(material) ? !material.every(efface) : !efface(material)
}
function premierImpactVisible(hits) {
  for (const hit of hits) if (estOpaqueAuClic(hit.object)) return hit
  return null
}

// ── GLB sans textures : mêmes matériaux (side, alpha…), zéro décodage d'image ─
function stripTextures(glbPath) {
  const buf = fs.readFileSync(glbPath)
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${glbPath} : pas un GLB`)
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
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8')
  const pad = (4 - (jsonBuf.length % 4)) % 4
  if (pad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad, 0x20)])
  const rest = buf.subarray(20 + jsonLen) // chunk BIN, intact
  const head = Buffer.alloc(20)
  head.writeUInt32LE(0x46546c67, 0)
  head.writeUInt32LE(2, 4)
  head.writeUInt32LE(20 + jsonBuf.length + rest.length, 8)
  head.writeUInt32LE(jsonBuf.length, 12)
  head.writeUInt32LE(0x4e4f534a, 16)
  const glb = Buffer.concat([head, jsonBuf, rest])
  return glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength)
}

function loadGltf(glbPath) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(stripTextures(glbPath), '', resolve, reject)
  })
}

// ── fitEnvironment + addEnvBackdrops, à l'identique ─────────────────────────
function placer(root, placement) {
  const envGroup = new Group()
  envGroup.add(root)
  envGroup.rotation.set(0, (placement.rotationY ?? 0) * DEG2RAD, 0)
  envGroup.scale.setScalar(placement.scale ?? 1)
  envGroup.updateMatrixWorld(true)
  let box = new Box3().setFromObject(root)
  const rawHeight = Math.max(box.getSize(new Vector3()).y, 1e-6)
  if (placement.scale === undefined && (rawHeight < ENV_MIN_HEIGHT || rawHeight > ENV_MAX_HEIGHT)) {
    envGroup.scale.multiplyScalar(ENV_TARGET_HEIGHT / rawHeight)
    envGroup.updateMatrixWorld(true)
    box = new Box3().setFromObject(root)
  }
  const [sx, sy, sz] = placement.spawn ?? [0, 0, 0]
  envGroup.position.set(-sx, -(box.min.y + sy), -sz)
  for (const b of placement.backdrop ?? []) {
    const material = new MeshBasicMaterial()
    material.color.r = b.color[0]
    material.color.g = b.color[1]
    material.color.b = b.color[2]
    material.side = DoubleSide
    const quad = new Mesh(new PlaneGeometry(b.size[0], b.size[1]), material)
    quad.position.set(b.center[0], b.center[1], b.center[2])
    quad.rotation.y = (b.yawY ?? 0) * DEG2RAD
    quad.name = 'env-backdrop'
    root.add(quad)
  }
  envGroup.updateMatrixWorld(true)
  return root
}

// --avant : rejoue le verdict d'AVANT la règle du premier plan (near = 0),
// pour mesurer ce qu'elle change. Par défaut, le banc mesure l'app telle
// qu'elle est : un impact décor plus près de l'objectif que
// controls.minDistance (0,3 h, posé par frameCamera) n'est pas une cible.
const AVANT = process.argv.includes('--avant')
const CAMERA_NEAR = 0.1 // new PerspectiveCamera(30, 1, 0.1, 20) de vrmStage
const MIN_DISTANCE = 0.3 * H // controls.minDistance posé par frameCamera

// ── Verdict d'onSceneClick sur un rayon caméra → point de sol visé ──────────
function verdict(raycaster, envRoot, sceneMap, camPos, cible) {
  const dir = cible.clone().sub(camPos).normalize()
  raycaster.set(camPos, dir)
  raycaster.near = AVANT ? 0 : Math.max(CAMERA_NEAR, MIN_DISTANCE)
  const hits = raycaster.intersectObject(envRoot, true)
  const hit = hits.length ? premierImpactVisible(hits) : null
  if (!hit) return { ok: false, raison: 'aucun-impact', hits }
  const p = hit.point
  for (const seat of sceneMap.seats) {
    if (Math.abs(p.y - seat.y) > 0.3) continue
    const b = seat.bounds
    const inSheet = b
      ? p.x >= b[0] - 0.08 && p.x <= b[2] + 0.08 && p.z >= b[1] - 0.08 && p.z <= b[3] + 0.08
      : Math.hypot(p.x - seat.center[0], p.z - seat.center[1]) < 0.45
    if (!inSheet) continue
    return { ok: true, raison: 'assise', hit, hits }
  }
  const floor = sceneMap.floorAt(p.x, p.z)
  if (floor === null || Math.abs(floor - p.y) > 0.35) return { ok: false, raison: 'hors-sol', hit, hits }
  return { ok: true, raison: 'sol', hit, hits }
}

function nomMateriau(object) {
  const m = object?.material
  if (!m) return '(sans matériau)'
  return Array.isArray(m) ? m.map((x) => x.name || '(anonyme)').join('+') : m.name || '(anonyme)'
}

/** Face avant ou arrière ? (arrière : atteignable seulement en DoubleSide) */
function coteFace(hit, dir) {
  if (!hit.face) return '?'
  const nm = new Matrix3().getNormalMatrix(hit.object.matrixWorld)
  const n = hit.face.normal.clone().applyMatrix3(nm).normalize()
  return n.dot(dir) > 0 ? 'ARRIÈRE' : 'avant'
}

/** Décor chargé et placé comme dans l'app — partagé avec les sondes de diagnostic. */
export async function chargerDecor(nom) {
  const glb = path.join(ROOT, 'environments', `${nom}.glb`)
  const placement = JSON.parse(fs.readFileSync(glb.replace(/\.glb$/, '.json'), 'utf8'))
  const sceneJson = JSON.parse(fs.readFileSync(glb.replace(/\.glb$/, '.scene.json'), 'utf8'))
  const sceneMap = parseSceneMap(sceneJson)
  if (!sceneMap) throw new Error(`${nom} : .scene.json illisible`)
  const gltf = await loadGltf(glb)
  const envRoot = placer(gltf.scene, placement)
  return { envRoot, sceneJson, sceneMap, placement }
}

async function mesurer(nom) {
  const { envRoot, sceneJson, sceneMap, placement } = await chargerDecor(nom)

  // Cellules praticables, 1 sur 3, centre de cellule + altitude du niveau.
  const g = sceneJson.grid
  const cibles = []
  for (let j = 0; j < g.rows; j += STRIDE) {
    for (let i = 0; i < g.cols; i += STRIDE) {
      const c = g.map[j][i]
      const lvl = ALPHA.indexOf(c)
      if (lvl < 0 || lvl >= g.levels.length) continue
      cibles.push(new Vector3(g.origin[0] + (i + 0.5) * g.cell, g.levels[lvl], g.origin[1] + (j + 0.5) * g.cell))
    }
  }

  const desired = placement.frameDistance ?? HEAD_Y * 1.4
  const dist = Math.min(2.5 * H, Math.max(0.375 * H, desired))
  const raycaster = new Raycaster()
  const parAzimut = []
  const echecs = []
  let ok = 0
  for (const az of AZIMUTS) {
    const a = az * DEG2RAD
    let okAz = 0
    for (const cible of cibles) {
      const camPos = CAMERA_CELLULE
        ? new Vector3(cible.x + dist * Math.sin(a), EYE_Y, cible.z + dist * Math.cos(a))
        : new Vector3(dist * Math.sin(a), EYE_Y, dist * Math.cos(a))
      const v = verdict(raycaster, envRoot, sceneMap, camPos, cible)
      if (v.ok) okAz++
      else echecs.push({ az, cible, v, camPos })
    }
    parAzimut.push(okAz)
    ok += okAz
  }

  const total = cibles.length * AZIMUTS.length
  console.log(`\n${nom}  ${ok}/${total} clics déclenchent  (${((100 * ok) / total).toFixed(1)} %)`)
  console.log(`  cellules : ${cibles.length}   par azimut : ${parAzimut.join('/')}`)

  // Échecs regroupés par (raison, nœud, matériau) du premier impact visible.
  const groupes = new Map()
  for (const e of echecs) {
    const hit = e.v.hit
    const cle = hit
      ? `${e.v.raison} | ${hit.object.name} | ${nomMateriau(hit.object)}`
      : e.v.raison
    if (!groupes.has(cle)) groupes.set(cle, [])
    groupes.get(cle).push(e)
  }
  // Pour chaque échec : à quelle profondeur derrière le premier impact se
  // cache le premier impact qui PASSERAIT le verdict (sol ou assise) ? C'est ce
  // qui distingue une coque dupliquée (écart de quelques cm) d'une occlusion
  // légitime (un meuble plein devant le point visé).
  const secours = (e) => {
    if (!e.v.hit) return null
    for (const h of e.v.hits) {
      if (h.distance <= e.v.hit.distance) continue
      if (!estOpaqueAuClic(h.object)) continue
      const fl = sceneMap.floorAt(h.point.x, h.point.z)
      const surSol = fl !== null && Math.abs(fl - h.point.y) <= 0.35
      const surAssise = sceneMap.seats.some((s) => {
        if (Math.abs(h.point.y - s.y) > 0.3) return false
        const b = s.bounds
        return b
          ? h.point.x >= b[0] - 0.08 && h.point.x <= b[2] + 0.08 && h.point.z >= b[1] - 0.08 && h.point.z <= b[3] + 0.08
          : Math.hypot(h.point.x - s.center[0], h.point.z - s.center[1]) < 0.45
      })
      if (surSol || surAssise) return { ecart: h.distance - e.v.hit.distance, h }
    }
    return null
  }
  for (const [cle, liste] of [...groupes.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const ecarts = liste.map(secours).map((s) => (s ? s.ecart : Infinity))
    const proches = ecarts.filter((d) => d <= 0.1).length
    const resume = ecarts
      .map((d) => (d === Infinity ? '∞' : d.toFixed(2)))
      .slice(0, 12)
      .join(' ')
    console.log(`  ÉCHEC ×${liste.length}  ${cle}`)
    console.log(`      sol praticable derrière : ${proches}/${liste.length} à ≤ 10 cm — écarts : ${resume}${liste.length > 12 ? ' …' : ''}`)
    if (!DETAILS) continue
    for (const e of liste.slice(0, 6)) {
      const { hit } = e.v
      const dir = e.cible.clone().sub(e.camPos).normalize()
      if (!hit) {
        console.log(`      az ${e.az}° cible (${e.cible.x.toFixed(2)}, ${e.cible.z.toFixed(2)}) : aucun impact`)
        continue
      }
      const fl = sceneMap.floorAt(hit.point.x, hit.point.z)
      console.log(
        `      az ${e.az}° cible (${e.cible.x.toFixed(2)}, ${e.cible.y.toFixed(2)}, ${e.cible.z.toFixed(2)})` +
          ` impact (${hit.point.x.toFixed(2)}, ${hit.point.y.toFixed(2)}, ${hit.point.z.toFixed(2)})` +
          ` d=${hit.distance.toFixed(2)} face ${coteFace(hit, dir)} floorAt=${fl === null ? 'null' : fl.toFixed(3)}`,
      )
      for (const h of e.v.hits.slice(0, 4)) {
        const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material
        console.log(
          `        ↳ ${h.object.name} [${nomMateriau(h.object)}] y=${h.point.y.toFixed(2)} d=${h.distance.toFixed(2)}` +
            ` side=${m?.side} transp=${m?.transparent ?? '-'} op=${m?.opacity ?? '-'} visible=${estOpaqueAuClic(h.object)}`,
        )
      }
    }
  }
  return { nom, ok, total, parAzimut }
}

// Exécuté seulement en direct — les sondes importent chargerDecor sans mesurer.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bilan = []
  for (const nom of DECORS) bilan.push(await mesurer(nom))
  console.log('\n── Bilan ──')
  for (const b of bilan) console.log(`${b.nom.padEnd(18)} ${b.ok}/${b.total}  (${b.parAzimut.join('/')})`)
}
