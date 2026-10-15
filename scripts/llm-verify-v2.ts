// HYP. 1b — pousser le LLM PLUS fort SOUS le filet (gap −19 % auto → −29 % v1 main).
//
// Tour 3 a montré : LLM propose + vérifieur DÉTERMINISTE = −19 % d'entrée (405 → 329) /
// 6-6 rappel / 0 fait perdu — mais 10 points de moins que le télégraphique ÉCRIT À LA
// MAIN (v1, −29 %). Constat (carnet) : le LLM reste CONSERVATEUR, il garde « stérilisé
// depuis l'année dernière », « contact surtout étés ». Ce script teste LE levier :
// une instruction PLUS AGRESSIVE qui (1) définit les FAITS DURS au plus strict
// (chiffres/dates/noms/villes/adresses/qui-est-qui), (2) AUTORISE explicitement à jeter
// les nuances & relatifs (non-faits-durs), (3) fixe le format clé:valeur télégraphique.
// Le filet (verifyFacts) + le rappel (6 questions) gardent la barre : si l'agressivité
// casse un fait, le vérifieur REJETTE → repli denseEncode, et le rappel le prouve.
//
// Exécution : npx tsx scripts/llm-verify-v2.ts — ~11 appels LLM dosés
// (3 compression max_tokens=2000 AMORTI + 2 tokens + 6 rappel max_tokens=200), temp=0.
// Mêmes 3 fichiers + 6 questions que llm-verify.ts (comparabilité stricte).
import { readFileSync } from 'node:fs'
import { denseEncode } from '../research/codec'
import { verifyFacts } from '../research/verifier'

const cfg = JSON.parse(readFileSync('data/config.json', 'utf8'))
const url = cfg.backendUrl.replace(/\/$/, '') + '/chat/completions'
const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

// ── MÊMES 3 fichiers + 6 questions que llm-verify.ts (comparabilité). ────────
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

// ── Instruction AGRESSIVE (le levier testé ce tour) ──────────────────────────
// ⚠️ SÉRIEUX — la 1ère version de cette instruction (mesurée plus haut au premier run)
// était CONTAMINÉE : sa liste « À SUPPRIMER » citait les phrases EXACTES des 3 fichiers
// de test (« depuis l'année dernière », « surtout les étés », « environ », « très direct »,
// « quand tout le monde peut venir ») et son exemple de règle réutilisait famille.md
// (« Léa 8, Hugo 5 »). C'était DONC À LA MAIN la liste des coupes → le −32 % n'est PAS
// un codec général, c'est du tuning sur le jeu de test. On NE PUBLIE PAS ce chiffre.
//
// Version PROPRE (celle-ci, c'est CE QUI EST MESURÉ) : (a) « SANS perdre un seul fait »
// → « sans perdre un seul FAIT DUR » (périmètre rétréci) ; (b) suppression par
// CATEGORIES GÉNÉRALES (pas de phrase du jeu de test citée) ; (c) format clé:valeur
// imposé ; (d) exemples 100 % hors jeu de test. La vraie question : une instruction
// GÉNÉRALE ferme-t-elle le gap −19 %→−29 %, ou faut-il des coupes spécifiques à la data ?
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
    max_tokens: 2000, // coût amorti (compression 1×, réutilisée N×) — sinon troncage
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

// ══ 1) LLM (AGRESSIF) densifie + vérifieur DÉTERMINISTE, fichier par fichier. ═
console.log('── 1) LLM AGRESSIF + VÉRIFICATEUR (par fichier) ───────────────────')
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
  const tag = verdict.ok ? '✅ LLM-agressif (vérifié)' : '⚠️ REJETÉ → repli denseEncode'
  console.log(`◆ ${f.name} — ${tag}`)
  if (!verdict.ok) {
    console.log(`   manque : chiffres=[${verdict.missingNumbers}] entités=[${verdict.missingEntities}]`)
  }
  console.log(llm.split('\n').map((l) => `     | ${l}`).join('\n'))
  console.log()
}

// ══ 2) Coût d'entrée : bloc AGRESSIF-vérifié vs baselines. ═══════════════════
const PLAIN_BLOCK = build(FILES)
const AGGR_BLOCK = build(results.map((r) => ({ name: r.name, content: r.chosen })))

console.log('── 2) COÛT ENTRÉE (usage.prompt_tokens) ────────────────────────────')
const tPlain = await tokenCount(PLAIN_BLOCK)
await sleep(300)
const tAggr = await tokenCount(AGGR_BLOCK)
console.log(`  PLAIN           = ${tPlain} tokens`)
console.log(`  denseEncode     = (rappel) 377 tokens / −7 %   [plancher, zéro LLM]`)
console.log(`  LLM v1 (cons.)  = (rappel) 329 tokens / −19 %  [tour 3]`)
console.log(`  v1 main (main)  = (rappel) 288 tokens / −29 %  [télégraphique à la main]`)
console.log(`  LLM AGRESSIF    = ${tAggr} tokens  (${AGGR_BLOCK.length} car.)`)
if (tPlain > 0 && tAggr > 0) {
  const save = Math.round((1 - tAggr / tPlain) * 100)
  const nLLM = results.filter((r) => r.usedLLM).length
  console.log(`  → économie d'entrée : −${save} %  (${nLLM}/3 fichiers passés le vérifieur, ${3 - nLLM} en repli)`)
}

// ══ 3) RAPPEL sur le bloc AGRESSIF-vérifié (le contrôle final). ══════════════
console.log('\n── 3) RAPPEL sur le bloc AGRESSIF (6 questions) ───────────────────')
let hits = 0
for (const item of QUESTIONS) {
  const r = await ask(AGGR_BLOCK, item.q)
  await sleep(300)
  const ok = item.expect.some((e) => r.text.includes(e.toLowerCase()))
  if (ok) hits++
  const voidLoop = r.text.trim() === '' && r.finish === 'length'
  console.log(`  ${ok ? '✓' : '✗'} ${item.q}  [finish=${r.finish}${voidLoop ? ', BOUCLE VIDE' : ''}]`)
  console.log(`      → "${r.text.trim() || '(VIDE)'}"`)
}
console.log(`  Rappel AGRESSIF : ${hits}/6  (PLAIN = 6/6, v1 main = 6/6, LLM v1 = 6/6)`)

// ══ 4) TEST ADVERSARIAL du vérifieur (DÉTERMINISTE, zéro LLM) — invarié. ═════
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
console.log(`  fidèle   → ok=${vF.ok}                     (attendu : true)`)
console.log(`  −chiffre → ok=${vN.ok} manque=${JSON.stringify(vN.missingNumbers)}  (attendu : false, 8)`)
console.log(`  −entité  → ok=${vE.ok} manque=${JSON.stringify(vE.missingEntities)}  (attendu : false, lyon)`)
console.log(`  → vérifieur fiable (zéro faux-vert) : ${noFalseGreen && catchNum && catchEnt ? 'OUI' : 'NON ⚠️'}`)

// ══ 5) VERDICT. ═════════════════════════════════════════════════════════════
console.log('\n── VERDICT ─────────────────────────────────────────────')
console.log(`  Fichiers passés le vérifieur : ${results.filter((r) => r.usedLLM).length}/3`)
console.log(`  Économie d'entrée AGRESSIF : ${tPlain > 0 && tAggr > 0 ? Math.round((1 - tAggr / tPlain) * 100) : '?'} %  |  Rappel : ${hits}/6`)
console.log(`  (barres : LLM v1 −19 %/6-6 ; v1 main −29 %/6-6 ; cap = battre v1 main AUTO)`)
