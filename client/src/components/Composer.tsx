// Zone de saisie : textarea auto-grandissante, Entrée = envoyer (desktop),
// Maj+Entrée = retour ligne, bouton stop pendant le streaming. Le trombone
// (images) n'apparaît QUE si le modèle sait lire une image — sinon aucun pixel
// n'est ajouté à l'interface.
import { useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n'

interface Props {
  disabled: boolean
  streaming: boolean
  /** Le modèle configuré lit les images (GET /api/vision) : le trombone existe. */
  vision: boolean
  onSend: (text: string, images: string[]) => void
  onStop: () => void
}

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

export default function Composer({ disabled, streaming, vision, onSend, onStop }: Props) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  // Images en attente d'envoi (data URLs déjà réduites) — vidées à l'envoi.
  const [shots, setShots] = useState<string[]>([])
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Sur mobile (pointeur grossier), Entrée fait un retour ligne : le bouton envoie.
  const coarse = useMemo(() => window.matchMedia('(pointer: coarse)').matches, [])

  function autosize() {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
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
    onSend(value, shots)
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

      <textarea
        ref={taRef}
        rows={1}
        value={text}
        placeholder={t('writeMessage')}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value)
          autosize()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !coarse) {
            e.preventDefault()
            submit()
          }
        }}
      />
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
