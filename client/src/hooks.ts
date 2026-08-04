// Petits hooks partagés — pour l'instant, un seul.
import { useCallback, useRef } from 'react'

/**
 * Identité de fonction STABLE (jamais recréée), qui appelle toujours la
 * dernière version de `fn` — utile pour passer un callback à un composant
 * mémoïsé (React.memo) sans que ses props changent d'identité à chaque
 * render du parent. Contrairement à `useCallback(fn, [])`, jamais de closure
 * périmée : la ref est mise à jour à chaque render, avant tout rendu des
 * enfants.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...args: A) => ref.current(...args), [])
}
