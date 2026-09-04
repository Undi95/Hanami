// Réglages de l'app — data/config.json, mergé avec les défauts.
import fs from 'node:fs'
import path from 'node:path'
import type { Settings } from '../shared/types'
import { DATA_DIR } from './lib/storage'

const CONFIG_FILE = path.join(DATA_DIR, 'config.json')

export const DEFAULT_SETTINGS: Settings = {
  backendUrl: 'http://127.0.0.1:5001/v1',
  apiKey: '',
  model: '',
  modelMode: 'full',
  temperature: 0.8,
  maxTokens: 1024,
  maxHistoryMessages: 40,
  memoryEnabled: true,
  fileToolsEnabled: false,
  allowDelete: false,
  toolsRoot: path.join(DATA_DIR, 'workspace'),
  password: '',
  contextSize: 8192,
  autoCompact: true,
  timeAwareness: true,
  // Persona : vide = aucun bloc injecté, et {{user}} retombe sur « User ».
  personaName: '',
  personaDescription: '',
  showThoughts: false,
  ttsEnabled: false,
  ttsUrl: '',
  ttsModel: '',
  ttsVoice: '',
  // Opt-in : aucun son n'est joué tant que l'utilisateur ne le demande pas.
  notifySound: false,
  // Opt-in : par défaut le personnage n'écrit JAMAIS de lui-même.
  spontaneousEnabled: false,
  spontaneousStartHour: 9,
  spontaneousEndHour: 22,
  // 'auto' : Hanami demande au backend si le modèle voit les images (GET /api/vision).
  visionMode: 'auto',
  // Opt-in : DuckDuckGo (sans clé) par défaut — SearXNG ou Tavily au choix, via le sélecteur.
  webSearchEnabled: false,
  webSearchEngine: 'duckduckgo',
  webSearchUrl: '',
  tavilyApiKey: '',
}

/** Heure locale valide (entier 0-23) — sinon la valeur par défaut. */
function normalizeHour(value: unknown, fallback: number): number {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : fallback
}

// Vrai quand config.json EXISTE mais n'a pas pu être lu (JSON invalide, EACCES,
// disque) : les réglages servis sont alors les DÉFAUTS — mot de passe compris.
// L'authentification consulte ce drapeau pour FERMER au lieu d'ouvrir, et
// saveSettings refuse d'écrire (sinon les défauts écraseraient le fichier abîmé
// et la perte deviendrait irréversible).
let unreadable = false

/** L'état de la dernière lecture : config présent mais illisible. */
export function configUnreadable(): boolean {
  return unreadable
}

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Partial<Settings>
    unreadable = false
    const merged = { ...DEFAULT_SETTINGS, ...raw }
    // toolsRoot absent, vide ou relatif → la sandbox retomberait sur le cwd : retour au défaut.
    if (typeof merged.toolsRoot !== 'string' || !merged.toolsRoot.trim() || !path.isAbsolute(merged.toolsRoot)) {
      merged.toolsRoot = DEFAULT_SETTINGS.toolsRoot
    }
    // Le PUT ne valide que le TYPE des valeurs : une chaîne inconnue passerait.
    if (merged.modelMode !== 'full' && merged.modelMode !== 'simple') {
      merged.modelMode = DEFAULT_SETTINGS.modelMode
    }
    if (merged.visionMode !== 'auto' && merged.visionMode !== 'on' && merged.visionMode !== 'off') {
      merged.visionMode = DEFAULT_SETTINGS.visionMode
    }
    // raw, pas merged : merged.webSearchEngine vaut déjà 'duckduckgo' par le
    // spread du défaut même quand le fichier ne porte pas la clé — c'est
    // justement CE cas (config d'avant le sélecteur) qu'il faut détecter.
    if (raw.webSearchEngine !== 'duckduckgo' && raw.webSearchEngine !== 'searxng' && raw.webSearchEngine !== 'tavily') {
      // Migration : avant le sélecteur, une URL SearXNG renseignée suffisait à
      // basculer dessus — on préserve ce choix plutôt que de retomber sur
      // DuckDuckGo en silence pour qui l'avait déjà configurée.
      merged.webSearchEngine = merged.webSearchUrl?.trim() ? 'searxng' : DEFAULT_SETTINGS.webSearchEngine
    }
    // Même raison : le PUT accepte n'importe quel nombre, la plage horaire doit
    // rester un couple d'heures réelles (sinon le moteur spontané ne s'ouvrirait jamais).
    merged.spontaneousStartHour = normalizeHour(merged.spontaneousStartHour, DEFAULT_SETTINGS.spontaneousStartHour)
    merged.spontaneousEndHour = normalizeHour(merged.spontaneousEndHour, DEFAULT_SETTINGS.spontaneousEndHour)
    return merged
  } catch (e) {
    // ABSENT (premier lancement) : les défauts sont légitimes. ILLISIBLE (JSON
    // cassé, permissions, disque) : les défauts sont un pis-aller DANGEREUX —
    // le mot de passe des défauts est vide, l'authentification s'ouvrirait.
    // Le drapeau `unreadable` permet à l'auth de fermer et à saveSettings de
    // refuser d'écraser le fichier abîmé.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      unreadable = true
      console.error('[config] config.json illisible — réglages par défaut servis, écriture bloquée :', e)
    } else {
      unreadable = false
    }
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch }
  if (unreadable) {
    // Écrire maintenant persisterait les DÉFAUTS par-dessus le fichier abîmé :
    // la perte deviendrait irréversible. L'utilisateur répare (ou supprime) le
    // fichier d'abord — le message remonte tel quel dans les Réglages.
    throw new Error('config.json est illisible : réparez ou supprimez le fichier avant de modifier les réglages')
  }
  fs.mkdirSync(DATA_DIR, { recursive: true })
  // Écriture ATOMIQUE (tmp + fsync + rename), même protocole que data/ui.json et
  // les .jsonl : une coupure ne laisse jamais un config.json à moitié écrit —
  // c'est LE fichier qui porte le mot de passe et la clé API.
  const json = JSON.stringify(next, null, 2)
  const tmp = CONFIG_FILE + '.tmp'
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, json)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, CONFIG_FILE)
  return next
}

// Fenêtre de travail de la jauge : jamais plus de ça, même pour un modèle au
// contexte géant (262k…). Au-delà, un modèle local n'est que plus lent — pas
// plus attentif — et un seuil d'auto-compaction calé sur la fenêtre complète
// serait injoignable en pratique (la jauge plafonnerait à ~15 % et ne
// compacterait jamais). Les petits contextes (8k…) gardent leur valeur réelle.
export const WORKING_WINDOW_MAX = 65536

/** Fenêtre sur laquelle la jauge et l'auto-compaction se normalisent. 0 = inconnue. */
export function workingWindow(settings: Settings): number {
  return settings.contextSize > 0 ? Math.min(settings.contextSize, WORKING_WINDOW_MAX) : 0
}

export const PORT = Number(process.env.PORT ?? 7788)
export const IS_PROD = process.argv.includes('--prod') || process.env.NODE_ENV === 'production'
