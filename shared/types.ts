// Types partagés client/serveur — LE contrat de l'app.

// Mode du modèle : 'full' = les outils sont exposés (tool-calling) ; 'simple' =
// AUCUN outil, l'intelligence migre côté serveur — pensé pour les petits modèles,
// dont le tool-calling est le talon d'Achille.
export type ModelMode = 'full' | 'simple'

// Envoi d'images au modèle : 'auto' = détecté auprès du backend (Ollama expose
// les capacités du modèle), 'on' = forcé, 'off' = jamais. En 'off' (ou détection
// négative) le trombone du composer n'existe même pas.
export type VisionMode = 'auto' | 'on' | 'off'

// Moteur utilisé par l'outil web_search : 'duckduckgo' (défaut, sans clé, mais
// sujet au rate-limit), 'searxng' (via Settings.webSearchUrl, le plus privé),
// 'tavily' (via Settings.tavilyApiKey, une clé API gratuite).
export type WebSearchEngine = 'duckduckgo' | 'searxng' | 'tavily'

export interface Settings {
  backendUrl: string // base OpenAI-compat, ex: http://127.0.0.1:5001/v1
  apiKey: string // optionnel (backends locaux : souvent vide)
  model: string // nom du modèle (certains backends l'ignorent)
  modelMode: ModelMode // 'simple' : pas d'outils, mémoire et émotions gérées sans le modèle
  temperature: number
  maxTokens: number // max_tokens de la réponse
  maxHistoryMessages: number // nb max de messages d'historique envoyés
  memoryEnabled: boolean // injecte le bloc mémoire + expose les outils mémoire
  fileToolsEnabled: boolean // expose les outils fichiers au modèle
  allowDelete: boolean // autorise delete_file (toggle ON/OFF)
  toolsRoot: string // dossier sandbox des outils fichiers
  password: string // '' = pas d'authentification (usage local)
  contextSize: number // taille de contexte du modèle (tokens) — la vraie limite du modèle
  compactThreshold: number // seuil (tokens) de la jauge et de l'auto-compaction ; 0 = aucun (jauge sur tout le contexte)
  autoCompact: boolean // compacte automatiquement la conversation quand la jauge atteint 80 % de la fenêtre de travail
  timeAwareness: boolean // injecte date/heure + temps écoulé depuis le dernier message
  // Persona de l'utilisateur : qui il est, pour TOUS ses personnages. Deux
  // champs libres, tous deux optionnels ('' = rien d'injecté). Le nom alimente
  // aussi la macro {{user}} des cards importées (shared/macros.ts).
  // Volontairement UNE seule persona : pas de collection à gérer, pas de
  // sélecteur de plus dans l'interface — c'est le même utilisateur qui parle.
  personaName: string
  personaDescription: string
  showThoughts: boolean // affiche le raisonnement du modèle dans le fil (bloc repliable)
  ttsEnabled: boolean // lit les réponses à voix haute via le serveur TTS
  ttsUrl: string // base OpenAI-compat du serveur TTS (POST {ttsUrl}/audio/speech)
  ttsModel: string // modèle TTS (certains serveurs l'ignorent)
  ttsVoice: string // voix TTS (certains serveurs l'ignorent)
  // Petit « ding » synthétisé à la fin d'une réponse (client/src/sound.ts).
  // Opt-in, et jamais joué quand le TTS lit la réponse : la voix suffit.
  notifySound?: boolean
  spontaneousEnabled: boolean // le personnage écrit de lui-même pendant votre absence
  spontaneousStartHour: number // heure locale à partir de laquelle il peut écrire (0-23)
  spontaneousEndHour: number // heure locale après laquelle il n'écrit plus (0-23)
  visionMode: VisionMode // envoi d'images au modèle (détection auprès du backend par défaut)
  webSearchEnabled: boolean // expose l'outil web_search au modèle
  webSearchEngine: WebSearchEngine // moteur utilisé par web_search
  webSearchUrl: string // base d'une instance SearXNG (ex: http://localhost:8080) — utilisée si webSearchEngine === 'searxng'
  tavilyApiKey: string // clé API Tavily — utilisée si webSearchEngine === 'tavily' ; jamais renvoyée en clair (cf. api/settings.ts)
}

// Comment s'ouvre une conversation vide : 'written' = une des salutations écrites
// est affichée, 'generated' = le modèle écrit le premier message, 'ask' = le choix
// est proposé à l'ouverture. Champ absent = 'written' (character.json historiques).
export type GreetingMode = 'written' | 'generated' | 'ask'

