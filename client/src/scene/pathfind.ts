// La recherche de chemin de la scène vivante : passer de « tout droit ou rien »
// à « par les allées ».
//
// RÈGLE DU FICHIER, la même que sceneMap et wander : aucun import de `three`,
// aucune référence au DOM — que des nombres. C'est ce qui permet de compter les
// assises atteignables sous Node, sans ouvrir un navigateur, alors que personne
// ici ne peut voir le rendu.
//
// À LA DEMANDE SEULEMENT, jamais par image. Un clic, une destination de
// déambulation, une assise : trois occasions par minute, pas soixante par
// seconde. Les grilles livrées font de 1 408 à 6 525 cases — l'A* s'y compte en
// dizaines de microsecondes, mais appelé chaque image il n'aurait aucune raison
// d'exister, et la scène vivante n'a pas de budget à gaspiller.
//
// CE QU'IL NE FAIT PAS : ouvrir un passage. Une case où le gabarit ne tient pas
// reste infranchissable, et le couloir en S de la chambre (40 à 60 cm pour un
// corps de 50) reste refusé. Ce chemin-là n'existe pas ; c'est un fait de la
// pièce, pas une limite du moteur.

/**
 * La grille du sol praticable, telle que sceneMap la décode. On la reçoit brute
 * plutôt que par accesseurs : l'A* la relit des milliers de fois par requête, et
 * un appel de fonction par case coûterait plus cher que la recherche elle-même.
 */
export interface PathGrid {
  readonly cols: number
  readonly rows: number
  /** Côté d'une case (m). */
  readonly cell: number
  /** Coin (x, z) de la case (0, 0), en coordonnées de scène. */
  readonly originX: number
  readonly originZ: number
  /** Altitude de chaque case (m), indexée `j * cols + i`. */
  readonly heights: Float32Array
  /** 1 = la case porte du sol. Même indexation que `heights`. */
  readonly solid: Uint8Array
  /** Dénivelé franchissable d'une case à sa voisine (m). */
  readonly step: number
}

/**
 * Ce que la carte sait répondre d'un POINT quelconque — pas d'une case. Le
 * lissage s'en sert pour ses lignes de vue : il doit poser exactement la même
 * question que `pathClear` de wander.ts, sinon il rendrait des segments que le
 * moteur refuserait ensuite un par un.
 */
export interface PathProbe {
  canStand(x: number, z: number, radius: number, fromY?: number): boolean
  floorAt(x: number, z: number): number | null
}

/** Une étape du chemin, en coordonnées de scène. */
export interface Waypoint {
  x: number
  z: number
}

export interface Pathfinder {
  /**
   * Étapes à enchaîner pour aller de (fromX, fromZ) à (toX, toZ) au gabarit
   * `radius`, la dernière étant l'arrivée. `null` : aucun chemin — et c'est une
   * réponse, pas une panne.
   *
   * Le départ comme l'arrivée sont RECALÉS sur la case praticable la plus
   * proche, dans la limite de `SNAP_M`. Sans ce recalage, aucune assise ne
   * serait jamais routable : sa case d'approche est collée au meuble, donc
   * refusée au disque par construction (66 refus sur 66, mesuré). C'est la même
   * zone de manœuvre que le moteur s'accorde sur ses derniers centimètres.
   */
  path(fromX: number, fromZ: number, toX: number, toZ: number, radius: number): Waypoint[] | null
}

const SQRT2 = Math.SQRT2

/**
 * Jusqu'où l'on accepte de déplacer le départ ou l'arrivée pour tomber sur une
 * case où le gabarit tient. C'est `MANEUVER_M` de wander.ts, à cinq centimètres
 * près : au-delà, on ne recale plus, on change d'endroit.
 */
const SNAP_M = 0.75

/**
 * Pas d'échantillonnage des lignes de vue du lissage (m), borné par la maille.
 * PLUS FIN que le `PATH_STEP` de wander (15 cm), et c'est voulu : un lissage
 * plus sévère que le vérificateur du moteur ne produit que des segments qu'il
 * acceptera. L'inverse fabriquerait des chemins refusés segment par segment.
 */
