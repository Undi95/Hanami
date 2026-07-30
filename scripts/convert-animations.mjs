/**
 * convert-animations.mjs — GLB (Quaternius) → VRMA (VRMC_vrm_animation 1.0)
 *
 * Convertit le pack d'animations en fichiers .vrma individuels utilisables
 * directement par @pixiv/three-vrm-animation côté client.
 *
 * Usage :
 *   node scripts/convert-animations.mjs                 convertit puis valide
 *   node scripts/convert-animations.mjs --no-check      convertit seulement
 *   node scripts/convert-animations.mjs --check         valide les .vrma déjà présents
 *   node scripts/convert-animations.mjs --src=<chemin>  .glb source (défaut : voir SRC_DEFAUT)
 *
 * Sortie : vrma/<slug>.vrma
 *
 * Pack source : Universal Animation Library de Quaternius, CC0 1.0.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMHumanoid } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOSSIER_SORTIE = path.join(RACINE, 'vrma');

// Chemin du .glb téléchargé (hors dépôt : le pack source n'est pas versionné,
// seuls les .vrma produits le sont). Télécharge « Universal Animation Library
// [Standard] » chez Quaternius, pose le .glb de la version Godot à la racine du
// projet, ou passe --src=<chemin>.
const SRC_DEFAUT = path.join(RACINE, 'AnimationLibrary_Godot_Standard.glb');

const EXTENSION = 'VRMC_vrm_animation';

// ─── Clips retenus : slug de sortie ← nom du clip dans le pack ───────────────

const CLIPS = {
  idle: 'Idle_Loop',
  'idle-talking': 'Idle_Talking_Loop',
  dance: 'Dance_Loop',
  'hit-head': 'Hit_Head',
  'hit-chest': 'Hit_Chest',
  interact: 'Interact',
  pickup: 'PickUp_Table',
  'sit-enter': 'Sitting_Enter',
  'sit-idle': 'Sitting_Idle_Loop',
  'sit-talking': 'Sitting_Talking_Loop',
  'sit-exit': 'Sitting_Exit',
  'swim-idle': 'Swim_Idle_Loop',
  swim: 'Swim_Fwd_Loop',
  walk: 'Walk_Loop',
  'walk-formal': 'Walk_Formal_Loop',
  jog: 'Jog_Fwd_Loop',
  sprint: 'Sprint_Loop',
  'crouch-idle': 'Crouch_Idle_Loop',
  'crouch-walk': 'Crouch_Fwd_Loop',
  'jump-start': 'Jump_Start',
  'jump-loop': 'Jump_Loop',
  'jump-land': 'Jump_Land',
};

// ─── Mapping manuel os Rigify (DEF-*) → os humanoïdes VRM 1.0 ───────────────

const OS_VRM = {
  hips: 'DEF-hips',
  spine: 'DEF-spine.001',
  chest: 'DEF-spine.002',
  upperChest: 'DEF-spine.003',
  neck: 'DEF-neck',
  head: 'DEF-head',

  leftShoulder: 'DEF-shoulder.L',
  leftUpperArm: 'DEF-upper_arm.L',
  leftLowerArm: 'DEF-forearm.L',
  leftHand: 'DEF-hand.L',
  rightShoulder: 'DEF-shoulder.R',
  rightUpperArm: 'DEF-upper_arm.R',
  rightLowerArm: 'DEF-forearm.R',
  rightHand: 'DEF-hand.R',

  leftUpperLeg: 'DEF-thigh.L',
  leftLowerLeg: 'DEF-shin.L',
  leftFoot: 'DEF-foot.L',
  leftToes: 'DEF-toe.L',
  rightUpperLeg: 'DEF-thigh.R',
  rightLowerLeg: 'DEF-shin.R',
  rightFoot: 'DEF-foot.R',
  rightToes: 'DEF-toe.R',
};

for (const cote of ['L', 'R']) {
  const p = cote === 'L' ? 'left' : 'right';
  OS_VRM[`${p}ThumbMetacarpal`] = `DEF-thumb.01.${cote}`;
  OS_VRM[`${p}ThumbProximal`] = `DEF-thumb.02.${cote}`;
  OS_VRM[`${p}ThumbDistal`] = `DEF-thumb.03.${cote}`;
  for (const [doigt, src] of [
    ['Index', 'f_index'],
    ['Middle', 'f_middle'],
    ['Ring', 'f_ring'],
    ['Little', 'f_pinky'],
  ]) {
    OS_VRM[`${p}${doigt}Proximal`] = `DEF-${src}.01.${cote}`;
    OS_VRM[`${p}${doigt}Intermediate`] = `DEF-${src}.02.${cote}`;
    OS_VRM[`${p}${doigt}Distal`] = `DEF-${src}.03.${cote}`;
  }
}

// Os exigés par la spec VRM 1.0 — sert au contrôle round-trip.
const OS_REQUIS = [
  'hips', 'spine', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
];

// ─── Polyfills : GLTFExporter/GLTFLoader visent le navigateur ───────────────
// Node 25 fournit Blob et TextDecoder mais pas FileReader, seul manquant sur le
// chemin binaire de GLTFExporter (aucune texture ici, donc pas de canvas).

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null;
      this.onloadend = null;
      this.onerror = null;
    }
    #lire(blob, transforme) {
      // onloadend est affecté après l'appel : on repasse par une microtâche.
      blob
        .arrayBuffer()
        .then((ab) => {
          this.result = transforme(ab);
          if (this.onloadend) this.onloadend();
        })
        .catch((e) => {
          if (this.onerror) this.onerror(e);
          else throw e;
        });
    }
    readAsArrayBuffer(blob) {
      this.#lire(blob, (ab) => ab);
    }
    readAsDataURL(blob) {
      this.#lire(
        blob,
        (ab) => `data:application/octet-stream;base64,${Buffer.from(ab).toString('base64')}`,
      );
    }
  };
}

// ─── Lecture GLB à la main ──────────────────────────────────────────────────

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

/** Découpe un .glb en { json, bin } sans passer par GLTFLoader (qui tire du DOM). */
function lireGLB(buffer) {
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('Fichier non GLB (magic invalide).');
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`Version GLB non gérée : ${version}`);
  const total = Math.min(dv.getUint32(8, true), buffer.byteLength);

  let json = null;
  let bin = null;
  let offset = 12;
  while (offset + 8 <= total) {
    const longueur = dv.getUint32(offset, true);
    const type = dv.getUint32(offset + 4, true);
    const donnees = buffer.subarray(offset + 8, offset + 8 + longueur);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(donnees));
    else if (type === CHUNK_BIN) bin = donnees;
    offset += 8 + longueur;
  }
  if (!json) throw new Error('Chunk JSON absent.');
  return { json, bin };
}

