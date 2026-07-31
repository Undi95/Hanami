// ════════════════════════════════════════════════════════════════════════════
// scene.mjs — CHARGEMENT SANS NAVIGATEUR d'un .vrm et d'un .vrma, et
// échantillonnage de la pose à un instant donné.
//
// Le squelette est monté à la main depuis le glTF, exactement comme
// devtools/anim-lab/sonde.mjs (rigVrm) — c'est le patron éprouvé : aucun DOM, aucune
// texture, aucun WebGL, et pourtant le VRAI VRMHumanoid, donc les mêmes os
// normalisés que ceux que les pistes .vrma écrivent dans l'app.
//
// Nouveauté par rapport à la sonde : on lit AUSSI le maillage (positions,
// influences osseuses, triangles) pour pouvoir dessiner un CORPS et pas
// seulement des os. La déformation par le squelette (skinning linéaire) est
// refaite à la main, en une vingtaine de lignes — c'est de l'algèbre, pas une
// dépendance.
//
// Lecture seule : <racine>/vrm, <racine>/vrma, <racine>/node_modules.
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Le banc de rendu vit dans devtools/diagnostic/rendu/ : la racine du dépôt est
// trois crans au-dessus. Aucun chemin en dur.
const ICI = path.dirname(fileURLToPath(import.meta.url))
export const PROJET = process.env.HANAMI_ROOT || path.resolve(ICI, '..', '..', '..')
const NM = 'file:///' + PROJET.replace(/\\/g, '/').replace(/ /g, '%20') + '/node_modules/'
export const DOSSIER_VRM = path.join(PROJET, 'vrm')
export const DOSSIER_VRMA = path.join(PROJET, 'vrma')

export const THREE = await import(NM + 'three/build/three.module.js')
const { GLTFLoader } = await import(NM + 'three/examples/jsm/loaders/GLTFLoader.js')
const { VRMHumanoid } = await import(NM + '@pixiv/three-vrm/lib/three-vrm.module.js')
const { VRMAnimationLoaderPlugin, createVRMAnimationClip } = await import(
  NM + '@pixiv/three-vrm-animation/lib/three-vrm-animation.module.js'
)

export const EPS = 1e-4 // dernière image : jamais t = durée (LoopRepeat reboucle)
export const HANCHES_RIG_MESURE = 1.0167 // m — rig sur lequel world.json est mesuré

// Pose de repos anti T-pose, reprise TELLE QUELLE de vrmStage.ts / index.html :
// c'est elle que le lecteur restaure pour un os que le clip n'anime pas. Un
// banc qui poserait la T-pose montrerait des bras en croix qu'on ne voit jamais
// dans l'app.
const REPOS_Z = [
  ['leftUpperArm', 1.25], ['rightUpperArm', -1.25],
  ['leftLowerArm', 0.12], ['rightLowerArm', -0.12],
]

// ── glTF binaire ────────────────────────────────────────────────────────────

function lireGLB(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('ce fichier n’est pas un GLB')
  let o = 12
  let json = null, bin = null
  while (o + 8 <= buf.byteLength) {
    const lg = dv.getUint32(o, true)
    const type = dv.getUint32(o + 4, true)
    const corps = buf.subarray(o + 8, o + 8 + lg)
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(corps))
    else if (type === 0x004e4942) bin = corps
    o += 8 + lg + ((4 - (lg % 4)) % 4)
  }
  if (!json) throw new Error('GLB sans bloc JSON')
  return { json, bin }
}

const TAILLE_COMP = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const NB_COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
const NORMALISE = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }

/** Lit un accesseur glTF en Float32Array (ou Uint32Array si `entier`). */
function accesseur(json, bin, idx, entier = false) {
  const a = json.accessors[idx]
  const nc = NB_COMP[a.type]
  const n = a.count * nc
  const out = entier ? new Uint32Array(n) : new Float32Array(n)
  if (a.bufferView == null) return out // accesseur nul (tout à zéro)
  const bv = json.bufferViews[a.bufferView]
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const tc = TAILLE_COMP[a.componentType]
  const pas = bv.byteStride || tc * nc
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
  const echelle = a.normalized && !entier ? 1 / NORMALISE[a.componentType] : 1
  for (let i = 0; i < a.count; i++) {
    const o = base + i * pas
    for (let c = 0; c < nc; c++) {
      const p = o + c * tc
      let v
      switch (a.componentType) {
        case 5120: v = dv.getInt8(p); break
        case 5121: v = dv.getUint8(p); break
        case 5122: v = dv.getInt16(p, true); break
        case 5123: v = dv.getUint16(p, true); break
        case 5125: v = dv.getUint32(p, true); break
        default: v = dv.getFloat32(p, true)
      }
      out[i * nc + c] = entier ? v : v * echelle
    }
  }
  return out
}

