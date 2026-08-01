// ════════════════════════════════════════════════════════════════════════════
// banc-fondus.mjs — L'À-COUP DES TRANSITIONS, MESURÉ.
//
// « Les animations ne sont pas si fluides que ça lorsqu'elle marche, bouge. »
// Ce banc dit POURQUOI, et de combien on a gagné.
//
// Il rejoue HORS NAVIGATEUR l'enchaînement exact de vrmStage — `advanceFade`
// puis `mixer.update`, avec la loi de poids `fadeWeights` dont la somme vaut 1 —
// sur les vrais .vrma et un vrai squelette de vrm/. Pour chaque type de
// jonction, il balaie TOUTES les paires de variantes et rend :
//
//   saut   la plus grosse MARCHE de vitesse angulaire entre deux images
//          consécutives (°/s, pire os). C'EST l'à-coup : un fondu linéaire en
//          fabrique une au début et une à la fin, `easeInOutQuad` les supprime ;
//   pointe la plus grande vitesse angulaire atteinte (°/s, pire os) — le prix à
//          payer, puisqu'une courbe adoucie culmine à 2/T au lieu de 1/T.
//
// Trois jeux de réglages, jouables côte à côte sur les mêmes paires :
//   avant   ce qu'on avait : 0,3 / 0,4 / 0,5 s, linéaire partout
//   durees  les durées d'Overte, mais encore linéaires
//   actuel  ce que le code fait vraiment — le jeu est LU dans fades.ts, pas
//           recopié : le banc ne peut pas mesurer autre chose que l'application
//
// Lecture seule : <racine>/vrma/*.vrma, <racine>/vrm/*.vrm, <racine>/node_modules
// et client/src/scene/fades.ts. Écriture : seulement si --json est donné.
//
// Usage :
//   node banc-fondus.mjs                       les trois jeux, toutes les jonctions
//   node banc-fondus.mjs --jeu=actuel          un seul jeu
//   node banc-fondus.mjs --j=stop→idle,turn→idle   quelques jonctions
//   node banc-fondus.mjs --vrm=<chemin.vrm>    un modèle précis
//   node banc-fondus.mjs --json=fondus.json
//   node banc-fondus.mjs --plancher            l'à-coup PROPRE de chaque clip
// ════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const LAB = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.slice(1))))
const PROJET = process.env.HANAMI_ROOT || path.resolve(LAB, '..', '..')
const NM = pathToFileURL(path.join(PROJET, 'node_modules')).href + '/'
const VRMA_DIR = path.join(PROJET, 'vrma')
const VRM_DIR = path.join(PROJET, 'vrm')

const THREE = await import(NM + 'three/build/three.module.js')
const { GLTFLoader } = await import(NM + 'three/examples/jsm/loaders/GLTFLoader.js')
const { VRMHumanoid } = await import(NM + '@pixiv/three-vrm/lib/three-vrm.module.js')
const { VRMAnimationLoaderPlugin, createVRMAnimationClip } = await import(
  NM + '@pixiv/three-vrm-animation/lib/three-vrm-animation.module.js'
)
// LA TABLE DE L'APPLICATION, telle quelle (node sait lire un .ts sans types).
const F = await import(pathToFileURL(path.join(PROJET, 'client/src/scene/fades.ts')).href)

const args = new Map()
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  if (m) args.set(m[1], m[2] ?? '1')
}
const R2D = 180 / Math.PI
const DT = 1 / 60
const LIN = (p) => p
const EASE = F.easeInOutQuad

// ── Rig : le squelette humanoïde d'un vrai .vrm, monté à la main ────────────
// Aucun mesh, aucune texture, donc aucun DOM. Même montage que sonde.mjs.
const REST_POSE_Z = [
  ['leftUpperArm', 1.25], ['rightUpperArm', -1.25],
  ['leftLowerArm', 0.12], ['rightLowerArm', -0.12],
]
const POUCE = {
  leftThumbProximal: 'leftThumbMetacarpal', leftThumbIntermediate: 'leftThumbProximal',
  rightThumbProximal: 'rightThumbMetacarpal', rightThumbIntermediate: 'rightThumbProximal',
}

