/*
 * Cinématique inverse des jambes — LE cœur du moteur physique.
 *
 * La partie « reach » (assise) et la machinerie anti-pop sont portées en
 * TypeScript depuis Overte (https://github.com/overte-org/overte), fichiers
 * libraries/animation/src/AnimTwoBoneIK.cpp / .h,
 * libraries/animation/src/AnimPoleVectorConstraint.cpp / .h
 * (Created by Anthony J. Thibault on 5/12/18) et
 * libraries/animation/src/Rig.cpp (calculateKneePoleVector, updateFeet —
 * Created by Howard Stearns, Seth Alves, Anthony Thibault, Andrew Meadows
 * on 7/15/15).
 * Copyright (c) 2015-2018 High Fidelity, Inc. All rights reserved.
 * Copyright 2023 Overte e.V. (Rig.cpp)
 * Distributed under the Apache License, Version 2.0.
 * See http://www.apache.org/licenses/LICENSE-2.0.html
 *
 * MODIFIÉ : transcrit du C++ vers TypeScript, adapté à three.js et au rig
 * humanoïde normalisé de @pixiv/three-vrm par le projet Hanami, 2026.
 * L'ensemble est redistribué sous AGPL-3.0.
 *
 * Le clip donne l'allure, l'IK corrige l'assiette. C'est ce qui fait tomber la
 * question « ce meuble est-il compatible avec ce modèle » : un lit à 51 cm et
 * une chaise à 43 cm deviennent tous deux utilisables, parce que la jambe
 * s'adapte au lieu que la hauteur d'assise soit imposée par l'animation.
 *
 * LE CHIFFRE QUI JUSTIFIE CE FICHIER (mesuré sur les 12 modèles de vrm/, point
 * « semelle » suivi image par image dans le repère du pied, sol du clip à y = 0) :
 *   • idle             — le pied traverse le sol de 1 à 4,5 mm  → invisible
 *   • world-walk       — de 16 à 22 mm                          → visible de près
 *   • world-walk-slow  — de 21 à 33 mm                          → VISIBLE
 *   • world-sit-idle   — de 37 à 62 mm                          → très visible
 * Sans IK, chaque modèle s'enfonce différemment : la correction ne peut pas
 * être une constante, elle doit être calculée sur le modèle chargé, par image.
 *
 * DEUX RÉGIMES, deux méthodes — c'est le partage du travail entre ce que la
 * maison avait mesuré et ce qu'Overte avait résolu :
 *  - « planted » (debout, en marche) : corrections MILLIMÉTRIQUES, on ne fait
 *    que remonter un pied qui traverse. IK deux-os par la loi des cosinus dans
 *    le plan de flexion COURANT — l'orientation du genou vient de l'animation,
 *    pas d'une règle, et le glissement mesuré est de 0,0 mm. Code maison,
 *    conservé tel quel : sur des écarts de quelques millimètres, préserver le
 *    plan du clip bat n'importe quelle règle.
 *  - « reach » (assis) : le pied VISE le sol, parfois loin de la pose du clip.
 *    Là, le plan du clip ne veut plus rien dire — c'est le portage Overte qui
 *    prend : angle du genou par intersection cercle-cercle, genou CHARNIÈRE
 *    PURE par construction (il ne peut pas violer la table de jointLimits),
 *    hanche orientée vers la cible, et le genou pointé par le POLE VECTOR de
 *    production (75 % direction du cou-de-pied à 51,39°, 25 % direction du
 *    bassin — deux nombres d'un réglage empirique qu'on ne retrouverait pas
 *    seul), lissé en rotation à 15 %/image à 60 i/s.
 *  - au CHANGEMENT de régime (s'asseoir, se lever) : l'interpolation
 *    anti-pop d'AnimTwoBoneIK — instantané de la chaîne, fondu ease-in expo
 *    en 0,5 s (interpDuration 15 images à 30 i/s) vers le nouveau régime.
 */
import { Quaternion, Vector3 } from 'three'
import type { Object3D } from 'three'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import { normalizedFacesPlusZ } from './jointLimits'
import { easeInExpo, safeLerpQuat, safeMixQuat } from './overteMath'

/** Sous cet écart, on ne touche à rien : la correction serait sous le pixel. */
const IK_EPS = 0.0015 // m
/**
 * Jambe jamais tendue à 100 % : à l'extension exacte, le plan de flexion n'est
 * plus défini et le genou peut claquer d'un côté à l'autre d'une image à l'autre.
 * 0,3 % de la jambe (≈ 2 mm sur 0,63 m) suffit à garder l'axe stable.
 */
const MAX_EXTENSION = 0.997
/** Repli d'axe de flexion, en LOCAL de la cuisse : le genou plie vers l'avant. */
const KNEE_FORWARD = new Vector3(0, 0, 1)

// ── Constantes portées d'Overte ─────────────────────────────────────────────
/** `Rig.cpp:2289` — inclinaison du « cou-de-pied » par rapport à l'axe du tibia. */
const FOOT_THETA = 0.8969 // rad = 51,39°
/** `Rig.cpp:2298` — le genou pointe à 75 % vers le cou-de-pied, 25 % vers le bassin. */
const KNEE_POLE_BLEND = 0.75
/**
 * `Rig.cpp:2026` (KNEE_POLE_VECTOR_BLEND_FACTOR = 0.85) — on ne prend que 15 %
 * de la rotation du pole vector PAR IMAGE, à 60 i/s. Rendu dépendant de dt :
 * f = 1 − 0,85^(60·dt), le lissage est fait sur la ROTATION entre l'ancien et
 * le nouveau vecteur (convergence angulaire uniforme), jamais sur le vecteur.
 */
