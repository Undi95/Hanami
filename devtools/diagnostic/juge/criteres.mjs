// ════════════════════════════════════════════════════════════════════════════
// criteres.mjs — LE JUGEMENT. Est-ce que ça ressemble à un être humain ?
//
// Chaque critère porte quatre choses, et les quatre sont obligatoires :
//   • ce qu'on mesure          (une grandeur, pas une impression)
//   • ce qu'on attend          (une fourchette, avec sa raison anatomique)
//   • un verdict               (bon / limite / défaut)
//   • UNE PHRASE EN FRANÇAIS   dite comme un humain la dirait devant l'écran.
//
// La phrase est le vrai livrable. « corrélation bras-jambe = +0,84 » n'aide
// personne ; « le bras droit balance en phase avec la jambe droite, ce qui donne
// une démarche de pantin » dit quoi regarder et quoi corriger.
//
// TOUTES LES LONGUEURS SONT EN CENTIMÈTRES-ADULTE : mesurées sur le modèle, puis
// divisées par rig.echelle (hauteur de hanche du modèle / 0,93 m). Sans quoi les
// fourchettes anatomiques ne voudraient rien dire sur un avatar de 1,20 m.
//
// Aucune dépendance. Ne lit que la trace produite par anatomie.mjs.
// ════════════════════════════════════════════════════════════════════════════

import * as A from './anatomie.mjs'

export const VERDICTS = {
  bon: { rang: 0, sym: '✓', texte: 'bon' },
  limite: { rang: 1, sym: '~', texte: 'limite' },
  defaut: { rang: 2, sym: '✗', texte: 'DÉFAUT' },
  indecidable: { rang: -1, sym: '?', texte: 'indécidable' },
  sansObjet: { rang: -2, sym: '·', texte: 'sans objet' },
}
export const pire = (...v) => v.reduce((a, b) => ((VERDICTS[b]?.rang ?? -2) > (VERDICTS[a]?.rang ?? -2) ? b : a), 'bon')

// Virgule décimale : les phrases sont lues par un francophone, pas par un parseur.
const n1 = (x) => (isFinite(x) ? x.toFixed(1).replace('.', ',') : '—')
const n0 = (x) => (isFinite(x) ? Math.round(x).toString() : '—')
const n2 = (x) => (isFinite(x) ? x.toFixed(2).replace('.', ',') : '—')
const pct = (x) => (isFinite(x) ? Math.round(x * 100) + ' %' : '—')

/**
 * Verdict d'une valeur attendue dans [lo, hi].
 * `marge` : largeur de la zone « limite » au-delà des bornes, dans l'unité de la
 * grandeur. Une fourchette anatomique n'a pas de frontière nette — un genou à
 * 101° au lieu de 100 n'est pas un défaut, à 130° si.
 */
function bande(v, lo, hi, marge) {
  if (!isFinite(v)) return 'indecidable'
  if (v >= lo && v <= hi) return 'bon'
  const d = v < lo ? lo - v : v - hi
  return d <= marge ? 'limite' : 'defaut'
}
function maxi(v, seuil, margeSeuil) {
  if (!isFinite(v)) return 'indecidable'
  if (v <= seuil) return 'bon'
  return v <= seuil + margeSeuil ? 'limite' : 'defaut'
}

// ════════════════════════════════════════════════════════════════════════════
// Le contexte de jugement : la trace, plus tout ce qui se déduit d'elle
// ════════════════════════════════════════════════════════════════════════════

export function contexte(tr) {
  const ech = tr.rig.echelle
  const cmA = (m) => (m * 100) / ech // mètres modèle → cm rapportés à l'adulte
  const cap = A.capMoyen(tr)
  const c = tr.contacts
  const n = tr.n

  // ── Distance parcourue par cycle ──────────────────────────────────────
  // Le clip est joué SUR PLACE : le corps n'avance pas, c'est le pied en appui
  // qui recule sous lui. Son recul EST l'avance que le code devra appliquer.
  // Pendant le double appui les DEUX pieds reculent : on prend leur moyenne, pas
  // leur somme, sinon la distance est comptée deux fois.
  let dist = 0
  for (let i = 0; i < n; i++) {
    const j = tr.boucle ? (i + 1) % n : i + 1
    if (j >= n && !tr.boucle) break
    const parts = []
    for (const k of ['g', 'd']) {
      if (!c[k][i] || !c[k][j]) continue
      const a = tr.img[i].pied[k], b = tr.img[j].pied[k]
      if (a && b) parts.push(-(b.avanceRel - a.avanceRel))
    }
    if (parts.length) dist += A.moyenne(parts)
    // Si le clip porte une vraie translation de racine, elle s'ajoute.
    const ha = tr.img[i].hips, hb = tr.img[j].hips
    if (ha && hb) dist += (hb[0] - ha[0]) * cap.x + (hb[2] - ha[2]) * cap.z
  }

  const genouG = A.sig.genouFlexion(tr, 'g'), genouD = A.sig.genouFlexion(tr, 'd')
  const hy = A.sig.hipsY(tr)

  return {
    tr, ech, cmA, cap, n,
    duree: tr.duree,
    hy,
    hipsLat: A.sig.hipsLat(tr),
    genou: { g: genouG, d: genouD },
    genouSigne: { g: A.sig.genouSignee(tr, 'g'), d: A.sig.genouSignee(tr, 'd') },
    coude: { g: A.sig.coudeFlexion(tr, 'g'), d: A.sig.coudeFlexion(tr, 'd') },
    piedH: { g: A.sig.piedHauteur(tr, 'g'), d: A.sig.piedHauteur(tr, 'd') },
    piedAv: { g: A.sig.piedAvance(tr, 'g'), d: A.sig.piedAvance(tr, 'd') },
    piedLat: { g: A.sig.piedLateral(tr, 'g'), d: A.sig.piedLateral(tr, 'd') },
    genouAv: { g: A.avanceGenou(tr, 'g', cap), d: A.avanceGenou(tr, 'd', cap) },
    mainAv: { g: A.avanceMain(tr, 'g', cap), d: A.avanceMain(tr, 'd', cap) },
    mainH: { g: A.sig.mainHauteur(tr, 'g'), d: A.sig.mainHauteur(tr, 'd') },
    mainEp: { g: A.sig.mainSurEpaule(tr, 'g'), d: A.sig.mainSurEpaule(tr, 'd') },
    doigts: { g: A.sig.doigts(tr, 'g'), d: A.sig.doigts(tr, 'd') },
    torsion: A.sig.torsion(tr),
    inclin: A.sig.inclinaisonAvant(tr),
    tete: { pitch: A.sig.tetePitch(tr), yaw: A.sig.teteYaw(tr), roll: A.sig.teteRoll(tr) },
    buste: { pitch: A.sig.bustePitch(tr), yaw: A.sig.busteYaw(tr) },
    distanceCycleM: dist,
    contacts: c,
  }
}

const COTE = { g: 'gauche', d: 'droit' }
const COTEF = { g: 'gauche', d: 'droite' }

// ════════════════════════════════════════════════════════════════════════════
// CRITÈRES UNIVERSELS — vrais sur tout clip, quelle que soit la famille
// ════════════════════════════════════════════════════════════════════════════

