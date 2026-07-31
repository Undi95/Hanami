import * as S from './scene.mjs'

const m = S.chargerModele(S.resoudreModele('EtalonChibi'), { maillage: false })
for (const slug of ['world-walk', 'world-sit-enter', 'idle']) {
  const c = await S.chargerClip(m, slug)
  const n = 25
  console.log(`\n=== ${slug} (${c.duree.toFixed(3)} s) — hauteurs en cm`)
  console.log('  t     ankleG toesG  minG | ankleD toesD  minD | bassin')
  let solG = Infinity, solD = Infinity
  for (let i = 0; i < n; i++) {
    const t = Math.min(c.duree - S.EPS, (i * c.duree) / (n - 1))
    const os = S.appliquer(m, c.ech(t))
    const ag = os.get('leftFoot').y * 100, tg = os.get('leftToes').y * 100
    const ad = os.get('rightFoot').y * 100, td = os.get('rightToes').y * 100
    solG = Math.min(solG, ag, tg); solD = Math.min(solD, ad, td)
    console.log(`  ${t.toFixed(3)} ${ag.toFixed(1).padStart(6)} ${tg.toFixed(1).padStart(6)} ${Math.min(ag, tg).toFixed(1).padStart(5)} | ${ad.toFixed(1).padStart(6)} ${td.toFixed(1).padStart(6)} ${Math.min(ad, td).toFixed(1).padStart(5)} | ${(os.get('hips').y * 100).toFixed(1)}`)
  }
  console.log(`  min atteint : G ${solG.toFixed(1)} cm, D ${solD.toFixed(1)} cm`)
}
