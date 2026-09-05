// Couche de stockage : tout l'état vit dans data/ sous forme de fichiers lisibles.
// data/characters/<id>/{character.json, system-prompt.md, memory/*.md, chats/*.jsonl}
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { emotionTagList } from '../../shared/emotions'
import type {
  AnimationFamily,
  CharacterFull,
  CharacterMeta,
  ChatMessage,
  ChatMeta,
  GreetingMode,
  MemoryFile,
  MessageVariant,
  ToolTrace,
} from '../../shared/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '..', '..')
export const DATA_DIR = path.join(ROOT, 'data')
export const PRESETS_DIR = path.join(ROOT, 'presets')
export const VRM_DIR = path.join(ROOT, 'vrm')
export const BACKGROUNDS_DIR = path.join(ROOT, 'backgrounds')
// Décors 3D (.glb) et animations humanoïdes (.vrma) : assets livrés avec l'app,
// servis en statique comme vrm/. Volontairement HORS ensureDataDirs — ce sont des
// dossiers du dépôt, pas de l'état créé au premier lancement (même règle que vrm/).
export const ENVIRONMENTS_DIR = path.join(ROOT, 'environments')
export const VRMA_DIR = path.join(ROOT, 'vrma')
// Portraits 2D (avatar de repli des personnages sans VRM) : dossier servi en
// statique comme les fonds, alimenté par l'import des cards PNG.
export const PORTRAITS_DIR = path.join(ROOT, 'portraits')
const CHARACTERS_DIR = path.join(DATA_DIR, 'characters')

