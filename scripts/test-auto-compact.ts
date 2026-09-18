// Test de la logique pure de l'auto-compaction (client/src/autoCompact.ts).
// Exécution : npx tsx scripts/test-auto-compact.ts
// Aucun LLM, aucun serveur — on teste la transition du compteur d'échecs par chat,
// qui est le cœur du fix « un échec transitoire ne doit plus tuer l'auto-compact ».
import {
  MAX_AUTO_COMPACT_FAILS,
  autoCompactFailUpdate,
  type AutoCompactOutcome,
} from '../client/src/autoCompact'

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

console.log(`autoCompactFailUpdate — compteur d'échecs par chat (MAX = ${MAX_AUTO_COMPACT_FAILS})\n`)

console.log('Succès → compteur remis à zéro :')
check('succès après 3 échecs → undefined', autoCompactFailUpdate(3, 'success'), {
  count: undefined,
  signal: null,
})
check('succès à vide → undefined', autoCompactFailUpdate(undefined, 'success'), {
  count: undefined,
  signal: null,
})

console.log('\nBruit (409 / nothingToCompact) → compteur inchangé, silencieux :')
check('bruit à 2 → reste 2', autoCompactFailUpdate(2, 'noise'), { count: 2, signal: null })
check('bruit à vide → reste vide', autoCompactFailUpdate(undefined, 'noise'), {
  count: undefined,
  signal: null,
})

console.log('\nÉchec → increment + signal :')
check('1ᵉʳ échec → count 1, signal retry', autoCompactFailUpdate(undefined, 'failure'), {
  count: 1,
  signal: 'retry',
})
check('2ᵉ échec → count 2, silencieux', autoCompactFailUpdate(1, 'failure'), {
  count: 2,
  signal: null,
})
check('3ᵉ échec → count 3, signal stopped', autoCompactFailUpdate(2, 'failure'), {
  count: 3,
  signal: 'stopped',
})
check('4ᵉ échec → count 4, signal stopped (borné)', autoCompactFailUpdate(3, 'failure'), {
  count: 4,
  signal: 'stopped',
})

console.log('\nLe cœur du fix — un échec transitoire ne doit PAS tuer l’auto-compact :')
{
  // Séquence réelle : un échec (retry), puis la compaction passe (reset), puis
  // un nouvel échec — on repart, on ne s’arrête pas définitivement.
  let count: number | undefined = undefined
  const seq: AutoCompactOutcome[] = ['failure', 'success', 'failure']
  const signals: (string | null)[] = []
  for (const o of seq) {
    const r = autoCompactFailUpdate(count, o)
    count = r.count
    signals.push(r.signal)
  }
  check('séquence [échec, succès, échec] → count 1 (pas mort)', count, 1)
  check('  … signaux : [retry, null, retry]', signals, ['retry', null, 'retry'])
}

console.log('\nArrêt borné — après MAX échecs consécutifs, le trigger `fails < MAX` devient faux :')
{
  let count: number | undefined = undefined
  for (let i = 0; i < MAX_AUTO_COMPACT_FAILS; i++) {
    count = autoCompactFailUpdate(count, 'failure').count
  }
  check(`après ${MAX_AUTO_COMPACT_FAILS} échecs, count = ${MAX_AUTO_COMPACT_FAILS}`, count, MAX_AUTO_COMPACT_FAILS)
  check('  … trigger (fails < MAX) = false', (count ?? 0) < MAX_AUTO_COMPACT_FAILS, false)
  count = autoCompactFailUpdate(count, 'success').count
  check('  … puis succès → repart de zéro', count, undefined)
}

console.log('\nmaxFails custom (bordure) :')
check('maxFails=1 → 1ᵉʳ échec = stopped', autoCompactFailUpdate(undefined, 'failure', 1), {
  count: 1,
  signal: 'stopped',
})

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} réussi(s), ${fail} échec(s)`)
if (fail > 0) process.exit(1)
