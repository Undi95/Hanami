// Hanami — composant racine : boot, scène VRM, chat streaming, dialogs.
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CharacterFull,
  CharacterMeta,
  ChatMessage,
  ChatMeta,
  ContextInfo,
  Settings,
} from '../../shared/types'
import type { FrameMode, VrmStage } from './scene/types'
import { substituteMacros, userName, type MacroNames } from '../../shared/macros'
import * as api from './api'
import { detectEmotionFallback, extractEmotion, stripEmotionTags } from './emotions'
import { disposeNotify, playNotify } from './sound'
import {
  applyTheme,
  normalizeTheme,
  resolveTheme,
  saveTheme,
  savedCustom,
  savedTheme,
  themeCode,
  type AppTheme,
} from './themes'
import {
  forgetCharacter,
  getActiveChat,
  getPref,
  getPrefs,
  getSavedView,
  loadServerPrefs,
  setActiveChat,
  setPref,
  setSavedView,
  subscribePrefs,
  type ViewMode,
} from './prefs'
import { chatPanelWidth, healLayoutPrefs, saveChatPanelWidth, saveVnBoxWidth, saveVnTextHeight } from './layout'
import { I18nProvider, chatDisplayTitle, getLang, localeOf, useI18n } from './i18n'
import TopBar, { AUTO_COMPACT_AT, CtxBadge, type DialogKind } from './components/TopBar'
import { ChatPanelGrip } from './components/ResizeGrips'
import MessageList, { VnBox, type FeedItem } from './components/MessageList'
import Composer from './components/Composer'
import LoginGate from './components/LoginGate'
import Dialog from './components/Dialog'
import SettingsDialog from './components/SettingsDialog'
import CharactersDialog from './components/CharactersDialog'
import ChatsDialog from './components/ChatsDialog'
import ImportDialog from './components/ImportDialog'
import MemoryDialog from './components/MemoryDialog'
import PromptInspector from './components/PromptInspector'

// Personnage/conversation actifs, mode visual novel, cadrages caméra : toutes
// ces préférences vivent côté serveur (data/ui.json) via prefs.ts — l'utilisateur
// retrouve son écran à l'identique en passant du PC au téléphone.

// Citation d'un message : longueur de l'aperçu (bandeau) et de l'extrait envoyé.
const QUOTE_PREVIEW_MAX = 80
const QUOTE_MAX = 200
// Chargement du modèle VRM : délais avant nouvelle tentative. Un serveur qui
// redémarre coupe la requête sans que rien ne soit cassé — inutile d'annoncer
// une erreur au premier échec.
const VRM_RETRY_DELAYS_MS: readonly number[] = [1000, 3000]
// Seuil du « grand écran », repris à l'identique de styles.css (@media 900px) :
// au-delà, le chat est une colonne à droite et la scène a de la place ; en
// dessous, c'est une feuille basse et il ne reste qu'un bandeau. La scène vivante
// (déplacement dans le décor) est réservée à ce cas-là — décision du propriétaire.
const WIDE_SCREEN_QUERY = '(min-width: 900px)'
// Astuce des interactions 3D : durée de vie totale à l'écran, fondus compris.
// DOIT rester la durée de l'animation `scene-hint` de styles.css (8,5 s), au
// tour de roue près — c'est le CSS qui fait le fondu, ce délai ne fait que
// retirer du DOM une ligne déjà transparente.
const HINT_3D_MS = 8600

/** Extrait d'un message à citer : une seule ligne, tags d'émotion retirés, tronquée. */
function excerpt(text: string, max: number): string {
  const flat = stripEmotionTags(text).replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat
}

/** Noms des macros pour ce personnage — {{user}} suit la persona, sinon « User ». */
function macroNamesOf(char: CharacterFull, personaName: string): MacroNames {
  return { char: char.name, user: userName(personaName) }
}

/**
 * Messages d'accueil écrits du personnage : le principal puis ses variantes,
 * vides retirés — et macros résolues, car un accueil de card commence neuf fois
 * sur dix par « Hello {{user}}! ». La substitution est faite ICI, à l'affichage :
 * character.json garde ses macros (renommer le personnage suffit à les suivre).
 */
function greetingPool(char: CharacterFull, personaName: string): string[] {
  const variants = Array.isArray(char.greetings) ? char.greetings : []
  const names = macroNamesOf(char, personaName)
  return [char.greeting, ...variants]
    .filter((g) => typeof g === 'string' && g.trim().length > 0)
    .map((g) => substituteMacros(g, names))
}

/** Tirage d'un accueil : chaque nouvelle conversation peut s'ouvrir autrement. */
function pickGreeting(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)]
}

/**
 * Cadrage par défaut de l'avatar selon le mode d'affichage : en visual novel la
 * scène est plein écran (avatar centré) ; en desktop le panneau de chat occupe la
 * droite, l'avatar est décalé pour rester entier dans la partie visible.
 */
function frameModeOf(mode: ViewMode): FrameMode {
  return mode === 'vn' ? 'centered' : 'left'
}

