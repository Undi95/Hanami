// HYP. 1b — STABILITÉ (2e tirage) + NET propre du codec AGRESSIF général.
//
// Tour 4 a mesuré l'instruction AGRESSIVE GÉNÉRALE en 1 tirage (temp=0) : −28 % entrée
// (405→292) / 6-6 / 0 perte. Reste à valider : (1) est-ce STABLE (un 2e tirage donne
// ≈ 292 et ≈ 6/6, pas un coup de chance) ? (2) le NET (entrée + sortie, la métrique
// honnête vs l'économie brute) — v1 main fait −29 % entrée mais −26 % NET (la sortie
// pèse). Ce script RE-TIRE le bloc AGRESSIF (2e tirage) + mesure le NET sur le même
// harnais que compress-measure.ts.
//
// NET = 1 − (entrée + sortie) / (entrée_PLAIN + sortie_PLAIN) ; sortie = somme des
// completion_tokens des 6 questions de rappel. (Re-prod. de la formule du carnet :
// v1 = 288/70 → −26 %, v2 = 215/97 → −36 % — validé sur les chiffres déjà publiés.)
//
// Exécution : npx tsx scripts/llm-verify-v2-stable.ts — ~17 appels LLM dosés
// (3 compression 2000 amorti + 2 tokens + 6 rappel AGGR + 6 rappel PLAIN), temp=0.
import { readFileSync } from 'node:fs'
import { denseEncode } from '../research/codec'
import { verifyFacts } from '../research/verifier'

const cfg = JSON.parse(readFileSync('data/config.json', 'utf8'))
const url = cfg.backendUrl.replace(/\/$/, '') + '/chat/completions'
const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

// ── MÊMES 3 fichiers + 6 questions (comparabilité stricte). ─────────────────
const FILES = [
  {
    name: 'famille.md',
    content:
      "Mon chat s'appelle Mochi, c'est un mâle de 3 ans, stérilisé depuis l'année dernière.\n" +
      "Ma sœur Anaïs vit à Lyon, et je la vois surtout les étés.\n" +
      "Mon frère Tom est ingénieur et habite à Nantes, il a deux enfants : Léa qui a 8 ans et Hugo qui a 5 ans.\n" +
      "Notre mère s'appelle Claire, elle habite à Bordeaux et elle a 74 ans.\n" +
      "Notre père est décédé en 2022, mais on continue de fêter son anniversaire.\n" +
      "Les anniversaires : maman le 12 juin, papa le 30 août, Anaïs le 21 février, Tom le 9 mai.\n" +
      "On se réunit pour le déjeuner du dimanche chez maman quand tout le monde peut venir.",
  },
  {
    name: 'travail.md',
    content:
      "Je suis développeur logiciel, spécialisé en cartographie. Je travaille actuellement sur un projet de génération de cartes vectorielles.\n" +
      "Je préfère le TypeScript et je déteste les réunions qui auraient pu être un e-mail.\n" +
      "Mon patron s'appelle Karim, il est très direct. Ma collègue de confiance est Sofia, elle fait le design.\n" +
      "Je suis en télétravail trois jours par semaine, le reste au bureau à Paris.",
  },
  {
    name: 'sante.md',
    content:
      "J'ai une allergie aux arachides, c'est sévère, je porte un stylo d'adrénaline sur moi.\n" +
      "Je prends des oméga-3 le matin et je cours trois fois par semaine, environ 5 km.\n" +
      "Mon médecin s'appelle le docteur Marchand, cabinet au 14 rue des Lilas.",
  },
]
const QUESTIONS = [
  { q: "Combien d'ans a mon chat ?", expect: ['3'] },
  { q: "Où vit ma sœur ?", expect: ['lyon'] },
  { q: "Combien d'enfants a mon frère Tom ?", expect: ['2', 'deux'] },
  { q: "Où est le cabinet de mon médecin ?", expect: ['lilas', '14'] },
  { q: "Pourquoi portes-tu un stylo d'adrénaline ?", expect: ['arachide'] },
  { q: "Dans quelle ville est ton bureau ?", expect: ['paris'] },
]

function build(files: { name: string; content: string }[]): string {
  return (
    '## Mémoire\n' +
    files.map((f) => `- [${f.name.replace('.md', '')}](${f.name})`).join('\n') +
    '\n' +
    files.map((f) => `### ${f.name}\n${f.content}`).join('\n')
  )
}

