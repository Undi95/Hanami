// Contre-épreuve des hyperextensions annoncées : géométrie brute au pire instant.
// world-run (genou -41°) : positions hanche/genou/cheville dans le plan sagittal.
// world-sit-raise-hand (coude -108°) : élévation du bras au moment du pire signe.
// Jetable.
import * as R from './rig.mjs'
import * as A from './anatomie.mjs'

// L'étalon du banc (vrm/reference.vrm) — le modèle des résultats committés.
const rig = R.chargerRig(R.choisirVrm(null))

{
  const info = await R.chargerClip(rig, 'world-run')
  const tr = A.analyser(rig, info, { boucle: true })
  let pire = null
  for (const F of tr.img) {
    for (const k of ['g', 'd']) {
      const g = F.genou[k]
      if (g && (!pire || g.flexionSigneeDeg < pire.v)) pire = { v: g.flexionSigneeDeg, k, t: F.t, F }
    }
  }
  const F = pire.F
  console.log(`world-run : pire flexion signée ${pire.v.toFixed(1)}° (genou ${pire.k}) à t=${pire.t.toFixed(2)} s`)
  const c = pire.k === 'g' ? 'left' : 'right'
  // positions monde recalculées à cet instant
  const p = info.ech(pire.t)
  R.poser(rig, p)
  const V = (os) => rig.noeudBrut(os).getWorldPosition(new (R.THREE.Vector3)())
  const h = V(c + 'UpperLeg'), ge = V(c + 'LowerLeg'), pi = V(c + 'Foot')
  const avant = F._avant
  const proj = (v) => ({ av: +v.clone().sub(h).dot(avant).toFixed(3), y: +(v.y - h.y).toFixed(3) })
  console.log(`  hanche→genou (plan sagittal, m) : ${JSON.stringify(proj(ge))} · hanche→cheville : ${JSON.stringify(proj(pi))}`)
  console.log(`  → le genou est ${proj(ge).av > proj(pi).av ? 'DEVANT' : 'derrière'} la cheville ; une jambe qui se casse en avant aurait le genou DERRIÈRE la corde hanche-cheville.`)
  // distance du genou à la corde hanche-cheville, signée vers l'avant
  const ax = pi.clone().sub(h).normalize()
  const rel = ge.clone().sub(h)
  const perp = rel.clone().sub(ax.clone().multiplyScalar(rel.dot(ax)))
  console.log(`  écart du genou à la corde hanche-cheville : ${(perp.length() * 100).toFixed(1)} cm, composante avant ${(perp.dot(avant) * 100).toFixed(1)} cm (négatif = genou en arrière de la corde = hyperextension vraie)`)
}

{
  const info = await R.chargerClip(rig, 'world-sit-raise-hand')
  const tr = A.analyser(rig, info, { boucle: true })
  let pire = null
  for (const F of tr.img) {
    for (const k of ['g', 'd']) {
      const cd = F.coude[k]
      if (cd && (!pire || cd.flexionSigneeDeg < pire.v)) pire = { v: cd.flexionSigneeDeg, k, t: F.t, F }
    }
  }
  const F = pire.F
  const c = pire.k === 'g' ? 'left' : 'right'
  const p = info.ech(pire.t)
  R.poser(rig, p)
  const V = (os) => rig.noeudBrut(os).getWorldPosition(new (R.THREE.Vector3)())
  const e = V(c + 'UpperArm'), co = V(c + 'LowerArm'), m = V(c + 'Hand')
  const bras = co.clone().sub(e)
  const elevDeg = Math.acos(Math.min(1, Math.max(-1, bras.clone().normalize().dot(new (R.THREE.Vector3)(0, -1, 0))))) * 180 / Math.PI
  console.log(`world-sit-raise-hand : pire flexion signée du coude ${pire.v.toFixed(1)}° (${pire.k}) à t=${pire.t.toFixed(2)} s`)
  console.log(`  bras écarté de ${elevDeg.toFixed(0)}° de la verticale basse (0 = bras pendant, 180 = bras au zénith)`)
  console.log(`  main ${(m.y - e.y) > 0 ? 'AU-DESSUS' : 'sous'} l'épaule (Δy ${((m.y - e.y) * 100).toFixed(1)} cm) · flexion non signée ${F.coude[pire.k].flexionDeg.toFixed(0)}°`)
}
