// Animation d'idle de l'avatar : respiration, clignement, émotions, lipsync.
// Principe clé : les offsets sont recalculés à chaque frame et appliqués
// PAR-DESSUS la pose de base mémorisée (base + offset) — jamais de cumul,
// donc aucune dérive possible.
import type { Euler, Object3D } from 'three'
import type { VRM, VRMExpressionManager, VRMExpressionOverrideType, VRMHumanBoneName } from '@pixiv/three-vrm'
import type { Emotion } from '../../../shared/types'
import { EMOTION_EXPRESSIONS } from './emotionMap'
import type { CanonicalExpression, EmotionExpression, ExpressionTable } from './emotionMap'

/** Os + pose de base (Euler) mémorisée juste après la pose anti T-pose. */
export interface PosedBone {
  node: Object3D
  base: Euler
}

const TWO_PI = Math.PI * 2
const BREATH_HZ = 0.28 // fréquence de respiration
const BLINK_DURATION = 0.12 // s — enveloppe fermeture + ouverture
const EMOTION_FADE = 0.4 // s — transition douce entre émotions
const EMOTION_HOLD = 10 // s sans nouvelle émotion → retour progressif au neutre
const MOUTH_DECAY = 0.15 // s — retombée de la bouche quand le speaking s'arrête
// Pendant qu'on parle, le poids des émotions (donc leur forme de bouche —
// coins relevés d'un sourire, etc.) est réduit à ce facteur : la forme reste
// nettement visible, mais laisse la place au lip-sync par-dessus plutôt que
// de saturer les mêmes blendshapes de bouche à pleine intensité côte à côte
// (l'addition des deux à 100% donne une bouche disproportionnée). Pur
// réglage visuel — les yeux/joues de l'émotion suivent la même atténuation,
// faute de pouvoir isoler la seule composante bouche d'un blendshape composite.
const SPEAKING_EMOTION_FACTOR = 0.55
const MOUTH_BLEND_FADE = 0.25 // s — transition douce de cette atténuation, pas de saccade

/** Avance `value` vers `target` d'au plus `maxDelta`, sans dépassement. */
function moveTowards(value: number, target: number, maxDelta: number): number {
  const d = target - value
  if (Math.abs(d) <= maxDelta) return target
  return value + Math.sign(d) * maxDelta
}

export class IdleAnimator {
  private t = 0

  // Clignement
  private nextBlinkAt = 1 + Math.random() * 3
  private blinkElapsed = -1 // < 0 : pas de clignement en cours
  private doubleBlink = false
  /**
   * Étirement de la durée du clignement en cours : 1 = normal, 2 = demi-vitesse.
   * Le clignement de RETARGETAGE du regard (cf. gaze.ts, porté de Head.cpp:128
   * d'Overte) est joué à demi-vitesse — c'est pendant qu'il est fermé que la
   * cible du regard se déplace, et il faut laisser le temps au déplacement.
   */
  private blinkScale = 1

  // Émotion
  private emotion: Emotion = 'neutral'
  private emotionSetAt = 0
  private weights: Record<EmotionExpression, number> = {
    happy: 0,
    sad: 0,
    angry: 0,
    surprised: 0,
    relaxed: 0,
  }

  // Lipsync
  private speaking = false
  // Atténuation courante du poids des émotions pendant la parole (1 = poids
  // plein, SPEAKING_EMOTION_FACTOR = pleinement en train de parler) — sa
  // propre transition douce, indépendante de celle de l'émotion elle-même.
  private mouthBlend = 1
  private mouth = 0
  private mouthPhase = 0 // 0..1, un cycle = une "syllabe"
  private mouthFreq = 9 // Hz, retiré au hasard à chaque cycle (8–10)
  private mouthAmp = 0.4 // amplitude, retirée à chaque cycle (0.15–0.7)
  // overrideMouth (VRM 1.0) d'origine de chaque expression d'émotion (nom résolu),
  // pour la restaurer telle quelle une fois la parole retombée — cf. applyMouthPriority.
  private originalOverrideMouth = new Map<string, VRMExpressionOverrideType>()
  // État déjà appliqué par applyMouthPriority (cf. son commentaire) — permet
  // de ne refaire le travail qu'aux deux frames de transition de `speaking`.
  private mouthPriorityApplied = false

