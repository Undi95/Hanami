// Déclarations ambiantes MINIMALES pour three : le paquet npm `three` ne fournit
// aucun .d.ts et `@types/three` n'est pas installé (dépendances figées, aucune
// nouvelle dépendance autorisée). On ne déclare que la surface utilisée par la
// scène VRM. À SUPPRIMER si `@types/three` est ajouté un jour (conflit sinon).
// Les .d.ts de @pixiv/three-vrm importent aussi 'three' et
// 'three/examples/jsm/loaders/GLTFLoader.js' : ils se résolvent sur ces modules
// ambiants, ce qui garantit l'identité des types (GLTFParser, Group, …).

declare module 'three' {
  export class Vector3 {
    x: number
    y: number
    z: number
    constructor(x?: number, y?: number, z?: number)
    set(x: number, y: number, z: number): this
    setScalar(scalar: number): this
    multiplyScalar(scalar: number): this
    copy(v: Vector3): this
    clone(): Vector3
    add(v: Vector3): this
    sub(v: Vector3): this
    negate(): this
    length(): number
    applyAxisAngle(axis: Vector3, angle: number): this
    // Ajouts de la cinématique inverse (scene/legIk.ts). Toutes ces méthodes
    // écrivent DANS l'objet et le rendent : l'IK tourne à chaque image et
    // n'alloue rien.
    lengthSq(): number
    normalize(): this
    dot(v: Vector3): number
    distanceTo(v: Vector3): number
    subVectors(a: Vector3, b: Vector3): this
    addVectors(a: Vector3, b: Vector3): this
    crossVectors(a: Vector3, b: Vector3): this
    addScaledVector(v: Vector3, s: number): this
    applyQuaternion(q: Quaternion): this
  }

  export class Vector2 {
    x: number
    y: number
    constructor(x?: number, y?: number)
    set(x: number, y: number): this
  }

  export class Box3 {
    min: Vector3
    max: Vector3
    constructor(min?: Vector3, max?: Vector3)
    setFromObject(object: Object3D, precise?: boolean): this
    getSize(target: Vector3): Vector3
    getCenter(target: Vector3): Vector3
  }

  /** Impact d'un lancer de rayon (Raycaster.intersectObject), trié par distance. */
  export interface Intersection {
    distance: number
    point: Vector3
    object: Object3D
  }

  // Lancer de rayon — UNIQUEMENT à l'événement de clic, jamais dans la boucle :
  // intersecter un décor de 200 000 triangles par image est exactement le genre
  // de calcul que l'architecture interdit à l'exécution.
  export class Raycaster {
    constructor()
    near: number
    far: number
    setFromCamera(coords: Vector2, camera: Camera): void
    intersectObject(object: Object3D, recursive?: boolean): Intersection[]
  }

  export class Euler {
    x: number
    y: number
    z: number
    order: string
    constructor(x?: number, y?: number, z?: number, order?: string)
    set(x: number, y: number, z: number, order?: string): this
    copy(e: Euler): this
    clone(): Euler
  }

  export class Quaternion {
    x: number
    y: number
    z: number
    w: number
    constructor(x?: number, y?: number, z?: number, w?: number)
    set(x: number, y: number, z: number, w: number): this
    copy(q: Quaternion): this
    clone(): Quaternion
    setFromEuler(euler: Euler, update?: boolean): this
    // Ajouts de la cinématique inverse. `multiply` compose à DROITE (this × q),
    // `premultiply` à gauche (q × this) : c'est la distinction qui sépare
    // « tourner dans son repère local » de « tourner dans le monde ».
    identity(): this
    invert(): this
    multiply(q: Quaternion): this
    premultiply(q: Quaternion): this
    setFromAxisAngle(axis: Vector3, angle: number): this
    setFromUnitVectors(from: Vector3, to: Vector3): this
  }

  export class Matrix4 {
    copy(m: Matrix4): this
    invert(): this
    multiply(m: Matrix4): this
    multiplyMatrices(a: Matrix4, b: Matrix4): this
    determinant(): number
  }

