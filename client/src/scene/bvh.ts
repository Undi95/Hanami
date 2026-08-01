// Volume englobant hiérarchique (BVH) des décors — un arbre construit UNE FOIS
// par décor, pour que le lancer de rayon cesse de balayer les triangles un par un.
//
// LE CONSTAT. `Mesh.raycast` de three teste TOUS les triangles du mesh, dans
// l'ordre du tampon d'indices : la sphère englobante rejette le mesh entier, ou
// bien on paie l'intégralité de sa géométrie. Un décor n'est pas un personnage —
// il pèse des centaines de milliers de triangles. Mesuré hors navigateur sur
// 400 rayons de grille (banc `devtools/bench-raycast.mjs`), p95 :
//
//   décor                  tris    three       BVH
//   anime-classroom     217 056   5,09 ms   0,003 ms
//   apartment-floorplan 133 728   5,22 ms   0,002 ms
//   cozy-loft-room       74 899   2,73 ms   0,005 ms
//   japanese-classroom  325 960  12,86 ms   0,004 ms
//   lowpoly-restaurant   64 712   3,05 ms   0,003 ms
//   rustic-bedroom       21 824   0,96 ms   0,006 ms
//   small-cafe           62 200   1,61 ms   0,003 ms
//
// Chez three, la médiane et le p95 divergent parce que la sphère englobante
// décide de tout : un rayon qui part vers le vide ne coûte rien, un rayon qui
// touche coûte le décor entier. Le clic pouvait donc attendre 13 ms ; avec
// l'arbre, le pire décor descend à 0,006 ms.
//
// CE QUE CELA NE DÉBLOQUE PAS : le curseur contextuel au survol. Le décor
// n'était que la moitié du prix — `viser` interroge aussi le personnage, dont
// la peau animée coûte 4 à 20 ms selon le modèle et qu'AUCUN arbre ne peut
// indexer (ses sommets n'existent pas encore quand le rayon les cherche). Le
// détail des mesures et le raisonnement sont dans vrmStage, là où le curseur
// serait branché.
//
// LE REMÈDE. Un décor est IMMOBILE une fois placé (cf. envMerge : fusion par
// matériau puis gel des matrices) : c'est exactement la condition qui rend un
// BVH légitime. On le construit dans le même bloc synchrone, juste après le gel,
// et il ne bouge plus jamais. RIEN de tout cela ne vit dans le tick : la
// construction est au chargement, la requête est à l'événement.
//
// CE QUI EST ÉCRIT ICI, ET POURQUOI À LA MAIN. Aucune dépendance npm nouvelle
// n'est autorisée dans ce projet (three-mesh-bvh est donc hors jeu). L'arbre
// tient en un fichier :
//
//   - Un arbre binaire PAR MESH (les meshes du décor sont peu nombreux après
//     fusion : 5 à 30), stocké à plat dans deux tableaux typés — bornes en
//     Float32Array, aiguillage en Int32Array. Aucun objet par nœud.
//   - Coupe par SAH BINNÉ (12 casiers sur l'axe le plus étendu des centroïdes),
//     avec repli sur la médiane quand la coupe dégénère. Feuilles de 12
//     triangles au plus. La SAH bâtit 1,4× plus lentement que la simple coupe
//     médiane et le REND au centuple à la requête — mesuré, les deux stratégies
//     restant dans le banc pour que ce choix reste vérifiable :
//     p95 requête 0,003 ms (SAH) contre 0,009 ms (médiane) sur la classe,
//     pour 128 ms de construction contre 98 ms. La construction est payée une
//     fois par décor, la requête à chaque geste : l'arbitrage n'est pas serré.
//   - Les sommets ne sont JAMAIS recopiés : l'arbre référence l'attribut
//     `position` du mesh et permute une liste d'indices de triangles. Le coût
//     mémoire est celui des nœuds, pas celui de la géométrie.
//   - Parcours ORDONNÉ, du plus proche au plus lointain, avec élagage sur le
//     meilleur impact déjà trouvé : le premier impact se paie en O(log n) au
//     lieu de O(n), et un rayon qui touche le sol n'ouvre jamais le plafond.
//   - Le rayon est amené dans l'espace local du mesh SANS renormaliser sa
//     direction : le paramètre `t` reste alors la distance MONDE, comparable
//     d'un mesh à l'autre. C'est ce qui permet un seul élagage global.
//
// FIDÉLITÉ À three. Les mêmes impacts, à la précision flottante près :
//   - `side` du matériau respecté (FrontSide écarte les faces arrière,
//     BackSide les faces avant, DoubleSide n'écarte rien), y compris par groupe
//     de faces sur les meshes multi-matériaux ;
//   - `drawRange` respecté ;
//   - `visible` PAS respecté — three ne le regarde pas non plus (cf.
//     estOpaqueAuClic dans vrmStage, qui filtre après coup) : le filtre est
//     passé en argument à la requête, appliqué par mesh, et le résultat est donc
//     exactement `premierImpactVisible(intersectObject(...))`.
//
// CE QUE L'ARBRE NE SAIT PAS REPRÉSENTER — peau animée, morph targets, Line,
// Points, Sprite — n'est pas ignoré : il est NOMMÉ dans `rest`, et l'appelant
// le donne à three avant de garder le plus proche des deux impacts. Un arbre
// qui se tairait sur ce qu'il ne couvre pas serait un mur qui laisse passer
// les clics, et ce n'est pas une hypothèse : `lowpoly-restaurant` porte trois
// segments de ligne que three intersecte depuis toujours.

