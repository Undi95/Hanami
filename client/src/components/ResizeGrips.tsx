// Poignées de redimensionnement : bord gauche de la colonne de chat (desktop) et
// coin haut-gauche de la boîte de dialogue du mode visual novel.
//
// Discrètes par doctrine : une zone de saisie fine, invisible au repos, un filet
// accent au survol et pendant le geste. Le drag n'écrit QUE des variables CSS
// (cf. layout.ts) — la préférence serveur n'est posée qu'au relâchement, et le
// double-clic l'oublie (retour à la taille par défaut).
import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useI18n } from '../i18n'
import {
  CHAT_PANEL_W,
  VN_BOX_W,
  VN_TEXT_MIN_H,
  previewChatPanelWidth,
  previewSheetHeight,
  previewVnBoxWidth,
  previewVnTextHeight,
  saveChatPanelWidth,
  saveSheetHeight,
  saveVnBoxWidth,
  saveVnTextHeight,
} from '../layout'

// En dessous, le geste est un TOUCHER, pas un glissement : un doigt qui tape
// bouge d'un ou deux pixels, et la poignée de la feuille basse doit distinguer
// « replier » (tap) de « redimensionner » (drag).
const DRAG_THRESHOLD = 6

interface DragHandlers {
  /** Prise du pointeur : mémorise l'état de départ (la poignée est passée). */
  grab: (grip: HTMLElement) => void
  /** Déplacement depuis la prise, en pixels. */
  move: (dx: number, dy: number) => void
  /** Relâchement après un VRAI déplacement : la préférence est posée. */
  drop: () => void
  /** Double-clic : la préférence est oubliée. */
  reset: () => void
  /** Relâchement SANS déplacement (sous le seuil) : un simple toucher. */
  tap?: () => void
}