  export class Object3D {
    name: string
    position: Vector3
    rotation: Euler
    // Rotation et quaternion sont liés (écrire l'un met l'autre à jour) : c'est
    // ce qui permet à l'idle d'ajouter ses offsets en Euler par-dessus une
    // animation .vrma, qui écrit elle des quaternions.
    quaternion: Quaternion
    scale: Vector3
    visible: boolean
    parent: Object3D | null
    children: Object3D[]
    matrixWorld: Matrix4
    // Les deux verrous du GEL des décors (cf. envMerge) : sans recomposition
    // locale par image, et sans descente du parcours de scene.updateMatrixWorld
    // dans la branche (three r144+).
    matrixAutoUpdate: boolean
    matrixWorldAutoUpdate: boolean
    add(...objects: Object3D[]): this
    remove(...objects: Object3D[]): this
    traverse(callback: (object: Object3D) => void): void
    getWorldPosition(target: Vector3): Vector3
    getWorldQuaternion(target: Quaternion): Quaternion
    updateMatrixWorld(force?: boolean): void
    /**
     * Recompose la matrice monde de CE nœud, et de ses parents si demandé, sans
     * descendre dans ses enfants. C'est ce dont la cinématique inverse a besoin :
     * elle lit et écrit une chaîne de trois os, pas un squelette entier — et
     * contrairement à updateMatrixWorld, cet appel ne baisse pas le drapeau
     * `matrixWorldNeedsUpdate`, donc la passe de rendu fait son travail comme
     * d'habitude ensuite.
     */
    updateWorldMatrix(updateParents: boolean, updateChildren: boolean): void
    localToWorld(vector: Vector3): Vector3
    worldToLocal(vector: Vector3): Vector3
  }

  export class Group extends Object3D {}
  export class Scene extends Object3D {}
  export class Camera extends Object3D {}

  export class PerspectiveCamera extends Camera {
    constructor(fov?: number, aspect?: number, near?: number, far?: number)
    fov: number
    aspect: number
    near: number
    far: number
    updateProjectionMatrix(): void
  }

  export class Light extends Object3D {
    intensity: number
  }
  export class DirectionalLight extends Light {
    constructor(color?: number | string, intensity?: number)
  }
  export class HemisphereLight extends Light {
    constructor(skyColor?: number | string, groundColor?: number | string, intensity?: number)
  }
  export class AmbientLight extends Light {
    constructor(color?: number | string, intensity?: number)
  }

  export class Clock {
    constructor(autoStart?: boolean)
    getDelta(): number
    getElapsedTime(): number
    start(): void
    stop(): void
  }

  // Couleur d'un matériau. Les composantes sont des flottants dans l'espace de
  // travail de three (linéaire) et ne sont PAS bornées à 1 : c'est l'exposition
  // des décors qui décide de les borner ou non (cf. vrmStage/exposedClone).
  export class Color {
    r: number
    g: number
    b: number
    /**
     * Pose une couleur donnée dans un ESPACE nommé (three la convertit vers son
     * espace de travail linéaire). Les marqueurs de clic lisent la couleur
     * d'accent dans le CSS, donc en sRGB : sans le troisième argument, three
     * prendrait ces composantes pour du linéaire et l'anneau sortirait délavé.
     */
    setRGB(r: number, g: number, b: number, colorSpace?: string): this
  }

  // Référencés par les .d.ts de @pixiv/three-vrm (skipLibCheck, mais les noms doivent exister).
  export class Material {
    // Clone INDÉPENDANT : les Color (`color`, `emissive`) sont recopiées, les
    // textures restent partagées avec l'original par référence.
    clone(): this
    dispose(): void
  }
  export class BufferGeometry {
    clone(): this
    applyMatrix4(matrix: Matrix4): this
    dispose(): void
  }
  export class Mesh extends Object3D {
    // Un mesh porte UN matériau, ou un par groupe de faces — l'exposition des
    // décors doit gérer les deux cas.
    constructor(geometry?: BufferGeometry, material?: Material | Material[])
    geometry: BufferGeometry
    material: Material | Material[]
  }
  export class SkinnedMesh extends Mesh {}

  // ── Panneaux de fond des décors (cf. vrmStage/addEnvBackdrops) ────────────
  export class PlaneGeometry extends BufferGeometry {
    constructor(width?: number, height?: number)
  }
  /** Anneau plat dans le plan XY (cf. scene/clickMark.ts — les marqueurs de clic). */
  export class RingGeometry extends BufferGeometry {
    constructor(innerRadius?: number, outerRadius?: number, thetaSegments?: number)
  }
  export class MeshBasicMaterial extends Material {
    constructor(parameters?: Record<string, unknown>)
    color: Color
    side: number
    /** Écrite par image pendant l'estompage d'un marqueur de clic. */
    opacity: number
  }
  /** Faces visibles des deux côtés (Material.side). */
  export const DoubleSide: number

  // ── Animation (.vrma) ──────────────────────────────────────────────────────
  // Les pistes ne sont JAMAIS construites ici : elles arrivent des .vrma via
  // createVRMAnimationClip. Elles doivent exister quand même, car les .d.ts de
  // @pixiv/three-vrm-animation les nomment — sans elles, skipLibCheck les
  // remplace en silence par `any` et le clip perd tout typage.
  export class KeyframeTrack {
    name: string
  }
  export class QuaternionKeyframeTrack extends KeyframeTrack {}
  export class VectorKeyframeTrack extends KeyframeTrack {}
  export class NumberKeyframeTrack extends KeyframeTrack {}

