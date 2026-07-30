// Scène 3D de l'avatar VRM — implémente le contrat VrmStage (./types).
// three + @pixiv/three-vrm ; l'UI importe createVrmStage dynamiquement.
import {
  Box3,
  Clock,
  DirectionalLight,
  HemisphereLight,
  MOUSE,
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
  const camera = new PerspectiveCamera(30, 1, 0.1, 20)
  camera.position.set(0, 1.35, 1.8)

  // Lumière principale de face/haut + appoint doux (ne pas écraser le toon).
  const keyLight = new DirectionalLight(0xffffff, 2.2)
  keyLight.position.set(0.3, 1.6, 1.2)
  scene.add(keyLight)
  const fillLight = new HemisphereLight(0xffffff, 0x8890a0, 0.6)
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

  const idle = new IdleAnimator()
  const posedBones = new Map<VRMHumanBoneName, PosedBone>()
  let currentVrm: VRM | null = null
  let loadGeneration = 0
  let disposed = false

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
    scene.remove(currentVrm.scene)
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
    controls.maxDistance = 3 * h
    camera.far = 15 * h
    applyViewOffset()
    camera.updateProjectionMatrix()
    controls.update()
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
      scene.add(vrm.scene)
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
      cancelAnimationFrame(rafId)
      rafId = 0
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('resize', resize)
      observer.disconnect()
      renderer.domElement.removeEventListener('dblclick', onDblClick)
      controls.dispose()
      unloadCurrent()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
