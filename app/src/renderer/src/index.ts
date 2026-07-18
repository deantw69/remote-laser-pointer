import type { AppStatus } from '../../shared/protocol'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

let st: AppStatus | null = null
let pendingJoin: string | null = null // 正在等待輸入密碼的房名

function fmtStatus(s: AppStatus): string {
  if (s.error && s.error !== 'need-password') return `⚠ ${s.error}`
  if (!s.connected) return '連線伺服器中…'
  if (!s.roomName) return s.role === 'sharer' ? '尚未開房' : '尚未加入房間'
  if (!s.peerPresent) {
    return s.role === 'sharer' ? `已開房「${s.roomName}」,等待對方加入…` : `已加入「${s.roomName}」,等待對方…`
  }
  return '已與對方連線 ✔'
}

function renderRooms(s: AppStatus): void {
  const box = $('v-rooms')
  if (s.roomName) {
    box.textContent = `已加入「${s.roomName}」`
    return
  }
  if (!s.connected) {
    box.textContent = '連線中…'
    return
  }
  const rooms = s.rooms ?? []
  const known = new Set(s.knownRooms ?? [])
  if (rooms.length === 0) {
    box.textContent = '目前沒有線上房間,等分享者開房後會自動出現。'
    return
  }
  box.innerHTML = ''
  for (const r of rooms) {
    const row = document.createElement('button')
    row.className = 'room-item'
    row.textContent = r.name
    if (known.has(r.name)) {
      const tag = document.createElement('span')
      tag.className = 'known'
      tag.textContent = '已記住 ✔'
      row.appendChild(tag)
      row.title = '已記住密碼,點一下直接加入'
    } else {
      row.title = '點一下加入(需輸入密碼)'
    }
    row.addEventListener('click', () => void tryJoin(r.name))
    box.appendChild(row)
  }
}

function render(): void {
  if (!st) return
  $('screen-role').hidden = st.role !== null
  $('screen-viewer').hidden = st.role !== 'viewer'
  $('screen-sharer').hidden = st.role !== 'sharer'

  if (st.role === null) {
    const input = $<HTMLInputElement>('server-url')
    if (document.activeElement !== input) input.value = st.serverUrl
    return
  }

  if (st.role === 'viewer') {
    $('v-status').textContent = fmtStatus(st)
    renderRooms(st)
    $<HTMLButtonElement>('v-leave').hidden = !st.roomName
    $('v-cal-info').textContent = st.calibrated ? '已校準 ✔' : '尚未校準'
    const hk = window.api.hotkeyLabel
    $('v-pointing').textContent = st.pointing
      ? `🔴 指點模式進行中(${hk} / Esc 結束)`
      : st.calibrated
        ? `按 ${hk} 開始指點`
        : '請先完成校準'
  } else {
    $('s-status').textContent = fmtStatus(st)
    const nameInput = $<HTMLInputElement>('s-name')
    if (document.activeElement !== nameInput && st.sharerName != null) nameInput.value = st.sharerName
    const passInput = $<HTMLInputElement>('s-pass')
    if (document.activeElement !== passInput && st.sharerPassword != null) passInput.value = st.sharerPassword
    const hosting = !!st.roomName
    $<HTMLButtonElement>('s-host').hidden = hosting
    $<HTMLButtonElement>('s-leave').hidden = !hosting

    const sel = $<HTMLSelectElement>('s-display')
    const displays = st.displays ?? []
    const stale =
      sel.options.length !== displays.length ||
      [...sel.options].some((o, i) => o.value !== String(displays[i]?.id) || o.textContent !== displays[i]?.label)
    if (stale) {
      sel.innerHTML = ''
      for (const d of displays) {
        const o = document.createElement('option')
        o.value = String(d.id)
        o.textContent = d.label
        sel.appendChild(o)
      }
    }
    const cur = displays.find((d) => d.selected)
    if (cur) sel.value = String(cur.id)
    const reg = st.sharerRegion
    $('s-cal-info').textContent = reg?.custom
      ? `自訂 ${Math.round(reg.width)}×${Math.round(reg.height)}`
      : '整個螢幕'
  }
}

// 把靜態提示文字裡的 F8 換成平台對應鍵
$('v-pointing-hint').textContent =
  `指點模式:點一下=圈圈、按住拖曳=畫線、移動=雷射點;Esc / ${window.api.hotkeyLabel} 結束。`

void window.api.invoke('app:version').then((v) => {
  $('app-version').textContent = `v${v}`
})

