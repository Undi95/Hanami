// ════════════════════════════════════════════════════════════════════════════
// sonde.mjs — CONTRÔLE HEADLESS du banc d'essai.
//
// Le banc s'affiche dans un navigateur, donc personne ne peut relire ses
// chiffres depuis un terminal. Cette sonde exécute EXACTEMENT le même noyau de
// mesure (./mesures.mjs, le fichier que la page importe) hors navigateur, sur
// les mêmes .vrma, et imprime les chiffres. Si la sonde et la page divergent,
// c'est que la page ne fait pas ce qu'elle dit.
//
// Deux rigs, pour deux questions différentes :
//   --rig=factice  le rig Mixamo des archives de conversion (hanches au repos
//                  1,0167 m), celui sur lequel raccords.json et vrma/world.json
//                  ont été mesurés → permet la COMPARAISON EXACTE avec la
//                  référence. Ces archives (idle-lib.mjs, raccords.json) ne sont
//                  PAS livrées avec le dépôt : ce sont des sous-produits de la
//                  conversion des clips. Pose-les dans devtools/anim-lab/reference/
//                  (ou pointe HANAMI_LAB_REF dessus) et le rig réapparaît ;
//                  sans elles, la sonde ne fait tourner que --rig=vrm ;
//   --rig=vrm      le squelette humanoïde d'un vrai .vrm du projet, monté à la
//                  main depuis le glTF (aucun mesh, aucune texture, donc aucun
//                  DOM requis) → donne les chiffres que la PAGE affichera.
//
// Lecture seule : <racine>/vrma/*.vrma, <racine>/vrm/*.vrm,
// <racine>/node_modules, et les archives de mesure du rig factice si présentes.
// Écriture : uniquement dans le dossier du banc, et seulement si --json est donné.
//
// Usage :
//   node sonde.mjs                          les deux rigs, comparaison à raccords.json
//   node sonde.mjs --rig=vrm --vrm=<chemin>  un modèle précis
//   node sonde.mjs --clips=wave,happy        un sous-ensemble
//   node sonde.mjs --json=sonde-resultats.json
//   node sonde.mjs --sequences               seulement les séquences
//   node sonde.mjs --modeles=tous            LA MATRICE clips × modèles (squelettes
//                                           seuls, sans mesh : rapide) ; ou
//   node sonde.mjs --modeles=a.vrm,b.vrm     un sous-ensemble de modèles
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs'
import path from 'node:path'
import * as M from './mesures.mjs'

const LAB = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.slice(1))))
// La sonde vit dans devtools/anim-lab/ : la racine du dépôt est deux crans
// au-dessus. Aucun chemin en dur — le dépôt peut être cloné n'importe où.
const PROJET = process.env.HANAMI_ROOT || path.resolve(LAB, '..', '..')
const NM = 'file:///' + PROJET.replace(/\\/g, '/').replace(/ /g, '%20') + '/node_modules/'
const VRMA_DIR = path.join(PROJET, 'vrma')
const VRM_DIR = path.join(PROJET, 'vrm')
// Archives de mesure du rig factice, non livrées (cf. en-tête).
const REF = process.env.HANAMI_LAB_REF || path.join(LAB, 'reference')

const THREE = await import(NM + 'three/build/three.module.js')
const { GLTFLoader } = await import(NM + 'three/examples/jsm/loaders/GLTFLoader.js')
const { VRMHumanoid } = await import(NM + '@pixiv/three-vrm/lib/three-vrm.module.js')
const { VRMAnimationLoaderPlugin, createVRMAnimationClip } = await import(
  NM + '@pixiv/three-vrm-animation/lib/three-vrm-animation.module.js'
)

// ── Arguments ───────────────────────────────────────────────────────────────
const args = new Map()
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  if (m) args.set(m[1], m[2] ?? '1')
}
// Sans les archives de mesure, le rig factice n'a pas lieu d'être proposé.
const RIGS = args.has('rig') ? [args.get('rig')] : (fs.existsSync(REF) ? ['factice', 'vrm'] : ['vrm'])
const FILTRE = args.has('clips') ? new Set(args.get('clips').split(',')) : null
const VERBEUX = args.has('v') || args.has('verbeux')

