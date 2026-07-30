// Scène 3D de l'avatar VRM — implémente le contrat VrmStage (./types).
// three + @pixiv/three-vrm ; l'UI importe createVrmStage dynamiquement.
import {
  Box3,
  Clock,
  DirectionalLight,
  Group,
  HemisphereLight,
  MOUSE,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  TOUCH,
  Vector3,
  WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import type { FrameMode, StageView, VrmStage } from './types'
import { IdleAnimator } from './idle'
import type { PosedBone } from './idle'
import { normalizeEmotion, resolveExpressions } from './emotionMap'

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

/**
 * GLTFLoader LÈVE quand un .glb réclame un décodeur qui n'est pas branché
 * (Draco, meshopt, KTX2 : des fichiers à servir, pas des dépendances npm). Son
 * message brut ne dit rien à personne — on le remplace par la marche à suivre.
 * Retourne null si l'erreur n'a rien à voir avec une compression.
 */
function compressionError(e: unknown): Error | null {
  const msg = e instanceof Error ? e.message : String(e)
  if (!/draco|meshopt|ktx2|basis/i.test(msg)) return null
  return new Error(
    'Décor compressé (Draco, meshopt ou KTX2) — non pris en charge : réexporte le .glb sans compression.',
  )
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
  // Deux groupes FRÈRES. Règle d'or : l'avatar reste à l'origine du monde, c'est
  // le DÉCOR qui se déplace pour amener son point d'accueil sous ses pieds. Les
  // cadrages sauvegardés (coordonnées monde absolues, data/ui.json) restent donc
  // valables quel que soit le décor, et frameCamera n'a rien à savoir de la pièce.
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

  // ── Décor ─────────────────────────────────────────────────────────────────
  let envRoot: Object3D | null = null
  // Dimensions du décor en place (mètres) : elles pilotent le plan lointain de la
  // caméra et la distance de recul maximale. null = pas de décor.
  let envMetrics: { radius: number; height: number } | null = null
  let envGeneration = 0

  // ── Cadrage utilisateur (pan/zoom/rotation) : persistance + reset ─────────
  let lastFrame: { vrm: VRM; h: number } | null = null // cadrage par défaut re-calculable
  let viewChangeCb: ((view: StageView | null) => void) | null = null
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
    viewChangeCb?.(currentView())
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
    avatarGroup.remove(currentVrm.scene)
    VRMUtils.deepDispose(currentVrm.scene)
    currentVrm = null
    lastFrame = null
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
    camera.position.set(headPos.x, controls.target.y, distance)
    controls.minDistance = 0.3 * h
    applyEnvLimits(h)
    applyViewOffset()
    camera.updateProjectionMatrix()
    controls.update()
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

  /** Régime d'éclairage : l'avatar seul dans le vide, ou posé dans une pièce. */
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
      VRMUtils.deepDispose(envRoot)
      envRoot = null
    }
    envMetrics = null
    envGroup.position.set(0, 0, 0)
    envGroup.rotation.set(0, 0, 0)
    envGroup.scale.setScalar(1)
    applyLightRegime()
    applyEnvLimits()
  }

  /**
   * Mise à l'échelle et calage au sol du décor, calqués sur normalizeScale : une
   * hauteur plausible est laissée intacte, une hauteur absurde (décor exporté en
   * centimètres) est ramenée à ~2,6 m. Le plancher vient à y = 0, là où l'avatar
   * a les pieds.
   */
  function fitEnvironment(root: Object3D): void {
    envGroup.position.set(0, 0, 0)
    envGroup.updateMatrixWorld(true)
    let box = new Box3().setFromObject(root)
    const rawHeight = Math.max(box.getSize(new Vector3()).y, 1e-6)
    if (rawHeight < ENV_MIN_HEIGHT || rawHeight > ENV_MAX_HEIGHT) {
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
    // Plancher aux pieds de l'avatar. Un décor « skybox » dont la boîte
    // englobante ment (sol infini, min.y à −500) se rattrape par le sidecar.
    envGroup.position.set(0, -box.min.y, 0)
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
      const gltf = await envLoader.loadAsync(url)
      if (generation !== envGeneration || disposed) {
        // Un loadEnvironment plus récent (ou dispose) est passé entre-temps.
        VRMUtils.deepDispose(gltf.scene)
        return
      }
      unloadEnvironment()
      envRoot = gltf.scene
      envGroup.add(envRoot)
      fitEnvironment(envRoot)
      applyLightRegime()
      applyEnvLimits()
    } catch (e) {
      console.error('[env]', e)
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
      if (!vrm) throw new Error(`Fichier sans données VRM : ${url}`)
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
      avatarGroup.add(vrm.scene)
      currentVrm = vrm
      idle.reset()
      idle.setExpressionTable(resolveExpressions(vrm.expressionManager))
      const height = normalizeScale(vrm)
      lastFrame = { vrm, h: height }
      frameCamera(vrm, height)
    } catch (e) {
      console.error('[vrm]', e)
      throw e // l'UI affiche l'erreur
    }
  }

  // ── Boucle : idle → vrm.update (expressions + springbones) → controls → render ──
  const clock = new Clock()
  let rafId = 0

  function tick(): void {
    rafId = requestAnimationFrame(tick)
    const delta = Math.min(clock.getDelta(), 0.1)
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

    setEmotion(emotion: string): void {
      idle.setEmotion(normalizeEmotion(emotion))
    },

    setSpeaking(speaking: boolean): void {
      idle.setSpeaking(speaking)
    },

    setView(view: StageView): void {
      camera.position.set(view.pos[0], view.pos[1], view.pos[2])
      controls.target.set(view.target[0], view.target[1], view.target[2])
      controls.update()
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
