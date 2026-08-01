// Zone de saisie : textarea auto-grandissante, Entrée = envoyer (desktop),
// Maj+Entrée = retour ligne, bouton stop pendant le streaming. Le trombone
// (images) n'apparaît QUE si le modèle sait lire une image — sinon aucun pixel
// n'est ajouté à l'interface. Même règle pour le micro (dictée) : sans API de
// reconnaissance vocale, le bouton n'existe pas. Taper « / » en tête de message
// ouvre le menu des commandes (/compact, /clean) — invisible tant qu'on ne le
// cherche pas.
import { useEffect, useMemo, useRef, useState } from 'react'
import { localeOf, useI18n, type Key } from '../i18n'

/** Nom d'une commande slash du composer. */
export type CommandName = 'compact' | 'clean'

interface Props {
  disabled: boolean
  streaming: boolean
  /** Le modèle configuré lit les images (GET /api/vision) : le trombone existe. */
  vision: boolean
  onSend: (text: string, images: string[]) => void
  /** Commande slash validée — arg = ce qui suit le nom (instruction de /compact). */
  onCommand: (name: CommandName, arg: string) => void
  /**
   * Flèche HAUT dans un champ vide : réflexe de terminal et de messagerie —
   * reprendre son dernier message. C'est le fil qui sait lequel et comment
   * l'éditer ; le composer se contente de le demander.
   */
  onEditLast: () => void
  /**
   * L'utilisateur est en train d'écrire, ou a cessé. Deux transitions
   * seulement, jamais une notification par frappe (cf. TYPING_IDLE_MS).
   * Le composer ne sait pas ce qu'on en fait — la scène, elle, y met le socle
   * d'écoute du personnage.
   */
  onTyping: (on: boolean) => void
  onStop: () => void
}

// Les DEUX commandes de Hanami — pas de framework de commandes, pas d'alias.
const COMMANDS: readonly { name: CommandName; hint: Key }[] = [
  { name: 'compact', hint: 'cmdCompactHint' },
  { name: 'clean', hint: 'cmdCleanHint' },
]

// « /comp » pendant la frappe (menu ouvert) ; l'espace ferme le menu, l'argument
// éventuel appartient à la commande. Multiligne exclu : une commande tient sur
// sa ligne, un message qui COMMENCE par « / » mais continue ailleurs part au modèle.
// /clear : synonyme muet de /clean (le réflexe des habitués de CLI) — accepté à
// l'exécution, jamais affiché dans le menu.
const TYPING_RE = /^\/([a-z]*)$/
const COMMAND_RE = /^\/(compact|clean|clear)(?:\s+([\s\S]*))?$/

/** Nom canonique d'une commande capturée par COMMAND_RE (résout les synonymes). */
function canonical(name: string): CommandName {
  return name === 'clear' ? 'clean' : (name as CommandName)
}

/**
 * Silence au clavier au-delà duquel « il écrit » cesse d'être vrai. Trois
 * secondes : assez pour couvrir le temps qu'on passe à chercher un mot (la
 * pause typique entre deux salves de frappe est sous la seconde), assez court
 * pour qu'un champ laissé à moitié rempli ne retienne pas le personnage en
 * écoute indéfiniment. Le champ VIDÉ, lui, coupe tout de suite : plus rien
 * n'est en train de s'écrire.
 */
const TYPING_IDLE_MS = 3000

// Plafonds côté client — le serveur les revalide (4 images, ~2 Mo chacune).
const MAX_IMAGES = 4
const MAX_SIDE = 1024 // grand côté après redimensionnement
const JPEG_QUALITY = 0.85
// Poids (en caractères de data URL, ~4/3 des octets réels) sous lequel un PNG
// est conservé en PNG : transparence gardée et captures d'écran nettes.
const PNG_KEEP_MAX = 200 * 1024

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('fichier illisible'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image illisible'))
    img.src = src
  })
}

/**
 * Redimensionne l'image choisie AVANT tout envoi : grand côté ≤ 1024 px, JPEG
 * qualité 0.85 (un PNG resté léger est conservé tel quel). Le fichier d'origine
 * ne quitte jamais le navigateur — seule la version réduite part au serveur.
 */
async function shrink(file: File): Promise<string> {
  const source = await readAsDataUrl(file)
  const img = await loadImage(source)
  const largest = Math.max(img.naturalWidth, img.naturalHeight)
  const scale = largest > MAX_SIDE ? MAX_SIDE / largest : 1
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return source // pas de canvas : l'original part tel quel
  ctx.drawImage(img, 0, 0, w, h)
  if (file.type === 'image/png') {
    const png = canvas.toDataURL('image/png')
    if (png.length < PNG_KEEP_MAX) return png
  }
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}

