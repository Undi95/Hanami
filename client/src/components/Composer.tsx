// Zone de saisie : textarea auto-grandissante, Entrée = envoyer (desktop),
// Maj+Entrée = retour ligne, bouton stop pendant le streaming.
import { useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n'

interface Props {
  disabled: boolean
  streaming: boolean
  onSend: (text: string) => void
  onStop: () => void
}

export default function Composer({ disabled, streaming, onSend, onStop }: Props) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  // Sur mobile (pointeur grossier), Entrée fait un retour ligne : le bouton envoie.
  const coarse = useMemo(() => window.matchMedia('(pointer: coarse)').matches, [])

  function autosize() {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  function submit() {
    const t = text.trim()
    if (!t || disabled || streaming) return
    onSend(t)
    setText('')
    requestAnimationFrame(() => {
      const el = taRef.current
      if (el) el.style.height = 'auto'
    })
  }

  return (
    <div className="composer">
      <textarea
        ref={taRef}
        rows={1}
        value={text}
        placeholder={t('writeMessage')}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value)
          autosize()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !coarse) {
            e.preventDefault()
            submit()
          }
        }}
      />
      {streaming ? (
        <button className="send-btn stop" onClick={onStop} title={t('stop')} aria-label={t('stop')}>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
          </svg>
        </button>
      ) : (
        <button
          className="send-btn"
          onClick={submit}
          disabled={disabled || !text.trim()}
          title={t('send')}
          aria-label={t('send')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12l16-7-5.5 16-3-6.5L4 12z" />
            <path d="M11.5 14.5L20 5" />
          </svg>
        </button>
      )}
    </div>
  )
}
