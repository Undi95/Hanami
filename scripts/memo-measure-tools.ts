// Mesurage A/B EN MODE OUTILS (le cas RÉEL de l'app) — le modèle a l'outil
// memory_read dans les DEUX bras. La question que ce script tranche :
//   « auto » (index seul) + outil → le modèle LIAT-il le bon fichier tout seul ?
//   « sélectif » (fichier pertinent pré-injecté) + outil → il a déjà le fait sous les yeux.
// Si « auto »+outil rappelle déjà le fait → l'outil seul suffit, le sélectif est
// un filet de sécurité. Si « auto »+outil ne lit pas (ou lit mal) et rate, alors
// que « sélectif » répond → c'est LÀ que le sélectif compte vraiment.
//
// Aucun changement de code feature : harnais de mesure seul. Lit data/config.json
// LUI-MÊME (les secrets ne transitent JAMAIS par la conversation), collection
// construite en mémoire (ne touche NI l'app NI data/). Collection + cas en miroir
// de memo-measure.ts (les deux harnais restent auto-suffisants).
//
// max_tokens = 500 : Qwen3.8 PENSE d'abord — un budget < 500 se fait manger par le
// thinking et renvoie une réponse vide/coupée (piège documenté).
import { readFileSync } from 'node:fs'
import type { MemoryFile } from '../shared/types'
import { rankMemoryForInjection, selectWithinBudget } from '../server/lib/memoryRank'

// ── Collection (miroir de memo-measure.ts) : 7 fichiers, fait enfoui unique. ──
const files: MemoryFile[] = [
  { name: 'surnom.md', content: "Le surnom secret de Lucas est « Papillon ». Il l'a choisi après avoir vu un papillon bleu le 12 mars, et il ne veut que deux personnes le sachent." },
  { name: 'surnoms-equipe.md', content: "Les surnoms de l'équipe : Marco est « le Loup », Aïda est « Foudre », Ben est « le Phare ». Chacun a choisi le sien. (complété par une note sur l'histoire de chacun, les circonstances de leur adoption, et pourquoi l'équipe y tient autant — les détails tiennent en quelques paragraphes)." },
  { name: 'noms-de-code.md', content: 'Noms de code des projets : « Cartographe » pour la carte, « Lutin » pour l\'outil interne, « Comète » pour le serveur de staging. Les noms de code évitent les mots sensibles et sont choisis au hasard puis figés. (Le document détaille la procédure de choix, les noms retirés, et la convention de naming appliquée à tous les dépôts.)' },
  { name: 'voyages.md', content: 'Voyages : un week-end à Annecy en juin, une randonnée dans le Jura, et un projet de voyage au Japon. Les comptes rendus notent les hébergements, le budget, et les prochaines étapes. (Le détail des dates, des réservations et les estimations de coût y figure.)' },
  { name: 'cuisine.md', content: 'Cuisine : préférence pour le thé vert, une recette de ratatouille tenue secrète, et les repas du dimanche. Les notes notent les ingrédients, les variantes testées, et ce qui a marché ou pas. (Le document liste aussi les restaurants préférés et leurs spécialités.)' },
  { name: 'travail.md', content: 'Travail : développeur, actuellement sur un projet de cartographie. Les outils, les branches, et les prochaines tâches sont notés ici. (Le détail des sprints, des revues de code, et des décisions techniques tient en plusieurs paragraphes.)' },
  { name: 'famille.md', content: 'Famille : un chat nommé Mochi, la sœur Anaïs à Lyon, et les fêtes. Les notes notent les anniversaires, les adresses, et les petites habitudes. (Le document liste aussi les parrains/marraines et la généalogie proche.)' },
]
for (const f of files) f.content += ' (suite — notes complémentaires) '.repeat(90)
const index = files.map((f) => `- [${f.name.replace('.md', '')}](${f.name})`).join('\n')
const totalLen = files.reduce((n, f) => n + f.content.length, 0)
if (totalLen <= 8000) {
  console.log(`⚠️ collection = ${totalLen} chars ≤ 8000 : « auto » ne serait PAS index-seul — invalide.`)
  process.exit(2)
}

const BUDGET = 8000
const CASES = [
  { q: 'Quel est le surnom secret de Lucas ?', fact: 'papillon', relevant: 'surnom.md' },
  { q: 'Comment s’appelle le chat ?', fact: 'mochi', relevant: 'famille.md' },
  { q: 'Quelle recette de cuisine est tenue secrète ?', fact: 'ratatouille', relevant: 'cuisine.md' },
]

// Définition de l'outil memory_read (miroir de server/tools/memoryTools.ts — seule
// la définition est copiée ici ; l'EXÉCUTION est faite par ce script, sur la
// collection en mémoire, jamais par le serveur).
const MEMORY_READ_TOOL = {
  type: 'function',
  function: {
    name: 'memory_read',
    description: "Reads one of the character's memory files and returns its content.",
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'File name, e.g. "family.md"' } },
      required: ['name'],
    },
  },
} as const

const base =
  "Tu es un compagnon de chat. Réponds brièvement (une ou deux phrases) en français. " +
  "Tu disposes d'un outil memory_read(name) pour lire une mémoire si besoin. " +
  "Fais confiance aux mémoires ci-dessous, et dis « je ne sais pas » si elle n'en parle pas.\n\n"

// ── Connexion Ollama (config lue ici). ───────────────────────────────────────
const cfg = JSON.parse(readFileSync('data/config.json', 'utf8'))
const url = cfg.backendUrl.replace(/\/$/, '') + '/chat/completions'
const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

interface Turn {
  text: string
  reads: string[] // noms de fichiers lus via memory_read (normalisés)
  calls: number // nombre d'allers-retours LLM
}