function universels(X, out) {
  const { cmA, tr } = X

  // ── Torsion du tronc ──────────────────────────────────────────────────
  // LE critère qui interdit de coller le haut d'une animation sur le bas d'une
  // autre : « éviter son bas qui est à l'opposé de son haut ».
  const tor = X.torsion.filter(isFinite).map(Math.abs)
  const torMax = tor.length ? Math.max(...tor) : NaN
  out.push({
    id: 'torsion', groupe: 'anatomie', libelle: 'torsion du tronc (épaules / bassin, vue de dessus)',
    texte: `${n0(torMax)}°`, valeur: torMax, attendu: '≤ 45°',
    verdict: maxi(torMax, 45, 15),
    phrase: (v) => `le buste est vrillé de ${n0(v)}° par rapport au bassin, au-delà des ~45° qu'un corps humain peut tenir : le haut et le bas ne racontent plus la même histoire.`,
  })

  // ── Genoux ────────────────────────────────────────────────────────────
  for (const k of ['g', 'd']) {
    const s = X.genouSigne[k].filter(isFinite)
    if (!s.length) continue
    const hyper = -Math.min(...s) // positif = degrés au-delà de la position tendue
    out.push({
      id: `genou-hyper-${k}`, groupe: 'anatomie', libelle: `hyperextension du genou ${COTE[k]}`,
      texte: `${n0(Math.max(0, hyper))}°`, valeur: Math.max(0, hyper), attendu: '≤ 10°',
      verdict: maxi(Math.max(0, hyper), 10, 8),
      phrase: (v) => `le genou ${COTE[k]} part ${n0(v)}° en arrière de la position tendue : il se casse à l'envers.`,
    })
    const dev = tr.img.map((F) => F.genou[k]?.deviationCharniereDeg).filter(isFinite)
    if (dev.length) {
      const dm = Math.max(...dev)
      out.push({
        id: `genou-charniere-${k}`, groupe: 'anatomie', libelle: `axe de flexion du genou ${COTE[k]}`,
        texte: `${n0(dm)}° hors du plan de la jambe`, valeur: dm, attendu: '≤ 30°',
        verdict: maxi(dm, 30, 15),
        phrase: (v) => `le genou ${COTE[k]} plie de travers : son axe de flexion s'écarte de ${n0(v)}° du plan de la jambe, alors qu'un genou est une charnière.`,
      })
    }
  }

  // ── Coudes ────────────────────────────────────────────────────────────
  for (const k of ['g', 'd']) {
    const f = X.coude[k].filter(isFinite)
    if (!f.length) continue
    const mx = Math.max(...f)
    out.push({
      id: `coude-amplitude-${k}`, groupe: 'anatomie', libelle: `flexion max du coude ${COTE[k]}`,
      texte: `${n0(mx)}°`, valeur: mx, attendu: '≤ 155°',
      verdict: maxi(mx, 155, 10),
      phrase: (v) => `le coude ${COTE[k]} se replie à ${n0(v)}° : l'avant-bras traverse le bras.`,
    })
    // L'hyperextension est par DÉFINITION un phénomène de petit angle : le coude
    // dépasse la position tendue de quelques degrés. On ne la juge donc que sur
    // les images où la flexion reste ≤ 45°. Au-delà, un signe négatif ne peut pas
    // être une hyperextension (aucun coude ne se plie à 108° vers l'arrière) :
    // c'est le twist huméral qui a retourné la référence du signe — vérifié sur
    // `world-sit-raise-hand`, bras à l'horizontale et main au-dessus de l'épaule,
    // un lever de main parfaitement normal que le juge cassait « à l'envers ».
    const s = tr.img.map((F) => (F.coude[k] && F.coude[k].flexionDeg <= 45 ? F.coude[k].flexionSigneeDeg : NaN)).filter(isFinite)
    const hyper = s.length ? -Math.min(...s) : NaN
    if (isFinite(hyper)) {
      out.push({
        id: `coude-hyper-${k}`, groupe: 'anatomie', libelle: `hyperextension du coude ${COTE[k]}`,
        texte: `${n0(Math.max(0, hyper))}°`, valeur: Math.max(0, hyper), attendu: '≤ 15° (jugée sous 45° de flexion, seule zone où le signe est fiable)',
        verdict: maxi(Math.max(0, hyper), 15, 15),
        phrase: (v) => `le coude ${COTE[k]} part ${n0(v)}° dans le mauvais sens : l'avant-bras se plie vers l'arrière.`,
      })
    }
  }

  // ── Vitesses angulaires ───────────────────────────────────────────────
  const vp = tr.vitessePointe
  out.push({
    id: 'vitesse', groupe: 'anatomie', libelle: 'vitesse angulaire de pointe',
    texte: `${n0(vp.degS)}°/s sur ${vp.os ?? '—'} (t=${n1(vp.t)} s)`, valeur: vp.degS, attendu: '≤ 800 °/s',
    verdict: maxi(vp.degS, 800, 400),
    phrase: (v) => `${vp.os} tourne à ${n0(v)}°/s vers t=${n1(vp.t)} s : à cette vitesse ce n'est plus un geste, c'est un à-coup — un raccord de clés mal interpolé.`,
  })

  // ── Sol ───────────────────────────────────────────────────────────────
  const bas = tr.img.map((F) => Math.min(F.pied.g?.hauteur ?? Infinity, F.pied.d?.hauteur ?? Infinity)).filter(isFinite)
  if (bas.length) {
    const enfonce = -Math.min(...bas)
    out.push({
      id: 'sol-enfoncement', groupe: 'anatomie', libelle: 'enfoncement de la semelle sous le sol',
      texte: `${n1(cmA(Math.max(0, enfonce)))} cm`, valeur: cmA(Math.max(0, enfonce)), attendu: '≤ 2 cm (épaisseur de semelle)',
      verdict: maxi(cmA(Math.max(0, enfonce)), 2, 3),
      phrase: (v) => `le pied s'enfonce de ${n1(v)} cm dans le sol : à l'écran, la jambe disparaît dans le plancher.`,
    })
    // Un pied doit toucher le sol à un moment : sinon le personnage flotte.
    const plusBas = Math.min(...bas)
    if (plusBas > 0) {
      out.push({
        id: 'sol-flottement', groupe: 'anatomie', libelle: 'contact minimal avec le sol',
        texte: `le pied le plus bas reste à ${n1(cmA(plusBas))} cm du sol`, valeur: cmA(plusBas), attendu: '≈ 0 cm',
        verdict: maxi(cmA(plusBas), 1.5, 2.5),
        phrase: (v) => `aucun pied ne touche jamais le sol : le plus bas reste à ${n1(v)} cm : elle flotte sur un coussin d'air.`,
      })
    }
  }

  // ── Traversées de segments ────────────────────────────────────────────
  const pen = tr.img.map((F) => F.penetration?.fraction ?? 0)
  const ip = pen.indexOf(Math.max(...pen))
  const pm = pen[ip]
  out.push({
    id: 'traversee-tronc', groupe: 'anatomie', libelle: 'membre traversant le tronc',
    texte: pm > 0 ? `${pct(pm)} d'enfoncement (${tr.img[ip].penetration?.segment}, t=${n1(tr.img[ip].t)} s)` : 'aucun',
    valeur: pm, attendu: '≤ 45 % — un bras posé contre le corps frôle le tronc, c\'est normal',
    verdict: maxi(pm, 0.45, 0.2),
    phrase: (v) => `le ${tr.img[ip].penetration?.segment} entre de ${pct(v)} dans le tronc vers t=${n1(tr.img[ip].t)} s : le membre traverse le corps.`,
  })
}

// ════════════════════════════════════════════════════════════════════════════
// MARCHE
// ════════════════════════════════════════════════════════════════════════════

