// ════════════════════════════════════════════════════════════════════════════
// mesures.mjs — LE NOYAU DE MESURE DU BANC, partagé mot pour mot entre la page
// (index.html, via l'import map) et la sonde headless (sonde.mjs, sous node).
//
// C'est la raison d'être de ce fichier : « la page affiche-t-elle les bons
// chiffres ? » ne se vérifie pas en regardant la page, mais en faisant tourner
// LE MÊME code hors navigateur et en comparant. Aucune logique de mesure ne doit
// donc vivre dans index.html.
//
// Méthode reprise de $SP/mesure-raccords.mjs (éprouvée sur 43 clips) :
//   • pose de référence du socle = pose MOYENNE sur un tour de boucle (un geste
//     se déclenche à un instant quelconque du cycle : la moyenne est l'espérance
//     de la pose de départ du fondu) ;
//   • un os que le socle n'anime PAS a pour référence la pose de REPOS du rig,
//     pas la moyenne d'autre chose : c'est ce que PropertyMixer restaure quand le
//     poids de la liaison tombe ;
//   • la dernière image s'échantillonne à `durée − EPS`, JAMAIS à `durée` :
//     LoopRepeat reboucle exactement à `durée` et rend la PREMIÈRE image, ce qui
//     fabrique un écart de sortie faussement nul.
//
// Aucune dépendance : THREE est passé en argument (la page et node ne le
// résolvent pas par le même chemin). Aucune écriture, aucun accès réseau.
// ════════════════════════════════════════════════════════════════════════════

export const R2D = 180 / Math.PI
export const FPS = 30 // grille des clés source des .vrma
export const EPS = 1e-4 // échantillonnage de la dernière image (cf. ci-dessus)

// ── Constantes du lecteur, reprises TELLES QUELLES de vrmStage.ts ───────────
export const GESTURE_FADE = 0.3 // fondu socle → geste
export const GESTURE_RETURN = 0.4 // fondu geste → socle
export const BASE_FADE = 0.5 // fondu socle → socle
export const DT_SIM = 1 / 60 // pas de requestAnimationFrame simulé

// ── Groupes d'os ────────────────────────────────────────────────────────────
export const OS_HAUT = [
  'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
]
export const OS_JAMBES = [
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
]
export const OS_BAS = ['hips', ...OS_JAMBES]
export const OS_MAJEURS = [...OS_HAUT, ...OS_BAS]
export const estDoigt = (os) => /Thumb|Index|Middle|Ring|Little/.test(os)

// ── LA RÈGLE D'ACCEPTATION ──────────────────────────────────────────────────
//
// « Si les animations ne s'emboîtent pas comme il faut (idle, anim, idle), on
// vire. » Un geste est amené depuis le socle en GESTURE_FADE et ramené en
// GESTURE_RETURN : il « s'emboîte » si sa première ET sa dernière image sont
// proches de la pose du socle. Le chiffre qui décide est l'écart en CENTIMÈTRES
// (le déplacement que l'os le plus concerné doit parcourir pendant le fondu) —
// les degrés disent QUEL os, les centimètres disent si ça se voit.
export const SEUIL_EXCELLENT_CM = 2 // invisible à l'œil
export const SEUIL_PASSE_CM = 7 // visible mais acceptable
export const SEUIL_ECHEC_CM = 10 // LA limite posée par le propriétaire

export const VERDICTS = {
  excellent: { rang: 0, texte: 'excellent', classe: 'v-excellent' },
  passe: { rang: 1, texte: 'passe', classe: 'v-passe' },
  limite: { rang: 2, texte: 'limite', classe: 'v-limite' },
  echoue: { rang: 3, texte: 'ÉCHOUE', classe: 'v-echoue' },
}

/** Verdict d'un écart en centimètres. C'est LE chiffre qui décide du sort du clip. */
export function verdict(cm) {
  if (!isFinite(cm)) return 'inconnu'
  if (cm > SEUIL_ECHEC_CM) return 'echoue'
  if (cm > SEUIL_PASSE_CM) return 'limite'
  if (cm > SEUIL_EXCELLENT_CM) return 'passe'
  return 'excellent'
}
/** Le pire de plusieurs verdicts (un clip est jugé sur son plus mauvais raccord). */
export function pireVerdict(...noms) {
  let pire = 'excellent'
  for (const n of noms) {
    if (n === 'inconnu' || !VERDICTS[n]) continue
    if (VERDICTS[n].rang > VERDICTS[pire].rang) pire = n
  }
  return pire
}

// ── Lecture normalisée : le cm-adulte ───────────────────────────────────────
//
// Les seuils ci-dessus sont en cm ABSOLUS : c'est le contrat du propriétaire
// (10 cm, posé sur le rig de référence) et il ne bouge pas. Mais sur la matrice
// multi-modèles, le même défaut angulaire de clip mesure 4 cm sur un chibi de
// 0,33 m et 14 cm sur un géant de 1,25 m : la colonne « échoue sur n/N » compte
// alors la taille des modèles, pas la qualité des clips (r(bras, échecs)=0,83
// sur 94 modèles). Le cm-adulte retire l'échelle : l'écart ramené à un adulte
// dont la hanche est à 0,93 m — la même convention que le juge biomécanique
// (devtools/diagnostic/juge/rig.mjs). Un défaut de clip donne alors le MÊME
// chiffre sur tous les gabarits, et « échoue sur 65/94 » se lit comme UN défaut.
// AFFICHAGE SEULEMENT : aucun verdict n'en dépend.
export const HANCHES_ADULTE_M = 0.93
export const cmAdulte = (cm, hanchesReposM) =>
  isFinite(cm) && isFinite(hanchesReposM) && hanchesReposM > 0 ? cm * (HANCHES_ADULTE_M / hanchesReposM) : NaN

// ── Outils quaternion ───────────────────────────────────────────────────────

/**
 * Angle de rotation (degrés) entre deux quaternions, exact et bien conditionné
 * près de 0 — `2·acos(|a·b|)` perd toute précision quand a·b → 1.
 * θ = 4·atan2(‖a−b‖, ‖a+b‖) après alignement des signes.
 */
export function angleQuatDeg(ax, ay, az, aw, bx, by, bz, bw) {
  let na = Math.hypot(ax, ay, az, aw); if (na > 0) { ax /= na; ay /= na; az /= na; aw /= na }
  let nb = Math.hypot(bx, by, bz, bw); if (nb > 0) { bx /= nb; by /= nb; bz /= nb; bw /= nb }
  if (ax * bx + ay * by + az * bz + aw * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw }
  const dm = Math.hypot(ax - bx, ay - by, az - bz, aw - bw)
  const dp = Math.hypot(ax + bx, ay + by, az + bz, aw + bw)
  return 4 * Math.atan2(dm, dp) * R2D
}
export const ang = (a, b) => angleQuatDeg(a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w)

/** Moyenne de quaternions (hémisphère aligné sur le premier, puis normalisation). */
export function moyenneQuat(THREE, liste) {
  const acc = new THREE.Quaternion(0, 0, 0, 0)
  const q = new THREE.Quaternion()
  const ref = liste[0]
  for (const src of liste) {
    q.copy(src)
    if (q.dot(ref) < 0) q.set(-q.x, -q.y, -q.z, -q.w)
    acc.set(acc.x + q.x, acc.y + q.y, acc.z + q.z, acc.w + q.w)
  }
  return acc.normalize()
}

/** Vecteur vitesse angulaire (°/s) entre deux quaternions séparés de dt. */
export function omega(THREE, qa, qb, dt) {
  const r = qa.clone().invert().multiply(qb)
  if (r.w < 0) r.set(-r.x, -r.y, -r.z, -r.w)
  const s = Math.hypot(r.x, r.y, r.z)
  if (s < 1e-12) return new THREE.Vector3(0, 0, 0)
  const theta = 2 * Math.atan2(s, r.w)
  return new THREE.Vector3(r.x / s, r.y / s, r.z / s).multiplyScalar((theta * R2D) / dt)
}

