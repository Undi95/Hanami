// Préparation du texte pour la synthèse vocale : nettoyage (ce fichier) puis
// découpage en phrases, chaque segment étant synthétisé et joué indépendamment
// (voir `playTts` dans App.tsx) pour que le son démarre en quelques secondes
// au lieu d'attendre la synthèse de tout le message.

// ── Nettoyage avant synthèse ────────────────────────────────────────────────
// N'affecte JAMAIS le texte AFFICHÉ dans le chat — uniquement une copie
// préparée pour le TTS (appelé après `stripEmotionTags`, qui retire déjà les
// tags [happy] etc.).

// Didascalie/emote de roleplay entre astérisques : `*sourit*`, `**se
// penche**`… Le CONTENU ENTIER est retiré (pas seulement les astérisques) —
// Sakura ne doit pas la prononcer. Ancré sur UNE LIGNE (pas de \n dans le
// contenu) pour ne jamais avaler tout un paragraphe si un astérisque isolé
// traîne sans être refermé plus loin dans le texte.
const ACTION_RE = /\*{1,3}[^*\n]+?\*{1,3}/g

// \p{Extended_Pictographic} couvre l'immense majorité des émojis Unicode
// (un joncteur ZWJ ou un sélecteur de variation isolé, sans émoji autour,
// n'a de toute façon rien à prononcer — pas besoin de les traquer à part).
const EMOJI_RE = /\p{Extended_Pictographic}/gu

// Symboles markdown qui sonnent mal une fois lus tels quels par le TTS —
// tildes, underscores, backticks, et les astérisques RÉSIDUELS (isolés,
// jamais appariés par ACTION_RE : puce « * item », astérisque oublié…). Le
// mot qu'ils entourent, lui, reste : on retire le symbole, pas le contenu.
const NOISE_CHARS_RE = /[~_`*]/g

/**
 * Prépare `text` pour la synthèse vocale : retire les didascalies entre
 * astérisques, les émojis et les symboles markdown parasites — sans toucher à
 * la ponctuation utile (. , ! ? … ; :) qui sert au rythme et au découpage en
 * phrases (`splitIntoSpeechSegments`). Un texte qui n'était QUE de l'action
 * ou des symboles redevient une chaîne vide : à l'appelant de ne pas
 * synthétiser dans ce cas (voir `playTts`, qui s'arrête sur segments vides).
 */
export function cleanForSpeech(text: string): string {
  return text
    .replace(ACTION_RE, ' ')
    .replace(EMOJI_RE, '')
    .replace(NOISE_CHARS_RE, '')
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \t]+/g, ' ')
        .replace(/[ \t]+([,.!?;:…])/g, '$1')
        .trim(),
    )
    .join('\n')
    .trim()
}

// ── Découpage en phrases ────────────────────────────────────────────────────

// Abréviations courantes (FR + EN) suivies d'un point qui ne termine PAS une
// phrase : « M. Dupont », « etc. » — liste volontairement courte, le pire cas
// d'un oubli est une coupure de phrase un peu tôt, pas une erreur bloquante.
const ABBREVIATIONS = new Set([
  'm', 'mme', 'mlle', 'dr', 'pr', 'prof', 'st', 'jr', 'sr', 'vs', 'etc', 'cf',
  'ex', 'no', 'p', 'ch', 'art', 'fig', 'ie', 'eg', 'mr', 'mrs', 'ms',
])

// Un point/!/?/… suivi d'une espace (ou de la fin du texte) termine une phrase ;
// un ou plusieurs sauts de ligne aussi (silence naturel entre deux répliques).
const BOUNDARY = /[.!?…]+(?=\s|$)|\n+/g

// En dessous de cette longueur, un segment est fusionné avec le suivant plutôt
// que synthétisé seul — évite une rafale d'appels TTS sur « Oui. » « Non. »
// « Ah ? » qui gaspillerait plus de temps en aller-retours réseau qu'elle n'en
// ferait gagner sur le démarrage du son.
const MIN_SEGMENT_LEN = 12

/**
 * Découpe `text` en phrases prêtes à synthétiser séquentiellement. Une seule
 * phrase → un seul segment (comportement ~identique à un appel TTS unique).
 * Texte vide ou blanc → tableau vide.
 */
export function splitIntoSpeechSegments(text: string, minLen = MIN_SEGMENT_LEN): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const raw: string[] = []
  let start = 0
  BOUNDARY.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = BOUNDARY.exec(normalized))) {
    const end = match.index + match[0].length
    const candidate = normalized.slice(start, end).trim()
    if (!candidate) {
      start = end
      continue
    }
    // Point isolé précédé d'une abréviation connue : pas une fin de phrase,
    // on laisse la recherche continuer jusqu'au prochain délimiteur.
    if (match[0] === '.') {
      const before = /([A-Za-zÀ-ÿ]{1,5})\.$/.exec(candidate)
      if (before && ABBREVIATIONS.has(before[1].toLowerCase())) continue
    }
    raw.push(candidate)
    start = end
  }
  const tail = normalized.slice(start).trim()
  if (tail) raw.push(tail)

  // Fusion des segments trop courts avec celui qui suit.
  const merged: string[] = []
  for (const part of raw) {
    const last = merged[merged.length - 1]
    if (last !== undefined && last.length < minLen) merged[merged.length - 1] = `${last} ${part}`
    else merged.push(part)
  }
  return merged
}