import { BackSide, DoubleSide, Matrix4, Mesh, SkinnedMesh, Vector3 } from 'three'
import type { Intersection, Object3D } from 'three'

/** Au-delà, on coupe même si la SAH n'y voit pas d'intérêt : plafond du pire cas. */
const LEAF_MAX = 12
/** Casiers de la SAH binnée. 12 : au-delà, le temps de construction monte sans que l'arbre s'améliore. */
const BINS = 12
/** Profondeur maximale — borne la pile de parcours, qui est allouée une fois. */
const MAX_DEPTH = 48
/**
 * Pile de parcours. La descente empile AU PLUS un nœud par niveau : la borne
 * est donc la profondeur, et elle est écrite ici en fonction d'elle plutôt
 * qu'en dur — un MAX_DEPTH relevé sans toucher à ceci ferait silencieusement
 * TOMBER des nœuds du parcours, c'est-à-dire manquer des impacts.
 */
const STACK_MAX = MAX_DEPTH + 8

// ── Regards minimaux sur three (les shims maison ne portent pas la géométrie) ──

interface AttributeLike {
  array: ArrayLike<number>
  itemSize: number
  count: number
  normalized?: boolean
  isInterleavedBufferAttribute?: boolean
  getX(i: number): number
  getY(i: number): number
  getZ(i: number): number
}

interface GeometryLike {
  attributes?: Record<string, AttributeLike | undefined>
  index?: AttributeLike | null
  groups?: { start: number; count: number; materialIndex?: number }[]
  drawRange?: { start: number; count: number }
  morphAttributes?: Record<string, unknown[]>
}

interface MaterialLike {
  side?: number
}

interface MeshLike {
  geometry?: unknown
  material?: MaterialLike | MaterialLike[]
  morphTargetInfluences?: unknown
}

/** Écartement des faces : 0 = aucun (DoubleSide), 1 = arrière (FrontSide), 2 = avant (BackSide). */
const CULL_NONE = 0
const CULL_BACK = 1
const CULL_FRONT = 2

function cullOf(material: MaterialLike | undefined): number {
  const side = material?.side
  if (side === DoubleSide) return CULL_NONE
  if (side === BackSide) return CULL_FRONT
  return CULL_BACK // FrontSide, ou matériau muet : le défaut de three
}

/**
 * L'arbre d'UN mesh. `bounds` et `meta` décrivent les nœuds à plat :
 * - `bounds[6n…6n+5]` = min x,y,z puis max x,y,z, en espace LOCAL du mesh ;
 * - `meta[2n+1]` = nombre de triangles (0 ⇒ nœud interne) ;
 * - `meta[2n]` = début dans `tris` (feuille) ou index du fils DROIT (interne —
 *   le fils gauche est toujours `n+1`, l'arbre est écrit en profondeur d'abord).
 */
interface BvhPart {
  object: Object3D
  position: Float32Array
  index: Uint32Array | null
  tris: Uint32Array
  bounds: Float32Array
  meta: Int32Array
  /** matrixWorld⁻¹ figée à la construction (le décor est gelé). Colonnes majeures. */
  inv: Float64Array
  cull: number
  /** Écartement par triangle — uniquement pour les meshes multi-matériaux. */
  cullPerTri: Uint8Array | null
}

/** L'arbre d'un décor entier : un `BvhPart` par mesh, plus de quoi rendre des comptes. */
export interface EnvBvh {
  parts: BvhPart[]
  /**
   * Ce que l'arbre NE COUVRE PAS, et que l'appelant doit donner à three :
   * peau animée et morph targets (leurs sommets ne sont pas ceux du tampon),
   * Line / Points / Sprite (three les intersecte, l'arbre n'indexe que des
   * triangles), géométrie dont le découpage en triangles serait décalé.
   *
   * Cette liste est le cœur du contrat. Un arbre qui couvre « presque tout »
   * en se taisant sur le reste, c'est un mur qui laisse passer les clics —
   * `lowpoly-restaurant` porte trois segments de ligne décoratifs, et c'est
   * exactement ce qui aurait disparu en silence. L'appelant interroge l'arbre
   * PUIS cette liste, et garde le plus proche des deux : la couverture est
   * alors complète, et le décor n'a pas besoin de renoncer en bloc.
   */
  rest: Object3D[]
  /** Triangles couverts, tous meshes confondus. */
  triangles: number
  /** Millisecondes de construction (mesurées, pas estimées). */
  buildMs: number
  /** Octets détenus par l'arbre : nœuds, permutations, et les copies éventuelles. */
  bytes: number
}

