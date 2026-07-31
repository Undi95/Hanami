import * as S from './scene.mjs'

const t0 = Date.now()
const m = S.chargerModele(S.resoudreModele('EtalonChibi'), { maillage: true })
console.log(`modèle ${m.nom} VRM ${m.version} — chargé en ${Date.now() - t0} ms`)
console.log(`hanches au repos ${m.hanchesRepos.toFixed(4)} m, échelle world.json ${m.echelle.toFixed(4)}`)
console.log(`primitives ${m.peaux.primitives.length}, sommets utiles ${m.peaux.primitives.reduce((a, p) => a + p.nv, 0)}, triangles ${m.peaux.primitives.reduce((a, p) => a + p.tri.length / 3, 0)}`)

const c = await S.chargerClip(m, 'world-walk')
console.log(`clip ${c.slug} : ${c.duree.toFixed(3)} s, ${c.osAnimes.size} os animés, translation bassin ${c.aTranslation}`)

for (const t of [0, c.duree * 0.25, c.duree * 0.5, c.duree - S.EPS]) {
  const pos = S.appliquer(m, c.ech(t))
  const h = pos.get('hips'), pg = pos.get('leftFoot'), pd = pos.get('rightFoot'), te = pos.get('head')
  const av = S.avantGeometrique(m)
  console.log(
    `t=${t.toFixed(3)} hanches y=${h.y.toFixed(3)} tête y=${te.y.toFixed(3)} ` +
    `piedG=(${pg.x.toFixed(3)},${pg.y.toFixed(3)},${pg.z.toFixed(3)}) ` +
    `piedD=(${pd.x.toFixed(3)},${pd.y.toFixed(3)},${pd.z.toFixed(3)}) avant=(${av.x.toFixed(2)},${av.z.toFixed(2)})`,
  )
}

const t1 = Date.now()
S.appliquer(m, c.ech(0.3))
const prims = S.deformer(m)
console.log(`déformation du maillage : ${Date.now() - t1} ms`)
let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, minz = 1e9, maxz = -1e9
for (const p of prims) {
  for (let i = 0; i < p.nv; i++) {
    const x = p.sortie[i * 3], y = p.sortie[i * 3 + 1], z = p.sortie[i * 3 + 2]
    if (x < minx) minx = x; if (x > maxx) maxx = x
    if (y < miny) miny = y; if (y > maxy) maxy = y
    if (z < minz) minz = z; if (z > maxz) maxz = z
  }
}
console.log(`boîte du maillage déformé : x[${minx.toFixed(2)},${maxx.toFixed(2)}] y[${miny.toFixed(2)},${maxy.toFixed(2)}] z[${minz.toFixed(2)},${maxz.toFixed(2)}]`)
console.log('clarté des matériaux :', [...new Set(prims.map((p) => p.clarte.toFixed(2)))].join(' '))