// ── Chargement d'un modèle ──────────────────────────────────────────────────

/** Teinte d'un matériau, ramenée à une CLARTÉ : on ne veut pas de couleurs
 *  criardes, juste distinguer les cheveux sombres de la peau claire. */
function clarteMateriau(json, i) {
  const m = json.materials?.[i]
  if (!m) return 1
  let c = m.pbrMetallicRoughness?.baseColorFactor
  const mp = json.extensions?.VRM?.materialProperties?.[i]
  if (mp?.vectorProperties?._Color) c = mp.vectorProperties._Color
  if (!c) return 1
  return Math.max(0, Math.min(1, 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]))
}

/**
 * Charge un .vrm : squelette humanoïde + (optionnellement) maillage déformable.
 * @param {string} fichier chemin du .vrm
 * @param {{maillage?: boolean}} opts
 */
export function chargerModele(fichier, { maillage = true } = {}) {
  const brut = fs.readFileSync(fichier)
  const { json, bin } = lireGLB(brut)
  const ext1 = json.extensions?.VRMC_vrm
  const ext0 = json.extensions?.VRM
  const version = ext1 ? '1' : '0'
  const def = {}
  if (ext1) for (const [k, v] of Object.entries(ext1.humanoid.humanBones)) def[k] = v.node
  else if (ext0) for (const b of ext0.humanoid.humanBones) def[b.bone] = b.node
  else throw new Error(`aucune extension VRM dans ${path.basename(fichier)}`)

  // Hiérarchie complète des nœuds (le maillage a besoin de tous, pas seulement
  // des os humanoïdes : les os de jupe ou de cheveux portent des sommets).
  const objs = json.nodes.map((d) => {
    const o = new THREE.Object3D()
    o.name = d.name ?? ''
    if (d.matrix) new THREE.Matrix4().fromArray(d.matrix).decompose(o.position, o.quaternion, o.scale)
    else {
      o.position.fromArray(d.translation ?? [0, 0, 0])
      o.quaternion.fromArray(d.rotation ?? [0, 0, 0, 1])
      o.scale.fromArray(d.scale ?? [1, 1, 1])
    }
    o.matrixAutoUpdate = true
    return o
  })
  const aParent = new Set()
  json.nodes.forEach((d, i) => (d.children ?? []).forEach((c) => { objs[i].add(objs[c]); aParent.add(c) }))
  const scene = new THREE.Group()
  for (let i = 0; i < objs.length; i++) if (!aParent.has(i)) scene.add(objs[i])
  scene.updateWorldMatrix(false, true)

  const humanBones = {}
  for (const [k, ni] of Object.entries(def)) if (objs[ni]) humanBones[k] = { node: objs[ni] }
  const humanoid = new VRMHumanoid(humanBones)
  scene.add(humanoid.normalizedHumanBonesRoot)
  // VRMUtils.rotateVRM0 à l'identique : un VRM 0.x regarde le −Z, l'app le
  // retourne pour qu'il fasse face au +Z. Sans ça l'« avant » est inversé.
  if (version === '0') scene.rotation.y = Math.PI
  scene.updateWorldMatrix(false, true)

  const vrm = { humanoid, meta: { metaVersion: version }, expressionManager: null, lookAt: null, scene }
  const osBruts = new Map(Object.entries(humanBones).map(([n, b]) => [n, b.node]))
  const nb = humanoid.normalizedHumanBones
  const osTous = Object.keys(nb)
  const adapt = {
    osTous,
    noeudOs: new Map(osTous.map((os) => [nb[os].node.name, os])),
    reposQ: new Map(osTous.map((os) => [os, nb[os].node.quaternion.clone()])),
    reposHips: nb.hips.node.position.clone(),
    scene,
    noeudNorm: (os) => nb[os]?.node ?? null,
    noeudBrut: (os) => osBruts.get(os) ?? null,
    majHumanoide: () => { humanoid.update(); scene.updateWorldMatrix(false, true) },
  }
  for (const [nom, z] of REPOS_Z) {
    const n = adapt.noeudNorm(nom)
    if (n) { n.rotation.z = z; adapt.reposQ.set(nom, n.quaternion.clone()) }
  }
  adapt.majHumanoide()

  const modele = {
    fichier, nom: path.basename(fichier).replace(/\.(deob\.)?vrm$/i, ''), version,
    json, vrm, adapt, objs, peaux: null,
  }
  modele.hanchesRepos = hanchesAuRepos(modele)
  modele.echelle = modele.hanchesRepos / HANCHES_RIG_MESURE
  if (maillage) modele.peaux = extrairePeaux(json, bin, objs)
  return modele
}

