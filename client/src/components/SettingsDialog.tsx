// Réglages : backend LLM, génération, mémoire/outils, mot de passe d'accès.
// Les secrets (clé API, mot de passe) ne sont jamais renvoyés par le serveur :
// les champs démarrent vides ('' = conserver la valeur configurée) et le bouton
// « Retirer » envoie la sentinelle CLEAR_SECRET.
import { useState } from 'react'
import type { ModelMode, Settings } from '../../../shared/types'
import * as api from '../api'
import { isPlural, useI18n, type Lang } from '../i18n'
import Dialog from './Dialog'

interface Props {
  settings: Settings
  onSaved: (s: Settings) => void
  onClose: () => void
}

// Les champs numériques sont édités en texte puis parsés à l'enregistrement.
interface FormState {
  backendUrl: string
  apiKey: string
  model: string
  modelMode: ModelMode
  temperature: string
  maxTokens: string
  maxHistoryMessages: string
  memoryEnabled: boolean
  fileToolsEnabled: boolean
  allowDelete: boolean
  toolsRoot: string
  password: string
  contextSize: string
  autoCompact: boolean
  timeAwareness: boolean
  showThoughts: boolean
  ttsEnabled: boolean
  ttsUrl: string
  ttsModel: string
  ttsVoice: string
}

function toForm(s: Settings): FormState {
  return {
    backendUrl: s.backendUrl,
    // Secrets jamais pré-remplis (le serveur les renvoie vides) : '' = inchangé.
    apiKey: '',
    model: s.model,
    modelMode: s.modelMode,
    temperature: String(s.temperature),
    maxTokens: String(s.maxTokens),
    maxHistoryMessages: String(s.maxHistoryMessages),
    memoryEnabled: s.memoryEnabled,
    fileToolsEnabled: s.fileToolsEnabled,
    allowDelete: s.allowDelete,
    toolsRoot: s.toolsRoot,
    password: '',
    contextSize: String(s.contextSize),
    autoCompact: s.autoCompact,
    timeAwareness: s.timeAwareness,
    showThoughts: s.showThoughts,
    ttsEnabled: s.ttsEnabled,
    ttsUrl: s.ttsUrl,
    ttsModel: s.ttsModel,
    ttsVoice: s.ttsVoice,
  }
}

function fromForm(f: FormState, base: Settings, clearApiKey: boolean, clearPassword: boolean): Partial<Settings> {
  const num = (v: string, fallback: number) => {
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? n : fallback
  }
  return {
    backendUrl: f.backendUrl.trim(),
    apiKey: clearApiKey ? api.CLEAR_SECRET : f.apiKey,
    model: f.model.trim(),
    modelMode: f.modelMode,
    temperature: num(f.temperature, base.temperature),
    maxTokens: Math.round(num(f.maxTokens, base.maxTokens)),
    maxHistoryMessages: Math.round(num(f.maxHistoryMessages, base.maxHistoryMessages)),
    memoryEnabled: f.memoryEnabled,
    fileToolsEnabled: f.fileToolsEnabled,
    allowDelete: f.allowDelete,
    toolsRoot: f.toolsRoot.trim(),
    password: clearPassword ? api.CLEAR_SECRET : f.password,
    contextSize: Math.round(num(f.contextSize, base.contextSize)),
    autoCompact: f.autoCompact,
    timeAwareness: f.timeAwareness,
    showThoughts: f.showThoughts,
    ttsEnabled: f.ttsEnabled,
    ttsUrl: f.ttsUrl.trim(),
    ttsModel: f.ttsModel.trim(),
    ttsVoice: f.ttsVoice.trim(),
  }
}

