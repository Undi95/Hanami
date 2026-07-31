// ════════════════════════════════════════════════════════════════════════════
// planches.mjs — LES TROIS IMAGES.
//
//   1. plancheContact — N poses régulièrement espacées, côte à côte, CADRÉES
//      ENSEMBLE. C'est l'image qui dit si un mouvement est logique.
//   2. traces        — la trajectoire des pieds, des mains, du bassin et de la
//      tête sur une seule image. C'est l'image qui dit si un pied patine.
//   3. bandePhase    — le cycle lu en une ligne : quel pied porte, où est le
//      bassin, où sont les à-coups.
//
// Toutes trois portent leurs propres chiffres. Une image de banc d'essai qui
// oblige à retourner au terminal pour savoir ce qu'on regarde a raté sa cible.
// ════════════════════════════════════════════════════════════════════════════

import path from 'node:path'
import fs from 'node:fs'
import { Toile, COULEURS, clair } from './png.mjs'
import * as S from './scene.mjs'
import * as F from './figure.mjs'

const f1 = (x) => (isFinite(x) ? x.toFixed(1) : '—')
const f2 = (x) => (isFinite(x) ? x.toFixed(2) : '—')
const f3 = (x) => (isFinite(x) ? x.toFixed(3) : '—')

/** Points du corps dont on suit la trajectoire, et leur couleur. */
export const SUIVIS = [
  { os: 'leftFoot', nom: 'pied G', couleur: COULEURS.gauche, pied: 'g' },
  { os: 'rightFoot', nom: 'pied D', couleur: COULEURS.droite, pied: 'd' },
  { os: 'leftHand', nom: 'main G', couleur: [18, 148, 158] },
  { os: 'rightHand', nom: 'main D', couleur: [186, 38, 128] },
  { os: 'hips', nom: 'bassin', couleur: COULEURS.bassin },
  { os: 'head', nom: 'tête', couleur: COULEURS.vert },
]

const OS_MAJEURS = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
]

/** Angle (degrés) entre deux quaternions, bien conditionné près de 0. */
function angleQuat(a, b) {
  let bx = b.x, by = b.y, bz = b.z, bw = b.w
  if (a.x * bx + a.y * by + a.z * bz + a.w * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw }
  const dm = Math.hypot(a.x - bx, a.y - by, a.z - bz, a.w - bw)
  const dp = Math.hypot(a.x + bx, a.y + by, a.z + bz, a.w + bw)
  return 4 * Math.atan2(dm, dp) * (180 / Math.PI)
}

// ════════════════════════════════════════════════════════════════════════════
// Analyse dense du clip — la matière commune aux trois planches
// ════════════════════════════════════════════════════════════════════════════

/**
 * Rejoue le clip à `fps` images par seconde et relève tout ce que les planches
 * ont à montrer. Le dernier échantillon est pris à `durée − EPS` : à `durée`
 * exactement, un clip bouclé rend sa PREMIÈRE image et fabrique un faux résultat.
 */
export function analyser(modele, clip, { fps = 60 } = {}) {
  const n = Math.max(2, Math.round(clip.duree * fps) + 1)
  const dt = clip.duree / (n - 1)
  const t = new Float64Array(n)
  const pts = new Map(SUIVIS.map((s) => [s.os, []]))
  const basPied = { g: new Float64Array(n), d: new Float64Array(n) }
  const hauteurBassin = new Float64Array(n)
  const omega = new Float64Array(n)
  const avant = []
  let qPrec = null

  // Décalage os → semelle, mesuré sur la POSE DE REPOS : c'est le repli quand
  // le modèle est chargé sans maillage. Debout et à plat, la semelle est au sol,
  // donc ce décalage est exactement la hauteur de l'os au repos.
  S.appliquer(modele, { q: new Map(), p: modele.adapt.reposHips })
  const reposOs = S.appliquer(modele, { q: new Map(), p: modele.adapt.reposHips })
  const decalage = {}
  for (const [k, pre] of [['g', 'left'], ['d', 'right']]) {
    decalage[k] = Math.min(reposOs.get(pre + 'Foot')?.y ?? Infinity, reposOs.get(pre + 'Toes')?.y ?? Infinity)
  }
  const avecMaillage = !!S.preparerSemelles(modele)

  for (let i = 0; i < n; i++) {
    t[i] = Math.min(clip.duree - S.EPS, i * dt)
    const pose = clip.ech(t[i])
    const os = S.appliquer(modele, pose)
    for (const s of SUIVIS) {
      const p = os.get(s.os)
      pts.get(s.os).push(p ? p.clone() : null)
    }
    hauteurBassin[i] = os.get('hips')?.y ?? NaN
    const sem = avecMaillage ? S.hauteurSemelles(modele) : null
    for (const [k, pre] of [['g', 'left'], ['d', 'right']]) {
      basPied[k][i] = sem
        ? sem[k]
        : Math.min(os.get(pre + 'Foot')?.y ?? Infinity, os.get(pre + 'Toes')?.y ?? Infinity) - decalage[k]
    }
    avant.push(S.avantGeometrique(modele).clone())
    if (qPrec) {
      let m = 0
      for (const o of OS_MAJEURS) {
        const a = pose.q.get(o), b = qPrec.get(o)
        if (a && b) m = Math.max(m, angleQuat(a, b))
      }
      omega[i] = m / dt
    }
    qPrec = pose.q
  }
  if (n > 1) omega[0] = omega[1]

  // LE SOL EST y = 0, PAS le minimum du clip. C'est l'altitude à laquelle
  // l'application pose le personnage, et la seule qui permette de VOIR un pied
  // qui traverse le plancher. Définir le sol comme le point le plus bas atteint
  // rendrait ce défaut invisible par construction.
  //
  // L'APPUI, lui, se juge RELATIVEMENT : le pied porteur est le plus bas des
  // deux. Un seuil absolu échouerait précisément sur les clips à corriger — si
  // le personnage s'enfonce de 5 cm, tout passe sous n'importe quel seuil fixe
  // et les deux pieds portent en permanence, ce qui n'apprend rien. Le garde-fou
  // absolu ne sert qu'à laisser exister une phase de vol (les deux pieds hauts).
  const seuil = 0.015 * (modele.hanchesRepos / 0.95)
  const plafondVol = 0.035 * (modele.hanchesRepos / 0.95)
  const appui = { g: new Uint8Array(n), d: new Uint8Array(n) }
  let bas = Infinity, haut = -Infinity
  for (let i = 0; i < n; i++) {
    const plusBas = Math.min(basPied.g[i], basPied.d[i])
    for (const c of ['g', 'd']) {
      appui[c][i] = basPied[c][i] <= plusBas + seuil && basPied[c][i] <= plafondVol ? 1 : 0
    }
    bas = Math.min(bas, plusBas)
    haut = Math.max(haut, basPied.g[i], basPied.d[i])
  }
  return {
    n, dt, t, pts, basPied, hauteurBassin, omega, appui,
    sol: 0, seuilAppui: seuil, semelleMesuree: avecMaillage,
    penetration: Math.min(0, bas), leveeMax: haut, amplitudePied: haut - Math.min(0, bas),
    avant,
    bassin: {
      min: Math.min(...hauteurBassin), max: Math.max(...hauteurBassin),
      moy: hauteurBassin.reduce((a, b) => a + b, 0) / n,
    },
    omegaMax: Math.max(...omega), omegaMoy: omega.reduce((a, b) => a + b, 0) / n,
  }
}