const NB_COMPOSANTES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const FLOAT32 = 5126;

/** Lit un accessor float32 (non sparse) directement dans le chunk BIN. */
function lireAccessor(json, bin, index) {
  const acc = json.accessors[index];
  if (acc.componentType !== FLOAT32) {
    throw new Error(`Accessor ${index} : componentType ${acc.componentType} non géré (float32 attendu).`);
  }
  if (acc.sparse) throw new Error(`Accessor ${index} : sparse non géré.`);
  const n = NB_COMPOSANTES[acc.type];
  if (!n) throw new Error(`Accessor ${index} : type ${acc.type} non géré.`);

  const bv = json.bufferViews[acc.bufferView];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const pas = bv.byteStride ?? n * 4; // octets entre deux éléments
  const sortie = new Float32Array(acc.count * n);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < n; c++) sortie[i * n + c] = bin.readFloatLE(base + i * pas + c * 4);
  }
  return sortie;
}

// ─── Squelette ──────────────────────────────────────────────────────────────

const estOsSquelette = (nom) => nom === 'root' || nom.startsWith('DEF-');

/**
 * Reconstruit la hiérarchie de THREE.Bone depuis les nodes glTF (TRS locaux =
 * rest pose du rig). Renvoie { racine, parNom }.
 */
function construireSquelette(json) {
  const os = new Map(); // index node → Bone
  for (let i = 0; i < json.nodes.length; i++) {
    const def = json.nodes[i];
    if (!def.name || !estOsSquelette(def.name)) continue;
    const bone = new THREE.Bone();
    bone.name = def.name;
    bone.position.fromArray(def.translation ?? [0, 0, 0]);
    bone.quaternion.fromArray(def.rotation ?? [0, 0, 0, 1]);
    bone.scale.fromArray(def.scale ?? [1, 1, 1]);
    // Le pack sort de Blender avec des échelles à 0.9999999 : on les recale à 1
    // pour ne pas polluer la rest pose exportée.
    for (const axe of ['x', 'y', 'z']) {
      if (Math.abs(bone.scale[axe] - 1) < 1e-4) bone.scale[axe] = 1;
    }
    os.set(i, bone);
  }

  const enfants = new Set();
  for (const [i, bone] of os) {
    for (const c of json.nodes[i].children ?? []) {
      const fils = os.get(c);
      if (fils) {
        bone.add(fils);
        enfants.add(c);
      }
    }
  }

  const racines = [...os.entries()].filter(([i]) => !enfants.has(i));
  if (racines.length !== 1) {
    throw new Error(`Squelette : ${racines.length} racines trouvées, une seule attendue.`);
  }
  const racine = racines[0][1];
  racine.updateWorldMatrix(false, true);

  const parNom = new Map([...os.values()].map((b) => [b.name, b]));
  return { racine, parNom };
}

