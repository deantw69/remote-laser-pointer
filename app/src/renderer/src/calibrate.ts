type Rect = { x: number; y: number; width: number; height: number }

const sel = document.getElementById('sel') as HTMLDivElement
const dims = document.getElementById('dims') as HTMLSpanElement
const aspectHint = document.getElementById('aspect-hint') as HTMLSpanElement

let aspect: number | null = null
let start: { x: number; y: number } | null = null

window.api.on('calibrate:init', (data) => {
  const a = (data as { aspect: number | null } | undefined)?.aspect
  aspect = typeof a === 'number' && a > 0 ? a : null
  aspectHint.textContent = aspect
    ? `已依分享端螢幕鎖定比例(約 ${aspect.toFixed(2)}:1);按住 Ctrl 可自由框選`
    : '尚未取得分享端螢幕比例,自由框選'
})

function calcRect(sx: number, sy: number, cx: number, cy: number, free: boolean): Rect {
  let w = Math.abs(cx - sx)
  let h = Math.abs(cy - sy)
  if (aspect && !free) {
    if (h === 0 || w / Math.max(h, 1) > aspect) h = w / aspect
    else w = h * aspect
  }
  return { x: cx >= sx ? sx : sx - w, y: cy >= sy ? sy : sy - h, width: w, height: h }
}

function show(r: Rect): void {
  sel.hidden = false
  sel.style.left = `${r.x}px`
  sel.style.top = `${r.y}px`
  sel.style.width = `${r.width}px`
  sel.style.height = `${r.height}px`
  dims.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  start = { x: e.clientX, y: e.clientY }
})

window.addEventListener('mousemove', (e) => {
  if (!start) return
  show(calcRect(start.x, start.y, e.clientX, e.clientY, e.ctrlKey))
})

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !start) return
  const r = calcRect(start.x, start.y, e.clientX, e.clientY, e.ctrlKey)
  start = null
  if (r.width >= 60 && r.height >= 40) window.api.send('calibrate:done', r)
  else sel.hidden = true
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.send('calibrate:cancel')
})
