// Marqueurs de clic de la scène vivante — le seul retour visuel qu'un clic dans
// la pièce ait jamais eu.
//
// Le constat qui les fait exister : sur 7 480 clics relevés dans la classe,
// 5 343 n'ont RIEN déclenché, et se sont tus. Le refus était juste 38 fois sur
// 39 (un mur, un plateau de table, une case hors carte, un personnage déjà en
// mouvement) — ce n'est donc pas la logique qu'il fallait changer, c'est le
// silence. Un clic sans réponse ne se lit pas « impossible », il se lit
// « cassé », et l'utilisateur recommence.
//
// D'où DEUX marques, du même vocabulaire, distinguées par la taille, la couleur
// et la durée — jamais par un mouvement qui attire l'œil :
//
//   ACCEPTÉ  anneau à la couleur d'accent du thème, 17 → 27 cm, ~0,6 s
//   REFUSÉ   même anneau désaturé, 10 → 13 cm, ~0,34 s
//
// Aucun rebond, aucune pulsation, aucun son : l'anneau naît à sa pleine
// opacité (la réponse doit être INSTANTANÉE), s'ouvre en fondu sortant et
// disparaît. On regarde le personnage, pas la marque.
//
// COÛT. Deux meshes construits une fois pour toutes (une géométrie partagée,
// un matériau chacun pour que les deux couleurs cohabitent), jamais rien
// d'alloué au clic. Par image, quand rien n'est en vie : un test et un retour.
// Quand un anneau vit : trois multiplications et deux écritures.
import { DoubleSide, Mesh, MeshBasicMaterial, RingGeometry, SRGBColorSpace } from 'three'
import type { Object3D, Vector3 } from 'three'

/** Rayons de départ et d'arrivée (m), durée de vie (s) et opacité de naissance. */
const ACCEPT = { r0: 0.17, r1: 0.27, life: 0.6, alpha: 0.5 }
const REFUSE = { r0: 0.1, r1: 0.13, life: 0.34, alpha: 0.3 }

/**
 * Décollement de la surface visée, VERS LA CAMÉRA (m). Une seule règle pour
 * tous les cas : sur un sol elle soulève l'anneau, sur un mur elle l'avance —
 * là où un décalage vertical fixe l'aurait à moitié noyé dans la cloison. 2 cm
 * suffisent à écarter le z-fighting aux distances de la scène (0,5 à 4 m).
 */
const LIFT = 0.02

/**
 * Épaisseur de l'anneau, en fraction du rayon. La géométrie est unitaire (rayon
 * extérieur 1) : l'échelle du mesh EST le rayon voulu, et le trait maigrit avec
 * lui — l'anneau du refus est donc plus fin que celui de l'acceptation sans
 * qu'on ait à le dire.
 */
const RING_INNER = 0.86
const RING_SEGMENTS = 48

/** Couleur d'accent de repli — celle du thème sakura, le défaut de l'app. */
const ACCENT_FALLBACK: Rgb = [0.961, 0.639, 0.78]

type Rgb = [number, number, number]

/** '#rrggbb' → composantes sRGB dans [0, 1], ou null si ce n'est pas lisible. */
function parseHex(value: string): Rgb | null {
  const hex = value.trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ]
}

/**
 * La couleur d'accent du thème COURANT, lue dans le CSS au moment du clic.
 *
 * `--accent` vaut un hexadécimal plein dans les cinq thèmes préfaits ; en thème
 * perso il vaut `var(--custom-accent, …)`, que la substitution des propriétés
 * personnalisées a déjà résolu à l'heure du style calculé. Toute autre forme
 * (un thème écrit à la main en `rgb()`, un navigateur qui ne rend rien) retombe
 * sur le défaut : un marqueur d'une couleur inattendue serait pire qu'un
 * marqueur rose.
 */
function readAccent(): Rgb {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent')
    return parseHex(raw) ?? ACCENT_FALLBACK
  } catch {
    return ACCENT_FALLBACK
  }
}

/**
 * La même couleur, vidée de sa teinte : c'est le « non » du vocabulaire. On
 * garde un quart de la teinte d'origine plutôt que de virer au gris franc — la
 * marque reste de la famille du thème, elle n'est pas un message d'erreur.
 * Les accents de l'app sont tous des pastels clairs (luminance ~0,7), donc le
 * gris obtenu se voit aussi bien sur une chambre sombre que sur une classe.
 */
function desaturate(rgb: Rgb): Rgb {
  const l = 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2]
  const keep = 0.25
  return [l + (rgb[0] - l) * keep, l + (rgb[1] - l) * keep, l + (rgb[2] - l) * keep]
}

export interface ClickMarks {
  /**
   * Le clic a lancé quelque chose. `point` est l'impact visé, `eye` la position
   * de la caméra (elle seule sait de quel côté décoller l'anneau).
   */
  accept(point: Vector3, eye: Vector3): void
  /** Le clic n'a rien lancé, mais il a été entendu. */
  refuse(point: Vector3, eye: Vector3): void
  /** Une image d'estompage. Sort immédiatement si aucun anneau n'est en vie. */
  update(delta: number): void
  /** Efface tout à l'instant (extinction du mode, décor changé, onglet caché). */
  clear(): void
  /** Retire les meshes et libère géométrie et matériaux. */
  dispose(): void
}

