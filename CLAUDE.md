# Hanami — consignes de développement

## Serveurs et liens

- Application : `npm run dev` → **http://localhost:7788**
- Banc d'essai d'animations : double-cliquer `devtools/anim-lab/LANCER-LE-BANC.cmd`
  (ou `node devtools/anim-lab/serve.mjs`) → **http://localhost:7799**

## Pièges connus — ne pas les redécouvrir

- L'app et le banc se testent UNIQUEMENT via `http://localhost:<port>`.
  JAMAIS `file://` (les imports ESM et les appels `/api` sont morts),
  JAMAIS `127.0.0.1` (origine bloquée par le pane de prévisualisation).
  La page du banc se redirige d'elle-même si on se trompe, mais autant ne pas se tromper.
- Ne JAMAIS tester sur les données réelles de l'utilisateur (`data/`, personnages
  existants). Créer un personnage jetable, et sauvegarder/restaurer `data/ui.json`
  via `PUT /api/ui` (merge superficiel ; une clé à `null` la supprime).
- `vrma/` et `environments/` sont suivis par git VOLONTAIREMENT (assets sous licence
  libre, crédités). Ne pas ajouter de règle `.gitignore` par extension (`*.glb`,
  `*.vrma`…) qui les masquerait — voir les commentaires de `.gitignore`.
- `client/` n'utilise pas `@types/three` : les shims sont écrits à la main dans
  `client/src/scene/three-shims.d.ts`. Ne pas installer de dépendance npm.
- React sans StrictMode, volontairement. Ne pas le réintroduire.

## Commits

- Messages en français, un commit par étape.
- Signature : `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
