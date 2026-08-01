/*
 * Porté en TypeScript depuis Overte (https://github.com/overte-org/overte),
 * fichiers libraries/avatars-renderer/src/avatars-renderer/Head.cpp
 * (saccades, clignement de retargetage — Copyright 2013 High Fidelity, Inc.),
 * libraries/animation/src/Rig.cpp (updateEyeJoint, cône de 25° — Copyright
 * 2015 High Fidelity, Inc., Copyright 2023 Overte e.V.),
 * interface/src/avatar/MyAvatar.cpp (lissage en rotation de la cible —
 * Created by Mark Peng on 8/16/13, Copyright 2012 High Fidelity, Inc.,
 * Copyright 2020 Vircadia contributors, Copyright 2022-2023 Overte e.V.) et
 * scripts/developer/automaticLookAt.js (la table de probabilités de
 * conversation — Created by Luis Cuenca on 11/11/19, Copyright 2019 High
 * Fidelity, Inc.).
 * Distributed under the Apache License, Version 2.0.
 * See http://www.apache.org/licenses/LICENSE-2.0.html
 *
 * MODIFIÉ : transcrit du C++ et du JavaScript d'origine vers TypeScript,
 * adapté à three.js et au rig humanoïde normalisé de @pixiv/three-vrm par le
 * projet Hanami, 2026. L'ensemble est redistribué sous AGPL-3.0.
 *
 * LE REGARD. Trois étages, comme chez eux :
 *  - les YEUX : la cible est un point du monde donné à vrm.lookAt — c'est le
 *    modèle qui applique ses propres courbes et bornes (la voie que la fiche
 *    prévoyait : « alimenter vrm.lookAt.target »). Le cône de 25° d'Overte
 *    (Rig::updateEyeJoint) devient le SEUIL D'ASSISTANCE de la tête : au-delà,
 *    l'œil sature et c'est la tête qui doit tourner.
 *  - la TÊTE : chez Overte, un mélange additif de 9 poses d'aim offset
 *    (grilles 3×3 par direction) faites main dans Maya. Ces poses ne sont PAS
 *    portables : elles vivent dans les images 3 à 150 de fichiers FBX
 *    (idle_aimoffsets.fbx…) que la chaîne de conversion actuelle ne découpe
 *    pas en deltas additifs cuits (bakeAbsoluteDeltaAnim). À la place : une
 *    rotation procédurale douce du cou et de la tête, répartie par
 *    ANGLE_DISTRIBUTION_FACTOR (0,45 par étage, la règle de leur cible
 *    HmdHead) et BORNÉE par la table de limites articulaires — moins riche
 *    que leurs poses d'animateur (l'épaule ne suit pas), mais humaine et sûre.
 *  - le COMPORTEMENT : la table d'automaticLookAt réduite au cas « un seul
 *    interlocuteur » — en écoute on regarde surtout la bouche (45 %), en
 *    parole on alterne les yeux (30/30), fixations de 0,2 à 2 s, petits
 *    décalages en lacet — le micro-va-et-vient qui rend un regard vivant.
 *
 * LE RENONCEMENT — ce que le premier portage n'avait PAS repris, et qui
 * manquait. Chez Overte la tête ne se dévisse jamais, pour deux raisons que la
 * fiche 02 avait notées sans les porter :
 *  - `MyAvatar::updateHeadLookAt` vise par `aimToBlendValues(aimVector,
 *    getWorldOrientation())` : la direction visée est projetée sur les axes X
 *    et Y DU CORPS, jamais sur le monde, et la composante avant/arrière est
 *    JETÉE. Une cible droit derrière rend donc (0, 0) — la pose CENTRE de la
 *    grille d'aim offsets, c'est-à-dire aucune rotation de tête. Leur tête
 *    renonce, continûment, à mesure que la cible passe derrière le buste ;
 *  - `automaticLookAt.js::getHeadConfortAngle` (ligne 795) RAMÈNE la cible de
 *    la tête vers l'avant du corps de `min(90°, écart) × 20/90`, soit jusqu'à
 *    20°, et seulement pour la tête — les yeux gardent la vraie cible.
 * Ni cône explicite, ni hystérésis chez eux : leur repli est continu parce que
 * leur amplitude était PLAFONNÉE PAR CONSTRUCTION (9 poses d'animateur). Notre
 * assistance étant procédurale et non bornée, il faut la borner en clair :
 *  1. un CÔNE D'ATTEIGNABILITÉ tête-buste (lacet et tangage) ;
 *  2. le renoncement à HYSTÉRÉSIS — on lâche à 65°, on ne reprend qu'à 50°,
 *     par fondu vers la pose du clip ; les yeux, qui vont plus loin, ont leur
 *     propre seuil sur l'avant RÉEL de la tête ;
 *  3. un PLAFOND DE VITESSE angulaire — une tête qui suit tourne lentement,
 *     les mouvements rapides sont l'affaire des yeux (saccades).
 * Le 20° de `getHeadConfortAngle` n'est délibérément PAS porté : il fait rater
 * la cible en permanence, ce que le banc de regard mesure justement comme un
 * défaut (cf. fix c5d90d4), et le cône ci-dessus rend le même service sans
 * biaiser le face-à-face.
 *
 * Les DEUX règles de production conservées telles quelles :
 *  - « la cible du regard ne se déplace que pendant que l'œil est fermé » :
 *    au-delà de 20° d'écart (MIN_BLINK_ANGLE 0,35 rad), on demande un
 *    clignement à l'idle — joué à DEMI-VITESSE — et la cible saute pendant
 *    la fermeture. L'idle reste seul maître du clignement (cf. idle.ts).
 *  - « pendant une émotion, on coupe l'IK de tête » : les yeux continuent,
 *    la tête est rendue à l'animation.
 */
