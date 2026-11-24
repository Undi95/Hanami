// Passage de la main du tour autonome à l'utilisateur.
//
// Un backend local ne sert qu'une génération à la fois : tant qu'un tour
// autonome se joue, une demande de l'utilisateur attendrait derrière lui. Le
// moteur des tours (lib/autonomous.ts) surveille bien le fichier de la
// conversation, mais à la seconde près, et seulement lui — et quand il lâche
// enfin, la réponse à l'utilisateur est déjà en construction : elle ne voit pas
// au journal le tour qui vient d'être abandonné.
//
// Ce petit module est le fil direct entre les deux, sans que l'un importe
// l'autre : le moteur y déclare le tour qu'il joue ; toute route qui va appeler
// le modèle POUR l'utilisateur (chat, compaction, rangement et compression de la
// mémoire) y demande la main d'abord, et attend que le tour soit clos et noté.

interface RunningTurn {
  /** Abandonne le tour, tout de suite. */
  abort: () => void
  /** Se résout quand le tour est fini ET inscrit au journal des tours. */
  done: Promise<void>
}

let current: RunningTurn | null = null

/** Le moteur déclare le tour autonome qu'il joue. */
export function declareRunningTurn(turn: RunningTurn): void {
  current = turn
}

/** Le moteur retire SON tour (un autre a pu être déclaré entre-temps : il n'y touche pas). */
export function clearRunningTurn(turn: RunningTurn): void {
  if (current === turn) current = null
}

/**
 * L'utilisateur passe avant : abandonne le tour autonome en cours, s'il y en a
 * un, et attend qu'il soit clos et noté. Sans tour en cours, rend la main
 * aussitôt. Ne lève jamais.
 */
export async function yieldToUser(): Promise<void> {
  const turn = current
  if (!turn) return
  turn.abort()
  await turn.done.catch(() => {
    /* un tour qui finit mal reste un tour fini */
  })
}
