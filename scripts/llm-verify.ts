// HYPOTHÈSE 1 (piste leader) — LLM propose + VÉRIFICATEUR DÉTERMINISTE.
//
// La question : le DENSIFICATEUR DÉTERMINISTE (denseEncode) plafonne à −7 % (le
// plancher des règles sûres). Le télégraphique écrit à la main (v1) fait −29 % mais
// c'est de la MAIN. Y a-t-il un moyen AUTOMATIQUE d'atteindre le niveau v1 SANS
// perdre un fait ? → On laisse un LLM densifier agressivement (la compression
// SÉMANTIQUE = le gap de 22 pts), PUIS un vérifieur DÉTERMINISTE (zéro LLM,
// research/verifier.ts) contrôle que tout fait « dur » (chiffres + entités) survit.
// Un fait manquant → on REJETTE ce passage et on retombe sur denseEncode.
//
// 3 couches, chacune son rôle :
//   1. LLM     = la force (compression sémantique, retrait de prose).
//   2. VÉRIF.  = le filet DÉTERMINISTE (chiffres + entités ; zéro faux-vert).
//   3. RAPPEL  = le contrôle final (6 questions ; attrape ce que le vérifieur
//                ne peut pas : un cardinal en LETTRES, un swap de relation).
//
// Exécution : npx tsx scripts/llm-verify.ts
// Lit data/config.json LUI-MÊME. ~11 appels LLM dosés (3 compression + 2 tokens +
// 6 rappel), temp=0. max_tokens : 2000 pour les 3 COMPRESSIONS (coût AMORTI — le
// fichier le plus dense « pense » avant de sortir, sinon troncage, cf. probe), 200
// pour les rappels. Le test adversarial du vérifieur est DÉTERMINISTE (zéro LLM) —
// il prouve l'absence de faux-vert.
import { readFileSync } from 'node:fs'
import { denseEncode } from '../research/codec'
import { verifyFacts } from '../research/verifier'

const cfg = JSON.parse(readFileSync('data/config.json', 'utf8'))
const url = cfg.backendUrl.replace(/\/$/, '') + '/chat/completions'
const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

// ── MÊMES 3 fichiers + 6 questions que compress-measure.ts / dense-encode.ts. ─
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

// ── Instruction de compression (le LLM est CONTRAINT de garder les faits). ────
const COMPRESS_SYS =
  "Tu es un compresseur de mémoire pour LLM. Densifie le texte pour réduire les " +
  "tokens SANS perdre un seul fait. RÈGLES STRICTES :\n" +
  "1. GARDER EXACTEMENT chaque fait : mêmes chiffres, mêmes noms propres (majuscules), " +
  "mêmes villes, mêmes adresses, mêmes dates.\n" +
  "2. NE JAMAIS réécrire ni abréviger un chiffre ni un nom (interdit : « Bdx », « TT »).\n" +
  "3. SUPPRIMER la prose : verbes être/avoir, articles, « s'appelle », « qui a », " +
  "connecteurs, reformulations, répétitions.\n" +
  "4. UNE LIGNE par fait, format télégraphique LISIBLE.\n" +
  "Réponds UNIQUEMENT avec le texte densifié — aucun commentaire, aucune introduction, " +
  "pas de guillemets."

