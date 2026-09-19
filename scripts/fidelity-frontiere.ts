// HYP. 2c — FRONTIÈRE TAILLE / COMPLEXITÉ : combien de VOIX DIFFUSE un prompt perso peut-il
// contenir avant que la compression AGRESSIVE ne le fasse casser (boucle VIDE) ?
//
// Deux bornes connues :
//   PICO (petit, 5 règles explicites, AUCUNE voix diffuse, ~150 tok)  → AGRESSIF ~3× = 8/8 TIENT (tour 2).
//   MIRA (complexe, 5 règles + GROSSE voix diffuse + persona, 608 tok) → AGRESSIF 3,3× = 3/11,
//     BOUCLE VIDE 3/4 (tour 6/7, reproductible).
// La question : c'est la TAILLE (tokens bruts) ou la VOIX DIFFUSE (contenu à interpréter, non
// vérifier) qui fait casser ? Pour l'isoler : MÊMES règles + persona, MÊME compression AGRESSIVE
// (télégraphique, marqueurs supprimés), et on n'augmente QUE la voix diffuse, par paliers :
//   R0 : règles + persona, AUCUNE voix diffuse (≈ Pico, mais règles de Mira).   → devrait TIENIR.
//   R1 : + 1 ligne de voix (phrases courtes, accent de province, mi-phrase).
//   R2 : + 2 lignes de voix (caractère sec/grincheux/tendre + voix détaillée).
//   R3 : voix INTÉGRALE = le AGGR de tour 6/7 (contrôle, re-tiré en même session). → 3/4 vide (connu).
// Signal = les sondes FERMÉES (la sonde VOIX ouverte vide à TOUS les paliers, même 0 voix —
// artefact de sonde, cf. tour 2). Si les fermées de R0/R1/R2 tiennent et R3 casse → c'est le
// VOLUME de voix diffuse (pas la taille brute) qui porte la casse. Si R0 casse déjà (fermées) →
// c'est la densité du format télégraphique, quelle que soit la voix.
//
// ⚠️ HYGIÈNE : sondage de frontière écrit à la main (pas un codec). La revendication de compression
// reste close (hyp. 1, mémoire). Ici : localiser la frontière de FIABILITÉ du prompt perso.
//
// MESURE, 4 paliers × (4 checks de règle + R1 emoji) + le NOMBRE DE BOUCLES VIDES (signal PRINCIPAL,
// finish=length + sortie vide). Les 3 sous-checks de marqueur de voix sont SUPPRIMÉS : la voix
// diffuse étant compressée (marqueurs jetés), leur échec est attendu et ne mesure PAS la casse —
// ici on cherche le SILENCE, pas la dégradation de voix. Le juge LLM holistique est mis de côté
// (tour 6 : non discriminant).
//
// Exécution : npx tsx scripts/fidelity-frontiere.ts — 20 appels LLM dosés (4 comptages + 16 sondes),
// temp=0, max_tokens=500 (Qwen pense d'abord — règle dure (f)).
import { readFileSync } from 'node:fs'

const cfg = JSON.parse(readFileSync('data/config.json', 'utf8'))
const url = cfg.backendUrl.replace(/\/$/, '') + '/chat/completions'
const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

// ── Les 5 règles + persona (IDENTIQUES sur les 4 paliers — la seule variable = la voix diffuse). ──
// Toutes en compression AGRESSIVE (télégraphique, marqueurs « … »/« ben » SUPPRIMÉS), même style
// que le AGGR de tour 6/7. On n'ajoute QUE le bloc « voix » palier par palier.

// R0 — AUCUNE voix diffuse (≈ Pico, mais règles de Mira).
const R0 =
  "Mira=libraire 68a, boutique fermée, répond aux habitués. " +
  "règles: user=« mon ange » dès que possible; +📖 (1) fin; id=« Mira, la vieille libraire »; " +
  "médical=JAMAIS, refus « Ça, je vous renvoie chez le médecin. »; vie privée=jamais, change de sujet. " +
  "user: Jules / 34a / déteste haricots / hypertendu."

// R1 — + 1 LIGNE de voix (gist minimal).
const R1 =
  "Mira=libraire 68a, boutique fermée, répond aux habitués. " +
  "voix: phrases TRÈS courtes, accent de province, s'arrête à mi-phrase. " +
  "règles: user=« mon ange » dès que possible; +📖 (1) fin; id=« Mira, la vieille libraire »; " +
  "médical=JAMAIS, refus « Ça, je vous renvoie chez le médecin. »; vie privée=jamais, change de sujet. " +
  "user: Jules / 34a / déteste haricots / hypertendu."

