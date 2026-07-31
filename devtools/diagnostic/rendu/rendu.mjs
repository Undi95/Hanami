#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// rendu.mjs — API ET LIGNE DE COMMANDE DU RENDU.
//
// L'outil sert à VOIR une animation sans navigateur : il écrit des PNG que
// n'importe qui — ou n'importe quel agent — peut ouvrir et lire. C'est la
// réponse à la contrainte qui commande tout : la page web ne peut pas être
// photographiée, un fichier image se lit toujours.
//
// API :
//   const R = await import('./rendu.mjs')
//   await R.rendre({ clip: 'world-walk', vue: 'profil', sortie: 'x.png' })
//   await R.toutRendre({ clip: 'world-walk' })          // les 5 images d'un clip
//
// Ligne de commande :
//   node rendu.mjs planche  world-walk --vue=profil --poses=12
//   node rendu.mjs traces   world-walk
//   node rendu.mjs phase    world-walk
//   node rendu.mjs tout     world-walk world-sit-enter idle nod
//   node rendu.mjs liste
//
// Options : --modele=<motif|chemin>  --vue=face|profil|dessus|toutes
//           --poses=N --colonnes=N --case=LxH --maillage=0 --pelure=0
//           --fps=N --sortie=<dossier ou fichier> --prefixe=<txt>
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as S from './scene.mjs'
import * as F from './figure.mjs'
import * as PL from './planches.mjs'

export { S as scene, F as figure, PL as planches }

const ICI = path.dirname(fileURLToPath(import.meta.url))
// Les PNG sont des sorties régénérables : elles vont dans devtools/diagnostic-out/,
// qui est gitignoré, jamais à côté du code.
export const SORTIE_DEFAUT = path.resolve(ICI, '..', '..', 'diagnostic-out', 'rendu')

const cacheModeles = new Map()
/** Charge un modèle une seule fois par processus (12 à 26 Mo par fichier). */
export function modele(nom, { maillage = true } = {}) {
  const f = S.resoudreModele(nom)
  const cle = f + '|' + maillage
  if (!cacheModeles.has(cle)) cacheModeles.set(cle, S.chargerModele(f, { maillage }))
  return cacheModeles.get(cle)
}

/**
 * Écrit UNE image.
 * @param {object} o
 * @param {string} o.clip     slug ('world-walk') ou chemin d'un .vrma
 * @param {string} [o.type]   'planche' | 'traces' | 'phase'
 * @param {string} [o.vue]    'face' | 'profil' | 'dessus'  (planche seulement)
 * @param {string} [o.modele] motif ou chemin d'un .vrm
 * @param {string} [o.sortie] chemin du .png (déduit si absent)
 * @returns {Promise<{fichier: string, analyse: object}>}
 */
export async function rendre(o) {
  const { type = 'planche', vue = 'profil', clip: nomClip } = o
  const m = modele(o.modele, { maillage: o.maillage !== false })
  const c = await S.chargerClip(m, nomClip)
  const sortie = o.sortie ?? path.join(
    SORTIE_DEFAUT,
    `${o.prefixe ?? ''}${c.slug}-${type === 'planche' ? `planche-${vue}` : type}.png`,
  )
  const commun = { modele: m, clip: c, sortie }
  let r
  if (type === 'planche') {
    r = PL.plancheContact({
      ...commun, vue,
      poses: o.poses ?? 12, colonnes: o.colonnes ?? 4,
      largeurCase: o.largeurCase ?? 300, hauteurCase: o.hauteurCase ?? 400,
      maillage: o.maillage !== false, pelure: o.pelure !== false,
      cadre: o.cadre ?? 'auto',
    })
  } else if (type === 'traces') {
    r = PL.traces({ ...commun, fps: o.fps ?? 60, largeur: o.largeurCase ?? 520, hauteur: o.hauteurCase ?? 560 })
  } else if (type === 'phase') {
    r = PL.bandePhase({ ...commun, fps: o.fps ?? 60, largeur: o.largeur ?? 1180 })
  } else throw new Error(`type inconnu : ${type} (planche | traces | phase)`)
  return { fichier: sortie, analyse: r.analyse, clip: c, modele: m }
}

/** Les cinq images d'un clip : les trois vues, les traces, la bande de phase. */
export async function toutRendre(o) {
  const out = []
  for (const v of F.NOMS_VUES) out.push(await rendre({ ...o, type: 'planche', vue: v }))
  out.push(await rendre({ ...o, type: 'traces' }))
  out.push(await rendre({ ...o, type: 'phase' }))
  return out
}

// ── Ligne de commande ───────────────────────────────────────────────────────

function analyserArgs(argv) {
  const opt = new Map()
  const libres = []
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
    if (m) opt.set(m[1], m[2] ?? '1')
    else libres.push(a)
  }
  return { opt, libres }
}