/* ── Dictée (Web Speech API) ───────────────────────────────────────────────
   L'API n'est pas dans le lib.dom de tous les tsc : on décrit ICI le strict
   minimum qu'on utilise (pas de `any`), et on la lit sur window — préfixe
   webkit compris, c'est celui de Chrome Android et de Safari. */

interface SpeechAlternative {
  readonly transcript: string
}

interface SpeechResult {
  readonly isFinal: boolean
  readonly length: number
  readonly [index: number]: SpeechAlternative
}

interface SpeechResultList {
  readonly length: number
  readonly [index: number]: SpeechResult
}

interface SpeechResultEvent {
  readonly results: SpeechResultList
}

interface SpeechRecognizer {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SpeechResultEvent) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognizerCtor = new () => SpeechRecognizer

/** Constructeur disponible, ou null — sans lui, aucun bouton micro n'est monté. */
function speechCtor(): SpeechRecognizerCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognizerCtor
    webkitSpeechRecognition?: SpeechRecognizerCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Colle la parole au texte déjà présent, avec une espace si elle manque. */
function joinSpoken(base: string, spoken: string): string {
  const said = spoken.replace(/^\s+/, '')
  if (!said) return base
  return base === '' || /\s$/.test(base) ? base + said : `${base} ${said}`
}