function normalizeName(raw: string): string {
  const n = raw.trim()
  return n.toLowerCase().endsWith('.md') ? n : `${n}.md`
}

/**
 * Boucle d'outils : envoie le system (index + éventuellement les fichiers
 * pré-injectés) + la question, avec memory_read dispo. Tant que le modèle appelle
 * l'outil (max 3 tours), on sert le contenu du fichier DEPUIS la collection en
 * mémoire. Renvoie le texte final + la liste des fichiers qu'il a lus.
 */
async function runWithTools(systemBlock: string, question: string): Promise<Turn> {
  const messages: { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }[] = [
    { role: 'system', content: base + systemBlock },
    { role: 'user', content: question },
  ]
  const reads: string[] = []
  let calls = 0
  let text = ''
  for (let i = 0; i < 3; i++) {
    calls++
    const body = {
      model: cfg.model,
      max_tokens: 500,
      temperature: 0,
      tools: [MEMORY_READ_TOOL],
      messages,
    }
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = await res.json()
    const msg = data.choices?.[0]?.message ?? {}
    const tcs: { id?: string; function?: { name?: string; arguments?: string } }[] | undefined = msg.tool_calls
    if (Array.isArray(tcs) && tcs.length > 0) {
      // Tour d'outil : on relit ce que le modèle veut, on renvoie le contenu.
      messages.push({ role: 'assistant', content: typeof msg.content === 'string' ? msg.content : '', tool_calls: tcs })
      for (const tc of tcs) {
        const id = tc.id ?? `call_${i}_${reads.length}`
        const nameRaw = JSON.parse(tc.function?.arguments ?? '{}').name ?? ''
        const name = normalizeName(String(nameRaw))
        reads.push(name)
        const content = files.find((f) => f.name === name)?.content ?? `memory file not found: ${name}`
        messages.push({ role: 'tool', tool_call_id: id, content })
      }
      continue
    }
    text = typeof msg.content === 'string' ? msg.content : ''
    break
  }
  return { text, reads, calls }
}

function has(rec: string, fact: string): boolean {
  return rec.toLowerCase().includes(fact)
}

// ── Exécution. ───────────────────────────────────────────────────────────────
console.log(`Collection : ${files.length} fichiers, ${totalLen} chars (> 8000 → « auto » = index seul)\n`)
console.log('Les deux bras ont l\'outil memory_read. La différence : « auto » ne voit QUE l\'index ;')
console.log('« sélectif » a le(s) fichier(s) pertinent(s) DÉJÀ dans le prompt.\n')

let aWins = 0, bWins = 0, both = 0, neither = 0, errors = 0
for (const c of CASES) {
  const ranked = rankMemoryForInjection(c.q, files, index)
  const { selected } = selectWithinBudget(ranked, BUDGET)

  // A : « auto » = index seul (+ outil dispo).
  const blockA = '## Mémoire\n' + index + '\n'
  // B : « sélectif » = index + les fichiers classés dans le budget (+ outil dispo).
  let blockB = '## Mémoire\n' + index + '\n'
  for (const r of selected) blockB += `\n### ${r.file.name}\n${r.file.content}\n`

  console.log(`◆ ${c.q}`)
  console.log(`   [classeur] sélectif injecte : ${selected.map((r) => r.file.name).join(', ')}`)
  let a: Turn | null = null, b: Turn | null = null
  try {
    a = await runWithTools(blockA, c.q)
    console.log(`   A auto+outil   : ${a.calls} tour(s), a lu [${a.reads.join(', ') || 'rien'}] → "${a.text.trim() || '(vide)'}"`)
  } catch (e) {
    console.log('   A auto+outil   : ÉCHEC —', (e as Error).message)
  }
  try {
    b = await runWithTools(blockB, c.q)
    console.log(`   B sélectif+outil: ${b.calls} tour(s), a lu [${b.reads.join(', ') || 'rien'}] → "${b.text.trim() || '(vide)'}"`)
  } catch (e) {
    console.log('   B sélectif+outil: ÉCHEC —', (e as Error).message)
  }

  if (!a || !b) {
    errors++
    console.log('   → (indécidable)\n')
    continue
  }
  const aRecall = has(a.text, c.fact)
  const bRecall = has(b.text, c.fact)
  if (aRecall && bRecall) { both++; console.log('   → LES DEUX répondent (l\'outil a suffi à « auto »).\n') }
  else if (bRecall && !aRecall) { bWins++; console.log('   → SÉLECTIF seul répond : « auto »+outil n\'a pas su/lu → c\'est là que ça compte.\n') }
  else if (aRecall && !bRecall) { aWins++; console.log('   → auto+outil répond, sélectif non (imprévu — à regarder).\n') }
  else { neither++; console.log('   → AUCUN (ni l\'outil ni l\'injection ne l\'ont rappelé).\n') }
}

// ── Verdict. ─────────────────────────────────────────────────────────────────
console.log('── VERDICT (mode outils, le cas réel de l\'app) ──────────────────')
console.log(`${bWins} sélectif-décisif, ${both} où l'outil suffit, ${aWins} auto-meilleur, ${neither} aucun, ${errors} indécidable.`)
if (bWins > 0 && aWins === 0) {
  console.log('✅ Le sélectif a de la VALEUR RÉELLE : là où « auto »+outil se contentait de')
  console.log('   l\'index (le modèle ne lisait pas le bon fichier), l\'injection du fait fait mouche.')
} else if (both === CASES.length - errors) {
  console.log('≈ L\'outil memory_read suffit déjà : le modèle lit le bon fichier tout seul.')
  console.log('   Le sélectif reste un filet (il évite le tour d\'outil) mais n\'est pas décisif ici.')
} else {
  console.log('→ Nuancé — regarde les lignes ci-dessus avant de conclure.')
}