const POLE_KEEP_PER_FRAME = 0.85
/** `AnimTwoBoneIK` — interpDuration 15 images à FRAMES_PER_SECOND = 30 : 0,5 s. */
const INTERP_ALPHA_VEL = 30 / 15 // alpha/s
/** `AnimTwoBoneIK.cpp:170` — bras de levier trop court : on ne touche à rien. */
const MIN_AXIS_LENGTH = 1e-4
/** Axe de charnière du genou dans le repère avatar (le graphe d'Overte dit (−1,0,0) dans le sien). */
const KNEE_HINGE = new Vector3(1, 0, 0)
/** `Rig.cpp:2290` — direction du cou-de-pied dans le repère LOCAL du pied. */
const LOCAL_FOOT_FORWARD = new Vector3(0, Math.cos(FOOT_THETA), Math.sin(FOOT_THETA))
/** L'avant du bassin dans son repère local — `hipsForward` de Rig::calculateKneePoleVector. */
const HIPS_FORWARD = new Vector3(0, 0, 1)

// ── LE SENS DU REPÈRE NORMALISÉ, MESURÉ ────────────────────────────────────
//
// Le même piège que jointLimits a déjà payé, et il mordait ici aussi.
//
// Quatre des grandeurs ci-dessus ne sont pas des directions du MONDE : ce sont
// des directions d'OS (l'axe de charnière du genou, le devant du genou —
// refVector du pole vector —, le cou-de-pied, l'avant du bassin). Toutes sont
// écrites dans la convention « +Z devant, +X à gauche ». Or `VRMHumanoidRig`
// bâtit les os normalisés dans l'espace PROPRE du modèle, et un VRM 0.x y
// regarde le −Z : `VRMUtils.rotateVRM0` tourne la SCÈNE, jamais un repère local.
//
// MESURÉ sur les 94 modèles de vrm/ : 89 sont en 0.x, et sur ces 89 la charnière
// `angleAxis(midAngle, +X)` du régime assis pliait le genou VERS L'AVANT — de
// l'hyperextension, pas une flexion. Relevé sur EtalonChibi (0.x, hanches
// 0,755 m) assise à 0,426 m (les chaises d'anime-classroom), sur world-sit-idle :
// 108,7° hors de la table de jointLimits au genou et 54,9° à la cheville, genou
// 14 à 20 cm DERRIÈRE la corde hanche→cheville, semelle 4,9 cm sous le sol, et
// les deux jambes ramenées à 0,000 m l'une de l'autre — l'interpénétration
// franche. Sur les 5 modèles en 1.0, les mêmes mesures rendaient 0,0° : c'est le
// repère qui était en cause, pas la table ni les clips.
//
// Le remède est celui de jointLimits — un CHANGEMENT DE BASE, pas une retouche
// des valeurs : le demi-tour autour de Y qui sépare les deux conventions échange
// (+X, +Z) et (−X, −Z). Il est appliqué UNE FOIS, à la préparation du modèle, et
// le solveur ne lit ensuite que le repère mesuré.

/** Les quatre directions d'os du solveur, dans le repère RÉEL du modèle. */
interface Repere {
  /** Axe de charnière du genou, repère LOCAL du tibia. */
  kneeHinge: Vector3
  /** Le devant du genou et de la cuisse, dans leur repère LOCAL. */
  kneeForward: Vector3
  /** Direction du cou-de-pied, repère LOCAL du pied. */
  footForward: Vector3
  /** L'avant du bassin, dans son repère LOCAL. */
  hipsForward: Vector3
}

/** Un demi-tour autour de Y : (x, y, z) → (−x, y, −z). */
function retourne(v: Vector3, faceZ: boolean): Vector3 {
  return faceZ ? v.clone() : new Vector3(-v.x, v.y, -v.z)
}

function repereDe(vrm: VRM): Repere {
  const faceZ = normalizedFacesPlusZ(vrm)
  return {
    kneeHinge: retourne(KNEE_HINGE, faceZ),
    kneeForward: retourne(KNEE_FORWARD, faceZ),
    footForward: retourne(LOCAL_FOOT_FORWARD, faceZ),
    hipsForward: retourne(HIPS_FORWARD, faceZ),
  }
}

/** Comment traiter le sol sous un pied. */
export type FootMode =
  /**
   * Debout, en marche : on ne fait que REMONTER un pied qui traverse le sol,
   * jamais descendre un pied en l'air. Un pied en phase d'élan doit rester en
   * l'air — et remonter ne peut jamais tendre la jambe, donc cette règle ne peut
   * pas produire de pose impossible, ni exiger de compensation du bassin.
   */
  | 'planted'
  /**
   * Assis : le pied VISE le sol, dans les deux sens — tant que le sol est à
   * portée de jambe. Siège bas → le genou se replie ; siège haut → la cible
   * sort de la portée et l'IK rend la main au clip, qui est le seul à savoir à
   * quoi ressemble un corps assis plus haut que ses jambes (cf. `autoriteReach`).
   */
  | 'reach'

