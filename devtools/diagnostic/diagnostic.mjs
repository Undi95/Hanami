#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// diagnostic.mjs — LE DEVTOOLS UNIFIÉ : fiche biomécanique + images, par clip.
//
// Il assemble les deux outils du dossier :
//   · juge/   — les critères biomécaniques (est-ce PLAUSIBLE ?)
//   · rendu/  — les PNG (est-ce que ça se VOIT ?)
// et range tout dans UN dossier par clip, servi par le banc d'essai :
//
//   devtools/diagnostic-out/<clip>/
//       fiche.md            la fiche lisible (verdict, phrases, critères, frises)
//       fiche.json          la même, pour la page du banc et les scripts
//       planche-face.png    poses au cadrage commun, vue de face
//       planche-profil.png  … de profil (la plus parlante pour marche et assise)
//       planche-dessus.png  … de dessus (torsion, trajectoires au sol)
//       traces.png          trajectoires pieds/mains/bassin/tête + contacts
//       phase.png           appuis G/D, bassin, semelles, à-coups
//   devtools/diagnostic-out/index.json    l'inventaire, lu par la page du banc
//   devtools/diagnostic-out/RAPPORT.md    l'index maître, lisible sans navigateur
//
// diagnostic-out/ est GITIGNORÉ : ce sont des centaines de PNG régénérables.
//
// Appels (cwd libre — tous les chemins sont absolus) :
//   node diagnostic.mjs world-walk idle          un ou plusieurs clips
//   node diagnostic.mjs extra/happy-5            un clip du dossier vrma/extra/
//   node diagnostic.mjs --lot                    tous les clips de la racine vrma/
//   node diagnostic.mjs --lot --extra=idle-talking-4,happy-5,neutral-2,relaxed-3
//   node diagnostic.mjs --lot --extra=tous       + tout vrma/extra/
//   node diagnostic.mjs --rapport                régénère index.json + RAPPORT.md
//                                                depuis les fiche.json existants
// Options :
//   --modele=<nom>      .vrm utilisé PARTOUT (défaut : EtalonChibi, épinglé).
//                       Nom exact d'abord ; une sous-chaîne ambiguë est refusée
//                       avec la liste des candidats. Toute mesure ne se compare
//                       qu'à modèle égal — il est écrit dans chaque fiche.
//   --sans-images       fiches seules (rapide) ; les images existantes restent.
//   --poses=N           cases des planches (défaut 12)
//
// Notes visuelles : devtools/diagnostic/notes-visuelles.json — { "vedettes": [ids…],
// "notes": { id: "ce qu'on voit sur les planches" } }. Ce fichier est écrit À LA
// MAIN après avoir REGARDÉ les images ; --rapport le fond dans RAPPORT.md,
// index.json et la page du banc. C'est la mémoire de l'œil, elle survit aux
// régénérations.
//
// Zéro dépendance npm ajoutée ; lecture seule sur le dépôt (vrm/, vrma/,
// node_modules/) — la seule écriture est devtools/diagnostic-out/.
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as JR from './juge/rig.mjs'
import * as JA from './juge/anatomie.mjs'
import * as JC from './juge/criteres.mjs'
import * as JT from './juge/trace.mjs'
import * as REN from './rendu/rendu.mjs'

const ICI = path.dirname(fileURLToPath(import.meta.url))
// Sorties : devtools/diagnostic-out/ — hors du suivi git, régénérable, et servi
// sous /diagnostic/ par le banc d'essai (devtools/anim-lab/serve.mjs).
export const SORTIE = path.resolve(ICI, '..', 'diagnostic-out')
const FICHIER_NOTES = path.join(ICI, 'notes-visuelles.json')
const VRMA = JR.VRMA_DIR

const SYM = JC.VERDICTS
const W = JR.world()
// Même règle que juge.mjs : le domaine monde porte l'info dans world.json, les
// socles face à face (variantes numérotées comprises) sont des boucles.
const estBoucle = (slug) => W.clips?.[slug]?.boucle ?? /^idle(-talking)?(-\d+)?$/.test(slug)

