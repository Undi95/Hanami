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
import type { Waypoint } from './pathfind' // idem
import type { Emotion } from '../../../shared/types' // idem : rien qu'une union de chaînes
// Les FONDUS de la scène vivante viennent de la table d'Overte (fades.ts). Ce
// module reste pur : `fades.ts` n'est que des nombres, comme les deux imports
// ci-dessus.
import {
  HOME_OUT,
  NO_FADE,
  SIT_GESTURE_IN,
  SIT_GESTURE_OUT,
  SIT_IN,
  SIT_LAND,
  SIT_TALK,
  STOP_IN,
  STOP_OUT,
  STOP_SMALL_IN,
  TURN_IN,
  TURN_OUT,
  WALK_CYCLE_IN,
  WALK_START_IN,
} from './fades'
import type { Fade } from './fades'

// ── Constantes mesurées ─────────────────────────────────────────────────────
/** Pivots : vitesse angulaire des clips, `deplacement.vitesseRotationDegS`. */
const TURN_LEFT_RATE = 48.4 // °/s, world-turn-left (angleParCycleDeg 53,2 / dureeS 1,1)
const TURN_RIGHT_RATE = -52.1 // °/s, world-turn-right (−52,1 / 1,0)
/**
 * Phase (s) à laquelle ENTRER dans chaque clip de pivot — le contrat
 * `depuisIdle` / `entreeMoteurS` de vrma/world.json. Sans elle, l'action
 * gardait son temps RASSIS (three fige `time` à poids nul) : chaque pivot
 * après le premier entrait à une phase arbitraire, jusqu'à 19,2 cm de la pose
 * d'idle (moy 13,9 — échec au seuil des 10 cm). À sa phase de contrat, le
 * pire cas sur toutes les phases d'idle tombe à 7,2 / 7,8 cm (minimax mesuré,
 * rig de la sonde).
 */
const TURN_ENTER_LEFT_S = 0.167
const TURN_ENTER_RIGHT_S = 0.033

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
// Les FONDUS du pivot sont TURN_IN / TURN_OUT (fades.ts). Ce qui reste ici est
// le contrat de PHASE, qui n'a rien à voir : TURN_ENTER_*_S ci-dessus dit à
// quelle image du clip on entre, TURN_IN dit en combien de temps son poids monte.
//
// La sortie de pivot tombe où le cap l'arrête : aucune phase ne peut la sauver
// (pire 19,2 cm / moy 13,9 contre l'idle, mesuré sur toutes les phases des deux
// clips), seul le fondu adoucit. Mesures aux pires phases, pointe du pire os
// (cm/s), 0,3–0,4 → 0,5 :
//   pivot → idle        97–109 → 74–104
//   pivot → walk-start 250–272 → 212–231
//   pivot → sit-enter  150–160 → 111–143

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

/**
 * FRACTION DE CYCLE entre la phase d'ENTRÉE et la phase de SORTIE. La marche
 * n'est pas faite de cycles entiers : elle entre à `enterS` et sort à `exitS`,
 * et ne dépeint entre les deux que cette fraction-là du dernier cycle. La
 * compter pour un cycle plein décalait toute l'arithmétique d'arrêt d'autant —
 * et comme l'arrêt ne part QUE sur une phase de sortie, le personnage dépassait
 * sa destination de la fraction manquante puis finissait le cycle : mesuré
 * 0,84 m de trop (0,8 cycle de `world-walk`, entrée 0,200 s / sortie 0,000 s)
 * sur CHAQUE marche franche. La flânerie n'en souffrait presque pas (0,133 s
 * d'écart, 3,8 cm) — c'est ce qui a caché le défaut aux premiers bancs, qui ne
 * mesuraient la position que sur elle.
 */
function cycleTail(g: GaitPlan): number {
  return ((g.exitS - g.enterS + g.durationS) % g.durationS) / g.durationS
}

/**
 * Plus court trajet que `g` sache dépeindre, en fraction de hanches : son clip
 * de départ (s'il en a un) plus la fraction de cycle qu'il joue avant de sortir
 * sur la couture. Pour `world-walk` : 0,392 + 1,398 × 0,8 = 1,51 hanche, soit
 * 1,54 m sur le rig de mesure. C'est la borne sous laquelle l'allure ne peut
 * plus servir — elle dépasserait le but au lieu de s'en approcher.
 */
function shortestTrip(g: GaitPlan): number {
  return g.startFrac + g.strideFrac * cycleTail(g)
}

/**
 * Au-delà de cette distance, la flânerie devient ridicule : on marche.
 *
 * Ce n'est PAS un réglage de goût, c'est la granularité de `world-walk` : sa
 * foulée fait 1,421 m et son plus court trajet possible vaut
 * `startFrac + strideFrac × (1 + exitFrac)` = 0,399 + 1,421 × 1,8 = 2,96 m
 * (rig de mesure). En dessous, la marche franche ne sait pas se poser près du
 * but — elle le dépasse. La flânerie, foulée 0,501 m, descend elle à 0,55 m.
 * Le seuil est donc là où les deux se croisent, pas ailleurs.
 */
const WALK_OVER_STROLL_M = 2.6

// ── COURIR : MESURÉ, ET REFUSÉ — trois fois plutôt qu'une ───────────────────
//
// Le catalogue contient `world-jog` et `world-run`, et l'envie de s'en servir
// sur les longs trajets est légitime. Ils ne sont pas branchés, et ce bloc dit
// pourquoi : ce n'est pas un choix, c'est une mesure.
//
// 1. L'ODOMÉTRIE NE LES PORTE PAS. La vitesse de ce fichier n'est jamais
//    imposée, elle est LUE sur l'animation (`host.stride()`, cf. legIk.stride :
//    recul pondéré du pied le plus BAS). Une allure de VOL n'a, par définition,
//    aucun pied porteur pendant l'envol : le « pied le plus bas » y balance vers
//    l'AVANT, et l'odométrie lit un recul NÉGATIF. Rejoué image par image sur
//    les vrais clips, sur trois modèles couvrant tout le dossier vrm/ (hanches
//    0,755 / 0,905 / 1,201 m) :
//
//                     avance nette      recul cumulé      images en
//                     (rig 0,905 m)     par cycle         marche arrière
//      world-walk        1,348 m/s         0,0 cm             3 %
//      world-walk-slow   0,277 m/s         2,1 cm            15 %
//      world-walk-fast   1,125 m/s        13,7 cm            21 %
//      world-jog         0,669 m/s        42,2 cm            31 %
//      world-run         0,089 m/s        67,3 cm            42 %
//
//    `world-run` fait 5,6 cm par cycle de 0,63 s : il COURT SUR PLACE, en
//    tremblant de 67 cm d'avant en arrière à chaque foulée. `world-walk-fast`
//    lui-même recule 0,15 s d'affilée par cycle (jusqu'à −2,0 m/s) — c'est
//    pour ça qu'il n'est pas branché non plus. Seul `world-walk` ne recule
//    JAMAIS : c'est la seule allure franche que ce moteur sait porter.
//
// 2. AUCUN RACCORD PROPRE, NI À L'ENTRÉE NI À LA SORTIE. `phasesDeRaccord` de
//    vrma/world.json, à la MEILLEURE phase de chaque cycle : `world-jog` tombe
//    à 33,5 cm de l'idle et 33,0 cm de l'arrêt ; `world-run` à 51,4 et 51,6 cm.
//    Le seuil du projet est 10 cm. Il n'y a donc pas d'arrêt de course à
//    « décélérer » vers la marche : il n'y a pas de course tenable du tout.
//
// 3. OVERTE NE FAIT PAS CE QU'ON VOUDRAIT FAIRE. Dans vrma/transitions.json,
//    il n'existe NI état `jog` NI état `run` : `WALKFWD` est un seul état de
//    type `blendLinearMove` dont les cinq enfants sont walk_short / walk /
//    walk_fast / jog / run, mélangés le long de `moveForwardSpeed`
//    (vitesses caractéristiques 0,5 / 1,8 / 2,5 / 3,55 / 5,675 m/s). Le moteur
//    « choisit et ÉTIRE le cycle selon la vitesse réelle du personnage » : chez
//    Overte c'est la vitesse qui commande le clip. Ici c'est le clip qui
//    commande la vitesse — l'inverse exact, et c'est ce qui nous garantit zéro
//    patinage sur n'importe quel modèle. Imposer 1,4 m/s à `world-run` ferait
//    balayer le pied d'appui de ~24 cm par phase d'appui (seuil « défaut » du
//    banc : 8 cm).
//
// CE QU'IL FAUDRAIT POUR COURIR : un mélange de deux allures à phase verrouillée
// AVEC mise à l'échelle du temps de lecture (le `blendLinearMove` d'Overte), et
// une odométrie qui sache traverser une phase de vol. Le premier est du ressort
// de vrmStage (cf. le bloc « CHANGER D'ALLURE EN MARCHANT » ci-dessous), le
// second de legIk. Tant que les deux n'existent pas, la bande « course » n'a pas
// de clip pour la tenir, et une bande sans clip n'est pas une bande.

