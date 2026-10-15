// Mesurage A/B de l'injection mémoire sélective — UNE batterie de cas, 2
// appels LLM par cas (index-seul « auto » vs sélectif).
// Exécution : npx tsx scripts/memo-measure.ts
// Ne touche NI l'app NI data/ : les blocs mémoire sont construits en mémoire,
// Ollama est appelé directement (la config est LUE ICI — les secrets n'apparaissent
// nulle part ailleurs). But : trancher « l'injection sélective bat-elle le
// tout-ou-rien (index seul) pour le rappel d'un fait ENFOUI dans une grosse
// collection, et cela généralise-t-il à tous les fichiers ? ».
//
// Propriété structurelle (pas juste empirique) : le mode sélectif ne peut JAMAIS
// être PIRE que « auto » — s'il trouve un signal, il range le bon fichier en
// tête (meilleur) ; s'il n'en trouve aucun, il retombe sur « auto » (égal). La
// batterie ci-dessous vérifie donc le sens où il doit GAGNER (fait enfoui), sur
// plusieurs fichiers, pour confirmer que le classeur n'est pas sur-apparié à un
// seul cas. Doser : c'est le seul script qui frappe le LLM local.
import { readFileSync } from 'node:fs'
import type { MemoryFile } from '../shared/types'
import { rankMemoryForInjection, selectWithinBudget } from '../server/lib/memoryRank'

// ── Collection mémoire : 7 fichiers, chacun avec UN fait enfoui unique. ──────
// Le total dépasse FRANCHEMENT le seuil de 8000 chars : c'est AU-DESSUS que le
// mode « auto » bascule sur index-seul (chute brutale), donc c'est là que le
// sélectif peut gagner. En dessous, « auto » injecte tout et il n'y a pas de
// contraste.
const files: MemoryFile[] = [
  { name: 'surnom.md', content: "Le surnom secret de Lucas est « Papillon ». Il l'a choisi après avoir vu un papillon bleu le 12 mars, et il ne veut que deux personnes le sachent." },
  { name: 'surnoms-equipe.md', content: "Les surnoms de l'équipe : Marco est « le Loup », Aïda est « Foudre », Ben est « le Phare ». Chacun a choisi le sien. (complété par une note sur l'histoire de chacun, les circonstances de leur adoption, et pourquoi l'équipe y tient autant — les détails tiennent en quelques paragraphes)." },
  { name: 'noms-de-code.md', content: 'Noms de code des projets : « Cartographe » pour la carte, « Lutin » pour l\'outil interne, « Comète » pour le serveur de staging. Les noms de code évitent les mots sensibles et sont choisis au hasard puis figés. (Le document détaille la procédure de choix, les noms retirés, et la convention de naming appliquée à tous les dépôts.)' },
  { name: 'voyages.md', content: 'Voyages : un week-end à Annecy en juin, une randonnée dans le Jura, et un projet de voyage au Japon. Les comptes rendus notent les hébergements, le budget, et les prochaines étapes. (Le détail des dates, des réservations et les estimations de coût y figure.)' },
  { name: 'cuisine.md', content: 'Cuisine : préférence pour le thé vert, une recette de ratatouille tenue secrète, et les repas du dimanche. Les notes notent les ingrédients, les variantes testées, et ce qui a marché ou pas. (Le document liste aussi les restaurants préférés et leurs spécialités.)' },
  { name: 'travail.md', content: 'Travail : développeur, actuellement sur un projet de cartographie. Les outils, les branches, et les prochaines tâches sont notés ici. (Le détail des sprints, des revues de code, et des décisions techniques tient en plusieurs paragraphes.)' },
  { name: 'famille.md', content: 'Famille : un chat nommé Mochi, la sœur Anaïs à Lyon, et les fêtes. Les notes notent les anniversaires, les adresses, et les petites habitudes. (Le document liste aussi les parrains/marraines et la généalogie proche.)' },
]
// Gonfle les fichiers non-ciblés par chaque cas pour dépasser le seuil (le
// ciblé reste court pour tenir dans le budget du sélectif).
for (const f of files) f.content += ' (suite — notes complémentaires) '.repeat(90)
const index = files.map((f) => `- [${f.name.replace('.md', '')}](${f.name})`).join('\n')
const totalLen = files.reduce((n, f) => n + f.content.length, 0)
if (totalLen <= 8000) {
  console.log(`⚠️ collection = ${totalLen} chars ≤ 8000 : « auto » ne serait PAS index-seul —` +
    ' le contraste ci-dessous est invalide, augmente le padding.')
  process.exit(2)
}

// ── La batterie : chaque cas cible UN fichier par un mot-clé UNIQUE, avec un
//    fait enfoui qui n'apparaît NI dans la question (pas d'écho) NI dans l'index
//    (index = titres de fichiers seuls). « auto » = index seul ne peut donc pas
//    répondre ; seul le sélectif (bon fichier injecté) peut rappeler le fait.
const BUDGET = 8000 // chars — budget d'injection du mode sélectif
const CASES = [
  { q: 'Quel est le surnom secret de Lucas ?', fact: 'papillon', relevant: 'surnom.md' },
  { q: 'Comment s’appelle le chat ?', fact: 'mochi', relevant: 'famille.md' },
  { q: 'Quelle recette de cuisine est tenue secrète ?', fact: 'ratatouille', relevant: 'cuisine.md' },
]

