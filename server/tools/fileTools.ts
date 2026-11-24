// Outils fichiers exposés au modèle — SANDBOX STRICTE, et PROPRE À CHAQUE
// PERSONNAGE : <settings.toolsRoot>/<id du personnage>. Ce n'est pas un réglage :
// un personnage ne voit ni le dossier d'un autre, ni ce qui est posé à la racine
// commune. C'est SON dossier — l'endroit où ranger ses notes et ce qu'il écrit,
// plutôt que de tout garder dans le contexte ou dans la mémoire injectée.
// Chaque chemin est résolu contre cette racine ; tout ce qui en sort (y compris
// via un lien symbolique) est refusé.
import fs from 'node:fs'
import path from 'node:path'
import type { Settings } from '../../shared/types'
import { DATA_DIR, ROOT, sanitizeFileName } from '../lib/storage'

const READ_CAP = 256 * 1024 // 256 Ko

export const FILE_TOOL_NAMES = ['list_files', 'read_file', 'write_file', 'edit_file', 'delete_file'] as const

export const fileToolDefs: unknown[] = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'Lists the files in your own working folder (folders are suffixed with "/"). The folder is yours alone: a good place to keep your notes.',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Relative subfolder (default: root of your working folder)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Reads a text file from your own working folder (truncated at 256 KB).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Writes (creates or replaces) a file in your own working folder.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path' },
          content: { type: 'string', description: 'Full content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Replaces ONE exact occurrence of old_string with new_string in a file. Errors if old_string is absent or appears more than once.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path' },
          old_string: { type: 'string', description: 'Exact text to replace (must be unique in the file)' },
          new_string: { type: 'string', description: 'Replacement text' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Deletes a file from your own working folder (only if deletion is allowed in settings).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path' },
        },
        required: ['path'],
      },
    },
  },
]

function requireString(args: Record<string, unknown>, field: string): string {
  const v = args[field]
  if (typeof v !== 'string') throw new Error(`missing or invalid parameter "${field}"`)
  return v
}

/** La racine COMMUNE, validée et créée au besoin (symlinks résolus) : les dossiers des personnages y vivent. */
function sharedRoot(settings: Settings): string {
  // Défense en profondeur (loadSettings valide déjà) : une racine vide ou relative
  // retomberait sur le cwd, c'est-à-dire la racine du projet.
  if (typeof settings.toolsRoot !== 'string' || !settings.toolsRoot.trim() || !path.isAbsolute(settings.toolsRoot)) {
    throw new Error('invalid toolsRoot: an absolute path is required in settings')
  }
  const root = path.resolve(settings.toolsRoot)
  // Refuse la racine projet, data/ et tout ancêtre de ceux-ci : le modèle pourrait
  // sinon lire data/config.json ou écrire dans server/.
  const norm = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s)
  for (const forbidden of [ROOT, DATA_DIR]) {
    const f = path.resolve(forbidden)
    if (norm(root) === norm(f) || isInside(norm(root), norm(f))) {
      throw new Error(`invalid toolsRoot: ${root} contains the app's own files — pick a dedicated folder (e.g. data/workspace)`)
    }
  }
  fs.mkdirSync(root, { recursive: true })
  return fs.realpathSync(root)
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep)
}

/**
 * Le nom du dossier d'un personnage : son identifiant, tel quel. Refusé s'il
 * pouvait désigner autre chose qu'un dossier posé DANS la racine (séparateur,
 * « .. », nom vide) — l'identifiant vient du serveur, mais c'est lui qui borne
 * la sandbox : il est vérifié ici, pas supposé.
 */
function ownFolderName(characterId: string): string {
  let safe = ''
  try {
    safe = sanitizeFileName(characterId)
  } catch {
    /* vide, ou fait de points */
  }
  // Ni point ni espace au bout : Windows les retire, « nom. » y désignerait le dossier de « nom ».
  // Ni le nom d'un dossier mis de côté (cf. retireWorkspace) : celui-là n'est plus à personne.
  // Ni vide : un nom vide désignerait la racine commune elle-même.
  if (
    typeof characterId !== 'string' ||
    safe === '' ||
    safe !== characterId ||
    safe.startsWith('.') ||
    /[. ]$/.test(safe) ||
    SET_ASIDE.test(safe) ||
    safe.length > 100
  ) {
    throw new Error('invalid character id: no working folder for it')
  }
  return safe
}