export type BvhStrategy = 'sah' | 'median'

// ── Construction ────────────────────────────────────────────────────────────

/**
 * Positions denses en Float32Array. Le cas courant (attribut serré, non
 * normalisé) est rendu TEL QUEL, sans copie : l'arbre pointe la géométrie du
 * décor. Les attributs interlacés ou d'un autre type sont recopiés — c'est le
 * seul endroit où l'arbre duplique des sommets, et il le dit dans `bytes`.
 */
function densePositions(attr: AttributeLike): { position: Float32Array; copied: boolean } {
  const raw = attr.array
  if (!attr.isInterleavedBufferAttribute && attr.itemSize === 3 && !attr.normalized && raw instanceof Float32Array) {
    return { position: raw, copied: false }
  }
  const out = new Float32Array(attr.count * 3)
  for (let i = 0; i < attr.count; i++) {
    out[i * 3] = attr.getX(i)
    out[i * 3 + 1] = attr.getY(i)
    out[i * 3 + 2] = attr.getZ(i)
  }
  return { position: out, copied: true }
}

/**
 * Bâtit les nœuds d'un lot de triangles déjà bornés. `triBounds` porte 6
 * flottants par triangle (min puis max) ; `tris` est la permutation que le
 * parcours lira, et que la construction réordonne en place.
 */