/**
 * Famille d'animations de FACE À FACE d'un personnage : socle, socle parlant,
 * socle d'écoute, gestes d'émotion. Deux bibliothèques complètes et ÉTANCHES
 * (cf. vrma/README.md) : celle d'Overte, sans préfixe, et celle de Microsoft
 * Rocketbox, préfixe `rb-`. Aucun rôle ne les mélange — leurs stations debout
 * diffèrent de 16,5 à 20,3 cm, deux fois et demie le seuil d'acceptation.
 *
 * Le domaine `world-` de la scène vivante 3D (marcher, pivoter, s'asseoir) n'a
 * qu'une famille et n'en aura pas d'autre : Rocketbox ne l'a pas.
 */
export type AnimationFamily = 'overte' | 'rocketbox'

/**
 * Overrides de génération D'UN PERSONNAGE, posés par-dessus les réglages
 * globaux : seul le champ présent est appliqué, l'absent retombe sur le
 * réglage de l'app (un personnage sans cette clé se comporte exactement comme
 * avant). Le backend (URL, clé API) ne se surcharge PAS ici : c'est le moteur
 * de la maison, pas une propriété du personnage.
 */
export interface CharacterLlm {
  model?: string
  modelMode?: ModelMode
  temperature?: number
  maxTokens?: number
  maxHistoryMessages?: number
  contextSize?: number
  compactThreshold?: number
}

export interface CharacterMeta {
  id: string
  name: string
  theme?: string // thème de couleurs propre au personnage (absent = thème de l'app)
  vrm: string // ex: /vrm/mon-avatar.vrm ('' = pas de modèle 3D)
  // Portrait 2D servi par /portraits — avatar de repli affiché dans la scène
  // TANT QUE `vrm` est vide. Posé par l'import d'une card SillyTavern (le PNG de
  // la card EST l'image). Champ absent = aucune représentation visuelle.
  portrait?: string // ex: /portraits/sakura.png
  // Photo du personnage servie par /portraits — VIGNETTE d'identité (liste des
  // personnages), sans rôle dans la scène : capture du modèle 3D tel qu'il est
  // cadré à l'écran, ou image envoyée par l'utilisateur. Toujours un carré.
  // Champ absent = repli sur `portrait`, puis sur l'initiale teintée.
  photo?: string // ex: /portraits/sakura-photo.png?v=1753900000000
  background: string // ex: /backgrounds/room.png ('' = dégradé par défaut)
  // Famille d'animations de face à face (cf. AnimationFamily). Clé ABSENTE =
  // 'overte', le défaut historique : tous les personnages écrits avant ce
  // réglage gardent exactement les animations qu'ils avaient.
  animations?: AnimationFamily
  // Décor 3D servi par /environments — la pièce dans laquelle l'avatar est posé,
  // à la place du fond 2D. Champ absent = aucun décor (comportement historique).
  // Sans modèle VRM, le décor n'est pas chargé : un portrait 2D flottant devant
  // une pièce en 3D n'aurait aucun sens.
  environment?: string // ex: /environments/chambre.glb
  // Voix du personnage : chaque personnage a la sienne, c'est le propre d'une
  // voix. OPT-IN STRICT — clé absente = éteint, pour les personnages existants
  // comme pour les nouveaux : personne ne doit se mettre à parler tout seul
  // parce que l'app a appris à le faire.
  // Le serveur de synthèse, lui, reste UN réglage d'application (Réglages) :
  // c'est le moteur, pas la voix.
  ttsEnabled?: boolean
  // Identifiant EXACT de la voix chez le serveur TTS (ex. « clone:Sakurav1 »).
  // Absent/vide = la voix par défaut des Réglages.
  ttsVoice?: string
  greeting: string // premier message affiché dans un nouveau chat
  greetings?: string[] // variantes supplémentaires (tirage au hasard avec greeting)
  greetingMode?: GreetingMode // absent = 'written'
  // Overrides de génération de ce personnage (cf. CharacterLlm). Clé absente ou
  // vide = tout retombe sur les réglages globaux — un personnage écrit avant ce
  // réglage se comporte exactement comme avant.
  llm?: CharacterLlm
  createdAt: string
}

export interface CharacterFull extends CharacterMeta {
  systemPrompt: string
}

