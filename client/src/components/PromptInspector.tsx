// Inspecteur de prompt : montre EXACTEMENT ce que Hanami envoie au backend.
// Héberge aussi la compaction manuelle (façon /compact, instruction optionnelle)
// et l'édition du résumé — le fil de messages, lui, reste toujours intégral.
import { useEffect, useState } from 'react'
import * as api from '../api'
import { useI18n } from '../i18n'
import Dialog from './Dialog'

interface Props {
  characterId: string
  chatId: string
  summary: string // résumé de compaction courant ('' = pas encore compacté)
  compacting: boolean
  streaming: boolean // stream de chat en cours : compacter maintenant serait résumer une question sans sa réponse
  onCompact: (instruction: string) => Promise<void>
  onSaveSummary: (text: string) => Promise<void>
  onClose: () => void
}

export default function PromptInspector({
  characterId,
  chatId,
  summary,
  compacting,
  streaming,
  onCompact,
  onSaveSummary,
  onClose,
}: Props) {
  const { t } = useI18n()
  const [data, setData] = useState<{
    systemText: string
    payload: object
    tokens: number
    contextSize: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'system' | 'payload' | 'summary'>('system')
  const [copied, setCopied] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [compactError, setCompactError] = useState<string | null>(null)
  const [summaryDraft, setSummaryDraft] = useState(summary)
  const [draftDirty, setDraftDirty] = useState(false)
  const [savingSummary, setSavingSummary] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  // Rechargé quand une compaction aboutit (le résumé change → payload différent).
  useEffect(() => {
    setData(null)
    api
      .getPromptPreview(characterId, chatId)
      .then(setData)
      .catch((e) => setError(api.errorMessage(e)))
  }, [characterId, chatId, summary])

  // Le brouillon suit le résumé TANT QUE l'utilisateur n'y a pas touché
  // (une auto-compaction en arrière-plan ne doit pas écraser une édition en cours).
  useEffect(() => {
    if (!draftDirty) setSummaryDraft(summary)
  }, [summary, draftDirty])

  // Résumé vidé (compaction annulée) : l'onglet Résumé disparaît — ne pas
  // rester sur un onglet fantôme.
  useEffect(() => {
    if (tab === 'summary' && !summary) setTab('system')
  }, [tab, summary])

  const current = data === null ? '' : tab === 'system' ? data.systemText : JSON.stringify(data.payload, null, 2)

  function copy() {
    navigator.clipboard
      .writeText(current)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch((e) => console.error('[copy]', e))
  }

  async function saveSummary() {
    setSavingSummary(true)
    setSummaryError(null)
    try {
      await onSaveSummary(summaryDraft)
      setDraftDirty(false)
    } catch (e) {
      setSummaryError(api.errorMessage(e))
    } finally {
      setSavingSummary(false)
    }
  }

  function doCompact() {
    setCompactError(null)
    onCompact(instruction.trim()).catch((e) => setCompactError(api.errorMessage(e)))
  }

  const summaryDirty = draftDirty && summaryDraft !== summary

  return (
    <Dialog
      title={t('promptInspectorTitle')}
      onClose={onClose}
      wide
      guardClose={() => !summaryDirty || window.confirm(t('unsavedConfirm'))}
    >
      <p className="hint" style={{ marginTop: 0 }}>
        {t('promptInspectorNote')}
      </p>
      {error && <p className="msg-err">{error}</p>}
      {data === null && !error && <p className="hint">{t('loading')}</p>}
      {data && (
        <>
          {data.contextSize > 0 && (
            <p className="hint" style={{ marginTop: 0 }}>
              {t('contextUsage', {
                tokens: data.tokens,
                limit: data.contextSize,
                percent: Math.min(100, Math.round((data.tokens / data.contextSize) * 100)),
              })}
            </p>
          )}
          <div className="row" style={{ marginBottom: 10 }}>
            <input
              type="text"
              value={instruction}
              placeholder={t('compactInstructionPlaceholder')}
              style={{ flex: 1, minWidth: 0 }}
              onChange={(e) => setInstruction(e.target.value)}
            />
            <button className="btn small" disabled={compacting || streaming} onClick={doCompact}>
              {compacting ? t('compacting') : t('compactNow')}
            </button>
          </div>
          {compactError && (
            <p className="msg-err" style={{ marginTop: 0 }}>
              {compactError}
            </p>
          )}

          <div className="tabs" role="tablist">
            <button className={`tab${tab === 'system' ? ' active' : ''}`} role="tab" aria-selected={tab === 'system'} onClick={() => setTab('system')}>
              {t('systemPromptTab')}
            </button>
            <button className={`tab${tab === 'payload' ? ' active' : ''}`} role="tab" aria-selected={tab === 'payload'} onClick={() => setTab('payload')}>
              {t('payloadTab')}
            </button>
            {summary && (
              <button className={`tab${tab === 'summary' ? ' active' : ''}`} role="tab" aria-selected={tab === 'summary'} onClick={() => setTab('summary')}>
                {t('viewSummary')}
              </button>
            )}
          </div>

          {tab === 'summary' && summary ? (
            <>
              <p className="hint">{t('summaryHint')}</p>
              <textarea
                value={summaryDraft}
                rows={12}
                style={{ width: '100%' }}
                onChange={(e) => {
                  setDraftDirty(true)
                  setSummaryDraft(e.target.value)
                }}
              />
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                {summaryError && <span className="msg-err">{summaryError}</span>}
                <button
                  className="btn small primary"
                  disabled={savingSummary || compacting || summaryDraft === summary}
                  onClick={() => saveSummary().catch((e) => console.error('[summary]', e))}
                >
                  {savingSummary ? t('saving') : t('save')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
                <button className="btn small" onClick={copy}>
                  {copied ? t('copied') : t('copy')}
                </button>
              </div>
              <pre className="code-block">{current}</pre>
            </>
          )}
        </>
      )}
    </Dialog>
  )
}
