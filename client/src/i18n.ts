// i18n maison — deux dictionnaires plats (fr/en), zéro dépendance.
// Le dictionnaire français est la source de vérité : le type des clés en dérive,
// donc une clé manquante côté anglais casse `tsc`.
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

export type Lang = 'fr' | 'en'

const LANG_KEY = 'hanami_lang'

const FR = {
  // ── Commun ───────────────────────────────────────────────────────────────
  loading: 'Chargement…',
  save: 'Enregistrer',
  saving: 'Enregistrement…',
  saved: 'Enregistré.',
  cancel: 'Annuler',
  close: 'Fermer',
  create: 'Créer',
  edit: 'Modifier',
  copy: 'Copier',
  copied: 'Copié !',
  confirmDelete: 'Confirmer la suppression',
  confirmQuestion: 'Confirmer ?',
  unsavedConfirm: 'Modifications non enregistrées — fermer quand même ?',

  // ── Langue ───────────────────────────────────────────────────────────────
  language: 'Langue',
  langFr: 'Français',
  langEn: 'English',

  // ── Coquille de l’application ────────────────────────────────────────────
  collapseChat: 'Replier le chat pour voir l’avatar',
  expandChat: 'Déplier le chat',
  backendDown: 'Backend LLM injoignable — vérifiez l’URL dans les réglages.',
  openSettings: 'Réglages',
  welcomeTitle: 'Bienvenue dans Hanami',
  noCharacters: 'Aucun personnage pour l’instant. Créez-en un, ou importez une carte SillyTavern.',
  createCharacter: 'Créer un personnage',
  importTitle: 'Importer',
  settingsUnavailable: 'Réglages indisponibles (serveur injoignable).',
  responseInterrupted: 'Réponse interrompue par le serveur.',
  vrmLoadError: 'Le modèle 3D n’a pas pu être chargé.',

  // ── Erreurs côté client (celles du serveur sont affichées telles quelles) ─
  authRequired: 'Authentification requise',
  serverError: 'Erreur serveur ({status})',
  serverUnreachable: 'Serveur Hanami injoignable',
  wrongPassword: 'Mot de passe incorrect',
  streamUnavailable: 'Flux de réponse indisponible',

  // ── Barre du haut ────────────────────────────────────────────────────────
  menus: 'Menus',
  chats: 'Conversations',
  characters: 'Personnages',
  memory: 'Mémoire',
  importMenu: 'Importer (SillyTavern)',
  promptInspectorTitle: 'Inspecteur de prompt',
  settings: 'Réglages',
  vnMode: 'Mode visual novel',

  // ── Saisie et fil de messages ────────────────────────────────────────────
  writeMessage: 'Écrire un message…',
  vnYou: 'Vous',
  send: 'Envoyer',
  stop: 'Arrêter la génération',
  replyInProgress: 'Réponse en cours',
  toolCall: '{name} : {args}',
  regenerate: 'Régénérer',
  continueReply: 'Continuer',
  editMessage: 'Modifier le message',
  replyToMessage: 'Répondre à ce message',
  replyingTo: 'En réponse à {name}',
  quotedLine: '{name} : {text}',
  rememberThis: 'Retenir ce message (mémoire)',
  remembered: 'Épinglé dans la mémoire (moments.md).',
  pinMessage: 'Épingler ce message',
  unpin: 'Retirer l’épingle',

  // ── Recherche dans la conversation (Ctrl+F, aucun bouton permanent) ───────
  searchPlaceholder: 'Rechercher dans la conversation…',
  searchCount: '{n}/{m}',
  searchPrev: 'Correspondance précédente',
  searchNext: 'Correspondance suivante',
  searchClose: 'Fermer la recherche',

  // ── Conversations ────────────────────────────────────────────────────────
  newChat: 'Nouvelle conversation',
  noChats: 'Aucune conversation pour l’instant.',
  defaultChatTitle: 'Conversation du {date}',
  deleteChat: 'Supprimer',
  forkChat: 'Dupliquer',
  forkSuffix: 'branche',
  messagesOne: '{n} message',
  messagesMany: '{n} messages',
  // « Notre histoire » : ligne unique en pied des conversations, montée à partir
  // des trois fragments ci-dessous (chacun accordé avec isPlural).
  statsLine: '💗 {days} · {messages} · {activeDays}',
  statsDaysOne: '{n} jour ensemble',
  statsDaysMany: '{n} jours ensemble',
  statsActiveDaysOne: '{n} jour de conversation',
  statsActiveDaysMany: '{n} jours de conversation',

  // ── Personnages ──────────────────────────────────────────────────────────
  newCharacter: 'Nouveau personnage',
  editCharacter: 'Modifier le personnage',
  charactersEmpty: 'Aucun personnage. Créez-en un, ou importez une carte SillyTavern via le menu Importer.',
  nameRequired: 'Le nom est requis.',
  name: 'Nom',
  vrmModel: 'Modèle 3D (VRM)',
  noModel: 'Aucun modèle',
  background: 'Fond',
  defaultGradient: 'Dégradé par défaut',
  greeting: 'Message d’accueil',
  greetingPlaceholder: '[happy] Bonjour ! …',
  greetingHint: 'Affiché en première bulle d’un nouveau chat — jamais envoyé au backend.',
  systemPrompt: 'Prompt système',
  deleteCharacterWarn: 'Supprimer ce personnage supprime aussi tous ses chats et sa mémoire.',
  deleteCharacterArmed:
    'Dernière chance : cette action supprime le personnage, ses chats et sa mémoire. Irréversible.',
  deleteCharacter: 'Supprimer le personnage',

  // ── Réglages ─────────────────────────────────────────────────────────────
  sectionBackend: 'Backend LLM',
  backendUrl: 'URL du backend (compatible OpenAI)',
  apiKey: 'Clé API',
  apiKeyPlaceholder: '(souvent vide pour un backend local)',
  model: 'Modèle',
  modelPlaceholder: '(certains backends l’ignorent)',
  testConnection: 'Tester la connexion',
  testing: 'Test…',
  testOkOne: 'Connexion réussie — {n} modèle détecté.',
  testOkMany: 'Connexion réussie — {n} modèles détectés.',
  chooseDetectedModel: 'Choisir un modèle détecté',
  chooseDetectedModelOption: '— choisir un modèle détecté —',
  sectionGeneration: 'Génération',
  modelMode: 'Mode du modèle',
  modelModeFull: 'Complet',
  modelModeSimple: 'Simple',
  modelModeSub:
    'Simple : aucun outil n’est exposé au modèle — Hanami gère la mémoire côté serveur (les faits sont extraits à la compaction) et devine l’émotion à partir du texte. À choisir pour les petits modèles, qui échouent souvent au tool-calling.',
  temperature: 'Température',
  maxTokens: 'Tokens max (réponse)',
  maxHistory: 'Messages d’historique max envoyés',
  showThoughts: 'Afficher les pensées du modèle',
  showThoughtsSub: 'Montre le raisonnement (« thinking ») dans un bloc repliable au-dessus de la réponse.',
  thoughts: 'Pensées',
  contextSize: 'Taille de contexte du modèle (tokens)',
  autoCompact: 'Compaction automatique',
  timeAwareness: 'Notion du temps',
  timeAwarenessSub:
    'Le personnage sait la date, l’heure et le temps écoulé depuis votre dernier message (visible dans l’Inspecteur).',
  autoCompactSub:
    'À ~80 % du contexte : les faits importants sont sauvés en mémoire, puis la conversation est résumée. Le résumé reste visible et modifiable.',
  contextBadge: '{percent} %',
  contextBadgeTitle: 'Contexte utilisé : ~{tokens} / {limit} tokens',
  contextUsage: 'Prochain envoi : ~{tokens} tokens / {limit} ({percent} %)',
  compacting: 'Compactage de la conversation…',
  viewSummary: 'Résumé',
  summaryHint:
    'Ce résumé remplace les messages compactés dans le contexte envoyé au modèle. Corrigez-le librement — le vider annule la compaction (tout l’historique repart).',
  compactNow: 'Compacter maintenant',
  compactInstructionPlaceholder: 'Instruction optionnelle (ex. « garde tous les détails du voyage »)',
  compactDone: 'Conversation compactée ({n} messages résumés).',
  sectionTts: 'Synthèse vocale (TTS)',
  ttsEnabled: 'Lire les réponses à voix haute',
  ttsEnabledSub: 'Chaque réponse terminée est envoyée au serveur TTS et l’audio est joué.',
  ttsUrl: 'URL du serveur TTS (compatible OpenAI)',
  ttsModel: 'Modèle TTS',
  ttsVoice: 'Voix',
  ttsHint: 'Serveur exposant POST /audio/speech au format OpenAI. Champs modèle/voix selon le serveur.',
  ttsError: 'Synthèse vocale : {message}',
  sectionMemoryTools: 'Mémoire & outils',
  memoryToggle: 'Mémoire',
  memoryToggleSub: 'Injecte le bloc mémoire dans le contexte et expose les outils mémoire.',
  fileTools: 'Outils fichiers',
  fileToolsSub: 'Le modèle peut lire/écrire dans le dossier sandbox.',
  allowDelete: 'Autoriser la suppression de fichiers',
  allowDeleteSub: 'Danger : le modèle pourra supprimer des fichiers dans le dossier sandbox.',
  sandboxDir: 'Dossier sandbox des outils',
  sectionAccess: 'Accès',
  accessPassword: 'Mot de passe d’accès',
  accessPasswordPlaceholder: '(vide = pas d’authentification)',
  accessPasswordHint: 'Utile si Hanami est exposé sur le réseau. Vide = accès libre en local.',
  secretConfiguredPlaceholder: '(configuré — laisser vide pour conserver)',
  secretNotConfiguredPlaceholder: '(non configuré)',
  secretWillClearPlaceholder: '(sera retiré à l’enregistrement)',
  removeSecret: 'Retirer',
  removePasswordConfirm: 'Retirer le mot de passe d’accès ? L’instance ne sera plus protégée.',

  // ── Import SillyTavern ───────────────────────────────────────────────────
  importFromSt: 'Importer depuis SillyTavern',
  cardSection: 'Carte de personnage (PNG)',
  cardSectionHint: 'Le personnage, son prompt et son message d’accueil sont extraits de la carte.',
  importing: 'Import…',
  choosePng: 'Choisir un fichier PNG',
  characterImported: 'Personnage « {name} » importé.',
  chatSection: 'Historique de chat (.jsonl)',
  importNeedCharacter: 'Importez ou créez d’abord un personnage cible.',
  targetCharacter: 'Personnage cible',
  chooseJsonl: 'Choisir des fichiers .jsonl',
  filesChosenOne: '{n} fichier choisi',
  filesChosenMany: '{n} fichiers choisis',
  importedOne: '{n} message importé',
  importedMany: '{n} messages importés',
  filesStayLocal: 'Vos fichiers ne quittent pas votre machine.',

  // ── Connexion ────────────────────────────────────────────────────────────
  loginHint: 'Cette instance est protégée par un mot de passe.',
  password: 'Mot de passe',
  loggingIn: 'Connexion…',
  login: 'Entrer',

  // ── Mémoire ──────────────────────────────────────────────────────────────
  memoryHelp:
    'Ces fichiers sont injectés dans le contexte du personnage (si la mémoire est activée) et librement éditables. MEMORY.md sert d’index.',
  indexBadge: 'index',
  newMemoryFile: 'Nom du nouveau fichier mémoire',
  newMemoryFilePlaceholder: 'nouveau.md',
  memoryFileContent: 'Contenu de {name}',
  deleteFile: 'Supprimer',
  noMemoryFiles: 'Aucun fichier mémoire.',

  // ── Inspecteur de prompt ─────────────────────────────────────────────────
  promptInspectorNote: 'Ceci est exactement ce que Hanami envoie au backend — rien d’autre.',
  systemPromptTab: 'Prompt système',
  payloadTab: 'Payload complet',
}

