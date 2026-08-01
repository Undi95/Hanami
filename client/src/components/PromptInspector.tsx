// Inspecteur de prompt : montre EXACTEMENT ce que Hanami envoie au backend.
// Héberge aussi la compaction manuelle (façon /compact, instruction optionnelle)
// et l'édition du résumé — le fil de messages, lui, reste toujours intégral.
// L'onglet « Prompt système » ÉDITE le prompt du personnage : c'est ici qu'on
// vient le lire, c'est donc ici qu'on doit pouvoir le corriger (avant, la seule
// porte était Personnages → Modifier, et ce bloc en lecture seule ressemblait
// à s'y méprendre aux deux onglets voisins, eux éditables).
import { useEffect, useState } from 'react'
import * as api from '../api'
import { useI18n } from '../i18n'
import Dialog from './Dialog'

/** Onglets de l'inspecteur — 'summary' n'existe que si la conversation est compactée. */
type InspectorTab = 'system' | 'payload' | 'summary' | 'scene'

interface Props {
  characterId: string
  chatId: string
  /** Onglet ouvert d'emblée (la liste des conversations amène directement aux notes de scène). */
  initialTab?: InspectorTab
  summary: string // résumé de compaction courant ('' = pas encore compacté)
  sceneNotes: string // notes de scène de la conversation ('' = aucun bloc injecté)
  compacting: boolean
  streaming: boolean // stream de chat en cours : compacter maintenant serait résumer une question sans sa réponse
  onCompact: (instruction: string) => Promise<void>
  onSaveSummary: (text: string) => Promise<void>
  onSaveSceneNotes: (text: string) => Promise<void>
  onClose: () => void
}

