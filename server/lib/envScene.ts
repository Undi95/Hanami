// Analyse d'un décor 3D : du .glb à la carte que le moteur client lira.
//
// Le principe du chantier : le moteur plie l'animation à la scène, jamais
// l'inverse. Pour ça il lui faut une description du décor qui ne dépende NI du
// décor NI du modèle VRM — d'où ce fichier, qui ne connaît aucun des trois
// décors livrés et ne filtre rien par « compatibilité ». Il dit ce qui EST :
// où est le sol, à quelle hauteur, ce qui bloque, sur quoi on peut s'asseoir.
// C'est le moteur, par sa cinématique inverse, qui adapte la pose.
//
// Le décor est mesuré TEL QU'IL SERA AFFICHÉ : la même échelle, la même
// rotation et le même calage au sol que `fitEnvironment()` de vrmStage.ts,
// reproduits ici à l'identique (cf. placeModel). Le repère de sortie est donc
// exactement celui de la scène : origine aux pieds de l'avatar, Y vers le haut,
// mètres, l'avatar regardant +Z.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { SceneFile, SceneSeat } from '../../shared/types'
import { GlbUnsupportedError, loadGlb, mat4ApplyPoint, mat4Multiply, mat4YawScale, type GlbModel, type Mat4 } from './glb'

export const SCENE_FORMAT = 'hanami-scene'
/** Version du FORMAT du fichier produit. L'incrémenter force la régénération de tous les décors. */
export const SCENE_VERSION = 1
/** Extension du fichier d'analyse, posé à côté du .glb : `chambre.glb` → `chambre.scene.json`. */
export const SCENE_EXT = '.scene.json'

// ── Réglages de l'analyse ──────────────────────────────────────────────────
// Tout ce qui suit est un choix de mesure, pas une propriété d'un décor : les
// valeurs sont recopiées dans le fichier produit (bloc `body`) pour qu'on
// puisse relire une analyse sans deviner sous quelles hypothèses elle a été faite.

/** Pas de la grille de sol livrée (m). 10 cm résout une allée de 60 cm et un couloir de 25 cm. */
const CELL = 0.1
/** Pas de la grille de repérage, qui sert seulement à trouver où est la pièce (m). */
const COARSE_CELL = 0.25
/** Épaisseur des tranches verticales d'occupation (m) : la précision d'une hauteur d'assise. */
const VBIN = 0.05
const COARSE_VBIN = 0.1
/** Pas du sous-échantillonnage barycentrique des triangles (m) : un mur de 3 m ne doit pas marquer une seule cellule. */
const SAMPLE_STEP = 0.05
const COARSE_SAMPLE_STEP = 0.15
/** Garde-fou : nombre max de subdivisions par arête d'un triangle. */
const MAX_SUBDIV = 128
/** Rayon max analysé autour du point d'accueil (m) — au-delà, ce n'est plus la pièce. */
const WORLD_RADIUS = 24
/** Tranche verticale analysée, relative au sol de la scène (m). */
const Y_MIN = -1.5
const Y_MAX = 4.5

/** Gabarit de référence. L'avatar est mis à l'échelle à 1,6 m par vrmStage.ts (`1.6 / rawHeight`). */
const BODY_HEIGHT = 1.6
const BODY_RADIUS = 0.25
/**
 * Dénivelé franchissable d'une cellule à la suivante (marche, estrade, tapis).
 * 20 cm, la hauteur d'une contremarche : au-delà on n'enjambe plus, on escalade.
 * À 30 cm, le personnage du loft montait sur un tabouret de 0,30 m, puis de là
 * sur la table de 0,59 m, puis sur la commode — chaque meuble devenait du sol.
 */
const STEP_MAX = 0.2

/** n·Y au-delà duquel une face est « posable » (≈ 45°). */
const UP_NORMAL = 0.7
/** |n·Y| en deçà duquel une face est « dressée » : mur, dossier, flanc de meuble. */
const VERTICAL_NORMAL = 0.5
/** Aire minimale, dans une tranche, pour qu'elle compte comme occupée (m²) — ignore un fil, garde une cloison. */
const OCC_MIN_AREA = 0.0005

/** Fraction de l'aire d'une cellule qu'une nappe horizontale doit couvrir pour compter comme surface. */
const SURFACE_COVER = 0.25
/** Idem, plus exigeant, pour qu'une nappe compte comme assise. */
const SEAT_COVER = 0.35

/** Hauteur d'assise plausible, au-dessus du sol local (m). Un lit, une marche, une caisse comptent. */
const SEAT_MIN = 0.15
const SEAT_MAX = 0.95
/** Dégagement exigé au-dessus d'une assise (m) : un buste, pas un corps debout. Jugé sur la nappe entière. */
const SEAT_HEADROOM = 0.55
/** Nappes candidates retenues par case : au-delà, c'est un mur de rondins ou une étagère, pas un siège. */
const MAX_SEAT_SURFACES = 6
/** Aire minimale d'une assise (m²) — 30 × 30 cm. */
const SEAT_MIN_AREA = 0.09
/**
 * Écart d'altitude toléré entre deux cellules VOISINES d'une même assise (m).
 * Généreux à dessein : un matelas ou un pouf ondule de 10 cm d'un bout à
 * l'autre, et le découper en confettis ne rendrait service à personne. Deux
 * meubles distincts sont séparés par du vide, pas par 10 cm de dénivelé.
 */
const SEAT_LEVEL_TOL = 0.1
const MAX_SEATS = 200

/** Tolérance de regroupement des altitudes de sol en « niveaux » (m). */
const LEVEL_TOL = 0.02
/** Un caractère par niveau. 62 niveaux : au-delà, les plus proches fusionnent. */
const LEVEL_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const CHAR_VOID = '.'
const CHAR_BLOCKED = '#'
const CHAR_ISLAND = '~'

/** Marge de sol conservée autour de la zone atteignable dans la carte livrée (cellules). */
const MAP_MARGIN = 10
/** Marge autour de la zone repérée pour construire la grille fine (m). */
const FINE_MARGIN = 2

const DEG2RAD = Math.PI / 180
/** Bornes de plausibilité de la hauteur d'une pièce — recopiées de vrmStage.ts. */
const ENV_MIN_HEIGHT = 1.5
const ENV_MAX_HEIGHT = 12
const ENV_TARGET_HEIGHT = 2.6

/** Hauteur d'objectif de la caméra de la scène (vrmStage.ts) — sert à la rose de dégagement. */
const EYE_HEIGHT = 1.3
const ROSE_DIRECTIONS = 16

// ── Calage automatique du point d'accueil ──────────────────────────────────
// « C'est la map qui s'adapte à nous » : un décor dont l'origine n'est pas au
// sol praticable ne doit plus donner un écran noir muet. L'analyse SAIT où est
// le sol et où l'on marche — elle propose donc elle-même un point d'accueil,
// que le client applique exactement comme un `spawn` de sidecar.
//
// Elle ne le fait QUE si le sidecar n'en donne pas ET que l'origine ne fait pas
// l'affaire : la parole de l'auteur (sidecar) passe avant, et l'origine d'un
// décor propre EST le point voulu — la déplacer « pour faire mieux » serait
// défaire un placement réglé à la main.

/**
 * Écart toléré entre le sol de la pièce et les pieds de l'avatar (m). Au-delà,
 * il flotte ou il est enterré. La moitié d'une contremarche : les sept décors
 * livrés tiennent tous à 5 mm près, aucun n'en approche.
 */
const SPAWN_GROUND_TOL = 0.1
/** Dégagement max, toutes directions, en deçà duquel l'objectif est DANS la géométrie (m). */
const SPAWN_BLIND = 0.3
/** Pas d'échantillonnage des candidats (m) : peser deux points distants de 10 cm n'apprend rien. */
const SPAWN_STRIDE = 0.3
/** Nombre de candidats réellement pesés à la rose — c'est la partie chère du choix. */
const SPAWN_MAX_CANDIDATES = 256
/**
 * Recul dont l'objectif a besoin sur +Z, et au-delà duquel du champ en plus ne
 * sert plus à rien (m). Le cadrage par défaut se pose entre 2 et 3,5 m, et la
 * rose borne déjà ce recul côté client. Les sept décors livrés vont de 2,2 m
 * (le loft, une mansarde) à 14,2 m : 2,5 m est donc une exigence réelle, pas un
 * confort — et une pièce qui n'en offre nulle part se rabat sur son meilleur point.
 */
const SPAWN_CAM_ENOUGH = 2.5
/**
 * Place minimale autour des pieds pour que le personnage tienne debout et
 * puisse partir (m). Son gabarit fait 0,25 m de rayon : 0,4 m lui laisse un
 * pas. Ce n'est PAS un critère de choix, c'est un plancher — voir plus bas.
 */
const SPAWN_ROOM_MIN = 0.4
/**
 * Distance au-delà de laquelle ce qu'il y a DERRIÈRE le personnage ne fait plus
 * décor (m). La caméra est devant lui : ce qu'elle cadre, c'est le fond
 * derrière ses épaules. Les sept points d'accueil réglés à la main des décors
 * livrés ont TOUS un fond à 2,7 m ou moins derrière eux — de 0,7 m (le loft) à
 * 2,7 m (le restaurant) — alors que leur dégagement DEVANT va de 1,6 m à
 * 14,2 m. C'est la seule régularité de ces sept réglages, et elle dit tout : un
 * personnage planté au milieu d'un grand vide est cadré sur du vide.
 */
