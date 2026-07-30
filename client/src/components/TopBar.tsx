// Barre compacte : nom du personnage actif + boutons icônes vers les dialogs.
import { useI18n } from '../i18n'

export type DialogKind = 'chats' | 'characters' | 'memory' | 'import' | 'inspector' | 'settings'

interface Props {
  characterName: string
  chatTitle: string
  contextPercent: number | null // jauge de contexte (null = inconnue, rien d'affiché)
  contextTitle: string // tooltip détaillé (~tokens / limite)
  hasCharacter: boolean
  hasChat: boolean
  vnMode: boolean // mode visual novel actif (bascule d'affichage, pas un dialog)
  onToggleVn: () => void
  onOpen: (d: DialogKind) => void
}

/**
 * Jauge de contexte : petit badge accolé au titre de la conversation. Seul le
 * TEXTE se colore, par palier — 85 % est le seuil de l'auto-compaction, donc le
 * moment où l'avertissement doit se voir. Exportée parce que le mode VN masque
 * la TopBar et rejoue la jauge dans la bande basse de sa boîte.
 */
export function CtxBadge({ percent, title }: { percent: number; title: string }) {
  const { t } = useI18n()
  const tone = percent >= 85 ? 'ctx-high' : percent >= 50 ? 'ctx-warn' : 'ctx-ok'
  return (
    <span className={`ctx-badge ${tone}`} title={title}>
      {t('contextBadge', { percent })}
    </span>
  )
}

function Icon({ d, extra }: { d: string; extra?: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
      {extra}
    </svg>
  )
}

export default function TopBar({
  characterName,
  chatTitle,
  contextPercent,
  contextTitle,
  hasCharacter,
  hasChat,
  vnMode,
  onToggleVn,
  onOpen,
}: Props) {
  const { t } = useI18n()
  const buttons: { kind: DialogKind; title: string; disabled: boolean; icon: React.ReactNode }[] = [
    {
      kind: 'chats',
      title: t('chats'),
      disabled: !hasCharacter,
      icon: <Icon d="M4.5 5h15v11h-11l-4 3.5z" />,
    },
    {
      kind: 'characters',
      title: t('characters'),
      disabled: false,
      icon: (
        <Icon
          d="M3.8 19.5c.6-3.2 2.9-5 5.7-5s5.1 1.8 5.7 5"
          extra={
            <>
              <circle cx="9.5" cy="8.2" r="3.3" />
              <path d="M15.9 9.1a2.7 2.7 0 102.3 4.2M16.4 14.9c2.2.4 3.5 1.9 4 4.1" />
            </>
          }
        />
      ),
    },
    {
      kind: 'memory',
      title: t('memory'),
      disabled: !hasCharacter,
      icon: <Icon d="M5 19.5V6a2 2 0 012-2h12v14H7a1.8 1.8 0 000 3.6h12M8 8h7M8 11.5h5" />,
    },
    {
      kind: 'import',
      title: t('importMenu'),
      disabled: false,
      icon: <Icon d="M12 3.5V13m0 0l-3.8-3.8M12 13l3.8-3.8M4.5 16.5v2a2 2 0 002 2h11a2 2 0 002-2v-2" />,
    },
    {
      kind: 'inspector',
      title: t('promptInspectorTitle'),
      disabled: !hasChat,
      icon: (
        <Icon
          d="M2.5 12s3.6-6.2 9.5-6.2S21.5 12 21.5 12s-3.6 6.2-9.5 6.2S2.5 12 2.5 12z"
          extra={<circle cx="12" cy="12" r="2.7" />}
        />
      ),
    },
    {
      kind: 'settings',
      title: t('settings'),
      disabled: false,
      // Roue dentée pleine (l'ancienne version « rayons + cercle » se lisait comme un soleil).
      icon: (
        <Icon
          d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33h.01a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51h.01a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.01a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
          extra={<circle cx="12" cy="12" r="3" />}
        />
      ),
    },
  ]

  return (
    <header className="topbar">
      {/* Ligne 1 : nom + icônes. Ligne 2 : titre du chat suivi de la jauge —
          plus jamais tronqué par la rangée d'icônes. */}
      <div className="topbar-main">
        <div className="topbar-name">{characterName}</div>
        <nav aria-label={t('menus')}>
          {/* Bascule d'affichage (pas un dialog) : boîte de dialogue VN par-dessus la scène. */}
          <button
            className="icon-btn"
            title={t('vnMode')}
            aria-label={t('vnMode')}
            aria-pressed={vnMode}
            onClick={onToggleVn}
          >
            <Icon
              d="M5 5h14a2.5 2.5 0 012.5 2.5v9A2.5 2.5 0 0119 19H5a2.5 2.5 0 01-2.5-2.5v-9A2.5 2.5 0 015 5z"
              extra={<path d="M6.8 13h10.4M6.8 16h6.6" />}
            />
          </button>
          {buttons.map((b) => (
            <button
              key={b.kind}
              className="icon-btn"
              title={b.title}
              aria-label={b.title}
              disabled={b.disabled}
              onClick={() => onOpen(b.kind)}
            >
              {b.icon}
            </button>
          ))}
        </nav>
      </div>
      {chatTitle && (
        <div className="topbar-sub">
          <span className="topbar-title">{chatTitle}</span>
          {contextPercent !== null && <CtxBadge percent={contextPercent} title={contextTitle} />}
        </div>
      )}
    </header>
  )
}
