// ════════════════════════════════════════════════════════════════════════════
// trace.mjs — VOIR LE MOUVEMENT DANS UN TERMINAL.
//
// Un tableau de chiffres dit qu'un critère échoue ; il ne dit pas À QUEL MOMENT
// ni à quoi ça ressemble. Ces frises rendent le déroulé du clip lisible d'un
// coup d'œil — appuis des pieds, hauteur du bassin, balancement des bras — sans
// navigateur, sans image, dans le flux de sortie que l'outil produit déjà.
//
// C'est le pendant textuel d'un banc vidéo : on y lit la boiterie, l'absence de
// double appui ou le bras en phase aussi sûrement qu'on les verrait à l'écran.
// ════════════════════════════════════════════════════════════════════════════

import * as A from './anatomie.mjs'

const BLOCS = ' ▁▂▃▄▅▆▇█'

/** Courbe en blocs Unicode sur une ligne. */
export function sparkline(sig, largeur = 72) {
  const v = []
  for (let i = 0; i < largeur; i++) {
    const a = Math.floor((i * sig.length) / largeur)
    const b = Math.max(a + 1, Math.floor(((i + 1) * sig.length) / largeur))
    const tr = sig.slice(a, b).filter(isFinite)
    v.push(tr.length ? A.moyenne(tr) : NaN)
  }
  const ok = v.filter(isFinite)
  if (!ok.length) return ' '.repeat(largeur)
  const lo = Math.min(...ok), hi = Math.max(...ok)
  const d = hi - lo
  return v.map((x) => (isFinite(x) ? BLOCS[d < 1e-12 ? 4 : Math.min(8, Math.max(0, Math.round(((x - lo) / d) * 8)))] : ' ')).join('')
}

/** Frise binaire (appui / pas d'appui). */
export function frise(masque, largeur = 72) {
  let s = ''
  for (let i = 0; i < largeur; i++) {
    const a = Math.floor((i * masque.length) / largeur)
    const b = Math.max(a + 1, Math.floor(((i + 1) * masque.length) / largeur))
    const part = masque.slice(a, b).filter(Boolean).length / (b - a)
    s += part > 0.5 ? '█' : part > 0 ? '▌' : '·'
  }
  return s
}

/** Frise à deux camps : signal positif / négatif (avant / arrière). */
export function friseSignee(sig, largeur = 72) {
  let s = ''
  for (let i = 0; i < largeur; i++) {
    const a = Math.floor((i * sig.length) / largeur)
    const b = Math.max(a + 1, Math.floor(((i + 1) * sig.length) / largeur))
    const m = A.moyenne(sig.slice(a, b).filter(isFinite))
    s += !isFinite(m) ? ' ' : m > 0 ? '▀' : m < 0 ? '▄' : '─'
  }
  return s
}

const L = 72

/**
 * Les frises d'un clip. `X` est le contexte de criteres.mjs (déjà calculé :
 * on ne refait aucun parcours du squelette).
 */
export function friseClip(X, { largeur = L } = {}) {
  const tr = X.tr
  const lignes = []
  const ligne = (nom, contenu, suffixe = '') => lignes.push(`   ${nom.padEnd(22)}│${contenu}│ ${suffixe}`)
  const cm = (m) => (m * 100) / X.ech

  const echelleT = `0 s${' '.repeat(Math.max(0, largeur - 8))}${tr.duree.toFixed(2)} s`
  lignes.push(`   ${' '.repeat(22)} ${echelleT}`)
  ligne('appui pied gauche', frise(X.contacts.g, largeur), `${Math.round(X.contacts.fractionG * 100)} %`)
  ligne('appui pied droit', frise(X.contacts.d, largeur), `${Math.round(X.contacts.fractionD * 100)} %`)
  ligne('double appui', frise(X.contacts.double, largeur), `${Math.round(X.contacts.fractionDouble * 100)} %`)
  if (X.contacts.fractionVol > 0) ligne('AUCUN APPUI (vol)', frise(X.contacts.vol, largeur), `${Math.round(X.contacts.fractionVol * 100)} %`)
  const hy = X.hy.filter(isFinite)
  ligne('hauteur du bassin', sparkline(X.hy, largeur), `${cm(Math.min(...hy)).toFixed(1)} → ${cm(Math.max(...hy)).toFixed(1)} cm`)
  ligne('genou gauche', sparkline(X.genou.g, largeur), plage(X.genou.g, '°'))
  ligne('genou droit', sparkline(X.genou.d, largeur), plage(X.genou.d, '°'))
  ligne('main G av./arr.', friseSignee(X.mainAv.g, largeur), `± ${cm(A.amplitude(X.mainAv.g.filter(isFinite)) / 2).toFixed(1)} cm`)
  ligne('jambe D av./arr.', friseSignee(X.genouAv.d, largeur), `± ${cm(A.amplitude(X.genouAv.d.filter(isFinite)) / 2).toFixed(1)} cm`)
  ligne('main D av./arr.', friseSignee(X.mainAv.d, largeur), `± ${cm(A.amplitude(X.mainAv.d.filter(isFinite)) / 2).toFixed(1)} cm`)
  ligne('jambe G av./arr.', friseSignee(X.genouAv.g, largeur), `± ${cm(A.amplitude(X.genouAv.g.filter(isFinite)) / 2).toFixed(1)} cm`)
  ligne('torsion du tronc', sparkline(X.torsion, largeur), plage(X.torsion, '°'))
  const tp = X.tete.pitch.filter(isFinite), ty = X.tete.yaw.filter(isFinite)
  if (A.amplitude(tp) > 3) ligne('tête haut-bas', sparkline(X.tete.pitch, largeur), plage(X.tete.pitch, '°'))
  if (A.amplitude(ty) > 3) ligne('tête gauche-droite', sparkline(X.tete.yaw, largeur), plage(X.tete.yaw, '°'))
  return lignes
}

function plage(sig, u) {
  const v = sig.filter(isFinite)
  if (!v.length) return '—'
  return `${Math.round(Math.min(...v))} → ${Math.round(Math.max(...v))} ${u}`
}
