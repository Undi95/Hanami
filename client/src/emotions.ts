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

/**
 * Tag ENCORE INCOMPLET d'une réponse en cours d'écriture : « [ », « [ha »,
 * « [ happ ». Le flux SSE livre le tag en plusieurs morceaux — « [ » + « happy »
 * + « ] » est la découpe habituelle d'un backend local — et un tag incomplet
 * n'est reconnaissable par aucune des expressions ci-dessus : la bulle affichait
 * donc « [ » puis « [happy » pendant 25 à 150 ms avant que le tag ne devienne
 * retirable.
 * ANCRÉ EN TÊTE et sur le message ENTIER : tant que la réponse n'est QUE ce
 * début de tag, il n'y a rien d'autre à montrer. Un crochet ailleurs dans le
 * texte reste un crochet ordinaire.
 */
const PARTIAL_TAG = /^\[\s*[a-z]*\s*$/i

/**
 * Tag d'émotion INVENTÉ, en tête de réponse : « [excited] », « [joyful] »,
 * « [thoughtful] »… Le contrat du prompt donne six émotions, les modèles en
 * écrivent d'autres — et ce tag-là n'étant reconnu par aucune expression
 * ci-dessus, il restait affiché À JAMAIS en tête de bulle (et lu à voix haute
 * par la synthèse vocale, qui passe par ici aussi).
 *
 * FORME D'ÉMOTION UNIQUEMENT, et le reste est épargné :
 *  - en TÊTE de texte seulement — « un [tableau] ici » n'est pas touché ;
 *  - UN SEUL MOT, 2 à 12 lettres ASCII MINUSCULES, sans espace ni chiffre :
 *    « [Note] », « [OOC] », « [Système] », « [exc ited] », « [v2] » sont donc
 *    hors d'atteinte — un marqueur écrit par un humain porte presque toujours
 *    une majuscule ou un accent, un tag d'émotion jamais ;
 *  - PAS un lien Markdown : « [texte](url) » et « [texte][1] » commencent de la
 *    même façon, et amputer le libellé casserait le lien (garde `(?![([])`).
 *
 * Le pire cas d'un faux positif est un mot de tête absent de l'AFFICHAGE — le
 * texte sauvegardé, lui, reste intégral (édition, recherche, payload LLM) ;
 * le pire cas sans ce retrait est un tag inerte, moche, à chaque réponse et
 * pour toujours. On tranche pour le retrait.
 *
 * Seule exception nommée : « ooc » (out of character), le seul marqueur de jeu
 * de rôle courant qui ait exactement la forme d'un tag d'émotion. Le masquer
 * silencieusement retournerait le sens d'une réplique.
 */
const UNKNOWN_HEAD_TAG = /^\[([a-z]{2,12})\](?![([])[ \t]*/
const NOT_EMOTIONS = new Set(['ooc'])

/**
 * Retire TOUS les tags d'émotion pour l'affichage (le texte stocké reste intégral).
 * `streaming` : la réponse s'écrit encore — un tag incomplet est masqué le temps
 * qu'il s'achève (la bulle garde ses points d'attente au lieu de clignoter).
 */
export function stripEmotionTags(text: string, streaming = false): string {
  let clean = text.replace(ALL_TAGS, '').replace(/^[ \t]+/, '')
  const unknown = UNKNOWN_HEAD_TAG.exec(clean)
  if (unknown && !NOT_EMOTIONS.has(unknown[1])) clean = clean.slice(unknown[0].length)
  return streaming && PARTIAL_TAG.test(clean) ? '' : clean
}

// ── Repli du mode simple ───────────────────────────────────────────────────
// Les petits modèles oublient souvent le tag [emotion]. Faute de tag, on devine
// à partir d'indices grossiers — mieux vaut « neutral » qu'un contresens.
// Recherche en SOUS-CHAÎNE sur le texte en minuscules : \b ne fonctionne pas
// autour des accents en JS, et une liste d'emojis évite les pièges de regex
// (paires de substitution, sélecteurs de variation).
const SAD_EMOJI = ['😢', '😭', '😞', '😔', '🥺', '💔']
const SAD_WORDS = ['désol', 'navré', 'triste', 'pleur', 'sorry', 'sad', 'unhappy']
const SURPRISED_EMOJI = ['😲', '😮', '😯', '😱', '🤯', '😳']
const SURPRISED_WORDS = ['?!', '!?', 'oh !', 'oh!', 'quoi ?', 'hein ?', 'vraiment ?', 'what?', 'really?', 'wow']
const HAPPY_EMOJI = ['😊', '😄', '😁', '😃', '🥰', '😍', '❤️', '💕', '💖', '✨', '🎉']
// « content » est absent volontairement : « mécontent » le contient.
const HAPPY_WORDS = ['merci', 'génial', 'super', 'heureu', 'ravi', 'adore', 'haha', 'héhé', 'thanks', 'happy', 'glad']

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((n) => text.includes(n))
}

/**
 * Émotion devinée d'une réponse sans tag (mode simple uniquement).
 * Fonction pure : même texte → même émotion, aucun effet de bord.
 */
export function detectEmotionFallback(text: string): Emotion {
  const s = stripEmotionTags(text).toLowerCase()
  if (!s.trim()) return 'neutral'
  // Du plus spécifique au plus large : « Désolé ! » n'est pas joyeux, « Quoi ?! » non plus.
  if (hasAny(s, SAD_EMOJI) || hasAny(s, SAD_WORDS)) return 'sad'
  if (hasAny(s, SURPRISED_EMOJI) || hasAny(s, SURPRISED_WORDS)) return 'surprised'
  if (hasAny(s, HAPPY_EMOJI) || hasAny(s, HAPPY_WORDS) || s.includes('!') || s.includes('~')) return 'happy'
  return 'neutral'
}
