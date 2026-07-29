// Normalisation des tags d'émotion et mapping vers les expressions VRM.
import { EMOTIONS, type Emotion } from '../../../shared/types'

/**
 * Expressions VRM pilotées par l'émotion courante (presets VRM 1.0 : les mêmes
 * noms que nos émotions, `neutral` = tous les poids à zéro).
 */
export const EMOTION_EXPRESSIONS = ['happy', 'sad', 'angry', 'surprised', 'relaxed'] as const
export type EmotionExpression = (typeof EMOTION_EXPRESSIONS)[number]

/** Normalise un tag d'émotion ("[Happy]", "HAPPY ", "sad") ; inconnu → neutral. */
export function normalizeEmotion(tag: string): Emotion {
  const clean = tag
    .trim()
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .trim()
  return (EMOTIONS as readonly string[]).includes(clean) ? (clean as Emotion) : 'neutral'
}