export default function PromptInspector({
  characterId,
  chatId,
  initialTab,
  summary,
  sceneNotes,
  compacting,
  streaming,
  onCompact,
  onSaveSummary,
  onSaveSceneNotes,
  onClose,
}: Props) {
  const { t } = useI18n()
  const [data, setData] = useState<{
    systemText: string
    characterPrompt: string
    injected: string
    payload: object
    tokens: number
    contextSize: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<InspectorTab>(initialTab ?? 'system')
  const [copied, setCopied] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [compactError, setCompactError] = useState<string | null>(null)
  const [summaryDraft, setSummaryDraft] = useState(summary)
  const [draftDirty, setDraftDirty] = useState(false)
  const [savingSummary, setSavingSummary] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [sceneDraft, setSceneDraft] = useState(sceneNotes)
  const [sceneDirty, setSceneDirty] = useState(false)
  const [savingScene, setSavingScene] = useState(false)
  const [sceneError, setSceneError] = useState<string | null>(null)
  // Prompt du personnage : même mécanique de brouillon que le résumé et la scène.
  const [promptDraft, setPromptDraft] = useState('')
  const [promptDirty, setPromptDirty] = useState(false)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [promptError, setPromptError] = useState<string | null>(null)

  // Rechargé quand une compaction aboutit (le résumé change → payload différent),
  // et quand les notes de scène changent (leur bloc vit dans le prompt système).
  useEffect(() => {
    setData(null)
    api
      .getPromptPreview(characterId, chatId)
      .then(setData)
      .catch((e) => setError(api.errorMessage(e)))
  }, [characterId, chatId, summary, sceneNotes])

  // Le brouillon suit le résumé TANT QUE l'utilisateur n'y a pas touché
  // (une auto-compaction en arrière-plan ne doit pas écraser une édition en cours).
  useEffect(() => {
    if (!draftDirty) setSummaryDraft(summary)
  }, [summary, draftDirty])

  // Même règle pour les notes de scène (changées depuis un autre appareil, par ex.).
  useEffect(() => {
    if (!sceneDirty) setSceneDraft(sceneNotes)
  }, [sceneNotes, sceneDirty])

  // Et pour le prompt du personnage : le brouillon suit l'aperçu tant qu'on n'y
  // a pas touché (rechargement, changement de personnage, édition faite ailleurs).
  useEffect(() => {
    if (data && !promptDirty) setPromptDraft(data.characterPrompt)
  }, [data, promptDirty])

  // Résumé vidé (compaction annulée) : l'onglet Résumé disparaît — ne pas
  // rester sur un onglet fantôme.
  useEffect(() => {
    if (tab === 'summary' && !summary) setTab('system')
  }, [tab, summary])

  // Copier rend ce qui est À L'ÉCRAN : dans l'onglet système, le brouillon en
  // cours suivi des blocs ajoutés — pas la version enregistrée d'il y a dix secondes.
  const current =
    data === null ? '' : tab === 'system' ? promptDraft + data.injected : JSON.stringify(data.payload, null, 2)

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

  /**
   * Écrit le prompt du personnage (même route que Personnages → Modifier) puis
   * recharge l'aperçu : le texte assemblé et la jauge de tokens suivent, et le
   * PROCHAIN message part avec le nouveau prompt (buildPayload relit le
   * personnage à chaque envoi — rien n'est figé dans la conversation).
   */
  async function savePrompt() {
    setSavingPrompt(true)
    setPromptError(null)
    try {
      await api.updateCharacter(characterId, { systemPrompt: promptDraft })
      setPromptDirty(false)
      setData(await api.getPromptPreview(characterId, chatId))
    } catch (e) {
      setPromptError(api.errorMessage(e))
    } finally {
      setSavingPrompt(false)
    }
  }

  async function saveScene() {
    setSavingScene(true)
    setSceneError(null)
    try {
      await onSaveSceneNotes(sceneDraft)
      setSceneDirty(false)
    } catch (e) {
      setSceneError(api.errorMessage(e))
    } finally {
      setSavingScene(false)
    }
  }

  function doCompact() {
    setCompactError(null)
    onCompact(instruction.trim()).catch((e) => setCompactError(api.errorMessage(e)))
  }

  const summaryDirty = draftDirty && summaryDraft !== summary
  const sceneNotesDirty = sceneDirty && sceneDraft !== sceneNotes
  const promptNotesDirty = promptDirty && data !== null && promptDraft !== data.characterPrompt

  return (
    <Dialog
      title={t('promptInspectorTitle')}
      onClose={onClose}
      wide
      guardClose={() =>
        (!summaryDirty && !sceneNotesDirty && !promptNotesDirty) || window.confirm(t('unsavedConfirm'))
      }
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
              // Affiché court, annoncé long : le champ ne garde que 92 px utiles
              // à 320 px de large (il partage sa .row avec « Compacter
              // maintenant »), le libellé complet en demande 421,7 — voir i18n.
              placeholder={t('compactInstructionPlaceholder')}
              aria-label={t('compactInstruction')}
              title={t('compactInstruction')}
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
            {/* Toujours présent : c'est le SEUL endroit où l'on écrit les notes de scène. */}
            <button className={`tab${tab === 'scene' ? ' active' : ''}`} role="tab" aria-selected={tab === 'scene'} onClick={() => setTab('scene')}>
              {t('sceneTab')}
            </button>
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
          ) : tab === 'scene' ? (
            <>
              <p className="hint">{t('sceneHint')}</p>
              <textarea
                value={sceneDraft}
                rows={8}
                placeholder={t('scenePlaceholder')}
                style={{ width: '100%' }}
                onChange={(e) => {
                  setSceneDirty(true)
                  setSceneDraft(e.target.value)
                }}
              />
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                {sceneError && <span className="msg-err">{sceneError}</span>}
                <button
                  className="btn small primary"
                  disabled={savingScene || sceneDraft === sceneNotes}
                  onClick={() => saveScene().catch((e) => console.error('[scene]', e))}
                >
                  {savingScene ? t('saving') : t('save')}
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
              {tab === 'system' ? (
                <>
                  {/* Le prompt du personnage : ÉDITABLE ici, là où on vient le lire. */}
                  <p className="hint" style={{ marginTop: 0 }}>
                    {t('characterPromptHint')}
                  </p>
                  <textarea
                    className="prompt-edit"
                    value={promptDraft}
                    rows={14}
                    aria-label={t('systemPromptTab')}
                    spellCheck={false}
                    style={{ width: '100%' }}
                    onChange={(e) => {
                      setPromptDirty(true)
                      setPromptDraft(e.target.value)
                    }}
                  />
                  <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                    {promptError && <span className="msg-err">{promptError}</span>}
                    <button
                      className="btn small primary"
                      disabled={savingPrompt || promptDraft === data.characterPrompt}
                      onClick={() => savePrompt().catch((e) => console.error('[prompt]', e))}
                    >
                      {savingPrompt ? t('saving') : t('save')}
                    </button>
                  </div>
                  {/* Ce que Hanami ajoute derrière : montré tel quel, jamais mélangé
                      au champ du dessus — chaque bloc s'édite là où il vit. */}
                  {data.injected !== '' && (
                    <>
                      <p className="hint">{t('injectedHint')}</p>
                      <pre className="code-block">{data.injected}</pre>
                    </>
                  )}
                </>
              ) : (
                <pre className="code-block">{current}</pre>
              )}
            </>
          )}
        </>
      )}
    </Dialog>
  )
}
