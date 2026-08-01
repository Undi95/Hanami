// Macros des character cards : {{char}} et {{user}} — la convention de
// SillyTavern, que TOUTES les cards importées utilisent, et que Hanami jetait
// jusqu'ici telle quelle dans le prompt (le modèle lisait « {{char}} » au lieu
// du nom du personnage).
//
// SUBSTITUTION TARDIVE, JAMAIS À L'IMPORT : les champs restent écrits avec
// leurs macros sur le disque (le prompt d'un personnage renommé, ou une persona
// changée, doit suivre sans réécriture), et le remplacement se fait au moment
// où le texte part — construction du payload côté serveur, affichage d'une
// salutation côté client. C'est donc l'onglet « Payload » de l'Inspecteur qui
// montre la vérité ; l'onglet « Prompt système », lui, reste la SOURCE éditable.
//
// Partagé client/serveur : les deux substituent, et ils doivent le faire
// exactement pareil.

/** Noms substitués : celui du personnage, celui de l'utilisateur. */
export interface MacroNames {
  char: string
  user: string
}

/** Nom par défaut de l'utilisateur, quand aucune persona n'est nommée. */
export const DEFAULT_USER_NAME = 'User'

/** Nom retenu pour {{user}} : la persona des réglages si elle est nommée, sinon « User ». */
export function userName(personaName?: string): string {
  const name = typeof personaName === 'string' ? personaName.trim() : ''
  return name || DEFAULT_USER_NAME
}

// Les deux écritures rencontrées dans la nature : {{char}}/{{user}} (SillyTavern
// moderne, espaces tolérés, casse libre) et <BOT>/<USER> (cards anciennes,
// TavernAI). Rien d'autre n'est reconnu : Hanami n'est pas un moteur de macros,
// et un {{random}} inventé doit rester visible plutôt que d'être avalé.
const MACRO_RE = /\{\{\s*(char|user)\s*\}\}|<(BOT|USER)>/gi

/** Remplace les macros d'un texte. Texte vide ou sans macro : renvoyé tel quel. */
export function substituteMacros(text: string, names: MacroNames): string {
  if (!text || (!text.includes('{{') && !text.includes('<'))) return text
  return text.replace(MACRO_RE, (_match, braced: string | undefined, angled: string | undefined) => {
    const which = (braced ?? angled ?? '').toLowerCase()
    return which === 'char' || which === 'bot' ? names.char : names.user
  })
}
