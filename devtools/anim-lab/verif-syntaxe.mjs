// Contrôle de syntaxe du module inline d'index.html, sans navigateur.
import fs from 'node:fs'
import path from 'node:path'
const LAB = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.slice(1))))
const h = fs.readFileSync(path.join(LAB, 'index.html'), 'utf8')
const m = h.match(/<script type="module">([\s\S]*?)<\/script>/)
if (!m) { console.error('module inline introuvable'); process.exit(1) }
const src = m[1]
console.log(`module inline : ${src.length} octets, ${src.split('\n').length} lignes`)
const tmp = path.join(LAB, '_inline.mjs')
// Le module utilise document/window : on ne l'EXÉCUTE pas, on le fait seulement
// analyser par le compilateur en l'important dynamiquement derrière un `if (false)`.
fs.writeFileSync(tmp, 'if (globalThis.__jamais) {\n' + src + '\n}\n')
try {
  await import('file:///' + tmp.replace(/\\/g, '/').replace(/ /g, '%20'))
  console.log('SYNTAXE OK')
} catch (e) {
  console.error('SYNTAXE REFUSÉE :', e.message)
  if (e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'))
  process.exitCode = 1
} finally {
  fs.unlinkSync(tmp)
}