export const arr1 = (x) => (isFinite(x) ? +x.toFixed(1) : NaN)
export const arr2 = (x) => (isFinite(x) ? +x.toFixed(2) : NaN)
export const arr3 = (x) => (isFinite(x) ? +x.toFixed(3) : NaN)

// ── Domaines : le NOM du fichier est la configuration (cf. vrma/README.md) ──
export const estMonde = (slug) => slug.startsWith('world-')
export const domaine = (slug) => (estMonde(slug) ? 'monde' : 'face')

/**
 * Le face à face a DEUX familles étanches (cf. vrma/README.md) : celle d'Overte,
 * sans préfixe, et celle de Rocketbox, préfixe `rb-`. Elles ne se raccordent
 * jamais l'une à l'autre — 16,5 à 20,3 cm de raccord croisé — donc un clip `rb-`
 * jugé contre le socle d'Overte mesurerait la distance entre deux studios, pas
 * un défaut. C'est la même erreur que « juger un clip assis contre le socle
 * debout », celle qui donnait 79 échecs sur 111.
 */
export const estRocketbox = (slug) => slug.startsWith('rb-')
/** Les deux socles de la famille d'un clip de face à face. */
export const soclesDeFamille = (slug) =>
  estRocketbox(slug) ? ['rb-idle', 'rb-idle-talking'] : ['idle', 'idle-talking']

/**
 * Famille déduite du NOM seul — le nom de fichier EST la configuration, il n'y a
 * pas de fichier de mapping (cf. vrma/README.md). Aucune liste de clips en dur :
 * un clip ajouté ou remplacé pendant que le banc tourne est classé sans rien changer.
 */
export function familleDeduite(slug) {
  if (!estMonde(slug)) {
    // Le préfixe de famille est retiré AVANT la dérivation du rôle, exactement
    // comme le fait catalogFromUrls : `rb-idle-2` est bien un socle.
    const base = (estRocketbox(slug) ? slug.slice('rb-'.length) : slug).replace(/-\d+$/, '')
    if (base === 'idle') return 'socle'
    if (base === 'idle-talking') return 'socle parlant'
    if (base === 'listen') return 'socle écoute'
    return 'geste'
  }
  const s = slug.slice('world-'.length)
  if (/^(walk|run|jog)(-back)?(-slow|-fast)?$/.test(s)) return 'allure'
  if (/^(strafe|step)-/.test(s)) return 'allure'
  if (/^turn-/.test(s)) return 'pivot'
  if (/^walk-(start|stop)(-.+)?$/.test(s)) return 'transition'
  if (/^sit-(enter|exit)$/.test(s)) return 'transition'
  if (/^sit-/.test(s)) return 'assis'
  if (/^(clap|point|raise-hand)-(in|out|hold)$/.test(s)) return 'geste tenu'
  if (/^idle-alt\d+$/.test(s)) return 'repos'
  if (/^idle-alt\d+-(enter|exit)$/.test(s)) return 'transition'
  if (/^jump-/.test(s)) return 'saut'
  return 'monde'
}

/** La famille, en préférant ce que world.json affirme au nom seul. */
export const familleDe = (slug, worldJson) => worldJson?.clips?.[slug]?.famille ?? familleDeduite(slug)

/** Boucle déduite du NOM seul (le repli quand world.json manque). */
export const boucleDeduite = (slug) =>
  /^idle(-talking)?(-\d+)?$/.test(slug) ||
  // Famille Rocketbox : les mêmes socles, plus celui d'ÉCOUTE, qui boucle aussi.
  /^rb-(idle|idle-talking|listen)(-\d+)?$/.test(slug) ||
  /^world-.*-(idle|loop|talking|hold)(-\d+)?$/.test(slug) ||
  (/^world-(walk|run|jog|strafe|step|turn)(-[a-z0-9]+)*$/.test(slug) &&
    !/-(start|stop|enter|exit|end|in|out)(-|$)/.test(slug))

/** Voisins d'enchaînement déduits du NOM seul (le repli quand world.json manque). */
export function enchaineDeduit(slug) {
  let m
  if (slug === 'world-walk-start') return { depuis: 'idle', vers: 'world-walk' }
  if (/^world-walk-stop/.test(slug)) return { depuis: 'world-walk', vers: 'idle' }
  if (slug === 'world-sit-enter') return { depuis: 'idle', vers: 'world-sit-idle' }
  if (slug === 'world-sit-exit') return { depuis: 'world-sit-idle', vers: 'idle' }
  if ((m = /^world-(.+)-in$/.exec(slug))) return { depuis: 'idle', vers: `world-${m[1]}-hold` }
  if ((m = /^world-(.+)-out$/.exec(slug))) return { depuis: `world-${m[1]}-hold`, vers: 'idle' }
  if ((m = /^world-(idle-alt\d+)-enter$/.exec(slug))) return { depuis: 'idle', vers: `world-${m[1]}` }
  if ((m = /^world-(idle-alt\d+)-exit$/.exec(slug))) return { depuis: `world-${m[1]}`, vers: 'idle' }
  if ((m = /^(world-sit-turn-(?:left|right))-end$/.exec(slug))) return { depuis: m[1], vers: 'world-sit-idle' }
  return null
}

// ════════════════════════════════════════════════════════════════════════════
// L'ADAPTATEUR DE RIG
//
// Tout ce qui suit ne connaît du modèle que cet objet — c'est ce qui permet à la
// page (vrai .vrm chargé par GLTFLoader) et à la sonde (rig factice Mixamo, ou
// squelette d'un vrai .vrm monté à la main) de partager le même code :
//
//   osTous      : string[]                  os humanoïdes présents
//   noeudOs     : Map<nomDeNoeud, os>       pour retrouver l'os d'une piste
//   reposQ      : Map<os, Quaternion>       pose de repos du rig NORMALISÉ,
//                                           telle que le mixer la restaurera
//   reposHips   : Vector3                   position de repos des hanches
//   scene       : Object3D                  racine pour l'AnimationMixer
//   noeudNorm(os) : Object3D | null         os normalisé (ce que le clip écrit)
//   noeudBrut(os) : Object3D | null         os réel (vraies positions monde)
//   majHumanoide() : void                   humanoid.update() + updateWorldMatrix
// ════════════════════════════════════════════════════════════════════════════

/** Applique une pose au rig et rend les positions MONDE des os majeurs. */
export function appliquer(THREE, rig, pose) {
  for (const os of rig.osTous) {
    const n = rig.noeudNorm(os)
    if (n) n.quaternion.copy(pose.q.get(os) ?? rig.reposQ.get(os) ?? IDENT)
  }
  const h = rig.noeudNorm('hips')
  if (h) h.position.copy(pose.p ?? rig.reposHips)
  rig.majHumanoide()
  const out = new Map()
  for (const os of OS_MAJEURS) {
    const o = rig.noeudBrut(os)
    if (o) out.set(os, o.getWorldPosition(new THREE.Vector3()))
  }
  return out
}
const IDENT = { x: 0, y: 0, z: 0, w: 1 }

/** Sauvegarde / restauration de la pose courante : les mesures ne doivent RIEN casser. */
export function sauverPose(THREE, rig) {
  const q = new Map()
  for (const os of rig.osTous) {
    const n = rig.noeudNorm(os)
    if (n) q.set(os, n.quaternion.clone())
  }
  const h = rig.noeudNorm('hips')
  return { q, p: h ? h.position.clone() : null }
}
export function restaurerPose(rig, snap) {
  for (const [os, v] of snap.q) rig.noeudNorm(os)?.quaternion.copy(v)
  if (snap.p) rig.noeudNorm('hips')?.position.copy(snap.p)
  rig.majHumanoide()
}

// ── Échantillonneur d'un AnimationClip (interpolants : aucun mixer requis) ──

/**
 * Transforme un AnimationClip (issu de createVRMAnimationClip) en fonction
 * `ech(t) → { q: Map<os, Quaternion>, p: Vector3|null }`.
 * Les pistes qui ne visent pas un os humanoïde (regard, expressions) sont ignorées.
 */
