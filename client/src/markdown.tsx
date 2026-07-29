// Mini-rendu Markdown → éléments React, sans dépendance et sans innerHTML
// (aucune surface XSS : tout passe par des éléments React).
// Couverture volontairement « chat » : **gras**, *italique*, ***les deux***,
// ~~barré~~, `code`, blocs ``` et citations « > » (le « répondre à » du
// composer en produit) — le reste (listes, titres…) s'affiche tel quel,
// préservé par le pre-wrap de la bulle.
import type { ReactNode } from 'react'

// Fence non refermée acceptée (streaming : le bloc s'affiche pendant qu'il arrive).
const FENCE_SRC = '```[^\\n`]*\\n?([\\s\\S]*?)(?:```|$)'
const INLINE_SRC = '\\*\\*\\*(.+?)\\*\\*\\*|\\*\\*(.+?)\\*\\*|\\*([^*\\n]+)\\*|~~(.+?)~~|`([^`\\n]+)`'
// Ligne de citation : « > texte » (l'espace après le chevron est optionnel).
const QUOTE_LINE = /^>[ \t]?(.*)$/

interface KeyCounter {
  n: number
}

// Regex instanciées par appel : renderInline est récursif, un lastIndex
// partagé au niveau module serait corrompu entre deux niveaux.
function renderInline(text: string, keys: KeyCounter): ReactNode[] {
  const re = new RegExp(INLINE_SRC, 'g')
  const out: ReactNode[] = []
  let last = 0
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const key = keys.n++
    if (m[1] !== undefined) {
      out.push(
        <strong key={key}>
          <em>{renderInline(m[1], keys)}</em>
        </strong>,
      )
    } else if (m[2] !== undefined) {
      out.push(<strong key={key}>{renderInline(m[2], keys)}</strong>)
    } else if (m[3] !== undefined) {
      out.push(<em key={key}>{renderInline(m[3], keys)}</em>)
    } else if (m[4] !== undefined) {
      out.push(<del key={key}>{renderInline(m[4], keys)}</del>)
    } else {
      out.push(<code key={key}>{m[5]}</code>)
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// Niveau ligne : les suites de « > … » deviennent un blockquote, le reste part
// en rendu inline. Le blockquote étant un bloc, les sauts de ligne qui l'entourent
// sont absorbés (sinon le pre-wrap de la bulle ajouterait des lignes vides).
function renderBlocks(text: string, keys: KeyCounter): ReactNode[] {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let plain: string[] = []
  const flush = () => {
    if (plain.length > 0) out.push(...renderInline(plain.join('\n'), keys))
    plain = []
  }
  for (let i = 0; i < lines.length; i++) {
    const m = QUOTE_LINE.exec(lines[i])
    if (!m) {
      plain.push(lines[i])
      continue
    }
    while (plain.length > 0 && plain[plain.length - 1].trim() === '') plain.pop()
    flush()
    const quoted: string[] = [m[1]]
    while (i + 1 < lines.length) {
      const next = QUOTE_LINE.exec(lines[i + 1])
      if (next === null) break
      quoted.push(next[1])
      i++
    }
    out.push(<blockquote key={keys.n++}>{renderInline(quoted.join('\n'), keys)}</blockquote>)
    while (i + 1 < lines.length && lines[i + 1].trim() === '') i++
  }
  flush()
  return out
}

/** Rend le texte d'une bulle de message (le texte stocké reste intégral). */
export function renderMarkdown(text: string): ReactNode[] {
  const re = new RegExp(FENCE_SRC, 'g')
  const out: ReactNode[] = []
  const keys: KeyCounter = { n: 0 }
  let last = 0
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) out.push(...renderBlocks(text.slice(last, m.index), keys))
    out.push(<pre key={keys.n++}>{m[1].replace(/\n$/, '')}</pre>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(...renderBlocks(text.slice(last), keys))
  return out
}
