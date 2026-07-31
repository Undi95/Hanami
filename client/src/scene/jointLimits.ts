/*
 * Porté en TypeScript depuis Overte (https://github.com/overte-org/overte),
 * fichiers libraries/animation/src/SwingTwistConstraint.cpp / .h,
 * libraries/animation/src/ElbowConstraint.cpp / .h et
 * libraries/animation/src/AnimInverseKinematics.cpp (initConstraints,
 * setEllipticalSwingLimits, ANGLE_DISTRIBUTION_FACTOR).
 *
 * Copyright 2015 High Fidelity, Inc.
 * Distributed under the Apache License, Version 2.0.
 * See http://www.apache.org/licenses/LICENSE-2.0.html
 *
 * MODIFIÉ : transcrit du C++ vers TypeScript, adapté à three.js et au rig
 * humanoïde normalisé de @pixiv/three-vrm par le projet Hanami, 2026.
 * L'ensemble est redistribué sous AGPL-3.0.
 *
 * LA TABLE DES LIMITES ARTICULAIRES HUMAINES d'Overte, os par os, appliquée en
 * BOUT DE CHAÎNE : après le mixer, l'IK et tout layering, juste avant
 * vrm.update(). Aucune pose affichée ne peut violer l'enveloppe humaine, quel
 * que soit le modèle et quelle que soit la source (clip, IK, mélange) — les
 * limites sont des ANGLES, indépendants des proportions.
 *
 * Adaptations au rig VRM normalisé, toutes délibérées :
 *  - dans le rig normalisé de three-vrm, la pose de repos de chaque os est
 *    l'IDENTITÉ et tous les repères locaux coïncident avec le repère de
 *    l'avatar (+Z devant, +Y haut, +X à sa gauche). La « referenceRotation »
 *    d'Overte vaut donc l'identité, et leurs enveloppes — exprimées dans les
 *    repères d'os du rig HiFi, orientés os par os — sont RECONSTRUITES dans le
 *    repère avatar à partir de leur contenu anatomique (mêmes valeurs de débat-
 *    tement, axes replacés : flexion du genou = +X ici, leur −X là-bas, etc.) ;
 *  - la charnière (ElbowConstraint) ne JETTE plus le swing hors-axe en entier :
 *    l'original tournait dans un solveur IK, où reconstruire coude et genou
 *    purs était voulu ; ici la contrainte s'applique aussi aux poses des clips,
 *    et la pronation de l'avant-bras (twist autour de l'os) y est de
 *    l'animation légitime — mesurée jusqu'à 90,4° sur les 111 clips livrés.
 *    Le swing est donc décomposé une seconde fois : la composante autour de
 *    l'OS est conservée (bornée), seul le résidu hors-anatomie est jeté ;
 *  - l'enveloppe de la cheville n'est pas transplantée telle quelle : ses
 *    quatre directions sont exprimées dans le repère du tibia HiFi, que les
 *    sources téléchargées ne permettent pas de reconstruire. On garde le twist
 *    ±45° (la protection que la fiche vise) et un cône elliptique bâti avec
 *    LEUR outil setEllipticalSwingLimits, dimensionné sur les clips livrés.
 */
import { Quaternion, Vector3 } from 'three'
import type { Object3D } from 'three'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import { swingTwistDecomposition } from './overteMath'

const PI = Math.PI
const TWO_PI = 2 * PI
const EPSILON = 1e-6

const MIN_MINDOT = -0.999
const MAX_MINDOT = 1.0

const LAST_CLAMP_LOW_BOUNDARY = -1
const LAST_CLAMP_NO_BOUNDARY = 0
const LAST_CLAMP_HIGH_BOUNDARY = 1

/**
 * `AnimInverseKinematics.cpp:544` — la fraction d'un delta de rotation qu'un
 * étage de la chaîne (colonne → cou → tête) prend à son compte quand on
 * répartit une orientation de bout de chaîne. Consommée par le regard (fiche
 * 02) pour tourner la tête : chaque os prend 45 % du delta restant, et les
 * limites ci-dessous bornent le tout.
 */
export const ANGLE_DISTRIBUTION_FACTOR = 0.45

// Brouillons de module — l'application tourne à chaque image, elle n'alloue rien.
const qSwing = new Quaternion()
const qTwist = new Quaternion()
const qPost = new Quaternion()
const qPron = new Quaternion()
const qTmp = new Quaternion()
const vSwungY = new Vector3()
const vAxis = new Vector3()
const vTmp = new Vector3()
const UNIT_Y = new Vector3(0, 1, 0)

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/** Contrat commun des deux contraintes. `apply` borne `q` SUR PLACE. */
export interface RotationConstraint {
  /** Rend true si la rotation a été modifiée. */
  apply(q: Quaternion): boolean
  clearHistory(): void
}

