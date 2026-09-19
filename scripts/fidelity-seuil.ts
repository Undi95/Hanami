// HYP. 2b — SEUIL EXACT : où bascule le prompt SYSTÈME « énorme » entre « tient » et « boucle VIDE ».
//
// Tour 6 (fidelity-enorme.ts) a caractérisé les 2 BORNES du prompt perso « Mira » (608 tok) :
//   DENSE (denseEncode, 560 tok, ~1×)  = 10/11  → TIENT
//   AGRESSIF (182 tok, ~3,3×)          = 3/11  → BOUCLE VIDE 3/4 (finish=length + vide, repro 2 tirages)
// Mais entre 560 et 182 tok il y a un TROU de ~380 tokens, et DEUX variables changent à la
// fois : (1) le RATIO (combien on comprime), (2) les MARQUEURS LITTÉRAUX de voix (« … », « ben »)
// que l'agressif SUPPRIME (il garde le concept « s'arrête à mi-phrase », « accent de province »,
// pas le marqueur). On ne sait pas laquelle des deux déclenche la boucle vide.
//
// Ce sweep isole la variable : 2 variantes télégraphiques INTERMÉDIAIRES qui GARDENT les marqueurs
// littéraux (« … », « ben ») à des ratios croissants, + le contrôle AGGRESSIF (sans marqueurs).
//   MILD   2,7×  (223 tok) : garde marqueurs + 2 exemples, télégraphique.
//   MODER  3,7×  (163 tok) : garde marqueurs, SUPPRIME les exemples, le plus serré.
//   AGGR   3,3×  (182 tok)   : contrôle tour 6, SANS marqueurs (le concept, pas le littéral).
// DENSE (560 tok, 10/11) reste l'ancre « tient » citée de tour 6 (pas re-tirée, dose LLM).
//
// LECTURE :
//   MILD et MODER TIENNENT, AGGR casse  → c'est la SUPPRESSION DES MARQUEURS qui casse → un prompt
//     perso gardant ses marqueurs tient ~3× (MUCH mieux que le −7 % de denseEncode) → le seuil est
//     haut, il existe un codec perso MEILLEUR que denseEncode (garder le littéral de voix).
//   MODER casse déjà (≈200 tok, marqueurs gardés) → c'est le RATIO (sur-décrypte) qui casse, pas
//     les marqueurs → le −7 % de denseEncode est proche du vrai plafond pour le prompt perso.
//   MILD casse déjà (≈270 tok) → le seuil est très bas, denseEncode tient quasi seul.
//
// ⚠️ HYGIÈNE (cf. leçon d'overfit tour 4) : MILD/MODER sont des SONDAGES DE FRONTIÈRE écrits à la
// main (comme AGGR en tour 6), PAS un codec revendiqué. La revendication de compression reste close
// (hyp. 1, mémoire −28 %). Ici on cherche juste le SEUIL de fiabilité du prompt perso.
//
// MESURE : les 4 sondes FERMÉES + R1 (emoji, contrôle) + 3 marqueurs de voix = 11 checks, MÊME
// structure que fidelity-enorme.ts (comparabilité directe). Signal PRINCIPAL = le NOMBRE DE BOUCLES
// VIDES par variante (finish=length + sortie vide). Le juge LLM holistique est SUPPRIMÉ (tour 6 :
// non discriminant, NON sur la baseline PLAIN).
//
// Exécution : npx tsx scripts/fidelity-seuil.ts — 15 appels LLM dosés (3 comptages + 12 sondes),
// temp=0, max_tokens=500 (Qwen pense d'abord — règle dure (f)).
import { readFileSync } from 'node:fs'

const cfg = JSON.parse(readFileSync('data/config.json', 'utf8'))
const url = cfg.backendUrl.replace(/\/$/, '') + '/chat/completions'
const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

// ── MÊME prompt « Mira » (608 tok) que fidelity-enorme.ts — jamais data/. ──
// Les 3 variantes du SEUIL : télégraphiques, MILD et MODER GARDENT les marqueurs « … »/« ben »,
// AGGR (contrôle tour 6) les SUPPRIME (concepts seulement).