function Toggle({
  label,
  sub,
  checked,
  onChange,
  danger,
}: {
  label: string
  sub?: string
  checked: boolean
  onChange: (v: boolean) => void
  danger?: boolean
}) {
  return (
    <label className={`toggle${danger ? ' danger' : ''}`}>
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {sub && <span className="toggle-sub">{sub}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

/** Sélecteur segmenté : une valeur parmi quelques-unes, appliquée au clic. */
function Seg<T extends string>({
  value,
  options,
  labels,
  onPick,
  ariaLabel,
}: {
  value: T
  options: readonly T[]
  labels: Record<T, string>
  onPick: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {options.map((code) => (
        <button
          key={code}
          type="button"
          className="seg-btn"
          aria-pressed={value === code}
          onClick={() => onPick(code)}
        >
          {labels[code]}
        </button>
      ))}
    </div>
  )
}

const LANG_OPTIONS: readonly Lang[] = ['fr', 'en']
const MODEL_MODE_OPTIONS: readonly ModelMode[] = ['full', 'simple']

export default function SettingsDialog({ settings, onSaved, onClose }: Props) {
  const { lang, setLang, t } = useI18n()
  const [form, setForm] = useState<FormState>(() => toForm(settings))
  const [initialForm] = useState<FormState>(() => toForm(settings))
  // Demandes d'effacement des secrets (envoient la sentinelle au PUT).
  const [clearApiKey, setClearApiKey] = useState(false)
  const [clearPassword, setClearPassword] = useState(false)
  const [models, setModels] = useState<string[] | null>(null)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Indicateurs de présence des secrets — la réponse serveur les porte (type local api.SettingsView),
  // shared/types.ts reste intact, d'où la lecture défensive.
  const flags = settings as Settings & Partial<Pick<api.SettingsView, 'passwordSet' | 'apiKeySet'>>
  const apiKeySet = flags.apiKeySet === true
  const passwordSet = flags.passwordSet === true

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const dirty =
    clearApiKey ||
    clearPassword ||
    (Object.keys(form) as (keyof FormState)[]).some((k) => form[k] !== initialForm[k])

  function secretPlaceholder(configured: boolean, clearing: boolean): string {
    if (clearing) return t('secretWillClearPlaceholder')
    return configured ? t('secretConfiguredPlaceholder') : t('secretNotConfiguredPlaceholder')
  }

  async function test() {
    setTesting(true)
    setTestMsg(null)
    setModels(null)
    try {
      // Test SANS persistance : les valeurs COURANTES du formulaire partent au
      // POST /models ; champ vide = le serveur retombe sur la valeur enregistrée.
      const input: { backendUrl?: string; apiKey?: string } = {}
      const url = form.backendUrl.trim()
      if (url) input.backendUrl = url
      if (clearApiKey) input.apiKey = ''
      else if (form.apiKey) input.apiKey = form.apiKey
      const list = await api.testModels(input)
      setModels(list)
      setTestMsg({
        ok: true,
        text: t(isPlural(lang, list.length) ? 'testOkMany' : 'testOkOne', { n: list.length }),
      })
    } catch (e) {
      setTestMsg({ ok: false, text: api.errorMessage(e) })
    } finally {
      setTesting(false)
    }
  }

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const passwordChanged = clearPassword || form.password.length > 0
      const newPassword = clearPassword ? '' : form.password
      const next = await api.putSettings(fromForm(form, settings, clearApiKey, clearPassword))
      // Le PUT ne renvoie plus les secrets, et un changement de mot de passe
      // révoque toutes les sessions côté serveur : on se reconnecte tout de
      // suite via le flux login standard pour garder une session valide.
      if (passwordChanged && newPassword) {
        try {
          await api.login(newPassword)
        } catch {
          /* le LoginGate prendra le relais au prochain 401 */
        }
      }
      // App.handleSettingsSaved resynchronise le token depuis `password` : on lui
      // passe la valeur à conserver (token courant, ou '' si l'auth est retirée).
      const keepToken = passwordChanged && !newPassword ? '' : api.getToken() ?? ''
      onSaved({ ...next, password: keepToken })
      onClose()
    } catch (e) {
      setSaveError(api.errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={t('settings')}
      onClose={onClose}
      guardClose={() => !dirty || window.confirm(t('unsavedConfirm'))}
      footer={
        <>
          {saveError && <span className="msg-err">{saveError}</span>}
          <button className="btn" onClick={onClose} disabled={saving}>
            {t('cancel')}
          </button>
          <button className="btn primary" onClick={() => save().catch((e) => console.error('[settings]', e))} disabled={saving}>
            {saving ? t('saving') : t('save')}
          </button>
        </>
      }
    >
      <h3 className="section-title">{t('language')}</h3>
      <Seg
        value={lang}
        options={LANG_OPTIONS}
        labels={{ fr: t('langFr'), en: t('langEn') }}
        onPick={setLang}
        ariaLabel={t('language')}
      />

      <h3 className="section-title">{t('sectionBackend')}</h3>
      <div className="field">
        <label htmlFor="set-url">{t('backendUrl')}</label>
        <input
          id="set-url"
          type="url"
          value={form.backendUrl}
          placeholder="http://127.0.0.1:5001/v1"
          onChange={(e) => set('backendUrl', e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="set-key">{t('apiKey')}</label>
        <div className="row">
          <input
            id="set-key"
            type="password"
            value={form.apiKey}
            placeholder={secretPlaceholder(apiKeySet, clearApiKey)}
            autoComplete="off"
            style={{ flex: 1, minWidth: 0 }}
            onChange={(e) => {
              setClearApiKey(false)
              set('apiKey', e.target.value)
            }}
          />
          {apiKeySet && !clearApiKey && (
            <button
              className="btn small"
              type="button"
              onClick={() => {
                setClearApiKey(true)
                set('apiKey', '')
              }}
            >
              {t('removeSecret')}
            </button>
          )}
        </div>
      </div>
      <div className="field">
        <label htmlFor="set-model">{t('model')}</label>
        <div className="row">
          <input
            id="set-model"
            type="text"
            value={form.model}
            placeholder={t('modelPlaceholder')}
            style={{ flex: 1 }}
            onChange={(e) => set('model', e.target.value)}
          />
          <button className="btn" onClick={() => test().catch((e) => console.error('[settings]', e))} disabled={testing}>
            {testing ? t('testing') : t('testConnection')}
          </button>
        </div>
        {testMsg && <span className={testMsg.ok ? 'msg-ok' : 'msg-err'}>{testMsg.text}</span>}
        {models && models.length > 0 && (
          <select
            aria-label={t('chooseDetectedModel')}
            value={models.includes(form.model) ? form.model : ''}
            onChange={(e) => {
              if (e.target.value) set('model', e.target.value)
            }}
          >
            <option value="">{t('chooseDetectedModelOption')}</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
      </div>

      <h3 className="section-title">{t('sectionGeneration')}</h3>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="set-temp">{t('temperature')}</label>
          <input id="set-temp" type="number" step="0.1" min="0" max="2" value={form.temperature} onChange={(e) => set('temperature', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="set-max">{t('maxTokens')}</label>
          <input id="set-max" type="number" step="1" min="1" value={form.maxTokens} onChange={(e) => set('maxTokens', e.target.value)} />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="set-hist">{t('maxHistory')}</label>
          <input id="set-hist" type="number" step="1" min="0" value={form.maxHistoryMessages} onChange={(e) => set('maxHistoryMessages', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="set-ctx">{t('contextSize')}</label>
          <input id="set-ctx" type="number" step="1" min="0" value={form.contextSize} onChange={(e) => set('contextSize', e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>{t('modelMode')}</label>
        {/* .field est une colonne flex : ce bloc empêche le sélecteur de s'étirer. */}
        <div>
          <Seg
            value={form.modelMode}
            options={MODEL_MODE_OPTIONS}
            labels={{ full: t('modelModeFull'), simple: t('modelModeSimple') }}
            onPick={(v) => set('modelMode', v)}
            ariaLabel={t('modelMode')}
          />
        </div>
        <span className="hint">{t('modelModeSub')}</span>
      </div>
      <Toggle
        label={t('autoCompact')}
        sub={t('autoCompactSub')}
        checked={form.autoCompact}
        onChange={(v) => set('autoCompact', v)}
      />
      <Toggle
        label={t('timeAwareness')}
        sub={t('timeAwarenessSub')}
        checked={form.timeAwareness}
        onChange={(v) => set('timeAwareness', v)}
      />
      <Toggle
        label={t('showThoughts')}
        sub={t('showThoughtsSub')}
        checked={form.showThoughts}
        onChange={(v) => set('showThoughts', v)}
      />

      <h3 className="section-title">{t('sectionTts')}</h3>
      <Toggle
        label={t('ttsEnabled')}
        sub={t('ttsEnabledSub')}
        checked={form.ttsEnabled}
        onChange={(v) => set('ttsEnabled', v)}
      />
      <div className="field">
        <label htmlFor="set-tts-url">{t('ttsUrl')}</label>
        <input
          id="set-tts-url"
          type="url"
          value={form.ttsUrl}
          placeholder="http://127.0.0.1:8880/v1"
          onChange={(e) => set('ttsUrl', e.target.value)}
        />
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="set-tts-model">{t('ttsModel')}</label>
          <input id="set-tts-model" type="text" value={form.ttsModel} onChange={(e) => set('ttsModel', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="set-tts-voice">{t('ttsVoice')}</label>
          <input id="set-tts-voice" type="text" value={form.ttsVoice} onChange={(e) => set('ttsVoice', e.target.value)} />
        </div>
      </div>
      <span className="hint">{t('ttsHint')}</span>

      <h3 className="section-title">{t('sectionMemoryTools')}</h3>
      <Toggle
        label={t('memoryToggle')}
        sub={t('memoryToggleSub')}
        checked={form.memoryEnabled}
        onChange={(v) => set('memoryEnabled', v)}
      />
      <Toggle
        label={t('fileTools')}
        sub={t('fileToolsSub')}
        checked={form.fileToolsEnabled}
        onChange={(v) => set('fileToolsEnabled', v)}
      />
      <Toggle
        label={t('allowDelete')}
        sub={t('allowDeleteSub')}
        checked={form.allowDelete}
        onChange={(v) => set('allowDelete', v)}
        danger
      />
      <div className="field">
        <label htmlFor="set-root">{t('sandboxDir')}</label>
        <input id="set-root" type="text" value={form.toolsRoot} onChange={(e) => set('toolsRoot', e.target.value)} />
      </div>

      <h3 className="section-title">{t('sectionAccess')}</h3>
      <div className="field">
        <label htmlFor="set-pw">{t('accessPassword')}</label>
        <div className="row">
          <input
            id="set-pw"
            type="password"
            value={form.password}
            placeholder={secretPlaceholder(passwordSet, clearPassword)}
            autoComplete="new-password"
            style={{ flex: 1, minWidth: 0 }}
            onChange={(e) => {
              setClearPassword(false)
              set('password', e.target.value)
            }}
          />
          {passwordSet && !clearPassword && (
            <button
              className="btn small"
              type="button"
              onClick={() => {
                if (window.confirm(t('removePasswordConfirm'))) {
                  setClearPassword(true)
                  set('password', '')
                }
              }}
            >
              {t('removeSecret')}
            </button>
          )}
        </div>
        <span className="hint">{t('accessPasswordHint')}</span>
      </div>
    </Dialog>
  )
}
