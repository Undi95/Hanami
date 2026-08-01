// i18n maison — deux dictionnaires plats (fr/en), zéro dépendance.
// Le dictionnaire français est la source de vérité : le type des clés en dérive,
// donc une clé manquante côté anglais casse `tsc`.
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { ChatMeta } from '../../shared/types'
import { getPref, setPref } from './prefs'

export type Lang = 'fr' | 'en'

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
  selectMenuOptions: 'Choix disponibles',
  selectMenuEmpty: 'Aucun choix',

  // ── Langue ───────────────────────────────────────────────────────────────
  language: 'Langue',
  langFr: 'Français',
  langEn: 'English',

  // ── Thèmes ───────────────────────────────────────────────────────────────
  theme: 'Thème',
  themeSakura: 'Sakura',
  themeMinuit: 'Minuit',
  themeMatcha: 'Matcha',
  themeBraise: 'Braise',
  themeEncre: 'Encre',
  themeCustom: 'Perso',
  themeAppDefault: 'Thème de l’app',
  customThemeBg: 'Fond',
  customThemeAccent: 'Accent',
  themeCode: 'Code du thème (partageable — collez-en un ici)',
  sectionScene: 'Scène',
  env3d: 'Décor 3D',
  env3dSub:
    'Affiche le décor du personnage autour de l’avatar. Éteint : fond 2D ou dégradé, comme avant.',
  vrmaOn: 'Animations gestuelles',
  vrmaOnSub:
    'Utilise les fichiers .vrma du dossier vrma/ : idle en boucle et gestes liés aux émotions. Éteint : respiration seule.',
  sceneLive: 'Scène vivante',
  sceneLiveSub:
    'Le personnage occupe la pièce : il se tourne vers vous, s’y déplace, s’assoit sur ce qu’il y trouve. Éteint : il reste à sa place, comme avant.',
  sceneLiveNoMobile:
    'Réservé au grand écran : sur un écran étroit la scène n’est qu’un bandeau, l’avatar reste posé devant le décor.',
  sceneLiveNoVrma: 'Demande les animations gestuelles : sans les fichiers .vrma, il n’y a aucun pas à jouer.',
  // Astuce montrée UNE SEULE FOIS, en surimpression basse de la scène, à la
  // première scène vivante réellement en service (préférence hint3dSeen). Rien
  // ne signalait ces trois gestes : ils s'apprenaient par accident, ou pas.
  scene3dHint:
    'Cliquez le sol pour l’y envoyer, un siège pour l’y asseoir, le personnage pour attirer son attention.',

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
  environmentLoadError: 'Le décor 3D n’a pas pu être chargé.',
  environmentLoading: 'Chargement du décor…',
  resetLayout: 'Réinitialiser l’affichage (avatar et panneaux)',
  resizeChatPanel: 'Largeur du chat — glissez, double-clic pour réinitialiser',
  resizeVnBox: 'Taille de la boîte de dialogue — glissez, double-clic pour réinitialiser',

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
  // Le libellé long reste le nom accessible du champ ; le champ, lui, affiche le
  // court. Mesuré (Segoe UI 15 px, la police de l'interface) : « Écrire un
  // message… » demande 130,4 px alors que le champ n'offre que 119 px utiles à
  // 320 px de panneau, 130 px en plein écran à 320 et 100 px en mode VN — il
  // passait à la ligne et la seconde ligne était coupée par la hauteur du champ
  // (21 px, une ligne entière), on ne lisait que « Écrire un ». « Message… » :
  // 69,3 px, il tient dans les trois cas avec 30 px de marge au pire.
  // « Votre message… » (108,2 px) ne tenait pas en mode VN.
  writeMessage: 'Écrire un message…',
  writeMessageShort: 'Message…',
  cmdMenuLabel: 'Commandes',
  cmdCompactHint: 'Compacter la conversation (instruction possible après la commande)',
  cmdCleanHint: 'Ouvrir une conversation vierge',
  vnYou: 'Vous',
  send: 'Envoyer',
  stop: 'Arrêter la génération',
  dictate: 'Dicter',
  dictateListening: 'Écoute…',
  replyInProgress: 'Réponse en cours',
  toolCall: '{name} : {args}',
  regenerate: 'Régénérer',
  continueReply: 'Continuer',
  copyMessage: 'Copier le message',
  deleteMessage: 'Supprimer le message',
  deleteMessageArmed: 'Cliquer encore pour supprimer',
  editMessage: 'Modifier le message',
  replyToMessage: 'Répondre à ce message',
  replyingTo: 'En réponse à {name}',
  quotedLine: '{name} : {text}',
  rememberThis: 'Retenir ce message (mémoire)',
  remembered: 'Épinglé dans la mémoire (moments.md).',
  pinMessage: 'Épingler ce message',
  unpin: 'Retirer l’épingle',

  // ── Images (modèles à vision) ────────────────────────────────────────────
  attachImage: 'Joindre une image',
  removeImage: 'Retirer cette image',
  imageAlt: 'Image jointe',
  viewImage: 'Voir l’image en grand',
  closeImage: 'Fermer l’image',

  // ── Recherche dans la conversation (Ctrl+F, ou la loupe de la barre) ──────
  searchInChat: 'Rechercher dans la conversation',
  // Même règle que le composer : le champ affiche court, `searchInChat` reste son
  // nom accessible. « Rechercher dans la conversation… » demande 223,7 px pour
  // 183 px utiles à 320 px de large — 18,2 % du libellé était coupé, on lisait
  // « Rechercher dans la conversa ». « Rechercher… » : 84,3 px.
  searchPlaceholder: 'Rechercher…',
  searchCount: '{n}/{m}',
  searchPrev: 'Correspondance précédente',
  searchNext: 'Correspondance suivante',
  searchClose: 'Fermer la recherche',

  // ── Conversations ────────────────────────────────────────────────────────
  newChat: 'Nouvelle conversation',
  noChats: 'Aucune conversation pour l’instant.',
  defaultChatTitle: 'Conversation du {date}',
  renameChat: 'Renommer la conversation',
  renameChatHint: 'Entrée pour enregistrer, Échap pour annuler.',
  deleteChat: 'Supprimer',
  exportChat: 'Exporter la conversation (.md)',
  exportChatHeader: '{character} · {messages} · commencée le {date}',
  forkChat: 'Dupliquer',
  forkSuffix: 'branche',
  messagesOne: '{n} message',
  messagesMany: '{n} messages',
  // Ligne posée à la place des images d'un message dans le fichier exporté : les
  // vignettes sont des data URLs, les recopier pèserait des mégaoctets par image.
  exportImagesOne: '{n} image jointe',
  exportImagesMany: '{n} images jointes',
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
  portrait: 'Portrait',
  portraitHint: 'Image de la carte importée — tient lieu d’avatar tant qu’aucun modèle 3D n’est choisi.',
  photo: 'Photo',
  photoHint: 'Vignette du personnage dans la liste — à défaut, le portrait de sa carte, puis son initiale.',
  photoCapture: 'Capturer le modèle 3D',
  photoCaptureHint: 'Cadrez l’avatar à l’écran, puis capturez : la photo est ce que vous voyez.',
  photoUpload: 'Envoyer une image',
  photoRemove: 'Retirer',
  photoNoModel: 'Aucun modèle 3D à capturer.',
  photoUnreadable: 'Image illisible.',
  photoTooLarge: 'Image trop lourde (8 Mo maximum).',
  background: 'Fond',
  defaultGradient: 'Dégradé par défaut',
  environment: 'Décor 3D',
  noEnvironment: 'Aucun décor',
  environmentHint:
    'Remplace le fond 2D — l’avatar est posé dans le décor. Fichiers .glb du dossier environments/.',
  envCompressed:
    'Décor compressé (Draco, meshopt ou KTX2) — non pris en charge : réexporte le .glb sans compression.',
  vrmNoData: 'Fichier sans données VRM : {file}',
  addBackground: 'Ajouter une image de fond',
  backgroundFormat: 'Format non pris en charge (png, jpg, webp).',
  backgroundTooLarge: 'Image trop lourde (15 Mo maximum).',
  greeting: 'Message d’accueil',
  greetingPlaceholder: '[happy] Bonjour ! …',
  greetingHint: 'Affiché en première bulle d’un nouveau chat — jamais envoyé au backend.',
  greetingMode: 'Premier message',
  greetingModeWritten: 'Écrit',
  greetingModeGenerated: 'Généré par le modèle',
  greetingModeAsk: 'Demander',
  greetingModeSub:
    'Écrit : une salutation est tirée au hasard. Généré : le modèle ouvre la conversation. Demander : le choix est proposé à chaque nouvelle conversation.',
  greetingVariants: 'Variantes',
  addGreetingVariant: '+ Ajouter une variante',
  removeVariant: 'Retirer cette variante',
  askGreetingTitle: 'Comment ouvrir cette conversation ?',
  askGreetingWritten: 'Écrit',
  askGreetingGenerated: 'Généré',
  systemPrompt: 'Prompt système',
  systemPromptCreateHint:
    'Le caractère du personnage. Écrivez-le maintenant : en accueil « généré » ou « demander », le modèle ouvre la conversation dès la création. Laissé vide, un prompt par défaut est écrit.',
  deleteCharacterWarn: 'Supprimer ce personnage supprime aussi tous ses chats et sa mémoire.',
  deleteCharacterArmed:
    'Dernière chance : cette action supprime le personnage, ses chats et sa mémoire. Irréversible.',
  deleteCharacter: 'Supprimer le personnage',

  // ── Réglages ─────────────────────────────────────────────────────────────
  // Onglets du dialog : trois groupes, un seul formulaire.
  tabAppearance: 'Apparence',
  tabModel: 'Modèle',
  tabFeatures: 'Fonctions',
  sectionConversation: 'Conversation',
  // Persona de l'utilisateur : deux champs, valables pour tous les personnages.
  sectionPersona: 'Vous',
  personaName: 'Votre nom',
  personaNamePlaceholder: 'comment le personnage vous appelle',
  personaDescription: 'Qui vous êtes (en deux lignes)',
  personaDescriptionPlaceholder: 'Ce que le personnage sait de vous : métier, goûts, façon d’être…',
  personaHint:
    'Optionnel, et injecté dans le prompt de tous vos personnages (visible dans l’Inspecteur). Le nom remplace aussi {{user}} dans les cartes importées.',
  sectionBackend: 'Backend LLM',
  backendUrl: 'URL du backend (compatible OpenAI)',
  apiKey: 'Clé API',
  model: 'Modèle',
  modelPlaceholder: '(certains backends l’ignorent)',
  // Boutons de sonde (backend LLM et serveur TTS — même grammaire visuelle).
  probe: 'Tester',
  probing: '…',
  testOkOne: 'Connexion réussie — {n} modèle détecté.',
  testOkMany: 'Connexion réussie — {n} modèles détectés.',
  chooseDetectedModel: 'Modèles détectés — cliquez pour remplir le champ Modèle',
  visionMode: 'Images (vision)',
  visionModeAuto: 'Auto',
  visionModeOn: 'Activé',
  visionModeOff: 'Désactivé',
  visionModeSub:
    'Auto : détection auprès du backend (Ollama). Activé : forcer. Désactivé : jamais. Le trombone de la saisie n’apparaît que si le modèle sait lire une image.',
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
  notifySound: 'Son de notification',
  notifySoundSub: 'Un petit son à la fin de chaque réponse.',
  contextSize: 'Taille de contexte du modèle (tokens)',
  autoCompact: 'Compaction automatique',
  timeAwareness: 'Notion du temps',
  timeAwarenessSub:
    'Le personnage sait la date, l’heure et le temps écoulé depuis votre dernier message (visible dans l’Inspecteur).',
  autoCompactSub:
    'Quand la jauge atteint 100 % : les faits importants sont sauvés en mémoire, puis la conversation est résumée. Le résumé reste visible et modifiable.',
  contextBadge: '{percent} %',
  contextBadgeTitle: 'Contexte utilisé : ~{tokens} / {limit} tokens',
  contextUsage: 'Prochain envoi : ~{tokens} tokens / {limit} ({percent} %)',
  compacting: 'Compactage de la conversation…',
  viewSummary: 'Résumé',
  summaryHint:
    'Ce résumé remplace les messages compactés dans le contexte envoyé au modèle. Corrigez-le librement — le vider annule la compaction (tout l’historique repart).',
  compactNow: 'Compacter maintenant',
  // Même règle que le composer et la recherche : le champ AFFICHE court et
  // s'ANNONCE long. Il partage une .row de 284 px avec « Compacter maintenant »
  // (157,7 px) et ne garde que 92 px utiles à 320 px de large — le libellé
  // complet en demande 421,7, soit 78,2 % coupé (on lisait « Instruction op »),
  // et 65,1 % encore à 375 px. « Instruction… » : 81,55 px, il tient partout.
  compactInstruction: 'Instruction optionnelle (ex. « garde tous les détails du voyage »)',
  compactInstructionPlaceholder: 'Instruction…',
  compactDone: 'Conversation compactée ({n} messages résumés).',
  sectionTts: 'Synthèse vocale (TTS)',
  ttsEnabled: 'Lire les réponses à voix haute',
  ttsEnabledSub: 'Chaque réponse terminée est envoyée au serveur TTS et l’audio est joué.',
  ttsUrl: 'URL du serveur TTS (compatible OpenAI)',
  ttsModel: 'Modèle TTS',
  ttsVoice: 'Voix',
  ttsHint:
    'Serveur exposant POST /audio/speech au format OpenAI — l’URL se termine souvent par /v1 (ex. http://127.0.0.1:8880/v1). Champs modèle/voix selon le serveur.',
  ttsProbeOk: 'Serveur joignable.',
  ttsProbeFail: 'Serveur injoignable.',
  ttsProbeNoVoices: 'aucune liste de voix exposée',
  ttsProbeVoices: 'Voix proposées par le serveur — cliquez pour remplir le champ Voix',
  ttsError: 'Synthèse vocale : {message}',
  replayTts: 'Réécouter',
  stopTts: 'Couper la voix',
  sectionSpontaneous: 'Messages spontanés',
  spontaneousEnabled: 'Le personnage peut écrire de lui-même',
  spontaneousEnabledSub:
    'Pendant vos absences : un petit mot après quelques heures, puis de plus en plus espacé, puis un dernier message compréhensif — et le silence jusqu’à votre retour. Jamais en dehors de la plage horaire.',
  spontaneousStart: 'Pas avant (heure)',
  spontaneousEnd: 'Pas après (heure)',
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
  accessPasswordHint: 'Utile si Hanami est exposé sur le réseau. Vide = accès libre en local.',
  secretConfiguredPlaceholder: '(configuré — laisser vide pour conserver)',
  secretNotConfiguredPlaceholder: '(non configuré)',
  secretWillClearPlaceholder: '(sera retiré à l’enregistrement)',
  removeSecret: 'Retirer',
  removePasswordConfirm: 'Retirer le mot de passe d’accès ? L’instance ne sera plus protégée.',
  sectionData: 'Données',
  backupDownload: 'Télécharger une sauvegarde',
  backupDownloading: 'Préparation…',
  backupHint:
    'Un zip de data/ et des portraits — modèles 3D, fonds, décors et animations non inclus.',

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
  sceneTab: 'Scène',
  sceneHint:
    'Notes propres à cette conversation, ajoutées telles quelles au prompt système. Vide = rien n’est envoyé.',
  scenePlaceholder: 'Lieu, ambiance, contexte de la scène…',
  characterPromptHint:
    'Le prompt du personnage — écrivez-le ici, le prochain message envoyé s’en sert déjà (c’est le même champ que « Prompt système » dans Personnages). Seules {{char}} et {{user}} sont remplacées à l’envoi : l’onglet « Payload complet » montre le texte réellement transmis.',
  injectedHint:
    'Ajouté par Hanami à la suite du prompt, à chaque envoi : vous (persona), mémoire, résumé de compaction, notes de scène, heure. Chaque bloc s’édite là où il vit (panneau Mémoire, onglets Résumé et Scène, réglages).',
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
  selectMenuOptions: 'Available choices',
  selectMenuEmpty: 'No choices',

  // ── Language ─────────────────────────────────────────────────────────────
  language: 'Language',
  langFr: 'Français',
  langEn: 'English',

  // ── Themes ───────────────────────────────────────────────────────────────
  theme: 'Theme',
  themeSakura: 'Sakura',
  themeMinuit: 'Midnight',
  themeMatcha: 'Matcha',
  themeBraise: 'Ember',
  themeEncre: 'Ink',
  themeCustom: 'Custom',
  themeAppDefault: 'App theme',
  customThemeBg: 'Background',
  customThemeAccent: 'Accent',
  themeCode: 'Theme code (shareable — paste one here)',
  sectionScene: 'Scene',
  env3d: '3D environment',
  env3dSub:
    'Shows the character’s environment around the avatar. Off: 2D background or gradient, as before.',
  vrmaOn: 'Gesture animations',
  vrmaOnSub:
    'Uses the .vrma files from the vrma/ folder: looping idle and gestures tied to emotions. Off: breathing only.',
  sceneLive: 'Living scene',
  sceneLiveSub:
    'The character inhabits the room: turns to face you, walks around, sits on whatever it finds. Off: it stays put, as before.',
  sceneLiveNoMobile:
    'Large screens only: on a narrow screen the scene is just a strip, and the avatar stays in front of the environment.',
  sceneLiveNoVrma: 'Needs gesture animations: without the .vrma files there is no step to play.',
  scene3dHint:
    'Click the floor to send it there, a seat to sit it down, the character to get its attention.',

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
  environmentLoadError: 'The 3D environment could not be loaded.',
  environmentLoading: 'Loading the environment…',
  resetLayout: 'Reset the layout (avatar and panels)',
  resizeChatPanel: 'Chat width — drag, double-click to reset',
  resizeVnBox: 'Dialogue box size — drag, double-click to reset',

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
  writeMessageShort: 'Message…',
  cmdMenuLabel: 'Commands',
  cmdCompactHint: 'Compact the conversation (an instruction may follow the command)',
  cmdCleanHint: 'Open a fresh conversation',
  vnYou: 'You',
  send: 'Send',
  stop: 'Stop generating',
  dictate: 'Dictate',
  dictateListening: 'Listening…',
  replyInProgress: 'Reply in progress',
  toolCall: '{name}: {args}',
  regenerate: 'Regenerate',
  continueReply: 'Continue',
  copyMessage: 'Copy message',
  deleteMessage: 'Delete message',
  deleteMessageArmed: 'Click again to delete',
  editMessage: 'Edit message',
  replyToMessage: 'Reply to this message',
  replyingTo: 'Replying to {name}',
  quotedLine: '{name}: {text}',
  rememberThis: 'Remember this message (memory)',
  remembered: 'Pinned to memory (moments.md).',
  pinMessage: 'Pin this message',
  unpin: 'Remove the pin',

  // ── Images (vision models) ───────────────────────────────────────────────
  attachImage: 'Attach an image',
  removeImage: 'Remove this image',
  imageAlt: 'Attached image',
  viewImage: 'View the image larger',
  closeImage: 'Close the image',

  // ── In-conversation search (Ctrl+F, or the magnifier in the bar) ─────────
  searchInChat: 'Search in conversation',
  searchPlaceholder: 'Search…',
  searchCount: '{n}/{m}',
  searchPrev: 'Previous match',
  searchNext: 'Next match',
  searchClose: 'Close search',

  // ── Conversations ────────────────────────────────────────────────────────
  newChat: 'New conversation',
  noChats: 'No conversations yet.',
  defaultChatTitle: 'Conversation from {date}',
  renameChat: 'Rename conversation',
  renameChatHint: 'Enter to save, Esc to cancel.',
  deleteChat: 'Delete',
  exportChat: 'Export conversation (.md)',
  exportChatHeader: '{character} · {messages} · started on {date}',
  forkChat: 'Duplicate',
  forkSuffix: 'branch',
  messagesOne: '{n} message',
  messagesMany: '{n} messages',
  exportImagesOne: '{n} attached image',
  exportImagesMany: '{n} attached images',
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
  portrait: 'Portrait',
  portraitHint: 'Image from the imported card — stands in as the avatar until a 3D model is chosen.',
  photo: 'Photo',
  photoHint: 'The character’s thumbnail in the list — otherwise the portrait from its card, then its initial.',
  photoCapture: 'Capture the 3D model',
  photoCaptureHint: 'Frame the avatar on screen, then capture: the photo is what you see.',
  photoUpload: 'Upload an image',
  photoRemove: 'Remove',
  photoNoModel: 'No 3D model to capture.',
  photoUnreadable: 'Unreadable image.',
  photoTooLarge: 'Image too large (8 MB maximum).',
  background: 'Background',
  defaultGradient: 'Default gradient',
  environment: '3D environment',
  noEnvironment: 'No environment',
  environmentHint:
    'Replaces the 2D background — the avatar stands inside the room. .glb files from the environments/ folder.',
  envCompressed:
    'Compressed environment (Draco, meshopt or KTX2) — unsupported: re-export the .glb without compression.',
  vrmNoData: 'File has no VRM data: {file}',
  addBackground: 'Add a background image',
  backgroundFormat: 'Unsupported format (png, jpg, webp).',
  backgroundTooLarge: 'Image too large (15 MB maximum).',
  greeting: 'Greeting',
  greetingPlaceholder: '[happy] Hi there! …',
  greetingHint: 'Shown as the first bubble of a new chat — never sent to the backend.',
  greetingMode: 'First message',
  greetingModeWritten: 'Written',
  greetingModeGenerated: 'Generated by the model',
  greetingModeAsk: 'Ask',
  greetingModeSub:
    'Written: one greeting is picked at random. Generated: the model opens the conversation. Ask: the choice is offered for every new conversation.',
  greetingVariants: 'Variants',
  addGreetingVariant: '+ Add a variant',
  removeVariant: 'Remove this variant',
  askGreetingTitle: 'How should this conversation open?',
  askGreetingWritten: 'Written',
  askGreetingGenerated: 'Generated',
  systemPrompt: 'System prompt',
  systemPromptCreateHint:
    'Who the character is. Write it now: with the “generated” or “ask” greeting, the model opens the conversation the moment the character is created. Left empty, a default prompt is written.',
  deleteCharacterWarn: 'Deleting this character also deletes all of its chats and its memory.',
  deleteCharacterArmed: 'Last chance: this deletes the character, its chats and its memory. There is no undo.',
  deleteCharacter: 'Delete character',

  // ── Settings ─────────────────────────────────────────────────────────────
  tabAppearance: 'Appearance',
  tabModel: 'Model',
  tabFeatures: 'Features',
  sectionConversation: 'Conversation',
  sectionPersona: 'You',
  personaName: 'Your name',
  personaNamePlaceholder: 'what the character calls you',
  personaDescription: 'Who you are (in two lines)',
  personaDescriptionPlaceholder: 'What the character knows about you: work, tastes, the way you are…',
  personaHint:
    'Optional, and injected into every character’s prompt (visible in the Inspector). The name also replaces {{user}} in imported cards.',
  sectionBackend: 'LLM backend',
  backendUrl: 'Backend URL (OpenAI-compatible)',
  apiKey: 'API key',
  model: 'Model',
  modelPlaceholder: '(some backends ignore this)',
  probe: 'Test',
  probing: '…',
  testOkOne: 'Connected — {n} model detected.',
  testOkMany: 'Connected — {n} models detected.',
  chooseDetectedModel: 'Detected models — click one to fill the Model field',
  visionMode: 'Images (vision)',
  visionModeAuto: 'Auto',
  visionModeOn: 'On',
  visionModeOff: 'Off',
  visionModeSub:
    'Auto: detected from the backend (Ollama). On: force it. Off: never. The paperclip in the composer only shows up when the model can read an image.',
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
  notifySound: 'Notification sound',
  notifySoundSub: 'A soft chime at the end of each reply.',
  contextSize: 'Model context size (tokens)',
  autoCompact: 'Automatic compaction',
  timeAwareness: 'Sense of time',
  timeAwarenessSub:
    'The character knows the date, the time, and how long since your last message (visible in the Inspector).',
  autoCompactSub:
    'When the gauge reaches 100%: important facts are saved to memory, then the conversation is summarized. The summary stays visible and editable.',
  contextBadge: '{percent}%',
  contextBadgeTitle: 'Context used: ~{tokens} / {limit} tokens',
  contextUsage: 'Next request: ~{tokens} tokens / {limit} ({percent}%)',
  compacting: 'Compacting the conversation…',
  viewSummary: 'Summary',
  summaryHint:
    'This summary replaces the compacted messages in the context sent to the model. Edit it freely — clearing it undoes the compaction (the full history is sent again).',
  compactNow: 'Compact now',
  compactInstruction: 'Optional instruction (e.g. “keep every detail of the trip”)',
  compactInstructionPlaceholder: 'Instruction…',
  compactDone: 'Conversation compacted ({n} messages summarized).',
  sectionTts: 'Text-to-speech (TTS)',
  ttsEnabled: 'Read replies out loud',
  ttsEnabledSub: 'Each finished reply is sent to the TTS server and the audio is played.',
  ttsUrl: 'TTS server URL (OpenAI-compatible)',
  ttsModel: 'TTS model',
  ttsVoice: 'Voice',
  ttsHint:
    'Server exposing POST /audio/speech in the OpenAI format — the URL usually ends with /v1 (e.g. http://127.0.0.1:8880/v1). Model/voice fields depend on the server.',
  ttsProbeOk: 'Server reachable.',
  ttsProbeFail: 'Server unreachable.',
  ttsProbeNoVoices: 'no voice list exposed',
  ttsProbeVoices: 'Voices offered by the server — click one to fill the Voice field',
  ttsError: 'Text-to-speech: {message}',
  replayTts: 'Listen again',
  stopTts: 'Stop the voice',
  sectionSpontaneous: 'Spontaneous messages',
  spontaneousEnabled: 'The character can write on their own',
  spontaneousEnabledSub:
    'While you are away: a little message after a few hours, then more and more spaced out, then one last understanding note — and silence until you return. Never outside the time window.',
  spontaneousStart: 'Not before (hour)',
  spontaneousEnd: 'Not after (hour)',
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
  accessPasswordHint: 'Useful if Hanami is exposed on your network. Empty = open access on your machine.',
  secretConfiguredPlaceholder: '(configured — leave empty to keep)',
  secretNotConfiguredPlaceholder: '(not set)',
  secretWillClearPlaceholder: '(will be removed on save)',
  removeSecret: 'Remove',
  removePasswordConfirm: 'Remove the access password? This instance will no longer be protected.',
  sectionData: 'Data',
  backupDownload: 'Download a backup',
  backupDownloading: 'Preparing…',
  backupHint:
    'A zip of data/ and the portraits — 3D models, backgrounds, environments and animations not included.',

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
  sceneTab: 'Scene',
  sceneHint:
    'Notes for this conversation only, added as-is to the system prompt. Empty = nothing is sent.',
  scenePlaceholder: 'Place, mood, context of the scene…',
  characterPromptHint:
    'The character’s prompt — write it here, the very next message already uses it (same field as “System prompt” in Characters). Only {{char}} and {{user}} are replaced on send: the “Full payload” tab shows the text actually transmitted.',
  injectedHint:
    'Appended by Hanami after the prompt on every request: you (persona), memory, compaction summary, scene notes, time. Each block is edited where it lives (Memory panel, Summary and Scene tabs, settings).',
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