  // Table nom canonique → nom disponible sur le modèle (résolue au chargement
  // par vrmStage). Expression absente = no-op silencieux, sans warn par frame.
  private expressions: ExpressionTable = new Map()

  setEmotion(emotion: Emotion): void {
    this.emotion = emotion
    this.emotionSetAt = this.t
  }

  /** Table de résolution des expressions du modèle courant (cf. emotionMap). */
  setExpressionTable(table: ExpressionTable): void {
    this.expressions = table
  }

  setSpeaking(speaking: boolean): void {
    if (speaking && !this.speaking) this.mouthPhase = 0 // départ bouche fermée
    this.speaking = speaking
  }

  // ── Prises offertes au regard (gaze.ts) — l'idle reste maître du clignement ──

  /**
   * Enveloppe BRUTE du clignement en cours (0 ouvert → 1 fermé → 0), avant
   * l'atténuation par l'émotion. C'est le signal de synchronisation du
   * retargetage du regard : « la cible ne se déplace que pendant que l'œil est
   * fermé » (Head::setLookAtPosition, Overte).
   */
  blinkAmount(): number {
    if (this.blinkElapsed < 0) return 0
    const p = this.blinkElapsed / (BLINK_DURATION * this.blinkScale)
    if (p >= 1) return 0
    const v = p < 0.5 ? p * 2 : (1 - p) * 2
    return Math.min(1, Math.max(0, v))
  }

  /**
   * Déclenche un clignement maintenant, si aucun n'est en cours. `slow` : joué
   * à demi-vitesse (le clignement de retargetage du regard). Sans effet
   * pendant un clignement — le regard réessaie à l'image suivante.
   */
  requestBlink(slow = false): void {
    if (this.blinkElapsed >= 0) return
    this.blinkElapsed = 0
    this.blinkScale = slow ? 2 : 1
  }

  /**
   * Une émotion tient le visage — règle d'Overte : « pendant une émotion, on
   * coupe l'IK de tête ». Lu par le regard à chaque image.
   */
  emotionActive(): boolean {
    if (this.emotion !== 'neutral') return true
    for (const name of EMOTION_EXPRESSIONS) if (this.weights[name] > 0.05) return true
    return false
  }

  /** À appeler au chargement d'un nouveau modèle : repart d'un visage neutre. */
  reset(): void {
    this.blinkElapsed = -1
    this.blinkScale = 1
    this.doubleBlink = false
    this.nextBlinkAt = this.t + 1 + Math.random() * 3
    this.mouth = 0
    this.mouthPhase = 0
    this.mouthBlend = 1
    for (const name of EMOTION_EXPRESSIONS) this.weights[name] = 0
    // Nouveau modèle = nouvelles instances VRMExpression : un nom résolu
    // identique à l'ancien modèle ne doit pas hériter de SON overrideMouth.
    this.originalOverrideMouth.clear()
    this.mouthPriorityApplied = false
  }

  /** Une frame d'idle. `bones` : poses de base mémorisées par vrmStage. */
  update(dt: number, vrm: VRM | null, bones: ReadonlyMap<VRMHumanBoneName, PosedBone>): void {
    this.t += dt
    this.updateBones(bones)
    const manager = vrm?.expressionManager
    if (!manager) return // pas de modèle, ou modèle sans expressions : os seulement
    // Atténuation liée à la parole calculée avant l'émotion : updateEmotion
    // l'applique au poids qu'elle pose cette frame.
    this.updateMouthBlend(dt)
    // Émotion d'abord : le clignement atténue selon les poids de CETTE frame.
    this.updateEmotion(manager, dt)
    this.updateBlink(manager, dt)
    this.updateMouth(manager, dt)
    this.applyMouthPriority(manager)
  }