/** Décrit l'état d'appui à un instant, en toutes lettres. */
function texteAppui(a, i) {
  const g = a.appui.g[i], d = a.appui.d[i]
  if (g && d) return 'appui G+D'
  if (g) return 'appui G'
  if (d) return 'appui D'
  return 'EN VOL'
}

// ── Bandeaux communs ────────────────────────────────────────────────────────

/**
 * Découpe une ligne trop longue, de préférence sur un séparateur « · ».
 * Un bandeau tronqué au bord de l'image perd justement le chiffre qu'on
 * cherchait : mieux vaut deux lignes.
 */
function replier(toile, texte, largeurMax, echelle = 1) {
  const cap = Math.max(8, Math.floor(largeurMax / (6 * echelle)))
  if (texte.length <= cap) return [texte]
  const out = []
  let reste = texte
  while (reste.length > cap) {
    let coupe = reste.lastIndexOf('  ·  ', cap)
    if (coupe < cap * 0.4) coupe = reste.lastIndexOf(' ', cap)
    if (coupe < cap * 0.4) coupe = cap
    out.push(reste.slice(0, coupe).trimEnd())
    reste = reste.slice(coupe).replace(/^\s*·?\s*/, '')
  }
  if (reste) out.push(reste)
  return out
}

/** Prépare le bandeau : replie les lignes et rend la hauteur nécessaire. */
function preparerEntete(lignes, largeur, marge) {
  const faux = { largeurTexte: (s, e) => (s.length * 6 - 1) * e }
  const corps = []
  for (const l of lignes.slice(1)) corps.push(...replier(faux, l, largeur - marge * 2, 1))
  return { titre: lignes[0], corps, hauteur: 10 + 22 + corps.length * 12 + 6 }
}

function enteteCommune(toile, x, entete) {
  toile.rect(0, 0, toile.w, entete.hauteur - 2, COULEURS.fondAlterne)
  toile.rect(0, entete.hauteur - 2, toile.w, 2, COULEURS.grilleForte)
  // Le titre est écrit en gros : s'il déborde, on le rogne plutôt que de le
  // laisser sortir de l'image sans que rien ne le signale.
  let titre = entete.titre
  const cap = Math.floor((toile.w - 2 * x) / 12)
  if (titre.length > cap) titre = titre.slice(0, Math.max(1, cap - 1)) + '.'
  toile.texte(x, 10, titre, COULEURS.encre, 2)
  let yy = 32
  for (const l of entete.corps) { toile.texte(x, yy, l, COULEURS.encreDouce, 1); yy += 12 }
  return yy
}

/**
 * Bandeau de titre d'un panneau : intitulé à gauche, chiffres à droite.
 * Les chiffres sont ABANDONNÉS s'ils ne tiennent pas — deux textes qui se
 * chevauchent ne valent pas mieux qu'aucun texte.
 */
function titrePanneau(toile, x, y, w, gauche, droite) {
  toile.rect(x, y, w, 15, COULEURS.fondAlterne, 0.92)
  // L'intitulé lui-même est rogné à la largeur du panneau : sur un panneau
  // étroit, un titre entier irait s'écrire sur le panneau voisin.
  const cap = Math.max(4, Math.floor((w - 10) / 6))
  if (gauche.length > cap) gauche = gauche.slice(0, cap - 1) + '.'
  toile.texte(x + 5, y + 4, gauche, COULEURS.encre, 1)
  if (droite && toile.largeurTexte(gauche, 1) + toile.largeurTexte(droite, 1) + 22 <= w) {
    toile.texte(x + w - 5, y + 4, droite, COULEURS.encreDouce, 1, 'd')
  }
}

