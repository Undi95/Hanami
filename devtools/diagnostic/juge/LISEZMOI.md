# Le juge biomécanique

**Est-ce que ça ressemble à un être humain ?** — et la réponse avec les chiffres qui la justifient.

Les mesures qui existaient déjà (`devtools/anim-lab/mesures.mjs`) disent si un clip
**s'emboîte** : écart de pose au raccord, qualité de boucle, vitesse au recollement. Elles ne peuvent
pas voir qu'un socle est une garde de combat, qu'un bras balance en phase avec sa jambe, ou que les
pieds sont enfouis de 6 cm dans le plancher. C'est ce trou-là que cet outil comble.

Il tourne **en pur Node, sans navigateur** : il monte le squelette humanoïde d'un vrai `.vrm` à la
main depuis le glTF (aucun mesh, aucune texture, aucun DOM), rejoue le clip par les interpolants, et
lit le corps image par image comme le ferait un kinésithérapeute devant une vidéo.

**Aucune dépendance npm ajoutée.** `three` et `@pixiv/three-vrm*` sont pris dans les `node_modules`
du projet. Lecture seule sur le dépôt ; l'outil n'écrit que dans `devtools/diagnostic-out/`
(gitignoré), et seulement si on le lui demande (`--json`).

---

## Comment l'appeler

Depuis la racine du dépôt (le juge y retrouve seul `vrm/`, `vrma/` et `node_modules/`).

```bash
JUGE="devtools/diagnostic/juge/juge.mjs"

node "$JUGE" world-walk                 # fiche de diagnostic d'un clip
node "$JUGE" world-walk --frises        # + le déroulé du clip en frises ASCII
node "$JUGE" idle nod shake             # plusieurs fiches d'affilée
node "$JUGE" --lot                      # les 32 clips, tableau + défauts groupés
node "$JUGE" --lot --tout               # idem, avec toutes les phrases de diagnostic
node "$JUGE" --comparer a b             # le même critère sur deux clips (avant / après retouche)
node "$JUGE" world-walk --tousvrm       # le même clip sur tous les .vrm du projet
node "$JUGE" world-walk --vrm=Cynthia   # sur un modèle précis (⚠ voir l'avertissement ci-dessous)
node "$JUGE" --lot --json=x.json        # sortie machine
```

`--tousvrm` répond à **la** question qui se pose dès qu'un critère échoue : *est-ce le clip ou le
rig ?* Il rejoue le clip sur tous les `.vrm` du dossier et marque chaque critère « verdict stable »
ou « verdict VARIABLE selon le modèle ». Un défaut qui tient sur tous les modèles est un défaut du
clip.

