// Personnages : grille de sélection, création, édition (prompt système inclus), suppression.
import { useEffect, useRef, useState } from 'react'
import type { AnimationFamily, CharacterFull, CharacterLlm, CharacterMeta, GreetingMode, Settings } from '../../../shared/types'
import * as api from '../api'
import { translate, useI18n } from '../i18n'
import { THEMES, THEME_LABELS } from '../themes'
import Dialog from './Dialog'
import Toggle from './Toggle'
import VoicePicker from './VoicePicker'
import SelectMenu, { type SelectOption } from './SelectMenu'

interface Props {
  characters: CharacterMeta[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreated: (c: CharacterFull) => void
  onUpdated: (c: CharacterFull) => void
  onDeleted: (id: string) => void
  onClose: () => void
  /**
   * La synthèse vocale est-elle disponible côté application (interrupteur des
   * Réglages allumé ET serveur renseigné) ? Le personnage garde son propre
   * interrupteur dans tous les cas — mais quand l'app est muette, le dire ici
   * évite de chercher pourquoi rien ne se lit.
   */
  ttsAvailable: boolean
  /**
   * Photo de la scène 3D en data URL PNG (contrat VrmStage.snapshot), branchée
   * par l'App. null/absent = aucun avatar 3D à l'écran : le bouton « Capturer le
   * modèle 3D » n'existe alors pas. Il n'apparaît de toute façon que pour le
   * personnage ACTIF — c'est le seul dont le modèle est affiché.
   */
  snapshotAvatar?: (() => string | null) | null
  /**
   * Réglages globaux de l'app : la section « Modèle (ce personnage) » en fait
   * des FILIGRANES (« Global : 0.8 ») — l'utilisateur voit sur quoi un champ
   * vide retombe. Le dialog ne les modifie jamais. Null tant que le chargement
   * du boot n'est pas revenu (les filigranes sont alors vides).
   */
  settings: Settings | null
}

type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; id: string }

interface FormState {
  name: string
  vrm: string
  background: string
  environment: string // '' = pas de décor 3D (fond 2D)
  theme: string // '' = thème de l'app
  animations: AnimationFamily // famille de face à face ('overte' = le défaut)
  greeting: string
  greetings: string[]
  greetingMode: GreetingMode
  systemPrompt: string
  ttsEnabled: boolean
  ttsVoice: string
  // Persona utilisateur épinglée : '' = la persona par défaut des Réglages.
  userPersona: string
  // Overrides de génération : chaînes de formulaire, '' = réglage global
  // (le filigrane du champ affiche la valeur d'origine).
  llmModel: string
  llmModelMode: '' | 'full' | 'simple'
  llmTemperature: string
  llmMaxTokens: string
  llmMaxHistory: string
  llmContextSize: string
  llmCompactThreshold: string
}

const EMPTY_FORM: FormState = {
  name: '',
  vrm: '',
  background: '',
  environment: '',
  theme: '',
  animations: 'overte',
  greeting: '',
  greetings: [],
  greetingMode: 'written',
  systemPrompt: '',
  // Voix : éteinte par défaut, comme pour tout personnage qui n'a rien demandé.
  ttsEnabled: false,
  ttsVoice: '',
  // Persona : vide = la défaut des Réglages (le comportement d'origine).
  userPersona: '',
  // Overrides : tout est vide = tout est global (le comportement d'origine).
  llmModel: '',
  llmModelMode: '',
  llmTemperature: '',
  llmMaxTokens: '',
  llmMaxHistory: '',
  llmContextSize: '',
  llmCompactThreshold: '',
}

const GREETING_MODES: readonly GreetingMode[] = ['written', 'generated', 'ask']
/** Overte en tête : c'est le défaut, et il le reste. */
const ANIMATION_FAMILIES: readonly AnimationFamily[] = ['overte', 'rocketbox']

function basename(url: string): string {
  return url.split('/').pop() ?? url
}

/** Nom lisible d'un fichier servi par l'API : URL décodée (%20 → espace), sans extension. */
function displayName(url: string): string {
  let name = basename(url)
  try {
    name = decodeURIComponent(name)
  } catch {
    /* séquence % invalide : on garde le nom brut */
  }
  return name.replace(/\.[^.]+$/, '')
}

/**
 * Options d'une liste de fichiers servis par l'API : l'entrée « aucun » en tête
 * (valeur vide), puis les fichiers — et la valeur courante si le serveur ne la
 * propose plus (fichier renommé/déplacé), pour ne pas l'effacer en silence.
 */