/**
 * Trace d'une action exécutée par le modèle pendant la génération d'une réponse
 * (outil fichier du workspace, mémoire, recherche web…). C'est le journal
 * d'activité du message — destiné à l'AFFICHAGE uniquement : le serveur n'envoie
 * jamais `tools` au backend (le payload ne porte que rôle et texte, comme
 * `thinking`). `result` est plafonné à la persistance (un read_file peut faire
 * 256 Ko ; le .jsonl ne doit pas gonfler), `args` reste le JSON brut — l'affichage
 * en extrait la cible (chemin, nom de mémoire…).
 */
export interface ToolTrace {
  name: string // nom de l'outil (write_file, memory_save…)
  args: string // arguments JSON bruts
  result?: string // résultat ou erreur — plafonné à la persistance
}

/**
 * Une VARIANTE de réponse : le corps d'un message assistant, tel qu'il a été
 * généré. « Régénérer » en ajoute une au lieu d'écraser l'ancienne — on feuillette
 * ensuite. Une variante porte tout ce qui dépend du texte : l'heure de SA
 * génération, SON tag d'émotion (le visage suit la variante affichée), SON
 * raisonnement et les actions QUE SA génération a exécutées.
 */
export interface MessageVariant {
  content: string
  ts: string
  emotion?: string
  thinking?: string
  tools?: ToolTrace[] // actions exécutées pendant CETTE génération
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string // TOUJOURS le texte seul (les images vivent dans `images`)
  images?: string[] // data URLs (image/jpeg ou png) jointes au message — modèles à vision
  ts: string
  emotion?: string // tag d'émotion détecté en tête de message ([happy] etc.)
  thinking?: string // raisonnement du modèle (<think> ou champ reasoning) — jamais renvoyé au backend
  tools?: ToolTrace[] // journal d'activité : actions exécutées pendant la génération — jamais renvoyé au backend
  spontaneous?: true // message écrit à l'initiative du personnage (moteur server/lib/spontaneous.ts)
  // ── Variantes de réponse ─────────────────────────────────────────────────
  // Clés ABSENTES = message ordinaire : tous les chats écrits avant les
  // variantes restent valides tels quels, en lecture comme en écriture (rien
  // n'est inventé à la relecture, cf. normalizeMessage dans lib/storage.ts).
  //
  // INVARIANT DU FORMAT — quand `variants` est présent (toujours ≥ 2 entrées),
  // `content`, `ts`, `emotion`, `thinking` (et `tools` quand la variante en
  // porte) RECOPIENT `variants[variant]`.
  // Tout le reste de l'app lit `content` sans rien savoir des variantes :
  // payload du prochain envoi, export .md, voix, copie, recherche, émotion.
  // Changer la variante affichée, c'est donc changer ce que TOUT le monde voit.
  //
  // Et surtout : une variante vit DANS la ligne du message, elle ne crée AUCUN
  // index de message. L'épingle, `summaryUpto`, la suppression et la compaction
  // continuent de compter les messages exactement comme avant.
  variants?: MessageVariant[]
  variant?: number // indice de la variante affichée dans `variants`
}

export interface ChatMeta {
  id: string
  title: string
  // Titre à DEUX ÉTATS : absent/false = titre automatique (re-rendu dans la langue
  // de l'interface à partir de createdAt), true = titre voulu par l'utilisateur
  // (renommage, branche de fork) — affiché tel quel, jamais traduit.
  titleCustom?: boolean
  createdAt: string
  updatedAt: string
  messageCount: number
  summary?: string // résumé de compaction (visible dans l'inspecteur, éditable)
  summaryUpto?: number // nombre de messages couverts par le résumé (slice de l'historique envoyé)
  // Notes de scène propres à cette conversation (lieu, ambiance, contexte), écrites
  // dans l'onglet Scène de l'Inspecteur. Champ vide/absent = AUCUNE injection.
  sceneNotes?: string
  pinned?: number // ordinal du message épinglé — pur affichage, JAMAIS envoyé au backend
}

// Jauge de contexte jointe à l'événement done (estimation, ou usage réel du backend).
export interface ContextInfo {
  tokens: number // tokens du dernier payload envoyé (+ réponse)
  limit: number // fenêtre de travail : min(contextSize, compactThreshold) — 0 si inconnue
  percent: number // tokens / limit, arrondi (0 si limit inconnue)
}

