// Parseur de character card SillyTavern : embarquée dans un PNG (chunks tEXt),
// ou nue dans un fichier .json — les deux formes circulent, et une card exportée
// sans image n'est qu'un JSON.
// PUR : Buffer en entrée, objet en sortie — aucun accès fs, aucune dépendance.

export interface ParsedCard {
  name: string
  description: string
  personality: string
  scenario: string
  firstMes: string
  alternateGreetings: string[] // V2/V3 : data.alternate_greetings (vide en V1)
  systemPrompt: string
  // Dialogue d'exemple (V1 comme V2) : les répliques modèles de la card,
  // séparées par des <START>. C'est là que vit la VOIX du personnage — le ton,
  // les tics, la longueur des réponses.
  mesExample: string
  // Consignes que SillyTavern place APRÈS l'historique (le « jailbreak » des
  // cards) : la règle qui doit peser le plus lourd au moment de répondre.
  postHistoryInstructions: string
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Extrait la card d'un PNG : itère les chunks, lit les tEXt "ccv3" (prioritaire)
 * ou "chara", décode base64 → JSON, normalise V1/V2/V3 en ParsedCard.
 * Retourne null si le buffer n'est pas un PNG ou ne contient pas de card valide.
 */
export function parseCharacterCard(buf: Buffer): ParsedCard | null {
  if (buf.length < PNG_SIGNATURE.length || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null

  let chara: string | null = null
  let ccv3: string | null = null
  let offset = 8
  // Chunk PNG : length u32BE (4) + type (4) + data (length) + crc (4).
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('latin1', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buf.length) break // chunk tronqué

    if (type === 'tEXt') {
      const data = buf.subarray(dataStart, dataEnd)
      const nul = data.indexOf(0)
      if (nul !== -1) {
        const keyword = data.toString('latin1', 0, nul)
        const text = data.toString('latin1', nul + 1)
        if (keyword === 'ccv3') ccv3 = text
        else if (keyword === 'chara') chara = text
      }
    }
    if (type === 'IEND') break
    offset = dataEnd + 4
  }

  const payload = ccv3 ?? chara
  if (!payload) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
  } catch {
    return null
  }
  return normalizeCard(parsed)
}

/**
 * Card d'un fichier .json (V1 à plat, V2/V3 avec `data`) — même normalisation
 * que celle du PNG, à ceci près qu'il n'y a pas d'image à en tirer.
 * Retourne null si le buffer n'est pas du JSON, ou pas une card.
 */
export function parseCardJson(buf: Buffer): ParsedCard | null {
  let parsed: unknown
  try {
    // BOM retiré : un .json écrit par un éditeur Windows en porte souvent un,
    // et JSON.parse le refuse.
    parsed = JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
  return normalizeCard(parsed)
}

function normalizeCard(raw: unknown): ParsedCard | null {
  if (!raw || typeof raw !== 'object') return null
  const top = raw as Record<string, unknown>
  // V2/V3 : { spec, data: {...} } — V1 : champs à plat.
  const src =
    top.data && typeof top.data === 'object' ? (top.data as Record<string, unknown>) : top
  const card: ParsedCard = {
    name: str(src.name),
    description: str(src.description),
    personality: str(src.personality),
    scenario: str(src.scenario),
    firstMes: str(src.first_mes),
    alternateGreetings: strArray(src.alternate_greetings),
    systemPrompt: str(src.system_prompt),
    mesExample: str(src.mes_example),
    postHistoryInstructions: str(src.post_history_instructions),
  }
  if (!card.name && !card.description && !card.firstMes) return null
  return card
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Liste de chaînes d'une card (entrées non textuelles ou vides ignorées). */
function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
}