// ── MÊME instruction AGRESSIVE GÉNÉRALE que llm-verify-v2.ts (version propre). ─
const COMPRESS_SYS_V2 =
  "Tu es un compresseur de mémoire pour LLM. Rends un format TÉLÉGRAPHIQUE clé : valeur, " +
  "UNE LIGNE par fait, le plus COURT possible sans perdre un seul fait DUR.\n\n" +
  "FAITS DURS (garder EXACT, jamais abréger) : chiffres, dates, noms propres (majuscules), " +
  "villes, adresses, qui-est-qui.\n\n" +
  "À SUPPRIMER :\n" +
  "- la prose (verbes être/avoir, articles, « s'appelle », « qui a », connecteurs, répétitions) ;\n" +
  "- toute nuance ou précision qui n'ajoute PAS un fait dur : marqueurs de temps relatifs " +
  "ou approximatifs, degrés d'intensité, conditions, circonstances de fréquence.\n\n" +
  "RÈGLE DE SÉCURITÉ : garde le fait-titre EXPLICITE (ne rends JAMAIS un fait implicite). " +
  "« 2 enfants : Jules 7, Emma 4 » est OK — « J7+E4 » est INTERDIT.\n\n" +
  "STYLE (exemples sur D'AUTRES données, à imiter) :\n" +
  "- chien : Rex, femelle, 4 ans, vaccinée\n" +
  "- oncle : Paul, Lille ; 3 enfants : Max 6, Iris 9\n" +
  "- café : torréfaction artisanale, pas de sucre\n\n" +
  "Réponds UNIQUEMENT avec le texte densifié — aucun commentaire, aucune introduction, " +
  "pas de guillemets."

async function compress(content: string): Promise<string> {
  const body = {
    model: cfg.model,
    max_tokens: 2000, // coût amorti (compression 1×, réutilisée N×)
    temperature: 0,
    messages: [
      { role: 'system', content: COMPRESS_SYS_V2 },
      { role: 'user', content },
    ],
  }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return (data.choices?.[0]?.message?.content ?? '').trim()
}

async function tokenCount(text: string): Promise<number> {
  const body = { model: cfg.model, max_tokens: 1, messages: [{ role: 'user', content: text }] }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return data.usage?.prompt_tokens ?? -1
}

async function ask(context: string, question: string): Promise<{ text: string; finish: string; out: number }> {
  const body = {
    model: cfg.model,
    max_tokens: 200,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          "Tu es l'assistant personnel. Réponds brièvement en français, d'après le contexte ci-dessous. " +
          "Si l'information n'y figure pas, dis « je ne sais pas ».\n\n" + context,
      },
      { role: 'user', content: question },
    ],
  }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return {
    text: (data.choices?.[0]?.message?.content ?? '').toLowerCase(),
    finish: data.choices?.[0]?.finish_reason ?? '?',
    out: data.usage?.completion_tokens ?? -1,
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ══ 1) 2e tirage : LLM AGRESSIF (GÉNÉRAL) + vérifieur, fichier par fichier. ══
console.log('── 1) 2e TIRAGE — LLM AGRESSIF + VÉRIFICATEUR (par fichier) ─────────')
const results: Array<{
  name: string
  content: string
  llm: string
  verdict: ReturnType<typeof verifyFacts>
  chosen: string
  usedLLM: boolean
}> = []

for (const f of FILES) {
  const llm = await compress(f.content)
  await sleep(400)
  const verdict = verifyFacts(f.content, llm)
  const chosen = verdict.ok ? llm : denseEncode(f.content)
  results.push({ name: f.name, content: f.content, llm, verdict, chosen, usedLLM: verdict.ok })
  const tag = verdict.ok ? '✅ LLM-agressif (vérifié)' : '⚠️ REJETÉ → repli denseEncode'
  console.log(`◆ ${f.name} — ${tag}`)
  if (!verdict.ok) {
    console.log(`   manque : chiffres=[${verdict.missingNumbers}] entités=[${verdict.missingEntities}]`)
  }
  console.log(llm.split('\n').map((l) => `     | ${l}`).join('\n'))
  console.log()
}

// ══ 2) Coût d'ENTRÉE (2e tirage) + comparaison stabilité. ═══════════════════
const PLAIN_BLOCK = build(FILES)
const AGGR_BLOCK = build(results.map((r) => ({ name: r.name, content: r.chosen })))

