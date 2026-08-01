/**
 * convert-rocketbox.mjs — FBX Microsoft Rocketbox → VRMA (VRMC_vrm_animation 1.0)
 *
 * Produit les 38 clips `vrma/rb-*.vrma` : la famille d'animations de FACE À FACE
 * alternative à celle d'Overte. Un fichier = un clip, indépendant du modèle.
 *
 * ─── TRAÇABILITÉ ────────────────────────────────────────────────────────────
 * Source   : https://github.com/microsoft/Microsoft-Rocketbox — licence MIT
 *            (Copyright (c) Microsoft Corporation, 2020).
 * Commit   : 0943055db6ec570bcef9f2c8b41c9e5467c808f9  ← ÉPINGLÉ
 *            Les FBX du dépôt ne sont PAS versionnés ici (243 Mo pour 77
 *            fichiers) : seuls les .vrma produits le sont, comme pour Overte
 *            et Quaternius. Ce script + `rocketbox-plan.json` sont la recette
 *            complète pour les refabriquer à l'octet près.
 * Méthode  : ce fichier. Son empreinte SHA-256 et celle du plan sont
 *            RECALCULÉES à chaque exécution et écrites dans le rapport ; si
 *            elles s'écartent des constantes ci-dessous, le script le dit —
 *            les .vrma livrés ne viennent alors plus de cette méthode.
 * Licence  : MIT — l'avis de copyright et la permission DOIVENT accompagner
 *            toute redistribution. Voir vrma/NOTICE.md §4.
 * Demande  : l'issue microsoft/Microsoft-Rocketbox#24 (posée par le
 *            propriétaire du projet) reste la trace de bonne foi de la
 *            demande de confirmation faite en amont.
 *
 * ─── LA RÈGLE DES FAMILLES (non négociable) ─────────────────────────────────
 * Un personnage joue Overte OU Rocketbox en face à face, JAMAIS un mélange :
 * les deux bibliothèques n'ont pas la même pose de repos et le raccord croisé
 * mesure 16 à 20 cm d'excursion (contre 0,2 à 5,7 cm à l'intérieur de la
 * famille Rocketbox). Le domaine `world-` (scène vivante 3D) reste, lui,
 * 100 % Overte pour tout le monde. Voir vrma/README.md.
 *
 * ─── USAGE ──────────────────────────────────────────────────────────────────
 *   node scripts/convert-rocketbox.mjs                  convertit tout le plan
 *   node scripts/convert-rocketbox.mjs --slug=rb-idle   un clip (ou un préfixe)
 *   node scripts/convert-rocketbox.mjs --src=<dossier>  FBX source (défaut : SRC_DEFAUT)
 *   node scripts/convert-rocketbox.mjs --sortie=<dossier>  défaut : vrma/
 *   node scripts/convert-rocketbox.mjs --plan=<fichier>    défaut : scripts/rocketbox-plan.json
 *   node scripts/convert-rocketbox.mjs --rapport=<fichier> écrit le JSON détaillé
 *
 * Les FBX attendus sont ceux de `Assets/Animations/all_animations_max_motextr_static/`
 * du dépôt épinglé, déposés À PLAT dans le dossier source (noms d'origine,
 * `f_idle_breathe_02.max.fbx`…). Le plan nomme ceux dont il a besoin.
 *
 * ─── QUATRE DIFFÉRENCES avec le rig Mixamo d'Overte, toutes mesurées ────────
 *
 *  1. LE RIG BIPED N'EXPOSE PAS DE T-POSE. La pose stockée dans les nœuds est la
 *     « pose d'ancrage » de la bibliothèque : bras le long du corps, identique à
 *     0,09° près dans les 34 fichiers d'une famille, et identique à la première ET
 *     à la dernière image de chaque clip. C'est ce qui fait la cohérence de
 *     Rocketbox — et ce qui la rend inutilisable telle quelle comme rest pose
 *     VRMA, puisque le retarget pose « source au repos ⇒ cible en T-pose ».
 *     La T-pose est donc SYNTHÉTISÉE depuis l'ancrage (voir ciblesTpose).
 *
 *  2. LA HIÉRARCHIE BIPED N'EST PAS CELLE DU HUMANOÏDE VRM. Deux divergences :
 *        clavicules  : enfants de « Bip01 Neck »,  VRM attend upperChest
 *        cuisses     : enfants de « Bip01 Spine »,  VRM attend hips
 *     @pixiv/three-vrm-animation calcule pourtant
 *        q_sortie = q_mondeRestParentVRM · q_piste · q_mondeRestOs⁻¹
 *     avec le parent du HUMANOÏDE, pas celui du fichier. Un mappage nom-à-nom
 *     naïf produit donc des .vrma qui se raccordent PARFAITEMENT (l'erreur est
 *     constante, elle s'annule entre un clip et son socle) mais dont les bras
 *     suivent le cou et les jambes suivent le buste : 22° et 3,3° d'erreur au
 *     repos, davantage dès que le cou ou le buste bougent.
 *     Le squelette exporté est donc RECONSTRUIT à la forme du humanoïde VRM, et
 *     les pistes sont recalculées relativement au parent VRM.
 *
 *  3. LE BASSIN N'EST PAS LA RACINE. Bip01 → Bip01_Pelvis : Bip01 porte la
 *     hauteur (91,94 cm) et la root motion, Bip01_Pelvis est le vrai bassin.
 *     Bip01 est aplati dans le bassin, qui devient la racine exportée.
 *
 *  4. LE PIÈGE DU BASSIN, version Rocketbox. `restHipsPosition` est une position
 *     MONDE, et la lib divise TOUTE la piste par sa composante Y. Les clips assis
 *     stockent un ancrage à 61,12 cm : l'écrire comme rest ferait remonter le
 *     personnage assis à la hauteur de hanches DEBOUT du VRM. La rest pose
 *     exportée est donc TOUJOURS la station DEBOUT de la famille (91,94 cm femme,
 *     89,52 cm homme), clips assis compris. L'axe de hauteur est bien Y (Bip01 à
 *     [0 ; 91,94 ; 0], boîte des os 170,6 cm en Y) : aucune rotation racine à
 *     défaire, contrairement au pack Quaternius sorti de Blender en Z-up.
 *
 * ─── CE QUE LE PLAN APPORTE ─────────────────────────────────────────────────
 * `rocketbox-plan.json` décrit chaque clip à produire : source, famille, fenêtre
 * [debutS ; finS], boucle ou non, rôle, et les mesures qui ont DÉCIDÉ de son
 * entrée (raccord au socle de sa famille, couture, pic de vitesse). Un fichier
 * source long donne donc plusieurs .vrma sans toucher au code. Les bornes de
 * fenêtre tombent sur la grille 30 Hz : une fenêtre est reproduite à l'image près.
 *
 * Lecture seule sur les sources. Écrit UNIQUEMENT dans le dossier de sortie
 * (et le rapport, si demandé).
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation'

const ICI = path.dirname(fileURLToPath(import.meta.url))
const RACINE = path.resolve(ICI, '..')

// Empreintes de la méthode et du plan TELS QU'ILS ONT PRODUIT les .vrma livrés.
// Recalculées à chaque exécution (cf. l'en-tête « TRAÇABILITÉ »). Celle de la
// méthode est prise sur le fichier PRIVÉ DE CETTE LIGNE — sinon elle se
// contiendrait elle-même, ce qui n'a pas de point fixe.
const SHA_METHODE = '7076a763cf9ab62faca20efb3f9e7a93e38cb19c0892aa87a209e0be812ac26f'
const SHA_PLAN = '8d8aa36b43f0267bc719818158928729fa42e480717ac94a2ae70b660f7af051'

/** Dossier des FBX Rocketbox (hors dépôt — cf. l'en-tête). */
const SRC_DEFAUT = path.join(RACINE, 'rocketbox-fbx')

