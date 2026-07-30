// La carte du décor : le fichier `<décor>.scene.json` produit à l'import par le
// serveur (server/lib/envScene.ts), rendu interrogeable par le moteur.
//
// CONTRAT : les coordonnées de ce fichier sont déjà celles de la scène three.js
// — décor placé (échelle, rotation, calage au sol du sidecar appliqués), origine
// aux PIEDS de l'avatar, Y vers le haut, mètres, l'avatar regardant +Z. Il n'y a
// donc aucun changement de repère à faire ici, et c'est voulu : le seul endroit
// où l'on peut se tromper de repère est celui qui mesure, pas celui qui lit.
//
// TOLÉRANCE : ce chargeur ne fait JAMAIS confiance à ce qu'il lit. Un fichier
// absent (analyse pas encore prête), tronqué, d'une version future ou édité à la
// main de travers rend `null` — et le décor redevient ce qu'il est aujourd'hui :
// un fond, sans interaction. Aucune erreur à l'écran, aucune trace en console :
// « pas encore analysé » est le cas NORMAL, pas une panne.
//
// Aucun import de `three` : que des nombres, donc vérifiable sous Node.
//
// Et AUCUN import du type `SceneFile` de shared/types.ts, alors qu'il existe et
// décrit ce fichier : un chargeur tolérant ne peut pas se faire vérifier contre
// un type qu'il ne contrôle pas. Il lit du JSON venu du disque, dont rien ne
// garantit qu'il a été écrit par la version courante du producteur — et
// s'accrocher à ce type rendrait le client incompilable à chaque champ ajouté
// là-bas, pour un fichier qu'il sait déjà ignorer. Ce qu'on attend est décrit
// ci-dessous, champ par champ ; ce qu'on ne comprend pas est ignoré.

/**
 * Alphabet des niveaux de sol, recopié de server/lib/envScene.ts. Le caractère
 * d'une case y donne l'indice dans `grid.levels`. Un caractère INCONNU est traité
 * comme « pas de sol » : c'est le repli qui ne fait jamais marcher dans le vide.
 */
const LEVEL_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const CHAR_VOID = '.'
const CHAR_BLOCKED = '#'
/** Sol libre mais coupé du reste : on n'y va pas, et on ne connaît pas son altitude. */
const CHAR_ISLAND = '~'

/** Version de format acceptée. Au-delà, on préfère l'inertie à l'interprétation. */
const SUPPORTED_VERSION = 1

/** Rayon par défaut du gabarit, si le fichier ne le dit pas (m). */
const DEFAULT_RADIUS = 0.25
/** Dénivelé franchissable par défaut (m). */
const DEFAULT_STEP = 0.3

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function asPair(v: unknown): [number, number] | null {
  return Array.isArray(v) && v.length === 2 && v.every(isFiniteNumber) ? [v[0], v[1]] : null
}

function asQuad(v: unknown): [number, number, number, number] | null {
  return Array.isArray(v) && v.length === 4 && v.every(isFiniteNumber)
    ? [v[0], v[1], v[2], v[3]]
    : null
}

/**
 * Une assise, telle que le MOTEUR en a besoin. Volontairement plus pauvre que le
 * `SceneSeat` de shared/types.ts : tout ce qui sert à décider (aire, dégagement,
 * dossier) a déjà servi à l'analyse, et tout ce qui servirait à FILTRER par
 * modèle n'a plus lieu d'être — c'est la cinématique inverse qui adapte la pose,
 * pas une fenêtre de compatibilité qui écarte les meubles.
 */
export interface Seat {
  id: string
  /** Altitude RÉELLE de la surface (m). 0,20 m comme 0,90 m sont recevables. */
  y: number
  /** Centre de la nappe [x, z] — là où le bassin se pose. */
  center: [number, number]
  /** Cap du regard une fois assis (DEGRÉS ; direction = [sin, 0, cos]). */
  yaw: number
  /** Aire de la nappe (m²) — départage deux assises également commodes. */
  area: number
  /** Case praticable d'où venir s'asseoir [x, z], ou null : inaccessible à pied. */
  approach: [number, number] | null
}

