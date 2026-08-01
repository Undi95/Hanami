#!/usr/bin/env node
// Décor jetable — pose et retire un .glb dans `environments/` comme le ferait un
// utilisateur, puis vérifie que le dossier est revenu EXACTEMENT à son état
// d'avant (le .glb, son `.scene.json` généré, et rien d'autre).
//
// C'est le seul geste de la matrice de scène que la page ne peut pas faire
// elle-même : déposer un fichier sur le disque du serveur.
//
//   node devtools/matrice-scene/decor-jetable.mjs poser <chemin.glb>
//   node devtools/matrice-scene/decor-jetable.mjs etat
//   node devtools/matrice-scene/decor-jetable.mjs retirer <nom>
//
// « retirer » refuse tout nom qui ne fait pas partie de l'empreinte laissée par
// « poser » : impossible d'effacer un décor livré par mégarde.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = path.dirname(fileURLToPath(import.meta.url))
const RACINE = path.resolve(ICI, '..', '..')
const DECORS = path.join(RACINE, 'environments')
const EMPREINTE = path.join(ICI, '.decor-jetable.json')

/** Inventaire du dossier des décors : nom → taille. */
function inventaire() {
  const out = {}
  for (const f of fs.readdirSync(DECORS)) {
    const st = fs.statSync(path.join(DECORS, f))
    if (st.isFile()) out[f] = st.size
  }
  return out
}

function ecrire(obj) {
  fs.writeFileSync(EMPREINTE, JSON.stringify(obj, null, 2))
}

function lire() {
  try {
    return JSON.parse(fs.readFileSync(EMPREINTE, 'utf8'))
  } catch {
    return null
  }
}

function poser(source) {
  if (!source) throw new Error('chemin du .glb attendu')
  const abs = path.resolve(source)
  if (!fs.existsSync(abs)) throw new Error('fichier introuvable : ' + abs)
  const nom = path.basename(abs)
  const cible = path.join(DECORS, nom)
  if (fs.existsSync(cible)) throw new Error('un décor porte déjà ce nom : ' + nom + ' — on ne l’écrase pas')
  const avant = inventaire()
  fs.copyFileSync(abs, cible)
  ecrire({ nom, stem: nom.replace(/\.(glb|gltf)$/i, ''), avant, pose: new Date().toISOString() })
  console.log('posé : environments/' + nom + ' (' + (fs.statSync(cible).size / 1e6).toFixed(1) + ' Mo)')
  console.log('L’analyse démarre au prochain GET /api/environments (l’UI ou le harnais le fait).')
}

function etat() {
  const emp = lire()
  if (!emp) {
    console.log('aucun décor jetable posé.')
    return
  }
  const maintenant = inventaire()
  const nouveaux = Object.keys(maintenant).filter((f) => !(f in emp.avant))
  console.log('décor jetable : ' + emp.nom)
  console.log('fichiers apparus depuis : ' + (nouveaux.length ? nouveaux.join(', ') : 'aucun'))
}

function retirer(nomDemande) {
  const emp = lire()
  if (!emp) throw new Error('aucune empreinte : rien n’a été posé par cet outil')
  if (nomDemande && nomDemande !== emp.stem && nomDemande !== emp.nom) {
    throw new Error('ce n’est pas le décor jetable posé (' + emp.stem + ') : refus')
  }
  const maintenant = inventaire()
  const nouveaux = Object.keys(maintenant).filter((f) => !(f in emp.avant))
  // Garde-fou : on ne retire QUE des fichiers apparus après la pose, et qui
  // portent le nom du décor jetable.
  const aRetirer = nouveaux.filter((f) => f === emp.nom || f.startsWith(emp.stem + '.'))
  const refuses = nouveaux.filter((f) => !aRetirer.includes(f))
  for (const f of aRetirer) fs.rmSync(path.join(DECORS, f), { force: true })
  const apres = inventaire()
  const memeQuAvant =
    Object.keys(apres).length === Object.keys(emp.avant).length &&
    Object.keys(apres).every((f) => emp.avant[f] === apres[f])
  console.log('retirés : ' + (aRetirer.length ? aRetirer.join(', ') : 'aucun'))
  if (refuses.length) console.log('LAISSÉS (nom inattendu, à regarder) : ' + refuses.join(', '))
  console.log('environments/ ' + (memeQuAvant ? 'est revenu à son état d’avant ✔' : 'DIFFÈRE de son état d’avant ✘'))
  if (memeQuAvant && !refuses.length) fs.rmSync(EMPREINTE, { force: true })
  if (!memeQuAvant) process.exitCode = 1
}

const [, , commande, argument] = process.argv
try {
  if (commande === 'poser') poser(argument)
  else if (commande === 'retirer') retirer(argument)
  else if (commande === 'etat') etat()
  else {
    console.log('usage : decor-jetable.mjs poser <chemin.glb> | etat | retirer <nom>')
    process.exitCode = 2
  }
} catch (e) {
  console.error('erreur : ' + e.message)
  process.exitCode = 1
}
