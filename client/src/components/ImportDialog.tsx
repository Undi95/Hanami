// Import SillyTavern : carte de personnage (PNG ou .json) et historiques de
// chat (.jsonl).
import { useState } from 'react'
import type { CharacterMeta } from '../../../shared/types'
import * as api from '../api'
import { isPlural, useI18n } from '../i18n'
import Dialog from './Dialog'

interface Props {
  characters: CharacterMeta[]
  defaultCharacterId: string | null
  onCharacterImported: (c: CharacterMeta) => void
  onChatsImported: (characterId: string) => void
  onClose: () => void
}

interface FileResult {
  name: string
  ok: boolean
  detail: string
}

export default function ImportDialog({ characters, defaultCharacterId, onCharacterImported, onChatsImported, onClose }: Props) {
  const { lang, t } = useI18n()
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
      // Le nom du fichier sert de nom par défaut : son extension, quelle qu'elle
      // soit, n'en fait pas partie (le serveur retombe sur celui de la card).
      const name = file.name.replace(/\.(png|json)$/i, '')
      const r = await api.importCard(name, file)
      setCardMsg({ ok: true, text: t('characterImported', { name: r.character.name }) })
      onCharacterImported(r.character)
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
        out.push({
          name: f.name,
          ok: true,
          detail: t(isPlural(lang, r.imported) ? 'importedMany' : 'importedOne', { n: r.imported }),
        })
      } catch (e) {
        out.push({ name: f.name, ok: false, detail: api.errorMessage(e) })
      }
      setResults([...out])
    }
    setChatBusy(false)
    onChatsImported(target)
  }

  return (
    <Dialog title={t('importFromSt')} onClose={onClose}>
      <div className="section">
        <h3>{t('cardSection')}</h3>
        <p className="hint">{t('cardSectionHint')}</p>
        <label className="btn file-btn">
          {cardBusy ? t('importing') : t('choosePng')}
          <input
            type="file"
            // Le corps part en application/octet-stream dans les deux cas : c'est
            // le serveur qui reconnaît un PNG à sa signature, sinon il tente le JSON.
            accept="image/png,.png,application/json,.json"
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
        <h3>{t('chatSection')}</h3>
        {characters.length === 0 ? (
          <p className="hint">{t('importNeedCharacter')}</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="import-target">{t('targetCharacter')}</label>
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
                {chatFiles.length > 0
                  ? t(isPlural(lang, chatFiles.length) ? 'filesChosenMany' : 'filesChosenOne', {
                      n: chatFiles.length,
                    })
                  : t('chooseJsonl')}
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
                {chatBusy ? t('importing') : t('importTitle')}
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

      <p className="hint">{t('filesStayLocal')}</p>
    </Dialog>
  )
}
