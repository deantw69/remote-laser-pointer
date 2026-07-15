import type { Mark } from '../../shared/protocol'

type Ping = { x: number; y: number; born: number }
type Stroke = { pts: { x: number; y: number }[]; done: boolean; doneAt: number }

const COLOR = '#ff3355'
const PING_MS = 1100
const STROKE_HOLD_MS = 3000
const STROKE_FADE_MS = 1200
const LASER_TIMEOUT_MS = 2000

// 標記繪製引擎:分享者端 overlay 與觀看者端本地回顯共用
export class MarkCanvas {
  private ctx: CanvasRenderingContext2D
  private pings: Ping[] = []
  private strokes: Stroke[] = []
  private laser: { x: number; y: number; seen: number } | null = null

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1
      this.canvas.width = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
      this.canvas.height = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    }
    resize()
    window.addEventListener('resize', resize)
    const loop = (): void => {
      this.draw()
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  add(m: Mark): void {
    const now = performance.now()
    switch (m.t) {
      case 'ping':
        this.pings.push({ x: m.x, y: m.y, born: now })
        break
      case 'laser':
        this.laser = { x: m.x, y: m.y, seen: now }
        break
      case 'laser-off':
        this.laser = null
        break
      case 'stroke-start':
        this.strokes.push({ pts: [{ x: m.x, y: m.y }], done: false, doneAt: 0 })
        break
      case 'stroke-point': {
        const s = this.activeStroke()
        if (s) s.pts.push({ x: m.x, y: m.y })
        break
      }
      case 'stroke-end': {
        const s = this.activeStroke()
        if (s) {
          s.done = true
          s.doneAt = now
        }
        break
      }
    }
  }

  private activeStroke(): Stroke | undefined {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (!this.strokes[i].done) return this.strokes[i]
    }
    return undefined
  }

  private draw(): void {
    const { ctx, canvas } = this
    const w = canvas.width
    const h = canvas.height
    const dpr = window.devicePixelRatio || 1
    const now = performance.now()
    ctx.clearRect(0, 0, w, h)

    // 手繪線:結束後停留 → 淡出
    this.strokes = this.strokes.filter((s) => !s.done || now - s.doneAt < STROKE_HOLD_MS + STROKE_FADE_MS)
    for (const s of this.strokes) {
      let alpha = 1
      if (s.done) {
        const t = now - s.doneAt
        if (t > STROKE_HOLD_MS) alpha = 1 - (t - STROKE_HOLD_MS) / STROKE_FADE_MS
      }
      if (alpha <= 0 || s.pts.length < 2) continue
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
      ctx.strokeStyle = COLOR
      ctx.lineWidth = 4 * dpr
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.shadowColor = COLOR
      ctx.shadowBlur = 8 * dpr
      ctx.beginPath()
      ctx.moveTo(s.pts[0].x * w, s.pts[0].y * h)
      for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x * w, s.pts[i].y * h)
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    // ping:擴散漸淡圓圈
    this.pings = this.pings.filter((p) => now - p.born < PING_MS)
    for (const p of this.pings) {
      const t = (now - p.born) / PING_MS
      ctx.globalAlpha = 1 - t
      ctx.strokeStyle = COLOR
      ctx.lineWidth = 4 * dpr
      ctx.beginPath()
      ctx.arc(p.x * w, p.y * h, (10 + 45 * t) * dpr, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = COLOR
      ctx.beginPath()
      ctx.arc(p.x * w, p.y * h, 5 * dpr, 0, Math.PI * 2)
      ctx.fill()
    }

    // 雷射點:光暈 + 白色核心
    if (this.laser && now - this.laser.seen > LASER_TIMEOUT_MS) this.laser = null
    if (this.laser) {
      const x = this.laser.x * w
      const y = this.laser.y * h
      const r = 9 * dpr
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2)
      g.addColorStop(0, 'rgba(255,51,85,0.95)')
      g.addColorStop(0.4, 'rgba(255,51,85,0.55)')
      g.addColorStop(1, 'rgba(255,51,85,0)')
      ctx.globalAlpha = 1
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r * 2.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(x, y, 2.5 * dpr, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
}
