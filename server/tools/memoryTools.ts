// Outils mémoire exposés au modèle (function calling OpenAI) — agissent sur le personnage courant.
// memory_save écrit le fichier ET tient l'index MEMORY.md à jour (une ligne par fichier).
//
// Garde-fou « lire avant d'écrire » : modifier ou supprimer un fichier EXISTANT
// sans l'avoir memory_read dans la même requête est REFUSÉ. C'est ce qui
// empêchait le modèle d'écraser silencieusement une mémoire qu'il n'avait pas
// vue (perception de « suppression » / doublons). Un append, lui, ne détruit
// rien : il passe sans lecture préalable.
import { deleteMemoryFile, readMemoryFile, sanitizeFileName, writeMemoryFile } from '../lib/storage'

export const MEMORY_TOOL_NAMES = ['memory_save', 'memory_read', 'memory_update', 'memory_delete', 'memory_append'] as const

/**
 * État de la mémoire pour UNE requête (un tour de chat ou une compaction) :
 * les fichiers déjà lus via memory_read. Les garde-fous s'appuient dessus —
 * jamais sur l'historique, car un résumé de compaction peut avoir effacé la
 * lecture d'un tour antérieur, et le contenu peut avoir changé entre-temps.
 */
export interface MemorySession {
  read: Set<string>
}

export function createMemorySession(): MemorySession {
  return { read: new Set() }
}

export const memoryToolDefs: unknown[] = [
  {
    type: 'function',
    function: {
      name: 'memory_save',
      description:
        'Creates a NEW memory .md file for a brand-new topic, and adds/replaces its line in the MEMORY.md index. ' +
        'On an existing name it REPLACES the whole file — and is refused unless you memory_read it first. ' +
        'To change an existing memory, prefer memory_update (complete merged content) or memory_append (a new fact).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'File name, e.g. "family.md"' },
          content: { type: 'string', description: 'Markdown content of the memory' },
          indexLine: {
            type: 'string',
            description: 'Short index line for MEMORY.md, format: - [Title](file.md) — a few words',
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
      description: "Reads one of the character's memory files and returns its content. Always do this before memory_update or memory_delete on an existing file.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'File name, e.g. "family.md"' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_update',
      description:
        'Replaces the content of an existing memory file (including MEMORY.md, the index) with the given COMPLETE content. ' +
        'Merge the old facts with the new ones — never drop what is already there. Refused unless you memory_read it first.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Existing file name' },
          content: { type: 'string', description: 'New, complete content (old facts kept + new ones)' },
        },
        required: ['name', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_delete',
      description:
        'Deletes a memory file (MEMORY.md, the index, is refused). ' +
        'Only for facts that are wrong or that the user asked to forget. Refused unless you memory_read it first.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'File name to delete' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_append',
      description:
        'Appends new content (a fact, a dated line…) to an EXISTING memory file — the safe way to add to a memory ' +
        'without rewriting or losing it. No prior read needed. Adds the index line if the file has none.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Existing file name' },
          content: { type: 'string', description: 'The new lines/facts to append at the end of the file' },
        },
        required: ['name', 'content'],
      },
    },
  },
]

function requireString(args: Record<string, unknown>, field: string): string {
  const v = args[field]
  if (typeof v !== 'string') throw new Error(`missing or invalid parameter "${field}"`)
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

/**
 * Garde-fou lecture préalable : on ne touche pas à un contenu qu'on n'a pas vu.
 * `session.read` porte les noms normalisés (mêmes que memory_read).
 */
function assertRead(charId: string, name: string, action: string, session: MemorySession): string | null {
  if (session.read.has(name)) return null
  if (readMemoryFile(charId, name) === null) return null // inexistant → pas de garde-fou
  const hint =
    action === 'delete'
      ? 'Make sure it is the right file before removing it.'
      : 'memory_read it first, then ' +
        (action === 'update'
          ? 'memory_update it with the COMPLETE merged content (old facts kept + new ones).'
          : 'use memory_update with the complete merged content, or memory_append for a new fact.')
  return `Refused: ${name} already exists and you have not read it in this request. ${hint}`
}

/** Exécute un outil mémoire ; renvoie une chaîne courte pour le modèle. Erreurs → throw. */
export function executeMemoryTool(
  charId: string,
  tool: string,
  args: Record<string, unknown>,
  session: MemorySession,
): string {
  switch (tool) {
    case 'memory_save': {
      const name = normalizeName(requireString(args, 'name'))
      const content = requireString(args, 'content')
      if (name !== 'MEMORY.md') {
        const refusal = assertRead(charId, name, 'save', session)
        if (refusal) throw new Error(refusal)
      }
      const prev = readMemoryFile(charId, name)
      writeMemoryFile(charId, name, content)
      if (name !== 'MEMORY.md') {
        const raw = typeof args.indexLine === 'string' ? args.indexLine.trim() : ''
        const line = raw || `- [${name.replace(/\.md$/i, '')}](${name})`
        upsertIndexLine(charId, name, line)
      }
      // Le modèle DOIT voir qu'un contenu a été remplacé — c'était l'écrasement
      // silencieux qui produisait des « suppressions » perçues et des doublons.
      return prev === null
        ? `Memory created: ${name} (${content.length} characters), index updated.`
        : `Memory replaced: ${name} (was ${prev.length} characters, now ${content.length}), index updated.`
    }
    case 'memory_read': {
      const name = normalizeName(requireString(args, 'name'))
      const content = readMemoryFile(charId, name)
      if (content === null) throw new Error(`memory file not found: ${name}`)
      session.read.add(name)
      return content
    }
    case 'memory_update': {
      const name = normalizeName(requireString(args, 'name'))
      const content = requireString(args, 'content')
      if (readMemoryFile(charId, name) === null) {
        throw new Error(`memory file not found: ${name} (use memory_save to create it)`)
      }
      const refusal = assertRead(charId, name, 'update', session)
      if (refusal) throw new Error(refusal)
      writeMemoryFile(charId, name, content)
      return `Memory file updated: ${name} (${content.length} characters).`
    }
    case 'memory_delete': {
      const name = normalizeName(requireString(args, 'name'))
      if (name !== 'MEMORY.md') {
        const refusal = assertRead(charId, name, 'delete', session)
        if (refusal) throw new Error(refusal)
      }
      deleteMemoryFile(charId, name) // refuse MEMORY.md (throw côté storage)
      removeIndexLine(charId, name)
      return `Memory file deleted: ${name}.`
    }
    case 'memory_append': {
      const name = normalizeName(requireString(args, 'name'))
      const content = requireString(args, 'content').trim()
      if (name === 'MEMORY.md') {
        throw new Error('memory_append does not touch MEMORY.md — the index is managed automatically by the other tools')
      }
      const existing = readMemoryFile(charId, name)
      if (existing === null) throw new Error(`memory file not found: ${name} (use memory_save to create it)`)
      writeMemoryFile(charId, name, existing.replace(/\n*$/, '\n') + '\n' + content + '\n')
      // L'index ne doit jamais perdre un fichier (c'était le cas des « orphelins »
      // : présents sur disque, absents de l'index, donc invisibles pour le modèle).
      let indexAdded = false
      if (!(readMemoryFile(charId, 'MEMORY.md') ?? '').includes(`](${name})`)) {
        upsertIndexLine(charId, name, `- [${name.replace(/\.md$/i, '')}](${name})`)
        indexAdded = true
      }
      return `Memory appended to ${name}.${indexAdded ? ' Index line added.' : ''}`
    }
    default:
      throw new Error(`unknown memory tool: ${tool}`)
  }
}
