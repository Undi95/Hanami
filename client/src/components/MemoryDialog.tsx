// Mémoire du personnage : liste des fichiers .md (MEMORY.md = index), édition, création, suppression.
import { useCallback, useEffect, useState } from 'react'
import type { MemoryFile } from '../../../shared/types'
import * as api from '../api'
import { useI18n } from '../i18n'
import Dialog from './Dialog'

interface Props {
  characterId: string
  onClose: () => void
}

export default function MemoryDialog({ characterId, onClose }: Props) {
  const { t } = useI18n()
  const [files, setFiles] = useState<MemoryFile[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [newName, setNewName] = useState('')
  const [armed, setArmed] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(
    (pick?: string) => {
      api
        .listMemory(characterId)
        .then((list) => {
          setFiles(list)
          const target = pick ?? selected ?? list[0]?.name ?? null
          const found = list.find((f) => f.name === target) ?? list[0] ?? null
          if (found) {
            setSelected(found.name)
            setContent(found.content)
            setDirty(false)
          } else {
            setSelected(null)
            setContent('')
          }
        })
        .catch((e) => setNote({ ok: false, text: api.errorMessage(e) }))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [characterId],
  )

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId])

  function select(f: MemoryFile) {
    setSelected(f.name)
    setContent(f.content)
    setDirty(false)
    setArmed(false)
    setNote(null)
  }

  async function save() {
    if (!selected) return
    try {
      await api.updateMemoryFile(characterId, selected, content)
      setDirty(false)
      setNote({ ok: true, text: t('saved') })
      load(selected)
    } catch (e) {
      setNote({ ok: false, text: api.errorMessage(e) })
    }
  }

  async function create() {
    let name = newName.trim()
    if (!name) return
    if (!name.toLowerCase().endsWith('.md')) name += '.md'
    try {
      await api.createMemoryFile(characterId, name, '')
      setNewName('')
      load(name)
    } catch (e) {
      setNote({ ok: false, text: api.errorMessage(e) })
    }
  }

  async function remove() {
    if (!selected || selected === 'MEMORY.md') return
    if (!armed) {
      setArmed(true)
      return
    }
    try {
      await api.deleteMemoryFile(characterId, selected)
      setArmed(false)
      setSelected(null)
      load('MEMORY.md')
    } catch (e) {
      setNote({ ok: false, text: api.errorMessage(e) })
    }
  }

  return (
    <Dialog title={t('memory')} onClose={onClose} guardClose={() => !dirty || window.confirm(t('unsavedConfirm'))} wide>
      <p className="hint" style={{ marginTop: 0 }}>
        {t('memoryHelp')}
      </p>
      {note && <p className={note.ok ? 'msg-ok' : 'msg-err'}>{note.text}</p>}
      {files === null ? (
        <p className="hint">{t('loading')}</p>
      ) : (
        <div className="memory-layout">
          <div className="memory-files">
            {files.map((f) => (
              <button
                key={f.name}
                className={`memory-file${f.name === selected ? ' active' : ''}`}
                onClick={() => select(f)}
              >
                <span className="item-title">{f.name}</span>
                {f.name === 'MEMORY.md' && <span className="badge">{t('indexBadge')}</span>}
              </button>
            ))}
            <div className="row" style={{ marginTop: 6 }}>
              <input
                type="text"
                value={newName}
                placeholder={t('newMemoryFilePlaceholder')}
                aria-label={t('newMemoryFile')}
                style={{ flex: 1, minWidth: 0 }}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') create().catch((err) => console.error('[memory]', err))
                }}
              />
              <button className="btn small" onClick={() => create().catch((e) => console.error('[memory]', e))} disabled={!newName.trim()}>
                {t('create')}
              </button>
            </div>
          </div>
          <div className="memory-editor">
            {selected ? (
              <>
                <textarea
                  className="mono memory-textarea"
                  value={content}
                  spellCheck={false}
                  aria-label={t('memoryFileContent', { name: selected })}
                  onChange={(e) => {
                    setContent(e.target.value)
                    setDirty(true)
                  }}
                />
                <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
                  {selected !== 'MEMORY.md' && (
                    <button className={`btn small${armed ? ' danger' : ''}`} onClick={() => remove().catch((e) => console.error('[memory]', e))}>
                      {armed ? t('confirmDelete') : t('deleteFile')}
                    </button>
                  )}
                  <button className="btn primary small" onClick={() => save().catch((e) => console.error('[memory]', e))} disabled={!dirty}>
                    {t('save')}
                  </button>
                </div>
              </>
            ) : (
              <p className="hint">{t('noMemoryFiles')}</p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}
