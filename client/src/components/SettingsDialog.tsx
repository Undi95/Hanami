// Réglages : backend LLM, génération, mémoire/outils, mot de passe d'accès.
// Les secrets (clé API, mot de passe) ne sont jamais renvoyés par le serveur :
// les champs démarrent vides ('' = conserver la valeur configurée) et le bouton
// « Retirer » envoie la sentinelle CLEAR_SECRET.
import { useState } from 'react'
import type {
  ModelMode,
  RestorePreview,
  RestoreResult,
  RestoreWarning,
  Settings,
  VisionMode,
} from '../../../shared/types'
import * as api from '../api'
import { isPlural, localeOf, useI18n, type Key, type Lang } from '../i18n'
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
import CreditsPanel from './CreditsPanel'
import Dialog from './Dialog'
import Toggle from './Toggle'
import VoicePicker from './VoicePicker'

interface Props {
  settings: Settings
  theme: AppTheme
  onPickTheme: (theme: AppTheme) => void
  // Décor 3D : préférence d'interface (data/ui.json), pas un réglage du backend —
  // elle vit donc HORS du formulaire, comme le thème, et s'applique au clic.
  env3d: boolean
  onToggleEnv3d: (on: boolean) => void
  vrmaEnabled: boolean
  onToggleVrma: (on: boolean) => void
  interactive: boolean
  // Grisé (petit écran, ou animations coupées) et la raison à afficher à la
  // place du sous-titre. C'est l'APPLICATION du réglage qui est conditionnée,
  // pas la préférence : elle reste telle quelle dans data/ui.json.
  interactiveDisabled: boolean
  interactiveReason: string
  onToggleInteractive: (on: boolean) => void
  onSaved: (s: Settings) => void
  onClose: () => void
}

// Plafonds de la persona — les MÊMES que le serveur (api/settings.ts) : le
// champ s'arrête de lui-même plutôt que de faire tronquer en silence.
const PERSONA_NAME_MAX = 60
const PERSONA_DESCRIPTION_MAX = 1000

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
  webSearchEnabled: boolean
  webSearchUrl: string
  password: string
  contextSize: string
  autoCompact: boolean
  spontaneousEnabled: boolean
  spontaneousStartHour: string
  spontaneousEndHour: string
  personaName: string
  personaDescription: string
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
    // Réglage optionnel (config.json d'avant le réglage) : absent = éteint.
    webSearchEnabled: s.webSearchEnabled === true,
    webSearchUrl: s.webSearchUrl ?? '',
    password: '',
    contextSize: String(s.contextSize),
    autoCompact: s.autoCompact,
    spontaneousEnabled: s.spontaneousEnabled,
    spontaneousStartHour: String(s.spontaneousStartHour),
    spontaneousEndHour: String(s.spontaneousEndHour),
    // Persona : champs optionnels, absents des config.json d'avant le réglage.
    personaName: s.personaName ?? '',
    personaDescription: s.personaDescription ?? '',
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
    webSearchEnabled: f.webSearchEnabled,
    webSearchUrl: f.webSearchUrl.trim(),
    password: clearPassword ? api.CLEAR_SECRET : f.password,
    contextSize: Math.round(num(f.contextSize, base.contextSize)),
    autoCompact: f.autoCompact,
    spontaneousEnabled: f.spontaneousEnabled,
    spontaneousStartHour: Math.round(num(f.spontaneousStartHour, base.spontaneousStartHour)),
    spontaneousEndHour: Math.round(num(f.spontaneousEndHour, base.spontaneousEndHour)),
    personaName: f.personaName.trim(),
    personaDescription: f.personaDescription.trim(),
    timeAwareness: f.timeAwareness,
    showThoughts: f.showThoughts,
    notifySound: f.notifySound,
    ttsEnabled: f.ttsEnabled,
    ttsUrl: f.ttsUrl.trim(),
    ttsModel: f.ttsModel.trim(),
    ttsVoice: f.ttsVoice.trim(),
  }
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

// Les avertissements arrivent du serveur en CODES : les phrases, elles, sont
// écrites dans les deux langues ici (shared/types.ts ne porte aucun texte).
const WARNING_LABELS: Record<RestoreWarning, Key> = {
  configReplaced: 'restoreWarnConfig',
  passwordChanges: 'restoreWarnPassword',
  noManifest: 'restoreWarnNoManifest',
  emptyInstance: 'restoreWarnEmpty',
}

const STATUS_LABELS: Record<RestorePreview['characters'][number]['status'], Key> = {
  added: 'restoreStatusAdded',
  replaced: 'restoreStatusReplaced',
  identical: 'restoreStatusIdentical',
}