  export class AnimationClip {
    constructor(name?: string, duration?: number, tracks?: KeyframeTrack[])
    name: string
    duration: number
    tracks: KeyframeTrack[]
  }

  // Modes de bouclage (AnimationAction.setLoop) : une fois, ou en boucle.
  export const LoopOnce: number
  export const LoopRepeat: number

  export class AnimationAction {
    enabled: boolean
    // Une action à cycle unique terminée avec clampWhenFinished reste ACTIVE et
    // mise en pause sur sa dernière image : c'est ce qui lui permet de participer
    // à son propre fondu de sortie (cf. vrmStage/playGesture). `paused` est remis
    // à faux à la main quand elle reprend la main.
    paused: boolean
    weight: number
    time: number
    clampWhenFinished: boolean
    getClip(): AnimationClip
    reset(): this
    play(): this
    stop(): this
    setLoop(mode: number, repetitions: number): this
    setEffectiveWeight(weight: number): this
    // fadeIn/fadeOut/crossFade* NE SONT PAS déclarés : les poids sont pilotés à la
    // main (cf. vrmStage/fadeWeights), et les fondus de three ne savent pas se
    // recouvrir sans faire déraper la somme des poids.
  }

  /** Événement 'finished' du mixer : l'action à cycle unique qui vient de s'achever. */
  export interface AnimationFinishedEvent {
    type: 'finished'
    action: AnimationAction
    direction: number
  }

  export class AnimationMixer {
    constructor(root: Object3D)
    update(delta: number): this
    clipAction(clip: AnimationClip, root?: Object3D): AnimationAction
    stopAllAction(): this
    uncacheRoot(root: Object3D): void
    addEventListener(type: 'finished', listener: (event: AnimationFinishedEvent) => void): void
    removeEventListener(type: 'finished', listener: (event: AnimationFinishedEvent) => void): void
  }

  export const SRGBColorSpace: 'srgb'

  // Enums de mappage souris/tactile (OrbitControls.mouseButtons / .touches).
  export const MOUSE: {
    LEFT: number
    MIDDLE: number
    RIGHT: number
    ROTATE: number
    DOLLY: number
    PAN: number
  }
  export const TOUCH: {
    ROTATE: number
    PAN: number
    DOLLY_PAN: number
    DOLLY_ROTATE: number
  }

  export class WebGLRenderer {
    constructor(parameters?: { alpha?: boolean; antialias?: boolean; canvas?: HTMLCanvasElement })
    domElement: HTMLCanvasElement
    outputColorSpace: string
    setPixelRatio(value: number): void
    setSize(width: number, height: number, updateStyle?: boolean): void
    render(scene: Object3D, camera: Camera): void
    dispose(): void
  }
}

declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  import { Group } from 'three'

  export interface GLTF {
    scene: Group
    scenes: Group[]
    userData: Record<string, unknown>
  }

  export interface GLTFLoaderPlugin {
    name: string
  }

  export class GLTFParser {
    json: unknown
  }

  export class GLTFLoader {
    constructor()
    register(callback: (parser: GLTFParser) => GLTFLoaderPlugin): this
    load(
      url: string,
      onLoad: (gltf: GLTF) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (error: unknown) => void,
    ): void
    loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<GLTF>
  }
}

declare module 'three/examples/jsm/utils/BufferGeometryUtils.js' {
  import { BufferGeometry } from 'three'

  /**
   * Fusionne des géométries HOMOGÈNES (mêmes attributs, même indexation) en une
   * seule ; null en cas d'échec — envMerge regroupe par signature précisément
   * pour ne jamais lui présenter un lot hétérogène.
   */
  export function mergeGeometries(geometries: BufferGeometry[], useGroups?: boolean): BufferGeometry | null
}

declare module 'three/examples/jsm/controls/OrbitControls.js' {
  import { Camera, Vector3 } from 'three'

  export class OrbitControls {
    constructor(object: Camera, domElement?: HTMLElement)
    target: Vector3
    enabled: boolean
    enableDamping: boolean
    dampingFactor: number
    enablePan: boolean
    enableZoom: boolean
    screenSpacePanning: boolean
    minDistance: number
    maxDistance: number
    minPolarAngle: number
    maxPolarAngle: number
    mouseButtons: { LEFT?: number | null; MIDDLE?: number | null; RIGHT?: number | null }
    touches: { ONE?: number | null; TWO?: number | null }
    addEventListener(type: 'start' | 'change' | 'end', listener: () => void): void
    removeEventListener(type: 'start' | 'change' | 'end', listener: () => void): void
    update(): boolean
    dispose(): void
  }
}
