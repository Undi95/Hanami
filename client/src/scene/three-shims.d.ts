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
  }

  export class Box3 {
    min: Vector3
    max: Vector3
    constructor(min?: Vector3, max?: Vector3)
    setFromObject(object: Object3D, precise?: boolean): this
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

  export class Object3D {
    name: string
    position: Vector3
    rotation: Euler
    scale: Vector3
    visible: boolean
    parent: Object3D | null
    children: Object3D[]
    add(...objects: Object3D[]): this
    remove(...objects: Object3D[]): this
    traverse(callback: (object: Object3D) => void): void
    getWorldPosition(target: Vector3): Vector3
    updateMatrixWorld(force?: boolean): void
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

  // Référencés par les .d.ts de @pixiv/three-vrm (skipLibCheck, mais les noms doivent exister).
  export class Material {
    dispose(): void
  }
  export class Mesh extends Object3D {}
  export class SkinnedMesh extends Mesh {}

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
