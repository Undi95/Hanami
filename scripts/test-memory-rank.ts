// Test de la logique pure de classement mémoire (server/lib/memoryRank.ts).
// Exécution : npx tsx scripts/test-memory-rank.ts
// Aucun LLM, aucun FS — on vérifie le MÉCANISME du classement (ordre, boost de la
// ligne d'index, idf, sélection par budget). La question « bat-il vraiment le
// tout-ou-rien ? » est tranchée au mesurage LLM (Phase 2), pas ici.
import type { MemoryFile } from '../shared/types'
import {
  indexLineFor,
  rankMemoryForInjection,
  selectWithinBudget,
  tokenize,
} from '../server/lib/memoryRank'

let pass = 0
let fail = 0
function check(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(
      `  ✗ ${label}\n      attendu : ${JSON.stringify(want)}\n      obtenu  : ${JSON.stringify(got)}`,
    )
  }
}

// ── Données : une collection mémoire réaliste (hors index) + son index. ─────
const files: MemoryFile[] = [
  { name: 'preferences.md', content: "L'utilisateur préfère le thé vert au café. Aime les livres de science-fiction." },
  { name: 'sante.md', content: 'Allergique aux arachides. Asthme léger, évite les effluves fortes.' },
  { name: 'famille.md', content: 'A un chat nommé Mochi. Vit à Lyon avec sa sœur Anaïs.' },
  { name: 'travail.md', content: 'Développeur. Travaille sur un projet de cartographie en Python.' },
  { name: 'loisirs.md', content: 'Aime la photographie en forêt.' },
]
const index = [
  '# Mémoire',
  '- [Préférences](preferences.md) — thé vert, café, science-fiction',
  '- [Santé](sante.md) — allergies, arachides, asthme',
  '- [Famille](famille.md) — chat Mochi, Lyon, sœur',
  '- [Travail](travail.md) — développement, cartographie, Python',
  '- [Loisirs](loisirs.md) — rando, forêt, apéro',
].join('\n')

console.log('tokenize — mots utiles conservés, stopwords + accents gérés :')
check('stopwords FR/EN retirés', tokenize('Le chat du café est bon'), ['chat', 'café', 'bon'])
check('accents FR conservés, minuscules', tokenize('Allergie aux Arachides'), ['allergie', 'arachides'])
check('tokens de 1 lettre jetés', tokenize('a et le x et'), [])

console.log('\nindexLineFor — retrouve la ligne du fichier :')
check('ligne de sante.md', indexLineFor(index, 'sante.md'), '- [Santé](sante.md) — allergies, arachides, asthme')
check('fichier absent → vide', indexLineFor(index, 'inexistant.md'), '')

console.log('\nrankMemoryForInjection — le bon fichier arrive premier :')
{
  const order = (q: string) => rankMemoryForInjection(q, files, index).map((r) => r.file.name)
  check('« les arachides me posent problème » → sante.md', order('les arachides me posent problème')[0], 'sante.md')
  check('« comment va mon chat » → famille.md', order('comment va mon chat')[0], 'famille.md')
  check('« cartographie python » → travail.md', order('cartographie python')[0], 'travail.md')
  check('« thé vert science-fiction » → preferences.md', order('thé vert science-fiction')[0], 'preferences.md')
}

console.log('\nrankMemoryForInjection — boost de la ligne d\'index :')
{
  // « apéro » n'est dans AUCUN contenu, seulement dans le hook de loisirs.md →
  // le fichier doit quand même être classé (le hook est un signal fort).
  const ranked = rankMemoryForInjection('apéro', files, index)
  check('« apéro » (index seul) → loisirs.md en tête', ranked[0].file.name, 'loisirs.md')
  check('  … et son score est > 0', ranked[0].score > 0, true)
}

console.log('\nrankMemoryForInjection — requête vide : tous à 0, ordre par nom :')
{
  const ranked = rankMemoryForInjection('', files, index)
  check('tous les scores à 0', ranked.every((r) => r.score === 0), true)
  check('ordre déterministe (nom)', ranked.map((r) => r.file.name),
    ['famille.md', 'loisirs.md', 'preferences.md', 'sante.md', 'travail.md'])
}

console.log('\nselectWithinBudget — prend les classés qui tiennent, écarte le reste :')
{
  const small: MemoryFile[] = [
    { name: 'a.md', content: '12345' }, // 5
    { name: 'b.md', content: '12345' }, // 5
    { name: 'c.md', content: '12345' }, // 5
  ]
  const ranked = rankMemoryForInjection('', small, '') // ordre par nom : a, b, c
  const res = selectWithinBudget(ranked, 10)
  check('budget 10 → a + b retenus', res.selected.map((r) => r.file.name), ['a.md', 'b.md'])
  check('  … c écarté', res.omitted.map((r) => r.file.name), ['c.md'])
  check('  … used = 10', res.used, 10)
  const all = selectWithinBudget(ranked, 100)
  check('budget large → tout retenu', all.selected.length, 3)
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} réussi(s), ${fail} échec(s)`)
if (fail > 0) process.exit(1)