function lireGLB(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('pas un GLB')
  return JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + dv.getUint32(12, true))))
}

function monterRig(fichier) {
  const vj = lireGLB(fs.readFileSync(fichier))
  const ext1 = vj.extensions?.VRMC_vrm
  const ext0 = vj.extensions?.VRM
  const def = {}
  if (ext1) {
    const ancien = ext1.humanoid.humanBones.leftThumbIntermediate != null || ext1.humanoid.humanBones.rightThumbIntermediate != null
    for (const [k, v] of Object.entries(ext1.humanoid.humanBones)) def[(ancien && POUCE[k]) || k] = v.node
  } else if (ext0) for (const b of ext0.humanoid.humanBones) def[POUCE[b.bone] ?? b.bone] = b.node
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
  if (!ext1) scene.rotation.y = Math.PI
  scene.updateWorldMatrix(false, true)
  for (const [nom, z] of REST_POSE_Z) {
    const n = humanoid.normalizedHumanBones[nom]?.node
    if (n) n.rotation.z = z
  }
  humanoid.update()
  scene.updateWorldMatrix(false, true)
  return { humanoid, scene, meta: { metaVersion: ext1 ? '1' : '0' }, expressionManager: null, lookAt: null }
}

const nomVrm = args.get('vrm') || path.join(VRM_DIR, fs.readdirSync(VRM_DIR).filter((x) => x.toLowerCase().endsWith('.vrm')).sort()[0])
const rig = monterRig(nomVrm)
const NB = rig.humanoid.normalizedHumanBones
const OS = Object.keys(NB)

// ── Clips ───────────────────────────────────────────────────────────────────
const cache = new Map()
async function clipDe(nom) {
  if (cache.has(nom)) return cache.get(nom)
  const f = path.join(VRMA_DIR, nom + '.vrma')
  let clip = null
  if (fs.existsSync(f)) {
    const buf = fs.readFileSync(f)
    const loader = new GLTFLoader()
    loader.register((p) => new VRMAnimationLoaderPlugin(p))
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej))
    const anim = gltf.userData.vrmAnimations?.[0]
    clip = anim ? createVRMAnimationClip(anim, rig) : null
  }
  cache.set(nom, clip)
  return clip
}

