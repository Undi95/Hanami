// Réglages de l'app — data/config.json, mergé avec les défauts.
import fs from 'node:fs'
import path from 'node:path'
import type { CharacterMeta, Settings } from '../shared/types'
import { normalizeLlm, thinkingBudgetParam } from '../shared/llm'
import { normalizePersonas } from '../shared/personas'
import { CodedError, ErrorCodes } from '../shared/errorCodes'
import { DATA_DIR } from './lib/storage'

const CONFIG_FILE = path.join(DATA_DIR, 'config.json')

export const DEFAULT_SETTINGS: Settings = {
  backendUrl: 'http://127.0.0.1:5001/v1',
  apiKey: '',
  model: '',
  modelMode: 'full',
  temperature: 0.8,
  maxTokens: 1024,
  // 0 = auto : aucun paramètre de thinking envoyé, le modèle décide comme
  // avant ce réglage (un config d'avant la clé reste inchangé).
  thinkingBudget: 0,
  maxHistoryMessages: 40,
  memoryEnabled: true,
  fileToolsEnabled: false,
  allowDelete: false,
  toolsRoot: path.join(DATA_DIR, 'workspace'),
  password: '',
  contextSize: 8192,
  // Seuil par défaut de la jauge : avec un contexte géant (262k…), un seuil calé
  // sur la fenêtre complète serait injoignable en pratique — et au-delà, un
  // modèle local n'est que plus lent, pas plus attentif. Réglable dans l'UI.
  compactThreshold: 65536,
  // La jauge et l'auto-compaction suivent le SEUIL de compaction (défaut : le
  // comportement d'origine — le seuil est presque toujours < la taille de
  // contexte). L'utilisateur peut basculer sur la taille de contexte.
  compactBasis: 'threshold',
  autoCompact: true,
  timeAwareness: true,
  // Personas utilisateur : vide = aucun bloc injecté, et {{user}} retombe sur
  // « User ». defaultPersona = la persona utilisée quand un personnage n'en a
  // pas épinglé d'autre (shared/personas.ts décide, en 3 replis).
  userPersonas: [],
  defaultPersona: '',
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
    // Le PUT ne valide que le TYPE (string) : une base inconnue retombe sur le
    // défaut plutôt que de casser workingWindow.
    if (merged.compactBasis !== 'threshold' && merged.compactBasis !== 'context') {
      merged.compactBasis = DEFAULT_SETTINGS.compactBasis
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
    // Même raison pour le budget de raisonnement : un nombre non interprétable
    // (config édité à la main, PUT) retombe sur l'auto — on n'envoie au backend
    // qu'un budget bien formé ou rien du tout.
    merged.thinkingBudget = thinkingBudgetParam(merged.thinkingBudget)?.budget ?? 0
    // Migration « collection de personas » : le config d'avant portait un seul
    // couple personaName/personaDescription — il devient la persona {id:'default'}
    // de la collection (l'utilisateur ne perd pas son « moi » au premier save).
    // La liste, quand elle existe, passe par la même normalisation (le fichier
    // est éditable à la main : bornes, dédoublonnage, max 20).
    merged.userPersonas = normalizePersonas(raw.userPersonas ?? [])
    const legacy = raw as Record<string, unknown>
    if (!Array.isArray(raw.userPersonas)) {
      const name = typeof legacy.personaName === 'string' ? legacy.personaName.trim().slice(0, 60) : ''
      const description = typeof legacy.personaDescription === 'string' ? legacy.personaDescription.trim().slice(0, 1000) : ''
      if (name || description) {
        merged.userPersonas = [{ id: 'default', name, description }]
        merged.defaultPersona = 'default'
      }
    }
    // Les clés legacy, copiées dans merged par le spread, sont retirées : au
    // prochain saveSettings, plus rien ne les recopierait dans le fichier.
    delete legacy.personaName
    delete legacy.personaDescription
    delete (merged as Record<string, unknown>).personaName
    delete (merged as Record<string, unknown>).personaDescription
    // Cohérence du défaut : id absent de la collection → la première persona,
    // collection vide → '' (le même repli que shared/personas.ts côté lecture).
    if (!merged.userPersonas.some((p) => p.id === merged.defaultPersona)) {
      merged.defaultPersona = merged.userPersonas[0]?.id ?? ''
    }
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
    throw new CodedError(ErrorCodes.configUnreadableSave)
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

// Fenêtre de travail de la jauge et de l'auto-compaction : UNE valeur, au choix
// de l'utilisateur (compactBasis) — plus le plus petit des deux réglages.
//   'context'   = la taille de contexte du modèle (la compaction arrive tard,
//                 à 80 % d'elle — le choix le plus simple) ;
//   'threshold' = le seuil de compaction (défaut — le plus lisible sur un
//                 modèle local : on compacte avant la zone où le modèle
//                 ralentit ; à garder ≤ la taille de contexte), avec repli sur
//                 la taille de contexte quand le seuil vaut 0.
// Taille de contexte à 0 (inconnue) = pas de fenêtre : la jauge est neutre.
export function workingWindow(settings: Settings): number {
  if (settings.contextSize <= 0) return 0
  if (settings.compactBasis === 'context') return settings.contextSize
  return settings.compactThreshold > 0 ? settings.compactThreshold : settings.contextSize
}

/**
 * Les réglages EFFECTIFS pour un personnage : les réglages globaux avec les
 * overrides du personnage posés par-dessus (un champ absent retombe sur le
 * réglage de l'app). C'est l'objet que DOIVENT utiliser tous les call-sites
 * qui génèrent « pour » un personnage — chat, compaction, aperçu du prompt,
 * messages spontanés, rangement de mémoire — : repasser `loadSettings()` brut
 * là, c'est ignorer la carte du personnage. Sans `llm` (ou `llm` vide),
 * retourne tel quel les réglages globaux : un personnage écrit avant ce
 * réglage ne change d'aucune façon.
 */
export function effectiveSettings(character: Pick<CharacterMeta, 'llm'>): Settings {
  const base = loadSettings()
  const llm = normalizeLlm(character.llm)
  if (!llm) return base
  return { ...base, ...llm }
}

export const PORT = Number(process.env.PORT ?? 7788)
export const IS_PROD = process.argv.includes('--prod') || process.env.NODE_ENV === 'production'
