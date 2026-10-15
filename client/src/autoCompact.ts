// Logique pure de l'auto-compaction — extraite d'App.tsx pour être testable
// sans React (scripts/test-auto-compact.ts). Le compteur d'échecs est PAR CHAT :
// un échec transitoire (timeout Ollama, 500) ne doit plus tuer l'auto-compact
// pour la session entière, comme avant (un seul échec = mort définitive).

/** Échecs consécutifs tolérés par chat avant abandon pour la session. */
export const MAX_AUTO_COMPACT_FAILS = 3

/**
 * Résultat d'une tentative d'auto-compaction, vu du compteur d'échecs.
 *  - `success` : compaction faite → on remet le compteur à zéro.
 *  - `noise`   : 409 (déjà en cours, autre appareil) OU `nothingToCompact`
 *                (< 6 messages, « pas encore assez ») → ni succès ni échec,
 *                un état qui se résout tout seul.
 *  - `failure` : 500, timeout, autre 400 → compte comme un échec réel.
 */
export type AutoCompactOutcome = 'success' | 'noise' | 'failure'

/** Signal à afficher dans le fil (null = rien à dire). */
export type AutoCompactSignal = 'retry' | 'stopped'

/**
 * Transition du compteur d'échecs d'un chat. Pure et bornée : l'app en applique
 * le résultat dans sa Map (par chatId) et n'affiche le signal que si ce chat est
 * toujours actif. Règle d'affichage : on annonce le 1ᵉʳ échec (un essai restant)
 * et l'arrêt définitif ; les essais intermédiaires sont silencieux.
 */
export function autoCompactFailUpdate(
  prev: number | undefined,
  outcome: AutoCompactOutcome,
  maxFails: number = MAX_AUTO_COMPACT_FAILS,
): { count: number | undefined; signal: AutoCompactSignal | null } {
  if (outcome === 'success') return { count: undefined, signal: null }
  if (outcome === 'noise') return { count: prev, signal: null }
  const n = (prev ?? 0) + 1
  // On a touché la borne → « on arrête ». Sinon, 1ᵉʳ échec → « nouvel essai » ;
  // les échecs intermédiaires sont silencieux. (maxFails=1 : le 1ᵉʳ échec est
  // déjà le dernier → « on arrête », pas « nouvel essai ».)
  const signal: AutoCompactSignal | null =
    n >= maxFails ? 'stopped' : n === 1 ? 'retry' : null
  return { count: n, signal }
}
