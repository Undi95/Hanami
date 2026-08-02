// ════════════════════════════════════════════════════════════════════════════
// anatomie.mjs — CE QUE FAIT LE CORPS, image par image.
//
// Ce module ne juge rien. Il rejoue un clip sur un vrai squelette et en extrait
// les grandeurs qu'un kinésithérapeute lirait sur une vidéo : appui des pieds,
// flexion des genoux, torsion du tronc, balancement des bras, ouverture des
// mains… Le jugement est dans criteres.mjs, qui ne lit que cette trace.
//
// Deux principes tiennent tout :
//
//   1. TOUT CE QUI EST UNE LONGUEUR EST UNE FRACTION DE HAUTEUR DE HANCHE.
//      « le bassin oscille de 5 cm » n'a pas de sens sur un avatar de 1,20 m.
//      On mesure en mètres sur le rig, on divise par la hauteur de hanche du rig,
//      et on compare à la fraction d'un adulte (rig.echelle fait l'aller-retour).
//
//   2. LES AXES DU CORPS VIENNENT DE LA GÉOMÉTRIE, JAMAIS D'UN QUATERNION.
//      Le +Z local du bassin ne désigne pas l'avant de la même façon d'un rig à
//      l'autre (un VRM 0.x le porte à l'envers). `haut × (gauche→droite)` est
//      indépendant de la version VRM et des conventions d'axes.
//      Et l'épaule, c'est `upperArm`, pas `shoulder` : dans un VRM `shoulder` est
//      la racine de la clavicule, collée au rachis — sur l'étalon (chibi
//      0,755 m de hanches) les
//      deux ne sont distantes que de 4 cm, un axe latéral bâti là-dessus est du
//      bruit, et toute la torsion du tronc en dépendrait.
//
// Aucune dépendance : THREE arrive par rig.mjs. Aucune écriture, aucun réseau.
// ════════════════════════════════════════════════════════════════════════════

import { THREE, poser, EPS } from './rig.mjs'

export const R2D = 180 / Math.PI

// ── Petite boîte à outils de signal ─────────────────────────────────────────

export const moyenne = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN)
export const ecartType = (a) => {
  if (a.length < 2) return 0
  const m = moyenne(a)
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length)
}
export const amplitude = (a) => (a.length ? Math.max(...a) - Math.min(...a) : NaN)

/** Corrélation de Pearson. Rend NaN si l'un des signaux est plat (rien à corréler). */
export function correlation(a, b) {
  const n = Math.min(a.length, b.length)
  if (n < 3) return NaN
  const ma = moyenne(a.slice(0, n)), mb = moyenne(b.slice(0, n))
  let sab = 0, saa = 0, sbb = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb
    sab += x * y; saa += x * x; sbb += y * y
  }
  if (saa < 1e-12 || sbb < 1e-12) return NaN
  return sab / Math.sqrt(saa * sbb)
}

/**
 * Compte les EXCURSIONS ALTERNÉES d'un signal : le nombre de fois qu'il part
 * franchement d'un côté, puis de l'autre.
 *
 * Compter les passages par la moyenne (la méthode évidente) ment dans les deux
 * sens : un signal bruité autour de sa moyenne compte des dizaines d'oscillations
 * qui n'existent pas, et — c'est le cas de `shake` — un balayage droite-gauche
 * qui ne repasse pas franchement de l'autre côté en compte ZÉRO alors qu'on le
 * voit très bien. On classe donc chaque image en « haut » / « bas » / « au
 * milieu » avec une bande morte à ±25 % de la demi-amplitude, et on compte les
 * changements de camp.
 *
 *   excursions   : nombre de camps traversés (droite, gauche, droite… = 3)
 *   allersRetours: excursions / 2 — l'unité dont parle un humain (« deux à
 *                  quatre allers-retours »)
 */
export function compterOscillations(sig, { circulaire = false, seuilRelatif = 0.25 } = {}) {
  const propre = sig.filter(isFinite)
  const n = propre.length
  if (n < 4) return { excursions: 0, allersRetours: 0, amplitude: 0, nombre: 0 }
  const amp = amplitude(propre)
  const m = (Math.max(...propre) + Math.min(...propre)) / 2 // milieu, pas moyenne :
  // un signal qui reste longtemps au repos d'un côté tirerait la moyenne vers lui.
  if (!isFinite(amp) || amp <= 1e-9) return { excursions: 0, allersRetours: 0, amplitude: 0, nombre: 0 }
  const s = (amp / 2) * seuilRelatif
  const suite = circulaire ? [...propre, ...propre] : propre
  const limite = circulaire ? n : suite.length
  let camp = 0, exc = 0
  for (let i = 0; i < suite.length; i++) {
    const v = suite[i] - m
    const c = v > s ? 1 : v < -s ? -1 : 0
    if (c !== 0 && c !== camp) {
      if (camp !== 0 && (!circulaire || exc < limite)) exc++
      camp = c
    }
  }
  if (circulaire) exc = Math.round(exc / 2) // la suite a été doublée
  return { excursions: exc, allersRetours: exc / 2, amplitude: amp, nombre: exc / 2 }
}

