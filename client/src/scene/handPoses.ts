/*
 * Données portées depuis Overte (https://github.com/overte-org/overte),
 * fichier scripts/system/controllers/handTouch.js — les jeux de poses de
 * doigts `dataOpen` et `dataClose` (60 quaternions, 2 mains × 5 doigts ×
 * 3 phalanges), réglés à la main.
 *
 * Created by Luis Cuenca on 12/29/17.
 * Copyright 2017 High Fidelity, Inc.
 * Distributed under the Apache License, Version 2.0.
 * See http://www.apache.org/licenses/LICENSE-2.0.html
 *
 * MODIFIÉ : données extraites telles quelles dans handPosesOverte.json
 * (l'asset n'est pas retouché), puis transportées à la volée du repère d'os
 * HiFi (Y le long du doigt) vers le repère du rig humanoïde normalisé de
 * @pixiv/three-vrm par conjugaison q ← M·q·M⁻¹ — M déterminé EMPIRIQUEMENT :
 * parmi les 24 rotations du groupe octaédrique, celle qui fait du POING
 * (`dataClose`) un poing — les 12 phalanges hors pouce en flexion franche
 * autour de l'axe de flexion du repère VRM (−Z main gauche, +Z main droite),
 * mesuré 66,7° de flexion moyenne pour 5° de hors-axe. Portage Hanami, 2026,
 * redistribué sous AGPL-3.0.
 *
 * LE RÔLE : les clips CMU et la plupart des clips du domaine `world-` ne
 * pilotent pas les doigts (0 piste sur idle.vrma, world-walk.vrma,
 * world-sit-idle.vrma) — sans ce fichier, les mains restent figées en
 * « moufles plates » de la pose de repos VRM. Les gestes d'Overte (happy…),
 * eux, animent les 30 os de doigts : la pose de repos ne s'applique QUE
 * quand aucune piste n'écrit — jamais par-dessus une animation.
 *
 * Détection « le clip pilote-t-il les doigts ? » par SENTINELLE : avant le
 * mixer, chaque os de doigt reçoit le quaternion (0,0,0,−1) — la MÊME
 * rotation que l'identité (q et −q sont la même rotation), mais un encodage
 * qu'aucune piste réelle ne produit. Après le mixer : si w vaut encore −1,
 * personne n'a écrit — la pose détendue s'applique, en fondu depuis la
 * dernière pose affichée (l'esprit du `dataDefault` capturé à chaud de
 * handTouch.js, et de sa cadence : cible atteinte en ~10 images).
 */
import { Quaternion } from 'three'
import type { Object3D } from 'three'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import { safeLerpQuat } from './overteMath'
import raw from './handPosesOverte.json'

/** `defaultAnimationSteps = 10` de handTouch.js : retour au repos en 10 images (à 60 i/s). */
const RELAX_IN_S = 10 / 60

/**
 * M par main (repère HiFi → repère VRM normalisé), déterminé par le critère
 * du poing (cf. en-tête) : des rotations de 120° autour de diagonales.
 */
const M_LEFT = new Quaternion(-0.5, -0.5, 0.5, -0.5)
const M_RIGHT = new Quaternion(0.5, 0.5, 0.5, -0.5)

/** doigt du JSON → segments d'os VRM (le pouce a un métacarpien, pas d'intermédiaire). */
const FINGER_BONES: ReadonlyArray<readonly [string, string, ReadonlyArray<string>]> = [
  ['thumb', 'Thumb', ['Metacarpal', 'Proximal', 'Distal']],
  ['index', 'Index', ['Proximal', 'Intermediate', 'Distal']],
  ['middle', 'Middle', ['Proximal', 'Intermediate', 'Distal']],
  ['ring', 'Ring', ['Proximal', 'Intermediate', 'Distal']],
  ['pinky', 'Little', ['Proximal', 'Intermediate', 'Distal']],
]

interface RawQuat {
  x: number
  y: number
  z: number
  w: number
}
type RawHand = Record<string, RawQuat[]>

