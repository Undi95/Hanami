// Onglet « Crédits » des Réglages — l'écran qui rend l'attribution des décors
// accessible DEPUIS l'application, comme la CC BY 4.0 l'exige.
//
// Ce composant ne CONNAÎT aucun crédit : il en affiche deux sources et rien
// d'autre.
//  1. Les décors 3D arrivent du serveur, qui les lit dans `asset.extras` de
//     chaque `.glb` livré (server/api/credits.ts). Rien à tenir à jour : un
//     décor déposé dans environments/ apparaît ici tout seul, avec l'attribution
//     que son auteur a envoyée avec lui.
//  2. Le reste — animations, police, briques de code — vient de
//     shared/credits.ts, où il est écrit une seule fois.
//
// Sobre par construction : pas de logo, pas d'animation, pas d'image. Une liste,
// groupée par nature, une licence et un lien par ligne.
import { useEffect, useState, type ReactNode } from 'react'
import {
  ANIMATION_CREDITS,
  APP_LICENSE,
  AVATAR_CREDITS,
  CODE_CREDITS,
  FONT_CREDITS,
  labelOf,
  type CreditEntry,
  type EnvironmentCredit,
} from '../../../shared/credits'
import * as api from '../api'
import { useI18n, type Lang } from '../i18n'

/**
 * Lien sortant, ou simple texte quand l'URL manque. Toutes les cibles s'ouvrent
 * dans un onglet neuf : on ne quitte pas une conversation en cours pour lire une
 * licence. `rel` complet — `noopener` ferme l'accès à `window.opener`.
 */
function Ext({ href, className, children }: { href?: string; className: string; children: ReactNode }) {
  if (!href) return <span className={className}>{children}</span>
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

/**
 * Une ligne de crédit. Trois niveaux, toujours dans le même ordre : l'œuvre (et
 * son lien), qui l'a faite et sous quelle licence, puis ce qu'elle fait ici.
 * C'est le quatuor que la CC BY réclame — titre, auteur, licence, source.
 */
function Credit({
  title,
  url,
  author,
  authorUrl,
  license,
  licenseUrl,
  note,
  warn,
}: {
  title: string
  url?: string
  author?: string
  authorUrl?: string
  license?: string
  licenseUrl?: string
  note?: string
  warn?: string
}) {
  const { t } = useI18n()
  return (
    <li className="credit">
      <Ext href={url} className="credit-title">
        {title}
      </Ext>
      <p className="credit-meta">
        {author && (
          <>
            <span className="credit-by">{t('creditsBy')}</span>
            <Ext href={authorUrl} className="credit-link">
              {author}
            </Ext>
          </>
        )}
        {license && (
          <Ext href={licenseUrl} className="credit-link credit-license">
            {license}
          </Ext>
        )}
      </p>
      {note && <p className="credit-note">{note}</p>}
      {warn && <p className="credit-warn">{warn}</p>}
    </li>
  )
}

/** Entrée écrite dans shared/credits.ts : la note suit la langue de l'app. */
function StaticCredit({ entry, lang }: { entry: CreditEntry; lang: Lang }) {
  return (
    <Credit
      title={entry.title}
      url={entry.url}
      author={labelOf(entry.author, lang)}
      authorUrl={entry.authorUrl}
      license={labelOf(entry.license, lang)}
      licenseUrl={entry.licenseUrl}
      note={entry.note[lang]}
    />
  )
}

export default function CreditsPanel() {
  const { lang, t } = useI18n()
  // Décors : lus côté serveur dans les .glb. `null` = pas encore arrivés.
  const [environments, setEnvironments] = useState<EnvironmentCredit[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .getEnvironmentCredits()
      .then((list) => {
        if (alive) setEnvironments(list)
      })
      .catch((e) => {
        if (alive) setError(api.errorMessage(e))
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="credits-panel">
      <p className="hint">{t('creditsIntro')}</p>

      <h3 className="section-title">{t('creditsEnvironments')}</h3>
      <p className="hint">{t('creditsEnvironmentsNote')}</p>
      {error && <p className="msg-err">{error}</p>}
      {!environments && !error && <p className="hint">{t('loading')}</p>}
      {environments && environments.length === 0 && <p className="hint">{t('creditsEnvironmentsEmpty')}</p>}
      {environments && environments.length > 0 && (
        <ul className="credits">
          {environments.map((env) => (
            <Credit
              key={env.file}
              // Un décor dont le fichier ne porte aucune attribution reste
              // LISTÉ, sous son nom de fichier, avec l'avertissement : le trou
              // se voit au lieu de passer inaperçu.
              title={env.title || env.file}
              url={env.url || undefined}
              author={env.author || undefined}
              authorUrl={env.authorUrl || undefined}
              license={env.license || undefined}
              licenseUrl={env.licenseUrl || undefined}
              note={env.title ? env.file : undefined}
              warn={env.author && env.license ? undefined : t('creditsNoAttribution')}
            />
          ))}
        </ul>
      )}

      <h3 className="section-title">{t('creditsAnimations')}</h3>
      <ul className="credits">
        {ANIMATION_CREDITS.map((entry) => (
          <StaticCredit key={entry.title} entry={entry} lang={lang} />
        ))}
      </ul>

      <h3 className="section-title">{t('creditsAvatar')}</h3>
      <p className="hint">{t('creditsAvatarNote')}</p>
      <ul className="credits">
        {AVATAR_CREDITS.map((entry) => (
          <StaticCredit key={entry.title} entry={entry} lang={lang} />
        ))}
      </ul>

      <h3 className="section-title">{t('creditsFont')}</h3>
      <ul className="credits">
        {FONT_CREDITS.map((entry) => (
          <StaticCredit key={entry.title} entry={entry} lang={lang} />
        ))}
      </ul>

      <h3 className="section-title">{t('creditsCode')}</h3>
      <p className="hint">{t('creditsCodeNote')}</p>
      <ul className="credits">
        {CODE_CREDITS.map((entry) => (
          <StaticCredit key={entry.title} entry={entry} lang={lang} />
        ))}
      </ul>

      <p className="hint credits-docs">{t('creditsDocs')}</p>
      <p className="hint">
        {t('creditsAppLicense')}{' '}
        <Ext href={APP_LICENSE.url} className="credit-link">
          {APP_LICENSE.name}
        </Ext>
      </p>
    </div>
  )
}
