// Sonde du serveur TTS + pastilles de voix — PARTAGÉ par les Réglages (où l'on
// règle le serveur et la voix par défaut) et le dialog Personnages (où chaque
// personnage prend la sienne). L'identifiant exact d'une voix (du genre
// « clone:Sakurav1 », préfixe compris) est introuvable à la main : on demande au
// serveur ce qu'il propose, et une pastille le recopie dans le champ.
import { useState, type ReactNode } from 'react'
import * as api from '../api'
import { useI18n } from '../i18n'

interface Props {
  /**
   * URL du serveur à sonder. '' = celle des réglages ENREGISTRÉS (le serveur
   * retombe dessus) — c'est le cas du dialog Personnages, qui ne règle pas le
   * serveur mais choisit une voix dessus.
   */
  url: string
  /** Voix retenue (identifiant exact) — sert à marquer la pastille active. */
  value: string
  onPick: (voiceId: string) => void
  /**
   * Nom de modèle annoncé par le serveur, quand l'appelant a un champ à remplir
   * avec (les Réglages). Absent = l'information est ignorée.
   */
  onModel?: (model: string) => void
  /** Ce qui précède le bouton sur sa ligne (le champ URL des Réglages, le champ voix ailleurs). */
  children?: ReactNode
  /** Sonde impossible (URL vide côté Réglages, par exemple). */
  disabled?: boolean
}

export default function VoicePicker({ url, value, onPick, onModel, children, disabled }: Props) {
  const { t } = useI18n()
  const [probe, setProbe] = useState<{ ok: boolean; text: string; voices: api.TtsVoice[] } | null>(null)
  const [probing, setProbing] = useState(false)

  async function run() {
    setProbing(true)
    setProbe(null)
    try {
      const r = await api.probeTts(url.trim())
      const voices = r.voices ?? []
      const parts: string[] = []
      if (r.info) parts.push(r.info)
      if (r.reachable && voices.length === 0) parts.push(t('ttsProbeNoVoices'))
      setProbe({
        ok: r.reachable,
        text: parts.join(' — ') || t(r.reachable ? 'ttsProbeOk' : 'ttsProbeFail'),
        voices,
      })
      if (r.model) onModel?.(r.model)
    } catch (e) {
      setProbe({ ok: false, text: api.errorMessage(e), voices: [] })
    } finally {
      setProbing(false)
    }
  }

  return (
    <>
      <div className="row">
        {children}
        <button
          className="btn small"
          type="button"
          disabled={probing || disabled}
          onClick={() => run().catch((e) => console.error('[tts]', e))}
        >
          {probing ? t('probing') : t('probe')}
        </button>
      </div>
      {probe && (
        <span className={`probe-line${probe.ok ? '' : ' err'}`}>
          <span className="probe-mark">{probe.ok ? '✓' : '✗'}</span>
          <span>{probe.text}</span>
        </span>
      )}
      {probe && probe.voices.length > 0 && (
        <div className="voice-chips" role="group" aria-label={t('ttsProbeVoices')}>
          {probe.voices.map((v) => (
            <button
              key={v.id}
              type="button"
              className="voice-chip"
              aria-pressed={value.trim() === v.id}
              title={v.id}
              onClick={() => onPick(v.id)}
            >
              {v.name}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
