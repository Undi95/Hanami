// Tailles réglables des panneaux — colonne de chat (desktop) et boîte de
// dialogue du mode visual novel.
//
// Une seule mécanique : la préférence vit côté SERVEUR (prefs.ts → data/ui.json)
// et s'applique en VARIABLES CSS posées sur :root. Tout ce qui dépend de la
// largeur du chat (la colonne, le portrait 2D) lit la même variable, donc suit
// sans un mot de JavaScript de plus. Préférence absente = variable retirée :
// styles.css reprend ses valeurs par défaut, écrites en repli dans chaque var().
//
// Les poignées écrivent la variable À CHAQUE mouvement (aucun rendu React par
// pixel parcouru) et ne posent la préférence qu'au relâchement.
import { getPref, setPref, subscribePrefs } from './prefs'

// Valeurs par défaut : elles DOUBLENT celles de styles.css (repli des var()) —
// les deux doivent rester d'accord.
/** Largeur de la colonne de chat au-delà de 900 px. */
export const CHAT_PANEL_W = 420
/** En dessous, la barre du haut et le composer ne tiennent plus. */
export const CHAT_PANEL_MIN_W = 320
/** Largeur de la boîte VN (le `min(900px, …)` de styles.css). */
export const VN_BOX_W = 900
export const VN_BOX_MIN_W = 520
/** Hauteur de la zone de texte VN : deux lignes au minimum. */
export const VN_TEXT_MIN_H = 72

// Marge de sécurité de la boîte VN, reprise de styles.css : calc(100% - 28px).
const VN_BOX_MARGIN = 28
// Part de la fenêtre que la colonne de chat ne dépasse pas (la scène garde la
// sienne) et part réservée à la zone de texte VN.
const CHAT_PANEL_MAX_RATIO = 0.6
const VN_TEXT_MAX_RATIO = 0.4

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), Math.max(min, max))
}

/** Largeur maximale de la colonne de chat, pour la fenêtre courante. */
export function chatPanelMax(): number {
  return Math.round(window.innerWidth * CHAT_PANEL_MAX_RATIO)
}

/** Largeur maximale de la boîte VN (les mêmes marges qu'en CSS). */
export function vnBoxMax(): number {
  return window.innerWidth - VN_BOX_MARGIN
}

/** Hauteur maximale de la zone de texte VN. */
export function vnTextMax(): number {
  return Math.round(window.innerHeight * VN_TEXT_MAX_RATIO)
}

/** Largeur en vigueur de la colonne de chat (préférence bornée, ou défaut). */
export function chatPanelWidth(): number {
  const saved = getPref('chatPanelWidth')
  return saved === undefined ? CHAT_PANEL_W : clamp(saved, CHAT_PANEL_MIN_W, chatPanelMax())
}

/** Largeur en vigueur de la boîte VN (préférence bornée, ou défaut). */
export function vnBoxWidth(): number {
  const saved = getPref('vnBoxWidth')
  return saved === undefined ? VN_BOX_W : clamp(saved, VN_BOX_MIN_W, vnBoxMax())
}

/** Hauteur voulue de la zone de texte VN, ou `null` = celle de styles.css. */
export function vnTextHeight(): number | null {
  const saved = getPref('vnBoxHeight')
  return saved === undefined ? null : clamp(saved, VN_TEXT_MIN_H, vnTextMax())
}

// ── Variables CSS ──────────────────────────────────────────────────────────

function setVar(name: string, px: number | null): void {
  const root = document.documentElement
  if (px === null) root.style.removeProperty(name)
  else root.style.setProperty(name, `${px}px`)
}

/** (Re)pose les variables de mise en page d'après les préférences courantes. */
export function applyLayoutVars(): void {
  // Préférence absente : la variable est RETIRÉE, pas remise au défaut — le
  // repli de styles.css redevient seul maître (une seule vérité par valeur).
  setVar('--chat-panel-w', getPref('chatPanelWidth') === undefined ? null : chatPanelWidth())
  setVar('--vn-box-w', getPref('vnBoxWidth') === undefined ? null : vnBoxWidth())
  setVar('--vn-text-h', vnTextHeight())
}

// Les variables suivent la préférence d'où qu'elle vienne : cache local lu au
// démarrage (donc aucun clignotement), état serveur arrivé au boot, drag d'une
// poignée. Un seul abonnement, posé une fois pour toutes à l'import du module.
applyLayoutVars()
subscribePrefs(applyLayoutVars)

// ── Aperçu pendant le drag (variable seule, aucune préférence écrite) ──────
// Chacune renvoie la valeur RETENUE après bornage : la poignée la garde pour la
// persister au relâchement, sans risque d'écart avec ce qui est affiché.

export function previewChatPanelWidth(px: number): number {
  const width = clamp(px, CHAT_PANEL_MIN_W, chatPanelMax())
  setVar('--chat-panel-w', width)
  return width
}

export function previewVnBoxWidth(px: number): number {
  const width = clamp(px, VN_BOX_MIN_W, vnBoxMax())
  setVar('--vn-box-w', width)
  return width
}

export function previewVnTextHeight(px: number): number {
  const height = clamp(px, VN_TEXT_MIN_H, vnTextMax())
  setVar('--vn-text-h', height)
  return height
}

// ── Persistance (`null` oublie la préférence : retour au défaut) ───────────

export function saveChatPanelWidth(px: number | null): void {
  setPref({ chatPanelWidth: px === null ? null : clamp(px, CHAT_PANEL_MIN_W, chatPanelMax()) })
}

export function saveVnBoxWidth(px: number | null): void {
  setPref({ vnBoxWidth: px === null ? null : clamp(px, VN_BOX_MIN_W, vnBoxMax()) })
}

export function saveVnTextHeight(px: number | null): void {
  setPref({ vnBoxHeight: px === null ? null : clamp(px, VN_TEXT_MIN_H, vnTextMax()) })
}
