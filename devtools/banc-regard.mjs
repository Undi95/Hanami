// ════════════════════════════════════════════════════════════════════════════
// banc-regard.mjs — LE REGARD SAIT-IL RENONCER ?
//
// Le banc de c5d90d4 mesurait « le regard tombe-t-il à côté ». Celui-ci mesure
// la question inverse, et symétrique : quand la cible est ANATOMIQUEMENT
// INATTEIGNABLE — l'avatar s'éloigne, l'avatar est assis dos tourné — la tête
// renonce-t-elle, ou se dévisse-t-elle contre ses butées ?
//
// Ce qu'on mesure, à chaque image :
//   • LACET TÊTE-BUSTE — de combien la nuque se dévisse, dans le repère du
//     BUSTE (l'os porteur des épaules) et pas dans le monde. C'est LA grandeur
//     anatomique : la table de jointLimits n'autorise que 30° (tête) + 22,5°
//     (cou) = 52,5° de lacet réel.
//   • VITESSE DE LA TÊTE — degrés par seconde de la rotation MONDE de l'os
//     `head`. Une tête qui suit une cible tourne à 120-180 °/s ; au-delà, elle
//     claque. Deux colonnes, et il FAUT les deux : « monde » contient aussi le
//     pivot du corps et le mouvement propre du clip (un demi-tour d'une seconde
//     vaut 180 °/s à lui seul) ; « regard » isole ce que gaze.ts ajoute, en
//     dérivant le delta clip→regard. C'est la seconde que le plafond borne.
//   • ASSISTANCE — écart entre l'avant de la tête AVEC le regard et l'avant de
//     la tête tel que le CLIP l'a posée. Zéro = le regard a tout rendu à
//     l'animation. C'est l'observable du renoncement, et le seul dont on ait
//     besoin : il ne suppose rien de l'intérieur de gaze.ts.
//   • ERREUR — angle entre l'avant de la tête et la direction de la caméra.
//     C'est la mesure de NON-RÉGRESSION du face-à-face.
//   • CHARGE DE L'ŒIL — angle entre la cible donnée à vrm.lookAt et l'avant
//     RÉEL de la tête : ce qu'on demande au globe oculaire.
//
// Le montage reproduit tick() de vrmStage, dans l'ordre :
//     clip → jointLimits.apply() → gaze.update() → mesure.
// (L'idle est écarté : ses micro-offsets de respiration sont du bruit pour ces
// grandeurs, et il n'écrit rien que le clip n'ait déjà posé.)
// La caméra est posée par le calcul EXACT de frameCamera (cible 12 cm sous la
// tête, recul 1,4 × hauteur de tête) et le personnage prend d'abord le cap de
// cameraYawFrom : le cadrage par défaut, celui que voit le propriétaire.
//
// DEUX RIGS, toujours : un VRM 0.x (89 des 94 modèles du dossier) et un VRM
// 1.0. Le sens du repère normalisé change entre les deux, et c'est exactement
// là qu'un signe se perd (cf. c5d90d4).
//
// Lancement (tsx, pour importer le vrai gaze.ts du client) :
//   npx tsx devtools/banc-regard.mjs
//   npx tsx devtools/banc-regard.mjs --gaze=<chemin/vers/une/variante/gaze.ts>
//   npx tsx devtools/banc-regard.mjs --scene=a           (un seul scénario)
//   npx tsx devtools/banc-regard.mjs --trace=<dossier>   (dump des courbes)
//
// `--gaze` sert à comparer AVANT/APRÈS : la variante doit être posée à côté de
// copies de `overteMath.ts` et `jointLimits.ts`, dont elle importe.
// Le tirage aléatoire (saccades, table de conversation) est GRAINÉ : deux
// exécutions donnent le même chiffre.
//
// Lecture seule. Aucune écriture, aucun réseau, aucune dépendance npm ajoutée.
// ════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Bone, Group, Matrix4, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMHumanoid } from '@pixiv/three-vrm'
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation'
import { createJointLimits } from '../client/src/scene/jointLimits'