/** Map<nomVRM, Bone> à partir du mapping manuel. */
function construireMapVRM(parNom) {
  const map = new Map();
  for (const [nomVrm, nomOs] of Object.entries(OS_VRM)) {
    const bone = parNom.get(nomOs);
    if (!bone) throw new Error(`Os "${nomOs}" (${nomVrm}) introuvable dans le squelette source.`);
    map.set(nomVrm, bone);
  }
  return map;
}

// ─── Construction des clips ─────────────────────────────────────────────────

/**
 * Construit un THREE.AnimationClip depuis une animation glTF.
 * On ne garde que .quaternion (tous les os DEF-*) et .position (DEF-hips seul) :
 * la spec VRMC_vrm_animation n'autorise la translation que sur hips, et les
 * échelles n'ont pas de sens pour un rig humanoïde.
 * Le node « root » est volontairement ignoré : les clips retenus sont sur place
 * (pas de root motion) et root n'est pas un os humanoïde VRM.
 */
function construireClip(json, bin, defAnim, parNom) {
  const tracks = [];

  for (const canal of defAnim.channels) {
    const def = json.nodes[canal.target.node];
    const nom = def?.name;
    if (!nom || !parNom.has(nom) || nom === 'root') continue;

    const chemin = canal.target.path;
    if (chemin === 'scale') continue;
    if (chemin === 'translation' && nom !== OS_VRM.hips) continue;

    const sampler = defAnim.samplers[canal.sampler];
    const interpolation = sampler.interpolation ?? 'LINEAR';
    const temps = lireAccessor(json, bin, sampler.input);
    let valeurs = lireAccessor(json, bin, sampler.output);

    if (interpolation === 'CUBICSPLINE') {
      // Chaque clé stocke [tangenteIn, valeur, tangenteOut] : on ne garde que
      // la valeur et on retombe sur du linéaire.
      const taille = chemin === 'rotation' ? 4 : 3;
      const reduit = new Float32Array(temps.length * taille);
      for (let i = 0; i < temps.length; i++) {
        for (let c = 0; c < taille; c++) reduit[i * taille + c] = valeurs[i * 3 * taille + taille + c];
      }
      valeurs = reduit;
      console.warn(`  ! ${defAnim.name}/${nom} : CUBICSPLINE ramené à LINEAR`);
    }

    let track;
    if (chemin === 'rotation') {
      track = new THREE.QuaternionKeyframeTrack(`${nom}.quaternion`, temps, valeurs);
    } else {
      track = new THREE.VectorKeyframeTrack(`${nom}.position`, temps, valeurs);
    }
    if (interpolation === 'STEP') track.setInterpolation(THREE.InterpolateDiscrete);
    track.optimize(); // supprime les clés strictement redondantes, garde début et fin
    tracks.push(track);
  }

  return new THREE.AnimationClip(defAnim.name, -1, tracks);
}