/** Câblage pointeur commun aux poignées (capture, annulation, double-clic). */
function useDrag(handlers: DragHandlers) {
  const origin = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(false)

  function end(grip: HTMLElement, canceled: boolean): void {
    origin.current = null
    delete grip.dataset.dragging
    // Un simple clic n'écrit rien : la préférence ne naît que d'un déplacement.
    if (moved.current) handlers.drop()
    else if (!canceled) handlers.tap?.()
    moved.current = false
  }

  return {
    onPointerDown(e: ReactPointerEvent<HTMLElement>): void {
      if (e.button !== 0 || origin.current) return
      const grip = e.currentTarget
      origin.current = { x: e.clientX, y: e.clientY }
      moved.current = false
      handlers.grab(grip)
      // Capture : le pointeur peut sortir de la poignée (7 px de large…) sans
      // perdre le geste, et le relâchement nous revient où qu'il ait lieu.
      // try : un pointerId déjà relâché (ou synthétique) fait jeter la capture —
      // le geste dégrade alors en suivi simple, il ne doit pas casser la poignée.
      try {
        grip.setPointerCapture(e.pointerId)
      } catch {
        /* capture refusée : les move/up arrivent tant que le pointeur reste dessus */
      }
      grip.dataset.dragging = 'on'
      e.preventDefault() // le drag ne sélectionne pas le texte autour
    },

    onPointerMove(e: ReactPointerEvent<HTMLElement>): void {
      const from = origin.current
      if (!from) return
      const dx = e.clientX - from.x
      const dy = e.clientY - from.y
      // Zone morte : rien ne bouge tant que le geste peut encore être un tap.
      if (!moved.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      moved.current = true
      handlers.move(dx, dy)
    },

    onPointerUp(e: ReactPointerEvent<HTMLElement>): void {
      if (origin.current) end(e.currentTarget, false)
    },

    // Geste repris par le navigateur (défilement tactile) : ce qui est déjà
    // appliqué est PERSISTÉ — sinon la variable CSS et la préférence divergeraient.
    // Mais un tap annulé ne déclenche RIEN : le navigateur a pris la main.
    onPointerCancel(e: ReactPointerEvent<HTMLElement>): void {
      if (origin.current) end(e.currentTarget, true)
    },

    onDoubleClick(): void {
      handlers.reset()
    },
  }
}

/** Largeur rendue du panneau qui porte la poignée (départ du geste). */
function widthOf(grip: HTMLElement, fallback: number): number {
  const width = grip.parentElement?.getBoundingClientRect().width ?? 0
  return width > 0 ? width : fallback
}

/**
 * Poignée du bord gauche de la colonne de chat. Rendue en permanence : c'est le
 * CSS qui la réserve au desktop (≥ 900 px, hors mode visual novel), là où le
 * panneau EST une colonne à largeur réglable.
 */
export function ChatPanelGrip() {
  const { t } = useI18n()
  const start = useRef(CHAT_PANEL_W)
  const last = useRef<number | null>(null)
  const drag = useDrag({
    grab: (grip) => {
      // La largeur RENDUE, pas la préférence : le premier geste part exactement
      // de ce que l'utilisateur a sous les yeux.
      start.current = widthOf(grip, CHAT_PANEL_W)
      last.current = null
    },
    // Colonne ancrée à DROITE : tirer la poignée vers la gauche (dx < 0) élargit.
    move: (dx) => {
      last.current = previewChatPanelWidth(start.current - dx)
    },
    drop: () => {
      if (last.current !== null) saveChatPanelWidth(last.current)
    },
    reset: () => saveChatPanelWidth(null),
  })
  const label = t('resizeChatPanel')
  return (
    <div
      className="panel-grip"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      {...drag}
    />
  )
}

/**
 * Barre de la feuille basse (< 900 px) : LA poignée à trois gestes du panneau de
 * chat mobile — toucher replie/déplie, glisser règle la hauteur, double-toucher
 * revient à la hauteur par défaut. C'est la grammaire des « bottom sheets »
 * (Plans, feuilles de partage) : aucun bouton de plus à l'écran.
 */
export function SheetHandle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useI18n()
  const start = useRef<number | null>(null)
  const last = useRef<number | null>(null)
  const drag = useDrag({
    grab: (grip) => {
      // Replié : la feuille est hors écran, un glissement n'aurait rien à
      // montrer — seul le toucher (déplier) a un sens.
      start.current = collapsed ? null : (grip.parentElement?.getBoundingClientRect().height ?? null)
      last.current = null
    },
    // Ancrée en BAS : tirer la barre vers le HAUT (dy < 0) agrandit la feuille.
    move: (_dx, dy) => {
      if (start.current !== null) last.current = previewSheetHeight(start.current - dy)
    },
    drop: () => {
      if (last.current !== null) saveSheetHeight(last.current)
    },
    reset: () => saveSheetHeight(null),
    tap: onToggle,
  })
  return (
    <button
      className="sheet-handle"
      aria-label={collapsed ? t('expandChat') : t('collapseChat')}
      title={t('sheetHandleHint')}
      // Clavier : Entrée/Espace déclenchent un click sans pointeur (detail 0) —
      // le tap du pointeur, lui, est déjà servi par onPointerUp.
      onClick={(e) => {
        if (e.detail === 0) onToggle()
      }}
      {...drag}
    >
      <span className="handle-bar" />
    </button>
  )
}

/** Hauteur rendue de la zone de texte VN (départ du geste vertical). */
function textHeightOf(grip: HTMLElement): number {
  const text = grip.parentElement?.querySelector('.vn-text')
  return text instanceof HTMLElement ? text.getBoundingClientRect().height : VN_TEXT_MIN_H
}

/**
 * Poignée du coin haut-gauche de la boîte de dialogue VN : un seul geste règle
 * la largeur de la boîte et la hauteur de sa zone de texte.
 */
export function VnBoxGrip() {
  const { t } = useI18n()
  const start = useRef({ w: VN_BOX_W, h: VN_TEXT_MIN_H })
  const last = useRef<{ w: number; h: number } | null>(null)
  const drag = useDrag({
    grab: (grip) => {
      start.current = { w: widthOf(grip, VN_BOX_W), h: textHeightOf(grip) }
      last.current = null
    },
    // Boîte CENTRÉE : son bord gauche ne suit le pointeur que si la largeur gagne
    // le double du déplacement (autant à droite qu'à gauche). Et comme elle est
    // ancrée en bas, tirer vers le HAUT (dy < 0) rallonge le texte.
    move: (dx, dy) => {
      last.current = {
        w: previewVnBoxWidth(start.current.w - dx * 2),
        h: previewVnTextHeight(start.current.h - dy),
      }
    },
    drop: () => {
      const size = last.current
      if (!size) return
      saveVnBoxWidth(size.w)
      saveVnTextHeight(size.h)
    },
    reset: () => {
      saveVnBoxWidth(null)
      saveVnTextHeight(null)
    },
  })
  const label = t('resizeVnBox')
  return <div className="vn-grip" role="separator" aria-label={label} title={label} {...drag} />
}