const ICI = path.dirname(fileURLToPath(import.meta.url))
const PROJET = process.env.HANAMI_ROOT || path.resolve(ICI, '..')
const RAD = 180 / Math.PI
const DT = 1 / 60

const args = new Map()
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  if (m) args.set(m[1], m[2] ?? '1')
}
const CHEMIN_GAZE = args.get('gaze')
  ? path.resolve(args.get('gaze'))
  : path.join(PROJET, 'client/src/scene/gaze.ts')
const { createGaze } = await import(pathToFileURL(CHEMIN_GAZE).href)

/** Hasard REPRODUCTIBLE — sans lui, saccades et fixations bougent les chiffres. */
function semer(graine) {
  let s = graine >>> 0
  Math.random = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

// ── Montage d'un .vrm : le squelette humanoïde seul, aucun mesh, aucun DOM ───
// Repris de devtools/diagnostic/juge/rig.mjs, réduit à ce que le regard touche.

const REPOS_BRAS_Z = [
  ['leftUpperArm', 1.25],
  ['rightUpperArm', -1.25],
  ['leftLowerArm', 0.12],
  ['rightLowerArm', -0.12],
]

function lireGLB(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('pas un GLB')
  return JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + dv.getUint32(12, true))))
}

function chargerRig(fichier) {
  const vj = lireGLB(fs.readFileSync(fichier))
  const ext1 = vj.extensions?.VRMC_vrm
  const ext0 = vj.extensions?.VRM
  const metaVersion = ext1 ? '1' : '0'
  const def = {}
  if (ext1) for (const [k, v] of Object.entries(ext1.humanoid.humanBones)) def[k] = v.node
  else if (ext0) for (const b of ext0.humanoid.humanBones) def[b.bone] = b.node
  else throw new Error(`aucune extension VRM dans ${path.basename(fichier)}`)

  const objs = vj.nodes.map((d) => {
    const o = new Bone()
    o.name = d.name ?? ''
    if (d.matrix) new Matrix4().fromArray(d.matrix).decompose(o.position, o.quaternion, o.scale)
    else {
      o.position.fromArray(d.translation ?? [0, 0, 0])
      o.quaternion.fromArray(d.rotation ?? [0, 0, 0, 1])
      o.scale.fromArray(d.scale ?? [1, 1, 1])
    }
    return o
  })
  const aParent = new Set()
  vj.nodes.forEach((d, i) => (d.children ?? []).forEach((c) => { objs[i].add(objs[c]); aParent.add(c) }))
  const sceneVrm = new Group()
  sceneVrm.name = 'vrm.scene'
  for (let i = 0; i < objs.length; i++) if (!aParent.has(i)) sceneVrm.add(objs[i])
  sceneVrm.updateWorldMatrix(false, true)

  const humanBones = {}
  for (const [k, ni] of Object.entries(def)) if (objs[ni]) humanBones[k] = { node: objs[ni] }
  const humanoid = new VRMHumanoid(humanBones)
  // three-vrm greffe la racine des os normalisés DANS gltf.scene : elle suit
  // donc tout ce que vrmStage fait à vrm.scene — dont VRMUtils.rotateVRM0.
  sceneVrm.add(humanoid.normalizedHumanBonesRoot)
  if (metaVersion === '0') sceneVrm.rotation.y = Math.PI
  sceneVrm.updateWorldMatrix(false, true)

  const nb = humanoid.normalizedHumanBones
  const osTous = Object.keys(nb)
  for (const [os, z] of REPOS_BRAS_Z) if (nb[os]) nb[os].node.rotation.z = z
  const reposQ = new Map(osTous.map((os) => [os, nb[os].node.quaternion.clone()]))
  const reposHips = nb.hips.node.position.clone()
  humanoid.update()
  sceneVrm.updateWorldMatrix(false, true)

  const P = (os) => (nb[os] ? nb[os].node.getWorldPosition(new Vector3()) : null)
  return {
    nom: path.basename(fichier),
    metaVersion,
    humanoid,
    // Le faux VRM que gaze.ts et jointLimits consomment : ils ne lisent rien d'autre.
    vrm: { humanoid, meta: { metaVersion } },
    scene: sceneVrm,
    osTous,
    reposQ,
    reposHips,
    noeud: (os) => (nb[os] ? nb[os].node : null),
    noeudOs: new Map(osTous.map((os) => [nb[os].node.name, os])),
    hauteurTete: P('head')?.y ?? NaN,
  }
}