export interface MemoryFile {
  name: string // nom de fichier .md (MEMORY.md = index)
  content: string
}

// Événements SSE émis par POST /api/chat
export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; name: string; args: string } // l'action DÉMARRE (la puce s'anime) — `tool` apporte le résultat
  | { type: 'tool'; name: string; args: string; result: string }
  | { type: 'done'; message: ChatMessage; context?: ContextInfo }
  | { type: 'error'; message: string; partial?: ChatMessage } // partial = message sauvegardé malgré l'erreur

export const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'relaxed'] as const
export type Emotion = (typeof EMOTIONS)[number]

// ── Restauration d'une sauvegarde (POST /api/backup/restore…) ──────────────
// Le serveur ne renvoie que des CHIFFRES et des CODES : les phrases sont
// écrites dans les deux langues côté client (i18n.ts), jamais ici.

/** Points d'attention d'une restauration — traduits par le client. */
export type RestoreWarning =
  /** Le fichier data/config.json de l'archive remplacera les réglages (clé API et mot de passe compris). */
  | 'configReplaced'
  /** Le mot de passe d'accès de l'archive DIFFÈRE de celui en place : reconnexion nécessaire. */
  | 'passwordChanges'
  /** Archive d'avant le manifeste, reconnue à sa structure. */
  | 'noManifest'
  /** L'instance est vide : la restauration ne remplacera rien. */
  | 'emptyInstance'

/** Un personnage porté par l'archive, et ce qu'il deviendrait. */
export interface RestoreCharacterEntry {
  id: string
  name: string
  status: 'added' | 'replaced' | 'identical'
  chats: number
  memory: number
}

/** L'APERÇU : ce que la restauration ferait. Aucune écriture n'a eu lieu. */
export interface RestorePreview {
  /** Jeton de l'archive déposée — à renvoyer tel quel pour confirmer. */
  stagedId: string
  archive: {
    /** Date de la sauvegarde (ISO), `null` si l'archive ne la porte pas. */
    createdAt: string | null
    /** Version du format ; 0 = archive d'avant le manifeste. */
    version: number
    source: 'manifest' | 'structure'
  }
  /** Décompte des fichiers de l'archive : `ignored` = hors data/ et portraits/. */
  files: { total: number; added: number; replaced: number; identical: number; ignored: number }
  /** Taille décompressée des fichiers restaurables. */
  bytes: number
  counts: {
    characters: number
    chats: number
    memory: number
    portraits: number
    config: boolean
    ui: boolean
    other: number
  }
  characters: RestoreCharacterEntry[]
  /** Ce que la restauration NE touche pas : rien n'est jamais supprimé. */
  kept: { characters: string[]; files: number }
  warnings: RestoreWarning[]
}

/** Ce qui a réellement été écrit. */
export interface RestoreResult {
  /** Le filet : l'état d'AVANT, archivé juste avant d'écrire. Jamais supprimé. */
  net: { file: string; fileCount: number; bytes: number }
  files: { total: number; added: number; replaced: number; identical: number }
  /** Le mot de passe d'accès a changé : les sessions sont tombées, il faut se reconnecter. */
  passwordChanged: boolean
}

// ── Préférences d'interface (data/ui.json) ─────────────────────────────────
// L'utilisateur est SEUL sur son serveur : ses réglages d'interface le suivent
// du PC au téléphone. Le serveur fait foi ; le localStorage du client n'en est
// qu'un cache de démarrage. Le token d'accès, lui, reste local (clé par appareil).

/** Cadrage caméra de la scène 3D (position + cible, coordonnées monde) — sérialisable tel quel. */
export interface StageView {
  pos: [number, number, number]
  target: [number, number, number]
}

/** Thème perso : deux couleurs hex (#rrggbb), tout le shading est dérivé en CSS. */
export interface UiCustomTheme {
  bg: string
  accent: string
}

