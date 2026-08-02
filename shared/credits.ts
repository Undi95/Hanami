// Crédits de Hanami — LA liste, écrite une seule fois, lue par le seul écran
// « Réglages → Crédits ».
//
// POURQUOI CET ÉCRAN EXISTE : les décors 3D sont en CC BY 4.0, et cette licence
// exige que l'attribution « reste accessible aux utilisateurs de l'application »
// (environments/CREDITS.md). Un fichier dans le dépôt n'est pas accessible à
// quelqu'un qui utilise l'app : il fallait un écran.
//
// CE QUE CE FICHIER NE PORTE PAS, VOLONTAIREMENT : les décors. Chaque `.glb`
// embarque son attribution dans `asset.extras` (titre, auteur, licence, page du
// modèle), écrite là par l'export Sketchfab. C'est cette copie-là que l'écran
// affiche, relue à chaque ouverture par server/api/credits.ts. Conséquence : un
// décor déposé demain dans environments/ est crédité tout seul, et aucune liste
// tenue à la main ne peut diverger des fichiers réellement livrés — ce qui est
// précisément le risque que la CC BY fait courir.
//
// Ici vit donc ce qu'AUCUN asset ne sait dire de lui-même : les animations (un
// .vrma ne porte pas de champ de licence), la police, et les briques de code.
// Cette liste-là ne bouge qu'en même temps que package.json ou que
// vrma/NOTICE.md.
//
// Une seule exception à la règle « lu dans le fichier » : l'avatar d'exemple.
// Un .vrm SAIT se décrire (l'objet `meta` de son extension VRMC_vrm), mais il
// n'y en a qu'un seul de livré, jamais deux, et sa licence exige d'être citée —
// une entrée écrite ici coûte moins qu'un lecteur de méta au démarrage.
//
// Le détail juridique — correspondance fichier par fichier, avis intégraux —
// reste dans NOTICE.md, vrma/NOTICE.md et environments/CREDITS.md. Cet écran
// donne le crédit ; ces trois fichiers le documentent.

/** Un texte dans les deux langues de l'app. `tsc` exige les deux. */
export interface Bilingual {
  fr: string
  en: string
}

/**
 * Un libellé qui n'a pas toujours besoin d'être traduit : « Apache-2.0 » et
 * « pixiv » s'écrivent pareil des deux côtés, « Libre — remerciement exigé »
 * non. La forme courte est donc admise là où traduire n'aurait aucun sens.
 */
export type Label = string | Bilingual

/** Un libellé dans la langue demandée. */
export function labelOf(label: Label, lang: keyof Bilingual): string
export function labelOf(label: Label | undefined, lang: keyof Bilingual): string | undefined
export function labelOf(label: Label | undefined, lang: keyof Bilingual): string | undefined {
  if (label === undefined) return undefined
  return typeof label === 'string' ? label : label[lang]
}

/** Une ligne de crédit : qui, quoi, sous quelle licence, et où le vérifier. */
export interface CreditEntry {
  /** Nom de l'œuvre ou du projet. Sert aussi de libellé au lien. */
  title: string
  /** Page de l'œuvre (dépôt, site, page du modèle). Absent = pas de lien. */
  url?: string
  /** Auteur tel qu'il souhaite être nommé. */
  author?: Label
  /** Page de l'auteur. */
  authorUrl?: string
  /** Licence telle qu'elle s'écrit (« Apache-2.0 », « CC0 1.0 »…). */
  license: Label
  /** Texte de la licence. */
  licenseUrl?: string
  /** Une phrase : ce que ça fait dans Hanami. */
  note: Bilingual
}

/**
 * Attribution d'un décor, LUE dans le `.glb` — jamais recopiée à la main.
 * Les champs vides signalent une attribution absente du fichier : l'écran le
 * dit alors en clair plutôt que de laisser passer un CC BY non crédité.
 */
export interface EnvironmentCredit {
  /** Nom du fichier, seule chose qu'on est sûr de connaître. */
  file: string
  title: string
  /** Page du modèle chez l'éditeur (`asset.extras.source`). */
  url: string
  author: string
  authorUrl: string
  license: string
  licenseUrl: string
}