// ── SwingLimitFunction — `SwingTwistConstraint.cpp:28-190` ──────────────────

/**
 * L'enveloppe de swing : une fonction theta → minDot échantillonnée sur le
 * tour, interpolée linéairement, cyclique. Un cône simple est un échantillon
 * unique ; une hanche est huit échantillons asymétriques.
 */
export class SwingLimitFunction {
  private minDots: number[] = [-1, -1]

  /**
   * `setMinDots` — moins de 8 échantillons sont répliqués et interpolés
   * jusqu'à dépasser 8 (MIN_NUM_DOTS), puis le premier est recopié en queue
   * pour la cyclicité. Fidèle, y compris le remplissage intercalé.
   */
  setMinDots(minDots: readonly number[]): void {
    const MIN_NUM_DOTS = 8
    const numDots = minDots.length
    this.minDots = []
    if (numDots === 0) {
      for (let i = 0; i < MIN_NUM_DOTS; i++) this.minDots.push(MIN_MINDOT)
      this.minDots.push(MIN_MINDOT)
      return
    }
    let trueNumDots = numDots
    let numFiller = 0
    while (trueNumDots < MIN_NUM_DOTS) {
      numFiller++
      trueNumDots += numDots
    }
    for (let i = 0; i < numDots; i++) {
      this.minDots.push(clamp(minDots[i], MIN_MINDOT, MAX_MINDOT))
      if (numFiller > 0) {
        const nearDot = clamp(minDots[i], MIN_MINDOT, MAX_MINDOT)
        const farDot = clamp(minDots[(i + 1) % numDots], MIN_MINDOT, MAX_MINDOT)
        for (let j = 0; j < numFiller; j++) {
          const delta = (j + 1) / (numFiller + 1)
          this.minDots.push((1 - delta) * nearDot + delta * farDot)
        }
      }
    }
    this.minDots.push(this.minDots[0])
  }

  /** Partie fractionnaire positive de theta/2π, puis interpolation linéaire. */
  getMinDot(theta: number): number {
    let normalized = (theta / TWO_PI) % 1
    if (normalized < 0) normalized += 1
    const scaled = normalized * (this.minDots.length - 1)
    const i = Math.floor(scaled)
    const fraction = scaled - i
    const j = (i + 1) % this.minDots.length
    return this.minDots[i] * (1 - fraction) + this.minDots[j] * fraction
  }
}

// ── SwingTwistConstraint — `SwingTwistConstraint.cpp:192-433` ───────────────

export class SwingTwistConstraint implements RotationConstraint {
  private swingLimitFunction = new SwingLimitFunction()
  private referenceRotation = new Quaternion()
  private minTwist = -PI
  private maxTwist = PI
  private lastTwistBoundary = LAST_CLAMP_NO_BOUNDARY
  /** Conjugaison repère local ↔ repère de contrainte (cf. setFrameRotation). */
  private frameRot: Quaternion | null = null
  private frameRotInv: Quaternion | null = null

  setReferenceRotation(q: Quaternion): void {
    this.referenceRotation.copy(q)
  }

  /**
   * ADAPTATION au rig normalisé : chez Overte, l'axe de twist est TOUJOURS le
   * Y du repère de l'articulation, parce que leur rig oriente chaque repère
   * d'os avec Y le long de l'os. Le rig VRM normalisé aligne au contraire tous
   * les repères sur l'avatar — l'avant-bras pointe vers ±X, le tibia vers −Y.
   * `frameRotation` est la rotation C qui amène le repère de contrainte
   * (Y = axe de l'os) sur le repère local : apply() conjugue q par C, borne
   * dans le repère de contrainte, et revient. C tient le rôle exact que
   * l'orientation des repères d'os tenait dans le rig HiFi.
   */
  setFrameRotation(c: Quaternion): void {
    this.frameRot = c.clone()
    this.frameRotInv = c.clone().invert()
  }

  /** NOTE d'origine : min/maxTwist dans [−π, π]. */
  setTwistLimits(minTwist: number, maxTwist: number): void {
    this.minTwist = Math.min(minTwist, maxTwist)
    this.maxTwist = Math.max(minTwist, maxTwist)
    this.lastTwistBoundary = LAST_CLAMP_NO_BOUNDARY
  }

  setSwingLimits(minDots: readonly number[]): void {
    this.swingLimitFunction.setMinDots(minDots)
  }