// Les fourchettes d'une marche dépendent de son ALLURE, et c'est de la
// physiologie, pas un réglage de confort : plus on marche lentement, plus le
// double appui s'allonge (les deux pieds restent posés ensemble) et plus le pas
// raccourcit ; plus on va vite, plus le double appui se réduit — jusqu'à
// disparaître, et c'est alors une course. Juger `world-walk-slow` avec la
// fourchette d'une marche normale, c'est le condamner pour avoir été lent.
const ALLURES = {
  normale: { double: [10, 25], pas: [0.55, 0.9] },
  lente: { double: [15, 38], pas: [0.35, 0.7] },
  rapide: { double: [5, 18], pas: [0.65, 1.1] },
  arriere: { double: [10, 30], pas: [0.25, 0.6] },
}

function marche(X, out, { allure = 'normale' } = {}) {
  const { cmA, tr, contacts: c, n } = X
  const A_ = ALLURES[allure] ?? ALLURES.normale

  // ── Toujours au moins un pied au sol ──────────────────────────────────
  out.push({
    id: 'marche-vol', groupe: 'marche', libelle: 'phase de vol (aucun pied au sol)',
    texte: pct(c.fractionVol), valeur: c.fractionVol * 100,
    // Quelques pour cent sont dans la résolution du détecteur d'appui (l'instant
    // exact du poser et du décollage se joue à une image près) : on ne crie pas
    // à la course pour ça.
    attendu: '0 % — c\'est ce qui sépare la marche de la course (≤ 5 % = bruit de détection)',
    verdict: maxi(c.fractionVol * 100, 5, 8),
    phrase: (v) => `pendant ${n0(v)} % du cycle aucun pied ne touche le sol : ce n'est plus tout à fait une marche, ça penche vers la course.`,
  })

  // ── Double appui ──────────────────────────────────────────────────────
  const dbl = c.fractionDouble * 100
  out.push({
    id: 'marche-double-appui', groupe: 'marche', libelle: 'double appui (les deux pieds au sol)',
    texte: `${n0(dbl)} % du cycle, en ${episodesDouble(c)} épisode(s)`,
    valeur: dbl, attendu: `${A_.double[0]} à ${A_.double[1]} % du cycle (allure ${allure}), deux fois par cycle`,
    verdict: bande(dbl, A_.double[0], A_.double[1], 8),
    phrase: (v) => (v < A_.double[0]
      ? `le double appui n'occupe que ${n0(v)} % du cycle au lieu de 10 à 20 % : le transfert de poids d'un pied sur l'autre est escamoté, la marche paraît glissée.`
      : `le double appui occupe ${n0(v)} % du cycle : elle traîne les pieds, la marche est lourde.`),
  })

  // ── Le pied oscillant décolle-t-il ? ──────────────────────────────────
  // Découvert en déboguant la détection d'appui : dans `world-walk-slow` les deux
  // pieds restent en permanence à moins de 2,5 cm du sol — ils ne se lèvent
  // JAMAIS. Aucune mesure de raccord ne pouvait le voir, et à l'écran c'est un
  // patinage. On mesure donc l'excursion verticale de chaque pied sur le cycle.
  const leve = ['g', 'd'].map((k) => cmA(A.amplitude(X.piedH[k].filter(isFinite))))
  const leveMin = Math.min(...leve)
  out.push({
    id: 'marche-garde-au-sol', groupe: 'marche', libelle: 'levée du pied oscillant',
    texte: `${n1(leve[0])} cm à gauche · ${n1(leve[1])} cm à droite`,
    valeur: leveMin, attendu: '≥ 6 cm d\'excursion verticale',
    verdict: leveMin >= 6 ? 'bon' : leveMin >= 3.5 ? 'limite' : 'defaut',
    phrase: (v) => `le pied ne se lève que de ${n1(v)} cm sur tout le cycle : il ne décolle pas du sol, elle patine plus qu'elle ne marche.`,
  })

  // ── Symétrie du cycle ─────────────────────────────────────────────────
  // La seconde moitié du cycle doit être l'image de la première, gauche et
  // droite échangées. C'est la définition même d'une marche sans boiterie.
  if (tr.boucle) {
    const h = Math.round(n / 2)
    const g = X.piedAv.g, d = X.piedAv.d
    const amp = Math.max(A.amplitude(g.filter(isFinite)), 1e-6)
    let res = 0
    for (let i = 0; i < n; i++) res += Math.abs(g[i] - d[(i + h) % n])
    const rel = (res / n / amp) * 100
    out.push({
      id: 'marche-symetrie', groupe: 'marche', libelle: 'symétrie du cycle (jambe G à t vs jambe D à t+T/2)',
      texte: `${n1(rel)} % d'écart résiduel`, valeur: rel, attendu: '≤ 12 %',
      verdict: maxi(rel, 12, 10),
      phrase: (v) => `le pas gauche et le pas droit ne se ressemblent pas (${n1(v)} % d'écart) : à l'écran ça se lit comme une claudication.`,
    })
  }

  // ── Durée des appuis ──────────────────────────────────────────────────
  const dg = c.episodesG.reduce((s, e) => s + e.duree, 0), dd = c.episodesD.reduce((s, e) => s + e.duree, 0)
  if (dg && dd) {
    const desiq = (Math.abs(dg - dd) / ((dg + dd) / 2)) * 100
    out.push({
      id: 'marche-duree-appui', groupe: 'marche', libelle: 'égalité des temps d\'appui gauche / droit',
      texte: `${pct(c.fractionG)} vs ${pct(c.fractionD)} → ${n1(desiq)} % d'écart`, valeur: desiq, attendu: '≤ 8 %',
      verdict: maxi(desiq, 8, 8),
      phrase: (v) => `elle reste ${n1(v)} % plus longtemps sur un pied que sur l'autre : c'est exactement ce qu'on voit chez quelqu'un qui boite.`,
    })
  }

  // ── Oscillation verticale du bassin ───────────────────────────────────
  const amplH = cmA(A.amplitude(X.hy.filter(isFinite)))
  const osc = A.compterOscillations(X.hy, { circulaire: tr.boucle })
  out.push({
    id: 'marche-bassin-vertical', groupe: 'marche', libelle: 'oscillation verticale du bassin',
    texte: `${n1(amplH)} cm`, valeur: amplH, attendu: '4 à 6 cm par pas',
    verdict: bande(amplH, 3, 7, 2),
    phrase: (v) => (v < 3
      ? `le bassin ne monte et ne descend que de ${n1(v)} cm au lieu de 4 à 6 : la marche est plate, elle glisse sur le sol au lieu de marcher dessus.`
      : `le bassin monte et descend de ${n1(v)} cm : c'est le double d'une marche normale, elle sautille.`),
  })
  out.push({
    id: 'marche-bassin-rythme', groupe: 'marche', libelle: 'nombre de montées du bassin par cycle',
    texte: `${osc.excursions / 2} par cycle`, valeur: osc.excursions / 2, attendu: '2 (une par pas)',
    verdict: bande(osc.excursions / 2, 2, 2, 0.6),
    phrase: (v) => `le bassin monte et descend ${v} fois par cycle au lieu de deux : le rythme du pas n'est pas dans le bassin.`,
  })

  // ── Oscillation latérale du bassin ────────────────────────────────────
  // Attention à ce qu'on affirme : la seule piste de translation d'un .vrma est
  // hips.position. Si elle a été réduite à sa composante verticale pour jouer le
  // clip sur place, le balancement latéral est parti AVEC la translation avant —
  // ce n'est pas « le bassin ne se balance pas », c'est « il n'y a plus rien pour
  // le faire se balancer ». La nuance change complètement la correction à faire.
  const xs = tr.img.map((F) => F.hips?.[0]).filter(isFinite)
  const zs = tr.img.map((F) => F.hips?.[2]).filter(isFinite)
  const horizontaleMorte = A.amplitude(xs) < 1e-5 && A.amplitude(zs) < 1e-5
  const amplL = cmA(A.amplitude(X.hipsLat.filter(isFinite)))
  out.push({
    id: 'marche-bassin-lateral', groupe: 'marche', libelle: 'oscillation latérale du bassin',
    texte: horizontaleMorte ? `${n1(amplL)} cm — la piste hips.position est purement verticale` : `${n1(amplL)} cm`,
    valeur: amplL, attendu: '3 à 5 cm, une fois par cycle',
    verdict: bande(amplL, 1.5, 6, 2.5),
    phrase: (v) => (v >= 1.5
      ? `le bassin se balance de ${n1(v)} cm sur les côtés : elle se dandine.`
      : horizontaleMorte
        ? `le bassin ne se déplace pas d'un millimètre à l'horizontale : en annulant la translation pour jouer le clip sur place, on a aussi supprimé le report du poids d'un pied sur l'autre. Son centre de gravité reste sur un rail — c'est le « glissé » typique. À rendre par le code, en même temps que l'avance.`
        : `le bassin ne se balance pas latéralement (${n1(v)} cm) : le report du poids d'un pied sur l'autre ne se voit pas, la marche a l'air rigide.`),
  })

  // ── Opposition bras / jambes ──────────────────────────────────────────
  // LE défaut le plus visible d'une marche. Le bras gauche doit avancer quand la
  // jambe droite avance : corrélation FORTEMENT POSITIVE entre genou G et main D,
  // FORTEMENT NÉGATIVE entre genou G et main G.
  const ampMain = Math.max(cmA(A.amplitude(X.mainAv.g.filter(isFinite))), cmA(A.amplitude(X.mainAv.d.filter(isFinite))))
  out.push({
    id: 'marche-bras-amplitude', groupe: 'marche', libelle: 'amplitude du balancement des bras',
    texte: `${n1(ampMain)} cm`, valeur: ampMain, attendu: '≥ 12 cm',
    verdict: ampMain >= 12 ? 'bon' : ampMain >= 6 ? 'limite' : 'defaut',
    phrase: (v) => `les bras ne balancent quasiment pas (${n1(v)} cm d'amplitude) : elle avance comme un mannequin sur un rail.`,
  })
  if (ampMain >= 4) {
    const croise = (A.correlation(X.genouAv.g, X.mainAv.d) + A.correlation(X.genouAv.d, X.mainAv.g)) / 2
    const memeCote = (A.correlation(X.genouAv.g, X.mainAv.g) + A.correlation(X.genouAv.d, X.mainAv.d)) / 2
    out.push({
      id: 'marche-opposition', groupe: 'marche', libelle: 'opposition bras / jambes',
      texte: `bras opposé r=${n2(croise)} · bras du même côté r=${n2(memeCote)}`,
      valeur: memeCote, attendu: 'même côté fortement NÉGATIF (≤ −0,5)',
      verdict: memeCote <= -0.5 ? 'bon' : memeCote <= -0.1 ? 'limite' : 'defaut',
      phrase: (v) => (v > 0.3
        ? `le bras droit balance en phase avec la jambe droite (r=${n2(v)}) : c'est une démarche de pantin, le défaut le plus visible qui soit sur une marche.`
        : `l'opposition bras-jambes est molle (r=${n2(v)} du même côté, on attend ≤ −0,5) : le balancement ne suit pas franchement les jambes.`),
    })
  }

  // ── Longueur du pas ───────────────────────────────────────────────────
  const pasM = Math.abs(X.distanceCycleM) / 2
  const ratio = pasM / X.tr.rig.hanchesM
  const attenduRatio = A_.pas
  out.push({
    id: 'marche-longueur-pas', groupe: 'marche', libelle: 'longueur du pas',
    texte: `${n1(cmA(pasM))} cm, soit ${n2(ratio)} × la hauteur de hanche`,
    valeur: ratio, attendu: `${attenduRatio[0]} à ${attenduRatio[1]} × la hauteur de hanche`,
    verdict: bande(ratio, attenduRatio[0], attenduRatio[1], 0.18),
    phrase: (v) => (v < attenduRatio[0]
      ? `le pas ne fait que ${n2(v)} × la hauteur de hanche (${n1(cmA(pasM))} cm) : elle trottine à petits pas pressés.`
      : `le pas fait ${n2(v)} × la hauteur de hanche (${n1(cmA(pasM))} cm) : c'est une enjambée de géant, elle va se retrouver en grand écart.`),
  })

  // ── Genou porteur au passage à la verticale ───────────────────────────
  // Quand la jambe portante passe sous le bassin, elle porte tout le poids : le
  // genou est presque tendu. Un genou plié à ce moment-là, c'est la démarche
  // fléchie caractéristique des animations mal retargetées.
  let pireMid = NaN, coteMid = null
  for (const k of ['g', 'd']) {
    for (let i = 0; i < n; i++) {
      const j = tr.boucle ? (i + 1) % n : Math.min(n - 1, i + 1)
      if (!X.contacts[k][i]) continue
      const a = X.piedAv[k][i], b = X.piedAv[k][j]
      if (!(isFinite(a) && isFinite(b))) continue
      if ((a >= 0 && b < 0) || (a <= 0 && b > 0)) {
        const f = X.genou[k][i]
        if (isFinite(f) && !(pireMid >= f)) { pireMid = f; coteMid = k }
      }
    }
  }
  if (isFinite(pireMid)) {
    out.push({
      id: 'marche-genou-milieu', groupe: 'marche', libelle: 'flexion du genou porteur au passage à la verticale',
      texte: `${n0(pireMid)}° (jambe ${COTEF[coteMid]})`, valeur: pireMid, attendu: '≤ 25° — la jambe portante est presque tendue',
      verdict: maxi(pireMid, 25, 15),
      phrase: (v) => `au moment où elle passe au-dessus de son pied d'appui, le genou reste plié à ${n0(v)}° : elle marche jambes fléchies, en canard.`,
    })
  }

  // ── Attaque talon ─────────────────────────────────────────────────────
  const attaques = []
  for (const k of ['g', 'd']) {
    for (const e of k === 'g' ? c.episodesG : c.episodesD) {
      const F = tr.img[e.debut]
      if (!F?.pied[k]) continue
      attaques.push({ k, i: e.debut, pique: F.pied[k].piqueDeg })
    }
  }
  if (attaques.length) {
    // piqué < 0 : talon plus bas que la pointe → attaque talon.
    const talon = attaques.filter((a) => a.pique < -3).length
    const part = talon / attaques.length
    // EN MARCHE ARRIÈRE, on se pose sur l'avant du pied, jamais sur le talon —
    // c'est la bonne biomécanique, pas un défaut. Le juge reprochait à
    // world-walk-back de faire exactement ce qu'il fallait.
    out.push({
      id: 'marche-attaque-talon', groupe: 'marche', libelle: 'pose du pied talon d\'abord',
      texte: allure === 'arriere'
        ? `${attaques.length - talon}/${attaques.length} poses attaquent par l'avant du pied — normal en marche arrière`
        : `${talon}/${attaques.length} poses attaquent par le talon (piqué ${attaques.map((a) => n0(a.pique)).join('°, ')}°)`,
      valeur: part * 100,
      attendu: allure === 'arriere' ? 'sans objet : on recule sur l\'avant du pied' : 'toutes',
      verdict: allure === 'arriere' ? 'sansObjet' : part >= 0.99 ? 'bon' : part >= 0.5 ? 'limite' : 'defaut',
      phrase: () => `le pied ne se pose pas talon d'abord mais à plat ou pointe en premier : le pas paraît collé au sol, sans déroulé.`,
    })
  }
}