export type Key = keyof typeof FR

const EN: Record<Key, string> = {
  // ── Common ───────────────────────────────────────────────────────────────
  loading: 'Loading…',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved.',
  cancel: 'Cancel',
  close: 'Close',
  create: 'Create',
  edit: 'Edit',
  copy: 'Copy',
  copied: 'Copied!',
  confirmDelete: 'Confirm deletion',
  confirmQuestion: 'Confirm?',
  unsavedConfirm: 'Unsaved changes — close anyway?',

  // ── Language ─────────────────────────────────────────────────────────────
  language: 'Language',
  langFr: 'Français',
  langEn: 'English',

  // ── App shell ────────────────────────────────────────────────────────────
  collapseChat: 'Collapse the chat to see the avatar',
  expandChat: 'Expand the chat',
  backendDown: 'LLM backend unreachable — check the URL in the settings.',
  openSettings: 'Settings',
  welcomeTitle: 'Welcome to Hanami',
  noCharacters: 'No characters yet. Create one, or import a SillyTavern card.',
  createCharacter: 'Create a character',
  importTitle: 'Import',
  settingsUnavailable: 'Settings unavailable (server unreachable).',
  responseInterrupted: 'The server cut the response short.',
  vrmLoadError: 'The 3D model could not be loaded.',

  // ── Client-side errors (server errors are shown verbatim) ────────────────
  authRequired: 'Authentication required',
  serverError: 'Server error ({status})',
  serverUnreachable: 'Hanami server unreachable',
  wrongPassword: 'Wrong password',
  streamUnavailable: 'Response stream unavailable',

  // ── Top bar ──────────────────────────────────────────────────────────────
  menus: 'Menus',
  chats: 'Conversations',
  characters: 'Characters',
  memory: 'Memory',
  importMenu: 'Import (SillyTavern)',
  promptInspectorTitle: 'Prompt inspector',
  settings: 'Settings',
  vnMode: 'Visual novel mode',

  // ── Composer and message feed ────────────────────────────────────────────
  writeMessage: 'Write a message…',
  vnYou: 'You',
  send: 'Send',
  stop: 'Stop generating',
  replyInProgress: 'Reply in progress',
  toolCall: '{name}: {args}',
  regenerate: 'Regenerate',
  continueReply: 'Continue',
  editMessage: 'Edit message',
  replyToMessage: 'Reply to this message',
  replyingTo: 'Replying to {name}',
  quotedLine: '{name}: {text}',
  rememberThis: 'Remember this message (memory)',
  remembered: 'Pinned to memory (moments.md).',
  pinMessage: 'Pin this message',
  unpin: 'Remove the pin',

  // ── In-conversation search (Ctrl+F, no permanent button) ─────────────────
  searchPlaceholder: 'Search this conversation…',
  searchCount: '{n}/{m}',
  searchPrev: 'Previous match',
  searchNext: 'Next match',
  searchClose: 'Close search',

  // ── Conversations ────────────────────────────────────────────────────────
  newChat: 'New conversation',
  noChats: 'No conversations yet.',
  defaultChatTitle: 'Conversation from {date}',
  deleteChat: 'Delete',
  forkChat: 'Duplicate',
  forkSuffix: 'branch',
  messagesOne: '{n} message',
  messagesMany: '{n} messages',
  statsLine: '💗 {days} · {messages} · {activeDays}',
  statsDaysOne: '{n} day together',
  statsDaysMany: '{n} days together',
  statsActiveDaysOne: '{n} day of conversation',
  statsActiveDaysMany: '{n} days of conversation',

  // ── Characters ───────────────────────────────────────────────────────────
  newCharacter: 'New character',
  editCharacter: 'Edit character',
  charactersEmpty: 'No characters yet. Create one, or import a SillyTavern card from the Import menu.',
  nameRequired: 'A name is required.',
  name: 'Name',
  vrmModel: '3D model (VRM)',
  noModel: 'No model',
  background: 'Background',
  defaultGradient: 'Default gradient',
  greeting: 'Greeting',
  greetingPlaceholder: '[happy] Hi there! …',
  greetingHint: 'Shown as the first bubble of a new chat — never sent to the backend.',
  systemPrompt: 'System prompt',
  deleteCharacterWarn: 'Deleting this character also deletes all of its chats and its memory.',
  deleteCharacterArmed: 'Last chance: this deletes the character, its chats and its memory. There is no undo.',
  deleteCharacter: 'Delete character',

  // ── Settings ─────────────────────────────────────────────────────────────
  sectionBackend: 'LLM backend',
  backendUrl: 'Backend URL (OpenAI-compatible)',
  apiKey: 'API key',
  apiKeyPlaceholder: '(usually empty for a local backend)',
  model: 'Model',
  modelPlaceholder: '(some backends ignore this)',
  testConnection: 'Test connection',
  testing: 'Testing…',
  testOkOne: 'Connected — {n} model detected.',
  testOkMany: 'Connected — {n} models detected.',
  chooseDetectedModel: 'Choose a detected model',
  chooseDetectedModelOption: '— choose a detected model —',
  sectionGeneration: 'Generation',
  modelMode: 'Model mode',
  modelModeFull: 'Full',
  modelModeSimple: 'Simple',
  modelModeSub:
    'Simple: no tools are exposed to the model — Hanami handles memory server-side (facts are extracted during compaction) and guesses the emotion from the text. Pick this for small models, which often fail at tool calling.',
  temperature: 'Temperature',
  maxTokens: 'Max tokens (reply)',
  maxHistory: 'Max history messages sent',
  showThoughts: 'Show the model’s thoughts',
  showThoughtsSub: 'Shows the reasoning (“thinking”) in a collapsible block above the reply.',
  thoughts: 'Thoughts',
  contextSize: 'Model context size (tokens)',
  autoCompact: 'Automatic compaction',
  timeAwareness: 'Sense of time',
  timeAwarenessSub:
    'The character knows the date, the time, and how long since your last message (visible in the Inspector).',
  autoCompactSub:
    'At ~80% of the context: important facts are saved to memory, then the conversation is summarized. The summary stays visible and editable.',
  contextBadge: '{percent}%',
  contextBadgeTitle: 'Context used: ~{tokens} / {limit} tokens',
  contextUsage: 'Next request: ~{tokens} tokens / {limit} ({percent}%)',
  compacting: 'Compacting the conversation…',
  viewSummary: 'Summary',
  summaryHint:
    'This summary replaces the compacted messages in the context sent to the model. Edit it freely — clearing it undoes the compaction (the full history is sent again).',
  compactNow: 'Compact now',
  compactInstructionPlaceholder: 'Optional instruction (e.g. “keep every detail of the trip”)',
  compactDone: 'Conversation compacted ({n} messages summarized).',
  sectionTts: 'Text-to-speech (TTS)',
  ttsEnabled: 'Read replies out loud',
  ttsEnabledSub: 'Each finished reply is sent to the TTS server and the audio is played.',
  ttsUrl: 'TTS server URL (OpenAI-compatible)',
  ttsModel: 'TTS model',
  ttsVoice: 'Voice',
  ttsHint: 'Server exposing POST /audio/speech in the OpenAI format. Model/voice fields depend on the server.',
  ttsError: 'Text-to-speech: {message}',
  sectionMemoryTools: 'Memory & tools',
  memoryToggle: 'Memory',
  memoryToggleSub: 'Injects the memory block into the context and exposes the memory tools.',
  fileTools: 'File tools',
  fileToolsSub: 'The model can read and write inside the sandbox folder.',
  allowDelete: 'Allow file deletion',
  allowDeleteSub: 'Danger: the model will be able to delete files in the sandbox folder.',
  sandboxDir: 'Tools sandbox folder',
  sectionAccess: 'Access',
  accessPassword: 'Access password',
  accessPasswordPlaceholder: '(empty = no authentication)',
  accessPasswordHint: 'Useful if Hanami is exposed on your network. Empty = open access on your machine.',
  secretConfiguredPlaceholder: '(configured — leave empty to keep)',
  secretNotConfiguredPlaceholder: '(not set)',
  secretWillClearPlaceholder: '(will be removed on save)',
  removeSecret: 'Remove',
  removePasswordConfirm: 'Remove the access password? This instance will no longer be protected.',

  // ── SillyTavern import ───────────────────────────────────────────────────
  importFromSt: 'Import from SillyTavern',
  cardSection: 'Character card (PNG)',
  cardSectionHint: 'The character, its prompt and its greeting are read from the card.',
  importing: 'Importing…',
  choosePng: 'Choose a PNG file',
  characterImported: 'Character “{name}” imported.',
  chatSection: 'Chat history (.jsonl)',
  importNeedCharacter: 'Import or create a target character first.',
  targetCharacter: 'Target character',
  chooseJsonl: 'Choose .jsonl files',
  filesChosenOne: '{n} file selected',
  filesChosenMany: '{n} files selected',
  importedOne: '{n} message imported',
  importedMany: '{n} messages imported',
  filesStayLocal: 'Your files never leave your machine.',

  // ── Login ────────────────────────────────────────────────────────────────
  loginHint: 'This instance is password-protected.',
  password: 'Password',
  loggingIn: 'Signing in…',
  login: 'Enter',

  // ── Memory ───────────────────────────────────────────────────────────────
  memoryHelp:
    'These files are injected into the character’s context (when memory is enabled) and are freely editable. MEMORY.md acts as the index.',
  indexBadge: 'index',
  newMemoryFile: 'Name of the new memory file',
  newMemoryFilePlaceholder: 'new-file.md',
  memoryFileContent: 'Contents of {name}',
  deleteFile: 'Delete',
  noMemoryFiles: 'No memory files.',

  // ── Prompt inspector ─────────────────────────────────────────────────────
  promptInspectorNote: 'This is exactly what Hanami sends to the backend — nothing else.',
  systemPromptTab: 'System prompt',
  payloadTab: 'Full payload',
}