function buildNodes(
  triBounds: Float32Array,
  tris: Uint32Array,
  strategy: BvhStrategy,
): { bounds: Float32Array; meta: Int32Array } {
  const total = tris.length
  // Un arbre de feuilles pleines compte ~2·(n/LEAF_MAX) nœuds ; on part de là et
  // on double au besoin plutôt que de réserver le pire cas (2n−1 nœuds).
  let capacity = Math.max(16, Math.ceil((2 * total) / LEAF_MAX) + 8)
  let bounds = new Float32Array(6 * capacity)
  let meta = new Int32Array(2 * capacity)
  let nodeCount = 0

  const newNode = (): number => {
    if (nodeCount === capacity) {
      capacity *= 2
      const nb = new Float32Array(6 * capacity)
      nb.set(bounds)
      bounds = nb
      const nm = new Int32Array(2 * capacity)
      nm.set(meta)
      meta = nm
    }
    return nodeCount++
  }

  // Bornes des CENTROÏDES d'un intervalle : c'est sur elles que se choisit l'axe
  // (les bornes du nœud, elles, sont étirées par les gros triangles et
  // désigneraient un axe où rien ne se sépare).
  const cmin = [0, 0, 0]
  const cmax = [0, 0, 0]
  const centroidBounds = (start: number, count: number): void => {
    cmin[0] = cmin[1] = cmin[2] = Infinity
    cmax[0] = cmax[1] = cmax[2] = -Infinity
    for (let i = start; i < start + count; i++) {
      const t6 = tris[i] * 6
      for (let a = 0; a < 3; a++) {
        const c = (triBounds[t6 + a] + triBounds[t6 + 3 + a]) * 0.5
        if (c < cmin[a]) cmin[a] = c
        if (c > cmax[a]) cmax[a] = c
      }
    }
  }

  const centroid = (tri: number, axis: number): number =>
    (triBounds[tri * 6 + axis] + triBounds[tri * 6 + 3 + axis]) * 0.5

  /** Quickselect : place le nᵉ élément à sa place, tout ce qui est avant lui est plus petit. */
  const nthElement = (start: number, end: number, nth: number, axis: number): void => {
    let lo = start
    let hi = end - 1
    while (lo < hi) {
      const pivot = centroid(tris[(lo + hi) >> 1], axis)
      let i = lo
      let j = hi
      while (i <= j) {
        while (centroid(tris[i], axis) < pivot) i++
        while (centroid(tris[j], axis) > pivot) j--
        if (i <= j) {
          const swap = tris[i]
          tris[i] = tris[j]
          tris[j] = swap
          i++
          j--
        }
      }
      if (nth <= j) hi = j
      else if (nth >= i) lo = i
      else return
    }
  }

  // Casiers de la SAH, réutilisés à chaque nœud (aucune allocation en récursion).
  const binMin = new Float32Array(BINS * 3)
  const binMax = new Float32Array(BINS * 3)
  const binCount = new Int32Array(BINS)
  const leftArea = new Float32Array(BINS)
  const leftCount = new Int32Array(BINS)

  const surface = (dx: number, dy: number, dz: number): number =>
    dx <= 0 && dy <= 0 && dz <= 0 ? 0 : 2 * (dx * dy + dy * dz + dz * dx)

  /**
   * Coupe binnée par heuristique de surface. Rend l'indice de séparation dans
   * `tris`, ou −1 si aucune coupe ne bat le coût d'une feuille. Les triangles
   * sont partitionnés en place autour du plan retenu.
   */
  const splitSah = (start: number, count: number, axis: number): number => {
    const lo = cmin[axis]
    const extent = cmax[axis] - lo
    binMin.fill(Infinity)
    binMax.fill(-Infinity)
    binCount.fill(0)
    // (BINS − ε)/extent : un centroïde posé sur la borne haute tombe dans le
    // dernier casier, pas dans un casier BINS qui n'existe pas.
    const k = (BINS * (1 - 1e-6)) / extent
    for (let i = start; i < start + count; i++) {
      const tri = tris[i]
      const b = ((centroid(tri, axis) - lo) * k) | 0
      binCount[b]++
      const t6 = tri * 6
      for (let a = 0; a < 3; a++) {
        if (triBounds[t6 + a] < binMin[b * 3 + a]) binMin[b * 3 + a] = triBounds[t6 + a]
        if (triBounds[t6 + 3 + a] > binMax[b * 3 + a]) binMax[b * 3 + a] = triBounds[t6 + 3 + a]
      }
    }
    // Balayage de gauche : aire et effectif cumulés avant chaque plan.
    let axmin = Infinity
    let aymin = Infinity
    let azmin = Infinity
    let axmax = -Infinity
    let aymax = -Infinity
    let azmax = -Infinity
    let acc = 0
    for (let b = 0; b < BINS - 1; b++) {
      if (binCount[b] > 0) {
        if (binMin[b * 3] < axmin) axmin = binMin[b * 3]
        if (binMin[b * 3 + 1] < aymin) aymin = binMin[b * 3 + 1]
        if (binMin[b * 3 + 2] < azmin) azmin = binMin[b * 3 + 2]
        if (binMax[b * 3] > axmax) axmax = binMax[b * 3]
        if (binMax[b * 3 + 1] > aymax) aymax = binMax[b * 3 + 1]
        if (binMax[b * 3 + 2] > azmax) azmax = binMax[b * 3 + 2]
        acc += binCount[b]
      }
      leftArea[b] = acc === 0 ? 0 : surface(axmax - axmin, aymax - aymin, azmax - azmin)
      leftCount[b] = acc
    }
    // Balayage de droite, et coût au passage.
    axmin = aymin = azmin = Infinity
    axmax = aymax = azmax = -Infinity
    acc = 0
    let best = Infinity
    let bestBin = -1
    for (let b = BINS - 1; b > 0; b--) {
      if (binCount[b] > 0) {
        if (binMin[b * 3] < axmin) axmin = binMin[b * 3]
        if (binMin[b * 3 + 1] < aymin) aymin = binMin[b * 3 + 1]
        if (binMin[b * 3 + 2] < azmin) azmin = binMin[b * 3 + 2]
        if (binMax[b * 3] > axmax) axmax = binMax[b * 3]
        if (binMax[b * 3 + 1] > aymax) aymax = binMax[b * 3 + 1]
        if (binMax[b * 3 + 2] > azmax) azmax = binMax[b * 3 + 2]
        acc += binCount[b]
      }
      if (acc === 0 || leftCount[b - 1] === 0) continue
      const right = surface(axmax - axmin, aymax - aymin, azmax - azmin)
      const cost = leftArea[b - 1] * leftCount[b - 1] + right * acc
      if (cost < best) {
        best = cost
        bestBin = b
      }
    }
    if (bestBin < 0) return -1
    // Coût de la feuille, à la même échelle (l'aire du nœud se simplifie de part
    // et d'autre) : count × aire(nœud). Le +1 est le coût d'un pas de parcours.
    const nodeArea = surface(cmax[0] - cmin[0], cmax[1] - cmin[1], cmax[2] - cmin[2])
    if (count <= LEAF_MAX && best >= nodeArea * count) return -1
    // Partition en place autour du casier retenu.
    let i = start
    let j = start + count - 1
    while (i <= j) {
      const b = ((centroid(tris[i], axis) - lo) * k) | 0
      if (b < bestBin) {
        i++
      } else {
        const swap = tris[i]
        tris[i] = tris[j]
        tris[j] = swap
        j--
      }
    }
    return i
  }

  /**
   * Referme un nœud interne sur ses deux fils. Le fils gauche est `n+1` par
   * construction (l'arbre s'écrit en profondeur d'abord) ; l'index du fils
   * droit est celui que rend la seconde récursion.
   *
   * ⚠ Les deux écritures dans `meta` ont lieu APRÈS les récursions, et ce n'est
   * pas cosmétique. `meta[n * 2] = recurse(…)` évalue sa CIBLE avant son membre
   * droit : la référence du tableau y est celle d'avant l'appel, or `newNode`
   * peut avoir doublé la capacité entre-temps — l'index du fils droit partait
   * alors dans le tableau abandonné, le nœud gardait 0, et le parcours
   * repartait à la racine EN BOUCLE. (Bogue vécu : le banc ne rendait jamais
   * la main.) Passer par une variable locale, c'est la seule protection.
   */
  const internal = (n: number, start: number, mid: number, count: number, depth: number): number => {
    recurse(start, mid - start, depth + 1) // fils gauche = n+1
    const right = recurse(mid, start + count - mid, depth + 1)
    meta[n * 2] = right
    meta[n * 2 + 1] = 0 // 0 triangle = nœud interne
    return n
  }

  const recurse = (start: number, count: number, depth: number): number => {
    const n = newNode()
    // Bornes du nœud : l'union des bornes de ses triangles.
    let bxmin = Infinity
    let bymin = Infinity
    let bzmin = Infinity
    let bxmax = -Infinity
    let bymax = -Infinity
    let bzmax = -Infinity
    for (let i = start; i < start + count; i++) {
      const t6 = tris[i] * 6
      if (triBounds[t6] < bxmin) bxmin = triBounds[t6]
      if (triBounds[t6 + 1] < bymin) bymin = triBounds[t6 + 1]
      if (triBounds[t6 + 2] < bzmin) bzmin = triBounds[t6 + 2]
      if (triBounds[t6 + 3] > bxmax) bxmax = triBounds[t6 + 3]
      if (triBounds[t6 + 4] > bymax) bymax = triBounds[t6 + 4]
      if (triBounds[t6 + 5] > bzmax) bzmax = triBounds[t6 + 5]
    }
    bounds[n * 6] = bxmin
    bounds[n * 6 + 1] = bymin
    bounds[n * 6 + 2] = bzmin
    bounds[n * 6 + 3] = bxmax
    bounds[n * 6 + 4] = bymax
    bounds[n * 6 + 5] = bzmax

    const leaf = (): number => {
      meta[n * 2] = start
      meta[n * 2 + 1] = count
      return n
    }
    if (count <= 2 || depth >= MAX_DEPTH) return leaf()

    centroidBounds(start, count)
    let axis = 0
    let extent = cmax[0] - cmin[0]
    if (cmax[1] - cmin[1] > extent) {
      axis = 1
      extent = cmax[1] - cmin[1]
    }
    if (cmax[2] - cmin[2] > extent) {
      axis = 2
      extent = cmax[2] - cmin[2]
    }
    // Tous les centroïdes confondus : aucune coupe géométrique ne les sépare.
    // Couper par la médiane (donc par la position dans le tableau) reste
    // préférable à une feuille de 10 000 triangles.
    if (!(extent > 0)) {
      if (count <= LEAF_MAX) return leaf()
      const mid = start + (count >> 1)
      return internal(n, start, mid, count, depth)
    }

    let mid = -1
    if (strategy === 'sah') {
      mid = splitSah(start, count, axis)
      if (mid === -1 && count > LEAF_MAX) mid = -2 // la SAH renonce, la taille non
    } else if (count > LEAF_MAX) {
      mid = -2
    }
    if (mid === -2 || (strategy === 'median' && count > LEAF_MAX)) {
      // Repli médian : quickselect sur l'axe choisi, coupe au milieu du lot.
      mid = start + (count >> 1)
      nthElement(start, start + count, mid, axis)
    }
    if (mid <= start || mid >= start + count) return leaf()
    return internal(n, start, mid, count, depth)
  }

  recurse(0, total, 0)
  return { bounds: bounds.slice(0, nodeCount * 6), meta: meta.slice(0, nodeCount * 2) }
}

