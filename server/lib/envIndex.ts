// Index des décors 3D : qui est analysé, qui ne l'est pas, et la file d'attente
// qui rattrape le retard en tâche de fond.
//
// Le propriétaire veut qu'un décor déposé dans `environments/` s'analyse tout
// seul et s'affiche « quand c'est prêt ». D'où trois règles :
//  1. le balayage est PASSIF — au démarrage, et à chaque listing de décors. Pas
//     de fs.watch (capricieux sur Windows, et un .glb de 9 Mo arrive en
//     plusieurs écritures : on verrait un fichier tronqué).
//  2. l'analyse tourne UNE À LA FOIS, en rendant la main à la boucle
//     d'événements toutes les quelques millisecondes — le chat ne doit pas
//     hoqueter parce qu'une pièce se mesure.
//  3. un échec est DÉFINITIF jusqu'à la prochaine modification du fichier :
//     inutile de remesurer en boucle une géométrie qu'on ne sait pas lire. Le
//     décor reste utilisable comme fond, simplement sans interaction.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { EnvironmentEntry, SceneFile, SceneState } from '../../shared/types'
import { GlbUnsupportedError } from './glb'
import {
  SCENE_EXT,
  SCENE_FORMAT,
  SCENE_VERSION,
  analyseEnvironment,
  placementFingerprint,
  readPlacement,
  scenePathFor,
  spawnTrouble,
  writeScene,
  type EnvPlacement,
} from './envScene'
import { ENVIRONMENTS_DIR } from './storage'

const MODEL_EXTENSIONS = ['.glb', '.gltf']
/** Intervalle minimal entre deux balayages du dossier, hors démarrage (ms). */
const SCAN_THROTTLE_MS = 1000

interface Entry {
  name: string
  file: string
  state: SceneState
  reason?: string
  seats?: number
  walkArea?: number
  /** Dernière observation du .glb, du placement et du fichier d'analyse : évite de tout revérifier à chaque listing. */
  bytes: number
  mtimeMs: number
  placement: string
  /** Signature du `.scene.json` tel qu'on l'a laissé — `''` s'il n'existait pas. */
  scene: string
}

/** Signature bon marché d'un fichier : taille et date. Absent = chaîne vide. */
function signature(file: string): string {
  try {
    const stat = fs.statSync(file)
    return `${stat.size}:${Math.round(stat.mtimeMs)}`
  } catch {
    return ''
  }
}

const index = new Map<string, Entry>()
const queue: string[] = []
let running = false
let lastScan = 0

/** Nom de fichier d'un décor → nom court (sans extension). */
function stemOf(fileName: string): string {
  return fileName.replace(/\.(glb|gltf)$/i, '')
}

/** Modèles présents dans le dossier des décors. Dossier absent = liste vide, jamais d'erreur. */
export function listEnvironmentModels(): string[] {
  if (!fs.existsSync(ENVIRONMENTS_DIR)) return []
  return fs
    .readdirSync(ENVIRONMENTS_DIR)
    .filter((f) => MODEL_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)))
    // `piece.scene.glb` produirait `piece.scene.json`, qui est déjà le sidecar de
    // placement de `piece.glb`. On ne joue pas à ça.
    .filter((f) => !stemOf(f).toLowerCase().endsWith('.scene'))
    .sort((a, b) => a.localeCompare(b))
}

/**
 * L'analyse posée à côté du modèle est-elle encore valable ?
 * On compare d'abord le bon marché (taille, date), puis l'empreinte du contenu :
 * un `git checkout` change la date sans changer un octet, et refaire l'analyse
 * pour ça serait du gâchis.
 */
function readFreshScene(
  file: string,
  bytes: number,
  mtimeMs: number,
  fingerprint: string,
  sidecar: EnvPlacement,
): SceneFile | null {
  const scenePath = scenePathFor(file)
  let scene: SceneFile
  try {
    scene = JSON.parse(fs.readFileSync(scenePath, 'utf8')) as SceneFile
  } catch {
    return null
  }
  if (scene?.format !== SCENE_FORMAT || scene.version !== SCENE_VERSION) return null
  if (!scene.source || !scene.grid || !Array.isArray(scene.seats)) return null
  if (scene.placement?.fingerprint !== fingerprint) return null
  // Une analyse d'AVANT le calage automatique, faite sur un décor qui en aurait
  // besoin : c'est exactement le décor qui donnait un écran noir muet, et rien
  // dans le .glb ni dans le sidecar n'a changé pour le signaler. On la refait
  // UNE FOIS. Le champ `spawnAuto`, une fois écrit — fût-il `null`, « on a
  // cherché, il n'y a nulle part où poser quelqu'un » — rend l'analyse
  // définitive : jamais de remesure en boucle sur un décor sans issue.
  if (scene.placement.spawnAuto === undefined && sidecar.spawn === undefined && spawnTrouble(scene)) return null
  if (scene.source.bytes !== bytes) return null
  if (scene.source.mtimeMs === mtimeMs) return scene
  const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16)
  return digest === scene.source.sha256 ? scene : null
}

