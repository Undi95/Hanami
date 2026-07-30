// Liste des conversations du personnage actif : basculer, créer, renommer, supprimer.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMeta } from '../../../shared/types'
import * as api from '../api'
import { chatDisplayTitle, isPlural, localeOf, useI18n, type Lang } from '../i18n'
import Dialog from './Dialog'

interface Props {
  characterId: string
  activeChatId: string | null
  onSelect: (chatId: string) => void
  onDeleted: (chatId: string) => void
  // Conversation renommée : si c'est la conversation active, la barre du haut doit suivre.
  onRenamed: (chatId: string, title: string) => void
  onClose: () => void
}

// Même plafond que le serveur (CHAT_TITLE_MAX_CHARS) : un titre tient sur une ligne.
const TITLE_MAX = 200

function fmtDate(iso: string, lang: Lang): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const locale = localeOf(lang)
  return (
    d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }) +
    ' ' +
    d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  )
}

export default function ChatsDialog({
  characterId,
  activeChatId,
  onSelect,
  onDeleted,
  onRenamed,
  onClose,
}: Props) {
  const { lang, t } = useI18n()
  const [chats, setChats] = useState<ChatMeta[] | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<api.CharacterStats | null>(null)
  // Renommage inline : identifiant du chat en cours d'édition + brouillon.
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // Échap ferme l'édition ; si un blur suit tout de même (navigateur qui l'émet
  // au retrait du champ), ce drapeau empêche d'enregistrer la valeur abandonnée.
  const abandonRef = useRef(false)

  const load = useCallback(() => {
    api
      .listChats(characterId)
      .then(setChats)
      .catch((e) => setError(api.errorMessage(e)))
  }, [characterId])

  useEffect(load, [load])

  // « Notre histoire » : purement décoratif — un échec ne doit jamais parasiter
  // la liste des conversations. Rechargé après duplication/suppression.
  const loadStats = useCallback(() => {
    api
      .getStats(characterId)
      .then(setStats)
      .catch((e) => console.error('[chats] stats', e))
  }, [characterId])

  useEffect(loadStats, [loadStats])

  // Rien avant le tout premier message : pas d'histoire à raconter.
  const statsLine =
    stats && stats.firstMessageAt
      ? t('statsLine', {
          days: t(isPlural(lang, stats.daysTogether) ? 'statsDaysMany' : 'statsDaysOne', { n: stats.daysTogether }),
          messages: t(isPlural(lang, stats.totalMessages) ? 'messagesMany' : 'messagesOne', {
            n: stats.totalMessages,
          }),
          activeDays: t(isPlural(lang, stats.activeDays) ? 'statsActiveDaysMany' : 'statsActiveDaysOne', {
            n: stats.activeDays,
          }),
        })
      : null

  async function create() {
    try {
      // Titre localisé côté client : le serveur ne connaît pas la langue de l'UI.
      const c = await api.createChat(
        characterId,
        t('defaultChatTitle', { date: new Date().toLocaleDateString(localeOf(lang)) }),
      )
      onSelect(c.id)
      onClose()
    } catch (e) {
      setError(api.errorMessage(e))
    }
  }

  // Duplique la conversation ; la branche apparaît dans la liste, sans y basculer.
  // Le titre localisé vient d'ici : le serveur ne connaît pas la langue de l'UI.
  // Il part du titre AFFICHÉ, et devient un titre voulu côté serveur (titleCustom).
  async function fork(chat: ChatMeta) {
    try {
      await api.forkChat(characterId, chat.id, `${chatDisplayTitle(chat, lang, t)} (${t('forkSuffix')})`)
      load()
      loadStats()
    } catch (e) {
      setError(api.errorMessage(e))
    }
  }

  // ── Renommage inline ─────────────────────────────────────────────────────
  // Le brouillon part du titre AFFICHÉ : renommer un titre automatique le figera
  // tel qu'il est lu à l'écran, dans la langue du moment.
  function startRename(chat: ChatMeta) {
    abandonRef.current = false
    setDraft(chatDisplayTitle(chat, lang, t))
    setRenaming(chat.id)
  }

  function cancelRename() {
    abandonRef.current = true
    setRenaming(null)
  }

  async function commitRename(chat: ChatMeta) {
    if (abandonRef.current) {
      abandonRef.current = false
      return
    }
    const title = draft.trim()
    setRenaming(null)
    // Vidé ou inchangé : rien à écrire — un titre automatique le reste.
    if (!title || title === chatDisplayTitle(chat, lang, t)) return
    try {
      await api.renameChat(characterId, chat.id, title)
      load()
      onRenamed(chat.id, title)
    } catch (e) {
      setError(api.errorMessage(e))
    }
  }

  async function remove(id: string) {
    if (armed !== id) {
      setArmed(id)
      return
    }
    try {
      await api.deleteChat(characterId, id)
      setArmed(null)
      load()
      loadStats()
      onDeleted(id)
    } catch (e) {
      setError(api.errorMessage(e))
    }
  }

  return (
    <Dialog
      title={t('chats')}
      onClose={onClose}
      footer={
        <>
          {statsLine && (
            // marginRight auto : la ligne se cale à gauche, le bouton reste à droite.
            <span className="hint" style={{ marginRight: 'auto' }}>
              {statsLine}
            </span>
          )}
          <button className="btn primary" onClick={() => create().catch((e) => console.error('[chats]', e))}>
            {t('newChat')}
          </button>
        </>
      }
    >
      {error && <p className="msg-err">{error}</p>}
      {chats === null ? (
        <p className="hint">{t('loading')}</p>
      ) : chats.length === 0 ? (
        <p className="hint">{t('noChats')}</p>
      ) : (
        <div className="item-list">
          {chats.map((c) => (
            <div key={c.id} className={`item-row${c.id === activeChatId ? ' active' : ''}`}>
              {renaming === c.id ? (
                <input
                  className="item-rename"
                  type="text"
                  autoFocus
                  value={draft}
                  maxLength={TITLE_MAX}
                  aria-label={t('renameChat')}
                  title={t('renameChatHint')}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitRename(c).catch((err) => console.error('[chats]', err))
                    } else if (e.key === 'Escape') {
                      // stopPropagation : Dialog écoute Échap sur window — sans ça,
                      // annuler l'édition fermerait aussi le dialog.
                      e.preventDefault()
                      e.stopPropagation()
                      cancelRename()
                    }
                  }}
                  onBlur={() => commitRename(c).catch((e) => console.error('[chats]', e))}
                />
              ) : (
                <>
                  <button
                    className="item-main"
                    onClick={() => {
                      onSelect(c.id)
                      onClose()
                    }}
                  >
                    <span className="item-title">{chatDisplayTitle(c, lang, t)}</span>
                    <span className="item-sub">
                      {fmtDate(c.updatedAt, lang)} ·{' '}
                      {t(isPlural(lang, c.messageCount) ? 'messagesMany' : 'messagesOne', { n: c.messageCount })}
                    </span>
                  </button>
                  {/* Crayon discret (même esprit que .msg-edit) : révélé au survol de la rangée. */}
                  <button
                    className="item-edit"
                    title={t('renameChat')}
                    aria-label={t('renameChat')}
                    onClick={() => startRename(c)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 00-3-3L5 17z" />
                    </svg>
                  </button>
                </>
              )}
              <button className="btn small" onClick={() => fork(c).catch((e) => console.error('[chats]', e))}>
                {t('forkChat')}
              </button>
              <button
                className={`btn small${armed === c.id ? ' danger' : ''}`}
                onClick={() => remove(c.id).catch((e) => console.error('[chats]', e))}
                onBlur={() => setArmed((a) => (a === c.id ? null : a))}
              >
                {armed === c.id ? t('confirmQuestion') : t('deleteChat')}
              </button>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  )
}