/**
 * L'arbre d'un mesh — ou pourquoi il n'y en a pas. Les deux raisons de ne rien
 * rendre ne se valent PAS et ne doivent jamais se confondre :
 * - `'vide'` : le mesh n'a aucun triangle. L'ignorer est exact, il n'arrête
 *   aucun rayon.
 * - `'refus'` : le mesh a des triangles que l'arbre ne saurait pas indexer
 *   fidèlement. L'ignorer serait un TROU dans le décor — un mur qui laisse
 *   passer les clics. Tout le décor repasse alors au lancer de rayon de three.
 */
type PartResult = { part: BvhPart; bytes: number } | 'vide' | 'refus'

function buildPart(mesh: Mesh, strategy: BvhStrategy): PartResult {
  const like = mesh as unknown as MeshLike
  const geometry = like.geometry as GeometryLike | undefined
  const attr = geometry?.attributes?.position
  if (!geometry || !attr || attr.count === 0) return 'vide'

  const { position, copied } = densePositions(attr)
  let index: Uint32Array | null = null
  let indexCopied = false
  const idxAttr = geometry.index
  if (idxAttr) {
    const raw = idxAttr.array
    if (raw instanceof Uint32Array) index = raw
    else {
      index = Uint32Array.from(raw)
      indexCopied = true
    }
  }

  // drawRange, comme Mesh.raycast le lit : un intervalle de SOMMETS (ou
  // d'indices), qu'on ramène à un intervalle de triangles.
  const available = index ? index.length : position.length / 3
  const rangeStart = Math.max(0, geometry.drawRange?.start ?? 0)
  const rawCount = geometry.drawRange?.count ?? Infinity
  const rangeEnd = Math.min(available, rangeStart + (Number.isFinite(rawCount) ? rawCount : available))
  // Un triangle de l'arbre, c'est le triplet (3t, 3t+1, 3t+2) : le découpage
  // suppose un début aligné. three, lui, part de `drawRange.start` où qu'il
  // tombe et regroupe par trois À PARTIR DE LÀ — un début non multiple de 3
  // décalerait donc TOUS les triangles. GLTFLoader n'en produit jamais (le
  // drawRange sort intact à {0, ∞}), mais on refuse plutôt que d'indexer un
  // décor de travers.
  if (rangeStart % 3 !== 0) return 'refus'
  const firstTri = rangeStart / 3
  const lastTri = Math.floor(rangeEnd / 3)
  const triCount = lastTri - firstTri
  if (triCount <= 0) return 'vide'

  // Bornes de chaque triangle, en espace local. Tableau TEMPORAIRE : il meurt
  // avec la construction, seul l'arbre survit.
  const triBounds = new Float32Array(triCount * 6)
  const tris = new Uint32Array(triCount)
  for (let t = 0; t < triCount; t++) {
    const t3 = (firstTri + t) * 3
    const a = (index ? index[t3] : t3) * 3
    const b = (index ? index[t3 + 1] : t3 + 1) * 3
    const c = (index ? index[t3 + 2] : t3 + 2) * 3
    for (let k = 0; k < 3; k++) {
      const va = position[a + k]
      const vb = position[b + k]
      const vc = position[c + k]
      triBounds[t * 6 + k] = Math.min(va, vb, vc)
      triBounds[t * 6 + 3 + k] = Math.max(va, vb, vc)
    }
    tris[t] = firstTri + t
  }

  const { bounds, meta } = buildNodes(triBounds, tris, strategy)

  // Écartement des faces. Un mesh multi-matériaux le décide par GROUPE : on le
  // fige alors triangle par triangle (un octet chacun), sinon un seul scalaire.
  const material = like.material
  let cull = CULL_BACK
  let cullPerTri: Uint8Array | null = null
  if (Array.isArray(material)) {
    const groups = geometry.groups ?? []
    if (groups.length > 0) {
      cullPerTri = new Uint8Array(triCount)
      cullPerTri.fill(cullOf(material[0]))
      for (const g of groups) {
        const gc = cullOf(material[g.materialIndex ?? 0])
        const from = Math.max(firstTri, Math.floor(g.start / 3))
        const to = Math.min(lastTri, Math.floor((g.start + g.count) / 3))
        for (let t = from; t < to; t++) cullPerTri[t - firstTri] = gc
      }
    } else {
      cull = cullOf(material[0])
    }
  } else {
    cull = cullOf(material)
  }

  const inv = new Float64Array(new Matrix4().copy(mesh.matrixWorld).invert().elements)

  const bytes =
    bounds.byteLength +
    meta.byteLength +
    tris.byteLength +
    (cullPerTri ? cullPerTri.byteLength : 0) +
    (copied ? position.byteLength : 0) +
    (indexCopied && index ? index.byteLength : 0)

  return {
    part: { object: mesh, position, index, tris, bounds, meta, inv, cull, cullPerTri },
    bytes,
  }
}