export function echantillonneur(THREE, rig, clip) {
  const rot = new Map()
  let pos = null
  for (const t of clip.tracks) {
    const i = t.name.lastIndexOf('.')
    if (i < 0) continue
    const os = rig.noeudOs.get(t.name.slice(0, i))
    if (!os) continue
    if (t.name.endsWith('.quaternion')) rot.set(os, t.createInterpolant())
    else if (t.name.endsWith('.position') && os === 'hips') pos = t.createInterpolant()
  }
  const ech = (t) => {
    const q = new Map()
    for (const [os, it] of rot) {
      const v = it.evaluate(t)
      q.set(os, new THREE.Quaternion(v[0], v[1], v[2], v[3]))
    }
    let p = null
    if (pos) { const v = pos.evaluate(t); p = new THREE.Vector3(v[0], v[1], v[2]) }
    return { q, p }
  }
  return { ech, osAnimes: new Set(rot.keys()), aTranslation: !!pos, duree: clip.duration }
}

// ── Pose de référence d'un socle ────────────────────────────────────────────

/**
 * Pose de référence d'un socle : moyenne sur un tour de boucle.
 * `poses` garde les échantillons, pour pouvoir donner la FOURCHETTE de l'écart
 * selon la phase du socle au moment du déclenchement (et pas seulement l'écart
 * à la moyenne).
 */
export function poseReference(THREE, rig, ech, duree) {
  const n = Math.max(1, Math.round(duree * FPS)) // [0, durée) : pas de doublon de couture
  const poses = []
  for (let i = 0; i < n; i++) poses.push(ech((i / FPS) % duree))
  const q = new Map()
  const disp = new Map()
  for (const os of rig.osTous) {
    const liste = poses.map((p) => p.q.get(os)).filter(Boolean)
    if (!liste.length) {
      q.set(os, (rig.reposQ.get(os) ?? new THREE.Quaternion()).clone())
      disp.set(os, 0)
      continue
    }
    const m = moyenneQuat(THREE, liste)
    q.set(os, m)
    disp.set(os, Math.max(...liste.map((x) => ang(x, m))))
  }
  const p = poses[0].p
    ? poses.reduce((a, x) => a.add(x.p), new THREE.Vector3()).multiplyScalar(1 / poses.length)
    : rig.reposHips.clone()
  const ref = { q, p, disp, poses, duree, osAnimes: new Set() }
  for (const os of rig.osTous) if (poses.some((x) => x.q.has(os))) ref.osAnimes.add(os)
  ref.positions = appliquer(THREE, rig, ref)
  ref.dispersionMaxDeg = arr2(Math.max(0, ...[...disp].filter(([o]) => OS_MAJEURS.includes(o)).map(([, v]) => v)))
  return ref
}

// ── L'ÉCART DE RACCORD : le cœur du banc ────────────────────────────────────

/**
 * Écart d'une pose de clip à la pose de référence d'un socle.
 *   maxDeg / osMax : écart angulaire maximal et l'os responsable (doigts exclus) ;
 *   maxCm / osCm   : distance parcourue en position MONDE par l'os le plus
 *                    concerné — LE chiffre du verdict ;
 * plus de quoi comprendre : moyennes haut / bas / jambes, pieds, hanches.
 */
export function ecart(THREE, rig, pose, ref) {
  let maxDeg = 0, osMax = null, sH = 0, nH = 0, sB = 0, nB = 0, sJ = 0, nJ = 0
  let maxJ = 0, osJ = null, maxDoigt = 0, osDoigt = null, maxH = 0, osH = null
  const complet = new Map()
  for (const os of rig.osTous) {
    const a = pose.q.get(os) ?? rig.reposQ.get(os)
    if (a) complet.set(os, a)
    const b = ref.q.get(os)
    if (!a || !b) continue
    const d = ang(a, b)
    if (estDoigt(os)) { if (d > maxDoigt) { maxDoigt = d; osDoigt = os }; continue }
    if (!OS_MAJEURS.includes(os)) continue
    if (d > maxDeg) { maxDeg = d; osMax = os }
    if (OS_HAUT.includes(os)) { sH += d; nH++; if (d > maxH) { maxH = d; osH = os } } else { sB += d; nB++ }
    if (OS_JAMBES.includes(os)) { sJ += d; nJ++; if (d > maxJ) { maxJ = d; osJ = os } }
  }
  const p = appliquer(THREE, rig, { q: complet, p: pose.p })
  let maxCm = 0, osCm = null, piedCm = 0
  for (const [os, v] of p) {
    const r = ref.positions.get(os)
    if (!r) continue
    const d = v.distanceTo(r) * 100
    if (d > maxCm) { maxCm = d; osCm = os }
    if (os === 'leftFoot' || os === 'rightFoot') piedCm = Math.max(piedCm, d)
  }
  const hipsDy = ((pose.p?.y ?? rig.reposHips.y) - ref.p.y) * 100
  return {
    maxDeg: arr1(maxDeg), osMax,
    maxHautDeg: arr1(maxH), osHaut: osH,
    moyHautDeg: arr1(nH ? sH / nH : 0), moyBasDeg: arr1(nB ? sB / nB : 0),
    moyJambesDeg: arr1(nJ ? sJ / nJ : 0), maxJambeDeg: arr1(maxJ), osJambe: osJ,
    maxDoigtDeg: arr1(maxDoigt), osDoigt,
    maxCm: arr1(maxCm), osCm, piedCm: arr1(piedCm),
    hipsDyCm: arr1(hipsDy),
    verdict: verdict(maxCm),
  }
}

/** Fourchette de l'écart selon la PHASE du socle (le socle tourne en continu). */
export function ecartParPhase(THREE, rig, pose, ref) {
  let mn = Infinity, mx = 0
  for (const ps of ref.poses) {
    let m = 0
    for (const os of OS_MAJEURS) {
      const a = pose.q.get(os) ?? rig.reposQ.get(os)
      const b = ps.q.get(os) ?? ref.q.get(os)
      if (a && b) m = Math.max(m, ang(a, b))
    }
    mn = Math.min(mn, m); mx = Math.max(mx, m)
  }
  return { min: arr1(mn), max: arr1(mx) }
}

// ── SIMULATION DU FONDU RÉEL ────────────────────────────────────────────────
//
// Réplique fidèle de vrmStage.ts : poids de fondu dont la somme vaut 1 par
// construction, avancement du fondu AVANT mixer.update, LoopOnce +
// clampWhenFinished sur le geste, fondu de retour déclenché par 'finished'.
//
// Ce que ça mesure : le pic de vitesse angulaire PENDANT les fondus, comparé au
// pic PENDANT le clip. Si la transition est plus violente que l'animation, l'œil
// le voit comme une secousse — et c'est un défaut mesurable, pas une impression.

function fadeWeights(from, to, p) {
  const out = new Map()
  for (const [a, w] of from) out.set(a, w * (1 - p))
  out.set(to, p + (from.get(to) ?? 0) * (1 - p))
  return out
}

