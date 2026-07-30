// Contrat entre l'UI (App) et la scène 3D (vrmStage) — ne pas modifier sans mettre à jour les deux côtés.

// StageView vit désormais dans shared/types.ts : le cadrage caméra est une
// préférence persistée côté serveur (data/ui.json), donc partie du contrat
// client/serveur. Réexporté ici pour que la scène garde un import unique.
export type { StageView } from '../../../shared/types'
import type { StageView } from '../../../shared/types'

/**
 * Cadrage par défaut de l'avatar, imposé par la place que l'UI laisse à la scène :
 * 'centered' = plein écran (mode visual novel), 'left' = décalé pour tomber au
 * centre de la bande restée visible à gauche du panneau de chat (mode desktop).
 */
export type FrameMode = 'centered' | 'left'

export interface VrmStage {
  /** Charge un modèle .vrm (url '' = décharge le modèle courant). */
  loadModel(url: string): Promise<void>
  /** Applique une émotion ([happy] etc.) avec transition douce. */
  setEmotion(emotion: string): void
  /** true pendant le streaming d'une réponse → anime la bouche (lipsync simple). */
  setSpeaking(speaking: boolean): void
  /** Applique un cadrage sauvegardé (après loadModel). */
  setView(view: StageView): void
  /**
   * Choisit le cadrage par défaut utilisé par loadModel et resetView. N'agit PAS
   * sur l'image en cours : l'appelant décide ensuite quoi appliquer (une vue
   * sauvegardée, ou resetView pour le défaut du mode).
   */
  setFrameMode(mode: FrameMode): void
  /**
   * Recadre au défaut du mode courant (ce que fait le double-clic) et notifie
   * onViewChange(null) — donc oublie la vue sauvegardée. Sans effet si aucun
   * modèle n'est chargé.
   */
  resetView(): void
  /**
   * Cadrage modifié par l'utilisateur (drag/molette/pincement) → view, ou
   * réinitialisé (double-clic, resetView) → null. Sert à persister la préférence.
   */
  onViewChange(cb: (view: StageView | null) => void): void
  /** Libère renderer, modèle et listeners. */
  dispose(): void
}
