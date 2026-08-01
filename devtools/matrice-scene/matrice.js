// ═══════════════════════════════════════════════════════════════════════════
// MATRICE DE SCÈNE — harnais de transitions d'état, joué DANS la page de l'app.
//
// Il répond à une question : « importer un décor 3D, ou allumer les
// interactions depuis un fond 2D, marche-t-il à tous les coups ? » Il y a trop
// de combinaisons (fond × modèle × décor 3D × animations × scène vivante ×
// famille × largeur d'écran) pour les essayer à la main sans en oublier.
//
// Il se joue par le CHEMIN DE L'UTILISATEUR : il clique les vrais boutons des
// vrais dialogs. Aucun accès aux entrailles de la scène — ce qu'il sait, il le
// lit à l'écran (pixels du canvas, appels de dessin WebGL, DOM) et à l'API.
//
// Il ne touche JAMAIS aux données de l'utilisateur :
//   · il crée ses propres personnages, tous préfixés « Matrice » (ids
//     `matrice-*`), et refuse de supprimer quoi que ce soit d'autre ;
//   · il sauvegarde data/ui.json avant de commencer et le restaure à la fin,
//     clé par clé (celles qu'il a ajoutées sont remises à `null`).
//
// Voir LISEZMOI.md pour le mode d'emploi. Aucune dépendance, aucun build : ce
// fichier se colle dans la console de http://localhost:7788.
// ═══════════════════════════════════════════════════════════════════════════