/** Pastille de couleur + légende. */
function pastille(toile, x, y, couleur, texte, echelle = 1) {
  toile.rect(x, y, 8, 8, couleur)
  toile.cadre(x, y, 8, 8, COULEURS.encre, 1)
  toile.texte(x + 12, y, texte, COULEURS.encreDouce, echelle)
  return x + 12 + toile.largeurTexte(texte, echelle) + 14
}

/** Règle verticale graduée, partagée par toute une rangée de cases. */
function regleVerticale(toile, x, y, cadrage, largeur, { pas = cadrage.pasGrille, unite = 'm' } = {}) {
  const v0 = Math.ceil(cadrage.v0 / pas) * pas
  for (let v = v0; v <= cadrage.v1 + 1e-9; v += pas) {
    const yy = y + cadrage.ligneDe(v)
    if (yy < y + 2 || yy > y + cadrage.hauteur - 2) continue
    const sol = cadrage.vue.sol && Math.abs(v) < 1e-6
    toile.rect(x + largeur - 6, yy, 6, sol ? 2 : 1, sol ? COULEURS.sol : COULEURS.grilleForte)
    toile.texte(x + largeur - 9, yy - 3, (Math.abs(v) < 1e-9 ? '0' : v.toFixed(2)), sol ? COULEURS.sol : COULEURS.encreDouce, 1, 'd')
  }
  toile.texte(x + largeur - 9, y + 2, unite, COULEURS.encreDouce, 1, 'd')
}

