// Lecture binaire d'un .glb / .gltf : conteneur, accesseurs, graphe de nœuds.
//
// AUCUNE dépendance. `three` est une bibliothèque CLIENT (elle tire tout un
// moteur de rendu) ; le serveur n'a besoin que de la géométrie brute et de
// quelques matrices 4×4, ce qui tient en un fichier. La convention est celle de
// glTF, donc aussi celle de three : matrices **colonne-major**, Y vers le haut,
// mètres.
//
// Ce module ne juge rien et ne mesure rien : il rend des triangles et des
// matrices. Toute l'interprétation (sol, assises, pièce) est dans envScene.ts.
import fs from 'node:fs'
import path from 'node:path'

/** Matrice 4×4 colonne-major : m[c * 4 + l]. Même disposition que glTF et three. */
export type Mat4 = Float64Array

export function mat4Identity(): Mat4 {
  const m = new Float64Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}

/** a × b (les deux colonne-major) — la transformation `b` s'applique en premier. */
export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
      out[c * 4 + r] = s
    }
  }
  return out
}

/** Translation × rotation (quaternion x,y,z,w) × échelle — l'ordre de glTF et de three. */
export function mat4Compose(
  t: readonly number[],
  q: readonly number[],
  s: readonly number[],
): Mat4 {
  const [x, y, z, w] = q
  const x2 = x + x
  const y2 = y + y
  const z2 = z + z
  const xx = x * x2
  const xy = x * y2
  const xz = x * z2
  const yy = y * y2
  const yz = y * z2
  const zz = z * z2
  const wx = w * x2
  const wy = w * y2
  const wz = w * z2
  const m = new Float64Array(16)
  m[0] = (1 - (yy + zz)) * s[0]
  m[1] = (xy + wz) * s[0]
  m[2] = (xz - wy) * s[0]
  m[4] = (xy - wz) * s[1]
  m[5] = (1 - (xx + zz)) * s[1]
  m[6] = (yz + wx) * s[1]
  m[8] = (xz + wy) * s[2]
  m[9] = (yz - wx) * s[2]
  m[10] = (1 - (xx + yy)) * s[2]
  m[12] = t[0]
  m[13] = t[1]
  m[14] = t[2]
  m[15] = 1
  return m
}

/** Rotation autour de Y (radians) composée avec une échelle uniforme — le placement d'un décor. */
export function mat4YawScale(yawRad: number, scale: number): Mat4 {
  const c = Math.cos(yawRad)
  const s = Math.sin(yawRad)
  const m = new Float64Array(16)
  m[0] = c * scale
  m[2] = -s * scale
  m[5] = scale
  m[8] = s * scale
  m[10] = c * scale
  m[15] = 1
  return m
}

/** Applique une matrice à un point (w = 1), résultat écrit dans `out`. */
export function mat4ApplyPoint(m: Mat4, x: number, y: number, z: number, out: Float64Array): void {
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12]
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13]
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14]
}

// ── Conteneur glTF ─────────────────────────────────────────────────────────

interface GltfBufferView {
  buffer: number
  byteOffset?: number
  byteLength: number
  byteStride?: number
}

interface GltfSparse {
  count: number
  indices: { bufferView: number; byteOffset?: number; componentType: number }
  values: { bufferView: number; byteOffset?: number }
}

interface GltfAccessor {
  bufferView?: number
  byteOffset?: number
  componentType: number
  normalized?: boolean
  count: number
  type: string
  min?: number[]
  max?: number[]
  sparse?: GltfSparse
}

interface GltfPrimitive {
  attributes: Record<string, number>
  indices?: number
  material?: number
  mode?: number
}

interface GltfNode {
  name?: string
  mesh?: number
  children?: number[]
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
}

interface GltfJson {
  accessors?: GltfAccessor[]
  bufferViews?: GltfBufferView[]
  buffers?: { uri?: string; byteLength: number }[]
  meshes?: { name?: string; primitives: GltfPrimitive[] }[]
  materials?: { name?: string }[]
  nodes?: GltfNode[]
  scene?: number
  scenes?: { nodes?: number[] }[]
  extensionsRequired?: string[]
  asset?: { generator?: string; version?: string }
}

