import { Toile, COULEURS } from './png.mjs'
const t = new Toile(760, 300, COULEURS.fond)
const L = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789 .,:;!?()[]{}<>',
  '+-*/=%#@&_|~^`\'"\\$',
  'échelle côté début arrêt ça où hâte',
  'world-walk  t=0.42 s  1,25 m/s  53°',
  'pied G au sol → bassin ↑ 12 cm',
]
let y = 12
for (const s of L) { t.texte(12, y, s, COULEURS.encre, 2); y += 24 }
y += 8
t.texte(12, y, 'echelle 1 : world-walk t=0.42 s vitesse 1.25 m/s angle 53°', COULEURS.encre, 1); y += 14
t.texte(12, y, 'echelle 3 : ABC abc 123', COULEURS.encre, 3); y += 34
t.texte(12, y, 'gj pq y descendent : gjpqy GJPQY', COULEURS.encre, 2)
t.ecrire(process.argv[2])
console.log('ok', process.argv[2])