  /**
   * `setSwingLimits(swungDirections)` — construit l'enveloppe à partir de
   * directions « où l'axe Y balancé a le droit d'aller ». Les paires
   * (theta, minDot) sont calculées, triées, puis rééchantillonnées
   * uniformément — fidèle, chevauchement de frontière compris.
   */
  setSwingLimitsFromDirections(swungDirections: readonly Vector3[]): void {
    interface Lim {
      theta: number
      minDot: number
    }
    const limits: Lim[] = []
    for (const dir of swungDirections) {
      const len = dir.length()
      if (len > EPSILON) {
        vAxis.crossVectors(UNIT_Y, dir)
        let theta = Math.atan2(-vAxis.z, vAxis.x)
        if (theta < 0) theta += TWO_PI
        limits.push({ theta, minDot: dir.y / len })
      }
    }
    const minDots: number[] = []
    if (limits.length === 0) {
      // contrainte quasi libre
    } else if (limits.length === 1) {
      minDots.push(limits[0].minDot)
    } else {
      limits.sort((a, b) => a.theta - b.theta)
      const numLimits = limits.length
      const deltaTheta = TWO_PI / numLimits
      let rightIndex = 0
      for (let i = 0; i < numLimits; i++) {
        const theta = i * deltaTheta
        let leftIndex = (rightIndex - 1 + numLimits) % numLimits
        while (rightIndex < numLimits && theta > limits[rightIndex].theta) {
          leftIndex = rightIndex++
        }
        if (leftIndex === numLimits - 1) rightIndex = 0
        let rightTheta = limits[rightIndex].theta
        let leftTheta = limits[leftIndex].theta
        if (leftTheta > rightTheta) {
          if (leftTheta > theta) leftTheta -= TWO_PI
          else rightTheta += TWO_PI
        }
        const rightWeight = (theta - leftTheta) / (rightTheta - leftTheta)
        minDots.push((1 - rightWeight) * limits[leftIndex].minDot + rightWeight * limits[rightIndex].minDot)
      }
    }
    this.swingLimitFunction.setMinDots(minDots)
  }

  /**
   * §2.1 de la fiche — le piège du repliement : `acos` rend [0, π], donc un
   * twist de 200° est lu −160°. On mémorise de quel côté on a clampé à l'image
   * précédente et on ramène l'angle du bon côté. `clearHistory` réinitialise
   * (téléportation, changement de modèle) sinon l'ancien état contamine la
   * nouvelle pose.
   */
  private handleTwistBoundaryConditions(twistAngle: number): number {
    switch (this.lastTwistBoundary) {
      case LAST_CLAMP_LOW_BOUNDARY:
        if (twistAngle > this.maxTwist) twistAngle -= TWO_PI
        break
      case LAST_CLAMP_HIGH_BOUNDARY:
        if (twistAngle < this.minTwist) twistAngle += TWO_PI
        break
      default: {
        const midBoundary = 0.5 * (this.maxTwist + this.minTwist + TWO_PI)
        if (twistAngle > midBoundary) twistAngle -= TWO_PI
        else if (twistAngle < midBoundary - TWO_PI) twistAngle += TWO_PI
        break
      }
    }
    return twistAngle
  }

  /** `apply` — `SwingTwistConstraint.cpp:323-380`, transcription directe. */
  apply(rotation: Quaternion): boolean {
    // repère de contrainte s'il y en a un : q ← C⁻¹ · q · C
    if (this.frameRot && this.frameRotInv) {
      rotation.premultiply(this.frameRotInv).multiply(this.frameRot)
    }
    // postRotation = rotation * inverse(referenceRotation)
    qTmp.copy(this.referenceRotation).invert()
    qPost.copy(rotation).multiply(qTmp)
    swingTwistDecomposition(qPost, UNIT_Y, qSwing, qTwist)
    // twist brut, signe récupéré par le produit mixte
    let twistAngle = 2 * Math.acos(Math.min(1, Math.abs(qTwist.w)))
    vTmp.set(1, 0, 0).applyQuaternion(qTwist) // twistedX
    // sign( dot( cross(UNIT_X, twistedX), UNIT_Y ) ) : cross((1,0,0), v) vaut
    // (0, −v.z, v.y), son produit scalaire avec UNIT_Y vaut −v.z.
    twistAngle *= Math.sign(-vTmp.z) || 1

    let somethingClamped = false
    if (this.minTwist !== this.maxTwist) {
      twistAngle = this.handleTwistBoundaryConditions(twistAngle)
      const clamped = clamp(twistAngle, this.minTwist, this.maxTwist)
      if (clamped !== twistAngle) {
        this.lastTwistBoundary = twistAngle > clamped ? LAST_CLAMP_HIGH_BOUNDARY : LAST_CLAMP_LOW_BOUNDARY
        twistAngle = clamped
        somethingClamped = true
      } else {
        this.lastTwistBoundary = LAST_CLAMP_NO_BOUNDARY
      }
    }

    // le swing : l'axe est toujours ⊥ Y ; l'enveloppe se lit à sa position θ
    vSwungY.set(0, 1, 0).applyQuaternion(qSwing)
    vAxis.crossVectors(UNIT_Y, vSwungY)
    const axisLength = vAxis.length()
    if (axisLength > EPSILON) {
      const theta = Math.atan2(-vAxis.z, vAxis.x)
      const minDot = this.swingLimitFunction.getMinDot(theta)
      if (vSwungY.dot(UNIT_Y) < minDot) {
        vAxis.multiplyScalar(1 / axisLength)
        qSwing.setFromAxisAngle(vAxis, Math.acos(minDot))
        somethingClamped = true
      }
    }

    if (somethingClamped) {
      qTwist.setFromAxisAngle(UNIT_Y, twistAngle)
      rotation.copy(qSwing).multiply(qTwist).multiply(this.referenceRotation)
    }
    // retour dans le repère local : q ← C · q · C⁻¹
    if (this.frameRot && this.frameRotInv) {
      rotation.premultiply(this.frameRot).multiply(this.frameRotInv)
    }
    return somethingClamped
  }

