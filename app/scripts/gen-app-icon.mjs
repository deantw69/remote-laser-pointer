// 產生 build/icon.png(1024x1024 app 圖示),純程式繪製避免在 repo 塞來源不明二進位。
// 主題:深色圓角底 + 中央發光紅色雷射光點 + 準星(crosshair),呼應「遠端指點」。
// 產生後由 gen-icns.mjs / npm run icon 轉成 macOS .icns。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const SIZE = 1024
const px = Buffer.alloc(SIZE * SIZE * 4)

const cx = SIZE / 2
const cy = SIZE / 2

// 圓角矩形(app 圖示留白邊)
const margin = 96
const hw = (SIZE - margin * 2) / 2
const hh = hw
const radius = 200

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
// 圓角矩形 signed distance(<0 為內部)
function roundedRectSDF(x, y) {
  const dx = Math.abs(x - cx) - (hw - radius)
  const dy = Math.abs(y - cy) - (hh - radius)
  const ox = Math.max(dx, 0)
  const oy = Math.max(dy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - radius
}

function blend(i, r, g, b, a) {
  const sa = clamp01(a)
  const da = px[i + 3] / 255
  const outA = sa + da * (1 - sa)
  if (outA <= 0) return
  px[i] = Math.round((r * sa + px[i] * da * (1 - sa)) / outA)
  px[i + 1] = Math.round((g * sa + px[i + 1] * da * (1 - sa)) / outA)
  px[i + 2] = Math.round((b * sa + px[i + 2] * da * (1 - sa)) / outA)
  px[i + 3] = Math.round(outA * 255)
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4
    const sdf = roundedRectSDF(x + 0.5, y + 0.5)
    const inside = clamp01(0.5 - sdf) // 反鋸齒邊
    if (inside <= 0) continue

    // 背景:徑向漸層(中心稍亮的深藍黑 → 邊緣更暗)
    const d = Math.hypot(x - cx, y - cy)
    const t = clamp01(d / (hw * 1.3))
    const bgR = Math.round(30 * (1 - t) + 10 * t)
    const bgG = Math.round(33 * (1 - t) + 11 * t)
    const bgB = Math.round(52 * (1 - t) + 20 * t)
    blend(i, bgR, bgG, bgB, inside)

    // 準星:水平/垂直細線,中間留缺口(不畫到光點核心)
    const ax = Math.abs(x - cx)
    const ay = Math.abs(y - cy)
    const lineW = 7
    const gap = 150
    const reach = 300
    const onH = ay <= lineW && ax >= gap && ax <= reach
    const onV = ax <= lineW && ay >= gap && ay <= reach
    if (onH || onV) {
      const arm = onH ? ax : ay
      const fade = clamp01((reach - arm) / (reach - gap)) * 0.55
      blend(i, 255, 90, 110, fade * inside)
    }

    // 中央雷射光點:外圈柔光 + 內核亮白
    const glow = Math.exp(-(d * d) / (2 * 78 * 78))
    if (glow > 0.003) blend(i, 255, 45, 75, clamp01(glow) * inside)
    const core = Math.exp(-(d * d) / (2 * 26 * 26))
    if (core > 0.01) blend(i, 255, 225, 232, clamp01(core) * inside)
  }
}

// --- PNG 編碼(RGBA)---
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}
const crcTable = []
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c >>> 0
}
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
])
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log('wrote', out, png.length, 'bytes')
