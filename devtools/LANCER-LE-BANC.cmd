@echo off
rem Banc d'essai d'animations VRM de Hanami — lanceur autonome (Windows).
rem Double-clique ce fichier : le banc tourne dans SA fenetre, a lui.
rem Ferme la fenetre pour l'arreter. Le serveur Hanami (npm run dev) doit tourner.
rem Sous Linux / macOS, l'equivalent : node devtools/anim-lab/serve.mjs
title Banc d'essai Hanami
cd /d "%~dp0"
echo Banc d'essai : http://localhost:7799/  (Ctrl+clic ou copie dans ton navigateur)
node anim-lab\serve.mjs
pause