// ─── Plugin GLTFExporter : écriture de VRMC_vrm_animation ───────────────────

class VRMAnimationExporterPlugin {
  constructor(writer, mapVRM) {
    this.writer = writer;
    this.mapVRM = mapVRM;
    this.name = EXTENSION;
  }

  afterParse() {
    const humanBones = {};
    for (const [nomVrm, bone] of this.mapVRM) {
      const node = this.writer.nodeMap.get(bone);
      if (node != null) humanBones[nomVrm] = { node };
    }

    const json = this.writer.json;
    json.extensions ??= {};
    json.extensions[EXTENSION] = { specVersion: '1.0', humanoid: { humanBones } };

    // writeAsync réécrit json.extensionsUsed depuis writer.extensionsUsed : on
    // renseigne les deux pour être robuste quel que soit l'ordre.
    json.extensionsUsed ??= [];
    if (!json.extensionsUsed.includes(EXTENSION)) json.extensionsUsed.push(EXTENSION);
    this.writer.extensionsUsed[EXTENSION] = true;
  }
}

// ─── Vérification de la rest pose (doit être la T-pose VRM) ─────────────────

/**
 * VRMAnimationLoaderPlugin exprime chaque rotation animée relativement à la
 * rest pose du fichier :
 *     q_sortie(t) = q_mondeRestParent · q_track(t) · q_mondeRestOs⁻¹
 * puis l'applique au rig normalisé du VRM, qui est en T-pose. Autrement dit,
 * la rest pose écrite dans le .vrma EST la référence : si ce n'est pas une
 * T-pose, tout le mouvement est décalé du delta A-pose→T-pose.
 *
 * Conséquence : plutôt que de « rebaser » les pistes, il suffit d'écrire la
 * T-pose comme rest pose des nodes et de laisser les pistes telles quelles
 * (les valeurs glTF d'une piste rotation sont des rotations locales absolues,
 * pas des deltas — elles restent donc valides quelle que soit la rest pose).
 * On compare ici la rest du rig à la frame 0 du clip A_TPose fourni par le pack.
 */
function verifierRestPose(json, bin, parNom) {
  const defTPose = json.animations.find((a) => a.name === 'A_TPose');
  if (!defTPose) return { tpose: null, ecartMax: null, rebase: false };

  const qRest = new THREE.Quaternion();
  const qT = new THREE.Quaternion();
  let ecartMax = 0;
  let pire = '';
  const tpose = new Map(); // nom os → {t, r, s} frame 0

  for (const canal of defTPose.channels) {
    const nom = json.nodes[canal.target.node]?.name;
    const bone = nom && parNom.get(nom);
    if (!bone) continue;
    const sampler = defTPose.samplers[canal.sampler];
    const valeurs = lireAccessor(json, bin, sampler.output);
    const entree = tpose.get(nom) ?? {};
    if (canal.target.path === 'rotation') {
      entree.r = [valeurs[0], valeurs[1], valeurs[2], valeurs[3]];
      qRest.copy(bone.quaternion);
      qT.fromArray(entree.r);
      const ecart = THREE.MathUtils.RAD2DEG * qRest.angleTo(qT);
      if (ecart > ecartMax) {
        ecartMax = ecart;
        pire = nom;
      }
    } else if (canal.target.path === 'translation') {
      entree.t = [valeurs[0], valeurs[1], valeurs[2]];
    }
    tpose.set(nom, entree);
  }

  const rebase = ecartMax >= 1;
  if (rebase) {
    // Rest ≠ T-pose : on adopte la frame 0 de A_TPose comme nouvelle rest pose
    // des nodes exportés. Les pistes restent inchangées (rotations locales
    // absolues), et le delta rest→T-pose est ainsi neutralisé pour tous les
    // clips d'un coup.
    for (const [nom, trs] of tpose) {
      const bone = parNom.get(nom);
      if (trs.r) bone.quaternion.fromArray(trs.r);
      if (trs.t) bone.position.fromArray(trs.t);
    }
    parNom.get('root').updateWorldMatrix(false, true);
  }

  return { tpose, ecartMax, pire, rebase };
}