;(function () {
  'use strict'

  // ── Réglages ─────────────────────────────────────────────────────────────

  const CLE_SESSION = 'matrice-scene' // journal survivant à un rechargement
  const PREFIXE = 'matrice-' // ids des personnages jetables : rien d'autre ne sera supprimé
  /** Décors livrés utilisés par la matrice (deux, plus l'importé s'il est là). */
  const DECOR_A = 'anime-classroom'
  const DECOR_B = 'small-cafe'
  /** Décor jetable de l'essai d'import — posé/retiré par devtools/matrice-scene/decor-jetable.mjs. */
  const DECOR_IMPORTE = 'subway-platform'
  // Modèle et fond des jetables : le PREMIER de chaque liste servie par l'API,
  // découvert au moment de jouer. Rien n'est codé en dur — le harnais tourne sur
  // n'importe quelle installation, et aucun nom de fichier personnel n'entre ici.
  let MODELE_LABEL = ''
  let FOND_LABEL = ''

  // ── Journal ──────────────────────────────────────────────────────────────

  const journal = {
    debut: new Date().toISOString(),
    uiSauvegarde: null, // data/ui.json d'avant — restauré à la fin
    etapes: [], // { id, titre, verdict, ecarts, sonde, ts }
    curseur: 0, // prochaine étape à jouer (survit à un rechargement)
    fini: false,
  }

  function sauverJournal() {
    try {
      sessionStorage.setItem(CLE_SESSION, JSON.stringify(journal))
    } catch (e) {
      console.warn('[matrice] journal non sauvegardé', e)
    }
  }

  function relireJournal() {
    try {
      const brut = sessionStorage.getItem(CLE_SESSION)
      if (!brut) return false
      Object.assign(journal, JSON.parse(brut))
      return true
    } catch {
      return false
    }
  }

  // ── Petits outils ────────────────────────────────────────────────────────

  const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

  async function jusqua(predicat, opts) {
    const o = Object.assign({ timeout: 15000, pas: 100, quoi: 'condition' }, opts || {})
    const fin = Date.now() + o.timeout
    for (;;) {
      let v
      try {
        v = predicat()
      } catch {
        v = false
      }
      if (v) return v
      if (Date.now() > fin) throw new Error(`délai dépassé : ${o.quoi}`)
      await attendre(o.pas)
    }
  }

  const tous = (sel, racine) => Array.from((racine || document).querySelectorAll(sel))
  const txt = (el) => (el && el.textContent ? el.textContent.trim() : '')

  /** Élément dont le texte vaut exactement l'un des libellés donnés (FR ou EN). */
  function parTexte(sel, libelles, racine) {
    return tous(sel, racine).find((e) => libelles.includes(txt(e))) || null
  }

  // Libellés des deux langues : le harnais marche que l'app soit en FR ou en EN.
  const L = {
    personnages: ['Personnages', 'Characters'],
    reglages: ['Réglages', 'Settings'],
    modifier: ['Modifier', 'Edit'],
    enregistrer: ['Enregistrer', 'Save', 'Enregistrement…', 'Saving…'],
    fermer: ['Fermer', 'Close'],
    aucunDecor: ['Aucun décor', 'No environment'],
    aucunModele: ['Aucun modèle', 'No model'],
    degrade: ['Dégradé par défaut', 'Default gradient'],
    decor3d: ['Décor 3D', '3D environment'],
    animations: ['Animations gestuelles', 'Gesture animations'],
    sceneVivante: ['Scène vivante', 'Living scene'],
    gestuelle: ['Gestuelle', 'Body language'],
    chargementDecor: ['Chargement du décor…', 'Loading the environment…'],
  }

  // ── Sondes ───────────────────────────────────────────────────────────────
  // Trois capteurs, tous posés de l'extérieur : la scène n'expose rien et on ne
  // lui ajoute rien.

  /**
   * 1. Deux compteurs WebGL, et ils ne disent pas la même chose :
   *    · `effacements` (gl.clear) — la BOUCLE de rendu tourne-t-elle ? Elle
   *      efface l'image à chaque frame, même quand il n'y a rien à peindre.
   *    · `dessins` (draw*) — y a-t-il quelque chose à peindre ? Sans modèle ni
   *      décor, ZÉRO est la bonne réponse : la scène est vide, pas morte.
   */
  function installerCompteurGL() {
    if (window.__matriceGL) return
    const etat = { dessins: 0, effacements: 0 }
    const protos = [window.WebGLRenderingContext, window.WebGL2RenderingContext]
    for (const P of protos) {
      if (!P || !P.prototype) continue
      for (const nom of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
        const orig = P.prototype[nom]
        if (typeof orig !== 'function') continue
        P.prototype[nom] = function () {
          etat.dessins++
          return orig.apply(this, arguments)
        }
      }
      const clear = P.prototype.clear
      if (typeof clear === 'function') {
        P.prototype.clear = function () {
          etat.effacements++
          return clear.apply(this, arguments)
        }
      }
    }
    window.__matriceGL = etat
  }

  /** 2. Erreurs de la console (et erreurs non attrapées), depuis l'installation. */
  function installerCaptureConsole() {
    if (window.__matriceConsole) return
    const bac = { erreurs: [], alertes: [] }
    const origErr = console.error.bind(console)
    const origWarn = console.warn.bind(console)
    console.error = function () {
      bac.erreurs.push(Array.from(arguments).map(String).join(' ').slice(0, 400))
      return origErr.apply(null, arguments)
    }
    console.warn = function () {
      bac.alertes.push(Array.from(arguments).map(String).join(' ').slice(0, 400))
      return origWarn.apply(null, arguments)
    }
    window.addEventListener('error', (e) => bac.erreurs.push('window.error: ' + (e.message || '')))
    window.addEventListener('unhandledrejection', (e) =>
      bac.erreurs.push('rejet non traité: ' + String(e.reason).slice(0, 400)),
    )
    window.__matriceConsole = bac
  }

  function videConsole() {
    const bac = window.__matriceConsole
    if (!bac) return
    bac.erreurs.length = 0
    bac.alertes.length = 0
  }

  /** Le canvas de la scène (unique : le stage n'en crée qu'un). */
  function canvas() {
    return document.querySelector('.scene canvas') || document.querySelector('canvas')
  }

  function contexteGL() {
    const c = canvas()
    if (!c) return null
    try {
      return c.getContext('webgl2') || c.getContext('webgl')
    } catch {
      return null
    }
  }

  /**
   * 3. Signature de l'image RÉELLEMENT peinte.
   *
   * Le renderer n'est pas créé avec `preserveDrawingBuffer` : `toDataURL` de
   * l'extérieur ne rend qu'une image vide. On lit donc le tampon avec
   * `gl.readPixels` DANS une frame d'animation — la boucle de la scène
   * réenregistre sa callback en tête de son propre tick, donc la nôtre passe
   * toujours après son rendu, avant que le navigateur ne compose.
   *
   * Renvoie une grille 24×14 : luminance et alpha moyens par case. Le canvas
   * étant transparent (le fond 2D est du CSS derrière), l'ALPHA dit tout :
   *   couverture ≈ 0   → rien n'est peint (ni avatar ni décor)
   *   couverture faible → l'avatar seul, devant un fond 2D
   *   couverture forte  → un décor 3D occupe l'image
   */
  const COLS = 24
  const RANGS = 14

  function signature() {
    return new Promise((res) => {
      requestAnimationFrame(() => {
        const gl = contexteGL()
        if (!gl || gl.isContextLost()) return res(null)
        const w = gl.drawingBufferWidth
        const h = gl.drawingBufferHeight
        if (w < 4 || h < 4) return res(null)
        let px
        try {
          px = new Uint8Array(w * h * 4)
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
        } catch {
          return res(null)
        }
        const lum = new Float64Array(COLS * RANGS)
        const alp = new Float64Array(COLS * RANGS)
        const nb = new Float64Array(COLS * RANGS)
        // Sous-échantillonnage : une ligne sur 4, une colonne sur 4 — assez fin
        // pour une signature, assez grossier pour rester instantané.
        for (let y = 0; y < h; y += 4) {
          const rang = Math.min(RANGS - 1, Math.floor((y / h) * RANGS))
          for (let x = 0; x < w; x += 4) {
            const col = Math.min(COLS - 1, Math.floor((x / w) * COLS))
            const i = (y * w + x) * 4
            const k = rang * COLS + col
            lum[k] += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
            alp[k] += px[i + 3]
            nb[k]++
          }
        }
        const cases = []
        let couvertes = 0
        let alphaTotal = 0
        let lumTotal = 0
        for (let k = 0; k < COLS * RANGS; k++) {
          const n = nb[k] || 1
          const a = alp[k] / n
          const l = lum[k] / n
          cases.push([Math.round(l), Math.round(a)])
          if (a > 32) couvertes++
          alphaTotal += a
          lumTotal += l
        }
        res({
          cases,
          couverture: +(couvertes / (COLS * RANGS)).toFixed(3),
          alphaMoyen: +(alphaTotal / (COLS * RANGS)).toFixed(1),
          lumMoyenne: +(lumTotal / (COLS * RANGS)).toFixed(1),
          w,
          h,
        })
      })
    })
  }

  /** Distance entre deux signatures (0 = image figée, > 3 = ça bouge franchement). */
  function ecartSignatures(a, b) {
    if (!a || !b || a.cases.length !== b.cases.length) return null
    let s = 0
    for (let i = 0; i < a.cases.length; i++) {
      s += Math.abs(a.cases[i][0] - b.cases[i][0]) + Math.abs(a.cases[i][1] - b.cases[i][1])
    }
    return +(s / a.cases.length).toFixed(2)
  }

  /** Cadence de dessin et d'effacement sur une fenêtre de temps. */
  async function mesurerDessins(ms) {
    const gl = window.__matriceGL
    if (!gl) return null
    const d0 = gl.dessins
    const e0 = gl.effacements
    const t0 = performance.now()
    await attendre(ms || 500)
    const dt = performance.now() - t0
    return {
      total: gl.dessins - d0,
      parSeconde: Math.round(((gl.dessins - d0) * 1000) / dt),
      effacements: gl.effacements - e0,
      imagesParSeconde: Math.round(((gl.effacements - e0) * 1000) / dt),
    }
  }

  // ── Lecture de l'API (le serveur dit-il la même chose que l'écran ?) ──────

  function entetes() {
    const t = localStorage.getItem('hanami_token')
    return t ? { Authorization: 'Bearer ' + t } : {}
  }

  async function api(methode, url, corps) {
    const res = await fetch(url, {
      method: methode,
      headers: Object.assign(
        corps !== undefined ? { 'Content-Type': 'application/json' } : {},
        entetes(),
      ),
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
    })
    if (!res.ok) throw new Error(methode + ' ' + url + ' → ' + res.status + ' ' + (await res.text()).slice(0, 200))
    return res.status === 204 ? null : res.json()
  }

  const getUi = () => api('GET', '/api/ui')
  const getDecors = () => api('GET', '/api/environments')
  const getPerso = (id) => api('GET', '/api/characters/' + id)

  /**
   * Ce que le SERVEUR sait du décor porté par le personnage — état de l'analyse
   * et, quand elle est prête, les deux mesures qui décident si la pièce est
   * habitable : l'altitude de son sol (l'avatar, lui, est toujours à y = 0) et
   * le dégagement autour de l'objectif. Un décor peut être « prêt » et poser
   * quand même le personnage sous le plancher : c'est écrit là, pas ailleurs.
   */
  async function lireAnalyse(url) {
    const d = await getDecors().catch(() => null)
    if (!d) return null
    const entree = (d.scenes || []).find((x) => x.url === url)
    if (!entree) return { absent: true }
    const out = { etat: entree.state, seats: entree.seats, walkArea: entree.walkArea }
    if (entree.reason) out.raison = entree.reason
    if (entree.scene) {
      const sc = await fetch(entree.scene).then((r) => r.json()).catch(() => null)
      if (sc && sc.room) {
        out.sol = sc.room.ground
        out.plafond = sc.room.ceiling
        out.degagement = sc.camera && sc.camera.clearance ? Math.max.apply(null, sc.camera.clearance) : null
      }
    }
    return out
  }

  // ── État observé, en un objet ────────────────────────────────────────────

  async function sonder(opts) {
    const o = Object.assign({ dessinsMs: 500, mouvementMs: 900 }, opts || {})
    const c = canvas()
    const gl = contexteGL()
    const sig1 = await signature()
    const dessins = await mesurerDessins(o.dessinsMs)
    await attendre(o.mouvementMs)
    const sig2 = await signature()
    const ui = await getUi().catch((e) => ({ erreur: String(e) }))
    const bac = window.__matriceConsole || { erreurs: [], alertes: [] }
    return {
      canvas: c
        ? { largeur: c.clientWidth, hauteur: c.clientHeight, contextePerdu: gl ? gl.isContextLost() : null }
        : null,
      dessins,
      image: sig1 ? { couverture: sig1.couverture, alphaMoyen: sig1.alphaMoyen, lumMoyenne: sig1.lumMoyenne } : null,
      mouvement: ecartSignatures(sig1, sig2),
      dom: {
        portrait2d: !!document.querySelector('.scene-portrait'),
        banniereVrm: !!parTexte('.banner span', ['Le modèle 3D n’a pas pu être chargé.', 'The 3D model could not be loaded.']),
        banniereDecor: !!parTexte('.banner span', ['Le décor 3D n’a pas pu être chargé.', 'The 3D environment could not be loaded.']),
        pastilleDecor: !!parTexte('.compact-pill', L.chargementDecor),
        astuce3d: !!document.querySelector('.scene-hint'),
        largeurFenetre: window.innerWidth,
      },
      prefs: { env3d: ui.env3d, vrmaEnabled: ui.vrmaEnabled, interactive: ui.interactive, hint3dSeen: ui.hint3dSeen },
      console: { erreurs: bac.erreurs.slice(), alertes: bac.alertes.slice() },
      // Signatures brutes gardées à part : utiles pour rejouer un diagnostic.
      _sig: sig1,
    }
  }

  // ── Gestes de l'utilisateur (le vrai DOM, les vrais boutons) ─────────────

  function boutonBarre(libelles) {
    return (
      tous('.topbar .icon-btn').find((b) => libelles.includes(b.getAttribute('aria-label') || '')) || null
    )
  }

  function dialogOuvert() {
    return document.querySelector('.dialog-card')
  }

  async function ouvrirDialog(libelles) {
    if (dialogOuvert()) await fermerDialog()
    const b = boutonBarre(libelles)
    if (!b) throw new Error('bouton de barre introuvable : ' + libelles.join('/'))
    b.click()
    await jusqua(() => dialogOuvert(), { quoi: 'ouverture du dialog ' + libelles[0] })
    await attendre(120)
  }

  async function fermerDialog() {
    const carte = dialogOuvert()
    if (!carte) return
    const x = carte.querySelector('header .icon-btn')
    if (x) x.click()
    await jusqua(() => !dialogOuvert(), { quoi: 'fermeture du dialog', timeout: 4000 })
    await attendre(120)
  }

  /** Interrupteur des Réglages, par son libellé. */
  function interrupteur(libelles) {
    const lab = tous('.toggle').find((l) => libelles.includes(txt(l.querySelector('.toggle-label'))))
    if (!lab) return null
    return { label: lab, input: lab.querySelector('input[type=checkbox]') }
  }

  /**
   * Pose un interrupteur de la section Scène des Réglages. Renvoie ce que
   * l'interface en dit — y compris « je suis grisé, et voici pourquoi ».
   */
  async function reglerInterrupteur(libelles, valeur) {
    await ouvrirDialog(L.reglages)
    const it = interrupteur(libelles)
    if (!it || !it.input) {
      await fermerDialog()
      throw new Error('interrupteur introuvable : ' + libelles.join('/'))
    }
    const etat = {
      grise: it.input.disabled,
      raison: txt(it.label.querySelector('.toggle-sub')),
      avant: it.input.checked,
    }
    if (!it.input.disabled && it.input.checked !== valeur) it.input.click()
    await attendre(150)
    const it2 = interrupteur(libelles)
    etat.apres = it2 && it2.input ? it2.input.checked : null
    await fermerDialog()
    // Les préférences partent en PUT débouncé (600 ms) : on laisse le temps.
    await attendre(900)
    return etat
  }

  /** Lit l'état d'un interrupteur sans y toucher. */
  async function lireInterrupteur(libelles) {
    await ouvrirDialog(L.reglages)
    const it = interrupteur(libelles)
    const etat = it && it.input
      ? { grise: it.input.disabled, coche: it.input.checked, raison: txt(it.label.querySelector('.toggle-sub')) }
      : null
    await fermerDialog()
    return etat
  }

  /** Menu maison (SelectMenu) : ouvrir, choisir l'option par son libellé. */
  async function choisirDansMenu(idBouton, libellesOption) {
    const btn = document.getElementById(idBouton)
    if (!btn) throw new Error('menu introuvable : #' + idBouton)
    btn.click()
    await jusqua(() => document.querySelector('.select-menu-panel'), { quoi: 'ouverture du menu ' + idBouton })
    const opt = parTexte('.select-menu-option', libellesOption, document.querySelector('.select-menu-panel'))
    if (!opt) {
      const dispo = tous('.select-menu-panel .select-menu-option').map(txt)
      btn.click()
      throw new Error('option absente de #' + idBouton + ' : ' + libellesOption.join('/') + ' — vues : ' + dispo.join(', '))
    }
    opt.click()
    await jusqua(() => !document.querySelector('.select-menu-panel'), { quoi: 'fermeture du menu', timeout: 4000 })
    await attendre(80)
  }

  /** Ouvre le dialog Personnages et entre en édition du personnage nommé. */
  async function ouvrirEdition(nom) {
    await ouvrirDialog(L.personnages)
    const carte = tous('.char-card').find((c) => txt(c.querySelector('.char-name')) === nom)
    if (!carte) {
      await fermerDialog()
      throw new Error('personnage absent de la grille : ' + nom)
    }
    const bouton = parTexte('.btn.small', L.modifier, carte)
    if (!bouton) {
      await fermerDialog()
      throw new Error('bouton Modifier introuvable pour ' + nom)
    }
    bouton.click()
    await jusqua(() => document.getElementById('char-env'), { quoi: 'ouverture du formulaire de ' + nom })
    await attendre(150)
  }

  async function enregistrerEdition() {
    const pied = document.querySelector('.dialog-footer')
    const b = parTexte('.btn.primary', L.enregistrer, pied)
    if (!b) throw new Error('bouton Enregistrer introuvable')
    b.click()
    // Retour à la liste = enregistrement fait.
    await jusqua(() => !document.getElementById('char-env'), { quoi: 'enregistrement du personnage' })
    await fermerDialog()
  }

  /**
   * Édite un personnage par l'interface — décor, modèle, fond, famille
   * d'animations. `null` = on ne touche pas au champ.
   */
  async function editerPersonnage(nom, champs) {
    await ouvrirEdition(nom)
    if (champs.decor !== undefined) {
      await choisirDansMenu('char-env', champs.decor === '' ? L.aucunDecor : [champs.decor])
    }
    if (champs.modele !== undefined) {
      await choisirDansMenu('char-vrm', champs.modele === '' ? L.aucunModele : [champs.modele])
    }
    if (champs.fond !== undefined) {
      await choisirDansMenu('char-bg', champs.fond === '' ? L.degrade : [champs.fond])
    }
    if (champs.famille !== undefined) {
      const groupe = tous('.seg[role=group]').find((g) => L.gestuelle.includes(g.getAttribute('aria-label') || ''))
      if (!groupe) throw new Error('sélecteur de gestuelle introuvable')
      const b = parTexte('.seg-btn', [champs.famille === 'rocketbox' ? 'Rocketbox' : 'Overte'], groupe)
      if (!b) throw new Error('famille introuvable : ' + champs.famille)
      b.click()
      await attendre(80)
    }
    await enregistrerEdition()
  }

  /** Sélectionne un personnage (clic sur sa vignette dans la grille). */
  async function choisirPersonnage(nom) {
    await ouvrirDialog(L.personnages)
    const carte = tous('.char-card').find((c) => txt(c.querySelector('.char-name')) === nom)
    if (!carte) {
      await fermerDialog()
      throw new Error('personnage absent de la grille : ' + nom)
    }
    carte.click()
    await jusqua(() => !dialogOuvert(), { quoi: 'sélection de ' + nom, timeout: 6000 })
    await attendre(300)
  }

  /**
   * Clic dans la scène, en coordonnées fractionnaires du canvas. Renvoie
   * l'amplitude du mouvement observé après coup : c'est la seule réponse
   * observable de l'extérieur.
   */
  async function cliquerScene(fx, fy, opts) {
    const o = Object.assign({ attendreMs: ATTENTE_CLIC }, opts || {})
    const c = canvas()
    if (!c) return { erreur: 'pas de canvas' }
    const r = c.getBoundingClientRect()
    const x = Math.round(r.left + r.width * fx)
    const y = Math.round(r.top + r.height * fy)
    const avant = await signature()
    const commun = { clientX: x, clientY: y, bubbles: true, cancelable: true, view: window }
    c.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerId: 1, isPrimary: true }, commun)))
    c.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerId: 1, isPrimary: true }, commun)))
    c.dispatchEvent(new MouseEvent('click', Object.assign({ detail: 1 }, commun)))
    await attendre(o.attendreMs)
    const apres = await signature()
    return { x: fx, y: fy, mouvement: ecartSignatures(avant, apres) }
  }

  /**
   * Points de visée du SOL, choisis LOIN de l'avatar : en cadrage bureau il
   * occupe la bande x ≈ 0,2–0,5. Cliquer dessus n'est pas un clic-sol — c'est
   * « attirer son attention », et ça fait bouger l'image même sans décor.
   */
  const POINTS_SOL = [
    [0.62, 0.86],
    [0.1, 0.88],
    [0.68, 0.76],
    [0.06, 0.72],
  ]

  /** Visées plus HAUTES : une assise n'est pas au sol (table, banc, marche). */
  const POINTS_ASSISE = [
    [0.62, 0.64],
    [0.68, 0.6],
    [0.08, 0.62],
    [0.58, 0.7],
  ]

  /**
   * Cherche un point du sol qui fasse réagir la scène : plusieurs visées, la
   * meilleure gagne. Un état non interactif rend un mouvement quasi nul partout.
   */
  async function essayerClicsSol(points) {
    const liste = points || POINTS_SOL
    // LE REPOS D'ABORD, dans l'état du moment : la respiration d'un avatar qui
    // remplit un écran de téléphone déplace bien plus de pixels que celle d'un
    // avatar minuscule au fond d'un café. Un seuil absolu ne peut pas trancher
    // les deux — c'est le rapport au repos qui le peut.
    const r1 = await signature()
    await attendre(ATTENTE_CLIC)
    const repos = ecartSignatures(r1, await signature()) || 0
    const seuil = seuilMouvement(repos)
    const essais = []
    let meilleur = 0
    for (const [fx, fy] of liste) {
      const e = await cliquerScene(fx, fy)
      essais.push(e)
      if (typeof e.mouvement === 'number' && e.mouvement > meilleur) meilleur = e.mouvement
      if (meilleur > seuil) break // inutile d'insister : ça répond
    }
    return { essais, meilleur, repos, seuil }
  }

  /** Durée d'observation après un clic (et du repos auquel on le compare). */
  const ATTENTE_CLIC = 1800
  /** Plancher absolu du mouvement retenu — sous ça, c'est du bruit de mesure. */
  const MOUVEMENT_MIN = 1
  /** Un clic « répond » s'il remue au moins ce multiple du repos. */
  const FACTEUR_MOUVEMENT = 3

  function seuilMouvement(repos) {
    return Math.max(MOUVEMENT_MIN, +(repos * FACTEUR_MOUVEMENT).toFixed(2))
  }

  /** Attend que la scène se calme : plus de pastille de chargement, image vivante. */
  async function attendreCalme(opts) {
    const o = Object.assign({ min: 900, max: 40000 }, opts || {})
    const fin = Date.now() + o.max
    // La pastille « Chargement du décor… » peut n'apparaître qu'après un tick.
    await attendre(250)
    while (parTexte('.compact-pill', L.chargementDecor) && Date.now() < fin) await attendre(200)
    await attendre(o.min)
  }

  // ── Vérification déclarative ─────────────────────────────────────────────
  // Chaque étape dit ce qu'elle attend ; la sonde dit ce qui est. L'écart est le
  // rapport. Quand un capteur ne sait pas trancher, on écrit « indéterminé »
  // plutôt qu'un faux échec : un harnais qui ment ne sert à rien.

  /** Seuils de lecture de la couverture d'alpha du canvas. */
  const COUV_VIDE = 0.02 // rien de peint
  const COUV_DECOR = 0.45 // un décor occupe l'image

  /**
   * Valeur EFFECTIVE d'une préférence de scène : une clé absente de ui.json
   * n'est pas une anomalie, c'est le défaut documenté (shared/types.ts) —
   * décor et animations allumés, scène vivante éteinte. L'utilisateur qui n'a
   * jamais touché un réglage n'a rien dans son fichier, et c'est voulu.
   */
  const DEFAUTS_PREFS = { env3d: true, vrmaEnabled: true, interactive: false, hint3dSeen: false }

  function prefEffective(cle, valeur) {
    return valeur === undefined && cle in DEFAUTS_PREFS ? DEFAUTS_PREFS[cle] : valeur
  }

  function verifier(attendu, s) {
    const ecarts = []
    const dit = (m) => ecarts.push(m)

    if (attendu.zeroErreur !== false && s.console.erreurs.length > 0) {
      dit('erreurs console : ' + s.console.erreurs.slice(0, 4).join(' | '))
    }
    if (!s.canvas) dit('aucun canvas dans la page')
    else if (s.canvas.contextePerdu) dit('contexte WebGL perdu')

    // La BOUCLE de rendu, toujours attendue vivante — c'est elle qui prouve que
    // rien n'est figé. Les DESSINS, eux, n'ont lieu que s'il y a quelque chose à
    // peindre : sans modèle ni décor, zéro est la bonne réponse.
    if (s.dessins && s.dessins.effacements === 0) dit('la boucle de rendu ne tourne plus (aucune image)')
    if (attendu.rend !== undefined) {
      const rend = s.dessins && s.dessins.total > 0
      if (attendu.rend && !rend) dit('rien n’est dessiné alors qu’il y avait quelque chose à peindre')
      if (!attendu.rend && rend) dit('des dessins alors qu’on n’en attendait aucun')
    }
    if (attendu.peint !== undefined && s.image) {
      const vide = s.image.couverture <= COUV_VIDE
      if (attendu.peint && vide) dit('image vide (couverture ' + s.image.couverture + ')')
      if (!attendu.peint && !vide) dit('image non vide alors qu’on l’attendait vide (couverture ' + s.image.couverture + ')')
    }
    if (attendu.decor !== undefined && s.image) {
      const decor = s.image.couverture >= COUV_DECOR
      if (attendu.decor && !decor) dit('pas de décor à l’image (couverture ' + s.image.couverture + ')')
      if (!attendu.decor && decor) dit('un décor occupe l’image alors qu’il ne devrait pas (couverture ' + s.image.couverture + ')')
    }
    if (attendu.portrait2d !== undefined && s.dom.portrait2d !== attendu.portrait2d) {
      dit('portrait 2D ' + (s.dom.portrait2d ? 'présent' : 'absent') + ', attendu ' + (attendu.portrait2d ? 'présent' : 'absent'))
    }
    if (attendu.banniereVrm !== undefined && s.dom.banniereVrm !== attendu.banniereVrm) {
      dit('bannière « modèle 3D » ' + (s.dom.banniereVrm ? 'affichée' : 'absente') + ', attendu le contraire')
    }
    if (attendu.banniereDecor !== undefined && s.dom.banniereDecor !== attendu.banniereDecor) {
      dit('bannière « décor 3D » ' + (s.dom.banniereDecor ? 'affichée' : 'absente') + ', attendu le contraire')
    }
    if (attendu.prefs) {
      for (const k of Object.keys(attendu.prefs)) {
        const effectif = prefEffective(k, s.prefs[k])
        if (effectif !== attendu.prefs[k]) {
          dit(
            'préférence ' + k + ' = ' + JSON.stringify(s.prefs[k]) +
              (s.prefs[k] === undefined ? ' (clé absente ⇒ ' + JSON.stringify(effectif) + ')' : '') +
              ', attendu ' + JSON.stringify(attendu.prefs[k]),
          )
        }
      }
    }
    if (attendu.envApi !== undefined && s.envApi !== attendu.envApi) {
      dit('GET /api/characters dit environment = ' + JSON.stringify(s.envApi) + ', attendu ' + JSON.stringify(attendu.envApi))
    }
    // Diagnostic du décor : ces deux mesures expliquent à elles seules l'écran
    // noir d'un décor pourtant « prêt ». Elles sont vérifiées dès qu'un décor
    // est attendu à l'image — c'est là qu'elles comptent.
    if (attendu.decor === true && s.decor && s.decor.etat === 'ready') {
      if (typeof s.decor.sol === 'number' && Math.abs(s.decor.sol) > 0.4) {
        dit(
          'le sol de ce décor est à ' + s.decor.sol.toFixed(2) + ' m alors que l’avatar est à 0 : ' +
            'il se tient ' + Math.abs(s.decor.sol).toFixed(2) + ' m ' + (s.decor.sol > 0 ? 'SOUS' : 'AU-DESSUS') +
            ' du plancher — il faut un sidecar `spawn` (cf. environments/README.md)',
        )
      }
      if (s.decor.degagement === 0) {
        dit('aucun dégagement autour de l’objectif dans les 16 directions : la caméra est dans la géométrie')
      }
    }
    if (attendu.clic === 'repond' && s.clic && s.clic.meilleur < s.clic.seuil) {
      dit('clic-sol sans réponse (mouvement ' + s.clic.meilleur + ' < seuil ' + s.clic.seuil + ', repos ' + s.clic.repos + ')')
    }
    if (attendu.clic === 'inerte' && s.clic && s.clic.meilleur >= s.clic.seuil) {
      dit('clic-sol suivi d’un mouvement (' + s.clic.meilleur + ' ≥ seuil ' + s.clic.seuil + ', repos ' + s.clic.repos + ') alors que la scène devait rester inerte')
    }
    return ecarts
  }

  // ── Fixtures : les personnages jetables ──────────────────────────────────

  const PERSOS = {
    a: { nom: 'Matrice A', id: null }, // VRM + fond 2D
    b: { nom: 'Matrice B', id: null }, // sans VRM : portrait 2D
    c: { nom: 'Matrice C', id: null }, // VRM + décor, famille Rocketbox
  }

  /** Pose une valeur dans un champ contrôlé par React (le setter natif + un événement). */
  function poserValeurReact(el, valeur) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, valeur)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  /**
   * Crée un personnage PAR LE FORMULAIRE — et pas par l'API : c'est l'App qui
   * tient la liste des personnages en mémoire, un POST direct ne la rafraîchit
   * pas. Créer, ici, sélectionne aussi le personnage (comportement de l'App).
   */
  async function creerParUi(nom, champs) {
    await ouvrirDialog(L.personnages)
    if (tous('.char-card').some((c) => txt(c.querySelector('.char-name')) === nom)) {
      await fermerDialog()
      return
    }
    const nouveau = parTexte('.btn.primary', ['Nouveau personnage', 'New character'], document.querySelector('.dialog-footer'))
    if (!nouveau) throw new Error('bouton « Nouveau personnage » introuvable')
    nouveau.click()
    await jusqua(() => document.getElementById('char-name'), { quoi: 'formulaire de création' })
    poserValeurReact(document.getElementById('char-name'), nom)
    // Une salutation ÉCRITE, et c'est capital : sans aucun texte d'accueil,
    // l'App fait ouvrir la conversation par le modèle (cf. App.tsx). Le harnais
    // n'a rien à demander à un LLM — et surtout pas vingt fois de suite.
    const salut = document.getElementById('char-greeting')
    if (salut) poserValeurReact(salut, 'Personnage jetable du harnais de matrice de scène.')
    if (champs.modele) await choisirDansMenu('char-vrm', [champs.modele])
    if (champs.fond) await choisirDansMenu('char-bg', [champs.fond])
    if (champs.decor) await choisirDansMenu('char-env', [champs.decor])
    if (champs.famille === 'rocketbox') {
      const groupe = tous('.seg[role=group]').find((g) => L.gestuelle.includes(g.getAttribute('aria-label') || ''))
      parTexte('.seg-btn', ['Rocketbox'], groupe).click()
      await attendre(80)
    }
    const creer = parTexte('.btn.primary', ['Créer', 'Create', 'Enregistrement…', 'Saving…'], document.querySelector('.dialog-footer'))
    if (!creer) throw new Error('bouton Créer introuvable')
    creer.click()
    await jusqua(() => !document.getElementById('char-name'), { quoi: 'création de ' + nom })
    await fermerDialog()
    await attendre(400)
  }

  /** Retrouve les ids réels des jetables (le serveur les dérive du nom). */
  async function resoudreIds() {
    const liste = await api('GET', '/api/characters')
    for (const cle of Object.keys(PERSOS)) {
      const trouve = liste.find((c) => c.name === PERSOS[cle].nom)
      PERSOS[cle].id = trouve ? trouve.id : null
    }
    journal.ids = { a: PERSOS.a.id, b: PERSOS.b.id, c: PERSOS.c.id }
  }

  /** Libellé d'une URL d'asset tel que les menus l'affichent (nom décodé, sans extension). */
  function libelleDe(url) {
    let nom = url.split('/').pop() || url
    try {
      nom = decodeURIComponent(nom)
    } catch {
      /* séquence % invalide : on garde le nom brut */
    }
    return nom.replace(/\.[^.]+$/, '')
  }

  /** Choisit le premier modèle et le premier fond disponibles sur CETTE installation. */
  async function choisirLesAssets() {
    if (!MODELE_LABEL) {
      const m = await api('GET', '/api/vrm-models')
      if (!m.models || m.models.length === 0) throw new Error('aucun modèle .vrm dans vrm/ : le harnais ne peut rien montrer')
      MODELE_LABEL = libelleDe(m.models[0])
    }
    if (!FOND_LABEL) {
      const f = await api('GET', '/api/backgrounds')
      if (!f.backgrounds || f.backgrounds.length === 0) throw new Error('aucun fond dans backgrounds/')
      FOND_LABEL = libelleDe(f.backgrounds[0])
    }
    journal.assets = { modele: MODELE_LABEL, fond: FOND_LABEL }
  }

  async function creerJetables() {
    await choisirLesAssets()
    await creerParUi(PERSOS.a.nom, { modele: MODELE_LABEL, fond: FOND_LABEL })
    await creerParUi(PERSOS.c.nom, { modele: MODELE_LABEL, fond: FOND_LABEL, decor: DECOR_A, famille: 'rocketbox' })
    await creerParUi(PERSOS.b.nom, { fond: FOND_LABEL, decor: DECOR_A }) // sans modèle 3D
    await resoudreIds()
    // Portrait 2D de B : le formulaire n'a pas d'éditeur de portrait (il vient
    // normalement d'une card importée). On en fabrique un ici et on le pose par
    // l'API — il part avec le personnage à la suppression.
    const b = await getPerso(PERSOS.b.id)
    if (!b.portrait) {
      const cv = document.createElement('canvas')
      cv.width = 256
      cv.height = 384
      const ctx = cv.getContext('2d')
      ctx.fillStyle = '#d98cb3'
      ctx.fillRect(0, 0, 256, 384)
      ctx.fillStyle = '#2b1b25'
      ctx.font = 'bold 120px sans-serif'
      ctx.fillText('B', 90, 230)
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'))
      const res = await fetch('/api/characters/' + PERSOS.b.id + '/photo', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'image/png' }, entetes()),
        body: blob,
      })
      if (!res.ok) throw new Error('dépôt du portrait refusé : ' + res.status)
      const { photo } = await res.json()
      await api('PUT', '/api/characters/' + PERSOS.b.id, { portrait: photo.split('?')[0] })
    }
  }

  async function supprimerJetables() {
    const existants = await api('GET', '/api/characters')
    const noms = Object.keys(PERSOS).map((k) => PERSOS[k].nom)
    const partis = []
    for (const c of existants) {
      // Garde-fou double : le préfixe d'id OU un nom du harnais, rien d'autre.
      if (!c.id.startsWith(PREFIXE) && !noms.includes(c.name)) continue
      await api('DELETE', '/api/characters/' + c.id)
      partis.push(c.id)
    }
    return partis
  }

  // ── Sauvegarde / restauration de data/ui.json ────────────────────────────

  const CLES_UI = [
    'lang', 'theme', 'customTheme', 'vnMode', 'env3d', 'vrmaEnabled', 'interactive',
    'hint3dSeen', 'chatPanelWidth', 'vnBoxWidth', 'vnBoxHeight', 'activeCharacter',
    'activeChat', 'views',
  ]

  async function restaurerUi() {
    const avant = journal.uiSauvegarde
    if (!avant) return { erreur: 'aucune sauvegarde à restaurer' }
    const patch = {}
    for (const k of CLES_UI) {
      if (Object.prototype.hasOwnProperty.call(avant, k)) patch[k] = avant[k]
      else patch[k] = null // clé ajoutée par le harnais : elle disparaît
    }
    // Les vues et la conversation active des jetables partent avec eux.
    if (patch.views && typeof patch.views === 'object') {
      patch.views = Object.fromEntries(Object.entries(patch.views).filter(([k]) => !k.startsWith(PREFIXE)))
      if (Object.keys(patch.views).length === 0) patch.views = null
    }
    if (patch.activeChat && typeof patch.activeChat === 'object') {
      patch.activeChat = Object.fromEntries(Object.entries(patch.activeChat).filter(([k]) => !k.startsWith(PREFIXE)))
      if (Object.keys(patch.activeChat).length === 0) patch.activeChat = null
    }
    const apres = await api('PUT', '/api/ui', patch)
    const identique = JSON.stringify(apres) === JSON.stringify(avant)
    return { identique, apres, avant }
  }

  // ── Les étapes ───────────────────────────────────────────────────────────
  // `faire` exécute la transition, `attendu` décrit l'état visé. `externe`
  // marque une étape que la page ne peut pas jouer seule (redimensionner la
  // fenêtre, recharger, poser un fichier sur le disque) : le harnais s'arrête,
  // dit quoi faire, et `matrice.reprendre()` continue.

  function etapes() {
    return [
      {
        id: '00-preparation',
        titre: 'Personnages jetables créés, ui.json sauvegardé, base posée',
        async faire() {
          journal.uiSauvegarde = await getUi()
          await creerJetables()
          await choisirPersonnage(PERSOS.a.nom)
          await reglerInterrupteur(L.decor3d, true)
          await reglerInterrupteur(L.animations, true)
          await reglerInterrupteur(L.sceneVivante, false)
          await attendreCalme()
        },
        attendu: { rend: true, peint: true, decor: false, portrait2d: false, banniereVrm: false, banniereDecor: false, envApi: '', prefs: { env3d: true, vrmaEnabled: true } },
        persoCle: 'a',
      },
      {
        id: '01-fond2d-vers-decor3d',
        titre: 'T1 — fond 2D → décor 3D en cours de conversation (' + DECOR_A + ')',
        async faire() {
          await editerPersonnage(PERSOS.a.nom, { decor: DECOR_A })
          await attendreCalme()
        },
        attendu: { rend: true, peint: true, decor: true, banniereDecor: false, envApi: '/environments/' + DECOR_A + '.glb' },
        persoCle: 'a',
      },
      {
        id: '02-decor3d-vers-fond2d',
        titre: 'T2 — retrait du décor : retour au fond 2D, avatar recadré',
        async faire() {
          await editerPersonnage(PERSOS.a.nom, { decor: '' })
          await attendreCalme()
        },
        attendu: { rend: true, peint: true, decor: false, banniereDecor: false, envApi: '' },
        persoCle: 'a',
      },
      {
        id: '03-interactive-sans-decor',
        titre: 'T3 — scène vivante allumée AVANT d’avoir un décor',
        async faire() {
          const it = await reglerInterrupteur(L.sceneVivante, true)
          this.detail = it
          await attendreCalme({ min: 1200 })
          this.clic = await essayerClicsSol()
        },
        attendu: { rend: true, peint: true, decor: false, prefs: { interactive: true }, clic: 'inerte', envApi: '' },
        persoCle: 'a',
      },
      {
        id: '04-env3d-sans-environnement',
        titre: 'T4 — décor 3D allumé sur un personnage SANS décor assigné',
        async faire() {
          await reglerInterrupteur(L.decor3d, false)
          await attendre(600)
          await reglerInterrupteur(L.decor3d, true)
          await attendreCalme()
        },
        attendu: { rend: true, peint: true, decor: false, banniereDecor: false, prefs: { env3d: true }, envApi: '' },
        persoCle: 'a',
      },
      {
        id: '05-scene-vivante-avec-decor',
        titre: 'T3bis — décor remis : la scène vivante répond au clic-sol',
        async faire() {
          await editerPersonnage(PERSOS.a.nom, { decor: DECOR_A })
          await attendreCalme({ min: 2000 })
          this.clic = await essayerClicsSol()
        },
        attendu: { rend: true, peint: true, decor: true, prefs: { interactive: true }, clic: 'repond', envApi: '/environments/' + DECOR_A + '.glb' },
        persoCle: 'a',
      },
      {
        id: '06-changer-decor-pendant-la-marche',
        titre: 'T5a — changement de décor PENDANT la marche',
        async faire() {
          // On lance une marche, et on change de pièce sans attendre la fin.
          await cliquerScene(0.28, 0.8, { attendreMs: 400 })
          await editerPersonnage(PERSOS.a.nom, { decor: DECOR_B })
          await attendreCalme({ min: 2500 })
          this.clic = await essayerClicsSol()
        },
        attendu: { rend: true, peint: true, decor: true, banniereDecor: false, clic: 'repond', envApi: '/environments/' + DECOR_B + '.glb' },
        persoCle: 'a',
      },
      {
        id: '07-changer-decor-pendant-l-assise',
        titre: 'T5b — changement de décor PENDANT l’assise',
        async faire() {
          // Une assise se vise plus haut que le sol : plusieurs hauteurs.
          this.assise = await essayerClicsSol(POINTS_ASSISE)
          await attendre(3000) // le temps de s'installer
          await editerPersonnage(PERSOS.a.nom, { decor: DECOR_A })
          await attendreCalme({ min: 2500 })
          this.clic = await essayerClicsSol()
        },
        attendu: { rend: true, peint: true, decor: true, banniereDecor: false, clic: 'repond', envApi: '/environments/' + DECOR_A + '.glb' },
        persoCle: 'a',
      },
      {
        id: '07b-retrait-du-decor-pendant-la-marche',
        titre: 'T2bis — retrait du décor alors que le personnage a quitté sa place',
        async faire() {
          // L'avatar s'en va, et on lui retire la pièce sous les pieds : il doit
          // revenir à l'origine du monde, face à la caméra, sans décor.
          await cliquerScene(0.62, 0.86, { attendreMs: 700 })
          await editerPersonnage(PERSOS.a.nom, { decor: '' })
          await attendreCalme({ min: 2000 })
          this.clic = await essayerClicsSol()
          // Puis on lui rend sa pièce, pour la suite du scénario.
          await editerPersonnage(PERSOS.a.nom, { decor: DECOR_A })
          await attendreCalme({ min: 2000 })
        },
        // Sonde prise APRÈS le retour du décor : ce que l'étape vérifie, c'est
        // qu'aucune erreur n'a été levée et que la pièce revient proprement. Le
        // clic, lui, a été essayé pendant le creux — sans décor, rien à viser.
        attendu: { rend: true, peint: true, decor: true, banniereDecor: false, banniereVrm: false, clic: 'inerte' },
        persoCle: 'a',
      },
      {
        id: '08-changement-de-personnage-rocketbox',
        titre: 'T6 — changement de personnage en pleine scène (overte → rocketbox)',
        async faire() {
          await choisirPersonnage(PERSOS.c.nom)
          await attendreCalme({ min: 2500 })
          this.clic = await essayerClicsSol()
        },
        attendu: { rend: true, peint: true, decor: true, banniereVrm: false, banniereDecor: false, envApi: '/environments/' + DECOR_A + '.glb' },
        persoCle: 'c',
      },
      {
        id: '09-retour-overte',
        titre: 'T6bis — retour au personnage Overte, toujours en scène',
        async faire() {
          await choisirPersonnage(PERSOS.a.nom)
          await attendreCalme({ min: 2500 })
          this.clic = await essayerClicsSol()
        },
        attendu: { rend: true, peint: true, decor: true, banniereVrm: false, clic: 'repond', envApi: '/environments/' + DECOR_A + '.glb' },
        persoCle: 'a',
      },
      {
        id: '10-retrait-du-vrm',
        titre: 'T7 — retrait du modèle VRM avec la scène vivante allumée',
        async faire() {
          await editerPersonnage(PERSOS.a.nom, { modele: '' })
          await attendreCalme({ min: 1500 })
          this.clic = await essayerClicsSol()
        },
        // Sans modèle, l'App ne charge PAS le décor (cf. App.tsx) : l'image doit
        // redevenir vide — donc AUCUN dessin, la boucle tournant toujours — et
        // le clic ne peut rien viser.
        attendu: { rend: false, peint: false, decor: false, banniereVrm: false, banniereDecor: false, clic: 'inerte', prefs: { interactive: true } },
        persoCle: 'a',
      },
      {
        id: '11-personnage-portrait-2d',
        titre: 'Personnage SANS VRM (portrait 2D) avec décor assigné et scène vivante ON',
        async faire() {
          await choisirPersonnage(PERSOS.b.nom)
          await attendreCalme({ min: 1500 })
          this.clic = await essayerClicsSol()
        },
        attendu: { rend: false, peint: false, decor: false, portrait2d: true, banniereVrm: false, banniereDecor: false, clic: 'inerte' },
        persoCle: 'b',
      },
      {
        id: '12-retour-modele-et-decor',
        titre: 'Retour d’un personnage complet (modèle + décor) après le portrait 2D',
        async faire() {
          await editerPersonnage(PERSOS.a.nom, { modele: MODELE_LABEL })
          await choisirPersonnage(PERSOS.a.nom)
          await attendreCalme({ min: 2500 })
          this.clic = await essayerClicsSol()
        },
        attendu: { rend: true, peint: true, decor: true, portrait2d: false, banniereVrm: false, clic: 'repond' },
        persoCle: 'a',
      },
      {
        id: '13-vrma-off-avec-interactive-on',
        titre: 'T8 — animations gestuelles ÉTEINTES alors que la scène vivante est allumée',
        async faire() {
          await reglerInterrupteur(L.animations, false)
          await attendreCalme({ min: 1500 })
          this.detail = await lireInterrupteur(L.sceneVivante)
          this.clic = await essayerClicsSol()
        },
        // La préférence `interactive` NE DOIT PAS être effacée : l'interrupteur
        // se grise avec sa raison, et la scène retombe sur la respiration.
        attendu: { rend: true, peint: true, decor: true, prefs: { vrmaEnabled: false, interactive: true }, clic: 'inerte' },
        persoCle: 'a',
      },
      {
        id: '14-vrma-rallume',
        titre: 'T8bis — animations rallumées : la scène vivante repart d’elle-même',
        async faire() {
          await reglerInterrupteur(L.animations, true)
          await attendreCalme({ min: 2500 })
          this.detail = await lireInterrupteur(L.sceneVivante)
          this.clic = await essayerClicsSol()
        },
        attendu: { rend: true, peint: true, decor: true, prefs: { vrmaEnabled: true, interactive: true }, clic: 'repond' },
        persoCle: 'a',
      },
      {
        id: '15-passage-en-mobile',
        titre: 'T9 — la fenêtre passe en étroit (375 px) pendant la scène vivante',
        externe: 'Réduire la fenêtre à 375 px de large (moins de 900 px), puis matrice.reprendre()',
        async faire() {
          await attendreCalme({ min: 1500 })
          this.detail = await lireInterrupteur(L.sceneVivante)
          this.clic = await essayerClicsSol()
        },
        // Sur petit écran la scène vivante est désactivée SANS toucher à la
        // préférence : l'interrupteur est grisé, coché, avec sa raison.
        attendu: { rend: true, peint: true, prefs: { interactive: true }, clic: 'inerte' },
        persoCle: 'a',
      },
      {
        id: '16-retour-en-large',
        titre: 'T9bis — retour en grand écran : la scène vivante reprend',
        externe: 'Rendre à la fenêtre sa largeur de bureau (1569 px), puis matrice.reprendre()',
        async faire() {
          await attendreCalme({ min: 2000 })
          this.detail = await lireInterrupteur(L.sceneVivante)
          this.clic = await essayerClicsSol()
        },
        attendu: { rend: true, peint: true, decor: true, prefs: { interactive: true }, clic: 'repond' },
        persoCle: 'a',
      },
      {
        id: '17-rechargement-en-scene-vivante',
        titre: 'T10 — rechargement de page en scène vivante : l’état revient identique',
        externe: 'Recharger la page (F5), recoller matrice.js, puis matrice.reprendre()',
        avantExterne: async () => {
          // Photographie de l'état d'avant, pour comparer après le rechargement.
          journal.avantRechargement = await sonder({ dessinsMs: 400, mouvementMs: 600 })
        },
        async faire() {
          await attendreCalme({ min: 3000 })
          this.clic = await essayerClicsSol()
          const av = journal.avantRechargement
          if (av && av.image && av.image.couverture < COUV_DECOR) {
            this.detail = { note: 'l’état d’avant n’avait pas de décor à l’image' }
          }
        },
        attendu: { rend: true, peint: true, decor: true, prefs: { interactive: true, env3d: true, vrmaEnabled: true }, clic: 'repond' },
        persoCle: 'a',
      },
      {
        id: '18-import-decor-analyse',
        titre: 'Import — le .glb déposé dans environments/ s’analyse tout seul',
        externe:
          'Poser le décor jetable : node devtools/matrice-scene/decor-jetable.mjs poser <chemin.glb> — puis matrice.reprendre()',
        async faire() {
          // Le listing DÉCLENCHE le balayage côté serveur : il suffit de le
          // redemander jusqu'à ce que l'état ne soit plus « en préparation ».
          const t0 = Date.now()
          let dernier = null
          for (;;) {
            const d = await getDecors()
            dernier = (d.scenes || []).find((s) => s.name === DECOR_IMPORTE) || null
            if (dernier && (dernier.state === 'ready' || dernier.state === 'failed' || dernier.state === 'unsupported')) break
            if (Date.now() - t0 > 180000) break
            await attendre(2000)
          }
          this.detail = { analyse: dernier, secondes: Math.round((Date.now() - t0) / 1000) }
          if (!dernier || dernier.state !== 'ready') throw new Error('analyse non prête : ' + JSON.stringify(dernier))
        },
        attendu: { rend: true },
        persoCle: 'a',
      },
      {
        id: '19-import-decor-assigne',
        titre: 'Import — le décor importé est assigné au jetable, marche et assise dessus',
        async faire() {
          await editerPersonnage(PERSOS.a.nom, { decor: DECOR_IMPORTE })
          await attendreCalme({ min: 3000 })
          this.clic = await essayerClicsSol()
          this.assise = await essayerClicsSol(POINTS_ASSISE)
        },
        attendu: { rend: true, peint: true, decor: true, banniereDecor: false, clic: 'repond', envApi: '/environments/' + DECOR_IMPORTE + '.glb' },
        persoCle: 'a',
      },
      {
        id: '20-retrait-du-decor-importe',
        titre: 'Import — retrait : le personnage revient au fond 2D avant le nettoyage disque',
        async faire() {
          await editerPersonnage(PERSOS.a.nom, { decor: '' })
          await attendreCalme({ min: 1500 })
        },
        attendu: { rend: true, peint: true, decor: false, banniereDecor: false, envApi: '' },
        persoCle: 'a',
      },
      {
        id: '21-fond-aucun',
        titre: 'Aucun fond du tout (ni image 2D ni décor) — le dégradé de l’app',
        async faire() {
          await editerPersonnage(PERSOS.a.nom, { fond: '' })
          await attendreCalme({ min: 1200 })
        },
        attendu: { rend: true, peint: true, decor: false, banniereVrm: false, banniereDecor: false },
        persoCle: 'a',
      },
    ]
  }

  // ── Moteur ───────────────────────────────────────────────────────────────

  let liste = null
  let enCours = false

  async function jouerDepuis() {
    if (enCours) throw new Error('déjà en cours')
    enCours = true
    liste = liste || etapes()
    try {
      // Après un rechargement de page, les ids des jetables et les assets
      // choisis sont à retrouver — le journal les a gardés.
      if (journal.curseur > 0 && !PERSOS.a.id) await resoudreIds().catch(() => null)
      if (!MODELE_LABEL && journal.assets) {
        MODELE_LABEL = journal.assets.modele
        FOND_LABEL = journal.assets.fond
      }
      while (journal.curseur < liste.length) {
        const e = liste[journal.curseur]
        // Étape à main externe : on rend la main, on dit quoi faire. La marque
        // vit dans le JOURNAL et non sur l'étape — le harnais est rechargé entre
        // les deux (c'est même le sujet de l'étape « rechargement de page »).
        journal.externesFaits = journal.externesFaits || []
        if (e.externe && journal.externesFaits.indexOf(e.id) < 0) {
          journal.externesFaits.push(e.id)
          if (e.avantExterne) await e.avantExterne()
          sauverJournal()
          console.log('%c[matrice] ACTION EXTERNE : ' + e.externe, 'color:#d98cb3;font-weight:bold')
          return { enAttente: e.externe, etape: e.id }
        }
        console.log('[matrice] ▶ ' + e.id + ' — ' + e.titre)
        videConsole()
        const debut = Date.now()
        const ligne = { id: e.id, titre: e.titre, ts: new Date().toISOString() }
        try {
          e.clic = null
          e.detail = null
          e.assise = null
          await e.faire()
          const s = await sonder()
          const idPerso = e.persoCle && PERSOS[e.persoCle] ? PERSOS[e.persoCle].id : null
          if (idPerso) {
            const p = await getPerso(idPerso).catch(() => null)
            s.envApi = p ? p.environment || '' : null
            s.vrmApi = p ? p.vrm : null
            if (s.envApi) s.decor = await lireAnalyse(s.envApi)
          }
          s.clic = e.clic
          if (e.detail) s.detail = e.detail
          if (e.assise) s.assise = e.assise
          const ecarts = verifier(e.attendu || {}, s)
          delete s._sig
          ligne.sonde = s
          ligne.ecarts = ecarts
          ligne.verdict = ecarts.length === 0 ? 'ok' : 'echec'
        } catch (err) {
          ligne.verdict = 'echec'
          ligne.ecarts = ['exception : ' + (err && err.message ? err.message : String(err))]
          ligne.sonde = await sonder({ dessinsMs: 200, mouvementMs: 300 }).catch(() => null)
        }
        ligne.ms = Date.now() - debut
        journal.etapes.push(ligne)
        journal.curseur++
        sauverJournal()
        console.log(
          '[matrice] ' + (ligne.verdict === 'ok' ? '✔' : '✘') + ' ' + e.id + (ligne.ecarts.length ? ' — ' + ligne.ecarts.join(' ; ') : ''),
        )
      }
      journal.fini = true
      sauverJournal()
      return resume()
    } finally {
      enCours = false
    }
  }

  function resume() {
    const ok = journal.etapes.filter((e) => e.verdict === 'ok').length
    const ko = journal.etapes.filter((e) => e.verdict === 'echec').length
    return {
      total: journal.etapes.length,
      ok,
      echecs: ko,
      details: journal.etapes.map((e) => ({ id: e.id, verdict: e.verdict, ecarts: e.ecarts })),
    }
  }

  // ── Interface publique ───────────────────────────────────────────────────

  const matrice = {
    journal,
    /** Pose les sondes et reprend un journal en cours (après un rechargement). */
    installer() {
      installerCompteurGL()
      installerCaptureConsole()
      const repris = relireJournal()
      liste = etapes()
      console.log(
        '[matrice] sondes posées' + (repris ? ' — journal repris à l’étape ' + journal.curseur : ' — journal neuf'),
      )
      return { repris, curseur: journal.curseur, total: liste.length }
    },
    /**
     * Déroule la matrice depuis le curseur. S'arrête sur une étape externe.
     * `opts.modele` / `opts.fond` : libellés (nom de fichier sans extension) à
     * utiliser au lieu du premier de chaque liste — utile quand le premier
     * modèle du dossier est un fichier douteux.
     */
    jouer(opts) {
      this.installer()
      if (opts && opts.modele) MODELE_LABEL = opts.modele
      if (opts && opts.fond) FOND_LABEL = opts.fond
      if (MODELE_LABEL && FOND_LABEL) journal.assets = { modele: MODELE_LABEL, fond: FOND_LABEL }
      return jouerDepuis()
    },
    /** Continue après une action externe (redimensionnement, rechargement, dépôt de fichier). */
    reprendre() {
      this.installer()
      return jouerDepuis()
    },
    /** Le journal complet (à copier/coller pour archivage). */
    rapport() {
      return journal
    },
    resume,
    /** Une sonde ponctuelle, hors scénario. */
    sonder,
    /** Nettoyage : jetables supprimés, data/ui.json restauré à l'identique. */
    async nettoyer() {
      await supprimerJetables()
      // Supprimer le personnage ACTIF fait basculer l'App sur un autre, qui
      // écrit à son tour `activeCharacter` (PUT débouncé de 600 ms). On le
      // laisse finir AVANT de restaurer, sinon il écrase la restauration.
      await attendre(2000)
      const r = await restaurerUi()
      sessionStorage.removeItem(CLE_SESSION)
      console.log('[matrice] nettoyage fait, ui.json ' + (r.identique ? 'identique à l’original' : 'DIFFÉRENT — à vérifier'))
      return r
    },
    // Briques réutilisables (mise au point à la main).
    outils: {
      attendre, jusqua, sonder, signature, ecartSignatures, mesurerDessins,
      ouvrirDialog, fermerDialog, reglerInterrupteur, lireInterrupteur,
      editerPersonnage, choisirPersonnage, cliquerScene, essayerClicsSol,
      creerJetables, supprimerJetables, restaurerUi, api, L,
    },
  }

  window.matrice = matrice
  console.log('%c[matrice] prêt — matrice.jouer() pour dérouler, matrice.nettoyer() à la fin', 'color:#7ec8a9')
})()
