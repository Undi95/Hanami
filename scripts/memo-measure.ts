// Mesurage A/B de l'injection mémoire sélective — 2 appels LLM seulement.
// Exécution : npx tsx scripts/memo-measure.ts
// Ne touche NI l'app NI data/ : les blocs mémoire sont construits en mémoire,
// Ollama est appelé directement (la config est LUE ICI — les secrets n'apparaissent
// nulle part ailleurs). But : trancher « l'injection sélective bat-elle le
// tout-ou-rien (index seul) pour le rappel d'un fait enfoui dans une grosse
// collection ? ». Le classeur (memoryRank.ts) est validé AVANT, sans LLM.
import { readFileSync } from 'node:fs'
import type { MemoryFile } from '../shared/types'
import { rankMemoryForInjection, selectWithinBudget } from '../server/lib/memoryRank'

// ── Collection mémoire : 1 fait pertinent + 6 leurres, total > 8000 chars. ──
const RELEVANT = 'surnom.md'
const files: MemoryFile[] = [
  { name: RELEVANT, content: "Le surnom secret de Lucas est « Papillon ». Il l'a choisi après avoir vu un papillon bleu le 12 mars, et il ne veut que deux personnes le sachent." },
  { name: 'surnoms-equipe.md', content: 'Les surnoms de l\'équipe : Marco est « le Loup », Aïda est « Foudre », Ben est « le Phare ». Chacun a choisi le sien. (complété par une note sur l\'histoire de chaque surnom, les circonstances de leur adoption, et pourquoi l\'équipe y tient autant — les détails tiennent en quelques paragraphes).' },
  { name: 'noms-de-code.md', content: 'Noms de code des projets : « Cartographe » pour la carte, « Lutin » pour l\'outil interne, « Comète » pour le serveur de staging. Les noms de code évitent les mots sensibles et sont choisis au hasard puis figés. (Le document détaille la procédure de choix, les noms retirés, et la convention de naming appliquée à tous les dépôts.)' },
  { name: 'voyages.md', content: 'Voyages : un week-end à Annecy en juin, une randonnée dans le Jura, et un projet de voyage au Japon. Les comptes rendus notent les hébergements, le budget, et les prochaines étapes. (Le détail des dates, des réservations et des estimations de coût y figure.)' },
  { name: 'cuisine.md', content: 'Cuisine : préférence pour le thé vert, une recette de ratatouille tenue secrète, et les repas du dimanche. Les notes notent les ingrédients, les variantes testées, et ce qui a marché ou pas. (Le document liste aussi les restaurants préférés et leurs spécialités.)' },
  { name: 'travail.md', content: 'Travail : développeur, actuellement sur un projet de cartographie. Les outils, les branches, et les prochaines tâches sont notés ici. (Le détail des sprints, des revues de code, et des décisions techniques tient en plusieurs paragraphes.)' },
  { name: 'famille.md', content: 'Famille : un chat nommé Mochi, la sœur Anaïs à Lyon, et les fêtes. Les notes notent les anniversaires, les adresses, et les petites habitudes. (Le document liste aussi les parrains/marraines et la généalogie proche.)' },
]
// Gonfle les leurres pour dépasser FRANCHEMENT le seuil de 8000 chars : c'est
// AU-DESSUS que le mode « auto » bascule sur index-seul (chute brutale), donc
// c'est là que le sélectif peut gagner. En dessous, « auto » injecte tout et il
// n'y a pas de contraste.
for (const f of files) {
  if (f.name !== RELEVANT) f.content += ' (suite — notes complémentaires) '.repeat(90)
}
const index = files.map((f) => `- [${f.name.replace('.md', '')}](${f.name})`).join('\n')
const totalLen = files.reduce((n, f) => n + f.content.length, 0)
if (totalLen <= 8000) {
  console.log(`⚠️ collection = ${totalLen} chars ≤ 8000 : « auto » ne serait PAS index-seul —` +
    ' le contraste ci-dessous est invalide, augmente le padding.')
  process.exit(2)
}

