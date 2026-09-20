// ── Compression de contexte : encodeur densifiant + vérifieur de faits ────────
// Porté dans l'app (chantier B) depuis research/codec.ts + research/verifier.ts
// (branche research/context-compression, mesuré tours 1-8 — voir RECHERCHE.md).
// Les deux sont DÉTERMINISTES, zéro LLM, zéro dépendance : importés par le
// serveur (server/api/chat.ts, server/api/memory.ts) et réutilisés par la mesure.
//
// Stratégie par TYPE (le résultat de la recherche) :
//   - sysprompt du perso + persona user → denseEncode SEUL (sûr, ne casse jamais —
//     le codec agressif fait boucler VIDE les prompts complexes, HYP. 2).
//   - mémoire (faits) → codec agressif (LLM) PUIS verifyFacts ici comme filet de
//     sûreté : un fait dur manquant → rejet → repli denseEncode.
//
// denseEncode (ex research/codec.ts) — densifieur CONSERVATIF :
//   1. NE JAMAIS toucher les MOTS-CONTENU (entités, nombres, dates, relations) —
//      c'est EXACTEMENT ce qui se perd à la compression (EMNLP 2025, arXiv 2505.00019).
//   2. Compresser le COLLAGE DE PROSE : possessifs de début de ligne, copules
//      (est/c'est/sont), « s'appelle », articles, nombres en lettres, « et ».
//   3. Taux VARIABLE : le fait-titre reste explicite, seul le remplissage va (un
//      fait rendu purement implicite fait silenter le modèle — règle v2).
//   4. DÉTERMINISTE + sans LLM : zéro « knowledge overwriting » (Size-Fidelity
//      Paradox, arXiv 2602.09789) — on ne fabrique JAMAIS de fait.
//   Garde-fou d'ENTITÉ : on ne retire un article QUE s'il ne précède pas un nom
//   propre (majuscule) — sinon « rue des Lilas » → « rue Lilas ».