/** Ce que le moteur sait faire d'un décor analysé. */
export interface SceneMap {
  /** Altitude du sol sous (x, z), ou null : pas de sol, ou sol inatteignable. */
  floorAt(x: number, z: number): number | null
  /**
   * Le gabarit tient-il debout ici ? Teste le DISQUE de rayon `radius`, pas le
   * seul point : sinon l'épaule passerait dans le mur avant que le centre ne le
   * touche. `fromY` borne le dénivelé franchissable (marche, estrade).
   */
  canStand(x: number, z: number, radius: number, fromY?: number): boolean
  /**
   * Déplacement borné par les obstacles : rend le point le plus avancé qu'on
   * puisse occuper, en essayant de GLISSER le long de ce qui bloque (un mur pris
   * en biais fait longer le mur, il n'arrête pas net).
   */
  slide(fromX: number, fromZ: number, toX: number, toZ: number, radius: number): { x: number; z: number }
  /** Assises trouvées par l'analyse. AUCUN filtrage par modèle : c'est l'IK qui adapte. */
  readonly seats: readonly Seat[]
  /** Emprise de la zone praticable [xMin, zMin, xMax, zMax]. */
  readonly bounds: readonly [number, number, number, number]
  /** Gabarit sous lequel la carte a été calculée. */
  readonly body: { readonly radius: number; readonly step: number; readonly height: number }
  /** Surface praticable (m²) — sert à décider si la pièce mérite qu'on s'y déplace. */
  readonly walkArea: number
}

/**
 * `<décor>.glb` → `<décor>.scene.json`. Même mécanique que le sidecar de
 * placement : l'URL du modèle suffit, aucune API à interroger.
 */
export function sceneUrlOf(modelUrl: string): string | null {
  const url = modelUrl.replace(/\.(glb|gltf)$/i, '.scene.json')
  return url === modelUrl ? null : url
}

/**
 * Charge et valide la carte d'un décor. Absente ou illisible → null, en silence.
 * NB : un fichier manquant ne répond pas forcément 404 mais l'index.html du
 * repli SPA — d'où la garde sur `res.json()`, qui lève sur du HTML.
 */
export async function fetchSceneMap(modelUrl: string): Promise<SceneMap | null> {
  const url = sceneUrlOf(modelUrl)
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return parseSceneMap(await res.json())
  } catch {
    return null
  }
}