const LOS_STEP_M = 0.05

export function createPathfinder(grid: PathGrid, probe: PathProbe): Pathfinder {
  const { cols, rows, cell, originX, originZ, heights, solid, step } = grid
  const n = cols * rows
  const losStep = Math.min(cell * 0.5, LOS_STEP_M)

  // Tableaux de travail alloués UNE FOIS. Le marquage se fait par numéro de
  // requête (`gen`) plutôt que par remise à zéro : une grille de salle de classe
  // ferait 6 525 écritures inutiles à chaque clic, et surtout ce serait trois
  // occasions de plus d'oublier un tableau.
  const gScore = new Float32Array(n)
  const fScore = new Float32Array(n)
  const cameFrom = new Int32Array(n)
  const seenGen = new Int32Array(n)
  const doneGen = new Int32Array(n)
  let gen = 0

  /**
   * Carte de PRATICABILITÉ AU GABARIT : 1 = le disque du corps tient, centré sur
   * cette case. Calculée une fois par rayon, à la première requête — un décor où
   * l'on ne clique jamais ne la paie pas. C'est elle qui fait que l'A* ne peut
   * PAS inventer de passage : il ne circule que sur des cases déjà validées au
   * disque, exactement celles où le moteur accepterait de se tenir.
   */
  let standRadius = -1
  let standMap: Uint8Array | null = null
  function standable(radius: number): Uint8Array {
    if (standMap && standRadius === radius) return standMap
    const m = new Uint8Array(n)
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i
        if (!solid[k]) continue
        if (probe.canStand(originX + (i + 0.5) * cell, originZ + (j + 0.5) * cell, radius)) m[k] = 1
      }
    }
    standMap = m
    standRadius = radius
    return m
  }

  function centerX(k: number): number {
    return originX + ((k % cols) + 0.5) * cell
  }
  function centerZ(k: number): number {
    return originZ + (Math.floor(k / cols) + 0.5) * cell
  }

  /** Case sous (x, z), ou −1 hors grille. */
  function cellAt(x: number, z: number): number {
    const i = Math.floor((x - originX) / cell)
    const j = Math.floor((z - originZ) / cell)
    if (i < 0 || j < 0 || i >= cols || j >= rows) return -1
    return j * cols + i
  }

  /**
   * Case praticable au gabarit la plus proche de (x, z), dans `SNAP_M`. C'est le
   * point d'entrée et de sortie de l'A* : le personnage peut se tenir dans un
   * recoin serré (il vient de se lever contre un meuble), et la destination peut
   * être une case d'approche collée à une chaise.
   */
  function snap(x: number, z: number, std: Uint8Array): number {
    const here = cellAt(x, z)
    if (here >= 0 && std[here]) return here
    const span = Math.ceil(SNAP_M / cell)
    const i0 = Math.floor((x - originX) / cell)
    const j0 = Math.floor((z - originZ) / cell)
    let best = -1
    let bestD = SNAP_M * SNAP_M
    for (let dj = -span; dj <= span; dj++) {
      const j = j0 + dj
      if (j < 0 || j >= rows) continue
      for (let di = -span; di <= span; di++) {
        const i = i0 + di
        if (i < 0 || i >= cols) continue
        const k = j * cols + i
        if (!std[k]) continue
        const dx = centerX(k) - x
        const dz = centerZ(k) - z
        const d = dx * dx + dz * dz
        if (d < bestD) {
          bestD = d
          best = k
        }
      }
    }
    return best
  }

  /** Distance octile (le coût exact d'un déplacement à 8 voisins) — admissible. */
  function heuristic(i: number, j: number, gi: number, gj: number): number {
    const dx = Math.abs(i - gi)
    const dz = Math.abs(j - gj)
    return (dx + dz + (SQRT2 - 2) * Math.min(dx, dz)) * cell
  }

  // ── Tas binaire des cases à explorer, ordonné par `fScore` ─────────────────
  // Une file de priorité plutôt qu'un tableau trié : elle dépasse rarement la
  // centaine d'entrées, mais l'insertion triée la rendrait quadratique pour rien.
  const heap: number[] = []
  function heapPush(k: number): void {
    heap.push(k)
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (fScore[heap[parent]] <= fScore[heap[i]]) break
      const t = heap[parent]
      heap[parent] = heap[i]
      heap[i] = t
      i = parent
    }
  }
  function heapPop(): number {
    const top = heap[0]
    const last = heap.pop() as number
    if (heap.length > 0) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        let m = i
        if (l < heap.length && fScore[heap[l]] < fScore[heap[m]]) m = l
        if (l + 1 < heap.length && fScore[heap[l + 1]] < fScore[heap[m]]) m = l + 1
        if (m === i) break
        const t = heap[m]
        heap[m] = heap[i]
        heap[i] = t
        i = m
      }
    }
    return top
  }

  /** A* de case à case. Rend la suite des cases (départ inclus), ou null. */
  function search(startK: number, goalK: number, std: Uint8Array): number[] | null {
    gen++
    heap.length = 0
    const gi = goalK % cols
    const gj = Math.floor(goalK / cols)
    seenGen[startK] = gen
    gScore[startK] = 0
    fScore[startK] = heuristic(startK % cols, Math.floor(startK / cols), gi, gj)
    cameFrom[startK] = -1
    heapPush(startK)
    while (heap.length > 0) {
      const cur = heapPop()
      if (doneGen[cur] === gen) continue // doublon du tas (suppression paresseuse)
      doneGen[cur] = gen
      if (cur === goalK) {
        const cells: number[] = []
        for (let k = cur; k >= 0; k = cameFrom[k]) cells.push(k)
        cells.reverse()
        return cells
      }
      const ci = cur % cols
      const cj = Math.floor(cur / cols)
      const ch = heights[cur]
      const g0 = gScore[cur]
      for (let dj = -1; dj <= 1; dj++) {
        const nj = cj + dj
        if (nj < 0 || nj >= rows) continue
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue
          const ni = ci + di
          if (ni < 0 || ni >= cols) continue
          const nk = nj * cols + ni
          if (!std[nk] || doneGen[nk] === gen) continue
          if (Math.abs(heights[nk] - ch) > step) continue
          let cost = cell
          if (di !== 0 && dj !== 0) {
            // PAS DE COIN COUPÉ : une diagonale n'est franchie que si les deux
            // cases orthogonales le sont aussi. Sans cette garde, le chemin
            // frôlerait l'angle du meuble et le lissage prendrait ce frôlement
            // pour un raccourci — c'est ainsi qu'un personnage traverse un
            // montant de porte par le coin.
            const a = cj * cols + ni
            const b = nj * cols + ci
            if (!std[a] || !std[b]) continue
            if (Math.abs(heights[a] - ch) > step || Math.abs(heights[b] - ch) > step) continue
            cost = cell * SQRT2
          }
          const ng = g0 + cost
          if (seenGen[nk] === gen && ng >= gScore[nk]) continue
          seenGen[nk] = gen
          gScore[nk] = ng
          cameFrom[nk] = cur
          fScore[nk] = ng + heuristic(ni, nj, gi, gj)
          heapPush(nk)
        }
      }
    }
    return null
  }

  /**
   * La ligne de vue du LISSAGE — le calque exact de `pathClear` de wander.ts,
   * échantillonnage en plus fin : sol praticable au disque tout du long, et
   * jamais plus d'une marche au-dessus ou en dessous de l'altitude de DÉPART.
   * `tail` et `head` reprennent sa zone de manœuvre : sur ces longueurs-là, aux
   * deux bouts, le gabarit passe du disque au POINT. Sans les recopier ici, le
   * lissage refuserait des segments que le moteur, lui, accepte — et couperait
   * le chemin juste avant la chaise.
   */
  function clear(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    radius: number,
    tail = 0,
    head = 0,
  ): boolean {
    const from = probe.floorAt(ax, az) ?? undefined
    const d = Math.hypot(bx - ax, bz - az)
    const steps = Math.max(1, Math.ceil(d / losStep))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const r = d * (1 - t) < tail || d * t < head ? 0 : radius
      if (!probe.canStand(ax + (bx - ax) * t, az + (bz - az) * t, r, from)) return false
    }
    return true
  }

  /**
   * LISSAGE (string pulling). Un chemin de cases est un escalier : quarante
   * petits pas orthogonaux et diagonaux là où deux segments droits suffisent.
   * On tend donc la ficelle — depuis le point courant, on avance sur le chemin
   * tant que la vue porte, et l'on ne pose une étape qu'au dernier point encore
   * visible. Ce qui reste est la suite des VRAIS coins, et entre eux le
   * personnage prend la diagonale au lieu de longer les cases.
   */
  function pull(sx: number, sz: number, pts: Waypoint[], radius: number): Waypoint[] {
    // Partir d'un recoin serré est permis (on vient de se lever contre un
    // meuble) ; y entrer ne l'est pas. C'est la règle du moteur, mot pour mot.
    const head = probe.canStand(sx, sz, radius) ? 0 : SNAP_M
    const out: Waypoint[] = []
    let ax = sx
    let az = sz
    let i = 0
    while (i < pts.length) {
      let j = i
      // Le point suivant est toujours retenu, même si la vue n'y porte pas :
      // deux cases voisines peuvent se refuser au disque là où le chemin, lui,
      // existe. Le moteur raccourcira ce segment-là — c'est ce qu'il sait faire.
      while (
        j + 1 < pts.length &&
        clear(ax, az, pts[j + 1].x, pts[j + 1].z, radius, j + 2 === pts.length ? SNAP_M : 0, out.length === 0 ? head : 0)
      )
        j++
      out.push(pts[j])
      ax = pts[j].x
      az = pts[j].z
      i = j + 1
    }
    return out
  }

  return {
    path(fromX, fromZ, toX, toZ, radius) {
      // ON NE ROUTE PAS VERS CE QUI N'EST PAS SUR LA CARTE. Le point de
      // pré-assise, lui, frôle le meuble jusqu'à en sortir : rendre null ici,
      // c'est laisser le moteur essayer la case d'approche ensuite — le repli
      // qu'il pratique depuis toujours. Recaler ce point sur la case praticable
      // la plus proche, au contraire, ferait réussir un itinéraire qui dépose le
      // personnage un demi-pas trop loin de son siège, et lui volerait le repli.
      if (probe.floorAt(toX, toZ) === null) return null
      const std = standable(radius)
      const startK = snap(fromX, fromZ, std)
      const goalK = snap(toX, toZ, std)
      // Rien à router : hors grille, ou trop loin de tout sol praticable. Le
      // moteur reprend alors sa ligne droite d'avant.
      if (startK < 0 || goalK < 0) return null
      const cells = startK === goalK ? [startK] : search(startK, goalK, std)
      if (!cells) return null
      const pts: Waypoint[] = []
      for (let i = 1; i < cells.length; i++) pts.push({ x: centerX(cells[i]), z: centerZ(cells[i]) })
      // La destination EXACTE en dernier, dès qu'elle a du sol — même si le
      // disque n'y tient pas. C'est LE point qui rend les assises joignables :
      // leur case d'approche est collée au meuble, donc refusée au disque par
      // construction, et l'A* s'arrêterait sinon à la case praticable la plus
      // proche, c'est-à-dire à un demi-pas de trop. Les derniers centimètres
      // sont l'affaire de la zone de manœuvre du moteur, qui existe pour ça.
      const last = pts[pts.length - 1]
      if (
        probe.floorAt(toX, toZ) !== null &&
        (!last || Math.abs(last.x - toX) > 1e-6 || Math.abs(last.z - toZ) > 1e-6)
      ) {
        pts.push({ x: toX, z: toZ })
      }
      if (pts.length === 0) return null
      return pull(fromX, fromZ, pts, radius)
    },
  }
}
