// Overrides de génération d'un personnage (CharacterLlm) — normalisation
// partagée par le serveur (écriture de character.json via storage, et
// effectiveSettings dans server/config) pour que le fichier, l'API et la
// lecture tombent d'accord sur ce qui est un override valide. Le serveur est
// le seul appelant : le client envoie l'objet brut, le serveur normalise.
import type { CharacterLlm, ThinkingLevel } from './types'

/**
 * Les champs surchargeables sont exactement les paramètres posables au niveau
 * global : `model`, `modelMode`, `temperature`, `maxTokens`,
 * `maxHistoryMessages`, `contextSize`, `compactThreshold`. Tout le reste
 * (backend, clé API, sandbox…) est écarté : c'est le moteur de la maison, pas
 * une propriété du personnage. Valeurs hors sens écartées aussi — et un objet
 * sans aucun champ valide revient à `undefined` : le fichier ne doit pas
 * porter une clé `llm` vide.
 */
export function normalizeLlm(value: unknown): CharacterLlm | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const out: CharacterLlm = {}
  if (typeof raw.model === 'string' && raw.model.trim() !== '') out.model = raw.model.trim()
  if (raw.modelMode === 'full' || raw.modelMode === 'simple') out.modelMode = raw.modelMode
  const t = raw.temperature
  if (typeof t === 'number' && Number.isFinite(t) && t >= 0) out.temperature = t
  for (const k of ['maxTokens', 'maxHistoryMessages', 'contextSize', 'compactThreshold'] as const) {
    const v = raw[k]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = Math.round(v)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Les niveaux du réglage thinkingLevel, dans l'ordre du sélecteur. */
export const THINKING_LEVELS: readonly ThinkingLevel[] = ['auto', 'low', 'medium', 'high', 'max', 'none']

/** Valeur inconnue (config édité à la main, PUT) → 'auto' : on n'envoie au backend qu'un niveau documenté ou rien. */
export function normalizeThinkingLevel(value: unknown): ThinkingLevel {
  return typeof value === 'string' && (THINKING_LEVELS as readonly string[]).includes(value)
    ? (value as ThinkingLevel)
    : 'auto'
}

/**
 * Le paramètre de niveau de raisonnement envoyé au backend, partagé par le
 * client streaming (server/llm/openai.ts) et l'aperçu du prompt (chat.ts)
 * pour que l'Inspecteur montre EXACTEMENT ce qui part :
 * `reasoning_effort: <niveau>`. 'auto' = AUCUN paramètre : le modèle décide,
 * comportement d'origine.
 *
 * Vérité de terrain (Ollama 0.33.3, Qwen3.8, mesuré le 2026-09-06) : c'est
 * le SEUL contrôle de thinking appliqué par l'endpoint OpenAI-compatible —
 * "none" coupe le raisonnement à zéro (vérifié), les niveaux le bornent.
 * L'ancien objet `think: {type:'enabled', budget}` (budget de tokens) était
 * accepté mais ignoré : l'API Ollama n'a pas de budget de tokens, seulement
 * des niveaux (la native refuse l'objet en 400). Un backend qui ne connaît
 * pas `reasoning_effort` l'ignore comme tout champ inconnu qu'il tolère.
 */
export function reasoningEffortParam(level: ThinkingLevel): string | undefined {
  return level === 'auto' ? undefined : level
}
