// ════════════════════════════════════════════════════════════════════════════
// figure.mjs — DESSINER UNE PERSONNE RECONNAISSABLE.
//
// Le critère n'est pas « le tracé est-il exact » mais « un lecteur reconnaît-il
// une personne et comprend-il ce qu'elle fait ». D'où trois couches superposées,
// chacune répondant à un défaut de la précédente :
//
//   1. LE CORPS — le maillage réellement déformé par le squelette, aplati en
//      gris clair avec un ombrage doux. C'est lui qui dit « personne » en un
//      coup d'œil, avec ses vraies proportions, ses cheveux et ses vêtements.
//   2. LE TRAIT — un contour sombre, tiré non seulement de la silhouette mais
//      aussi des RUPTURES DE PROFONDEUR. Sans lui, un bras devant le torse
//      disparaît dans le gris ; avec lui, il se détache comme dans un dessin.
//   3. LES OS — le squelette par-dessus, en trait épais, GAUCHE en bleu et
//      DROITE en orange. C'est ce qui lève l'ambiguïté qu'aucun rendu ne lève :
//      quelle jambe est devant, quelle main est fermée.
//
// Les couches 1 et 2 peuvent être coupées (--maillage=0) : le squelette seul
// suffit à juger une trajectoire, et il est dix fois plus rapide.
// ════════════════════════════════════════════════════════════════════════════

import { COULEURS, clair } from './png.mjs'
import { THREE, deformer } from './scene.mjs'

// ── Vues ────────────────────────────────────────────────────────────────────
//
// u = axe horizontal de l'image (vers la droite), v = axe vertical (vers le
// HAUT), d = axe de profondeur (plus grand = plus près de l'œil).
//
// « profil » regarde depuis le côté DROIT du personnage : comme il fait face au
// +Z, il regarde donc vers la droite de l'image, ce qui est la convention de
// tout banc d'animation. « dessus » place l'AVANT vers le haut de l'image, œil
// au-dessus et derrière : la droite du personnage est à droite de l'image.
export const VUES = {
  face: {
    nom: 'face', titre: 'de face', u: [1, 0, 0], v: [0, 1, 0], d: [0, 0, 1],
    axeU: '+X (gauche du perso →)', axeV: '+Y hauteur', sol: true,
  },
  profil: {
    nom: 'profil', titre: 'de profil, côté droit',
    u: [0, 0, 1], v: [0, 1, 0], d: [-1, 0, 0],
    axeU: '+Z avant → (le perso regarde à droite)', axeV: '+Y hauteur ↑', sol: true,
  },
  dessus: {
    nom: 'dessus', titre: 'de dessus, avant vers le haut',
    u: [-1, 0, 0], v: [0, 0, 1], d: [0, 1, 0],
    axeU: '−X → (droite du perso)', axeV: '+Z avant ↑', sol: false,
  },
}
export const NOMS_VUES = Object.keys(VUES)