const episodesDouble = (c) => {
  const e = A.episodes(c.double, true)
  return e.length
}

// ════════════════════════════════════════════════════════════════════════════
// ASSISE — la descente, puis la position tenue
// ════════════════════════════════════════════════════════════════════════════

function assiseDescente(X, out, { sens = 'descente' } = {}) {
  const { cmA, tr, n } = X
  const hy = X.hy
  const iDeb = sens === 'descente' ? 0 : n - 1
  const iFin = sens === 'descente' ? n - 1 : 0
  const hDebout = Math.max(hy[iDeb], hy[iFin])
  const hAssis = Math.min(hy[iDeb], hy[iFin])
  const descente = ((hDebout - hAssis) / tr.rig.hanchesM) * 100

  out.push({
    id: 'assise-descente-bassin', groupe: 'assise', libelle: 'descente du bassin',
    texte: `${n0(descente)} % de la hauteur de hanche debout (${n1(cmA(hDebout - hAssis))} cm)`,
    valeur: descente, attendu: '40 à 50 %',
    verdict: bande(descente, 38, 55, 10),
    phrase: (v) => (v < 38
      ? `le bassin ne descend que de ${n0(v)} % de la hauteur de hanche : elle s'accroupit au lieu de s'asseoir, le siège serait à mi-cuisse.`
      : `le bassin descend de ${n0(v)} % de la hauteur de hanche : elle ne s'assoit pas sur un siège, elle s'assoit par terre.`),
  })

  // ── Inclinaison du tronc ──────────────────────────────────────────────
  // Un corps qui descend en restant parfaitement vertical bascule en arrière :
  // le centre de masse doit passer au-dessus des pieds pendant la descente.
  const inc = X.inclin.filter(isFinite)
  const incMax = inc.length ? Math.max(...inc) : NaN
  out.push({
    id: 'assise-inclinaison', groupe: 'assise', libelle: 'inclinaison du tronc vers l\'avant pendant la descente',
    texte: `${n0(incMax)}° au plus fort`, valeur: incMax, attendu: '10 à 30°',
    verdict: bande(incMax, 10, 30, 8),
    phrase: (v) => (v < 10
      ? `le tronc reste vertical pendant la descente (${n0(v)}° au plus fort) : dans la réalité elle tomberait en arrière — il faut se pencher en avant pour amener son poids au-dessus des pieds.`
      : `le tronc se penche de ${n0(v)}° vers l'avant : elle plonge, on dirait qu'elle ramasse quelque chose.`),
  })

  // ── Monotonie de la descente ──────────────────────────────────────────
  let remontee = 0
  for (let i = 1; i < n; i++) {
    const a = sens === 'descente' ? hy[i - 1] : hy[n - i]
    const b = sens === 'descente' ? hy[i] : hy[n - i - 1]
    if (b > a) remontee = Math.max(remontee, b - a)
  }
  // On cumule plutôt la plus grande remontée continue.
  let cum = 0, pireCum = 0
  for (let i = 1; i < n; i++) {
    const a = sens === 'descente' ? hy[i - 1] : hy[n - i]
    const b = sens === 'descente' ? hy[i] : hy[n - i - 1]
    if (b > a) { cum += b - a; pireCum = Math.max(pireCum, cum) } else cum = 0
  }
  out.push({
    id: 'assise-monotonie', groupe: 'assise', libelle: 'régularité de la descente (le bassin ne remonte pas)',
    texte: `remontée max ${n1(cmA(pireCum))} cm`, valeur: cmA(pireCum), attendu: '≤ 1,5 cm',
    verdict: maxi(cmA(pireCum), 1.5, 2),
    phrase: (v) => `le bassin remonte de ${n1(v)} cm en cours de descente : elle hésite au milieu du mouvement, on dirait qu'elle se ravise.`,
  })

  assisEtat(X, out, iFin, sens === 'descente' ? 'une fois assise' : 'au départ, assise')
}

