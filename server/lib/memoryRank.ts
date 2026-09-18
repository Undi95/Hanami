// Classement des fichiers mémoire par pertinence — LOGIQUE PURE (testable sans
// LLM, sans FS). C'est le moteur de l'injection SÉLECTIVE : plutôt que le
// tout-ou-rien actuel (≤ 8 000 chars = tout, > = index seul), on range les
// fichiers par pertinence à la requête courante et on injecte les plus
// pertinents qui tiennent dans un budget ; le reste reste lisible via
// memory_read (index + outils conservés).
//
// Pourquoi pas d'embeddings ni d'appel LLM : Hanami est ultra-léger/local, et
// le signal lexical (chevauchement de termes + idf) est déterministe, gratuit et
// déjà bien meilleur que « tout » (les distracteurs inutiles sont mis à l'index
// et sortent de l'injection — c'est le point de la recherche : les distracteurs
// proches dégradent plus que la longueur).
import type { MemoryFile } from '../../shared/types'

export interface RankedMemory {
  file: MemoryFile
  /** Score de pertinence (0 = aucun chevauchement avec la requête). */
  score: number
}

// Stopwords FR + EN (minimales) : les mots vides ne doivent pas compter comme
// pertinence. Une liste non exhaustive suffit — un mot stop manquant ne fait que
// diluer un peu le signal, pas casser le classement.
const STOPWORDS = new Set<string>(
  (
    'je tu il elle on nous vous ils elles moi toi lui eux elles me te se y en ne pas ' +
    'le la les un une des du de au aux et ou mais donc or ni que qui quoi dont ' +
    'dans par pour avec sans sous sur est sont es etait furent avoir ai as a ont ' +
    'ce cet cette ces cela ça il elle nous vous ' +
    'the a an and or but if then of to in on at by for with without from into ' +
    'is are was were be been being have has had do does did not no yes ' +
    'i you he she it we they my your his her its our their this that these those ' +
    'what which who whom as than so too very just can could will would should'
  ).split(/\s+/),
)

/** Tokens : mots ≥ 2 lettres, minuscules, lettres/chiffres (accents FR conservés), stopwords retirés. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9à-öø-ÿ]+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w))
}

/** Ligne d'index d'un fichier : la ligne contenant `](nom)` (titre + hook curé). */
export function indexLineFor(index: string, name: string): string {
  const needle = `](${name})`
  for (const line of index.split('\n')) if (line.includes(needle)) return line
  return ''
}

/**
 * Range les fichiers mémoire (hors index) par pertinence à `query`.
 * Score BM25-allégé : pour chaque terme de la requête présent dans le fichier,
 * `idf(terme) * (1 + ln(1 + tf))`, et la présence dans la LIGNE D'INDEX du
 * fichier est comptée double (le hook est écrit à la main = signal fort).
 * Tiebreak : nom (déterministe, pas de hasard entre ex æquo).
 *
 * `index` = le contenu de MEMORY.md (peut être '' — sans index, pas de boost).
 */
export function rankMemoryForInjection(
  query: string,
  files: MemoryFile[],
  index: string = '',
): RankedMemory[] {
  const qTerms = Array.from(new Set(tokenize(query)))
  const N = files.length

  // Par fichier : la ligne d'index (en Set de termes) + les fréquences du contenu.
  const perFile = files.map((f) => {
    const lineTerms = new Set(tokenize(indexLineFor(index, f.name)))
    const counts = new Map<string, number>()
    for (const w of tokenize(f.content)) counts.set(w, (counts.get(w) ?? 0) + 1)
    return { f, lineTerms, counts }
  })

  // df : nombre de fichiers contenant le terme (contenu OU ligne d'index).
  const df = new Map<string, number>()
  for (const { lineTerms, counts } of perFile) {
    for (const t of new Set([...lineTerms, ...counts.keys()])) {
      df.set(t, (df.get(t) ?? 0) + 1)
    }
  }
  const idf = (t: string) => Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5))

  return perFile
    .map(({ f, lineTerms, counts }) => {
      let score = 0
      for (const t of qTerms) {
        const c = counts.get(t) ?? 0
        if (c === 0 && !lineTerms.has(t)) continue
        const boost = lineTerms.has(t) ? 2 : 1
        score += idf(t) * (1 + Math.log(1 + c)) * boost
      }
      return { file: f, score }
    })
    .sort((a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name))
}

/**
 * Sélection bornée : les fichiers classés qui tiennent dans `budget` (mesuré en
 * chars, comme les seuils mémoire actuels). On prend dans l'ordre de pertinence ;
 * ce qui ne tient pas est écarté (l'app le signalera via la note memory_read).
 */
export function selectWithinBudget(
  ranked: RankedMemory[],
  budget: number,
): { selected: RankedMemory[]; omitted: RankedMemory[]; used: number } {
  const selected: RankedMemory[] = []
  const omitted: RankedMemory[] = []
  let used = 0
  for (const r of ranked) {
    if (used + r.file.content.length <= budget) {
      used += r.file.content.length
      selected.push(r)
    } else {
      omitted.push(r)
    }
  }
  return { selected, omitted, used }
}