// ── Squelette de dessin ─────────────────────────────────────────────────────
// Chaînes d'os telles qu'un anatomiste les tracerait. `cote` porte la couleur.
export const CHAINES = [
  { os: ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head'], cote: 'c', ep: 1.0 },
  { os: ['leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'], cote: 'g', ep: 0.72 },
  { os: ['rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'], cote: 'd', ep: 0.72 },
  { os: ['hips', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes'], cote: 'g', ep: 0.85 },
  { os: ['hips', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'], cote: 'd', ep: 0.85 },
]
const DOIGTS_NOMS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little']
const DOIGTS_SEG = ['Proximal', 'Intermediate', 'Distal']
export const DOIGTS = ['left', 'right'].flatMap((c) =>
  DOIGTS_NOMS.map((d) => ({
    cote: c === 'left' ? 'g' : 'd',
    os: [c + 'Hand', ...DOIGTS_SEG.map((s) => c + d + s)],
  })),
)
/** Ligne des épaules et du bassin : sans elles, un tronc n'a pas de largeur. */
export const TRAVERSES = [
  ['leftUpperLeg', 'rightUpperLeg'],
  ['leftShoulder', 'rightShoulder'],
  ['leftUpperArm', 'rightUpperArm'],
]

const couleurCote = (c) => (c === 'g' ? COULEURS.gauche : c === 'd' ? COULEURS.droite : COULEURS.tronc)

// ── Épaisseurs mesurées sur le modèle ───────────────────────────────────────

/**
 * Épaisseur de chaque os, MESURÉE sur le maillage au repos : distance
 * perpendiculaire des sommets que l'os domine, au 75ᵉ centile (la queue de
 * distribution, ce sont les cheveux et les pans de jupe — on ne veut pas d'un
 * bras aussi épais qu'une robe). À défaut de maillage, on retombe sur des
 * fractions de la hauteur de hanches, qui sont raisonnables pour tout humanoïde.
 */
export function mesurerEpaisseurs(modele, osMonde) {
  const H = modele.hanchesRepos
  const defaut = {
    hips: 0.105, spine: 0.10, chest: 0.105, upperChest: 0.105, neck: 0.045, head: 0.105,
    leftShoulder: 0.05, rightShoulder: 0.05, leftUpperArm: 0.042, rightUpperArm: 0.042,
    leftLowerArm: 0.035, rightLowerArm: 0.035, leftHand: 0.035, rightHand: 0.035,
    leftUpperLeg: 0.062, rightUpperLeg: 0.062, leftLowerLeg: 0.05, rightLowerLeg: 0.05,
    leftFoot: 0.04, rightFoot: 0.04, leftToes: 0.03, rightToes: 0.03,
  }
  // Les valeurs ci-dessus sont des demi-épaisseurs en mètres pour une hauteur de
  // hanches de 0,95 m ; on les remet à l'échelle du modèle.
  const ep = new Map()
  for (const [k, v] of Object.entries(defaut)) ep.set(k, v * (H / 0.95))
  ep.set('tete', 0.115 * (H / 0.95))

  if (!modele.peaux) return ep

  // Nœud de peau → os humanoïde le plus proche en remontant la hiérarchie.
  const versOs = new Map()
  for (const os of modele.adapt.osTous) {
    const n = modele.adapt.noeudBrut(os)
    if (n) versOs.set(n, os)
  }
  const osDuNoeud = (n) => {
    let c = n, garde = 0
    while (c && garde++ < 64) { const o = versOs.get(c); if (o) return o; c = c.parent }
    return null
  }
  // Segment de chaque os (os → premier enfant tracé), en pose de repos.
  const enfantDe = new Map()
  for (const ch of CHAINES) {
    for (let i = 0; i + 1 < ch.os.length; i++) if (!enfantDe.has(ch.os[i])) enfantDe.set(ch.os[i], ch.os[i + 1])
  }
  const dists = new Map()
  const P = modele.peaux
  const tmp = new THREE.Vector3()
  for (const prim of P.primitives) {
    if (!prim.jnt || prim.skin == null) continue
    const joints = P.skins[prim.skin].joints
    for (let i = 0; i < prim.nv; i++) {
      let meilleur = 0, jm = -1
      for (let c = 0; c < 4; c++) {
        const w = prim.poids[i * 4 + c]
        if (w > meilleur) { meilleur = w; jm = prim.jnt[i * 4 + c] }
      }
      if (jm < 0) continue
      const os = osDuNoeud(P.objs[joints[jm]])
      if (!os) continue
      const a = osMonde.get(os)
      if (!a) continue
      tmp.set(prim.sortie[i * 3], prim.sortie[i * 3 + 1], prim.sortie[i * 3 + 2])
      const enf = enfantDe.get(os)
      const b = enf ? osMonde.get(enf) : null
      let d
      if (b) {
        const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z
        const l2 = abx * abx + aby * aby + abz * abz
        let t = l2 > 0 ? ((tmp.x - a.x) * abx + (tmp.y - a.y) * aby + (tmp.z - a.z) * abz) / l2 : 0
        t = t < 0 ? 0 : t > 1 ? 1 : t
        d = Math.hypot(tmp.x - (a.x + abx * t), tmp.y - (a.y + aby * t), tmp.z - (a.z + abz * t))
      } else d = tmp.distanceTo(a)
      let l = dists.get(os)
      if (!l) { l = []; dists.set(os, l) }
      l.push(d)
    }
  }
  for (const [os, l] of dists) {
    if (l.length < 24) continue
    l.sort((a, b) => a - b)
    const r = l[Math.floor(l.length * 0.75)]
    if (isFinite(r) && r > 0) ep.set(os, Math.max(r, 0.012 * (H / 0.95)))
  }
  // La tête ne se mesure PAS sur les sommets qu'elle porte : sur un modèle de
  // ce genre, les cheveux pèsent plus lourd que le crâne et donnent un rayon de
  // 17 cm — une tête de deux fois trop grosse. Les os des YEUX, eux, sont au
  // centre du crâne quoi qu'il arrive : leur distance à l'atlas donne un rayon
  // fiable sur n'importe quel modèle.
  const oe = ['leftEye', 'rightEye'].map((k) => osMonde.get(k)).filter(Boolean)
  const tete = osMonde.get('head')
  if (oe.length === 2 && tete) {
    const c = oe[0].clone().add(oe[1]).multiplyScalar(0.5)
    const r = c.distanceTo(tete) * 1.28
    if (isFinite(r) && r > 0.03 * (H / 0.95)) ep.set('tete', r)
  }
  return ep
}

// ── Cadrage ─────────────────────────────────────────────────────────────────

/** Projette un point monde dans le plan de la vue : { u, v, d }. */
export function projeterVue(vue, p) {
  return {
    u: p.x * vue.u[0] + p.y * vue.u[1] + p.z * vue.u[2],
    v: p.x * vue.v[0] + p.y * vue.v[1] + p.z * vue.v[2],
    d: p.x * vue.d[0] + p.y * vue.d[1] + p.z * vue.d[2],
  }
}

/**
 * Cadrage COMMUN à toutes les cases d'une planche.
 * C'est le point capital : si chaque case se recadrait sur sa propre pose, le
 * mouvement disparaîtrait de la planche — un personnage qui monte et un
 * personnage immobile donneraient exactement la même suite d'images.
 */
export class Cadrage {
  constructor(vue, boites, largeur, hauteur, { marge = 14, forcerSol = true } = {}) {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
    for (const b of boites) {
      if (b.u0 < u0) u0 = b.u0
      if (b.u1 > u1) u1 = b.u1
      if (b.v0 < v0) v0 = b.v0
      if (b.v1 > v1) v1 = b.v1
    }
    if (vue.sol && forcerSol) v0 = Math.min(v0, 0) // le sol doit être dans l'image
    // Un peu d'air, proportionnel à la taille du sujet.
    const au = (u1 - u0) * 0.06 + 0.02, av = (v1 - v0) * 0.05 + 0.02
    u0 -= au; u1 += au; v0 -= av * 0.4; v1 += av
    this.vue = vue
    this.largeur = largeur
    this.hauteur = hauteur
    const su = (largeur - 2 * marge) / Math.max(1e-6, u1 - u0)
    const sv = (hauteur - 2 * marge) / Math.max(1e-6, v1 - v0)
    this.echelle = Math.min(su, sv) // px par mètre — identique dans les deux axes
    this.cu = (u0 + u1) / 2
    this.cv = (v0 + v1) / 2
    this.u0 = u0; this.u1 = u1; this.v0 = v0; this.v1 = v1
    // Pas de grille choisi pour donner des lignes tous les ~45 px : à un
    // cadrage rapproché, une grille de 25 cm ne montre plus rien.
    this.pasGrille = [0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2]
      .find((p) => p * this.echelle >= 42) ?? 2
  }
  /** Point monde → pixel, relatif au coin haut-gauche de la case. */
  px(p) {
    const q = projeterVue(this.vue, p)
    return [
      this.largeur / 2 + (q.u - this.cu) * this.echelle,
      this.hauteur / 2 - (q.v - this.cv) * this.echelle,
      q.d,
    ]
  }
  /** Ordonnée v (mètres) → ligne de pixels. */
  ligneDe(v) { return this.hauteur / 2 - (v - this.cv) * this.echelle }
  /** Abscisse u (mètres) → colonne de pixels. */
  colonneDe(u) { return this.largeur / 2 + (u - this.cu) * this.echelle }
}

/**
 * CADRAGE SUR CE QUI BOUGE.
 *
 * Un clip où seule la tête remue (`nod`) cadré sur le corps entier donne douze
 * cases rigoureusement identiques : la planche est juste, et elle n'apprend
 * rien. Il faut donc trouver la partie du corps qui porte le mouvement et
 * cadrer dessus.
 *
 * Méthode : amplitude de chaque os (écart max à sa position moyenne) ; on garde
 * ceux qui dépassent une fraction du plus mobile ; on prend leur boîte, élargie
 * vers le BAS pour garder les épaules ou le bassin sous les yeux — un gros plan
 * sans contexte est aussi illisible qu'un plan large sans détail.
 *
 * Rend `null` quand le mouvement est réparti sur tout le corps (une marche) ou
 * quand il n'y a aucun mouvement (un socle) : dans les deux cas le plan large
 * est le bon.
 *
 * @param {object[]} suites  liste de Map<os, Vector3>, une par pose
 */
export function boiteMobile(vue, suites, opts = {}) {
  const { seuilRelatif = 0.25, seuilAbsolu = 0.01, contexteBas = 0.5, marge = 0.05 } = opts
  if (suites.length < 2) return null
  const noms = [...suites[0].keys()].filter((o) => !/Thumb|Index|Middle|Ring|Little|Eye/.test(o))
  const ampl = new Map()
  for (const os of noms) {
    let cx = 0, cy = 0, cz = 0, n = 0
    for (const s of suites) { const p = s.get(os); if (p) { cx += p.x; cy += p.y; cz += p.z; n++ } }
    if (!n) continue
    cx /= n; cy /= n; cz /= n
    let m = 0
    for (const s of suites) {
      const p = s.get(os)
      if (p) m = Math.max(m, Math.hypot(p.x - cx, p.y - cy, p.z - cz))
    }
    ampl.set(os, m)
  }
  const amplMax = Math.max(0, ...ampl.values())
  if (amplMax < seuilAbsolu) return null // rien ne bouge : plan large
  const mobiles = [...ampl].filter(([, v]) => v >= Math.max(amplMax * seuilRelatif, seuilAbsolu)).map(([k]) => k)
  if (!mobiles.length) return null

  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
  let U0 = Infinity, U1 = -Infinity, V0 = Infinity, V1 = -Infinity
  for (const s of suites) {
    for (const [os, p] of s) {
      const q = projeterVue(vue, p)
      if (q.u < U0) U0 = q.u
      if (q.u > U1) U1 = q.u
      if (q.v < V0) V0 = q.v
      if (q.v > V1) V1 = q.v
      if (!mobiles.includes(os)) continue
      if (q.u < u0) u0 = q.u
      if (q.u > u1) u1 = q.u
      if (q.v < v0) v0 = q.v
      if (q.v > v1) v1 = q.v
    }
  }
  if (!isFinite(u0)) return null
  const h = v1 - v0, l = u1 - u0
  // Le plan rapproché ne vaut que s'il gagne vraiment de la place.
  if (h > (V1 - V0) * 0.62 && l > (U1 - U0) * 0.62) return null
  const cote = Math.max(h, l, 0.12)
  return {
    boite: {
      u0: u0 - marge - cote * 0.12, u1: u1 + marge + cote * 0.12,
      v0: Math.max(V0, v0 - marge - cote * contexteBas), v1: v1 + marge + cote * 0.12,
    },
    mobiles,
    amplitudeMax: amplMax,
  }
}

/** Boîte englobante (u,v) d'un jeu de positions d'os, marge comprise. */
export function boiteDe(vue, osMonde, marge = 0.12) {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
  for (const p of osMonde.values()) {
    const q = projeterVue(vue, p)
    if (q.u < u0) u0 = q.u
    if (q.u > u1) u1 = q.u
    if (q.v < v0) v0 = q.v
    if (q.v > v1) v1 = q.v
  }
  return { u0: u0 - marge, u1: u1 + marge, v0: v0 - marge * 0.35, v1: v1 + marge }
}

// ── Rendu du maillage ───────────────────────────────────────────────────────

/**
 * Tampon de rasterisation d'une case : couleur + profondeur, suréchantillonné.
 * Le suréchantillonnage 2× n'est pas de la coquetterie : sans lui, à 300 px de
 * haut, les doigts et le nez deviennent des escaliers.
 */
export class TamponMaillage {
  constructor(w, h, ss = 2) {
    this.w = w; this.h = h; this.ss = ss
    this.W = w * ss; this.H = h * ss
    this.col = new Float32Array(this.W * this.H * 3)
    this.z = new Float32Array(this.W * this.H)
    this.effacer()
  }
  effacer() { this.col.fill(0); this.z.fill(-Infinity) }

  /** Triangle plein avec test de profondeur (d croissant = plus près). */
  triangle(x0, y0, d0, x1, y1, d1, x2, y2, d2, c) {
    const { W, H, col, z } = this
    const minx = Math.max(0, Math.floor(Math.min(x0, x1, x2)))
    const maxx = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)))
    const miny = Math.max(0, Math.floor(Math.min(y0, y1, y2)))
    const maxy = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)))
    if (minx > maxx || miny > maxy) return
    const aire = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
    if (Math.abs(aire) < 1e-9) return
    const inv = 1 / aire
    for (let y = miny; y <= maxy; y++) {
      const py = y + 0.5
      for (let x = minx; x <= maxx; x++) {
        const px = x + 0.5
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * inv
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * inv
        const w2 = 1 - w0 - w1
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue
        const dd = w0 * d0 + w1 * d1 + w2 * d2
        const k = y * W + x
        if (dd <= z[k]) continue
        z[k] = dd
        col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2]
      }
    }
  }

  /**
   * Réduit à la résolution de la case et compose dans la toile, en traçant le
   * CONTOUR : bord de silhouette, et surtout ruptures de profondeur internes —
   * c'est ce qui détache un bras posé devant le torse.
   */
  composer(toile, ox, oy, { contour = COULEURS.contour, seuil = 0.03 } = {}) {
    const { w, h, ss, W, col, z } = this
    const n = ss * ss
    const cz = new Float32Array(w * h)
    const cc = new Float32Array(w * h * 3)
    const cv = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, zz = -Infinity, cnt = 0
        for (let j = 0; j < ss; j++) {
          for (let i = 0; i < ss; i++) {
            const k = (y * ss + j) * W + (x * ss + i)
            if (z[k] === -Infinity) continue
            r += col[k * 3]; g += col[k * 3 + 1]; b += col[k * 3 + 2]
            if (z[k] > zz) zz = z[k]
            cnt++
          }
        }
        const q = y * w + x
        cz[q] = zz
        cv[q] = cnt / n
        if (cnt) { cc[q * 3] = r / cnt; cc[q * 3 + 1] = g / cnt; cc[q * 3 + 2] = b / cnt }
      }
    }
    // Couche 1 : le corps.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const q = y * w + x
        if (cv[q] <= 0) continue
        toile.mel(ox + x, oy + y, [cc[q * 3], cc[q * 3 + 1], cc[q * 3 + 2]], cv[q])
      }
    }
    // Couche 2 : le trait.
    if (!contour) return { cz, cv }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const q = y * w + x
        const dedans = cv[q] > 0.35
        let bord = false
        if (dedans) {
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) { bord = true; break }
            const r = ny * w + nx
            if (cv[r] <= 0.35) { bord = true; break }
            if (cz[q] - cz[r] > seuil) { bord = true; break } // rupture de profondeur
          }
        }
        if (bord) toile.mel(ox + x, oy + y, contour, 1)
      }
    }
    return { cz, cv }
  }
}