  /** setValue via la table de résolution ; expression non résolue = no-op. */
  private setExpr(manager: VRMExpressionManager, name: CanonicalExpression, value: number): void {
    const resolved = this.expressions.get(name)
    if (resolved !== undefined) manager.setValue(resolved, value)
  }

  // Poids oculaire courant : ces émotions ferment ou plissent les paupières ;
  // un clignement plein par-dessus fait clipper les VRM 0.x sans overrideBlink.
  private ocularWeight(): number {
    const w = this.weights
    return Math.max(w.happy, w.relaxed, w.angry, w.sad)
  }

  // ── Respiration + sway ───────────────────────────────────────────────────

  private updateBones(bones: ReadonlyMap<VRMHumanBoneName, PosedBone>): void {
    const t = this.t
    const breath = Math.sin(TWO_PI * BREATH_HZ * t)
    for (const [name, { node, base }] of bones) {
      let ox = 0
      let oz = 0
      switch (name) {
        case 'chest':
          ox = breath * 0.012
          break
        case 'upperChest':
          ox = breath * 0.006
          break
        case 'spine':
          ox = Math.sin(TWO_PI * BREATH_HZ * t - 0.6) * 0.008
          break
        case 'neck':
          oz = Math.sin(TWO_PI * 0.06 * t + 0.5) * 0.008
          break
        case 'head':
          // Sway lent de la tête, léger et apériodique (deux fréquences).
          ox = Math.sin(TWO_PI * 0.09 * t + 1.7) * 0.01
          oz = Math.sin(TWO_PI * 0.06 * t) * 0.02
          break
        default:
          break // bras : pose de repos seule, aucun offset
      }
      node.rotation.set(base.x + ox, base.y, base.z + oz)
    }
  }

  // ── Clignement ───────────────────────────────────────────────────────────

  private updateBlink(manager: VRMExpressionManager, dt: number): void {
    if (this.blinkElapsed >= 0) {
      this.blinkElapsed += dt
      const p = this.blinkElapsed / (BLINK_DURATION * this.blinkScale)
      if (p >= 1) {
        this.setExpr(manager, 'blink', 0)
        this.blinkElapsed = -1
        this.blinkScale = 1
        if (this.doubleBlink) {
          this.doubleBlink = false
          this.nextBlinkAt = this.t + 0.15 // second clignement rapproché
        } else {
          this.nextBlinkAt = this.t + 2 + Math.random() * 4
        }
      } else {
        const v = p < 0.5 ? p * 2 : (1 - p) * 2
        // Atténué par le poids oculaire de l'émotion (sinon les paupières
        // clippent sur les VRM 0.x sans overrideBlink). Émotion neutre : ×1.
        const damped = Math.min(1, Math.max(0, v)) * (1 - this.ocularWeight())
        this.setExpr(manager, 'blink', damped)
      }
    } else if (this.t >= this.nextBlinkAt) {
      if (this.ocularWeight() > 0.5) {
        // Yeux déjà très pilotés par l'émotion : on reporte le clignement.
        this.nextBlinkAt = this.t + 1 + Math.random() * 2
      } else {
        this.blinkElapsed = 0
        if (!this.doubleBlink) this.doubleBlink = Math.random() < 0.2
      }
    }
  }

  // ── Émotion (poids cibles + interpolation douce) ─────────────────────────

  /** Transition douce de l'atténuation « parole » — cf. SPEAKING_EMOTION_FACTOR. */
  private updateMouthBlend(dt: number): void {
    const target = this.speaking ? SPEAKING_EMOTION_FACTOR : 1
    this.mouthBlend = moveTowards(this.mouthBlend, target, dt / MOUTH_BLEND_FADE)
  }