import { Object3D, Quaternion, Vector3 } from 'three'
import type { VRM } from '@pixiv/three-vrm'
import { angleBetween, safeLerpQuat, safeMixQuat } from './overteMath'
import { ANGLE_DISTRIBUTION_FACTOR, constraintForBone } from './jointLimits'
import type { RotationConstraint } from './jointLimits'

const DEG = Math.PI / 180

// ── Constantes portées ──────────────────────────────────────────────────────
/** `Rig::updateEyeJoint` — au-delà de ce cône, l'œil sature : la tête tourne. */
const MAX_EYE_ANGLE = 25 * DEG
/** `Head::setLookAtPosition` — écart au-delà duquel on cligne pour re-cibler. */
const MIN_BLINK_ANGLE = 0.35 // rad ≈ 20°
/** `Head::simulate` — saccades : intervalles moyens (s) et amplitudes. */
const AVERAGE_MICROSACCADE_INTERVAL = 1.0
const AVERAGE_SACCADE_INTERVAL = 6.0
const MICROSACCADE_MAGNITUDE = 0.002
const SACCADE_MAGNITUDE = 0.04
/** `automaticLookAt` §3.1 — fractions d'écart comblées PAR IMAGE à 60 i/s. */
const MIN_LOOKAT_HEAD_MIX_ALPHA = 0.04
const MAX_LOOKAT_HEAD_MIX_ALPHA = 0.08
const CAMERA_HEAD_MIX_ALPHA = 0.06
/** `Head.cpp` — clignement forcé 0,25 s après avoir cessé de parler. */
const BLINK_AFTER_TALKING = 0.25
/** Repli du retargetage quand l'émotion tient les paupières (adaptation, cf. update). */
const RETARGET_TIMEOUT = 0.4
/** Fondu de la coupure d'IK de tête à l'émotion (s). */
const HEAD_CUT_FADE = 0.2

// ── Le cône d'atteignabilité, et son hystérésis ─────────────────────────────
//
// LACET TÊTE-BUSTE. Trois nombres se recoupent :
//  - l'anatomie : la rotation axiale du rachis cervical va jusqu'à ~80°, mais
//    au-delà de 60-70° on recrute le tronc — c'est la zone où un cou tenu
//    devient une grimace ;
//  - la table d'Overte, déjà portée dans jointLimits : le lacet, dans le rig
//    normalisé, est le TWIST de la tête (±30°) plus celui du cou (±22,5°),
//    soit ±52,5° réellement délivrables ;
//  - la répartition d'Overte : la chaîne ne délivre que 69,75 % du delta
//    demandé (0,45 + 0,45 × 0,55), donc la demande qui SATURE la table vaut
//    52,5 / 0,6975 ≈ 75°.
// D'où 65° pour lâcher : dans la zone inconfortable de l'anatomie, et encore
// sous les 75° qui plaqueraient le cou contre sa butée pendant le suivi. Et
// 50° pour reprendre : la demande n'y coûte que ~35° de lacet réel, très à
// l'aise. Les 15° d'écart sont l'hystérésis — pas de va-et-vient à la frontière.
const HEAD_REACH_YAW_OUT = 65 * DEG
const HEAD_REACH_YAW_IN = 50 * DEG
/**
 * TANGAGE. Flexion/extension cervicale fonctionnelle ≈ 45-50° ; la table donne
 * 30° (cou) + 60° (tête) d'enveloppe antérieure, jamais atteints ici puisque la
 * caméra du cadrage par défaut n'est qu'à 12 cm sous la tête. Ce seuil ne joue
 * que sur une caméra franchement en surplomb ou au ras du sol.
 * NOTE : lacet et tangage sont bornés SÉPARÉMENT, pas par un cône elliptique —
 * la même approximation qu'Overte assume dans `updateEyeJoint` (« TODO: use
 * swing twist decomposition constraint instead »).
 */
