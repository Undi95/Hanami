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
// La validation vit dans shared/uiPrefs.ts, PARTAGÉE avec le serveur (api/ui.ts) :
// même table de règles des deux côtés, un cache local abîmé subit le même tri
// qu'un PUT douteux.
import { UI_PREF_KEYS, normalizeUiPrefs } from '../../shared/uiPrefs'
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

// (La liste des clés et la validation défensive — cache corrompu, vieilles clés
// éditées à la main — sont importées de shared/uiPrefs.ts, cf. l'import en tête.)

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
  return normalizeUiPrefs(out)
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
    if (raw) return normalizeUiPrefs(JSON.parse(raw))
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
 * La page s'en va avec un PUT encore en attente : sans ça, le dernier réglage
 * (les 600 ms du debounce) serait perdu. Envoi immédiat en keepalive, seule
 * forme de requête qui survit à la fermeture ET garde l'Authorization.
 */
function flushOnExit(): void {
  if (timer === null) return // rien en attente
  window.clearTimeout(timer)
  timer = null
  const patch = pending
  pending = {}
  if (Object.keys(patch).length > 0) api.putUiPrefsOnExit(patch)
}

// 'pagehide' couvre la fermeture de l'onglet et la navigation ; le passage en
// arrière-plan ('visibilitychange' → hidden) le complète sur mobile, où l'onglet
// peut être tué sans autre avertissement.
window.addEventListener('pagehide', flushOnExit)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushOnExit()
})

/**
 * Modifie une ou plusieurs préférences : cache mis à jour tout de suite,
 * abonnés prévenus, PUT débouncé (les patchs en attente fusionnent).
 * `null` supprime la clé ; une valeur identique à l'actuelle ne fait rien.
 */
export function setPref(patch: UiPrefsPatch): void {
  const next = { ...cache } as Record<string, unknown>
  const changed: Record<string, unknown> = {}
  for (const key of UI_PREF_KEYS) {
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
  cache = normalizeUiPrefs(next)
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
    server = normalizeUiPrefs(await api.getUiPrefs())
  } catch (e) {
    if (!(e instanceof api.AuthRequiredError)) console.warn('[prefs]', api.errorMessage(e))
    return
  }
  if (isEmpty(server)) {
    const legacy = readLegacy()
    if (!isEmpty(legacy)) {
      try {
        // PUT d'abord, effacement ensuite : un échec réseau ne perd rien.
        const saved = normalizeUiPrefs(await api.putUiPrefs(legacy))
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

// Le cadrage dépend du MODE d'affichage : en desktop l'avatar est posé à côté du
// panneau de chat, en visual novel il occupe tout l'écran — la même position ne
// convient pas aux deux. Une vue est donc mémorisée PAR personnage ET PAR mode,
// sous une clé composée « <charId>::<mode> ».
export type ViewMode = 'desktop' | 'vn'

const VIEW_MODES = ['desktop', 'vn'] as const satisfies readonly ViewMode[]

function viewKey(charId: string, mode: ViewMode): string {
  return `${charId}::${mode}`
}

export function getSavedView(charId: string, mode: ViewMode): StageView | undefined {
  const views = cache.views
  if (!views) return undefined
  const saved = views[viewKey(charId, mode)]
  if (saved) return saved
  // Repli : avant la séparation par mode, un seul cadrage était enregistré sous
  // l'id nu du personnage. Il tenait lieu de placement « à côté du chat », donc
  // il ne sert de repli qu'au mode desktop.
  return mode === 'desktop' ? views[charId] : undefined
}

/** Cadrage caméra d'un personnage dans un mode — `null` l'oublie (reset de la scène). */
export function setSavedView(charId: string, mode: ViewMode, view: StageView | null): void {
  const views = { ...cache.views }
  const key = viewKey(charId, mode)
  if (view) views[key] = view
  else delete views[key]
  // L'ancienne clé nue est remplacée par celle du mode desktop : sans ça, oublier
  // le cadrage desktop ferait resurgir la vue héritée au lieu du cadrage par défaut.
  if (mode === 'desktop') delete views[charId]
  setPref({ views: Object.keys(views).length > 0 ? views : null })
}

/** Personnage supprimé : sa conversation active, ses cadrages et sa sélection s'effacent. */
export function forgetCharacter(charId: string): void {
  const activeChat = { ...cache.activeChat }
  delete activeChat[charId]
  const views = { ...cache.views }
  delete views[charId] // clé héritée (avant la séparation par mode)
  for (const mode of VIEW_MODES) delete views[viewKey(charId, mode)]
  setPref({
    activeChat: Object.keys(activeChat).length > 0 ? activeChat : null,
    views: Object.keys(views).length > 0 ? views : null,
    ...(cache.activeCharacter === charId ? { activeCharacter: null } : {}),
  })
}