const EXTENSION = 'VRMC_vrm_animation'
const R2D = 180 / Math.PI
const ECHELLE = 0.01 // le fichier Rocketbox est en centimètres
const FPS = 30

// Bornes de plausibilité du bassin, reprises telles quelles de convert-animations.mjs.
const BORNES_BASSIN = { fractionMin: 0.4, fractionMax: 1.15, horizMax: 0.6 }
const REST_HANCHES_MIN = 0.3

// ─── Arguments ──────────────────────────────────────────────────────────────
const args = new Map()
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  if (m) args.set(m[1], m[2] ?? '1')
}
const PLAN_F = path.resolve(RACINE, args.get('plan') ?? path.join('scripts', 'rocketbox-plan.json'))
const SRC = path.resolve(RACINE, args.get('src') ?? SRC_DEFAUT)
const OUT = path.resolve(RACINE, args.get('sortie') ?? 'vrma')
const RAPPORT = args.get('rapport') ? path.resolve(RACINE, args.get('rapport')) : null
const FILTRE = args.get('slug')

const plan = JSON.parse(fs.readFileSync(PLAN_F, 'utf8'))

// ════════════════════════════════════════════════════════════════════════════
// TABLE DE MAPPAGE  os Rocketbox (Biped 3ds Max) → VRMHumanBoneName
// Les noms portent un espace dans le fichier (« Bip01 L UpperArm ») ; FBXLoader
// les remplace par un souligné. On garde la forme du loader.
// ════════════════════════════════════════════════════════════════════════════

const OS_BIPED = {
  hips: 'Bip01_Pelvis',
  spine: 'Bip01_Spine',
  chest: 'Bip01_Spine1',
  upperChest: 'Bip01_Spine2',
  neck: 'Bip01_Neck',
  head: 'Bip01_Head',

  leftShoulder: 'Bip01_L_Clavicle',
  leftUpperArm: 'Bip01_L_UpperArm',
  leftLowerArm: 'Bip01_L_Forearm',
  leftHand: 'Bip01_L_Hand',
  rightShoulder: 'Bip01_R_Clavicle',
  rightUpperArm: 'Bip01_R_UpperArm',
  rightLowerArm: 'Bip01_R_Forearm',
  rightHand: 'Bip01_R_Hand',

  leftUpperLeg: 'Bip01_L_Thigh',
  leftLowerLeg: 'Bip01_L_Calf',
  leftFoot: 'Bip01_L_Foot',
  leftToes: 'Bip01_L_Toe0',
  rightUpperLeg: 'Bip01_R_Thigh',
  rightLowerLeg: 'Bip01_R_Calf',
  rightFoot: 'Bip01_R_Foot',
  rightToes: 'Bip01_R_Toe0',
}

for (const [C, p] of [
  ['L', 'left'],
  ['R', 'right'],
]) {
  OS_BIPED[`${p}ThumbMetacarpal`] = `Bip01_${C}_Finger0`
  OS_BIPED[`${p}ThumbProximal`] = `Bip01_${C}_Finger01`
  OS_BIPED[`${p}ThumbDistal`] = `Bip01_${C}_Finger02`
  for (const [vrm, n] of [
    ['Index', 1],
    ['Middle', 2],
    ['Ring', 3],
    ['Little', 4],
  ]) {
    OS_BIPED[`${p}${vrm}Proximal`] = `Bip01_${C}_Finger${n}`
    OS_BIPED[`${p}${vrm}Intermediate`] = `Bip01_${C}_Finger${n}1`
    OS_BIPED[`${p}${vrm}Distal`] = `Bip01_${C}_Finger${n}2`
  }
}

