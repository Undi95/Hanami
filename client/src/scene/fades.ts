// ════════════════════════════════════════════════════════════════════════════
// LES FONDUS — la table de correspondance avec la machine à états d'Overte.
//
// Nos fondus étaient UNIFORMES : 0,3 / 0,4 / 0,5 s, linéaires, quelle que soit
// la jonction. Overte, lui, donne une durée PAR TRANSITION, et une courbe : le
// graphe livré dans `vrma/transitions.json` (extrait de
// `interface/resources/avatar/avatar-animation.json`, Apache-2.0) porte pour
// chaque état son `interpDuration` — en IMAGES à 30 im/s — et son `easingType`.
//
// Ce fichier est la TABLE, et rien d'autre : un nom, une durée, une courbe, et
// l'état d'Overte d'où le chiffre vient. `devtools/anim-lab/verif-fondus.mjs`
// relit `transitions.json` et vérifie chaque ligne — la table ne peut donc pas
// dériver de sa source en silence.
//
// DEUX FAMILLES, et c'est le vrai enseignement de la lecture du graphe :
//   • EXPRESSION (repos, parole, gestes, pivots, arrêts, assise) — fondus LONGS
//     et adoucis (`easeInOutQuad`). Overte l'écrit explicitement sur ces états.
//   • LOCOMOTION (entrer dans un cycle de marche) — fondus COURTS et LINÉAIRES.
//     `WALKFWD`, `idleToWalkFwd`, les pas de côté, les décollages et les
//     réceptions n'ont AUCUN `easingType` : ils prennent le défaut, linéaire.
// Mesuré au banc (devtools/anim-lab/banc-fondus.mjs) : adoucir une entrée de
// cycle de marche est un CONTRESENS — l'à-coup ne bouge pas (il vient du clip,
// pas du fondu) et la pointe de vitesse monte d'un tiers. Overte a raison.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Un fondu : sa durée et sa courbe. La courbe ne touche QUE le poids ; la
 * vitesse de lecture des clips n'est jamais modifiée (c'est aussi la règle
 * d'Overte — `AnimUtil.h`, `easingFuncs`).
 */
export interface Fade {
  /** Durée, en secondes. 0 = bascule immédiate. */
  readonly s: number
  /** true = `easeInOutQuad` d'Overte ; false = linéaire (son défaut). */
  readonly ease: boolean
}

/**
 * L'adoucissement d'Overte, à la formule près (`AnimUtil.cpp`, `easeInOutQuad`) :
 *   α < 0,5 → 2α² ;  sinon → −2α² + 4α − 1.
 * Dérivée NULLE aux deux bouts : c'est ce qui supprime la marche de vitesse au
 * début et à la fin du fondu — l'à-coup. En contrepartie la pente culmine à 2/T
 * au lieu de 1/T, d'où des durées plus longues que les nôtres : à durée doublée,
 * la pointe est la même et la marche a disparu.
 */
export function easeInOutQuad(a: number): number {
  return a < 0.5 ? 2 * a * a : -2 * a * a + 4 * a - 1
}

/** Poids appliqué à l'avancement `p` (0→1) d'un fondu. */
export function fadeCurve(fade: Fade, p: number): number {
  return fade.ease ? easeInOutQuad(p) : p
}

/** Conversion de la source : Overte compte ses fondus en images, à 30 im/s. */
const im = (images: number, ease: boolean): Fade => ({ s: Math.round((images / 30) * 1000) / 1000, ease })

/** Bascule immédiate. Le seul fondu qui n'en est pas un. */
export const NO_FADE: Fade = { s: 0, ease: false }

// ── Face à face ─────────────────────────────────────────────────────────────

/**
 * Socle ↔ socle : repos ↔ parole ↔ écoute ↔ posture. C'est l'`idleTalkOverlay`
 * d'Overte (machine `idle`, 25 im), l'exact pendant DEBOUT du `seatedTalkOverlay`
 * dont on avait déjà porté la durée pour l'assise (cf. SIT_TALK).
 *
 * L'écoute (famille `rb-`) N'A PAS d'équivalent Overte — Overte n'a aucun clip
 * d'écoute. Elle passe par le même appel (`syncBase`) et prend donc la même
 * durée que la parole, ce qui est cohérent avec ses voisines : mesuré, le
 * meilleur réglage pour `rb-idle → rb-listen` est justement là (saut 88 °/s,
 * moyenne 36, contre 100 / 60 à 0,5 s linéaire).
 *
 * Banc, pire paire de variantes : saut 217 → 89 °/s (moyenne 142 → 53),
 * pointe 378 → 341.
 */
export const BASE_SWAP: Fade = im(25, true)

