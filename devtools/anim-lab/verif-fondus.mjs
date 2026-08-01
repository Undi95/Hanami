// ════════════════════════════════════════════════════════════════════════════
// verif-fondus.mjs — LA TABLE DES FONDUS NE PEUT PAS DÉRIVER EN SILENCE.
//
// `client/src/scene/fades.ts` dit, en commentaire, d'où vient chaque durée :
// tel état de la machine à états d'Overte. Un commentaire ne se vérifie pas
// tout seul. Ce script le fait :
//
//   1. chaque fondu déclaré ci-dessous est comparé à l'état correspondant de
//      `vrma/transitions.json` — durée ET courbe ;
//   2. les fondus qui n'ont PAS d'équivalent Overte sont listés explicitement,
//      avec la raison : on ne peut pas en ajouter un par distraction ;
//   3. le miroir de `mesures.mjs` (que la page du banc importe, sans
//      TypeScript) est comparé à la table elle-même.
//
// Lecture seule. Sort en code 1 à la moindre divergence.
//
//   node verif-fondus.mjs
// ════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const LAB = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.slice(1))))
const PROJET = process.env.HANAMI_ROOT || path.resolve(LAB, '..', '..')
const F = await import(pathToFileURL(path.join(PROJET, 'client/src/scene/fades.ts')).href)
const M = await import('./mesures.mjs')
const G = JSON.parse(fs.readFileSync(path.join(PROJET, 'vrma/transitions.json'), 'utf8'))

/** Constante de fades.ts → l'état d'Overte dont elle tient sa durée. */
const SOURCE = {
  BASE_SWAP: ['idle', 'idleTalkOverlay'],
  GESTURE_IN: ['idle', 'reactionPositive'],
  GESTURE_OUT: ['idle', 'idleTalkOverlay'],
  TURN_IN: ['mainStateMachine', 'turnLeft'],
  TURN_OUT: ['mainStateMachine', 'idle'],
  WALK_START_IN: ['mainStateMachine', 'idleToWalkFwd'],
  WALK_CYCLE_IN: ['mainStateMachine', 'WALKFWD'],
  STOP_IN: ['mainStateMachine', 'idleSettle'],
  STOP_SMALL_IN: ['mainStateMachine', 'idleSettleSmall'],
  STOP_OUT: ['mainStateMachine', 'idle'],
  SIT_LAND: ['masterSeatedIdleRand', 'seatedIdle01'],
  SIT_TALK: ['seatedSM', 'seatedTalkOverlay'],
  SIT_GESTURE_IN: ['seatedSM', 'seatedReactionPositive'],
  SIT_GESTURE_OUT: ['seatedSM', 'seatedTalkOverlay'],
}

/** Ceux qui n'ont PAS d'équivalent Overte, et pourquoi. */
const SANS_SOURCE = {
  NO_FADE: 'la bascule immédiate — ce n’est pas un fondu',
  SIT_IN: 'Overte ne s’assoit pas, il se téléporte sur un siège (`seated`, 6 im) ; ' +
    'nos deux clips d’assise sont des Quaternius. Durée prise sur les voisines ' +
    'd’expression (entrée de pivot et entrée d’arrêt valent 15 im).',
  HOME_OUT: 'le retour au point d’accueil est une remise à zéro, pas une transition',
}

const etatDe = (machineId, etatId) => {
  const m = Object.values(G.machines).find((x) => x.id === machineId)
  if (!m) return null
  return (m.etats ?? []).find((e) => e.id === etatId) ?? null
}

let ko = 0
const dit = (ok, txt) => { if (!ok) ko++; console.log(`  ${ok ? '✓' : '✗'} ${txt}`) }

console.log('\n── 1. la table contre vrma/transitions.json ──')
for (const [cle, [machine, etat]] of Object.entries(SOURCE)) {
  const f = F[cle]
  if (!f) { dit(false, `${cle} : absent de fades.ts`); continue }
  const st = etatDe(machine, etat)
  if (!st) { dit(false, `${cle} : état ${machine}/${etat} introuvable dans le graphe`); continue }
  const dureeOk = Math.abs(f.s - st.fonduEntrantS) < 0.0006
  const adouci = st.lissage === 'easeInOutQuad'
  const courbeOk = f.ease === adouci
  dit(
    dureeOk && courbeOk,
    `${cle.padEnd(16)} ${String(f.s).padEnd(6)} ${f.ease ? 'adouci ' : 'linéaire'} ` +
      `← ${machine}/${etat} : ${st.fonduEntrantS}s (${st.fonduEntrantImages} im), ${st.lissage}`,
  )
}

console.log('\n── 2. les fondus sans équivalent Overte ──')
const attendus = new Set([...Object.keys(SOURCE), ...Object.keys(SANS_SOURCE)])
for (const [cle, pourquoi] of Object.entries(SANS_SOURCE)) {
  const f = F[cle]
  dit(f !== undefined, `${cle.padEnd(16)} ${f ? String(f.s) + 's' : '(absent)'} — ${pourquoi}`)
}
for (const [cle, v] of Object.entries(F)) {
  if (typeof v !== 'object' || v === null || typeof v.s !== 'number') continue
  if (!attendus.has(cle)) dit(false, `${cle} : fondu NON DÉCLARÉ ici — dire d'où vient sa durée`)
}

console.log('\n── 3. le miroir de mesures.mjs (importé par la page du banc) ──')
dit(M.GESTURE_FADE === F.GESTURE_IN.s, `GESTURE_FADE ${M.GESTURE_FADE} = GESTURE_IN ${F.GESTURE_IN.s}`)
dit(M.GESTURE_RETURN === F.GESTURE_OUT.s, `GESTURE_RETURN ${M.GESTURE_RETURN} = GESTURE_OUT ${F.GESTURE_OUT.s}`)
dit(M.BASE_FADE === F.BASE_SWAP.s, `BASE_FADE ${M.BASE_FADE} = BASE_SWAP ${F.BASE_SWAP.s}`)
dit(
  M.FONDUS_ADOUCIS === (F.GESTURE_IN.ease && F.GESTURE_OUT.ease && F.BASE_SWAP.ease),
  `FONDUS_ADOUCIS ${M.FONDUS_ADOUCIS} = la courbe des trois fondus de face à face`,
)
// La courbe elle-même, pas seulement son drapeau : deux implémentations, une
// seule formule.
const memeCourbe = [0, 0.1, 0.25, 0.4999, 0.5, 0.75, 1].every(
  (p) => Math.abs(M.easeInOutQuad(p) - F.easeInOutQuad(p)) < 1e-12,
)
dit(memeCourbe, 'easeInOutQuad : mesures.mjs et fades.ts donnent la même courbe')

console.log(`\n${ko === 0 ? 'tout concorde.' : `${ko} divergence(s).`}`)
process.exit(ko === 0 ? 0 : 1)