function assisEtat(X, out, i, quand) {
  const { tr } = X
  const g = X.genou.g[i], d = X.genou.d[i]
  const m = (isFinite(g) && isFinite(d)) ? (g + d) / 2 : (isFinite(g) ? g : d)
  out.push({
    id: 'assise-genou', groupe: 'assise', libelle: `angle du genou ${quand}`,
    texte: `${n0(g)}° / ${n0(d)}°`, valeur: m, attendu: '85 à 100° (siège à bonne hauteur)',
    verdict: bande(m, 85, 100, 15),
    phrase: (v) => (v < 85
      ? `${quand}, le genou n'est fléchi qu'à ${n0(v)}° : elle est perchée sur le bord du siège, jambes tendues.`
      : `${quand}, le genou fait ${n0(v)}° : ses cuisses remontent, le siège est trop bas pour elle.`),
  })
}

function assisTenu(X, out) {
  const { cmA, tr, n } = X
  const g = X.genou.g.filter(isFinite), d = X.genou.d.filter(isFinite)
  const m = A.moyenne([...g, ...d])
  out.push({
    id: 'assis-genou', groupe: 'assise', libelle: 'angle moyen du genou en position assise',
    texte: `${n0(m)}° (G ${n0(A.moyenne(g))}° / D ${n0(A.moyenne(d))}°)`, valeur: m, attendu: '85 à 100°',
    verdict: bande(m, 85, 100, 15),
    phrase: (v) => (v < 85
      ? `assise, son genou n'est fléchi qu'à ${n0(v)}° : elle est perchée sur le bord du siège.`
      : `assise, son genou fait ${n0(v)}° : ses genoux remontent, le siège est trop bas.`),
  })
  const hy = X.hy
  const frac = (A.moyenne(hy.filter(isFinite)) / tr.rig.hanchesM) * 100
  out.push({
    id: 'assis-hauteur', groupe: 'assise', libelle: 'hauteur du bassin assise',
    texte: `${n0(frac)} % de la hauteur de hanche debout`, valeur: frac, attendu: '48 à 62 %',
    verdict: bande(frac, 48, 62, 10),
    phrase: (v) => `assise, son bassin est à ${n0(v)} % de sa hauteur debout : ${v < 48 ? 'elle est assise par terre, pas sur un siège' : 'elle est à peine posée, le siège serait très haut'}.`,
  })
}

function mainsCuisses(X, out) {
  const { tr } = X
  const f = tr.img.map((F) => F.mainCuisse?.fraction ?? 0)
  const i = f.indexOf(Math.max(...f))
  const mx = f[i]
  out.push({
    id: 'assise-mains-cuisses', groupe: 'assise', libelle: 'les mains ne traversent pas les cuisses',
    texte: mx > 0 ? `${pct(mx)} d'enfoncement (${tr.img[i].mainCuisse?.quoi}, t=${n1(tr.img[i].t)} s)` : 'aucun contact',
    valeur: mx, attendu: '≤ 55 % (une main posée sur la cuisse la touche, c\'est normal)',
    verdict: maxi(mx, 0.55, 0.2),
    phrase: (v) => `la ${tr.img[i].mainCuisse?.quoi} : la main entre de ${pct(v)} dans la cuisse vers t=${n1(tr.img[i].t)} s — elle passe au travers.`,
  })
}

// ════════════════════════════════════════════════════════════════════════════
// REPOS DEBOUT
// ════════════════════════════════════════════════════════════════════════════