// ── Identité d'un clip : id « extra/x » ou « x », slug = nom nu ──────────────

function identite(idOuChemin) {
  let id = idOuChemin.replace(/\\/g, '/').replace(/\.vrma$/i, '')
  // un chemin absolu vers vrma/ ou vrma/extra/ est ramené à son id
  const rel = path.relative(VRMA, id + '.vrma').replace(/\\/g, '/')
  if (!rel.startsWith('..') && fs.existsSync(path.join(VRMA, rel))) id = rel.replace(/\.vrma$/i, '')
  const slug = id.split('/').pop()
  return {
    id, slug,
    extra: id.startsWith('extra/'),
    fichier: path.join(VRMA, id + '.vrma'),
    dossier: path.join(SORTIE, ...id.split('/')), // extra/x → diagnostic/extra/x/
    urlDossier: id, // relatif à /diagnostic/ pour la page et le rapport
  }
}

function listerRacine() {
  return fs.readdirSync(VRMA).filter((f) => f.toLowerCase().endsWith('.vrma'))
    .map((f) => f.replace(/\.vrma$/i, '')).sort()
}
function listerExtra() {
  const d = path.join(VRMA, 'extra')
  if (!fs.existsSync(d)) return []
  return fs.readdirSync(d).filter((f) => f.toLowerCase().endsWith('.vrma'))
    .map((f) => 'extra/' + f.replace(/\.vrma$/i, '')).sort()
}

// ── Groupes du rapport : l'ordre de lecture voulu par le propriétaire ────────

const GROUPES = [
  ['socles', 'Socles debout (idle, idle-talking)'],
  ['gestes-face', 'Gestes face à face (émotions, tête, mains)'],
  ['marche', 'Marche, départs, arrêts'],
  ['assise', 'Famille assise (transition + émotes assises)'],
  ['course', 'Course, jog, pas chassés'],
  ['pivots', 'Pivots'],
  ['monde-gestes', 'Monde 3D : repos alternés et gestes tenus'],
  ['extra', 'extra/ — clips écartés, à réexaminer'],
]
function groupeDe(id, famille) {
  if (id.startsWith('extra/')) return 'extra'
  if (famille === 'repos debout' || famille === 'repos debout parlant') return 'socles'
  if (!id.startsWith('world-')) return 'gestes-face'
  if (/^world-(walk)/.test(id)) return 'marche'
  if (/^world-sit-/.test(id)) return 'assise'
  if (/^world-(run|jog|strafe|step)/.test(id)) return 'course'
  if (/^world-turn-/.test(id)) return 'pivots'
  return 'monde-gestes'
}

// ── Le juge, appliqué à un clip (racine ou extra) ────────────────────────────

async function jugerClip(rig, ident) {
  const info = await JR.chargerClip(rig, ident.id)
  info.slug = ident.slug // la famille se déduit du NOM NU, pas du chemin extra/
  const tr = JA.analyser(rig, info, { boucle: estBoucle(ident.slug) })
  return JC.juger(tr)
}

/** Version sérialisable d'une fiche du juge (sans la trace : des mégaoctets). */
function depouiller(f) {
  return {
    slug: f.slug, famille: f.famille, duree: +f.duree.toFixed(4), boucle: f.boucle,
    verdict: f.verdict,
    criteres: f.criteres.map((c) => ({
      id: c.id, groupe: c.groupe, libelle: c.libelle, mesure: String(c.texte),
      valeur: isFinite(c.valeur) ? +(+c.valeur).toFixed(4) : null,
      attendu: c.attendu, verdict: c.verdict, diagnostic: c.diagnostic ?? null,
    })),
    diagnostics: f.diagnostics,
  }
}

// ── La fiche markdown ────────────────────────────────────────────────────────

const sansPipe = (s) => String(s).replace(/\|/g, '¦')
const f1 = (x) => (isFinite(x) ? (+x).toFixed(1) : '—')

