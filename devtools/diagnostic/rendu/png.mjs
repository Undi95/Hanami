// ════════════════════════════════════════════════════════════════════════════
// png.mjs — ÉCRITURE PNG À LA MAIN + TOILE DE DESSIN.
//
// Aucune dépendance n'est permise, et un PNG n'en demande pas : un en-tête
// signature, un bloc IHDR, les lignes de pixels préfixées d'un octet de filtre
// et compressées par zlib.deflateSync, un bloc IEND. Chaque bloc porte son
// CRC-32. Le dépôt a déjà ce précédent (server/api/backup.ts écrit un zip à la
// main), on suit la même méthode.
//
// La Toile porte les primitives dont les planches ont besoin. Deux partis pris :
//   • les traits sont des CAPSULES (segment épais à bouts ronds) remplies par
//     distance au segment, avec un lissage d'un pixel — c'est le seul moyen
//     d'avoir un trait épais lisible à n'importe quel angle sans bibliothèque ;
//   • le texte est rendu en pixels DURS à échelle entière — un texte lissé
//     devient illisible une fois l'image relue, c'est exactement ce qu'on veut
//     éviter.
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs'
import zlib from 'node:zlib'
import * as P from './police.mjs'

// ── PNG ─────────────────────────────────────────────────────────────────────

const TABLE_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = TABLE_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function bloc(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, c])
}

/**
 * Encode un tampon RGB (w·h·3 octets) en PNG couleur 8 bits.
 * Filtre 1 (Sub) sur chaque ligne : sur des images à larges aplats et traits
 * nets, il divise la taille par 3 à 4 face au filtre 0, pour trois lignes de code.
 */
export function encoderPNG(w, h, rgb) {
  const pas = w * 3
  const brut = Buffer.alloc((pas + 1) * h)
  for (let y = 0; y < h; y++) {
    const o = y * (pas + 1)
    brut[o] = 1 // Sub
    const src = y * pas
    for (let x = 0; x < pas; x++) {
      brut[o + 1 + x] = (rgb[src + x] - (x >= 3 ? rgb[src + x - 3] : 0)) & 0xff
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // 8 bits par canal
  ihdr[9] = 2 // couleur vraie (RGB)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr),
    bloc('IDAT', zlib.deflateSync(brut, { level: 9 })),
    bloc('IEND', Buffer.alloc(0)),
  ])
}

// ── Toile ───────────────────────────────────────────────────────────────────

export class Toile {
  constructor(w, h, fond = [255, 255, 255]) {
    this.w = w | 0
    this.h = h | 0
    this.px = Buffer.alloc(this.w * this.h * 3)
    this.sansClip()
    this.remplir(fond)
  }

  /**
   * Restreint TOUT dessin à un rectangle, jusqu'au prochain sansClip().
   *
   * Indispensable dès qu'une planche a plusieurs cases : un membre qui sort du
   * cadre d'une case n'a aucune raison de s'arrêter à sa frontière, et va se
   * dessiner en travers de la case voisine et du bandeau. Le contrôle est posé
   * dans mel(), le seul point par où passe l'écriture d'un pixel — donc toutes
   * les primitives en héritent, y compris celles à écrire plus tard.
   */
  clip(x, y, w, h) {
    this.cx0 = Math.max(0, Math.floor(x))
    this.cy0 = Math.max(0, Math.floor(y))
    this.cx1 = Math.min(this.w, Math.ceil(x + w))
    this.cy1 = Math.min(this.h, Math.ceil(y + h))
  }
  sansClip() { this.cx0 = 0; this.cy0 = 0; this.cx1 = this.w; this.cy1 = this.h }

  remplir(c) {
    for (let i = 0; i < this.w * this.h; i++) {
      this.px[i * 3] = c[0]
      this.px[i * 3 + 1] = c[1]
      this.px[i * 3 + 2] = c[2]
    }
  }