/** Distance entre deux segments 3D (pour les tests de traversée de segments). */
export function distanceSegments(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2)
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r)
  let s, t
  if (a < 1e-12 && e < 1e-12) return r.length()
  if (a < 1e-12) { s = 0; t = Math.min(1, Math.max(0, f / e)) }
  else {
    const c = d1.dot(r)
    if (e < 1e-12) { t = 0; s = Math.min(1, Math.max(0, -c / a)) }
    else {
      const b = d1.dot(d2), den = a * e - b * b
      s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0
      t = (b * s + f) / e
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)) }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)) }
    }
  }
  return d1.multiplyScalar(s).add(p1).sub(d2.multiplyScalar(t).add(p2)).length()
}

/** Distance d'un point à un segment. */
export function distancePointSegment(p, a, b) {
  const ab = b.clone().sub(a)
  const l2 = ab.lengthSq()
  if (l2 < 1e-12) return p.distanceTo(a)
  const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / l2))
  return p.distanceTo(ab.multiplyScalar(t).add(a))
}

const enroule180 = (d) => { while (d > 180) d -= 360; while (d < -180) d += 360; return d }
const angleEntre = (u, v) => {
  const lu = u.length(), lv = v.length()
  if (lu < 1e-9 || lv < 1e-9) return NaN
  return Math.acos(Math.min(1, Math.max(-1, u.dot(v) / (lu * lv)))) * R2D
}

// ── Doigts ──────────────────────────────────────────────────────────────────
const DOIGTS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little']
const PHALANGES = ['Proximal', 'Intermediate', 'Distal']

// ════════════════════════════════════════════════════════════════════════════
// LA TRACE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Rejoue le clip et rend une trace image par image.
 *
 * `fps` : fréquence d'ÉCHANTILLONNAGE (60 par défaut). Les .vrma portent des
 * clés à 30 Hz ; échantillonner plus fin ne crée pas d'information mais donne
 * des signaux lisses pour le comptage d'oscillations et les corrélations.
 *
 * Pour un clip en BOUCLE, la trace couvre [0, durée) sans doublon de couture :
 * la dernière image ne doit pas répéter la première, sinon toute mesure de
 * symétrie et d'oscillation est biaisée. Pour un clip non bouclé, elle couvre
 * [0, durée] — bornes comprises, car ce sont justement les extrémités qui
 * portent le sens (debout au début, assis à la fin).
 */
