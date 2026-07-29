// Normalisation des tags d'émotion et mapping vers les expressions VRM.
import type { VRMExpressionManager } from '@pixiv/three-vrm'
import { EMOTIONS, type Emotion } from '../../../shared/types'

/**
 * Expressions VRM pilotées par l'émotion courante (presets VRM 1.0 : les mêmes
 * noms que nos émotions, `neutral` = tous les poids à zéro).
 */
export const EMOTION_EXPRESSIONS = ['happy', 'sad', 'angry', 'surprised', 'relaxed'] as const
export type EmotionExpression = (typeof EMOTION_EXPRESSIONS)[number]

/**
 * Expressions canoniques utilisées par l'idle : les émotions ci-dessus, plus
 * le lipsync ("aa") et le clignement ("blink").
 */
export const CANONICAL_EXPRESSIONS = [...EMOTION_EXPRESSIONS, 'aa', 'blink'] as const
export type CanonicalExpression = (typeof CANONICAL_EXPRESSIONS)[number]

/**
 * Table nom canonique → nom réellement disponible sur le modèle chargé.
 * Une expression absente de la table n'est simplement pas pilotée (no-op).
 */
export type ExpressionTable = ReadonlyMap<CanonicalExpression, string>

/**
 * Sonde l'expressionManager du modèle et résout chaque expression canonique
 * vers un nom disponible : match exact d'abord (presets + customs), puis
 * insensible à la casse sur les customs (ex. VRM 0.x sans preset "surprised"
 * mais avec un blendshape custom "Surprised").
 * console.warn une seule fois (au chargement) par expression non résolue.
 */
export function resolveExpressions(
  manager: VRMExpressionManager | null | undefined,
): ExpressionTable {
  const table = new Map<CanonicalExpression, string>()
  if (!manager) {
    console.warn('[vrm] model has no expressionManager — facial expressions disabled')
    return table
  }
  const exact = manager.expressionMap // presets + customs, par nom
  const customNames = Object.keys(manager.customExpressionMap)
  for (const canonical of CANONICAL_EXPRESSIONS) {
    if (exact[canonical] !== undefined) {
      table.set(canonical, canonical)
      continue
    }
    const custom = customNames.find((n) => n.toLowerCase() === canonical.toLowerCase())
    if (custom !== undefined) {
      table.set(canonical, custom)
      continue
    }
    console.warn(`[vrm] expression "${canonical}" not found on this model — it will be ignored`)
  }
  return table
}

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
