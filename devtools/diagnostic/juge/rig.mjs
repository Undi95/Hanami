// ════════════════════════════════════════════════════════════════════════════
// rig.mjs — MONTAGE DU CORPS À JUGER, sans navigateur.
//
// Charge un vrai .vrm du projet (squelette humanoïde seul : aucun mesh, aucune
// texture, donc aucun DOM), charge un .vrma, et rend de quoi ÉCHANTILLONNER la
// pose à n'importe quel instant. Rien de plus : tout le jugement est ailleurs.
//
// Le chargement reprend mot pour mot celui de ../../anim-lab/sonde.mjs, qui est
// éprouvé. Ce qui est NOUVEAU ici, et qui n'existait nulle part, c'est :
//   • `echelle`   — le rapport entre les hanches de CE modèle et celles d'un
//                   adulte de référence : sans lui, « le bassin oscille de 5 cm »
//                   n'a aucun sens sur un avatar de 1,20 m ;
//   • `sol`       — l'altitude du plancher, mesurée sur le rig au repos, pour
//                   pouvoir dire qu'un pied s'enfonce ou flotte ;
//   • `noeuds()`  — TOUTES les positions monde utiles (doigts compris), là où
//                   mesures.mjs ne rend que les os majeurs.
//
// Lecture seule. Aucune écriture, aucun accès réseau, aucun npm ajouté.
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Le juge vit dans devtools/diagnostic/juge/ : la racine du dépôt est trois crans
// au-dessus. Aucun chemin en dur — le dépôt peut être cloné n'importe où.
const ICI = path.dirname(fileURLToPath(import.meta.url))
export const PROJET = process.env.HANAMI_ROOT || path.resolve(ICI, '..', '..', '..')
const NM = 'file:///' + PROJET.replace(/\\/g, '/').replace(/ /g, '%20') + '/node_modules/'
export const VRMA_DIR = path.join(PROJET, 'vrma')
export const VRM_DIR = path.join(PROJET, 'vrm')

export const THREE = await import(NM + 'three/build/three.module.js')
const { GLTFLoader } = await import(NM + 'three/examples/jsm/loaders/GLTFLoader.js')
const { VRMHumanoid } = await import(NM + '@pixiv/three-vrm/lib/three-vrm.module.js')
const { VRMAnimationLoaderPlugin, createVRMAnimationClip } = await import(
  NM + '@pixiv/three-vrm-animation/lib/three-vrm-animation.module.js'
)

// ── Le corps de référence ───────────────────────────────────────────────────
//
// Toutes les fourchettes anatomiques de criteres.mjs (« le bassin oscille de 4 à
// 6 cm », « les pieds sont écartés de 10 à 25 cm ») valent pour un adulte dont
// l'articulation de hanche est à 0,93 m du sol (≈ 0,53 × 1,75 m de stature, la
// proportion anthropométrique usuelle). Sur un modèle dont les hanches sont à
// 0,78 m, les mêmes centimètres seraient une exagération de 19 %. Toute longueur
// est donc convertie en FRACTION DE HAUTEUR DE HANCHE — la même grandeur sans
// dimension que world.json utilise déjà — puis reconvertie en cm pour l'affichage.
export const HANCHES_ADULTE_M = 0.93

const versUrl = (p) => 'file:///' + p.replace(/\\/g, '/').replace(/ /g, '%20')

// ── Pose de repos anti T-pose, reprise TELLE QUELLE de vrmStage.ts ──────────
// La page pose ces bras AVANT de créer les actions : c'est donc cette pose que
// le mixer restaure pour un os qu'un clip n'anime pas. Sans elle, un clip qui
// n'anime pas les bras serait jugé en T-pose — et déclaré inhumain à raison,
// mais pour une raison qui n'existe que dans le banc.
const REPOS_BRAS_Z = [
  ['leftUpperArm', 1.25], ['rightUpperArm', -1.25],
  ['leftLowerArm', 0.12], ['rightLowerArm', -0.12],
]

function lireGLB(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('pas un GLB')
  const jl = dv.getUint32(12, true)
  return { json: JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jl))) }
}

/**
 * Monte le squelette humanoïde d'un .vrm à la main depuis le glTF.
 * Aucun mesh n'est instancié : le fichier ne sert qu'à donner les longueurs de
 * segments et les positions de repos, qui sont tout ce dont la biomécanique a
 * besoin. C'est ce qui rend l'outil utilisable en pur Node.
 */