const HEAD_REACH_PITCH_OUT = 45 * DEG
const HEAD_REACH_PITCH_IN = 35 * DEG
/**
 * EN LOCOMOTION, le cône se resserre : quand le buste travaille (il contre-
 * tourne à chaque pas), une tête qui tient 65° de décalage lit comme un
 * torticolis. 45° est le coup d'œil par-dessus l'épaule d'un marcheur. C'est la
 * même politique que les gardes existantes de playReaction et wander.poke, qui
 * refusent déjà de répondre du corps en plein déplacement et « laissent
 * l'attention aux seuls yeux » — et c'est l'esprit de Rig.cpp:2160, où Overte
 * COUPE l'IK de tête pendant une réaction ou en position assise (« TODO: make
 * this smooth » — ici, c'est fondu).
 */
const WALK_REACH_YAW_OUT = 45 * DEG
const WALK_REACH_YAW_IN = 32 * DEG
/** Fondus du renoncement (lent : on ne claque pas) et de la reprise (s). */
const REACH_RELEASE_FADE = 0.45
const REACH_CAPTURE_FADE = 0.3
/**
 * Les YEUX vont plus loin que la tête, et renoncent aussi. Le seuil se mesure
 * sur l'avant RÉEL de la tête — celui d'APRÈS l'assistance et ses butées, pas
 * celui du clip — parce que c'est lui qui dit ce qu'il reste à faire à l'œil.
 * 55° : la limite mécanique du globe oculaire (au-delà, un humain tourne la
 * tête, il ne roule pas l'œil). Au-delà l'œil resterait plaqué en butée : le
 * fondu le ramène vers l'axe de la tête.
 */
const EYE_REACH_OUT = 55 * DEG
const EYE_REACH_IN = 45 * DEG
const EYE_REACH_FADE = 0.25
/**
 * PLAFOND DE VITESSE de la tête en suivi (rad/s). Une tête qui suit une cible
 * tourne lentement — 120 à 180 °/s en suivi confortable ; le rapide, ce sont
 * les saccades, et elles sont déjà l'affaire des yeux (`Head::simulate`).
 * Le plafond porte sur le DELTA, dont la chaîne ne délivre que `CHAIN_SHARE`.
 */
const HEAD_TRACK_RATE = 160 * DEG
const CHAIN_SHARE = ANGLE_DISTRIBUTION_FACTOR + ANGLE_DISTRIBUTION_FACTOR * (1 - ANGLE_DISTRIBUTION_FACTOR)
const MAX_DELTA_RATE = HEAD_TRACK_RATE / CHAIN_SHARE
/**
 * LOCOMOTION, mesurée et jamais déclarée : la vitesse monde de la tête, lissée.
 * Seuils Schmitt (0,30 / 0,15 m/s) très au-dessus du ballant de respiration de
 * l'idle (~0,01 m/s) et bien sous une marche (~0,9 m/s). Au-delà de 6 m/s ce
 * n'est plus une marche mais un saut de scène (chargement, replacement du
 * groupe) : on le jette au lieu de le lisser.
 */
const WALK_SPEED_IN = 0.3
const WALK_SPEED_OUT = 0.15
const WALK_SPEED_SMOOTH = 0.15
const TELEPORT_SPEED = 6

/**
 * La table d'`automaticLookAt` (§3.2), réduite à UN interlocuteur : les modes
 * « main » (regarder les mains de quelqu'un) et la sélection d'avatar tombent,
 * les probabilités restantes sont renormalisées à somme 1 (d'où /0,9).
 * Colonnes conservées : durée de fixation, probabilité et amplitude du
 * décalage (en lacet seulement, comme l'original §3.3).
 */
interface GazeMode {
  /** Point du visage visé : décalage MÉTRIQUE dans le repère de la caméra. */
  right: number
  up: number
  fixMin: number
  fixMax: number
  /** Probabilités du décalage : aucun / tête / yeux / les deux. */
  offNone: number
  offHead: number
  offEyes: number
  offBoth: number
  offMinDeg: number
  offMaxDeg: number
  pListen: number
  pTalk: number
}
/** Écart pupillaire ≈ 6,4 cm : les « yeux » de l'interlocuteur, autour de l'axe caméra. */
const EYE_OFF = 0.032
const MOUTH_DOWN = 0.07
const MODES: readonly GazeMode[] = [
  // bouche : en écoute on regarde surtout la bouche (0,45), fixations 0,2–2 s
  { right: 0, up: -MOUTH_DOWN, fixMin: 0.2, fixMax: 2, offNone: 0.7, offHead: 0.3, offEyes: 0, offBoth: 0, offMinDeg: 1, offMaxDeg: 5, pListen: 0.45 / 0.9, pTalk: 0.25 / 0.9 },
  // œil gauche / œil droit : en parole on alterne (0,30 / 0,30)
  { right: -EYE_OFF, up: 0, fixMin: 0.2, fixMax: 2, offNone: 0.5, offHead: 0.3, offEyes: 0.1, offBoth: 0.1, offMinDeg: 1, offMaxDeg: 5, pListen: 0.2 / 0.9, pTalk: 0.3 / 0.9 },
  { right: EYE_OFF, up: 0, fixMin: 0.2, fixMax: 2, offNone: 0.5, offHead: 0.3, offEyes: 0.1, offBoth: 0.1, offMinDeg: 1, offMaxDeg: 5, pListen: 0.2 / 0.9, pTalk: 0.3 / 0.9 },
  // random : courtes fixations décalées, 5–12°
  { right: 0, up: 0, fixMin: 0.2, fixMax: 1, offNone: 0, offHead: 0, offEyes: 0.4, offBoth: 0.6, offMinDeg: 5, offMaxDeg: 12, pListen: 0.05 / 0.9, pTalk: 0.05 / 0.9 },
]