interface Slot {
  mesh: Mesh
  material: MeshBasicMaterial
  /** Temps écoulé et durée de vie ; `life` à 0 = libre. */
  age: number
  life: number
  r0: number
  r1: number
  alpha: number
}

/**
 * Les marqueurs, posés dans `parent` — la SCÈNE, jamais le groupe du décor :
 * celui-ci est gelé au chargement (matrixWorldAutoUpdate à false, cf. envMerge),
 * un anneau qui y vivrait n'aurait jamais sa matrice recomposée.
 *
 * Deux emplacements, pas un : un utilisateur qui corrige son tir enchaîne deux
 * clics en moins d'une demi-seconde, et le premier anneau ne doit pas être
 * arraché de l'écran pour laisser la place au second. Au troisième, c'est le
 * plus avancé dans sa vie qui cède — celui qu'on regarde le moins.
 */
export function createClickMarks(parent: Object3D): ClickMarks {
  const geometry = new RingGeometry(RING_INNER, 1, RING_SEGMENTS)
  const slots: Slot[] = []
  for (let i = 0; i < 2; i++) {
    const material = new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      // L'anneau ne participe pas au tampon de profondeur (il ne masque rien)
      // mais il le LIT : une marque posée derrière un meuble reste derrière lui.
      depthWrite: false,
      // Un anneau posé sur une étagère haute se regarde par en dessous.
      side: DoubleSide,
    })
    const mesh = new Mesh(geometry, material)
    // À plat : la géométrie de l'anneau naît dans le plan XY, on la couche dans
    // le plan du sol. Elle y reste, même sur un mur — le vocabulaire est celui
    // d'une marque au sol, et une marque qui s'oriente à chaque surface aurait
    // demandé la normale de l'impact, donc une matrice normale par clic.
    mesh.rotation.x = -Math.PI / 2
    mesh.visible = false
    mesh.name = 'click-mark'
    parent.add(mesh)
    slots.push({ mesh, material, age: 0, life: 0, r0: 0, r1: 0, alpha: 0 })
  }

  let live = 0

  function spawn(point: Vector3, eye: Vector3, spec: typeof ACCEPT, rgb: Rgb): void {
    // Emplacement libre, sinon le plus vieux (le plus près de s'éteindre).
    let slot = slots[0]
    let worst = -1
    for (const s of slots) {
      if (s.life === 0) {
        slot = s
        break
      }
      const done = s.age / s.life
      if (done > worst) {
        worst = done
        slot = s
      }
    }
    if (slot.life === 0) live++

    // Décollement vers l'œil, sans allouer : la direction est calculée composante
    // par composante (l'impact appartient à three, on ne le modifie pas).
    const dx = eye.x - point.x
    const dy = eye.y - point.y
    const dz = eye.z - point.z
    const d = Math.hypot(dx, dy, dz) || 1
    const k = LIFT / d
    slot.mesh.position.set(point.x + dx * k, point.y + dy * k, point.z + dz * k)
    slot.material.color.setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace)
    slot.age = 0
    slot.life = spec.life
    slot.r0 = spec.r0
    slot.r1 = spec.r1
    slot.alpha = spec.alpha
    slot.mesh.scale.setScalar(spec.r0)
    slot.material.opacity = spec.alpha
    slot.mesh.visible = true
  }

  return {
    accept(point, eye) {
      spawn(point, eye, ACCEPT, readAccent())
    },

    refuse(point, eye) {
      spawn(point, eye, REFUSE, desaturate(readAccent()))
    },

    update(delta) {
      if (live === 0) return
      for (const slot of slots) {
        if (slot.life === 0) continue
        slot.age += delta
        const t = slot.age / slot.life
        if (t >= 1) {
          slot.life = 0
          slot.mesh.visible = false
          slot.material.opacity = 0
          live--
          continue
        }
        // Ouverture en sortie de course (1 − (1 − t)³) : franche au début, elle
        // s'arrête sans jamais dépasser sa cible. Pas de rebond : ce serait un
        // mouvement de dessin animé dans une scène qui n'en fait aucun.
        const ease = 1 - (1 - t) ** 3
        slot.mesh.scale.setScalar(slot.r0 + (slot.r1 - slot.r0) * ease)
        // L'opacité, elle, part de son maximum — la réponse au clic est
        // immédiate, c'est sa disparition qui est douce.
        slot.material.opacity = slot.alpha * (1 - t) ** 1.5
      }
    },

    clear() {
      for (const slot of slots) {
        slot.life = 0
        slot.age = 0
        slot.mesh.visible = false
        slot.material.opacity = 0
      }
      live = 0
    },

    dispose() {
      for (const slot of slots) {
        parent.remove(slot.mesh)
        slot.material.dispose()
      }
      geometry.dispose()
      slots.length = 0
      live = 0
    },
  }
}
