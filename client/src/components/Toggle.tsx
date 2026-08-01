// Interrupteur étiqueté — la forme des options de Hanami, partagée par les
// Réglages et le dialog Personnages (il vivait dans SettingsDialog, il en sort
// le jour où un second dialog en a eu besoin).
interface Props {
  label: string
  sub?: string
  checked: boolean
  onChange: (v: boolean) => void
  danger?: boolean
  // Grisé AVEC SA RAISON, jamais caché : un réglage qui disparaît laisse croire
  // qu'il n'existe pas. La raison remplace le sous-titre — c'est elle qui compte
  // à ce moment-là. La préférence, elle, n'est pas touchée.
  disabled?: boolean
  reason?: string
}

export default function Toggle({ label, sub, checked, onChange, danger, disabled, reason }: Props) {
  return (
    <label className={`toggle${danger ? ' danger' : ''}${disabled ? ' disabled' : ''}`}>
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {(disabled && reason ? reason : sub) && (
          <span className="toggle-sub">{disabled && reason ? reason : sub}</span>
        )}
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}