const SPAWN_BACKDROP = 3

// ── Placement (sidecar `.json`) ────────────────────────────────────────────

/**
 * Placement d'un décor. MÊMES bornes que `parsePlacement()` de vrmStage.ts :
 * une valeur hors bornes est OMISE, pas corrigée — sinon l'analyse mesurerait
 * un décor que le client n'affichera jamais.
 * `exposure` n'y figure pas : elle ne touche que les couleurs, jamais la géométrie.
 */
export interface EnvPlacement {
  scale?: number
  rotationY?: number
  spawn?: [number, number, number]
}

function asNumberIn(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value >= min && value <= max ? value : undefined
}

/** Sidecar quelconque → placement propre. Copie fidèle de la validation du client. */
export function parsePlacement(raw: unknown): EnvPlacement {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  const out: EnvPlacement = {}
  const scale = asNumberIn(o.scale, 0.01, 100)
  if (scale !== undefined) out.scale = scale
  const rotationY = asNumberIn(o.rotationY, -3600, 3600)
  if (rotationY !== undefined) out.rotationY = rotationY
  if (Array.isArray(o.spawn) && o.spawn.length === 3) {
    const t = o.spawn.map((n) => asNumberIn(n, -1000, 1000))
    if (t.every((n): n is number => n !== undefined)) out.spawn = [t[0], t[1], t[2]]
  }
  return out
}

/** Lit `<décor>.json`. Absent ou illisible = placement vide, comme côté client. */
export function readPlacement(modelFile: string): EnvPlacement {
  const sidecar = modelFile.replace(/\.(glb|gltf)$/i, '.json')
  if (sidecar === modelFile) return {}
  try {
    return parsePlacement(JSON.parse(fs.readFileSync(sidecar, 'utf8')))
  } catch {
    return {}
  }
}

/** Empreinte du placement : ce qui déplace la géométrie, et rien d'autre. */
export function placementFingerprint(placement: EnvPlacement): string {
  const canonical = JSON.stringify([placement.scale ?? null, placement.rotationY ?? null, placement.spawn ?? null])
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

// ── Reproduction de fitEnvironment() ───────────────────────────────────────

interface Placed {
  /** modèle → monde, rotation et échelle comprises (la translation est dans `offset`). */
  matrix: Mat4
  offset: [number, number, number]
  /** Boîte du modèle placé, telle que le client la calcule. */
  min: [number, number, number]
  max: [number, number, number]
  /** Échelle réellement appliquée (le rattrapage automatique la change). */
  scale: number
  autoRescaled: boolean
}

/** Union des 8 coins d'une AABB locale transformée — ce que fait `Box3.setFromObject` (non précis). */
function unionCorners(m: Mat4, lo: readonly number[], hi: readonly number[], min: number[], max: number[]): void {
  const p = new Float64Array(3)
  for (let c = 0; c < 8; c++) {
    mat4ApplyPoint(m, c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2], p)
    for (let a = 0; a < 3; a++) {
      if (p[a] < min[a]) min[a] = p[a]
      if (p[a] > max[a]) max[a] = p[a]
    }
  }
}

/**
 * Reproduit `fitEnvironment()` de vrmStage.ts, pas à pas :
 *   envGroup.rotation.y = rotationY * DEG2RAD ; envGroup.scale = scale ?? 1
 *   box = new Box3().setFromObject(root)          ← boîte NON précise
 *   [rattrapage d'échelle si aucune n'est donnée et que la hauteur est absurde]
 *   envGroup.position = (-sx, -(box.min.y + sy), -sz)
 *
 * La boîte est bien la boîte NON précise de three (les 8 coins de l'AABB locale
 * de chaque géométrie, transformés) : c'est elle qui décide du calage au sol.
 * L'écart avec la boîte exacte est nul sur les trois décors livrés, mais un
 * nœud tourné peut l'écarter — autant reproduire le code plutôt que l'intention.
 */
function placeModel(model: GlbModel, placement: EnvPlacement): Placed {
  const yaw = (placement.rotationY ?? 0) * DEG2RAD
  let scale = placement.scale ?? 1
  let autoRescaled = false
  const compute = (): { matrix: Mat4; min: number[]; max: number[] } => {
    const env = mat4YawScale(yaw, scale)
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (const prim of model.primitives) {
      unionCorners(mat4Multiply(env, prim.matrix), prim.min, prim.max, min, max)
    }
    return { matrix: env, min, max }
  }
  let box = compute()
  const rawHeight = Math.max(box.max[1] - box.min[1], 1e-6)
  if (placement.scale === undefined && (rawHeight < ENV_MIN_HEIGHT || rawHeight > ENV_MAX_HEIGHT)) {
    scale *= ENV_TARGET_HEIGHT / rawHeight
    autoRescaled = true
    box = compute()
  }
  const [sx, sy, sz] = placement.spawn ?? [0, 0, 0]
  const offset: [number, number, number] = [-sx, -(box.min[1] + sy), -sz]
  return {
    matrix: box.matrix,
    offset,
    min: [box.min[0] + offset[0], box.min[1] + offset[1], box.min[2] + offset[2]],
    max: [box.max[0] + offset[0], box.max[1] + offset[1], box.max[2] + offset[2]],
    scale,
    autoRescaled,
  }
}

// ── Géométrie en coordonnées de scène ──────────────────────────────────────

interface WorldMesh {
  /** Sommets déjà transformés (monde), 3 par sommet. */
  positions: Float32Array
  indices: Uint32Array | null
  triangleCount: number
}

/** Transforme une fois pour toutes les sommets dans le repère de la scène. */
function toWorld(model: GlbModel, placed: Placed): WorldMesh[] {
  const out: WorldMesh[] = []
  const p = new Float64Array(3)
  for (const prim of model.primitives) {
    if (prim.mode !== 4 || !prim.positions) continue
    const full = mat4Multiply(placed.matrix, prim.matrix)
    const count = prim.positions.length / 3
    const positions = new Float32Array(prim.positions.length)
    for (let i = 0; i < count; i++) {
      mat4ApplyPoint(full, prim.positions[i * 3], prim.positions[i * 3 + 1], prim.positions[i * 3 + 2], p)
      positions[i * 3] = p[0] + placed.offset[0]
      positions[i * 3 + 1] = p[1] + placed.offset[1]
      positions[i * 3 + 2] = p[2] + placed.offset[2]
    }
    out.push({ positions, indices: prim.indices, triangleCount: prim.triangleCount })
  }
  return out
}

/** Rend la main à la boucle d'événements quand un créneau de calcul est écoulé. */
class Clock {
  private last = Date.now()
  constructor(private readonly budgetMs: number) {}
  async tick(): Promise<void> {
    if (!Number.isFinite(this.budgetMs)) return
    if (Date.now() - this.last < this.budgetMs) return
    await new Promise<void>((resolve) => setImmediate(resolve))
    this.last = Date.now()
  }
}

type SampleVisitor = (x: number, y: number, z: number, ny: number, area: number) => void

/**
 * Parcourt tous les triangles et les sous-échantillonne barycentriquement à
 * `step`, en donnant à chaque point le poids de l'AIRE qu'il représente. C'est
 * la seule opération lourde de l'analyse ; elle rend la main régulièrement.
 */
async function forEachSample(meshes: WorldMesh[], step: number, visit: SampleVisitor, clock: Clock): Promise<number> {
  let total = 0
  for (const mesh of meshes) {
    const { positions, indices, triangleCount } = mesh
    for (let f = 0; f < triangleCount; f++) {
      if ((f & 511) === 0) await clock.tick()
      const ia = (indices ? indices[f * 3] : f * 3) * 3
      const ib = (indices ? indices[f * 3 + 1] : f * 3 + 1) * 3
      const ic = (indices ? indices[f * 3 + 2] : f * 3 + 2) * 3
      const ax = positions[ia]
      const ay = positions[ia + 1]
      const az = positions[ia + 2]
      const ux = positions[ib] - ax
      const uy = positions[ib + 1] - ay
      const uz = positions[ib + 2] - az
      const vx = positions[ic] - ax
      const vy = positions[ic + 1] - ay
      const vz = positions[ic + 2] - az
      const nx = uy * vz - uz * vy
      const ny = uz * vx - ux * vz
      const nz = ux * vy - uy * vx
      const len = Math.hypot(nx, ny, nz)
      if (len === 0) continue
      const area = len / 2
      const normalY = ny / len
      const span = Math.max(Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz))
      const ns = Math.min(MAX_SUBDIV, Math.max(1, Math.ceil(span / step)))
      const weight = area / ((ns * (ns + 1)) / 2)
      for (let a = 0; a < ns; a++) {
        const u = (a + 0.33) / ns
        for (let b = 0; b + a < ns; b++) {
          const v = (b + 0.33) / ns
          visit(ax + ux * u + vx * v, ay + uy * u + vy * v, az + uz * u + vz * v, normalY, weight)
          total++
        }
      }
    }
  }
  return total
}

// ── Champ d'occupation ─────────────────────────────────────────────────────

/**
 * Grille horizontale × tranches verticales. Trois couches d'AIRE cumulée :
 * `up` (faces posables), `vert` (faces dressées : murs, dossiers) et `occ`
 * (tout, pour le dégagement). C'est de l'aire et non un simple drapeau : un fil
 * électrique ne doit pas condamner une case, une cloison si.
 */
