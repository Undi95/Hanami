// ── codec : encodeur densifiant DÉTERMINISTE (zéro LLM, zéro dépendance) ─────
// L'artefact « reprennable » de la recherche compression de contexte
// (branche research/context-compression). Fichier autonome, importable, sans
// dépendance — c'est le candidat open source.
//
// Philosophie (issue du prior art + des mesures v1/v2 — voir research/RECHERCHE.md) :
//
//   1. NE JAMAIS toucher les MOTS-CONTENU (entités nommées, nombres, dates,
//      relations). Le prior art (EMNLP 2025 Amazon, arXiv 2505.00019) montre que
//      ce sont EXACTEMENT les faits qui se perdent à la compression : dates,
//      cardinaux, entités, relations fines. On les protège tels quels.
//
//   2. Compresser seulement le COLLAGE DE PROSE : possessifs de début de ligne,
//      copules (est/c'est), « s'appelle », articles, nombres en lettres, « et ».
//      C'est là que vit la redondance que le tokenizer ne capte pas.
//
//   3. Taux VARIABLE par construction : le fait-titre reste EXPLICITE, seul le
//      remplissage va. C'est la règle de sécurité établie par la mesure v2 —
//      un fait rendu purement IMPLICITE fait silenter le modèle
//      (finish_reason=length, contenu vide), pas une erreur.
//
//   4. DÉTERMINISTE + sans LLM : reproductible, zéro coût d'appel, et zéro
//      « knowledge overwriting » — le piège du Size-Fidelity Paradox (arXiv
//      2602.09789) où un compresseur-LLM remplace les faits source par SES
//      aprioris paramétriques. On ne fabrique JAMAIS de fait.
//
//   5. Cohérent avec « subsequence recovery » (LongLLMLingua) : on ne retient
//      que le bruit de prose AROUND les faits ; on ne réécrit pas le contenu.
//
// Garde-fou d'ENTITÉ (le point crucial de la sûreté) : on ne retire un article
// (le/la/les/un/une/des) QUE s'il ne précède pas un nom propre (majuscule).
// Sinon « rue des Lilas » → « rue Lilas » (corruption d'entité) ou « le docteur
// Marchand » → « docteur Marchand » perdrait sa marque. Le test de la majuscule
// qui suit est le discriminateur.
//
// LIMITE HONNÊTE : c'est un densifieur CONSERVATEUR. Il ne supprime PAS les
// clauses redondantes (« depuis l'année dernière », « qui a », « et je la vois
// surtout ») car les supprimer bascule dans le sémantique (risqué, c'est le
// travail du télégraphique ÉCRIT À LA MAIN v1). Le gain « gratuit » par règles
// sûres seules est donc borné en dessous de v1. La mesure (scripts/dense-encode.ts)
// chiffre cet écart exactement.
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
      // 4) « s'appelle » → « : » (clé : valeur)
      s = s.replace(/\s+s'appelle\s+/gi, ': ')
      // 5) Copules : « c'est (un/une/des) » puis « c'est » / « est » / « sont » → retirés.
      //    Bornes Unicode (?<!\p{L}) — sinon un « est »/« sont » collé à un accent
      //    ou à « l' » serait arraché.
      s = s.replace(/\bc'est (?:un|une|des)\s*/gi, ' ')
      s = s.replace(/(?<![\p{L}\p{N}])c'est(?![\p{L}\p{N}])/giu, ' ')
      s = s.replace(/(?<![\p{L}\p{N}])(?:est|sont)(?![\p{L}\p{N}])/giu, ' ')
      // 6) Articles : retirés SANS toucher à ceux qui précèdent un nom propre.
      //    Bornes Unicode (\p{L}) — C'EST LE FIX CRITIQUE : sans ça, JS voit « â »
      //    comme NON-lettre et arrache le « le » final de « mâle » → « mâ ».
      //    (?<![\p{L}\p{N}]) = le char précédent n'est pas une lettre/chiffre.
      s = s.replace(
        /(?<![\p{L}\p{N}])(le|la|les|un|une|des)(?![\p{L}\p{N}])\s+/giu,
        (m, _art, off, str) => (isCap(str[off + m.length] ?? '') ? m : ' '),
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
