// Export d'un personnage en character card SillyTavern V2 : le JSON de la card,
// et son incrustation dans un PNG (chunk tEXt « chara », comme à l'import).
// PUR : objets et Buffers en entrée, Buffer en sortie — aucun accès fs.
import type { CharacterFull } from '../../shared/types'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Card V2 d'un personnage Hanami.
 *
 * Hanami ne garde qu'UN prompt système, pas les six champs d'une card : il part
 * donc dans `description`, le champ que TOUS les outils lisent (`system_prompt`
 * est un champ de surcharge, souvent ignoré, et laisserait la card vide à
 * l'écran de qui la relit ailleurs). Les autres restent vides plutôt que
 * d'inventer un découpage que personne n'a écrit.
 *
 * Les champs V1 sont DUPLIQUÉS à la racine, à côté de `data` : c'est la
 * pratique des cards V2 dans la nature, et c'est ce qui les rend lisibles par
 * les outils restés en V1.
 */
export function buildCardV2(character: CharacterFull): unknown {
  const greetings = Array.isArray(character.greetings) ? character.greetings.filter((g) => g.trim()) : []
  const v1 = {
    name: character.name,
    description: character.systemPrompt,
    personality: '',
    scenario: '',
    first_mes: character.greeting,
    mes_example: '',
  }
  return {
    ...v1,
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      ...v1,
      creator_notes: 'Exporté depuis Hanami.',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: greetings,
      tags: [],
      creator: '',
      character_version: '',
      extensions: {},
    },
  }
}

// ── Écriture PNG ───────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

/** CRC-32 du PNG (polynôme standard) — chaque chunk porte le sien. */
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Chunk PNG complet : longueur (u32BE) + type + données + CRC. */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/**
 * Réécrit un PNG avec la card dedans : les chunks d'image sont recopiés tels
 * quels, les tEXt « chara » et « ccv3 » DÉJÀ PRÉSENTS sont retirés (le portrait
 * d'un personnage importé EST une card — sans ce ménage, on exporterait
 * l'ancienne au lieu de la nouvelle), et le nôtre est posé juste avant IEND.
 *
 * Retourne null si le buffer n'est pas un PNG lisible : à l'appelant de se
 * rabattre sur le .json.
 */
export function embedCardInPng(png: Buffer, cardJson: string): Buffer | null {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  const out: Buffer[] = [PNG_SIGNATURE]
  const text = Buffer.concat([
    Buffer.from('chara\0', 'latin1'),
    // base64 : de l'ASCII, donc du latin1 valide — un tEXt ne peut pas porter
    // d'UTF-8 (c'est iTXt qui le ferait, et personne ne le lit pour les cards).
    Buffer.from(Buffer.from(cardJson, 'utf8').toString('base64'), 'latin1'),
  ])
  let offset = 8
  let wrote = false
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('latin1', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > png.length) return null // chunk tronqué : PNG illisible
    if (type === 'IEND') {
      out.push(chunk('tEXt', text))
      wrote = true
      out.push(png.subarray(offset, dataEnd + 4))
      break
    }
    let skip = false
    if (type === 'tEXt') {
      const data = png.subarray(dataStart, dataEnd)
      const nul = data.indexOf(0)
      if (nul !== -1) {
        const keyword = data.toString('latin1', 0, nul)
        skip = keyword === 'chara' || keyword === 'ccv3'
      }
    }
    if (!skip) out.push(png.subarray(offset, dataEnd + 4))
    offset = dataEnd + 4
  }
  if (!wrote) return null // pas d'IEND : ce n'est pas un PNG entier
  return Buffer.concat(out)
}

/**
 * Nom de fichier sûr, toutes plateformes (les caractères interdits par Windows,
 * le plus strict, deviennent des tirets) — le nom part dans un en-tête
 * Content-Disposition, il ne doit contenir ni guillemet ni séparateur.
 */
/**
 * En-tête Content-Disposition pour un nom de fichier qui peut porter des
 * accents : un en-tête HTTP est du latin1, un « Été.png » brut ferait échouer
 * l'envoi. On donne donc les deux formes — le repli ASCII pour les naïfs, et le
 * `filename*` en UTF-8 percent-encodé (RFC 5987) que tous les navigateurs
 * préfèrent.
 */
export function cardDisposition(base: string, ext: string): string {
  const ascii = base.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')
  return `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encodeURIComponent(base + '.' + ext)}`
}

export function safeCardFileName(name: string): string {
  const clean = name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '')
  return clean || 'personnage'
}