const IDENT = new Quaternion()
function poser(rig, pose) {
  for (const os of rig.osTous) {
    const n = rig.noeud(os)
    if (n) n.quaternion.copy(pose?.q.get(os) ?? rig.reposQ.get(os) ?? IDENT)
  }
  const h = rig.noeud('hips')
  if (h) h.position.copy(pose?.p ?? rig.reposHips)
}

async function chargerClip(rig, slug) {
  const f = path.join(PROJET, 'vrma', slug + '.vrma')
  const buf = fs.readFileSync(f)
  const loader = new GLTFLoader()
  loader.register((p) => new VRMAnimationLoaderPlugin(p))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej))
  const anim = gltf.userData.vrmAnimations?.[0]
  if (!anim) throw new Error(`aucune animation VRM dans ${slug}.vrma`)
  const clip = createVRMAnimationClip(anim, {
    humanoid: rig.humanoid,
    meta: { metaVersion: rig.metaVersion },
    expressionManager: null,
    lookAt: null,
    scene: rig.scene,
  })
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
  const duree = Math.max(clip.duration, 1e-3)
  return {
    slug,
    duree,
    ech(t) {
      const u = ((t % duree) + duree) % duree
      const q = new Map()
      for (const [os, it] of rot) {
        const v = it.evaluate(u)
        q.set(os, new Quaternion(v[0], v[1], v[2], v[3]))
      }
      let p = null
      if (pos) { const v = pos.evaluate(u); p = new Vector3(v[0], v[1], v[2]) }
      return { q, p }
    },
  }
}

// ── Les grandeurs mesurées ──────────────────────────────────────────────────
//
// L'AVANT du personnage n'est JAMAIS supposé : up × (épaule droite − épaule
// gauche) est l'avant géométrique, indépendant de toute convention de format.
// Même témoin que gaze.ts et que jointLimits (c5d90d4).
const UP = new Vector3(0, 1, 0)
function avantMondeDe(rig) {
  const g = rig.noeud('leftUpperArm')?.getWorldPosition(new Vector3())
  const d = rig.noeud('rightUpperArm')?.getWorldPosition(new Vector3())
  if (!g || !d) return new Vector3(0, 0, 1)
  const cote = d.clone().sub(g)
  cote.y = 0
  if (cote.lengthSq() < 1e-10) return new Vector3(0, 0, 1)
  return new Vector3().crossVectors(UP, cote.normalize()).normalize()
}

const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v)
const angle = (a, b) => Math.acos(clamp1(a.dot(b) / (a.length() * b.length()))) * RAD
/** Angle d'une rotation entre deux quaternions, en degrés. */
const ecartQ = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * RAD

// ── Le déroulé d'un scénario ────────────────────────────────────────────────

/**
 * `scenario.pose(t)` rend { yaw, pos } du groupe avatar à l'instant t — la
 * scène vivante, réduite à ce qu'elle fait au buste : un cap et une position.
 */
