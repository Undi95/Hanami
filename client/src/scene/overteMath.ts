/*
 * Porté en TypeScript depuis Overte (https://github.com/overte-org/overte),
 * fichiers libraries/animation/src/AnimUtil.h / AnimUtil.cpp,
 * libraries/shared/src/GLMHelpers.cpp et libraries/shared/src/GeometryUtil.cpp.
 *
 * Created by Anthony J. Thibault on 9/2/15 (AnimUtil),
 * Stephen Birarda on 2014-08-07 (GLMHelpers).
 * Copyright (c) 2015 High Fidelity, Inc. All rights reserved.
 * Copyright (c) 2014 High Fidelity, Inc. (GLMHelpers)
 * Distributed under the Apache License, Version 2.0.
 * See http://www.apache.org/licenses/LICENSE-2.0.html
 *
 * MODIFIÉ : transcrit du C++ vers TypeScript, adapté à three.js et au rig
 * humanoïde normalisé de @pixiv/three-vrm par le projet Hanami, 2026.
 * L'ensemble est redistribué sous AGPL-3.0.
 *
 * La boîte à outils mathématique du moteur d'animation d'Overte — tout le reste
 * du portage (contraintes articulaires, IK, regard) s'appuie dessus. Écarts
 * assumés par rapport à l'original, tous documentés sur place :
 *  - glm::quat est (w,x,y,z), three.Quaternion est (x,y,z,w) : les formules sont
 *    transcrites composante par composante, jamais par copie aveugle ;
 *  - un quaternion de norme quasi nulle est ramené à l'identité au lieu de
 *    produire des NaN (GLM laissait faire l'IEEE) ;
 *  - `boneLookAt` n'est PAS porté : son propre code porte un « TODO REVISIT
 *    THIS, this could be -w » jamais tranché, et rien ici ne l'appelle ;
 *  - `findPointKDopDisplacement` n'est PAS porté : il exige les volumes de
 *    collision par os (k-DOP à 14 faces) que le format VRM ne fournit pas ;
 *  - `computeBodyFacingFromHead` n'est PAS porté : il sert aux casques VR
 *    (deviner le corps sous une tête trackée), sans équivalent ici.
 *
 * AUCUNE allocation dans les fonctions par-image : tout écrit dans des
 * paramètres de sortie, les intermédiaires vivent dans des brouillons de module.
 */
import { Quaternion, Vector3 } from 'three'

const EPSILON = 1e-6
const TWO_PI = Math.PI * 2

// Brouillons de module (les fonctions par-image n'allouent rien).
const qTmpA = new Quaternion()
const vTmpA = new Vector3()
const vTmpB = new Vector3()

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/**
 * Normalise `q` sur place. Norme quasi nulle → identité (adaptation : GLM
 * rendait des NaN, et un NaN dans un quaternion d'os gèle tout le squelette).
 */
function normalizeQuat(q: Quaternion): Quaternion {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w)
  if (len < EPSILON) return q.set(0, 0, 0, 1)
  const inv = 1 / len
  return q.set(q.x * inv, q.y * inv, q.z * inv, q.w * inv)
}

/** Produit scalaire de deux quaternions (leurs 4 composantes). */
function dotQuat(a: Quaternion, b: Quaternion): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w
}

// ── 1. Mélange de poses ─────────────────────────────────────────────────────

/**
 * `AnimUtil.h:35-43` — nlerp avec correction de polarité. Pour des poses
 * proches (le cas général en animation) c'est plus rapide qu'un slerp et
 * visuellement identique ; la correction de signe est obligatoire, sans elle un
 * delta proche de l'identité mais de signe opposé fait faire un tour complet.
 */
export function safeLerpQuat(a: Quaternion, b: Quaternion, alpha: number, out: Quaternion): Quaternion {
  const sign = dotQuat(a, b) < 0 ? -1 : 1
  out.set(
    a.x + (sign * b.x - a.x) * alpha,
    a.y + (sign * b.y - a.y) * alpha,
    a.z + (sign * b.z - a.z) * alpha,
    a.w + (sign * b.w - a.w) * alpha,
  )
  return normalizeQuat(out)
}

/**
 * `AnimUtil.h:45-58` — combinaison linéaire de trois quaternions, signes de
 * b et c corrigés par rapport à a, puis normalisation.
 */
