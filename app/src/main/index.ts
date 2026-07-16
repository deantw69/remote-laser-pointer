import { join } from 'node:path'
import { BrowserWindow, Menu, Tray, app, globalShortcut, ipcMain, nativeImage, screen } from 'electron'
import { Socket, io } from 'socket.io-client'
import type { AppStatus, Mark, MetaEvent, Role } from '../shared/protocol'
import { loadSettings, saveSettings } from './store'
import type { Rect, Settings } from './store'

// 本機雙開測試用:npx electron . --profile=b
const profile = process.argv.find((a) => a.startsWith('--profile='))?.split('=')[1]
if (profile) app.setPath('userData', join(app.getPath('userData'), `profile-${profile}`))

const settings: Settings = loadSettings()

const state = {
  role: null as Role | null,
  serverUrl: settings.serverUrl,
  connected: false,
  roomCode: null as string | null,
  peerPresent: false,
  sharerDisplayId: null as number | null,
  sharerAspect: settings.sharerAspect ?? null,
  calRect: settings.calRect ?? null,
  pointing: false,
  error: null as string | null
}

let socket: Socket | null = null
let mainWin: BrowserWindow | null = null
let overlayWin: BrowserWindow | null = null
let pointerWin: BrowserWindow | null = null
let calWin: BrowserWindow | null = null
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
  }
}

function loadPage(win: BrowserWindow, page: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}/${page}.html`)
  else void win.loadFile(join(__dirname, `../renderer/${page}.html`))
}

function currentStatus(): AppStatus {
  let displays: AppStatus['displays']
  if (state.role === 'sharer') {
    const primaryId = screen.getPrimaryDisplay().id
    displays = screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: `螢幕 ${i + 1}(${d.size.width}×${d.size.height}${d.id === primaryId ? ',主螢幕' : ''})`,
      selected: d.id === state.sharerDisplayId
    }))
  }
  return {
    role: state.role,
    serverUrl: state.serverUrl,
    connected: state.connected,
    roomCode: state.roomCode,
    peerPresent: state.peerPresent,
    sharerAspect: state.sharerAspect,
    calibrated: !!state.calRect,
    pointing: state.pointing,
    displays,
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
  if (state.role !== 'sharer' || !socket?.connected || !state.roomCode) return
  const d = getSelectedDisplay()
  const meta: MetaEvent = {
    kind: 'sharer-info',
    aspect: d.size.width / d.size.height,
    width: d.size.width,
    height: d.size.height
  }
  socket.emit('meta', meta)
}

// ---- 分享者端:全螢幕透明點擊穿透 overlay ----
function ensureOverlay(): void {
  if (state.role !== 'sharer') return
  const d = getSelectedDisplay()
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.setBounds(d.bounds)
    return
  }
  overlayWin = new BrowserWindow({ ...overlayWindowOptions(d.bounds), focusable: false })
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

function leaveRoom(notifyServer: boolean): void {
  if (notifyServer && socket?.connected) socket.emit('leave-room')
  state.roomCode = null
  state.peerPresent = false
  stopPointing()
  destroyOverlay()
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
    const code = state.roomCode
    if (code) {
      // 斷線重連後嘗試回到原房間
      s.timeout(8000).emit('join-room', code, (err: unknown, res?: { ok: boolean; peers?: number }) => {
        if (err || !res?.ok) {
          leaveRoom(false)
          state.error = '斷線後重新加入房間失敗,請重新建立或加入房間'
        } else {
          state.peerPresent = (res.peers ?? 0) > 0
          afterRoomJoined()
        }
        broadcast()
      })
    }
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
    if (!quitting && state.role === 'sharer' && state.roomCode) {
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

  ipcMain.handle('room:create', async () => {
    if (!socket?.connected) return { ok: false, error: '尚未連上伺服器' }
    return await new Promise((resolve) => {
      socket!.timeout(8000).emit('create-room', (err: unknown, res?: { ok: boolean; code?: string }) => {
        if (err || !res?.ok || !res.code) return resolve({ ok: false, error: '建立房間失敗,請稍後再試' })
        state.roomCode = res.code
        state.peerPresent = false
        state.error = null
        afterRoomJoined()
        broadcast()
        resolve({ ok: true, code: res.code })
      })
    })
  })

  ipcMain.handle('room:join', async (_e, codeRaw: unknown) => {
    const code = String(codeRaw ?? '').trim().toUpperCase()
    if (!code) return { ok: false, error: '請輸入房號' }
    if (!socket?.connected) return { ok: false, error: '尚未連上伺服器' }
    return await new Promise((resolve) => {
      socket!
        .timeout(8000)
        .emit('join-room', code, (err: unknown, res?: { ok: boolean; error?: string; peers?: number }) => {
          if (err) return resolve({ ok: false, error: '連線逾時,請再試一次' })
          if (!res?.ok) {
            const msg = res?.error === 'not-found' ? '房號不存在' : res?.error === 'full' ? '房間已滿' : '加入失敗'
            return resolve({ ok: false, error: msg })
          }
          state.roomCode = code
          state.peerPresent = (res.peers ?? 0) > 0
          state.error = null
          afterRoomJoined()
          broadcast()
          resolve({ ok: true })
        })
    })
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
    if (overlayWin) ensureOverlay()
    sendMeta()
    broadcast()
    return { ok: true }
  })

  ipcMain.handle('viewer:calibrate', () => {
    if (state.role !== 'viewer') return { ok: false }
    stopPointing()
    closeCalibration()
    // 在游標所在的螢幕上開校準層(Discord 通常開在那裡)
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    calWin = new BrowserWindow(overlayWindowOptions(d.bounds))
    pinOverlayOnTop(calWin)
    calWin.on('closed', () => {
      calWin = null
    })
    calWin.webContents.on('did-finish-load', () => {
      calWin?.webContents.send('calibrate:init', { aspect: state.sharerAspect })
      calWin?.focus()
    })
    loadPage(calWin, 'calibrate')
    return { ok: true }
  })

  ipcMain.on('calibrate:done', (_e, rect: Rect) => {
    if (!calWin || !rect || rect.width < 40 || rect.height < 30) {
      closeCalibration()
      return
    }
    const b = calWin.getBounds()
    state.calRect = {
      x: Math.round(b.x + rect.x),
      y: Math.round(b.y + rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
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
