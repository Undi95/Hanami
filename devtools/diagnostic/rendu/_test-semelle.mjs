import * as S from './scene.mjs'

const m = S.chargerModele(S.resoudreModele(null), { maillage: true })
S.preparerSemelles(m)
console.log('sommets de semelle : G', m.semelles.g.length / 2, ' D', m.semelles.d.length / 2)

// Pose de repos : la semelle DOIT être à ~0 si le modèle est posé sur le sol.
S.appliquer(m, { q: new Map(), p: m.adapt.reposHips })
let s = S.hauteurSemelles(m)
console.log(`REPOS      semelle G ${(s.g * 100).toFixed(2)} cm  D ${(s.d * 100).toFixed(2)} cm`)

// Boîte englobante complète au repos, pour comparer.
S.deformer(m)
let miny = Infinity
for (const p of m.peaux.primitives) for (let i = 0; i < p.nv; i++) miny = Math.min(miny, p.sortie[i * 3 + 1])
console.log(`REPOS      point le plus bas de TOUT le maillage : ${(miny * 100).toFixed(2)} cm`)

for (const slug of ['idle', 'world-walk', 'world-sit-enter']) {
  const c = await S.chargerClip(m, slug)
  const n = 41
  let bg = Infinity, bd = Infinity, hg = -Infinity, hd = -Infinity
  const lignes = []
  for (let i = 0; i < n; i++) {
    const t = Math.min(c.duree - S.EPS, (i * c.duree) / (n - 1))
    S.appliquer(m, c.ech(t))
    const q = S.hauteurSemelles(m)
    bg = Math.min(bg, q.g); bd = Math.min(bd, q.d)
    hg = Math.max(hg, q.g); hd = Math.max(hd, q.d)
    if (i % 5 === 0) lignes.push(`  t=${t.toFixed(3)}  G ${(q.g * 100).toFixed(1).padStart(6)}  D ${(q.d * 100).toFixed(1).padStart(6)} cm`)
  }
  console.log(`\n=== ${slug} (${c.duree.toFixed(2)} s)`)
  console.log(lignes.join('\n'))
  console.log(`  G : ${(bg * 100).toFixed(1)} → ${(hg * 100).toFixed(1)} cm   D : ${(bd * 100).toFixed(1)} → ${(hd * 100).toFixed(1)} cm`)
}
