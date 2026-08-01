// Fusion statique des décors — le remède mesuré au coût du loft : 362 primitives
// et 25 matériaux y produisaient ~250 appels de dessin rien que pour la pièce
// (370 au total contre 94 pour l'avatar seul), et 789 nœuds à retraverser par
// image doublaient le « reste » du tick. Un décor est IMMOBILE une fois placé :
// tout ce qui partage un matériau peut devenir un seul mesh, et plus aucune
// matrice n'a besoin d'être recomposée ensuite.
//
// Deux gestes, appliqués au chargement (après fitEnvironment, avant le premier
// rendu — le bloc est synchrone, aucune image ne part entre-temps) :
//
// 1. FUSION par matériau des meshes OPAQUES sûrs. Les transparents (vitre,
//    rideaux, bocaux) gardent leur tri par profondeur individuel — les fusionner
//    changerait l'ordre de rendu, c'est le risque identifié d'avance et il est
//    refusé. Sont aussi laissés tels quels : matériaux multiples (groupes),
//    skinned/morph (un décor animé, improbable mais légal), matrices à
//    déterminant négatif (le miroir inverserait ses faces à la cuisson),
//    attributs interlacés ou dépareillés (mergeGeometries exige l'homogénéité —
//    on regroupe par signature d'attributs pour ne jamais le mettre en échec).
// 2. GEL des matrices — posé par L'APPELANT (loadEnvironment), après la
//    recomposition finale de la branche : matrixAutoUpdate et
//    matrixWorldAutoUpdate à false sur le groupe du décor, et le parcours par
//    image de scene.updateMatrixWorld ne descend plus dedans (three r144+).
//    Les matrices restent JUSTES : plus personne ne les modifie, et le lancer
//    de rayon des clics lit matrixWorld tel quel.
//
// La géométrie SOURCE d'un mesh fusionné n'est jamais montée sur le GPU (la
// fusion précède le premier rendu) : la retirer de la scène suffit, il n'y a
// rien à libérer côté VRAM. Les clones intermédiaires ne vivent que le temps de
// la fusion. deepDispose, au déchargement, libère les meshes fusionnés comme
// n'importe quels autres.

import { Matrix4, Mesh, SkinnedMesh } from 'three'
import type { BufferGeometry, Material, Object3D } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Regard minimal sur les propriétés que le typage inféré de three ne porte pas. */
interface MeshLike {
  geometry?: BufferGeometry
  material?: Material | Material[]
  visible?: boolean
  morphTargetInfluences?: unknown
}

interface GeometryLike {
  attributes?: Record<string, { itemSize?: number; normalized?: boolean; isInterleavedBufferAttribute?: boolean }>
  index?: unknown
  morphAttributes?: Record<string, unknown[]>
}

interface MaterialLike {
  transparent?: boolean
  alphaTest?: number
  depthWrite?: boolean
}

/**
 * Signature d'homogénéité d'une géométrie : mergeGeometries échoue (et s'en
 * plaint en console) dès que deux géométries n'ont pas exactement les mêmes
 * attributs, ou qu'une seule est indexée. Regrouper par signature garantit
 * qu'on ne l'appelle QUE sur des lots homogènes — l'échec devient impossible
 * par construction, pas rattrapé après coup.
 */
function geometrySignature(geometry: BufferGeometry): string | null {
  const g = geometry as unknown as GeometryLike
  const attrs = g.attributes
  if (!attrs) return null
  const parts: string[] = []
  for (const name of Object.keys(attrs).sort()) {
    const a = attrs[name]
    if (a.isInterleavedBufferAttribute) return null // hors du contrat de mergeGeometries
    parts.push(`${name}:${a.itemSize ?? 0}:${a.normalized ? 1 : 0}`)
  }
  if (g.morphAttributes && Object.keys(g.morphAttributes).length > 0) return null
  parts.push(g.index ? 'idx' : 'flat')
  return parts.join('|')
}

/** Le matériau est-il un OPAQUE ordinaire, sûr à fusionner ? */
function isOpaque(material: Material): boolean {
  const m = material as unknown as MaterialLike
  if (m.transparent === true) return false
  if ((m.alphaTest ?? 0) > 0) return false
  if (m.depthWrite === false) return false
  return true
}

/**
 * Fusionne les meshes opaques d'un décor par matériau et fige ses matrices.
 * Rend le nombre d'appels de dessin économisés (meshes retirés − meshes créés),
 * purement informatif. Idempotent dans les faits : repasser dessus ne trouve
 * plus que des lots d'un seul mesh.
 */
export function mergeEnvironment(root: Object3D): number {
  root.updateMatrixWorld(true)
  const rootInverse = new Matrix4().copy(root.matrixWorld).invert()

  // ── Collecte des candidats, groupés par (matériau, signature) ─────────────
  const groups = new Map<Material, Map<string, Mesh[]>>()
  root.traverse((node) => {
    if (!(node instanceof Mesh) || node instanceof SkinnedMesh) return
    const mesh = node as Mesh & MeshLike
    if (mesh.visible === false) return
    if (mesh.morphTargetInfluences) return
    const material = mesh.material
    const geometry = mesh.geometry
    if (!material || Array.isArray(material) || !geometry) return // groupes multi-matériaux : intacts
    if (!isOpaque(material)) return
    // Une matrice miroir (déterminant < 0) inverserait l'enroulement des faces
    // une fois cuite dans les sommets : ce mesh reste tel quel.
    if (mesh.matrixWorld.determinant() < 0) return
    const signature = geometrySignature(geometry)
    if (signature === null) return
    let bySig = groups.get(material)
    if (!bySig) groups.set(material, (bySig = new Map()))
    const list = bySig.get(signature)
    if (list) list.push(mesh)
    else bySig.set(signature, [mesh])
  })

  // ── Fusion lot par lot ────────────────────────────────────────────────────
  const relative = new Matrix4()
  let saved = 0
  for (const [material, bySig] of groups) {
    for (const batch of bySig.values()) {
      if (batch.length < 2) continue // rien à gagner, ne pas toucher
      const baked: BufferGeometry[] = []
      for (const mesh of batch) {
        // Cuisson de la transforme RELATIVE À LA RACINE dans une copie : les
        // sommets deviennent définitifs, le mesh fusionné vivra à l'identité
        // sous root. La géométrie source n'est pas modifiée.
        relative.copy(rootInverse).multiply(mesh.matrixWorld)
        baked.push(mesh.geometry.clone().applyMatrix4(relative))
      }
      const merged = mergeGeometries(baked, false)
      if (!merged) continue // lot homogène par construction ; ceinture quand même
      const mesh = new Mesh(merged, material)
      mesh.name = 'env-merged'
      root.add(mesh)
      for (const source of batch) source.parent?.remove(source)
      saved += batch.length - 1
    }
  }

  // Cohérence interne pour les meshes tout juste créés (matrixWorld valant
  // quelque chose avant le premier rendu) — l'APPELANT recompose ensuite la
  // branche entière depuis son groupe et pose le gel. Le gel n'est PAS posé
  // ici, et ce n'est pas un détail : dans three, matrixWorldAutoUpdate=false
  // n'élague pas seulement le parcours, il INTERDIT l'écriture de matrixWorld
  // même sous `force` — geler avant la recomposition finale du parent figerait
  // le décor SANS sa translation de placement (mesuré : la classe entière à
  // 3,72 m de sa place).
  root.updateMatrixWorld(true)
  return saved
}
