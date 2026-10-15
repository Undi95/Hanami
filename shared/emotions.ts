// Tags d'émotion — LA règle commune, importée par le client (client/src/emotions.ts)
// ET par le serveur (api/chat.ts, lib/spontaneous.ts, lib/storage.ts pour le prompt
// par défaut). Le motif était écrit à la main dans les deux fichiers du serveur : une
// septième émotion ajoutée à EMOTIONS aurait été comprise du client et ignorée du
// serveur, qui aurait sauvegardé des messages sans `emotion` — l'avatar restant figé
// à la réouverture de la conversation, sans rien dans les journaux.
import { EMOTIONS, type Emotion } from './types'

/**
 * Motif d'un tag d'émotion, CONSTRUIT depuis EMOTIONS : « [happy] », « [ Happy ] »,
 * « [HAPPY] ». Non ancré — première occurrence n'importe où. `\s*` : les modèles
 * écrivent parfois « [ happy ] ». Insensible à la casse (drapeau `i` par défaut).
 *
 * Une FABRIQUE, et non une constante partagée : un motif global (`g`) porte un
 * `lastIndex` mutable, et deux appelants qui se le partageraient finiraient par
 * sauter des occurrences selon l'ordre des appels.
 */
export function emotionTagRe(flags = 'i'): RegExp {
  // Jamais un lien Markdown : « [content](url) » garde son libellé.
  return new RegExp(`\\[\\s*(${[...EMOTIONS, ...Object.keys(EMOTION_ALIASES)].join('|')})\\s*\\](?![(\\[])`, flags)
}

/**
 * Les tags que les modèles INVENTENT, ramenés aux six du contrat. Trouvé au
 * test complet : « [smile] » en tête de réponse — reconnu par aucun motif, le
 * visage restait neutre. Seuls des synonymes francs : un tag ambigu reste
 * inconnu (retiré de l'affichage, visage inchangé) plutôt que mal lu.
 * JAMAIS « laugh » ni « think » : ce sont des balises de GESTE (shared/gestures.ts).
 */
export const EMOTION_ALIASES: Record<string, Emotion> = {
  smile: 'happy', smiling: 'happy', grin: 'happy', joy: 'happy', joyful: 'happy',
  cheerful: 'happy', excited: 'happy', glad: 'happy', delighted: 'happy',
  sadness: 'sad', unhappy: 'sad', crying: 'sad', upset: 'sad', sorrow: 'sad', hurt: 'sad',
  mad: 'angry', annoyed: 'angry', furious: 'angry', irritated: 'angry', frustrated: 'angry',
  surprise: 'surprised', shocked: 'surprised', astonished: 'surprised', amazed: 'surprised',
  calm: 'relaxed', peaceful: 'relaxed', serene: 'relaxed', content: 'relaxed', relieved: 'relaxed',
  normal: 'neutral',
}

/** Première émotion taguée dans le texte (alias ramenés aux six), en minuscules — null si aucune. */
export function firstEmotionTag(text: string): Emotion | null {
  const m = emotionTagRe().exec(text)
  if (!m) return null
  const tag = m[1].toLowerCase()
  return EMOTION_ALIASES[tag] ?? (tag as Emotion)
}

/**
 * Liste des tags telle qu'elle est DEMANDÉE au modèle dans le prompt :
 * « [happy] [sad] [angry] [surprised] [relaxed] [neutral] ».
 * `neutral` passe en dernier — le tag de repli ne doit pas être le premier
 * exemple qu'un petit modèle recopie.
 */
export function emotionTagList(): string {
  const order = [...EMOTIONS.filter((e) => e !== 'neutral'), 'neutral']
  return order.map((e) => `[${e}]`).join(' ')
}