/**
 * Construit l'arbre d'un décor entier. À appeler UNE FOIS, après le gel des
 * matrices (elles sont lues telles quelles et figées dans l'arbre).
 *
 * Rend `null` quand il n'y a RIEN à indexer — l'appelant garde alors le lancer
 * de rayon de three sur tout le décor. Dans tous les autres cas l'arbre couvre
 * ce qu'il sait couvrir et NOMME le reste dans `rest` : il n'y a pas de
 * renoncement en bloc, et surtout pas de trou silencieux.
 */
export function buildEnvBvh(root: Object3D, strategy: BvhStrategy = 'sah'): EnvBvh | null {
  const t0 = performance.now()
  const parts: BvhPart[] = []
  const rest: Object3D[] = []
  let triangles = 0
  let bytes = 0

  const meshes: Mesh[] = []
  root.traverse((node) => {
    if (node instanceof Mesh) {
      // Peau animée ou morph targets : les sommets rendus ne sont pas ceux du
      // tampon, aucun arbre bâti dessus ne dirait la vérité. À three.
      if (node instanceof SkinnedMesh || (node as unknown as MeshLike).morphTargetInfluences) rest.push(node)
      else meshes.push(node)
      return
    }
    // Ce qui n'est pas un Mesh mais que three sait quand même intersecter, et
    // qui doit donc continuer d'arrêter les clics : Line, LineSegments, Points,
    // Sprite. On les reconnaît à leur géométrie plutôt qu'à leur classe — un
    // type exotique d'un .glb importé tombera dans le même filet.
    const like = node as unknown as { geometry?: unknown; isSprite?: boolean }
    if (like.geometry !== undefined || like.isSprite === true) rest.push(node)
  })

  for (const mesh of meshes) {
    const built = buildPart(mesh, strategy)
    if (built === 'refus') {
      rest.push(mesh) // indexable de travers vaut moins que pas indexé du tout
      continue
    }
    if (built === 'vide') continue // aucun triangle : rien à toucher, rien à représenter
    parts.push(built.part)
    bytes += built.bytes
    triangles += built.part.tris.length
  }
  if (parts.length === 0) return null
  return { parts, rest, triangles, buildMs: performance.now() - t0, bytes }
}