class Field {
  readonly cols: number
  readonly rows: number
  readonly bins: number
  readonly up: Float32Array
  readonly occ: Float32Array
  readonly vert: Float32Array | null
  /** Somme des (aire × altitude) des faces posables : rend l'altitude EXACTE, pas le centre de la tranche. */
  readonly upY: Float32Array | null
  readonly cellArea: number

  constructor(
    readonly cell: number,
    readonly vbin: number,
    readonly x0: number,
    readonly z0: number,
    cols: number,
    rows: number,
    /** Grille de mesure (et non de simple repérage) : altitudes exactes et faces dressées. */
    detailed: boolean,
  ) {
    this.cols = cols
    this.rows = rows
    this.bins = Math.ceil((Y_MAX - Y_MIN) / vbin)
    const size = cols * rows * this.bins
    this.up = new Float32Array(size)
    this.occ = new Float32Array(size)
    this.vert = detailed ? new Float32Array(size) : null
    this.upY = detailed ? new Float32Array(size) : null
    this.cellArea = cell * cell
  }

  /** CENTRE (x, z) de la cellule (ci, cj) — le coin minimal est à −cell/2. */
  cellX(ci: number): number {
    return this.x0 + (ci + 0.5) * this.cell
  }
  cellZ(cj: number): number {
    return this.z0 + (cj + 0.5) * this.cell
  }
  colOf(x: number): number {
    return Math.floor((x - this.x0) / this.cell)
  }
  rowOf(z: number): number {
    return Math.floor((z - this.z0) / this.cell)
  }
  /** Altitude du BAS de la tranche `bin`. */
  binY(bin: number): number {
    return Y_MIN + bin * this.vbin
  }

  add(x: number, y: number, z: number, ny: number, area: number): void {
    if (y < Y_MIN || y >= Y_MAX) return
    const ci = this.colOf(x)
    if (ci < 0 || ci >= this.cols) return
    const cj = this.rowOf(z)
    if (cj < 0 || cj >= this.rows) return
    const bin = Math.floor((y - Y_MIN) / this.vbin)
    const k = (cj * this.cols + ci) * this.bins + bin
    this.occ[k] += area
    if (ny > UP_NORMAL) {
      this.up[k] += area
      if (this.upY) this.upY[k] += area * y
    }
    if (this.vert && Math.abs(ny) < VERTICAL_NORMAL) this.vert[k] += area
  }
}

/** Une nappe horizontale trouvée dans une cellule. */
interface Surface {
  /** Altitude moyenne, pondérée par l'aire (m). */
  y: number
  /** Aire de géométrie horizontale dans la cellule (m²). */
  area: number
  /** Espace libre au-dessus, avant la première géométrie (m). */
  headroom: number
}

/**
 * Nappes horizontales d'une cellule, de la plus basse à la plus haute.
 *
 * Les tranches voisines sont fusionnées quand leurs altitudes se suivent — un
 * plancher en lames irrégulier est UNE nappe, pas dix. Le critère porte sur
 * l'altitude RÉELLE et non sur le voisinage des tranches : la tablette d'un
 * pupitre (0,62 m) et son plateau (0,70 m) tombent dans deux tranches
 * mitoyennes, et les confondre annonçait un pupitre à 0,67 m — une hauteur qui
 * n'existe nulle part dans le décor.
 */
function cellSurfaces(field: Field, ci: number, cj: number, minArea: number): Surface[] {
  const base = (cj * field.cols + ci) * field.bins
  // Altitude exacte quand la grille la porte ; centre de tranche sinon (grille
  // de repérage, où 2,5 cm d'incertitude n'ont aucun effet).
  const meanOf = (b: number): number =>
    field.upY ? field.upY[base + b] / field.up[base + b] : field.binY(b) + field.vbin / 2
  const merge = Math.max(0.06, field.vbin + 0.01)
  const out: Surface[] = []
  let bin = 0
  while (bin < field.bins) {
    if (field.up[base + bin] <= 0) {
      bin++
      continue
    }
    let area = field.up[base + bin]
    let previous = meanOf(bin)
    let weighted = previous * area
    let last = bin
    for (let b = bin + 1; b < field.bins && field.up[base + b] > 0; b++) {
      const mean = meanOf(b)
      if (mean - previous > merge) break
      const a = field.up[base + b]
      area += a
      weighted += mean * a
      previous = mean
      last = b
    }
    const y = weighted / area
    if (area >= minArea) {
      // Dégagement : première tranche occupée AU-DESSUS de la nappe, en
      // ENJAMBANT les rebords. Un rebord, c'est de la géométrie basse (moins
      // d'une marche au-dessus de la nappe) qui n'offre elle-même AUCUNE surface :
      // le chant d'une lame de plancher, une plinthe, un seuil. Sans cette
      // nuance, le point d'accueil de la chambre en rondins était déclaré
      // obstrué par le bord de sa propre lame de parquet, 5 cm plus haut.
      //
      // La condition « sans surface propre » est ce qui distingue un chant de
      // lame d'un plateau de pupitre 8 cm au-dessus de sa tablette : le plateau,
      // lui, est une surface, et il bouche pour de bon. Et un mur, qui n'a pas
      // de surface non plus, dépasse la hauteur d'une marche : il bouche aussi.
      let top = Y_MAX - y
      for (let k = last + 1; k < field.bins; k++) {
        if (field.occ[base + k] < OCC_MIN_AREA) continue
        // Seuil FIXE, indépendant de `minArea` : le dégagement est une propriété
        // de la géométrie, pas de ce qu'on est en train d'y chercher.
        if (field.up[base + k] < field.cellArea * SURFACE_COVER && field.binY(k) + field.vbin - y <= STEP_MAX) continue
        // Milieu de la tranche : l'obstacle est quelque part dedans, pas à son plancher.
        top = field.binY(k) + field.vbin / 2 - y
        break
      }
      out.push({ y, area, headroom: Math.max(top, 0) })
    }
    bin = last + 1
  }
  return out
}

/**
 * Choix du sol d'une cellule : la nappe la plus basse où l'on tient debout.
 * À défaut, la plus dégagée — ce qui donne le dessus du meuble plutôt que le
 * plancher coincé dessous, et la cellule sera de toute façon inatteignable.
 */
function pickFloor(surfaces: Surface[]): Surface | null {
  for (const s of surfaces) if (s.headroom >= BODY_HEIGHT) return s
  let best: Surface | null = null
  for (const s of surfaces) if (!best || s.headroom > best.headroom) best = s
  return best
}

interface CellFloor {
  y: number
  headroom: number
  walkable: boolean
}

/** Analyse chaque cellule d'un champ : sol retenu, dégagement, marchabilité. */
function analyseCells(field: Field): (CellFloor | null)[] {
  const minArea = field.cellArea * SURFACE_COVER
  const out: (CellFloor | null)[] = new Array(field.cols * field.rows).fill(null)
  for (let cj = 0; cj < field.rows; cj++) {
    for (let ci = 0; ci < field.cols; ci++) {
      const surfaces = cellSurfaces(field, ci, cj, minArea)
      if (surfaces.length === 0) continue
      const floor = pickFloor(surfaces)
      if (!floor) continue
      out[cj * field.cols + ci] = { y: floor.y, headroom: floor.headroom, walkable: floor.headroom >= BODY_HEIGHT }
    }
  }
  return out
}

/**
 * Cellules atteignables à pied depuis le point d'accueil : propagation 4-voisins
 * limitée par `STEP_MAX`. C'est ce qui distingue LA PIÈCE du reste du fichier —
 * la boîte englobante de la salle de classe fait 27 m parce qu'elle englobe le
 * décor extérieur peint derrière les fenêtres ; la zone atteignable, non.
 */
function floodReachable(field: Field, cells: (CellFloor | null)[]): Uint8Array {
  const reach = new Uint8Array(field.cols * field.rows)
  const start = seedCell(field, cells)
  if (start < 0) return reach
  const queue = [start]
  reach[start] = 1
  const neighbours = [-1, 1, -field.cols, field.cols]
  while (queue.length > 0) {
    const k = queue.pop() as number
    const here = cells[k]
    if (!here) continue
    const ci = k % field.cols
    for (const d of neighbours) {
      const n = k + d
      if (n < 0 || n >= reach.length || reach[n]) continue
      // Pas de repli d'une ligne à l'autre : les voisins ±1 doivent rester sur la même rangée.
      if ((d === -1 && ci === 0) || (d === 1 && ci === field.cols - 1)) continue
      const cell = cells[n]
      if (!cell || !cell.walkable) continue
      if (Math.abs(cell.y - here.y) > STEP_MAX) continue
      reach[n] = 1
      queue.push(n)
    }
  }
  return reach
}

/**
 * Point de départ de la propagation : la cellule du point d'accueil (l'origine,
 * sous les pieds de l'avatar). Si elle n'est pas praticable — décor mal calé —
 * on prend la cellule praticable la plus proche de l'origine, puis, à défaut,
 * rien : le décor restera un simple fond.
 */