export function simulerFondu(THREE, rig, clipGeste, clipSocle, opts = {}) {
  const AVANT = opts.avant ?? 0.5 // socle seul avant le déclenchement
  const APRES = opts.apres ?? 0.6 // socle seul après le fondu de sortie
  const mixer = new THREE.AnimationMixer(rig.scene)
  const aSocle = mixer.clipAction(clipSocle)
  const aGeste = mixer.clipAction(clipGeste)
  aSocle.setLoop(THREE.LoopRepeat, Infinity)

  const poids = new Map()
  let fade = null, active = null, fini = false
  const setW = (a, w) => { a.enabled = w > 0; a.setEffectiveWeight(w); if (w > 0) poids.set(a, w); else poids.delete(a) }
  const poser = (next) => { for (const [a, w] of next) setW(a, w) }
  const fadeTo = (next, duree) => {
    if (active === next) return
    const from = new Map(poids)
    next.paused = false; next.enabled = true; next.play()
    active = next
    if (from.size === 0 || duree <= 0) { fade = null; poser(fadeWeights(from, next, 1)); return }
    fade = { to: next, from, elapsed: 0, duree }
    poser(fadeWeights(from, next, 0))
  }
  const onFini = (e) => { if (e.action === active) { fini = true; fadeTo(aSocle, GESTURE_RETURN) } }
  mixer.addEventListener('finished', onFini)
  fadeTo(aSocle, 0)

  const total = AVANT + clipGeste.duration + GESTURE_RETURN + APRES
  const frames = []
  let t = 0, declenche = false, sommeMin = Infinity

  while (t <= total) {
    let etiq
    if (!declenche) etiq = 'socle'
    else if (fade && fade.to === aGeste) etiq = 'entree'
    else if (fade && fade.to === aSocle) etiq = 'sortie'
    else if (fini) etiq = 'retour'
    else etiq = 'clip'

    if (fade) {
      fade.elapsed += DT_SIM
      const p = Math.min(1, fade.elapsed / fade.duree)
      poser(fadeWeights(fade.from, fade.to, p))
      if (p >= 1) fade = null
    }
    let s = 0; for (const w of poids.values()) s += w
    sommeMin = Math.min(sommeMin, s)
    mixer.update(DT_SIM)

    const q = new Map()
    for (const os of rig.osTous) { const n = rig.noeudNorm(os); if (n) q.set(os, n.quaternion.clone()) }
    rig.majHumanoide()
    const p = new Map()
    for (const os of OS_MAJEURS) { const o = rig.noeudBrut(os); if (o) p.set(os, o.getWorldPosition(new THREE.Vector3())) }
    frames.push({ t, etiq, q, p })

    if (!declenche && t >= AVANT) {
      aGeste.reset(); aGeste.setLoop(THREE.LoopOnce, 1); aGeste.clampWhenFinished = true
      fadeTo(aGeste, GESTURE_FADE)
      declenche = true
    }
    t += DT_SIM
  }
  mixer.removeEventListener('finished', onFini)
  mixer.stopAllAction()
  mixer.uncacheClip(clipGeste)
  mixer.uncacheClip(clipSocle)
  mixer.uncacheRoot(rig.scene)

  const phases = {}
  for (const k of ['socle', 'entree', 'clip', 'sortie', 'retour']) {
    phases[k] = { deg: 0, osDeg: null, cm: 0, osCm: null, serie: [] }
  }
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i]
    const ph = b.etiq === 'clip' && a.etiq === 'entree' ? 'entree'
      : b.etiq === 'retour' && a.etiq === 'sortie' ? 'sortie' : b.etiq
    const c = phases[ph]
    let parImage = 0
    for (const os of rig.osTous) {
      const qa = a.q.get(os), qb = b.q.get(os)
      if (!qa || !qb) continue
      if (estDoigt(os) || !OS_MAJEURS.includes(os)) continue
      const v = ang(qa, qb) / DT_SIM
      if (v > parImage) parImage = v
      if (v > c.deg) { c.deg = v; c.osDeg = os }
      const pa = a.p.get(os), pb = b.p.get(os)
      if (pa && pb) { const s = (pa.distanceTo(pb) * 100) / DT_SIM; if (s > c.cm) { c.cm = s; c.osCm = os } }
    }
    c.serie.push(parImage)
  }
  // Le MAX du clip est fragile : une seule image écrêtée à 1000 °/s suffit à
  // écraser le ratio. On garde donc le 95e centile et la médiane — c'est à EUX
  // qu'il faut comparer le fondu pour dire « le raccord est plus violent que
  // l'animation ».
  for (const k of ['socle', 'entree', 'clip', 'sortie', 'retour']) {
    const s = [...phases[k].serie].sort((x, y) => x - y)
    phases[k].p95 = s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(0.95 * s.length))]) : 0
    phases[k].med = s.length ? Math.round(s[Math.floor(0.5 * s.length)]) : 0
    delete phases[k].serie
    phases[k].deg = Math.round(phases[k].deg)
    phases[k].cm = Math.round(phases[k].cm)
  }
  // Contrôle croisé des centimètres, par un chemin TOTALEMENT indépendant de
  // `ecart()` : parcours réel du pire os entre la première et la dernière image
  // du fondu de sortie. Les deux doivent se rejoindre à quelques % près.
  const iS = frames.findIndex((f) => f.etiq === 'sortie')
  let jS = -1
  for (let i = frames.length - 1; i >= 0; i--) if (frames[i].etiq === 'sortie') { jS = i; break }
  let parcours = 0, osParcours = null
  if (iS > 0 && jS > iS) {
    for (const os of OS_MAJEURS) {
      const a = frames[iS - 1].p.get(os), b = frames[jS + 1]?.p.get(os) ?? frames[jS].p.get(os)
      if (a && b) { const d = a.distanceTo(b) * 100; if (d > parcours) { parcours = d; osParcours = os } }
    }
  }
  phases.sortie.parcoursCm = arr1(parcours)
  phases.sortie.osParcours = osParcours
  phases.sommePoidsMin = arr2(sommeMin)
  phases.ratioSortieP95 = arr2(phases.sortie.deg / Math.max(1, phases.clip.p95))
  phases.ratioEntreeP95 = arr2(phases.entree.deg / Math.max(1, phases.clip.p95))
  phases.ratioSortieMax = arr2(phases.sortie.deg / Math.max(1, phases.clip.deg))
  return phases
}

// ── Couture de boucle ───────────────────────────────────────────────────────

/** Raccord d'un clip en boucle sur lui-même : pose ET vitesse. */
export function coutureBoucle(THREE, rig, ech, duree) {
  const n = Math.round(duree * FPS)
  if (n < 4) return null
  const dt = 1 / FPS
  const p0 = ech(0), p1 = ech(dt)
  const pF = ech(Math.max(0, duree - EPS))
  const pFm = ech(Math.max(0, duree - EPS - dt))
  let maxDeg = 0, osMax = null, discont = 0, osDisc = null
  for (const os of OS_MAJEURS) {
    const a = pF.q.get(os), b = p0.q.get(os)
    if (a && b) { const d = ang(a, b); if (d > maxDeg) { maxDeg = d; osMax = os } }
    const c1 = pFm.q.get(os), c2 = pF.q.get(os), c3 = p0.q.get(os), c4 = p1.q.get(os)
    if (c1 && c2 && c3 && c4) {
      const d = omega(THREE, c3, c4, dt).sub(omega(THREE, c1, c2, dt)).length()
      if (d > discont) { discont = d; osDisc = os }
    }
  }
  const pa = appliquer(THREE, rig, pF), pb = appliquer(THREE, rig, p0)
  let maxCm = 0, osCm = null
  for (const os of OS_MAJEURS) {
    const x = pa.get(os), y = pb.get(os)
    if (x && y) { const d = x.distanceTo(y) * 100; if (d > maxCm) { maxCm = d; osCm = os } }
  }
  return {
    maxDeg: arr2(maxDeg), osMax, maxCm: arr2(maxCm), osCm,
    discontVitDegS: Math.round(discont), osDiscont: osDisc,
  }
}

// ── SÉQUENCES : les raccords aux JOINTURES d'un enchaînement ────────────────

/** Les enchaînements que l'app fera, et qui décideront de la scène interactive. */
export const SEQUENCES = [
  { nom: 'marche', etapes: ['world-walk-start', 'world-walk', 'world-walk-stop', 'idle'] },
  { nom: 'assise', etapes: ['idle', 'world-sit-enter', 'world-sit-idle', 'world-sit-exit', 'idle'] },
]

/**
 * Écart de pose à une JONCTION : dernière image de A ↔ première image de B.
 *
 * Si A boucle, sa « dernière image » n'a aucun sens — le clip sera quitté à une
 * phase quelconque. On échantillonne donc TOUT le cycle et on juge sur le PIRE
 * cas : c'est lui qui décidera de la crédibilité de la scène, pas la moyenne.
 *
 * SAUF si un CONTRAT DE PHASE existe (world.json, `phaseSortieCibleS` /
 * `phaseEntreeCibleS`) : wander.ts quitte alors le cycle À CETTE PHASE (l'arrêt
 * attend la couture de la marche) ou démarre le cycle d'arrivée à la sienne
 * (world-walk repris à t = 0,200 s après walk-start). Juger la jointure à une
 * autre phase, c'est juger un enchaînement que le code ne fait jamais.
 *   opts.phaseA : A (boucle) est quitté à cet instant précis ;
 *   opts.phaseB : B (boucle) est repris à cet instant, pas à t = 0.
 *
 * `a` et `b` : { slug, ech, duree, boucle }.
 */

