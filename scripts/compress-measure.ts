// Spike « contexte compressé » — PHASE 1 (coût) + 2 (rappel) + 3 (frontière).
// Branche research/context-compression. Hypothèse de Lucas : encoder souvenirs/
// contexte dans un format DENSIFIÉ que le LLM local décode encore, pour réduire
// les tokens sans perdre l'info.
//
// Trois encodages du MÊME contenu (écrits à la main = comparatif propre) :
//   PLAIN     : prose naturelle.
//   DENSE v1  : télégraphique, mots entiers (sûr).
//   DENSE v2  : plus agressif — abréviations (Bdx, TT, †, epi-pen) : on teste où
//               ça casse (la frontière compression/fiabilité).
//
// Mesures :
//   --tokens (défaut, quasi gratuit) : coût ENTRÉE réel (usage.prompt_tokens,
//     max_tokens=1).
//   --recall : (a) le modèle RAPPELE-t-il les faits (injection seule, pas d'outil),
//     (b) le coût SORTIE (usage.completion_tokens) → le coût NET = entrée + sortie
//     (si DENSE fait penser plus, l'économie d'entrée se resserre).
//
// Lit data/config.json LUI-MÊME (secrets hors conversation), ne touche NI l'app
// NI data/.
import { readFileSync } from 'node:fs'

// ── Contenu FIXE : 3 fichiers mémoire. ───────────────────────────────────────
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

const DENSE_V1_FILES = [
  {
    name: 'famille.md',
    content:
      'chat:Mochi male 3ans sterilise\n' +
      'soeur:Anais @Lyon (voit etes)\n' +
      'frere:Tom @Nantes ing (2enfants: Lea8, Hugo5)\n' +
      'maman:Claire @Bordeaux 74ans\n' +
      'papa:decede 2022 (anniv fete quand meme)\n' +
      'anniv: maman0612 papa0830 anais0221 tom0509\n' +
      'repas: dim @maman si dispo',
  },
  {
    name: 'travail.md',
    content:
      'job:dev-logiciel (carto, projet cartes vectorielles)\n' +
      'stack: TS (prefere); deteste reunions-qui-pourraient-etre-mail\n' +
      'boss:Karim (direct); collab: Sofia (design)\n' +
      'lieu: teletravail 3j/sem, reste bureau @Paris',
  },
  {
    name: 'sante.md',
    content:
      'ALLERGIE: arachides SEVERE (stylo adrenaline porte)\n' +
      'habitudes: omega3 matin; course 3x/sem ~5km\n' +
      'medecin: Dr Marchand, 14 rue des Lilas',
  },
]

const DENSE_V2_FILES = [
  {
    name: 'famille.md',
    content:
      'chat:Mochi(M,3,st) soeur:Anais(Lyon,ete) frere:Tom(Nantes,ing,L8+H5) maman:Claire(Bdx,74) papa:†2022 anniv:m612-p830-a221-t509 repas:dim@maman',
  },
  {
    name: 'travail.md',
    content:
      'job:dev carto(cartes vectorielles) TS prefere, deteste reunions; boss:Karim(direct) collab:Sofia(design) lieu:TT3j+bureau(Paris)',
  },
  {
    name: 'sante.md',
    content:
      'ALLERGIE arachide SEVERE(epi-pen) omega3 matin, course 3x/sem ~5km medecin:Dr Marchand(14 Lilas)',
  },
]

function build(files: { name: string; content: string }[]): string {
  return (
    '## Mémoire\n' +
    files.map((f) => `- [${f.name.replace('.md', '')}](${f.name})`).join('\n') +
    '\n' +
    files.map((f) => `### ${f.name}\n${f.content}`).join('\n')
  )
}

const VARIANTS: Record<string, string> = {
  PLAIN: build(PLAIN_FILES),
  'DENSE v1': build(DENSE_V1_FILES),
  'DENSE v2': build(DENSE_V2_FILES),
}