export function analyser(rig, info, { boucle = false, fps = 60 } = {}) {
  const { ech, duree, slug } = info
  const n = boucle
    ? Math.max(4, Math.round(duree * fps))
    : Math.max(4, Math.round(duree * fps) + 1)
  const dt = boucle ? duree / n : duree / (n - 1)

  const V = () => new THREE.Vector3()
  const Q = () => new THREE.Quaternion()
  const pos = (os) => { const b = rig.noeudBrut(os); return b ? b.getWorldPosition(V()) : null }
  const quat = (os) => { const b = rig.noeudBrut(os); return b ? b.getWorldQuaternion(Q()) : null }
  const quatNorm = (os) => { const b = rig.noeudNorm(os); return b ? b.getWorldQuaternion(Q()) : null }

  const img = []
  const posesQ = []

  for (let i = 0; i < n; i++) {
    const t = Math.min(duree - EPS, i * dt)
    const p = ech(t)
    poser(rig, p)
    posesQ.push(p.q)

    const F = { t, i }
    const hips = pos('hips')
    F.hips = hips ? [hips.x, hips.y, hips.z] : null
    F.hipsY = hips ? hips.y - rig.sol : NaN

    // ── Axes du corps ────────────────────────────────────────────────────
    // épaules = upperArm (l'articulation gléno-humérale), pas `shoulder`.
    const eg = pos('leftUpperArm'), ed = pos('rightUpperArm')
    const cg = pos('leftUpperLeg'), cd = pos('rightUpperLeg')
    const axe = (g, d) => {
      if (!g || !d) return null
      const c = d.clone().sub(g); c.y = 0
      if (c.lengthSq() < 1e-10) return null
      c.normalize()
      return { cote: c, avant: V().set(0, 1, 0).cross(c).normalize() }
    }
    const aEp = axe(eg, ed)
    const aBa = axe(cg, cd)
    F.avantEpaules = aEp ? [aEp.avant.x, aEp.avant.z] : null
    F.avantBassin = aBa ? [aBa.avant.x, aBa.avant.z] : null
    const lacet = (a) => (a ? Math.atan2(a.avant.x, a.avant.z) * R2D : NaN)
    F.lacetEpaulesDeg = lacet(aEp)
    F.lacetBassinDeg = lacet(aBa)
    // TORSION DU TRONC : l'angle, vu de dessus, entre l'orientation du bassin et
    // celle des épaules. C'est LE critère qui interdit de coller le haut d'une
    // animation sur le bas d'une autre.
    F.torsionDeg = isFinite(F.lacetEpaulesDeg) && isFinite(F.lacetBassinDeg)
      ? enroule180(F.lacetEpaulesDeg - F.lacetBassinDeg) : NaN

    const avant = aBa ? aBa.avant : (aEp ? aEp.avant : V().set(0, 0, 1))
    const cote = aBa ? aBa.cote : (aEp ? aEp.cote : V().set(1, 0, 0))
    F._avant = avant.clone(); F._cote = cote.clone()

    // ── Inclinaison du tronc ─────────────────────────────────────────────
    const cou = pos('neck') ?? pos('upperChest') ?? pos('chest') ?? pos('spine')
    if (hips && cou) {
      const tr = cou.clone().sub(hips)
      F.inclinaisonAvantDeg = Math.atan2(tr.dot(avant), tr.y) * R2D
      F.inclinaisonLatDeg = Math.atan2(tr.dot(cote), tr.y) * R2D
      F.longueurTroncM = tr.length()
    } else { F.inclinaisonAvantDeg = NaN; F.inclinaisonLatDeg = NaN; F.longueurTroncM = NaN }

    // ── Pieds ────────────────────────────────────────────────────────────
    // Les hauteurs qui comptent sont celles des POINTS DE SEMELLE (talon, pointe),
    // ancrés une fois pour toutes dans le repère du pied par rig.mjs, et non
    // celles des os — qui sont à l'intérieur de la chair.
    F.pied = {}
    for (const [k, c] of [['g', 'left'], ['d', 'right']]) {
      const cheville = pos(c + 'Foot'), orteil = pos(c + 'Toes')
      if (!cheville) { F.pied[k] = null; continue }
      const sem = rig.semelle[k]
      const ptTalon = sem?.talon
        ? cheville.clone().add(sem.talon.local.clone().applyQuaternion(quat(c + 'Foot')))
        : cheville.clone()
      const ptPointe = sem?.pointe && orteil
        ? orteil.clone().add(sem.pointe.local.clone().applyQuaternion(quat(c + 'Toes')))
        : (orteil ? orteil.clone() : ptTalon.clone())
      const hTalon = ptTalon.y - rig.sol
      const hPointe = ptPointe.y - rig.sol
      const rel = hips ? cheville.clone().sub(hips) : null
      F.pied[k] = {
        cheville: [cheville.x, cheville.y, cheville.z],
        talon: [ptTalon.x, ptTalon.y, ptTalon.z],
        pointe: [ptPointe.x, ptPointe.y, ptPointe.z],
        hauteurTalon: hTalon,
        hauteurPointe: hPointe,
        hauteur: Math.min(hTalon, hPointe), // le point le plus bas de la semelle
        chevilleH: cheville.y - rig.sol,
        avanceRel: rel ? rel.dot(avant) : NaN,
        latRel: rel ? rel.dot(cote) : NaN,
        // Piqué : + = pointe plus basse que talon (pointe tendue, poussée),
        //         − = talon plus bas (dorsiflexion, attaque talon).
        piqueDeg: Math.atan2(hTalon - hPointe, Math.max(1e-6, Math.hypot(ptPointe.x - ptTalon.x, ptPointe.z - ptTalon.z))) * R2D,
      }
    }

    // ── Genoux ───────────────────────────────────────────────────────────
    F.genou = {}
    for (const [k, c] of [['g', 'left'], ['d', 'right']]) {
      const h = pos(c + 'UpperLeg'), g = pos(c + 'LowerLeg'), p2 = pos(c + 'Foot')
      if (!h || !g || !p2) { F.genou[k] = null; continue }
      const cuisse = g.clone().sub(h).normalize()
      const tibia = p2.clone().sub(g).normalize()
      const flexion = angleEntre(cuisse, tibia)
      // SIGNE : le genou plie vers l'ARRIÈRE. Le tibia s'écarte de la cuisse en
      // basculant vers −avant. S'il bascule vers +avant, c'est une hyperextension.
      const d = tibia.clone().sub(cuisse)
      const signe = d.dot(avant) < 0 ? 1 : -1
      // CHARNIÈRE : le genou est un gond, et son axe est l'axe LATÉRAL DE LA
      // CUISSE. Deux références ont été essayées et rejetées :
      //   • l'axe latéral du BASSIN — faux dès que la jambe tourne sous le corps,
      //     il accusait les deux pivots de plier le genou de travers ;
      //   • l'axe du PIED — dégénère quand la pointe descend (le pied vu de dessus
      //     n'a presque plus de longueur), d'où un pic à 83° en pleine oscillation.
      // Le repère du nœud NORMALISÉ de la cuisse, lui, est défini par le format
      // (T-pose, +Y haut) et tourne avec la jambe : son axe X EST la charnière.
      const qc = quatNorm(c + 'UpperLeg')
      const ref = qc ? V().set(1, 0, 0).applyQuaternion(qc) : cote
      const axeArt = cuisse.clone().cross(tibia)
      // Garde à 12° de flexion : sous ça, cuisse et tibia sont presque alignés et
      // la direction de leur produit vectoriel est du bruit — vérifié sur les
      // pivots, où les pires déviations RÉELLES arrivent toutes à ≥ 17° de flexion.
      const dev = axeArt.lengthSq() > 1e-8 && flexion > 12
        ? 90 - Math.abs(90 - angleEntre(axeArt.normalize(), ref))
        : NaN
      F.genou[k] = {
        flexionDeg: flexion, flexionSigneeDeg: flexion * signe, deviationCharniereDeg: dev,
        // Position horizontale du genou devant le bassin, en composantes MONDE :
        // la projection sur un cap se fait après coup (cf. capMoyen).
        rel: hips ? [g.x - hips.x, g.z - hips.z] : null,
      }
    }

    // ── Coudes ───────────────────────────────────────────────────────────
    // Repère du bras : le VRM NORMALISÉ est en T-pose, +Y haut, +Z avant, bras
    // le long de ±X. L'avant du bras est donc le +Z du nœud normalisé de
    // `upperArm`, et la charnière du coude son ±Y — quelle que soit la rotation
    // de l'épaule, puisqu'on lit le repère du nœud lui-même.
    F.coude = {}
    for (const [k, c] of [['g', 'left'], ['d', 'right']]) {
      const e = pos(c + 'UpperArm'), co = pos(c + 'LowerArm'), m = pos(c + 'Hand')
      if (!e || !co || !m) { F.coude[k] = null; continue }
      const bras = co.clone().sub(e).normalize()
      const avantBras = m.clone().sub(co).normalize()
      const flexion = angleEntre(bras, avantBras)
      const qb = quatNorm(c + 'UpperArm')
      // rig.signeAvantNormalise : mesuré au repos, jamais supposé (cf. rig.mjs).
      const antBras = qb ? V().set(0, 0, rig.signeAvantNormalise).applyQuaternion(qb) : avant
      const axeCharniere = qb ? V().set(0, 1, 0).applyQuaternion(qb) : V().set(0, 1, 0)
      const d = avantBras.clone().sub(bras)
      const signe = d.dot(antBras) > 0 ? 1 : -1
      const axeArt = bras.clone().cross(avantBras)
      // Même garde de 12° que le genou : un coude quasi tendu n'a pas de plan de
      // flexion mesurable.
      const dev = axeArt.lengthSq() > 1e-8 && flexion > 12
        ? 90 - Math.abs(90 - angleEntre(axeArt.normalize(), axeCharniere))
        : NaN
      F.coude[k] = { flexionDeg: flexion, flexionSigneeDeg: flexion * signe, deviationCharniereDeg: dev }
    }

    // ── Mains et bras ────────────────────────────────────────────────────
    const epauleY = eg && ed ? (eg.y + ed.y) / 2 : NaN
    const epauleC = eg && ed ? eg.clone().add(ed).multiplyScalar(0.5) : null
    F.epauleY = isFinite(epauleY) ? epauleY - rig.sol : NaN
    F.main = {}
    F.bras = {}
    for (const [k, c] of [['g', 'left'], ['d', 'right']]) {
      const m = pos(c + 'Hand'), e = pos(c + 'UpperArm'), co = pos(c + 'LowerArm')
      if (!m) { F.main[k] = null; F.bras[k] = null; continue }
      F.main[k] = {
        p: [m.x, m.y, m.z],
        hauteur: m.y - rig.sol,
        surEpauleM: isFinite(epauleY) ? m.y - epauleY : NaN,
        avanceRelM: epauleC ? m.clone().sub(epauleC).dot(avant) : NaN,
        latRelM: epauleC ? m.clone().sub(epauleC).dot(cote) : NaN,
        // idem : composantes monde, projetées après coup sur le cap moyen.
        rel: epauleC ? [m.x - epauleC.x, m.z - epauleC.z] : null,
      }
      if (e && co) {
        const h = co.clone().sub(e)
        F.bras[k] = {
          // écart du bras à la verticale basse : 0 = pend le long du corps.
          ecartVerticaleDeg: angleEntre(h, V().set(0, -1, 0)),
          avanceM: h.clone().dot(avant),
          ecartLateralM: Math.abs(h.clone().dot(cote)),
        }
      } else F.bras[k] = null
    }

    // ── Doigts ───────────────────────────────────────────────────────────
    F.doigts = {}
    for (const [k, c] of [['g', 'left'], ['d', 'right']]) {
      const vals = []
      for (const dg of DOIGTS) {
        const noms = PHALANGES.map((ph) => c + dg + ph)
        const pts = [pos(c + 'Hand'), ...noms.map(pos)].filter(Boolean)
        for (let j = 0; j + 2 < pts.length; j++) {
          const a = pts[j + 1].clone().sub(pts[j])
          const b = pts[j + 2].clone().sub(pts[j + 1])
          const v = angleEntre(a, b)
          if (isFinite(v)) vals.push(v)
        }
      }
      F.doigts[k] = vals.length ? { flexionMoyDeg: moyenne(vals), flexionMaxDeg: Math.max(...vals), articulations: vals.length } : null
    }

    // ── Tête, relative au buste ──────────────────────────────────────────
    const qt = quat('head'), qc = quat('upperChest') ?? quat('chest') ?? quat('spine')
    if (qt && qc) {
      const inv = qc.clone().invert()
      const f = V().set(0, 0, 1).applyQuaternion(qt).applyQuaternion(inv)
      const u = V().set(0, 1, 0).applyQuaternion(qt).applyQuaternion(inv)
      F.tete = {
        // + = regarde vers le haut ; + = tourne vers sa gauche ; + = penche.
        pitchDeg: Math.asin(Math.min(1, Math.max(-1, f.y))) * R2D,
        yawDeg: Math.atan2(f.x, f.z) * R2D,
        rollDeg: Math.atan2(u.x, u.y) * R2D,
      }
    } else F.tete = null
    // Buste relatif au bassin : sert à vérifier que « le tronc ne suit pas » la tête.
    const qb2 = quat('upperChest') ?? quat('chest') ?? quat('spine')
    const qh2 = quat('hips')
    if (qb2 && qh2) {
      const inv = qh2.clone().invert()
      const f = V().set(0, 0, 1).applyQuaternion(qb2).applyQuaternion(inv)
      F.buste = { pitchDeg: Math.asin(Math.min(1, Math.max(-1, f.y))) * R2D, yawDeg: Math.atan2(f.x, f.z) * R2D }
    } else F.buste = null

    // ── Traversées de segments ───────────────────────────────────────────
    // Le tronc est modélisé par une capsule hanches→cou ; les membres par des
    // capsules. On ne signale qu'une pénétration PROFONDE : un bras posé contre
    // le corps touche la capsule, c'est normal et ce n'est pas un défaut.
    F.penetration = null
    if (hips && cou) {
      // Le tronc est dimensionné SUR LE MODÈLE (largeur de hanches / d'épaules),
      // jamais sur l'anthropométrie adulte : dans ces .vrm les os `upperArm` sont
      // plantés près du rachis, et un tronc de 12 cm de rayon les engloberait en
      // permanence — le juge criait « le bras traverse le tronc » sur un bras qui
      // pendait normalement.
      // Le BRAS est exclu du test : enraciné à l'épaule, il longe le tronc par
      // construction. Seuls l'avant-bras et le tibia peuvent vraiment y entrer.
      const rTronc = 0.55 * Math.max(rig.largeurHanchesM || 0, rig.epauleM || 0)
      const rMembre = 0.32 * (rig.largeurHanchesM || rig.epauleM || 0.1)
      let pire = 0, seg = null
      const segments = []
      for (const [k, c] of [['g', 'left'], ['d', 'right']]) {
        const A = (o) => pos(c + o)
        if (A('LowerArm') && A('Hand')) segments.push([`avant-bras ${k}`, A('LowerArm'), A('Hand')])
        if (A('LowerLeg') && A('Foot')) segments.push([`tibia ${k}`, A('LowerLeg'), A('Foot')])
      }
      for (const [nom, a, b] of segments) {
        const d = distanceSegments(a, b, hips, cou)
        const pen = (rTronc + rMembre - d) / (rTronc + rMembre)
        if (pen > pire) { pire = pen; seg = nom }
      }
      F.penetration = { fraction: pire, segment: seg }
    }
    // Mains contre cuisses (le défaut visible de l'assise).
    F.mainCuisse = null
    {
      let pireFr = 0, quoi = null
      const rCuisse = 0.085 * rig.echelle, rMain = 0.035 * rig.echelle
      for (const [km, cm] of [['g', 'left'], ['d', 'right']]) {
        const m = pos(cm + 'Hand')
        if (!m) continue
        for (const [kc, cc] of [['g', 'left'], ['d', 'right']]) {
          const a = pos(cc + 'UpperLeg'), b = pos(cc + 'LowerLeg')
          if (!a || !b) continue
          const d = distancePointSegment(m, a, b)
          const fr = (rCuisse + rMain - d) / (rCuisse + rMain)
          if (fr > pireFr) { pireFr = fr; quoi = `main ${km} / cuisse ${kc}` }
        }
      }
      F.mainCuisse = { fraction: pireFr, quoi }
    }

    img.push(F)
  }

  // ── Vitesses angulaires, sur la grille des clés source (30 Hz) ──────────
  // Mesurées sur les quaternions NORMALISÉS : ce sont eux que le clip écrit et
  // que l'app rejouera. Un pas de 1/30 s correspond à la grille des .vrma.
  const OS_MAJEURS = [
    'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
    'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
    'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
    'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
    'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
  ].filter((o) => rig.osPresents.has(o))
  const dtV = 1 / 30
  const vitesses = []
  let vMax = 0, osVMax = null, tVMax = NaN
  for (let i = 0; i < n; i++) {
    const t0 = Math.min(duree - EPS, i * dt)
    let t1 = t0 + dtV
    if (boucle) t1 = t1 % duree
    else t1 = Math.min(duree - EPS, t1)
    if (!boucle && t1 <= t0 + 1e-9) { vitesses.push({ max: vitesses.length ? vitesses[vitesses.length - 1].max : 0, os: null }); continue }
    const a = ech(t0).q, b = ech(t1).q
    let mx = 0, om = null
    for (const os of OS_MAJEURS) {
      const qa = a.get(os), qb = b.get(os)
      if (!qa || !qb) continue
      const r = qa.clone().invert().multiply(qb)
      if (r.w < 0) r.set(-r.x, -r.y, -r.z, -r.w)
      const s = Math.hypot(r.x, r.y, r.z)
      const v = (2 * Math.atan2(s, r.w) * R2D) / dtV
      if (v > mx) { mx = v; om = os }
    }
    vitesses.push({ max: mx, os: om })
    if (mx > vMax) { vMax = mx; osVMax = om; tVMax = t0 }
  }
  img.forEach((F, i) => { F.omegaMaxDegS = vitesses[i].max; F.osOmegaMax = vitesses[i].os })

  return {
    slug, duree, boucle, fps, n, dt,
    rig: {
      nom: rig.nom, hanchesM: rig.hanchesM, echelle: rig.echelle,
      epauleM: rig.epauleM, epauleY: rig.epauleY, sol: rig.sol, tailleM: rig.tailleM,
    },
    img,
    osAnimes: info.osAnimes,
    aTranslation: info.aTranslation,
    vitessePointe: { degS: vMax, os: osVMax, t: tVMax },
    contacts: detecterContacts(img, rig, dt, boucle),
  }
}

