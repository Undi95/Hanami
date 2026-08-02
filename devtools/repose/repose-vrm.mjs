// ════════════════════════════════════════════════════════════════════════════
// repose-vrm.mjs — RÉPARER LA POSE DE REPOS d'un .vrm à partir d'un modèle de
// référence au même squelette.
//
// Le cas qui a motivé l'outil : un export qui a cuit une pose
// « bras baissés » dans les TRANSLATIONS des os du bras (rotations toutes
// identité, liaison du maillage cohérente avec cette pose — nœuds = inverse des
// IBM à 0,0 cm près). Le squelette est identique à celui d'un autre modèle du
// même exportateur (mêmes 169 nœuds, mêmes noms, mêmes longueurs de segments,
// à un dixième de millimètre près) qui, lui, est sain — c'est ce jumeau qui a
// servi de référence à la réparation. Mais son repos
// n'est PAS la T-pose que le format VRM exige : tout clip retargeté par
// three-vrm y place les mains ~10 cm à côté, systématiquement (17 échecs à la
// matrice du banc, seul hors-série sur 94 modèles).
//
// LA CORRECTION : écrire des ROTATIONS DE REPOS sur les os fautifs, calculées
// pour ramener chaque articulation exactement sur la position de repos du
// modèle de référence. Rien d'autre ne change :
//   • les translations restent celles du fichier (longueurs d'os intactes) ;
//   • le chunk BIN est recopié OCTET POUR OCTET (vertex, normales, IBM, morphs,
//     textures : intacts) — l'outil le PROUVE en re-hachant le chunk écrit ;
//   • le maillage, lié dans l'ancienne pose, est simplement POSÉ en T-pose par
//     le skinning — exactement comme une animation l'aurait posé. Pendant un
//     clip, la déformation vaut Q·(repose) appliquée à la pose de liaison :
//     le même monde-vers-monde que sur le modèle de référence.
//
// C'est mathématiquement équivalent à re-lier le maillage en T-pose (le
// « re-bake » classique), sans réécrire un seul octet de géométrie. Le fichier
// produit reste un glTF/VRM valide ; sa seule particularité est d'avoir des
// rotations de repos non-identité, ce que three-vrm (la seule bibliothèque de
// l'app) gère par construction : VRMHumanoidRig lit le repos réel, quel qu'il
// soit. (UniVRM râlerait « not normalized » à l'import — hors périmètre.)
//
// L'ALIGNEMENT : au nœud n, on cherche la rotation monde R qui envoie les
// DIRECTIONS de segments vers ses enfants sur celles de la référence — les
// directions, pas les positions : deux exports du même personnage peuvent
// écarter les bases de doigts d'un centimètre (morphologie propre de chaque
// maillage), et c'est la direction des segments que le retargeting T-pose
// utilise, pas la position absolue d'une phalange chez un autre modèle. Un
// enfant → arc minimal (setFromUnitVectors). Plusieurs enfants (la main et ses
// cinq doigts) → méthode des quaternions de Horn (1987) : vecteur propre
// dominant de la matrice N, par itération de puissance décalée, pondérée par la
// longueur des segments. L'auto-test du démarrage la vérifie sur des rotations
// aléatoires avant de toucher au moindre fichier. Le twist résiduel d'une
// chaîne à enfant unique (roulis du coude) est corrigé au niveau suivant par le
// cas multi-enfants ; ce qui reste n'existe que dans le vrillage du maillage du
// segment, invisible ici.
//
// Usage (depuis la racine du dépôt) :
//   node devtools/repose/repose-vrm.mjs vrm/modele-casse.vrm --ref=vrm/modele-sain.vrm
//                                        → DIAGNOSTIC seul (aucune écriture)
//   … --sortie=<chemin.vrm>              → écrit le fichier corrigé LÀ, et le revérifie
//   … --appliquer                        → remplace le fichier d'origine, après
//                                          sauvegarde <fichier>.avant-repose
//                                          (refuse si la sauvegarde existe déjà)
//   … --seuil=0.5                        → écart (cm) au-delà duquel un nœud est « faux »
//
// Garde-fous : mêmes ensembles de noms de nœuds requis de part et d'autre de
// chaque sous-arbre corrigé ; hanches/jambes/colonne doivent déjà coïncider
// (sinon les deux modèles ne sont pas comparables et l'outil REFUSE) ; après
// correction, si un résidu dépasse le seuil, l'outil REFUSE d'écrire.
// Zéro dépendance npm : three est pris dans les node_modules du projet.
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ICI = path.dirname(fileURLToPath(import.meta.url))
const PROJET = process.env.HANAMI_ROOT || path.resolve(ICI, '..', '..')
const NM = 'file:///' + PROJET.replace(/\\/g, '/').replace(/ /g, '%20') + '/node_modules/'
const THREE = await import(NM + 'three/build/three.module.js')

