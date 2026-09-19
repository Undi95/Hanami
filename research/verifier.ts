// ── vérifieur DÉTERMINISTE de faits (zéro LLM, zéro dépendance) ──────────────
// Le filet de sûreté de la piste leader (hyp. 1 — voir research/RECHERCHE.md) :
// un LLM densifie AGRESSIVEMENT la mémoire, PUIS ce vérifieur (reproductible,
// zéro coût d'appel) contrôle que TOUT fait « dur » du texte ORIGINAL est ENCORE
// PRÉSENT dans la forme compressée. Un fait manquant → le passage est REJETÉ et
// on retombe sur l'encodeur déterministe (denseEncode) ou le texte original.
//
// Pourquoi zéro LLM ici : c'est tout l'intérêt. Un vérifieur-LLM réinjecterait le
// même risque qu'il est censé protéger (Size-Fidelity Paradox, arXiv 2602.09789).
// Le filet doit être une FONCTION pure, déterministe, testable.
//
// Ce que « fait dur » couvre (le prior art — EMNLP 2025 Amazon, arXiv 2505.00019 —
// dit EXACTEMENT ce qui se perd à la compression : nombres, dates, entités,
// relations fines) :
//   - les NOMBRES (séquences de 1-4 chiffres) : la VALEUR exacte, même collée à
//     une lettre (« L8 » = Léa 8 ans). « 8 » n'est PAS satisfait par « 18 ».
//   - les NOMS PROPRES (mots commençant par une majuscule, ≥ 2 lettres) :
//     insensible à la casse ET aux accents (« Anaïs » ≈ « anais »).
//
// LIMITES HONNÊTES (à ne pas sur-vendre) :
//   - Ça détecte la PERTE silencieuse (le fait disparaît), PAS le SWAP de relation
//     (l'âge de Léa attribué à Hugo). Le swap reste le résidu que la mesure de
//     RAPPEL (6 questions) attrape. → Les deux couches se complètent.
//   - Asymétrie volontaire : on préfère un FAUX-ROUGE (rejeter une compression
//     fidèle → on retombe sur denseEncode, on perd le gain mais pas la sûreté)
//     qu'un FAUX-VERT (laisser passer une perte de fait silencieuse).
//   - La stop-list d'entités est FR, focalisée sur les débuts de phrase
//     (possessifs/pronoms) que denseEncode retire légitimement.
export interface FactSet {
  numbers: string[]
  entities: string[]
}
export interface Verdict {
  ok: boolean
  missingNumbers: string[]
  missingEntities: string[]
}

// Accents normalisés (NFD) + diacritiques retirés — « â » ≈ « a ». (Écho au bug
// « mâle »→« mâ » : les accents sont des sources de faux signaux, on les neutralise.)
const stripAccents = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '')

// Mots fonctionnels FR qui ouvrent une phrase en majuscule mais ne sont PAS des
// entités. Retirés du jeu de faits pour éviter les faux-rouges.
const STOP = new Set([
  'mon', 'ma', 'mes', 'son', 'sa', 'ses', 'ton', 'ta', 'tes', 'notre', 'votre',
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles',
  'ce', 'cette', 'cet', 'ces', 'le', 'la', 'les', 'un', 'une', 'des',
])

// Nombres : toutes les séquences de 1-4 chiffres (ordre d'apparition, dédup).
export function extractNumbers(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(/\d{1,4}/g)) {
    if (!seen.has(m[0])) {
      seen.add(m[0])
      out.push(m[0])
    }
  }
  return out
}

// Entités : mots (séquences de lettres) qui COMMENCENT par une majuscule.
export function extractEntities(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(/\p{L}+/gu)) {
    const w = m[0]
    if (!/\p{Lu}/u.test(w[0])) continue
    const norm = stripAccents(w.toLowerCase())
    if (norm.length < 2 || STOP.has(norm) || seen.has(norm)) continue
    seen.add(norm)
    out.push(norm)
  }
  return out
}

export function extractFacts(text: string): FactSet {
  return { numbers: extractNumbers(text), entities: extractEntities(text) }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// « 8 » présent S'IL n'est pas noyé dans un plus grand nombre (« 18 », « 80 »).
const numberPresent = (comp: string, d: string) =>
  new RegExp(`(?<!\\d)${d}(?!\\d)`, 'g').test(comp)

// Entité présente en MOT (pas en sous-chaîne : « tom » ≠ « tomate »).
const entityPresent = (comp: string, e: string) =>
  new RegExp(`(?<![\\p{L}])${escapeRe(e)}(?![\\p{L}])`, 'gu').test(comp)

export function verifyFacts(original: string, compressed: string): Verdict {
  const facts = extractFacts(original)
  const comp = stripAccents(compressed.toLowerCase())
  const missingNumbers = facts.numbers.filter((n) => !numberPresent(comp, n))
  const missingEntities = facts.entities.filter((e) => !entityPresent(comp, e))
  return {
    ok: missingNumbers.length === 0 && missingEntities.length === 0,
    missingNumbers,
    missingEntities,
  }
}
