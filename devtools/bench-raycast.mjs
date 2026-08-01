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
//
// Enfin il chiffre le PERSONNAGE, que le BVH ne couvre pas et ne couvrira pas.
// `viser` interroge le décor ET l'avatar : un budget qui n'en compterait qu'un
// serait un budget faux, et c'est ce total qui décide du curseur au survol.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

const {
  Bone,
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
  LineBasicMaterial,
  LineSegments,
  Scene,
  Skeleton,
  SkinnedMesh,
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
  const lines = []
  const scene = json.scenes[json.scene ?? 0]
  const walk = (nodeIndex, parent) => {
    const node = json.nodes[nodeIndex]
    const world = new Matrix4().multiplyMatrices(parent, nodeMatrix(node))
    if (node.mesh !== undefined) {
      for (const p of json.meshes[node.mesh].primitives) {
        // LIGNES (mode 1). GLTFLoader en fait des LineSegments, que three
        // intersecte avec `params.Line.threshold` — elles arrêtent donc les
        // clics. lowpoly-restaurant en porte trois segments : c'est le seul
        // décor qui met à l'épreuve la liste `rest` du BVH, et sans elles le
        // banc validerait un arbre qui perd de la géométrie en silence.
        if (p.mode === 1 || p.mode === 3) {
          const lp = readAccessor(json, bin, p.attributes.POSITION)
          const lv = new Vector3()
          for (let i = 0; i < lp.length; i += 3) {
            lv.set(lp[i], lp[i + 1], lp[i + 2]).applyMatrix4(world)
            lp[i] = lv.x
            lp[i + 1] = lv.y
            lp[i + 2] = lv.z
          }
          lines.push(lp)
          continue
        }
        if (p.mode !== undefined && p.mode !== 4) continue
        const pos = readAccessor(json, bin, p.attributes.POSITION)
        const v = new Vector3()
        for (let i = 0; i < pos.length; i += 3) {
          v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(world)
          pos[i] = v.x
          pos[i + 1] = v.y
          pos[i + 2] = v.z
        }
        // Les indices gardent le type du .glb (Uint16 le plus souvent) : c'est
        // ce que voit un mesh que mergeEnvironment laisse tranquille, et c'est
        // ce qui met sous le banc le chemin de recopie du BVH.
        const idx = p.indices !== undefined ? readAccessor(json, bin, p.indices) : null
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
    let positions
    let index
    if (batch.length === 1) {
      // Un mesh que la fusion laisse tranquille garde EXACTEMENT ses tampons.
      positions = batch[0].positions
      index = batch[0].index
    } else {
      let nVerts = 0
      let nIdx = 0
      for (const p of batch) {
        nVerts += p.positions.length / 3
        nIdx += p.index ? p.index.length : 0
      }
      positions = new Float32Array(nVerts * 3)
      // mergeGeometries réindexe en Uint32 : le lot fusionné passe la barre des
      // 65 536 sommets bien plus souvent qu'une primitive isolée.
      index = batch[0].index ? new Uint32Array(nIdx) : null
      let vo = 0
      let io = 0
      for (const p of batch) {
        positions.set(p.positions, vo * 3)
        if (index) for (let i = 0; i < p.index.length; i++) index[io + i] = p.index[i] + vo
        vo += p.positions.length / 3
        io += p.index ? p.index.length : 0
      }
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
  // Les lignes ne sont jamais fusionnées (mergeEnvironment ne voit que les Mesh) :
  // elles restent des LineSegments à part entière, comme chez GLTFLoader.
  for (const lp of lines) {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(lp, 3))
    geometry.computeBoundingSphere()
    group.add(new LineSegments(geometry, new LineBasicMaterial()))
  }
  return { group, tris, lines: lines.length }
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

// ── L'avatar, que le BVH ne couvre PAS ─────────────────────────────────────
//
// `viser` interroge DEUX choses : le décor (l'arbre, désormais) et le
// personnage — et lui n'a pas le choix du lancer de rayon de three, sa peau est
// animée, ses sommets ne sont pas ceux du tampon. Un curseur au survol paie
// donc les deux, dix fois par seconde : chiffrer l'arbre sans chiffrer le
// personnage ne dirait RIEN du budget réel.
//
// Le maillage est remonté tel quel depuis le .vrm (positions, indices,
// JOINTS_0, WEIGHTS_0) sur un squelette d'os à l'identité. Les VALEURS des
// matrices d'os ne changent pas le travail fait par sommet — applyBoneTransform
// compose quatre matrices quoi qu'elles vaillent — et le compte de triangles,
// lui, est celui du vrai modèle.

/** L'en-tête JSON d'un .glb, sans lire ses mégaoctets de textures. */
function readGlbJson(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(20)
    fs.readSync(fd, head, 0, 20, 0)
    const jsonLen = head.readUInt32LE(12)
    const body = Buffer.alloc(jsonLen)
    fs.readSync(fd, body, 0, jsonLen, 20)
    return JSON.parse(body.toString('utf8'))
  } finally {
    fs.closeSync(fd)
  }
}

/** Triangles des primitives À PEAU : celles que le rayon paiera vraiment. */
function skinnedTriangles(json) {
  let tris = 0
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives ?? []) {
      if (p.mode !== undefined && p.mode !== 4) continue
      if (p.attributes?.JOINTS_0 === undefined) continue
      const acc = json.accessors[p.indices !== undefined ? p.indices : p.attributes.POSITION]
      tris += Math.floor(acc.count / 3)
    }
  }
  return tris
}

/**
 * Les deux extrêmes de vrm/. Le plus lourd donne le pire cas ; le plus LÉGER
 * est le chiffre qui tranche vraiment — si même lui dépasse le budget, aucun
 * modèle ne le tient, et la question est close pour tout le monde.
 */
function extremesVrm() {
  const dir = path.join(ROOT, 'vrm')
  if (!fs.existsSync(dir)) return null
  const all = []
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.vrm')) continue
    try {
      all.push({ name, tris: skinnedTriangles(readGlbJson(path.join(dir, name))) })
    } catch {
      continue // .vrm illisible : ce n'est pas le sujet du banc
    }
  }
  if (all.length === 0) return null
  all.sort((a, b) => a.tris - b.tris)
  return { leger: all[0], lourd: all[all.length - 1], total: all.length, median: all[all.length >> 1].tris }
}