// ── Chargement des clips ────────────────────────────────────────────────────

/** Liste des clips : d'abord l'API du projet (ce que la page voit), sinon le disque. */
async function listerClips() {
  const port = process.env.LAB_PORT || 7799
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/vrm-animations`, { signal: AbortSignal.timeout(4000) })
    if (res.ok) {
      const { animations } = await res.json()
      if (Array.isArray(animations) && animations.length) {
        return { source: `API /api/vrm-animations (port ${port})`, slugs: animations.map((u) => decodeURIComponent(u.split('/').pop()).replace(/\.vrma$/i, '')) }
      }
    }
  } catch { /* le banc ou le projet ne tourne pas : on lit le disque */ }
  return {
    source: `disque ${VRMA_DIR}`,
    slugs: fs.readdirSync(VRMA_DIR).filter((f) => f.toLowerCase().endsWith('.vrma')).map((f) => f.replace(/\.vrma$/i, '')).sort(),
  }
}

function chargerVRMA(buf) {
  const loader = new GLTFLoader()
  loader.register((p) => new VRMAnimationLoaderPlugin(p))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Promise((resolve, reject) => loader.parse(ab, '', resolve, reject))
}

// ── Rig factice (Mixamo, celui de raccords.json et de world.json) ───────────
const versUrl = (p) => 'file:///' + p.replace(/\\/g, '/').replace(/ /g, '%20')

async function rigFactice() {
  const L = await import(versUrl(REF) + '/idle-lib.mjs')
  const vrm = L.vrmFactice()
  return { vrm, nom: 'factice (Mixamo, rig de mesure de world.json)', adapt: adapter(vrm) }
}

// ── Rig d'un vrai .vrm : squelette monté à la main depuis le glTF ───────────
function lireGLB(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('pas un GLB')
  const jl = dv.getUint32(12, true)
  return { json: JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jl))) }
}

// Pose de repos anti T-pose, reprise TELLE QUELLE de vrmStage.ts / index.html.
const REST_POSE_Z = [
  ['leftUpperArm', 1.25], ['rightUpperArm', -1.25],
  ['leftLowerArm', 0.12], ['rightLowerArm', -0.12],
]

function rigVrm(fichier) {
  const { json: vj } = lireGLB(fs.readFileSync(fichier))
  const ext1 = vj.extensions?.VRMC_vrm
  const ext0 = vj.extensions?.VRM
  const metaVersion = ext1 ? '1' : '0'
  const def = {}
  if (ext1) for (const [k, v] of Object.entries(ext1.humanoid.humanBones)) def[k] = v.node
  else if (ext0) for (const b of ext0.humanoid.humanBones) def[b.bone] = b.node
  else throw new Error(`aucune extension VRM dans ${path.basename(fichier)}`)

  const objs = vj.nodes.map((d) => {
    const o = new THREE.Bone()
    o.name = d.name ?? ''
    if (d.matrix) new THREE.Matrix4().fromArray(d.matrix).decompose(o.position, o.quaternion, o.scale)
    else {
      o.position.fromArray(d.translation ?? [0, 0, 0])
      o.quaternion.fromArray(d.rotation ?? [0, 0, 0, 1])
      o.scale.fromArray(d.scale ?? [1, 1, 1])
    }
    return o
  })
  const aParent = new Set()
  vj.nodes.forEach((d, i) => (d.children ?? []).forEach((c) => { objs[i].add(objs[c]); aParent.add(c) }))
  const scene = new THREE.Group()
  for (let i = 0; i < objs.length; i++) if (!aParent.has(i)) scene.add(objs[i])
  scene.updateWorldMatrix(false, true)

  const humanBones = {}
  for (const [k, ni] of Object.entries(def)) if (objs[ni]) humanBones[k] = { node: objs[ni] }
  const humanoid = new VRMHumanoid(humanBones)
  scene.add(humanoid.normalizedHumanBonesRoot)
  // VRMUtils.rotateVRM0, à l'identique : un VRM 0.x regarde le −Z, l'app le
  // retourne pour qu'il fasse face au +Z. Sans ça, l'« avant » du personnage est
  // inversé et toutes les vitesses d'allure changent de signe.
  if (metaVersion === '0') scene.rotation.y = Math.PI
  scene.updateWorldMatrix(false, true)

  const vrm = {
    humanoid, meta: { metaVersion }, expressionManager: null, lookAt: null, scene,
    osBruts: new Map(Object.entries(humanBones).map(([n, b]) => [n, b.node])),
  }
  const a = adapter(vrm)
  // La page pose la même pose de repos anti T-pose AVANT de créer les actions :
  // c'est donc elle que PropertyMixer restaurera pour un os que le socle
  // n'anime pas. La sonde doit poser la même, sinon les os non animés divergent.
  for (const [nom, z] of REST_POSE_Z) {
    const n = a.noeudNorm(nom)
    if (n) { n.rotation.z = z; a.reposQ.set(nom, n.quaternion.clone()) }
  }
  a.majHumanoide()
  return { vrm, nom: `${path.basename(fichier)} (VRM ${metaVersion}.x, ${Object.keys(humanBones).length} os)`, adapt: a }
}

/** Construit l'adaptateur de rig attendu par mesures.mjs. */
function adapter(vrm) {
  const nb = vrm.humanoid.normalizedHumanBones
  const osTous = Object.keys(nb)
  const noeudOs = new Map(osTous.map((os) => [nb[os].node.name, os]))
  const reposQ = new Map(osTous.map((os) => [os, nb[os].node.quaternion.clone()]))
  const reposHips = nb.hips.node.position.clone()
  return {
    osTous, noeudOs, reposQ, reposHips, scene: vrm.scene,
    noeudNorm: (os) => nb[os]?.node ?? null,
    noeudBrut: (os) => vrm.osBruts.get(os) ?? null,
    majHumanoide: () => { vrm.humanoid.update(); vrm.scene.updateWorldMatrix(false, true) },
  }
}

// ── world.json ──────────────────────────────────────────────────────────────
let WORLD = null
try {
  WORLD = JSON.parse(fs.readFileSync(path.join(VRMA_DIR, 'world.json'), 'utf8'))
} catch (e) { console.warn(`world.json illisible : ${e.message}`) }

// ── Référence : raccords.json ───────────────────────────────────────────────
let REF_RACCORDS = null
try {
  REF_RACCORDS = JSON.parse(fs.readFileSync(path.join(REF, 'raccords.json'), 'utf8'))
} catch { /* absent : pas de comparaison */ }

// ════════════════════════════════════════════════════════════════════════════
// Mesure d'un rig complet
// ════════════════════════════════════════════════════════════════════════════

async function mesurerRig(nomRig, ctxRig, opts = {}) {
  const { vrm, adapt, nom } = ctxRig
  const liste = await listerClips()
  const slugs = liste.slugs.filter((s) => !FILTRE || FILTRE.has(s))

  // Chargement + création des clips (liés à CE rig)
  const clips = new Map()
  for (const slug of slugs) {
    const f = path.join(VRMA_DIR, slug + '.vrma')
    if (!fs.existsSync(f)) { console.warn(`  ${slug} : fichier absent`); continue }
    const buf = fs.readFileSync(f)
    const gltf = await chargerVRMA(buf)
    const anim = gltf.userData.vrmAnimations?.[0]
    if (!anim) { console.warn(`  ${slug} : aucune animation VRM`); continue }
    const clip = createVRMAnimationClip(anim, vrm)
    clip.name = slug
    const e = M.echantillonneur(THREE, adapt, clip)
    const meta = WORLD?.clips?.[slug] ?? null
    const boucle = meta ? !!meta.boucle : /^(idle|idle-2|idle-3|idle-talking)$/.test(slug)
    clips.set(slug, { slug, clip, ...e, boucle, meta, taille: buf.length })
  }

  const hanchesRepos = M.hanchesAuRepos(THREE, adapt)
  const echelle = hanchesRepos / M.HANCHES_RIG_MESURE

  // Socles de référence, construits À LA DEMANDE : idle, idle-talking,
  // world-sit-idle… — chaque clip désigne le sien via son référentiel.
  const socles = new Map()
  const socleRefPour = (nomSocle) => {
    if (socles.has(nomSocle)) return socles.get(nomSocle)
    const c = clips.get(nomSocle)
    const ref = c ? M.poseReference(THREE, adapt, c.ech, c.duree) : null
    socles.set(nomSocle, ref)
    return ref
  }
  if (!clips.has('idle') && !clips.has('idle-talking')) {
    throw new Error('ni idle.vrma ni idle-talking.vrma : aucun socle de référence')
  }
  const ctxJuge = {
    echPour: (slug) => clips.get(slug) ?? null,
    socleRef: socleRefPour,
    boucle: (slug) => clips.get(slug)?.boucle ?? M.boucleDeduite(slug),
    worldJson: WORLD,
  }

  if (!opts.silencieux) {
    console.log('')
    console.log(`══ rig ${nomRig} : ${nom}`)
    console.log(`   clips : ${clips.size} (liste : ${liste.source})`)
    console.log(`   hanches au repos : ${hanchesRepos.toFixed(4)} m → facteur d'échelle world.json = ${echelle.toFixed(4)}`)
  }

  const resultats = []
  for (const c of clips.values()) {
    // LE jugement : contre le référentiel du clip, par le noyau partagé — la
    // page fait exactement le même appel avec les mêmes arguments.
    const jug = M.jugerReferentiel(THREE, adapt, ctxJuge, c.slug)
    const r = {
      slug: c.slug, domaine: M.domaine(c.slug), famille: M.familleDe(c.slug, WORLD),
      duree: M.arr2(c.duree), osAnimes: c.osAnimes.size, aTranslation: c.aTranslation,
      tailleOctets: c.taille,
      referentiel: jug.referentiel.libelle, typeRef: jug.referentiel.type,
      raccords: jug.raccords ?? {}, jonctions: jug.jonctions ?? null,
      couture: jug.couture ?? null, vitesseInterne: jug.vitesseInterne ?? null,
      verdictPose: jug.verdictPose ?? null, verdictVitesse: jug.verdictVitesse ?? null,
      verdict: jug.verdict,
    }

    // Simulation du fondu réel — seulement là où le fondu socle→clip existe
    // (les boucles et transitions ne se déclenchent pas depuis un socle).
    r.sim = null
    if (!opts.sansSim && jug.referentiel.type === 'socles') {
      const nomSocle = jug.referentiel.socles.find((s) => clips.has(s))
      const socleClip = nomSocle ? clips.get(nomSocle) : null
      if (socleClip && socleClip.slug !== c.slug) {
        r.sim = M.simulerFondu(THREE, adapt, c.clip, socleClip.clip)
      }
    }

    // Couture pour TOUTES les boucles (celles jugées autrement la gardent en info)
    if (c.boucle && !r.couture) r.couture = M.coutureBoucle(THREE, adapt, c.ech, c.duree)
    if (!opts.sansCycle && r.domaine === 'monde') {
      r.cycle = M.mesurerCycle(THREE, adapt, c.ech, c.duree, hanchesRepos)
      r.monde = M.confronterWorld(c.meta, r.cycle, echelle)
      if (c.meta && c.meta.tailleOctets != null && c.meta.tailleOctets !== c.taille) {
        r.monde.desaccords.push(`taille du fichier : world.json annonce ${c.meta.tailleOctets} o, le fichier en fait ${c.taille} — le clip a changé depuis`)
      }
    }
    resultats.push(r)
  }

  // Séquences
  const sequences = []
  for (const seq of M.SEQUENCES) {
    const etapes = seq.etapes.filter((s) => clips.has(s))
    const manquants = seq.etapes.filter((s) => !clips.has(s))
    if (etapes.length < 2) { sequences.push({ nom: seq.nom, absent: manquants }); continue }
    const jonctions = []
    for (let i = 0; i < etapes.length - 1; i++) {
      jonctions.push(M.mesurerJonction(
        THREE, adapt, clips.get(etapes[i]), clips.get(etapes[i + 1]),
        M.contratPhase(WORLD, etapes[i], etapes[i + 1]),
      ))
    }
    sequences.push({
      nom: seq.nom, etapes, manquants, jonctions,
      verdict: M.pireVerdict(...jonctions.map((j) => j.verdict)),
    })
  }

  return { nomRig, nom, hanchesRepos: M.arr3(hanchesRepos), echelle: M.arr3(echelle), clips: resultats, sequences, socles: [...socles.keys()], sourceListe: liste.source }
}

