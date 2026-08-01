// Banc : coût d'un lancer de rayon sur les décors RÉELS, hors navigateur —
// le lancer de rayon de three contre le BVH maison (client/src/scene/bvh.ts).
//
//   node devtools/bench-raycast.mjs            # les 7 décors d'environments/
//   node devtools/bench-raycast.mjs cozy-loft-room japanese-classroom
//
// Ce qu'il reconstruit, et pourquoi il peut le faire sans navigateur : un clic
// ne touche QUE des positions, des indices et des matrices. On lit donc le .glb
// à la main (GLTFLoader exigerait un DOM pour les textures), on reproduit
// mergeEnvironment (fusion par matériau des opaques), addEnvBackdrops et
// fitEnvironment, et on tire 400 rayons sur une grille du viewport depuis la
// caméra du cadrage par défaut. Les matériaux portent ce qui décide du résultat :
// `side` (le tri des faces), `transparent`/`opacity` (le filtre estOpaqueAuClic).
//
// Le banc VÉRIFIE aussi les deux chemins l'un contre l'autre : pour chacun des
// 400 rayons, même objet touché et même distance à 1 µm près. Un écart est une
// panne, pas une nuance — il s'affiche en clair.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

const {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
} = await import(pathToFileURL(path.join(ROOT, 'node_modules/three/build/three.module.js')).href)

// Node ≥ 23 efface les types à la volée : le banc mesure LE fichier de l'app,
// pas une copie qui aurait le droit de diverger.
const { buildEnvBvh, raycastFirst } = await import(
  pathToFileURL(path.join(ROOT, 'client/src/scene/bvh.ts')).href
)

// ── Lecture GLB ────────────────────────────────────────────────────────────

function readGlb(file) {
  const buf = fs.readFileSync(file)
  const jsonLen = buf.readUInt32LE(12)
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'))
  let off = 20 + jsonLen
  let bin = null
  while (off < buf.length) {
    const len = buf.readUInt32LE(off)
    const type = buf.readUInt32LE(off + 4)
    if (type === 0x004e4942) bin = buf.subarray(off + 8, off + 8 + len)
    off += 8 + len + ((4 - (len % 4)) % 4)
  }
  return { json, bin }
}

const COMPONENT = {
  5120: [Int8Array, 1],
  5121: [Uint8Array, 1],
  5122: [Int16Array, 2],
  5123: [Uint16Array, 2],
  5125: [Uint32Array, 4],
  5126: [Float32Array, 4],
}
const NUM_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

function readAccessor(json, bin, index) {
  const acc = json.accessors[index]
  const [Ctor, bytes] = COMPONENT[acc.componentType]
  const n = NUM_COMPONENTS[acc.type]
  const out = new Ctor(acc.count * n)
  if (acc.bufferView === undefined) return out
  const view = json.bufferViews[acc.bufferView]
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const stride = view.byteStride ?? 0
  if (stride === 0 || stride === bytes * n) {
    out.set(new Ctor(bin.buffer, bin.byteOffset + base, acc.count * n))
  } else {
    for (let i = 0; i < acc.count; i++) {
      out.set(new Ctor(bin.buffer, bin.byteOffset + base + i * stride, n), i * n)
    }
  }
  return out
}

function nodeMatrix(node) {
  const m = new Matrix4()
  if (node.matrix) return m.fromArray(node.matrix)
  const t = new Vector3().fromArray(node.translation ?? [0, 0, 0])
  const q = new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1])
  const s = new Vector3().fromArray(node.scale ?? [1, 1, 1])
  return m.compose(t, q, s)
}

/** Le matériau tel que GLTFLoader le fabriquerait, réduit à ce que le clic lit. */
function materialOf(json, index) {
  const src = json.materials?.[index]
  const m = new MeshBasicMaterial()
  const mode = src?.alphaMode ?? 'OPAQUE'
  m.side = src?.doubleSided ? DoubleSide : m.side // FrontSide par défaut
  m.transparent = mode === 'BLEND'
  m.opacity = src?.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1
  m.alphaTest = mode === 'MASK' ? (src?.alphaCutoff ?? 0.5) : 0
  return m
}