⚠ **Le modèle par défaut est une cible mouvante.** Sans `--vrm=`, l'outil prend le PREMIER `.vrm`
du dossier par ordre alphabétique — et le dossier vit : il est passé de 12 à 88 modèles EN COURS de
mission (le propriétaire y verse sa collection), et l'arrivée de `reference-2.vrm` a changé
le défaut sous nos pieds, décalant tous les cm-adulte d'une exécution à l'autre (27,8 → 30,4 cm
d'écartement pour le même `idle`). Rien de faux — chaque fiche imprime son modèle, le JSON le
consigne dans `meta.rig` — mais **deux exécutions ne se comparent qu'à modèle égal** : pour toute
mesure de référence, passer `--vrm=rig-temoin-hist` (le modèle des résultats committés ici).

## La sortie

Pour chaque clip : les critères applicables (déduits de la famille, elle-même déduite du **nom** du
fichier — la convention du projet, cf. `vrma/README.md`), la mesure, la fourchette attendue, un
verdict par critère, un verdict global, puis — c'est le livrable — **une phrase en français par
défaut constaté**, dite comme un humain la dirait devant l'écran :

> ✗ le pied ne se lève que de 2,2 cm sur tout le cycle : il ne décolle pas du sol, elle patine plus
> qu'elle ne marche.

Les frises (`--frises`) rendent le déroulé lisible dans un terminal : appuis des pieds, hauteur du
bassin, genoux, avancée des bras et des jambes (`▀` devant / `▄` derrière — l'opposition bras-jambes
s'y lit à l'œil), torsion du tronc, mouvements de tête.

---

## Les critères

### Universels — vrais sur tout clip

| critère | attendu | pourquoi |
|---|---|---|
| torsion du tronc (épaules / bassin, vue de dessus) | ≤ 45° | **le critère qui interdit de coller le haut d'une animation sur le bas d'une autre** |
| hyperextension du genou | ≤ 10° au-delà de la position tendue | un genou ne se casse pas à l'envers |
| axe de flexion du genou | ≤ 30° hors du plan de la jambe | un genou est une charnière, pas une rotule |
| flexion / hyperextension du coude | ≤ 155°, ≤ 15° | idem |
| vitesse angulaire de pointe | ≤ 800 °/s | au-delà, c'est un à-coup, pas un geste |
| enfoncement de la semelle | ≤ 2 cm (épaisseur de semelle) | les pieds ne rentrent pas dans le plancher |
| contact minimal avec le sol | ≈ 0 cm | ni ne flottent au-dessus |
| membre traversant le tronc | ≤ 45 % d'enfoncement | un bras posé contre le corps le frôle : c'est normal |

### Marche (`world-walk`, `-slow`, `-fast`, `-back`)

Toujours un pied au sol (0 % de vol) · double appui 10–20 % du cycle, **modulé par l'allure** ·
levée du pied oscillant ≥ 6 cm · symétrie du cycle (jambe G à *t* vs jambe D à *t*+T/2) ≤ 12 % ·
égalité des temps d'appui ≤ 8 % · oscillation verticale du bassin 4–6 cm, **deux fois par cycle** ·
oscillation latérale 3–5 cm, une fois par cycle · **opposition bras / jambes** (corrélation genou G ×
main G fortement négative) · longueur du pas 0,55–0,9 × la hauteur de hanche · genou porteur presque
tendu au passage à la verticale (≤ 25°) · pose talon d'abord.

### Assise (`world-sit-enter`, `-exit`, `-idle`, …)

Descente du bassin 40–50 % de la hauteur de hanche debout · inclinaison du tronc vers l'avant 10–30°
pendant la descente (un corps qui descend vertical tombe en arrière) · descente monotone (le bassin
ne remonte pas) · genou à 85–100° une fois assis · les mains ne traversent pas les cuisses.

### Repos debout (`idle`, `idle-talking`)

Pieds côte à côte (décalage avant-arrière ≤ 20 cm — **au-delà c'est une garde, pas un repos**) ·
écartement latéral 10–25 cm · mains ouvertes (phalanges ≤ 30°) · bras pendants · **respiration**
(bassin ≤ 2 cm, et une vie visible quelque part : buste ≥ 1° ou tête ≥ 2° ou mains ≥ 0,4 cm) ·
buste face à l'avant.

### Gestes de tête et salut

Hochement autour de l'axe **latéral**, dénégation autour de l'axe **vertical**, 12–40° crête à
crête, 2 à 3 allers-retours, sans que le tronc suive. Salut : main nettement au-dessus des épaules,
coude à 60–110°, 1,2–3,5 allers-retours par seconde, l'autre bras au repos.

---

## Les deux idées qui tiennent tout

**1. Toute longueur est une fraction de hauteur de hanche.** « Le bassin oscille de 5 cm » n'a aucun
sens sur un avatar de 1,20 m. On mesure en mètres sur le modèle, on divise par sa hauteur de hanche,
on compare à la fraction d'un adulte dont la hanche est à **0,93 m** (≈ 0,53 × 1,75 m, la proportion
anthropométrique usuelle). Tous les centimètres affichés sont des **cm-adulte**. La preuve que ça
marche : `world-sit-enter` rend « descente du bassin = 45,45 % » à la deuxième décimale près sur les
12 modèles, dont les hanches vont de 0,755 m à 1,201 m.

**2. Les axes du corps viennent de la géométrie, jamais d'un quaternion.** Le +Z local du bassin ne
désigne pas l'avant de la même façon d'un rig à l'autre. `haut × (épaule gauche → épaule droite)` est
indépendant de la version VRM et des conventions d'axes.

---

## Ce qu'il a fallu corriger en route

Ces pièges sont documentés dans le code, à l'endroit exact où ils mordent. Ils valent d'être connus :
tous produisaient des chiffres **crédibles et faux**.

- **L'épaule, c'est `upperArm`, pas `shoulder`.** Dans un VRM, `shoulder` est la racine de la
  clavicule, collée au rachis : sur `reference.vrm` les deux `shoulder` ne sont distantes que de
  **4 cm**. Toute la torsion du tronc se serait appuyée sur du bruit.
- **Le sol n'est pas l'os le plus bas.** La cheville est à 9,4 cm du sol et l'os des orteils à 3,5 cm.
  Mesurer la hauteur du pied sur les os faisait « flotter » de 9 cm un pied posé talon au sol, et
  rendait l'attaque talon indétectable. On ancre une fois pour toutes, dans le repère du pied, le
  **talon** et la **pointe** au niveau du sol, et ils suivent ensuite la rotation du pied.
- **Le repère des os normalisés ne pointe pas vers l'avant.** Un VRM 0.x regarde le −Z dans son
  espace propre ; la rotation de π que l'app applique à la scène emmène les os normalisés avec elle.
  En croyant la convention, le juge annonçait pour chaque coude une hyperextension **exactement égale
  à sa flexion**. Le sens est maintenant mesuré au repos, jamais supposé.
- **« L'appui recule » est faux en marche arrière.** Le détecteur d'appui signé rendait **81 % de
  phase de vol** sur `world-walk-back`. La dérive d'appui est maintenant estimée sur le clip, et le
  sens de marche tranché par la physique : on essaie les deux et on garde celui qui laisse un pied au
  sol. Une vraie course garderait du vol dans les deux hypothèses, donc reste détectable.
- **La hauteur seule ne dit pas quel pied porte.** Dans `world-walk-slow` les deux pieds restent en
  permanence à moins de 2,5 cm du sol : la hauteur ne discrimine rien. D'où le critère de **levée du
  pied oscillant**, né du débogage.
- **La charnière du genou se réfère à la cuisse, pas au bassin ni au pied.** Le bassin est faux dès
  que la jambe tourne sous le corps (les deux pivots étaient accusés à tort) ; le pied dégénère quand
  la pointe descend (pic à 83° en pleine oscillation). Le repère du nœud normalisé de la cuisse tourne
  avec la jambe et est défini par le format.
- **Un tronc dimensionné sur l'anthropométrie adulte engloutit les bras.** Dans ces `.vrm` les os
  `upperArm` sont plantés près du rachis : le juge criait « le bras traverse le tronc » sur un bras
  qui pendait normalement. Le tronc est dimensionné sur le modèle, et le bras — enraciné à l'épaule,
  il longe le tronc par construction — est exclu du test.
- **Compter les passages par la moyenne ment dans les deux sens.** `shake` fait un balayage
  droite-gauche franc qui ne repassait pas le seuil au retour : compté **zéro** oscillation. On compte
  maintenant les excursions alternées avec bande morte.
- **Une fourchette de marche dépend de l'allure.** Juger `world-walk-slow` avec le double appui d'une
  marche normale, c'est le condamner pour avoir été lent.
- **En marche arrière on se pose sur l'avant du pied.** Le critère d'attaque talon est déclaré sans
  objet plutôt que de sanctionner la bonne biomécanique.
- **Un salut, ce n'est pas « une main au-dessus des épaules ».** `happy` déclenchait, alors que la
  main n'y monte que de 5 cm : geste de joie bras levés, pas un bonjour. Et les allers-retours se
  comptent en **cadence**, sinon on punit la durée du clip et non le geste.
- **La respiration ne fait pas monter le bassin.** Les socles Overte respirent comme un humain
  debout : bassin immobile (0,06 cm), buste qui tangue de 2,9°, tête de 3,9°. Juger la vie sur la
  seule hauteur du bassin déclarait mort un clip vivant — le critère écoute maintenant aussi le
  buste, la tête et les mains, et ne se plaint que si TOUT est figé.
- **Une jambe presque tendue n'a pas de plan de flexion.** Sous ~12° de flexion, cuisse et tibia
  sont alignés et l'axe de leur produit vectoriel est du bruit : la déviation de charnière n'y est
  plus mesurée. Vérifié sur les pivots : leurs vraies déviations (58° !) tiennent à ≥ 17° de flexion,
  la garde ne masque rien.

## Ce que l'outil ne sait pas juger

- **Le salut** : aucun des 32 clips ne satisfait les conditions de détection (main ≥ 10 cm au-dessus
  des épaules, ≥ 0,4 s, balayage latéral ≥ 10 cm). Les critères sont écrits et actifs, mais **n'ont
  jamais été éprouvés sur une vraie donnée**. Le clip le plus proche est `happy` (5,4 cm).
- **L'hyperextension du coude n'est jugée que sous 45° de flexion.** Au-delà, le twist huméral
  retourne la référence du signe : bras levé à l'horizontale, un lever de main normal
  (`world-sit-raise-hand`, flexion 108°) était déclaré « plié à l'envers ». Une hyperextension est
  par définition un phénomène de petit angle, la restriction ne coûte donc rien — mais un coude qui
  se casserait à l'envers EN GRAND angle passerait sous ce radar.
- **Les pivots** (`world-turn-*`) n'ont que les critères universels. La rotation par cycle n'est pas
  mesurable de façon fiable sur un clip joué sur place (la cheville tourne activement pendant le
  pivot, rien ne sépare les deux) — c'est déjà documenté dans `devtools/anim-lab/mesures.mjs`, et le juge ne
  fait pas mieux.
- **Les allures de course (`jog`, `run`), les pas chassés (`strafe`, `step`), les gestes tenus en
  trois temps (`clap`, `point`, `raise-hand` du monde) et les repos alternés (`idle-alt`)** n'ont pas
  de fourchettes propres : seuls les critères universels s'appliquent. **La fiche le dit** — une
  ligne « critères propres à … : aucun » apparaît, pour qu'un silence ne passe pas pour un
  blanc-seing. Une course jugée avec les critères de marche serait condamnée pour voler : il lui faut
  ses propres fourchettes (vol 10–40 %, double appui nul), pas celles d'à côté.
- **L'écartement latéral des pieds** est le seul critère dont le verdict change d'un `.vrm` à
  l'autre (23,9 à 32,1 cm pour `idle` sur les 12 modèles d'origine ; il explose sur les chibis à
  hanches basses arrivés depuis). Il dépend de la largeur de bassin du rig, que la hauteur de hanche
  ne normalise pas. À lire comme « à la limite haute », pas comme un défaut ferme.
