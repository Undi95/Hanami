// Router import : character cards PNG SillyTavern + chats JSONL SillyTavern.
import express, { Router, type Response } from 'express'
import { parseCharacterCard, type ParsedCard } from '../lib/pngCard'
import { convertStChat } from '../lib/stChat'
import { createCharacter, getCharacter, savePortrait, updateCharacter, writeImportedChat } from '../lib/storage'

export const importRouter = Router()

function sendError(res: Response, status: number, e: unknown): void {
  res.status(status).json({ error: e instanceof Error ? e.message : String(e) })
}

function queryString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * Compose le system prompt LISIBLEMENT à partir de la card :
 * system_prompt tel quel en tête, puis sections markdown pour les champs
 * non vides — contenu VERBATIM, aucune réécriture.
 */
function composeSystemPrompt(card: ParsedCard): string {
  const parts: string[] = []
  if (card.systemPrompt.trim()) parts.push(card.systemPrompt)
  if (card.description.trim()) parts.push(`## Description\n\n${card.description}`)
  if (card.personality.trim()) parts.push(`## Personality\n\n${card.personality}`)
  if (card.scenario.trim()) parts.push(`## Scenario\n\n${card.scenario}`)
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
        res.status(400).json({ error: 'Corps de requête PNG requis' })
        return
      }
      const card = parseCharacterCard(buf)
      if (!card) {
        res.status(400).json({ error: 'PNG sans character card (chunk tEXt chara/ccv3 absent ou invalide)' })
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
      // La card EST une image : on la garde comme portrait du personnage, seule
      // représentation visuelle possible tant qu'aucun VRM n'est choisi. L'échec
      // d'écriture ne fait pas rater l'import (le personnage, lui, est créé).
      let saved = character
      try {
        saved = updateCharacter(character.id, { portrait: savePortrait(character.id, buf) })
      } catch (e) {
        console.warn('[import] portrait non conservé :', e)
      }
      res.json({ character: saved })
    } catch (e) {
      sendError(res, 500, e)
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
        res.status(400).json({ error: 'Paramètre "characterId" requis' })
        return
      }
      let character = null
      try {
        character = getCharacter(characterId)
      } catch {
        /* id invalide → introuvable */
      }
      if (!character) {
        res.status(404).json({ error: `Personnage introuvable : ${characterId}` })
        return
      }
      const body = req.body as unknown
      const jsonl = Buffer.isBuffer(body) ? body.toString('utf8') : typeof body === 'string' ? body : ''
      const messages = convertStChat(jsonl)
      const title =
        queryString(req.query.title) ||
        `Import SillyTavern ${new Date().toLocaleDateString('fr-FR')}`
      const chat = writeImportedChat(characterId, title, messages)
      res.json({ chat, imported: messages.length })
    } catch (e) {
      sendError(res, 500, e)
    }
  },
)
