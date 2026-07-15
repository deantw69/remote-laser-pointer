import type { AppStatus } from '../../shared/protocol'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

let st: AppStatus | null = null

function fmtStatus(s: AppStatus): string {
  if (s.error) return `⚠ ${s.error}`
  if (!s.connected) return '連線伺服器中…'
  if (!s.roomCode) return '已連上伺服器,尚未加入房間'
  if (!s.peerPresent) return `等待對方加入…(把房號 ${s.roomCode} 給對方)`
  return '已與對方連線 ✔'
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
    $('v-room-label').textContent = st.roomCode ?? '—'
    $('v-cal-info').textContent = st.calibrated ? '已校準 ✔' : '尚未校準'
    $('v-pointing').textContent = st.pointing
      ? '🔴 指點模式進行中(F8 / Esc 結束)'
      : st.calibrated
        ? '按 F8 開始指點'
        : '請先完成校準'
  } else {
    $('s-status').textContent = fmtStatus(st)
    $('s-room-label').textContent = st.roomCode ?? '—'
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
  }
}

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

async function doRoom(action: 'create' | 'join', statusId: string, codeInputId?: string): Promise<void> {
  const res =
    action === 'create'
      ? await window.api.invoke('room:create')
      : await window.api.invoke('room:join', $<HTMLInputElement>(codeInputId!).value)
  if (res && res.ok === false && res.error) $(statusId).textContent = `⚠ ${res.error}`
}

$('btn-viewer').addEventListener('click', () => void chooseRole('viewer'))
$('btn-sharer').addEventListener('click', () => void chooseRole('sharer'))
$('v-create').addEventListener('click', () => void doRoom('create', 'v-status'))
$('v-join').addEventListener('click', () => void doRoom('join', 'v-status', 'v-code'))
$('s-create').addEventListener('click', () => void doRoom('create', 's-status'))
$('s-join').addEventListener('click', () => void doRoom('join', 's-status', 's-code'))
$('v-leave').addEventListener('click', () => void window.api.invoke('room:leave'))
$('s-leave').addEventListener('click', () => void window.api.invoke('room:leave'))
$('v-back').addEventListener('click', () => void window.api.invoke('role:set', null))
$('s-back').addEventListener('click', () => void window.api.invoke('role:set', null))
$('v-cal').addEventListener('click', () => void window.api.invoke('viewer:calibrate'))
$<HTMLSelectElement>('s-display').addEventListener('change', (e) => {
  void window.api.invoke('sharer:set-display', Number((e.target as HTMLSelectElement).value))
})

for (const id of ['v-code', 's-code']) {
  $<HTMLInputElement>(id).addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement
    el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  })
}