/**
 * Extrait les primitives déformables : sommets, influences, triangles.
 * Ne garde que les sommets RÉELLEMENT indexés — certains VRM embarquent des
 * tampons de 1,2 million de sommets pour 36 000 triangles (buffers partagés
 * entre primitives), les déformer tous coûterait cent fois trop cher.
 */
function extrairePeaux(json, bin, objs) {
  const peaux = []
  for (let iNoeud = 0; iNoeud < json.nodes.length; iNoeud++) {
    const noeud = json.nodes[iNoeud]
    if (noeud.mesh == null) continue
    const mesh = json.meshes[noeud.mesh]
    for (const prim of mesh.primitives) {
      if (prim.mode != null && prim.mode !== 4) continue // triangles seulement
      if (prim.indices == null) continue
      const idx = accesseur(json, bin, prim.indices, true)
      if (!idx.length) continue
      // Compaction : table des sommets réellement utilisés.
      const vus = new Map()
      const tri = new Uint32Array(idx.length)
      for (let i = 0; i < idx.length; i++) {
        let n = vus.get(idx[i])
        if (n === undefined) { n = vus.size; vus.set(idx[i], n) }
        tri[i] = n
      }
      const nv = vus.size
      const posSrc = accesseur(json, bin, prim.attributes.POSITION)
      const pos = new Float32Array(nv * 3)
      for (const [src, dst] of vus) {
        pos[dst * 3] = posSrc[src * 3]
        pos[dst * 3 + 1] = posSrc[src * 3 + 1]
        pos[dst * 3 + 2] = posSrc[src * 3 + 2]
      }
      let jnt = null, poids = null
      if (noeud.skin != null && prim.attributes.JOINTS_0 != null) {
        const js = accesseur(json, bin, prim.attributes.JOINTS_0, true)
        const ws = accesseur(json, bin, prim.attributes.WEIGHTS_0)
        jnt = new Uint16Array(nv * 4)
        poids = new Float32Array(nv * 4)
        for (const [src, dst] of vus) {
          for (let c = 0; c < 4; c++) {
            jnt[dst * 4 + c] = js[src * 4 + c]
            poids[dst * 4 + c] = ws[src * 4 + c]
          }
        }
      }
      peaux.push({
        noeud: objs[iNoeud], iNoeud, skin: noeud.skin ?? null, pos, tri, jnt, poids,
        nv, clarte: clarteMateriau(json, prim.material),
        sortie: new Float32Array(nv * 3),
      })
    }
  }
  // Matrices de liaison inverse, une fois pour toutes.
  const skins = (json.skins ?? []).map((s) => ({
    joints: s.joints,
    ibm: s.inverseBindMatrices != null ? accesseur(json, bin, s.inverseBindMatrices) : null,
  }))
  return { primitives: peaux, skins, objs }
}

// ── Pose ────────────────────────────────────────────────────────────────────

const IDENT = { x: 0, y: 0, z: 0, w: 1 }