function ficheMarkdown(ident, fiche, rig, rendu, images) {
  const app = fiche.criteres.filter((c) => c.verdict !== 'sansObjet')
  const nb = (v) => app.filter((c) => c.verdict === v).length
  const L = []
  L.push(`# ${ident.id} — diagnostic`)
  L.push('')
  L.push(`- famille : **${fiche.famille}** · durée ${fiche.duree.toFixed(2)} s${fiche.boucle ? ' · boucle' : ''}`)
  L.push(`- modèle : ${rig.nom} (hanches ${rig.hanchesM.toFixed(3)} m, échelle ${rig.echelle.toFixed(3)} — les cm sont des cm-adulte, hanche 0,93 m)`)
  L.push(`- VERDICT : **${SYM[fiche.verdict].texte.toUpperCase()}** (${nb('bon')} bons · ${nb('limite')} limites · ${nb('defaut')} défauts)`)
  L.push('')
  L.push('## Ce qu\'on verrait à l\'écran')
  L.push('')
  if (fiche.diagnostics.length) {
    for (const d of fiche.diagnostics) L.push(`- ${d.verdict === 'defaut' ? '✗' : '~'} ${d.phrase}`)
  } else {
    L.push('- rien à signaler : tous les critères applicables sont dans les clous.')
  }
  L.push('')
  L.push('## Images')
  L.push('')
  L.push('| vue | fichier | à quoi elle sert |')
  L.push('|---|---|---|')
  const roles = {
    'planche-profil.png': 'poses au cadrage commun, de profil — LA vue pour marche et assise',
    'planche-face.png': 'de face — symétrie gauche/droite, écartement des pieds',
    'planche-dessus.png': 'de dessus — torsion du tronc, trajectoires au sol',
    'traces.png': 'trajectoires des extrémités + contacts (carrés = pied au sol)',
    'phase.png': 'appuis G/D, hauteur du bassin, semelles (zone rouge = sous le sol), à-coups',
  }
  for (const im of images) L.push(`| ${im.replace(/\.png$/, '')} | ![${im}](${im}) | ${roles[im] ?? ''} |`)
  L.push('')
  if (rendu) {
    L.push('## Chiffres du rendu (sur ce modèle, en cm réels du modèle)')
    L.push('')
    L.push(`- pénétration max de la semelle sous y = 0 : **${f1(-rendu.penetration * 100)} cm** (${rendu.semelleMesuree ? 'semelle mesurée sur le maillage' : 'estimée depuis les os'})`)
    L.push(`- levée de pied max : ${f1(rendu.leveeMax * 100)} cm · bassin ${f1(rendu.bassin.min * 100)} → ${f1(rendu.bassin.max * 100)} cm`)
    L.push(`- vitesse angulaire max : ${Math.round(rendu.omegaMax)} °/s`)
    L.push('')
  }
  L.push('## Critères, un par un')
  L.push('')
  L.push('| | critère | mesuré | attendu |')
  L.push('|---|---|---|---|')
  for (const c of fiche.criteres) {
    L.push(`| ${SYM[c.verdict]?.sym ?? '·'} | ${sansPipe(c.libelle)} | ${sansPipe(c.mesure)} | ${sansPipe(c.attendu)} |`)
  }
  L.push('')
  return L.join('\n')
}

/** Les frises ASCII du déroulé — le film du clip, lisible dans un terminal. */
function blocFrises(contexte) {
  try {
    return ['## Déroulé (frises)', '', '```text', ...JT.friseClip(contexte), '```', ''].join('\n')
  } catch (e) {
    return `## Déroulé (frises)\n\n(frises indisponibles : ${e.message})\n`
  }
}

// ── Traitement d'un clip : fiche + images ────────────────────────────────────