async function compress(content: string): Promise<string> {
  const body = {
    model: cfg.model,
    max_tokens: 2000, // coût amorti (compression 1×, réutilisée N×) — sinon troncage
    temperature: 0,
    messages: [
      { role: 'system', content: COMPRESS_SYS },
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

async function ask(context: string, question: string): Promise<{ text: string; finish: string }> {
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
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ══ 1) LLM densifie + vérifieur DÉTERMINISTE, fichier par fichier. ═══════════
console.log('── 1) LLM propose + VÉRIFICATEUR (par fichier) ────────────────────')
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
  const usedLLM = verdict.ok
  results.push({ name: f.name, content: f.content, llm, verdict, chosen, usedLLM })
  const tag = verdict.ok ? '✅ LLM (vérifié)' : '⚠️ REJETÉ → repli denseEncode'
  console.log(`◆ ${f.name} — ${tag}`)
  if (!verdict.ok) {
    console.log(`   manque : chiffres=[${verdict.missingNumbers}] entités=[${verdict.missingEntities}]`)
  }
  console.log(llm.split('\n').map((l) => `     | ${l}`).join('\n'))
  console.log()
}

// ══ 2) Coût d'entrée : bloc VÉRIFIÉ vs baseline. ═════════════════════════════
const PLAIN_BLOCK = build(FILES)
const DENSE_BLOCK = build(FILES.map((f) => ({ name: f.name, content: denseEncode(f.content) })))
const VERIFIED_BLOCK = build(results.map((r) => ({ name: r.name, content: r.chosen })))

console.log('── 2) COÛT ENTRÉE (usage.prompt_tokens) ────────────────────────────')
const tPlain = await tokenCount(PLAIN_BLOCK)
await sleep(300)
const tVerified = await tokenCount(VERIFIED_BLOCK)
console.log(`  PLAIN           = ${tPlain} tokens`)
console.log(`  DENSE-auto      = (rappel) 377 tokens / −7 %   [denseEncode, le plancher]`)
console.log(`  v1 main         = (rappel) 288 tokens / −29 %  [télégraphique à la main]`)
console.log(`  VÉRIFIÉ (LLM)   = ${tVerified} tokens  (${VERIFIED_BLOCK.length} car.)`)
if (tPlain > 0 && tVerified > 0) {
  const save = Math.round((1 - tVerified / tPlain) * 100)
  const nLLM = results.filter((r) => r.usedLLM).length
  console.log(`  → économie d'entrée : −${save} %  (${nLLM}/3 fichiers passés le vérifieur, ${3 - nLLM} en repli)`)
}

// ══ 3) RAPPEL sur le bloc VÉRIFIÉ (le contrôle final, incl. cardinaux/relations).
console.log('\n── 3) RAPPEL sur le bloc VÉRIFIÉ (6 questions) ────────────────────')
let hits = 0
for (const item of QUESTIONS) {
  const r = await ask(VERIFIED_BLOCK, item.q)
  await sleep(300)
  const ok = item.expect.some((e) => r.text.includes(e.toLowerCase()))
  if (ok) hits++
  const voidLoop = r.text.trim() === '' && r.finish === 'length'
  console.log(`  ${ok ? '✓' : '✗'} ${item.q}  [finish=${r.finish}${voidLoop ? ', BOUCLE VIDE' : ''}]`)
  console.log(`      → "${r.text.trim() || '(VIDE)'}"`)
}
console.log(`  Rappel VÉRIFIÉ : ${hits}/6  (PLAIN = 6/6, v1 main = 6/6, denseEncode = 6/6)`)

// ══ 4) TEST ADVERSARIAL du vérifieur (DÉTERMINISTE, zéro LLM). ══════════════
// Prouve l'ABSENCE de faux-vert : on construit un passage fidèle et deux
// passages corrompus (un chiffre effacé, une entité échangée) et on exige que
// le vérifieur les TRICHES.
console.log('\n── 4) TEST ADVERSARIAL du vérifieur (zéro LLM) ────────────────────')
const ADV_ORIG = 'Mon chat Mochi a 8 ans. Ma sœur Anaïs vit à Lyon.'
const ADV_FAITHFUL = 'chat:Mochi(8) soeur:Anais(Lyon)'
const ADV_NUM = 'chat:Mochi(?) soeur:Anais(Lyon)' // « 8 » effacé
const ADV_ENT = 'chat:Mochi(8) soeur:Anais(Lille)' // « Lyon » → « Lille »
const vF = verifyFacts(ADV_ORIG, ADV_FAITHFUL)
const vN = verifyFacts(ADV_ORIG, ADV_NUM)
const vE = verifyFacts(ADV_ORIG, ADV_ENT)
const noFalseGreen = !vF.ok === false && !vN.ok && !vE.ok
const catchNum = vN.missingNumbers.includes('8')
const catchEnt = vE.missingEntities.includes('lyon')
console.log(`  fidèle   → ok=${vF.ok}                     (attendu : true  — pas de faux-rouge)`)
console.log(`  −chiffre → ok=${vN.ok} manque=${JSON.stringify(vN.missingNumbers)}  (attendu : false, 8)`)
console.log(`  −entité  → ok=${vE.ok} manque=${JSON.stringify(vE.missingEntities)}  (attendu : false, lyon)`)
console.log(`  → vérifieur fiable (zéro faux-vert) : ${noFalseGreen && catchNum && catchEnt ? 'OUI' : 'NON ⚠️'}`)

// ══ 5) VERDICT. ═════════════════════════════════════════════════════════════
console.log('\n── VERDICT ─────────────────────────────────────────────')
console.log(`  Fichiers passés le vérifieur : ${results.filter((r) => r.usedLLM).length}/3`)
console.log(`  Économie d'entrée : ${tPlain > 0 && tVerified > 0 ? Math.round((1 - tVerified / tPlain) * 100) : '?'} %  |  Rappel : ${hits}/6`)
console.log(`  (barres : denseEncode −7 %/6-6 ; v1 main −29 %/6-6 ; le cap = battre v1 AUTO)`)