/**
 * Mappables mais VOLONTAIREMENT hors export : les yeux et la mâchoire. Le regard
 * est piloté par le moteur (client/src/scene/gaze.ts) et la bouche par le
 * lipsync — une piste d'œil dans le clip se battrait avec eux.
 */
const OS_BIPED_ECARTES = { leftEye: 'Bip01_LEye', rightEye: 'Bip01_REye', jaw: 'Bip01_MJaw' }

/**
 * Hiérarchie du humanoïde VRM 1.0 (copie de VRMHumanBoneParentMap, la seule qui
 * compte pour le retarget). C'est ELLE que le squelette exporté suit.
 */
const PARENT_VRM = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  upperChest: 'chest',
  neck: 'upperChest',
  head: 'neck',
  leftShoulder: 'upperChest',
  leftUpperArm: 'leftShoulder',
  leftLowerArm: 'leftUpperArm',
  leftHand: 'leftLowerArm',
  rightShoulder: 'upperChest',
  rightUpperArm: 'rightShoulder',
  rightLowerArm: 'rightUpperArm',
  rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips',
  leftLowerLeg: 'leftUpperLeg',
  leftFoot: 'leftLowerLeg',
  leftToes: 'leftFoot',
  rightUpperLeg: 'hips',
  rightLowerLeg: 'rightUpperLeg',
  rightFoot: 'rightLowerLeg',
  rightToes: 'rightFoot',
}
for (const p of ['left', 'right']) {
  PARENT_VRM[`${p}ThumbMetacarpal`] = `${p}Hand`
  PARENT_VRM[`${p}ThumbProximal`] = `${p}ThumbMetacarpal`
  PARENT_VRM[`${p}ThumbDistal`] = `${p}ThumbProximal`
  for (const d of ['Index', 'Middle', 'Ring', 'Little']) {
    PARENT_VRM[`${p}${d}Proximal`] = `${p}Hand`
    PARENT_VRM[`${p}${d}Intermediate`] = `${p}${d}Proximal`
    PARENT_VRM[`${p}${d}Distal`] = `${p}${d}Intermediate`
  }
}

/** Ordre topologique (parents avant enfants) des os exportés. */
const ORDRE_VRM = (() => {
  const vus = new Set()
  const sortie = []
  const pousse = (n) => {
    if (vus.has(n)) return
    const p = PARENT_VRM[n]
    if (p) pousse(p)
    vus.add(n)
    sortie.push(n)
  }
  for (const n of Object.keys(OS_BIPED)) pousse(n)
  return sortie
})()

/** Os exigés par la spec VRM 1.0. */
const OS_REQUIS = [
  'hips',
  'spine',
  'head',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
]

/** Os majeurs : ceux dont l'écart se voit à l'écran (mêmes que le banc anim-lab). */
const OS_MAJEURS = [
  'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'hips', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
]

// ════════════════════════════════════════════════════════════════════════════
// Polyfill FileReader (GLTFExporter vise le navigateur)
// ════════════════════════════════════════════════════════════════════════════
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null
      this.onloadend = null
      this.onerror = null
    }
    #lire(blob, f) {
      blob
        .arrayBuffer()
        .then((ab) => {
          this.result = f(ab)
          this.onloadend?.()
        })
        .catch((e) => {
          if (this.onerror) this.onerror(e)
          else throw e
        })
    }
    readAsArrayBuffer(b) {
      this.#lire(b, (ab) => ab)
    }
    readAsDataURL(b) {
      this.#lire(b, (ab) => `data:application/octet-stream;base64,${Buffer.from(ab).toString('base64')}`)
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Lecture GLB (validation) et écriture de l'extension
// ════════════════════════════════════════════════════════════════════════════

function lireGLB(buffer) {
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('pas un GLB')
  const total = Math.min(dv.getUint32(8, true), buffer.byteLength)
  let json = null
  let bin = null
  let off = 12
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true)
    const type = dv.getUint32(off + 4, true)
    const d = buffer.subarray(off + 8, off + 8 + len)
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(d))
    else if (type === 0x004e4942) bin = d
    off += 8 + len
  }
  if (!json) throw new Error('chunk JSON absent')
  return { json, bin }
}