/** Le contrat de phase d'une jointure a → b, lu dans world.json (`enchaine`). */
export function contratPhase(worldJson, aSlug, bSlug) {
  const metaA = worldJson?.clips?.[aSlug] ?? null
  const metaB = worldJson?.clips?.[bSlug] ?? null
  let phaseA = null, phaseB = null
  // Sortie du cycle amont : déclarée sur le clip d'arrivée (walk-stop : « quitte
  // world-walk à t = 0 ») ou sur le cycle lui-même (clap-hold : « je suis quitté
  // à t = 0 vers world-clap-out »).
  if (metaB?.enchaine?.depuis === aSlug && metaB.enchaine.phaseSortieCibleS != null) phaseA = metaB.enchaine.phaseSortieCibleS
  if (phaseA == null && metaA?.enchaine?.vers === bSlug && metaA.enchaine.phaseSortieCibleS != null) phaseA = metaA.enchaine.phaseSortieCibleS
  // Entrée dans le cycle aval : déclarée sur le clip sortant (walk-start :
  // « world-walk reprend à t = 0,200 s », jamais à t = 0).
  if (metaA?.enchaine?.vers === bSlug && metaA.enchaine.phaseEntreeCibleS != null) phaseB = metaA.enchaine.phaseEntreeCibleS
  return { phaseA, phaseB }
}

