// Contrat entre l'UI (App) et la scène 3D (vrmStage) — ne pas modifier sans mettre à jour les deux côtés.

export interface VrmStage {
  /** Charge un modèle .vrm (url '' = décharge le modèle courant). */
  loadModel(url: string): Promise<void>
  /** Applique une émotion ([happy] etc.) avec transition douce. */
  setEmotion(emotion: string): void
  /** true pendant le streaming d'une réponse → anime la bouche (lipsync simple). */
  setSpeaking(speaking: boolean): void
  /** Libère renderer, modèle et listeners. */
  dispose(): void
}