class VRMAnimationExporterPlugin {
  constructor(writer, mapVRM) {
    this.writer = writer
    this.mapVRM = mapVRM
    this.name = EXTENSION
  }
  afterParse() {
    const humanBones = {}
    for (const [nom, bone] of this.mapVRM) {
      const n = this.writer.nodeMap.get(bone)
      if (n != null) humanBones[nom] = { node: n }
    }
    const j = this.writer.json
    j.extensions ??= {}
    j.extensions[EXTENSION] = { specVersion: '1.0', humanoid: { humanBones } }
    j.extensionsUsed ??= []
    if (!j.extensionsUsed.includes(EXTENSION)) j.extensionsUsed.push(EXTENSION)
    this.writer.extensionsUsed[EXTENSION] = true
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Chargement d'un FBX Rocketbox
// ════════════════════════════════════════════════════════════════════════════

function chargerFBX(chemin) {
  const buf = fs.readFileSync(chemin)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const groupe = new FBXLoader().parse(ab, '')
  const clip = groupe.animations[0]
  if (!clip) throw new Error(`aucune animation dans ${path.basename(chemin)}`)

  const parNom = new Map()
  groupe.traverse((o) => {
    if (o.isBone) parNom.set(o.name, o)
  })

  const notes = []
  for (const b of parNom.values()) {
    b.position.multiplyScalar(ECHELLE)
    for (const a of ['x', 'y', 'z']) if (Math.abs(b.scale[a] - 1) < 1e-4) b.scale[a] = 1
  }
  for (const t of clip.tracks) if (t.name.endsWith('.position')) t.values = t.values.map((v) => v * ECHELLE)

  const racine = parNom.get('Bip01')
  const pelvis = parNom.get('Bip01_Pelvis')
  if (!racine || !pelvis) throw new Error('Bip01 / Bip01_Pelvis introuvables')
  groupe.updateWorldMatrix(false, true)

  return { groupe, parNom, clip, racine, pelvis, notes, taille: buf.length }
}

/** Map<nomVRM, Bone> depuis la table de mappage ; signale les absents. */
function mapperVRM(parNom) {
  const map = new Map()
  const absents = []
  for (const [vrm, os] of Object.entries(OS_BIPED)) {
    const b = parNom.get(os)
    if (b) map.set(vrm, b)
    else absents.push(`${vrm}←${os}`)
  }
  return { map, absents }
}

// ════════════════════════════════════════════════════════════════════════════
// SYNTHÈSE DE LA T-POSE
//
// Le rig est un Biped 3ds Max : l'axe LOCAL +X de chaque os pointe vers son
// enfant (vérifié — toutes les translations locales des os principaux valent
// [d, 0, 0]). Une T-pose se décrit donc entièrement par la DIRECTION MONDE que
// doit prendre ce +X, os par os. Le roulis autour de l'axe reste libre : on le
// laisse hériter de la pose d'ancrage, en n'appliquant que la rotation MINIMALE
// (setFromUnitVectors) qui amène l'axe sur sa cible.
//
// Ce n'est pas un choix cosmétique, c'est le bon : partant de bras le long du
// corps (axe ≈ [0,−1,0]) vers l'horizontale (axe [1,0,0] à gauche), la rotation
// minimale est exactement +90° autour de +Z. La normale de la paume, qui pointe
// vers le corps (−X) bras baissés, devient donc (0,−1,0) : PAUME VERS LE BAS,
// la convention de la T-pose VRM. Rien à corriger à la main.
//
// Ce qu'on ne contraint PAS, et pourquoi : la clavicule (une T-pose ne dit pas où
// pointe une clavicule — l'ancrage la met déjà vers l'extérieur), le pied et
// l'orteil (au repos VRM le pied pointe en avant et vers le bas, ce que l'ancrage
// donne déjà : [0,20 ; −0,58 ; 0,79]), et le pouce entier (une T-pose ne dit pas
// où pointe un pouce).
// ════════════════════════════════════════════════════════════════════════════

const AXE_LOCAL = new THREE.Vector3(1, 0, 0)

function ciblesTpose() {
  const HAUT = [0, 1, 0]
  const BAS = [0, -1, 0]
  const G = [1, 0, 0]
  const D = [-1, 0, 0]
  const c = {
    hips: HAUT, spine: HAUT, chest: HAUT, upperChest: HAUT, neck: HAUT, head: HAUT,
    leftShoulder: null, rightShoulder: null,
    leftUpperArm: G, leftLowerArm: G, leftHand: G,
    rightUpperArm: D, rightLowerArm: D, rightHand: D,
    leftUpperLeg: BAS, leftLowerLeg: BAS, rightUpperLeg: BAS, rightLowerLeg: BAS,
    leftFoot: null, rightFoot: null, leftToes: null, rightToes: null,
  }
  for (const [p, dir] of [
    ['left', G],
    ['right', D],
  ]) {
    c[`${p}ThumbMetacarpal`] = null
    c[`${p}ThumbProximal`] = null
    c[`${p}ThumbDistal`] = null
    for (const d of ['Index', 'Middle', 'Ring', 'Little']) {
      c[`${p}${d}Proximal`] = dir
      c[`${p}${d}Intermediate`] = dir
      c[`${p}${d}Distal`] = dir
    }
  }
  return c
}

/**
 * Repos d'une famille, calculé sur son fichier DEBOUT de référence.
 *   qA / pA : rotation et position MONDE de la pose d'ancrage
 *   qT      : rotation MONDE de la T-pose synthétisée
 *   off     : offset de l'os dans le repère d'ANCRAGE de son parent VRM
 *   hipsY   : hauteur de hanches debout, en mètres
 */
function reposFamille(chemin) {
  const src = chargerFBX(chemin)
  const { map, absents } = mapperVRM(src.parNom)

  const qA = new Map()
  const pA = new Map()
  for (const [os, b] of map) {
    qA.set(os, b.getWorldQuaternion(new THREE.Quaternion()))
    pA.set(os, b.getWorldPosition(new THREE.Vector3()))
  }

  // Cascade sur la HIÉRARCHIE VRM, jamais sur celle du fichier : redresser le cou
  // de 22° ne doit pas emporter les clavicules (elles pendent au cou dans le
  // Biped, mais au haut du buste pour VRM), et redresser le buste ne doit pas
  // emporter les cuisses (elles pendent à la première vertèbre dans le Biped,
  // mais au bassin pour VRM). Chaque os est amené sur sa cible par la rotation
  // MINIMALE ; ses enfants héritent, et leur résidu est mesuré APRÈS.
  const cibles = ciblesTpose()
  const qT = new Map()
  const corrections = []
  for (const os of ORDRE_VRM) {
    if (!qA.has(os)) continue
    const p = PARENT_VRM[os]
    const qLocalAncrage = p && qA.has(p) ? qA.get(p).clone().invert().multiply(qA.get(os)) : qA.get(os).clone()
    const wCur = p && qT.has(p) ? qT.get(p).clone().multiply(qLocalAncrage) : qLocalAncrage
    const cible = cibles[os]
    if (!cible) {
      qT.set(os, wCur)
      continue
    }
    const axe = AXE_LOCAL.clone().applyQuaternion(wCur).normalize()
    const q = new THREE.Quaternion().setFromUnitVectors(axe, new THREE.Vector3().fromArray(cible))
    qT.set(os, q.clone().multiply(wCur))
    corrections.push({ os, deg: +(2 * Math.acos(Math.min(1, Math.abs(q.w))) * R2D).toFixed(2) })
  }

  // offset local = (P_ancrage(os) − P_ancrage(parentVRM)) exprimé dans le repère
  // d'ancrage du parent VRM. Reporté tel quel dans la T-pose, il donne un
  // squelette cohérent (bras écartés, jambes droites).
  const off = new Map()
  for (const os of ORDRE_VRM) {
    if (!qA.has(os)) continue
    const p = PARENT_VRM[os]
    if (!p || !qA.has(p)) {
      off.set(os, new THREE.Vector3(0, 0, 0))
      continue
    }
    off.set(os, pA.get(os).clone().sub(pA.get(p)).applyQuaternion(qA.get(p).clone().invert()))
  }

  return { chemin, src, map, absents, qA, pA, qT, off, hipsY: pA.get('hips').y, corrections }
}

/**
 * Bâtit le squelette EXPORTÉ : un nœud par os VRM, nommé par son nom VRM,
 * parenté selon PARENT_VRM, posé en T-pose, bassin à la hauteur debout.
 * C'est ce squelette qui devient la rest pose du .vrma.
 */
function squeletteExport(repos) {
  const noeuds = new Map()
  for (const os of ORDRE_VRM) {
    if (!repos.qT.has(os)) continue
    const b = new THREE.Bone()
    b.name = os
    const p = PARENT_VRM[os]
    if (p && noeuds.has(p)) {
      noeuds.get(p).add(b)
      b.position.copy(repos.off.get(os))
      b.quaternion.copy(repos.qT.get(p).clone().invert()).multiply(repos.qT.get(os))
    } else {
      b.position.set(0, repos.hipsY, 0)
      b.quaternion.copy(repos.qT.get(os))
    }
    noeuds.set(os, b)
  }
  const racine = noeuds.get('hips')
  racine.updateWorldMatrix(false, true)
  return { racine, noeuds }
}

/** Géométrie de contrôle du squelette exporté. */
function geometrieExport(sq) {
  sq.racine.updateWorldMatrix(false, true)
  const wp = (os) => sq.noeuds.get(os).getWorldPosition(new THREE.Vector3())
  const dir = (a, b) => wp(b).sub(wp(a)).normalize()
  const boite = new THREE.Box3()
  for (const b of sq.noeuds.values()) boite.expandByPoint(b.getWorldPosition(new THREE.Vector3()))
  const r3 = (v) => v.toArray().map((x) => +x.toFixed(3))
  return {
    brasG: r3(dir('leftUpperArm', 'leftLowerArm')),
    brasD: r3(dir('rightUpperArm', 'rightLowerArm')),
    mainG: r3(dir('leftLowerArm', 'leftHand')),
    jambeG: r3(dir('leftUpperLeg', 'leftLowerLeg')),
    buste: r3(dir('hips', 'head')),
    hipsY: +wp('hips').y.toFixed(4),
    envergureX: +(boite.max.x - boite.min.x).toFixed(3),
    hauteurY: +(boite.max.y - boite.min.y).toFixed(3),
    solY: +boite.min.y.toFixed(4),
  }
}

// ─── repos de famille (une seule fois par famille) ──────────────────────────
const repos = new Map()
function reposDe(cle) {
  const fam = plan.familles[cle]
  if (!fam) throw new Error(`famille inconnue : ${cle}`)
  // GARDE-FOU : la référence de repos doit être un fichier DEBOUT (différence n°4).
  if (/_sit_/.test(fam.refDebout)) throw new Error(`refDebout de « ${cle} » est un fichier assis : ${fam.refDebout}`)
  if (!repos.has(fam.refDebout)) {
    const r = reposFamille(path.join(SRC, fam.refDebout))
    if (!(r.hipsY > REST_HANCHES_MIN)) throw new Error(`hanches de repos ${r.hipsY} m < ${REST_HANCHES_MIN} m`)
    repos.set(fam.refDebout, r)
  }
  return repos.get(fam.refDebout)
}

// ════════════════════════════════════════════════════════════════════════════
// Échantillonnage d'une FENÊTRE : rotations MONDE image par image
// ════════════════════════════════════════════════════════════════════════════
function echantillonner(src, map, debutS, finS) {
  const d = Math.max(0, debutS ?? 0)
  const f = Math.min(src.clip.duration, finS ?? src.clip.duration)
  if (!(f > d)) throw new Error(`fenêtre vide [${d} ; ${f}]`)
  const i0 = Math.round(d * FPS)
  const i1 = Math.round(f * FPS)
  const n = i1 - i0
  if (n < 2) throw new Error(`fenêtre trop courte : ${n + 1} images`)

  const times = new Float32Array(n + 1)
  for (let i = 0; i <= n; i++) times[i] = i / FPS

  const mondes = new Map([...map.keys()].map((os) => [os, []]))
  const hipsPos = new Float32Array((n + 1) * 3)
  const mixer = new THREE.AnimationMixer(src.groupe)
  mixer.clipAction(src.clip).play()
  const pw = new THREE.Vector3()

  for (let i = 0; i <= n; i++) {
    mixer.setTime(Math.min((i0 + i) / FPS, src.clip.duration))
    src.groupe.updateWorldMatrix(false, true)
    for (const [os, b] of map) mondes.get(os).push(b.getWorldQuaternion(new THREE.Quaternion()))
    map.get('hips').getWorldPosition(pw)
    hipsPos.set([pw.x, pw.y, pw.z], i * 3)
  }
  mixer.stopAllAction()
  mixer.uncacheClip(src.clip)

  // pistes LOCALES relatives au parent VRM (et non au parent du fichier)
  const quats = new Map()
  for (const os of ORDRE_VRM) {
    if (!mondes.has(os)) continue
    const p = PARENT_VRM[os]
    const v = new Float32Array((n + 1) * 4)
    for (let i = 0; i <= n; i++) {
      const w = mondes.get(os)[i]
      const q = p && mondes.has(p) ? mondes.get(p)[i].clone().invert().multiply(w) : w.clone()
      v.set([q.x, q.y, q.z, q.w], i * 4)
    }
    for (let i = 4; i < v.length; i += 4) {
      // continuité d'hémisphère
      const dp = v[i] * v[i - 4] + v[i + 1] * v[i - 3] + v[i + 2] * v[i - 2] + v[i + 3] * v[i - 1]
      if (dp < 0) for (let c = 0; c < 4; c++) v[i + c] = -v[i + c]
    }
    quats.set(os, v)
  }

  let dx = 0
  let dz = 0
  let dyMin = Infinity
  let dyMax = -Infinity
  for (let i = 0; i <= n; i++) {
    dx = Math.max(dx, Math.abs(hipsPos[i * 3] - hipsPos[0]))
    dz = Math.max(dz, Math.abs(hipsPos[i * 3 + 2] - hipsPos[2]))
    dyMin = Math.min(dyMin, hipsPos[i * 3 + 1])
    dyMax = Math.max(dyMax, hipsPos[i * 3 + 1])
  }
  return {
    times, quats, mondes, hipsPos,
    n: n + 1, i0, i1,
    deplacement: { dx, dz, dyMin, dyMax },
    dureeS: n / FPS,
  }
}

const ang = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * R2D

// ════════════════════════════════════════════════════════════════════════════
async function convertirUn(e) {
  const notes = []
  const src = chargerFBX(path.join(SRC, e.fbx))
  const { map, absents } = mapperVRM(src.parNom)
  const manquants = OS_REQUIS.filter((n) => !map.has(n))
  if (manquants.length) throw new Error(`os VRM requis absents : ${manquants.join(',')}`)
  if (absents.length) notes.push(`os source absents : ${absents.join(', ')}`)

  const rep = reposDe(e.famille)
  const seq = echantillonner(src, map, e.debutS, e.finS)

  // squelette exporté : reconstruit à la forme du humanoïde VRM, en T-pose
  const sq = squeletteExport(rep)
  const geoRest = geometrieExport(sq)

  // ── GARDE-FOU CENTRAL : la rest exportée EST une T-pose ──────────────────
  // C'est ce contrôle qui a attrapé les deux bugs de la preuve de concept
  // (rotation racine perdue, hiérarchie de travers).
  const proche = (v, c, tol = 0.05) => v.every((x, i) => Math.abs(x - c[i]) < tol)
  const echecs = []
  if (!proche(geoRest.brasG, [1, 0, 0])) echecs.push(`brasG ${JSON.stringify(geoRest.brasG)}`)
  if (!proche(geoRest.brasD, [-1, 0, 0])) echecs.push(`brasD ${JSON.stringify(geoRest.brasD)}`)
  if (!proche(geoRest.mainG, [1, 0, 0])) echecs.push(`mainG ${JSON.stringify(geoRest.mainG)}`)
  if (!proche(geoRest.jambeG, [0, -1, 0])) echecs.push(`jambeG ${JSON.stringify(geoRest.jambeG)}`)
  if (!proche(geoRest.buste, [0, 1, 0])) echecs.push(`buste ${JSON.stringify(geoRest.buste)}`)
  if (!(geoRest.envergureX > 1.2 && geoRest.envergureX < 2.2)) echecs.push(`envergure ${geoRest.envergureX} m`)
  if (!(geoRest.hauteurY > 1.3 && geoRest.hauteurY < 2.1)) echecs.push(`hauteur ${geoRest.hauteurY} m`)
  if (Math.abs(geoRest.solY) > 0.06) echecs.push(`pieds à ${geoRest.solY} m du sol`)
  if (echecs.length) throw new Error(`rest pose exportée ≠ T-pose — ${echecs.join(' ; ')}`)
  if (Math.abs(geoRest.hipsY - rep.hipsY) > 1e-4) throw new Error(`hanches exportées ${geoRest.hipsY} ≠ ${rep.hipsY}`)
  if (!(rep.hipsY > REST_HANCHES_MIN)) throw new Error(`rest hanches ${rep.hipsY} m trop basse`)

  const mapExport = new Map([...sq.noeuds.entries()].filter(([os]) => map.has(os)))

  const tracks = []
  for (const [os, v] of seq.quats) {
    if (!sq.noeuds.has(os)) continue
    const t = new THREE.QuaternionKeyframeTrack(`${os}.quaternion`, seq.times, v)
    t.optimize()
    tracks.push(t)
  }
  const tp = new THREE.VectorKeyframeTrack('hips.position', seq.times, seq.hipsPos)
  tp.optimize()
  tracks.push(tp)

  const clip = new THREE.AnimationClip(e.slug, -1, tracks)
  const exporteur = new GLTFExporter()
  exporteur.register((w) => new VRMAnimationExporterPlugin(w, mapExport))
  const glb = await exporteur.parseAsync(sq.racine, { animations: [clip], binary: true })

  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, `${e.slug}.vrma`), Buffer.from(glb))

