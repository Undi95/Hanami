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
 * ── LE RÔLE ────────────────────────────────────────────────────────────────
 * Un VRM charge doigts TENDUS : sans pose de repos, chaque os de doigt est à
 * l'identité et la main est une moufle plate, doigts en éventail — le mannequin
 * de vitrine. Et 30 des 151 clips livrés n'ont AUCUNE piste de doigt, dont
 * précisément ceux qu'on regarde le plus longtemps : `idle`, `idle-2`,
 * `world-walk`, `world-run`, les six `world-sit-idle*`, les demi-tours assis.
 * Ce fichier fabrique LA POSE DE REPOS DES DOIGTS, et vrmStage la pose sur le
 * squelette AVANT de construire le mixer, exactement comme REST_POSE_Z pose
 * les bras. C'est tout : aucun code par image.
 *
 * Pourquoi « avant le mixer » suffit, et pourquoi c'est la BONNE place :
 * three relève la valeur de chaque os à la première activation d'une action
 * (PropertyMixer.saveOriginalState) et la traite ensuite comme le fond du
 * décor —
 *   • os qu'AUCUN clip ne pilote : jamais lié, jamais réécrit, il garde la
 *     pose de repos pour toujours ;
 *   • os qu'un clip pilote à poids plein : le clip écrase, il GAGNE ;
 *   • pendant un fondu, tant que la somme des poids qui touchent CET os est
 *     < 1, three complète avec la valeur relevée — la main revient donc à sa
 *     détente au rythme du fondu (0,3 à 0,5 s), sans une ligne de plus ;
 *   • à la reconstruction du mixer, disposeAnimations appelle uncacheRoot,
 *     qui rend justement cette valeur (cf. son commentaire).
 *
 * ── CE QUI A ÉTÉ ESSAYÉ AVANT, ET POURQUOI C'EST PARTI ─────────────────────
 * La première version posait la main À CHAQUE IMAGE, après le mixer, sur les
 * os qu'un marqueur — le quaternion (0,0,0,−1), l'identité dans un encodage
 * qu'aucune piste ne produit — avait traversés intacts. Deux mesures l'ont
 * condamnée :
 *   1. elle posait `dataOpen`, la main OUVERTE d'Overte : 4,8° de flexion
 *      moyenne hors pouce. C'est-à-dire RIEN — la moufle plate, exactement ce
 *      qu'elle prétendait corriger ;
 *   2. le marqueur MENT. three n'appelle setValue que si la valeur accumulée
 *      diffère de celle de l'image précédente (PropertyMixer.apply, dernière
 *      boucle) : un doigt tenu immobile par un clip cesse d'être réécrit, le
 *      marqueur survit, et la main détendue se serait posée PAR-DESSUS le
 *      clip. Mesuré sur les 121 clips qui pistent les doigts : 105 ont au
 *      moins un os que three cesse de réécrire, 37 voient une MAIN ENTIÈRE
 *      déclarée libre à tort, 10,8 % des couples (os pisté × image) sont vus
 *      libres alors qu'ils ne le sont pas. Inoffensif tant que la pose valait
 *      l'identité ; ruineux dès qu'elle porte une vraie courbure.
 * La pose de repos n'a aucun de ces deux défauts, et ne coûte rien par image.
 */
import { Quaternion, Vector3 } from 'three'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import { safeLerpQuat } from './overteMath'
import { normalizedFacesPlusZ } from './jointLimits'
import raw from './handPosesOverte.json'

/**
 * M par main (repère HiFi → repère VRM normalisé), déterminé par le critère
 * du poing (cf. en-tête) : des rotations de 120° autour de diagonales.
 */
const M_LEFT = new Quaternion(-0.5, -0.5, 0.5, -0.5)
const M_RIGHT = new Quaternion(0.5, 0.5, 0.5, -0.5)

/**
 * doigt du JSON → segments d'os VRM. Le pouce n'a pas d'intermédiaire : ses
 * trois segments sont métacarpien, proximale, distale. Les modèles VRM 0.x
 * nomment les leurs `thumbProximal/Intermediate/Distal`, mais three-vrm les
 * renomme à l'import (VRMHumanoidLoaderPlugin, thumbBoneNameMap) — les 89
 * modèles 0.x du dossier exposent donc les mêmes 30 os que les 5 en 1.x, et
 * une seule table suffit pour les deux formats (vérifié sur EtalonChibi en
 * 0.x et ayaka en 1.x : 30/30 os retrouvés de part et d'autre).
 */
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
type RawPose = Record<'left' | 'right', RawHand>

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

