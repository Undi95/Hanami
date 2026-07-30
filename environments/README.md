# Décors 3D

Dépose ici des fichiers `.glb` (ou `.gltf`) — ils apparaissent dans Hanami
(création/édition de personnage → menu « Décor 3D »). Le décor remplace le fond
2D : l'avatar est posé DANS la pièce.

## Format attendu

- **Unités : mètres**, axe **Y vers le haut** (convention glTF).
- **Origine au sol**, à l'endroit où le personnage doit se tenir. Hanami cale
  quand même le décor sur le sol et ne corrige l'échelle que si elle est absurde
  (hauteur hors de l'intervalle 1,5 m – 12 m), mais un modèle propre évite tout
  ajustement automatique.
- **Autoportant** : textures embarquées dans le `.glb`. Les fichiers `.gltf` qui
  référencent des textures externes doivent avoir ces fichiers à côté d'eux.
- **Compression Draco / meshopt / KTX2 non prise en charge** : le décor est
  refusé avec un message d'erreur clair. Réexporte sans compression.

## Placement (sidecar `.json`, optionnel)

À côté de `chambre.glb`, un `chambre.json` ajuste le placement sans toucher au modèle :

```json
{
  "scale": 1,
  "rotationY": 0,
  "spawn": [0, 0, 0],
  "exposure": 1
}
```

- `scale` — facteur d'échelle (0,01 à 100). Le donner **désactive l'ajustement
  automatique** : c'est votre valeur qui fait foi, même si elle est extravagante.
- `rotationY` — rotation en **degrés** autour de l'axe vertical.
- `spawn` — point du décor `[x, y, z]`, en mètres, où poser le personnage : c'est
  le décor qui se déplace, l'avatar reste à l'origine du monde. `x`/`z` se
  mesurent sur le décor tel qu'il s'affiche (après `scale` et `rotationY`), et `y`
  se compte **depuis le sol** du décor — `[0, 1.2, 0]` pose le personnage sur une
  estrade de 1,2 m.
- `exposure` — multiplicateur des **couleurs des matériaux du décor** (0,1 à 4)
  pour un décor déjà sombre ou déjà très clair. Il n'agit pas sur les lumières :
  deux des trois décors livrés sont `KHR_materials_unlit` et les ignorent
  totalement. L'avatar, lui, n'est jamais touché. Attention, comme partout ici,
  une valeur **hors bornes est ignorée**, donc repli sur 1 (décor intact) : écrire
  `4.5` rend un décor plus sombre qu'attendu, pas plus clair.

Toutes les clés sont facultatives ; une clé inconnue ou une valeur invalide est
ignorée en silence.

## À savoir

- Le canvas est **transparent** : un décor troué (pas de plafond, pas de mur
  derrière la caméra) laisse voir le dégradé de l'app. C'est **voulu** — le repli
  naturel, pas un bug.
- Les `.glb` **ne sont pas committés** individuellement : chaque décor a sa propre
  licence. Ceux livrés avec l'app sont crédités dans `CREDITS.md` (CC0 ou CC-BY).
- Une capture (bouton photo) prend l'avatar **et** le décor derrière lui.
- Le poids compte : un décor de 100 Mo se charge lentement sur téléphone.

---

# 3D environments

Drop `.glb` (or `.gltf`) files here — they show up in Hanami (create/edit
character → “3D environment” menu). An environment replaces the 2D background:
the avatar stands INSIDE the room.

## Expected format

- **Units: meters**, **Y up** (glTF convention).
- **Origin on the floor**, where the character should stand. Hanami still snaps
  the environment to the ground and only fixes absurd scaling (height outside the
  1.5 m – 12 m range), but a clean model avoids any automatic adjustment.
- **Self-contained**: textures embedded in the `.glb`. A `.gltf` referencing
  external textures needs those files next to it.
- **Draco / meshopt / KTX2 compression is not supported**: such a file is
  rejected with a clear error. Re-export without compression.

## Placement (optional `.json` sidecar)

Next to `room.glb`, a `room.json` tunes placement without touching the model:

```json
{
  "scale": 1,
  "rotationY": 0,
  "spawn": [0, 0, 0],
  "exposure": 1
}
```

- `scale` — scale factor (0.01 to 100). Providing it **disables the automatic
  adjustment**: your value wins, however extravagant.
- `rotationY` — rotation in **degrees** around the vertical axis.
- `spawn` — the point `[x, y, z]` of the environment, in meters, where the
  character stands: the environment moves, the avatar stays at the world origin.
  `x`/`z` are measured on the environment as displayed (after `scale` and
  `rotationY`), and `y` counts **from the floor** — `[0, 1.2, 0]` puts the
  character on a 1.2 m platform.
- `exposure` — multiplier applied to the **colors of the environment materials**
  (0.1 to 4), for an environment that is already dark or already very bright. It
  does not touch the lights: two of the three shipped environments are
  `KHR_materials_unlit` and ignore them entirely. The avatar is never affected.
  Beware, as everywhere here, an **out-of-range value is ignored** and falls back
  to 1 (environment untouched): writing `4.5` gives a darker room, not a lighter one.

Every key is optional; an unknown key or an invalid value is silently ignored.

## Good to know

- The canvas is **transparent**: an open environment (no ceiling, no wall behind
  the camera) lets the app gradient show through. That is **intended** — the
  natural fallback, not a bug.
- The `.glb` files are **not committed** individually: each environment has its
  own license. The ones shipped with the app are credited in `CREDITS.md` (CC0 or
  CC-BY).
- A snapshot (photo button) captures the avatar **and** the room behind it.
- Size matters: a 100 MB environment loads slowly on a phone.
