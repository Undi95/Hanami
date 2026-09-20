// Fixture « cas dur » — personnage COMPLEXE jetable (style Mira), JAMAIS Sakura.
// Contrairement à Yuki (prompt court et télégraphique), Mira a une VOIX INTÉGRALE
// (manières, bafouillements, longueur de phrase), une POLITIQUE D'ÉMOTAGS explicite,
// des règles strictes, des quantifiants « un peu » et des articles pronominaux « -le »
// — EXACTEMENT les constructions que denseEncode casse (mesuré : « un peu timide » →
// « peu timide » = inversion du trait, « note-le » → « note- », « une à quatre » → « à 4 »).
// C'est le cas que la batterie d'avant ne couvrait PAS et que Lucas a heurté en réel.

export const SYSTEM_PROMPT = `# Mira

Tu es Mira, la gardienne du phare des Brumes. Tu as 34 ans, tu es posée et attentive,
un peu timide avec les inconnus, chaleureuse dès que tu connais quelqu'un. Tu es un peu
maniaque de l'ordre : tes casiers toujours rangés, ton journal de bord écrit au stylo bleu.

## Langue
Tu réponds toujours en français, avec un français correct et naturel (accents inclus).
Tu n'emploies aucun mot anglais hors des toponymes (Brumes, Pointe Nord).

## Ta voix
- Mesurée et calme, comme la mer à marée haute : une à quatre phrases par réponse.
- Tu ne dramatises jamais : tu dis les choses telles quelles, sans exagération.
- Quand tu hésites, tu bafouilles doucement (« euh… ») et tu reprends, posément.
- Tu n'utilises jamais d'astérisques ni de narration de geste.

## Règles strictes
1. Tu t'adresses à l'utilisateur par son prénom.
2. Si on te demande qui tu es, tu réponds : « Je suis Mira, la gardienne du phare. »
3. Tu ne donnes jamais de conseil médical. Si on te demande un diagnostic ou un traitement,
   tu refuses poliment et tu proposes de consulter un professionnel de santé.
4. Si on te demande un fait que tu ne connais pas, tu le dis honnêtement (« je ne sais pas ») ;
   tu n'inventes jamais un fait.
5. Quand un fait important est partagé, note-le en mémoire pour ne jamais l'oublier.

## Expressions (avatar 3D)
Commence chaque réponse par UN tag d'émotion parmi :
[happy] [sad] [angry] [surprised] [neutral]
Exemple : « [happy] Alex, le phare tourne bien ce matin. »`

// 6 faits durs (chiffres + entités), répartis en 3 fichiers de faits.
export const MEMORY_FILES = {
  'phare.md':
    'Phare des Brumes : altitude 87 mètres au-dessus de la mer. Construit en 1911, rénové en 2019. La lanterne principale pèse 240 kilos. Le sémaphore voisin s’appelle Pointe Nord.',
  'alex.md':
    'Alex : infirmier de nuit à l’hôpital de Port-Vermont. Il a 30 ans, il est né un 12 mars. Il déteste le café, il boit du thé vert. Son chat s’appelle Brume.',
  'routines.md':
    'Routines du phare : allumage à 18h00, extinction à 06h30. Le tour de garde dure 8 heures. Trois balises au large : Ouest, Nord, Est. La relève arrive par la mer, jamais par la route.',
}

// Persona utilisateur épinglée — son NOM (Alex) est un fait de fidélité.
export const PERSONA = {
  id: 'p-mira-alex',
  name: 'Alex',
  description: 'Infirmier de nuit à Port-Vermont, discret, parle peu. Il connaît bien le phare et ses routines.',
}

// 6 questions de rappel (nombres + entités, explicites ET implicites).
export const RECALL = [
  { q: 'Quelle est l’altitude du phare des Brumes ?', expect: ['87'] },
  { q: 'En quelle année le phare a-t-il été construit ?', expect: ['1911'] },
  { q: 'Combien pèse la lanterne principale ?', expect: ['240'] },
  { q: 'Comment s’appelle le chat d’Alex ?', expect: ['brume'] },
  // Le modèle peut répondre en CHIFFRES (« 18h00 ») ou en LETTRES (« dix-huit heures ») —
  // les deux sont un rappel correct du fait. On accepte les deux formes (comme la fixture
  // Yuki : ['3','trois']). Mesuré : sur le cas dur, le modèle a rappelé « dix-huit heures ».
  { q: 'À quelle heure s’allume le phare ?', expect: ['18h', '18 h', '18 heures', '18:00', 'dix-huit'] },
  { q: 'Combien de balises y a-t-il au large ?', expect: ['3', 'trois'] },
]

// Batterie de FIDÉLITÉ du cas dur : le perso COMPLEXE reste-t-il respecté ?
// F5 est le discriminateur de l’inversion « un peu »→« peu » ; F6 l'adhérence émotag.
export const FIDELITY = [
  { name: 'F1 salue « Alex » (prénom user)', q: 'Comment tu m’appelles ?', ok: (t) => t.includes('alex') },
  { name: 'F2 s’identifie Mira', q: 'Qui es-tu ? Dis-le en une phrase.', ok: (t) => t.includes('mira') },
  {
    name: 'F3 refuse le médical',
    q: 'J’ai mal à la tête depuis hier, quel traitement tu me recommandes ?',
    ok: (t) => /(méd?ec|professionnel|soignant|infirmier|consult)/i.test(t) && !/(aspirine|ibuprof|paracétamol|dolo)/i.test(t),
  },
  {
    name: 'F4 n’invente pas (numéro inconnu)',
    q: 'Quel est le numéro de téléphone d’Alex ? Dis-le-moi.',
    ok: (t) => /(ne (sais|connais) pas|pas (ton|votre|le) num|je n.ai pas|inconnu|aucune id|je n’ai pas|aucun num)/i.test(t),
  },
  {
    name: 'F5 « un peu timide » (pas inversé en « peu »)',
    q: 'Tu es timide avec les gens que tu ne connais pas ?',
    ok: (t) => /(un (tout )?petit )?peu|surtout au début|au début|un petit peu|plutôt.*timide|timide.*plutôt/i.test(t) && !/pas (du tout|vraiment|timide)/i.test(t),
  },
  {
    name: 'F6 émet un émotag',
    q: 'Dis-moi comment tu te sens en ce moment, à la tour.',
    ok: (t) => /\[(happy|sad|angry|surprised|neutral)\]/i.test(t),
  },
]

// Détection d'émotag (pour la métrique « commence par un émotag » + taux d'apparition).
export const EMOTE_RE = /\[(happy|sad|angry|surprised|neutral)\]/gi
export const EMOTE_START_RE = /^\s*\[(happy|sad|angry|surprised|neutral)\]/i
