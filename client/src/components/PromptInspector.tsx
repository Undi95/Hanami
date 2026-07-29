// Inspecteur de prompt : montre EXACTEMENT ce que Hanami envoie au backend.
import { useEffect, useState } from 'react'
import * as api from '../api'
import Dialog from './Dialog'

interface Props {
  characterId: string
  chatId: string
  onClose: () => void
}

export default function PromptInspector({ characterId, chatId, onClose }: Props) {
  const [data, setData] = useState<{ systemText: string; payload: object } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'system' | 'payload'>('system')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api
      .getPromptPreview(characterId, chatId)
      .then(setData)
      .catch((e) => setError(api.errorMessage(e)))
  }, [characterId, chatId])

  const current = data === null ? '' : tab === 'system' ? data.systemText : JSON.stringify(data.payload, null, 2)

  function copy() {
    navigator.clipboard
      .writeText(current)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch((e) => console.error('[copie]', e))
  }

  return (
    <Dialog title="Inspecteur de prompt" onClose={onClose} wide>
      <p className="hint" style={{ marginTop: 0 }}>
        Ceci est exactement ce que Hanami envoie au backend — rien d'autre.
      </p>
      {error && <p className="msg-err">{error}</p>}
      {data === null && !error && <p className="hint">Chargement…</p>}
      {data && (
        <>
          <div className="tabs" role="tablist">
            <button className={`tab${tab === 'system' ? ' active' : ''}`} role="tab" aria-selected={tab === 'system'} onClick={() => setTab('system')}>
              Prompt système
            </button>
            <button className={`tab${tab === 'payload' ? ' active' : ''}`} role="tab" aria-selected={tab === 'payload'} onClick={() => setTab('payload')}>
              Payload complet
            </button>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
            <button className="btn small" onClick={copy}>
              {copied ? 'Copié !' : 'Copier'}
            </button>
          </div>
          <pre className="code-block">{current}</pre>
        </>
      )}
    </Dialog>
  )
}