export function safeLinearCombine3(
  a: Quaternion,
  b: Quaternion,
  c: Quaternion,
  alphas: readonly [number, number, number],
  out: Quaternion,
): Quaternion {
  const sb = dotQuat(a, b) < 0 ? -1 : 1
  const sc = dotQuat(a, c) < 0 ? -1 : 1
  out.set(
    alphas[0] * a.x + alphas[1] * sb * b.x + alphas[2] * sc * c.x,
    alphas[0] * a.y + alphas[1] * sb * b.y + alphas[2] * sc * c.y,
    alphas[0] * a.z + alphas[1] * sb * b.z + alphas[2] * sc * c.z,
    alphas[0] * a.w + alphas[1] * sb * b.w + alphas[2] * sc * c.w,
  )
  return normalizeQuat(out)
}

/**
 * `AnimUtil.h:60-78` — idem à quatre. C'est ce qui permet le mélange
 * directionnel à 4 poses (aim offsets) en une seule opération.
 */
export function safeLinearCombine4(
  a: Quaternion,
  b: Quaternion,
  c: Quaternion,
  d: Quaternion,
  alphas: readonly [number, number, number, number],
  out: Quaternion,
): Quaternion {
  const sb = dotQuat(a, b) < 0 ? -1 : 1
  const sc = dotQuat(a, c) < 0 ? -1 : 1
  const sd = dotQuat(a, d) < 0 ? -1 : 1
  out.set(
    alphas[0] * a.x + alphas[1] * sb * b.x + alphas[2] * sc * c.x + alphas[3] * sd * d.x,
    alphas[0] * a.y + alphas[1] * sb * b.y + alphas[2] * sc * c.y + alphas[3] * sd * d.y,
    alphas[0] * a.z + alphas[1] * sb * b.z + alphas[2] * sc * c.z + alphas[3] * sd * d.z,
    alphas[0] * a.w + alphas[1] * sb * b.w + alphas[2] * sc * c.w + alphas[3] * sd * d.w,
  )
  return normalizeQuat(out)
}

/**
 * `AnimUtil.cpp:55-76` (blendAdd, partie rotation) — mélange ADDITIF : `delta`
 * n'est pas une pose mais un écart, ramené à la polarité de l'identité
 * (signe de w), dosé par un lerp vers l'identité, puis composé à droite.
 */
export function blendAddQuat(a: Quaternion, delta: Quaternion, alpha: number, out: Quaternion): Quaternion {
  const s = delta.w < 0 ? -1 : 1
  // lerp(IDENTITY, delta, alpha) — un lerp, pas un slerp (fidèle à l'original).
  qTmpA.set(s * delta.x * alpha, s * delta.y * alpha, s * delta.z * alpha, 1 + (s * delta.w - 1) * alpha)
  out.copy(a).multiply(qTmpA)
  return normalizeQuat(out)
}

/**
 * `AnimUtil.cpp:78-93` — moyenne de quaternions avec correction de signe par
 * rapport au premier. Utilisée par computeCenterRotation (contraintes).
 */
export function averageQuats(quats: readonly Quaternion[], out: Quaternion): Quaternion {
  if (quats.length === 0) return out.set(0, 0, 0, 1)
  const first = quats[0]
  out.copy(first)
  for (let i = 1; i < quats.length; i++) {
    const q = quats[i]
    const s = dotQuat(first, q) < 0 ? -1 : 1
    out.set(out.x + s * q.x, out.y + s * q.y, out.z + s * q.z, out.w + s * q.w)
  }
  return normalizeQuat(out)
}

// ── 2. Tête de lecture ──────────────────────────────────────────────────────

/**
 * `AnimUtil.cpp:95-139` — avance la tête de lecture d'un clip (en IMAGES à
 * 30 i/s, la convention des graphes Overte) et ÉMET des déclencheurs :
 * `<id>OnLoop` quand le clip boucle, `<id>OnDone` quand il s'achève sans
 * boucler. Les noms sont ceux que le graphe extrait (`transitions.json`)
 * attend — ne pas les « franciser ».
 * Trois particularités d'origine, conservées : un clip d'une seule image
 * n'émet rien ; en boucle, il y a UNE image entre la fin et le début
 * (framesTillEnd += 1) ; au plus 3 déclencheurs par appel (un dt énorme ne
 * mitraille pas le graphe).
 */
