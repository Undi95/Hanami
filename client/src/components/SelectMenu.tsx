// Menu déroulant MAISON — remplaçant de <select> pour les listes LONGUES.
//
// Le popup d'un <select> est peint par le système (contrôle Win32) : sa barre de
// défilement reste blanche même avec color-scheme sombre partout. Ici le panneau
// est du DOM à nous, donc notre CSS s'applique (scrollbar fine accent globale).
// À n'utiliser QUE là où le natif casse : pour une liste courte il va très bien.
//
// Rendu en PORTAIL sur <body>, comme ImageOverlay (MessageList.tsx) : le corps
// des dialogs défile (overflow), un panneau en position: absolute y serait rogné,
// et le fond du dialog porte un backdrop-filter qui deviendrait bloc conteneur
// d'un descendant `fixed`. On calcule donc la position au getBoundingClientRect
// du bouton, et on referme au moindre scroll/resize pour ne jamais flotter à
// côté de son bouton.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'

export interface SelectOption {
  value: string
  label: string
}

interface Props {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  id?: string
  /** Texte grisé affiché quand aucune option ne correspond à `value`. */
  placeholder?: string
}

/** Géométrie du panneau — une seule des deux ancres verticales est posée. */
interface Anchor {
  left: number
  width: number
  maxHeight: number
  top?: number
  bottom?: number
}

/** Place le panneau sous le bouton, ou au-dessus s'il manque franchement la place. */
function anchorFor(btn: HTMLElement): Anchor {
  const r = btn.getBoundingClientRect()
  const vh = window.innerHeight
  const gap = 4 // souffle entre le bouton et le panneau
  const edge = 8 // marge minimale gardée contre le bord de la fenêtre
  const below = vh - r.bottom - gap - edge
  const above = r.top - gap - edge
  const cap = vh * 0.4 // hauteur maximale « raisonnable » du panneau
  const up = below < Math.min(cap, 200) && above > below
  const maxHeight = Math.max(96, Math.min(cap, up ? above : below))
  return up
    ? { left: r.left, width: r.width, maxHeight, bottom: vh - r.top + gap }
    : { left: r.left, width: r.width, maxHeight, top: r.bottom + gap }
}

export default function SelectMenu({ value, options, onChange, id, placeholder }: Props) {
  const { t } = useI18n()
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<Anchor | null>(null) // non nul = ouvert
  // Option mise en évidence (-1 = aucune). Le focus, lui, ne quitte JAMAIS le
  // bouton : c'est lui qui reçoit toutes les touches.
  const [active, setActive] = useState(-1)

  const uid = useId()
  const listId = `${uid}-list`
  const open = anchor !== null
  const selected = options.findIndex((o) => o.value === value)
  const label = selected >= 0 ? options[selected].label : (placeholder ?? '')

  const close = useCallback(() => {
    setAnchor(null)
    setActive(-1)
  }, [])

  function openMenu() {
    const btn = btnRef.current
    if (!btn) return
    setAnchor(anchorFor(btn))
    // À l'ouverture, on part de la valeur courante.
    setActive(selected >= 0 ? selected : options.length > 0 ? 0 : -1)
  }

  function choose(opt: SelectOption) {
    onChange(opt.value)
    close()
    btnRef.current?.focus()
  }

  // Clic dehors, et décrochage du panneau : le scroll est écouté en CAPTURE car
  // un scroll ne remonte pas — c'est le corps du dialog qui défile sous nous.
  useEffect(() => {
    if (!open) return
    const inside = (n: EventTarget | null) =>
      n instanceof Node && (btnRef.current?.contains(n) === true || panelRef.current?.contains(n) === true)
    const onDown = (e: MouseEvent) => {
      if (!inside(e.target)) close()
    }
    const onScroll = (e: Event) => {
      // Le panneau défile en interne : seul un scroll EXTÉRIEUR le décroche.
      if (e.target instanceof Node && panelRef.current?.contains(e.target) === true) return
      close()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close])

  // L'option active reste visible — y compris la sélection courante à
  // l'ouverture. En layout effect : avant la peinture, donc sans saut visible.
  useLayoutEffect(() => {
    if (!open || active < 0) return
    panelRef.current?.querySelector<HTMLElement>(`[data-idx='${active}']`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  function move(delta: number) {
    if (options.length === 0) return
    const from = active >= 0 ? active : selected
    const next = from < 0 ? (delta > 0 ? 0 : options.length - 1) : from + delta
    setActive(Math.min(options.length - 1, Math.max(0, next)))
  }

  return (
    <>
      <button
        ref={btnRef}
        id={id}
        type="button"
        className={`select-menu-btn${selected < 0 ? ' empty' : ''}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${uid}-opt-${active}` : undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // Menu fermé : Échap appartient au Dialog parent (qui écoute la
            // fenêtre). Ouvert : on ne ferme QUE le menu.
            if (!open) return
            e.stopPropagation()
            close()
            return
          }
          if (e.key === 'Tab') {
            close()
            return
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (!open) openMenu()
            else move(e.key === 'ArrowDown' ? 1 : -1)
            return
          }
          if (e.key === 'Enter' || e.key === ' ') {
            // Sans ça le bouton déclencherait AUSSI son click (donc un toggle).
            e.preventDefault()
            if (!open) {
              openMenu()
              return
            }
            const opt = options[active]
            if (active >= 0 && opt) choose(opt)
            else close()
          }
        }}
      >
        {label}
      </button>
      {anchor &&
        createPortal(
          <div
            ref={panelRef}
            id={listId}
            className="select-menu-panel"
            role="listbox"
            aria-label={t('selectMenuOptions')}
            style={{
              left: anchor.left,
              width: anchor.width,
              maxHeight: anchor.maxHeight,
              top: anchor.top,
              bottom: anchor.bottom,
            }}
            // Garde le focus sur le bouton (un div n'est pas focusable : le clic
            // le ferait sinon partir sur <body>) et évite la sélection de texte.
            onMouseDown={(e) => e.preventDefault()}
          >
            {options.length === 0 ? (
              <p className="select-menu-empty">{t('selectMenuEmpty')}</p>
            ) : (
              options.map((o, i) => (
                <div
                  key={o.value}
                  id={`${uid}-opt-${i}`}
                  data-idx={i}
                  className={`select-menu-option${i === active ? ' active' : ''}`}
                  role="option"
                  aria-selected={i === selected}
                  title={o.label}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                >
                  {o.label}
                </div>
              ))
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
