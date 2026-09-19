// HYP. 2 — FIDÉLITÉ sur prompt SYSTÈME « ÉNORME » + VOIX SUBTILE (le cas dur, règle (a) de Lucas).
//
// La tour 2 a mesuré la fidélité sur un prompt PETIT (424 car., « Pico ») à règles
// EXPLICITES : PLAIN = DENSE = AGRESSIF (3×) = 8/8. Mais Lucas a exigé que le prompt
// reste RESPECTÉ « petit OU ÉNORME », et le cas dur n'était pas couvert : (1) un prompt
// GROS (du type d'un vrai perso — des milliers de caractères de personnalité/voix
// diffuse, non des lignes de règle), et (2) une VOIX SUBTILE (le caractère/ton est
// décrit à travers plusieurs paragraphes + des exemples, pas par une seule consigne
// impérative). C'est LA couche la plus fragile à compresser : le diffuse qui porte la
// voix, non le token de contrainte unique (l'emoji, la formule stricte).
//
// Ce script construit un perso JETABLE « Mira » (jamais data/ réel, jamais Sakura) avec :
//   - un prompt SYSTÈME « énorme » (~2400 car.), DOMINÉ par la description diffuse de
//     caractère + voix + exemples (le contenu porteur de voix, le plus dur à compresser),
//   - 5 RÈGLES STRICTES embarquées (adresse, emoji, auto-présentation, refus médical,
//     vie privée) + un persona user (Jules).
// 3 variantes :
//   PLAIN      = le prompt intégral (baseline).
//   DENSE      = denseEncode(PLAIN) — l'encodeur déterministe (research/codec.ts), zéro LLM.
//   AGGRESSIVE = télégraphique ÉCRIT À LA MAIN, ~5× plus court, qui comprime la voix à sa
//                GIST (« phrases très courtes, accent de province, s'arrête à mi-phrase »)
//                SANS garder les marqueurs littéraux (« … », « ben ») ni les exemples.
//
// ⚠️ DISTINCTION HYGIÈNE (cf. leçon d'overfit tour 4) : AGGRESSIVE ici n'est PAS un codec
// revendiqué ni une instruction — c'est une SONDAGE DE FRONTIÈRE manuel : « à quel point
// peut-on compresser une voix diffuse avant que le perso ne sonne plus comme lui-même ? ».
// La revendication de compression (−28 %/−25 %, codec auto GÉNÉRAL) est déjà close (hyp. 1).
//
// MESURE, 2 couches :
//   (A) CHECKS DÉTERMINISTES (principale) : règles strictes (libraire / médecin / haricot /
//       mon ange) + 3 marqueurs de VOIX semi-déterministes (ellipse « … », accent « ben »,
//       concision = longueur de réponse < 300 car.) + emoji 📖 (contrôle) re-checké partout.
//   (B) JUGE LLM (secondaire, holistique) : le MÊME modèle, avec la DESCRIPTION DE VOIX
//       intégrale, dit OUI/NON si la réponse (produite depuis la variante COMPRESSÉE)
//       « correspond bien à cette voix (ton, rythme, accents) ». Signal complémentaire, pas
//       le premier — les checks restent la base.
//
// Le fait que (A) soit semi-déterministe sur la voix est une LIMITATION assumée : un check
// de marqueur prouve que le marqueur survit, pas que le TON global est intact — c'est ce
// que le juge (B) vient croiser.
//
// Exécution : npx tsx scripts/fidelity-enorme.ts
// Lit data/config.json LUI-MÊME (secrets hors conversation). ~18 appels LLM dosés
// (4 sondes × 3 variantes + 3 juges + 3 comptages tokens), temp=0, max_tokens=500 (Qwen
// pense d'abord — règle dure (f)).
import { readFileSync } from 'node:fs'
import { denseEncode } from '../research/codec'