export function accumulateTime(
  startFrame: number,
  endFrame: number,
  timeScale: number,
  currentFrame: number,
  dt: number,
  loopFlag: boolean,
  id: string,
  triggersOut: string[],
): number {
  const EPS = 0.0001
  let frame = currentFrame
  const clampedStartFrame = Math.min(startFrame, endFrame)
  if (Math.abs(clampedStartFrame - endFrame) <= 1) {
    frame = endFrame
  } else if (timeScale > EPS && dt > EPS) {
    const FRAMES_PER_SECOND = 30
    let framesRemaining = dt * timeScale * FRAMES_PER_SECOND
    let triggerCount = 0
    const MAX_TRIGGER_COUNT = 3
    while (framesRemaining > EPS && triggerCount < MAX_TRIGGER_COUNT) {
      let framesTillEnd = endFrame - frame
      if (loopFlag) framesTillEnd += 1
      if (framesRemaining >= framesTillEnd) {
        if (loopFlag) {
          triggersOut.push(`${id}OnLoop`)
          framesRemaining -= framesTillEnd
          frame = clampedStartFrame
        } else {
          triggersOut.push(`${id}OnDone`)
          frame = endFrame
          framesRemaining = 0
        }
        triggerCount++
      } else {
        frame += framesRemaining
        framesRemaining = 0
      }
    }
  }
  return frame
}

// ── 3. Lissage ──────────────────────────────────────────────────────────────

/** Pose minimale des lisseurs : position + rotation (l'échelle d'un os VRM normalisé ne varie pas). */
export interface SpringPose {
  trans: Vector3
  rot: Quaternion
}

/**
 * `AnimUtil.h:91-138` — ressort amorti critique approché, avec TROIS échelles
 * de temps séparées : on peut lisser fort en vertical (absorber un sol
 * irrégulier) et faiblement en horizontal (ne pas retarder le déplacement).
 * Commentaire d'origine : « The timescale is roughly how much time it will
 * take the spring will reach halfway toward it's target. »
 * `teleport` réinitialise sans transition — indispensable au changement de
 * scène ou de modèle.
 */
export class CriticallyDampedSpringPoseHelper {
  private prevTrans = new Vector3()
  private prevRot = new Quaternion()
  private prevValid = false
  horizontalTimescale = 0.15
  verticalTimescale = 0.15
  rotationTimescale = 0.15

  /** Écrit la pose lissée DANS `pose` (et la mémorise comme état du ressort). */
  update(pose: SpringPose, dt: number): void {
    if (!this.prevValid) {
      this.prevTrans.copy(pose.trans)
      this.prevRot.copy(pose.rot)
      this.prevValid = true
    }
    const aH = Math.min(dt / this.horizontalTimescale, 1)
    const aV = Math.min(dt / this.verticalTimescale, 1)
    const aR = Math.min(dt / this.rotationTimescale, 1)
    const p = this.prevTrans
    // lerp horizontal partout, puis la composante Y écrasée avec son propre α —
    // exactement l'ordre de l'original.
    const y = pose.trans.y
    pose.trans.set(p.x + (pose.trans.x - p.x) * aH, p.y + (pose.trans.y - p.y) * aH, p.z + (pose.trans.z - p.z) * aH)
    pose.trans.y = p.y + (y - p.y) * aV
    safeLerpQuat(this.prevRot, pose.rot, aR, pose.rot)
    this.prevTrans.copy(pose.trans)
    this.prevRot.copy(pose.rot)
  }

  teleport(pose: SpringPose): void {
    this.prevValid = true
    this.prevTrans.copy(pose.trans)
    this.prevRot.copy(pose.rot)
  }
}

/**
 * `AnimUtil.h:140-175` — mémorise un instantané puis fond la cible vers lui en
 * `duration` secondes, avec un ease-in exponentiel. Overte s'en sert pour
 * lisser le bassin quand une cible change de nature (HIPS_BLEND_DURATION 0,5 s).
 */
export class SnapshotBlendPoseHelper {
  private snapTrans = new Vector3()
  private snapRot = new Quaternion()
  private duration = 1
  private timer = 0

  setBlendDuration(duration: number): void {
    this.duration = duration
  }

  setSnapshot(pose: SpringPose): void {
    this.snapTrans.copy(pose.trans)
    this.snapRot.copy(pose.rot)
    this.timer = this.duration
  }

  /** Écrit la pose mélangée DANS `target`. */
  update(target: SpringPose, dt: number): void {
    this.timer -= dt
    if (this.timer <= 0 || this.duration <= 0) return
    let alpha = (this.duration - this.timer) / this.duration
    alpha = 1 - Math.pow(2, -10 * alpha) // ease in expo
    // `newPose.blend(snapshot, alpha)` de l'original : alpha est le poids de la
    // CIBLE (convention AnimPose::blend, vérifiée sur AnimTwoBoneIK:197 où
    // alpha = 1 rend l'IK pure). La pose part donc de l'instantané (alpha = 0 au
    // déclenchement) et rejoint la cible à l'échéance.
    const t = target.trans
    const s = this.snapTrans
    t.set(s.x + (t.x - s.x) * alpha, s.y + (t.y - s.y) * alpha, s.z + (t.z - s.z) * alpha)
    safeLerpQuat(this.snapRot, target.rot, alpha, target.rot)
  }
}

