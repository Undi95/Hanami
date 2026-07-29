// Import SillyTavern : carte de personnage (PNG) et historiques de chat (.jsonl).
import { useState } from 'react'
import type { CharacterMeta } from '../../../shared/types'
import * as api from '../api'
import Dialog from './Dialog'

interface Props {
  characters: CharacterMeta[]
  defaultCharacterId: string | null
  onCharacterImported: () => void
  onChatsImported: (characterId: string) => void
  onClose: () => void
}

interface FileResult {
  name: string
  ok: boolean
  detail: string
}

export default function ImportDialog({ characters, defaultCharacterId, onCharacterImported, onChatsImported, onClose }: Props) {
  const [cardMsg, setCardMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [cardBusy, setCardBusy] = useState(false)
  const [target, setTarget] = useState(defaultCharacterId ?? characters[0]?.id ?? '')
  const [chatFiles, setChatFiles] = useState<File[]>([])
  const [results, setResults] = useState<FileResult[]>([])
  const [chatBusy, setChatBusy] = useState(false)

  async function importCard(file: File) {
    setCardBusy(true)
    setCardMsg(null)
    try {
      const name = file.name.replace(/\.png$/i, '')
      const r = await api.importCard(name, file)
      setCardMsg({ ok: true, text: `Personnage « ${r.character.name} » importé.` })
      onCharacterImported()
    } catch (e) {
      setCardMsg({ ok: false, text: api.errorMessage(e) })
    } finally {
      setCardBusy(false)
    }
  }

  async function importChats() {
    if (!target || chatFiles.length === 0 || chatBusy) return
    setChatBusy(true)
    setResults([])
    const out: FileResult[] = []
    for (const f of chatFiles) {
      try {
        const title = f.name.replace(/\.jsonl$/i, '')
        const r = await api.importChat(target, title, f)
        out.push({ name: f.name, ok: true, detail: `${r.imported} message${r.imported > 1 ? 's' : ''} importé${r.imported > 1 ? 's' : ''}` })
      } catch (e) {
        out.push({ name: f.name, ok: false, detail: api.errorMessage(e) })
      }
      setResults([...out])
    }
    setChatBusy(false)
    onChatsImported(target)
  }

  return (
    <Dialog title="Importer depuis SillyTavern" onClose={onClose}>
      <div className="section">
        <h3>Carte de personnage (PNG)</h3>
        <p className="hint">Le personnage, son prompt et son message d'accueil sont extraits de la carte.</p>
        <label className="btn file-btn">
          {cardBusy ? 'Import…' : 'Choisir un fichier PNG'}
          <input
            type="file"
            accept="image/png,.png"
            hidden
            disabled={cardBusy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) importCard(f).catch((err) => console.error('[import]', err))
            }}
          />
        </label>
        {cardMsg && <p className={cardMsg.ok ? 'msg-ok' : 'msg-err'}>{cardMsg.text}</p>}
      </div>

      <div className="section">
        <h3>Historique de chat (.jsonl)</h3>
        {characters.length === 0 ? (
          <p className="hint">Importez ou créez d'abord un personnage cible.</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="import-target">Personnage cible</label>
              <select id="import-target" value={target} onChange={(e) => setTarget(e.target.value)}>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <label className="btn file-btn">
                {chatFiles.length > 0 ? `${chatFiles.length} fichier${chatFiles.length > 1 ? 's' : ''} choisi${chatFiles.length > 1 ? 's' : ''}` : 'Choisir des fichiers .jsonl'}
                <input
                  type="file"
                  accept=".jsonl,application/jsonl"
                  multiple
                  hidden
                  disabled={chatBusy}
                  onChange={(e) => {
                    setChatFiles(Array.from(e.target.files ?? []))
                    setResults([])
                    e.target.value = ''
                  }}
                />
              </label>
              <button
                className="btn primary"
                disabled={chatBusy || !target || chatFiles.length === 0}
                onClick={() => importChats().catch((e) => console.error('[import]', e))}
              >
                {chatBusy ? 'Import…' : 'Importer'}
              </button>
            </div>
            {results.length > 0 && (
              <ul className="import-results">
                {results.map((r) => (
                  <li key={r.name} className={r.ok ? 'msg-ok' : 'msg-err'}>
                    {r.name} — {r.detail}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <p className="hint">Vos fichiers ne quittent pas votre machine.</p>
    </Dialog>
  )
}