function seedCell(field: Field, cells: (CellFloor | null)[]): number {
  const ci = field.colOf(0)
  const cj = field.rowOf(0)
  if (ci >= 0 && ci < field.cols && cj >= 0 && cj < field.rows) {
    const k = cj * field.cols + ci
    if (cells[k]?.walkable) return k
  }
  let best = -1
  let bestDist = Infinity
  for (let j = 0; j < field.rows; j++) {
    for (let i = 0; i < field.cols; i++) {
      const k = j * field.cols + i
      if (!cells[k]?.walkable) continue
      const d = Math.hypot(field.cellX(i), field.cellZ(j))
      if (d < bestDist) {
        bestDist = d
        best = k
      }
    }
  }
  return best
}

/**
 * Altitude du sol DE LA PIÈCE, l'étalon auquel se mesurent les hauteurs
 * d'assise. Par construction du calage (`fitEnvironment` + `spawn[1]`) elle vaut
 * ≈ 0, mais un décor sans sidecar n'a aucune raison de tomber juste : on la
 * mesure sous les pieds de l'avatar, puis, à défaut, sur la nappe horizontale
 * la plus étendue autour de zéro.
 */
function groundReference(field: Field, cells: (CellFloor | null)[]): number {
  const seed = seedCell(field, cells)
  if (seed >= 0) return (cells[seed] as CellFloor).y
  let best = 0
  let bestArea = 0
  for (let b = 0; b < field.bins; b++) {
    const y = field.binY(b) + field.vbin / 2
    if (y < -1 || y > 1) continue
    let area = 0
    for (let k = 0; k < field.cols * field.rows; k++) area += field.up[k * field.bins + b]
    if (area > bestArea) {
      bestArea = area
      best = y
    }
  }
  return best
}

/** Boîte (en cellules) des cellules marquées. */
function markedBounds(field: Field, mark: Uint8Array): { i0: number; j0: number; i1: number; j1: number; count: number } | null {
  let i0 = Infinity
  let j0 = Infinity
  let i1 = -Infinity
  let j1 = -Infinity
  let count = 0
  for (let j = 0; j < field.rows; j++) {
    for (let i = 0; i < field.cols; i++) {
      if (!mark[j * field.cols + i]) continue
      count++
      if (i < i0) i0 = i
      if (i > i1) i1 = i
      if (j < j0) j0 = j
      if (j > j1) j1 = j
    }
  }
  return count > 0 ? { i0, j0, i1, j1, count } : null
}

// ── Dégagement de l'objectif ───────────────────────────────────────────────

/**
 * Distance libre à hauteur d'objectif depuis (cx, cz), dans 16 directions. De
 * quoi choisir un axe et un recul de caméra sans relire la géométrie.
 *
 * Mesurée sur la grille de REPÉRAGE, la seule qui porte assez loin (la grille
 * fine s'arrête aux abords de la pièce) — d'où une résolution de l'ordre du pas
 * de cette grille. `eyeY` est l'altitude de l'objectif dans le repère mesuré :
 * pour un point d'accueil candidat, c'est l'altitude de SON sol plus la hauteur
 * d'œil, puisque c'est là que la caméra se tiendra une fois le décor recalé.
 */
function clearanceRose(coarse: Field, cx: number, cz: number, eyeY: number): number[] {
  const out: number[] = []
  const b0 = Math.max(0, Math.floor((eyeY - 0.2 - Y_MIN) / coarse.vbin))
  const b1 = Math.min(coarse.bins - 1, Math.floor((eyeY + 0.3 - Y_MIN) / coarse.vbin))
  for (let k = 0; k < ROSE_DIRECTIONS; k++) {
    const rad = (k * 2 * Math.PI) / ROSE_DIRECTIONS
    const dx = Math.sin(rad)
    const dz = Math.cos(rad)
    let d = 0
    for (let t = 0.3; t <= WORLD_RADIUS; t += CELL) {
      const ci = coarse.colOf(cx + dx * t)
      const cj = coarse.rowOf(cz + dz * t)
      if (ci < 0 || ci >= coarse.cols || cj < 0 || cj >= coarse.rows) break
      const base = (cj * coarse.cols + ci) * coarse.bins
      let blocked = false
      for (let b = b0; b <= b1; b++) if (coarse.occ[base + b] >= OCC_MIN_AREA) blocked = true
      if (blocked) break
      d = t
    }
    out.push(round(d, 2))
  }
  return out
}

// ── Calage automatique ─────────────────────────────────────────────────────

/** Ce qui cloche dans le point d'accueil d'un décor mesuré. Tout est déjà dans le `.scene.json`. */
export interface SpawnTrouble {
  /** Altitude du sol de la pièce (m) quand elle ne tombe pas sous les pieds de l'avatar ; `null` si elle y tombe. */
  ground: number | null
  /** L'objectif est dans la géométrie : rien à voir depuis le point d'accueil. */
  blind: boolean
  /** Le point d'accueil est HORS de la pièce : on marche ailleurs, pas ici. */
  outside: boolean
}

/**
 * Le point d'accueil d'une analyse est-il inhabitable ? Trois signes, tous lus
 * dans le fichier produit, aucun devinable autrement :
 *  — le sol de la pièce n'est pas sous les pieds de l'avatar (il est enterré) ;
 *  — l'objectif ne voit rien dans aucune des 16 directions (écran noir) ;
 *  — l'origine tombe hors de la boîte de ce qu'on atteint à pied.
 *
 * Un décor SANS aucun sol praticable n'est jamais concerné : c'est un fond
 * peint, pas une pièce, et le personnage devant lui est à sa place depuis
 * toujours. Cette fonction est LE juge commun du serveur (qui décide de
 * recaler) et du client (qui décide d'expliquer) — deux règles séparées
 * auraient fini par diverger.
 */
export function spawnTrouble(scene: Pick<SceneFile, 'room' | 'camera'>): SpawnTrouble | null {
  const room = scene?.room
  if (!room || !(room.walkArea > 0)) return null
  const ground = typeof room.ground === 'number' && Math.abs(room.ground) > SPAWN_GROUND_TOL ? room.ground : null
  const clearance = scene.camera?.clearance
  const blind = Array.isArray(clearance) && clearance.length > 0 && Math.max(...clearance) < SPAWN_BLIND
  const wb = room.walkBounds
  const outside = Array.isArray(wb) && wb.length === 4 && !(wb[0] <= 0 && 0 <= wb[2] && wb[1] <= 0 && 0 <= wb[3])
  return ground === null && !blind && !outside ? null : { ground, blind, outside }
}

/**
 * Choisit un point d'accueil quand l'origine n'en est pas un — c'est-à-dire ce
 * qu'on faisait à la main en balayant des candidats et en classant ce qu'ils
 * rendaient (cf. l'outil `balayage` du chantier).
 *
 *  1. LA PIÈCE, c'est la plus grande étendue d'un seul tenant où l'on marche.
 *     Pas celle qui touche l'origine : sur un quai de métro, l'origine tombe
 *     dans la voie, et la voie est une bande praticable parfaitement inutile.
 *  2. TENIR DEBOUT — un plancher, pas un critère : la case doit être à
 *     `SPAWN_ROOM_MIN` du premier obstacle, sans quoi le personnage est encastré
 *     et ne peut pas partir. Au-delà, être plus au large ne vaut rien de plus.
 *  3. RECULER — la caméra se pose devant, sur +Z : il lui faut `SPAWN_CAM_ENOUGH`
 *     de champ dans son cône. En deçà, elle entre dans la géométrie et l'écran
 *     devient noir ; au-delà, du champ en plus ne sert plus à rien.
 *  4. AVOIR QUELQUE CHOSE À CADRER — et c'est le critère qui départage : entre
 *     deux points également praticables et également dégagés devant, on prend
 *     celui qui a le décor le plus proche DERRIÈRE lui (`SPAWN_BACKDROP`). Le
 *     « point le plus central » d'une grande salle est un point où la caméra ne
 *     voit que du vide : mesuré sur le quai du métro, 8,7 m de rien derrière
 *     l'avatar et 16 % de l'image peinte. Les sept décors livrés, réglés à la
 *     main, ont tous leur fond à 2,2 m ou moins.
 *
 * Rend `[x, y, z]` dans le repère de CETTE mesure — donc exactement ce qu'un
 * `spawn` de sidecar aurait dit — ou `null` si le décor n'a nulle part où poser
 * qui que ce soit.
 */