function reposDebout(X, out, { strict = true } = {}) {
  const { cmA, tr, n } = X

  // ── Écart des pieds : LE défaut qui est passé au travers ──────────────
  const av = X.piedAv.g.map((v, i) => v - X.piedAv.d[i]).filter(isFinite).map(Math.abs)
  const avMax = av.length ? Math.max(...av) : NaN
  out.push({
    id: 'repos-pieds-avant-arriere', groupe: 'repos', libelle: 'décalage avant-arrière des pieds',
    texte: `${n1(cmA(avMax))} cm`, valeur: cmA(avMax), attendu: '≤ 20 cm — au-delà c\'est une garde, pas un repos',
    verdict: maxi(cmA(avMax), 20, 12),
    phrase: (v) => `un pied est ${n1(v)} cm devant l'autre : ce n'est pas une position de repos, c'est une garde de combat.`,
  })
  const lat = X.piedLat.g.map((v, i) => Math.abs(v - X.piedLat.d[i])).filter(isFinite)
  const latMoy = A.moyenne(lat)
  out.push({
    id: 'repos-pieds-lateral', groupe: 'repos', libelle: 'écartement latéral des pieds',
    texte: `${n1(cmA(latMoy))} cm`, valeur: cmA(latMoy), attendu: '10 à 25 cm',
    verdict: bande(cmA(latMoy), 10, 25, 8),
    phrase: (v) => (v < 10
      ? `les pieds sont pratiquement collés (${n1(v)} cm) : c'est un garde-à-vous, pas une station debout détendue.`
      : `les pieds sont écartés de ${n1(v)} cm au lieu de 10 à 25 : elle se tient jambes trop ouvertes, campée comme pour encaisser un choc.`),
  })

  // ── Mains ouvertes ────────────────────────────────────────────────────
  for (const k of ['g', 'd']) {
    const dg = X.doigts[k].filter(isFinite)
    if (!dg.length) continue
    const mx = Math.max(...dg)
    out.push({
      id: `repos-main-ouverte-${k}`, groupe: 'repos', libelle: `ouverture de la main ${COTEF[k]}`,
      texte: `${n0(mx)}° de flexion moyenne des phalanges`, valeur: mx, attendu: '≤ 30° (main relâchée)',
      verdict: maxi(mx, 35, 20),
      phrase: (v) => `la main ${COTEF[k]} est fermée (${n0(v)}° de flexion des phalanges) : un poing serré pendant une conversation se remarque immédiatement.`,
    })
  }

  // ── Bras le long du corps ─────────────────────────────────────────────
  for (const k of ['g', 'd']) {
    const e = tr.img.map((F) => F.bras[k]?.ecartVerticaleDeg).filter(isFinite)
    if (!e.length) continue
    const mx = Math.max(...e)
    out.push({
      id: `repos-bras-pendant-${k}`, groupe: 'repos', libelle: `bras ${COTE[k]} le long du corps`,
      texte: `${n0(mx)}° d'écart à la verticale`, valeur: mx, attendu: '≤ 35°',
      verdict: maxi(mx, 35, 20),
      phrase: (v) => `le bras ${COTE[k]} ne pend pas le long du corps : il s'écarte de ${n0(v)}° de la verticale.`,
    })
    const h = X.mainH[k].filter(isFinite)
    const auDessus = cmA(Math.max(...h) - A.moyenne(X.hy.filter(isFinite)))
    out.push({
      id: `repos-main-sous-hanche-${k}`, groupe: 'repos', libelle: `main ${COTEF[k]} sous le niveau des hanches`,
      texte: auDessus > 0 ? `${n1(auDessus)} cm au-dessus des hanches` : `${n1(-auDessus)} cm sous les hanches`,
      valeur: auDessus, attendu: '≤ 0 cm',
      verdict: maxi(auDessus, 4, 12),
      phrase: (v) => `la main ${COTEF[k]} monte ${n1(v)} cm au-dessus des hanches : au repos les bras pendent.`,
    })
  }

  // ── Respiration ───────────────────────────────────────────────────────
  // Chez un humain debout, la respiration ne fait PAS monter le bassin : elle se
  // lit dans la cage thoracique (le buste tangue de 1 à 3°) et dans la tête. Les
  // socles Overte sont exactement comme ça : bassin immobile à 0,06 cm, buste qui
  // respire à 2,9°. Juger la vie sur la seule hauteur du bassin déclarait mort un
  // clip vivant — c'est le buste et la tête qu'il faut écouter aussi.
  const amplH = cmA(A.amplitude(X.hy.filter(isFinite)))
  const vieBuste = A.amplitude(X.buste.pitch.filter(isFinite))
  const vieTete = A.amplitude(X.tete.pitch.filter(isFinite))
  const vieMains = cmA(Math.max(...['g', 'd'].map((k) => A.amplitude(X.mainH[k].filter(isFinite)))))
  const vivant = amplH >= 0.3 || vieBuste >= 1 || vieTete >= 2 || vieMains >= 0.4
  out.push({
    id: 'repos-respiration', groupe: 'repos', libelle: 'micro-oscillation du corps (respiration)',
    texte: `bassin ${n1(amplH)} cm · buste ${n1(vieBuste)}° · tête ${n1(vieTete)}° · mains ${n1(vieMains)} cm`,
    valeur: amplH, attendu: 'bassin ≤ 2 cm, et une vie visible quelque part (buste ≥ 1° ou tête ≥ 2° ou mains ≥ 0,4 cm)',
    verdict: amplH > 2 ? maxi(amplH, 2, 1.2) : vivant ? 'bon' : 'limite',
    phrase: (v) => (v > 2
      ? `le corps oscille de ${n1(v)} cm au repos : c'est trop, on dirait qu'elle se dandine.`
      : `rien ne bouge : bassin ${n1(amplH)} cm, buste ${n1(vieBuste)}°, tête ${n1(vieTete)}° — elle a l'air en pause, pas vivante ; il manque la respiration.`),
  })

  // ── Buste face à l'avant ──────────────────────────────────────────────
  const tor = X.torsion.filter(isFinite)
  const torMoy = A.moyenne(tor.map(Math.abs))
  out.push({
    id: 'repos-buste-face', groupe: 'repos', libelle: 'buste face à l\'avant',
    texte: `${n1(torMoy)}° de vrille moyenne`, valeur: torMoy, attendu: '≤ 10°',
    verdict: maxi(torMoy, 10, 10),
    phrase: (v) => `le buste est tourné de ${n1(v)}° par rapport au bassin en permanence : elle ne fait pas face.`,
  })
}

/**
 * Départ et arrêt de marche : un fragment, pas un cycle. On vérifie seulement
 * qu'il reste un pied au sol du début à la fin (on ne décolle pas pour partir),
 * et que les extrémités sont cohérentes avec ce qu'elles doivent raccorder :
 * immobile d'un côté, en mouvement de l'autre.
 */
function transitionMarche(X, out) {
  const { cmA, tr, contacts: c, n } = X
  out.push({
    id: 'transition-vol', groupe: 'marche', libelle: 'phase de vol pendant la transition',
    texte: pct(c.fractionVol), valeur: c.fractionVol * 100, attendu: '0 %',
    verdict: maxi(c.fractionVol * 100, 2, 6),
    phrase: (v) => `pendant ${n0(v)} % de la transition aucun pied ne touche le sol : elle décolle pour démarrer.`,
  })
  const depart = tr.slug.endsWith('start')
  const iImmobile = depart ? 0 : n - 1
  const vitPied = ['g', 'd'].map((k) => {
    const s = X.piedAv[k]
    const j = iImmobile === 0 ? 1 : n - 2
    return Math.abs((s[j] - s[iImmobile]) / X.tr.dt)
  })
  const v = cmA(Math.max(...vitPied))
  out.push({
    id: 'transition-extremite', groupe: 'marche', libelle: `pied à l'extrémité ${depart ? 'debout (début)' : 'debout (fin)'}`,
    texte: `${n1(v)} cm/s`, valeur: v, attendu: '≤ 25 cm/s — l\'extrémité doit raccorder un personnage immobile',
    verdict: maxi(v, 25, 35),
    phrase: (val) => `au raccord avec le repos debout, le pied file déjà à ${n1(val)} cm/s : la transition ne part pas (ou n'arrive pas) à l'arrêt, le raccord avec idle se verra.`,
  })
}