const data = raw as { open: RawPose; closed: RawPose }
/** `dataOpen` : la main OUVERTE — doigts tendus, 4,8° de flexion hors pouce. */
const OPEN_POSE = new Map<string, Quaternion>([
  ...convertHand('left', data.open.left),
  ...convertHand('right', data.open.right),
])
/** `dataClose` : le POING — 67,1° de flexion moyenne hors pouce. */
const CLOSED_POSE = new Map<string, Quaternion>([
  ...convertHand('left', data.closed.left),
  ...convertHand('right', data.closed.right),
])

/**
 * Fraction du chemin ouverte → poing qui fait la main AU REPOS. Overte n'a que
 * les deux extrêmes ; handTouch.js lui-même ne connaît la main intermédiaire
 * que comme un point du segment entre les deux, et c'est cette même règle qu'on
 * reprend — aucun angle inventé à la main, un seul nombre à défendre.
 *
 * 0,30 : la pulpe des doigts arrive au tiers de la paume. Mesuré sur la pose
 * obtenue (main gauche, flexion autour de −Z) : courbure totale 53,7° pour
 * l'index, 55,9° majeur, 60,1° annulaire, 63,6° auriculaire — la cascade
 * naturelle d'une main qui pend, l'index le plus droit et l'auriculaire le
 * plus fermé ; pouce à 14,7° de flexion au métacarpien, phalanges à −7,8°,
 * c'est-à-dire détendu le long de l'index, ni collé ni écarté. Symétrie
 * gauche/droite : 0,14° d'écart maximum.
 * Au-delà de 0,4 la main commence à tenir quelque chose ; en deçà de 0,2 elle
 * redevient la planche qu'on corrige.
 */
const RELAX_T = 0.3

/**
 * LA POSE DE REPOS : ce que valent les doigts quand aucun clip n'en parle.
 * Le mélange est celui d'Overte lui-même (`AnimUtil.h::safeLerp`, cf.
 * overteMath) et non le slerp de three : 0,8° d'écart au plus sur les 30 os,
 * et c'est la primitive avec laquelle le moteur d'origine mélange ses poses.
 * Un os présent dans `open` mais pas dans `closed` (données tronquées) garde
 * simplement la pose ouverte — on ne fabrique rien qu'on ne sache mesurer.
 */
const RELAXED_POSE: ReadonlyMap<string, Quaternion> = new Map(
  [...OPEN_POSE].map(([bone, open]) => {
    const closed = CLOSED_POSE.get(bone)
    return [
      bone,
      closed ? safeLerpQuat(open, closed, RELAX_T, new Quaternion()) : open.clone(),
    ] as const
  }),
)

/**
 * Demi-tour autour de Y — la MÊME conjugaison que MirroredConstraint, et pour
 * la même raison : le repère des os normalisés d'un VRM 0.x regarde le −Z (89
 * des 94 modèles du dossier, dont celui de l'utilisateur), et une flexion
 * écrite en dur pour le +Z s'y applique À L'ENVERS — les doigts se cabrent en
 * hyperextension au lieu de se refermer. Vérifié contre la vérité terrain que
 * sont les clips de capture : `rb-happy` ferme le poing à +62,2° de flexion
 * sur un rig 1.x et −62,2° sur les quatre rigs 0.x sondés, au même quantième
 * d'image. C'est ce piège qui rendait le portage inoffensif dans les deux
 * sens : la pose « ouverte » d'Overte valant 4,8°, se tromper de signe ne se
 * voyait pas.
 */
const HALF_TURN_Y = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)
const HALF_TURN_Y_INV = HALF_TURN_Y.clone().invert()

/**
 * Pose la main détendue sur les os de doigts NORMALISÉS du modèle. À appeler
 * avec le reste de la pose de repos, donc AVANT la construction du mixer (cf.
 * en-tête). Un modèle sans os de doigts n'est pas touché — sa main reste ce
 * qu'elle est, comme avant.
 * Retourne le nombre d'os posés (0 à 30), pour qui veut le vérifier.
 */
export function applyRelaxedHands(vrm: VRM): number {
  const mirror = !normalizedFacesPlusZ(vrm)
  let posed = 0
  for (const [bone, q] of RELAXED_POSE) {
    const node = vrm.humanoid.getNormalizedBoneNode(bone as VRMHumanBoneName)
    if (!node) continue
    node.quaternion.copy(q)
    if (mirror) node.quaternion.premultiply(HALF_TURN_Y).multiply(HALF_TURN_Y_INV)
    posed++
  }
  return posed
}