interface Leg {
  hip: Object3D // upperLeg — le nœud NORMALISÉ, celui où l'animation écrit
  knee: Object3D // lowerLeg
  ankle: Object3D // foot
  thigh: number // longueur hanche → genou (m, à l'échelle du monde)
  shin: number // longueur genou → cheville (m)
  /**
   * Point « semelle » en coordonnées LOCALES du pied : le projeté au sol de la
   * cheville dans la pose de repos. Suivre CE point, et non la cheville, tient
   * compte de la rotation du pied (talon posé, pointe levée) — sans ça, un pied
   * en fin d'appui, cheville haute et pointe au sol, serait cru en l'air.
   */
  sole: Vector3
  /** Pole vector lissé de l'image précédente (monde), null tant que rien n'a été lissé. */
  prevPole: Vector3 | null
  /** Le bassin — la moitié « 25 % » du pole vector du genou. */
  hips: Object3D | null
  /** Le repère d'os MESURÉ sur ce modèle (cf. la section ci-dessus). */
  repere: Repere
}

/** Déplacement au sol dépeint par l'animation, dans le repère du personnage. */
export interface Stride {
  /** Latéral (droite du personnage négative), m. */
  x: number
  /** Vers l'avant, m. */
  z: number
}

export interface LegIk {
  /** À appeler AVANT mixer.update : rend aux jambes la pose que le clip leur avait donnée. */
  beforeMixer(): void
  /** À appeler APRÈS mixer.update : mémorise la pose du clip, avant correction. */
  afterMixer(): void
  /**
   * ODOMÉTRIE : de combien le sol a-t-il défilé sous les pieds depuis l'appel
   * précédent, d'après l'animation elle-même ?
   *
   * C'est le contraire de la manière habituelle. Plutôt que d'imposer au clip une
   * vitesse lue dans un fichier — qui ne vaut que pour le rig sur lequel elle a
   * été mesurée —, on LIT le déplacement que les pieds dépeignent sur CE modèle,
   * à CETTE image. Le patinage devient nul par construction, pour tout clip et
   * tout modèle, y compris pendant les fondus (les deux clips se mélangent, le
   * sol défile au mélange) et pendant les transitions de départ et d'arrêt, dont
   * personne n'a jamais mesuré le profil.
   *
   * Le chiffre qui justifie ça : `world-walk-slow` dépeint 0,4928 · h par cycle
   * sur le rig de mesure de vrma/world.json, mais 0,5265 · h sur Sakura — 7 %
   * d'écart, soit 2,6 cm de glissement par cycle avec une vitesse imposée. Les
   * proportions de jambes ne se transportent pas d'un modèle à l'autre, seule la
   * hauteur de hanches le fait.
   *
   * Rend `false` (et laisse `out` intact) tant qu'aucun appui n'est assez bas
   * pour être crédible — pendant un saut, par exemple.
   */
  stride(out: Stride): boolean
  /**
   * Corrige les deux jambes. `groundAt` rend l'altitude du sol sous un point du
   * monde (null = sol inconnu : la jambe est laissée telle quelle). `dt` sert
   * au lissage du pole vector et à l'interpolation anti-pop — les deux
   * machineries d'Overte sont dépendantes du temps, pas de l'image.
   * Rend le nombre de jambes effectivement corrigées — c'est par lui que les
   * bancs d'essai vérifient que l'IK fait bien quelque chose.
   */
  apply(mode: FootMode, groundAt: (x: number, z: number) => number | null, dt: number): number
  /** Hauteur de hanches au repos du modèle (m), à l'échelle du monde. */
  readonly hipsRest: number
  /** Longueur d'une jambe tendue (m) : hanche → cheville. */
  readonly legLength: number
}

// Scratch de module : l'IK tourne à chaque image, il n'alloue rien.
const vH = new Vector3()
const vK = new Vector3()
const vA = new Vector3()
const vT = new Vector3()
const vThigh = new Vector3()
const vShin = new Vector3()
const vBend = new Vector3()
const vDir = new Vector3()
const vSole = new Vector3()
const vTmp = new Vector3()
const vPole = new Vector3()
const vTmp2 = new Vector3()
const qDelta = new Quaternion()
const qWorld = new Quaternion()
const qParent = new Quaternion()
const qFoot = new Quaternion()
const qTmp = new Quaternion()
const IDENTITY_Q = new Quaternion()

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/**
 * Prépare l'IK pour un modèle. Rend null si le squelette n'a pas les six os de
 * jambes ou si ses segments sont dégénérés — un modèle exotique perd l'IK, il ne
 * casse pas la scène.
 *
 * À APPELER SUR LA POSE DE REPOS, une fois le modèle en place : les longueurs et
 * le point « semelle » sont mesurés en coordonnées MONDE, donc à l'échelle réelle
 * (normalizeScale a pu remettre un modèle exporté en centimètres à 1,6 m). Elles
 * sont ensuite constantes : l'animation n'écrit que des rotations.
 */
