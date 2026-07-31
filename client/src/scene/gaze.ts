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
const qTmp = new Quaternion()
const qTmp2 = new Quaternion()
const qCam = new Quaternion()

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
    pickMode(false)
  }

  function update(dt: number, vrm: VRM | null, camera: Object3D, speaking: boolean): void {
    if (!vrm || dt <= 0) return
    const head = vrm.humanoid.getNormalizedBoneNode('head')
    if (!head) return
    head.updateWorldMatrix(true, false)
    head.getWorldPosition(vEye)

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

    // ── assistance de la TÊTE ─────────────────────────────────────────────
    // Angle œil-dans-tête demandé : au-delà du cône de 25°, l'œil sature et
    // la tête doit tourner. En deçà, elle suit mollement (la nuance §3.1 :
    // le plus lent quand on parle). Pendant une émotion : coupée.
    head.getWorldQuaternion(qTmp)
    vFwd.set(0, 0, 1).applyQuaternion(qTmp)
    vDir.copy(target.position).sub(vEye).normalize()
    const eyeAngle = angleBetween(vFwd, vDir)
    const emotion = hooks.emotionActive()
    const wantWeight = emotion ? 0 : 1
    const wf = Math.min(1, dt / HEAD_CUT_FADE)
    headWeight += (wantWeight - headWeight) * wf
    // vitesse : rapide quand l'œil sature, lente sinon ou en parole
    const speed = speaking
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
    // le delta lissé rejoint le delta voulu (slerp sûr), puis s'atténue au poids
    safeMixQuat(headDelta, qTmp2, mix, headDelta)
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