// ════════════════════════════════════════════════════════════════════════════
// Impression
// ════════════════════════════════════════════════════════════════════════════

const pad = (s, n) => String(s).padEnd(n)
const padL = (s, n) => String(s).padStart(n)
const SYMBOLE = { excellent: '✓✓', passe: '✓ ', limite: '~ ', echoue: '✗✗', inconnu: '? ' }

/** L'écart d'entrée / sortie qui a décidé du verdict, selon le référentiel. */
function chiffresVerdict(r) {
  if (r.typeRef === 'couture') {
    return { e: '—', s: r.couture ? r.couture.maxCm : '—', os: r.couture?.osMax ?? '—' }
  }
  if (r.typeRef === 'jonctions') {
    const amont = r.jonctions?.find((j) => j.vers === r.slug && !j.absent)
    const aval = r.jonctions?.find((j) => j.de === r.slug && !j.absent)
    return { e: amont ? amont.pireCm : '—', s: aval ? aval.pireCm : '—', os: aval?.osPire ?? amont?.osPire ?? '—' }
  }
  // Le raccord qui a DÉCIDÉ : le pire des socles, pas le premier venu.
  const i = Object.values(r.raccords)
    .sort((a, b) => (M.VERDICTS[b.verdict]?.rang ?? -1) - (M.VERDICTS[a.verdict]?.rang ?? -1))[0]
  return i ? { e: i.entree.maxCm, s: i.sortie.maxCm, os: i.sortie.osCm ?? '—' } : { e: '—', s: '—', os: '—' }
}

