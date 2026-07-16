import { hostname } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow, Menu, Tray, app, globalShortcut, ipcMain, nativeImage, screen } from 'electron'
import { Socket, io } from 'socket.io-client'
import type { AppStatus, Mark, MetaEvent, Role, RoomInfo } from '../shared/protocol'
import { loadSettings, saveSettings } from './store'
import type { Rect, Settings } from './store'

// 本機雙開測試用:npx electron . --profile=b
const profile = process.argv.find((a) => a.startsWith('--profile='))?.split('=')[1]
if (profile) app.setPath('userData', join(app.getPath('userData'), `profile-${profile}`))

const settings: Settings = loadSettings()

// 排除易混淆字元(0/O、1/I)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function genPassword(): string {
  return Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('')
}
function defaultRoomName(): string {
  return (hostname() || '我的電腦').replace(/\.local$/, '').slice(0, 40) + (profile ? `-${profile}` : '')
}

// 分享者房名/密碼:首次啟動產生預設(電腦名 + 隨機碼)並存檔,之後固定不變
if (!settings.roomName) settings.roomName = defaultRoomName()
if (!settings.roomPassword) settings.roomPassword = genPassword()
saveSettings(settings)

const state = {
  role: null as Role | null,
  serverUrl: settings.serverUrl,
  connected: false,
  roomName: null as string | null,
  peerPresent: false,
  sharerName: settings.roomName,
  sharerPassword: settings.roomPassword,
  rooms: [] as RoomInfo[],
  sharerDisplayId: null as number | null,
  sharerAspect: settings.sharerAspect ?? null,
  calRect: settings.calRect ?? null,
  sharerRect: settings.sharerRect ?? null,
  pointing: false,
  error: null as string | null
}

function knownRooms(): Record<string, string> {
  if (!settings.knownRooms) settings.knownRooms = {}
  return settings.knownRooms
}

let socket: Socket | null = null
let mainWin: BrowserWindow | null = null
let overlayWin: BrowserWindow | null = null
let pointerWin: BrowserWindow | null = null
let calWin: BrowserWindow | null = null
let calTarget: 'viewer' | 'sharer' = 'viewer'
let tray: Tray | null = null
let quitting = false

const PRELOAD = join(__dirname, '../preload/index.js')

// 全域切換指點模式的快捷鍵:mac 的 F8 預設是媒體鍵,故改用 Cmd+Shift+L
// (顯示用標籤在 preload 的 hotkeyLabel,兩者需一致)
const TOGGLE_HOTKEY = process.platform === 'darwin' ? 'Command+Shift+L' : 'F8'

// 把透明點擊穿透視窗釘在最上層;macOS 需額外設定才能浮在其他 app 全螢幕與所有 Space 之上
function pinOverlayOnTop(win: BrowserWindow): void {
  win.setAlwaysOnTop(true, 'screen-saver')
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } else if (process.platform === 'win32') {
    // Windows:會取得焦點的 overlay(校準/指點)一旦取得焦點,工作列會被彈到最上層
    // 蓋住底部那條,導致該處框不到/畫不到 → 每次取得焦點就重新釘頂壓回去
    win.on('focus', () => {
      win.setAlwaysOnTop(true, 'screen-saver')
      win.moveTop()
    })
  }
}

// 把視窗座標(相對某視窗左上角)夾在該視窗範圍內,避免超出螢幕
function clampRectToBounds(r: Rect, b: Rect): Rect {
  const x = Math.max(b.x, Math.min(r.x, b.x + b.width))
  const y = Math.max(b.y, Math.min(r.y, b.y + b.height))
  return {
    x,
    y,
    width: Math.min(r.width, b.x + b.width - x),
    height: Math.min(r.height, b.y + b.height - y)
  }
}

// 分享者 overlay 實際覆蓋範圍:自訂區域優先,否則整個選定螢幕
function sharerBounds(): Rect {
  const d = getSelectedDisplay()
  return state.sharerRect ?? { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height }
}