/** Le personnage remonté en SkinnedMesh, prêt pour intersectObject. */
function buildAvatar(file) {
  const { json, bin } = readGlb(file)
  const boneCount = Math.max(1, ...(json.skins ?? []).map((s) => s.joints.length))
  const bones = []
  for (let i = 0; i < boneCount; i++) bones.push(new Bone())
  const root = new Group()
  for (const b of bones) root.add(b)
  const skeleton = new Skeleton(bones)

  const attr = (index, itemSize) => {
    const acc = json.accessors[index]
    return new BufferAttribute(readAccessor(json, bin, index), itemSize, acc.normalized === true)
  }
  let tris = 0
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives ?? []) {
      if (p.mode !== undefined && p.mode !== 4) continue
      if (p.attributes?.JOINTS_0 === undefined) continue
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', attr(p.attributes.POSITION, 3))
      geometry.setAttribute('skinIndex', attr(p.attributes.JOINTS_0, 4))
      geometry.setAttribute('skinWeight', attr(p.attributes.WEIGHTS_0, 4))
      if (p.indices !== undefined) geometry.setIndex(attr(p.indices, 1))
      const skinned = new SkinnedMesh(geometry, new MeshBasicMaterial())
      skinned.bind(skeleton)
      root.add(skinned)
      tris += (p.indices !== undefined ? json.accessors[p.indices].count : geometry.attributes.position.count) / 3
    }
  }
  root.updateMatrixWorld(true)
  return { root, tris: Math.floor(tris) }
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
/**
 * Azimuts de VÉRIFICATION (degrés). Les mesures, elles, restent au cadrage par
 * défaut pour rester comparables. Un seul point de vue ne prouverait rien : le
 * décor est orbitable, et les vues alignées sur les axes ont leur propre
 * pathologie (rayons parallèles à un axe → `0 × ∞` → NaN dans le test des
 * boîtes englobantes).
 */