/** Le nom que porte le dossier d'un personnage supprimé : « <id>.deleted-AAAAMMJJ-HHMMSS », avec un rang en cas de doublon. */
const SET_ASIDE = /\.deleted-\d{8}-\d{6}(-\d+)?$/

/**
 * Racine réelle de la sandbox DE CE PERSONNAGE (créée au besoin) :
 * <toolsRoot>/<id>. Un lien posé à cet endroit pour l'emmener ailleurs — vers le
 * dossier d'un autre, ou hors de la racine — est refusé.
 */
function sandboxRoot(settings: Settings, characterId: string): string {
  const shared = sharedRoot(settings)
  const name = ownFolderName(characterId)
  const own = path.join(shared, name)
  if (fs.lstatSync(own, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error("invalid working folder: this character's folder is a link")
  }
  fs.mkdirSync(own, { recursive: true })
  const real = fs.realpathSync(own)
  if (!sameName(path.dirname(real), shared) || !hasOwnName(own, name)) {
    throw new Error("invalid working folder: this character's folder is not its own")
  }
  return real
}

const sameName = (a: string, b: string): boolean => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)

/**
 * Le dossier `own` porte-t-il VRAIMENT le nom `name` ? Sous Windows un dossier
 * a parfois un second nom, court (« PERSON~1 ») : un identifiant écrit ainsi
 * ouvrirait le dossier d'un autre. Seul le chemin canonique du système le dit
 * (realpathSync.native) — la résolution faite en JavaScript, elle, rend le nom
 * court tel quel.
 */
function hasOwnName(own: string, name: string): boolean {
  try {
    return sameName(path.basename(fs.realpathSync.native(own)), name)
  } catch {
    return false
  }
}

/**
 * Le dossier d'un personnage SUPPRIMÉ est mis de côté, jamais effacé : ce sont
 * des fichiers que l'utilisateur peut vouloir garder (vide, il est simplement
 * retiré). Sans cela, un personnage recréé sous le même nom hériterait des notes
 * de son prédécesseur — même raison que pour son portrait. Rend ce qui a été
 * fait ; ne lève pas pour un dossier absent ou une racine invalide.
 */
export function retireWorkspace(settings: Settings, characterId: string, now = new Date()): 'none' | 'removed' | 'set-aside' {
  let shared: string
  let own: string
  try {
    shared = sharedRoot(settings)
    own = path.join(shared, ownFolderName(characterId))
  } catch {
    return 'none'
  }
  // Seconde garde, indépendante de la première : ce qui va être déplacé doit être
  // un dossier posé DIRECTEMENT dans la racine — jamais la racine, jamais un lien.
  if (path.dirname(own) !== shared || path.basename(own) === '') return 'none'
  const stat = fs.lstatSync(own, { throwIfNoEntry: false })
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) return 'none'
  // Ni le dossier d'un AUTRE, désigné par son second nom (cf. hasOwnName).
  if (!hasOwnName(own, path.basename(own))) return 'none'
  if (fs.readdirSync(own).length === 0) {
    fs.rmdirSync(own)
    return 'removed'
  }
  const pad = (v: number): string => String(v).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  // Un nom qu'ownFolderName refuse comme identifiant : ce dossier ne redeviendra celui de personne.
  let aside = path.join(shared, `${characterId}.deleted-${stamp}`)
  for (let i = 2; fs.existsSync(aside); i++) aside = path.join(shared, `${characterId}.deleted-${stamp}-${i}`)
  fs.renameSync(own, aside)
  return 'set-aside'
}

/**
 * Résout `p` contre la racine et refuse toute sortie de sandbox.
 * Anti-symlink : les ancêtres sont sondés via lstat (qui ne suit PAS les liens,
 * contrairement à existsSync qui rend false sur un lien cassé) ; le plus proche
 * ancêtre existant est résolu en chemin réel (realpathSync), le chemin cible est
 * reconstruit dessus et re-vérifié contre la racine. Le composant final ne doit
 * pas être un lien symbolique, même cassé.
 */
