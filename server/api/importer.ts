// Router import : character cards SillyTavern (PNG ou .json) + chats JSONL.
import express, { Router } from 'express'
import { parseCardJson, parseCharacterCard, type ParsedCard } from '../lib/pngCard'
import { convertStChat } from '../lib/stChat'
import { createCharacter, getCharacter, savePortrait, updateCharacter, writeImportedChat } from '../lib/storage'
import { httpError, sendJsonError } from '../lib/errors'
import { ErrorCodes } from '../../shared/errorCodes'

export const importRouter = Router()

function queryString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * Compose le system prompt LISIBLEMENT à partir de la card :
 * system_prompt tel quel en tête, puis sections markdown pour les champs
 * non vides — contenu VERBATIM, aucune réécriture.
 *
 * L'ORDRE est celui de SillyTavern, et il n'est pas décoratif : le dialogue
 * d'exemple vient après la description (on montre la voix une fois qu'on sait
 * qui parle), et les consignes post-historique ferment la marche — ST les place
 * après l'historique justement pour qu'elles pèsent le plus lourd. Hanami
 * n'envoie qu'UN message système : la fin du prompt est la place la plus tardive
 * dont il dispose, et le personnage reste modifiable à la main ensuite.
 */
function composeSystemPrompt(card: ParsedCard): string {
  // Card à UNE seule section, la description : elle EST le prompt, on la rend
  // telle quelle. Coiffer un texte unique d'un « ## Description » n'apprend rien
  // à personne, et c'est ce qui rend l'aller-retour exact avec notre propre
  // export (qui écrit le prompt du personnage dans ce champ, cf. cardExport.ts).
  if (
    card.description.trim() &&
    !card.systemPrompt.trim() &&
    !card.personality.trim() &&
    !card.scenario.trim() &&
    !card.mesExample.trim() &&
    !card.postHistoryInstructions.trim()
  ) {
    return card.description
  }
  const parts: string[] = []
  if (card.systemPrompt.trim()) parts.push(card.systemPrompt)
  if (card.description.trim()) parts.push(`## Description\n\n${card.description}`)
  if (card.personality.trim()) parts.push(`## Personality\n\n${card.personality}`)
  if (card.scenario.trim()) parts.push(`## Scenario\n\n${card.scenario}`)
  if (card.mesExample.trim()) parts.push(`## Example dialogue\n\n${card.mesExample}`)
  if (card.postHistoryInstructions.trim()) {
    parts.push(`## Final instructions (from the card — they take precedence)\n\n${card.postHistoryInstructions}`)
  }
  return parts.join('\n\n')
}

importRouter.post(
  '/api/import/card',
  // Types explicites (le client envoie application/octet-stream) : accepter
  // n'importe quel type ouvrirait la route aux requêtes cross-site « simples ».
  express.raw({ type: ['application/octet-stream', 'image/png'], limit: '25mb' }),
  (req, res) => {
    try {
      const buf = req.body as unknown
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        httpError(res, 400, ErrorCodes.cardBodyRequired)
        return
      }
      // PNG d'abord (le cas courant), puis .json nu. Le PNG lu avec succès est
      // AUSSI l'image du personnage — un .json n'en porte aucune.
      const fromPng = parseCharacterCard(buf)
      const card = fromPng ?? parseCardJson(buf)
      if (!card) {
        httpError(res, 400, ErrorCodes.noReadableCard)
        return
      }
      const name = queryString(req.query.name) || card.name || 'Importé'
      const character = createCharacter({
        name,
        // first_mes reste le message d'accueil principal ; les alternate_greetings
        // de la card deviennent des variantes (rien de la card ne se perd).
        greeting: card.firstMes,
        greetings: card.alternateGreetings,
        systemPrompt: composeSystemPrompt(card),
      })
      // La card PNG EST une image : on la garde comme portrait du personnage,
      // seule représentation visuelle possible tant qu'aucun VRM n'est choisi.
      // L'échec d'écriture ne fait pas rater l'import (le personnage, lui, est
      // créé). Une card .json n'a pas d'image : le personnage naît sans portrait,
      // et l'initiale teintée en tient lieu jusqu'à ce qu'on lui en donne un.
      let saved = character
      if (fromPng) {
        try {
          saved = updateCharacter(character.id, { portrait: savePortrait(character.id, buf) })
        } catch (e) {
          console.warn('[import] portrait non conservé :', e)
        }
      }
      res.json({ character: saved })
    } catch (e) {
      sendJsonError(res, 500, e)
    }
  },
)

importRouter.post(
  '/api/import/chat',
  // Types explicites (cf. /api/import/card) ; limite alignée sur les cards.
  express.raw({ type: ['application/octet-stream', 'image/png'], limit: '25mb' }),
  (req, res) => {
    try {
      const characterId = queryString(req.query.characterId)
      if (!characterId) {
        httpError(res, 400, ErrorCodes.characterIdRequired)
        return
      }
      let character = null
      try {
        character = getCharacter(characterId)
      } catch {
        /* id invalide → introuvable */
      }
      if (!character) {
        httpError(res, 404, ErrorCodes.characterNotFound, { id: characterId })
        return
      }
      const body = req.body as unknown
      const jsonl = Buffer.isBuffer(body) ? body.toString('utf8') : typeof body === 'string' ? body : ''
      const messages = convertStChat(jsonl)
      // Date ISO plutôt que toLocaleDateString('fr-FR') : le titre est DONNÉE
      // (stocké, affiché tel quel) — un format neutre se lit dans les deux langues.
      const title =
        queryString(req.query.title) || `Import SillyTavern ${new Date().toISOString().slice(0, 10)}`
      const chat = writeImportedChat(characterId, title, messages)
      res.json({ chat, imported: messages.length })
    } catch (e) {
      sendJsonError(res, 500, e)
    }
  },
)