function chooseSpawn(field: Field, coarse: Field, cells: (CellFloor | null)[]): [number, number, number] | null {
  const n = field.cols * field.rows
  const neighbours = [-1, 1, -field.cols, field.cols]
  /** Numéro de la zone d'un seul tenant de chaque case, −1 = pas de sol praticable. */
  const zone = new Int32Array(n).fill(-1)
  let bestZone = -1
  let bestSize = 0
  let zoneCount = 0
  const stack: number[] = []
  for (let seed = 0; seed < n; seed++) {
    if (zone[seed] >= 0 || !cells[seed]?.walkable) continue
    const id = zoneCount++
    zone[seed] = id
    stack.length = 0
    stack.push(seed)
    let size = 0
    while (stack.length > 0) {
      const k = stack.pop() as number
      size++
      const here = cells[k] as CellFloor
      const ci = k % field.cols
      for (const d of neighbours) {
        const m = k + d
        if (m < 0 || m >= n || zone[m] >= 0) continue
        if ((d === -1 && ci === 0) || (d === 1 && ci === field.cols - 1)) continue
        const cell = cells[m]
        if (!cell || !cell.walkable) continue
        // Même franchissement que floodReachable : une zone est ce qu'on parcourt
        // à pied, pas ce qui se touche à l'écran.
        if (Math.abs(cell.y - here.y) > STEP_MAX) continue
        zone[m] = id
        stack.push(m)
      }
    }
    if (size > bestSize) {
      bestSize = size
      bestZone = id
    }
  }
  if (bestZone < 0) return null

  // Distance au bord, en cases : propagation depuis la bordure de la zone. Le
  // hors-grille compte comme bord — une pièce coupée par le cadre d'analyse ne
  // doit pas passer pour un grand large.
  const depth = new Int32Array(n)
  const queue: number[] = []
  for (let k = 0; k < n; k++) {
    if (zone[k] !== bestZone) continue
    const ci = k % field.cols
    let edge = false
    for (const d of neighbours) {
      const m = k + d
      if (m < 0 || m >= n || (d === -1 && ci === 0) || (d === 1 && ci === field.cols - 1) || zone[m] !== bestZone) {
        edge = true
        break
      }
    }
    if (edge) {
      depth[k] = 1
      queue.push(k)
    }
  }
  let maxDepth = 0
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head]
    if (depth[k] > maxDepth) maxDepth = depth[k]
    const ci = k % field.cols
    for (const d of neighbours) {
      const m = k + d
      if (m < 0 || m >= n || depth[m] !== 0 || zone[m] !== bestZone) continue
      if ((d === -1 && ci === 0) || (d === 1 && ci === field.cols - 1)) continue
      depth[m] = depth[k] + 1
      queue.push(m)
    }
  }
  if (maxDepth === 0) return null

  // Présélection : les cases où le personnage TIENT DEBOUT, échantillonnées sur
  // une trame. La rose coûte 16 rayons par candidat — le pas de la trame
  // s'élargit avec la pièce pour que la facture reste la même partout.
  const minDepth = Math.max(1, Math.ceil(SPAWN_ROOM_MIN / field.cell))
  const stride = Math.max(
    Math.round(SPAWN_STRIDE / field.cell),
    Math.round(Math.sqrt(bestSize / SPAWN_MAX_CANDIDATES)),
    1,
  )
  let shortlist: number[] = []
  for (let cj = 0; cj < field.rows; cj++) {
    for (let ci = 0; ci < field.cols; ci++) {
      const k = cj * field.cols + ci
      if (zone[k] !== bestZone || depth[k] < minDepth) continue
      if (ci % stride !== 0 || cj % stride !== 0) continue
      shortlist.push(k)
    }
  }
  // Une pièce étroite peut n'avoir aucune case assez dégagée, ou aucune sur la
  // trame : on retombe alors sur ses cases les plus au large, quelles qu'elles
  // soient — mieux vaut un point serré que pas de point du tout.
  if (shortlist.length === 0) {
    for (let k = 0; k < n; k++) if (zone[k] === bestZone && depth[k] === maxDepth) shortlist.push(k)
  }
  if (shortlist.length > SPAWN_MAX_CANDIDATES) {
    // Décimation régulière : on garde la couverture de la pièce, pas un coin.
    const keep = shortlist
    const pas = keep.length / SPAWN_MAX_CANDIDATES
    shortlist = []
    for (let c = 0; c < SPAWN_MAX_CANDIDATES; c++) shortlist.push(keep[Math.floor(c * pas)])
  }

  // Deux mesures par candidat, prises sur la même rose :
  //  — DEVANT : le champ sur +Z, l'axe EXACT sur lequel la caméra recule. Une
  //    seule direction, à dessein : ce qui borde ce couloir à 22,5° tombe au
  //    bord de l'image, il ne met pas l'objectif dans la géométrie.
  //  — DERRIÈRE : ce que la caméra a dans le champ par-dessus les épaules du
  //    personnage. CINQ directions (−Z et ses voisins jusqu'à 45°), moyennées
  //    après plafonnement à SPAWN_BACKDROP : un fond, c'est une étendue, pas un
  //    poteau isolé qu'un minimum prendrait pour un mur ; et au-delà du plafond
  //    tout est également absent, un vide à 4 m comme un vide à 9 m.
  const front = new Float64Array(shortlist.length)
  const back = new Float64Array(shortlist.length)
  let bestFront = 0
  const half = ROSE_DIRECTIONS >> 1
  for (let c = 0; c < shortlist.length; c++) {
    const k = shortlist[c]
    const cell = cells[k] as CellFloor
    const rose = clearanceRose(
      coarse,
      field.cellX(k % field.cols),
      field.cellZ(Math.floor(k / field.cols)),
      cell.y + EYE_HEIGHT,
    )
    front[c] = rose[0]
    back[c] =
      (Math.min(rose[half - 2], SPAWN_BACKDROP) +
        Math.min(rose[half - 1], SPAWN_BACKDROP) +
        Math.min(rose[half], SPAWN_BACKDROP) +
        Math.min(rose[half + 1], SPAWN_BACKDROP) +
        Math.min(rose[half + 2], SPAWN_BACKDROP)) /
      5
    if (front[c] > bestFront) bestFront = front[c]
  }
  // Choix LEXICOGRAPHIQUE : d'abord ce qui rend un cadrage POSSIBLE (assez de
  // recul devant — au-delà de SPAWN_CAM_ENOUGH tous les candidats sont à
  // égalité, une pièce trop exiguë retombe sur son meilleur point), puis ce qui
  // le rend LISIBLE (du décor derrière), puis le large, puis l'immobilité.
  const wanted = Math.min(SPAWN_CAM_ENOUGH, bestFront) * 0.99
  let best = -1
  let bestBack = Infinity
  let bestDepth = -1
  let bestDist = Infinity
  for (let c = 0; c < shortlist.length; c++) {
    if (front[c] < wanted) continue
    const k = shortlist[c]
    const x = field.cellX(k % field.cols)
    const z = field.cellZ(Math.floor(k / field.cols))
    const backdrop = back[c]
    const room = depth[k] * field.cell
    const dist = Math.hypot(x, z)
    const better =
      backdrop < bestBack - 1e-9 ||
      (backdrop < bestBack + 1e-9 && (room > bestDepth + 1e-9 || (room > bestDepth - 1e-9 && dist < bestDist)))
    if (better) {
      bestBack = backdrop
      bestDepth = room
      bestDist = dist
      best = k
    }
  }
  if (best < 0) return null
  const cell = cells[best] as CellFloor
  return [round(field.cellX(best % field.cols), 3), round(cell.y, 3), round(field.cellZ(Math.floor(best / field.cols)), 3)]
}

// ── Niveaux ────────────────────────────────────────────────────────────────

/** Regroupe des altitudes en niveaux à `LEVEL_TOL` près, plafonnés à la taille de l'alphabet. */
function buildLevels(values: number[]): number[] {
  if (values.length === 0) return [0]
  const sorted = [...values].sort((a, b) => a - b)
  const groups: { sum: number; n: number; min: number; max: number }[] = []
  for (const v of sorted) {
    const last = groups[groups.length - 1]
    if (last && v - last.min <= LEVEL_TOL) {
      last.sum += v
      last.n++
      last.max = v
    } else {
      groups.push({ sum: v, n: 1, min: v, max: v })
    }
  }
  // Trop de niveaux (sol en pente, terrain) : on fusionne les deux plus proches
  // jusqu'à tenir dans l'alphabet. La perte de précision reste bornée et le
  // fichier dit quelle tolérance a finalement été appliquée.
  while (groups.length > LEVEL_ALPHABET.length) {
    let bestIndex = 0
    let bestGap = Infinity
    for (let i = 0; i + 1 < groups.length; i++) {
      const gap = groups[i + 1].sum / groups[i + 1].n - groups[i].sum / groups[i].n
      if (gap < bestGap) {
        bestGap = gap
        bestIndex = i
      }
    }
    const a = groups[bestIndex]
    const b = groups[bestIndex + 1]
    groups.splice(bestIndex, 2, { sum: a.sum + b.sum, n: a.n + b.n, min: a.min, max: b.max })
  }
  return groups.map((g) => round(g.sum / g.n, 3))
}

function levelIndex(levels: number[], y: number): number {
  let best = 0
  let bestGap = Infinity
  for (let i = 0; i < levels.length; i++) {
    const gap = Math.abs(levels[i] - y)
    if (gap < bestGap) {
      bestGap = gap
      best = i
    }
  }
  return best
}

// ── Assises ────────────────────────────────────────────────────────────────

interface SeatCandidate {
  cells: number[]
  y: number
  area: number
  /** Dégagement médian au-dessus de la nappe (m). */
  headroom: number
}

export interface RejectedSeat {
  center: [number, number]
  y: number
  area: number
  reason: string
}

/**
 * Cherche les nappes horizontales à hauteur d'assise. AUCUN filtrage par
 * compatibilité avec un modèle : la hauteur exacte est livrée, et c'est la
 * cinématique inverse du moteur qui posera le bassin dessus. Un lit, une
 * marche, un pupitre sont des assises.
 *
 * La hauteur se mesure au-dessus du SOL DE LA PIÈCE (`groundY`), pas au-dessus
 * de ce qu'il y a sous la nappe : un lit dont le plancher ne passe pas dessous
 * mesurerait sinon 0 cm de haut, et le socle extérieur d'un diorama ferait
 * passer le plancher lui-même pour une assise.
 */