/** Les quatre familles d'animations. Overte est aussi une source de CODE. */
export const ANIMATION_CREDITS: readonly CreditEntry[] = [
  {
    title: 'Overte',
    url: 'https://github.com/overte-org/overte',
    author: 'High Fidelity, Vircadia, Overte e.V.',
    license: 'Apache-2.0',
    licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
    note: {
      fr:
        'La majorité des animations, faites à la main dans Maya, et leur graphe de transitions. ' +
        'Hanami en reprend aussi, porté en TypeScript, le cœur de son moteur d’animation : ' +
        'cinématique inverse, limites articulaires, regard, poses de main. Code repris de ' +
        'Anthony J. Thibault, Andrew Meadows, Angus Antley, Luis Cuenca, Howard Stearns, ' +
        'Seth Alves, Stephen Birarda et Mark Peng.',
      en:
        'Most of the animations, hand-made in Maya, and their transition graph. Hanami also ' +
        'takes from it, ported to TypeScript, the heart of its animation engine: inverse ' +
        'kinematics, joint limits, gaze, hand poses. Code ported from Anthony J. Thibault, ' +
        'Andrew Meadows, Angus Antley, Luis Cuenca, Howard Stearns, Seth Alves, ' +
        'Stephen Birarda and Mark Peng.',
    },
  },
  {
    title: 'Microsoft Rocketbox',
    url: 'https://github.com/microsoft/Microsoft-Rocketbox',
    author: '© Microsoft Corporation (2020)',
    license: 'MIT',
    licenseUrl: 'https://opensource.org/license/mit',
    note: {
      fr:
        'La seconde famille de gestes du face à face — dont les postures d’écoute, jouées ' +
        'pendant que vous tapez.',
      en:
        'The second face-to-face gesture family — including the listening postures played ' +
        'while you are typing.',
    },
  },
  {
    title: 'Quaternius — Universal Animation Library',
    url: 'https://quaternius.com',
    author: 'Quaternius',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    note: {
      fr: 'S’asseoir et se lever. Domaine public : aucune attribution exigée, on la donne quand même.',
      en: 'Sitting down and standing up. Public domain: no attribution required, we give it anyway.',
    },
  },
  {
    title: 'CMU Graphics Lab Motion Capture Database',
    url: 'https://mocap.cs.cmu.edu',
    author: {
      fr: 'Carnegie Mellon University — conversion BVH de Bruce Hahne (cgspeed)',
      en: 'Carnegie Mellon University — BVH conversion by Bruce Hahne (cgspeed)',
    },
    authorUrl: 'https://www.cgspeed.com',
    license: { fr: 'Libre — remerciement exigé', en: 'Free — acknowledgement required' },
    note: {
      fr:
        'Plus aucun fichier livré n’en dérive, mais le travail a servi. Le remerciement que la ' +
        'base exige : « The data used in this project was obtained from mocap.cs.cmu.edu. ' +
        'The database was created with funding from NSF EIA-0196217. »',
      en:
        'No shipped file derives from it any more, but the work served. The acknowledgement the ' +
        'database requires: "The data used in this project was obtained from mocap.cs.cmu.edu. ' +
        'The database was created with funding from NSF EIA-0196217."',
    },
  },
]

/**
 * L'avatar d'exemple : le SEUL modèle 3D livré avec l'app, celui que porte Hana
 * au premier lancement. Il est ici parce que sa licence l'exige — ses conditions
 * embarquées portent `creditNotation: "required"` —, et il est là tout court
 * parce qu'il est le seul du genre à porter `allowRedistribution: true` : la
 * quasi-totalité des modèles VRM gratuits autorisent l'usage et interdisent la
 * redistribution. Preuve recopiée dans `vrm/Seed-san.LICENCE.txt`.
 */
