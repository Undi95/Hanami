// Personas utilisateur (Settings.userPersonas) : résolution de la persona
// ACTIVE pour une paire « personnage ↔ utilisateur », et normalisation de la
// collection (config.json et character.json sont éditables à la main).
// Partagé client/serveur : le serveur l'injecte dans le payload, le client la
// résout pour les salutations et les macros {{user}} — il faut qu'ils tombent
// d'accord.
import type { CharacterMeta, Settings, UserPersona } from './types'

/**
 * La persona ACTIVE pour « ce personnage face à l'utilisateur » :
 * 1. la persona épinglée sur le personnage (character.userPersona), si elle
 *    existe encore dans la collection ;
 * 2. sinon la persona par défaut des Réglages (defaultPersona), si elle existe ;
 * 3. sinon la PREMIÈRE persona de la collection ;
 * 4. sinon null — aucune persona : aucun bloc injecté, {{user}} = « User ».
 *
 * Un id orphelin (persona supprimée après l'épinglage) retombe sur la suite de
 * la chaîne : l'utilisateur ne perd jamais silencieusement son « moi ».
 */
export function activePersona(
  settings: Pick<Settings, 'userPersonas' | 'defaultPersona'>,
  character: Pick<CharacterMeta, 'userPersona'>,
): UserPersona | null {
  const list = settings.userPersonas
  if (!Array.isArray(list) || list.length === 0) return null
  const find = (id?: string) => (typeof id === 'string' && id ? (list.find((p) => p.id === id) ?? null) : null)
  return find(character.userPersona) ?? find(settings.defaultPersona) ?? list[0] ?? null
}

/**
 * Une entrée de la collection, nettoyée : les trois champs sont des chaînes
 * bornées, et une entrée sans RIEN (ni id, ni nom, ni description) est écartée.
 * L'id manquant se prend sur le nom (une persona s'identifie à sa façon de
 * s'appeler), sinon sur un id généré positionnel — la collection doit rester
 * dédoublonnée, jamais vide d'identité.
 */
export function normalizePersona(value: unknown, index: number): UserPersona | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const name = typeof v.name === 'string' ? v.name.trim().slice(0, 60) : ''
  const description = typeof v.description === 'string' ? v.description.trim().slice(0, 1000) : ''
  const id = (typeof v.id === 'string' ? v.id.trim() : '') || name || `persona-${index + 1}`
  if (!id || (!name && !description)) return null
  return { id: id.slice(0, 60), name, description }
}

/**
 * La collection, nettoyée : entrées invalides écartées, ids dédoublonnés (le
 * PREMIER des doublons garde l'id — le second se voit attribuer le nom, puis un
 * suffixe), et tout est borné à PERSONA_MAX personas. C'est LA normalisation :
 * le PUT /api/settings et la lecture de config.json y passent tous les deux.
 */
export const PERSONA_MAX = 20

export function normalizePersonas(value: unknown): UserPersona[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: UserPersona[] = []
  for (let i = 0; i < value.length && out.length < PERSONA_MAX; i++) {
    const p = normalizePersona(value[i], i)
    if (!p) continue
    let id = p.id
    if (seen.has(id)) {
      // Doublon d'id : on ne jette pas la persona, on la renomme de façon
      // déterministe (nom-2, nom-3…) pour que l'épinglage ne désigne jamais
      // deux personas à la fois.
      let n = 2
      while (seen.has(`${id}-${n}`)) n++
      id = `${id}-${n}`
    }
    seen.add(id)
    out.push({ ...p, id })
  }
  return out
}