export default function Composer({
  disabled,
  streaming,
  vision,
  onSend,
  onCommand,
  onEditLast,
  onTyping,
  onStop,
}: Props) {
  const { t, lang } = useI18n()
  const [text, setText] = useState('')
  // Images en attente d'envoi (data URLs déjà réduites) — vidées à l'envoi.
  const [shots, setShots] = useState<string[]>([])
  // Menu des commandes : entrée surlignée (flèches) + fermeture explicite (Échap).
  const [cmdIndex, setCmdIndex] = useState(0)
  const [cmdClosed, setCmdClosed] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Sur mobile (pointeur grossier), Entrée fait un retour ligne : le bouton envoie.
  const coarse = useMemo(() => window.matchMedia('(pointer: coarse)').matches, [])
  // Dictée : le constructeur est cherché une seule fois — s'il manque, pas de micro.
  const Speech = useMemo(speechCtor, [])
  const [listening, setListening] = useState(false)
  const recRef = useRef<SpeechRecognizer | null>(null)
  // Texte présent au DÉMARRAGE de l'écoute : la transcription s'y ajoute, il se
  // fige à l'arrêt (l'écoute suivante repart du champ tel qu'il est alors).
  const baseRef = useRef('')

  // Démonter le composer coupe le micro : rien ne continue d'écouter dans le vide.
  useEffect(() => () => recRef.current?.abort(), [])

  // ── « Il est en train d'écrire » ───────────────────────────────────────────
  // Le callback est gardé dans une ref, PAS mis en dépendance de l'effet : le
  // parent le recrée à chaque rendu (fonction fléchée écrite sur place), et le
  // minuteur d'inactivité repartirait donc de zéro à chaque rendu de
  // l'application — y compris pendant qu'une réponse s'écrit, où il y en a un
  // par jeton reçu. Cet effet-ci est déclaré AVANT celui qui lit la ref : React
  // exécute les effets dans l'ordre de déclaration, la valeur est donc à jour.
  const typingCb = useRef(onTyping)
  useEffect(() => {
    typingCb.current = onTyping
  })

  // La dernière valeur ANNONCÉE : l'appelant reçoit deux transitions, pas une
  // notification par touche enfoncée.
  const typingRef = useRef(false)
  function emitTyping(on: boolean) {
    if (on === typingRef.current) return
    typingRef.current = on
    typingCb.current(on)
  }

  // Champ vide ↔ non vide, plus un minuteur d'inactivité relancé à chaque
  // frappe (`text` change à chaque touche, donc l'effet rejoue et le minuteur
  // précédent est annulé par le nettoyage).
  useEffect(() => {
    if (text === '') {
      emitTyping(false)
      return
    }
    emitTyping(true)
    const timer = window.setTimeout(() => emitTyping(false), TYPING_IDLE_MS)
    return () => window.clearTimeout(timer)
  }, [text])

  // Démontage (bascule vers le mode VN, fermeture) : on n'écrit plus.
  useEffect(() => () => emitTyping(false), [])

  // Commandes dont le nom commence par ce qui est tapé — « / » les montre toutes.
  const typing = TYPING_RE.exec(text)
  const cmdMatches = typing === null ? [] : COMMANDS.filter((c) => c.name.startsWith(typing[1]))
  const cmdOpen = !cmdClosed && cmdMatches.length > 0
  const cmdActive = Math.min(cmdIndex, cmdMatches.length - 1)

  /** Reprend le nom complet dans le champ (Tab) — pour argumenter /compact. */
  function pickCommand(name: CommandName) {
    setText(`/${name} `)
    setCmdIndex(0)
    taRef.current?.focus()
  }

  /** Exécute la commande surlignée, sans argument — « / » puis Entrée suffit. */
  function runCommand(name: CommandName) {
    if (disabled || streaming) return
    dropDictation()
    onCommand(name, '')
    setText('')
    setCmdIndex(0)
    requestAnimationFrame(() => {
      const el = taRef.current
      if (el) el.style.height = 'auto'
    })
  }

  function autosize() {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  /**
   * Micro : démarre l'écoute, ou la coupe si elle tourne déjà. Tout échec est
   * SILENCIEUX (micro refusé, réseau, aucune voix entendue) — le bouton cesse
   * simplement de pulser, aucun bandeau n'apparaît.
   */
  function toggleDictation() {
    const running = recRef.current
    if (running) {
      running.stop() // onend remet l'état à plat
      return
    }
    if (!Speech || disabled || streaming) return
    const rec = new Speech()
    rec.lang = localeOf(lang) // langue de l'interface : « fr-FR » ou « en-US »
    rec.continuous = false
    rec.interimResults = true
    baseRef.current = text
    rec.onresult = (e) => {
      // Le champ vaut toujours « base + ce qui a été dit » : les résultats
      // intermédiaires remplacent la portion en cours, jamais le texte tapé
      // avant l'écoute — et le dernier résultat (final) reste tel quel.
      let spoken = ''
      for (let i = 0; i < e.results.length; i++) spoken += e.results[i][0].transcript
      setText(joinSpoken(baseRef.current, spoken))
      requestAnimationFrame(autosize)
    }
    const finish = () => {
      recRef.current = null
      setListening(false)
    }
    rec.onerror = finish // onend suit normalement, mais l'état est nettoyé quoi qu'il arrive
    rec.onend = finish
    try {
      rec.start()
    } catch {
      return // start() refusé : rien n'a démarré, rien à nettoyer
    }
    recRef.current = rec
    setListening(true)
  }

  /** Coupe l'écoute et oublie sa base — le champ vient d'être vidé (envoi, commande). */
  function dropDictation() {
    baseRef.current = ''
    recRef.current?.abort() // abort() ne renvoie aucun résultat tardif
  }

  async function addFiles(files: FileList) {
    // Le plafond est calculé sur l'état COURANT à chaque ajout (les fichiers
    // arrivent après un await : setShots fonctionnel plus bas fait foi).
    const picked = Array.from(files).filter((f) => f.type.startsWith('image/'))
    for (const file of picked) {
      let url: string
      try {
        url = await shrink(file)
      } catch (e) {
        console.error('[images]', e)
        continue
      }
      setShots((s) => (s.length >= MAX_IMAGES ? s : [...s, url]))
    }
  }

  function submit() {
    const value = text.trim()
    if ((!value && shots.length === 0) || disabled || streaming) return
    // Commande complète → interceptée, jamais envoyée au modèle. Un « /xyz »
    // inconnu part comme du texte normal : seules NOS commandes sont happées.
    dropDictation()
    const cmd = COMMAND_RE.exec(value)
    if (cmd) onCommand(canonical(cmd[1]), (cmd[2] ?? '').trim())
    else onSend(value, shots)
    setText('')
    setShots([])
    requestAnimationFrame(() => {
      const el = taRef.current
      if (el) el.style.height = 'auto'
    })
  }

  return (
    <div className="composer">
      {/* Vignettes en attente : ligne complète AU-DESSUS du champ (la barre
          enveloppe), donc sans toucher à la mise en page du mode VN. */}
      {shots.length > 0 && (
        <div className="shots">
          {shots.map((url, i) => (
            <span className="shot" key={i}>
              <img src={url} alt={t('imageAlt')} />
              <button
                className="shot-remove"
                title={t('removeImage')}
                aria-label={t('removeImage')}
                onClick={() => setShots((s) => s.filter((_, j) => j !== i))}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {vision && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = e.target.files
              if (files) addFiles(files).catch((err) => console.error('[images]', err))
              e.target.value = '' // rechoisir le même fichier doit rester possible
            }}
          />
          <button
            className="icon-btn clip-btn"
            disabled={disabled || streaming || shots.length >= MAX_IMAGES}
            title={t('attachImage')}
            aria-label={t('attachImage')}
            onClick={() => fileRef.current?.click()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16.5 6.5l-7.6 7.6a2.5 2.5 0 003.5 3.5l7-7a4.5 4.5 0 00-6.4-6.4l-7 7a6.5 6.5 0 009.2 9.2l4.3-4.3" />
            </svg>
          </button>
        </>
      )}

      {/* Micro : n'existe que si le navigateur sait reconnaître la parole
          (téléphone, surtout). Contexte sécurisé requis — HTTPS ou localhost. */}
      {Speech && (
        <button
          className={`icon-btn mic-btn${listening ? ' listening' : ''}`}
          // On ne DÉMARRE pas pendant le streaming, mais une écoute déjà lancée
          // reste toujours interruptible.
          disabled={(disabled || streaming) && !listening}
          title={listening ? t('dictateListening') : t('dictate')}
          aria-label={listening ? t('dictateListening') : t('dictate')}
          aria-pressed={listening}
          onClick={toggleDictation}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3.5a2.6 2.6 0 012.6 2.6v5.4a2.6 2.6 0 01-5.2 0V6.1A2.6 2.6 0 0112 3.5z" />
            <path d="M6.6 11a5.4 5.4 0 0010.8 0" />
            <path d="M12 16.4v3.1M9.2 19.5h5.6" />
          </svg>
        </button>
      )}

      <textarea
        ref={taRef}
        rows={1}
        value={text}
        // Le champ AFFICHE court et s'ANNONCE long : « Écrire un message… »
        // demande 130,4 px et le champ n'en offre que 100 à 130 sur les mises en
        // page étroites (voir i18n) — il passait à la ligne et la deuxième
        // ligne était coupée. Le nom accessible, lui, ne coûte aucun pixel.
        placeholder={t('writeMessageShort')}
        aria-label={t('writeMessage')}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value)
          setCmdClosed(false) // toute frappe rouvre le menu s'il y a matière
          setCmdIndex(0)
          autosize()
        }}
        onKeyDown={(e) => {
          // Menu des commandes ouvert : les flèches naviguent, ENTRÉE EXÉCUTE la
          // commande surlignée (« / » puis Entrée suffit, comme un vrai CLI),
          // Tab complète le nom pour argumenter, Échap ferme sans toucher au texte.
          if (cmdOpen) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const delta = e.key === 'ArrowDown' ? 1 : -1
              setCmdIndex((cmdActive + delta + cmdMatches.length) % cmdMatches.length)
              return
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              runCommand(cmdMatches[cmdActive].name)
              return
            }
            if (e.key === 'Tab') {
              e.preventDefault()
              pickCommand(cmdMatches[cmdActive].name)
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation() // Échap appartient au menu, pas au mode VN
              setCmdClosed(true)
              return
            }
          }
          // Champ VIDE (aucun texte, aucune image en attente) : la flèche haut
          // rouvre son dernier message en édition. Le champ non vide garde son
          // comportement normal — le curseur y remonte d'une ligne.
          if (e.key === 'ArrowUp' && text === '' && shots.length === 0 && !disabled && !streaming) {
            e.preventDefault()
            onEditLast()
            return
          }
          if (e.key === 'Enter' && !e.shiftKey && !coarse) {
            e.preventDefault()
            submit()
          }
        }}
      />
      {/* Menu des commandes : au-dessus du champ, dans le flux du thème. */}
      {cmdOpen && (
        <div className="cmd-menu" role="listbox" aria-label={t('cmdMenuLabel')}>
          {cmdMatches.map((c, i) => (
            <button
              key={c.name}
              role="option"
              aria-selected={i === cmdActive}
              className={`cmd-item${i === cmdActive ? ' active' : ''}`}
              // onMouseDown : un clic ne doit pas d'abord voler le focus du
              // textarea — et il EXÉCUTE, comme Entrée (Tab argumente).
              onMouseDown={(e) => {
                e.preventDefault()
                runCommand(c.name)
              }}
            >
              <span className="cmd-name">/{c.name}</span>
              <span className="cmd-hint">{t(c.hint)}</span>
            </button>
          ))}
        </div>
      )}
      {streaming ? (
        <button className="send-btn stop" onClick={onStop} title={t('stop')} aria-label={t('stop')}>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
          </svg>
        </button>
      ) : (
        <button
          className="send-btn"
          onClick={submit}
          disabled={disabled || (!text.trim() && shots.length === 0)}
          title={t('send')}
          aria-label={t('send')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12l16-7-5.5 16-3-6.5L4 12z" />
            <path d="M11.5 14.5L20 5" />
          </svg>
        </button>
      )}
    </div>
  )
}