// ─── Conversion ─────────────────────────────────────────────────────────────

async function convertir(cheminSrc) {
  const { json, bin } = lireGLB(fs.readFileSync(cheminSrc));
  if (!bin) throw new Error('Chunk BIN absent du .glb source.');

  const { racine, parNom } = construireSquelette(json);
  const mapVRM = construireMapVRM(parNom);
  console.log(`Squelette : ${parNom.size} os, ${mapVRM.size} os humanoïdes mappés.`);

  const rest = verifierRestPose(json, bin, parNom);
  if (rest.ecartMax == null) {
    console.log('Rest pose : clip A_TPose absent, rest du rig conservée telle quelle.');
  } else if (rest.rebase) {
    console.log(
      `Rest pose : A-pose détectée (écart max ${rest.ecartMax.toFixed(2)}° sur ${rest.pire}) → ` +
        'rest pose exportée remplacée par la T-pose (A_TPose frame 0).',
    );
  } else {
    console.log(
      `Rest pose : déjà en T-pose (écart max ${rest.ecartMax.toFixed(3)}° vs A_TPose frame 0) → aucun rebase.`,
    );
  }

  const parNomAnim = new Map(json.animations.map((a) => [a.name, a]));
  fs.mkdirSync(DOSSIER_SORTIE, { recursive: true });

  const resultats = [];
  for (const [slug, nomClip] of Object.entries(CLIPS)) {
    const defAnim = parNomAnim.get(nomClip);
    if (!defAnim) {
      console.warn(`  ! clip "${nomClip}" introuvable dans le pack, ignoré.`);
      continue;
    }

    const clip = construireClip(json, bin, defAnim, parNom);
    const exporteur = new GLTFExporter();
    exporteur.register((writer) => new VRMAnimationExporterPlugin(writer, mapVRM));
    const glb = await exporteur.parseAsync(racine, { animations: [clip], binary: true });

    const chemin = path.join(DOSSIER_SORTIE, `${slug}.vrma`);
    fs.writeFileSync(chemin, Buffer.from(glb));
    resultats.push({ slug, nomClip, duree: clip.duration, tracks: clip.tracks.length, taille: glb.byteLength });
    console.log(
      `  ✓ ${slug}.vrma  ${clip.duration.toFixed(3)}s  ${clip.tracks.length} pistes  ` +
        `${(glb.byteLength / 1024).toFixed(1)} Ko`,
    );
  }
  return resultats;
}

// ─── Validation round-trip ──────────────────────────────────────────────────

/** VRM factice : un humanoïde en T-pose suffit à faire tourner createVRMAnimationClip. */
function vrmFactice(cheminSrc) {
  const { json } = lireGLB(fs.readFileSync(cheminSrc));
  const { racine, parNom } = construireSquelette(json);
  const mapVRM = construireMapVRM(parNom);
  const humanBones = {};
  for (const [nomVrm, bone] of mapVRM) humanBones[nomVrm] = { node: bone };
  racine.updateWorldMatrix(false, true);
  const humanoid = new VRMHumanoid(humanBones);
  const scene = new THREE.Group();
  scene.add(racine);
  return { humanoid, meta: { metaVersion: '1' }, expressionManager: null, lookAt: null, scene };
}

function chargerVRMA(buffer) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Promise((resolve, reject) => loader.parse(ab, '', resolve, reject));
}

