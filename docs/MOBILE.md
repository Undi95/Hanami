# Hanami sur téléphone

## Accès

- **Même Wi-Fi que le PC** : ouvre `http://<ip-du-pc>:7788` (l'IP réseau s'affiche dans la
  console au démarrage de Hanami).
- **Depuis l'extérieur** (4G/5G, en déplacement…) : via Cloudflare Tunnel → [CLOUDFLARE.md](CLOUDFLARE.md).

## Installer comme une app (PWA)

### Android (Chrome)
1. Ouvre l'URL de Hanami.
2. Menu ⋮ → **« Ajouter à l'écran d'accueil »** (ou « Installer l'application »).
3. Hanami s'ouvre en plein écran, sans barre d'adresse.

### iPhone / iPad (Safari)
1. Ouvre l'URL de Hanami.
2. Bouton Partager □↑ → **« Sur l'écran d'accueil »**.

## Astuces

- L'interface mobile affiche l'avatar en plein écran avec le chat en feuille basse —
  tire la poignée vers le bas pour voir le personnage en grand.
- Le rendu 3D se met en pause quand l'app est en arrière-plan (économie de batterie).
- Si la connexion est lente (Wi-Fi public…), le chat fonctionne même si le modèle 3D met du
  temps à charger — le texte n'attend jamais la 3D.