function findSeats(
  field: Field,
  cells: (CellFloor | null)[],
  reach: Uint8Array,
  groundY: number,
  window: { i0: number; j0: number; i1: number; j1: number },
  rejected: RejectedSeat[] | null,
  issues: Map<string, number> | null,
): SeatCandidate[] {
  const minArea = field.cellArea * SEAT_COVER
  // TOUTES les nappes de chaque case sont candidates, pas seulement la plus
  // basse : une chaise glissée sous un pupitre superpose une assise à 0,43 m et
  // un plateau à 0,70 m dans les mêmes cases, et il n'y a aucune raison d'en
  // sacrifier une. Le tri se fera sur la nappe entière.
  const perCell: Surface[][] = new Array(field.cols * field.rows)
  for (let cj = window.j0; cj <= window.j1; cj++) {
    for (let ci = window.i0; ci <= window.i1; ci++) {
      const k = cj * field.cols + ci
      // Ce sur quoi on TIENT DEBOUT est du sol, pas une assise : la carte en
      // donne déjà la hauteur exacte. Sans cette règle, une estrade de 15 cm
      // devient une « assise » de 4,5 m² au milieu de la salle.
      const standing = reach[k] && cells[k]?.walkable ? (cells[k] as CellFloor).y : NaN
      const keep: Surface[] = []
      for (const s of cellSurfaces(field, ci, cj, minArea)) {
        const height = s.y - groundY
        if (height < SEAT_MIN || height > SEAT_MAX) continue
        if (!Number.isNaN(standing) && Math.abs(s.y - standing) < 0.05) {
          if (issues) {
            const reason = 'sol praticable : c’est du sol, pas une assise'
            issues.set(reason, (issues.get(reason) ?? 0) + 1)
          }
          continue
        }
        if (keep.length >= MAX_SEAT_SURFACES) break
        keep.push(s)
      }
      perCell[k] = keep
    }
  }

  // Les nappes poussent depuis les cases FRANCHEMENT dégagées, et rien d'autre.
  // La propagation « case voisine, altitude voisine » est transitive : sans cette
  // règle, un cours de rondins à 0,54 m se raccorde au matelas à 0,51 m, puis
  // fait le tour de la pièce, et la chambre entière ne compte plus qu'une assise.
  // Un mur n'a aucune case dégagée : il ne peut donc jamais amorcer de nappe.
  const claimed = new Uint8Array(field.cols * field.rows * MAX_SEAT_SURFACES)
  const seeds: { cells: Set<number>; y: number; headroom: number; sum: number; n: number }[] = []
  for (let cj = window.j0; cj <= window.j1; cj++) {
    for (let ci = window.i0; ci <= window.i1; ci++) {
      const start = cj * field.cols + ci
      for (let si = 0; si < (perCell[start]?.length ?? 0); si++) {
        const slot = start * MAX_SEAT_SURFACES + si
        if (claimed[slot] || perCell[start][si].headroom < SEAT_HEADROOM) continue
        const group = new Set<number>()
        const heads: number[] = []
        const queue: [number, number][] = [[start, si]]
        claimed[slot] = 1
        let sum = 0
        let n = 0
        while (queue.length > 0) {
          const [k, s] = queue.pop() as [number, number]
          const surface = perCell[k][s]
          group.add(k)
          heads.push(surface.headroom)
          sum += surface.y
          n++
          const i = k % field.cols
          for (const d of [-1, 1, -field.cols, field.cols]) {
            const m = k + d
            if (m < 0 || m >= perCell.length || !perCell[m]) continue
            if ((d === -1 && i === 0) || (d === 1 && i === field.cols - 1)) continue
            for (let sj = 0; sj < perCell[m].length; sj++) {
              if (claimed[m * MAX_SEAT_SURFACES + sj]) continue
              if (perCell[m][sj].headroom < SEAT_HEADROOM) continue
              if (Math.abs(perCell[m][sj].y - surface.y) > SEAT_LEVEL_TOL) continue
              claimed[m * MAX_SEAT_SURFACES + sj] = 1
              queue.push([m, sj])
            }
          }
        }
        heads.sort((a, b) => a - b)
        seeds.push({ cells: group, y: sum / n, headroom: heads[Math.floor(heads.length / 2)], sum, n })
      }
    }
  }

  // Puis UN seul tour d'annexion : les creux et les plis en bordure rejoignent la
  // nappe qui les touche. Un tour, pas davantage — de quoi recoudre un matelas,
  // pas de quoi remonter le long d'un mur.
  //
  // L'annexion étend l'EMPRISE, jamais la hauteur : celle-ci reste celle de la
  // surface dégagée. Sans cette distinction, la tablette d'un pupitre annexée à
  // son plateau ramenait le pupitre de 0,70 m à 0,665 m — une hauteur moyenne
  // sur laquelle il n'y a rien à poser.
  for (const seed of seeds) {
    for (const k of [...seed.cells]) {
      const i = k % field.cols
      for (const d of [-1, 1, -field.cols, field.cols]) {
        const m = k + d
        if (m < 0 || m >= perCell.length || !perCell[m]) continue
        if ((d === -1 && i === 0) || (d === 1 && i === field.cols - 1)) continue
        for (let sj = 0; sj < perCell[m].length; sj++) {
          if (claimed[m * MAX_SEAT_SURFACES + sj]) continue
          if (Math.abs(perCell[m][sj].y - seed.y) > SEAT_LEVEL_TOL) continue
          claimed[m * MAX_SEAT_SURFACES + sj] = 1
          seed.cells.add(m)
        }
      }
    }
  }

  const out: SeatCandidate[] = []
  for (const seed of seeds) {
    const area = seed.cells.size * field.cellArea
    const list = [...seed.cells]
    const y = seed.y
    if (area < SEAT_MIN_AREA) {
      if (rejected) {
        let sx = 0
        let sz = 0
        for (const k of list) {
          sx += field.cellX(k % field.cols)
          sz += field.cellZ(Math.floor(k / field.cols))
        }
        rejected.push({
          center: [round(sx / list.length, 3), round(sz / list.length, 3)],
          y: round(y, 3),
          area: round(area, 3),
          reason: `nappe trop petite (${area.toFixed(3)} m² < ${SEAT_MIN_AREA} m²)`,
        })
      }
      continue
    }
    out.push({ cells: list, y, area, headroom: seed.headroom })
  }
  // Ce qui n'a jamais été rattaché : uniquement des nappes sans dégagement.
  if (issues) {
    let buried = 0
    for (let k = 0; k < perCell.length; k++) {
      for (let si = 0; si < (perCell[k]?.length ?? 0); si++) if (!claimed[k * MAX_SEAT_SURFACES + si]) buried++
    }
    if (buried > 0) issues.set(`nappe sans dégagement suffisant (< ${SEAT_HEADROOM} m au-dessus)`, buried)
  }
  return out
}

/** Direction (yaw, degrés) vers laquelle un personnage assis regarderait, et présence d'un dossier. */
function seatFacing(
  field: Field,
  cells: (CellFloor | null)[],
  reach: Uint8Array,
  cx: number,
  cz: number,
  y: number,
): { yaw: number; back: boolean } {
  // Masse dressée autour de l'assise, à hauteur de DOS : mur, dossier, tête de
  // lit. La bande commence 28 cm au-dessus de l'assise, donc au-dessus d'un
  // plateau de bureau : sans cela le panneau d'un pupitre devant la chaise
  // annule exactement le dossier derrière elle, et le cap devient aléatoire.
  // Le poids décroît avec la distance : un dossier touche l'assise, un mur d'en
  // face ne la commande pas.
  let accX = 0
  let accZ = 0
  let total = 0
  if (field.vert) {
    const span = Math.round(0.75 / field.cell)
    const ci0 = field.colOf(cx)
    const cj0 = field.rowOf(cz)
    const b0 = Math.max(0, Math.floor((y + 0.28 - Y_MIN) / field.vbin))
    const b1 = Math.min(field.bins - 1, Math.floor((y + 0.85 - Y_MIN) / field.vbin))
    for (let dj = -span; dj <= span; dj++) {
      const cj = cj0 + dj
      if (cj < 0 || cj >= field.rows) continue
      for (let di = -span; di <= span; di++) {
        const ci = ci0 + di
        if (ci < 0 || ci >= field.cols) continue
        const dx = field.cellX(ci) - cx
        const dz = field.cellZ(cj) - cz
        const d = Math.hypot(dx, dz)
        if (d < 0.12 || d > 0.75) continue
        let mass = 0
        const base = (cj * field.cols + ci) * field.bins
        for (let b = b0; b <= b1; b++) mass += field.vert[base + b]
        if (mass <= 0) continue
        const weight = mass / d
        accX += (weight * dx) / d
        accZ += (weight * dz) / d
        total += weight
      }
    }
  }
  const norm = Math.hypot(accX, accZ)
  if (total > 0.05 && norm > 0.3 * total) {
    // On tourne le dos à la masse : la direction du regard est son opposé.
    return { yaw: round((Math.atan2(-accX / norm, -accZ / norm) * 180) / Math.PI, 1), back: true }
  }
  // Pas de dossier lisible : on regarde là où la pièce est la plus ouverte.
  let bestYaw = 0
  let bestRun = -1
  for (let k = 0; k < ROSE_DIRECTIONS; k++) {
    const yawRad = (k * 2 * Math.PI) / ROSE_DIRECTIONS
    const dx = Math.sin(yawRad)
    const dz = Math.cos(yawRad)
    let run = 0
    for (let t = 0.3; t <= 3; t += field.cell) {
      const ci = field.colOf(cx + dx * t)
      const cj = field.rowOf(cz + dz * t)
      if (ci < 0 || ci >= field.cols || cj < 0 || cj >= field.rows) break
      const k2 = cj * field.cols + ci
      if (!reach[k2] || !cells[k2]?.walkable) break
      run = t
    }
    if (run > bestRun) {
      bestRun = run
      bestYaw = (yawRad * 180) / Math.PI
    }
  }
  return { yaw: round(bestYaw > 180 ? bestYaw - 360 : bestYaw, 1), back: false }
}

