// Balises de GESTE — LA règle commune, importée par le client (détection dans le
// flux, nettoyage de l'affichage et de la voix) ET par le serveur (consigne au
// modèle). Même grammaire que les tags d'émotion (shared/emotions.ts), avec une
// différence de fond : l'émotion se pose UNE fois en tête de réponse, le geste se
// place LÀ OÙ il a lieu dans le texte, autant de fois que la réponse en appelle.
//
// POURQUOI des balises et non une lecture du texte : une détection par mots
// (« *rit* », « non », « peut-être ») est une liste PAR LANGUE — français et
// anglais aujourd'hui, et rien pour l'utilisateur qui parle espagnol, japonais
// ou arabe. La balise, elle, est écrite par le modèle, qui comprend déjà toutes
// les langues qu'il parle : « [nod] Sí, claro » et « [nod] はい » déclenchent le
// même hochement. La compréhension est déléguée à celui qui l'a.

/** Balises comprises, dans l'ordre où elles sont proposées au modèle. */
export const GESTURE_TAGS = ['nod', 'shake', 'shrug', 'think', 'wave', 'laugh'] as const
export type GestureTag = (typeof GESTURE_TAGS)[number]

/**
 * Radicaux de clips (vrma/) qui jouent chaque balise, par ordre de préférence.
 * Le premier présent dans la famille d'animations du personnage gagne — JAMAIS
 * un clip de l'autre famille (raccord croisé de 16-20 cm, cf. vrmStage.ts).
 * Overte n'a ni salut ni rire ni haussement d'épaules : `wave` s'y replie sur la
 * main levée (même famille, geste voisin), les deux autres laissent le visage
 * porter seul — mieux vaut rien qu'un geste faux.
 */
export const GESTURE_CLIP_STEMS: Record<GestureTag, readonly string[]> = {
  nod: ['nod'],
  shake: ['shake'],
  shrug: ['shrug'],
  think: ['think'],
  wave: ['wave', 'raise-hand'],
  laugh: ['laugh'],
}

/** Tous les radicaux qu'une balise peut appeler (pour bâtir le catalogue). */
export const GESTURE_STEMS: readonly string[] = [...new Set(Object.values(GESTURE_CLIP_STEMS).flat())]

/**
 * Motif d'une balise de geste : « [nod] », « [ Nod ] », « [SHRUG] ». Une FABRIQUE
 * pour la même raison que emotionTagRe : un motif global porte un `lastIndex`.
 * Jamais un lien Markdown : « [nod](url) » et « [nod][1] » gardent leur libellé
 * (même garde que UNKNOWN_HEAD_TAG, client/src/emotions.ts).
 */
export function gestureTagRe(flags = 'gi'): RegExp {
  return new RegExp(`\\[\\s*(${GESTURE_TAGS.join('|')})\\s*\\](?![(\\[])`, flags)
}

/** Balises complètes du texte, dans l'ordre, en minuscules. */
export function gestureTagsIn(text: string): GestureTag[] {
  return [...text.matchAll(gestureTagRe())].map((m) => m[1].toLowerCase() as GestureTag)
}

/** « [nod] [shake] [shrug] [think] [wave] [laugh] » — telle que proposée au modèle. */
export function gestureTagList(): string {
  return GESTURE_TAGS.map((g) => `[${g}]`).join(' ')
}