async function jouer(rig, scenario) {
  semer(20260801)
  const scene = new Scene()
  const avatarGroup = new Group()
  avatarGroup.name = 'avatarGroup'
  scene.add(avatarGroup)
  avatarGroup.add(rig.scene)

  const camera = new PerspectiveCamera(30, 1, 0.1, 20)
  const gaze = createGaze({ blinkAmount: () => 0, requestBlink: () => {}, emotionActive: () => false })
  scene.add(gaze.target)
  const limites = createJointLimits(rig.vrm)

  const clip = scenario.clip
  const head = rig.noeud('head')

  // Pose de départ = image 0 du clip, puis cadrage par défaut (frameCamera +
  // cameraYawFrom), itéré jusqu'au point fixe comme le fait l'application.
  poser(rig, clip.ech(0))
  limites?.apply()
  const pTete = new Vector3()
  for (let i = 0; i < 4; i++) {
    scene.updateMatrixWorld(true)
    head.getWorldPosition(pTete)
    const h = rig.hauteurTete
    const distance = Math.min(2.5 * h, Math.max(0.375 * h, pTete.y * 1.4))
    const cibleY = pTete.y - 0.12
    camera.position.set(pTete.x, cibleY, pTete.z + distance)
    camera.lookAt(pTete.x, cibleY, pTete.z)
    camera.updateMatrixWorld(true)
    const dx = camera.position.x - avatarGroup.position.x
    const dz = camera.position.z - avatarGroup.position.z
    if (dx * dx + dz * dz >= 0.0025) avatarGroup.rotation.y = Math.atan2(dx, dz)
  }
  const yaw0 = avatarGroup.rotation.y

  // Le sens du +Z du rig normalisé, mesuré une fois sur la pose de départ.
  const avant = avantMondeDe(rig)
  const qh = new Quaternion()
  head.getWorldQuaternion(qh)
  const signe = avant.dot(new Vector3(0, 0, 1).applyQuaternion(qh)) < 0 ? -1 : 1
  const axeVisage = new Vector3(0, 0, signe)

  const images = Math.round(scenario.duree / DT)
  const qBase = new Quaternion()
  const qTete = new Quaternion()
  const qPrec = new Quaternion()
  const qDelta = new Quaternion()
  const qDeltaPrec = new Quaternion()
  const fwdBase = new Vector3()
  const fwd = new Vector3()
  const fwdBuste = new Vector3()
  const droiteBuste = new Vector3()
  const vCam = new Vector3()
  const vCible = new Vector3()
  const qBuste = new Quaternion()
  const buste = rig.noeud('upperChest') ?? rig.noeud('chest') ?? rig.noeud('spine') ?? rig.noeud('hips')
  let precValide = false

  const trace = []
  for (let i = 0; i < images; i++) {
    const t = i * DT
    const etat = scenario.pose(t)
    avatarGroup.rotation.y = yaw0 + etat.yaw
    avatarGroup.position.set(etat.pos?.x ?? 0, etat.pos?.y ?? 0, etat.pos?.z ?? 0)

    // ── l'ordre de tick() ───────────────────────────────────────────────────
    poser(rig, clip.ech(t))
    limites?.apply()
    scene.updateMatrixWorld(true)
    head.getWorldQuaternion(qBase)
    fwdBase.copy(axeVisage).applyQuaternion(qBase)

    gaze.update(DT, rig.vrm, camera, false)
    scene.updateMatrixWorld(true)

    head.getWorldPosition(pTete)
    head.getWorldQuaternion(qTete)
    fwd.copy(axeVisage).applyQuaternion(qTete)
    buste.getWorldQuaternion(qBuste)
    fwdBuste.copy(axeVisage).applyQuaternion(qBuste)
    droiteBuste.set(-axeVisage.z, 0, 0).applyQuaternion(qBuste)
    vCam.subVectors(camera.position, pTete).normalize()
    vCible.subVectors(gaze.target.position, pTete)

    const lacet = Math.abs(Math.atan2(fwd.dot(droiteBuste), fwd.dot(fwdBuste))) * RAD
    const viseeLacet = Math.abs(Math.atan2(vCam.dot(droiteBuste), vCam.dot(fwdBuste))) * RAD
    // Le delta PROPRE du regard : ce que la tête porte en plus de la pose du
    // clip. Sa dérivée est la vitesse que le plafond de gaze.ts borne — celle
    // de la tête dans le monde y ajoute le pivot du corps et le clip lui-même.
    qDelta.copy(qTete).multiply(qBase.clone().invert())
    trace.push({
      t,
      lacet, // dévissage RÉEL de la nuque
      visee: viseeLacet, // ce que la cible DEMANDERAIT au buste
      assist: ecartQ(qBase, qTete), // ce que le regard ajoute au clip
      vitesse: precValide ? ecartQ(qPrec, qTete) / DT : 0,
      vitRegard: precValide ? ecartQ(qDeltaPrec, qDelta) / DT : 0,
      err: angle(fwd, vCam),
      oeil: vCible.lengthSq() > 1e-9 ? angle(fwd, vCible) : 0,
    })
    qPrec.copy(qTete)
    qDeltaPrec.copy(qDelta)
    precValide = true
  }
  avatarGroup.remove(rig.scene)
  return trace
}

