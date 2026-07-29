// Fil de messages : bulles, puces outil, erreurs, greeting, autoscroll intelligent.
import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../../../shared/types'
import { stripEmotionTags } from '../emotions'
import { localeOf, useI18n, type Lang } from '../i18n'

export type FeedItem =
  | { kind: 'msg'; msg: ChatMessage; pending?: boolean }
  | { kind: 'tool'; name: string; args: string }
  | { kind: 'error'; text: string }
  | { kind: 'greeting'; text: string }

function fmtTime(ts: string, lang: Lang): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(localeOf(lang), { hour: '2-digit', minute: '2-digit' })
}

/** Résumé court des arguments d'un appel d'outil (ex. "memory_save : souvenirs.md"). */
function summarizeArgs(args: string): string {
  let out = args
  try {
    const obj = JSON.parse(args) as Record<string, unknown>
    const v =
      obj.name ?? obj.path ?? obj.file ?? Object.values(obj).find((x) => typeof x === 'string' && x.length > 0)
    if (typeof v === 'string' && v) out = v
  } catch {
    /* args non JSON : on tronque le brut */
  }
  return out.length > 48 ? out.slice(0, 45) + '…' : out
}

function Item({ item }: { item: FeedItem }) {
  const { lang, t } = useI18n()

  switch (item.kind) {
    case 'msg': {
      const isUser = item.msg.role === 'user'
      const text = isUser ? item.msg.content : stripEmotionTags(item.msg.content)
      return (
        <div className={`msg ${isUser ? 'user' : 'assistant'}`}>
          <div className="bubble">
            {item.pending && !text ? (
              <span className="typing" aria-label={t('replyInProgress')}>
                <i />
                <i />
                <i />
              </span>
            ) : (
              text
            )}
          </div>
          {!item.pending && <div className="msg-ts">{fmtTime(item.msg.ts, lang)}</div>}
        </div>
      )
    }
    case 'greeting':
      return (
        <div className="msg assistant">
          <div className="bubble">{stripEmotionTags(item.text)}</div>
        </div>
      )
    case 'tool':
      return (
        <div className="tool-chip" title={item.args}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 6.5a4 4 0 015.5-3.7l-3 3 1.2 1.2 3-3a4 4 0 01-5.2 5.2l-8.5 8.5a1.8 1.8 0 01-2.5-2.5l8.5-8.5a4 4 0 011-.2z" />
          </svg>
          <span>{t('toolCall', { name: item.name, args: summarizeArgs(item.args) })}</span>
        </div>
      )
    case 'error':
      return <div className="error-bubble">{item.text}</div>
  }
}

export default function MessageList({ items }: { items: FeedItem[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  // Autoscroll uniquement si l'utilisateur est déjà en bas du fil.
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [items])

  return (
    <div
      className="messages"
      ref={scrollRef}
      onScroll={() => {
        const el = scrollRef.current
        if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
    >
      {items.map((it, i) => (
        <Item key={i} item={it} />
      ))}
    </div>
  )
}
