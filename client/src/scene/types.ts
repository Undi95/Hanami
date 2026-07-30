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
  /**
   * Charge un décor .glb autour de l'avatar (url '' = décharge le décor courant,
   * retour au fond 2D). Indépendant de loadModel : l'avatar reste à l'origine du
   * monde, c'est le décor qui se place autour de lui — les cadrages caméra
   * sauvegardés ne périment donc jamais.
   */
  loadEnvironment(url: string): Promise<void>
  /**
   * Applique une émotion ([happy] etc.) avec transition douce.
   * `live` : l'émotion vient DE SE PRODUIRE (tag reçu dans le flux, réponse
   * terminée, message d'accueil affiché) — un geste .vrma peut alors
   * l'accompagner. Une RESTAURATION (vieille conversation ouverte, retour
   * d'onglet, rechargement du modèle) laisse `live` à faux : le visage suit,
   * le corps ne mime rien.
   */
  setEmotion(emotion: string, live?: boolean): void
  /**
   * true pendant le streaming d'une réponse → anime la bouche (lipsync simple),
   * et joue le socle « parle » s'il existe dans vrma/.
   */
  setSpeaking(speaking: boolean): void
  /**
   * Animations .vrma allumées ou éteintes (préférence UiPrefs.vrmaEnabled).
   * Éteint = mixer DÉCHARGÉ et retour à la pose de repos, pas une mise en pause.
   */
  setAnimationsEnabled(on: boolean): void
  /**
   * Posture en boucle qui REMPLACE le socle d'idle (`sit-idle`, `pose-sit`… —
   * le nom est celui du fichier .vrma, sans son préfixe `pose-`), null = retour
   * au socle. Les gestes d'émotion continuent de se superposer. Un nom inconnu
   * ne fait rien d'autre que retirer la posture en place.
   * Crochet de la phase interactive : personne ne l'appelle encore.
   */
  setPosture(name: string | null): void
  /** Applique un cadrage sauvegardé (après loadModel). */
  setView(view: StageView): void
  /**
   * Choisit le cadrage par défaut utilisé par loadModel et resetView. N'agit PAS
   * sur l'image en cours : l'appelant décide ensuite quoi appliquer (une vue
   * sauvegardée, ou resetView pour le défaut du mode).
   */
  setFrameMode(mode: FrameMode): void
  /**
   * Largeur (px) de la colonne de chat en mode desktop, réglable à la poignée :
   * c'est d'elle que dépend le décalage du cadrage 'left'. Posée par l'UI au boot
   * puis à chaque changement de largeur. Comme setFrameMode, n'agit PAS sur
   * l'image en cours : seul le prochain cadrage par défaut (bascule de mode,
   * resetView, chargement de modèle) en tient compte.
   */
  setPanelWidth(px: number): void
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
  /**
   * Photo de la scène TELLE QU'ELLE EST À L'ÉCRAN, en data URL PNG (mêmes
   * dimensions que le canvas). null si aucun modèle n'est chargé : il n'y aurait
   * rien à capturer. Le recadrage carré et la réduction sont l'affaire de
   * l'appelant — la scène ne fait que rendre son image.
   */
  snapshot(): string | null
  /** Libère renderer, modèle et listeners. */
  dispose(): void
}