// ── Requête ─────────────────────────────────────────────────────────────────

const stackNode = new Int32Array(STACK_MAX)
const stackT = new Float64Array(STACK_MAX)

/**
 * Distance d'ENTRÉE dans la boîte d'un nœud, ou +Infinity si le rayon la rate,
 * la laisse derrière lui, ou n'y entre qu'au-delà de `tFar`.
 *
 * L'ordre des bornes est choisi par le SIGNE de l'inverse, et les NaN sont
 * rattrapés axe par axe : c'est `Ray.intersectBox` de three, repris tel quel.
 * Ce n'est pas de la superstition — `0 × ∞` (rayon parallèle à un axe, origine
 * pile sur un plan de la boîte) donne NaN, et toute comparaison avec NaN étant
 * fausse, un `Math.min` ou un `a < b ? a : b` propage le NaN au lieu de laisser
 * les DEUX AUTRES axes trancher. La boîte était alors déclarée ratée, et le
 * BVH renvoyait « rien » là où three touchait le sol : la vue de dessus d'un
 * décor centré sur l'origine tombe exactement dans ce cas.
 *
 * `tNear` rabote l'entrée (origine à l'intérieur de la boîte) : la valeur rendue
 * ne sert qu'à ORDONNER le parcours et à l'élaguer, jamais à mesurer un impact.
 */
function slabEnter(
  bounds: Float32Array,
  n: number,
  ox: number,
  oy: number,
  oz: number,
  ix: number,
  iy: number,
  iz: number,
  tNear: number,
  tFar: number,
): number {
  const b = n * 6
  let tmin: number
  let tmax: number
  if (ix >= 0) {
    tmin = (bounds[b] - ox) * ix
    tmax = (bounds[b + 3] - ox) * ix
  } else {
    tmin = (bounds[b + 3] - ox) * ix
    tmax = (bounds[b] - ox) * ix
  }
  let amin: number
  let amax: number
  if (iy >= 0) {
    amin = (bounds[b + 1] - oy) * iy
    amax = (bounds[b + 4] - oy) * iy
  } else {
    amin = (bounds[b + 4] - oy) * iy
    amax = (bounds[b + 1] - oy) * iy
  }
  if (tmin > amax || amin > tmax) return Infinity
  if (amin > tmin || tmin !== tmin) tmin = amin
  if (amax < tmax || tmax !== tmax) tmax = amax
  if (iz >= 0) {
    amin = (bounds[b + 2] - oz) * iz
    amax = (bounds[b + 5] - oz) * iz
  } else {
    amin = (bounds[b + 5] - oz) * iz
    amax = (bounds[b + 2] - oz) * iz
  }
  if (tmin > amax || amin > tmax) return Infinity
  if (amin > tmin || tmin !== tmin) tmin = amin
  if (amax < tmax || tmax !== tmax) tmax = amax
  if (tmax < tNear) return Infinity
  const enter = tmin > tNear ? tmin : tNear
  return enter < tFar ? enter : Infinity
}

/**
 * Möller–Trumbore. Rend `t` (la distance MONDE, puisque la direction locale
 * n'est pas renormalisée) ou −1.
 *
 * `cull` reproduit le tri de faces de three au cas près. Le déterminant vaut
 * l'OPPOSÉ de `direction · normale`, d'où l'inversion des signes par rapport à
 * l'écriture usuelle. three ne se donne AUCUNE tolérance là-dessus : elle
 * écarte le triangle sur le signe strict, et sur l'égalité exacte à zéro quand
 * le matériau est DoubleSide. Un epsilon ici écarterait des faces rasantes que
 * three touche — et sur un sol vu de loin, les faces rasantes sont la moitié
 * de l'image. Une division par un déterminant nul ne peut pas produire de faux
 * impact : les barycentriques deviennent NaN, `t` aussi, et NaN échoue au test
 * de distance ; c'est l'unique cas que le zéro strict écarte pour la forme.
 */