const COMPONENT_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const TYPE_COUNT: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
const NORMALIZE_DIVISOR: Record<number, number> = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }

/**
 * Extensions qui remplacent la géométrie par un flux compressé : sans décodeur,
 * les accesseurs de position ne veulent RIEN dire. Le client les refuse déjà
 * (cf. compressionError dans vrmStage.ts) — ici on s'arrête avant de mesurer du
 * bruit, plutôt que de produire une analyse fausse.
 */
const UNSUPPORTED_EXTENSIONS = [
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
  'KHR_texture_basisu',
]

/** Une primitive de maillage, dans le repère du modèle (matrices de nœuds composées). */
export interface GlbPrimitive {
  node: string
  material: string | null
  /** Mode glTF : 4 = triangles. Les autres ne portent pas de surface mais comptent dans la boîte. */
  mode: number
  /** Nœud → racine du modèle. */
  matrix: Mat4
  /** AABB LOCALE : les `min`/`max` déclarés de l'accesseur de position, exactement ce que GLTFLoader pose dans `geometry.boundingBox` — c'est cette boîte-là que `Box3.setFromObject` transforme. */
  min: [number, number, number]
  max: [number, number, number]
  /** Positions locales, 3 par sommet (null pour les primitives non triangulaires). */
  positions: Float64Array | null
  /** Indices de sommets (null = triangles consécutifs). */
  indices: Uint32Array | null
  triangleCount: number
}

export interface GlbModel {
  generator: string
  primitives: GlbPrimitive[]
  triangleCount: number
}

/** Le fichier est lisible mais on ne sait pas en tirer de géométrie (compression, format). */
export class GlbUnsupportedError extends Error {}

function readComponent(view: DataView, offset: number, componentType: number): number {
  switch (componentType) {
    case 5120:
      return view.getInt8(offset)
    case 5121:
      return view.getUint8(offset)
    case 5122:
      return view.getInt16(offset, true)
    case 5123:
      return view.getUint16(offset, true)
    case 5125:
      return view.getUint32(offset, true)
    case 5126:
      return view.getFloat32(offset, true)
    default:
      throw new GlbUnsupportedError(`type de composant glTF inconnu : ${componentType}`)
  }
}

/**
 * Découpe un .glb en son chunk JSON et son chunk BIN. Un .gltf (JSON nu) est
 * reconnu à l'absence du magic « glTF ».
 */
function splitContainer(buf: Buffer): { json: GltfJson; bin: Buffer | null } {
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x46546c67) {
    const declared = buf.readUInt32LE(8)
    const total = Math.min(declared, buf.length)
    let offset = 12
    let json: GltfJson | null = null
    let bin: Buffer | null = null
    while (offset + 8 <= total) {
      const length = buf.readUInt32LE(offset)
      const type = buf.readUInt32LE(offset + 4)
      const end = Math.min(offset + 8 + length, buf.length)
      const chunk = buf.subarray(offset + 8, end)
      if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8')) as GltfJson
      else if (type === 0x004e4942) bin = chunk
      offset = offset + 8 + length + ((4 - (length % 4)) % 4)
    }
    if (!json) throw new GlbUnsupportedError('chunk JSON absent du .glb')
    return { json, bin }
  }
  // .gltf : JSON nu, les buffers sont dans des fichiers voisins ou des data URI.
  return { json: JSON.parse(buf.toString('utf8')) as GltfJson, bin: null }
}