// ── CHANGER D'ALLURE EN MARCHANT — mesuré, PAS branché ─────────────────────
//
// Aujourd'hui l'allure est choisie UNE FOIS par segment, dans planWalk, et ne
// change plus jusqu'à l'arrêt. Deux segments consécutifs sont séparés par un
// arrêt complet (`walk-stop` → socle → `walk-start`) : une allure qui change
// d'un segment à l'autre ne se voit donc pas. Il n'y a, à ce jour, AUCUN défaut
// d'allure à corriger dans ce fichier — et c'est pour ça que rien de ce bloc
// n'est appelé.
//
// Ce qui suit est la mesure faite pour le jour où l'on voudra accélérer ou
// ralentir SANS s'arrêter. Elle est consignée ici, à l'endroit où la décision se
// prendra, pour que personne n'ait à la refaire.
//
// CE QUI A ÉTÉ MESURÉ (sonde du banc, rig reference-2.vrm, hanches
// 0,9045 m ; écart de pose du pire os majeur, en cm) :
//
//                            bascule brute   MEILLEURE paire   verrou de phase
//                            (B repris à 0)  de phases         (pire φ du fondu)
//   walk-slow → walk              24,1            6,4                29,1
//   walk      → walk-slow         42,0            6,4                29,1
//   walk      → walk-fast         47,7            3,9                12,9
//   walk-slow → walk-fast         21,7            6,4                34,0
//
// TROIS CONCLUSIONS, dans l'ordre où elles comptent :
//
// 1. Le contrat de phase suffit. Sortir du cycle courant à une phase précise et
//    entrer dans le suivant à une autre — exactement ce que `host.gait(clip,
//    fondu, phase)` sait déjà faire, exactement le mécanisme de `walk-start` et
//    `walk-stop` — ramène le changement d'allure à 3,9–6,4 cm, donc SOUS le
//    seuil « passe » de 7 cm du projet. Les paires mesurées sont dans
//    `changeInto` ci-dessous.
// 2. `omega = vitesse / distanceParCycle` est une TAUTOLOGIE ici. world.json
//    impose sa propre cohérence interne — « distanceParCycleM ÷ dureeS redonne
//    exactement vitesseMS » — donc omega vaut 1 / dureeS, et la phase normalisée
//    d'un cycle est simplement t / durationS. Ce fichier la calcule déjà (voir
//    le reste de cycle dans le cas 'walking'). Il n'y a pas de grandeur à
//    ajouter, seulement un champ déjà présent à relire : `durationS`.
// 3. Le MÉLANGE de deux allures à phase verrouillée ne peut pas s'écrire ici, et
//    ce n'est pas une question de courage. Il demande DEUX actions d'allure
//    jouées ensemble, dont le code règle le `time` et le poids à chaque image —
//    c'est-à-dire vrmStage, pas ce fichier. Le contrat `WanderHost` n'expose
//    qu'un socle d'allure à la fois (`gait`) et son temps en lecture
//    (`gaitTime`). Tant que le contrat ne change pas, ce bloc reste une note.
//
// L'HYSTÉRÉSIS attend la même chose. Un seuil sans hystérésis n'oscille que s'il
// est relu en boucle ; celui-ci est lu une fois par segment. Les deux bornes
// ci-dessous sont donc DÉCLARÉES et pas branchées : elles n'auront de sens qu'au
// jour où l'allure se rejugera par image, et les brancher aujourd'hui
// changerait le choix d'allure de certains segments — donc les empreintes du
// banc de trajets — pour corriger un défaut qui n'existe pas encore.
/**
 * Bornes d'un futur choix d'allure PAR IMAGE. Monter demande de dépasser
 * `WALK_UP_M`, redescendre de repasser sous `WALK_DOWN_M` : l'écart entre les
 * deux est la zone morte qui empêche un pas d'osciller entre deux allures. La
 * borne haute est le seuil actuel ; la borne basse lui laisse 1,20 m de marge,
 * un peu moins qu'une foulée de marche franche (1,42 m sur le rig de mesure) :
 * il faut avoir déjà « rendu » un pas entier pour avoir le droit de ralentir.
 * PAS BRANCHÉ — voir le bloc ci-dessus.
 */
export const GAIT_HYSTERESIS_M = { up: WALK_OVER_STROLL_M, down: WALK_OVER_STROLL_M - 1.2 }
/**
 * Changement d'allure SANS arrêt : pour chaque couple, la phase (s) à laquelle
 * quitter l'allure de départ, celle à laquelle entrer dans l'autre, et l'écart
 * de pose que ce couple laisse (cm, rig de la sonde — les cm suivent la taille
 * du modèle). Mesuré en balayant les 30 × 39 couples de phases des deux cycles.
 * PAS BRANCHÉ — voir le bloc ci-dessus.
 */
export const GAIT_CHANGE_PHASES: Record<string, { exitS: number; enterS: number; ecartCm: number }> = {
  'walk-slow>walk': { exitS: 0, enterS: 0.933, ecartCm: 6.4 },
  'walk>walk-slow': { exitS: 0.933, enterS: 0, ecartCm: 6.4 },
  'walk>walk-fast': { exitS: 0.733, enterS: 0.6, ecartCm: 3.9 },
  'walk-slow>walk-fast': { exitS: 1.2, enterS: 0.8, ecartCm: 6.4 },
}
// Les FONDUS de la marche sont WALK_START_IN / WALK_CYCLE_IN / STOP_IN /
// STOP_SMALL_IN / STOP_OUT (fades.ts). Les PHASES d'entrée et de sortie des
// cycles, elles, restent les contrats de vrma/world.json ci-dessus.
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