- **Trois modèles sont HORS-GABARIT anthropométrique** et les fourchettes du juge ne leur sont pas
  opposables : `5661047213623940145.vrm` (chibi, hanches 0,328 m — écartement jusqu'à 37 cm-adulte),
  `RigMascotte.vrm` (rig mascotte 0,547 m, SANS os `neck`, jambes 0,68 × hanches —
  traverse son tronc en course, charnière de genou jusqu'à 50°), `7312138852387622699.vrm` (0,628 m).
  Leurs « défauts » sur ces critères sont des proportions de modèle, pas des défauts de clips — à
  étiqueter, jamais à corriger (liste détaillée : `devtools/anim-lab/LISEZMOI.md`, passe des 94).
- **Le visage, le regard, les expressions** : hors périmètre, les pistes correspondantes sont ignorées.
- **L'esthétique** : le juge dit qu'un mouvement est *plausible*, pas qu'il est *joli*.
- **Le sol-enfoncement ASSIS et d'allure est un verdict HORS SCÈNE.** Le juge rejoue le clip nu ;
  l'app, elle, passe chaque image dans `client/src/scene/legIk.ts` (`'reach'` assis : le pied VISE le
  sol ; `'planted'` debout : un pied qui traverse est remonté). Mesuré le 2026-08-01 en exécutant les
  VRAIES sources du client sur quatre gabarits (0,33 → 1,25 m de hanches) : `world-sit-idle` passe de
  −54…−178 mm (clip nu, pire semelle) à **−1,2…−5,1 mm** avec l'IK, `world-sit-enter` de −69…−243 à
  −4…−12 mm. Le défaut « 94/94 modèles » de la matrice n'existe donc pas en scène pour l'assise — ne
  PAS retoucher les clips assis pour ça. En marche/course, l'IK plante les TALONS (0,0 mm) mais la
  POINTE en fin d'appui appartient au clip (l'IK suit la projection de la cheville et rend au pied
  l'orientation du clip) : le résidu d'orteils reste à lire sur les planches, pas à corriger par l'IK.

## Les contre-épreuves

Le juge a lui-même été jugé avant d'être cru, par des chemins de calcul indépendants (le rig FBX
d'`idle-lib.mjs`, aux proportions de la source Overte — pas le `.vrm` du juge). Les deux premières
tournaient sur ce rig FBX, qui est un sous-produit de la conversion des clips et n'est **pas livré**
avec le dépôt : leurs scripts n'ont pas été conservés, seul leur résultat compte.

- `shake` : la trace image par image du lacet de tête confirme « un grand balayage droite-gauche
  puis un retour amorti » — le « 1 seul aller-retour » du juge est honnête.
- Assise : sur le rig aux proportions de la source, les orteils de `world-sit-idle` passent déjà
  **4,1 cm sous le sol** (5,2 cm pour `world-sit-enter`) — l'enfoncement des pieds assis est dans
  les fichiers, pas dans les modèles. `--tousvrm` le confirme sur les 12 `.vrm` (5,3 à 8,6
  cm-adulte selon les jambes du modèle).
- `_verif-respire.mjs` — où vit la respiration d'`idle` (buste 2,9°, bassin 0,06 cm) ; c'est lui qui
  a fait corriger le critère.
- `_verif-charniere.mjs` — la déviation de charnière des pivots persiste à flexion ≥ 20° : c'est le
  clip, pas le conditionnement numérique.
- `_verif-hyper.mjs` — la géométrie brute des deux « hyperextensions » signalées hors du lot
  canonique : celle de `world-run` est VRAIE (le genou passe 13,8 cm derrière la corde
  hanche-cheville pendant la poussée — la jambe s'arque à l'envers), celle de
  `world-sit-raise-hand` était un faux positif de signe (d'où la restriction à ≤ 45° de flexion).

## Les fichiers

| fichier | rôle |
|---|---|
| `rig.mjs` | monte un `.vrm` en squelette seul, charge un `.vrma`, échelle, sol, points de semelle |
| `anatomie.mjs` | rejoue le clip et en extrait la trace image par image — **ne juge rien** |
| `criteres.mjs` | les critères, les fourchettes, les verdicts et les phrases françaises |
| `trace.mjs` | les frises ASCII du déroulé |
| `juge.mjs` | la ligne de commande : fiche, lot, comparaison, multi-modèles |

Le découpage suit celui du banc d'essai (`devtools/anim-lab/`) : un noyau de mesure pur, importable ailleurs (aucun accès
disque, aucune horloge, `THREE` injecté par `rig.mjs`), et une ligne de commande qui n'imprime que.
`anatomie.mjs` et `criteres.mjs` peuvent être chargés par une page web sans modification.

> Piège hérité, respecté partout : ne **jamais** échantillonner à `t = durée` — `LoopRepeat` reboucle
> exactement là et rend la première image. On échantillonne à `durée − 1e-4`.
