// Fil de messages : bulles (Markdown), pensées, puces outil, erreurs, greeting,
// édition en place, autoscroll intelligent, recherche Ctrl+F. Contient aussi la
// boîte de dialogue du mode visual novel (VnBox), qui rejoue la dernière
// réplique du même fil.
import { cloneElement, isValidElement, memo, useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import type { ChatMessage } from '../../../shared/types'
import { stripEmotionTags } from '../emotions'
import { localeOf, useI18n, type Key, type Lang, type Vars } from '../i18n'
import { renderMarkdown } from '../markdown'
import { VnBoxGrip } from './ResizeGrips'

export type FeedItem =
  | { kind: 'msg'; msg: ChatMessage; pending?: boolean }
  // `pending` = l'action est EN COURS (pas de résultat encore) : la puce
  // pulse, l'événement `tool` la fige en trace au même endroit.
  | { kind: 'tool'; name: string; args: string; result?: string; pending?: boolean }
  | { kind: 'error'; text: string }
  | { kind: 'info'; text: string } // ligne discrète (compaction…) — jamais sauvegardée
  | { kind: 'greeting'; text: string }

interface Props {
  items: FeedItem[]
  showThoughts: boolean
  editable: boolean
  /** Ctrl+F actif : coupé quand un dialog ou l'écran de connexion tient le clavier. */
  searchable: boolean
  /**
   * Compteur bumpé par le parent (loupe de la TopBar) : chaque incrément bascule
   * la barre de recherche. Un simple nombre suffit — le Ctrl+F reste autonome et
   * la valeur initiale n'ouvre rien.
   */
  searchSignal: number
  /**
   * Même grammaire que `searchSignal` : le parent bumpe (flèche haut dans un
   * composer vide), et le fil ouvre en édition le DERNIER message de
   * l'utilisateur. La mécanique d'édition vit ici, la demande vient d'ailleurs.
   */
  editLastSignal: number
  /** Ordinal du message épinglé — null = aucun. Pur affichage, hors payload LLM. */
  pinned: number | null
  /** Sauvegarde une édition — ordinal = position parmi les messages sauvegardés. */
  onSaveEdit: (ordinal: number, content: string) => Promise<void>
  /** Retire un message du fil — même ordinal que l'édition. */
  onDeleteMessage: (ordinal: number) => Promise<void>
  /**
   * Retire une puce d'appel d'outil (ex. « Recherche sur le Web… ») du fil —
   * index BRUT dans `items` (une puce n'a pas d'ordinal : rien n'est sauvegardé
   * pour elle, la suppression est donc purement locale, sans aller-retour serveur).
   */
  onDeleteTool: (index: number) => void
  /**
   * Change la variante affichée d'une réponse (« Régénérer » les empile). Même
   * ordinal que l'édition : une variante ne crée aucun message, elle vit DANS
   * celui-ci.
   */
  onSwitchVariant: (ordinal: number, variant: number) => Promise<void>
  /** « Retiens ça » : épingle le contenu du message dans la mémoire. */
  onRemember: (msg: ChatMessage) => void
  /** Cible le message dans le composer (la citation sera écrite dans l'envoi). */
  onReply: (msg: ChatMessage) => void
  /** Épingle un message (remplace l'épingle précédente) ou la retire (null). */
  onPin: (ordinal: number | null) => void
  /** Rejoue la réplique à voix haute — null quand la synthèse vocale est coupée. */
  onReplay: ((msg: ChatMessage) => void) | null
  /**
   * `ts` du message dont la voix est en cours de lecture (null = silence) : son
   * haut-parleur devient un carré « stop ». Le `ts` plutôt que l'ordinal — c'est
   * le message qui parle, et il garde son identité même si le fil bouge.
   */
  ttsPlaying: string | null
  /** Coupe la lecture en cours (clic sur le carré). */
  onStopTts: () => void
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

// ── Images jointes ─────────────────────────────────────────────────────────

/** Vignettes d'un message (images jointes) — clic = image en grand. */
function Shots({ images, onOpen }: { images: string[]; onOpen: (url: string) => void }) {
  const { t } = useI18n()
  return (
    <div className="msg-shots">
      {images.map((url, i) => (
        <button
          key={i}
          className="msg-shot"
          title={t('viewImage')}
          aria-label={t('viewImage')}
          onClick={() => onOpen(url)}
        >
          <img src={url} alt={t('imageAlt')} />
        </button>
      ))}
    </div>
  )
}

/**
 * Image en grand : un simple calque plein écran qui se ferme au clic (ou au
 * clavier, c'est un bouton). Volontairement PAS un Dialog — rien à titrer, rien
 * à valider, et Échap reste à la recherche du fil et au mode visual novel.
 *
 * Rendu en portail sur <body> : le panneau de chat porte un backdrop-filter,
 * qui fait de lui le bloc conteneur de ses descendants `position: fixed` — sans
 * portail, le « plein écran » se limiterait à la largeur du panneau.
 */
function ImageOverlay({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useI18n()
  return createPortal(
    <button className="image-overlay" title={t('closeImage')} aria-label={t('closeImage')} onClick={onClose}>
      <img src={url} alt={t('imageAlt')} />
    </button>,
    document.body,
  )
}

// ── Variantes de réponse ───────────────────────────────────────────────────
// « Régénérer » n'écrase plus : chaque réponse générée reste, et on feuillette.
// Le message porte la liste et l'indice affiché (shared/types.ts) ; l'UI n'a
// donc rien à retenir — elle lit la donnée et renvoie l'indice voulu.

/** Position affichée dans les variantes d'un message — null s'il n'en a pas. */
export function messageVariants(msg: ChatMessage): { index: number; total: number } | null {
  const total = msg.variants?.length ?? 0
  return total >= 2 ? { index: msg.variant ?? 0, total } : null
}

/**
 * Flèches ‹ n/m › de la rangée du survol. Discrètes par construction : mêmes
 * boutons que les icônes voisines (.msg-edit), un compteur, et rien du tout
 * quand la réponse n'a qu'une version. Aux extrémités la flèche s'éteint plutôt
 * que de boucler — feuilleter n'est pas un carrousel.
 */
function Variants({ msg, onSwitch }: { msg: ChatMessage; onSwitch: (variant: number) => void }) {
  const { t } = useI18n()
  const v = messageVariants(msg)
  if (!v) return null
  const { index, total } = v
  const title = t('variantTitle', { n: index + 1, m: total })
  return (
    <span className="msg-variants" title={title}>
      <button
        className="msg-edit"
        disabled={index === 0}
        title={t('variantPrev')}
        aria-label={t('variantPrev')}
        onClick={() => onSwitch(index - 1)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 5.5L7.5 12l6.5 6.5" />
        </svg>
      </button>
      <span className="msg-vcount" aria-label={title}>
        {t('variantCount', { n: index + 1, m: total })}
      </span>
      <button
        className="msg-edit"
        disabled={index === total - 1}
        title={t('variantNext')}
        aria-label={t('variantNext')}
        onClick={() => onSwitch(index + 1)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 5.5l6.5 6.5-6.5 6.5" />
        </svg>
      </button>
    </span>
  )
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

interface SearchResultEntry {
  title: string
  url: string
  snippet: string
}

// Format produit par server/tools/webSearchTools.ts : "N. Titre\nURL\nExtrait",
// un résultat par paragraphe. Liste vide = format non reconnu (échec, garde-fou,
// « aucun résultat ») — la puce retombe alors sur le texte brut du résultat.
function parseSearchResults(result: string): SearchResultEntry[] {
  const entries: SearchResultEntry[] = []
  for (const block of result.split('\n\n')) {
    const lines = block.split('\n')
    const m = /^\d+\.\s*(.+)$/.exec(lines[0] ?? '')
    const url = (lines[1] ?? '').trim()
    if (!m || !/^https?:\/\//.test(url)) continue
    entries.push({ title: m[1].trim(), url, snippet: lines.slice(2).join(' ').trim() })
  }
  return entries
}

/**
 * Libellé lisible d'une trace d'action : « Modifie notes.md » plutôt que
 * « edit_file : {"path":"notes.md"} ». La cible est l'argument propre à
 * l'outil (`path` pour les fichiers, `name` pour la mémoire) ; sans cible
 * identifiable, on retombe sur l'affichage technique (`toolCall`). `pending`
 * ajoute la suite de points « en cours ».
 */
function toolLabel(name: string, args: string, pending: boolean, t: (key: Key, vars?: Vars) => string): string {
  const suffix = pending ? '…' : ''
  let target = ''
  try {
    const a = JSON.parse(args) as Record<string, unknown>
    target = typeof a.path === 'string' ? a.path : typeof a.name === 'string' ? a.name : ''
  } catch {
    /* args non JSON : affichage technique */
  }
  if (target) {
    switch (name) {
      case 'read_file':
        return t('toolTraceRead', { target }) + suffix
      case 'write_file':
        return t('toolTraceWrite', { target }) + suffix
      case 'edit_file':
        return t('toolTraceEdit', { target }) + suffix
      case 'delete_file':
        return t('toolTraceDelete', { target }) + suffix
      case 'memory_save':
        return t('toolTraceMemSave', { target }) + suffix
      case 'memory_update':
        return t('toolTraceMemUpdate', { target }) + suffix
      case 'memory_append':
        return t('toolTraceMemAppend', { target }) + suffix
      case 'memory_read':
        return t('toolTraceMemRead', { target }) + suffix
      case 'memory_delete':
        return t('toolTraceMemDelete', { target }) + suffix
    }
  }
  if (name === 'list_files') return t('toolTraceList') + suffix
  return t('toolCall', { name, args: summarizeArgs(args) }) + suffix
}

// ── Rendu mémoïsé (hors recherche/édition) ─────────────────────────────────
// Pendant le streaming, App.tsx re-render à chaque delta de texte (setFeed) :
// SANS mémoïsation, chaque token relance renderMarkdown + reconstruit tout le
// JSX pour la TOTALITÉ de l'historique, alors qu'un seul message change. Ces
// deux composants (React.memo) ne re-render que si LEURS props changent —
// items non modifiés (référence stable, cf. App.tsx qui ne recrée QUE l'item
// en cours de streaming) + drapeaux dérivés (isArmed, isCopied…) à false pour
// tous les autres. N'entrent en jeu que hors recherche ET hors édition : ces
// deux modes gardent le rendu séquentiel d'origine (renderItem plus bas),
// seuls capables de numéroter les correspondances de recherche à cheval sur
// plusieurs messages — un besoin que la mémoïsation par item ne peut pas
// satisfaire sans casser cette numérotation.

const ToolChip = memo(function ToolChip({
  item,
  index,
  editable,
  isArmed,
  setArmedTool,
  onDeleteTool,
}: {
  item: Extract<FeedItem, { kind: 'tool' }>
  index: number
  editable: boolean
  isArmed: boolean
  setArmedTool: Dispatch<SetStateAction<number | null>>
  onDeleteTool: (index: number) => void
}) {
  const { t } = useI18n()
  const isSearch = item.name === 'web_search'
  const results = parseSearchResults(item.result ?? '')

  // En cours : pillule simple, non interactive, qui pulse doucement —
  // l'événement `tool` la fige en trace (même endroit, avec le résultat).
  if (item.pending) {
    return (
      <span className="tool-chip tool-chip-pending" title={t('toolRunningHint')}>
        {isSearch ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="M20 20l-5-5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 6.5a4 4 0 015.5-3.7l-3 3 1.2 1.2 3-3a4 4 0 01-5.2 5.2l-8.5 8.5a1.8 1.8 0 01-2.5-2.5l8.5-8.5a4 4 0 011-.2z" />
          </svg>
        )}
        <span>
          {isSearch
            ? t('webSearchStatus', { query: summarizeArgs(item.args) })
            : toolLabel(item.name, item.args, true, t)}
        </span>
      </span>
    )
  }

  function handleDeleteClick(e: React.MouseEvent) {
    // Le clic sur la corbeille ne doit pas AUSSI ouvrir/fermer le panneau —
    // comportement natif par défaut d'un clic dans un <summary>.
    e.preventDefault()
    if (!isArmed) {
      setArmedTool(index)
      return
    }
    setArmedTool(null)
    onDeleteTool(index)
  }

  return (
    <details
      className="tool-chip-wrap"
      onMouseLeave={() => setArmedTool((a) => (a !== null && a === index ? null : a))}
    >
      <summary className="tool-chip" title={t('toolResultsHint')}>
        {isSearch ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="M20 20l-5-5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 6.5a4 4 0 015.5-3.7l-3 3 1.2 1.2 3-3a4 4 0 01-5.2 5.2l-8.5 8.5a1.8 1.8 0 01-2.5-2.5l8.5-8.5a4 4 0 011-.2z" />
          </svg>
        )}
        <span>
          {isSearch
            ? t('webSearchStatus', { query: summarizeArgs(item.args) })
            : toolLabel(item.name, item.args, false, t)}
        </span>
        {editable && (
          <button
            className={isArmed ? 'msg-edit armed' : 'msg-edit'}
            title={isArmed ? t('deleteMessageArmed') : t('deleteMessage')}
            aria-label={isArmed ? t('deleteMessageArmed') : t('deleteMessage')}
            onClick={handleDeleteClick}
            onBlur={() => setArmedTool((a) => (a === index ? null : a))}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 7.2h12" />
              <path d="M9.7 7.2V5.4h4.6v1.8" />
              <path d="M7.6 7.2l.8 11.4h7.2l.8-11.4" />
            </svg>
          </button>
        )}
      </summary>
      <div className="tool-chip-body">
        {results.length > 0 ? (
          results.map((r, i) => (
            <div className="result-entry" key={i}>
              <a className="result-title" href={r.url} target="_blank" rel="noopener noreferrer">
                {r.title}
              </a>
              <a className="result-url" href={r.url} target="_blank" rel="noopener noreferrer">
                {r.url}
              </a>
              {r.snippet && <div className="result-snippet">{r.snippet}</div>}
            </div>
          ))
        ) : (
          <div className="result-snippet">{item.result ?? ''}</div>
        )}
      </div>
    </details>
  )
})

interface MessageBubbleProps {
  item: Extract<FeedItem, { kind: 'msg' }>
  ordinal: number | null
  editable: boolean
  showThoughts: boolean
  isArmed: boolean
  isCopied: boolean
  isPinned: boolean
  isSpeaking: boolean
  setArmed: Dispatch<SetStateAction<number | null>>
  setCopied: Dispatch<SetStateAction<number | null>>
  setZoom: Dispatch<SetStateAction<string | null>>
  onStartEdit: (ordinal: number, msg: ChatMessage) => void
  onDeleteMessage: (ordinal: number) => Promise<void>
  onSwitchVariant: (ordinal: number, variant: number) => Promise<void>
  onReply: (msg: ChatMessage) => void
  onRemember: (msg: ChatMessage) => void
  onPin: (ordinal: number | null) => void
  onReplay: ((msg: ChatMessage) => void) | null
  onStopTts: () => void
}

const MessageBubble = memo(function MessageBubble({
  item,
  ordinal,
  editable,
  showThoughts,
  isArmed,
  isCopied,
  isPinned,
  isSpeaking,
  setArmed,
  setCopied,
  setZoom,
  onStartEdit,
  onDeleteMessage,
  onSwitchVariant,
  onReply,
  onRemember,
  onPin,
  onReplay,
  onStopTts,
}: MessageBubbleProps) {
  const { lang, t } = useI18n()
  const isUser = item.msg.role === 'user'
  const text = isUser ? item.msg.content : stripEmotionTags(item.msg.content, item.pending)

  function handleCopy() {
    if (ordinal === null) return
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(ordinal)
        window.setTimeout(() => setCopied((c) => (c === ordinal ? null : c)), 2000)
      })
      .catch((e) => console.error('[copy]', e))
  }

  function handleDeleteClick() {
    if (ordinal === null) return
    if (!isArmed) {
      setArmed(ordinal)
      return
    }
    setArmed(null)
    onDeleteMessage(ordinal).catch((e) => console.error('[delete]', e))
  }

  return (
    <div
      className={`msg ${isUser ? 'user' : 'assistant'}`}
      onMouseLeave={() => setArmed((a) => (a !== null && a === ordinal ? null : a))}
    >
      {!isUser && showThoughts && item.msg.thinking && (
        <details className="thoughts">
          <summary>{t('thoughts')}</summary>
          <div className="thoughts-body">{item.msg.thinking}</div>
        </details>
      )}
      <div className="bubble">
        {item.pending && !text ? (
          <span className="typing" aria-label={t('replyInProgress')}>
            <i />
            <i />
            <i />
          </span>
        ) : (
          <>
            {item.msg.images && item.msg.images.length > 0 && <Shots images={item.msg.images} onOpen={setZoom} />}
            {renderMarkdown(text)}
            <span className="bubble-ts">{fmtTime(item.msg.ts, lang)}</span>
          </>
        )}
      </div>
      {!item.pending && (
        <div className="msg-ts">
          {editable && ordinal !== null && (
            <>
              <Variants
                msg={item.msg}
                onSwitch={(variant) => {
                  onSwitchVariant(ordinal, variant).catch((e) => console.error('[variant]', e))
                }}
              />
              <button
                className="msg-edit"
                title={isCopied ? t('copied') : t('copyMessage')}
                aria-label={isCopied ? t('copied') : t('copyMessage')}
                onClick={handleCopy}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {isCopied ? (
                    <path d="M5 12.5l4.5 4.5L19 6.5" />
                  ) : (
                    <>
                      <path d="M11 9.5h6.5A1.5 1.5 0 0119 11v6.5a1.5 1.5 0 01-1.5 1.5H11a1.5 1.5 0 01-1.5-1.5V11A1.5 1.5 0 0111 9.5z" />
                      <path d="M6.5 14.5H6A1.5 1.5 0 014.5 13V6A1.5 1.5 0 016 4.5h7A1.5 1.5 0 0114.5 6v.5" />
                    </>
                  )}
                </svg>
              </button>
              <button
                className="msg-edit"
                title={t('editMessage')}
                aria-label={t('editMessage')}
                onClick={() => onStartEdit(ordinal, item.msg)}
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
              <button
                className={isPinned ? 'msg-edit pinned' : 'msg-edit'}
                title={isPinned ? t('unpin') : t('pinMessage')}
                aria-label={isPinned ? t('unpin') : t('pinMessage')}
                onClick={() => onPin(isPinned ? null : ordinal)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.5 3.5h5l-.8 5.4 3.3 3.1H7l3.3-3.1z" />
                  <path d="M12 12v8" />
                </svg>
              </button>
              {onReplay && item.msg.role === 'assistant' && (
                <button
                  className={isSpeaking ? 'msg-edit playing' : 'msg-edit'}
                  title={isSpeaking ? t('stopTts') : t('replayTts')}
                  aria-label={isSpeaking ? t('stopTts') : t('replayTts')}
                  onClick={() => (isSpeaking ? onStopTts() : onReplay(item.msg))}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    {isSpeaking ? (
                      <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" />
                    ) : (
                      <>
                        <path d="M10.5 5.5L6.5 9H4v6h2.5l4 3.5z" />
                        <path d="M14.5 9.5a3.5 3.5 0 010 5" />
                        <path d="M17 7a7 7 0 010 10" />
                      </>
                    )}
                  </svg>
                </button>
              )}
              <button
                className={isArmed ? 'msg-edit armed' : 'msg-edit'}
                title={isArmed ? t('deleteMessageArmed') : t('deleteMessage')}
                aria-label={isArmed ? t('deleteMessageArmed') : t('deleteMessage')}
                onClick={handleDeleteClick}
                onBlur={() => setArmed((a) => (a === ordinal ? null : a))}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 7.2h12" />
                  <path d="M9.7 7.2V5.4h4.6v1.8" />
                  <path d="M7.6 7.2l.8 11.4h7.2l.8-11.4" />
                </svg>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
})

export default function MessageList({
  items,
  showThoughts,
  editable,
  searchable,
  searchSignal,
  editLastSignal,
  pinned,
  onSaveEdit,
  onDeleteMessage,
  onDeleteTool,
  onSwitchVariant,
  onRemember,
  onReply,
  onPin,
  onReplay,
  ttsPlaying,
  onStopTts,
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
  // Image affichée en grand (null = aucune) — calque fermé au clic.
  const [zoom, setZoom] = useState<string | null>(null)
  // Message dont le texte vient d'être copié (ordinal) : l'icône devient une
  // coche pendant deux secondes, puis redevient elle-même. Même grammaire que le
  // bouton « Copier » de l'Inspecteur, en version icône.
  const [copied, setCopied] = useState<number | null>(null)
  // Corbeille armée (ordinal) : le premier clic arme, le second supprime — même
  // grammaire que les suppressions des dialogs. Désarmée dès qu'on la quitte.
  const [armed, setArmed] = useState<number | null>(null)
  // Même grammaire pour la corbeille d'une puce d'outil, mais indexée sur sa
  // position BRUTE dans `items` (une puce n'a pas d'ordinal).
  const [armedTool, setArmedTool] = useState<number | null>(null)
  // Recherche : rien à l'écran tant qu'elle n'est pas ouverte (Ctrl+F).
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  // Champ d'édition en cours (un seul à la fois) : sert à y poser le curseur.
  const editRef = useRef<HTMLTextAreaElement>(null)

  // Autoscroll : un NOUVEL item (message envoyé, réponse, chip) force le retour
  // en bas ; la simple croissance du texte en streaming respecte la position de
  // lecture (stick). Le scroll part en rAF, APRÈS la mise en page du contenu —
  // sinon il vise une hauteur périmée et s'arrête quelques lignes trop tôt.
  const prevLenRef = useRef(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (items.length !== prevLenRef.current) {
      prevLenRef.current = items.length
      stickRef.current = true
    }
    if (stickRef.current) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight
      })
    }
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

  // Loupe de la TopBar : le parent bumpe searchSignal, on bascule. La valeur vue
  // au montage sert de référence, donc le premier rendu n'ouvre rien (le fil est
  // remonté à chaque changement de chat : la référence se réaligne d'elle-même).
  const seenSignalRef = useRef(searchSignal)
  useEffect(() => {
    if (seenSignalRef.current === searchSignal) return
    seenSignalRef.current = searchSignal
    if (searchOpen) closeSearch()
    else setSearchOpen(true) // le focus suit (effet ci-dessous)
  }, [searchSignal, searchOpen])

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

  // Identité STABLE (ne dépend que de setters useState) : passée telle quelle
  // à MessageBubble (mémoïsé), elle ne casse donc jamais sa mémoïsation.
  const startEdit = useCallback((ordinal: number, msg: ChatMessage) => {
    setEditing(ordinal)
    setDraft(msg.content)
    setEditError(null)
  }, [])

  // Flèche haut du composer : le DERNIER message de l'utilisateur repasse en
  // édition. Rien ne se produit pendant un stream ou une compaction (`editable`
  // est faux : la rangée d'icônes est déjà retirée), ni dans un fil qui n'a
  // encore aucun message de l'utilisateur.
  const seenEditSignalRef = useRef(editLastSignal)
  useEffect(() => {
    if (seenEditSignalRef.current === editLastSignal) return
    seenEditSignalRef.current = editLastSignal
    if (!editable) return
    let n = -1
    let target: { ordinal: number; msg: ChatMessage } | null = null
    for (const it of items) {
      if (it.kind !== 'msg') continue
      n++
      if (it.msg.role === 'user' && !it.pending) target = { ordinal: n, msg: it.msg }
    }
    if (target) startEdit(target.ordinal, target.msg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editLastSignal])

  // Le champ d'édition prend le focus, curseur EN FIN de texte : qu'on y arrive
  // par le crayon ou par la flèche haut, on vient corriger la fin de sa phrase.
  useEffect(() => {
    const el = editRef.current
    if (editing === null || !el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  /**
   * Copie le texte AFFICHÉ du message (tags d'émotion retirés pour l'assistant,
   * comme dans la bulle) — pas la source brute : on copie ce qu'on lit.
   * Un presse-papiers refusé (contexte non sécurisé) ne dit rien à l'écran : le
   * bouton ne coche simplement pas.
   */
  function copyMessage(ordinal: number, text: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(ordinal)
        window.setTimeout(() => setCopied((c) => (c === ordinal ? null : c)), 2000)
      })
      .catch((e) => console.error('[copy]', e))
  }

  /** Premier clic : la corbeille passe au rouge. Second : le message s'en va. */
  function removeMessage(ordinal: number) {
    if (armed !== ordinal) {
      setArmed(ordinal)
      return
    }
    setArmed(null)
    onDeleteMessage(ordinal).catch((e) => console.error('[delete]', e))
  }

  /** Même geste que removeMessage, mais purement local — rien n'est sauvegardé pour une puce. */
  function removeTool(index: number) {
    if (armedTool !== index) {
      setArmedTool(index)
      return
    }
    setArmedTool(null)
    onDeleteTool(index)
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

  function renderItem(item: FeedItem, ordinal: number | null, index: number) {
    switch (item.kind) {
      case 'msg': {
        const isUser = item.msg.role === 'user'
        // `item.pending` : la réponse s'écrit encore, un tag d'émotion à moitié
        // arrivé n'a rien à faire à l'écran (cf. stripEmotionTags).
        const text = isUser ? item.msg.content : stripEmotionTags(item.msg.content, item.pending)
        const isEditing = ordinal !== null && editing === ordinal
        // Cette réplique est-elle celle qu'on entend en ce moment ?
        const speaking = ttsPlaying !== null && ttsPlaying === item.msg.ts
        return (
          <div
            className={`msg ${isUser ? 'user' : 'assistant'}`}
            // Quitter la bulle désarme la corbeille : à la souris les icônes
            // disparaissent, une corbeille restée armée sous le curseur suivant
            // supprimerait au premier clic.
            onMouseLeave={() => setArmed((a) => (a !== null && a === ordinal ? null : a))}
          >
            {!isUser && showThoughts && item.msg.thinking && (
              <details className="thoughts">
                <summary>{t('thoughts')}</summary>
                <div className="thoughts-body">{item.msg.thinking}</div>
              </details>
            )}
            {isEditing ? (
              <div className="bubble editing">
                <textarea ref={editRef} value={draft} rows={4} onChange={(e) => setDraft(e.target.value)} />
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
                  <>
                    {/* Images jointes AU-DESSUS du texte (un message peut n'être qu'une image). */}
                    {item.msg.images && item.msg.images.length > 0 && (
                      <Shots images={item.msg.images} onOpen={setZoom} />
                    )}
                    {highlightAll(renderMarkdown(text), hits)}
                    {/* Horodatage DANS la bulle, en bas à droite (façon messagerie). */}
                    <span className="bubble-ts">{fmtTime(item.msg.ts, lang)}</span>
                  </>
                )}
              </div>
            )}
            {!item.pending && !isEditing && (
              <div className="msg-ts">
                {editable && ordinal !== null && (
                  <>
                    {/* Variantes de la réponse (« Régénérer » les empile) : on
                        feuillette EN TÊTE de rangée, avant les actions — ces
                        flèches ne modifient rien, elles changent ce qu'on lit.
                        Clic seulement : la flèche haut du clavier appartient à
                        l'édition du dernier message. */}
                    <Variants
                      msg={item.msg}
                      onSwitch={(variant) => {
                        onSwitchVariant(ordinal, variant).catch((e) => console.error('[variant]', e))
                      }}
                    />
                    {/* Copier : la seule action qui ne touche à rien — d'où sa
                        place en tête de rangée. La coche remplace l'icône deux
                        secondes, c'est tout le retour visuel. */}
                    <button
                      className="msg-edit"
                      title={copied === ordinal ? t('copied') : t('copyMessage')}
                      aria-label={copied === ordinal ? t('copied') : t('copyMessage')}
                      onClick={() => copyMessage(ordinal, text)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        {copied === ordinal ? (
                          <path d="M5 12.5l4.5 4.5L19 6.5" />
                        ) : (
                          <>
                            <path d="M11 9.5h6.5A1.5 1.5 0 0119 11v6.5a1.5 1.5 0 01-1.5 1.5H11a1.5 1.5 0 01-1.5-1.5V11A1.5 1.5 0 0111 9.5z" />
                            <path d="M6.5 14.5H6A1.5 1.5 0 014.5 13V6A1.5 1.5 0 016 4.5h7A1.5 1.5 0 0114.5 6v.5" />
                          </>
                        )}
                      </svg>
                    </button>
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
                    {/* Haut-parleur — et carré « stop » PENDANT la lecture : une
                        voix qu'on lance doit pouvoir se couper au même endroit.
                        La classe `playing` le montre sans attendre le survol
                        (cf. styles.css) : chercher la bulle pour faire taire une
                        réplique serait absurde. */}
                    {onReplay && item.msg.role === 'assistant' && (
                      <button
                        className={speaking ? 'msg-edit playing' : 'msg-edit'}
                        title={speaking ? t('stopTts') : t('replayTts')}
                        aria-label={speaking ? t('stopTts') : t('replayTts')}
                        onClick={() => (speaking ? onStopTts() : onReplay(item.msg))}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          {speaking ? (
                            <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" />
                          ) : (
                            <>
                              <path d="M10.5 5.5L6.5 9H4v6h2.5l4 3.5z" />
                              <path d="M14.5 9.5a3.5 3.5 0 010 5" />
                              <path d="M17 7a7 7 0 010 10" />
                            </>
                          )}
                        </svg>
                      </button>
                    )}
                    {/* Corbeille EN DERNIER, comme la zone dangereuse d'un
                        formulaire : c'est la seule action irréversible du lot. */}
                    <button
                      className={armed === ordinal ? 'msg-edit armed' : 'msg-edit'}
                      title={armed === ordinal ? t('deleteMessageArmed') : t('deleteMessage')}
                      aria-label={armed === ordinal ? t('deleteMessageArmed') : t('deleteMessage')}
                      onClick={() => removeMessage(ordinal)}
                      onBlur={() => setArmed((a) => (a === ordinal ? null : a))}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 7.2h12" />
                        <path d="M9.7 7.2V5.4h4.6v1.8" />
                        <path d="M7.6 7.2l.8 11.4h7.2l.8-11.4" />
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
        // La même pillule que le fast path — l'état « en cours » et les
        // libellés lisibles ne vivent qu'une fois, dans ToolChip. `removeTool`
        // a exactement le même arming en deux clics que son handleDeleteClick.
        return (
          <ToolChip
            item={item}
            index={index}
            editable={editable}
            isArmed={armedTool === index}
            setArmedTool={setArmedTool}
            onDeleteTool={removeTool}
          />
        )
      case 'error':
        return <div className="error-bubble">{item.text}</div>
      case 'info':
        return <div className="info-line">{item.text}</div>
    }
  }

  // Le fil est construit AVANT la barre : c'est ce rendu qui compte les
  // correspondances (hits.n), et la barre en affiche le total.
  //
  // Deux chemins de rendu : la recherche a besoin de numéroter les
  // correspondances SÉQUENTIELLEMENT à travers tout le fil (hits.n, compteur
  // partagé) et l'édition ne concerne qu'un seul message à la fois — dans les
  // deux cas, renderItem (inchangé) reste la source de vérité, appelé pour
  // CHAQUE item comme avant. Hors de ces deux modes (l'immense majorité du
  // temps, streaming compris), les composants mémoïsés ci-dessus prennent le
  // relai : seul l'item qui a réellement changé se re-render.
  const useFastPath = hits.needle === '' && editing === null
  const rows = items.map((it, i) => {
    const ordinal = ordinals[i]
    if (useFastPath && it.kind === 'msg') {
      return (
        <div key={i} style={{ display: 'contents' }}>
          <MessageBubble
            item={it}
            ordinal={ordinal}
            editable={editable}
            showThoughts={showThoughts}
            isArmed={armed === ordinal}
            isCopied={copied === ordinal}
            isPinned={ordinal !== null && ordinal === pinned}
            isSpeaking={ttsPlaying !== null && ttsPlaying === it.msg.ts}
            setArmed={setArmed}
            setCopied={setCopied}
            setZoom={setZoom}
            onStartEdit={startEdit}
            onDeleteMessage={onDeleteMessage}
            onSwitchVariant={onSwitchVariant}
            onReply={onReply}
            onRemember={onRemember}
            onPin={onPin}
            onReplay={onReplay}
            onStopTts={onStopTts}
          />
        </div>
      )
    }
    if (useFastPath && it.kind === 'tool') {
      return (
        <div key={i} style={{ display: 'contents' }}>
          <ToolChip
            item={it}
            index={i}
            editable={editable}
            isArmed={armedTool === i}
            setArmedTool={setArmedTool}
            onDeleteTool={onDeleteTool}
          />
        </div>
      )
    }
    return (
      <div key={i} style={{ display: 'contents' }}>
        {renderItem(it, ordinal, i)}
      </div>
    )
  })
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
            // Affiché court (le champ tombe à 147 px utiles à 320 px de large),
            // annoncé long — le même nom que la loupe qui l'ouvre.
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchInChat')}
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
        <div
          className={
            // under-search : la barre de recherche flotte au-dessus du fil et
            // recouvrirait le ruban — il se range dessous (cf. styles.css).
            'pin-ribbon' + (pinOpen ? ' open' : '') + (searchOpen ? ' under-search' : '')
          }
        >
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

      {zoom && <ImageOverlay url={zoom} onClose={() => setZoom(null)} />}
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
  const { lang, t } = useI18n()
  const boxRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState<string | null>(null)

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
  // Images de la réplique affichée : elles ont autant leur place ici qu'en bulle.
  const images = last !== null && last.kind === 'msg' ? last.msg.images : undefined
  const text =
    last === null
      ? ''
      : last.kind === 'greeting'
        ? stripEmotionTags(last.text)
        : isUser
          ? last.msg.content
          : stripEmotionTags(last.msg.content, pending)
  // Heure de la réplique : un greeting n'en a pas (pas de message sauvegardé),
  // et pendant l'attente du premier delta la boîte ne montre que les points.
  const ts = last !== null && last.kind === 'msg' && !(pending && !text) ? fmtTime(last.msg.ts, lang) : ''

  return (
    // L'étiquette de nom chevauche la bordure supérieure (namebox de visual
    // novel) : la boîte ne défile pas elle-même — c'est .vn-text qui scrolle,
    // sinon l'étiquette en position négative serait rognée par l'overflow.
    <div className="vn-box">
      {/* Coin haut-gauche : largeur de la boîte et hauteur du texte en un geste
          (la saisie et la bande basse suivent la largeur, cf. --vn-w). */}
      <VnBoxGrip />
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
            <>
              {images && images.length > 0 && <Shots images={images} onOpen={setZoom} />}
              {renderMarkdown(text)}
            </>
          )}
        </div>
      )}
      {/* Horodatage ancré dans le coin bas droit de la boîte (CSS, hors du flux) :
          il ne décentre pas la réplique et ne suit pas le scroll de .vn-text. */}
      {ts !== '' && <span className="vn-ts">{ts}</span>}
      {trailingError && <div className="error-bubble vn-error">{trailingError}</div>}
      {zoom && <ImageOverlay url={zoom} onClose={() => setZoom(null)} />}
    </div>
  )
}
