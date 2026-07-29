// Fil de messages : bulles (Markdown), pensées, puces outil, erreurs, greeting,
// édition en place, autoscroll intelligent, recherche Ctrl+F. Contient aussi la
// boîte de dialogue du mode visual novel (VnBox), qui rejoue la dernière
// réplique du même fil.
import { cloneElement, isValidElement, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
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
  /** Ctrl+F actif : coupé quand un dialog ou l'écran de connexion tient le clavier. */
  searchable: boolean
  /** Ordinal du message épinglé — null = aucun. Pur affichage, hors payload LLM. */
  pinned: number | null
  /** Sauvegarde une édition — ordinal = position parmi les messages sauvegardés. */
  onSaveEdit: (ordinal: number, content: string) => Promise<void>
  /** « Retiens ça » : épingle le contenu du message dans la mémoire. */
  onRemember: (msg: ChatMessage) => void
  /** Cible le message dans le composer (la citation sera écrite dans l'envoi). */
  onReply: (msg: ChatMessage) => void
  /** Épingle un message (remplace l'épingle précédente) ou la retire (null). */
  onPin: (ordinal: number | null) => void
}

// ── Recherche dans le fil ──────────────────────────────────────────────────
// Choix d'implémentation : le surlignage est appliqué APRÈS le rendu Markdown,
// en parcourant l'arbre de nœuds renvoyé par renderMarkdown et en ne découpant
// que les chaînes de texte. La source n'est jamais touchée, donc le Markdown ne
// peut pas être cassé. Contrepartie assumée : une correspondance à cheval sur
// deux styles (« bon**jour** ») n'est pas trouvée, et seules les bulles de
// conversation sont fouillées (pas les pensées, puces outil, erreurs ni infos).

/** État du parcours : la requête, le compteur global et la correspondance visée. */
interface Hits {
  /** Requête repliée (casse/accents) — chaîne vide = aucune recherche en cours. */
  needle: string
  /** Nombre de correspondances rencontrées jusqu'ici (mutation pendant le rendu). */
  n: number
  /** Index de la correspondance mise en avant (celle vers laquelle on défile). */
  active: number
}

/**
 * Repli casse/accents à longueur constante : chaque unité UTF-16 en produit
 * exactement une, donc un index calculé sur le texte replié vaut aussi sur le
 * texte d'origine (indispensable pour découper au bon endroit).
 */
function fold(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) out += s[i].normalize('NFD').toLowerCase()[0]
  return out
}

