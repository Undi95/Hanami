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
  showThoughts: false,
  ttsEnabled: false,
  ttsUrl: '',
  ttsModel: '',
  ttsVoice: '',
  // Opt-in : par défaut le personnage n'écrit JAMAIS de lui-même.
  spontaneousEnabled: false,
  spontaneousStartHour: 9,
  spontaneousEndHour: 22,
  // 'auto' : Hanami demande au backend si le modèle voit les images (GET /api/vision).
  visionMode: 'auto',
}

/** Heure locale valide (entier 0-23) — sinon la valeur par défaut. */
function normalizeHour(value: unknown, fallback: number): number {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : fallback
}

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Partial<Settings>
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
    // Même raison : le PUT accepte n'importe quel nombre, la plage horaire doit
    // rester un couple d'heures réelles (sinon le moteur spontané ne s'ouvrirait jamais).
    merged.spontaneousStartHour = normalizeHour(merged.spontaneousStartHour, DEFAULT_SETTINGS.spontaneousStartHour)
    merged.spontaneousEndHour = normalizeHour(merged.spontaneousEndHour, DEFAULT_SETTINGS.spontaneousEndHour)
    return merged
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch }
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2))
  return next
}

export const PORT = Number(process.env.PORT ?? 7788)
export const IS_PROD = process.argv.includes('--prod') || process.env.NODE_ENV === 'production'