// ════════════════════════════════════════════════════════════════════════════
// APPUI AU SOL — la mesure dont tout le jugement de la marche dépend
// ════════════════════════════════════════════════════════════════════════════

/**
 * Un pied est EN APPUI quand il est bas ET qu'il recule par rapport au bassin.
 *
 * Le seul critère de hauteur ne suffit pas : au passage du pied oscillant près du
 * sol, il frôle le seuil et fabrique un faux appui. Or les clips sont joués SUR
 * PLACE : le corps n'avance pas, c'est le pied en appui qui RECULE, à la vitesse
 * de marche, pendant que le pied oscillant avance vite. Le signe de la vitesse
 * relative sépare donc les deux sans ambiguïté — et c'est gratuit.
 *
 * Seuil de hauteur : 3 cm d'adulte, mis à l'échelle du modèle. L'origine des
 * hauteurs est le point le plus bas du pied au repos, donc 0 = posé.
 */
export function detecterContacts(img, rig, dt, boucle) {
  const n = img.length
  const seuilH = 0.025 * rig.echelle

  // Vitesse d'avancée de chaque pied par rapport au bassin.
  const vit = { g: [], d: [] }
  for (const k of ['g', 'd']) {
    for (let i = 0; i < n; i++) {
      const p = img[i].pied[k]
      const j = boucle ? (i + 1) % n : Math.min(n - 1, i + 1)
      const q = img[j].pied[k]
      vit[k].push(p && q && i !== j ? (q.avanceRel - p.avanceRel) / dt : 0)
    }
  }

  // ── LA DÉRIVE D'APPUI, ESTIMÉE SUR LE CLIP LUI-MÊME ─────────────────────
  //
  // La hauteur seule ne suffit pas à dire quel pied porte : dans
  // `world-walk-slow` les DEUX pieds restent en permanence à moins de 2,5 cm du
  // sol — la hauteur ne discrimine rien du tout. Il faut la vitesse.
  //
  // Le clip est joué sur place : le pied qui porte est immobile DANS LE MONDE,
  // donc sa vitesse relative au bassin vaut −V (V = vitesse de déplacement), la
  // même à chaque instant ; le pied qui oscille va deux à trois fois plus vite,
  // en sens inverse. Comme il y a toujours au moins un pied au sol, à chaque
  // image l'une des deux vitesses vaut −V.
  //
  // Deux candidats, un par sens de marche : la médiane des vitesses basses et
  // celle des vitesses hautes. Reste à savoir LEQUEL est l'appui.
  const mediane = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0)
  const basV = [], hautV = []
  for (let i = 0; i < n; i++) {
    basV.push(Math.min(vit.g[i], vit.d[i]))
    hautV.push(Math.max(vit.g[i], vit.d[i]))
  }

  // COMMENT CHOISIR. On a essayé « le plus petit en valeur absolue, puisque le
  // pied oscillant va plus vite » : sur world-walk-back les deux candidats sont
  // −0,88 et +0,95 m/s — quasi symétriques, le départage se jouait au bruit, et
  // le juge annonçait 95 % de phase de vol.
  //
  // On tranche donc par la PHYSIQUE plutôt que par une heuristique : le bon sens
  // de marche est celui qui laisse un pied au sol. On essaie les deux et on garde
  // celui qui produit le moins de vol. Ce n'est pas se donner raison d'avance —
  // le sens de déplacement est un FAIT du clip, pas un jugement de qualité — et
  // une vraie course garderait du vol dans les deux hypothèses, donc reste
  // détectable. La dérive retenue est publiée (deriveAppuiMS) pour être vérifiable.
  const essayer = (vRef) => {
    const tolV = Math.max(0.35 * rig.echelle, 0.7 * Math.abs(vRef))
    const m = { g: [], d: [] }
    for (const k of ['g', 'd']) {
      for (let i = 0; i < n; i++) {
        const p = img[i].pied[k]
        // Une transition (départ, arrêt) n'a pas de dérive constante : le corps
        // accélère. On y juge sur la hauteur seule, sinon le pied qui prend de la
        // vitesse cesse d'être reconnu comme porteur en cours de route.
        if (!p) { m[k].push(false); continue }
        const basse = p.hauteur < seuilH
        m[k].push(boucle ? basse && Math.abs(vit[k][i] - vRef) <= tolV : basse)
      }
    }
    let vol = 0
    for (let i = 0; i < n; i++) if (!m.g[i] && !m.d[i]) vol++
    return { vRef, tolV, m, vol: vol / n }
  }
  const essais = [essayer(mediane(basV)), essayer(mediane(hautV))]
  essais.sort((a, b) => (a.vol - b.vol) || (Math.abs(a.vRef) - Math.abs(b.vRef)))
  const { vRef, tolV, m: brut } = essais[0]
  // Lissage : on efface les épisodes de moins de 3 images (1/20 s), qui sont du
  // bruit de seuil, jamais un vrai appui.
  const seuilV = tolV
  const lisser = (a) => {
    const b = a.slice()
    const N = b.length
    let i = 0
    while (i < N) {
      let j = i
      while (j < N && b[j] === b[i]) j++
      if (j - i < 3 && i > 0 && j < N) for (let k = i; k < j; k++) b[k] = !b[k]
      i = j
    }
    return b
  }
  const g = lisser(brut.g), d = lisser(brut.d)
  const compte = (a) => a.filter(Boolean).length / a.length
  const double = g.map((x, i) => x && d[i])
  const vol = g.map((x, i) => !x && !d[i])
  return {
    seuilHauteurM: seuilH, deriveAppuiMS: vRef, toleranceMS: tolV,
    g, d, double, vol,
    fractionG: compte(g), fractionD: compte(d),
    fractionDouble: compte(double), fractionVol: compte(vol),
    episodesG: episodes(g, boucle), episodesD: episodes(d, boucle),
    episodesVol: episodes(vol, boucle),
  }
}