// ── Résumés ─────────────────────────────────────────────────────────────────

const max = (tr, k) => tr.reduce((m, r) => Math.max(m, r[k]), 0)
const moy = (tr, k) => (tr.length ? tr.reduce((s, r) => s + r[k], 0) / tr.length : 0)
function pct(tr, k, p) {
  const v = tr.map((r) => r[k]).sort((a, b) => a - b)
  return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : 0
}
const fin = (tr, s) => tr.filter((r) => r.t >= tr[tr.length - 1].t - s)

// ── Les scénarios ───────────────────────────────────────────────────────────

function scenarioEloigne(clip) {
  // 0–2 s face caméra ; 2–3 s demi-tour en accélérant ; puis marche à 0,9 m/s.
  // Le cap et la vitesse montent ENSEMBLE (v = V·u, yaw = π·u), comme un
  // départ de wander : d(t) = V·u²/2 pendant la montée, puis linéaire.
  const V = 0.9
  return {
    nom: 'a) il marche en s’éloignant',
    clip,
    duree: 9,
    pose(t) {
      const u = Math.min(1, Math.max(0, (t - 2) / 1))
      const d = t <= 2 ? 0 : t <= 3 ? (V * u * u) / 2 : V / 2 + V * (t - 3)
      return { yaw: Math.PI * u, pos: new Vector3(0, 0, -d) }
    },
  }
}

function scenarioSaut(clip) {
  // LE PLAFOND DE VITESSE, pris en défaut là où il doit mordre : un cap qui
  // change d'un coup. L'application le fait vraiment (le groupe est REPOSÉ —
  // arrivée sur une assise, recadrage, changement de décor) et la cible saute
  // alors de 60° en UNE image, tout en restant DANS le cône : le renoncement
  // ne joue pas, seul le plafond peut empêcher la tête de claquer.
  return {
    nom: 'a2) le cap du corps saute de 60° en une image (dans le cône)',
    clip,
    duree: 5,
    pose: (t) => ({ yaw: t < 2 ? 0 : 60 / RAD, pos: null }),
  }
}

function scenarioAssis(clip) {
  // 0–2 s presque de face ; 2–3,5 s il se tourne sur son assise ; puis il reste
  // dos à la caméra. Le groupe ne se déplace pas : aucune locomotion.
  return {
    nom: 'b) assis, il se tourne dos à la caméra',
    clip,
    duree: 9,
    pose(t) {
      const u = Math.min(1, Math.max(0, (t - 2) / 1.5))
      return { yaw: (15 + 150 * u) / RAD, pos: null }
    },
  }
}

function scenarioFace(clip) {
  return { nom: 'c) face caméra (non-régression)', clip, duree: 9, pose: () => ({ yaw: 0, pos: null }) }
}

function scenarioBalayage(clip) {
  // Va-et-vient LENT (15 °/s) à travers la frontière : 0 → 90 → 0 → 90 → 0.
  const VIT = 15 / RAD
  const leg = (90 / RAD) / VIT
  return {
    nom: 'd1) va-et-vient à travers la frontière',
    clip,
    duree: 4 * leg,
    pose(t) {
      const n = Math.floor(t / leg)
      const u = (t - n * leg) / leg
      const y = n % 2 === 0 ? u : 1 - u
      return { yaw: (y * 90) / RAD, pos: null }
    },
  }
}

function scenarioFrontiere(clip) {
  // On monte jusqu'À la frontière, puis on tremble AUTOUR : c'est le test du
  // flip-flop. Sans hystérésis, un seuil unique bascule à chaque image.
  return {
    nom: 'd2) tremblement SUR la frontière (65° ± 1,5°)',
    clip,
    duree: 9,
    pose(t) {
      let deg
      if (t < 2) deg = 40
      else if (t < 4) deg = 40 + 25 * ((t - 2) / 2)
      else deg = 65 + 1.5 * Math.sin(2 * Math.PI * (t - 4))
      return { yaw: deg / RAD, pos: null }
    },
  }
}