/** Résout les buffers d'un .gltf : chunk BIN, data URI base64, ou fichier voisin. */
function resolveBuffers(json: GltfJson, bin: Buffer | null, dir: string): Buffer[] {
  const out: Buffer[] = []
  for (const buffer of json.buffers ?? []) {
    if (!buffer.uri) {
      if (!bin) throw new GlbUnsupportedError('buffer sans uri hors conteneur .glb')
      out.push(bin)
      continue
    }
    if (buffer.uri.startsWith('data:')) {
      const comma = buffer.uri.indexOf(',')
      const isBase64 = /;base64$/i.test(buffer.uri.slice(0, comma))
      const payload = buffer.uri.slice(comma + 1)
      out.push(Buffer.from(isBase64 ? payload : decodeURIComponent(payload), isBase64 ? 'base64' : 'utf8'))
      continue
    }
    // Fichier voisin. Le décor vient du dossier environments/, mais un uri
    // « ../../data/config.json » n'a rien à y faire : on refuse de sortir du
    // dossier du modèle.
    const target = path.resolve(dir, decodeURIComponent(buffer.uri))
    const rel = path.relative(dir, target)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new GlbUnsupportedError(`buffer hors du dossier du modèle : ${buffer.uri}`)
    }
    out.push(fs.readFileSync(target))
  }
  return out
}

/** Accesseur → tableau plat de nombres. Gère l'entrelacement, le sparse et la normalisation. */
function readAccessor(json: GltfJson, buffers: Buffer[], index: number): Float64Array {
  const accessor = (json.accessors ?? [])[index]
  if (!accessor) throw new GlbUnsupportedError(`accesseur ${index} absent`)
  const components = TYPE_COUNT[accessor.type]
  const size = COMPONENT_SIZE[accessor.componentType]
  if (!components || !size) throw new GlbUnsupportedError(`accesseur ${index} au format inconnu`)
  const out = new Float64Array(accessor.count * components)

  const readInto = (bufferView: number, byteOffset: number, count: number, componentType: number, target: Float64Array, targetStride: number, indices: Uint32Array | null): void => {
    const view = (json.bufferViews ?? [])[bufferView]
    if (!view) throw new GlbUnsupportedError(`bufferView ${bufferView} absente`)
    const buffer = buffers[view.buffer]
    if (!buffer) throw new GlbUnsupportedError(`buffer ${view.buffer} absent`)
    const data = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    const elementSize = COMPONENT_SIZE[componentType] * targetStride
    const stride = view.byteStride || elementSize
    const base = (view.byteOffset ?? 0) + byteOffset
    for (let i = 0; i < count; i++) {
      const src = base + i * stride
      const dst = (indices ? indices[i] : i) * targetStride
      for (let c = 0; c < targetStride; c++) {
        target[dst + c] = readComponent(data, src + c * COMPONENT_SIZE[componentType], componentType)
      }
    }
  }

  if (accessor.bufferView !== undefined) {
    readInto(accessor.bufferView, accessor.byteOffset ?? 0, accessor.count, accessor.componentType, out, components, null)
  }
  if (accessor.sparse) {
    const s = accessor.sparse
    const keys = new Float64Array(s.count)
    readInto(s.indices.bufferView, s.indices.byteOffset ?? 0, s.count, s.indices.componentType, keys, 1, null)
    const targets = new Uint32Array(s.count)
    for (let i = 0; i < s.count; i++) targets[i] = keys[i]
    readInto(s.values.bufferView, s.values.byteOffset ?? 0, s.count, accessor.componentType, out, components, targets)
  }
  if (accessor.normalized) {
    const divisor = NORMALIZE_DIVISOR[accessor.componentType]
    const signed = accessor.componentType === 5120 || accessor.componentType === 5122
    if (divisor) {
      for (let i = 0; i < out.length; i++) out[i] = signed ? Math.max(-1, out[i] / divisor) : out[i] / divisor
    }
  }
  return out
}

function nodeMatrix(node: GltfNode): Mat4 {
  if (node.matrix && node.matrix.length === 16) {
    const m = new Float64Array(16)
    for (let i = 0; i < 16; i++) m[i] = node.matrix[i]
    return m
  }
  return mat4Compose(node.translation ?? [0, 0, 0], node.rotation ?? [0, 0, 0, 1], node.scale ?? [1, 1, 1])
}

/**
 * Lit un .glb / .gltf et rend ses primitives avec la matrice monde de leur nœud.
 *
 * Les nœuds SONT composés : les trois décors livrés portent une matrice racine
 * `Sketchfab_model` (conversion Z-up → Y-up, parfois une mise à l'échelle) —
 * lire les accesseurs sans elle donnerait des coordonnées fausses sur les trois axes.
 */
