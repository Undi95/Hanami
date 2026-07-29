// Préférences d'interface — le SERVEUR (data/ui.json) fait foi.
//
// Le localStorage n'est plus qu'un CACHE : il est lu SYNCHRONE au chargement du
// module, ce qui permet d'appliquer thème et langue sans le moindre flash (et de
// rester utilisable hors-ligne). Au boot, loadServerPrefs() récupère l'état
// serveur, remplace le cache et prévient les abonnés ; chaque setPref met le
// cache à jour immédiatement puis pousse un PUT débouncé.
//
// Le token d'accès (hanami_token, cf. api.ts) n'est PAS une préférence : c'est
// une clé par appareil, il reste local et n'entre jamais ici.
import type { StageView, UiPrefs, UiPrefsPatch } from '../../shared/types'
import * as api from './api'

const CACHE_KEY = 'hanami_prefs'
// Délai de regroupement des PUT : un drag de caméra ou une rafale de clics
// n'écrit qu'une fois.
const PUT_DELAY_MS = 600

// Anciennes clés (avant la bascule serveur) : lues au démarrage tant que le
// cache unifié n'existe pas, migrées une seule fois, puis effacées.
const LEGACY = {
  lang: 'hanami_lang',
  theme: 'hanami_theme',
  custom: 'hanami_custom_theme',
  vn: 'hanami_vn',
  char: 'hanami_char',
  chatPrefix: 'hanami_chat_',
  viewPrefix: 'hanami_view_',
} as const

const UI_KEYS = [
  'lang',
  'theme',
  'customTheme',
  'vnMode',
  'activeCharacter',
  'activeChat',
  'views',
] as const satisfies readonly (keyof UiPrefs)[]

// ── Validation défensive (cache corrompu, vieilles clés éditées à la main) ──

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function isTriple(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}

function asView(value: unknown): StageView | undefined {
  if (!value || typeof value !== 'object') return undefined
  const o = value as { pos?: unknown; target?: unknown }
  return isTriple(o.pos) && isTriple(o.target) ? { pos: o.pos, target: o.target } : undefined
}

function asId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : undefined
}

function asRecord<T>(value: unknown, item: (raw: unknown) => T | undefined): Record<string, T> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, T> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key || key === '__proto__') continue
    const val = item(raw)
    if (val !== undefined) out[key] = val
  }
  return out
}

// Un validateur par clé : le serveur applique les mêmes règles, le client se
// protège en plus d'un cache local abîmé.
const VALIDATORS: { [K in keyof Required<UiPrefs>]: (value: unknown) => UiPrefs[K] | undefined } = {
  lang: (v) => (v === 'fr' || v === 'en' ? v : undefined),
  theme: (v) => (typeof v === 'string' && v.length > 0 && v.length <= 32 ? v : undefined),
  customTheme: (v) => {
    if (!v || typeof v !== 'object') return undefined
    const o = v as { bg?: unknown; accent?: unknown }
    if (typeof o.bg !== 'string' || !HEX_RE.test(o.bg)) return undefined
    if (typeof o.accent !== 'string' || !HEX_RE.test(o.accent)) return undefined
    return { bg: o.bg, accent: o.accent }
  },
  vnMode: (v) => (typeof v === 'boolean' ? v : undefined),
  activeCharacter: asId,
  activeChat: (v) => asRecord(v, asId),
  views: (v) => asRecord(v, asView),
}

function normalize(raw: unknown): UiPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const source = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of UI_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue
    const value = (VALIDATORS[key] as (v: unknown) => unknown)(source[key])
    if (value !== undefined) out[key] = value
  }
  return out as UiPrefs
}

function isEmpty(prefs: UiPrefs): boolean {
  return Object.keys(prefs).length === 0
}

