// 雙端共用協定:座標一律為 0~1 正規化值
export type Mark =
  | { t: 'ping'; x: number; y: number }
  | { t: 'laser'; x: number; y: number }
  | { t: 'laser-off' }
  | { t: 'stroke-start'; x: number; y: number }
  | { t: 'stroke-point'; x: number; y: number }
  | { t: 'stroke-end' }

export type MetaEvent = {
  kind: 'sharer-info'
  aspect: number
  width: number
  height: number
}

export type Role = 'viewer' | 'sharer'

export type DisplayInfo = {
  id: number
  label: string
  selected: boolean
}

export type AppStatus = {
  role: Role | null
  serverUrl: string
  connected: boolean
  roomCode: string | null
  peerPresent: boolean
  sharerAspect: number | null
  calibrated: boolean
  pointing: boolean
  displays?: DisplayInfo[]
  error?: string | null
}