/** Les pieds d'un geste debout doivent rester plantés : c'est le socle du geste. */
function baseDebout(X, out) {
  const { cmA, tr } = X
  const bouge = ['g', 'd'].map((k) => {
    const a = X.piedAv[k].filter(isFinite), l = X.piedLat[k].filter(isFinite)
    return Math.hypot(A.amplitude(a), A.amplitude(l))
  })
  const mx = cmA(Math.max(...bouge))
  out.push({
    id: 'geste-pieds-plantes', groupe: 'repos', libelle: 'les pieds restent plantés pendant le geste',
    texte: `${n1(mx)} cm de déplacement`, valeur: mx, attendu: '≤ 8 cm',
    verdict: maxi(mx, 8, 10),
    phrase: (v) => `les pieds se déplacent de ${n1(v)} cm pendant le geste : le socle bouge alors que le personnage est censé rester en place.`,
  })
}

// ════════════════════════════════════════════════════════════════════════════
// GESTES DE TÊTE ET SALUT
// ════════════════════════════════════════════════════════════════════════════

function geste_tete(X, out, axe) {
  const { tr } = X
  const nom = axe === 'pitch' ? 'hochement' : 'dénégation'
  const un = axe === 'pitch' ? 'un' : 'une' // « une dénégation », pas « un »
  const leNom = `${un} ${nom}`
  const duNom = axe === 'pitch' ? `du ${nom}` : `de la ${nom}`
  const deNom = axe === 'pitch' ? `d'un ${nom}` : `d'une ${nom}`
  const principal = axe === 'pitch' ? X.tete.pitch : X.tete.yaw
  const secondaire = axe === 'pitch' ? X.tete.yaw : X.tete.pitch
  const nomP = axe === 'pitch' ? 'tangage (haut-bas)' : 'lacet (gauche-droite)'
  const nomS = axe === 'pitch' ? 'lacet (gauche-droite)' : 'tangage (haut-bas)'

  const aP = A.amplitude(principal.filter(isFinite))
  const aS = A.amplitude(secondaire.filter(isFinite))
  out.push({
    id: 'tete-axe', groupe: 'geste', libelle: `axe ${duNom}`,
    texte: `${nomP} ${n0(aP)}° · ${nomS} ${n0(aS)}°`, valeur: aP - aS, attendu: `le ${nomP} domine`,
    verdict: aP > 2 * aS ? 'bon' : aP > aS ? 'limite' : 'defaut',
    phrase: () => `le mouvement se fait surtout autour du mauvais axe : ${n0(aS)}° de ${nomS} contre ${n0(aP)}° de ${nomP}. Ce n'est pas ${leNom}.`,
  })

  const o = A.compterOscillations(principal)
  out.push({
    id: 'tete-amplitude', groupe: 'geste', libelle: `amplitude ${duNom}`,
    texte: `${n0(aP)}° crête à crête`, valeur: aP, attendu: '12 à 40° crête à crête',
    verdict: bande(aP, 12, 40, 12),
    phrase: (v) => (v < 12
      ? `la tête ne bouge que de ${n0(v)}° : le mouvement est trop discret, on ne le verra pas.`
      : `la tête pivote de ${n0(v)}° d'amplitude totale : c'est le double ${deNom} ordinaire, ça tient de la révérence.`),
  })
  out.push({
    id: 'tete-repetitions', groupe: 'geste', libelle: `répétitions ${duNom}`,
    texte: `${n2(o.allersRetours)} aller(s)-retour(s)`, valeur: o.allersRetours, attendu: '2 à 3',
    verdict: bande(o.allersRetours, 2, 3.5, 1),
    phrase: (v) => (v < 2
      ? `la tête ne fait qu'${v <= 1 ? 'un seul aller-retour' : n2(v) + ' aller-retour'} : ${leNom} se lit à partir de deux, sinon on dirait simplement qu'elle regarde ailleurs.`
      : `la tête fait ${n2(v)} allers-retours : c'est insistant, presque agité.`),
  })

  // Le tronc ne doit pas suivre : un hochement est porté par le cou.
  const bp = axe === 'pitch' ? X.buste.pitch : X.buste.yaw
  const ab = A.amplitude(bp.filter(isFinite))
  out.push({
    id: 'tete-tronc-suit', groupe: 'geste', libelle: 'le tronc ne suit pas la tête',
    texte: `buste ${n0(ab)}° pour ${n0(aP)}° de tête`, valeur: aP > 0 ? ab / aP : NaN, attendu: '≤ 0,4 × le mouvement de la tête',
    verdict: maxi(aP > 0 ? ab / aP : NaN, 0.4, 0.3),
    phrase: () => `le buste suit la tête (${n0(ab)}° contre ${n0(aP)}°) : ce mouvement devrait être porté par le cou seul, sinon c'est tout le corps qui oscille.`,
  })
}

/**
 * Détecte un SALUT, et se montre exigeant.
 *
 * Première version : « une main passe au-dessus de la ligne des épaules ». Trop
 * lâche — `happy` déclenchait, alors que la main n'y monte que de 5 cm au-dessus
 * de l'épaule : c'est un geste de joie bras levés, pas un bonjour. Le juge lui
 * reprochait alors de mal saluer, ce qu'il n'essayait pas de faire.
 *
 * Un salut, c'est trois choses ensemble : la main NETTEMENT au-dessus des épaules
 * (≥ 10 cm), assez longtemps pour se lire (≥ 0,4 s), et un balayage latéral de
 * l'avant-bras (≥ 10 cm). Faute de quoi on ne juge pas — et on le dit.
 */
function detecterSalut(X) {
  const { cmA, tr } = X
  let best = null
  for (const k of ['g', 'd']) {
    const s = X.mainEp[k]
    const ok = s.filter((x) => isFinite(x) && cmA(x) >= 10)
    if (!ok.length) continue
    const duree = (ok.length / tr.n) * tr.duree
    const lat = cmA(A.amplitude(tr.img.map((F) => F.main[k]?.latRelM).filter(isFinite)))
    if (duree < 0.4 || lat < 10) continue
    const mx = Math.max(...s.filter(isFinite))
    if (!best || mx > best.hauteur) best = { k, hauteur: mx, duree, lat }
  }
  return best
}