/** Égalité de valeurs de préférence (scalaires, ou petits objets construits ici). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

// ── Cache local ────────────────────────────────────────────────────────────

/** Anciennes clés converties en UiPrefs (sans les effacer : la migration décide). */
function readLegacy(): UiPrefs {
  const out: Record<string, unknown> = {}
  try {
    const lang = localStorage.getItem(LEGACY.lang)
    if (lang) out.lang = lang
    const theme = localStorage.getItem(LEGACY.theme)
    if (theme) out.theme = theme
    const custom = localStorage.getItem(LEGACY.custom)
    if (custom) {
      try {
        out.customTheme = JSON.parse(custom)
      } catch {
        /* thème perso illisible : ignoré */
      }
    }
    const vn = localStorage.getItem(LEGACY.vn)
    if (vn !== null) out.vnMode = vn === '1'
    const char = localStorage.getItem(LEGACY.char)
    if (char) out.activeCharacter = char
    const activeChat: Record<string, string> = {}
    const views: Record<string, unknown> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      const value = localStorage.getItem(key)
      if (!value) continue
      if (key.startsWith(LEGACY.chatPrefix)) {
        activeChat[key.slice(LEGACY.chatPrefix.length)] = value
      } else if (key.startsWith(LEGACY.viewPrefix)) {
        try {
          views[key.slice(LEGACY.viewPrefix.length)] = JSON.parse(value)
        } catch {
          /* cadrage illisible : ignoré */
        }
      }
    }
    if (Object.keys(activeChat).length > 0) out.activeChat = activeChat
    if (Object.keys(views).length > 0) out.views = views
  } catch {
    /* localStorage indisponible (mode privé strict) */
  }
  return normalize(out)
}

function clearLegacy(): void {
  try {
    const doomed: string[] = [LEGACY.lang, LEGACY.theme, LEGACY.custom, LEGACY.vn, LEGACY.char]
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && (key.startsWith(LEGACY.chatPrefix) || key.startsWith(LEGACY.viewPrefix))) doomed.push(key)
    }
    for (const key of doomed) localStorage.removeItem(key)
  } catch {
    /* localStorage indisponible */
  }
}

function readCache(): UiPrefs {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) return normalize(JSON.parse(raw))
  } catch {
    /* cache absent ou illisible */
  }
  // Pas encore de cache unifié : on repart des anciennes clés, pour qu'un
  // premier démarrage après la mise à jour n'ait ni flash ni réglages perdus.
  return readLegacy()
}

function writeCache(): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* préférence non mise en cache : pas bloquant, le serveur fait foi */
  }
}

// ── État du module ─────────────────────────────────────────────────────────

let cache: UiPrefs = readCache()
const subscribers = new Set<() => void>()
let pending: UiPrefsPatch = {}
let timer: number | null = null
// Vrai pendant l'application des valeurs VENUES du serveur : ce que l'UI
// « repose » alors ne doit jamais repartir en PUT (pas de boucle).
let fromServer = false

function notify(): void {
  for (const cb of [...subscribers]) {
    try {
      cb()
    } catch (e) {
      console.error('[prefs]', e)
    }
  }
}

