// La respiration d'idle : où vit-elle ? Bassin, poitrine, épaules, tête, mains.
// Sert à calibrer le critère « respiration » sur ce que l'œil verrait. Jetable.
import * as R from './rig.mjs'
import * as A from './anatomie.mjs'

const rig = R.chargerRig(R.choisirVrm(null))
for (const slug of ['idle', 'idle-talking', 'idle-2']) {
  const info = await R.chargerClip(rig, slug)
  const tr = A.analyser(rig, info, { boucle: true })
  const cm = (m) => (m * 100) / rig.echelle
  const ampl = (s) => A.amplitude(s.filter(isFinite))
  const hips = cm(ampl(A.sig.hipsY(tr)))
  const poitrine = tr.img.map((F) => F.epauleY).filter(isFinite)
  const epaules = cm(A.amplitude(poitrine))
  const bustePitch = ampl(A.sig.bustePitch(tr))
  const tetePitch = ampl(A.sig.tetePitch(tr))
  const mainG = cm(ampl(A.sig.mainHauteur(tr, 'g')))
  const teteH = cm(A.amplitude(tr.img.map((F) => {
    // hauteur de tête = proxy du redressement du buste
    return F.hips ? NaN : NaN
  }).filter(isFinite)))
  console.log(`${slug.padEnd(13)} bassin ${hips.toFixed(2)} cm · épaules(h) ${epaules.toFixed(2)} cm · buste pitch ${bustePitch.toFixed(2)}° · tête pitch ${tetePitch.toFixed(2)}° · main G (h) ${mainG.toFixed(2)} cm`)
}