  clearHistory(): void {
    this.lastTwistBoundary = LAST_CLAMP_NO_BOUNDARY
  }
}

// ── Charnière — `ElbowConstraint.cpp` ───────────────────────────────────────

export class HingeConstraint implements RotationConstraint {
  private axis = new Vector3(1, 0, 0)
  private perpAxis = new Vector3(0, 1, 0)
  private referenceRotation = new Quaternion()
  private minAngle = -PI
  private maxAngle = PI
  /**
   * Amplitude PERMISE au twist résiduel autour de l'OS lui-même (pronation de
   * l'avant-bras, rotation tibiale) — l'ADAPTATION au contexte « bout de
   * chaîne » : l'original jette tout le swing, ce qui effacerait la pronation
   * que les clips animent (mesurée jusqu'à 90,4° sur la bibliothèque livrée).
   * 0 = comportement d'origine (tout le hors-axe est jeté).
   */
  private boneTwistLimit = 0
  private boneAxis = new Vector3(0, 1, 0)
  /** Référence de signe du twist d'os : un vecteur ⊥ à `boneAxis` (cf. allowBoneTwist). */
  private bonePerp = new Vector3(1, 0, 0)

  setReferenceRotation(q: Quaternion): void {
    this.referenceRotation.copy(q)
  }

  /** `setHingeAxis` — l'axe perpendiculaire est choisi comme dans l'original. */
  setHingeAxis(axis: Vector3): void {
    const len = axis.length()
    if (len < EPSILON) return
    this.axis.copy(axis).multiplyScalar(1 / len)
    // le vecteur de base le moins colinéaire, rendu ⊥ puis normalisé —
    // transcription du choix par composante dominante de l'original
    const a = [this.axis.x, this.axis.y, this.axis.z]
    const MIN_LARGEST = 0.57735 // juste sous 1/√3
    const p = [0, 0, 0]
    for (let i = 0; i < 3; i++) {
      if (Math.abs(a[i]) > MIN_LARGEST) {
        const j = (i + 1) % 3
        p[i] = -a[j]
        p[j] = a[i]
        p[(j + 1) % 3] = 0
        break
      }
    }
    this.perpAxis.set(p[0], p[1], p[2]).normalize()
  }

  setAngleLimits(minAngle: number, maxAngle: number): void {
    this.minAngle = Math.min(minAngle, maxAngle)
    this.maxAngle = Math.max(minAngle, maxAngle)
  }

  /** Voir `boneTwistLimit` — l'axe de l'os et son débattement autorisé. */
  allowBoneTwist(boneAxis: Vector3, limit: number): void {
    this.boneAxis.copy(boneAxis).normalize()
    this.boneTwistLimit = limit
    // même choix d'axe perpendiculaire que setHingeAxis, mais pour l'OS : la
    // référence de signe doit être ⊥ à l'axe qu'elle mesure (au genou, la
    // perpendiculaire de la charnière est PARALLÈLE à l'os — signe perdu).
    const a = [this.boneAxis.x, this.boneAxis.y, this.boneAxis.z]
    const MIN_LARGEST = 0.57735
    const p = [0, 0, 0]
    for (let i = 0; i < 3; i++) {
      if (Math.abs(a[i]) > MIN_LARGEST) {
        const j = (i + 1) % 3
        p[i] = -a[j]
        p[j] = a[i]
        p[(j + 1) % 3] = 0
        break
      }
    }
    this.bonePerp.set(p[0], p[1], p[2]).normalize()
  }

