// Liste des conversations du personnage actif : basculer, créer, supprimer.
import { useCallback, useEffect, useState } from 'react'
import type { ChatMeta } from '../../../shared/types'
import * as api from '../api'
import Dialog from './Dialog'

interface Props {
  characterId: string
  activeChatId: string | null
  onSelect: (chatId: string) => void
  onDeleted: (chatId: string) => void
  onClose: () => void
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) +
    ' ' +
    d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export default function ChatsDialog({ characterId, activeChatId, onSelect, onDeleted, onClose }: Props) {
  const [chats, setChats] = useState<ChatMeta[] | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api
      .listChats(characterId)
      .then(setChats)
      .catch((e) => setError(api.errorMessage(e)))
  }, [characterId])

  useEffect(load, [load])

  async function create() {
    try {
      const c = await api.createChat(characterId)
      onSelect(c.id)
      onClose()
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
      onDeleted(id)
    } catch (e) {
      setError(api.errorMessage(e))
    }
  }

  return (
    <Dialog
      title="Conversations"
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={() => create().catch((e) => console.error('[chats]', e))}>
          Nouvelle conversation
        </button>
      }
    >
      {error && <p className="msg-err">{error}</p>}
      {chats === null ? (
        <p className="hint">Chargement…</p>
      ) : chats.length === 0 ? (
        <p className="hint">Aucune conversation pour l'instant.</p>
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
                  {fmtDate(c.updatedAt)} · {c.messageCount} message{c.messageCount > 1 ? 's' : ''}
                </span>
              </button>
              <button
                className={`btn small${armed === c.id ? ' danger' : ''}`}
                onClick={() => remove(c.id).catch((e) => console.error('[chats]', e))}
                onBlur={() => setArmed((a) => (a === c.id ? null : a))}
              >
                {armed === c.id ? 'Confirmer ?' : 'Supprimer'}
              </button>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  )
}
