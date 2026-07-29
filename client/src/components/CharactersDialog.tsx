// Personnages : grille de sélection, création, édition (prompt système inclus), suppression.
import { useEffect, useState } from 'react'
import type { CharacterFull, CharacterMeta } from '../../../shared/types'
import * as api from '../api'
import { useI18n } from '../i18n'
import Dialog from './Dialog'

interface Props {
  characters: CharacterMeta[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreated: (c: CharacterFull) => void
  onUpdated: (c: CharacterFull) => void
  onDeleted: (id: string) => void
  onClose: () => void
}

type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; id: string }

interface FormState {
  name: string
  vrm: string
  background: string
  greeting: string
  systemPrompt: string
}

const EMPTY_FORM: FormState = { name: '', vrm: '', background: '', greeting: '', systemPrompt: '' }

function basename(url: string): string {
  return url.split('/').pop() ?? url
}

/** Teinte stable dérivée de l'id — pour la pastille du personnage. */
export function pastilleHue(id: string): number {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

export default function CharactersDialog({ characters, activeId, onSelect, onCreated, onUpdated, onDeleted, onClose }: Props) {
  const { t } = useI18n()
  const [view, setView] = useState<View>({ kind: 'list' })
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  // État initial du formulaire (création ou édition) — sert à détecter les saisies non enregistrées.
  const [initialForm, setInitialForm] = useState<FormState>(EMPTY_FORM)
  const [vrms, setVrms] = useState<string[]>([])
  const [bgs, setBgs] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (view.kind === 'list') return
    api.getVrmModels().then(setVrms).catch((e) => console.error('[characters]', e))
    api.getBackgrounds().then(setBgs).catch((e) => console.error('[characters]', e))
  }, [view.kind])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function backToList() {
    setView({ kind: 'list' })
    setForm(EMPTY_FORM)
    setInitialForm(EMPTY_FORM)
    setError(null)
    setArmed(false)
  }

  async function openEdit(id: string) {
    setError(null)
    setArmed(false)
    try {
      const c = await api.getCharacter(id)
      const f: FormState = { name: c.name, vrm: c.vrm, background: c.background, greeting: c.greeting, systemPrompt: c.systemPrompt }
      setForm(f)
      setInitialForm(f)
      setView({ kind: 'edit', id })
    } catch (e) {
      setError(api.errorMessage(e))
    }
  }

  // Saisies non enregistrées dans le formulaire de création/édition.
  const dirty =
    view.kind !== 'list' && (Object.keys(form) as (keyof FormState)[]).some((k) => form[k] !== initialForm[k])

  async function submit() {
    if (!form.name.trim()) {
      setError(t('nameRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (view.kind === 'create') {
        const c = await api.createCharacter({
          name: form.name.trim(),
          vrm: form.vrm,
          background: form.background,
          greeting: form.greeting,
        })
        onCreated(c)
        backToList()
      } else if (view.kind === 'edit') {
        const c = await api.updateCharacter(view.id, {
          name: form.name.trim(),
          vrm: form.vrm,
          background: form.background,
          greeting: form.greeting,
          systemPrompt: form.systemPrompt,
        })
        onUpdated(c)
        backToList()
      }
    } catch (e) {
      setError(api.errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (view.kind !== 'edit') return
    if (!armed) {
      setArmed(true)
      return
    }
    setBusy(true)
    try {
      await api.deleteCharacter(view.id)
      onDeleted(view.id)
      backToList()
    } catch (e) {
      setError(api.errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const title =
    view.kind === 'list' ? t('characters') : view.kind === 'create' ? t('newCharacter') : t('editCharacter')

  return (
    <Dialog
      title={title}
      onClose={onClose}
      guardClose={() => !dirty || window.confirm(t('unsavedConfirm'))}
      wide={view.kind === 'edit'}
      footer={
        view.kind === 'list' ? (
          <button className="btn primary" onClick={() => setView({ kind: 'create' })}>
            {t('newCharacter')}
          </button>
        ) : (
          <>
            <button className="btn" onClick={backToList} disabled={busy}>
              {t('cancel')}
            </button>
            <button className="btn primary" onClick={() => submit().catch((e) => console.error('[characters]', e))} disabled={busy}>
              {busy ? t('saving') : view.kind === 'create' ? t('create') : t('save')}
            </button>
          </>
        )
      }
    >
      {error && <p className="msg-err">{error}</p>}

      {view.kind === 'list' && (
        characters.length === 0 ? (
          <p className="hint">{t('charactersEmpty')}</p>
        ) : (
          <div className="char-grid">
            {characters.map((c) => (
              <div key={c.id} className={`char-card${c.id === activeId ? ' active' : ''}`} onClick={() => { onSelect(c.id); onClose() }}>
                <span className="pastille" style={{ background: `hsl(${pastilleHue(c.id)} 55% 74%)` }} aria-hidden="true">
                  {c.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="char-name">{c.name}</span>
                <button
                  className="btn small"
                  onClick={(e) => {
                    e.stopPropagation()
                    openEdit(c.id).catch((err) => console.error('[characters]', err))
                  }}
                >
                  {t('edit')}
                </button>
              </div>
            ))}
          </div>
        )
      )}

      {view.kind !== 'list' && (
        <>
          <div className="field">
            <label htmlFor="char-name">{t('name')}</label>
            <input id="char-name" type="text" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="char-vrm">{t('vrmModel')}</label>
              <select id="char-vrm" value={form.vrm} onChange={(e) => set('vrm', e.target.value)}>
                <option value="">{t('noModel')}</option>
                {form.vrm && !vrms.includes(form.vrm) && <option value={form.vrm}>{basename(form.vrm)}</option>}
                {vrms.map((v) => (
                  <option key={v} value={v}>
                    {basename(v)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="char-bg">{t('background')}</label>
              <select id="char-bg" value={form.background} onChange={(e) => set('background', e.target.value)}>
                <option value="">{t('defaultGradient')}</option>
                {form.background && !bgs.includes(form.background) && (
                  <option value={form.background}>{basename(form.background)}</option>
                )}
                {bgs.map((b) => (
                  <option key={b} value={b}>
                    {basename(b)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="char-greeting">{t('greeting')}</label>
            <textarea
              id="char-greeting"
              value={form.greeting}
              onChange={(e) => set('greeting', e.target.value)}
              placeholder={t('greetingPlaceholder')}
            />
            <span className="hint">{t('greetingHint')}</span>
          </div>
          {view.kind === 'edit' && (
            <>
              <div className="field">
                <label htmlFor="char-prompt">{t('systemPrompt')}</label>
                <textarea
                  id="char-prompt"
                  className="mono"
                  value={form.systemPrompt}
                  onChange={(e) => set('systemPrompt', e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="danger-zone">
                <p className="warn-text">{armed ? t('deleteCharacterArmed') : t('deleteCharacterWarn')}</p>
                <button className="btn danger" onClick={() => remove().catch((e) => console.error('[characters]', e))} disabled={busy}>
                  {armed ? t('confirmDelete') : t('deleteCharacter')}
                </button>
                {armed && (
                  <button className="btn small" style={{ marginLeft: 8 }} onClick={() => setArmed(false)}>
                    {t('cancel')}
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </Dialog>
  )
}