async function valider(cheminSrc) {
  let vrm = null;
  if (!cheminSrc) {
    console.warn('Validation : .glb source absent → pas de VRM factice, contrôle structurel seul.');
  } else {
    try {
      vrm = vrmFactice(cheminSrc);
    } catch (e) {
      console.warn(`Validation : VRM factice indisponible (${e.message}), contrôle structurel seul.`);
    }
  }

  const lignes = [];
  let echecs = 0;

  for (const slug of Object.keys(CLIPS)) {
    const chemin = path.join(DOSSIER_SORTIE, `${slug}.vrma`);
    if (!fs.existsSync(chemin)) {
      lignes.push({ slug, statut: 'ABSENT' });
      echecs++;
      continue;
    }
    const brut = fs.readFileSync(chemin);
    const problemes = [];

    // 1. extension présente et complète dans le JSON du GLB
    const { json } = lireGLB(brut);
    const ext = json.extensions?.[EXTENSION];
    if (!json.extensionsUsed?.includes(EXTENSION)) problemes.push('extensionsUsed');
    if (!ext) problemes.push('extension absente');
    else {
      if (ext.specVersion !== '1.0') problemes.push(`specVersion=${ext.specVersion}`);
      const manquants = OS_REQUIS.filter((n) => ext.humanoid?.humanBones?.[n]?.node == null);
      if (manquants.length) problemes.push(`os manquants: ${manquants.join(',')}`);
    }
    const nbOs = Object.keys(ext?.humanoid?.humanBones ?? {}).length;

    // 2. rechargement complet via GLTFLoader + VRMAnimationLoaderPlugin
    let duree = 0;
    let nbRot = 0;
    let nbTrans = 0;
    let nbTracksVrm = null;
    try {
      const gltf = await chargerVRMA(brut);
      const anim = gltf.userData.vrmAnimations?.[0];
      if (!anim) throw new Error('vrmAnimations vide');
      duree = anim.duration;
      nbRot = anim.humanoidTracks.rotation.size;
      nbTrans = anim.humanoidTracks.translation.size;
      if (!(duree > 0)) problemes.push('durée nulle');
      if (nbRot === 0) problemes.push('aucune piste de rotation');
      if (anim.restHipsPosition.y < 1e-3) problemes.push('hips rest à y≈0 (T-pose violée)');

      if (vrm) {
        const clip = createVRMAnimationClip(anim, vrm);
        nbTracksVrm = clip.tracks.length;
        if (nbTracksVrm === 0) problemes.push('clip VRM vide');
      }
    } catch (e) {
      problemes.push(`chargement: ${e.message}`);
    }

    if (problemes.length) echecs++;
    lignes.push({
      slug,
      statut: problemes.length ? 'ÉCHEC' : 'OK',
      duree,
      nbOs,
      nbRot,
      nbTrans,
      nbTracksVrm,
      taille: brut.length,
      problemes,
    });
  }

  const c = (v, n) => String(v).padEnd(n);
  const d = (v, n) => String(v).padStart(n);
  console.log('');
  console.log(
    `${c('fichier', 20)} ${d('durée', 7)} ${d('osVRM', 6)} ${d('rot', 4)} ${d('pos', 4)} ${d('clipVRM', 8)} ${d('taille', 9)}  statut`,
  );
  console.log('─'.repeat(78));
  for (const l of lignes) {
    if (l.statut === 'ABSENT') {
      console.log(`${c(`${l.slug}.vrma`, 20)} ${d('—', 7)} ${d('—', 6)} ${d('—', 4)} ${d('—', 4)} ${d('—', 8)} ${d('—', 9)}  ABSENT`);
      continue;
    }
    console.log(
      `${c(`${l.slug}.vrma`, 20)} ${d(`${l.duree.toFixed(3)}s`, 7)} ${d(l.nbOs, 6)} ${d(l.nbRot, 4)} ` +
        `${d(l.nbTrans, 4)} ${d(l.nbTracksVrm ?? '—', 8)} ${d(`${(l.taille / 1024).toFixed(1)} Ko`, 9)}  ${l.statut}` +
        (l.problemes.length ? ` — ${l.problemes.join(' ; ')}` : ''),
    );
  }
  console.log('─'.repeat(78));
  console.log(`${lignes.length - echecs}/${lignes.length} fichiers valides.`);
  return echecs;
}

// ─── Entrée ─────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const checkSeul = args.includes('--check');
  const sansCheck = args.includes('--no-check');
  const src = (args.find((a) => a.startsWith('--src=')) ?? '').slice(6) || SRC_DEFAUT;

  if (!checkSeul) {
    if (!fs.existsSync(src)) {
      console.error(`Source introuvable : ${src}\nUtilise --src=<chemin du .glb>.`);
      process.exit(1);
    }
    console.log(`Source : ${src}`);
    await convertir(src);
  }

  if (!sansCheck) {
    const echecs = await valider(fs.existsSync(src) ? src : null);
    if (echecs > 0) process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