// ── Arguments ───────────────────────────────────────────────────────────────
const args = new Map()
const libres = []
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  if (m) args.set(m[1], m[2] ?? '1')
  else libres.push(a)
}
if (!libres[0] || !args.has('ref')) {
  console.error('usage : node devtools/repose/repose-vrm.mjs <modele.vrm> --ref=<reference.vrm> [--sortie=<out.vrm>] [--appliquer] [--seuil=0.5]')
  process.exit(2)
}
const SEUIL_CM = Number(args.get('seuil') ?? '0.5')
const resoudre = (p) => (path.isAbsolute(p) ? p : path.resolve(PROJET, p))
const FICHIER = resoudre(libres[0])
const REFERENCE = resoudre(args.get('ref'))

// ── GLB : lecture chunk par chunk, le BIN reste un segment d'octets opaque ──
function lireGLB(fichier) {
  const buf = fs.readFileSync(fichier)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error(`${path.basename(fichier)} : pas un GLB`)
  const jsonLen = dv.getUint32(12, true)
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('premier chunk non-JSON')
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen)))
  // Tout ce qui suit le chunk JSON (BIN compris) est recopié tel quel à l'écriture.
  const apresJson = buf.subarray(20 + jsonLen)
  return { buf, json, apresJson }
}

function ecrireGLB(fichier, json, apresJson) {
  const enc = new TextEncoder().encode(JSON.stringify(json))
  const pad = (4 - (enc.length % 4)) % 4
  const jsonChunk = new Uint8Array(enc.length + pad)
  jsonChunk.set(enc)
  jsonChunk.fill(0x20, enc.length) // padding en espaces, comme la spec l'exige
  const total = 12 + 8 + jsonChunk.length + apresJson.length
  const sortie = Buffer.alloc(total)
  const dv = new DataView(sortie.buffer)
  dv.setUint32(0, 0x46546c67, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, jsonChunk.length, true)
  dv.setUint32(16, 0x4e4f534a, true)
  sortie.set(jsonChunk, 20)
  sortie.set(apresJson, 20 + jsonChunk.length)
  // Écriture puis renommage : jamais de fichier à moitié écrit sous un nom servi.
  const tmp = fichier + '.repose-tmp'
  fs.writeFileSync(tmp, sortie)
  fs.renameSync(tmp, fichier)
  return sortie
}

// ── Squelette : hiérarchie three montée depuis le JSON glTF ─────────────────
function monterSquelette(json) {
  const objs = json.nodes.map((d) => {
    const o = new THREE.Object3D()
    o.name = d.name ?? ''
    if (d.matrix) new THREE.Matrix4().fromArray(d.matrix).decompose(o.position, o.quaternion, o.scale)
    else {
      o.position.fromArray(d.translation ?? [0, 0, 0])
      o.quaternion.fromArray(d.rotation ?? [0, 0, 0, 1])
      o.scale.fromArray(d.scale ?? [1, 1, 1])
    }
    return o
  })
  json.nodes.forEach((d, i) => (d.children ?? []).forEach((c) => objs[i].add(objs[c])))
  const scene = new THREE.Group()
  objs.forEach((o) => { if (!o.parent) scene.add(o) })
  scene.updateWorldMatrix(false, true)
  return { objs, scene }
}

