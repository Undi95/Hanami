[English](CLOUDFLARE.md) | **Français**

# Accès distant via Cloudflare Tunnel

Objectif : accéder à Hanami depuis l'extérieur (4G, en déplacement, au travail) **sans ouvrir de port**
sur ta box, avec HTTPS automatique.

À lire aussi : [MOBILE.fr.md](MOBILE.fr.md) · [retour au README](../README.fr.md)

## 1. Prérequis

- Un compte Cloudflare (gratuit) avec ton domaine ajouté — ou un sous-domaine
  `*.trycloudflare.com` jetable, qui ne demande aucun compte.
- `cloudflared` installé : <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>

## 2. Test rapide (URL jetable, sans compte)

Lance d'abord Hanami **en mode production** (`npm run build` puis `npm start`), puis :

⚠️ **Ne pointe JAMAIS le tunnel vers `npm run dev`** : le mode dev expose l'outillage Vite
(comme l'endpoint `/@fs/`) qui peut servir des fichiers locaux — seule une instance de
production doit être exposée.

```bash
cloudflared tunnel --url http://localhost:7788
```

Cloudflare affiche une URL `https://xxxx.trycloudflare.com` → ouvre-la depuis ton téléphone.
⚠️ L'URL change à chaque lancement — pratique pour tester, pas pour tous les jours.

## 3. Tunnel permanent (recommandé)

```bash
cloudflared tunnel login
cloudflared tunnel create hanami
cloudflared tunnel route dns hanami hanami.ton-domaine.tld
```

Crée `%UserProfile%\.cloudflared\config.yml` :

```yaml
tunnel: hanami
credentials-file: C:\Users\<toi>\.cloudflared\<uuid>.json
ingress:
  - hostname: hanami.ton-domaine.tld
    service: http://localhost:7788
  - service: http_status:404
```

Puis :

```bash
cloudflared tunnel run hanami
```

Pour le lancer automatiquement au démarrage de Windows :

```bash
cloudflared service install
```

## 4. Sécurité — indispensable avant d'exposer

1. **Mot de passe Hanami** : ⚙️ *Réglages* → « Mot de passe d'accès ». Sans lui, n'importe qui
   avec l'URL peut lire tes conversations.
2. **Mieux : Cloudflare Access** (gratuit jusqu'à 50 utilisateurs) : dans le dashboard
   Zero Trust → Access → Applications, ajoute `hanami.ton-domaine.tld` avec une policy
   « Emails autorisés : ton@email.com ». Cloudflare exige alors un code par e-mail avant même
   d'atteindre Hanami. Les deux protections se cumulent — garde les deux.
3. Ne partage l'URL avec personne en qui tu n'as pas confiance : le backend LLM et les outils
   fichiers tournent sur **TA** machine.

## 5. Note

Le PC (et ton backend LLM local) doivent rester allumés pour que Hanami réponde à distance.
Pense à désactiver la mise en veille (Paramètres Windows → Alimentation).