export function loadGlb(file: string): GlbModel {
  const buf = fs.readFileSync(file)
  const { json, bin } = splitContainer(buf)
  const required = json.extensionsRequired ?? []
  const blocking = required.filter((e) => UNSUPPORTED_EXTENSIONS.includes(e))
  if (blocking.length > 0) {
    throw new GlbUnsupportedError(`géométrie compressée (${blocking.join(', ')}) — réexporter sans compression`)
  }
  const buffers = resolveBuffers(json, bin, path.dirname(file))
  const nodes = json.nodes ?? []
  const meshes = json.meshes ?? []
  const materials = json.materials ?? []
  const scene = (json.scenes ?? [])[json.scene ?? 0]
  const roots = scene?.nodes ?? nodes.map((_, i) => i)

  const primitives: GlbPrimitive[] = []
  let triangleCount = 0
  const stack: { index: number; parent: Mat4 }[] = roots.map((index) => ({ index, parent: mat4Identity() }))
  const seen = new Set<number>()
  while (stack.length > 0) {
    const { index, parent } = stack.pop() as { index: number; parent: Mat4 }
    const node = nodes[index]
    if (!node) continue
    // Un graphe cyclique (fichier abîmé) boucherait la pile : on ne visite
    // chaque nœud qu'une fois.
    if (seen.has(index)) continue
    seen.add(index)
    const world = mat4Multiply(parent, nodeMatrix(node))
    for (const child of node.children ?? []) stack.push({ index: child, parent: world })
    if (node.mesh === undefined) continue
    const mesh = meshes[node.mesh]
    if (!mesh) continue
    for (const prim of mesh.primitives ?? []) {
      const positionAccessor = prim.attributes?.POSITION
      if (positionAccessor === undefined) continue
      const accessor = (json.accessors ?? [])[positionAccessor]
      if (!accessor) continue
      const mode = prim.mode ?? 4
      let positions: Float64Array | null = null
      let indices: Uint32Array | null = null
      let triangles = 0
      if (mode === 4) {
        positions = readAccessor(json, buffers, positionAccessor)
        if (prim.indices !== undefined) {
          const raw = readAccessor(json, buffers, prim.indices)
          indices = new Uint32Array(raw.length)
          for (let i = 0; i < raw.length; i++) indices[i] = raw[i]
          triangles = Math.floor(indices.length / 3)
        } else {
          triangles = Math.floor(positions.length / 9)
        }
        triangleCount += triangles
      }
      // AABB locale : les min/max déclarés font foi (c'est ce que lit
      // GLTFLoader) ; on ne la recalcule que s'ils manquent.
      let min: [number, number, number]
      let max: [number, number, number]
      if (accessor.min && accessor.max && accessor.min.length >= 3 && accessor.max.length >= 3) {
        min = [accessor.min[0], accessor.min[1], accessor.min[2]]
        max = [accessor.max[0], accessor.max[1], accessor.max[2]]
      } else {
        const p = positions ?? readAccessor(json, buffers, positionAccessor)
        min = [Infinity, Infinity, Infinity]
        max = [-Infinity, -Infinity, -Infinity]
        for (let i = 0; i < p.length; i += 3) {
          for (let a = 0; a < 3; a++) {
            if (p[i + a] < min[a]) min[a] = p[i + a]
            if (p[i + a] > max[a]) max[a] = p[i + a]
          }
        }
      }
      primitives.push({
        node: node.name ?? `#${index}`,
        material: prim.material !== undefined ? materials[prim.material]?.name ?? `#${prim.material}` : null,
        mode,
        matrix: world,
        min,
        max,
        positions,
        indices,
        triangleCount: triangles,
      })
    }
  }
  if (primitives.length === 0) throw new GlbUnsupportedError('aucun maillage dans le fichier')
  return { generator: json.asset?.generator ?? '', primitives, triangleCount }
}
