// Écran de connexion (affiché quand le serveur répond 401).
import { useState } from 'react'
import * as api from '../api'
import { useI18n } from '../i18n'

export default function LoginGate({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!password || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.login(password)
      onDone()
    } catch (e) {
      setError(api.errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-gate">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault()
          submit().catch((err) => console.error('[login]', err))
        }}
      >
        <h1>
          Hanami <span>&#10047;</span>
        </h1>
        <p className="hint">{t('loginHint')}</p>
        <input
          type="password"
          value={password}
          placeholder={t('password')}
          autoFocus
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="msg-err">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy || !password}>
          {busy ? t('loggingIn') : t('login')}
        </button>
      </form>
    </div>
  )
}