export function createLegIk(vrm: VRM, root: Object3D): LegIk | null {
  const node = (name: string): Object3D | null =>
    vrm.humanoid.getNormalizedBoneNode(name as VRMHumanBoneName)
  const legs: Leg[] = []
  const bones: Object3D[] = []
  // Le sens du repère normalisé est MESURÉ ici, une fois, sur le modèle chargé.
  const repere = repereDe(vrm)

  for (const side of ['left', 'right'] as const) {
    const hip = node(`${side}UpperLeg`)
    const knee = node(`${side}LowerLeg`)
    const ankle = node(`${side}Foot`)
    if (!hip || !knee || !ankle) return null
    ankle.updateWorldMatrix(true, false)
    hip.getWorldPosition(vH)
    knee.getWorldPosition(vK)
    ankle.getWorldPosition(vA)
    const thigh = vH.distanceTo(vK)
    const shin = vK.distanceTo(vA)
    if (!(thigh > 1e-4) || !(shin > 1e-4)) return null
    // Semelle : le projeté de la cheville sur le plan du sol du MODÈLE — dans le
    // repère de vrm.scene, un VRM se tient les pieds à y = 0 par convention.
    vrm.scene.worldToLocal(vTmp.copy(vA))
    vTmp.y = 0
    vrm.scene.localToWorld(vTmp)
    const sole = ankle.worldToLocal(vTmp.clone())
    legs.push({ hip, knee, ankle, thigh, shin, sole, prevPole: null, hips: node('hips'), repere })
    bones.push(hip, knee, ankle)
  }

  // Sauvegarde/restauration de la pose du CLIP, exactement le motif déjà employé
  // pour la respiration (cf. posedBones dans vrmStage) : l'IK écrit sur les os de
  // jambes à chaque image, et un clip qui n'anime pas un de ces os laisserait
  // sinon la correction de l'image précédente en place — puis celle d'avant, à
  // l'infini. C'est la seule façon dont une IK par image peut dériver.
  const base = bones.map((b) => b.quaternion.clone())

  const hipsRest = (() => {
    const y = vrm.humanoid.normalizedRestPose.hips?.position?.[1]
    if (typeof y !== 'number' || !(y > 0.05)) return 1
    // normalizedRestPose est en unités LOCALES de vrm.scene : à l'échelle du
    // monde il faut l'échelle appliquée à la scène du modèle.
    return y * vrm.scene.scale.y
  })()

  // ── Odométrie ─────────────────────────────────────────────────────────────
  // Position LOCALE (repère du personnage) de chaque semelle à l'image
  // précédente, et poids d'appui associé. Le repère local est ce qui rend le
  // calcul juste quand le personnage tourne : une rotation ne bouge pas un point
  // exprimé dans son propre repère, donc elle ne compte pas comme un pas.
  const prevSole: Vector3[] = legs.map(() => new Vector3())
  const nowSole: Vector3[] = legs.map(() => new Vector3())
  let prevValid = false
  /**
   * Bande de contact, RELATIVE au pied le plus bas — et c'est tout le sujet.
   *
   * Une bande absolue (« sous 4 cm du sol, ça porte ») paraît naturelle et ne
   * marche pas : `world-walk-slow` est un traînement de pieds, sa semelle en
   * balancement ne monte qu'à 3,8 % de la hauteur de hanches. Les DEUX pieds
   * tombaient donc dans la bande pendant tout le cycle, l'odométrie rendait la
   * moyenne de l'appui (qui recule) et du balancement (qui avance) — soit la
   * MOITIÉ de la vitesse réelle. Mesuré : 1,06 m parcouru au lieu de 1,86, et
   * 5 mm de glissement du pied d'appui par image, exactement la moitié de la
   * foulée. Comparer les deux pieds ENTRE EUX rend le critère indifférent à la
   * garde au sol du clip, qui varie du simple au triple d'une allure à l'autre.
   */
  const contactBand = 0.02 * hipsRest

  // ── Anti-pop (AnimTwoBoneIK::beginInterp) ─────────────────────────────────
  // Au CHANGEMENT DE RÉGIME (s'asseoir, se lever), la solution saute : le
  // régime « reach » tire les pieds vers le sol là où « planted » les laissait
  // au clip. On photographie la pose AFFICHÉE de l'image précédente et on fond
  // vers le nouveau régime en 0,5 s, ease-in expo — la machinerie exacte
  // d'AnimTwoBoneIK (SnapshotToSolve / SnapshotToUnderPoses réunis : ici les
  // deux sens passent par le même fondu, le régime d'arrivée étant déjà la
  // sortie calculée de cette image).
  let lastMode: FootMode | null = null
  let interpAlpha = 1 // ≥ 1 : pas d'interpolation en cours
  const snapshot = bones.map((b) => b.quaternion.clone()) // pose affichée à l'image précédente
  const displayed = bones.map((b) => b.quaternion.clone()) // tampon roulant post-solve

  return {
    hipsRest,
    legLength: legs[0].thigh + legs[0].shin,
    beforeMixer(): void {
      for (let i = 0; i < bones.length; i++) bones[i].quaternion.copy(base[i])
    },
    afterMixer(): void {
      for (let i = 0; i < bones.length; i++) base[i].copy(bones[i].quaternion)
    },
    stride(out): boolean {
      let low = Infinity
      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i]
        leg.ankle.updateWorldMatrix(true, false)
        leg.ankle.localToWorld(vTmp.copy(leg.sole))
        root.worldToLocal(vTmp)
        nowSole[i].copy(vTmp)
        if (vTmp.y < low) low = vTmp.y
      }
      let wx = 0
      let wz = 0
      let sum = 0
      for (let i = 0; i < legs.length; i++) {
        // Poids d'appui : plein pour le pied le plus bas, décroissant pour
        // l'autre selon son avance sur lui. Le mélange évite le à-coup du
        // changement d'appui, qu'un choix franc produirait à chaque foulée.
        const w = clamp(1 - (nowSole[i].y - low) / contactBand, 0, 1)
        if (prevValid && w > 0) {
          wx += (prevSole[i].x - nowSole[i].x) * w
          wz += (prevSole[i].z - nowSole[i].z) * w
          sum += w
        }
      }
      const had = prevValid && sum > 1e-6
      for (let i = 0; i < legs.length; i++) prevSole[i].copy(nowSole[i])
      prevValid = true
      if (!had) return false
      // Le sol défile à l'OPPOSÉ du pied qui le tient : c'est déjà le signe
      // ci-dessus (précédent − courant).
      out.x = wx / sum
      out.z = wz / sum
      return true
    },
    apply(mode, groundAt, dt): number {
      // Changement de régime : instantané de la pose affichée à l'image
      // précédente, et départ du fondu (AnimTwoBoneIK::beginInterp).
      if (lastMode !== null && mode !== lastMode) {
        for (let i = 0; i < bones.length; i++) snapshot[i].copy(displayed[i])
        interpAlpha = 0
        // le pole vector repart de zéro : son lissage appartenait à l'ancien régime
        for (const leg of legs) leg.prevPole = null
      }
      lastMode = mode
      let fixed = 0
      for (let i = 0; i < legs.length; i++) {
        const autorite = solveLeg(legs[i], mode, groundAt, dt)
        if (autorite > 0) fixed++
        // AUTORITÉ PARTIELLE (cf. `autoriteReach`) : le solveur a travaillé,
        // mais le sol n'est plus tout à fait à sa portée — on revient d'autant
        // vers la pose du CLIP, qui est la jambe telle que l'animateur l'a
        // posée. Les trois os de CETTE jambe seulement : l'autre peut très bien
        // atteindre le sol (un pied sur un barreau, l'autre dans le vide).
        if (autorite < 1) {
          for (let k = 0; k < 3; k++) {
            const b = 3 * i + k
            safeLerpQuat(base[b], bones[b].quaternion, autorite, bones[b].quaternion)
          }
        }
      }
      // Fondu anti-pop : de l'instantané vers la solution de CE régime,
      // ease-in expo (AnimTwoBoneIK.cpp:203-224). Le fondu s'applique aux
      // rotations LOCALES des six os de jambe — le corps, lui, continue de
      // bouger (le glissement d'assise est porté par le groupe, pas par l'IK).
      if (interpAlpha < 1) {
        interpAlpha += INTERP_ALPHA_VEL * dt
        if (interpAlpha < 1) {
          const a = easeInExpo(interpAlpha)
          for (let i = 0; i < bones.length; i++) {
            safeLerpQuat(snapshot[i], bones[i].quaternion, a, bones[i].quaternion)
          }
        }
      }
      // Tampon roulant : la pose réellement affichée, prête à devenir
      // l'instantané du prochain changement de régime.
      for (let i = 0; i < bones.length; i++) displayed[i].copy(bones[i].quaternion)
      return fixed
    },
  }
}

