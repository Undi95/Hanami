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
import type { Seat } from './sceneMap' // type seul — sceneMap est pur lui aussi

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
/**
 * ATTENTION (un clic sur le personnage) : pendant quelques secondes, la zone
 * morte se resserre — il se met bien en face, là où d'habitude un petit écart
 * le laisse indifférent. C'est toute la différence entre « il m'a vu » et
 * « il traîne par là », sans un seul effet ajouté.
 */
const ATTENTIVE_S = 6
const ATTENTIVE_DEADZONE = 3 * (Math.PI / 180)

// ── Marche ──────────────────────────────────────────────────────────────────
// LA VITESSE N'EST PAS ICI. Elle est LUE sur l'animation, image par image
// (`host.stride()`, cf. legIk.stride) : le sol défile exactement de ce que les
// pieds dépeignent, donc zéro patinage, sur n'importe quel modèle. Ce qui suit
// ne sert qu'à PRÉVOIR — choisir une destination atteignable en un nombre entier
// de foulées — et une prévision à 7 % près n'a aucune conséquence visible.
/** Distance dépeinte par un cycle de `world-walk-slow`, ÷ hanches du rig de mesure. */
const STRIDE_SLOW = 0.501 / 1.0167
/** Idem pour `world-walk` (`deplacement.distanceParCycleM` de vrma/world.json). */
const STRIDE_WALK = 1.421 / 1.0167
/** Distance dépeinte par `world-walk-start`, mesurée ici sur un vrai VRM. */
const STRIDE_START = 0.392

/**
 * Les deux allures et LEUR contrat de phase, tel que `phasesDeRaccord` de
 * vrma/world.json le mesure. Ce contrat n'est pas un réglage : entrer ou sortir
 * d'un cycle à la mauvaise phase coûte jusqu'à 46 cm d'écart de pose.
 */
interface GaitPlan {
  clip: string
  /** Transition de départ, ou null : on entre depuis l'idle. */
  start: string | null
  /** Phase (s) à laquelle ENTRER dans le cycle. */
  enterS: number
  /** Phase (s) à laquelle en SORTIR vers `world-walk-stop`. */
  exitS: number
  durationS: number
  /** Distance dépeinte par cycle, en fraction des hanches. */
  strideFrac: number
  /** Distance dépeinte par la transition de départ, en fraction des hanches. */
  startFrac: number
}

/**
 * Flânerie — l'allure de tous les jours. `depuisIdle` : 10,7 cm, meilleur que
 * de passer par `world-walk-start`, dont le raccord vers cette allure vaut
 * 31,2 cm. `versWorldWalkStop` : 8,3 cm à t = 0,133 s.
 */
const GAIT_STROLL: GaitPlan = {
  clip: 'walk-slow',
  start: null,
  enterS: 0,
  exitS: 0.133,
  durationS: 1.3,
  strideFrac: STRIDE_SLOW,
  startFrac: 0,
}

/**
 * Marche franche, pour traverser une pièce. C'est LE contrat mesuré à 0 cm des
 * deux côtés : `world-walk-start` finit exactement sur `world-walk` à
 * t = 0,200 s, et `world-walk-stop` commence exactement sur sa couture (t = 0).
 * Quitter le cycle ailleurs coûte jusqu'à 46 cm — autrement dit : le personnage
 * FINIT SON PAS avant de s'arrêter.
 */
const GAIT_WALK: GaitPlan = {
  clip: 'walk',
  start: 'walk-start',
  enterS: 0.2,
  exitS: 0,
  durationS: 1,
  strideFrac: STRIDE_WALK,
  startFrac: STRIDE_START,
}

/** Au-delà de cette distance, la flânerie devient ridicule : on marche. */
const WALK_OVER_STROLL_M = 2.6
/** Fondus des transitions de marche. */
const WALK_FADE = 0.4
const STOP_FADE = 0.35
const AFTER_STOP_FADE = 0.2
/** Vitesse de correction du cap PENDANT la marche (le clip va tout droit). */
const WALK_TURN_RATE = 60 * (Math.PI / 180)
/** Écart de cap au-delà duquel on pivote SUR PLACE avant de partir. */
const WALK_ALIGN = 40 * (Math.PI / 180)
/** Pas d'échantillonnage d'un chemin lors de sa vérification (m). */
const PATH_STEP = 0.15

/**
 * Plafond du temps de marche d'UN trajet (s). Les plans sont déjà bornés par la
 * pièce, mais un obstacle mobile ou une carte étrange ne doivent jamais donner
 * un personnage qui arpente sans fin : au plafond, il finit son pas et s'arrête,
 * où qu'il soit.
 */
const MAX_WALK_S = 15

