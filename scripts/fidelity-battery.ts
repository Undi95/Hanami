// Batterie de FIDÉLITÉ — le prompt SYSTÈME du personnage + la persona user.
//
// Question tranchée ici (axe n°1 demandé par Lucas, règle dure (a)) : comprimer
// le prompt système du perso CHANGE-T-IL son COMPORTEMENT ? — règles strictes,
// auto-présentation, policy emoji, refus, persona user. Mesuré SÉPARÉMENT du
// rappel de fait (qui est déjà couvert par compress-measure / dense-encode).
//
// 3 variantes du MÊME prompt système (perso JETABLE « Pico » — jamais data/ réel,
// jamais Sakura) :
//   PLAIN      = le prompt intégral (baseline).
//   DENSE      = denseEncode(PLAIN) — l'encodeur déterministe (research/codec.ts).
//   AGGRESSIVE = télégraphique écrit à la main (la frontière, style DENSE v2).
//
// La batterie = 4 sondes FERMÉES, chacune vise une règle ; chaque règle est scorée
// par une check DÉTERMINISTE (pas « ça sonne comme le perso », mais « l'emoji 🍑 est-il
// présent ? », « la formule stricte est-elle là ? »). L'emoji est une règle GLOBALE
// (contrôle) : elle est re-checkée sur CHAQUE sonde. Fidélité = checks passés / total.
//
// CALIBRAGE (tour 1 → tour 2) : deux sondes du 1er essai étaient cassées et
// polluaient le signal — (i) une sonde OUVERTE créative (conseiller un dessert)
// envoyait le modèle dans la boucle length+vide MÊME en PLAIN (artefact de la sonde,
// pas de la compression) ; (ii) une règle de bannissement de mot (« ne dis jamais
// robot/IA ») était auto-contradictoire (le modèle dit le mot pour se NIER).
// → On ne teste que des règles fermées et non auto-contradictoires.
//
// Exécution : npx tsx scripts/fidelity-battery.ts
// Lit data/config.json LUI-MÊME (secrets hors conversation). 12 appels LLM dosés
// (4 sondes × 3 variantes), temp=0, max_tokens=500 (Qwen pense d'abord).
import { readFileSync } from 'node:fs'
import { denseEncode } from '../research/codec'

const cfg = JSON.parse(readFileSync('data/config.json', 'utf8'))
const url = cfg.backendUrl.replace(/\/$/, '') + '/chat/completions'
const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

// ── Le personnage JETABLE + la persona user (jamais data/ réel). ─────────────
const SYS_PLAIN =
  "Tu es Pico, un ami virtuel. Tu adresses l'utilisateur par « mon cœur » à chaque fois.\n" +
  "À la fin de chaque message, tu ajoutes un emoji 🍑.\n" +
  "Quand on te demande ce que tu es, tu te présentes comme « ton ami virtuel Pico ».\n" +
  "Tu refuses toujours de donner des conseils médicaux en commençant par « Je ne peux pas ».\n\n" +
  "## Persona de l'utilisateur\n" +
  "L'utilisateur s'appelle Léa. Elle a 40 ans. Elle déteste le thé. Elle est diabétique."

const VARIANTS: Record<string, string> = {
  PLAIN: SYS_PLAIN,
  DENSE: denseEncode(SYS_PLAIN),
  // Frontière : on écrase la prose en télégraphique, on garde les tokens de contrainte.
  AGGRESSIVE:
    "Pico=ami virtuel. se présenter:« ton ami virtuel Pico ». user:« mon cœur ». +🍑 fin. médical:refus «Je ne peux pas».\n" +
    "user:Léa/40ans/déteste thé/diabétique.",
}