/** Applique une pose au rig et rend les positions MONDE de tous les os humanoïdes. */
export function appliquer(modele, pose) {
  const { adapt } = modele
  for (const os of adapt.osTous) {
    const n = adapt.noeudNorm(os)
    if (n) n.quaternion.copy(pose.q?.get(os) ?? adapt.reposQ.get(os) ?? IDENT)
  }
  const h = adapt.noeudNorm('hips')
  if (h) h.position.copy(pose.p ?? adapt.reposHips)
  adapt.majHumanoide()
  const out = new Map()
  for (const os of adapt.osTous) {
    const o = adapt.noeudBrut(os)
    if (o) out.set(os, o.getWorldPosition(new THREE.Vector3()))
  }
  return out
}

/** Hauteur de hanches au repos — dénominateur de toutes les fractions de world.json. */
export function hanchesAuRepos(modele) {
  const p = appliquer(modele, { q: new Map(), p: modele.adapt.reposHips })
  return p.get('hips')?.y ?? NaN
}

/**
 * AVANT du personnage déduit de la géométrie des épaules (jamais du quaternion
 * du bassin, qui n'a pas la même convention d'un rig à l'autre).
 */
export function avantGeometrique(modele) {
  const a = modele.adapt
  const g = a.noeudBrut('leftShoulder') ?? a.noeudBrut('leftUpperArm')
  const d = a.noeudBrut('rightShoulder') ?? a.noeudBrut('rightUpperArm')
  const out = new THREE.Vector3(0, 0, 1)
  if (!g || !d) return out
  const cote = d.getWorldPosition(new THREE.Vector3()).sub(g.getWorldPosition(new THREE.Vector3()))
  cote.y = 0
  if (cote.lengthSq() < 1e-8) return out
  return out.set(0, 1, 0).cross(cote.normalize()).normalize()
}

// ── Déformation du maillage ─────────────────────────────────────────────────

const M4 = new THREE.Matrix4()
const M4b = new THREE.Matrix4()

/** Matrices de déformation d'une peau, pour la pose courante du squelette. */
function matricesSkin(P, iSkin) {
  const s = P.skins[iSkin]
  const mats = new Float32Array(s.joints.length * 16)
  for (let j = 0; j < s.joints.length; j++) {
    M4.copy(P.objs[s.joints[j]].matrixWorld)
    if (s.ibm) { M4b.fromArray(s.ibm, j * 16); M4.multiply(M4b) }
    mats.set(M4.elements, j * 16)
  }
  return mats
}

/**
 * Déforme toutes les primitives par le squelette dans sa pose COURANTE.
 * Skinning linéaire classique : p' = Σ wᵢ · (matriceMondeOsᵢ · liaisonInverseᵢ) · p.
 * Doit être appelé APRÈS appliquer().
 */
