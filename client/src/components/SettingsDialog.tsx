// Réglages : backend LLM, génération, mémoire/outils, mot de passe d'accès.
// Les secrets (clé API, mot de passe) ne sont jamais renvoyés par le serveur :
// les champs démarrent vides ('' = conserver la valeur configurée) et le bouton
// « Retirer » envoie la sentinelle CLEAR_SECRET.
import { useState } from 'react'
import type { ModelMode, Settings, VisionMode } from '../../../shared/types'
import * as api from '../api'
import { isPlural, useI18n, type Key, type Lang } from '../i18n'
import {
  THEMES,
  THEME_DOTS,
  THEME_LABELS,
  applyTheme,
  parseThemeCode,
  saveCustom,
  savedCustom,
  themeCode,
  type AppTheme,
  type CustomTheme,
} from '../themes'
import Dialog from './Dialog'

interface Props {
  settings: Settings
  theme: AppTheme
  onPickTheme: (theme: AppTheme) => void
  onSaved: (s: Settings) => void
  onClose: () => void
}

// Les champs numériques sont édités en texte puis parsés à l'enregistrement.
interface FormState {
  backendUrl: string
  apiKey: string
  model: string
  modelMode: ModelMode
  visionMode: VisionMode
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
  spontaneousEnabled: boolean
  spontaneousStartHour: string
  spontaneousEndHour: string
  timeAwareness: boolean
  showThoughts: boolean
  notifySound: boolean
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
    visionMode: s.visionMode,
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
    spontaneousEnabled: s.spontaneousEnabled,
    spontaneousStartHour: String(s.spontaneousStartHour),
    spontaneousEndHour: String(s.spontaneousEndHour),
    timeAwareness: s.timeAwareness,
    showThoughts: s.showThoughts,
    // Réglage optionnel (config.json d'avant le réglage) : absent = éteint.
    notifySound: s.notifySound === true,
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
    visionMode: f.visionMode,
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
    spontaneousEnabled: f.spontaneousEnabled,
    spontaneousStartHour: Math.round(num(f.spontaneousStartHour, base.spontaneousStartHour)),
    spontaneousEndHour: Math.round(num(f.spontaneousEndHour, base.spontaneousEndHour)),
    timeAwareness: f.timeAwareness,
    showThoughts: f.showThoughts,
    notifySound: f.notifySound,
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
const VISION_MODE_OPTIONS: readonly VisionMode[] = ['auto', 'on', 'off']

// Trois onglets pour ne pas dérouler un formulaire à rallonge. Le découpage est
// thématique : ce qu'on voit, le modèle qui parle, ce que Hanami sait faire.
type Tab = 'appearance' | 'model' | 'features'
const TAB_OPTIONS: readonly Tab[] = ['appearance', 'model', 'features']
const TAB_LABELS: Record<Tab, Key> = {
  appearance: 'tabAppearance',
  model: 'tabModel',
  features: 'tabFeatures',
}

export default function SettingsDialog({ settings, theme, onPickTheme, onSaved, onClose }: Props) {
  // Thème perso : deux couleurs, persistées à chaque changement et appliquées
  // en direct quand le thème « Perso » est actif. Le code texte permet de
  // partager/importer un thème d'un copier-coller.
  const [custom, setCustom] = useState<CustomTheme>(() => savedCustom())
  const [codeDraft, setCodeDraft] = useState<string>(() => themeCode(savedCustom()))
  const [codeCopied, setCodeCopied] = useState(false)

  function commitCustom(next: CustomTheme) {
    setCustom(next)
    setCodeDraft(themeCode(next))
    saveCustom(next)
    if (theme === 'custom') applyTheme('custom')
  }

  function setCustomColor(key: keyof CustomTheme, value: string) {
    commitCustom({ ...custom, [key]: value })
  }

  function applyCode() {
    const parsed = parseThemeCode(codeDraft)
    if (parsed) commitCustom(parsed)
    else setCodeDraft(themeCode(custom)) // code invalide : on réaffiche l'actuel
  }

  function copyCode() {
    navigator.clipboard
      .writeText(themeCode(custom))
      .then(() => {
        setCodeCopied(true)
        setTimeout(() => setCodeCopied(false), 1500)
      })
      .catch((e) => console.error('[theme]', e))
  }

  const { lang, setLang, t } = useI18n()
  // Onglet affiché : simple état local, jamais persisté — on revient toujours
  // sur « Apparence » à l'ouverture. Le formulaire ci-dessous reste UNIQUE :
  // changer d'onglet ne perd rien et n'enregistre rien.
  const [tab, setTab] = useState<Tab>('appearance')
  const [form, setForm] = useState<FormState>(() => toForm(settings))
  const [initialForm] = useState<FormState>(() => toForm(settings))
  // Demandes d'effacement des secrets (envoient la sentinelle au PUT).
  const [clearApiKey, setClearApiKey] = useState(false)
  const [clearPassword, setClearPassword] = useState(false)
  // Sonde du backend LLM : une ligne de résultat + les modèles annoncés, sur le
  // même modèle que la sonde TTS plus bas. Le résultat ne vaut que pour l'URL
  // testée, donc il s'efface dès qu'elle change.
  const [backendProbe, setBackendProbe] = useState<{ ok: boolean; text: string; models: string[] } | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Sonde TTS : une ligne de résultat + les voix annoncées par le serveur. Le
  // résultat ne vaut que pour l'URL testée, donc il s'efface dès qu'elle change.
  const [ttsProbe, setTtsProbe] = useState<{ ok: boolean; text: string; voices: api.TtsVoice[] } | null>(null)
  const [ttsProbing, setTtsProbing] = useState(false)

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

  /**
   * Teste le backend et récupère la liste des modèles : l'id exact attendu par le
   * serveur (du genre « qwen3:14b-q4_K_M ») se recopie mal à la main, une pastille
   * cliquable le remet dans le champ « Modèle ».
   */
  async function test() {
    setTesting(true)
    setBackendProbe(null)
    try {
      // Test SANS persistance : les valeurs COURANTES du formulaire partent au
      // POST /models ; champ vide = le serveur retombe sur la valeur enregistrée.
      const input: { backendUrl?: string; apiKey?: string } = {}
      const url = form.backendUrl.trim()
      if (url) input.backendUrl = url
      if (clearApiKey) input.apiKey = ''
      else if (form.apiKey) input.apiKey = form.apiKey
      const models = await api.testModels(input)
      setBackendProbe({
        ok: true,
        text: t(isPlural(lang, models.length) ? 'testOkMany' : 'testOkOne', { n: models.length }),
        models,
      })
    } catch (e) {
      setBackendProbe({ ok: false, text: api.errorMessage(e), models: [] })
    } finally {
      setTesting(false)
    }
  }

  /**
   * Teste l'URL COURANTE du champ (même non enregistrée) et récupère les voix :
   * l'identifiant exact d'une voix (du genre « clone:Sakurav1 ») est introuvable
   * à la main, une pastille cliquable le recopie dans le champ.
   */
  async function testTts() {
    setTtsProbing(true)
    setTtsProbe(null)
    try {
      const r = await api.probeTts(form.ttsUrl.trim())
      const voices = r.voices ?? []
      const parts: string[] = []
      if (r.info) parts.push(r.info)
      if (r.reachable && voices.length === 0) parts.push(t('ttsProbeNoVoices'))
      setTtsProbe({
        ok: r.reachable,
        text: parts.join(' — ') || t(r.reachable ? 'ttsProbeOk' : 'ttsProbeFail'),
        voices,
      })
      // Le nom de modèle annoncé par le serveur remplit le champ : plus rien à
      // recopier à la main (le champ reste éditable, certains serveurs l'ignorent).
      if (r.model) set('ttsModel', r.model)
    } catch (e) {
      setTtsProbe({ ok: false, text: api.errorMessage(e), voices: [] })
    } finally {
      setTtsProbing(false)
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
      {/* Barre d'onglets : un simple filtre d'affichage devant un formulaire
          unique — rien n'est perdu ni enregistré en passant d'un onglet à l'autre. */}
      <div className="seg seg-tabs" role="tablist" aria-label={t('settings')}>
        {TAB_OPTIONS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="seg-btn"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {t(TAB_LABELS[id])}
          </button>
        ))}
      </div>

      {tab === 'appearance' && (
        <>
          <h3 className="section-title">{t('language')}</h3>
          <Seg
            value={lang}
            options={LANG_OPTIONS}
            labels={{ fr: t('langFr'), en: t('langEn') }}
            onPick={setLang}
            ariaLabel={t('language')}
          />

          <h3 className="section-title">{t('theme')}</h3>
          {/* Appliqué immédiatement, comme la langue — pas lié au bouton Enregistrer. */}
          <div className="seg" role="group" aria-label={t('theme')}>
            {THEMES.map((id) => (
              <button
                key={id}
                type="button"
                className="seg-btn theme-btn"
                aria-pressed={theme === id}
                onClick={() => onPickTheme(id)}
              >
                <span
                  className="theme-dot"
                  style={{ background: THEME_DOTS[id][1], borderColor: THEME_DOTS[id][0] }}
                >
                  <span style={{ background: THEME_DOTS[id][0] }} />
                </span>
                {t(THEME_LABELS[id])}
              </button>
            ))}
            <button
              type="button"
              className="seg-btn theme-btn"
              aria-pressed={theme === 'custom'}
              onClick={() => onPickTheme('custom')}
            >
              <span
                className="theme-dot"
                style={{ background: custom.bg, borderColor: custom.accent }}
              >
                <span style={{ background: custom.accent }} />
              </span>
              {t('themeCustom')}
            </button>
          </div>
          {theme === 'custom' && (
            <div className="custom-theme">
              {/* Deux couleurs suffisent : tout le shading est dérivé en CSS. */}
              <label className="custom-color">
                {t('customThemeBg')}
                <input type="color" value={custom.bg} onChange={(e) => setCustomColor('bg', e.target.value)} />
              </label>
              <label className="custom-color">
                {t('customThemeAccent')}
                <input
                  type="color"
                  value={custom.accent}
                  onChange={(e) => setCustomColor('accent', e.target.value)}
                />
              </label>
              <div className="row" style={{ flex: 1, minWidth: 160 }}>
                <input
                  type="text"
                  value={codeDraft}
                  aria-label={t('themeCode')}
                  title={t('themeCode')}
                  style={{ flex: 1, minWidth: 0, fontFamily: 'var(--mono)', fontSize: 12 }}
                  onChange={(e) => setCodeDraft(e.target.value)}
                  onBlur={applyCode}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applyCode()
                  }}
                />
                <button className="btn small" type="button" onClick={copyCode}>
                  {codeCopied ? t('copied') : t('copy')}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'model' && (
        <>
          <h3 className="section-title">{t('sectionBackend')}</h3>
          {/* Même grammaire que la sonde TTS : le bouton Tester colle à l'URL,
              la ligne ✓/✗ et les pastilles de modèles s'affichent juste dessous. */}
          <div className="field">
            <label htmlFor="set-url">{t('backendUrl')}</label>
            <div className="row">
              <input
                id="set-url"
                type="url"
                value={form.backendUrl}
                placeholder="http://127.0.0.1:5001/v1"
                style={{ flex: 1, minWidth: 0 }}
                onChange={(e) => {
                  setBackendProbe(null)
                  set('backendUrl', e.target.value)
                }}
              />
              <button
                className="btn small"
                type="button"
                disabled={testing || !form.backendUrl.trim()}
                onClick={() => test().catch((e) => console.error('[settings]', e))}
              >
                {testing ? t('probing') : t('probe')}
              </button>
            </div>
            {backendProbe && (
              <span className={`probe-line${backendProbe.ok ? '' : ' err'}`}>
                <span className="probe-mark">{backendProbe.ok ? '✓' : '✗'}</span>
                <span>{backendProbe.text}</span>
              </span>
            )}
            {backendProbe && backendProbe.models.length > 0 && (
              <div className="voice-chips" role="group" aria-label={t('chooseDetectedModel')}>
                {backendProbe.models.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="voice-chip"
                    aria-pressed={form.model.trim() === m}
                    title={m}
                    onClick={() => set('model', m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
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
            <input
              id="set-model"
              type="text"
              value={form.model}
              placeholder={t('modelPlaceholder')}
              onChange={(e) => set('model', e.target.value)}
            />
          </div>
          <div className="field">
            <label>{t('visionMode')}</label>
            {/* .field est une colonne flex : ce bloc empêche le sélecteur de s'étirer. */}
            <div>
              <Seg
                value={form.visionMode}
                options={VISION_MODE_OPTIONS}
                labels={{ auto: t('visionModeAuto'), on: t('visionModeOn'), off: t('visionModeOff') }}
                onPick={(v) => set('visionMode', v)}
                ariaLabel={t('visionMode')}
              />
            </div>
            <span className="hint">{t('visionModeSub')}</span>
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
        </>
      )}

      {tab === 'features' && (
        <>
          <h3 className="section-title">{t('sectionConversation')}</h3>
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
          <Toggle
            label={t('notifySound')}
            sub={t('notifySoundSub')}
            checked={form.notifySound}
            onChange={(v) => set('notifySound', v)}
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
            <div className="row">
              <input
                id="set-tts-url"
                type="url"
                value={form.ttsUrl}
                placeholder="http://127.0.0.1:8880/v1"
                style={{ flex: 1, minWidth: 0 }}
                onChange={(e) => {
                  setTtsProbe(null)
                  set('ttsUrl', e.target.value)
                }}
              />
              <button
                className="btn small"
                type="button"
                onClick={() => testTts().catch((e) => console.error('[settings]', e))}
                disabled={ttsProbing || !form.ttsUrl.trim()}
              >
                {ttsProbing ? t('probing') : t('probe')}
              </button>
            </div>
            {ttsProbe && (
              <span className={`probe-line${ttsProbe.ok ? '' : ' err'}`}>
                <span className="probe-mark">{ttsProbe.ok ? '✓' : '✗'}</span>
                <span>{ttsProbe.text}</span>
              </span>
            )}
            {ttsProbe && ttsProbe.voices.length > 0 && (
              <div className="voice-chips" role="group" aria-label={t('ttsProbeVoices')}>
                {ttsProbe.voices.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className="voice-chip"
                    aria-pressed={form.ttsVoice.trim() === v.id}
                    title={v.id}
                    onClick={() => set('ttsVoice', v.id)}
                  >
                    {v.name}
                  </button>
                ))}
              </div>
            )}
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

          <h3 className="section-title">{t('sectionSpontaneous')}</h3>
          <Toggle
            label={t('spontaneousEnabled')}
            sub={t('spontaneousEnabledSub')}
            checked={form.spontaneousEnabled}
            onChange={(v) => set('spontaneousEnabled', v)}
          />
          {form.spontaneousEnabled && (
            <div className="grid-2">
              <div className="field">
                <label htmlFor="set-sp-start">{t('spontaneousStart')}</label>
                <input
                  id="set-sp-start"
                  type="number"
                  step="1"
                  min="0"
                  max="23"
                  value={form.spontaneousStartHour}
                  onChange={(e) => set('spontaneousStartHour', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="set-sp-end">{t('spontaneousEnd')}</label>
                <input
                  id="set-sp-end"
                  type="number"
                  step="1"
                  min="0"
                  max="23"
                  value={form.spontaneousEndHour}
                  onChange={(e) => set('spontaneousEndHour', e.target.value)}
                />
              </div>
            </div>
          )}

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
        </>
      )}
    </Dialog>
  )
}