/**
 * Langue initiale : préférence enregistrée (cache synchrone de prefs.ts, donc
 * aucun flash au chargement), sinon langue du navigateur. La valeur du serveur
 * arrive au boot et s'applique via setLang si elle diffère.
 */
export function detectLang(): Lang {
  const saved = getPref('lang')
  if (saved === 'fr' || saved === 'en') return saved
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

// ── Titre affiché d'une conversation ───────────────────────────────────────
// Deux états, et deux seulement :
//  1. titre AUTOMATIQUE (titleCustom absent) → re-rendu dans la langue courante ;
//  2. titre VOULU par l'utilisateur (titleCustom) → affiché tel quel, jamais traduit.
// Les titres stockés le sont dans la langue de leur création (« Conversation du
// 29/07/2026 ») : c'est la DATE DE CRÉATION, reformatée dans la locale courante,
// qui fait foi pour l'état 1.

/** Ce que l'affichage du titre a besoin de connaître d'une conversation. */
export type ChatTitleSource = Pick<ChatMeta, 'id' | 'title' | 'createdAt' | 'titleCustom'>

// Motif d'un titre par défaut (les deux langues) : sert de REPLI pour les
// conversations d'avant titleCustom, qui n'ont aucun drapeau. La date doit être
// SEULE (chiffres et séparateurs) — un titre composé comme « Conversation du
// 29/07/2026 (branche) » ne matche pas, et passe donc intact.
const DEFAULT_TITLE_RE = /^Conversation (?:du|from) ([\d/.-]+)$/

/** Repli sans date de création exploitable : la date capturée dans le titre est reprise telle quelle. */
function localizeChatTitle(title: string, t: (key: 'defaultChatTitle', vars: Vars) => string): string {
  const m = DEFAULT_TITLE_RE.exec(title)
  return m ? t('defaultChatTitle', { date: m[1] }) : title
}

/** Date de création : `createdAt`, sinon le préfixe AAAA-MM-JJ de l'identifiant. */
function chatCreatedAt(chat: ChatTitleSource): Date | null {
  const created = new Date(chat.createdAt)
  if (!Number.isNaN(created.getTime())) return created
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(chat.id)
  if (!m) return null
  const fromId = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(fromId.getTime()) ? null : fromId
}

/**
 * Titre à afficher pour une conversation (null = aucune → chaîne vide).
 * UNE seule source de vérité, partagée par la barre du haut, la bande VN et la
 * liste des conversations.
 */
export function chatDisplayTitle(
  chat: ChatTitleSource | null,
  lang: Lang,
  t: (key: Key, vars?: Vars) => string,
): string {
  if (!chat) return ''
  // Titre voulu par l'utilisateur : intouchable.
  if (chat.titleCustom) return chat.title
  // Sans drapeau : titre automatique SEULEMENT s'il suit le motif par défaut —
  // un chat importé ou une vieille branche de fork garde son nom intact.
  if (!DEFAULT_TITLE_RE.test(chat.title)) return chat.title
  const created = chatCreatedAt(chat)
  if (!created) return localizeChatTitle(chat.title, t)
  return t('defaultChatTitle', { date: created.toLocaleDateString(localeOf(lang)) })
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
    setPref({ lang: next }) // cache local + PUT débouncé (le serveur fait foi)
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
