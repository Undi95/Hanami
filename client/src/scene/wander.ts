// Le comportement du personnage dans la pièce : où il se tient, où il regarde,
// ce qu'il fait. C'est le CERVEAU de la scène vivante — le corps (squelette,
// mixer, IK) reste dans vrmStage.
//
// RÈGLE DU FICHIER : aucun import de `three`, aucune référence au DOM. Il ne
// reçoit et ne rend que des nombres, à travers le contrat `WanderHost`. C'est ce
// qui permet de le faire tourner sous Node pour vérifier ses temporisations, ses
// vitesses et ses angles sans ouvrir un navigateur — et personne ici ne peut
// voir le rendu.
//
// Toutes les grandeurs de mouvement sont des FRACTIONS de la hauteur de hanches
// au repos du modèle (`host.hips()`), jamais des mètres absolus : le dossier
// vrm/ va de 0,755 m (Sakura) à 1,201 m (ModeleTemoin) de hanches, soit un
// rapport de 1,59 — une constante en mètres ferait patiner l'une et courir
// l'autre. C'est exactement la convention de vrma/world.json.

// ── Constantes mesurées ─────────────────────────────────────────────────────
/** Pivots : vitesse angulaire des clips, `deplacement.vitesseRotationDegS`. */
const TURN_LEFT_RATE = 48.4 // °/s, world-turn-left (angleParCycleDeg 53,2 / dureeS 1,1)
const TURN_RIGHT_RATE = -52.1 // °/s, world-turn-right (−52,1 / 1,0)

/**
 * En dessous de cet écart, on tourne SANS clip : le corps glisse dans l'idle à
 * une vitesse assez basse pour lire comme un transfert de poids. Au-dessus, les
 * pieds doivent bouger, donc un clip de pivot. Le seuil est celui de l'amplitude
 * angulaire de l'idle lui-même : `idle.vrma` fait osciller le bassin de ±5°, on
 * prend une marge large.
 */
const TURN_CLIP_THRESHOLD = 25 * (Math.PI / 180)
/** Vitesse du glissement silencieux — la moitié d'un pivot joué. */
const TURN_GLIDE_RATE = 30 * (Math.PI / 180)
/** Fondu d'entrée et de sortie d'un pivot (raccords mesurés : 22,7° / 36,3°). */
const TURN_FADE = 0.3

/**
 * Sous cet écart de cap, on ne fait RIEN. Sans zone morte, le moindre pan de
 * caméra relancerait un pivot : le personnage n'arrêterait jamais de se
 * recaler, et c'est le défaut le plus fatigant qu'on puisse produire.
 */
const FACE_DEADZONE = 12 * (Math.PI / 180)

const DEG2RAD = Math.PI / 180

/** Écart d'angle ramené dans ]−π, π]. */
export function shortAngle(a: number): number {
  const t = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
  return t - Math.PI
}

/** Borne `v` dans [min, max]. */
function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/**
 * Ce que la scène met à disposition du comportement. Rien que des scalaires :
 * c'est le contrat qui garde ce fichier testable hors navigateur.
 */
export interface WanderHost {
  /** Hauteur de hanches au repos du modèle chargé (m). L'unité de tout le reste. */
  hips(): number
  /**
   * Pose le corps. `y` est l'altitude du GROUPE (les pieds, sauf assis où le
   * bassin est remonté) ; `ground` est celle du SOL sous lui — les deux
   * diffèrent dès qu'on est assis, et c'est `ground` que la cinématique inverse
   * vise pour poser les pieds. `yaw` en radians, 0 = regarde +Z.
   */
  place(x: number, y: number, z: number, yaw: number, ground: number): void
  /** Socle d'allure en boucle (clé du domaine `world-`), null = retour au socle normal. */
  gait(name: string | null, fade: number): void
  /** Clip à cycle unique, puis `then` (null = socle voulu). */
  once(name: string, fadeIn: number, then: string | null, fadeThen: number): void
  /** Ce clip du domaine `world-` est-il chargé ? */
  has(name: string): boolean
  /** Une réponse est en train de s'écrire. */
  speaking(): boolean
  /** Cap à prendre pour faire face à la caméra, vu du point (x, z). */
  camYaw(x: number, z: number): number
  /** L'utilisateur manipule la caméra (ou vient de la lâcher). */
  userBusy(): boolean
}