function intersectTriangle(
  p: Float32Array,
  a: number,
  b: number,
  c: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cull: number,
): number {
  const ax = p[a]
  const ay = p[a + 1]
  const az = p[a + 2]
  const e1x = p[b] - ax
  const e1y = p[b + 1] - ay
  const e1z = p[b + 2] - az
  const e2x = p[c] - ax
  const e2y = p[c + 1] - ay
  const e2z = p[c + 2] - az
  const px = dy * e2z - dz * e2y
  const py = dz * e2x - dx * e2z
  const pz = dx * e2y - dy * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (cull === CULL_BACK) {
    if (det <= 0) return -1
  } else if (cull === CULL_FRONT) {
    if (det >= 0) return -1
  } else if (det === 0) return -1
  const invDet = 1 / det
  const tx = ox - ax
  const ty = oy - ay
  const tz = oz - az
  const u = (tx * px + ty * py + tz * pz) * invDet
  if (u < 0 || u > 1) return -1
  const qx = ty * e1z - tz * e1y
  const qy = tz * e1x - tx * e1z
  const qz = tx * e1y - ty * e1x
  const v = (dx * qx + dy * qy + dz * qz) * invDet
  if (v < 0 || u + v > 1) return -1
  return (e2x * qx + e2y * qy + e2z * qz) * invDet
}

/**
 * Premier impact du rayon dans le décor, ou null.
 *
 * `origin`/`direction` sont ceux du monde (`raycaster.ray`) ; `direction` est
 * unitaire, comme three la fabrique. `accept` filtre PAR MESH, avant tout
 * parcours : passer `estOpaqueAuClic` rend exactement ce que
 * `premierImpactVisible(raycaster.intersectObject(envRoot, true))` rendait,
 * mais sans construire la liste triée de tous les impacts.
 */
export function raycastFirst(
  bvh: EnvBvh,
  origin: Vector3,
  direction: Vector3,
  accept: (object: Object3D) => boolean,
  near = 0,
  far = Infinity,
): Intersection | null {
  const wox = origin.x
  const woy = origin.y
  const woz = origin.z
  const wdx = direction.x
  const wdy = direction.y
  const wdz = direction.z
  const tNear = near > 0 ? near : 0
  let best = far
  let bestObject: Object3D | null = null

  for (const part of bvh.parts) {
    if (!accept(part.object)) continue
    const m = part.inv
    // Rayon amené en espace local. La direction n'est PAS renormalisée : `t`
    // reste donc la distance monde, et `best` élague d'un mesh à l'autre.
    const ox = m[0] * wox + m[4] * woy + m[8] * woz + m[12]
    const oy = m[1] * wox + m[5] * woy + m[9] * woz + m[13]
    const oz = m[2] * wox + m[6] * woy + m[10] * woz + m[14]
    const dx = m[0] * wdx + m[4] * wdy + m[8] * wdz
    const dy = m[1] * wdx + m[5] * wdy + m[9] * wdz
    const dz = m[2] * wdx + m[6] * wdy + m[10] * wdz
    const ix = 1 / dx
    const iy = 1 / dy
    const iz = 1 / dz

    const bounds = part.bounds
    const meta = part.meta
    if (slabEnter(bounds, 0, ox, oy, oz, ix, iy, iz, tNear, best) === Infinity) continue

    const position = part.position
    const index = part.index
    const tris = part.tris
    const cullPerTri = part.cullPerTri
    const cull = part.cull
    let node = 0
    let ptr = 0
    for (;;) {
      const count = meta[node * 2 + 1]
      if (count === 0) {
        const left = node + 1
        const right = meta[node * 2]
        const tl = slabEnter(bounds, left, ox, oy, oz, ix, iy, iz, tNear, best)
        const tr = slabEnter(bounds, right, ox, oy, oz, ix, iy, iz, tNear, best)
        // Le plus proche d'abord : l'autre attend sur la pile, et sera peut-être
        // jeté sans être ouvert si un triangle du premier fait mieux.
        if (tl <= tr) {
          if (tr < best && ptr < STACK_MAX) {
            stackNode[ptr] = right
            stackT[ptr] = tr
            ptr++
          }
          if (tl < best) {
            node = left
            continue
          }
        } else {
          if (tl < best && ptr < STACK_MAX) {
            stackNode[ptr] = left
            stackT[ptr] = tl
            ptr++
          }
          if (tr < best) {
            node = right
            continue
          }
        }
      } else {
        const start = meta[node * 2]
        for (let i = start; i < start + count; i++) {
          const tri = tris[i]
          const t3 = tri * 3
          const a = (index ? index[t3] : t3) * 3
          const b = (index ? index[t3 + 1] : t3 + 1) * 3
          const c = (index ? index[t3 + 2] : t3 + 2) * 3
          const t = intersectTriangle(
            position,
            a,
            b,
            c,
            ox,
            oy,
            oz,
            dx,
            dy,
            dz,
            cullPerTri ? cullPerTri[i] : cull,
          )
          if (t >= tNear && t < best) {
            best = t
            bestObject = part.object
          }
        }
      }
      // Dépilage, en jetant au passage ce que le meilleur impact a périmé.
      let popped = -1
      while (ptr > 0) {
        ptr--
        if (stackT[ptr] < best) {
          popped = stackNode[ptr]
          break
        }
      }
      if (popped < 0) break
      node = popped
    }
  }

  if (!bestObject) return null
  return {
    distance: best,
    point: new Vector3(wox + wdx * best, woy + wdy * best, woz + wdz * best),
    object: bestObject,
  }
}
