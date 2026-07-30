[English](MOBILE.md) | **Français**

# Hanami sur téléphone

À lire aussi : [CLOUDFLARE.fr.md](CLOUDFLARE.fr.md) · [retour au README](../README.fr.md)

## Accès

- **Même Wi-Fi que le PC** : ouvre `http://<ip-du-pc>:7788`. L'IP réseau s'affiche dans la
  console au démarrage de Hanami.
- **Depuis l'extérieur** (4G/5G, en déplacement…) : via un tunnel Cloudflare →
  [CLOUDFLARE.fr.md](CLOUDFLARE.fr.md).

## Installer comme une app (PWA)

### Android (Chrome)

1. Ouvre l'URL de Hanami.
2. Menu ⋮ → **« Ajouter à l'écran d'accueil »** (ou « Installer l'application »).
3. Hanami s'ouvre en plein écran, sans barre d'adresse.

### iPhone / iPad (Safari)

1. Ouvre l'URL de Hanami.
2. Bouton Partager □↑ → **« Sur l'écran d'accueil »**.

## Astuces

- L'interface mobile affiche l'avatar en plein écran avec le chat en feuille basse — tire la
  poignée vers le bas pour voir le personnage en grand.
- La dictée (bouton micro à côté du champ) exige un contexte sécurisé — HTTPS ou localhost : via
  un tunnel Cloudflare c'est bon ; sur une simple adresse réseau `http://<ip-du-pc>:7788` le
  bouton peut ne pas apparaître du tout.
- Le rendu 3D se met en pause quand l'app passe en arrière-plan (économie de batterie).
- Si la connexion est lente (Wi-Fi public…), le chat fonctionne même pendant le chargement du
  modèle 3D : le texte n'attend jamais l'avatar.
- Si tu exposes Hanami hors de ton réseau, mets d'abord un mot de passe d'accès — voir la
  section sécurité de [CLOUDFLARE.fr.md](CLOUDFLARE.fr.md).
