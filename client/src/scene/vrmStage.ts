// Scène 3D de l'avatar VRM — implémente le contrat VrmStage (./types).
// three + @pixiv/three-vrm ; l'UI importe createVrmStage dynamiquement.
import {
  AnimationMixer,
  Box3,
  Clock,
  DirectionalLight,
  Group,
  HemisphereLight,
  LoopOnce,
  LoopRepeat,
  MOUSE,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  TOUCH,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { AnimationAction, AnimationClip, Color, Material, Mesh } from 'three'
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
import type { Emotion } from '../../../shared/types'
import { getVrmAnimations } from '../api'
// Les erreurs de cette scène remontent TELLES QUELLES à l'écran (bandeaux de
// App.tsx) : elles se traduisent, comme celles de la couche API.
import { translate } from '../i18n'
import type { FrameMode, StageView, VrmStage } from './types'
import { IdleAnimator } from './idle'
import type { PosedBone } from './idle'
import { normalizeEmotion, resolveExpressions } from './emotionMap'
import { createWander } from './wander'
import type { Wander, WanderHost } from './wander'
import { createLegIk } from './legIk'
import type { FootMode, LegIk } from './legIk'
import { fetchSceneMap } from './sceneMap'
import type { SceneMap } from './sceneMap'

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
  exposure?: number // multiplicateur de luminosité des MATÉRIAUX du décor (cf. applyEnvExposure)
}

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
  if (Array.isArray(o.spawn) && o.spawn.length === 3) {
    const t = o.spawn.map((n) => asNumberIn(n, -1000, 1000))
    if (t.every((n): n is number => n !== undefined)) out.spawn = [t[0], t[1], t[2]]
  }
  return out
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
  color?: Color
  emissive?: Color
  map?: unknown
  emissiveMap?: unknown
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
 * Clone exposé d'un matériau. Le CLONE est obligatoire : three mutualise
 * volontiers un matériau entre plusieurs meshes, et sans copie la couleur serait
 * multipliée une fois par mesh qui la partage — puis encore à chaque rechargement
 * du décor, l'effet se cumulant jusqu'au blanc.
 * Un seul clone par matériau d'ORIGINE (d'où le cache) : les meshes qui
 * partageaient un matériau continuent d'en partager un, le nombre de programmes
 * GPU et le regroupement des appels de dessin restent ceux d'avant.
 */
function exposedClone(source: Material, factor: number, cache: Map<Material, Material>): Material {
  const known = cache.get(source)
  if (known) return known
  const clone = source.clone()
  const shaded = clone as unknown as ShadedMaterial
  if (shaded.color) scaleColor(shaded.color, factor, !shaded.map)
  // L'émissif suit le même facteur : sinon une lampe du décor garderait sa
  // luminosité propre pendant que tout le reste change, et l'exposition
  // déplacerait l'équilibre de la pièce au lieu de la rendre plus lisible.
  // Nul sur les matériaux unlit (MeshBasicMaterial n'a pas d'émissif du tout).
  if (shaded.emissive) scaleColor(shaded.emissive, factor, !shaded.emissiveMap)
  cache.set(source, clone)
  return clone
}

/**
 * Applique l'exposition du sidecar aux MATÉRIAUX du décor, et non à l'intensité
 * des lumières comme avant : `anime-classroom.glb` et `rustic-bedroom.glb`
 * déclarent l'extension glTF `KHR_materials_unlit`, donc GLTFLoader les charge en
 * MeshBasicMaterial et ils IGNORENT totalement les lumières de la scène — le
 * réglage n'avait aucun effet sur deux décors sur trois, dont celui qui en a le
 * plus besoin. Multiplier la couleur marche à l'identique pour l'unlit et le PBR.
 * Pas de `renderer.toneMapping` / `toneMappingExposure` : ils toucheraient tout le
 * rendu, avatar compris, y compris quand aucun décor n'est chargé.
 * Facteur 1 (le cas de très loin le plus courant — sidecar absent) : on ne touche
 * à RIEN, pas même un clone, donc rendu strictement identique à avant.
 */