export async function traiterClip(idOuChemin, opts = {}) {
  const ident = identite(idOuChemin)
  if (!fs.existsSync(ident.fichier)) throw new Error(`clip introuvable : ${ident.fichier}`)
  fs.mkdirSync(ident.dossier, { recursive: true })

  const brut = await jugerClip(opts.rig, ident)
  const fiche = depouiller(brut)

  const IMAGES = [
    { nom: 'planche-face.png', type: 'planche', vue: 'face' },
    { nom: 'planche-profil.png', type: 'planche', vue: 'profil' },
    { nom: 'planche-dessus.png', type: 'planche', vue: 'dessus' },
    { nom: 'traces.png', type: 'traces' },
    { nom: 'phase.png', type: 'phase' },
  ]
  let rendu = null
  const images = []
  if (!opts.sansImages) {
    for (const im of IMAGES) {
      const r = await REN.rendre({
        clip: ident.fichier, type: im.type, vue: im.vue,
        modele: opts.modeleFichier, poses: opts.poses,
        sortie: path.join(ident.dossier, im.nom),
      })
      if (im.type === 'traces') rendu = resumerRendu(r.analyse)
      images.push(im.nom)
    }
  } else {
    for (const im of IMAGES) if (fs.existsSync(path.join(ident.dossier, im.nom))) images.push(im.nom)
  }

  const json = {
    id: ident.id, dossier: ident.urlDossier, extra: ident.extra,
    rig: { nom: opts.rig.nom, hanchesM: +opts.rig.hanchesM.toFixed(4), echelle: +opts.rig.echelle.toFixed(4) },
    ...fiche,
    rendu, images, genere: new Date().toISOString(),
  }
  fs.writeFileSync(path.join(ident.dossier, 'fiche.json'), JSON.stringify(json, null, 1))
  fs.writeFileSync(
    path.join(ident.dossier, 'fiche.md'),
    ficheMarkdown(ident, fiche, opts.rig, rendu, images) + '\n' + blocFrises(brut.contexte),
  )
  return json
}

function resumerRendu(a) {
  if (!a) return null
  return {
    penetration: +a.penetration.toFixed(4), leveeMax: +a.leveeMax.toFixed(4),
    semelleMesuree: !!a.semelleMesuree,
    bassin: { min: +a.bassin.min.toFixed(4), max: +a.bassin.max.toFixed(4), moy: +a.bassin.moy.toFixed(4) },
    omegaMax: Math.round(a.omegaMax),
  }
}

// ── Notes visuelles : la mémoire de l'œil ────────────────────────────────────

function lireNotes() {
  try {
    const n = JSON.parse(fs.readFileSync(FICHIER_NOTES, 'utf8'))
    return { vedettes: n.vedettes ?? [], notes: n.notes ?? {} }
  } catch { return { vedettes: [], notes: {} } }
}

// ── index.json + RAPPORT.md, régénérés depuis le disque ──────────────────────

function lireFichesDisque() {
  const out = []
  const visiter = (dossier) => {
    if (!fs.existsSync(dossier)) return
    for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const f = path.join(dossier, e.name, 'fiche.json')
      if (fs.existsSync(f)) {
        try { out.push(JSON.parse(fs.readFileSync(f, 'utf8'))) } catch { /* fiche illisible : ignorée */ }
      } else if (e.name === 'extra') {
        visiter(path.join(dossier, e.name))
      }
    }
  }
  visiter(SORTIE)
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