  // ── bords : où en est-on par rapport à l'ancrage de la famille ? ─────────
  // (mesuré à la SOURCE ; le banc anim-lab le confirme ensuite sur de vrais rigs)
  const bordDeg = (i) => {
    let m = 0
    let os = null
    for (const k of OS_MAJEURS) {
      const a = seq.mondes.get(k)?.[i]
      const b = rep.qA.get(k)
      if (!a || !b) continue
      const d = ang(a, b)
      if (d > m) {
        m = d
        os = k
      }
    }
    return { deg: +m.toFixed(1), os }
  }
  const couture = (() => {
    if (!e.boucle) return null
    let m = 0
    let os = null
    for (const k of OS_MAJEURS) {
      const a = seq.mondes.get(k)?.[0]
      const b = seq.mondes.get(k)?.[seq.n - 1]
      if (!a || !b) continue
      const d = ang(a, b)
      if (d > m) {
        m = d
        os = k
      }
    }
    const dh =
      Math.hypot(
        seq.hipsPos[0] - seq.hipsPos[(seq.n - 1) * 3],
        seq.hipsPos[1] - seq.hipsPos[(seq.n - 1) * 3 + 1],
        seq.hipsPos[2] - seq.hipsPos[(seq.n - 1) * 3 + 2],
      ) * 100
    return { deg: +m.toFixed(2), os, bassinCm: +dh.toFixed(2) }
  })()