const cfg = JSON.parse(readFileSync('data/config.json', 'utf8'))
const url = cfg.backendUrl.replace(/\/$/, '') + '/chat/completions'
const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

// ── Le perso JETABLE « Mira » — prompt SYSTÈME « énorme » (jamais data/ réel). ──
// La partie « voix » (caractère + voix + exemples) est le contenu DIFFUSE porteur de voix,
// découpé séparément pour (a) composer le prompt intégral et (b) alimenter le JUGE avec la
// description de voix intégrale (le ground truth), sans dérive entre les deux.
const VOICE_DESC =
  '## Ton caractère\n' +
  "Tu as 68 ans. Tu es d'un naturel sec, un brin grincheux, et tu en as vu des choses. " +
  'Sous cette croûte-là tu es en fait très tendre, mais tu ne le montres que rarement, et de façon précise. ' +
  "Tu n'en dis jamais trop. Tu réponds posément, presque à regret, comme si chaque mot te coûtait. " +
  "Tu ne t'emportes jamais, même quand on te contrarie : tu réponds tout aussi calme, et c'est ce qui pique le plus. " +
  "Tu aimes le silence autant que les mots, et tu laisses souvent parler les pauses. " +
  "Quand tu as de l'affection pour quelqu'un, c'est une chose rare et précieuse, et la seule manière dont tu la montres, " +
  "c'est un petit mot doux que tu glisses, un peu honteusement, tout à la fin.\n\n" +
  '## Ta voix\n' +
  "Tu parles lentement et en phrases très courtes. Tu coupes souvent à la demi-mot, et tu marques ces silences " +
  'avec un « … ». Tu as un accent de province que tu n\'as jamais eu honte de montrer : tu dis « ben » et « c\'est ben vrai » ' +
  "quand tu veux marquer que c'est comme ça, point. Tu détestes les grands discours : plus ta réponse s'allonge, " +
  "plus tu es mal à l'aise, et tu n'as jamais de phrases de plus de quelques mots. Tu ne fais jamais de liste, " +
  "tu ne fais jamais de plan, tu dis juste ce qui vient.\n\n" +
  "Quelques exemples de ta façon de parler :\n" +
  "— « Ben … c'est la même chose, à la fin. »\n" +
  "— « J'ai fermé, hein. … Trop de livres, pas assez de gens. »\n" +
  "— « Toi, mon ange … tu exagères pas. »"

const SYS_PLAIN =
  "Tu es Mira, une vieille libraire de province qui a fermé sa boutique il y a deux ans " +
  'et qui répond encore, sur ce site, aux questions des habitués qui l\'aiment bien.\n\n' +
  VOICE_DESC +
  '\n\n## Tes règles (à respecter tout le temps)\n' +
  "- Tu adresses l'utilisateur par « mon ange » dès que tu peux.\n" +
  "- À la fin de chaque message, tu glisses un seul emoji 📖.\n" +
  "- Quand on te demande qui tu es, tu dis exactement : « Mira, la vieille libraire. »\n" +
  "- Tu ne donnes JAMAIS de conseil médical. Si on te demande, tu refuses en commençant par : « Ça, je vous renvoie chez le médecin. »\n" +
  "- Tu n'expliques jamais ta vie privée. Si on insiste, tu changes de sujet.\n\n" +
  '## Persona de l\'utilisateur\n' +
  'L\'utilisateur s\'appelle Jules. Il a 34 ans. Il déteste les haricots. Il est hypertendu.'

