// Découpe et agrandit une région d'un PNG produit par le banc, pour inspection.
// node _crop.mjs <src.png> <dst.png> <x> <y> <w> <h> [zoom]
import fs from 'node:fs'
import zlib from 'node:zlib'
import { encoderPNG } from './png.mjs'

function lirePNG(f) {
  const b = fs.readFileSync(f)
  let o = 8, w = 0, h = 0, bits = 0, type = 0
  const idat = []
  while (o < b.length) {
    const lg = b.readUInt32BE(o)
    const t = b.toString('ascii', o + 4, o + 8)
    const d = b.subarray(o + 8, o + 8 + lg)
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bits = d[8]; type = d[9] }
    else if (t === 'IDAT') idat.push(d)
    o += 12 + lg
  }
  if (bits !== 8 || type !== 2) throw new Error(`PNG non géré : bits=${bits} type=${type}`)
  const brut = zlib.inflateSync(Buffer.concat(idat))
  const pas = w * 3
  const px = Buffer.alloc(pas * h)
  for (let y = 0; y < h; y++) {
    const filtre = brut[y * (pas + 1)]
    const src = y * (pas + 1) + 1
    for (let x = 0; x < pas; x++) {
      const a = x >= 3 ? px[y * pas + x - 3] : 0
      const bb = y > 0 ? px[(y - 1) * pas + x] : 0
      const c = x >= 3 && y > 0 ? px[(y - 1) * pas + x - 3] : 0
      let v = brut[src + x]
      if (filtre === 1) v += a
      else if (filtre === 2) v += bb
      else if (filtre === 3) v += (a + bb) >> 1
      else if (filtre === 4) {
        const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? bb : c
      }
      px[y * pas + x] = v & 0xff
    }
  }
  return { w, h, px }
}

const [src, dst, X, Y, W, H, Z] = process.argv.slice(2)
const z = Number(Z || 2)
const img = lirePNG(src)
const x0 = Number(X), y0 = Number(Y), w = Number(W), h = Number(H)
const out = Buffer.alloc(w * z * h * z * 3)
for (let y = 0; y < h * z; y++) {
  for (let x = 0; x < w * z; x++) {
    const sx = Math.min(img.w - 1, x0 + Math.floor(x / z))
    const sy = Math.min(img.h - 1, y0 + Math.floor(y / z))
    const s = (sy * img.w + sx) * 3, d = (y * w * z + x) * 3
    out[d] = img.px[s]; out[d + 1] = img.px[s + 1]; out[d + 2] = img.px[s + 2]
  }
}
fs.writeFileSync(dst, encoderPNG(w * z, h * z, out))
console.log(`${src} ${img.w}x${img.h} → ${dst} ${w * z}x${h * z}`)