/**
 * RESTAURATION — deux temps, jamais un seul.
 *
 * 1. L'archive choisie part au serveur, qui la lit, la vérifie et rend un
 *    APERÇU : ce qu'elle contient, et le diff avec l'existant. Rien n'est écrit,
 *    et le fichier reste déposé côté serveur sous un jeton.
 * 2. Le bouton rouge ARME (premier clic, avec le résumé du diff), puis exécute
 *    (second clic) — la grammaire des suppressions du reste de l'app.
 *
 * Après coup, le chemin du filet est affiché : c'est l'état d'AVANT, archivé
 * juste avant l'écriture, et le seul retour en arrière possible.
 */
function RestoreBlock({ done, onDone }: { done: RestoreResult | null; onDone: (r: RestoreResult) => void }) {
  const { lang, t } = useI18n()
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [reading, setReading] = useState(false)
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const plural = (n: number, one: Key, many: Key) => t(isPlural(lang, n) ? many : one, { n })

  async function choose(file: File) {
    setReading(true)
    setError(null)
    setPreview(null)
    setArmed(false)
    try {
      setPreview(await api.previewRestore(file))
    } catch (e) {
      setError(api.errorMessage(e))
    } finally {
      setReading(false)
    }
  }

  async function restore() {
    if (!preview) return
    // Premier clic : on arme, et le bouton devient rouge avec le résumé du diff.
    if (!armed) {
      setArmed(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      onDone(await api.applyRestore(preview.stagedId))
      setPreview(null)
      setArmed(false)
    } catch (e) {
      setError(api.errorMessage(e))
      setArmed(false)
    } finally {
      setBusy(false)
    }
  }

  // Après la restauration, le bloc ne montre plus que le résultat et le filet :
  // relancer une seconde restauration sur un client dont l'état est périmé n'a
  // aucun sens — le rechargement est dans le pied de page du dialog.
  if (done) {
    return (
      <div className="restore-done">
        <p className="msg-ok">{t('restoreDone', { files: plural(done.files.total, 'restoreFilesOne', 'restoreFilesMany') })}</p>
        <p className="hint">{t('restoreNet')}</p>
        <p className="restore-net-path">{done.net.file}</p>
        <p className="hint">{t('restoreNoRestart')}</p>
        {done.passwordChanged && <p className="warn-text">{t('restorePasswordChanged')}</p>}
      </div>
    )
  }

  const items = preview
    ? [
        preview.counts.characters > 0 && plural(preview.counts.characters, 'restoreCharsOne', 'restoreCharsMany'),
        preview.counts.chats > 0 && plural(preview.counts.chats, 'restoreChatsOne', 'restoreChatsMany'),
        preview.counts.memory > 0 && plural(preview.counts.memory, 'restoreMemoryOne', 'restoreMemoryMany'),
        preview.counts.portraits > 0 && plural(preview.counts.portraits, 'restorePortraitsOne', 'restorePortraitsMany'),
        preview.counts.config && t('restoreConfigItem'),
        preview.counts.ui && t('restoreUiItem'),
      ].filter((x): x is string => typeof x === 'string')
    : []

  return (
    <>
      <div className="row">
        <label className={`btn file-btn${reading || busy ? ' disabled' : ''}`}>
          {reading ? t('restoreReading') : t('restoreChoose')}
          {/* Le corps part en application/zip (exigé par la route) ; c'est le
              serveur qui décide si ce zip est une sauvegarde Hanami. */}
          <input
            type="file"
            accept=".zip,application/zip"
            hidden
            disabled={reading || busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) choose(f).catch((err) => console.error('[restore]', err))
            }}
          />
        </label>
      </div>
      <span className="hint">{t('restoreHint')}</span>
      {error && <p className="msg-err">{error}</p>}

      {preview && (
        <>
          <div className="restore-preview">
            <p className="restore-head">
              {preview.archive.createdAt
                ? t('restoreFrom', { date: new Date(preview.archive.createdAt).toLocaleString(localeOf(lang)) })
                : t('restoreFromUnknown')}
            </p>
            <p className="restore-items">{items.join(' · ')}</p>
            <ul className="restore-diff">
              <li className="add">{plural(preview.files.added, 'restoreAddedOne', 'restoreAddedMany')}</li>
              <li className="rep">{plural(preview.files.replaced, 'restoreReplacedOne', 'restoreReplacedMany')}</li>
              <li>{plural(preview.files.identical, 'restoreIdenticalOne', 'restoreIdenticalMany')}</li>
            </ul>
            {preview.characters.length > 0 && (
              <ul className="restore-chars">
                {preview.characters.map((c) => (
                  <li key={c.id}>
                    <span className={`restore-tag ${c.status}`}>{t(STATUS_LABELS[c.status])}</span>
                    {c.name}
                  </li>
                ))}
              </ul>
            )}
            {preview.kept.characters.length > 0 && (
              <p className="hint">{t('restoreKept', { names: preview.kept.characters.join(', ') })}</p>
            )}
            {preview.warnings.map((w) => (
              <p key={w} className="warn-text">
                {t(WARNING_LABELS[w])}
              </p>
            ))}
          </div>

          <div className="danger-zone">
            <p className="warn-text">
              {armed
                ? t('restoreArmed', {
                    added: plural(preview.files.added, 'restoreAddedOne', 'restoreAddedMany'),
                    replaced: plural(preview.files.replaced, 'restoreReplacedOne', 'restoreReplacedMany'),
                  })
                : t('restoreWarn')}
            </p>
            <button
              className="btn danger"
              type="button"
              disabled={busy}
              onClick={() => restore().catch((e) => console.error('[restore]', e))}
            >
              {busy ? t('restoreBusy') : armed ? t('restoreConfirm') : t('restoreArm')}
            </button>
            {armed && !busy && (
              <button className="btn small" type="button" style={{ marginLeft: 8 }} onClick={() => setArmed(false)}>
                {t('cancel')}
              </button>
            )}
          </div>
        </>
      )}
    </>
  )
}