function imprimer(res) {
  const lignes = [...res.clips].sort((a, b) => {
    const ra = M.VERDICTS[a.verdict]?.rang ?? 9, rb = M.VERDICTS[b.verdict]?.rang ?? 9
    if (ra !== rb) return rb - ra
    if (a.famille !== b.famille) return a.famille.localeCompare(b.famille)
    return a.slug.localeCompare(b.slug)
  })
  console.log('')
  console.log(`   ${pad('clip', 24)} ${pad('famille', 12)} ${padL('durée', 6)} │ ${pad('jugé contre', 34)} │ ${padL('E cm', 6)} ${padL('S cm', 6)} ${pad('os', 14)} │ ${padL('cout.', 6)} ${padL('saut', 5)} ${padL('p95', 5)} │ verdict`)
  console.log('   ' + '─'.repeat(140))
  for (const r of lignes) {
    const c = chiffresVerdict(r)
    console.log(
      `   ${pad(r.slug, 24)} ${pad(r.famille, 12)} ${padL(r.duree, 6)} │ ${pad(r.referentiel, 34)} │ ` +
      `${padL(c.e, 6)} ${padL(c.s, 6)} ${pad(c.os, 14)} │ ` +
      `${padL(r.couture ? r.couture.maxCm : '—', 6)} ${padL(r.couture ? r.couture.discontVitDegS : '—', 5)} ${padL(r.vitesseInterne ? r.vitesseInterne.p95 : '—', 5)} │ ` +
      `${SYMBOLE[r.verdict] ?? '? '} ${r.verdict}`,
    )
  }
  const parV = {}
  for (const r of res.clips) parV[r.verdict] = (parV[r.verdict] ?? 0) + 1
  console.log('   ' + '─'.repeat(140))
  console.log(`   verdicts : ${Object.entries(parV).map(([k, v]) => `${k} ${v}`).join(' · ')}   (raccords ${M.SEUIL_EXCELLENT_CM}/${M.SEUIL_PASSE_CM}/${M.SEUIL_ECHEC_CM} cm · coutures ${M.SEUIL_COUTURE_EXCELLENT_CM}/${M.SEUIL_COUTURE_PASSE_CM}/${M.SEUIL_COUTURE_ECHEC_CM} cm + saut vs p95)`)
  const parFam = new Map()
  for (const r of res.clips) {
    if (!parFam.has(r.famille)) parFam.set(r.famille, {})
    const f = parFam.get(r.famille)
    f[r.verdict] = (f[r.verdict] ?? 0) + 1
  }
  console.log('   par famille :')
  for (const [f, v] of [...parFam].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`     ${pad(f, 16)} ${Object.entries(v).map(([k, n]) => `${k} ${n}`).join(' · ')}`)
  }

  // Séquences
  for (const s of res.sequences) {
    console.log('')
    if (s.absent) { console.log(`   séquence « ${s.nom} » : impossible, clips absents → ${s.absent.join(', ')}`); continue }
    console.log(`   séquence « ${s.nom} » : ${s.etapes.join(' → ')}${s.manquants.length ? `  (absents : ${s.manquants.join(', ')})` : ''} — verdict ${s.verdict}`)
    for (const j of s.jonctions) {
      console.log(
        `     ${pad(j.de + ' → ' + j.vers, 40)} pire ${padL(j.pireCm, 6)} cm (${pad(j.osPire ?? '—', 14)} ${padL(j.pireDeg, 5)}°)` +
        `${j.aBoucle ? `  moy ${padL(j.moyenneCm, 6)} · min ${padL(j.meilleurCm, 6)} sur ${j.phases} phases` : ''}  ${SYMBOLE[j.verdict]} ${j.verdict}`,
      )
    }
  }

  // world.json
  const mondeClips = res.clips.filter((r) => r.monde)
  const desaccords = mondeClips.filter((r) => r.monde.desaccords?.length)
  const reserves = mondeClips.filter((r) => r.monde.reserves?.length)
  const absents = mondeClips.filter((r) => r.monde.absentDeWorldJson)
  console.log('')
  console.log(`   world.json : ${mondeClips.length} clips du domaine monde, ${absents.length} absents du fichier, ${desaccords.length} en désaccord, ${reserves.length} non concluants`)
  if (absents.length) console.log(`     absents de world.json : ${absents.map((r) => r.slug).join(', ')}`)
  for (const r of desaccords) {
    console.log(`     ${r.slug} :`)
    for (const d of r.monde.desaccords) console.log(`        ${d}`)
  }
  for (const r of reserves) {
    console.log(`     ${r.slug} (réserve) :`)
    for (const d of r.monde.reserves) console.log(`        ${d}`)
  }
  console.log('')
  console.log(`   ${pad('clip monde', 20)} ${pad('famille', 12)} ${padL('hanches min–max', 16)} ${padL('annoncé', 8)} │ ${padL('v mes.', 14)} ${padL('v annoncée×éch', 15)} │ ${padL('rot °/cycle', 12)} ${padL('dép h m', 9)}`)
  console.log('   ' + '─'.repeat(122))
  for (const r of mondeClips) {
    if (!r.cycle) continue
    const m = r.monde ?? {}
    const hf = m.controles?.['hanchesFraction.min']
    const v = m.controles?.vitesseMS
    console.log(
      `   ${pad(r.slug, 20)} ${pad(r.famille, 12)} ${padL(`${r.cycle.hanchesFraction.min}–${r.cycle.hanchesFraction.max}`, 16)} ${padL(hf ? hf.annonce : '—', 8)} │ ` +
      `${padL(`${r.cycle.vitesseMS}…${r.cycle.vitesseLargeMS}`, 14)} ${padL(v ? v.attendu : '—', 15)} │ ` +
      `${padL(r.cycle.angleParCycleDeg, 12)} ${padL(r.cycle.deplacementM.horizontal, 9)}`,
    )
  }
}