/** Objet quelconque → carte interrogeable, ou null si quoi que ce soit cloche. */
export function parseSceneMap(raw: unknown): SceneMap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const f = raw as Record<string, unknown>
  if (f.format !== 'hanami-scene') return null
  if (!isFiniteNumber(f.version) || f.version > SUPPORTED_VERSION) return null

  const g = f.grid as Record<string, unknown> | undefined
  if (!g || typeof g !== 'object') return null
  const origin = asPair(g.origin)
  if (!origin || !isFiniteNumber(g.cell) || g.cell <= 0.001 || g.cell > 5) return null
  const cell: number = g.cell
  if (!isFiniteNumber(g.cols) || !isFiniteNumber(g.rows) || g.cols < 1 || g.rows < 1) return null
  const cols = Math.floor(g.cols)
  const rows = Math.floor(g.rows)
  if (!Array.isArray(g.map) || g.map.length < rows) return null
  const map = g.map.slice(0, rows)
  if (!map.every((r): r is string => typeof r === 'string' && r.length >= cols)) return null
  if (!Array.isArray(g.levels) || g.levels.length === 0 || !g.levels.every(isFiniteNumber)) return null
  const levels = g.levels as number[]

  // Le gabarit est INFORMATIF : le moteur connaît son propre modèle et peut
  // demander un rayon différent. On ne garde que le franchissement de marche,
  // qui décrit la carte elle-même.
  const b = (f.body ?? {}) as Record<string, unknown>
  const step = isFiniteNumber(b.step) && b.step > 0 ? b.step : DEFAULT_STEP
  const radius = isFiniteNumber(b.radius) && b.radius > 0 ? b.radius : DEFAULT_RADIUS
  const height = isFiniteNumber(b.height) && b.height > 0 ? b.height : 1.6

  const room = (f.room ?? {}) as Record<string, unknown>
  const wb =
    asQuad(room.walkBounds) ??
    ([origin[0], origin[1], origin[0] + cols * cell, origin[1] + rows * cell] as [
      number,
      number,
      number,
      number,
    ])
  const walkArea = isFiniteNumber(room.walkArea) ? room.walkArea : 0

  // Les assises sont validées UNE PAR UNE : une entrée abîmée est jetée, les
  // autres restent. C'est l'inverse de la grille, qui est tout ou rien — une
  // grille à moitié lue ferait marcher à travers un mur, une assise en moins ne
  // fait rien de mal.
  const seats: Seat[] = []
  if (Array.isArray(f.seats)) {
    for (const entry of f.seats) {
      if (!entry || typeof entry !== 'object') continue
      const s = entry as Record<string, unknown>
      const center = asPair(s.center)
      if (!center || !isFiniteNumber(s.y) || !isFiniteNumber(s.yaw)) continue
      seats.push({
        id: typeof s.id === 'string' ? s.id : `seat-${seats.length}`,
        y: s.y,
        center,
        area: isFiniteNumber(s.area) ? s.area : 0,
        yaw: s.yaw,
        approach: asPair(s.approach),
      })
    }
  }

  // ── Décodage de la grille, UNE FOIS, en tableaux plats ────────────────────
  // Deux Float32Array/Uint8Array de cols × rows : la lecture par image devient
  // un indice, pas un charCodeAt suivi d'un indexOf dans un alphabet.
  const n = cols * rows
  const heights = new Float32Array(n)
  const solid = new Uint8Array(n) // 1 = praticable
  for (let j = 0; j < rows; j++) {
    const row = map[j]
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i
      const c = row[i]
      if (c === CHAR_VOID || c === CHAR_BLOCKED || c === CHAR_ISLAND) continue
      const idx = LEVEL_ALPHABET.indexOf(c)
      // Caractère hors alphabet : traité comme « pas de sol ». Un fichier d'une
      // version future qui inventerait un symbole ne fera donc jamais marcher
      // le personnage dans le vide — il rétrécira sa pièce, c'est tout.
      if (idx < 0 || idx >= levels.length) continue
      heights[k] = levels[idx]
      solid[k] = 1
    }
  }

  const x0 = origin[0]
  const z0 = origin[1]
  const inv = 1 / cell

  function indexAt(x: number, z: number): number {
    const i = Math.floor((x - x0) * inv)
    const j = Math.floor((z - z0) * inv)
    if (i < 0 || j < 0 || i >= cols || j >= rows) return -1
    return j * cols + i
  }

  function floorAt(x: number, z: number): number | null {
    const k = indexAt(x, z)
    return k >= 0 && solid[k] ? heights[k] : null
  }

  function canStand(x: number, z: number, radius: number, fromY?: number): boolean {
    const here = floorAt(x, z)
    if (here === null) return false
    if (fromY !== undefined && Math.abs(here - fromY) > step) return false
    const r = Math.max(0, radius)
    if (r < cell * 0.5) return true
    // Disque échantillonné à la maille : à 10 cm de cellule et 25 cm de rayon,
    // c'est 5 × 5 = 25 lectures de tableau, une poignée de fois par image.
    const span = Math.ceil(r * inv)
    const r2 = r * r
    for (let dj = -span; dj <= span; dj++) {
      for (let di = -span; di <= span; di++) {
        const dx = di * cell
        const dz = dj * cell
        if (dx * dx + dz * dz > r2) continue
        const k = indexAt(x + dx, z + dz)
        if (k < 0 || !solid[k]) return false
        if (Math.abs(heights[k] - here) > step) return false
      }
    }
    return true
  }

  function slide(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    radius: number,
  ): { x: number; z: number } {
    const y = floorAt(fromX, fromZ) ?? undefined
    if (canStand(toX, toZ, radius, y)) return { x: toX, z: toZ }
    // Le mur pris en biais fait LONGER le mur : on retente chaque axe seul.
    // Sans ça, effleurer une cloison arrêterait le personnage net et il
    // resterait planté là, à pousser contre elle.
    if (canStand(toX, fromZ, radius, y)) return { x: toX, z: fromZ }
    if (canStand(fromX, toZ, radius, y)) return { x: fromX, z: toZ }
    return { x: fromX, z: fromZ }
  }

  return {
    floorAt,
    canStand,
    slide,
    seats,
    bounds: wb,
    body: { radius, step, height },
    walkArea,
  }
}
