// Router crédits : l'attribution des décors 3D, LUE dans les décors eux-mêmes.
//
// Les sept pièces livrées sont en CC BY 4.0, la seule licence du projet qui
// IMPOSE l'attribution, et qui exige qu'elle « reste accessible aux
// utilisateurs de l'application » (environments/CREDITS.md). Cette route est ce
// qui rend cette phrase vraie.
//
// Pourquoi lire le fichier plutôt que tenir une liste : chaque `.glb` exporté
// par Sketchfab embarque son attribution dans `asset.extras` — titre, auteur et
// son profil, licence et son texte, page du modèle. C'est la copie que l'auteur
// a envoyée avec son œuvre. La relire à chaque affichage coûte quelques
// dizaines de kilo-octets et supprime le seul vrai risque : qu'un décor déposé
// plus tard dans environments/ soit servi sans crédit parce que personne n'a
// pensé à modifier une liste. Ici, il se crédite tout seul — et s'il n'a pas
// d'attribution du tout, l'écran le DIT au lieu de le taire.
//
// Le reste des crédits (animations, police, briques de code) ne se lit dans
// aucun asset : il vit dans shared/credits.ts, écrit une seule fois.
import path from 'node:path'
import { Router } from 'express'
import type { EnvironmentCredit } from '../../shared/credits'
import { readGlbAsset } from '../lib/glb'
import { listEnvironmentModels } from '../lib/envIndex'
import { ENVIRONMENTS_DIR } from '../lib/storage'
import { sendJsonError } from '../lib/errors'

export const creditsRouter = Router()

/** Champ `extras` en chaîne propre — tout le reste (nombre, objet, absent) vaut vide. */
function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Seules http(s) deviennent des liens. Le fichier vient d'un dossier où
 * l'utilisateur dépose ce qu'il veut : un `javascript:` recopié tel quel dans
 * un href serait une injection, et un `file:` une fuite de chemin.
 */
function safeUrl(value: string): string {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''
  } catch {
    return ''
  }
}

/**
 * Sketchfab écrit ses champs sous la forme « Libellé (URL) » : l'auteur avec son
 * profil, la licence avec son texte. On rend les deux séparément, sans jamais
 * inventer ce qui manque — un champ sans parenthèses reste un libellé nu.
 */
function splitLabelUrl(raw: string): { label: string; url: string } {
  const m = /^(.*?)\s*\(\s*(\S+)\s*\)$/.exec(raw)
  if (!m) return { label: raw, url: '' }
  const url = safeUrl(m[2])
  return url ? { label: m[1].trim(), url } : { label: raw, url: '' }
}

/** Attribution d'un décor telle que son fichier la porte. Champs vides = absente. */
function creditOf(file: string): EnvironmentCredit {
  const asset = readGlbAsset(path.join(ENVIRONMENTS_DIR, file))
  const extras = asset?.extras ?? {}
  const author = splitLabelUrl(asText(extras.author))
  const license = splitLabelUrl(asText(extras.license))
  return {
    file,
    title: asText(extras.title),
    author: author.label,
    authorUrl: author.url,
    license: license.label,
    licenseUrl: license.url,
    // `source` est la page du modèle chez l'éditeur : le lien à donner pour
    // « où trouver l'œuvre », qu'exige la CC BY.
    url: safeUrl(asText(extras.source)),
  }
}

// Dossier absent ou décor illisible : liste vide ou entrée sans attribution,
// jamais une erreur — l'écran des crédits doit s'ouvrir quoi qu'il arrive.
creditsRouter.get('/api/credits/environments', (_req, res) => {
  try {
    const environments = listEnvironmentModels()
      .map(creditOf)
      .sort((a, b) => (a.title || a.file).localeCompare(b.title || b.file))
    res.json({ environments })
  } catch (e) {
    sendJsonError(res, 500, e)
  }
})