/** Comparaison au relevé de référence reference/raccords.json (rig factice uniquement). */
function comparerRaccords(res) {
  if (!REF_RACCORDS) { console.log('\n   (raccords.json absent : aucune comparaison possible)'); return }
  const ref = new Map(REF_RACCORDS.clips.map((c) => [c.slug, c]))
  const ecarts = []
  let identiques = 0, nouveaux = []
  for (const r of res.clips) {
    const v = ref.get(r.slug)
    if (!v) { nouveaux.push(r.slug); continue }
    const i = r.raccords['idle']
    if (!i) continue
    const paires = [
      ['entree.maxDeg', i.entree.maxDeg, v.entree.maxDeg, 0.15],
      ['entree.maxCm', i.entree.maxCm, v.entree.maxCm, 0.15],
      ['sortie.maxDeg', i.sortie.maxDeg, v.sortie.maxDeg, 0.15],
      ['sortie.maxCm', i.sortie.maxCm, v.sortie.maxCm, 0.15],
      ['duree', r.duree, v.duree, 0.02],
      ['sim.sortie.deg', r.sim?.sortie.deg, v.sim?.sortie.deg, 2],
      ['sim.clip.p95', r.sim?.clip.p95, v.sim?.clip.p95, 2],
    ]
    const diff = paires.filter(([, a, b, tol]) => isFinite(a) && isFinite(b) && Math.abs(a - b) > tol)
    const osDiff = i.sortie.osCm !== v.sortie.osCm ? [`os de sortie : ${v.sortie.osCm} → ${i.sortie.osCm}`] : []
    if (!diff.length && !osDiff.length) identiques++
    else ecarts.push({ slug: r.slug, diff: [...diff.map(([k, a, b]) => `${k} : ${b} → ${a}`), ...osDiff], tailleRef: v.tailleOctets, taille: r.tailleOctets })
  }
  const disparus = REF_RACCORDS.clips.map((c) => c.slug).filter((s) => !res.clips.some((r) => r.slug === s))
  console.log('')
  console.log(`══ comparaison à raccords.json (généré ${REF_RACCORDS.meta.genere.slice(0, 16).replace('T', ' ')})`)
  console.log(`   ${identiques} clips identiques au relevé · ${ecarts.length} différents · ${nouveaux.length} nouveaux · ${disparus.length} disparus`)
  if (nouveaux.length) console.log(`   nouveaux : ${nouveaux.join(', ')}`)
  if (disparus.length) console.log(`   disparus : ${disparus.join(', ')}`)
  for (const e of ecarts) {
    const tailleChange = e.taille !== e.tailleRef
    console.log(`   ${pad(e.slug, 20)} ${tailleChange ? `FICHIER MODIFIÉ (${e.tailleRef} → ${e.taille} o)` : 'même taille de fichier → écart de MESURE, à expliquer'}`)
    for (const d of e.diff) console.log(`      ${d}`)
  }
  return { identiques, ecarts, nouveaux, disparus }
}

