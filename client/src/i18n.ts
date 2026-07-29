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

  // ── Saisie et fil de messages ────────────────────────────────────────────
  writeMessage: 'Écrire un message…',
  send: 'Envoyer',
  stop: 'Arrêter la génération',
  replyInProgress: 'Réponse en cours',
  toolCall: '{name} : {args}',

  // ── Conversations ────────────────────────────────────────────────────────
  newChat: 'Nouvelle conversation',
  noChats: 'Aucune conversation pour l’instant.',
  defaultChatTitle: 'Conversation du {date}',
  deleteChat: 'Supprimer',
  messagesOne: '{n} message',
  messagesMany: '{n} messages',

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
  temperature: 'Température',
  maxTokens: 'Tokens max (réponse)',
  maxHistory: 'Messages d’historique max envoyés',
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

  // ── Composer and message feed ────────────────────────────────────────────
  writeMessage: 'Write a message…',
  send: 'Send',
  stop: 'Stop generating',
  replyInProgress: 'Reply in progress',
  toolCall: '{name}: {args}',

  // ── Conversations ────────────────────────────────────────────────────────
  newChat: 'New conversation',
  noChats: 'No conversations yet.',
  defaultChatTitle: 'Conversation from {date}',
  deleteChat: 'Delete',
  messagesOne: '{n} message',
  messagesMany: '{n} messages',

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
  temperature: 'Temperature',
  maxTokens: 'Max tokens (reply)',
  maxHistory: 'Max history messages sent',
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