/** Épisodes contigus de `true`, en indices d'image. Recolle la couture si bouclé. */
export function episodes(a, boucle) {
  const n = a.length
  const out = []
  let i = 0
  while (i < n) {
    if (!a[i]) { i++; continue }
    let j = i
    while (j < n && a[j]) j++
    out.push({ debut: i, fin: j - 1, duree: j - i })
    i = j
  }
  if (boucle && out.length > 1 && a[0] && a[n - 1]) {
    const p = out.pop(), q = out.shift()
    out.unshift({ debut: p.debut, fin: q.fin, duree: p.duree + q.duree, traverseCouture: true })
  }
  return out
}

// ── Extracteurs de signaux, pour criteres.mjs ───────────────────────────────

export const sig = {
  hipsY: (tr) => tr.img.map((F) => F.hipsY),
  hipsLat: (tr) => tr.img.map((F) => (F.hips ? F.hips[0] * F._cote.x + F.hips[2] * F._cote.z : NaN)),
  hipsFwd: (tr) => tr.img.map((F) => (F.hips ? F.hips[0] * F._avant.x + F.hips[2] * F._avant.z : NaN)),
  torsion: (tr) => tr.img.map((F) => F.torsionDeg),
  inclinaisonAvant: (tr) => tr.img.map((F) => F.inclinaisonAvantDeg),
  genouFlexion: (tr, k) => tr.img.map((F) => F.genou[k]?.flexionDeg ?? NaN),
  genouSignee: (tr, k) => tr.img.map((F) => F.genou[k]?.flexionSigneeDeg ?? NaN),
  coudeFlexion: (tr, k) => tr.img.map((F) => F.coude[k]?.flexionDeg ?? NaN),
  piedHauteur: (tr, k) => tr.img.map((F) => F.pied[k]?.hauteur ?? NaN),
  piedAvance: (tr, k) => tr.img.map((F) => F.pied[k]?.avanceRel ?? NaN),
  piedLateral: (tr, k) => tr.img.map((F) => F.pied[k]?.latRel ?? NaN),
  mainHauteur: (tr, k) => tr.img.map((F) => F.main[k]?.hauteur ?? NaN),
  mainSurEpaule: (tr, k) => tr.img.map((F) => F.main[k]?.surEpauleM ?? NaN),
  mainAvance: (tr, k) => tr.img.map((F) => F.main[k]?.avanceRelM ?? NaN),
  brasAvance: (tr, k) => tr.img.map((F) => F.bras[k]?.avanceM ?? NaN),
  doigts: (tr, k) => tr.img.map((F) => F.doigts[k]?.flexionMoyDeg ?? NaN),
  tetePitch: (tr) => tr.img.map((F) => F.tete?.pitchDeg ?? NaN),
  teteYaw: (tr) => tr.img.map((F) => F.tete?.yawDeg ?? NaN),
  teteRoll: (tr) => tr.img.map((F) => F.tete?.rollDeg ?? NaN),
  bustePitch: (tr) => tr.img.map((F) => F.buste?.pitchDeg ?? NaN),
  busteYaw: (tr) => tr.img.map((F) => F.buste?.yawDeg ?? NaN),
  omega: (tr) => tr.img.map((F) => F.omegaMaxDegS),
}