/**
 * Une jambe. Rend l'AUTORITÉ de la correction : 0 = pas touchée (la pose du
 * clip reste), 1 = solution du solveur, et entre les deux le mélange des deux
 * (cf. `autoriteReach`).
 *
 * Le pied n'est déplacé QUE verticalement : son x et son z restent ceux du clip,
 * qui possède la foulée — le déplacer latéralement ferait patiner le personnage.
 * La cible est donc la cheville courante, remontée (ou descendue) de l'écart
 * entre sa semelle et le sol réel. Le RÉGIME décide de la méthode (cf. l'en-tête
 * du fichier) : correction millimétrique dans le plan du clip debout, solveur
 * Overte complet avec pole vector assis.
 */
function solveLeg(
  leg: Leg,
  mode: FootMode,
  groundAt: (x: number, z: number) => number | null,
  dt: number,
): number {
  const { ankle } = leg

  ankle.updateWorldMatrix(true, false)
  ankle.getWorldPosition(vA)
  ankle.localToWorld(vSole.copy(leg.sole))
  const ground = groundAt(vSole.x, vSole.z)
  if (ground === null) return 0

  const dy = ground - vSole.y
  // Debout : on remonte un pied enfoncé, jamais on n'abaisse un pied en l'air.
  if (mode === 'planted' && dy <= 0) return 0
  if (Math.abs(dy) < IK_EPS) return 0
  if (mode === 'planted') return solvePlanted(leg, dy) ? 1 : 0
  const autorite = autoriteReach(leg, dy)
  if (autorite <= 0) return 0
  return solveReach(leg, dy, dt) ? autorite : 0
}