export function deformer(modele) {
  const P = modele.peaux
  if (!P) return null
  const cacheSkin = new Map()
  for (const prim of P.primitives) {
    const { pos, sortie, nv } = prim
    if (prim.skin == null || !prim.jnt) {
      // Primitive rigide : la matrice du nœud suffit.
      const m = prim.noeud.matrixWorld.elements
      for (let i = 0; i < nv; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
        sortie[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12]
        sortie[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
        sortie[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
      }
      continue
    }
    let mats = cacheSkin.get(prim.skin)
    if (!mats) { mats = matricesSkin(P, prim.skin); cacheSkin.set(prim.skin, mats) }
    const { jnt, poids } = prim
    for (let i = 0; i < nv; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
      let ax = 0, ay = 0, az = 0, tot = 0
      for (let c = 0; c < 4; c++) {
        const w = poids[i * 4 + c]
        if (w === 0) continue
        const o = jnt[i * 4 + c] * 16
        ax += w * (mats[o] * x + mats[o + 4] * y + mats[o + 8] * z + mats[o + 12])
        ay += w * (mats[o + 1] * x + mats[o + 5] * y + mats[o + 9] * z + mats[o + 13])
        az += w * (mats[o + 2] * x + mats[o + 6] * y + mats[o + 10] * z + mats[o + 14])
        tot += w
      }
      if (tot > 1e-6 && Math.abs(tot - 1) > 1e-3) { ax /= tot; ay /= tot; az /= tot }
      sortie[i * 3] = ax; sortie[i * 3 + 1] = ay; sortie[i * 3 + 2] = az
    }
  }
  return P.primitives
}

// ── Semelles : le VRAI contact au sol ───────────────────────────────────────
//
// PIÈGE MAJEUR, et il a failli passer : l'os `toes` d'un VRM debout et à plat
// est à 3,5 cm AU-DESSUS du sol, l'os `foot` (la cheville) à 9 cm. Prendre la
// hauteur d'un os pour la hauteur du pied, puis appeler « sol » le minimum
// atteint pendant le clip, donne une marche où les DEUX pieds sont en vol
// pendant 80 % du cycle — un non-sens que seul le chiffre trahit.
//
// La semelle, c'est le point le plus bas du MAILLAGE du pied. Et le sol, c'est
// y = 0 : la valeur absolue où l'application pose le personnage. Ainsi une
// pénétration sous le plancher se voit au lieu d'être absorbée dans la
// définition du sol.

/** Repère une fois pour toutes les sommets qui appartiennent à chaque pied. */
export function preparerSemelles(modele) {
  if (!modele.peaux || modele.semelles !== undefined) return modele.semelles ?? null
  const sousArbre = (racine) => {
    const s = new Set()
    ;(function rec(o) { s.add(o); for (const c of o.children) rec(c) })(racine)
    return s
  }
  const g = modele.adapt.noeudBrut('leftFoot'), d = modele.adapt.noeudBrut('rightFoot')
  if (!g || !d) { modele.semelles = null; return null }
  const SG = sousArbre(g), SD = sousArbre(d)
  const listes = { g: [], d: [] }
  for (const prim of modele.peaux.primitives) {
    if (!prim.jnt || prim.skin == null) continue
    const joints = modele.peaux.skins[prim.skin].joints
    for (let i = 0; i < prim.nv; i++) {
      let meilleur = 0, jm = -1
      for (let c = 0; c < 4; c++) {
        const w = prim.poids[i * 4 + c]
        if (w > meilleur) { meilleur = w; jm = prim.jnt[i * 4 + c] }
      }
      if (jm < 0) continue
      const noeud = modele.peaux.objs[joints[jm]]
      if (SG.has(noeud)) listes.g.push(prim, i)
      else if (SD.has(noeud)) listes.d.push(prim, i)
    }
  }
  modele.semelles = listes.g.length && listes.d.length ? listes : null
  return modele.semelles
}

/**
 * Hauteur du point le plus bas de chaque pied, pour la pose COURANTE.
 * Ne déforme que les quelques centaines de sommets des pieds : appelable à
 * chaque image d'un relevé à 60 img/s sans y penser.
 */
export function hauteurSemelles(modele) {
  const L = preparerSemelles(modele)
  if (!L) return null
  const P = modele.peaux
  const cache = new Map()
  const out = {}
  for (const cote of ['g', 'd']) {
    let bas = Infinity
    const liste = L[cote]
    for (let k = 0; k < liste.length; k += 2) {
      const prim = liste[k], i = liste[k + 1]
      let mats = cache.get(prim.skin)
      if (!mats) { mats = matricesSkin(P, prim.skin); cache.set(prim.skin, mats) }
      const x = prim.pos[i * 3], y = prim.pos[i * 3 + 1], z = prim.pos[i * 3 + 2]
      let ay = 0, tot = 0
      for (let c = 0; c < 4; c++) {
        const w = prim.poids[i * 4 + c]
        if (w === 0) continue
        const o = prim.jnt[i * 4 + c] * 16
        ay += w * (mats[o + 1] * x + mats[o + 5] * y + mats[o + 9] * z + mats[o + 13])
        tot += w
      }
      if (tot > 1e-6 && Math.abs(tot - 1) > 1e-3) ay /= tot
      if (ay < bas) bas = ay
    }
    out[cote] = bas
  }
  return out
}

// ── Clips ───────────────────────────────────────────────────────────────────

function chargerVRMA(buf) {
  const loader = new GLTFLoader()
  loader.register((p) => new VRMAnimationLoaderPlugin(p))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Promise((res, rej) => loader.parse(ab, '', res, rej))
}

let WORLD = null
try { WORLD = JSON.parse(fs.readFileSync(path.join(DOSSIER_VRMA, 'world.json'), 'utf8')) } catch { /* facultatif */ }
export const META_MONDE = WORLD

/**
 * Charge un .vrma et rend un échantillonneur `ech(t) → { q: Map, p: Vector3 }`.
 * Les pistes qui ne visent pas un os humanoïde (regard, expressions) sont ignorées.
 */
export async function chargerClip(modele, slugOuChemin) {
  const f = slugOuChemin.endsWith('.vrma') ? slugOuChemin : path.join(DOSSIER_VRMA, slugOuChemin + '.vrma')
  if (!fs.existsSync(f)) throw new Error(`clip introuvable : ${f}`)
  const slug = path.basename(f).replace(/\.vrma$/i, '')
  const gltf = await chargerVRMA(fs.readFileSync(f))
  const anim = gltf.userData.vrmAnimations?.[0]
  if (!anim) throw new Error(`${slug} : aucune animation VRM dans le fichier`)
  const clip = createVRMAnimationClip(anim, modele.vrm)
  clip.name = slug

  const rot = new Map()
  let pos = null
  for (const t of clip.tracks) {
    const i = t.name.lastIndexOf('.')
    if (i < 0) continue
    const os = modele.adapt.noeudOs.get(t.name.slice(0, i))
    if (!os) continue
    if (t.name.endsWith('.quaternion')) rot.set(os, t.createInterpolant())
    else if (t.name.endsWith('.position') && os === 'hips') pos = t.createInterpolant()
  }
  const ech = (t) => {
    const q = new Map()
    for (const [os, it] of rot) {
      const v = it.evaluate(t)
      q.set(os, new THREE.Quaternion(v[0], v[1], v[2], v[3]))
    }
    let p = null
    if (pos) { const v = pos.evaluate(t); p = new THREE.Vector3(v[0], v[1], v[2]) }
    return { q, p }
  }
  const meta = WORLD?.clips?.[slug] ?? null
  return {
    slug, clip, ech, duree: clip.duration, osAnimes: new Set(rot.keys()),
    aTranslation: !!pos, meta, boucle: meta ? !!meta.boucle : /^idle/.test(slug),
  }
}

/** Liste des clips disponibles sur le disque. */
export function listerClips() {
  return fs.readdirSync(DOSSIER_VRMA)
    .filter((f) => f.toLowerCase().endsWith('.vrma'))
    .map((f) => f.replace(/\.vrma$/i, ''))
    .sort()
}

/** Liste des modèles disponibles. */
export function listerModeles() {
  return fs.readdirSync(DOSSIER_VRM).filter((f) => f.toLowerCase().endsWith('.vrm')).sort()
}

/**
 * Résout un nom de modèle en chemin complet : chemin existant, puis NOM EXACT
 * (avec ou sans .vrm, insensible à la casse), puis sous-chaîne — mais si
 * PLUSIEURS fichiers répondent, on refuse en les listant au lieu de prendre le
 * premier (« sakura » attrapait « ModeleAmbigu.vrm » selon l'ordre du
 * disque). Sans nom : reference.vrm, le modèle épinglé du diagnostic.
 */
export function resoudreModele(nom) {
  const liste = listerModeles()
  if (!nom) {
    const d = liste.find((f) => f.toLowerCase() === 'sakurakinomoto.vrm') ?? liste[0]
    if (!d) throw new Error(`aucun .vrm dans ${DOSSIER_VRM}`)
    return path.join(DOSSIER_VRM, d)
  }
  if (fs.existsSync(nom)) return nom
  const bas = nom.toLowerCase()
  const exact = liste.find((f) => f.toLowerCase() === bas || f.toLowerCase() === bas + '.vrm')
  if (exact) return path.join(DOSSIER_VRM, exact)
  const cand = liste.filter((f) => f.toLowerCase().includes(bas))
  if (cand.length === 1) return path.join(DOSSIER_VRM, cand[0])
  if (cand.length > 1) throw new Error(`« ${nom} » est ambigu — ${cand.length} candidats, nomme-le exactement : ${cand.join(' · ')}`)
  throw new Error(`modèle introuvable : ${nom} (dispo : ${liste.join(', ')})`)
}