/** Direction de lumière exprimée dans le repère de la vue : haut-gauche-avant. */
function lumiere(vue) {
  const L = [0, 0, 0]
  for (let i = 0; i < 3; i++) L[i] = -0.38 * vue.u[i] + 0.52 * vue.v[i] + 0.76 * vue.d[i]
  const n = Math.hypot(L[0], L[1], L[2])
  return [L[0] / n, L[1] / n, L[2] / n]
}

/**
 * Dessine le CORPS (maillage déformé) dans la case. Le rig doit déjà être posé.
 * Rend le couple { profondeur, couverture } dont le squelette se sert pour
 * savoir quels os sont cachés.
 */
export function dessinerCorps(toile, ox, oy, cadrage, modele, { ss = 2, teinte = COULEURS.corps } = {}) {
  const prims = deformer(modele)
  if (!prims) return null
  const t = new TamponMaillage(cadrage.largeur, cadrage.hauteur, ss)
  const vue = cadrage.vue
  const L = lumiere(vue)
  const s = cadrage.echelle * ss
  const cx = (cadrage.largeur * ss) / 2, cy = (cadrage.hauteur * ss) / 2
  const U = vue.u, V = vue.v, D = vue.d
  for (const prim of prims) {
    const { sortie, tri, clarte } = prim
    const nv = prim.nv
    // Projection de tous les sommets une fois pour toutes.
    const px = new Float32Array(nv), py = new Float32Array(nv), pd = new Float32Array(nv)
    for (let i = 0; i < nv; i++) {
      const x = sortie[i * 3], y = sortie[i * 3 + 1], z = sortie[i * 3 + 2]
      const u = x * U[0] + y * U[1] + z * U[2]
      const v = x * V[0] + y * V[1] + z * V[2]
      px[i] = cx + (u - cadrage.cu) * s
      py[i] = cy - (v - cadrage.cv) * s
      pd[i] = x * D[0] + y * D[1] + z * D[2]
    }
    const base = [teinte[0] * (0.55 + 0.45 * clarte), teinte[1] * (0.55 + 0.45 * clarte), teinte[2] * (0.55 + 0.45 * clarte)]
    for (let f = 0; f < tri.length; f += 3) {
      const a = tri[f], b = tri[f + 1], c = tri[f + 2]
      // Normale de face, dans le monde (l'ombrage plat suffit et évite de
      // déformer aussi les normales à chaque image).
      const ax = sortie[b * 3] - sortie[a * 3], ay = sortie[b * 3 + 1] - sortie[a * 3 + 1], az = sortie[b * 3 + 2] - sortie[a * 3 + 2]
      const bx = sortie[c * 3] - sortie[a * 3], by = sortie[c * 3 + 1] - sortie[a * 3 + 1], bz = sortie[c * 3 + 2] - sortie[a * 3 + 2]
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx
      const nl = Math.hypot(nx, ny, nz)
      if (nl < 1e-12) continue
      nx /= nl; ny /= nl; nz /= nl
      // Face tournée à l'opposé de l'œil : on retourne la normale plutôt que de
      // l'écarter — beaucoup de VRM ont un enroulement incohérent.
      if (nx * D[0] + ny * D[1] + nz * D[2] < 0) { nx = -nx; ny = -ny; nz = -nz }
      const lam = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2])
      const k = 0.54 + 0.46 * lam
      t.triangle(px[a], py[a], pd[a], px[b], py[b], pd[b], px[c], py[c], pd[c],
        [base[0] * k, base[1] * k, base[2] * k])
    }
  }
  return t.composer(toile, ox, oy, { seuil: 0.028 })
}

