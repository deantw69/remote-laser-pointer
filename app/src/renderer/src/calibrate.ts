type Rect = { x: number; y: number; width: number; height: number }

const sel = document.getElementById('sel') as HTMLDivElement
const dims = document.getElementById('dims') as HTMLSpanElement
const hintMain = document.getElementById('hint-main') as HTMLSpanElement
const aspectHint = document.getElementById('aspect-hint') as HTMLSpanElement
const btnFull = document.getElementById('btn-full') as HTMLButtonElement
const btnOk = document.getElementById('btn-ok') as HTMLButtonElement
const btnCancel = document.getElementById('btn-cancel') as HTMLButtonElement

const MIN = 20

let aspect: number | null = null
let allowFull = false
let rect: Rect | null = null
let drag: { mode: 'create' | 'move' | 'resize'; handle?: string; sx: number; sy: number; orig: Rect | null } | null = null

function clampRect(r: Rect): Rect {
  const W = window.innerWidth
  const H = window.innerHeight
  const width = Math.max(MIN, Math.min(r.width, W))
  const height = Math.max(MIN, Math.min(r.height, H))
  const x = Math.max(0, Math.min(r.x, W - width))
  const y = Math.max(0, Math.min(r.y, H - height))
  return { x, y, width, height }
}

// 拉框(從起點到游標),依比例鎖定;free(按 Ctrl)可解除
function calcRect(sx: number, sy: number, cx: number, cy: number, free: boolean): Rect {
  let w = Math.abs(cx - sx)
  let h = Math.abs(cy - sy)
  if (aspect && !free) {
    if (h === 0 || w / Math.max(h, 1) > aspect) h = w / aspect
    else w = h * aspect
  }
  return { x: cx >= sx ? sx : sx - w, y: cy >= sy ? sy : sy - h, width: w, height: h }
}

function moveRect(orig: Rect, dx: number, dy: number): Rect {
  return clampRect({ x: orig.x + dx, y: orig.y + dy, width: orig.width, height: orig.height })
}

// 拖把手縮放:對邊/角固定,依 handle 移動邊界;比例鎖定時由主軸推算另一軸
function resizeRect(orig: Rect, h: string, dx: number, dy: number, free: boolean): Rect {
  let left = orig.x
  let top = orig.y
  let right = orig.x + orig.width
  let bottom = orig.y + orig.height
  if (h.includes('w')) left = orig.x + dx
  if (h.includes('e')) right = orig.x + orig.width + dx
  if (h.includes('n')) top = orig.y + dy
  if (h.includes('s')) bottom = orig.y + orig.height + dy

  if (aspect && !free) {
    const horiz = h.includes('e') || h.includes('w')
    const vert = h.includes('n') || h.includes('s')
    if (horiz && vert) {
      // 角:由寬推高,錨定不動的那條水平邊
      const w = right - left
      const ht = w / aspect
      if (h.includes('n')) top = bottom - ht
      else bottom = top + ht
    } else if (horiz) {
      // 左右邊:由寬推高,維持上緣
      bottom = top + (right - left) / aspect
    } else {
      // 上下邊:由高推寬,維持左緣
      right = left + (bottom - top) * aspect
    }
  }

  return clampRect({
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.abs(right - left),
    height: Math.abs(bottom - top)
  })
}

function render(): void {
  if (!rect) {
    sel.hidden = true
    return
  }
  sel.hidden = false
  sel.style.left = `${rect.x}px`
  sel.style.top = `${rect.y}px`
  sel.style.width = `${rect.width}px`
  sel.style.height = `${rect.height}px`
  dims.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`
}

function commit(full: boolean): void {
  if (full) {
    window.api.send('calibrate:done', { full: true })
    return
  }
  if (!rect || rect.width < 40 || rect.height < 30) return
  window.api.send('calibrate:done', { rect, full: false })
}

window.api.on('calibrate:init', (data) => {
  const d = data as { aspect: number | null; rect: Rect | null; allowFull: boolean; target: string }
  aspect = typeof d.aspect === 'number' && d.aspect > 0 ? d.aspect : null
  allowFull = !!d.allowFull
  rect = d.rect ? clampRect(d.rect) : null
  btnFull.hidden = !allowFull

  hintMain.textContent =
    d.target === 'sharer'
      ? '框出要讓對方標記落在的螢幕區域(或按「整個螢幕」);拖曳框內移動、邊角縮放'
      : '調整框住 Discord 影片的「實際影像範圍」;拖曳框內移動、邊角縮放'
  aspectHint.textContent = aspect
    ? `已依分享端比例鎖定(約 ${aspect.toFixed(2)}:1);按住 Ctrl 可自由調整`
    : '可自由調整;確定=Enter,取消=Esc'
  render()
})

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  const t = e.target as HTMLElement
  if (t.closest('#toolbar')) return
  if (t.classList.contains('handle') && rect) {
    drag = { mode: 'resize', handle: t.dataset.h, sx: e.clientX, sy: e.clientY, orig: { ...rect } }
  } else if (t.closest('#sel') && rect) {
    drag = { mode: 'move', sx: e.clientX, sy: e.clientY, orig: { ...rect } }
  } else {
    drag = { mode: 'create', sx: e.clientX, sy: e.clientY, orig: null }
    rect = { x: e.clientX, y: e.clientY, width: 0, height: 0 }
  }
})

window.addEventListener('mousemove', (e) => {
  if (!drag) return
  const free = e.ctrlKey
  if (drag.mode === 'create') {
    rect = calcRect(drag.sx, drag.sy, e.clientX, e.clientY, free)
  } else if (drag.mode === 'move' && drag.orig) {
    rect = moveRect(drag.orig, e.clientX - drag.sx, e.clientY - drag.sy)
  } else if (drag.mode === 'resize' && drag.orig && drag.handle) {
    rect = resizeRect(drag.orig, drag.handle, e.clientX - drag.sx, e.clientY - drag.sy, free)
  }
  render()
})

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !drag) return
  // 新框太小視為取消這次新框,還原成拖曳前的狀態
  if (drag.mode === 'create' && rect && (rect.width < MIN || rect.height < MIN)) {
    rect = drag.orig
  }
  drag = null
  render()
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.send('calibrate:cancel')
  else if (e.key === 'Enter') commit(false)
})

btnOk.addEventListener('click', () => commit(false))
btnCancel.addEventListener('click', () => window.api.send('calibrate:cancel'))
btnFull.addEventListener('click', () => commit(true))