/** Où se tient le personnage. Écrit par le comportement, lu par la scène. */
export interface Pose {
  x: number
  /** Altitude du groupe (pieds au sol debout, bassin remonté assis). */
  y: number
  z: number
  yaw: number
  /** Altitude du SOL sous le personnage — la cible de l'IK des pieds. */
  ground: number
}

type State = 'rest' | 'pivot'

export interface Wander {
  /** Une image de décision + de placement. Appelée AVANT le mixer. */
  update(delta: number): void
  /** Cap et position courants (lecture seule). */
  pose(): Readonly<Pose>
  /** Ramène le personnage au point d'accueil, sans clip. */
  home(): void
}

export function createWander(host: WanderHost): Wander {
  const p: Pose = { x: 0, y: 0, z: 0, yaw: 0, ground: 0 }
  let state: State = 'rest'
  // Cap visé pendant un pivot, et sens du clip en cours (+1 = gauche).
  let yawTarget = 0
  let turnDir: 1 | -1 = 1

  /** Cap voulu au repos : faire face à la caméra. */
  function restingYaw(): number {
    return host.camYaw(p.x, p.z)
  }

  function startPivot(want: number): void {
    const d = shortAngle(want - p.yaw)
    turnDir = d > 0 ? 1 : -1
    yawTarget = want
    const clip = turnDir > 0 ? 'turn-left' : 'turn-right'
    // Clip absent (dossier vrma/ incomplet) : on glisse, on ne bloque pas.
    if (host.has(clip)) host.gait(clip, TURN_FADE)
    state = 'pivot'
  }

  function stopPivot(): void {
    host.gait(null, TURN_FADE)
    state = 'rest'
  }

  function update(delta: number): void {
    switch (state) {
      case 'rest': {
        // On ne bouge pas la scène sous la main de l'utilisateur.
        if (host.userBusy()) break
        const want = restingYaw()
        const d = shortAngle(want - p.yaw)
        if (Math.abs(d) < FACE_DEADZONE) break
        if (Math.abs(d) >= TURN_CLIP_THRESHOLD) {
          startPivot(want)
          break
        }
        // Glissement silencieux : le corps se recale sans lever un pied.
        const step = Math.sign(d) * Math.min(Math.abs(d), TURN_GLIDE_RATE * delta)
        p.yaw += step
        break
      }
      case 'pivot': {
        const rate = (turnDir > 0 ? TURN_LEFT_RATE : TURN_RIGHT_RATE) * DEG2RAD
        // La cible SUIT la caméra pendant le pivot (l'utilisateur peut tourner
        // autour) : sans ça, elle finirait son angle puis en redemanderait un.
        if (!host.userBusy()) yawTarget = restingYaw()
        const left = shortAngle(yawTarget - p.yaw)
        // Le pivot a dépassé, ou la cible est passée de l'autre côté : on rend.
        if (left * turnDir <= 0 || Math.abs(left) < FACE_DEADZONE * 0.5) {
          stopPivot()
          break
        }
        // `rate` porte déjà le signe du sens ; le bornage empêche le dépassement.
        p.yaw += clamp(rate * delta, -Math.abs(left), Math.abs(left))
        break
      }
    }
    host.place(p.x, p.y, p.z, p.yaw, p.ground)
  }

  return {
    update,
    pose: () => p,
    // Retour au point d'accueil, SANS toucher aux animations : c'est l'appelant
    // qui décide du fondu (l'extinction de la scène vivante en veut un long, un
    // changement de décor n'en veut aucun).
    home(): void {
      p.x = 0
      p.y = 0
      p.z = 0
      p.yaw = 0
      p.ground = 0
      state = 'rest'
      host.place(0, 0, 0, 0, 0)
    },
  }
}

/** Constantes exportées pour la vérification hors navigateur (scripts de banc). */
export const WANDER_CONSTANTS = {
  TURN_LEFT_RATE,
  TURN_RIGHT_RATE,
  TURN_CLIP_THRESHOLD,
  TURN_GLIDE_RATE,
  FACE_DEADZONE,
} as const