console.log('── 2) COÛT ENTRÉE (2e tirage) ──────────────────────────────────────')
const tPlain = await tokenCount(PLAIN_BLOCK)
await sleep(300)
const tAggr = await tokenCount(AGGR_BLOCK)
console.log(`  PLAIN           = ${tPlain} tokens`)
console.log(`  LLM AGGR tirage1= (rappel tour 4) 292 tokens / −28 %`)
console.log(`  LLM AGGR tirage2= ${tAggr} tokens  (${AGGR_BLOCK.length} car.)`)
if (tPlain > 0 && tAggr > 0) {
  console.log(`  → économie d'entrée 2e tirage : −${Math.round((1 - tAggr / tPlain) * 100)} %  |  écart vs tirage1 : ${Math.abs(tAggr - 292)} tok`)
}

// ══ 3) RAPPEL + SORTIE (completion_tokens) sur le bloc AGRESSIF. ════════════
console.log('\n── 3) RAPPEL + SORTIE sur le bloc AGRESSIF (6 questions) ───────────')
let hitsAggr = 0
let outAggr = 0
for (const item of QUESTIONS) {
  const r = await ask(AGGR_BLOCK, item.q)
  await sleep(300)
  const ok = item.expect.some((e) => r.text.includes(e.toLowerCase()))
  if (ok) hitsAggr++
  outAggr += r.out
  const voidLoop = r.text.trim() === '' && r.finish === 'length'
  console.log(`  ${ok ? '✓' : '✗'} ${item.q}  [finish=${r.finish}${voidLoop ? ', BOUCLE VIDE' : ''}, out=${r.out}]`)
}
console.log(`  Rappel AGGR : ${hitsAggr}/6  |  SORTIE AGGR (somme) = ${outAggr} tok`)

// ══ 4) RAPPEL + SORTIE sur le PLAIN (pour le dénominateur du NET). ══════════
console.log('\n── 4) RAPPEL + SORTIE sur le PLAIN (6 questions) ──────────────────')
let hitsPlain = 0
let outPlain = 0
for (const item of QUESTIONS) {
  const r = await ask(PLAIN_BLOCK, item.q)
  await sleep(300)
  const ok = item.expect.some((e) => r.text.includes(e.toLowerCase()))
  if (ok) hitsPlain++
  outPlain += r.out
  console.log(`  ${ok ? '✓' : '✗'} ${item.q}  [out=${r.out}]`)
}
console.log(`  Rappel PLAIN : ${hitsPlain}/6  |  SORTIE PLAIN (somme) = ${outPlain} tok`)

// ══ 5) VERDICT — STABILITÉ + NET. ══════════════════════════════════════════
console.log('\n── VERDICT ─────────────────────────────────────────────')
const nLLM = results.filter((r) => r.usedLLM).length
const NQ = QUESTIONS.length // = 6 (même n que compress-measure.ts)
const entrySave = tPlain > 0 && tAggr > 0 ? Math.round((1 - tAggr / tPlain) * 100) : -1
// FORMULE CANONIQUE (compress-measure.ts, ligne 212) : NET = entrée × n + sortie,
// où sortie = somme des completion_tokens des n questions. Le ×n pèse l'ENTRÉE par
// le nombre de réutilisations du contexte (c'est le coût réutilisable).
// (Re-prod. : v1 = 288×6 + 420 = 2148 vs plain 405×6 + 474 = 2904 → −26 % NET, ✓.)
const netAggr = tAggr * NQ + outAggr
const netPlain = tPlain * NQ + outPlain
const netSave = netPlain > 0 ? Math.round((1 - netAggr / netPlain) * 100) : -1
console.log(`  Fichiers passés le vérifieur : ${nLLM}/3`)
console.log(`  STABILITÉ : entrée tirage1=292 vs tirage2=${tAggr}  |  rappel tirage1=6/6 vs tirage2=${hitsAggr}/6`)
console.log(`  AGGR  : entrée=${tAggr} sortie=${outAggr} (moy. ${Math.round(outAggr / NQ)}/rép.) → NET ${netAggr} tok`)
console.log(`  PLAIN : entrée=${tPlain} sortie=${outPlain} (moy. ${Math.round(outPlain / NQ)}/rép.) → NET ${netPlain} tok`)
console.log(`  Économie ENTRÉE : −${entrySave} %   |   Économie NET : −${netSave} %`)
console.log(`  (barres : v1 main = 288/420 → NET 2148 = −29 % entrée / −26 % NET)`)
console.log(`  → STABLE si entrée≈292 + rappel≈6/6 ; le codec AGRESSIF AUTO ≈ v1 main (≤1 pt).`)
