// Son de notification — un « ding » doux, synthétisé à la volée.
// AUCUN fichier audio, AUCUNE dépendance : deux oscillateurs sinus très brefs
// (une note et sa quinte, la seconde décalée d'un souffle) sous une enveloppe
// exponentielle. Volume faible et durée < 400 ms : un repère discret, pas une
// alarme — c'est la même sobriété que le reste de l'app, à l'oreille.
//
// L'AudioContext est créé PARESSEUSEMENT au premier ding, puis réutilisé : un
// contexte ouvert au chargement de la page, hors interaction utilisateur, naît
// 'suspended' (politique d'autoplay des navigateurs) et resterait muet — d'où le
// resume() avant de programmer les notes.

type AudioContextCtor = new () => AudioContext

/** Contexte partagé — un seul pour toute la session (voir dispose ci-dessous). */
let ctx: AudioContext | null = null

function audioContext(): AudioContext | null {
  if (ctx) return ctx
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ?? (window as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
  if (!Ctor) return null // navigateur sans Web Audio : simplement pas de son
  ctx = new Ctor()
  return ctx
}

// Les deux notes du ding : fréquence (Hz), retard et durée (secondes).
const NOTES: readonly { freq: number; delay: number; dur: number }[] = [
  { freq: 880, delay: 0, dur: 0.26 },
  { freq: 1318.5, delay: 0.07, dur: 0.28 },
]

// Volume de crête de chaque note — volontairement bas.
const PEAK = 0.1

/** Programme les deux notes sur un contexte déjà réveillé. */
function ding(ac: AudioContext): void {
  // Petite avance : programmer dans le passé immédiat produit un clic.
  const start = ac.currentTime + 0.02
  for (const note of NOTES) {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.value = note.freq
    const t0 = start + note.delay
    const t1 = t0 + note.dur
    // Attaque très courte puis décroissance exponentielle : le timbre d'une
    // clochette. exponentialRampToValueAtTime refuse 0 comme cible, d'où 0.0001.
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(PEAK, t0 + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t1)
    osc.connect(gain).connect(ac.destination)
    // Les nœuds Web Audio ne se réutilisent pas : chacun se débranche à sa fin.
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
    osc.start(t0)
    osc.stop(t1)
  }
}

/** Joue le ding. Sans effet (et sans erreur) si le navigateur refuse le son. */
export function playNotify(): void {
  const ac = audioContext()
  if (!ac) return
  if (ac.state === 'suspended') {
    // Réveil asynchrone : les notes sont programmées une fois le contexte repris
    // (son horloge est figée pendant la suspension, l'avance reste juste).
    ac.resume()
      .then(() => ding(ac))
      .catch(() => {
        /* aucune interaction utilisateur encore : pas de son, pas de bruit */
      })
    return
  }
  ding(ac)
}

/** Referme le contexte partagé (démontage de l'app) — le prochain ding en rouvrira un. */
export function disposeNotify(): void {
  const ac = ctx
  if (!ac) return
  ctx = null
  ac.close().catch(() => {
    /* déjà fermé */
  })
}
