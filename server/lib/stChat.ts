// Convertisseur de chats SillyTavern (.jsonl) vers ChatMessage[].
// PUR : string en entrée, messages en sortie — aucun accès fs.
import type { ChatMessage } from '../../shared/types'

/**
 * Convertit un export JSONL SillyTavern en messages Hanami.
 * - Ignore les lignes vides et non-JSON.
 * - Ignore la ligne d'en-tête (chat_metadata, ou user_name/character_name sans mes).
 * - Ignore les messages is_system.
 * - Les swipes sont ignorés : `mes` est déjà la version choisie.
 */
export function convertStChat(jsonl: string): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const raw of jsonl.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    let obj: unknown
    try {
      obj = JSON.parse(line)
    } catch {
      continue // ligne non-JSON tolérée
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue
    const entry = obj as Record<string, unknown>

    // Ligne d'en-tête de l'export.
    if ('chat_metadata' in entry) continue
    if (!('mes' in entry) && ('user_name' in entry || 'character_name' in entry)) continue

    if (entry.is_system === true) continue
    if (typeof entry.mes !== 'string') continue

    out.push({
      role: entry.is_user ? 'user' : 'assistant',
      content: entry.mes,
      ts: toIso(entry.send_date),
    })
  }
  return out
}

/** send_date → ISO : accepte ISO string, timestamp ms, ou date-string parsable. */
function toIso(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return new Date().toISOString()
}