/** Découpe une chaîne rendue autour des correspondances (un <mark> par coup). */
function splitHits(text: string, hits: Hits): ReactNode {
  const hay = fold(text)
  const out: ReactNode[] = []
  let last = 0
  for (let i = hay.indexOf(hits.needle); i !== -1; i = hay.indexOf(hits.needle, last)) {
    if (i > last) out.push(text.slice(last, i))
    const n = hits.n++
    out.push(
      <mark key={`hit-${n}`} className={n === hits.active ? 'search-hit current' : 'search-hit'}>
        {text.slice(i, i + hits.needle.length)}
      </mark>,
    )
    last = i + hits.needle.length
  }
  if (out.length === 0) return text
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Parcours récursif de l'arbre rendu : seules les chaînes sont réécrites. */
function highlight(node: ReactNode, hits: Hits): ReactNode {
  if (typeof node === 'string') return splitHits(node, hits)
  if (Array.isArray(node)) return node.map((child: ReactNode) => highlight(child, hits))
  if (isValidElement<{ children?: ReactNode }>(node)) {
    const children = node.props.children
    if (children === undefined) return node
    return cloneElement(node, undefined, highlight(children, hits))
  }
  return node
}

/** Surligne les nœuds d'une bulle — sans recherche en cours, c'est l'identité. */
function highlightAll(nodes: ReactNode[], hits: Hits): ReactNode[] {
  return hits.needle === '' ? nodes : nodes.map((n) => highlight(n, hits))
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

export default function MessageList({
  items,
  showThoughts,
  editable,
  searchable,
  pinned,
  onSaveEdit,
  onRemember,
  onReply,
  onPin,
}: Props) {
  const { lang, t } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const [editing, setEditing] = useState<number | null>(null) // ordinal en cours d'édition
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  // Bandeau épinglé : replié (2 lignes) par défaut, déplié au clic.
  const [pinOpen, setPinOpen] = useState(false)
  // Recherche : rien à l'écran tant qu'elle n'est pas ouverte (Ctrl+F).
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  // Autoscroll uniquement si l'utilisateur est déjà en bas du fil.
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [items])

  // ── Recherche ────────────────────────────────────────────────────────────

  function closeSearch() {
    setSearchOpen(false)
    setQuery('')
    setActive(0)
  }

  // Ctrl+F / Cmd+F ouvre le champ (et le resélectionne s'il est déjà là) ;
  // Échap le referme. Le raccourci est confisqué au navigateur : on cherche
  // dans la conversation, pas dans la page.
  useEffect(() => {
    if (!searchable) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        const input = searchRef.current
        if (input) {
          input.focus()
          input.select()
        } else setSearchOpen(true) // le focus suit à l'ouverture (effet ci-dessous)
      } else if (e.key === 'Escape' && searchRef.current) {
        e.preventDefault()
        closeSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchable])

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

  // Nouvelle saisie : on repart de la première correspondance.
  useEffect(() => {
    setActive(0)
  }, [query])

  // Une nouvelle épingle s'affiche toujours repliée.
  useEffect(() => {
    setPinOpen(false)
  }, [pinned])

  const hits: Hits = { needle: searchOpen ? fold(query) : '', n: 0, active }

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
                  highlightAll(renderMarkdown(text), hits)
                )}
              </div>
            )}
            {!item.pending && !isEditing && (
              <div className="msg-ts">
                {fmtTime(item.msg.ts, lang)}
                {editable && ordinal !== null && (
                  <>
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
                    <button
                      className="msg-edit"
                      title={t('replyToMessage')}
                      aria-label={t('replyToMessage')}
                      onClick={() => onReply(item.msg)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9.5 7.5L5 12l4.5 4.5" />
                        <path d="M5 12h8a6 6 0 016 6v1" />
                      </svg>
                    </button>
                    <button
                      className="msg-edit"
                      title={t('rememberThis')}
                      aria-label={t('rememberThis')}
                      onClick={() => onRemember(item.msg)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" />
                      </svg>
                    </button>
                    {/* Punaise : une seule par conversation — épingler ailleurs déplace le bandeau. */}
                    <button
                      className={ordinal === pinned ? 'msg-edit pinned' : 'msg-edit'}
                      title={ordinal === pinned ? t('unpin') : t('pinMessage')}
                      aria-label={ordinal === pinned ? t('unpin') : t('pinMessage')}
                      onClick={() => onPin(ordinal === pinned ? null : ordinal)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9.5 3.5h5l-.8 5.4 3.3 3.1H7l3.3-3.1z" />
                        <path d="M12 12v8" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )
      }
      case 'greeting':
        return (
          <div className="msg assistant">
            <div className="bubble">{highlightAll(renderMarkdown(stripEmotionTags(item.text)), hits)}</div>
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

  // Le fil est construit AVANT la barre : c'est ce rendu qui compte les
  // correspondances (hits.n), et la barre en affiche le total.
  const rows = items.map((it, i) => (
    <div key={i} style={{ display: 'contents' }}>
      {renderItem(it, ordinals[i])}
    </div>
  ))
  const total = hits.n

  // Les deux effets ci-dessous dépendent du total, donc du rendu du fil.
  // L'index visé peut sortir de la plage (message édité, réponse régénérée…).
  useEffect(() => {
    if (active > 0 && active >= total) setActive(total > 0 ? total - 1 : 0)
  }, [active, total])

  // Amène la correspondance visée à l'écran (et décolle l'autoscroll : le fil
  // ne redescendra pas tout seul pendant qu'on lit un vieux message).
  useEffect(() => {
    if (hits.needle === '') return
    scrollRef.current?.querySelector('.search-hit.current')?.scrollIntoView({ block: 'center' })
  }, [hits.needle, active])

  function step(delta: number) {
    if (total === 0) return
    setActive((a) => (a + delta + total) % total)
  }

  // Message épinglé, retrouvé par son ordinal. Introuvable (dernière réponse
  // régénérée, par exemple) : pas de bandeau, l'épingle attend son prochain clic.
  let pinnedMsg: ChatMessage | null = null
  if (pinned !== null) {
    const it = items[ordinals.indexOf(pinned)]
    if (it && it.kind === 'msg') pinnedMsg = it.msg
  }

  return (
    <div className="messages-wrap">
      {searchOpen && (
        <div className="search-bar" role="search">
          <input
            ref={searchRef}
            type="text"
            value={query}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                step(e.shiftKey ? -1 : 1)
              }
            }}
          />
          {hits.needle !== '' && (
            <span className="search-count">
              {t('searchCount', { n: Math.min(active + 1, total), m: total })}
            </span>
          )}
          <button
            className="search-nav"
            disabled={total === 0}
            onClick={() => step(-1)}
            title={t('searchPrev')}
            aria-label={t('searchPrev')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
          <button
            className="search-nav"
            disabled={total === 0}
            onClick={() => step(1)}
            title={t('searchNext')}
            aria-label={t('searchNext')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M6 13l6 6 6-6" />
            </svg>
          </button>
          <button
            className="search-nav"
            onClick={closeSearch}
            title={t('searchClose')}
            aria-label={t('searchClose')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      )}

      {pinnedMsg && (
        <div className={pinOpen ? 'pin-ribbon open' : 'pin-ribbon'}>
          <button
            className="pin-ribbon-text"
            aria-expanded={pinOpen}
            onClick={() => setPinOpen((o) => !o)}
          >
            {pinnedMsg.role === 'user' ? pinnedMsg.content : stripEmotionTags(pinnedMsg.content)}
          </button>
          <button
            className="pin-ribbon-close"
            title={t('unpin')}
            aria-label={t('unpin')}
            onClick={() => onPin(null)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      )}

      <div
        className="messages"
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current
          if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {rows}
      </div>
    </div>
  )
}

// ── Mode visual novel ──────────────────────────────────────────────────────

/** Seuls les items de conversation ont leur place dans la boîte VN. */
type VnItem = Extract<FeedItem, { kind: 'msg' } | { kind: 'greeting' }>

/**
 * Boîte de dialogue horizontale du mode visual novel : uniquement la DERNIÈRE
 * réplique (les pensées, appels d'outils, erreurs et infos restent au fil
 * complet). Le streaming s'y affiche tel quel — c'est le même `items`.
 */
export function VnBox({ items, characterName }: { items: FeedItem[]; characterName: string }) {
  const { t } = useI18n()
  const boxRef = useRef<HTMLDivElement>(null)

  // Une réplique plus haute que la boîte défile : on reste collé au bas pendant
  // que le texte arrive (une seule réplique affichée, pas d'autoscroll malin).
  useEffect(() => {
    const el = boxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items])

  // Les erreurs survenues APRÈS la dernière réplique doivent rester visibles en
  // mode VN (un échec de génération silencieux serait incompréhensible).
  let last: VnItem | null = null
  let trailingError: string | null = null
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'msg' || it.kind === 'greeting') {
      last = it
      break
    }
    if (it.kind === 'error' && trailingError === null) trailingError = it.text
  }
  if (!last && !trailingError) return null

  const isUser = last !== null && last.kind === 'msg' && last.msg.role === 'user'
  const pending = last !== null && last.kind === 'msg' && !!last.pending
  const text =
    last === null
      ? ''
      : last.kind === 'greeting'
        ? stripEmotionTags(last.text)
        : isUser
          ? last.msg.content
          : stripEmotionTags(last.msg.content)

  return (
    // L'étiquette de nom chevauche la bordure supérieure (namebox de visual
    // novel) : la boîte ne défile pas elle-même — c'est .vn-text qui scrolle,
    // sinon l'étiquette en position négative serait rognée par l'overflow.
    <div className="vn-box">
      {last !== null && <div className="vn-name">{isUser ? t('vnYou') : characterName}</div>}
      {last !== null && (
        <div className="vn-text" ref={boxRef}>
          {pending && !text ? (
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
      {trailingError && <div className="error-bubble vn-error">{trailingError}</div>}
    </div>
  )
}