  /** Angle signé d'un twist unitaire autour de `axis`, signe mesuré sur `perp` (⊥ axis). */
  private signedTwistAngle(twist: Quaternion, axis: Vector3, perp: Vector3): number {
    let angle = 2 * Math.acos(Math.min(1, Math.abs(twist.w)))
    vTmp.copy(perp).applyQuaternion(twist)
    vAxis.crossVectors(perp, vTmp)
    angle *= Math.sign(vAxis.dot(axis)) || 1
    return angle
  }

  /**
   * `apply` — `ElbowConstraint.cpp:51-75`. Écarts assumés à l'original, tous
   * dictés par le contexte « bout de chaîne » (l'original tournait dans un
   * solveur IK où reconstruire une charnière pure était le but) :
   *  1. la pronation n'est pas jetée : anatomiquement, elle s'applique la
   *     PREMIÈRE dans le repère local (v = Flexion · Pronation · v_local),
   *     donc elle est le facteur twist DROIT autour de l'axe de repos de l'os
   *     — extraite là, conservée, bornée par `boneTwistLimit` ;
   *  2. la flexion est ensuite le facteur twist droit du reste autour de la
   *     charnière, bornée [min, max] comme chez eux ;
   *  3. le résidu (varus/valgus, hyperlaxité) est jeté — c'est la part de
   *     l'original qui reste entière ;
   *  4. le retour est `true` seulement si la rotation a réellement changé
   *     (l'original rendait toujours true parce que son CCD en avait besoin ;
   *     ici la valeur sert au diagnostic).
   */
  apply(rotation: Quaternion): boolean {
    qTmp.copy(this.referenceRotation).invert()
    qPost.copy(rotation).multiply(qTmp)
    if (this.boneTwistLimit > 0) {
      // qPost = qSwing · qPron (pronation = facteur droit autour de l'os)
      swingTwistDecomposition(qPost, this.boneAxis, qSwing, qPron)
      const pron = this.signedTwistAngle(qPron, this.boneAxis, this.bonePerp)
      const clampedPron = clamp(pron, -this.boneTwistLimit, this.boneTwistLimit)
      if (clampedPron !== pron) qPron.setFromAxisAngle(this.boneAxis, clampedPron)
      // qSwing = résidu · qTwist (flexion = facteur droit autour de la charnière)
      swingTwistDecomposition(qSwing, this.axis, qSwing, qTwist)
      const hinge = this.signedTwistAngle(qTwist, this.axis, this.perpAxis)
      const clampedHinge = clamp(hinge, this.minAngle, this.maxAngle)
      if (clampedHinge !== hinge) qTwist.setFromAxisAngle(this.axis, clampedHinge)
      // flexion · pronation · référence — le résidu est jeté
      qTmp.copy(qTwist).multiply(qPron).multiply(this.referenceRotation)
    } else {
      // comportement d'origine : le swing est PUREMENT JETÉ
      swingTwistDecomposition(qPost, this.axis, qSwing, qTwist)
      const hinge = this.signedTwistAngle(qTwist, this.axis, this.perpAxis)
      const clampedHinge = clamp(hinge, this.minAngle, this.maxAngle)
      if (clampedHinge !== hinge) qTwist.setFromAxisAngle(this.axis, clampedHinge)
      qTmp.copy(qTwist).multiply(this.referenceRotation)
    }
    const changed =
      Math.abs(qTmp.x * rotation.x + qTmp.y * rotation.y + qTmp.z * rotation.z + qTmp.w * rotation.w) <
      1 - 1e-9
    rotation.copy(qTmp)
    return changed
  }

  clearHistory(): void {
    // une charnière n'a pas d'historique de frontière (son domaine tient dans un tour)
  }
}

// ── Outils de la table — `AnimInverseKinematics.cpp` ────────────────────────

/**
 * `setEllipticalSwingLimits` (ligne 1130) — cône elliptique d'axes
 * `lateralPhi` (débattement latéral) et `anteriorPhi` (avant/arrière),
 * échantillonné en 16 points. La formule est symétrique avant/arrière
 * (cos 2θ') : seule l'assignation des AXES compte, et dans le repère avatar
 * l'axe de swing ±X incline vers ±Z (avant/arrière), l'axe ±Z incline
 * latéralement — même assignation que chez eux.
 */