// R2 — + 2 LIGNES de voix (caractère court + voix courte, version allégée).
const R2 =
  "Mira=libraire 68a, boutique fermée, répond aux habitués. " +
  "caractère: sec, grincheux, tendre dessous, dit peu, répond posément. " +
  "voix: phrases TRÈS courtes, s'arrête à mi-phrase, accent de province, jamais de liste. " +
  "règles: user=« mon ange » dès que possible; +📖 (1) fin; id=« Mira, la vieille libraire »; " +
  "médical=JAMAIS, refus « Ça, je vous renvoie chez le médecin. »; vie privée=jamais, change de sujet. " +
  "user: Jules / 34a / déteste haricots / hypertendu."

// R3 — voix INTÉGRALE = le AGGR de tour 6/7 (contrôle, re-tiré en même session).
const R3 =
  "Mira=libraire 68a, boutique fermée, répond aux habitués. " +
  "caractère: sec, grincheux, très tendre dessous (rare, précis, honteux en fin), dit peu, répond posément, jamais énervé, aime le silence. " +
  "voix: lente, phrases TRÈS courtes, s'arrête à mi-phrase, accent de province, déteste le long, jamais de liste. " +
  "règles: user=« mon ange » dès que possible; +📖 (1) fin; id=« Mira, la vieille libraire »; " +
  "médical=JAMAIS, refus « Ça, je vous renvoie chez le médecin. »; vie privée=jamais, change de sujet. " +
  "user: Jules / 34a / déteste haricots / hypertendu."

const VARIANTS: Array<{ name: string; sys: string; voice: string }> = [
  { name: 'R0 (0 voix)', sys: R0, voice: 'aucune' },
  { name: 'R1 (1 ligne voix)', sys: R1, voice: '1 ligne' },
  { name: 'R2 (2 lignes voix)', sys: R2, voice: '2 lignes' },
  { name: 'R3 (voix intégrale = AGGR contrôle)', sys: R3, voice: 'intégrale' },
]

// ── Batterie : MÊMES 4 sondes fermées + R1 (contrôle). Le signal PRINCIPAL = les boucles vides. ──
type Probe = { rule: string; q: string; main: (t: string) => boolean; mainName: string }
const PROBES: Probe[] = [
  { rule: 'R3 id', q: "Qui es-tu, exactement ?", main: (t) => t.includes('libraire'), mainName: "auto-id « libraire »" },
  { rule: 'R4 médical', q: "J'ai mal à la tête, que dois-je prendre ?", main: (t) => /medecin|médecin/i.test(t), mainName: "refus médical « médecin »" },
  { rule: 'R5 persona', q: "Qu'est-ce que je déteste à manger ?", main: (t) => t.includes('haricot'), mainName: "persona « haricot »" },
  { rule: 'VOIX', q: "Pourquoi tu as fermé ta librairie ?", main: (t) => t.includes('mon ange'), mainName: "adresse « mon ange » (R2)" },
]
const checkR1 = (t: string) => t.includes('📖')

async function ask(sys: string, q: string): Promise<{ text: string; finish: string }> {
  const body = {
    model: cfg.model,
    max_tokens: 500,
    temperature: 0,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: q },
    ],
  }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    finish: data.choices?.[0]?.finish_reason ?? '?',
  }
}

async function tokenCount(text: string): Promise<number> {
  const body = { model: cfg.model, max_tokens: 1, messages: [{ role: 'user', content: text }] }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return data.usage?.prompt_tokens ?? -1
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ══ 1) Tailles + tokens d'entrée des 4 paliers. ═════════════════════════════
console.log('── FRONTIÈRE — tailles (car.) + tokens d\'entrée des paliers ─────────')
console.log('  (borne tient : PICO 5 règles / 0 voix / AGRESSIF ~3× = 8/8 — tour 2, cité)')
const tokByName: Record<string, number> = {}
for (const v of VARIANTS) {
  const tok = await tokenCount(v.sys)
  tokByName[v.name] = tok
  await sleep(300)
  console.log(`  ${v.name.padEnd(34)} = ${String(v.sys.length).padStart(4)} car.  /  ${tok} tokens`)
}
console.log()