function genererIndexEtRapport() {
  const fiches = lireFichesDisque()
  const { vedettes, notes } = lireNotes()
  const ordreV = { defaut: 0, limite: 1, bon: 2 }

  // index.json — ce que la page du banc consomme
  const index = {
    genere: new Date().toISOString(),
    rig: fiches[0]?.rig ?? null,
    rapport: 'RAPPORT.md',
    clips: fiches.map((f) => {
      const app = f.criteres.filter((c) => c.verdict !== 'sansObjet')
      return {
        id: f.id, slug: f.slug, dossier: f.dossier, extra: !!f.extra,
        famille: f.famille, groupe: groupeDe(f.id, f.famille),
        duree: f.duree, boucle: f.boucle, verdict: f.verdict,
        bons: app.filter((c) => c.verdict === 'bon').length,
        limites: app.filter((c) => c.verdict === 'limite').length,
        defauts: app.filter((c) => c.verdict === 'defaut').length,
        resume: f.diagnostics.find((d) => d.verdict === 'defaut')?.phrase ?? f.diagnostics[0]?.phrase ?? null,
        note: notes[f.id] ?? null,
        images: f.images, genere: f.genere,
      }
    }),
  }
  fs.mkdirSync(SORTIE, { recursive: true })
  fs.writeFileSync(path.join(SORTIE, 'index.json'), JSON.stringify(index, null, 1))

  // RAPPORT.md — l'index maître qu'un agent lit sans navigateur
  const L = []
  const rig = index.rig
  const nb = (v) => index.clips.filter((c) => c.verdict === v).length
  L.push('# RAPPORT — diagnostic de la bibliothèque .vrma')
  L.push('')
  L.push(`Généré le ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · modèle **${rig?.nom ?? '?'}** ` +
    `(hanches ${rig ? rig.hanchesM.toFixed(3) : '?'} m — épinglé : toute comparaison exige le même modèle) · ` +
    `${index.clips.length} clips.`)
  L.push('')
  L.push(`**${nb('bon')} bons · ${nb('limite')} limites · ${nb('defaut')} défauts.** ` +
    'Verdict = le pire critère applicable ; « limite » signifie « regarder l\'image avant de trancher », pas « à jeter ».')
  L.push('')
  L.push('Chaque verdict est prononcé contre le RÉFÉRENTIEL de sa famille (colonne « jugé selon ») : ' +
    'les critères universels (torsion, genoux, coudes, sol, vitesses) plus ceux de la famille — marche à son allure, ' +
    'assise, repos debout, gestes… Un clip assis n\'est jamais comparé au repos debout, une allure jamais à un geste : ' +
    '« défaut » veut dire un défaut contre SON référentiel, pas un écart à la pose debout.')
  L.push('')
  L.push('Chaque clip a son dossier : `fiche.md` (verdict, phrases, critères, frises ASCII), `fiche.json`, ' +
    'et cinq PNG (`planche-face/profil/dessus`, `traces`, `phase`). Sur les planches : squelette **bleu = gauche**, ' +
    '**rouge = droite**, sol = y 0, bandeau ATTENTION si la semelle passe sous le sol. ' +
    'Régénération : `node devtools/diagnostic/diagnostic.mjs --lot` (ou `<clip>` seul, ou `--rapport` pour cet index seul).')
  L.push('')
  if (vedettes.length) {
    L.push('## À regarder en premier')
    L.push('')
    for (const id of vedettes) {
      const c = index.clips.find((x) => x.id === id)
      if (!c) continue
      L.push(`- **[${id}](${c.dossier}/fiche.md)** — ${notes[id] ?? c.resume ?? ''} ` +
        `([profil](${c.dossier}/planche-profil.png) · [traces](${c.dossier}/traces.png) · [phase](${c.dossier}/phase.png))`)
    }
    L.push('')
  }
  for (const [gid, gtitre] of GROUPES) {
    const clips = index.clips.filter((c) => c.groupe === gid)
    if (!clips.length) continue
    clips.sort((a, b) => (ordreV[a.verdict] - ordreV[b.verdict]) || a.id.localeCompare(b.id))
    const gn = (v) => clips.filter((c) => c.verdict === v).length
    L.push(`## ${gtitre} — ${clips.length} clip(s) : ${gn('bon')} bons · ${gn('limite')} limites · ${gn('defaut')} défauts`)
    L.push('')
    L.push('| clip | verdict | jugé selon | durée | ✗/~ | ce que le juge dit | vu sur les images | liens |')
    L.push('|---|---|---|---|---|---|---|---|')
    for (const c of clips) {
      const liens = [
        `[fiche](${c.dossier}/fiche.md)`,
        `[profil](${c.dossier}/planche-profil.png)`, `[face](${c.dossier}/planche-face.png)`,
        `[dessus](${c.dossier}/planche-dessus.png)`, `[traces](${c.dossier}/traces.png)`, `[phase](${c.dossier}/phase.png)`,
      ].join(' · ')
      L.push(`| **${c.id}** | ${SYM[c.verdict]?.sym ?? '·'} ${SYM[c.verdict]?.texte ?? c.verdict} | ` +
        `critères « ${sansPipe(c.famille)} » | ${c.duree.toFixed(2)} s | ` +
        `${c.defauts}/${c.limites} | ${sansPipe(c.resume ?? '—')} | ${sansPipe(c.note ?? '—')} | ${liens} |`)
    }
    L.push('')
  }
  // Ce qui revient, critère par critère : un défaut répété est un défaut de
  // fabrication (retarget, source), pas un accident de clip.
  const parCritere = new Map()
  for (const f of fiches) {
    for (const c of f.criteres) {
      if (c.verdict !== 'defaut' && c.verdict !== 'limite') continue
      if (!parCritere.has(c.id)) parCritere.set(c.id, { libelle: c.libelle, clips: [] })
      parCritere.get(c.id).clips.push({ id: f.id, verdict: c.verdict, mesure: c.mesure })
    }
  }
  L.push('## Ce qui revient, critère par critère')
  L.push('')
  for (const [, v] of [...parCritere].sort((a, b) => b[1].clips.length - a[1].clips.length)) {
    const nd = v.clips.filter((c) => c.verdict === 'defaut').length
    L.push(`- **${v.libelle}** — ${v.clips.length} clip(s), dont ${nd} en défaut : ` +
      v.clips.map((c) => `${c.verdict === 'defaut' ? '✗' : '~'} ${c.id} (${c.mesure})`).join(' · '))
  }
  L.push('')
  fs.writeFileSync(path.join(SORTIE, 'RAPPORT.md'), L.join('\n'))
  return index
}