function fileOptions(noneLabel: string, current: string, urls: string[]): SelectOption[] {
  const opts: SelectOption[] = [{ value: '', label: noneLabel }]
  if (current && !urls.includes(current)) opts.push({ value: current, label: displayName(current) })
  for (const url of urls) opts.push({ value: url, label: displayName(url) })
  return opts
}

/**
 * Options du menu de MODÈLES : l'entrée « global » en tête (valeur vide), puis
 * les modèles sondés chez le backend, et la valeur courante si la sonde ne la
 * propose plus (modèle renommé côté backend) — pour ne pas l'effacer en
 * silence. PAS `displayName` ici : un nom de modèle (« qwen2.5:7b ») n'est pas
 * un fichier, il n'a ni extension à retirer ni % à décodérer.
 */
function modelOptions(current: string, models: string[]): SelectOption[] {
  const opts: SelectOption[] = [{ value: '', label: translate('llmUseGlobal') }]
  if (current && !models.includes(current)) opts.push({ value: current, label: current })
  for (const m of models) opts.push({ value: m, label: m })
  return opts
}

/** Teinte stable dérivée de l'id — pour la pastille du personnage. */
export function pastilleHue(id: string): number {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

/**
 * Vignette d'un personnage : l'image si elle existe (photo, sinon portrait de la
 * card — la cascade est décidée par l'appelant), sinon l'initiale teintée.
 */
function Thumb({ id, name, src }: { id: string; name: string; src: string }) {
  if (src) return <img className="pastille-image" src={src} alt="" aria-hidden="true" />
  return (
    <span className="pastille" style={{ background: `hsl(${pastilleHue(id)} 55% 74%)` }} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

// ── Photo : fabrication du carré côté client ───────────────────────────────
// La photo est une VIGNETTE : 512 px suffisent, au-delà on stockerait des pixels
// que personne ne verra jamais.
const PHOTO_SIZE = 512

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(translate('photoUnreadable')))
    img.src = src
  })
}

/**
 * Recadre une image en CARRÉ CENTRAL (côté = min(largeur, hauteur)) et la réduit
 * à 512 px au plus, en PNG. Jamais d'agrandissement, jamais de déformation : la
 * photo est « ce qu'on voit », simplement rognée sur ses bords longs.
 */
async function toSquarePng(src: string): Promise<Blob> {
  const img = await loadImage(src)
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  if (side < 1) throw new Error(translate('photoUnreadable'))
  const size = Math.min(PHOTO_SIZE, side)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(translate('photoUnreadable'))
  const x = (img.naturalWidth - side) / 2
  const y = (img.naturalHeight - side) / 2
  ctx.drawImage(img, x, y, side, side, 0, 0, size, size)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(translate('photoUnreadable')))),
      'image/png',
    )
  })
}

