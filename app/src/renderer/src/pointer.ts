import type { Mark } from '../../shared/protocol'
import { MarkCanvas } from './marks'

const mc = new MarkCanvas(document.getElementById('c') as HTMLCanvasElement)

const DRAG_THRESHOLD_PX = 4
const LASER_INTERVAL_MS = 33
const STROKE_INTERVAL_MS = 16

let downPx: { x: number; y: number } | null = null
let strokeActive = false
let lastLaser = 0
let lastStrokePt = 0

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}
function norm(x: number, y: number): { x: number; y: number } {
  return { x: clamp01(x / window.innerWidth), y: clamp01(y / window.innerHeight) }
}
// 送給對方,同時本地回顯
function send(m: Mark): void {
  window.api.send('pointer:event', m)
  mc.add(m)
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  downPx = { x: e.clientX, y: e.clientY }
})

window.addEventListener('mousemove', (e) => {
  const now = performance.now()
  const p = norm(e.clientX, e.clientY)
  if (downPx && !strokeActive) {
    if (Math.hypot(e.clientX - downPx.x, e.clientY - downPx.y) > DRAG_THRESHOLD_PX) {
      strokeActive = true
      send({ t: 'stroke-start', ...norm(downPx.x, downPx.y) })
      send({ t: 'stroke-point', ...p })
      lastStrokePt = now
    }
  } else if (strokeActive) {
    if (now - lastStrokePt >= STROKE_INTERVAL_MS) {
      send({ t: 'stroke-point', ...p })
      lastStrokePt = now
    }
  } else if (now - lastLaser >= LASER_INTERVAL_MS) {
    send({ t: 'laser', ...p })
    lastLaser = now
  }
})

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return
  if (strokeActive) {
    send({ t: 'stroke-end' })
    strokeActive = false
  } else if (downPx) {
    send({ t: 'ping', ...norm(e.clientX, e.clientY) })
  }
  downPx = null
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.send('pointer:exit')
})