const DICT: Record<Lang, Record<Key, string>> = { fr: FR, en: EN }

export type Vars = Record<string, string | number>

/** Remplace les jetons `{nom}` par les variables fournies. */
function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : token,
  )
}

/** Langue initiale : préférence enregistrée, sinon langue du navigateur. */
export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'fr' || saved === 'en') return saved
  } catch {
    /* localStorage indisponible (mode privé strict) */
  }
  const nav = typeof navigator === 'undefined' ? '' : navigator.language
  return nav.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

// Langue courante au niveau module : permet aux modules non-React (api.ts) de
// traduire sans passer par le contexte.
let currentLang: Lang = detectLang()

export function getLang(): Lang {
  return currentLang
}

/** Traduction hors React (couche API). Dans un composant, préférer `useI18n().t`. */
export function translate(key: Key, vars?: Vars): string {
  return interpolate(DICT[currentLang][key], vars)
}

/** Locale Intl associée à une langue (formats de date/heure). */
export function localeOf(lang: Lang): string {
  return lang === 'fr' ? 'fr-FR' : 'en-US'
}

/** Accord du pluriel : le français ne pluralise qu’au-delà de 1, l’anglais dès 0. */
export function isPlural(lang: Lang, n: number): boolean {
  return lang === 'fr' ? n > 1 : n !== 1
}

export interface I18nValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: Key, vars?: Vars) => string
}

const I18nContext = createContext<I18nValue>({
  lang: currentLang,
  setLang: () => {
    /* hors provider : la langue n’est pas modifiable */
  },
  t: translate,
})

export function I18nProvider({ children }: { children: ReactNode }): ReactElement {
  const [lang, setLangState] = useState<Lang>(() => currentLang)

  const setLang = useCallback((next: Lang) => {
    currentLang = next
    try {
      localStorage.setItem(LANG_KEY, next)
    } catch {
      /* préférence non persistée : pas bloquant */
    }
    setLangState(next)
  }, [])

  useEffect(() => {
    currentLang = lang
    document.documentElement.lang = lang
  }, [lang])

  const value = useMemo<I18nValue>(
    () => ({ lang, setLang, t: (key, vars) => interpolate(DICT[lang][key], vars) }),
    [lang, setLang],
  )

  return createElement(I18nContext.Provider, { value }, children)
}

export function useI18n(): I18nValue {
  return useContext(I18nContext)
}