/** S'abonner aux changements de préférences ; renvoie le désabonnement. */
export function subscribePrefs(cb: () => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

export function getPrefs(): Readonly<UiPrefs> {
  return cache
}

export function getPref<K extends keyof UiPrefs>(key: K): UiPrefs[K] {
  return cache[key]
}

function flush(): void {
  timer = null
  const patch = pending
  pending = {}
  if (Object.keys(patch).length === 0) return
  api.putUiPrefs(patch).catch((e) => {
    // Hors-ligne, session expirée : le cache local garde la préférence, elle
    // repartira au prochain changement. Jamais bloquant pour l'utilisateur.
    console.warn('[prefs]', api.errorMessage(e))
  })
}

function queuePut(patch: UiPrefsPatch): void {
  Object.assign(pending, patch)
  if (timer !== null) window.clearTimeout(timer)
  timer = window.setTimeout(flush, PUT_DELAY_MS)
}

/**
 * Modifie une ou plusieurs préférences : cache mis à jour tout de suite,
 * abonnés prévenus, PUT débouncé (les patchs en attente fusionnent).
 * `null` supprime la clé ; une valeur identique à l'actuelle ne fait rien.
 */
export function setPref(patch: UiPrefsPatch): void {
  const next = { ...cache } as Record<string, unknown>
  const changed: Record<string, unknown> = {}
  for (const key of UI_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    const value = (patch as Record<string, unknown>)[key]
    if (value === undefined) continue // absent du patch : rien à faire
    if (value === null) {
      if (next[key] === undefined) continue
      delete next[key]
      changed[key] = null
      continue
    }
    if (same(next[key], value)) continue
    next[key] = value
    changed[key] = value
  }
  if (Object.keys(changed).length === 0) return
  cache = normalize(next)
  writeCache()
  notify()
  if (fromServer) return // valeur venue du serveur : ne pas la lui renvoyer
  queuePut(changed as UiPrefsPatch)
}

function applyFromServer(next: UiPrefs): void {
  cache = next
  writeCache()
  fromServer = true
  try {
    notify()
  } finally {
    fromServer = false
  }
}

/**
 * Récupère l'état serveur et l'installe comme vérité. À appeler une fois
 * l'authentification acquise. Un 401 (instance protégée, pas encore connectée)
 * est avalé en silence : le cache reste en place et le LoginGate est déclenché
 * par les appels métier, pas par les préférences.
 *
 * Migration : si le serveur ne connaît rien et que les anciennes clés locales
 * existent, elles sont converties, envoyées au serveur, puis effacées — le
 * setup de l'utilisateur est retrouvé à l'identique.
 */
export async function loadServerPrefs(): Promise<void> {
  let server: UiPrefs
  try {
    server = normalize(await api.getUiPrefs())
  } catch (e) {
    if (!(e instanceof api.AuthRequiredError)) console.warn('[prefs]', api.errorMessage(e))
    return
  }
  if (isEmpty(server)) {
    const legacy = readLegacy()
    if (!isEmpty(legacy)) {
      try {
        // PUT d'abord, effacement ensuite : un échec réseau ne perd rien.
        const saved = normalize(await api.putUiPrefs(legacy))
        clearLegacy()
        applyFromServer(saved)
      } catch (e) {
        if (!(e instanceof api.AuthRequiredError)) console.warn('[prefs]', api.errorMessage(e))
      }
      return
    }
  }
  clearLegacy() // le serveur fait foi : les anciennes clés n'ont plus de rôle
  applyFromServer(server)
}

// ── Raccourcis pour les préférences par personnage (dictionnaires) ─────────
// Le merge serveur est SUPERFICIEL : un dictionnaire se réécrit en entier.

export function getActiveChat(charId: string): string | undefined {
  return cache.activeChat?.[charId]
}

export function setActiveChat(charId: string, chatId: string): void {
  setPref({ activeChat: { ...cache.activeChat, [charId]: chatId } })
}

export function getSavedView(charId: string): StageView | undefined {
  return cache.views?.[charId]
}

/** Cadrage caméra d'un personnage — `null` l'oublie (double-clic dans la scène). */
export function setSavedView(charId: string, view: StageView | null): void {
  const views = { ...cache.views }
  if (view) views[charId] = view
  else delete views[charId]
  setPref({ views: Object.keys(views).length > 0 ? views : null })
}

/** Personnage supprimé : sa conversation active, son cadrage et sa sélection s'effacent. */
export function forgetCharacter(charId: string): void {
  const activeChat = { ...cache.activeChat }
  delete activeChat[charId]
  const views = { ...cache.views }
  delete views[charId]
  setPref({
    activeChat: Object.keys(activeChat).length > 0 ? activeChat : null,
    views: Object.keys(views).length > 0 ? views : null,
    ...(cache.activeCharacter === charId ? { activeCharacter: null } : {}),
  })
}