// ── Rendu du squelette ──────────────────────────────────────────────────────

/**
 * Dessine les os. DEUX STYLES, et la distinction est tout l'enjeu :
 *
 *   'calque' — par-dessus le corps. Le trait est alors une ANNOTATION : sa
 *     largeur est fixée en PIXELS (proportionnelle à la case, jamais à
 *     l'anatomie), sinon un bras large de 9 cm couvre le bras qu'il annote et
 *     on a perdu le corps qu'on venait de calculer. La tête est un CERCLE VIDE,
 *     pour la même raison.
 *   'plein' — sans corps. Le trait reprend alors l'épaisseur MESURÉE du membre,
 *     et la tête est pleine : c'est la figure qui doit, seule, ressembler à
 *     quelqu'un.
 *
 * `attenue` (0..1) sert à la pelure d'oignon : la pose précédente en gris pâle.
 */
export function dessinerOs(toile, ox, oy, cadrage, osMonde, ep, opts = {}) {
  const {
    style = 'calque', attenue = 0, doigts = true, articulations = true, tete = true,
    epaisseurTrait = 1, opacite = 1,
  } = opts
  const s = cadrage.echelle
  const plein = style === 'plein'
  // Trait de référence : en pixels pour le calque, anatomique pour la figure seule.
  const base = Math.max(1.8, cadrage.hauteur / 135) * epaisseurTrait
  const largeurOs = (os, facteur) =>
    plein
      ? Math.max(2, (ep.get(os) ?? 0.045) * 2 * s * facteur * 0.92 * epaisseurTrait)
      : Math.max(1.6, base * facteur)

  const ops = []
  const pousser = (a, b, coul, larg) => {
    const A = cadrage.px(a), B = cadrage.px(b)
    ops.push({ z: (A[2] + B[2]) / 2, f: () => toile.segment(ox + A[0], oy + A[1], ox + B[0], oy + B[1], coul, larg, opacite) })
  }
  const melGris = (c) => (attenue > 0 ? clair(c, attenue) : c)

  for (const t of TRAVERSES) {
    const a = osMonde.get(t[0]), b = osMonde.get(t[1])
    if (a && b) pousser(a, b, melGris(clair(COULEURS.tronc, 0.4)), plein ? Math.max(2, (ep.get('neck') ?? 0.04) * 1.6 * s) : base * 0.75)
  }
  for (const ch of CHAINES) {
    const dispo = ch.os.filter((o) => osMonde.has(o))
    const coul = melGris(couleurCote(ch.cote))
    for (let i = 0; i + 1 < dispo.length; i++) {
      pousser(osMonde.get(dispo[i]), osMonde.get(dispo[i + 1]), coul, largeurOs(dispo[i], ch.ep))
    }
  }
  if (doigts) {
    for (const d of DOIGTS) {
      const dispo = d.os.filter((o) => osMonde.has(o))
      if (dispo.length < 2) continue
      const coul = melGris(couleurCote(d.cote))
      const lg = plein ? Math.max(1.2, (ep.get('leftHand') ?? 0.03) * 0.7 * s) : Math.max(1.1, base * 0.42)
      for (let i = 0; i + 1 < dispo.length; i++) pousser(osMonde.get(dispo[i]), osMonde.get(dispo[i + 1]), coul, lg)
    }
  }
  ops.sort((a, b) => a.z - b.z)
  for (const o of ops) o.f()

  // Tête : posée sur l'axe du cou et non au niveau de l'atlas — l'os « head »
  // est à la base du crâne, y placer le cercle donne un personnage décapité.
  if (tete && osMonde.has('head')) {
    const h = osMonde.get('head')
    const cou = osMonde.get('neck') ?? osMonde.get('upperChest') ?? osMonde.get('chest')
    const r = (ep.get('tete') ?? 0.11) * s
    let c = h
    if (cou) {
      const dir = h.clone().sub(cou)
      if (dir.lengthSq() > 1e-8) c = h.clone().add(dir.normalize().multiplyScalar((ep.get('tete') ?? 0.11) * 0.72))
    }
    const P = cadrage.px(c)
    const coulT = melGris(COULEURS.tete)
    if (plein) toile.disque(ox + P[0], oy + P[1], r, coulT, opacite * 0.95)
    else toile.anneau(ox + P[0], oy + P[1], r, coulT, Math.max(1.2, base * 0.45), opacite * 0.5)
    // Le regard : un ergot vers l'avant du crâne. C'est quelques pixels, et
    // c'est ce qui fait voir instantanément où la tête est tournée.
    const oe = ['leftEye', 'rightEye'].map((k) => osMonde.get(k)).filter(Boolean)
    if (oe.length === 2) {
      const av = oe[0].clone().add(oe[1]).multiplyScalar(0.5).sub(c)
      if (av.lengthSq() > 1e-9) {
        const A = cadrage.px(c.clone().add(av.clone().normalize().multiplyScalar((ep.get('tete') ?? 0.11) * 0.55)))
        const B = cadrage.px(c.clone().add(av.normalize().multiplyScalar((ep.get('tete') ?? 0.11) * 1.5)))
        toile.segment(ox + A[0], oy + A[1], ox + B[0], oy + B[1], coulT, Math.max(1.4, base * 0.7), opacite)
      }
    }
  }
  // Articulations : de petits points sur les os majeurs. Sans eux, une chaîne
  // de segments devient une saucisse dont on ne lit plus les angles.
  if (articulations && attenue === 0) {
    for (const ch of CHAINES) {
      for (const o of ch.os) {
        if (!osMonde.has(o) || o === 'head') continue
        const P = cadrage.px(osMonde.get(o))
        const r = plein ? Math.max(1.4, (ep.get(o) ?? 0.04) * s * 0.4) : Math.max(1.5, base * 0.72)
        toile.disque(ox + P[0], oy + P[1], r, melGris(COULEURS.fondCellule), opacite)
        toile.anneau(ox + P[0], oy + P[1], r, melGris(couleurCote(ch.cote)), Math.max(1, base * 0.35), opacite)
      }
    }
  }
}

/** Repères du sol et graduations, dans une case. */
export function dessinerRepere(toile, ox, oy, cadrage, { pas = cadrage.pasGrille, marquerSol = true } = {}) {
  const { largeur, hauteur, vue } = cadrage
  const v0 = Math.floor(cadrage.v0 / pas) * pas
  for (let v = v0; v <= cadrage.v1 + 1e-9; v += pas) {
    const y = cadrage.ligneDe(v)
    if (y < 1 || y > hauteur - 1) continue
    const sol = vue.sol && Math.abs(v) < 1e-6
    if (sol && marquerSol) toile.rect(ox, oy + y - 1, largeur, 2, COULEURS.sol)
    else toile.rect(ox, oy + y, largeur, 1, COULEURS.grille, 0.75)
  }
  // Axe médian vertical (u = 0) : l'aplomb du personnage.
  const x = cadrage.colonneDe(0)
  if (x > 1 && x < largeur - 1) toile.segmentPointille(ox + x, oy + 2, ox + x, oy + hauteur - 2, COULEURS.grille, 1, 3, 5)
}