// ── 4. Easing — `AnimUtil.h:182-208` / `AnimUtil.cpp:264-344` ───────────────

/** Les 22 noms EXACTS attendus par le chargeur de graphe (`AnimNodeLoader.cpp:120+`). */
export type EasingType =
  | 'linear'
  | 'easeInSine'
  | 'easeOutSine'
  | 'easeInOutSine'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeInQuart'
  | 'easeOutQuart'
  | 'easeInOutQuart'
  | 'easeInQuint'
  | 'easeOutQuint'
  | 'easeInOutQuint'
  | 'easeInExpo'
  | 'easeOutExpo'
  | 'easeInOutExpo'
  | 'easeInCirc'
  | 'easeOutCirc'
  | 'easeInOutCirc'

/** Formules recopiées de `easingFunc` — y compris la quartique « out » d'origine. */
export function easingFunc(alpha: number, type: EasingType): number {
  switch (type) {
    case 'linear':
      return alpha
    case 'easeInSine':
      return Math.sin((alpha - 1) * (Math.PI / 2)) + 1
    case 'easeOutSine':
      return Math.sin(alpha * (Math.PI / 2))
    case 'easeInOutSine':
      return 0.5 * (1 - Math.cos(alpha * Math.PI))
    case 'easeInQuad':
      return alpha * alpha
    case 'easeOutQuad':
      return -(alpha * (alpha - 2))
    case 'easeInOutQuad':
      return alpha < 0.5 ? 2 * alpha * alpha : -2 * alpha * alpha + 4 * alpha - 1
    case 'easeInCubic':
      return alpha * alpha * alpha
    case 'easeOutCubic': {
      const t = alpha - 1
      return t * t * t + 1
    }
    case 'easeInOutCubic':
      if (alpha < 0.5) return 4 * alpha * alpha * alpha
      else {
        const t = 2 * alpha - 2
        return 0.5 * t * t * t + 1
      }
    case 'easeInQuart':
      return alpha * alpha * alpha * alpha
    case 'easeOutQuart': {
      // Fidèle à l'original, qui n'est PAS la quartique de Penner : ils écrivent
      // t³·(1−α)+1, soit −t⁴+1 avec t = α−1… c'est bien la même chose. Recopié.
      const t = alpha - 1
      return t * t * t * (1 - alpha) + 1
    }
    case 'easeInOutQuart':
      if (alpha < 0.5) return 8 * alpha * alpha * alpha * alpha
      else {
        const t = alpha - 1
        return -8 * t * t * t * t + 1
      }
    case 'easeInQuint':
      return alpha * alpha * alpha * alpha * alpha
    case 'easeOutQuint': {
      const t = alpha - 1
      return t * t * t * t * t + 1
    }
    case 'easeInOutQuint':
      if (alpha < 0.5) return 16 * alpha * alpha * alpha * alpha * alpha
      else {
        const t = 2 * alpha - 2
        return 0.5 * t * t * t * t * t + 1
      }
    case 'easeInExpo':
      return alpha === 0 ? alpha : Math.pow(2, 10 * (alpha - 1))
    case 'easeOutExpo':
      return alpha === 1 ? alpha : 1 - Math.pow(2, -10 * alpha)
    case 'easeInOutExpo':
      if (alpha === 0 || alpha === 1) return alpha
      else if (alpha < 0.5) return 0.5 * Math.pow(2, 20 * alpha - 10)
      else return -0.5 * Math.pow(2, -20 * alpha + 10) + 1
    case 'easeInCirc':
      return 1 - Math.sqrt(1 - alpha * alpha)
    case 'easeOutCirc':
      return Math.sqrt((2 - alpha) * alpha)
    case 'easeInOutCirc':
      if (alpha < 0.5) return 0.5 * (1 - Math.sqrt(1 - 4 * (alpha * alpha)))
      else return 0.5 * (Math.sqrt(-(2 * alpha - 3) * (2 * alpha - 1)) + 1)
  }
}

/**
 * Les deux easing « maison » utilisés en dur dans le C++ (hors table) :
 * l'ease-in expo des interpolations d'IK (`AnimTwoBoneIK.cpp:207`) et la
 * cubique en deux temps de la transition parole (`Rig.cpp`).
 */