  /** Pose un pixel avec fondu (a ∈ [0,1]). Hors cadre : ignoré. */
  mel(x, y, c, a = 1) {
    if (a <= 0) return
    x |= 0
    y |= 0
    if (x < this.cx0 || y < this.cy0 || x >= this.cx1 || y >= this.cy1) return
    const i = (y * this.w + x) * 3
    if (a >= 1) {
      this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2]
      return
    }
    const b = 1 - a
    this.px[i] = this.px[i] * b + c[0] * a
    this.px[i + 1] = this.px[i + 1] * b + c[1] * a
    this.px[i + 2] = this.px[i + 2] * b + c[2] * a
  }

  lire(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null
    const i = (y * this.w + x) * 3
    return [this.px[i], this.px[i + 1], this.px[i + 2]]
  }

  rect(x, y, w, h, c, a = 1) {
    const x0 = Math.max(0, Math.floor(x)), x1 = Math.min(this.w, Math.ceil(x + w))
    const y0 = Math.max(0, Math.floor(y)), y1 = Math.min(this.h, Math.ceil(y + h))
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) this.mel(i, j, c, a)
  }

  cadre(x, y, w, h, c, ep = 1) {
    this.rect(x, y, w, ep, c)
    this.rect(x, y + h - ep, w, ep, c)
    this.rect(x, y, ep, h, c)
    this.rect(x + w - ep, y, ep, h, c)
  }

  /**
   * Segment épais à bouts ronds. `ep` est la LARGEUR totale du trait.
   * Rempli par distance au segment : lissage d'un pixel sur le bord, donc un
   * trait propre à n'importe quel angle.
   */
  segment(x0, y0, x1, y1, c, ep = 2, a = 1) {
    const r = ep / 2
    const dx = x1 - x0, dy = y1 - y0
    const l2 = dx * dx + dy * dy
    const bx0 = Math.max(0, Math.floor(Math.min(x0, x1) - r - 1))
    const bx1 = Math.min(this.w - 1, Math.ceil(Math.max(x0, x1) + r + 1))
    const by0 = Math.max(0, Math.floor(Math.min(y0, y1) - r - 1))
    const by1 = Math.min(this.h - 1, Math.ceil(Math.max(y0, y1) + r + 1))
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const px = x + 0.5 - x0, py = y + 0.5 - y0
        let t = l2 > 0 ? (px * dx + py * dy) / l2 : 0
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const d = Math.hypot(px - t * dx, py - t * dy)
        const cov = r - d + 0.5
        if (cov > 0) this.mel(x, y, c, Math.min(1, cov) * a)
      }
    }
  }

  /** Segment pointillé — sert aux repères (sol, grilles, os masqués). */
  segmentPointille(x0, y0, x1, y1, c, ep = 1, plein = 4, vide = 4, a = 1) {
    const L = Math.hypot(x1 - x0, y1 - y0)
    if (L < 1e-6) return
    const n = Math.ceil(L / (plein + vide))
    for (let i = 0; i < n; i++) {
      const t0 = (i * (plein + vide)) / L
      const t1 = Math.min(1, (i * (plein + vide) + plein) / L)
      if (t0 >= 1) break
      this.segment(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0, x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1, c, ep, a)
    }
  }

  disque(cx, cy, r, c, a = 1) {
    const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(this.w - 1, Math.ceil(cx + r + 1))
    const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(this.h - 1, Math.ceil(cy + r + 1))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const cov = r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.5
        if (cov > 0) this.mel(x, y, c, Math.min(1, cov) * a)
      }
    }
  }

  anneau(cx, cy, r, c, ep = 1.5, a = 1) {
    const R = r + ep / 2, ri = r - ep / 2
    const x0 = Math.max(0, Math.floor(cx - R - 1)), x1 = Math.min(this.w - 1, Math.ceil(cx + R + 1))
    const y0 = Math.max(0, Math.floor(cy - R - 1)), y1 = Math.min(this.h - 1, Math.ceil(cy + R + 1))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        const cov = Math.min(R - d + 0.5, d - ri + 0.5)
        if (cov > 0) this.mel(x, y, c, Math.min(1, cov) * a)
      }
    }
  }

  /** Polygone convexe ou concave, remplissage par parité (scanline). */
  polygone(pts, c, a = 1) {
    if (pts.length < 3) return
    let miny = Infinity, maxy = -Infinity
    for (const p of pts) { if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1] }
    const y0 = Math.max(0, Math.floor(miny)), y1 = Math.min(this.h - 1, Math.ceil(maxy))
    const xs = []
    for (let y = y0; y <= y1; y++) {
      xs.length = 0
      const cy = y + 0.5
      for (let i = 0, n = pts.length; i < n; i++) {
        const A = pts[i], B = pts[(i + 1) % n]
        if ((A[1] <= cy && B[1] > cy) || (B[1] <= cy && A[1] > cy)) {
          xs.push(A[0] + ((cy - A[1]) / (B[1] - A[1])) * (B[0] - A[0]))
        }
      }
      xs.sort((p, q) => p - q)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(this.w - 1, Math.floor(xs[k + 1] - 0.5))
        for (let x = xa; x <= xb; x++) this.mel(x, y, c, a)
      }
    }
  }

  /** Polyligne épaisse avec jointures (un disque à chaque sommet interne). */
  polyligne(pts, c, ep = 2, a = 1) {
    for (let i = 0; i + 1 < pts.length; i++) {
      this.segment(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], c, ep, a)
    }
  }

  // ── Texte ─────────────────────────────────────────────────────────────────

  /**
   * Écrit `s` avec le coin haut-gauche en (x, y). Pixels durs, échelle entière.
   * `align` : 'g' (gauche, défaut), 'c' (centré sur x), 'd' (droite, fin en x).
   */
  texte(x, y, s, c = [0, 0, 0], echelle = 1, align = 'g') {
    const L = P.largeurTexte(s, echelle)
    let ox = align === 'c' ? Math.round(x - L / 2) : align === 'd' ? Math.round(x - L) : Math.round(x)
    const oy = Math.round(y)
    for (const ch of s) {
      const g = P.glyphe(ch)
      for (let r = 0; r < P.HAUTEUR; r++) {
        const bits = g[r]
        if (!bits) continue
        for (let col = 0; col < P.LARGEUR; col++) {
          if (!(bits & (1 << col))) continue
          this.rect(ox + col * echelle, oy + r * echelle, echelle, echelle, c)
        }
      }
      ox += P.AVANCE * echelle
    }
    return L
  }

  /** Texte sombre posé sur un fond clair semi-opaque : lisible sur n'importe quoi. */
  texteFond(x, y, s, c, echelle, fond, align = 'g', marge = 2) {
    const L = P.largeurTexte(s, echelle)
    const H = P.HAUTEUR * echelle
    const ox = align === 'c' ? Math.round(x - L / 2) : align === 'd' ? Math.round(x - L) : Math.round(x)
    this.rect(ox - marge, y - marge, L + marge * 2, H + marge * 2, fond, 0.85)
    this.texte(ox, y, s, c, echelle, 'g')
    return L
  }

  largeurTexte(s, e = 1) { return P.largeurTexte(s, e) }

  ecrire(chemin) {
    fs.writeFileSync(chemin, encoderPNG(this.w, this.h, this.px))
    return chemin
  }
}

