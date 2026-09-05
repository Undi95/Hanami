// Mémoire du personnage : liste des fichiers .md (MEMORY.md = index), édition,
// création, suppression — et le « Ranger » : un seul appel LLM fusionne et
// compresse les fichiers (backup automatique d'avant, restaurable ci-dessous).
import { useCallback, useEffect, useState } from 'react'
import type { MemoryFile } from '../../../shared/types'
import * as api from '../api'
import type { MemoryBackup, MemoryListing } from '../api'
import { useI18n } from '../i18n'
import Dialog from './Dialog'

interface Props {
  characterId: string
  onClose: () => void
}

export default function MemoryDialog({ characterId, onClose }: Props) {
  const { t } = useI18n()
  const [listing, setListing] = useState<MemoryListing | null>(null)
  const [backups, setBackups] = useState<MemoryBackup[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [newName, setNewName] = useState('')
  const [armed, setArmed] = useState(false)
  const [tidyArmed, setTidyArmed] = useState(false)
  const [tidying, setTidying] = useState(false)
  const [restoreArmed, setRestoreArmed] = useState<string | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const files = listing?.files ?? []
  const tidyableFiles = files.filter((f) => f.name !== 'MEMORY.md').length

  const load = useCallback(
    (pick?: string) => {
      api
        .listMemory(characterId)
        .then((res) => {
          setListing(res)
          const target = pick ?? selected ?? res.files[0]?.name ?? null
          const found = res.files.find((f) => f.name === target) ?? res.files[0] ?? null
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
      api
        .listMemoryBackups(characterId)
        .then(setBackups)
        .catch(() => {})
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
    setTidyArmed(false)
    setRestoreArmed(null)
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

  // Ranger : 2 clics (armement), un seul appel LLM côté serveur, backup d'avant.
  async function tidy() {
    if (tidying) return
    if (!tidyArmed) {
      setTidyArmed(true)
      return
    }
    setTidyArmed(false)
    setTidying(true)
    setNote(null)
    try {
      const rep = await api.tidyMemory(characterId)
      setNote({
        ok: true,
        text: t('memoryTidyReport', { bf: rep.before.files, bc: rep.before.chars, af: rep.after.files, ac: rep.after.chars }),
      })
      load('MEMORY.md')
    } catch (e) {
      setNote({ ok: false, text: api.errorMessage(e) })
    } finally {
      setTidying(false)
    }
  }

  // Restaurer : 2 clics par backup ; le serveur prend d'abord un snapshot de
  // sécurité de l'état courant — les sauvegardes s'empilent.
  async function restore(b: MemoryBackup) {
    if (restoreArmed !== b.name) {
      setRestoreArmed(b.name)
      return
    }
    setRestoreArmed(null)
    setNote(null)
    try {
      const rep = await api.restoreMemoryBackup(characterId, b.name)
      setNote({ ok: true, text: t('memoryBackupRestored', { name: rep.restored }) })
      load('MEMORY.md')
    } catch (e) {
      setNote({ ok: false, text: api.errorMessage(e) })
    }
  }

  const injectionText =
    listing === null
      ? null
      : listing.injection === 'none'
        ? t('memoryInjectNone')
        : listing.injection === 'full'
          ? t('memoryInjectFull', { chars: listing.totalChars })
          : listing.injection === 'index-only'
            ? t('memoryInjectIndex', { chars: listing.totalChars })
            : t('memoryInjectCapped', { chars: listing.totalChars })

  return (
    <Dialog title={t('memory')} onClose={onClose} guardClose={() => !dirty || window.confirm(t('unsavedConfirm'))} wide>
      <p className="hint" style={{ marginTop: 0 }}>
        {t('memoryHelp')}
      </p>
      {note && <p className={note.ok ? 'msg-ok' : 'msg-err'}>{note.text}</p>}
      {listing === null && <p className="hint">{t('loading')}</p>}
      {listing !== null && (
        <div className="memory-layout">
          <div className="memory-files">
            {injectionText && <p className="hint" style={{ margin: 0, marginBottom: 6 }}>{injectionText}</p>}
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
            <button
              className={`btn small${tidyArmed ? ' danger' : ''}`}
              style={{ width: '100%', marginTop: 6 }}
              title={t('memoryTidyHint')}
              onClick={() => tidy().catch((e) => console.error('[memory]', e))}
              disabled={tidying || tidyableFiles < 2}
            >
              {tidying ? t('memoryTidyRunning') : tidyArmed ? t('memoryTidyArmed') : t('memoryTidy')}
            </button>
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
      {backups.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h3 className="section-title">{t('memoryBackups')}</h3>
          {backups.map((b) => (
            <div key={b.name} className="row" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
              <span className="hint" style={{ margin: 0 }}>
                {b.name} — {t('memoryBackupMeta', { files: b.files, chars: b.chars })}
              </span>
              <button
                className={`btn small${restoreArmed === b.name ? ' danger' : ''}`}
                onClick={() => restore(b).catch((e) => console.error('[memory]', e))}
                disabled={tidying}
              >
                {restoreArmed === b.name ? t('memoryBackupRestoreArmed') : t('memoryBackupRestore')}
              </button>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  )
}