type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'latest' }
  | { state: 'error'; message: string }

function fmtUpdate(u: UpdateStatus): string {
  switch (u.state) {
    case 'checking':
      return '檢查中…'
    case 'available':
      return `有新版 v${u.version}`
    case 'downloading':
      return `下載中… ${u.percent}%`
    case 'latest':
      return '已是最新版'
    case 'error':
      return `⚠ ${u.message}`
    default:
      return ''
  }
}

window.api.on('update:status', (u) => {
  $('update-status').textContent = fmtUpdate(u as UpdateStatus)
})

$('btn-update').addEventListener('click', () => void window.api.invoke('update:check'))

window.api.on('status', (s) => {
  st = s as AppStatus
  render()
})
void window.api.invoke('status:get').then((s) => {
  st = s as AppStatus
  render()
})

async function chooseRole(role: 'viewer' | 'sharer'): Promise<void> {
  const url = $<HTMLInputElement>('server-url').value.trim()
  if (url) await window.api.invoke('serverUrl:set', url)
  await window.api.invoke('role:set', role)
}

type JoinResult = { ok: boolean; error?: string; reason?: string }

async function tryJoin(name: string): Promise<void> {
  hideJoinBox()
  const res = (await window.api.invoke('room:join', { name })) as JoinResult
  if (res.ok) return
  if (res.error === 'need-password') showJoinBox(name, res.reason)
  else $('v-status').textContent = `⚠ ${res.error}`
}

function showJoinBox(name: string, reason?: string): void {
  pendingJoin = name
  $('v-join-box').hidden = false
  $('v-join-target').textContent = reason ? `「${name}」:${reason}` : `輸入「${name}」的密碼`
  const inp = $<HTMLInputElement>('v-pass')
  inp.value = ''
  inp.focus()
}

function hideJoinBox(): void {
  pendingJoin = null
  $('v-join-box').hidden = true
}

async function submitPass(): Promise<void> {
  if (!pendingJoin) return
  const pw = $<HTMLInputElement>('v-pass').value.trim()
  if (!pw) return
  const name = pendingJoin
  const res = (await window.api.invoke('room:join', { name, password: pw })) as JoinResult
  if (res.ok) {
    hideJoinBox()
    return
  }
  if (res.error === 'need-password') {
    $('v-join-target').textContent = `「${name}」:${res.reason ?? '密碼錯誤,請重新輸入'}`
    $<HTMLInputElement>('v-pass').select()
  } else {
    hideJoinBox()
    $('v-status').textContent = `⚠ ${res.error}`
  }
}

async function host(): Promise<void> {
  const res = (await window.api.invoke('room:create')) as { ok: boolean; error?: string }
  if (!res.ok && res.error) $('s-status').textContent = `⚠ ${res.error}`
}

$('btn-viewer').addEventListener('click', () => void chooseRole('viewer'))
$('btn-sharer').addEventListener('click', () => void chooseRole('sharer'))
$('v-leave').addEventListener('click', () => void window.api.invoke('room:leave'))
$('s-leave').addEventListener('click', () => void window.api.invoke('room:leave'))
$('v-back').addEventListener('click', () => void window.api.invoke('role:set', null))
$('s-back').addEventListener('click', () => void window.api.invoke('role:set', null))
$('v-cal').addEventListener('click', () => void window.api.invoke('viewer:calibrate'))
$('s-cal').addEventListener('click', () => void window.api.invoke('sharer:calibrate'))
$('s-cal-reset').addEventListener('click', () => void window.api.invoke('sharer:reset-region'))

$('s-host').addEventListener('click', () => void host())
$('s-name').addEventListener('change', (e) =>
  void window.api.invoke('room:set-name', (e.target as HTMLInputElement).value)
)
$('s-pass').addEventListener('change', (e) =>
  void window.api.invoke('room:set-password', (e.target as HTMLInputElement).value)
)
$('s-pass-gen').addEventListener('click', () => void window.api.invoke('room:gen-password'))

$('v-pass-ok').addEventListener('click', () => void submitPass())
$('v-pass-cancel').addEventListener('click', () => hideJoinBox())
$<HTMLInputElement>('v-pass').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void submitPass()
  else if (e.key === 'Escape') hideJoinBox()
})

$<HTMLSelectElement>('s-display').addEventListener('change', (e) => {
  void window.api.invoke('sharer:set-display', Number((e.target as HTMLSelectElement).value))
})
