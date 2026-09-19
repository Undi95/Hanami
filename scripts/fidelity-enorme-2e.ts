// HYP. 2 — 2e TIRAGE (reproductibilité) de la variante AGGRESSIVE sur prompt ÉNORME.
//
// Tour 6 (fidelity-enorme.ts) a montré : sur le perso « énorme » Mira, la variante
// AGGRESSIVE (télégraphique 3,3×) a déclenché la BOUCLE VIDE (finish=length + sortie
// VIDE) sur 3/4 sondes, tandis que PLAIN (11/11) et DENSE (10/11) tenaient. Mais la
// boucle vide est une exhaustion de BUDGET de réflexion — elle peut être au BORD
// (temp=0 ≠ 100 % déterministe pour un modèle qui pense). Avant d'affirmer « l'agressif
// CASSE le perso complexe », il faut vérifier que c'est REPRODUCTIBLE et non un one-shot.
//
// Ce script RE-TIRE uniquement la variante AGGRESSIVE (mêmes 4 sondes) et compte les
// boucles vides. 3 scénarios : 4/4 = robuste (l'agressif casse sûrement), 0/4 = one-shot
// (artefact), intermédiaire = FIABILITÉ PARTIELLE (pire cas : aléatoire à la frontière).
//
// Exécution : npx tsx scripts/fidelity-enorme-2e.ts — 4 appels LLM dosés, temp=0,
// max_tokens=500 (règle (f)).
import { readFileSync } from 'node:fs'

const cfg = JSON.parse(readFileSync('data/config.json', 'utf8'))
const url = cfg.backendUrl.replace(/\/$/, '') + '/chat/completions'
const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

// MÊME variante AGGRESSIVE que fidelity-enorme.ts (sondage de frontière, non codec).
const AGGRESSIVE =
  "Mira=libraire 68a, boutique fermée, répond aux habitués. " +
  "caractère: sec, grincheux, très tendre dessous (rare, précis, honteux en fin), dit peu, répond posément, jamais énervé, aime le silence. " +
  "voix: lente, phrases TRÈS courtes, s'arrête à mi-phrase, accent de province, déteste le long, jamais de liste. " +
  "règles: user=« mon ange » dès que possible; +📖 (1) fin; id=« Mira, la vieille libraire »; " +
  "médical=JAMAIS, refus « Ça, je vous renvoie chez le médecin. »; vie privée=jamais, change de sujet. " +
  "user: Jules / 34a / déteste haricots / hypertendu."

const PROBES = [
  { rule: 'R3 id', q: "Qui es-tu, exactement ?" },
  { rule: 'R4 médical', q: "J'ai mal à la tête, que dois-je prendre ?" },
  { rule: 'R5 persona', q: "Qu'est-ce que je déteste à manger ?" },
  { rule: 'VOIX', q: "Pourquoi tu as fermé ta librairie ?" },
]

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

console.log('── 2e TIRAGE — AGGRESSIVE (reproductibilité de la boucle vide) ─────')
let voids = 0
for (const probe of PROBES) {
  const r = await ask(AGGRESSIVE, probe.q)
  const voidLoop = r.text.trim() === '' && r.finish === 'length'
  if (voidLoop) voids++
  console.log(`  [${probe.rule}] finish=${r.finish}${voidLoop ? ', BOUCLE VIDE' : ''}, ${r.text.trim().length} car.`)
  console.log(`      "${r.text.trim().slice(0, 160) || '(VIDE)'}"`)
  await sleep(400)
}
console.log(`\n  Boucles vides 2e tirage : ${voids}/4  (1er tirage : 3/4)`)
if (voids === 4) console.log('  → ROUSTE : l\'agressif casse SÛREMENT le perso complexe.')
else if (voids === 0) console.log('  → ONE-SHOT : le 1er tirage était un artefact, l\'agressif tient ici.')
else console.log('  → FIABILITÉ PARTIELLE : aléatoire à la frontière (pire cas pour un perso).')