/** Convertit une pose brute (repère HiFi) en table os VRM → quaternion. */
function convertHand(side: 'left' | 'right', hand: RawHand): Map<string, Quaternion> {
  const M = side === 'left' ? M_LEFT : M_RIGHT
  const Minv = M.clone().invert()
  const out = new Map<string, Quaternion>()
  for (const [jsonName, vrmName, parts] of FINGER_BONES) {
    const quats = hand[jsonName]
    if (!quats) continue
    parts.forEach((part, i) => {
      const q = quats[i]
      if (!q) return
      out.set(
        `${side}${vrmName}${part}`,
        new Quaternion(q.x, q.y, q.z, q.w).premultiply(M).multiply(Minv),
      )
    })
  }
  return out
}

/** La pose « ouverte détendue », en repère VRM, prête à poser sur les os normalisés. */
const OPEN_POSE = new Map<string, Quaternion>([
  ...convertHand('left', (raw as { open: Record<'left' | 'right', RawHand> }).open.left),
  ...convertHand('right', (raw as { open: Record<'left' | 'right', RawHand> }).open.right),
])

/** Le poing (`dataClose`), converti lui aussi — pas encore branché, disponible. */
export const CLOSED_POSE = new Map<string, Quaternion>([
  ...convertHand('left', (raw as { closed: Record<'left' | 'right', RawHand> }).closed.left),
  ...convertHand('right', (raw as { closed: Record<'left' | 'right', RawHand> }).closed.right),
])

export interface HandRelax {
  /** AVANT mixer.update : pose la sentinelle sur chaque os de doigt. */
  beforeMixer(): void
  /** APRÈS le mixer : là où la sentinelle a survécu, pose la main détendue. */
  apply(dt: number): void
}

interface FingerEntry {
  node: Object3D
  target: Quaternion
  /** Pose affichée à l'image précédente — le départ du fondu vers la détente. */
  prev: Quaternion
  left: boolean
}

/**
 * Prépare la détente de mains pour un modèle. null si le modèle n'a aucun os
 * de doigt (les mains restent ce qu'elles sont, comme avant).
 */
export function createHandRelax(vrm: VRM): HandRelax | null {
  const entries: FingerEntry[] = []
  for (const [boneName, target] of OPEN_POSE) {
    const node = vrm.humanoid.getNormalizedBoneNode(boneName as VRMHumanBoneName)
    if (node) entries.push({ node, target, prev: new Quaternion(), left: boneName.startsWith('left') })
  }
  if (entries.length === 0) return null
  // Fondu d'engagement par MAIN (les doigts d'une main vivent ensemble, et
  // les clips d'Overte pilotent les 15 os d'une main d'un bloc) :
  // 0 = ce que le clip a laissé, 1 = pose détendue pleine.
  let weightLeft = 0
  let weightRight = 0
  return {
    beforeMixer(): void {
      // (0,0,0,−1) est l'identité, encodée comme aucune piste ne l'encode.
      for (const e of entries) e.node.quaternion.set(0, 0, 0, -1)
    },
    apply(dt): void {
      let leftDriven = false
      let rightDriven = false
      for (const e of entries) {
        if (e.node.quaternion.w !== -1) {
          if (e.left) leftDriven = true
          else rightDriven = true
        }
      }
      const step = dt / RELAX_IN_S
      weightLeft = leftDriven ? 0 : Math.min(1, weightLeft + step)
      weightRight = rightDriven ? 0 : Math.min(1, weightRight + step)
      for (const e of entries) {
        if (e.left ? leftDriven : rightDriven) {
          // le clip pilote : mémoriser ce qu'il affiche, ne rien toucher —
          // c'est d'ICI que partira le fondu quand il lâchera les doigts.
          e.prev.copy(e.node.quaternion)
          continue
        }
        // sentinelle survivante : rendre l'identité propre, puis fondre de la
        // dernière pose pilotée vers la détente.
        if (e.node.quaternion.w === -1) e.node.quaternion.set(0, 0, 0, 1)
        safeLerpQuat(e.prev, e.target, e.left ? weightLeft : weightRight, e.node.quaternion)
      }
    },
  }
}