/**
 * CAP MOYEN du clip. Toutes les projections « en avant / en arrière » qui servent
 * à mesurer une PHASE (balancement des bras, avancée des cuisses) s'y rapportent,
 * et non à l'avant image par image : le tronc tourne d'une dizaine de degrés à
 * chaque pas, et projeter sur un avant qui tourne AVEC les épaules retrancherait
 * du balancement de bras une partie de ce qu'on cherche justement à mesurer.
 */
export function capMoyen(tr) {
  let x = 0, z = 0
  for (const F of tr.img) { x += F._avant.x; z += F._avant.z }
  const l = Math.hypot(x, z) || 1
  return { x: x / l, z: z / l }
}

const projeter = (rel, cap) => (rel ? rel[0] * cap.x + rel[1] * cap.z : NaN)

/** Avancée du genou devant le bassin, sur le cap moyen. Le signal de la jambe. */
export const avanceGenou = (tr, k, cap = capMoyen(tr)) =>
  tr.img.map((F) => projeter(F.genou[k]?.rel, cap))

/** Avancée de la main devant la ligne d'épaules, sur le cap moyen. Le signal du bras. */
export const avanceMain = (tr, k, cap = capMoyen(tr)) =>
  tr.img.map((F) => projeter(F.main[k]?.rel, cap))
