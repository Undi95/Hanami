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
  return new RegExp(`\\[\\s*(${EMOTIONS.join('|')})\\s*\\]`, flags)
}

/** Première émotion taguée dans le texte, en minuscules — null si aucune. */
export function firstEmotionTag(text: string): Emotion | null {
  const m = emotionTagRe().exec(text)
  return m ? (m[1].toLowerCase() as Emotion) : null
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
