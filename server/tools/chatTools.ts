// Outil chat_search : le modèle peut fouiller TOUTES les anciennes conversations
// du personnage (transcripts .jsonl complets), pas seulement sa mémoire distillée.
// « Tu te souviens du pique-nique ? » → il retrouve le passage exact, avec sa date.
import { listChats, readChat } from '../lib/storage'

export const CHAT_TOOL_NAMES = ['chat_search'] as const

export const chatToolDefs = [
  {
    type: 'function',
    function: {
      name: 'chat_search',
      description:
        'Search across ALL past conversations with this user (full transcripts, not just your memory). ' +
        'Use it when asked about a past event, promise or detail that is not in your memory block. ' +
        'Returns matching excerpts with their conversation title, date and speaker.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Words to look for (case-insensitive; all words must appear in the message).',
          },
        },
        required: ['query'],
      },
    },
  },
]

const MAX_RESULTS = 8
const EXCERPT_CHARS = 240
const MAX_OUTPUT_CHARS = 4000

export function executeChatTool(
  characterId: string,
  name: string,
  args: Record<string, unknown>,
): string {
  if (name !== 'chat_search') throw new Error(`Outil inconnu : ${name}`)
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) throw new Error('query est requis')
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)

  const results: string[] = []
  // listChats trie du plus récent au plus ancien — les souvenirs frais d'abord.
  for (const meta of listChats(characterId)) {
    if (results.length >= MAX_RESULTS) break
    let messages
    try {
      messages = readChat(characterId, meta.id).messages
    } catch {
      continue // chat illisible : ignoré
    }
    for (const m of messages) {
      if (results.length >= MAX_RESULTS) break
      const lower = m.content.toLowerCase()
      if (!tokens.every((t) => lower.includes(t))) continue
      const date = (m.ts || meta.createdAt).slice(0, 10)
      const excerpt =
        m.content.length > EXCERPT_CHARS ? m.content.slice(0, EXCERPT_CHARS - 1) + '…' : m.content
      results.push(`[${meta.title} — ${date}] ${m.role}: ${excerpt}`)
    }
  }

  if (results.length === 0) return `No match for "${query}" in past conversations.`
  let out = results.join('\n\n')
  if (out.length > MAX_OUTPUT_CHARS) out = out.slice(0, MAX_OUTPUT_CHARS) + '…'
  return `${results.length} match(es) for "${query}":\n\n${out}`
}