  return {
    slug: e.slug, role: e.role, source: e.fbx, famille: e.famille, boucle: !!e.boucle,
    fenetre: {
      debutS: +(seq.i0 / FPS).toFixed(3),
      finS: +(seq.i1 / FPS).toFixed(3),
      entier: seq.i0 === 0 && Math.abs(seq.i1 / FPS - src.clip.duration) < 0.05,
    },
    dureeSource: +src.clip.duration.toFixed(3),
    duree: +clip.duration.toFixed(3),
    frames: seq.n, pistes: tracks.length, osVRM: mapExport.size,
    tailleFbx: src.taille, taille: glb.byteLength, hipsRestY: +rep.hipsY.toFixed(4),
    bordEntree: bordDeg(0), bordSortie: bordDeg(seq.n - 1), coutureSource: couture,
    bassin: {
      fractionMin: +(seq.deplacement.dyMin / rep.hipsY).toFixed(3),
      fractionMax: +(seq.deplacement.dyMax / rep.hipsY).toFixed(3),
      derivX: +seq.deplacement.dx.toFixed(4),
      derivZ: +seq.deplacement.dz.toFixed(4),
    },
    geoRest,
    notes: notes.concat(src.notes),
  }
}

// ════════════════════════════════════════════════════════════════════════════
// VALIDATION ALLER-RETOUR : on relit ce qu'on vient d'écrire, avec la MÊME
// chaîne que le client (GLTFLoader + VRMAnimationLoaderPlugin).
// ════════════════════════════════════════════════════════════════════════════