/**
 * CE QUE LE SOLVEUR ASSIS A LE DROIT DE DIRE, ET OÙ IL DOIT SE TAIRE.
 *
 * L'en-tête promettait qu'un sol hors de portée donnerait « exactement une jambe
 * qui pend ». MESURÉ, c'est faux : hors de portée, `midAngle` tombe à 0, la
 * jambe part TENDUE vers la cible, et la hanche l'oriente sur la ligne
 * hanche→cible. Le solveur jette alors TOUT ce que le clip disait de la jambe —
 * or c'est justement lui qui sait à quoi ressemble un corps assis haut : cuisses
 * posées sur l'assise, genoux au bord, mollets qui pendent.
 *
 * Ce que ça donnait, sur EtalonChibi (hanches 0,755 m) sur un pupitre
 * d'anime-classroom à 0,694 m (portée 1,24), world-sit-idle :
 *   · avance du genou hors de la corde hanche→cheville : 0,189 m → 0,005 m
 *     (les cuisses passent à la VERTICALE — la silhouette n'est plus assise) ;
 *   · les deux jambes tendues gardent le croisement de chevilles du clip (4 cm)
 *     mais perdent l'écart des genoux : les mollets se traversent.
 * À l'inverse, la pose du clip laissée telle quelle est JUSTE : genoux écartés,
 * chevilles croisées, pieds en l'air — c'est une personne assise sur une table.
 *
 * D'où la règle, la même que celle de `planted` (« on ne fait que remonter un
 * pied qui traverse ») transposée : L'IK NE PARLE QUE DE CE QU'ELLE PEUT
 * ATTEINDRE. L'autorité vaut 1 tant que la cible est franchement à portée, et
 * décroît linéairement jusqu'à 0 à l'extension maximale — le mélange se fait
 * vers la pose du clip, dans `apply`.
 *
 * LA BANDE vaut 10 % de la longueur de jambe, et ce n'est pas un réglage libre.
 * Balayée à 0 (coupure franche), 0,05, 0,10 et 0,20 sur quatre morphologies
 * (hanches 0,755 à 1,070 m) × sept hauteurs d'assise, en relevant les DEUX
 * grandeurs qui tirent en sens contraire — le pied qui flotte (ce que la bande
 * coûte) et l'écart entre les deux jambes (ce qu'elle rapporte) :
 *
 *  · sous une portée de 0,897, l'autorité vaut 1 : la sortie est identique à la
 *    coupure franche, AU BIT PRÈS. Ça couvre les chaises des décors livrés
 *    (portée 0,69 à 0,95 selon le modèle) — la bande ne leur retire rien ;
 *  · au-delà d'une portée de 1, la correction ne RAPPORTE rien : même à pleine
 *    autorité, le pied reste 26 à 33 cm au-dessus du sol (mesuré, Sakura et Holo
 *    sur les pupitres) — il n'y arrive pas, il ne fait que détruire l'assise.
 *    C'est exactement ce que la bande retire ;
 *  · entre les deux, elle échange au pire 1,8 cm de pied qui flotte contre 1 à
 *    5 cm d'écart entre les jambes ;
 *  · à 0,20 elle mordrait pour de bon : 8,1 cm de pied en l'air pour Sakura sur
 *    une assise à 0,55 m, 1,1 cm sur les chaises de japanese-classroom. Trop.
 */
const REACH_BAND = 0.1

function autoriteReach(leg: Leg, dy: number): number {
  leg.hip.getWorldPosition(vH)
  vT.copy(vA)
  vT.y += dy
  const portee = (leg.thigh + leg.shin) * MAX_EXTENSION
  return clamp((portee - vT.distanceTo(vH)) / (REACH_BAND * (leg.thigh + leg.shin)), 0, 1)
}

