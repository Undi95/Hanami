// Outils mémoire exposés au modèle (function calling OpenAI) — agissent sur le personnage courant.
// memory_save écrit le fichier ET tient l'index MEMORY.md à jour (une ligne par fichier).
import { deleteMemoryFile, readMemoryFile, sanitizeFileName, writeMemoryFile } from '../lib/storage'

export const MEMORY_TOOL_NAMES = ['memory_save', 'memory_read', 'memory_update', 'memory_delete'] as const

export const memoryToolDefs: unknown[] = [
  {
    type: 'function',
    function: {
      name: 'memory_save',
      description:
        "Enregistre un souvenir durable : crée (ou remplace) un fichier mémoire .md et ajoute/remplace sa ligne dans l'index MEMORY.md.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nom du fichier, ex : "famille.md"' },
          content: { type: 'string', description: 'Contenu markdown du souvenir' },
          indexLine: {
            type: 'string',
            description: "Ligne d'index pour MEMORY.md, format : - [Titre](fichier.md) — résumé court",
          },
        },
        required: ['name', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_read',
      description: 'Lit un fichier mémoire du personnage et renvoie son contenu.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nom du fichier, ex : "famille.md"' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_update',
      description: 'Remplace le contenu d’un fichier mémoire existant (y compris MEMORY.md, l’index).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nom du fichier existant' },
          content: { type: 'string', description: 'Nouveau contenu complet' },
        },
        required: ['name', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_delete',
      description: 'Supprime un fichier mémoire (MEMORY.md, l’index, est refusé).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nom du fichier à supprimer' },
        },
        required: ['name'],
      },
    },
  },
]

function requireString(args: Record<string, unknown>, field: string): string {
  const v = args[field]
  if (typeof v !== 'string') throw new Error(`paramètre "${field}" manquant ou invalide`)
  return v
}

/** Nom de fichier sûr, extension .md imposée (le stockage ne liste que les .md). */
function normalizeName(raw: string): string {
  let name = sanitizeFileName(raw)
  if (!name.toLowerCase().endsWith('.md')) name += '.md'
  return name
}

/** Ajoute ou remplace la ligne d'index pointant vers `fileName` dans MEMORY.md. */
function upsertIndexLine(charId: string, fileName: string, line: string): void {
  const index = readMemoryFile(charId, 'MEMORY.md') ?? ''
  const lines = index.split('\n')
  const needle = `](${fileName})`
  const existing = lines.findIndex((l) => l.includes(needle))
  if (existing >= 0) {
    lines[existing] = line
  } else {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    lines.push(line, '')
  }
  writeMemoryFile(charId, 'MEMORY.md', lines.join('\n'))
}

/** Retire la ligne d'index pointant vers `fileName` (après suppression du fichier). */
function removeIndexLine(charId: string, fileName: string): void {
  const index = readMemoryFile(charId, 'MEMORY.md')
  if (index === null) return
  const needle = `](${fileName})`
  const lines = index.split('\n').filter((l) => !l.includes(needle))
  writeMemoryFile(charId, 'MEMORY.md', lines.join('\n'))
}

/** Exécute un outil mémoire ; renvoie une chaîne courte pour le modèle. Erreurs → throw. */
export function executeMemoryTool(charId: string, tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'memory_save': {
      const name = normalizeName(requireString(args, 'name'))
      const content = requireString(args, 'content')
      writeMemoryFile(charId, name, content)
      if (name !== 'MEMORY.md') {
        const raw = typeof args.indexLine === 'string' ? args.indexLine.trim() : ''
        const line = raw || `- [${name.replace(/\.md$/i, '')}](${name})`
        upsertIndexLine(charId, name, line)
      }
      return `Souvenir enregistré : ${name} (${content.length} caractères), index mis à jour.`
    }
    case 'memory_read': {
      const name = normalizeName(requireString(args, 'name'))
      const content = readMemoryFile(charId, name)
      if (content === null) throw new Error(`fichier mémoire introuvable : ${name}`)
      return content
    }
    case 'memory_update': {
      const name = normalizeName(requireString(args, 'name'))
      const content = requireString(args, 'content')
      if (readMemoryFile(charId, name) === null) {
        throw new Error(`fichier mémoire introuvable : ${name} (utilise memory_save pour le créer)`)
      }
      writeMemoryFile(charId, name, content)
      return `Fichier mémoire mis à jour : ${name}.`
    }
    case 'memory_delete': {
      const name = normalizeName(requireString(args, 'name'))
      deleteMemoryFile(charId, name) // refuse MEMORY.md (throw côté storage)
      removeIndexLine(charId, name)
      return `Fichier mémoire supprimé : ${name}.`
    }
    default:
      throw new Error(`outil mémoire inconnu : ${tool}`)
  }
}