export function chargerRig(fichier) {
  const { json: vj } = lireGLB(fs.readFileSync(fichier))
  const ext1 = vj.extensions?.VRMC_vrm
  const ext0 = vj.extensions?.VRM
  const metaVersion = ext1 ? '1' : '0'
  const def = {}
  if (ext1) for (const [k, v] of Object.entries(ext1.humanoid.humanBones)) def[k] = v.node
  else if (ext0) for (const b of ext0.humanoid.humanBones) def[b.bone] = b.node
  else throw new Error(`aucune extension VRM dans ${path.basename(fichier)}`)

  const objs = vj.nodes.map((d) => {
    const o = new THREE.Bone()
    o.name = d.name ?? ''
    if (d.matrix) new THREE.Matrix4().fromArray(d.matrix).decompose(o.position, o.quaternion, o.scale)
    else {
      o.position.fromArray(d.translation ?? [0, 0, 0])
      o.quaternion.fromArray(d.rotation ?? [0, 0, 0, 1])
      o.scale.fromArray(d.scale ?? [1, 1, 1])
    }
    return o
  })
  const aParent = new Set()
  vj.nodes.forEach((d, i) => (d.children ?? []).forEach((c) => { objs[i].add(objs[c]); aParent.add(c) }))
  const scene = new THREE.Group()
  for (let i = 0; i < objs.length; i++) if (!aParent.has(i)) scene.add(objs[i])
  scene.updateWorldMatrix(false, true)

  const humanBones = {}
  for (const [k, ni] of Object.entries(def)) if (objs[ni]) humanBones[k] = { node: objs[ni] }
  const humanoid = new VRMHumanoid(humanBones)
  scene.add(humanoid.normalizedHumanBonesRoot)
  // VRMUtils.rotateVRM0 : un VRM 0.x regarde le −Z, l'app le retourne pour qu'il
  // fasse face au +Z. Sans ça l'« avant » du personnage est inversé et toutes les
  // mesures de balancement de bras changent de signe.
  if (metaVersion === '0') scene.rotation.y = Math.PI
  scene.updateWorldMatrix(false, true)

  const nb = humanoid.normalizedHumanBones
  const osTous = Object.keys(nb)
  const brut = new Map(Object.entries(humanBones).map(([n, b]) => [n, b.node]))
  const rig = {
    fichier, nom: path.basename(fichier), metaVersion,
    humanoid, // le vrai VRMHumanoid : createVRMAnimationClip lit son normalizedRestPose
    osTous,
    noeudOs: new Map(osTous.map((os) => [nb[os].node.name, os])),
    reposQ: new Map(osTous.map((os) => [os, nb[os].node.quaternion.clone()])),
    reposHips: nb.hips.node.position.clone(),
    scene,
    noeudNorm: (os) => nb[os]?.node ?? null,
    noeudBrut: (os) => brut.get(os) ?? null,
    majHumanoide: () => { humanoid.update(); scene.updateWorldMatrix(false, true) },
  }
  for (const [os, z] of REPOS_BRAS_Z) {
    const n = rig.noeudNorm(os)
    if (n) { n.rotation.z = z; rig.reposQ.set(os, n.quaternion.clone()) }
  }
  rig.majHumanoide()

  // Repères d'échelle, pris SUR LE RIG AU REPOS (bras le long du corps).
  poser(rig, { q: new Map(), p: rig.reposHips })
  const P = (os) => rig.noeudBrut(os)?.getWorldPosition(new THREE.Vector3()) ?? null
  const hips = P('hips')
  const pg = P('leftFoot'), pd = P('rightFoot')
  const tg = P('leftToes'), td = P('rightToes')
  // Le plancher : le point le plus bas du pied au repos. Les .vrm du projet
  // posent le personnage debout sur y = 0, mais rien ne l'impose — on le mesure.
  // ── LE SOL, ET LES DEUX POINTS DE LA SEMELLE ─────────────────────────────
  //
  // Un .vrm pose son personnage DEBOUT SUR y = 0 : c'est la convention du format,
  // et c'est ce que l'app suppose. Les os, eux, sont à l'INTÉRIEUR du pied — sur
  // reference.vrm la cheville est à 9,4 cm et l'os des orteils à 3,5 cm du
  // sol. Prendre l'os le plus bas comme « le pied » ferait dire qu'un pied posé
  // talon au sol flotte de 9 cm, et l'attaque talon deviendrait indétectable.
  //
  // On ancre donc, UNE FOIS, dans le repère de chaque os, le point du sol qui se
  // trouve à sa verticale au repos : le TALON sous la cheville, la POINTE sous
  // l'os des orteils. Ces deux points suivent ensuite la rotation du pied, et ce
  // sont eux — et eux seuls — qui touchent le sol.
  const bas = [pg, pd, tg, td].filter(Boolean).map((v) => v.y)
  const plusBas = bas.length ? Math.min(...bas) : 0
  rig.sol = 0
  rig.solSuppose = true
  if (!(plusBas >= -0.02 && plusBas < 0.25 * (hips ? hips.y : 1))) {
    // Modèle qui ne respecte pas la convention : on retombe sur l'os le plus bas
    // et on le SIGNALE, plutôt que de mesurer des enfoncements imaginaires.
    rig.sol = plusBas
    rig.solSuppose = false
  }
  rig.semelle = {}
  for (const [k, c] of [['g', 'left'], ['d', 'right']]) {
    const anc = (os) => {
      const b = rig.noeudBrut(os)
      if (!b) return null
      const p = b.getWorldPosition(new THREE.Vector3())
      const q = b.getWorldQuaternion(new THREE.Quaternion()).invert()
      return {
        local: new THREE.Vector3(0, rig.sol - p.y, 0).applyQuaternion(q),
        hauteurReposM: p.y - rig.sol,
      }
    }
    rig.semelle[k] = { talon: anc(c + 'Foot'), pointe: anc(c + 'Toes') }
  }
  rig.hanchesM = hips ? hips.y - rig.sol : NaN
  rig.echelle = rig.hanchesM / HANCHES_ADULTE_M
  // LARGEUR D'ÉPAULES = écart entre les deux `upperArm`, jamais entre les
  // `shoulder`. Dans un VRM, `shoulder` est la racine de la clavicule, collée au
  // rachis : sur reference.vrm les deux ne sont séparées que de 4 cm. Un axe
  // latéral construit là-dessus est du bruit, et toute la torsion du tronc en
  // dépend. `upperArm` EST l'articulation gléno-humérale : c'est la vraie épaule.
  rig.epauleM = (() => {
    const g = P('leftUpperArm'), d = P('rightUpperArm')
    return g && d ? g.distanceTo(d) : NaN
  })()
  rig.epauleY = (() => {
    const g = P('leftUpperArm'), d = P('rightUpperArm')
    return g && d ? (g.y + d.y) / 2 - rig.sol : NaN
  })()
  rig.tailleM = (() => { const h = P('head'); return h ? h.y - rig.sol : NaN })()
  rig.largeurHanchesM = (() => {
    const g = P('leftUpperLeg'), d = P('rightUpperLeg')
    return g && d ? g.distanceTo(d) : NaN
  })()

  // ── SENS DU REPÈRE NORMALISÉ, MESURÉ ET NON SUPPOSÉ ──────────────────────
  //
  // Le repère des os NORMALISÉS sert à savoir dans quel sens un coude plie. On
  // pourrait croire que son +Z est l'avant du personnage : c'est faux ici. Les os
  // normalisés sont bâtis dans l'espace PROPRE du modèle, et un VRM 0.x y regarde
  // le −Z ; la rotation de π que l'app applique à la scène les emmène avec elle,
  // si bien que leur +Z pointe vers l'ARRIÈRE du personnage dans le monde. Croire
  // la convention faisait dire au juge que chaque coude était en hyperextension
  // de très exactement sa flexion — le signe était simplement retourné.
  // On mesure donc le sens une fois, au repos, en le confrontant à l'avant
  // géométrique (qui, lui, ne dépend d'aucune convention). Vrai pour 0.x comme 1.0.
  {
    const g = P('leftUpperArm'), d = P('rightUpperArm')
    let avant = new THREE.Vector3(0, 0, 1)
    if (g && d) {
      const c = d.clone().sub(g); c.y = 0
      if (c.lengthSq() > 1e-10) avant = new THREE.Vector3(0, 1, 0).cross(c.normalize()).normalize()
    }
    const n = rig.noeudNorm('leftUpperArm') ?? rig.noeudNorm('hips')
    const z = n ? new THREE.Vector3(0, 0, 1).applyQuaternion(n.getWorldQuaternion(new THREE.Quaternion())) : avant
    rig.signeAvantNormalise = avant.dot(z) < 0 ? -1 : 1
  }

  rig.osPresents = new Set(osTous)
  return rig
}

