// Outil web_search exposé au modèle — trois moteurs au choix (settings.webSearchEngine) :
// DuckDuckGo (endpoint HTML, sans clé, par défaut), SearXNG (settings.webSearchUrl) ou
// Tavily (settings.tavilyApiKey). Aucune dépendance : fetch natif + un petit parseur
// regex pour le HTML de DuckDuckGo (les deux autres répondent déjà en JSON).
import type { Settings } from '../../shared/types'

export const WEB_SEARCH_TOOL_NAMES = ['web_search'] as const

export const webSearchToolDefs: unknown[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the Web using the configured search engine and return the top results ' +
        '(title, URL, snippet). Use it for any recent, precise or verifiable information you do not know. ' +
        'When the user explicitly asks you to search, look up, or google something, you MUST call this ' +
        'tool — never pretend to search, never role-play doing a search, never invent results. Only ' +
        'report what this tool actually returns.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search terms' },
          count: { type: 'number', description: 'Desired number of results (default 3, max 5)' },
        },
        required: ['query'],
      },
    },
  },
]

// Filet indépendant du modèle : une intention de recherche EXPLICITE dans le
// message force une vraie recherche (chat.ts), exactement comme /search — un
// modèle qui préfère « jouer » la recherche en roleplay plutôt que d'appeler
// l'outil ne peut plus la contourner. Volontairement strict (verbe d'action +
// contexte web explicite) : une simple mention ne doit PAS déclencher.
const SEARCH_INTENT_PATTERNS: RegExp[] = [
  // FR : « cherche/recherche ... sur le web/internet/net »
  /\b(?:cherch\w*|recherch\w*)\b[^.!?]{0,40}?\bsur\s+(?:le\s+)?(?:web|internet|net)\b/i,
  // FR : « fais(-moi) une recherche (sur le web/internet…) »
  /\bfais(?:ons|-moi)?\s+une\s+recherche\b(?:[^.!?]{0,40}?\bsur\s+(?:le\s+)?(?:web|internet|net)\b)?/i,
  // EN : « search the web/internet/online (for) »
  /\bsearch\w*\b[^.!?]{0,40}?\b(?:the\s+web|the\s+internet|online)\b(?:\s+for)?/i,
  // EN : « (can/could/would) you search (for) » — sans « the web » explicite,
  // le préfixe de requête directe suffit à lever l'ambiguïté (cf. le même
  // traitement pour « google » ci-dessous).
  /\b(?:can|could|would)\s+you\s+search\b(?:[^.!?]{0,40}?\bfor\b)?/i,
  // EN : « look ... up » (look up X, look that up)
  /\blook\w*\s+(?:\w+\s+)?up\b/i,
  // FR/EN : « google » à l'impératif seulement (google-moi/le/la/ça/it/that/the,
  // ou « (can/could) you google ») — jamais sur une simple mention de la marque
  // (« j'ai un compte Google »).
  /\bgoogle[sz]?[- ]?(?:moi|le|la|ça|ca|it|that|this|the)\b/i,
  /\b(?:can|could|would)\s+you\s+google\b|\bpeux(?:-tu|-vous)?\s+google\b/i,
]

/**
 * Détecte une intention de recherche EXPLICITE dans un message utilisateur et
 * en extrait une requête exploitable (la formule déclencheuse retirée, le
 * reste du message gardé tel quel). `null` si aucune intention claire.
 */
export function detectSearchIntent(content: string): string | null {
  for (const re of SEARCH_INTENT_PATTERNS) {
    const m = re.exec(content)
    if (!m) continue
    const query = (content.slice(0, m.index) + ' ' + content.slice(m.index + m[0].length))
      .replace(/^[\s:,.\-–—]+|[\s:,.\-–—]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
    return query || content.trim()
  }
  return null
}

const DEFAULT_COUNT = 3
const MAX_COUNT = 5
const TIMEOUT_MS = 8000
const TITLE_MAX = 200
const SNIPPET_MAX = 300

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

interface SearchResult {
  title: string
  url: string
  snippet: string
}

function trimTo(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&#x27;|&nbsp;/g, (m) => ENTITIES[m] ?? m)
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '')
}

function cleanText(s: string): string {
  return decodeEntities(stripTags(s)).replace(/\s+/g, ' ').trim()
}

/** Résout le lien de redirection DuckDuckGo (//duckduckgo.com/l/?uddg=<url réelle>&…) vers l'URL réelle. */
function resolveDdgUrl(href: string): string {
  try {
    const url = new URL(href.startsWith('//') ? 'https:' + href : href)
    const uddg = url.searchParams.get('uddg')
    return uddg ? decodeURIComponent(uddg) : url.toString()
  } catch {
    return href
  }
}

// Titres et extraits sont émis dans le même ordre par DuckDuckGo : on les
// apparie par indice plutôt que de sur-spécifier un bloc de résultat entier
// (le balisage exact autour d'un résultat varie, ces deux ancres, non).
const TITLE_RE = /<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>/g
const SNIPPET_RE = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