// ── Les deux blocs mémoire (communs à tous les cas). ─────────────────────────
const base =
  "Tu es un compagnon de chat. Réponds brièvement (une ou deux phrases) en français. " +
  "Fais confiance aux mémoires ci-dessous, et dis « je ne sais pas » si elle n'en parle pas.\n\n"
// A : « auto » sur grosse collection → index seul (le modèle n'a pas d'outil ici).
const blockA = '## Mémoire\n' + index + '\n'

// ── Appels Ollama (séquentiels, maxTokens court). ────────────────────────────
const cfg = JSON.parse(readFileSync('data/config.json', 'utf8'))
const url = cfg.backendUrl.replace(/\/$/, '') + '/chat/completions'
const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

async function ask(block: string, question: string): Promise<{ text: string; ms: number } | null> {
  const body = {
    model: cfg.model,
    max_tokens: 120,
    temperature: 0,
    messages: [
      { role: 'system', content: base + block },
      { role: 'user', content: question },
    ],
  }
  const t0 = Date.now()
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = await res.json()
    const text = (data.choices?.[0]?.message?.content ?? '') as string
    return { text, ms: Date.now() - t0 }
  } catch (e) {
    console.log('   (appel LLM en échec :', (e as Error).message, ')')
    return null
  }
}

function has(rec: { text: string } | null, fact: string): boolean {
  return !!rec && rec.text.toLowerCase().includes(fact)
}

// ── Exécution. ───────────────────────────────────────────────────────────────
console.log(`Collection : ${files.length} fichiers, ${totalLen} chars (> 8000 → « auto » = index seul)\n`)

// Mode --dry : valide le classeur SEUL (aucun appel LLM) — utile pour vérifier
// que chaque cas cible bien le bon fichier avant de frapper le LLM local.
if (process.argv.includes('--dry')) {
  console.log('── DRY (classeur seul, sans LLM) ─────────────────────────────')
  let ok = 0
  for (const c of CASES) {
    const ranked = rankMemoryForInjection(c.q, files, index)
    const { selected } = selectWithinBudget(ranked, BUDGET)
    const topNames = selected.map((r) => r.file.name)
    const good = topNames.includes(c.relevant) ? 'OUI' : 'NON'
    if (topNames[0] === c.relevant) ok++
    console.log(`  ${good} (en tête : ${topNames[0] === c.relevant ? 'oui' : 'non'})  ${c.q}  →  ${topNames.join(', ')}`)
  }
  console.log(`\n${ok}/${CASES.length} cas : le fichier cible arrive EN TÊTE.`)
  process.exit(ok === CASES.length ? 0 : 1)
}

let wins = 0, ties = 0, losses = 0, errors = 0

for (const c of CASES) {
  // 1) Classeur SANS LLM : le bon fichier est-il sélectionné (dans le budget) ?
  const ranked = rankMemoryForInjection(c.q, files, index)
  const { selected } = selectWithinBudget(ranked, BUDGET)
  const topNames = selected.map((r) => r.file.name)
  const relevantIn = topNames.includes(c.relevant)
  const relevantTop = topNames[0] === c.relevant

  // Bloc B pour CE cas : index + les fichiers classés qui tiennent dans le budget.
  let blockB = '## Mémoire\n' + index + '\n'
  for (const r of selected) blockB += `\n### ${r.file.name}\n${r.file.content}\n`

  console.log(`◆ ${c.q}`)
  console.log(`   classeur (sans LLM) : ${topNames.join(', ')}` +
    `  → bon fichier ${relevantIn ? 'injecté' : 'MANQUANT'}${relevantTop ? ' (en tête)' : ''}`)

  const a = await ask(blockA, c.q)
  const aRecall = has(a, c.fact)
  console.log(`   A auto/index seul : ${a ? `"${a.text.trim() || '(vide)'}"  [${Math.round(a.ms / 1000)}s]` : 'échec'}`)

  const b = await ask(blockB, c.q)
  const bRecall = has(b, c.fact)
  console.log(`   B sélectif        : ${b ? `"${b.text.trim() || '(vide)'}"  [${Math.round(b.ms / 1000)}s]` : 'échec'}`)

  if (!a || !b) {
    errors++
    console.log('   → (indécidable : un appel a échoué)\n')
  } else if (bRecall && !aRecall) {
    wins++
    console.log(`   → GAGNE : le fait « ${c.fact} » est rappelé UNIQUEMENT via le sélectif.\n`)
  } else if (bRecall && aRecall) {
    ties++
    console.log(`   → égal : les deux répondent (fait inférable de l'index ici).\n`)
  } else if (!bRecall && aRecall) {
    losses++
    console.log(`   → PERDU (imprévu) : « auto » répond, le sélectif non — à investiguer.\n`)
  } else {
    losses++
    console.log(`   → PERDU : aucun ne rappelle « ${c.fact} » (classeur ou modèle).\n`)
  }
}

// ── Verdict. ─────────────────────────────────────────────────────────────────
console.log('── VERDICT ─────────────────────────────────────────')
console.log(`sur ${CASES.length} cas : ${wins} gagné(s), ${ties} égal(s), ${losses} perdu(s), ${errors} indécidable(s)`)
if (errors < CASES.length && losses === 0 && wins > 0) {
  console.log('✅ La sélection GAGNE quand le fait est enfoui et N\'est jamais pire que « auto ».')
} else if (losses > 0) {
  console.log('⚠️ Des cas perdus — inspecte les lignes ci-dessus (classeur sur-apparié, fait trop discret, modèle).')
} else {
  console.log('≈ Pas de gagnant net sur cette batterie — à rejuger sur d\'autres cas.')
}