/** Le premier .vrm du dossier, ou celui demandé. */
export function choisirVrm(demande) {
  if (demande) {
    const p = path.isAbsolute(demande) ? demande : path.join(VRM_DIR, demande)
    if (fs.existsSync(p)) return p
    const cand = fs.readdirSync(VRM_DIR).find((f) => f.toLowerCase().includes(demande.toLowerCase()) && f.toLowerCase().endsWith('.vrm'))
    if (cand) return path.join(VRM_DIR, cand)
    throw new Error(`.vrm introuvable : ${demande}`)
  }
  const l = fs.readdirSync(VRM_DIR).filter((f) => f.toLowerCase().endsWith('.vrm')).sort()
  if (!l.length) throw new Error(`aucun .vrm dans ${VRM_DIR}`)
  return path.join(VRM_DIR, l[0])
}

export function listerVrm() {
  return fs.readdirSync(VRM_DIR).filter((f) => f.toLowerCase().endsWith('.vrm')).sort().map((f) => path.join(VRM_DIR, f))
}

export function listerClips() {
  return fs.readdirSync(VRMA_DIR).filter((f) => f.toLowerCase().endsWith('.vrma'))
    .map((f) => f.replace(/\.vrma$/i, '')).sort()
}

/** Applique une pose (quaternions normalisés + position de hanches) au rig. */
const IDENT = { x: 0, y: 0, z: 0, w: 1 }
export function poser(rig, pose) {
  for (const os of rig.osTous) {
    const n = rig.noeudNorm(os)
    if (n) n.quaternion.copy(pose.q.get(os) ?? rig.reposQ.get(os) ?? IDENT)
  }
  const h = rig.noeudNorm('hips')
  if (h) h.position.copy(pose.p ?? rig.reposHips)
  rig.majHumanoide()
}

