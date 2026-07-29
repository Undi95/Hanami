// Couche de stockage : tout l'état vit dans data/ sous forme de fichiers lisibles.
// data/characters/<id>/{character.json, system-prompt.md, memory/*.md, chats/*.jsonl}
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { CharacterFull, CharacterMeta, ChatMessage, ChatMeta, MemoryFile } from '../../shared/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '..', '..')
export const DATA_DIR = path.join(ROOT, 'data')
export const PRESETS_DIR = path.join(ROOT, 'presets')
export const VRM_DIR = path.join(ROOT, 'vrm')
export const BACKGROUNDS_DIR = path.join(ROOT, 'backgrounds')
const CHARACTERS_DIR = path.join(DATA_DIR, 'characters')

export function ensureDataDirs(): void {
  fs.mkdirSync(CHARACTERS_DIR, { recursive: true })
  fs.mkdirSync(BACKGROUNDS_DIR, { recursive: true })
  // Premier lancement : copie des presets livrés avec l'app (jamais écrasés ensuite).
  if (fs.existsSync(PRESETS_DIR)) {
    for (const preset of fs.readdirSync(PRESETS_DIR)) {
      const src = path.join(PRESETS_DIR, preset)
      const target = path.join(CHARACTERS_DIR, preset)
      if (fs.statSync(src).isDirectory() && !fs.existsSync(target)) {
        fs.cpSync(src, target, { recursive: true })
      }
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Nom de fichier sûr (pas de traversée, pas de séparateurs). */
export function sanitizeFileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|]/g, '').replace(/\.\./g, '').trim()
  // Vide ou composé uniquement de points ("...", ".") → résoudrait vers le dossier parent.
  if (!clean || /^\.+$/.test(clean)) throw new Error('Nom de fichier invalide')
  return clean
}

export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'perso'
}

function charDir(id: string): string {
  const dir = path.join(CHARACTERS_DIR, sanitizeFileName(id))
  return dir
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

function newId(): string {
  return crypto.randomBytes(6).toString('hex')
}

// ── Personnages ────────────────────────────────────────────────────────────

export function listCharacters(): CharacterMeta[] {
  if (!fs.existsSync(CHARACTERS_DIR)) return []
  const out: CharacterMeta[] = []
  for (const id of fs.readdirSync(CHARACTERS_DIR)) {
    const meta = readJson<CharacterMeta>(path.join(CHARACTERS_DIR, id, 'character.json'))
    if (meta) out.push({ ...meta, id })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function getCharacter(id: string): CharacterFull | null {
  const dir = charDir(id)
  const meta = readJson<CharacterMeta>(path.join(dir, 'character.json'))
  if (!meta) return null
  let systemPrompt = ''
  try {
    systemPrompt = fs.readFileSync(path.join(dir, 'system-prompt.md'), 'utf8')
  } catch {
    /* pas de prompt → chaîne vide */
  }
  return { ...meta, id, systemPrompt }
}

export interface CreateCharacterInput {
  name: string
  vrm?: string
  background?: string
  greeting?: string
  systemPrompt?: string
}

export function createCharacter(input: CreateCharacterInput): CharacterFull {
  let id = slugify(input.name)
  while (fs.existsSync(path.join(CHARACTERS_DIR, id))) id = `${slugify(input.name)}-${newId().slice(0, 4)}`
  const dir = path.join(CHARACTERS_DIR, id)
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'chats'), { recursive: true })
  const meta: CharacterMeta = {
    id,
    name: input.name,
    vrm: input.vrm ?? '',
    background: input.background ?? '',
    greeting: input.greeting ?? '',
    createdAt: new Date().toISOString(),
  }
  fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify(meta, null, 2))
  fs.writeFileSync(path.join(dir, 'system-prompt.md'), input.systemPrompt ?? defaultSystemPrompt(input.name))
  fs.writeFileSync(path.join(dir, 'memory', 'MEMORY.md'), defaultMemoryIndex(input.name))
  return { ...meta, systemPrompt: input.systemPrompt ?? defaultSystemPrompt(input.name) }
}

export function updateCharacter(id: string, patch: Partial<CharacterFull>): CharacterFull {
  const current = getCharacter(id)
  if (!current) throw new Error(`Personnage introuvable : ${id}`)
  const dir = charDir(id)
  const meta: CharacterMeta = {
    id,
    name: patch.name ?? current.name,
    vrm: patch.vrm ?? current.vrm,
    background: patch.background ?? current.background,
    greeting: patch.greeting ?? current.greeting,
    createdAt: current.createdAt,
  }
  fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify(meta, null, 2))
  if (patch.systemPrompt !== undefined) {
    fs.writeFileSync(path.join(dir, 'system-prompt.md'), patch.systemPrompt)
  }
  return { ...meta, systemPrompt: patch.systemPrompt ?? current.systemPrompt }
}

