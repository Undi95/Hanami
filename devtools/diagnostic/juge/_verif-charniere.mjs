// À quelle flexion la déviation de charnière est-elle mesurée ? Si la pire
// déviation arrive genou quasi tendu, l'axe est mal conditionné et le critère
// accuse à tort. On liste (flexion, déviation) au moment de la pire déviation,
// et la pire déviation PARMI les flexions franches (≥ 20°). Jetable.
import * as R from './rig.mjs'
import * as A from './anatomie.mjs'

const rig = R.chargerRig(R.choisirVrm(null))
for (const slug of ['world-turn-right', 'world-turn-left', 'world-walk-back', 'world-sit-idle-2', 'world-walk']) {
  const info = await R.chargerClip(rig, slug)
  const tr = A.analyser(rig, info, { boucle: true })
  for (const k of ['g', 'd']) {
    let pire = { dev: -1 }
    let pireFranche = { dev: -1 }
    for (const F of tr.img) {
      const g = F.genou[k]
      if (!g || !isFinite(g.deviationCharniereDeg)) continue
      if (g.deviationCharniereDeg > (pire.dev ?? -1)) pire = { dev: g.deviationCharniereDeg, flex: g.flexionDeg, t: F.t }
      if (g.flexionDeg >= 20 && g.deviationCharniereDeg > (pireFranche.dev ?? -1)) pireFranche = { dev: g.deviationCharniereDeg, flex: g.flexionDeg, t: F.t }
    }
    console.log(`${slug.padEnd(18)} genou ${k} : pire déviation ${pire.dev?.toFixed(0)}° (flexion ${pire.flex?.toFixed(0)}° à t=${pire.t?.toFixed(2)}) · pire à flexion ≥ 20° : ${pireFranche.dev < 0 ? '—' : pireFranche.dev.toFixed(0) + '° (flexion ' + pireFranche.flex.toFixed(0) + '°)'}`)
  }
}
