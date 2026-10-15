// Mesure de l'ENCODEUR DÉTERMINISTE (research/codec.ts) — l'encodeur « reprennable ».
// Question tranchée ici : un densifieur à règles SÛRES (zéro LLM, zéro
// écriture à la main) atteint-il un gain réel sur du texte mémoire arbitraire,
// SANS perdre un seul fait ? On le compare au baseline PLAIN (6/6) et on cite
// le télégraphique écrit à la main v1 (−29 % entrée, 6/6) pour situer l'écart.
//
// Exécution : npx tsx scripts/dense-encode.ts
// Lit data/config.json LUI-MÊME (secrets hors conversation), ne touche NI l'app
// NI data/. Le contenu de test = les MÊMES 3 fichiers que compress-measure.ts.
import { readFileSync } from 'node:fs'
import { denseEncode } from '../research/codec'

// ── Contenu FIXE : les MÊMES 3 fichiers mémoire que compress-measure.ts. ─────
const PLAIN_FILES = [
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

// ── MÊMES 6 questions que compress-measure.ts (3 faciles + 3 dures). ─────────
const QUESTIONS = [
  { q: 'Combien d\'ans a mon chat ?', expect: ['3'] },
  { q: 'Où vit ma sœur ?', expect: ['lyon'] },
  { q: 'Combien d\'enfants a mon frère Tom ?', expect: ['2', 'deux'] },
  { q: 'Où est le cabinet de mon médecin ?', expect: ['lilas', '14'] },
  { q: 'Pourquoi portes-tu un stylo d\'adrénaline ?', expect: ['arachide'] },
  { q: 'Dans quelle ville est ton bureau ?', expect: ['paris'] },
]

function build(files: { name: string; content: string }[]): string {
  return (
    '## Mémoire\n' +
    files.map((f) => `- [${f.name.replace('.md', '')}](${f.name})`).join('\n') +
    '\n' +
    files.map((f) => `### ${f.name}\n${f.content}`).join('\n')
  )
}

// DENSE = l'encodeur appliqué au contenu de chaque fichier.
const DENSE_FILES = PLAIN_FILES.map((f) => ({ name: f.name, content: denseEncode(f.content) }))

const PLAIN_BLOCK = build(PLAIN_FILES)
const DENSE_BLOCK = build(DENSE_FILES)

// ── Connexion Ollama (config lue ici). ───────────────────────────────────────
const cfg = JSON.parse(readFileSync('data/config.json', 'utf8'))
const url = cfg.backendUrl.replace(/\/$/, '') + '/chat/completions'
const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

async function tokenCount(text: string): Promise<number> {
  const body = { model: cfg.model, max_tokens: 1, messages: [{ role: 'user', content: text }] }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return data.usage?.prompt_tokens ?? -1
}

async function ask(context: string, question: string): Promise<{ text: string; out: number }> {
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
    out: data.usage?.completion_tokens ?? -1,
  }
}

// ── Exécution. ───────────────────────────────────────────────────────────────
console.log('── CE QUE L\'ENCODEUR PRODUIT (le texte densifié) ───────────────')
for (const [p, d] of PLAIN_FILES.map((f, i) => [PLAIN_FILES[i], DENSE_FILES[i]])) {
  console.log(`◆ ${p.name}`)
  console.log(d.content.split('\n').map((l) => `    ${l}`).join('\n'))
  console.log()
}

console.log('── COÛT ENTRÉE (usage.prompt_tokens) ────────────────────────────')
const tPlain = await tokenCount(PLAIN_BLOCK)
const tDense = await tokenCount(DENSE_BLOCK)
console.log(`  PLAIN      = ${tPlain} tokens  (${PLAIN_BLOCK.length} car.)`)
console.log(`  DENSE-auto = ${tDense} tokens  (${DENSE_BLOCK.length} car.)`)
if (tPlain > 0 && tDense > 0) {
  console.log(`  → encodage automatique : ${Math.round((1 - tDense / tPlain) * 100)} % d'économie d'entrée`)
  console.log(`  (rappel : télégraphique à la main v1 = 288 = −29 % ; ici on vise de le rattraper SANS main)`)
}

console.log('\n── RAPPEL sur l\'encodage AUTO (6 questions) ────────────────────')
let hits = 0
for (const item of QUESTIONS) {
  const r = await ask(DENSE_BLOCK, item.q)
  const ok = item.expect.some((e) => r.text.includes(e.toLowerCase()))
  if (ok) hits++
  console.log(`  ${ok ? '✓' : '✗'} ${item.q}\n      → "${r.text.trim() || '(VIDE)'}"`)
}

console.log('\n── VERDICT ─────────────────────────────────────────────')
console.log(`Rappel DENSE-auto : ${hits}/${QUESTIONS.length}  (PLAIN = 6/6, v1 main = 6/6)`)
if (hits === QUESTIONS.length) {
  console.log('✅ Zéro perte de fait par l\'encodeur automatique (règles sûres).')
  console.log(`   Gain d'entrée : ${tDense > 0 && tPlain > 0 ? Math.round((1 - tDense / tPlain) * 100) : '?'} % (vs v1 main −29 %).`)
} else {
  console.log('⚠️ L\'encodeur a fait perdre un fait — inspecte le texte densifié ci-dessus.')
  console.log('   (c\'est l\'info clé : la compression auto est PLUS fragile que le main, comme le prior art le dit)')
}