export const AVATAR_CREDITS: readonly CreditEntry[] = [
  {
    title: 'Seed-san',
    url: 'https://github.com/vrm-c/vrm-specification/tree/master/samples/Seed-san',
    author: 'VirtualCast, Inc.',
    license: 'VRM Public License 1.0',
    licenseUrl: 'https://vrm.dev/licenses/1.0/',
    note: {
      fr:
        'L’avatar de Hana, et le seul modèle 3D livré avec Hanami : le modèle d’exemple officiel ' +
        'du VRM Consortium, dont les conditions embarquées autorisent explicitement la ' +
        'redistribution et exigent cette mention.',
      en:
        'Hana’s avatar, and the only 3D model shipped with Hanami: the VRM Consortium’s official ' +
        'sample model, whose embedded terms explicitly allow redistribution and require this ' +
        'credit.',
    },
  },
]

/** La police de toute l'interface. */
export const FONT_CREDITS: readonly CreditEntry[] = [
  {
    title: 'Mulish',
    url: 'https://github.com/googlefonts/mulish',
    author: 'The Mulish Project Authors',
    license: 'SIL Open Font License 1.1',
    licenseUrl: 'https://openfontlicense.org',
    note: {
      fr: 'Toute la typographie. L’OFL n’exige pas cette mention : on la donne quand même.',
      en: 'Every piece of type. The OFL does not require this notice: we give it anyway.',
    },
  },
]

/** Les briques de code. Aucune n'exige d'être citée ici ; toutes le sont. */
export const CODE_CREDITS: readonly CreditEntry[] = [
  {
    title: 'vrm-c/bvh2vrma',
    url: 'https://github.com/vrm-c/bvh2vrma',
    author: 'VRM Consortium',
    license: 'MIT',
    licenseUrl: 'https://opensource.org/license/mit',
    note: {
      fr: 'La référence sur laquelle nos convertisseurs d’animations ont été écrits.',
      en: 'The reference our animation converters were written against.',
    },
  },
  {
    title: 'three.js',
    url: 'https://threejs.org',
    author: { fr: 'mrdoob et ses contributeurs', en: 'mrdoob and contributors' },
    license: 'MIT',
    licenseUrl: 'https://opensource.org/license/mit',
    note: { fr: 'Tout le rendu 3D.', en: 'All of the 3D rendering.' },
  },
  {
    title: '@pixiv/three-vrm',
    url: 'https://github.com/pixiv/three-vrm',
    author: 'pixiv',
    license: 'MIT',
    licenseUrl: 'https://opensource.org/license/mit',
    note: {
      fr: 'Le chargement des modèles VRM, le rig humanoïde et la lecture des .vrma. Sans lui, pas d’avatar.',
      en: 'VRM model loading, the humanoid rig and .vrma playback. Without it there is no avatar.',
    },
  },
  {
    title: 'React',
    url: 'https://react.dev',
    author: { fr: 'Meta et ses contributeurs', en: 'Meta and contributors' },
    license: 'MIT',
    licenseUrl: 'https://opensource.org/license/mit',
    note: { fr: 'L’interface.', en: 'The interface.' },
  },
  {
    title: 'Express',
    url: 'https://expressjs.com',
    author: { fr: 'TJ Holowaychuk et ses contributeurs', en: 'TJ Holowaychuk and contributors' },
    license: 'MIT',
    licenseUrl: 'https://opensource.org/license/mit',
    note: { fr: 'Le serveur.', en: 'The server.' },
  },
  {
    title: 'Vite',
    url: 'https://vite.dev',
    author: { fr: 'Evan You et ses contributeurs', en: 'Evan You and contributors' },
    license: 'MIT',
    licenseUrl: 'https://opensource.org/license/mit',
    note: { fr: 'Le build et le serveur de développement.', en: 'The build and the dev server.' },
  },
  {
    title: 'TypeScript',
    url: 'https://www.typescriptlang.org',
    author: 'Microsoft',
    license: 'Apache-2.0',
    licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
    note: { fr: 'Le langage.', en: 'The language.' },
  },
  {
    title: 'tsx',
    url: 'https://github.com/privatenumber/tsx',
    author: 'Hiroki Osame',
    license: 'MIT',
    licenseUrl: 'https://opensource.org/license/mit',
    note: { fr: 'L’exécution directe du TypeScript côté serveur.', en: 'Running TypeScript directly on the server.' },
  },
]

/** Licence de Hanami lui-même. */
export const APP_LICENSE = { name: 'AGPL-3.0', url: 'https://www.gnu.org/licenses/agpl-3.0.html' } as const
