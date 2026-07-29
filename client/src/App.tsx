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
import type { VrmStage } from './scene/types'
import * as api from './api'
import { detectEmotionFallback, extractEmotion, stripEmotionTags } from './emotions'
import { I18nProvider, localeOf, useI18n } from './i18n'
import TopBar, { type DialogKind } from './components/TopBar'
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

const CHAR_KEY = 'hanami_char'
// Mode visual novel : préférence d'affichage locale (pas un réglage serveur).
const VN_KEY = 'hanami_vn'
const chatKey = (charId: string) => `hanami_chat_${charId}`
// Cadrage caméra choisi par l'utilisateur (pan/zoom/rotation), par personnage.
const viewKey = (charId: string) => `hanami_view_${charId}`
// Seuil d'auto-compaction (% du contexte) — même esprit que Claude Code.
const AUTO_COMPACT_AT = 80
// Citation d'un message : longueur de l'aperçu (bandeau) et de l'extrait envoyé.
const QUOTE_PREVIEW_MAX = 80
const QUOTE_MAX = 200

/** Extrait d'un message à citer : une seule ligne, tags d'émotion retirés, tronquée. */
function excerpt(text: string, max: number): string {
  const flat = stripEmotionTags(text).replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat
}

/** Messages d'accueil écrits du personnage : le principal puis ses variantes, vides retirés. */
function greetingPool(char: CharacterFull): string[] {
  const variants = Array.isArray(char.greetings) ? char.greetings : []
  return [char.greeting, ...variants].filter((g) => typeof g === 'string' && g.trim().length > 0)
}

/** Tirage d'un accueil : chaque nouvelle conversation peut s'ouvrir autrement. */
function pickGreeting(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)]
}