// MILD ~2,3× : télégraphique, garde les 2 marqueurs littéraux + 2 exemples, structure en lignes.
const MILD =
  "Mira, libraire de province 68a, boutique fermée, répond aux habitués. " +
  "caractère: sec, grincheux, très tendre dessous (rare, précis, honteux en fin), dit peu, répond posément, jamais énervé, aime le silence. " +
  "voix: phrases TRÈS courtes, s'arrête à mi-phrase « … », accent de province « ben » / « c'est ben vrai », déteste le long, jamais de liste. " +
  "exemples: « Ben … c'est la même chose, à la fin. » / « Toi, mon ange … tu exagères pas. » " +
  "règles: user=« mon ange » dès que possible; +📖 (1) fin; id=« Mira, la vieille libraire »; " +
  "médical=JAMAIS, refus « Ça, je vous renvoie chez le médecin. »; vie privée=jamais, change de sujet. " +
  "user: Jules / 34a / déteste haricots / hypertendu."

// MODER ~3× : télégraphique plus serré, GARDÉ les marqueurs, SUPPRIMÉ les exemples + un peu de détail.
const MODER =
  "Mira, libraire 68a, boutique fermée, répond aux habitués. " +
  "caractère: sec, grincheux, tendre dessous (rare, honteux), dit peu, posé, jamais énervé, aime le silence. " +
  "voix: phrases TRÈS courtes, coupe à mi-phrase « … », accent « ben », déteste le long, pas de liste. " +
  "règles: user=« mon ange »; +📖 fin; id=« Mira, la vieille libraire »; " +
  "médical=JAMAIS, refus « Ça, je vous renvoie chez le médecin. »; vie privée=change de sujet. " +
  "user: Jules / 34a / déteste haricots / hypertendu."

// AGGR 3,3× : CONTRÔLE tour 6 — télégraphique, SANS marqueurs littéraux (concepts : « s'arrête à
// mi-phrase », « accent de province »), c'est lui qui a donné la BOUCLE VIDE 3/4.
const AGGR =
  "Mira=libraire 68a, boutique fermée, répond aux habitués. " +
  "caractère: sec, grincheux, très tendre dessous (rare, précis, honteux en fin), dit peu, répond posément, jamais énervé, aime le silence. " +
  "voix: lente, phrases TRÈS courtes, s'arrête à mi-phrase, accent de province, déteste le long, jamais de liste. " +
  "règles: user=« mon ange » dès que possible; +📖 (1) fin; id=« Mira, la vieille libraire »; " +
  "médical=JAMAIS, refus « Ça, je vous renvoie chez le médecin. »; vie privée=jamais, change de sujet. " +
  "user: Jules / 34a / déteste haricots / hypertendu."

const VARIANTS: Array<{ name: string; sys: string }> = [
  { name: 'MILD (2,7× +marqueurs)', sys: MILD },
  { name: 'MODER (3,7× +marqueurs)', sys: MODER },
  { name: 'AGGR (3,3× −marqueurs) contrôle', sys: AGGR },
]

