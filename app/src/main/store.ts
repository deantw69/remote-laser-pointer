import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

export type Rect = { x: number; y: number; width: number; height: number }

export type Settings = {
  serverUrl: string
  calRect?: Rect | null
  sharerAspect?: number | null
}

const DEFAULTS: Settings = { serverUrl: 'http://localhost:3000' }

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