// ── Ligne de commande ───────────────────────────────────────────────────────

async function principal() {
  const opt = new Map()
  const libres = []
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
    if (m) opt.set(m[1], m[2] ?? '1')
    else libres.push(a)
  }

  if (opt.has('rapport')) {
    const index = genererIndexEtRapport()
    console.log(`index.json + RAPPORT.md régénérés — ${index.clips.length} clips, dans ${SORTIE}`)
    return
  }

  let ids = libres
  if (opt.has('lot')) {
    ids = listerRacine()
    const ex = opt.get('extra')
    if (ex === 'tous') ids = ids.concat(listerExtra())
    else if (ex && ex !== '1') ids = ids.concat(ex.split(',').map((s) => 'extra/' + s.trim()))
  }
  if (!ids.length) {
    console.log('usage : node diagnostic.mjs <clip…> | --lot [--extra=a,b|tous] | --rapport [--modele=m] [--sans-images] [--poses=N]')
    return
  }

  // UN modèle pour tout : la fiche et les images parlent du même squelette.
  // EtalonChibi est ÉPINGLÉ (nom exact — « sakura » attrapait
  // un autre modèle dont le nom la contient, selon l'ordre du disque).
  const modeleFichier = REN.scene.resoudreModele(opt.get('modele') ?? 'EtalonChibi')
  const rig = JR.chargerRig(modeleFichier)
  console.log(`modèle : ${rig.nom} — hanches ${rig.hanchesM.toFixed(3)} m, échelle ${rig.echelle.toFixed(3)}`)
  console.log(`sortie : ${SORTIE}`)

  const opts = {
    rig, modeleFichier,
    sansImages: opt.get('sans-images') === '1',
    poses: opt.has('poses') ? Number(opt.get('poses')) : undefined,
  }
  const t0 = Date.now()
  let faits = 0, erreurs = 0
  for (const id of ids) {
    const tc = Date.now()
    try {
      const r = await traiterClip(id, opts)
      faits++
      console.log(`  ${String(faits).padStart(3)}/${ids.length}  ${r.id.padEnd(28)} ${SYM[r.verdict].sym} ${SYM[r.verdict].texte.padEnd(7)} ${Date.now() - tc} ms`)
    } catch (e) {
      erreurs++
      console.error(`  ✗ ${id} : ${e.message}`)
    }
  }
  const index = genererIndexEtRapport()
  console.log(`\n${faits} clip(s) traité(s), ${erreurs} erreur(s), en ${((Date.now() - t0) / 1000).toFixed(0)} s.`)
  console.log(`index.json + RAPPORT.md : ${index.clips.length} clips inventoriés.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  principal().catch((e) => { console.error(e); process.exitCode = 1 })
}
