#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// juge.mjs — LE JUGE BIOMÉCANIQUE. Est-ce que ça ressemble à un être humain ?
//
//   node juge.mjs world-walk                 fiche de diagnostic d'un clip
//   node juge.mjs world-walk --frises        + les frises du déroulé
//   node juge.mjs --lot                      les 32 clips, tableau récapitulatif
//   node juge.mjs --lot --tout               idem, avec toutes les phrases
//   node juge.mjs --comparer a b             le même critère sur deux clips
//   node juge.mjs world-walk --vrm=Cynthia   sur un autre modèle
//   node juge.mjs world-walk --tousvrm       sur les 12 modèles (défaut du clip
//                                            ou du rig ? c'est la question)
//   node juge.mjs --lot --json=x.json        sortie machine
//
// Les mesures de raccord existantes disent si un clip S'EMBOÎTE. Celui-ci dit
// s'il est PLAUSIBLE : appuis au sol, symétrie du pas, opposition bras-jambes,
// descente du bassin, torsion du tronc, mains ouvertes… avec, pour chaque défaut,
// une phrase en français dite comme un humain la dirait devant l'écran.
//
// Lecture seule sur le dépôt. N'écrit que si --json est donné, et seulement
// dans devtools/diagnostic-out/ (gitignoré).
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs'
import path from 'node:path'
import * as R from './rig.mjs'
import * as A from './anatomie.mjs'
import * as C from './criteres.mjs'
import * as T from './trace.mjs'

// path.resolve : sous Windows, import.meta.url rend des « / » là où path.resolve
// rend des « \ » — sans normaliser les deux, le garde-fou d'écriture ci-dessous
// refusait d'écrire dans le dossier de l'outil lui-même.
const ICI = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.slice(1))))

// ── Arguments ───────────────────────────────────────────────────────────────
const args = new Map()
const libres = []
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  if (m) args.set(m[1], m[2] ?? '1')
  else libres.push(a)
}

const SYM = C.VERDICTS
const pad = (s, n) => String(s).padEnd(n)
const padL = (s, n) => String(s).padStart(n)

const W = R.world()
// Les socles face à face sont tous des boucles, variantes numérotées comprises
// (idle-7, idle-talking-5…) ; le domaine monde porte l'information dans world.json.
const estBoucle = (slug) => W.clips?.[slug]?.boucle ?? /^idle(-talking)?(-\d+)?$/.test(slug)

async function analyser(rig, slug) {
  const info = await R.chargerClip(rig, slug)
  return A.analyser(rig, info, { boucle: estBoucle(slug) })
}

// ════════════════════════════════════════════════════════════════════════════
// FICHE DE DIAGNOSTIC
// ════════════════════════════════════════════════════════════════════════════

