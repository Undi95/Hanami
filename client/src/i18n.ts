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
  exportCharacter: 'Exporter en carte (PNG ou .json)',
  // Voix propre au personnage (dialog Personnages) — le serveur de synthèse,
  // lui, reste un réglage d'application.
  characterTts: 'Voix',
  characterTtsSub:
    'Ce personnage lit ses réponses à voix haute. Éteint par défaut : chaque personnage décide, la synthèse ne parle que pour ceux qui l’ont allumée.',
  characterTtsOffGlobally:
    'La synthèse vocale est éteinte dans les Réglages : allumez-la là-bas pour entendre ce personnage.',
  characterVoice: 'Sa voix',
  characterVoicePlaceholder: 'identifiant exact (ex. clone:Sakurav1)',
  characterVoiceHint:
    'Laissez vide pour la voix par défaut des Réglages. « Tester » interroge le serveur de synthèse configuré et propose ses voix.',
  // Famille d'animations propre au personnage (dialog Personnages). Deux
  // bibliothèques complètes et étanches — cf. vrma/README.md.
  characterAnimations: 'Gestuelle',
  animOverte: 'Overte',
  animRocketbox: 'Rocketbox',
  characterAnimationsHint:
    'Deux bibliothèques complètes, jamais mélangées. Rocketbox apporte une gestuelle plus large et un socle d’écoute : le personnage change de posture pendant que vous tapez. Marcher et s’asseoir restent d’Overte dans les deux cas — la scène vivante 3D n’existe que là.',
  importTitle: 'Importer',
  settingsUnavailable: 'Réglages indisponibles (serveur injoignable).',
  responseInterrupted: 'Réponse interrompue par le serveur.',
  vrmLoadError: 'Le modèle 3D n’a pas pu être chargé.',
  environmentLoadError: 'Le décor 3D n’a pas pu être chargé.',
  environmentLoading: 'Chargement du décor…',
  // Décor affiché mais mal calé (bannière discrète, côté scène). L'analyse
  // recale toute seule les décors qu'elle peut ; il ne reste ici que ce qu'elle
  // n'a pas le droit de corriger — un `spawn` de sidecar, la parole de l'auteur
  // — ou ce qu'elle n'a pas su corriger. Sans ces phrases, l'écran est sombre
  // et muet, alors que la mesure existe dans le fichier d'analyse.
  envPlacementGround: 'Ce décor place son sol à {m} m des pieds du personnage.',
  envPlacementBlind: 'Ce décor enferme la caméra là où le personnage se tient.',
  envPlacementOutside: 'Ce décor pose le personnage hors de sa pièce praticable.',
  envPlacementFix: 'Ajoutez « "spawn": {spawn} » dans {file}, à côté du .glb.',
  resetLayout: 'Réinitialiser l’affichage (avatar et panneaux)',
  resizeChatPanel: 'Largeur du chat — glissez, double-clic pour réinitialiser',
  resizeVnBox: 'Taille de la boîte de dialogue — glissez, double-clic pour réinitialiser',
  sheetHandleHint: 'Toucher : replier · Glisser : hauteur · Double-toucher : réinitialiser',
  vnHideBox: 'Masquer le dialogue (la scène seule)',
  vnShowBox: 'Réafficher le dialogue',

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
  cmdSearchHint: 'Forcer une recherche web sur ce sujet',
  vnYou: 'Vous',
  send: 'Envoyer',
  stop: 'Arrêter la génération',
  dictate: 'Dicter',
  dictateListening: 'Écoute…',
  impersonate: 'Écrire à ma place',
  replyInProgress: 'Réponse en cours',
  toolCall: '{name} : {args}',
  webSearchStatus: 'Recherche sur le Web : {query}',
  toolResultsHint: 'Cliquer pour voir les résultats',
  toolRunningHint: 'Action en cours…',
  toolTraceList: 'Liste les fichiers',
  toolTraceRead: 'Lit {target}',
  toolTraceWrite: 'Écrit {target}',
  toolTraceEdit: 'Modifie {target}',
  toolTraceDelete: 'Supprime {target}',
  toolTraceMemSave: 'Mémoire : crée {target}',
  toolTraceMemUpdate: 'Mémoire : modifie {target}',
  toolTraceMemAppend: 'Mémoire : ajoute à {target}',
  toolTraceMemRead: 'Mémoire : lit {target}',
  toolTraceMemDelete: 'Mémoire : supprime {target}',
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
  // Variantes de réponse : « Régénérer » les empile, ces flèches les feuillettent.
  // Le titre dit l'essentiel — au prochain message, seule celle qu'on lit reste.
  variantCount: '{n}/{m}',
  variantPrev: 'Variante précédente',
  variantNext: 'Variante suivante',
  variantTitle: 'Variante {n} sur {m} — seule celle qui est affichée sera conservée au prochain message',

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
  filterChats: 'Filtrer par titre…',
  noChatsMatch: 'Aucune conversation ne porte ce titre.',
  defaultChatTitle: 'Conversation du {date}',
  renameChat: 'Renommer la conversation',
  renameChatHint: 'Entrée pour enregistrer, Échap pour annuler.',
  deleteChat: 'Supprimer',
  exportChat: 'Exporter la conversation (.md)',
  sceneNotesOpen: 'Notes de scène de cette conversation',
  sceneNotesOpenSet: 'Notes de scène (cette conversation en a)',
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
  tabCredits: 'Crédits',
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
  compactThreshold: 'Seuil de compaction (tokens)',
  compactThresholdSub:
    'La jauge et l’auto-compaction se calent sur cette valeur, jamais au-delà de la taille de contexte. 0 = pas de seuil : la jauge couvre tout le contexte. Au-delà du seuil, un modèle local est plus lent, pas plus précis.',
  autoCompact: 'Compaction automatique',
  timeAwareness: 'Notion du temps',
  timeAwarenessSub:
    'Le personnage sait la date, l’heure et le temps écoulé depuis votre dernier message (visible dans l’Inspecteur).',
  autoCompactSub:
    'Quand la jauge atteint 100 % : les faits importants sont sauvés en mémoire, puis la conversation est résumée. Le résumé reste visible et modifiable. Le niveau auquel la jauge se remplit se règle dans « Seuil de compaction ».',
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
  ttsEnabledSub:
    'Interrupteur général de la voix, et serveur de synthèse pour tout le monde. Chaque personnage a ensuite le sien (Personnages → Modifier), éteint par défaut.',
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
  sectionWebSearch: 'Recherche web',
  webSearchHelp: 'Choisissez ci-dessous le moteur de recherche du personnage. DuckDuckGo ne demande aucune configuration ; SearXNG et Tavily sont plus fiables.',
  webSearchToggle: 'Recherche web',
  webSearchToggleSub: 'Le personnage peut chercher sur le Web quand c’est utile — et /search force une recherche.',
  webSearchEngineLabel: 'Moteur de recherche',
  webSearchEngineDdg: 'DuckDuckGo',
  webSearchEngineSearxng: 'SearXNG',
  webSearchEngineTavily: 'Tavily',
  webSearchEngineDdgHint: 'Par défaut, aucune configuration — mais peut être temporairement limité (rate-limit) en cas d’usage intensif.',
  webSearchEngineSearxngHint: 'Recommandé : le plus privé et le plus fiable — demande une petite installation (voir le guide ci-dessous).',
  webSearchEngineTavilyHint: 'Fiable et simple : une clé API gratuite suffit.',
  webSearchUrlLabel: 'Instance SearXNG',
  webSearchUrlPlaceholder: 'http://127.0.0.1:8888',
  webSearchUrlHint: 'Adresse de votre instance SearXNG locale.',
  tavilyApiKeyLabel: 'Clé API Tavily',
  tavilyApiKeyHint: 'Clé gratuite sur tavily.com — le plan gratuit suffit largement pour un usage personnel.',
  searxngGuideButton: 'Comment installer SearXNG ?',
  searxngGuideTitle: 'Installer SearXNG',
  searxngGuideIntro:
    'SearXNG est l’option la plus propre : vos recherches ne passent par aucun service tiers, restent privées, et ne sont jamais limitées. Ça demande une petite installation, mais rien de compliqué — même si vous n’avez jamais fait ça.',
  searxngGuideStep1: '1. Installez Docker Desktop (gratuit) : docker.com/products/docker-desktop — puis ouvrez-le une fois, il doit tourner en arrière-plan.',
  searxngGuideStep2:
    '2. Créez un dossier (par ex. « searxng » dans vos Documents), et dedans un fichier texte nommé settings.yml avec ce contenu — remplacez juste le texte secret par n’importe quelle suite de caractères à vous :',
  searxngGuideStep3: '3. Ouvrez un terminal DANS ce dossier, puis lancez cette commande (elle démarre SearXNG et le garde actif en arrière-plan) :',
  searxngGuideStep4: '4. Patientez quelques secondes, puis collez http://127.0.0.1:8888 dans le champ URL ci-dessus — c’est fait.',
  searxngGuideNote:
    'Le format JSON (déjà activé dans le fichier ci-dessus) est indispensable : sans lui, SearXNG répond mais Hanami ne peut pas lire les résultats (erreur 403).',
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

  // ── Crédits ──────────────────────────────────────────────────────────────
  // Cet onglet EST l'obligation CC BY des décors : « l'attribution doit rester
  // accessible aux utilisateurs de l'application ». Les libellés seuls sont
  // ici ; la liste, elle, vit dans shared/credits.ts (et, pour les décors, dans
  // les fichiers .glb eux-mêmes).
  creditsIntro:
    'Hanami repose sur le travail d’autres gens. Tout est réuni ici — y compris ce qu’aucune licence n’oblige à citer.',
  creditsEnvironments: 'Décors 3D',
  creditsEnvironmentsNote:
    'L’attribution ci-dessous est lue dans chaque fichier livré, jamais recopiée : un décor ajouté se crédite tout seul. La CC BY 4.0 l’impose et veut qu’elle reste accessible depuis l’application — la voici. L’échelle et le placement vivent à côté du modèle, pas dedans.',
  creditsEnvironmentsEmpty: 'Aucun décor installé.',
  creditsNoAttribution: 'Attribution absente du fichier — à retrouver avant toute redistribution.',
  creditsAnimations: 'Animations',
  creditsAvatar: 'Avatar d’exemple',
  creditsAvatarNote:
    'Le seul modèle 3D livré avec l’app, celui que porte Hana au premier lancement. Sa licence exige d’être citée, et elle autorise explicitement la redistribution — ce que la quasi-totalité des modèles VRM gratuits refusent. Vos propres modèles, déposés dans vrm/, ne regardent que vous.',
  creditsFont: 'Police',
  creditsCode: 'Code',
  creditsCodeNote: 'Rien de ce qui suit n’exige d’être cité. Tout y est quand même.',
  creditsBy: 'par',
  creditsAppLicense: 'Hanami lui-même est sous licence',
  creditsDocs:
    'Le détail juridique — correspondance fichier par fichier, avis de licence intégraux — vit dans NOTICE.md, vrma/NOTICE.md et environments/CREDITS.md. Cet écran donne le crédit ; ces fichiers le documentent.',

  // ── Restauration d'une sauvegarde ────────────────────────────────────────
  // Deux temps, toujours dans cet ordre : l'aperçu (qui n'écrit rien) puis la
  // confirmation armée. Les phrases disent ce qui sera REMPLACÉ, et surtout ce
  // qui ne le sera pas — une restauration ne supprime jamais.
  restoreTitle: 'Restaurer une sauvegarde',
  restoreChoose: 'Choisir une archive .zip',
  restoreReading: 'Lecture de l’archive…',
  restoreHint:
    'Un aperçu s’affiche avant toute écriture. Rien n’est supprimé : les personnages absents de l’archive sont conservés.',
  restoreFrom: 'Sauvegarde du {date}',
  restoreFromUnknown: 'Sauvegarde sans date',
  restoreFilesOne: '{n} fichier',
  restoreFilesMany: '{n} fichiers',
  restoreCharsOne: '{n} personnage',
  restoreCharsMany: '{n} personnages',
  restoreChatsOne: '{n} conversation',
  restoreChatsMany: '{n} conversations',
  restoreMemoryOne: '{n} fichier mémoire',
  restoreMemoryMany: '{n} fichiers mémoire',
  restorePortraitsOne: '{n} portrait',
  restorePortraitsMany: '{n} portraits',
  restoreConfigItem: 'les réglages',
  restoreUiItem: 'les préférences d’interface',
  restoreAddedOne: '{n} fichier ajouté',
  restoreAddedMany: '{n} fichiers ajoutés',
  restoreReplacedOne: '{n} fichier remplacé',
  restoreReplacedMany: '{n} fichiers remplacés',
  restoreIdenticalOne: '{n} fichier déjà identique',
  restoreIdenticalMany: '{n} fichiers déjà identiques',
  restoreStatusAdded: 'ajouté',
  restoreStatusReplaced: 'remplacé',
  restoreStatusIdentical: 'inchangé',
  restoreKept: 'Conservés tels quels (absents de l’archive) : {names}',
  restoreWarnConfig:
    'data/config.json sera remplacé : backend, clé API et mot de passe d’accès seront ceux de la sauvegarde.',
  restoreWarnPassword:
    'Le mot de passe d’accès de la sauvegarde est différent : toutes les sessions tomberont, il faudra se reconnecter avec CE mot de passe.',
  restoreWarnNoManifest:
    'Archive faite par une version d’Hanami antérieure au manifeste — reconnue à sa structure.',
  restoreWarnEmpty: 'Cette installation est vide : la restauration ne remplacera rien.',
  restoreArm: 'Restaurer…',
  restoreConfirm: 'Confirmer la restauration',
  restoreWarn:
    'La restauration écrase les fichiers que l’archive apporte. L’état actuel sera archivé juste avant, dans backups/.',
  restoreArmed: 'Confirmer : {added} et {replaced}. Cliquez une seconde fois pour écrire.',
  restoreBusy: 'Restauration…',
  restoreDone: 'Restauration faite — {files}.',
  restoreNet: 'L’état d’avant est archivé ici (jamais supprimé automatiquement) :',
  restoreNoRestart: 'Aucun redémarrage du serveur n’est nécessaire — rechargez simplement la page.',
  restorePasswordChanged: 'Le mot de passe d’accès a changé : reconnectez-vous après le rechargement.',
  restoreReload: 'Recharger Hanami',

  // ── Import SillyTavern ───────────────────────────────────────────────────
  importFromSt: 'Importer depuis SillyTavern',
  cardSection: 'Carte de personnage (PNG ou .json)',
  cardSectionHint:
    'Le personnage, son prompt et ses messages d’accueil sont extraits de la carte. Le PNG sert en plus de portrait ; un .json n’a pas d’image.',
  importing: 'Import…',
  choosePng: 'Choisir un PNG ou un .json',
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
  // « Entrer » est le calque du bouton anglais « Enter » : en français, un bouton
  // de connexion dit « Se connecter » (cohérent avec « Connexion… » ci-dessus).
  login: 'Se connecter',

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
  sceneTab: 'Notes de scène',
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
  sceneLiveNoVrma: 'Needs gesture animations: without the .vrma files it has no steps to play.',
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
  exportCharacter: 'Export as a card (PNG or .json)',
  characterTts: 'Voice',
  characterTtsSub:
    'This character reads their replies out loud. Off by default: each character decides, and speech only happens for those switched on.',
  characterTtsOffGlobally:
    'Text-to-speech is off in Settings: turn it on there to hear this character.',
  characterVoice: 'Their voice',
  characterVoicePlaceholder: 'exact id (e.g. clone:Sakurav1)',
  characterVoiceHint:
    'Leave empty for the default voice from Settings. “Test” asks the configured speech server for its voices.',
  characterAnimations: 'Body language',
  animOverte: 'Overte',
  animRocketbox: 'Rocketbox',
  characterAnimationsHint:
    'Two complete libraries, never mixed. Rocketbox brings a wider range of gestures and a listening idle: the character shifts posture while you type. Walking and sitting down come from Overte either way — the living 3D scene only exists there.',
  importTitle: 'Import',
  settingsUnavailable: 'Settings unavailable (server unreachable).',
  responseInterrupted: 'The server cut the response short.',
  vrmLoadError: 'The 3D model could not be loaded.',
  environmentLoadError: 'The 3D environment could not be loaded.',
  environmentLoading: 'Loading the environment…',
  envPlacementGround: 'This environment puts its floor {m} m away from the character’s feet.',
  envPlacementBlind: 'This environment boxes the camera in where the character stands.',
  envPlacementOutside: 'This environment puts the character outside its walkable room.',
  envPlacementFix: 'Add “"spawn": {spawn}” to {file}, next to the .glb.',
  resetLayout: 'Reset the layout (avatar and panels)',
  resizeChatPanel: 'Chat width — drag, double-click to reset',
  resizeVnBox: 'Dialogue box size — drag, double-click to reset',
  sheetHandleHint: 'Tap: collapse · Drag: height · Double-tap: reset',
  vnHideBox: 'Hide the dialogue (scene only)',
  vnShowBox: 'Show the dialogue again',

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
  cmdSearchHint: 'Force a web search on this topic',
  vnYou: 'You',
  send: 'Send',
  stop: 'Stop generating',
  dictate: 'Dictate',
  dictateListening: 'Listening…',
  impersonate: 'Write for me',
  replyInProgress: 'Reply in progress',
  toolCall: '{name}: {args}',
  webSearchStatus: 'Searching the web: {query}',
  toolResultsHint: 'Click to see the results',
  toolRunningHint: 'Action in progress…',
  toolTraceList: 'Listing files',
  toolTraceRead: 'Reading {target}',
  toolTraceWrite: 'Writing {target}',
  toolTraceEdit: 'Editing {target}',
  toolTraceDelete: 'Deleting {target}',
  toolTraceMemSave: 'Memory: creating {target}',
  toolTraceMemUpdate: 'Memory: updating {target}',
  toolTraceMemAppend: 'Memory: appending to {target}',
  toolTraceMemRead: 'Memory: reading {target}',
  toolTraceMemDelete: 'Memory: deleting {target}',
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
  variantCount: '{n}/{m}',
  variantPrev: 'Previous variant',
  variantNext: 'Next variant',
  variantTitle: 'Variant {n} of {m} — only the one shown is kept once you send the next message',

  // ── Images (vision models) ───────────────────────────────────────────────
  attachImage: 'Attach an image',
  removeImage: 'Remove this image',
  imageAlt: 'Attached image',
  viewImage: 'View the image full-size',
  closeImage: 'Close the image',

  // ── In-conversation search (Ctrl+F, or the magnifier in the bar) ─────────
  searchInChat: 'Search the conversation',
  searchPlaceholder: 'Search…',
  searchCount: '{n}/{m}',
  searchPrev: 'Previous match',
  searchNext: 'Next match',
  searchClose: 'Close search',

  // ── Conversations ────────────────────────────────────────────────────────
  newChat: 'New conversation',
  noChats: 'No conversations yet.',
  filterChats: 'Filter by title…',
  noChatsMatch: 'No conversation matches that title.',
  defaultChatTitle: 'Conversation from {date}',
  renameChat: 'Rename conversation',
  renameChatHint: 'Enter to save, Esc to cancel.',
  deleteChat: 'Delete',
  exportChat: 'Export conversation (.md)',
  sceneNotesOpen: 'Scene notes for this conversation',
  sceneNotesOpenSet: 'Scene notes (this conversation has some)',
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
  tabCredits: 'Credits',
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
  compactThreshold: 'Compaction threshold (tokens)',
  compactThresholdSub:
    'The gauge and auto-compaction are driven by this value, never beyond the context size. 0 = no threshold: the gauge spans the whole context. Past the threshold, a local model is just slower, not smarter.',
  autoCompact: 'Automatic compaction',
  timeAwareness: 'Sense of time',
  timeAwarenessSub:
    'The character knows the date, the time, and how long since your last message (visible in the Inspector).',
  autoCompactSub:
    'When the gauge reaches 100%: important facts are saved to memory, then the conversation is summarized. The summary stays visible and editable. The level at which the gauge fills is set in the compaction threshold field above.',
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
  ttsEnabledSub:
    'Master switch for speech, and the synthesis server for everyone. Each character then has its own switch (Characters → Edit), off by default.',
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
    'While you are away: a little message after a few hours, then more and more spaced out, then a final note of understanding — and silence until you return. Never outside the time window.',
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
  sectionWebSearch: 'Web search',
  webSearchHelp: 'Pick the character’s search engine below. DuckDuckGo needs no setup; SearXNG and Tavily are more reliable.',
  webSearchToggle: 'Web search',
  webSearchToggleSub: 'The character can search the Web when it helps — and /search forces a search.',
  webSearchEngineLabel: 'Search engine',
  webSearchEngineDdg: 'DuckDuckGo',
  webSearchEngineSearxng: 'SearXNG',
  webSearchEngineTavily: 'Tavily',
  webSearchEngineDdgHint: 'No setup needed by default — but may be temporarily rate-limited under heavy use.',
  webSearchEngineSearxngHint: 'Recommended: the most private and reliable — needs a small setup (see the guide below).',
  webSearchEngineTavilyHint: 'Reliable and easy: a free API key is enough.',
  webSearchUrlLabel: 'SearXNG instance',
  webSearchUrlPlaceholder: 'http://127.0.0.1:8888',
  webSearchUrlHint: 'Address of your local SearXNG instance.',
  tavilyApiKeyLabel: 'Tavily API key',
  tavilyApiKeyHint: 'Free key from tavily.com — the free tier is plenty for personal use.',
  searxngGuideButton: 'How do I install SearXNG?',
  searxngGuideTitle: 'Install SearXNG',
  searxngGuideIntro:
    'SearXNG is the cleanest option: your searches never go through a third-party service, stay private, and are never rate-limited. It needs a small setup, but nothing complicated — even if you’ve never done this before.',
  searxngGuideStep1: '1. Install Docker Desktop (free): docker.com/products/docker-desktop — open it once, it needs to be running in the background.',
  searxngGuideStep2:
    '2. Create a folder (e.g. “searxng” in your Documents), and inside it a text file named settings.yml with this content — just replace the secret text with any random string of your own:',
  searxngGuideStep3: '3. Open a terminal INSIDE that folder, then run this command (it starts SearXNG and keeps it running in the background):',
  searxngGuideStep4: '4. Wait a few seconds, then paste http://127.0.0.1:8888 into the URL field above — you’re done.',
  searxngGuideNote:
    'The JSON format (already enabled in the file above) is required: without it, SearXNG responds but Hanami can’t read the results (403 error).',
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

  // ── Credits ──────────────────────────────────────────────────────────────
  creditsIntro:
    'Hanami stands on other people’s work. It is all gathered here — including what no licence obliges us to name.',
  creditsEnvironments: '3D environments',
  creditsEnvironmentsNote:
    'The attribution below is read from each shipped file, never retyped: a new environment credits itself. CC BY 4.0 requires it and wants it reachable from inside the application — here it is. Scale and placement live beside the model, not inside it.',
  creditsEnvironmentsEmpty: 'No environment installed.',
  creditsNoAttribution: 'Attribution missing from the file — track it down before redistributing.',
  creditsAnimations: 'Animations',
  creditsAvatar: 'Example avatar',
  creditsAvatarNote:
    'The only 3D model shipped with the app, the one Hana wears on first launch. Its licence requires being named, and it explicitly allows redistribution — which almost no free VRM model does. Your own models, dropped into vrm/, are nobody’s business but yours.',
  creditsFont: 'Typeface',
  creditsCode: 'Code',
  creditsCodeNote: 'None of the following requires being named. All of it is named anyway.',
  creditsBy: 'by',
  creditsAppLicense: 'Hanami itself is licensed under',
  creditsDocs:
    'The legal detail — file-by-file mapping, full licence notices — lives in NOTICE.md, vrma/NOTICE.md and environments/CREDITS.md. This screen gives the credit; those files document it.',

  // ── Restoring a backup ───────────────────────────────────────────────────
  restoreTitle: 'Restore a backup',
  restoreChoose: 'Choose a .zip archive',
  restoreReading: 'Reading the archive…',
  restoreHint:
    'A preview is shown before anything is written. Nothing is deleted: characters missing from the archive are kept.',
  restoreFrom: 'Backup from {date}',
  restoreFromUnknown: 'Backup with no date',
  restoreFilesOne: '{n} file',
  restoreFilesMany: '{n} files',
  restoreCharsOne: '{n} character',
  restoreCharsMany: '{n} characters',
  restoreChatsOne: '{n} conversation',
  restoreChatsMany: '{n} conversations',
  restoreMemoryOne: '{n} memory file',
  restoreMemoryMany: '{n} memory files',
  restorePortraitsOne: '{n} portrait',
  restorePortraitsMany: '{n} portraits',
  restoreConfigItem: 'the settings',
  restoreUiItem: 'the interface preferences',
  restoreAddedOne: '{n} file added',
  restoreAddedMany: '{n} files added',
  restoreReplacedOne: '{n} file replaced',
  restoreReplacedMany: '{n} files replaced',
  restoreIdenticalOne: '{n} file already identical',
  restoreIdenticalMany: '{n} files already identical',
  restoreStatusAdded: 'added',
  restoreStatusReplaced: 'replaced',
  restoreStatusIdentical: 'unchanged',
  restoreKept: 'Kept as they are (missing from the archive): {names}',
  restoreWarnConfig:
    'data/config.json will be replaced: backend, API key and access password will be the ones from the backup.',
  restoreWarnPassword:
    'The backup carries a different access password: every session will drop, and you will have to sign in with THAT password.',
  restoreWarnNoManifest: 'Archive made by an older build of Hanami, before the manifest — recognised by its structure.',
  restoreWarnEmpty: 'This installation is empty: the restore will not replace anything.',
  restoreArm: 'Restore…',
  restoreConfirm: 'Confirm the restore',
  restoreWarn:
    'Restoring overwrites the files the archive carries. The current state is archived right before, into backups/.',
  restoreArmed: 'Confirm: {added} and {replaced}. Click again to write.',
  restoreBusy: 'Restoring…',
  restoreDone: 'Restore done — {files}.',
  restoreNet: 'The previous state is archived here (never removed automatically):',
  restoreNoRestart: 'No server restart needed — just reload the page.',
  restorePasswordChanged: 'The access password changed: sign in again after reloading.',
  restoreReload: 'Reload Hanami',

  // ── SillyTavern import ───────────────────────────────────────────────────
  importFromSt: 'Import from SillyTavern',
  cardSection: 'Character card (PNG or .json)',
  cardSectionHint:
    'The character, its prompt and its greetings are read from the card. A PNG doubles as the portrait; a .json carries no image.',
  importing: 'Importing…',
  choosePng: 'Choose a PNG or .json',
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
  sceneTab: 'Scene notes',
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
