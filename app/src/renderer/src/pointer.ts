import type { Mark } from '../../shared/protocol'
import { MarkCanvas } from './marks'

const mc = new MarkCanvas(document.getElementById('c') as HTMLCanvasElement)

// macOS 維持舊行為:指點窗捕捉滑鼠,DOM 驅動手勢並本地回顯。
// win32:指點窗點擊穿透,滑鼠由 main 的全域 hook 讀取後推 pointer:echo 回顯。
if (window.api.platform === 'darwin') {
  const DRAG_THRESHOLD_PX = 4
  const LASER_INTERVAL_MS = 33
  const STROKE_INTERVAL_MS = 16

  let downPx: { x: number; y: number } | null = null
  let strokeActive = false
  let lastLaser = 0
  let lastStrokePt = 0

  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
  const norm = (x: number, y: number): { x: number; y: number } => ({
    x: clamp01(x / window.innerWidth),
    y: clamp01(y / window.innerHeight)
  })
  // 送給對方,同時本地回顯
  const send = (m: Mark): void => {
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
} else {
  window.api.on('pointer:echo', (m) => mc.add(m as Mark))
}

const hintEl = document.getElementById('hint')
if (hintEl) hintEl.textContent = `指點模式:點=圈圈|拖=畫線|移動=雷射點|Esc / ${window.api.hotkeyLabel} 結束`
