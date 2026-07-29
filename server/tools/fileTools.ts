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
      description: 'Liste les fichiers du dossier de travail (les dossiers sont suffixés par "/").',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Sous-dossier relatif (défaut : racine du dossier de travail)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Lit un fichier texte du dossier de travail (tronqué à 256 Ko).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif du fichier' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Écrit (crée ou remplace) un fichier dans le dossier de travail.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif du fichier' },
          content: { type: 'string', description: 'Contenu complet à écrire' },
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
        'Remplace UNE occurrence exacte de old_string par new_string dans un fichier. Erreur si old_string est absent ou présent plusieurs fois.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif du fichier' },
          old_string: { type: 'string', description: 'Texte exact à remplacer (unique dans le fichier)' },
          new_string: { type: 'string', description: 'Texte de remplacement' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Supprime un fichier du dossier de travail (uniquement si la suppression est autorisée dans les réglages).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif du fichier' },
        },
        required: ['path'],
      },
    },
  },
]

function requireString(args: Record<string, unknown>, field: string): string {
  const v = args[field]
  if (typeof v !== 'string') throw new Error(`paramètre "${field}" manquant ou invalide`)
  return v
}

/** Racine réelle de la sandbox (créée au besoin, symlinks résolus). */
function sandboxRoot(settings: Settings): string {
  // Défense en profondeur (loadSettings valide déjà) : une racine vide ou relative
  // retomberait sur le cwd, c'est-à-dire la racine du projet.
  if (typeof settings.toolsRoot !== 'string' || !settings.toolsRoot.trim() || !path.isAbsolute(settings.toolsRoot)) {
    throw new Error('toolsRoot invalide : un chemin absolu est requis dans les réglages')
  }
  const root = path.resolve(settings.toolsRoot)
  // Refuse la racine projet, data/ et tout ancêtre de ceux-ci : le modèle pourrait
  // sinon lire data/config.json ou écrire dans server/.
  const norm = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s)
  for (const forbidden of [ROOT, DATA_DIR]) {
    const f = path.resolve(forbidden)
    if (norm(root) === norm(f) || isInside(norm(root), norm(f))) {
      throw new Error(
        `toolsRoot invalide : ${root} englobe les fichiers de l'app — choisis un dossier dédié (ex. data/workspace)`,
      )
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
  if (!isInside(root, resolved)) throw new Error(`chemin hors du dossier autorisé : ${p}`)
  if (fs.lstatSync(resolved, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`chemin hors du dossier autorisé (lien symbolique) : ${p}`)
  }
  let probe = path.dirname(resolved)
  while (!fs.lstatSync(probe, { throwIfNoEntry: false })) {
    const up = path.dirname(probe)
    if (up === probe) break
    probe = up
  }
  const realDir = fs.realpathSync(probe)
  const target = path.join(realDir, path.relative(probe, resolved))
  if (!isInside(root, target)) throw new Error(`chemin hors du dossier autorisé (lien symbolique) : ${p}`)
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
        throw new Error(`dossier introuvable : ${dir}`)
      }
      const entries = fs
        .readdirSync(target, { withFileTypes: true })
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
      return entries.length > 0 ? entries.join('\n') : '(dossier vide)'
    }
    case 'read_file': {
      const p = requireString(args, 'path')
      const target = resolveSafe(root, p)
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        throw new Error(`fichier introuvable : ${p}`)
      }
      const size = fs.statSync(target).size
      const fd = fs.openSync(target, 'r')
      try {
        const buf = Buffer.alloc(Math.min(size, READ_CAP))
        fs.readSync(fd, buf, 0, buf.length, 0)
        let text = buf.toString('utf8')
        if (size > READ_CAP) text += `\n… [tronqué : ${size} octets au total, cap de lecture 256 Ko]`
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
      return `Fichier écrit : ${p} (${Buffer.byteLength(content)} octets)`
    }
    case 'edit_file': {
      const p = requireString(args, 'path')
      const oldStr = requireString(args, 'old_string')
      const newStr = requireString(args, 'new_string')
      if (oldStr.length === 0) throw new Error('old_string est vide')
      const target = resolveSafe(root, p)
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        throw new Error(`fichier introuvable : ${p}`)
      }
      const text = fs.readFileSync(target, 'utf8')
      const count = text.split(oldStr).length - 1
      if (count === 0) throw new Error(`old_string introuvable dans ${p}`)
      if (count > 1) throw new Error(`old_string présent ${count} fois dans ${p} — fournis un extrait unique`)
      fs.writeFileSync(target, text.replace(oldStr, () => newStr))
      return `Fichier modifié : ${p}`
    }
    case 'delete_file': {
      if (!settings.allowDelete) {
        throw new Error(
          'delete_file est désactivé — l’utilisateur doit activer « Autoriser la suppression » (allowDelete) dans les réglages',
        )
      }
      const p = requireString(args, 'path')
      const target = resolveSafe(root, p)
      if (!fs.existsSync(target)) throw new Error(`fichier introuvable : ${p}`)
      if (!fs.statSync(target).isFile()) throw new Error(`pas un fichier : ${p}`)
      fs.rmSync(target)
      return `Fichier supprimé : ${p}`
    }
    default:
      throw new Error(`outil fichier inconnu : ${tool}`)
  }
}