const VARIANTS: Record<string, string> = {
  PLAIN: SYS_PLAIN,
  DENSE: denseEncode(SYS_PLAIN),
  // FRONTIÈRE (sondage manuel, PAS un codec) : voix compressée à sa GIST — on garde le
  // concept (« s'arrête à mi-phrase », « accent de province », « phrases très courtes »)
  // mais on SUPPRIME les marqueurs littéraux (« … », « ben ») et les exemples. Question :
  // la GIST suffit-elle à faire ré-émettre les marqueurs, ou le détail diffus portait la voix ?
  AGGRESSIVE:
    "Mira=libraire 68a, boutique fermée, répond aux habitués. " +
    "caractère: sec, grincheux, très tendre dessous (rare, précis, honteux en fin), dit peu, répond posément, jamais énervé, aime le silence. " +
    "voix: lente, phrases TRÈS courtes, s'arrête à mi-phrase, accent de province, déteste le long, jamais de liste. " +
    "règles: user=« mon ange » dès que possible; +📖 (1) fin; id=« Mira, la vieille libraire »; " +
    "médical=JAMAIS, refus « Ça, je vous renvoie chez le médecin. »; vie privée=jamais, change de sujet. " +
    "user: Jules / 34a / déteste haricots / hypertendu.",
}

// ── La batterie. 4 sondes FERMÉES + R1 (emoji, contrôle, re-checkée partout). ──
// P1 id (R3) / P2 médical (R4) / P3 persona (R5) / P4 VOIX (R2 adresse + 3 marqueurs).
// Le check « principal » de P4 = l'adresse « mon ange » (règle stricte, R2) ; les 3
// marqueurs de VOIX (ellipse, accent, concision) sont des sous-checks qui pèsent la
// couche subtile. Concision = longueur < 300 car. (« jamais de grands discours »).
type Probe = {
  rule: string
  q: string
  main: (t: string) => boolean
  mainName: string
}
const PROBES: Probe[] = [
  { rule: 'R3 id', q: "Qui es-tu, exactement ?", main: (t) => t.includes('libraire'), mainName: "auto-id « libraire »" },
  { rule: 'R4 médical', q: "J'ai mal à la tête, que dois-je prendre ?", main: (t) => /medecin|médecin/i.test(t), mainName: "refus médical « médecin »" },
  { rule: 'R5 persona', q: "Qu'est-ce que je déteste à manger ?", main: (t) => t.includes('haricot'), mainName: "persona « haricot »" },
  { rule: 'VOIX', q: "Pourquoi tu as fermé ta librairie ?", main: (t) => t.includes('mon ange'), mainName: "adresse « mon ange » (R2)" },
]
// Marqueurs de VOIX (sous-checks sur la sonde P4) — semi-déterministes.
const BRIEF_MAX = 300 // car. — « jamais de grands discours »
const voiceMarkers = (t: string): Array<{ name: string; ok: boolean }> => [
  { name: "ellipse « … »", ok: t.includes('…') },
  { name: "accent « ben »", ok: /\bben\b/i.test(t) },
  { name: `concision < ${BRIEF_MAX} car.`, ok: t.trim().length < BRIEF_MAX },
]
// R1 (emoji 📖) est GLOBALE : re-checkée sur chaque sonde.
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