/** Régime debout — le code maison mesuré à 0,0 mm de glissement, conservé tel quel. */
function solvePlanted(leg: Leg, dy: number): boolean {
  const { hip, knee, ankle, thigh, shin } = leg

  // Orientation MONDE du pied telle que le clip l'a écrite : c'est elle qui dit
  // si le talon est posé ou la pointe levée. Elle sera rendue telle quelle à la
  // fin — sans ça le pied bascule avec le tibia, le défaut le plus voyant d'une
  // IK naïve.
  ankle.getWorldQuaternion(qFoot)

  hip.getWorldPosition(vH)
  knee.getWorldPosition(vK)
  vT.copy(vA)
  vT.y += dy

  vThigh.subVectors(vK, vH)
  vShin.subVectors(vA, vK)

  vDir.subVectors(vT, vH)
  const d = clamp(vDir.length(), Math.abs(thigh - shin) + 1e-4, (thigh + shin) * MAX_EXTENSION)
  if (!(d > 1e-6)) return false
  vDir.normalize()

  /**
   * Direction de REPLI du genou : la composante de la cuisse courante
   * perpendiculaire à (hanche → cible). C'est elle qui porte l'orientation du
   * genou voulue par l'animateur, et elle est perpendiculaire à `vDir` PAR
   * CONSTRUCTION — ce qui compte : faire tourner `vDir` autour d'un axe qui ne
   * lui est pas perpendiculaire décrit un cône et ouvre un angle PLUS PETIT que
   * demandé. Le piège est silencieux (l'erreur croît avec la correction : 0,2 mm
   * pour un pied à replacer de 4 cm, 1,7 cm pour un pied à replacer de 24 cm) et
   * c'est exactement ce qu'il a fallu mesurer pour le voir.
   */
  vBend.copy(vThigh).addScaledVector(vDir, -vThigh.dot(vDir))
  if (vBend.lengthSq() < 1e-10) {
    // Cuisse alignée sur la cible : le plan de flexion n'existe pas. Le genou
    // plie alors vers l'AVANT du corps, comme un genou.
    hip.getWorldQuaternion(qWorld)
    vTmp.copy(leg.repere.kneeForward).applyQuaternion(qWorld)
    vBend.copy(vTmp).addScaledVector(vDir, -vTmp.dot(vDir))
    if (vBend.lengthSq() < 1e-10) return false
  }
  vBend.normalize()

  // Loi des cosinus : angle à la hanche entre (hanche → cible) et la cuisse.
  const alpha = Math.acos(clamp((thigh * thigh + d * d - shin * shin) / (2 * thigh * d), -1, 1))

  // ── Cuisse ────────────────────────────────────────────────────────────────
  // Direction visée = cible tournée de α DANS le plan (cible, repli).
  vTmp.copy(vDir).multiplyScalar(Math.cos(alpha)).addScaledVector(vBend, Math.sin(alpha))
  vThigh.normalize()
  qDelta.setFromUnitVectors(vThigh, vTmp) // rotation MONDE à composer
  hip.getWorldQuaternion(qWorld).premultiply(qDelta) // rotation monde voulue
  if (hip.parent) hip.parent.getWorldQuaternion(qParent).invert()
  else qParent.identity()
  hip.quaternion.copy(qParent).multiply(qWorld)

  // ── Tibia ─────────────────────────────────────────────────────────────────
  knee.updateWorldMatrix(true, false)
  knee.getWorldPosition(vK)
  vTmp.subVectors(vT, vK)
  if (vTmp.lengthSq() > 1e-12) {
    vTmp.normalize()
    vShin.applyQuaternion(qDelta).normalize() // le tibia a suivi la cuisse
    qDelta.setFromUnitVectors(vShin, vTmp)
    knee.getWorldQuaternion(qWorld).premultiply(qDelta)
    if (knee.parent) knee.parent.getWorldQuaternion(qParent).invert()
    else qParent.identity()
    knee.quaternion.copy(qParent).multiply(qWorld)
  }

  // ── Pied : on lui rend son orientation monde d'origine ────────────────────
  ankle.updateWorldMatrix(true, false)
  if (ankle.parent) ankle.parent.getWorldQuaternion(qParent).invert()
  else qParent.identity()
  ankle.quaternion.copy(qParent).multiply(qFoot)
  return true
}

/**
 * Régime assis — le solveur d'Overte, porté : `AnimTwoBoneIK::evaluate`
 * (l'angle du genou par intersection cercle-cercle, la hanche par rotation du
 * bras de levier), `Rig::calculateKneePoleVector` (75 % cou-de-pied / 25 %
 * bassin), le lissage angulaire de `Rig::updateFeet` (15 % par image à
 * 60 i/s), et la contrainte de pole vector d'`AnimPoleVectorConstraint`
 * (rotation de la chaîne autour de l'axe hanche↔pied, avec ses cinq gardes).
 *
 * Deux écarts à l'original, tous deux documentés :
 *  - la compensation du pied de la contrainte de pole vector
 *    (`relTipRot = inv(mid) · inv(deltaRot) · tip`) est remplacée par la
 *    restauration finale de l'orientation MONDE du pied — même invariant
 *    (le pied garde exactement l'orientation cible), une écriture au lieu de
 *    deux ;
 *  - la cible n'est pas lue dans des variables de graphe (double indirection
 *    `endEffectorPositionVarVar`) : c'est la cheville du clip décalée
 *    verticalement vers le sol réel — le « ce qui manque chez eux » de la
 *    fiche, qui ne calculait jamais la cible depuis le sol.
 */
