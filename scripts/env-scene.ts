// Analyse des décors 3D, à la main.
//
//   npm run env:scene                    ce qui manque ou a changé
//   npm run env:scene -- --all           tout refaire
//   npm run env:scene -- rustic-bedroom  un décor, et le détail de ce qui a été trouvé
//   npm run env:scene -- --explain       en plus : pourquoi telle assise a été écartée
//   npm run env:scene -- --dry           ne rien écrire
//
// Le serveur fait exactement la même chose au démarrage (server/lib/envIndex.ts) ;
// ce script sert à comprendre, pas à remplacer.
import fs from 'node:fs'
import path from 'node:path'
import { ENVIRONMENTS_DIR } from '../server/lib/storage'
import { GlbUnsupportedError } from '../server/lib/glb'
import {
  SCENE_FORMAT,
  SCENE_VERSION,
  analyseEnvironment,
  placementFingerprint,
  readPlacement,
  scenePathFor,
  writeScene,
  type RejectedSeat,
} from '../server/lib/envScene'
import { listEnvironmentModels } from '../server/lib/envIndex'
import type { SceneFile } from '../shared/types'

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const names = args.filter((a) => !a.startsWith('--'))
const all = flags.has('--all')
const explain = flags.has('--explain')
const dry = flags.has('--dry')

function m(v: number): string {
  return `${v.toFixed(2)} m`
}

/** L'analyse existante colle-t-elle encore au modèle ? Même règle que le serveur, en plus bavard. */
function staleReason(file: string): string | null {
  let scene: SceneFile
  try {
    scene = JSON.parse(fs.readFileSync(scenePathFor(file), 'utf8')) as SceneFile
  } catch {
    return 'aucune analyse'
  }
  if (scene?.format !== SCENE_FORMAT) return 'format inconnu'
  if (scene.version !== SCENE_VERSION) return `format v${scene.version}, attendu v${SCENE_VERSION}`
  const stat = fs.statSync(file)
  if (scene.source.bytes !== stat.size) return 'le .glb a changé de taille'
  if (scene.placement?.fingerprint !== placementFingerprint(readPlacement(file))) return 'le placement a changé'
  if (scene.source.mtimeMs !== Math.round(stat.mtimeMs)) return 'date du .glb différente (contenu à revérifier)'
  return null
}

function showRejected(rejected: RejectedSeat[], issues: { reason: string; cells: number }[]): void {
  if (issues.length > 0) {
    console.log('  cases écartées avant même de former une nappe :')
    for (const i of issues) console.log(`    ${String(i.cells).padStart(5)} cases — ${i.reason}`)
  }
  if (rejected.length === 0) {
    console.log('  aucune nappe d’assise écartée')
    return
  }
  console.log(`  candidats d’assise écartés : ${rejected.length}`)
  const byReason = new Map<string, number>()
  for (const r of rejected) {
    const key = r.reason.replace(/\([^)]*\)/, '').trim()
    byReason.set(key, (byReason.get(key) ?? 0) + 1)
  }
  for (const [reason, count] of byReason) console.log(`    ${count} × ${reason}`)
  for (const r of rejected.slice(0, 12)) {
    console.log(`    [${r.center[0].toFixed(2)}, ${r.center[1].toFixed(2)}] y=${r.y.toFixed(3)} — ${r.reason}`)
  }
}

