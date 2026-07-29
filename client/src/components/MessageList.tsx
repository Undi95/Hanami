// Fil de messages : bulles (Markdown), pensées, puces outil, erreurs, greeting,
// édition en place, autoscroll intelligent.
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../../shared/types'
import { stripEmotionTags } from '../emotions'
import { localeOf, useI18n, type Lang } from '../i18n'
import { renderMarkdown } from '../markdown'

export type FeedItem =
  | { kind: 'msg'; msg: ChatMessage; pending?: boolean }
  | { kind: 'tool'; name: string; args: string }
  | { kind: 'error'; text: string }
  | { kind: 'info'; text: string } // ligne discrète (compaction…) — jamais sauvegardée
  | { kind: 'greeting'; text: string }

interface Props {
  items: FeedItem[]
  showThoughts: boolean
  editable: boolean
  /** Sauvegarde une édition — ordinal = position parmi les messages sauvegardés. */
  onSaveEdit: (ordinal: number, content: string) => Promise<void>
}

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

export default function MessageList({ items, showThoughts, editable, onSaveEdit }: Props) {
  const { lang, t } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const [editing, setEditing] = useState<number | null>(null) // ordinal en cours d'édition
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Autoscroll uniquement si l'utilisateur est déjà en bas du fil.
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [items])

  // Ordinal (position dans le fichier) de chaque item 'msg', calculé d'avance.
  const ordinals: (number | null)[] = []
  {
    let n = -1
    for (const it of items) ordinals.push(it.kind === 'msg' ? ++n : null)
  }

  function startEdit(ordinal: number, msg: ChatMessage) {
    setEditing(ordinal)
    setDraft(msg.content)
    setEditError(null)
  }

  function submitEdit() {
    if (editing === null || !draft.trim()) return
    setSaving(true)
    setEditError(null)
    onSaveEdit(editing, draft)
      .then(() => setEditing(null))
      .catch((e) => setEditError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false))
  }

  function renderItem(item: FeedItem, ordinal: number | null) {
    switch (item.kind) {
      case 'msg': {
        const isUser = item.msg.role === 'user'
        const text = isUser ? item.msg.content : stripEmotionTags(item.msg.content)
        const isEditing = ordinal !== null && editing === ordinal
        return (
          <div className={`msg ${isUser ? 'user' : 'assistant'}`}>
            {!isUser && showThoughts && item.msg.thinking && (
              <details className="thoughts">
                <summary>{t('thoughts')}</summary>
                <div className="thoughts-body">{item.msg.thinking}</div>
              </details>
            )}
            {isEditing ? (
              <div className="bubble editing">
                <textarea value={draft} rows={4} onChange={(e) => setDraft(e.target.value)} />
                {editError && <span className="msg-err">{editError}</span>}
                <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                  <button className="btn small" disabled={saving} onClick={() => setEditing(null)}>
                    {t('cancel')}
                  </button>
                  <button className="btn small primary" disabled={saving || !draft.trim()} onClick={submitEdit}>
                    {saving ? t('saving') : t('save')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="bubble">
                {item.pending && !text ? (
                  <span className="typing" aria-label={t('replyInProgress')}>
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  renderMarkdown(text)
                )}
              </div>
            )}
            {!item.pending && !isEditing && (
              <div className="msg-ts">
                {fmtTime(item.msg.ts, lang)}
                {editable && ordinal !== null && (
                  <button
                    className="msg-edit"
                    title={t('editMessage')}
                    aria-label={t('editMessage')}
                    onClick={() => startEdit(ordinal, item.msg)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 00-3-3L5 17z" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
        )
      }
      case 'greeting':
        return (
          <div className="msg assistant">
            <div className="bubble">{renderMarkdown(stripEmotionTags(item.text))}</div>
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
      case 'info':
        return <div className="info-line">{item.text}</div>
    }
  }

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
        <div key={i} style={{ display: 'contents' }}>
          {renderItem(it, ordinals[i])}
        </div>
      ))}
    </div>
  )
}
