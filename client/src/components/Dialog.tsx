// Dialog générique : carte centrée sur desktop, plein écran sur mobile.
// Fermeture : bouton X, touche Échap, clic sur le fond — les trois passent par
// guardClose (si fournie) : renvoyer false pour annuler la fermeture (saisies non enregistrées).
import { useEffect, type ReactNode } from 'react'
import { useI18n } from '../i18n'

interface Props {
  title: string
  onClose: () => void
  /** Garde appliquée aux trois chemins de fermeture (Échap, fond, X). false = on ne ferme pas. */
  guardClose?: () => boolean
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}

export default function Dialog({ title, onClose, guardClose, children, footer, wide }: Props) {
  const { t } = useI18n()

  const tryClose = () => {
    if (guardClose && !guardClose()) return
    onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (guardClose && !guardClose()) return
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, guardClose])

  return (
    <div
      className="dialog-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) tryClose()
      }}
    >
      <div className={`dialog-card${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={tryClose} title={t('close')} aria-label={t('close')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-footer">{footer}</footer>}
      </div>
    </div>
  )
}