export function setEllipticalSwingLimits(
  constraint: SwingTwistConstraint,
  lateralPhi: number,
  anteriorPhi: number,
): void {
  const NUM_SUBDIVISIONS = 16
  const minDots: number[] = []
  const dTheta = TWO_PI / NUM_SUBDIVISIONS
  let theta = 0
  for (let i = 0; i < NUM_SUBDIVISIONS; i++) {
    const thetaPrime = Math.atan((anteriorPhi / lateralPhi) * Math.tan(theta))
    const phi = Math.cos(2 * thetaPrime) * ((anteriorPhi - lateralPhi) / 2) + (anteriorPhi + lateralPhi) / 2
    minDots.push(Math.cos(phi))
    theta += dTheta
  }
  constraint.setSwingLimits(minDots)
}

/**
 * Le calcul des butées de charnière (lignes 1343-1373 pour le coude,
 * 1374-1404 pour le genou) : les deux axes limites sont transportés du repère
 * parent au repère enfant puis mesurés contre la direction de l'os projetée.
 * L'original projette UNIT_Y en dur — dans le rig HiFi, Y est TOUJOURS le long
 * de l'os, donc perpendiculaire à toute charnière. Dans le repère avatar,
 * l'os ne pointe pas vers Y (l'avant-bras pointe vers ±X, et la charnière du
 * coude est justement ±Y : la projection de Y y dégénère en vecteur nul, et
 * acos(0) fabriquait des butées à 90°). D'où le paramètre `boneDir` : la
 * direction de repos de l'os, l'exact rôle que UNIT_Y tenait chez eux.
 */
export function configureHinge(
  constraint: HingeConstraint,
  referenceRotation: Quaternion,
  hingeAxisParent: Vector3,
  boneDir: Vector3,
  minAngle: number,
  maxAngle: number,
): void {
  constraint.setReferenceRotation(referenceRotation)
  const invRef = new Quaternion().copy(referenceRotation).invert()
  const minSwingAxis = new Vector3()
    .copy(boneDir)
    .applyQuaternion(new Quaternion().setFromAxisAngle(hingeAxisParent, minAngle).premultiply(invRef))
  const maxSwingAxis = new Vector3()
    .copy(boneDir)
    .applyQuaternion(new Quaternion().setFromAxisAngle(hingeAxisParent, maxAngle).premultiply(invRef))
  const hingeAxis = new Vector3().copy(hingeAxisParent).applyQuaternion(referenceRotation)
  constraint.setHingeAxis(hingeAxis)
  const projectedBone = new Vector3()
    .copy(boneDir)
    .addScaledVector(hingeAxis, -boneDir.dot(hingeAxis))
    .normalize()
  let lo = Math.acos(clamp(projectedBone.dot(minSwingAxis), -1, 1))
  if (hingeAxis.dot(new Vector3().crossVectors(projectedBone, minSwingAxis)) < 0) lo = -lo
  let hi = Math.acos(clamp(projectedBone.dot(maxSwingAxis), -1, 1))
  if (hingeAxis.dot(new Vector3().crossVectors(projectedBone, maxSwingAxis)) < 0) hi = -hi
  constraint.setAngleLimits(lo, hi)
}

// ── LA TABLE — `initConstraints`, lignes 1146-1432, repère avatar ───────────

const DEG = PI / 180

/**
 * LA TABLE. Chaque entrée cite la valeur d'Overte, et la valeur RETENUE quand
 * elle diffère. La règle de calibrage, mesurée sur les 111 clips livrés (et
 * séparément sur les 52 que l'application charge) : la valeur d'Overte est
 * gardée TELLE QUELLE partout où la bibliothèque passe sans être rognée ; là
 * où les animations d'Overte elles-mêmes la dépassent — leur moteur
 * n'appliquait ces contraintes QUE dans le solveur IK, jamais aux clips —,
 * la limite est élargie au maximum mesuré plus une marge, pour que la table
 * bloque l'impossible sans restyler la bibliothèque. Chiffres : voir le
 * rapport du portage.
 */
