// Outils fichiers exposés au modèle — SANDBOX STRICTE dans settings.toolsRoot.
// Chaque chemin est résolu contre la racine ; tout ce qui sort (y compris via symlink) est refusé.
import fs from 'node:fs'
import path from 'node:path'
import type { Settings } from '../../shared/types'
import { DATA_DIR, ROOT } from '../lib/storage'

const READ_CAP = 256 * 1024 // 256 Ko

export const FILE_TOOL_NAMES = ['list_files', 'read_file', 'write_file', 'edit_file', 'delete_file'] as const

export const fileToolDefs: unknown[] = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'Lists the files in the working folder (folders are suffixed with "/").',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Relative subfolder (default: root of the working folder)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Reads a text file from the working folder (truncated at 256 KB).',
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
      description: 'Writes (creates or replaces) a file in the working folder.',
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
      description: 'Deletes a file from the working folder (only if deletion is allowed in settings).',
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

/** Racine réelle de la sandbox (créée au besoin, symlinks résolus). */
function sandboxRoot(settings: Settings): string {
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

/** Exécute un outil fichier ; renvoie une chaîne courte pour le modèle. Erreurs → throw. */
export function executeFileTool(settings: Settings, tool: string, args: Record<string, unknown>): string {
  const root = sandboxRoot(settings)
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