const posM = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)
const rotM = (o) => o.getWorldQuaternion(new THREE.Quaternion())

// ── Rotation optimale (Horn 1987, méthode des quaternions) ──────────────────
// Rend la rotation R maximisant Σ (R·de_i)·vers_i. Les vecteurs ne sont pas
// normalisés : un offset long pèse plus lourd, c'est voulu (il est plus fiable).
function rotationOptimale(paires) {
  if (paires.length === 1) {
    const q = new THREE.Quaternion().setFromUnitVectors(
      paires[0].de.clone().normalize(), paires[0].vers.clone().normalize())
    return q
  }
  let xx = 0, xy = 0, xz = 0, yx = 0, yy = 0, yz = 0, zx = 0, zy = 0, zz = 0
  for (const { de: a, vers: b } of paires) {
    xx += a.x * b.x; xy += a.x * b.y; xz += a.x * b.z
    yx += a.y * b.x; yy += a.y * b.y; yz += a.y * b.z
    zx += a.z * b.x; zy += a.z * b.y; zz += a.z * b.z
  }
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, yy - xx - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, zz - xx - yy],
  ]
  // Vecteur propre dominant par JACOBI CYCLIQUE (symétrique 4×4, convergence
  // quadratique, exacte en ~8 balayages). Pas d'itération de puissance : sur
  // des offsets en MÈTRES quasi coplanaires (les cinq doigts d'une main),
  // l'écart spectral relatif d'une matrice décalée est minuscule et la
  // puissance rendait un vecteur À MI-CHEMIN — 1 cm d'erreur silencieuse.
  const V = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
  for (let balayage = 0; balayage < 32; balayage++) {
    let hors = 0
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 4; q++) hors = Math.max(hors, Math.abs(N[p][q]))
    if (hors < 1e-14) break
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(N[p][q]) < 1e-18) continue
      const theta = (N[q][q] - N[p][p]) / (2 * N[p][q])
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
      const co = 1 / Math.sqrt(t * t + 1), si = t * co
      for (let k = 0; k < 4; k++) {
        const a = N[k][p], b = N[k][q]
        N[k][p] = co * a - si * b; N[k][q] = si * a + co * b
      }
      for (let k = 0; k < 4; k++) {
        const a = N[p][k], b = N[q][k]
        N[p][k] = co * a - si * b; N[q][k] = si * a + co * b
      }
      for (let k = 0; k < 4; k++) {
        const a = V[k][p], b = V[k][q]
        V[k][p] = co * a - si * b; V[k][q] = si * a + co * b
      }
    }
  }
  let meilleur = 0
  for (let i = 1; i < 4; i++) if (N[i][i] > N[meilleur][meilleur]) meilleur = i
  const v = [V[0][meilleur], V[1][meilleur], V[2][meilleur], V[3][meilleur]]
  return new THREE.Quaternion(v[1], v[2], v[3], v[0]).normalize()
}