function constraintFor(bone: VRMHumanBoneName): RotationConstraint | null {
  const st = (): SwingTwistConstraint => new SwingTwistConstraint()
  switch (bone) {
    case 'leftShoulder':
    case 'rightShoulder': {
      // Overte : twist ±18° (π/10), cône 15° (π/12). Retenu : ±40° / 30° —
      // `sad.vrma` (le geste livré) affaisse les épaules jusqu'à 35°/29°.
      const c = st()
      c.setTwistLimits(-40 * DEG, 40 * DEG)
      c.setSwingLimits([Math.cos(30 * DEG)])
      return c
    }
    case 'leftUpperArm':
    case 'rightUpperArm': {
      // Overte tel quel : twist ±112,5° (5π/8), cône 112,5° (MAX_HAND_SWING).
      // Mesuré : 50,7° / 81,6° — la bibliothèque passe entière.
      const c = st()
      const TWIST_LIMIT = (5 * PI) / 8
      c.setTwistLimits(-TWIST_LIMIT, TWIST_LIMIT)
      c.setSwingLimits([Math.cos((5 * PI) / 8)])
      return c
    }
    case 'leftLowerArm':
    case 'rightLowerArm': {
      // COUDE. Overte le modèle en charnière pure (0 → 165°, swing jeté) —
      // dans son solveur IK. Appliqué aux poses AFFICHÉES, ce modèle jette
      // jusqu'à 126° d'animation légitime (world-sit-disbelief lève les
      // avant-bras hors du plan de flexion). Retenu : le mécanisme général
      // d'Overte (swing-twist) dans le repère de l'os — twist = pronation
      // ±110° (mesuré −83..101°), enveloppe asymétrique qui garde les deux
      // interdits de la charnière : PAS d'hyperextension (8° de grâce, mesuré
      // 0°), pas de pli au-delà de 165° (la butée d'Overte).
      const c = st()
      const left = bone === 'leftLowerArm'
      // C amène Y (axe de contrainte) sur l'os : ±X selon le côté.
      c.setFrameRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), left ? -PI / 2 : PI / 2))
      c.setTwistLimits(-110 * DEG, 110 * DEG)
      // θ = 0 : flexion (vers l'avant) ; θ = 180° : extension ; le reste :
      // hors-plan, gardé large parce que la bibliothèque y vit (jusqu'à 139°
      // en haut-avant, 76° côté arrière-haut). Table symétrique en ±θ : les
      // deux bras la partagent, et un futur clip miroir doit passer aussi.
      c.setSwingLimits([
        Math.cos(165 * DEG), // flexion — butée d'Overte
        Math.cos(150 * DEG),
        Math.cos(145 * DEG),
        Math.cos(100 * DEG),
        Math.cos(8 * DEG), // extension : pas d'hyperextension
        Math.cos(100 * DEG),
        Math.cos(145 * DEG),
        Math.cos(150 * DEG),
      ])
      return c
    }
    case 'spine': {
      // Overte : twist ±9° (π/20), ellipse 12°/18°. Retenu : ±15° et 15°/25° —
      // les postures assises jambes croisées (world-sit-idle-2) vrillent et
      // penchent le bas du dos au-delà de la table IK d'Overte.
      const c = st()
      c.setTwistLimits(-15 * DEG, 15 * DEG)
      setEllipticalSwingLimits(c, 15 * DEG, 25 * DEG)
      return c
    }
    case 'chest': {
      // Overte tel quel : ±9°, ellipse 12°/18°. Mesuré : 4,6° / 13,9° — passe.
      const c = st()
      c.setTwistLimits(-PI / 20, PI / 20)
      setEllipticalSwingLimits(c, PI / 15, PI / 10)
      return c
    }
    case 'upperChest': {
      // Overte : ±9°, ellipse 12°/18°. Retenu : twist d'Overte (mesuré 3,8°),
      // ellipse 15°/45° — world-sit-exit plie le buste à 41,6° pour se lever.
      const c = st()
      c.setTwistLimits(-PI / 20, PI / 20)
      setEllipticalSwingLimits(c, 15 * DEG, 45 * DEG)
      return c
    }
    case 'neck': {
      // Overte : twist ±22,5° (π/8, gardé — mesuré 13,7°), ellipse 15°/18°.
      // Retenu : 20°/30° — la flexion de nuque de world-sit-exit atteint 27,7°.
      const c = st()
      c.setTwistLimits(-PI / 8, PI / 8)
      setEllipticalSwingLimits(c, 20 * DEG, 30 * DEG)
      return c
    }
    case 'head': {
      // Overte tel quel : twist ±30° (π/6), ellipse 45°/60° (π/4, π/3).
      // Mesuré : 30,7° / 21,5° — un seul clip effleure la butée de 0,7°.
      const c = st()
      c.setTwistLimits(-PI / 6, PI / 6)
      setEllipticalSwingLimits(c, PI / 4, PI / 3)
      return c
    }
    case 'leftUpperLeg':
    case 'rightUpperLeg': {
      // Overte tel quel : twist ±90° (π/2), enveloppe à 8 directions
      // FORTEMENT asymétrique — la hanche s'ouvre largement vers l'avant,
      // presque pas vers l'arrière. Les huit valeurs Y sont celles d'Overte ;
      // les directions sont replacées dans le repère avatar (θ = 0 :
      // extension, le Y balancé part vers +Z ; θ = π : flexion, vers −Z ;
      // symétrique en ±X, donc pas de miroir à faire). Mesuré : les 111 clips
      // passent SANS UNE retouche — la trouvaille de la fiche tient telle quelle.
      const c = st()
      c.setTwistLimits(-PI / 2, PI / 2)
      const Y_BY_THETA = [1.0, 0.5, 0.25, -1.5, -3.0, -1.5, 0.25, 0.5]
      const dirs: Vector3[] = []
      for (let i = 0; i < 8; i++) {
        const theta = (i * PI) / 4
        dirs.push(new Vector3(Math.sin(theta), Y_BY_THETA[i], Math.cos(theta)))
      }
      c.setSwingLimitsFromDirections(dirs)
      return c
    }
    case 'leftLowerLeg':
    case 'rightLowerLeg': {
      // GENOU. Même raisonnement que le coude : la charnière pure d'Overte
      // (0 → 157,5°, axe unique) vaut pour son solveur, pas pour des poses
      // assises jambes croisées qui portent ~100° de swing hors-plan. Retenu :
      // swing-twist dans le repère du tibia — twist tibial ±55° (mesuré
      // −35..51°), flexion butée à 157,5° (Overte), hyperextension bloquée
      // (12° de grâce, mesuré 11,8°), latéral tenu serré (20°, mesuré 1,6°).
      const c = st()
      c.setFrameRotation(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), PI))
      c.setTwistLimits(-55 * DEG, 55 * DEG)
      // θ = 0 : flexion ; 180° : extension ; ±90° : latéral.
      c.setSwingLimits([
        Math.cos(157.5 * DEG), // MAX_KNEE_ANGLE d'Overte
        Math.cos(110 * DEG),
        Math.cos(20 * DEG),
        Math.cos(20 * DEG),
        Math.cos(15 * DEG), // pas d'hyperextension (mesuré 11,8° en course)
        Math.cos(20 * DEG),
        Math.cos(20 * DEG),
        Math.cos(110 * DEG),
      ])
      return c
    }
    case 'leftFoot':
    case 'rightFoot': {
      // CHEVILLE. Overte : twist ±45°, enveloppe 4 points exprimée dans le
      // repère du tibia HiFi (non reconstructible — voir l'en-tête). Retenu :
      // twist ±55° (le dévissage mesuré atteint 51° sur world-run) et un cône
      // elliptique bâti avec LEUR setEllipticalSwingLimits : 60° avant/arrière,
      // 40° latéral (mesuré 36,4° / 29°).
      const c = st()
      c.setTwistLimits(-55 * DEG, 55 * DEG)
      setEllipticalSwingLimits(c, 40 * DEG, 60 * DEG)
      return c
    }
    default:
      // mains/poignets : « hand/wrist constraints have been disabled » — idem.
      return null
  }
}

