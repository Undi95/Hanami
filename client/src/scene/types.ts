// Contrat entre l'UI (App) et la scène 3D (vrmStage) — ne pas modifier sans mettre à jour les deux côtés.

/** Cadrage caméra (position + cible, coordonnées monde) — sérialisable tel quel. */
export interface StageView {
  pos: [number, number, number]
  target: [number, number, number]
}

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
   * Cadrage modifié par l'utilisateur (drag/molette/pincement) → view, ou
   * réinitialisé (double-clic) → null. Sert à persister la préférence.
   */
  onViewChange(cb: (view: StageView | null) => void): void
  /** Libère renderer, modèle et listeners. */
  dispose(): void
}