// ── Assise ──────────────────────────────────────────────────────────────────
// Tous les chiffres viennent de vrma/world.json, mesurés sur le rig d'Overte
// (1,0167 m de hanches) — d'où les divisions : on convertit en fraction de
// hanches pour que la grandeur se transporte sur n'importe quel modèle.
/** Fraction des hanches où TOUS les clips assis tiennent le bassin (posture canonique). */
const SIT_HIPS_FRAC = 0.5409
/** Le bassin est ~10 cm au-dessus de l'assise sur le rig — en fraction de hanches. */
const SEAT_GAP_FRAC = 0.1 / 1.0167
/** Recul dépeint par world-sit-enter (deplacementCodeM.z) : à appliquer PAR LE CODE. */
const SIT_BACKUP_FRAC = 0.2672 / 1.0167
/**
 * Profondeur du bassin DANS la nappe d'assise, comptée depuis son bord côté
 * approche (fraction de hanches). C'est ce qui fait qu'on s'assoit au BORD d'un
 * lit et non en son milieu — une chaise entière tient dans cette profondeur.
 */
const SEAT_INSET_FRAC = 0.22
/** Fondu d'ENTRÉE des transitions assises (l'autre extrémité est ancrée : 0). */
const SIT_FADE = 0.3
/** Fondu d'un échange de socle assis (sit-idle ↔ sit-talking) et des gestes assis. */
const BASE_SWAP_FADE = 0.4
/** Durée passée assis (s), tirée uniformément. On s'assoit pour de bon. */
const SIT_MIN_S = 90
const SIT_MAX_S = 240
/** Attente entre deux gestes assis (sit-look, sit-shift), tirée uniformément (s). */
const FIDGET_MIN_S = 25
const FIDGET_MAX_S = 80
/** Arrivé à cette distance du point de pré-assise, on enchaîne (fraction hanches). */
const SEAT_NEAR_FRAC = 0.55
/** Segments de marche pour approcher une assise avant d'abandonner. */
const SEAT_LEGS = 2
/**
 * Zone de MANŒUVRE d'un trajet d'assise : sur les derniers centimètres, le
 * gabarit passe du disque au POINT (sol et dénivelé seulement). Sans elle,
 * aucune assise n'est atteignable : la case d'approche est par construction
 * collée au meuble, donc toujours refusée au disque — mesuré sur les 66 assises
 * des trois décors, 66 refus au rayon de la carte. Se serrer contre un meuble
 * pour s'y asseoir est exactement ce que fait un corps. En mètres, pas en
 * hanches : c'est une propriété du MOBILIER, pas du modèle.
 */
const MANEUVER_M = 0.7

// ── Déambulation ────────────────────────────────────────────────────────────
// L'utilisateur discute avec quelqu'un, pas avec un personnage agité : ces
// durées sont volontairement LONGUES. Un compagnon qui se déplace toutes les dix
// secondes est insupportable au bout de deux minutes.
/** Attente entre deux déplacements (s), tirée uniformément. */
const REST_MIN_S = 45
const REST_MAX_S = 120
/** Distance d'un déplacement spontané, en fraction des hanches. */
const ROAM_MIN_FRAC = 0.8
const ROAM_MAX_FRAC = 4
/** Une fois sur trois, il rentre au point d'accueil au lieu d'aller ailleurs. */
const HOME_ODDS = 1 / 3
/** Une fois sur trois aussi, la déambulation vise une assise de la pièce. */
const SEAT_ODDS = 1 / 3
/** Essais de tirage d'une destination avant d'abandonner, en silence. */
const ROAM_TRIES = 10

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

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
  /**
   * Socle d'allure en boucle (clé du domaine `world-`), null = retour au socle
   * normal. `phase` pose le temps du clip à l'entrée — c'est par lui que le
   * contrat de phase se tient.
   */
  gait(name: string | null, fade: number, phase?: number): void
  /** Temps courant du clip d'allure (s), ou -1 s'il n'y en a pas. */
  gaitTime(): number
  /** Clip à cycle unique, puis `then` (null = socle voulu), posé à `thenPhase`. */
  once(name: string, fadeIn: number, then: string | null, fadeThen: number, thenPhase?: number): void
  /** Ce clip du domaine `world-` est-il chargé ? */
  has(name: string): boolean
  /**
   * Déplacement au sol dépeint par l'animation depuis l'image précédente, dans
   * le repère du personnage (z = devant). Rend false si aucun appui n'est
   * crédible. C'EST la vitesse de marche : elle n'est pas imposée, elle est lue.
   */
  stride(out: { x: number; z: number }): boolean
  /** Une réponse est en train de s'écrire. */
  speaking(): boolean
  /** Cap à prendre pour faire face à la caméra, vu du point (x, z). */
  camYaw(x: number, z: number): number
  /** L'utilisateur manipule la caméra (ou vient de la lâcher). */
  userBusy(): boolean
  /** Altitude du sol sous (x, z), ou null : pas de sol praticable connu. */
  floorAt(x: number, z: number): number | null
  /** Le gabarit tient-il debout ici ? (disque de `radius`, dénivelé depuis `fromY`) */
  canStand(x: number, z: number, radius: number, fromY?: number): boolean
  /** Rayon du gabarit (m) tel que l'analyse du décor l'a employé. */
  bodyRadius(): number
  /** Un clip de TRANSITION (départ, arrêt, assise) tient-il l'écran ? */
  transitioning(): boolean
  /** Avancement 0 → 1 du clip de transition en cours (1 si aucun). */
  onceProgress(): number
  /**
   * Coupe la transition en cours et rend l'écran au socle voulu. N'est appelé
   * que par home() : un changement de décor peut tomber au milieu d'une assise.
   */
  interrupt(fade: number): void
  /**
   * Régime des pieds pour la cinématique inverse : 'planted' debout (on ne fait
   * que remonter un pied qui traverse), 'reach' assis (le pied VISE le sol —
   * jambes qui pendent d'un siège haut, genoux repliés d'un siège bas).
   */
  feet(mode: 'planted' | 'reach'): void
  /** Les assises que l'analyse du décor a trouvées. */
  seats(): readonly Seat[]
  /** La pièce est-elle décrite ? Sans carte, aucun déplacement n'est tenté. */
  mapped(): boolean
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