export function mesurerJonction(THREE, rig, a, b, opts = {}) {
  const phaseB = opts.phaseB != null ? Math.min(Math.max(0, opts.phaseB), Math.max(0, b.duree - EPS)) : 0
  const poseB = b.ech(phaseB)
  const qB = new Map(poseB.q)
  for (const os of rig.osTous) if (!qB.has(os)) qB.set(os, (rig.reposQ.get(os) ?? new THREE.Quaternion()).clone())
  const refB = { q: qB, p: poseB.p ?? rig.reposHips.clone(), poses: [poseB] }
  refB.positions = appliquer(THREE, rig, { q: qB, p: poseB.p })

  const instants = []
  if (a.boucle && opts.phaseA != null) {
    instants.push(Math.min(Math.max(0, opts.phaseA), Math.max(0, a.duree - EPS)))
  } else if (a.boucle) {
    const n = Math.max(1, Math.round(a.duree * FPS))
    for (let i = 0; i < n; i++) instants.push((i / FPS) % a.duree)
  } else {
    instants.push(Math.max(0, a.duree - EPS))
  }
  let pire = null, meilleur = null, somme = 0
  for (const t of instants) {
    const x = ecart(THREE, rig, a.ech(t), refB)
    somme += x.maxCm
    if (!pire || x.maxCm > pire.maxCm) pire = { ...x, t: arr2(t) }
    if (!meilleur || x.maxCm < meilleur.maxCm) meilleur = { ...x, t: arr2(t) }
  }
  return {
    de: a.slug, vers: b.slug, aBoucle: !!a.boucle, phases: instants.length,
    phaseA: a.boucle && opts.phaseA != null ? arr2(instants[0]) : null,
    phaseB: opts.phaseB != null ? arr2(phaseB) : null,
    pireCm: pire.maxCm, osPire: pire.osCm, pireDeg: pire.maxDeg, osPireDeg: pire.osMax, tPire: pire.t,
    meilleurCm: meilleur.maxCm, moyenneCm: arr1(somme / instants.length),
    verdict: verdict(pire.maxCm),
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LE RÉFÉRENTIEL DE JUGEMENT — chaque clip est jugé contre CE QU'IL RACCORDE
//
// « 79 échoue » venait d'un tableau qui jugeait TOUS les clips contre le socle
// debout, alors qu'un clip assis est à ~45 cm de la pose debout PAR CONSTRUCTION
// — c'est la hauteur d'une chaise, pas un défaut. Le verdict n'a de sens que
// contre le référentiel que l'app utilisera vraiment :
//   · geste face à face  → les socles debout DE SA FAMILLE (idle / idle-talking
//     pour Overte, rb-idle / rb-idle-talking pour Rocketbox) — les deux familles
//     ne se raccordent jamais l'une à l'autre, les croiser mesurerait 16 à 20 cm
//     d'écart de studio ;
//   · geste assis        → le socle assis (world-sit-idle), celui vers lequel
//     il revient réellement en fondu ;
//   · boucle qui tourne (allure, pivot, repos alterné, geste tenu, socle assis
//     lui-même) → sa COUTURE : pose ET vitesse à l'endroit où elle se referme,
//     la seule chose que l'œil peut y voir ;
//   · transition (walk-start, sit-enter, clap-in…) → ses JOINTURES de séquence :
//     dernière image du clip amont contre sa première, sa dernière contre la
//     première du clip aval — world.json (`enchaine`) dit qui enchaîne avec qui.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Le référentiel d'un clip : { type: 'socles' | 'couture' | 'jonctions', … }.
 * `libelle` est ce que la colonne « jugé contre » du tableau affiche.
 */
export function referentielDe(slug, worldJson) {
  const meta = worldJson?.clips?.[slug] ?? null
  if (!estMonde(slug)) {
    // …et un clip de face à face contre les socles de SA famille (jamais ceux de
    // l'autre : voir estRocketbox).
    const socles = soclesDeFamille(slug)
    return { type: 'socles', socles, libelle: socles.join(' / ') }
  }
  const fam = familleDe(slug, worldJson)
  const boucle = meta ? !!meta.boucle : boucleDeduite(slug)
  if (boucle) {
    // Les pivots assis (world-sit-turn-*) sont des CYCLES de rotation continue,
    // pas des gestes : comme une allure, aucune de leurs phases ne ressemble au
    // socle assis — c'est leur couture qui se juge, et leurs clips -end qui
    // portent le retour vers world-sit-idle.
    if (fam === 'assis' && slug !== 'world-sit-idle' && !/^world-sit-turn-/.test(slug)) {
      return { type: 'socles', socles: ['world-sit-idle'], libelle: 'world-sit-idle' }
    }
    return { type: 'couture', libelle: 'sa couture (boucle)' }
  }
  const ench = meta?.enchaine ?? enchaineDeduit(slug)
  if (ench && (ench.depuis || ench.vers)) {
    return {
      type: 'jonctions', de: ench.depuis ?? null, vers: ench.vers ?? null,
      libelle: `jointures ${ench.depuis ?? '?'} → clip → ${ench.vers ?? '?'}`,
    }
  }
  if (fam === 'assis') return { type: 'socles', socles: ['world-sit-idle'], libelle: 'world-sit-idle' }
  return { type: 'socles', socles: ['idle', 'idle-talking'], libelle: 'idle / idle-talking' }
}

/**
 * Vitesse angulaire interne du clip (°/s, os majeurs, grille FPS) : LE point de
 * comparaison pour dire si une couture est « plus violente que l'animation
 * elle-même » — un saut de 300 °/s sur une course qui tourne à 500 °/s est
 * invisible, le même saut sur un repos à 30 °/s est un coup de fouet.
 */
export function vitesseInterneDegS(THREE, rig, ech, duree) {
  const n = Math.max(2, Math.round(duree * FPS))
  const dt = 1 / FPS
  const serie = []
  let prev = ech(0)
  for (let i = 1; i < n; i++) {
    const cur = ech(Math.min(duree - EPS, i * dt))
    let m = 0
    for (const os of OS_MAJEURS) {
      const a = prev.q.get(os), b = cur.q.get(os)
      if (a && b) { const v = ang(a, b) / dt; if (v > m) m = v }
    }
    serie.push(m)
    prev = cur
  }
  const s = [...serie].sort((x, y) => x - y)
  return {
    max: Math.round(s[s.length - 1] ?? 0),
    p95: Math.round(s[Math.min(s.length - 1, Math.floor(0.95 * s.length))] ?? 0),
    med: Math.round(s[Math.floor(0.5 * s.length)] ?? 0),
  }
}

// Une couture se franchit en UNE image (1/30 s), pas en un fondu de 0,3 s : ses
// seuils de POSE sont donc bien plus stricts que ceux des raccords en fondu.
export const SEUIL_COUTURE_EXCELLENT_CM = 0.5
export const SEUIL_COUTURE_PASSE_CM = 2
export const SEUIL_COUTURE_ECHEC_CM = 4

export function verdictCouturePose(cm) {
  if (!isFinite(cm)) return 'inconnu'
  if (cm > SEUIL_COUTURE_ECHEC_CM) return 'echoue'
  if (cm > SEUIL_COUTURE_PASSE_CM) return 'limite'
  if (cm > SEUIL_COUTURE_EXCELLENT_CM) return 'passe'
  return 'excellent'
}

/**
 * Discontinuité de vitesse à la couture, RELATIVE au p95 du clip (plancher
 * 60 °/s : en dessous de 2°/image, aucun saut n'est visible, quel que soit le
 * clip). > 2 × le p95 = coup de fouet ; entre 1,25 et 2 = à regarder.
 */
export function verdictCoutureVitesse(discontDegS, p95DegS) {
  if (!isFinite(discontDegS)) return 'inconnu'
  const r = discontDegS / Math.max(60, p95DegS || 0)
  if (r > 2) return 'echoue'
  if (r > 1.25) return 'limite'
  if (r > 0.75) return 'passe'
  return 'excellent'
}

/**
 * Juge un clip contre SON référentiel. Le contexte fournit les clips et les
 * socles — la page et la sonde en donnent chacune un, le jugement est LE MÊME :
 *   ctx.echPour(slug)  → { ech, duree } | null
 *   ctx.socleRef(nom)  → pose de référence (poseReference) | null
 *   ctx.boucle(slug)   → bool
 *   ctx.worldJson
 * Rend { referentiel, verdict, raccords?, couture?, vitesseInterne?, jonctions? }.
 */
export function jugerReferentiel(THREE, rig, ctx, slug) {
  const referentiel = referentielDe(slug, ctx.worldJson)
  const e = ctx.echPour(slug)
  if (!e) return null
  const out = { referentiel, verdict: 'inconnu' }

  if (referentiel.type === 'socles') {
    const pE = e.ech(0)
    const pS = e.ech(Math.max(0, e.duree - EPS))
    out.raccords = {}
    const verdicts = []
    for (const nomSocle of referentiel.socles) {
      const ref = ctx.socleRef(nomSocle)
      if (!ref) continue
      const entree = ecart(THREE, rig, pE, ref)
      const sortie = ecart(THREE, rig, pS, ref)
      out.raccords[nomSocle] = {
        entree: { ...entree, phaseSocle: ecartParPhase(THREE, rig, pE, ref) },
        sortie: { ...sortie, phaseSocle: ecartParPhase(THREE, rig, pS, ref) },
        verdict: pireVerdict(entree.verdict, sortie.verdict),
      }
      verdicts.push(out.raccords[nomSocle].verdict)
    }
    if (verdicts.length) out.verdict = pireVerdict(...verdicts)
    else out.socleAbsent = true
    return out
  }

  if (referentiel.type === 'couture') {
    out.couture = coutureBoucle(THREE, rig, e.ech, e.duree)
    out.vitesseInterne = vitesseInterneDegS(THREE, rig, e.ech, e.duree)
    if (out.couture) {
      out.verdictPose = verdictCouturePose(out.couture.maxCm)
      out.verdictVitesse = verdictCoutureVitesse(out.couture.discontVitDegS, out.vitesseInterne.p95)
      out.verdict = pireVerdict(out.verdictPose, out.verdictVitesse)
    }
    return out
  }

  // jonctions — la mécanique de l'onglet Séquences, appliquée au clip seul.
  const moi = { slug, ech: e.ech, duree: e.duree, boucle: !!ctx.boucle(slug) }
  const voisin = (s) => {
    const v = s === slug ? e : ctx.echPour(s)
    return v ? { slug: s, ech: v.ech, duree: v.duree, boucle: !!ctx.boucle(s) } : null
  }
  out.jonctions = []
  if (referentiel.de) {
    const a = voisin(referentiel.de)
    if (a) out.jonctions.push(mesurerJonction(THREE, rig, a, moi, contratPhase(ctx.worldJson, referentiel.de, slug)))
    else out.jonctions.push({ de: referentiel.de, vers: slug, absent: true })
  }
  if (referentiel.vers) {
    const b = voisin(referentiel.vers)
    if (b) out.jonctions.push(mesurerJonction(THREE, rig, moi, b, contratPhase(ctx.worldJson, slug, referentiel.vers)))
    else out.jonctions.push({ de: slug, vers: referentiel.vers, absent: true })
  }
  const js = out.jonctions.filter((j) => !j.absent)
  if (js.length) out.verdict = pireVerdict(...js.map((j) => j.verdict))
  return out
}

// ════════════════════════════════════════════════════════════════════════════
// GRANDEURS DU MONDE 3D — celles que world.json affirme, et qu'il faut vérifier
// ════════════════════════════════════════════════════════════════════════════

export const HANCHES_RIG_MESURE = 1.0167 // m — rig sur lequel world.json est mesuré

/**
 * AVANT du personnage, déduit de la GÉOMÉTRIE des épaules — jamais du quaternion
 * du bassin. Le +Z local du bassin ne désigne pas l'avant de la même façon d'un
 * rig à l'autre (un VRM 0.x le porte à l'envers), et une rotation globale du
 * modèle n'y change rien puisqu'elle tourne aussi les pieds. Le produit
 * `haut × (épaule gauche → épaule droite)` est, lui, indépendant de la version
 * VRM et des conventions d'axes. C'est la formule qu'index.html utilise déjà pour
 * le lacet du buste : les deux mesures parlent donc du même « avant ».
 */
export function avantGeometrique(THREE, rig, out = new THREE.Vector3()) {
  const g = rig.noeudBrut('leftShoulder') ?? rig.noeudBrut('leftUpperArm')
  const d = rig.noeudBrut('rightShoulder') ?? rig.noeudBrut('rightUpperArm')
  if (!g || !d) return out.set(0, 0, 1)
  const cote = d.getWorldPosition(new THREE.Vector3()).sub(g.getWorldPosition(new THREE.Vector3()))
  cote.y = 0
  if (cote.lengthSq() < 1e-8) return out.set(0, 0, 1)
  cote.normalize()
  return out.set(0, 1, 0).cross(cote).normalize() // haut × côté = avant
}

/**
 * Hauteur de hanches AU REPOS du rig courant, en position monde (donc échelle de
 * scène comprise). C'est le dénominateur de toutes les fractions de world.json
 * et le numérateur du facteur d'échelle.
 */
export function hanchesAuRepos(THREE, rig) {
  const snap = sauverPose(THREE, rig)
  const pos = appliquer(THREE, rig, { q: new Map(), p: rig.reposHips })
  restaurerPose(rig, snap)
  const h = pos.get('hips')
  return h ? h.y : NaN
}

/**
 * Parcours d'un cycle : tout ce qui se mesure image par image et que world.json
 * affirme — hauteur du bassin (en fraction), distance parcourue par le pied en
 * appui (donc la vitesse de l'allure), rotation, déplacement horizontal.
 *
 * DISTANCE PAR CYCLE — deux estimateurs, et c'est volontaire.
 *
 * Le clip est joué sur place : les hanches ne se déplacent pas, c'est le pied en
 * appui qui recule. Son recul EST l'avance que le code devra appliquer.
 *
 *   distanceParCycleM (prudent) : à chaque image, on ne compte que le recul du
 *     pied en appui — celui qui était le plus BAS au début de l'intervalle. Aucune
 *     hypothèse de symétrie, aucun facteur 2 deviné. Sous-estime légèrement, car
 *     l'image où l'appui change est attribuée à un pied qui décolle.
 *   distanceParCycleLargeM (large) : somme, pour CHAQUE pied, de tout son recul
 *     sur le cycle. Majore : un pied peut reculer un peu pendant son envol.
 *     Cette somme n'a PAS de signe propre (on n'y garde que les reculs positifs) :
 *     le sens de l'allure lui est donné par `signeAvance`, une somme des mêmes
 *     intervalles PONDÉRÉE par la bassesse du pied porteur. Il valait autrefois
 *     `Math.sign(prudent)`, ce qui marchait tant que le prudent restait loin de
 *     zéro — mais sur une COURSE il tombe au résidu numérique (world-run-back :
 *     −0,006 m sur le rig de mesure, +0,0006 m sur un autre), et il retournait
 *     alors TOUTE la fourchette, donc le verdict d'accord avec world.json, selon
 *     le modèle chargé. La pondération éteint les images de vol au lieu de les
 *     compter à plein : sur les vingt allures du dépôt, le signe pondéré est
 *     d'accord avec le prudent partout, et il ne dépend plus du modèle.
 *
 * La vérité est entre les deux. Les afficher tous les deux évite de faire passer
 * une convention de mesure pour une propriété du clip.
 *
 * ROTATION PAR CYCLE — même piège, PAS de remède fiable, et il faut le dire.
 * Un pivot est joué sur place : le bassin ne tourne pas (lire son lacet donne 0).
 * On la cherche donc dans le pied en appui, qui garde son cap dans le monde
 * pendant que le corps pivote — mais la cheville TOURNE aussi activement pendant
 * un pivot, et rien ne sépare les deux. Mesuré sur les pieds, `world-turn-left`
 * donne 76° quand world.json annonce 53° : l'estimation est INDICATIVE, et le
 * banc ne peut pas trancher. Sur un cycle refermé, la rotation n'est simplement
 * plus dans le fichier — elle n'existe que dans la métadonnée.
 */
export function mesurerCycle(THREE, rig, ech, duree, hanchesRepos) {
  const n = Math.max(2, Math.round(duree * FPS) + 1)
  const dt = duree / (n - 1)
  let hMin = Infinity, hMax = -Infinity, hSum = 0
  let hDebut = NaN, hFin = NaN
  let piedYMin = Infinity, piedYMax = -Infinity
  let distance = 0, lateral = 0
  let reculG = 0, reculD = 0
  // Le module de l'estimateur LARGE est solide, son SIGNE ne l'est pas : il n'a
  // pas de sens propre (on n'y somme que des reculs positifs) et il était
  // emprunté au prudent. Sur une COURSE, le prudent peut tomber au résidu
  // numérique et changer de signe d'un modèle à l'autre. On mémorise donc les
  // intervalles avec la HAUTEUR du pied porteur, pour en tirer après coup une
  // somme pondérée par l'appui — voir `signeAvance` plus bas.
  const intervalles = []
  let lacetBassin = 0, lacetPrec = NaN
  let rotation = 0
  const pDebut = new THREE.Vector3(), pFin = new THREE.Vector3()
  let prev = null
  const snap = sauverPose(THREE, rig)
  /** Lacet (deg) porté par un quaternion, autour de +Y, avant = +Z. */
  const yaw = (q) => {
    const d = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
    return Math.atan2(d.x, d.z) * R2D
  }
  const delta180 = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d }
  for (let i = 0; i < n; i++) {
    const t = Math.min(duree - EPS, i * dt)
    const pose = ech(t)
    const pos = appliquer(THREE, rig, pose)
    const hips = pos.get('hips')
    const avant = avantGeometrique(THREE, rig)
    const cote = new THREE.Vector3(avant.z, 0, -avant.x)
    const lacetH = Math.atan2(avant.x, avant.z) * R2D
    if (isFinite(lacetPrec)) lacetBassin += delta180(lacetH, lacetPrec)
    lacetPrec = lacetH
    // Cap de chaque pied RELATIF au bassin : c'est lui qui porte le pivot.
    const capG = rig.noeudBrut('leftFoot') ? delta180(yaw(rig.noeudBrut('leftFoot').getWorldQuaternion(new THREE.Quaternion())), lacetH) : NaN
    const capD = rig.noeudBrut('rightFoot') ? delta180(yaw(rig.noeudBrut('rightFoot').getWorldQuaternion(new THREE.Quaternion())), lacetH) : NaN
    if (hips) {
      hMin = Math.min(hMin, hips.y); hMax = Math.max(hMax, hips.y); hSum += hips.y
      if (i === 0) { hDebut = hips.y; pDebut.copy(hips) }
      if (i === n - 1) { hFin = hips.y; pFin.copy(hips) }
    }
    const pg = pos.get('leftFoot'), pd = pos.get('rightFoot')
    if (pg) { piedYMin = Math.min(piedYMin, pg.y); piedYMax = Math.max(piedYMax, pg.y) }
    if (pd) { piedYMin = Math.min(piedYMin, pd.y); piedYMax = Math.max(piedYMax, pd.y) }
    // pied en appui = le plus bas ; son recul relatif au bassin EST l'avance du corps
    const appui = pg && pd ? (pg.y <= pd.y ? 'g' : 'd') : pg ? 'g' : 'd'
    const relG = pg && hips ? pg.clone().sub(hips) : null
    const relD = pd && hips ? pd.clone().sub(hips) : null
    if (prev) {
      // Estimateur prudent : l'intervalle est attribué au pied qui était en appui
      // à son DÉBUT (aucune image n'est perdue au changement d'appui).
      const av = prev.avant
      const rel = prev.appui === 'g' ? relG : relD
      const rp = prev.appui === 'g' ? prev.relG : prev.relD
      if (rel && rp) {
        const d = rel.clone().sub(rp)
        distance += -d.dot(av) // recul du pied = avance du corps
        lateral += -d.dot(prev.cote)
        const yAppui = prev.appui === 'g' ? prev.pgY : prev.pdY
        if (isFinite(yAppui)) intervalles.push({ y: yAppui, d: -d.dot(av) })
      }
      // Estimateur large : tout recul de chaque pied, appui ou non.
      if (relG && prev.relG) { const d = -relG.clone().sub(prev.relG).dot(av); if (d > 0) reculG += d }
      if (relD && prev.relD) { const d = -relD.clone().sub(prev.relD).dot(av); if (d > 0) reculD += d }
      // Rotation du personnage = opposé de la dérive du cap du pied en appui.
      const cap = prev.appui === 'g' ? capG : capD
      const capP = prev.appui === 'g' ? prev.capG : prev.capD
      if (isFinite(cap) && isFinite(capP)) rotation += -delta180(cap, capP)
    }
    prev = {
      appui, relG, relD, capG, capD, avant: avant.clone(), cote: cote.clone(),
      pgY: pg ? pg.y : NaN, pdY: pd ? pd.y : NaN,
    }
  }
  restaurerPose(rig, snap)
  // SIGNE DE L'AVANCE, mesuré au lieu d'emprunté. Chaque intervalle pèse la
  // BASSESSE de son pied porteur : 1 au point le plus bas du cycle, 0 au plus
  // haut. Les images de VOL — celles où le pied « le plus bas » ne porte rien et
  // balance en sens inverse — s'éteignent au lieu de compter à plein. Sur les
  // vingt allures du dépôt le signe pondéré tombe d'accord avec le prudent, à
  // une exception : world-run-back, dont le prudent vaut −0,006 m sur le rig de
  // mesure et +0,0006 m sur un autre — un résidu numérique qui retournait toute
  // la fourchette du LARGE, et avec elle le verdict d'accord de world.json.
  const signeAvance = (() => {
    if (!intervalles.length) return Math.sign(distance || 1)
    const ys = intervalles.map((x) => x.y)
    const yLo = Math.min(...ys), yHi = Math.max(...ys)
    let pondere = 0
    for (const x of intervalles) pondere += (yHi > yLo ? 1 - (x.y - yLo) / (yHi - yLo) : 1) * x.d
    return Math.sign(pondere || distance || 1)
  })()
  const f = (y) => (isFinite(hanchesRepos) && hanchesRepos > 0 ? y / hanchesRepos : NaN)
  const dep = pFin.clone().sub(pDebut)
  return {
    hanchesFraction: {
      min: arr3(f(hMin)), max: arr3(f(hMax)), moy: arr3(f(hSum / n)),
      debut: arr3(f(hDebut)), fin: arr3(f(hFin)),
    },
    hanchesM: { min: arr3(hMin), max: arr3(hMax), moy: arr3(hSum / n) },
    piedYCm: [arr1(piedYMin * 100), arr1(piedYMax * 100)],
    distanceParCycleM: arr3(distance),
    distanceParCycleLargeM: arr3(signeAvance * (reculG + reculD)),
    vitesseMS: arr3(distance / Math.max(1e-6, duree)),
    vitesseLargeMS: arr3((signeAvance * (reculG + reculD)) / Math.max(1e-6, duree)),
    vitesseLateraleMS: arr3(lateral / Math.max(1e-6, duree)),
    angleParCycleDeg: arr1(rotation),
    vitesseRotationDegS: arr1(rotation / Math.max(1e-6, duree)),
    lacetBassinDeg: arr1(lacetBassin), // ~0 sur un clip joué sur place : c'est normal
    deplacementM: { x: arr3(dep.x), z: arr3(dep.z), horizontal: arr3(Math.hypot(dep.x, dep.z)) },
  }
}

/**
 * Confronte une affirmation de world.json à la mesure.
 * `echelle` : les MÈTRES et les m/s de world.json valent pour un rig dont les
 * hanches au repos sont à 1,0167 m ; les FRACTIONS, elles, se transportent
 * telles quelles (c'est tout leur intérêt) et ne doivent PAS être mises à l'échelle.
 */
export function confronterFourchette(annonce, bas, haut, { echelle = 1, tolerance = 0.1, minAbs = 0.02 } = {}) {
  if (annonce == null || !isFinite(annonce) || !isFinite(bas) || !isFinite(haut)) return null
  const attendu = annonce * echelle
  const lo = Math.min(bas, haut), hi = Math.max(bas, haut)
  const marge = Math.max(Math.abs(attendu), minAbs) * tolerance
  const dans = attendu >= lo - marge && attendu <= hi + marge
  const proche = attendu < lo ? lo : hi
  const base = Math.max(Math.abs(attendu), minAbs)
  return {
    annonce: arr3(annonce), attendu: arr3(attendu),
    mesureBasse: arr3(lo), mesureHaute: arr3(hi),
    ecartAbs: arr3(dans ? 0 : proche - attendu),
    ecartPct: arr1((dans ? 0 : (proche - attendu) / base) * 100),
    accord: dans,
  }
}

export function confronter(annonce, mesure, { echelle = 1, tolerance = 0.15, minAbs = 0.02 } = {}) {
  if (annonce == null || !isFinite(annonce) || !isFinite(mesure)) return null
  const attendu = annonce * echelle
  const ecartAbs = mesure - attendu
  const base = Math.max(Math.abs(attendu), minAbs)
  const rel = ecartAbs / base
  return {
    annonce: arr3(annonce), attendu: arr3(attendu), mesure: arr3(mesure),
    ecartAbs: arr3(ecartAbs), ecartPct: arr1(rel * 100),
    accord: Math.abs(rel) <= tolerance,
  }
}

/**
 * Confronte TOUTES les affirmations de world.json pour un clip aux mesures.
 * Partagé entre la page et la sonde : les deux doivent conclure la même chose.
 *
 * `echelle` = hanchesAuReposDuRig / 1,0167 — appliquée aux MÈTRES et aux m/s,
 * jamais aux fractions.
 */
export function confronterWorld(meta, cycle, echelle) {
  if (!meta) return { absentDeWorldJson: true, controles: {}, desaccords: [] }
  const out = {
    famille: meta.famille, role: meta.role, boucle: meta.boucle,
    dureeAnnonceeS: meta.dureeS, tailleAnnonceeOctets: meta.tailleOctets,
    doigtsAnimes: meta.doigtsAnimes, enchaine: meta.enchaine ?? null,
    coutureBoucleDeg: meta.coutureBoucleDeg ?? null, raccordVitesse: meta.raccordVitesse ?? null,
    controles: {}, coherenceInterne: null,
  }
  const d = meta.deplacement ?? {}
  if (d.vitesseMS != null) {
    out.controles.vitesseMS = confronterFourchette(d.vitesseMS, cycle.vitesseMS, cycle.vitesseLargeMS, { echelle, tolerance: 0.1, minAbs: 0.05 })
    out.controles.distanceParCycleM = confronterFourchette(d.distanceParCycleM, cycle.distanceParCycleM, cycle.distanceParCycleLargeM, { echelle, tolerance: 0.1, minAbs: 0.05 })
    // world.json affirme DEUX grandeurs liées par la durée : si distance ÷ durée
    // ne redonne pas la vitesse, l'incohérence est DANS le fichier, pas dans la mesure.
    if (d.distanceParCycleM != null && meta.dureeS) {
      const implicite = d.distanceParCycleM / meta.dureeS
      const ecartPct = ((d.vitesseMS - implicite) / Math.max(Math.abs(implicite), 1e-6)) * 100
      out.coherenceInterne = {
        vitesseImpliciteMS: arr3(implicite), vitesseAnnonceeMS: arr3(d.vitesseMS),
        ecartPct: arr1(ecartPct), coherent: Math.abs(ecartPct) <= 2,
      }
    }
  }
  if (d.angleParCycleDeg != null) {
    // INDICATIF : voir mesurerCycle. Le banc ne peut pas trancher un pivot.
    out.controles.angleParCycleDeg = {
      ...confronter(d.angleParCycleDeg, cycle.angleParCycleDeg, { echelle: 1, tolerance: 0.2, minAbs: 3 }),
      fiable: false,
      pourquoi: 'cycle refermé : la rotation n’est plus dans le fichier, et le cap du pied en appui mélange le pivot du corps et la torsion de la cheville',
    }
  }
  if (d.deplacementM) {
    const annonce = Math.hypot(d.deplacementM.x ?? 0, d.deplacementM.z ?? 0)
    out.controles.deplacementHorizontalM = confronter(annonce, cycle.deplacementM.horizontal, { echelle, tolerance: 0.2, minAbs: 0.03 })
  }
  // Les FRACTIONS ne se mettent PAS à l'échelle : c'est tout leur intérêt.
  if (meta.hanchesFraction) {
    for (const k of ['min', 'max', 'debut', 'fin']) {
      if (meta.hanchesFraction[k] != null) {
        out.controles['hanchesFraction.' + k] = confronter(meta.hanchesFraction[k], cycle.hanchesFraction[k], { echelle: 1, tolerance: 0.05, minAbs: 0.02 })
      }
    }
  }
  const texte = (k, v) => `${k} : annoncé ${v.annonce} → attendu ${v.attendu}, mesuré ${v.mesure ?? `${v.mesureBasse}…${v.mesureHaute}`} (${v.ecartPct > 0 ? '+' : ''}${v.ecartPct} %)`
  const rates = Object.entries(out.controles).filter(([, v]) => v && !v.accord)
  out.desaccords = rates.filter(([, v]) => v.fiable !== false).map(([k, v]) => texte(k, v))
  out.reserves = rates.filter(([, v]) => v.fiable === false).map(([k, v]) => `${texte(k, v)} — non concluant : ${v.pourquoi}`)
  if (out.coherenceInterne && !out.coherenceInterne.coherent) {
    out.desaccords.push(`world.json incohérent avec lui-même : distanceParCycleM ÷ dureeS = ${out.coherenceInterne.vitesseImpliciteMS} m/s, mais vitesseMS annonce ${out.coherenceInterne.vitesseAnnonceeMS} (${out.coherenceInterne.ecartPct > 0 ? '+' : ''}${out.coherenceInterne.ecartPct} %)`)
  }
  return out
}