const AIDE = `
rendu.mjs — banc de rendu d'animations VRM, sans navigateur, sans dépendance.

  node rendu.mjs planche <clip...>   planche contact (défaut : vue de profil)
  node rendu.mjs traces  <clip...>   trajectoires des extrémités
  node rendu.mjs phase   <clip...>   bande de phase (appuis, bassin, à-coups)
  node rendu.mjs tout    <clip...>   les 5 images de chaque clip
  node rendu.mjs liste               clips et modèles disponibles

Options
  --modele=<nom>       nom exact ou chemin d'un .vrm        (défaut : EtalonChibi)
  --vue=<v>            face | profil | dessus | toutes      (défaut : profil)
  --poses=N            nombre de cases de la planche        (défaut : 12)
  --colonnes=N         cases par rangée                     (défaut : 4)
  --case=LxH           taille d'une case en pixels          (défaut : 300x400)
  --cadre=corps        force le plan large (défaut : auto, cadre sur ce qui bouge)
  --maillage=0         squelette seul, sans le corps (≈ 8 × plus rapide)
  --pelure=0           sans pelure d'oignon
  --fps=N              images/s des relevés traces et phase (défaut : 60)
  --sortie=<chemin>    dossier de sortie, ou fichier si un seul rendu
  --prefixe=<txt>      préfixe des noms de fichiers

Exemples
  node rendu.mjs planche world-walk --vue=toutes
  node rendu.mjs tout world-sit-enter --modele=miku --poses=16
  node rendu.mjs phase world-walk world-walk-slow world-walk-fast
`

async function principal() {
  const { opt, libres } = analyserArgs(process.argv.slice(2))
  const commande = libres[0] ?? 'aide'
  if (commande === 'aide' || opt.has('h') || opt.has('aide') || opt.has('help')) {
    console.log(AIDE); return
  }
  if (commande === 'liste') {
    console.log(`clips (${S.listerClips().length}) dans ${S.DOSSIER_VRMA} :`)
    for (const c of S.listerClips()) console.log('  ' + c)
    console.log(`\nmodèles (${S.listerModeles().length}) dans ${S.DOSSIER_VRM} :`)
    for (const m of S.listerModeles()) console.log('  ' + m)
    return
  }

  const clips = libres.slice(1)
  if (!clips.length) { console.error('aucun clip donné.' + AIDE); process.exitCode = 1; return }

  const [lc, hc] = (opt.get('case') ?? '').split('x').map(Number)
  const base = {
    modele: opt.get('modele'),
    poses: opt.has('poses') ? Number(opt.get('poses')) : undefined,
    colonnes: opt.has('colonnes') ? Number(opt.get('colonnes')) : undefined,
    largeurCase: isFinite(lc) && lc ? lc : undefined,
    hauteurCase: isFinite(hc) && hc ? hc : undefined,
    maillage: opt.get('maillage') !== '0',
    pelure: opt.get('pelure') !== '0',
    cadre: opt.get('cadre'),
    fps: opt.has('fps') ? Number(opt.get('fps')) : undefined,
    prefixe: opt.get('prefixe'),
  }
  const sortieOpt = opt.get('sortie')
  const vueOpt = opt.get('vue') ?? 'profil'
  const vues = vueOpt === 'toutes' ? F.NOMS_VUES : [vueOpt]

  const faits = []
  for (const clip of clips) {
    const t0 = Date.now()
    const taches = []
    if (commande === 'planche') for (const v of vues) taches.push({ type: 'planche', vue: v })
    else if (commande === 'traces') taches.push({ type: 'traces' })
    else if (commande === 'phase') taches.push({ type: 'phase' })
    else if (commande === 'tout') {
      for (const v of F.NOMS_VUES) taches.push({ type: 'planche', vue: v })
      taches.push({ type: 'traces' }, { type: 'phase' })
    } else { console.error(`commande inconnue : ${commande}` + AIDE); process.exitCode = 1; return }

    for (const t of taches) {
      let sortie
      if (sortieOpt) {
        const unSeul = clips.length === 1 && taches.length === 1
        sortie = unSeul && /\.png$/i.test(sortieOpt)
          ? sortieOpt
          : path.join(sortieOpt, `${base.prefixe ?? ''}${clip}-${t.type === 'planche' ? `planche-${t.vue}` : t.type}.png`)
      }
      const r = await rendre({ ...base, ...t, clip, sortie })
      faits.push(r.fichier)
      const st = fs.statSync(r.fichier)
      console.log(`  ${path.relative(process.cwd(), r.fichier).replace(/\\/g, '/')}  (${(st.size / 1024).toFixed(0)} Ko)`)
    }
    console.log(`${clip} : ${taches.length} image(s) en ${Date.now() - t0} ms`)
  }
  console.log(`\n${faits.length} image(s) écrite(s).`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  principal().catch((e) => { console.error(e); process.exitCode = 1 })
}
