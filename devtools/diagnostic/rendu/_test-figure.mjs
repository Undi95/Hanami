import * as S from './scene.mjs'
import * as F from './figure.mjs'
import { Toile, COULEURS } from './png.mjs'

const m = S.chargerModele(S.resoudreModele('sakura'), { maillage: true })
const c = await S.chargerClip(m, process.argv[3] || 'world-walk')
const t = Number(process.argv[4] ?? 0.25)

const os0 = S.appliquer(m, c.ech(0))
S.deformer(m)
const ep = F.mesurerEpaisseurs(m, os0)
console.log('épaisseurs mesurées (m) :', [...ep].map(([k, v]) => `${k}=${v.toFixed(3)}`).join(' '))

const W = 320, H = 420
const toile = new Toile(W * 3 + 40, H + 40, COULEURS.fond)
const vues = ['face', 'profil', 'dessus']
let x = 10
for (const nv of vues) {
  const vue = F.VUES[nv]
  const osM = S.appliquer(m, c.ech(t))
  const cad = new F.Cadrage(vue, [F.boiteDe(vue, osM)], W, H)
  toile.rect(x, 20, W, H, COULEURS.fondCellule)
  F.dessinerRepere(toile, x, 20, cad)
  const t0 = Date.now()
  F.dessinerCorps(toile, x, 20, cad, m)
  F.dessinerOs(toile, x, 20, cad, osM, ep)
  console.log(nv, Date.now() - t0, 'ms')
  toile.cadre(x, 20, W, H, COULEURS.grilleForte, 1)
  toile.texte(x + 4, 6, `${nv} — ${c.slug} t=${t.toFixed(2)}s`, COULEURS.encre, 1)
  x += W + 10
}
toile.ecrire(process.argv[2])
console.log('écrit', process.argv[2])
