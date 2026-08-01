// Scène 3D de l'avatar VRM — implémente le contrat VrmStage (./types).
// three + @pixiv/three-vrm ; l'UI importe createVrmStage dynamiquement.
import {
  AnimationMixer,
  Box3,
  Clock,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshBasicMaterial,
  MOUSE,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  SRGBColorSpace,
  TOUCH,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { AnimationAction, AnimationClip, Color, Intersection, Material } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import {
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
  createVRMAnimationClip,
} from '@pixiv/three-vrm-animation'
import type { VRMAnimation } from '@pixiv/three-vrm-animation'
import { EMOTIONS } from '../../../shared/types'
import type { AnimationFamily, Emotion } from '../../../shared/types'
import { getVrmAnimations } from '../api'
// Les erreurs de cette scène remontent TELLES QUELLES à l'écran (bandeaux de
// App.tsx) : elles se traduisent, comme celles de la couche API.
import { translate } from '../i18n'
import type { EnvNotice, FrameMode, StageView, VrmStage } from './types'
import { IdleAnimator } from './idle'
import type { PosedBone } from './idle'
import { normalizeEmotion, resolveExpressions } from './emotionMap'
import { createWander } from './wander'
import type { Wander, WanderHost } from './wander'
import { createLegIk } from './legIk'
import type { FootMode, LegIk } from './legIk'
import { createJointLimits } from './jointLimits'
import type { JointLimits } from './jointLimits'
import { CriticallyDampedSpringPoseHelper } from './overteMath'
import { buildEnvBvh, raycastFirst } from './bvh'
import type { EnvBvh } from './bvh'
import { createGaze } from './gaze'
import { applyRelaxedHands } from './handPoses'
import { BASE_SWAP, fadeCurve, GESTURE_IN, GESTURE_OUT, NO_FADE } from './fades'
import type { Fade } from './fades'
import { fetchSceneMap, placementTrouble } from './sceneMap'
import type { SceneMap, Seat } from './sceneMap'
import { mergeEnvironment } from './envMerge'
import { createClickMarks } from './clickMark'

// Pose de repos (anti T-pose : les VRM chargent bras en croix) — rotation Z par os.
const REST_POSE_Z: ReadonlyArray<readonly [VRMHumanBoneName, number]> = [
  ['leftUpperArm', 1.25],
  ['rightUpperArm', -1.25],
  ['leftLowerArm', 0.12],
  ['rightLowerArm', -0.12],
]

// Cadrage 'left' : le panneau de chat occupe une colonne à DROITE de l'écran
// (420 px par défaut, à partir de 900 px de large — cf. styles.css, et la
// poignée de redimensionnement qui pose setPanelWidth). Pour que l'avatar tombe
// au centre de la bande restée visible, il faut le déplacer vers la gauche d'une
// fraction de cette colonne. Sous ce seuil le panneau est une feuille BASSE :
// la scène occupe toute la largeur, aucun décalage n'aurait de sens.
const CHAT_PANEL_DEFAULT_W = 420
const CHAT_PANEL_MIN_W = 900

// Décor : bornes de plausibilité de la hauteur d'une pièce, et hauteur visée
// quand elle est absurde (même doctrine que normalizeScale — on ne corrige que
// l'absurde, jamais le goût de l'auteur).
const ENV_MIN_HEIGHT = 1.5
const ENV_MAX_HEIGHT = 12
const ENV_TARGET_HEIGHT = 2.6

// Éclairage : deux régimes. Sans décor, les valeurs historiques (l'avatar est
// seul dans le vide, il lui faut beaucoup de lumière). Avec décor, on baisse —
// une pièce renvoie déjà de la lumière, et un avatar surexposé « décollerait »
// du fond. La key light reste : MToon a besoin d'une direction.
const KEY_LIGHT_SOLO = 2.2
const FILL_LIGHT_SOLO = 0.6
const KEY_LIGHT_ENV = 1.1
const FILL_LIGHT_ENV = 0.35

// Exposition d'un décor : bornes de plausibilité du multiplicateur du sidecar.
// Même doctrine que le reste du fichier — on ne refuse que l'absurde, et une
// valeur hors bornes est OMISE, donc repli sur 1 (décor intact).
const ENV_MIN_EXPOSURE = 0.1
const ENV_MAX_EXPOSURE = 4

// Recul de la caméra dans un décor CARTOGRAPHIÉ : la rose de dégagement borne le
// zoom arrière (cf. envPullback). Marge au-delà de la clairance mesurée — la rose
// s'arrête à la première cellule occupée, ~une résolution de grille AVANT la
// surface du mur — et secteurs retenus : ±45° autour de +Z, l'axe de recul
// (16 directions, 0 = +Z, pas de 22,5°). L'éventail plutôt que le seul cap +Z :
// la rose est mesurée depuis le point d'accueil, pas depuis où le personnage
// (scène vivante) ni la caméra (orbite) se trouvent à cet instant.
const CAM_WALL_MARGIN = 0.3
const CAM_ROSE_FRONT = [14, 15, 0, 1, 2] as const

// Marge laissée devant le premier obstacle par la SONDE DE CADRAGE
// (cf. reculDegage) : l'objectif se pose à `obstacle − marge`, jamais dessus.
// 0,30 m, comme CAM_WALL_MARGIN, mais ce n'est PAS la même grandeur et les deux
// ne doivent pas fusionner : celle-là compense la résolution de la grille de la
// rose (une mesure au pas de cellule), celle-ci est un recul physique — assez
// pour que l'obstacle reste DERRIÈRE le plan de l'objectif, et non dans le cadre.
const CAM_PROBE_MARGIN = 0.3
// Rayon de la BULLE de l'objectif. Un objectif n'est pas un point : sonder le
// dégagement par un rayon unique est un tirage à pile ou face dès qu'une
// surface affleure la hauteur d'œil, et c'est exactement le cas mesuré —
// lowpoly-restaurant, dossiers de chaise à 1,030 m, objectif d'un personnage de
// 1,39 m à 1,033 m : le rayon d'axe passait 3 MILLIMÈTRES au-dessus et
// déclarait la voie libre sur 11 m, pendant que la moitié basse du cadre était
// bouchée par un dossier à 35 cm de la lentille.
// La valeur se lit dans la mesure (devtools/banc-cadrage.mjs --rayons=…) : sur
// les 7 décors × 2 rigs, TOUT est inchangé jusqu'à 0,20 m inclus, sauf le cas
// fautif qui bascule dès 0,02 m. 0,12 m est au milieu de cet intervalle — six
// fois la marge du côté où il faut voir, presque le double du côté où il ne
// faut rien changer.
const CAM_PROBE_RADIUS = 0.12
// La bulle, échantillonnée : l'axe, puis quatre jantes (bas, haut, gauche,
// droite) en fractions du rayon. Cinq rayons contre un cylindre balayé exact —
// cinq requêtes à 0,004 ms, une fois par cadrage, jamais dans le tick.
const CAM_PROBE_RIM = [
  [0, 0],
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
] as const

// Caméra de CONSTRUCTION : la pose de départ, avant tout cadrage. Deux
// constantes de module parce qu'elles servent à DEUX endroits — la création de
// la scène et le repli de resetView, quand aucun modèle n'est cadré — et que
// les laisser diverger rendrait le bouton de réinitialisation menteur.
const CAM_HOME_POS = [0, 1.35, 1.8] as const
const CAM_HOME_TARGET = [0, 1.25, 0] as const

const DEG2RAD = Math.PI / 180

/**
 * Placement d'un décor, lu dans le sidecar `<décor>.json` posé à côté du .glb.
 * Toutes les clés sont optionnelles : le fichier n'existe pas dans le cas
 * général, et ce qui manque garde le comportement automatique.
 */
interface EnvPlacement {
  scale?: number // échelle explicite — DÉSACTIVE l'ajustement automatique
  rotationY?: number // degrés autour de la verticale
  spawn?: [number, number, number] // point du décor où poser le personnage (mètres, y depuis le sol)
  exposure?: number // multiplicateur de luminosité des MATÉRIAUX du décor (cf. applyEnvMaterials)
  frameDistance?: number // distance du cadrage par défaut (m) voulue par CE décor (cf. frameCamera)
  /**
   * Réparations par NOM de matériau glTF. Forme courte `[r, g, b]` = albédo de
   * remplacement, composantes LINÉAIRES 0..1 (la convention de baseColorFactor,
   * pas du sRGB) ; forme longue `{ color?, transmission? }`.
   * C'est le remède au cas « asset abîmé », deux fois mesuré :
   * - rustic-bedroom a perdu ses textures à l'export Sketchfab et ses sols sont
   *   un baseColorFactor quasi noir (0,024 de luminance) qu'aucune exposition ne
   *   peut rattraper — à la borne 4, le sol n'atteint que 0,096 pendant que le
   *   lit texturé brûle à 0,98. `color` REMPLACE l'albédo (ce n'est pas un
   *   gain) ; l'exposition s'applique ensuite par-dessus, comme partout.
   * - cozy-loft-room porte KHR_materials_transmission sur TROIS BOCAUX
   *   décoratifs : three re-rend alors toute la scène opaque dans une passe
   *   dédiée, à chaque image — mesuré, +112 appels de dessin et +0,8 ms de
   *   rendu CPU pour l'effet de réfraction de 2 % du cadre. `transmission: 0`
   *   rend les bocaux à leur simple verre teinté (l'alpha BLEND reste).
   * Nom inconnu du décor : sans effet.
   */
  materials?: Record<string, EnvMaterialRepair>
  /**
   * Panneaux de fond posés DERRIÈRE les ouvertures du décor (fenêtre sans
   * vitrage, fente de mur) : sans eux, le fond de page de l'appli se voit au
   * travers — 20,3 % du cadre par défaut du loft. Chaque panneau est un quad
   * unlit de la couleur donnée (linéaire 0..1), décrit dans le REPÈRE BRUT du
   * .glb — celui des outils d'inspection de l'asset — parce qu'il appartient au
   * décor : changer ensuite l'échelle ou la rotation du sidecar le suit sans
   * retouche, ce qu'un repère « scène » ne permettrait pas. `yawY` en degrés
   * autour de la verticale, 0 = le quad regarde +Z du décor.
   */
  backdrop?: EnvBackdrop[]
}

/** Une réparation de matériau (cf. EnvPlacement.materials). */
interface EnvMaterialRepair {
  color?: [number, number, number]
  transmission?: number
}

/** Un panneau de fond (cf. EnvPlacement.backdrop). */
interface EnvBackdrop {
  color: [number, number, number]
  center: [number, number, number]
  size: [number, number]
  yawY?: number
}

/** Nombre maximal de panneaux de fond lus — au-delà, c'est un autre outil qu'il faut. */
const ENV_MAX_BACKDROPS = 8

/** Nombre fini dans des bornes larges — on ne refuse que l'absurde. */
function asNumberIn(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value >= min && value <= max ? value : undefined
}

/**
 * Sidecar quelconque → placement propre, dans l'esprit de shared/uiPrefs :
 * une valeur invalide est OMISE (repli sur l'automatique) et une clé inconnue est
 * ignorée en silence. C'est ce qui laissera la partie 3 ajouter des clés
 * (collisions, ancrages) sans casser les décors d'aujourd'hui.
 */
function parsePlacement(raw: unknown): EnvPlacement {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  const out: EnvPlacement = {}
  const scale = asNumberIn(o.scale, 0.01, 100)
  if (scale !== undefined) out.scale = scale
  const rotationY = asNumberIn(o.rotationY, -3600, 3600)
  if (rotationY !== undefined) out.rotationY = rotationY
  const exposure = asNumberIn(o.exposure, ENV_MIN_EXPOSURE, ENV_MAX_EXPOSURE)
  if (exposure !== undefined) out.exposure = exposure
  // Bornes larges : plus près que 0,5 m on est dans le visage, au-delà de 8 m
  // c'est un panorama, pas un cadrage de personnage. Hors bornes : OMISE,
  // repli sur la distance automatique — jamais une erreur.
  const frameDistance = asNumberIn(o.frameDistance, 0.5, 8)
  if (frameDistance !== undefined) out.frameDistance = frameDistance
  // Réparations de matériaux : validées ENTRÉE PAR ENTRÉE, comme les assises de
  // la carte — une valeur abîmée est jetée, les autres réparent quand même. Un
  // albédo vit dans [0, 1] par nature (une surface ne renvoie pas plus qu'elle
  // ne reçoit), une transmission aussi : ce sont les bornes, pas un goût.
  if (o.materials && typeof o.materials === 'object' && !Array.isArray(o.materials)) {
    const materials: Record<string, EnvMaterialRepair> = {}
    let any = false
    for (const [name, value] of Object.entries(o.materials as Record<string, unknown>)) {
      const repair: EnvMaterialRepair = {}
      const long =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null
      const colorRaw = Array.isArray(value) ? value : long?.color
      if (Array.isArray(colorRaw) && colorRaw.length === 3) {
        const c = colorRaw.map((v) => asNumberIn(v, 0, 1))
        if (c.every((v): v is number => v !== undefined)) repair.color = [c[0], c[1], c[2]]
      }
      const transmission = long ? asNumberIn(long.transmission, 0, 1) : undefined
      if (transmission !== undefined) repair.transmission = transmission
      if (repair.color === undefined && repair.transmission === undefined) continue
      materials[name] = repair
      any = true
    }
    if (any) out.materials = materials
  }
  if (Array.isArray(o.spawn) && o.spawn.length === 3) {
    const t = o.spawn.map((n) => asNumberIn(n, -1000, 1000))
    if (t.every((n): n is number => n !== undefined)) out.spawn = [t[0], t[1], t[2]]
  }
  // Panneaux de fond : un objet seul est accepté comme liste d'un élément, et
  // chaque entrée est validée SÉPARÉMENT — une entrée abîmée est jetée, les
  // autres bouchent quand même leur trou. Les bornes sont celles du repère brut
  // d'un asset (un décor exporté en millimètres a des coordonnées à 5 chiffres).
  const rawBackdrops = Array.isArray(o.backdrop) ? o.backdrop : o.backdrop ? [o.backdrop] : []
  const backdrops: EnvBackdrop[] = []
  for (const entry of rawBackdrops.slice(0, ENV_MAX_BACKDROPS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const b = entry as Record<string, unknown>
    const color =
      Array.isArray(b.color) && b.color.length === 3 ? b.color.map((v) => asNumberIn(v, 0, 1)) : []
    const center =
      Array.isArray(b.center) && b.center.length === 3
        ? b.center.map((v) => asNumberIn(v, -100000, 100000))
        : []
    const size =
      Array.isArray(b.size) && b.size.length === 2
        ? b.size.map((v) => asNumberIn(v, 0.001, 100000))
        : []
    if (color.length !== 3 || !color.every((v): v is number => v !== undefined)) continue
    if (center.length !== 3 || !center.every((v): v is number => v !== undefined)) continue
    if (size.length !== 2 || !size.every((v): v is number => v !== undefined)) continue
    const backdrop: EnvBackdrop = {
      color: [color[0], color[1], color[2]],
      center: [center[0], center[1], center[2]],
      size: [size[0], size[1]],
    }
    const yawY = asNumberIn(b.yawY, -3600, 3600)
    if (yawY !== undefined) backdrop.yawY = yawY
    backdrops.push(backdrop)
  }
  if (backdrops.length > 0) out.backdrop = backdrops
  return out
}

/**
 * Pose les panneaux de fond du sidecar derrière les ouvertures du décor.
 * APRÈS fitEnvironment et applyEnvMaterials, et cet ordre porte du sens :
 * - enfants d'envRoot ajoutés après la mesure, ils n'entrent ni dans la boîte
 *   englobante (le calage au sol et envMetrics ne bougent pas), ni dans la
 *   carte d'analyse (un mur plein à 0,5 m derrière la fenêtre, donc dehors) ;
 * - jamais traversés par applyEnvMaterials : l'exposition ne les touche pas,
 *   la couleur du sidecar est la couleur rendue, point.
 * MeshBasicMaterial : unlit, comme un ciel — les régimes d'éclairage lui sont
 * indifférents. DoubleSide : un yawY posé de dos reste un fond, pas un trou.
 * Un clic qui passe par la fenêtre touche le panneau : hors grille de la
 * carte, le personnage n'y va pas — même sort qu'un clic sur un mur.
 */
/**
 * Une surface peut-elle ARRÊTER un clic ? Non si elle ne montre rien : un nœud
 * masqué (ou dont un ancêtre l'est), ou un matériau entièrement transparent.
 *
 * three ne le fait PAS tout seul : `Raycaster.intersectObject` ne teste que les
 * calques (`layers`), jamais `visible` ni l'opacité — un plan invisible reste un
 * mur pour le rayon. Le loft en portait un : `pPlane8_plafond_0`, matériau
 * `plafond` en `alphaMode: BLEND` avec un alpha de 0, tendu au-dessus de toute
 * la pièce. Il ne se voit pas, il ne se dessine pas, et il mangeait les clics au
 * sol — MESURÉ : 74 clics sur 185 finissaient dessus, et sous deux azimuts de
 * caméra sur cinq, plus AUCUN clic ne passait.
 *
 * La règle est volontairement géométrique-agnostique : rien sur les normales,
 * rien sur la position de la caméra, rien qui suppose « un plafond ». Le
 * front-end doit encaisser SEUL n'importe quel décor importé, et la seule chose
 * dont on soit sûr, c'est qu'une surface que l'utilisateur ne peut pas voir ne
 * peut pas être ce qu'il a visé. Un verre à 30 % d'opacité, lui, reste solide :
 * il se voit, donc il se clique.
 *
 * Le seuil (2 %) et non zéro strict : un exportateur qui écrit 0,004 au lieu de
 * 0 dit la même chose.
 */
interface RaycastableMaterial {
  transparent?: boolean
  opacity?: number
}
interface RaycastableObject {
  visible?: boolean
  parent?: RaycastableObject | null
  material?: RaycastableMaterial | RaycastableMaterial[]
}
const OPACITE_INVISIBLE = 0.02

function estOpaqueAuClic(object: Object3D): boolean {
  for (let n: RaycastableObject | null | undefined = object as RaycastableObject; n; n = n.parent) {
    if (n.visible === false) return false
  }
  const material = (object as RaycastableObject).material
  if (!material) return true // pas un mesh, ou mesh sans matériau : on ne présume rien
  const efface = (one: RaycastableMaterial): boolean =>
    one.transparent === true && (one.opacity ?? 1) <= OPACITE_INVISIBLE
  // Groupes multi-matériaux : le mesh n'est traversé que si TOUS ses matériaux
  // sont effacés — sinon on ne saurait pas dire quel groupe porte la face.
  return Array.isArray(material) ? !material.every(efface) : !efface(material)
}

/** Premier impact qui montre quelque chose, ou null. La liste est déjà triée. */
function premierImpactVisible(hits: readonly Intersection[]): Intersection | null {
  for (const hit of hits) if (estOpaqueAuClic(hit.object)) return hit
  return null
}

function addEnvBackdrops(root: Object3D, backdrops: readonly EnvBackdrop[] | undefined): void {
  if (!backdrops) return
  for (const b of backdrops) {
    const material = new MeshBasicMaterial()
    // Composantes écrites telles quelles : linéaires, comme baseColorFactor.
    material.color.r = b.color[0]
    material.color.g = b.color[1]
    material.color.b = b.color[2]
    material.side = DoubleSide
    const quad = new Mesh(new PlaneGeometry(b.size[0], b.size[1]), material)
    quad.position.set(b.center[0], b.center[1], b.center[2])
    quad.rotation.y = (b.yawY ?? 0) * DEG2RAD
    quad.name = 'env-backdrop'
    root.add(quad)
  }
}

/**
 * Lit le sidecar de placement d'un décor. Son absence est le cas NORMAL : ni
 * erreur, ni trace en console — un 404 ou un JSON illisible rend simplement un
 * placement vide, et le décor est ajusté automatiquement.
 * NB : un sidecar absent ne répond PAS 404 ici, mais l'index.html du repli SPA
 * (Vite en dev, express.static en prod) — d'où la garde sur res.json(), qui lève
 * sur du HTML. Les deux chemins mènent au même endroit : un placement vide.
 */
async function fetchPlacement(url: string): Promise<EnvPlacement> {
  const jsonUrl = url.replace(/\.(glb|gltf)$/i, '.json')
  if (jsonUrl === url) return {}
  try {
    const res = await fetch(jsonUrl)
    if (!res.ok) return {}
    return parsePlacement(await res.json())
  } catch {
    return {}
  }
}

/**
 * GLTFLoader LÈVE quand un .glb réclame un décodeur qui n'est pas branché
 * (Draco, meshopt, KTX2 : des fichiers à servir, pas des dépendances npm). Son
 * message brut ne dit rien à personne — on le remplace par la marche à suivre.
 * Retourne null si l'erreur n'a rien à voir avec une compression.
 */
function compressionError(e: unknown): Error | null {
  const msg = e instanceof Error ? e.message : String(e)
  if (!/draco|meshopt|ktx2|basis/i.test(msg)) return null
  return new Error(translate('envCompressed'))
}

/**
 * Matériau de décor vu par l'exposition. `color`, `emissive` et leurs textures
 * ne sont PAS sur Material (la classe de base) mais sur MeshBasicMaterial /
 * MeshStandardMaterial. Un .glb de pièce peut porter les deux — trois des cinq
 * matériaux de rustic-bedroom sont unlit sans texture, les deux autres unlit avec
 * texture, et cozy-loft-room est en PBR : d'où des propriétés TOUTES optionnelles,
 * dans l'esprit du ViewOffsetCamera plus bas.
 */
interface ShadedMaterial {
  name?: string
  color?: Color
  emissive?: Color
  map?: unknown
  emissiveMap?: unknown
  /** MeshPhysicalMaterial seulement (KHR_materials_transmission) — cf. tunedClone. */
  transmission?: number
}

/**
 * Multiplie une couleur par le facteur d'exposition, composante par composante.
 *
 * `clampToGamut` distingue les deux natures que peut avoir une couleur de
 * matériau glTF :
 * - SANS texture, `color` EST l'albédo : une composante au-delà de 1 ne veut rien
 *   dire (une surface ne renvoie pas plus de lumière qu'elle n'en reçoit) et sur
 *   un matériau PBR elle se verrait vraiment, dans les zones peu éclairées. Bornée.
 * - AVEC texture, `color` est un simple GAIN appliqué par-dessus le texel
 *   (`baseColorFactor`, qui vaut exactement [1,1,1,1] sur les cinq matériaux
 *   texturés des décors livrés). Le borner à 1 rendrait tout éclaircissement
 *   IMPOSSIBLE — c'est précisément le piège : sur rustic-bedroom, la moitié
 *   texturée de la surface serait restée inchangée et seuls les sols auraient
 *   éclairci, déséquilibrant la pièce. L'écrêtage a lieu de toute façon plus tard
 *   et au bon endroit : à la sortie du fragment shader, par texel, une fois la
 *   multiplication faite.
 */
function scaleColor(color: Color, factor: number, clampToGamut: boolean): void {
  const limit = clampToGamut ? 1 : Infinity
  color.r = Math.min(limit, color.r * factor)
  color.g = Math.min(limit, color.g * factor)
  color.b = Math.min(limit, color.b * factor)
}

/**
 * Clone réglé d'un matériau : réparation d'albédo (sidecar `materials`) PUIS
 * exposition. La réparation d'abord — elle REMPLACE l'albédo abîmé de l'asset,
 * et c'est ce matériau réparé que l'exposition éclaire ensuite, comme les
 * autres. Composantes écrites telles quelles : la convention du sidecar est
 * celle de baseColorFactor (linéaire), aucun passage par du sRGB.
 * Le CLONE est obligatoire : three mutualise volontiers un matériau entre
 * plusieurs meshes, et sans copie la couleur serait multipliée une fois par
 * mesh qui la partage — puis encore à chaque rechargement du décor, l'effet se
 * cumulant jusqu'au blanc.
 * Un seul clone par matériau d'ORIGINE (d'où le cache) : les meshes qui
 * partageaient un matériau continuent d'en partager un, le nombre de programmes
 * GPU et le regroupement des appels de dessin restent ceux d'avant.
 */
function tunedClone(
  source: Material,
  factor: number,
  repairs: EnvPlacement['materials'],
  cache: Map<Material, Material>,
): Material {
  const known = cache.get(source)
  if (known) return known
  const clone = source.clone()
  const shaded = clone as unknown as ShadedMaterial
  // `name` passe par ShadedMaterial : comme `color`, la propriété existe à
  // l'exécution mais échappe au typage inféré du build JS de three.
  const repair = shaded.name !== undefined ? repairs?.[shaded.name] : undefined
  if (repair?.color && shaded.color) {
    shaded.color.r = repair.color[0]
    shaded.color.g = repair.color[1]
    shaded.color.b = repair.color[2]
  }
  // Transmission : écrite AVANT toute compilation (le clone n'a jamais été
  // rendu, aucun needsUpdate à poser). Seul un matériau qui la porte déjà est
  // touché — sur un unlit, la clé est simplement sans objet.
  if (repair?.transmission !== undefined && typeof shaded.transmission === 'number') {
    shaded.transmission = repair.transmission
  }
  if (factor !== 1) {
    if (shaded.color) scaleColor(shaded.color, factor, !shaded.map)
    // L'émissif suit le même facteur : sinon une lampe du décor garderait sa
    // luminosité propre pendant que tout le reste change, et l'exposition
    // déplacerait l'équilibre de la pièce au lieu de la rendre plus lisible.
    // Nul sur les matériaux unlit (MeshBasicMaterial n'a pas d'émissif du tout).
    if (shaded.emissive) scaleColor(shaded.emissive, factor, !shaded.emissiveMap)
  }
  cache.set(source, clone)
  return clone
}

/**
 * Applique les réglages de matériaux du sidecar au décor : réparations
 * d'albédo (`materials`) et exposition (`exposure`) — aux MATÉRIAUX, et non à
 * l'intensité des lumières comme avant : `anime-classroom.glb` et
 * `rustic-bedroom.glb` déclarent l'extension glTF `KHR_materials_unlit`, donc
 * GLTFLoader les charge en MeshBasicMaterial et ils IGNORENT totalement les
 * lumières de la scène — le réglage n'avait aucun effet sur deux décors sur
 * trois, dont celui qui en a le plus besoin. Multiplier la couleur marche à
 * l'identique pour l'unlit et le PBR.
 * Pas de `renderer.toneMapping` / `toneMappingExposure` : ils toucheraient tout le
 * rendu, avatar compris, y compris quand aucun décor n'est chargé.
 * Sidecar muet (exposition 1, aucune réparation — le cas de très loin le plus
 * courant) : on ne touche à RIEN, pas même un clone, donc rendu strictement
 * identique à avant.
 */
function applyEnvMaterials(root: Object3D, placement: EnvPlacement): void {
  const factor = placement.exposure ?? 1
  const repairs = placement.materials
  if (factor === 1 && !repairs) return
  const cache = new Map<Material, Material>()
  root.traverse((node) => {
    const mesh = node as Mesh
    const material = mesh.material
    if (!material) return // un Object3D quelconque (nœud de transformation, os…)
    mesh.material = Array.isArray(material)
      ? material.map((one) => tunedClone(one, factor, repairs, cache))
      : tunedClone(material, factor, repairs, cache)
  })
}

// three est consommé SANS @types/three (types inférés du build JS) et
// l'inférence ne voit pas le décentrement d'objectif : déclaration locale,
// signatures de la doc three (PerspectiveCamera.setViewOffset).
interface ViewOffsetCamera {
  setViewOffset(fullWidth: number, fullHeight: number, x: number, y: number, width: number, height: number): void
  clearViewOffset(): void
}

// Os dont la pose de base est mémorisée : l'idle écrit base + offset à chaque
// frame (jamais de cumul), les bras restent simplement sur leur base.
const TRACKED_BONES: readonly VRMHumanBoneName[] = [
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftUpperArm',
  'rightUpperArm',
  'leftLowerArm',
  'rightLowerArm',
]

// ── Animations .vrma ────────────────────────────────────────────────────────
// Le NOM DE FICHIER est toute la configuration : ni mapping, ni liste en dur, ni
// écran de réglages. Un nom qui ne correspond à aucun rôle est ignoré EN SILENCE
// — le dossier vrma/ contient aussi de la matière première pour la suite (marche,
// nage, saut…), qui ne doit surtout pas se déclencher toute seule.

// Les fondus sont dans `fades.ts` — la table de correspondance avec la machine à
// états d'Overte (`vrma/transitions.json`) : une durée et une courbe PAR
// jonction, avec l'état d'Overte d'où le chiffre vient.

/** Socle de remplacement pendant qu'une réponse s'écrit. */
const TALKING_STEM = 'idle-talking'
/**
 * Socle de remplacement pendant que l'utilisateur TAPE. Rôle propre à la famille
 * Rocketbox : Overte n'a aucun clip d'écoute, donc `cat.listening` y reste vide
 * et setListening n'a littéralement rien à faire — le comportement d'un
 * personnage Overte ne bouge pas d'un millimètre.
 */
const LISTENING_STEM = 'listen'
/**
 * Préfixe de la SECONDE famille de face à face (Microsoft Rocketbox, cf.
 * vrma/README.md). Deux bibliothèques complètes, deux stations debout
 * différentes : le raccord CROISÉ mesure 16,5 à 20,3 cm là où il vaut 0,2 à
 * 5,7 cm à l'intérieur d'une famille. Les rôles de face à face ne les mélangent
 * donc jamais — la séparation se fait ici, à la construction du catalogue.
 *
 * Le domaine `world-` de la scène vivante, lui, n'a qu'une famille et n'en aura
 * pas d'autre : Rocketbox n'a ni marche, ni pivot, ni assise. En scène vivante,
 * un personnage Rocketbox garde donc SES socles et SES gestes, et emprunte les
 * allures d'Overte — c'est le seul raccord croisé de tout le système, et il est
 * documenté dans vrma/README.md.
 */
const RB_PREFIX = 'rb-'
/** Radicaux de posture : `pose-sit` (nom court) et les clips assis livrés tels quels. */
const POSTURE_PREFIXES = ['pose-', 'sit-'] as const
/**
 * Domaine « monde 3D » : déplacement, pivots, postures de la scène vivante. Ces
 * clips ne sont JAMAIS joués en face à face — le mode conversation n'a aucune
 * raison de télécharger 2,4 Mo d'allures. Leur chargement est donc PARESSEUX
 * (cf. worldUrlsNeeded) et conditionné à l'interrupteur.
 */
const WORLD_PREFIX = 'world-'

/**
 * Radical du clip d'ACQUIESCEMENT — la réaction au clic sur le personnage en
 * scène vivante. `nod.vrma` existe déjà dans vrma/ (domaine face à face) mais
 * n'était rattaché à aucun rôle : il n'est téléchargé QUE quand la scène
 * vivante l'est, avec les clips `world-`.
 */
const REACTION_STEM = 'nod'

/** Rôles reconnus dans vrma/, en URLs de fichiers. */
interface VrmaCatalog {
  idle: string[] // socle en boucle — SANS LUI, aucune animation n'est jouée
  talking: string[] // socle en boucle pendant que le personnage parle
  listening: string[] // socle en boucle pendant que l'utilisateur tape (famille rb)
  gestures: Map<Emotion, string[]> // joué une fois, puis retour au socle
  postures: Map<string, string[]> // remplace le socle (setPosture)
  world: Map<string, string[]> // domaine `world-`, clé = radical SANS le préfixe
  reactions: string[] // acquiescement au clic (REACTION_STEM), scène vivante seule
}

function pushInto<K>(map: Map<K, string[]>, key: K, url: string): void {
  const list = map.get(key)
  if (list) list.push(url)
  else map.set(key, [url])
}

/**
 * URLs → rôles, POUR UNE SEULE FAMILLE. Le radical est mis en minuscules et son
 * suffixe de variante (`-2`, `-3`…) retiré : `happy-2.vrma` est une variante de
 * `happy`, exactement la grammaire des salutations multiples d'un personnage.
 *
 * LA FAMILLE SE LIT DANS LE NOM, et la séparation porte sur les rôles de FACE À
 * FACE — socle, socle parlant, socle d'écoute, gestes d'émotion. Ceux-là ne
 * viennent que de la famille demandée : un clip de l'autre famille n'y entre
 * jamais (16,5 à 20,3 cm de raccord croisé, cf. RB_PREFIX), et la famille non
 * choisie n'est donc jamais téléchargée — ses URLs ne sont dans aucune liste que
 * buildAnimations parcourt.
 *
 * Le domaine de la SCÈNE VIVANTE, lui, est le même pour tout le monde : allures,
 * pivots, transitions, postures assises et acquiescement au clic sont
 * intégralement Overte, parce qu'ils n'existent que là. Rocketbox n'en fournit
 * aucun et n'en fournira pas : un `rb-nod` est un « nod » de réserve, jamais la
 * réaction au clic.
 *
 * Le préfixe `rb-` est retiré AVANT la dérivation du rôle — la grammaire est
 * ensuite la même mot pour mot pour les deux familles.
 */
function catalogFromUrls(urls: readonly string[], family: AnimationFamily): VrmaCatalog {
  const cat: VrmaCatalog = {
    idle: [],
    talking: [],
    listening: [],
    gestures: new Map(),
    postures: new Map(),
    world: new Map(),
    reactions: [],
  }
  for (const url of urls) {
    const file = decodeURIComponent(url.split('/').pop() ?? '')
    const nom = file
      .replace(/\.vrma$/i, '')
      .toLowerCase()
      .replace(/-\d+$/, '')
    const rb = nom.startsWith(RB_PREFIX) && nom.length > RB_PREFIX.length
    const stem = rb ? nom.slice(RB_PREFIX.length) : nom
    // ── Rôles de FACE À FACE : la famille demandée, et elle seule ───────────
    if (rb === (family === 'rocketbox')) {
      if (stem === 'idle') {
        cat.idle.push(url)
        continue
      }
      if (stem === TALKING_STEM) {
        cat.talking.push(url)
        continue
      }
      if (stem === LISTENING_STEM) {
        cat.listening.push(url)
        continue
      }
      if ((EMOTIONS as readonly string[]).includes(stem)) {
        pushInto(cat.gestures, stem as Emotion, url)
        continue
      }
    }
    // ── Domaine de la SCÈNE VIVANTE : Overte, quelle que soit la famille ────
    // Un clip `rb-` qui arrive ici (rb-nod, rb-wave, rb-think…) n'a pas trouvé
    // de rôle de face à face : il est ignoré, comme `shake` ou `raise-hand`
    // côté Overte. Un clip Overte qui arrive ici alors qu'on bâtit le catalogue
    // Rocketbox est soit un socle de l'autre famille (ignoré plus bas, aucun
    // test ne le prend), soit une allure, une posture ou l'acquiescement — et
    // ceux-là, on les veut.
    if (rb) continue
    if (stem === REACTION_STEM) cat.reactions.push(url)
    // Le domaine `world-` se teste AVANT les postures : `world-sit-idle`
    // commence par `world-`, pas par `sit-`. C'est cet ordre manquant qui rendait
    // POSTURE_PREFIXES aveugle aux clips renommés — cat.postures restait vide et
    // setPosture ne faisait rien du tout.
    else if (stem.startsWith(WORLD_PREFIX) && stem.length > WORLD_PREFIX.length) {
      pushInto(cat.world, stem.slice(WORLD_PREFIX.length), url)
    } else {
      // `pose-sit` donne la posture « sit » ; un clip assis déposé à la main sous
      // son nom d'origine (`sit-idle`) garde son nom complet comme posture.
      const prefix = POSTURE_PREFIXES.find((p) => stem.startsWith(p) && stem.length > p.length)
      if (prefix) pushInto(cat.postures, prefix === 'pose-' ? stem.slice(prefix.length) : stem, url)
    }
  }
  return cat
}

/**
 * Clips du domaine `world-` à télécharger. Mode éteint : liste VIDE, donc la
 * liste totale de buildAnimations est identique à l'octet près à celle d'avant
 * la scène vivante. C'est la garantie du « éteint = comme aujourd'hui ».
 */
const WORLD_NEEDED: readonly string[] = [
  'turn-left',
  'turn-right',
  'walk-slow',
  'walk',
  'walk-start',
  'walk-stop',
  // L'arrêt COURT des coins d'itinéraire (`beginStop` de wander.ts). Sans cette
  // ligne, `host.has('walk-stop-small')` rend false et chaque étape retombe sur
  // le tirage des arrêts longs : la correction est là, mais dormante.
  'walk-stop-small',
  'sit-enter',
  'sit-exit',
  'sit-idle',
  'sit-talking',
  'sit-look',
  'sit-shift',
  // Les gestes d'ÉMOTION assis (table SIT_EMOTES de wander.ts) et l'acquiescement
  // assis (SIT_REACTIONS). Une clef, pas un fichier : `catalogFromUrls` retire le
  // suffixe numérique de variante, donc `sit-clap` en apporte trois (clap, -2, -3)
  // et `sit-nod` trois aussi — dix clefs pour quatorze fichiers, 2,0 Mo. Sans
  // cette liste, `host.has()` rend false et la table entière est dormante : le
  // personnage assis n'a jamais que son visage pour dire ce qu'il ressent.
  'sit-clap',
  'sit-cheer',
  'sit-sad',
  'sit-shake',
  'sit-dismiss',
  'sit-lean',
  'sit-legs',
  'sit-nod',
  'sit-disbelief',
  'sit-ack',
]

function worldUrlsNeeded(cat: VrmaCatalog, on: boolean): string[] {
  if (!on) return []
  // L'acquiescement au clic part avec le domaine `world-` : c'est une réaction
  // de la scène vivante, le face à face n'en télécharge pas un octet.
  return [...WORLD_NEEDED.flatMap((name) => cat.world.get(name) ?? []), ...cat.reactions]
}

// Loader SÉPARÉ de celui du VRM et de celui du décor : une .vrma n'est ni un
// personnage ni une pièce, elle n'a qu'une extension d'animation à lire.
const vrmaLoader = new GLTFLoader()
vrmaLoader.register((parser) => new VRMAnimationLoaderPlugin(parser))

// Un VRMAnimation ne contient que des pistes nommées par os humanoïde : il est
// INDÉPENDANT du modèle et survit donc aux changements de personnage. Le CLIP,
// lui, est lié à l'instance de VRM (cf. buildAnimations).
const vrmaCache = new Map<string, Promise<VRMAnimation | null>>()

/**
 * Charge une .vrma, une seule fois par session ; illisible ou vide → null, sans bruit.
 * Seuls les SUCCÈS restent en cache : un `.vrma` tombé pendant que le serveur de
 * développement redémarre condamnerait sinon l'avatar au repli « aucune animation »
 * pour toute la session, F5 obligatoire — et il n'y a qu'un `idle.vrma`, donc pas
 * de variante de secours (cf. la garde `!clips.has(idleUrl)` de buildAnimations).
 */
function loadVrmAnimation(url: string): Promise<VRMAnimation | null> {
  let pending = vrmaCache.get(url)
  if (!pending) {
    pending = vrmaLoader
      .loadAsync(url)
      .then((gltf) => {
        const animation = (gltf.userData.vrmAnimations as VRMAnimation[] | undefined)?.[0] ?? null
        // Un .glb lu mais SANS piste d'animation est un échec lui aussi : réponse
        // tronquée ou fichier qui n'est pas une .vrma. On ne le figera pas.
        if (!animation) vrmaCache.delete(url)
        return animation
      })
      .catch((e) => {
        console.warn('[vrma]', url, e)
        vrmaCache.delete(url)
        return null
      })
    vrmaCache.set(url, pending)
  }
  return pending
}

// Liste des fichiers, demandée UNE FOIS pour la session : le contenu du dossier ne
// change pas pendant qu'on s'en sert. Liste injoignable → catalogues vides → aucun
// mixer, donc exactement le comportement d'avant les animations. Mais cet échec-là
// n'est PAS mémorisé : la promesse est oubliée pour que le prochain chargement de
// modèle (ou l'interrupteur des Réglages) retente, au lieu de servir un catalogue
// vide jusqu'au F5 suivant.
let listPending: Promise<readonly string[]> | null = null

function loadList(): Promise<readonly string[]> {
  listPending ??= getVrmAnimations().catch((e) => {
    console.warn('[vrma]', e)
    listPending = null
    return []
  })
  return listPending
}

// Un catalogue PAR FAMILLE, dérivé de la même liste. Deux familles = deux
// catalogues disjoints, jamais un catalogue mixte : c'est ici que l'étanchéité
// devient une structure de données et pas une intention. Le cache évite de
// reconstruire à chaque changement de personnage ; la famille non consultée n'a
// même pas de catalogue, et pas un octet de ses clips n'est demandé.
const catalogByFamily = new Map<AnimationFamily, VrmaCatalog>()

async function loadCatalog(family: AnimationFamily): Promise<VrmaCatalog> {
  const known = catalogByFamily.get(family)
  if (known) return known
  const urls = await loadList()
  const cached = catalogByFamily.get(family)
  if (cached) return cached // une autre demande est arrivée pendant l'attente
  const cat = catalogFromUrls(urls, family)
  // Un catalogue bâti sur une liste VIDE n'est pas mémorisé — même règle que
  // listPending : l'échec ne doit pas survivre à la tentative suivante.
  if (urls.length > 0) catalogByFamily.set(family, cat)
  return cat
}

/** Un élément au hasard (liste jamais vide à l'appel). */
function pickOne<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

/**
 * Poids de chaque action à l'avancement `p` (0 → 1) d'un fondu vers `to`, à
 * partir des poids `from` relevés au déclenchement de ce fondu.
 *
 * FONCTION PURE, et SEULE règle de calcul des poids du fichier : c'est donc le
 * seul endroit à relire pour vérifier l'invariant de la section (« la somme des
 * poids ne descend jamais sous 1 »). Cette somme vaut `p + (1 − p) · Σfrom`, donc
 * exactement 1 dès que `Σfrom` vaut 1 — quel que soit `p`, et quel que soit le
 * nombre de fondus qui se recouvrent, puisque `from` contient TOUTES les actions
 * qui portaient du poids, fondu abandonné en cours de route compris.
 * Corollaire : `from` vide est le seul cas où fondre ferait passer la somme sous
 * 1, et c'est précisément là que `fadeTo` pose le poids 1 immédiatement.
 */
function fadeWeights<A>(from: ReadonlyMap<A, number>, to: A, p: number): Map<A, number> {
  const out = new Map<A, number>()
  for (const [action, weight] of from) out.set(action, weight * (1 - p))
  out.set(to, p + (from.get(to) ?? 0) * (1 - p))
  return out
}

export function createVrmStage(container: HTMLElement): VrmStage {
  // ── Renderer : fond transparent (le fond visuel est géré par l'UI en CSS) ──
  const renderer = new WebGLRenderer({ alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = SRGBColorSpace
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  container.appendChild(renderer.domElement)

  const scene = new Scene()
  // Deux groupes FRÈRES.
  //
  // Le DÉCOR se place une fois pour toutes (fitEnvironment) pour amener son point
  // d'accueil à l'origine du monde ; il ne bouge plus jamais ensuite.
  //
  // L'AVATAR est à l'origine tant que la scène vivante est éteinte — donc
  // exactement comme avant, à l'octet près. Allumée, `avatarGroup.position` et
  // `avatarGroup.rotation.y` DEVIENNENT la position et le cap du personnage dans
  // la pièce.
  //
  // Les cadrages sauvegardés (data/ui.json, coordonnées monde absolues) survivent
  // à ce renversement, et ce n'est pas un pari : `currentView()` n'est appelée que
  // depuis l'écouteur 'end' d'OrbitControls et depuis resetView, c'est-à-dire
  // uniquement sur un geste de l'utilisateur — et la scène vivante ne touche
  // JAMAIS à la caméra. Ce qui est persisté reste ce que l'utilisateur a composé
  // à la main. Seul frameCamera (le double-clic) apprend à suivre le personnage.
  const avatarGroup = new Group()
  const envGroup = new Group()
  scene.add(avatarGroup, envGroup)

  const camera = new PerspectiveCamera(30, 1, 0.1, 20)
  camera.position.set(...CAM_HOME_POS)

  // Lumière principale de face/haut + appoint doux (ne pas écraser le toon).
  const keyLight = new DirectionalLight(0xffffff, KEY_LIGHT_SOLO)
  keyLight.position.set(0.3, 1.6, 1.2)
  scene.add(keyLight)
  const fillLight = new HemisphereLight(0xffffff, 0x8890a0, FILL_LIGHT_SOLO)
  scene.add(fillLight)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  // Placement libre de l'avatar — geste PRINCIPAL = déplacement (c'est un
  // compagnon à poser sur l'écran, pas un objet à inspecter) :
  // glisser / un doigt = pan · molette / pincement = zoom ·
  // clic droit = rotation · double-clic = cadrage par défaut.
  controls.enablePan = true
  controls.screenSpacePanning = true
  controls.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }
  controls.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN }
  controls.minDistance = 0.5
  controls.maxDistance = 4
  controls.minPolarAngle = Math.PI * 0.15
  controls.maxPolarAngle = Math.PI * 0.85
  controls.target.set(...CAM_HOME_TARGET)

  const loader = new GLTFLoader()
  loader.register((parser) => new VRMLoaderPlugin(parser))
  // Décors : loader NU, sans le moindre plugin — un .glb de pièce n'a ni
  // humanoïde, ni expressions, ni spring bones à interpréter.
  const envLoader = new GLTFLoader()

  const idle = new IdleAnimator()
  const posedBones = new Map<VRMHumanBoneName, PosedBone>()
  let currentVrm: VRM | null = null
  let loadGeneration = 0
  let disposed = false

  // ── Regard (portage Overte, cf. gaze.ts) ──────────────────────────────────
  // Les yeux suivent une CIBLE DU MONDE pilotée par le comportement de
  // conversation (bouche/yeux, saccades, retargetage au clignement) ; la tête
  // assiste au-delà du cône de 25°, sauf pendant une émotion. L'idle reste
  // seul maître du clignement — le regard ne fait que lui en demander.
  const gaze = createGaze({
    blinkAmount: () => idle.blinkAmount(),
    requestBlink: (slow) => idle.requestBlink(slow),
    emotionActive: () => idle.emotionActive(),
  })
  scene.add(gaze.target)

  // ── Animations .vrma ──────────────────────────────────────────────────────
  // RÈGLE FONDATRICE : la somme des poids d'action vaut EXACTEMENT 1 à chaque
  // image, et tous les fondus vont d'un clip À UN AUTRE, jamais d'un clip vers
  // rien. Une somme inférieure à 1 fait en effet fondre le squelette vers sa pose
  // d'ORIGINE (bras en croix), pas vers notre pose de repos ; une somme supérieure
  // dilue chaque clip, `accumulate` normalisant. La règle n'est pas seulement
  // écrite : elle est TENUE par fadeWeights et contrôlée par poseWeights.
  // Corollaire assumé : sans socle d'idle utilisable, AUCUN mixer n'est créé et
  // l'avatar retombe à l'octet près sur le comportement d'avant les animations.
  let animationsEnabled = true
  let catalog: VrmaCatalog | null = null
  let mixer: AnimationMixer | null = null
  const actions = new Map<string, AnimationAction>() // une action par URL de .vrma
  let idleAction: AnimationAction | null = null
  let talkingAction: AnimationAction | null = null
  let listenAction: AnimationAction | null = null
  let lastListen: AnimationAction | null = null // anti-répétition du tirage d'écoute
  let postureAction: AnimationAction | null = null
  let gaitAction: AnimationAction | null = null // allure ou pivot du domaine `world-`
  let postureName: string | null = null
  let baseAction: AnimationAction | null = null // socle voulu (en boucle)
  let activeAction: AnimationAction | null = null // ce qui tient l'écran : socle ou geste
  let talking = false
  let listening = false // l'utilisateur est en train de taper (cf. setListening)
  // Famille de face à face du personnage affiché. Elle vaut dans les deux modes :
  // en scène vivante, elle continue de fournir le socle, la parole, l'écoute et
  // les gestes — seul le domaine `world-` (allures, postures, transitions) reste
  // Overte, parce qu'il n'existe que là.
  let animFamily: AnimationFamily = 'overte'
  // Poids porté par chaque action à cette image, et fondu en cours. C'est NOTRE
  // livre de comptes, trois raisons de ne pas laisser three le tenir :
  // - `crossFadeFrom` code en dur les poids de DÉPART (1 → 0 et 0 → 1) et
  //   `_scheduleFading` réécrit les bornes de l'interpolant sans regarder le poids
  //   effectif courant : deux fondus qui se recouvrent remettent l'action sortante
  //   à 1 et laissent celle du fondu précédent finir le sien — somme jusqu'à 2 ;
  // - le cas est le cas NORMAL, pas un cas limite : à chaque réponse, le socle
  //   « parle » et le geste d'émotion partent du même callback synchrone ;
  // - `accumulate` normalise (mix = weight / cumulativeWeight), donc une somme de
  //   2 ne casse rien mais divise l'amplitude du geste par deux le temps du
  //   recouvrement, et une somme < 1 fait fondre le squelette vers sa pose
  //   d'origine.
  // Les poids sont donc écrits à chaque image par fadeWeights, dont la somme vaut
  // exactement 1 par construction.
  const weights = new Map<AnimationAction, number>()
  let fade: {
    to: AnimationAction
    from: Map<AnimationAction, number> // poids relevés au déclenchement
    elapsed: number
    spec: Fade // durée ET courbe de CE fondu (cf. fades.ts)
  } | null = null
  let weightSumWarned = false
  // Un socle vient d'être posé : recadrer à la PROCHAINE image évaluée par le
  // mixer (cf. reframeAfterMixer). Le drapeau est consommé là et nulle part
  // ailleurs — sans mixer, il ne se passe rien.
  let reframePending = false

  // ── Scène vivante ─────────────────────────────────────────────────────────
  // Éteinte par défaut, et éteinte = comportement d'avant à l'octet près :
  // `wander` reste null, `avatarGroup` reste à l'origine, aucun clip `world-`
  // n'est téléchargé, et les deux lignes ajoutées à tick() sont des `?.` sur null.
  let interactive = false
  let wander: Wander | null = null
  // Cinématique inverse des jambes, reconstruite à chaque modèle (elle mesure
  // ses segments sur le squelette en place). null = modèle sans os de jambes
  // complets : la scène marche, sans correction d'assiette.
  let legIk: LegIk | null = null
  // Limites articulaires humaines (table d'Overte, cf. jointLimits.ts) :
  // TOUTE pose sortie du mixer est bornée à l'enveloppe humaine avant que
  // l'IK, l'idle et le rendu ne la voient. Mesuré : 3,5 µs par image pour les
  // 17 os, et 0 retouche au-delà de 0,9° sur les 54 clips chargés — la table
  // n'existe que pour l'impossible (retargeting sur un modèle exotique,
  // mélange qui part en vrille), pas pour restyler la bibliothèque.
  // Ce « 0 retouche » avait été mesuré dans un repère normalisé regardant le
  // +Z : il n'était vrai que des 5 modèles VRM 1.x du dossier. Depuis que
  // createJointLimits mesure le sens du repère, il l'est aussi des 89 en 0.x
  // (0,9° max, vérifié sur les deux formats).
  let jointLimits: JointLimits | null = null
  // Carte du décor en place (`<décor>.scene.json`). null = pas d'analyse : le
  // décor reste un fond, exactement comme aujourd'hui.
  let sceneMap: SceneMap | null = null
  // Ce que les pieds doivent faire à cette image (cf. legIk.FootMode).
  let footMode: FootMode = 'planted'
  // Ressort amorti critique d'Overte (AnimUtil.h) sur la VERTICALE du corps :
  // la marche franchit un changement de niveau de la carte (l'estrade) par un
  // saut discret de p.y — le ressort l'absorbe en ~0,3 s (timescale 0,15 s =
  // « mi-chemin par timescale »). L'horizontale passe telle quelle (échelle de
  // temps quasi nulle) : lisser le déplacement retarderait la marche.
  const bodySpring = new CriticallyDampedSpringPoseHelper()
  bodySpring.horizontalTimescale = 1e-6
  const springPose = { trans: new Vector3(), rot: new Quaternion() }
  let frameDelta = 1 / 60
  // Déplacement au sol dépeint par l'animation à cette image, relevé UNE FOIS
  // par tour de boucle (cf. legIk.stride) et lu par le comportement.
  const strideBuf = { x: 0, z: 0 }
  let strideOk = false
  // Instant (ms) du dernier geste de caméra de l'utilisateur, et geste en cours.
  // On ne déplace pas la scène sous sa main : le personnage attend qu'il ait
  // lâché, plus une seconde de grâce.
  let camGrabbed = false
  let camReleasedAt = -Infinity
  const USER_CAMERA_GRACE_MS = 2000

  // ── Décor ─────────────────────────────────────────────────────────────────
  let envRoot: Object3D | null = null
  // L'arbre du décor en place (cf. scene/bvh), bâti une fois après le gel des
  // matrices. null = pas de décor, ou décor dont la géométrie ne se laisse pas
  // indexer : `viser` retombe alors sur le lancer de rayon de three, plus lent
  // mais toujours juste. Il ne survit JAMAIS à son décor — il tient des vues
  // sur ses tampons de sommets, et un arbre resté derrière serait à la fois une
  // fuite mémoire et une géométrie fantôme sous le curseur.
  let envBvh: EnvBvh | null = null
  // Dimensions du décor en place (mètres) : elles pilotent le plan lointain de la
  // caméra et la distance de recul maximale. null = pas de décor.
  let envMetrics: { radius: number; height: number } | null = null
  // Distance de cadrage par défaut voulue par le SIDECAR du décor en place.
  // null = pas de décor ou décor muet : la distance automatique de frameCamera.
  // C'est le remède mesuré au « tableau plein cadre » de la classe : à 2 m le
  // fond du cadre est un mur plat à 2,06 m, et le spawn ne peut pas reculer
  // (les allées de 0,60 m ne laissent pas passer le gabarit) — seule la CAMÉRA
  // peut prendre du champ.
  let envFrameDist: number | null = null
  let envGeneration = 0

  // ── Cadrage utilisateur (pan/zoom/rotation) : persistance + reset ─────────
  let lastFrame: { vrm: VRM; h: number } | null = null // cadrage par défaut re-calculable
  // Distance du DERNIER cadrage par défaut (frameCamera) : le plancher du clamp
  // de recul — borner le zoom arrière sous cette distance rendrait le cadrage du
  // double-clic inatteignable (OrbitControls rapprocherait la caméra tout seul).
  let frameDist: number | null = null
  let viewChangeCb: ((view: StageView | null) => void) | null = null
  // La caméra tient-elle EXACTEMENT le cadrage par défaut calculé par frameCamera,
  // sans que personne n'y ait touché depuis ? Faux dès qu'une vue sauvegardée est
  // posée (setView) ou que l'utilisateur commence à manipuler la scène. C'est la
  // seule autorisation de recadrer tout seul (cf. reframeAfterMixer).
  let defaultFramed = false
  // Cadrage par défaut voulu par l'UI (setFrameMode) : 'centered' tant que
  // personne ne dit le contraire — c'est le comportement historique.
  let frameMode: FrameMode = 'centered'
  // Largeur de la colonne de chat (setPanelWidth) : la valeur par défaut du CSS
  // tant que l'UI ne dit rien.
  let panelWidth = CHAT_PANEL_DEFAULT_W

  function currentView(): StageView {
    return {
      pos: [camera.position.x, camera.position.y, camera.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
    }
  }

  // Pose de la caméra au DÉBUT du geste. OrbitControls n'a aucun seuil de
  // mouvement : onPointerUp émet 'end' à chaque relâché, et le bouton gauche est
  // mappé PAN — un simple clic immobile faisait donc 'start' + 'end', donc
  // écrivait une vue. Le seuil de 6 px du projet ne protège que onSceneClick.
  const gestureStart = { pos: new Vector3(), target: new Vector3() }
  // Déplacement cumulé (position + cible) sous lequel le geste n'a rien composé :
  // 0,1 mm, soit trois ordres de grandeur sous le moindre geste volontaire.
  const CAM_GESTURE_EPS = 1e-4

  // 'end' ne se déclenche qu'à la fin d'une interaction UTILISATEUR — jamais
  // sur un setView/frameCamera programmatique.
  controls.addEventListener('end', () => {
    // Une vue vient d'être persistée : le cadrage n'est plus celui par défaut.
    // Redondant avec 'start' dans le cas courant, mais pas toujours — un clic sur
    // un bouton non mappé fait un 'end' SANS 'start'.
    defaultFramed = false
    camGrabbed = false
    camReleasedAt = performance.now()
    // RIEN n'est persisté tant qu'aucun cadrage n'a eu lieu : avant le premier
    // frameCamera, la caméra est encore celle de la CONSTRUCTION, et un geste
    // fait pendant le chargement (le décor est à l'écran bien avant le .vrm)
    // enregistrait cette caméra d'usine comme un cadrage voulu. C'est un
    // enregistrement durable et invisible : applyViewFor le réinstalle à chaque
    // chargement via setView, qui pose defaultFramed = false — le cadrage par
    // défaut du personnage n'a alors plus jamais lieu.
    if (!lastFrame) return
    // Geste qui n'a RIEN bougé (un clic) : rien à mémoriser. La molette, elle,
    // est bien enregistrée — _handleMouseWheel appelle update() lui-même avant
    // le 'end' de onMouseWheel, le dolly est déjà appliqué au moment du test.
    const moved =
      camera.position.distanceTo(gestureStart.pos) + controls.target.distanceTo(gestureStart.target)
    if (moved < CAM_GESTURE_EPS) return
    viewChangeCb?.(currentView())
  })
  // 'start' est utilisateur lui aussi. Le cadrage cesse d'être « celui par
  // défaut » DÈS LE DÉBUT du geste et pas à sa fin : un recadrage automatique au
  // milieu d'un glissement arracherait la caméra des mains de l'utilisateur.
  controls.addEventListener('start', () => {
    defaultFramed = false
    camGrabbed = true
    gestureStart.pos.copy(camera.position)
    gestureStart.target.copy(controls.target)
  })

  /**
   * Vide les deltas résiduels d'OrbitControls AVANT d'écrire une pose de caméra.
   *
   * OrbitControls garde `_sphericalDelta` et `_panOffset` et continue de les
   * appliquer image après image tant que l'amortissement tourne (facteur 0,05,
   * soit la totalité du reliquat étalée sur ~60 images, une seconde à 60 Hz).
   * Un cadrage posé dans la seconde qui suit un glissement rapide se faisait donc
   * reprendre par la queue du geste — un déplacement souris de 20 px sur un
   * canvas de 800 px vaut 9° d'orbite appliqués APRÈS le recadrage, ce qui à
   * l'écran ressemble beaucoup à « le double-clic n'a pas marché ».
   *
   * `enableDamping = false` puis `update()` applique le reliquat ET le remet à
   * zéro (OrbitControls.js:396-403). L'appelant réarme l'amortissement après
   * avoir écrit sa pose. Pas d'API plus propre : la classe Controls de r170
   * n'expose que connect/disconnect/dispose/update, il n'y a pas de stop(), et
   * toucher `_sphericalDelta` serait s'accrocher à un champ privé.
   */
  function flushDamping(): void {
    controls.enableDamping = false
    controls.update()
  }

  /**
   * Le bouton de réinitialisation et le double-clic. Il rend TOUJOURS une vue :
   * c'est la seule sortie d'une orbite partie dans un mur, et un no-op y laisse
   * l'utilisateur devant un écran noir sans autre issue que F5.
   *
   * Sans modèle cadré (lastFrame null), le repli est la caméra de construction.
   * Cet état est atteignable et pas rare : le décor est chargé dès que le
   * personnage DÉCLARE un .vrm, par un effet indépendant de celui du modèle
   * (App.tsx), donc la pièce est orbitable pendant tout le vol du .vrm — 14 à
   * 24 Mo — et pendant les deux nouvelles tentatives (1 s puis 3 s) qui
   * précèdent le moindre bandeau d'erreur.
   */
  function resetView(): void {
    if (lastFrame) frameCamera(lastFrame.vrm, lastFrame.h)
    else {
      flushDamping()
      camera.position.set(...CAM_HOME_POS)
      controls.target.set(...CAM_HOME_TARGET)
      applyEnvLimits() // sans lastFrame : h = 1,6 m, le gabarit par défaut
      applyViewOffset()
      camera.updateProjectionMatrix()
      controls.update()
      controls.enableDamping = true
    }
    viewChangeCb?.(null)
  }

  function onDblClick(): void {
    resetView()
  }
  renderer.domElement.addEventListener('dblclick', onDblClick)

  // ── Interactions au clic (scène vivante) ──────────────────────────────────
  // Un lancer de rayon À L'ÉVÉNEMENT DE CLIC uniquement, jamais en continu —
  // intersecter la géométrie par image est interdit par l'architecture.
  // Le geste principal (glisser = pan) reste intact : un clic n'est retenu que
  // si le pointeur n'a pas bougé de plus de 6 px entre l'appui et le relâché.
  //
  // LE CURSEUR CONTEXTUEL AU SURVOL RESTE REFUSÉ, et la raison a changé.
  // Il l'était à cause du décor : 12,9 ms au 95e centile sur japanese-classroom.
  // Le BVH a réglé ce point-là et au-delà — 0,004 ms, 3 400× moins. Mais `viser`
  // interroge DEUX choses, et la seconde n'a pas bougé d'un pouce.
  //
  // Le personnage a une peau animée : ses sommets sont recalculés par
  // `applyBoneTransform` au moment du lancer de rayon, quatre matrices composées
  // par sommet, pour TOUS les triangles dès que la sphère englobante est
  // touchée. Aucun arbre ne peut indexer une géométrie qui n'existe pas encore
  // au moment où on la cherche. Mesuré sur les 94 modèles de vrm/ (25 000 à
  // 81 000 triangles à peau, cf. devtools/bench-raycast.mjs), p95 d'un rayon :
  //
  //   le plus LÉGER des 94   25 090 tris    4,0 ms
  //   le plus lourd          81 476 tris   19,8 ms
  //
  // Budget d'un test au survol à 10 Hz : 0,3 ms. Le plus léger le dépasse de
  // 13×, le plus lourd de 66×. Et ce n'est pas qu'une affaire de moyenne : une
  // image à 60 Hz dure 16,7 ms, donc un seul survol du personnage lourd mange
  // une image ENTIÈRE — dix fois par seconde tant que le pointeur reste sur lui.
  // La médiane, elle, est à 0,002 ms : la sphère englobante rejette les rayons
  // qui partent à côté et fait payer plein tarif ceux qui l'effleurent. C'est
  // donc exactement là où le curseur devrait être le plus bavard qu'il coûterait
  // le plus cher.
  //
  // Rendre le survol moins cher voudrait dire lui donner une vérité DIFFÉRENTE
  // de celle du clic (silhouette approchée, boîte englobante, échantillon
  // périmé) : un curseur qui promet ce que le clic ne tient pas est pire que
  // pas de curseur. Ce qu'il faudrait pour rouvrir le dossier, c'est un test de
  // silhouette du personnage à la fois EXACT et bon marché — pas un arbre.
  const raycaster = new Raycaster()
  const ndc = new Vector2()
  // Marqueurs de clic : deux anneaux réutilisés, posés dans la SCÈNE (le groupe
  // du décor est gelé au chargement, cf. envMerge). Ils sont construits même
  // quand la scène vivante est éteinte — deux meshes invisibles, jamais rendus,
  // et rien du tout dans le tick, qui ne les touche que sous `interactive`.
  const clickMarks = createClickMarks(scene)
  let downX = 0
  let downY = 0
  function onPointerDown(e: PointerEvent): void {
    downX = e.clientX
    downY = e.clientY
  }

  /**
   * Ce qu'un point de l'écran vise, dans le vocabulaire des interactions.
   * `point` est l'impact dans le décor : il porte le marqueur, y compris quand
   * il n'y a rien à y faire (« refusé » a besoin d'un endroit où se poser).
   */
  type CibleVisee =
    | { quoi: 'avatar' }
    | { quoi: 'assise'; assise: Seat; point: Vector3 }
    | { quoi: 'sol'; point: Vector3 }
    | { quoi: 'inerte'; point: Vector3 }

  /**
   * L'impact du décor pour le rayon courant du `raycaster`.
   *
   * L'arbre (scene/bvh) porte l'écrasante majorité de la géométrie et répond en
   * quelques microsecondes là où `intersectObject` balayait jusqu'à 326 000
   * triangles. Ce qu'il ne sait pas indexer — il le NOMME plutôt que de le
   * taire — repasse par three, et le plus proche des deux gagne. Le résultat
   * est donc exactement celui de `premierImpactVisible(intersectObject(envRoot,
   * true))` : vérifié rayon par rayon par devtools/bench-raycast.mjs, 22 400
   * rayons sur les sept décors et huit azimuts, zéro écart.
   *
   * Cette seconde passe est un GARDE-FOU, pas la réparation d'un bogue observé :
   * lowpoly-restaurant porte trois segments de ligne (three les intersecte, via
   * `params.Line.threshold`), et sur les huit azimuts mesurés aucun rayon ne
   * leur revient. Elle reste parce que la caméra est libre et que le prochain
   * décor importé n'a rien promis — et parce qu'un arbre qui perd un objet en
   * silence, c'est un mur qui laisse passer les clics.
   *
   * Sans arbre (décor sans rien d'indexable, ou pas encore chargé), le chemin
   * d'avant reste là, mot pour mot.
   */
  function viserDecor(): Intersection | null {
    if (!envBvh) return envRoot ? premierImpactVisible(raycaster.intersectObject(envRoot, true)) : null
    let best = raycastFirst(
      envBvh,
      raycaster.ray.origin,
      raycaster.ray.direction,
      estOpaqueAuClic,
      raycaster.near,
      raycaster.far,
    )
    // `false` : chaque nœud non couvert a été listé individuellement, descendre
    // dans ses enfants les compterait deux fois — et repasserait par la
    // géométrie que l'arbre vient justement d'indexer.
    for (const objet of envBvh.rest) {
      const hit = premierImpactVisible(raycaster.intersectObject(objet, false))
      if (hit && (!best || hit.distance < best.distance)) best = hit
    }
    return best
  }

  /**
   * Le lancer de rayon et sa lecture, séparés de l'action : la même passe sert
   * à décider quoi faire ET où poser la marque. `null` = le rayon n'a rien
   * rencontré (le vide au-dessus de la pièce) — il n'existe alors aucun point
   * du monde où marquer quoi que ce soit, et le clic reste muet à dessein.
   */
  function viser(clientX: number, clientY: number): CibleVisee | null {
    if (!currentVrm) return null
    const rect = renderer.domElement.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    // Le personnage d'abord : lui cliquer dessus prime sur le sol derrière lui.
    // Des DEUX côtés, on retient le premier impact qui montre quelque chose :
    // une surface invisible n'est pas ce que l'utilisateur a visé (cf.
    // estOpaqueAuClic — le plafond alpha 0 du loft rendait le sol incliquable).
    //
    // Et des deux côtés, jamais plus près que le plan de coupe : sous
    // camera.near, la surface n'est PAS dessinée — l'écran montre ce qu'il y a
    // derrière, le rayon doit donc y aller aussi. Même principe que la règle de
    // transparence, appliqué à l'autre façon d'être invisible.
    //
    // Le DÉCOR, lui, ne compte pas non plus sous controls.minDistance : la
    // caméra refuse elle-même de prendre pour sujet quoi que ce soit de plus
    // proche (frameCamera la borne à 0,3 h), donc une surface de la pièce collée
    // à l'objectif est du premier plan qui bouche la vue, pas une cible. Le cas
    // extrême est la caméra ENCASTRÉE dans un meuble — OrbitControls traverse
    // les murs sans collision, et dans rustic-bedroom un azimut entier d'orbite
    // passe dans une commode : l'écran se remplit de sa paroi, et plus AUCUN
    // clic au sol ne répondait (mesuré : de 63/85 et 53/85 rayons servis selon
    // la famille de caméras, à 70/85 et 57/85 — et rien ne recule : un impact
    // qui déclenche est à ≥ 0,9 m d'un œil à hauteur de tête, jamais sous ces
    // seuils). L'AVATAR garde le seul near : il est le sujet même de l'orbite,
    // son épaule à 20 cm de l'objectif reste ce que l'utilisateur regarde.
    // La praticabilité de la carte reste le filet : traverser un premier plan
    // ne mène jamais qu'à du sol qu'elle reconnaît.
    raycaster.near = camera.near
    const onAvatar = premierImpactVisible(raycaster.intersectObject(currentVrm.scene, true))
    raycaster.near = Math.max(camera.near, controls.minDistance)
    const onEnv = viserDecor()
    const dAvatar = onAvatar ? onAvatar.distance : Infinity
    const dEnv = onEnv ? onEnv.distance : Infinity
    if (dAvatar < dEnv) return { quoi: 'avatar' }
    if (!onEnv) return null
    const hit = onEnv.point
    // Sans carte, le décor n'est qu'un fond : tout impact est inerte. La marque
    // de refus, elle, se pose quand même — l'utilisateur doit apprendre que la
    // pièce ne répond pas, pas croire que son clic s'est perdu.
    if (!sceneMap) return { quoi: 'inerte', point: hit }
    // Une ASSISE visée ? La nappe à hauteur du point cliqué : il va s'y asseoir.
    // PLUSIEURS peuvent contenir le point : une chaise glissée sous son pupitre
    // n'est qu'à 0,267 m de son plateau, moins que la fenêtre de 0,30 m. On
    // retient alors celle dont l'altitude est la PLUS PROCHE du point touché, et
    // non la première du tableau — où les pupitres précèdent les chaises, si
    // bien que cliquer le tiers avant d'une chaise faisait grimper le
    // personnage SUR LE PLATEAU. Mesuré sur les nappes échantillonnées à 2 cm :
    // 13,6 % des points de la classe, 12,5 % du loft et 2,4 % de la chambre
    // désignaient une autre assise ; par altitude la plus proche, 0 % partout.
    let seatHit: Seat | null = null
    let seatDy = Infinity
    for (const seat of sceneMap.seats) {
      const dy = Math.abs(hit.y - seat.y)
      // Même fenêtre qu'avant (0,30 m) ; à égalité, la première du tableau reste
      // choisie — on ne départage que ce qui était arbitraire.
      if (dy > 0.3 || dy >= seatDy) continue
      const b = seat.bounds
      const inSheet = b
        ? hit.x >= b[0] - 0.08 && hit.x <= b[2] + 0.08 && hit.z >= b[1] - 0.08 && hit.z <= b[3] + 0.08
        : Math.hypot(hit.x - seat.center[0], hit.z - seat.center[1]) < 0.45
      if (!inSheet) continue
      seatHit = seat
      seatDy = dy
    }
    if (seatHit) return { quoi: 'assise', assise: seatHit, point: hit }
    // Sinon, le SOL — seulement si le point cliqué en est un (praticable et à
    // sa hauteur) : cliquer un mur ou une table n'envoie personne dedans.
    const floor = sceneMap.floorAt(hit.x, hit.z)
    if (floor === null || Math.abs(floor - hit.y) > 0.35) return { quoi: 'inerte', point: hit }
    return { quoi: 'sol', point: hit }
  }

  function onSceneClick(e: MouseEvent): void {
    if (!interactive || !wander || !currentVrm) return
    if (e.detail > 1) return // deuxième clic d'un double : le double-clic recadre
    const moved = (e.clientX - downX) ** 2 + (e.clientY - downY) ** 2
    if (moved > 36) return // c'était un glisser de caméra, pas un clic
    const cible = viser(e.clientX, e.clientY)
    if (!cible) return
    if (cible.quoi === 'avatar') {
      // Les yeux suivent déjà la caméra : il acquiesce et se met bien en face
      // quelques secondes. Assis, l'acquiescement passe par le canal des gestes
      // assis (wander.react → sit-ack/sit-nod) ; en mouvement ou en transition,
      // les gardes de playReaction et poke laissent l'attention aux seuls yeux.
      //
      // AUCUN marqueur ici, et c'est délibéré : l'anneau est une marque AU SOL,
      // le poser sur un buste inventerait un second vocabulaire. Le personnage
      // répond de son corps, ou bien il est visiblement occupé — dans les deux
      // cas l'écran a déjà dit quelque chose.
      playReaction()
      wander.poke()
      return
    }
    // Le retour de goTo/goSit fait foi : c'est LE seul endroit qui sache si le
    // clic a lancé quelque chose (carte absente, point impraticable, chemin
    // inexistant, personnage déjà en plein mouvement).
    const lance =
      cible.quoi === 'assise'
        ? wander.goSit(cible.assise)
        : cible.quoi === 'sol'
          ? wander.goTo(cible.point.x, cible.point.z)
          : false
    if (lance) clickMarks.accept(cible.point, camera.position)
    else clickMarks.refuse(cible.point, camera.position)
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('click', onSceneClick)

  // ── Taille : canvas 100 % du container (ResizeObserver + resize fenêtre) ──
  function resize(): void {
    const w = Math.max(1, container.clientWidth)
    const h = Math.max(1, container.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    applyViewOffset() // le décentrement est en pixels : il suit la taille réelle
    camera.updateProjectionMatrix()
  }
  resize()
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  window.addEventListener('resize', resize)

  function unloadCurrent(): void {
    if (!currentVrm) return
    disposeAnimations() // AVANT le retrait : uncacheRoot a besoin de la scène du modèle
    avatarGroup.remove(currentVrm.scene)
    VRMUtils.deepDispose(currentVrm.scene)
    currentVrm = null
    lastFrame = null
    frameDist = null // plus de cadrage par défaut : plus de plancher à protéger
    legIk = null // ses os appartiennent au modèle qu'on vient de jeter
    jointLimits = null // idem — la table est liée aux nœuds normalisés du modèle
    posedBones.clear()
    idle.setExpressionTable(new Map()) // plus de modèle : aucune expression pilotable
  }

  // Pose anti T-pose, puis mémorisation de la base (Euler) par os : l'idle
  // ajoutera ses offsets PAR-DESSUS ces valeurs à chaque frame.
  function applyRestPose(vrm: VRM): void {
    for (const [name, z] of REST_POSE_Z) {
      const node = vrm.humanoid.getNormalizedBoneNode(name)
      if (node) node.rotation.z = z
    }
    // Les DOIGTS de la même façon, et pour la même raison : un VRM charge la
    // main tendue, doigts en éventail — un mannequin de vitrine. La pose de
    // repos d'Overte (cf. handPoses.ts) leur donne la courbure d'une main qui
    // pend. Elle est posée ICI, donc avant la construction du mixer, ce qui
    // suffit à tout : les os qu'aucun clip ne pilote la gardent, ceux qu'un
    // clip pilote sont écrasés par lui, et un fondu ramène la main à sa détente
    // au rythme du fondu. Aucun code par image — c'est three qui tient la
    // valeur de repos (PropertyMixer.saveOriginalState / uncacheRoot).
    applyRelaxedHands(vrm)
    posedBones.clear()
    for (const name of TRACKED_BONES) {
      const node = vrm.humanoid.getNormalizedBoneNode(name)
      if (node) posedBones.set(name, { node, base: node.rotation.clone() })
    }
  }

  /**
   * Proxy de regard. createVRMAnimationClip avertit en console s'il n'en trouve
   * pas dans la scène du modèle (et en fabrique un lui-même). Objet INERTE ici :
   * rien ne l'animera tant qu'une .vrma ne portera pas de piste de regard — il
   * supprime le bruit et ouvre la porte au regard piloté.
   */
  function addLookAtProxy(vrm: VRM): void {
    if (!vrm.lookAt) return
    const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt)
    proxy.name = 'VRMLookAtQuaternionProxy' // sans nom, l'avertissement revient
    vrm.scene.add(proxy)
  }

  /**
   * Regard : les YEUX suivent la cible du système de regard porté d'Overte
   * (gaze.ts) — un point du monde qui vit autour de la caméra : bouche et yeux
   * de l'interlocuteur selon la table de conversation, saccades, retargetage
   * pendant le clignement. C'est vrm.update qui applique la cible aux os des
   * yeux, dans les limites que le MODÈLE déclare (jamais de nuque tordue par
   * les yeux). Dans les deux modes : en face à face, c'est ce qui remplace le
   * regard fixe ; en scène vivante, où que le personnage soit, il vous
   * regarde — la tête assiste au-delà du cône de 25°, le corps (wander) fait
   * le reste.
   */
  function applyGaze(): void {
    if (!currentVrm?.lookAt) return
    currentVrm.lookAt.target = gaze.target
  }

  /** Une action de socle boucle sans fin — elle n'émettra donc jamais 'finished'. */
  function asBase(action: AnimationAction | null): AnimationAction | null {
    action?.setLoop(LoopRepeat, Infinity)
    return action
  }

  /**
   * Une variante au hasard parmi celles réellement chargées. `avoid` : la
   * variante qui vient d'être jouée pour ce rôle — écartée du tirage tant qu'il
   * en reste une autre. Sans elle, un tirage uniforme rejoue le clip précédent
   * une fois sur `1/n` : 48 % pour un rôle à deux variantes (`angry`), 24 % pour
   * `happy` à quatre (mesuré sur 1 000 tirages) — et c'est ce qui se lit comme
   * un tic, pas comme un geste. Un rôle à une seule variante n'a pas le choix :
   * `avoid` est alors sans effet.
   */
  function pickAction(
    urls: readonly string[] | undefined,
    avoid: AnimationAction | null = null,
  ): AnimationAction | null {
    const ready = (urls ?? [])
      .map((url) => actions.get(url))
      .filter((a): a is AnimationAction => a !== undefined)
    const pool = avoid !== null && ready.length > 1 ? ready.filter((a) => a !== avoid) : ready
    return pool.length > 0 ? pickOne(pool) : null
  }

  /** Poids effectif d'une action, et livre tenu à jour. */
  function setWeight(action: AnimationAction, weight: number): void {
    // `enabled` recalculé à CHAQUE écriture : setEffectiveWeight rend un poids
    // effectif nul sur une action désactivée, celle qui reprend du poids doit donc
    // être réactivée d'abord. Et à poids nul on désactive — exactement ce que
    // three fait à la fin d'un fadeOut : l'action reste connue du mixer (son temps
    // ne repart pas de zéro, les socles gardent donc leur continuité) mais elle
    // n'est plus évaluée. setEffectiveWeight rend au passage l'interpolant de
    // fondu au mixer, ce qui garantit que three ne touche plus jamais à ce poids.
    action.enabled = weight > 0
    action.setEffectiveWeight(weight)
    if (weight > 0) weights.set(action, weight)
    else weights.delete(action)
  }

  /**
   * Écrit les poids d'une image, et VÉRIFIE l'invariant au passage : le contrôle
   * coûte une addition par action portante (deux ou trois), ne tourne que quand
   * les poids changent et ne parle qu'une fois par session. C'est ce qui rendra
   * visible tout de suite, et non par une revue de code, un futur appelant qui
   * poserait un poids dans le dos de fadeTo.
   */
  function poseWeights(next: ReadonlyMap<AnimationAction, number>): void {
    for (const [action, weight] of next) setWeight(action, weight)
    if (weightSumWarned) return
    let sum = 0
    for (const weight of weights.values()) sum += weight
    if (Math.abs(sum - 1) < 1e-3) return
    weightSumWarned = true
    console.warn(
      `[vrma] somme des poids = ${sum.toFixed(3)} au lieu de 1 — ` +
        `le squelette fond vers sa pose d'origine (bras en croix)`,
    )
  }

  /**
   * Amène `next` au poids 1 en fondu DEPUIS tout ce qui porte du poids. Jamais
   * depuis rien : c'est la règle qui empêche la somme des poids de passer sous 1,
   * donc le fondu vers la pose d'origine du squelette.
   * Un fondu encore en cours est ABANDONNÉ, pas empilé : ses poids de l'image
   * courante deviennent le point de départ du nouveau.
   */
  function fadeTo(next: AnimationAction, spec: Fade): void {
    if (activeAction === next) return
    const from = new Map(weights)
    // `paused` : un geste figé par clampWhenFinished redevient pilotable.
    next.paused = false
    next.enabled = true
    next.play()
    activeAction = next
    // Rien en place (premier socle) ou fondu nul : poids 1 tout de suite.
    if (from.size === 0 || spec.s <= 0) {
      fade = null
      poseWeights(fadeWeights(from, next, 1))
      return
    }
    fade = { to: next, from, elapsed: 0, spec }
    poseWeights(fadeWeights(from, next, 0))
  }

  /**
   * Avance le fondu en cours d'une image (appelé JUSTE AVANT mixer.update).
   *
   * LA COURBE NE TOUCHE QUE `p`, et c'est tout l'intérêt : `fadeWeights` rend
   * une somme de poids qui vaut `p + (1 − p)·Σfrom`, donc exactement 1 pour
   * N'IMPORTE QUEL `p` de [0, 1] dès que Σfrom vaut 1. Courber `p` ne peut donc
   * pas faire bouger l'invariant de la section — il n'y a rien à re-vérifier, la
   * démonstration de fadeWeights couvre déjà le cas.
   *
   * L'ordre de la boucle de rendu ne change pas non plus : base → fondu →
   * mixer → re-capture. Les poids de CETTE image sont posés avant que le mixer
   * n'accumule, exactement comme avant.
   *
   * `easeInOutQuad` part et arrive à vitesse nulle : c'est ce qui supprime la
   * marche de vitesse angulaire au début et à la fin du fondu — l'à-coup. Les
   * jonctions de LOCOMOTION restent linéaires (leur `ease` est false), parce
   * qu'Overte les a laissées linéaires et que la mesure lui donne raison.
   */
  function advanceFade(delta: number): void {
    if (!fade) return
    fade.elapsed += delta
    const p = Math.min(1, fade.elapsed / fade.spec.s)
    poseWeights(fadeWeights(fade.from, fade.to, fadeCurve(fade.spec, p)))
    if (p >= 1) fade = null
  }

  /**
   * Socle voulu maintenant. Ordre : ce que font les JAMBES prime sur ce que
   * disent les bras — marcher ou pivoter passe donc avant tout, puis une posture,
   * puis « parle », puis « écoute », puis l'idle.
   *
   * Parole AVANT écoute : si une réponse s'écrit pendant que l'utilisateur tape
   * déjà la suivante, c'est le personnage qui parle qu'il faut voir. Et l'allure
   * prime sur les deux : en scène vivante, marcher neutralise l'écoute
   * exactement comme elle neutralise la parole, sans une ligne de plus.
   */
  function desiredBase(): AnimationAction | null {
    if (gaitAction) return gaitAction
    if (postureAction) return postureAction
    if (talking && talkingAction) return talkingAction
    if (listening && listenAction) return listenAction
    return idleAction
  }

  /**
   * Réaligne le socle. Pendant un geste, le changement se fait EN COULISSE : le
   * geste garde l'écran, et son fondu de sortie ira sur le nouveau socle.
   */
  function syncBase(spec: Fade): void {
    const next = desiredBase()
    if (!next || next === baseAction) return
    const prev = baseAction
    baseAction = next
    if (activeAction === prev) fadeTo(next, spec)
  }

  // ── Domaine `world-` : ce que la scène vivante peut demander ──────────────

  /**
   * Dernière variante jouée PAR CLEF `world-` — la mémoire de pickAction,
   * appliquée au tirage du FICHIER. Sans elle, un tirage uniforme rejouait la
   * variante précédente une fois sur n : une sur trois pour `sit-nod` (le geste
   * assis du neutre ET du clic) ou `sit-clap`, une sur cinq pour `sit-idle`.
   * Les actions appartiennent au mixer courant : la table est vidée avec lui
   * (disposeAnimations).
   */
  const lastWorld = new Map<string, AnimationAction>()

  /**
   * Action d'un clip `world-<name>` réellement chargé, ou null. Chaque appel
   * est UN TIRAGE, mémorisé pour l'anti-répétition — le simple test de
   * présence passe par worldHas, qui ne tire rien.
   */
  function worldAction(name: string): AnimationAction | null {
    const action = pickAction(catalog?.world.get(name), lastWorld.get(name) ?? null)
    if (action) lastWorld.set(name, action)
    return action
  }

  /**
   * Un clip `world-<name>` a-t-il au moins un fichier réellement chargé ?
   * SANS tirage, et ce n'est pas un détail : le comportement consulte `has`
   * jusqu'à chaque image (l'état assis, entre autres). Tirer ici brûlerait un
   * aléa par image et écraserait la mémoire de worldAction.
   */
  function worldHas(name: string): boolean {
    return (catalog?.world.get(name) ?? []).some((url) => actions.has(url))
  }

  /**
   * Socle d'ALLURE (marche, pivot) : il remplace le socle courant tant qu'il est
   * posé, et `desiredBase` le fait primer sur tout le reste. null = rendre les
   * jambes au socle normal.
   *
   * `phase` pose le temps du clip À L'ENTRÉE, et c'est par là que tout le
   * contrat de raccord tient : un cycle de marche repris à une phase quelconque
   * tombe jusqu'à 46 cm de la pose d'arrêt, repris sur sa couture il tombe à 0.
   */
  function setGait(name: string | null, spec: Fade, phase?: number): void {
    const next = name ? asBase(worldAction(name)) : null
    if (next === gaitAction) return
    gaitAction = next
    if (next && phase !== undefined) {
      next.reset()
      next.time = phase
    }
    syncBase(spec)
  }

  /** Hauteur de hanches au repos du modèle (m) — l'unité de tout le mouvement. */
  function hipsRest(): number {
    const y = currentVrm?.humanoid.normalizedRestPose.hips?.position?.[1]
    return typeof y === 'number' && y > 0.1 ? y : 1
  }

  /**
   * Cap à prendre pour faire face à la caméra, vu du point (x, z) du sol.
   * Purement horizontal : le personnage ne lève pas la tête vers une caméra en
   * plongée, il se tourne. Caméra à la verticale (< 5 cm d'écart au sol) : on
   * garde le cap courant plutôt que d'en inventer un.
   */
  function cameraYawFrom(x: number, z: number): number {
    const dx = camera.position.x - x
    const dz = camera.position.z - z
    if (dx * dx + dz * dz < 0.0025) return avatarGroup.rotation.y
    return Math.atan2(dx, dz)
  }

  /**
   * Altitude du sol sous un point du MONDE. La carte du décor fait foi ; hors de
   * sa grille — ou sans analyse du tout — c'est le sol sous le personnage qui
   * répond, pas zéro : une cheville qui sort de la grille d'un centimètre ne doit
   * pas faire sauter la correction d'un coup.
   */
  function groundAt(x: number, z: number): number {
    return sceneMap?.floorAt(x, z) ?? bodyGround
  }

  /** Altitude du sol sous le personnage, tenue à jour par le comportement. */
  let bodyGround = 0

  /**
   * Le corps vient de SAUTER d'un point à un autre : la physique des cheveux
   * doit être purgée à la fin de l'image (cf. tick).
   *
   * Un springbone dont le groupe ne déclare pas de `center` est simulé en espace
   * MONDE : il garde d'une image à l'autre la position monde de sa pointe. Un
   * placement instantané — spawn dans une pièce, retour à l'accueil, arrivée
   * d'un nouveau modèle dans un groupe déjà déplacé — lui fait donc franchir
   * plusieurs mètres en une image, ce que la physique lit comme une vélocité
   * gigantesque : la chevelure part à l'horizontale et met une seconde à
   * retomber. 9 des 94 modèles du dossier sont dans ce cas ; les 85 autres
   * déclarent un center (leur physique tourne dans le repère d'un os) et ne
   * voient jamais le déplacement du corps.
   */
  let springSettle = false

  /** Le contrat que la scène offre au comportement (cf. wander.ts). */
  const wanderHost: WanderHost = {
    hips: hipsRest,
    place(x, y, z, yaw, ground) {
      // Verticale au ressort — debout seulement : assis, l'altitude est déjà
      // interpolée par le glissement d'assise (la re-lisser prendrait du
      // retard sur le clip), et un vrai saut (retour à l'accueil, changement
      // de décor) se téléporte au lieu de traîner une rampe de 15 cm.
      springPose.trans.set(x, y, z)
      const jump =
        Math.abs(y - avatarGroup.position.y) > 0.5 * hipsRest() ||
        Math.hypot(x - avatarGroup.position.x, z - avatarGroup.position.z) > 0.5 * hipsRest()
      if (footMode === 'reach' || jump) bodySpring.teleport(springPose)
      else bodySpring.update(springPose, frameDelta)
      if (jump) springSettle = true // même saut, même purge (cf. springSettle)
      avatarGroup.position.set(x, springPose.trans.y, z)
      avatarGroup.rotation.y = yaw
      bodyGround = ground
    },
    gait: setGait,
    gaitTime: () => (gaitAction ? gaitAction.time : -1),
    once(name, fadeIn, then, fadeThen, thenPhase) {
      playOnce(name, fadeIn, then, fadeThen, thenPhase)
    },
    has: worldHas,
    // La foulée est MESURÉE UNE FOIS PAR IMAGE dans la boucle de rendu, pas ici :
    // l'odométrie compare deux images consécutives, et un appelant qui la
    // consulterait deux fois (ou pas du tout) fausserait la comparaison.
    stride: (out) => {
      out.x = strideBuf.x
      out.z = strideBuf.z
      return strideOk
    },
    speaking: () => talking,
    camYaw: cameraYawFrom,
    userBusy: () => camGrabbed || performance.now() - camReleasedAt < USER_CAMERA_GRACE_MS,
    floorAt: (x, z) => sceneMap?.floorAt(x, z) ?? null,
    canStand: (x, z, radius, fromY) => sceneMap?.canStand(x, z, radius, fromY) ?? false,
    path: (fx, fz, tx, tz, radius) => sceneMap?.path(fx, fz, tx, tz, radius) ?? null,
    bodyRadius: () => sceneMap?.body.radius ?? 0.25,
    transitioning: () => onceThen !== null,
    onceProgress: () => {
      // Pendant une transition, l'écran est tenu par l'action à cycle unique
      // (fadeTo l'a promue activeAction) : son temps donne l'avancement.
      if (!onceThen || !activeAction) return 1
      const d = activeAction.getClip().duration
      return d > 0 ? Math.min(1, activeAction.time / d) : 1
    },
    interrupt(fade) {
      if (!onceThen) return
      onceThen = null
      baseAction = desiredBase()
      if (baseAction && activeAction !== baseAction) fadeTo(baseAction, fade)
    },
    feet: (mode) => {
      footMode = mode
    },
    seats: () => sceneMap?.seats ?? [],
    mapped: () => sceneMap !== null,
  }

  /**
   * Clip à cycle unique du domaine `world-` (une TRANSITION : départ, arrêt,
   * s'asseoir), suivi de `then`. La file est à un seul cran — une transition ne
   * se met jamais en attente d'une autre, elle est remplacée.
   */
  let onceThen: { name: string | null; fade: Fade; phase?: number } | null = null

  function playOnce(
    name: string,
    fadeIn: Fade,
    then: string | null,
    fadeThen: Fade,
    thenPhase?: number,
  ): void {
    const action = worldAction(name)
    if (!action) {
      // Clip absent : on saute la transition et on va droit à sa suite, plutôt
      // que de rester figé dans un état qui n'arrivera jamais.
      onceThen = null
      setGait(then, fadeIn, thenPhase)
      return
    }
    action.reset()
    action.setLoop(LoopOnce, 1)
    action.clampWhenFinished = true
    // L'allure courante cesse d'être le socle : c'est la transition qui tient
    // l'écran, et `onceThen` dit ce qui la suit.
    gaitAction = null
    onceThen = { name: then, fade: fadeThen, phase: thenPhase }
    fadeTo(action, fadeIn)
  }

  /**
   * Dernière variante jouée, PAR RÔLE — la mémoire de l'anti-répétition. Par
   * émotion et non globale : `happy` puis `sad` puis `happy` ne doit pas pouvoir
   * rejouer le même applaudissement, alors que le `sad` intercalé aurait effacé
   * une mémoire unique. Les actions appartiennent au mixer courant : la table est
   * vidée avec lui (disposeAnimations).
   */
  const lastGesture = new Map<Emotion, AnimationAction>()
  let lastReaction: AnimationAction | null = null

  /** Geste d'émotion : joué UNE fois, variante tirée à chaque déclenchement. */
  function playGesture(emotion: Emotion): void {
    if (!mixer) return
    // ASSIS, LE CORPS A SES PROPRES GESTES. Le socle assis est une allure du
    // domaine `world-` (world-sit-idle), donc `gaitAction` est posé : la garde
    // ci-dessous refusait TOUT geste, et la scène vivante passe 18 à 25 % de
    // son temps assise (mesuré sur les trois décors, 15 min de simulation
    // chacun) — l'émotion n'y était portée que par le visage. Le
    // comportement, lui, sait s'il est assis ET au repos, et il a la porte pour
    // ça (le canal des gestes d'assise) : on la lui laisse ouvrir.
    // Rendu false — debout, en marche, en pleine transition — rien ne change.
    if (wander?.emote(emotion)) return
    // Un geste monte à poids 1 sur TOUT le squelette (three n'a ni couche ni
    // masque d'os) : déclenché pendant un pivot, une marche, une posture assise
    // ou une TRANSITION (départ, assise…), il casserait les jambes net — et un
    // geste debout sur un personnage assis le ferait « sauter » de sa chaise.
    // Le VISAGE, lui, continue de s'appliquer — setEmotion écrit l'expression
    // avant d'arriver ici, et c'est ce qui porte l'émotion.
    if (gaitAction || onceThen) return
    const action = pickAction(catalog?.gestures.get(emotion), lastGesture.get(emotion) ?? null)
    if (!action) return // aucun fichier pour cette émotion : le visage suffit
    lastGesture.set(emotion, action)
    action.reset()
    action.setLoop(LoopOnce, 1)
    // clampWhenFinished est INDISPENSABLE, et le raisonnement inverse (« le fondu
    // de retour termine le geste, donc pas besoin de le figer ») est un piège :
    // sans lui, three exécute `enabled = false` PUIS dispatche 'finished' dans la
    // même instruction (AnimationAction, étiquette handle_stop), et _update
    // appelle _updateTime AVANT _updateWeight — qui rend 0 pour une action
    // désactivée. Le geste pesait donc DÉJÀ 0 quand le gestionnaire lançait son
    // fondu de retour : somme des poids nulle, et PropertyMixer.apply remélangeait
    // à 100 % vers la pose d'origine du squelette. Le corps claquait sur une pose
    // neutre en une image, puis remontait depuis là.
    // Figé (`paused = true`) sur sa dernière image à poids 1, le geste participe
    // au contraire à son propre fondu de sortie. Le `reset()` ci-dessus lève le
    // `paused` au déclenchement suivant — rien d'autre à changer.
    action.clampWhenFinished = true
    // Un geste pendant un geste enchaîne depuis l'action COURANTE, pas depuis le
    // socle — sinon la transition passerait par une pose que personne ne voit.
    fadeTo(action, GESTURE_IN)
  }

  /**
   * Acquiescement au clic sur le personnage : un hochement de tête, joué une
   * fois comme un geste d'émotion. Mêmes gardes que playGesture — assis, c'est
   * le comportement qui répond (hochements assis) ; debout, jamais par-dessus
   * une allure, une posture ou une transition.
   */
  function playReaction(): void {
    if (!mixer) return
    if (wander?.react()) return
    if (gaitAction || onceThen) return
    const action = pickAction(catalog?.reactions, lastReaction)
    if (!action) return
    lastReaction = action
    action.reset()
    action.setLoop(LoopOnce, 1)
    action.clampWhenFinished = true
    fadeTo(action, GESTURE_IN)
  }

  /** Jette mixer et actions : les clips sont liés à CETTE instance de VRM. */
  function disposeAnimations(): void {
    if (mixer) {
      mixer.stopAllAction()
      // uncacheRoot rend à chaque os la valeur qu'il avait à l'activation de la
      // première action, c'est-à-dire notre pose de repos.
      if (currentVrm) mixer.uncacheRoot(currentVrm.scene)
    }
    mixer = null
    actions.clear()
    // Les variantes mémorisées par l'anti-répétition appartenaient à CE mixer.
    lastGesture.clear()
    lastReaction = null
    lastListen = null
    lastWorld.clear()
    idleAction = null
    talkingAction = null
    listenAction = null
    postureAction = null
    gaitAction = null
    onceThen = null
    baseAction = null
    activeAction = null
    // Le livre des poids ne survit pas aux actions qu'il décrit.
    weights.clear()
    fade = null
    // Plus de mixer : un recadrage encore en attente n'aurait plus rien à
    // rattraper (le squelette repart de la pose de repos).
    reframePending = false
  }

  /**
   * Construit le mixer et les actions du modèle qui vient d'être chargé. Le
   * VRMAnimation est mutualisé (cache module) mais le clip, lui, est reconstruit
   * pour ce VRM précis — et jeté avec lui.
   * Chaque reprise après un `await` revérifie tout : changer de personnage ou
   * éteindre les animations pendant le téléchargement des .vrma ne doit rien
   * poser sur le modèle en place. Le test qui fait foi est `currentVrm !== vrm` —
   * le modèle AFFICHÉ, et non `loadGeneration`, qu'un chargement RATÉ incrémente
   * lui aussi tout en laissant le modèle précédent à l'écran : ce compteur privait
   * alors d'animations un avatar parfaitement en place, jusqu'au prochain
   * changement de personnage.
   */
  async function buildAnimations(vrm: VRM): Promise<void> {
    if (!animationsEnabled) return
    const fam = animFamily
    const cat = await loadCatalog(fam)
    if (!animationsEnabled || disposed || currentVrm !== vrm) return
    // La famille a pu changer pendant que la liste arrivait (l'utilisateur passe
    // d'un personnage à l'autre) : ce catalogue-là n'est plus celui qu'on veut,
    // et un autre buildAnimations est déjà en vol pour le bon.
    if (fam !== animFamily) return
    catalog = cat
    if (cat.idle.length === 0) return // pas de socle : pas de mixer du tout
    // Le socle est tiré au hasard UNE FOIS par chargement de modèle ; les gestes
    // le sont à chaque déclenchement, donc toutes leurs variantes sont chargées.
    const idleUrl = pickOne(cat.idle)
    const urls = [
      idleUrl,
      ...cat.talking,
      // Les socles d'écoute partent avec le reste du face à face : ils pèsent
      // 0,70 Mo pour la famille rb, et RIEN pour Overte, qui n'en a aucun.
      ...cat.listening,
      ...[...cat.gestures.values()].flat(),
      ...[...cat.postures.values()].flat(),
      ...worldUrlsNeeded(cat, interactive),
    ]
    const loaded = await Promise.all(urls.map(async (url) => [url, await loadVrmAnimation(url)] as const))
    if (!animationsEnabled || disposed || currentVrm !== vrm) return
    const clips = new Map<string, AnimationClip>()
    for (const [url, animation] of loaded) {
      if (animation) clips.set(url, createVRMAnimationClip(animation, vrm))
    }
    if (!clips.has(idleUrl)) return // socle illisible : repli complet, comme s'il manquait
    disposeAnimations()
    mixer = new AnimationMixer(vrm.scene)
    mixer.addEventListener('finished', (e) => {
      // Seuls les clips à cycle unique s'achèvent (les socles bouclent sans fin).
      // Si un AUTRE clip a pris la main entre-temps, c'est à lui de rendre l'écran.
      if (e.action !== activeAction) return
      // Une TRANSITION du domaine `world-` : sa suite est déjà décidée. On
      // recalcule le socle À LA MAIN plutôt que par syncBase, qui ne fond que
      // si l'écran est tenu par l'ancien socle — or il est tenu par la
      // transition qui vient de s'achever.
      if (onceThen) {
        const step = onceThen
        onceThen = null
        gaitAction = step.name ? asBase(worldAction(step.name)) : null
        if (gaitAction && step.phase !== undefined) {
          gaitAction.reset()
          gaitAction.time = step.phase
        }
        baseAction = desiredBase()
        if (baseAction) fadeTo(baseAction, step.fade)
        return
      }
      // Un geste d'émotion rend l'écran au socle.
      if (baseAction) fadeTo(baseAction, GESTURE_OUT)
    })
    for (const [url, clip] of clips) actions.set(url, mixer.clipAction(clip))
    idleAction = asBase(actions.get(idleUrl) ?? null)
    talkingAction = asBase(pickAction(cat.talking))
    // Écoute déjà en cours au moment où le modèle arrive (l'utilisateur tape
    // pendant le chargement) : le socle est posé tout de suite, comme la posture.
    listenAction = listening ? asBase(pickAction(cat.listening)) : null
    lastListen = listenAction
    postureAction = asBase(postureName ? pickAction(cat.postures.get(postureName)) : null)
    syncBase(NO_FADE)
    // Le socle est posé mais PAS ENCORE ÉVALUÉ : le squelette est toujours dans la
    // pose de repos, recadrer maintenant ne gagnerait rien. C'est la boucle de
    // rendu qui s'en charge, une fois le mixer passé (cf. reframeAfterMixer).
    reframePending = true
  }

  /**
   * CORRECTIF du cadrage initial. frameCamera lit la position de la tête, et
   * loadModel l'appelle AVANT que les .vrma soient là (volontairement : l'avatar
   * ne doit pas attendre le téléchargement des animations). Si la stance de
   * `idle.vrma` ne place pas la tête à la même hauteur que la pose de repos, le
   * premier cadrage est légèrement décalé et il fallait un double-clic pour le
   * rattraper. On recadre donc une fois le socle réellement appliqué.
   *
   * DEUX GARDE-FOUS, parce qu'écraser un cadrage choisi serait bien pire que le
   * décalage qu'on corrige :
   * - `defaultFramed` : la caméra tient encore le cadrage calculé par frameCamera.
   *   Faux si l'UI a posé une vue sauvegardée (setView, appelé par applyViewFor
   *   quand UiPrefs.views contient une entrée pour ce personnage ET ce mode), et
   *   faux dès que l'utilisateur commence à manipuler la scène ('start').
   * - l'appel se fait dans la boucle de rendu, donc dans une macrotâche : le
   *   `.then(loadModel)` de l'UI, qui choisit entre setView et resetView, a
   *   forcément déjà été exécuté. Aucune course possible entre les deux.
   *
   * Rien n'est notifié à l'UI : ce recadrage ne change pas l'état « pas de vue
   * sauvegardée », il ne fait que corriger le défaut lui-même.
   */
  function reframeAfterMixer(): void {
    reframePending = false
    if (defaultFramed && lastFrame) frameCamera(lastFrame.vrm, lastFrame.h)
  }

  // Normalisation d'échelle : un VRM exporté en centimètres (ou en unités
  // minuscules) est irrécupérable avec un cadrage à constantes absolues.
  // Hauteur hors [0.5, 3] m → remise à ~1.6 m. Retourne la hauteur effective.
  function normalizeScale(vrm: VRM): number {
    const box = new Box3().setFromObject(vrm.scene)
    const rawHeight = Math.max(box.max.y - box.min.y, 1e-6)
    if (rawHeight >= 0.5 && rawHeight <= 3) return rawHeight // modèle normal : intact
    console.warn(
      `[vrm] model height ${rawHeight.toFixed(3)} m is out of the [0.5, 3] range — ` +
        `rescaling by ${(1.6 / rawHeight).toFixed(5)} to a 1.6 m height`,
    )
    // multiplyScalar (et non setScalar) : correct même si la racine a déjà une
    // échelle ≠ 1, puisque rawHeight la contient déjà.
    vrm.scene.scale.multiplyScalar(1.6 / rawHeight)
    vrm.scene.updateMatrixWorld(true)
    return 1.6
  }

  /**
   * Décalage 'left' par DÉCENTREMENT D'OBJECTIF (setViewOffset), jamais en
   * déplaçant la caméra : une caméra décalée latéralement voit l'avatar
   * hors de son axe optique, donc légèrement de biais — le regard semblait
   * fuir vers la gauche en mode desktop alors qu'il est droit en VN. Avec le
   * décentrement, la caméra reste PILE en face (visage identique au VN) et
   * c'est le cadre qui glisse, comme un objectif à bascule d'architecte.
   * Le quart de la colonne de chat : viser le centre exact de la zone hors
   * panneau déportait trop l'avatar — retour visuel utilisateur.
   */
  function applyViewOffset(): void {
    const w = Math.max(1, container.clientWidth)
    const h = Math.max(1, container.clientHeight)
    const off = frameMode === 'left' && w >= CHAT_PANEL_MIN_W ? Math.round(panelWidth / 4) : 0
    // setViewOffset/clearViewOffset recalculent la matrice de projection.
    const cam = camera as unknown as ViewOffsetCamera
    if (off > 0) cam.setViewOffset(w, h, off, 0, w, h)
    else cam.clearViewOffset()
  }

  // Cadrage buste + tête : cible légèrement sous la tête, caméra DE FACE dans
  // tous les modes (le décalage desktop est un décentrement, cf. applyViewOffset).
  // Tout est dérivé de la hauteur effective `h` : pour h = 1.6 m les bornes
  // valent exactement les anciennes constantes (0.6, 4) — rendu inchangé pour
  // les modèles normaux.
  function frameCamera(vrm: VRM, h: number): void {
    scene.updateMatrixWorld(true)
    const head = vrm.humanoid.getNormalizedBoneNode('head')
    const headPos = new Vector3(0, h * (1.35 / 1.6), 0) // repli si modèle sans os "head"
    if (head) head.getWorldPosition(headPos)
    // La distance : celle que le sidecar du décor demande (frameDistance), sinon
    // l'automatique dérivée de la tête. Les deux passent sous le MÊME clamp de
    // plausibilité en h — un modèle minuscule garde un cadrage à sa taille, quel
    // que soit le décor derrière lui.
    const desired = envFrameDist ?? headPos.y * 1.4
    const distance = Math.min(2.5 * h, Math.max(0.375 * h, desired))
    frameDist = distance // AVANT applyEnvLimits : c'est le plancher du clamp de recul
    // Recul EFFECTIF. Le cadrage par défaut se pose sur l'axe +Z de la tête sans
    // aucun test de dégagement : en scène vivante, où il suit le personnage
    // (`headPos.z` plus bas), il finit derrière le mur du fond dès que celui-ci a
    // avancé. Mesuré sur cozy-loft-room : cadrage à 1,89 m contre 2,20 m de
    // dégagement mesuré sur l'axe +Z et un mur à z = 2,415 — au-delà du mur dès
    // z > 0,31 m, sur une bande praticable qui va jusqu'à z = 2,3 m. Le
    // double-clic et le bouton rendaient alors un écran noir, donc « rien ».
    //
    // La règle : la caméra ne recule jamais, en z, PLUS LOIN que là où le cadrage
    // du point d'accueil l'avait posée — un recul qui, lui, a toujours été jugé
    // bon. Le dégagement mesuré de la pièce (envPullback) peut relever ce
    // plafond, jamais l'abaisser : c'est déjà la doctrine d'applyEnvLimits, qui
    // ne descend pas maxDistance sous frameDist.
    //
    // `advance` est lu sur avatarGroup (le déplacement du personnage dans la
    // pièce, nul au point d'accueil), pas sur la tête (dont la stance d'idle
    // avance de quelques millimètres) : à l'accueil, sans carte et scène vivante
    // éteinte, `framed` vaut `distance` — comme aujourd'hui, à l'octet près.
    const advance = interactive ? Math.max(0, avatarGroup.position.z) : 0
    const framed =
      advance > 0
        ? Math.min(distance, Math.max(0.375 * h, Math.max(distance, envPullback() ?? 0) - advance))
        : distance
    // Hauteur de l'objectif, et abscisse d'où il recule. Le `z` de la caméra est
    // DEVANT la tête, pas à une abscisse absolue : sans ça, un double-clic ne
    // retrouverait plus le personnage dès qu'il s'écarte du point d'accueil. Le
    // ternaire est nécessaire et non cosmétique — `headPos.z` ne vaut pas
    // exactement 0 (la stance d'idle.vrma avance la tête de quelques
    // millimètres), et l'écrire sans garde changerait la distance de cadrage par
    // défaut de TOUS les modèles, scène vivante éteinte comprise.
    const eyeY = headPos.y - 0.12
    const baseZ = interactive ? headPos.z : 0
    // Et le DERNIER mot sur le recul : le dégagement réel, sondé à la hauteur
    // réelle de l'objectif (cf. reculDegage). Rien au-dessus n'a jamais regardé
    // cette hauteur-là — ni la rose de la carte, mesurée à 1,30 m fixe, ni la
    // formule, qui ne connaît que le modèle. Le plancher de plausibilité tient :
    // un obstacle collé au personnage rapproche l'objectif jusqu'à 0,375 h et
    // pas plus près, sinon un décor mal fichu rendrait un gros plan de narine.
    const clearance = reculDegage(headPos.x, eyeY, baseZ)
    const recul =
      clearance === null ? framed : Math.min(framed, Math.max(0.375 * h, clearance - CAM_PROBE_MARGIN))
    // AVANT d'écrire la pose : sinon le reliquat du geste précédent s'applique
    // PAR-DESSUS le cadrage qu'on vient de poser (cf. flushDamping).
    flushDamping()
    controls.target.set(headPos.x, eyeY, headPos.z)
    camera.position.set(headPos.x, eyeY, baseZ + recul)
    controls.minDistance = 0.3 * h
    applyEnvLimits(h)
    applyViewOffset()
    camera.updateProjectionMatrix()
    controls.update()
    controls.enableDamping = true // réarmé après l'écriture (cf. flushDamping)
    defaultFramed = true
  }

  // Sonde de cadrage : deux vecteurs de module, jamais réalloués (frameCamera
  // passe à chaque chargement, à chaque double-clic et à chaque recadrage).
  const probeOrigin = new Vector3()
  const probeDir = new Vector3(0, 0, 1)

  /**
   * Dégagement RÉEL sur l'axe de recul, à la hauteur RÉELLE de l'objectif.
   * Rend la distance du premier obstacle, ou `null` quand il n'y a rien à dire.
   *
   * POURQUOI ELLE EXISTE. Le cadrage par défaut pose l'objectif à la hauteur de
   * la tête du modèle, moins 12 cm. Tout ce qui décidait du recul jusqu'ici
   * ignorait cette hauteur :
   * - la rose de la carte (`camera.clearance`) est sondée par l'analyse à une
   *   hauteur d'œil FIXE de 1,30 m (cf. server/lib/envScene, EYE_HEIGHT) ;
   * - la formule (`headPos.y * 1,4`) et le `frameDistance` du sidecar ne
   *   connaissent que le modèle, ou que le décor, jamais les deux ensemble.
   *
   * Or la hauteur d'objectif VARIE de 20 % d'un modèle à l'autre : 1,243 m
   * pour un personnage de 1,82 m, 1,033 m pour un de 1,39 m. Mesuré sur
   * lowpoly-restaurant, dont les dossiers de chaise culminent à 1,030 m : à
   * 1,243 m ils sont 21 cm sous l'objectif et le plan large du sidecar (3,20 m)
   * est superbe ; à 1,033 m ils l'affleurent, et les mêmes 3,20 m posaient la
   * lentille 35 cm DERRIÈRE un dossier — moitié basse du cadre d'accueil en
   * masse noire. Ce n'est pas le `frameDistance` qui a tort, c'est le fait de
   * n'avoir jamais regardé à la bonne hauteur.
   *
   * POURQUOI UNE BULLE ET PAS UN RAYON. Mesuré aussi : le rayon d'axe passait
   * 3 mm AU-DESSUS du dossier et annonçait 11 m de dégagement. Un objectif n'est
   * pas un point — il lui faut du vide autour, sans quoi ce qui l'effleure
   * remplit le cadre. La bulle est balayée sur +Z ; sa taille et sa marge sont
   * documentées avec leurs constantes.
   *
   * POURQUOI ICI, ET PAS DANS L'ANALYSE. Le serveur ne connaît pas le modèle :
   * il faudrait qu'il sonde toutes les hauteurs, ou qu'il devine. Le CLIENT, lui,
   * a les deux au moment du cadrage — la hauteur d'objectif qu'il vient de
   * calculer, et l'arbre du décor (cf. scene/bvh) dont un rayon coûte 0,004 ms.
   * Cinq rayons, une fois par cadrage : le tick n'est pas touché.
   *
   * CE QU'ELLE NE REMPLACE PAS. La rose garde le clamp du zoom arrière
   * (`applyEnvLimits`), qui borne une ORBITE — l'utilisateur tourne autour du
   * personnage, et un dégagement sondé sur le seul axe +Z ne dirait rien des
   * quinze autres directions. La sonde ne parle que du CADRAGE PAR DÉFAUT, qui
   * est toujours de face.
   *
   * CE QU'ELLE NE VOIT PAS, et pourquoi c'est sans danger : `envBvh.rest` — les
   * Line/Points/Sprite et la géométrie que l'arbre refuse d'indexer — n'est pas
   * interrogé. `viser` les interroge parce qu'un clic doit rencontrer tout ce
   * que three rencontre ; un dégagement, non. Le seuil de `Raycaster.params.Line`
   * vaut 1 mètre par défaut : les segments décoratifs de lowpoly-restaurant
   * auraient arrêté la caméra à un mètre d'un trait sans épaisseur. Un obstacle
   * manqué laisse le comportement d'avant, jamais moins.
   *
   * CYCLE DE VIE. `envBvh` n'existe qu'après le chargement du décor — mais
   * frameCamera est rejoué à ce moment-là (loadEnvironment, même garde que
   * reframeAfterMixer), et rejoué encore au déchargement. Sans arbre : `null`,
   * et le cadrage est exactement celui d'avant, au millimètre.
   */
  function reculDegage(x: number, y: number, z: number): number | null {
    if (!envBvh) return null
    let first = Infinity
    for (const [rx, ry] of CAM_PROBE_RIM) {
      probeOrigin.set(x + rx * CAM_PROBE_RADIUS, y + ry * CAM_PROBE_RADIUS, z)
      // `far = first` : chaque jante élague sur la meilleure déjà trouvée, le
      // parcours de l'arbre s'arrête donc plus tôt à chaque rayon de plus.
      const hit = raycastFirst(envBvh, probeOrigin, probeDir, estOpaqueAuClic, 0, first)
      if (hit) first = hit.distance
    }
    return first === Infinity ? null : first
  }

  /**
   * Recul maximal autorisé par la PIÈCE, lu dans la rose de dégagement de la
   * carte : min des secteurs ±45° autour de +Z (cf. CAM_ROSE_FRONT), plus la
   * marge de résolution de la rose. null = pas de carte, la formule seule décide.
   */
  function envPullback(): number | null {
    const rose = sceneMap?.camClearance
    if (!rose) return null
    let free = Infinity
    for (const k of CAM_ROSE_FRONT) free = Math.min(free, rose[k])
    return free + CAM_WALL_MARGIN
  }

  /**
   * Plan lointain et recul maximum. SANS décor : exactement les valeurs
   * historiques (15 h et 3 h) — zéro régression. AVEC décor : de quoi voir la
   * pièce entière sans la clipper, et de quoi s'en éloigner un peu — mais jamais
   * SORTIR de la pièce. La formule historique (rayon de la boîte englobante) ment
   * dès que le .glb porte un plan de fond lointain : anime-classroom déclare un
   * rayon de 15,9 m pour 5,4 m de clairance réelle, et le recul plein remplissait
   * le cadre avec le DOS du mur (mesuré — aplat uni, rien d'identifiable). Quand
   * la carte du décor est là, le recul s'arrête donc où la pièce s'arrête
   * (envPullback), sans jamais descendre sous la distance du cadrage par défaut :
   * le double-clic reste toujours atteignable. Sans carte, formule intacte.
   * Appelée des DEUX côtés (frameCamera et loadEnvironment) : le modèle et le
   * décor sont chargés par deux effets React indépendants, l'ordre n'est pas
   * garanti — sinon un décor arrivé après le modèle serait tronqué à l'écran.
   */
  function applyEnvLimits(h = lastFrame?.h ?? 1.6): void {
    if (envMetrics) {
      camera.far = Math.max(15 * h, 4 * envMetrics.radius)
      const formula = Math.min(8 * h, Math.max(3 * h, envMetrics.radius))
      const pullback = envPullback()
      // 1,4 h majore la distance que frameCamera peut produire pour un modèle
      // debout à l'origine (headPos.y ≤ h) : plancher transitoire d'avant le
      // premier cadrage — dès que frameCamera passe, frameDist fait foi.
      controls.maxDistance =
        pullback === null ? formula : Math.min(formula, Math.max(pullback, frameDist ?? 1.4 * h))
    } else {
      camera.far = 15 * h
      controls.maxDistance = 3 * h
    }
    camera.updateProjectionMatrix()
  }

  /**
   * Régime d'éclairage : l'avatar seul dans le vide, ou posé dans une pièce.
   *
   * Les deux régimes sont CONSERVÉS tels quels : ils parlent bien de l'AVATAR, qui
   * est en MToon et que ces lumières éclairent réellement — surexposé devant une
   * pièce, il « décollerait » du fond. C'est le seul rôle qui leur reste.
   *
   * En revanche l'exposition du sidecar n'y touche PLUS (elle est passée sur les
   * matériaux du décor, cf. applyEnvMaterials), pour deux raisons :
   * 1. elle décrit la clarté des TEXTURES DE LA PIÈCE ; en faire dépendre
   *    l'éclairage du personnage est une confusion de genres — sur les deux décors
   *    unlit, cela n'éclaircissait que l'avatar, jamais le décor visé ;
   * 2. sur cozy-loft-room, le seul décor réellement éclairé, la garder ici
   *    appliquerait désormais la correction DEUX FOIS (lumières × albédo).
   */
  function applyLightRegime(): void {
    const lit = envRoot !== null
    keyLight.intensity = lit ? KEY_LIGHT_ENV : KEY_LIGHT_SOLO
    fillLight.intensity = lit ? FILL_LIGHT_ENV : FILL_LIGHT_SOLO
  }

  function unloadEnvironment(): void {
    if (envRoot) {
      envGroup.remove(envRoot)
      // deepDispose est générique (géométries, matériaux, textures) : il vaut
      // pour un décor comme pour un VRM. Sans lui, changer de décor deux fois
      // laisse deux pièces en VRAM.
      // Il lit `mesh.material` AU MOMENT du déchargement : ce sont donc bien les
      // clones exposés qu'il libère, textures comprises. Les originaux, remplacés
      // avant le premier rendu, n'ont jamais rien alloué sur le GPU et partagent
      // leurs textures avec les clones — libérées avec eux.
      VRMUtils.deepDispose(envRoot)
      envRoot = null
    }
    envBvh = null // avant tout le reste : il pointe des tampons qu'on vient de libérer
    envMetrics = null
    sceneMap = null
    envFrameDist = null
    // La pièce qui portait la marque n'existe plus : l'anneau flotterait dans
    // le vide, ou dans le mur de la suivante.
    clickMarks.clear()
    // Le personnage rentre chez lui : la pièce où il s'était déplacé n'existe
    // plus, et le laisser à ses coordonnées d'avant le poserait au hasard dans
    // la suivante — ou dans le vide s'il n'y en a pas.
    wander?.home()
    // Téléportation = discontinuité : l'historique de frontière de twist des
    // limites articulaires ne doit pas contaminer la pose suivante
    // (l'équivalent du clearIKJointLimitHistory d'Overte).
    jointLimits?.clearHistory()
    // Dégel de la branche décor (le gel est posé par loadEnvironment après la
    // fusion) : les remises à zéro ci-dessous doivent recomposer la matrice, et
    // le prochain décor repart d'un groupe qui vit normalement.
    envGroup.matrixAutoUpdate = true
    envGroup.matrixWorldAutoUpdate = true
    envGroup.position.set(0, 0, 0)
    envGroup.rotation.set(0, 0, 0)
    envGroup.scale.setScalar(1)
    envGroup.updateMatrixWorld(true)
    applyLightRegime()
    applyEnvLimits()
    // Le décor emportait peut-être sa distance de cadrage : si la caméra tenait
    // encore le cadrage par défaut (et lui seul — même garde que
    // reframeAfterMixer, une vue posée ou touchée par l'utilisateur est
    // sacrée), elle reprend celui du vide. Sous dispose(), lastFrame est déjà
    // null : aucun recadrage fantôme.
    if (defaultFramed && lastFrame) frameCamera(lastFrame.vrm, lastFrame.h)
  }

  /**
   * Place le décor : échelle, orientation, calage au sol et point d'accueil.
   * Sans sidecar, l'ajustement est calqué sur normalizeScale — une hauteur
   * plausible est laissée intacte, une hauteur absurde (décor exporté en
   * centimètres) est ramenée à ~2,6 m — et le plancher vient à y = 0, là où
   * l'avatar a les pieds.
   *
   * `autoSpawn` est le point d'accueil que l'ANALYSE a calculé pour ce décor
   * (`placement.spawnAuto` du `.scene.json`), quand l'origine du modèle n'en
   * était pas un — un quai posé au-dessus de sa voie, par exemple. L'ordre est
   * sidecar > calculé > origine : la parole de l'auteur d'abord, le calage
   * automatique ensuite, et le comportement historique s'il n'y a ni l'un ni
   * l'autre. Rien à convertir, les deux se comptent dans le même repère.
   */
  function fitEnvironment(
    root: Object3D,
    placement: EnvPlacement,
    autoSpawn: readonly [number, number, number] | null,
  ): void {
    envGroup.position.set(0, 0, 0)
    envGroup.rotation.set(0, (placement.rotationY ?? 0) * DEG2RAD, 0)
    envGroup.scale.setScalar(placement.scale ?? 1)
    envGroup.updateMatrixWorld(true)
    let box = new Box3().setFromObject(root)
    const rawHeight = Math.max(box.getSize(new Vector3()).y, 1e-6)
    // Une échelle donnée dans le sidecar est la PAROLE de l'auteur : on ne la
    // corrige jamais. L'ajustement automatique ne concerne que les décors muets.
    if (placement.scale === undefined && (rawHeight < ENV_MIN_HEIGHT || rawHeight > ENV_MAX_HEIGHT)) {
      console.warn(
        `[env] environment height ${rawHeight.toFixed(3)} m is out of the ` +
          `[${ENV_MIN_HEIGHT}, ${ENV_MAX_HEIGHT}] range — rescaling by ` +
          `${(ENV_TARGET_HEIGHT / rawHeight).toFixed(5)} to a ${ENV_TARGET_HEIGHT} m height`,
      )
      envGroup.scale.multiplyScalar(ENV_TARGET_HEIGHT / rawHeight)
      envGroup.updateMatrixWorld(true)
      box = new Box3().setFromObject(root)
    }
    const size = box.getSize(new Vector3())
    // Le décor se déplace, jamais l'avatar (qui reste à l'origine du monde) :
    // amener le point d'accueil sous ses pieds, c'est reculer la pièce d'autant.
    // Le y du spawn se compte DEPUIS LE SOL du décor (une estrade à 1,2 m), ce qui
    // laisse le calage automatique faire son travail dans le cas courant. Un décor
    // « skybox » dont la boîte englobante ment (sol infini, min.y à −500) se
    // rattrape justement par ce spawn.
    const [sx, sy, sz] = placement.spawn ?? autoSpawn ?? [0, 0, 0]
    envGroup.position.set(-sx, -(box.min.y + sy), -sz)
    envMetrics = { radius: Math.max(size.length() / 2, 0.5), height: Math.max(size.y, 0.5) }
  }

  /**
   * Charge un décor .glb dans envGroup (url '' = décharge le décor courant).
   * Rend le diagnostic de placement du décor posé — `null` quand il n'y a rien
   * à dire, ce qui est le cas normal.
   */
  async function loadEnvironment(url: string): Promise<EnvNotice | null> {
    const generation = ++envGeneration
    if (!url) {
      unloadEnvironment()
      return null
    }
    try {
      // Le sidecar part en même temps que le .glb : il est minuscule, et son
      // absence (le cas normal) ne coûte rien de plus qu'un 404. La CARTE
      // (`<décor>.scene.json`) part avec eux : elle n'est pas encore là quand
      // l'analyse tourne, et ce n'est pas une panne — le décor est simplement un
      // fond en attendant qu'elle arrive.
      const [gltf, placement, map] = await Promise.all([
        envLoader.loadAsync(url),
        fetchPlacement(url),
        fetchSceneMap(url),
      ])
      if (generation !== envGeneration || disposed) {
        // Un loadEnvironment plus récent (ou dispose) est passé entre-temps.
        VRMUtils.deepDispose(gltf.scene)
        return null
      }
      unloadEnvironment()
      envRoot = gltf.scene
      // Réglages de matériaux AVANT l'ajout à la scène : les clones sont en
      // place dès la première image, jamais un éclair à la couleur d'origine.
      applyEnvMaterials(envRoot, placement)
      envGroup.add(envRoot)
      // La carte porte le point d'accueil calculé par l'analyse : il ne sert
      // QUE si le sidecar n'en donne pas (cf. fitEnvironment). Carte absente
      // (analyse pas encore prête) : le décor se pose comme il l'a toujours
      // fait, et le rechargement qui suivra l'analyse le recalera.
      fitEnvironment(envRoot, placement, map?.spawnAuto ?? null)
      addEnvBackdrops(envRoot, placement.backdrop)
      // Fusion des opaques par matériau, puis GEL de toute la branche décor :
      // matrices monde recalculées une dernière fois (le placement de
      // fitEnvironment est final), et le parcours par image de
      // scene.updateMatrixWorld s'arrête désormais À envGroup — geler envRoot
      // seul ne suffirait pas, l'updateMatrix automatique d'envGroup relèverait
      // matrixWorldNeedsUpdate à chaque image et le `force` en cascade
      // redescendrait dans les centaines de nœuds du décor. Dégel symétrique
      // dans unloadEnvironment. Tout ce bloc est synchrone : aucune image ne
      // part entre l'ajout du décor et sa fusion.
      mergeEnvironment(envRoot)
      envGroup.updateMatrixWorld(true)
      envGroup.matrixAutoUpdate = false
      envGroup.matrixWorldAutoUpdate = false
      // L'arbre du décor, dans le MÊME bloc synchrone et juste après le gel :
      // il fige les matrices monde telles qu'elles viennent d'être arrêtées, et
      // plus rien ne les touchera. 18 à 180 ms selon le décor, payés une fois,
      // à la suite d'un chargement réseau de plusieurs mégaoctets — et jamais
      // dans le tick. En échange, viser() passe de 12,9 ms à 0,004 ms au 95e
      // centile sur le pire décor (cf. devtools/bench-raycast.mjs).
      envBvh = buildEnvBvh(envRoot)
      // APRÈS unloadEnvironment, qui remet la carte à null et ramène le
      // personnage chez lui : sinon la carte du nouveau décor serait effacée
      // aussitôt posée.
      sceneMap = map
      envFrameDist = placement.frameDistance ?? null
      applyLightRegime()
      applyEnvLimits()
      // Le décor et le modèle arrivent par deux effets indépendants : si le
      // cadrage par défaut est en place (et rien d'autre — même garde que
      // reframeAfterMixer), il est recalculé AVEC le décor, donc avec sa
      // frameDistance. Sans elle, ce recadrage rend la même caméra qu'avant,
      // au millimètre : le cas courant ne bouge pas.
      if (defaultFramed && lastFrame) frameCamera(lastFrame.vrm, lastFrame.h)
      // Et le dernier mot sur ce placement : le décor est posé, la carte le
      // décrit tel qu'il vient d'être posé — s'il reste quelque chose qui cloche
      // (un sidecar `spawn` mal réglé, un décor où l'analyse n'a trouvé nulle
      // part où poser quelqu'un), c'est maintenant qu'on peut le dire.
      const trouble = map ? placementTrouble(map) : null
      if (!trouble) return null
      return {
        name: decodeURIComponent((url.split('/').pop() ?? url).replace(/\.(glb|gltf)$/i, '')),
        ground: trouble.ground,
        blind: trouble.blind,
        outside: trouble.outside,
      }
    } catch (e) {
      console.error('[env]', e)
      // Décor illisible : retirer celui d'AVANT. Sans ça, le bandeau d'erreur
      // s'affichait mais la pièce du personnage précédent restait derrière le
      // nouvel avatar, avec le placement et l'exposition de l'ancien décor.
      // La garde de génération est indispensable : un loadEnvironment plus récent
      // a peut-être déjà installé son décor pendant qu'on échouait.
      if (generation === envGeneration && !disposed) unloadEnvironment()
      throw compressionError(e) ?? e // l'UI affiche l'erreur
    }
  }

  async function loadModel(url: string): Promise<void> {
    const generation = ++loadGeneration
    if (!url) {
      unloadCurrent() // scène vide : OK
      return
    }
    try {
      const gltf = await loader.loadAsync(url)
      const vrm = gltf.userData.vrm as VRM | undefined
      if (!vrm) {
        // Un .glb quelconque posé comme modèle de personnage : la scène est déjà
        // parsée, elle se libère comme les deux autres sorties de loadModel.
        VRMUtils.deepDispose(gltf.scene)
        throw new Error(translate('vrmNoData', { file: url.split('/').pop() ?? url }))
      }
      if (generation !== loadGeneration || disposed) {
        // Un loadModel plus récent (ou dispose) est passé entre-temps.
        VRMUtils.deepDispose(vrm.scene)
        return
      }
      VRMUtils.removeUnnecessaryVertices(gltf.scene)
      VRMUtils.combineSkeletons(gltf.scene)
      VRMUtils.rotateVRM0(vrm) // modèles VRM 0.x : regardent +Z, on les retourne
      unloadCurrent()
      applyRestPose(vrm)
      addLookAtProxy(vrm)
      avatarGroup.add(vrm.scene)
      // Les springbones ont pris leur état initial pendant le chargement, modèle
      // à l'origine ; le groupe qui les accueille, lui, est peut-être au fond de
      // la pièce. Même saut que les autres, même purge.
      springSettle = true
      currentVrm = vrm
      applyGaze()
      idle.reset()
      gaze.reset()
      idle.setExpressionTable(resolveExpressions(vrm.expressionManager))
      const height = normalizeScale(vrm)
      // L'IK se mesure ICI : le modèle est en place, à son échelle finale, et
      // encore dans sa pose de repos — donc pieds au sol par convention VRM,
      // ce dont dépend tout le calcul du point « semelle ».
      legIk = createLegIk(vrm, avatarGroup)
      jointLimits = createJointLimits(vrm)
      // Le TRAJET appartenait à l'ancien corps : un personnage assis dont on
      // change le modèle laisserait le nouveau flotter à hauteur d'assise, dans
      // une pièce peut-être identique (le rechargement du décor n'est pas
      // garanti d'arriver, ni d'arriver après). Fondu nul : les clips du
      // nouveau modèle ne sont pas encore là.
      wander?.home(NO_FADE)
      lastFrame = { vrm, h: height }
      frameCamera(vrm, height)
      // Les .vrma partent APRÈS le cadrage, sans être attendues : l'avatar est
      // déjà à l'écran et à sa place, les animations s'y posent quand elles
      // arrivent (elles sont en cache dès le deuxième chargement).
      void buildAnimations(vrm)
    } catch (e) {
      console.error('[vrm]', e)
      throw e // l'UI affiche l'erreur
    }
  }

  // ── Boucle : mixer → idle → vrm.update (expressions + springbones) → controls → render ──
  const clock = new Clock()
  let rafId = 0

  function tick(): void {
    rafId = requestAnimationFrame(tick)
    const delta = Math.min(clock.getDelta(), 0.1)
    frameDelta = delta // lu par place() — le ressort vertical du corps
    if (mixer) {
      // Arbitrage animation ↔ idle. IdleAnimator écrit `base + offset` sur ses
      // 9 os à chaque frame : tel quel, il écraserait l'animation. La base DEVIENT
      // donc le résultat du mixer, et respiration et sway se posent PAR-DESSUS.
      // Les offsets de la frame précédente sont retirés AVANT le mixer, sinon la
      // re-capture les prendrait pour de la pose animée sur les os que le clip
      // courant ne touche pas — et les cumulerait à l'infini.
      for (const { node, base } of posedBones.values()) node.rotation.copy(base)
      // Les JAMBES suivent exactement le même protocole, pour exactement la même
      // raison : la correction d'assiette de l'image précédente est défaite ici,
      // sans quoi elle se cumulerait sur les os qu'un clip n'anime pas.
      if (interactive) legIk?.beforeMixer()
      // Les DOIGTS n'ont RIEN à faire ici : leur pose de repos est posée une
      // fois pour toutes avec le reste (applyRestPose), et c'est three qui la
      // tient (cf. handPoses.ts). Un os de doigt qu'aucun clip ne pilote n'est
      // même pas lié au mixer.
      // Les poids du fondu en cours sont posés AVANT l'évaluation : le mixer lit
      // ceux de CETTE image, et leur somme vaut 1 quand il accumule.
      advanceFade(delta)
      mixer.update(delta)
      // LIMITES ARTICULAIRES (table d'Overte) : la pose du mixer est bornée à
      // l'enveloppe humaine ICI, avant toute autre couche — la re-capture des
      // bases de l'idle et l'IK des jambes travaillent donc sur une pose déjà
      // saine, et l'IK n'est jamais défait par un clamp après coup (son genou
      // est une charnière PAR CONSTRUCTION, il ne peut pas violer la table).
      jointLimits?.apply()
      for (const bone of posedBones.values()) bone.base.copy(bone.node.rotation)
      // Cinématique inverse : le clip a donné l'allure, on corrige l'assiette.
      // APRÈS le mixer (elle lit la pose qu'il vient d'écrire) et AVANT l'idle,
      // qui ne touche que le tronc, les bras et le visage — les deux ne se
      // rencontrent sur aucun os.
      if (interactive && legIk) {
        legIk.afterMixer()
        // 1. ODOMÉTRIE : de combien le sol a défilé sous les pieds à CETTE image.
        strideOk = legIk.stride(strideBuf)
        // 2. DÉCISION ET PLACEMENT, avec ce relevé-là. L'ordre n'est pas
        //    indifférent : décider AVANT le mixer semble plus naturel (l'état
        //    pèse alors sur les poids de l'image courante), mais le comportement
        //    y consomme la foulée de l'image PRÉCÉDENTE — un retard d'une image
        //    qui laisse le pied d'appui glisser. Mesuré sur les 12 modèles :
        //    0,6 mm de glissement médian par image avant, 0,0 mm après. Ce qu'on
        //    paie à la place est un retard d'une image sur le DÉPART d'un fondu,
        //    soit 16 ms que personne ne voit.
        wander?.update(delta)
        // 3. CORRECTION D'ASSIETTE, une fois le corps posé : elle vise le sol
        //    sous les pieds, donc elle a besoin de la position définitive.
        //    `delta` alimente le lissage du pole vector du genou et le fondu
        //    anti-pop du changement de régime (machineries d'Overte).
        legIk.apply(footMode, groundAt, delta)
      }
      // Le squelette porte maintenant la pose du socle, et RIEN d'autre : c'est
      // l'instant juste pour recadrer, avant que l'idle n'ajoute sa respiration
      // (ses offsets oscillent — les inclure figerait une phase au hasard dans le
      // cadrage).
      if (reframePending) reframeAfterMixer()
    }
    // Les EXPRESSIONS restent maîtresses : l'idle les écrit après le mixer, donc
    // une .vrma qui porterait des pistes de visage est surchargée sur ces canaux.
    // Arbitrage voulu — le visage appartient au LLM, le corps à l'animation.
    idle.update(delta, currentVrm, posedBones)
    // Le REGARD passe APRÈS l'idle (qui vient d'écrire tête et cou depuis ses
    // bases : les deltas du regard ne peuvent pas s'accumuler) et AVANT
    // vrm.update (qui applique la cible aux yeux). Ses rotations de cou et de
    // tête sont bornées par la même table de limites que tout le reste.
    gaze.update(delta, currentVrm, camera, talking)
    if (currentVrm) {
      currentVrm.update(delta)
      // La purge de la physique des cheveux se fait ICI, après vrm.update :
      // celui-ci vient de remettre à jour les matrices monde de toute la chaîne
      // des springbones, ce dont `reset` a besoin pour ré-asseoir les pointes
      // sur la pose de repos. L'image se rend avec des cheveux au repos, et la
      // simulation repart d'un état sain à l'image suivante.
      if (springSettle) {
        springSettle = false
        currentVrm.springBoneManager?.reset()
      }
    }
    // Marqueurs de clic. Sous `interactive` uniquement : éteinte, la scène ne
    // paie littéralement pas un appel de plus qu'avant. Allumée mais sans
    // anneau en vie, update() sort sur un test entier.
    if (interactive) clickMarks.update(delta)
    controls.update()
    renderer.render(scene, camera)
  }

  // Économie batterie : pause complète du rendu quand l'onglet est caché.
  function onVisibilityChange(): void {
    if (document.hidden) {
      cancelAnimationFrame(rafId)
      rafId = 0
      // Un anneau figé en plein estompage reprendrait sa course au retour, une
      // heure plus tard, sans le clic qui l'explique. Il s'efface avec l'image.
      clickMarks.clear()
    } else if (!disposed && rafId === 0) {
      clock.getDelta() // purge le delta accumulé pendant la pause
      tick()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  if (!document.hidden) tick()

  return {
    loadModel,
    loadEnvironment,
    resetView,

    setFrameMode(mode: FrameMode): void {
      frameMode = mode
      // Position/cible : rien ne bouge (l'appelant applique la vue ensuite).
      // Le DÉCENTREMENT, lui, suit tout de suite : il doit refléter le mode
      // même quand une vue personnalisée est posée par setView, sans frameCamera.
      applyViewOffset()
    },

    setPanelWidth(px: number): void {
      // Aucun recadrage ici (comme le resize de fenêtre) — seul le décentrement
      // est réaligné, il dépend de la largeur de la colonne.
      if (Number.isFinite(px) && px > 0) {
        panelWidth = px
        applyViewOffset()
      }
    },

    setEmotion(emotion: string, live = false): void {
      const value = normalizeEmotion(emotion)
      // Le VISAGE s'applique toujours, restaurations comprises. Le CORPS ne mime
      // que ce qui vient de se produire : un geste au retour sur une vieille
      // conversation, ou au rechargement du modèle, serait absurde.
      idle.setEmotion(value)
      if (live) playGesture(value)
    },

    setSpeaking(speaking: boolean): void {
      idle.setSpeaking(speaking)
      if (speaking === talking) return
      talking = speaking
      // Socle « parle » le temps de la réponse (idle-talking.vrma), s'il existe.
      syncBase(BASE_SWAP)
    },

    setListening(on: boolean): void {
      if (on === listening) return
      listening = on
      // Un TIRAGE à chaque entrée en écoute, avec anti-répétition — même règle
      // que les gestes : trois variantes tirées uniformément rejoueraient la
      // précédente une fois sur trois, et c'est ce qui se lit comme un tic.
      // Le socle « parle », lui, est tiré une fois par modèle : il tourne des
      // secondes d'affilée, l'écoute revient à chaque phrase tapée.
      listenAction = on ? asBase(pickAction(catalog?.listening, lastListen)) : null
      if (listenAction) lastListen = listenAction
      // Aucun clip d'écoute (famille Overte, ou fichiers absents) : listenAction
      // reste null, desiredBase l'ignore, RIEN ne change. Le fondu ci-dessous
      // n'a alors rien à faire — syncBase ne bouge que si le socle voulu change.
      syncBase(BASE_SWAP)
    },

    setAnimationFamily(family: AnimationFamily): void {
      if (family === animFamily) return
      animFamily = family
      // Les deux familles n'ont AUCUN clip de face à face en commun : changer de
      // famille, c'est changer le socle, la parole, l'écoute et tous les gestes.
      // On reconstruit — le socle en place ne bouge pas d'un millimètre tant que
      // les nouveaux .vrma ne sont pas là (même règle que setInteractive).
      if (currentVrm) void buildAnimations(currentVrm)
    },

    setAnimationsEnabled(on: boolean): void {
      if (on === animationsEnabled) return
      animationsEnabled = on
      if (on) {
        if (currentVrm) void buildAnimations(currentVrm)
        return
      }
      disposeAnimations()
      // Déchargé, pas mis en pause : le squelette est resté là où l'animation
      // l'avait laissé (et la base de l'idle avec lui), on le remet à la pose de
      // repos pour retrouver EXACTEMENT le comportement d'avant les .vrma.
      if (currentVrm) {
        currentVrm.humanoid.resetNormalizedPose()
        applyRestPose(currentVrm)
      }
    },

    setInteractive(on: boolean): void {
      if (on === interactive) return
      interactive = on
      applyGaze()
      if (on) {
        wander = createWander(wanderHost)
        // Les clips `world-` n'étaient pas téléchargés : on reconstruit le
        // mixer, ce qui les met en vol. Le socle en place ne bouge pas d'un
        // millimètre entre-temps — buildAnimations ne remplace rien tant que les
        // .vrma ne sont pas là.
        if (currentVrm) void buildAnimations(currentVrm)
        return
      }
      // Extinction : on remet LITTÉRALEMENT l'état d'avant — avatar à l'origine,
      // cap nul, aucune allure, pieds « posés » — et on redemande un cadrage par
      // défaut, que reframeAfterMixer n'appliquera que si l'utilisateur n'a pas
      // composé le sien. Les lignes après home() sont la ceinture ET les
      // bretelles : home() a déjà rendu l'écran au socle via le contrat.
      wander?.home(BASE_SWAP)
      wander = null
      clickMarks.clear() // plus d'interaction : plus de marque à l'écran
      onceThen = null
      gaitAction = null
      footMode = 'planted'
      jointLimits?.clearHistory() // retour à l'origine = discontinuité, même règle
      avatarGroup.position.set(0, 0, 0)
      avatarGroup.rotation.y = 0
      springSettle = true // retour à l'origine = saut (cf. springSettle)
      syncBase(BASE_SWAP)
      reframePending = true
    },

    setPosture(name: string | null): void {
      postureName = name ? name.trim().toLowerCase() : null
      // Nom inconnu = aucune posture (retour au socle) : la phase interactive
      // pourra nommer ses postures sans jamais risquer de figer l'avatar.
      postureAction = asBase(postureName ? pickAction(catalog?.postures.get(postureName)) : null)
      syncBase(BASE_SWAP)
    },

    setView(view: StageView): void {
      camera.position.set(view.pos[0], view.pos[1], view.pos[2])
      controls.target.set(view.target[0], view.target[1], view.target[2])
      controls.update()
      // Vue CHOISIE par l'utilisateur (sauvegardée pour ce personnage et ce mode) :
      // plus rien ne recadre tout seul par-dessus.
      defaultFramed = false
    },

    onViewChange(cb: (view: StageView | null) => void): void {
      viewChangeCb = cb
    },

    snapshot(): string | null {
      if (!currentVrm) return null
      // Rendu PUIS lecture dans le MÊME tick : le renderer n'est pas créé avec
      // preserveDrawingBuffer (coûteux à chaque frame), donc le backbuffer est
      // vidé dès que le navigateur a présenté l'image. Rendre juste avant est le
      // seul moyen fiable d'avoir des pixels à lire.
      renderer.render(scene, camera)
      return renderer.domElement.toDataURL('image/png')
    },

    dispose(): void {
      disposed = true
      loadGeneration++ // invalide tout chargement encore en vol
      envGeneration++
      cancelAnimationFrame(rafId)
      rafId = 0
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('resize', resize)
      observer.disconnect()
      renderer.domElement.removeEventListener('dblclick', onDblClick)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('click', onSceneClick)
      clickMarks.dispose()
      controls.dispose()
      unloadCurrent()
      // Le décor part AVANT le renderer : c'est lui qui porte le contexte WebGL
      // sur lequel les textures de la pièce sont libérées.
      unloadEnvironment()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