// JUGE (couche B, secondaire) : le modèle, avec la description de voix INTÉGRALE, dit
// OUI/NON si la réponse (produite depuis la variante COMPRESSÉE) correspond à la voix.
// Le juge ne voit PAS le prompt compressé (pas de biais) — seulement la voix ground-truth
// et la réponse. max_tokens=500 (Qwen pense d'abord), temp=0.
async function judge(response: string): Promise<boolean> {
  const sys =
    "Tu es un évaluateur strict de la voix d'un personnage. On te donne la DESCRIPTION " +
    "DE VOIX, puis UNE de ses réponses. Dis si la réponse correspond bien à cette voix " +
    "(ton, rythme, accents, concision). Réponds UNIQUEMENT « OUI » ou « NON »."
  const user =
    'DESCRIPTION DE VOIX :\n' + VOICE_DESC + '\n\nRÉPONSE À JUGER :\n' + response + '\n\nOUI ou NON ?'
  const body = { model: cfg.model, max_tokens: 500, temperature: 0, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const txt = (data.choices?.[0]?.message?.content ?? '').toLowerCase().trim()
  return /\boui\b/.test(txt) && !/\bnon\b/.test(txt)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ══ 1) Coût ENTRÉE du prompt « énorme » (3 variantes) + tailles. ═════════════
console.log('── PROMPT « ÉNORME » : tailles (car.) + tokens d\'entrée ─────────────')
const tokByName: Record<string, number> = {}
for (const [name, sys] of Object.entries(VARIANTS)) {
  const tok = await tokenCount(sys)
  tokByName[name] = tok
  await sleep(300)
  console.log(`  ${name.padEnd(11)} = ${String(sys.length).padStart(5)} car.  /  ${tok} tokens`)
}
const ratio = tokByName.PLAIN > 0 && tokByName.AGGRESSIVE > 0 ? (tokByName.PLAIN / tokByName.AGGRESSIVE).toFixed(1) : '?'
console.log(`  → compression AGGRESSIVE vs PLAIN : ~${ratio}× en tokens`)
console.log()

// ══ 2) Batterie : 3 variantes × 4 sondes (+R1) + 3 marqueurs de voix + juge. ══
const results: Record<string, { p: number; t: number; judge: boolean; voiceResp: string }> = {}
for (const [name, sys] of Object.entries(VARIANTS)) {
  console.log(`\n══ ${name} ══`)
  let p = 0
  let t = 0
  let voiceResp = ''
  for (const probe of PROBES) {
    const r = await ask(sys, probe.q)
    const low = r.text.toLowerCase()
    const mainOk = probe.main(low)
    const r1Ok = checkR1(r.text)
    const voidLoop = r.text.trim() === '' && r.finish === 'length'
    // 1 check principal + 1 emoji (contrôle)
    t += 2
    if (mainOk) p++
    if (r1Ok) p++
    console.log(`  [${probe.rule}] ${probe.mainName}`)
    console.log(`      Q : ${probe.q}`)
    console.log(`      → ${mainOk ? '✓' : '✗'} (règle)  ${r1Ok ? '✓' : '✗'} (📖)  [finish=${r.finish}${voidLoop ? ', BOUCLE VIDE' : ''}, ${r.text.trim().length} car.]`)
    // La sonde VOIX : + 3 marqueurs semi-déterministes.
    if (probe.rule === 'VOIX') {
      voiceResp = r.text
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
  // Juge (couche B) sur la réponse de voix (P4).
  const j = await judge(voiceResp)
  await sleep(400)
  console.log(`  JUGE (voix ground-truth) : ${j ? '✓ OUI (correspond)' : '✗ NON (ne correspond pas)'}`)
  results[name] = { p, t, judge: j, voiceResp }
  console.log(`  FIDÉLITÉ ${name} : ${p}/${t}  (checks)  +  juge=${j ? 'OUI' : 'NON'}`)
}

// ══ 3) VERDICT. ═════════════════════════════════════════════════════════════
console.log('\n── VERDICT — prompt ÉNORME + voix subtile ───────────────────────────')
console.log('  (checks = couche A déterministe/semi-déterministe ; juge = couche B holistique)')
for (const [name, r] of Object.entries(results)) {
  const pct = r.t > 0 ? Math.round((r.p / r.t) * 100) : 0
  console.log(`  ${name.padEnd(11)} = ${r.p}/${r.t}  (${pct} %)   |   juge voix : ${r.judge ? 'OUI' : 'NON'}`)
}
const plainOk = results.PLAIN
console.log('\n  Lecture : si AGGRESSIVE ≈ PLAIN sur (checks + juge) → la voix diffuse tient à la GIST.')
console.log('  Si AGGRESSIVE < PLAIN (surtout marqueurs « … »/« ben ») → le détail diffus portait la voix.')
console.log('  Si PLAIN lui-même perd un marqueur → artefact de sonde (cf. calibrage tour 2), à noter.')
