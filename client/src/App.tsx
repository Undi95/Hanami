// Hanami — composant racine : boot, scène VRM, chat streaming, dialogs.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CharacterFull, CharacterMeta, ChatMessage, ChatMeta, Settings } from '../../shared/types'
import type { VrmStage } from './scene/types'
import * as api from './api'
import { extractEmotion } from './emotions'
import TopBar, { type DialogKind } from './components/TopBar'
import MessageList, { type FeedItem } from './components/MessageList'
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
const chatKey = (charId: string) => `hanami_chat_${charId}`

export default function App() {
  const [booting, setBooting] = useState(true)
  const [needLogin, setNeedLogin] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [characters, setCharacters] = useState<CharacterMeta[]>([])
  const [character, setCharacter] = useState<CharacterFull | null>(null)
  const [chatMeta, setChatMeta] = useState<ChatMeta | null>(null)
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [streaming, setStreaming] = useState(false)
  const [dialog, setDialog] = useState<DialogKind | null>(null)
  const [backendDown, setBackendDown] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [stageReady, setStageReady] = useState(false)

  const sceneRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<VrmStage | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const lastEmotionRef = useRef('neutral')

  // ── Helpers ──────────────────────────────────────────────────────────────

  const handleError = useCallback((e: unknown, tag: string) => {
    if (e instanceof api.AuthRequiredError) setNeedLogin(true)
    else console.error(`[${tag}]`, e)
  }, [])

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

  // ── Scène 3D (import lazy, contrat scene/types.ts) ───────────────────────

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { createVrmStage } = await import('./scene/vrmStage')
      if (cancelled || !sceneRef.current) return
      stageRef.current = createVrmStage(sceneRef.current)
      setStageReady(true)
    })().catch((e) => console.error('[vrm]', e))
    return () => {
      cancelled = true
      stageRef.current?.dispose()
      stageRef.current = null
    }
  }, [])

  // Changement de personnage (ou scène prête) → charger son modèle VRM.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !stageReady) return
    stage.loadModel(character?.vrm ?? '').catch((e) => console.error('[vrm]', e))
    stage.setEmotion(lastEmotionRef.current)
  }, [stageReady, character?.vrm])

  // ── Chargement personnage / chat ─────────────────────────────────────────

  async function openChat(char: CharacterFull, chatId: string) {
    abortRef.current?.abort()
    try {
      const { meta, messages } = await api.getChat(char.id, chatId)
      setChatMeta(meta)
      localStorage.setItem(chatKey(char.id), meta.id)
      const items: FeedItem[] = messages.map((m) => ({ kind: 'msg', msg: m }))
      if (items.length === 0 && char.greeting) items.push({ kind: 'greeting', text: char.greeting })
      setFeed(items)
      // Émotion d'ouverture : celle du greeting, sinon du dernier message assistant.
      let emotion: string | null = null
      if (messages.length === 0 && char.greeting) emotion = extractEmotion(char.greeting)
      else {
        const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
        if (lastAssistant) emotion = lastAssistant.emotion ?? extractEmotion(lastAssistant.content)
      }
      applyEmotion(emotion ?? 'neutral')
    } catch (e) {
      handleError(e, 'chat')
    }
  }

  async function selectCharacter(id: string) {
    try {
      const full = await api.getCharacter(id)
      setCharacter(full)
      localStorage.setItem(CHAR_KEY, id)
      const chats = await api.listChats(id)
      const savedChat = localStorage.getItem(chatKey(id))
      const meta = chats.find((c) => c.id === savedChat) ?? chats[0] ?? (await api.createChat(id))
      await openChat(full, meta.id)
    } catch (e) {
      handleError(e, 'perso')
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

  async function send(content: string) {
    const char = character
    const chat = chatMeta
    if (!char || !chat || streaming) return
    const userMsg: ChatMessage = { role: 'user', content, ts: new Date().toISOString() }
    const draft: ChatMessage = { role: 'assistant', content: '', ts: new Date().toISOString() }
    setFeed((f) => [...f, { kind: 'msg', msg: userMsg }, { kind: 'msg', msg: draft, pending: true }])

    const ac = new AbortController()
    abortRef.current = ac
    setStreaming(true)
    stageRef.current?.setSpeaking(true)
    let acc = ''
    let emotionFound = false
    let finished = false

    try {
      await api.streamChat({
        characterId: char.id,
        chatId: chat.id,
        content,
        signal: ac.signal,
        onEvent: (ev) => {
          if (ev.type === 'delta') {
            acc += ev.text
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
              if (em) applyEmotion(em)
            }
            setFeed((f) => f.map((it) => (it.kind === 'msg' && it.pending ? { kind: 'msg', msg: ev.message } : it)))
            setChatMeta((m) => (m ? { ...m, messageCount: m.messageCount + 2, updatedAt: ev.message.ts } : m))
          } else if (ev.type === 'error') {
            finished = true
            keepPartialDraft({ kind: 'error', text: ev.message })
          }
        },
      })
      if (!finished) keepPartialDraft({ kind: 'error', text: 'Réponse interrompue par le serveur.' })
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
      stageRef.current?.setSpeaking(false)
      abortRef.current = null
    }
  }

  function stopStreaming() {
    abortRef.current?.abort()
  }

  // ── Callbacks des dialogs ────────────────────────────────────────────────

  async function refreshCharacters(): Promise<CharacterMeta[]> {
    try {
      const chars = await api.listCharacters()
      setCharacters(chars)
      return chars
    } catch (e) {
      handleError(e, 'persos')
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
    try {
      const chats = await api.listChats(char.id)
      const next = chats[0] ?? (await api.createChat(char.id))
      await openChat(char, next.id)
    } catch (e) {
      handleError(e, 'chats')
    }
  }

  async function handleCharacterDeleted(id: string) {
    localStorage.removeItem(chatKey(id))
    const chars = await refreshCharacters()
    if (character?.id === id) {
      localStorage.removeItem(CHAR_KEY)
      const next = chars.find((c) => c.id !== id)
      if (next) await selectCharacter(next.id)
      else {
        setCharacter(null)
        setChatMeta(null)
        setFeed([])
      }
    }
  }

  // ── Rendu ────────────────────────────────────────────────────────────────

  if (needLogin) {
    return <LoginGate onDone={() => boot().catch((e) => console.error('[boot]', e))} />
  }

  return (
    <div className="app">
      <div
        ref={sceneRef}
        className="scene"
        aria-hidden="true"
        style={character?.background ? { backgroundImage: `url("${character.background}")` } : undefined}
      />

      <div className={`chat-panel${collapsed ? ' collapsed' : ''}`}>
        <button
          className="sheet-handle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Déplier le chat' : 'Replier le chat pour voir l’avatar'}
        >
          <span className="handle-bar" />
        </button>

        <TopBar
          characterName={character?.name ?? 'Hanami'}
          chatTitle={chatMeta?.title ?? ''}
          hasCharacter={!!character}
          hasChat={!!character && !!chatMeta}
          onOpen={setDialog}
        />

        {backendDown && settings && (
          <div className="banner" role="alert">
            <span>Backend LLM injoignable — vérifiez l'URL dans les réglages.</span>
            <button className="btn small" onClick={() => setDialog('settings')}>
              Réglages
            </button>
          </div>
        )}

        {booting ? (
          <div className="empty-state">
            <p>Chargement…</p>
          </div>
        ) : !character ? (
          <div className="empty-state">
            <h2>Bienvenue dans Hanami</h2>
            <p>Aucun personnage pour l'instant. Créez-en un, ou importez une carte SillyTavern.</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={() => setDialog('characters')}>
                Créer un personnage
              </button>
              <button className="btn" onClick={() => setDialog('import')}>
                Importer
              </button>
            </div>
          </div>
        ) : (
          <MessageList items={feed} />
        )}

        <Composer
          disabled={booting || !character || !chatMeta}
          streaming={streaming}
          onSend={(text) => send(text).catch((e) => console.error('[envoi]', e))}
          onStop={stopStreaming}
        />
      </div>

      {dialog === 'settings' && settings && (
        <SettingsDialog settings={settings} onSaved={handleSettingsSaved} onClose={() => setDialog(null)} />
      )}
      {dialog === 'settings' && !settings && (
        <Dialog title="Réglages" onClose={() => setDialog(null)}>
          <p className="hint">Réglages indisponibles (serveur injoignable).</p>
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
            if (id !== character?.id) selectCharacter(id).catch((e) => console.error('[perso]', e))
          }}
          onCreated={(c) => {
            refreshCharacters()
              .then(() => selectCharacter(c.id))
              .catch((e) => console.error('[persos]', e))
          }}
          onUpdated={(c) => {
            refreshCharacters().catch((e) => console.error('[persos]', e))
            if (character?.id === c.id) setCharacter(c)
          }}
          onDeleted={(id) => {
            handleCharacterDeleted(id).catch((e) => console.error('[persos]', e))
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
          onCharacterImported={() => {
            refreshCharacters().catch((e) => console.error('[import]', e))
          }}
          onChatsImported={() => {
            /* la liste des chats est rechargée à l'ouverture du dialog Conversations */
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'inspector' && character && chatMeta && (
        <PromptInspector characterId={character.id} chatId={chatMeta.id} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}