// ── Q&R avec REPONSE ATTENDUE (on juge chaque variante contre le fait réel).
// Mélange de facile (clé→valeur) et dur (relation / compte / localisation).
const QUESTIONS = [
  { q: 'Combien d\'ans a mon chat ?', expect: ['3'] }, // facile
  { q: 'Où vit ma sœur ?', expect: ['lyon'] }, // facile
  { q: 'Combien d\'enfants a mon frère Tom ?', expect: ['2', 'deux'] }, // dur : compte
  { q: 'Où est le cabinet de mon médecin ?', expect: ['lilas', '14'] }, // dur : localisation
  { q: 'Pourquoi portes-tu un stylo d\'adrénaline ?', expect: ['arachide'] }, // dur : causalité
  { q: 'Dans quelle ville est ton bureau ?', expect: ['paris'] }, // dur : déduction
]

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

async function ask(context: string, question: string): Promise<{ text: string; outTokens: number }> {
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
    outTokens: data.usage?.completion_tokens ?? -1,
  }
}

// ── PHASE 1 : coût ENTRÉE. ──────────────────────────────────────────────────
async function phaseTokens() {
  console.log('── PHASE 1 : coût ENTRÉE (usage.prompt_tokens) ────────────────')
  const names = Object.keys(VARIANTS)
  const tokens: Record<string, number> = {}
  for (const n of names) {
    tokens[n] = await tokenCount(VARIANTS[n])
    console.log(`  ${n.padEnd(10)} = ${tokens[n]} tokens  (${VARIANTS[n].length} car.)`)
  }
  const base = tokens['PLAIN']
  for (const n of names) {
    if (n === 'PLAIN') continue
    if (base > 0 && tokens[n] > 0) console.log(`  → ${n} : ${Math.round((1 - tokens[n] / base) * 100)} % d'économie d'entrée`)
  }
  return tokens
}

// ── PHASE 2+3 : rappel + coût SORTIE. ───────────────────────────────────────
async function phaseRecall() {
  console.log('── PHASE 2+3 : rappel + coût SORTIE (injection seule) ─────────')
  const names = Object.keys(VARIANTS)
  const hits: Record<string, number> = {}
  const outSum: Record<string, number> = {}
  for (const n of names) hits[n] = 0, (outSum[n] = 0)
  for (const item of QUESTIONS) {
    const results: Record<string, { ok: boolean; text: string }> = {}
    for (const n of names) {
      const r = await ask(VARIANTS[n], item.q)
      const ok = item.expect.some((e) => r.text.includes(e.toLowerCase()))
      results[n] = { ok, text: r.text.trim() }
      if (ok) hits[n]++
      if (r.outTokens > 0) outSum[n] += r.outTokens
    }
    console.log(`  ${item.q}`)
    for (const n of names) console.log(`    ${n.padEnd(10)} ${results[n].ok ? '✓' : '✗'} "${results[n].text}"`)
  }
  console.log('\n── SYNTHÈSE ──────────────────────────────────────────────')
  console.log('Variante     rappel    sortie(moy.)')
  for (const n of names) {
    console.log(
      `  ${n.padEnd(10)}  ${hits[n]}/${QUESTIONS.length}         ${Math.round(outSum[n] / QUESTIONS.length)} tok/réponse`,
    )
  }
  // Coût net pour répondre aux QUESTIONS.length questions (entrée × n + sortie).
  console.log('\nCoût NET (entrée×' + QUESTIONS.length + ' + sortie) si on posait les questions sur ce contexte :')
  const tokens: Record<string, number> = {}
  for (const n of names) tokens[n] = await tokenCount(VARIANTS[n])
  for (const n of names) {
    const net = tokens[n] * QUESTIONS.length + outSum[n]
    console.log(`  ${n.padEnd(10)} ${net} tokens au total`)
  }
  const verdict = hits['DENSE v1'] + '/' + QUESTIONS.length
  console.log(`\nRappel : PLAIN ${hits['PLAIN']}/${QUESTIONS.length} | DENSE v1 ${verdict} | DENSE v2 ${hits['DENSE v2']}/${QUESTIONS.length}`)
}

const args = process.argv.slice(2)
try {
  if (args.includes('--recall')) {
    await phaseTokens()
    console.log()
    await phaseRecall()
  } else {
    await phaseTokens()
  }
} catch (e) {
  console.error('ERREUR :', (e as Error).message)
  process.exit(1)
}
