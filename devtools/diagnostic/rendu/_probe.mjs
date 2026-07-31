import fs from 'node:fs'
import * as S from './scene.mjs'
// Sans argument : le modèle épinglé du diagnostic, résolu dans <racine>/vrm/.
const f = process.argv[2] || S.resoudreModele('EtalonChibi')
const buf = fs.readFileSync(f)
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
const jl = dv.getUint32(12, true)
const j = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jl)))
console.log('fichier', f)
console.log('extensionsUsed', JSON.stringify(j.extensionsUsed))
console.log('extensionsRequired', JSON.stringify(j.extensionsRequired))
console.log('meshes', j.meshes?.length, 'nodes', j.nodes.length, 'skins', (j.skins || []).length)
let prim = 0, verts = 0, tris = 0
for (const m of j.meshes ?? []) for (const p of m.primitives) {
  prim++
  verts += j.accessors[p.attributes.POSITION].count
  if (p.indices != null) tris += j.accessors[p.indices].count / 3
}
console.log('primitives', prim, 'verts', verts, 'tris', tris)
console.log('VRM ext', JSON.stringify(Object.keys(j.extensions || {})))
const vext = j.extensions.VRM || j.extensions.VRMC_vrm
const hb = vext.humanoid.humanBones
const noms = Array.isArray(hb) ? hb.map((b) => b.bone) : Object.keys(hb)
console.log('os humanoïdes', noms.length)
console.log(noms.join(' '))
console.log('buffers', JSON.stringify(j.buffers?.map((b) => b.byteLength)))
console.log('materials', j.materials?.length)