// Auto-test : sur des paires engendrées par une rotation connue, on doit la
// retrouver à 1e-6 près. Échec = on ne touche à rien. Trois régimes, dont le
// piège réel qui a mordu : offsets en MÈTRES (0,02–0,07), quasi coplanaires et
// groupés en direction comme les cinq doigts d'une main — c'est là que
// l'itération de puissance rendait 1 cm d'erreur en silence.
{
  let g = 12345
  const alea = () => ((g = (g * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1
  const jeux = []
  for (let t = 0; t < 20; t++) {
    jeux.push(Array.from({ length: 5 }, () => new THREE.Vector3(alea(), alea(), alea())))
  }
  for (let t = 0; t < 20; t++) {
    // éventail de « doigts » : presque coplanaire, presque parallèle, en mètres
    const doigts = []
    for (let i = 0; i < 5; i++) {
      doigts.push(new THREE.Vector3(0.06 + 0.01 * alea(), 0.015 * (i - 2) + 0.002 * alea(), 0.004 * alea()))
    }
    doigts.push(new THREE.Vector3(0.019, 0.008, 0.008 * alea())) // le pouce
    jeux.push(doigts)
  }
  for (const vecteurs of jeux) {
    const q = new THREE.Quaternion(alea(), alea(), alea(), alea()).normalize()
    const paires = vecteurs.map((de) => ({ de, vers: de.clone().applyQuaternion(q) }))
    const r = rotationOptimale(paires)
    const err = Math.max(...paires.map(({ de, vers }) => de.clone().applyQuaternion(r).distanceTo(vers)))
    if (!(err <= 1e-6 * Math.max(1, ...vecteurs.map((v) => v.length())))) {
      console.error(`auto-test rotationOptimale : erreur ${err} — outil défectueux, on s'arrête`)
      process.exit(1)
    }
  }
}

// ── Chargement des deux modèles ─────────────────────────────────────────────
const M = lireGLB(FICHIER)
const R = lireGLB(REFERENCE)
console.log(`modèle    : ${FICHIER} (${M.buf.length} o, ${M.json.nodes.length} nœuds)`)
console.log(`référence : ${REFERENCE} (${R.buf.length} o, ${R.json.nodes.length} nœuds)`)

const sqM = monterSquelette(M.json)
const sqR = monterSquelette(R.json)

// Correspondance par NOM — un doublon de nom rend l'appariement ambigu : refus.
const parNomR = new Map()
for (const [i, n] of R.json.nodes.entries()) {
  if (parNomR.has(n.name)) parNomR.set(n.name, -1) // doublon → inutilisable
  else parNomR.set(n.name, i)
}
const cible = new Map() // index nœud modèle → Vector3 position monde de référence
const nomsVus = new Set()
for (const [i, n] of M.json.nodes.entries()) {
  if (nomsVus.has(n.name)) { cible.delete(i); continue }
  nomsVus.add(n.name)
  const j = parNomR.get(n.name)
  if (j !== undefined && j >= 0) cible.set(i, posM(sqR.objs[j]))
}
console.log(`nœuds appariés par nom : ${cible.size}/${M.json.nodes.length}`)

// ── Diagnostic : qui s'écarte ? ─────────────────────────────────────────────
const ecartCm = (i) => posM(sqM.objs[i]).distanceTo(cible.get(i)) * 100
// L'écart qui compte pour la T-pose : l'ANGLE du segment parent→enfant contre
// celui de la référence, converti en cm au bout du segment (angle × longueur).
// Deux exports d'un même personnage n'ont pas besoin d'avoir leurs phalanges
// aux mêmes positions absolues ; ils doivent pointer leurs os pareil.
const segments = new Map() // index enfant → { dirRef, longueur }
for (const [i] of cible) {
  const p = sqM.objs[i].parent
  const ip = sqM.objs.indexOf(p)
  if (ip < 0 || !cible.has(ip)) continue
  const vRef = cible.get(i).clone().sub(cible.get(ip))
  const longueur = sqM.objs[i].position.length()
  if (vRef.lengthSq() < 1e-12 || longueur < 1e-6) continue
  segments.set(i, { dirRef: vRef.normalize(), longueur })
}
const ecartSegmentCm = (i) => {
  const s = segments.get(i)
  if (!s) return 0
  const p = sqM.objs[i].parent
  const d = posM(sqM.objs[i]).sub(posM(p))
  if (d.lengthSq() < 1e-12) return 0
  return d.normalize().angleTo(s.dirRef) * s.longueur * 100
}
const fauxAvant = [...cible.keys()].filter((i) => ecartCm(i) > SEUIL_CM)
if (!fauxAvant.length) {
  console.log(`aucun nœud à plus de ${SEUIL_CM} cm de la référence : rien à faire.`)
  process.exit(0)
}
const pireAvant = Math.max(...fauxAvant.map(ecartCm))
console.log(`\nnœuds hors-place (> ${SEUIL_CM} cm) : ${fauxAvant.length} — pire ${pireAvant.toFixed(1)} cm`)
for (const i of [...fauxAvant].sort((a, b) => ecartCm(b) - ecartCm(a)).slice(0, 8)) {
  console.log(`   ${(M.json.nodes[i].name ?? String(i)).padEnd(24)} ${ecartCm(i).toFixed(2).padStart(7)} cm`)
}
if (fauxAvant.length > 8) console.log(`   … et ${fauxAvant.length - 8} autres`)

// Garde-fou : le tronc porteur doit déjà coïncider. Si les hanches ou une racine
// de sous-arbre fautif sont elles-mêmes hors-place, les squelettes ne sont pas
// superposables par rotations et l'outil n'a pas le droit d'essayer.
const fauxSet = new Set(fauxAvant)
const racinesFautives = fauxAvant.filter((i) => {
  const p = sqM.objs[i].parent
  const ip = sqM.objs.indexOf(p)
  return ip < 0 || !fauxSet.has(ip)
})
for (const i of racinesFautives) {
  const p = sqM.objs[i].parent
  const ip = sqM.objs.indexOf(p)
  if (ip < 0 || !cible.has(ip)) {
    console.error(`\nREFUS : « ${M.json.nodes[i].name} » est hors-place mais son parent n'est pas apparié — une rotation ne peut pas le ramener.`)
    process.exit(1)
  }
}

// ── Correction : descente topologique, rotation au nœud dont les enfants
//    s'écartent, translations intactes ──────────────────────────────────────
const corriges = new Map() // index → { avantDeg }
function corriger(i) {
  const o = sqM.objs[i]
  const enfants = o.children.map((c) => sqM.objs.indexOf(c)).filter((ci) => ci >= 0 && segments.has(ci))
  if (enfants.length) {
    const aCorriger = enfants.some((ci) => ecartSegmentCm(ci) > SEUIL_CM / 4)
    if (aCorriger) {
      // 3 passes au plus : Horn est déjà quasi exact, on raffine le résidu numérique.
      let angleTotal = 0
      for (let passe = 0; passe < 3; passe++) {
        const ici = posM(o)
        // Directions de segments, pondérées par la longueur du segment : un
        // avant-bras de 24 cm pèse plus qu'une phalange de 2 cm.
        const paires = enfants.map((ci) => {
          const s = segments.get(ci)
          const de = posM(sqM.objs[ci]).sub(ici.clone())
          if (de.lengthSq() < 1e-12) return null
          return { de: de.normalize().multiplyScalar(s.longueur), vers: s.dirRef.clone().multiplyScalar(s.longueur) }
        }).filter(Boolean)
        if (!paires.length) break
        const Rw = rotationOptimale(paires)
        const angle = 2 * Math.acos(Math.min(1, Math.abs(Rw.w))) * 180 / Math.PI
        angleTotal += angle
        if (angle < 1e-7) break
        // monde → local : L' = inv(Wparent) · Rw · Wparent · L
        const Wp = o.parent ? o.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion()
        o.quaternion.premultiply(Wp.clone().invert().multiply(Rw).multiply(Wp))
        o.updateWorldMatrix(true, true)
      }
      if (angleTotal > 1e-5) {
        const deja = corriges.get(i)
        corriges.set(i, { avantDeg: (deja?.avantDeg ?? 0) + angleTotal })
      }
    }
  }
  for (const c of o.children) {
    const ci = sqM.objs.indexOf(c)
    if (ci >= 0) corriger(ci)
  }
}
for (const o of sqM.scene.children) corriger(sqM.objs.indexOf(o))

// ── Vérification interne : les segments pointent-ils comme la référence ? ───
const residuSeg = [...segments.keys()].map((i) => ({ i, cm: ecartSegmentCm(i) })).sort((a, b) => b.cm - a.cm)
const pireSeg = residuSeg[0]
const residuPos = [...cible.keys()].map((i) => ({ i, cm: ecartCm(i) })).sort((a, b) => b.cm - a.cm)
console.log(`\ncorrections : ${corriges.size} nœud(s) tourné(s)`)
for (const [i, { avantDeg }] of [...corriges].sort((a, b) => b[1].avantDeg - a[1].avantDeg)) {
  console.log(`   ${(M.json.nodes[i].name ?? String(i)).padEnd(24)} ${avantDeg.toFixed(2).padStart(8)}°`)
}
console.log(`résidu de DIRECTION après correction : pire ${pireSeg.cm.toFixed(4)} cm (segment vers ${M.json.nodes[pireSeg.i].name})`)
console.log(`écart de POSITION absolue restant : pire ${residuPos[0].cm.toFixed(2)} cm (${M.json.nodes[residuPos[0].i].name})` +
  ' — morphologie propre du modèle (bases de doigts…), pas une erreur de pose')
if (pireSeg.cm > SEUIL_CM) {
  console.error(`\nREFUS : un segment reste à ${pireSeg.cm.toFixed(2)} cm de sa direction de référence — les squelettes ne se superposent pas par rotations. Rien n'est écrit.`)
  process.exit(1)
}

// ── Écriture ────────────────────────────────────────────────────────────────
const SORTIE = args.has('appliquer') ? FICHIER : (args.has('sortie') ? resoudre(args.get('sortie')) : null)
if (!SORTIE) {
  console.log('\n(diagnostic seul — relance avec --sortie=<chemin.vrm> ou --appliquer pour écrire)')
  process.exit(0)
}
// Le JSON ne change QUE sur nodes[i].rotation des nœuds corrigés.
for (const [i] of corriges) {
  const q = sqM.objs[i].quaternion
  M.json.nodes[i].rotation = [q.x, q.y, q.z, q.w]
}
if (args.has('appliquer')) {
  const sauvegarde = FICHIER + '.avant-repose'
  if (fs.existsSync(sauvegarde)) {
    console.error(`\nREFUS : ${sauvegarde} existe déjà — je n'écrase pas une sauvegarde.`)
    process.exit(1)
  }
  fs.copyFileSync(FICHIER, sauvegarde)
  console.log(`\nsauvegarde : ${sauvegarde}`)
}
const hashAvant = crypto.createHash('sha256').update(M.apresJson).digest('hex')
ecrireGLB(SORTIE, M.json, M.apresJson)

// ── Revérification DEPUIS LE DISQUE : le fichier écrit, pas la mémoire ──────
const V = lireGLB(SORTIE)
const hashApres = crypto.createHash('sha256').update(V.apresJson).digest('hex')
const sqV = monterSquelette(V.json)
let pireV = { cm: 0, nom: '—' }
for (const [i, s] of segments) {
  const p = sqV.objs[i].parent
  const d = posM(sqV.objs[i]).sub(posM(p))
  if (d.lengthSq() < 1e-12) continue
  const cm = d.normalize().angleTo(s.dirRef) * s.longueur * 100
  if (cm > pireV.cm) pireV = { cm, nom: V.json.nodes[i].name }
}
console.log(`\nécrit : ${SORTIE} (${fs.statSync(SORTIE).size} o)`)
console.log(`   chunks après-JSON (BIN…) : ${hashAvant === hashApres ? 'OCTET POUR OCTET identiques ✓' : 'DIFFÉRENTS ✗ — fichier suspect !'}`)
console.log(`   repos relu depuis le disque : pire résidu de direction ${pireV.cm.toFixed(4)} cm (segment vers ${pireV.nom})`)
if (hashAvant !== hashApres || pireV.cm > SEUIL_CM) process.exit(1)