/** Ce que le regard demande à l'idle — qui reste seul maître du clignement. */
export interface GazeHooks {
  /** Enveloppe brute du clignement en cours (0 ouvert → 1 fermé). */
  blinkAmount(): number
  /** Déclenche un clignement (demi-vitesse si `slow`) s'il n'y en a pas. */
  requestBlink(slow?: boolean): void
  /** Une émotion tient le visage : l'IK de tête se coupe. */
  emotionActive(): boolean
}

export interface Gaze {
  /**
   * La cible de regard, positionnée dans le MONDE à chaque image. À ajouter à
   * la scène et à donner à vrm.lookAt.target — three-vrm applique ensuite les
   * courbes et bornes DÉCLARÉES PAR LE MODÈLE aux os des yeux.
   */
  readonly target: Object3D
  /** Une image. À appeler APRÈS l'idle (qui écrit tête et cou), AVANT vrm.update. */
  update(dt: number, vrm: VRM | null, camera: Object3D, speaking: boolean): void
  /** Nouveau modèle : tout repart du regard neutre. */
  reset(): void
}

// Brouillons de module.
const vEye = new Vector3()
const vDesired = new Vector3()
const vCamRight = new Vector3()
const vCamUp = new Vector3()
const vDir = new Vector3()
const vFwd = new Vector3()
const vSide = new Vector3()
const vBustFwd = new Vector3()
const vBustRight = new Vector3()
const vBustUp = new Vector3()
/** Rebuts de `Matrix4.decompose` : on ne veut que le quaternion. */
const vTrash1 = new Vector3()
const vTrash2 = new Vector3()
const UNIT_Y = new Vector3(0, 1, 0)
const qTmp = new Quaternion()
const qTmp2 = new Quaternion()
const qCam = new Quaternion()
const qBust = new Quaternion()
const qAim = new Quaternion()
const qPrev = new Quaternion()
/** L'identité, JAMAIS écrite — origine des fondus de renoncement. */
const Q_IDENT = new Quaternion()

function clamp1(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v
}