export function ensureDataDirs(): void {
  fs.mkdirSync(CHARACTERS_DIR, { recursive: true })
  fs.mkdirSync(BACKGROUNDS_DIR, { recursive: true })
  fs.mkdirSync(PORTRAITS_DIR, { recursive: true })
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

/** Variantes de message d'accueil : on ne garde que des chaînes non vides. */
function normalizeGreetings(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  return list.filter((g): g is string => typeof g === 'string' && g.trim().length > 0)
}

/** Mode de premier message : valeur connue, sinon le défaut historique. */
function normalizeGreetingMode(value: unknown): GreetingMode {
  return value === 'generated' || value === 'ask' ? value : 'written'
}

/**
 * Nettoie un character.json lu sur le disque : les fichiers de data/ sont
 * éditables à la main, un `greetings` malformé ne doit jamais atteindre le client.
 * Les champs absents le restent (rétro-compatibilité : pas de clé inventée).
 */
function normalizeMeta(raw: CharacterMeta, id: string): CharacterMeta {
  const meta: CharacterMeta = { ...raw, id }
  const greetings = normalizeGreetings(raw.greetings)
  if (greetings.length > 0) meta.greetings = greetings
  else delete meta.greetings
  if (raw.greetingMode !== undefined) meta.greetingMode = normalizeGreetingMode(raw.greetingMode)
  // Famille d'animations : une valeur inconnue écrite à la main (`animations:
  // "mixamo"`) doit rendre le défaut, pas voyager jusqu'au client — la scène en
  // ferait un catalogue vide, donc un avatar en pose de repos, sans un message.
  if (raw.animations !== 'rocketbox') delete meta.animations
  return meta
}

export function listCharacters(): CharacterMeta[] {
  if (!fs.existsSync(CHARACTERS_DIR)) return []
  const out: CharacterMeta[] = []
  for (const id of fs.readdirSync(CHARACTERS_DIR)) {
    const meta = readJson<CharacterMeta>(path.join(CHARACTERS_DIR, id, 'character.json'))
    if (meta) out.push(normalizeMeta(meta, id))
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function getCharacter(id: string): CharacterFull | null {
  const dir = charDir(id)
  const raw = readJson<CharacterMeta>(path.join(dir, 'character.json'))
  if (!raw) return null
  const meta = normalizeMeta(raw, id)
  let systemPrompt = ''
  try {
    systemPrompt = fs.readFileSync(path.join(dir, 'system-prompt.md'), 'utf8')
  } catch {
    /* pas de prompt → chaîne vide */
  }
  return { ...meta, systemPrompt }
}

export interface CreateCharacterInput {
  name: string
  vrm?: string
  background?: string
  environment?: string
  greeting?: string
  greetings?: string[]
  greetingMode?: GreetingMode
  theme?: string
  animations?: AnimationFamily
  systemPrompt?: string
  ttsEnabled?: boolean
  ttsVoice?: string
}

/** Thème par personnage : clé écrite seulement quand elle porte une valeur. */
function themeField(theme: unknown): Partial<CharacterMeta> {
  return typeof theme === 'string' && theme.trim() ? { theme: theme.trim() } : {}
}

/**
 * Famille d'animations : même règle que le thème, avec un tour de vis — SEULE
 * une valeur reconnue est écrite. Le défaut ('overte') ne s'écrit PAS : un
 * character.json sans cette clé reste exactement ce qu'il était, et une valeur
 * inventée à la main dans le fichier ne fige pas un personnage sur une famille
 * qui n'existe pas.
 */
function animationsField(animations: unknown): Partial<CharacterMeta> {
  return animations === 'rocketbox' ? { animations: 'rocketbox' } : {}
}

/** Décor 3D : même règle que le thème — et c'est ainsi qu'un '' explicite le RETIRE. */
function environmentField(environment: unknown): Partial<CharacterMeta> {
  return typeof environment === 'string' && environment.trim() ? { environment: environment.trim() } : {}
}

/** Portrait 2D : même règle que le thème — pas de clé vide dans character.json. */
function portraitField(portrait: unknown): Partial<CharacterMeta> {
  return typeof portrait === 'string' && portrait.trim() ? { portrait: portrait.trim() } : {}
}

/**
 * Voix du personnage : mêmes règles d'écriture que le thème — la clé n'existe
 * que si elle porte une valeur. `ttsEnabled` n'est écrit que VRAI : un
 * personnage muet n'a rien à dire dans son fichier, et tous ceux d'avant ce
 * réglage restent muets sans être touchés.
 */
function ttsFields(ttsEnabled: unknown, ttsVoice: unknown): Partial<CharacterMeta> {
  return {
    ...(ttsEnabled === true ? { ttsEnabled: true } : {}),
    ...(typeof ttsVoice === 'string' && ttsVoice.trim() ? { ttsVoice: ttsVoice.trim() } : {}),
  }
}

/** Photo (vignette) : même règle — et c'est ainsi qu'un '' explicite la RETIRE. */
function photoField(photo: unknown): Partial<CharacterMeta> {
  return typeof photo === 'string' && photo.trim() ? { photo: photo.trim() } : {}
}

/**
 * Champs d'accueil optionnels tels qu'ils sont écrits dans character.json :
 * variantes vides retirées, et mode omis quand il vaut le défaut ('written').
 * Un character.json sans ces clés reste donc parfaitement valide.
 */
function greetingFields(greetings: unknown, greetingMode: unknown): Partial<CharacterMeta> {
  const list = normalizeGreetings(greetings)
  const mode = normalizeGreetingMode(greetingMode)
  return {
    ...(list.length > 0 ? { greetings: list } : {}),
    ...(mode !== 'written' ? { greetingMode: mode } : {}),
  }
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
    ...greetingFields(input.greetings, input.greetingMode),
    ...themeField(input.theme),
    ...animationsField(input.animations),
    ...environmentField(input.environment),
    ...ttsFields(input.ttsEnabled, input.ttsVoice),
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
    // Un tableau vide dans le patch EST une valeur : il efface les variantes.
    ...greetingFields(patch.greetings ?? current.greetings, patch.greetingMode ?? current.greetingMode),
    // '' explicite dans le patch = retour au thème de l'app.
    ...themeField(patch.theme ?? current.theme),
    // Famille d'animations : LE MÊME PIÈGE que le thème et le décor — meta est
    // reconstruit clé par clé, oublier cette ligne renverrait tous les
    // personnages Rocketbox à Overte à leur première édition, sans un mot.
    // 'overte' explicite dans le patch = retour au défaut (la clé disparaît).
    ...animationsField(patch.animations ?? current.animations),
    // Décor 3D : '' explicite = retour au fond 2D. Comme pour le thème, ce champ
    // DOIT être reconduit ici — meta est reconstruit clé par clé, un oubli
    // effacerait le décor en silence à chaque édition du personnage.
    ...environmentField(patch.environment ?? current.environment),
    // Portrait conservé d'office : le dialog Personnages ne l'envoie pas (il n'a
    // pas d'éditeur) et une édition ne doit jamais l'effacer en silence.
    ...portraitField(patch.portrait ?? current.portrait),
    // Photo : même conservation d'office (elle se pose et se retire par ses
    // propres routes, jamais par le formulaire). Un '' explicite la retire.
    ...photoField(patch.photo ?? current.photo),
    // Voix : à reconduire comme le reste — meta est reconstruit clé par clé, un
    // oubli rendrait le personnage muet à la première édition. `false` explicite
    // l'éteint (false ?? current vaut false), `undefined` conserve.
    ...ttsFields(patch.ttsEnabled ?? current.ttsEnabled, patch.ttsVoice ?? current.ttsVoice),
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
  // Le portrait vit hors du dossier du personnage : il part avec lui, sinon un
  // homonyme créé plus tard hériterait de l'image de son prédécesseur.
  fs.rmSync(portraitFile(id), { force: true })
  fs.rmSync(photoFile(id), { force: true })
}

/** Fichier du portrait 2D d'un personnage (une image par personnage, écrasée). */
function portraitFile(id: string): string {
  return path.join(PORTRAITS_DIR, `${sanitizeFileName(id)}.png`)
}

/** Fichier de la photo (vignette) — même dossier que les portraits, suffixe -photo. */
function photoFile(id: string): string {
  return path.join(PORTRAITS_DIR, `${sanitizeFileName(id)}-photo.png`)
}

/**
 * Écrit le PNG d'une card importée comme portrait du personnage et renvoie son
 * URL publique (servie par /portraits). Le buffer est celui de la card telle
 * qu'elle a été envoyée : aucun retraitement d'image, l'app n'en a pas les moyens.
 */
export function savePortrait(id: string, png: Buffer): string {
  fs.mkdirSync(PORTRAITS_DIR, { recursive: true })
  const name = `${sanitizeFileName(id)}.png`
  fs.writeFileSync(path.join(PORTRAITS_DIR, name), png)
  // encodeURIComponent : un id est déjà slugifié, mais l'URL reste explicite.
  return `/portraits/${encodeURIComponent(name)}`
}

/**
 * Écrit la photo (vignette) d'un personnage et renvoie son URL publique. Le
 * fichier porte TOUJOURS le même nom : le client envoie un PNG carré déjà
 * réduit, il n'y a donc rien à retraiter ni de variante à gérer.
 * Le `?v=` n'est pas décoratif : l'URL étant stable, sans lui le navigateur
 * garderait l'ancienne image en cache après un remplacement (express.static
 * ignore la chaîne de requête, le fichier est servi normalement).
 */
export function savePhoto(id: string, png: Buffer): string {
  fs.mkdirSync(PORTRAITS_DIR, { recursive: true })
  const name = `${sanitizeFileName(id)}-photo.png`
  fs.writeFileSync(path.join(PORTRAITS_DIR, name), png)
  return `/portraits/${encodeURIComponent(name)}?v=${Date.now()}`
}

/**
 * Image d'un personnage pour l'export de card : sa PHOTO d'abord (la vignette
 * d'identité, carrée, celle qu'on reconnaît dans la liste), sinon le portrait
 * de la card importée. null = ce personnage n'a aucune image — la card partira
 * en .json.
 */
export function readCharacterImage(id: string): Buffer | null {
  for (const file of [photoFile(id), portraitFile(id)]) {
    try {
      return fs.readFileSync(file)
    } catch {
      /* absente : on essaie la suivante */
    }
  }
  return null
}

/** Supprime le fichier de la photo (la clé du character.json se retire à part). */
export function deletePhoto(id: string): void {
  fs.rmSync(photoFile(id), { force: true })
}

/** Prompt par défaut d'un personnage créé via l'UI — volontairement minimal et visible. */
export function defaultSystemPrompt(name: string): string {
  return `# ${name}

You are ${name}. Stay in character.

## Expressions (3D avatar)
Start each reply with ONE emotion tag among: ${emotionTagList()}
Example: \`[happy] Hello! I'm glad you're here.\`
`
}

// Anglais, comme le reste de ce qui part au modèle (defaultSystemPrompt, buildMemoryBlock…) :
// ce fichier EST injecté dans le contexte à chaque message (si la mémoire est activée), donc
// « langue de travail des prompts », pas la langue de l'UI qui l'a créé.
function defaultMemoryIndex(name: string): string {
  return `# ${name}'s memory

Index of memories — one line per file, format: \`- [Title](file.md) — short summary\`.
This file is injected into the context on every message (if memory is enabled).
`
}

// ── Chats ──────────────────────────────────────────────────────────────────
// Format .jsonl : ligne 1 = { id, title, titleCustom?, createdAt, summary?,
// summaryUpto?, pinned?, sceneNotes? }, lignes suivantes = ChatMessage.

interface ChatHeader {
  id: string
  title: string
  titleCustom?: boolean // true = titre voulu par l'utilisateur (jamais retraduit à l'affichage)
  createdAt: string
  summary?: string
  summaryUpto?: number
  pinned?: number // ordinal du message épinglé (gadget d'affichage, hors payload)
  sceneNotes?: string // notes de scène de cette conversation (vide = rien d'injecté)
}

/**
 * En-tête lu sur le disque : data/ est éditable à la main, donc seul
 * `titleCustom === true` compte — toute autre valeur est effacée pour ne jamais
 * laisser un drapeau mal typé remonter jusqu'au client. Idem pour les notes de
 * scène : présentes = chaîne non vide, sinon la clé disparaît (l'injection se
 * décide sur la seule présence du champ).
 */
function normalizeHeader(raw: ChatHeader): ChatHeader {
  const header: ChatHeader = { ...raw }
  if (header.titleCustom !== true) delete header.titleCustom
  if (typeof header.sceneNotes !== 'string' || !header.sceneNotes.trim()) delete header.sceneNotes
  return header
}

/**
 * Journal d'activité lu sur le disque : data/ s'édite à la main, seules les
 * entrées strictement typées sont conservées — une ligne mal formée est écartée
 * (l'affichage ne peut pas se casser sur un .jsonl retouché).
 */
function normalizeTools(raw: unknown): ToolTrace[] | null {
  if (!Array.isArray(raw)) return null
  const out: ToolTrace[] = []
  for (const t of raw) {
    if (t === null || typeof t !== 'object') continue
    const tr = t as Partial<ToolTrace>
    if (typeof tr.name !== 'string' || !tr.name) continue
    if (typeof tr.args !== 'string') continue
    const entry: ToolTrace = { name: tr.name, args: tr.args }
    if (typeof tr.result === 'string') entry.result = tr.result
    out.push(entry)
  }
  return out.length > 0 ? out : null
}

/**
 * Une variante lue sur le disque : texte obligatoire, heure de repli sur celle
 * du message (data/ s'édite à la main). null = entrée inexploitable, écartée.
 */
function normalizeVariant(raw: unknown, fallbackTs: string): MessageVariant | null {
  if (raw === null || typeof raw !== 'object') return null
  const v = raw as Partial<MessageVariant>
  if (typeof v.content !== 'string') return null
  const out: MessageVariant = { content: v.content, ts: typeof v.ts === 'string' ? v.ts : fallbackTs }
  if (typeof v.emotion === 'string' && v.emotion) out.emotion = v.emotion
  if (typeof v.thinking === 'string' && v.thinking) out.thinking = v.thinking
  const tools = normalizeTools(v.tools)
  if (tools) out.tools = tools
  return out
}

/**
 * Message lu sur le disque. Sans `variants`, il ressort IDENTIQUE — aucune clé
 * inventée, c'est ce qui rend les chats d'avant les variantes valides tels quels.
 *
 * Avec `variants`, l'invariant du format est REJOUÉ ici (cf. shared/types.ts) :
 * les entrées illisibles sont écartées, l'indice est ramené dans les bornes, et
 * le corps du message (texte, heure, émotion, raisonnement) recopie la variante
 * affichée. Moins de deux variantes valides = les deux clés disparaissent : un
 * message à variante unique est simplement un message.
 */
function normalizeMessage(raw: ChatMessage): ChatMessage {
  if (raw.variants === undefined && raw.variant === undefined) return raw
  const list = Array.isArray(raw.variants)
    ? raw.variants.map((v) => normalizeVariant(v, raw.ts)).filter((v): v is MessageVariant => v !== null)
    : []
  const msg: ChatMessage = { ...raw }
  if (list.length < 2) {
    delete msg.variants
    delete msg.variant
    return msg
  }
  const index =
    typeof raw.variant === 'number' && Number.isInteger(raw.variant) && raw.variant >= 0 && raw.variant < list.length
      ? raw.variant
      : 0
  const active = list[index]
  msg.variants = list
  msg.variant = index
  msg.content = active.content
  msg.ts = active.ts
  delete msg.emotion
  if (active.emotion) msg.emotion = active.emotion
  delete msg.thinking
  if (active.thinking) msg.thinking = active.thinking
  delete msg.tools
  if (active.tools) msg.tools = active.tools
  return msg
}

function chatFile(charId: string, chatId: string): string {
  return path.join(charDir(charId), 'chats', `${sanitizeFileName(chatId)}.jsonl`)
}

/** Mtime (ms) du fichier d'une conversation — 0 si introuvable. Sert au cache des stats. */
export function chatMtimeMs(charId: string, chatId: string): number {
  try {
    return fs.statSync(chatFile(charId, chatId)).mtimeMs
  } catch {
    return 0
  }
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
    const header = firstLine ? normalizeHeader(JSON.parse(firstLine) as ChatHeader) : null
    if (!header) continue
    out.push({
      id: header.id,
      title: header.title,
      ...(header.titleCustom ? { titleCustom: true } : {}),
      createdAt: header.createdAt,
      updatedAt: fs.statSync(file).mtime.toISOString(),
      messageCount: lineCount - 1,
      ...(header.summary ? { summary: header.summary, summaryUpto: header.summaryUpto ?? 0 } : {}),
      ...(typeof header.pinned === 'number' ? { pinned: header.pinned } : {}),
      ...(header.sceneNotes ? { sceneNotes: header.sceneNotes } : {}),
    })
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Identifiant de conversation : date du jour + suffixe aléatoire, libre dans le dossier. */
function newChatId(charId: string): string {
  const day = new Date().toISOString().slice(0, 10)
  let id = `${day}-${newId()}`
  while (fs.existsSync(chatFile(charId, id))) id = `${day}-${newId()}`
  return id
}

export function createChat(charId: string, title?: string): ChatMeta {
  const id = newChatId(charId)
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
  const header = normalizeHeader(JSON.parse(lines[0]) as ChatHeader)
  const messages = lines.slice(1).map((l) => normalizeMessage(JSON.parse(l) as ChatMessage))
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
 * Duplique une conversation en une branche indépendante : mêmes messages et
 * même en-tête (summary/summaryUpto et notes de scène inclus — la branche hérite
 * du même passé et de la même scène),
 * nouvel identifiant. L'original n'est jamais touché ; le clone est écrit en
 * tmp + fsync + rename pour ne jamais laisser un .jsonl à moitié écrit.
 * Le titre composé (« titre (branche) ») est un titre CHOISI : la branche part
 * donc avec titleCustom, et son nom ne bougera plus avec la langue de l'UI.
 */
export function forkChat(charId: string, chatId: string, title?: string): ChatMeta {
  const lines = fs.readFileSync(chatFile(charId, chatId), 'utf8').split('\n').filter(Boolean)
  if (lines.length === 0) throw new Error(`Chat corrompu : ${chatId}`)
  const header = normalizeHeader(JSON.parse(lines[0]) as ChatHeader)
  const id = newChatId(charId)
  const clone: ChatHeader = {
    ...header,
    id,
    // Titre localisé fourni par le client ; repli neutre pour les appels API bruts.
    title: title?.trim() || `${header.title} (branch)`,
    titleCustom: true,
    createdAt: new Date().toISOString(),
  }
  const file = chatFile(charId, id)
  const tmp = file + '.tmp'
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, [JSON.stringify(clone), ...lines.slice(1)].join('\n') + '\n')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
  return {
    id,
    title: clone.title,
    titleCustom: true,
    createdAt: clone.createdAt,
    updatedAt: fs.statSync(file).mtime.toISOString(),
    messageCount: lines.length - 1,
    ...(clone.summary ? { summary: clone.summary, summaryUpto: clone.summaryUpto ?? 0 } : {}),
    ...(typeof clone.pinned === 'number' ? { pinned: clone.pinned } : {}),
    ...(clone.sceneNotes ? { sceneNotes: clone.sceneNotes } : {}),
  }
}

/**
 * Met à jour l'en-tête d'un chat (résumé de compaction, message épinglé, notes de
 * scène…) en réécrivant la première ligne du .jsonl. Écriture temp + rename : un
 * crash au milieu ne corrompt jamais le fichier d'origine. Un champ du patch à
 * `undefined` disparaît de l'en-tête (JSON.stringify l'omet) — c'est ainsi
 * qu'on annule un résumé ou qu'on désépingle. Les champs ABSENTS du patch, eux,
 * sont conservés tels quels : une compaction ne touche donc pas aux notes de scène.
 */
export function updateChatHeader(
  charId: string,
  chatId: string,
  patch: Partial<
    Pick<ChatHeader, 'title' | 'titleCustom' | 'summary' | 'summaryUpto' | 'pinned' | 'sceneNotes'>
  >,
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
  const messages = lines.slice(1).map((l) => normalizeMessage(JSON.parse(l) as ChatMessage))
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
  // withFileTypes : ne descend JAMAIS dans les sous-dossiers (backups/ vit ici).
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
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
  // unlinkSync et non rmSync : sous Node 25/Windows, rmSync ne supprime PAS un
  // chemin contenant un caractère non-ASCII (« passé.md ») et ne lève rien —
  // le fichier restait dans la liste après un « ok ». Le try avale ENOENT pour
  // garder la sémantique de l'ancien { force: true }.
  try {
    fs.unlinkSync(path.join(memoryDir(charId), sanitizeFileName(name)))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
}

// ── Sauvegardes mémoire (feature « Ranger ») ──────────────────────────────
// Un snapshot = une copie de TOUS les fichiers .md dans memory/backups/<ts>/.
// Les snapshots s'empilent : le rangement ET chaque restauration en prennent
// un d'abord — l'historique de la mémoire est réversible à l'infini.

export interface MemoryBackupInfo {
  name: string // nom du dossier = horodatage YYYY-MM-DD_HHmmss
  files: number
  chars: number
}

function backupsDir(charId: string): string {
  return path.join(memoryDir(charId), 'backups')
}

/** Fichiers mémoire actuels (top-level .md uniquement, hors backups/). */
function currentMemoryFiles(charId: string): string[] {
  const dir = memoryDir(charId)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
}

function backupTimestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * Copie la mémoire courante dans memory/backups/<ts>/ — renvoie le nom du
 * snapshot (ou '' si la mémoire est vide : un snapshot vide est inutile).
 * Anti-collision : deux snapshots dans la même seconde se démarquent par -2, -3…
 */
export function snapshotMemory(charId: string): string {
  const files = currentMemoryFiles(charId)
  if (files.length === 0) return ''
  const base = backupsDir(charId)
  let name = backupTimestamp()
  for (let i = 2; fs.existsSync(path.join(base, name)); i++) name = `${backupTimestamp()}-${i}`
  const dest = path.join(base, name)
  fs.mkdirSync(dest, { recursive: true })
  for (const f of files) fs.copyFileSync(path.join(memoryDir(charId), f), path.join(dest, f))
  return name
}

/** Snapshots existants, les plus récents d'abord (les noms se trient). */
export function listMemoryBackups(charId: string): MemoryBackupInfo[] {
  const dir = backupsDir(charId)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const sub = path.join(dir, e.name)
      const entries = fs.readdirSync(sub, { withFileTypes: true }).filter((f) => f.isFile())
      let chars = 0
      for (const f of entries) chars += fs.statSync(path.join(sub, f.name)).size
      return { name: e.name, files: entries.length, chars }
    })
    .sort((a, b) => b.name.localeCompare(a.name))
}

/**
 * Restaure un snapshot : snapshot de sécurité de l'état courant D'ABORD (les
 * sauvegardes s'empilent — on ne perd jamais l'état qu'on remplace), puis
 * remplacement des fichiers par le contenu du snapshot.
 * Renvoie le nom du snapshot de sécurité (ou '' si la mémoire était vide).
 */
export function restoreMemoryBackup(charId: string, name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) throw new Error('Nom de sauvegarde invalide')
  const src = path.join(backupsDir(charId), name)
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    throw new Error(`Sauvegarde introuvable : ${name}`)
  }
  const safety = snapshotMemory(charId)
  for (const f of currentMemoryFiles(charId)) {
    // unlinkSync et non rmSync : piège Node 25/Windows sur les noms non-ASCII.
    try {
      fs.unlinkSync(path.join(memoryDir(charId), f))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  }
  for (const f of fs.readdirSync(src, { withFileTypes: true }).filter((e) => e.isFile())) {
    fs.copyFileSync(path.join(src, f.name), path.join(memoryDir(charId), f.name))
  }
  return safety
}

// Politique de gestion mémoire — le modèle ne la devinait pas : sans elle,
// « enregistrer » voulait dire memory_save systématique (fichier neuf ou
// écrasement), d'où les doublons et les « suppressions ». En anglais comme le
// reste des prompts ; toolless (mode simple) : les outils n'existent pas, donc
// aucune politique d'outils à donner.
const MEMORY_POLICY =
  'Memory policy — one topic per file; the index below lists what already exists. ' +
  'Check it BEFORE saving: if a file already covers the topic, memory_read it, then memory_update it ' +
  'with the COMPLETE merged content (keep every old fact, add the new ones) — never drop what is there. ' +
  'memory_save is for brand-new topics only (on an existing name it replaces the whole file, and is refused ' +
  'until you have read it). memory_append adds a fact to an existing file without rewriting it. ' +
  'No near-duplicate files, no duplicate index lines. memory_delete only for facts that are wrong ' +
  'or that the user asked to forget. Index lines stay one short line: - [Title](file.md) — a few words.\n'

// Seuils d'injection mémoire — exportés pour que le panneau mémoire puisse
// afficher CE QUI sera réellement injecté (même logique que le bloc ci-dessous).
export const MEMORY_FULL_INJECT_LIMIT = 8000 // mode outils : ≤ → tout, > → index seul
export const MEMORY_TOOLLESS_CAP = 24000 // mode simple : plafond de l'injection intégrale

/**
 * Bloc mémoire injecté dans le system prompt (transparent : visible dans l'inspecteur).
 * toolless (mode modèle « simple ») : AUCUN outil n'existe côté modèle — tout est
 * injecté, plafonné, et on ne mentionne jamais memory_read.
 */
export function buildMemoryBlock(charId: string, toolless = false): string {
  const files = listMemory(charId)
  if (files.length === 0) return ''
  const index = files.find((f) => f.name === 'MEMORY.md')
  const others = files.filter((f) => f.name !== 'MEMORY.md')
  const totalLen = others.reduce((n, f) => n + f.content.length, 0)
  let block = `\n\n## Memory (auto-injected by Hanami — edit in the Memory panel)\n`
  if (!toolless) block += MEMORY_POLICY
  if (index) block += index.content + '\n'
  if (toolless) {
    // Injection intégrale plafonnée : au-delà, les fichiers suivants sont coupés
    // (les plus gros en dernier pour sacrifier le moins de fichiers possible).
    const CAP = MEMORY_TOOLLESS_CAP
    let used = 0
    for (const f of [...others].sort((a, b) => a.content.length - b.content.length)) {
      if (used + f.content.length > CAP) {
        block += `\n(Memory file ${f.name} omitted — memory too large for simple mode; trim it in the Memory panel.)\n`
        continue
      }
      used += f.content.length
      block += `\n### ${f.name}\n${f.content}\n`
    }
  } else if (totalLen <= MEMORY_FULL_INJECT_LIMIT) {
    // Petits volumes : tout injecter.
    for (const f of others) block += `\n### ${f.name}\n${f.content}\n`
  } else if (others.length > 0) {
    // Gros volumes : index seul, le modèle lira via l'outil memory_read.
    block += `\n(${others.length} memory files — use the memory_read(name) tool to read one.)\n`
  }
  return block
}