/** Même recadrage, depuis un fichier choisi : l'original ne quitte pas le navigateur. */
async function fileToSquarePng(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    return await toSquarePng(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export default function CharactersDialog({
  characters,
  activeId,
  onSelect,
  onCreated,
  onUpdated,
  onDeleted,
  onClose,
  ttsAvailable,
  snapshotAvatar,
  settings,
}: Props) {
  const { t } = useI18n()
  const [view, setView] = useState<View>({ kind: 'list' })
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  // État initial du formulaire (création ou édition) — sert à détecter les saisies non enregistrées.
  const [initialForm, setInitialForm] = useState<FormState>(EMPTY_FORM)
  const [vrms, setVrms] = useState<string[]>([])
  const [bgs, setBgs] = useState<string[]>([])
  const [envs, setEnvs] = useState<string[]>([])
  // Modèles offerts par le backend (sonde du réglage global) — le menu des
  // overrides propose la même liste : le backend ne change pas avec le perso.
  const [models, setModels] = useState<string[]>([])
  // Portrait 2D du personnage édité : HORS du formulaire, car il ne s'édite pas
  // ici (l'import de la card le pose, le serveur le conserve d'une édition à
  // l'autre) — il se montre seulement, tant qu'aucun modèle 3D ne le remplace.
  const [portrait, setPortrait] = useState('')
  // Photo du personnage édité : HORS du formulaire elle aussi — elle se pose et
  // se retire par ses propres routes, immédiatement, comme le dépôt d'un fond.
  const [photo, setPhoto] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [armed, setArmed] = useState(false)
  // Dépôt d'un fond : état à part de `busy` (qui, lui, affiche « Enregistrement… »).
  const bgFileRef = useRef<HTMLInputElement>(null)
  const [bgBusy, setBgBusy] = useState(false)
  // Idem pour les actions photo : elles ne bloquent pas le bouton Enregistrer.
  const photoFileRef = useRef<HTMLInputElement>(null)
  const [photoBusy, setPhotoBusy] = useState(false)

  useEffect(() => {
    if (view.kind === 'list') return
    api.getVrmModels().then(setVrms).catch((e) => console.error('[characters]', e))
    api.getBackgrounds().then(setBgs).catch((e) => console.error('[characters]', e))
    api.getEnvironments().then(setEnvs).catch((e) => console.error('[characters]', e))
    // La sonde peut échouer (backend éteint) : le menu garde alors son entrée
    // « global » et la valeur courante — les champs restent remplissables à la main.
    api.getModels().then(setModels).catch((e) => console.error('[characters]', e))
  }, [view.kind])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // Filigrane des overrides : « Global : X » — vide si les réglages n'ont pas
  // encore chargé (le champ reste utilisable, il retombe sur le global).
  const globalPh = (v: number | undefined): string =>
    settings && v !== undefined ? t('llmGlobal', { value: String(v) }) : ''

  function backToList() {
    setView({ kind: 'list' })
    setForm(EMPTY_FORM)
    setInitialForm(EMPTY_FORM)
    setPortrait('')
    setPhoto('')
    setError(null)
    setArmed(false)
  }

  /**
   * Exporte un personnage en character card. Le SERVEUR décide de la forme :
   * PNG quand le personnage a une image (sa photo, sinon le portrait de la card
   * dont il vient), .json sinon — et il annonce nom et type dans ses en-têtes.
   * Le fichier est offert au navigateur par un <a download> créé à la volée,
   * comme la sauvegarde des Réglages et l'export d'une conversation.
   */
  async function exportCharacter(c: CharacterMeta) {
    try {
      const { blob, filename } = await api.downloadCharacterCard(c.id, c.name)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      // Dans le document : Firefox ignore le clic d'un lien détaché.
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      setError(api.errorMessage(e))
    }
  }

  async function openEdit(id: string) {
    setError(null)
    setArmed(false)
    try {
      const c = await api.getCharacter(id)
      const f: FormState = {
        name: c.name,
        vrm: c.vrm,
        background: c.background,
        environment: c.environment ?? '',
        theme: c.theme ?? '',
        // Clé absente = le défaut historique, et c'est le cas de tous les
        // personnages écrits avant ce réglage.
        animations: c.animations ?? 'overte',
        greeting: c.greeting,
        greetings: c.greetings ?? [],
        greetingMode: c.greetingMode ?? 'written',
        systemPrompt: c.systemPrompt,
        ttsEnabled: c.ttsEnabled === true,
        ttsVoice: c.ttsVoice ?? '',
        // Persona épinglée : clé absente = la défaut des Réglages, donc formulaire vide.
        userPersona: c.userPersona ?? '',
        // Overrides : champ absent = réglage global, donc formulaire vide.
        llmModel: c.llm?.model ?? '',
        llmModelMode: c.llm?.modelMode ?? '',
        llmTemperature: c.llm?.temperature !== undefined ? String(c.llm.temperature) : '',
        llmMaxTokens: c.llm?.maxTokens !== undefined ? String(c.llm.maxTokens) : '',
        llmMaxHistory: c.llm?.maxHistoryMessages !== undefined ? String(c.llm.maxHistoryMessages) : '',
        llmContextSize: c.llm?.contextSize !== undefined ? String(c.llm.contextSize) : '',
        llmCompactThreshold: c.llm?.compactThreshold !== undefined ? String(c.llm.compactThreshold) : '',
      }
      setForm(f)
      setInitialForm(f)
      setPortrait(c.portrait ?? '')
      setPhoto(c.photo ?? '')
      setView({ kind: 'edit', id })
    } catch (e) {
      setError(api.errorMessage(e))
    }
  }

  // Saisies non enregistrées dans le formulaire de création/édition. Le tableau
  // des variantes n'est recréé qu'à la modification : comparer les références suffit.
  const dirty =
    view.kind !== 'list' && (Object.keys(form) as (keyof FormState)[]).some((k) => form[k] !== initialForm[k])

  // ── Fond d'écran déposé depuis l'UI ────────────────────────────────────────

  /** Envoie l'image, recharge la liste des fonds et sélectionne le nouveau. */
  async function addBackground(file: File) {
    setBgBusy(true)
    setError(null)
    try {
      // Le serveur nettoie le nom et gère les collisions : l'URL renvoyée fait foi.
      const url = await api.uploadBackground(file)
      set('background', url)
      setBgs(await api.getBackgrounds())
    } catch (e) {
      setError(api.errorMessage(e))
    } finally {
      setBgBusy(false)
    }
  }

  // ── Photo du personnage ────────────────────────────────────────────────────
  // Les trois actions s'appliquent TOUT DE SUITE côté serveur (la photo n'est pas
  // un champ du formulaire) : `work` renvoie la nouvelle URL — '' quand on retire.
  // L'état local suit, et onUpdated fait remonter le personnage rafraîchi à l'App,
  // qui recharge la liste (donc les vignettes de la grille).

  async function runPhoto(work: (id: string) => Promise<string>) {
    if (view.kind !== 'edit') return
    const id = view.id
    setPhotoBusy(true)
    setError(null)
    try {
      setPhoto(await work(id))
      onUpdated(await api.getCharacter(id))
    } catch (e) {
      setError(api.errorMessage(e))
    } finally {
      setPhotoBusy(false)
    }
  }

  /** Capture le modèle 3D tel qu'il est cadré à l'écran, recadré en carré. */
  function capturePhoto() {
    return runPhoto(async (id) => {
      const shot = snapshotAvatar?.() ?? null
      // Le modèle a pu être déchargé entre l'ouverture du dialog et le clic.
      if (!shot) throw new Error(t('photoNoModel'))
      return api.uploadCharacterPhoto(id, await toSquarePng(shot))
    })
  }

  /** Image envoyée par l'utilisateur — recadrée en carré 512 avant l'envoi. */
  function uploadPhoto(file: File) {
    return runPhoto(async (id) => api.uploadCharacterPhoto(id, await fileToSquarePng(file)))
  }

  function removePhoto() {
    return runPhoto(async (id) => {
      await api.deleteCharacterPhoto(id)
      return ''
    })
  }

  // ── Variantes du message d'accueil ─────────────────────────────────────────

  function setVariant(i: number, value: string) {
    setForm((f) => ({ ...f, greetings: f.greetings.map((g, j) => (j === i ? value : g)) }))
  }

  function addVariant() {
    setForm((f) => ({ ...f, greetings: [...f.greetings, ''] }))
  }

  function removeVariant(i: number) {
    setForm((f) => ({ ...f, greetings: f.greetings.filter((_, j) => j !== i) }))
  }

  /**
   * Assemble les overrides depuis le formulaire : seuls les champs remplis
   * passent. Un objet vide = tout retombe sur le réglage global — à la création
   * on n'envoie alors rien, à l'édition on envoie `null` (qui RETIRE la clé).
   * Les nombres invalides sont écartés sans bloquer (le champ reste modifiable).
   */
  function llmFromForm(): CharacterLlm {
    const out: CharacterLlm = {}
    if (form.llmModel.trim()) out.model = form.llmModel.trim()
    if (form.llmModelMode) out.modelMode = form.llmModelMode
    const t = Number(form.llmTemperature)
    if (form.llmTemperature.trim() !== '' && Number.isFinite(t) && t >= 0) out.temperature = t
    for (const [key, field] of [
      ['maxTokens', 'llmMaxTokens'],
      ['maxHistoryMessages', 'llmMaxHistory'],
      ['contextSize', 'llmContextSize'],
      ['compactThreshold', 'llmCompactThreshold'],
    ] as const) {
      const v = form[field].trim()
      const n = Number(v)
      if (v !== '' && Number.isFinite(n) && n >= 0) out[key] = Math.round(n)
    }
    return out
  }

  async function submit() {
    if (!form.name.trim()) {
      setError(t('nameRequired'))
      return
    }
    setBusy(true)
    setError(null)
    // Les variantes laissées vides ne sont pas enregistrées. Le message d'accueil
    // et ses variantes sont conservés même en mode « généré » (simplement masqués) :
    // repasser en « écrit » les retrouve intacts.
    const greetings = form.greetings.filter((g) => g.trim().length > 0)
    const llm = llmFromForm()
    try {
      if (view.kind === 'create') {
        const c = await api.createCharacter({
          name: form.name.trim(),
          vrm: form.vrm,
          background: form.background,
          environment: form.environment,
          theme: form.theme,
          animations: form.animations,
          greeting: form.greeting,
          greetings,
          greetingMode: form.greetingMode,
          ttsEnabled: form.ttsEnabled,
          ttsVoice: form.ttsVoice.trim(),
          // Vide = la persona par défaut des Réglages : pas de clé dans le fichier.
          ...(form.userPersona.trim() ? { userPersona: form.userPersona } : {}),
          // Vide = tout est global : la clé `llm` n'entre pas dans le fichier.
          ...(Object.keys(llm).length > 0 ? { llm } : {}),
          // Vide = le serveur écrit son prompt par défaut. Ce n'est PAS un repli
          // silencieux : le champ est proposé, ne rien y mettre est un choix.
          ...(form.systemPrompt.trim() ? { systemPrompt: form.systemPrompt } : {}),
        })
        onCreated(c)
        backToList()
      } else if (view.kind === 'edit') {
        const c = await api.updateCharacter(view.id, {
          name: form.name.trim(),
          vrm: form.vrm,
          background: form.background,
          environment: form.environment,
          theme: form.theme,
          animations: form.animations,
          greeting: form.greeting,
          greetings,
          greetingMode: form.greetingMode,
          ttsEnabled: form.ttsEnabled,
          ttsVoice: form.ttsVoice.trim(),
          systemPrompt: form.systemPrompt,
          // '' = dé-épingle (le serveur retire la clé) : la persona par défaut
          // des Réglages s'applique à nouveau.
          userPersona: form.userPersona,
          // `null` explicite : le formulaire a tout vidé = retour au global
          // (la clé `llm` doit DISPARAÎTRE — un `undefined` ne ferait que
          // conserver l'ancien objet, cf. storage.updateCharacter).
          llm: Object.keys(llm).length > 0 ? llm : null,
        })
        onUpdated(c)
        backToList()
      }
    } catch (e) {
      setError(api.errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (view.kind !== 'edit') return
    if (!armed) {
      setArmed(true)
      return
    }
    setBusy(true)
    try {
      await api.deleteCharacter(view.id)
      onDeleted(view.id)
      backToList()
    } catch (e) {
      setError(api.errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const title =
    view.kind === 'list' ? t('characters') : view.kind === 'create' ? t('newCharacter') : t('editCharacter')

  return (
    <Dialog
      title={title}
      onClose={onClose}
      guardClose={() => !dirty || window.confirm(t('unsavedConfirm'))}
      wide={view.kind === 'edit'}
      footer={
        view.kind === 'list' ? (
          <button className="btn primary" onClick={() => setView({ kind: 'create' })}>
            {t('newCharacter')}
          </button>
        ) : (
          <>
            <button className="btn" onClick={backToList} disabled={busy}>
              {t('cancel')}
            </button>
            <button className="btn primary" onClick={() => submit().catch((e) => console.error('[characters]', e))} disabled={busy}>
              {busy ? t('saving') : view.kind === 'create' ? t('create') : t('save')}
            </button>
          </>
        )
      }
    >
      {error && <p className="msg-err">{error}</p>}

      {view.kind === 'list' && (
        characters.length === 0 ? (
          <p className="hint">{t('charactersEmpty')}</p>
        ) : (
          <div className="char-grid">
            {characters.map((c) => (
              <div key={c.id} className={`char-card${c.id === activeId ? ' active' : ''}`} onClick={() => { onSelect(c.id); onClose() }}>
                {/* Cascade : photo → portrait de la card → initiale teintée. */}
                <Thumb id={c.id} name={c.name} src={c.photo || c.portrait || ''} />
                <span className="char-name">{c.name}</span>
                <div className="char-actions">
                  <button
                    className="btn small"
                    onClick={(e) => {
                      e.stopPropagation()
                      openEdit(c.id).catch((err) => console.error('[characters]', err))
                    }}
                  >
                    {t('edit')}
                  </button>
                  {/* Emporter UN personnage : l'archive des Réglages sauvegarde
                      tout et ne se relit qu'ici — une card, elle, se donne, se
                      range, et se relit partout (à commencer par notre propre
                      import). Même flèche que l'export d'une conversation. */}
                  <button
                    className="btn small"
                    title={t('exportCharacter')}
                    aria-label={t('exportCharacter')}
                    onClick={(e) => {
                      e.stopPropagation()
                      exportCharacter(c).catch((err) => console.error('[characters]', err))
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 4v10m0 0l-3.6-3.6M12 14l3.6-3.6" />
                      <path d="M5 16.5v2a1.8 1.8 0 001.8 1.8h10.4A1.8 1.8 0 0019 18.5v-2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {view.kind !== 'list' && (
        <>
          <div className="field">
            <label htmlFor="char-name">{t('name')}</label>
            <input id="char-name" type="text" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="char-vrm">{t('vrmModel')}</label>
              {/* Menu maison : ces deux listes dépassent vite la vingtaine
                  d'entrées, et le popup natif d'un <select> garde une barre de
                  défilement blanche (contrôle système). */}
              <SelectMenu
                id="char-vrm"
                value={form.vrm}
                options={fileOptions(t('noModel'), form.vrm, vrms)}
                onChange={(v) => set('vrm', v)}
              />
            </div>
            <div className="field">
              <label htmlFor="char-bg">{t('background')}</label>
              {/* Le « + » dépose une image dans backgrounds/ : plus besoin
                  d'ouvrir l'explorateur de fichiers de la machine serveur. */}
              <div className="pick-row">
                <SelectMenu
                  id="char-bg"
                  value={form.background}
                  options={fileOptions(t('defaultGradient'), form.background, bgs)}
                  onChange={(v) => set('background', v)}
                />
                <input
                  ref={bgFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = '' // rechoisir le même fichier doit rester possible
                    if (f) addBackground(f).catch((err) => console.error('[characters]', err))
                  }}
                />
                <button
                  className="btn"
                  type="button"
                  disabled={bgBusy}
                  title={t('addBackground')}
                  aria-label={t('addBackground')}
                  onClick={() => bgFileRef.current?.click()}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
          {/* Décor 3D : pleine largeur (les noms de fichiers de décors sont
              longs), et pas de bouton d'ajout — un .glb ne se reconnaît pas à
              ses octets comme une image, il se dépose dans environments/. */}
          <div className="field">
            <label htmlFor="char-env">{t('environment')}</label>
            <SelectMenu
              id="char-env"
              value={form.environment}
              options={fileOptions(t('noEnvironment'), form.environment, envs)}
              onChange={(v) => set('environment', v)}
            />
            <span className="hint">{t('environmentHint')}</span>
          </div>
          {/* Portrait 2D : montré seulement quand il sert, c'est-à-dire sans
              modèle 3D. Choisir un VRM dans la liste au-dessus fait disparaître
              la vignette — l'avatar reprend la scène. */}
          {portrait !== '' && form.vrm === '' && (
            <div className="field">
              <label>{t('portrait')}</label>
              <div className="portrait-thumb">
                <img src={portrait} alt="" />
                <span className="hint">{t('portraitHint')}</span>
              </div>
            </div>
          )}
          {/* Photo : la vignette du personnage dans la grille. Deux sources — une
              capture du modèle 3D tel qu'il est cadré à l'écran, ou une image
              envoyée. Réservé à l'édition : les routes ont besoin d'un id, et un
              personnage en cours de création n'en a pas encore. */}
          {view.kind === 'edit' && (
            <div className="field">
              <label>{t('photo')}</label>
              <div className="photo-block">
                <Thumb id={view.id} name={form.name} src={photo || portrait} />
                <div className="photo-actions">
                  {/* Capture proposée pour le seul personnage ACTIF, et seulement
                      quand l'App confirme qu'un avatar 3D est bien à l'écran. */}
                  {view.id === activeId && snapshotAvatar != null && (
                    <button
                      className="btn small"
                      type="button"
                      disabled={photoBusy}
                      title={t('photoCaptureHint')}
                      onClick={() => capturePhoto().catch((e) => console.error('[characters]', e))}
                    >
                      {t('photoCapture')}
                    </button>
                  )}
                  <input
                    ref={photoFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = '' // rechoisir le même fichier doit rester possible
                      if (f) uploadPhoto(f).catch((err) => console.error('[characters]', err))
                    }}
                  />
                  <button
                    className="btn small"
                    type="button"
                    disabled={photoBusy}
                    onClick={() => photoFileRef.current?.click()}
                  >
                    {t('photoUpload')}
                  </button>
                  {photo !== '' && (
                    <button
                      className="btn small"
                      type="button"
                      disabled={photoBusy}
                      onClick={() => removePhoto().catch((e) => console.error('[characters]', e))}
                    >
                      {t('photoRemove')}
                    </button>
                  )}
                </div>
              </div>
              <span className="hint">{t('photoHint')}</span>
            </div>
          )}
          <div className="field">
            <label htmlFor="char-theme">{t('theme')}</label>
            {/* Toute l'app prend les couleurs de ce personnage tant qu'il est actif. */}
            <select id="char-theme" value={form.theme} onChange={(e) => set('theme', e.target.value)}>
              <option value="">{t('themeAppDefault')}</option>
              {THEMES.map((id) => (
                <option key={id} value={id}>
                  {t(THEME_LABELS[id])}
                </option>
              ))}
              <option value="custom">{t('themeCustom')}</option>
            </select>
          </div>
          {/* GESTUELLE — deux bibliothèques complètes et ÉTANCHES (vrma/README.md).
              Overte est le défaut, et le reste : un personnage qui n'a jamais
              touché ce réglage n'a pas la clé dans son character.json. */}
          <div className="field">
            <label>{t('characterAnimations')}</label>
            {/* .field est une colonne flex : ce bloc empêche le sélecteur de s'étirer. */}
            <div>
              <div className="seg" role="group" aria-label={t('characterAnimations')}>
                {ANIMATION_FAMILIES.map((fam) => (
                  <button
                    key={fam}
                    type="button"
                    className="seg-btn"
                    aria-pressed={form.animations === fam}
                    onClick={() => set('animations', fam)}
                  >
                    {fam === 'overte' ? t('animOverte') : t('animRocketbox')}
                  </button>
                ))}
              </div>
            </div>
            <span className="hint">{t('characterAnimationsHint')}</span>
          </div>
          {/* VOIX DU PERSONNAGE — chaque personnage a la sienne, c'est le propre
              d'une voix. Éteinte par défaut, ici comme pour tous ceux qui
              existaient avant. Le serveur de synthèse, lui, reste dans les
              Réglages : c'est le moteur, pas la voix. */}
          <Toggle
            label={t('characterTts')}
            sub={ttsAvailable ? t('characterTtsSub') : t('characterTtsOffGlobally')}
            checked={form.ttsEnabled}
            onChange={(v) => set('ttsEnabled', v)}
          />
          {form.ttsEnabled && (
            <div className="field">
              <label htmlFor="char-voice">{t('characterVoice')}</label>
              {/* Même sonde et mêmes pastilles que les Réglages (VoicePicker) —
                  ici sur le serveur ENREGISTRÉ : on n'en règle pas un second. */}
              <VoicePicker url="" value={form.ttsVoice} onPick={(v) => set('ttsVoice', v)}>
                <input
                  id="char-voice"
                  type="text"
                  value={form.ttsVoice}
                  placeholder={t('characterVoicePlaceholder')}
                  style={{ flex: 1, minWidth: 0 }}
                  onChange={(e) => set('ttsVoice', e.target.value)}
                />
              </VoicePicker>
              <span className="hint">{t('characterVoiceHint')}</span>
            </div>
          )}

          {/* MODÈLE DU PERSONNAGE — overrides posés par-dessus les réglages
              globaux : un champ vide retombe sur la valeur globale (le
              filigrane l'affiche). Le backend et la clé API restent globaux :
              c'est le moteur de la maison, pas la propriété du personnage. */}
          <div className="field">
            <label>{t('llmSection')}</label>
            <span className="hint">{t('llmSectionHint')}</span>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="char-llm-model">{t('model')}</label>
                <SelectMenu
                  id="char-llm-model"
                  value={form.llmModel}
                  options={modelOptions(form.llmModel, models)}
                  onChange={(v) => set('llmModel', v)}
                />
              </div>
              <div className="field">
                <label>{t('modelMode')}</label>
                {/* .field est une colonne flex : ce bloc empêche le sélecteur de s'étirer. */}
                <div>
                  <div className="seg" role="group" aria-label={t('modelMode')}>
                    {(
                      [
                        ['', t('llmModeGlobal')],
                        ['full', t('modelModeFull')],
                        ['simple', t('modelModeSimple')],
                      ] as const
                    ).map(([v, label]) => (
                      <button
                        key={v === '' ? 'global' : v}
                        type="button"
                        className="seg-btn"
                        aria-pressed={form.llmModelMode === v}
                        onClick={() => set('llmModelMode', v)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="char-llm-temp">{t('temperature')}</label>
                <input
                  id="char-llm-temp"
                  type="number"
                  step="0.1"
                  min="0"
                  value={form.llmTemperature}
                  onChange={(e) => set('llmTemperature', e.target.value)}
                  placeholder={globalPh(settings?.temperature)}
                />
              </div>
              <div className="field">
                <label htmlFor="char-llm-maxtokens">{t('maxTokens')}</label>
                <input
                  id="char-llm-maxtokens"
                  type="number"
                  step="1"
                  min="0"
                  value={form.llmMaxTokens}
                  onChange={(e) => set('llmMaxTokens', e.target.value)}
                  placeholder={globalPh(settings?.maxTokens)}
                />
              </div>
              <div className="field">
                <label htmlFor="char-llm-history">{t('maxHistory')}</label>
                <input
                  id="char-llm-history"
                  type="number"
                  step="1"
                  min="0"
                  value={form.llmMaxHistory}
                  onChange={(e) => set('llmMaxHistory', e.target.value)}
                  placeholder={globalPh(settings?.maxHistoryMessages)}
                />
              </div>
              <div className="field">
                <label htmlFor="char-llm-context">{t('contextSize')}</label>
                <input
                  id="char-llm-context"
                  type="number"
                  step="1"
                  min="0"
                  value={form.llmContextSize}
                  onChange={(e) => set('llmContextSize', e.target.value)}
                  placeholder={globalPh(settings?.contextSize)}
                />
              </div>
              <div className="field">
                <label htmlFor="char-llm-compact">{t('compactThreshold')}</label>
                <input
                  id="char-llm-compact"
                  type="number"
                  step="1"
                  min="0"
                  value={form.llmCompactThreshold}
                  onChange={(e) => set('llmCompactThreshold', e.target.value)}
                  placeholder={globalPh(settings?.compactThreshold)}
                />
              </div>
            </div>
          </div>

          {/* PERSONNA UTILISATEUR — qui est l'utilisateur FACE À CE PERSONNAGE :
              l'épinglage surpasse la persona par défaut des Réglages. La
              collection (ajout, suppression, choix du défaut) se gère dans
              Réglages → « Vous » ; ici on ne fait que désigner. */}
          <div className="field">
            <label htmlFor="char-persona">{t('charPersona')}</label>
            <SelectMenu
              id="char-persona"
              value={form.userPersona}
              options={[
                { value: '', label: t('charPersonaDefault') },
                ...(settings?.userPersonas ?? []).map((p) => ({ value: p.id, label: p.name || p.id })),
              ]}
              onChange={(v) => set('userPersona', v)}
            />
            <span className="hint">{t('charPersonaHint')}</span>
          </div>

          <div className="field">
            <label>{t('greetingMode')}</label>
            {/* .field est une colonne flex : ce bloc empêche le sélecteur de s'étirer. */}
            <div>
              <div className="seg" role="group" aria-label={t('greetingMode')}>
                {GREETING_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className="seg-btn"
                    aria-pressed={form.greetingMode === mode}
                    onClick={() => set('greetingMode', mode)}
                  >
                    {mode === 'written'
                      ? t('greetingModeWritten')
                      : mode === 'generated'
                        ? t('greetingModeGenerated')
                        : t('greetingModeAsk')}
                  </button>
                ))}
              </div>
            </div>
            <span className="hint">{t('greetingModeSub')}</span>
          </div>

          {/* Mode « généré » : le modèle écrit le premier message — les textes
              écrits sont masqués (conservés en base, jamais utilisés). */}
          {form.greetingMode !== 'generated' && (
            <>
              <div className="field">
                <label htmlFor="char-greeting">{t('greeting')}</label>
                <textarea
                  id="char-greeting"
                  value={form.greeting}
                  onChange={(e) => set('greeting', e.target.value)}
                  placeholder={t('greetingPlaceholder')}
                />
                <span className="hint">{t('greetingHint')}</span>
              </div>
              <div className="field">
                <label>{t('greetingVariants')}</label>
                {form.greetings.length > 0 && (
                  <div className="variant-list">
                    {/* Clé = index : les variantes n'ont pas d'identité propre et
                        chaque textarea est contrôlé (sa valeur suit toujours l'état). */}
                    {form.greetings.map((g, i) => (
                      <div className="variant-row" key={i}>
                        <textarea
                          value={g}
                          onChange={(e) => setVariant(i, e.target.value)}
                          placeholder={t('greetingPlaceholder')}
                          aria-label={t('greetingVariants')}
                        />
                        <button
                          className="btn small"
                          type="button"
                          onClick={() => removeVariant(i)}
                          title={t('removeVariant')}
                          aria-label={t('removeVariant')}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div>
                  <button className="btn small" type="button" onClick={addVariant}>
                    {t('addGreetingVariant')}
                  </button>
                </div>
              </div>
            </>
          )}
          {/* Prompt système : présent DÈS LA CRÉATION, pas seulement à l'édition.
              Un personnage en accueil « généré » (ou « demander ») ouvre la
              conversation à la seconde où il est créé : sans ce champ ici, le
              modèle parlerait sous le prompt par défaut, et ce premier message —
              celui qui donne le ton — serait perdu. Laissé vide à la création,
              le serveur écrit son prompt par défaut, comme avant. */}
          <div className="field">
            <label htmlFor="char-prompt">{t('systemPrompt')}</label>
            <textarea
              id="char-prompt"
              className="mono"
              value={form.systemPrompt}
              onChange={(e) => set('systemPrompt', e.target.value)}
              spellCheck={false}
            />
            {view.kind === 'create' && <span className="hint">{t('systemPromptCreateHint')}</span>}
          </div>
          {view.kind === 'edit' && (
            <>
              <div className="danger-zone">
                <p className="warn-text">{armed ? t('deleteCharacterArmed') : t('deleteCharacterWarn')}</p>
                <button className="btn danger" onClick={() => remove().catch((e) => console.error('[characters]', e))} disabled={busy}>
                  {armed ? t('confirmDelete') : t('deleteCharacter')}
                </button>
                {armed && (
                  <button className="btn small" style={{ marginLeft: 8 }} onClick={() => setArmed(false)}>
                    {t('cancel')}
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </Dialog>
  )
}