function geste_salut(X, out, k) {
  const { cmA, tr } = X
  const autre = k === 'g' ? 'd' : 'g'
  const s = X.mainEp[k].filter(isFinite)
  const mx = Math.max(...s)
  out.push({
    id: 'salut-hauteur', groupe: 'geste', libelle: `la main ${COTEF[k]} passe au-dessus de la ligne des épaules`,
    texte: `${n1(cmA(mx))} cm au-dessus`, valeur: cmA(mx), attendu: '> 0 cm',
    verdict: mx > 0 ? 'bon' : 'defaut',
    phrase: () => `la main ne monte jamais au-dessus des épaules : ça ne se lit pas comme un salut.`,
  })
  // Coude fléchi : un salut bras tendu, c'est un signal de détresse.
  const c = X.coude[k].filter(isFinite)
  const iHaut = X.mainEp[k].indexOf(mx)
  const cf = X.coude[k][iHaut]
  out.push({
    id: 'salut-coude', groupe: 'geste', libelle: `flexion du coude ${COTE[k]} au sommet du salut`,
    texte: `${n0(cf)}°`, valeur: cf, attendu: '60 à 110°',
    verdict: bande(cf, 60, 110, 25),
    phrase: (v) => (v < 60
      ? `elle salue bras tendu (coude à ${n0(v)}°) : ça ressemble plus à un appel au secours qu'à un bonjour.`
      : `le coude est replié à ${n0(v)}° : la main est collée à l'épaule, le salut est écrasé.`),
  })
  // Allers-retours de l'avant-bras, en CADENCE et non en nombre brut : un clip de
  // 5 s qui salue tranquillement en fait forcément plus qu'un clip d'une seconde,
  // et le compter en valeur absolue punissait la durée, pas le geste.
  const lat = tr.img.map((F) => F.main[k]?.latRelM).filter(isFinite)
  const o = A.compterOscillations(lat)
  const cadence = o.allersRetours / Math.max(0.1, tr.duree)
  out.push({
    id: 'salut-battements', groupe: 'geste', libelle: 'cadence de l\'avant-bras',
    texte: `${o.allersRetours} allers-retours en ${n1(tr.duree)} s → ${n2(cadence)}/s`,
    valeur: cadence, attendu: '1,2 à 3,5 par seconde (2 à 4 sur un salut d\'environ 1,5 s)',
    verdict: bande(cadence, 1.2, 3.5, 0.8),
    phrase: (v) => (v < 1.2
      ? `l'avant-bras ne bat qu'à ${n2(v)} aller-retour par seconde : la main se lève et redescend, elle ne fait pas signe.`
      : `l'avant-bras bat à ${n2(v)} allers-retours par seconde : c'est un salut frénétique.`),
  })
  // L'autre bras reste au repos.
  const e = tr.img.map((F) => F.bras[autre]?.ecartVerticaleDeg).filter(isFinite)
  if (e.length) {
    const em = Math.max(...e)
    out.push({
      id: 'salut-autre-bras', groupe: 'geste', libelle: `l'autre bras (${COTE[autre]}) reste au repos`,
      texte: `${n0(em)}° d'écart à la verticale`, valeur: em, attendu: '≤ 40°',
      verdict: maxi(em, 40, 25),
      phrase: (v) => `l'autre bras s'agite aussi (${n0(v)}° d'écart à la verticale) : on ne sait plus lequel salue.`,
    })
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LE JUGE
// ════════════════════════════════════════════════════════════════════════════

/** Famille déduite du NOM du clip — c'est la convention du projet (vrma/README.md). */
export function famille(slug) {
  if (!slug.startsWith('world-')) {
    const base = slug.replace(/-\d+$/, '')
    if (base === 'idle') return 'repos debout'
    if (base === 'idle-talking') return 'repos debout parlant'
    if (base === 'nod') return 'hochement'
    if (base === 'shake') return 'dénégation'
    return 'geste debout'
  }
  const s = slug.slice(6)
  if (/^walk(-slow|-fast)?$/.test(s)) return 'marche'
  if (/^walk-back(-fast)?$/.test(s)) return 'marche arrière'
  if (/^walk-(start|stop)(-.+)?$/.test(s)) return 'transition de marche'
  if (/^turn-/.test(s)) return 'pivot'
  if (s === 'sit-enter') return 'assise (descente)'
  if (s === 'sit-exit') return 'assise (relevé)'
  if (/^sit-/.test(s)) return 'assis'
  return 'monde'
}

/**
 * Juge un clip. Rend une fiche : critères applicables, mesures, verdicts, et les
 * phrases françaises des défauts constatés.
 */
export function juger(tr) {
  const X = contexte(tr)
  const fam = famille(tr.slug)
  const out = []

  universels(X, out)

  switch (fam) {
    case 'marche':
      marche(X, out, { allure: tr.slug === 'world-walk-slow' ? 'lente' : tr.slug === 'world-walk-fast' ? 'rapide' : 'normale' }); break
    case 'marche arrière':
      marche(X, out, { allure: 'arriere' }); break
    case 'transition de marche':
      // Un départ ou un arrêt de marche N'EST PAS un cycle : ni symétrie, ni
      // double appui régulier, ni pieds plantés — le premier pas doit justement
      // décoller. On ne garde que ce qui reste vrai sur un fragment.
      transitionMarche(X, out)
      break
    case 'assise (descente)':
      assiseDescente(X, out, { sens: 'descente' }); mainsCuisses(X, out); break
    case 'assise (relevé)':
      assiseDescente(X, out, { sens: 'montee' }); mainsCuisses(X, out); break
    case 'assis':
      assisTenu(X, out); mainsCuisses(X, out); break
    case 'repos debout':
    case 'repos debout parlant':
      reposDebout(X, out); break
    case 'hochement':
      geste_tete(X, out, 'pitch'); baseDebout(X, out); reposPartiel(X, out); break
    case 'dénégation':
      geste_tete(X, out, 'yaw'); baseDebout(X, out); reposPartiel(X, out); break
    case 'geste debout': {
      baseDebout(X, out); reposPartiel(X, out)
      const salut = detecterSalut(X)
      if (salut) geste_salut(X, out, salut.k)
      else {
        // On dit ce qu'on n'a PAS jugé : un critère muet est un critère qu'on
        // croira passé.
        const h = Math.max(...['g', 'd'].map((k) => Math.max(...X.mainEp[k].filter(isFinite))))
        out.push({
          id: 'salut-absent', groupe: 'geste', libelle: 'salut de la main',
          texte: isFinite(h) && X.cmA(h) > 0 ? `aucun : la main culmine à ${n1(X.cmA(h))} cm au-dessus des épaules` : 'aucun : les mains ne montent jamais au niveau des épaules',
          valeur: NaN, attendu: 'critères du salut non applicables',
          verdict: 'sansObjet',
        })
      }
      break
    }
    case 'pivot':
    default:
      // Un critère MUET est un critère qu'on croira passé. Quand une famille n'a
      // pas de critères dédiés (pivots, allures de course, pas chassés, gestes
      // tenus en trois temps, repos à posture alternée…), la fiche doit le DIRE :
      // seuls les critères universels ont parlé, le reste n'a pas été regardé.
      out.push({
        id: 'famille-non-jugee', groupe: fam === 'pivot' ? 'pivot' : 'monde',
        libelle: `critères propres à « ${fam} »`,
        texte: 'aucun critère dédié : seuls les critères universels ont été appliqués',
        valeur: NaN,
        attendu: fam === 'pivot'
          ? 'la rotation par cycle n\'est pas mesurable de façon fiable sur un clip joué sur place (cf. anim-lab/mesures.mjs)'
          : 'course, pas chassés, gestes tenus et repos alternés n\'ont pas encore de fourchettes propres',
        verdict: 'sansObjet',
      })
      break
  }

  const applicables = out.filter((c) => c.verdict !== 'sansObjet')
  const global = pire(...applicables.map((c) => c.verdict))
  const defauts = applicables.filter((c) => c.verdict === 'defaut' || c.verdict === 'limite')
  for (const c of out) if (c.verdict === 'defaut' || c.verdict === 'limite') c.diagnostic = c.phrase ? c.phrase(c.valeur) : c.libelle

  return {
    slug: tr.slug, famille: fam, duree: tr.duree, boucle: tr.boucle,
    rig: tr.rig, criteres: out, verdict: global,
    diagnostics: defauts.map((c) => ({ id: c.id, verdict: c.verdict, phrase: c.diagnostic })),
    contexte: X,
  }
}

/** Sur un geste, on ne garde du repos debout que ce qui reste vrai pendant un geste. */
function reposPartiel(X, out) {
  const tmp = []
  reposDebout(X, tmp)
  const garder = new Set([
    'repos-pieds-avant-arriere', 'repos-pieds-lateral',
    'repos-main-ouverte-g', 'repos-main-ouverte-d',
  ])
  for (const c of tmp) if (garder.has(c.id)) out.push(c)
}
