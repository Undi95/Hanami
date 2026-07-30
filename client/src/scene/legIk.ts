// Cinématique inverse des jambes — LE cœur du moteur physique.
//
// Le clip donne l'allure, l'IK corrige l'assiette. C'est ce qui fait tomber la
// question « ce meuble est-il compatible avec ce modèle » : un lit à 51 cm et une
// chaise à 43 cm deviennent tous deux utilisables, parce que la jambe s'adapte au
// lieu que la hauteur d'assise soit imposée par l'animation.
//
// LE CHIFFRE QUI JUSTIFIE CE FICHIER (mesuré sur les 12 modèles de vrm/, point
// « semelle » suivi image par image dans le repère du pied, sol du clip à y = 0) :
//   • idle             — le pied traverse le sol de 1 à 4,5 mm  → invisible
//   • world-walk       — de 16 à 22 mm                          → visible de près
//   • world-walk-slow  — de 21 à 33 mm                          → VISIBLE
//   • world-sit-idle   — de 37 à 62 mm                          → très visible
// Sans IK, chaque modèle s'enfonce différemment : la correction ne peut pas être
// une constante, elle doit être calculée sur le modèle chargé, à chaque image.
//
// Méthode : IK deux-os par la loi des cosinus, dans le plan de flexion COURANT de
// la jambe — donc l'orientation du genou vient de l'animation, pas d'une règle.
// Aucune dépendance ajoutée : une soixantaine de lignes de géométrie.
import { Quaternion, Vector3 } from 'three'
import type { Object3D } from 'three'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'

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
   * Assis : le pied VISE le sol, dans les deux sens. Siège bas → le genou se
   * replie ; siège haut → la jambe se tend d'elle-même vers un sol hors de
   * portée, et c'est exactement une jambe qui pend.
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
}

export interface LegIk {
  /** À appeler AVANT mixer.update : rend aux jambes la pose que le clip leur avait donnée. */
  beforeMixer(): void
  /** À appeler APRÈS mixer.update : mémorise la pose du clip, avant correction. */
  afterMixer(): void
  /**
   * Corrige les deux jambes. `groundAt` rend l'altitude du sol sous un point du
   * monde (null = sol inconnu : la jambe est laissée telle quelle).
   * Rend le nombre de jambes effectivement corrigées — c'est par lui que les
   * bancs d'essai vérifient que l'IK fait bien quelque chose.
   */
  apply(mode: FootMode, groundAt: (x: number, z: number) => number | null): number
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
const qDelta = new Quaternion()
const qWorld = new Quaternion()
const qParent = new Quaternion()
const qFoot = new Quaternion()

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
export function createLegIk(vrm: VRM): LegIk | null {
  const node = (name: string): Object3D | null =>
    vrm.humanoid.getNormalizedBoneNode(name as VRMHumanBoneName)
  const legs: Leg[] = []
  const bones: Object3D[] = []

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
    legs.push({ hip, knee, ankle, thigh, shin, sole })
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

  return {
    hipsRest,
    legLength: legs[0].thigh + legs[0].shin,
    beforeMixer(): void {
      for (let i = 0; i < bones.length; i++) bones[i].quaternion.copy(base[i])
    },
    afterMixer(): void {
      for (let i = 0; i < bones.length; i++) base[i].copy(bones[i].quaternion)
    },
    apply(mode, groundAt): number {
      let fixed = 0
      for (const leg of legs) if (solveLeg(leg, mode, groundAt)) fixed++
      return fixed
    },
  }
}

/**
 * Une jambe. Rend `true` si elle a été corrigée.
 *
 * Le pied n'est déplacé QUE verticalement : son x et son z restent ceux du clip,
 * qui possède la foulée — le déplacer latéralement ferait patiner le personnage.
 * La cible est donc la cheville courante, remontée (ou descendue) de l'écart
 * entre sa semelle et le sol réel.
 */
function solveLeg(
  leg: Leg,
  mode: FootMode,
  groundAt: (x: number, z: number) => number | null,
): boolean {
  const { hip, knee, ankle, thigh, shin } = leg

  ankle.updateWorldMatrix(true, false)
  ankle.getWorldPosition(vA)
  ankle.localToWorld(vSole.copy(leg.sole))
  const ground = groundAt(vSole.x, vSole.z)
  if (ground === null) return false

  const dy = ground - vSole.y
  // Debout : on remonte un pied enfoncé, jamais on n'abaisse un pied en l'air.
  if (mode === 'planted' && dy <= 0) return false
  if (Math.abs(dy) < IK_EPS) return false

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
    vTmp.copy(KNEE_FORWARD).applyQuaternion(qWorld)
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