function imprimerFiche(f, { frises = false } = {}) {
  console.log('')
  console.log(`━━ ${f.slug}  ·  ${f.famille}  ·  ${f.duree.toFixed(2)} s${f.boucle ? ' (boucle)' : ''}`)
  console.log(`   modèle ${f.rig.nom} — hanches ${f.rig.hanchesM.toFixed(3)} m, échelle ${f.rig.echelle.toFixed(3)} (les cm sont rapportés à un adulte de 0,93 m de hanche)`)
  console.log('')
  const groupes = [...new Set(f.criteres.map((c) => c.groupe))]
  const lg = Math.max(...f.criteres.map((c) => c.libelle.length))
  const lm = Math.max(...f.criteres.map((c) => String(c.texte).length))
  for (const g of groupes) {
    console.log(`   ┌─ ${g}`)
    for (const c of f.criteres.filter((x) => x.groupe === g)) {
      const v = SYM[c.verdict] ?? SYM.indecidable
      console.log(`   │ ${v.sym} ${pad(c.libelle, lg)}  ${pad(c.texte, lm)}   attendu ${c.attendu}`)
    }
  }
  console.log('')
  console.log(`   VERDICT : ${SYM[f.verdict].sym} ${SYM[f.verdict].texte.toUpperCase()}  ` +
    `(${f.criteres.filter((c) => c.verdict === 'bon').length} bons · ` +
    `${f.criteres.filter((c) => c.verdict === 'limite').length} limites · ` +
    `${f.criteres.filter((c) => c.verdict === 'defaut').length} défauts)`)
  if (f.diagnostics.length) {
    console.log('')
    console.log('   Ce qu\'on verrait à l\'écran :')
    for (const d of f.diagnostics) console.log(`     ${d.verdict === 'defaut' ? '✗' : '~'} ${d.phrase}`)
  } else {
    console.log('')
    console.log('   Rien à signaler : tous les critères applicables sont dans les clous.')
  }
  if (frises) {
    console.log('')
    console.log('   Déroulé :')
    for (const l of T.friseClip(f.contexte)) console.log(l)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MODE LOT
// ════════════════════════════════════════════════════════════════════════════

async function lot(rig, slugs, { tout = false } = {}) {
  const fiches = []
  for (const slug of slugs) {
    try {
      fiches.push(C.juger(await analyser(rig, slug)))
    } catch (e) {
      console.error(`   ${slug} : ${e.message}`)
    }
  }
  const lS = Math.max(8, ...fiches.map((f) => f.slug.length))
  const lF = Math.max(8, ...fiches.map((f) => f.famille.length))
  console.log('')
  console.log(`   ${pad('clip', lS)} ${pad('famille', lF)} ${padL('durée', 6)} ${padL('crit.', 6)} ${padL('bons', 5)} ${padL('lim.', 5)} ${padL('déf.', 5)}  verdict   premier défaut`)
  console.log('   ' + '─'.repeat(lS + lF + 44 + 60))
  const ordre = { defaut: 0, limite: 1, bon: 2, indecidable: 3, sansObjet: 4 }
  for (const f of [...fiches].sort((a, b) => (ordre[a.verdict] - ordre[b.verdict]) || a.slug.localeCompare(b.slug))) {
    const app = f.criteres.filter((c) => c.verdict !== 'sansObjet')
    const d = f.diagnostics.find((x) => x.verdict === 'defaut') ?? f.diagnostics[0]
    const court = d ? d.phrase.replace(/\s+/g, ' ').slice(0, 58) + (d.phrase.length > 58 ? '…' : '') : '—'
    console.log(
      `   ${pad(f.slug, lS)} ${pad(f.famille, lF)} ${padL(f.duree.toFixed(2), 6)} ${padL(app.length, 6)} ` +
      `${padL(app.filter((c) => c.verdict === 'bon').length, 5)} ${padL(app.filter((c) => c.verdict === 'limite').length, 5)} ` +
      `${padL(app.filter((c) => c.verdict === 'defaut').length, 5)}  ${SYM[f.verdict].sym} ${pad(SYM[f.verdict].texte, 7)} ${court}`,
    )
  }
  const parV = {}
  for (const f of fiches) parV[f.verdict] = (parV[f.verdict] ?? 0) + 1
  console.log('   ' + '─'.repeat(lS + lF + 44 + 60))
  console.log(`   ${fiches.length} clips : ` + Object.entries(parV).map(([k, v]) => `${SYM[k].texte} ${v}`).join(' · '))

  // Les défauts, regroupés par critère : ce qui revient est un problème de
  // méthode, pas un accident de clip.
  const parCritere = new Map()
  for (const f of fiches) {
    for (const c of f.criteres) {
      if (c.verdict !== 'defaut' && c.verdict !== 'limite') continue
      if (!parCritere.has(c.id)) parCritere.set(c.id, { libelle: c.libelle, clips: [] })
      parCritere.get(c.id).clips.push({ slug: f.slug, verdict: c.verdict, texte: c.texte, phrase: c.diagnostic })
    }
  }
  console.log('')
  console.log('   ── Ce qui revient, critère par critère ──')
  for (const [id, v] of [...parCritere].sort((a, b) => b[1].clips.length - a[1].clips.length)) {
    const nd = v.clips.filter((c) => c.verdict === 'defaut').length
    console.log(`   ${v.libelle} — ${v.clips.length} clip(s), dont ${nd} en défaut`)
    for (const c of v.clips) console.log(`      ${c.verdict === 'defaut' ? '✗' : '~'} ${pad(c.slug, lS)} ${c.texte}`)
  }
  if (tout) {
    for (const f of fiches) {
      if (!f.diagnostics.length) continue
      console.log('')
      console.log(`   ${f.slug} :`)
      for (const d of f.diagnostics) console.log(`     ${d.verdict === 'defaut' ? '✗' : '~'} ${d.phrase}`)
    }
  }
  return fiches
}

// ════════════════════════════════════════════════════════════════════════════
// COMPARAISON DE DEUX CLIPS — le même critère, avant et après une retouche
// ════════════════════════════════════════════════════════════════════════════

function comparer(a, b) {
  console.log('')
  console.log(`━━ ${a.slug}  vs  ${b.slug}`)
  console.log(`   familles : ${a.famille} / ${b.famille}${a.famille !== b.famille ? '  ⚠ familles différentes : les critères ne se recouvrent qu\'en partie' : ''}`)
  console.log('')
  const ids = [...new Set([...a.criteres.map((c) => c.id), ...b.criteres.map((c) => c.id)])]
  const ma = new Map(a.criteres.map((c) => [c.id, c]))
  const mb = new Map(b.criteres.map((c) => [c.id, c]))
  const lg = Math.max(...ids.map((i) => (ma.get(i) ?? mb.get(i)).libelle.length))
  const col = Math.max(20, ...ids.map((i) => Math.max(String(ma.get(i)?.texte ?? '').length, String(mb.get(i)?.texte ?? '').length)))
  console.log(`   ${pad('critère', lg)}  ${pad(a.slug, col + 2)} ${pad(b.slug, col + 2)}  évolution`)
  console.log('   ' + '─'.repeat(lg + 2 * col + 26))
  for (const id of ids) {
    const x = ma.get(id), y = mb.get(id)
    const lib = (x ?? y).libelle
    const sx = x ? `${SYM[x.verdict].sym} ${x.texte}` : '—'
    const sy = y ? `${SYM[y.verdict].sym} ${y.texte}` : '—'
    let evo = ''
    if (x && y) {
      const dr = (SYM[y.verdict].rang) - (SYM[x.verdict].rang)
      evo = dr < 0 ? '↑ mieux' : dr > 0 ? '↓ moins bien' : (isFinite(x.valeur) && isFinite(y.valeur) && Math.abs(y.valeur - x.valeur) > 1e-9 ? '= (valeur différente)' : '=')
    } else evo = x ? '(absent à droite)' : '(absent à gauche)'
    console.log(`   ${pad(lib, lg)}  ${pad(sx, col + 2)} ${pad(sy, col + 2)}  ${evo}`)
  }
  console.log('   ' + '─'.repeat(lg + 2 * col + 26))
  console.log(`   ${pad('VERDICT', lg)}  ${pad(SYM[a.verdict].sym + ' ' + SYM[a.verdict].texte, col + 2)} ${pad(SYM[b.verdict].sym + ' ' + SYM[b.verdict].texte, col + 2)}`)
}

// ════════════════════════════════════════════════════════════════════════════

const slugs = libres.length ? libres : R.listerClips()
const sortie = { meta: {}, fiches: [] }

if (args.has('tousvrm')) {
  // Le même clip sur tous les modèles : ce qui varie vient du RIG, ce qui reste
  // vient du CLIP. C'est la seule façon honnête de trancher.
  const slug = libres[0]
  if (!slug) throw new Error('--tousvrm demande un nom de clip')
  console.log(`━━ ${slug} sur les ${R.listerVrm().length} modèles du projet`)
  console.log('')
  const lignes = []
  for (const f of R.listerVrm()) {
    let rig
    try { rig = R.chargerRig(f) } catch (e) { console.log(`   ${path.basename(f)} : ${e.message}`); continue }
    const fiche = C.juger(await analyser(rig, slug))
    lignes.push({ rig, fiche })
  }
  const ids = [...new Set(lignes.flatMap((l) => l.fiche.criteres.map((c) => c.id)))]
  const lm = Math.max(...lignes.map((l) => l.rig.nom.length))
  console.log(`   ${pad('modèle', lm)} ${padL('hanches', 8)} ${padL('éch.', 6)}  verdict   défauts`)
  for (const l of lignes) {
    const d = l.fiche.criteres.filter((c) => c.verdict === 'defaut').map((c) => c.id)
    console.log(`   ${pad(l.rig.nom, lm)} ${padL(l.rig.hanchesM.toFixed(3), 8)} ${padL(l.rig.echelle.toFixed(3), 6)}  ${SYM[l.fiche.verdict].sym} ${pad(SYM[l.fiche.verdict].texte, 7)} ${d.join(', ') || '—'}`)
  }
  console.log('')
  console.log('   ── Stabilité de chaque critère à travers les modèles ──')
  for (const id of ids) {
    const vals = lignes.map((l) => l.fiche.criteres.find((c) => c.id === id)).filter(Boolean)
    const nums = vals.map((c) => c.valeur).filter(isFinite)
    if (!nums.length) continue
    const mn = Math.min(...nums), mx = Math.max(...nums)
    const etendue = Math.abs(mx - mn)
    const base = Math.max(1e-6, Math.abs(A.moyenne(nums)))
    const stable = etendue / base < 0.15
    const verdicts = [...new Set(vals.map((c) => c.verdict))]
    console.log(`   ${stable ? '·' : '≠'} ${pad(vals[0].libelle, 52)} ${padL(mn.toFixed(2), 9)} … ${padL(mx.toFixed(2), 9)}  ${verdicts.length > 1 ? 'verdict VARIABLE selon le modèle : ' + verdicts.join('/') : 'verdict stable : ' + verdicts[0]}`)
  }
} else if (args.has('comparer')) {
  const rig = R.chargerRig(R.choisirVrm(args.get('vrm') === '1' ? null : args.get('vrm')))
  const [x, y] = libres
  if (!x || !y) throw new Error('--comparer demande deux noms de clips')
  comparer(C.juger(await analyser(rig, x)), C.juger(await analyser(rig, y)))
} else if (args.has('lot')) {
  const rig = R.chargerRig(R.choisirVrm(args.get('vrm') === '1' ? null : args.get('vrm')))
  console.log(`juge biomécanique — ${slugs.length} clips sur ${rig.nom} (hanches ${rig.hanchesM.toFixed(3)} m, échelle ${rig.echelle.toFixed(3)})`)
  if (!rig.solSuppose) console.log(`   ⚠ ce modèle ne pose pas ses pieds sur y = 0 : le sol a été pris au point le plus bas du rig au repos.`)
  const fiches = await lot(rig, slugs, { tout: args.has('tout') })
  sortie.fiches = fiches.map(dep)
  sortie.meta = { rig: rig.nom, hanchesM: rig.hanchesM, echelle: rig.echelle, genere: new Date().toISOString() }
} else {
  const rig = R.chargerRig(R.choisirVrm(args.get('vrm') === '1' ? null : args.get('vrm')))
  if (!rig.solSuppose) console.log(`⚠ ${rig.nom} ne pose pas ses pieds sur y = 0 : sol pris au point le plus bas du rig au repos.`)
  for (const slug of slugs) {
    const f = C.juger(await analyser(rig, slug))
    imprimerFiche(f, { frises: args.has('frises') })
    sortie.fiches.push(dep(f))
  }
  sortie.meta = { rig: rig.nom, hanchesM: rig.hanchesM, echelle: rig.echelle, genere: new Date().toISOString() }
}

/** Version sérialisable d'une fiche (sans la trace, qui pèse des mégaoctets). */
function dep(f) {
  return {
    slug: f.slug, famille: f.famille, duree: f.duree, boucle: f.boucle, verdict: f.verdict,
    criteres: f.criteres.map((c) => ({ id: c.id, groupe: c.groupe, libelle: c.libelle, mesure: c.texte, valeur: isFinite(c.valeur) ? +c.valeur.toFixed(4) : null, attendu: c.attendu, verdict: c.verdict, diagnostic: c.diagnostic ?? null })),
    diagnostics: f.diagnostics,
  }
}

if (args.has('json')) {
  // Sorties régénérables : devtools/diagnostic-out/, gitignoré.
  const SORTIE = path.resolve(ICI, '..', '..', 'diagnostic-out')
  fs.mkdirSync(SORTIE, { recursive: true })
  const dest = path.resolve(SORTIE, args.get('json') === '1' ? 'juge-resultats.json' : args.get('json'))
  if (!dest.startsWith(SORTIE)) throw new Error('le juge n\'écrit que dans devtools/diagnostic-out/')
  fs.writeFileSync(dest, JSON.stringify(sortie, null, 1))
  console.log(`\nécrit : ${dest}`)
}