function loadPage(win: BrowserWindow, page: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}/${page}.html`)
  else void win.loadFile(join(__dirname, `../renderer/${page}.html`))
}

function currentStatus(): AppStatus {
  let displays: AppStatus['displays']
  let sharerRegion: AppStatus['sharerRegion']
  if (state.role === 'sharer') {
    const primaryId = screen.getPrimaryDisplay().id
    displays = screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: `螢幕 ${i + 1}(${d.size.width}×${d.size.height}${d.id === primaryId ? ',主螢幕' : ''})`,
      selected: d.id === state.sharerDisplayId
    }))
    const b = sharerBounds()
    sharerRegion = { custom: !!state.sharerRect, width: b.width, height: b.height }
  }
  return {
    role: state.role,
    serverUrl: state.serverUrl,
    connected: state.connected,
    roomName: state.roomName,
    peerPresent: state.peerPresent,
    sharerName: state.role === 'sharer' ? state.sharerName : undefined,
    sharerPassword: state.role === 'sharer' ? state.sharerPassword : undefined,
    rooms: state.role === 'viewer' ? state.rooms : undefined,
    knownRooms: state.role === 'viewer' ? Object.keys(knownRooms()) : undefined,
    sharerAspect: state.sharerAspect,
    calibrated: !!state.calRect,
    pointing: state.pointing,
    displays,
    sharerRegion,
    error: state.error
  }
}

function broadcast(): void {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('status', currentStatus())
}

function getSelectedDisplay(): Electron.Display {
  const all = screen.getAllDisplays()
  return all.find((d) => d.id === state.sharerDisplayId) ?? screen.getPrimaryDisplay()
}

function overlayWindowOptions(bounds: Rect): Electron.BrowserWindowConstructorOptions {
  return {
    ...bounds,
    transparent: true,
    frame: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    fullscreenable: false,
    alwaysOnTop: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: false }
  }
}

function sendMeta(): void {
  if (state.role !== 'sharer' || !socket?.connected || !state.roomName) return
  const d = getSelectedDisplay()
  // 有自訂區域就用區域比例;否則用整個螢幕比例
  const width = state.sharerRect ? state.sharerRect.width : d.size.width
  const height = state.sharerRect ? state.sharerRect.height : d.size.height
  const meta: MetaEvent = {
    kind: 'sharer-info',
    aspect: width / height,
    width,
    height
  }
  socket.emit('meta', meta)
}

// ---- 分享者端:全螢幕透明點擊穿透 overlay ----
function ensureOverlay(): void {
  if (state.role !== 'sharer') return
  const b = sharerBounds()
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.setBounds(b)
    return
  }
  overlayWin = new BrowserWindow({ ...overlayWindowOptions(b), focusable: false })
  pinOverlayOnTop(overlayWin)
  overlayWin.setIgnoreMouseEvents(true)
  overlayWin.on('closed', () => {
    overlayWin = null
  })
  loadPage(overlayWin, 'overlay')
}

function destroyOverlay(): void {
  overlayWin?.destroy()
  overlayWin = null
}

// ---- 觀看者端:指點模式視窗(蓋在校準範圍上) ----
function startPointing(): void {
  if (state.role !== 'viewer' || state.pointing || !state.calRect) return
  pointerWin = new BrowserWindow(overlayWindowOptions(state.calRect))
  pinOverlayOnTop(pointerWin)
  pointerWin.on('closed', () => {
    pointerWin = null
    if (state.pointing) {
      state.pointing = false
      broadcast()
    }
  })
  pointerWin.webContents.on('did-finish-load', () => pointerWin?.focus())
  loadPage(pointerWin, 'pointer')
  state.pointing = true
  broadcast()
}

function stopPointing(): void {
  if (!state.pointing && !pointerWin) return
  state.pointing = false
  if (socket?.connected) {
    socket.emit('pointer', { t: 'stroke-end' } satisfies Mark)
    socket.emit('pointer', { t: 'laser-off' } satisfies Mark)
  }
  pointerWin?.destroy()
  pointerWin = null
  broadcast()
}

function closeCalibration(): void {
  calWin?.destroy()
  calWin = null
}

// 開啟校準視窗(觀看者=在游標所在螢幕框 Discord 影像;分享者=在選定螢幕框標記範圍)
function openCalibration(target: 'viewer' | 'sharer'): void {
  if (target === 'viewer' && state.role !== 'viewer') return
  if (target === 'sharer' && state.role !== 'sharer') return
  stopPointing()
  closeCalibration()
  calTarget = target

  const d =
    target === 'sharer'
      ? getSelectedDisplay()
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  // 前次範圍(絕對座標):分享者預設整個螢幕,觀看者預設上次校準框
  const prev: Rect | null =
    target === 'sharer'
      ? state.sharerRect ?? { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height }
      : state.calRect
  const aspect = target === 'sharer' ? null : state.sharerAspect

  calWin = new BrowserWindow(overlayWindowOptions(d.bounds))
  pinOverlayOnTop(calWin)
  calWin.on('closed', () => {
    calWin = null
  })
  calWin.webContents.on('did-finish-load', () => {
    if (!calWin) return
    const b = calWin.getBounds()
    // 絕對座標 → 視窗內座標;若前次範圍不在這台螢幕上就當作沒有
    let rect: Rect | null = null
    if (prev) {
      const within =
        prev.x < b.x + b.width && prev.x + prev.width > b.x && prev.y < b.y + b.height && prev.y + prev.height > b.y
      if (within) rect = { x: prev.x - b.x, y: prev.y - b.y, width: prev.width, height: prev.height }
    }
    calWin.webContents.send('calibrate:init', { aspect, rect, allowFull: target === 'sharer', target })
    calWin.focus()
  })
  loadPage(calWin, 'calibrate')
}

function leaveRoom(notifyServer: boolean): void {
  if (notifyServer && socket?.connected) socket.emit('leave-room')
  state.roomName = null
  state.peerPresent = false
  stopPointing()
  destroyOverlay()
}

// 分享者已在房內時修改房名/密碼:用新設定重新開房(舊房會自動退出)
function reHost(): void {
  if (state.role !== 'sharer' || !state.roomName || !socket?.connected) return
  socket.emit('create-room', { name: state.sharerName, password: state.sharerPassword }, (res?: { ok: boolean; name?: string }) => {
    if (res?.ok && res.name) {
      state.roomName = res.name
      broadcast()
    }
  })
}

function afterRoomJoined(): void {
  if (state.role === 'sharer') {
    ensureOverlay()
    sendMeta()
  }
}

// ---- Socket.IO ----
function connectSocket(): void {
  socket?.removeAllListeners()
  socket?.disconnect()
  state.connected = false
  const s = io(state.serverUrl, { reconnectionDelayMax: 5000 })
  socket = s

  s.on('connect', () => {
    state.connected = true
    state.error = null
    if (state.role === 'viewer') s.emit('lobby:join')
    const name = state.roomName
    if (name) {
      // 斷線重連後嘗試回到原房間:分享者重新開房、觀看者用記住的密碼重新加入
      if (state.role === 'sharer') {
        s.timeout(8000).emit(
          'create-room',
          { name: state.sharerName, password: state.sharerPassword },
          (err: unknown, res?: { ok: boolean; name?: string }) => {
            if (err || !res?.ok) {
              leaveRoom(false)
              state.error = '斷線後重新開房失敗,請重新開房'
            } else {
              state.roomName = res.name ?? name
              afterRoomJoined()
            }
            broadcast()
          }
        )
      } else {
        const pw = knownRooms()[name] ?? ''
        s.timeout(8000).emit(
          'join-room',
          { name, password: pw },
          (err: unknown, res?: { ok: boolean; peers?: number }) => {
            if (err || !res?.ok) {
              leaveRoom(false)
              state.error = '斷線後重新加入房間失敗,請重新加入'
            } else {
              state.peerPresent = (res.peers ?? 0) > 0
              afterRoomJoined()
            }
            broadcast()
          }
        )
      }
    }
    broadcast()
  })
  s.on('rooms', (list: unknown) => {
    state.rooms = Array.isArray(list) ? (list as RoomInfo[]) : []
    broadcast()
  })
  s.on('disconnect', () => {
    state.connected = false
    state.peerPresent = false
    broadcast()
  })
  s.on('connect_error', (e: Error) => {
    state.error = `無法連線伺服器:${e.message}`
    broadcast()
  })
  s.on('peer-joined', () => {
    state.peerPresent = true
    state.error = null
    if (state.role === 'sharer') sendMeta()
    broadcast()
  })
  s.on('peer-left', () => {
    state.peerPresent = false
    stopPointing()
    broadcast()
  })
  s.on('pointer', (m: Mark) => {
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send('pointer', m)
  })
  s.on('meta', (m: MetaEvent) => {
    if (m && m.kind === 'sharer-info' && m.aspect > 0) {
      state.sharerAspect = m.aspect
      settings.sharerAspect = m.aspect
      saveSettings(settings)
      broadcast()
    }
  })
}

function disconnectSocket(): void {
  socket?.removeAllListeners()
  socket?.disconnect()
  socket = null
  state.connected = false
}

// ---- 系統匣(分享者縮到匣) ----
function ensureTray(): void {
  if (tray) return
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/tray.png'))
  // macOS menu bar 用 template image(依明暗自動變色)
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('遠端雷射筆 — 分享進行中')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '顯示主視窗', click: () => mainWin?.show() },
      { type: 'separator' },
      {
        label: '結束',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => mainWin?.show())
}

function createMainWindow(): void {
  mainWin = new BrowserWindow({
    width: 480,
    height: 680,
    resizable: false,
    autoHideMenuBar: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: false }
  })
  mainWin.on('close', (e) => {
    // 分享者在房間內關窗 → 縮到系統匣,overlay 繼續運作
    if (!quitting && state.role === 'sharer' && state.roomName) {
      e.preventDefault()
      ensureTray()
      mainWin?.hide()
    }
  })
  mainWin.on('closed', () => {
    mainWin = null
    destroyOverlay()
    stopPointing()
    closeCalibration()
  })
  loadPage(mainWin, 'index')
}

// ---- IPC ----
function registerIpc(): void {
  ipcMain.handle('status:get', () => currentStatus())

  ipcMain.handle('serverUrl:set', (_e, url: unknown) => {
    const u = String(url ?? '').trim()
    if (!u || u === state.serverUrl) return { ok: true }
    state.serverUrl = u
    settings.serverUrl = u
    saveSettings(settings)
    leaveRoom(false)
    if (state.role) connectSocket()
    broadcast()
    return { ok: true }
  })

  ipcMain.handle('role:set', (_e, role: unknown) => {
    const r = role === 'viewer' || role === 'sharer' ? role : null
    if (r === state.role) return { ok: true }
    leaveRoom(true)
    closeCalibration()
    state.role = r
    state.error = null
    if (r === 'sharer' && state.sharerDisplayId === null) {
      state.sharerDisplayId = screen.getPrimaryDisplay().id
    }
    if (r) connectSocket()
    else disconnectSocket()
    broadcast()
    return { ok: true }
  })

  // 分享者開房:用自己的房名+密碼
  ipcMain.handle('room:create', async () => {
    if (state.role !== 'sharer') return { ok: false, error: '僅分享者可開房' }
    if (!socket?.connected) return { ok: false, error: '尚未連上伺服器' }
    return await new Promise((resolve) => {
      socket!.timeout(8000).emit(
        'create-room',
        { name: state.sharerName, password: state.sharerPassword },
        (err: unknown, res?: { ok: boolean; error?: string; name?: string }) => {
          if (err) return resolve({ ok: false, error: '連線逾時,請再試一次' })
          if (!res?.ok) {
            const msg =
              res?.error === 'name-taken'
                ? '這個房名已被別人使用,請改個房名'
                : res?.error === 'bad-name'
                  ? '請先設定房名'
                  : res?.error === 'bad-password'
                    ? '請先設定密碼'
                    : '開房失敗'
            return resolve({ ok: false, error: msg })
          }
          state.roomName = res.name ?? state.sharerName
          state.peerPresent = false
          state.error = null
          afterRoomJoined()
          broadcast()
          resolve({ ok: true })
        }
      )
    })
  })

  // 觀看者加入:傳 { name, password? };沒帶密碼就用記住的,都沒有回 need-password 讓前端跳輸入
  ipcMain.handle('room:join', async (_e, payload: unknown) => {
    if (state.role !== 'viewer') return { ok: false, error: '僅觀看者可加入' }
    const p = (payload ?? {}) as { name?: unknown; password?: unknown }
    const name = String(p.name ?? '').trim()
    if (!name) return { ok: false, error: '請選擇房間' }
    if (!socket?.connected) return { ok: false, error: '尚未連上伺服器' }
    const typed = p.password != null && String(p.password) !== ''
    const password = typed ? String(p.password) : knownRooms()[name] ?? ''
    if (!password) return { ok: false, error: 'need-password' }
    return await new Promise((resolve) => {
      socket!.timeout(8000).emit(
        'join-room',
        { name, password },
        (err: unknown, res?: { ok: boolean; error?: string; peers?: number }) => {
          if (err) return resolve({ ok: false, error: '連線逾時,請再試一次' })
          if (!res?.ok) {
            if (res?.error === 'bad-password') {
              delete knownRooms()[name]
              saveSettings(settings)
              broadcast()
              return resolve({ ok: false, error: 'need-password', reason: '密碼錯誤,請重新輸入' })
            }
            const msg = res?.error === 'not-found' ? '房間不存在或已關閉' : res?.error === 'full' ? '房間已滿' : '加入失敗'
            return resolve({ ok: false, error: msg })
          }
          knownRooms()[name] = password
          saveSettings(settings)
          state.roomName = name
          state.peerPresent = (res.peers ?? 0) > 0
          state.error = null
          afterRoomJoined()
          broadcast()
          resolve({ ok: true })
        }
      )
    })
  })

  // 分享者設定房名 / 密碼(存檔且固定;已在房內則以新設定重開房)
  ipcMain.handle('room:set-name', (_e, v: unknown) => {
    if (state.role !== 'sharer') return { ok: false }
    const name = String(v ?? '').trim().slice(0, 40)
    if (!name || name === state.sharerName) return { ok: true }
    state.sharerName = name
    settings.roomName = name
    saveSettings(settings)
    reHost()
    broadcast()
    return { ok: true }
  })

  ipcMain.handle('room:set-password', (_e, v: unknown) => {
    if (state.role !== 'sharer') return { ok: false }
    const pw = String(v ?? '').trim().slice(0, 40)
    if (!pw || pw === state.sharerPassword) return { ok: true }
    state.sharerPassword = pw
    settings.roomPassword = pw
    saveSettings(settings)
    reHost()
    broadcast()
    return { ok: true }
  })

  ipcMain.handle('room:gen-password', () => {
    if (state.role !== 'sharer') return { ok: false }
    state.sharerPassword = genPassword()
    settings.roomPassword = state.sharerPassword
    saveSettings(settings)
    reHost()
    broadcast()
    return { ok: true }
  })

  // 觀看者忘記某房記住的密碼
  ipcMain.handle('room:forget', (_e, v: unknown) => {
    const name = String(v ?? '').trim()
    if (name && knownRooms()[name] != null) {
      delete knownRooms()[name]
      saveSettings(settings)
      broadcast()
    }
    return { ok: true }
  })

  ipcMain.handle('room:leave', () => {
    leaveRoom(true)
    state.error = null
    broadcast()
    return { ok: true }
  })

  ipcMain.handle('sharer:set-display', (_e, id: unknown) => {
    const did = Number(id)
    if (!Number.isFinite(did)) return { ok: false }
    state.sharerDisplayId = did
    // 自訂區域是相對舊螢幕的絕對座標,換螢幕就重置為整個螢幕
    state.sharerRect = null
    settings.sharerRect = null
    saveSettings(settings)
    if (overlayWin) ensureOverlay()
    sendMeta()
    broadcast()
    return { ok: true }
  })

  ipcMain.handle('viewer:calibrate', () => {
    if (state.role !== 'viewer') return { ok: false }
    openCalibration('viewer')
    return { ok: true }
  })

  ipcMain.handle('sharer:calibrate', () => {
    if (state.role !== 'sharer') return { ok: false }
    openCalibration('sharer')
    return { ok: true }
  })

  ipcMain.handle('sharer:reset-region', () => {
    if (state.role !== 'sharer') return { ok: false }
    state.sharerRect = null
    settings.sharerRect = null
    saveSettings(settings)
    if (overlayWin) ensureOverlay()
    sendMeta()
    broadcast()
    return { ok: true }
  })

  ipcMain.on('calibrate:done', (_e, payload: { rect?: Rect; full?: boolean }) => {
    if (!calWin) return
    const b = calWin.getBounds()
    const rect = payload?.rect
    const full = !!payload?.full

    if (calTarget === 'sharer') {
      if (full) {
        state.sharerRect = null
      } else if (rect && rect.width >= 40 && rect.height >= 30) {
        state.sharerRect = clampRectToBounds(
          {
            x: Math.round(b.x + rect.x),
            y: Math.round(b.y + rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          b
        )
      } else {
        closeCalibration()
        return
      }
      settings.sharerRect = state.sharerRect
      saveSettings(settings)
      closeCalibration()
      ensureOverlay()
      sendMeta()
      broadcast()
      return
    }

    // 觀看者
    if (!rect || rect.width < 40 || rect.height < 30) {
      closeCalibration()
      return
    }
    state.calRect = clampRectToBounds(
      {
        x: Math.round(b.x + rect.x),
        y: Math.round(b.y + rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      b
    )
    settings.calRect = state.calRect
    saveSettings(settings)
    closeCalibration()
    broadcast()
  })

  ipcMain.on('calibrate:cancel', () => closeCalibration())

  ipcMain.on('pointer:event', (_e, m: Mark) => {
    if (state.pointing && socket?.connected) socket.emit('pointer', m)
  })

  ipcMain.on('pointer:exit', () => stopPointing())
}

// ---- App 生命週期 ----
void app.whenReady().then(() => {
  app.setAppUserModelId('com.philio.remote-laser-pointer')
  registerIpc()
  createMainWindow()
  globalShortcut.register(TOGGLE_HOTKEY, () => {
    if (state.role !== 'viewer') return
    if (state.pointing) stopPointing()
    else startPointing()
  })
})

// macOS:從 Dock 重新點開時顯示主視窗
app.on('activate', () => {
  if (mainWin && !mainWin.isDestroyed()) mainWin.show()
  else createMainWindow()
})

app.on('before-quit', () => {
  quitting = true
})
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
