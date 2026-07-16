import http from 'node:http'
import { Server } from 'socket.io'

const PORT = process.env.PORT || 3000
const EMPTY_ROOM_TTL_MS = 60_000
const LOBBY = '__lobby__'
// 排除易混淆字元(0/O、1/I)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * 以「房名」為鍵(房名即識別);密碼另存,加入時驗證
 * @type {Map<string, { name: string, password: string, members: Set<string>, emptySince: number | null }>}
 */
const rooms = new Map()

function roomList() {
  // 只列還能加入(未滿)的房
  const list = []
  for (const room of rooms.values()) {
    if (room.members.size < 2) list.push({ name: room.name })
  }
  return list
}

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('remote-laser-pointer relay')
})

const io = new Server(httpServer, { cors: { origin: '*' } })

function broadcastRooms() {
  io.to(LOBBY).emit('rooms', roomList())
}

function leaveCurrent(socket) {
  const name = socket.data.room
  if (!name) return
  socket.data.room = null
  socket.leave(name)
  const room = rooms.get(name)
  if (!room) return
  room.members.delete(socket.id)
  socket.to(name).emit('peer-left')
  if (room.members.size === 0) room.emptySince = Date.now()
  broadcastRooms()
}

io.on('connection', (socket) => {
  socket.data.room = null

  // 觀看者訂閱線上房清單(即時推播)
  socket.on('lobby:join', () => {
    socket.join(LOBBY)
    socket.emit('rooms', roomList())
  })
  socket.on('lobby:leave', () => socket.leave(LOBBY))

  // 分享者開房:{ name, password };房名即識別,已被在線房佔用則回 name-taken
  socket.on('create-room', (payload, cb) => {
    const name = String(payload?.name || '').trim().slice(0, 40)
    const password = String(payload?.password || '').trim()
    if (!name) return cb?.({ ok: false, error: 'bad-name' })
    if (!password) return cb?.({ ok: false, error: 'bad-password' })
    const existing = rooms.get(name)
    if (existing && existing.members.size > 0 && !existing.members.has(socket.id)) {
      return cb?.({ ok: false, error: 'name-taken' })
    }
    leaveCurrent(socket)
    rooms.set(name, { name, password, members: new Set([socket.id]), emptySince: null })
    socket.join(name)
    socket.data.room = name
    broadcastRooms()
    cb?.({ ok: true, name })
  })

  // 觀看者加入:{ name, password };驗密碼、滿了回 full
  socket.on('join-room', (payload, cb) => {
    const name = String(payload?.name || '').trim()
    const password = String(payload?.password || '')
    const room = rooms.get(name)
    if (!room) return cb?.({ ok: false, error: 'not-found' })
    if (room.password !== password) return cb?.({ ok: false, error: 'bad-password' })
    if (room.members.size >= 2 && !room.members.has(socket.id)) return cb?.({ ok: false, error: 'full' })
    leaveCurrent(socket)
    room.members.add(socket.id)
    room.emptySince = null
    socket.join(name)
    socket.data.room = name
    socket.to(name).emit('peer-joined')
    broadcastRooms()
    cb?.({ ok: true, name, peers: room.members.size - 1 })
  })

  socket.on('leave-room', () => leaveCurrent(socket))

  // 中繼:只轉發給同房間的另一方,不解析內容
  for (const ev of ['pointer', 'meta']) {
    socket.on(ev, (payload) => {
      const name = socket.data.room
      if (name) socket.to(name).emit(ev, payload)
    })
  }

  socket.on('disconnect', () => leaveCurrent(socket))
})

setInterval(() => {
  const now = Date.now()
  let changed = false
  for (const [name, room] of rooms) {
    if (room.members.size === 0 && room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
      rooms.delete(name)
      changed = true
    }
  }
  if (changed) broadcastRooms()
}, 30_000)

httpServer.listen(PORT, () => console.log(`relay listening on :${PORT}`))