function solveReach(leg: Leg, dy: number, dt: number): boolean {
  const { hip, knee, ankle, thigh, shin } = leg

  // Orientation cible du pied = celle que le clip a écrite (targetPose.rot).
  ankle.getWorldQuaternion(qFoot)
  hip.getWorldPosition(vH)
  vT.copy(vA)
  vT.y += dy

  // ── Pole vector du genou (Rig::calculateKneePoleVector) ──────────────────
  // footForward = targetRot · localFootForward ; hipsForward = hipsRot · UNIT_Z.
  // La direction « du pied » est celle du COU-DE-PIED (51,39° de l'axe du
  // tibia), pas celle de la semelle — le réglage empirique d'origine.
  vTmp.copy(leg.repere.footForward).applyQuaternion(qFoot)
  if (leg.hips) leg.hips.getWorldQuaternion(qTmp)
  else if (hip.parent) hip.parent.getWorldQuaternion(qTmp)
  else qTmp.identity()
  vTmp2.copy(leg.repere.hipsForward).applyQuaternion(qTmp)
  // lerp(hipsForward, footForward, 0.75) puis normalisation
  vPole.copy(vTmp2).addScaledVector(vTmp.sub(vTmp2), KNEE_POLE_BLEND).normalize()
  // Lissage ANGULAIRE (Rig::updateFeet) : la rotation entre l'ancien vecteur
  // et le nouveau, dont on n'applique que 15 % par image à 60 i/s —
  // safeMix(deltaRot, IDENTITÉ, 0,85^(60·dt)) rend le facteur indépendant du
  // framerate, comme la fiche le prescrit.
  if (leg.prevPole === null) leg.prevPole = vPole.clone()
  else {
    qTmp.setFromUnitVectors(leg.prevPole, vPole)
    safeMixQuat(qTmp, IDENTITY_Q, Math.pow(POLE_KEEP_PER_FRAME, 60 * dt), qTmp)
    leg.prevPole.applyQuaternion(qTmp).normalize()
  }
  vPole.copy(leg.prevPole)

  // ── Genou : intersection cercle-cercle (AnimTwoBoneIK.cpp:138-158) ───────
  vDir.subVectors(vT, vH)
  const d = vDir.length()
  let midAngle = 0
  if (d < thigh + shin && d > 0 && thigh > 0 && shin > 0) {
    // y est la demi-corde de l'intersection des deux cercles ; la valeur
    // absolue et les deux clamps encaissent les arrondis jambe presque tendue.
    const y =
      Math.sqrt(Math.abs((-d + shin - thigh) * (-d - shin + thigh) * (-d + shin + thigh) * (d + shin + thigh))) /
      (2 * d)
    midAngle = Math.PI - (Math.acos(clamp(y / thigh, -1, 1)) + Math.acos(clamp(y / shin, -1, 1)))
  }
  // Cible hors de portée : midAngle reste 0 et la jambe part TENDUE. Ce cas ne
  // se présente plus qu'en bordure de bande — au-delà, `autoriteReach` a déjà
  // rendu la jambe au clip — mais la garde reste : c'est elle qui évite le NaN.
  // Le genou devient une CHARNIÈRE PURE (relMidRot = angleAxis(midAngle, axe)) :
  // il satisfait la table de jointLimits par construction.
  knee.quaternion.setFromAxisAngle(leg.repere.kneeHinge, midAngle)

  // ── Hanche : le bras de levier sur la ligne de cible (lignes 165-186) ────
  ankle.updateWorldMatrix(true, false)
  ankle.getWorldPosition(vTmp) // newTipPose
  vThigh.subVectors(vTmp, vH) // leverArm
  vBend.crossVectors(vThigh, vDir)
  if (vBend.length() > MIN_AXIS_LENGTH) {
    vBend.normalize()
    const lever = vThigh.length()
    const line = vDir.length()
    if (lever > 1e-9 && line > 1e-9) {
      const cosAngle = clamp(vThigh.dot(vDir) / (lever * line), -1, 1)
      qDelta.setFromAxisAngle(vBend, Math.acos(cosAngle))
      hip.getWorldQuaternion(qWorld).premultiply(qDelta)
      if (hip.parent) hip.parent.getWorldQuaternion(qParent).invert()
      else qParent.identity()
      hip.quaternion.copy(qParent).multiply(qWorld)
    }
  }

  // ── Pole vector : tourner la chaîne autour de l'axe hanche↔pied ──────────
  // (AnimPoleVectorConstraint.cpp:40-166, avec ses cinq gardes.)
  knee.updateWorldMatrix(true, false)
  knee.getWorldQuaternion(qTmp)
  vShin.copy(leg.repere.kneeForward).applyQuaternion(qTmp) // refVector : le devant du genou
  ankle.updateWorldMatrix(true, false)
  ankle.getWorldPosition(vTmp)
  vTmp2.subVectors(vH, vTmp) // NOTE : hanche − pied, comme l'original
  const axisLen = vTmp2.length()
  if (axisLen > MIN_AXIS_LENGTH && vShin.lengthSq() > MIN_AXIS_LENGTH * MIN_AXIS_LENGTH) {
    vTmp2.multiplyScalar(1 / axisLen) // unitAxis
    vK.crossVectors(vTmp2, vShin) // sideVector
    // projections ⊥ à l'axe
    vShin.addScaledVector(vTmp2, -vShin.dot(vTmp2)) // refVectorProj
    vTmp.copy(vPole).addScaledVector(vTmp2, -vPole.dot(vTmp2)) // poleVectorProj
    if (
      vK.length() > MIN_AXIS_LENGTH &&
      vShin.length() > MIN_AXIS_LENGTH &&
      vTmp.length() > MIN_AXIS_LENGTH
    ) {
      const dot = clamp(vShin.normalize().dot(vTmp.normalize()), -1, 1)
      const sideDot = vPole.dot(vK)
      const theta = Math.sign(sideDot) * Math.acos(dot) // de quel côté tourner
      qDelta.setFromAxisAngle(vTmp2, theta)
      hip.getWorldQuaternion(qWorld).premultiply(qDelta)
      if (hip.parent) hip.parent.getWorldQuaternion(qParent).invert()
      else qParent.identity()
      hip.quaternion.copy(qParent).multiply(qWorld)
    }
  }

  // ── Pied : orientation cible EXACTE (relTipRot = inv(mid) · targetRot) ───
  ankle.updateWorldMatrix(true, false)
  if (ankle.parent) ankle.parent.getWorldQuaternion(qParent).invert()
  else qParent.identity()
  ankle.quaternion.copy(qParent).multiply(qFoot)
  return true
}