const LANG_OPTIONS: readonly Lang[] = ['fr', 'en']
const MODEL_MODE_OPTIONS: readonly ModelMode[] = ['full', 'simple']
const VISION_MODE_OPTIONS: readonly VisionMode[] = ['auto', 'on', 'off']

// Trois onglets pour ne pas dérouler un formulaire à rallonge. Le découpage est
// thématique : ce qu'on voit, le modèle qui parle, ce que Hanami sait faire.
//
// Le quatrième, « Crédits », ne règle rien : il AFFICHE. Il est ici et pas dans
// un pied de page parce que la CC BY 4.0 des décors veut que l'attribution
// reste accessible aux utilisateurs de l'application — un onglet est le seul
// endroit de cette app qu'on trouve sans le chercher. Il ne touche pas au
// formulaire : en sortir n'a rien enregistré ni rien perdu, comme les autres.
type Tab = 'appearance' | 'model' | 'features' | 'credits'
const TAB_OPTIONS: readonly Tab[] = ['appearance', 'model', 'features', 'credits']
const TAB_LABELS: Record<Tab, Key> = {
  appearance: 'tabAppearance',
  model: 'tabModel',
  features: 'tabFeatures',
  credits: 'tabCredits',
}

export default function SettingsDialog({
  settings,
  theme,
  onPickTheme,
  env3d,
  onToggleEnv3d,
  vrmaEnabled,
  onToggleVrma,
  interactive,
  interactiveDisabled,
  interactiveReason,
  onToggleInteractive,
  onSaved,
  onClose,
}: Props) {
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
  // Sauvegarde : le zip arrive par fetch (l'en-tête d'authentification est
  // obligatoire), il n'y a donc rien à afficher pendant l'attente sauf l'état du bouton.
  const [downloading, setDownloading] = useState(false)
  // Restauration faite : le serveur porte maintenant les réglages de l'archive,
  // et ce formulaire porte ceux d'AVANT. Enregistrer les réécrirait par-dessus
  // ce qu'on vient de restaurer : le bouton disparaît au profit du rechargement.
  const [restored, setRestored] = useState<RestoreResult | null>(null)

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
   * Télécharge l'archive de sauvegarde. Le blob reçu est offert au navigateur
   * par un <a download> créé à la volée : c'est le seul moyen de déclencher un
   * enregistrement de fichier depuis une réponse fetch. L'URL objet est révoquée
   * après coup (différée : certains navigateurs la relisent après le clic).
   */
  async function saveBackup() {
    setDownloading(true)
    setSaveError(null)
    try {
      const { blob, filename } = await api.downloadBackup()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      // Dans le document : Firefox ignore le clic d'un lien détaché.
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      setSaveError(api.errorMessage(e))
    } finally {
      setDownloading(false)
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

  /**
   * Après une restauration, la page repart de zéro : c'est le moyen le plus sûr
   * de resynchroniser TOUT (réglages, personnages, conversations, préférences)
   * sans réécrire un état périmé. Le jeton de session est jeté si le mot de
   * passe de l'archive diffère — il ne vaut plus rien, le LoginGate prendra la
   * main. Aucun redémarrage du serveur : il relit data/ à chaque requête.
   */
  function reloadAfterRestore() {
    if (restored?.passwordChanged) api.setToken(null)
    window.location.reload()
  }

  return (
    <Dialog
      title={t('settings')}
      onClose={restored ? reloadAfterRestore : onClose}
      guardClose={() => Boolean(restored) || !dirty || window.confirm(t('unsavedConfirm'))}
      footer={
        restored ? (
          <button className="btn primary" onClick={reloadAfterRestore}>
            {t('restoreReload')}
          </button>
        ) : (
          <>
            {saveError && <span className="msg-err">{saveError}</span>}
            <button className="btn" onClick={onClose} disabled={saving}>
              {t('cancel')}
            </button>
            <button className="btn primary" onClick={() => save().catch((e) => console.error('[settings]', e))} disabled={saving}>
              {saving ? t('saving') : t('save')}
            </button>
          </>
        )
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

          <h3 className="section-title">{t('sectionScene')}</h3>
          {/* Hors formulaire, appliqué au clic comme le thème et la langue : c'est
              une préférence d'interface, pas un réglage du modèle. */}
          <Toggle
            label={t('env3d')}
            sub={t('env3dSub')}
            checked={env3d}
            onChange={onToggleEnv3d}
          />
          <Toggle
            label={t('vrmaOn')}
            sub={t('vrmaOnSub')}
            checked={vrmaEnabled}
            onChange={onToggleVrma}
          />
          <Toggle
            label={t('sceneLive')}
            sub={t('sceneLiveSub')}
            checked={interactive}
            disabled={interactiveDisabled}
            reason={interactiveReason}
            onChange={onToggleInteractive}
          />
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
          {/* PERSONA — qui parle, de l'autre côté. Deux champs, pas un système
              de personas multiples : c'est le même utilisateur qui écrit à tous
              ses personnages. Le nom alimente aussi la macro {{user}} des cards. */}
          <h3 className="section-title">{t('sectionPersona')}</h3>
          <div className="field">
            <label htmlFor="set-persona-name">{t('personaName')}</label>
            <input
              id="set-persona-name"
              type="text"
              value={form.personaName}
              maxLength={PERSONA_NAME_MAX}
              placeholder={t('personaNamePlaceholder')}
              onChange={(e) => set('personaName', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="set-persona-desc">{t('personaDescription')}</label>
            <textarea
              id="set-persona-desc"
              rows={3}
              value={form.personaDescription}
              maxLength={PERSONA_DESCRIPTION_MAX}
              placeholder={t('personaDescriptionPlaceholder')}
              onChange={(e) => set('personaDescription', e.target.value)}
            />
            <span className="hint">{t('personaHint')}</span>
          </div>

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
            {/* Bouton de sonde, ligne de résultat et pastilles de voix : le même
                composant que le dialog Personnages (VoicePicker) — ici il sonde
                l'URL du champ, même pas encore enregistrée. */}
            <VoicePicker
              url={form.ttsUrl}
              value={form.ttsVoice}
              onPick={(v) => set('ttsVoice', v)}
              // Le nom de modèle annoncé par le serveur remplit le champ : plus
              // rien à recopier à la main (il reste éditable, certains l'ignorent).
              onModel={(m) => set('ttsModel', m)}
              disabled={!form.ttsUrl.trim()}
            >
              <input
                id="set-tts-url"
                type="url"
                value={form.ttsUrl}
                placeholder="http://127.0.0.1:8880/v1"
                style={{ flex: 1, minWidth: 0 }}
                onChange={(e) => set('ttsUrl', e.target.value)}
              />
            </VoicePicker>
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

          <h3 className="section-title">{t('sectionWebSearch')}</h3>
          <p className="hint">{t('webSearchHelp')}</p>
          <Toggle
            label={t('webSearchToggle')}
            sub={t('webSearchToggleSub')}
            checked={form.webSearchEnabled}
            onChange={(v) => set('webSearchEnabled', v)}
          />
          <div className="field">
            <label htmlFor="set-websearch-url">{t('webSearchUrlLabel')}</label>
            <input
              id="set-websearch-url"
              type="url"
              value={form.webSearchUrl}
              placeholder={t('webSearchUrlPlaceholder')}
              onChange={(e) => set('webSearchUrl', e.target.value)}
            />
            <span className="hint">{t('webSearchUrlHint')}</span>
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

          <h3 className="section-title">{t('sectionData')}</h3>
          <div className="field">
            {/* .field est une colonne flex : ce bloc empêche le bouton de s'étirer. */}
            <div>
              <button
                className="btn small"
                type="button"
                disabled={downloading}
                onClick={() => saveBackup().catch((e) => console.error('[backup]', e))}
              >
                {downloading ? t('backupDownloading') : t('backupDownload')}
              </button>
            </div>
            <span className="hint">{t('backupHint')}</span>
          </div>

          {/* Le chemin inverse, juste en dessous : reprendre une archive. */}
          <div className="field">
            <label>{t('restoreTitle')}</label>
            <RestoreBlock done={restored} onDone={setRestored} />
          </div>
        </>
      )}

      {/* Lecture seule : rien de ce panneau n'écrit quoi que ce soit. */}
      {tab === 'credits' && <CreditsPanel />}
    </Dialog>
  )
}