function AppInner() {
  const { lang, t } = useI18n()
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
  const [backendDown, setBackendDown] = useState(false)
  const [context, setContext] = useState<ContextInfo | null>(null)
  const [compacting, setCompacting] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [vnMode, setVnMode] = useState(() => {
    try {
      return localStorage.getItem(VN_KEY) === '1'
    } catch {
      return false // localStorage indisponible : chat classique
    }
  })
  const [stageReady, setStageReady] = useState(false)
  const [vrmError, setVrmError] = useState<string | null>(null)
  // Mode d'accueil « demander » : question posée une seule fois par ouverture de
  // chat vide (le personnage et le chat visés sont figés dans l'état).
  const [greetingAsk, setGreetingAsk] = useState<{ char: CharacterFull; chat: ChatMeta } | null>(null)

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
  // Chats dont l'auto-compaction a échoué : pas de nouvel essai automatique
  // (sinon un backend strict serait re-sollicité à chaque message).
  const autoCompactFailedRef = useRef<Set<string>>(new Set())
  // Personnage courant pour le callback de cadrage (posé une fois à la création
  // de la scène, qui vit plus longtemps que chaque personnage).
  const characterIdRef = useRef<string | null>(null)

  // ── Helpers ──────────────────────────────────────────────────────────────

  const handleError = useCallback((e: unknown, tag: string) => {
    if (e instanceof api.AuthRequiredError) setNeedLogin(true)
    else console.error(`[${tag}]`, e)
  }, [])

  /** Locuteur d'un message, tel qu'il apparaît dans la citation et le bandeau. */
  function speakerOf(msg: ChatMessage): string {
    return msg.role === 'user' ? t('vnYou') : (character?.name ?? 'Hanami')
  }

  function applyEmotion(emotion: string) {
    lastEmotionRef.current = emotion
    stageRef.current?.setEmotion(emotion)
  }

  function probeBackend() {
    api
      .getModels()
      .then(() => setBackendDown(false))
      .catch(() => setBackendDown(true))
  }

  // ── Lèvres & voix ────────────────────────────────────────────────────────

  // Un delta de texte vient d'arriver : bouche animée, refermée 600 ms après le
  // dernier delta (couvre les pauses de thinking et d'appels d'outils mi-flux).
  function pokeSpeaking() {
    stageRef.current?.setSpeaking(true)
    if (speakTimerRef.current !== null) window.clearTimeout(speakTimerRef.current)
    speakTimerRef.current = window.setTimeout(() => {
      speakTimerRef.current = null
      stageRef.current?.setSpeaking(false)
    }, 600)
  }

  function stopSpeaking() {
    if (speakTimerRef.current !== null) {
      window.clearTimeout(speakTimerRef.current)
      speakTimerRef.current = null
    }
    stageRef.current?.setSpeaking(false)
  }

  function stopTts() {
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
      try {
        const p = await api.getPromptPreview(charId, chatId)
        if (chatIdRef.current === chatId && p.contextSize > 0) {
          setContext({
            tokens: p.tokens,
            limit: p.contextSize,
            percent: Math.min(100, Math.round((p.tokens / p.contextSize) * 100)),
          })
        }
      } catch {
        /* la jauge se resynchronisera au prochain message */
      }
    } catch (e) {
      if (e instanceof api.AuthRequiredError) {
        setNeedLogin(true)
        return
      }
      if (silent) {
        autoCompactFailedRef.current.add(chatId)
        console.warn('[compact]', e)
        return
      }
      throw e
    } finally {
      compactingRef.current = false
      setCompacting(false)
    }
  }

  async function playTts(text: string) {
    const clean = stripEmotionTags(text).trim()
    if (!clean) return
    const blob = await api.tts(clean)
    stopTts()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audioRef.current = audio
    audio.onplay = () => stageRef.current?.setSpeaking(true)
    const end = () => {
      if (audioRef.current === audio) {
        audioRef.current = null
        stageRef.current?.setSpeaking(false)
      }
      URL.revokeObjectURL(url)
    }
    audio.onended = end
    audio.onerror = end
    await audio.play()
  }

  // ── Scène 3D (import lazy, contrat scene/types.ts) ───────────────────────

  useEffect(() => {
    let cancelled = false
    setVrmError(null)
    ;(async () => {
      const { createVrmStage } = await import('./scene/vrmStage')
      if (cancelled || !sceneRef.current) return
      stageRef.current = createVrmStage(sceneRef.current)
      // Cadrage modifié à la main → persisté par personnage ; double-clic → oubli.
      stageRef.current.onViewChange((view) => {
        const id = characterIdRef.current
        if (!id) return
        try {
          if (view) localStorage.setItem(viewKey(id), JSON.stringify(view))
          else localStorage.removeItem(viewKey(id))
        } catch {
          /* localStorage indisponible : cadrage non persisté */
        }
      })
      setStageReady(true)
    })().catch((e) => {
      console.error('[vrm]', e)
      if (!cancelled) setVrmError(api.errorMessage(e))
    })
    return () => {
      cancelled = true
      stopTts()
      if (speakTimerRef.current !== null) window.clearTimeout(speakTimerRef.current)
      stageRef.current?.dispose()
      stageRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Changement de personnage (ou scène prête) → charger son modèle VRM, puis
  // réappliquer le cadrage caméra que l'utilisateur avait choisi pour lui.
  useEffect(() => {
    characterIdRef.current = character?.id ?? null
    const stage = stageRef.current
    if (!stage || !stageReady) return
    setVrmError(null)
    const charId = character?.id ?? null
    stage
      .loadModel(character?.vrm ?? '')
      .then(() => {
        if (!charId || characterIdRef.current !== charId) return
        const raw = localStorage.getItem(viewKey(charId))
        if (!raw) return
        try {
          stage.setView(JSON.parse(raw))
        } catch {
          localStorage.removeItem(viewKey(charId)) // cadrage corrompu : oublié
        }
      })
      .catch((e) => {
        console.error('[vrm]', e)
        setVrmError(api.errorMessage(e))
      })
    stage.setEmotion(lastEmotionRef.current)
  }, [stageReady, character?.vrm, character?.id])

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
    const pool = greetingPool(ask.char)
    if (pool.length === 0) return
    const text = pickGreeting(pool)
    setFeed([{ kind: 'greeting', text }])
    applyEmotion(extractEmotion(text) ?? 'neutral')
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
      setContext(null) // la jauge repart avec le prochain échange de ce chat
      localStorage.setItem(chatKey(char.id), meta.id)
      const items: FeedItem[] = messages.map((m) => ({ kind: 'msg', msg: m }))
      // Premier message d'un chat VIDE (jamais sur un chat importé — il n'est pas
      // vide), selon le mode du personnage : 'written' (défaut) affiche une
      // salutation écrite tirée au hasard, 'generated' laisse le modèle ouvrir,
      // 'ask' pose la question. Sans aucun texte écrit, on génère dans tous les cas.
      const empty = messages.length === 0
      const mode = char.greetingMode ?? 'written'
      const pool = empty ? greetingPool(char) : []
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
      applyEmotion(emotion ?? 'neutral')
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
      localStorage.setItem(CHAR_KEY, id)
      const chats = await api.listChats(id)
      if (gen !== loadGenRef.current) return
      const savedChat = localStorage.getItem(chatKey(id))
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
      setSettings(await api.getSettings())
      const chars = await api.listCharacters()
      setCharacters(chars)
      const saved = localStorage.getItem(CHAR_KEY)
      const pick = chars.find((c) => c.id === saved) ?? chars[0]
      if (pick) await selectCharacter(pick.id)
      probeBackend()
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

  // ── Mode visual novel ────────────────────────────────────────────────────

  useEffect(() => {
    try {
      localStorage.setItem(VN_KEY, vnMode ? '1' : '0')
    } catch {
      /* préférence non persistée : pas bloquant */
    }
  }, [vnMode])

  // Échap quitte le mode — sauf si un dialog ou l'écran de connexion est ouvert
  // (là, Échap leur appartient).
  useEffect(() => {
    if (!vnMode || dialog || greetingAsk || needLogin) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setVnMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vnMode, dialog, greetingAsk, needLogin])

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
  async function send(content: string) {
    const quoted = replyTo
    setReplyTo(null)
    if (!quoted) return runGeneration({ content })
    const line = t('quotedLine', { name: speakerOf(quoted), text: excerpt(quoted.content, QUOTE_MAX) })
    return runGeneration({ content: `> ${line}\n\n${content}` })
  }

  // Génération : envoi normal, régénération de la dernière réponse, continuation
  // de la dernière réponse (fusionnée en place côté serveur), ou ouverture de
  // conversation ('open' : le modèle écrit le premier message).
  async function runGeneration(opts: {
    content?: string
    mode?: api.ChatMode
    // Ouverture automatique : le personnage et le chat viennent d'être chargés,
    // les états React ne sont pas encore à jour — openChat les passe en direct.
    char?: CharacterFull
    chat?: ChatMeta
  }) {
    const char = opts.char ?? character
    const chat = opts.chat ?? chatMeta
    if (!char || !chat || streaming) return
    const mode = opts.mode

    // TTS d'une continuation : ne lire QUE la suite, pas tout le message fusionné.
    let ttsFromIndex = 0

    if (!mode) {
      const userMsg: ChatMessage = { role: 'user', content: opts.content ?? '', ts: new Date().toISOString() }
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
    let emotionFound = false
    let finished = false

    try {
      await api.streamChat({
        characterId: char.id,
        chatId: chat.id,
        content: opts.content,
        mode,
        signal: ac.signal,
        onEvent: (ev) => {
          if (ev.type === 'delta') {
            acc += ev.text
            pokeSpeaking()
            if (!emotionFound) {
              const em = extractEmotion(acc)
              if (em) {
                emotionFound = true
                applyEmotion(em)
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
            if (!emotionFound) {
              const em = ev.message.emotion ?? extractEmotion(ev.message.content)
              // Réponse terminée sans aucun tag : en mode simple, le visage suit
              // une heuristique de texte plutôt que de rester figé (les petits
              // modèles oublient le tag). En mode complet, rien ne change.
              if (em) applyEmotion(em)
              else if (settings?.modelMode === 'simple') {
                applyEmotion(detectEmotionFallback(ev.message.content))
              }
            }
            setFeed((f) => f.map((it) => (it.kind === 'msg' && it.pending ? { kind: 'msg', msg: ev.message } : it)))
            // Messages ajoutés au fichier : envoi normal = question + réponse,
            // open = la seule réponse, regenerate/continue = remplacement en place.
            const added = !mode ? 2 : mode === 'open' ? 1 : 0
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
            if (settings?.ttsEnabled) {
              playTts(ev.message.content.slice(ttsFromIndex)).catch((e) => {
                setFeed((f) => [...f, { kind: 'error', text: t('ttsError', { message: api.errorMessage(e) }) }])
              })
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
      stopSpeaking()
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
    // Contrat : le token EST le mot de passe. On le synchronise pour rester connecté.
    api.setToken(next.password || null)
    probeBackend()
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
    localStorage.removeItem(chatKey(id))
    const chars = await refreshCharacters()
    if (character?.id === id) {
      // Le personnage actif vient d'être supprimé : couper un éventuel stream en
      // cours (y compris quand il ne reste plus aucun personnage).
      abortRef.current?.abort()
      localStorage.removeItem(CHAR_KEY)
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

      {/* En mode VN, le panneau s'efface (CSS) : « collapsed » n'a plus de sens. */}
      <div className={`chat-panel${vnMode ? ' vn' : collapsed ? ' collapsed' : ''}`}>
        <button
          className="sheet-handle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? t('expandChat') : t('collapseChat')}
        >
          <span className="handle-bar" />
        </button>

        <TopBar
          characterName={character?.name ?? 'Hanami'}
          chatTitle={chatMeta?.title ?? ''}
          contextPercent={context && context.limit > 0 ? context.percent : null}
          contextTitle={
            context ? t('contextBadgeTitle', { tokens: context.tokens, limit: context.limit }) : ''
          }
          hasCharacter={!!character}
          hasChat={!!character && !!chatMeta}
          vnMode={vnMode}
          onToggleVn={() => {
            setVnMode((v) => !v)
            setCollapsed(false) // on ne revient jamais du mode VN sur un panneau replié
          }}
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
            pinned={chatMeta?.pinned ?? null}
            onSaveEdit={handleEditMessage}
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
          />
        )}

        {!booting && character && chatMeta && !streaming && canRegen && (
          <div className="reply-actions">
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
          onSend={(text) => send(text).catch((e) => console.error('[send]', e))}
          onStop={stopStreaming}
        />
      </div>

      {dialog === 'settings' && settings && (
        <SettingsDialog settings={settings} onSaved={handleSettingsSaved} onClose={() => setDialog(null)} />
      )}
      {dialog === 'settings' && !settings && (
        <Dialog title={t('settings')} onClose={() => setDialog(null)}>
          <p className="hint">{t('settingsUnavailable')}</p>
        </Dialog>
      )}

      {dialog === 'chats' && character && (
        <ChatsDialog
          characterId={character.id}
          activeChatId={chatMeta?.id ?? null}
          onSelect={(chatId) => {
            openChat(character, chatId).catch((e) => console.error('[chats]', e))
          }}
          onDeleted={(chatId) => {
            handleChatDeleted(chatId).catch((e) => console.error('[chats]', e))
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