/** Graduations de 10 cm le long du sol : l'échelle métrique, dans l'image. */
function regleSol(toile, ox, oy, cadrage, { pas = cadrage.pasGrille / 5 } = {}) {
  if (!cadrage.vue.sol) return
  const ysol = cadrage.ligneDe(0)
  if (ysol < 0 || ysol > cadrage.hauteur) return
  const u0 = Math.ceil(cadrage.u0 / pas) * pas
  for (let u = u0; u <= cadrage.u1 + 1e-9; u += pas) {
    const x = cadrage.colonneDe(u)
    if (x < 1 || x > cadrage.largeur - 1) continue
    const demi = Math.abs(u % 0.5) < 1e-6 || Math.abs(Math.abs(u % 0.5) - 0.5) < 1e-6
    toile.rect(ox + x, oy + ysol + 1, 1, demi ? 6 : 3, COULEURS.sol)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. LA PLANCHE CONTACT
// ════════════════════════════════════════════════════════════════════════════

/**
 * @param {object} o
 * @param {object} o.modele     modèle chargé (scene.chargerModele)
 * @param {object} o.clip       clip chargé (scene.chargerClip)
 * @param {string} o.vue        'face' | 'profil' | 'dessus'
 * @param {number} o.poses      nombre de cases
 * @param {number} o.colonnes   cases par rangée
 * @param {boolean} o.maillage  dessiner le corps (sinon squelette seul)
 * @param {boolean} o.pelure    pelure d'oignon (pose précédente en pâle)
 * @param {string} o.sortie     chemin du .png
 */
export function plancheContact(o) {
  const {
    modele, clip, vue: nomVue = 'profil', poses = 12, colonnes = 4,
    largeurCase = 300, hauteurCase = 400, maillage = true, pelure = true, sortie,
  } = o
  const vue = F.VUES[nomVue]
  if (!vue) throw new Error(`vue inconnue : ${nomVue} (attendu : ${F.NOMS_VUES.join(', ')})`)

  const a = analyser(modele, clip, { fps: 60 })
  const instants = []
  for (let i = 0; i < poses; i++) {
    instants.push(Math.min(clip.duree - S.EPS, (i * clip.duree) / poses))
  }
  // Pose de référence pour les épaisseurs (mesurées une seule fois).
  const os0 = S.appliquer(modele, clip.ech(0))
  if (modele.peaux) S.deformer(modele)
  const ep = F.mesurerEpaisseurs(modele, os0)

  // PASSE 1 — cadrage commun. Sans lui, chaque case se recadrerait sur sa
  // propre pose et le mouvement disparaîtrait de la planche.
  const boites = []
  const posesOs = []
  for (const t of instants) {
    const os = S.appliquer(modele, clip.ech(t))
    posesOs.push(new Map([...os].map(([k, v]) => [k, v.clone()])))
    boites.push(F.boiteDe(vue, os, 0.1))
  }
  const rangees = Math.ceil(poses / colonnes)
  // Cadrage : sur le corps entier, ou sur la partie qui porte le mouvement.
  // La marge du cadrage rapproché vaut un rayon de tête : les boîtes sont
  // calculées sur des positions d'OS, or un os de tête est au milieu du crâne et
  // un os de main au milieu de la paume — sans cette chair, le gros plan coupe
  // le sommet du crâne, ce qu'aucun lecteur ne pardonne.
  let mob = o.cadre === 'corps'
    ? null
    : F.boiteMobile(vue, posesOs, { marge: (ep.get('tete') ?? 0.11) * 1.5 })
  let cadrage = mob
    ? new F.Cadrage(vue, [mob.boite], largeurCase, hauteurCase, { forcerSol: false })
    : null
  // GARDE-FOUS du gros plan. Un mouvement minuscule (un socle qui respire :
  // 1,4 cm sur une main) agrandi à pleine case MENT sur son ampleur ; et une
  // échelle démesurée transforme la case en loupe sur un détail sans contexte.
  // Dans les deux cas, la seule image honnête est le plan large — c'est le
  // défaut qui a rendu illisible la première planche d'idle de face.
  let noteCadrage = null
  const amplMin = 0.03 * (modele.hanchesRepos / 0.95)
  const ECHELLE_MAX = 600 // px/m
  if (mob && (mob.amplitudeMax < amplMin || cadrage.echelle > ECHELLE_MAX)) {
    noteCadrage = `mouvement max ${f1(mob.amplitudeMax * 100)} cm (${mob.mobiles.slice(0, 4).join(', ')}) — ` +
      `trop petit pour un gros plan honnête, cadrage corps entier`
    mob = null
    cadrage = null
  }
  if (!cadrage) cadrage = new F.Cadrage(vue, boites, largeurCase, hauteurCase)
  if (!noteCadrage) {
    noteCadrage = mob
      ? `cadrage RAPPROCHÉ sur ce qui bouge (${mob.mobiles.slice(0, 6).join(', ')}${mob.mobiles.length > 6 ? '…' : ''}, ` +
        `amplitude max ${f1(mob.amplitudeMax * 100)} cm) — le reste du corps est quasi immobile`
      : 'cadrage sur le corps entier'
  }

  // Géométrie de la planche.
  const MG = 12, LARG_REGLE = 46, ECART = 6
  const hPied = 44
  const W = MG * 2 + LARG_REGLE + colonnes * largeurCase + (colonnes - 1) * ECART
  const entete = preparerEntete([
    `PLANCHE CONTACT — ${clip.slug} — vue ${vue.titre}`,
    `modèle ${modele.nom} (VRM ${modele.version}.x, hanches au repos ${f3(modele.hanchesRepos)} m, échelle world.json ${f2(modele.echelle)})  ·  ` +
      `durée ${f3(clip.duree)} s  ·  ${poses} poses tous les ${f3(clip.duree / poses)} s  ·  ` +
      `${clip.osAnimes.size} os animés  ·  ${clip.aTranslation ? 'bassin animé en translation' : 'bassin sans translation'}`,
    `échelle ${f1(cadrage.echelle)} px/m  ·  grille ${f2(cadrage.pasGrille)} m  ·  ` +
      `axes : ${vue.axeU}, ${vue.axeV}  ·  ${noteCadrage}`,
    `bassin ${f1(a.bassin.min * 100)} à ${f1(a.bassin.max * 100)} cm  ·  ` +
      `appui = pied porteur (le plus bas des deux, à ${f1(a.seuilAppui * 100)} cm près) ` +
      `·  semelle ${a.semelleMesuree ? 'mesurée sur le maillage' : 'estimée depuis les os'}` +
      (a.penetration < -0.005 ? `  ·  ATTENTION : le pied descend à ${f1(-a.penetration * 100)} cm SOUS le sol` : ''),
  ], W, MG)
  const H = entete.hauteur + rangees * hauteurCase + (rangees - 1) * ECART + hPied
  const toile = new Toile(W, H, COULEURS.fond)
  enteteCommune(toile, MG, entete)
  const hEntete = entete.hauteur

  for (let i = 0; i < poses; i++) {
    const col = i % colonnes, rang = Math.floor(i / colonnes)
    const ox = MG + LARG_REGLE + col * (largeurCase + ECART)
    const oy = hEntete + rang * (hauteurCase + ECART)
    toile.rect(ox, oy, largeurCase, hauteurCase, COULEURS.fondCellule)
    // Tout le dessin de la case est CONFINÉ à la case : un membre qui sort du
    // cadrage n'a aucune raison d'aller se dessiner sur la case voisine.
    toile.clip(ox, oy, largeurCase, hauteurCase)
    F.dessinerRepere(toile, ox, oy, cadrage)
    regleSol(toile, ox, oy, cadrage)

    // Pelure d'oignon : la pose précédente, en pâle. C'est ce qui transforme
    // une suite d'images fixes en mouvement lisible.
    if (pelure && i > 0) {
      F.dessinerOs(toile, ox, oy, cadrage, posesOs[i - 1], ep, {
        style: 'calque', attenue: 0.72, doigts: false, articulations: false, epaisseurTrait: 0.9,
      })
    }

    S.appliquer(modele, clip.ech(instants[i]))
    if (maillage && modele.peaux) F.dessinerCorps(toile, ox, oy, cadrage, modele)
    F.dessinerOs(toile, ox, oy, cadrage, posesOs[i], ep, {
      style: maillage && modele.peaux ? 'calque' : 'plein',
    })

    // Étiquettes : le numéro, l'instant, et les deux chiffres qui décident —
    // hauteur du bassin et pied porteur.
    const j = Math.min(a.n - 1, Math.round(instants[i] / a.dt))
    toile.rect(ox, oy, largeurCase, 16, COULEURS.fondAlterne, 0.92)
    toile.texte(ox + 5, oy + 4, `#${String(i + 1).padStart(2, '0')}`, COULEURS.encre, 2)
    toile.texte(ox + 60, oy + 5, `t = ${f3(instants[i])} s`, COULEURS.encre, 1)
    toile.texte(ox + largeurCase - 5, oy + 5, `${((instants[i] / clip.duree) * 100).toFixed(0)} %`, COULEURS.encreDouce, 1, 'd')
    const etat = texteAppui(a, j)
    toile.rect(ox, oy + hauteurCase - 15, largeurCase, 15, COULEURS.fondAlterne, 0.92)
    toile.texte(ox + 5, oy + hauteurCase - 12, `bassin ${f1(a.hauteurBassin[j] * 100)} cm`, COULEURS.encreDouce, 1)
    toile.texte(ox + largeurCase - 5, oy + hauteurCase - 12, etat, etat === 'EN VOL' ? COULEURS.alerte : COULEURS.encre, 1, 'd')
    toile.sansClip()
    toile.cadre(ox, oy, largeurCase, hauteurCase, COULEURS.grilleForte, 1)

    if (col === 0) regleVerticale(toile, MG, oy, cadrage, LARG_REGLE)
  }

  // Pied de planche : légende et barre d'échelle.
  const yp = H - hPied + 8
  toile.rect(0, H - hPied, W, hPied, COULEURS.fondAlterne)
  toile.rect(0, H - hPied, W, 2, COULEURS.grilleForte)
  let x = MG
  x = pastille(toile, x, yp, COULEURS.gauche, 'côté GAUCHE du perso')
  x = pastille(toile, x, yp, COULEURS.droite, 'côté DROIT')
  x = pastille(toile, x, yp, COULEURS.corps, 'corps (maillage déformé)')
  x = pastille(toile, x, yp, clair(COULEURS.gauche, 0.72), 'pose précédente')
  // Barre d'échelle : un demi-mètre, mesuré dans l'image.
  const lb = 0.5 * cadrage.echelle
  const xb = W - MG - lb
  toile.rect(xb, yp + 3, lb, 3, COULEURS.encre)
  toile.rect(xb, yp, 1, 9, COULEURS.encre)
  toile.rect(xb + lb - 1, yp, 1, 9, COULEURS.encre)
  toile.texte(xb + lb / 2, yp + 11, '0,50 m', COULEURS.encre, 1, 'c')
  toile.texte(MG, yp + 16, `source : ${path.basename(clip.slug)}.vrma  ·  ${path.basename(modele.fichier)}  ·  dernière pose échantillonnée à durée − 1e-4 s`, COULEURS.encreDouce, 1)

  if (sortie) { fs.mkdirSync(path.dirname(sortie), { recursive: true }); toile.ecrire(sortie) }
  return { toile, analyse: a, cadrage, sortie }
}

// ════════════════════════════════════════════════════════════════════════════
// 2. LES TRACES
// ════════════════════════════════════════════════════════════════════════════

/** Boîte des traces ET de la silhouette de repère, dans une vue donnée. */
function boiteTraces(vue, a, osRepere) {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
  const avaler = (p) => {
    const q = F.projeterVue(vue, p)
    if (q.u < u0) u0 = q.u
    if (q.u > u1) u1 = q.u
    if (q.v < v0) v0 = q.v
    if (q.v > v1) v1 = q.v
  }
  for (const s of SUIVIS) for (const p of a.pts.get(s.os)) if (p) avaler(p)
  for (const p of osRepere.values()) avaler(p)
  if (vue.sol) v0 = Math.min(v0, 0)
  return { u0: u0 - 0.09, u1: u1 + 0.09, v0: v0 - 0.05, v1: v1 + 0.11 }
}

/** Un panneau de traces : silhouette de repère + une courbe par point suivi. */
function panneauTraces(toile, ox, oy, w, h, vue, a, modele, ep, clip, titre, boite) {
  const cad = new F.Cadrage(vue, [boite], w, h, { marge: 18, forcerSol: false })
  toile.rect(ox, oy, w, h, COULEURS.fondCellule)
  toile.clip(ox, oy, w, h) // rien ne déborde sur le panneau voisin
  F.dessinerRepere(toile, ox, oy, cad)
  regleSol(toile, ox, oy, cad)

  // Silhouette de repère : le squelette de la PREMIÈRE image, très pâle. Sans
  // corps, une trace n'est qu'un gribouillis — on ne sait pas de quel membre
  // elle parle.
  const os0 = new Map()
  const posD = S.appliquer(modele, clip.ech(0))
  for (const [k, v] of posD) os0.set(k, v.clone())
  F.dessinerOs(toile, ox, oy, cad, os0, ep, {
    style: 'calque', attenue: 0.8, doigts: false, articulations: false, epaisseurTrait: 1.1,
  })
  // Barre d'échelle : 10 cm, mesurés dans l'image.
  const lb = 0.1 * cad.echelle
  toile.rect(ox + w - lb - 10, oy + h - 14, lb, 3, COULEURS.encre)
  toile.rect(ox + w - lb - 10, oy + h - 17, 1, 9, COULEURS.encre)
  toile.rect(ox + w - 11, oy + h - 17, 1, 9, COULEURS.encre)
  toile.texte(ox + w - lb / 2 - 10, oy + h - 27, '10 cm', COULEURS.encre, 1, 'c')

  // Les courbes.
  for (const s of SUIVIS) {
    const L = a.pts.get(s.os)
    const pts = []
    for (let i = 0; i < a.n; i++) {
      if (!L[i]) continue
      const P = cad.px(L[i])
      pts.push([ox + P[0], oy + P[1]])
    }
    if (pts.length < 2) continue
    toile.polyligne(pts, s.couleur, 2.1)
    // Contacts au sol : un carré plein sur chaque image où le pied porte.
    if (s.pied) {
      for (let i = 0; i < a.n; i++) {
        if (!a.appui[s.pied][i] || !L[i]) continue
        const P = cad.px(L[i])
        toile.rect(ox + P[0] - 2, oy + P[1] - 2, 4, 4, COULEURS.contact)
      }
    }
    // Départ : un anneau. Arrivée : une croix.
    const A = cad.px(L[0]), B = cad.px(L[a.n - 1])
    toile.anneau(ox + A[0], oy + A[1], 4.5, s.couleur, 2)
    toile.segment(ox + B[0] - 4, oy + B[1] - 4, ox + B[0] + 4, oy + B[1] + 4, s.couleur, 2)
    toile.segment(ox + B[0] - 4, oy + B[1] + 4, ox + B[0] + 4, oy + B[1] - 4, s.couleur, 2)
  }
  toile.sansClip()
  titrePanneau(toile, ox, oy, w, titre, `${f1(cad.echelle)} px/m · grille ${f2(cad.pasGrille)} m`)
  toile.cadre(ox, oy, w, h, COULEURS.grilleForte, 1)
  return cad
}

export function traces(o) {
  const { modele, clip, hauteur = 560, sortie, fps = 60 } = o
  const a = analyser(modele, clip, { fps })
  const os0 = S.appliquer(modele, clip.ech(0))
  if (modele.peaux) S.deformer(modele)
  const ep = F.mesurerEpaisseurs(modele, os0)

  const MG = 12, ECART = 8, hPied = 52
  // Largeur de chaque panneau DÉDUITE de son contenu : un plan vertical est
  // haut et étroit, une vue de dessus est presque carrée. Leur imposer la même
  // largeur laisserait la moitié de l'image vide et écraserait les courbes.
  const boites = {
    profil: boiteTraces(F.VUES.profil, a, os0),
    dessus: boiteTraces(F.VUES.dessus, a, os0),
  }
  const largeurPanneau = (b) => {
    const r = (b.u1 - b.u0) / Math.max(1e-6, b.v1 - b.v0)
    return Math.round(Math.max(230, Math.min(760, (hauteur - 36) * r + 36)))
  }
  let wP = largeurPanneau(boites.profil), wD = largeurPanneau(boites.dessus)
  const LARGEUR_MIN = 940 // de quoi loger le bandeau et la légende sans replis
  const W = Math.max(MG * 2 + wP + wD + ECART, LARGEUR_MIN)
  // Si la largeur minimale l'emporte, le surplus va aux panneaux plutôt que de
  // laisser une bande vide sur le côté.
  const surplus = W - (MG * 2 + wP + wD + ECART)
  if (surplus > 0) {
    const part = Math.round((surplus * wP) / (wP + wD))
    wP += part
    wD += surplus - part
  }

  // Distance parcourue au sol par chaque pied pendant qu'il PORTE : c'est
  // l'avance que le code devra appliquer, et c'est le chiffre qui dit si le
  // personnage patinera.
  const glissement = {}
  for (const c of ['g', 'd']) {
    const os = c === 'g' ? 'leftFoot' : 'rightFoot'
    const L = a.pts.get(os)
    let d = 0
    for (let i = 1; i < a.n; i++) {
      if (!a.appui[c][i] || !a.appui[c][i - 1] || !L[i] || !L[i - 1]) continue
      d += Math.hypot(L[i].x - L[i - 1].x, L[i].z - L[i - 1].z)
    }
    glissement[c] = d
  }

  const entete = preparerEntete([
    `TRACES — ${clip.slug} — trajectoire des extrémités`,
    `modèle ${modele.nom}  ·  durée ${f3(clip.duree)} s  ·  ${a.n} images relevées (${fps} img/s)  ·  ` +
      `sol = y 0  ·  semelle ${a.semelleMesuree ? 'mesurée sur le maillage' : 'estimée depuis les os'}  ·  ` +
      `levée de pied max ${f1(a.leveeMax * 100)} cm` +
      (a.penetration < -0.005 ? `  ·  ATTENTION : pénétration de ${f1(-a.penetration * 100)} cm sous le sol` : ''),
    `course au sol du pied pendant l'appui — G ${f1(glissement.g * 100)} cm, D ${f1(glissement.d * 100)} cm  ·  ` +
      `sur un clip joué sur place c'est l'avance que le code doit rendre au personnage ; sur un clip immobile, c'est du patinage`,
  ], W, MG)
  const H = entete.hauteur + hauteur + hPied
  const toile = new Toile(W, H, COULEURS.fond)
  enteteCommune(toile, MG, entete)
  const hEntete = entete.hauteur

  panneauTraces(toile, MG, hEntete, wP, hauteur, F.VUES.profil, a, modele, ep, clip,
    'plan vertical — → +Z avant, ↑ +Y hauteur', boites.profil)
  panneauTraces(toile, MG + wP + ECART, hEntete, wD, hauteur, F.VUES.dessus, a, modele, ep, clip,
    'vue de dessus — → −X droite, ↑ +Z avant', boites.dessus)

  const yp = H - hPied + 7
  toile.rect(0, H - hPied, W, hPied, COULEURS.fondAlterne)
  toile.rect(0, H - hPied, W, 2, COULEURS.grilleForte)
  let x = MG
  for (const s of SUIVIS) x = pastille(toile, x, yp, s.couleur, s.nom)
  x = pastille(toile, x, yp, COULEURS.contact, 'pied au sol (carré plein)')
  toile.texte(MG, yp + 15, 'cercle = première image  ·  croix = dernière image  ·  silhouette pâle = pose à t = 0, pour situer les membres', COULEURS.encreDouce, 1)
  toile.texte(MG, yp + 27, 'un pied qui PATINE laisse au sol une trace rectiligne ; un pied qui MARCHE laisse un arc qui décolle et se repose', COULEURS.encreDouce, 1)

  if (sortie) { fs.mkdirSync(path.dirname(sortie), { recursive: true }); toile.ecrire(sortie) }
  return { toile, analyse: a, sortie }
}

// ════════════════════════════════════════════════════════════════════════════
// 3. LA BANDE DE PHASE
// ════════════════════════════════════════════════════════════════════════════

/** Une piste de la bande : cadre, titre, échelle verticale. */
function piste(toile, x, y, w, h, titre, sousTitre) {
  toile.rect(x, y, w, h, COULEURS.fondCellule)
  toile.cadre(x, y, w, h, COULEURS.grilleForte, 1)
  toile.texte(x + 5, y + 4, titre, COULEURS.encre, 1)
  if (sousTitre && toile.largeurTexte(titre, 1) + toile.largeurTexte(sousTitre, 1) + 22 <= w) {
    toile.texte(x + w - 5, y + 4, sousTitre, COULEURS.encreDouce, 1, 'd')
  }
}

export function bandePhase(o) {
  const { modele, clip, largeur = 1180, sortie, fps = 60 } = o
  const a = analyser(modele, clip, { fps })

  const MG = 12, LG = 118 // colonne des intitulés
  const hPied = 34
  const hAppui = 34, hBassin = 110, hPieds = 110, hOmega = 96, ECART = 6
  const W = largeur
  const wt = W - MG * 2 - LG // largeur utile de l'axe du temps

  const entete = preparerEntete([
    `BANDE DE PHASE — ${clip.slug}`,
    `modèle ${modele.nom}  ·  durée ${f3(clip.duree)} s  ·  ${a.n} images (${fps} img/s)  ·  ` +
      `bassin ${f1(a.bassin.min * 100)} à ${f1(a.bassin.max * 100)} cm (amplitude ${f1((a.bassin.max - a.bassin.min) * 100)} cm)  ·  ` +
      `vitesse angulaire max ${f1(a.omegaMax)} °/s, moyenne ${f1(a.omegaMoy)} °/s  ·  ` +
      `${clip.boucle ? 'clip BOUCLÉ' : 'clip non bouclé'}` +
      (a.penetration < -0.005 ? `  ·  ATTENTION : pénétration de ${f1(-a.penetration * 100)} cm sous le sol` : ''),
  ], W, MG)
  const H = entete.hauteur + hAppui * 2 + hBassin + hPieds + hOmega + ECART * 5 + hPied + 18
  const toile = new Toile(W, H, COULEURS.fond)
  enteteCommune(toile, MG, entete)

  const X = (t) => MG + LG + (t / clip.duree) * wt
  let y = entete.hauteur
  const grilleTemps = (yy, hh) => {
    const pas = clip.duree > 4 ? 0.5 : clip.duree > 1.6 ? 0.2 : 0.1
    for (let t = 0; t <= clip.duree + 1e-9; t += pas) {
      const x = X(t)
      toile.rect(x, yy, 1, hh, COULEURS.grille, 0.8)
    }
  }

  // ── Appuis ────────────────────────────────────────────────────────────────
  for (const [c, nom, coul] of [['g', 'appui pied GAUCHE', COULEURS.gauche], ['d', 'appui pied DROIT', COULEURS.droite]]) {
    piste(toile, MG + LG, y, wt, hAppui, '', '')
    grilleTemps(y + 1, hAppui - 2)
    toile.texte(MG, y + hAppui / 2 - 4, nom, COULEURS.encre, 1)
    let i = 0
    let total = 0
    while (i < a.n) {
      if (!a.appui[c][i]) { i++; continue }
      let j = i
      while (j + 1 < a.n && a.appui[c][j + 1]) j++
      const x0 = X(a.t[i]), x1 = X(a.t[j])
      toile.rect(x0, y + 5, Math.max(2, x1 - x0), hAppui - 10, coul, 0.85)
      total += a.t[j] - a.t[i]
      i = j + 1
    }
    const pc = (total / clip.duree) * 100
    toile.texteFond(MG + LG + wt - 8, y + hAppui - 15, `${pc.toFixed(0)} % du cycle au sol`,
      COULEURS.encre, 1, COULEURS.fondCellule, 'd')
    y += hAppui + ECART
  }

  // ── Hauteur du bassin ─────────────────────────────────────────────────────
  {
    piste(toile, MG + LG, y, wt, hBassin, 'hauteur du bassin (cm)',
      `min ${f1(a.bassin.min * 100)}  max ${f1(a.bassin.max * 100)}  amplitude ${f1((a.bassin.max - a.bassin.min) * 100)} cm`)
    grilleTemps(y + 1, hBassin - 2)
    toile.texte(MG, y + hBassin / 2 - 4, 'BASSIN', COULEURS.encre, 1)
    const lo = a.bassin.min - (a.bassin.max - a.bassin.min) * 0.25 - 0.005
    const hi = a.bassin.max + (a.bassin.max - a.bassin.min) * 0.25 + 0.005
    const Y = (v) => y + hBassin - 14 - ((v - lo) / (hi - lo)) * (hBassin - 30)
    for (const v of [a.bassin.min, a.bassin.max]) {
      toile.segmentPointille(MG + LG + 1, Y(v), MG + LG + wt - 1, Y(v), COULEURS.grilleForte, 1, 4, 4)
      toile.texte(MG + LG + 4, Y(v) - 9, `${f1(v * 100)}`, COULEURS.encreDouce, 1)
    }
    const pts = []
    for (let i = 0; i < a.n; i++) pts.push([X(a.t[i]), Y(a.hauteurBassin[i])])
    toile.clip(MG + LG, y, wt, hBassin)
    toile.polyligne(pts, COULEURS.bassin, 2.2)
    toile.sansClip()
    y += hBassin + ECART
  }

  // ── Hauteur des pieds ─────────────────────────────────────────────────────
  {
    piste(toile, MG + LG, y, wt, hPieds, 'hauteur de la semelle, sol = 0 (cm)',
      `seuil d'appui ${f1(a.seuilAppui * 100)}  ·  levée max ${f1(a.leveeMax * 100)}` +
      (a.penetration < -0.005 ? `  ·  pénétration ${f1(-a.penetration * 100)} cm` : ''))
    grilleTemps(y + 1, hPieds - 2)
    toile.texte(MG, y + hPieds / 2 - 4, 'PIEDS', COULEURS.encre, 1)
    const lo = Math.min(a.penetration, 0) - 0.012
    const hi = Math.max(a.leveeMax, 0.03) * 1.2
    const Y = (v) => y + hPieds - 14 - ((v - lo) / (hi - lo)) * (hPieds - 30)
    // Sous le sol : une zone teintée. Un pied qui passe dessous n'est pas une
    // nuance de courbe, c'est un défaut, et il doit sauter aux yeux.
    const ySol = Y(0)
    if (ySol < y + hPieds - 2) {
      toile.rect(MG + LG + 1, ySol, wt - 2, Math.min(y + hPieds - 1, Y(lo)) - ySol, COULEURS.alerte, 0.10)
      toile.texte(MG + LG + 6, Math.min(y + hPieds - 12, ySol + 3), 'sous le sol', COULEURS.alerte, 1)
    }
    toile.segment(MG + LG + 1, ySol, MG + LG + wt - 1, ySol, COULEURS.sol, 1.8)
    toile.texteFond(MG + LG + wt - 8, ySol - 10, 'sol (y = 0)', COULEURS.sol, 1, COULEURS.fondCellule, 'd')
    toile.clip(MG + LG, y, wt, hPieds)
    for (const [c, coul] of [['g', COULEURS.gauche], ['d', COULEURS.droite]]) {
      const pts = []
      for (let i = 0; i < a.n; i++) pts.push([X(a.t[i]), Y(a.basPied[c][i])])
      toile.polyligne(pts, coul, 2.2)
    }
    toile.sansClip()
    y += hPieds + ECART
  }

  // ── Vitesse angulaire ─────────────────────────────────────────────────────
  {
    piste(toile, MG + LG, y, wt, hOmega, 'vitesse angulaire — le plus rapide des os majeurs (°/s)',
      `max ${f1(a.omegaMax)}  ·  moyenne ${f1(a.omegaMoy)}`)
    grilleTemps(y + 1, hOmega - 2)
    toile.texte(MG, y + hOmega / 2 - 4, 'À-COUPS', COULEURS.encre, 1)
    const hi = Math.max(a.omegaMax * 1.15, 30)
    const Y = (v) => y + hOmega - 12 - (v / hi) * (hOmega - 28)
    const seuil = a.omegaMoy * 3
    if (seuil < hi) {
      toile.segmentPointille(MG + LG + 1, Y(seuil), MG + LG + wt - 1, Y(seuil), COULEURS.alerte, 1, 4, 4)
      toile.texte(MG + LG + 4, Y(seuil) - 9, `3 × la moyenne (${f1(seuil)} °/s) — au-dessus, ça se voit`, COULEURS.alerte, 1)
    }
    const pts = []
    for (let i = 0; i < a.n; i++) pts.push([X(a.t[i]), Y(a.omega[i])])
    toile.clip(MG + LG, y, wt, hOmega)
    toile.polyligne(pts, COULEURS.encre, 1.8)
    toile.sansClip()
    y += hOmega + ECART
  }

  // ── Axe du temps ──────────────────────────────────────────────────────────
  {
    const pas = clip.duree > 4 ? 0.5 : clip.duree > 1.6 ? 0.2 : 0.1
    toile.rect(MG + LG, y, wt, 1, COULEURS.encre)
    for (let t = 0; t <= clip.duree + 1e-9; t += pas) {
      const x = X(t)
      toile.rect(x, y, 1, 5, COULEURS.encre)
      toile.texte(x, y + 7, t.toFixed(t < 1 || pas < 0.5 ? 2 : 1), COULEURS.encre, 1, 'c')
    }
    toile.texte(MG + LG + wt, y + 7, 'temps (s) →', COULEURS.encre, 1, 'd')
    toile.texte(MG, y + 7, `0 → ${f3(clip.duree)} s`, COULEURS.encreDouce, 1)
  }

  const yp = H - hPied + 6
  toile.rect(0, H - hPied, W, hPied, COULEURS.fondAlterne)
  toile.rect(0, H - hPied, W, 2, COULEURS.grilleForte)
  let x = MG
  x = pastille(toile, x, yp, COULEURS.gauche, 'gauche')
  x = pastille(toile, x, yp, COULEURS.droite, 'droite')
  x = pastille(toile, x, yp, COULEURS.bassin, 'bassin')
  // Le rappel de lecture dépend de la famille du clip : conseiller de chercher
  // l'alternance des appuis sur un clip assis serait un contresens.
  const famille = clip.meta?.famille ?? ''
  const rappel = famille === 'allure' || /walk|jog|run|strafe|step|turn/.test(clip.slug)
    ? 'un cycle de marche sain : les deux barres d’appui alternent et se chevauchent brièvement (double appui) ; le bassin fait DEUX creux par cycle'
    : /sit-enter|sit-exit/.test(clip.slug)
      ? 'une transition assise saine : les pieds restent au sol, le bassin descend (ou monte) sans à-coup, la vitesse angulaire reste continue'
      : 'clip immobile ou gestuel : appuis pleins d’un bout à l’autre, bassin presque plat ; tout pic isolé de vitesse angulaire est un à-coup à regarder'
  toile.texte(x, yp, rappel, COULEURS.encreDouce, 1)

  if (sortie) { fs.mkdirSync(path.dirname(sortie), { recursive: true }); toile.ecrire(sortie) }
  return { toile, analyse: a, sortie }
}