/**
 * Compte les BASCULES du suivi : `assist / visée` vaut ≈ 0,70 tant que la tête
 * suit (la chaîne cou+tête délivre 0,45 + 0,45×0,55 du delta demandé) et tombe
 * à 0 quand elle renonce. On compte les traversées de la moitié, en ignorant
 * les visées trop petites où le rapport n'a pas de sens.
 */
function bascules(trace) {
  let etat = null
  let n = 0
  const seuils = []
  for (const r of trace) {
    // Deux gardes, toutes deux méthodologiques : sous 25° de visée le rapport
    // est du bruit (le clip bouge la tête tout seul), et les deux premières
    // secondes sont l'établissement du delta, pas une décision.
    if (r.visee < 25 || r.t < 2) continue
    const suivi = r.assist / r.visee
    const e = suivi > 0.35
    if (etat === null) etat = e
    else if (e !== etat) {
      n++
      seuils.push({ t: r.t, visee: r.visee, vers: e ? 'reprise' : 'renoncement' })
      etat = e
    }
  }
  return { n, seuils }
}

// ── Exécution ───────────────────────────────────────────────────────────────

// Les étalons du banc : le regard se mesure sur les deux versions du format.
// Posez les vôtres sous ces noms dans vrm/ (copie ou lien) — l'étalon du projet
// est un chibi VRM 0.x de 0,755 m de hanches, le témoin un rig adulte VRM 1.x.
const RIGS = [
  { fichier: 'reference.vrm', etiquette: 'étalon chibi 0,755 m (VRM 0.x)' },
  { fichier: 'reference-1x.vrm', etiquette: 'témoin adulte (VRM 1.x)' },
]

const seul = args.get('scene')
console.log(`\n╔══ BANC DE REGARD — RENONCEMENT ══╗`)
console.log(`   gaze.ts mesuré : ${path.relative(PROJET, CHEMIN_GAZE).replace(/\\/g, '/')}\n`)