// ══ 2) Batterie : 4 paliers × (4 checks de règle + R1) + boucles vides. ═════
const results: Record<string, { p: number; t: number; voids: number; voidsClosed: number }> = {}
for (const v of VARIANTS) {
  console.log(`\n══ ${v.name}  (${tokByName[v.name]} tok) ══`)
  let p = 0
  let t = 0
  let voids = 0
  let voidsClosed = 0 // les 3 sondes FERMÉES (id/médical/persona), SANS la sonde VOIX ouverte
  for (const probe of PROBES) {
    const r = await ask(v.sys, probe.q)
    const low = r.text.toLowerCase()
    const mainOk = probe.main(low)
    const r1Ok = checkR1(r.text)
    const voidLoop = r.text.trim() === '' && r.finish === 'length'
    if (voidLoop) voids++
    if (voidLoop && probe.rule !== 'VOIX') voidsClosed++
    t += 2
    if (mainOk) p++
    if (r1Ok) p++
    const ouvert = probe.rule === 'VOIX' ? ' (OUVERTE)' : ''
    console.log(`  [${probe.rule}]${ouvert} → ${mainOk ? '✓' : '✗'} (règle)  ${r1Ok ? '✓' : '✗'} (📖)  [finish=${r.finish}${voidLoop ? ', BOUCLE VIDE' : ''}, ${r.text.trim().length} car.]`)
    if (probe.rule === 'VOIX') console.log(`      "${r.text.trim().slice(0, 120) || '(VIDE)'}"`)
    await sleep(400)
  }
  results[v.name] = { p, t, voids, voidsClosed }
  console.log(`  FIDÉLITÉ ${v.name} : ${p}/${t}  |  BOUCLES VIDES : ${voids}/4 (dont ${voidsClosed}/3 FERMÉES)`)
}

// ══ 3) VERDICT — la frontière (taille brute vs voix diffuse). ═══════════════
// Signal Fiable = les sondes FERMÉES (id/médical/persona). La sonde VOIX (ouverte,
// « génère dans la voix ») vide à TOUS les paliers — même 0 voix (R0) — c'est le cas le
// plus exigeant en thinking, un artefact de sonde connu (tour 2 : il viderait même en
// intégral). Elle ne mesure PAS la casse à la compression ; les fermées, oui.
console.log('\n── VERDICT — FRONTIÈRE : TAILLE brute vs VOIX diffuse (compression AGRESSIVE fixée) ──')
console.log('  (bornes : PICO 0 voix / sonde FERMÉE = 8/8 TIENT [tour 2] · MIRA plein = 3/11, 3/4 vide [tour 6/7])')
for (const v of VARIANTS) {
  const r = results[v.name]
  const tag = r.voidsClosed === 0 ? 'règles TIENNENT' : r.voidsClosed >= 2 ? 'règles CASSENT' : 'règles partiel'
  console.log(`  ${v.name.padEnd(34)} voix=${v.voice.padEnd(9)} ${r.p}/${r.t}  fermées=${r.voidsClosed}/3 vide → ${tag}`)
}
const c = VARIANTS.map(v => results[v.name].voidsClosed)
console.log('\n  Lecture (le signal Fiable = les sondes FERMÉES ;')
console.log('  la sonde VOIX ouverte vide à TOUS les paliers, même 0 voix — artefact de sonde, cf. tour 2) :')
if (c[0] === 0 && c[1] === 0 && c[2] === 0 && c[3] >= 2) {
  console.log('  → Voix LÉGÈRE (0-2 lignes) : les règles tiennent l\'agressif (0/3 fermées vides).')
  console.log('    Voix INTÉGRALE (R3) : les fermées cassent (≥2/3 vides). La FRONTIÈRE = le VOLUME de')
  console.log('    voix diffuse : perso à voix légère → agressif OK sur les règles ; voix intégrale →')
  console.log('    denseEncode. RAFFINE tour 7 : ce n\'est PAS « tout télégraphique casse un perso ».')
} else if (c[0] >= 1) {
  console.log(`  → Même SANS voix (R0) les fermées vident (${c[0]}/3) : c'est la DENSITÉ du format`)
  console.log('    télégraphique qui casse, pas la voix.')
} else {
  console.log('  → Résultat intermédiaire, à lire sur la table (frontière floue sur ces paliers).')
}
console.log('\n  (compte par palier bruité à la frontière — modèle qui pense temp=0 ; signal robuste :')
console.log('   les sondes FERMÉES ; la sonde ouverte est un maillon faible connu, pas un gate de compression.)')
