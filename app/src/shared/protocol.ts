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

export type SharerRegion = {
  custom: boolean
  width: number
  height: number
}

// 線上房清單項目(觀看者用);房名即識別
export type RoomInfo = {
  name: string
}

export type AppStatus = {
  role: Role | null
  serverUrl: string
  connected: boolean
  roomName: string | null // 目前所在房(分享者=自己開的房、觀看者=加入的房)
  peerPresent: boolean
  // 分享者:自己的房名與密碼(可編輯,固定不變)
  sharerName?: string
  sharerPassword?: string
  // 觀看者:即時線上房清單、哪些房本機記過密碼
  rooms?: RoomInfo[]
  knownRooms?: string[]
  sharerAspect: number | null
  calibrated: boolean
  pointing: boolean
  displays?: DisplayInfo[]
  sharerRegion?: SharerRegion | null
  error?: string | null
}