// ── Itinéraires ─────────────────────────────────────────────────────────────
// Un trajet n'est plus une ligne droite mais une SUITE de segments droits, dont
// les étapes viennent de la recherche de chemin (host.path, cf. pathfind.ts).
// Rien d'autre ne change : chaque segment reste un départ, un cycle de marche
// entré à sa phase, un arrêt sur la couture. C'est le même enchaînement que les
// deux segments d'un trajet d'assise, généralisé à N.
/**
 * Étape considérée atteinte en deçà de cette distance (fraction des hanches).
 * Un segment se termine à un nombre ENTIER de foulées : il ne tombe jamais pile
 * sur son étape, il la dépasse ou s'arrête juste avant. Sans cette tolérance, le
 * moteur redemanderait un pas de vingt centimètres — que la plus courte des
 * foulées (41 cm en flânerie) ne sait pas faire.
 */
const WAYPOINT_REACH_FRAC = 0.35
/**
 * Segments accordés EN PLUS des étapes de l'itinéraire. Ils paient les reprises :
 * un segment raccourci devant un obstacle laisse son étape en place et la revise
 * au suivant. Sans ce crédit, une seule reprise coûterait la fin du chemin.
 */
const ROUTE_SPARE_LEGS = 3
/**
 * Plafond dur du nombre de segments d'un trajet. Le chemin le plus tortueux des
 * trois décors en demande cinq ; au-delà, c'est une carte étrange, et un
 * personnage qui arpente la pièce pendant deux minutes ne se rattrape pas.
 */
const ROUTE_MAX_LEGS = 12

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
// Les FONDUS de l'assise sont SIT_IN / SIT_LAND / SIT_TALK / SIT_GESTURE_*
// (fades.ts). Ce que les mesures d'ici disaient, et qui reste vrai :
// - l'ancrage « la dernière image de sit-enter EST sit-idle@0 » n'est vrai QUE
//   de la variante canonique : les quatre autres en sont à 1,6–4,4 cm (jusqu'à
//   92° de poignet), et l'enchaînement SANS fondu les claquait en une image
//   (98 à 235 cm/s au banc) — d'où SIT_LAND, la seconde pleine d'Overte ;
// - la bascule sit-idle ↔ sit-talking tire deux socles à phases quelconques :
//   pire paire à 26,8 cm (rightHand, l'amplitude des mains de la parole). À
//   0,4 s le fondu culminait à 82 cm/s, 3,4 fois le rythme propre du clip de
//   parole (p95 24 cm/s) ; à 0,8 s il tombe à 62 cm/s — d'où SIT_TALK ;
// - les entrées de sit-look / sit-shift sont mesurées à 1,7–2,4 cm : rien à
//   rattraper de ce côté, c'est la SORTIE qui manquait de temps.
// La PHASE d'entrée de sit-idle (0) reste, elle, un contrat de raccord.
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
/**
 * Pas de recherche du sol quand le point de pré-assise est tiré vers la case
 * d'approche (m). Court exprès : on cherche le PREMIER endroit qui porte, donc
 * on déplace le point le moins possible. Le pas de vérification de chemin
 * (PATH_STEP, 15 cm) est trois fois trop gros pour ça — il ferait reculer la
 * pré-assise jusqu'à 15 cm de plus que nécessaire, autant de glissement en trop
 * pendant world-sit-enter.
 */
const SEAT_PULL_STEP = 0.05

/**
 * CE QUE LE CORPS ASSIS DIT D'UNE ÉMOTION.
 *
 * Debout, une émotion joue son geste (`happy.vrma`…) ; assis, le socle EST une
 * allure du domaine `world-`, et la garde de playGesture refusait donc TOUT
 * geste — le visage portait l'émotion à lui seul, sur les 18 à 25 % du temps
 * que la scène vivante passe assise (mesuré sur les trois décors, 15 min de
 * simulation chacun). Ces clips-là existent pourtant, mesurés contre le
 * maintien assis (`world-sit-idle`) : c'est cette table qui les rattache.
 *
 * LES CLEFS SONT CELLES DU CATALOGUE, pas des noms de fichiers : `catalogFromUrls`
 * (vrmStage) retire le suffixe NUMÉRIQUE de variante, donc `sit-clap` compte
 * trois fichiers (clap, -2, -3), `sit-nod` trois aussi (nod, -2, -3), et c'est
 * `worldAction` qui tire le fichier. Réclamer `sit-clap-2` ne rendrait rien.
 *
 * Le choix de chaque clip est celui d'Overte pour le même rôle (leurs noms de
 * nœuds sont dans `source.noeudOverte`, vrma/world.json) : applaudir et se
 * réjouir pour la joie, baisser la tête pour la tristesse, secouer la tête et
 * balayer d'un geste pour la colère, se pencher et agiter les jambes pour la
 * détente, hocher la tête pour le neutre. `surprised` est le seul cas où le
 * catalogue offre exactement le mot : `sit-disbelief`, l'incrédulité.
 */
const SIT_EMOTES: Record<Emotion, readonly string[]> = {
  happy: ['sit-clap', 'sit-cheer'],
  sad: ['sit-sad'],
  angry: ['sit-shake', 'sit-dismiss'],
  relaxed: ['sit-lean', 'sit-legs'],
  neutral: ['sit-nod'],
  surprised: ['sit-disbelief'],
}
/**
 * Réaction au clic sur le personnage, ASSIS — le pendant de `nod.vrma` debout.
 * Deux clefs, donc quatre fichiers (ack + les trois hochements assis).
 */
const SIT_REACTIONS: readonly string[] = ['sit-ack', 'sit-nod']
/** Rôle de l'anti-répétition pour le clic. Le `@` le met hors d'atteinte d'une émotion. */
const SIT_ROLE_CLICK = '@clic'
/**
 * Gestes d'assise AMBIANTS — regarder autour (sit-look), se replacer
 * (sit-shift). Tirés par pickSeatClip comme les émotions : le tirage 50/50
 * indépendant qui précédait rejouait le même geste une fois sur deux (52 %
 * mesurés sur 500 tirages au banc), et deux sit-look d'affilée lisent comme un
 * tic. Au passage, une clef au fichier manquant ne fait plus sauter le tour :
 * l'ancien tirage pouvait la choisir, puis `has` refusait, et rien ne jouait.
 */
const SIT_FIDGETS: readonly string[] = ['sit-look', 'sit-shift']
/** Rôle de l'anti-répétition pour la bougeotte assise — même règle que le clic. */
const SIT_ROLE_FIDGET = '@bougeotte'

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
/**
 * Détour toléré par une destination SPONTANÉE, en multiple de la distance à vol
 * d'oiseau. La recherche de chemin rend joignables des points qui ne l'étaient
 * pas — mais un pas de deux mètres qui devient une traversée de pièce n'est plus
 * une flânerie, c'est une expédition. Au-delà, on retire une autre destination :
 * le tirage reste celui d'avant (0,8 à 4 hanches autour de soi), donc la
 * déambulation ne se met pas soudain à viser le fond de la salle.
 * Les clics de l'utilisateur et les assises, eux, ne sont jamais plafonnés :
 * elles ont été VOULUES.
 */