export function deleteCharacter(id: string): void {
  const dir = charDir(id)
  // Ceinture : ne jamais supprimer le dossier characters/ lui-même.
  if (path.resolve(dir) === path.resolve(CHARACTERS_DIR)) throw new Error(`Identifiant invalide : ${id}`)
  fs.rmSync(dir, { recursive: true, force: true })
}

/** Prompt par défaut d'un personnage créé via l'UI — volontairement minimal et visible. */
export function defaultSystemPrompt(name: string): string {
  return `# ${name}

You are ${name}. Stay in character.

## Expressions (3D avatar)
Start each reply with ONE emotion tag among: [happy] [sad] [angry] [surprised] [relaxed] [neutral]
Example: \`[happy] Hello! I'm glad you're here.\`
`
}

function defaultMemoryIndex(name: string): string {
  return `# Mémoire de ${name}

Index des souvenirs — une ligne par fichier, format : \`- [Titre](fichier.md) — résumé court\`.
Ce fichier est injecté dans le contexte à chaque message (si la mémoire est activée).
`
}

// ── Chats ──────────────────────────────────────────────────────────────────
// Format .jsonl : ligne 1 = { id, title, createdAt, summary?, summaryUpto? },
// lignes suivantes = ChatMessage.

interface ChatHeader {
  id: string
  title: string
  createdAt: string
  summary?: string
  summaryUpto?: number
}

function chatFile(charId: string, chatId: string): string {
  return path.join(charDir(charId), 'chats', `${sanitizeFileName(chatId)}.jsonl`)
}

/**
 * Scanne un .jsonl par blocs de 64 Ko sans le charger en mémoire :
 * 1re ligne non vide (l'en-tête) + nombre de lignes non vides.
 */
function scanJsonl(file: string): { firstLine: string; lineCount: number } {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(64 * 1024)
    const firstChunks: Buffer[] = []
    let firstDone = false
    let lineCount = 0
    let segLen = 0 // longueur de la ligne en cours, reportée entre les blocs
    let bytesRead: number
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, -1)) > 0) {
      let segStart = 0
      for (let i = 0; i < bytesRead; i++) {
        if (buf[i] === 0x0a) {
          if (segLen + (i - segStart) > 0) {
            lineCount++
            if (!firstDone) {
              firstChunks.push(Buffer.from(buf.subarray(segStart, i)))
              firstDone = true
            }
          }
          segLen = 0
          segStart = i + 1
        }
      }
      const tail = bytesRead - segStart
      if (!firstDone && tail > 0) firstChunks.push(Buffer.from(buf.subarray(segStart, bytesRead)))
      segLen += tail
    }
    if (segLen > 0) {
      lineCount++
      firstDone = true
    }
    return { firstLine: firstDone ? Buffer.concat(firstChunks).toString('utf8') : '', lineCount }
  } finally {
    fs.closeSync(fd)
  }
}

export function listChats(charId: string): ChatMeta[] {
  const dir = path.join(charDir(charId), 'chats')
  if (!fs.existsSync(dir)) return []
  const out: ChatMeta[] = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue
    const file = path.join(dir, f)
    const { firstLine, lineCount } = scanJsonl(file)
    const header = firstLine ? (JSON.parse(firstLine) as ChatHeader) : null
    if (!header) continue
    out.push({
      id: header.id,
      title: header.title,
      createdAt: header.createdAt,
      updatedAt: fs.statSync(file).mtime.toISOString(),
      messageCount: lineCount - 1,
      ...(header.summary ? { summary: header.summary, summaryUpto: header.summaryUpto ?? 0 } : {}),
    })
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function createChat(charId: string, title?: string): ChatMeta {
  const id = `${new Date().toISOString().slice(0, 10)}-${newId()}`
  const header: ChatHeader = {
    id,
    title: title || `Chat du ${new Date().toLocaleDateString('fr-FR')}`,
    createdAt: new Date().toISOString(),
  }
  fs.mkdirSync(path.join(charDir(charId), 'chats'), { recursive: true })
  fs.writeFileSync(chatFile(charId, id), JSON.stringify(header) + '\n')
  return { ...header, updatedAt: header.createdAt, messageCount: 0 }
}

export function readChat(charId: string, chatId: string): { meta: ChatMeta; messages: ChatMessage[] } {
  const file = chatFile(charId, chatId)
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  const header = JSON.parse(lines[0]) as ChatHeader
  const messages = lines.slice(1).map((l) => JSON.parse(l) as ChatMessage)
  return {
    meta: {
      ...header,
      updatedAt: fs.statSync(file).mtime.toISOString(),
      messageCount: messages.length,
    },
    messages,
  }
}

export function appendChatMessage(charId: string, chatId: string, msg: ChatMessage): void {
  const file = chatFile(charId, chatId)
  // Chat supprimé pendant un stream : ne jamais recréer un fichier dont l'en-tête est perdu.
  if (!fs.existsSync(file)) return
  fs.appendFileSync(file, JSON.stringify(msg) + '\n')
}

export function deleteChat(charId: string, chatId: string): void {
  fs.rmSync(chatFile(charId, chatId), { force: true })
}

/**
 * Met à jour l'en-tête d'un chat (résumé de compaction…) en réécrivant la
 * première ligne du .jsonl. Écriture temp + rename : un crash au milieu ne
 * corrompt jamais le fichier d'origine.
 */
export function updateChatHeader(
  charId: string,
  chatId: string,
  patch: Partial<Pick<ChatHeader, 'title' | 'summary' | 'summaryUpto'>>,
): void {
  const file = chatFile(charId, chatId)
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const firstIdx = lines.findIndex((l) => l.trim().length > 0)
  if (firstIdx === -1) throw new Error(`Chat corrompu : ${chatId}`)
  const header = JSON.parse(lines[firstIdx]) as ChatHeader
  lines[firstIdx] = JSON.stringify({ ...header, ...patch })
  const tmp = file + '.tmp'
  // fsync avant rename : sans lui, un crash machine peut laisser un tmp vide
  // renommé par-dessus le transcript.
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, lines.join('\n'))
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
}

