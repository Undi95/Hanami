// Sonde verticale : pour chaque cellule de la grille du .scene.json, un rayon
// vertical descendant depuis y = 3 m sur le décor PLACÉ — quel matériau
// répond en premier, à quelle altitude ? Confronté au caractère de la carte.
// Diagnostic pur, non committé.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Raycaster, Vector3 } from 'three'

// Réutilise le chargement + placement du banc (mêmes fonctions, même fidélité).
import { chargerDecor } from './banc-clics-sol.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const nom = process.argv[2] ?? 'rustic-bedroom'
const { envRoot, sceneJson } = await chargerDecor(nom)

const g = sceneJson.grid
const ray = new Raycaster()
const down = new Vector3(0, -1, 0)
const ALPHA = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

const matDeHit = (h) => {
  const m = h.object.material
  return Array.isArray(m) ? (m[0]?.name ?? '?') : (m?.name ?? '?')
}

// Carte ASCII : initiale du matériau touché en premier depuis le ciel.
const initiales = new Map()
let prochaine = 0
const lignes = []
const anomalies = []
for (let j = 0; j < g.rows; j++) {
  let ligne = ''
  for (let i = 0; i < g.cols; i++) {
    const x = g.origin[0] + (i + 0.5) * g.cell
    const z = g.origin[1] + (j + 0.5) * g.cell
    ray.set(new Vector3(x, 3, z), down)
    const hits = ray.intersectObject(envRoot, true)
    if (!hits.length) {
      ligne += ' '
      continue
    }
    const h = hits[0]
    const mat = matDeHit(h)
    if (!initiales.has(mat)) initiales.set(mat, String(prochaine++))
    ligne += initiales.get(mat)
    const c = g.map[j][i]
    const lvl = ALPHA.indexOf(c)
    if (lvl >= 0 && lvl < g.levels.length) {
      // Cellule praticable : le premier impact venu du ciel devrait être LE SOL
      // à l'altitude du niveau. S'il est nettement plus haut : quelque chose de
      // suspendu au-dessus du sol praticable.
      const attendu = g.levels[lvl]
      if (h.point.y - attendu > 0.05) {
        anomalies.push({ i, j, x, z, mat, y: h.point.y, attendu, node: h.object.name })
      }
    }
  }
  lignes.push(ligne)
}

console.log(`\n${nom} — matériau du PREMIER impact vertical (ciel → sol) :`)
for (const [mat, ini] of initiales) console.log(`  ${ini} = ${mat}`)
console.log(lignes.map((l, j) => String(j).padStart(2) + ' ' + l).join('\n'))
console.log('\nCarte praticable (référence) :')
console.log(g.map.map((l, j) => String(j).padStart(2) + ' ' + l).join('\n'))

console.log(`\nAnomalies (cellule praticable mais impact vertical > niveau + 5 cm) : ${anomalies.length}`)
for (const a of anomalies.slice(0, 30)) {
  console.log(
    `  (${a.i},${a.j}) x=${a.x.toFixed(2)} z=${a.z.toFixed(2)} : ${a.node} [${a.mat}] à y=${a.y.toFixed(3)} (niveau ${a.attendu})`,
  )
}