const ROAM_DETOUR_MAX = 1.8

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
  gait(name: string | null, fade: Fade, phase?: number): void
  /** Temps courant du clip d'allure (s), ou -1 s'il n'y en a pas. */
  gaitTime(): number
  /** Clip à cycle unique, puis `then` (null = socle voulu), posé à `thenPhase`. */
  once(name: string, fadeIn: Fade, then: string | null, fadeThen: Fade, thenPhase?: number): void
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
  /**
   * Itinéraire par les allées jusqu'à (toX, toZ) : les étapes à enchaîner, la
   * dernière étant l'arrivée — ou null s'il n'existe aucun chemin au gabarit.
   * APPELÉ À LA DEMANDE (un clic, une assise, une déambulation), jamais par
   * image, et seulement quand la ligne droite ne passe pas.
   */
  path(fromX: number, fromZ: number, toX: number, toZ: number, radius: number): Waypoint[] | null
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
  interrupt(fade: Fade): void
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
  /**
   * Une émotion VIENT DE SE PRODUIRE. Assis et au repos, le corps la joue par
   * le canal des gestes assis et rend true — la scène n'a rien d'autre à faire.
   * Rend false partout ailleurs (debout, en marche, en pleine transition
   * d'assise, geste assis déjà à l'écran) : c'est alors à la scène de décider,
   * exactement comme avant.
   */
  emote(emotion: Emotion): boolean
  /** Idem pour le clic sur le personnage : l'acquiescement, version assise. */
  react(): boolean
  /** Ramène le personnage au point d'accueil, sans clip. `fade` : fondu du retour au socle. */
  home(fade?: Fade): void
}

