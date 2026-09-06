// Overrides de génération d'un personnage (CharacterLlm) — normalisation
// partagée par le serveur (écriture de character.json via storage, et
// effectiveSettings dans server/config) pour que le fichier, l'API et la
// lecture tombent d'accord sur ce qui est un override valide. Le serveur est
// le seul appelant : le client envoie l'objet brut, le serveur normalise.
import type { CharacterLlm } from './types'

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

/**
 * Le paramètre de budget de raisonnement envoyé au backend, partagé par le
 * client streaming (server/llm/openai.ts) et l'aperçu du prompt (chat.ts) pour
 * que l'Inspecteur montre EXACTEMENT ce qui part : `think: {type:'enabled',
 * budget}`. 0 (auto) = AUCUN paramètre : le modèle décide, comportement
 * d'origine.
 *
 * Vérité de terrain (Ollama 0.33.3, Qwen3.8, mesuré le 2026-09-06) : ce
 * format est ACCEPTÉ mais IGNORÉ par l'endpoint OpenAI-compatible d'Ollama,
 * et l'API native le refuse en 400 — son `think` est un booléen ou un niveau
 * ("high"/"medium"/"low"/"max") : il n'existe AUCUN budget de tokens dans
 * l'API Ollama. Ce qui s'applique sur l'endpoint compatible :
 * `reasoning_effort` (mêmes niveaux ; "none" coupe le thinking à zéro,
 * vérifié). Ce paramètre n'a donc d'effet que sur les backends qui
 * comprennent l'objet `think`.
 */
export function thinkingBudgetParam(budget: number): { type: 'enabled'; budget: number } | undefined {
  const n = Math.round(Number(budget))
  return Number.isFinite(n) && n > 0 ? { type: 'enabled', budget: Math.min(n, 1_000_000) } : undefined
}