for (const r of RIGS) {
  let rig
  try {
    rig = chargerRig(path.join(PROJET, 'vrm', r.fichier))
  } catch (e) {
    console.log(`${r.etiquette} — ILLISIBLE (${e.message})`)
    continue
  }
  const marche = await chargerClip(rig, 'world-walk')
  const assis = await chargerClip(rig, 'world-sit-idle')
  const repos = await chargerClip(rig, 'idle')

  const scenes = [
    ['a', scenarioEloigne(marche)],
    ['a2', scenarioSaut(repos)],
    ['b', scenarioAssis(assis)],
    ['c', scenarioFace(repos)],
    ['d1', scenarioBalayage(repos)],
    ['d2', scenarioFrontiere(repos)],
  ].filter(([k]) => !seul || seul === k || (seul === 'd' && k.startsWith('d')))

  console.log(`── ${r.etiquette} ${'─'.repeat(Math.max(0, 56 - r.etiquette.length))}`)
  for (const [cle, sc] of scenes) {
    const tr = await jouer(rig, sc)
    const f = fin(tr, 1.5)
    // `--trace` : les courbes brutes, pour tracer une planche avant/après.
    if (args.get('trace')) {
      const dossier = path.resolve(args.get('trace'))
      fs.mkdirSync(dossier, { recursive: true })
      const nom = `${rig.nom.replace(/\.vrm$/i, '').replace(/[^\w-]/g, '_')}-${cle}.json`
      fs.writeFileSync(path.join(dossier, nom), JSON.stringify({ rig: r.etiquette, scenario: sc.nom, dt: DT, trace: tr }))
    }
    if (cle === 'c') {
      console.log(
        `  ${sc.nom}\n` +
          `     erreur de regard  moy ${moy(tr, 'err').toFixed(3)}°   max ${max(tr, 'err').toFixed(3)}°\n` +
          `     assistance        moy ${moy(tr, 'assist').toFixed(3)}°   max ${max(tr, 'assist').toFixed(3)}°\n` +
          `     lacet tête-buste  max ${max(tr, 'lacet').toFixed(2)}°\n` +
          `     vitesse   monde   max ${max(tr, 'vitesse').toFixed(1)} °/s` +
          `   regard max ${max(tr, 'vitRegard').toFixed(1)} °/s\n` +
          `     charge de l’œil   moy ${moy(tr, 'oeil').toFixed(2)}°   max ${max(tr, 'oeil').toFixed(2)}°`,
      )
    } else if (cle.startsWith('d')) {
      const b = bascules(tr)
      const detail = b.seuils.map((s) => `${s.vers} à ${s.visee.toFixed(1)}° (t=${s.t.toFixed(2)} s)`).join(' · ')
      console.log(
        `  ${sc.nom}\n` +
          `     bascules du suivi : ${b.n}${detail ? '  → ' + detail : ''}\n` +
          `     lacet tête-buste  max ${max(tr, 'lacet').toFixed(2)}°` +
          `   vitesse monde max ${max(tr, 'vitesse').toFixed(1)} °/s` +
          `   regard max ${max(tr, 'vitRegard').toFixed(1)} °/s`,
      )
    } else {
      // Le FONDU du renoncement : temps entre le pic d'assistance et le retour
      // sous 2° (la tête a rendu l'animation).
      let iPic = 0
      for (let i = 1; i < tr.length; i++) if (tr[i].assist > tr[iPic].assist) iPic = i
      let iFin = -1
      for (let i = iPic; i < tr.length; i++) if (tr[i].assist < 2) { iFin = i; break }
      const fondu = iFin >= 0 ? tr[iFin].t - tr[iPic].t : NaN
      console.log(
        `  ${sc.nom}\n` +
          `     visée demandée    max ${max(tr, 'visee').toFixed(1)}°   (fin ${moy(f, 'visee').toFixed(1)}°)\n` +
          `     lacet tête-buste  max ${max(tr, 'lacet').toFixed(2)}°   fin ${moy(f, 'lacet').toFixed(2)}°\n` +
          `     assistance        max ${max(tr, 'assist').toFixed(2)}°   fin ${moy(f, 'assist').toFixed(2)}°` +
          `   → fondu ${Number.isFinite(fondu) ? fondu.toFixed(2) + ' s' : 'JAMAIS RENDU'}\n` +
          `     vitesse   monde   max ${max(tr, 'vitesse').toFixed(1)} °/s  p95 ${pct(tr, 'vitesse', 0.95).toFixed(1)}` +
          `   regard max ${max(tr, 'vitRegard').toFixed(1)} °/s  p95 ${pct(tr, 'vitRegard', 0.95).toFixed(1)}\n` +
          `     charge de l’œil   max ${max(tr, 'oeil').toFixed(1)}°   fin ${moy(f, 'oeil').toFixed(1)}°`,
      )
    }
  }

  // ── (e) le coût du tick ───────────────────────────────────────────────────
  if (!seul) {
    semer(20260801)
    const scene = new Scene()
    const g = new Group()
    scene.add(g)
    g.add(rig.scene)
    const camera = new PerspectiveCamera(30, 1, 0.1, 20)
    camera.position.set(0, rig.hauteurTete - 0.12, rig.hauteurTete * 1.4)
    camera.updateMatrixWorld(true)
    const gaze = createGaze({ blinkAmount: () => 0, requestBlink: () => {}, emotionActive: () => false })
    poser(rig, repos.ech(0))
    scene.updateMatrixWorld(true)
    const N = 30000
    for (let i = 0; i < 3000; i++) gaze.update(DT, rig.vrm, camera, false) // chauffe
    const t0 = process.hrtime.bigint()
    for (let i = 0; i < N; i++) gaze.update(DT, rig.vrm, camera, false)
    const t1 = process.hrtime.bigint()
    console.log(`  e) coût de gaze.update : ${(Number(t1 - t0) / N / 1000).toFixed(3)} µs/appel`)
    g.remove(rig.scene)
  }
  console.log('')
}