// ── Palette ─────────────────────────────────────────────────────────────────
// Fond clair, traits sombres et épais, aucun dégradé : le cahier des charges.
// Gauche et droite se distinguent par la TEINTE, jamais par la seule clarté,
// pour rester lisible même après une conversion en niveaux de gris.
export const COULEURS = {
  fond: [252, 252, 250],
  fondCellule: [255, 255, 255],
  fondAlterne: [244, 246, 248],
  encre: [22, 26, 32],
  encreDouce: [96, 104, 116],
  grille: [212, 218, 226],
  grilleForte: [172, 180, 192],
  sol: [120, 128, 140],
  gauche: [16, 96, 190], // bleu — côté GAUCHE du personnage
  droite: [206, 62, 16], // orange-rouge — côté DROIT
  axe: [40, 46, 56],
  tronc: [44, 52, 64],
  tete: [30, 36, 46],
  corps: [217, 215, 211], // « argile » du maillage
  contour: [58, 64, 74], // trait de silhouette et de rupture de profondeur
  fantome: [196, 202, 210], // pelure d'oignon
  bassin: [126, 44, 168], // violet
  vert: [22, 132, 72],
  contact: [12, 20, 30],
  alerte: [200, 30, 30],
}

/** Éclaircit une couleur vers le blanc (k ∈ [0,1]). */
export const clair = (c, k) => [c[0] + (255 - c[0]) * k, c[1] + (255 - c[1]) * k, c[2] + (255 - c[2]) * k]
/** Assombrit une couleur (k ∈ [0,1]). */
export const sombre = (c, k) => [c[0] * (1 - k), c[1] * (1 - k), c[2] * (1 - k)]
