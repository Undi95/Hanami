// Liste des conversations du personnage actif : basculer, créer, supprimer.
import { useCallback, useEffect, useState } from 'react'
import type { ChatMeta } from '../../../shared/types'
import * as api from '../api'
import { isPlural, localeOf, useI18n, type Lang } from '../i18n'
import Dialog from './Dialog'

interface Props {
  characterId: string
  activeChatId: string | null
  onSelect: (chatId: string) => void
  onDeleted: (chatId: string) => void
  onClose: () => void
}

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

export default function ChatsDialog({ characterId, activeChatId, onSelect, onDeleted, onClose }: Props) {
  const { lang, t } = useI18n()
  const [chats, setChats] = useState<ChatMeta[] | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<api.CharacterStats | null>(null)

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
  async function fork(chat: ChatMeta) {
    try {
      await api.forkChat(characterId, chat.id, `${chat.title} (${t('forkSuffix')})`)
      load()
      loadStats()
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
              <button
                className="item-main"
                onClick={() => {
                  onSelect(c.id)
                  onClose()
                }}
              >
                <span className="item-title">{c.title}</span>
                <span className="item-sub">
                  {fmtDate(c.updatedAt, lang)} ·{' '}
                  {t(isPlural(lang, c.messageCount) ? 'messagesMany' : 'messagesOne', { n: c.messageCount })}
                </span>
              </button>
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