/**
 * Réécrit les messages d'un chat via une fonction de transformation
 * (régénération, édition, continuation). Même protocole sûr que
 * updateChatHeader : tmp + fsync + rename.
 */
export function rewriteChatMessages(
  charId: string,
  chatId: string,
  mutate: (messages: ChatMessage[]) => ChatMessage[],
): ChatMessage[] {
  const file = chatFile(charId, chatId)
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  const header = lines[0]
  const messages = lines.slice(1).map((l) => JSON.parse(l) as ChatMessage)
  const next = mutate(messages)
  const tmp = file + '.tmp'
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, [header, ...next.map((m) => JSON.stringify(m))].join('\n') + '\n')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
  return next
}

/** Écrit un chat complet d'un coup (utilisé par l'import SillyTavern). */
export function writeImportedChat(charId: string, title: string, messages: ChatMessage[]): ChatMeta {
  const meta = createChat(charId, title)
  const file = chatFile(charId, meta.id)
  const body = messages.map((m) => JSON.stringify(m)).join('\n')
  if (body) fs.appendFileSync(file, body + '\n')
  return { ...meta, messageCount: messages.length }
}

// ── Mémoire ────────────────────────────────────────────────────────────────

function memoryDir(charId: string): string {
  return path.join(charDir(charId), 'memory')
}

export function listMemory(charId: string): MemoryFile[] {
  const dir = memoryDir(charId)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort((a, b) => (a === 'MEMORY.md' ? -1 : b === 'MEMORY.md' ? 1 : a.localeCompare(b)))
    .map((f) => ({ name: f, content: fs.readFileSync(path.join(dir, f), 'utf8') }))
}

export function readMemoryFile(charId: string, name: string): string | null {
  const file = path.join(memoryDir(charId), sanitizeFileName(name))
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export function writeMemoryFile(charId: string, name: string, content: string): void {
  fs.mkdirSync(memoryDir(charId), { recursive: true })
  fs.writeFileSync(path.join(memoryDir(charId), sanitizeFileName(name)), content)
}

export function deleteMemoryFile(charId: string, name: string): void {
  // Comparaison insensible à la casse : le FS Windows l'est aussi ("memory.MD" = même fichier).
  if (sanitizeFileName(name).toLowerCase() === 'memory.md') throw new Error("MEMORY.md est l'index — non supprimable")
  fs.rmSync(path.join(memoryDir(charId), sanitizeFileName(name)), { force: true })
}

/** Bloc mémoire injecté dans le system prompt (transparent : visible dans l'inspecteur). */
export function buildMemoryBlock(charId: string): string {
  const files = listMemory(charId)
  if (files.length === 0) return ''
  const index = files.find((f) => f.name === 'MEMORY.md')
  const others = files.filter((f) => f.name !== 'MEMORY.md')
  const totalLen = others.reduce((n, f) => n + f.content.length, 0)
  let block = `\n\n## Memory (auto-injected by Hanami — edit in the Memory panel)\n`
  if (index) block += index.content + '\n'
  // Petits volumes : tout injecter. Gros volumes : index seul, le modèle lira via memory_read.
  if (totalLen <= 8000) {
    for (const f of others) block += `\n### ${f.name}\n${f.content}\n`
  } else if (others.length > 0) {
    block += `\n(${others.length} fichiers mémoire — utilise l'outil memory_read(name) pour lire un fichier.)\n`
  }
  return block
}