function applyEnvExposure(root: Object3D, factor: number): void {
  if (factor === 1) return
  const cache = new Map<Material, Material>()
  root.traverse((node) => {
    const mesh = node as Mesh
    const material = mesh.material
    if (!material) return // un Object3D quelconque (nœud de transformation, os…)
    mesh.material = Array.isArray(material)
      ? material.map((one) => exposedClone(one, factor, cache))
      : exposedClone(material, factor, cache)
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

/** Fondus (secondes) : entrée d'un geste, retour au socle, changement de socle. */
const GESTURE_FADE = 0.3
const GESTURE_RETURN = 0.4
const BASE_FADE = 0.5

/** Socle de remplacement pendant qu'une réponse s'écrit. */
const TALKING_STEM = 'idle-talking'
/** Radicaux de posture : `pose-sit` (nom court) et les clips assis livrés tels quels. */
const POSTURE_PREFIXES = ['pose-', 'sit-'] as const
/**
 * Domaine « monde 3D » : déplacement, pivots, postures de la scène vivante. Ces
 * clips ne sont JAMAIS joués en face à face — le mode conversation n'a aucune
 * raison de télécharger 2,4 Mo d'allures. Leur chargement est donc PARESSEUX
 * (cf. worldUrlsNeeded) et conditionné à l'interrupteur.
 */
const WORLD_PREFIX = 'world-'

/** Rôles reconnus dans vrma/, en URLs de fichiers. */
interface VrmaCatalog {
  idle: string[] // socle en boucle — SANS LUI, aucune animation n'est jouée
  talking: string[] // socle en boucle pendant que le personnage parle
  gestures: Map<Emotion, string[]> // joué une fois, puis retour au socle
  postures: Map<string, string[]> // remplace le socle (setPosture)
  world: Map<string, string[]> // domaine `world-`, clé = radical SANS le préfixe
}

function pushInto<K>(map: Map<K, string[]>, key: K, url: string): void {
  const list = map.get(key)
  if (list) list.push(url)
  else map.set(key, [url])
}

/**
 * URLs → rôles. Le radical est mis en minuscules et son suffixe de variante
 * (`-2`, `-3`…) retiré : `happy-2.vrma` est une variante de `happy`, exactement
 * la grammaire des salutations multiples d'un personnage.
 */
function catalogFromUrls(urls: readonly string[]): VrmaCatalog {
  const cat: VrmaCatalog = {
    idle: [],
    talking: [],
    gestures: new Map(),
    postures: new Map(),
    world: new Map(),
  }
  for (const url of urls) {
    const file = decodeURIComponent(url.split('/').pop() ?? '')
    const stem = file
      .replace(/\.vrma$/i, '')
      .toLowerCase()
      .replace(/-\d+$/, '')
    if (stem === 'idle') cat.idle.push(url)
    else if (stem === TALKING_STEM) cat.talking.push(url)
    else if ((EMOTIONS as readonly string[]).includes(stem)) pushInto(cat.gestures, stem as Emotion, url)
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
const WORLD_NEEDED: readonly string[] = ['turn-left', 'turn-right']

function worldUrlsNeeded(cat: VrmaCatalog, on: boolean): string[] {
  if (!on) return []
  return WORLD_NEEDED.flatMap((name) => cat.world.get(name) ?? [])
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

// Catalogue résolu UNE FOIS pour la session : le contenu du dossier ne change pas
// pendant qu'on s'en sert. Liste injoignable → catalogue vide → aucun mixer, donc
// exactement le comportement d'avant les animations. Mais cet échec-là n'est PAS
// mémorisé : la promesse est oubliée pour que le prochain chargement de modèle (ou
// l'interrupteur des Réglages) retente, au lieu de servir un catalogue vide jusqu'au
// F5 suivant.
let catalogPending: Promise<VrmaCatalog> | null = null

function loadCatalog(): Promise<VrmaCatalog> {
  catalogPending ??= getVrmAnimations()
    .then(catalogFromUrls)
    .catch((e) => {
      console.warn('[vrma]', e)
      catalogPending = null
      return catalogFromUrls([])
    })
  return catalogPending
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
  camera.position.set(0, 1.35, 1.8)

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
  controls.target.set(0, 1.25, 0)

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
  let postureAction: AnimationAction | null = null
  let gaitAction: AnimationAction | null = null // allure ou pivot du domaine `world-`
  let postureName: string | null = null
  let baseAction: AnimationAction | null = null // socle voulu (en boucle)
  let activeAction: AnimationAction | null = null // ce qui tient l'écran : socle ou geste
  let talking = false
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
    duration: number
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
  // Carte du décor en place (`<décor>.scene.json`). null = pas d'analyse : le
  // décor reste un fond, exactement comme aujourd'hui.
  let sceneMap: SceneMap | null = null
  // Ce que les pieds doivent faire à cette image (cf. legIk.FootMode).
  let footMode: FootMode = 'planted'
  // Instant (ms) du dernier geste de caméra de l'utilisateur, et geste en cours.
  // On ne déplace pas la scène sous sa main : le personnage attend qu'il ait
  // lâché, plus une seconde de grâce.
  let camGrabbed = false
  let camReleasedAt = -Infinity
  const USER_CAMERA_GRACE_MS = 2000

  // ── Décor ─────────────────────────────────────────────────────────────────
  let envRoot: Object3D | null = null
  // Dimensions du décor en place (mètres) : elles pilotent le plan lointain de la
  // caméra et la distance de recul maximale. null = pas de décor.
  let envMetrics: { radius: number; height: number } | null = null
  let envGeneration = 0

  // ── Cadrage utilisateur (pan/zoom/rotation) : persistance + reset ─────────
  let lastFrame: { vrm: VRM; h: number } | null = null // cadrage par défaut re-calculable
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

  // 'end' ne se déclenche qu'à la fin d'une interaction UTILISATEUR — jamais
  // sur un setView/frameCamera programmatique.
  controls.addEventListener('end', () => {
    // Une vue vient d'être persistée : le cadrage n'est plus celui par défaut.
    // Redondant avec 'start' dans le cas courant, mais pas toujours — un clic sur
    // un bouton non mappé fait un 'end' SANS 'start'.
    defaultFramed = false
    camGrabbed = false
    camReleasedAt = performance.now()
    viewChangeCb?.(currentView())
  })
  // 'start' est utilisateur lui aussi. Le cadrage cesse d'être « celui par
  // défaut » DÈS LE DÉBUT du geste et pas à sa fin : un recadrage automatique au
  // milieu d'un glissement arracherait la caméra des mains de l'utilisateur.
  controls.addEventListener('start', () => {
    defaultFramed = false
    camGrabbed = true
  })

  function resetView(): void {
    if (!lastFrame) return
    frameCamera(lastFrame.vrm, lastFrame.h)
    viewChangeCb?.(null)
  }

  function onDblClick(): void {
    resetView()
  }
  renderer.domElement.addEventListener('dblclick', onDblClick)

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
    legIk = null // ses os appartiennent au modèle qu'on vient de jeter
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

  /** Une action de socle boucle sans fin — elle n'émettra donc jamais 'finished'. */
  function asBase(action: AnimationAction | null): AnimationAction | null {
    action?.setLoop(LoopRepeat, Infinity)
    return action
  }

  /** Une variante au hasard parmi celles réellement chargées. */
  function pickAction(urls: readonly string[] | undefined): AnimationAction | null {
    const ready = (urls ?? [])
      .map((url) => actions.get(url))
      .filter((a): a is AnimationAction => a !== undefined)
    return ready.length > 0 ? pickOne(ready) : null
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
  function fadeTo(next: AnimationAction, duration: number): void {
    if (activeAction === next) return
    const from = new Map(weights)
    // `paused` : un geste figé par clampWhenFinished redevient pilotable.
    next.paused = false
    next.enabled = true
    next.play()
    activeAction = next
    // Rien en place (premier socle) ou fondu nul : poids 1 tout de suite.
    if (from.size === 0 || duration <= 0) {
      fade = null
      poseWeights(fadeWeights(from, next, 1))
      return
    }
    fade = { to: next, from, elapsed: 0, duration }
    poseWeights(fadeWeights(from, next, 0))
  }

  /** Avance le fondu en cours d'une image (appelé JUSTE AVANT mixer.update). */
  function advanceFade(delta: number): void {
    if (!fade) return
    fade.elapsed += delta
    const p = Math.min(1, fade.elapsed / fade.duration)
    poseWeights(fadeWeights(fade.from, fade.to, p))
    if (p >= 1) fade = null
  }

  /**
   * Socle voulu maintenant. Ordre : ce que font les JAMBES prime sur ce que
   * disent les bras — marcher ou pivoter passe donc avant tout, puis une posture,
   * puis « parle », puis l'idle.
   */
  function desiredBase(): AnimationAction | null {
    if (gaitAction) return gaitAction
    if (postureAction) return postureAction
    if (talking && talkingAction) return talkingAction
    return idleAction
  }

  /**
   * Réaligne le socle. Pendant un geste, le changement se fait EN COULISSE : le
   * geste garde l'écran, et son fondu de sortie ira sur le nouveau socle.
   */
  function syncBase(duration: number): void {
    const next = desiredBase()
    if (!next || next === baseAction) return
    const prev = baseAction
    baseAction = next
    if (activeAction === prev) fadeTo(next, duration)
  }

  // ── Domaine `world-` : ce que la scène vivante peut demander ──────────────

  /** Action d'un clip `world-<name>` réellement chargé, ou null. */
  function worldAction(name: string): AnimationAction | null {
    return pickAction(catalog?.world.get(name))
  }

  /**
   * Socle d'ALLURE (marche, pivot) : il remplace le socle courant tant qu'il est
   * posé, et `desiredBase` le fait primer sur tout le reste. null = rendre les
   * jambes au socle normal.
   */
  function setGait(name: string | null, fade: number): void {
    const next = name ? asBase(worldAction(name)) : null
    if (next === gaitAction) return
    gaitAction = next
    syncBase(fade)
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

  /** Le contrat que la scène offre au comportement (cf. wander.ts). */
  const wanderHost: WanderHost = {
    hips: hipsRest,
    place(x, y, z, yaw, ground) {
      avatarGroup.position.set(x, y, z)
      avatarGroup.rotation.y = yaw
      bodyGround = ground
    },
    gait: setGait,
    once(name, fadeIn, then, fadeThen) {
      playOnce(name, fadeIn, then, fadeThen)
    },
    has: (name) => worldAction(name) !== null,
    speaking: () => talking,
    camYaw: cameraYawFrom,
    userBusy: () => camGrabbed || performance.now() - camReleasedAt < USER_CAMERA_GRACE_MS,
  }

  /**
   * Clip à cycle unique du domaine `world-` (une TRANSITION : départ, arrêt,
   * s'asseoir), suivi de `then`. La file est à un seul cran — une transition ne
   * se met jamais en attente d'une autre, elle est remplacée.
   */
  let onceThen: { name: string | null; fade: number } | null = null

  function playOnce(name: string, fadeIn: number, then: string | null, fadeThen: number): void {
    const action = worldAction(name)
    if (!action) {
      // Clip absent : on saute la transition et on va droit à sa suite, plutôt
      // que de rester figé dans un état qui n'arrivera jamais.
      onceThen = null
      setGait(then, fadeIn)
      return
    }
    action.reset()
    action.setLoop(LoopOnce, 1)
    action.clampWhenFinished = true
    // L'allure courante cesse d'être le socle : c'est la transition qui tient
    // l'écran, et `onceThen` dit ce qui la suit.
    gaitAction = null
    onceThen = { name: then, fade: fadeThen }
    fadeTo(action, fadeIn)
  }

  /** Geste d'émotion : joué UNE fois, variante tirée à chaque déclenchement. */
  function playGesture(emotion: Emotion): void {
    if (!mixer) return
    // Un geste monte à poids 1 sur TOUT le squelette (three n'a ni couche ni
    // masque d'os) : déclenché pendant un pivot ou une marche, il arrêterait les
    // jambes net. Le VISAGE, lui, continue de s'appliquer — setEmotion écrit
    // l'expression avant d'arriver ici, et c'est ce qui porte l'émotion.
    if (gaitAction) return
    const action = pickAction(catalog?.gestures.get(emotion))
    if (!action) return // aucun fichier pour cette émotion : le visage suffit
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
    fadeTo(action, GESTURE_FADE)
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
    idleAction = null
    talkingAction = null
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
    const cat = await loadCatalog()
    if (!animationsEnabled || disposed || currentVrm !== vrm) return
    catalog = cat
    if (cat.idle.length === 0) return // pas de socle : pas de mixer du tout
    // Le socle est tiré au hasard UNE FOIS par chargement de modèle ; les gestes
    // le sont à chaque déclenchement, donc toutes leurs variantes sont chargées.
    const idleUrl = pickOne(cat.idle)
    const urls = [
      idleUrl,
      ...cat.talking,
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
        baseAction = desiredBase()
        if (baseAction) fadeTo(baseAction, step.fade)
        return
      }
      // Un geste d'émotion rend l'écran au socle.
      if (baseAction) fadeTo(baseAction, GESTURE_RETURN)
    })
    for (const [url, clip] of clips) actions.set(url, mixer.clipAction(clip))
    idleAction = asBase(actions.get(idleUrl) ?? null)
    talkingAction = asBase(pickAction(cat.talking))
    postureAction = asBase(postureName ? pickAction(cat.postures.get(postureName)) : null)
    syncBase(0)
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
    const distance = Math.min(2.5 * h, Math.max(0.375 * h, headPos.y * 1.4))
    controls.target.set(headPos.x, headPos.y - 0.12, headPos.z)
    // Le `z` de la caméra est DEVANT la tête, pas à une abscisse absolue : sans
    // ça, un double-clic ne retrouverait plus le personnage dès qu'il s'écarte du
    // point d'accueil. Le ternaire est nécessaire et non cosmétique — `headPos.z`
    // ne vaut pas exactement 0 (la stance d'idle.vrma avance la tête de quelques
    // millimètres), et l'écrire sans garde changerait la distance de cadrage par
    // défaut de TOUS les modèles, scène vivante éteinte comprise.
    camera.position.set(headPos.x, controls.target.y, (interactive ? headPos.z : 0) + distance)
    controls.minDistance = 0.3 * h
    applyEnvLimits(h)
    applyViewOffset()
    camera.updateProjectionMatrix()
    controls.update()
    defaultFramed = true
  }

  /**
   * Plan lointain et recul maximum. SANS décor : exactement les valeurs
   * historiques (15 h et 3 h) — zéro régression. AVEC décor : de quoi voir la
   * pièce entière sans la clipper, et de quoi s'en éloigner un peu, sans jamais
   * réduire ce que l'avatar seul permettait.
   * Appelée des DEUX côtés (frameCamera et loadEnvironment) : le modèle et le
   * décor sont chargés par deux effets React indépendants, l'ordre n'est pas
   * garanti — sinon un décor arrivé après le modèle serait tronqué à l'écran.
   */
  function applyEnvLimits(h = lastFrame?.h ?? 1.6): void {
    if (envMetrics) {
      camera.far = Math.max(15 * h, 4 * envMetrics.radius)
      controls.maxDistance = Math.min(8 * h, Math.max(3 * h, envMetrics.radius))
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
   * matériaux du décor, cf. applyEnvExposure), pour deux raisons :
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
    envMetrics = null
    sceneMap = null
    // Le personnage rentre chez lui : la pièce où il s'était déplacé n'existe
    // plus, et le laisser à ses coordonnées d'avant le poserait au hasard dans
    // la suivante — ou dans le vide s'il n'y en a pas.
    wander?.home()
    envGroup.position.set(0, 0, 0)
    envGroup.rotation.set(0, 0, 0)
    envGroup.scale.setScalar(1)
    applyLightRegime()
    applyEnvLimits()
  }

  /**
   * Place le décor : échelle, orientation, calage au sol et point d'accueil.
   * Sans sidecar, l'ajustement est calqué sur normalizeScale — une hauteur
   * plausible est laissée intacte, une hauteur absurde (décor exporté en
   * centimètres) est ramenée à ~2,6 m — et le plancher vient à y = 0, là où
   * l'avatar a les pieds.
   */
  function fitEnvironment(root: Object3D, placement: EnvPlacement): void {
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
    const [sx, sy, sz] = placement.spawn ?? [0, 0, 0]
    envGroup.position.set(-sx, -(box.min.y + sy), -sz)
    envMetrics = { radius: Math.max(size.length() / 2, 0.5), height: Math.max(size.y, 0.5) }
  }

  /** Charge un décor .glb dans envGroup (url '' = décharge le décor courant). */
  async function loadEnvironment(url: string): Promise<void> {
    const generation = ++envGeneration
    if (!url) {
      unloadEnvironment()
      return
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
        return
      }
      unloadEnvironment()
      envRoot = gltf.scene
      // Exposition AVANT l'ajout à la scène : les matériaux clonés sont en place
      // dès la première image, jamais un éclair à la couleur d'origine.
      applyEnvExposure(envRoot, placement.exposure ?? 1)
      envGroup.add(envRoot)
      fitEnvironment(envRoot, placement)
      // APRÈS unloadEnvironment, qui remet la carte à null et ramène le
      // personnage chez lui : sinon la carte du nouveau décor serait effacée
      // aussitôt posée.
      sceneMap = map
      applyLightRegime()
      applyEnvLimits()
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
      currentVrm = vrm
      idle.reset()
      idle.setExpressionTable(resolveExpressions(vrm.expressionManager))
      const height = normalizeScale(vrm)
      // L'IK se mesure ICI : le modèle est en place, à son échelle finale, et
      // encore dans sa pose de repos — donc pieds au sol par convention VRM,
      // ce dont dépend tout le calcul du point « semelle ».
      legIk = createLegIk(vrm)
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
    // DÉCISION et PLACEMENT, avant le mixer : un changement d'état (pivot,
    // départ, arrêt) doit peser sur les poids de CETTE image, pas de la suivante.
    // Scène vivante éteinte : `wander` est null, la ligne ne fait rien.
    wander?.update(delta)
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
      // Les poids du fondu en cours sont posés AVANT l'évaluation : le mixer lit
      // ceux de CETTE image, et leur somme vaut 1 quand il accumule.
      advanceFade(delta)
      mixer.update(delta)
      for (const bone of posedBones.values()) bone.base.copy(bone.node.rotation)
      // Cinématique inverse : le clip a donné l'allure, on corrige l'assiette.
      // APRÈS le mixer (elle lit la pose qu'il vient d'écrire) et AVANT l'idle,
      // qui ne touche que le tronc, les bras et le visage — les deux ne se
      // rencontrent sur aucun os.
      if (interactive && legIk) {
        legIk.afterMixer()
        legIk.apply(footMode, groundAt)
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
    if (currentVrm) currentVrm.update(delta)
    controls.update()
    renderer.render(scene, camera)
  }

  // Économie batterie : pause complète du rendu quand l'onglet est caché.
  function onVisibilityChange(): void {
    if (document.hidden) {
      cancelAnimationFrame(rafId)
      rafId = 0
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
      syncBase(BASE_FADE)
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
      // cap nul, aucune allure — et on redemande un cadrage par défaut, que
      // reframeAfterMixer n'appliquera que si l'utilisateur n'a pas composé le sien.
      wander?.home()
      wander = null
      onceThen = null
      gaitAction = null
      avatarGroup.position.set(0, 0, 0)
      avatarGroup.rotation.y = 0
      syncBase(BASE_FADE)
      reframePending = true
    },

    setPosture(name: string | null): void {
      postureName = name ? name.trim().toLowerCase() : null
      // Nom inconnu = aucune posture (retour au socle) : la phase interactive
      // pourra nommer ses postures sans jamais risquer de figer l'avatar.
      postureAction = asBase(postureName ? pickAction(catalog?.postures.get(postureName)) : null)
      syncBase(BASE_FADE)
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
