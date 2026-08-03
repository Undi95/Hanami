// Outil web_search exposé au modèle — DuckDuckGo (endpoint HTML, sans clé) par défaut,
// ou une instance SearXNG (settings.webSearchUrl) si l'utilisateur en a renseigné une.
// Aucune dépendance : fetch natif + un petit parseur regex du HTML de DuckDuckGo.
import type { Settings } from '../../shared/types'

export const WEB_SEARCH_TOOL_NAMES = ['web_search'] as const

export const webSearchToolDefs: unknown[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Cherche sur le Web (DuckDuckGo, ou une instance SearXNG si configurée) et renvoie les meilleurs résultats ' +
        '(titre, URL, extrait). À utiliser pour toute information récente, précise ou vérifiable que tu ne connais pas.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Termes de recherche' },
          count: { type: 'number', description: 'Nombre de résultats souhaités (défaut 3, max 5)' },
        },
        required: ['query'],
      },
    },
  },
]

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
  if (!res.ok) throw new Error(`DuckDuckGo a répondu HTTP ${res.status}`)
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
  if (!res.ok) throw new Error(`SearXNG a répondu HTTP ${res.status}`)
  const data = (await res.json()) as { results?: SearxngResult[] }
  const results = Array.isArray(data.results) ? data.results : []
  return results.slice(0, count).map((r) => ({
    title: trimTo(String(r.title ?? '').trim(), TITLE_MAX),
    url: String(r.url ?? '').trim(),
    snippet: trimTo(String(r.content ?? '').trim(), SNIPPET_MAX),
  }))
}

/** Exécute web_search ; renvoie un texte court pour le modèle. Erreurs → throw (jamais de crash). */
export async function executeWebSearchTool(settings: Settings, args: Record<string, unknown>): Promise<string> {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) throw new Error('query est requis')
  const rawCount = Number(args.count)
  const count = Number.isFinite(rawCount) && rawCount > 0 ? Math.min(Math.floor(rawCount), MAX_COUNT) : DEFAULT_COUNT

  const searxngUrl = settings.webSearchUrl.trim()
  let results: SearchResult[]
  try {
    results = searxngUrl
      ? await fetchSearxng(searxngUrl, query, count, AbortSignal.timeout(TIMEOUT_MS))
      : await fetchDdg(query, count, AbortSignal.timeout(TIMEOUT_MS))
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') throw new Error('recherche web : délai dépassé')
    throw new Error(`recherche web échouée : ${e instanceof Error ? e.message : String(e)}`)
  }
  if (results.length === 0) return `Aucun résultat pour « ${query} ».`
  return results.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n')
}