function chargerVRMA(buf) {
  const loader = new GLTFLoader()
  loader.register((p) => new VRMAnimationLoaderPlugin(p))
  return new Promise((res, rej) =>
    loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej),
  )
}

async function valider(slug) {
  const brut = fs.readFileSync(path.join(OUT, `${slug}.vrma`))
  const pb = []
  const { json } = lireGLB(brut)
  const ext = json.extensions?.[EXTENSION]
  if (!json.extensionsUsed?.includes(EXTENSION)) pb.push('extensionsUsed')
  if (!ext) pb.push('extension absente')
  else {
    if (ext.specVersion !== '1.0') pb.push(`specVersion=${ext.specVersion}`)
    const m = OS_REQUIS.filter((n) => ext.humanoid?.humanBones?.[n]?.node == null)
    if (m.length) pb.push(`os requis manquants: ${m.join(',')}`)
    for (const os of Object.keys(OS_BIPED_ECARTES)) {
      if (ext.humanoid?.humanBones?.[os]) pb.push(`${os} exporté (il doit rester au moteur)`)
    }
  }

  const gltf = await chargerVRMA(brut)
  const anim = gltf.userData.vrmAnimations?.[0]
  if (!anim) {
    pb.push('vrmAnimations vide')
    return { slug, pb }
  }
  const restY = +anim.restHipsPosition.y.toFixed(4)
  if (!(restY > REST_HANCHES_MIN)) pb.push(`restHipsPosition.y=${restY} < ${REST_HANCHES_MIN} m`)

  const piste = anim.humanoidTracks.translation.get('hips')
  let bassin = null
  if (piste) {
    const v = piste.values
    let yMin = Infinity
    let yMax = -Infinity
    let horiz = 0
    for (let i = 0; i < v.length; i += 3) {
      const y = v[i + 1] / restY
      if (y < yMin) yMin = y
      if (y > yMax) yMax = y
      horiz = Math.max(horiz, Math.hypot(v[i], v[i + 2]) / restY)
    }
    bassin = { fraction: [+yMin.toFixed(3), +yMax.toFixed(3)], horiz: +horiz.toFixed(3) }
    if (yMax > BORNES_BASSIN.fractionMax) pb.push(`bassin à ${yMax.toFixed(3)}× la hauteur de repos`)
    if (yMin < BORNES_BASSIN.fractionMin) pb.push(`bassin à ${yMin.toFixed(3)}× la hauteur de repos`)
    if (horiz > BORNES_BASSIN.horizMax) pb.push(`bassin à ${horiz.toFixed(3)}× de son origine horizontale`)
  } else pb.push('aucune piste de translation sur hips')

  return {
    slug, restY, bassin,
    nbOs: Object.keys(ext?.humanoid?.humanBones ?? {}).length,
    nbRot: anim.humanoidTracks.rotation.size,
    nbTrans: anim.humanoidTracks.translation.size,
    duree: +anim.duration.toFixed(3),
    taille: brut.length,
    pb,
  }
}

