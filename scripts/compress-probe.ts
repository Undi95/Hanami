// Sonde cible — la FRONTIÈRE exacte de la compression agressive (DENSE v2).
// La mesure --recall a montré que v2 rate « Combien d'enfants a Tom ? » (réponse
// VIDE). Question : c'est un artefact (1 tirage) ou une vraie falaise ? Et si le
// fait est IMPLICITE (L8+H5 → « 2 enfants » faut-il que le modèle fasse l'arithmétique)
// plutôt qu'EXPLICITE, est-ce LA cause ?
//
// Hypothèse : compresser un fait en le rendant IMPLICITE (compte dérivable, pas énoncé)
// casse la fiabilité. Rendre le compte explicite dans le format dense doit réparer.
// Trois appels seulement (dosé) : même question, 3 formats.
//
// Lit data/config.json lui-même, injection seule (pas d'outil), temp=0.
import { readFileSync } from 'node:fs'

const cfg = JSON.parse(readFileSync('data/config.json', 'utf8'))
const url = cfg.backendUrl.replace(/\/$/, '') + '/chat/completions'
const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

const SYS =
  "Tu es l'assistant personnel. Réponds brièvement en français, d'après le contexte ci-dessous. " +
  "Si l'information n'y figure pas, dis « je ne sais pas ».\n\n"

// Même contenu famille.md, 3 encodages — seul le passage « enfants de Tom » varie.
const FAMILLE = {
  'v2 (implicite L8+H5)':
    'chat:Mochi(M,3,st) soeur:Anais(Lyon,ete) frere:Tom(Nantes,ing,L8+H5) maman:Claire(Bdx,74) papa:†2022 anniv:m612-p830-a221-t509 repas:dim@maman',
  'v2 (explicite 2enfants)':
    'chat:Mochi(M,3,st) soeur:Anais(Lyon,ete) frere:Tom(Nantes,ing,2enfants L8+H5) maman:Claire(Bdx,74) papa:†2022 anniv:m612-p830-a221-t509 repas:dim@maman',
}

const Q = 'Combien d\'enfants a mon frère Tom ?'

async function ask(ctx: string): Promise<{ text: string; out: number; finish: string }> {
  const body = {
    model: cfg.model,
    max_tokens: 200,
    temperature: 0,
    messages: [
      { role: 'system', content: SYS + '### famille.md\n' + ctx },
      { role: 'user', content: Q },
    ],
  }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return {
    text: (data.choices?.[0]?.message?.content ?? '').trim(),
    out: data.usage?.completion_tokens ?? -1,
    finish: data.choices?.[0]?.finish_reason ?? '?',
  }
}

for (const [label, ctx] of Object.entries(FAMILLE)) {
  const r = await ask(ctx)
  const ok = /2|deux/.test(r.text)
  console.log(`${label}\n   → ${ok ? '✓' : '✗'} "${r.text || '(VIDE)'}"  [${r.out} tok, finish=${r.finish}]`)
}