/** Variantes présentes pour un radical (`idle` → idle, idle-2, idle-3…). */
function variantes(stem) {
  const re = new RegExp('^' + stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-\\d+$')
  return fs.readdirSync(VRMA_DIR)
    .filter((f) => f.toLowerCase().endsWith('.vrma'))
    .map((f) => f.replace(/\.vrma$/i, ''))
    .filter((s) => s === stem || re.test(s))
    .sort()
}

// ── La loi de poids de vrmStage, à la ligne près ────────────────────────────
function fadeWeights(from, to, p) {
  const out = new Map()
  for (const [a, w] of from) out.set(a, w * (1 - p))
  out.set(to, p + (from.get(to) ?? 0) * (1 - p))
  return out
}

/**
 * Déroule une suite d'étapes { clip, images, fondu, courbe, once, phase, mesure }
 * et rend la vitesse angulaire image par image, os par os.
 * L'invariant « somme des poids = 1 » est CONTRÔLÉ à chaque image : un banc qui
 * mesurerait un fondu cassé ne servirait à rien.
 */
async function derouler(etapes) {
  const mixer = new THREE.AnimationMixer(rig.scene)
  rig.humanoid.resetNormalizedPose()
  const poids = new Map()
  let active = null
  let fade = null
  let sommeMin = Infinity
  const poser = (m) => {
    for (const [a, w] of m) {
      a.enabled = w > 0
      a.setEffectiveWeight(w)
      if (w > 0) poids.set(a, w)
      else poids.delete(a)
    }
  }
  const serie = []
  const marque = []
  for (const e of etapes) {
    const clip = await clipDe(e.clip)
    if (!clip) { mixer.stopAllAction(); mixer.uncacheRoot(rig.scene); return null }
    const a = mixer.clipAction(clip)
    if (e.once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true }
    else a.setLoop(THREE.LoopRepeat, Infinity)
    a.reset()
    if (e.phase !== undefined) a.time = e.phase
    if (active !== a) {
      const from = new Map(poids)
      a.paused = false
      a.enabled = true
      a.play()
      active = a
      const d = e.fondu ?? 0
      if (from.size === 0 || d <= 0) { fade = null; poser(fadeWeights(from, a, 1)) }
      else { fade = { to: a, from, elapsed: 0, duree: d, courbe: e.courbe ?? LIN }; poser(fadeWeights(from, a, 0)) }
    }
    for (let i = 0; i < e.images; i++) {
      if (fade) {
        fade.elapsed += DT
        const p = Math.min(1, fade.elapsed / fade.duree)
        poser(fadeWeights(fade.from, fade.to, fade.courbe(p)))
        if (p >= 1) fade = null
      }
      let s = 0
      for (const w of poids.values()) s += w
      if (s < sommeMin) sommeMin = s
      mixer.update(DT)
      serie.push(OS.map((o) => NB[o].node.quaternion.clone()))
      marque.push(e.mesure === true)
    }
  }
  mixer.stopAllAction()
  mixer.uncacheRoot(rig.scene)

  let saut = 0, sautOs = '', pointe = 0, pointeOs = ''
  const w = []
  for (let i = 1; i < serie.length; i++) {
    w.push(OS.map((_, j) => {
      const d = Math.min(1, Math.abs(serie[i - 1][j].dot(serie[i][j])))
      return (2 * Math.acos(d) * R2D) / DT
    }))
  }
  for (let i = 1; i < w.length; i++) {
    if (!marque[i + 1]) continue
    for (let j = 0; j < OS.length; j++) {
      const s = Math.abs(w[i][j] - w[i - 1][j])
      if (s > saut) { saut = s; sautOs = OS[j] }
      if (w[i][j] > pointe) { pointe = w[i][j]; pointeOs = OS[j] }
    }
  }
  return { saut, sautOs, pointe, pointeOs, sommeMin }
}

// ── Les jonctions ───────────────────────────────────────────────────────────
// `fondu` nomme la constante de fades.ts ; les trois jeux lui donnent trois
// valeurs. `once`/`phase` reproduisent ce que fait le code, contrats de phase
// de vrma/world.json compris — ce banc ne les change JAMAIS.
const AV = 40
const idles = variantes('idle')
const arrets = variantes('world-walk-stop').concat(['world-walk-stop-small'])
const gestes = ['happy', 'angry', 'nod', 'relaxed', 'sad', 'shake', 'think', 'raise-hand'].flatMap(variantes)

const JONCTIONS = [
  { nom: 'idle → idle-talking', fondu: 'BASE_SWAP', paires: croise(idles, variantes('idle-talking')), images: 90 },
  { nom: 'idle-talking → idle', fondu: 'BASE_SWAP', paires: croise(variantes('idle-talking'), idles), images: 90 },
  { nom: 'rb-idle → rb-listen', fondu: 'BASE_SWAP', paires: croise(variantes('rb-idle'), variantes('rb-listen')), images: 100 },
  { nom: 'idle → geste', fondu: 'GESTURE_IN', paires: croise(['idle'], gestes), once: true, images: 120 },
  { nom: 'geste → idle', fondu: 'GESTURE_OUT', paires: croise(gestes, ['idle']), departOnce: true, images: 120 },
  { nom: 'idle → pivot', fondu: 'TURN_IN', paires: [['idle', 'world-turn-left'], ['idle', 'world-turn-right']], phaseDe: (b) => (b.endsWith('left') ? 0.167 : 0.033), images: 90 },
  { nom: 'pivot → idle', fondu: 'TURN_OUT', paires: [['world-turn-left', 'idle'], ['world-turn-right', 'idle']], images: 90 },
  { nom: 'idle → walk-start', fondu: 'WALK_START_IN', paires: [['idle', 'world-walk-start']], once: true, images: 90 },
  { nom: 'pivot → walk-start', fondu: 'TURN_OUT', paires: [['world-turn-left', 'world-walk-start'], ['world-turn-right', 'world-walk-start']], once: true, images: 90 },
  { nom: 'idle → walk-slow', fondu: 'WALK_CYCLE_IN', paires: [['idle', 'world-walk-slow']], phase: 0, images: 100 },
  { nom: 'walk → arrêt', fondu: 'STOP_IN', paires: croise(['world-walk'], arrets), once: true, phaseDepart: 0, images: 140 },
  { nom: 'walk-slow → arrêt', fondu: 'STOP_IN', paires: croise(['world-walk-slow'], arrets), once: true, phaseDepart: 0.133, images: 140 },
  { nom: 'walk → arrêt court', fondu: 'STOP_SMALL_IN', paires: [['world-walk', 'world-walk-stop-small']], once: true, phaseDepart: 0, images: 140 },
  { nom: 'arrêt → idle', fondu: 'STOP_OUT', paires: croise(arrets, idles), departOnce: true, images: 100 },
  { nom: 'idle → sit-enter', fondu: 'SIT_IN', paires: [['idle', 'world-sit-enter']], once: true, images: 110 },
  { nom: 'sit-enter → sit-idle', fondu: 'SIT_LAND', paires: croise(['world-sit-enter'], variantes('world-sit-idle')), departOnce: true, phase: 0, images: 110 },
  { nom: 'sit-idle → sit-talking', fondu: 'SIT_TALK', paires: croise(variantes('world-sit-idle'), variantes('world-sit-talking')), images: 100 },
  { nom: 'sit-idle → geste assis', fondu: 'SIT_GESTURE_IN', paires: croise(['world-sit-idle'], ['world-sit-look', 'world-sit-shift', 'world-sit-clap', 'world-sit-cheer', 'world-sit-nod', 'world-sit-sad', 'world-sit-raise-hand', 'world-sit-disbelief']), once: true, images: 130 },
  { nom: 'geste assis → sit-idle', fondu: 'SIT_GESTURE_OUT', paires: croise(['world-sit-look', 'world-sit-shift', 'world-sit-clap', 'world-sit-cheer', 'world-sit-nod'], ['world-sit-idle']), departOnce: true, images: 110 },
  { nom: 'sit-idle → sit-exit', fondu: 'SIT_IN', paires: croise(variantes('world-sit-idle'), ['world-sit-exit']), once: true, images: 130 },
  { nom: 'sit-exit → idle', fondu: 'STOP_OUT', paires: croise(['world-sit-exit'], idles), departOnce: true, images: 100 },
]

function croise(as, bs) {
  const out = []
  for (const a of as) for (const b of bs) out.push([a, b])
  return out
}

// Les trois jeux. `actuel` est LU dans fades.ts ; les deux autres sont
// l'historique, gardés pour que la comparaison reste rejouable.
const AVANT = {
  BASE_SWAP: [0.5, false], GESTURE_IN: [0.3, false], GESTURE_OUT: [0.4, false],
  TURN_IN: [0.3, false], TURN_OUT: [0.5, false],
  WALK_START_IN: [0.4, false], WALK_CYCLE_IN: [0.4, false],
  STOP_IN: [0.35, false], STOP_SMALL_IN: [0.35, false], STOP_OUT: [0.2, false],
  SIT_IN: [0.3, false], SIT_LAND: [1.0, false], SIT_TALK: [0.8, false],
  SIT_GESTURE_IN: [0.4, false], SIT_GESTURE_OUT: [0.4, false],
}
const DUREES = {}
for (const k of Object.keys(AVANT)) DUREES[k] = [F[k].s, false]
const ACTUEL = {}
for (const k of Object.keys(AVANT)) ACTUEL[k] = [F[k].s, F[k].ease]
const JEUX = { avant: AVANT, durees: DUREES, actuel: ACTUEL }

// ── Déroulé ─────────────────────────────────────────────────────────────────
if (args.has('plancher')) {
  // L'à-coup PROPRE de chaque clip d'arrivée, poids 1 du début : le plancher
  // qu'aucun fondu ne peut descendre. Sans lui, on croit régler un fondu alors
  // qu'on regarde le clip.
  console.log('\n══ plancher : l\'à-coup propre du clip (poids 1, aucun fondu)')
  const vus = new Set()
  for (const j of JONCTIONS) {
    for (const [, b] of j.paires) {
      const cle = `${b}|${j.phase ?? (j.phaseDe ? j.phaseDe(b) : '-')}`
      if (vus.has(cle)) continue
      vus.add(cle)
      const r = await derouler([{ clip: b, images: 120, fondu: 0, once: j.once, phase: j.phase ?? j.phaseDe?.(b), mesure: true }])
      if (r) console.log(`  ${b.padEnd(26)} ${String(j.phase ?? j.phaseDe?.(b) ?? '-').padStart(6)}  saut ${r.saut.toFixed(0).padStart(5)} °/s (${r.sautOs})`)
    }
  }
  process.exit(0)
}

const jeuxVoulus = args.has('jeu') ? args.get('jeu').split(',') : ['avant', 'durees', 'actuel']
const cibles = args.has('j') ? new Set(args.get('j').split(',')) : null
const rapport = []
let alerte = 0

console.log(`\nrig : ${path.basename(nomVrm)}   ·   jeux : ${jeuxVoulus.join(' / ')}`)
console.log(`${'jonction'.padEnd(24)}${'fondu'.padEnd(17)}${jeuxVoulus.map((j) => `${j} saut/pointe`.padEnd(23)).join('')}`)
for (const j of JONCTIONS) {
  if (cibles && !cibles.has(j.nom)) continue
  const ligne = { nom: j.nom, fondu: j.fondu, paires: j.paires.length, jeux: {} }
  const cols = []
  for (const nomJeu of jeuxVoulus) {
    const [duree, ease] = JEUX[nomJeu][j.fondu]
    const courbe = ease ? EASE : LIN
    let saut = 0, sautOu = '', pointe = 0, somme = 0, n = 0, sommeMin = Infinity
    for (const [a, b] of j.paires) {
      const cA = await clipDe(a)
      // Un clip à cycle unique doit être ARRIVÉ AU BOUT avant le fondu de
      // retour : c'est l'événement 'finished' qui le déclenche dans vrmStage.
      const imagesDepart = j.departOnce && cA ? Math.ceil(cA.duration * 60) + 3 : AV
      // La fenêtre de mesure couvre TOUT le fondu, plus une marge : sinon la
      // marche de FIN (celle du linéaire) tombe hors cadre.
      const images = Math.max(j.images, Math.ceil(duree * 60) + 40)
      const r = await derouler([
        { clip: a, images: imagesDepart, fondu: 0, once: j.departOnce, phase: j.phaseDepart },
        { clip: b, images, fondu: duree, courbe, once: j.once, phase: j.phase ?? j.phaseDe?.(b), mesure: true },
      ])
      if (!r) continue
      n++
      somme += r.saut
      sommeMin = Math.min(sommeMin, r.sommeMin)
      if (r.saut > saut) { saut = r.saut; sautOu = `${a}→${b} (${r.sautOs})` }
      if (r.pointe > pointe) pointe = r.pointe
    }
    if (n > 0 && Math.abs(sommeMin - 1) > 1e-3) { alerte++; console.log(`  !! somme des poids ${sommeMin.toFixed(3)} sur ${j.nom} / ${nomJeu}`) }
    ligne.jeux[nomJeu] = { duree, ease, saut: +saut.toFixed(0), sautMoy: +(somme / Math.max(1, n)).toFixed(0), sautOu, pointe: +pointe.toFixed(0), n }
    cols.push(`${saut.toFixed(0).padStart(4)} (moy ${(somme / Math.max(1, n)).toFixed(0).padStart(3)}) /${pointe.toFixed(0).padStart(5)}`.padEnd(23))
  }
  const [d0, e0] = JEUX[jeuxVoulus[jeuxVoulus.length - 1]][j.fondu]
  console.log(`${j.nom.padEnd(24)}${`${j.fondu} ${d0}${e0 ? '~' : ''}`.padEnd(17)}${cols.join('')}`)
  rapport.push(ligne)
}
console.log(`\n(~ = fondu adouci · saut = la marche de vitesse angulaire, l'à-coup · toutes les paires de variantes)`)
if (alerte) console.log(`!! ${alerte} jonction(s) où la somme des poids a quitté 1`)
if (args.has('json')) fs.writeFileSync(path.join(LAB, args.get('json')), JSON.stringify({ rig: path.basename(nomVrm), rapport }, null, 1))
process.exit(alerte ? 1 : 0)