// ════════════════════════════════════════════════════════════════════════════

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

/** Empreinte de la méthode : ce fichier, sa ligne SHA_METHODE neutralisée. */
function empreinteMethode() {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
  return sha(src.replace(/^const SHA_METHODE = .*$/m, 'const SHA_METHODE = <self>'))
}

async function main() {
  const shaMethode = empreinteMethode()
  const shaPlan = sha(fs.readFileSync(PLAN_F))
  console.log(`dépôt   ${plan.depot} @ ${plan.commit}`)
  console.log(`méthode ${shaMethode.slice(0, 16)}…${shaMethode === SHA_METHODE ? '' : '  ← DIFFÈRE de l’en-tête'}`)
  console.log(`plan    ${shaPlan.slice(0, 16)}…${shaPlan === SHA_PLAN ? '' : '  ← DIFFÈRE de l’en-tête'}`)
  if (!fs.existsSync(SRC)) {
    console.error(
      `\nDossier source introuvable : ${SRC}\n` +
        `Dépose à plat les .max.fbx de Assets/Animations/all_animations_max_motextr_static/\n` +
        `(dépôt ${plan.depot}, commit ${plan.commit}), ou passe --src=<dossier>.`,
    )
    process.exit(2)
  }

  const liste = plan.clips.filter((e) => !FILTRE || e.slug === FILTRE || e.slug.startsWith(FILTRE))
  console.log(`\nplan : ${liste.length} clips · sortie ${path.relative(RACINE, OUT) || '.'}\n`)
  const res = []
  const echecsConv = []
  for (const e of liste) {
    try {
      const m = await convertirUn(e)
      res.push(m)
      console.log(
        `  ✓ ${e.slug.padEnd(20)} ${m.duree.toFixed(2)}s ${String(m.frames).padStart(4)} img ` +
          `${String(m.pistes).padStart(3)} pistes ${(m.taille / 1024).toFixed(0).padStart(4)} Ko  ` +
          `bords ${String(m.bordEntree.deg).padStart(5)}° / ${String(m.bordSortie.deg).padStart(5)}°` +
          `${m.coutureSource ? `  couture ${m.coutureSource.deg}° ${m.coutureSource.bassinCm} cm` : ''}` +
          `  ← ${e.fbx.replace('.max.fbx', '')}${m.fenetre.entier ? '' : ` [${m.fenetre.debutS}–${m.fenetre.finS}]`}`,
      )
      for (const n of m.notes) console.log(`      ! ${n}`)
    } catch (err) {
      echecsConv.push({ slug: e.slug, erreur: String(err.message ?? err) })
      console.log(`  ✗ ${e.slug.padEnd(20)} ${err.message ?? err}`)
    }
  }

  console.log('\n── T-pose synthétisée depuis la pose d’ancrage ──')
  for (const [f, r] of repos) {
    const g = geometrieExport(squeletteExport(r))
    const top = [...r.corrections].sort((a, b) => b.deg - a.deg).slice(0, 6)
    console.log(`  ${f}  ·  hanches debout ${r.hipsY.toFixed(4)} m · envergure ${g.envergureX} m · hauteur ${g.hauteurY} m`)
    console.log(
      `    bras G ${JSON.stringify(g.brasG)} · bras D ${JSON.stringify(g.brasD)} · ` +
        `jambe G ${JSON.stringify(g.jambeG)} · buste ${JSON.stringify(g.buste)}`,
    )
    console.log(`    corrections : ${top.map((c) => `${c.os} ${c.deg}°`).join(', ')}`)
  }

  console.log('\n── validation aller-retour ──')
  const vals = []
  let echecs = 0
  for (const m of res) {
    const v = await valider(m.slug)
    vals.push(v)
    if (v.pb.length) {
      echecs++
      console.log(`  ✗ ${m.slug} — ${v.pb.join(' ; ')}`)
    }
  }
  console.log(
    `  ${res.length - echecs}/${res.length} fichiers valides` +
      (echecsConv.length ? ` · ${echecsConv.length} conversions en échec` : ''),
  )
  const total = res.reduce((a, m) => a + m.taille, 0)
  console.log(
    `  poids total ${(total / 1048576).toFixed(2)} Mo · durée cumulée ${res.reduce((a, m) => a + m.duree, 0).toFixed(1)} s`,
  )

  if (RAPPORT) {
    fs.writeFileSync(
      RAPPORT,
      JSON.stringify(
        {
          depot: plan.depot, commit: plan.commit,
          shaMethode, shaPlan,
          plan: path.basename(PLAN_F),
          conversions: res, validation: vals, echecs: echecsConv,
          repos: [...repos.entries()].map(([f, r]) => ({
            fichier: f, hipsY: r.hipsY, absents: r.absents, corrections: r.corrections,
            geoExport: geometrieExport(squeletteExport(r)),
          })),
        },
        null,
        1,
      ),
    )
    console.log(`\n→ ${path.relative(RACINE, RAPPORT)}`)
  }
  if (echecs || echecsConv.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