export interface UiPrefs {
  lang?: 'fr' | 'en'
  theme?: string // identifiant de thème préfait, ou 'custom'
  customTheme?: UiCustomTheme
  vnMode?: boolean // mode visual novel
  // Décor 3D allumé/éteint (défaut : allumé). Éteint = fond 2D ou dégradé, comme
  // avant les décors. Vit ici et non dans le personnage : c'est un réglage
  // d'APPAREIL au sens du confort (une pièce en 3D coûte cher sur un téléphone),
  // pas une propriété du personnage. Limite assumée du contrat ui.json : il suit
  // l'utilisateur d'un appareil à l'autre, couper le décor sur mobile le coupe
  // aussi sur PC.
  env3d?: boolean
  // Animations .vrma allumées/éteintes (défaut : allumé). Même famille que env3d
  // — un réglage de confort, pas une propriété du personnage. Éteint, la scène
  // décharge le mixer et retombe sur la respiration seule.
  vrmaEnabled?: boolean
  // Scène vivante : le personnage occupe la pièce (il s'y déplace, s'y assoit,
  // se tourne vers vous). OPT-IN STRICT — clé absente = éteint, contrairement à
  // env3d et vrmaEnabled : c'est le seul réglage de scène qui change ce que le
  // personnage FAIT, et pas seulement ce qu'on voit de lui.
  // Même famille qu'eux pour le reste : un réglage de confort, pas une propriété
  // du personnage. Son APPLICATION est en outre réservée au grand écran (le
  // client la conditionne à la taille de l'écran) — la préférence, elle, suit
  // l'utilisateur du PC au téléphone comme toutes les autres.
  interactive?: boolean
  // L'astuce des interactions 3D a-t-elle déjà été montrée ? Écrite UNE FOIS,
  // à la première scène vivante réellement en service, et jamais relue autrement
  // que pour se taire. Clé absente = elle reste à montrer.
  //
  // Ici et non dans le localStorage, pour la raison qui vaut pour tout ce
  // fichier : l'utilisateur est seul sur son serveur, et une astuce lue au
  // bureau n'a pas à se rejouer sur son téléphone. C'est aussi la seule
  // préférence que l'app s'écrit à ELLE-MÊME — l'utilisateur ne la règle nulle
  // part. Pour la revoir : supprimer la clé de data/ui.json.
  hint3dSeen?: boolean
  // Tailles réglées à la poignée (pixels). Clé ABSENTE = taille par défaut de
  // styles.css : l'utilisateur qui n'y touche pas n'a rien dans ui.json, et un
  // double-clic sur la poignée efface la clé (retour au défaut).
  chatPanelWidth?: number // largeur de la colonne de chat (desktop, ≥ 900 px)
  vnBoxWidth?: number // largeur de la boîte de dialogue du mode visual novel
  vnBoxHeight?: number // hauteur de la zone de texte de cette boîte
  sheetHeight?: number // hauteur de la feuille basse de chat (< 900 px)
  activeCharacter?: string // dernier personnage ouvert
  activeChat?: Record<string, string> // dernière conversation ouverte, par personnage
  // Cadrage caméra choisi, par personnage ET par mode d'affichage : clé composée
  // « <charId>::desktop » ou « <charId>::vn » (une clé nue est un reliquat d'avant
  // la séparation par mode — lue en repli côté client, cf. prefs.ts).
  views?: Record<string, StageView>
}

/** Corps du PUT /api/ui : merge superficiel — clé absente = inchangée, `null` = supprimée. */
export type UiPrefsPatch = { [K in keyof UiPrefs]?: UiPrefs[K] | null }

// ── Analyse des décors 3D (`<décor>.scene.json`) ───────────────────────────
// Produite UNE FOIS à l'import par le serveur (server/lib/envScene.ts), posée à
// côté du .glb, et lue par le moteur de scène du client. C'est LE contrat de
// l'interaction : le moteur n'a jamais à retoucher la géométrie, tout ce dont il
// a besoin est ici.
//
// Repère : celui de la scène, une fois le décor placé (échelle, rotation et
// calage au sol du sidecar appliqués). Origine aux PIEDS de l'avatar (y = 0),
// Y vers le haut, mètres, l'avatar regardant +Z. Autrement dit, ces coordonnées
// se posent telles quelles dans la scène three.js.

/** Une surface sur laquelle un personnage peut s'asseoir. Aucun filtrage par modèle : c'est l'IK qui adapte. */
export interface SceneSeat {
  id: string
  /** Altitude RÉELLE de l'assise (m). Un lit à 0,51 m et une marche à 0,20 m sont également valables. */
  y: number
  /** Centre de la nappe, [x, z]. */
  center: [number, number]
  /** Emprise [xMin, zMin, xMax, zMax]. */
  bounds: [number, number, number, number]
  /** Aire de la nappe (m²). */
  area: number
  /** Espace libre au-dessus de la nappe (m, médiane) : de quoi savoir si un buste, voire un corps debout, y tient. */
  headroom: number
  /**
   * Direction du regard, en DEGRÉS : direction = [sin(yaw), 0, cos(yaw)].
   * Se pose telle quelle dans `object.rotation.y` (convertie en radians), la
   * convention de three pour un objet qui regarde +Z au repos.
   */
  yaw: number
  /** `true` si le cap vient d'un dossier ou d'un mur ; `false` s'il vient de l'ouverture de la pièce. */
  back: boolean
  /** Case praticable d'où venir s'asseoir, [x, z] — `null` si l'assise n'est pas accessible à pied. */
  approach: [number, number] | null
}