// ── Application en bout de chaîne ───────────────────────────────────────────

export interface JointLimits {
  /**
   * Borne TOUTES les rotations contraintes, sur les os normalisés, telles que
   * la frame les affiche. À appeler après le mixer, l'IK et tout layering,
   * avant vrm.update(). Rend le nombre d'os réellement modifiés.
   */
  apply(): number
  /** À appeler à toute discontinuité voulue (changement de modèle, téléportation). */
  clearHistory(): void
  /** Nombre d'os sous contrainte sur ce modèle. */
  readonly boneCount: number
}

/**
 * Prépare la table pour un modèle. Ne contraint que les os PRÉSENTS — un
 * squelette sans upperChest a simplement une vertèbre de moins.
 */
export function createJointLimits(vrm: VRM): JointLimits | null {
  const entries: { node: Object3D; constraint: RotationConstraint }[] = []
  const BONES: readonly VRMHumanBoneName[] = [
    'spine',
    'chest',
    'upperChest',
    'neck',
    'head',
    'leftShoulder',
    'rightShoulder',
    'leftUpperArm',
    'rightUpperArm',
    'leftLowerArm',
    'rightLowerArm',
    'leftUpperLeg',
    'rightUpperLeg',
    'leftLowerLeg',
    'rightLowerLeg',
    'leftFoot',
    'rightFoot',
  ] as VRMHumanBoneName[]
  for (const bone of BONES) {
    const node = vrm.humanoid.getNormalizedBoneNode(bone)
    if (!node) continue
    const constraint = constraintFor(bone)
    if (constraint) entries.push({ node, constraint })
  }
  if (entries.length === 0) return null
  return {
    boneCount: entries.length,
    apply(): number {
      let changed = 0
      for (const { node, constraint } of entries) {
        if (constraint.apply(node.quaternion)) changed++
      }
      return changed
    },
    clearHistory(): void {
      for (const { constraint } of entries) constraint.clearHistory()
    },
  }
}

/** La table nue, pour les bancs d'essai hors navigateur. */
export function constraintForBone(bone: VRMHumanBoneName): RotationConstraint | null {
  return constraintFor(bone)
}
