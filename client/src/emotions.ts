// Détection/nettoyage des tags d'émotion ([happy] etc.) dans les messages.
import { EMOTIONS, type Emotion } from '../../shared/types'

// \s* : les modèles écrivent parfois « [ happy ] » avec des espaces.
const FIRST_TAG = new RegExp(`\\[\\s*(${EMOTIONS.join('|')})\\s*\\]`, 'i')
const ALL_TAGS = new RegExp(`\\[\\s*(${EMOTIONS.join('|')})\\s*\\]`, 'gi')

/** Première occurrence d'un tag d'émotion dans le texte (null si aucun). */
export function extractEmotion(text: string): Emotion | null {
  const m = FIRST_TAG.exec(text)
  return m ? (m[1].toLowerCase() as Emotion) : null
}

/** Retire TOUS les tags d'émotion pour l'affichage (le texte stocké reste intégral). */
export function stripEmotionTags(text: string): string {
  return text.replace(ALL_TAGS, '').replace(/^[ \t]+/, '')
}
