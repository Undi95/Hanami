// Validation des préférences d'interface — LA règle commune, importée par le
// serveur (api/ui.ts, qui protège data/ui.json) ET par le client (prefs.ts,
// qui se protège d'un cache localStorage abîmé). Avant cette factorisation les
// deux copies avaient déjà divergé : le client acceptait des clés de
// dictionnaire que le serveur jetait. La version la plus STRICTE fait foi.
import type { StageView, UiCustomTheme, UiPrefs } from './types'

const HEX_RE = /^#[0-9a-fA-F]{6}$/
// Clés des dictionnaires (identifiants de personnage/conversation, parfois
// suffixés du mode d'affichage : « <charId>::vn » pour les cadrages caméra) :
// jeu de caractères restreint, et jamais un nom qui toucherait au prototype.
// La longueur laisse la place à un id de 64 caractères plus son suffixe.
const KEY_RE = /^[A-Za-z0-9._:-]{1,80}$/
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_STRING = 200
const MAX_ENTRIES = 200

function asString(value: unknown, max = MAX_STRING): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined
}

function asCustomTheme(value: unknown): UiCustomTheme | undefined {
  if (!value || typeof value !== 'object') return undefined
  const o = value as { bg?: unknown; accent?: unknown }
  if (typeof o.bg !== 'string' || !HEX_RE.test(o.bg)) return undefined
  if (typeof o.accent !== 'string' || !HEX_RE.test(o.accent)) return undefined
  return { bg: o.bg, accent: o.accent }
}

/**
 * Taille de panneau en pixels : entier dans des bornes LARGES. Le bornage fin
 * (60 % de la fenêtre, marges de la boîte VN) appartient au client, qui seul
 * connaît l'écran ; ici on ne refuse que l'absurde.
 */
function asPixels(min: number, max: number): (value: unknown) => number | undefined {
  return (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
    const px = Math.round(value)
    return px >= min && px <= max ? px : undefined
  }
}

function asTriple(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined
  if (!value.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined
  return [value[0] as number, value[1] as number, value[2] as number]
}

function asView(value: unknown): StageView | undefined {
  if (!value || typeof value !== 'object') return undefined
  const o = value as { pos?: unknown; target?: unknown }
  const pos = asTriple(o.pos)
  const target = asTriple(o.target)
  return pos && target ? { pos, target } : undefined
}

/** Dictionnaire clé → valeur validée ; entrées invalides ou clés douteuses écartées. */
function asRecord<T>(value: unknown, item: (raw: unknown) => T | undefined): Record<string, T> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, T> = {}
  let n = 0
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (n >= MAX_ENTRIES) break
    if (!KEY_RE.test(key) || FORBIDDEN_KEYS.has(key)) continue
    const val = item(raw)
    if (val === undefined) continue
    out[key] = val
    n++
  }
  return out
}

// Un validateur par clé de UiPrefs — le type mappé garantit qu'aucune n'est oubliée.
export const UI_PREF_VALIDATORS: { [K in keyof Required<UiPrefs>]: (value: unknown) => UiPrefs[K] | undefined } = {
  lang: (v) => (v === 'fr' || v === 'en' ? v : undefined),
  theme: (v) => asString(v, 32),
  customTheme: asCustomTheme,
  vnMode: (v) => (typeof v === 'boolean' ? v : undefined),
  env3d: (v) => (typeof v === 'boolean' ? v : undefined),
  vrmaEnabled: (v) => (typeof v === 'boolean' ? v : undefined),
  interactive: (v) => (typeof v === 'boolean' ? v : undefined),
  chatPanelWidth: asPixels(280, 4000),
  vnBoxWidth: asPixels(400, 8000),
  vnBoxHeight: asPixels(60, 4000),
  activeCharacter: (v) => asString(v, 128),
  activeChat: (v) => asRecord(v, (raw) => asString(raw, 128)),
  views: (v) => asRecord(v, asView),
}

export const UI_PREF_KEYS = Object.keys(UI_PREF_VALIDATORS) as (keyof UiPrefs)[]

/** Objet quelconque → UiPrefs propre : clés inconnues jetées, valeurs invalides omises. */
export function normalizeUiPrefs(raw: unknown): UiPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const source = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of UI_PREF_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue
    const value = (UI_PREF_VALIDATORS[key] as (v: unknown) => unknown)(source[key])
    if (value !== undefined) out[key] = value
  }
  return out as UiPrefs
}