/** Produit scalaire de deux quaternions (les shims maison n'exposent pas `.dot`). */
function dotQuat(a: Quaternion, b: Quaternion): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export function createGaze(hooks: GazeHooks): Gaze {
  const target = new Object3D()
  target.name = 'HanamiGazeTarget'

  // Direction et distance APPLIQUÉES (ce que les yeux regardent vraiment).
  const appliedDir = new Vector3(0, 0, 1)
  let appliedDist = 1.5
  let appliedValid = false
  // Retargetage en attente : la cible ne bouge que pendant la fermeture.
  let pending: Vector3 | null = null
  let pendingFor = 0
  // Saccades (Head::simulate) : cible et état lissé.
  const saccade = new Vector3()
  const saccadeTarget = new Vector3()
  // Mode de conversation courant et minuteur de fixation.
  let mode = MODES[0]
  let fixationLeft = 0
  let yawOffsetDeg = 0
  let offsetEyes = false
  let offsetHead = false
  // IK de tête : delta MONDE lissé, et poids (coupé pendant une émotion).
  const headDelta = new Quaternion()
  let headWeight = 0
  // Clignement d'après-parole.
  let wasSpeaking = false
  let postTalkBlink = -1
  // Contraintes de la chaîne cou-tête : le delta du regard est BORNÉ par la
  // même table que tout le reste (jointLimits) — le regard ne peut pas tordre
  // une nuque au-delà de l'humain, quelle que soit la cible.
  const neckLimit: RotationConstraint | null = constraintForBone('neck')
  const headLimit: RotationConstraint | null = constraintForBone('head')
  // L'AVANT DE LA TÊTE, dans le repère des os NORMALISÉS. Ce n'est PAS toujours
  // +Z, et c'était le bug : les os normalisés de three-vrm sont bâtis dans
  // l'espace PROPRE du modèle (VRMHumanoidRig les crée sans rotation, à partir
  // des positions monde au chargement), et un VRM 0.x y regarde le −Z — c'est
  // exactement la raison d'être de VRMUtils.rotateVRM0, qui retourne vrm.scene
  // et emmène la racine du rig avec elle. Sur les 94 modèles du dossier, 89
  // sont en 0.x : croire la convention +Z donnait un avant de tête à 180° du
  // vrai, et setFromUnitVectors sur deux vecteurs opposés rend une rotation d'un
  // demi-tour autour d'un axe DÉGÉNÉRÉ — ici presque l'axe latéral, puisque la
  // caméra du cadrage par défaut est 12 cm SOUS la tête. D'où la nuque
  // renversée en butée, mesurée à +70,6° d'élévation.
  // Mesuré, jamais supposé : up × (épaule droite − épaule gauche) est l'avant
  // géométrique du personnage, il ne dépend d'aucune convention de format.
  let faceVrm: VRM | null = null
  const faceAxis = new Vector3(0, 0, 1)
  /**
   * LE BUSTE — la référence du cône d'atteignabilité. Overte vise dans le
   * repère du CORPS (`aimToBlendValues(…, getWorldOrientation())`) et non dans
   * le monde : c'est ce qui fait qu'un avatar qui s'éloigne ne se dévisse pas.
   * On prend l'os porteur des épaules (upperChest → chest → spine → hips), et
   * pas les hanches d'office : c'est le buste qui tourne quand on se retourne,
   * et c'est de lui que la nuque mesure son débattement. Ses matrices monde
   * sont fraîches sans frais — il est sur le chemin de parents que
   * `head.updateWorldMatrix(true, false)` vient de remonter.
   */
  let bustNode: Object3D | null = null
  // Renoncement de la tête : état du déclencheur à hystérésis et son fondu.
  let reaching = true
  let reach = 1
  let reachPrimed = false
  // Renoncement des yeux, sur l'avant RÉEL de la tête.
  let eyeReaching = true
  let eyeReach = 1
  let eyeReachPrimed = false
  // Locomotion mesurée : vitesse monde de la tête, lissée, et son verdict.
  const lastEye = new Vector3()
  let lastEyeValid = false
  let bodySpeed = 0
  let walking = false

  function measureFaceAxis(vrm: VRM): void {
    faceAxis.set(0, 0, 1)
    bustNode =
      vrm.humanoid.getNormalizedBoneNode('upperChest') ??
      vrm.humanoid.getNormalizedBoneNode('chest') ??
      vrm.humanoid.getNormalizedBoneNode('spine') ??
      vrm.humanoid.getNormalizedBoneNode('hips')
    const head = vrm.humanoid.getNormalizedBoneNode('head')
    if (!head) return
    head.updateWorldMatrix(true, false)
    head.getWorldQuaternion(qTmp)
    vFwd.set(0, 0, 1).applyQuaternion(qTmp) // ce que le code CROIT être l'avant
    const left = vrm.humanoid.getNormalizedBoneNode('leftUpperArm')
    const right = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')
    if (left && right) {
      left.updateWorldMatrix(true, false)
      right.updateWorldMatrix(true, false)
      left.getWorldPosition(vDir)
      right.getWorldPosition(vSide)
      vSide.sub(vDir)
      vSide.y = 0
      if (vSide.lengthSq() > 1e-8) {
        vDir.crossVectors(UNIT_Y, vSide.normalize()).normalize() // l'avant réel
        faceAxis.z = vDir.dot(vFwd) < 0 ? -1 : 1
        return
      }
    }
    // Repli sans épaules : la convention du format, qui dit la même chose.
    if (vrm.meta?.metaVersion === '0') faceAxis.z = -1
  }

  function pickMode(speaking: boolean): void {
    let roll = Math.random()
    mode = MODES[0]
    for (const m of MODES) {
      const p = speaking ? m.pTalk : m.pListen
      roll -= p
      if (roll <= 0) {
        mode = m
        break
      }
    }
    fixationLeft = rand(mode.fixMin, mode.fixMax)
    // décalage : aucun / tête / yeux / les deux (§3.3 — en lacet seulement)
    const r = Math.random()
    offsetHead = r >= mode.offNone && r < mode.offNone + mode.offHead
    offsetEyes = r >= mode.offNone + mode.offHead && r < mode.offNone + mode.offHead + mode.offEyes
    const both = r >= mode.offNone + mode.offHead + mode.offEyes
    if (both) {
      offsetHead = true
      offsetEyes = true
    }
    yawOffsetDeg = (Math.random() < 0.5 ? -1 : 1) * rand(mode.offMinDeg, mode.offMaxDeg)
  }
  pickMode(false)

  function reset(): void {
    appliedValid = false
    pending = null
    pendingFor = 0
    saccade.set(0, 0, 0)
    saccadeTarget.set(0, 0, 0)
    headDelta.identity()
    headWeight = 0
    postTalkBlink = -1
    neckLimit?.clearHistory()
    headLimit?.clearHistory()
    faceVrm = null // nouveau modèle : l'avant et le buste se remesurent
    // Le renoncement repart NEUF : les deux fondus s'amorceront sur le verdict
    // de la première image (aucune tête qui commence à suivre puis se ravise),
    // et la vitesse mesurée oublie le saut de position du chargement.
    reaching = true
    reach = 1
    reachPrimed = false
    eyeReaching = true
    eyeReach = 1
    eyeReachPrimed = false
    lastEyeValid = false
    bodySpeed = 0
    walking = false
    pickMode(false)
  }

  function update(dt: number, vrm: VRM | null, camera: Object3D, speaking: boolean): void {
    if (!vrm || dt <= 0) return
    const head = vrm.humanoid.getNormalizedBoneNode('head')
    if (!head) return
    if (vrm !== faceVrm) {
      faceVrm = vrm
      measureFaceAxis(vrm)
    }
    head.updateWorldMatrix(true, false)
    head.getWorldPosition(vEye)

    // ── locomotion : MESURÉE, jamais déclarée ─────────────────────────────
    // Rien ne dit au regard que le personnage marche, et rien ne devrait avoir
    // à le lui dire : la vitesse monde de sa tête suffit, et elle est vraie
    // quelle que soit la source du déplacement (allure, transition, décor).
    if (lastEyeValid) {
      const v = vEye.distanceTo(lastEye) / dt
      if (v < TELEPORT_SPEED) bodySpeed += (v - bodySpeed) * (1 - Math.pow(0.5, dt / WALK_SPEED_SMOOTH))
      else bodySpeed = 0
    }
    lastEye.copy(vEye)
    lastEyeValid = true
    walking = bodySpeed > (walking ? WALK_SPEED_OUT : WALK_SPEED_IN)

    // ── comportement : le point du visage visé, et sa fixation ────────────
    fixationLeft -= dt
    if (fixationLeft <= 0) pickMode(speaking)
    camera.getWorldQuaternion(qCam)
    vCamRight.set(1, 0, 0).applyQuaternion(qCam)
    vCamUp.set(0, 1, 0).applyQuaternion(qCam)
    vDesired.copy(camera.position).addScaledVector(vCamRight, mode.right).addScaledVector(vCamUp, mode.up)
    if (offsetEyes && yawOffsetDeg !== 0) {
      // §3.3 : la cible tourne de ±quelques degrés en LACET autour de la tête
      vDir.subVectors(vDesired, vEye).applyAxisAngle(vCamUp.set(0, 1, 0), yawOffsetDeg * DEG)
      vDesired.copy(vEye).add(vDir)
    }

    // ── clignement d'après-parole (BLINK_AFTER_TALKING) ───────────────────
    if (wasSpeaking && !speaking) postTalkBlink = BLINK_AFTER_TALKING
    wasSpeaking = speaking
    if (postTalkBlink >= 0) {
      postTalkBlink -= dt
      if (postTalkBlink < 0) hooks.requestBlink(false)
    }

    // ── la règle : la cible ne se déplace que pendant que l'œil est fermé ──
    vDir.subVectors(vDesired, vEye)
    const dist = Math.max(0.2, vDir.length())
    vDir.normalize()
    if (!appliedValid) {
      appliedDir.copy(vDir)
      appliedDist = dist
      appliedValid = true
    }
    const gap = angleBetween(appliedDir, vDir)
    if (pending) {
      pending.copy(vDesired) // la demande suit la cible pendant l'attente
      pendingFor += dt
      // l'œil est fermé (ou l'émotion tient les paupières trop longtemps) : on saute
      if (hooks.blinkAmount() >= 0.7 || pendingFor > RETARGET_TIMEOUT) {
        appliedDir.copy(vDir)
        appliedDist = dist
        pending = null
        pendingFor = 0
      }
    } else if (gap > MIN_BLINK_ANGLE) {
      pending = vDesired.clone()
      pendingFor = 0
      hooks.requestBlink(true) // le clignement de retargetage, à DEMI-VITESSE
    } else {
      // petit écart : lissage EN ROTATION (§3.6 — jamais le point 3D, la
      // vitesse angulaire doit être constante), à la vitesse de la table.
      const speed = speaking ? MIN_LOOKAT_HEAD_MIX_ALPHA : CAMERA_HEAD_MIX_ALPHA
      const k = Math.min(1, speed * dt * 60)
      qTmp.setFromUnitVectors(appliedDir, vDir)
      safeMixQuat(qTmp2.identity(), qTmp, k, qTmp)
      appliedDir.applyQuaternion(qTmp).normalize()
      appliedDist += (dist - appliedDist) * k
    }

    // ── saccades (Head::simulate, indépendant du framerate) ───────────────
    if (Math.random() < dt / AVERAGE_MICROSACCADE_INTERVAL) {
      saccadeTarget.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(MICROSACCADE_MAGNITUDE)
    } else if (Math.random() < dt / AVERAGE_SACCADE_INTERVAL) {
      saccadeTarget.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(SACCADE_MAGNITUDE)
    }
    const k = Math.pow(0.5, 60 * dt)
    saccade.x += (saccadeTarget.x - saccade.x) * (1 - k)
    saccade.y += (saccadeTarget.y - saccade.y) * (1 - k)
    saccade.z += (saccadeTarget.z - saccade.z) * (1 - k)

    // La cible finale : point appliqué + saccade PROPORTIONNELLE à la
    // distance (Head::getEyeRotation — angulairement constante).
    target.position.copy(vEye).addScaledVector(appliedDir, appliedDist).addScaledVector(saccade, appliedDist)

    // ── ATTEIGNABILITÉ : le cône de la tête PAR RAPPORT AU BUSTE ──────────
    // La question n'est pas « où est la cible dans le monde » mais « de combien
    // la nuque devrait-elle se dévisser » — donc tout se mesure dans le repère
    // du buste, comme Overte vise dans le repère du corps. L'avant du buste est
    // le même ±Z que celui de la tête (les os NORMALISÉS partagent le repère du
    // modèle, cf. measureFaceAxis) ; sa droite est alors ∓X, puisqu'un corps
    // qui regarde +Z, Y en haut, a sa main droite vers −X.
    // `decompose` et non `getWorldQuaternion` : le buste est un ANCÊTRE de la
    // tête, sa matrice monde vient d'être rafraîchie par le
    // `head.updateWorldMatrix(true, false)` ci-dessus — refaire remonter la
    // chaîne serait payer deux fois le même parcours, à chaque image.
    ;(bustNode ?? head).matrixWorld.decompose(vTrash1, qBust, vTrash2)
    vBustFwd.copy(faceAxis).applyQuaternion(qBust)
    vBustRight.set(-faceAxis.z, 0, 0).applyQuaternion(qBust)
    vBustUp.set(0, 1, 0).applyQuaternion(qBust)
    // On juge la direction APPLIQUÉE — celle que le regard s'est engagé à
    // suivre — et non la cible instantanée : les saccades et le retargetage en
    // attente ne doivent pas faire clignoter le verdict.
    const yaw = Math.atan2(appliedDir.dot(vBustRight), appliedDir.dot(vBustFwd))
    const pitch = Math.asin(clamp1(appliedDir.dot(vBustUp)))
    // LE DÉCLENCHEUR À HYSTÉRÉSIS tient en une ligne : engagé, on tolère
    // jusqu'au seuil LARGE ; renoncé, on ne revient qu'au seuil ÉTROIT.
    const yawOut = walking ? WALK_REACH_YAW_OUT : HEAD_REACH_YAW_OUT
    const yawIn = walking ? WALK_REACH_YAW_IN : HEAD_REACH_YAW_IN
    reaching =
      Math.abs(yaw) <= (reaching ? yawOut : yawIn) &&
      Math.abs(pitch) <= (reaching ? HEAD_REACH_PITCH_OUT : HEAD_REACH_PITCH_IN)
    const wantReach = reaching ? 1 : 0
    if (reachPrimed) {
      reach += (wantReach - reach) * Math.min(1, dt / (reaching ? REACH_CAPTURE_FADE : REACH_RELEASE_FADE))
    } else {
      reach = wantReach
      reachPrimed = true
    }

    // ── assistance de la TÊTE ─────────────────────────────────────────────
    // Angle œil-dans-tête demandé : au-delà du cône de 25°, l'œil sature et
    // la tête doit tourner. En deçà, elle suit mollement (la nuance §3.1 :
    // le plus lent quand on parle). Pendant une émotion : coupée.
    head.getWorldQuaternion(qTmp)
    vFwd.copy(faceAxis).applyQuaternion(qTmp)
    vDir.copy(target.position).sub(vEye).normalize()
    const eyeAngle = angleBetween(vFwd, vDir)
    const emotion = hooks.emotionActive()
    const wantWeight = emotion ? 0 : 1
    const wf = Math.min(1, dt / HEAD_CUT_FADE)
    headWeight += (wantWeight - headWeight) * wf
    // vitesse : rapide quand l'œil sature, lente sinon, en parole — ou en
    // marche : la nuance §3.1 d'automaticLookAt est « le plus lent quand on
    // parle ou qu'on ne regarde nulle part », et un corps en déplacement est
    // exactement le cas où l'on n'engage personne.
    const speed =
      speaking || walking
        ? MIN_LOOKAT_HEAD_MIX_ALPHA
        : eyeAngle > MAX_EYE_ANGLE
          ? MAX_LOOKAT_HEAD_MIX_ALPHA
          : MIN_LOOKAT_HEAD_MIX_ALPHA
    const mix = Math.min(1, speed * dt * 60)
    // cible du delta : amener l'avant de la tête vers la cible, décalage de
    // tête de la table compris (offsetHead : ±1-5° de lacet)
    vDesired.copy(vDir)
    if (offsetHead && yawOffsetDeg !== 0) {
      vDesired.applyAxisAngle(vCamUp.set(0, 1, 0), yawOffsetDeg * DEG)
    }
    qTmp2.setFromUnitVectors(vFwd, vDesired)
    // LE RENONCEMENT : la demande elle-même s'efface vers l'identité, qui est
    // la pose du CLIP (vFwd a été lu après l'idle, avant tout delta de regard).
    // Renoncer, ici, c'est littéralement ne plus rien demander — la tête rend
    // l'animation au lieu de rester plaquée contre une butée. À `reach` = 1 le
    // slerp rend `qTmp2` exactement : le face-à-face ne voit rien passer — et
    // ne paie même pas le slerp, qui est court-circuité au poids plein.
    if (reach >= 1) qAim.copy(qTmp2)
    else safeMixQuat(Q_IDENT, qTmp2, reach, qAim)
    // le delta lissé rejoint le delta voulu (slerp sûr), puis s'atténue au poids
    qPrev.copy(headDelta)
    safeMixQuat(headDelta, qAim, mix, headDelta)
    // PLAFOND DE VITESSE. `mix` est une FRACTION de l'écart comblée par image :
    // sur un grand écart elle produit une vitesse énorme (0,08 × 180° à 60 i/s
    // = 864 °/s de delta). On borne donc le pas ANGULAIRE réel.
    const step = 2 * Math.acos(Math.min(1, Math.abs(dotQuat(qPrev, headDelta))))
    const maxStep = MAX_DELTA_RATE * dt
    if (step > maxStep) safeMixQuat(qPrev, headDelta, maxStep / step, headDelta)
    if (headWeight < 0.001) headDelta.identity()

    if (headWeight > 0.001) {
      // Répartition d'Overte (cible HmdHead) : en remontant du bout, chaque
      // étage prend ANGLE_DISTRIBUTION_FACTOR (0,45) du delta RESTANT — la
      // tête 45 %, le cou 45 % des 55 % restants (24,75 %). Puis la TABLE
      // borne chaque étage. Les deltas sont en MONDE : conjugaison par la
      // rotation monde du parent pour l'appliquer en local.
      const headPart = ANGLE_DISTRIBUTION_FACTOR * headWeight
      const neckPart = ANGLE_DISTRIBUTION_FACTOR * (1 - ANGLE_DISTRIBUTION_FACTOR) * headWeight
      const neck = vrm.humanoid.getNormalizedBoneNode('neck')
      if (neck) {
        safeLerpQuat(qTmp.identity(), headDelta, neckPart, qTmp2)
        applyWorldDelta(neck, qTmp2)
        neckLimit?.apply(neck.quaternion)
      }
      safeLerpQuat(qTmp.identity(), headDelta, headPart, qTmp2)
      applyWorldDelta(head, qTmp2)
      headLimit?.apply(head.quaternion)
    }

    // ── les YEUX renoncent aussi, mais plus tard ──────────────────────────
    // Ce qu'il reste à faire à l'œil se mesure sur l'avant RÉEL de la tête,
    // celui d'APRÈS l'assistance ET ses butées — pas sur la pose du clip, qui
    // surestimerait la charge de tout ce que la tête vient d'absorber. La cible
    // est ensuite RAMENÉE vers l'axe de la tête plutôt que laissée derrière :
    // trois-vrm borne l'œil par les courbes du modèle, une cible inatteignable
    // le laisse simplement plaqué en butée — le regard vitreux.
    //
    // La rotation monde de la tête sans REFAIRE remonter la chaîne : quand
    // l'assistance vient de s'appliquer, `applyWorldDelta` a laissé dans `qCam`
    // la rotation monde du PARENT (recalculée avec le cou déjà borné) — il ne
    // reste qu'à composer la locale, elle-même bornée depuis. Sinon rien n'a
    // bougé et la matrice monde de la tête est encore celle du début d'image.
    if (headWeight > 0.001 && head.parent) qTmp.copy(qCam).multiply(head.quaternion)
    else head.matrixWorld.decompose(vTrash1, qTmp, vTrash2)
    vFwd.copy(faceAxis).applyQuaternion(qTmp)
    vDir.subVectors(target.position, vEye) // longueur conservée : saccade comprise
    const eyeLoad = angleBetween(vFwd, vDir)
    eyeReaching = eyeLoad <= (eyeReaching ? EYE_REACH_OUT : EYE_REACH_IN)
    const wantEye = eyeReaching ? 1 : 0
    if (eyeReachPrimed) eyeReach += (wantEye - eyeReach) * Math.min(1, dt / EYE_REACH_FADE)
    else {
      eyeReach = wantEye
      eyeReachPrimed = true
    }
    if (eyeReach < 0.999 && vDir.lengthSq() > 1e-8) {
      vSide.copy(vDir).normalize()
      qTmp.setFromUnitVectors(vSide, vFwd) // la cible → l'axe de la tête
      safeMixQuat(Q_IDENT, qTmp, 1 - eyeReach, qTmp2)
      target.position.copy(vEye).add(vDir.applyQuaternion(qTmp2))
    }
  }

  /** Applique un delta MONDE à la rotation locale d'un os : q ← (P⁻¹ Δ P) q. */
  function applyWorldDelta(node: Object3D, delta: Quaternion): void {
    if (node.parent) {
      node.parent.updateWorldMatrix(true, false)
      node.parent.getWorldQuaternion(qCam)
      qTmp.copy(qCam).invert().multiply(delta).multiply(qCam)
      node.quaternion.premultiply(qTmp)
    } else {
      node.quaternion.premultiply(delta)
    }
  }

  return { target, update, reset }
}