/** isOpaque de envMerge : un matériau sûr à fusionner. */
function isOpaque(m) {
  return m.transparent !== true && !(m.alphaTest > 0) && m.depthWrite !== false
}

/**
 * Le décor, primitives cuites en monde-du-glb puis fusionnées par matériau
 * exactement comme mergeEnvironment (les non-opaques restent séparés, et un
 * lot d'un seul mesh n'est jamais fusionné).
 */
function buildEnv(file, json_bin) {
  const { json, bin } = json_bin
  const prims = []
  const scene = json.scenes[json.scene ?? 0]
  const walk = (nodeIndex, parent) => {
    const node = json.nodes[nodeIndex]
    const world = new Matrix4().multiplyMatrices(parent, nodeMatrix(node))
    if (node.mesh !== undefined) {
      for (const p of json.meshes[node.mesh].primitives) {
        if (p.mode !== undefined && p.mode !== 4) continue
        const pos = readAccessor(json, bin, p.attributes.POSITION)
        const v = new Vector3()
        for (let i = 0; i < pos.length; i += 3) {
          v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(world)
          pos[i] = v.x
          pos[i + 1] = v.y
          pos[i + 2] = v.z
        }
        const idx = p.indices !== undefined ? Uint32Array.from(readAccessor(json, bin, p.indices)) : null
        prims.push({ positions: pos, index: idx, mat: p.material ?? -1 })
      }
    }
    for (const child of node.children ?? []) walk(child, world)
  }
  for (const n of scene.nodes) walk(n, new Matrix4())

  const materials = new Map()
  const matOf = (i) => {
    let m = materials.get(i)
    if (!m) materials.set(i, (m = materialOf(json, i)))
    return m
  }

  // Regroupement (matériau, signature) — la signature d'envMerge se réduit ici à
  // l'indexation, seul attribut lu.
  const groups = new Map()
  const loose = []
  for (const p of prims) {
    if (!isOpaque(matOf(p.mat))) {
      loose.push(p)
      continue
    }
    const key = `${p.mat}|${p.index ? 'idx' : 'flat'}`
    const list = groups.get(key)
    if (list) list.push(p)
    else groups.set(key, [p])
  }

  const group = new Group()
  let tris = 0
  const push = (batch, material) => {
    let nVerts = 0
    let nIdx = 0
    for (const p of batch) {
      nVerts += p.positions.length / 3
      nIdx += p.index ? p.index.length : 0
    }
    const positions = new Float32Array(nVerts * 3)
    const index = batch[0].index ? new Uint32Array(nIdx) : null
    let vo = 0
    let io = 0
    for (const p of batch) {
      positions.set(p.positions, vo * 3)
      if (index) for (let i = 0; i < p.index.length; i++) index[io + i] = p.index[i] + vo
      vo += p.positions.length / 3
      io += p.index ? p.index.length : 0
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    if (index) geometry.setIndex(new BufferAttribute(index, 1))
    geometry.computeBoundingSphere()
    geometry.computeBoundingBox()
    group.add(new Mesh(geometry, material))
    tris += (index ? index.length : positions.length / 3) / 3
  }
  for (const [key, batch] of groups) {
    const material = matOf(batch[0].mat)
    // envMerge ne fusionne qu'à partir de deux meshes.
    if (batch.length < 2) loose.push(...batch)
    else push(batch, material)
    void key
  }
  for (const p of loose) push([p], matOf(p.mat))
  return { group, tris }
}

/** addEnvBackdrops : des plans DoubleSide, ajoutés avant la fusion, jamais fusionnés. */
function addBackdrops(group, backdrops) {
  for (const b of backdrops ?? []) {
    const material = new MeshBasicMaterial()
    material.side = DoubleSide
    const quad = new Mesh(new PlaneGeometry(b.size[0], b.size[1]), material)
    quad.position.set(b.center[0], b.center[1], b.center[2])
    quad.rotation.y = ((b.yawY ?? 0) * Math.PI) / 180
    group.add(quad)
  }
}

/** fitEnvironment, à l'identique (échelle du sidecar, calage au sol, point d'accueil). */
function place(group, sidecar) {
  group.position.set(0, 0, 0)
  group.rotation.set(0, ((sidecar.rotationY ?? 0) * Math.PI) / 180, 0)
  group.scale.setScalar(sidecar.scale ?? 1)
  group.updateMatrixWorld(true)
  let box = new Box3().setFromObject(group)
  const rawHeight = Math.max(box.getSize(new Vector3()).y, 1e-6)
  if (sidecar.scale === undefined && (rawHeight < 1.5 || rawHeight > 12)) {
    group.scale.multiplyScalar(2.6 / rawHeight)
    group.updateMatrixWorld(true)
    box = new Box3().setFromObject(group)
  }
  const [sx, sy, sz] = sidecar.spawn ?? [0, 0, 0]
  group.position.set(-sx, -(box.min.y + sy), -sz)
  group.updateMatrixWorld(true)
  group.matrixAutoUpdate = false
  group.matrixWorldAutoUpdate = false
}

// ── Le filtre du clic (vrmStage/estOpaqueAuClic), reproduit tel quel ────────

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

// ── Banc ───────────────────────────────────────────────────────────────────

const ALL = [
  'anime-classroom',
  'apartment-floorplan',
  'cozy-loft-room',
  'japanese-classroom',
  'lowpoly-restaurant',
  'rustic-bedroom',
  'small-cafe',
]
const ENVS = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ALL
const RAYS = 400
const BUDGET = 0.3 // ms — le seuil sous lequel un test au survol à 10 Hz est jouable

function stat(list) {
  const s = [...list].sort((a, b) => a - b)
  return {
    med: s[Math.floor(s.length / 2)] ?? 0,
    p95: s[Math.floor(s.length * 0.95)] ?? 0,
    max: s[s.length - 1] ?? 0,
  }
}

const query = []
const build = []
let worstP95 = 0
let mismatches = 0

for (const name of ENVS) {
  const file = path.join(ROOT, 'environments', `${name}.glb`)
  if (!fs.existsSync(file)) {
    console.log(`(${name} : absent d'environments/, ignoré)`)
    continue
  }
  const sidecar = JSON.parse(fs.readFileSync(path.join(ROOT, 'environments', `${name}.json`), 'utf8'))
  const { group, tris } = buildEnv(file, readGlb(file))
  addBackdrops(group, sidecar.backdrop)
  place(group, sidecar)
  const scene = new Scene()
  scene.add(group)

  const camera = new PerspectiveCamera(30, 16 / 9, 0.1, 20)
  camera.position.set(0, 1.35, sidecar.frameDistance ?? 3)
  camera.lookAt(0, 1.25, 0)
  camera.updateMatrixWorld(true)

  // Construction : les deux stratégies, pour que le choix se mesure.
  const bvhMedian = buildEnvBvh(group, 'median')
  const bvh = buildEnvBvh(group, 'sah')
  if (!bvh) {
    console.log(`(${name} : le BVH renonce — géométrie non représentable)`)
    continue
  }

  const raycaster = new Raycaster()
  const ndc = new Vector2()
  const setRay = (i) => {
    ndc.set(((i % 20) / 19) * 2 - 1, (Math.floor(i / 20) / 19) * 2 - 1)
    raycaster.setFromCamera(ndc, camera)
  }

  const pass = (fn) => {
    const times = []
    for (let i = 0; i < RAYS; i++) {
      setRay(i)
      const t0 = process.hrtime.bigint()
      fn()
      times.push(Number(process.hrtime.bigint() - t0) / 1e6)
    }
    return times
  }
  const three = () => premierImpactVisible(raycaster.intersectObject(group, true))
  const maison = () => raycastFirst(bvh, raycaster.ray.origin, raycaster.ray.direction, estOpaqueAuClic)
  const parMediane = () =>
    raycastFirst(bvhMedian, raycaster.ray.origin, raycaster.ray.direction, estOpaqueAuClic)

  // Une passe de chauffe chacun (le JIT a le droit de s'installer : dans
  // l'application, le premier clic n'est jamais le seul).
  pass(three)
  pass(maison)
  if (bvhMedian) pass(parMediane)

  // Vérité : les DEUX arbres doivent dire ce que dit three, sur les 400 rayons.
  // Un arbre coupé autrement reste le même décor — s'il répond autre chose,
  // c'est le parcours qui est en faute, pas la stratégie de coupe.
  let diff = 0
  const meme = (a, b) =>
    !a === !b && (!a || !b || (a.object === b.object && Math.abs(a.distance - b.distance) <= 1e-6))
  for (let i = 0; i < RAYS; i++) {
    setRay(i)
    const a = three()
    if (!meme(a, maison())) diff++
    if (bvhMedian && !meme(a, parMediane())) diff++
  }
  mismatches += diff

  const avant = stat(pass(three))
  const apres = stat(pass(maison))
  const mediane = bvhMedian ? stat(pass(parMediane)) : null
  worstP95 = Math.max(worstP95, apres.p95)
  query.push({ name, meshes: group.children.length, tris, avant, apres, diff })
  build.push({
    name,
    sah: bvh.buildMs,
    sahP95: apres.p95,
    median: bvhMedian ? bvhMedian.buildMs : NaN,
    medianP95: mediane ? mediane.p95 : NaN,
    bytes: bvh.bytes,
    triangles: bvh.triangles,
  })
}

const f = (v, w = 8, d = 3) => v.toFixed(d).padStart(w)
console.log('\n── Coût d’un lancer de rayon, 400 rayons de grille (ms) ──')
console.log('décor                mesh     tris |  three: méd      p95      max |    BVH: méd      p95      max |  gain p95')
for (const r of query) {
  const gain = r.apres.p95 > 0 ? r.avant.p95 / r.apres.p95 : Infinity
  console.log(
    `${r.name.padEnd(20)}${String(r.meshes).padStart(5)}${String(r.tris).padStart(9)} |` +
      `${f(r.avant.med)}${f(r.avant.p95)}${f(r.avant.max)} |` +
      `${f(r.apres.med)}${f(r.apres.p95)}${f(r.apres.max)} |` +
      `${gain.toFixed(0).padStart(8)}×${r.diff ? `  ⚠ ${r.diff} ÉCARTS` : ''}`,
  )
}

// Le choix de la coupe se MESURE : la SAH bâtit plus lentement, elle doit le
// rendre à la requête, sinon la médiane (plus simple, plus rapide à bâtir) gagne.
console.log('\n── Construction (une fois par décor, au chargement) ──')
console.log('décor                triangles |  SAH: bâti   p95 req. |  médiane: bâti   p95 req. |   mémoire')
for (const b of build) {
  console.log(
    `${b.name.padEnd(20)}${String(b.triangles).padStart(10)} |` +
      `${f(b.sah, 11, 1)}${f(b.sahP95, 11, 4)} |` +
      `${f(b.median, 15, 1)}${f(b.medianP95, 11, 4)} |` +
      `${(b.bytes / 1048576).toFixed(2).padStart(9)} Mo`,
  )
}

console.log(
  `\np95 le plus mauvais, tous décors : ${worstP95.toFixed(3)} ms — ` +
    `budget du curseur au survol (10 Hz) : ${BUDGET} ms → ${worstP95 < BUDGET ? 'TENU' : 'DÉPASSÉ'}.`,
)
if (mismatches > 0) console.log(`⚠ ${mismatches} rayons où le BVH et three ne disent PAS la même chose.`)
else console.log('Les deux chemins rendent le même impact sur tous les rayons.')