// ════════════════════════════════════════════════════════════════════════════

console.log('sonde du banc d’essai — noyau de mesure ./mesures.mjs, hors navigateur')
console.log(`three r${THREE.REVISION} · projet ${PROJET}`)

// ── LA MATRICE clips × modèles : le même jugement, sur tous les gabarits ────
// Squelettes montés depuis le glTF (aucun mesh, aucune texture) : la boucle
// entière tient en mémoire et en minutes. C'est le pendant headless du bouton
// « passe multi-modèles » de la page — mêmes appels, mêmes chiffres.
if (args.has('modeles')) {
  const demande = args.get('modeles')
  const tousVrm = fs.readdirSync(VRM_DIR).filter((x) => x.toLowerCase().endsWith('.vrm')).sort()
  const fichiers = demande === 'tous' || demande === '1'
    ? tousVrm
    : demande.split(',').map((s) => s.trim()).filter(Boolean)
  const parClip = new Map() // slug → { famille, referentiel, verdicts: [] }
  const modeles = []
  for (const f of fichiers) {
    const chemin = path.isAbsolute(f) ? f : path.join(VRM_DIR, f)
    let ctxRig
    try { ctxRig = rigVrm(chemin) } catch (e) {
      console.error(`   ${path.basename(f)} : ILLISIBLE — ${e.message}`)
      modeles.push({ nom: path.basename(f), echec: e.message })
      continue
    }
    const res = await mesurerRig('vrm', ctxRig, { silencieux: true, sansSim: true, sansCycle: true })
    modeles.push({ nom: path.basename(f), hanchesRepos: res.hanchesRepos })
    const col = modeles.length - 1
    for (const r of res.clips) {
      if (!parClip.has(r.slug)) parClip.set(r.slug, { famille: r.famille, referentiel: r.referentiel, verdicts: [] })
      const c = chiffresVerdict(r)
      parClip.get(r.slug).verdicts[col] = { v: r.verdict, cm: Math.max(+c.e || 0, +c.s || 0) }
    }
    const parV = {}
    for (const r of res.clips) parV[r.verdict] = (parV[r.verdict] ?? 0) + 1
    console.log(`   ${pad(path.basename(f), 44)} hanches ${padL(res.hanchesRepos, 7)} m  ${Object.entries(parV).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
  }
  // Synthèse : quels clips ne passent PAS partout, et sur quels gabarits.
  const ok = modeles.filter((m) => !m.echec)
  console.log('')
  console.log(`── matrice : ${parClip.size} clips × ${ok.length} modèles lisibles (${modeles.length - ok.length} illisibles)`)
  const aProblemes = []
  for (const [slug, ligne] of parClip) {
    const mauvais = []
    ligne.verdicts.forEach((v, i) => {
      if (v && (v.v === 'echoue' || v.v === 'limite')) mauvais.push({ modele: modeles[i], ...v })
    })
    if (mauvais.length) aProblemes.push({ slug, ligne, mauvais })
  }
  console.log(`   ${parClip.size - aProblemes.length} clips passent PARTOUT · ${aProblemes.length} clips en limite/échec quelque part`)
  for (const p of aProblemes.sort((a, b) => b.mauvais.length - a.mauvais.length)) {
    console.log(`   ${pad(p.slug, 26)} (${p.ligne.referentiel}) : ` +
      p.mauvais.map((m) => `${m.modele.nom} ${SYMBOLE[m.v].trim()} ${m.cm} cm`).join(' · '))
  }
  if (args.has('json')) {
    const dest = path.resolve(LAB, args.get('json') === '1' ? 'sonde-matrice.json' : args.get('json'))
    if (!dest.startsWith(LAB)) throw new Error('la sonde n’écrit QUE dans le dossier du banc')
    fs.writeFileSync(dest, JSON.stringify({ modeles, clips: Object.fromEntries(parClip) }, null, 1))
    console.log(`\nécrit : ${dest}`)
  }
  process.exit(0)
}

const sorties = {}
for (const nomRig of RIGS) {
  let ctx
  try {
    if (nomRig === 'factice') ctx = await rigFactice()
    else {
      const f = args.get('vrm') || path.join(VRM_DIR, fs.readdirSync(VRM_DIR).filter((x) => x.toLowerCase().endsWith('.vrm')).sort()[0])
      ctx = rigVrm(f)
    }
  } catch (e) {
    console.error(`\n══ rig ${nomRig} : INDISPONIBLE — ${e.message}`)
    continue
  }
  const res = await mesurerRig(nomRig, ctx)
  imprimer(res)
  if (nomRig === 'factice') res.comparaison = comparerRaccords(res)
  sorties[nomRig] = res
}

if (args.has('json')) {
  const dest = path.resolve(LAB, args.get('json') === '1' ? 'sonde-resultats.json' : args.get('json'))
  if (!dest.startsWith(LAB)) throw new Error('la sonde n’écrit QUE dans le dossier du banc')
  fs.writeFileSync(dest, JSON.stringify(sorties, null, 1))
  console.log(`\nécrit : ${dest}`)
}
