// Barre compacte : nom du personnage actif + boutons icônes vers les dialogs.

export type DialogKind = 'chats' | 'characters' | 'memory' | 'import' | 'inspector' | 'settings'

interface Props {
  characterName: string
  chatTitle: string
  hasCharacter: boolean
  hasChat: boolean
  onOpen: (d: DialogKind) => void
}

function Icon({ d, extra }: { d: string; extra?: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
      {extra}
    </svg>
  )
}

export default function TopBar({ characterName, chatTitle, hasCharacter, hasChat, onOpen }: Props) {
  const buttons: { kind: DialogKind; title: string; disabled: boolean; icon: React.ReactNode }[] = [
    {
      kind: 'chats',
      title: 'Conversations',
      disabled: !hasCharacter,
      icon: <Icon d="M4.5 5h15v11h-11l-4 3.5z" />,
    },
    {
      kind: 'characters',
      title: 'Personnages',
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
      title: 'Mémoire',
      disabled: !hasCharacter,
      icon: <Icon d="M5 19.5V6a2 2 0 012-2h12v14H7a1.8 1.8 0 000 3.6h12M8 8h7M8 11.5h5" />,
    },
    {
      kind: 'import',
      title: 'Importer (SillyTavern)',
      disabled: false,
      icon: <Icon d="M12 3.5V13m0 0l-3.8-3.8M12 13l3.8-3.8M4.5 16.5v2a2 2 0 002 2h11a2 2 0 002-2v-2" />,
    },
    {
      kind: 'inspector',
      title: 'Inspecteur de prompt',
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
      title: 'Réglages',
      disabled: false,
      icon: (
        <Icon
          d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"
          extra={<circle cx="12" cy="12" r="3.2" />}
        />
      ),
    },
  ]

  return (
    <header className="topbar">
      <div className="topbar-id">
        <div className="topbar-name">{characterName}</div>
        {chatTitle && <div className="topbar-sub">{chatTitle}</div>}
      </div>
      <nav aria-label="Menus">
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
    </header>
  )
}