export function createWander(host: WanderHost): Wander {
  const p: Pose = { x: 0, y: 0, z: 0, yaw: 0, ground: 0 }
  let state: State = 'rest'
  // Cap visé pendant un pivot, et sens du clip en cours (+1 = gauche).
  let yawTarget = 0
  let turnDir: 1 | -1 = 1
  /**
   * Un clip de pivot tient l'écran. C'est lui qui choisit le fondu de la
   * SORTIE (TURN_OUT) là où la même jonction sans pivot garde son fondu
   * court — un départ de marche depuis l'idle est excellent (2,0 cm), depuis
   * un pivot il part de 19 cm.
   */
  let turnClipUp = false
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
  /**
   * Étapes qu'il RESTE à enchaîner, la dernière étant la destination. Vide : le
   * trajet en cours est une ligne droite, exactement comme avant ce chantier.
   */
  let route: Waypoint[] = []
  /** Segments de marche encore accordés à l'itinéraire (garde-fou). */
  let routeLegs = 0
  /**
   * Le trajet en cours a été COMMANDÉ (un clic au sol, un clic sur une assise),
   * par opposition à la déambulation spontanée. Un ordre et une flânerie n'ont
   * pas les mêmes droits : l'ordre choisit son allure sur tout le chemin, la
   * flânerie garde la sienne, segment par segment, comme toujours.
   */
  let ordered = false
  /**
   * Allure du trajet COMMANDÉ en cours, choisie une fois pour toutes sur la
   * LONGUEUR DU CHEMIN (somme des étapes de l'itinéraire, pas la distance à vol
   * d'oiseau) — et tenue sur TOUS ses segments. null : trajet spontané, chaque
   * segment choisit comme avant.
   *
   * C'EST LE DÉFAUT QUE CE CHAMP CORRIGE. L'allure se décidait dans planWalk sur
   * la seule distance du segment courant. Un chemin d'itinéraire est fait de
   * segments COURTS (le coude d'un couloir, le tour d'une table) : chacun tombait
   * donc sous le seuil et repartait en flânerie à 0,28 m/s. Mesuré au banc
   * (couloir en L, coude à 6 m) : 10 m de chemin en 18,65 s à 0,57 m/s de
   * moyenne, contre 9,13 s à 1,10 m/s pour les mêmes 10 m en ligne droite. Le
   * chemin ne rallongeait pas le trajet : il changeait l'allure.
   */
  let routeGait: GaitPlan | null = null
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
    // La case d'approche DONNÉE PAR L'ANALYSE — praticable par construction, là
    // où le point de pré-assise peut frôler le meuble jusqu'à sortir du sol
    // connu. C'est le plan B de chaque segment de marche, pas seulement du
    // premier : dans la chambre, le couloir vers la banquette fait un coude, la
    // ligne droite vers le point théorique quitte le sol, et celle vers cette
    // case passe.
    apprX: number
    apprZ: number
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
    // GARDE D'ANGLE : sous la demi-zone morte, turnStep rendra la main à sa
    // première image — le clip posé quand même prenait ~5 % de poids UNE image
    // avant d'être remplacé (flash mécanique du seatAlign d'un personnage déjà
    // aligné, endLeg → tryGoSit). Le seuil est EXACTEMENT la condition de fin
    // immédiate de turnStep : les deux ne peuvent pas se contredire.
    // Clip absent (dossier vrma/ incomplet) : on glisse, on ne bloque pas.
    // La phase d'entrée est le contrat de raccord — cf. TURN_ENTER_*_S.
    if (Math.abs(d) >= FACE_DEADZONE * 0.5 && host.has(clip)) {
      host.gait(clip, TURN_IN, turnDir > 0 ? TURN_ENTER_LEFT_S : TURN_ENTER_RIGHT_S)
      turnClipUp = true
    }
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
   *
   * L'ALLURE VIENT DE `routeGait` QUAND IL Y EN A UN — c'est-à-dire sur un
   * trajet COMMANDÉ, où elle a été choisie une fois pour toutes sur la LONGUEUR
   * DU CHEMIN (cf. startRoute). Sans lui (déambulation spontanée), c'est la
   * règle de toujours : ce segment-ci, à vol d'oiseau.
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
    // Départ d'un endroit serré (on vient de se lever contre un meuble) : la
    // tête du chemin est en manœuvre, elle aussi au point.
    const head = host.canStand(p.x, p.z, radius) ? 0 : MANEUVER_M
    const dir = { x: dx / want, z: dz / want }
    /** Essaie UNE allure : rend true et engage le plan si elle tient sur ce segment. */
    const tenter = (g: GaitPlan): boolean => {
      if (!host.has(g.clip)) return false
      const stride = g.strideFrac * h
      const startD = g.startFrac * h
      /**
       * FRACTION DE CYCLE entre la phase d'ENTRÉE et la phase de SORTIE. La marche
       * n'est pas faite de cycles entiers : elle entre à `enterS` et sort à
       * `exitS`, et ne dépeint entre les deux que cette fraction-là du dernier
       * cycle. La compter pour un cycle plein décalait toute l'arithmétique
       * d'arrêt d'autant — et comme l'arrêt ne part QUE sur une phase de sortie,
       * le personnage dépassait sa destination de la fraction manquante puis
       * finissait le cycle : mesuré 0,84 m de trop (0,8 cycle de `world-walk`,
       * entrée 0,200 s / sortie 0,000 s) sur CHAQUE marche franche. La flânerie
       * n'en souffrait presque pas (0,133 s d'écart, 3,8 cm) — c'est ce qui a
       * caché le défaut aux premiers bancs, qui ne mesuraient la position que sur
       * elle.
       */
      // Nombre de cycles, le dernier étant PARTIEL (entrée → sortie), pour
      // approcher `want` au mieux.
      const naturel = Math.round((want - startD) / stride - cycleTail(g))
      /**
       * PLANCHER DU NOMBRE DE CYCLES. Une allure qui entre par un clip de DÉPART
       * porte déjà de la distance avant son premier cycle : `world-walk-start`
       * dépeint 0,392 hanche, et la fraction de cycle qui suit en ajoute 0,8 —
       * un trajet de 1,54 m (rig de mesure) SANS aucun cycle entier, contrat de
       * phase intact (entrée 0,200 s, sortie sur la couture). Elle peut donc
       * descendre à zéro cycle. La flânerie, elle, n'a pas de départ : sans un
       * cycle au moins, elle ne dépeint plus rien, et son plancher reste 1.
       *
       * RÉSERVÉ AUX ORDRES. Un trajet spontané garde le plancher de toujours :
       * autoriser le demi-trajet changeait les plans que la pièce raccourcit,
       * donc le tirage, donc TOUTE l'empreinte de déambulation (mesuré : 47,0 m
       * et 30,9 % d'assise au lieu de 56,1 m et 17,8 %, à graine identique).
       * La flânerie ne change pas.
       */
      const plancher = ordered && g.startFrac > 0 ? 0 : 1
      let n = Math.max(plancher, naturel)
      // On raccourcit tant que le chemin ne passe pas : mieux vaut s'arrêter avant
      // l'obstacle que de s'y cogner et de rester planté contre lui.
      for (; n >= plancher; n--) {
        const d = startD + stride * (n + cycleTail(g))
        /**
         * PROGRESSER, TOUJOURS. Quand le plancher ÉTIRE l'allure au-delà de sa
         * granularité (segment plus court qu'un de ses trajets), le plan peut
         * déposer le personnage PLUS LOIN du but qu'il n'en est déjà : l'étape
         * reste alors en tête d'itinéraire, le segment suivant repart en sens
         * inverse, et c'est la navette. Mesuré au banc avant cette garde :
         * 17,6 m parcourus et 31,9 s pour un chemin de 8 m, cinq arrêts. Le
         * plan est refusé, et l'appelant retombe sur la flânerie — dont les
         * petites foulées savent, elles, viser à 25 cm près. Comme le plancher
         * ci-dessus, la garde ne vaut que pour un ORDRE : sans le plancher à
         * zéro, le cas ne peut pas se produire sur un trajet spontané.
         */
        if (ordered && n > naturel && Math.abs(d - want) >= want) continue
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
    const voulue = routeGait ?? (want > WALK_OVER_STROLL_M ? GAIT_WALK : GAIT_STROLL)
    /**
     * LE REPLI EST LA FLÂNERIE, et il n'existe QUE quand l'allure a été IMPOSÉE
     * par la longueur du chemin (`routeGait`). La marche franche a besoin de
     * 1,54 m devant elle : un coin d'itinéraire trop serré la refuse, et sans ce
     * repli le segment échouerait — le personnage resterait planté là où, hier,
     * il flânait. Sur un trajet SPONTANÉ l'allure vient de ce segment-ci : elle
     * ne peut pas être trop grande pour lui, et un échec doit rester un échec
     * (c'est lui qui fait retirer une autre destination, cf. roam). Le repli
     * ouvert à tous changeait l'empreinte de déambulation à graine identique.
     */
    return tenter(voulue) || (routeGait !== null && voulue !== GAIT_STROLL && tenter(GAIT_STROLL))
  }

  /**
   * Prépare le segment suivant de l'itinéraire, et le retire de la liste dès
   * qu'il y arrive.
   *
   * On vise l'étape la PLUS LOINTAINE dont la ligne droite est libre : les coins
   * trop serrés pour une foulée se fondent alors dans le segment suivant, au
   * lieu d'exiger un pas de vingt centimètres que la marche ne sait pas faire.
   * Seule l'étape immédiate a le droit d'être approchée par un segment
   * raccourci (c'est le comportement de toujours devant un obstacle) — et dans
   * ce cas elle RESTE en tête de liste, pour être revisée au segment d'après.
   */
  function nextLeg(seatLeg: boolean): boolean {
    if (routeLegs <= 0) {
      route.length = 0
      return false
    }
    const radius = host.bodyRadius()
    const tail = seatLeg ? MANEUVER_M : 0
    const head = host.canStand(p.x, p.z, radius) ? 0 : MANEUVER_M
    const reach = WAYPOINT_REACH_FRAC * host.hips()
    // Les étapes déjà derrière soi ne comptent plus : le dernier pas a pu les
    // dépasser (un segment fait un nombre entier de foulées, pas la distance
    // demandée). On garde toujours la destination, elle.
    while (route.length > 1 && Math.hypot(route[0].x - p.x, route[0].z - p.z) < reach) route.shift()
    for (let i = route.length - 1; i >= 0; i--) {
      const w = route[i]
      // Sauter une étape ne se fait que par une vraie ligne de vue : sans cette
      // garde, `planWalk` accepterait un bout de chemin raccourci DANS la
      // mauvaise direction et l'on perdrait le coin qu'il fallait contourner.
      if (i > 0 && !pathClear(p.x, p.z, w.x, w.z, radius, tail, head)) continue
      if (!planWalk(w.x, w.z, seatLeg)) continue
      /**
       * L'ÉTAPE EST ATTEINTE À LA PRÉCISION DE LA FOULÉE, PAS MIEUX. Une allure
       * se pose par pas entiers : lui redemander de revenir sur un reliquat plus
       * court qu'un demi-pas ne fait pas gagner de précision, ça coûte un segment
       * de plus — et si le reliquat est DERRIÈRE, un demi-tour complet. Mesuré au
       * banc (couloir en L, chemin de 10 m) : 37 cm de dépassement déclenchaient
       * un pivot de 173° et un dernier segment, soit 5,4 s pour 37 cm — un tiers
       * du trajet. La tolérance suit donc la foulée de l'allure employée, sans
       * jamais descendre sous celle d'avant.
       */
      const atteint = Math.max(reach, (plan.strideFrac / 2) * host.hips())
      route.splice(0, Math.hypot(destX - w.x, destZ - w.z) < atteint ? i + 1 : i)
      routeLegs--
      return true
    }
    route.length = 0
    return false
  }

  /**
   * Ouvre un trajet vers (x, z) et prépare son premier segment. Rend false sans
   * rien engager s'il n'ouvre pas.
   *
   * LA LIGNE DROITE D'ABORD, et c'est LE point de ce chantier : si la vue porte
   * jusqu'à la destination, on plane un segment unique et rien d'autre — pas de
   * recherche, pas d'étapes, pas de reprise. Un trajet dégagé se comporte donc
   * exactement comme avant, au centimètre et à l'image près : c'est le même
   * `planWalk` appelé au même moment avec les mêmes arguments. La recherche de
   * chemin n'existe que pour ce qui, hier, n'aboutissait pas.
   *
   * Même chose quand aucun chemin n'existe (destination murée, hors carte) : on
   * retombe sur le segment droit, que le moteur raccourcira devant l'obstacle —
   * c'est-à-dire qu'il fera ce qu'il faisait déjà.
   *
   * `maxLen` borne la LONGUEUR DU CHEMIN (pas la distance à vol d'oiseau) : la
   * déambulation s'en sert pour refuser les détours qui changeraient sa flânerie
   * en traversée de pièce.
   *
   * `commit` : n'engager le trajet que s'il MÈNE QUELQUE PART. Sans ligne de vue
   * ni chemin, le segment droit est raccourci devant l'obstacle — pour un but
   * qui n'est pas une destination en soi (une assise), s'arrêter au milieu de la
   * pièce n'est pas un demi-succès, c'est une marche pour rien. On exige alors
   * que le segment dépose le personnage DANS LA ZONE DE MANŒUVRE de son but,
   * seule longueur sur laquelle les derniers centimètres savent encore mordre.
   */
  function startRoute(
    x: number,
    z: number,
    seatLeg = false,
    maxLen = Infinity,
    commit = false,
  ): boolean {
    route.length = 0
    routeLegs = 0
    routeGait = null
    const radius = host.bodyRadius()
    const tail = seatLeg ? MANEUVER_M : 0
    const head = host.canStand(p.x, p.z, radius) ? 0 : MANEUVER_M
    const straight = pathClear(p.x, p.z, x, z, radius, tail, head)
    const pts = straight ? null : host.path(p.x, p.z, x, z, radius)
    /**
     * LA BANDE D'ALLURE D'UN ORDRE, sur la longueur du CHEMIN.
     *
     * Deux bandes, et deux seulement. La borne n'est pas un goût : c'est le plus
     * court trajet que la marche franche sache dépeindre (`shortestTrip`,
     * 1,54 m sur le rig de mesure, à l'échelle du modèle partout ailleurs).
     * En dessous, elle ne peut pas servir — elle dépasserait le but. Au-dessus,
     * la flânerie devient une punition : 0,28 m/s mesurés, soit 36 s pour
     * traverser une pièce de 10 m. La troisième bande — courir — n'a pas de clip
     * pour la tenir : voir le bloc « COURIR : MESURÉ, ET REFUSÉ » en tête de
     * fichier.
     *
     * La borne d'un ORDRE est donc plus basse que celle de la flânerie
     * (WALK_OVER_STROLL_M, 2,6 m) : un ordre demande d'ALLER quelque part, et se
     * poser 40 cm avant le point cliqué vaut mieux que d'y traîner cinq
     * secondes. La déambulation spontanée, elle, garde sa règle telle quelle.
     */
    const bande = (chemin: number): GaitPlan =>
      chemin > shortestTrip(GAIT_WALK) * host.hips() && host.has(GAIT_WALK.clip) ? GAIT_WALK : GAIT_STROLL
    if (!pts) {
      const len = Math.hypot(x - p.x, z - p.z)
      if (len > maxLen) return false
      if (ordered) routeGait = bande(len)
      if (!planWalk(x, z, seatLeg)) return false
      return !commit || straight || Math.hypot(destX - x, destZ - z) <= MANEUVER_M
    }
    let len = 0
    let cx = p.x
    let cz = p.z
    for (const w of pts) {
      len += Math.hypot(w.x - cx, w.z - cz)
      cx = w.x
      cz = w.z
    }
    if (len > maxLen) return false
    if (ordered) routeGait = bande(len)
    route = pts
    routeLegs = Math.min(pts.length + ROUTE_SPARE_LEGS, ROUTE_MAX_LEGS)
    if (nextLeg(seatLeg)) return true
    route.length = 0
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
    // TROIS entrées différentes, trois fondus différents (cf. fades.ts) :
    // - depuis un pivot (état 'align'), la jonction part de 19 cm : fondu de
    //   SORTIE de pivot, long et adouci ;
    // - depuis l'idle vers le clip de DÉPART, la jonction est excellente
    //   (2,0 cm) et le lever de pied doit rester sec : le fondu court et
    //   linéaire d'Overte (`idleToWalkFwd`) ;
    // - depuis l'idle DIRECTEMENT dans un cycle (la flânerie), c'est l'entrée
    //   de cycle d'Overte (`WALKFWD`), linéaire elle aussi.
    const viaStart = plan.start !== null && host.has(plan.start)
    const fade = turnClipUp ? TURN_OUT : viaStart ? WALK_START_IN : WALK_CYCLE_IN
    turnClipUp = false
    if (plan.start && viaStart) {
      // Départ : la dernière image de `world-walk-start` EST la pose du cycle à
      // t = 0,200 s. On l'y enchaîne donc SANS fondu et à cette phase exacte —
      // c'est le contrat mesuré à 0 cm.
      host.once(plan.start, fade, plan.clip, NO_FADE, plan.enterS)
      state = 'starting'
      return
    }
    host.gait(plan.clip, fade, plan.enterS)
    state = 'walking'
  }

  /**
   * Déclenche l'arrêt : le clip d'arrêt, puis le retour au socle.
   *
   * AUX ÉTAPES (il reste un itinéraire, ou un trajet d'assise suit), l'arrêt
   * est le COURT — `world-walk-stop-small`, 1,27 s — et pas le tirage parmi
   * les longs (1,27 à 2,70 s, dont 2,70 une fois sur quatre) : un coin
   * d'itinéraire coûtait 3 à 5 s planté (arrêt + pivot + départ), l'arrêt
   * court en rend ~0,7 s en moyenne et retire l'aléa du pire tirage. Le
   * raccord ne change pas : les cinq arrêts partagent le contrat d'entrée
   * (walk@0 → 0,0 cm ×5) et la même pose de fin (→ idle pire 3,0 cm,
   * moy 1,3 — mesuré sur le petit comme sur les quatre autres). À l'ARRIVÉE,
   * le tirage long demeure : s'installer est le moment de prendre son temps.
   *
   * `world-walk-stop-small` a sa propre clé de catalogue (un suffixe non
   * numérique survit au regroupement des variantes), mais il faut encore que
   * WORLD_NEEDED (vrmStage) le télécharge : tant que ce n'est pas fait,
   * has() rend false et ce choix retombe exactement sur l'arrêt d'avant.
   */
  function beginStop(): void {
    wantStop = false
    const midStop = route.length > 0 || seatRun !== null
    const small = midStop && host.has('walk-stop-small')
    const stop = small ? 'walk-stop-small' : 'walk-stop'
    if (host.has(stop)) {
      // Overte fait EXACTEMENT la même distinction que ce choix de clip :
      // `idleSettleSmall` a un fondu d'entrée plus court que `idleSettle`.
      host.once(stop, small ? STOP_SMALL_IN : STOP_IN, null, STOP_OUT)
      state = 'stopping'
      return
    }
    host.gait(null, STOP_IN)
    endLeg()
  }

  /**
   * Fin d'un segment de marche — LA COUTURE ENTRE DEUX SEGMENTS. Il reste des
   * étapes : on repart, avec les mêmes règles que le premier segment (pivot si
   * le cap change franchement, entrée dans le cycle à sa phase, sortie sur la
   * couture). Sans trajet d'assise et sans étape : repos. Avec : on enchaîne si
   * le point de pré-assise est à portée, on remarche s'il reste des segments, et
   * sinon on abandonne EN SILENCE — une assise devenue inaccessible n'est pas
   * une panne, le personnage reste simplement debout où il est.
   */
  function endLeg(): void {
    if (!seatRun) {
      if (route.length > 0 && nextLeg(false)) {
        beginWalk()
        return
      }
      state = 'rest'
      return
    }
    // Arriver PRIME sur l'itinéraire : quand la dernière étape tombe déjà dans
    // la zone de pré-assise, un segment de plus ne ferait que piétiner.
    const near = Math.hypot(seatRun.standX - p.x, seatRun.standZ - p.z)
    if (near <= Math.max(SEAT_NEAR_FRAC * host.hips(), 0.45)) {
      startPivot(seatRun.yaw, 'seatAlign')
      return
    }
    if (route.length > 0 && nextLeg(true)) {
      beginWalk()
      return
    }
    // L'itinéraire épuisé, restent les derniers centimètres : le point de
    // pré-assise d'abord, la case d'approche de l'analyse ensuite — le MÊME
    // repli que tryGoSit, et pour la même raison : le point théorique frôle le
    // meuble, il peut être hors sol connu, la case d'approche jamais.
    if (
      seatRun.legsLeft > 0 &&
      (planWalk(seatRun.standX, seatRun.standZ, true) || planWalk(seatRun.apprX, seatRun.apprZ, true))
    ) {
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
    const back = SIT_BACKUP_FRAC * h
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
      // GLISSEMENT LE LONG DU BORD. Le milieu du bord n'est pas toujours
      // servi par du sol : le pied du lit de la chambre affleure le bord de la
      // zone praticable, et son point de pré-assise central tombe dans le vide
      // de la carte — l'assise était déclarée approchable par l'analyse et
      // restait imprenable par le moteur. On décale alors le point d'assise le
      // long du MÊME bord, vers la case d'approche (qui est praticable par
      // construction), jusqu'à ce que le point de pré-assise retrouve du sol.
      // On s'assoit au coin du lit qui donne sur la chambre — comme un corps.
      if (host.floorAt(sitX + fx * back, sitZ + fz * back) === null) {
        const px = fz // perpendiculaire au regard : l'axe du bord
        const pz = -fx
        const pHalf = Math.max((Math.abs(px) * (x1 - x0) + Math.abs(pz) * (z1 - z0)) / 2 - SEAT_INSET_FRAC * h, 0)
        const off = clamp((seat.approach[0] - bx) * px + (seat.approach[1] - bz) * pz, -pHalf, pHalf)
        for (const t of [off / 2, off]) {
          if (host.floorAt(sitX + px * t + fx * back, sitZ + pz * t + fz * back) !== null) {
            sitX += px * t
            sitZ += pz * t
            break
          }
        }
      }
    }
    let standX = sitX + fx * back
    let standZ = sitZ + fz * back
    // TIRER LE POINT DE PRÉ-ASSISE VERS LA CASE D'APPROCHE JUSQU'À TROUVER DU
    // SOL. Le glissement le long du bord, juste au-dessus, ne décale le point
    // que dans la nappe du meuble (3,4 cm sur une chaise de 40 cm) : il ne sort
    // pas de son empreinte, et 40 des 66 assises des trois décors gardaient un
    // point de pré-assise SANS SOL SOUS LUI (36/55 en classe, 1/6 au loft,
    // 3/5 en chambre). L'ancien repli `?? floorAt(approche)` les laissait
    // passer en empruntant l'altitude d'AILLEURS : tout l'aval — l'itinéraire,
    // le seuil de proximité d'endLeg, les segments de repli — visait alors du
    // vide, et le personnage marchait pour rien avant de rester planté debout.
    // Ici on déplace un point au lieu de mentir sur son altitude : la case
    // d'approche a du sol par construction, et le pas est court pour s'arrêter
    // au premier appui. Le recul est BORNÉ À LA ZONE DE MANŒUVRE — au-delà, le
    // glissement dépeint pendant world-sit-enter deviendrait du patinage
    // (mesuré : jusqu'à 1,885 m sans borne, contre 0,640 m avant correction).
    if (host.floorAt(standX, standZ) === null) {
      const dx = seat.approach[0] - standX
      const dz = seat.approach[1] - standZ
      const d = Math.hypot(dx, dz)
      if (d > 1e-6) {
        const dMax = Math.min(d, MANEUVER_M)
        const n = Math.max(1, Math.ceil(dMax / SEAT_PULL_STEP))
        for (let i = 1; i <= n; i++) {
          const t = ((i / n) * dMax) / d
          if (host.floorAt(standX + dx * t, standZ + dz * t) !== null) {
            standX += dx * t
            standZ += dz * t
            break
          }
        }
      }
    }
    // Le sol sous les pieds une fois assis, sous le point de pré-assise lui-même
    // (les pieds y restent) — jamais emprunté ailleurs, jamais inventé.
    const groundY = host.floorAt(standX, standZ)
    if (groundY === null) return null
    return {
      sitX,
      sitZ,
      standX,
      standZ,
      apprX: seat.approach[0],
      apprZ: seat.approach[1],
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
    routeGait = null // l'allure d'un trajet précédent n'a rien à faire ici
    const run = planSeat(seat)
    if (!run) return false
    // DÉJÀ à portée du point de pré-assise — on est venu par ses propres clics,
    // ou on se tient simplement devant le meuble : pas un pas de plus, pivot et
    // assise. Exiger une marche ici refusait l'assise à qui était déjà devant
    // (planWalk refuse tout trajet de moins de 5 cm) : cliquer la banquette en
    // étant à 2 cm de sa case d'approche ne faisait RIEN.
    if (Math.hypot(run.standX - p.x, run.standZ - p.z) <= Math.max(SEAT_NEAR_FRAC * host.hips(), 0.45)) {
      seatRun = run
      startPivot(run.yaw, 'seatAlign')
      return true
    }
    // Sinon, un itinéraire vers le point de pré-assise ; s'il est injoignable,
    // vers la case d'approche donnée par l'analyse (les segments suivants
    // s'occuperont du reste, cf. endLeg — même repli). L'itinéraire dégénère en
    // ligne droite dès que la vue porte : les assises déjà prenables le restent
    // par le chemin exact d'avant.
    // `commit` : on n'engage pas une marche d'assise qui ne mène nulle part.
    const walkable =
      startRoute(run.standX, run.standZ, true, Infinity, true) ||
      startRoute(run.apprX, run.apprZ, true, Infinity, true)
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
    // On arrive de seatAlign : si le pivot a joué, sa sortie veut le fondu
    // long (150–160 cm/s à 0,3 s, 111–143 à 0,5 — cf. TURN_OUT).
    const fadeIn = turnClipUp ? TURN_OUT : SIT_IN
    turnClipUp = false
    // Le socle assis est TIRÉ parmi cinq variantes (pickAction) : l'atterrissage
    // se fait donc en fondu d'une seconde, pas en claquant — cf. SIT_LAND.
    // La phase 0 reste le contrat : c'est là que chaque variante est le plus
    // près de la fin de sit-enter (mesuré ×5).
    host.once('sit-enter', fadeIn, 'sit-idle', SIT_LAND, 0)
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
    host.once('sit-exit', SIT_IN, null, STOP_OUT)
    state = 'sitUp'
  }

  /**
   * Dernière clef jouée PAR RÔLE (une émotion, ou le clic) — l'anti-répétition.
   * Par rôle et non globale, pour la raison de `lastGesture` (vrmStage) : `happy`
   * puis `sad` puis `happy` ne doit pas pouvoir rejouer le même applaudissement,
   * alors qu'une mémoire unique aurait été effacée par le `sad` intercalé.
   */
  const lastSeatClip = new Map<string, string>()

  /**
   * Une clef de la table, tirée parmi celles RÉELLEMENT chargées, en écartant
   * celle qui vient d'être jouée pour ce rôle tant qu'il en reste une autre.
   * C'est la règle de `pickAction` (vrmStage, cf. 23cde13) appliquée un cran
   * au-dessus : ici on tire le CLIP, `worldAction` tirera ensuite le fichier
   * parmi les variantes numérotées de ce clip.
   */
  function pickSeatClip(role: string, pool: readonly string[]): string | null {
    const ready = pool.filter((name) => host.has(name))
    if (ready.length === 0) return null
    const last = lastSeatClip.get(role)
    const draw = ready.length > 1 ? ready.filter((name) => name !== last) : ready
    const clip = draw[Math.floor(Math.random() * draw.length)]
    lastSeatClip.set(role, clip)
    return clip
  }

  /**
   * UN GESTE PAR-DESSUS LE SOCLE ASSIS — la même porte que les gestes d'assise
   * (sit-look, sit-shift, cf. l'état 'seated') : `host.once` promeut le clip en
   * transition, ce qui retire le socle des jambes le temps du cycle et le rend
   * ensuite. C'est le SEUL canal qui sache poser un clip sur un corps assis
   * sans que la machine d'état perde le fil.
   *
   * Les refus, dans l'ordre :
   * - pas assis POUR DE BON (marche, pivot, sit-enter/sit-exit) : un geste à
   *   poids 1 sur tout le squelette casserait les jambes ou le glissement ;
   * - un geste assis déjà à l'écran : on JETTE, on n'empile pas — il n'y a pas
   *   de file d'attente debout non plus, et un geste retardé de trois secondes
   *   ne répond plus à rien ;
   * - aucun fichier chargé pour ce rôle : le visage suffit, comme debout.
   */
  function seatGesture(role: string, pool: readonly string[]): boolean {
    if (state !== 'seated' || host.transitioning()) return false
    const clip = pickSeatClip(role, pool)
    if (!clip) return false
    // LE RETOUR SE FAIT SUR `sit-idle`, JAMAIS SUR LE SOCLE DE PAROLE, et c'est
    // mesuré : le pire os parcourt 7,0 à 9,9 cm pendant un fondu de sortie vers
    // world-sit-talking (la limite du projet est à 10) contre 0,6 à 6,6 cm vers
    // world-sit-idle — les mains de la parole sont loin du maintien assis. Si
    // une réponse est en cours, l'état 'seated' rebascule sur sit-talking à
    // l'image suivante, avec SON fondu à lui (SIT_TALK), celui qui a été
    // mesuré pour cette jonction-là.
    // Le livre des socles doit donc l'apprendre ici, sinon une parole en cours
    // croirait sit-talking encore en place et ne le reposerait jamais.
    seatBase = 'sit-idle'
    host.once(clip, SIT_GESTURE_IN, 'sit-idle', SIT_GESTURE_OUT)
    // Le geste TIENT LIEU de geste d'assise : enchaîner un sit-look juste
    // derrière lirait comme de l'agitation, pas comme une réponse.
    fidgetT = rand(FIDGET_MIN_S, FIDGET_MAX_S)
    return true
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
    // FLÂNERIE, PAS ORDRE. Tout ce qui suit garde la règle d'allure d'avant :
    // chaque segment se juge à vol d'oiseau, et le personnage ne se met jamais
    // à traverser la pièce d'un pas décidé parce que le chemin fait un détour.
    ordered = false
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
    // Le retour à l'accueil et les points tirés autour de soi passent par la
    // MÊME porte que les clics — mais avec un plafond de détour : le tirage ne
    // change pas (0,8 à 4 hanches), donc la pondération non plus.
    const home = Math.hypot(p.x, p.z)
    if (Math.random() < HOME_ODDS && home > 0.3 && startRoute(0, 0, false, home * ROAM_DETOUR_MAX)) {
      beginWalk()
      return
    }
    for (let i = 0; i < ROAM_TRIES; i++) {
      const a = Math.random() * Math.PI * 2
      const d = rand(ROAM_MIN_FRAC, ROAM_MAX_FRAC) * h
      if (startRoute(p.x + Math.sin(a) * d, p.z + Math.cos(a) * d, false, d * ROAM_DETOUR_MAX)) {
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
        // Le sol RÉEL sous le point de repos. Les trois décors livrés affleurent
        // à y ≈ 0 par calage du sidecar, mais un décor importé SANS préparation
        // n'a aucune raison de tomber juste : sa boîte englobante est calée au
        // sol par le bas de sa dalle, et la surface de marche est l'épaisseur de
        // la dalle PLUS HAUT. Sans ce recalage, le personnage attendrait enfoncé
        // dans le plancher jusqu'à son premier pas (advance() corrige, mais
        // seulement en marchant). Coût : une lecture de tableau par image.
        const floor = host.floorAt(p.x, p.z)
        if (floor !== null) {
          p.ground = floor
          p.y = floor
        }
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
          host.gait(null, TURN_OUT)
          turnClipUp = false
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
          host.gait(null, TURN_OUT)
          turnClipUp = false
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
          host.gait(want, SIT_TALK)
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
          // La fin du geste rend l'écran à sit-idle (son `then`) : le livre des
          // socles doit le savoir, sinon une parole en cours de geste croirait
          // sit-talking encore en place. Le socle est vérifié AVANT le tirage —
          // un tirage sans geste joué fausserait la mémoire du rôle.
          if (seatBase === 'sit-idle') {
            const gesture = pickSeatClip(SIT_ROLE_FIDGET, SIT_FIDGETS)
            if (gesture) host.once(gesture, SIT_GESTURE_IN, 'sit-idle', SIT_GESTURE_OUT)
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
            // Elle vient d'un goTo : c'est un ORDRE, même différé par l'assise.
            ordered = true
            if (startRoute(dest.x, dest.z)) beginWalk()
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
      // Le PIVOT face caméra n'est pas une occupation : il suit chaque arrivée,
      // et refuser les clics pendant ses deux ou trois secondes rendait le
      // « cliquer pour y aller » sourd une fois sur deux. beginWalk pose son
      // propre pivot d'alignement par-dessus, les états s'enchaînent déjà.
      if (state !== 'rest' && state !== 'pivot') return false
      // ORDRE : l'allure se choisira sur la longueur du CHEMIN, pas sur celle
      // du premier segment (cf. routeGait).
      ordered = true
      if (!startRoute(x, z)) return false
      beginWalk()
      return true
    },
    goSit(seat): boolean {
      if (state !== 'rest' && state !== 'pivot') return false
      ordered = true
      return tryGoSit(seat)
    },
    poke(): void {
      if (state === 'rest' || state === 'pivot') attentiveUntil = now + ATTENTIVE_S
    },
    emote: (emotion) => seatGesture(emotion, SIT_EMOTES[emotion]),
    react: () => seatGesture(SIT_ROLE_CLICK, SIT_REACTIONS),
    /**
     * Retour au point d'accueil. Les clips en place sont rendus au socle avec ce
     * `fade` (l'extinction de la scène vivante en veut un long, un changement de
     * décor un bref) et la transition en vol est coupée — un changement de décor
     * peut tomber au milieu d'une assise, le personnage ne doit pas rester
     * assis dans le vide de la pièce suivante.
     */
    home(fade: Fade = HOME_OUT): void {
      p.x = 0
      p.y = 0
      p.z = 0
      p.yaw = 0
      p.ground = 0
      state = 'rest'
      wantStop = false
      walked = 0
      turnClipUp = false
      seatRun = null
      slide = null
      afterStand = null
      route.length = 0
      routeLegs = 0
      routeGait = null
      ordered = false
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