function resolveSafe(root: string, p: string): string {
  const resolved = path.resolve(root, p)
  if (!isInside(root, resolved)) throw new Error(`path outside the allowed folder: ${p}`)
  if (fs.lstatSync(resolved, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`path outside the allowed folder (symbolic link): ${p}`)
  }
  let probe = path.dirname(resolved)
  while (!fs.lstatSync(probe, { throwIfNoEntry: false })) {
    const up = path.dirname(probe)
    if (up === probe) break
    probe = up
  }
  const realDir = fs.realpathSync(probe)
  const target = path.join(realDir, path.relative(probe, resolved))
  if (!isInside(root, target)) throw new Error(`path outside the allowed folder (symbolic link): ${p}`)
  return target
}

/**
 * Exécute un outil fichier DANS LE DOSSIER DU PERSONNAGE ; renvoie une chaîne
 * courte pour le modèle. Erreurs → throw.
 */
export function executeFileTool(settings: Settings, characterId: string, tool: string, args: Record<string, unknown>): string {
  const root = sandboxRoot(settings, characterId)
  switch (tool) {
    case 'list_files': {
      const dir = typeof args.dir === 'string' && args.dir.length > 0 ? args.dir : '.'
      const target = resolveSafe(root, dir)
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        throw new Error(`folder not found: ${dir}`)
      }
      const entries = fs
        .readdirSync(target, { withFileTypes: true })
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
      return entries.length > 0 ? entries.join('\n') : '(empty folder)'
    }
    case 'read_file': {
      const p = requireString(args, 'path')
      const target = resolveSafe(root, p)
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        throw new Error(`file not found: ${p}`)
      }
      const size = fs.statSync(target).size
      const fd = fs.openSync(target, 'r')
      try {
        const buf = Buffer.alloc(Math.min(size, READ_CAP))
        fs.readSync(fd, buf, 0, buf.length, 0)
        let text = buf.toString('utf8')
        if (size > READ_CAP) text += `\n… [truncated: ${size} bytes total, 256 KB read cap]`
        return text
      } finally {
        fs.closeSync(fd)
      }
    }
    case 'write_file': {
      const p = requireString(args, 'path')
      const content = requireString(args, 'content')
      const target = resolveSafe(root, p)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, content)
      return `File written: ${p} (${Buffer.byteLength(content)} bytes)`
    }
    case 'edit_file': {
      const p = requireString(args, 'path')
      const oldStr = requireString(args, 'old_string')
      const newStr = requireString(args, 'new_string')
      if (oldStr.length === 0) throw new Error('old_string is empty')
      const target = resolveSafe(root, p)
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        throw new Error(`file not found: ${p}`)
      }
      const text = fs.readFileSync(target, 'utf8')
      const count = text.split(oldStr).length - 1
      if (count === 0) throw new Error(`old_string not found in ${p}`)
      if (count > 1) throw new Error(`old_string appears ${count} times in ${p} — provide a unique excerpt`)
      fs.writeFileSync(target, text.replace(oldStr, () => newStr))
      return `File edited: ${p}`
    }
    case 'delete_file': {
      if (!settings.allowDelete) {
        throw new Error('delete_file is disabled — the user must enable "Allow deletion" (allowDelete) in settings')
      }
      const p = requireString(args, 'path')
      const target = resolveSafe(root, p)
      if (!fs.existsSync(target)) throw new Error(`file not found: ${p}`)
      if (!fs.statSync(target).isFile()) throw new Error(`not a file: ${p}`)
      // unlinkSync et non rmSync : sous Node 25/Windows, rmSync échoue EN SILENCE
      // sur un chemin non-ASCII — l'outil répondrait « supprimé » en laissant le
      // fichier en place (même piège que deleteMemoryFile, cf. lib/storage.ts).
      fs.unlinkSync(target)
      return `File deleted: ${p}`
    }
    default:
      throw new Error(`unknown file tool: ${tool}`)
  }
}
