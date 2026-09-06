// Contrat entre l'UI (App) et la scène 3D (vrmStage) — ne pas modifier sans mettre à jour les deux côtés.

// StageView vit désormais dans shared/types.ts : le cadrage caméra est une
// préférence persistée côté serveur (data/ui.json), donc partie du contrat
// client/serveur. Réexporté ici pour que la scène garde un import unique.
export type { StageView } from '../../../shared/types'
import type { AnimationFamily, StageView } from '../../../shared/types'

/**
 * Cadrage par défaut de l'avatar, imposé par la place que l'UI laisse à la scène :
 * 'centered' = plein écran (mode visual novel), 'left' = décalé pour tomber au
 * centre de la bande restée visible à gauche du panneau de chat (mode desktop).
 */
export type FrameMode = 'centered' | 'left'

/**
 * Ce que la scène a à DIRE du placement du décor qu'elle vient d'afficher —
 * pour que l'écran sombre ne soit plus jamais muet. `null` (le cas normal) : le
 * personnage est posé sur le sol de la pièce et l'objectif voit quelque chose.
 *
 * Le serveur recale tout seul les décors qu'il peut (`spawnAuto` du
 * `.scene.json`) ; il reste ce qui lui a échappé : un sidecar `spawn` mal réglé
 * — sa parole passe avant tout, elle n'est jamais corrigée — ou un décor où
 * l'analyse n'a trouvé nulle part où poser quelqu'un.
 */
export interface EnvNotice {
  /** Nom du décor tel qu'il apparaît dans `environments/`, sans extension. */
  name: string
  /** Altitude du sol de la pièce (m) : positif = le personnage est SOUS le plancher. `null` = le sol est bien sous ses pieds. */
  ground: number | null
  /** L'objectif est dans la géométrie : rien à voir depuis là où le personnage se tient. */
  blind: boolean
  /** Le personnage se tient hors de la pièce praticable. */
  outside: boolean
}

export interface VrmStage {
  /** Charge un modèle .vrm (url '' = décharge le modèle courant). */
  loadModel(url: string): Promise<void>
  /**
   * Charge un décor .glb autour de l'avatar (url '' = décharge le décor courant,
   * retour au fond 2D). Indépendant de loadModel : l'avatar reste à l'origine du
   * monde, c'est le décor qui se place autour de lui — les cadrages caméra
   * sauvegardés ne périment donc jamais.
   *
   * Rend le diagnostic de placement du décor chargé (`null` = rien à dire), à
   * charge de l'appelant de l'afficher : la scène mesure, l'UI parle.
   */
  loadEnvironment(url: string): Promise<EnvNotice | null>
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
   * true tant que l'utilisateur TAPE son message → socle « écoute » s'il existe
   * dans la famille du personnage. Il n'existe QUE dans la famille Rocketbox :
   * pour un personnage Overte, cet appel ne change strictement rien.
   *
   * Priorité : allure > posture > parole > écoute > repos. Un personnage qui
   * marche en scène vivante n'écoute donc pas des bras — exactement comme il ne
   * parle pas des bras.
   */
  setListening(on: boolean): void
  /**
   * Famille d'animations de face à face du personnage affiché (défaut 'overte').
   * Changer de famille RECONSTRUIT le mixer : les deux bibliothèques n'ont aucun
   * clip de face à face en commun, et celle qui n'est pas choisie n'est jamais
   * téléchargée.
   *
   * Le réglage porte sur le socle, la parole, l'écoute et les gestes — dans les
   * deux modes. Le domaine `world-` de la scène vivante (allures, pivots,
   * postures assises, acquiescement au clic) reste Overte pour tout le monde :
   * Rocketbox n'a rien de tout cela (cf. vrma/README.md).
   */
  setAnimationFamily(family: AnimationFamily): void
  /**
   * Animations .vrma allumées ou éteintes (préférence UiPrefs.vrmaEnabled).
   * Éteint = mixer DÉCHARGÉ et retour à la pose de repos, pas une mise en pause.
   */
  setAnimationsEnabled(on: boolean): void
  /**
   * Pause COMPLÈTE du rendu (réglage « Afficher l'avatar » masqué) : la boucle
   * rAF s'arrête, plus aucune frame n'est rendue — ce n'est pas une animation
   * éteinte (setAnimationsEnabled), c'est le moteur qui s'assoit. L'UI, elle,
   * masque la div par CSS : la scène n'est jamais démontée (le stage y est
   * attaché au boot, un unmount conditionnel le tuerait). Reprendre repart la
   * boucle à l'image suivante — l'état (modèle, pose, décor) est intact.
   */
  setPaused(on: boolean): void
  /**
   * Scène vivante : l'avatar occupe la pièce — il a une position et un cap, se
   * tourne vers vous, se déplace, s'assoit. Éteint (le défaut) = comportement
   * IDENTIQUE À L'OCTET PRÈS à celui d'avant : avatar à l'origine du monde, cap
   * nul, et pas un octet des clips du domaine `world-` n'est téléchargé.
   *
   * L'APPLICATION du réglage appartient à l'appelant : la préférence suit
   * l'utilisateur d'un appareil à l'autre (data/ui.json) mais l'interaction 3D
   * est réservée au grand écran — cf. App.tsx, qui passe `false` sur petit écran
   * quelle que soit la préférence, et réagit au redimensionnement dans les deux
   * sens.
   */
  setInteractive(on: boolean): void
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
