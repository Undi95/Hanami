// Thèmes préfaits — cinq palettes complètes définies dans styles.css et
// appliquées via l'attribut data-theme de <html>. Préférence locale (comme la
// langue) ; un thème propre au personnage actif prend le dessus.
import type { Key } from './i18n'

export const THEMES = ['sakura', 'minuit', 'matcha', 'braise', 'encre'] as const
export type ThemeId = (typeof THEMES)[number]

/** Clés i18n des noms de thèmes (les identifiants restent stables côté stockage). */
export const THEME_LABELS: Record<ThemeId, Key> = {
  sakura: 'themeSakura',
  minuit: 'themeMinuit',
  matcha: 'themeMatcha',
  braise: 'themeBraise',
  encre: 'themeEncre',
}

/** Thème applicable : un préfait, ou « custom » (deux couleurs de l'utilisateur). */
export type AppTheme = ThemeId | 'custom'

const THEME_KEY = 'hanami_theme'
const CUSTOM_KEY = 'hanami_custom_theme'

/** Thème perso : deux couleurs seulement — tout le shading est dérivé en CSS. */
export interface CustomTheme {
  bg: string
  accent: string
}

export const DEFAULT_CUSTOM: CustomTheme = { bg: '#1a1030', accent: '#a0e8d8' }

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value)
}

/** Valeur inconnue (vieux localStorage, character.json édité à la main) → défaut. */
export function normalizeTheme(value: unknown): AppTheme {
  if (value === 'custom') return 'custom'
  return (THEMES as readonly string[]).includes(value as string) ? (value as ThemeId) : 'sakura'
}

export function savedTheme(): AppTheme {
  try {
    return normalizeTheme(localStorage.getItem(THEME_KEY))
  } catch {
    return 'sakura'
  }
}

export function saveTheme(theme: AppTheme): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* préférence non persistée : pas bloquant */
  }
}

export function savedCustom(): CustomTheme {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '') as Partial<CustomTheme>
    return {
      bg: isHexColor(raw.bg) ? raw.bg : DEFAULT_CUSTOM.bg,
      accent: isHexColor(raw.accent) ? raw.accent : DEFAULT_CUSTOM.accent,
    }
  } catch {
    return { ...DEFAULT_CUSTOM }
  }
}

export function saveCustom(custom: CustomTheme): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom))
  } catch {
    /* préférence non persistée : pas bloquant */
  }
}

/** Code partageable d'un thème perso : « #fond #accent ». */
export function themeCode(custom: CustomTheme): string {
  return `${custom.bg} ${custom.accent}`
}

/** Parse un code collé (deux couleurs hex, séparateur libre) — null si invalide. */
export function parseThemeCode(code: string): CustomTheme | null {
  const hexes = code.match(/#[0-9a-fA-F]{6}/g)
  if (!hexes || hexes.length < 2) return null
  return { bg: hexes[0], accent: hexes[1] }
}

/** Thème effectif : celui du personnage s'il en a un de valide, sinon celui de l'app. */
export function resolveTheme(characterTheme: string | undefined, appTheme: AppTheme): AppTheme {
  if (characterTheme === 'custom') return 'custom'
  if (characterTheme && (THEMES as readonly string[]).includes(characterTheme)) {
    return characterTheme as ThemeId
  }
  return appTheme
}

export function applyTheme(theme: AppTheme): void {
  const root = document.documentElement
  if (theme === 'custom') {
    const custom = savedCustom()
    root.dataset.theme = 'custom'
    root.style.setProperty('--custom-bg', custom.bg)
    root.style.setProperty('--custom-accent', custom.accent)
    return
  }
  root.style.removeProperty('--custom-bg')
  root.style.removeProperty('--custom-accent')
  if (theme === 'sakura') delete root.dataset.theme
  else root.dataset.theme = theme
}

/** Pastilles du sélecteur : [accent, fond] de chaque thème. */
export const THEME_DOTS: Record<ThemeId, [string, string]> = {
  sakura: ['#f5a3c7', '#171221'],
  minuit: ['#8fc1ee', '#0f1420'],
  matcha: ['#a5d9a7', '#111a13'],
  braise: ['#f0b183', '#1a1210'],
  encre: ['#c9c9d4', '#121214'],
}