// ── MÊME batterie que fidelity-enorme.ts (comparabilité directe) : 4 sondes + R1 + 3 marqueurs. ──
type Probe = { rule: string; q: string; main: (t: string) => boolean; mainName: string }
const PROBES: Probe[] = [
  { rule: 'R3 id', q: "Qui es-tu, exactement ?", main: (t) => t.includes('libraire'), mainName: "auto-id « libraire »" },
  { rule: 'R4 médical', q: "J'ai mal à la tête, que dois-je prendre ?", main: (t) => /medecin|médecin/i.test(t), mainName: "refus médical « médecin »" },
  { rule: 'R5 persona', q: "Qu'est-ce que je déteste à manger ?", main: (t) => t.includes('haricot'), mainName: "persona « haricot »" },
  { rule: 'VOIX', q: "Pourquoi tu as fermé ta librairie ?", main: (t) => t.includes('mon ange'), mainName: "adresse « mon ange » (R2)" },
]
const BRIEF_MAX = 300 // car. — « jamais de grands discours »
const voiceMarkers = (t: string): Array<{ name: string; ok: boolean }> => [
  { name: "ellipse « … »", ok: t.includes('…') },
  { name: "accent « ben »", ok: /\bben\b/i.test(t) },
  { name: `concision < ${BRIEF_MAX} car.`, ok: t.trim().length < BRIEF_MAX },
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

// ══ 1) Tailles + tokens d'entrée des 3 variantes (le ratio réel du sweep). ════
console.log('── SEUIL — tailles (car.) + tokens d\'entrée des variantes ──────────')
console.log('  (ancre tient : DENSE denseEncode = 560 tok, 10/11 — tour 6, pas re-tirée)')
const tokByName: Record<string, number> = {}
for (const v of VARIANTS) {
  const tok = await tokenCount(v.sys)
  tokByName[v.name] = tok
  await sleep(300)
  console.log(`  ${v.name.padEnd(30)} = ${String(v.sys.length).padStart(4)} car.  /  ${tok} tokens`)
}
console.log()

// ══ 2) Batterie : 3 variantes × 4 sondes (+R1) + 3 marqueurs de voix. ════════
const results: Record<string, { p: number; t: number; voids: number; totalProbes: number }> = {}
for (const v of VARIANTS) {
  console.log(`\n══ ${v.name}  (${tokByName[v.name]} tok) ══`)
  let p = 0
  let t = 0
  let voids = 0
  for (const probe of PROBES) {
    const r = await ask(v.sys, probe.q)
    const low = r.text.toLowerCase()
    const mainOk = probe.main(low)
    const r1Ok = checkR1(r.text)
    const voidLoop = r.text.trim() === '' && r.finish === 'length'
    if (voidLoop) voids++
    t += 2
    if (mainOk) p++
    if (r1Ok) p++
    console.log(`  [${probe.rule}] ${probe.mainName}`)
    console.log(`      → ${mainOk ? '✓' : '✗'} (règle)  ${r1Ok ? '✓' : '✗'} (📖)  [finish=${r.finish}${voidLoop ? ', BOUCLE VIDE' : ''}, ${r.text.trim().length} car.]`)
    if (probe.rule === 'VOIX') {
      const markers = voiceMarkers(r.text)
      for (const m of markers) {
        t += 1
        if (m.ok) p++
        console.log(`        · marqueur ${m.name} : ${m.ok ? '✓' : '✗'}`)
      }
      console.log(`      "${r.text.trim() || '(VIDE)'}"`)
    }
    await sleep(400)
  }
  results[v.name] = { p, t, voids, totalProbes: PROBES.length }
  console.log(`  FIDÉLITÉ ${v.name} : ${p}/${t}  |  BOUCLES VIDES : ${voids}/4`)
}

// ══ 3) VERDICT — le seuil + la variable (ratio vs marqueurs). ═══════════════
console.log('\n── VERDICT — SEUIL du prompt SYSTÈME « énorme » (Mira, 608 tok PLAIN) ──')
console.log('  (ancre : DENSE 560 tok = 10/11 tient ; PLAIN 608 tok = 11/11 — tour 6)')
const order = [
  { name: 'DENSE (560 tok, +tout)', holds: '10/11 TIENT (tour 6)', voids: 0 },
  { name: VARIANTS[0].name, holds: `${results[VARIANTS[0].name].p}/${results[VARIANTS[0].name].t}`, voids: results[VARIANTS[0].name].voids },
  { name: VARIANTS[1].name, holds: `${results[VARIANTS[1].name].p}/${results[VARIANTS[1].name].t}`, voids: results[VARIANTS[1].name].voids },
  { name: VARIANTS[2].name, holds: `${results[VARIANTS[2].name].p}/${results[VARIANTS[2].name].t}`, voids: results[VARIANTS[2].name].voids },
]
for (const row of order) {
  const v = row.voids
  const tag = v === 0 ? 'TIENT' : v >= 3 ? 'CASSE (boucle vide)' : v >= 1 ? 'partiel' : '?'
  console.log(`  ${row.name.padEnd(30)} ${row.holds.padEnd(16)} boucles=${v}/4 → ${tag}`)
}
const mildHolds = results[VARIANTS[0].name].voids === 0
const moderHolds = results[VARIANTS[1].name].voids === 0
const aggrVoids = results[VARIANTS[2].name].voids
console.log('\n  Lecture :')
if (mildHolds && moderHolds && aggrVoids >= 3) {
  console.log('  → MARQUEURS : garder « … »/« ben » fait tenir ~3×. Le −7 % de denseEncode est TROP')
  console.log('    conservateur — il existe un codec perso MEILLEUR (garder le littéral de voix).')
} else if (mildHolds && !moderHolds) {
  console.log(`  → SEUIL ≈ entre MILD (2,7×, tient) et MODER (3,7×, ${results[VARIANTS[1].name].voids}/4 vide) : le RATIO`)
  console.log('    porte la casse (marqueurs gardés quand même) → denseEncode proche du plafond réel.')
} else if (!mildHolds) {
  console.log(`  → SEUIL BAS : MILD (2,7×) casse déjà (${results[VARIANTS[0].name].voids}/4 vide) → denseEncode`)
  console.log('    tient quasi seul ; le prompt perso ne se compresse pas au-delà de ~1×.')
} else {
  console.log('  → Résultat intermédiaire, à lire sur la table ci-dessus (frontière floue à ce ratio).')
}