const AZIMUTS = [0, 45, 90, 135, 180, 225, 270, 315]

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
let checked = 0

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
  const dist = sidecar.frameDistance ?? 3
  /**
   * La caméra du cadrage par défaut, tournée de `az` autour du personnage.
   * L'utilisateur ORBITE : vérifier un seul azimut validerait un arbre qui se
   * trompe dès qu'on tourne. Les vues alignées sur les axes (90°, 180°, 270°)
   * sont en plus les seules qui produisent des rayons parallèles à un axe —
   * exactement le cas où `0 × ∞` donne NaN dans le test des boîtes.
   */
  const placeCamera = (az) => {
    camera.position.set(Math.sin(az) * dist, 1.35, Math.cos(az) * dist)
    camera.lookAt(0, 1.25, 0)
    camera.updateMatrixWorld(true)
  }
  placeCamera(0)

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
  // viserDecor() de vrmStage, à l'identique : l'arbre, PUIS ce qu'il n'a pas su
  // indexer, et le plus proche des deux gagne. Le banc doit mesurer et vérifier
  // le chemin réel de l'application, pas une version de l'arbre toute seule.
  const parArbre = (a) => {
    let best = raycastFirst(a, raycaster.ray.origin, raycaster.ray.direction, estOpaqueAuClic)
    for (const objet of a.rest) {
      const hit = premierImpactVisible(raycaster.intersectObject(objet, false))
      if (hit && (!best || hit.distance < best.distance)) best = hit
    }
    return best
  }
  const maison = () => parArbre(bvh)
  const parMediane = () => parArbre(bvhMedian)

  // Une passe de chauffe chacun (le JIT a le droit de s'installer : dans
  // l'application, le premier clic n'est jamais le seul).
  pass(three)
  pass(maison)
  if (bvhMedian) pass(parMediane)

  // Vérité : les DEUX arbres doivent dire ce que dit three, sur les 400 rayons.
  // Un arbre coupé autrement reste le même décor — s'il répond autre chose,
  // c'est le parcours qui est en faute, pas la stratégie de coupe.
  let diff = 0
  // Rayons que three fait atterrir sur autre chose qu'un Mesh — une ligne, donc.
  // Ce compte n'est pas décoratif : il dit si la liste `rest` est réellement
  // MISE À L'ÉPREUVE sur ce décor, ou si le filet est tendu pour rien. Sans lui,
  // « zéro écart » sur lowpoly-restaurant pourrait vouloir dire « la ligne n'a
  // jamais été touchée » plutôt que « la ligne est bien prise en compte ».
  let surLigne = 0
  let verifies = 0
  const meme = (a, b) =>
    !a === !b && (!a || !b || (a.object === b.object && Math.abs(a.distance - b.distance) <= 1e-6))
  for (const az of AZIMUTS) {
    placeCamera((az * Math.PI) / 180)
    for (let i = 0; i < RAYS; i++) {
      setRay(i)
      const a = three()
      if (a && a.object.isMesh !== true) surLigne++
      if (!meme(a, maison())) diff++
      if (bvhMedian && !meme(a, parMediane())) diff++
      verifies++
    }
  }
  placeCamera(0) // les mesures se font toutes depuis le cadrage par défaut
  mismatches += diff
  checked += verifies
  if (surLigne > 0) {
    console.log(
      `(${name} : ${surLigne} rayons sur ${verifies} atterrissent sur une ligne — liste « hors arbre » éprouvée)`,
    )
  }

  const avant = stat(pass(three))
  const apres = stat(pass(maison))
  const mediane = bvhMedian ? stat(pass(parMediane)) : null
  worstP95 = Math.max(worstP95, apres.p95)
  query.push({ name, meshes: group.children.length, hors: bvh.rest.length, tris, avant, apres, diff })
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
// « hors » = objets laissés à three (EnvBvh.rest) : lignes, peau animée…
console.log('décor                objets  hors     tris |  three: méd      p95      max |    BVH: méd      p95      max |  gain p95')
for (const r of query) {
  const gain = r.apres.p95 > 0 ? r.avant.p95 / r.apres.p95 : Infinity
  console.log(
    `${r.name.padEnd(20)}${String(r.meshes).padStart(6)}${String(r.hors).padStart(6)}${String(r.tris).padStart(9)} |` +
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

// ── Le personnage, et le budget d'un survol complet ────────────────────────

let avatarP95 = 0
const vrms = extremesVrm()
if (vrms) {
  console.log('\n── Le personnage (three, et il n’y a pas le choix : peau animée) ──')
  console.log(
    `${vrms.total} modèles dans vrm/ — de ${vrms.leger.tris} à ${vrms.lourd.tris} ` +
      `triangles à peau (médiane ${vrms.median})`,
  )
  console.log('modèle                                       tris à peau |     méd      p95      max')
  for (const cible of [vrms.leger, vrms.lourd]) {
    const { root, tris } = buildAvatar(path.join(ROOT, 'vrm', cible.name))
    const scene = new Scene()
    scene.add(root)
    const camera = new PerspectiveCamera(30, 16 / 9, 0.1, 20)
    camera.position.set(0, 1.35, 3)
    camera.lookAt(0, 1.25, 0)
    camera.updateMatrixWorld(true)
    const raycaster = new Raycaster()
    const ndc = new Vector2()
    const shoot = () => {
      const times = []
      for (let i = 0; i < RAYS; i++) {
        ndc.set(((i % 20) / 19) * 2 - 1, (Math.floor(i / 20) / 19) * 2 - 1)
        raycaster.setFromCamera(ndc, camera)
        const t0 = process.hrtime.bigint()
        premierImpactVisible(raycaster.intersectObject(root, true))
        times.push(Number(process.hrtime.bigint() - t0) / 1e6)
      }
      return times
    }
    shoot() // chauffe
    const s = stat(shoot())
    // Le plus LÉGER fixe le plancher du budget : c'est lui qui décide.
    if (cible === vrms.leger) avatarP95 = s.p95
    console.log(`${cible.name.slice(0, 42).padEnd(42)}${String(tris).padStart(13)} |${f(s.med)}${f(s.p95)}${f(s.max)}`)
  }
  // La médiane du personnage est quasi nulle et son p95 énorme : la sphère
  // englobante rejette les rayons qui partent à côté, et fait payer PLEIN
  // TARIF ceux qui l'effleurent. C'est le p95 qui compte — le curseur suit le
  // pointeur, et le pointeur passe sur le personnage.
} else {
  console.log('\n(aucun .vrm dans vrm/ : le coût du personnage n’est pas mesuré)')
}

// Le budget d'un survol, c'est ce que coûte viser() EN ENTIER : le décor par
// l'arbre, PLUS le personnage par three. C'est ce total qui décide du curseur.
const survol = worstP95 + avatarP95
console.log(
  `\np95 le plus mauvais, tous décors : ${worstP95.toFixed(3)} ms` +
    (avatarP95 ? ` + personnage le plus léger ${avatarP95.toFixed(3)} ms = ${survol.toFixed(3)} ms` : '') +
    `\nbudget d’un survol à 10 Hz : ${BUDGET} ms → ${survol < BUDGET ? 'TENU' : 'DÉPASSÉ'}.`,
)
if (mismatches > 0) console.log(`⚠ ${mismatches} rayons où le BVH et three ne disent PAS la même chose.`)
else console.log(`Les deux chemins rendent le même impact sur les ${checked} rayons vérifiés.`)
