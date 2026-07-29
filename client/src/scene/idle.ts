// Animation d'idle de l'avatar : respiration, clignement, émotions, lipsync.
// Principe clé : les offsets sont recalculés à chaque frame et appliqués
// PAR-DESSUS la pose de base mémorisée (base + offset) — jamais de cumul,
// donc aucune dérive possible.
import type { Euler, Object3D } from 'three'
import type { VRM, VRMExpressionManager, VRMHumanBoneName } from '@pixiv/three-vrm'
import type { Emotion } from '../../../shared/types'
import { EMOTION_EXPRESSIONS } from './emotionMap'
import type { EmotionExpression } from './emotionMap'

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
  private mouth = 0
  private mouthPhase = 0 // 0..1, un cycle = une "syllabe"
  private mouthFreq = 9 // Hz, retiré au hasard à chaque cycle (8–10)
  private mouthAmp = 0.4 // amplitude, retirée à chaque cycle (0.15–0.7)

  setEmotion(emotion: Emotion): void {
    this.emotion = emotion
    this.emotionSetAt = this.t
  }

  setSpeaking(speaking: boolean): void {
    if (speaking && !this.speaking) this.mouthPhase = 0 // départ bouche fermée
    this.speaking = speaking
  }

  /** À appeler au chargement d'un nouveau modèle : repart d'un visage neutre. */
  reset(): void {
    this.blinkElapsed = -1
    this.doubleBlink = false
    this.nextBlinkAt = this.t + 1 + Math.random() * 3
    this.mouth = 0
    this.mouthPhase = 0
    for (const name of EMOTION_EXPRESSIONS) this.weights[name] = 0
  }

  /** Une frame d'idle. `bones` : poses de base mémorisées par vrmStage. */
  update(dt: number, vrm: VRM | null, bones: ReadonlyMap<VRMHumanBoneName, PosedBone>): void {
    this.t += dt
    this.updateBones(bones)
    const manager = vrm?.expressionManager
    if (!manager) return // pas de modèle, ou modèle sans expressions : os seulement
    this.updateBlink(manager, dt)
    this.updateEmotion(manager, dt)
    this.updateMouth(manager, dt)
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
      const p = this.blinkElapsed / BLINK_DURATION
      if (p >= 1) {
        manager.setValue('blink', 0)
        this.blinkElapsed = -1
        if (this.doubleBlink) {
          this.doubleBlink = false
          this.nextBlinkAt = this.t + 0.15 // second clignement rapproché
        } else {
          this.nextBlinkAt = this.t + 2 + Math.random() * 4
        }
      } else {
        const v = p < 0.5 ? p * 2 : (1 - p) * 2
        manager.setValue('blink', Math.min(1, Math.max(0, v)))
      }
    } else if (this.t >= this.nextBlinkAt) {
      this.blinkElapsed = 0
      if (!this.doubleBlink) this.doubleBlink = Math.random() < 0.2
    }
  }

  // ── Émotion (poids cibles + interpolation douce) ─────────────────────────

  private updateEmotion(manager: VRMExpressionManager, dt: number): void {
    if (this.emotion !== 'neutral' && this.t - this.emotionSetAt > EMOTION_HOLD) {
      this.emotion = 'neutral' // retour progressif au neutre (le fade fait le reste)
    }
    const step = dt / EMOTION_FADE
    for (const name of EMOTION_EXPRESSIONS) {
      const target = name === this.emotion ? 1 : 0
      this.weights[name] = moveTowards(this.weights[name], target, step)
      manager.setValue(name, this.weights[name])
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
    manager.setValue('aa', this.mouth)
  }
}