/** Case praticable d'où l'on peut venir s'asseoir : devant l'assise, au niveau du sol. */
function seatApproach(
  field: Field,
  cells: (CellFloor | null)[],
  reach: Uint8Array,
  cx: number,
  cz: number,
  y: number,
  yaw: number,
): [number, number] | null {
  let best: [number, number] | null = null
  let bestDist = Infinity
  for (let da = -75; da <= 75; da += 15) {
    const rad = (yaw + da) * DEG2RAD
    const dx = Math.sin(rad)
    const dz = Math.cos(rad)
    for (let t = 0.25; t <= 1.2; t += field.cell) {
      const ci = field.colOf(cx + dx * t)
      const cj = field.rowOf(cz + dz * t)
      if (ci < 0 || ci >= field.cols || cj < 0 || cj >= field.rows) break
      const k = cj * field.cols + ci
      if (!reach[k]) continue
      const cell = cells[k]
      if (!cell || !cell.walkable || cell.y > y + 0.05) continue
      if (t < bestDist) {
        bestDist = t
        best = [round(field.cellX(ci), 3), round(field.cellZ(cj), 3)]
      }
      break
    }
  }
  return best
}

// ── Sortie ─────────────────────────────────────────────────────────────────

function round(v: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

function columnHasFloor(has: (ci: number, cj: number) => boolean, ci: number, j0: number, j1: number): boolean {
  for (let cj = j0; cj <= j1; cj++) if (has(ci, cj)) return true
  return false
}

function rowHasFloor(has: (ci: number, cj: number) => boolean, cj: number, i0: number, i1: number): boolean {
  for (let ci = i0; ci <= i1; ci++) if (has(ci, cj)) return true
  return false
}

export interface AnalyseOptions {
  /** Durée d'un créneau de calcul avant de rendre la main (ms). `Infinity` = jamais (CLI). */
  budgetMs?: number
  /** Conserve les candidats d'assise écartés, pour expliquer une absence. */
  explain?: boolean
}

export interface AnalyseResult {
  scene: SceneFile
  /** Diagnostic, jamais écrit dans le fichier. */
  report: {
    triangles: number
    samples: number
    coarseCells: number
    fineCells: number
    ms: number
    rejectedSeats: RejectedSeat[]
    /** Pourquoi telle case n'a pas donné d'assise, par motif. */
    seatIssues: { reason: string; cells: number }[]
    autoRescaled: boolean
    scale: number
    /** Point d'accueil calculé par le calage automatique, `null` si aucun n'était nécessaire. */
    spawnAuto: [number, number, number] | null
    /** Ce qui clochait au point d'accueil d'origine — la raison du calage. */
    spawnTrouble: SpawnTrouble | null
  }
}

/** Ce qu'une passe de mesure produit : le contenu du fichier, et de quoi choisir un point d'accueil. */
interface Measured {
  placed: Placed
  field: Field
  coarse: Field
  cells: (CellFloor | null)[]
  room: SceneFile['room']
  camera: SceneFile['camera']
  grid: SceneFile['grid']
  seats: SceneSeat[]
  samples: number
  rejectedSeats: RejectedSeat[]
  seatIssues: Map<string, number> | null
}

/**
 * UNE mesure complète du décor, sous UN placement donné. Tout le corps de
 * l'analyse vit ici pour qu'on puisse la rejouer telle quelle avec un point
 * d'accueil calculé — sans relire ni reparser le .glb, qui pèse des mégaoctets.
 */
async function measure(
  model: GlbModel,
  placement: EnvPlacement,
  clock: Clock,
  options: AnalyseOptions,
): Promise<Measured> {
  const placed = placeModel(model, placement)
  const meshes = toWorld(model, placed)
  if (meshes.length === 0) throw new GlbUnsupportedError('aucun triangle exploitable')

  // ── Passe 1 : repérage grossier, pour trouver OÙ est la pièce ────────────
  const span = Math.min(WORLD_RADIUS, Math.max(6, Math.max(Math.abs(placed.min[0]), Math.abs(placed.max[0]), Math.abs(placed.min[2]), Math.abs(placed.max[2]))))
  const coarseSize = Math.ceil((2 * span) / COARSE_CELL)
  const coarse = new Field(COARSE_CELL, COARSE_VBIN, -span, -span, coarseSize, coarseSize, false)
  let samples = await forEachSample(meshes, COARSE_SAMPLE_STEP, (x, y, z, ny, a) => coarse.add(x, y, z, ny, a), clock)
  const coarseCells = analyseCells(coarse)
  const coarseReach = floodReachable(coarse, coarseCells)
  const coarseBounds = markedBounds(coarse, coarseReach)

  // ── Passe 2 : grille fine, bornée à la zone repérée ──────────────────────
  const x0 = coarseBounds ? coarse.x0 + coarseBounds.i0 * COARSE_CELL - FINE_MARGIN : -3
  const z0 = coarseBounds ? coarse.z0 + coarseBounds.j0 * COARSE_CELL - FINE_MARGIN : -3
  const x1 = coarseBounds ? coarse.x0 + (coarseBounds.i1 + 1) * COARSE_CELL + FINE_MARGIN : 3
  const z1 = coarseBounds ? coarse.z0 + (coarseBounds.j1 + 1) * COARSE_CELL + FINE_MARGIN : 3
  // Grille alignée sur les multiples du pas : la conversion monde ↔ cellule
  // reste exacte et stable d'une analyse à l'autre.
  const fx0 = Math.floor(x0 / CELL) * CELL
  const fz0 = Math.floor(z0 / CELL) * CELL
  const field = new Field(CELL, VBIN, fx0, fz0, Math.ceil((x1 - fx0) / CELL), Math.ceil((z1 - fz0) / CELL), true)
  samples += await forEachSample(meshes, SAMPLE_STEP, (x, y, z, ny, a) => field.add(x, y, z, ny, a), clock)
  const cells = analyseCells(field)
  const reach = floodReachable(field, cells)
  await clock.tick()

  // ── Carte livrée : recadrée sur la zone atteignable + une marge de pièce ─
  const reachBounds = markedBounds(field, reach)
  let i0 = Math.max(0, (reachBounds?.i0 ?? 0) - MAP_MARGIN)
  let j0 = Math.max(0, (reachBounds?.j0 ?? 0) - MAP_MARGIN)
  let i1 = Math.min(field.cols - 1, (reachBounds?.i1 ?? field.cols - 1) + MAP_MARGIN)
  let j1 = Math.min(field.rows - 1, (reachBounds?.j1 ?? field.rows - 1) + MAP_MARGIN)
  // …puis rognée sur le vide : une bande entièrement « pas de sol » n'apprend rien.
  const hasFloor = (ci: number, cj: number): boolean => cells[cj * field.cols + ci] !== null
  while (i0 < i1 && !columnHasFloor(hasFloor, i0, j0, j1)) i0++
  while (i1 > i0 && !columnHasFloor(hasFloor, i1, j0, j1)) i1--
  while (j0 < j1 && !rowHasFloor(hasFloor, j0, i0, i1)) j0++
  while (j1 > j0 && !rowHasFloor(hasFloor, j1, i0, i1)) j1--

  // Les NIVEAUX ne décrivent que le sol atteignable à pied. Le dessus d'une
  // armoire à 2,3 m est un sol libre, mais l'y compter noierait la table des
  // niveaux et donnerait à croire qu'on peut y marcher.
  const heights: number[] = []
  for (let cj = j0; cj <= j1; cj++) {
    for (let ci = i0; ci <= i1; ci++) {
      const k = cj * field.cols + ci
      if (reach[k]) heights.push((cells[k] as CellFloor).y)
    }
  }
  const levels = buildLevels(heights)
  const map: string[] = []
  for (let cj = j0; cj <= j1; cj++) {
    let row = ''
    for (let ci = i0; ci <= i1; ci++) {
      const k = cj * field.cols + ci
      const cell = cells[k]
      if (!cell) row += CHAR_VOID
      else if (!cell.walkable) row += CHAR_BLOCKED
      else if (!reach[k]) row += CHAR_ISLAND
      else row += LEVEL_ALPHABET[levelIndex(levels, cell.y)]
    }
    map.push(row)
  }
  await clock.tick()

  // ── Assises ─────────────────────────────────────────────────────────────
  const groundY = groundReference(field, cells)
  const rejected: RejectedSeat[] = []
  const issues = options.explain ? new Map<string, number>() : null
  const candidates = findSeats(field, cells, reach, groundY, { i0, j0, i1, j1 }, options.explain ? rejected : null, issues)
  candidates.sort((a, b) => b.area - a.area)
  const seats: SceneSeat[] = []
  for (const candidate of candidates.slice(0, MAX_SEATS)) {
    let sx = 0
    let sz = 0
    let minX = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxZ = -Infinity
    for (const k of candidate.cells) {
      const x = field.cellX(k % field.cols)
      const z = field.cellZ(Math.floor(k / field.cols))
      sx += x
      sz += z
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const cx = sx / candidate.cells.length
    const cz = sz / candidate.cells.length
    const { yaw, back } = seatFacing(field, cells, reach, cx, cz, candidate.y)
    seats.push({
      id: `seat-${seats.length + 1}`,
      y: round(candidate.y, 3),
      center: [round(cx, 3), round(cz, 3)],
      bounds: [round(minX - CELL / 2, 3), round(minZ - CELL / 2, 3), round(maxX + CELL / 2, 3), round(maxZ + CELL / 2, 3)],
      area: round(candidate.area, 3),
      headroom: round(Math.min(candidate.headroom, 9.99), 2),
      yaw,
      back,
      approach: seatApproach(field, cells, reach, cx, cz, candidate.y, yaw),
    })
    await clock.tick()
  }

  // ── Repères de la pièce ─────────────────────────────────────────────────
  const walkArea = round((reachBounds?.count ?? 0) * field.cellArea, 2)
  const walkBounds: [number, number, number, number] = reachBounds
    ? [
        round(field.x0 + reachBounds.i0 * CELL, 3),
        round(field.z0 + reachBounds.j0 * CELL, 3),
        round(field.x0 + (reachBounds.i1 + 1) * CELL, 3),
        round(field.z0 + (reachBounds.j1 + 1) * CELL, 3),
      ]
    : [0, 0, 0, 0]
  // Plafond : ce que voit un personnage debout dans la pièce, pas ce que
  // contient le fichier. On relève, au-dessus de chaque case atteignable, la
  // première géométrie rencontrée ; s'il y en a partout, la médiane EST le
  // plafond. Un histogramme global se ferait piéger par la sous-face d'une
  // armoire ou d'une poutre — rustic-bedroom est ouvert par le haut et
  // annonçait ainsi un plafond à 1,98 m.
  const overhead: number[] = []
  let covered = 0
  for (let k = 0; k < reach.length; k++) {
    if (!reach[k]) continue
    const cell = cells[k] as CellFloor
    const hit = cell.y + cell.headroom
    if (hit < Y_MAX - 1e-6) {
      overhead.push(hit)
      covered++
    }
  }
  const reachCount = reachBounds?.count ?? 0
  let ceiling: number | null = null
  if (reachCount > 0 && covered >= 0.6 * reachCount) {
    overhead.sort((a, b) => a - b)
    ceiling = round(overhead[Math.floor(overhead.length / 2)], 3)
  }

  return {
    placed,
    field,
    coarse,
    cells,
    room: {
      modelBounds: [
        round(placed.min[0], 3),
        round(placed.min[1], 3),
        round(placed.min[2], 3),
        round(placed.max[0], 3),
        round(placed.max[1], 3),
        round(placed.max[2], 3),
      ],
      walkBounds,
      walkArea,
      ground: round(groundY, 3),
      ceiling,
    },
    // Rose de dégagement, mesurée depuis le point d'accueil (l'origine du repère
    // mesuré) à hauteur d'objectif : de quoi choisir un axe et un recul de caméra
    // sans relire la géométrie.
    camera: { eye: EYE_HEIGHT, clearance: clearanceRose(coarse, 0, 0, EYE_HEIGHT) },
    grid: {
      cell: CELL,
      origin: [round(field.x0 + i0 * CELL, 3), round(field.z0 + j0 * CELL, 3)],
      cols: i1 - i0 + 1,
      rows: j1 - j0 + 1,
      levels,
      legend: {
        [CHAR_VOID]: 'pas de sol',
        [CHAR_BLOCKED]: 'sol présent mais obstrué à hauteur de corps',
        [CHAR_ISLAND]: 'sol libre mais hors d’atteinte à pied (dessus de meuble, îlot)',
        '0-9a-zA-Z': 'sol libre et atteignable — le caractère est l’indice dans `levels`',
      },
      map,
    },
    seats,
    samples,
    rejectedSeats: rejected,
    seatIssues: issues,
  }
}

/**
 * Analyse un décor et rend le contenu de son `.scene.json`.
 * Lève `GlbUnsupportedError` si le fichier n'offre pas de géométrie lisible.
 *
 * Deux MESURES au plus : celle que le sidecar demande, puis — si le sidecar ne
 * donne aucun `spawn` et que le point d'accueil obtenu est inhabitable — la
 * même mesure rejouée autour du point d'accueil calculé. Le
 * fichier livré décrit donc TOUJOURS le décor tel qu'il sera affiché, carte,
 * assises et rose comprises : le client applique le `spawnAuto` et rien d'autre
 * ne bouge. Un décor déjà calé (sidecar, ou origine posée au sol par son auteur)
 * ne paie pas la seconde passe et ne voit pas le champ apparaître.
 */
export async function analyseEnvironment(modelFile: string, options: AnalyseOptions = {}): Promise<AnalyseResult> {
  const started = Date.now()
  const clock = new Clock(options.budgetMs ?? 8)
  const placement = readPlacement(modelFile)
  const model = loadGlb(modelFile)
  let measured = await measure(model, placement, clock, options)

  let spawnAuto: [number, number, number] | null = null
  let trouble: SpawnTrouble | null = null
  if (placement.spawn === undefined) {
    trouble = spawnTrouble(measured)
    if (trouble) {
      spawnAuto = chooseSpawn(measured.field, measured.coarse, measured.cells)
      if (spawnAuto) measured = await measure(model, { ...placement, spawn: spawnAuto }, clock, options)
    }
  }

  const stat = fs.statSync(modelFile)
  const scene: SceneFile = {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    generated: new Date().toISOString(),
    source: {
      file: path.basename(modelFile),
      bytes: stat.size,
      mtimeMs: Math.round(stat.mtimeMs),
      sha256: createHash('sha256').update(fs.readFileSync(modelFile)).digest('hex').slice(0, 16),
    },
    placement: {
      scale: placement.scale ?? null,
      rotationY: placement.rotationY ?? null,
      spawn: placement.spawn ?? null,
      // Le champ n'apparaît QUE si le calage automatique a eu à se prononcer :
      // un décor calé par son sidecar ou par son origine rend, à l'octet près,
      // le même fichier qu'avant que ce mécanisme existe. `null` = « on a
      // cherché, il n'y a nulle part où poser quelqu'un » — et c'est cette
      // présence-là qui empêche de remesurer indéfiniment un décor sans issue.
      ...(trouble ? { spawnAuto } : {}),
      fingerprint: placementFingerprint(placement),
    },
    frame: {
      units: 'm',
      up: '+Y',
      forward: '+Z',
      origin: 'spawn — pieds de l’avatar, y = 0',
    },
    body: {
      height: BODY_HEIGHT,
      radius: BODY_RADIUS,
      step: STEP_MAX,
      seatRange: [SEAT_MIN, SEAT_MAX],
    },
    room: measured.room,
    camera: measured.camera,
    grid: measured.grid,
    seats: measured.seats,
  }
  return {
    scene,
    report: {
      triangles: model.triangleCount,
      samples: measured.samples,
      coarseCells: measured.coarse.cols * measured.coarse.rows,
      fineCells: measured.field.cols * measured.field.rows,
      ms: Date.now() - started,
      rejectedSeats: measured.rejectedSeats,
      seatIssues: [...(measured.seatIssues ?? new Map<string, number>()).entries()]
        .map(([reason, cells2]) => ({ reason, cells: cells2 }))
        .sort((a, b) => b.cells - a.cells),
      autoRescaled: measured.placed.autoRescaled,
      scale: measured.placed.scale,
      spawnAuto,
      spawnTrouble: trouble,
    },
  }
}

/** Chemin du fichier d'analyse d'un décor : même nom, extension `.scene.json`. */
export function scenePathFor(modelFile: string): string {
  return modelFile.replace(/\.(glb|gltf)$/i, '') + SCENE_EXT
}

/**
 * Écrit le fichier d'analyse. Écriture atomique (fichier temporaire puis
 * renommage) : un serveur tué en plein calcul ne laisse jamais un `.scene.json`
 * tronqué, qui serait relu comme une analyse valide.
 * La carte est écrite une ligne par rangée — c'est un plan, il doit se lire.
 */
export function writeScene(modelFile: string, scene: SceneFile): void {
  const target = scenePathFor(modelFile)
  const temp = `${target}.tmp`
  try {
    fs.writeFileSync(temp, formatScene(scene), 'utf8')
    fs.renameSync(temp, target)
  } catch (e) {
    // Ne pas laisser traîner un fichier temporaire dans un dossier d'assets
    // servi en statique — et surtout pas dans le dépôt.
    try {
      fs.unlinkSync(temp)
    } catch {
      /* déjà parti, ou jamais créé */
    }
    throw e
  }
}

/** Sérialisation lisible : tout indenté, sauf les tableaux de nombres courts et la carte. */
export function formatScene(scene: SceneFile): string {
  const json = JSON.stringify(scene, null, 2)
  return (
    json
      // Un tableau de nombres tient sur une ligne : les boîtes, les niveaux, la rose.
      .replace(/\[\s*\n\s*(-?[\d.]+(?:,\s*\n\s*-?[\d.]+)*)\s*\n\s*\]/g, (_m, body: string) => `[${body.replace(/\s*\n\s*/g, ' ')}]`)
      .replace(/\n$/, '') + '\n'
  )
}