export function easeInExpo(t: number): number {
  return 1 - Math.pow(2, -10 * t)
}
export function easeOutIn(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 4 * (t - 1) * (t - 1) * (t - 1) + 1
}

// ── 5. Géométrie ────────────────────────────────────────────────────────────

/**
 * `GeometryUtil.cpp:1472-1488` — décompose `q` en swing × twist autour de
 * `direction` (qui DOIT être normalisée, ils l'assertent). On a bien
 * q = swing * twist ; le twist est la rotation autour de `direction`, le swing
 * ce qui reste (axe perpendiculaire).
 */
export function swingTwistDecomposition(
  q: Quaternion,
  direction: Vector3,
  swingOut: Quaternion,
  twistOut: Quaternion,
): void {
  const d = direction.x * q.x + direction.y * q.y + direction.z * q.z
  twistOut.set(direction.x * d, direction.y * d, direction.z * d, q.w)
  normalizeQuat(twistOut)
  // swing = q * inverse(twist) — twist est unitaire, son inverse est son conjugué.
  qTmpA.set(-twistOut.x, -twistOut.y, -twistOut.z, twistOut.w)
  swingOut.copy(q).multiply(qTmpA)
}

/**
 * `GLMHelpers.cpp:564-588` — base orthonormée (u, v, w) à partir d'un axe
 * primaire et d'un secondaire. LE point à ne pas perdre : le double repli — si
 * le secondaire est parallèle au primaire on prend X, et si X l'est aussi on
 * prend Y. Sans ça, `cross` rend zéro et tout devient NaN.
 */
export function generateBasisVectors(
  primary: Vector3,
  secondary: Vector3,
  uOut: Vector3,
  vOut: Vector3,
  wOut: Vector3,
): void {
  const EPS = 1e-4
  uOut.copy(primary).normalize()
  vTmpA.copy(secondary).normalize()
  if (Math.abs(Math.abs(uOut.dot(vTmpA)) - 1) < EPS) {
    vTmpA.set(1, 0, 0)
    if (Math.abs(Math.abs(uOut.dot(vTmpA)) - 1) < EPS) vTmpA.set(0, 1, 0)
  }
  wOut.crossVectors(uOut, vTmpA).normalize()
  vOut.crossVectors(wOut, uOut)
}

/**
 * `GLMHelpers.cpp:302-316` — angle entre deux vecteurs. Le clamp est là parce
 * que « floating point rounding errors might cause cosAngle to be slightly
 * higher than 1 […] which results in a NaN ».
 */
export function angleBetween(v1: Vector3, v2: Vector3): number {
  const lengthFactor = v1.length() * v2.length()
  if (lengthFactor < EPSILON) return 0 // adaptation : l'original loggue et laisse diviser
  return Math.acos(clamp(v1.dot(v2) / lengthFactor, -1, 1))
}

/**
 * `GLMHelpers.cpp:319-321` — rotation qui amène v1 sur v2 (normalisés).
 * Équivalent de glm::rotation ; three fournit setFromUnitVectors, employé ici
 * sur des copies normalisées dans les brouillons de module.
 */
export function rotationBetween(v1: Vector3, v2: Vector3, out: Quaternion): Quaternion {
  vTmpA.copy(v1).normalize()
  vTmpB.copy(v2).normalize()
  return out.setFromUnitVectors(vTmpA, vTmpB)
}

/**
 * `GLMHelpers.cpp:53-79` — slerp avec correction de signe. C'est le lissage du
 * pole vector du genou (Rig::updateFeet). Repli en lerp quand l'angle est
 * quasi nul, exactement comme l'original.
 */
export function safeMixQuat(q1: Quaternion, q2: Quaternion, proportion: number, out: Quaternion): Quaternion {
  let cosa = q1.x * q2.x + q1.y * q2.y + q1.z * q2.z + q1.w * q2.w
  let ox = q2.x
  let oy = q2.y
  let oz = q2.z
  let ow = q2.w
  if (cosa < 0) {
    cosa = -cosa
    ox = -ox
    oy = -oy
    oz = -oz
    ow = -ow
  }
  let s0: number
  let s1: number
  if (1 - cosa > EPSILON) {
    const angle = Math.acos(cosa)
    const sina = Math.sin(angle)
    s0 = Math.sin((1 - proportion) * angle) / sina
    s1 = Math.sin(proportion * angle) / sina
  } else {
    s0 = 1 - proportion
    s1 = proportion
  }
  out.set(s0 * q1.x + s1 * ox, s0 * q1.y + s1 * oy, s0 * q1.z + s1 * oz, s0 * q1.w + s1 * ow)
  return normalizeQuat(out)
}
