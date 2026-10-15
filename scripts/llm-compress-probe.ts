// Sonde : le TRONCAGE du LLM-compresseur sur famille.md (le fichier le plus dense)
// est-il un problème de BUDGET (max_tokens), ou un échec fondamental du LLM ?
//
// llm-verify.ts (tour 3) a montré : famille.md (700 car, le plus dense) → le LLM
// tronque à « Chat : Mochi, mâle, 3 ans, stéril » (mots coupés = cut dur), le
// vérifieur REJETTE → repli denseEncode. travail/sante (plus courts) → OK.
// Hypothèse : le modèle « pense » d'abord (Qwen3.8), consomme le budget, et il ne
// reste rien pour la sortie → si on LARGES le budget (max_tokens ↑), la sortie
// devrait être COMPLÈTE et passer le vérifieur.
//
// La compression est un coût AMORTI (une fois, réutilisé N fois) → un max_tokens
// plus haut sur cet appel est justifié, contrairement aux appels de chat.
//
// Exécution : npx tsx scripts/llm-compress-probe.ts — 2 appels LLM dosés.
import { readFileSync } from 'node:fs'
import { verifyFacts } from '../research/verifier'

const cfg = JSON.parse(readFileSync('data/config.json', 'utf8'))
const url = cfg.backendUrl.replace(/\/$/, '') + '/chat/completions'
const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

const FAMILLE =
  "Mon chat s'appelle Mochi, c'est un mâle de 3 ans, stérilisé depuis l'année dernière.\n" +
  "Ma sœur Anaïs vit à Lyon, et je la vois surtout les étés.\n" +
  "Mon frère Tom est ingénieur et habite à Nantes, il a deux enfants : Léa qui a 8 ans et Hugo qui a 5 ans.\n" +
  "Notre mère s'appelle Claire, elle habite à Bordeaux et elle a 74 ans.\n" +
  "Notre père est décédé en 2022, mais on continue de fêter son anniversaire.\n" +
  "Les anniversaires : maman le 12 juin, papa le 30 août, Anaïs le 21 février, Tom le 9 mai.\n" +
  "On se réunit pour le déjeuner du dimanche chez maman quand tout le monde peut venir."

const COMPRESS_SYS =
  "Tu es un compresseur de mémoire pour LLM. Densifie le texte pour réduire les " +
  "tokens SANS perdre un seul fait. RÈGLES STRICTES :\n" +
  "1. GARDER EXACTEMENT chaque fait : mêmes chiffres, mêmes noms propres (majuscules), " +
  "mêmes villes, mêmes adresses, mêmes dates.\n" +
  "2. NE JAMAIS réécrire ni abréviger un chiffre ni un nom (interdit : « Bdx », « TT »).\n" +
  "3. SUPPRIMER la prose : verbes être/avoir, articles, « s'appelle », « qui a », " +
  "connecteurs, reformulations, répétitions.\n" +
  "4. UNE LIGNE par fait, format télégraphique LISIBLE.\n" +
  "Réponds UNIQUEMENT avec le texte densifié — aucun commentaire, aucune introduction, " +
  "pas de guillemets."

async function compress(content: string, max_tokens: number) {
  const body = {
    model: cfg.model,
    max_tokens,
    temperature: 0,
    messages: [
      { role: 'system', content: COMPRESS_SYS },
      { role: 'user', content },
    ],
  }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return {
    text: (data.choices?.[0]?.message?.content ?? '').trim(),
    finish: data.choices?.[0]?.finish_reason ?? '?',
    out: data.usage?.completion_tokens ?? -1,
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

for (const mt of [500, 2000]) {
  const r = await compress(FAMILLE, mt)
  const v = verifyFacts(FAMILLE, r.text)
  console.log(`\n══ max_tokens=${mt} ══  [finish=${r.finish}, sortie=${r.out} tok]`)
  console.log(r.text.split('\n').map((l: string) => `  | ${l}`).join('\n'))
  const missing = [...v.missingNumbers, ...v.missingEntities]
  console.log(`  vérifieur : ok=${v.ok}${v.ok ? '' : `  (manque : ${JSON.stringify(missing)})`}`)
  await sleep(500)
}

console.log('\n→ si 2000 passe le vérifieur et 500 non : le troncage est un BUDGET, ' +
  'fixé par un max_tokens plus haut (coût amorti).')