// ── La question + le fait à rappeler. ───────────────────────────────────────
const QUESTION = 'Quel est le surnom secret de Lucas ?'
const FACT = 'papillon'
const BUDGET = 8000 // chars — budget d'injection du mode sélectif

// ── 1) Validation SANS LLM : le classeur choisit-il le bon fichier ? ────────
console.log(`Collection : ${files.length} fichiers, ${totalLen} chars (> 8000 → « auto » = index seul)\n`)
const ranked = rankMemoryForInjection(QUESTION, files, index)
const { selected } = selectWithinBudget(ranked, BUDGET)
const topNames = selected.map((r) => r.file.name)
const rankerOk = topNames[0] === RELEVANT
console.log('1) Classeur (sans LLM) — fichiers sélectionnés :', topNames.join(', '))
console.log(`   → choisit bien le bon fichier (${RELEVANT}) : ${rankerOk ? 'OUI' : 'NON'}\n`)

// ── 2) Les deux blocs mémoire. ──────────────────────────────────────────────
const base =
  "Tu es un compagnon de chat. Réponds brièvement (une ou deux phrases) en français. " +
  "Fais confiance aux mémoires ci-dessous, et dis « je ne sais pas » si elle n'en parle pas.\n\n"
// A : « auto » sur grosse collection → index seul (le modèle n'a pas d'outil ici).
const blockA = '## Mémoire\n' + index + '\n'
// B : sélectif → index + les fichiers classés qui tiennent dans le budget.
let blockB = '## Mémoire\n' + index + '\n'
for (const r of selected) blockB += `\n### ${r.file.name}\n${r.file.content}\n`

// ── 3) Deux appels Ollama (séquentiels, maxTokens court). ───────────────────
const cfg = JSON.parse(readFileSync('data/config.json', 'utf8'))
const url = cfg.backendUrl.replace(/\/$/, '') + '/chat/completions'
const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

async function ask(block: string): Promise<{ text: string; ms: number }> {
  const body = {
    model: cfg.model,
    max_tokens: 120,
    temperature: 0,
    messages: [
      { role: 'system', content: base + block },
      { role: 'user', content: QUESTION },
    ],
  }
  const t0 = Date.now()
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content ?? ''
  return { text, ms: Date.now() - t0 }
}

console.log('2) Appel A — « auto » (index seul) :')
let a: { text: string; ms: number } | null = null
try {
  a = await ask(blockA)
  console.log(`   réponse : ${a.text.trim() || '(vide)'}  [${Math.round(a.ms / 1000)}s]`)
} catch (e) {
  console.log('   ÉCHEC appel A :', (e as Error).message)
}
const aRecall = !!a && a.text.toLowerCase().includes(FACT)

console.log('\n3) Appel B — sélectif (index + fichiers pertinents) :')
let b: { text: string; ms: number } | null = null
try {
  b = await ask(blockB)
  console.log(`   réponse : ${b.text.trim() || '(vide)'}  [${Math.round(b.ms / 1000)}s]`)
} catch (e) {
  console.log('   ÉCHEC appel B :', (e as Error).message)
}
const bRecall = !!b && b.text.toLowerCase().includes(FACT)

// ── 4) Verdict. ─────────────────────────────────────────────────────────────
console.log('\n── VERDICT ─────────────────────────────────────────')
console.log(`Rappel du fait « ${FACT} » :  A (auto/index seul) = ${aRecall ? 'OUI' : 'non'}   |   B (sélectif) = ${bRecall ? 'OUI' : 'non'}`)
if (rankerOk && bRecall && !aRecall) {
  console.log('✅ La sélection GAGNE : le fait enfoui est rappelé UNIQUEMENT quand le bon fichier est injecté.')
} else if (bRecall && aRecall) {
  console.log('≈ Les deux répondent — sur ce cas la sélection n’apporte pas (le fait était inférable de l’index).')
} else if (bRecall) {
  console.log('✅ B répond — la sélection apporte.')
} else {
  console.log('❌ B ne répond pas — à investiguer (classeur, fait trop discret, modèle capricieux).')
}
