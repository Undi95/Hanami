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

type State = 'rest' | 'pivot' | 'align' | 'starting' | 'walking' | 'stopping'

export interface Wander {
  /** Une image de décision + de placement. Appelée AVANT le mixer. */
  update(delta: number): void
  /** Cap et position courants (lecture seule). */
  pose(): Readonly<Pose>
  /**
   * Va (approximativement) là. Rend false si c'est impossible : pas de carte,
   * point impraticable, ou le personnage est déjà occupé à autre chose.
   * La destination retenue est à un nombre ENTIER de foulées — c'est ce qui
   * permet de sortir du cycle sur sa couture sans ni patiner ni dépasser.
   */
  goTo(x: number, z: number): boolean
  /** Est-il en train de marcher (ou de partir, ou de s'arrêter) ? */
  busy(): boolean
  /** Ramène le personnage au point d'accueil, sans clip. */
  home(): void
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
  /** Temps restant (s) avant le prochain déplacement spontané. */
  let restTimer = rand(REST_MIN_S, REST_MAX_S)
  const step = { x: 0, z: 0 }

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

  /** Le sol tient-il sous le personnage tout au long du segment ? */
  function pathClear(x0: number, z0: number, x1: number, z1: number, radius: number): boolean {
    const d = Math.hypot(x1 - x0, z1 - z0)
    const n = Math.max(1, Math.ceil(d / PATH_STEP))
    const from = host.floorAt(x0, z0) ?? undefined
    for (let i = 1; i <= n; i++) {
      const t = i / n
      if (!host.canStand(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, radius, from)) return false
    }
    return true
  }

  /**
   * Prépare une marche vers (x, z). La distance retenue est un nombre ENTIER de
   * foulées : la sortie du cycle tombe alors sur sa couture ET sur la
   * destination, sans qu'il faille ni presser le pas ni dépasser.
   */
  function planWalk(x: number, z: number): boolean {
    if (!host.mapped()) return false
    const h = host.hips()
    const radius = host.bodyRadius()
    const dx = x - p.x
    const dz = z - p.z
    const want = Math.hypot(dx, dz)
    if (want < 0.05) return false
    const g = want > WALK_OVER_STROLL_M && host.has(GAIT_WALK.clip) ? GAIT_WALK : GAIT_STROLL
    if (!host.has(g.clip)) return false
    const stride = g.strideFrac * h
    const startD = g.startFrac * h
    // Nombre entier de cycles, au moins un, pour approcher `want` au mieux.
    let n = Math.max(1, Math.round((want - startD) / stride))
    const dir = { x: dx / want, z: dz / want }
    // On raccourcit tant que le chemin ne passe pas : mieux vaut s'arrêter avant
    // l'obstacle que de s'y cogner et de rester planté contre lui.
    for (; n >= 1; n--) {
      const d = startD + stride * n
      const tx = p.x + dir.x * d
      const tz = p.z + dir.z * d
      if (host.canStand(tx, tz, radius) && pathClear(p.x, p.z, tx, tz, radius)) {
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
    state = 'rest'
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
    const radius = host.bodyRadius()
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
    switch (state) {
      case 'rest': {
        // On ne bouge pas la scène sous la main de l'utilisateur.
        if (host.userBusy()) break
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
        if (Math.abs(d) >= FACE_DEADZONE) {
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
        break
      }
      case 'stopping': {
        // `world-walk-stop` n'est PAS une décélération : c'est un transfert de
        // poids, 13,5 % des hanches en 1,9 s, pied planté de 0,43 s à 1,90 s.
        // On avance donc exactement de ce qu'il dépeint, ni plus ni moins.
        advance()
        if (!host.transitioning()) state = 'rest'
        break
      }
    }
    host.place(p.x, p.y, p.z, p.yaw, p.ground)
  }

  return {
    update,
    pose: () => p,
    busy: () => state !== 'rest' && state !== 'pivot',
    goTo(x, z): boolean {
      if (state !== 'rest') return false
      if (!planWalk(x, z)) return false
      beginWalk()
      return true
    },
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
      wantStop = false
      restTimer = rand(REST_MIN_S, REST_MAX_S)
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