/**
 * Entrée d'un geste d'émotion. Overte : `reactionPositive`, `reactionNegative`,
 * `reactionRaiseHand`, `reactionApplaud` — 18 im, `easeInOutQuad`. (Son
 * `reactionPoint` est plus court, 10 im, mais aucun rôle de face à face ne
 * pointe chez nous.)
 *
 * LA RÉPONSE RESTE IMMÉDIATE : l'expression du visage part dès le tag
 * (`setEmotion` écrit avant `playGesture`), et le clip du geste démarre à son
 * image 0 quoi qu'il arrive — le fondu ne règle que sa MONTÉE. Overte fait
 * exactement pareil (`interpTarget` = 18 : la cible est lue en direct pendant
 * le fondu). Le corps atteint la moitié de son poids à 0,30 s au lieu de 0,15.
 *
 * Banc : le maximum ne bouge pas (744 °/s — c'est l'à-coup PROPRE de `happy-6`,
 * qu'aucun fondu ne peut retirer), la moyenne passe de 215 à 146 °/s.
 */
export const GESTURE_IN: Fade = im(18, true)

/**
 * Retour d'un geste au socle. Overte : les cinq réactions rendent l'écran à
 * `idleTalkOverlay`, dont l'entrée vaut 25 im, `easeInOutQuad`.
 * Banc : saut 80 → 10 °/s (moyenne 53 → 10), pointe 80 → 76.
 */
export const GESTURE_OUT: Fade = im(25, true)

// ── Scène vivante — pivots ──────────────────────────────────────────────────

/**
 * Entrée d'un pivot sur place. Overte : `turnLeft` / `turnRight`, 15 im,
 * `easeInOutQuad`. La PHASE d'entrée, elle, ne bouge pas — c'est un contrat de
 * raccord mesuré (cf. TURN_ENTER_*_S dans wander.ts), pas un réglage de fondu.
 * Banc : saut 110 → 95 °/s à gauche (pointe 167 → 154), 105 → 74 à droite
 * (pointe 172 → 160). 95 et 74 sont l'à-coup propre des deux clips : on est au
 * plancher.
 */
export const TURN_IN: Fade = im(15, true)

/**
 * Sortie d'un pivot. Overte : le retour se fait vers l'état `idle`, dont
 * l'entrée vaut 20 im, `easeInOutQuad`.
 *
 * C'est la valeur que le commentaire de TURN_FADE_OUT visait sans pouvoir la
 * prendre : « 0,5 s est la fourchette basse d'Overte (turns 0,5 ; entrée d'idle
 * 0,667 — avec easeInOutQuad, que nous n'avons pas : un fondu linéaire plus long
 * étale davantage, on reste donc au bas de la fourchette) ». L'easing est là,
 * la fourchette haute peut être prise.
 *
 * Banc : pivot → idle, saut 59 → 46 °/s (moyenne 55 → 36), pointe 155 → 160.
 * Pivot → départ de marche, saut 265 → 218 (pointe 292 → 252).
 */
export const TURN_OUT: Fade = im(20, true)

// ── Scène vivante — marche ──────────────────────────────────────────────────

/**
 * Entrée dans le clip de DÉPART (`world-walk-start`). Overte : `idleToWalkFwd`,
 * 8 im — et LINÉAIRE, comme toute sa locomotion.
 *
 * Plus court que nos 0,4 s : le personnage part 0,13 s plus tôt, et ça ne coûte
 * rien. Banc : saut 347 → 351 °/s, pointe 350 → 353 — c'est-à-dire l'à-coup
 * propre de `world-walk-start` (351 °/s au pied, mesuré clip seul) dans les deux
 * cas. Allonger le fondu ferait baisser ce chiffre (250 à 0,5 s, 127 à 1 s) mais
 * en ÉTOUFFANT le lever de pied : ce n'est pas de la fluidité, c'est de la
 * mollesse. Overte l'a laissé court et sec.
 */
export const WALK_START_IN: Fade = im(8, false)

/**
 * Entrée DIRECTE dans un cycle de marche, sans clip de départ — c'est le cas de
 * la flânerie (`world-walk-slow`, dont le raccord depuis l'idle est meilleur que
 * via `world-walk-start`). Overte : `WALKFWD`, 15 im, LINÉAIRE.
 * Banc : saut 140 → 112 °/s, pointe 176 → 152. L'adoucir ferait monter la
 * pointe à 222 pour un saut identique — refusé, et Overte est du même avis.
 */
export const WALK_CYCLE_IN: Fade = im(15, false)

/**
 * Entrée d'un arrêt long. Overte : `idleSettle`, 15 im, `easeInOutQuad`.
 * La PHASE de sortie du cycle reste le contrat de `vrma/world.json` (exitS).
 * Banc : depuis `world-walk`, saut 131 → 108 °/s (pointe 279 → 249) ; depuis la
 * flânerie, saut 182 → 65 (pointe 203 → 249 — la pointe monte d'un quart, sur
 * une jambe qui marchait déjà à 250-280 °/s : c'est le prix de l'à-coup divisé
 * par trois, et il se paie sur un corps qui ralentit, pas qui claque).
 */
export const STOP_IN: Fade = im(15, true)

