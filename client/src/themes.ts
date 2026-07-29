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

const THEME_KEY = 'hanami_theme'

/** Valeur inconnue (vieux localStorage, character.json édité à la main) → défaut. */
export function normalizeTheme(value: unknown): ThemeId {
  return (THEMES as readonly string[]).includes(value as string) ? (value as ThemeId) : 'sakura'
}

export function savedTheme(): ThemeId {
  try {
    return normalizeTheme(localStorage.getItem(THEME_KEY))
  } catch {
    return 'sakura'
  }
}

export function saveTheme(theme: ThemeId): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* préférence non persistée : pas bloquant */
  }
}

/** Thème effectif : celui du personnage s'il en a un de valide, sinon celui de l'app. */
export function resolveTheme(characterTheme: string | undefined, appTheme: ThemeId): ThemeId {
  if (characterTheme && (THEMES as readonly string[]).includes(characterTheme)) {
    return characterTheme as ThemeId
  }
  return appTheme
}

export function applyTheme(theme: ThemeId): void {
  if (theme === 'sakura') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}

/** Pastilles du sélecteur : [accent, fond] de chaque thème. */
export const THEME_DOTS: Record<ThemeId, [string, string]> = {
  sakura: ['#f5a3c7', '#171221'],
  minuit: ['#8fc1ee', '#0f1420'],
  matcha: ['#a5d9a7', '#111a13'],
  braise: ['#f0b183', '#1a1210'],
  encre: ['#c9c9d4', '#121214'],
}
