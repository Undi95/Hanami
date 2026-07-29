// Réglages : backend LLM, génération, mémoire/outils, mot de passe d'accès.
import { useState } from 'react'
import type { Settings } from '../../../shared/types'
import * as api from '../api'
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
  temperature: string
  maxTokens: string
  maxHistoryMessages: string
  memoryEnabled: boolean
  fileToolsEnabled: boolean
  allowDelete: boolean
  toolsRoot: string
  password: string
}

function toForm(s: Settings): FormState {
  return {
    backendUrl: s.backendUrl,
    apiKey: s.apiKey,
    model: s.model,
    temperature: String(s.temperature),
    maxTokens: String(s.maxTokens),
    maxHistoryMessages: String(s.maxHistoryMessages),
    memoryEnabled: s.memoryEnabled,
    fileToolsEnabled: s.fileToolsEnabled,
    allowDelete: s.allowDelete,
    toolsRoot: s.toolsRoot,
    password: s.password,
  }
}

function fromForm(f: FormState, base: Settings): Partial<Settings> {
  const num = (v: string, fallback: number) => {
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? n : fallback
  }
  return {
    backendUrl: f.backendUrl.trim(),
    apiKey: f.apiKey,
    model: f.model.trim(),
    temperature: num(f.temperature, base.temperature),
    maxTokens: Math.round(num(f.maxTokens, base.maxTokens)),
    maxHistoryMessages: Math.round(num(f.maxHistoryMessages, base.maxHistoryMessages)),
    memoryEnabled: f.memoryEnabled,
    fileToolsEnabled: f.fileToolsEnabled,
    allowDelete: f.allowDelete,
    toolsRoot: f.toolsRoot.trim(),
    password: f.password,
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

export default function SettingsDialog({ settings, onSaved, onClose }: Props) {
  const [form, setForm] = useState<FormState>(() => toForm(settings))
  const [models, setModels] = useState<string[] | null>(null)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function test() {
    setTesting(true)
    setTestMsg(null)
    setModels(null)
    try {
      // Le proxy /models teste les réglages ENREGISTRÉS : on pousse d'abord URL + clé.
      await api.putSettings({ backendUrl: form.backendUrl.trim(), apiKey: form.apiKey })
      const list = await api.getModels()
      setModels(list)
      setTestMsg({ ok: true, text: `Connexion réussie — ${list.length} modèle${list.length > 1 ? 's' : ''} détecté${list.length > 1 ? 's' : ''}.` })
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
      const next = await api.putSettings(fromForm(form, settings))
      onSaved(next)
      onClose()
    } catch (e) {
      setSaveError(api.errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title="Réglages"
      onClose={onClose}
      footer={
        <>
          {saveError && <span className="msg-err">{saveError}</span>}
          <button className="btn" onClick={onClose} disabled={saving}>
            Annuler
          </button>
          <button className="btn primary" onClick={() => save().catch((e) => console.error('[réglages]', e))} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <h3 className="section-title">Backend LLM</h3>
      <div className="field">
        <label htmlFor="set-url">URL du backend (compatible OpenAI)</label>
        <input
          id="set-url"
          type="url"
          value={form.backendUrl}
          placeholder="http://127.0.0.1:5001/v1"
          onChange={(e) => set('backendUrl', e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="set-key">Clé API</label>
        <input
          id="set-key"
          type="password"
          value={form.apiKey}
          placeholder="(souvent vide pour un backend local)"
          autoComplete="off"
          onChange={(e) => set('apiKey', e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="set-model">Modèle</label>
        <div className="row">
          <input
            id="set-model"
            type="text"
            value={form.model}
            placeholder="(certains backends l'ignorent)"
            style={{ flex: 1 }}
            onChange={(e) => set('model', e.target.value)}
          />
          <button className="btn" onClick={() => test().catch((e) => console.error('[réglages]', e))} disabled={testing}>
            {testing ? 'Test…' : 'Tester la connexion'}
          </button>
        </div>
        {testMsg && <span className={testMsg.ok ? 'msg-ok' : 'msg-err'}>{testMsg.text}</span>}
        {models && models.length > 0 && (
          <select
            aria-label="Choisir un modèle détecté"
            value={models.includes(form.model) ? form.model : ''}
            onChange={(e) => {
              if (e.target.value) set('model', e.target.value)
            }}
          >
            <option value="">— choisir un modèle détecté —</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
      </div>

      <h3 className="section-title">Génération</h3>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="set-temp">Température</label>
          <input id="set-temp" type="number" step="0.1" min="0" max="2" value={form.temperature} onChange={(e) => set('temperature', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="set-max">Tokens max (réponse)</label>
          <input id="set-max" type="number" step="1" min="1" value={form.maxTokens} onChange={(e) => set('maxTokens', e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="set-hist">Messages d'historique max envoyés</label>
        <input id="set-hist" type="number" step="1" min="0" value={form.maxHistoryMessages} onChange={(e) => set('maxHistoryMessages', e.target.value)} />
      </div>

      <h3 className="section-title">Mémoire &amp; outils</h3>
      <Toggle
        label="Mémoire"
        sub="Injecte le bloc mémoire dans le contexte et expose les outils mémoire."
        checked={form.memoryEnabled}
        onChange={(v) => set('memoryEnabled', v)}
      />
      <Toggle
        label="Outils fichiers"
        sub="Le modèle peut lire/écrire dans le dossier sandbox."
        checked={form.fileToolsEnabled}
        onChange={(v) => set('fileToolsEnabled', v)}
      />
      <Toggle
        label="Autoriser la suppression de fichiers"
        sub="Danger : le modèle pourra supprimer des fichiers dans le dossier sandbox."
        checked={form.allowDelete}
        onChange={(v) => set('allowDelete', v)}
        danger
      />
      <div className="field">
        <label htmlFor="set-root">Dossier sandbox des outils</label>
        <input id="set-root" type="text" value={form.toolsRoot} onChange={(e) => set('toolsRoot', e.target.value)} />
      </div>

      <h3 className="section-title">Accès</h3>
      <div className="field">
        <label htmlFor="set-pw">Mot de passe d'accès</label>
        <input
          id="set-pw"
          type="password"
          value={form.password}
          placeholder="(vide = pas d'authentification)"
          autoComplete="new-password"
          onChange={(e) => set('password', e.target.value)}
        />
        <span className="hint">Utile si Hanami est exposé sur le réseau. Vide = accès libre en local.</span>
      </div>
    </Dialog>
  )
}