function AppInner() {
  const { lang, setLang, t } = useI18n()
  const [booting, setBooting] = useState(true)
  const [needLogin, setNeedLogin] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [characters, setCharacters] = useState<CharacterMeta[]>([])
  const [character, setCharacter] = useState<CharacterFull | null>(null)
  const [chatMeta, setChatMeta] = useState<ChatMeta | null>(null)
  const [feed, setFeed] = useState<FeedItem[]>([])
  // Message visé par le prochain envoi : sa citation sera écrite dans le message.
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [dialog, setDialog] = useState<DialogKind | null>(null)
  // Loupe de la TopBar : un compteur, incrémenté à chaque clic, que MessageList
  // observe pour ouvrir (ou refermer) sa barre de recherche. Le Ctrl+F, lui, reste
  // entièrement géré dans MessageList.
  const [searchSignal, setSearchSignal] = useState(0)
  // Même mécanique pour la flèche haut d'un composer vide : le compteur monte,
  // le fil rouvre le dernier message de l'utilisateur en édition.
  const [editLastSignal, setEditLastSignal] = useState(0)
  const [backendDown, setBackendDown] = useState(false)
  // Le modèle configuré lit-il les images ? (réglage « Images (vision) » : forcé,
  // jamais, ou détecté auprès du backend). Faux = le composer ne propose rien.
  const [visionEnabled, setVisionEnabled] = useState(false)
  const [context, setContext] = useState<ContextInfo | null>(null)
  const [compacting, setCompacting] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [vnMode, setVnMode] = useState(() => getPref('vnMode') === true)
  // Décor 3D : allumé par défaut (clé absente = allumé), éteint explicitement.
  const [env3d, setEnv3d] = useState(() => getPref('env3d') !== false)
  // Animations gestuelles (.vrma) : même grammaire que le décor.
  const [vrmaEnabled, setVrmaEnabled] = useState(() => getPref('vrmaEnabled') !== false)
  // Scène vivante : OPT-IN STRICT (`=== true`), contrairement aux deux au-dessus.
  const [interactive, setInteractive] = useState(() => getPref('interactive') === true)
  // L'astuce des interactions 3D est-elle à l'écran ? Vraie au plus une fois par
  // installation (cf. l'effet qui la pose, et la préférence hint3dSeen).
  const [hint3d, setHint3d] = useState(false)
  // Grand écran ? C'est la MÊME borne que le CSS (styles.css, @media 900px), celle
  // qui décide si le chat est une colonne ou une feuille basse. Décision du
  // propriétaire : pas d'interaction 3D sur mobile — l'interrupteur reste visible
  // mais grisé, et la préférence n'est pas touchée (elle suit l'utilisateur).
  const [wideScreen, setWideScreen] = useState(() => window.matchMedia(WIDE_SCREEN_QUERY).matches)
  // Largeur de la colonne de chat (poignée de redimensionnement). L'affichage,
  // lui, ne passe pas par ici : layout.ts pose la variable CSS. Cet état ne sert
  // qu'à tenir la scène 3D au courant (cadrage 'left').
  const [chatWidth, setChatWidth] = useState(chatPanelWidth)
  const [stageReady, setStageReady] = useState(false)
  const [vrmError, setVrmError] = useState<string | null>(null)
  // Décor 3D : erreur de chargement et pastille d'attente. Un décor pèse
  // plusieurs mégaoctets — son état est SÉPARÉ de celui du modèle, un décor
  // introuvable ne doit pas faire croire à un avatar cassé.
  const [envError, setEnvError] = useState<string | null>(null)
  const [envLoading, setEnvLoading] = useState(false)
  // Thème de l'app (préférence serveur, comme la langue) — le thème propre au
  // personnage actif, s'il existe, prend le dessus.
  const [appTheme, setAppTheme] = useState<AppTheme>(savedTheme)
  // Compteur bumpé quand les COULEURS du thème perso changent (elles ne sont pas
  // dans appTheme) : relance l'effet qui applique le thème.
  const [customVersion, setCustomVersion] = useState(0)
  // Mode d'accueil « demander » : question posée une seule fois par ouverture de
  // chat vide (le personnage et le chat visés sont figés dans l'état).
  const [greetingAsk, setGreetingAsk] = useState<{ char: CharacterFull; chat: ChatMeta } | null>(null)
  // Message dont la voix est en cours de lecture, désigné par son `ts` : l'icône
  // haut-parleur de CETTE bulle devient un carré « stop ». null = silence — et
  // c'est stopTts (ou la fin naturelle de l'audio) qui l'y ramène.
  const [ttsPlaying, setTtsPlaying] = useState<string | null>(null)

  const sceneRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<VrmStage | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const lastEmotionRef = useRef('neutral')
  // Fenêtre parlante relancée à chaque delta de TEXTE (le raisonnement et les
  // outils ne font pas bouger les lèvres) + audio TTS en cours de lecture.
  const speakTimerRef = useRef<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // Compteur de génération : invalide les chargements perso/chat dépassés par un
  // choix plus récent (évite qu'une réponse lente écrase la sélection courante).
  const loadGenRef = useRef(0)
  const compactingRef = useRef(false)
  // Une seule génération du premier message à la fois (openChat peut être rappelé
  // pendant qu'elle stream : sélection rapide, fermeture/réouverture d'un dialog).
  const openingRef = useRef(false)
  // Chat réellement affiché (les setFeed d'une compaction lente ne doivent pas
  // atterrir dans un autre chat ouvert entre-temps).
  const chatIdRef = useRef<string | null>(null)
  // Couple perso/chat dont l'estimation de contexte a déjà été demandée : UN seul
  // appel par activation de chat (jamais de polling, même si l'app re-rend).
  // Remis à null par openChat, en même temps que la jauge.
  const ctxEstimatedRef = useRef<string | null>(null)
  // Chats dont l'auto-compaction a échoué : pas de nouvel essai automatique
  // (sinon un backend strict serait re-sollicité à chaque message).
  const autoCompactFailedRef = useRef<Set<string>>(new Set())
  // Personnage courant pour le callback de cadrage (posé une fois à la création
  // de la scène, qui vit plus longtemps que chaque personnage).
  const characterIdRef = useRef<string | null>(null)
  // Nom de la persona, en REF : les salutations sont posées par openChat, qui
  // est aussi appelé depuis le boot — une fermeture figée au premier rendu, où
  // l'état `settings` est encore null. La ref, elle, dit la vérité du moment.
  const personaNameRef = useRef('')
  // Idem pour le mode d'affichage : le callback du stage ne doit jamais lire un
  // vnMode capturé au rendu qui l'a posé — il choisirait la mauvaise clé de vue.
  const viewModeRef = useRef<ViewMode>(getPref('vnMode') === true ? 'vn' : 'desktop')
  // Dernières couleurs perso appliquées — sert à ne bumper customVersion que
  // sur un vrai changement (les notifications de prefs sont fréquentes).
  const customCodeRef = useRef<string>(themeCode(savedCustom()))

  // ── Helpers ──────────────────────────────────────────────────────────────

  const handleError = useCallback((e: unknown, tag: string) => {
    if (e instanceof api.AuthRequiredError) setNeedLogin(true)
    else console.error(`[${tag}]`, e)
  }, [])

  /** Locuteur d'un message, tel qu'il apparaît dans la citation et le bandeau. */
  function speakerOf(msg: ChatMessage): string {
    return msg.role === 'user' ? t('vnYou') : (character?.name ?? 'Hanami')
  }

  /**
   * Émotion appliquée à l'avatar. `live` : elle vient DE SE PRODUIRE (tag reçu
   * dans le flux, réponse terminée, message d'accueil affiché) — la scène peut
   * alors jouer un geste. Toutes les autres applications sont des RESTAURATIONS
   * (conversation ouverte, retour d'onglet, modèle rechargé) : le visage suit,
   * le corps ne mime rien.
   */
  function applyEmotion(emotion: string, live = false) {
    lastEmotionRef.current = emotion
    stageRef.current?.setEmotion(emotion, live)
  }

  function probeBackend() {
    api
      .getModels()
      .then(() => setBackendDown(false))
      .catch(() => setBackendDown(true))
  }

  // Jamais attendu : en mode 'auto' la détection interroge le backend (jusqu'à
  // 4 s) — le boot ne patiente pas, le trombone apparaît dès la réponse.
  function probeVision() {
    api
      .getVision()
      .then(setVisionEnabled)
      .catch(() => setVisionEnabled(false))
  }

  /**
   * Jauge de contexte posée depuis l'ESTIMATION du serveur : /api/prompt-preview
   * assemble le payload du PROCHAIN envoi (même buildPayload que /api/chat) et en
   * renvoie le volume estimé — sans rien générer.
   * `soft` : l'estimation ne s'écrit que si la jauge est encore vide, car un usage
   * RÉEL arrivé pendant l'appel (fin de stream) est plus juste et doit rester.
   * Échec silencieux : la jauge se resynchronisera au prochain message.
   * Le chat a pu changer pendant l'appel → chatIdRef arbitre, comme ailleurs.
   */
  const estimateContext = useCallback(async (charId: string, chatId: string, soft = false) => {
    try {
      const p = await api.getPromptPreview(charId, chatId)
      if (chatIdRef.current !== chatId || p.contextSize <= 0) return
      const info: ContextInfo = {
        tokens: p.tokens,
        limit: p.contextSize,
        percent: Math.min(100, Math.round((p.tokens / p.contextSize) * 100)),
      }
      setContext((c) => (soft && c ? c : info))
    } catch {
      /* la jauge se resynchronisera au prochain message */
    }
  }, [])

  // ── Lèvres & voix ────────────────────────────────────────────────────────

  // Un delta de texte vient d'arriver : la bouche reste animée le temps de
  // « prononcer » ce qui vient de s'afficher (~35 ms/caractère, plancher 600 ms,
  // plafond 4 s d'avance) — sinon une réponse arrivée en une rafale ne ferait
  // bouger les lèvres qu'un clignement. Rien ne bouge pendant le thinking.
  const speakUntilRef = useRef(0)

  function pokeSpeaking(chars = 0) {
    const now = performance.now()
    const base = Math.max(speakUntilRef.current, now + 600)
    speakUntilRef.current = Math.min(base + chars * 35, now + 4000)
    stageRef.current?.setSpeaking(true)
    if (speakTimerRef.current !== null) window.clearTimeout(speakTimerRef.current)
    speakTimerRef.current = window.setTimeout(() => {
      speakTimerRef.current = null
      stageRef.current?.setSpeaking(false)
    }, speakUntilRef.current - now)
  }

  function stopSpeaking() {
    speakUntilRef.current = 0
    if (speakTimerRef.current !== null) {
      window.clearTimeout(speakTimerRef.current)
      speakTimerRef.current = null
    }
    stageRef.current?.setSpeaking(false)
  }

  function stopTts() {
    setTtsPlaying(null)
    const audio = audioRef.current
    if (!audio) return
    audioRef.current = null
    audio.pause()
    if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src)
    stageRef.current?.setSpeaking(false)
  }

  // ── Compaction ───────────────────────────────────────────────────────────
  // Le fil affiché ne change JAMAIS : la compaction n'agit que sur le payload
  // envoyé au modèle (résumé côté serveur). Ici : pastille discrète pendant le
  // travail, ligne d'info éphémère à la fin. En mode silencieux (auto), l'échec
  // se note et se tait ; sinon il remonte à l'appelant (l'inspecteur l'affiche).
  async function compact(charId: string, chatId: string, instruction = '', silent = false): Promise<void> {
    if (compactingRef.current) return
    compactingRef.current = true
    setCompacting(true)
    try {
      const out = await api.compactChat(charId, chatId, instruction)
      autoCompactFailedRef.current.delete(chatId)
      setChatMeta((m) =>
        m && m.id === chatId ? { ...m, summary: out.summary, summaryUpto: out.summaryUpto } : m,
      )
      if (chatIdRef.current === chatId) {
        setFeed((f) => [...f, { kind: 'info', text: t('compactDone', { n: out.compacted }) }])
      }
      // Rafraîchit la jauge — sinon le badge resterait au rouge (≥ 80 %)
      // jusqu'au prochain message alors que le contexte vient d'être libéré.
      // Pas `soft` ici : c'est justement la valeur en place qui est périmée.
      await estimateContext(charId, chatId)
    } catch (e) {
      if (e instanceof api.AuthRequiredError) {
        setNeedLogin(true)
        return
      }
      if (silent) {
        // 409 = « déjà en cours » (autre appareil, double déclenchement) :
        // occupé n'est pas cassé — marquer le chat couperait l'auto-compaction
        // pour toute la session sur une simple collision.
        if (!(e instanceof api.ApiError && e.status === 409)) {
          autoCompactFailedRef.current.add(chatId)
        }
        console.warn('[compact]', e)
        return
      }
      throw e
    } finally {
      compactingRef.current = false
      setCompacting(false)
    }
  }

  /**
   * Lit une réplique à voix haute. `key` = le `ts` du message lu : il désigne la
   * bulle dont l'icône doit devenir un carré « stop », et il se nettoie tout
   * seul quand la lecture s'achève (ou échoue). Sans clé, la voix parle mais
   * aucune bulle ne s'annonce parlante.
   */
  async function playTts(text: string, key?: string) {
    const clean = stripEmotionTags(text).trim()
    if (!clean) return
    const blob = await api.tts(clean)
    stopTts()
    // Le timer des lèvres « texte » ne doit pas refermer la bouche en pleine
    // lecture audio : l'audio pilote seul à partir d'ici.
    speakUntilRef.current = 0
    if (speakTimerRef.current !== null) {
      window.clearTimeout(speakTimerRef.current)
      speakTimerRef.current = null
    }
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audioRef.current = audio
    audio.onplay = () => stageRef.current?.setSpeaking(true)
    const end = () => {
      if (audioRef.current === audio) {
        audioRef.current = null
        setTtsPlaying(null)
        stageRef.current?.setSpeaking(false)
      }
      URL.revokeObjectURL(url)
    }
    audio.onended = end
    audio.onerror = end
    setTtsPlaying(key ?? null)
    try {
      await audio.play()
    } catch (e) {
      // Lecture refusée (autoplay bloqué, format illisible) : aucune bulle ne
      // doit rester en « stop » — l'erreur, elle, remonte à l'appelant.
      end()
      throw e
    }
  }

  // ── Scène 3D (import lazy, contrat scene/types.ts) ───────────────────────

  /**
   * Pose le cadrage du mode d'affichage courant : la vue que l'utilisateur avait
   * choisie DANS CE MODE, ou à défaut le cadrage par défaut du mode (resetView).
   * Sans effet visible si aucun modèle n'est chargé (resetView se tait).
   */
  const applyViewFor = useCallback((stage: VrmStage, charId: string) => {
    const mode = viewModeRef.current
    stage.setFrameMode(frameModeOf(mode))
    const view = getSavedView(charId, mode)
    if (view) stage.setView(view)
    else stage.resetView()
  }, [])

  useEffect(() => {
    let cancelled = false
    setVrmError(null)
    ;(async () => {
      const { createVrmStage } = await import('./scene/vrmStage')
      if (cancelled || !sceneRef.current) return
      stageRef.current = createVrmStage(sceneRef.current)
      // Cadrage modifié à la main → persisté par personnage ET par mode
      // d'affichage ; reset (double-clic ou bouton) → view null, donc oubli.
      stageRef.current.onViewChange((view) => {
        const id = characterIdRef.current
        if (!id) return
        setSavedView(id, viewModeRef.current, view)
      })
      setStageReady(true)
    })().catch((e) => {
      console.error('[vrm]', e)
      if (!cancelled) setVrmError(api.errorMessage(e))
    })
    return () => {
      cancelled = true
      stopTts()
      disposeNotify()
      if (speakTimerRef.current !== null) window.clearTimeout(speakTimerRef.current)
      stageRef.current?.dispose()
      stageRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // La largeur de la colonne de chat pilote le décalage du cadrage 'left' : la
  // scène doit la connaître. Déclaré AVANT l'effet de chargement du modèle, pour
  // que le tout premier cadrage la connaisse déjà. Rien ne bouge à l'écran ici —
  // le recadrage attend le prochain reset ou la prochaine bascule de mode
  // (comme pour un redimensionnement de fenêtre, qui ne recadre pas non plus).
  useEffect(() => {
    stageRef.current?.setPanelWidth(chatWidth)
  }, [chatWidth, stageReady])

  // Animations gestuelles : la scène démarre allumée (c'est le défaut), donc cet
  // effet ne fait quelque chose qu'à l'extinction — et à chaque bascule ensuite.
  // Éteindre DÉCHARGE le mixer, ça ne le met pas en pause.
  useEffect(() => {
    stageRef.current?.setAnimationsEnabled(vrmaEnabled)
  }, [vrmaEnabled, stageReady])

  // Taille d'écran : la scène vivante s'éteint et se rallume au redimensionnement
  // DANS LES DEUX SENS, sans jamais toucher à la préférence — brancher un
  // téléphone sur un écran ne doit pas effacer un réglage fait au bureau.
  useEffect(() => {
    const mq = window.matchMedia(WIDE_SCREEN_QUERY)
    const onChange = () => setWideScreen(mq.matches)
    mq.addEventListener('change', onChange)
    onChange()
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Scène vivante : la préférence ET la place à l'écran. Les animations
  // gestuelles en sont le socle (sans .vrma, aucun clip de marche) — les couper
  // coupe donc aussi la scène vivante, sans rien effacer.
  const sceneLive = interactive && wideScreen && vrmaEnabled
  useEffect(() => {
    stageRef.current?.setInteractive(sceneLive)
  }, [sceneLive, stageReady])

  // Astuce des interactions 3D — la seule chose qui dise qu'on peut cliquer la
  // pièce. Montrée UNE FOIS par installation, jamais redemandée, jamais
  // réglable : c'est un apprentissage, pas une option.
  //
  // Elle attend que la scène vivante soit RÉELLEMENT en service — préférence,
  // grand écran, animations — ET qu'il y ait une pièce autour du personnage.
  // Sans décor 3D, il n'y a ni sol ni siège à cliquer : l'astuce mentirait, et
  // elle serait brûlée pour de bon.
  //
  // Ordre de lecture des préférences : `interactive` ne peut devenir vrai que
  // par le même instantané (cache local ou serveur) qui porte `hint3dSeen` —
  // c'est ce qui garantit qu'un serveur qui a déjà vu l'astuce ne la rejoue pas
  // pendant le vol du GET /api/ui.
  useEffect(() => {
    if (!sceneLive || !stageReady || vrmError) return
    if (!character?.vrm || !character.environment || !env3d) return
    if (getPref('hint3dSeen') === true) return
    // Écrite DÈS L'AFFICHAGE et non à la fin : « ne revient jamais » doit tenir
    // même si l'onglet est fermé pendant les huit secondes.
    setPref({ hint3dSeen: true })
    setHint3d(true)
    const timer = window.setTimeout(() => setHint3d(false), HINT_3D_MS)
    return () => window.clearTimeout(timer)
  }, [sceneLive, stageReady, vrmError, character?.vrm, character?.environment, env3d])

  // Changement de personnage (ou scène prête) → charger son modèle VRM, puis
  // réappliquer le cadrage caméra choisi pour lui DANS LE MODE courant.
  // Un échec (serveur en train de redémarrer) est réessayé deux fois en silence
  // avant d'afficher l'erreur : ni bouton, ni message intermédiaire.
  useEffect(() => {
    characterIdRef.current = character?.id ?? null
    const stage = stageRef.current
    if (!stage || !stageReady) return
    setVrmError(null)
    const charId = character?.id ?? null
    const vrm = character?.vrm ?? ''
    // Le cadrage automatique de fin de chargement doit déjà connaître le mode.
    stage.setFrameMode(frameModeOf(viewModeRef.current))
    let cancelled = false
    let retryTimer: number | null = null
    const attempt = (retry: number) => {
      stage
        .loadModel(vrm)
        .then(() => {
          if (cancelled || !charId || characterIdRef.current !== charId) return
          applyViewFor(stage, charId)
        })
        .catch((e) => {
          // Personnage changé (ou effet rejoué) entre-temps : ce chargement ne
          // concerne plus personne, ni erreur ni nouvelle tentative.
          if (cancelled || characterIdRef.current !== charId) return
          console.error('[vrm]', e)
          if (retry >= VRM_RETRY_DELAYS_MS.length) {
            setVrmError(api.errorMessage(e))
            return
          }
          retryTimer = window.setTimeout(() => {
            retryTimer = null
            attempt(retry + 1)
          }, VRM_RETRY_DELAYS_MS[retry])
        })
    }
    attempt(0)
    stage.setEmotion(lastEmotionRef.current)
    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
    }
  }, [stageReady, character?.vrm, character?.id, applyViewFor])

  // Décor 3D du personnage → chargé dans la scène, autour de l'avatar. Effet
  // SÉPARÉ de celui du modèle : un décor de plusieurs mégaoctets n'a aucune raison
  // d'être rechargé parce que le modèle change, et l'inverse non plus.
  // Rien n'est chargé sans modèle VRM (`character.vrm` vide) : un portrait 2D
  // flottant devant une pièce en 3D n'aurait aucun sens.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !stageReady) return
    const url = env3d && character?.vrm ? (character.environment ?? '') : ''
    setEnvError(null)
    setEnvLoading(url !== '')
    let cancelled = false
    stage
      .loadEnvironment(url)
      .then(() => {
        if (!cancelled) setEnvLoading(false)
      })
      .catch((e) => {
        // Personnage changé (ou effet rejoué) entre-temps : ce chargement ne
        // concerne plus personne.
        if (cancelled) return
        console.error('[env]', e)
        setEnvLoading(false)
        setEnvError(api.errorMessage(e))
      })
    return () => {
      cancelled = true
    }
  }, [stageReady, character?.environment, character?.vrm, env3d])

  // Bascule desktop ↔ VN : la place laissée à la scène change du tout au tout, le
  // cadrage du nouveau mode s'applique donc immédiatement (sa vue sauvegardée,
  // sinon le cadrage par défaut du mode).
  useEffect(() => {
    const mode: ViewMode = vnMode ? 'vn' : 'desktop'
    if (viewModeRef.current === mode) return // rien n'a basculé (premier rendu inclus)
    viewModeRef.current = mode
    const stage = stageRef.current
    const charId = character?.id ?? null
    // Scène pas encore prête : la ref est à jour, le chargement du modèle
    // appliquera le bon cadrage de lui-même.
    if (!stage || !stageReady || !charId) return
    applyViewFor(stage, charId)
  }, [vnMode, stageReady, character?.id, applyViewFor])

  // ── Chargement personnage / chat ─────────────────────────────────────────

  // Titre par défaut d'une conversation créée côté client (le serveur ne connaît
  // pas la langue de l'interface).
  function defaultChatTitle(): string {
    return t('defaultChatTitle', { date: new Date().toLocaleDateString(localeOf(lang)) })
  }

  // Ouverture de la conversation par le modèle (mode 'open'). char/chat sont
  // passés explicitement : les états React viennent d'être posés. abortRef (et
  // non l'état `streaming`) : openChat capture ses états au rendu qui l'a créé —
  // la ref, elle, dit la vérité du moment. Si l'appel échoue, le fil reste vide
  // et l'utilisateur parlera en premier.
  function startOpening(char: CharacterFull, chat: ChatMeta) {
    if (openingRef.current || abortRef.current !== null) return
    openingRef.current = true
    runGeneration({ mode: 'open', char, chat })
      .catch((e) => console.error('[open]', e))
      .finally(() => {
        openingRef.current = false
      })
  }

  // Réponses à la question « comment ouvrir cette conversation ? » (mode 'ask').
  // Le chat a pu changer pendant que la question était posée : on vérifie.
  function chooseWrittenGreeting(ask: { char: CharacterFull; chat: ChatMeta }) {
    setGreetingAsk(null)
    if (chatIdRef.current !== ask.chat.id || feed.length > 0) return
    const pool = greetingPool(ask.char, personaNameRef.current)
    if (pool.length === 0) return
    const text = pickGreeting(pool)
    setFeed([{ kind: 'greeting', text }])
    applyEmotion(extractEmotion(text) ?? 'neutral', true)
  }

  function chooseGeneratedGreeting(ask: { char: CharacterFull; chat: ChatMeta }) {
    setGreetingAsk(null)
    if (chatIdRef.current !== ask.chat.id) return
    startOpening(ask.char, ask.chat)
  }

  async function openChat(char: CharacterFull, chatId: string) {
    const gen = ++loadGenRef.current
    abortRef.current?.abort()
    setGreetingAsk(null) // une question restée ouverte ne survit pas au changement de chat
    try {
      const { meta, messages } = await api.getChat(char.id, chatId)
      if (gen !== loadGenRef.current) return
      setChatMeta(meta)
      chatIdRef.current = meta.id
      setReplyTo(null) // la cible d'une réponse n'existe plus dans ce fil
      // La jauge de ce chat repart d'une estimation, demandée par l'effet dédié
      // (et écrasée plus tard par l'usage réel de fin de stream).
      setContext(null)
      ctxEstimatedRef.current = null
      setActiveChat(char.id, meta.id)
      const items: FeedItem[] = messages.map((m) => ({ kind: 'msg', msg: m }))
      // Premier message d'un chat VIDE (jamais sur un chat importé — il n'est pas
      // vide), selon le mode du personnage : 'written' (défaut) affiche une
      // salutation écrite tirée au hasard, 'generated' laisse le modèle ouvrir,
      // 'ask' pose la question. Sans aucun texte écrit, on génère dans tous les cas.
      const empty = messages.length === 0
      const mode = char.greetingMode ?? 'written'
      const pool = empty ? greetingPool(char, personaNameRef.current) : []
      const ask = empty && mode === 'ask' && pool.length > 0
      const opening = empty && !ask && mode !== 'generated' && pool.length > 0 ? pickGreeting(pool) : null
      if (opening) items.push({ kind: 'greeting', text: opening })
      setFeed(items)
      // Émotion d'ouverture : celle du greeting réellement affiché, sinon celle
      // du dernier message assistant.
      let emotion: string | null = null
      if (opening) emotion = extractEmotion(opening)
      else if (!empty) {
        const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
        if (lastAssistant) emotion = lastAssistant.emotion ?? extractEmotion(lastAssistant.content)
      }
      // `live` uniquement si une salutation vient d'être AFFICHÉE : rouvrir une
      // conversation existante restaure une émotion, elle ne la produit pas.
      applyEmotion(emotion ?? 'neutral', opening !== null)
      if (ask) {
        setGreetingAsk({ char, chat: meta })
        return
      }
      if (empty && !opening) startOpening(char, meta)
    } catch (e) {
      handleError(e, 'chat')
    }
  }

  async function selectCharacter(id: string) {
    const gen = ++loadGenRef.current
    try {
      const full = await api.getCharacter(id)
      if (gen !== loadGenRef.current) return
      setCharacter(full)
      setPref({ activeCharacter: id })
      const chats = await api.listChats(id)
      if (gen !== loadGenRef.current) return
      const savedChat = getActiveChat(id)
      let meta = chats.find((c) => c.id === savedChat) ?? chats[0]
      if (!meta) {
        meta = await api.createChat(id, defaultChatTitle())
        if (gen !== loadGenRef.current) return
      }
      await openChat(full, meta.id)
    } catch (e) {
      handleError(e, 'character')
    }
  }

  const boot = useCallback(async () => {
    setBooting(true)
    setNeedLogin(false)
    try {
      const loaded = await api.getSettings()
      setSettings(loaded)
      personaNameRef.current = loaded.personaName ?? ''
      // Auth acquise (getSettings est passé) : les préférences du serveur font
      // foi et remplacent le cache — l'abonnement ci-dessous applique langue,
      // thème et mode VN si elles diffèrent, la sélection est lue juste après.
      await loadServerPrefs()
      // Une taille de panneau hors bornes est reposée à celle qui est réellement
      // appliquée : sans ça, le serveur garde une valeur que l'écran ne montre
      // nulle part (voir healLayoutPrefs).
      healLayoutPrefs()
      const chars = await api.listCharacters()
      setCharacters(chars)
      const saved = getPref('activeCharacter')
      const pick = chars.find((c) => c.id === saved) ?? chars[0]
      if (pick) await selectCharacter(pick.id)
      probeBackend()
      probeVision()
    } catch (e) {
      handleError(e, 'boot')
    } finally {
      setBooting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    boot().catch((e) => console.error('[boot]', e))
  }, [boot])

  // ── Jauge de contexte à l'ouverture ──────────────────────────────────────
  // Un chat vient de devenir actif (boot, changement de conversation ou de
  // personnage) : openChat a remis `context` à null, le badge % n'existerait donc
  // qu'après le premier échange. On demande l'estimation du prochain payload — un
  // appel, à l'activation, et rien de plus. L'usage RÉEL de fin de stream l'écrase
  // ensuite (il est plus juste), et c'est lui SEUL qui peut déclencher
  // l'auto-compaction : le seuil est testé sur l'événement `done`, jamais sur
  // l'état `context` — une estimation ne compacte donc rien.
  // La jauge vide (context === null) est la condition, pas seulement le changement
  // d'identifiants : ré-ouvrir LE MÊME chat la vide aussi, et doit la remplir.
  useEffect(() => {
    const charId = character?.id
    const chatId = chatMeta?.id
    if (!charId || !chatId || context !== null) return
    const key = `${charId}/${chatId}`
    if (ctxEstimatedRef.current === key) return // estimation déjà demandée pour ce chat
    ctxEstimatedRef.current = key
    void estimateContext(charId, chatId, true)
  }, [character?.id, chatMeta?.id, context, estimateContext])

  // ── Préférences venues du serveur ────────────────────────────────────────
  // Un seul abonnement, monté une fois : l'état serveur arrivé au boot (ou une
  // préférence changée ailleurs dans l'app) réaligne langue, thème et mode VN.
  // Lectures via getLang()/setState fonctionnel : aucune valeur périmée dans la
  // fermeture. prefs.ts empêche ces applications de repartir en PUT.
  useEffect(
    () =>
      subscribePrefs(() => {
        const prefs = getPrefs()
        if ((prefs.lang === 'fr' || prefs.lang === 'en') && prefs.lang !== getLang()) setLang(prefs.lang)
        if (typeof prefs.vnMode === 'boolean') setVnMode(prefs.vnMode)
        // Décor 3D et animations : même grammaire que partout ailleurs — seule une
        // valeur BOOLÉENNE explicite écrase l'état, une clé absente reste « allumé ».
        // Sans ces deux lignes, un navigateur dont le cache localStorage ne connaît
        // pas encore la clé téléchargeait la pièce et affichait l'interrupteur coché
        // en contradiction avec data/ui.json, pendant toute la première ouverture.
        if (typeof prefs.env3d === 'boolean') setEnv3d(prefs.env3d)
        if (typeof prefs.vrmaEnabled === 'boolean') setVrmaEnabled(prefs.vrmaEnabled)
        if (typeof prefs.interactive === 'boolean') setInteractive(prefs.interactive)
        setChatWidth(chatPanelWidth())
        if (prefs.theme !== undefined) setAppTheme(normalizeTheme(prefs.theme))
        const code = themeCode(savedCustom())
        if (code !== customCodeRef.current) {
          customCodeRef.current = code
          setCustomVersion((v) => v + 1)
        }
      }),
    [setLang],
  )

  // ── Thème ────────────────────────────────────────────────────────────────

  useEffect(() => {
    applyTheme(resolveTheme(character?.theme, appTheme))
  }, [character?.theme, appTheme, customVersion])

  // ── Rafraîchissement doux ────────────────────────────────────────────────
  // Au retour sur l'onglet : les messages spontanés arrivés pendant l'absence
  // apparaissent sans recharger la page (comparaison du nombre de messages).
  useEffect(() => {
    function onVisible() {
      if (document.hidden) return
      const char = character
      const chat = chatMeta
      if (!char || !chat || streaming || compacting) return
      api
        .getChat(char.id, chat.id)
        .then(({ meta, messages }) => {
          if (chatIdRef.current !== chat.id || meta.messageCount === chat.messageCount) return
          setChatMeta(meta)
          const items: FeedItem[] = messages.map((m) => ({ kind: 'msg', msg: m }))
          // Même accueil que partout ailleurs : macros résolues (cf. greetingPool).
          if (items.length === 0 && char.greeting) {
            const names = macroNamesOf(char, personaNameRef.current)
            items.push({ kind: 'greeting', text: substituteMacros(char.greeting, names) })
          }
          setFeed(items)
          const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
          if (lastAssistant) {
            applyEmotion(lastAssistant.emotion ?? extractEmotion(lastAssistant.content) ?? 'neutral')
          }
        })
        .catch(() => {
          /* serveur injoignable : le fil actuel reste affiché */
        })
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [character, chatMeta, streaming, compacting])

  // ── Mode visual novel ────────────────────────────────────────────────────

  // Bascule explicite (bouton ou Échap) : la préférence part au serveur. Rien
  // n'est écrit au montage — un boot vierge ne crée aucune préférence.
  const changeVnMode = useCallback((next: boolean) => {
    setVnMode(next)
    setPref({ vnMode: next })
  }, [])

  // Échap quitte le mode — sauf si un dialog ou l'écran de connexion est ouvert
  // (là, Échap leur appartient).
  useEffect(() => {
    if (!vnMode || dialog || greetingAsk || needLogin) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') changeVnMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vnMode, dialog, greetingAsk, needLogin, changeVnMode])

  // ── Envoi + streaming ────────────────────────────────────────────────────

  function keepPartialDraft(extra?: FeedItem) {
    setFeed((f) => {
      const out: FeedItem[] = []
      for (const it of f) {
        if (it.kind === 'msg' && it.pending) {
          if (it.msg.content) out.push({ kind: 'msg', msg: it.msg })
        } else out.push(it)
      }
      if (extra) out.push(extra)
      return out
    })
  }

  // Réponse à un message précis : la citation est écrite EN TÊTE du message
  // envoyé et sauvegardé — aucune mécanique cachée, le modèle la lit telle quelle.
  async function send(content: string, images: string[]) {
    const quoted = replyTo
    setReplyTo(null)
    if (!quoted) return runGeneration({ content, images })
    const line = t('quotedLine', { name: speakerOf(quoted), text: excerpt(quoted.content, QUOTE_MAX) })
    return runGeneration({ content: `> ${line}\n\n${content}`, images })
  }

  // Génération : envoi normal, régénération de la dernière réponse, continuation
  // de la dernière réponse (fusionnée en place côté serveur), ou ouverture de
  // conversation ('open' : le modèle écrit le premier message).
  async function runGeneration(opts: {
    content?: string
    images?: string[] // data URLs jointes au message courant (modèles à vision)
    mode?: api.ChatMode
    // Ouverture automatique : le personnage et le chat viennent d'être chargés,
    // les états React ne sont pas encore à jour — openChat les passe en direct.
    char?: CharacterFull
    chat?: ChatMeta
  }) {
    const char = opts.char ?? character
    const chat = opts.chat ?? chatMeta
    // abortRef, PAS l'état `streaming` : runGeneration est appelée depuis des
    // chemins asynchrones (openChat après sélection) dont la closure peut dater
    // d'un rendu où le streaming n'avait pas commencé — l'état mentirait et
    // deux générations concurrentes écriraient dans le même fil.
    if (!char || !chat || abortRef.current !== null) return
    const mode = opts.mode

    // regenerate : le serveur ne RETIRE une réponse que si la dernière bulle
    // sauvegardée en est une — sinon il ne fait qu'ajouter la sienne (le compte
    // de messages doit suivre le même raisonnement, cf. `added` plus bas).
    const lastSavedRole = (() => {
      for (let i = feed.length - 1; i >= 0; i--) {
        const it = feed[i]
        if (it.kind === 'msg') return it.msg.role
      }
      return null
    })()
    const regenPopped = mode === 'regenerate' && lastSavedRole === 'assistant'

    // TTS d'une continuation : ne lire QUE la suite, pas tout le message fusionné.
    let ttsFromIndex = 0

    if (!mode) {
      const userMsg: ChatMessage = { role: 'user', content: opts.content ?? '', ts: new Date().toISOString() }
      // Vignettes visibles dans la bulle dès l'envoi (le serveur sauvegarde les mêmes).
      if (opts.images && opts.images.length > 0) userMsg.images = opts.images
      const draft: ChatMessage = { role: 'assistant', content: '', ts: new Date().toISOString() }
      setFeed((f) => [...f, { kind: 'msg', msg: userMsg }, { kind: 'msg', msg: draft, pending: true }])
    } else {
      // Les chips d'erreur/info de fin de fil n'ont plus de sens : on rejoue.
      setFeed((f) => {
        const out = [...f]
        while (out.length > 0 && (out[out.length - 1].kind === 'error' || out[out.length - 1].kind === 'info')) {
          out.pop()
        }
        const last = out[out.length - 1]
        if (mode === 'regenerate' || mode === 'open') {
          // regenerate : la dernière bulle assistant disparaît (le serveur retire
          // la sienne). open : le fil est vide, il n'y a rien à retirer.
          if (mode === 'regenerate' && last && last.kind === 'msg' && last.msg.role === 'assistant') out.pop()
          out.push({
            kind: 'msg',
            msg: { role: 'assistant', content: '', ts: new Date().toISOString() },
            pending: true,
          })
        } else if (last && last.kind === 'msg' && last.msg.role === 'assistant') {
          // continue : la dernière bulle redevient « en cours » et s'allonge.
          out[out.length - 1] = { ...last, pending: true }
        }
        return out
      })
    }

    const ac = new AbortController()
    abortRef.current = ac
    setStreaming(true)
    // Un nouveau message coupe la lecture TTS de la réponse précédente. Les
    // lèvres, elles, n'attendent que les deltas de TEXTE (pokeSpeaking) : rien
    // ne bouge pendant la connexion ni pendant le raisonnement du modèle.
    stopTts()
    let acc = ''
    if (mode === 'continue') {
      // Le flux reprend là où le texte existant s'arrête (même joint que le serveur).
      for (let i = feed.length - 1; i >= 0; i--) {
        const it = feed[i]
        if (it.kind === 'msg' && it.msg.role === 'assistant') {
          acc = it.msg.content
          if (acc && !acc.endsWith('\n')) acc += ' '
          break
        }
      }
      ttsFromIndex = acc.length
    }
    let thinkingAcc = ''
    // Émotion posée EN COURS de flux (null tant qu'aucun tag n'est arrivé) —
    // gardée pour la re-poser à la fin, cf. l'événement `done`.
    let liveEmotion: string | null = null
    let finished = false

    try {
      await api.streamChat({
        characterId: char.id,
        chatId: chat.id,
        content: opts.content,
        images: opts.images,
        mode,
        signal: ac.signal,
        onEvent: (ev) => {
          if (ev.type === 'delta') {
            acc += ev.text
            pokeSpeaking(ev.text.length)
            if (!liveEmotion) {
              const em = extractEmotion(acc)
              if (em) {
                liveEmotion = em
                applyEmotion(em, true)
              }
            }
            const text = acc
            setFeed((f) =>
              f.map((it) => (it.kind === 'msg' && it.pending ? { ...it, msg: { ...it.msg, content: text } } : it)),
            )
          } else if (ev.type === 'thinking') {
            thinkingAcc += ev.text
            const thinking = thinkingAcc
            setFeed((f) =>
              f.map((it) => (it.kind === 'msg' && it.pending ? { ...it, msg: { ...it.msg, thinking } } : it)),
            )
          } else if (ev.type === 'tool') {
            const chip: FeedItem = { kind: 'tool', name: ev.name, args: ev.args }
            setFeed((f) => {
              const i = f.findIndex((it) => it.kind === 'msg' && it.pending)
              return i === -1 ? [...f, chip] : [...f.slice(0, i), chip, ...f.slice(i)]
            })
          } else if (ev.type === 'done') {
            finished = true
            setBackendDown(false)
            if (liveEmotion) {
              // Le tag arrive EN TÊTE de réponse : l'émotion a donc été posée au
              // tout début, et la scène la laisse s'éteindre au bout de quelques
              // secondes sans nouvelle (EMOTION_HOLD, scene/idle.ts) — une réponse
              // un peu longue se terminait sur un visage déjà revenu au neutre.
              // On la re-pose à la fin, SANS geste (live = false) : le visage
              // repart pour un cycle complet, le corps ne rejoue rien.
              applyEmotion(liveEmotion)
            } else {
              const em = ev.message.emotion ?? extractEmotion(ev.message.content)
              // Réponse terminée sans aucun tag : en mode simple, le visage suit
              // une heuristique de texte plutôt que de rester figé (les petits
              // modèles oublient le tag). En mode complet, rien ne change.
              if (em) applyEmotion(em, true)
              else if (settings?.modelMode === 'simple') {
                applyEmotion(detectEmotionFallback(ev.message.content), true)
              }
            }
            setFeed((f) => f.map((it) => (it.kind === 'msg' && it.pending ? { kind: 'msg', msg: ev.message } : it)))
            // Messages ajoutés au fichier : envoi normal = question + réponse,
            // open = la seule réponse, continue = fusion en place, regenerate =
            // remplacement (0) SAUF si rien n'avait été retiré (dernière bulle
            // user : le serveur a seulement ajouté, donc 1). Cas résiduel non
            // suivi : une continuation dont le fil a bougé pendant le stream
            // devient un ajout côté serveur — la liste des conversations relit
            // le vrai fichier de toute façon.
            const added = !mode ? 2 : mode === 'open' ? 1 : mode === 'regenerate' && !regenPopped ? 1 : 0
            setChatMeta((m) =>
              m
                ? {
                    ...m,
                    messageCount: m.messageCount + added,
                    updatedAt: new Date().toISOString(),
                  }
                : m,
            )
            if (ev.context) {
              setContext(ev.context)
              // Auto-compaction au seuil — silencieuse (le serveur refuse s'il
              // n'y a pas assez de nouveaux messages, on l'ignore sans bruit).
              // Un chat dont l'auto-compaction a échoué n'est plus retenté
              // automatiquement (le bouton manuel de l'inspecteur reste là).
              if (
                settings?.autoCompact &&
                ev.context.limit > 0 &&
                ev.context.percent >= AUTO_COMPACT_AT &&
                !autoCompactFailedRef.current.has(chat.id)
              ) {
                compact(char.id, chat.id, '', true).catch((err) => console.warn('[compact]', err))
              }
            }
            // Voix ou ding, jamais les deux : quand le TTS lit la réponse, la
            // voix EST la notification. Le TTS se tait sur un texte sans mot
            // (tags d'émotion seuls) — dans ce cas le ding reprend son rôle.
            const toSpeak = ev.message.content.slice(ttsFromIndex)
            const ttsWillSpeak = settings?.ttsEnabled === true && stripEmotionTags(toSpeak).trim().length > 0
            if (ttsWillSpeak) {
              playTts(toSpeak, ev.message.ts).catch((e) => {
                setFeed((f) => [...f, { kind: 'error', text: t('ttsError', { message: api.errorMessage(e) }) }])
              })
            } else if (settings?.notifySound) {
              playNotify()
            }
          } else if (ev.type === 'error') {
            finished = true
            keepPartialDraft({ kind: 'error', text: ev.message })
          }
        },
      })
      if (!finished) keepPartialDraft({ kind: 'error', text: t('responseInterrupted') })
    } catch (e) {
      if (e instanceof api.AuthRequiredError) {
        keepPartialDraft()
        setNeedLogin(true)
      } else if ((e as Error).name === 'AbortError') {
        keepPartialDraft()
      } else {
        keepPartialDraft({ kind: 'error', text: api.errorMessage(e) })
        if (e instanceof api.ApiError && (e.status === 502 || e.status === 0)) setBackendDown(true)
      }
    } finally {
      setStreaming(false)
      // Fin NORMALE : la bouche finit de « prononcer » la dernière rafale (le
      // timer de pokeSpeaking la refermera). Interruption/abandon : on coupe net.
      if (!finished) stopSpeaking()
      abortRef.current = null
    }
  }

  function stopStreaming() {
    abortRef.current?.abort()
  }

  // Édition d'un message en place — ordinal = position parmi les messages
  // SAUVEGARDÉS (les chips outil/erreur/info et le greeting ne comptent pas).
  async function handleEditMessage(ordinal: number, content: string) {
    const char = character
    const chat = chatMeta
    if (!char || !chat) return
    const out = await api.editChatMessage(char.id, chat.id, ordinal, content)
    setFeed((f) => {
      let n = -1
      return f.map((it) => {
        if (it.kind !== 'msg') return it
        n++
        return n === ordinal ? { kind: 'msg' as const, msg: out.message } : it
      })
    })
  }

  // Suppression d'un message du fil — même ordinal que l'édition. Le serveur
  // recale l'épingle et la frontière du résumé, et renvoie l'épingle d'après.
  // Rien n'est retiré à l'écran tant que le serveur n'a pas répondu : un échec
  // laisse le fil exactement tel qu'il est sur le disque.
  async function handleDeleteMessage(ordinal: number) {
    const char = character
    const chat = chatMeta
    if (!char || !chat) return
    const out = await api.deleteChatMessage(char.id, chat.id, ordinal)
    setFeed((f) => {
      let n = -1
      return f.filter((it) => {
        if (it.kind !== 'msg') return true
        n++
        return n !== ordinal
      })
    })
    setChatMeta((m) =>
      m && m.id === chat.id
        ? { ...m, messageCount: out.messageCount, pinned: out.pinned ?? undefined }
        : m,
    )
  }

  // Épingle : gadget d'affichage seulement (l'ordinal vit dans l'en-tête du chat,
  // jamais dans le payload envoyé au modèle). Optimiste : le bandeau suit le clic,
  // et repart à l'état serveur si l'appel échoue.
  async function handlePin(ordinal: number | null) {
    const char = character
    const chat = chatMeta
    if (!char || !chat) return
    const previous = chat.pinned
    setChatMeta((m) => (m && m.id === chat.id ? { ...m, pinned: ordinal ?? undefined } : m))
    try {
      await api.pinChatMessage(char.id, chat.id, ordinal)
    } catch (e) {
      setChatMeta((m) => (m && m.id === chat.id ? { ...m, pinned: previous } : m))
      handleError(e, 'pin')
    }
  }

  // ── Callbacks des dialogs ────────────────────────────────────────────────

  async function refreshCharacters(): Promise<CharacterMeta[]> {
    try {
      const chars = await api.listCharacters()
      setCharacters(chars)
      return chars
    } catch (e) {
      handleError(e, 'characters')
      return characters
    }
  }

  function handleSettingsSaved(next: Settings) {
    setSettings(next)
    // La persona vient peut-être de changer de nom : les prochaines salutations
    // doivent l'appeler ainsi (cf. personaNameRef).
    personaNameRef.current = next.personaName ?? ''
    // Contrat : le token EST le mot de passe. On le synchronise pour rester connecté.
    api.setToken(next.password || null)
    probeBackend()
    // Le modèle ou le mode vision viennent peut-être de changer.
    probeVision()
  }

  async function handleChatDeleted(deletedId: string) {
    const char = character
    if (!char || chatMeta?.id !== deletedId) return
    // Le chat actif vient d'être supprimé : couper un éventuel stream en cours.
    abortRef.current?.abort()
    try {
      const chats = await api.listChats(char.id)
      const next = chats[0] ?? (await api.createChat(char.id, defaultChatTitle()))
      await openChat(char, next.id)
    } catch (e) {
      handleError(e, 'chats')
    }
  }

  async function handleCharacterDeleted(id: string) {
    // Conversation active, cadrage caméra et sélection de ce personnage : oubliés.
    forgetCharacter(id)
    const chars = await refreshCharacters()
    if (character?.id === id) {
      // Le personnage actif vient d'être supprimé : couper un éventuel stream en
      // cours (y compris quand il ne reste plus aucun personnage).
      abortRef.current?.abort()
      const next = chars.find((c) => c.id !== id)
      if (next) await selectCharacter(next.id)
      else {
        setCharacter(null)
        setChatMeta(null)
        chatIdRef.current = null
        setReplyTo(null)
        setGreetingAsk(null)
        setFeed([])
      }
    }
  }

  // Dernier message affiché (hors chips) : pilote les boutons Régénérer/Continuer.
  const lastFeedMsg = (() => {
    for (let i = feed.length - 1; i >= 0; i--) {
      const it = feed[i]
      if (it.kind === 'msg') return it
    }
    return null
  })()
  const canRegen = !!lastFeedMsg && !lastFeedMsg.pending
  const canContinue = canRegen && lastFeedMsg.msg.role === 'assistant'

  // Jauge de contexte : calculée une fois, partagée par la TopBar et le mode VN.
  const ctxPercent = context && context.limit > 0 ? context.percent : null
  const ctxTooltip = context ? t('contextBadgeTitle', { tokens: context.tokens, limit: context.limit }) : ''
  // Titre affiché de la conversation active (auto localisé, ou voulu tel quel).
  const chatTitle = chatDisplayTitle(chatMeta, lang, t)
  // En mode VN le CSS masque la TopBar : titre du chat et jauge migrent dans la
  // bande basse de la boîte. null = rien à y montrer (pas de titre, pas de jauge).
  const vnInfo =
    vnMode && (chatTitle !== '' || ctxPercent !== null)
      ? { title: chatTitle, percent: ctxPercent, tooltip: ctxTooltip }
      : null

  // Portrait 2D : un personnage SANS modèle 3D montre l'image de sa card (posée à
  // l'import). Avec un VRM, l'avatar 3D reprend toute la place. '' = rien à montrer.
  const portrait = character && !character.vrm ? (character.portrait ?? '') : ''

  // ── Rendu ────────────────────────────────────────────────────────────────
  // NB : la div .scene reste montée en permanence (le stage 3D y est attaché via
  // un effet à deps []) — l'écran de connexion se rend en OVERLAY, jamais à la
  // place de l'arbre principal.

  return (
    <div className="app">
      <div
        ref={sceneRef}
        className="scene"
        aria-hidden="true"
        style={character?.background ? { backgroundImage: `url("${character.background}")` } : undefined}
      />

      {/* Avatar 2D : l'image de la card tient lieu d'avatar quand le personnage
          n'a pas de modèle 3D. Rendu FRÈRE de .scene et non dedans — le canvas du
          stage y est ajouté impérativement, React ne doit pas partager cet enfant.
          Placement en CSS pur (classe `vn`), et rien à brancher : une image ne
          bouge ni les lèvres ni les émotions. */}
      {portrait !== '' && (
        <img
          className={`scene-portrait${vnMode ? ' vn' : ''}`}
          src={portrait}
          alt=""
          aria-hidden="true"
        />
      )}

      {/* ASTUCE DES INTERACTIONS 3D — une ligne, une fois, puis plus jamais.
          Rendue FRÈRE de .scene comme le reste des surimpressions, inerte au
          pointeur (le clic qu'elle explique doit passer au travers) et annoncée
          en `status` : elle apparaît sans que rien n'ait été demandé, une
          synthèse vocale doit pouvoir la lire sans qu'elle vole le focus. */}
      {hint3d && (
        <p className={`scene-hint${vnMode ? ' vn' : ''}`} role="status">
          {t('scene3dHint')}
        </p>
      )}

      {/* RÉINITIALISER L'AFFICHAGE — un seul bouton pour tout (doctrine : pas un
          bouton par chose à remettre) : recadre l'avatar du mode courant (même
          chemin que le double-clic : resetView émet onViewChange(null), le
          cadrage sauvegardé du mode est oublié) ET rend leurs tailles par défaut
          aux panneaux (chat desktop, boîte VN — les double-clics des poignées
          restent en raccourcis). Il vit HORS du chat-panel (le mode VN y coupe
          les pointer-events). */}
      {stageReady && !vrmError && !!character && (
        <button
          className={`scene-reset${vnMode ? ' vn' : ''}`}
          onClick={() => {
            stageRef.current?.resetView()
            saveChatPanelWidth(null)
            saveVnBoxWidth(null)
            saveVnTextHeight(null)
          }}
          title={t('resetLayout')}
          aria-label={t('resetLayout')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19.2 12a7.2 7.2 0 1 1-2.1-5.1" />
            <path d="M19.5 3.6v3.5H16" />
          </svg>
        </button>
      )}

      {vrmError && (
        <div
          className="banner"
          role="alert"
          style={{
            position: 'fixed',
            top: 10,
            left: 10,
            zIndex: 5,
            margin: 0,
            maxWidth: 320,
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 2,
          }}
        >
          <span>{t('vrmLoadError')}</span>
          <span style={{ fontSize: 11, opacity: 0.75 }}>{vrmError}</span>
        </div>
      )}

      {/* Décor introuvable ou illisible : l'avatar, lui, est là — d'où une
          bannière à part, sous celle du modèle quand les deux tombent. */}
      {envError && (
        <div
          className="banner"
          role="alert"
          style={{
            position: 'fixed',
            top: vrmError ? 78 : 10,
            left: 10,
            zIndex: 5,
            margin: 0,
            maxWidth: 320,
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 2,
          }}
        >
          <span>{t('environmentLoadError')}</span>
          <span style={{ fontSize: 11, opacity: 0.75 }}>{envError}</span>
        </div>
      )}

      {/* En mode VN, le panneau s'efface (CSS) : « collapsed » n'a plus de sens. */}
      <div className={`chat-panel${vnMode ? ' vn' : collapsed ? ' collapsed' : ''}`}>
        {/* Poignée de largeur du bord gauche : le CSS la réserve à la colonne de
            droite (desktop, hors mode VN) — ailleurs le panneau n'a pas de
            largeur à régler. */}
        <ChatPanelGrip />

        <button
          className="sheet-handle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? t('expandChat') : t('collapseChat')}
        >
          <span className="handle-bar" />
        </button>

        <TopBar
          characterName={character?.name ?? 'Hanami'}
          chatTitle={chatTitle}
          contextPercent={ctxPercent}
          contextTitle={ctxTooltip}
          hasCharacter={!!character}
          hasChat={!!character && !!chatMeta}
          vnMode={vnMode}
          onToggleVn={() => {
            changeVnMode(!vnMode)
            setCollapsed(false) // on ne revient jamais du mode VN sur un panneau replié
          }}
          onToggleSearch={() => setSearchSignal((n) => n + 1)}
          onOpen={setDialog}
        />

        {backendDown && settings && (
          <div className="banner" role="alert">
            <span>{t('backendDown')}</span>
            <button className="btn small" onClick={() => setDialog('settings')}>
              {t('openSettings')}
            </button>
          </div>
        )}

        {compacting && (
          <div className="compact-pill" role="status">
            {t('compacting')}
          </div>
        )}

        {/* Décor en cours de chargement : plusieurs mégaoctets, l'attente se voit. */}
        {envLoading && (
          <div className="compact-pill" role="status">
            {t('environmentLoading')}
          </div>
        )}

        {booting ? (
          <div className="empty-state">
            <p>{t('loading')}</p>
          </div>
        ) : !character ? (
          <div className="empty-state">
            <h2>{t('welcomeTitle')}</h2>
            <p>{t('noCharacters')}</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={() => setDialog('characters')}>
                {t('createCharacter')}
              </button>
              <button className="btn" onClick={() => setDialog('import')}>
                {t('importTitle')}
              </button>
            </div>
          </div>
        ) : vnMode ? (
          // Mode VN : le fil complet n'est pas monté (rien à garder à l'écran),
          // seule la dernière réplique s'affiche. Sortir du mode remonte le fil,
          // donc collé en bas — exactement comme un changement de chat.
          <VnBox items={feed} characterName={character.name} />
        ) : (
          // key : remonte le fil à chaque changement de chat (réinitialise le
          // scroll et l'autoscroll collé en bas).
          <MessageList
            key={chatMeta?.id ?? 'no-chat'}
            items={feed}
            showThoughts={settings?.showThoughts ?? false}
            editable={!streaming && !compacting}
            // Ctrl+F appartient au dialog ouvert (ou à l'écran de connexion).
            searchable={!dialog && !greetingAsk && !needLogin}
            searchSignal={searchSignal}
            editLastSignal={editLastSignal}
            pinned={chatMeta?.pinned ?? null}
            onSaveEdit={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
            onReply={setReplyTo}
            onPin={(ordinal) => {
              handlePin(ordinal).catch((e) => console.error('[pin]', e))
            }}
            onRemember={(msg) => {
              const char = character
              if (!char) return
              api
                .rememberText(char.id, stripEmotionTags(msg.content).trim())
                .then(() => setFeed((f) => [...f, { kind: 'info', text: t('remembered') }]))
                .catch((e) => {
                  if (e instanceof api.AuthRequiredError) setNeedLogin(true)
                  else setFeed((f) => [...f, { kind: 'error', text: api.errorMessage(e) }])
                })
            }}
            ttsPlaying={ttsPlaying}
            onStopTts={stopTts}
            onReplay={
              settings?.ttsEnabled
                ? (msg) => {
                    playTts(msg.content, msg.ts).catch((e) =>
                      setFeed((f) => [...f, { kind: 'error', text: t('ttsError', { message: api.errorMessage(e) }) }]),
                    )
                  }
                : null
            }
          />
        )}

        {/* Bande basse : en mode VN elle sert AUSSI de pied à la boîte de dialogue
            (infos de conversation à gauche), donc elle existe même sans action à
            proposer. En desktop rien ne change : vnInfo y est null. */}
        {!booting && character && chatMeta && (vnInfo !== null || (!streaming && canRegen)) && (
          <div className="reply-actions">
            {vnInfo !== null && (
              <div className="vn-info">
                {vnInfo.title !== '' && <span className="vn-info-title">{vnInfo.title}</span>}
                {vnInfo.percent !== null && <CtxBadge percent={vnInfo.percent} title={vnInfo.tooltip} />}
              </div>
            )}
            {!streaming && canRegen && (
              <>
                <button
                  className="btn small"
                  onClick={() => runGeneration({ mode: 'regenerate' }).catch((e) => console.error('[regen]', e))}
                >
                  {t('regenerate')}
                </button>
                {canContinue && (
                  <button
                    className="btn small"
                    onClick={() => runGeneration({ mode: 'continue' }).catch((e) => console.error('[continue]', e))}
                  >
                    {t('continueReply')}
                  </button>
                )}
                {/* En VN les bulles sont hors d'atteinte : le rejeu vit ici. En
                    desktop, l'icône haut-parleur de la bulle s'en charge déjà. */}
                {vnMode && canContinue && settings?.ttsEnabled && lastFeedMsg && (
                  // Pendant la lecture, le même bouton la coupe : en VN il n'y a
                  // pas de bulle à survoler, c'est la seule prise sur la voix.
                  <button
                    className="btn small"
                    onClick={() => {
                      if (ttsPlaying !== null && ttsPlaying === lastFeedMsg.msg.ts) {
                        stopTts()
                        return
                      }
                      playTts(lastFeedMsg.msg.content, lastFeedMsg.msg.ts).catch((e) =>
                        setFeed((f) => [
                          ...f,
                          { kind: 'error', text: t('ttsError', { message: api.errorMessage(e) }) },
                        ]),
                      )
                    }}
                  >
                    {ttsPlaying !== null && ttsPlaying === lastFeedMsg.msg.ts ? t('stopTts') : t('replayTts')}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Cible de la réponse — l'extrait cité partira en tête du message. */}
        {replyTo && (
          <div className="reply-quote">
            <span className="reply-quote-who">{t('replyingTo', { name: speakerOf(replyTo) })}</span>
            <span className="reply-quote-text">{excerpt(replyTo.content, QUOTE_PREVIEW_MAX)}</span>
            <button
              className="reply-quote-close"
              onClick={() => setReplyTo(null)}
              title={t('cancel')}
              aria-label={t('cancel')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        )}

        <Composer
          disabled={booting || !character || !chatMeta}
          streaming={streaming}
          vision={visionEnabled}
          onSend={(text, images) => send(text, images).catch((e) => console.error('[send]', e))}
          onCommand={(name, arg) => {
            const char = character
            const chat = chatMeta
            if (!char || !chat) return
            // /compact [instruction] — même chemin que l'Inspecteur (pastille +
            // ligne d'info) ; /clean — conversation vierge, même chemin que le
            // bouton « Nouvelle conversation » (l'ancienne reste dans la liste).
            const run =
              name === 'compact'
                ? compact(char.id, chat.id, arg)
                : api.createChat(char.id, defaultChatTitle()).then((c) => openChat(char, c.id))
            run.catch((e) => {
              if (e instanceof api.AuthRequiredError) setNeedLogin(true)
              else setFeed((f) => [...f, { kind: 'error', text: api.errorMessage(e) }])
            })
          }}
          // Flèche haut dans un champ vide : le fil rouvre le dernier message
          // envoyé. Sans effet en mode VN, où le fil n'est pas monté.
          onEditLast={() => setEditLastSignal((n) => n + 1)}
          onStop={stopStreaming}
        />
      </div>

      {dialog === 'settings' && settings && (
        <SettingsDialog
          settings={settings}
          theme={appTheme}
          onPickTheme={(t) => {
            setAppTheme(t)
            saveTheme(t)
          }}
          env3d={env3d}
          onToggleEnv3d={(on) => {
            setEnv3d(on)
            setPref({ env3d: on })
          }}
          vrmaEnabled={vrmaEnabled}
          onToggleVrma={(on) => {
            setVrmaEnabled(on)
            setPref({ vrmaEnabled: on })
          }}
          interactive={interactive}
          interactiveDisabled={!wideScreen || !vrmaEnabled}
          interactiveReason={!wideScreen ? t('sceneLiveNoMobile') : !vrmaEnabled ? t('sceneLiveNoVrma') : ''}
          onToggleInteractive={(on) => {
            setInteractive(on)
            setPref({ interactive: on })
          }}
          onSaved={handleSettingsSaved}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'settings' && !settings && (
        <Dialog title={t('settings')} onClose={() => setDialog(null)}>
          <p className="hint">{t('settingsUnavailable')}</p>
        </Dialog>
      )}

      {dialog === 'chats' && character && (
        <ChatsDialog
          characterId={character.id}
          characterName={character.name}
          activeChatId={chatMeta?.id ?? null}
          onSelect={(chatId) => {
            openChat(character, chatId).catch((e) => console.error('[chats]', e))
          }}
          onDeleted={(chatId) => {
            handleChatDeleted(chatId).catch((e) => console.error('[chats]', e))
          }}
          onRenamed={(chatId, title) => {
            // Renommer le chat ACTIF : la barre du haut (et la bande VN) suivent.
            setChatMeta((m) => (m && m.id === chatId ? { ...m, title, titleCustom: true } : m))
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'characters' && (
        <CharactersDialog
          characters={characters}
          activeId={character?.id ?? null}
          onSelect={(id) => {
            if (id !== character?.id) selectCharacter(id).catch((e) => console.error('[character]', e))
          }}
          onCreated={(c) => {
            refreshCharacters()
              .then(() => selectCharacter(c.id))
              .catch((e) => console.error('[characters]', e))
          }}
          onUpdated={(c) => {
            refreshCharacters().catch((e) => console.error('[characters]', e))
            if (character?.id === c.id) setCharacter(c)
          }}
          onDeleted={(id) => {
            handleCharacterDeleted(id).catch((e) => console.error('[characters]', e))
          }}
          // Photo par capture : proposée seulement quand un avatar 3D est bien à
          // l'écran (scène prête, sans erreur, personnage doté d'un VRM). Le
          // dialog restreint en plus au personnage actif — le seul qui soit affiché.
          snapshotAvatar={
            stageReady && !vrmError && !!character?.vrm
              ? () => stageRef.current?.snapshot() ?? null
              : null
          }
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'memory' && character && (
        <MemoryDialog characterId={character.id} onClose={() => setDialog(null)} />
      )}

      {dialog === 'import' && (
        <ImportDialog
          characters={characters}
          defaultCharacterId={character?.id ?? null}
          onCharacterImported={(c) => {
            refreshCharacters()
              .then(() => {
                // Premier personnage importé : le sélectionner directement.
                if (!character) return selectCharacter(c.id)
              })
              .catch((e) => console.error('[import]', e))
          }}
          onChatsImported={() => {
            /* la liste des chats est rechargée à l'ouverture du dialog Conversations */
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'inspector' && character && chatMeta && (
        <PromptInspector
          characterId={character.id}
          chatId={chatMeta.id}
          summary={chatMeta.summary ?? ''}
          sceneNotes={chatMeta.sceneNotes ?? ''}
          compacting={compacting}
          streaming={streaming}
          onCompact={(instruction) => compact(character.id, chatMeta.id, instruction)}
          onSaveSummary={async (text) => {
            const out = await api.updateChatSummary(character.id, chatMeta.id, text)
            setChatMeta((m) =>
              m && m.id === chatMeta.id
                ? {
                    ...m,
                    summary: out.summary || undefined,
                    summaryUpto: out.summary ? out.summaryUpto : undefined,
                  }
                : m,
            )
          }}
          onSaveSceneNotes={async (text) => {
            const out = await api.updateChatSceneNotes(character.id, chatMeta.id, text)
            setChatMeta((m) =>
              m && m.id === chatMeta.id ? { ...m, sceneNotes: out.sceneNotes || undefined } : m,
            )
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {/* Mode d'accueil « demander » : rendu en dernier, donc au-dessus des autres
          dialogs (le choix arrive parfois depuis la liste des personnages). */}
      {greetingAsk && (
        <Dialog
          title={t('askGreetingTitle')}
          // Fermer (X, Échap, fond) revient à choisir « écrit » : la question ne
          // se repose pas — l'utilisateur peut aussi simplement parler le premier.
          onClose={() => chooseWrittenGreeting(greetingAsk)}
        >
          <div className="row">
            <button className="btn" onClick={() => chooseWrittenGreeting(greetingAsk)}>
              {t('askGreetingWritten')}
            </button>
            <button className="btn primary" onClick={() => chooseGeneratedGreeting(greetingAsk)}>
              {t('askGreetingGenerated')}
            </button>
          </div>
        </Dialog>
      )}

      {/* Overlay plein écran (z-index 100, au-dessus du chat-panel et des dialogs). */}
      {needLogin && <LoginGate onDone={() => boot().catch((e) => console.error('[boot]', e))} />}
    </div>
  )
}

// Racine : le fournisseur de langue enveloppe toute l'UI (préférence locale, pas un réglage serveur).
export default function App() {
  return (
    <I18nProvider>
      <AppInner />
    </I18nProvider>
  )
}