  private updateEmotion(manager: VRMExpressionManager, dt: number): void {
    if (this.emotion !== 'neutral' && this.t - this.emotionSetAt > EMOTION_HOLD) {
      this.emotion = 'neutral' // retour progressif au neutre (le fade fait le reste)
    }
    const step = dt / EMOTION_FADE
    for (const name of EMOTION_EXPRESSIONS) {
      const target = name === this.emotion ? 1 : 0
      this.weights[name] = moveTowards(this.weights[name], target, step)
      // Poids RÉEL du modèle atténué par mouthBlend (cf. SPEAKING_EMOTION_FACTOR) :
      // le poids « conceptuel » (this.weights, lu par emotionActive/ocularWeight)
      // reste intact, seul ce qui est posé sur le mesh est réduit pendant la parole.
      this.setExpr(manager, name, this.weights[name] * this.mouthBlend)
    }
  }

  // ── Lipsync (pseudo-aléatoire 8–10 Hz sur "aa") ──────────────────────────

  private updateMouth(manager: VRMExpressionManager, dt: number): void {
    if (this.speaking) {
      this.mouthPhase += dt * this.mouthFreq
      if (this.mouthPhase >= 1) {
        this.mouthPhase %= 1
        this.mouthFreq = 8 + Math.random() * 2
        this.mouthAmp = 0.15 + Math.random() * 0.55
      }
      // Un cycle 0→1 : bouche fermée → ouverte → fermée (cosinus lissé).
      this.mouth = this.mouthAmp * (0.5 - 0.5 * Math.cos(TWO_PI * this.mouthPhase))
    } else if (this.mouth > 0) {
      this.mouth = moveTowards(this.mouth, 0, dt / MOUTH_DECAY)
    }
    this.setExpr(manager, 'aa', this.mouth)
  }

  // ── Priorité du lipsync sur les émotions ─────────────────────────────────
  // Le spec VRM 1.0 laisse une expression déclarer overrideMouth ('block' ou
  // 'blend') : le VRMExpressionManager multiplie ALORS le poids de "aa" (et des
  // autres visèmes) par (1 - le poids de cette expression) AU MOMENT de
  // vrm.update() — après que cette classe ait posé une bouche qui parle
  // correctement. C'est réglé par défaut sur "happy" (et souvent les autres
  // émotions) par la plupart des exporteurs VRM 1.0 : bouche coupée pendant un
  // grand sourire, quel que soit ce que "aa" vaut. Pendant qu'on parle, le
  // lipsync doit gagner : on neutralise l'override des émotions actives, et on
  // restaure leur valeur d'origine dès que la parole s'arrête (elle ne change
  // alors plus rien, "aa" étant retombé à 0, mais ça laisse le modèle intact
  // pour toute expression jouée hors parole).
  //
  // Effet de bord SUR TRANSITION seulement (mouthPriorityApplied) : la table
  // de résolution (this.expressions) est figée au chargement du modèle, donc
  // neutraliser/restaurer overrideMouth ne change de résultat qu'aux instants
  // où `speaking` bascule — le refaire à chaque frame (60×/s, y compris
  // pendant toute la durée d'une réponse parlée) ne faisait que réécrire la
  // même valeur. Mesuré : ~10 lookups + écritures évités par frame en dehors
  // des deux frames de transition.
  private applyMouthPriority(manager: VRMExpressionManager): void {
    if (this.speaking === this.mouthPriorityApplied) return
    this.mouthPriorityApplied = this.speaking
    for (const name of EMOTION_EXPRESSIONS) {
      const resolved = this.expressions.get(name)
      if (resolved === undefined) continue
      const expr = manager.getExpression(resolved)
      if (!expr) continue
      if (this.speaking) {
        if (!this.originalOverrideMouth.has(resolved)) {
          this.originalOverrideMouth.set(resolved, expr.overrideMouth)
        }
        expr.overrideMouth = 'none'
      } else {
        const original = this.originalOverrideMouth.get(resolved)
        if (original !== undefined) expr.overrideMouth = original
      }
    }
  }
}