/**
 * Balaye le dossier et met la file à jour. Bon marché : un `readdir` et un
 * `stat` par décor tant que rien ne bouge.
 */
export function refreshEnvironmentIndex(force = false): void {
  const now = Date.now()
  if (!force && now - lastScan < SCAN_THROTTLE_MS) return
  lastScan = now
  const present = new Set<string>()
  for (const fileName of listEnvironmentModels()) {
    const name = stemOf(fileName)
    present.add(name)
    const file = path.join(ENVIRONMENTS_DIR, fileName)
    let bytes = 0
    let mtimeMs = 0
    try {
      const stat = fs.statSync(file)
      bytes = stat.size
      mtimeMs = Math.round(stat.mtimeMs)
    } catch {
      continue // disparu entre le readdir et le stat
    }
    const sidecar = readPlacement(file)
    const placement = placementFingerprint(sidecar)
    // La signature du fichier d'analyse compte AUSSI : l'effacer à la main doit
    // relancer l'analyse, et c'est la façon la plus naturelle de dire « refais-la ».
    const sceneSignature = signature(scenePathFor(file))
    const known = index.get(name)
    if (
      known &&
      known.bytes === bytes &&
      known.mtimeMs === mtimeMs &&
      known.placement === placement &&
      known.scene === sceneSignature
    ) {
      continue // rien n'a bougé : l'état connu fait foi (y compris un échec)
    }
    const scene = readFreshScene(file, bytes, mtimeMs, placement, sidecar)
    const common = { name, file, bytes, mtimeMs, placement, scene: sceneSignature }
    const entry: Entry = scene
      ? { ...common, state: 'ready', seats: scene.seats.length, walkArea: scene.room.walkArea }
      : { ...common, state: 'pending' }
    index.set(name, entry)
    if (!scene && !queue.includes(name)) queue.push(name)
  }
  for (const name of [...index.keys()]) if (!present.has(name)) index.delete(name)
  void processQueue()
}

/** Traite la file, une analyse à la fois. Ne lève jamais : un décor illisible reste un fond. */
async function processQueue(): Promise<void> {
  if (running) return
  running = true
  try {
    while (queue.length > 0) {
      const name = queue.shift() as string
      const entry = index.get(name)
      if (!entry || entry.state !== 'pending') continue
      entry.state = 'analyzing'
      try {
        const { scene, report } = await analyseEnvironment(entry.file)
        writeScene(entry.file, scene)
        entry.state = 'ready'
        entry.seats = scene.seats.length
        entry.walkArea = scene.room.walkArea
        // On vient d'écrire le fichier : ré-observer sa signature, sinon le
        // balayage suivant le croirait modifié par un tiers et remesurerait tout.
        entry.scene = signature(scenePathFor(entry.file))
        delete entry.reason
        // Le calage automatique se DIT : c'est un décor qu'on a déplacé sous les
        // pieds du personnage, et son auteur doit pouvoir le figer d'un sidecar
        // s'il préfère un autre endroit.
        const calage = report.spawnAuto
          ? ` — point d’accueil calculé [${report.spawnAuto.join(', ')}] (l’origine du modèle n’en est pas un)`
          : report.spawnTrouble
            ? ' — aucun point d’accueil praticable trouvé : le décor reste un fond'
            : ''
        console.log(
          `[décor] ${name} : analysé en ${(report.ms / 1000).toFixed(1)} s — ` +
            `${scene.room.walkArea} m² praticables, ${scene.seats.length} assises${calage}`,
        )
      } catch (e) {
        entry.state = e instanceof GlbUnsupportedError ? 'unsupported' : 'failed'
        entry.reason = e instanceof Error ? e.message : String(e)
        console.warn(`[décor] ${name} : analyse impossible — ${entry.reason}`)
      }
    }
  } finally {
    running = false
  }
}

/** État de chaque décor, pour `GET /api/environments`. */
export function environmentEntries(): EnvironmentEntry[] {
  const out: EnvironmentEntry[] = []
  for (const fileName of listEnvironmentModels()) {
    const name = stemOf(fileName)
    const entry = index.get(name)
    const state: SceneState = entry?.state ?? 'pending'
    out.push({
      url: `/environments/${encodeURIComponent(fileName)}`,
      name,
      state,
      scene: state === 'ready' ? `/environments/${encodeURIComponent(name + SCENE_EXT)}` : null,
      ...(entry?.reason ? { reason: entry.reason } : {}),
      ...(state === 'ready' && entry ? { seats: entry.seats, walkArea: entry.walkArea } : {}),
    })
  }
  return out
}

/** Démarrage : premier balayage, hors du chemin critique du boot. */
export function startEnvironmentIndex(): void {
  setTimeout(() => refreshEnvironmentIndex(true), 0)
}