export function denseEncode(text: string): string {
  const MONTHS: Record<string, string> = {
    janvier: '01', 'février': '02', fevrier: '02', mars: '03', avril: '04', mai: '05',
    juin: '06', juillet: '07', 'août': '08', aout: '08', septembre: '09',
    octobre: '10', novembre: '11', 'décembre': '12', decembre: '12',
  }
  // Nombres en lettres → chiffres. « un » EXCLU : trop ambigu avec l'article.
  const COUNTS: Array<[RegExp, string]> = [
    [/\bdeux\b/gi, '2'], [/\btrois\b/gi, '3'], [/\bquatre\b/gi, '4'],
    [/\bcinq\b/gi, '5'], [/\bsix\b/gi, '6'], [/\bsept\b/gi, '7'],
    [/\bhuit\b/gi, '8'], [/\bneuf\b/gi, '9'], [/\bdix\b/gi, '10'],
  ]
  // Majuscule (y compris accentuées) = probable nom propre.
  const isCap = (c: string) => /[A-ZÀ-ÖØ-Þ]/.test(c)
  // Quantifiants / indéfinis qui SUIVENT « un/une » sans en être un article :
  // retirer l'article retourne le sens (« un peu » → « peu » = « pas du tout »).
  const PROTECTED = new Set([
    'peu', 'fois', 'certain', 'certaine', 'instant', 'moment', 'rien',
    'brin', 'nuage', 'souffle', 'chouya', 'trait',
  ])

  return text
    .split('\n')
    .map((raw) => {
      let s = raw.trim()
      if (s === '') return ''
      // 1) Dates : « 12 juin » → « 12/06 » (le jour ET le mois restent → fait-titre intact)
      s = s.replace(
        /\b(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\b/gi,
        (_m, d, mo) => `${d}/${MONTHS[mo.toLowerCase()]}`,
      )
      // 2) Nombres en lettres → chiffres
      for (const [re, dig] of COUNTS) s = s.replace(re, dig)
      // 3) Possessif de début de ligne : « Mon chat » → « chat »
      s = s.replace(/^\s*(?:mon|ma|mes|son|sa|ses|ton|ta|tes|notre|votre)\s+/i, '')
      // 4) « s'appelle » → « : » (clé : valeur) — apostrophes droites ET typographiques.
      s = s.replace(/\s+s[’']appelle\s+/gi, ': ')
      // 5) Copules : « c'est (un/une/des) » puis « c'est » / « est » / « sont » → retirés.
      //    Bornes Unicode (?<!\p{L}) — sinon un « est »/« sont » collé à un accent
      //    ou à « l' » serait arraché. Apostrophes droites ET typographiques (’).
      //    « une » AVANT « un » : sinon « C'est une » → « e » (l'alternance prend « un »).
      s = s.replace(/\bc[’']est (?:une|un|des)\s*/gi, ' ')
      s = s.replace(/(?<![\p{L}\p{N}])c[’']est(?![\p{L}\p{N}])/giu, ' ')
      s = s.replace(/(?<![\p{L}\p{N}])(?:est|sont)(?![\p{L}\p{N}])/giu, ' ')
      // 6) Articles : retirés SANS toucher à ceux qui précèdent un nom propre ou un
      //    chiffre (« Les 52 »), ni après un trait d'union (« enregistre-le »), ni devant
      //    un quantifiant (« un peu », « une fois » — retirer l'article retourne le sens).
      //    Bornes Unicode (\p{L}) — C'EST LE FIX CRITIQUE : sans ça, JS voit « â »
      //    comme NON-lettre et arrache le « le » final de « mâle » → « mâ ».
      s = s.replace(
        /(?<![\p{L}\p{N}-])(le|la|les|un|une|des)(?![\p{L}\p{N}])\s+/giu,
        (m, _art, off, str) => {
          const nxt = str[off + m.length] ?? ''
          if (isCap(nxt) || /\d/.test(nxt)) return m // nom propre (« rue des Lilas ») ou chiffre
          const w = (str.slice(off + m.length).match(/^\p{L}+/u) || [''])[0].toLowerCase()
          if (w && PROTECTED.has(w)) return m // « un peu », « une fois » … (quantifiants)
          return ' '
        },
      )
      // 7) « et » → « , » (listes)
      s = s.replace(/\s+et\s+/gi, ', ')
      // 8) Hygiène : espaces multiples, ponctuation
      s = s.replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ',').replace(/\s+([.,:;])/g, '$1')
      return s.replace(/^[\s,:]+/, '').trim()
    })
    .filter((l) => l !== '')
    .join('\n')
}

// ── Vérifieur DÉTERMINISTE de faits (ex research/verifier.ts) ─────────────────
// Filet de sûreté du codec agressif : un LLM densifie la mémoire, PUIS ce
// vérifieur (reproductible, zéro coût) contrôle que TOUT fait « dur » du texte
// ORIGINAL est ENCORE PRÉSENT dans la forme compressée. Un fait manquant → rejet
// → repli denseEncode (ou texte original). Zéro LLM : un vérifieur-LLM
// réinjecterait le même risque qu'il protège (Size-Fidelity Paradox).
//
// « Fait dur » = les NOMBRES (1-4 chiffres, la valeur exacte, « 8 » ≠ « 18 »)
// + les NOMS PROPRES (majuscule, ≥ 2 lettres, insensible aux accents/casse).
// Asymétrie volontaire : préfère le FAUX-ROUGE (rejeter une compression fidèle →
// repli denseEncode) au FAUX-VERT (laisser passer une perte silencieuse).

export interface FactSet {
  numbers: string[]
  entities: string[]
}
export interface Verdict {
  ok: boolean
  missingNumbers: string[]
  missingEntities: string[]
}

// Accents normalisés (NFD) + diacritiques retirés — « â » ≈ « a ».
const stripAccents = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '')

// Mots fonctionnels FR qui ouvrent une phrase en majuscule mais ne sont PAS des
// entités (possessifs/pronoms que denseEncode retire légitimement) → faux-rouges.
const STOP = new Set([
  'mon', 'ma', 'mes', 'son', 'sa', 'ses', 'ton', 'ta', 'tes', 'notre', 'votre',
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles',
  'ce', 'cette', 'cet', 'ces', 'le', 'la', 'les', 'un', 'une', 'des',
])

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
