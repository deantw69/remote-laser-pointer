// 檢查更新／自動更新(平台分兩套,呼應專案既有 process.platform 分支風格)
//   - win32:electron-updater(NSIS 支援)。autoDownload=false,
//     流程 checkForUpdates → 問是否下載 → downloadUpdate → 問是否 quitAndInstall。
//   - darwin:未簽章(identity:null)無法 quitAndInstall,改用 GitHub API 比對版本,
//     較新則開 Release 頁讓使用者手動下載。
// electron-updater 走延遲 require(比照 koffi/uiohook),避免影響 dev 與非 win32。

import { app, dialog, shell, BrowserWindow } from 'electron'

const REPO = 'deantw69/remote-laser-pointer'

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'latest' }
  | { state: 'error'; message: string }

let getWin: () => BrowserWindow | null = () => null
let manualCheck = false // 手動檢查時,查無新版/出錯才彈提示;自動檢查則靜默

function emit(status: UpdateStatus): void {
  const win = getWin()
  if (win && !win.isDestroyed()) win.webContents.send('update:status', status)
}

function msgBox(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const win = getWin()
  return win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
}

// ---- win32:electron-updater ----
type AutoUpdater = import('electron-updater').AppUpdater
let autoUpdater: AutoUpdater | null = null

function getAutoUpdater(): AutoUpdater | null {
  if (autoUpdater) return autoUpdater
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const au = (require('electron-updater') as typeof import('electron-updater')).autoUpdater
    au.autoDownload = false
    au.autoInstallOnAppQuit = false
    bindEvents(au)
    autoUpdater = au
    return au
  } catch (e) {
    emit({ state: 'error', message: String((e as Error)?.message ?? e) })
    return null
  }
}

function bindEvents(au: AutoUpdater): void {
  au.on('checking-for-update', () => emit({ state: 'checking' }))

  au.on('update-available', (info) => {
    manualCheck = false
    emit({ state: 'available', version: info.version })
    void msgBox({
      type: 'info',
      buttons: ['下載更新', '稍後'],
      defaultId: 0,
      cancelId: 1,
      title: '有新版本',
      message: `發現新版本 v${info.version}`,
      detail: '要現在下載嗎?下載完成後會再問你是否重新啟動更新。'
    }).then((r) => {
      if (r.response === 0) {
        emit({ state: 'downloading', percent: 0 })
        void au.downloadUpdate()
      } else {
        emit({ state: 'idle' })
      }
    })
  })

  au.on('update-not-available', () => {
    emit({ state: 'latest' })
    if (manualCheck) {
      manualCheck = false
      void msgBox({ type: 'info', title: '檢查更新', message: '已是最新版本', detail: `目前版本 v${app.getVersion()}` })
    }
  })

  au.on('download-progress', (p) => emit({ state: 'downloading', percent: Math.round(p.percent) }))

  au.on('update-downloaded', (info) => {
    emit({ state: 'available', version: info.version })
    void msgBox({
      type: 'info',
      buttons: ['立即重啟更新', '稍後'],
      defaultId: 0,
      cancelId: 1,
      title: '更新已就緒',
      message: `新版本 v${info.version} 已下載完成`,
      detail: '要現在重新啟動以完成更新嗎?'
    }).then((r) => {
      if (r.response === 0) au.quitAndInstall()
    })
  })

  au.on('error', (err) => {
    const wasManual = manualCheck
    manualCheck = false
    const message = String(err?.message ?? err)
    emit({ state: 'error', message })
    if (wasManual) void msgBox({ type: 'error', title: '檢查更新', message: '檢查更新失敗', detail: message })
  })
}

function runWinCheck(manual: boolean): void {
  const au = getAutoUpdater()
  if (!au) return
  manualCheck = manual
  void au.checkForUpdates().catch((e: unknown) => {
    emit({ state: 'error', message: String((e as Error)?.message ?? e) })
    if (manual) void msgBox({ type: 'error', title: '檢查更新', message: '檢查更新失敗', detail: String((e as Error)?.message ?? e) })
  })
}

// ---- darwin:GitHub API 比對(未簽章只提示,不自動裝) ----
function isNewer(remote: string, current: string): boolean {
  const pa = remote.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = current.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

async function checkMacManual(): Promise<void> {
  emit({ state: 'checking' })
  const cur = app.getVersion()
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'remote-laser-pointer' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { tag_name?: string; html_url?: string }
    const tag = String(data.tag_name ?? '').replace(/^v/, '')
    if (tag && isNewer(tag, cur)) {
      emit({ state: 'available', version: tag })
      const r = await msgBox({
        type: 'info',
        buttons: ['開啟下載頁', '稍後'],
        defaultId: 0,
        cancelId: 1,
        title: '有新版本',
        message: `發現新版本 v${tag}`,
        detail: `目前版本 v${cur}。macOS 版需手動下載安裝。`
      })
      if (r.response === 0) void shell.openExternal(String(data.html_url ?? `https://github.com/${REPO}/releases/latest`))
      else emit({ state: 'idle' })
    } else {
      emit({ state: 'latest' })
      await msgBox({ type: 'info', title: '檢查更新', message: '已是最新版本', detail: `目前版本 v${cur}` })
    }
  } catch (e) {
    const message = String((e as Error)?.message ?? e)
    emit({ state: 'error', message })
    await msgBox({ type: 'error', title: '檢查更新', message: '檢查更新失敗', detail: message })
  }
}

// ---- 對外 ----
export function initUpdater(getMainWin: () => BrowserWindow | null): void {
  getWin = getMainWin
  if (!app.isPackaged) return // dev 不檢查、不連網
  if (process.platform === 'win32') runWinCheck(false) // 啟動自動檢查(靜默;有新版才彈窗)
  // macOS 啟動不自動查,只在手動檢查時查(避免每次開 app 都連 GitHub)
}

export function checkForUpdatesManual(): void {
  if (!app.isPackaged) {
    void msgBox({ type: 'info', title: '檢查更新', message: '開發模式不檢查更新', detail: '打包後的版本才會檢查更新。' })
    return
  }
  if (process.platform === 'win32') runWinCheck(true)
  else void checkMacManual()
}
