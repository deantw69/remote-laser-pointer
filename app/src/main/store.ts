import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

export type Rect = { x: number; y: number; width: number; height: number }

export type Settings = {
  serverUrl: string
  calRect?: Rect | null
  sharerRect?: Rect | null
  sharerAspect?: number | null
  // 分享者:房名(預設電腦名)與密碼(預設系統產生),固定不變直到主動修改
  roomName?: string
  roomPassword?: string
  // 觀看者:記住連過的房 房名→密碼,下次免輸入
  knownRooms?: Record<string, string>
}

const DEFAULTS: Settings = { serverUrl: 'https://remote-laser-pointer-relay.onrender.com' }

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(settingsFile(), 'utf8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: Settings): void {
  try {
    mkdirSync(dirname(settingsFile()), { recursive: true })
    writeFileSync(settingsFile(), JSON.stringify(s, null, 2))
  } catch {
    // 寫入失敗不致命,略過
  }
}