type State =
  | 'rest'
  | 'pivot'
  | 'align'
  | 'starting'
  | 'walking'
  | 'stopping'
  // La séquence d'assise : pivot dos au siège, s'asseoir, être assis, se lever.
  | 'seatAlign'
  | 'sitDown'
  | 'seated'
  | 'sitUp'

export interface Wander {
  /** Une image de décision + de placement. Appelée APRÈS le mixer (odométrie). */
  update(delta: number): void
  /** Cap et position courants (lecture seule). */
  pose(): Readonly<Pose>
  /**
   * Va (approximativement) là. Rend false si c'est impossible : pas de carte,
   * point impraticable, ou le personnage est déjà occupé à autre chose.
   * La destination retenue est à un nombre ENTIER de foulées — c'est ce qui
   * permet de sortir du cycle sur sa couture sans ni patiner ni dépasser.
   * Assis, il commence par se lever, puis y va.
   */
  goTo(x: number, z: number): boolean
  /** Va s'asseoir LÀ (une assise de host.seats()). Mêmes refus que goTo. */
  goSit(seat: Seat): boolean
  /** Est-il occupé (marche, transition, assis) — par opposition au repos debout ? */
  busy(): boolean
  /** Est-il assis (ou en train de s'asseoir) ? */
  seated(): boolean
  /**
   * On vient de cliquer sur lui : quelques secondes d'ATTENTION — au repos, il
   * se met bien en face de la caméra au lieu de rester vaguement tourné. Sans
   * effet s'il est occupé (marche, assise) : on ne coupe pas ce qu'il fait.
   */
  poke(): void
  /** Ramène le personnage au point d'accueil, sans clip. `fade` : fondu du retour au socle. */
  home(fade?: number): void
}

