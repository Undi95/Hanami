// Fiche d'identité d'un nœud du décor PLACÉ : boîte monde, matériaux,
// histogramme des altitudes de ses sommets. Diagnostic pur, non committé.
import { Box3, Vector3 } from 'three'
import { chargerDecor } from './banc-clics-sol.mjs'

const [nom, ...noeuds] = process.argv.slice(2)
const { envRoot } = await chargerDecor(nom)

envRoot.updateMatrixWorld(true)
envRoot.traverse((o) => {
  if (noeuds.length && !noeuds.includes(o.name)) return
  if (!o.isMesh) return
  const box = new Box3().setFromObject(o)
  const size = box.getSize(new Vector3())
  const mats = Array.isArray(o.material) ? o.material : [o.material]
  console.log(`\n${o.name}`)
  console.log(
    `  boîte monde : x [${box.min.x.toFixed(2)}, ${box.max.x.toFixed(2)}]  y [${box.min.y.toFixed(2)}, ${box.max.y.toFixed(2)}]  z [${box.min.z.toFixed(2)}, ${box.max.z.toFixed(2)}]  taille ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}`,
  )
  for (const m of mats) {
    console.log(
      `  matériau ${m.name || '(anonyme)'} : type=${m.type} side=${m.side} transparent=${m.transparent} opacity=${m.opacity} alphaTest=${m.alphaTest}`,
    )
  }
  // Histogramme des altitudes monde des sommets (tranches de 10 cm).
  const pos = o.geometry.attributes.position
  const v = new Vector3()
  const bins = new Map()
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld)
    const bin = Math.floor(v.y * 10) / 10
    bins.set(bin, (bins.get(bin) ?? 0) + 1)
  }
  const tri = [...bins.entries()].sort((a, b) => a[0] - b[0])
  console.log(`  sommets : ${pos.count} — altitudes monde (m → nb) :`)
  for (const [y, n] of tri) console.log(`    ${y.toFixed(1).padStart(5)} : ${'█'.repeat(Math.min(60, Math.ceil(n / Math.max(1, pos.count / 200))))} ${n}`)
})