export interface SceneFile {
  format: 'hanami-scene'
  version: number
  generated: string
  /** Fraîcheur : si l'un de ces champs ne colle plus au .glb, l'analyse est refaite. */
  source: { file: string; bytes: number; mtimeMs: number; sha256: string }
  /** Placement effectivement appliqué (recopié du sidecar) + empreinte de ce qui déplace la géométrie. */
  placement: {
    scale: number | null
    rotationY: number | null
    spawn: [number, number, number] | null
    /**
     * Point d'accueil CALCULÉ par l'analyse, à appliquer exactement comme un
     * `spawn` de sidecar — et déjà appliqué dans TOUTES les mesures de ce
     * fichier (carte, assises, rose, sol). Le client suit l'ordre
     * sidecar > `spawnAuto` > origine du modèle.
     *
     * La clé n'existe que si l'analyse a eu à se prononcer, c'est-à-dire si le
     * sidecar ne donnait pas de `spawn` ET que l'origine du modèle était
     * inhabitable (sol ailleurs, objectif bouché, pièce à côté). `null` = elle
     * s'est prononcée et n'a trouvé nulle part où poser quelqu'un.
     */
    spawnAuto?: [number, number, number] | null
    fingerprint: string
  }
  frame: { units: 'm'; up: '+Y'; forward: '+Z'; origin: string }
  /** Gabarit sous lequel l'analyse a été faite (m) — la carte en dépend. */
  body: { height: number; radius: number; step: number; seatRange: [number, number] }
  room: {
    /** Boîte brute du modèle placé [xMin, yMin, zMin, xMax, yMax, zMax] — peut déborder très loin de la pièce. */
    modelBounds: [number, number, number, number, number, number]
    /** Boîte de la zone atteignable à pied [xMin, zMin, xMax, zMax] — LA pièce. */
    walkBounds: [number, number, number, number]
    /** Surface atteignable à pied (m²). */
    walkArea: number
    /** Altitude du sol de la pièce (m) — l'étalon des hauteurs d'assise. Vaut ≈ 0 quand le sidecar est bien réglé. */
    ground: number
    /** Hauteur sous plafond (m), ou `null` si le décor est ouvert par le haut. */
    ceiling: number | null
  }
  /** Distance libre depuis l'origine, à hauteur d'objectif, dans 16 directions (0 = +Z, sens trigo inverse). */
  camera: { eye: number; clearance: number[] }
  grid: {
    /** Côté d'une cellule (m). */
    cell: number
    /** Coin minimal de la cellule (0, 0) : [x, z]. Centre de (i, j) = origin + ((i|j) + 0,5) × cell. */
    origin: [number, number]
    cols: number
    rows: number
    /** Altitudes des niveaux de sol (m), croissantes. Le caractère d'une case y renvoie. */
    levels: number[]
    legend: Record<string, string>
    /** Une chaîne par rangée : `map[j][i]`, rangée j = z croissant, colonne i = x croissant. */
    map: string[]
  }
  seats: SceneSeat[]
}

/**
 * État de l'analyse d'un décor, exposé par `GET /api/environments`.
 * `ready` = interaction possible · `pending`/`analyzing` = en préparation ·
 * `failed`/`unsupported` = le décor reste utilisable comme simple fond.
 */
export type SceneState = 'ready' | 'pending' | 'analyzing' | 'failed' | 'unsupported'

export interface EnvironmentEntry {
  /** URL du modèle, la même que dans `environments`. */
  url: string
  name: string
  state: SceneState
  /** URL du `.scene.json` quand il est prêt. */
  scene: string | null
  /** Motif d'échec, à afficher tel quel. */
  reason?: string
  /** Résumé disponible dès que l'analyse est prête. */
  seats?: number
  walkArea?: number
}