/**
 * Entrée de l'arrêt COURT — celui des coins d'itinéraire. Overte a exactement
 * la même distinction : `idleSettleSmall`, 10 im, `easeInOutQuad`, contre 15 im
 * pour le tirage long.
 * Banc : saut 129 → 96 °/s, pointe 281 → 252.
 */
export const STOP_SMALL_IN: Fade = im(10, true)

/**
 * Fin d'un arrêt (ou d'un lever d'assise) → socle debout. Overte : l'état `idle`,
 * 20 im, `easeInOutQuad`.
 *
 * C'est LA jonction qui gagne le plus. Elle partait de 0,2 s linéaire, la plus
 * courte de toute la scène, sur une pose FIGÉE par `clampWhenFinished` : le
 * corps repartait d'un coup.
 * Banc : `world-walk-stop` → idle, saut 191 → 11 °/s (moyenne 111 → 8),
 * pointe 192 → 111. `world-sit-exit` → idle, saut 495 → 15 (moyenne 453 → 14),
 * pointe 495 → 290.
 */
export const STOP_OUT: Fade = im(20, true)

// ── Scène vivante — assise ──────────────────────────────────────────────────

/**
 * Entrée des transitions d'assise (`world-sit-enter`, `world-sit-exit`).
 * PAS D'ÉQUIVALENT OVERTE : Overte ne s'assoit pas, il se téléporte sur un
 * siège (`seated`, 6 im). Les deux clips sont des Quaternius (CC0), les seuls du
 * domaine monde 3D qui ne viennent pas d'Overte.
 *
 * On prend donc la durée de ses VOISINES d'expression — entrée de pivot et
 * entrée d'arrêt valent toutes deux 15 im — et la mesure la confirme :
 * idle → `sit-enter`, saut 289 → 180 °/s à pointe INCHANGÉE (402) ;
 * `sit-idle` → `sit-exit`, saut 381 → 272 (272 est l'à-coup propre du clip :
 * on est au plancher) à pointe inchangée (585 → 580).
 */
export const SIT_IN: Fade = { s: 0.5, ease: true }

/**
 * Atterrissage d'assise : fin de `world-sit-enter` → la variante de
 * `world-sit-idle` que le tirage a choisie. La durée était DÉJÀ celle d'Overte
 * (`seatedIdle01`–`05`, 30 im) ; il manquait sa courbe.
 * Banc : saut 92 → 14 °/s (moyenne 41 → 8) ; pointe 92 → 181, sur un corps qui
 * se pose — la moitié du fondu est plus lente qu'avant, l'autre plus rapide, et
 * c'est la marche de 92 °/s à l'instant du raccord qui disparaît.
 */
export const SIT_LAND: Fade = im(30, true)

/**
 * Bascule assise `sit-idle` ↔ `sit-talking`. La durée avait déjà été mesurée et
 * posée à 0,8 s en visant `seatedTalkOverlay` (25 im = 0,833) : on prend
 * maintenant le chiffre exact et sa courbe.
 * Banc : saut 184 → 184 °/s (c'est l'à-coup propre de `world-sit-talking`, 281
 * clip seul), mais la MOYENNE passe de 134 à 83 et la pointe ne bouge pas (485).
 */
export const SIT_TALK: Fade = im(25, true)

/**
 * Entrée d'un geste assis (émotion, clic, ou bougeotte) par le canal `once`.
 * Overte : `seatedReactionPositive` & consorts, 12 im, `easeInOutQuad` — soit
 * très exactement la durée que nous avions déjà.
 *
 * Overte donne une entrée BIEN plus longue à sa bougeotte assise (`seatedFidget`,
 * 30 im). Nous gardons celle des réactions pour les deux, parce que notre canal
 * assis ne distingue pas les deux rôles et que les entrées de `sit-look` /
 * `sit-shift` sont déjà mesurées à 1,7–2,4 cm : il n'y a rien à rattraper.
 * Banc : saut inchangé (538 °/s — l'à-coup propre de `world-sit-clap`),
 * moyenne 248 → 215.
 */
export const SIT_GESTURE_IN: Fade = im(12, true)

/**
 * Retour d'un geste assis au socle. Overte : les réactions assises rendent
 * l'écran à `seatedTalkOverlay`, 25 im, `easeInOutQuad`. C'était le même 0,4 s
 * que l'entrée — un fondu d'entrée n'a pourtant aucune raison de valoir un
 * fondu de sortie.
 * Banc : saut 230 → 9 °/s (moyenne 102 → 5), pointe 231 → 216.
 */
export const SIT_GESTURE_OUT: Fade = im(25, true)

// ── Divers ──────────────────────────────────────────────────────────────────

/**
 * Retour au point d'accueil (extinction de la scène vivante, changement de
 * décor). Ce n'est pas une transition d'Overte : c'est une remise à zéro. On
 * garde la durée d'avant, adoucie comme le reste de l'expression.
 */
export const HOME_OUT: Fade = { s: 0.25, ease: true }