function showDetail(scene: SceneFile): void {
  const [bx0, , bz0, bx1, , bz1] = scene.room.modelBounds
  const [wx0, wz0, wx1, wz1] = scene.room.walkBounds
  console.log(`  boîte du modèle placé : ${m(bx1 - bx0)} × ${m(bz1 - bz0)} au sol`)
  console.log(`  pièce (zone atteignable) : ${m(wx1 - wx0)} × ${m(wz1 - wz0)}, ${scene.room.walkArea} m² praticables`)
  console.log(`  plafond : ${scene.room.ceiling === null ? 'aucun (décor ouvert)' : m(scene.room.ceiling)}   sol de référence : ${scene.room.ground.toFixed(3)} m`)
  console.log(
    `  grille : ${scene.grid.cols} × ${scene.grid.rows} cases de ${scene.grid.cell} m ` +
      `depuis [${scene.grid.origin[0].toFixed(2)}, ${scene.grid.origin[1].toFixed(2)}], ${scene.grid.levels.length} niveau(x)`,
  )
  console.log(`    niveaux : ${scene.grid.levels.map((v) => v.toFixed(3)).join(' · ')}`)
  const rose = scene.camera.clearance
  console.log(`  dégagement caméra (à ${scene.camera.eye} m, depuis le point d’accueil) :`)
  console.log(`    +Z ${rose[0].toFixed(1)}  ·  +X ${rose[4].toFixed(1)}  ·  −Z ${rose[8].toFixed(1)}  ·  −X ${rose[12].toFixed(1)}`)
  console.log(`  assises : ${scene.seats.length}`)
  const byHeight = [...scene.seats].sort((a, b) => a.y - b.y)
  for (const seat of byHeight.slice(0, 30)) {
    console.log(
      `    ${seat.id.padEnd(9)} y=${seat.y.toFixed(3)} m  aire=${seat.area.toFixed(2)} m²  ` +
        `centre=[${seat.center[0].toFixed(2)}, ${seat.center[1].toFixed(2)}]  regard=${seat.yaw.toFixed(0)}°` +
        `${seat.back ? ' (dossier)' : ' (ouverture)'}${seat.approach ? '' : '  — sans accès à pied'}`,
    )
  }
  if (byHeight.length > 30) console.log(`    … et ${byHeight.length - 30} autres`)
  // Histogramme des hauteurs d'assise : c'est là qu'on reconnaît le mobilier.
  const buckets = new Map<number, number>()
  for (const seat of scene.seats) {
    const k = Math.round(seat.y * 20) / 20
    buckets.set(k, (buckets.get(k) ?? 0) + 1)
  }
  console.log('  hauteurs d’assise (regroupées à 5 cm) :')
  for (const [y, n] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`    ${y.toFixed(2)} m  ${'█'.repeat(Math.min(n, 40))} ${n}`)
  }
  console.log('  carte du sol (extrait, une ligne = une rangée en z croissant) :')
  const step = Math.max(1, Math.ceil(scene.grid.rows / 40))
  for (let j = 0; j < scene.grid.rows; j += step) console.log(`    ${scene.grid.map[j]}`)
  // Même carte, avec l'emprise des assises en surimpression : c'est là qu'on
  // voit d'un coup d'œil si une nappe a été prise pour ce qu'elle est.
  const marks = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const overlay = scene.grid.map.map((row) => row.split(''))
  scene.seats.forEach((seat, n) => {
    const mark = marks[n % marks.length]
    const [x0, z0, x1, z1] = seat.bounds
    for (let j = Math.floor((z0 - scene.grid.origin[1]) / scene.grid.cell); j < (z1 - scene.grid.origin[1]) / scene.grid.cell; j++) {
      for (let i = Math.floor((x0 - scene.grid.origin[0]) / scene.grid.cell); i < (x1 - scene.grid.origin[0]) / scene.grid.cell; i++) {
          // Seulement là où il y a une surface : l'emprise est un rectangle, la
        // nappe non — peindre le vide donnerait une assise imaginaire.
        if (overlay[j] && overlay[j][i] && overlay[j][i] !== '.') overlay[j][i] = mark
      }
    }
  })
  console.log('  emprise des assises (une lettre par assise, dans l’ordre de la liste) :')
  for (let j = 0; j < scene.grid.rows; j += step) console.log(`    ${overlay[j].join('')}`)
}

async function main(): Promise<void> {
  const models = listEnvironmentModels()
  if (models.length === 0) {
    console.log(`Aucun décor dans ${ENVIRONMENTS_DIR}`)
    return
  }
  const selected = names.length > 0 ? models.filter((f) => names.includes(f.replace(/\.(glb|gltf)$/i, ''))) : models
  if (selected.length === 0) {
    console.log(`Décor inconnu. Disponibles : ${models.map((f) => f.replace(/\.(glb|gltf)$/i, '')).join(', ')}`)
    process.exitCode = 1
    return
  }
  const detail = names.length > 0 || selected.length === 1

  for (const fileName of selected) {
    const file = path.join(ENVIRONMENTS_DIR, fileName)
    const name = fileName.replace(/\.(glb|gltf)$/i, '')
    const reason = staleReason(file)
    if (!all && names.length === 0 && reason === null) {
      console.log(`${name} : analyse à jour`)
      continue
    }
    console.log(`\n${name} — ${reason ?? 'régénération demandée'}`)
    try {
      // budgetMs infini : en ligne de commande rien d'autre n'attend le processeur.
      const { scene, report } = await analyseEnvironment(file, { budgetMs: Infinity, explain })
      if (!dry) writeScene(file, scene)
      const target = scenePathFor(file)
      const size = dry ? 0 : fs.statSync(target).size
      console.log(
        `  ${report.triangles.toLocaleString('fr-FR')} triangles → ${report.samples.toLocaleString('fr-FR')} échantillons ` +
          `en ${(report.ms / 1000).toFixed(2)} s${report.autoRescaled ? ` (échelle rattrapée à ${report.scale.toFixed(5)})` : ''}`,
      )
      if (!dry) console.log(`  écrit : ${path.basename(target)} (${(size / 1024).toFixed(1)} Ko)`)
      else console.log('  --dry : rien écrit')
      if (detail) showDetail(scene)
      if (explain) showRejected(report.rejectedSeats, report.seatIssues)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error(`  ÉCHEC${e instanceof GlbUnsupportedError ? ' (format)' : ''} : ${message}`)
      process.exitCode = 1
    }
  }
}

void main()