function parseDdgHtml(html: string): SearchResult[] {
  const titles: { href: string; title: string }[] = []
  for (const m of html.matchAll(TITLE_RE)) titles.push({ href: m[1], title: m[2] })
  const snippets: string[] = []
  for (const m of html.matchAll(SNIPPET_RE)) snippets.push(m[1])

  const out: SearchResult[] = []
  const n = Math.min(titles.length, snippets.length)
  for (let i = 0; i < n; i++) {
    const title = trimTo(cleanText(titles[i].title), TITLE_MAX)
    const url = resolveDdgUrl(titles[i].href)
    const snippet = trimTo(cleanText(snippets[i]), SNIPPET_MAX)
    if (!title || !url) continue
    out.push({ title, url, snippet })
  }
  return out
}

async function fetchDdg(query: string, count: number, signal: AbortSignal): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    signal,
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8' },
  })
  if (!res.ok) throw new Error(`Recherche DuckDuckGo : HTTP ${res.status}`)
  return parseDdgHtml(await res.text()).slice(0, count)
}

interface SearxngResult {
  title?: unknown
  url?: unknown
  content?: unknown
}

async function fetchSearxng(baseUrl: string, query: string, count: number, signal: AbortSignal): Promise<SearchResult[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/search?q=${encodeURIComponent(query)}&format=json`
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Recherche SearXNG : HTTP ${res.status}`)
  const data = (await res.json()) as { results?: SearxngResult[] }
  const results = Array.isArray(data.results) ? data.results : []
  return results.slice(0, count).map((r) => ({
    title: trimTo(String(r.title ?? '').trim(), TITLE_MAX),
    url: String(r.url ?? '').trim(),
    snippet: trimTo(String(r.content ?? '').trim(), SNIPPET_MAX),
  }))
}

interface TavilyResult {
  title?: unknown
  url?: unknown
  content?: unknown
}

async function fetchTavily(apiKey: string, query: string, count: number, signal: AbortSignal): Promise<SearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: count }),
  })
  if (!res.ok) throw new Error(`Recherche Tavily : HTTP ${res.status}`)
  const data = (await res.json()) as { results?: TavilyResult[] }
  const results = Array.isArray(data.results) ? data.results : []
  return results.slice(0, count).map((r) => ({
    title: trimTo(String(r.title ?? '').trim(), TITLE_MAX),
    url: String(r.url ?? '').trim(),
    snippet: trimTo(String(r.content ?? '').trim(), SNIPPET_MAX),
  }))
}

// Garde-fou : un échec ou une recherche vide reste un résultat d'outil NORMAL
// (jamais un throw) avec une consigne directive — sans ça, un modèle « thinking »
// (observé avec Qwen A3B) rumine la marche à suivre et peut cramer tout son
// maxTokens dessus au lieu de répondre.
const NO_RESULTS_GUARD = 'Answer from your own knowledge, or briefly tell the user the search failed. Do not retry.'

/** Exécute web_search ; renvoie toujours un texte pour le modèle (jamais de throw ni de crash sur un échec réseau). */
export async function executeWebSearchTool(settings: Settings, args: Record<string, unknown>): Promise<string> {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) throw new Error('query is required')
  const rawCount = Number(args.count)
  const count = Number.isFinite(rawCount) && rawCount > 0 ? Math.min(Math.floor(rawCount), MAX_COUNT) : DEFAULT_COUNT

  let results: SearchResult[]
  try {
    if (settings.webSearchEngine === 'tavily') {
      const apiKey = settings.tavilyApiKey.trim()
      if (!apiKey) return `Tavily API key is not configured. ${NO_RESULTS_GUARD}`
      results = await fetchTavily(apiKey, query, count, AbortSignal.timeout(TIMEOUT_MS))
    } else if (settings.webSearchEngine === 'searxng') {
      const searxngUrl = settings.webSearchUrl.trim()
      if (!searxngUrl) return `SearXNG URL is not configured. ${NO_RESULTS_GUARD}`
      try {
        results = await fetchSearxng(searxngUrl, query, count, AbortSignal.timeout(TIMEOUT_MS))
      } catch (e) {
        // SearXNG injoignable (Docker arrêté, réseau, timeout, statut ou JSON invalide) :
        // on retombe sur DuckDuckGo pour cette requête plutôt que d'échouer — Tavily n'a
        // pas ce filet, c'est un choix explicite de l'utilisateur donc on le respecte tel quel.
        const reason = e instanceof Error && e.name === 'TimeoutError' ? 'timed out' : e instanceof Error ? e.message : String(e)
        console.warn(`[web_search] SearXNG unreachable (${reason}), falling back to DuckDuckGo`)
        results = await fetchDdg(query, count, AbortSignal.timeout(TIMEOUT_MS))
      }
    } else {
      results = await fetchDdg(query, count, AbortSignal.timeout(TIMEOUT_MS))
    }
  } catch (e) {
    const reason = e instanceof Error && e.name === 'TimeoutError' ? 'timed out' : e instanceof Error ? e.message : String(e)
    return `Web search failed (${reason}). ${NO_RESULTS_GUARD}`
  }
  if (results.length === 0) return `No web results found for "${query}". ${NO_RESULTS_GUARD}`
  return results.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n')
}