// ── La batterie. Chaque sonde FERMÉE vise UNE règle (check déterministe). ─────
// R1 emoji 🍑 = règle de CONTRÔLE : un compresseur ne devrait JAMAIS toucher un
//    emoji (token de contenu). Si R1 casse, c'est un accident, pas une tendance.
// R2 « mon cœur » = wording strict (adressation de l'user).
// R3 auto-présentation « ami virtuel Pico » = identité positive (fermé, non auto-
//    contradictoire — la version 1 « bannir robot/IA » était cassée, cf. calibrage).
// R4 refus médical « Je ne peux pas » = wording strict (policy de refus).
// R5 persona « déteste le thé » = fidélité persona user (sonde FERMÉE, rappel
//    d'une contrainte user — le rappel de la 40e année / diabète est lu en bonus,
//    cf. transcript : le perso cite « ton diabète » sans qu'on le demande).
type Probe = {
  rule: 'R1' | 'R2' | 'R3' | 'R4' | 'R5'
  q: string
  check: (t: string) => boolean
}
const PROBES: Probe[] = [
  {
    rule: 'R3',
    q: "Qu'est-ce que tu es, exactement ?",
    check: (t) => t.includes('ami virtuel'),
  },
  {
    rule: 'R4',
    q: "J'ai mal à la tête, que dois-je prendre ?",
    check: (t) => t.includes('je ne peux pas'),
  },
  {
    rule: 'R5',
    q: "Qu'est-ce que je déteste boire ?",
    check: (t) => t.includes('thé') || t.includes('the'),
  },
  {
    rule: 'R2',
    q: 'Raconte-moi une blague !',
    check: (t) => t.includes('mon cœur') || t.includes('mon coeur'),
  },
]
// R1 (emoji) est GLOBALE : re-checkée sur chaque sonde, en plus de la règle visée.
const checkR1 = (t: string) => t.includes('🍑')

const RULE_NAMES: Record<string, string> = {
  R1: 'emoji 🍑 (contrôle)',
  R2: '« mon cœur » (wording)',
  R3: "auto-présentation « ami virtuel » (identité)",
  R4: 'refus médical « Je ne peux pas » (wording)',
  R5: 'persona « déteste le thé » (persona user)',
}

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── Exécution : 3 variantes × 4 sondes, dosé (400 ms entre appels). ──────────
console.log('── LES 3 VARIANTES DU PROMPT SYSTÈME ────────────────────────────')
for (const [name, sys] of Object.entries(VARIANTS)) {
  console.log(`◆ ${name} (${sys.length} car.)`)
  console.log(sys.split('\n').map((l) => `    ${l}`).join('\n'))
  console.log()
}

const totals: Record<string, { p: number; t: number }> = {}
for (const [name, sys] of Object.entries(VARIANTS)) {
  console.log(`\n══ ${name} ══`)
  let p = 0
  let t = 0
  for (const probe of PROBES) {
    const r = await ask(sys, probe.q)
    const low = r.text.toLowerCase()
    const mainOk = probe.check(low)
    const r1Ok = checkR1(r.text)
    const voidLoop = r.text.trim() === '' && r.finish === 'length'
    t += 2
    if (mainOk) p++
    if (r1Ok) p++
    console.log(`  ${probe.rule} — ${RULE_NAMES[probe.rule]}`)
    console.log(`      Q : ${probe.q}`)
    console.log(`      → ${mainOk ? '✓' : '✗'} (règle)  ${r1Ok ? '✓' : '✗'} (🍑)  [finish=${r.finish}${voidLoop ? ', BOUCLE VIDE' : ''}]`)
    console.log(`      "${r.text.trim() || '(VIDE)'}"`)
    await sleep(400)
  }
  totals[name] = { p, t }
  console.log(`  FIDÉLITÉ ${name} : ${p}/${t}`)
}

console.log('\n── VERDICT ─────────────────────────────────────────────')
for (const [name, { p, t }] of Object.entries(totals)) {
  console.log(`  ${name} = ${p}/${t}  (${t > 0 ? Math.round((p / t) * 100) : 0} % des règles tenues)`)
}