// ── Chargement d'un clip .vrma et échantillonnage ───────────────────────────

function parserGLB(buf) {
  const loader = new GLTFLoader()
  loader.register((p) => new VRMAnimationLoaderPlugin(p))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Promise((resolve, reject) => loader.parse(ab, '', resolve, reject))
}

export const EPS = 1e-4 // JAMAIS échantillonner à t = durée : LoopRepeat rendrait la 1re image

/**
 * Charge un clip et rend `ech(t) → { q: Map<os, Quaternion>, p: Vector3|null }`.
 * Passe par les interpolants du clip (aucun AnimationMixer, aucune horloge) :
 * l'échantillonnage est donc exact et reproductible à l'instant près.
 */
export async function chargerClip(rig, slug) {
  const f = path.join(VRMA_DIR, slug + '.vrma')
  if (!fs.existsSync(f)) throw new Error(`clip absent : ${f}`)
  const buf = fs.readFileSync(f)
  const gltf = await parserGLB(buf)
  const anim = gltf.userData.vrmAnimations?.[0]
  if (!anim) throw new Error(`aucune animation VRM dans ${slug}.vrma`)
  // createVRMAnimationClip attend un objet VRM ; il ne lit que humanoid (dont
  // `normalizedRestPose`, d'où l'obligation de passer le VRAI VRMHumanoid),
  // expressionManager et lookAt — que le juge ignore.
  const clip = createVRMAnimationClip(anim, {
    humanoid: rig.humanoid, meta: { metaVersion: rig.metaVersion },
    expressionManager: null, lookAt: null, scene: rig.scene,
  })
  clip.name = slug

  const rot = new Map()
  let pos = null
  for (const t of clip.tracks) {
    const i = t.name.lastIndexOf('.')
    if (i < 0) continue
    const os = rig.noeudOs.get(t.name.slice(0, i))
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
  return {
    slug, clip, ech, duree: clip.duration,
    osAnimes: new Set(rot.keys()), aTranslation: !!pos, tailleOctets: buf.length,
  }
}

/** Métadonnée de vrma/world.json, si le clip y figure. */
let _world = null
export function world() {
  if (_world === null) {
    try { _world = JSON.parse(fs.readFileSync(path.join(VRMA_DIR, 'world.json'), 'utf8')) } catch { _world = {} }
  }
  return _world
}
