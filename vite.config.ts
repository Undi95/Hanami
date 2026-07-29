import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  // L'endpoint dev /@fs/ ne doit JAMAIS servir data/ (config, chats, mémoire).
  server: { fs: { deny: ['**/data/**'] } },
  // Mode middleware (serveur Express) : sans dédup explicite, react peut être
  // résolu en double (copie pré-bundlée + copie brute) → « Invalid hook call ».
  resolve: { dedupe: ['react', 'react-dom'] },
  // TOUTES les deps dans la première passe d'optimisation : une re-optimisation
  // en cours de session (ex. au lazy-import de la scène three) rebundlerait react
  // sous un nouveau hash → deux copies de React → « Invalid hook call ».
  optimizeDeps: {
    include: [
      'react',
      'react-dom/client',
      'react/jsx-dev-runtime',
      'three',
      '@pixiv/three-vrm',
      'three/examples/jsm/loaders/GLTFLoader.js',
      'three/examples/jsm/controls/OrbitControls.js',
    ],
  },
})