export function createWander(host: WanderHost): Wander {
  const p: Pose = { x: 0, y: 0, z: 0, yaw: 0, ground: 0 }
  let state: State = 'rest'
  // Cap visé pendant un pivot, et sens du clip en cours (+1 = gauche).
  let yawTarget = 0
  let turnDir: 1 | -1 = 1
  // Marche en cours.
  let plan: GaitPlan = GAIT_STROLL
  let destX = 0
  let destZ = 0
  /** Temps du clip d'allure à l'image précédente : détecte le passage de la couture. */
  let lastGaitTime = -1
  /** L'arrêt est décidé, il attend la bonne phase du cycle. */
  let wantStop = false
  /** Temps passé à marcher sur le trajet en cours (s) — plafonné par MAX_WALK_S. */
  let walked = 0
  /** Temps restant (s) avant le prochain déplacement spontané. */
  let restTimer = rand(REST_MIN_S, REST_MAX_S)
  /** Horloge interne (s, cumul des deltas) — sert aux fenêtres d'attention. */
  let now = 0
  /** Jusqu'à quand le clic sur le personnage resserre la zone morte. */
  let attentiveUntil = -Infinity
  const step = { x: 0, z: 0 }

  /**
   * Trajet d'assise en cours (de la marche d'approche jusqu'au lever). Les
   * points sont figés AU DÉPART : une assise ne bouge pas, et refaire la
   * géométrie à chaque image n'apporterait que des occasions de divergence.
   */
  interface SeatRun {
    sitX: number // où le BASSIN se pose (bord de la nappe côté du regard)
    sitZ: number
    standX: number // point de pré-assise THÉORIQUE : sitPoint + recul de world-sit-enter
    standZ: number
    // Où il se tenait VRAIMENT au moment de s'asseoir (figé par beginSitDown) :
    // c'est LÀ que le lever le ramène. Le point théorique peut être hors grille
    // (il frôle le meuble par construction) — on ne se relève jamais vers un
    // point que personne n'a validé, on se relève d'où l'on est venu.
    outX: number
    outZ: number
    yaw: number // cap assis (radians)
    seatedY: number // altitude du GROUPE une fois assis (bassin sur l'assise réelle)
    groundY: number // altitude du sol sous les pieds — la cible de l'IK 'reach'
    legsLeft: number // segments de marche restants pour approcher
  }
  let seatRun: SeatRun | null = null
  /** Glissement pendant une transition assise : le code porte le déplacement du clip. */
  let slide: { fx: number; fy: number; fz: number; tx: number; ty: number; tz: number } | null = null
  /** Temps restant assis, et avant le prochain geste assis (s). */
  let sitLeaveT = 0
  let fidgetT = 0
  /** Socle assis posé en dernier — pour ne re-fondre que sur un vrai changement. */
  let seatBase: 'sit-idle' | 'sit-talking' = 'sit-idle'
  /** Destination à reprendre une fois debout (goTo reçu pendant qu'il est assis). */
  let afterStand: { x: number; z: number } | null = null

  /** Cap voulu au repos : faire face à la caméra. */
  function restingYaw(): number {
    return host.camYaw(p.x, p.z)
  }

  function startPivot(want: number, next: State): void {
    const d = shortAngle(want - p.yaw)
    turnDir = d > 0 ? 1 : -1
    yawTarget = want
    const clip = turnDir > 0 ? 'turn-left' : 'turn-right'
    // Clip absent (dossier vrma/ incomplet) : on glisse, on ne bloque pas.
    if (host.has(clip)) host.gait(clip, TURN_FADE)
    state = next
  }

  /** Avance le cap vers `want` au taux du clip de pivot. Rend true quand c'est fini. */
  function turnStep(delta: number, want: number): boolean {
    const rate = (turnDir > 0 ? TURN_LEFT_RATE : TURN_RIGHT_RATE) * DEG2RAD
    const left = shortAngle(want - p.yaw)
    if (left * turnDir <= 0 || Math.abs(left) < FACE_DEADZONE * 0.5) return true
    // `rate` porte déjà le signe du sens ; le bornage empêche le dépassement.
    p.yaw += clamp(rate * delta, -Math.abs(left), Math.abs(left))
    return false
  }

  /**
   * Le sol tient-il sous le personnage tout au long du segment ? Les points à
   * moins de `tailFree` de l'ARRIVÉE — et de `headFree` du DÉPART — sont testés
   * au point et non au disque. La queue est la zone de manœuvre d'un trajet
   * d'assise ; la tête l'est quand on PART d'un endroit serré (on vient de se
   * lever contre un meuble : quitter la place doit être permis, y entrer non).
   */
  function pathClear(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    radius: number,
    tailFree = 0,
    headFree = 0,
  ): boolean {
    const d = Math.hypot(x1 - x0, z1 - z0)
    const n = Math.max(1, Math.ceil(d / PATH_STEP))
    const from = host.floorAt(x0, z0) ?? undefined
    for (let i = 1; i <= n; i++) {
      const t = i / n
      const r = d * (1 - t) < tailFree || d * t < headFree ? 0 : radius
      if (!host.canStand(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, r, from)) return false
    }
    return true
  }

  /**
   * Prépare une marche vers (x, z). La distance retenue est un nombre ENTIER de
   * foulées : la sortie du cycle tombe alors sur sa couture ET sur la
   * destination, sans qu'il faille ni presser le pas ni dépasser.
   * `seatLeg` : segment d'un trajet d'assise — la fin du chemin et la
   * destination elle-même sont en zone de manœuvre (gabarit au point).
   */
  function planWalk(x: number, z: number, seatLeg = false): boolean {
    if (!host.mapped()) return false
    const h = host.hips()
    const radius = host.bodyRadius()
    const tail = seatLeg ? MANEUVER_M : 0
    const dx = x - p.x
    const dz = z - p.z
    const want = Math.hypot(dx, dz)
    if (want < 0.05) return false
    const g = want > WALK_OVER_STROLL_M && host.has(GAIT_WALK.clip) ? GAIT_WALK : GAIT_STROLL
    if (!host.has(g.clip)) return false
    const stride = g.strideFrac * h
    const startD = g.startFrac * h
    // Départ d'un endroit serré (on vient de se lever contre un meuble) : la
    // tête du chemin est en manœuvre, elle aussi au point.
    const head = host.canStand(p.x, p.z, radius) ? 0 : MANEUVER_M
    // Nombre entier de cycles, au moins un, pour approcher `want` au mieux.
    let n = Math.max(1, Math.round((want - startD) / stride))
    const dir = { x: dx / want, z: dz / want }
    // On raccourcit tant que le chemin ne passe pas : mieux vaut s'arrêter avant
    // l'obstacle que de s'y cogner et de rester planté contre lui.
    for (; n >= 1; n--) {
      const d = startD + stride * n
      const tx = p.x + dir.x * d
      const tz = p.z + dir.z * d
      const rEnd = seatLeg && Math.hypot(x - tx, z - tz) < tail ? 0 : radius
      if (host.canStand(tx, tz, rEnd) && pathClear(p.x, p.z, tx, tz, radius, tail, head)) {
        plan = g
        destX = tx
        destZ = tz
        return true
      }
    }
    return false
  }

  /** Démarre la marche préparée : pivot d'alignement si l'écart de cap est franc. */
  function beginWalk(): void {
    walked = 0
    const want = Math.atan2(destX - p.x, destZ - p.z)
    if (Math.abs(shortAngle(want - p.yaw)) >= WALK_ALIGN) {
      startPivot(want, 'align')
      return
    }
    launchGait()
  }

  function launchGait(): void {
    wantStop = false
    lastGaitTime = -1
    if (plan.start && host.has(plan.start)) {
      // Départ : la dernière image de `world-walk-start` EST la pose du cycle à
      // t = 0,200 s. On l'y enchaîne donc SANS fondu et à cette phase exacte —
      // c'est le contrat mesuré à 0 cm.
      host.once(plan.start, WALK_FADE, plan.clip, 0, plan.enterS)
      state = 'starting'
      return
    }
    host.gait(plan.clip, WALK_FADE, plan.enterS)
    state = 'walking'
  }

  /** Déclenche l'arrêt : le clip d'arrêt, puis le retour au socle. */
  function beginStop(): void {
    wantStop = false
    if (host.has('walk-stop')) {
      host.once('walk-stop', STOP_FADE, null, AFTER_STOP_FADE)
      state = 'stopping'
      return
    }
    host.gait(null, STOP_FADE)
    endLeg()
  }

  /**
   * Fin d'un segment de marche. Sans trajet d'assise : repos. Avec : on enchaîne
   * si le point de pré-assise est à portée, on remarche s'il reste des segments,
   * et sinon on abandonne EN SILENCE — une assise devenue inaccessible n'est pas
   * une panne, le personnage reste simplement debout où il est.
   */
  function endLeg(): void {
    if (!seatRun) {
      state = 'rest'
      return
    }
    const near = Math.hypot(seatRun.standX - p.x, seatRun.standZ - p.z)
    if (near <= Math.max(SEAT_NEAR_FRAC * host.hips(), 0.45)) {
      startPivot(seatRun.yaw, 'seatAlign')
      return
    }
    if (seatRun.legsLeft > 0 && planWalk(seatRun.standX, seatRun.standZ, true)) {
      seatRun.legsLeft--
      beginWalk()
      return
    }
    seatRun = null
    state = 'rest'
  }

  // ── Assise ────────────────────────────────────────────────────────────────

  /**
   * Géométrie d'un trajet d'assise — et c'est le CAP de l'assise qui la
   * possède, pas le point d'approche : le personnage assis regarde `seat.yaw`,
   * donc il s'assoit sur le bord de la nappe SITUÉ DE CE CÔTÉ, dos au reste du
   * meuble. Mélanger le bord côté approche et le recul côté cap fabriquait des
   * points de pré-assise DANS le matelas du lit (vérifié sur rustic-bedroom).
   *
   * Le bassin se pose en retrait de SEAT_INSET derrière ce bord : au bord d'un
   * lit, au milieu d'une chaise (dont la demi-nappe tient dans l'enfoncement,
   * la borne au centre du rectangle fait le reste). Le point de pré-assise en
   * découle par le recul mesuré de world-sit-enter, et l'altitude assise par la
   * posture canonique — c'est l'assise RÉELLE qui décide, l'IK adapte les jambes.
   */
  function planSeat(seat: Seat): SeatRun | null {
    if (!seat.approach) return null
    const h = host.hips()
    const yaw = seat.yaw * DEG2RAD
    const fx = Math.sin(yaw)
    const fz = Math.cos(yaw)
    let sitX = seat.center[0]
    let sitZ = seat.center[1]
    if (seat.bounds) {
      const [x0, z0, x1, z1] = seat.bounds
      const bx = (x0 + x1) / 2
      const bz = (z0 + z1) / 2
      // Demi-étendue de la nappe dans la direction du regard (fonction d'appui
      // du rectangle) : la distance du centre au bord de ce côté-là.
      const sEdge = (Math.abs(fx) * (x1 - x0) + Math.abs(fz) * (z1 - z0)) / 2
      const s = Math.max(sEdge - SEAT_INSET_FRAC * h, 0)
      sitX = bx + fx * s
      sitZ = bz + fz * s
    }
    const back = SIT_BACKUP_FRAC * h
    const standX = sitX + fx * back
    const standZ = sitZ + fz * back
    // Le sol sous les pieds une fois assis : sous le point de pré-assise (les
    // pieds y restent), à défaut sous la case d'approche — jamais inventé.
    const groundY = host.floorAt(standX, standZ) ?? host.floorAt(seat.approach[0], seat.approach[1])
    if (groundY === null) return null
    return {
      sitX,
      sitZ,
      standX,
      standZ,
      outX: standX,
      outZ: standZ,
      yaw,
      seatedY: seat.y + (SEAT_GAP_FRAC - SIT_HIPS_FRAC) * h,
      groundY,
      legsLeft: SEAT_LEGS,
    }
  }

  /** Prépare et lance un trajet d'assise. Rend false sans rien changer si impossible. */
  function tryGoSit(seat: Seat): boolean {
    if (!host.has('sit-idle')) return false
    const run = planSeat(seat)
    if (!run) return false
    // Marcher vers le point de pré-assise ; s'il est injoignable en ligne
    // droite, vers la case d'approche donnée par l'analyse (un second segment
    // s'occupera du reste, cf. endLeg).
    const walkable =
      planWalk(run.standX, run.standZ, true) ||
      (seat.approach !== null && planWalk(seat.approach[0], seat.approach[1], true))
    if (!walkable) return false
    seatRun = run
    beginWalk()
    return true
  }

  /** Pivot achevé dos au siège : s'asseoir. Le glissement porte ce que le clip a retiré. */
  function beginSitDown(): void {
    const run = seatRun
    if (!run) {
      state = 'rest'
      return
    }
    // La stance RÉELLE de départ : le point du lever, et le sol des pieds. Le
    // sol est relu ici — il est forcément connu (on a marché jusqu'ici).
    run.outX = p.x
    run.outZ = p.z
    const g = host.floorAt(p.x, p.z)
    if (g !== null) run.groundY = g
    slide = { fx: p.x, fy: run.groundY, fz: p.z, tx: run.sitX, ty: run.seatedY, tz: run.sitZ }
    host.feet('reach')
    // La dernière image de world-sit-enter EST world-sit-idle à t = 0 (ancrée) :
    // enchaînement sans fondu, à cette phase exacte.
    host.once('sit-enter', SIT_FADE, 'sit-idle', 0, 0)
    seatBase = 'sit-idle'
    state = 'sitDown'
  }

  /** Se lever : l'inverse exact, puis retour au repos (ou à la destination promise). */
  function beginSitUp(): void {
    const run = seatRun
    if (!run) {
      state = 'rest'
      return
    }
    slide = { fx: run.sitX, fy: run.seatedY, fz: run.sitZ, tx: run.outX, ty: run.groundY, tz: run.outZ }
    host.once('sit-exit', SIT_FADE, null, AFTER_STOP_FADE)
    state = 'sitUp'
  }

  /**
   * Avance le corps de ce que l'ANIMATION vient de dépeindre, borné par les
   * obstacles. Rend la distance réellement parcourue.
   */
  function advance(): number {
    if (!host.stride(step)) return 0
    const c = Math.cos(p.yaw)
    const s = Math.sin(p.yaw)
    const wx = step.x * c + step.z * s
    const wz = -step.x * s + step.z * c
    const nx = p.x + wx
    const nz = p.z + wz
    const before = { x: p.x, z: p.z }
    // La zone de manœuvre vaut aussi pour le CORPS en mouvement : près de
    // l'assise visée, et tant qu'on se tient dans un endroit serré (on vient de
    // se lever contre un meuble) — sans ça, le disque bloquerait net à 25 cm du
    // meuble et la destination du plan, vérifiée au point, serait inatteignable.
    const full = host.bodyRadius()
    const radius =
      (seatRun && Math.hypot(destX - p.x, destZ - p.z) < MANEUVER_M) ||
      !host.canStand(p.x, p.z, full, p.ground)
        ? 0
        : full
    if (host.canStand(nx, nz, radius, p.ground)) {
      p.x = nx
      p.z = nz
    } else {
      // Un mur pris en biais fait LONGER le mur — sinon le personnage resterait
      // planté contre lui à mouliner des jambes jusqu'à la fin de son plan.
      let slid = false
      if (host.canStand(nx, p.z, radius, p.ground)) {
        p.x = nx
        slid = true
      }
      if (host.canStand(p.x, nz, radius, p.ground)) {
        p.z = nz
        slid = true
      }
      if (!slid) return -1 // bloqué net : l'appelant abrège
    }
    const g = host.floorAt(p.x, p.z)
    if (g !== null) {
      p.ground = g
      p.y = g
    }
    return Math.hypot(p.x - before.x, p.z - before.z)
  }

  /**
   * Déplacement spontané : soit un point tiré autour de soi, soit le retour au
   * point d'accueil. Aucune destination valable → il ne se passe RIEN, en
   * silence : une pièce trop encombrée pour marcher n'est pas une panne.
   */
  function roam(): void {
    if (!host.mapped()) return
    const h = host.hips()
    // Une fois sur trois : aller s'asseoir quelque part. L'assise est tirée au
    // poids de l'AIRE — un canapé attire plus qu'un tabouret, comme dans la vie.
    const seats = host.seats().filter((s) => s.approach !== null)
    if (seats.length > 0 && Math.random() < SEAT_ODDS) {
      let total = 0
      for (const s of seats) total += Math.max(s.area, 0.05)
      let pick = Math.random() * total
      for (const s of seats) {
        pick -= Math.max(s.area, 0.05)
        if (pick <= 0) {
          if (tryGoSit(s)) return
          break // assise injoignable aujourd'hui : on déambule normalement
        }
      }
    }
    if (Math.random() < HOME_ODDS && Math.hypot(p.x, p.z) > 0.3 && planWalk(0, 0)) {
      beginWalk()
      return
    }
    for (let i = 0; i < ROAM_TRIES; i++) {
      const a = Math.random() * Math.PI * 2
      const d = rand(ROAM_MIN_FRAC, ROAM_MAX_FRAC) * h
      if (planWalk(p.x + Math.sin(a) * d, p.z + Math.cos(a) * d)) {
        beginWalk()
        return
      }
    }
  }

  /** Le cycle vient-il de franchir sa phase de sortie ? */
  function crossedExit(): boolean {
    const t = host.gaitTime()
    if (t < 0) return false
    const prev = lastGaitTime
    lastGaitTime = t
    if (prev < 0) return false
    const e = plan.exitS
    // Couture (exitS = 0) : le temps du clip REVIENT en arrière au bouclage.
    if (t < prev) return e <= t || e > prev
    return e > prev && e <= t
  }

  function update(delta: number): void {
    now += delta
    switch (state) {
      case 'rest': {
        const attentive = now < attentiveUntil
        // On ne bouge pas la scène sous la main de l'utilisateur — SAUF pendant
        // l'attention : le clic qui la déclenche vient de compter comme un geste
        // de caméra, attendre la grâce tuerait toute la réactivité.
        if (host.userBusy() && !attentive) break
        // Le minuteur ne court PAS pendant qu'une réponse s'écrit : il ne partira
        // jamais au milieu d'une phrase.
        if (!host.speaking()) restTimer -= delta
        const want = restingYaw()
        const d = shortAngle(want - p.yaw)
        // Se recaler face à la caméra prime : c'est ce qui rend le personnage
        // attentif, et ça coûte moins qu'un déplacement.
        if (Math.abs(d) >= TURN_CLIP_THRESHOLD) {
          startPivot(want, 'pivot')
          break
        }
        if (Math.abs(d) >= (attentive ? ATTENTIVE_DEADZONE : FACE_DEADZONE)) {
          // Glissement silencieux : le corps se recale sans lever un pied.
          p.yaw += Math.sign(d) * Math.min(Math.abs(d), TURN_GLIDE_RATE * delta)
          break
        }
        if (restTimer <= 0) {
          restTimer = rand(REST_MIN_S, REST_MAX_S)
          if (!host.speaking()) roam()
        }
        break
      }
      case 'pivot': {
        // La cible SUIT la caméra pendant le pivot (l'utilisateur peut tourner
        // autour) : sans ça, elle finirait son angle puis en redemanderait un.
        if (!host.userBusy()) yawTarget = restingYaw()
        if (turnStep(delta, yawTarget)) {
          host.gait(null, TURN_FADE)
          state = 'rest'
        }
        break
      }
      case 'align': {
        if (turnStep(delta, yawTarget)) launchGait()
        break
      }
      case 'starting': {
        // `world-walk-start` porte lui-même son élan : on ne fait qu'avancer de
        // ce qu'il dépeint. C'est `once` qui rendra la main au cycle, à la
        // bonne phase, sur son événement de fin.
        advance()
        if (!host.transitioning()) {
          // La transition s'est achevée : le cycle a pris la main, à sa phase.
          lastGaitTime = -1
          state = 'walking'
        }
        break
      }
      case 'walking': {
        // Le cap se corrige DOUCEMENT pendant la marche : le clip va tout droit,
        // un virage serré se verrait comme un dérapage.
        const want = Math.atan2(destX - p.x, destZ - p.z)
        const dYaw = shortAngle(want - p.yaw)
        if (Math.hypot(destX - p.x, destZ - p.z) > 0.2) {
          p.yaw += clamp(dYaw, -WALK_TURN_RATE * delta, WALK_TURN_RATE * delta)
        }
        const crossed = crossedExit() // AVANT tout : tient `lastGaitTime` à jour
        // L'arrêt décidé à un tour PRÉCÉDENT part sur cette couture-ci. L'ordre
        // compte : décider et s'arrêter dans la même image ferait perdre le
        // dernier cycle — la décision tombe justement quand il reste une foulée,
        // c'est-à-dire une image après la couture (mesuré : 1,51 m au lieu de
        // 1,86, systématiquement un cycle de moins).
        if (crossed && wantStop) {
          beginStop()
          break
        }
        if (advance() < 0) {
          // Bloqué net : on s'arrête proprement plutôt que de pousser un mur.
          beginStop()
          break
        }
        // Ce qu'il RESTE, recalculé et jamais cumulé : une somme de distances
        // par image compte les allers-retours du bassin comme du chemin parcouru
        // et arrive court de près de moitié (mesuré : 1,06 m au lieu de 1,86).
        const toGo = Math.hypot(destX - p.x, destZ - p.z)
        // Distance qu'il reste à parcourir dans le cycle courant avant sa phase
        // de sortie. Dès qu'elle suffit à couvrir ce qui reste du plan, l'arrêt
        // est décidé — et il attend cette phase-là pour se déclencher.
        const stride = plan.strideFrac * host.hips()
        const t = host.gaitTime()
        const left = t < 0 ? 0 : ((plan.exitS - t + plan.durationS) % plan.durationS) / plan.durationS
        if (!wantStop && toGo <= stride * left + 0.02) wantStop = true
        // Le plafond de marche : au-delà, on finit son pas et on s'arrête là.
        walked += delta
        if (!wantStop && walked > MAX_WALK_S) {
          seatRun = null // le trajet d'assise est abandonné avec la marche
          wantStop = true
        }
        break
      }
      case 'stopping': {
        // `world-walk-stop` n'est PAS une décélération : c'est un transfert de
        // poids, 13,5 % des hanches en 1,9 s, pied planté de 0,43 s à 1,90 s.
        // On avance donc exactement de ce qu'il dépeint, ni plus ni moins.
        advance()
        if (!host.transitioning()) endLeg()
        break
      }
      case 'seatAlign': {
        if (!seatRun) {
          host.gait(null, TURN_FADE)
          state = 'rest'
          break
        }
        if (turnStep(delta, seatRun.yaw)) beginSitDown()
        break
      }
      case 'sitDown': {
        const run = seatRun
        if (!run || !slide) {
          state = 'rest'
          break
        }
        // Le clip est joué SUR PLACE (translation retirée à la conversion) : le
        // code porte son déplacement — recul sur l'assise ET descente du groupe
        // à l'altitude assise — au prorata de son avancement.
        const k = host.onceProgress()
        p.x = slide.fx + (slide.tx - slide.fx) * k
        p.y = slide.fy + (slide.ty - slide.fy) * k
        p.z = slide.fz + (slide.tz - slide.fz) * k
        p.ground = run.groundY
        if (!host.transitioning()) {
          p.x = slide.tx
          p.y = slide.ty
          p.z = slide.tz
          slide = null
          sitLeaveT = rand(SIT_MIN_S, SIT_MAX_S)
          fidgetT = rand(FIDGET_MIN_S, FIDGET_MAX_S)
          state = 'seated'
        }
        break
      }
      case 'seated': {
        // Un geste assis (sit-look, sit-shift) tient l'écran : on le laisse finir.
        if (host.transitioning()) break
        // Il répond ASSIS, avec le clip prévu : le socle suit la parole.
        const want = host.speaking() && host.has('sit-talking') ? 'sit-talking' : 'sit-idle'
        if (want !== seatBase) {
          seatBase = want
          host.gait(want, BASE_SWAP_FADE)
        }
        // Pendant une réponse, RIEN d'autre ne bouge : ni geste, ni lever.
        if (host.speaking()) break
        fidgetT -= delta
        if (!host.userBusy()) sitLeaveT -= delta
        if (sitLeaveT <= 0 || afterStand) {
          beginSitUp()
          break
        }
        if (fidgetT <= 0) {
          fidgetT = rand(FIDGET_MIN_S, FIDGET_MAX_S)
          const gesture = Math.random() < 0.5 ? 'sit-look' : 'sit-shift'
          // La fin du geste rend l'écran à sit-idle (son `then`) : le livre des
          // socles doit le savoir, sinon une parole en cours de geste croirait
          // sit-talking encore en place.
          if (host.has(gesture) && seatBase === 'sit-idle') {
            host.once(gesture, BASE_SWAP_FADE, 'sit-idle', BASE_SWAP_FADE)
          }
        }
        break
      }
      case 'sitUp': {
        const run = seatRun
        if (!run || !slide) {
          state = 'rest'
          break
        }
        const k = host.onceProgress()
        p.x = slide.fx + (slide.tx - slide.fx) * k
        p.y = slide.fy + (slide.ty - slide.fy) * k
        p.z = slide.fz + (slide.tz - slide.fz) * k
        p.ground = run.groundY
        if (!host.transitioning()) {
          p.x = slide.tx
          p.y = slide.ty
          p.z = slide.tz
          p.ground = run.groundY
          slide = null
          seatRun = null
          host.feet('planted')
          restTimer = rand(REST_MIN_S, REST_MAX_S)
          state = 'rest'
          // Une destination promise pendant qu'il était assis : il y va.
          if (afterStand) {
            const dest = afterStand
            afterStand = null
            if (planWalk(dest.x, dest.z)) beginWalk()
          }
        }
        break
      }
    }
    host.place(p.x, p.y, p.z, p.yaw, p.ground)
  }

  return {
    update,
    pose: () => p,
    busy: () => state !== 'rest' && state !== 'pivot',
    seated: () => state === 'seated' || state === 'sitDown',
    goTo(x, z): boolean {
      // Assis : il se lève d'abord, puis y va — la destination est promise, pas
      // perdue. Refusée seulement s'il est déjà en plein mouvement.
      if (state === 'seated') {
        if (!host.mapped() || host.speaking()) return false
        afterStand = { x, z }
        return true
      }
      if (state !== 'rest') return false
      if (!planWalk(x, z)) return false
      beginWalk()
      return true
    },
    goSit(seat): boolean {
      if (state !== 'rest') return false
      return tryGoSit(seat)
    },
    poke(): void {
      if (state === 'rest' || state === 'pivot') attentiveUntil = now + ATTENTIVE_S
    },
    /**
     * Retour au point d'accueil. Les clips en place sont rendus au socle avec ce
     * `fade` (l'extinction de la scène vivante en veut un long, un changement de
     * décor un bref) et la transition en vol est coupée — un changement de décor
     * peut tomber au milieu d'une assise, le personnage ne doit pas rester
     * assis dans le vide de la pièce suivante.
     */
    home(fade = 0.25): void {
      p.x = 0
      p.y = 0
      p.z = 0
      p.yaw = 0
      p.ground = 0
      state = 'rest'
      wantStop = false
      walked = 0
      seatRun = null
      slide = null
      afterStand = null
      restTimer = rand(REST_MIN_S, REST_MAX_S)
      host.feet('planted')
      host.gait(null, fade)
      host.interrupt(fade)
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
